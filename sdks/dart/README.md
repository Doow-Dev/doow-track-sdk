# Doow Track Dart SDK

[![Dart](https://img.shields.io/badge/Dart-3.0+-blue)](https://dart.dev/)
[![Flutter](https://img.shields.io/badge/Flutter-Compatible-blue)](https://flutter.dev/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Official Dart/Flutter SDK for [Doow](https://doow.co) usage telemetry and management.

## Features

| Feature | Description |
|---------|-------------|
| **Dart 3.0+** | Null-safe, async/await support |
| **Flutter** | Works on iOS, Android, Web, Desktop |
| **Batching** | Events queued and sent in configurable batches |
| **Compression** | Automatic gzip for payloads >1KB |
| **Retries** | Exponential backoff with configurable retry count |
| **Sidecar** | CLI for stdin/file/tcp input modes |

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
      url: https://github.com/Doow-Dev/doow-track-dart.git
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
      const String.fromEnvironment('DOOW_API_KEY'),
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

## License

MIT
