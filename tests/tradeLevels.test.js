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

test('computeTradeLevels reads a steady advance as 多頭排列 and anchors the entry zone at the current price', () => {
  // Round 1 (5 symbols): waiting for a pullback to MA20 lost badly to simply
  // buying the day trend turned up (71.5% win / 0.08R vs 83.7% win / 0.13R,
  // z=-5.53). A shallower MA5 pullback tested statistically tied with not
  // waiting and shipped as a compromise.
  // Round 2 (43 symbols, independent of round 1's tuning set): the MA5
  // pullback lost outright to both "buy immediately" (largest sample,
  // 84% of symbols positive) and "buy a 20-day-high breakout" (highest
  // pooled return, also 84% of symbols positive, but its edge concentrates
  // in a handful of big wins rather than being better on the typical
  // symbol). Neither fully replaces the other, so the zone now anchors at
  // the current price (the larger, more broadly-representative option) and
  // a breakout day is flagged in the basis text rather than gated on —
  // both signals visible, neither forced, pending more real-world usage.
  const bars = ramp(80, 100, 1);
  const levels = computeTradeLevels(bars, {
    ma5: computeMA(bars, 5), ma20: computeMA(bars, 20), ma60: computeMA(bars, 60), atr: computeATR(bars, 14),
  });
  assert.equal(levels.trend, 'up');
  assert.ok(levels.entry, 'an uptrend should offer an entry zone');
  assert.ok(Math.abs(levels.entry.low - levels.price * 0.995) < 0.01);
  assert.ok(Math.abs(levels.entry.high - levels.price * 1.005) < 0.01);
});

test('a fresh 20-day high while trend is up is flagged in the entry basis, without changing the zone itself', () => {
  // A steady 1-point-a-day ramp with the default ±2 spread does NOT
  // continuously make new highs (today's close has to clear a run of prior
  // highs that are themselves 2 points above their own close) — so it's a
  // valid "no breakout yet" baseline. A single outsized jump on top of it
  // clears the prior 20-day high while staying inside an uptrend.
  const base = ramp(60, 100, 1);
  const lvBase = computeTradeLevels(base, {
    ma5: computeMA(base, 5), ma20: computeMA(base, 20), ma60: computeMA(base, 60), atr: computeATR(base, 14),
  });
  assert.equal(lvBase.trend, 'up');
  assert.equal(lvBase.isBreakout, false);
  assert.ok(!lvBase.entry.basis.includes('訊號較強'));

  const jump = bar('2026-03-01', 160, 175, 159, 174);
  const barsBreakout = [...base, jump];
  const lvBreakout = computeTradeLevels(barsBreakout, {
    ma5: computeMA(barsBreakout, 5), ma20: computeMA(barsBreakout, 20), ma60: computeMA(barsBreakout, 60), atr: computeATR(barsBreakout, 14),
  });
  assert.equal(lvBreakout.trend, 'up');
  assert.equal(lvBreakout.isBreakout, true);
  assert.ok(lvBreakout.entry.basis.includes('訊號較強'));
  // The flag changes the basis text only, not the zone's position.
  assert.ok(Math.abs(lvBreakout.entry.low - lvBreakout.price * 0.995) < 0.01);
});

test('an uptrend still gets an entry zone whether price is above or below MA5 — no branch falls through to blank', () => {
  // Regression for a real case (2330, 2026-09-15) that broke the OLD
  // MA20-branching version of this logic: MA5>MA20>MA60 stayed stacked
  // bullish while close had already slipped under MA20, and the old code
  // only handled "price above MA20, wait for pullback" — the pullback
  // actually happening fell into a no-basis blank. The MA5-band version
  // replacing it has no such branch to fall through: it's unconditional
  // once trend is 'up', so this now holds by construction, but the case is
  // still worth pinning so a future rewrite doesn't reintroduce the gap.
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

test('the stop buffer is 1.0x ATR below support, and the basis text names the actual multiplier used', () => {
  // Two rounds of backtesting landed here. Round 1 picked 1.5x by
  // minimizing "shakeout rate" alone (0.5x: 69.7% shaken out, 1.5x: 53.6%).
  // Round 2 measured what actually matters — real % return on a full
  // round-trip simulation — and found return peaks around 1.0x (~1.23%/
  // trade) and is already lower at 1.5x (~0.97%/trade): a tighter stop
  // means more frequent but smaller losses, and on this data that trade-off
  // paid off past the point round 1 stopped looking. This test pins the
  // value so a future change to the constant doesn't silently drift the
  // basis text out of sync with what the app actually computed — that
  // exact drift is why the basis string used to say a hardcoded "0.5×ATR"
  // instead of reading the constant, before round 1.
  const bars = [...ramp(40, 100, 1), ...ramp(10, 141, -1, { from: 1 }).map((b, i) => ({ ...b, date: `2026-02-${String(i + 1).padStart(2, '0')}` }))];
  const atr = computeATR(bars, 14);
  const levels = computeTradeLevels(bars, {
    ma5: computeMA(bars, 5), ma20: computeMA(bars, 20), ma60: computeMA(bars, 60), atr,
  });
  if (levels.support) {
    const expectedStop = Math.round((levels.support.price - atr[bars.length - 1] * 1.0) * 100) / 100;
    assert.equal(levels.stop.price, expectedStop);
    assert.ok(levels.stop.basis.includes('1×ATR') || levels.stop.basis.includes('1.0×ATR'), `basis should name the actual multiplier, got: ${levels.stop.basis}`);
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

test('the target is always entry + 2R and is not capped at a nearer resistance', () => {
  // Backtested (5y real bars, same entry/stop, only target changed):
  // capping the target at the nearest resistance pivot averaged 1.23%
  // return/trade at 73.6% win rate; letting it run to a fixed 2R instead
  // averaged 2.20%/trade at a lower 47.4% win rate — cutting winners short
  // at the first resistance overhead gave back more than the extra win
  // rate was worth, consistent across 4 of 5 symbols tested.
  const bars = ramp(80, 100, 1);
  const levels = computeTradeLevels(bars, {
    ma5: computeMA(bars, 5), ma20: computeMA(bars, 20), ma60: computeMA(bars, 60), atr: computeATR(bars, 14),
  });
  if (levels.target && levels.stop.price != null && levels.entry) {
    const entryRef = (levels.entry.low + levels.entry.high) / 2;
    const risk = entryRef - levels.stop.price;
    const expected = Math.round((entryRef + risk * 2) * 100) / 100;
    assert.equal(levels.target.price, expected);
    assert.ok(levels.target.basis.includes('不受壓力價位封頂'));
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
