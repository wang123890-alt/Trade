// Technical indicators computed from Bar[] (marketdata.js's shape:
// { date, open, high, low, close, volume }). Pure functions — no fetching,
// no DOM.

/** Simple moving average of `close`, period `n`. Returns an array the same
 * length as bars, with null for indices before there's enough history. */
function computeMA(bars, n) {
  const result = new Array(bars.length).fill(null);
  let windowSum = 0;
  for (let i = 0; i < bars.length; i++) {
    windowSum += bars[i].close;
    if (i >= n) windowSum -= bars[i - n].close;
    if (i >= n - 1) result[i] = windowSum / n;
  }
  return result;
}

/** Wilder's RSI, period `n` (default 14). Same null-padding convention as MA. */
function computeRSI(bars, n = 14) {
  const result = new Array(bars.length).fill(null);
  if (bars.length < n + 1) return result;

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= n; i++) {
    const change = bars[i].close - bars[i - 1].close;
    if (change > 0) avgGain += change;
    else avgLoss += -change;
  }
  avgGain /= n;
  avgLoss /= n;
  result[n] = rsiFromAverages(avgGain, avgLoss);

  for (let i = n + 1; i < bars.length; i++) {
    const change = bars[i].close - bars[i - 1].close;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (n - 1) + gain) / n;
    avgLoss = (avgLoss * (n - 1) + loss) / n;
    result[i] = rsiFromAverages(avgGain, avgLoss);
  }

  return result;
}

function rsiFromAverages(avgGain, avgLoss) {
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** Exponential moving average over a value series that may start with
 * `null`s (e.g. the MACD line, which is null until the slow EMA has
 * enough history) — skips leading nulls, seeds with their simple average
 * once `n` non-null values have accumulated, then EMAs the rest. Reused
 * for both the close-price EMA (no nulls) and the MACD signal line EMA
 * (leading nulls) so there's one implementation instead of two. */
function emaSeries(values, n) {
  const result = new Array(values.length).fill(null);
  const k = 2 / (n + 1);
  let ema = null;
  let seedSum = 0;
  let seedCount = 0;

  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v == null) continue;
    if (ema == null) {
      seedSum += v;
      seedCount++;
      if (seedCount === n) {
        ema = seedSum / n;
        result[i] = ema;
      }
      continue;
    }
    ema = v * k + ema * (1 - k);
    result[i] = ema;
  }
  return result;
}

/** MACD(fast, slow, signal) on `close`. Returns { macdLine, signalLine,
 * histogram }, each null-padded to bars.length like computeMA/computeRSI. */
function computeMACD(bars, { fastPeriod = 12, slowPeriod = 26, signalPeriod = 9 } = {}) {
  const closes = bars.map((b) => b.close);
  const emaFast = emaSeries(closes, fastPeriod);
  const emaSlow = emaSeries(closes, slowPeriod);
  const macdLine = closes.map((_, i) =>
    emaFast[i] != null && emaSlow[i] != null ? emaFast[i] - emaSlow[i] : null
  );
  const signalLine = emaSeries(macdLine, signalPeriod);
  const histogram = macdLine.map((v, i) =>
    v != null && signalLine[i] != null ? v - signalLine[i] : null
  );
  return { macdLine, signalLine, histogram };
}

/** True Range per bar, shared by DMI and ATR. Index 0 is 0 rather than null
 * (there's no previous close to measure against); every caller starts its
 * loops at 1, so the placeholder is never summed. */
function trueRangeSeries(bars) {
  const tr = new Array(bars.length).fill(0);
  for (let i = 1; i < bars.length; i++) {
    tr[i] = Math.max(
      bars[i].high - bars[i].low,
      Math.abs(bars[i].high - bars[i - 1].close),
      Math.abs(bars[i].low - bars[i - 1].close)
    );
  }
  return tr;
}

/** Wilder's ATR (Average True Range), period `n`. Same null-padding as the
 * others. Used to size a stop by the stock's own recent volatility instead
 * of a flat percentage — a fixed 5% stop is loose on a quiet large cap and
 * tight enough on a volatile small cap to be hit by ordinary noise. */
function computeATR(bars, n = 14) {
  const result = new Array(bars.length).fill(null);
  if (bars.length < n + 1) return result;
  const tr = trueRangeSeries(bars);

  let atr = 0;
  for (let i = 1; i <= n; i++) atr += tr[i];
  atr /= n;
  result[n] = atr;

  for (let i = n + 1; i < bars.length; i++) {
    atr = (atr * (n - 1) + tr[i]) / n;
    result[i] = atr;
  }
  return result;
}

/** Wilder's DMI: +DI/-DI (period `n`, default 14) and ADX (the Wilder-
 * smoothed average of DX, itself starting `n` periods after +DI/-DI do).
 * Returns { plusDI, minusDI, adx }, each null-padded to bars.length. */
function computeDMI(bars, n = 14) {
  const len = bars.length;
  const plusDI = new Array(len).fill(null);
  const minusDI = new Array(len).fill(null);
  const adx = new Array(len).fill(null);
  if (len < n + 1) return { plusDI, minusDI, adx };

  const trueRanges = trueRangeSeries(bars);
  const plusDMs = new Array(len).fill(0);
  const minusDMs = new Array(len).fill(0);
  for (let i = 1; i < len; i++) {
    const highDiff = bars[i].high - bars[i - 1].high;
    const lowDiff = bars[i - 1].low - bars[i].low;
    plusDMs[i] = highDiff > lowDiff && highDiff > 0 ? highDiff : 0;
    minusDMs[i] = lowDiff > highDiff && lowDiff > 0 ? lowDiff : 0;
  }

  let smoothTR = 0;
  let smoothPlusDM = 0;
  let smoothMinusDM = 0;
  for (let i = 1; i <= n; i++) {
    smoothTR += trueRanges[i];
    smoothPlusDM += plusDMs[i];
    smoothMinusDM += minusDMs[i];
  }

  const dxValues = new Array(len).fill(null);
  function setDI(i) {
    const pDI = smoothTR > 0 ? (smoothPlusDM / smoothTR) * 100 : 0;
    const mDI = smoothTR > 0 ? (smoothMinusDM / smoothTR) * 100 : 0;
    plusDI[i] = pDI;
    minusDI[i] = mDI;
    const diSum = pDI + mDI;
    dxValues[i] = diSum > 0 ? (Math.abs(pDI - mDI) / diSum) * 100 : 0;
  }
  setDI(n);

  for (let i = n + 1; i < len; i++) {
    smoothTR = smoothTR - smoothTR / n + trueRanges[i];
    smoothPlusDM = smoothPlusDM - smoothPlusDM / n + plusDMs[i];
    smoothMinusDM = smoothMinusDM - smoothMinusDM / n + minusDMs[i];
    setDI(i);
  }

  let dxSum = 0;
  let dxCount = 0;
  let adxRunning = null;
  for (let i = n; i < len; i++) {
    if (dxValues[i] == null) continue;
    if (adxRunning == null) {
      dxSum += dxValues[i];
      dxCount++;
      if (dxCount === n) {
        adxRunning = dxSum / n;
        adx[i] = adxRunning;
      }
      continue;
    }
    adxRunning = (adxRunning * (n - 1) + dxValues[i]) / n;
    adx[i] = adxRunning;
  }

  return { plusDI, minusDI, adx };
}

/** Detect a MA cross between two already-computed MA series at index i
 * (compares i-1 -> i). Returns 'golden' | 'death' | null. */
function detectMACross(shortMA, longMA, i) {
  if (i < 1) return null;
  const prevShort = shortMA[i - 1];
  const prevLong = longMA[i - 1];
  const curShort = shortMA[i];
  const curLong = longMA[i];
  if ([prevShort, prevLong, curShort, curLong].some((v) => v == null)) return null;

  if (prevShort <= prevLong && curShort > curLong) return 'golden';
  if (prevShort >= prevLong && curShort < curLong) return 'death';
  return null;
}

export { computeMA, computeRSI, computeMACD, computeDMI, computeATR, detectMACross };
