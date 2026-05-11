# Serverless Guide

Long-lived Node.js processes use timer-based auto-flush. In serverless environments the process exits after each invocation, so you need guaranteed flush before return. The SDK provides `withLambda`, `withVercel`, and `withAzureFunction` wrappers that:

1. Set `flushAt=1` so every `track()` triggers an immediate flush
2. Call `shutdown()` in a `finally` block so events drain before the handler returns

## AWS Lambda

```ts
import { DoowTracker } from '@doow/track';

const meter = new DoowTracker(process.env.DOOW_API_KEY!);

export const handler = meter.withLambda(async (event, context) => {
  meter.track({ metric: 'api_calls', quantity: 1, license_id: 'lic_...' });
  return { statusCode: 200, body: 'ok' };
  // shutdown() is called automatically in a finally block
});
```

### Cold start considerations

- The `DoowTracker` constructor is outside the handler, so it runs once per cold start.
- The first `track()` call triggers an immediate flush (first-event fast path).
- `flushAt=1` means every subsequent `track()` also flushes immediately.
- `shutdown()` waits for in-flight flushes with a configurable timeout (default 5s).

### Lambda layers

If you use Lambda layers, install `@doow/track` in the layer and import normally. The SDK has zero native dependencies.

## Vercel

```ts
import { DoowTracker } from '@doow/track';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const meter = new DoowTracker(process.env.DOOW_API_KEY!);

export default meter.withVercel(async (req: VercelRequest, res: VercelResponse) => {
  meter.track({ metric: 'requests', quantity: 1, license_id: 'lic_...' });
  res.status(200).json({ ok: true });
});
```

## Azure Functions

```ts
import { DoowTracker } from '@doow/track';
import type { Context } from '@azure/functions';

const meter = new DoowTracker(process.env.DOOW_API_KEY!);

export default meter.withAzureFunction(async (context: Context, req: unknown) => {
  meter.track({ metric: 'executions', quantity: 1, license_id: 'lic_...' });
  return { status: 200, body: 'ok' };
});
```

## Generic serverless / edge

For platforms not listed above, call `shutdown()` manually:

```ts
const meter = new DoowTracker(process.env.DOOW_API_KEY!, { flushAt: 1 });

export async function handler(req: Request): Promise<Response> {
  try {
    meter.track({ metric: 'requests', quantity: 1, license_id: 'lic_...' });
    return new Response('ok');
  } finally {
    await meter.shutdown();
  }
}
```
