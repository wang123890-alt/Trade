// Storage Repository. The rest of the app (features/, app.js) talks only to
// this module's functions — never to localStorage directly — so the backing
// store can later change (IndexedDB, a real backend) without touching
// business logic. Today's implementation is localStorage only.

const KEYS = {
  transactions: 'trade_app.transactions.v1',
  watchlist: 'trade_app.watchlist.v1',
  manualPrices: 'trade_app.manual_prices.v1',
};

function readList(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Corrupt or unavailable storage should not crash the app — treat as empty.
    return [];
  }
}

function writeList(key, list) {
  localStorage.setItem(key, JSON.stringify(list));
}

const TransactionRepository = {
  getAll() {
    return readList(KEYS.transactions);
  },
  save(transaction) {
    const all = readList(KEYS.transactions);
    const idx = all.findIndex((t) => t.id === transaction.id);
    if (idx >= 0) {
      all[idx] = transaction;
    } else {
      all.push(transaction);
    }
    writeList(KEYS.transactions, all);
    return transaction;
  },
  remove(id) {
    const all = readList(KEYS.transactions);
    writeList(KEYS.transactions, all.filter((t) => t.id !== id));
  },
  replaceAll(list) {
    writeList(KEYS.transactions, list);
  },
};

const WatchlistRepository = {
  getAll() {
    return readList(KEYS.watchlist);
  },
  save(watchItem) {
    const all = readList(KEYS.watchlist);
    const idx = all.findIndex((w) => w.id === watchItem.id);
    if (idx >= 0) {
      all[idx] = watchItem;
    } else {
      all.push(watchItem);
    }
    writeList(KEYS.watchlist, all);
    return watchItem;
  },
  remove(id) {
    const all = readList(KEYS.watchlist);
    writeList(KEYS.watchlist, all.filter((w) => w.id !== id));
  },
  replaceAll(list) {
    writeList(KEYS.watchlist, list);
  },
};

// Manual current-price overrides, keyed by stockId. This is the MVP stand-in
// for MarketDataProvider's live quote (Phase 5) — a stock with no provider
// price yet still gets an unrealized P&L if the user types one in.
const ManualPriceRepository = {
  getAll() {
    try {
      const raw = localStorage.getItem(KEYS.manualPrices);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  },
  set(stockId, price) {
    const all = ManualPriceRepository.getAll();
    all[stockId] = price;
    localStorage.setItem(KEYS.manualPrices, JSON.stringify(all));
  },
};

export { TransactionRepository, WatchlistRepository, ManualPriceRepository };
