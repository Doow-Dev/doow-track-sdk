# Changelog

## Unreleased

### Batch size

- `flush` sends more than 500 events as separate requests of at most 500 events, each with its own batch id, so a large backlog no longer exceeds the API's per-minute event limit and loops on `429`.

### Fixes

- Requests send the `batch_id`/`sdk_version` envelope, HTTP 207 is reported as `PartialAcceptError`, and `shutdown` flushes queued events before closing.
- `Retry-After` is clamped to 30 seconds and a throwing `onError` handler no longer causes a resend.
