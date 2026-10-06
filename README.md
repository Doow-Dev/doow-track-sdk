# Doow Track SDKs

Official SDKs for Doow usage telemetry across all platforms.

## SDKs

| SDK | Package | Registry |
|-----|---------|----------|
| TypeScript/Node | `@doow/track` | npm |
| React | `@doow/track-react` | npm |
| Next.js | `@doow/track-nextjs` | npm |
| React Native | `@doow/track-react-native` | npm |
| Go | `github.com/Doow-Dev/doow-track-sdk/sdks/go` | pkg.go.dev |
| Python | `doow-track` | PyPI |
| Rust | `doow-track` | crates.io |
| .NET | `DoowTrack` | NuGet |
| Java | `co.doow:track` | Maven Central |
| Kotlin | `co.doow:track-kotlin` | Maven Central |
| Ruby | `doow-track` | RubyGems |
| Dart | `doow_track` | pub.dev |
| PHP | `doow/track` | Packagist |
| Swift | `DoowTrack` | Swift Package Manager |

## Installation

See individual SDK READMEs in `sdks/<language>/README.md` for installation instructions.

## Batch size

A batch may contain at most 1,000 events, which is the per-minute event limit for an organization. The API rejects a larger batch with a non-retryable `413` and `error: batch_too_large`, because it can never fit under the limit. Every SDK that queues events sends at most 500 events per request and splits a larger flush into several requests, each with its own `batch_id`, so you do not need to split batches yourself. The one exception is the Next.js `ServerTracker.trackBatch`, which sends exactly the events you pass as a single request. If you call the HTTP API directly, split batches client-side.

The API also rejects a request body larger than 10 MB with a non-retryable `413` and `error: payload_too_large`. A chunk of 500 events is normally far below that, so it only happens when events carry very large `metadata`. The TypeScript SDK halves the request and retries it, whereas every other SDK reports the error and drops that chunk, so keep per-event metadata small.

When the API is unreachable (a network error, `408`, `429`, or `5xx` after the retries), the SDK stops sending, keeps the unsent events at the front of its queue, and pauses count-triggered flushes for one flush interval. If the queue reaches its maximum size during a long outage, the behavior depends on the SDK. Go, PHP, Python, Rust, and TypeScript drop the oldest event to make room for each new one, whereas Dart, .NET, Java, Kotlin, Next.js, React, React Native, Ruby, and Swift drop new events until the queue has room again. Each SDK's README states which policy it uses.

## Short-lived processes

A function or script that exits right after it handles a request can lose events that are still in the queue. Call the SDK's flush method before the handler returns, and call its shutdown method only when the process itself is about to exit, because a tracker that has been shut down stops its background flushing, most SDKs also drop any event tracked afterwards, and a warm function instance reuses its tracker. Set the flush threshold (`flushAt`, spelled as each SDK spells it) to 1 if every event must leave immediately. The TypeScript SDK's `withLambda`, `withVercel`, and `withAzureFunction` wrappers set the threshold to 1 and flush before the handler returns, as described in the [TypeScript serverless guide](sdks/typescript/docs/serverless.md).

## Standalone CLI / daemon

The `doow-track` executable is also released for Linux x64/arm64, macOS x64/arm64, and Windows Server x64. It accepts newline-delimited JSON events, so applications in any supported language can use it without installing Node.js or a language SDK on the server. See the [daemon guide](docs/daemon.md) for downloads, configuration, and service setup.

## Guides for any language

These guides do not depend on a particular SDK:

- [Daemon / CLI guide](docs/daemon.md) covers the standalone executable, its systemd unit, and the config file.
- [Sidecar guide](docs/sidecar.md) covers the Docker image for Docker Compose and Kubernetes, which takes events over stdin, a file, or TCP.
- [OTLP guide](docs/otlp.md) covers forwarding usage metrics from an OpenTelemetry Collector without installing an SDK.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for commit conventions and release process.

## Releasing

A release is a git tag named `<sdk>-vX.Y.Z`, where `<sdk>` is the folder name under `sdks/` and `X.Y.Z` is the version in that SDK's package file. Bump the version and merge it before you tag.

```bash
# Release TypeScript SDK 1.0.0
git tag typescript-v1.0.0
git push origin typescript-v1.0.0
```

Two pipelines act on a tag, and each SDK has exactly one publisher:

- The Woodpecker pipeline in `.woodpecker.yml` publishes every SDK except TypeScript to its registry.
- The GitHub Actions workflow `.github/workflows/doow-track-sdk-publish.yml` publishes TypeScript. It rejects a tag that is not plain `X.Y.Z` or that differs from the version in `sdks/typescript/package.json`. It then builds and tests everything, publishes the sidecar image `ghcr.io/doow-dev/doow-track-sidecar` with the tags `X.Y.Z`, `X`, and `latest`, creates a GitHub release that carries the five CLI executables and their checksums, and publishes the npm package last, because an npm version can never be reused.

The older tags `sdk/v0.1.0` to `sdk/v0.1.10` predate this convention and stay as they are. Do not create new tags in that form, because no pipeline acts on them. List the full set of tags with `git ls-remote --tags origin`.

## License

MIT
