import assert from 'node:assert/strict';
import { computeWatchSnapshot, sortWatchRows } from '../js/core/watchSnapshot.js';

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

function barsFromCloses(closes) {
  return closes.map((c, i) => ({
    date: `2026-01-${String(i + 1).padStart(2, '0')}`,
    open: c,
    high: c + 1,
    low: c - 1,
    close: c,
    volume: 1000,
  }));
}

test('day and 5-day pct from latest closes', () => {
  const bars = barsFromCloses([100, 101, 102, 103, 104, 110]);
  const s = computeWatchSnapshot(bars);
  assert.equal(s.price, 110);
  assert.equal(s.dayChange, 6);
  assert.ok(Math.abs(s.dayPct - (6 / 104) * 100) < 1e-9);
  assert.ok(Math.abs(s.fivePct - 10) < 1e-9);
});

test('close above MA is 上', () => {
  const bars = barsFromCloses(Array.from({ length: 30 }, () => 100).concat([120]));
  const s = computeWatchSnapshot(bars);
  assert.equal(s.ma5, '上');
  assert.equal(s.ma20, '上');
});

test('flat MA20 uses window high/low and hasFlat', () => {
  const bars = barsFromCloses(Array.from({ length: 30 }, () => 100));
  const s = computeWatchSnapshot(bars);
  assert.equal(s.hasFlat, true);
  assert.equal(s.rangeHigh, 101);
  assert.equal(s.rangeLow, 99);
});

test('trending MA20 uses only latest bar high/low', () => {
  const bars = barsFromCloses(Array.from({ length: 30 }, (_, i) => 100 + i));
  const s = computeWatchSnapshot(bars);
  assert.equal(s.hasFlat, false);
  assert.equal(s.rangeHigh, bars.at(-1).high);
  assert.equal(s.rangeLow, bars.at(-1).low);
});

test('sortWatchRows by dayPct descending', () => {
  const rows = [
    { snap: { dayPct: 1, dayChange: 1, fivePct: 0, price: 1 } },
    { snap: { dayPct: 5, dayChange: 2, fivePct: 0, price: 1 } },
    { snap: null },
  ];
  const ordered = sortWatchRows(rows, 'dayPct');
  assert.equal(ordered[0].snap.dayPct, 5);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
