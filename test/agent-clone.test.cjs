'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { cloneTemplateFromAgent, defaultCloneWorkspace } = loadTs('src/shared/agentClone.ts');

const read = (rel) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

const jim = {
  id: 'jim-abc',
  name: 'Jim',
  character: 'jim',
  accent: 'sky',
  provider: 'grok',
  model: 'grok-4',
  command: 'grok --model grok-4',
  description: 'Backend engineer',
  goal: 'keep the API green',
  cwd: '/repos/api',
  worktreePath: '/repos/api/.worktrees/agent-jim-abc'
};

test('a template copies identity, engine and briefing — never the workspace', () => {
  const t = cloneTemplateFromAgent(jim, 250000);
  assert.equal(t.sourceId, 'jim-abc');
  assert.equal(t.sourceName, 'Jim');
  assert.equal(t.sourceCwd, '/repos/api');
  assert.equal(t.name, 'Jim');
  assert.equal(t.character, 'jim');
  assert.equal(t.accent, 'sky');
  assert.equal(t.provider, 'grok', 'engines a hire manifest cannot name still clone');
  assert.equal(t.model, 'grok-4');
  assert.equal(t.command, 'grok --model grok-4');
  assert.equal(t.description, 'Backend engineer');
  assert.equal(t.goal, 'keep the API green');
  assert.equal(t.isolate, true, 'a worktree on the source means it was spawned isolated');
  assert.equal(t.tokenCap, 250000);
  assert.ok(!('cwd' in t), 'the template must not carry a cwd — that is what the human picks');
});

test('defaults: legacy agents, blank goal, no cap', () => {
  const t = cloneTemplateFromAgent({ ...jim, provider: undefined, goal: '', worktreePath: undefined }, undefined);
  assert.equal(t.provider, 'claude');
  assert.equal(t.goal, undefined);
  assert.equal(t.isolate, false);
  assert.equal(t.tokenCap, undefined);
  assert.equal(cloneTemplateFromAgent(jim, 0).tokenCap, undefined, 'a zero cap is no cap');
});

test('the default workspace for a clone is a DIFFERENT repo than the source', () => {
  const t = cloneTemplateFromAgent(jim);
  assert.equal(defaultCloneWorkspace(t, ['/repos/api', '/repos/web']), '/repos/web');
  assert.equal(defaultCloneWorkspace(t, ['/repos/web', '/repos/api']), '/repos/web');
  assert.equal(defaultCloneWorkspace(t, ['/repos/api']), '', 'only the source repo registered: force a pick');
  assert.equal(defaultCloneWorkspace(t, []), '');
});

test('Add Agent seeds from the template and opens on the workspace section', () => {
  const modal = read('src/renderer/src/components/AddAgentModal.tsx');
  assert.match(modal, /const cloneTemplate = useStore\(s => s\.addAgentTemplate\);/);
  assert.match(modal, /if \(cloneTemplate && !pendingHire\) applyCloneTemplate\(cloneTemplate\);/,
    'a hire under review must win over a clone template');
  assert.match(modal, /setCwd\(defaultCloneWorkspace\(c, repos\)\);\s*setSection\('workspace'\);/);
  // The source's token budget follows the clone through the same IPC a hire uses.
  assert.match(modal, /hireMeta\?\.tokenCap \?\? \(!pendingHire \? cloneTemplate\?\.tokenCap : undefined\)/);
  // A custom command is the only case where the source's command is reused
  // verbatim; presets rebuild so the clone gets today's global flags.
  assert.match(modal, /prov === 'custom' && c\.command\?\.trim\(\)/);
});

test('the clone entry point lives in Edit Agent and swaps dialogs without saving', () => {
  const edit = read('src/renderer/src/components/EditAgentModal.tsx');
  assert.match(edit, /const cloneToAnotherRepo = \(\) => \{[\s\S]*?onClose\(\);\s*setAddAgentOpen\(true, template\);\s*\};/);
  assert.ok(!/cloneToAnotherRepo = \(\) => \{[\s\S]*?updateAgent\([\s\S]*?setAddAgentOpen/.test(edit),
    'cloning must not patch the source agent');
  assert.match(edit, /\{canPickWorkspace && \(\s*<PixelButton[^>]*onClick=\{cloneToAnotherRepo\}/,
    'the orchestrator is not cloneable');
  const store = read('src/renderer/src/store/store.ts');
  assert.match(store, /addAgentOpen: open, addAgentTemplate: open \? \(template \?\? null\) : null/,
    'closing Add Agent must drop the template so the next plain open is blank');
});
