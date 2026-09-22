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
        <DoowProvider apiKey={process.env.NEXT_PUBLIC_DOOW_API_KEY!}>
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

export const tracker = initServerTracker(process.env.DOOW_API_KEY!);
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

const tracker = new ServerTracker(process.env.DOOW_API_KEY!);

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

## License

MIT
