import type { TrackEvent, ServerTrackerOptions } from './types';
import {
  NonRetryableError,
  PartialAcceptError,
  generateUUID,
  readPartialAccept,
  toWireBatch,
  type QueuedEvent,
} from './wire';

const DEFAULT_OPTIONS: Required<Omit<ServerTrackerOptions, 'debug'>> & { debug: boolean } = {
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
          throw await readPartialAccept(response, batchId);
        }

        if (response.ok) {
          this.log('Batch sent successfully');
          return;
        }

        if (response.status === 429 || response.status >= 500) {
          throw new Error(`HTTP ${response.status}`);
        }

        throw new NonRetryableError(`HTTP ${response.status}: ${await response.text()}`);
      } catch (error) {
        const retryable = !(error instanceof NonRetryableError) && !(error instanceof PartialAcceptError);
        if (!retryable || attempt === this.options.retryCount) throw error;
        await this.sleep(100 * Math.pow(2, attempt));
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
