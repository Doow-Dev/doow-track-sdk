# Changelog

## Unreleased

### Batch size

- A flush of more than 500 events is sent as separate requests of at most 500 events, each with its own batch id, so a large backlog no longer exceeds the API's per-minute event limit and loops on `429`.

### Behavior changes

- `ServerTracker` accepts an `onError` option. HTTP 207 partial acceptance is reported there as `PartialAcceptError` and does not throw. Previously a 207 was treated as success and rejections were lost.
- `TrackEvent` accepts `sourceSystem` and `metricTupleHint`.

### Fixes

- Client and server requests now send the `batch_id`/`sdk_version` envelope and per-event `event_id`, `occurred_at`, `source_system`, and `measurements`.
- Exhausted 429/5xx retries now reach `onError`, and `Retry-After` is clamped to 30 seconds.
