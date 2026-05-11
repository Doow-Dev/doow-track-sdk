/**
 * Core types for @doow/track SDK.
 *
 * `TrackEvent` is the customer-facing ergonomic shape.
 * `BatchPayload` is the richer wire payload sent to E2-st.
 */

// ─── Wire protocol types ───────────────────────────────────────────────────

export interface MetricTupleHint {
  app_name: string;
  license_name: string;
  metric_name: string;
}

export interface TrackEvent {
  /** The metric being measured (e.g. 'api_calls', 'tokens_generated') */
  metric: string;
  /** Quantity measured */
  quantity: number;
  /** Optional unit (e.g. 'tokens', 'bytes', 'requests') */
  unit?: string;
  /** License ID this event belongs to */
  license_id: string;
  /** Optional explicit source system. Defaults to `sdk` on the wire. */
  source_system?: string;
  /** Optional event timestamp (ISO 8601). Defaults to now. */
  timestamp?: string;
  /** Optional tuple hint for direct metric resolution on ingest. */
  metric_tuple_hint?: MetricTupleHint;
  /** Event kind: USAGE (default) or ADJUSTMENT */
  kind?: 'USAGE' | 'ADJUSTMENT';
  /** Per-event attribution metadata — merges with SDK-level defaults */
  attribution?: Record<string, string | number | boolean>;
  /** Arbitrary metadata fields */
  metadata?: Record<string, unknown>;
}

export interface SerializedEvent extends TrackEvent {
  /** UUID v4 generated at track() call time */
  event_id: string;
  /** ISO 8601 timestamp (set if not provided) */
  timestamp: string;
}

export interface WireMeasurement {
  metric_name: string;
  quantity: number;
  metric_tuple_hint?: MetricTupleHint;
}

export interface WireEvent extends SerializedEvent {
  occurred_at: string;
  source_system: string;
  measurements: WireMeasurement[];
}

export interface BatchPayload {
  /** UUID v4 per-flush, stable across retries */
  batch_id: string;
  /** SDK version from package.json */
  sdk_version: string;
  /** Events in this batch */
  events: WireEvent[];
}

export interface TransportPayload {
  body: Buffer;
  headers: Record<string, string>;
  url: string;
}

export interface TransportResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

// ─── Response shapes ───────────────────────────────────────────────────────

export interface PartialAcceptResponse {
  accepted: string[];
  rejected: Array<{ event_id: string; reason: string }>;
}

// ─── Configuration ─────────────────────────────────────────────────────────

export interface OfflineStore {
  push(envelope: SerializedBatch): Promise<void>;
  shift(): Promise<SerializedBatch | undefined>;
  length(): Promise<number>;
}

export interface SerializedBatch {
  batch_id: string;
  payload: string; // JSON string of BatchPayload
  timestamp: string;
}

export interface CustomTransport {
  send(payload: TransportPayload): Promise<TransportResponse>;
}

/** All 18 init options from spec (lines 2358-2377) */
export interface DoowTrackerOptions {
  /** Server endpoint. Default: https://api.doow.co */
  endpoint?: string;
  /** Enable/disable the SDK. Default: true */
  enabled?: boolean;
  /** SDK-level attribution bag merged into every event */
  attribution?: Record<string, string | number | boolean>;
  /** Enable debug logging (only works in debug builds) */
  debug?: boolean;
  /** Flush after N events. Default: 20 */
  flushAt?: number;
  /** Flush every N milliseconds. Default: 10000 (10s) */
  flushInterval?: number;
  /** Max payload bytes before flush. Default: 450 * 1024 (450KB) */
  maxPayloadBytes?: number;
  /** Max events in ring buffer. Default: 10000 */
  maxQueueSize?: number;
  /** Per-request timeout in ms. Default: 10000 (10s) */
  timeout?: number;
  /** Max retries on transient failures. Default: 3 */
  retryCount?: number;
  /** Disable gzip compression. Default: false */
  disableCompression?: boolean;
  /** Called on errors — SDK never throws. Default: console.warn */
  onError?: (error: SdkError) => void;
  /** Per-event hook. Return null to drop. */
  beforeSend?: (event: SerializedEvent) => SerializedEvent | null | Promise<SerializedEvent | null>;
  /** Per-batch hook. Return null to drop entire batch. */
  beforeFlush?: (
    batch: SerializedEvent[],
  ) => SerializedEvent[] | null | Promise<SerializedEvent[] | null>;
  /** Custom transport for testing/mTLS/HTTP2 */
  transport?: CustomTransport;
  /** Offline persistent store */
  offlineStore?: OfflineStore;
  /** Max concurrent network promises. Default: 30 */
  maxConcurrentFlushes?: number;
  /** Shutdown timeout in ms. Default: 5000 */
  shutdownTimeout?: number;
}

// ─── Error types ───────────────────────────────────────────────────────────

export type SdkErrorKind =
  | 'AUTH_FAILURE'
  | 'RATE_LIMITED'
  | 'PARTIAL_ACCEPT'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'DROPPED_EVENTS'
  | 'TRANSPORT_ERROR';

export interface SdkError {
  kind: SdkErrorKind;
  message: string;
  statusCode?: number;
  retryAfterMs?: number;
  rejectedEventIds?: string[];
  error?: Error;
}

// ─── Rate limit types ──────────────────────────────────────────────────────

export interface RateLimit {
  category: string;
  scope: string;
  reason: string;
  expiresAt: number; // Date.now() ms
}
