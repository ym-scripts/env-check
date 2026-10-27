import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDotenv, compare } from '../env-check.mjs';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'env-check.mjs');

function project(files) {
  const dir = mkdtempSync(join(tmpdir(), 'env-check-'));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}
function run(dir, args = [], env = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', ...env } });
  return { code: r.status, out: r.stdout + r.stderr };
}

test('parser: comments, export, quotes, multi-line, inline comments', () => {
  const env = parseDotenv([
    '# comment',
    'export A=1',
    'B = "two # not a comment"  # real comment',
    "C='single'",
    'D="line1',
    'line2"',
    'E=plain value # optional',
    'F=',
    'G="esc \\"q\\""',
    'not a line',
    'H=a#b',
  ].join('\n'));
  const by = Object.fromEntries(env.map((e) => [e.key, e]));
  assert.deepEqual(env.map((e) => e.key), ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
  assert.equal(by.B.value, 'two # not a comment');
  assert.equal(by.B.comment, 'real comment');
  assert.equal(by.C.value, 'single');
  assert.equal(by.D.value, 'line1\nline2');
  assert.equal(by.E.value, 'plain value');
  assert.equal(by.E.comment, 'optional');
  assert.equal(by.F.value, '');
  assert.equal(by.G.value, 'esc "q"');
  assert.equal(by.H.value, 'a#b');
  assert.equal(by.H.line, 11);
});

test('compare: missing, empty, extra, optional, ignore, strict', () => {
  const example = parseDotenv('A=\nB=\nC= # optional\nD=\nSKIP_ME=');
  const actual = new Map([['A', 'x'], ['B', ''], ['X', '1']]);
  const r = compare({ example, actual, ignore: ['SKIP_*'] });
  assert.deepEqual(r.missing, ['D']);
  assert.deepEqual(r.optionalMissing, ['C']);
  assert.deepEqual(r.empty, ['B']);
  assert.deepEqual(r.extra, ['X']);
  assert.equal(r.errors, 1);
  assert.equal(compare({ example, actual, strict: true, ignore: ['SKIP_*'] }).errors, 3);
});

test('cli: passes when everything is present', () => {
  const dir = project({ '.env.example': 'A=\nB=x\n', '.env': 'A=1\nB=2\n' });
  const r = run(dir);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /All 2 keys/);
});

test('cli: fails on missing keys and never prints values', () => {
  const dir = project({ '.env.example': 'A=\nSECRET=\n', '.env': 'A=hunter2-value\n' });
  const r = run(dir);
  assert.equal(r.code, 1);
  assert.match(r.out, /Missing \(1\): SECRET/);
  assert.doesNotMatch(r.out, /hunter2/);
});

test('cli: strict fails on extra and empty', () => {
  const dir = project({ '.env.example': 'A=\nB=\n', '.env': 'A=1\nB=\nZ=1\n' });
  assert.equal(run(dir).code, 0);
  assert.equal(run(dir, ['--strict']).code, 1);
});

test('cli: --fix appends missing keys and creates the file', () => {
  const dir = project({ '.env.example': 'A=default\nB="has space"\n', '.env': 'A=1' });
  assert.equal(run(dir, ['--fix']).code, 0);
  const text = readFileSync(join(dir, '.env'), 'utf8');
  assert.match(text, /^A=1\n\n# Added by env-check/);
  assert.match(text, /\nB="has space"\n$/);
  assert.equal(run(dir).code, 0);

  const fresh = project({ '.env.example': 'A=1\n' });
  assert.equal(run(fresh, ['--fix']).code, 0);
  assert.equal(readFileSync(join(fresh, '.env'), 'utf8').trim().split('\n').pop(), 'A=1');
});

test('cli: multiple env files merge, later wins', () => {
  const dir = project({ '.env.example': 'A=\nB=\n', '.env': 'A=1\nB=\n', '.env.local': 'B=2\n' });
  assert.equal(run(dir, ['--strict']).code, 1);
  assert.equal(run(dir, ['--strict', '-e', '.env', '-e', '.env.local']).code, 0);
});

test('cli: --process-env checks the environment', () => {
  const dir = project({ '.env.example': 'ENVCHECK_A=\nENVCHECK_B=\n' });
  assert.equal(run(dir, ['--process-env'], { ENVCHECK_A: '1' }).code, 1);
  assert.equal(run(dir, ['-p', '--strict'], { ENVCHECK_A: '1', ENVCHECK_B: '2' }).code, 0);
});

test('cli: duplicates are reported', () => {
  const dir = project({ '.env.example': 'A=\n', '.env': 'A=1\nA=2\n' });
  assert.match(run(dir).out, /Duplicate in \.env: A \(lines 1, 2\)/);
});

test('cli: --json output', () => {
  const dir = project({ '.env.example': 'A=\nB=\n', '.env': 'A=1\n' });
  const r = run(dir, ['--json']);
  assert.equal(r.code, 1);
  assert.deepEqual(JSON.parse(r.out).missing, ['B']);
});

test('cli: usage errors exit 2', () => {
  const dir = project({ '.env.example': 'A=\n' });
  assert.equal(run(dir, ['--nope']).code, 2);
  assert.equal(run(dir).code, 2);                  // no .env
  assert.equal(run(dir, ['--example']).code, 2);   // missing value
  assert.equal(run(dir, ['-p', '--fix']).code, 2);
  assert.equal(run(dir, ['--version']).code, 0);
});
