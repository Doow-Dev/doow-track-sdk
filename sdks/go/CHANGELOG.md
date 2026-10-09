# Changelog

## Unreleased

### Changed

- `EntitlementPeriod` and `CarryoverPolicy` now list the values the API accepts, so code that referenced `YEARLY`, `WEEKLY`, `DAILY`, `ONE_TIME`, or `ROLLOVER_CAPPED` no longer compiles. `entitlement_period` is `MONTHLY`, `QUARTERLY`, `ANNUALLY`, `TERM`, `UNTIL_EXHAUSTED`, or `NONE`, and `carryover_policy` is `EXPIRE_AT_PERIOD_END`, `ROLLOVER`, `FIFO_VINTAGE`, or `RESET`. The API never accepted the removed values.
- `RateKind` now lists `PER_UNIT`, `FLAT_FEE`, `PER_SEAT`, `PERCENTAGE`, and `USAGE`, the values the API stores. `TIERED` and `VOLUME` never existed on the API side, so code that referenced them no longer compiles. Creating a metric through the SDK accepts all five; for `PERCENTAGE`, `usage_rate` is a fraction between 0 and 1 and `quantity` is the amount it applies to.
- `UsageAggregationType` now also lists `PEAK`, `AVERAGE`, and `BALANCE`, which the API stores for metrics created in the dashboard, so listing or reading such a metric no longer fails to parse. Creating a metric through the SDK accepts all six, the same as the dashboard.
- The same fields of `Metric` (`UsageRate`, `UsageLimit`, `UsageIncluded`, `PerUnitCap`, `UsageRateIsEstimated`, `ExpectedEmissionIntervalMins`) are pointers too, so a limit of `0` reads as `0` and a field the API did not send reads as `nil`. Code that read one of them as a plain value must dereference it after checking for `nil`.
- The optional numeric and boolean fields of `CreateMetricInput` (`UsageRate`, `UsageLimit`, `UsageIncluded`, `PerUnitCap`, `UsageRateIsEstimated`, `ExpectedEmissionIntervalMins`) are now pointers, so a value of `0` or `false` is sent instead of being dropped as empty, and `doow.Ptr` builds the pointer: `UsageLimit: doow.Ptr(0.0)`. Code that set one of these fields to a plain value needs `doow.Ptr(...)`.

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
