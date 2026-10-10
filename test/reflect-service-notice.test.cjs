'use strict';

/**
 * A condense reply that is a SERVICE notice (quota, login, lost connection) is
 * not a summary that failed to parse: the summarizer never ran. In the census of
 * 1412 real condense replies (2026-10-10), 499 were these, and the loop kept
 * asking every agent, every cycle, while the quota was spent.
 *
 * - The notice is classified BEFORE the parse: `summarize-unavailable`, benign.
 * - A quota or login notice is floor-wide, so it pauses the WHOLE loop: until the
 *   reset the notice states (+2 min), or one hour if it states none, never more
 *   than 4 h (then one call probes; a limit can lift early). A lost
 *   connection is one call's luck and pauses nothing.
 * - The loop resumes on its own on the first tick after the pause.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const {
  detectServiceNotice, parseResetTime, pauseUntil, isBenignAbort,
  SummaryUnavailableError, MemoryReflector
} = loadTs('src/main/reflect.ts');

// 2026-10-10 18:00 UTC = 14:00 in America/Caracas (UTC-4, no DST).
const NOW = Date.UTC(2026, 9, 10, 18, 0);

test('the four real notices are classified; a summary is not', () => {
  assert.deepEqual(detectServiceNotice("You've hit your session limit · resets 3:30pm (America/Caracas)", NOW),
    { kind: 'quota', resetAt: Date.UTC(2026, 9, 10, 19, 30) });
  assert.deepEqual(detectServiceNotice("You've hit your weekly limit · resets Oct 12, 4pm (America/Caracas)", NOW),
    { kind: 'quota', resetAt: Date.UTC(2026, 9, 12, 20, 0) });
  assert.deepEqual(detectServiceNotice('Please run /login · API Error: 403 Request not allowed', NOW), { kind: 'login' });
  assert.deepEqual(detectServiceNotice('API Error: Connection lost mid-response. The response above may be incomplete.', NOW),
    { kind: 'connection' });
  assert.equal(detectServiceNotice('{"condensed": "You\'ve hit your session limit twice today", "hoist": []}', NOW), null);
  assert.equal(detectServiceNotice("You've hit your session limit " + 'x'.repeat(600), NOW), null);
});

test('a reset time already past today means tomorrow; a bare hour works', () => {
  // 9am Caracas is behind 14:00 -> tomorrow 13:00 UTC.
  assert.equal(parseResetTime('resets 9am (America/Caracas)', NOW), Date.UTC(2026, 9, 11, 13, 0));
  assert.equal(parseResetTime('resets 12pm (UTC)', NOW), Date.UTC(2026, 9, 11, 12, 0));
  assert.equal(parseResetTime('resets 12am (UTC)', NOW), Date.UTC(2026, 9, 11, 0, 0));
});

test('an unusable reset falls back to the fixed pause', () => {
  assert.equal(parseResetTime('resets 4pm (Not/AZone)', NOW), null);
  assert.equal(parseResetTime('no reset here', NOW), null);
  assert.equal(parseResetTime('resets Dec 30, 4pm (UTC)', NOW), null, 'more than 8 days ahead');
  assert.deepEqual(detectServiceNotice("You've hit your session limit", NOW), { kind: 'quota' });
  assert.equal(pauseUntil({ kind: 'quota' }, NOW), NOW + 60 * 60_000);
  assert.equal(pauseUntil({ kind: 'login' }, NOW), NOW + 60 * 60_000);
  assert.equal(pauseUntil({ kind: 'quota', resetAt: NOW + 1000 }, NOW), NOW + 1000 + 2 * 60_000);
  assert.equal(pauseUntil({ kind: 'connection' }, NOW), null);
  // A far reset is capped at 4 h: limits can lift early (a real weekly notice said 103 h).
  assert.equal(pauseUntil({ kind: 'quota', resetAt: NOW + 103 * 3600_000 }, NOW), NOW + 4 * 3600_000);
  assert.equal(isBenignAbort('summarize-unavailable'), true);
});

function hiveWithAgents(ids) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'reflect-notice-'));
  for (const id of ids) {
    const dir = path.join(home, 'hive', 'agents', id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'memory.md'),
      '# Memory\n\n## one\n' + 'a'.repeat(200) + '\n\n## two\n' + 'b'.repeat(200) + '\n\n## three\nc\n');
  }
  return home;
}

function reflector(home, reply, log) {
  const settings = { enabled: true, intervalMs: 60_000, byteTriggerPct: 0, sectionTrigger: 0, recentKeep: 1, minBytes: 0 };
  const r = new MemoryReflector(() => home, () => 'claude', () => ({}), () => settings, (e) => log.push(e));
  let calls = 0;
  // Stand-in for the hidden session: what summarize() does with a notice reply.
  r.summarize = async () => {
    calls++;
    throw new SummaryUnavailableError(detectServiceNotice(reply, Date.now()), reply);
  };
  return { r, calls: () => calls };
}

test('a quota notice pauses the whole loop after ONE call, then it resumes', async () => {
  const home = hiveWithAgents(['a1', 'a2', 'a3']);
  const log = [];
  const { r, calls } = reflector(home, "You've hit your session limit", log);

  const first = await r.reflectNow();
  assert.equal(calls(), 1, 'the other agents are not asked');
  assert.equal(first[0].reason, 'summarize-unavailable');
  const abort = log.find((e) => e.kind === 'condense-abort');
  assert.equal(abort.reason, 'summarize-unavailable');
  assert.equal(abort.benign, true);
  assert.equal(abort.notice, 'quota');
  assert.equal(abort.responsePrefix, "You've hit your session limit");
  const paused = log.find((e) => e.kind === 'condense-paused');
  assert.equal(paused.notice, 'quota');
  assert.equal(paused.fromReset, false);

  assert.deepEqual(await r.reflectNow(), [], 'paused: no call at all');
  assert.equal(calls(), 1);
  assert.equal(log.filter((e) => e.kind === 'condense-paused').length, 1);

  const manual = await r.reflectNow('a2');
  assert.equal(manual.length, 1, 'the manual button still tries');

  r.pausedUntil = Date.now() - 1; // the pause is over
  await r.reflectNow();
  assert.ok(log.some((e) => e.kind === 'condense-resumed'), 'resumes on its own');
  assert.equal(calls(), 3, 'one call, then it pauses again on the same notice');
});

test('a lost connection aborts that agent only; the loop carries on', async () => {
  const home = hiveWithAgents(['a1', 'a2', 'a3']);
  const log = [];
  const { r, calls } = reflector(home, 'API Error: Connection lost mid-response.', log);
  const out = await r.reflectNow();
  assert.equal(calls(), 3);
  assert.deepEqual(out.map((x) => x.reason), ['summarize-unavailable', 'summarize-unavailable', 'summarize-unavailable']);
  assert.equal(log.some((e) => e.kind === 'condense-paused'), false);
});
