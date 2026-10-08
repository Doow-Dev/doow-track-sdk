# Changelog

## Unreleased

## [0.1.2] — 2026-10-08

### Fixed

- A `unit` set on an event is now sent at event level, where earlier releases accepted it and then dropped it before the request.
- `DoowTrack::VERSION` and the `sdk_version` sent in each batch now match the gem version, where earlier releases reported `0.1.0`, and the gemspec reads its version from `DoowTrack::VERSION` so the two cannot drift.

## [0.1.1] — 2026-10-07

### Batch size

- A `408` request timeout is retried like `429` and `5xx`, and a chunk that cannot be serialized is dropped on its own instead of aborting the flush.
- After a transient failure the remaining chunks are requeued instead of each spending a full retry budget, and count-triggered flushes pause until the next flush interval.
- `flush` sends more than 500 events as separate requests of at most 500 events, each with its own batch id, so a large backlog no longer exceeds the API's per-minute event limit and loops on `429`.

### Fixes

- The tracker reads at most 64 KiB of a response body, and the retry backoff is capped at 10 seconds.
- `DoowTrack.sanitize` also replaces Unicode bidirectional controls and line or paragraph separators with spaces.
- Requests send the `batch_id`/`sdk_version` envelope with a per-event `event_id`, and compression is a real gzip stream.
- HTTP 207 is reported as `PartialAcceptError`. `shutdown` joins the flusher instead of killing it, and an exception no longer ends the periodic flush.
- `Retry-After` is honored and clamped to 30 seconds.
