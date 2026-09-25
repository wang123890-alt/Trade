import { recompute } from './transactions.js';
import { StockNotesRepository } from '../data/storage.js';
import { CsvProvider, MarketDataError } from '../data/marketdata.js';
import { loadKLineFast } from '../data/loadKLine.js';
import { computeMA, computeRSI, computeMACD, computeDMI, computeATR, detectMACross } from '../core/indicators.js';
import { renderKLineChart } from '../core/chart.js';
import { computeTradeLevels, levelsForChart } from '../core/tradeLevels.js';
import { attachLossReviews, computeBuyFacts } from './review.js';
import { groupByStrategy } from '../core/statistics.js';
import { formatMoney, formatDate, formatDateTime, pnlClass, escapeHtml } from '../utils/format.js';

const RSI_OVERBOUGHT = 70;
const RSI_OVERSOLD = 30;

function maArrow(series, i) {
  const cur = series[i];
  const prev = i > 0 ? series[i - 1] : null;
  if (cur == null || prev == null) return '';
  if (cur > prev) return '<span class="text-red">↑</span>';
  if (cur < prev) return '<span class="text-green">↓</span>';
  return '<span class="text-faint">→</span>';
}

async function renderStockDetailView(container, stockId) {
  if (!stockId) {
    container.innerHTML = '<div class="empty-state">未指定標的</div>';
    return;
  }
  const { transactions, matches } = recompute();
  const stockTx = transactions.filter((t) => t.stockId === stockId);
  const lastTx = stockTx.length > 0 ? stockTx[stockTx.length - 1] : null;
  const stockName = lastTx ? lastTx.stockName : stockId;
  container.innerHTML = `
    <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
      <button class="icon-btn" id="back-btn">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
      </button>
      <div style="font-size:19px; font-weight:700;">${escapeHtml(stockName)} <span class="text-faint" style="font-weight:500; font-size:13px;">${escapeHtml(stockId)}</span></div>
    </div>
    ${lastTx ? `<div class="text-faint" style="font-size:12px; margin:0 0 12px 42px;">最後交易日 ${formatDate(lastTx.dateTime)} · 成交價 ${lastTx.price}</div>` : ''}
    <div id="chart-area" class="card"><div class="empty-state">載入K線資料中…</div></div>
    <div id="notes-area"></div>
    <div id="review-area"></div>
  `;
  container.querySelector('#back-btn').addEventListener('click', () => window.history.back());
  await loadAndRenderChart(container, stockId, stockTx);
  renderNotes(container, stockId);
  renderStockLossReview(container, stockId, matches, transactions);
}

async function loadAndRenderChart(container, stockId, stockTx) {
  const chartArea = container.querySelector('#chart-area');
  try {
    const { bars, source } = await loadKLineFast(stockId);
    if (!bars?.length) {
      chartArea.innerHTML = '<div class="empty-state">查無此標的的K線資料</div>';
      return;
    }
    renderChartFromBars(chartArea, bars, stockTx, { source, fetchedAt: new Date().toISOString() });
  } catch (err) {
    renderCsvFallback(chartArea, stockId, err);
  }
}
