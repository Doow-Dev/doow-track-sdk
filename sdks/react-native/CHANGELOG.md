# Changelog

## Unreleased

### Batch size

- A `408` request timeout is retried like `429` and `5xx`, the chunk holding an event that cannot be serialized (up to 500 events) is reported and dropped, and the requeue is trimmed to `maxQueueSize`.
- Count-triggered flushes pause until the next flush interval after a transient failure, so a long outage no longer retries on every tracked event.
- A flush of more than 500 events is sent as separate requests of at most 500 events, each with its own batch id. A retryable failure requeues that chunk and every chunk after it, in order.

### Fixes

- Error and partial-accept responses are read as a stream and cut off at 64 KiB when the runtime exposes a response stream. React Native's built-in `fetch` does not, so there the body is read whole and then truncated.
- Server-supplied error text has Unicode bidirectional controls and line or paragraph separators replaced with spaces, in addition to control characters.
- Requests send the `batch_id`/`sdk_version` envelope, and HTTP 207 rejections reach `onError` as `PartialAcceptError` without being requeued.
- Permanently rejected batches are reported and dropped instead of requeued forever, and `Retry-After` is clamped to 30 seconds.
- The test script now runs `vitest` (Jest was never installed).
