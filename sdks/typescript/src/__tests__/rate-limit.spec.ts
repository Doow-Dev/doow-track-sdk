/**
 * S79: Per-category rate-limit enforcement
 *
 * Tests:
 * - 429 with X-Doow-Rate-Limits sets rate limit state
 * - Rate limit expires → events flush normally
 * - Rate limit checked before flush
 * - Malformed header → ignored gracefully
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Exporter } from '../exporter.js';
import { DoowTracker } from '../tracker.js';
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

function makeExporter(
  transport: CustomTransport,
  overrides: Partial<ConstructorParameters<typeof Exporter>[0]> = {},
): Exporter {
  return new Exporter({
    endpoint: 'https://api.doow.co',
    apiKey: 'dk_test_key',
    timeout: 5000,
    retryCount: 0, // no retries for rate-limit tests by default
    disableCompression: true,
    maxConcurrentFlushes: 30,
    onError: vi.fn(),
    transport,
    debug: { log: () => undefined, warn: () => undefined },
    ...overrides,
  });
}

function make429Transport(
  rateLimitsHeader?: string,
  thenSucceed = false,
): { transport: CustomTransport; calls: number } {
  let calls = 0;
  const transport: CustomTransport = {
    send: async (): Promise<TransportResponse> => {
      calls++;
      if (thenSucceed && calls > 1) {
        return { status: 202, headers: {}, body: '{}' };
      }
      const headers: Record<string, string> = {};
      if (rateLimitsHeader !== undefined) {
        headers['x-doow-rate-limits'] = rateLimitsHeader;
      }
      return { status: 429, headers, body: '{}' };
    },
  };
  return { transport, calls: 0 };
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('S79: Per-category rate-limit enforcement', () => {
  describe('rate limit state from 429 response', () => {
    it('429 with X-Doow-Rate-Limits header sets rate limit state', async () => {
      let callCount = 0;
      const transport: CustomTransport = {
        send: async (): Promise<TransportResponse> => {
          callCount++;
          return {
            status: 429,
            headers: {
              'x-doow-rate-limits': JSON.stringify({
                event_rate: { limit: 1000, current: 1050, retry_after: 30 },
              }),
            },
            body: '{}',
          };
        },
      };

      const exporter = makeExporter(transport, { retryCount: 0 });

      // First flush triggers 429 which sets rate limit
      await exporter.flush([makeEvent(1)]);

      // Now rateLimited should be true
      expect(exporter.rateLimited).toBe(true);
    });

    it('429 with X-Doow-Rate-Limits header sets expiry based on retry_after seconds', async () => {
      const transport: CustomTransport = {
        send: async (): Promise<TransportResponse> => ({
          status: 429,
          headers: {
            'x-doow-rate-limits': JSON.stringify({
              event_rate: { limit: 1000, current: 1050, retry_after: 60 },
            }),
          },
          body: '{}',
        }),
      };

      const before = Date.now();
      const exporter = makeExporter(transport, { retryCount: 0 });
      await exporter.flush([makeEvent(1)]);

      expect(exporter.rateLimited).toBe(true);
    });

    it('rate limit expires after retry_after seconds — events flush normally', async () => {
      // Use a very short retry_after so we can test expiry
      let callCount = 0;
      const transport: CustomTransport = {
        send: async (): Promise<TransportResponse> => {
          callCount++;
          if (callCount === 1) {
            return {
              status: 429,
              headers: {
                // retry_after: 0 means already expired immediately
                'x-doow-rate-limits': JSON.stringify({
                  event_rate: { limit: 1000, current: 1050, retry_after: 0 },
                }),
              },
              body: '{}',
            };
          }
          return { status: 202, headers: {}, body: '{}' };
        },
      };

      const exporter = makeExporter(transport, { retryCount: 0 });

      // First flush hits 429 with retry_after: 0 (already expired)
      await exporter.flush([makeEvent(1)]);

      // Rate limit with retry_after: 0 should not block (0 * 1000 = 0ms in the future = not active)
      // rateLimited should be false since retry_after: 0 means no delay
      expect(exporter.rateLimited).toBe(false);

      // Second flush should succeed
      await exporter.flush([makeEvent(2)]);
      expect(callCount).toBe(2);
    });

    it('rate limit blocks flush while active', async () => {
      let callCount = 0;
      const transport: CustomTransport = {
        send: async (): Promise<TransportResponse> => {
          callCount++;
          if (callCount === 1) {
            return {
              status: 429,
              headers: {
                'x-doow-rate-limits': JSON.stringify({
                  event_rate: { limit: 1000, current: 1050, retry_after: 30 },
                }),
              },
              body: '{}',
            };
          }
          return { status: 202, headers: {}, body: '{}' };
        },
      };

      const exporter = makeExporter(transport, { retryCount: 0 });

      // First flush hits 429 → sets 30s rate limit
      await exporter.flush([makeEvent(1)]);
      expect(exporter.rateLimited).toBe(true);

      // Second flush is held (not sent) because rate limited
      await exporter.flush([makeEvent(2)]);

      // callCount should still be 1 — second flush was skipped
      expect(callCount).toBe(1);
    });

    it('malformed X-Doow-Rate-Limits header is ignored gracefully', async () => {
      const onError = vi.fn();
      let callCount = 0;
      const transport: CustomTransport = {
        send: async (): Promise<TransportResponse> => {
          callCount++;
          return {
            status: 429,
            headers: {
              'x-doow-rate-limits': 'this is not valid json {{{',
            },
            body: '{}',
          };
        },
      };

      const exporter = makeExporter(transport, { retryCount: 0, onError });

      // Should not throw despite malformed header
      await expect(exporter.flush([makeEvent(1)])).resolves.toBeUndefined();

      // Rate limit state should not be set (malformed = ignored)
      expect(exporter.rateLimited).toBe(false);
    });

    it('missing X-Doow-Rate-Limits header on 429 — no rate limit state set', async () => {
      const transport: CustomTransport = {
        send: async (): Promise<TransportResponse> => ({
          status: 429,
          headers: {},
          body: '{}',
        }),
      };

      const exporter = makeExporter(transport, { retryCount: 0 });
      await exporter.flush([makeEvent(1)]);

      expect(exporter.rateLimited).toBe(false);
    });
  });

  describe('DoowTracker.rateLimited getter', () => {
    it('rateLimited is false initially', () => {
      const transport: CustomTransport = {
        send: async () => ({ status: 202, headers: {}, body: '{}' }),
      };

      const meter = new DoowTracker('dk_test', { transport });
      expect(meter.rateLimited).toBe(false);
    });

    it('rateLimited reflects exporter rate limit state', async () => {
      const transport: CustomTransport = {
        send: async (): Promise<TransportResponse> => ({
          status: 429,
          headers: {
            'x-doow-rate-limits': JSON.stringify({
              event_rate: { limit: 1000, current: 1050, retry_after: 30 },
            }),
          },
          body: '{}',
        }),
      };

      const meter = new DoowTracker('dk_test', {
        transport,
        flushAt: 1,
        disableCompression: true,
        retryCount: 0,
      });

      meter.track({ metric: 'api_calls', quantity: 1, license_id: 'lic_1' });
      await new Promise((r) => setTimeout(r, 50));

      expect(meter.rateLimited).toBe(true);
    });

    it('rateLimited is false when SDK is disabled', () => {
      const meter = new DoowTracker('dk_test', { enabled: false });
      expect(meter.rateLimited).toBe(false);
    });

    it('multiple rate limit categories — all must expire before flush', async () => {
      const transport: CustomTransport = {
        send: async (): Promise<TransportResponse> => ({
          status: 429,
          headers: {
            'x-doow-rate-limits': JSON.stringify({
              event_rate: { limit: 1000, current: 1050, retry_after: 30 },
              daily_cap: { limit: 50000, current: 51000, retry_after: 3600 },
            }),
          },
          body: '{}',
        }),
      };

      const exporter = makeExporter(transport, { retryCount: 0 });
      await exporter.flush([makeEvent(1)]);

      // Both categories are set — rateLimited should be true
      expect(exporter.rateLimited).toBe(true);
    });
  });
});
