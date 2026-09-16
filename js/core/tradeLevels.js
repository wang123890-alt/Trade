// Reference price levels derived from the K-line and indicators: nearest
// support/resistance, a pullback zone, a structure-based stop, and a target
// with the resulting risk:reward.
//
// These are ARITHMETIC ON THE CHART, not a recommendation. Every level
// carries a `basis` string naming exactly what produced it ("前波低點
// 09/03", "MA5", "前波低點 - 1.0×ATR") so a number is never shown without
// the reason it exists — the same principle the loss-review rules were
// rewritten around: a figure whose derivation is invisible gets read as a
// finding it hasn't earned.
//
// The support/resistance pivots themselves are DESCRIPTIVE, not predictive:
// backtested (5 years, TWII + 4 stocks, 1,605+ support touches) against a
// randomized control (same levels shifted ±2~8%) and found no statistically
// significant edge — real pivots held 67.0% of the time vs 68.5% for random
// levels shifted to nearby prices (z=-1.29). They stay in the UI as "this is
// where the last swing point was", which is true, not as "this will hold",
// which the data does not support.
//
// Entry, stop and target ARE backtested on their own terms — as a full
// round-trip simulation (enter, then track forward to whichever of target/
// stop is hit first, capped at 60 bars), not just "does the level hold".
// They were tuned SEPARATELY, one at a time, holding the other two at a
// reasonable baseline — see the constants below for what each backtest
// found and got wrong on the first pass. A recurring lesson across all
// three: R-multiple (reward/risk) is the wrong metric to optimize when
// target and stop are computed from independent references, because
// tightening the stop shrinks the risk denominator and mechanically
// inflates R for a win that produced the exact same dollar profit — actual
// % return per trade is what settled every one of these, after R-multiple
// alone pointed the wrong way at least twice.
//
// Pure functions over Bar[] + already-computed indicator series. No
// fetching, no DOM, no storage.

const PIVOT_LOOKBACK = 3; // bars either side that a swing point must beat

// How far below a support pivot the stop sits, in ATRs.
//
// First pass picked 1.5×ATR by minimizing "shakeout rate" alone (price
// closes below the stop, then recovers back above the support within 20
// bars — the level was never really broken): 0.5×ATR shook out 69.7% of
// the time, 1.5×ATR only 53.6%. That was a real improvement over the
// original 0.5, but it wasn't the full picture — shakeout rate says
// nothing about how much a trade actually made.
//
// Testing full round-trip trades (this entry rule, this stop, this target,
// tracked to whichever hits first) instead, sweeping k against REAL %
// return per trade rather than R-multiple (R-multiple is misleading here —
// see the module comment above) told a different story on the original
// 5-symbol sample: return peaked around 1.0×ATR (~1.23%/trade) and was
// already lower at 1.5×ATR (~0.97%/trade). 1.5 was a real improvement over
// the original 0.5 on the metric it was optimized for, just not the metric
// that actually matters.
//
// Re-run on a genuinely independent 43-symbol sample, the same sweep did
// NOT reproduce that peak — return kept climbing all the way to 5×ATR, even
// after correcting a censoring bug where a wide stop lets a trade time out
// (drop out of the "resolved" average) instead of ever being scored a loss.
// That climb is a real but different effect: 5 years of mostly-rising
// prices means a stop so wide it rarely triggers converges toward "no stop
// at all", which will always look best on raw average-return in a bull
// window — it isn't evidence the stop itself improved, and a stop that
// doesn't trigger has stopped doing the one thing a stop is for. Chasing
// that number further was deliberately not done. 1.0×ATR stays: it's the
// value the ORIGINAL, methodologically-clean 5-symbol test actually
// supports, and no honest re-test since has produced a better-grounded
// number to replace it with — only a reminder that "maximize average
// return" is the wrong objective for a risk-management parameter.
const STOP_ATR_BUFFER = 1.0;
const FALLBACK_STOP_ATR = 2; // stop distance when there's no support to lean on (not separately backtested — same low-confidence status as before)

// R-multiple for the target, applied from the entry regardless of whether a
// resistance pivot sits closer — capping the target AT the nearest
// resistance was tested against always using a plain 2R target (same entry,
// same stop) and lost on real % return per trade (1.23% capped-at-resistance
// vs 2.20% fixed-2R, consistent across 4 of 5 symbols): letting the trade run
// past a nearby resistance level captured meaningfully more upside than it
// gave back in the lower win rate (73.6% capped vs 47.4% fixed-2R) cost.
// Resistance is still shown as its own reference line — the finding is only
// that it shouldn't cap the target, not that the level itself is meaningless.
const TARGET_R_MULTIPLE = 2;
const MIN_BARS = 30;
const BREAKOUT_WINDOW = 20; // days a close must beat every high within to count as a breakout

/**
 * Swing points: a bar whose high beats every high within ±lookback (pivot
 * high), or whose low beats every low in the same window (pivot low). The
 * edges of the series can't be pivots — there aren't enough neighbours on
 * one side to confirm them — which is deliberate: an unconfirmed "low" that
 * is simply the last bar so far is not a support level.
 */
function findPivots(bars, lookback = PIVOT_LOOKBACK) {
  const highs = [];
  const lows = [];
  for (let i = lookback; i < bars.length - lookback; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (bars[j].high >= bars[i].high) isHigh = false;
      if (bars[j].low <= bars[i].low) isLow = false;
    }
    if (isHigh) highs.push({ index: i, price: bars[i].high, date: bars[i].date });
    if (isLow) lows.push({ index: i, price: bars[i].low, date: bars[i].date });
  }
  return { highs, lows };
}

function shortDate(date) {
  return date.slice(5).replace('-', '/');
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * @param {Array} bars - Bar[]
 * @param {Object} indicators - { ma5, ma20, ma60, atr, adx } series from indicators.js
 * @returns {Object|null} null when there isn't enough history to say anything
 */
function computeTradeLevels(bars, { ma5 = [], ma20 = [], ma60 = [], atr = [], adx = [] } = {}) {
  if (!Array.isArray(bars) || bars.length < MIN_BARS) return null;

  const last = bars.length - 1;
  const price = bars[last].close;
  const atrNow = atr[last] ?? null;
  const adxNow = adx[last] ?? null;
  const m5 = ma5[last] ?? null;
  const m20 = ma20[last] ?? null;
  const m60 = ma60[last] ?? null;

  const { highs, lows } = findPivots(bars);
  const support =
    lows
      .filter((p) => p.price < price)
      .sort((a, b) => b.price - a.price)[0] ?? null;
  const resistance =
    highs
      .filter((p) => p.price > price)
      .sort((a, b) => a.price - b.price)[0] ?? null;

  let trend = 'range';
  let trendLabel = '區間盤整';
  if (m5 != null && m20 != null && m60 != null) {
    if (m5 > m20 && m20 > m60) {
      trend = 'up';
      trendLabel = '多頭排列（MA5>MA20>MA60）';
    } else if (m5 < m20 && m20 < m60) {
      trend = 'down';
      trendLabel = '空頭排列（MA5<MA20<MA60）';
    }
  }

  // Entry: went through three rounds on real bars before landing here.
  // Round 1 (5 symbols): "wait for a pullback to MA20" lost badly to simply
  // buying the day trend turns up (71.5% win / 0.08R waiting vs 83.7% win /
  // 0.13R not waiting, z=-5.53) — a pullback to MA20 was more often an
  // early warning the trend was weakening than a discount entry. A
  // shallower MA5 pullback came out statistically tied with not waiting
  // (z=-0.97) and shipped as the compromise, since it preserved a "zone"
  // to show rather than a single "buy now" price.
  //
  // Round 2 (43 symbols, a genuinely independent sample — the 5 above were
  // what round 1 was tuned on): the MA5-pullback zone lost outright, not
  // just tied, to two other options — buying immediately (weighted 3.59%/
  // trade, 84% of symbols positive, largest sample: n=17,174) and buying a
  // 20-day-high breakout while trend is up (weighted 5.57%/trade, also 84%
  // of symbols positive, but only 13% of up-trend days qualify: n=2,241).
  // Breakout wins on the pooled number, but its per-SYMBOL median (2.56%)
  // is actually a hair below buying-immediately's (2.71%) — its edge in
  // the pooled figure comes from a handful of large breakout wins, not from
  // being better on the typical stock. Neither claim is settled enough to
  // pick one exclusively over the other.
  //
  // So for now: the zone is anchored at the current price (buying
  // immediately, the larger and more broadly-representative sample), and
  // the basis text separately flags a 20-day-high breakout when today
  // happens to be one — visible, not load-bearing, so real usage can show
  // whether the breakout flag is worth acting on before either rule is
  // dropped or promoted.
  //
  // In a range it's the lower edge. In a downtrend no entry zone is offered
  // at all — an explicit "nothing to suggest" beats inventing a level so
  // the row isn't blank; this branch wasn't separately backtested.
  const isBreakout =
    last >= BREAKOUT_WINDOW &&
    price > Math.max(...bars.slice(last - BREAKOUT_WINDOW, last).map((b) => b.high));

  let entry = null;
  if (trend === 'up') {
    entry = {
      low: round2(price * 0.995),
      high: round2(price * 1.005),
      basis: isBreakout ? '多頭排列，且今日創20日新高（訊號較強）' : '多頭排列，目前價位附近',
    };
  } else if (trend === 'range' && support) {
    const high = atrNow != null ? support.price + atrNow : support.price * 1.02;
    entry = {
      low: round2(support.price),
      high: round2(high),
      basis: `靠近區間下緣（前波低點 ${shortDate(support.date)}）`,
    };
  }

  const entryRef = entry ? (entry.low + entry.high) / 2 : price;

  let stop;
  if (support && support.price < entryRef) {
    const buffer = atrNow != null ? atrNow * STOP_ATR_BUFFER : support.price * 0.01;
    stop = {
      price: round2(support.price - buffer),
      basis: `前波低點 ${shortDate(support.date)} 之下${atrNow != null ? `（緩衝 ${STOP_ATR_BUFFER}×ATR）` : ''}`,
    };
  } else if (atrNow != null) {
    stop = {
      price: round2(entryRef - atrNow * FALLBACK_STOP_ATR),
      basis: `無明確前波低點，改用 ${FALLBACK_STOP_ATR}×ATR 距離`,
    };
  } else {
    stop = { price: null, basis: '資料不足，無法推算' };
  }

  const risk = stop.price != null ? entryRef - stop.price : null;

  let target = null;
  if (risk != null && risk > 0) {
    target = {
      price: round2(entryRef + risk * TARGET_R_MULTIPLE),
      basis: `固定 ${TARGET_R_MULTIPLE}R 目標，不受壓力價位封頂`,
    };
  }

  const riskReward =
    risk != null && risk > 0 && target?.price != null
      ? round2((target.price - entryRef) / risk)
      : null;

  return {
    price: round2(price),
    trend,
    trendLabel,
    adx: adxNow != null ? round2(adxNow) : null,
    atr: atrNow != null ? round2(atrNow) : null,
    support: support ? { price: round2(support.price), date: support.date } : null,
    resistance: resistance ? { price: round2(resistance.price), date: resistance.date } : null,
    isBreakout,
    entry,
    stop,
    target,
    riskReward,
  };
}

/** Flatten computeTradeLevels output into the chart's `levels` param —
 * { price, label, color } horizontal lines. Skips anything unresolved. */
function levelsForChart(levels) {
  if (!levels) return [];
  const out = [];
  if (levels.resistance) out.push({ price: levels.resistance.price, label: '壓力', color: 'var(--text-faint)' });
  if (levels.support) out.push({ price: levels.support.price, label: '支撐', color: 'var(--text-faint)' });
  if (levels.target?.price != null) out.push({ price: levels.target.price, label: '目標', color: 'var(--red)' });
  if (levels.stop?.price != null) out.push({ price: levels.stop.price, label: '停損', color: 'var(--green)' });
  return out;
}

export { computeTradeLevels, findPivots, levelsForChart };
