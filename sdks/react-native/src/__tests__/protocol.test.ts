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
import { PartialAcceptError, sanitizeText } from '../wire';

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

  it('a flush of more than 500 events sends chunks of at most 500 with distinct batch ids and every event once', async () => {
    const calls = stubFetch([{ status: 202 }]);
    const tracker = new Tracker('dk_test', { persistQueue: false, flushAt: 5000, maxQueueSize: 5000 });
    for (let i = 0; i < 1200; i++) tracker.track(event);
    await tracker.flush();

    const bodies = calls.map((call) => JSON.parse(call.init.body as string));
    expect(bodies.map((body) => body.events.length)).toEqual([500, 500, 200]);
    expect(new Set(bodies.map((body) => body.batch_id)).size).toBe(3);
    const eventIds = bodies.flatMap((body) => body.events.map((e: { event_id: string }) => e.event_id));
    expect(new Set(eventIds).size).toBe(1200);
  });

  it('a 5xx on a later chunk requeues that chunk and every chunk after it, and sends nothing more', async () => {
    const calls = stubFetch([{ status: 202 }, { status: 503 }]);
    const onError = vi.fn();
    const tracker = new Tracker('dk_test', {
      persistQueue: false,
      flushAt: 5000,
      maxQueueSize: 5000,
      onError,
      retryCount: 0,
    });
    for (let i = 0; i < 1200; i++) tracker.track(event);
    await tracker.flush();

    expect(calls).toHaveLength(2);
    expect(onError).toHaveBeenCalledTimes(1);

    const secondChunk = JSON.parse(calls[1]!.init.body as string).events.map(
      (e: { event_id: string }) => e.event_id,
    );
    const retry = stubFetch([{ status: 202 }]);
    await tracker.flush();
    const resent = retry.flatMap((call) =>
      JSON.parse(call.init.body as string).events.map((e: { event_id: string }) => e.event_id),
    );

    expect(resent).toHaveLength(700);
    expect(resent.slice(0, 500)).toEqual(secondChunk);
  });

  it('a requeue never grows the queue past maxQueueSize', async () => {
    stubFetch([{ status: 503 }]);
    const tracker = new Tracker('dk_test', {
      persistQueue: false,
      flushAt: 5000,
      maxQueueSize: 600,
      flushIntervalMs: 60_000,
      retryCount: 0,
    });
    for (let i = 0; i < 600; i++) tracker.track(event);
    const flushing = tracker.flush();
    for (let i = 0; i < 300; i++) tracker.track(event);
    await flushing;

    expect((tracker as unknown as { queue: unknown[] }).queue.length).toBeLessThanOrEqual(600);
  });

  it('an event that cannot be serialized is reported and dropped instead of being requeued forever', async () => {
    const calls = stubFetch([{ status: 202 }]);
    const onError = vi.fn();
    const tracker = new Tracker('dk_test', { persistQueue: false, flushIntervalMs: 60_000, onError, retryCount: 0 });
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    tracker.track({ ...event, attribution: circular });
    await tracker.flush();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(0);
    expect((tracker as unknown as { queue: unknown[] }).queue).toHaveLength(0);
  });

  it('a transient failure holds count-triggered flushes until the next interval', async () => {
    const calls = stubFetch([{ status: 503 }]);
    const tracker = new Tracker('dk_test', {
      persistQueue: false,
      flushAt: 2,
      flushIntervalMs: 60_000,
      retryCount: 0,
    });
    tracker.track(event);
    tracker.track(event);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).toHaveLength(1);

    tracker.track(event);
    tracker.track(event);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(calls).toHaveLength(1);
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

  it('a 429 with Retry-After waits at least that long and retries the same batch', async () => {
    const calls = stubFetch([{ status: 429, headers: { 'Retry-After': '1' } }, { status: 202 }]);
    const tracker = new Tracker('dk_test', { persistQueue: false, retryCount: 1 });
    tracker.track(event);
    const started = Date.now();
    await tracker.flush();


    expect(calls).toHaveLength(2);
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
    const first = JSON.parse(calls[0]!.init.body as string);
    const second = JSON.parse(calls[1]!.init.body as string);
    expect(second.batch_id).toBe(first.batch_id);
  });

  it('a 503 in-flight response with Retry-After waits at least that long and retries the same batch', async () => {
    const calls = stubFetch([{ status: 503, headers: { 'Retry-After': '1' } }, { status: 202 }]);
    const tracker = new Tracker('dk_test', { persistQueue: false, retryCount: 1 });
    tracker.track(event);
    const started = Date.now();
    await tracker.flush();


    expect(calls).toHaveLength(2);
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
    const first = JSON.parse(calls[0]!.init.body as string);
    const second = JSON.parse(calls[1]!.init.body as string);
    expect(second.batch_id).toBe(first.batch_id);
  });

  it('a throwing onError handler never causes a resend of a recorded 207 batch', async () => {
    const calls = stubFetch([
      { status: 207, body: { accepted: 0, rejected: 1, batch_id: 'b', rejections: [{ event_id: 'e1', reason: 'bad' }] } },
    ]);
    const tracker = new Tracker('dk_test', {
      persistQueue: false,
      retryCount: 2,
      onError: () => {
        throw new Error('handler failure');
      },
    });
    tracker.track(event);
    await tracker.flush();

    expect(calls).toHaveLength(1);
  });

  it('a malformed 207 body is reported and not resent', async () => {
    const calls = stubFetch([{ status: 207, body: { accepted: 'abc', rejections: [1, 'x', { event_id: 5 }] } }]);
    const onError = vi.fn();
    const tracker = new Tracker('dk_test', { persistQueue: false, onError, retryCount: 2 });
    tracker.track(event);
    await tracker.flush();

    expect(calls).toHaveLength(1);
    expect(onError.mock.calls[0]![0]).toBeInstanceOf(PartialAcceptError);
  });
});

describe('sanitizeText', () => {
  it('strips C0 and C1 control characters and truncates', () => {
    const cleaned = sanitizeText(`line1\nline2\u001b[31m\u009b31m${'x'.repeat(2000)}`);
    expect(cleaned).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
    expect(cleaned.length).toBeLessThanOrEqual(520);
  });
});
