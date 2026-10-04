# Changelog

## Unreleased

### Fixes

- Requests send the `batch_id`/`sdk_version` envelope, HTTP 207 is reported as `PartialAcceptError`, and `shutdown` flushes queued events before closing.
- `Retry-After` is clamped to 30 seconds and a throwing `onError` handler no longer causes a resend.
