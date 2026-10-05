# Changelog

All notable changes to `@doow/track` will be documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## Unreleased

### Fixes

- Replaying the offline store ends at the first batch the server cannot take, so an outage no longer cycles the same batches forever, and a 401 or a rate-limited replay puts the batch back in the store instead of discarding it.
- HTTP 207 rejections are read from the API's numeric `rejected` plus `rejections[]` shape, sanitized, and reported through `onError` without a resend.
- Only 429, 5xx, and network errors are retried. A permanent 4xx is reported once, and a single event that exceeds the 413 payload limit is reported instead of being retried forever.
- `Retry-After` is clamped to 30 seconds, and a throwing `onError` handler never escapes `flush`.

## [0.1.0] — 2026-04-20

Initial release.

### Added

- `DoowTracker` — core tracking class with full init options surface (18 options)
- Automatic flush on `flushAt` (event count), `flushInterval` (timer), and `maxPayloadBytes` (size)
- Ring buffer with configurable `maxQueueSize` (drop oldest when full)
- Gzip compression with `Content-Encoding: gzip` (disable via `disableCompression`)
- Exponential backoff with ±20% jitter, configurable `retryCount`
- 429 rate limiting: respects `Retry-After` header + `X-Doow-Rate-Limits` per-category header
- 413 adaptive batch halving on payload-too-large
- 207 partial accept: surfaces rejected event IDs via `onError`
- 401 auth failure: stops SDK permanently, surfaces `AUTH_FAILURE` error
- `beforeSend` / `beforeFlush` hooks for per-event and per-batch filtering
- `FileOfflineStore` — atomic FIFO persistent store for failed batches; drains on reconnect
- Serverless wrappers: `withLambda`, `withVercel`, `withAzureFunction` — guaranteed flush before return
- Sidecar process: stdin / file-tail / TCP input modes, HTTP `/healthz` endpoint
- CLI daemon: `--config`, `--api-key`, `--pidfile`, `--version` flags, `SIGHUP` config reload
- Environment variable overrides for all major options (`DOOW_TRACK_*`)
- `__SDK_VERSION__` compile-time constant — wire protocol `sdk_version` and `X-Doow-SDK-Version` header track package.json version
- Full TypeScript types exported (`DoowTrackerOptions`, `TrackEvent`, `SdkError`, etc.)
- 137 unit tests across all stories
