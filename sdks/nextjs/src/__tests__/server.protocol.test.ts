import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServerTracker } from '../server';
import { PartialAcceptError } from '../wire';

function stubFetch(responses: Array<{ status: number; body?: unknown; headers?: Record<string, string> }>) {
  const calls: Array<{ init: RequestInit }> = [];
  let i = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      calls.push({ init });
      const r = responses[Math.min(i++, responses.length - 1)]!;
      return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status, headers: r.headers });
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

describe('Next.js server wire protocol', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('202 sends the batch envelope', async () => {
    const calls = stubFetch([{ status: 202 }]);
    await new ServerTracker('dk_test').track(event);

    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body.batch_id).toBeTruthy();
    expect(body.sdk_version).toBeTruthy();
    expect(body.events[0].measurements[0].metric_tuple_hint).toEqual(event.metricTupleHint);
    expect(body.events[0].occurred_at).toBeTruthy();
  });

  it('retries reuse the same batch id and event ids', async () => {
    const calls = stubFetch([{ status: 503 }, { status: 202 }]);
    await new ServerTracker('dk_test', { retryCount: 2 }).trackBatch([event, event]);

    const bodies = calls.map((c) => JSON.parse(c.init.body as string));
    expect(bodies).toHaveLength(2);
    expect(bodies[1].batch_id).toBe(bodies[0].batch_id);
    expect(bodies[1].events.map((e: { event_id: string }) => e.event_id)).toEqual(
      bodies[0].events.map((e: { event_id: string }) => e.event_id),
    );
  });

  it('207 reports each rejection through onError without throwing or retrying', async () => {
    const calls = stubFetch([
      {
        status: 207,
        body: { accepted: 0, rejected: 1, batch_id: 'b', rejections: [{ event_id: 'e1', reason: 'bad' }] },
      },
    ]);
    const onError = vi.fn();

    await new ServerTracker('dk_test', { retryCount: 2, onError }).track(event);

    expect(calls).toHaveLength(1);
    const error = onError.mock.calls[0]![0] as PartialAcceptError;
    expect(error).toBeInstanceOf(PartialAcceptError);
    expect(error.rejections).toEqual([{ event_id: 'e1', reason: 'bad' }]);
  });

  it('a 429 with Retry-After waits at least that long and retries the same batch', async () => {
    const calls = stubFetch([{ status: 429, headers: { 'Retry-After': '1' } }, { status: 202 }]);
    const started = Date.now();

    await new ServerTracker('dk_test', { retryCount: 1 }).track(event);

    expect(calls).toHaveLength(2);
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
    const first = JSON.parse(calls[0]!.init.body as string);
    const second = JSON.parse(calls[1]!.init.body as string);
    expect(second.batch_id).toBe(first.batch_id);
  });

  it('a permanent 400 is reported by throwing once and never retried', async () => {
    const calls = stubFetch([{ status: 400, body: { message: 'bad' } }]);

    await expect(new ServerTracker('dk_test', { retryCount: 3 }).track(event)).rejects.toThrow('HTTP 400');
    expect(calls).toHaveLength(1);
  });

  it('a throwing onError handler never causes a resend of a recorded 207 batch', async () => {
    const calls = stubFetch([
      { status: 207, body: { accepted: 0, rejected: 1, batch_id: 'b', rejections: [{ event_id: 'e1', reason: 'bad' }] } },
    ]);
    const tracker = new ServerTracker('dk_test', {
      retryCount: 2,
      onError: () => {
        throw new Error('handler failure');
      },
    });

    await expect(tracker.track(event)).resolves.toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it('a malformed 207 body is reported and not resent', async () => {
    const calls = stubFetch([{ status: 207, body: { accepted: 'abc', rejections: [1, 'x', { event_id: 5 }] } }]);
    const onError = vi.fn();

    await new ServerTracker('dk_test', { retryCount: 2, onError }).track(event);

    expect(calls).toHaveLength(1);
    expect(onError.mock.calls[0]![0]).toBeInstanceOf(PartialAcceptError);
  });
});
