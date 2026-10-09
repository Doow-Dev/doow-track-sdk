# Changelog

## Unreleased

### Changed

- `EntitlementPeriod` and `CarryoverPolicy` now list the values the API accepts, so code that referenced `YEARLY`, `WEEKLY`, `DAILY`, `ONE_TIME`, or `ROLLOVER_CAPPED` no longer compiles. `entitlement_period` is `MONTHLY`, `QUARTERLY`, `ANNUALLY`, `TERM`, `UNTIL_EXHAUSTED`, or `NONE`, and `carryover_policy` is `EXPIRE_AT_PERIOD_END`, `ROLLOVER`, `FIFO_VINTAGE`, or `RESET`. The API never accepted the removed values.

## [0.1.1] — 2026-10-07

### Batch size

- A `408` request timeout is retried like `429` and `5xx`. Shutdown stores every remaining chunk when an offline store is set.
- After a transient failure the remaining chunks are requeued (a chunk already saved to the offline store is not requeued again) instead of each spending a full retry budget, and count-triggered flushes pause until the next flush interval.
- `Flush` sends more than 500 events as separate requests of at most 500 events, each with its own batch id, and returns the first error.

### Fixes

- Server-supplied error text has Unicode bidirectional controls and line or paragraph separators replaced with spaces, in addition to control characters.
- HTTP 207 partial acceptance is reported to `OnError` as `*PartialAcceptError` and is not retried or re-stored.
- Only 429, 5xx, and network errors are retried. A permanent 4xx is reported once and skips the offline store. `Retry-After` is honored and clamped to 30 seconds.
- `Shutdown` waits for in-flight flushes, is safe to call twice, and later `Track` calls are dropped. A panicking `OnError` handler is recovered.
