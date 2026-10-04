# Changelog

## Unreleased

### Fixes

- Requests send the `batch_id`/`sdk_version` envelope with a per-event `event_id`, and compression is a real gzip stream.
- HTTP 207 is reported as `PartialAcceptError`. `shutdown` joins the flusher instead of killing it, and an exception no longer ends the periodic flush.
- `Retry-After` is honored and clamped to 30 seconds.
