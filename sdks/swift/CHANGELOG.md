# Changelog

## Unreleased

## [0.1.2] — 2026-10-08

### Fixed

- A `unit` set on an event is now sent at event level, where earlier releases accepted it and then dropped it before the request.

## [0.1.1] — 2026-10-07

### Batch size

- A `408` request timeout is retried like `429` and `5xx`.
- After a transient failure the remaining chunks are requeued instead of each spending a full retry budget, and count-triggered flushes pause until the next flush interval.
- `flush` sends more than 500 events as separate requests of at most 500 events, each with its own batch id, so a large backlog no longer exceeds the API's per-minute event limit and loops on `429`.

### Additions

- `TrackerOptions` accepts a `session` (`URLSession`) so tests and apps can inject a configured session.
- `PartialAcceptError` and `EventRejection` report HTTP 207 partial acceptance through `onError`.

### Removed

- The `doow-sidecar` executable product and `DoowSidecar` target. No sources ever backed them, so the package did not build.

### Fixes

- Requests send the `batch_id`/`sdk_version` envelope and a real gzip stream. Compression is omitted off Apple platforms.
- `Retry-After` is honored (429 and 503) and clamped, and server text is sanitized and bounded.
- Sanitized server text also has the Unicode line and paragraph separators (U+2028 and U+2029) replaced with spaces, alongside the control and bidirectional characters it already covered.
- The response body is read through one session delegate that cancels at 1 MiB on Apple platforms and on Linux (checked in a `swift:6.0` container). Foundation on Linux ignores per-task delegates, so callbacks are routed by task identifier.
- A response that never finishes, such as a slow drip or a stalled body, is cut off after `timeoutSeconds` plus 5 seconds and reported as `URLError.timedOut`.
- The tracker now owns a session built from the configuration of the `session` option, and `shutdown()` invalidates it after the final flush.
