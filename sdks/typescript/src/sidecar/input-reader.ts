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
export const MAX_LINE_BYTES = 1_048_576;

const TOO_LONG_MESSAGE = `Line exceeds ${MAX_LINE_BYTES} bytes`;

/**
 * True when a line is larger than the limit in UTF-8 bytes, not in characters. A trailing carriage
 * return belongs to a CRLF line ending, so it does not count. A UTF-16 unit takes between one and
 * three bytes, which lets the length alone settle most lines without counting bytes.
 */
function exceedsLineLimit(text: string): boolean {
  const end = text.endsWith('\r') ? text.length - 1 : text.length;
  if (end > MAX_LINE_BYTES) return true;
  if (end * 3 <= MAX_LINE_BYTES) return false;
  return Buffer.byteLength(text.slice(0, end), 'utf8') > MAX_LINE_BYTES;
}

export function pipeLines(
  readable: Readable,
  onLine: (line: string) => void,
  onError?: InputErrorCallback,
): void {
  let buf = '';
  // After an oversized line starts, everything up to its newline is dropped, so the tail of the
  // line is not parsed as if it were a line of its own.
  let discarding = false;
  const reportTooLong = (): void => {
    onError?.(new Error(TOO_LONG_MESSAGE), '');
  };

  readable.on('data', (chunk: Buffer | string) => {
    let text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');

    if (discarding) {
      const newline = text.indexOf('\n');
      if (newline === -1) return;
      discarding = false;
      text = text.slice(newline + 1);
    }

    const parts = (buf + text).split('\n');
    buf = parts.pop() ?? '';
    // Every part left in the array is a complete line.
    for (const raw of parts) {
      if (exceedsLineLimit(raw)) {
        reportTooLong();
        continue;
      }
      const line = raw.trim();
      if (line.length > 0) onLine(line);
    }

    if (exceedsLineLimit(buf)) {
      reportTooLong();
      buf = '';
      discarding = true;
    }
  });
  readable.on('end', () => {
    if (!discarding) {
      if (exceedsLineLimit(buf)) {
        reportTooLong();
      } else {
        const remaining = buf.trim();
        if (remaining.length > 0) onLine(remaining);
      }
    }
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
      pipeLines(process.stdin, (line) => dispatchLine(line, onEvent, onError), onError);
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
  // While inside a line longer than the limit, skip its remaining bytes to the next newline instead
  // of parsing the tail as a line of its own.
  let discarding = false;
  let lastReadError = '';

  const reportTooLong = (): void => {
    onError(new Error(TOO_LONG_MESSAGE), '');
  };

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
        lastReadError = '';

        if (discarding) {
          const newline = buf.indexOf('\n');
          if (newline === -1) {
            cursor = stat.size;
            resolve();
            return;
          }
          discarding = false;
          buf = buf.slice(newline + 1);
        }

        const lines = buf.split('\n');
        const tail = lines.pop() ?? '';

        for (const raw of lines) {
          if (exceedsLineLimit(raw)) {
            reportTooLong();
            continue;
          }
          const line = raw.trim();
          if (line.length > 0) dispatchLine(line, onEvent, onError);
        }

        // The last segment has no newline yet, so it is not a line. Keep its start so the next read
        // sees it whole, unless it already exceeds the limit, in which case it can only grow.
        if (tail.trim().length === 0) {
          cursor = stat.size;
        } else if (exceedsLineLimit(tail)) {
          reportTooLong();
          cursor = stat.size;
          discarding = true;
        } else {
          cursor = stat.size - Buffer.byteLength(tail, 'utf8');
        }

        resolve();
      });
      stream.on('error', (err: Error) => {
        // A file the process cannot read (for example the wrong permissions for a non-root user)
        // would otherwise read zero events without any sign of why. The poll runs every 200 ms,
        // so report each distinct failure once.
        if (err.message !== lastReadError) {
          lastReadError = err.message;
          onError(new Error(`Cannot read ${filePath}: ${err.message}`), '');
        }
        resolve();
      });
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
  const sockets = new Set<net.Socket>();

  return {
    async start(): Promise<void> {
      server = net.createServer((socket) => {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
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
        // net.Server.close() waits for every open connection to end, so a client that stays
        // connected would block shutdown until the idle timeout. Destroy them once the server stops.
        await new Promise<void>((resolve) => {
          server!.close(() => resolve());
          for (const socket of sockets) socket.destroy();
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
