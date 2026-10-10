'use strict';

/**
 * HARNESS-4. routeOnce had ONE catch for everything: a parse error, a file read
 * while its author was still writing it, a delivery write that hit a transient
 * Windows EPERM — all became `bad-` and were never looked at again. On the live
 * floor 5 of 18 `bad-` files parse perfectly and none was ever delivered; the
 * other 13 are real messages (mostly an invalid `\` escape) whose authors were
 * never told. The cases are now told apart:
 *   - unparseable but still changing → wait (it's mid-write), then route it;
 *   - unparseable and settled → `bad-`, `drop malformed`, bounce to the author;
 *   - delivery threw → retry with backoff under the SAME id; `bad-` after 5;
 *   - delivered but the archive rename failed → retry only the rename (no 2nd copy).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { HiveManager, retryDelay } = loadTs('src/main/hive.ts');

async function floor(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-route-retry-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'god-1', name: 'Michael', provider: 'claude', cwd: home, isGod: true });
  await hive.ensureAgent({ id: 'jim-1', name: 'Jim', provider: 'claude', cwd: home });
  const outbox = path.join(home, 'hive', 'agents', 'jim-1', 'outbox');
  return { hive, outbox, file: path.join(outbox, 'm1.json'), sent: path.join(outbox, '.sent') };
}

const log = (hive, kind) => hive.logTail(500).filter((e) => e.kind === kind);
const ago = (file, ms) => { const t = (Date.now() - ms) / 1000; fs.utimesSync(file, t, t); };
/** Let every pending retry run on the next tick (the backoff is real time). */
const dueNow = (hive) => { for (const s of hive.routeRetry.values()) s.nextAt = 0; };

const MSG = { to: 'god-1', act: 'inform', subject: 'the finding', body: 'details' };

test('a file read mid-write is NOT quarantined: it routes once complete', async (t) => {
  const { hive, file, sent } = await floor(t);
  const full = JSON.stringify(MSG);
  fs.writeFileSync(file, full.slice(0, 20)); // the author is still writing

  hive.routeOnce();
  assert.ok(fs.existsSync(file), 'still in the outbox');
  assert.equal(fs.existsSync(path.join(sent, 'bad-m1.json')), false, 'no bad- for a file still changing');
  assert.equal(log(hive, 'drop').length, 0);

  fs.writeFileSync(file, full); // the write finishes
  hive.routeOnce();
  assert.equal(hive.inbox('god-1').length, 1, 'delivered');
  assert.ok(fs.existsSync(path.join(sent, 'm1.json')));
});

test('settled malformed JSON is quarantined, logged and bounced to its author', async (t) => {
  const { hive, file, sent } = await floor(t);
  const raw = '{"to": "god-1", "subject": "path", "body": "C:\\x is the dir"}'; // invalid \x escape
  fs.writeFileSync(file, raw);
  ago(file, 10_000);

  hive.routeOnce();
  assert.ok(fs.existsSync(path.join(sent, 'bad-m1.json')));
  const [d] = log(hive, 'drop');
  assert.equal(d.reason, 'malformed');
  assert.equal(d.file, 'm1.json');
  assert.match(d.detail, /JSON|escape/i);
  const [back] = hive.inbox('jim-1');
  assert.match(back.subject, /^\[undeliverable — your outbox file "m1.json" is not valid JSON/);
  assert.equal(back.body, raw, 'the author gets its text back to fix');
  assert.equal(hive.inbox('god-1').length, 0);
});

test('a transient delivery failure is retried under the SAME id, not quarantined', async (t) => {
  const { hive, file, sent } = await floor(t);
  fs.writeFileSync(file, JSON.stringify(MSG)); // no id: the router assigns one
  const real = hive.atomicWriteJson.bind(hive);
  let fail = 1;
  hive.atomicWriteJson = (p, data) => {
    if (fail > 0 && p.includes(`${path.sep}inbox${path.sep}`)) { fail--; throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' }); }
    return real(p, data);
  };

  hive.routeOnce();
  assert.ok(fs.existsSync(file), 'kept for retry');
  assert.equal(fs.existsSync(path.join(sent, 'bad-m1.json')), false);
  const [r] = log(hive, 'route-retry');
  assert.equal(r.stage, 'deliver');
  assert.equal(r.attempt, 1);
  assert.match(r.detail, /^EPERM/);

  hive.routeOnce();
  assert.equal(hive.inbox('god-1').length, 0, 'the backoff holds the retry');

  dueNow(hive);
  hive.routeOnce();
  const got = hive.inbox('god-1');
  assert.equal(got.length, 1, 'delivered on the retry');
  assert.equal(got[0].id, r.id, 'same id as the failed attempt');
  assert.ok(fs.existsSync(path.join(sent, 'm1.json')));
});

test('a delivery that keeps failing is given up as bad- after 5 attempts', async (t) => {
  const { hive, file, sent } = await floor(t);
  fs.writeFileSync(file, JSON.stringify({ ...MSG, id: 'stuck-1' }));
  hive.atomicWriteJson = () => { throw Object.assign(new Error('busy'), { code: 'EBUSY' }); };

  for (let i = 0; i < 5; i++) { dueNow(hive); hive.routeOnce(); }
  assert.ok(fs.existsSync(path.join(sent, 'bad-m1.json')));
  assert.equal(log(hive, 'route-retry').length, 4);
  const [d] = log(hive, 'drop');
  assert.equal(d.reason, 'delivery-failed');
  assert.equal(d.attempts, 5);
  assert.equal(d.id, 'stuck-1');
});

test('delivered but not archived: only the archive is retried, no second copy', async (t) => {
  const { hive, file, sent } = await floor(t);
  fs.writeFileSync(file, JSON.stringify({ ...MSG, id: 'once-1' }));
  fs.mkdirSync(path.join(sent, 'm1.json')); // the archive target is blocked

  hive.routeOnce();
  assert.equal(hive.inbox('god-1').length, 1, 'delivered');
  assert.ok(fs.existsSync(file), 'not archived');
  assert.equal(fs.existsSync(path.join(sent, 'bad-m1.json')), false, 'a delivered message is never marked bad');
  assert.equal(log(hive, 'route-retry')[0].stage, 'archive');

  // The recipient handles it meanwhile; a re-delivery would put it back.
  const inbox = path.join(path.dirname(sent), '..', '..', 'god-1', 'inbox');
  fs.mkdirSync(path.join(inbox, '.done'), { recursive: true });
  fs.renameSync(path.join(inbox, 'once-1.json'), path.join(inbox, '.done', 'once-1.json'));

  fs.rmdirSync(path.join(sent, 'm1.json'));
  dueNow(hive);
  hive.routeOnce();
  assert.ok(fs.existsSync(path.join(sent, 'm1.json')), 'archived on the retry');
  assert.equal(hive.inbox('god-1').length, 0, 'not delivered a second time');
  assert.equal(log(hive, 'message').length, 1);
});

test('backoff doubles from 2 s and caps at 60 s', () => {
  assert.deepEqual([1, 2, 3, 4, 10].map(retryDelay), [2000, 4000, 8000, 16000, 60000]);
});
