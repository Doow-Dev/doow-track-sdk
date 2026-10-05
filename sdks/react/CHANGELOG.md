# Changelog

## Unreleased

### Batch size

- A flush of more than 500 events is sent as separate requests of at most 500 events, each with its own batch id, so a large backlog no longer exceeds the API's per-minute event limit and loops on `429`.

### Behavior changes

- Page-unload delivery uses `fetch` with `keepalive` and the Bearer header instead of `navigator.sendBeacon`, which cannot send the Authorization header. A hidden-tab flush that fails transiently is requeued.
- `destroy()` removes its page listeners and sends every queued event with a normal request.

### Fixes

- Requests send the `batch_id`/`sdk_version` envelope, `TrackEvent` accepts `sourceSystem` and `metricTupleHint`, and HTTP 207 rejections reach `onError` as `PartialAcceptError`.
- Exhausted 429/5xx retries reach `onError`, permanent 4xx responses are not retried, and `Retry-After` is clamped to 30 seconds.
