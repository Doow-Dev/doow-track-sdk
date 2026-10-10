# Serverless Guide

Long-lived Node.js processes use timer-based auto-flush. In serverless environments the process exits after each invocation, so you need guaranteed flush before return. The SDK provides `withLambda`, `withVercel`, and `withAzureFunction` wrappers that:

1. Set `flushAt=1` so every `track()` triggers an immediate flush
2. Call `flush()` in a `finally` block so events drain before the handler returns, while the tracker stays usable for the next invocation of a warm instance

## AWS Lambda

```ts
import { DoowTracker } from '@doow/track';

const meter = new DoowTracker(process.env.DOOW_TRACK_API_KEY!);

export const handler = meter.withLambda(async (event, context) => {
  meter.track({ metric: 'api_calls', quantity: 1, license_id: 'lic_...' });
  return { statusCode: 200, body: 'ok' };
  // flush() is called automatically in a finally block
});
```

### Cold start considerations

- The `DoowTracker` constructor is outside the handler, so it runs once per cold start.
- The first `track()` call triggers an immediate flush (first-event fast path).
- `flushAt=1` means every subsequent `track()` also flushes immediately.
- `flush()` sends the queued events and waits for the request to finish, including a send that the flush timer started earlier and is still running, so a warm instance keeps its tracker between invocations. Call `shutdown()` only when the process itself is about to exit; it waits for in-flight flushes up to `shutdownTimeout` (default 5s) and stops the tracker for good.

### Lambda layers

If you use Lambda layers, install `@doow/track` in the layer and import normally. The SDK has zero native dependencies.

## Vercel

```ts
import { DoowTracker } from '@doow/track';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const meter = new DoowTracker(process.env.DOOW_TRACK_API_KEY!);

export default meter.withVercel(async (req: VercelRequest, res: VercelResponse) => {
  meter.track({ metric: 'requests', quantity: 1, license_id: 'lic_...' });
  res.status(200).json({ ok: true });
});
```

## Azure Functions

```ts
import { DoowTracker } from '@doow/track';
import type { Context } from '@azure/functions';

const meter = new DoowTracker(process.env.DOOW_TRACK_API_KEY!);

export default meter.withAzureFunction(async (context: Context, req: unknown) => {
  meter.track({ metric: 'executions', quantity: 1, license_id: 'lic_...' });
  return { status: 200, body: 'ok' };
});
```

## Generic serverless / edge

For platforms not listed above, call `flush()` before the handler returns. Do not call `shutdown()` per request: it stops the tracker, and events tracked by later invocations of the same warm instance are dropped.

```ts
const meter = new DoowTracker(process.env.DOOW_TRACK_API_KEY!, { flushAt: 1 });

export async function handler(req: Request): Promise<Response> {
  try {
    meter.track({ metric: 'requests', quantity: 1, license_id: 'lic_...' });
    return new Response('ok');
  } finally {
    await meter.flush();
  }
}
```

## Units

A metric in Doow can have a unit, such as `GB` or `seconds`, and `quantity` must already be in that unit. A serverless handler usually has bytes and milliseconds in hand, so convert them before you call `track()`. The optional `unit` records the unit your code used, and Doow stores it as sent without converting it or comparing it with the metric's unit.

This Lambda handler reports the data it received in GB and its run time in seconds, for metrics that are defined in those units:

```ts
export const handler = meter.withLambda(async (event, context) => {
  const startedAt = Date.now();
  const response = await processEvent(event);

  meter.track({
    metric: 'data_received_gb',
    quantity: Buffer.byteLength(event.body ?? '') / 1e9,
    unit: 'GB',
    license_id: 'lic_...',
  });
  meter.track({
    metric: 'compute_seconds',
    quantity: (Date.now() - startedAt) / 1000,
    unit: 'seconds',
    license_id: 'lic_...',
  });

  return response;
});
```

Dividing the byte count by `1e9` gives GB, and dividing the elapsed milliseconds by `1000` gives seconds. Sending the raw byte count to `data_received_gb` would record a number a billion times too large, and the raw millisecond count to `compute_seconds` one a thousand times too large. See [Units](../../../README.md#units) for how Doow reads the field.
