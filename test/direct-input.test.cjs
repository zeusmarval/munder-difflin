'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { directInputAllowed, directInputLockable } = loadTs('src/shared/directInput.ts');

const read = (rel) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

test('workers are locked by default, the orchestrator and its assistant never are', () => {
  assert.equal(directInputAllowed({ id: 'w1' }), false, 'a plain worker starts locked');
  assert.equal(directInputAllowed({ id: 'w1', directInput: false }), false);
  assert.equal(directInputAllowed({ id: 'w1', directInput: true }), true, 'the operator override opens it');
  assert.equal(directInputAllowed({ id: 'god', isGod: true }), true);
  assert.equal(directInputAllowed({ id: 'god', isGod: true, directInput: false }), true, 'the lock cannot close the orchestrator');
  assert.equal(directInputAllowed({ id: 'asst', isAssistant: true }), true, 'typing to the assistant is typing to Michael');
});

test('an unknown pty is never locked', () => {
  // The terminal pool answers keystrokes for ptys the roster has not adopted
  // yet (a spawn mid-flight). Locking those would freeze a terminal nobody can
  // unlock from the UI.
  assert.equal(directInputAllowed(undefined), true);
  assert.equal(directInputAllowed(null), true);
});

test('the lock control only exists for workers', () => {
  assert.equal(directInputLockable({ id: 'w1' }), true);
  assert.equal(directInputLockable({ id: 'god', isGod: true }), false);
  assert.equal(directInputLockable({ id: 'asst', isAssistant: true }), false);
  assert.equal(directInputLockable(undefined), false);
});

test('every human input path into a terminal consults the lock', () => {
  const pool = read('src/renderer/src/components/terminalPool.ts');
  // Keys: the custom key handler must read the lock and gate its fall-through.
  assert.match(pool, /attachCustomKeyEventHandler\(\(ev\) => \{\s*\/\/[^\n]*\n(?:\s*\/\/[^\n]*\n)*\s*const locked = directInputLockedFor\(ptyId\);/,
    'the key handler must read the lock before anything else');
  assert.match(pool, /return !locked;\s*\}\);/, 'unhandled keys must fall through only when unlocked');
  // Paste + IME ride DOM events on xterm's textarea, not the key handler.
  for (const type of ['paste', 'beforeinput', 'input', 'compositionstart', 'compositionend']) {
    assert.ok(pool.includes(`'${type}'`), `textarea guard must cover ${type}`);
  }
  assert.match(pool, /guardDirectInput\(entry\);/, 'the textarea guard must be installed on open()');
  // Context-menu paste is a third path.
  assert.match(pool, /if \(!directInputLockedFor\(ptyId\)\) pasteClipboard\(\);/);
  // File drops land in the view, not the pool.
  const view = read('src/renderer/src/components/PtyTerminalView.tsx');
  assert.match(view, /if \(directInputLockedFor\(ptyId\)\) return;\s*\n[^\n]*\n\s*void window\.cth\.writePty\(ptyId, paths/,
    'a dropped path must be swallowed while locked');
});

test('the composer and the steer box are gated, the hive queue is not', () => {
  const composer = read('src/renderer/src/components/MessageQueueComposer.tsx');
  assert.match(composer, /const inputLocked = !directInputAllowed\(agent\);/);
  assert.match(composer, /const canSend = !inputLocked && /, 'send must be off while locked');
  assert.match(composer, /disabled=\{inputLocked\}/, 'the textarea must be disabled while locked');
  const strip = read('src/renderer/src/components/AgentControlStrip.tsx');
  assert.match(strip, /if \(!t_ \|\| inputLocked\) return;/, 'steer must not send while locked');
  assert.match(strip, /<AgentInputLockButton agentId=\{agentId\} \/>/, 'the lock button lives in the control strip');
  // Work orders, nudges and compact commands reach a worker through the store
  // queue. That path must stay untouched: the lock is about the HUMAN typing,
  // not about Michael dispatching.
  const hive = read('src/renderer/src/hooks/useHive.ts');
  assert.ok(!hive.includes('directInput'), 'useHive must not consult the direct-input lock');
});

test('the lock survives a reload (durable roster field)', () => {
  const store = read('src/renderer/src/store/store.ts');
  assert.match(store, /directInput\?: boolean;/, 'Agent must carry the flag');
  const volatile = store.match(/const VOLATILE_AGENT_FIELDS = new Set<keyof Agent>\(\[([\s\S]*?)\]\);/);
  assert.ok(volatile, 'volatile field list must exist');
  assert.ok(!volatile[1].includes('directInput'), 'directInput must persist with the roster');
});

test('changing the project in Edit Agent drops the stale worktree', () => {
  const modal = read('src/renderer/src/components/EditAgentModal.tsx');
  assert.match(modal, /cwd: nextCwd, project: basename\(nextCwd\), worktreePath: undefined/,
    'a new cwd must reset project + worktreePath in the same patch');
  assert.match(modal, /const canPickWorkspace = !agent\.isGod && !agent\.isAssistant;/,
    'the orchestrator keeps the hive home');
});
