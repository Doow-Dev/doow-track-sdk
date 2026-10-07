# Doow Track .NET SDK

[![NuGet](https://img.shields.io/nuget/v/DoowTrack)](https://www.nuget.org/packages/DoowTrack)
[![.NET](https://img.shields.io/badge/.NET-8.0-purple)](https://dotnet.microsoft.com/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Official .NET SDK for [Doow](https://doow.co) usage telemetry and management.

## Features

| Feature | Description |
|---------|-------------|
| **.NET 8.0** | Modern C# with records and async/await |
| **Batching** | Events queued and sent in configurable batches |
| **Compression** | Automatic gzip for payloads >1KB |
| **Retries** | Exponential backoff with configurable retry count |
| **Type Safety** | Full type definitions with enums and records |
| **Sidecar** | Use the language-agnostic sidecar for stdin/file/tcp input. Not shipped with this package; see [Sidecar guide](../../docs/sidecar.md) |

---

## Installation

```bash
dotnet add package DoowTrack
```

---

## Quick Start

### Track Usage Events

```csharp
using DoowTrack;

var tracker = new Tracker("dk_your_api_key");

// Simple event
tracker.Track(new TrackEvent
{
    Metric = "api_calls",
    Quantity = 1,
    LicenseId = "lic_abc123"
});

// Rich event with metadata
tracker.Track(new TrackEvent
{
    Metric = "tokens_generated",
    Quantity = 1500,
    LicenseId = "lic_abc123",
    Unit = "tokens",
    Attribution = new() { ["model"] = "gpt-4", ["region"] = "us-east-1" },
    Metadata = new() { ["request_id"] = "req_xyz" }
});

await tracker.ShutdownAsync();
```

### Units

`Quantity` must be in the unit the metric is defined with in Doow, so convert before you send. The optional `Unit` records the unit your code used, and Doow stores it as sent without converting it or comparing it with the metric's unit. For a metric `data_transfer_gb` defined in GB, send `2.5` with `GB`, not the number of bytes:

```csharp
tracker.Track(new TrackEvent
{
    Metric = "data_transfer_gb",
    Quantity = 2.5,
    LicenseId = "lic_abc123",
    Unit = "GB"
});
```

Sending `2500000000` with `bytes` to the same metric would record 2.5 billion GB. See [Units](../../README.md#units) for how Doow reads the field.

### Management API

```csharp
using DoowTrack;

var mgmt = new Management("dk_your_api_key");

// Create an app
var app = await mgmt.Apps().CreateAsync(new CreateAppInput
{
    Name = "My SaaS Platform",
    Description = "Usage-based billing"
});
Console.WriteLine($"Created app: {app.Id}");

// Create a contract with license
var contract = await mgmt.Contracts().CreateAsync(app.Id, new CreateContractInput
{
    Title = "Enterprise Plan",
    ContractType = ContractType.PayAsYouGo,
    Licenses = new()
    {
        new LicenseInput { Name = "API Usage", LicenseType = LicenseType.UsageBased }
    }
});

var licenseId = contract.Licenses[0].Id;

// Create a metric
var metric = await mgmt.Metrics().CreateAsync(licenseId, new CreateMetricInput
{
    MetricType = "api_calls"
});
Console.WriteLine($"Created metric: {metric.Id}");
```

---

## Configuration

### Tracker Options

```csharp
var tracker = new Tracker("dk_your_api_key", new TrackerOptions
{
    Endpoint = "https://api.doow.co",
    Enabled = true,
    Debug = true,
    FlushAt = 20,
    FlushIntervalMs = 10000,
    MaxQueueSize = 10000,
    TimeoutMs = 10000,
    RetryCount = 3,
    DisableCompression = false,
    Attribution = new() { ["service"] = "api-gateway" },
    OnError = e => Console.Error.WriteLine($"Tracker error: {e.Message}")
});
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DOOW_TRACK_API_KEY` | API key (overrides constructor) | — |

---

## Error Handling

```csharp
using DoowTrack;

var mgmt = new Management("dk_your_api_key");

try
{
    var app = await mgmt.Apps().GetAsync("invalid_id");
}
catch (DoowError e)
{
    if (e.IsNotFound())
        Console.WriteLine("App not found");
    else if (e.IsUnauthorized())
        Console.WriteLine("Invalid API key");
    else if (e.IsRateLimited())
        Console.WriteLine("Rate limited");
    else
        Console.WriteLine($"Error: {e.Message}");
}
```

---

## Short-lived processes

A function or console app that exits right after it handles a request can lose events that are still queued. Call `FlushAsync()` before each handler returns and `ShutdownAsync()` only when the process is about to exit, because it stops the background flush timer. Set `FlushAt` to 1 if every event must be sent immediately.

## Batching and outages

A flush sends at most 500 events per request, and a larger backlog is split into several requests that each carry their own `batch_id`, so a large flush does not exceed the API's per-minute event limit. After a transient failure (a network error, `408`, `429`, or `5xx` once the retries are used up) the tracker stops sending, puts the unsent events back at the front of the queue, and does not flush on the event-count trigger again until one flush interval has passed. A permanent `4xx` response drops only the request it rejected. When the queue reaches `MaxQueueSize` during a long outage, new events are dropped until the queue has room again, so the oldest events are the ones kept.

## License

MIT
