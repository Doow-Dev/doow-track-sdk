# Changelog

All notable changes to `@doow/track` will be documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## Unreleased

## [0.1.14] — 2026-10-09

### Fixed

- `flush()` and `shutdown()` now wait for a send that a full queue or the flush timer already started, so a short-lived script no longer exits before that send finishes. The wait is capped at 30 seconds, and the shutdown timeout timer is cleared once shutdown finishes.

### Changed

- The API now rejects an event whose license belongs to another organization (`license_not_found`) or whose metric name does not exist on its license (`unknown_metric`) as a `207` partial accept, and an event with only a `metric_name` is now resolved without a `metric_tuple_hint`. See [Rejected events](../../README.md#rejected-events).

## [0.1.13] — 2026-10-07

### Changed

- The package metadata now points at `https://github.com/Doow-Dev/doow-track-sdk`, where all fourteen SDKs live, instead of the retired `doow-track` repository that this package advertised since before the SDKs were consolidated.

## [0.1.12] — 2026-10-07

### Behavior changes

- The sidecar image now runs as the non-root `node` user (user ID 1000) on Node 22 instead of root on Node 20. A file mounted for `file:` input must be readable by user ID 1000, and the image works with a read-only root filesystem, all capabilities dropped, and `no-new-privileges`.

### Fixes

- The 1 MiB line limit of the stdin, file, and TCP inputs is measured in UTF-8 bytes, ignores the carriage return of a CRLF line ending, and now applies to every line. A line over the limit is reported as `Input error: Line exceeds 1048576 bytes` and dropped, including a line that arrives complete with its newline and the last line before end of input, and the rest of an oversized line is discarded instead of being parsed as a line of its own. The stdin input also never reported the error before, and the file input did not enforce the limit at all.
- A file input that cannot be read, for example because of its permissions, is now reported once in the log as `Input error: Cannot read <path>` instead of reading zero events without any message.
- The sidecar and the CLI daemon no longer hang on `SIGTERM` or `SIGINT` while a TCP client stays connected. Stopping the TCP input now closes connected clients, so the final flush runs instead of waiting for the idle timeout or a SIGKILL.
- A CLI config reload on `SIGHUP` now swaps only the tracker. It no longer restarts the input reader, which re-sent every line of a file input from its first byte and refused TCP connections during the restart.
- Replaying the offline store ends at the first batch the server cannot take, so an outage no longer cycles the same batches forever, and a 401 or a rate-limited replay puts the batch back in the store instead of discarding it.
- Server-supplied rejection text has Unicode bidirectional controls and line or paragraph separators replaced with spaces, in addition to control characters.
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
