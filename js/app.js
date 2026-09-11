import { registerRoute, initRouter } from './router.js';
import { renderOverviewView } from './features/overview.view.js';
import { renderHoldingsView } from './features/holdings.view.js';
import { renderTransactionsView } from './features/transactions.view.js';
import { renderStockDetailView } from './features/stock-detail.view.js';
import { renderWatchlistView } from './features/watchlist.view.js';

function renderPlaceholder(title, phaseNote) {
  return (container) => {
    container.innerHTML = `
      <div style="font-size:20px; font-weight:700; margin-bottom:8px;">${title}</div>
      <div class="empty-state">${phaseNote}</div>
    `;
  };
}

registerRoute('overview', renderOverviewView);
registerRoute('holdings', renderHoldingsView);
registerRoute('transactions', renderTransactionsView);
registerRoute('detail', renderStockDetailView);
registerRoute('watchlist', renderWatchlistView);
registerRoute('settings', renderPlaceholder('資料設定', '尚未實作（Phase 10：CSV/JSON匯出匯入）'));

initRouter();
