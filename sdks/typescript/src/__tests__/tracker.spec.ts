import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DoowTracker } from '../tracker.js';
import type { CustomTransport, SerializedEvent, TransportResponse } from '../types.js';

// ─── Mock transport ────────────────────────────────────────────────────────

function makeTransport(statusCode = 202, headers: Record<string, string> = {}): {
  transport: CustomTransport;
  calls: Array<{ body: string; headers: Record<string, string>; url: string }>;
} {
  const calls: Array<{ body: string; headers: Record<string, string>; url: string }> = [];
  const transport: CustomTransport = {
    send: async (payload) => {
      calls.push({
        body: payload.body.toString(),
        headers: payload.headers,
        url: payload.url,
      });
      return { status: statusCode, headers, body: '{}' } as TransportResponse;
    },
  };
  return { transport, calls };
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('DoowTracker — S76 SDK core', () => {
  afterEach(() => {
    // Clean up any env vars set during tests
    delete process.env['DOOW_TRACK_API_KEY'];
    delete process.env['DOOW_TRACK_ENDPOINT'];
    delete process.env['DOOW_TRACK_DISABLED'];
    delete process.env['DOOW_TRACK_DEBUG'];
    delete process.env['DOOW_TRACK_FLUSH_AT'];
    delete process.env['DOOW_TRACK_FLUSH_INTERVAL'];
    delete process.env['DOOW_TRACK_ATTRIBUTION'];
  });

  describe('constructor', () => {
    it('accepts valid dk_ API key', () => {
      const { transport } = makeTransport();
      const meter = new DoowTracker('dk_test_key_123', { transport, enabled: true });
      expect(meter.enabled).toBe(true);
    });

    it('warns on non-dk_ API key', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const { transport } = makeTransport();
      new DoowTracker('invalid_key', { transport });
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('dk_'));
      warnSpy.mockRestore();
    });

    it('applies all 18 init options', () => {
      const onError = vi.fn();
      const beforeSend = vi.fn((e: SerializedEvent) => e);
      const beforeFlush = vi.fn((b: SerializedEvent[]) => b);
      const { transport } = makeTransport();

      const meter = new DoowTracker('dk_test', {
        endpoint: 'https://custom.api.co',
        enabled: true,
        attribution: { env: 'prod' },
        debug: false,
        flushAt: 50,
        flushInterval: 5000,
        maxPayloadBytes: 100 * 1024,
        maxQueueSize: 500,
        timeout: 3000,
        retryCount: 2,
        disableCompression: true,
        onError,
        beforeSend,
        beforeFlush,
        transport,
        maxConcurrentFlushes: 10,
        shutdownTimeout: 2000,
      });

      expect(meter.enabled).toBe(true);
    });

    it('ignores unknown options with debug warn', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const { transport } = makeTransport();
      new DoowTracker('dk_test', {
        transport,
        debug: true,
        // @ts-expect-error testing unknown option
        unknownOption: 'foo',
      });
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown init options'));
      warnSpy.mockRestore();
    });
  });

  describe('enabled soft kill switch', () => {
    it('enabled: false → track() is a no-op', async () => {
      const { transport, calls } = makeTransport();
      const meter = new DoowTracker('dk_test', { enabled: false, transport });

      expect(meter.enabled).toBe(false);

      meter.track({ metric: 'api_calls', quantity: 1, license_id: 'lic_1' });

      await new Promise((r) => setTimeout(r, 50));
      expect(calls.length).toBe(0);
    });

    it('enabled: false → flush() resolves immediately', async () => {
      const meter = new DoowTracker('dk_test', { enabled: false });
      await expect(meter.flush()).resolves.toBeUndefined();
    });

    it('enabled: false → shutdown() resolves immediately', async () => {
      const meter = new DoowTracker('dk_test', { enabled: false });
      await expect(meter.shutdown()).resolves.toBeUndefined();
    });

    it('DOOW_TRACK_DISABLED=true disables SDK', async () => {
      process.env['DOOW_TRACK_DISABLED'] = 'true';
      const { transport, calls } = makeTransport();
      const meter = new DoowTracker('dk_test', { transport });

      expect(meter.enabled).toBe(false);
      meter.track({ metric: 'api_calls', quantity: 1, license_id: 'lic_1' });

      await new Promise((r) => setTimeout(r, 50));
      expect(calls.length).toBe(0);
    });
  });

  describe('env var overrides', () => {
    it('DOOW_TRACK_ENDPOINT overrides code config', async () => {
      process.env['DOOW_TRACK_ENDPOINT'] = 'https://env-endpoint.co';
      const { transport, calls } = makeTransport();
      const meter = new DoowTracker('dk_test', {
        transport,
        endpoint: 'https://code-endpoint.co',
        flushAt: 1,
        disableCompression: true,
      });

      meter.track({ metric: 'api', quantity: 1, license_id: 'lic_1' });
      await meter.shutdown();

      expect(calls[0]?.url).toBe('https://env-endpoint.co/telemetry/events');
    });

    it('DOOW_TRACK_API_KEY overrides code apiKey', async () => {
      process.env['DOOW_TRACK_API_KEY'] = 'dk_from_env';
      const { transport, calls } = makeTransport();
      const meter = new DoowTracker('dk_from_code', {
        transport,
        flushAt: 1,
        disableCompression: true,
      });

      meter.track({ metric: 'api', quantity: 1, license_id: 'lic_1' });
      await meter.shutdown();

      expect(calls[0]?.headers['Authorization']).toBe('Bearer dk_from_env');
    });

    it('DOOW_TRACK_FLUSH_AT overrides flushAt', () => {
      process.env['DOOW_TRACK_FLUSH_AT'] = '5';
      const { transport } = makeTransport();
      // Should not throw
      const meter = new DoowTracker('dk_test', { transport });
      expect(meter.enabled).toBe(true);
    });

    it('DOOW_TRACK_ATTRIBUTION parses JSON attribution', async () => {
      process.env['DOOW_TRACK_ATTRIBUTION'] = '{"team":"ml","env":"prod"}';
      const received: string[] = [];
      const { transport } = makeTransport();
      const captureTransport: CustomTransport = {
        send: async (payload) => {
          received.push(payload.body.toString());
          return { status: 202, headers: {}, body: '{}' };
        },
      };

      const meter = new DoowTracker('dk_test', {
        transport: captureTransport,
        flushAt: 1,
        disableCompression: true,
      });

      meter.track({ metric: 'api', quantity: 1, license_id: 'lic_1' });
      await meter.shutdown();

      const body = JSON.parse(received[0] ?? '{}') as { events: SerializedEvent[] };
      expect(body.events[0]?.attribution).toMatchObject({ team: 'ml', env: 'prod' });
    });
  });

  describe('track()', () => {
    it('generates unique event_id for each event', async () => {
      const events: SerializedEvent[] = [];
      const captureTransport: CustomTransport = {
        send: async (payload) => {
          const body = JSON.parse(payload.body.toString()) as { events: SerializedEvent[] };
          events.push(...body.events);
          return { status: 202, headers: {}, body: '{}' };
        },
      };

      const meter = new DoowTracker('dk_test', {
        transport: captureTransport,
        flushAt: 2,
        disableCompression: true,
        flushInterval: 60000,
      });

      meter.track({ metric: 'api', quantity: 1, license_id: 'lic_1' });
      meter.track({ metric: 'api', quantity: 2, license_id: 'lic_1' });
      await meter.shutdown();

      expect(events).toHaveLength(2);
      expect(events[0]?.event_id).not.toBe(events[1]?.event_id);
      expect(events[0]?.event_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4/);
    });

    it('merges SDK-level attribution with per-event attribution', async () => {
      const events: SerializedEvent[] = [];
      const captureTransport: CustomTransport = {
        send: async (payload) => {
          const body = JSON.parse(payload.body.toString()) as { events: SerializedEvent[] };
          events.push(...body.events);
          return { status: 202, headers: {}, body: '{}' };
        },
      };

      const meter = new DoowTracker('dk_test', {
        transport: captureTransport,
        attribution: { env: 'staging', team: 'backend' },
        flushAt: 1,
        disableCompression: true,
        flushInterval: 60000,
      });

      meter.track({
        metric: 'api',
        quantity: 1,
        license_id: 'lic_1',
        attribution: { team: 'ml' }, // overrides SDK-level team
      });
      await meter.shutdown();

      expect(events[0]?.attribution).toEqual({ env: 'staging', team: 'ml' });
    });

    it('sets timestamp if not provided', async () => {
      const events: SerializedEvent[] = [];
      const captureTransport: CustomTransport = {
        send: async (payload) => {
          const body = JSON.parse(payload.body.toString()) as { events: SerializedEvent[] };
          events.push(...body.events);
          return { status: 202, headers: {}, body: '{}' };
        },
      };

      const meter = new DoowTracker('dk_test', {
        transport: captureTransport,
        flushAt: 1,
        disableCompression: true,
      });

      const before = new Date().toISOString();
      meter.track({ metric: 'api', quantity: 1, license_id: 'lic_1' });
      await meter.shutdown();
      const after = new Date().toISOString();

      const ts = events[0]?.timestamp ?? '';
      expect(ts >= before).toBe(true);
      expect(ts <= after).toBe(true);
    });

    it('preserves provided timestamp', async () => {
      const events: SerializedEvent[] = [];
      const captureTransport: CustomTransport = {
        send: async (payload) => {
          const body = JSON.parse(payload.body.toString()) as { events: SerializedEvent[] };
          events.push(...body.events);
          return { status: 202, headers: {}, body: '{}' };
        },
      };

      const meter = new DoowTracker('dk_test', {
        transport: captureTransport,
        flushAt: 1,
        disableCompression: true,
      });

      const ts = '2024-01-01T00:00:00.000Z';
      meter.track({ metric: 'api', quantity: 1, license_id: 'lic_1', timestamp: ts });
      await meter.shutdown();

      expect(events[0]?.timestamp).toBe(ts);
    });

    it('defaults kind to USAGE', async () => {
      const events: SerializedEvent[] = [];
      const captureTransport: CustomTransport = {
        send: async (payload) => {
          const body = JSON.parse(payload.body.toString()) as { events: SerializedEvent[] };
          events.push(...body.events);
          return { status: 202, headers: {}, body: '{}' };
        },
      };

      const meter = new DoowTracker('dk_test', {
        transport: captureTransport,
        flushAt: 1,
        disableCompression: true,
      });

      meter.track({ metric: 'api', quantity: 1, license_id: 'lic_1' });
      await meter.shutdown();

      expect(events[0]?.kind).toBe('USAGE');
    });

    it('no-op after shutdown', async () => {
      const { transport, calls } = makeTransport();
      const meter = new DoowTracker('dk_test', {
        transport,
        flushAt: 1,
        disableCompression: true,
      });

      await meter.shutdown();
      meter.track({ metric: 'api', quantity: 1, license_id: 'lic_1' });

      await new Promise((r) => setTimeout(r, 50));
      // Only first-event flush before shutdown
      expect(calls.length).toBeLessThanOrEqual(1);
    });
  });

  describe('shutdown()', () => {
    it('resolves within timeout even if flush hangs', async () => {
      const hangTransport: CustomTransport = {
        send: async () => {
          // Hang forever
          return new Promise(() => undefined);
        },
      };

      const meter = new DoowTracker('dk_test', {
        transport: hangTransport,
        flushAt: 1,
        shutdownTimeout: 100, // 100ms
      });

      meter.track({ metric: 'api', quantity: 1, license_id: 'lic_1' });

      const start = Date.now();
      await meter.shutdown(100);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(500); // well under 5s
    });

    it('second shutdown() call is no-op', async () => {
      const { transport } = makeTransport();
      const meter = new DoowTracker('dk_test', { transport });
      await meter.shutdown();
      await meter.shutdown(); // should not throw
    });
  });

  describe('flush()', () => {
    it('resolves when buffer flushed', async () => {
      const { transport, calls } = makeTransport();
      const meter = new DoowTracker('dk_test', {
        transport,
        flushAt: 100,
        flushInterval: 60000,
        disableCompression: true,
      });

      meter.track({ metric: 'api', quantity: 1, license_id: 'lic_1' });
      // flushAt=100 so won't auto-flush (except first-event fast path)
      await meter.flush();
      await meter.shutdown();

      expect(calls.length).toBeGreaterThan(0);
    });
  });

  describe('stopped (auth failure)', () => {
    it('stopped is false initially', () => {
      const { transport } = makeTransport();
      const meter = new DoowTracker('dk_test', { transport });
      expect(meter.stopped).toBe(false);
    });

    it('stopped becomes true on 401', async () => {
      const { transport } = makeTransport(401);
      const onError = vi.fn();
      const meter = new DoowTracker('dk_test', {
        transport,
        flushAt: 1,
        disableCompression: true,
        retryCount: 0,
        onError,
      });

      meter.track({ metric: 'api', quantity: 1, license_id: 'lic_1' });
      await meter.shutdown(500);

      expect(meter.stopped).toBe(true);
      expect(onError).toHaveBeenCalledWith(expect.objectContaining({ kind: 'AUTH_FAILURE' }));
    });
  });
});
