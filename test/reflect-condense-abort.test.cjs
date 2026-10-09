'use strict';

/**
 * The memory condenser's two abort classes must be told apart, and its hidden
 * session must never be charged to an agent.
 *
 * - `not-smaller` is the verify gate doing its job (the file is already near its
 *   floor, e.g. right after a /compact): the original is untouched. On one floor
 *   it was 303 of 1007 condense-aborts, read as failures by everyone counting.
 *   It is now logged with `benign: true`; `summarize-failed` stays `benign: false`.
 * - The circuit breaker counts api errors by OTel `agent.id` and tool use by the
 *   agent-id env. A dev build inherits its launching shell, so a condense session
 *   that inherited an agent's identity would charge every failed condense on the
 *   floor to that agent. `condenseEnv` blanks identity and turns telemetry off.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { isBenignAbort, condenseEnv, verify, rebuild, pinnedLines } = loadTs('src/main/reflect.ts');

test('not-smaller is benign; summarize-failed and integrity failures are not', () => {
  assert.equal(isBenignAbort('not-smaller'), true);
  for (const r of ['summarize-failed', 'pinned-line-dropped', 'recent-count-mismatch', 'swap-failed', 'backup-failed']) {
    assert.equal(isBenignAbort(r), false, r);
  }
});

test('the verify gate reports a too-small saving as not-smaller', () => {
  const keep = [{ heading: '## Recent one', body: 'x'.repeat(300) }];
  const rebuilt = rebuild('# Memory', ['- fact'], 'summary '.repeat(40), keep);
  const newBytes = Buffer.byteLength(rebuilt, 'utf8');
  const v = verify({
    rebuilt, newBytes, oldBytes: newBytes + 10, // saves ~0%, needs < 95%
    oldPinnedLines: pinnedLines('- fact'), mergedPinned: ['- fact'],
    condensed: 'summary '.repeat(40), keep
  });
  assert.deepEqual(v, { ok: false, reason: 'not-smaller' });
  assert.equal(isBenignAbort(v.reason), true);
});

test('condense env carries no agent identity and no telemetry, whatever the parent holds', () => {
  const inherited = {
    MEMPALACE_PALACE_PATH: '/palace',
    AGENT_ID: 'oscar-1', AGENT_NAME: 'Oscar',
    OTEL_RESOURCE_ATTRIBUTES: 'agent.id=oscar-1,agent.name=Oscar',
    CLAUDE_CODE_ENABLE_TELEMETRY: '1'
  };
  const env = condenseEnv(inherited);
  assert.equal(env.MEMPALACE_PALACE_PATH, '/palace', 'the memory env still flows through');
  assert.equal(env.CLAUDE_CODE_ENABLE_TELEMETRY, '0');
  assert.doesNotMatch(env.OTEL_RESOURCE_ATTRIBUTES, /agent\.id/);
  assert.equal(env.AGENT_ID, '');
  assert.equal(env.AGENT_NAME, '');
});
