// Reference price levels derived from the K-line and indicators.
// 2026-09-17: gated entry + MA exit flag. See docs/2026-09-17-entry-exit-backtest.md
// 2026-09-18: range state wording = 橫盤（盤整） when MAs cross / tangle / unordered.

const PIVOT_LOOKBACK = 3;
const STOP_ATR_BUFFER = 1.0;
const FALLBACK_STOP_ATR = 2;
const TARGET_R_MULTIPLE = 2;
const MIN_BARS = 30;
const BREAKOUT_WINDOW = 20;
const ENTRY_ADX_MIN = 25;
const ENTRY_VOL_RATIO = 1.0;
const ENTRY_VOL_LOOKBACK = 20;

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
  return date.slice(5).replace("-", "/");
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function priorMaxHigh(bars, last, window) {
  let m = -Infinity;
  for (let k = last - window; k < last; k++) {
    if (bars[k].high > m) m = bars[k].high;
  }
  return m;
}

function avgVolume(bars, last, window) {
  let sum = 0;
  let n = 0;
  for (let k = last - window; k < last; k++) {
    const v = bars[k].volume;
    if (v != null && Number.isFinite(v)) {
      sum += v;
      n++;
    }
  }
  return n > 0 ? sum / n : null;
}

function computeTradeLevels(bars, { ma5 = [], ma10 = [], ma20 = [], ma60 = [], atr = [], adx = [] } = {}) {
  if (!Array.isArray(bars) || bars.length < MIN_BARS) return null;

  const last = bars.length - 1;
  const price = bars[last].close;
  const atrNow = atr[last] ?? null;
  const adxNow = adx[last] ?? null;
  const m5 = ma5[last] ?? null;
  const m10 = ma10[last] ?? null;
  const m20 = ma20[last] ?? null;
  const m60 = ma60[last] ?? null;
  const volNow = bars[last].volume;
  const volAvg = last >= ENTRY_VOL_LOOKBACK ? avgVolume(bars, last, ENTRY_VOL_LOOKBACK) : null;
  const volOk = volAvg != null && volAvg > 0 && volNow != null && volNow >= volAvg * ENTRY_VOL_RATIO;

  const { highs, lows } = findPivots(bars);
  const support =
    lows.filter((p) => p.price < price).sort((a, b) => b.price - a.price)[0] ?? null;
  const resistance =
    highs.filter((p) => p.price > price).sort((a, b) => a.price - b.price)[0] ?? null;

  let trend = "range";
  let trendLabel = "橫盤（盤整：均線交叉、糾結或無序）";
  if (m5 != null && m20 != null && m60 != null) {
    if (m5 > m20 && m20 > m60) {
      trend = "up";
      trendLabel = "多頭排列（MA5>MA20>MA60）";
    } else if (m5 < m20 && m20 < m60) {
      trend = "down";
      trendLabel = "空頭排列（MA5<MA20<MA60）";
    }
  }

  const isBreakout =
    last >= BREAKOUT_WINDOW && price > priorMaxHigh(bars, last, BREAKOUT_WINDOW);

  const skip = [];
  if (trend !== "up") skip.push(trend === "down" ? "空頭排列" : "非多頭排列（橫盤/盤整不進）");
  if (!isBreakout) skip.push("未創20日新高");
  if (adxNow == null || adxNow < ENTRY_ADX_MIN) skip.push(`ADX未達${ENTRY_ADX_MIN}`);
  if (!volOk) skip.push(`量能未達${ENTRY_VOL_RATIO}×二十日均量`);

  let entry = null;
  if (skip.length === 0) {
    entry = {
      low: round2(price * 0.995),
      high: round2(price * 1.005),
      basis: `多頭＋20日新高＋ADX≥${ENTRY_ADX_MIN}＋量≥${ENTRY_VOL_RATIO}×均量`,
    };
  }

  let exit = null;
  if (m5 != null && m10 != null) {
    if (price < m5 && m5 < m10) {
      exit = { signal: true, basis: "收盤跌破MA5，且MA5已落到MA10下方" };
    } else {
      exit = { signal: false, basis: "尚未同時滿足「收盤<MA5 且 MA5<MA10」" };
    }
  }

  const entryRef = entry ? (entry.low + entry.high) / 2 : price;

  let stop;
  if (support && support.price < entryRef) {
    const buffer = atrNow != null ? atrNow * STOP_ATR_BUFFER : support.price * 0.01;
    stop = {
      price: round2(support.price - buffer),
      basis: `前波低點 ${shortDate(support.date)} 之下${atrNow != null ? `（緩衝 ${STOP_ATR_BUFFER}×ATR）` : ""}`,
    };
  } else if (atrNow != null) {
    stop = {
      price: round2(entryRef - atrNow * FALLBACK_STOP_ATR),
      basis: `無明確前波低點，改用 ${FALLBACK_STOP_ATR}×ATR 距離`,
    };
  } else {
    stop = { price: null, basis: "資料不足，無法推算" };
  }

  const risk = stop.price != null ? entryRef - stop.price : null;

  let target = null;
  if (risk != null && risk > 0) {
    target = {
      price: round2(entryRef + risk * TARGET_R_MULTIPLE),
      basis: `固定 ${TARGET_R_MULTIPLE}R 參考目標（主出場看MA5/MA10）`,
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
    volumeRatio: volAvg != null && volAvg > 0 && volNow != null ? round2(volNow / volAvg) : null,
    support: support ? { price: round2(support.price), date: support.date } : null,
    resistance: resistance ? { price: round2(resistance.price), date: resistance.date } : null,
    isBreakout,
    entry,
    entrySkip: skip,
    exit,
    stop,
    target,
    riskReward,
  };
}

function levelsForChart(levels) {
  if (!levels) return [];
  const out = [];
  if (levels.resistance) out.push({ price: levels.resistance.price, label: "壓力", color: "var(--text-faint)" });
  if (levels.support) out.push({ price: levels.support.price, label: "支撐", color: "var(--text-faint)" });
  if (levels.target?.price != null) out.push({ price: levels.target.price, label: "目標", color: "var(--red)" });
  if (levels.stop?.price != null) out.push({ price: levels.stop.price, label: "停損", color: "var(--green)" });
  return out;
}

export { computeTradeLevels, findPivots, levelsForChart, ENTRY_ADX_MIN, ENTRY_VOL_RATIO };
