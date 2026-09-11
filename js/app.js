import { registerRoute, initRouter } from './router.js';
import { renderOverviewView } from './features/overview.view.js';
import { renderHoldingsView } from './features/holdings.view.js';
import { renderTransactionsView } from './features/transactions.view.js';
import { renderStockDetailView } from './features/stock-detail.view.js';
import { renderWatchlistView } from './features/watchlist.view.js';
import { renderSettingsView } from './features/settings.view.js';

registerRoute('overview', renderOverviewView);
registerRoute('holdings', renderHoldingsView);
registerRoute('transactions', renderTransactionsView);
registerRoute('detail', renderStockDetailView);
registerRoute('watchlist', renderWatchlistView);
registerRoute('settings', renderSettingsView);

initRouter();
