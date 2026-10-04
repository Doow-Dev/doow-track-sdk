# Changelog

## Unreleased

### Fixes

- Requests send the `batch_id`/`sdk_version` envelope, HTTP 207 is reported as `PartialAcceptError`, and unexpected exceptions reach `OnError` instead of becoming unobserved task exceptions.
- `Retry-After` is honored and clamped to 30 seconds, and server text is sanitized and bounded.
