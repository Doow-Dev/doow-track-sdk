# Changelog

## Unreleased

### Breaking changes

- `TrackerOptions` has a new `on_error: Option<ErrorHandler>` field. Code that builds the struct without `..Default::default()` must set it.
- `DoowError` has a new `PartialAccept` variant, and `DoowError::Api` has a new `retry_after` field, so exhaustive matches need an arm and struct patterns need `..`.
- All 5xx statuses and 408 are now retryable, not only 500, 502, 503, and 504.

### Fixes

- `metric_tuple_hint` is serialized as the `{app_name, license_name, metric_name}` object instead of a JSON string.
- HTTP 207 partial acceptance is reported through `on_error` and is not retried.
- `Retry-After` is honored and clamped to 30 seconds. A panicking `on_error` handler no longer unwinds into the caller.
- A blank `source_system` defaults to `sdk`.
- `on_error` panics are caught with `catch_unwind`, which does not apply when the application builds with `panic = "abort"`.
- Response bodies are read in chunks and capped at 1 MiB.
