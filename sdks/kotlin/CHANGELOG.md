# Changelog

## Unreleased

### Batch size

- After a transient failure the remaining chunks are requeued instead of each spending a full retry budget, count-triggered flushes pause until the next flush interval, and an interrupted flush stops sending further chunks.
- `flush` sends more than 500 events as separate requests of at most 500 events, each with its own batch id, so a large backlog no longer exceeds the API's per-minute event limit and loops on `429`.

### Breaking changes

- `DoowError` is now `open`, and `PartialAcceptError` extends it. Handlers that match on `DoowError` still receive it.

### Fixes

- Requests now send the `batch_id`/`sdk_version` envelope and per-event `event_id`, `occurred_at`, `source_system`, and `measurements`.
- HTTP 207 partial acceptance is reported to `onError` as `PartialAcceptError` and is not retried.
- Permanent 4xx responses and failing `onError` handlers no longer stop the periodic flush loop.
- Added a pinned Gradle 8.5 wrapper. The Kotlin 1.9.20 plugin does not work on Gradle 9.
