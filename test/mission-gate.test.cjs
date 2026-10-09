'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { shouldSkipIdleMission, skipWhenIdleEnabled } = loadTs('src/main/missionGate.ts');
const { OPS_STANDUP_MISSION } = loadTs('src/main/config.ts');

const T = 1_000_000;
const standup = { id: 'ops-standup', lastFiredAt: T };

test('the built-in standup skips by default, including installs saved before the flag existed', () => {
  assert.equal(OPS_STANDUP_MISSION.skipWhenIdle, true);
  assert.equal(skipWhenIdleEnabled({ id: 'ops-standup' }), true, 'a persisted standup without the field');
  assert.equal(skipWhenIdleEnabled({ id: 'my-reminder' }), false, "a user's own mission fires as scheduled");
  assert.equal(skipWhenIdleEnabled({ id: 'ops-standup', skipWhenIdle: false }), false, 'and the user can turn it off');
});

test('an unchanged floor skips; worker activity or real mail fires', () => {
  assert.equal(shouldSkipIdleMission({ mission: standup, lastWorkerActivityAt: T - 1, godActionableInbox: 0 }), true);
  assert.equal(shouldSkipIdleMission({ mission: standup, lastWorkerActivityAt: 0, godActionableInbox: 0 }), true,
    'no workers at all is an unchanged floor');
  assert.equal(shouldSkipIdleMission({ mission: standup, lastWorkerActivityAt: T + 1, godActionableInbox: 0 }), false);
  assert.equal(shouldSkipIdleMission({ mission: standup, lastWorkerActivityAt: 0, godActionableInbox: 1 }), false);
});

test('a mission that never ran always fires', () => {
  assert.equal(shouldSkipIdleMission({ mission: { id: 'ops-standup' }, lastWorkerActivityAt: 0, godActionableInbox: 0 }), false);
});
