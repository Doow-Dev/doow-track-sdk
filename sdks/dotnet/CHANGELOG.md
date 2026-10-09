# Changelog

## Unreleased

### Changed

- `EntitlementPeriod` and `CarryoverPolicy` now list the values the API accepts, so code that referenced `YEARLY`, `WEEKLY`, `DAILY`, `ONE_TIME`, or `ROLLOVER_CAPPED` no longer compiles. `entitlement_period` is `MONTHLY`, `QUARTERLY`, `ANNUALLY`, `TERM`, `UNTIL_EXHAUSTED`, or `NONE`, and `carryover_policy` is `EXPIRE_AT_PERIOD_END`, `ROLLOVER`, `FIFO_VINTAGE`, or `RESET`. The API never accepted the removed values.

### Batch size

- A `408` request timeout is retried like `429` and `5xx`, and an unreadable response body no longer changes how a status is classified.
- After a transient failure the remaining chunks are requeued instead of each spending a full retry budget, and count-triggered flushes pause until the next flush interval.
- `FlushAsync` sends more than 500 events as separate requests of at most 500 events, each with its own batch id, so a large backlog no longer exceeds the API's per-minute event limit and loops on `429`.

### Fixes

- Requests send the `batch_id`/`sdk_version` envelope, HTTP 207 is reported as `PartialAcceptError`, and unexpected exceptions reach `OnError` instead of becoming unobserved task exceptions.
- `Retry-After` is honored and clamped to 30 seconds, and server text is sanitized and bounded.
- Sanitized server text also has Unicode bidirectional controls and line or paragraph separators replaced with spaces.
