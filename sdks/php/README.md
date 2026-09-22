# Doow Track PHP SDK

[![Packagist](https://img.shields.io/packagist/v/doow/track)](https://packagist.org/packages/doow/track)
[![PHP Version](https://img.shields.io/packagist/php-v/doow/track)](https://packagist.org/packages/doow/track)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Official PHP SDK for [Doow](https://doow.co) usage telemetry and management.

## Features

| Feature | Description |
|---------|-------------|
| **PHP 8.1+** | Modern PHP with enums and constructor promotion |
| **Batching** | Events queued and sent in configurable batches |
| **Compression** | Automatic gzip for payloads >1KB |
| **Retries** | Exponential backoff with configurable retry count |
| **Type Safety** | Full type definitions with enums |
| **Sidecar** | Binary for stdin/file/tcp input modes |

---

## Installation

```bash
composer require doow/track
```

---

## Quick Start

### Track Usage Events

```php
<?php

use Doow\Track\Tracker\Tracker;
use Doow\Track\Tracker\TrackerOptions;
use Doow\Track\TrackEvent;

$tracker = new Tracker('dk_your_api_key');

// Simple event
$tracker->track(new TrackEvent(
    metric: 'api_calls',
    quantity: 1,
    licenseId: 'lic_abc123',
));

// Rich event with metadata
$tracker->track(new TrackEvent(
    metric: 'tokens_generated',
    quantity: 1500,
    licenseId: 'lic_abc123',
    unit: 'tokens',
    attribution: ['model' => 'gpt-4', 'region' => 'us-east-1'],
    metadata: ['request_id' => 'req_xyz'],
));

$tracker->shutdown();
```

### Management API

```php
<?php

use Doow\Track\Management\Management;
use Doow\Track\Management\ManagementOptions;
use Doow\Track\ContractType;
use Doow\Track\LicenseType;

$mgmt = new Management('dk_your_api_key');

// Create an app
$app = $mgmt->apps()->create([
    'name' => 'My SaaS Platform',
    'description' => 'Usage-based billing',
]);
echo "Created app: {$app->id}\n";

// Create a contract with license
$contract = $mgmt->contracts()->create($app->id, [
    'title' => 'Enterprise Plan',
    'contract_type' => ContractType::PAY_AS_YOU_GO->value,
    'licenses' => [
        ['name' => 'API Usage', 'license_type' => LicenseType::USAGE_BASED->value],
    ],
]);

$licenseId = $contract->licenses[0]->id;

// Create a metric
$metric = $mgmt->metrics()->create($licenseId, [
    'metric_type' => 'api_calls',
]);
echo "Created metric: {$metric->id}\n";
```

---

## Configuration

### Tracker Options

```php
use Doow\Track\Tracker\Tracker;
use Doow\Track\Tracker\TrackerOptions;

$tracker = new Tracker('dk_your_api_key', new TrackerOptions(
    endpoint: 'https://api.doow.co',
    enabled: true,
    debug: true,
    flushAt: 20,
    flushIntervalMs: 10000,
    maxQueueSize: 10000,
    timeoutMs: 10000,
    retryCount: 3,
    disableCompression: false,
    attribution: ['service' => 'api-gateway'],
    onError: fn($e) => error_log("Tracker error: {$e->getMessage()}"),
));
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DOOW_TRACK_API_KEY` | API key (overrides constructor) | — |
| `DOOW_TRACK_ENDPOINT` | Custom API endpoint | `https://api.doow.co` |
| `DOOW_TRACK_DISABLED` | Set `true` to disable tracking | `false` |
| `DOOW_TRACK_DEBUG` | Set `true` for debug logs | `false` |
| `DOOW_TRACK_FLUSH_AT` | Events before flush | `20` |
| `DOOW_TRACK_FLUSH_INTERVAL` | Milliseconds between flushes | `10000` |

---

## Error Handling

```php
use Doow\Track\Management\Management;
use Doow\Track\DoowError;

$mgmt = new Management('dk_your_api_key');

try {
    $app = $mgmt->apps()->get('invalid_id');
} catch (DoowError $e) {
    if ($e->isNotFound()) {
        echo "App not found\n";
    } elseif ($e->isUnauthorized()) {
        echo "Invalid API key\n";
    } elseif ($e->isRateLimited()) {
        echo "Rate limited\n";
    } else {
        echo "Error: {$e->getMessage()}\n";
    }
}
```

---

## License

MIT
