import { recompute } from './transactions.js';
import { ManualPriceRepository } from '../data/storage.js';
import { formatMoney, formatPercent, pnlClass } from '../utils/format.js';

function renderHoldingsView(container) {
  render(container);
}

function render(container) {
  const manualPrices = ManualPriceRepository.getAll();
  const { positions } = recompute(manualPrices);

  if (positions.length === 0) {
    container.innerHTML = `
      <div style="font-size:20px; font-weight:700; margin-bottom:16px;">我的持股</div>
      <div class="empty-state">目前沒有持倉，先到「交易紀錄」新增一筆買進</div>
    `;
    return;
  }

  container.innerHTML = `
    <div style="font-size:20px; font-weight:700; margin-bottom:16px;">我的持股</div>
    <div id="positions-list"></div>
  `;

  const list = container.querySelector('#positions-list');
  list.innerHTML = positions
    .map((p) => {
      const hasPrice = p.marketPrice != null;
      return `
      <div class="card" data-stock-id="${p.stockId}">
        <div style="display:flex; align-items:flex-start; justify-content:space-between;">
          <div>
            <div style="font-size:15px; font-weight:700;">${p.stockName}
              <span class="text-faint" style="font-weight:500; font-size:12.5px;">${p.stockId}</span>
            </div>
            <div class="text-faint" style="font-size:11.5px; margin-top:3px;">
              持有 ${p.totalQuantity} 股 · 成本均價 ${p.averageCost.toFixed(2)}
            </div>
          </div>
          <div style="text-align:right;">
            ${hasPrice
              ? `<div style="font-size:17px; font-weight:700;">${p.marketPrice}</div>
                 <div class="${pnlClass(p.unrealizedPnL)}" style="font-size:12.5px; font-weight:600;">
                   ${formatMoney(p.unrealizedPnL)} (${formatPercent(p.unrealizedPnLPercent)})
                 </div>`
              : `<div class="text-faint" style="font-size:12px;">未輸入現價</div>`}
          </div>
        </div>
        <div style="margin-top:12px; padding-top:12px; border-top:1px solid var(--border); display:flex; gap:8px; align-items:center;">
          <input type="number" step="0.01" min="0" placeholder="輸入目前市價"
                 class="price-input" style="flex:1; background:var(--panel-2); border:1px solid var(--border); border-radius:8px; padding:9px 10px; color:var(--text); font-size:14px; min-height:40px;"
                 value="${hasPrice ? p.marketPrice : ''}">
          <button class="btn" data-action="save-price">更新</button>
        </div>
      </div>
    `;
    })
    .join('');

  list.querySelectorAll('[data-action="save-price"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const cardEl = btn.closest('[data-stock-id]');
      const stockId = cardEl.getAttribute('data-stock-id');
      const input = cardEl.querySelector('.price-input');
      const price = parseFloat(input.value);
      if (!(price > 0)) {
        alert('請輸入有效的市價');
        return;
      }
      ManualPriceRepository.set(stockId, price);
      render(container);
    });
  });
}

export { renderHoldingsView };
