# Munder Difflin — notes for Claude

Electron + React app that runs a "hive" of CLI coding agents (Claude Code, Codex, …) on the
user's machine: a god/orchestrator agent plus workers that talk through inbox/outbox JSON files.

## Layout

- `src/main/` — Electron main process. `index.ts` (~5k lines: IPC, scheduler, heartbeat,
  teardown), `hive.ts` (~3k lines: agent registry, message routing, spawn args, injected
  system prompt, hive git history), `hooks.ts` (Claude Code hook socket → additionalContext),
  `pty.ts`, `config.ts` (HarnessConfig, default missions, model defaults), `pricing.ts`.
- `src/preload/` — the `window.cth` IPC bridge. `src/renderer/src/` — React UI (`App.tsx`,
  `components/`, `scene/office/` pixi.js floor, `ide/` Monaco, `store/`).
- `src/shared/` — code used by both sides (`modelCatalog.json`, `agentProvider.ts`,
  `contextWindow.ts`, …).
- `docs/` — website, Hiring Desk (`docs/hires/`), media. `test/` — `node:test` suites.

Search with Grep and read line ranges; avoid reading `index.ts` / `hive.ts` whole.
`CHANGELOG.md` is large: read only the top (`## [Unreleased]`) when adding an entry.

## Commands

```
npm run typecheck        # node + web tsconfigs; keep it clean
npm run test:focused     # node --test test/*.test.cjs
node --test test/<file>.test.cjs
npm run build            # electron-vite build (~1 min)
```

Tests load TypeScript through `test/load-ts.cjs` (`loadTs('src/main/hive.ts')`); tests that
touch `hooks.ts` stub `electron` in `require.cache` first (see `test/hive-roster-injection.test.cjs`).

## Gotchas

- **Windows CRLF baseline:** 13 tests fail on a clean tree on this machine. Compare failures
  against a `git stash` baseline before calling anything a regression.
- Line endings are mixed (`core.autocrlf=true`, and some files are stored CRLF in the index).
  Preserve each file's existing endings: `sed -i` on Git Bash rewrites to LF and produces
  whole-file diffs, so edit with the Edit tool or a script that keeps `\r\n`.
- `docs/hires/scripts/build-data.py` must be run from `docs/hires/` and rewrites generated
  files (`manifests-data.js`, `models.js`, variant manifests); check `git status` after it.
- The injected system prompt in `hive.ts` (`injectedPrompt`) must stay volatile-free for
  prompt caching; per-turn context goes through hooks (`hooks.ts`), never the prefix.
- Model ids live in `src/shared/modelCatalog.json`, `config.ts` (`MODEL_*`), `pricing.ts`,
  `contextWindow.ts` and the `ctxSize` shim inside `hive.ts`; change them together.

## Git

- `main` mirrors upstream (chaitanyagiri/munder-difflin) — never commit there. Work goes on
  `mis-cambios`, pushed to `origin` (the fork).
- Commit subjects are `area: summary` (e.g. `hive: …`, `perf: …`, `models: …`); user-facing
  changes get a `CHANGELOG.md` entry under `## [Unreleased]`.
