# Doow Track Swift SDK

[![Swift](https://img.shields.io/badge/Swift-5.7+-orange)](https://swift.org/)
[![Platforms](https://img.shields.io/badge/Platforms-macOS%20|%20iOS%20|%20tvOS%20|%20watchOS-blue)](https://swift.org/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Official Swift SDK for [Doow](https://doow.co) usage telemetry and management.

## Features

| Feature | Description |
|---------|-------------|
| **Swift 5.7+** | Modern async/await support |
| **Batching** | Events queued and sent in configurable batches |
| **Compression** | Automatic gzip for payloads >1KB |
| **Retries** | Exponential backoff with configurable retry count |
| **Type Safety** | Full Codable support |


---

## Installation

### Swift Package Manager

```swift
dependencies: [
    .package(url: "https://github.com/Doow-Dev/doow-track-sdk.git", from: "0.1.0")
]
```

The package lives in a monorepo, so add the product by repository when you depend on it from a target:

```swift
.target(name: "MyApp", dependencies: [.product(name: "DoowTrack", package: "doow-track-sdk")])
```

---

## Quick Start

### Track Usage Events

```swift
import DoowTrack

let tracker = try Tracker("dk_your_api_key")

// Simple event
tracker.track(TrackEvent(
    metric: "api_calls",
    quantity: 1,
    licenseId: "lic_abc123"
))

// Rich event
tracker.track(TrackEvent(
    metric: "tokens_generated",
    quantity: 1500,
    licenseId: "lic_abc123",
    unit: "tokens",
    attribution: ["model": AnyCodable("gpt-4")]
))

tracker.shutdown()
```

### Units

`quantity` must be in the unit the metric is defined with in Doow, so convert before you send. The optional `unit` records the unit your code used, and Doow stores it as sent without converting it or comparing it with the metric's unit. For a metric `data_transfer_gb` defined in GB, send `2.5` with `GB`, not the number of bytes:

```swift
tracker.track(TrackEvent(
    metric: "data_transfer_gb",
    quantity: 2.5,
    licenseId: "lic_abc123",
    unit: "GB"
))
```

Sending `2500000000` with `bytes` to the same metric would record 2.5 billion GB. See [Units](../../README.md#units) for how Doow reads the field.

### Management API

```swift
import DoowTrack

let mgmt = try Management("dk_your_api_key")

// Create an app
let app = try mgmt.apps.create(CreateAppInput(
    name: "My SaaS Platform",
    description: "Usage-based billing"
))
print("Created app: \(app.id)")

// Create a contract with license
let contract = try mgmt.contracts.create(app.id, CreateContractInput(
    title: "Enterprise Plan",
    contractType: .payAsYouGo,
    licenses: [LicenseInput(name: "API Usage", licenseType: .usageBased)]
))

let licenseId = contract.licenses?.first?.id ?? ""

// Create a metric
let metric = try mgmt.metrics.create(licenseId, CreateMetricInput(metricType: "api_calls"))
print("Created metric: \(metric.id)")
```

---

## Configuration

### Tracker Options

```swift
let tracker = try Tracker("dk_your_api_key", options: TrackerOptions(
    endpoint: "https://api.doow.co",
    enabled: true,
    debug: true,
    flushAt: 20,
    flushIntervalSeconds: 10,
    maxQueueSize: 10000,
    timeoutSeconds: 10,
    retryCount: 3,
    disableCompression: false,
    attribution: ["service": AnyCodable("api-gateway")],
    onError: { error in print("Tracker error: \(error)") }
))
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DOOW_TRACK_API_KEY` | API key (overrides constructor) | — |
| `DOOW_TRACK_ENDPOINT` | Custom API endpoint | `https://api.doow.co` |
| `DOOW_TRACK_DISABLED` | Set `true` to disable tracking | `false` |
| `DOOW_TRACK_DEBUG` | Set `true` for debug logs | `false` |

---

## Short-lived processes

A command-line tool or app extension that exits right after it finishes its work can lose events that are still queued. Call `flush()` before each handler returns and `shutdown()` only when the process is about to exit, because a tracker that has been shut down drops later events. Set `flushAt` to 1 if every event must be sent immediately.

## Batching and outages

A flush sends at most 500 events per request, and a larger backlog is split into several requests that each carry their own `batch_id`, so a large flush does not exceed the API's per-minute event limit. After a transient failure (a network error, `408`, `429`, or `5xx` once the retries are used up) the tracker stops sending, puts the unsent events back at the front of the queue, and does not flush on the event-count trigger again until one flush interval has passed. A permanent `4xx` response drops only the request it rejected. When the queue reaches `maxQueueSize` during a long outage, new events are dropped until the queue has room again, so the oldest events are the ones kept.

## License

MIT
