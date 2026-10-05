import type { TrackEvent, ServerTrackerOptions } from './types';
import {
  NonRetryableError,
  generateUUID,
  isTransientStatus,
  notify,
  parseRetryAfterMs,
  readBoundedText,
  readPartialAccept,
  sanitizeText,
  toWireBatch,
  type QueuedEvent,
} from './wire';

const DEFAULT_OPTIONS: Required<Omit<ServerTrackerOptions, 'debug' | 'onError'>> & {
  debug: boolean;
  onError?: (error: Error) => void;
} = {
  endpoint: 'https://api.doow.co',
  debug: false,
  timeoutMs: 10000,
  retryCount: 3,
};

export class ServerTracker {
  private apiKey: string;
  private options: typeof DEFAULT_OPTIONS;

  constructor(apiKey: string, options: ServerTrackerOptions = {}) {
    if (!apiKey.startsWith('dk_')) {
      throw new Error('API key must start with dk_');
    }
    this.apiKey = apiKey;
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  private log(message: string): void {
    if (this.options.debug) {
      console.log(`[DoowTrack:Server] ${message}`);
    }
  }

  async track(event: TrackEvent): Promise<void> {
    return this.trackBatch([event]);
  }

  async trackBatch(events: TrackEvent[]): Promise<void> {
    const queued: QueuedEvent[] = events.map((event) => ({
      ...event,
      eventId: generateUUID(),
      timestamp: event.timestamp || new Date().toISOString(),
    }));
    const batchId = generateUUID();
    const body = JSON.stringify(toWireBatch(batchId, queued));

    this.log(`Tracking batch ${batchId}: ${queued.length} events`);

    let retryAfterMs: number | undefined;
    for (let attempt = 0; attempt <= this.options.retryCount; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);
      try {
        const response = await fetch(`${this.options.endpoint}/telemetry/events`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body,
          signal: controller.signal,
        });

        if (response.status === 207) {
          const partial = await readPartialAccept(response, batchId);
          notify(this.options.onError, partial);
          this.log(partial.message);
          return;
        }

        if (response.ok) {
          this.log('Batch sent successfully');
          return;
        }

        if (isTransientStatus(response.status)) {
          retryAfterMs =
            response.status === 429 || response.status === 503
              ? parseRetryAfterMs(response.headers.get('Retry-After'))
              : undefined;
          throw new Error(`HTTP ${response.status}`);
        }

        throw new NonRetryableError(`HTTP ${response.status}: ${sanitizeText(await readBoundedText(response))}`);
      } catch (error) {
        const retryable = !(error instanceof NonRetryableError);
        if (!retryable || attempt === this.options.retryCount) throw error;
        await this.sleep(retryAfterMs ?? 100 * Math.pow(2, attempt));
        retryAfterMs = undefined;
      } finally {
        clearTimeout(timeout);
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

let defaultTracker: ServerTracker | null = null;

export function initServerTracker(apiKey: string, options?: ServerTrackerOptions): ServerTracker {
  defaultTracker = new ServerTracker(apiKey, options);
  return defaultTracker;
}

export function getServerTracker(): ServerTracker {
  if (!defaultTracker) {
    throw new Error('Server tracker not initialized. Call initServerTracker() first.');
  }
  return defaultTracker;
}

export async function trackServerEvent(event: TrackEvent): Promise<void> {
  return getServerTracker().track(event);
}
