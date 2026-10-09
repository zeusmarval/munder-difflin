'use strict';

/**
 * Regression for silent overwrites in an agent's inbox. `deliver()` wrote
 * `<msg.id>.json`, and the id is chosen by the SENDER: it is not unique across
 * senders. On one floor 15 agents each sent `closing-ack`, and every copy landed
 * on the same file name in the orchestrator's inbox — an unread message was
 * overwritten by the next, and once the agent moved one to `.done/`, the next
 * move overwrote the handled copy. Nothing logged it.
 *
 * A name already taken (in inbox/ or inbox/.done/) by a DIFFERENT message now
 * gets a `~<sender>` suffix (then `~2`…) and a `collision` log line. Re-delivering
 * the same message keeps its name, so nothing duplicates.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { HiveManager } = loadTs('src/main/hive.ts');

async function floor(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-collision-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'god-1', name: 'Michael', provider: 'claude', cwd: home, isGod: true });
  await hive.ensureAgent({ id: 'jim-1', name: 'Jim', provider: 'claude', cwd: home });
  await hive.ensureAgent({ id: 'pam-1', name: 'Pam', provider: 'claude', cwd: home });
  await hive.ensureAgent({ id: 'kelly-1', name: 'Kelly', provider: 'claude', cwd: home });
  const inbox = path.join(hive.root(), 'agents', 'god-1', 'inbox');
  return { hive, inbox };
}

const collisions = (hive) => hive.logTail(500).filter((e) => e.kind === 'collision');
const files = (dir) => fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();

test('two senders with the same id both survive in the inbox', async (t) => {
  const { hive, inbox } = await floor(t);

  hive.send({ id: 'closing-ack', to: 'god', subject: 'ack', body: 'from jim' }, 'jim-1');
  hive.send({ id: 'closing-ack', to: 'god', subject: 'ack', body: 'from pam' }, 'pam-1');

  assert.deepEqual(files(inbox), ['closing-ack.json', 'closing-ack~pam-1.json']);
  const bodies = hive.inbox('god-1').map((m) => m.body).sort();
  assert.deepEqual(bodies, ['from jim', 'from pam'], 'neither message was overwritten');
  assert.equal(hive.inbox('god-1')[0].id, 'closing-ack', 'the message id itself is unchanged');
  const [c] = collisions(hive);
  assert.equal(c.from, 'pam-1');
  assert.equal(c.file, 'closing-ack~pam-1.json');
});

test('a name already in .done/ is not reused, so the next move cannot clobber it', async (t) => {
  const { hive, inbox } = await floor(t);

  hive.send({ id: 'closing-ack', to: 'god', body: 'from jim' }, 'jim-1');
  fs.renameSync(path.join(inbox, 'closing-ack.json'), path.join(inbox, '.done', 'closing-ack.json'));
  hive.send({ id: 'closing-ack', to: 'god', body: 'from pam' }, 'pam-1');

  assert.deepEqual(files(inbox), ['closing-ack~pam-1.json']);
  const handled = JSON.parse(fs.readFileSync(path.join(inbox, '.done', 'closing-ack.json'), 'utf8'));
  assert.equal(handled.body, 'from jim', 'the handled copy is untouched');
});

test('the same sender reusing an id for different content gets a numbered suffix', async (t) => {
  const { hive, inbox } = await floor(t);

  hive.send({ id: 'x', to: 'god', body: 'one' }, 'jim-1');
  hive.send({ id: 'x', to: 'god', body: 'two' }, 'jim-1');
  hive.send({ id: 'x', to: 'god', body: 'three' }, 'jim-1');

  assert.deepEqual(files(inbox), ['x.json', 'x~jim-1.json', 'x~jim-1~2.json']);
  assert.equal(collisions(hive).length, 2);
});

test('re-delivering the SAME message keeps its name and logs no collision', async (t) => {
  const { hive, inbox } = await floor(t);

  const msg = { id: 'same', to: 'god', subject: 's', body: 'b' };
  hive.send(msg, 'kelly-1');
  hive.send(msg, 'kelly-1');

  assert.deepEqual(files(inbox), ['same.json']);
  assert.equal(collisions(hive).length, 0);
});
