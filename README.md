# env-check

[![CI](https://github.com/ym-scripts/env-check/actions/workflows/ci.yml/badge.svg)](https://github.com/ym-scripts/env-check/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Catch a missing environment variable before it reaches production.** `env-check` compares your `.env` with `.env.example` and reports missing, empty, extra and duplicated keys. It **never prints values**, so its output is safe in CI logs.

```bash
npx github:ym-scripts/env-check
```

```text
env-check  .env vs .env.example

  ✖ Missing (2): MAIL_HOST, STRIPE_SECRET
  ▲ Empty (1): SENTRY_DSN
  ▲ Not in .env.example (1): OLD_FLAG
  ▲ Duplicate in .env: APP_ENV (lines 3, 18)

✖ 2 problems. Run with --fix to add missing keys.
```

No dependencies. Needs Node.js 18+. It works with Laravel, Next.js, Vite, Expo, Docker Compose, and anything else that uses dotenv files.

## Usage

```bash
env-check                                  # .env vs .env.example
env-check --fix                            # append missing keys using the example's values
env-check -e .env -e .env.local            # merge files, later wins (Next.js style)
env-check -x .env.production.example -e .env.production
env-check --process-env --strict           # in CI: check the real environment
env-check --json                           # for scripts
```

### Options

| Option                             | Description                                                                                    |
| ---------------------------------- | ---------------------------------------------------------------------------------------------- |
| `-e`, `--env FILE`                 | Env file to check. Repeatable; later files win. Default `.env`.                                |
| `-x`, `--example FILE`             | Reference file. Default `.env.example`.                                                        |
| `-p`, `--process-env`              | Check the current process environment instead of a file.                                       |
| `-s`, `--strict`                   | Also fail on keys missing from the example and on empty values.                                |
| `-i`, `--ignore KEY`               | Skip a key. `*` wildcards work, for example `--ignore 'VITE_*'`. Repeatable.                   |
| `--fix`                            | Append missing keys to the env file, with the example's values. It creates the file if needed. |
| `--json`                           | JSON output: `missing`, `empty`, `extra`, `duplicates`, `optionalMissing`, `fixed`.            |
| `-q`, `--quiet`                    | Only print problems.                                                                           |
| `-v`, `--version` / `-h`, `--help` | Version / help.                                                                                |

### What counts as a problem

| Finding                                  | Default   | With `--strict` |
| ---------------------------------------- | --------- | --------------- |
| Key in the example, missing from the env | ✖ error   | ✖ error         |
| Key present but empty                    | ▲ warning | ✖ error         |
| Key in the env, not in the example       | ▲ warning | ✖ error         |
| Same key defined twice in one file       | ▲ warning | ▲ warning       |
| Example key marked `# optional`, not set | listed    | listed          |

Mark optional keys in the example file with an inline comment:

```dotenv
SENTRY_DSN=          # optional
```

### Exit codes

| Code | Meaning                             |
| ---- | ----------------------------------- |
| `0`  | No problems                         |
| `1`  | Problems found                      |
| `2`  | Usage error, or a file wasn't found |

## Recipes

**Fail a CI build when a deployment would miss a variable:**

```yaml
- run: npx -y github:ym-scripts/env-check#v0.1.0 --process-env --ignore 'GITHUB_*'
  env:
    APP_KEY: ${{ secrets.APP_KEY }}
    DATABASE_URL: ${{ secrets.DATABASE_URL }}
```

**Keep `.env.example` honest.** Add this to a pre-commit hook or `package.json` script:

```bash
npx github:ym-scripts/env-check --strict
```

With `--strict`, adding a key to `.env` without documenting it in `.env.example` fails the check.

**After `git pull`:** run `env-check --fix` to pick up keys a teammate added.

## Parsing

It reads the same format as dotenv and Laravel: `KEY=value`, `export KEY=value`, `#` comments, inline comments after unquoted values, and single, double and backtick quotes, including values that span several lines. Values aren't expanded (`${OTHER}` stays as-is).

## Development

```bash
npm test     # node:test, no dependencies
```

## License

[MIT](LICENSE) © Aghogho Meyoron
