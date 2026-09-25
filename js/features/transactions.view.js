import { recompute, addTransaction, deleteTransaction } from './transactions.js';
import { bindStockLookup } from './stockLookup.bind.js';
import { addWatchItem } from './watchlist.js';
import { ManualPriceRepository } from '../data/storage.js';
import { formatMoney, formatDate, pnlClass, escapeHtml } from '../utils/format.js';
import { navigate } from '../router.js';

const FEE_RATE = 0.001425;
const TAX_RATE = 0.003;

function computeFee(price, quantity) {
  if (!(price > 0) || !(quantity > 0)) return 0;
  return Math.round(price * quantity * FEE_RATE);
}

function computeTax(price, quantity, type) {
  if (type !== 'SELL' || !(price > 0) || !(quantity > 0)) return 0;
  return Math.round(price * quantity * TAX_RATE);
}

function triSelect(name, label) {
  return `
    <div class="form-field">
      <label>${label}</label>
      <select name="${name}">
        <option value="">未填</option>
        <option value="yes">是</option>
        <option value="no">否</option>
      </select>
    </div>`;
}

function renderTransactionsView(container) {
  container.innerHTML = `
    <div class="card" style="margin-bottom:16px;">
      <div style="font-size:15px; font-weight:700; margin-bottom:12px;">新增交易</div>
      <div id="tx-form-errors"></div>
      <form id="tx-form">
        <div class="form-row">
          <div class="form-field">
            <label>標的代號</label>
            <input type="text" name="stockId" placeholder="2330">
          </div>
          <div class="form-field">
            <label>標的名稱</label>
            <input type="text" name="stockName" placeholder="台積電">
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
            <label>交易日期</label>
            <input type="date" name="dateTime" required>
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
            <label>手續費（自動試算，可修改）</label>
            <input type="number" name="fee" step="0.01" min="0" value="0">
          </div>
          <div class="form-field">
            <label>證交稅（自動試算，可修改）</label>
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
        <div id="buy-rules" style="margin:8px 0 12px; padding-top:10px; border-top:1px solid var(--border);">
          <div class="text-faint" style="font-size:12px; margin-bottom:8px;">買進當日規則（不是今天重算）</div>
          <div class="form-row">${triSelect('ruleTrend', '多頭排列')}</div>
          <div class="form-row">${triSelect('ruleBreakout', '收盤>前20日高')} ${triSelect('ruleAdx', 'ADX≥25')}</div>
          <div class="form-row">${triSelect('ruleVolume', '量≥20日均量')}</div>
        </div>
        <div id="sell-rules" style="margin:8px 0 12px; padding-top:10px; border-top:1px solid var(--border); display:none;">
          <div class="text-faint" style="font-size:12px; margin-bottom:8px;">賣出當日規則</div>
          <div class="form-row">${triSelect('ruleExitFlag', '收盤<MA5 且 MA5<MA10')}</div>
        </div>
        <div class="form-row">
          <div class="form-field">
            <label>有無遵守規則</label>
            <select name="followedRules">
              <option value="">未填</option>
              <option value="yes">有</option>
              <option value="no">沒有</option>
            </select>
          </div>
          <div class="form-field">
            <label>賺賠歸類</label>
            <select name="pnlKind">
              <option value="">未填</option>
              <option value="rule">規則內試錯</option>
              <option value="broke">沒守規則</option>
            </select>
          </div>
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
  bindStockLookup(form);
  const priceInput = form.querySelector('[name="price"]');
  const quantityInput = form.querySelector('[name="quantity"]');
  const typeInput = form.querySelector('[name="type"]');
  const feeInput = form.querySelector('[name="fee"]');
  const taxInput = form.querySelector('[name="tax"]');
  const buyRules = container.querySelector('#buy-rules');
  const sellRules = container.querySelector('#sell-rules');

  function syncRuleSections() {
    const sell = typeInput.value === 'SELL';
    buyRules.style.display = sell ? 'none' : 'block';
    sellRules.style.display = sell ? 'block' : 'none';
  }
  typeInput.addEventListener('change', syncRuleSections);
  syncRuleSections();

  feeInput.addEventListener('input', () => { feeInput.dataset.userEdited = 'true'; });
  taxInput.addEventListener('input', () => { taxInput.dataset.userEdited = 'true'; });

  function autoFillFeeTax() {
    const price = parseFloat(priceInput.value);
    const quantity = parseInt(quantityInput.value, 10);
    const type = typeInput.value;
    if (feeInput.dataset.userEdited !== 'true') feeInput.value = computeFee(price, quantity);
    if (taxInput.dataset.userEdited !== 'true') taxInput.value = computeTax(price, quantity, type);
  }

  [priceInput, quantityInput, typeInput].forEach((el) => {
    el.addEventListener('input', autoFillFeeTax);
    el.addEventListener('change', autoFillFeeTax);
  });

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
      ruleTrend: data.ruleTrend || '',
      ruleBreakout: data.ruleBreakout || '',
      ruleAdx: data.ruleAdx || '',
      ruleVolume: data.ruleVolume || '',
      ruleExitFlag: data.ruleExitFlag || '',
      followedRules: data.followedRules || '',
      pnlKind: data.pnlKind || '',
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
    delete feeInput.dataset.userEdited;
    delete taxInput.dataset.userEdited;
    syncRuleSections();
    renderList(container);
    await maybePromptAddToWatchlist(input);
  });

  renderList(container);
}

function buildDisplayRows(transactions, matches, openLots, errors, manualPrices) {
  const matchesByBuyId = {};
  for (const m of matches) (matchesByBuyId[m.buyTransactionId] ??= []).push(m);
  const rows = [];
  for (const tx of transactions) {
    if (tx.type !== 'BUY') continue;
    for (const m of matchesByBuyId[tx.id] || []) {
      rows.push({ kind: 'sold', date: m.closedAt, stockId: tx.stockId, stockName: tx.stockName, quantity: m.quantity, buyPrice: m.buyPrice, sellPrice: m.sellPrice, realizedPnL: m.realizedPnL, deleteId: m.sellTransactionId });
    }
    const lot = (openLots[tx.stockId] || []).find((l) => l.txId === tx.id);
    const remainingQty = lot ? lot.remainingQty : 0;
    if (remainingQty > 0) {
      const marketPrice = manualPrices[tx.stockId] ?? null;
      rows.push({ kind: 'holding', date: tx.dateTime, stockId: tx.stockId, stockName: tx.stockName, quantity: remainingQty, costPrice: tx.price, marketPrice, residualValue: marketPrice != null ? marketPrice * remainingQty : null, deleteId: tx.id });
    }
  }
  for (const { transaction: tx } of errors) {
    rows.push({ kind: 'unmatched-sell', date: tx.dateTime, stockId: tx.stockId, stockName: tx.stockName, quantity: tx.quantity, price: tx.price, deleteId: tx.id });
  }
  rows.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return rows;
}

function renderRow(row) {
  const header = `
    <button class="stock-link" data-action="view-detail" data-stock-id="${escapeHtml(row.stockId)}" style="background:none; border:none; padding:0; cursor:pointer; text-align:left; color:inherit; font:inherit; text-decoration:underline; text-decoration-color:var(--border);">${escapeHtml(row.stockName)}</button>
    <span class="text-faint" style="font-weight:500;">${escapeHtml(row.stockId)}</span>
  `;
  if (row.kind === 'sold') {
    return { left: `<div style="font-size:13.5px; font-weight:600;">${header}<span class="tag tag-green" style="margin-left:6px;">已賣出</span></div><div class="text-faint" style="font-size:11.5px; margin-top:3px;">${formatDate(row.date)} · 已賣出 ${row.quantity}股 · ${row.buyPrice} → ${row.sellPrice}</div>`, right: `<div class="${pnlClass(row.realizedPnL)}" style="font-size:13px; font-weight:600;">${formatMoney(row.realizedPnL)}</div>` };
  }
  if (row.kind === 'holding') {
    return { left: `<div style="font-size:13.5px; font-weight:600;">${header}<span class="tag" style="margin-left:6px; color:var(--text-faint); background:var(--panel-2); border:1px solid var(--border);">持有中</span></div><div class="text-faint" style="font-size:11.5px; margin-top:3px;">${formatDate(row.date)} · 剩餘 ${row.quantity}股 @ 成本 ${row.costPrice}</div>`, right: `<div style="font-size:13px; font-weight:600;">${row.residualValue != null ? formatMoney(row.residualValue) : '<span class="text-faint" style="font-weight:500; font-size:12px;">未輸入現價</span>'}</div>` };
  }
  return { left: `<div style="font-size:13.5px; font-weight:600;">${header}<span class="tag tag-green" style="margin-left:6px;">賣出</span><span class="tag tag-yellow" style="margin-left:4px;">⚠ 無對應買進</span></div><div class="text-faint" style="font-size:11.5px; margin-top:3px;">${formatDate(row.date)} · ${row.quantity}股 @ ${row.price}</div>`, right: `<div style="font-size:13px; font-weight:600;">${formatMoney(row.price * row.quantity)}</div>` };
}

function renderList(container) {
  const listEl = container.querySelector('#tx-list');
  const manualPrices = ManualPriceRepository.getAll();
  const { transactions, matches, openLots, errors } = recompute(manualPrices);
  if (transactions.length === 0) {
    listEl.innerHTML = '<div class="empty-state">還沒有任何交易紀錄</div>';
    return;
  }
  const rows = buildDisplayRows(transactions, matches, openLots, errors, manualPrices);
  listEl.innerHTML = rows.map((row) => {
    const { left, right } = renderRow(row);
    return `<div class="tx-row" data-tx-id="${row.deleteId}"><div>${left}</div><div style="display:flex; align-items:center; gap:4px;"><div style="text-align:right; margin-right:6px;">${right}</div><button class="icon-btn" data-action="delete" title="刪除"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path></svg></button></div></div>`;
  }).join('');
  listEl.querySelectorAll('[data-action="view-detail"]').forEach((btn) => {
    btn.addEventListener('click', () => navigate('detail', btn.getAttribute('data-stock-id')));
  });
  listEl.querySelectorAll('[data-action="delete"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const row = btn.closest('[data-tx-id]');
      const id = row.getAttribute('data-tx-id');
      btn.disabled = true;
      const { success, errors: deleteErrors } = await deleteTransaction(id);
      if (!success) { alert(deleteErrors.join('；')); btn.disabled = false; return; }
      renderList(container);
    });
  });
}

async function maybePromptAddToWatchlist(input) {
  if (input.type !== 'SELL') return;
  const { positions } = recompute();
  if (positions.some((p) => p.stockId === input.stockId)) return;
  if (!window.confirm(`${input.stockName} 已全部賣出，是否加入觀察名單持續追蹤？`)) return;
  await addWatchItem({ stockId: input.stockId, stockName: input.stockName, source: 'sold', soldPrice: input.price, soldAt: input.dateTime });
}

export { renderTransactionsView };
