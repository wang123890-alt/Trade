import { recompute } from './transactions.js';
import { ManualPriceRepository } from '../data/storage.js';
import { getLiveQuote, getLiveQuotes } from '../data/marketdata.js';
import { formatMoney, formatPercent, formatTime, pnlClass } from '../utils/format.js';
import { navigate } from '../router.js';

// Where each displayed price came from ("雅虎" for a live intraday quote,
// "09/12收盤" for FinMind's stale daily close) and when this session last
// fetched it, keyed by stockId. Only the price itself is persisted, so this
// is in-memory and only labels prices fetched in this session — enough to
// answer the question that kept coming up: "I pressed 更新 and the number
// didn't move, is it broken?" A number tagged 收盤 hasn't moved because the
// market's last settled price hasn't moved, which is very different from a
// failed update; the fetch time answers "did 更新 actually just run".
const priceMeta = {};

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
      // All holdings are fetched in parallel (see getLiveQuotes), so a
      // portfolio costs about as long as a single stock.
      const quotes = await getLiveQuotes(positions.map((p) => p.stockId));
      const prices = {};
      const fetchedAt = new Date().toISOString();
      for (const [stockId, quote] of Object.entries(quotes)) {
        prices[stockId] = quote.price;
        priceMeta[stockId] = { source: quote.source, fetchedAt };
      }
      if (Object.keys(prices).length > 0) {
        await ManualPriceRepository.setMany(prices);
        if (Object.keys(prices).length < positions.length) {
          const missed = positions.filter((p) => !(p.stockId in prices)).map((p) => p.stockName).join('、');
          alert(`部分更新成功，這幾檔沒有查到資料：${missed}`);
        }
      } else {
        // getLiveQuotes() never throws — it returns {} when every source
        // came back empty for every stock. That used to fall through
        // silently: no error, so the catch below never ran, and no update
        // happened with zero on-screen indication.
        alert('全部更新失敗：雅虎財經與 FinMind 都查無資料，請稍後再試');
      }
    } catch (err) {
      alert(err?.message || '全部更新失敗，請稍後再試');
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
        <div style="margin-top:8px;">
          ${hasPrice
            ? `<div style="font-size:14px; font-weight:700;">${p.marketPrice}
                 ${priceMeta[p.stockId] ? `<span class="text-faint" style="font-size:11px; font-weight:500;">${priceMeta[p.stockId].source} · ${formatTime(priceMeta[p.stockId].fetchedAt)}更新</span>` : ''}
               </div>
               <div class="${pnlClass(p.unrealizedPnL)}" style="font-size:11.5px; font-weight:600;">
                 ${formatMoney(p.unrealizedPnL)} (${formatPercent(p.unrealizedPnLPercent)})
               </div>`
            : `<div class="text-faint" style="font-size:12px;">尚未取得市價</div>`}
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

      btn.disabled = true;
      btn.textContent = '取得中…';
      let price = null;
      let fetchError = null;
      try {
        const quote = await getLiveQuote(stockId);
        if (quote) {
          price = quote.price;
          priceMeta[stockId] = { source: quote.source, fetchedAt: new Date().toISOString() };
        }
      } catch (err) {
        fetchError = err;
      }
      btn.textContent = '更新';

      if (!(price > 0)) {
        // Show the actual reason when there is one — this is the only way
        // to tell "every source really has nothing right now" from "a
        // specific source errored out" without opening devtools, which
        // matters when the person testing this is on a phone.
        alert(fetchError?.message || '自動取得市價失敗，請稍後再試');
        btn.disabled = false;
        return;
      }

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
