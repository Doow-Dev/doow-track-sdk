# Doow Track Ruby SDK

[![Gem Version](https://badge.fury.io/rb/doow_track.svg)](https://rubygems.org/gems/doow_track)
[![Ruby](https://img.shields.io/badge/Ruby-3.0+-red)](https://www.ruby-lang.org/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Official Ruby SDK for [Doow](https://doow.co) usage telemetry and management.

## Features

| Feature | Description |
|---------|-------------|
| **Ruby 3.0+** | Modern Ruby with pattern matching and endless methods |
| **Batching** | Events queued and sent in configurable batches |
| **Compression** | Automatic gzip for payloads >1KB |
| **Retries** | Exponential backoff with configurable retry count |
| **Type Safety** | Struct-based models |
| **Sidecar** | Executable for stdin/file/tcp input modes |

---

## Installation

```ruby
gem 'doow_track'
```

Or install directly:

```bash
gem install doow_track
```

---

## Quick Start

### Track Usage Events

```ruby
require 'doow_track'

tracker = DoowTrack::Tracker.new('dk_your_api_key')

# Simple event
tracker.track(DoowTrack::TrackEvent.new(
  metric: 'api_calls',
  quantity: 1,
  license_id: 'lic_abc123'
))

# Rich event with metadata
tracker.track(DoowTrack::TrackEvent.new(
  metric: 'tokens_generated',
  quantity: 1500,
  license_id: 'lic_abc123',
  unit: 'tokens',
  attribution: { model: 'gpt-4', region: 'us-east-1' },
  metadata: { request_id: 'req_xyz' }
))

tracker.shutdown
```

### Management API

```ruby
require 'doow_track'

mgmt = DoowTrack::Management.new('dk_your_api_key')

# Create an app
app = mgmt.apps.create(
  name: 'My SaaS Platform',
  description: 'Usage-based billing'
)
puts "Created app: #{app.id}"

# Create a contract with license
contract = mgmt.contracts.create(app.id,
  title: 'Enterprise Plan',
  contract_type: DoowTrack::ContractType::PAY_AS_YOU_GO,
  licenses: [
    { name: 'API Usage', license_type: DoowTrack::LicenseType::USAGE_BASED }
  ]
)

license_id = contract.licenses.first.id

# Create a metric
metric = mgmt.metrics.create(license_id, metric_type: 'api_calls')
puts "Created metric: #{metric.id}"
```

---

## Configuration

### Tracker Options

```ruby
tracker = DoowTrack::Tracker.new('dk_your_api_key',
  endpoint: 'https://api.doow.co',
  enabled: true,
  debug: true,
  flush_at: 20,
  flush_interval: 10,
  max_queue_size: 10_000,
  timeout: 10,
  retry_count: 3,
  disable_compression: false,
  attribution: { service: 'api-gateway' },
  on_error: ->(e) { Rails.logger.error("Tracker error: #{e.message}") }
)
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

```ruby
begin
  app = mgmt.apps.get('invalid_id')
rescue DoowTrack::Error => e
  if e.not_found?
    puts "App not found"
  elsif e.unauthorized?
    puts "Invalid API key"
  elsif e.rate_limited?
    puts "Rate limited"
  else
    puts "Error: #{e.message}"
  end
end
```

---

## License

MIT
