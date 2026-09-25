import { recompute, editTransaction } from './transactions.js';
import { loadKLineFast } from '../data/loadKLine.js';
import { computeMA } from '../core/indicators.js';
import { renderKLineChart } from '../core/chart.js';
import { formatMoney, formatDate, pnlClass, escapeHtml } from '../utils/format.js';
import { navigate } from '../router.js';

async function loadBars(stockId) {
  try {
    const { bars } = await loadKLineFast(stockId);
    return bars || [];
  } catch {
    return [];
  }
}
