import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientTracker as Tracker } from '../client-tracker';
import { PartialAcceptError } from '../wire';

interface Call {
  url: string;
  init: RequestInit;
}

function stubFetch(responses: Array<{ status: number; body?: unknown }>): Call[] {
  const calls: Call[] = [];
  let i = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const r = responses[Math.min(i++, responses.length - 1)]!;
      return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status });
    }),
  );
  return calls;
}

const event = {
  metric: 'api_calls',
  quantity: 1,
  licenseId: 'lic_1',
  metricTupleHint: { app_name: 'app', license_name: 'lic', metric_name: 'calls' },
};

describe('Next.js client wire protocol', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('202 sends the batch envelope with an object tuple hint', async () => {
    const calls = stubFetch([{ status: 202, body: { accepted: 1, rejected: 0 } }]);
    const onError = vi.fn();
    const tracker = new Tracker('dk_test', { flushIntervalMs: 60_000, onError });
    tracker.track(event);
    await tracker.flush();
    tracker.destroy();

    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body.batch_id).toBeTruthy();
    expect(body.sdk_version).toBeTruthy();
    expect(body.events[0]).toMatchObject({
      license_id: 'lic_1',
      source_system: 'sdk',
      measurements: [{ metric_name: 'api_calls', quantity: 1, metric_tuple_hint: event.metricTupleHint }],
    });
    expect(body.events[0].event_id).toBeTruthy();
    expect(body.events[0].occurred_at).toBeTruthy();
    expect(onError).not.toHaveBeenCalled();
  });

  it('207 reports every rejection and does not retry', async () => {
    const calls = stubFetch([
      {
        status: 207,
        body: { accepted: 1, rejected: 1, batch_id: 'b', rejections: [{ event_id: 'e2', reason: 'bad' }] },
      },
    ]);
    const onError = vi.fn();
    const tracker = new Tracker('dk_test', { flushIntervalMs: 60_000, onError, retryCount: 2 });
    tracker.track(event);
    await tracker.flush();
    tracker.destroy();

    expect(calls).toHaveLength(1);
    const error = onError.mock.calls[0]![0] as PartialAcceptError;
    expect(error).toBeInstanceOf(PartialAcceptError);
    expect(error.rejections).toEqual([{ event_id: 'e2', reason: 'bad' }]);
  });

  it('a retry reuses the batch id and event ids', async () => {
    const calls = stubFetch([{ status: 503 }, { status: 202 }]);
    const onError = vi.fn();
    const tracker = new Tracker('dk_test', { flushIntervalMs: 60_000, onError, retryCount: 1 });
    tracker.track(event);
    await tracker.flush();
    tracker.destroy();

    expect(calls).toHaveLength(2);
    const first = JSON.parse(calls[0]!.init.body as string);
    const second = JSON.parse(calls[1]!.init.body as string);
    expect(second.batch_id).toBe(first.batch_id);
    expect(second.events[0].event_id).toBe(first.events[0].event_id);
    expect(onError).not.toHaveBeenCalled();
  });

  it('exhausted 5xx retries reach onError', async () => {
    stubFetch([{ status: 503 }]);
    const onError = vi.fn();
    const tracker = new Tracker('dk_test', { flushIntervalMs: 60_000, onError, retryCount: 1 });
    tracker.track(event);
    await tracker.flush();
    tracker.destroy();

    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('unload delivery carries the Bearer header and the batch envelope', () => {
    const calls = stubFetch([{ status: 202 }]);
    const tracker = new Tracker('dk_test', { flushIntervalMs: 60_000 });
    tracker.track(event);
    tracker.destroy();

    const init = calls[0]!.init;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer dk_test');
    expect(init.keepalive).toBe(true);
    expect(JSON.parse(init.body as string).batch_id).toBeTruthy();
  });
});
