// Reference price levels derived from the K-line and indicators: nearest
// support/resistance, a pullback zone, a structure-based stop, and a target
// with the resulting risk:reward.
//
// These are ARITHMETIC ON THE CHART, not a recommendation. Every level
// carries a `basis` string naming exactly what produced it ("前波低點
// 09/03", "MA20", "前波低點 - 0.5×ATR") so a number is never shown without
// the reason it exists — the same principle the loss-review rules were
// rewritten around: a figure whose derivation is invisible gets read as a
// finding it hasn't earned.
//
// Pure functions over Bar[] + already-computed indicator series. No
// fetching, no DOM, no storage.

const PIVOT_LOOKBACK = 3; // bars either side that a swing point must beat
const STOP_ATR_BUFFER = 0.5; // how far below structure the stop sits
const FALLBACK_STOP_ATR = 2; // stop distance when there's no support to lean on
const TARGET_R_MULTIPLE = 2; // R-multiple target when there's no resistance overhead
const MIN_BARS = 30;

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

  // Entry: in an uptrend the reference is a pullback toward MA20 rather than
  // chasing the current print; in a range it's the lower edge. In a
  // downtrend no entry zone is offered at all — an explicit "nothing to
  // suggest" beats inventing a level so the row isn't blank.
  //
  // The two uptrend branches matter: the MAs can still be stacked bullish
  // while price has ALREADY dropped through MA20 (measured on 2330,
  // 2026-09-15: MA5 2418 > MA20 2410 > MA60 2396, close 2385). Only
  // handling "price above MA20, wait for a pullback" sent exactly the case
  // the rule exists for — the pullback actually happening — into the
  // "no basis" fallback.
  let entry = null;
  if (trend === 'up' && m20 != null) {
    if (price > m20) {
      const low = support ? Math.max(support.price, m20 * 0.98) : m20 * 0.98;
      entry = {
        low: round2(Math.min(low, m20)),
        high: round2(m20),
        basis: '尚未回測，等待回到 MA20 附近',
      };
    } else {
      const low = support ? support.price : atrNow != null ? price - atrNow : price * 0.98;
      entry = {
        low: round2(Math.min(low, price)),
        high: round2(m20),
        basis: '已回測至 MA20 之下，區間為支撐至 MA20',
      };
    }
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
      basis: `前波低點 ${shortDate(support.date)} 之下${atrNow != null ? `（緩衝 0.5×ATR）` : ''}`,
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
  if (resistance) {
    target = { price: round2(resistance.price), basis: `前波高點 ${shortDate(resistance.date)}` };
  } else if (risk != null && risk > 0) {
    target = {
      price: round2(entryRef + risk * TARGET_R_MULTIPLE),
      basis: `無明確前波高點，改用 ${TARGET_R_MULTIPLE}R 目標`,
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
