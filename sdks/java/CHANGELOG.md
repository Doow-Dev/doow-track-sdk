# Changelog

## Unreleased

### Batch size

- `flush` sends more than 500 events as separate requests of at most 500 events, each with its own batch id, so a large backlog no longer exceeds the API's per-minute event limit and loops on `429`.

### Breaking changes

- `TrackEvent.metricTupleHint` is now a `MetricTupleHint` object instead of a `String`. The server only accepts the `{app_name, license_name, metric_name}` object, so the old string form never matched.

### Fixes

- Requests now send the `batch_id`/`sdk_version` envelope and per-event `event_id`, `occurred_at`, `source_system`, and `measurements`.
- HTTP 207 partial acceptance is reported to `onError` as `PartialAcceptError` with each rejected event and reason, and is not retried.
- A permanent 4xx no longer escapes `flush()`, so the periodic flush keeps running.
- Signing and Central publishing moved into the `release` Maven profile (`mvn -Prelease deploy`). A plain `mvn deploy` publishes unsigned artifacts.
