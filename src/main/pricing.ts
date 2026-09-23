/**
 * Fallback-only model → price table (USD per million tokens).
 *
 * The LIVE telemetry path does NOT use this. Claude Code emits a pre-computed,
 * per-model `cost_usd` on every `api_request` log and a `claude_code.cost.usage`
 * metric (verified by the 7A.1 spike), so the collector (`telemetry.ts`) trusts
 * Claude's own figure. This table exists solely for the OFFLINE transcript
 * reconciler (`transcript.ts`), which runs when telemetry is off and must
 * estimate cost from raw token counts.
 *
 * It supersedes the old hard-coded Sonnet-for-everyone constants that lived in
 * `transcript.ts` (cost bug #1 — Opus undercosted ~5×, Haiku overcosted). Prices
 * are matched per model family AND generation: the Claude 5 family re-priced
 * every tier (Opus dropped to a third of its 4.1 rate, Sonnet 5 is cheaper than
 * Sonnet 4.6) and added Fable, which no substring match on the old three
 * families could see — a Fable agent used to fall through to the Sonnet row and
 * come out ~5× under-costed. This is the ONE place per-model pricing lives; both
 * the transcript backend and the collector's fallback import it.
 */

/** USD per million tokens for one model family. */
export interface ModelPrice {
  inputPerM: number;
  outputPerM: number;
  cacheReadPerM: number;
  cacheWritePerM: number;
}

/** A list-price row: cache reads bill at 10 % of input, cache writes (5-minute
 *  TTL) at 125 %. Approximate, fallback-only — the live path uses Claude's own
 *  per-model cost, so small drift here is harmless. */
function listPrice(inputPerM: number, outputPerM: number): ModelPrice {
  return {
    inputPerM,
    outputPerM,
    cacheReadPerM: inputPerM * 0.1,
    cacheWritePerM: inputPerM * 1.25
  };
}

// Anthropic list prices, USD per million tokens, by family and generation.
/** Fable 5 / 5.1 and Mythos 5 / 5.1 — the tier above Opus. */
const FABLE: ModelPrice = listPrice(10, 50);
/** Opus 4.5 through Opus 5 all list at the same rate. */
const OPUS: ModelPrice = listPrice(5, 25);
/** Opus 4.1 and older — the legacy $15 / $75 tier. */
const OPUS_LEGACY: ModelPrice = listPrice(15, 75);
/** Sonnet 5. */
const SONNET_5: ModelPrice = listPrice(2, 10);
/** Sonnet 4.6 and older (4.5, 4, 3.7, …). */
const SONNET: ModelPrice = listPrice(3, 15);
/** Haiku 4.5. */
const HAIKU: ModelPrice = listPrice(1, 5);
/** Haiku 3.5 and older. */
const HAIKU_LEGACY: ModelPrice = listPrice(0.8, 4);

/** When the model id is unknown, assume Sonnet (the historical default). */
const DEFAULT_PRICE: ModelPrice = SONNET;

/**
 * Strip Claude Code's variant suffix so `claude-opus-4-8[1m]` (the form the
 * `token.usage` metric carries) and `claude-opus-4-8` (the base id the
 * `api_request` log carries) resolve to the same family. Case is preserved;
 * matching is done case-insensitively in `priceFor`.
 */
export function normalizeModel(model: string | undefined | null): string {
  return (model ?? '').trim().replace(/\[[^\]]*\]\s*$/, '');
}

/** Family + generation parsed out of any of the id shapes the harness sees:
 *  the API id (`claude-opus-4-8`, `claude-sonnet-5`, `claude-fable-5-1`), a
 *  dated snapshot (`claude-haiku-4-5-20251001`), a provider slug
 *  (`anthropic/claude-opus-5`, `claude-sonnet-4.5`), a display label
 *  (`Claude Opus 4.6 (Thinking)`) or the pre-4 order (`claude-3-5-sonnet`).
 *  `major` is 0 when the id names no generation (the 3.x-era order). */
function parseModel(model: string): { family: string; major: number; minor: number } | null {
  const m = normalizeModel(model).toLowerCase().replace(/\s+/g, '-');
  const hit = /(fable|mythos|opus|sonnet|haiku)(?:-(\d+)(?:[-.](\d+))?)?/.exec(m);
  if (!hit) return null;
  // A date stamp is not a version: it can follow the family directly in the
  // pre-4 order (`claude-3-opus-20240229`) or the major (`claude-opus-4-20250514`).
  const rawMajor = hit[2] ? Number(hit[2]) : 0;
  const major = rawMajor > 99 ? 0 : rawMajor;
  const rawMinor = hit[3] ? Number(hit[3]) : 0;
  const minor = major === 0 || rawMinor > 99 ? 0 : rawMinor;
  return { family: hit[1], major, minor };
}

/** Resolve a model id to its price row by family and generation, falling back
 *  to Sonnet. */
export function priceFor(model: string | undefined | null): ModelPrice {
  const parsed = parseModel(model ?? '');
  if (!parsed) return DEFAULT_PRICE;
  const { family, major, minor } = parsed;
  switch (family) {
    case 'fable':
    case 'mythos':
      return FABLE;
    case 'opus':
      // The price cut landed with Opus 4.5; 4.1 and older are the legacy tier.
      return major >= 5 || (major === 4 && minor >= 5) ? OPUS : OPUS_LEGACY;
    case 'sonnet':
      return major >= 5 ? SONNET_5 : SONNET;
    case 'haiku':
      return major >= 4 ? HAIKU : HAIKU_LEGACY;
    default:
      return DEFAULT_PRICE;
  }
}

/** Token split used by the cost estimator (matches `AgentUsage` token fields). */
export interface TokenSplit {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/**
 * Estimate USD cost for a token split using the model's fallback price row.
 * Used only by the transcript reconciler; the live path trusts Claude's cost.
 */
export function estimateCostUsd(model: string | undefined | null, tokens: TokenSplit): number {
  const p = priceFor(model);
  return (
    (tokens.inputTokens / 1_000_000) * p.inputPerM +
    (tokens.outputTokens / 1_000_000) * p.outputPerM +
    (tokens.cacheReadTokens / 1_000_000) * p.cacheReadPerM +
    (tokens.cacheWriteTokens / 1_000_000) * p.cacheWritePerM
  );
}
