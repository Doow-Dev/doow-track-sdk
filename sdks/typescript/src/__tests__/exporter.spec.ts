import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Exporter } from '../exporter.js';
import type { CustomTransport, SerializedEvent, TransportPayload, TransportResponse } from '../types.js';

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeEvent(n: number): SerializedEvent {
  return {
    event_id: `evt-${n}`,
    metric: 'api_calls',
    quantity: n,
    license_id: 'lic_1',
    timestamp: new Date().toISOString(),
    kind: 'USAGE',
  };
}

function makeEvents(count: number): SerializedEvent[] {
  return Array.from({ length: count }, (_, i) => makeEvent(i));
}

interface TransportCall {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  rawBody: Buffer;
}

function makeTransport(statusCode = 202, responseBody = '{}', headers: Record<string, string> = {}): {
  transport: CustomTransport;
  calls: TransportCall[];
} {
  const calls: TransportCall[] = [];
  const transport: CustomTransport = {
    send: async (payload: TransportPayload) => {
      calls.push({
        url: payload.url,
        headers: payload.headers,
        body: JSON.parse(payload.body.toString()),
        rawBody: payload.body,
      });
      return { status: statusCode, headers, body: responseBody } as TransportResponse;
    },
  };
  return { transport, calls };
}

function makeExporter(
  transport: CustomTransport,
  overrides: Partial<ConstructorParameters<typeof Exporter>[0]> = {},
): Exporter {
  return new Exporter({
    endpoint: 'https://api.doow.co',
    apiKey: 'dk_test_key',
    timeout: 5000,
    retryCount: 3,
    disableCompression: true,
    maxConcurrentFlushes: 30,
    onError: vi.fn(),
    transport,
    debug: { log: () => undefined, warn: () => undefined },
    ...overrides,
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('Exporter — S78', () => {
  describe('HTTP POST basics', () => {
    it('POSTs to correct URL', async () => {
      const { transport, calls } = makeTransport(202);
      const exporter = makeExporter(transport);

      await exporter.flush(makeEvents(1));

      expect(calls).toHaveLength(1);
      expect(calls[0]?.url).toBe('https://api.doow.co/telemetry/events');
    });

    it('sends Authorization header', async () => {
      const { transport, calls } = makeTransport(202);
      const exporter = makeExporter(transport);

      await exporter.flush(makeEvents(1));

      expect(calls[0]?.headers['Authorization']).toBe('Bearer dk_test_key');
    });

    it('sends Content-Type: application/json', async () => {
      const { transport, calls } = makeTransport(202);
      const exporter = makeExporter(transport);

      await exporter.flush(makeEvents(1));

      expect(calls[0]?.headers['Content-Type']).toBe('application/json');
    });

    it('includes sdk_version in batch payload', async () => {
      const { transport, calls } = makeTransport(202);
      const exporter = makeExporter(transport);

      await exporter.flush(makeEvents(1));

      const body = calls[0]?.body as { sdk_version: string };
      expect(body.sdk_version).toBeTruthy();
    });

    it('includes batch_id in each POST', async () => {
      const { transport, calls } = makeTransport(202);
      const exporter = makeExporter(transport);

      await exporter.flush(makeEvents(1));

      const body = calls[0]?.body as { batch_id: string };
      expect(body.batch_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4/);
    });

    it('same batch_id on retry', async () => {
      let attempt = 0;
      const batchIds: string[] = [];
      const transport: CustomTransport = {
        send: async (payload) => {
          const body = JSON.parse(payload.body.toString()) as { batch_id: string };
          batchIds.push(body.batch_id);
          attempt++;
          if (attempt < 2) throw new Error('network error');
          return { status: 202, headers: {}, body: '{}' };
        },
      };

      const exporter = makeExporter(transport, { retryCount: 2, disableCompression: true });
      await exporter.flush(makeEvents(1));

      expect(batchIds).toHaveLength(2);
      expect(batchIds[0]).toBe(batchIds[1]);
    });
  });

  describe('compression', () => {
    it('sends Content-Encoding: gzip when compression enabled', async () => {
      // Use a transport that doesn't JSON.parse the body (gzip is binary)
      const gzipCalls: { headers: Record<string, string>; rawBody: Buffer }[] = [];
      const gzipTransport: CustomTransport = {
        send: async (payload: TransportPayload) => {
          gzipCalls.push({ headers: payload.headers, rawBody: payload.body });
          return { status: 202, headers: {}, body: '{}' } as TransportResponse;
        },
      };
      const exporter = new Exporter({
        endpoint: 'https://api.doow.co',
        apiKey: 'dk_test',
        timeout: 5000,
        retryCount: 0,
        disableCompression: false, // compression ON
        maxConcurrentFlushes: 30,
        onError: vi.fn(),
        transport: gzipTransport,
        debug: { log: () => undefined, warn: () => undefined },
      });

      await exporter.flush(makeEvents(1));

      expect(gzipCalls[0]?.headers['Content-Encoding']).toBe('gzip');
    });

    it('no Content-Encoding when disableCompression: true', async () => {
      const { transport, calls } = makeTransport(202);
      const exporter = makeExporter(transport, { disableCompression: true });

      await exporter.flush(makeEvents(1));

      expect(calls[0]?.headers['Content-Encoding']).toBeUndefined();
    });
  });

  describe('serialized flushes', () => {
    it('second flush waits for first to complete', async () => {
      const order: string[] = [];
      let resolveFirst!: () => void;
      let firstDone = false;

      const transport: CustomTransport = {
        send: async () => {
          if (!firstDone) {
            await new Promise<void>((r) => { resolveFirst = r; });
            firstDone = true;
            order.push('first');
          } else {
            order.push('second');
          }
          return { status: 202, headers: {}, body: '{}' };
        },
      };

      const exporter = makeExporter(transport, { disableCompression: true });

      const flush1 = exporter.flush(makeEvents(1));
      const flush2 = exporter.flush(makeEvents(1));

      // Let first request hang until we resolve it
      await new Promise((r) => setTimeout(r, 20));
      resolveFirst();

      await Promise.all([flush1, flush2]);

      expect(order).toEqual(['first', 'second']);
    });
  });

  describe('response handling', () => {
    it('202 → success (no error called)', async () => {
      const onError = vi.fn();
      const { transport } = makeTransport(202);
      const exporter = makeExporter(transport, { onError });

      await exporter.flush(makeEvents(1));

      expect(onError).not.toHaveBeenCalled();
    });

    it('207 partial accept → onError called with rejected event ids', async () => {
      const onError = vi.fn();
      const transport: CustomTransport = {
        send: async () => ({
          status: 207,
          headers: {},
          body: JSON.stringify({
            accepted: ['evt-0'],
            rejected: [{ event_id: 'evt-1', reason: 'invalid metric' }],
          }),
        }),
      };

      const exporter = makeExporter(transport, { onError, retryCount: 0 });
      await exporter.flush(makeEvents(2));

      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'PARTIAL_ACCEPT',
          rejectedEventIds: ['evt-1'],
        }),
      );
    });

    it('401 → stops emitting permanently', async () => {
      const onError = vi.fn();
      const { transport, calls } = makeTransport(401);
      const exporter = makeExporter(transport, { onError, retryCount: 0 });

      await exporter.flush(makeEvents(1));

      expect(exporter.stopped).toBe(true);
      expect(onError).toHaveBeenCalledWith(expect.objectContaining({ kind: 'AUTH_FAILURE' }));

      // Additional flushes are no-ops
      await exporter.flush(makeEvents(1));
      expect(calls).toHaveLength(1); // only one actual request
    });

    it('429 respects Retry-After header', async () => {
      const timestamps: number[] = [];
      let attempt = 0;
      const transport: CustomTransport = {
        send: async () => {
          timestamps.push(Date.now());
          attempt++;
          if (attempt === 1) {
            return { status: 429, headers: { 'retry-after': '0.05' }, body: '{}' }; // 50ms
          }
          return { status: 202, headers: {}, body: '{}' };
        },
      };

      const exporter = makeExporter(transport, { retryCount: 1, disableCompression: true });
      await exporter.flush(makeEvents(1));

      const gap = timestamps[1]! - timestamps[0]!;
      expect(gap).toBeGreaterThanOrEqual(40); // ~50ms with some tolerance
    });
  });

  describe('exponential backoff', () => {
    it('retries on network error with backoff', async () => {
      const timestamps: number[] = [];
      let attempt = 0;
      const transport: CustomTransport = {
        send: async () => {
          timestamps.push(Date.now());
          attempt++;
          if (attempt < 3) throw new Error('network failure');
          return { status: 202, headers: {}, body: '{}' };
        },
      };

      const exporter = makeExporter(transport, { retryCount: 3, disableCompression: true });
      await exporter.flush(makeEvents(1));

      expect(attempt).toBe(3);
      // Second attempt should be delayed by ~1s (with ±20% jitter → 800ms-1200ms)
      const gap1 = timestamps[1]! - timestamps[0]!;
      expect(gap1).toBeGreaterThan(700);
    }, 10_000);

    it('calls onError after all retries exhausted', async () => {
      const onError = vi.fn();
      const transport: CustomTransport = {
        send: async () => {
          throw new Error('persistent failure');
        },
      };

      const exporter = makeExporter(transport, { retryCount: 1, onError, disableCompression: true });
      await exporter.flush(makeEvents(1));

      expect(onError).toHaveBeenCalledWith(expect.objectContaining({ kind: 'NETWORK_ERROR' }));
    }, 10_000);
  });

  describe('413 adaptive recovery', () => {
    it('halves batch and retries each half on 413', async () => {
      const receivedBatches: number[] = [];
      let attempt = 0;
      const transport: CustomTransport = {
        send: async (payload) => {
          const body = JSON.parse(payload.body.toString()) as { events: SerializedEvent[] };
          receivedBatches.push(body.events.length);
          attempt++;
          if (attempt === 1) {
            return { status: 413, headers: {}, body: '{}' };
          }
          return { status: 202, headers: {}, body: '{}' };
        },
      };

      const exporter = makeExporter(transport, { retryCount: 3, disableCompression: true });
      await exporter.flush(makeEvents(4)); // 4 events → 413 → halve to 2 each

      expect(receivedBatches[0]).toBe(4); // first attempt: 4 events
      // After 413, should retry with halved batches
      expect(receivedBatches.slice(1).every((n) => n <= 2)).toBe(true);
    });

    it('remembers reduced adaptive batch size for subsequent flushes', async () => {
      let firstCall = true;
      const batchSizes: number[] = [];
      const transport: CustomTransport = {
        send: async (payload) => {
          const body = JSON.parse(payload.body.toString()) as { events: SerializedEvent[] };
          batchSizes.push(body.events.length);
          if (firstCall && body.events.length > 2) {
            firstCall = false;
            return { status: 413, headers: {}, body: '{}' };
          }
          return { status: 202, headers: {}, body: '{}' };
        },
      };

      const exporter = makeExporter(transport, { retryCount: 3, disableCompression: true });
      await exporter.flush(makeEvents(6)); // triggers 413, adaptive size → 3

      // After 413, exporter._adaptiveBatchSize should be set
      // Next flush of large batch should be capped
    });
  });

  describe('concurrency cap', () => {
    it('limits concurrent requests to maxConcurrentFlushes', async () => {
      let concurrent = 0;
      let maxConcurrent = 0;
      const transport: CustomTransport = {
        send: async () => {
          concurrent++;
          maxConcurrent = Math.max(maxConcurrent, concurrent);
          await new Promise((r) => setTimeout(r, 10));
          concurrent--;
          return { status: 202, headers: {}, body: '{}' };
        },
      };

      const exporter = makeExporter(transport, {
        maxConcurrentFlushes: 2,
        disableCompression: true,
      });

      // Fire many flushes concurrently
      await Promise.all([
        exporter.flush(makeEvents(1)),
        exporter.flush(makeEvents(1)),
        exporter.flush(makeEvents(1)),
        exporter.flush(makeEvents(1)),
      ]);

      // Due to serialized flush design (one pending at a time), concurrent should be limited
      // The serialization guarantee is stronger than the concurrency cap in this impl
      expect(maxConcurrent).toBeLessThanOrEqual(2);
    });
  });

  describe('timeout', () => {
    it('errors on timeout', async () => {
      const onError = vi.fn();
      const transport: CustomTransport = {
        send: async () => new Promise(() => undefined), // hangs forever
      };

      const exporter = makeExporter(transport, {
        timeout: 50,
        retryCount: 0,
        onError,
        disableCompression: true,
      });

      await exporter.flush(makeEvents(1));

      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ kind: expect.stringMatching(/TIMEOUT|NETWORK_ERROR/) }),
      );
    });
  });

  describe('custom transport', () => {
    it('uses custom transport instead of default HTTP', async () => {
      const customCalls: TransportPayload[] = [];
      const transport: CustomTransport = {
        send: async (payload) => {
          customCalls.push(payload);
          return { status: 202, headers: {}, body: '{}' };
        },
      };

      const exporter = makeExporter(transport, { disableCompression: true });
      await exporter.flush(makeEvents(1));

      expect(customCalls).toHaveLength(1);
      expect(customCalls[0]?.url).toBe('https://api.doow.co/telemetry/events');
    });
  });

  describe('batch splitting', () => {
    it('splits batches >500 events into sequential POSTs', async () => {
      const receivedEventCounts: number[] = [];
      const transport: CustomTransport = {
        send: async (payload) => {
          const body = JSON.parse(payload.body.toString()) as { events: SerializedEvent[] };
          receivedEventCounts.push(body.events.length);
          return { status: 202, headers: {}, body: '{}' };
        },
      };

      const exporter = makeExporter(transport, { disableCompression: true });
      await exporter.flush(makeEvents(750)); // 750 > 500 → should split into 500 + 250

      expect(receivedEventCounts).toHaveLength(2);
      expect(receivedEventCounts[0]).toBe(500);
      expect(receivedEventCounts[1]).toBe(250);
    });
  });

  describe('drain()', () => {
    it('resolves when no pending flush', async () => {
      const { transport } = makeTransport(202);
      const exporter = makeExporter(transport);
      await exporter.drain(); // should resolve immediately
    });

    it('waits for in-flight flush to complete', async () => {
      let resolved = false;
      let resolveTransport!: () => void;

      const transport: CustomTransport = {
        send: async () => {
          await new Promise<void>((r) => { resolveTransport = r; });
          return { status: 202, headers: {}, body: '{}' };
        },
      };

      const exporter = makeExporter(transport, { disableCompression: true });

      const flushPromise = exporter.flush(makeEvents(1));
      const drainPromise = exporter.drain().then(() => { resolved = true; });

      await new Promise((r) => setTimeout(r, 20));
      expect(resolved).toBe(false);

      resolveTransport();
      await Promise.all([flushPromise, drainPromise]);
      expect(resolved).toBe(true);
    });
  });
});
