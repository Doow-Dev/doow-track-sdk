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
| **Sidecar** | JAR for stdin/file/tcp input modes |

---

## Installation

### Gradle (Kotlin DSL)

```kotlin
dependencies {
    implementation("co.doow:doow-track:0.1.0")
}
```

### Gradle (Groovy)

```groovy
implementation 'co.doow:doow-track:0.1.0'
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

### Management API

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

## License

MIT
