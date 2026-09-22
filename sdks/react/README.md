# Doow Track React SDK

[![React](https://img.shields.io/badge/React-17+-blue)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Official React SDK for [Doow](https://doow.co) usage telemetry.

## Features

| Feature | Description |
|---------|-------------|
| **React 17+** | Hooks and Context API |
| **TypeScript** | Full type safety |
| **Batching** | Events queued and sent in configurable batches |
| **Compression** | Automatic gzip via CompressionStream |
| **Lifecycle** | Auto-flush on beforeunload/visibilitychange |
| **Beacon** | Reliable delivery with sendBeacon fallback |

---

## Installation

```bash
npm install @doow/track-react
# or
yarn add @doow/track-react
# or
pnpm add @doow/track-react
```

---

## Quick Start

### Provider Setup

```tsx
import { DoowProvider } from '@doow/track-react';

function App() {
  return (
    <DoowProvider apiKey="dk_your_api_key">
      <YourApp />
    </DoowProvider>
  );
}
```

### Track Events

```tsx
import { useTrackEvent } from '@doow/track-react';

function FeatureButton() {
  const track = useTrackEvent();

  const handleClick = () => {
    track({
      metric: 'feature_usage',
      quantity: 1,
      licenseId: 'lic_abc123',
      attribution: { feature: 'export' },
    });
  };

  return <button onClick={handleClick}>Export</button>;
}
```

### Track on Mount

```tsx
import { useTrackOnMount } from '@doow/track-react';

function Dashboard() {
  useTrackOnMount({
    metric: 'page_view',
    quantity: 1,
    licenseId: 'lic_abc123',
    attribution: { page: 'dashboard' },
  });

  return <div>Dashboard</div>;
}
```

### Track on Change

```tsx
import { useTrackOnChange } from '@doow/track-react';

function TokenCounter({ tokens }: { tokens: number }) {
  useTrackOnChange(tokens, (value) => ({
    metric: 'tokens_used',
    quantity: value,
    licenseId: 'lic_abc123',
  }));

  return <span>{tokens} tokens</span>;
}
```

---

## Configuration

```tsx
<DoowProvider
  apiKey="dk_your_api_key"
  options={{
    endpoint: 'https://api.doow.co',
    enabled: true,
    debug: process.env.NODE_ENV === 'development',
    flushAt: 20,
    flushIntervalMs: 10000,
    maxQueueSize: 10000,
    timeoutMs: 10000,
    retryCount: 3,
    disableCompression: false,
    attribution: { app: 'my-saas' },
    onError: (e) => console.error('Doow error:', e),
  }}
>
  <App />
</DoowProvider>
```

---

## Hooks

| Hook | Description |
|------|-------------|
| `useDoow()` | Full context: `{ track, flush, isEnabled }` |
| `useTrackEvent()` | Just the `track` function |
| `useTrackOnMount(event)` | Track once on component mount |
| `useTrackOnChange(value, getEvent)` | Track when value changes |

---

## Manual Flush

```tsx
import { useDoow } from '@doow/track-react';

function LogoutButton() {
  const { flush } = useDoow();

  const handleLogout = async () => {
    await flush();
    logout();
  };

  return <button onClick={handleLogout}>Logout</button>;
}
```

---

## Without Provider

```tsx
import { Tracker } from '@doow/track-react';

const tracker = new Tracker('dk_your_api_key', { debug: true });

tracker.track({
  metric: 'api_calls',
  quantity: 1,
  licenseId: 'lic_abc123',
});

// On app shutdown
tracker.destroy();
```

---

## License

MIT
