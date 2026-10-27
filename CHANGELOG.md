# Changelog

All notable changes to this project are documented here. This project follows [Semantic Versioning](https://semver.org).

## [0.1.0] - 2026-10-27

### Added
- Compare one or more env files (later files win) with `.env.example`: missing, empty, extra and duplicate keys.
- `--process-env` to check variables injected by CI or a host instead of a file.
- `--strict`, `--ignore` with wildcards, and `# optional` markers in the example file.
- `--fix` to append missing keys with the example's values. It creates the env file if needed.
- `--json` output. Values are never printed.
