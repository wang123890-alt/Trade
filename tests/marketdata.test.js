// Plain Node test runner. Run with: node tests/marketdata.test.js
// Only the CSV fallback path is tested here — it's pure and needs no
// network. FinMindProvider's live API call was verified manually against
// the real endpoint; it is deliberately not in this suite so `node
// tests/*.test.js` never depends on network availability (same reasoning
// Choose's own test suite documents).
import assert from 'node:assert/strict';
import { CsvProvider, MarketDataError } from '../js/data/marketdata.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok - ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL - ${name}`);
    console.log(`    ${err.stack}`);
  }
}

test('CsvProvider.parse reads a valid CSV into Bar[]', () => {
  const csv = 'date,open,high,low,close,volume\n2026-01-01,100,105,99,103,1000000';
  const bars = CsvProvider.parse(csv);
  assert.equal(bars.length, 1);
  assert.deepEqual(bars[0], {
    date: '2026-01-01', open: 100, high: 105, low: 99, close: 103, volume: 1000000,
  });
});

test('CsvProvider.parse rejects a CSV missing a required column', () => {
  const csv = 'date,open,high,low,close\n2026-01-01,100,105,99,103';
  assert.throws(() => CsvProvider.parse(csv), MarketDataError);
});

test('CsvProvider.parse rejects a CSV with only a header row', () => {
  const csv = 'date,open,high,low,close,volume';
  assert.throws(() => CsvProvider.parse(csv), MarketDataError);
});

test('CsvProvider.parse tolerates column order different from the canonical one', () => {
  const csv = 'volume,close,low,high,open,date\n1000000,103,99,105,100,2026-01-01';
  const bars = CsvProvider.parse(csv);
  assert.equal(bars[0].date, '2026-01-01');
  assert.equal(bars[0].close, 103);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
