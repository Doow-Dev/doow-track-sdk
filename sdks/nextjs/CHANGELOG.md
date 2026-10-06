# Changelog

## Unreleased

### Batch size

- A `408` request timeout is retried like `429` and `5xx`, and the chunk holding an event that cannot be serialized (up to 500 events) is reported and dropped instead of blocking the queue. A shutdown during an outage stops after the first failed chunk and reports how many events were dropped.
- After a transient failure (network error, `429`, or `5xx` after the retries) the remaining chunks are requeued instead of each spending a full retry budget, and count-triggered flushes pause until the next flush interval.
- A flush of more than 500 events is sent as separate requests of at most 500 events, each with its own batch id, so a large backlog no longer exceeds the API's per-minute event limit and loops on `429`.

### Fixes

- Error and partial-accept responses are read as a stream and cut off at 64 KiB, so an oversized or endless body can no longer be buffered in full.
- Server-supplied error text has Unicode bidirectional controls and line or paragraph separators replaced with spaces, in addition to control characters.

### Behavior changes

- `ServerTracker` accepts an `onError` option. HTTP 207 partial acceptance is reported there as `PartialAcceptError` and does not throw. Previously a 207 was treated as success and rejections were lost.
- `TrackEvent` accepts `sourceSystem` and `metricTupleHint`.

### Fixes

- Client and server requests now send the `batch_id`/`sdk_version` envelope and per-event `event_id`, `occurred_at`, `source_system`, and `measurements`.
- Exhausted 429/5xx retries now reach `onError`, and `Retry-After` is clamped to 30 seconds.
