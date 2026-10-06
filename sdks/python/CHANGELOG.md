# Changelog

## Unreleased

### Batch size

- A `408` request timeout is retried like `429` and `5xx`, and a chunk that cannot be serialized is dropped on its own instead of aborting the flush. Shutdown stores every remaining chunk when an offline store is set.
- After a transient failure the remaining chunks are requeued (a chunk already saved to the offline store is not requeued again) instead of each spending a full retry budget, and count-triggered flushes pause until the next flush interval.
- `Tracker.flush` and `AsyncTracker.flush` send more than 500 events as separate requests of at most 500 events, each with its own batch id, so a large backlog no longer exceeds the API's per-minute event limit and loops on `429`.

### Fixes

- Both trackers read at most 64 KiB of a response body, and `APIError.details` and `error_class` are cleaned of control characters, so a hostile or broken endpoint cannot exhaust memory or inject terminal escapes through an error.
- `sanitize_text` also replaces Unicode bidirectional controls and line or paragraph separators with spaces.
- A `Retry-After` wait now replaces the retry backoff instead of adding to it, and the trackers no longer wait after the final attempt.

### Additions

- New exports: `PartialAcceptError` and `sanitize_text`. `on_error` receives a `PartialAcceptError` for HTTP 207 partial acceptance.

### Behavior changes

- Transport failures reach `on_error` as a `DoowError` instead of the raw `httpx` exception, which carried the request and its Authorization header.
- Only 429, 5xx, and network errors are retried. A permanent 4xx is reported once. `Retry-After` is honored and clamped to 30 seconds.

### Fixes

- Batches containing a `MetricTupleHint` no longer fail to serialize, and requests now send the `batch_id`/`sdk_version` envelope.
- The async tracker reports exhausted retries through `on_error`.
