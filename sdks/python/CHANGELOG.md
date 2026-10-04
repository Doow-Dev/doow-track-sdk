# Changelog

## Unreleased

### Additions

- New exports: `PartialAcceptError` and `sanitize_text`. `on_error` receives a `PartialAcceptError` for HTTP 207 partial acceptance.

### Behavior changes

- Transport failures reach `on_error` as a `DoowError` instead of the raw `httpx` exception, which carried the request and its Authorization header.
- Only 429, 5xx, and network errors are retried. A permanent 4xx is reported once. `Retry-After` is honored and clamped to 30 seconds.

### Fixes

- Batches containing a `MetricTupleHint` no longer fail to serialize, and requests now send the `batch_id`/`sdk_version` envelope.
- The async tracker reports exhausted retries through `on_error`.
