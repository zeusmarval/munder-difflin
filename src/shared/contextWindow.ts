/**
 * Default context-window size for a model id, in tokens.
 *
 * Only a STARTING guess: the status-line shim and the `/context` parser report
 * the session's true denominator after the first response and override it. But
 * the gauge is drawn from the moment an agent spawns, and a wrong default makes
 * a fresh Opus 5 agent look "almost full" at 200K when it has 1M to go.
 *
 * Rules, in order:
 *  - Claude Code's `[1m]` alias (or a `-1m` suffix) always means 1M.
 *  - The Claude 5 family — Fable / Mythos (any version), Opus 5, Sonnet 5,
 *    Haiku 5 — is 1M by default; no alias exists or is needed.
 *  - Everything else is 200K: the 4.x generation without the alias, Haiku 4.5,
 *    and non-Claude ids the harness knows nothing about.
 *
 * The proxy-bridge shim in src/main/hive.ts (`ctxSize`) is a standalone script
 * that cannot import this file; it carries the same rules by hand. Keep them
 * in step.
 */
export const CONTEXT_200K = 200_000;
export const CONTEXT_1M = 1_000_000;

export function defaultContextWindow(model: string | null | undefined): number {
  const m = (model ?? '').toLowerCase().replace(/\s+/g, '-');
  if (m.includes('[1m]') || /-1m(?![a-z0-9])/.test(m)) return CONTEXT_1M;
  if (m.includes('fable') || m.includes('mythos')) return CONTEXT_1M;
  // A date stamp after the family (`claude-3-5-sonnet-20241022`) is not a version.
  const gen = /(opus|sonnet|haiku)-(\d{1,2})(?![0-9])/.exec(m);
  if (gen && Number(gen[2]) >= 5) return CONTEXT_1M;
  return CONTEXT_200K;
}
