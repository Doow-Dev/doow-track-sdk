# Doow Track React Native SDK

[![React Native](https://img.shields.io/badge/React%20Native-0.70+-blue)](https://reactnative.dev/)
[![Expo](https://img.shields.io/badge/Expo-Compatible-blue)](https://expo.dev/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Official React Native SDK for [Doow](https://doow.co) usage telemetry. Works with React Native CLI and Expo.

## Features

| Feature | Description |
|---------|-------------|
| **React Native 0.70+** | Hooks and Context API |
| **Expo** | Works with Expo managed and bare workflows |
| **Batching** | Events queued and sent in configurable batches |
| **Persistence** | Queue survives app restarts via AsyncStorage |
| **AppState** | Auto-flush on background/inactive |
| **Navigation** | `useTrackOnFocus` hook for screen tracking |

---

## Installation

```bash
npm install @doow/track-react-native @react-native-async-storage/async-storage
# or
yarn add @doow/track-react-native @react-native-async-storage/async-storage
```

### Expo

```bash
npx expo install @doow/track-react-native @react-native-async-storage/async-storage
```

---

## Quick Start

### Provider Setup

```tsx
import { DoowProvider } from '@doow/track-react-native';

export default function App() {
  return (
    <DoowProvider apiKey="dk_your_api_key">
      <Navigation />
    </DoowProvider>
  );
}
```

### Track Events

```tsx
import { useTrackEvent } from '@doow/track-react-native';

function FeatureButton() {
  const track = useTrackEvent();

  const handlePress = () => {
    track({
      metric: 'feature_usage',
      quantity: 1,
      licenseId: 'lic_abc123',
      attribution: { feature: 'export' },
    });
  };

  return <Button onPress={handlePress} title="Export" />;
}
```

### Track Screen Views

```tsx
import { useTrackOnFocus } from '@doow/track-react-native';
import { useNavigation } from '@react-navigation/native';

function DashboardScreen() {
  const navigation = useNavigation();

  useTrackOnFocus(navigation, {
    metric: 'screen_view',
    quantity: 1,
    licenseId: 'lic_abc123',
    attribution: { screen: 'dashboard' },
  });

  return <View>...</View>;
}
```

### Track on Mount

```tsx
import { useTrackOnMount } from '@doow/track-react-native';

function OnboardingComplete() {
  useTrackOnMount({
    metric: 'onboarding_complete',
    quantity: 1,
    licenseId: 'lic_abc123',
  });

  return <Text>Welcome!</Text>;
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
    debug: __DEV__,
    flushAt: 20,
    flushIntervalMs: 10000,
    maxQueueSize: 10000,
    timeoutMs: 10000,
    retryCount: 3,
    persistQueue: true,
    attribution: { app: 'my-mobile-app', platform: Platform.OS },
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
| `useTrackOnFocus(navigation, event)` | Track on React Navigation focus |

---

## Manual Tracker (No Provider)

```tsx
import { Tracker } from '@doow/track-react-native';

const tracker = new Tracker('dk_your_api_key', { debug: true });
await tracker.init();

tracker.track({
  metric: 'api_calls',
  quantity: 1,
  licenseId: 'lic_abc123',
});

// On app shutdown
await tracker.destroy();
```

---

## License

MIT
