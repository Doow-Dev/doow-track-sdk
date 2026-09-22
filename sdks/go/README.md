# Doow Track Go SDK

[![Go Version](https://img.shields.io/badge/Go-1.21+-00ADD8?style=flat&logo=go)](https://go.dev)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Go Reference](https://pkg.go.dev/badge/github.com/Doow-Dev/doow-track-go.svg)](https://pkg.go.dev/github.com/Doow-Dev/doow-track-go)

Official Go SDK for [Doow](https://doow.co) usage telemetry and management. Track SaaS usage, manage contracts, and monitor expenses with a simple, production-ready SDK.

## Features

| Feature | Description |
|---------|-------------|
| **Batching** | Events queued and sent in configurable batches |
| **Compression** | Automatic gzip for payloads >1KB |
| **Retries** | Exponential backoff with configurable retry count |
| **Offline Storage** | Persist failed batches to disk, drain on reconnect |
| **Rate Limiting** | Respects API rate limits with automatic backoff |
| **Hooks** | `BeforeSend`, `BeforeFlush`, `OnError` callbacks |
| **Attribution** | SDK-level metadata merged into all events |
| **Graceful Shutdown** | Flush remaining events before exit |

---

## Installation

```bash
go get github.com/Doow-Dev/doow-track-go
```

---

## Quick Start

### Track Usage Events

```go
package main

import (
    "time"
    doow "github.com/Doow-Dev/doow-track-go"
)

func main() {
    tracker := doow.NewTracker("dk_your_api_key", nil)
    defer tracker.Shutdown()

    // Simple event
    tracker.Track(doow.TrackEvent{
        Metric:    "api_calls",
        Quantity:  1,
        LicenseID: "lic_abc123",
    })

    // Rich event with attribution
    tracker.Track(doow.TrackEvent{
        Metric:    "tokens_generated",
        Quantity:  1500,
        Unit:      "tokens",
        LicenseID: "lic_abc123",
        Kind:      doow.EventKindUsage,
        Attribution: map[string]interface{}{
            "model":  "gpt-4",
            "region": "us-east-1",
        },
        Metadata: map[string]interface{}{
            "request_id": "req_xyz",
        },
    })
}
```

### Management API

Create and manage apps, contracts, licenses, metrics, and expenses.

```go
package main

import (
    "context"
    "fmt"
    doow "github.com/Doow-Dev/doow-track-go"
)

func main() {
    ctx := context.Background()
    mgmt := doow.NewManagement("dk_your_api_key", nil)

    // Create an app
    app, _ := mgmt.Apps.Create(ctx, doow.CreateAppInput{
        Name:        "My SaaS Platform",
        Description: "Usage-based billing for API calls",
    })
    fmt.Printf("Created app: %s\n", app.ID)

    // Create a contract with license
    contract, _ := mgmt.Contracts.Create(ctx, app.ID, doow.CreateContractInput{
        Title:        "Enterprise Plan",
        ContractType: doow.ContractTypePayAsYouGo,
        Licenses: []doow.LicenseInput{
            {Name: "API Usage", LicenseType: doow.LicenseTypeUsageBased},
        },
    })
    licenseID := contract.Licenses[0].ID

    // Create a metric
    metric, _ := mgmt.Metrics.Create(ctx, licenseID, doow.CreateMetricInput{
        MetricType: "api_calls",
    })
    fmt.Printf("Created metric: %s\n", metric.ID)

    // Now track events against this license!
    tracker := doow.NewTracker("dk_your_api_key", nil)
    defer tracker.Shutdown()

    tracker.Track(doow.TrackEvent{
        Metric:    "api_calls",
        Quantity:  100,
        LicenseID: licenseID,
    })
}
```

---

## Configuration

### Tracker Options

```go
tracker := doow.NewTracker("dk_your_api_key", &doow.TrackerOptions{
    // Connection
    Endpoint: "https://api.doow.co",
    Timeout:  10 * time.Second,

    // Batching
    FlushAt:       20,               // Flush after N events
    FlushInterval: 10 * time.Second, // Flush every N seconds
    MaxPayloadBytes: 450 * 1024,     // Max batch size (450KB)
    MaxQueueSize:    10000,          // Max events in memory

    // Reliability
    RetryCount:           3,
    MaxConcurrentFlushes: 30,
    ShutdownTimeout:      5 * time.Second,
    DisableCompression:   false,

    // Persistence (for offline resilience)
    OfflineStore: offlineStore,

    // SDK-level attribution (merged into all events)
    Attribution: map[string]interface{}{
        "service": "api-gateway",
        "version": "1.2.3",
    },

    // Hooks
    OnError: func(err error) {
        log.Printf("Tracking error: %v", err)
    },
    BeforeSend: func(e doow.SerializedEvent) *doow.SerializedEvent {
        if e.Quantity == 0 {
            return nil // Drop zero-quantity events
        }
        return &e
    },
    BeforeFlush: func(events []doow.SerializedEvent) []doow.SerializedEvent {
        return events // Transform or filter batch
    },

    // Control
    Enabled: &enabled, // Set to false to disable
    Debug:   true,     // Enable debug logging
})
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

## Management API Reference

### Apps

```go
mgmt := doow.NewManagement("dk_your_api_key", nil)

// List
apps, _ := mgmt.Apps.List(ctx, &doow.ListAppsParams{Limit: 10})

// Create
app, _ := mgmt.Apps.Create(ctx, doow.CreateAppInput{Name: "My App"})

// Get
app, _ := mgmt.Apps.Get(ctx, "app_id")

// Update
app, _ := mgmt.Apps.Update(ctx, "app_id", doow.UpdateAppInput{Name: "New Name"})

// Delete
_ = mgmt.Apps.Delete(ctx, "app_id")
```

### Contracts

```go
// List contracts for an app
contracts, _ := mgmt.Contracts.List(ctx, appID, nil)

// Create with licenses
contract, _ := mgmt.Contracts.Create(ctx, appID, doow.CreateContractInput{
    Title:        "Pro Plan",
    ContractType: doow.ContractTypePayAsYouGo,
    Licenses: []doow.LicenseInput{
        {Name: "API", LicenseType: doow.LicenseTypeUsageBased},
    },
})

// Get / Update / Delete
contract, _ := mgmt.Contracts.Get(ctx, contractID)
contract, _ := mgmt.Contracts.Update(ctx, contractID, doow.UpdateContractInput{...})
_ = mgmt.Contracts.Delete(ctx, contractID)
```

### Licenses

```go
// List licenses for a contract
licenses, _ := mgmt.Licenses.List(ctx, contractID, nil)

// CRUD operations
license, _ := mgmt.Licenses.Get(ctx, licenseID)
license, _ := mgmt.Licenses.Update(ctx, licenseID, doow.UpdateLicenseInput{...})
_ = mgmt.Licenses.Delete(ctx, licenseID)
```

### Metrics

```go
// List metrics for a license
metrics, _ := mgmt.Metrics.List(ctx, licenseID, nil)

// Create
metric, _ := mgmt.Metrics.Create(ctx, licenseID, doow.CreateMetricInput{
    MetricType: "api_calls",
})

// Get / Update / Delete
metric, _ := mgmt.Metrics.Get(ctx, metricID)
metric, _ := mgmt.Metrics.Update(ctx, metricID, doow.UpdateMetricInput{...})
_ = mgmt.Metrics.Delete(ctx, metricID)
```

### Expenses

```go
// List expenses (read-only)
expenses, _ := mgmt.Expenses.List(ctx, &doow.ListExpensesParams{
    AppID: appID,
    Year:  2026,
    Month: 9,
})

// Get single expense
expense, _ := mgmt.Expenses.Get(ctx, expenseID)
```

---

## Offline Storage

Persist failed batches to disk and automatically drain when connectivity returns:

```go
offlineStore, err := doow.NewFileOfflineStore("") // defaults to ~/.doow/offline
if err != nil {
    log.Fatal(err)
}

tracker := doow.NewTracker("dk_your_api_key", &doow.TrackerOptions{
    OfflineStore: offlineStore,
})
```

---

## Error Handling

```go
app, err := mgmt.Apps.Get(ctx, "invalid_id")
if err != nil {
    if apiErr, ok := err.(*doow.APIError); ok {
        switch {
        case apiErr.IsNotFound():
            fmt.Println("Resource not found")
        case apiErr.IsUnauthorized():
            fmt.Println("Invalid API key")
        case apiErr.IsForbidden():
            fmt.Println("Missing required scope")
        case apiErr.IsRateLimited():
            fmt.Println("Rate limited, retry later")
        default:
            fmt.Printf("API error %d: %s\n", apiErr.Status, apiErr.Message)
        }
    }
}
```

---

## License

MIT
