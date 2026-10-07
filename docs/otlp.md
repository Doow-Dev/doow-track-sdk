# OTLP Push Onboarding Guide

If you already have an OpenTelemetry Collector deployed, you can forward usage metrics to Doow without installing any Doow SDK. This guide covers Doow's OTLP push integration.

## Overview

The OTLP push integration lets you point your existing OpenTelemetry Collector at Doow's push API. Doow accepts OTLP/HTTP metrics encoded as JSON and maps them into its usage pipeline.

## Prerequisites

1. A running OpenTelemetry Collector (v0.80+)
2. A Doow SDK API key (`dk_` prefix) from the dashboard
3. An `otlphttp` exporter set to `encoding: json`. Doow does not decode the exporter's default protobuf encoding, and a protobuf export can be answered with `200` while nothing is recorded

## Step 1: Get an API key

In the Doow dashboard, open Settings > API Keys, select **Create key**, and choose **SDK key** in the dialog. The key starts with `dk_`. The same SDK key works for both SDK telemetry and OTLP push. Regular API keys and MCP keys are created from the same button, but they are not accepted by the telemetry endpoints.

## Step 2: Configure the collector

Add Doow as an OTLP/HTTP exporter in your collector config. The exporter appends `/v1/metrics` to the endpoint, so the endpoint stops at `/otlp`:

```yaml
# otel-collector-config.yaml
exporters:
  otlphttp/doow:
    endpoint: https://api.doow.co/otlp
    encoding: json
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

The full URL that receives the metrics is `https://api.doow.co/otlp/v1/metrics`.

## Step 3: Verify first payload

Send a test metric to confirm connectivity:

```bash
# Send a test counter metric
curl -X POST https://api.doow.co/otlp/v1/metrics \
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

Expected response: `200 OK` with an empty JSON object. Check the Doow dashboard to confirm the event appears in the usage feed.

## Required attributes

Doow reads these attributes from each data point and from its resource. A data point attribute wins over a resource attribute with the same name.

| Attribute | Required | Description |
|-----------|----------|-------------|
| `license_id` | yes | The license the usage belongs to. A data point without it is not matched to a license |
| `app_name` | no | The application the metric belongs to. Defaults to `unknown` |
| `license_name` | no | The license plan name. Defaults to `unknown` |

Every other attribute is kept as attribution metadata on the event, except the structural keys that are consumed as first-class fields (`metric_name`, `metric_tuple_id`, `route`, `source_mechanism`, `kind`, `status`, `occurred_at`, and the period bounds). Those are not repeated in the attribution.

## Supported metric types

| OTLP metric | Handling |
|-------------|----------|
| Sum | Accepted. Each data point becomes one usage event |
| Gauge | Accepted. Each data point is treated as a quantity to add, not as a level, so only send a gauge for values that you want summed |
| Histogram, ExponentialHistogram, Summary | Not accepted. These metrics are skipped and the rest of the request is still processed |

## Temporality

Delta temporality (`aggregationTemporality: 1`) is the simplest choice, because each data point is used as the quantity for its interval.

Cumulative temporality (`aggregationTemporality: 2`) is also accepted. Doow converts it to deltas itself by remembering the last value of each series. Three rules follow from that:

- The first data point of a series only records the starting value and produces no usage event.
- A value lower than the previous one is treated as a counter reset, and the new value is used as the delta.
- The remembered value expires after 2 minutes without a data point. After that the next point is treated as a first point again, so the usage in the gap is lost.

If your collector exports less often than every 2 minutes, or you cannot accept losing the first interval, convert to delta in the collector with the `cumulativetodelta` processor:

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

If you track LLM or GenAI usage, Doow recognizes the OpenTelemetry GenAI semantic conventions. A data point is treated as GenAI usage when it carries the `gen_ai.system` attribute, on the data point or its resource.

| OpenTelemetry field | Doow mapping |
|---------------------|--------------|
| Attribute `gen_ai.system` | Used as the application name (`app_name`) and as the event's source system |
| Attribute `gen_ai.request.model` | Added to the attribution as `model` |
| Metric named `gen_ai.usage.input_tokens` | Recorded as the `input_tokens` metric |
| Metric named `gen_ai.usage.output_tokens` | Recorded as the `output_tokens` metric |
| Metric named `gen_ai.usage.total_tokens` | Recorded as the `total_tokens` metric |

Other metric names are kept as they are, and all other attributes stay in the attribution metadata.

## Responses and retries

| Status | Meaning | What to do |
|--------|---------|------------|
| `200` | The batch was accepted. The body is an empty JSON object | Nothing |
| `400` | The body is missing or the payload could not be normalized | Fix the payload and check that the `Content-Type` is `application/json` |
| `401` | The API key is missing, invalid, or revoked | Generate a new `dk_` key from the dashboard |
| `429` | Too many requests for the organization | Wait for the `Retry-After` header, then retry. The collector's `retry_on_failure` does this |
| `503` | Doow could not process the batch right now | Retry later. The response can carry a `Retry-After` header, and `retry_on_failure` does this |

Doow derives a batch identity from the request content, so a batch that the collector resends after a timeout is not counted twice.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `404 Not Found` | The endpoint includes a path other than `/otlp` | Use `https://api.doow.co/otlp` and let the exporter add `/v1/metrics` |
| The collector reports success but no events appear | The exporter sends protobuf, which Doow does not decode | Set `encoding: json` on the `otlphttp` exporter |
| `401 Unauthorized` | Invalid or revoked API key | Generate a new `dk_` key from the dashboard |
| `429 Too Many Requests` | Rate limit exceeded | Check the `Retry-After` header and reduce export frequency |
| Events missing in the dashboard | The data point has no `license_id`, the metric is a histogram, or cumulative data lost its first point | Add `license_id`, send sums, or use the `cumulativetodelta` processor |
| Usage is lower than expected after a gap | A cumulative series went 2 minutes without a data point | Export more often, or use the `cumulativetodelta` processor |
