# OTLP Push Onboarding Guide

If you already have an OpenTelemetry Collector deployed, you can forward usage metrics to Doow without installing the `@doow/track` SDK. This guide covers the OTLP_PUSH acquisition route.

## Overview

The OTLP_PUSH route lets you point your existing OpenTelemetry Collector at Doow's push API. Doow accepts standard OTLP/HTTP metrics and maps them to the internal metered event ledger.

## Prerequisites

1. A running OpenTelemetry Collector (v0.80+)
2. A Doow SDK API key (`dk_` prefix) from the dashboard
3. Your collector must use **delta temporality** (not cumulative) for counter metrics

## Step 1: Get an API key

Generate a `dk_` prefixed API key from the Doow dashboard under Settings > API Keys > SDK Keys. The same key type works for both SDK telemetry and OTLP push.

## Step 2: Configure the collector

Add Doow as an OTLP/HTTP exporter in your collector config:

```yaml
# otel-collector-config.yaml
exporters:
  otlphttp/doow:
    endpoint: https://api.doow.co/telemetry/otlp
    headers:
      Authorization: "Bearer dk_your_api_key"
    compression: gzip
    timeout: 10s
    retry_on_failure:
      enabled: true
      initial_interval: 1s
      max_interval: 30s

service:
  pipelines:
    metrics/doow:
      receivers: [otlp]
      processors: [batch]
      exporters: [otlphttp/doow]
```

## Step 3: Verify first payload

Send a test metric to confirm connectivity:

```bash
# Send a test counter metric
curl -X POST https://api.doow.co/telemetry/otlp/v1/metrics \
  -H "Authorization: Bearer dk_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "resourceMetrics": [{
      "resource": { "attributes": [{"key": "service.name", "value": {"stringValue": "test"}}] },
      "scopeMetrics": [{
        "metrics": [{
          "name": "api_calls",
          "sum": {
            "dataPoints": [{
              "asInt": "1",
              "startTimeUnixNano": "1700000000000000000",
              "timeUnixNano": "1700000060000000000",
              "attributes": [
                {"key": "license_id", "value": {"stringValue": "lic_test_123"}}
              ]
            }],
            "aggregationTemporality": 1,
            "isMonotonic": true
          }
        }]
      }]
    }]
  }'
```

Expected response: `200 OK`. Check the Doow dashboard to confirm the event appears in the usage feed.

## Step 4: Delta temporality

Doow requires **delta temporality** (`aggregationTemporality: 1`) for counter metrics. If your instrumentation emits cumulative counters, add the `cumulativetodelta` processor:

```yaml
processors:
  cumulativetodelta:
    include:
      match_type: regexp
      metrics:
        - ".*"

service:
  pipelines:
    metrics/doow:
      receivers: [otlp]
      processors: [cumulativetodelta, batch]
      exporters: [otlphttp/doow]
```

## GenAI semantic conventions

If you're tracking LLM/GenAI usage, Doow recognizes the OpenTelemetry GenAI semantic conventions:

| OTel attribute | Doow mapping |
|----------------|--------------|
| `gen_ai.usage.input_tokens` | `input_tokens` metric |
| `gen_ai.usage.output_tokens` | `output_tokens` metric |
| `gen_ai.request.model` | Attribution: `model` |
| `gen_ai.system` | Attribution: `provider` |
| `gen_ai.response.finish_reasons` | Attribution: `finish_reason` |

These attributes are automatically extracted from OTLP metric data points and mapped to the Doow metered event schema.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `401 Unauthorized` | Invalid or revoked API key | Generate a new `dk_` key from the dashboard |
| `429 Too Many Requests` | Rate limit exceeded | Check `Retry-After` header, reduce export frequency |
| Events missing in dashboard | Cumulative temporality | Add `cumulativetodelta` processor |
| Duplicate events | Collector restart without checkpointing | Enable collector checkpointing or use delta temporality |
