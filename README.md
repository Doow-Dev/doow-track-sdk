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
| Java | `co.doow:doow-track` | Maven Central |
| Kotlin | `co.doow:doow-track-kotlin` | Maven Central |
| Ruby | `doow_track` | RubyGems |
| Dart | `doow_track` | pub.dev |
| PHP | `doow/track` | Packagist |
| Swift | `DoowTrack` | Swift Package Manager |

## Installation

See individual SDK READMEs in `sdks/<language>/README.md` for installation instructions.

## Units

A metric in Doow can have a unit, such as `GB`, `hours`, `tokens`, or `API calls`, which you set on the metric when you create it (the management API calls it `usage_custom_unit_label`). Send `quantity` already converted to the metric's unit, because Doow records the number you send as it is and does not convert it.

The optional `unit` field records the unit your code used for `quantity`. Doow stores it with the measurement exactly as you send it, after removing control characters, trimming whitespace, and cutting it to 64 characters, and it does not convert it or compare it with the metric's unit, so set it to the unit the metric is defined with.

**Example 1: a count.** The metric `tokens_generated` is defined in tokens, and one request produced 1,500 tokens.

```json
{"metric":"tokens_generated","quantity":1500,"unit":"tokens","license_id":"lic_abc123"}
```

Doow records 1,500 against `tokens_generated`, and the stored unit is `tokens`.

**Example 2: a size.** The metric `data_transfer_gb` is defined in GB, and one export moved 2.5 GB. Send `2.5`, not the number of bytes.

```json
{"metric":"data_transfer_gb","quantity":2.5,"unit":"GB","license_id":"lic_abc123"}
```

Sending `"quantity":2500000000` with `"unit":"bytes"` to the same metric would record 2.5 billion GB. Doow keeps the `bytes` unit with the measurement but does not notice that it differs from the metric's unit, so convert before you send.

The same rule applies to [OTLP](docs/otlp.md#units), the [daemon](docs/daemon.md#event-format), and the [sidecar](docs/sidecar.md#event-format), which all pass `unit` through unchanged.

## Batch size

A batch may contain at most 1,000 events, which is the per-minute event limit for an organization. The API rejects a larger batch with a non-retryable `413` and `error: batch_too_large`, because it can never fit under the limit. Every SDK that queues events sends at most 500 events per request and splits a larger flush into several requests, each with its own `batch_id`, so you do not need to split batches yourself. The one exception is the Next.js `ServerTracker.trackBatch`, which sends exactly the events you pass as a single request. If you call the HTTP API directly, split batches client-side.

The API also rejects a request body larger than 10 MB with a non-retryable `413` and `error: payload_too_large`. A chunk of 500 events is normally far below that, so it only happens when events carry very large `metadata`. The TypeScript SDK halves the request and retries it, whereas every other SDK reports the error and drops that chunk, so keep per-event metadata small.

When the API is unreachable (a network error, `408`, `429`, or `5xx` after the retries), the SDK stops sending, keeps the unsent events at the front of its queue, and pauses count-triggered flushes for one flush interval. If the queue reaches its maximum size during a long outage, the behavior depends on the SDK. Go, PHP, Python, Rust, and TypeScript drop the oldest event to make room for each new one, whereas Dart, .NET, Java, Kotlin, Next.js, React, React Native, Ruby, and Swift drop new events until the queue has room again. Each SDK's README states which policy it uses.

## Short-lived processes

A function or script that exits right after it handles a request can lose events that are still in the queue. Call the SDK's flush method before the handler returns, and call its shutdown method only when the process itself is about to exit, because a tracker that has been shut down stops its background flushing, most SDKs also drop any event tracked afterwards, and a warm function instance reuses its tracker. Set the flush threshold (`flushAt`, spelled as each SDK spells it) to 1 if every event must leave immediately. The TypeScript SDK's `withLambda`, `withVercel`, and `withAzureFunction` wrappers set the threshold to 1 and flush before the handler returns, as described in the [TypeScript serverless guide](sdks/typescript/docs/serverless.md).

## Standalone CLI / daemon

The `doow-track` executable is also released for Linux x64/arm64, macOS x64/arm64, and Windows Server x64. It accepts newline-delimited JSON events, so applications in any supported language can use it without installing Node.js or a language SDK on the server. See the [daemon guide](docs/daemon.md) for downloads, configuration, and service setup.

## Sidecar image

The same input is available as a container image, for platforms where installing an executable is awkward:

```sh
docker pull ghcr.io/doow-dev/doow-track-sidecar:0.1.13
```

The image is private, so pull it from an environment authenticated to GHCR with package read access. Each release publishes three tags: the full version, `0`, and `latest`. Pin the full version in production, because the input contract changes between releases: 0.1.12 moved the container to a non-root user on Node 22 and began enforcing the 1 MiB line limit on file input, so a floating tag changes how a running deployment behaves without anyone upgrading it. The [sidecar guide](docs/sidecar.md) covers Compose and Kubernetes, the input modes, and the health check.

## Guides for any language

These guides do not depend on a particular SDK:

- [Daemon / CLI guide](docs/daemon.md) covers the standalone executable, its systemd unit, and the config file.
- [Sidecar guide](docs/sidecar.md) covers the Docker image for Docker Compose and Kubernetes, which takes events over stdin, a file, or TCP.
- [OTLP guide](docs/otlp.md) covers forwarding usage metrics from an OpenTelemetry Collector without installing an SDK.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for commit conventions and release process.

## Releasing

A release is a git tag named `<sdk>-vX.Y.Z`, where `<sdk>` is the folder name under `sdks/` and `X.Y.Z` is the version in that SDK's package file. Bump the version and merge it before you tag. Two things differ. Go's module lives in a subdirectory of this repository, so it follows Go's own convention and its tags are `sdks/go/vX.Y.Z`. Swift and PHP also need a bare `vX.Y.Z` tag on every release, because Swift Package Manager and Packagist both read versions from plain semver on the repository and ignore the prefixed form. That bare tag series exists for those two ecosystems and means nothing for the others. Because both read the same tags, Swift and PHP share one version line, so a release of either needs a version that neither has used, and the other package then moves to that version too.

```bash
# Release TypeScript SDK 1.0.0
git tag typescript-v1.0.0
git push origin typescript-v1.0.0
```

One pipeline acts on a tag, and every registry has exactly one publisher. The Woodpecker pipeline in `.woodpecker.yml` publishes every SDK. For TypeScript it first rejects a tag that is not plain `X.Y.Z` or that differs from the version in `sdks/typescript/package.json`, then builds the sidecar bundle, pushes the sidecar image `ghcr.io/doow-dev/doow-track-sidecar` tagged with the version, `0`, and `latest`, builds the five CLI executables with their checksums and creates the GitHub release that carries them, and publishes the npm package last, because an npm version can never be reused. Because the build agent is Linux, only the Linux x64 executable can be run there, so it is the one smoke-tested; the other four are built and checksummed.

## License

MIT
