# Changelog

## Unreleased

### Additions

- `TrackerOptions` accepts a `session` (`URLSession`) so tests and apps can inject a configured session.
- `PartialAcceptError` and `EventRejection` report HTTP 207 partial acceptance through `onError`.

### Removed

- The `doow-sidecar` executable product and `DoowSidecar` target. No sources ever backed them, so the package did not build.

### Fixes

- Requests send the `batch_id`/`sdk_version` envelope and a real gzip stream. Compression is omitted off Apple platforms.
- `Retry-After` is honored (429 and 503) and clamped, and server text is sanitized and bounded.
- The response body is read through one session delegate that cancels at 1 MiB on Apple platforms and on Linux (checked in a `swift:6.0` container). Foundation on Linux ignores per-task delegates, so callbacks are routed by task identifier.
- A response that never finishes, such as a slow drip or a stalled body, is cut off after `timeoutSeconds` plus 5 seconds and reported as `URLError.timedOut`.
- The tracker now owns a session built from the configuration of the `session` option, and `shutdown()` invalidates it after the final flush.
