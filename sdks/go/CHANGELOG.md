# Changelog

## Unreleased

### Batch size

- After a transient failure the remaining chunks are requeued (a chunk already saved to the offline store is not requeued again) instead of each spending a full retry budget, and count-triggered flushes pause until the next flush interval.
- `Flush` sends more than 500 events as separate requests of at most 500 events, each with its own batch id, and returns the first error.

### Fixes

- HTTP 207 partial acceptance is reported to `OnError` as `*PartialAcceptError` and is not retried or re-stored.
- Only 429, 5xx, and network errors are retried. A permanent 4xx is reported once and skips the offline store. `Retry-After` is honored and clamped to 30 seconds.
- `Shutdown` waits for in-flight flushes, is safe to call twice, and later `Track` calls are dropped. A panicking `OnError` handler is recovered.
