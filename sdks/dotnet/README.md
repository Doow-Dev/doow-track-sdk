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
| **Sidecar** | CLI tool for stdin/file/tcp input modes |

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
| `DOOW_TRACK_ENDPOINT` | Custom API endpoint | `https://api.doow.co` |
| `DOOW_TRACK_DISABLED` | Set `true` to disable tracking | `false` |
| `DOOW_TRACK_DEBUG` | Set `true` for debug logs | `false` |

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

## License

MIT
