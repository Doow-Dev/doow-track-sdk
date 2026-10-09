# Changelog

## Unreleased

### Changed

- `EntitlementPeriod` and `CarryoverPolicy` now list the values the API accepts, so code that referenced `YEARLY`, `WEEKLY`, `DAILY`, `ONE_TIME`, or `ROLLOVER_CAPPED` no longer compiles. `entitlement_period` is `MONTHLY`, `QUARTERLY`, `ANNUALLY`, `TERM`, `UNTIL_EXHAUSTED`, or `NONE`, and `carryover_policy` is `EXPIRE_AT_PERIOD_END`, `ROLLOVER`, `FIFO_VINTAGE`, or `RESET`. The API never accepted the removed values.
- `RateKind` now lists `PER_UNIT`, `FLAT_FEE`, `PER_SEAT`, `PERCENTAGE`, and `USAGE`, the values the API stores. `TIERED` and `VOLUME` never existed on the API side, so code that referenced them no longer compiles. Creating a metric through the SDK accepts all five; for `PERCENTAGE`, `usage_rate` is a fraction between 0 and 1 and `quantity` is the amount it applies to.
- `UsageAggregationType` now also lists `PEAK`, `AVERAGE`, and `BALANCE`, which the API stores for metrics created in the dashboard, so listing or reading such a metric no longer fails to parse. Creating a metric through the SDK accepts all six, the same as the dashboard.

## [0.1.2] — 2026-10-08

### Fixed

- A `unit` set on an event is now sent at event level, where earlier releases accepted it and then dropped it before the request.
- `doow_track.__version__` and the `sdk_version` sent in each batch now match the package version, where earlier releases reported `0.1.0`.

## [0.1.1] — 2026-10-07

### Batch size

- A `408` request timeout is retried like `429` and `5xx`, and a chunk that cannot be serialized is dropped on its own instead of aborting the flush. Shutdown stores every remaining chunk when an offline store is set.
- After a transient failure the remaining chunks are requeued (a chunk already saved to the offline store is not requeued again) instead of each spending a full retry budget, and count-triggered flushes pause until the next flush interval.
- `Tracker.flush` and `AsyncTracker.flush` send more than 500 events as separate requests of at most 500 events, each with its own batch id, so a large backlog no longer exceeds the API's per-minute event limit and loops on `429`.

### Fixes

- Both trackers read at most 64 KiB of a response body, and `APIError.details` and `error_class` are cleaned of control characters, so a hostile or broken endpoint cannot exhaust memory or inject terminal escapes through an error.
- `sanitize_text` also replaces Unicode bidirectional controls and line or paragraph separators with spaces.
- A `Retry-After` wait now replaces the retry backoff instead of adding to it, and the trackers no longer wait after the final attempt.
- Batches containing a `MetricTupleHint` no longer fail to serialize, and requests now send the `batch_id`/`sdk_version` envelope.
- The async tracker reports exhausted retries through `on_error`.

### Additions

- New exports: `PartialAcceptError` and `sanitize_text`. `on_error` receives a `PartialAcceptError` for HTTP 207 partial acceptance.

### Behavior changes

- Transport failures reach `on_error` as a `DoowError` instead of the raw `httpx` exception, which carried the request and its Authorization header.
- Only 429, 5xx, and network errors are retried. A permanent 4xx is reported once. `Retry-After` is honored and clamped to 30 seconds.
