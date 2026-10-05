# Changelog

## Unreleased

### Batch size

- `FlushAsync` sends more than 500 events as separate requests of at most 500 events, each with its own batch id, so a large backlog no longer exceeds the API's per-minute event limit and loops on `429`.

### Fixes

- Requests send the `batch_id`/`sdk_version` envelope, HTTP 207 is reported as `PartialAcceptError`, and unexpected exceptions reach `OnError` instead of becoming unobserved task exceptions.
- `Retry-After` is honored and clamped to 30 seconds, and server text is sanitized and bounded.
