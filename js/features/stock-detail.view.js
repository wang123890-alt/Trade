import { recompute } from './transactions.js';
import { StockNotesRepository } from '../data/storage.js';
import { CsvProvider, MarketDataError } from '../data/marketdata.js';
import { getInstitutionalHistory } from '../data/institutionalData.js';
import { loadKLineFast } from '../data/loadKLine.js';
import { computeMA, computeRSI, computeMACD, computeDMI, computeATR, detectMACross } from '../core/indicators.js';
import { renderKLineChart } from '../core/chart.js';
import { computeTradeLevels, levelsForChart } from '../core/tradeLevels.js';
import { getRiskSettings } from '../data/riskSettings.js';
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
    <div id="institutional-area"></div>
    <div id="notes-area"></div>
    <div id="review-area"></div>
  `;
  container.querySelector('#back-btn').addEventListener('click', () => window.history.back());
  loadAndRenderChart(container, stockId, stockTx);
  renderInstitutional(container, stockId);
  renderNotes(container, stockId);
  renderStockLossReview(container, stockId, matches, transactions);
}

function fmtNet(n) {
  if (n == null) return '<span class="text-faint">—</span>';
  const shares = Math.round(n / 1000);
  const cls = n > 0 ? 'text-red' : n < 0 ? 'text-green' : '';
  const sign = n > 0 ? '+' : '';
  return `<span class="${cls}">${sign}${shares.toLocaleString('zh-TW')}</span>`;
}

async function renderInstitutional(container, stockId) {
  const area = container.querySelector('#institutional-area');
  if (!area) return;
  const history = await getInstitutionalHistory(stockId);
  if (!area.isConnected || history.length === 0) { area.innerHTML = ''; return; }
  const rows = [...history].reverse();
  area.innerHTML = `
    <div class="card" style="margin-top:12px;">
      <div style="font-size:13px; font-weight:700; margin-bottom:8px;">三大法人買賣超（近${rows.length}個交易日 · 單位：張）</div>
      <table style="width:100%; font-size:12px; border-collapse:collapse;">
        <thead><tr class="text-faint" style="text-align:right;"><th style="text-align:left; font-weight:500; padding-bottom:4px;">日期</th><th style="font-weight:500; padding-bottom:4px;">外資</th><th style="font-weight:500; padding-bottom:4px;">投信</th><th style="font-weight:500; padding-bottom:4px;">自營商</th><th style="font-weight:500; padding-bottom:4px;">合計</th></tr></thead>
        <tbody>
          ${rows.map((r) => `<tr style="text-align:right;"><td style="text-align:left; padding:3px 0;">${escapeHtml(r.date.slice(5))}</td><td style="padding:3px 0;">${fmtNet(r.foreign_net)}</td><td style="padding:3px 0;">${fmtNet(r.trust_net)}</td><td style="padding:3px 0;">${fmtNet(r.dealer_net)}</td><td style="padding:3px 0; font-weight:600;">${fmtNet(r.inst_total_net)}</td></tr>`).join('')}
        </tbody>
      </table>
      <div class="text-faint" style="font-size:11px; margin-top:6px;">每日收盤後更新，非即時</div>
    </div>`;
}

async function loadAndRenderChart(container, stockId, stockTx) {
  const chartArea = container.querySelector('#chart-area');
  try {
    const hit = await loadKLineFast(stockId);
    if (!hit?.bars?.length) {
      chartArea.innerHTML = '<div class="empty-state">查無此標的的K線資料</div>';
      return;
    }
    const paint = (bars, source) => {
      if (!chartArea.isConnected) return;
      renderChartFromBars(chartArea, bars, stockTx, { source, fetchedAt: new Date().toISOString() });
    };
    paint(hit.bars, hit.refresh ? `${hit.source} · 更新中` : hit.source);
    if (hit.refresh) {
      const next = await hit.refresh;
      if (next?.bars?.length) paint(next.bars, next.source);
    }
  } catch (err) {
    renderCsvFallback(chartArea, stockId, err);
  }
}

function renderCsvFallback(chartArea, stockId, err) {
  const reason = err instanceof MarketDataError ? err.message : '未知錯誤';
  chartArea.innerHTML = `
    <div class="error-banner">K線資料來源目前無法取得（${reason}），可以手動貼上CSV資料</div>
    <div class="form-field"><label>貼上CSV（欄位：date,open,high,low,close,volume）</label><textarea id="csv-input" placeholder="date,open,high,low,close,volume"></textarea></div>
    <button class="btn btn-primary" id="csv-submit">解析並顯示</button>`;
  chartArea.querySelector('#csv-submit').addEventListener('click', () => {
    try {
      const bars = CsvProvider.parse(chartArea.querySelector('#csv-input').value);
      renderChartFromBars(chartArea, bars, [], { source: '手動貼上', fetchedAt: new Date().toISOString() });
    } catch (parseErr) {
      const banner = document.createElement('div');
      banner.className = 'error-banner';
      banner.textContent = parseErr.message;
      chartArea.prepend(banner);
    }
  });
}

function renderChartFromBars(chartArea, bars, stockTx, meta = {}) {
  const ma5 = computeMA(bars, 5);
  const ma10 = computeMA(bars, 10);
  const ma20 = computeMA(bars, 20);
  const ma60 = computeMA(bars, 60);
  const rsi = computeRSI(bars, 14);
  const macd = computeMACD(bars);
  const dmi = computeDMI(bars);
  const atr = computeATR(bars, 14);
  const tradeLevels = computeTradeLevels(bars, { ma5, ma10, ma20, ma60, atr, adx: dmi.adx, ...getRiskSettings() });
  const chartLevels = levelsForChart(tradeLevels);
  const lastIndex = bars.length - 1;
  const cross = detectMACross(ma5, ma20, lastIndex);
  const macdCross = detectMACross(macd.macdLine, macd.signalLine, lastIndex);
  const dmiCross = detectMACross(dmi.plusDI, dmi.minusDI, lastIndex);
  const lastRSI = rsi[lastIndex];
  const lastADX = dmi.adx[lastIndex];
  const markers = stockTx.map((tx) => {
    const idx = bars.findIndex((b) => b.date === tx.dateTime.slice(0, 10));
    if (idx === -1) return null;
    return { index: idx, label: `${tx.price}`, color: tx.type === 'BUY' ? 'var(--red)' : 'var(--green)' };
  }).filter(Boolean);
  const signalLines = [];
  if (cross === 'golden') signalLines.push('MA5 / MA20 出現黃金交叉，短均線轉強');
  if (cross === 'death') signalLines.push('MA5 / MA20 出現死亡交叉，短均線轉弱');
  if (lastRSI != null && lastRSI >= RSI_OVERBOUGHT) signalLines.push(`RSI 為 ${lastRSI.toFixed(0)}，接近超買區間`);
  if (lastRSI != null && lastRSI <= RSI_OVERSOLD) signalLines.push(`RSI 為 ${lastRSI.toFixed(0)}，接近超賣區間`);
  if (macdCross === 'golden') signalLines.push('MACD 出現黃金交叉');
  if (macdCross === 'death') signalLines.push('MACD 出現死亡交叉');
  if (dmiCross === 'golden') signalLines.push('DMI：+DI上穿-DI');
  if (dmiCross === 'death') signalLines.push('DMI：+DI下穿-DI');
  if (lastADX != null && lastADX >= 25) signalLines.push(`ADX 為 ${lastADX.toFixed(0)}`);
  let selectedIndex = null;
  function buildChartSvg() {
    return renderKLineChart(bars, {
      maSeries: [
        { label: 'MA5', color: 'var(--accent)', values: ma5 },
        { label: 'MA10', color: '#fbbf24', values: ma10 },
        { label: 'MA20', color: '#f0abfc', values: ma20 },
        { label: 'MA60', color: 'var(--text-faint)', values: ma60 },
      ],
      markers, rsi, macd, dmi, selectedIndex, levels: chartLevels,
    });
  }
  chartArea.innerHTML = `
    <div style="display:flex; gap:8px; margin-bottom:8px; overflow-x:auto;">
      <span class="tag tag-accent">MA5 ${maArrow(ma5, lastIndex)}</span>
      <span class="tag" style="color:#fbbf24;">MA10 ${maArrow(ma10, lastIndex)}</span>
      <span class="tag" style="color:#f0abfc;">MA20 ${maArrow(ma20, lastIndex)}</span>
      <span class="tag">MA60 ${maArrow(ma60, lastIndex)}</span>
    </div>
    <div class="text-faint" style="font-size:11px; margin-bottom:8px;">${meta.source ? `${meta.source} · ` : ''}${formatDateTime(meta.fetchedAt)}更新</div>
    <div id="kline-svg-wrap">${buildChartSvg()}</div>
    ${renderTradeLevels(tradeLevels)}
    <div style="margin-top:14px; padding-top:14px; border-top:1px solid var(--border);">
      <div style="font-size:13px; font-weight:700; margin-bottom:8px;">訊號說明</div>
      ${signalLines.length ? signalLines.map((l) => `<div style="font-size:12.5px; margin-bottom:4px;">・${l}</div>`).join('') : '<div class="text-faint" style="font-size:12.5px;">目前沒有明顯交叉或RSI極端訊號</div>'}
    </div>
  `;
  const svgWrap = chartArea.querySelector('#kline-svg-wrap');
  svgWrap.addEventListener('click', (e) => {
    const hit = e.target.closest('[data-index]');
    if (!hit) return;
    const idx = Number(hit.getAttribute('data-index'));
    selectedIndex = selectedIndex === idx ? null : idx;
    svgWrap.innerHTML = buildChartSvg();
  });
}

function renderTradeLevels(levels) {
  if (!levels) return '<div class="text-faint" style="font-size:12.5px; margin-top:10px;">K線不足30根，無法推算價位</div>';
  const row = (label, value, basis, valueClass = '') => `
    <div style="display:flex; justify-content:space-between; gap:10px; padding:5px 0; border-bottom:1px solid var(--border);">
      <div style="font-size:12.5px;">${escapeHtml(label)}</div>
      <div style="text-align:right;"><div class="${valueClass}" style="font-size:13px; font-weight:700;">${escapeHtml(value)}</div>${basis ? `<div class="text-faint" style="font-size:10.5px;">${escapeHtml(basis)}</div>` : ''}</div>
    </div>`;
  return `<div style="margin-top:12px;">
    <div style="font-size:13px; font-weight:700; margin-bottom:6px;">參考價位</div>
    ${row('目前狀態', `${levels.price}`, levels.trendLabel || '')}
    ${levels.resistance ? row('最近壓力', `${levels.resistance.price}`, `前波高點 ${levels.resistance.date.slice(5)}`) : ''}
    ${levels.support ? row('最近支撐', `${levels.support.price}`, `前波低點 ${levels.support.date.slice(5)}`) : ''}
    ${row('停損', levels.stop?.price != null ? `${levels.stop.price}` : '—', levels.stop?.basis || '', 'text-green')}
    ${levels.structureTarget ? row('結構目標', `${levels.structureTarget.price}`, levels.structureTarget.basis, 'text-red') : ''}
    ${levels.target ? row('2R參考', `${levels.target.price}`, levels.target.basis, 'text-red') : ''}
    ${levels.size ? row('可買', levels.size.lots > 0 ? `${levels.size.lots}張` : `${levels.size.shares}股`, `波段本金 ${levels.size.capital} × ${levels.size.riskPct}%`) : ''}
  </div>`;
}

function renderNotes(container, stockId) {
  const area = container.querySelector('#notes-area');
  area.innerHTML = `<div class="card"><div style="font-size:15px; font-weight:700; margin-bottom:10px;">看法紀錄</div><div class="form-field"><textarea id="note-input" placeholder="記錄目前的想法…"></textarea></div><button class="btn btn-primary btn-block" id="note-submit">新增筆記</button><div id="notes-list" style="margin-top:14px;"></div></div>`;
  function renderList() {
    const list = area.querySelector('#notes-list');
    const current = StockNotesRepository.getAll(stockId);
    list.innerHTML = current.length === 0 ? '<div class="empty-state">還沒有筆記</div>' : [...current].reverse().map((n) => `<div style="border-left:2px solid var(--border); padding-left:12px; margin-bottom:12px;"><div class="text-faint" style="font-size:11px; margin-bottom:4px;">${formatDate(n.time)}</div><div style="font-size:12.5px; line-height:1.6;">${escapeHtml(n.text)}</div></div>`).join('');
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
  const losses = matches.filter((m) => m.stockId === stockId && m.realizedPnL < 0);
  if (losses.length === 0) { area.innerHTML = ''; return; }
  const transactionsById = Object.fromEntries(transactions.map((t) => [t.id, t]));
  const strategySummariesByName = Object.fromEntries(groupByStrategy(matches, transactionsById).map((s) => [s.strategy, s]));
  const reviewed = attachLossReviews(losses, transactionsById, strategySummariesByName, { buyFacts: computeBuyFacts(transactions, matches) });
  area.innerHTML = `<div class="card"><div style="font-size:15px; font-weight:700; margin-bottom:10px;">虧損覆盤</div>${reviewed.map((m) => `<div style="padding:10px 0; border-bottom:1px solid var(--border);"><div style="display:flex; justify-content:space-between;"><div class="text-faint" style="font-size:11.5px;">${formatDate(m.closedAt)} · ${m.buyPrice} → ${m.sellPrice}</div><div class="${pnlClass(m.realizedPnL)}" style="font-size:13px; font-weight:600;">${formatMoney(m.realizedPnL)}</div></div><div style="margin-top:6px;">${m.review.triggers.map((t) => `<span class="tag tag-yellow">${escapeHtml(t)}</span>`).join(' ')}</div></div>`).join('')}</div>`;
}

export { renderStockDetailView };
