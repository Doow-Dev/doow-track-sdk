# Doow Track Java SDK

[![Maven Central](https://img.shields.io/maven-central/v/co.doow/doow-track)](https://search.maven.org/artifact/co.doow/doow-track)
[![Java](https://img.shields.io/badge/Java-17+-blue)](https://openjdk.org/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Official Java SDK for [Doow](https://doow.co) usage telemetry and management.

## Features

| Feature | Description |
|---------|-------------|
| **Java 17+** | Modern Java with records and var |
| **Batching** | Events queued and sent in configurable batches |
| **Compression** | Automatic gzip for payloads >1KB |
| **Retries** | Exponential backoff with configurable retry count |
| **Type Safety** | Full type definitions with enums |

---

## Installation

### Maven

```xml
<dependency>
    <groupId>co.doow</groupId>
    <artifactId>doow-track</artifactId>
    <version>0.1.0</version>
</dependency>
```

### Gradle

```groovy
implementation 'co.doow:doow-track:0.1.0'
```

---

## Quick Start

### Track Usage Events

```java
import co.doow.track.tracker.Tracker;
import co.doow.track.tracker.TrackerOptions;
import co.doow.track.types.TrackEvent;

try (Tracker tracker = new Tracker("dk_your_api_key")) {
    // Simple event
    tracker.track(new TrackEvent("api_calls", 1, "lic_abc123"));

    // Rich event with builder
    tracker.track(TrackEvent.builder()
        .metric("tokens_generated")
        .quantity(1500)
        .licenseId("lic_abc123")
        .unit("tokens")
        .attribution(Map.of("model", "gpt-4", "region", "us-east-1"))
        .metadata(Map.of("request_id", "req_xyz"))
        .build());
}
```

### Management API

```java
import co.doow.track.management.*;
import co.doow.track.types.*;

Management mgmt = new Management("dk_your_api_key");

// Create an app
Models.CreateAppInput appInput = new Models.CreateAppInput("My SaaS Platform");
appInput.description = "Usage-based billing";
Models.App app = mgmt.apps().create(appInput);
System.out.println("Created app: " + app.id);

// Create a contract with license
Models.CreateContractInput contractInput = new Models.CreateContractInput("Enterprise Plan");
contractInput.contractType = ContractType.PAY_AS_YOU_GO;
contractInput.licenses = List.of(new Models.LicenseInput("API Usage", LicenseType.USAGE_BASED));
Models.Contract contract = mgmt.contracts().create(app.id, contractInput);

String licenseId = contract.licenses.get(0).id;

// Create a metric
Models.Metric metric = mgmt.metrics().create(licenseId, new Models.CreateMetricInput("api_calls"));
System.out.println("Created metric: " + metric.id);
```

---

## Configuration

### Tracker Options

```java
Tracker tracker = new Tracker("dk_your_api_key", new TrackerOptions()
    .setEndpoint("https://api.doow.co")
    .setEnabled(true)
    .setDebug(true)
    .setFlushAt(20)
    .setFlushIntervalMs(10000)
    .setMaxQueueSize(10000)
    .setTimeoutMs(10000)
    .setRetryCount(3)
    .setDisableCompression(false)
    .setAttribution(Map.of("service", "api-gateway"))
    .setOnError(e -> System.err.println("Tracker error: " + e.getMessage()))
);
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DOOW_TRACK_API_KEY` | API key (overrides constructor) | — |
| `DOOW_TRACK_ENDPOINT` | Custom API endpoint | `https://api.doow.co` |
| `DOOW_TRACK_DISABLED` | Set `true` to disable tracking | `false` |
| `DOOW_TRACK_DEBUG` | Set `true` for debug logs | `false` |

---

## Error Handling

```java
import co.doow.track.DoowError;

try {
    Models.App app = mgmt.apps().get("invalid_id");
} catch (DoowError e) {
    if (e.isNotFound()) {
        System.out.println("App not found");
    } else if (e.isUnauthorized()) {
        System.out.println("Invalid API key");
    } else if (e.isRateLimited()) {
        System.out.println("Rate limited");
    } else {
        System.out.println("Error: " + e.getMessage());
    }
}
```

---

## Short-lived processes

A function or command-line program that exits right after it handles a request can lose events that are still queued. Call `flush()` before each handler returns and `shutdown()` (or `close()`) only when the process is about to exit, because a tracker that has been shut down drops later events. Call `setFlushAt(1)` if every event must be sent immediately.

## Batching and outages

A flush sends at most 500 events per request, and a larger backlog is split into several requests that each carry their own `batch_id`, so a large flush does not exceed the API's per-minute event limit. After a transient failure (a network error, `408`, `429`, or `5xx` once the retries are used up) the tracker stops sending, puts the unsent events back at the front of the queue, and does not flush on the event-count trigger again until one flush interval has passed. A permanent `4xx` response drops only the request it rejected. When the queue reaches `maxQueueSize` during a long outage, new events are dropped until the queue has room again, so the oldest events are the ones kept.

## License

MIT

## Releasing

Signing and Central publishing run only in the `release` profile:

```bash
mvn -B -Prelease deploy
```

A plain `mvn deploy` does not sign artifacts.
