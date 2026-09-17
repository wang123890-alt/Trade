// Plain Node test runner. Run with: node tests/tradeLevels.test.js
import assert from 'node:assert/strict';
import { computeTradeLevels, findPivots, levelsForChart } from '../js/core/tradeLevels.js';
import { computeMA, computeATR, computeDMI } from '../js/core/indicators.js';

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { failed++; console.log(`  FAIL - ${name}`); console.log(`    ${err.stack}`); }
}
function bar(date, open, high, low, close, volume = 1000) {
  return { date, open, high, low, close, volume };
}
function ramp(n, start, step, { spread = 2, from = 1 } = {}) {
  const bars = [];
  for (let i = 0; i < n; i++) {
    const close = start + step * i;
    bars.push(bar(`2026-01-${String(from + i).padStart(2, '0')}`, close - step, close + spread, close - spread, close));
  }
  return bars;
}
function withBreakout(bars) {
  const out = bars.map((b) => ({ ...b }));
  const last = out.length - 1;
  const priorHigh = Math.max(...out.slice(Math.max(0, last - 20), last).map((b) => b.high));
  const close = priorHigh + 5;
  out[last] = bar(out[last].date, close - 1, close + 1, close - 2, close, out[last].volume ?? 1000);
  return out;
}
function inds(bars, { adxFill } = {}) {
  const adx = adxFill != null ? new Array(bars.length).fill(adxFill) : computeDMI(bars, 14).adx;
  return {
    ma5: computeMA(bars, 5), ma10: computeMA(bars, 10), ma20: computeMA(bars, 20),
    ma60: computeMA(bars, 60), atr: computeATR(bars, 14), adx,
  };
}

test('findPivots picks the confirmed swing high', () => {
  const bars = [
    bar('2026-01-01', 10, 11, 9, 10), bar('2026-01-02', 10, 12, 9, 11),
    bar('2026-01-03', 11, 13, 10, 12), bar('2026-01-04', 12, 20, 11, 19),
    bar('2026-01-05', 19, 14, 11, 12), bar('2026-01-06', 12, 13, 10, 11),
    bar('2026-01-07', 11, 12, 9, 10),
  ];
  const { highs } = findPivots(bars, 3);
  assert.equal(highs.length, 1);
  assert.equal(highs[0].price, 20);
});

test('computeTradeLevels returns null without history', () => {
  assert.equal(computeTradeLevels(ramp(10, 100, 1)), null);
});

test('uptrend without breakout has no entry zone', () => {
  const bars = ramp(80, 100, 1);
  const lv = computeTradeLevels(bars, inds(bars));
  assert.equal(lv.trend, 'up');
  assert.equal(lv.isBreakout, false);
  assert.equal(lv.entry, null);
});

test('qualified breakout with ADX and volume offers entry', () => {
  const bars = withBreakout(ramp(80, 100, 1));
  const lv = computeTradeLevels(bars, inds(bars, { adxFill: 40 }));
  assert.ok(lv.entry);
  assert.ok(lv.entry.basis.includes('ADX'));
});

test('ADX below 25 or thin volume refuses entry', () => {
  const base = withBreakout(ramp(80, 100, 1));
  const weakAdx = computeTradeLevels(base, inds(base, { adxFill: 12 }));
  assert.equal(weakAdx.entry, null);
  const thin = base.map((b, i) => (i === base.length - 1 ? { ...b, volume: 100 } : b));
  const weakVol = computeTradeLevels(thin, inds(thin, { adxFill: 40 }));
  assert.equal(weakVol.entry, null);
});

test('downtrend offers no entry', () => {
  const bars = ramp(80, 200, -1);
  const lv = computeTradeLevels(bars, inds(bars));
  assert.equal(lv.trend, 'down');
  assert.equal(lv.entry, null);
});

test('stop sits below support and names it', () => {
  const bars = [...ramp(40, 100, 1), ...ramp(10, 141, -1, { from: 1 }).map((b, i) => ({ ...b, date: `2026-02-${String(i + 1).padStart(2, '0')}` }))];
  const lv = computeTradeLevels(bars, inds(bars));
  if (lv.support) {
    assert.ok(lv.stop.price < lv.support.price);
    assert.ok(lv.stop.basis.includes('前波低點'));
  }
});

test('target is entry + 2R when entry exists', () => {
  const bars = withBreakout(ramp(80, 100, 1));
  const lv = computeTradeLevels(bars, inds(bars, { adxFill: 40 }));
  if (lv.entry && lv.target && lv.stop.price != null) {
    const entryRef = (lv.entry.low + lv.entry.high) / 2;
    const expected = Math.round((entryRef + (entryRef - lv.stop.price) * 2) * 100) / 100;
    assert.equal(lv.target.price, expected);
  }
});

test('exit flag when close < MA5 and MA5 < MA10', () => {
  const rise = ramp(70, 100, 1);
  const fall = [160, 150, 140, 128, 118].map((close, i) =>
    bar(`2026-03-${String(i + 1).padStart(2, '0')}`, close + 2, close + 3, close - 2, close)
  );
  const lv = computeTradeLevels([...rise, ...fall], inds([...rise, ...fall]));
  assert.equal(lv.exit.signal, true);
});

test('levelsForChart skips unresolved', () => {
  assert.deepEqual(levelsForChart(null), []);
  const lines = levelsForChart({ support: { price: 90 }, resistance: null, stop: { price: 88, basis: 'x' }, target: { price: null } });
  assert.equal(lines.length, 2);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
