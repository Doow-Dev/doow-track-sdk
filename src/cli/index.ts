#!/usr/bin/env node
/**
 * S83: doow-track CLI / daemon binary.
 *
 * Usage:
 *   doow-track --api-key dk_...                     # stdin pipe mode
 *   doow-track --config ./track.json                # file/daemon mode from config
 *   doow-track --config ./track.json --api-key dk_  # config + key override
 *   doow-track --version
 *
 * Pipe mode (stdin):
 *   echo '{"metric":"builds","quantity":1,"license_id":"lic_1"}' | doow-track --api-key dk_...
 *   → reads stdin, flushes, exits when stdin closes
 *
 * Daemon mode:
 *   doow-track --config ./track.json   (input.mode = file or tcp)
 *   → runs long-lived, SIGTERM = graceful shutdown, SIGHUP = config reload
 *
 * Flags:
 *   --config <path>    Path to JSON config file
 *   --api-key <key>    API key (overrides config + env)
 *   --pidfile <path>   Write PID to file
 *   --version          Print version and exit
 */

import { promises as fs } from 'fs';
import { DoowTracker } from '../tracker.js';
import type { DoowTrackerOptions, TrackEvent } from '../types.js';
import { createInputReader, parseInputMode } from '../sidecar/input-reader.js';
import type { InputReaderOptions } from '../sidecar/input-reader.js';
import { resolveConfig } from './config.js';
import type { CliConfig } from './config.js';

// ─── Version ───────────────────────────────────────────────────────────────

const VERSION = '0.1.0';

// ─── Arg parsing ──────────────────────────────────────────────────────────

interface ParsedArgs {
  configPath?: string;
  apiKey?: string;
  pidfile?: string;
  version: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2); // strip node + script
  const result: ParsedArgs = { version: false, help: false };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--version' || arg === '-v') {
      result.version = true;
    } else if (arg === '--help' || arg === '-h') {
      result.help = true;
    } else if (arg === '--config' || arg === '-c') {
      result.configPath = args[++i] ?? '';
    } else if (arg === '--api-key' || arg === '-k') {
      result.apiKey = args[++i] ?? '';
    } else if (arg === '--pidfile') {
      result.pidfile = args[++i] ?? '';
    }
  }

  return result;
}

// ─── PID file ─────────────────────────────────────────────────────────────

async function writePidFile(pidfile: string): Promise<void> {
  await fs.writeFile(pidfile, String(process.pid), 'utf8');
}

async function removePidFile(pidfile: string): Promise<void> {
  try {
    await fs.unlink(pidfile);
  } catch {
    // Best effort
  }
}

// ─── Input mode resolution ────────────────────────────────────────────────

function resolveInputMode(config: CliConfig): InputReaderOptions['mode'] {
  const inp = config.input;
  if (!inp || inp.mode === 'stdin') return 'stdin';
  if (inp.mode === 'file') {
    if (!inp.path) throw new Error('input.path is required when input.mode is "file"');
    return { type: 'file', path: inp.path };
  }
  if (inp.mode === 'tcp') {
    if (!inp.port) throw new Error('input.port is required when input.mode is "tcp"');
    return { type: 'tcp', port: inp.port };
  }
  // Fall back to env var parsing
  return parseInputMode(process.env['DOOW_TRACK_INPUT']);
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv);

  if (parsed.version) {
    process.stdout.write(`doow-track v${VERSION}\n`);
    process.exit(0);
  }

  if (parsed.help) {
    process.stdout.write(`Usage: doow-track [--config <path>] [--api-key <key>] [--pidfile <path>] [--version]\n`);
    process.exit(0);
  }

  // ─── Resolve config ─────────────────────────────────────────────────────

  const cliOverrides = parsed.apiKey ? { api_key: parsed.apiKey } : {};
  let config = await resolveConfig(parsed.configPath, cliOverrides);

  // ─── PID file ───────────────────────────────────────────────────────────

  if (parsed.pidfile) {
    await writePidFile(parsed.pidfile);
  }

  // ─── Build tracker ───────────────────────────────────────────────────────

  function buildTracker(cfg: CliConfig): DoowTracker {
    const opts: DoowTrackerOptions = {
      enabled: !cfg.disabled,
      onError: (err) => {
        process.stderr.write(`[doow-track] SDK error [${err.kind}]: ${err.message}\n`);
      },
    };
    if (cfg.endpoint !== undefined) opts.endpoint = cfg.endpoint;
    if (cfg.attribution !== undefined) opts.attribution = cfg.attribution;
    if (cfg.flush_at !== undefined) opts.flushAt = cfg.flush_at;
    if (cfg.flush_interval !== undefined) opts.flushInterval = cfg.flush_interval;
    if (cfg.debug !== undefined) opts.debug = cfg.debug;
    return new DoowTracker(cfg.api_key, opts);
  }

  let tracker = buildTracker(config);

  // ─── Input reader ────────────────────────────────────────────────────────

  const inputMode = resolveInputMode(config);

  function buildReader(trk: DoowTracker): ReturnType<typeof createInputReader> {
    return createInputReader({
      mode: inputMode,
      onEvent: (raw: string) => {
        try {
          const event = JSON.parse(raw) as TrackEvent;
          trk.track(event);
        } catch (e) {
          const err = e instanceof Error ? e : new Error(String(e));
          process.stderr.write(`[doow-track] Malformed event — skipping: ${err.message}\n`);
        }
      },
      onError: (err: Error, line: string) => {
        process.stderr.write(
          `[doow-track] Malformed line — skipping: ${err.message} | line: ${line.slice(0, 100)}\n`,
        );
      },
    });
  }

  let reader = buildReader(tracker);
  await reader.start();

  // ─── Stdin pipe-mode: exit when stdin closes ──────────────────────────────

  const isDaemon = inputMode !== 'stdin';

  if (!isDaemon) {
    // Pipe mode: wait for stdin to end then flush and exit
    process.stdin.on('end', () => {
      void (async () => {
        await reader.stop();
        await tracker.shutdown();
        if (parsed.pidfile) await removePidFile(parsed.pidfile);
        process.exit(0);
      })();
    });
  }

  // ─── Graceful shutdown ────────────────────────────────────────────────────

  let shuttingDown = false;

  async function shutdown(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stderr.write('[doow-track] Shutting down...\n');
    await reader.stop();
    await tracker.shutdown();
    if (parsed.pidfile) await removePidFile(parsed.pidfile);
    process.stderr.write('[doow-track] Shutdown complete.\n');
    process.exit(0);
  }

  // ─── SIGHUP: reload config ─────────────────────────────────────────────

  process.on('SIGHUP', () => {
    void (async () => {
      process.stderr.write('[doow-track] SIGHUP — reloading config...\n');
      try {
        const newConfig = await resolveConfig(parsed.configPath, cliOverrides);
        const oldTracker = tracker;
        const oldReader = reader;

        const newTracker = buildTracker(newConfig);
        const newReader = buildReader(newTracker);

        // Swap atomically
        tracker = newTracker;
        reader = newReader;
        config = newConfig;

        await oldReader.stop();
        await oldTracker.shutdown();
        await newReader.start();

        process.stderr.write('[doow-track] Config reloaded.\n');
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        process.stderr.write(`[doow-track] Config reload failed: ${err.message}\n`);
      }
    })();
  });

  process.on('SIGTERM', () => { void shutdown(); });
  process.on('SIGINT', () => { void shutdown(); });

  if (isDaemon) {
    process.stderr.write(`[doow-track] Daemon running (PID ${process.pid}).\n`);
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`[doow-track] Fatal error: ${String(err)}\n`);
  process.exit(1);
});
