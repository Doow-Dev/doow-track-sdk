import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventProcessor } from '../event-processor.js';
import { Exporter } from '../exporter.js';
import type { SerializedEvent } from '../types.js';

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<SerializedEvent> = {}): SerializedEvent {
  return {
    event_id: `evt-${Math.random().toString(36).slice(2)}`,
    metric: 'api_calls',
    quantity: 1,
    license_id: 'lic_1',
    timestamp: new Date().toISOString(),
    kind: 'USAGE',
    ...overrides,
  };
}

function makeExporter(flushSpy: ReturnType<typeof vi.fn>): Exporter {
  return {
    flush: flushSpy,
    drain: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    stopped: false,
  } as unknown as Exporter;
}

function makeProcessor(
  overrides: Partial<ConstructorParameters<typeof EventProcessor>[0]> = {},
  flushSpy: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(undefined),
): { processor: EventProcessor; flushSpy: ReturnType<typeof vi.fn> } {
  const exporter = makeExporter(flushSpy);
  const processor = new EventProcessor(
    {
      flushAt: 20,
      flushInterval: 10_000,
      maxPayloadBytes: 450 * 1024,
      maxQueueSize: 10_000,
      debug: { log: () => undefined, warn: () => undefined },
      ...overrides,
    },
    exporter,
  );
  return { processor, flushSpy };
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('EventProcessor — S77', () => {
  describe('first-event fast path', () => {
    it('flushes immediately on first event', async () => {
      const { processor, flushSpy } = makeProcessor({ flushAt: 100, flushInterval: 60_000 });

      await processor.enqueue(makeEvent());

      expect(flushSpy).toHaveBeenCalledTimes(1);
      expect(processor.hasFlushed).toBe(true);
    });

    it('subsequent events do not flush immediately (follow normal batching)', async () => {
      const { processor, flushSpy } = makeProcessor({ flushAt: 5, flushInterval: 60_000 });

      await processor.enqueue(makeEvent()); // first — immediate
      expect(flushSpy).toHaveBeenCalledTimes(1);

      await processor.enqueue(makeEvent()); // second — queued
      await processor.enqueue(makeEvent()); // third — queued
      await processor.enqueue(makeEvent()); // fourth — queued

      expect(flushSpy).toHaveBeenCalledTimes(1); // not yet at flushAt=5
    });
  });

  describe('count flush trigger', () => {
    it('flushes when queue reaches flushAt', async () => {
      const { processor, flushSpy } = makeProcessor({ flushAt: 3, flushInterval: 60_000 });

      await processor.enqueue(makeEvent()); // 1st → immediate flush, hasFlushed=true
      expect(flushSpy).toHaveBeenCalledTimes(1);

      await processor.enqueue(makeEvent()); // 2nd → queued (count=1)
      await processor.enqueue(makeEvent()); // 3rd → queued (count=2)
      await processor.enqueue(makeEvent()); // 4th → count=3 → flush!
      expect(flushSpy).toHaveBeenCalledTimes(2);
    });

    it('sends all queued events on count flush', async () => {
      const flushedBatches: SerializedEvent[][] = [];
      const flushSpy = vi.fn().mockImplementation(async (events: SerializedEvent[]) => {
        flushedBatches.push([...events]);
      });

      const { processor } = makeProcessor({ flushAt: 2, flushInterval: 60_000 }, flushSpy);

      const e1 = makeEvent({ metric: 'calls' });
      const e2 = makeEvent({ metric: 'tokens' });

      await processor.enqueue(e1); // first event → immediate flush
      await processor.enqueue(e2); // queued
      await processor.enqueue(makeEvent()); // count=2 → flush

      expect(flushedBatches.length).toBeGreaterThanOrEqual(2);
      const allEvents = flushedBatches.flat();
      expect(allEvents.some((e) => e.event_id === e1.event_id)).toBe(true);
    });
  });

  describe('byte threshold flush trigger', () => {
    it('flushes when bytes exceed maxPayloadBytes', async () => {
      const { processor, flushSpy } = makeProcessor({
        flushAt: 1000,
        flushInterval: 60_000,
        maxPayloadBytes: 100, // very small — 100 bytes
      });

      await processor.enqueue(makeEvent()); // first → immediate flush

      // Add events that push bytes over threshold
      const bigEvent = makeEvent({ metadata: { data: 'x'.repeat(200) } });
      await processor.enqueue(bigEvent); // exceeds 100 bytes → should flush

      expect(flushSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('timer flush trigger', () => {
    it('flushes after flushInterval elapses', async () => {
      vi.useFakeTimers();
      const { processor, flushSpy } = makeProcessor({ flushAt: 1000, flushInterval: 500 });

      await processor.enqueue(makeEvent()); // first → immediate flush
      await processor.enqueue(makeEvent()); // queued

      expect(flushSpy).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(600);
      await Promise.resolve(); // allow microtasks
      await Promise.resolve();

      expect(flushSpy).toHaveBeenCalledTimes(2);
      vi.useRealTimers();
    });
  });

  describe('beforeSend hook', () => {
    it('drops event when beforeSend returns null', async () => {
      const flushedEvents: SerializedEvent[] = [];
      const flushSpy = vi.fn().mockImplementation(async (events: SerializedEvent[]) => {
        flushedEvents.push(...events);
      });

      const { processor } = makeProcessor(
        {
          flushAt: 1000,
          flushInterval: 60_000,
          beforeSend: (_e) => null,
        },
        flushSpy,
      );

      await processor.enqueue(makeEvent());
      await processor.flush();

      expect(flushedEvents).toHaveLength(0);
    });

    it('modifies event when beforeSend transforms it (PII scrub)', async () => {
      const flushedEvents: SerializedEvent[] = [];
      const flushSpy = vi.fn().mockImplementation(async (events: SerializedEvent[]) => {
        flushedEvents.push(...events);
      });

      const { processor } = makeProcessor(
        {
          flushAt: 1000,
          flushInterval: 60_000,
          beforeSend: (e) => ({ ...e, attribution: { scrubbed: true } }),
        },
        flushSpy,
      );

      await processor.enqueue(makeEvent({ attribution: { user_email: 'secret@example.com' } }));
      await processor.flush();

      expect(flushedEvents[0]?.attribution).toEqual({ scrubbed: true });
    });

    it('supports async beforeSend', async () => {
      const flushedEvents: SerializedEvent[] = [];
      const flushSpy = vi.fn().mockImplementation(async (events: SerializedEvent[]) => {
        flushedEvents.push(...events);
      });

      const { processor } = makeProcessor(
        {
          flushAt: 1000,
          flushInterval: 60_000,
          beforeSend: async (e) => {
            await new Promise((r) => setTimeout(r, 1));
            return { ...e, metadata: { enriched: true } };
          },
        },
        flushSpy,
      );

      await processor.enqueue(makeEvent());
      await processor.flush();

      expect(flushedEvents[0]?.metadata).toEqual({ enriched: true });
    });

    it('passes event through when beforeSend returns event unchanged', async () => {
      const flushedEvents: SerializedEvent[] = [];
      const flushSpy = vi.fn().mockImplementation(async (events: SerializedEvent[]) => {
        flushedEvents.push(...events);
      });

      const evt = makeEvent({ metric: 'gpu_hours' });
      const { processor } = makeProcessor(
        {
          flushAt: 1000,
          flushInterval: 60_000,
          beforeSend: (e) => e,
        },
        flushSpy,
      );

      await processor.enqueue(evt);
      await processor.flush();

      expect(flushedEvents[0]?.metric).toBe('gpu_hours');
    });
  });

  describe('beforeFlush hook', () => {
    it('drops entire batch when beforeFlush returns null', async () => {
      const flushedEvents: SerializedEvent[] = [];
      const flushSpy = vi.fn().mockImplementation(async (events: SerializedEvent[]) => {
        flushedEvents.push(...events);
      });

      const { processor } = makeProcessor(
        {
          flushAt: 1000,
          flushInterval: 60_000,
          beforeFlush: (_batch) => null,
        },
        flushSpy,
      );

      await processor.enqueue(makeEvent());
      await processor.enqueue(makeEvent());
      await processor.flush();

      expect(flushSpy).not.toHaveBeenCalled();
    });

    it('can filter batch (return subset)', async () => {
      const flushedEvents: SerializedEvent[] = [];
      const flushSpy = vi.fn().mockImplementation(async (events: SerializedEvent[]) => {
        flushedEvents.push(...events);
      });

      const { processor } = makeProcessor(
        {
          flushAt: 1000,
          flushInterval: 60_000,
          beforeFlush: (batch) => batch.filter((e) => e.metric !== 'skip_me'),
        },
        flushSpy,
      );

      await processor.enqueue(makeEvent({ metric: 'keep_me' }));
      await processor.enqueue(makeEvent({ metric: 'skip_me' }));
      await processor.enqueue(makeEvent({ metric: 'keep_me' }));
      await processor.flush();

      expect(flushedEvents.every((e) => e.metric === 'keep_me')).toBe(true);
      expect(flushedEvents).toHaveLength(2);
    });
  });

  describe('ring buffer', () => {
    it('evicts oldest events when maxQueueSize exceeded', async () => {
      const flushedBatches: SerializedEvent[][] = [];
      const flushSpy = vi.fn().mockImplementation(async (events: SerializedEvent[]) => {
        flushedBatches.push([...events]);
      });

      const { processor } = makeProcessor(
        {
          flushAt: 1000,
          flushInterval: 60_000,
          maxQueueSize: 3,
        },
        flushSpy,
      );

      // First event flushes immediately (first-event fast path)
      const e0 = makeEvent({ metric: 'e0' });
      await processor.enqueue(e0); // immediate flush

      // Now fill queue to max
      const e1 = makeEvent({ metric: 'e1' });
      const e2 = makeEvent({ metric: 'e2' });
      const e3 = makeEvent({ metric: 'e3' });
      await processor.enqueue(e1);
      await processor.enqueue(e2);
      await processor.enqueue(e3);

      // Next event should evict e1 (oldest)
      const e4 = makeEvent({ metric: 'e4' });
      await processor.enqueue(e4);

      await processor.flush();

      const allFlushed = flushedBatches.flat();
      const metrics = allFlushed.map((e) => e.metric);

      // e1 was evicted
      expect(metrics).not.toContain('e1');
      // e2, e3, e4 should be there
      expect(metrics).toContain('e2');
      expect(metrics).toContain('e3');
      expect(metrics).toContain('e4');
    });
  });

  describe('shutdown', () => {
    it('flushes remaining queue on shutdown', async () => {
      const flushedEvents: SerializedEvent[] = [];
      const flushSpy = vi.fn().mockImplementation(async (events: SerializedEvent[]) => {
        flushedEvents.push(...events);
      });

      const { processor } = makeProcessor({ flushAt: 100, flushInterval: 60_000 }, flushSpy);

      // First event auto-flushes (first-event fast path)
      await processor.enqueue(makeEvent());
      await processor.enqueue(makeEvent());
      await processor.enqueue(makeEvent());

      await processor.shutdown();

      // All events should have been flushed
      expect(flushedEvents.length).toBeGreaterThanOrEqual(3);
    });
  });
});
