import { recompute, editTransaction } from './transactions.js';
import { TwseDailyKLineProvider } from '../data/twseDailyKLine.js';
import { FinMindProvider, YahooFinanceProvider } from '../data/marketdata.js';
import { computeMA } from '../core/indicators.js';
import { renderKLineChart } from '../core/chart.js';
import { formatMoney, formatDate, pnlClass, escapeHtml } from '../utils/format.js';
import { navigate } from '../router.js';

const klineCache = {};

async function loadBars(stockId) {
  if (klineCache[stockId]) return klineCache[stockId];
  let bars = [];
  try {
    bars = await TwseDailyKLineProvider.getKLine(stockId);
  } catch {
    try {
      bars = await YahooFinanceProvider.getKLine(stockId);
    } catch {
      try {
        bars = await FinMindProvider.getKLine(stockId);
      } catch {
        bars = [];
      }
    }
  }
  klineCache[stockId] = bars;
  return bars;
}

function dateKey(iso) {
  return String(iso || '').slice(0, 10);
}

function sliceTradeWindow(bars, buyDate, sellDate) {
  if (!bars.length) return [];
  const buyI = bars.findIndex((b) => b.date >= buyDate);
  const sellIRaw = bars.findIndex((b) => b.date >= sellDate);
  const sellI = sellIRaw === -1 ? bars.length - 1 : sellIRaw;
  const start = Math.max(0, (buyI === -1 ? 0 : buyI) - 15);
  const end = Math.min(bars.length, sellI + 9);
  return bars.slice(start, end);
}

function yn(v) {
  if (v === 'yes') return '<span class="text-red">是</span>';
  if (v === 'no') return '<span class="text-green">否</span>';
  return '<span class="text-faint">未填</span>';
}

function buildSummary(buy, sell) {
  const missing = [];
  if (buy.ruleTrend === 'no') missing.push('多頭');
  if (buy.ruleBreakout === 'no') missing.push('前高');
  if (buy.ruleAdx === 'no') missing.push('ADX');
  if (buy.ruleVolume === 'no') missing.push('量');
  const parts = [];
  if (missing.length) parts.push(`進場缺 ${missing.join('、')}`);
  else if ([buy.ruleTrend, buy.ruleBreakout, buy.ruleAdx, buy.ruleVolume].every((v) => v === 'yes')) {
    parts.push('進場四條皆過');
  }
  if (sell.ruleExitFlag === 'no') parts.push('出場旗標未成立');
  if (sell.ruleExitFlag === 'yes') parts.push('出場旗標成立');
  const kind = sell.pnlKind || buy.pnlKind;
  const followed = sell.followedRules || buy.followedRules;
  if (kind === 'broke' || followed === 'no') parts.push('歸類沒守規則');
  else if (kind === 'rule' || followed === 'yes') parts.push('歸類規則內試錯');
  return parts.join('。') || '規則未填，無法自動總結';
}

function ruleBlock(buy, sell) {
  const followed = sell.followedRules || buy.followedRules;
  const kind = sell.pnlKind || buy.pnlKind;
  const kindTag = kind === 'broke'
    ? '<span class="tag tag-yellow">沒守規則</span>'
    : kind === 'rule'
      ? '<span class="tag tag-accent">規則內試錯</span>'
      : '<span class="tag">未歸類</span>';
  return `
    <div style="font-size:12.5px; line-height:1.8;">
      <div>當日進場規則：多頭 ${yn(buy.ruleTrend)} · 前高 ${yn(buy.ruleBreakout)} · ADX ${yn(buy.ruleAdx)} · 量 ${yn(buy.ruleVolume)}</div>
      <div>出場旗標：${yn(sell.ruleExitFlag)}</div>
      <div>有無遵守：${followed === 'yes' ? '<span class="text-red">有</span>' : followed === 'no' ? '<span class="text-green">沒有</span>' : '<span class="text-faint">未填</span>'} ${kindTag}</div>
    </div>`;
}

function renderMiniChart(windowBars, buyDate, sellDate) {
  if (!windowBars.length) {
    return '<div class="empty-state" style="padding:16px 0;">沒有這段 K 線</div>';
  }
  const ma5 = computeMA(windowBars, 5);
  const ma10 = computeMA(windowBars, 10);
  const ma20 = computeMA(windowBars, 20);
  const markers = [];
  const buyI = windowBars.findIndex((b) => b.date === buyDate);
  const sellI = windowBars.findIndex((b) => b.date === sellDate);
  if (buyI >= 0) markers.push({ index: buyI, label: '買', color: 'var(--red)' });
  if (sellI >= 0) markers.push({ index: sellI, label: '賣', color: 'var(--green)' });
  return renderKLineChart(windowBars, {
    height: 180,
    volumeHeight: 36,
    maSeries: [
      { label: 'MA5', color: 'var(--accent)', values: ma5 },
      { label: 'MA10', color: '#fbbf24', values: ma10 },
      { label: 'MA20', color: '#f0abfc', values: ma20 },
    ],
    markers,
  });
}

function renderReviewView(container) {
  const { transactions, matches } = recompute();
  const byId = Object.fromEntries(transactions.map((t) => [t.id, t]));
  const closed = [...matches].sort((a, b) => new Date(b.closedAt) - new Date(a.closedAt));

  container.innerHTML = `
    <div style="font-size:20px; font-weight:700; margin-bottom:12px;">覆盤</div>
    <div class="text-faint" style="font-size:12px; margin-bottom:14px;">每筆已平倉：K 圖（紅漲綠跌）、原因、當日規則、總結、自我解析</div>
    <div id="review-list"></div>
  `;

  const list = container.querySelector('#review-list');
  if (closed.length === 0) {
    list.innerHTML = '<div class="empty-state">還沒有已平倉的交易</div>';
    return;
  }

  list.innerHTML = closed.map((m) => {
    const buy = byId[m.buyTransactionId] || {};
    const sell = byId[m.sellTransactionId] || {};
    const name = buy.stockName || m.stockId;
    return `
      <div class="card" data-match-id="${escapeHtml(m.id)}" data-stock-id="${escapeHtml(m.stockId)}" style="margin-bottom:14px;">
        <div style="display:flex; justify-content:space-between; align-items:baseline; gap:8px;">
          <button class="stock-link" data-action="open-detail" data-stock-id="${escapeHtml(m.stockId)}" style="background:none;border:none;padding:0;cursor:pointer;text-align:left;color:inherit;font:inherit;font-size:15px;font-weight:700;">${escapeHtml(name)} <span class="text-faint" style="font-weight:500;font-size:12px;">${escapeHtml(m.stockId)}</span></button>
          <div class="${pnlClass(m.realizedPnL)}" style="font-size:14px; font-weight:700;">${formatMoney(m.realizedPnL)}</div>
        </div>
        <div class="text-faint" style="font-size:12px; margin:4px 0 10px;">
          <span class="text-red">買</span> ${formatDate(buy.dateTime)} @ ${buy.price} → <span class="text-green">賣</span> ${formatDate(sell.dateTime)} @ ${sell.price}
        </div>
        <div style="font-size:12px; font-weight:700; margin-bottom:6px;">買賣K圖</div>
        <div class="review-chart" data-stock-id="${escapeHtml(m.stockId)}" data-buy="${escapeHtml(dateKey(buy.dateTime))}" data-sell="${escapeHtml(dateKey(sell.dateTime))}">
          <div class="empty-state" style="padding:12px 0;">載入 K 線…</div>
        </div>
        <div style="margin-top:12px; font-size:12px; font-weight:700;">進出場原因</div>
        <div style="font-size:12.5px; margin:4px 0 10px; line-height:1.6;">
          <div><span class="text-red">進</span>：${escapeHtml(buy.reason || '未填')}</div>
          <div><span class="text-green">出</span>：${escapeHtml(sell.reason || '未填')}</div>
        </div>
        ${ruleBlock(buy, sell)}
        <div style="margin-top:12px; font-size:12px; font-weight:700;">總結</div>
        <div class="text-dim" style="font-size:12.5px; margin:4px 0 10px; line-height:1.6;">${escapeHtml(buildSummary(buy, sell))}</div>
        <div style="font-size:12px; font-weight:700;">自我解析</div>
        <div class="form-field" style="margin-top:4px;">
          <textarea data-self-review rows="2" placeholder="當時為何這樣做…">${escapeHtml(sell.selfReview || sell.note || '')}</textarea>
        </div>
        <button class="btn btn-primary" data-action="save-self" data-sell-id="${escapeHtml(sell.id || '')}" style="margin-top:6px;">儲存解析</button>
      </div>`;
  }).join('');

  list.querySelectorAll('[data-action="open-detail"]').forEach((btn) => {
    btn.addEventListener('click', () => navigate('detail', btn.getAttribute('data-stock-id')));
  });

  list.querySelectorAll('[data-action="save-self"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-sell-id');
      if (!id) return;
      const card = btn.closest('.card');
      const text = card.querySelector('[data-self-review]').value;
      btn.disabled = true;
      btn.textContent = '儲存中…';
      const { errors } = await editTransaction(id, { selfReview: text });
      btn.disabled = false;
      btn.textContent = errors.length ? errors[0] : '已儲存';
      setTimeout(() => { btn.textContent = '儲存解析'; }, 1400);
    });
  });

  const slots = [...list.querySelectorAll('.review-chart')];
  const uniqueIds = [...new Set(slots.map((el) => el.getAttribute('data-stock-id')))];
  uniqueIds.forEach(async (stockId) => {
    const bars = await loadBars(stockId);
    slots.filter((el) => el.getAttribute('data-stock-id') === stockId).forEach((el) => {
      if (!el.isConnected) return;
      const win = sliceTradeWindow(bars, el.getAttribute('data-buy'), el.getAttribute('data-sell'));
      el.innerHTML = renderMiniChart(win, el.getAttribute('data-buy'), el.getAttribute('data-sell'));
    });
  });
}

export { renderReviewView };
