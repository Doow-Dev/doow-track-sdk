import type { MetricTupleHint, TrackEvent } from './types';

export const SDK_VERSION = '0.1.0';

export interface QueuedEvent extends TrackEvent {
  eventId: string;
  timestamp: string;
}

export interface EventRejection {
  event_id: string;
  reason: string;
}

export class PartialAcceptError extends Error {
  readonly accepted: number;
  readonly rejected: number;
  readonly batchId: string;
  readonly rejections: EventRejection[];

  constructor(accepted: number, rejected: number, batchId: string, rejections: EventRejection[]) {
    const first = rejections[0];
    super(
      `Batch ${batchId} partially accepted: ${rejected} rejected` +
        (first ? ` (${first.event_id}: ${first.reason})` : ''),
    );
    this.name = 'PartialAcceptError';
    this.accepted = accepted;
    this.rejected = rejected;
    this.batchId = batchId;
    this.rejections = rejections;
  }
}

export class NonRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NonRetryableError';
  }
}

export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export interface WireBatch {
  batch_id: string;
  sdk_version: string;
  events: Array<{
    event_id: string;
    license_id: string;
    occurred_at: string;
    source_system: string;
    unit?: string;
    attribution?: Record<string, unknown>;
    measurements: Array<{
      metric_name: string;
      quantity: number;
      metric_tuple_hint?: MetricTupleHint;
    }>;
  }>;
}

export function toWireBatch(batchId: string, events: QueuedEvent[]): WireBatch {
  return {
    batch_id: batchId,
    sdk_version: SDK_VERSION,
    events: events.map((e) => ({
      event_id: e.eventId,
      license_id: e.licenseId,
      occurred_at: e.timestamp,
      source_system: e.sourceSystem?.trim() ? e.sourceSystem : 'sdk',
      ...(e.unit ? { unit: e.unit } : {}),
      ...(e.attribution ? { attribution: e.attribution } : {}),
      measurements: [
        {
          metric_name: e.metric,
          quantity: e.quantity,
          ...(e.metricTupleHint ? { metric_tuple_hint: e.metricTupleHint } : {}),
        },
      ],
    })),
  };
}

const MAX_ERROR_TEXT = 512;
const MAX_BODY_CHARS = 64 * 1024;

export function sanitizeText(value: unknown): string {
  // eslint-disable-next-line no-control-regex
  const text = String(value).replace(
    /[\u0000-\u001f\u007f-\u009f\u{61c}\u{200e}\u{200f}\u{2028}\u{2029}\u{202a}-\u{202e}\u{2066}-\u{2069}]/gu,
    ' ',
  );
  return text.length > MAX_ERROR_TEXT ? `${text.slice(0, MAX_ERROR_TEXT)}...` : text;
}

export async function readBoundedText(response: Response): Promise<string> {
  try {
    const reader = response.body?.getReader();
    if (!reader || typeof TextDecoder === 'undefined') {
      return (await response.text()).slice(0, MAX_BODY_CHARS);
    }
    const decoder = new TextDecoder();
    let text = '';
    while (text.length < MAX_BODY_CHARS) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    await reader.cancel().catch(() => undefined);
    return text.slice(0, MAX_BODY_CHARS);
  } catch {
    return '';
  }
}

export function notify(handler: ((error: Error) => void) | undefined, error: Error): void {
  if (!handler) return;
  try {
    handler(error);
  } catch {
    // A throwing handler must never trigger a resend or crash the host app.
  }
}

function toCount(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

export async function readPartialAccept(response: Response, batchId: string): Promise<PartialAcceptError> {
  let data: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(await readBoundedText(response));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      data = parsed as Record<string, unknown>;
    }
  } catch {
    data = {};
  }
  const rejections: EventRejection[] = (Array.isArray(data.rejections) ? data.rejections : [])
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .map((r) => ({ event_id: sanitizeText(r.event_id ?? 'unknown'), reason: sanitizeText(r.reason ?? '') }));
  return new PartialAcceptError(
    toCount(data.accepted),
    toCount(data.rejected),
    sanitizeText(data.batch_id ?? batchId),
    rejections,
  );
}

export const MAX_RETRY_AFTER_MS = 30_000;

export function isTransientStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export function parseRetryAfterMs(header: string | null | undefined): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now();
  if (!Number.isFinite(ms)) return undefined;
  return Math.min(Math.max(ms, 0), MAX_RETRY_AFTER_MS);
}
