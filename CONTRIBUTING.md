# Contributing to Doow SDKs

## Commit Message Format

All commits must follow the [Conventional Commits](https://www.conventionalcommits.org/) format:

```
<type>(<scope>): <description>
```

### Types

- `fix` - Bug fix (triggers patch release: 0.0.X)
- `feat` - New feature (triggers minor release: 0.X.0)
- `chore` - Maintenance tasks (no release)
- `docs` - Documentation only
- `refactor` - Code change that neither fixes a bug nor adds a feature
- `test` - Adding or updating tests
- `ci` - CI/CD changes

### Scopes (required)

Use the SDK name you're changing:

- `typescript`, `react`, `nextjs`, `react-native`
- `go`, `python`, `rust`, `dotnet`
- `java`, `kotlin`, `dart`, `ruby`, `php`, `swift`
- `deps` - dependency updates
- `ci` - CI/CD changes
- `release` - release automation

### Examples

```bash
fix(python): handle empty response from API
feat(react): add useDoowTrack hook
chore(deps): update typescript to 5.3
docs(go): add usage examples
```

### Breaking Changes

For breaking changes, add `BREAKING CHANGE:` in the commit body:

```
feat(typescript): redesign track() API

BREAKING CHANGE: track() now requires a config object instead of positional args
```

Whoever cuts the next release should treat this as a major version bump.

## Releasing

Commit messages do not trigger or version a release. A release is a git tag named `<sdk>-vX.Y.Z`, as described in the Releasing section of the [README](./README.md). Bump the version in the SDK's package file and merge it first. The TypeScript workflow rejects a tag that does not match that version.
