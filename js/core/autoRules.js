// Auto-fills the BUY/SELL rule checklist (transactions.view.js) from
// historical K-line data as of the trade date — only when the user left the
// fields blank. Reuses the same objective criteria tradeLevels.js already
// computes for "today"; here they're evaluated against bars trimmed to the
// trade date instead, so a past entry gets the conditions that actually held
// on that day, not today's recalculation.

import { computeMA, computeATR, computeDMI } from './indicators.js';
import { computeTradeLevels, ENTRY_ADX_MIN, ENTRY_VOL_RATIO } from './tradeLevels.js';

// MA60 + ADX(14) need real runway before the trade date; 150 calendar days
// comfortably covers 60+ trading days even across long holiday clusters.
const LOOKBACK_DAYS = 150;
const MIN_BARS = 60;

function startDateFor(dateTime) {
  const d = String(dateTime).slice(0, 10);
  const start = new Date(`${d}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - LOOKBACK_DAYS);
  return start.toISOString().slice(0, 10);
}

function trimToDate(bars, dateTime) {
  const d = String(dateTime).slice(0, 10);
  let end = bars.length;
  while (end > 0 && bars[end - 1].date > d) end--;
  return bars.slice(0, end);
}

/**
 * `fetchBars(stockId, startDate)` is injected (rather than imported from
 * marketdata.js directly) so this stays testable without a network call.
 * Returns null when there isn't enough history to judge the rules, or when
 * computeTradeLevels itself can't (same MIN_BARS floor it uses internally).
 */
async function computeAutoRules(fetchBars, stockId, dateTime, type) {
  const raw = await fetchBars(stockId, startDateFor(dateTime));
  const bars = trimToDate(raw || [], dateTime);
  if (bars.length < MIN_BARS) return null;

  const ma5 = computeMA(bars, 5);
  const ma10 = computeMA(bars, 10);
  const ma20 = computeMA(bars, 20);
  const ma60 = computeMA(bars, 60);
  const atr = computeATR(bars, 14);
  const dmi = computeDMI(bars, 14);
  const levels = computeTradeLevels(bars, { ma5, ma10, ma20, ma60, atr, adx: dmi.adx });
  if (!levels) return null;

  if (type === 'SELL') {
    return {
      fields: { ruleExitFlag: levels.exit?.signal ? 'yes' : 'no' },
      note: levels.exit?.basis || '',
    };
  }

  return {
    fields: {
      ruleTrend: levels.trend === 'up' ? 'yes' : 'no',
      ruleBreakout: levels.isBreakout ? 'yes' : 'no',
      ruleAdx: levels.adx != null && levels.adx >= ENTRY_ADX_MIN ? 'yes' : 'no',
      ruleVolume: levels.volumeRatio != null && levels.volumeRatio >= ENTRY_VOL_RATIO ? 'yes' : 'no',
    },
    note: levels.entrySkip.length > 0
      ? `未符合：${levels.entrySkip.join('、')}`
      : '符合多頭排列＋20日新高＋ADX＋量能四條件',
  };
}

export { computeAutoRules };
