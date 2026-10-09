'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { formatLogEntry } = loadTs('src/main/logDigest.ts');

test('a log entry renders as one short line: time, kind, route, scalars', () => {
  const ts = new Date(2026, 9, 9, 14, 3).getTime();
  assert.equal(
    formatLogEntry({ ts, kind: 'route', from: 'jim-1', to: 'god-1', act: 'inform', hops: 0 }),
    '14:03 route jim-1→god-1 act=inform hops=0'
  );
});

test('nested objects are dropped and long values clipped', () => {
  const line = formatLogEntry({ kind: 'role', agentId: 'jim-1', role: 'x'.repeat(200), meta: { a: 1 } });
  assert.ok(!line.includes('meta'), line);
  assert.ok(line.length < 100, line);
  assert.match(line, /^role agentId=jim-1 role=x+…$/);
});

test('unparsable lines and junk degrade safely', () => {
  assert.equal(formatLogEntry({ raw: 'not\njson' }), 'not json');
  assert.equal(formatLogEntry(null), '');
  assert.equal(formatLogEntry('x'), '');
});
