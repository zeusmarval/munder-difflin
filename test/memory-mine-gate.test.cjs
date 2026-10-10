'use strict';

/**
 * HARNESS-10. A `mempalace mine` holds ~1 GB while it runs (983 and 998 MB on
 * 2026-10-10), and the host's memory-pressure killer took a long QA run down
 * after a mine dropped free RAM to 2339 MB. A mine now starts only with at
 * least 3000 MB free and no `hive/RUNNING.lock`; otherwise the pass stops with
 * a `mine-deferred` event and the agent is retried on the next pass. A lock
 * older than 6 h is a leftover and is ignored (logged once as `mine-lock-stale`).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { MemoryManager, mineGate } = loadTs('src/main/memory.ts');

const MB = 1024 * 1024;

/** A manager over a temp hive with `ids` agents, each with a memory.md.
 *  The mine itself is stubbed: what matters is whether it is started. */
function setup(t, ids, freeMb) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-mine-gate-'));
  for (const id of ids) {
    fs.mkdirSync(path.join(home, 'hive', 'agents', id), { recursive: true });
    fs.writeFileSync(path.join(home, 'hive', 'agents', id, 'memory.md'), `# ${id}\n`);
  }
  const log = [];
  const state = { freeMb };
  const memory = new MemoryManager(() => home, () => ({ enabled: true, model: 'minilm' }),
    (e) => log.push(e), () => state.freeMb * MB);
  memory.bin = () => '/fake/bin/mempalace';
  const mined = [];
  memory.mineAgent = async (_dir, id) => { mined.push(id); };
  t.after(() => { memory.stop(); fs.rmSync(home, { recursive: true, force: true }); });
  return { memory, home, log, mined, state };
}

test('the gate: lock first, then free memory; a 6 h old lock is stale', () => {
  assert.deepEqual(mineGate(5000, null), { ok: true, staleLock: false });
  assert.deepEqual(mineGate(2999, null), { ok: false, reason: 'low-memory' });
  assert.deepEqual(mineGate(3000, null), { ok: true, staleLock: false });
  assert.deepEqual(mineGate(9000, 60_000), { ok: false, reason: 'run-lock' });
  assert.deepEqual(mineGate(9000, 7 * 3600_000), { ok: true, staleLock: true });
  assert.deepEqual(mineGate(1000, 7 * 3600_000), { ok: false, reason: 'low-memory' });
});

test('with enough memory and no lock every changed memory is mined', async (t) => {
  const { memory, mined, log } = setup(t, ['a1', 'a2'], 8000);
  await memory.mineNow();
  assert.deepEqual(mined.sort(), ['a1', 'a2']);
  assert.equal(log.length, 0);
});

test('low free memory defers the pass and the next pass retries it', async (t) => {
  const { memory, mined, log, state } = setup(t, ['a1', 'a2'], 2339);
  await memory.mineNow();
  assert.deepEqual(mined, [], 'no mine starts below the threshold');
  assert.equal(log.length, 1, 'one event per deferred pass, not one per agent');
  assert.equal(log[0].kind, 'mine-deferred');
  assert.equal(log[0].reason, 'low-memory');
  assert.equal(log[0].freeMb, 2339);
  assert.equal(log[0].minFreeMb, 3000);

  state.freeMb = 6000;
  await memory.mineNow();
  assert.deepEqual(mined.sort(), ['a1', 'a2'], 'the deferred agents are mined once memory is back');
});

test('memory dropping mid-pass stops the pass before the next mine', async (t) => {
  const { memory, mined, log, state } = setup(t, ['a1', 'a2', 'a3'], 8000);
  memory.mineAgent = async (_dir, id) => { mined.push(id); state.freeMb = 2000; }; // a mine eats it
  await memory.mineNow();
  assert.equal(mined.length, 1);
  assert.equal(log[0].reason, 'low-memory');
});

test('RUNNING.lock defers mining; removing it resumes; a stale one is ignored and logged once', async (t) => {
  const { memory, home, mined, log } = setup(t, ['a1'], 8000);
  const lock = path.join(home, 'hive', 'RUNNING.lock');
  fs.writeFileSync(lock, 'pam: consolidated run c8');
  await memory.mineNow();
  assert.deepEqual(mined, []);
  assert.equal(log[0].reason, 'run-lock');

  fs.rmSync(lock);
  await memory.mineNow();
  assert.deepEqual(mined, ['a1']);

  fs.writeFileSync(lock, 'left behind');
  const old = (Date.now() - 7 * 3600_000) / 1000;
  fs.utimesSync(lock, old, old);
  fs.appendFileSync(path.join(home, 'hive', 'agents', 'a1', 'memory.md'), 'more\n');
  const t2 = (Date.now() + 5000) / 1000;
  fs.utimesSync(path.join(home, 'hive', 'agents', 'a1', 'memory.md'), t2, t2);
  fs.utimesSync(lock, old, old);
  await memory.mineNow();
  await memory.mineNow();
  assert.deepEqual(mined, ['a1', 'a1'], 'a 7 h old lock does not block');
  assert.equal(log.filter((e) => e.kind === 'mine-lock-stale').length, 1, 'stale lock logged once');
});
