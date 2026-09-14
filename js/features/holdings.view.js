import { recompute } from './transactions.js';
import { ManualPriceRepository } from '../data/storage.js';
import { getLiveQuote, getLiveQuotes } from '../data/marketdata.js';
import { formatMoney, formatPercent, pnlClass } from '../utils/format.js';
import { navigate } from '../router.js';

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
    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:16px;">
      <div style="font-size:20px; font-weight:700;">我的持股</div>
      <button class="btn" id="refresh-all-prices">全部更新</button>
    </div>
    <div id="positions-list"></div>
  `;

  container.querySelector('#refresh-all-prices').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = '更新中…';
    try {
      // Batched: one TWSE request covering all stockIds instead of one
      // request per stock — looping getLiveQuote() per stock used to trip
      // TWSE's anti-scraping throttle during market hours once there were
      // more than a couple of holdings, even though updating a single stock
      // worked fine.
      const quotes = await getLiveQuotes(positions.map((p) => p.stockId));
      const prices = {};
      for (const [stockId, quote] of Object.entries(quotes)) prices[stockId] = quote.price;
      if (Object.keys(prices).length > 0) await ManualPriceRepository.setMany(prices);
    } catch (err) {
      alert(err?.message || '全部更新失敗，請稍後再試或逐檔手動更新');
    }
    render(container);
  });

  const list = container.querySelector('#positions-list');
  list.innerHTML = positions
    .map((p) => {
      const hasPrice = p.marketPrice != null;
      return `
      <div class="card" data-stock-id="${p.stockId}" style="padding:10px 14px;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
          <button class="stock-link" data-action="view-detail" style="background:none; border:none; padding:0; cursor:pointer; text-align:left; color:inherit; min-width:0; overflow:hidden;">
            <div style="font-size:14px; font-weight:700; text-decoration:underline; text-decoration-color:var(--border); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${p.stockName}
              <span class="text-faint" style="font-weight:500; font-size:12px;">${p.stockId}</span>
            </div>
          </button>
          <button class="btn" data-action="save-price" style="flex:0 0 auto;">更新</button>
        </div>
        <div class="text-faint" style="font-size:11px; margin-top:2px;">
          持有 ${p.totalQuantity} 股 · 成本 ${p.averageCost.toFixed(2)}
        </div>
        <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-top:8px;">
          <div style="flex:0 0 auto;">
            ${hasPrice
              ? `<div style="font-size:14px; font-weight:700;">${p.marketPrice}</div>
                 <div class="${pnlClass(p.unrealizedPnL)}" style="font-size:11.5px; font-weight:600;">
                   ${formatMoney(p.unrealizedPnL)} (${formatPercent(p.unrealizedPnLPercent)})
                 </div>`
              : `<div class="text-faint" style="font-size:12px;">未輸入現價</div>`}
          </div>
          <input type="number" step="0.01" min="0" placeholder="市價"
                 class="price-input" style="width:90px; background:var(--panel-2); border:1px solid var(--border); border-radius:8px; padding:7px 8px; color:var(--text); font-size:13px; min-height:36px;"
                 value="${hasPrice ? p.marketPrice : ''}">
        </div>
      </div>
    `;
    })
    .join('');

  list.querySelectorAll('[data-action="view-detail"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const cardEl = btn.closest('[data-stock-id]');
      navigate('detail', cardEl.getAttribute('data-stock-id'));
    });
  });

  list.querySelectorAll('[data-action="save-price"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const cardEl = btn.closest('[data-stock-id]');
      const stockId = cardEl.getAttribute('data-stock-id');
      const input = cardEl.querySelector('.price-input');

      // "更新" always tries to fetch a fresh live price first — the input
      // pre-fills with the last known market price for display, so reading
      // it here first (only falling back to auto-fetch when empty) meant
      // every click after the first successful update just re-saved that
      // same stale value and silently did nothing, since the field is never
      // empty again once it has a price in it.
      btn.disabled = true;
      btn.textContent = '取得中…';
      let price = null;
      try {
        const quote = await getLiveQuote(stockId);
        if (quote) price = quote.price;
      } catch (err) {
        // Fall through — use whatever's manually typed, if anything.
      }
      btn.textContent = '更新';

      if (!(price > 0)) price = parseFloat(input.value);
      if (!(price > 0)) {
        alert('自動取得市價失敗，請手動輸入市價');
        btn.disabled = false;
        return;
      }
      input.value = price;

      const result = await ManualPriceRepository.set(stockId, price);
      if (!result.ok) {
        alert(result.error?.message || '同步失敗');
        btn.disabled = false;
        return;
      }
      render(container);
    });
  });
}

export { renderHoldingsView };
