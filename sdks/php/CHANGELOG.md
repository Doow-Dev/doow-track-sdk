# Changelog

## Unreleased

### Behavior changes

- `DoowError` gained an optional `retryAfterSeconds` constructor argument, and `isRetryable()` now covers 408, 429, every 5xx, and transport failures (status 0).
- Transport failures reach `onError` as a `DoowError` instead of the Guzzle exception, which carried the request and its Authorization header.

### Fixes

- The tuple hint serializes with snake_case keys, and `composer.json` autoloads the multi-class files so `TrackEvent`, `MetricTupleHint`, `TrackerOptions`, and the management classes resolve.
- HTTP 207 partial acceptance is reported as `PartialAcceptError`, and a throwing `onError` handler no longer escapes `flush()`.
