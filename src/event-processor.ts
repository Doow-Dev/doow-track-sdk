/**
 * S77: EventProcessor — batching + hooks
 *
 * Decides *when* and *how much* to flush:
 * - Dual flush trigger: count OR bytes OR timer
 * - First-event fast path: immediate flush on first track()
 * - Max 500 events per POST (enforced in Exporter)
 * - beforeSend(event) hook — return null to drop per event
 * - beforeFlush(batch) hook — return null to drop entire batch
 * - Ring buffer with maxQueueSize — evicts oldest when full
 */
import type { DoowTrackerOptions, SerializedEvent } from './types.js';
import type { Exporter } from './exporter.js';
import type { DebugLogger } from './debug.js';

export interface ProcessorConfig {
  flushAt: number;
  flushInterval: number;
  maxPayloadBytes: number;
  maxQueueSize: number;
  beforeSend?: DoowTrackerOptions['beforeSend'];
  beforeFlush?: DoowTrackerOptions['beforeFlush'];
  debug: DebugLogger;
}

export class EventProcessor {
  private readonly _queue: SerializedEvent[] = [];
  private _timer: ReturnType<typeof setTimeout> | null = null;
  private _hasFlushed = false;
  private _currentBytes = 0;
  private readonly _config: ProcessorConfig;
  private readonly _exporter: Exporter;
  /** Track pending async enqueue promises so shutdown can wait for them */
  private readonly _pendingEnqueues: Set<Promise<void>> = new Set();

  constructor(config: ProcessorConfig, exporter: Exporter) {
    this._config = config;
    this._exporter = exporter;
  }

  /** Enqueue an event. Applies beforeSend hook, ring buffer eviction, flush triggers. */
  enqueue(event: SerializedEvent): Promise<void> {
    const p = this._enqueueAsync(event);
    this._pendingEnqueues.add(p);
    p.finally(() => this._pendingEnqueues.delete(p));
    return p;
  }

  private async _enqueueAsync(event: SerializedEvent): Promise<void> {
    // Apply beforeSend hook
    const processed = await this._applyBeforeSend(event);
    if (processed === null) {
      this._config.debug.log(`beforeSend dropped event ${event.event_id}`);
      return;
    }

    // Ring buffer: evict oldest if at capacity
    if (this._queue.length >= this._config.maxQueueSize) {
      const evicted = this._queue.shift();
      if (evicted) {
        this._currentBytes -= this._eventBytes(evicted);
        this._config.debug.warn(`Ring buffer full — evicted oldest event ${evicted.event_id}`);
      }
    }

    this._queue.push(processed);
    this._currentBytes += this._eventBytes(processed);

    // First-event fast path
    if (!this._hasFlushed) {
      this._config.debug.log(`First event — immediate flush`);
      await this._triggerFlush();
      return;
    }

    // Count threshold
    if (this._queue.length >= this._config.flushAt) {
      this._config.debug.log(`Count threshold (${this._config.flushAt}) reached — flushing`);
      await this._triggerFlush();
      return;
    }

    // Byte threshold
    if (this._currentBytes >= this._config.maxPayloadBytes) {
      this._config.debug.log(`Byte threshold (${this._config.maxPayloadBytes}) reached — flushing`);
      await this._triggerFlush();
      return;
    }

    // Ensure timer is running
    this._ensureTimer();
  }

  /** Manual flush — waits for pending enqueues, then flushes buffer */
  async flush(): Promise<void> {
    if (this._pendingEnqueues.size > 0) {
      await Promise.all([...this._pendingEnqueues]);
    }
    await this._triggerFlush();
  }

  /** Flush and stop timer */
  async shutdown(): Promise<void> {
    this._stopTimer();
    if (this._pendingEnqueues.size > 0) {
      await Promise.all([...this._pendingEnqueues]);
    }
    await this._triggerFlush();
    await this._exporter.drain();
  }

  /** Stop the interval timer */
  private _stopTimer(): void {
    if (this._timer !== null) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  private _ensureTimer(): void {
    if (this._timer !== null) return;
    this._timer = setTimeout(() => {
      this._timer = null;
      this._config.debug.log(`Timer flush after ${this._config.flushInterval}ms`);
      void this._triggerFlush();
    }, this._config.flushInterval);
  }

  private async _triggerFlush(): Promise<void> {
    this._stopTimer();

    if (this._queue.length === 0) return;

    // Drain the queue
    const batch = this._queue.splice(0, this._queue.length);
    this._currentBytes = 0;
    this._hasFlushed = true;

    // Apply beforeFlush hook
    const finalBatch = await this._applyBeforeFlush(batch);
    if (finalBatch === null || finalBatch.length === 0) {
      this._config.debug.log(`beforeFlush dropped batch of ${batch.length} events`);
      return;
    }

    await this._exporter.flush(finalBatch);
  }

  private async _applyBeforeSend(event: SerializedEvent): Promise<SerializedEvent | null> {
    if (!this._config.beforeSend) return event;
    try {
      return await this._config.beforeSend(event);
    } catch (err) {
      this._config.debug.warn(`beforeSend threw: ${String(err)}`);
      return event; // fail-open
    }
  }

  private async _applyBeforeFlush(batch: SerializedEvent[]): Promise<SerializedEvent[] | null> {
    if (!this._config.beforeFlush) return batch;
    try {
      return await this._config.beforeFlush(batch);
    } catch (err) {
      this._config.debug.warn(`beforeFlush threw: ${String(err)}`);
      return batch; // fail-open
    }
  }

  private _eventBytes(event: SerializedEvent): number {
    return Buffer.byteLength(JSON.stringify(event), 'utf8');
  }

  /** Expose queue length for testing */
  get queueLength(): number {
    return this._queue.length;
  }

  /** Expose hasFlushed for testing */
  get hasFlushed(): boolean {
    return this._hasFlushed;
  }

  /** Override flushAt threshold (used by serverless wrappers to force flushAt=1) */
  setFlushAt(n: number): void {
    this._config.flushAt = n;
  }
}
