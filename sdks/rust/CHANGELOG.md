# Changelog

## Unreleased

### Breaking changes

- `TrackerOptions` has a new `on_error: Option<ErrorHandler>` field. Code that builds the struct without `..Default::default()` must set it.
- `DoowError` has a new `PartialAccept` variant, so exhaustive matches need an arm for it.

### Fixes

- `metric_tuple_hint` is serialized as the `{app_name, license_name, metric_name}` object instead of a JSON string.
- HTTP 207 partial acceptance is reported through `on_error` and is not retried.
