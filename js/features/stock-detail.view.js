import { recompute } from './transactions.js';
import { StockNotesRepository } from '../data/storage.js';
import { FinMindProvider, CsvProvider, MarketDataError } from '../data/marketdata.js';
import { computeMA, computeRSI, detectMACross } from '../core/indicators.js';
import { renderKLineChart } from '../core/chart.js';
import { attachLossReviews, summarizeLossPatterns } from './review.js';
import { groupByStrategy } from '../core/statistics.js';
import { formatMoney, formatDate, pnlClass } from '../utils/format.js';

const RSI_OVERBOUGHT = 70;
const RSI_OVERSOLD = 30;

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
      <div style="font-size:19px; font-weight:700;">${stockName} <span class="text-faint" style="font-weight:500; font-size:13px;">${stockId}</span></div>
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
  let bars;
  try {
    bars = await FinMindProvider.getKLine(stockId);
  } catch (err) {
    renderCsvFallback(chartArea, stockId, err);
    return;
  }

  if (bars.length === 0) {
    chartArea.innerHTML = '<div class="empty-state">查無此標的的K線資料</div>';
    return;
  }

  renderChartFromBars(chartArea, bars, stockTx);
}

function renderCsvFallback(chartArea, stockId, err) {
  const reason = err instanceof MarketDataError ? err.message : '未知錯誤';
  chartArea.innerHTML = `
    <div class="error-banner">K線資料來源目前無法取得（${reason}），可以手動貼上CSV資料</div>
    <div class="form-field">
      <label>貼上CSV（欄位：date,open,high,low,close,volume）</label>
      <textarea id="csv-input" placeholder="date,open,high,low,close,volume&#10;2026-01-01,100,105,99,103,1000000"></textarea>
    </div>
    <button class="btn btn-primary" id="csv-submit">解析並顯示</button>
  `;
  chartArea.querySelector('#csv-submit').addEventListener('click', () => {
    const csvText = chartArea.querySelector('#csv-input').value;
    try {
      const bars = CsvProvider.parse(csvText);
      renderChartFromBars(chartArea, bars, []);
    } catch (parseErr) {
      const banner = document.createElement('div');
      banner.className = 'error-banner';
      banner.textContent = parseErr.message;
      chartArea.prepend(banner);
    }
  });
}

function renderChartFromBars(chartArea, bars, stockTx) {
  const ma5 = computeMA(bars, 5);
  const ma10 = computeMA(bars, 10);
  const ma20 = computeMA(bars, 20);
  const ma60 = computeMA(bars, 60);
  const rsi = computeRSI(bars, 14);

  const lastIndex = bars.length - 1;
  const cross = detectMACross(ma5, ma20, lastIndex);
  const lastRSI = rsi[lastIndex];

  const markers = stockTx
    .map((tx) => {
      const idx = bars.findIndex((b) => b.date === tx.dateTime.slice(0, 10));
      if (idx === -1) return null;
      return {
        // Color alone (紅=買, 綠=賣) already tells buy from sell, so the
        // label only needs the price — keeps it short enough to not
        // collide with the candle or a nearby marker.
        index: idx,
        label: `${tx.price}`,
        color: tx.type === 'BUY' ? 'var(--red)' : 'var(--green)',
      };
    })
    .filter(Boolean);

  const signalLines = [];
  if (cross === 'golden') signalLines.push('MA5 / MA20 出現黃金交叉，短均線轉強');
  if (cross === 'death') signalLines.push('MA5 / MA20 出現死亡交叉，短均線轉弱');
  if (lastRSI != null && lastRSI >= RSI_OVERBOUGHT) signalLines.push(`RSI 為 ${lastRSI.toFixed(0)}，接近超買區間，留意過熱風險`);
  if (lastRSI != null && lastRSI <= RSI_OVERSOLD) signalLines.push(`RSI 為 ${lastRSI.toFixed(0)}，接近超賣區間`);

  chartArea.innerHTML = `
    <div style="display:flex; gap:8px; margin-bottom:10px; flex-wrap:wrap;">
      <span class="tag tag-accent">MA5</span>
      <span class="tag" style="color:#fbbf24; background:rgba(251,191,36,0.1); border:1px solid rgba(251,191,36,0.25);">MA10</span>
      <span class="tag" style="color:#f0abfc; background:rgba(240,171,252,0.1); border:1px solid rgba(240,171,252,0.25);">MA20</span>
      <span class="tag" style="color:var(--text-faint); background:var(--panel-2); border:1px solid var(--border);">MA60</span>
    </div>
    ${renderKLineChart(bars, {
      maSeries: [
        { label: 'MA5', color: 'var(--accent)', values: ma5 },
        { label: 'MA10', color: '#fbbf24', values: ma10 },
        { label: 'MA20', color: '#f0abfc', values: ma20 },
        { label: 'MA60', color: 'var(--text-faint)', values: ma60 },
      ],
      markers,
    })}
    <div style="margin-top:14px; padding-top:14px; border-top:1px solid var(--border);">
      <div style="font-size:13px; font-weight:700; margin-bottom:8px;">訊號說明</div>
      ${signalLines.length > 0
        ? signalLines.map((l) => `<div style="font-size:12.5px; margin-bottom:4px;">・${l}</div>`).join('')
        : '<div class="text-faint" style="font-size:12.5px;">目前沒有明顯的均線交叉或RSI極端訊號</div>'}
    </div>
  `;
}

function renderNotes(container, stockId) {
  const area = container.querySelector('#notes-area');
  const notes = StockNotesRepository.getAll(stockId);

  area.innerHTML = `
    <div class="card">
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px;">
        <div style="font-size:15px; font-weight:700;">看法紀錄</div>
      </div>
      <div class="form-field">
        <textarea id="note-input" placeholder="記錄目前的想法…"></textarea>
      </div>
      <button class="btn btn-primary btn-block" id="note-submit">新增筆記</button>
      <div id="notes-list" style="margin-top:14px;"></div>
    </div>
  `;

  function renderList() {
    const list = area.querySelector('#notes-list');
    const current = StockNotesRepository.getAll(stockId);
    if (current.length === 0) {
      list.innerHTML = '<div class="empty-state">還沒有筆記</div>';
      return;
    }
    list.innerHTML = [...current]
      .reverse()
      .map(
        (n) => `
      <div style="border-left:2px solid var(--border); padding-left:12px; margin-bottom:12px;">
        <div class="text-faint" style="font-size:11px; margin-bottom:4px;">${formatDate(n.time)}</div>
        <div style="font-size:12.5px; line-height:1.6;">${escapeHtml(n.text)}</div>
      </div>
    `
      )
      .join('');
  }

  area.querySelector('#note-submit').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const input = area.querySelector('#note-input');
    const text = input.value.trim();
    if (!text) return;
    btn.disabled = true;
    await StockNotesRepository.add(stockId, text);
    btn.disabled = false;
    input.value = '';
    renderList();
  });

  renderList();
}

function renderStockLossReview(container, stockId, matches, transactions) {
  const area = container.querySelector('#review-area');
  const stockMatches = matches.filter((m) => m.stockId === stockId);
  const losses = stockMatches.filter((m) => m.realizedPnL < 0);

  if (losses.length === 0) {
    area.innerHTML = '';
    return;
  }

  const transactionsById = Object.fromEntries(transactions.map((t) => [t.id, t]));
  const strategySummariesByName = Object.fromEntries(
    groupByStrategy(matches, transactionsById).map((s) => [s.strategy, s])
  );
  const reviewed = attachLossReviews(losses, transactionsById, strategySummariesByName);

  area.innerHTML = `
    <div class="card">
      <div style="font-size:15px; font-weight:700; margin-bottom:10px;">虧損覆盤</div>
      ${reviewed
        .map(
          (m) => `
        <div style="padding:10px 0; border-bottom:1px solid var(--border);">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div class="text-faint" style="font-size:11.5px;">${formatDate(m.closedAt)} · ${m.buyPrice} → ${m.sellPrice}</div>
            <div class="${pnlClass(m.realizedPnL)}" style="font-size:13px; font-weight:600;">${formatMoney(m.realizedPnL)}</div>
          </div>
          <div style="margin-top:6px; display:flex; gap:6px; flex-wrap:wrap;">
            ${m.review.triggers.map((t) => `<span class="tag tag-yellow">${t}</span>`).join('')}
          </div>
          <div style="margin-top:6px; font-size:12px; color:var(--text-dim); line-height:1.6;">
            ${m.review.suggestions.map((s) => `・${s}`).join('<br>')}
          </div>
        </div>
      `
        )
        .join('')}
    </div>
  `;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

export { renderStockDetailView };
