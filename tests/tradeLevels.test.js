// Plain Node test runner. Run with: node tests/tradeLevels.test.js
import assert from 'node:assert/strict';
import { computeTradeLevels, findPivots, levelsForChart } from '../js/core/tradeLevels.js';
import { computeMA, computeATR } from '../js/core/indicators.js';

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

function bar(date, open, high, low, close, volume = 1000) {
  return { date, open, high, low, close, volume };
}

/** n bars walking from `start` by `step` per bar, with a fixed intrabar range. */
function ramp(n, start, step, { spread = 2, from = 1 } = {}) {
  const bars = [];
  for (let i = 0; i < n; i++) {
    const close = start + step * i;
    const day = String(from + i).padStart(2, '0');
    const date = `2026-01-${day}`;
    bars.push(bar(date, close - step, close + spread, close - spread, close));
  }
  return bars;
}

test('findPivots picks the bar that beats every neighbour within the lookback window', () => {
  const bars = [
    bar('2026-01-01', 10, 11, 9, 10),
    bar('2026-01-02', 10, 12, 9, 11),
    bar('2026-01-03', 11, 13, 10, 12),
    bar('2026-01-04', 12, 20, 11, 19), // clear pivot high
    bar('2026-01-05', 19, 14, 11, 12),
    bar('2026-01-06', 12, 13, 10, 11),
    bar('2026-01-07', 11, 12, 9, 10),
  ];
  const { highs } = findPivots(bars, 3);
  assert.equal(highs.length, 1);
  assert.equal(highs[0].price, 20);
  assert.equal(highs[0].date, '2026-01-04');
});

test('findPivots never reports the first or last bars — an unconfirmed extreme is not a level', () => {
  const bars = [
    bar('2026-01-01', 10, 99, 1, 50), // extreme, but no left neighbours
    ...ramp(8, 20, 1, { from: 2 }),
    bar('2026-01-10', 10, 99, 1, 50), // extreme, but no right neighbours
  ];
  const { highs, lows } = findPivots(bars, 3);
  assert.ok(!highs.some((p) => p.index === 0 || p.index === bars.length - 1));
  assert.ok(!lows.some((p) => p.index === 0 || p.index === bars.length - 1));
});

test('computeTradeLevels returns null when there is not enough history', () => {
  assert.equal(computeTradeLevels(ramp(10, 100, 1)), null);
  assert.equal(computeTradeLevels([]), null);
});

test('computeTradeLevels reads a steady advance as 多頭排列 and offers an MA20 pullback zone', () => {
  const bars = ramp(80, 100, 1);
  const levels = computeTradeLevels(bars, {
    ma5: computeMA(bars, 5),
    ma20: computeMA(bars, 20),
    ma60: computeMA(bars, 60),
    atr: computeATR(bars, 14),
  });
  assert.equal(levels.trend, 'up');
  assert.ok(levels.entry, 'an uptrend should offer an entry zone');
  assert.ok(levels.entry.basis.includes('MA20'));
  // The pullback zone sits below the latest price, not at it — the point is
  // to name a level to wait for rather than to chase the current print.
  assert.ok(levels.entry.high < levels.price);
});

test('an uptrend whose price has ALREADY dropped through MA20 still gets a zone, not a blank', () => {
  // Regression for a real case (2330, 2026-09-15): MA5>MA20>MA60 still
  // stacked bullish while the close had slipped under MA20. Checking only
  // "price above MA20, wait for the pullback" dropped the very situation
  // the rule is for into the no-basis fallback.
  // A SHARP two-bar drop, not a slow grind: price has to get under MA20
  // while MA5 (still carrying four higher closes) stays above it. A longer
  // decline drags MA5 down too and flips the ordering out of 多頭排列.
  const rising = ramp(70, 100, 1.5);
  const pullback = [188, 186].map((close, i) =>
    bar(`2026-03-${String(i + 1).padStart(2, '0')}`, close + 4, close + 5, close - 2, close)
  );
  const bars = [...rising, ...pullback];
  const ma5 = computeMA(bars, 5);
  const ma20 = computeMA(bars, 20);
  const ma60 = computeMA(bars, 60);
  const last = bars.length - 1;
  assert.ok(ma5[last] > ma20[last] && ma20[last] > ma60[last], 'setup: MAs still stacked bullish');
  assert.ok(bars[last].close < ma20[last], 'setup: price already under MA20');

  const levels = computeTradeLevels(bars, { ma5, ma20, ma60, atr: computeATR(bars, 14) });
  assert.equal(levels.trend, 'up');
  assert.ok(levels.entry, 'a pullback in progress must still produce a zone');
  assert.ok(levels.entry.basis.includes('已回測'));
  assert.ok(levels.entry.low <= levels.entry.high);
});

test('computeTradeLevels offers no entry zone in a downtrend rather than inventing one', () => {
  const bars = ramp(80, 200, -1);
  const levels = computeTradeLevels(bars, {
    ma5: computeMA(bars, 5),
    ma20: computeMA(bars, 20),
    ma60: computeMA(bars, 60),
    atr: computeATR(bars, 14),
  });
  assert.equal(levels.trend, 'down');
  assert.equal(levels.entry, null);
});

test('the stop sits below the support it leans on, and names it', () => {
  const bars = [...ramp(40, 100, 1), ...ramp(10, 141, -1, { from: 1 }).map((b, i) => ({ ...b, date: `2026-02-${String(i + 1).padStart(2, '0')}` }))];
  const levels = computeTradeLevels(bars, {
    ma5: computeMA(bars, 5),
    ma20: computeMA(bars, 20),
    ma60: computeMA(bars, 60),
    atr: computeATR(bars, 14),
  });
  if (levels.support) {
    assert.ok(levels.stop.price < levels.support.price, 'stop must be below the support, not on it');
    assert.ok(levels.stop.basis.includes('前波低點'));
  }
});

test('risk:reward is computed from the same entry the stop and target are measured against', () => {
  const bars = ramp(80, 100, 1);
  const levels = computeTradeLevels(bars, {
    ma5: computeMA(bars, 5),
    ma20: computeMA(bars, 20),
    ma60: computeMA(bars, 60),
    atr: computeATR(bars, 14),
  });
  if (levels.riskReward != null) {
    const entryRef = (levels.entry.low + levels.entry.high) / 2;
    const expected = (levels.target.price - entryRef) / (entryRef - levels.stop.price);
    assert.ok(Math.abs(levels.riskReward - expected) < 0.02);
  }
});

test('every produced level carries a basis string explaining where it came from', () => {
  const bars = ramp(80, 100, 1);
  const levels = computeTradeLevels(bars, {
    ma5: computeMA(bars, 5),
    ma20: computeMA(bars, 20),
    ma60: computeMA(bars, 60),
    atr: computeATR(bars, 14),
  });
  assert.ok(levels.stop.basis.length > 0);
  if (levels.entry) assert.ok(levels.entry.basis.length > 0);
  if (levels.target) assert.ok(levels.target.basis.length > 0);
});

test('levelsForChart flattens to chart lines and skips anything unresolved', () => {
  assert.deepEqual(levelsForChart(null), []);
  const lines = levelsForChart({
    support: { price: 90, date: '2026-01-05' },
    resistance: null,
    stop: { price: 88, basis: 'x' },
    target: { price: null, basis: 'y' },
  });
  assert.equal(lines.length, 2);
  assert.ok(lines.every((l) => Number.isFinite(l.price) && l.label));
});

test('computeATR is null before enough history, then tracks the average true range', () => {
  const flat = ramp(40, 100, 0, { spread: 2 });
  const atr = computeATR(flat, 14);
  assert.equal(atr[13], null);
  assert.ok(atr[14] != null);
  // Each bar spans close-2 .. close+2 on an unchanged close, so TR is 4.
  assert.ok(Math.abs(atr[39] - 4) < 0.001, `expected ATR ~4, got ${atr[39]}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
