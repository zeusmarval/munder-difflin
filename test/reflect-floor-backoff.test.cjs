'use strict';

/**
 * The condense loop must stop paying for agents whose memory.md is already at its
 * floor. Measured on a live floor: 6 of 8 agents were refused as `not-smaller`
 * every 30 minutes, and 3 of those rewrites came out LARGER than the original —
 * a Haiku call per agent per cycle that could never pass the gate.
 *
 * After a `not-smaller` the loop skips that agent until its file regrows 5% past
 * the refused size. The manual "condense now" path still always tries, and a
 * successful condense clears the floor. `condense` is stubbed: no LLM is called.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { MemoryReflector, floorAllows } = loadTs('src/main/reflect.ts');

const SETTINGS = {
  enabled: true, intervalMs: 1_800_000, byteTriggerPct: 50,
  sectionTrigger: 50, recentKeep: 12, minBytes: 16_384
};

function setup(t, outcomes) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-floor-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const dir = path.join(home, 'hive', 'agents', 'a1');
  fs.mkdirSync(dir, { recursive: true });
  const mem = path.join(dir, 'memory.md');
  fs.writeFileSync(mem, 'x'.repeat(70_000)); // above the 50%-of-budget trigger
  const r = new MemoryReflector(() => home, () => 'claude', () => ({}), () => SETTINGS, () => {});
  const calls = [];
  r.condense = async (_home, id, _mem, text) => {
    calls.push(text.length);
    const reason = outcomes.shift() ?? 'not-smaller';
    return { id, condensed: reason === 'condensed', reason, oldBytes: text.length };
  };
  const grow = (n) => fs.appendFileSync(mem, 'y'.repeat(n));
  return { r, calls, grow };
}

test('floorAllows: no floor tries; under 5% regrowth skips; at 5% tries again', () => {
  assert.equal(floorAllows(undefined, 1), true);
  assert.equal(floorAllows(100_000, 104_999), false);
  assert.equal(floorAllows(100_000, 105_000), true);
});

test('after not-smaller the loop stops calling the summarizer until the file regrows', async (t) => {
  const { r, calls, grow } = setup(t, ['not-smaller']);

  await r.reflectNow();
  await r.reflectNow();
  await r.reflectNow();
  assert.equal(calls.length, 1, 'three ticks, one paid call: the floor holds');

  grow(2_000); // ~3%: not enough new material
  await r.reflectNow();
  assert.equal(calls.length, 1);

  grow(2_000); // now >5% past the refused size
  await r.reflectNow();
  assert.equal(calls.length, 2, 'regrowth earns a new try');
});

test('the manual condense-now path ignores the floor', async (t) => {
  const { r, calls } = setup(t, ['not-smaller', 'not-smaller']);
  await r.reflectNow();
  await r.reflectNow('a1');
  assert.equal(calls.length, 2);
});

test('a summarize-failed does not set a floor (transient — retry next tick)', async (t) => {
  const { r, calls } = setup(t, ['summarize-failed', 'not-smaller']);
  await r.reflectNow();
  await r.reflectNow();
  assert.equal(calls.length, 2);
});

test('a successful condense clears the floor', async (t) => {
  const { r, calls, grow } = setup(t, ['not-smaller', 'condensed', 'not-smaller']);
  await r.reflectNow();            // floor set at 70000
  grow(4_000);
  await r.reflectNow();            // regrown -> condensed -> floor cleared
  await r.reflectNow();            // no floor -> tries again
  assert.equal(calls.length, 3);
});
