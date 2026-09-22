/**
 * S85: End-to-end integration tests against the live E2-st telemetry stack.
 *
 * Verifies the full SDK → E2-st → RabbitMQ → consumer → metered_event_header
 * pipeline, including batch dedup (S31), rate limiting (S32), heartbeat (S33),
 * and sidecar/CLI binary end-to-end.
 *
 * REQUIRES a running doow-api with full infrastructure (Postgres, RabbitMQ, Redis).
 *
 * Env vars:
 *   DOOW_E2E_ENDPOINT  — e.g. http://localhost:4000
 *   DOOW_E2E_API_KEY   — a valid dk_ key (67 chars) seeded in the test DB
 *   DOOW_E2E_DB_URL    — postgres connection string for ledger verification
 *
 * Run:
 *   DOOW_E2E_ENDPOINT=http://localhost:4000 \
 *   DOOW_E2E_API_KEY=dk_<64hex> \
 *   DOOW_E2E_DB_URL=postgresql://doow:doow_test@localhost:5432/doow_test \
 *   npx vitest run src/__tests__/integration-e2e.spec.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'child_process';
import { join } from 'path';
import http from 'http';
import https from 'https';
import { createHash } from 'crypto';

const E2E_ENDPOINT = process.env['DOOW_E2E_ENDPOINT'];
const E2E_API_KEY = process.env['DOOW_E2E_API_KEY'];
const E2E_DB_URL = process.env['DOOW_E2E_DB_URL'];
const SKIP = !E2E_ENDPOINT || !E2E_API_KEY || !E2E_DB_URL;

// ─── DB helper (pg, available from root node_modules in CI) ─────────────────

interface DbRow { [key: string]: unknown }

/** Thin wrapper over pg.Client — dynamically imported so tests skip cleanly when pg is absent. */
async function connectDb() {
  const pg = await import('pg');
  const client = new pg.default.Client({ connectionString: E2E_DB_URL! });
  await client.connect();
  return {
    query: async (sql: string, params: unknown[] = []): Promise<DbRow[]> => {
      const result = await client.query(sql, params);
      return result.rows as DbRow[];
    },
    end: () => client.end(),
  };
}

/**
 * Poll the DB until the query returns at least `minRows` rows, or timeout.
 * The ingest pipeline is async (HTTP 202 → RabbitMQ → consumer → DB), so
 * we must poll for arrival rather than assert immediately.
 */
async function pollForRows(
  db: Awaited<ReturnType<typeof connectDb>>,
  sql: string,
  params: unknown[],
  minRows: number,
  timeoutMs = 10_000,
  intervalMs = 200,
): Promise<DbRow[]> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = await db.query(sql, params);
    if (rows.length >= minRows) return rows;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  // Final attempt
  return db.query(sql, params);
}

// ─── HTTP helpers ───────────────────────────────────────────────────────────

interface HttpResult {
  status: number;
  headers: Record<string, string>;
  body: string;
}

function rawPost(path: string, payload: object, apiKey: string): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, E2E_ENDPOINT!);
    const isHttps = url.protocol === 'https:';
    const client = isHttps ? https : http;
    const body = Buffer.from(JSON.stringify(payload));

    const req = client.request(
      {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Content-Length': String(body.length),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const headers: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers)) {
            if (typeof v === 'string') headers[k] = v;
          }
          resolve({ status: res.statusCode ?? 0, headers, body: Buffer.concat(chunks).toString('utf8') });
        });
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function testId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Seed constants (must match CI seed step) ──────────────────────────────

const SEED = {
  app_name: 'e2e_app',
  license_name: 'e2e_license',
  license_id: 'lic_e2e_test',
} as const;

function tupleHint(metricName: string) {
  return { app_name: SEED.app_name, license_name: SEED.license_name, metric_name: metricName };
}

// ─── SDK loader ─────────────────────────────────────────────────────────────

async function loadSdk() {
  const { DoowTracker } = await import('../tracker.js');
  return { DoowTracker };
}

type DoowTrackerClass = Awaited<ReturnType<typeof loadSdk>>['DoowTracker'];

// ─── Tests ──────────────────────────────────────────────────────────────────

describe.skipIf(SKIP)('S85: E2E — SDK → E2-st → metered_event_header', () => {
  let DoowTracker: DoowTrackerClass;
  let db: Awaited<ReturnType<typeof connectDb>>;

  beforeAll(async () => {
    const sdk = await loadSdk();
    DoowTracker = sdk.DoowTracker;
    db = await connectDb();
  });

  afterAll(async () => {
    await db?.end();
  });

  // ─── S30 + ledger: track() → 202 → event in metered_event_header ───────

  it('track() → 202 → event arrives in metered_event_header', async () => {
    const eventId = testId('e2e_track');

    // Use custom transport to forward to real server and capture response
    let serverStatus = 0;
    const meter = new DoowTracker(E2E_API_KEY!, {
      endpoint: E2E_ENDPOINT,
      flushAt: 1,
      disableCompression: true,
      transport: {
        async send(payload) {
          const url = new URL('/telemetry/events', E2E_ENDPOINT!);
          const isH = url.protocol === 'https:';
          const cl = isH ? https : http;
          return new Promise((resolve, reject) => {
            const req = cl.request(
              { hostname: url.hostname, port: url.port || (isH ? 443 : 80), path: url.pathname, method: 'POST', headers: payload.headers },
              (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (c: Buffer) => chunks.push(c));
                res.on('end', () => {
                  const h: Record<string, string> = {};
                  for (const [k, v] of Object.entries(res.headers)) { if (typeof v === 'string') h[k] = v; }
                  serverStatus = res.statusCode ?? 0;
                  resolve({ status: res.statusCode ?? 0, headers: h, body: Buffer.concat(chunks).toString('utf8') });
                });
                res.on('error', reject);
              },
            );
            req.on('error', reject);
            req.write(payload.body);
            req.end();
          });
        },
      },
    });

    // Track with a unique attribution tag so we can find it in the DB
    meter.track({
      metric: 'e2e_api_calls',
      quantity: 42,
      license_id: SEED.license_id,
      attribution: { e2e_tag: eventId },
    });

    await meter.shutdown();
    expect(serverStatus).toBe(202);

    // Poll the DB for the event (async pipeline: HTTP → RabbitMQ → consumer → DB)
    const rows = await pollForRows(
      db,
      `SELECT id, source_system, attribution_metadata FROM metered_event_header WHERE attribution_metadata->>'e2e_tag' = $1`,
      [eventId],
      1,
    );

    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0]!['source_system']).toBeDefined();
  });

  // ─── S30: Multi-measurement → metered_event_measurement children ────────

  it('multi-measurement event → measurement children in DB', async () => {
    const eventId = testId('evt_multi');
    const batchId = testId('batch_multi');
    const e2eTag = testId('tag_multi');

    const result = await rawPost('/telemetry/events', {
      sdk_version: '0.1.0-e2e',
      batch_id: batchId,
      events: [{
        event_id: eventId,
        occurred_at: new Date().toISOString(),
        source_system: 'e2e-test',
        license_id: SEED.license_id,
        measurements: [
          { metric_name: 'api_calls', quantity: 10, metric_tuple_hint: tupleHint('api_calls') },
          { metric_name: 'tokens', quantity: 500, metric_tuple_hint: tupleHint('tokens') },
        ],
        attribution: { e2e_tag: e2eTag },
      }],
    }, E2E_API_KEY!);

    expect(result.status).toBe(202);
    expect(JSON.parse(result.body).accepted).toBe(1);

    // Poll for the header row
    const headers = await pollForRows(
      db,
      `SELECT id FROM metered_event_header WHERE attribution_metadata->>'e2e_tag' = $1`,
      [e2eTag],
      1,
    );
    expect(headers.length).toBe(1);

    // Verify measurement children
    const measurements = await db.query(
      `SELECT quantity FROM metered_event_measurement WHERE event_id = $1 ORDER BY quantity`,
      [headers[0]!['id']],
    );
    expect(measurements.length).toBe(2);
    expect(parseFloat(measurements[0]!['quantity'] as string)).toBe(10);
    expect(parseFloat(measurements[1]!['quantity'] as string)).toBe(500);
  });

  // ─── S31: Batch dedup → no duplicate ledger rows ────────────────────────

  it('batch dedup — same batch_id → single ledger row', async () => {
    const eventId = testId('evt_dedup');
    const batchId = testId('batch_dedup');
    const e2eTag = testId('tag_dedup');

    const payload = {
      sdk_version: '0.1.0-e2e',
      batch_id: batchId,
      events: [{
        event_id: eventId,
        occurred_at: new Date().toISOString(),
        source_system: 'e2e-test',
        license_id: SEED.license_id,
        measurements: [{ metric_name: 'dedup_metric', quantity: 1, metric_tuple_hint: tupleHint('dedup_metric') }],
        attribution: { e2e_tag: e2eTag },
      }],
    };

    // First POST
    const first = await rawPost('/telemetry/events', payload, E2E_API_KEY!);
    expect(first.status).toBe(202);

    // Second POST with same batch_id
    const second = await rawPost('/telemetry/events', payload, E2E_API_KEY!);
    expect(second.status).toBe(202);

    // Wait for async processing
    await pollForRows(
      db,
      `SELECT id FROM metered_event_header WHERE attribution_metadata->>'e2e_tag' = $1`,
      [e2eTag],
      1,
    );

    // Allow extra time for any potential duplicate to land
    await new Promise((r) => setTimeout(r, 1000));

    // Verify exactly one row (no duplicates)
    const rows = await db.query(
      `SELECT id FROM metered_event_header WHERE attribution_metadata->>'e2e_tag' = $1`,
      [e2eTag],
    );
    expect(rows.length).toBe(1);
  });

  // ─── S32: Rate limit — 429 handling ─────────────────────────────────────

  it('rate limit — SDK reports RATE_LIMITED without stopping', async () => {
    const errors: Array<{ kind: string; statusCode?: number }> = [];
    const meter = new DoowTracker(E2E_API_KEY!, {
      endpoint: E2E_ENDPOINT,
      flushAt: 50,
      disableCompression: true,
      onError: (err) => errors.push({ kind: err.kind, statusCode: err.statusCode }),
    });

    for (let i = 0; i < 150; i++) {
      meter.track({ metric: 'e2e_rate_test', quantity: 1, license_id: SEED.license_id });
    }
    await meter.shutdown();

    // SDK must NOT stop on 429
    expect(meter.stopped).toBe(false);

    // If rate limits were hit, verify correct error kind
    const rlErrors = errors.filter((e) => e.kind === 'RATE_LIMITED');
    if (rlErrors.length > 0) {
      expect(rlErrors[0]!.statusCode).toBe(429);
    }
  });

  // ─── S29: Auth failure → 401 → SDK stops ───────────────────────────────

  it('auth failure — invalid key → 401 → SDK stops permanently', async () => {
    const errors: Array<{ kind: string }> = [];
    const meter = new DoowTracker('dk_' + '0'.repeat(64), {
      endpoint: E2E_ENDPOINT,
      flushAt: 1,
      disableCompression: true,
      onError: (err) => errors.push(err),
    });

    meter.track({ metric: 'e2e_auth_fail', quantity: 1, license_id: SEED.license_id });
    await meter.shutdown();

    expect(meter.stopped).toBe(true);
    expect(errors.some((e) => e.kind === 'AUTH_FAILURE')).toBe(true);
  });

  // ─── S33: Heartbeat → last_used_at updated on key ──────────────────────

  it('heartbeat → last_used_at updated on SDK API key', async () => {
    const keyHash = createHash('sha256').update(E2E_API_KEY!).digest('hex');

    // Record last_used_at before heartbeat
    const before = await db.query(
      `SELECT last_used_at FROM metered_sdk_api_key WHERE key_hash = $1`,
      [keyHash],
    );
    const beforeTs = before[0]?.['last_used_at'] as Date | null;

    // Send heartbeat
    const result = await rawPost('/telemetry/heartbeat', {}, E2E_API_KEY!);
    expect(result.status).toBeLessThan(300);
    expect(JSON.parse(result.body).ok).toBe(true);

    // Verify last_used_at was updated
    const after = await db.query(
      `SELECT last_used_at FROM metered_sdk_api_key WHERE key_hash = $1`,
      [keyHash],
    );
    const afterTs = after[0]?.['last_used_at'] as Date | null;

    expect(afterTs).not.toBeNull();
    if (beforeTs !== null) {
      expect(new Date(afterTs!).getTime()).toBeGreaterThanOrEqual(new Date(beforeTs).getTime());
    }
  });

  // ─── S30: Partial reject → 207 ─────────────────────────────────────────

  it('partial reject → 207 with rejections array', async () => {
    const batchId = testId('batch_partial');

    const result = await rawPost('/telemetry/events', {
      sdk_version: '0.1.0-e2e',
      batch_id: batchId,
      events: [
        {
          event_id: testId('evt_good'),
          occurred_at: new Date().toISOString(),
          source_system: 'e2e-test',
          license_id: SEED.license_id,
          measurements: [{ metric_name: 'calls', quantity: 1, metric_tuple_hint: tupleHint('calls') }],
        },
        {
          // Missing occurred_at → rejected by server validation
          event_id: testId('evt_bad'),
          source_system: 'e2e-test',
          license_id: SEED.license_id,
          measurements: [{ metric_name: 'calls', quantity: 1, metric_tuple_hint: tupleHint('calls') }],
        },
      ],
    }, E2E_API_KEY!);

    expect(result.status).toBe(207);
    const body = JSON.parse(result.body);
    expect(body.accepted).toBe(1);
    expect(body.rejected).toBe(1);
    expect(body.rejections).toBeInstanceOf(Array);
    expect(body.rejections.length).toBe(1);
    expect(body.rejections[0].reason).toBeDefined();
  });

  // ─── S82: Sidecar → stdin events arrive in ledger ─────────────────────

  it('sidecar binary — stdin events arrive in ledger', async () => {
    const sidecarPath = join(__dirname, '..', '..', 'dist', 'sidecar.cjs');
    const e2eTag = testId('tag_sidecar');
    const healthPort = 19090 + Math.floor(Math.random() * 1000);

    const child = spawn('node', [sidecarPath], {
      env: {
        ...process.env,
        DOOW_TRACK_API_KEY: E2E_API_KEY!,
        DOOW_TRACK_ENDPOINT: E2E_ENDPOINT!,
        DOOW_TRACK_INPUT: 'stdin',
        DOOW_TRACK_HEALTH_PORT: String(healthPort),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const stderr: string[] = [];
    child.stderr?.on('data', (data: Buffer) => stderr.push(data.toString()));

    // Poll healthz instead of fixed sleep
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const ok = await new Promise<boolean>((resolve) => {
        const req = http.get(`http://localhost:${healthPort}/healthz`, (res) => {
          res.resume();
          resolve(res.statusCode === 200);
        });
        req.on('error', () => resolve(false));
        req.setTimeout(200, () => { req.destroy(); resolve(false); });
      });
      if (ok) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    // Pipe a valid event with unique tag
    child.stdin?.write(JSON.stringify({
      metric: 'e2e_sidecar_test',
      quantity: 7,
      license_id: SEED.license_id,
      attribution: { e2e_tag: e2eTag },
    }) + '\n');

    await new Promise((r) => setTimeout(r, 1000));
    child.kill('SIGTERM');

    const exitCode = await new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(null); }, 5000);
      child.on('exit', (code) => { clearTimeout(timer); resolve(code); });
    });

    expect(exitCode).toBe(0);

    // Verify event arrived in ledger
    const rows = await pollForRows(
      db,
      `SELECT id FROM metered_event_header WHERE attribution_metadata->>'e2e_tag' = $1`,
      [e2eTag],
      1,
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  // ─── S83: CLI → pipe mode events arrive in ledger ─────────────────────

  it('CLI binary — pipe mode events arrive in ledger', async () => {
    const cliPath = join(__dirname, '..', '..', 'dist', 'cli.cjs');
    const e2eTag = testId('tag_cli');

    const child = spawn('node', [cliPath, '--api-key', E2E_API_KEY!], {
      env: {
        ...process.env,
        DOOW_TRACK_ENDPOINT: E2E_ENDPOINT!,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Write event and close stdin (triggers EOF → flush → exit)
    child.stdin?.write(JSON.stringify({
      metric: 'e2e_cli_test',
      quantity: 3,
      license_id: SEED.license_id,
      attribution: { e2e_tag: e2eTag },
    }) + '\n');
    child.stdin?.end();

    const exitCode = await new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(null); }, 10000);
      child.on('exit', (code) => { clearTimeout(timer); resolve(code); });
    });

    expect(exitCode).toBe(0);

    // Verify event arrived in ledger
    const rows = await pollForRows(
      db,
      `SELECT id FROM metered_event_header WHERE attribution_metadata->>'e2e_tag' = $1`,
      [e2eTag],
      1,
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  // ─── Gzip round-trip → accepted ───────────────────────────────────────

  it('gzip-compressed POST → 202 → event in ledger', async () => {
    const { createGzip } = await import('zlib');
    const batchId = testId('batch_gzip');
    const eventId = testId('evt_gzip');
    const e2eTag = testId('tag_gzip');

    const payload = JSON.stringify({
      sdk_version: '0.1.0-e2e',
      batch_id: batchId,
      events: [{
        event_id: eventId,
        occurred_at: new Date().toISOString(),
        source_system: 'e2e-test',
        license_id: SEED.license_id,
        measurements: [{ metric_name: 'gzip_test', quantity: 1, metric_tuple_hint: tupleHint('gzip_test') }],
        attribution: { e2e_tag: e2eTag },
      }],
    });

    const gzipped = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const gz = createGzip();
      gz.on('data', (chunk: Buffer) => chunks.push(chunk));
      gz.on('end', () => resolve(Buffer.concat(chunks)));
      gz.on('error', reject);
      gz.end(Buffer.from(payload));
    });

    const url = new URL('/telemetry/events', E2E_ENDPOINT!);
    const isHttps = url.protocol === 'https:';
    const client = isHttps ? https : http;

    const result = await new Promise<HttpResult>((resolve, reject) => {
      const req = client.request(
        {
          hostname: url.hostname,
          port: url.port || (isHttps ? 443 : 80),
          path: url.pathname,
          method: 'POST',
          headers: {
            Authorization: `Bearer ${E2E_API_KEY!}`,
            'Content-Type': 'application/json',
            'Content-Encoding': 'gzip',
            'Content-Length': String(gzipped.length),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => {
            const h: Record<string, string> = {};
            for (const [k, v] of Object.entries(res.headers)) { if (typeof v === 'string') h[k] = v; }
            resolve({ status: res.statusCode ?? 0, headers: h, body: Buffer.concat(chunks).toString('utf8') });
          });
          res.on('error', reject);
        },
      );
      req.on('error', reject);
      req.write(gzipped);
      req.end();
    });

    expect(result.status).toBe(202);

    // Verify event landed in DB
    const rows = await pollForRows(
      db,
      `SELECT id FROM metered_event_header WHERE attribution_metadata->>'e2e_tag' = $1`,
      [e2eTag],
      1,
    );
    expect(rows.length).toBe(1);
  });
});
