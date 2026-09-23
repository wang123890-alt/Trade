import { registerRoute, initRouter } from './router.js';
import { initStore } from './data/storage.js';
import { renderOverviewView } from './features/overview.view.js';
import { renderHoldingsView } from './features/holdings.view.js';
import { renderTransactionsView } from './features/transactions.view.js';
import { renderStockDetailView } from './features/stock-detail.view.js';
import { renderWatchlistView } from './features/watchlist.view.js';
import { renderReviewView } from './features/review.view.js';
import { renderSettingsView } from './features/settings.view.js';

registerRoute('overview', renderOverviewView);
registerRoute('holdings', renderHoldingsView);
registerRoute('transactions', renderTransactionsView);
registerRoute('detail', renderStockDetailView);
registerRoute('watchlist', renderWatchlistView);
registerRoute('review', renderReviewView);
registerRoute('settings', renderSettingsView);

async function boot() {
  const view = document.getElementById('view');
  view.innerHTML = '<div class="empty-state">載入資料中…</div>';
  const result = await initStore();
  if (!result.ok && result.source === 'local-fallback') {
    console.warn('GitHub sync unavailable, using local cache', result.error);
  }
  initRouter();
}

boot();
