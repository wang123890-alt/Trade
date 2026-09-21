import { getAllWatchItems, addWatchItem, removeWatchItem } from './watchlist.js';
import { navigate } from '../router.js';
import { formatDate, escapeHtml, pnlClass } from '../utils/format.js';
import { YahooFinanceProvider, FinMindProvider } from '../data/marketdata.js';
import { computeWatchSnapshot, sortWatchRows } from '../core/watchSnapshot.js';

function fmtPct(v) {
  if (v == null || Number.isNaN(v)) return '—';
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(2)}%`;
}

function fmtNum(v, digits = 2) {
  if (v == null || Number.isNaN(v)) return '—';
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(digits)}`;
}

function renderWatchlistView(container) {
  container.innerHTML = `
    <div style="font-size:20px; font-weight:700; margin-bottom:16px;">觀察名單</div>

    <div class="card" style="margin-bottom:16px;">
      <div style="font-size:14px; font-weight:700; margin-bottom:10px;">手動加入觀察</div>
      <div id="watch-form-errors"></div>
      <div class="form-row">
        <div class="form-field">
          <label>標的代號</label>
          <input type="text" id="watch-stock-id" placeholder="2330">
        </div>
        <div class="form-field">
          <label>標的名稱</label>
          <input type="text" id="watch-stock-name" placeholder="台積電">
        </div>
      </div>
      <button class="btn btn-primary btn-block" id="watch-add-btn">加入觀察</button>
    </div>

    <div id="watch-sort" style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:10px;"></div>
    <div id="watch-list"></div>
  `;

  container.querySelector('#watch-add-btn').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const stockId = container.querySelector('#watch-stock-id').value.trim();
    const stockName = container.querySelector('#watch-stock-name').value.trim();
    btn.disabled = true;
    const { errors } = await addWatchItem({ stockId, stockName, source: 'manual' });
    btn.disabled = false;
    const errorBox = container.querySelector('#watch-form-errors');
    if (errors.length > 0) {
      errorBox.innerHTML = `<div class="error-banner">${errors.join('；')}</div>`;
      return;
    }
    errorBox.innerHTML = '';
    container.querySelector('#watch-stock-id').value = '';
    container.querySelector('#watch-stock-name').value = '';
    renderList(container);
  });

  renderList(container);
}

const SORT_KEYS = [
  { key: 'dayChange', label: '價格漲跌' },
  { key: 'dayPct', label: '單日漲跌幅' },
  { key: 'fivePct', label: '5日漲跌幅' },
];

async function loadSnap(stockId) {
  try {
    const bars = await YahooFinanceProvider.getKLine(stockId, {
      startDate: new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 10),
    });
    return computeWatchSnapshot(bars);
  } catch {
    try {
      const bars = await FinMindProvider.getKLine(stockId, {
        startDate: new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 10),
      });
      return computeWatchSnapshot(bars);
    } catch {
      return null;
    }
  }
}

async function renderList(container) {
  const listEl = container.querySelector('#watch-list');
  const sortEl = container.querySelector('#watch-sort');
  const items = getAllWatchItems();

  if (items.length === 0) {
    sortEl.innerHTML = '';
    listEl.innerHTML = '<div class="empty-state">觀察名單是空的</div>';
    return;
  }

  listEl.innerHTML = '<div class="empty-state">載入行情中…</div>';
  const rows = [];
  for (const w of items) {
    const snap = await loadSnap(w.stockId);
    rows.push({ w, snap });
  }

  let sortKey = container._watchSortKey || 'dayPct';
  function paint() {
    sortEl.innerHTML = SORT_KEYS.map(
      (s) =>
        `<button class="btn ${sortKey === s.key ? 'btn-primary' : ''}" data-sort="${s.key}" style="padding:6px 10px; font-size:12px;">${s.label}</button>`
    ).join('');
    const ordered = sortWatchRows(rows, sortKey);
    listEl.innerHTML = ordered
      .map(({ w, snap }) => {
        const dayCls = snap ? pnlClass(snap.dayChange) : 'text-faint';
        const fiveCls = snap ? pnlClass(snap.fivePct) : 'text-faint';
        const maBits = snap
          ? `MA5${snap.ma5 || '—'} · MA10${snap.ma10 || '—'} · MA20${snap.ma20 || '—'}`
          : '行情未取到';
        const rangeLabel = snap
          ? snap.hasFlat
            ? `直線K 高 ${snap.rangeHigh} / 低 ${snap.rangeLow}`
            : `最新K 高 ${snap.rangeHigh} / 低 ${snap.rangeLow}`
          : '';
        return `
    <div class="card" data-watch-id="${escapeHtml(w.id)}" style="border-style:dashed;">
      <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:8px;">
        <button class="stock-link" data-action="view-detail" data-stock-id="${escapeHtml(w.stockId)}" style="background:none; border:none; padding:0; cursor:pointer; text-align:left; color:inherit; flex:1;">
          <div style="font-size:14.5px; font-weight:700; text-decoration:underline; text-decoration-color:var(--border);">
            ${escapeHtml(w.stockName)} <span class="text-faint" style="font-weight:500; font-size:12px;">${escapeHtml(w.stockId)}</span>
          </div>
          <div style="margin-top:6px; font-size:13px; font-weight:700;">
            ${snap ? snap.price : '—'}
            <span class="${dayCls}" style="font-weight:600; font-size:12px; margin-left:6px;">${snap ? fmtNum(snap.dayChange) : ''} ${snap ? fmtPct(snap.dayPct) : ''}</span>
          </div>
          <div class="${fiveCls}" style="font-size:11.5px; margin-top:2px;">5日 ${snap ? fmtPct(snap.fivePct) : '—'}</div>
          <div class="text-faint" style="font-size:11px; margin-top:4px;">${maBits}</div>
          <div class="text-faint" style="font-size:11px; margin-top:2px;">${rangeLabel}</div>
        </button>
        <button class="icon-btn" data-action="remove" title="移除">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path></svg>
        </button>
      </div>
    </div>
  `;
      })
      .join('');

    sortEl.querySelectorAll('[data-sort]').forEach((btn) => {
      btn.addEventListener('click', () => {
        sortKey = btn.getAttribute('data-sort');
        container._watchSortKey = sortKey;
        paint();
      });
    });
    listEl.querySelectorAll('[data-action="view-detail"]').forEach((btn) => {
      btn.addEventListener('click', () => navigate('detail', btn.getAttribute('data-stock-id')));
    });
    listEl.querySelectorAll('[data-action="remove"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const card = btn.closest('[data-watch-id]');
        btn.disabled = true;
        await removeWatchItem(card.getAttribute('data-watch-id'));
        renderList(container);
      });
    });
  }
  paint();
}

export { renderWatchlistView };
