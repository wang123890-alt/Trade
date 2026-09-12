import { getAllWatchItems, addWatchItem, removeWatchItem } from './watchlist.js';
import { navigate } from '../router.js';
import { formatDate } from '../utils/format.js';

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

function renderList(container) {
  const listEl = container.querySelector('#watch-list');
  const items = getAllWatchItems();

  if (items.length === 0) {
    listEl.innerHTML = '<div class="empty-state">觀察名單是空的</div>';
    return;
  }

  listEl.innerHTML = items
    .map(
      (w) => `
    <div class="card" data-watch-id="${w.id}" style="border-style:dashed;">
      <div style="display:flex; align-items:flex-start; justify-content:space-between;">
        <button class="stock-link" data-action="view-detail" data-stock-id="${w.stockId}" style="background:none; border:none; padding:0; cursor:pointer; text-align:left; color:inherit;">
          <div style="font-size:14.5px; font-weight:700; text-decoration:underline; text-decoration-color:var(--border);">
            ${w.stockName} <span class="text-faint" style="font-weight:500; font-size:12px;">${w.stockId}</span>
          </div>
          <div class="text-faint" style="font-size:11px; margin-top:2px;">
            ${w.source === 'sold' && w.soldPrice != null
              ? `${formatDate(w.soldAt)} 賣出 ${w.soldPrice} 後加入觀察`
              : `${formatDate(w.addedAt)} 手動加入觀察`}
          </div>
        </button>
        <button class="icon-btn" data-action="remove" title="移除">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path></svg>
        </button>
      </div>
    </div>
  `
    )
    .join('');

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

export { renderWatchlistView };
