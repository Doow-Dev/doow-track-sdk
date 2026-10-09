# Changelog

## Unreleased

### Changed

- `EntitlementPeriod` and `CarryoverPolicy` now list the values the API accepts, so code that referenced `YEARLY`, `WEEKLY`, `DAILY`, `ONE_TIME`, or `ROLLOVER_CAPPED` no longer compiles. `entitlement_period` is `MONTHLY`, `QUARTERLY`, `ANNUALLY`, `TERM`, `UNTIL_EXHAUSTED`, or `NONE`, and `carryover_policy` is `EXPIRE_AT_PERIOD_END`, `ROLLOVER`, `FIFO_VINTAGE`, or `RESET`. The API never accepted the removed values.
- `RateKind` now lists `PER_UNIT`, `FLAT_FEE`, `PER_SEAT`, `PERCENTAGE`, and `USAGE`, the values the API stores. `TIERED` and `VOLUME` never existed on the API side, so code that referenced them no longer compiles. Creating a metric through the SDK accepts all five; for `PERCENTAGE`, `usage_rate` is a fraction between 0 and 1 and `quantity` is the amount it applies to.
- `UsageAggregationType` now also lists `PEAK`, `AVERAGE`, and `BALANCE`, which the API stores for metrics created in the dashboard, so listing or reading such a metric no longer fails to parse. Creating a metric through the SDK accepts all six, the same as the dashboard.

## [0.1.2] — 2026-10-08

### Fixed

- A `unit` set on an event is now sent at event level, where earlier releases accepted it and then dropped it before the request.
- The `sdk_version` sent in each batch and the `User-Agent` header now come from the crate version, where earlier releases reported `0.1.0`.

## [0.1.1] — 2026-10-07

### Batch size

- After a transient failure the remaining chunks are requeued instead of each spending a full retry budget, and count-triggered flushes pause until the next flush interval.
- `flush`, the interval flush, and the shutdown flush send more than 500 events as separate requests of at most 500 events, each with its own batch id.

### Breaking changes

- `TrackerOptions` has a new `on_error: Option<ErrorHandler>` field. Code that builds the struct without `..Default::default()` must set it.
- `DoowError` has a new `PartialAccept` variant, and `DoowError::Api` has a new `retry_after` field, so exhaustive matches need an arm and struct patterns need `..`.
- All 5xx statuses and 408 are now retryable, not only 500, 502, 503, and 504.

### Fixes

- `sanitize_text` also replaces Unicode bidirectional controls and line or paragraph separators with spaces, in addition to control characters.
- `shutdown()` returns immediately on a disabled tracker instead of waiting forever for a flush loop that was never started.
- `metric_tuple_hint` is serialized as the `{app_name, license_name, metric_name}` object instead of a JSON string.
- HTTP 207 partial acceptance is reported through `on_error` and is not retried.
- `Retry-After` is honored and clamped to 30 seconds. A panicking `on_error` handler no longer unwinds into the caller.
- A blank `source_system` defaults to `sdk`.
- `on_error` panics are caught with `catch_unwind`, which does not apply when the application builds with `panic = "abort"`.
- Response bodies are read in chunks and capped at 1 MiB.
