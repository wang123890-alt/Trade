// Plain Node test runner. Run with: node tests/institutional.test.js
import assert from 'node:assert/strict';
import { fromDriveRow, fromT86Row, mergeSnapshot, WINDOW_DAYS } from '../js/core/institutional.js';

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { failed++; console.log(`  FAIL - ${name}`); console.log(`    ${err.stack}`); }
}

test('fromDriveRow normalizes numeric strings and passes through null-ish fields', () => {
  const row = fromDriveRow({ date: '2026-10-01', foreign_net: '1,234', trust_net: '-500', dealer_net: '0', inst_total_net: '734' });
  assert.deepEqual(row, { date: '2026-10-01', foreign_net: 1234, trust_net: -500, dealer_net: 0, inst_total_net: 734 });
});

test('fromDriveRow treats missing fields as null, not NaN or 0', () => {
  const row = fromDriveRow({ date: '2026-10-01' });
  assert.equal(row.foreign_net, null);
  assert.equal(row.trust_net, null);
});

test('fromT86Row sums 外陸資買賣超 + 外資自營商買賣超 into foreign_net', () => {
  // cols indices: 4=外陸資買賣超, 7=外資自營商買賣超, 10=投信買賣超, 11=自營商買賣超, 18=三大法人合計
  const cols = ['2330', '台積電', '0', '0', '72,392,305', '0', '0', '1,100,290', '0', '0', '4,351,327', '5,470,493', '0', '0', '0', '0', '0', '0', '91,289,209'];
  const row = fromT86Row('2026-10-02', cols);
  assert.equal(row.date, '2026-10-02');
  assert.equal(row.foreign_net, 72392305 + 1100290);
  assert.equal(row.trust_net, 4351327);
  assert.equal(row.dealer_net, 5470493);
  assert.equal(row.inst_total_net, 91289209);
});

test('mergeSnapshot adds a new stock not previously in the store', () => {
  const store = {};
  const snapshot = { '2330': { date: '2026-10-02', foreign_net: 100, trust_net: 0, dealer_net: 0, inst_total_net: 100 } };
  const merged = mergeSnapshot(store, snapshot, '2026-10-02');
  assert.deepEqual(merged['2330'], [snapshot['2330']]);
});

test('mergeSnapshot is idempotent: re-running the same day replaces, not duplicates', () => {
  const store = { '2330': [{ date: '2026-10-02', foreign_net: 100, trust_net: 0, dealer_net: 0, inst_total_net: 100 }] };
  const snapshot = { '2330': { date: '2026-10-02', foreign_net: 999, trust_net: 0, dealer_net: 0, inst_total_net: 999 } };
  const merged = mergeSnapshot(store, snapshot, '2026-10-02');
  assert.equal(merged['2330'].length, 1);
  assert.equal(merged['2330'][0].foreign_net, 999);
});

test('mergeSnapshot keeps a stock with no new-day data as long as its history is within the window', () => {
  const store = { '2330': [{ date: '2026-10-01', foreign_net: 1, trust_net: 0, dealer_net: 0, inst_total_net: 1 }] };
  const merged = mergeSnapshot(store, {}, '2026-10-02');
  assert.equal(merged['2330'].length, 1);
});

test('mergeSnapshot drops rows older than WINDOW_DAYS calendar days before asOfDate', () => {
  const oldDate = '2026-09-01'; // well outside a 10-day window from 2026-10-02
  const store = { '2330': [{ date: oldDate, foreign_net: 1, trust_net: 0, dealer_net: 0, inst_total_net: 1 }] };
  const merged = mergeSnapshot(store, {}, '2026-10-02');
  assert.equal(merged['2330'], undefined);
});

test('mergeSnapshot drops a stock entirely once it has no rows left in the window', () => {
  const store = { '2330': [{ date: '2026-09-01', foreign_net: 1, trust_net: 0, dealer_net: 0, inst_total_net: 1 }] };
  const merged = mergeSnapshot(store, {}, '2026-10-02');
  assert.equal('2330' in merged, false);
});

test('mergeSnapshot keeps results sorted oldest-to-newest', () => {
  const store = {
    '2330': [
      { date: '2026-09-28', foreign_net: 1, trust_net: 0, dealer_net: 0, inst_total_net: 1 },
      { date: '2026-09-30', foreign_net: 2, trust_net: 0, dealer_net: 0, inst_total_net: 2 },
    ],
  };
  const snapshot = { '2330': { date: '2026-09-29', foreign_net: 3, trust_net: 0, dealer_net: 0, inst_total_net: 3 } };
  const merged = mergeSnapshot(store, snapshot, '2026-09-30');
  assert.deepEqual(merged['2330'].map((r) => r.date), ['2026-09-28', '2026-09-29', '2026-09-30']);
});

test('WINDOW_DAYS is a sane positive number', () => {
  assert.ok(WINDOW_DAYS > 0 && WINDOW_DAYS < 60);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
