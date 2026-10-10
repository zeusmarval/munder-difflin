'use strict';

/**
 * HARNESS-5 (security). A message's `id` names its inbox file and its `to` names
 * the agent folder, and the SENDER chooses both: `join(inbox, id + '.json')`
 * with an id of `../../jim-1/inbox/forged` wrote a message into ANOTHER agent's
 * inbox, under a name the router never chose. Both fields are now checked
 * against a strict whitelist before any path is composed; an unsafe message is
 * quarantined as `bad-` in the sender's `.sent`, logged with the field and the
 * value, bounced to its author, and never written anywhere else.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { HiveManager, isSafePathSegment } = loadTs('src/main/hive.ts');

async function floor(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-unsafe-id-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'god-1', name: 'Michael', provider: 'claude', cwd: home, isGod: true });
  await hive.ensureAgent({ id: 'jim-1', name: 'Jim', provider: 'claude', cwd: home });
  await hive.ensureAgent({ id: 'pam-1', name: 'Pam', provider: 'claude', cwd: home });
  return { home, hive, agents: path.join(home, 'hive', 'agents') };
}

/** Every .json under the hive except the router's own bookkeeping. */
function jsonFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) jsonFiles(p, out);
    else if (e.name.endsWith('.json')) out.push(p);
  }
  return out;
}

function sendFromOutbox(agents, from, msg, file = 'm1.json') {
  fs.writeFileSync(path.join(agents, from, 'outbox', file), JSON.stringify(msg));
}

const drops = (hive) => hive.logTail(500).filter((e) => e.kind === 'drop');

const MALICIOUS_IDS = [
  ['parent escape', '../x'],
  ['forged into another inbox', '../../pam-1/inbox/forged'],
  ['windows absolute', 'C:\\x'],
  ['forward slash', 'a/b'],
  ['empty', ''],
  ['300 chars', 'a'.repeat(300)],
  ['dot-dot alone', '..'],
  ['hidden / .done', '.done'],
  ['windows device', 'CON'],
  ['not a string', 42]
];

for (const [label, id] of MALICIOUS_IDS) {
  test(`unsafe id is rejected and nothing is written outside: ${label}`, async (t) => {
    const { home, hive, agents } = await floor(t);
    const before = new Set(jsonFiles(home));
    sendFromOutbox(agents, 'jim-1', { id, to: 'god-1', act: 'inform', subject: 'hi', body: 'b' });

    hive.routeOnce();

    assert.equal(hive.inbox('god-1').length, 0, 'the recipient gets nothing');
    assert.equal(hive.inbox('pam-1').length, 0, 'no other agent gets anything');
    assert.ok(fs.existsSync(path.join(agents, 'jim-1', 'outbox', '.sent', 'bad-m1.json')), 'quarantined as bad-');
    const [d] = drops(hive);
    assert.equal(d.reason, 'invalid-id');
    assert.equal(d.from, 'jim-1');
    assert.equal(d.value, String(id).slice(0, 200));
    const back = hive.inbox('jim-1');
    assert.equal(back.length, 1, 'the author learns why');
    assert.match(back[0].subject, /^\[rejected — the message "id"/);
    assert.equal(back[0].body, 'b');
    // The only new files: the quarantined original and the author's bounce.
    const created = jsonFiles(home).filter((p) => !before.has(p));
    assert.deepEqual(created.map((p) => path.relative(agents, p)).sort(),
      [path.join('jim-1', 'inbox', `${back[0].id}.json`), path.join('jim-1', 'outbox', '.sent', 'bad-m1.json')].sort());
  });
}

test('an unsafe "to" is rejected too: it names the agent folder', async (t) => {
  const { hive, agents } = await floor(t);
  sendFromOutbox(agents, 'jim-1', { id: 'ok-id', to: '../agents/god-1', act: 'inform', subject: 's' });
  hive.routeOnce();
  assert.equal(hive.inbox('god-1').length, 0);
  assert.equal(drops(hive)[0].reason, 'invalid-to');
  assert.match(hive.inbox('jim-1')[0].subject, /^\[rejected — the message "to"/);
});

test('send() from IPC/system callers drops an unsafe id without writing', async (t) => {
  const { home, hive } = await floor(t);
  const before = jsonFiles(home).length;
  hive.send({ id: '../../pam-1/inbox/forged', to: 'god-1', subject: 'x' }, 'scheduler');
  assert.equal(hive.inbox('pam-1').length, 0);
  assert.equal(hive.inbox('god-1').length, 0);
  assert.equal(drops(hive)[0].reason, 'invalid-id');
  assert.equal(jsonFiles(home).length, before);
});

test('valid ids still route, including the real ones with Spanish letters', async (t) => {
  const { hive, agents } = await floor(t);
  const id = '2026-09-23T16-37-24-000Z-god-oscar-señal-mapa-color';
  sendFromOutbox(agents, 'jim-1', { id, to: 'god-1', act: 'inform', subject: 'ok' });
  hive.routeOnce();
  const got = hive.inbox('god-1');
  assert.equal(got.length, 1);
  assert.equal(got[0].id, id);
  assert.ok(fs.existsSync(path.join(agents, 'god-1', 'inbox', `${id}.json`)));
  assert.equal(drops(hive).length, 0);
});

test('the whitelist itself', () => {
  for (const ok of ['a', 'jim-mtnusblf', '2026-10-10T20-10-57-000Z-god-jim-17', 'v1.2_x', 'medía', 'a'.repeat(200)]) {
    assert.equal(isSafePathSegment(ok), true, ok);
  }
  for (const bad of ['', '.', '..', 'a..b', '.x', 'a/b', 'a\\b', 'C:x', 'a b', 'nul.txt', 'COM1', 'a'.repeat(201), null, 7]) {
    assert.equal(isSafePathSegment(bad), false, String(bad));
  }
});
