import type { TrackEvent, TrackerOptions } from './types';
import {
  NonRetryableError,
  generateUUID,
  parseRetryAfterMs,
  readPartialAccept,
  toWireBatch,
  type QueuedEvent,
} from './wire';

const KEEPALIVE_LIMIT_BYTES = 60_000;

const DEFAULT_OPTIONS: Required<Omit<TrackerOptions, 'attribution' | 'onError'>> = {
  endpoint: 'https://api.doow.co',
  enabled: true,
  debug: false,
  flushAt: 20,
  flushIntervalMs: 10000,
  maxQueueSize: 10000,
  timeoutMs: 10000,
  retryCount: 3,
  disableCompression: false,
};

export class ClientTracker {
  private apiKey: string;
  private options: Required<Omit<TrackerOptions, 'attribution' | 'onError'>> & {
    attribution?: Record<string, unknown>;
    onError?: (error: Error) => void;
  };
  private queue: QueuedEvent[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private shutdown = false;

  constructor(apiKey: string, options: TrackerOptions = {}) {
    if (!apiKey.startsWith('dk_')) {
      throw new Error('API key must start with dk_');
    }
    this.apiKey = apiKey;
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.startFlushTimer();
    this.setupLifecycleHooks();
  }

  private startFlushTimer(): void {
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushTimer = setInterval(() => this.flush(), this.options.flushIntervalMs);
  }

  private setupLifecycleHooks(): void {
    if (typeof window === 'undefined') return;

    window.addEventListener('beforeunload', () => this.flushSync());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this.flushSync();
      }
    });
  }

  private log(message: string): void {
    if (this.options.debug) {
      console.log(`[DoowTrack] ${message}`);
    }
  }

  track(event: TrackEvent): void {
    if (!this.options.enabled || this.shutdown) return;

    if (this.queue.length >= this.options.maxQueueSize) {
      this.log('Queue full, dropping event');
      return;
    }

    const enrichedEvent: QueuedEvent = {
      ...event,
      eventId: generateUUID(),
      timestamp: event.timestamp || new Date().toISOString(),
      attribution: { ...event.attribution, ...this.options.attribution },
    };

    this.queue.push(enrichedEvent);
    this.log(`Queued event: ${event.metric}`);

    if (this.queue.length >= this.options.flushAt) {
      this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.queue.length === 0 || this.shutdown) return;

    const batch = [...this.queue];
    this.queue = [];

    this.log(`Flushing ${batch.length} events`);

    try {
      await this.sendWithRetry(batch);
    } catch (error) {
      this.options.onError?.(error as Error);
      this.log(`Flush failed: ${error}`);
    }
  }

  private flushSync(): void {
    if (this.queue.length === 0 || typeof fetch === 'undefined') return;

    const chunk = this.firstKeepaliveChunk(this.queue);
    this.queue = this.queue.slice(chunk.length);

    fetch(`${this.options.endpoint}/telemetry/events`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(toWireBatch(generateUUID(), chunk)),
      keepalive: true,
    }).catch((error: unknown) => {
      this.options.onError?.(error as Error);
      this.log(`Unload flush failed: ${error}`);
    });
  }

  private firstKeepaliveChunk(events: QueuedEvent[]): QueuedEvent[] {
    let chunk = events;
    while (chunk.length > 1 && JSON.stringify(toWireBatch('x', chunk)).length > KEEPALIVE_LIMIT_BYTES) {
      chunk = chunk.slice(0, Math.ceil(chunk.length / 2));
    }
    return chunk;
  }

  private async sendWithRetry(batch: QueuedEvent[]): Promise<void> {
    const batchId = generateUUID();
    const payload = JSON.stringify(toWireBatch(batchId, batch));

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };

    let body: BodyInit = payload;

    if (!this.options.disableCompression && payload.length > 1024 && typeof CompressionStream !== 'undefined') {
      const stream = new Blob([payload]).stream().pipeThrough(new CompressionStream('gzip'));
      body = await new Response(stream).blob();
      headers['Content-Encoding'] = 'gzip';
    }

    for (let attempt = 0; attempt <= this.options.retryCount; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);

        const response = await fetch(`${this.options.endpoint}/telemetry/events`, {
          method: 'POST',
          headers,
          body,
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (response.status === 207) {
          this.options.onError?.(await readPartialAccept(response, batchId));
          return;
        }

        if (response.ok) {
          this.log('Batch sent successfully');
          return;
        }

        if (response.status === 429 || response.status >= 500) {
          if (attempt === this.options.retryCount) {
            throw new Error(`HTTP ${response.status} after ${attempt + 1} attempts`);
          }
          const retryAfter =
            response.status === 429 ? parseRetryAfterMs(response.headers.get('Retry-After')) : undefined;
          const delay = retryAfter ?? 100 * Math.pow(2, attempt);
          await this.sleep(delay);
          continue;
        }

        throw new NonRetryableError(`HTTP ${response.status}: ${await response.text()}`);
      } catch (error) {
        if (error instanceof NonRetryableError || attempt === this.options.retryCount) throw error;
        await this.sleep(100 * Math.pow(2, attempt));
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  destroy(): void {
    this.shutdown = true;
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushSync();
  }
}
