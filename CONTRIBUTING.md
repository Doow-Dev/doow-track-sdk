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

This triggers a major release (X.0.0).

## Releasing

Releases are automatic. When you merge to `main`:

1. CI reads your commit messages
2. Determines version bump per SDK
3. Updates version numbers
4. Publishes to package registries
5. Creates git tags

You don't need to manually bump versions or create tags.
