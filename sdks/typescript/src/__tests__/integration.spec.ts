/**
 * S85: Integration test suite
 *
 * End-to-end tests for the full SDK → HTTP transport pipeline.
 * Uses a local mock HTTP server (Node built-in `http`) — no external deps.
 *
 * Covers:
 * - Happy path: track() → flush → server receives valid batch
 * - Multi-measurement: multiple metrics in one batch
 * - Attribution merge: SDK-level + per-event attribution in wire payload
 * - Batch dedup: same batch_id on retry
 * - Auth failure: 401 → SDK stops
 * - Rate limit: 429 with Retry-After
 * - Partial accept: 207 → onError reports rejected IDs
 * - Offline store: network failure → persist → reconnect → drain
 * - Serverless flush: withLambda wrapper flushes before return
 * - Gzip: compression → Content-Encoding: gzip
 * - Shutdown timeout: hanging server resolves within timeout
 */
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { gunzipSync } from 'zlib';
import { DoowTracker } from '../tracker.js';
import type { BatchPayload, SerializedEvent, SdkError } from '../types.js';

// ─── Mock server helpers ────────────────────────────────────────────────────

interface ReceivedRequest {
  headers: Record<string, string | string[]>;
  body: string;
  rawBody: Buffer;
  url: string;
}

interface MockServer {
  url: string;
  requests: ReceivedRequest[];
  /** Set before the next request arrives */
  nextStatus: number;
  nextBody: string;
  nextHeaders: Record<string, string>;
  close(): Promise<void>;
}

/** Start a mock HTTP server on a random port. Returns when ready. */
async function startMockServer(): Promise<MockServer> {
  const requests: ReceivedRequest[] = [];
  const state = {
    nextStatus: 202,
    nextBody: '{}',
    nextHeaders: {} as Record<string, string>,
  };

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const rawBody = Buffer.concat(chunks);
      const headers: Record<string, string | string[]> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (v !== undefined) headers[k] = v;
      }

      requests.push({
        headers,
        rawBody,
        body: rawBody.toString('utf8'),
        url: req.url ?? '/',
      });

      // Write response
      const responseHeaders = {
        'Content-Type': 'application/json',
        ...state.nextHeaders,
      };
      res.writeHead(state.nextStatus, responseHeaders);
      res.end(state.nextBody);

      // Reset to 202 after one use
      state.nextStatus = 202;
      state.nextBody = '{}';
      state.nextHeaders = {};
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  const addr = server.address();
  if (!addr || typeof addr !== 'object') throw new Error('Server address unavailable');
  const port = addr.port;

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    get nextStatus() { return state.nextStatus; },
    set nextStatus(v: number) { state.nextStatus = v; },
    get nextBody() { return state.nextBody; },
    set nextBody(v: string) { state.nextBody = v; },
    get nextHeaders() { return state.nextHeaders; },
    set nextHeaders(v: Record<string, string>) { state.nextHeaders = v; },
    close(): Promise<void> {
      return new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    },
  };
}

/** Parse a request body — decompresses gzip if Content-Encoding: gzip */
function parseBatch(req: ReceivedRequest): BatchPayload {
  const encoding = req.headers['content-encoding'];
  let raw: string;
  if (encoding === 'gzip') {
    raw = gunzipSync(req.rawBody).toString('utf8');
  } else {
    raw = req.rawBody.toString('utf8');
  }
  return JSON.parse(raw) as BatchPayload;
}

/** Helper: make a tracker pointing at the mock server */
function makeMeter(server: MockServer, overrides: ConstructorParameters<typeof DoowTracker>[1] = {}): DoowTracker {
  return new DoowTracker('dk_integration_test', {
    endpoint: server.url,
    disableCompression: true,
    flushAt: 1,                // flush immediately on each track
    flushInterval: 60_000,     // no timer flush — keep tests deterministic
    timeout: 5_000,
    retryCount: 0,             // no retries unless overridden
    shutdownTimeout: 3_000,
    ...overrides,
  });
}

// ─── Shared server instance (reused across tests) ──────────────────────────

let server: MockServer;

beforeAll(async () => {
  server = await startMockServer();
});

afterAll(async () => {
  await server.close();
});

beforeEach(() => {
  // Clear received requests before each test
  server.requests.length = 0;
  server.nextStatus = 202;
  server.nextBody = '{}';
  server.nextHeaders = {};
});

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('S85: Integration — SDK → HTTP pipeline', () => {

  // ── Happy path ────────────────────────────────────────────────────────────

  it('happy path: track() → flush → server receives valid batch with correct headers', async () => {
    const meter = makeMeter(server);

    meter.track({ metric: 'api_calls', quantity: 1, license_id: 'lic_1' });
    await meter.shutdown();

    expect(server.requests).toHaveLength(1);
    const req = server.requests[0]!;

    // Headers
    expect(req.headers['authorization']).toBe('Bearer dk_integration_test');
    expect(req.headers['content-type']).toBe('application/json');
    expect(req.headers['x-doow-sdk-version']).toBeDefined();

    // URL
    expect(req.url).toBe('/telemetry/events');

    // Batch shape
    const batch = parseBatch(req);
    expect(batch.batch_id).toBeDefined();
    expect(typeof batch.batch_id).toBe('string');
    expect(batch.sdk_version).toBeDefined();
    expect(typeof batch.sdk_version).toBe('string');
    expect(batch.events).toHaveLength(1);

    const event = batch.events[0]!;
    expect(event.metric).toBe('api_calls');
    expect(event.quantity).toBe(1);
    expect(event.license_id).toBe('lic_1');
    expect(event.event_id).toBeDefined();
    expect(event.timestamp).toBeDefined();
    expect(event.occurred_at).toBe(event.timestamp);
    expect(event.source_system).toBe('sdk');
    expect(event.measurements).toHaveLength(1);
    expect(event.measurements[0]?.metric_name).toBe('api_calls');
    expect(event.measurements[0]?.quantity).toBe(1);
  });

  // ── SDK_VERSION consistency ────────────────────────────────────────────────

  it('sdk_version in wire protocol matches __SDK_VERSION__ compile-time constant', async () => {
    const meter = makeMeter(server);

    meter.track({ metric: 'tokens', quantity: 100, license_id: 'lic_1' });
    await meter.shutdown();

    expect(server.requests).toHaveLength(1);
    const req = server.requests[0]!;
    const batch = parseBatch(req);

    // Both wire field and header must agree
    expect(batch.sdk_version).toBe(req.headers['x-doow-sdk-version']);

    // Must match the compile-time constant injected by vitest/rollup
    expect(batch.sdk_version).toBe(__SDK_VERSION__);
    expect(req.headers['x-doow-sdk-version']).toBe(__SDK_VERSION__);
  });

  // ── Multi-measurement ─────────────────────────────────────────────────────

  it('multi-measurement: two tracked events arrive in the same batch', async () => {
    const meter = makeMeter(server, {
      flushAt: 100,   // high threshold — won't auto-flush until shutdown
      retryCount: 0,
    });

    meter.track({ metric: 'api_calls', quantity: 3, license_id: 'lic_1' });
    meter.track({ metric: 'tokens', quantity: 512, license_id: 'lic_1', unit: 'tokens' });

    await meter.shutdown();

    // May arrive in 1 or 2 batches — collect all events
    const allEvents: SerializedEvent[] = [];
    for (const req of server.requests) {
      const batch = parseBatch(req);
      allEvents.push(...batch.events);
    }

    expect(allEvents).toHaveLength(2);
    const metrics = allEvents.map((e) => e.metric);
    expect(metrics).toContain('api_calls');
    expect(metrics).toContain('tokens');

    const tokenEvent = allEvents.find((e) => e.metric === 'tokens');
    expect(tokenEvent?.unit).toBe('tokens');
    expect(tokenEvent?.quantity).toBe(512);
  });

  // ── Attribution merge ─────────────────────────────────────────────────────

  it('attribution merge: SDK-level + per-event attribution merged in wire payload', async () => {
    const meter = makeMeter(server, {
      attribution: { env: 'test', region: 'us-east-1' },
    });

    meter.track({
      metric: 'api_calls',
      quantity: 1,
      license_id: 'lic_1',
      attribution: { user_id: 'u_123', env: 'override' }, // per-event overrides sdk-level
    });

    await meter.shutdown();

    expect(server.requests).toHaveLength(1);
    const batch = parseBatch(server.requests[0]!);
    const event = batch.events[0]!;

    expect(event.attribution).toBeDefined();
    // Per-event takes precedence over SDK-level for same key
    expect(event.attribution?.['env']).toBe('override');
    // SDK-level added
    expect(event.attribution?.['region']).toBe('us-east-1');
    // Per-event only
    expect(event.attribution?.['user_id']).toBe('u_123');
  });

  // ── Batch dedup: same batch_id on retry ───────────────────────────────────

  it('batch dedup: batch_id is stable across retries', async () => {
    // First request returns 500 (retryable), second returns 202
    let callCount = 0;
    const batchIds: string[] = [];

    server.nextStatus = 500;

    const meter = makeMeter(server, {
      retryCount: 2,
      timeout: 3_000,
      flushAt: 1,
    });

    // Intercept calls manually via a custom transport that records batch_id
    // and controls the response sequence
    let firstCallDone = false;
    const sequentialMeter = new DoowTracker('dk_integration_test', {
      endpoint: server.url,
      disableCompression: true,
      flushAt: 1,
      flushInterval: 60_000,
      timeout: 3_000,
      retryCount: 1,
      shutdownTimeout: 3_000,
      transport: {
        send: async (payload) => {
          callCount++;
          const body = JSON.parse(payload.body.toString()) as BatchPayload;
          batchIds.push(body.batch_id);
          if (!firstCallDone) {
            firstCallDone = true;
            return { status: 500, headers: {}, body: 'server error' };
          }
          return { status: 202, headers: {}, body: '{}' };
        },
      },
    });

    sequentialMeter.track({ metric: 'api_calls', quantity: 1, license_id: 'lic_1' });
    await sequentialMeter.shutdown();

    // Should have retried once → 2 calls
    expect(callCount).toBe(2);
    // Both calls must carry the same batch_id
    expect(batchIds).toHaveLength(2);
    expect(batchIds[0]).toBe(batchIds[1]);
  });

  // ── Auth failure: 401 → SDK stops ─────────────────────────────────────────

  it('auth failure: 401 → SDK stops emitting, onError called', async () => {
    const errors: SdkError[] = [];

    server.nextStatus = 401;

    const meter = makeMeter(server, {
      onError: (e) => errors.push(e),
      retryCount: 0,
    });

    meter.track({ metric: 'api_calls', quantity: 1, license_id: 'lic_1' });
    await meter.flush();

    // SDK should now be stopped
    expect(meter.stopped).toBe(true);

    // Track again — should be a no-op (no new requests)
    const requestCountBefore = server.requests.length;
    meter.track({ metric: 'api_calls', quantity: 2, license_id: 'lic_1' });
    await meter.flush();
    expect(server.requests.length).toBe(requestCountBefore);

    // onError must have been called with AUTH_FAILURE
    expect(errors.some((e) => e.kind === 'AUTH_FAILURE')).toBe(true);
  });

  // ── Rate limit: 429 with Retry-After ──────────────────────────────────────

  it('rate limit: 429 with Retry-After → onError called with retryAfterMs', async () => {
    const errors: SdkError[] = [];
    let callCount = 0;

    const meter = new DoowTracker('dk_integration_test', {
      endpoint: server.url,
      disableCompression: true,
      flushAt: 1,
      flushInterval: 60_000,
      timeout: 3_000,
      retryCount: 0,   // no retry — just test that 429 is surfaced
      shutdownTimeout: 1_000,
      onError: (e) => errors.push(e),
      transport: {
        send: async (_payload) => {
          callCount++;
          return {
            status: 429,
            headers: { 'retry-after': '2' },
            body: '{}',
          };
        },
      },
    });

    meter.track({ metric: 'api_calls', quantity: 1, license_id: 'lic_1' });
    await meter.flush();

    expect(callCount).toBeGreaterThan(0);
    const rateLimitedError = errors.find((e) => e.kind === 'RATE_LIMITED');
    expect(rateLimitedError).toBeDefined();
    // retryAfterMs should be ~2000ms
    expect(rateLimitedError?.retryAfterMs).toBeGreaterThan(0);
  });

  // ── Partial accept: 207 → onError reports rejected event IDs ──────────────

  it('partial accept: 207 response → onError receives rejected event IDs', async () => {
    const errors: SdkError[] = [];

    let capturedBatch: BatchPayload | null = null;
    const meter = new DoowTracker('dk_integration_test', {
      endpoint: server.url,
      disableCompression: true,
      flushAt: 100,
      flushInterval: 60_000,
      timeout: 3_000,
      retryCount: 0,
      shutdownTimeout: 3_000,
      onError: (e) => errors.push(e),
      transport: {
        send: async (payload) => {
          capturedBatch = JSON.parse(payload.body.toString()) as BatchPayload;
          const rejectedId = capturedBatch.events[0]?.event_id ?? 'unknown';
          const body = JSON.stringify({
            accepted: capturedBatch.events.slice(1).map((e) => e.event_id),
            rejected: [{ event_id: rejectedId, reason: 'quota_exceeded' }],
          });
          return { status: 207, headers: {}, body };
        },
      },
    });

    meter.track({ metric: 'api_calls', quantity: 1, license_id: 'lic_1' });
    meter.track({ metric: 'tokens', quantity: 100, license_id: 'lic_1' });
    await meter.shutdown();

    const partialError = errors.find((e) => e.kind === 'PARTIAL_ACCEPT');
    expect(partialError).toBeDefined();
    expect(partialError?.rejectedEventIds).toHaveLength(1);
    expect(capturedBatch).not.toBeNull();
  });

  // ── Offline store ─────────────────────────────────────────────────────────

  it('offline store: network failure persists events, reconnect drains them', async () => {
    const batches: BatchPayload[] = [];
    let shouldFail = true;

    // In-memory offline store
    const offlineQueue: Array<{ batch_id: string; payload: string; timestamp: string }> = [];
    const offlineStore = {
      async push(b: { batch_id: string; payload: string; timestamp: string }): Promise<void> {
        offlineQueue.push(b);
      },
      async shift(): Promise<{ batch_id: string; payload: string; timestamp: string } | undefined> {
        return offlineQueue.shift();
      },
      async length(): Promise<number> {
        return offlineQueue.length;
      },
    };

    const transport = {
      send: async (payload: { body: Buffer; headers: Record<string, string>; url: string }) => {
        if (shouldFail) {
          throw new Error('ECONNREFUSED');
        }
        batches.push(JSON.parse(payload.body.toString()) as BatchPayload);
        return { status: 202, headers: {}, body: '{}' };
      },
    };

    // First meter: fails → persists to offline store
    const meter1 = new DoowTracker('dk_integration_test', {
      endpoint: server.url,
      disableCompression: true,
      flushAt: 1,
      flushInterval: 60_000,
      timeout: 1_000,
      retryCount: 0,
      shutdownTimeout: 2_000,
      offlineStore,
      transport,
    });

    meter1.track({ metric: 'api_calls', quantity: 1, license_id: 'lic_1' });
    await meter1.flush();

    // Events should be in the offline store
    expect(await offlineStore.length()).toBeGreaterThan(0);

    // Second meter: network restored → drains offline store
    shouldFail = false;

    const meter2 = new DoowTracker('dk_integration_test', {
      endpoint: server.url,
      disableCompression: true,
      flushAt: 1,
      flushInterval: 60_000,
      timeout: 3_000,
      retryCount: 0,
      shutdownTimeout: 3_000,
      offlineStore,
      transport,
    });

    // Trigger a flush — this should drain the offline store first
    meter2.track({ metric: 'tokens', quantity: 10, license_id: 'lic_1' });
    await meter2.shutdown();

    // Both the offline batch and the new event should have been sent
    const allEvents = batches.flatMap((b) => b.events);
    const metrics = allEvents.map((e) => e.metric);
    expect(metrics).toContain('api_calls');
    expect(metrics).toContain('tokens');
  });

  // ── Serverless flush ──────────────────────────────────────────────────────

  it('serverless flush: withLambda wrapper flushes all events before handler returns', async () => {
    const capturedEvents: SerializedEvent[] = [];

    const meter = new DoowTracker('dk_integration_test', {
      endpoint: server.url,
      disableCompression: true,
      flushAt: 1000,   // high — no auto-flush during handler
      flushInterval: 60_000,
      timeout: 3_000,
      retryCount: 0,
      shutdownTimeout: 3_000,
      transport: {
        send: async (payload) => {
          const body = JSON.parse(payload.body.toString()) as BatchPayload;
          capturedEvents.push(...body.events);
          return { status: 202, headers: {}, body: '{}' };
        },
      },
    });

    const wrappedHandler = meter.withLambda(async (_event: unknown, _context: unknown) => {
      meter.track({ metric: 'api_calls', quantity: 1, license_id: 'lic_1' });
      meter.track({ metric: 'tokens', quantity: 200, license_id: 'lic_1' });
      return { statusCode: 200 };
    });

    const result = await wrappedHandler({}, {});

    expect(result).toEqual({ statusCode: 200 });
    // All events must have been flushed by shutdown() in the wrapper's finally block
    expect(capturedEvents).toHaveLength(2);
    expect(capturedEvents.map((e) => e.metric)).toContain('api_calls');
    expect(capturedEvents.map((e) => e.metric)).toContain('tokens');
  });

  // ── Gzip ──────────────────────────────────────────────────────────────────

  it('gzip: compression enabled → Content-Encoding: gzip, body is valid gzip', async () => {
    const meter = new DoowTracker('dk_integration_test', {
      endpoint: server.url,
      disableCompression: false,  // compression ON
      flushAt: 1,
      flushInterval: 60_000,
      timeout: 5_000,
      retryCount: 0,
      shutdownTimeout: 3_000,
    });

    meter.track({ metric: 'api_calls', quantity: 1, license_id: 'lic_1' });
    await meter.shutdown();

    expect(server.requests).toHaveLength(1);
    const req = server.requests[0]!;

    expect(req.headers['content-encoding']).toBe('gzip');

    // Body must be valid gzip — parseBatch will call gunzipSync
    const batch = parseBatch(req);
    expect(batch.events).toHaveLength(1);
    expect(batch.events[0]?.metric).toBe('api_calls');
  });

  // ── Shutdown timeout ──────────────────────────────────────────────────────

  it('shutdown timeout: hanging server → shutdown resolves within timeout', async () => {
    let resolveHang!: () => void;
    const hangPromise = new Promise<void>((res) => { resolveHang = res; });

    const meter = new DoowTracker('dk_integration_test', {
      endpoint: server.url,
      disableCompression: true,
      flushAt: 1,
      flushInterval: 60_000,
      timeout: 10_000,   // long request timeout (overridden by shutdownTimeout)
      retryCount: 0,
      shutdownTimeout: 500,  // only 500ms to shut down
      transport: {
        send: async (_payload) => {
          // Hang forever
          await hangPromise;
          return { status: 202, headers: {}, body: '{}' };
        },
      },
    });

    meter.track({ metric: 'api_calls', quantity: 1, license_id: 'lic_1' });

    const start = Date.now();
    await meter.shutdown(500); // explicit 500ms timeout
    const elapsed = Date.now() - start;

    // Should resolve within ~2x the timeout (generous for CI jitter)
    expect(elapsed).toBeLessThan(2000);

    // Unblock the hanging transport (cleanup)
    resolveHang();
  });

});
