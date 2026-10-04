# Changelog

## Unreleased

### Behavior changes

- Page-unload delivery uses `fetch` with `keepalive` and the Bearer header instead of `navigator.sendBeacon`, which cannot send the Authorization header. A hidden-tab flush that fails transiently is requeued.
- `destroy()` removes its page listeners and sends every queued event with a normal request.

### Fixes

- Requests send the `batch_id`/`sdk_version` envelope, `TrackEvent` accepts `sourceSystem` and `metricTupleHint`, and HTTP 207 rejections reach `onError` as `PartialAcceptError`.
- Exhausted 429/5xx retries reach `onError`, permanent 4xx responses are not retried, and `Retry-After` is clamped to 30 seconds.
