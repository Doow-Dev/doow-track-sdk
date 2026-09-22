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
