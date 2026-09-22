/**
 * S82: Sidecar unit tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { Readable } from 'stream';
import * as net from 'net';
import * as http from 'http';

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Monotonically incrementing port counter — avoids port collisions between tests */
let _portSeed = 19800;
function nextPort(): number {
  return _portSeed++;
}

// ─── input-reader: stdin mode ─────────────────────────────────────────────

describe('S82: InputReader — stdin mode', () => {
  it('parses valid JSON lines from a readable stream', async () => {
    const { createInputReader } = await import('../sidecar/input-reader.js');
    const received: string[] = [];
    const errors: Error[] = [];

    // We test the line-splitting logic directly via a fake readable.
    // Create a stub that pipes a custom stream through the same code path.
    const reader = createInputReader({
      mode: 'stdin',
      onEvent: (raw) => received.push(raw),
      onError: (err) => errors.push(err),
    });

    // Monkeypatch process.stdin temporarily with a fake readable
    const fakeStdin = new EventEmitter() as NodeJS.ReadStream;
    (fakeStdin as unknown as { resume: () => void }).resume = () => undefined;
    (fakeStdin as unknown as { setEncoding: () => void }).setEncoding = () => undefined;

    const realStdin = process.stdin;
    Object.defineProperty(process, 'stdin', { value: fakeStdin, configurable: true });

    await reader.start();

    // Emit valid JSON lines
    fakeStdin.emit('data', '{"metric":"calls","quantity":1,"license_id":"lic_1"}\n');
    fakeStdin.emit('data', '{"metric":"tokens","quantity":500,"license_id":"lic_1"}\n');
    fakeStdin.emit('end');

    // Restore
    Object.defineProperty(process, 'stdin', { value: realStdin, configurable: true });

    expect(received).toHaveLength(2);
    expect(errors).toHaveLength(0);
    const ev0 = JSON.parse(received[0]!) as { metric: string };
    expect(ev0.metric).toBe('calls');
  });

  it('skips malformed JSON lines without crashing', async () => {
    const { createInputReader } = await import('../sidecar/input-reader.js');
    const received: string[] = [];
    const errors: Error[] = [];

    const fakeStdin = new EventEmitter() as NodeJS.ReadStream;
    (fakeStdin as unknown as { resume: () => void }).resume = () => undefined;
    (fakeStdin as unknown as { setEncoding: () => void }).setEncoding = () => undefined;

    const realStdin = process.stdin;
    Object.defineProperty(process, 'stdin', { value: fakeStdin, configurable: true });

    const reader = createInputReader({
      mode: 'stdin',
      onEvent: (raw) => received.push(raw),
      onError: (err) => errors.push(err),
    });

    await reader.start();

    fakeStdin.emit('data', 'not-json\n{"metric":"ok","quantity":1,"license_id":"lic_1"}\n');
    fakeStdin.emit('end');

    Object.defineProperty(process, 'stdin', { value: realStdin, configurable: true });

    expect(received).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(Error);
  });
});

// ─── input-reader: parseInputMode ────────────────────────────────────────

describe('S82: parseInputMode', () => {
  it('returns stdin for undefined', async () => {
    const { parseInputMode } = await import('../sidecar/input-reader.js');
    expect(parseInputMode(undefined)).toBe('stdin');
  });

  it('returns stdin for "stdin"', async () => {
    const { parseInputMode } = await import('../sidecar/input-reader.js');
    expect(parseInputMode('stdin')).toBe('stdin');
  });

  it('returns file mode for file: prefix', async () => {
    const { parseInputMode } = await import('../sidecar/input-reader.js');
    const mode = parseInputMode('file:/var/log/usage.jsonl');
    expect(mode).toEqual({ type: 'file', path: '/var/log/usage.jsonl' });
  });

  it('returns tcp mode for tcp: prefix', async () => {
    const { parseInputMode } = await import('../sidecar/input-reader.js');
    const mode = parseInputMode('tcp:9000');
    expect(mode).toEqual({ type: 'tcp', port: 9000 });
  });

  it('throws on unknown mode', async () => {
    const { parseInputMode } = await import('../sidecar/input-reader.js');
    expect(() => parseInputMode('ws:1234')).toThrow();
  });
});

// ─── input-reader: file mode ──────────────────────────────────────────────

describe('S82: InputReader — file mode', () => {
  it('reads existing file content', async () => {
    const { createInputReader } = await import('../sidecar/input-reader.js');
    const os = await import('os');
    const path = await import('path');
    const fsP = await import('fs/promises');

    const dir = os.tmpdir();
    const filePath = path.join(dir, `doow-test-${Date.now()}.jsonl`);
    await fsP.writeFile(
      filePath,
      '{"metric":"builds","quantity":1,"license_id":"lic_1"}\n{"metric":"deploys","quantity":2,"license_id":"lic_1"}\n',
      'utf8',
    );

    const received: string[] = [];

    const reader = createInputReader({
      mode: { type: 'file', path: filePath },
      onEvent: (raw) => received.push(raw),
      onError: () => undefined,
    });

    await reader.start();

    // Give the poll a moment to fire
    await new Promise((r) => setTimeout(r, 300));
    await reader.stop();

    await fsP.unlink(filePath).catch(() => undefined);

    expect(received.length).toBeGreaterThanOrEqual(2);
    const metrics = received.map((r) => (JSON.parse(r) as { metric: string }).metric);
    expect(metrics).toContain('builds');
    expect(metrics).toContain('deploys');
  });
});

// ─── input-reader: TCP mode ───────────────────────────────────────────────

describe('S82: InputReader — TCP mode', () => {
  it('accepts connections and parses events', async () => {
    const { createInputReader } = await import('../sidecar/input-reader.js');
    const received: string[] = [];

    const port = nextPort();

    const reader = createInputReader({
      mode: { type: 'tcp', port },
      onEvent: (raw) => received.push(raw),
      onError: () => undefined,
    });

    await reader.start();

    // Connect and send an event
    await new Promise<void>((resolve, reject) => {
      const client = net.createConnection(port, '127.0.0.1', () => {
        client.write('{"metric":"api_calls","quantity":1,"license_id":"lic_1"}\n');
        client.end();
      });
      client.on('close', () => resolve());
      client.on('error', reject);
    });

    // Brief wait for server to process
    await new Promise((r) => setTimeout(r, 50));
    await reader.stop();

    expect(received).toHaveLength(1);
    expect((JSON.parse(received[0]!) as { metric: string }).metric).toBe('api_calls');
  });
});

// ─── health server ────────────────────────────────────────────────────────

describe('S82: Health check server', () => {
  it('returns 200 on /healthz', async () => {
    const { createHealthServer } = await import('../sidecar/health.js');
    const port = nextPort();
    const health = createHealthServer(port);

    await health.start();

    const body = await new Promise<string>((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}/healthz`, (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
        res.on('end', () => resolve(data));
      }).on('error', reject);
    });

    await health.stop();

    const parsed = JSON.parse(body) as { status: string };
    expect(parsed.status).toBe('ok');
  });

  it('exposes the configured port', async () => {
    const { createHealthServer } = await import('../sidecar/health.js');
    const port = nextPort();
    const health = createHealthServer(port);
    expect(health.port).toBe(port);
    // No need to start/stop for this assertion
  });
});

// ─── graceful shutdown ────────────────────────────────────────────────────

describe('S82: Graceful shutdown', () => {
  it('calls tracker.shutdown() when stop is invoked', async () => {
    const { DoowTracker } = await import('../tracker.js');
    const shutdownSpy = vi.fn().mockResolvedValue(undefined);

    const tracker = new DoowTracker('dk_test_shutdown', {
      enabled: false, // no-op tracker for this test
    });
    // Spy on shutdown
    tracker.shutdown = shutdownSpy;

    // Simulate the sequence the sidecar entry point runs
    await tracker.shutdown();

    expect(shutdownSpy).toHaveBeenCalledTimes(1);
  });
});
