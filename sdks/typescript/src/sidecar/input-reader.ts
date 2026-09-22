/**
 * S82: InputReader — unified input source for sidecar and CLI.
 *
 * Supports three modes controlled by DOOW_TRACK_INPUT env var:
 *   stdin         — newline-delimited JSON from process.stdin (default)
 *   file:<path>   — tail a file, resuming from last cursor position
 *   tcp:<port>    — TCP socket server accepting newline-delimited JSON
 *
 * Each valid JSON line is passed to onEvent. Malformed lines call onError.
 * Call stop() to shut down cleanly.
 */

import { createReadStream, promises as fs } from 'fs';
import * as net from 'net';
import type { Readable } from 'stream';

export type InputEventCallback = (raw: string) => void;
export type InputErrorCallback = (err: Error, line: string) => void;

export interface InputReaderOptions {
  mode: 'stdin' | { type: 'file'; path: string } | { type: 'tcp'; port: number };
  onEvent: InputEventCallback;
  onError: InputErrorCallback;
}

export interface InputReader {
  start(): Promise<void>;
  stop(): Promise<void>;
}

// ─── Line splitter ─────────────────────────────────────────────────────────

/** Split a stream into lines, calling onLine for each complete line. */
const MAX_LINE_BYTES = 1_048_576;

function pipeLines(
  readable: Readable,
  onLine: (line: string) => void,
  onError?: InputErrorCallback,
): void {
  let buf = '';
  readable.on('data', (chunk: Buffer | string) => {
    buf += typeof chunk === 'string' ? chunk : chunk.toString('utf8');

    if (!buf.includes('\n') && buf.length > MAX_LINE_BYTES) {
      onError?.(new Error(`Line exceeds ${MAX_LINE_BYTES} bytes`), '');
      buf = '';
      return;
    }

    const parts = buf.split('\n');
    // All but last are complete lines
    for (let i = 0; i < parts.length - 1; i++) {
      const line = parts[i]!.trim();
      if (line.length > 0) onLine(line);
    }
    buf = parts[parts.length - 1] ?? '';
  });
  readable.on('end', () => {
    const remaining = buf.trim();
    if (remaining.length > 0) onLine(remaining);
    buf = '';
  });
}

// ─── Parse helper ──────────────────────────────────────────────────────────

function dispatchLine(
  line: string,
  onEvent: InputEventCallback,
  onError: InputErrorCallback,
): void {
  try {
    JSON.parse(line); // validate JSON — value not used here; caller validates shape
    onEvent(line);
  } catch (e) {
    onError(e instanceof Error ? e : new Error(String(e)), line);
  }
}

// ─── Stdin mode ────────────────────────────────────────────────────────────

function createStdinReader(onEvent: InputEventCallback, onError: InputErrorCallback): InputReader {
  let started = false;
  return {
    start(): Promise<void> {
      if (started) return Promise.resolve();
      started = true;
      process.stdin.resume();
      process.stdin.setEncoding('utf8');
      pipeLines(process.stdin, (line) => dispatchLine(line, onEvent, onError));
      return Promise.resolve();
    },
    stop(): Promise<void> {
      // stdin mode: just let it close naturally
      return Promise.resolve();
    },
  };
}

// ─── File tail mode ────────────────────────────────────────────────────────

function createFileReader(
  filePath: string,
  onEvent: InputEventCallback,
  onError: InputErrorCallback,
): InputReader {
  let stopped = false;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let cursor = 0; // byte offset into file

  async function readChunk(): Promise<void> {
    if (stopped) return;

    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stat = await fs.stat(filePath);
    } catch {
      // File doesn't exist yet — wait
      scheduleNext();
      return;
    }

    if (stat.size <= cursor) {
      // No new data
      scheduleNext();
      return;
    }

    // Read new bytes from cursor onward
    await new Promise<void>((resolve) => {
      const stream = createReadStream(filePath, {
        start: cursor,
        end: stat.size - 1,
        encoding: 'utf8',
      });

      let buf = '';
      stream.on('data', (chunk: string | Buffer) => {
        buf += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      });
      stream.on('end', () => {
        cursor = stat.size;
        // Process lines
        const lines = buf.split('\n');
        for (let i = 0; i < lines.length - 1; i++) {
          const line = lines[i]!.trim();
          if (line.length > 0) dispatchLine(line, onEvent, onError);
        }
        // Last segment may be incomplete — don't advance cursor past it
        const last = lines[lines.length - 1]!.trim();
        if (last.length > 0) {
          // Rewind cursor to not skip the incomplete line
          cursor -= Buffer.byteLength(lines[lines.length - 1]!, 'utf8');
        }
        resolve();
      });
      stream.on('error', () => resolve());
    });

    scheduleNext();
  }

  function scheduleNext(): void {
    if (stopped) return;
    pollTimer = setTimeout(() => {
      void readChunk();
    }, 200);
  }

  return {
    start(): Promise<void> {
      // Read existing content first, then poll for new content
      return readChunk();
    },
    stop(): Promise<void> {
      stopped = true;
      if (pollTimer !== null) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }
      return Promise.resolve();
    },
  };
}

// ─── TCP mode ──────────────────────────────────────────────────────────────

const MAX_TCP_CONNECTIONS = 10;

function createTcpReader(
  port: number,
  onEvent: InputEventCallback,
  onError: InputErrorCallback,
): InputReader {
  let server: net.Server | null = null;

  return {
    async start(): Promise<void> {
      server = net.createServer((socket) => {
        socket.setEncoding('utf8');
        socket.setTimeout(60_000, () => socket.destroy());
        pipeLines(socket, (line) => dispatchLine(line, onEvent, onError), onError);
        socket.on('error', () => {
          /* ignore individual socket errors */
        });
      });
      server.maxConnections = MAX_TCP_CONNECTIONS;

      await new Promise<void>((resolve, reject) => {
        server!.listen(port, () => resolve());
        server!.on('error', reject);
      });
    },
    async stop(): Promise<void> {
      if (server) {
        await new Promise<void>((resolve) => {
          server!.close(() => resolve());
        });
        server = null;
      }
    },
  };
}

// ─── Factory ───────────────────────────────────────────────────────────────

export function createInputReader(opts: InputReaderOptions): InputReader {
  const { mode, onEvent, onError } = opts;

  if (mode === 'stdin') {
    return createStdinReader(onEvent, onError);
  }

  if (mode.type === 'file') {
    return createFileReader(mode.path, onEvent, onError);
  }

  if (mode.type === 'tcp') {
    return createTcpReader(mode.port, onEvent, onError);
  }

  // TypeScript exhaustive check
  const _exhaustive: never = mode;
  throw new Error(`Unknown input mode: ${JSON.stringify(_exhaustive)}`);
}

// ─── Env-based factory ────────────────────────────────────────────────────

/**
 * Parse DOOW_TRACK_INPUT env var and return the appropriate mode config.
 *   ""            → stdin
 *   "stdin"       → stdin
 *   "file:/path"  → file mode
 *   "tcp:9000"    → TCP mode on port 9000
 */
export function parseInputMode(envValue: string | undefined): InputReaderOptions['mode'] {
  if (!envValue || envValue === 'stdin') return 'stdin';

  if (envValue.startsWith('file:')) {
    const filePath = envValue.slice('file:'.length);
    if (!filePath) throw new Error(`DOOW_TRACK_INPUT file: mode requires a path`);
    return { type: 'file', path: filePath };
  }

  if (envValue.startsWith('tcp:')) {
    const portStr = envValue.slice('tcp:'.length);
    const port = parseInt(portStr, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      throw new Error(`DOOW_TRACK_INPUT tcp: mode requires a valid port number`);
    }
    return { type: 'tcp', port };
  }

  throw new Error(
    `Unknown DOOW_TRACK_INPUT value: "${envValue}". Use stdin, file:<path>, or tcp:<port>.`,
  );
}
