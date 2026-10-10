# Doow Track Kotlin SDK

[![Kotlin](https://img.shields.io/badge/Kotlin-1.9+-purple)](https://kotlinlang.org/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Official Kotlin SDK for [Doow](https://doow.co) usage telemetry and management.

## Features

| Feature | Description |
|---------|-------------|
| **Kotlin 1.9+** | Coroutines and modern Kotlin idioms |
| **Batching** | Events queued and sent in configurable batches |
| **Compression** | Automatic gzip for payloads >1KB |
| **Retries** | Exponential backoff with configurable retry count |
| **Type Safety** | kotlinx.serialization with data classes |
| **Sidecar** | Use the language-agnostic sidecar for stdin/file/tcp input. Not shipped with this package; see [Sidecar guide](../../docs/sidecar.md) |

---

## Installation

### Gradle (Kotlin DSL)

```kotlin
dependencies {
    implementation("co.doow:doow-track-kotlin:0.1.1")
}
```

### Gradle (Groovy)

```groovy
implementation 'co.doow:doow-track-kotlin:0.1.1'
```

---

## Quick Start

### Track Usage Events

```kotlin
import co.doow.track.tracker.Tracker
import co.doow.track.tracker.TrackerOptions
import co.doow.track.types.TrackEvent

val tracker = Tracker("dk_your_api_key")

// Simple event
tracker.track(TrackEvent(
    metric = "api_calls",
    quantity = 1.0,
    licenseId = "lic_abc123"
))

// Rich event
tracker.track(TrackEvent(
    metric = "tokens_generated",
    quantity = 1500.0,
    licenseId = "lic_abc123",
    unit = "tokens"
))

tracker.shutdown()
```

### Units

`quantity` must be in the unit the metric is defined with in Doow, so convert before you send. The optional `unit` records the unit your code used, and Doow stores it as sent without converting it or comparing it with the metric's unit. For a metric `data_transfer_gb` defined in GB, send `2.5` with `GB`, not the number of bytes:

```kotlin
tracker.track(TrackEvent(
    metric = "data_transfer_gb",
    quantity = 2.5,
    licenseId = "lic_abc123",
    unit = "GB"
))
```

Sending `2500000000.0` with `bytes` to the same metric would record 2.5 billion GB. See [Units](../../README.md#units) for how Doow reads the field.

### Management API

Metric fields, their defaults, and the values each one accepts are listed in [Metric fields](../../README.md#metric-fields).

```kotlin
import co.doow.track.management.Management
import co.doow.track.types.*

val mgmt = Management("dk_your_api_key")

// Create an app
val app = mgmt.apps.create(CreateAppInput(
    name = "My SaaS Platform",
    description = "Usage-based billing"
))
println("Created app: ${app.id}")

// Create a contract with license
val contract = mgmt.contracts.create(app.id, CreateContractInput(
    title = "Enterprise Plan",
    contractType = ContractType.PAY_AS_YOU_GO,
    licenses = listOf(LicenseInput(name = "API Usage", licenseType = LicenseType.USAGE_BASED))
))

val licenseId = contract.licenses.first().id

// Create a metric
val metric = mgmt.metrics.create(licenseId, CreateMetricInput(metricType = "api_calls"))
println("Created metric: ${metric.id}")
```

---

## Configuration

### Tracker Options

```kotlin
val tracker = Tracker("dk_your_api_key", TrackerOptions(
    endpoint = "https://api.doow.co",
    enabled = true,
    debug = true,
    flushAt = 20,
    flushIntervalMs = 10000,
    maxQueueSize = 10000,
    timeoutMs = 10000,
    retryCount = 3,
    disableCompression = false,
    onError = { e -> println("Tracker error: ${e.message}") }
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

A function or command-line program that exits right after it handles a request can lose events that are still queued. Call `flush()` before each handler returns and `shutdown()` (or `close()`) only when the process is about to exit, because a tracker that has been shut down drops later events. Set `flushAt` to 1 if every event must be sent immediately.

## Batching and outages

A flush sends at most 500 events per request, and a larger backlog is split into several requests that each carry their own `batch_id`, so a large flush does not exceed the API's per-minute event limit. After a transient failure (a network error, `408`, `429`, or `5xx` once the retries are used up) the tracker stops sending, puts the unsent events back at the front of the queue, and does not flush on the event-count trigger again until one flush interval has passed. A permanent `4xx` response drops only the request it rejected. When the queue reaches `maxQueueSize` during a long outage, new events are dropped until the queue has room again, so the oldest events are the ones kept.

## License

MIT
