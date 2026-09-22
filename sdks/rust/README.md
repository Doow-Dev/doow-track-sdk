# Doow Track Rust SDK

[![Crates.io](https://img.shields.io/crates/v/doow-track)](https://crates.io/crates/doow-track)
[![Documentation](https://docs.rs/doow-track/badge.svg)](https://docs.rs/doow-track)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Official Rust SDK for [Doow](https://doow.co) usage telemetry and management.

## Features

| Feature | Description |
|---------|-------------|
| **Async/Await** | Built on Tokio for async operations |
| **Batching** | Events queued and sent in configurable batches |
| **Compression** | Automatic gzip for payloads >1KB |
| **Retries** | Exponential backoff with configurable retry count |
| **Type Safety** | Full Rust type definitions |
| **Sidecar** | Binary for stdin/file/tcp input modes |

---

## Installation

```toml
[dependencies]
doow-track = "0.1"
tokio = { version = "1", features = ["rt-multi-thread", "macros"] }
```

---

## Quick Start

### Track Usage Events

```rust
use doow_track::{Tracker, TrackEvent};

#[tokio::main]
async fn main() {
    let tracker = Tracker::new("dk_your_api_key", None);

    // Simple event
    tracker.track(TrackEvent {
        metric: "api_calls".to_string(),
        quantity: 1.0,
        license_id: "lic_abc123".to_string(),
        ..Default::default()
    }).await;

    // Rich event with metadata
    tracker.track(TrackEvent {
        metric: "tokens_generated".to_string(),
        quantity: 1500.0,
        unit: Some("tokens".to_string()),
        license_id: "lic_abc123".to_string(),
        attribution: Some([
            ("model".to_string(), serde_json::json!("gpt-4")),
        ].into_iter().collect()),
        ..Default::default()
    }).await;

    tracker.shutdown().await;
}
```

### Management API

```rust
use doow_track::{Management, CreateAppInput, CreateContractInput, CreateMetricInput, LicenseInput, ContractType, LicenseType};

#[tokio::main]
async fn main() -> doow_track::Result<()> {
    let mgmt = Management::new("dk_your_api_key", None);

    // Create an app
    let app = mgmt.apps().create(CreateAppInput {
        name: "My SaaS Platform".to_string(),
        description: Some("Usage-based billing".to_string()),
        ..Default::default()
    }).await?;
    println!("Created app: {}", app.id);

    // Create a contract with license
    let contract = mgmt.contracts().create(&app.id, CreateContractInput {
        title: "Enterprise Plan".to_string(),
        contract_type: ContractType::PayAsYouGo,
        licenses: vec![LicenseInput {
            name: "API Usage".to_string(),
            license_type: LicenseType::UsageBased,
        }],
    }).await?;

    let license_id = &contract.licenses[0].id;

    // Create a metric
    let metric = mgmt.metrics().create(license_id, CreateMetricInput {
        metric_type: "api_calls".to_string(),
        ..Default::default()
    }).await?;
    println!("Created metric: {}", metric.id);

    Ok(())
}
```

---

## Configuration

### Tracker Options

```rust
use doow_track::{Tracker, TrackerOptions};
use std::collections::HashMap;

let options = TrackerOptions {
    endpoint: "https://api.doow.co".to_string(),
    enabled: true,
    debug: true,
    flush_at: 20,
    flush_interval_ms: 10_000,
    max_queue_size: 10_000,
    timeout_ms: 10_000,
    retry_count: 3,
    disable_compression: false,
    attribution: [
        ("service".to_string(), serde_json::json!("api-gateway")),
    ].into_iter().collect(),
};

let tracker = Tracker::new("dk_your_api_key", Some(options));
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

```rust
use doow_track::{Management, DoowError};

async fn example() {
    let mgmt = Management::new("dk_your_api_key", None);

    match mgmt.apps().get("invalid_id").await {
        Ok(app) => println!("Found: {}", app.name),
        Err(e) => {
            if e.is_not_found() {
                println!("App not found");
            } else if e.is_unauthorized() {
                println!("Invalid API key");
            } else if e.is_rate_limited() {
                println!("Rate limited");
            } else {
                println!("Error: {}", e);
            }
        }
    }
}
```

---

## License

MIT
