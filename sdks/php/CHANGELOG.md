# Changelog

## Unreleased

### Batch size

- An unreadable response body no longer drops a chunk without a status.
- After a transient failure the remaining chunks are requeued instead of each spending a full retry budget, and count-triggered flushes pause until the next flush interval. The shutdown flush sends anything still queued.
- `flush` sends more than 500 events as separate requests of at most 500 events, each with its own batch id, so a large backlog no longer exceeds the API's per-minute event limit and loops on `429`.

### Behavior changes

- `ext-mbstring` and `ext-json` are now declared requirements, because server text is sanitized with multibyte functions.
- `DoowError` gained an optional `retryAfterSeconds` constructor argument, and `isRetryable()` now covers 408, 429, every 5xx, and transport failures (status 0).
- Transport failures reach `onError` as a `DoowError` instead of the Guzzle exception, which carried the request and its Authorization header.

### Fixes

- `DoowError::sanitize` also replaces Unicode bidirectional controls and line or paragraph separators with spaces, in addition to control characters.
- The tuple hint serializes with snake_case keys, and `composer.json` autoloads the multi-class files so `TrackEvent`, `MetricTupleHint`, `TrackerOptions`, and the management classes resolve.
- HTTP 207 partial acceptance is reported as `PartialAcceptError`, and a throwing `onError` handler no longer escapes `flush()`.
