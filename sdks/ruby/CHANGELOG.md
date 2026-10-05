# Changelog

## Unreleased

### Batch size

- After a transient failure the remaining chunks are requeued instead of each spending a full retry budget, and count-triggered flushes pause until the next flush interval.
- `flush` sends more than 500 events as separate requests of at most 500 events, each with its own batch id, so a large backlog no longer exceeds the API's per-minute event limit and loops on `429`.

### Fixes

- Requests send the `batch_id`/`sdk_version` envelope with a per-event `event_id`, and compression is a real gzip stream.
- HTTP 207 is reported as `PartialAcceptError`. `shutdown` joins the flusher instead of killing it, and an exception no longer ends the periodic flush.
- `Retry-After` is honored and clamped to 30 seconds.
