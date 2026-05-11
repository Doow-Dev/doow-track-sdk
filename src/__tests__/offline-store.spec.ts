/**
 * S80: Offline persistent store
 *
 * Tests:
 * - Store receives batch on delivery failure
 * - Store drains on reconnect (next flush)
 * - FileOfflineStore atomic writes (write + rename)
 * - FileOfflineStore shift returns oldest first (FIFO)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Exporter } from '../exporter.js';
import { FileOfflineStore } from '../file-offline-store.js';
import type { CustomTransport, OfflineStore, SerializedBatch, SerializedEvent } from '../types.js';

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
  offlineStore?: OfflineStore,
  overrides: Partial<ConstructorParameters<typeof Exporter>[0]> = {},
): Exporter {
  return new Exporter({
    endpoint: 'https://api.doow.co',
    apiKey: 'dk_test_key',
    timeout: 5000,
    retryCount: 0,
    disableCompression: true,
    maxConcurrentFlushes: 30,
    onError: vi.fn(),
    transport,
    offlineStore,
    debug: { log: () => undefined, warn: () => undefined },
    ...overrides,
  });
}

/** Simple in-memory OfflineStore for testing */
class MemoryOfflineStore implements OfflineStore {
  private _queue: SerializedBatch[] = [];

  async push(batch: SerializedBatch): Promise<void> {
    this._queue.push(batch);
  }

  async shift(): Promise<SerializedBatch | undefined> {
    return this._queue.shift();
  }

  async length(): Promise<number> {
    return this._queue.length;
  }

  get queue(): SerializedBatch[] {
    return this._queue;
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('S80: Offline persistent store', () => {
  describe('in-memory OfflineStore behavior', () => {
    it('store receives batch on delivery failure (all retries exhausted)', async () => {
      const store = new MemoryOfflineStore();
      const failTransport: CustomTransport = {
        send: async () => ({ status: 503, headers: {}, body: 'server error' }),
      };

      const exporter = makeExporter(failTransport, store, { retryCount: 0 });
      await exporter.flush([makeEvent(1), makeEvent(2)]);

      // Batch should have been persisted to the offline store
      expect(await store.length()).toBe(1);
      const stored = store.queue[0];
      expect(stored).toBeDefined();
      expect(stored!.batch_id).toBeDefined();
      expect(stored!.timestamp).toBeDefined();

      const payload = JSON.parse(stored!.payload) as { events: SerializedEvent[] };
      expect(payload.events).toHaveLength(2);
      expect(payload.events[0]?.event_id).toBe('evt-1');
    });

    it('successful flush does not write to offline store', async () => {
      const store = new MemoryOfflineStore();
      const successTransport: CustomTransport = {
        send: async () => ({ status: 202, headers: {}, body: '{}' }),
      };

      const exporter = makeExporter(successTransport, store);
      await exporter.flush([makeEvent(1)]);

      expect(await store.length()).toBe(0);
    });

    it('store drains FIFO on next successful flush', async () => {
      const store = new MemoryOfflineStore();
      const drained: SerializedEvent[][] = [];
      let shouldFail = true;

      const transport: CustomTransport = {
        send: async (payload) => {
          if (shouldFail) {
            return { status: 503, headers: {}, body: 'error' };
          }
          // Capture what was sent
          const body = JSON.parse(payload.body.toString()) as { events: SerializedEvent[] };
          drained.push(body.events);
          return { status: 202, headers: {}, body: '{}' };
        },
      };

      const exporter = makeExporter(transport, store, { retryCount: 0 });

      // First flush fails — batch goes to store
      await exporter.flush([makeEvent(1), makeEvent(2)]);
      expect(await store.length()).toBe(1);

      // Reconnect — next flush should drain store first, then send new events
      shouldFail = false;
      await exporter.flush([makeEvent(3)]);

      // drained[0] = offline batch (events 1 + 2)
      // drained[1] = new events (event 3)
      expect(drained).toHaveLength(2);
      expect(drained[0]?.map((e) => e.event_id)).toEqual(['evt-1', 'evt-2']);
      expect(drained[1]?.map((e) => e.event_id)).toEqual(['evt-3']);
      expect(await store.length()).toBe(0);
    });

    it('store is not used when offlineStore option is absent', async () => {
      const failTransport: CustomTransport = {
        send: async () => ({ status: 503, headers: {}, body: 'error' }),
      };

      // No offlineStore option
      const exporter = makeExporter(failTransport, undefined, { retryCount: 0 });

      // Should not throw — just calls onError
      await expect(exporter.flush([makeEvent(1)])).resolves.toBeUndefined();
    });

    it('multiple failed batches drain in FIFO order', async () => {
      // Pre-populate the offline store with two batches directly (simulating
      // two prior failed flushes that were persisted in a previous session/exporter).
      // Then verify that a new exporter drains them FIFO before sending new events.
      const store = new MemoryOfflineStore();

      // Seed two batches into the store manually
      await store.push({
        batch_id: 'pre-batch-1',
        payload: JSON.stringify({ batch_id: 'pre-batch-1', sdk_version: '0.1.0', events: [makeEvent(1)] }),
        timestamp: new Date().toISOString(),
      });
      await store.push({
        batch_id: 'pre-batch-2',
        payload: JSON.stringify({ batch_id: 'pre-batch-2', sdk_version: '0.1.0', events: [makeEvent(2)] }),
        timestamp: new Date().toISOString(),
      });

      expect(await store.length()).toBe(2);

      const drained: string[][] = [];
      const successTransport: CustomTransport = {
        send: async (payload) => {
          const body = JSON.parse(payload.body.toString()) as { events: SerializedEvent[] };
          drained.push(body.events.map((e) => e.event_id));
          return { status: 202, headers: {}, body: '{}' };
        },
      };

      // New exporter with the pre-seeded store — flush new events
      const exporter = makeExporter(successTransport, store, { retryCount: 0 });
      await exporter.flush([makeEvent(3)]);

      // Drained: pre-batch-1 (evt-1), pre-batch-2 (evt-2), then new evt-3
      expect(drained[0]).toEqual(['evt-1']);
      expect(drained[1]).toEqual(['evt-2']);
      expect(drained[2]).toEqual(['evt-3']);
      expect(await store.length()).toBe(0);
    });
  });

  describe('FileOfflineStore', () => {
    let testDir: string;

    beforeEach(async () => {
      testDir = join(tmpdir(), `doow-track-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    });

    async function cleanup(dir: string): Promise<void> {
      try {
        await fs.rm(dir, { recursive: true, force: true });
      } catch {
        // Best effort cleanup
      }
    }

    it('creates directory if it does not exist', async () => {
      const store = new FileOfflineStore(testDir);
      await store.push({
        batch_id: 'batch-1',
        payload: '{"events":[]}',
        timestamp: new Date().toISOString(),
      });

      const stat = await fs.stat(testDir);
      expect(stat.isDirectory()).toBe(true);

      await cleanup(testDir);
    });

    it('push writes a JSON file to the configured directory', async () => {
      const store = new FileOfflineStore(testDir);
      const batch: SerializedBatch = {
        batch_id: 'batch-abc',
        payload: '{"events":[{"event_id":"e1"}]}',
        timestamp: '2026-04-20T10:00:00.000Z',
      };

      await store.push(batch);

      const files = await fs.readdir(testDir);
      const jsonFiles = files.filter((f) => f.endsWith('.json'));
      expect(jsonFiles).toHaveLength(1);

      const content = await fs.readFile(join(testDir, jsonFiles[0]!), 'utf8');
      const parsed = JSON.parse(content) as SerializedBatch;
      expect(parsed.batch_id).toBe('batch-abc');

      await cleanup(testDir);
    });

    it('atomic write: no .tmp files left after push', async () => {
      const store = new FileOfflineStore(testDir);
      await store.push({
        batch_id: 'batch-1',
        payload: '{"events":[]}',
        timestamp: new Date().toISOString(),
      });

      const files = await fs.readdir(testDir);
      const tmpFiles = files.filter((f) => f.includes('.tmp'));
      expect(tmpFiles).toHaveLength(0);

      await cleanup(testDir);
    });

    it('length() returns 0 for empty store', async () => {
      const store = new FileOfflineStore(testDir);
      expect(await store.length()).toBe(0);
    });

    it('length() reflects number of stored batches', async () => {
      const store = new FileOfflineStore(testDir);

      await store.push({ batch_id: 'b1', payload: '{}', timestamp: '2026-04-20T10:00:00.000Z' });
      expect(await store.length()).toBe(1);

      await store.push({ batch_id: 'b2', payload: '{}', timestamp: '2026-04-20T10:00:01.000Z' });
      expect(await store.length()).toBe(2);

      await cleanup(testDir);
    });

    it('shift() returns undefined on empty store', async () => {
      const store = new FileOfflineStore(testDir);
      expect(await store.shift()).toBeUndefined();
    });

    it('shift() returns the stored batch and removes the file', async () => {
      const store = new FileOfflineStore(testDir);
      const batch: SerializedBatch = {
        batch_id: 'batch-xyz',
        payload: '{"events":[]}',
        timestamp: new Date().toISOString(),
      };

      await store.push(batch);
      expect(await store.length()).toBe(1);

      const retrieved = await store.shift();
      expect(retrieved).toBeDefined();
      expect(retrieved!.batch_id).toBe('batch-xyz');

      // File should be removed
      expect(await store.length()).toBe(0);

      await cleanup(testDir);
    });

    it('shift() returns oldest first (FIFO)', async () => {
      const store = new FileOfflineStore(testDir);

      // Push in chronological order — different timestamps so filenames sort correctly
      await store.push({ batch_id: 'first', payload: '{}', timestamp: '2026-04-20T10:00:00.000Z' });
      // Small delay to ensure distinct filenames
      await new Promise((r) => setTimeout(r, 10));
      await store.push({ batch_id: 'second', payload: '{}', timestamp: '2026-04-20T10:00:01.000Z' });
      await new Promise((r) => setTimeout(r, 10));
      await store.push({ batch_id: 'third', payload: '{}', timestamp: '2026-04-20T10:00:02.000Z' });

      const a = await store.shift();
      const b = await store.shift();
      const c = await store.shift();

      expect(a!.batch_id).toBe('first');
      expect(b!.batch_id).toBe('second');
      expect(c!.batch_id).toBe('third');

      await cleanup(testDir);
    });

    it('FileOfflineStore integrates with Exporter — persists failed batches', async () => {
      const store = new FileOfflineStore(testDir);
      const failTransport: CustomTransport = {
        send: async () => ({ status: 503, headers: {}, body: 'error' }),
      };

      const exporter = makeExporter(failTransport, store, { retryCount: 0 });
      await exporter.flush([makeEvent(1)]);

      expect(await store.length()).toBe(1);
      const batch = await store.shift();
      expect(batch).toBeDefined();
      expect(batch!.batch_id).toBeDefined();

      await cleanup(testDir);
    });
  });
});
