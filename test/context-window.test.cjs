'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { defaultContextWindow, CONTEXT_1M, CONTEXT_200K } = loadTs('src/shared/contextWindow.ts');

test('the Claude 5 family is 1M by default, no alias needed', () => {
  for (const id of ['claude-fable-5-1', 'claude-fable-5', 'claude-mythos-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5', 'claude-sonnet-5', 'claude-opus-5.5']) {
    assert.equal(defaultContextWindow(id), CONTEXT_1M, id);
  }
});

test('the 4.x generation is 200K unless the [1m] alias is present', () => {
  assert.equal(defaultContextWindow('claude-opus-4-8'), CONTEXT_200K);
  assert.equal(defaultContextWindow('claude-opus-4-8[1m]'), CONTEXT_1M);
  assert.equal(defaultContextWindow('claude-sonnet-4-6'), CONTEXT_200K);
  assert.equal(defaultContextWindow('claude-sonnet-4-6[1m]'), CONTEXT_1M);
  assert.equal(defaultContextWindow('claude-haiku-4-5-20251001'), CONTEXT_200K);
});

test('provider slugs and labels are read the same way', () => {
  assert.equal(defaultContextWindow('anthropic/claude-opus-5'), CONTEXT_1M);
  assert.equal(defaultContextWindow('claude-sonnet-5-thinking-high'), CONTEXT_1M);
  assert.equal(defaultContextWindow('Claude Opus 4.6 (Thinking)'), CONTEXT_200K);
  assert.equal(defaultContextWindow('Claude Sonnet 5 (Thinking)'), CONTEXT_1M);
});

test('unknown or empty ids keep the conservative 200K', () => {
  assert.equal(defaultContextWindow(undefined), CONTEXT_200K);
  assert.equal(defaultContextWindow(''), CONTEXT_200K);
  assert.equal(defaultContextWindow('gpt-5.6-luna-high'), CONTEXT_200K);
  // A 4.5 minor version must not read as the 5 generation.
  assert.equal(defaultContextWindow('claude-sonnet-4-5'), CONTEXT_200K);
  // Nor must a date stamp in the pre-4 id order.
  assert.equal(defaultContextWindow('claude-3-5-sonnet-20241022'), CONTEXT_200K);
  assert.equal(defaultContextWindow('claude-3-opus-20240229'), CONTEXT_200K);
});
