/**
 * S82: Health check HTTP server.
 *
 * Serves GET /healthz on DOOW_TRACK_HEALTH_PORT (default 9090).
 * Returns 200 OK with {"status":"ok"} when the sidecar is running.
 */

import * as http from 'http';

export interface HealthServer {
  start(): Promise<void>;
  stop(): Promise<void>;
  readonly port: number;
}

export function createHealthServer(port: number): HealthServer {
  let server: http.Server | null = null;

  const handler: http.RequestListener = (_req, res) => {
    const body = JSON.stringify({ status: 'ok' });
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Length': String(Buffer.byteLength(body)),
    });
    res.end(body);
  };

  return {
    get port(): number {
      return port;
    },

    async start(): Promise<void> {
      server = http.createServer(handler);
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
