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

export async function readPartialAccept(response: Response, batchId: string): Promise<PartialAcceptError> {
  let data: { accepted?: number; rejected?: number; batch_id?: string; rejections?: EventRejection[] } = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  return new PartialAcceptError(
    Number(data.accepted) || 0,
    Number(data.rejected) || 0,
    data.batch_id ?? batchId,
    Array.isArray(data.rejections) ? data.rejections : [],
  );
}
