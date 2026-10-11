# SDK Release Runbook

This repository publishes each SDK independently. A release version belongs to one SDK release stream; do not force every SDK to share the same version. The release tag must match the version in that SDK's canonical manifest.

## Release ownership

Woodpecker (`.woodpecker.yml`) is the only publisher. Do not publish manually from a laptop unless the release owner explicitly decides to recover a failed registry publication. GitHub Actions is not the publisher.

| SDK / artifact | Canonical version source | Tag | Destination |
|---|---|---|---|
| TypeScript SDK | `sdks/typescript/package.json` | `typescript-vX.Y.Z` | npm `@doow/track` |
| CLI / daemon + sidecar | TypeScript package version | `typescript-vX.Y.Z` | GitHub Release + GHCR `ghcr.io/doow-dev/doow-track-sidecar` |
| React | `sdks/react/package.json` | `react-vX.Y.Z` | npm |
| Next.js | `sdks/nextjs/package.json` | `nextjs-vX.Y.Z` | npm |
| React Native | `sdks/react-native/package.json` | `react-native-vX.Y.Z` | npm |
| Python | `sdks/python/pyproject.toml` | `python-vX.Y.Z` | PyPI |
| Go | `sdks/go/go.mod` | `sdks/go/vX.Y.Z` | Go module proxy / pkg.go.dev |
| Rust | `sdks/rust/Cargo.toml` | `rust-vX.Y.Z` | crates.io |
| .NET | `sdks/dotnet/src/DoowTrack/DoowTrack.csproj` | `dotnet-vX.Y.Z` | NuGet |
| Java | `sdks/java/pom.xml` | `java-vX.Y.Z` | Maven Central |
| Kotlin | `sdks/kotlin/build.gradle.kts` | `kotlin-vX.Y.Z` | Maven Central Portal |
| Ruby | `sdks/ruby/*.gemspec` | `ruby-vX.Y.Z` | RubyGems |
| Dart | `sdks/dart/pubspec.yaml` | `dart-vX.Y.Z` | pub.dev |
| PHP | `sdks/php/composer.json` | `php-vX.Y.Z` and bare `vX.Y.Z` | Packagist |
| Swift | `Package.swift` / Swift package metadata | `swift-vX.Y.Z` and bare `vX.Y.Z` | Swift Package Manager |

PHP and Swift share the bare `vX.Y.Z` tag namespace. Before releasing either, verify that the bare version has not already been used by the other. Do not create a bare tag for any other SDK.

## What counts as latest

“Latest” is per release stream, not one global number. For each SDK, compare all three values before release or audit:

1. The version in the canonical manifest.
2. The latest matching git tag on the remote.
3. The latest version visible in the target registry.

They should agree. A merged version bump without its tag is not released. A tag without a matching manifest is invalid and must not be force-moved casually.

Useful audit commands:

```bash
git fetch origin main --tags
git show origin/main:sdks/typescript/package.json | jq -r .version
git tag -l '*-v*' 'sdks/go/v*' | sort -V

npm view @doow/track version
curl -fsS https://pypi.org/pypi/doow-track/json | jq -r .info.version
curl -fsS https://crates.io/api/v1/crates/doow-track | jq -r .crate.max_version
curl -fsS https://rubygems.org/api/v1/gems/doow-track.json | jq -r .version
curl -fsS https://pub.dev/api/packages/doow_track | jq -r .latest.version
```

Use the registry's documented API for NuGet, Maven Central, Packagist, and Swift when auditing those streams. Record unavailable registry responses rather than guessing.

## Before changing a version

1. Confirm the SDK's latest shipped version using the three-way audit above.
2. Inspect open PRs and merged PRs since the last tag.
3. Read the SDK-specific changelog and release notes.
4. Update the canonical manifest and its lockfile when one exists. Do not regenerate a lockfile if that tool drops required optional entries; edit only the version fields when that is the established repository practice.
5. Run the package's build, typecheck, lint, and tests from `docs/COMMANDS.md` as applicable.
6. Run `git diff --check`.
7. Open a version-bump PR. The PR must include the exact tag to create after merge and the registry destination.
8. Wait for Woodpecker PR and push checks to pass, then merge the version bump.

Do not tag a branch or a commit that is not on the target default branch.

## Tagging and publishing

After the version PR merges:

```bash
git fetch origin main --tags
git show origin/main:sdks/typescript/package.json | jq -r .version
git tag -a typescript-v0.1.15 <merged-main-sha> -m 'Release TypeScript SDK v0.1.15'
git push origin typescript-v0.1.15
```

Substitute the SDK-specific tag and version. Before pushing, verify the tag does not already exist and the tag version exactly equals the manifest version. Never force-move a published tag. If a tag was published partially, stop and recover with a new version or an explicitly approved registry/tag recovery plan.

### TypeScript release outputs

A `typescript-vX.Y.Z` tag runs, in order:

1. Version verification.
2. TypeScript and sidecar bundle build.
3. Multi-arch sidecar image publication (`linux/amd64`, `linux/arm64`) with full, `0`, and `latest` tags.
4. Five CLI/daemon binaries: Linux x64/arm64, macOS x64/arm64, and Windows x64, with SHA256 files.
5. GitHub Release creation and asset upload.
6. npm publication last.

The CLI step smoke-tests Linux x64 only; it builds and checksums all five assets.

### Other SDK release outputs

Each other tag runs only that SDK's publisher. A TypeScript tag does not republish React, Python, Go, Rust, Java, Kotlin, Ruby, Dart, PHP, Swift, or .NET. Create separate tags when those SDKs have new merged versions.

## After pushing a tag

1. Find the tag pipeline in Woodpecker and inspect every step, not only the final status.
2. Confirm the version verification step passed.
3. Confirm the package-specific publish step passed.
4. Verify the registry version and distribution files.
5. For TypeScript, verify the GitHub Release has all ten files (five binaries plus five checksums), npm `latest` points to the new version, and the GHCR image has the full version tag.
6. Record the pipeline number, commit, tag, registry versions, and any blocked toolchains in `.claude/comms/ACTIVITY.md`.

## Failure and recovery

### Failed before publishing

If version verification, build, tests, or packaging fails before a registry publish, fix the workflow or source in a PR, merge it, and create a new release tag/version as needed. Do not rerun an old tag against a different commit unless the release owner explicitly approves that recovery.

### Partial publication

If one destination succeeds and a later destination fails, do not assume the release is complete. Record exactly what published. Do not blindly rerun a tag: npm versions and git tags cannot be reused, and an existing GitHub Release or GHCR tag may already exist. Prefer a new patch version when a clean release is needed.

### CLI/daemon release gotcha

Woodpecker interpolates `$` expressions in command blocks. Shell-local variables must be written as `$$variable` in `.woodpecker.yml`; otherwise the server can substitute them before the shell runs. This matters for loops that package the five CLI targets and for GitHub Release asset uploads. Keep `CI_*` variables as single-dollar Woodpecker variables.

### PHP CI

The PHP CI step must install `mbstring`, run Composer without masks, and run both PHPUnit and PHPStan. Do not add `|| true` to dependency installation or analysis. A green PHP step must mean the tests and analysis actually ran.

## Release record

Every release activity entry should include:

- SDK and version.
- Merged commit and tag.
- Woodpecker pipeline number and result.
- Registry/GHCR/GitHub Release verification.
- Any local toolchain limitations.
- Whether a staging smoke test was run and whether the key was revoked.
