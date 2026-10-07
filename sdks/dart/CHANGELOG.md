# Changelog

## Unreleased

## [0.1.1] — 2026-10-07

### Batch size

- A `408` request timeout is retried like `429` and `5xx`, and the chunk holding an event that cannot be serialized (up to 500 events) is reported and dropped instead of blocking the queue.
- After a transient failure the remaining chunks are requeued instead of each spending a full retry budget, and count-triggered flushes pause until the next flush interval.
- `flush` sends more than 500 events as separate requests of at most 500 events, each with its own batch id, so a large backlog no longer exceeds the API's per-minute event limit and loops on `429`.

### Behavior changes

- The tracker sends through `httpClient.send` instead of `httpClient.post`, so it can stop reading a response at 64 KiB. Every `http.Client` implements `send`, but a custom client that overrides only `post` is no longer called and must override `send` instead.

### Fixes

- The tracker reads at most 64 KiB of a response body, so an oversized or endless response can no longer exhaust memory.
- `sanitizeText` also replaces Unicode bidirectional controls and line or paragraph separators with spaces.
- Requests send the `batch_id`/`sdk_version` envelope, HTTP 207 is reported as `PartialAcceptError`, and `shutdown` flushes queued events before closing.
- `Retry-After` is clamped to 30 seconds and a throwing `onError` handler no longer causes a resend.
