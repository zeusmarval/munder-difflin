/**
 * One-line, human-readable rendering of a hive log.jsonl entry for god's
 * heartbeat digest. The raw JSON form spends tokens on quotes, braces, repeated
 * keys and epoch-ms timestamps; god only needs when, what, and who.
 *
 *   {"ts":1760000000000,"kind":"route","from":"jim-1","to":"god-1","act":"inform"}
 *   → "14:13 route jim-1→god-1 act=inform"
 */

const MAX_VALUE = 60;

export function formatLogEntry(entry: unknown): string {
  if (!entry || typeof entry !== 'object') return '';
  const e = entry as Record<string, unknown>;
  if (typeof e.raw === 'string') return clip(e.raw);
  const parts: string[] = [];
  if (typeof e.ts === 'number' && Number.isFinite(e.ts)) {
    const d = new Date(e.ts);
    parts.push(`${pad(d.getHours())}:${pad(d.getMinutes())}`);
  }
  if (typeof e.kind === 'string') parts.push(e.kind);
  if (typeof e.from === 'string' || typeof e.to === 'string') {
    parts.push(`${e.from ?? '?'}→${Array.isArray(e.to) ? e.to.join(',') : (e.to ?? '?')}`);
  }
  for (const [k, v] of Object.entries(e)) {
    if (k === 'ts' || k === 'kind' || k === 'from' || k === 'to') continue;
    if (typeof v === 'string' && v) parts.push(`${k}=${clip(v)}`);
    else if (typeof v === 'number' || typeof v === 'boolean') parts.push(`${k}=${v}`);
    else if (Array.isArray(v) && v.every((x) => typeof x === 'string')) parts.push(`${k}=${clip(v.join(','))}`);
    // nested objects are dropped: they are detail god can Read in log.jsonl
  }
  return parts.join(' ');
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function clip(s: string): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > MAX_VALUE ? `${one.slice(0, MAX_VALUE - 1)}…` : one;
}
