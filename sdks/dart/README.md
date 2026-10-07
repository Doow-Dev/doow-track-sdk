# Doow Track Dart SDK

[![Dart](https://img.shields.io/badge/Dart-3.0+-blue)](https://dart.dev/)
[![Flutter](https://img.shields.io/badge/Flutter-Compatible-blue)](https://flutter.dev/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Official Dart/Flutter SDK for [Doow](https://doow.co) usage telemetry and management.

## Features

| Feature | Description |
|---------|-------------|
| **Dart 3.0+** | Null-safe, async/await support |
| **Flutter** | Works on iOS, Android, and desktop (Web is not supported) |
| **Batching** | Events queued and sent in configurable batches |
| **Compression** | Automatic gzip for payloads >1KB |
| **Retries** | Exponential backoff with configurable retry count |
| **Sidecar** | Use the language-agnostic sidecar for stdin/file/tcp input. Not shipped with this package; see [Sidecar guide](../../docs/sidecar.md) |

---

## Installation

```yaml
dependencies:
  doow_track: ^0.1.0
```

Or from Git:

```yaml
dependencies:
  doow_track:
    git:
      url: https://github.com/Doow-Dev/doow-track-sdk.git
      path: sdks/dart
      ref: dart-v0.1.1
```

---

## Quick Start

### Track Usage Events

```dart
import 'package:doow_track/doow_track.dart';

final tracker = Tracker('dk_your_api_key');

// Simple event
tracker.track(TrackEvent(
  metric: 'api_calls',
  quantity: 1,
  licenseId: 'lic_abc123',
));

// Rich event
tracker.track(TrackEvent(
  metric: 'tokens_generated',
  quantity: 1500,
  licenseId: 'lic_abc123',
  unit: 'tokens',
  attribution: {'model': 'gpt-4'},
));

await tracker.shutdown();
```

### Units

`quantity` must be in the unit the metric is defined with in Doow, so convert before you send. The optional `unit` records the unit your code used, and Doow stores it as sent without converting it or comparing it with the metric's unit. For a metric `data_transfer_gb` defined in GB, send `2.5` with `GB`, not the number of bytes:

```dart
tracker.track(TrackEvent(
  metric: 'data_transfer_gb',
  quantity: 2.5,
  licenseId: 'lic_abc123',
  unit: 'GB',
));
```

Sending `2500000000` with `bytes` to the same metric would record 2.5 billion GB. See [Units](../../README.md#units) for how Doow reads the field.

### Management API

```dart
import 'package:doow_track/doow_track.dart';

final mgmt = Management('dk_your_api_key');

// Create an app
final app = await mgmt.apps.create(CreateAppInput(
  name: 'My SaaS Platform',
  description: 'Usage-based billing',
));
print('Created app: ${app.id}');

// Create a contract with license
final contract = await mgmt.contracts.create(app.id, CreateContractInput(
  title: 'Enterprise Plan',
  contractType: ContractType.payAsYouGo,
  licenses: [LicenseInput(name: 'API Usage', licenseType: LicenseType.usageBased)],
));

final licenseId = contract.licenses!.first.id;

// Create a metric
final metric = await mgmt.metrics.create(licenseId, CreateMetricInput(metricType: 'api_calls'));
print('Created metric: ${metric.id}');
```

---

## Configuration

### Tracker Options

```dart
final tracker = Tracker('dk_your_api_key', TrackerOptions(
  endpoint: 'https://api.doow.co',
  enabled: true,
  debug: true,
  flushAt: 20,
  flushInterval: Duration(seconds: 10),
  maxQueueSize: 10000,
  timeout: Duration(seconds: 10),
  retryCount: 3,
  disableCompression: false,
  attribution: {'service': 'api-gateway'},
  onError: (e) => print('Tracker error: $e'),
));
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DOOW_TRACK_API_KEY` | API key (overrides constructor) | — |
| `DOOW_TRACK_ENDPOINT` | Custom API endpoint | `https://api.doow.co` |
| `DOOW_TRACK_DISABLED` | Set `true` to disable tracking | `false` |
| `DOOW_TRACK_DEBUG` | Set `true` for debug logs | `false` |

---

## Flutter Integration

```dart
class MyApp extends StatefulWidget {
  @override
  State<MyApp> createState() => _MyAppState();
}

class _MyAppState extends State<MyApp> {
  late final Tracker tracker;

  @override
  void initState() {
    super.initState();
    tracker = Tracker(
      const String.fromEnvironment('DOOW_TRACK_API_KEY'),
      TrackerOptions(debug: kDebugMode),
    );
  }

  @override
  void dispose() {
    tracker.shutdown();
    super.dispose();
  }

  void trackFeatureUsage(String feature) {
    tracker.track(TrackEvent(
      metric: 'feature_usage',
      quantity: 1,
      licenseId: currentLicenseId,
      attribution: {'feature': feature},
    ));
  }

  @override
  Widget build(BuildContext context) => MaterialApp(...);
}
```

---

## Short-lived processes

A script or function that exits right after it handles a request can lose events that are still queued. Call `flush()` before each handler returns and `shutdown()` only when the process is about to exit, because a tracker that has been shut down drops later events. Set `flushAt` to 1 if every event must be sent immediately.

## Batching and outages

A flush sends at most 500 events per request, and a larger backlog is split into several requests that each carry their own `batch_id`, so a large flush does not exceed the API's per-minute event limit. After a transient failure (a network error, `408`, `429`, or `5xx` once the retries are used up) the tracker stops sending, puts the unsent events back at the front of the queue, and does not flush on the event-count trigger again until one flush interval has passed. A permanent `4xx` response drops only the request it rejected. When the queue reaches `maxQueueSize` during a long outage, new events are dropped until the queue has room again, so the oldest events are the ones kept. The tracker reads at most 64 KiB of any response body, and a custom `httpClient` must implement `send`, which every `http.Client` does, because the tracker no longer calls `post` on it.

## License

MIT
