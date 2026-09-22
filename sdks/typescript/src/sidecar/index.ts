#!/usr/bin/env node
/**
 * S82: Doow Track Sidecar — entry point.
 *
 * Reads events from stdin / file / TCP and batch-POSTs via DoowTracker.
 *
 * Required env:
 *   DOOW_TRACK_API_KEY          — SDK API key (must start with dk_)
 *
 * Optional env:
 *   DOOW_TRACK_INPUT            — stdin (default) | file:<path> | tcp:<port>
 *   DOOW_TRACK_HEALTH_PORT      — health check port (default 9090)
 *   DOOW_TRACK_ENDPOINT         — override API endpoint
 *   DOOW_TRACK_FLUSH_AT         — flush event count threshold
 *   DOOW_TRACK_FLUSH_INTERVAL   — flush interval ms
 *   DOOW_TRACK_DISABLED         — disable SDK
 *   DOOW_TRACK_DEBUG            — enable debug logging
 *   DOOW_TRACK_ATTRIBUTION      — JSON attribution bag
 */

import { DoowTracker } from '../tracker.js';
import type { TrackEvent } from '../types.js';
import { createHealthServer } from './health.js';
import { createInputReader, parseInputMode } from './input-reader.js';

async function main(): Promise<void> {
  // ─── Validate required env ───────────────────────────────────────────────

  const apiKey = process.env['DOOW_TRACK_API_KEY'];
  if (!apiKey) {
    console.error('[doow-sidecar] DOOW_TRACK_API_KEY is required');
    process.exit(1);
  }

  // ─── Build tracker ───────────────────────────────────────────────────────

  const tracker = new DoowTracker(apiKey, {
    onError: (err): void => {
      console.error(`[doow-sidecar] SDK error [${err.kind}]: ${err.message}`);
    },
  });

  // ─── Health server ───────────────────────────────────────────────────────

  const healthPort = parseInt(process.env['DOOW_TRACK_HEALTH_PORT'] ?? '9090', 10);
  const health = createHealthServer(healthPort);
  await health.start();

  // ─── Input reader ────────────────────────────────────────────────────────

  const inputMode = parseInputMode(process.env['DOOW_TRACK_INPUT']);

  const reader = createInputReader({
    mode: inputMode,
    onEvent: (raw: string): void => {
      try {
        const event = JSON.parse(raw) as TrackEvent;
        tracker.track(event);
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        console.warn(`[doow-sidecar] Malformed event — skipping: ${err.message}`);
      }
    },
    onError: (err: Error, line: string): void => {
      console.warn(
        `[doow-sidecar] Malformed line — skipping: ${err.message} | line: ${line.slice(0, 100)}`,
      );
    },
  });

  await reader.start();

  // ─── Graceful shutdown ───────────────────────────────────────────────────

  let shuttingDown = false;

  async function shutdown(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;

    process.stderr.write('[doow-sidecar] Shutting down...\n');
    await reader.stop();
    await tracker.shutdown();
    await health.stop();
    process.stderr.write('[doow-sidecar] Shutdown complete.\n');
    process.exit(0);
  }

  process.on('SIGTERM', (): void => {
    void shutdown();
  });
  process.on('SIGINT', (): void => {
    void shutdown();
  });

  process.stderr.write(`[doow-sidecar] Running. Health: http://localhost:${healthPort}/healthz\n`);
}

main().catch((err: unknown) => {
  console.error('[doow-sidecar] Fatal error:', err);
  process.exit(1);
});
