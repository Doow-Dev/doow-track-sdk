# Changelog

## Unreleased

### Changed

- `EntitlementPeriod` and `CarryoverPolicy` now list the values the API accepts, so code that referenced `YEARLY`, `WEEKLY`, `DAILY`, `ONE_TIME`, or `ROLLOVER_CAPPED` no longer compiles. `entitlement_period` is `MONTHLY`, `QUARTERLY`, `ANNUALLY`, `TERM`, `UNTIL_EXHAUSTED`, or `NONE`, and `carryover_policy` is `EXPIRE_AT_PERIOD_END`, `ROLLOVER`, `FIFO_VINTAGE`, or `RESET`. The API never accepted the removed values.

## [0.1.1] — 2026-10-07

### Batch size

- A `408` request timeout is retried like `429` and `5xx`, an unreadable error body no longer turns a permanent `4xx` into a retry, and an interrupted flush requeues the chunks it did not send. A shutdown during an outage reports how many events it dropped.
- After a transient failure the remaining chunks are requeued instead of each spending a full retry budget, count-triggered flushes pause until the next flush interval, and an interrupted flush stops sending further chunks.
- `flush` sends more than 500 events as separate requests of at most 500 events, each with its own batch id, so a large backlog no longer exceeds the API's per-minute event limit and loops on `429`.

### Breaking changes

- `TrackEvent.metricTupleHint` is now a `MetricTupleHint` object instead of a `String`. The server only accepts the `{app_name, license_name, metric_name}` object, so the old string form never matched.

### Fixes

- Server-supplied error text has Unicode bidirectional controls and line or paragraph separators replaced with spaces, in addition to control characters.
- Requests now send the `batch_id`/`sdk_version` envelope and per-event `event_id`, `occurred_at`, `source_system`, and `measurements`.
- HTTP 207 partial acceptance is reported to `onError` as `PartialAcceptError` with each rejected event and reason, and is not retried.
- A permanent 4xx no longer escapes `flush()`, so the periodic flush keeps running.
- Signing and Central publishing moved into the `release` Maven profile (`mvn -Prelease deploy`). A plain `mvn deploy` publishes unsigned artifacts.
