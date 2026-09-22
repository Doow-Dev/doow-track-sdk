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
| **Sidecar** | Executable for stdin/file/tcp input modes |

---

## Installation

### Swift Package Manager

```swift
dependencies: [
    .package(url: "https://github.com/Doow-Dev/doow-track-swift.git", from: "0.1.0")
]
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

## License

MIT
