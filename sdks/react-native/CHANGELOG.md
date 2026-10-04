# Changelog

## Unreleased

### Fixes

- Requests send the `batch_id`/`sdk_version` envelope, and HTTP 207 rejections reach `onError` as `PartialAcceptError` without being requeued.
- Permanently rejected batches are reported and dropped instead of requeued forever, and `Retry-After` is clamped to 30 seconds.
- The test script now runs `vitest` (Jest was never installed).
