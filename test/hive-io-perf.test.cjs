'use strict';

/**
 * Main-process hot paths in the hive: batched async git commits, the cached
 * registry read, and reading only the tail of log.jsonl.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const loadTs = require('./load-ts.cjs');

const { HiveManager, commitMessage, readLastLines } = loadTs('src/main/hive.ts');

function tmpHome(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-hive-io-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return home;
}

const commitCount = (root) =>
  Number(spawnSync('git', ['rev-list', '--count', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim() || 0);

// --- batched commits ----------------------------------------------------------

test('a lone message is the commit message; a batch lists the distinct ones', () => {
  assert.equal(commitMessage(['hive: register jim-1']), 'hive: register jim-1');
  const msg = commitMessage(['hive: msg a→b (inform)', 'hive: routed 1 message(s)', 'hive: routed 1 message(s)']);
  assert.match(msg, /^hive: 3 changes\n\n/);
  assert.equal(msg.split('\n').filter((l) => l.startsWith('- ')).length, 2, 'duplicates collapse in the body');
});

test('a long batch body is capped', () => {
  const msg = commitMessage(Array.from({ length: 50 }, (_, i) => `hive: msg ${i}`));
  assert.match(msg, /… 30 more$/);
});

test('mutations in a burst become one commit, written off the event loop', async (t) => {
  const home = tmpHome(t);
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'god-1', name: 'Michael', provider: 'claude', cwd: home, isGod: true });
  await hive.drainCommits();
  const root = hive.root();
  const before = commitCount(root);

  hive.send({ to: 'god-1', subject: 'one', body: 'x' }, 'system');
  hive.send({ to: 'god-1', subject: 'two', body: 'y' }, 'system');
  hive.setArchived('god-1', true);
  assert.equal(commitCount(root), before, 'nothing is committed synchronously');

  await hive.drainCommits();
  assert.equal(commitCount(root), before + 1, 'the burst lands as a single commit');
  const status = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).stdout;
  assert.equal(status.trim(), '', 'and it carries every change');
});

test('flushCommitsSync commits what is pending without waiting for the timer', async (t) => {
  const home = tmpHome(t);
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'god-1', name: 'Michael', provider: 'claude', cwd: home, isGod: true });
  await hive.drainCommits();
  const root = hive.root();
  const before = commitCount(root);
  hive.setArchived('god-1', true);
  hive.flushCommitsSync();
  assert.equal(commitCount(root), before + 1);
});

// --- registry cache -------------------------------------------------------------

test('the registry is re-read when the file changes and callers get private copies', async (t) => {
  const home = tmpHome(t);
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'jim-1', name: 'Jim', provider: 'claude', cwd: home });

  const a = hive.registry();
  a.agents['jim-1'].name = 'mutated by a caller that never wrote it back';
  assert.equal(hive.registry().agents['jim-1'].name, 'Jim', 'a caller mutation must not leak into the cache');

  // An outside writer (a different process, a hand edit).
  const p = path.join(hive.root(), 'registry.json');
  const reg = JSON.parse(fs.readFileSync(p, 'utf8'));
  reg.agents['jim-1'].name = 'Jim Halpert';
  fs.writeFileSync(p, JSON.stringify(reg, null, 2));
  assert.equal(hive.registry().agents['jim-1'].name, 'Jim Halpert');

  // Our own write path.
  assert.equal(hive.renameAgent('jim-1', 'Big Tuna').ok, true);
  assert.equal(hive.registry().agents['jim-1'].name, 'Big Tuna');
  await hive.drainCommits();
});

test('a missing or corrupt registry reads as empty', async (t) => {
  const home = tmpHome(t);
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'jim-1', name: 'Jim', provider: 'claude', cwd: home });
  hive.registry();
  fs.writeFileSync(path.join(hive.root(), 'registry.json'), '{ nope');
  assert.deepEqual(hive.registry(), { godId: null, agents: {} });
  fs.rmSync(path.join(hive.root(), 'registry.json'));
  assert.deepEqual(hive.registry(), { godId: null, agents: {} });
  await hive.drainCommits();
});

// --- log tail ------------------------------------------------------------------

test('readLastLines returns the last n lines of a small file', (t) => {
  const file = path.join(tmpHome(t), 'log.jsonl');
  fs.writeFileSync(file, 'a\nb\n\nc\nd\n');
  assert.deepEqual(readLastLines(file, 2), ['c', 'd']);
  assert.deepEqual(readLastLines(file, 10), ['a', 'b', 'c', 'd']);
});

test('readLastLines spans chunks, strips CR, and keeps multi-byte text intact', (t) => {
  const file = path.join(tmpHome(t), 'log.jsonl');
  const lines = Array.from({ length: 5000 }, (_, i) => JSON.stringify({ i, note: 'añadido → ✓ '.repeat(3) }));
  fs.writeFileSync(file, lines.join('\r\n') + '\r\n');
  const tail = readLastLines(file, 3);
  assert.deepEqual(tail, lines.slice(-3));
  assert.equal(readLastLines(file, 4000).length, 4000, 'a window larger than one chunk');
  assert.deepEqual(readLastLines(file, 4000)[0], lines[1000]);
});

test('logTail reads through the tail reader', async (t) => {
  const home = tmpHome(t);
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'jim-1', name: 'Jim', provider: 'claude', cwd: home });
  for (let i = 0; i < 30; i++) hive.appendLog({ kind: 'probe', i });
  const tail = hive.logTail(3);
  assert.deepEqual(tail.map((e) => e.i), [27, 28, 29]);
  assert.deepEqual(hive.logTail(0), []);
  await hive.drainCommits();
});
