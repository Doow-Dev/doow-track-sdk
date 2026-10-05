# Changelog

## Unreleased

### Batch size

- A `408` request timeout is retried like `429` and `5xx`, an event that cannot be serialized is dropped on its own, and the requeue is trimmed to `maxQueueSize`.
- Count-triggered flushes pause until the next flush interval after a transient failure, so a long outage no longer retries on every tracked event.
- A flush of more than 500 events is sent as separate requests of at most 500 events, each with its own batch id. A retryable failure requeues that chunk and every chunk after it, in order.

### Fixes

- Requests send the `batch_id`/`sdk_version` envelope, and HTTP 207 rejections reach `onError` as `PartialAcceptError` without being requeued.
- Permanently rejected batches are reported and dropped instead of requeued forever, and `Retry-After` is clamped to 30 seconds.
- The test script now runs `vitest` (Jest was never installed).
