import { afterEach, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import * as http from 'node:http';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { gunzipSync } from 'node:zlib';

const CLI = path.resolve(__dirname, '../../dist/cli.cjs');
const hasBuild = existsSync(CLI);

interface Harness {
  api: http.Server;
  events: () => number;
  endpoint: string;
}

async function startApi(): Promise<Harness> {
  let count = 0;
  const api = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      try {
        let raw = Buffer.concat(chunks);
        if (req.headers['content-encoding'] === 'gzip') raw = gunzipSync(raw);
        const body = JSON.parse(raw.toString('utf8')) as { events?: unknown[] };
        count += body.events?.length ?? 0;
      } catch {
        // ignore bodies that are not JSON
      }
      res.writeHead(202, { 'content-type': 'application/json' });
      res.end('{"accepted":1,"rejected":0}');
    });
  });
  await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', resolve));
  const { port } = api.address() as net.AddressInfo;
  return { api, events: () => count, endpoint: `http://127.0.0.1:${port}` };
}

async function until(check: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return check();
}

async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as net.AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

const line = (metric: string): string =>
  `${JSON.stringify({ metric, quantity: 1, license_id: 'lic_1' })}\n`;

describe.skipIf(!hasBuild)('doow-track CLI process', () => {
  const cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  function runCli(configPath: string): { child: ChildProcess; stderr: () => string } {
    const child = spawn(process.execPath, [CLI, '--config', configPath], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr!.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    cleanups.push(() => {
      child.kill('SIGKILL');
    });
    return { child, stderr: () => stderr };
  }

  async function writeConfig(dir: string, config: object): Promise<string> {
    const configPath = path.join(dir, 'config.json');
    await fs.writeFile(configPath, JSON.stringify(config), 'utf8');
    return configPath;
  }

  it('keeps reading the same file position when SIGHUP reloads the config', async () => {
    const api = await startApi();
    cleanups.push(() => new Promise<void>((resolve) => api.api.close(() => resolve())));
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'doow-cli-'));
    cleanups.push(() => fs.rm(dir, { recursive: true, force: true }));
    const events = path.join(dir, 'events.jsonl');
    await fs.writeFile(events, line('a') + line('b'), 'utf8');
    const configPath = await writeConfig(dir, {
      api_key: 'dk_cli_process_test',
      endpoint: api.endpoint,
      input: { mode: 'file', path: events },
      flush_at: 1,
      flush_interval: 300,
    });

    const { child, stderr } = runCli(configPath);
    expect(await until(() => api.events() === 2, 8000)).toBe(true);

    child.kill('SIGHUP');
    expect(await until(() => stderr().includes('Config reloaded'), 5000)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(api.events()).toBe(2);

    await fs.appendFile(events, line('c'), 'utf8');
    expect(await until(() => api.events() === 3, 8000)).toBe(true);
  }, 30_000);

  it('exits on SIGTERM while a TCP client is still connected', async () => {
    const api = await startApi();
    cleanups.push(() => new Promise<void>((resolve) => api.api.close(() => resolve())));
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'doow-cli-'));
    cleanups.push(() => fs.rm(dir, { recursive: true, force: true }));
    const port = await freePort();
    const configPath = await writeConfig(dir, {
      api_key: 'dk_cli_process_test',
      endpoint: api.endpoint,
      input: { mode: 'tcp', port },
      flush_at: 1,
      flush_interval: 300,
    });

    const { child, stderr } = runCli(configPath);
    await until(() => stderr().includes('Daemon running'), 8000);
    expect(stderr()).toContain('Daemon running');

    const client = net.createConnection(port, '127.0.0.1');
    cleanups.push(() => {
      client.destroy();
    });
    await new Promise<void>((resolve) => client.once('connect', () => resolve()));
    client.write(line('tcp'));
    expect(await until(() => api.events() === 1, 8000)).toBe(true);

    const exited = new Promise<number | null>((resolve) => child.once('exit', (code) => resolve(code)));
    child.kill('SIGTERM');
    const result = await Promise.race([
      exited,
      new Promise<'hung'>((resolve) => setTimeout(() => resolve('hung'), 4000)),
    ]);
    expect(result).toBe(0);
  }, 30_000);

  it('reports a piped line over 1 MiB and still sends the next line', async () => {
    const api = await startApi();
    cleanups.push(() => new Promise<void>((resolve) => api.api.close(() => resolve())));

    const child = spawn(process.execPath, [CLI], {
      stdio: ['pipe', 'ignore', 'pipe'],
      env: {
        ...process.env,
        DOOW_TRACK_API_KEY: 'dk_cli_process_test',
        DOOW_TRACK_ENDPOINT: api.endpoint,
        DOOW_TRACK_FLUSH_AT: '1',
      },
    });
    cleanups.push(() => {
      child.kill('SIGKILL');
    });
    let stderr = '';
    child.stderr!.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    const exited = new Promise<number | null>((resolve) => child.once('exit', (code) => resolve(code)));

    child.stdin!.write(`${'a'.repeat(1_100_000)}\n`);
    child.stdin!.write(line('after'));
    child.stdin!.end();

    expect(await exited).toBe(0);
    expect(stderr).toContain('Input error: Line exceeds 1048576 bytes');
    expect(api.events()).toBe(1);
  }, 30_000);
});
