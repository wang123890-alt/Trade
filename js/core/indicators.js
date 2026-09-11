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

export { computeMA, computeRSI, detectMACross };
