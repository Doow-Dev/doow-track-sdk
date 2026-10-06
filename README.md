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

## Standalone CLI / daemon

The `doow-track` executable is also released for Linux x64/arm64, macOS x64/arm64, and Windows Server x64. It accepts newline-delimited JSON events, so applications in any supported language can use it without installing Node.js or a language SDK on the server. See the [TypeScript daemon guide](sdks/typescript/docs/daemon.md) for downloads, configuration, and service setup.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for commit conventions and release process.

## Releasing

Releases are triggered by git tags:

```bash
# Release TypeScript SDK v1.0.0
git tag typescript/v1.0.0
git push origin typescript/v1.0.0

# Release Python SDK v0.2.0
git tag python/v0.2.0
git push origin python/v0.2.0
```

CI automatically publishes to the appropriate registry when a tag is pushed.

## License

MIT
