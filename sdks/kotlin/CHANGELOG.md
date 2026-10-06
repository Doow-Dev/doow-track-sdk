# Changelog

## Unreleased

### Batch size

- A `408` request timeout is retried like `429` and `5xx`, a chunk that cannot be serialized is dropped on its own, an unreadable error body no longer turns a permanent `4xx` into a retry, and an interrupted flush requeues the chunks it did not send. A shutdown during an outage reports how many events it dropped.
- After a transient failure the remaining chunks are requeued instead of each spending a full retry budget, count-triggered flushes pause until the next flush interval, and an interrupted flush stops sending further chunks.
- `flush` sends more than 500 events as separate requests of at most 500 events, each with its own batch id, so a large backlog no longer exceeds the API's per-minute event limit and loops on `429`.

### Breaking changes

- `DoowError` is now `open`, and `PartialAcceptError` extends it. Handlers that match on `DoowError` still receive it.

### Fixes

- Server-supplied error text has Unicode bidirectional controls and line or paragraph separators replaced with spaces, in addition to control characters.
- Requests now send the `batch_id`/`sdk_version` envelope and per-event `event_id`, `occurred_at`, `source_system`, and `measurements`.
- HTTP 207 partial acceptance is reported to `onError` as `PartialAcceptError` and is not retried.
- Permanent 4xx responses and failing `onError` handlers no longer stop the periodic flush loop.
- Added a pinned Gradle 8.5 wrapper. The Kotlin 1.9.20 plugin does not work on Gradle 9.
