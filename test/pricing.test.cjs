'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { priceFor, estimateCostUsd, normalizeModel } = loadTs('src/main/pricing.ts');

const inOut = (model) => {
  const p = priceFor(model);
  return [p.inputPerM, p.outputPerM];
};

test('the Claude 5 family prices by tier, Fable included', () => {
  assert.deepEqual(inOut('claude-fable-5-1'), [10, 50]);
  assert.deepEqual(inOut('claude-fable-5'), [10, 50]);
  assert.deepEqual(inOut('claude-mythos-5-1'), [10, 50]);
  assert.deepEqual(inOut('claude-opus-5-5'), [4, 20]);
  assert.deepEqual(inOut('claude-opus-5'), [5, 25]);
  assert.deepEqual(inOut('claude-sonnet-5-5'), [2, 10]);
  assert.deepEqual(inOut('claude-sonnet-5'), [2, 10]);
  assert.deepEqual(inOut('claude-haiku-4-5-20251001'), [1, 5]);
});

test('newer models carry their own cache-read rate', () => {
  assert.equal(priceFor('claude-opus-5-5').cacheReadPerM, 0.2);
  assert.equal(priceFor('claude-fable-5-1').cacheReadPerM, 0.25);
  assert.equal(priceFor('claude-fable-5').cacheReadPerM, 1);
  assert.equal(priceFor('claude-opus-5-5').cacheWritePerM, 5);
});

test('the 4.x generation keeps its own rates', () => {
  assert.deepEqual(inOut('claude-opus-4-8'), [5, 25]);
  assert.deepEqual(inOut('claude-opus-4-8[1m]'), [5, 25]);
  assert.deepEqual(inOut('claude-opus-4-6'), [5, 25]);
  assert.deepEqual(inOut('claude-opus-4-5-20251101'), [5, 25]);
  assert.deepEqual(inOut('claude-sonnet-4-6[1m]'), [3, 15]);
  assert.deepEqual(inOut('claude-sonnet-4-5'), [3, 15]);
});

test('legacy ids fall on the legacy tiers', () => {
  // Opus 4.1 / 4 / 3 were $15 / $75; the cut came with 4.5.
  assert.deepEqual(inOut('claude-opus-4-1'), [15, 75]);
  assert.deepEqual(inOut('claude-opus-4-20250514'), [15, 75]);
  assert.deepEqual(inOut('claude-3-opus-20240229'), [15, 75]);
  assert.deepEqual(inOut('claude-3-5-haiku-20241022'), [0.8, 4]);
  assert.deepEqual(inOut('claude-3-7-sonnet-20250219'), [3, 15]);
});

test('provider slugs and display labels resolve like the API id', () => {
  assert.deepEqual(inOut('anthropic/claude-opus-5'), [5, 25]);
  assert.deepEqual(inOut('anthropic/claude-opus-5.5'), [4, 20]); // OpenRouter / Copilot dotted form
  assert.deepEqual(inOut('claude-opus-5.5'), [4, 20]);
  assert.deepEqual(inOut('openrouter/anthropic/claude-sonnet-5'), [2, 10]);
  assert.deepEqual(inOut('claude-sonnet-4.5'), [3, 15]); // Copilot's dotted form
  assert.deepEqual(inOut('claude-sonnet-5-thinking-high'), [2, 10]); // Cursor
  assert.deepEqual(inOut('Claude Opus 4.6 (Thinking)'), [5, 25]); // Antigravity label
});

test('an unknown id falls back to Sonnet 4.6, the historical default', () => {
  assert.deepEqual(inOut(undefined), [3, 15]);
  assert.deepEqual(inOut(''), [3, 15]);
  assert.deepEqual(inOut('gpt-5.6-luna-high'), [3, 15]);
});

test('cache rows derive from input: reads at 10 %, writes at 125 %', () => {
  const p = priceFor('claude-opus-5');
  assert.equal(p.cacheReadPerM, 0.5);
  assert.equal(p.cacheWritePerM, 6.25);
});

test('normalizeModel strips only the bracket suffix', () => {
  assert.equal(normalizeModel('claude-opus-4-8[1m]'), 'claude-opus-4-8');
  assert.equal(normalizeModel('  claude-sonnet-5 '), 'claude-sonnet-5');
  assert.equal(normalizeModel(null), '');
});

test('estimateCostUsd no longer under-costs a Fable agent as Sonnet', () => {
  const tokens = { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0 };
  assert.equal(estimateCostUsd('claude-fable-5-1', tokens), 60);
  assert.equal(estimateCostUsd('claude-sonnet-5', tokens), 12);
});
