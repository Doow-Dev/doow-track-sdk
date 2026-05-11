/**
 * S78: Exporter — HTTP transport + compression + retry
 *
 * Handles the *how* of delivery:
 * - POST to {endpoint}/telemetry/events with gzip
 * - Exponential backoff with ±20% jitter, max retryCount retries
 * - 429 respects Retry-After header
 * - 413 adaptive batch halving
 * - Serialized flushes (one in-flight at a time)
 * - Custom transport for testing/mTLS
 * - onError callback — SDK never throws
 */
import { createGzip } from 'zlib';
import { generateUUID } from './uuid.js';
import type {
  BatchPayload,
  CustomTransport,
  OfflineStore,
  PartialAcceptResponse,
  SdkError,
  SerializedBatch,
  SerializedEvent,
  TransportPayload,
  TransportResponse,
  WireEvent,
} from './types.js';
import type { DebugLogger } from './debug.js';

async function gzipBuffer(data: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const gz = createGzip();
    gz.on('data', (chunk: Buffer) => chunks.push(chunk));
    gz.on('end', () => resolve(Buffer.concat(chunks)));
    gz.on('error', reject);
    gz.end(data);
  });
}

// Replaced at build time by @rollup/plugin-replace (rollup) and vitest define (tests)
declare const __SDK_VERSION__: string;
const SDK_VERSION = __SDK_VERSION__;

function toWireEvent(event: SerializedEvent): WireEvent {
  const sourceSystem = event.source_system?.trim() ? event.source_system : 'sdk';
  const metricTupleHint = event.metric_tuple_hint;

  return {
    ...event,
    occurred_at: event.timestamp,
    source_system: sourceSystem,
    ...(metricTupleHint ? { metric_tuple_hint: metricTupleHint } : {}),
    measurements: [
      {
        metric_name: event.metric,
        quantity: event.quantity,
        ...(metricTupleHint ? { metric_tuple_hint: metricTupleHint } : {}),
      },
    ],
  };
}

function toBatchPayload(batchId: string, events: SerializedEvent[]): BatchPayload {
  return {
    batch_id: batchId,
    sdk_version: SDK_VERSION,
    events: events.map(toWireEvent),
  };
}

// ─── Rate limit header types ───────────────────────────────────────────────

interface RateLimitEntry {
  limit: number;
  current: number;
  retry_after: number; // seconds
}

type RateLimitsHeader = Record<string, RateLimitEntry>;

// ─── ExporterConfig ────────────────────────────────────────────────────────

export interface ExporterConfig {
  endpoint: string;
  apiKey: string;
  timeout: number;
  retryCount: number;
  disableCompression: boolean;
  maxConcurrentFlushes: number;
  onError: (error: SdkError) => void;
  transport?: CustomTransport;
  offlineStore?: OfflineStore;
  debug: DebugLogger;
}

export class Exporter {
  private readonly config: ExporterConfig;
  private _pendingFlush: Promise<void> | null = null;
  private _adaptiveBatchSize: number | null = null;
  private _stopped = false;
  private _concurrentCount = 0;
  private readonly _concurrentQueue: Array<() => void> = [];
  /** S79: Per-category rate limit state. Key = category name, value = expiry timestamp in ms */
  private readonly _rateLimits: Map<string, { expiresAt: number }> = new Map();

  constructor(config: ExporterConfig) {
    this.config = config;
  }

  /** Serialized flush: one HTTP request in-flight at a time */
  async flush(events: SerializedEvent[]): Promise<void> {
    this._evictExpiredLimits();

    // S79: If any rate limit is currently active, hold events (don't drop)
    if (this._isRateLimited()) {
      this.config.debug.log('Rate limited — holding events, skipping flush');
      return;
    }

    // Chain onto any pending flush
    const chain = this._pendingFlush ?? Promise.resolve();
    let resolve!: () => void;
    const next = new Promise<void>((r) => {
      resolve = r;
    });
    this._pendingFlush = next;

    await chain;
    try {
      // S80: Drain offline store FIFO before new events
      await this._drainOfflineStore();
      await this._doFlush(events);
    } finally {
      resolve();
      if (this._pendingFlush === next) {
        this._pendingFlush = null;
      }
    }
  }

  /** Mark stopped — 401 auth failure */
  stop(): void {
    this._stopped = true;
  }

  get stopped(): boolean {
    return this._stopped;
  }

  /** S79: True if any active rate limit has not yet expired */
  get rateLimited(): boolean {
    return this._isRateLimited();
  }

  /** Wait for any in-flight flush to complete */
  async drain(): Promise<void> {
    if (this._pendingFlush) {
      await this._pendingFlush;
    }
  }

  // ─── S79: Rate limit helpers ──────────────────────────────────────────────

  private _isRateLimited(): boolean {
    const now = Date.now();
    for (const [, entry] of this._rateLimits) {
      if (now < entry.expiresAt) return true;
    }
    return false;
  }

  private _evictExpiredLimits(): void {
    const now = Date.now();
    for (const [category, entry] of this._rateLimits) {
      if (now >= entry.expiresAt) {
        this._rateLimits.delete(category);
      }
    }
  }

  /** Parse and apply X-Doow-Rate-Limits header from a 429 response */
  private _applyRateLimitHeader(headers: Record<string, string>): void {
    const raw = headers['x-doow-rate-limits'] ?? headers['X-Doow-Rate-Limits'];
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as RateLimitsHeader;
      const now = Date.now();
      for (const [category, entry] of Object.entries(parsed)) {
        if (
          typeof entry === 'object' &&
          entry !== null &&
          typeof entry.retry_after === 'number' &&
          entry.retry_after > 0
        ) {
          const expiresAt = now + entry.retry_after * 1000;
          this._rateLimits.set(category, { expiresAt });
          this.config.debug.log(`Rate limit set: ${category} expires in ${entry.retry_after}s`);
        }
      }
    } catch {
      // Malformed header — ignore gracefully
      this.config.debug.warn('Malformed X-Doow-Rate-Limits header — ignored');
    }
  }

  // ─── S80: Offline store helpers ───────────────────────────────────────────

  /** Drain the offline store FIFO before sending new events */
  private async _drainOfflineStore(): Promise<void> {
    const store = this.config.offlineStore;
    if (!store) return;

    try {
      const len = await store.length();
      if (len === 0) return;
      this.config.debug.log(`Draining ${len} batches from offline store`);
    } catch {
      return;
    }

    // Drain FIFO — shift one batch at a time
    let batch: SerializedBatch | undefined;
    while ((batch = await store.shift()) !== undefined) {
      try {
        const payload = JSON.parse(batch.payload) as BatchPayload;
        if (payload.events && payload.events.length > 0) {
          await this._sendWithRetry(payload.events, this.config.retryCount, payload.batch_id);
        }
      } catch {
        this.config.debug.warn(`Failed to replay offline batch ${batch.batch_id}`);
      }
    }
  }

  private async _doFlush(events: SerializedEvent[]): Promise<void> {
    if (this._stopped || events.length === 0) return;

    const maxBatch = this._adaptiveBatchSize ?? 500;

    // Split into ≤500 event chunks
    const chunks: SerializedEvent[][] = [];
    for (let i = 0; i < events.length; i += maxBatch) {
      chunks.push(events.slice(i, i + maxBatch));
    }

    for (const chunk of chunks) {
      await this._sendWithRetry(chunk, this.config.retryCount);
    }
  }

  private async _sendWithRetry(
    events: SerializedEvent[],
    retriesLeft: number,
    batchId?: string,
  ): Promise<void> {
    if (this._stopped) return;

    const resolvedBatchId = batchId ?? generateUUID();

    try {
      await this._withConcurrencyLimit(() => this._sendOnce(events, resolvedBatchId));
    } catch (err) {
      const sdkErr = err as SdkHttpError;

      if (sdkErr.statusCode === 401) {
        // Auth failure — stop permanently
        this._stopped = true;
        this.config.onError({
          kind: 'AUTH_FAILURE',
          message: 'API key rejected (401). Stopping SDK.',
          statusCode: 401,
        });
        return;
      }

      if (sdkErr.statusCode === 413) {
        // Adaptive recovery — halve batch
        const half = Math.max(1, Math.floor(events.length / 2));
        this._adaptiveBatchSize = half;
        this.config.debug.warn(`413 received — adaptive batch size reduced to ${half}`);

        const first = events.slice(0, half);
        const second = events.slice(half);

        // Retry each half with full retry budget
        await this._sendWithRetry(first, this.config.retryCount, resolvedBatchId);
        if (second.length > 0) {
          await this._sendWithRetry(second, this.config.retryCount);
        }
        return;
      }

      if (sdkErr.statusCode === 429) {
        // S79: Apply rate limit header from the response if present
        if (sdkErr.rateLimitHeaders) {
          this._applyRateLimitHeader(sdkErr.rateLimitHeaders);
        }
        const retryAfterMs =
          sdkErr.retryAfterMs ?? this._backoff(this.config.retryCount - retriesLeft);
        this.config.debug.log(`429 rate limited — waiting ${retryAfterMs}ms`);
        this.config.onError({
          kind: 'RATE_LIMITED',
          message: `Rate limited (429). Retry after ${retryAfterMs}ms.`,
          statusCode: 429,
          retryAfterMs,
        });
        if (retriesLeft <= 0) return;
        await this._sleep(retryAfterMs);
        return await this._sendWithRetry(events, retriesLeft - 1, resolvedBatchId);
      }

      if (retriesLeft <= 0) {
        const errPayload: SdkError = {
          kind: sdkErr.kind ?? 'NETWORK_ERROR',
          message: sdkErr.message,
          rejectedEventIds: events.map((e) => e.event_id),
        };
        if (sdkErr.statusCode !== undefined) errPayload.statusCode = sdkErr.statusCode;
        if (sdkErr.cause instanceof Error) errPayload.error = sdkErr.cause;
        this.config.onError(errPayload);
        // S80: Persist to offline store if configured
        await this._persistToOfflineStore(resolvedBatchId, events);
        return;
      }

      // Exponential backoff for non-429 retryable errors
      const delay = this._backoff(this.config.retryCount - retriesLeft);
      this.config.debug.log(`Retry in ${delay}ms, ${retriesLeft - 1} retries left`);
      await this._sleep(delay);
      await this._sendWithRetry(events, retriesLeft - 1, resolvedBatchId);
    }
  }

  /** S80: Persist a failed batch to the offline store */
  private async _persistToOfflineStore(batchId: string, events: SerializedEvent[]): Promise<void> {
    const store = this.config.offlineStore;
    if (!store) return;
    try {
      const payload = toBatchPayload(batchId, events);
      const serialized: SerializedBatch = {
        batch_id: batchId,
        payload: JSON.stringify(payload),
        timestamp: new Date().toISOString(),
      };
      await store.push(serialized);
      this.config.debug.log(`Persisted failed batch ${batchId} to offline store`);
    } catch {
      this.config.debug.warn(`Failed to persist batch ${batchId} to offline store`);
    }
  }

  private async _sendOnce(events: SerializedEvent[], batchId: string): Promise<void> {
    const payload = toBatchPayload(batchId, events);

    const jsonBuffer = Buffer.from(JSON.stringify(payload));
    let body: Buffer;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.config.apiKey}`,
      'Content-Type': 'application/json',
      'X-Doow-SDK-Version': SDK_VERSION,
    };

    if (this.config.disableCompression) {
      body = jsonBuffer;
    } else {
      body = await gzipBuffer(jsonBuffer);
      headers['Content-Encoding'] = 'gzip';
    }

    headers['Content-Length'] = String(body.length);

    const url = `${this.config.endpoint}/telemetry/events`;
    const transportPayload: TransportPayload = { body, headers, url };

    this.config.debug.log(
      `POST ${url} batch_id=${batchId} events=${events.length} bytes=${body.length}`,
    );

    let response: TransportResponse;

    try {
      if (this.config.transport) {
        response = await this._withTimeout(
          this.config.transport.send(transportPayload),
          this.config.timeout,
        );
      } else {
        response = await this._withTimeout(
          this._defaultTransport(transportPayload),
          this.config.timeout,
        );
      }
    } catch (err) {
      const e = err as Error;
      if (e.name === 'AbortError' || e.message?.includes('timeout')) {
        throw new SdkHttpError(
          'TIMEOUT',
          `Request timed out after ${this.config.timeout}ms`,
          undefined,
          undefined,
          e,
        );
      }
      throw new SdkHttpError(
        'NETWORK_ERROR',
        `Network error: ${e.message}`,
        undefined,
        undefined,
        e,
      );
    }

    this.config.debug.log(`Response ${response.status} batch_id=${batchId}`);

    if (response.status === 202) {
      // Success — reset adaptive batch size
      this._adaptiveBatchSize = null;
      return;
    }

    if (response.status === 207) {
      // Partial accept
      try {
        const parsed = JSON.parse(response.body) as PartialAcceptResponse;
        if (parsed.rejected?.length > 0) {
          this.config.onError({
            kind: 'PARTIAL_ACCEPT',
            message: `Batch partially accepted — ${parsed.rejected.length} events rejected`,
            statusCode: 207,
            rejectedEventIds: parsed.rejected.map((r) => r.event_id),
          });
        }
      } catch {
        // Non-JSON 207 — treat as success
      }
      this._adaptiveBatchSize = null;
      return;
    }

    if (response.status === 401) {
      throw new SdkHttpError('AUTH_FAILURE', 'Unauthorized (401)', 401);
    }

    if (response.status === 413) {
      throw new SdkHttpError('TRANSPORT_ERROR', 'Payload too large (413)', 413);
    }

    if (response.status === 429) {
      const retryAfterMs = this._parseRetryAfter(
        response.headers['retry-after'] ?? response.headers['Retry-After'],
      );
      throw new SdkHttpError(
        'RATE_LIMITED',
        `Rate limited (429)`,
        429,
        retryAfterMs,
        undefined,
        response.headers,
      );
    }

    if (response.status >= 500) {
      throw new SdkHttpError('TRANSPORT_ERROR', `Server error ${response.status}`, response.status);
    }

    // Other 4xx — don't retry
    throw new SdkHttpError('TRANSPORT_ERROR', `HTTP ${response.status}`, response.status);
  }

  private async _defaultTransport(payload: TransportPayload): Promise<TransportResponse> {
    const { default: https } = await import('https');
    const { default: http } = await import('http');

    return new Promise((resolve, reject) => {
      const url = new URL(payload.url);
      const isHttps = url.protocol === 'https:';
      const client = isHttps ? https : http;

      const req = client.request(
        {
          hostname: url.hostname,
          port: url.port || (isHttps ? 443 : 80),
          path: url.pathname + url.search,
          method: 'POST',
          headers: payload.headers,
        },
        (res) => {
          const chunks: Buffer[] = [];
          let totalBytes = 0;
          const maxBodyBytes = 1024 * 1024; // 1 MB cap
          res.on('data', (chunk: Buffer) => {
            totalBytes += chunk.length;
            if (totalBytes <= maxBodyBytes) chunks.push(chunk);
          });
          res.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf8');
            const headers: Record<string, string> = {};
            for (const [k, v] of Object.entries(res.headers)) {
              if (typeof v === 'string') headers[k] = v;
              else if (Array.isArray(v)) headers[k] = v[0] ?? '';
            }
            resolve({ status: res.statusCode ?? 0, headers, body });
          });
          res.on('error', reject);
        },
      );

      req.on('error', reject);
      req.write(payload.body);
      req.end();
    });
  }

  private async _withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const err = new Error(`Timeout after ${timeoutMs}ms`);
        err.name = 'AbortError';
        reject(err);
      }, timeoutMs);

      promise.then(
        (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        (e) => {
          clearTimeout(timer);
          reject(e as Error);
        },
      );
    });
  }

  private async _withConcurrencyLimit<T>(fn: () => Promise<T>): Promise<T> {
    const max = this.config.maxConcurrentFlushes;

    if (this._concurrentCount >= max) {
      // Queue and wait
      await new Promise<void>((resolve) => this._concurrentQueue.push(resolve));
    }

    this._concurrentCount++;
    try {
      return await fn();
    } finally {
      this._concurrentCount--;
      const next = this._concurrentQueue.shift();
      if (next) next();
    }
  }

  /** Exponential backoff with ±20% jitter */
  private _backoff(attempt: number): number {
    const base = Math.min(1000 * Math.pow(2, attempt), 16000);
    const jitter = base * 0.2 * (Math.random() * 2 - 1);
    return Math.round(base + jitter);
  }

  private _parseRetryAfter(header: string | undefined): number | undefined {
    if (!header) return undefined;
    const seconds = parseFloat(header);
    if (!isNaN(seconds)) return Math.round(seconds * 1000);
    const date = new Date(header).getTime();
    if (!isNaN(date)) return Math.max(0, date - Date.now());
    return undefined;
  }

  private _sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

class SdkHttpError extends Error {
  constructor(
    public readonly kind: SdkError['kind'],
    message: string,
    public readonly statusCode?: number,
    public readonly retryAfterMs?: number,
    public readonly cause?: Error,
    /** S79: Response headers from the 429 response — used to parse X-Doow-Rate-Limits */
    public readonly rateLimitHeaders?: Record<string, string>,
  ) {
    super(message);
    this.name = 'SdkHttpError';
  }
}
