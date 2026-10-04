import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientTracker as Tracker } from '../client-tracker';
import { PartialAcceptError, MAX_RETRY_AFTER_MS, parseRetryAfterMs, sanitizeText } from '../wire';

interface Call {
  url: string;
  init: RequestInit;
}

function stubFetch(responses: Array<{ status: number; body?: unknown; headers?: Record<string, string> }>): Call[] {
  const calls: Call[] = [];
  let i = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
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

  it('a 429 with Retry-After waits at least that long and retries the same batch', async () => {
    const calls = stubFetch([{ status: 429, headers: { 'Retry-After': '1' } }, { status: 202 }]);
    const tracker = new Tracker('dk_test', { flushIntervalMs: 60_000, retryCount: 1 });
    tracker.track(event);
    const started = Date.now();
    await tracker.flush();
    tracker.destroy();

    expect(calls).toHaveLength(2);
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
    const first = JSON.parse(calls[0]!.init.body as string);
    const second = JSON.parse(calls[1]!.init.body as string);
    expect(second.batch_id).toBe(first.batch_id);
  });

  it('a 503 in-flight response with Retry-After waits at least that long and retries the same batch', async () => {
    const calls = stubFetch([{ status: 503, headers: { 'Retry-After': '1' } }, { status: 202 }]);
    const tracker = new Tracker('dk_test', { flushIntervalMs: 60_000, retryCount: 1 });
    tracker.track(event);
    const started = Date.now();
    await tracker.flush();
    tracker.destroy();

    expect(calls).toHaveLength(2);
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
    const first = JSON.parse(calls[0]!.init.body as string);
    const second = JSON.parse(calls[1]!.init.body as string);
    expect(second.batch_id).toBe(first.batch_id);
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

});

describe('Next.js client lifecycle', () => {
  let win: EventTarget;
  let doc: EventTarget & { visibilityState: string };

  beforeEach(() => {
    win = new EventTarget();
    doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    vi.stubGlobal('window', win);
    vi.stubGlobal('document', doc);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const unloadTracker = (options = {}) =>
    new Tracker('dk_test', { flushIntervalMs: 60_000, flushAt: 100_000, ...options });

  it('beforeunload sends an authenticated keepalive request with the batch envelope', () => {
    const calls = stubFetch([{ status: 202 }]);
    const tracker = unloadTracker();
    tracker.track(event);
    win.dispatchEvent(new Event('beforeunload'));

    expect(calls).toHaveLength(1);
    const init = calls[0]!.init;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer dk_test');
    expect(init.keepalive).toBe(true);
    expect(JSON.parse(init.body as string).batch_id).toBeTruthy();
  });

  it('visibilitychange sends only when the page becomes hidden', () => {
    const calls = stubFetch([{ status: 202 }]);
    const tracker = unloadTracker();
    tracker.track(event);
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(calls).toHaveLength(0);

    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(calls).toHaveLength(1);
  });

  it('keeps the unload body within the byte quota even for multibyte text', () => {
    const calls = stubFetch([{ status: 202 }]);
    const tracker = unloadTracker();
    for (let i = 0; i < 1500; i++) tracker.track({ ...event, metric: 'métrique_é_日本語' });
    win.dispatchEvent(new Event('beforeunload'));

    const body = calls[0]!.init.body as string;
    expect(new TextEncoder().encode(body).length).toBeLessThanOrEqual(60_000);
  });

  it('requeues the chunk when the unload request fails transiently', async () => {
    const calls = stubFetch([{ status: 503 }, { status: 202 }]);
    const onError = vi.fn();
    const tracker = unloadTracker({ onError });
    tracker.track(event);
    win.dispatchEvent(new Event('beforeunload'));
    await new Promise((r) => setTimeout(r, 20));
    expect(onError).toHaveBeenCalledTimes(1);

    win.dispatchEvent(new Event('beforeunload'));
    expect(calls).toHaveLength(2);
    const first = JSON.parse(calls[0]!.init.body as string);
    const second = JSON.parse(calls[1]!.init.body as string);
    expect(second.events[0].event_id).toBe(first.events[0].event_id);
  });

  it('reports a 207 on the unload path without requeueing', async () => {
    const calls = stubFetch([
      { status: 207, body: { accepted: 0, rejected: 1, batch_id: 'b', rejections: [{ event_id: 'e1', reason: 'bad' }] } },
    ]);
    const onError = vi.fn();
    const tracker = unloadTracker({ onError });
    tracker.track(event);
    win.dispatchEvent(new Event('beforeunload'));
    await new Promise((r) => setTimeout(r, 20));
    win.dispatchEvent(new Event('beforeunload'));

    expect(calls).toHaveLength(1);
    expect(onError.mock.calls[0]![0]).toBeInstanceOf(PartialAcceptError);
  });

  it('destroy sends every queued event, not only the first keepalive chunk, and removes the listeners', async () => {
    const calls = stubFetch([{ status: 202 }]);
    const tracker = unloadTracker({ disableCompression: true });
    for (let i = 0; i < 1200; i++) tracker.track(event);
    tracker.destroy();
    await new Promise((r) => setTimeout(r, 50));

    const sent = calls.reduce(
      (n, c) => n + (JSON.parse(c.init.body as string).events as unknown[]).length,
      0,
    );
    expect(sent).toBe(1200);
    expect(calls.every((c) => c.init.keepalive !== true)).toBe(true);

    const before = calls.length;
    win.dispatchEvent(new Event('beforeunload'));
    expect(calls).toHaveLength(before);
  });

  it('a throwing onError handler never causes a resend of a recorded 207 batch', async () => {
    const calls = stubFetch([
      { status: 207, body: { accepted: 0, rejected: 1, batch_id: 'b', rejections: [{ event_id: 'e1', reason: 'bad' }] } },
    ]);
    const tracker = unloadTracker({
      retryCount: 2,
      onError: () => {
        throw new Error('handler failure');
      },
    });
    tracker.track(event);
    await tracker.flush();

    expect(calls).toHaveLength(1);
  });

  it('a permanent 4xx is reported once and not retried', async () => {
    const calls = stubFetch([{ status: 400, body: { message: 'bad' } }]);
    const onError = vi.fn();
    const tracker = unloadTracker({ onError, retryCount: 3 });
    tracker.track(event);
    await tracker.flush();

    expect(calls).toHaveLength(1);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('a malformed 207 body is reported and not resent', async () => {
    const calls = stubFetch([{ status: 207, body: { accepted: 'abc', rejected: null, rejections: [1, 'x', { event_id: 5 }] } }]);
    const onError = vi.fn();
    const tracker = unloadTracker({ onError, retryCount: 2 });
    tracker.track(event);
    await tracker.flush();

    expect(calls).toHaveLength(1);
    expect(onError.mock.calls[0]![0]).toBeInstanceOf(PartialAcceptError);
  });
});

describe('parseRetryAfterMs', () => {
  it('clamps large values, handles dates, and ignores garbage', () => {
    expect(parseRetryAfterMs('2')).toBe(2000);
    expect(parseRetryAfterMs('86400')).toBe(MAX_RETRY_AFTER_MS);
    expect(parseRetryAfterMs(new Date(Date.now() + 5000).toUTCString())).toBeGreaterThan(0);
    expect(parseRetryAfterMs('garbage')).toBeUndefined();
    expect(parseRetryAfterMs(null)).toBeUndefined();
  });
});

describe('sanitizeText', () => {
  it('strips C0 and C1 control characters and truncates', () => {
    const cleaned = sanitizeText(`line1\nline2\u001b[31m\u009b31m${'x'.repeat(2000)}`);
    expect(cleaned).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
    expect(cleaned.length).toBeLessThanOrEqual(520);
  });
});
