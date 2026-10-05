# Changelog

## Unreleased

### Batch size

- A `408` request timeout is retried like `429` and `5xx`, and an event that cannot be serialized is dropped on its own instead of blocking the queue.
- After a transient failure (network error, `429`, or `5xx` after the retries) the remaining chunks are requeued instead of each spending a full retry budget, and count-triggered flushes pause until the next flush interval.
- A flush of more than 500 events is sent as separate requests of at most 500 events, each with its own batch id, so a large backlog no longer exceeds the API's per-minute event limit and loops on `429`.

### Behavior changes

- Page-unload delivery uses `fetch` with `keepalive` and the Bearer header instead of `navigator.sendBeacon`, which cannot send the Authorization header. A hidden-tab flush that fails transiently is requeued.
- `destroy()` removes its page listeners and sends every queued event with a normal request.

### Fixes

- Requests send the `batch_id`/`sdk_version` envelope, `TrackEvent` accepts `sourceSystem` and `metricTupleHint`, and HTTP 207 rejections reach `onError` as `PartialAcceptError`.
- Exhausted 429/5xx retries reach `onError`, permanent 4xx responses are not retried, and `Retry-After` is clamped to 30 seconds.
