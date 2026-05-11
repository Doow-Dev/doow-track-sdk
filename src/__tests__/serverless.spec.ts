/**
 * S81: Serverless mode + helpers
 *
 * Tests:
 * - withLambda calls shutdown before returning
 * - withLambda flushes all buffered events
 * - Error in handler still calls shutdown
 * - withVercel and withAzureFunction work identically
 */
import { describe, it, expect, vi } from 'vitest';
import { DoowTracker } from '../tracker.js';
import type { CustomTransport, SerializedEvent } from '../types.js';

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeCapturingTransport(): {
  transport: CustomTransport;
  flushedEvents: SerializedEvent[];
  callCount: number;
} {
  const flushedEvents: SerializedEvent[] = [];
  let callCount = 0;

  const transport: CustomTransport = {
    send: async (payload) => {
      callCount++;
      const body = JSON.parse(payload.body.toString()) as { events: SerializedEvent[] };
      flushedEvents.push(...body.events);
      return { status: 202, headers: {}, body: '{}' };
    },
  };

  return {
    transport,
    flushedEvents,
    get callCount() { return callCount; },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('S81: Serverless mode + helpers', () => {
  describe('withLambda', () => {
    it('calls flush() before returning from wrapped handler', async () => {
      const { transport } = makeCapturingTransport();
      const meter = new DoowTracker('dk_test', {
        transport,
        disableCompression: true,
        flushInterval: 60000, // no timer flush
      });

      const flushSpy = vi.spyOn(meter, 'flush');

      const wrappedHandler = meter.withLambda(async (_event: unknown, _context: unknown) => {
        return { statusCode: 200 };
      });

      await wrappedHandler({}, {});

      expect(flushSpy).toHaveBeenCalledOnce();
    });

    it('flushes all buffered events before returning', async () => {
      const { transport, flushedEvents } = makeCapturingTransport();
      const meter = new DoowTracker('dk_test', {
        transport,
        disableCompression: true,
        flushAt: 1000, // very high threshold — no auto flush
        flushInterval: 60000,
      });

      const wrappedHandler = meter.withLambda(async (_event: unknown, _context: unknown) => {
        meter.track({ metric: 'tokens', quantity: 100, license_id: 'lic_1' });
        meter.track({ metric: 'tokens', quantity: 200, license_id: 'lic_1' });
        return { statusCode: 200 };
      });

      await wrappedHandler({ requestId: 'req-1' }, { functionName: 'my-fn' });

      // All events should have been flushed (shutdown drains the queue)
      expect(flushedEvents.length).toBeGreaterThan(0);
      const quantities = flushedEvents.map((e) => e.quantity);
      expect(quantities).toContain(100);
      expect(quantities).toContain(200);
    });

    it('returns the handler result', async () => {
      const { transport } = makeCapturingTransport();
      const meter = new DoowTracker('dk_test', { transport, disableCompression: true });

      const wrappedHandler = meter.withLambda(async (_event: unknown, _context: unknown) => {
        return { statusCode: 200, body: 'ok' };
      });

      const result = await wrappedHandler({}, {});
      expect(result).toEqual({ statusCode: 200, body: 'ok' });
    });

    it('calls flush even when handler throws an error', async () => {
      const { transport } = makeCapturingTransport();
      const meter = new DoowTracker('dk_test', { transport, disableCompression: true });

      const flushSpy = vi.spyOn(meter, 'flush');

      const wrappedHandler = meter.withLambda(async (_event: unknown, _context: unknown) => {
        throw new Error('handler exploded');
      });

      await expect(wrappedHandler({}, {})).rejects.toThrow('handler exploded');

      // flush must have been called despite the error
      expect(flushSpy).toHaveBeenCalledOnce();
    });

    it('propagates handler errors after calling shutdown', async () => {
      const { transport, flushedEvents } = makeCapturingTransport();
      const meter = new DoowTracker('dk_test', {
        transport,
        disableCompression: true,
        flushAt: 1000,
        flushInterval: 60000,
      });

      const wrappedHandler = meter.withLambda(async (_event: unknown, _context: unknown) => {
        meter.track({ metric: 'api', quantity: 1, license_id: 'lic_1' });
        throw new Error('downstream failure');
      });

      let caughtError: Error | null = null;
      try {
        await wrappedHandler({}, {});
      } catch (e) {
        caughtError = e as Error;
      }

      expect(caughtError?.message).toBe('downstream failure');
      // Events tracked before the error should still have been flushed
      expect(flushedEvents.length).toBeGreaterThan(0);
    });

    it('wrapped handler passes through event and context to underlying handler', async () => {
      const { transport } = makeCapturingTransport();
      const meter = new DoowTracker('dk_test', { transport, disableCompression: true });

      const receivedArgs: { event: unknown; context: unknown }[] = [];
      const wrappedHandler = meter.withLambda(async (event: unknown, context: unknown) => {
        receivedArgs.push({ event, context });
        return 'result';
      });

      const lambdaEvent = { source: 'api-gateway', body: '{}' };
      const lambdaContext = { functionName: 'my-func', awsRequestId: 'req-123' };
      await wrappedHandler(lambdaEvent, lambdaContext);

      expect(receivedArgs).toHaveLength(1);
      expect(receivedArgs[0]?.event).toBe(lambdaEvent);
      expect(receivedArgs[0]?.context).toBe(lambdaContext);
    });
  });

  describe('withVercel', () => {
    it('calls flush() before returning', async () => {
      const { transport } = makeCapturingTransport();
      const meter = new DoowTracker('dk_test', { transport, disableCompression: true });

      const flushSpy = vi.spyOn(meter, 'flush');

      const wrappedHandler = meter.withVercel(async (_req: unknown, _res: unknown) => {
        // Vercel handler returns void
      });

      await wrappedHandler({}, {});
      expect(flushSpy).toHaveBeenCalledOnce();
    });

    it('flushes buffered events', async () => {
      const { transport, flushedEvents } = makeCapturingTransport();
      const meter = new DoowTracker('dk_test', {
        transport,
        disableCompression: true,
        flushAt: 1000,
        flushInterval: 60000,
      });

      const wrappedHandler = meter.withVercel(async (_req: unknown, _res: unknown) => {
        meter.track({ metric: 'requests', quantity: 1, license_id: 'lic_1' });
      });

      await wrappedHandler({}, {});
      expect(flushedEvents.length).toBeGreaterThan(0);
    });

    it('calls flush even when handler throws', async () => {
      const { transport } = makeCapturingTransport();
      const meter = new DoowTracker('dk_test', { transport, disableCompression: true });

      const flushSpy = vi.spyOn(meter, 'flush');

      const wrappedHandler = meter.withVercel(async (_req: unknown, _res: unknown) => {
        throw new Error('vercel handler error');
      });

      await expect(wrappedHandler({}, {})).rejects.toThrow('vercel handler error');
      expect(flushSpy).toHaveBeenCalledOnce();
    });
  });

  describe('withAzureFunction', () => {
    it('calls flush() before returning', async () => {
      const { transport } = makeCapturingTransport();
      const meter = new DoowTracker('dk_test', { transport, disableCompression: true });

      const flushSpy = vi.spyOn(meter, 'flush');

      const wrappedHandler = meter.withAzureFunction(async (_context: unknown, _input: unknown) => {
        return { status: 200 };
      });

      await wrappedHandler({}, {});
      expect(flushSpy).toHaveBeenCalledOnce();
    });

    it('flushes buffered events', async () => {
      const { transport, flushedEvents } = makeCapturingTransport();
      const meter = new DoowTracker('dk_test', {
        transport,
        disableCompression: true,
        flushAt: 1000,
        flushInterval: 60000,
      });

      const wrappedHandler = meter.withAzureFunction(async (_context: unknown, _input: unknown) => {
        meter.track({ metric: 'executions', quantity: 1, license_id: 'lic_1' });
        return { status: 200 };
      });

      await wrappedHandler({}, {});
      expect(flushedEvents.length).toBeGreaterThan(0);
    });

    it('calls flush even when handler throws', async () => {
      const { transport } = makeCapturingTransport();
      const meter = new DoowTracker('dk_test', { transport, disableCompression: true });

      const flushSpy = vi.spyOn(meter, 'flush');

      const wrappedHandler = meter.withAzureFunction(async (_context: unknown, _input: unknown) => {
        throw new Error('azure function error');
      });

      await expect(wrappedHandler({}, {})).rejects.toThrow('azure function error');
      expect(flushSpy).toHaveBeenCalledOnce();
    });

    it('returns the handler result', async () => {
      const { transport } = makeCapturingTransport();
      const meter = new DoowTracker('dk_test', { transport, disableCompression: true });

      const wrappedHandler = meter.withAzureFunction(async (_ctx: unknown, _input: unknown) => {
        return { body: 'done', status: 200 };
      });

      const result = await wrappedHandler({}, {});
      expect(result).toEqual({ body: 'done', status: 200 });
    });
  });

  describe('flushAt=1 behavior in serverless wrappers', () => {
    it('withLambda sets flushAt=1 so every track() triggers a flush', async () => {
      const { transport, flushedEvents } = makeCapturingTransport();
      // Start with a high flushAt
      const meter = new DoowTracker('dk_test', {
        transport,
        disableCompression: true,
        flushAt: 1000,
        flushInterval: 60000,
        shutdownTimeout: 1000,
      });

      const wrappedHandler = meter.withLambda(async (_event: unknown, _ctx: unknown) => {
        meter.track({ metric: 'api', quantity: 1, license_id: 'lic_1' });
        meter.track({ metric: 'api', quantity: 2, license_id: 'lic_1' });
        return 'done';
      });

      await wrappedHandler({}, {});

      // Both events should have been flushed via shutdown()
      expect(flushedEvents.length).toBe(2);
    });
  });
});
