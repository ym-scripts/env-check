#!/usr/bin/env node
// env-check: compare a .env file with .env.example, without ever printing values.
// https://github.com/ym-scripts/env-check
//
// Copyright (c) 2026 Aghogho Meyoron. MIT License.
import { readFileSync, appendFileSync, existsSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const VERSION = '0.1.0';

const HELP = `env-check ${VERSION}: compare .env with .env.example.

Usage: env-check [options]

  -e, --env FILE        Env file to check (repeatable; later files win)  default: .env
  -x, --example FILE    Reference file                                   default: .env.example
  -p, --process-env     Check the current environment instead of a file (CI)
  -s, --strict          Also fail on keys missing from the example and on empty values
  -i, --ignore KEY      Skip a key; * wildcards allowed (repeatable)
      --fix             Append missing keys to the env file, with the example's values
      --json            Machine-readable output
  -q, --quiet           Only print problems
  -v, --version         Print the version
  -h, --help            Show this help

In the example file, mark a key optional with an inline "# optional" comment.

Exit codes: 0 OK, 1 problems found, 2 usage error or file not found.`;

// ---------- args ----------
function parseArgs(argv) {
  const o = { env: [], example: '.env.example', processEnv: false, strict: false, ignore: [], fix: false, json: false, quiet: false };
  const value = (i, name) => {
    if (i >= argv.length || argv[i].startsWith('-')) usageError(`${name} needs a value`);
    return argv[i];
  };
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i];
    if (a.startsWith('--') && a.includes('=')) {
      const at = a.indexOf('=');
      argv.splice(i + 1, 0, a.slice(at + 1));
      a = a.slice(0, at);
    }
    switch (a) {
      case '-e': case '--env': o.env.push(value(++i, a)); break;
      case '-x': case '--example': o.example = value(++i, a); break;
      case '-p': case '--process-env': o.processEnv = true; break;
      case '-s': case '--strict': o.strict = true; break;
      case '-i': case '--ignore': o.ignore.push(value(++i, a)); break;
      case '--fix': o.fix = true; break;
      case '--json': o.json = true; break;
      case '-q': case '--quiet': o.quiet = true; break;
      case '-v': case '--version': console.log(VERSION); process.exit(0);
      case '-h': case '--help': console.log(HELP); process.exit(0);
      default: usageError(`Unknown option: ${a}`);
    }
  }
  if (o.processEnv && o.env.length) usageError('Use either --env or --process-env, not both');
  if (o.processEnv && o.fix) usageError('--fix needs an env file, not --process-env');
  if (o.fix && o.env.length > 1) usageError('--fix works with a single --env file');
  if (!o.processEnv && !o.env.length) o.env.push('.env');
  return o;
}

function usageError(msg) {
  console.error(`✖ ${msg}\n  See: env-check --help`);
  process.exit(2);
}

// ---------- dotenv parser ----------
// Handles comments, `export`, single/double/backtick quotes (multi-line too),
// escaped quotes and inline comments. Returns [{ key, value, line, comment }].
export function parseDotenv(text) {
  const out = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s?(.*)$/);
    if (!m) continue;
    const [, key] = m;
    const line = i + 1;
    let rest = m[2].trimStart();
    let value;
    let comment = '';
    const q = rest[0];
    if (q === '"' || q === "'" || q === '`') {
      let buf = rest.slice(1);
      let end = findClose(buf, q);
      while (end < 0 && i + 1 < lines.length) {
        buf += '\n' + lines[++i];
        end = findClose(buf, q);
      }
      if (end < 0) end = buf.length;
      value = buf.slice(0, end);
      if (q === '"') value = value.replace(/\\n/g, '\n').replace(/\\(["\\])/g, '$1');
      const after = buf.slice(end + 1).match(/^\s*#(.*)$/);
      if (after) comment = after[1].trim();
    } else {
      const hash = rest.search(/(^|\s)#/);
      if (hash >= 0) {
        comment = rest.slice(hash).replace(/^\s*#/, '').trim();
        rest = rest.slice(0, hash);
      }
      value = rest.trim();
    }
    out.push({ key, value, line, comment });
  }
  return out;
}

function findClose(s, q) {
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && q === '"') i++;
    else if (s[i] === q) return i;
  }
  return -1;
}

// ---------- compare ----------
const globRe = (p) => new RegExp('^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');

export function compare({ example, actual, duplicates = [], strict = false, ignore = [] }) {
  const ignored = (k) => ignore.some((p) => globRe(p).test(k));
  const exampleKeys = new Map(example.map((e) => [e.key, e]));
  const missing = [];
  const optionalMissing = [];
  const empty = [];
  for (const [key, e] of exampleKeys) {
    if (ignored(key)) continue;
    const optional = /\boptional\b/i.test(e.comment);
    if (!actual.has(key)) (optional ? optionalMissing : missing).push(key);
    else if (actual.get(key) === '' && !optional) empty.push(key);
  }
  const extra = [...actual.keys()].filter((k) => !exampleKeys.has(k) && !ignored(k));
  const errors = missing.length + (strict ? extra.length + empty.length : 0);
  return { missing, optionalMissing, empty, extra, duplicates, errors, ok: errors === 0 };
}

function readEnvFile(file) {
  if (!existsSync(file)) usageError(`File not found: ${file}`);
  return parseDotenv(readFileSync(file, 'utf8'));
}

function duplicatesIn(entries, file) {
  const seen = new Map();
  for (const e of entries) seen.set(e.key, [...(seen.get(e.key) || []), e.line]);
  return [...seen].filter(([, l]) => l.length > 1).map(([key, lines]) => ({ file, key, lines }));
}

// ---------- main ----------
function main() {
  const o = parseArgs(process.argv.slice(2));
  const example = readEnvFile(o.example);
  const actual = new Map();
  const duplicates = [];
  let source;
  if (o.processEnv) {
    for (const [k, v] of Object.entries(process.env)) actual.set(k, v ?? '');
    source = 'environment';
  } else {
    for (const f of o.env) {
      // --fix may create the env file, so a missing one counts as empty.
      const entries = o.fix && !existsSync(f) ? [] : readEnvFile(f);
      duplicates.push(...duplicatesIn(entries, f));
      for (const e of entries) actual.set(e.key, e.value);
    }
    source = o.env.join(' + ');
  }

  // Everything in the process environment is "extra", so only compare example keys there.
  const r = compare({ example, actual, duplicates, strict: o.strict, ignore: o.ignore });
  if (o.processEnv) r.extra = [];
  r.errors = r.missing.length + (o.strict ? r.extra.length + r.empty.length : 0);
  r.ok = r.errors === 0;

  let fixed = [];
  if (o.fix && r.missing.length) {
    const byKey = new Map(example.map((e) => [e.key, e]));
    const target = o.env[0];
    const lines = r.missing.map((k) => `${k}=${quote(byKey.get(k).value)}`);
    const current = existsSync(target) ? readFileSync(target, 'utf8') : '';
    const sep = current && !current.endsWith('\n') ? '\n' : '';
    appendFileSync(target, `${sep}\n# Added by env-check from ${o.example} on ${new Date().toISOString().slice(0, 10)}\n${lines.join('\n')}\n`);
    fixed = r.missing;
    r.missing = [];
    r.errors = o.strict ? r.extra.length + r.empty.length : 0;
    r.ok = r.errors === 0;
  }

  if (o.json) {
    console.log(JSON.stringify({ source, example: o.example, ...r, fixed }, null, 2));
    process.exit(r.ok ? 0 : 1);
  }

  const color = process.stdout.isTTY && !process.env.NO_COLOR;
  const paint = (c, s) => (color ? `\x1b[${c}m${s}\x1b[0m` : s);
  const red = (s) => paint(31, s), yellow = (s) => paint(33, s), green = (s) => paint(32, s), dim = (s) => paint(2, s);
  const list = (keys) => keys.join(', ');
  const sev = (isError) => (isError ? red('✖') : yellow('▲'));

  if (!o.quiet) console.log(`env-check  ${source} ${dim('vs')} ${o.example}\n`);
  if (r.missing.length) console.log(`  ${red('✖')} Missing (${r.missing.length}): ${list(r.missing)}`);
  if (fixed.length) console.log(`  ${green('✔')} Added to ${o.env[0]} (${fixed.length}): ${list(fixed)}`);
  if (r.empty.length) console.log(`  ${sev(o.strict)} Empty (${r.empty.length}): ${list(r.empty)}`);
  if (r.extra.length) console.log(`  ${sev(o.strict)} Not in ${o.example} (${r.extra.length}): ${list(r.extra)}`);
  for (const d of r.duplicates) console.log(`  ${yellow('▲')} Duplicate in ${d.file}: ${d.key} (lines ${d.lines.join(', ')})`);
  if (r.optionalMissing.length && !o.quiet) console.log(dim(`  · Optional, not set (${r.optionalMissing.length}): ${list(r.optionalMissing)}`));

  if (r.ok) {
    if (!o.quiet) console.log(green(`\n✔ All ${example.length} keys from ${o.example} are present.`));
  } else {
    console.log(red(`\n✖ ${r.errors} problem${r.errors > 1 ? 's' : ''}.`) + (r.missing.length && !o.fix ? dim(' Run with --fix to add missing keys.') : ''));
  }
  process.exit(r.ok ? 0 : 1);
}

function quote(v) {
  if (v === '') return '';
  return /[\s#"'\\]/.test(v) || v.includes('\n') ? `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"` : v;
}

// Run as a CLI, but not when imported by the tests.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
