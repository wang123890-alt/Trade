import { recompute, addTransaction, deleteTransaction } from './transactions.js';
import { addWatchItem } from './watchlist.js';
import { formatMoney, formatDate } from '../utils/format.js';

function renderTransactionsView(container) {
  container.innerHTML = `
    <div class="card" style="margin-bottom:16px;">
      <div style="font-size:15px; font-weight:700; margin-bottom:12px;">新增交易</div>
      <div id="tx-form-errors"></div>
      <form id="tx-form">
        <div class="form-row">
          <div class="form-field">
            <label>標的代號</label>
            <input type="text" name="stockId" placeholder="2330" required>
          </div>
          <div class="form-field">
            <label>標的名稱</label>
            <input type="text" name="stockName" placeholder="台積電" required>
          </div>
        </div>
        <div class="form-row">
          <div class="form-field">
            <label>交易類型</label>
            <select name="type">
              <option value="BUY">買進</option>
              <option value="SELL">賣出</option>
            </select>
          </div>
          <div class="form-field">
            <label>交易日期時間</label>
            <input type="datetime-local" name="dateTime" required>
          </div>
        </div>
        <div class="form-row">
          <div class="form-field">
            <label>價格</label>
            <input type="number" name="price" step="0.01" min="0" required>
          </div>
          <div class="form-field">
            <label>股數</label>
            <input type="number" name="quantity" step="1" min="1" required>
          </div>
        </div>
        <div class="form-row">
          <div class="form-field">
            <label>手續費</label>
            <input type="number" name="fee" step="0.01" min="0" value="0">
          </div>
          <div class="form-field">
            <label>證交稅</label>
            <input type="number" name="tax" step="0.01" min="0" value="0">
          </div>
        </div>
        <div class="form-field">
          <label>策略標籤</label>
          <input type="text" name="strategy" placeholder="例：MA20拉回">
        </div>
        <div class="form-field">
          <label>進出場原因</label>
          <input type="text" name="reason" placeholder="例：突破月線，量增">
        </div>
        <div class="form-field">
          <label>備註</label>
          <textarea name="note"></textarea>
        </div>
        <button type="submit" class="btn btn-primary btn-block">新增交易</button>
      </form>
    </div>

    <div class="card">
      <div style="font-size:15px; font-weight:700; margin-bottom:8px;">交易紀錄</div>
      <div id="tx-list"></div>
    </div>
  `;

  const form = container.querySelector('#tx-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    const input = {
      stockId: data.stockId.trim(),
      stockName: data.stockName.trim(),
      type: data.type,
      dateTime: data.dateTime,
      price: parseFloat(data.price),
      quantity: parseInt(data.quantity, 10),
      fee: parseFloat(data.fee || 0),
      tax: parseFloat(data.tax || 0),
      strategy: data.strategy || '',
      reason: data.reason || '',
      note: data.note || '',
    };

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = '儲存中…';
    const { errors } = await addTransaction(input);
    submitBtn.disabled = false;
    submitBtn.textContent = '新增交易';

    const errorBox = container.querySelector('#tx-form-errors');
    if (errors.length > 0) {
      errorBox.innerHTML = `<div class="error-banner">${errors.join('；')}</div>`;
      return;
    }
    errorBox.innerHTML = '';
    form.reset();
    renderList(container);
    await maybePromptAddToWatchlist(input);
  });

  renderList(container);
}

function renderList(container) {
  const listEl = container.querySelector('#tx-list');
  const { transactions } = recompute();

  if (transactions.length === 0) {
    listEl.innerHTML = '<div class="empty-state">還沒有任何交易紀錄</div>';
    return;
  }

  const sorted = [...transactions].sort(
    (a, b) => new Date(b.dateTime).getTime() - new Date(a.dateTime).getTime()
  );

  listEl.innerHTML = sorted
    .map(
      (tx) => `
    <div class="tx-row" data-tx-id="${tx.id}">
      <div>
        <div style="font-size:13.5px; font-weight:600;">
          ${tx.stockName} <span class="text-faint" style="font-weight:500;">${tx.stockId}</span>
          <span class="tag ${tx.type === 'BUY' ? 'tag-red' : 'tag-green'}" style="margin-left:6px;">
            ${tx.type === 'BUY' ? '買進' : '賣出'}
          </span>
        </div>
        <div class="text-faint" style="font-size:11.5px; margin-top:3px;">
          ${formatDate(tx.dateTime)} · ${tx.quantity}股 @ ${tx.price}
        </div>
      </div>
      <div style="display:flex; align-items:center; gap:4px;">
        <div style="text-align:right; margin-right:6px;">
          <div style="font-size:13px; font-weight:600;">${formatMoney(tx.price * tx.quantity)}</div>
        </div>
        <button class="icon-btn" data-action="delete" title="刪除">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path></svg>
        </button>
      </div>
    </div>
  `
    )
    .join('');

  listEl.querySelectorAll('[data-action="delete"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const row = btn.closest('[data-tx-id]');
      const id = row.getAttribute('data-tx-id');
      btn.disabled = true;
      const { success, errors } = await deleteTransaction(id);
      if (!success) {
        alert(errors.join('；'));
        btn.disabled = false;
        return;
      }
      renderList(container);
    });
  });
}

/** After a SELL that zeroes out the position, offer (never force) adding the
 * stock to the watchlist for continued observation. */
async function maybePromptAddToWatchlist(input) {
  if (input.type !== 'SELL') return;
  const { positions } = recompute();
  const stillHeld = positions.some((p) => p.stockId === input.stockId);
  if (stillHeld) return;

  const wantsToWatch = window.confirm(
    `${input.stockName} 已全部賣出，是否加入觀察名單持續追蹤？`
  );
  if (!wantsToWatch) return;

  await addWatchItem({
    stockId: input.stockId,
    stockName: input.stockName,
    source: 'sold',
    soldPrice: input.price,
    soldAt: input.dateTime,
  });
}

export { renderTransactionsView };
