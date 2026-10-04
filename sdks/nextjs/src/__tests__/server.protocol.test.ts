import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServerTracker } from '../server';
import { PartialAcceptError } from '../wire';

function stubFetch(responses: Array<{ status: number; body?: unknown }>) {
  const calls: Array<{ init: RequestInit }> = [];
  let i = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      calls.push({ init });
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

  it('207 throws a PartialAcceptError listing each rejection without retrying', async () => {
    const calls = stubFetch([
      {
        status: 207,
        body: { accepted: 0, rejected: 1, batch_id: 'b', rejections: [{ event_id: 'e1', reason: 'bad' }] },
      },
    ]);

    await expect(new ServerTracker('dk_test', { retryCount: 2 }).track(event)).rejects.toMatchObject({
      name: 'PartialAcceptError',
      rejections: [{ event_id: 'e1', reason: 'bad' }],
    });
    expect(calls).toHaveLength(1);
    expect(PartialAcceptError).toBeDefined();
  });
});
