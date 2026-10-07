# Doow Track Next.js SDK

[![Next.js](https://img.shields.io/badge/Next.js-13+-black)](https://nextjs.org/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Official Next.js SDK for [Doow](https://doow.co) usage telemetry with client and server support.

## Features

| Feature | Description |
|---------|-------------|
| **App Router** | Full support for Next.js 13+ App Router |
| **Server Actions** | Track from server components and actions |
| **Client Components** | React hooks with batching and compression |
| **Edge Runtime** | Works in Edge and Node.js runtimes |

---

## Installation

```bash
npm install @doow/track-nextjs
```

---

## Client-Side Usage

### Provider Setup (layout.tsx)

```tsx
import { DoowProvider } from '@doow/track-nextjs';

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <DoowProvider apiKey={process.env.NEXT_PUBLIC_DOOW_TRACK_API_KEY!}>
          {children}
        </DoowProvider>
      </body>
    </html>
  );
}
```

### Track in Client Components

```tsx
'use client';

import { useTrackEvent } from '@doow/track-nextjs';

export function FeatureButton() {
  const track = useTrackEvent();

  return (
    <button onClick={() => track({
      metric: 'feature_usage',
      quantity: 1,
      licenseId: 'lic_abc123',
    })}>
      Use Feature
    </button>
  );
}
```

---

## Server-Side Usage

### Initialize (once)

```ts
// lib/doow.ts
import { initServerTracker } from '@doow/track-nextjs/server';

export const tracker = initServerTracker(process.env.DOOW_TRACK_API_KEY!);
```

### Server Actions

```ts
'use server';

import { trackServerEvent } from '@doow/track-nextjs/server';

export async function generateReport(formData: FormData) {
  await trackServerEvent({
    metric: 'report_generated',
    quantity: 1,
    licenseId: getLicenseId(),
  });

  return generateReportData(formData);
}
```

### Route Handlers

```ts
// app/api/process/route.ts
import { getServerTracker } from '@doow/track-nextjs/server';

export async function POST(request: Request) {
  const tracker = getServerTracker();

  await tracker.track({
    metric: 'api_call',
    quantity: 1,
    licenseId: getLicenseId(request),
  });

  return Response.json({ success: true });
}
```

---

## Middleware Tracking

```ts
// middleware.ts
import { ServerTracker } from '@doow/track-nextjs/server';

const tracker = new ServerTracker(process.env.DOOW_TRACK_API_KEY!);

export async function middleware(request: NextRequest) {
  await tracker.track({
    metric: 'page_view',
    quantity: 1,
    licenseId: getLicenseFromCookie(request),
    attribution: { path: request.nextUrl.pathname },
  });

  return NextResponse.next();
}
```

---

## Short-lived processes

`ServerTracker.track` and `ServerTracker.trackBatch` send their request immediately and have no queue, so on a serverless route `await` the call before the handler returns. The client tracker queues events in the browser and sends them on its flush interval and when the page is hidden, so it needs no extra handling.

## Batching and outages

The client tracker sends at most 500 events per request, and a larger backlog is split into several requests that each carry their own `batch_id`, so a large flush does not exceed the API's per-minute event limit. After a transient failure (a network error, `408`, `429`, or `5xx` once the retries are used up) it stops sending, puts the unsent events back at the front of the queue, and does not flush on the event-count trigger again until one flush interval has passed. A permanent `4xx` response drops only the request it rejected. When the queue reaches `maxQueueSize` during a long outage, new events are dropped until the queue has room again, so the oldest events are the ones kept.

`ServerTracker.trackBatch` has no queue and does not split anything: it sends exactly the events you pass as one request, so pass at most 500 events per call. The API rejects a request of more than 1,000 events with a non-retryable `413`.

## License

MIT
