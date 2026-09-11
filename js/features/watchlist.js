import { WatchlistRepository } from '../data/storage.js';
import { createWatchItem, genId } from '../core/models.js';

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

function removeWatchItem(id) {
  WatchlistRepository.remove(id);
}

export { getAllWatchItems, addWatchItem, removeWatchItem };
