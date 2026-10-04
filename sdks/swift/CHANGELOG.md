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
- Known limitation: on Apple platforms the response body is read through a per-task delegate that cancels at 1 MiB. On Linux (`FoundationNetworking`) the body is buffered and then truncated, because that path is not exercised by CI.
