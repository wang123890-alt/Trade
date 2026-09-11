import { WatchlistRepository } from '../data/storage.js';
import { createWatchItem, genId } from '../core/models.js';
import { runFifo } from '../core/fifo.js';

function getAllWatchItems() {
  return WatchlistRepository.getAll();
}

function addWatchItem({ stockId, stockName, source = 'manual', soldPrice = null, soldAt = null }) {
  if (!stockId || !stockName) {
    return { watchItem: null, errors: ['標的代號與名稱不可空白'] };
  }
  const existing = WatchlistRepository.getAll();
  if (existing.some((w) => w.stockId === stockId)) {
    return { watchItem: null, errors: ['這個標的已經在觀察名單中'] };
  }
  const watchItem = createWatchItem({
    id: genId('watch'),
    stockId,
    stockName,
    source,
    soldPrice,
    soldAt,
  });
  WatchlistRepository.save(watchItem);
  return { watchItem, errors: [] };
}

/**
 * Scan a full transaction list for stocks that have been fully sold out
 * (no remaining open lot) and add each one to the watchlist automatically,
 * without the interactive confirm() prompt — meant for bulk paths (import)
 * where asking once per stock would mean dozens of dialogs. A stock already
 * in the watchlist, or one that still has an open position, is skipped.
 * Returns the list of items actually added.
 */
function autoAddFullyClosedFromTransactions(transactions) {
  const { openLots } = runFifo(transactions);
  const openStockIds = new Set(
    Object.entries(openLots)
      .filter(([, lots]) => lots.reduce((sum, l) => sum + l.remainingQty, 0) > 0)
      .map(([stockId]) => stockId)
  );

  const existingWatchIds = new Set(WatchlistRepository.getAll().map((w) => w.stockId));

  // Group SELL transactions by stock, keep the most recent one for the
  // sold price/date shown on the resulting watch item.
  const lastSellByStock = {};
  for (const t of transactions) {
    if (t.type !== 'SELL') continue;
    const current = lastSellByStock[t.stockId];
    if (!current || new Date(t.dateTime).getTime() > new Date(current.dateTime).getTime()) {
      lastSellByStock[t.stockId] = t;
    }
  }

  const added = [];
  for (const [stockId, sellTx] of Object.entries(lastSellByStock)) {
    if (openStockIds.has(stockId)) continue; // still holding some
    if (existingWatchIds.has(stockId)) continue; // already tracked

    const watchItem = createWatchItem({
      id: genId('watch'),
      stockId,
      stockName: sellTx.stockName,
      source: 'sold',
      soldPrice: sellTx.price,
      soldAt: sellTx.dateTime,
    });
    WatchlistRepository.save(watchItem);
    added.push(watchItem);
  }
  return added;
}

function removeWatchItem(id) {
  WatchlistRepository.remove(id);
}

export { getAllWatchItems, addWatchItem, removeWatchItem, autoAddFullyClosedFromTransactions };
