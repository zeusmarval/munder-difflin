'use strict';

/**
 * The condenser's summary parse must survive the shapes the model really
 * returns. Census of 1412 hidden condense sessions (2026-10-10): 877 parsed
 * strictly, 499 were not JSON at all (session/weekly quota notices, API and
 * login errors), and the rest were JSON a strict parse rejected. These cases
 * reproduce those shapes; replaying all 1412 through the lenient parse
 * recovered 19 more with zero regressions (the 877 give byte-identical text).
 *
 * What stays unparseable must still say WHAT came back: `SummaryParseError`
 * carries the head of the raw response for the condense-abort event.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { parseSummary, SummaryParseError } = loadTs('src/main/reflect.ts');

test('strict JSON parses as before', () => {
  assert.deepEqual(parseSummary('{"condensed": "summary", "hoist": ["- fact"]}'),
    { condensed: 'summary', hoist: ['- fact'] });
});

test('raw newlines inside the condensed string are recovered (dominant shape since 2026-10-09)', () => {
  const out = parseSummary('{"condensed": "SECTION A: one.\n\nSECTION B: two.\tdone", "hoist": []}');
  assert.deepEqual(out, { condensed: 'SECTION A: one.\n\nSECTION B: two.\tdone', hoist: [] });
});

test('junk after the object is ignored: a closing tag, a stray brace', () => {
  assert.equal(parseSummary('{"condensed": "a", "hoist": ["x"]}</code>').condensed, 'a');
  assert.equal(parseSummary('```json\n{"condensed": "b", "hoist": []}}\n```').condensed, 'b');
});

test('prose around a fenced object is skipped', () => {
  const text = 'Here is the compacted memory:\n\n```json\n{"condensed": "c", "hoist": []}\n```\nDone.';
  assert.deepEqual(parseSummary(text), { condensed: 'c', hoist: [] });
});

test('braces and escaped quotes inside strings do not end the object early', () => {
  const out = parseSummary('Result: {"condensed": "a {b} \\"q\\" }", "hoist": ["{x}"]} trailing');
  assert.deepEqual(out, { condensed: 'a {b} "q" }', hoist: ['{x}'] });
});

test('the CLI envelope still unwraps to the model text', () => {
  const env = JSON.stringify({ result: 'Sure.\n{"condensed": "d", "hoist": []}' });
  assert.equal(parseSummary(env).condensed, 'd');
});

test('unrecoverable shapes stay null: quota notice, truncation, mis-escaped quote, wrong shape', () => {
  assert.equal(parseSummary("You've hit your session limit · resets 3:30pm"), null);
  assert.equal(parseSummary('{"condensed": "cut off mid-sen'), null);
  assert.equal(parseSummary('{"condensed": "tag `json:"-\\"` here", "hoist": []}'), null);
  assert.equal(parseSummary('{"summary": "no condensed key"}'), null);
  assert.equal(parseSummary('{"condensed": "   ", "hoist": []}'), null);
});

test('SummaryParseError keeps the old message and the first 300 chars of the response', () => {
  const raw = "You've hit your weekly limit · resets 4pm " + 'x'.repeat(400);
  const e = new SummaryParseError(raw);
  assert.equal(String(e), 'Error: condense: response contained no parseable JSON');
  assert.equal(e.responsePrefix, raw.slice(0, 300));
  assert.equal(new SummaryParseError('short').responsePrefix, 'short');
});
