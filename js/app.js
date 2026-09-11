import { registerRoute, initRouter } from './router.js';
import { renderHoldingsView } from './features/holdings.view.js';
import { renderTransactionsView } from './features/transactions.view.js';

function renderPlaceholder(title, phaseNote) {
  return (container) => {
    container.innerHTML = `
      <div style="font-size:20px; font-weight:700; margin-bottom:8px;">${title}</div>
      <div class="empty-state">${phaseNote}</div>
    `;
  };
}

registerRoute('holdings', renderHoldingsView);
registerRoute('transactions', renderTransactionsView);
registerRoute('watchlist', renderPlaceholder('觀察名單', '尚未實作（Phase 9）'));
registerRoute('settings', renderPlaceholder('資料設定', '尚未實作（Phase 10：CSV/JSON匯出匯入）'));

initRouter();
