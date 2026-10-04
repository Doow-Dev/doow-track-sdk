import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  AppState: { addEventListener: () => ({ remove: () => {} }) },
}));
vi.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    default: {
      getItem: async (k: string) => store.get(k) ?? null,
      setItem: async (k: string, v: string) => {
        store.set(k, v);
      },
    },
  };
});

import { Tracker } from '../tracker';
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

describe('React Native wire protocol', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('202 sends the batch envelope with an object tuple hint', async () => {
    const calls = stubFetch([{ status: 202 }]);
    const tracker = new Tracker('dk_test', { persistQueue: false });
    tracker.track(event);
    await tracker.flush();

    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body.batch_id).toBeTruthy();
    expect(body.sdk_version).toBeTruthy();
    expect(body.events[0].event_id).toBeTruthy();
    expect(body.events[0].occurred_at).toBeTruthy();
    expect(body.events[0].source_system).toBe('sdk');
    expect(body.events[0].measurements[0].metric_tuple_hint).toEqual(event.metricTupleHint);
  });

  it('207 reports each rejection, does not retry, and does not requeue', async () => {
    const calls = stubFetch([
      {
        status: 207,
        body: { accepted: 0, rejected: 1, batch_id: 'b', rejections: [{ event_id: 'e1', reason: 'bad' }] },
      },
    ]);
    const onError = vi.fn();
    const tracker = new Tracker('dk_test', { persistQueue: false, onError, retryCount: 2 });
    tracker.track(event);
    await tracker.flush();
    await tracker.flush();

    expect(calls).toHaveLength(1);
    const error = onError.mock.calls[0]![0] as PartialAcceptError;
    expect(error).toBeInstanceOf(PartialAcceptError);
    expect(error.rejections).toEqual([{ event_id: 'e1', reason: 'bad' }]);
  });

  it('a 5xx outage requeues the same events with stable event ids', async () => {
    const calls = stubFetch([{ status: 503 }, { status: 503 }, { status: 202 }]);
    const onError = vi.fn();
    const tracker = new Tracker('dk_test', { persistQueue: false, onError, retryCount: 1 });
    tracker.track(event);
    await tracker.flush();
    await tracker.flush();

    expect(onError).toHaveBeenCalledTimes(1);
    const first = JSON.parse(calls[0]!.init.body as string);
    const last = JSON.parse(calls[2]!.init.body as string);
    expect(last.events[0].event_id).toBe(first.events[0].event_id);
  });

  it('a permanent 4xx is reported and dropped instead of looping', async () => {
    const calls = stubFetch([{ status: 400, body: { message: 'bad' } }]);
    const onError = vi.fn();
    const tracker = new Tracker('dk_test', { persistQueue: false, onError, retryCount: 1 });
    tracker.track(event);
    await tracker.flush();
    await tracker.flush();

    expect(calls).toHaveLength(1);
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
