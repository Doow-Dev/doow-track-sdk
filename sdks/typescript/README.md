# @doow/track

Customer-facing SDK for emitting usage telemetry to Doow. Tracks metered usage events (API calls, tokens, storage, requests, etc.) from any Node.js application.

Project home: https://github.com/Doow-Dev/doow-track-sdk

## Quick start

```ts
import { DoowTracker } from '@doow/track';

const meter = new DoowTracker('dk_your_api_key');
meter.track({ metric: 'api_calls', quantity: 1, license_id: 'lic_...' });
await meter.shutdown();
```

## Installation

```bash
npm install @doow/track
# or
yarn add @doow/track
```

## All init options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `endpoint` | `string` | `https://api.doow.co` | Telemetry server endpoint |
| `enabled` | `boolean` | `true` | Enable/disable the SDK. When `false`, all operations are no-ops |
| `attribution` | `Record<string, string \| number \| boolean>` | `undefined` | SDK-level attribution bag merged into every event |
| `debug` | `boolean` | `false` | Enable debug logging (only works in non-production builds) |
| `flushAt` | `number` | `20` | Flush after N events queued |
| `flushInterval` | `number` | `10000` | Flush every N milliseconds |
| `maxPayloadBytes` | `number` | `460800` | Max payload bytes (450 KB) before triggering a flush |
| `maxQueueSize` | `number` | `10000` | Max events in ring buffer before dropping oldest |
| `timeout` | `number` | `10000` | Per-request timeout in milliseconds |
| `retryCount` | `number` | `3` | Max retries on transient failures |
| `disableCompression` | `boolean` | `false` | Disable gzip compression |
| `onError` | `(error: SdkError) => void` | `console.warn` | Called on errors — SDK never throws |
| `beforeSend` | `(event: SerializedEvent) => SerializedEvent \| null` | `undefined` | Per-event hook. Return `null` to drop the event |
| `beforeFlush` | `(batch: SerializedEvent[]) => SerializedEvent[] \| null` | `undefined` | Per-batch hook. Return `null` to drop the entire batch |
| `transport` | `CustomTransport` | `undefined` | Custom HTTP transport (for testing, mTLS, HTTP/2) |
| `offlineStore` | `OfflineStore` | `undefined` | Offline persistent store for failed batches |
| `maxConcurrentFlushes` | `number` | `30` | Max concurrent network promises |
| `shutdownTimeout` | `number` | `5000` | Shutdown timeout in milliseconds |

## Environment variable overrides

All options can be overridden via environment variables. Env vars take precedence over code-level options.

| Variable | Overrides | Notes |
|----------|-----------|-------|
| `DOOW_TRACK_API_KEY` | first positional argument | Preferred over hard-coded key |
| `DOOW_TRACK_ENDPOINT` | `endpoint` | Override server URL |
| `DOOW_TRACK_DISABLED=true` | `enabled` | Disable the SDK entirely |
| `DOOW_TRACK_DEBUG=true` | `debug` | Enable debug output |
| `DOOW_TRACK_FLUSH_AT` | `flushAt` | Integer, e.g. `5` |
| `DOOW_TRACK_FLUSH_INTERVAL` | `flushInterval` | Milliseconds, e.g. `5000` |
| `DOOW_TRACK_ATTRIBUTION` | `attribution` | JSON string, e.g. `{"env":"prod"}` |

## Serverless guide

Long-lived Node.js processes use the timer-based auto-flush. In serverless environments (Lambda, Vercel, Azure Functions) the process exits after each invocation, so you need guaranteed flush before return.

### AWS Lambda

```ts
import { DoowTracker } from '@doow/track';

const meter = new DoowTracker(process.env.DOOW_API_KEY!);

export const handler = meter.withLambda(async (event, context) => {
  meter.track({ metric: 'api_calls', quantity: 1, license_id: 'lic_...' });
  return { statusCode: 200, body: 'ok' };
  // shutdown() is called automatically in a finally block
});
```

### Vercel

```ts
import { DoowTracker } from '@doow/track';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const meter = new DoowTracker(process.env.DOOW_API_KEY!);

export default meter.withVercel(async (req: VercelRequest, res: VercelResponse) => {
  meter.track({ metric: 'requests', quantity: 1, license_id: 'lic_...' });
  res.status(200).json({ ok: true });
});
```

### Azure Functions

```ts
import { DoowTracker } from '@doow/track';
import type { Context } from '@azure/functions';

const meter = new DoowTracker(process.env.DOOW_API_KEY!);

export default meter.withAzureFunction(async (context: Context, req: unknown) => {
  meter.track({ metric: 'executions', quantity: 1, license_id: 'lic_...' });
  return { status: 200, body: 'ok' };
});
```

## Sidecar Docker Compose example

For applications in any language, run the sidecar container on VMs, Kubernetes, Azure Container Apps, ECS, or any platform that can run containers, then send it newline-delimited JSON over stdin, a file, or TCP.

The image is currently private on GitHub Container Registry at `ghcr.io/doow-dev/doow-track-sidecar`. Customers need package read access and must authenticate Docker to GHCR before pulling it.

```yaml
# docker-compose.yml
version: '3.9'

services:
  app:
    image: your-app
    depends_on:
      - doow-sidecar
    environment:
      - DOOW_SIDECAR_HOST=doow-sidecar
      - DOOW_SIDECAR_PORT=9091

  doow-sidecar:
    image: ghcr.io/doow-dev/doow-track-sidecar:latest
    environment:
      - DOOW_TRACK_API_KEY=dk_your_api_key
      - DOOW_TRACK_ENDPOINT=https://api.doow.co
      - DOOW_TRACK_INPUT=tcp:9091     # stdin | file:<path> | tcp:<port>
      - DOOW_TRACK_HEALTH_PORT=9090
    expose:
      - '9091'                        # TCP event ingestion, private to the Compose network
    healthcheck:
      test: ['CMD', 'wget', '-qO-', 'http://localhost:9090/healthz']
      interval: 10s
      timeout: 5s
      retries: 3
```

See the [Sidecar guide](../../docs/sidecar.md) for every environment variable, the input modes and their limits, and Kubernetes. Send events from your app as newline-delimited JSON:

```json
{"metric":"api_calls","quantity":1,"license_id":"lic_..."}
{"metric":"tokens","quantity":512,"license_id":"lic_...","unit":"tokens"}
```

## CLI usage

The standalone `doow-track` daemon accepts newline-delimited JSON from applications in any language. Its downloaded binaries need neither Node.js nor a language SDK:

```bash
# Start as daemon with config file
./doow-track --config ./doow-track.json --pidfile /var/run/doow-track.pid

# Pipe mode: pipe newline-delimited JSON from stdin
echo '{"metric":"api_calls","quantity":1,"license_id":"lic_..."}' | ./doow-track --api-key dk_...

# Linux/macOS: reload config without restart
kill -HUP $(cat /var/run/doow-track.pid)
```

See the [Daemon / CLI guide](../../docs/daemon.md) for the five OS/CPU downloads, Windows Server usage, and service configuration.

Config file (`doow-track.json`):

```json
{
  "api_key": "dk_your_api_key",
  "endpoint": "https://api.doow.co",
  "input": { "mode": "stdin" },
  "flush_at": 20,
  "flush_interval": 10000
}
```

### CLI flags

| Flag | Description |
|------|-------------|
| `--config <path>` | Path to JSON config file |
| `--api-key <key>` | API key (overrides config and env) |
| `--pidfile <path>` | Write PID to file (daemon mode) |
| `--version` | Print SDK version and exit |
| `--help` | Print usage and exit |

## Offline store

When network delivery fails, events can be persisted locally and replayed on reconnect:

```ts
import { DoowTracker, FileOfflineStore } from '@doow/track';

const meter = new DoowTracker('dk_your_api_key', {
  offlineStore: new FileOfflineStore('./doow-track-offline'),
});
```

Failed batches are written as atomic JSON files (write-then-rename) and replayed FIFO at the start of the next flush. The replay stops at the first batch the server cannot take, so an outage does not make it loop, and a batch that fails again or meets a `401` or a rate limit stays in the store.

## Batching and outages

A flush sends at most 500 events per request, and a larger backlog is split into several requests that each carry their own `batch_id`, so a large flush does not exceed the API's per-minute event limit. A `413` halves the request size until the server accepts it. When the retries for a batch are used up (a network error, `408`, `429`, or `5xx`), the batch goes to the offline store if one is configured, and a permanent `4xx` response drops only the request it rejected. When the queue reaches `maxQueueSize`, the oldest event is dropped to make room for each new one, so the newest events are the ones kept.

## Error handling

The SDK never throws. All errors are surfaced via the `onError` callback:

```ts
const meter = new DoowTracker('dk_your_api_key', {
  onError: (error) => {
    console.error(`[doow/track] ${error.kind}: ${error.message}`);
    // error.kind: 'AUTH_FAILURE' | 'RATE_LIMITED' | 'PARTIAL_ACCEPT' | 'NETWORK_ERROR' | 'TIMEOUT' | 'DROPPED_EVENTS' | 'TRANSPORT_ERROR'
  },
});
```

After `AUTH_FAILURE`, the SDK stops emitting permanently (check `meter.stopped`).

## Further reading

- [Serverless guide](docs/serverless.md) — Lambda, Vercel, Azure Functions
- [Sidecar guide](../../docs/sidecar.md) — Docker Compose, Kubernetes sidecar pattern
- [Daemon / CLI guide](../../docs/daemon.md) — systemd unit file, config file reference
- [OTLP push guide](../../docs/otlp.md) — OpenTelemetry Collector config, GenAI semconv mapping
