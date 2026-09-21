// Watchlist row snapshot from Bar[]. Pure — no fetch, no DOM.
import { computeMA } from './indicators.js';

const FLAT_BARS = 8;
const FLAT_PCT = 0.008;

function pct(from, to) {
  if (from == null || to == null || from === 0) return null;
  return ((to - from) / from) * 100;
}

function vsMa(price, ma) {
  if (price == null || ma == null) return null;
  if (price > ma) return '上';
  if (price < ma) return '下';
  return '平';
}

function computeWatchSnapshot(bars) {
  if (!bars || bars.length < 2) return null;
  const last = bars[bars.length - 1];
  const prev = bars[bars.length - 2];
  const fiveAgo = bars.length >= 6 ? bars[bars.length - 6] : null;
  const ma5 = computeMA(bars, 5);
  const ma10 = computeMA(bars, 10);
  const ma20 = computeMA(bars, 20);
  const i = bars.length - 1;
  const close = last.close;

  const window = Math.min(FLAT_BARS, bars.length);
  const maSlice = ma20.slice(bars.length - window).filter((v) => v != null);
  let hasFlat = false;
  if (maSlice.length >= 5 && close) {
    const span = Math.max(...maSlice) - Math.min(...maSlice);
    hasFlat = span / close <= FLAT_PCT;
  }
  const rangeBars = hasFlat ? bars.slice(-window) : [last];
  const rangeHigh = Math.max(...rangeBars.map((b) => b.high));
  const rangeLow = Math.min(...rangeBars.map((b) => b.low));

  return {
    price: close,
    dayChange: close - prev.close,
    dayPct: pct(prev.close, close),
    fivePct: fiveAgo ? pct(fiveAgo.close, close) : null,
    ma5: vsMa(close, ma5[i]),
    ma10: vsMa(close, ma10[i]),
    ma20: vsMa(close, ma20[i]),
    hasFlat,
    rangeHigh,
    rangeLow,
    date: last.date,
  };
}

function sortWatchRows(rows, key) {
  const copy = [...rows];
  const num = (r) => {
    const s = r.snap;
    if (!s) return -Infinity;
    if (key === 'dayChange') return s.dayChange;
    if (key === 'dayPct') return s.dayPct;
    if (key === 'fivePct') return s.fivePct;
    return s.price;
  };
  copy.sort((a, b) => num(b) - num(a));
  return copy;
}

export { computeWatchSnapshot, sortWatchRows };
