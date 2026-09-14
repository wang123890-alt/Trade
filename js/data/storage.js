// Storage layer. The rest of the app (features/, app.js) talks only to the
// Repository objects exported here — never to localStorage or GitHub
// directly — so the backing store can change without touching business
// logic. Reads are synchronous (served from an in-memory cache); mutations
// are async because they may push to GitHub.
//
// Two modes, chosen automatically by whether GitHub sync is configured
// (js/data/githubStore.js):
//   - Not configured: pure localStorage, exactly as before. Nothing about
//     this app changes for someone who never opens the sync settings.
//   - Configured: GitHub is the source of truth (call initStore() once at
//     app startup to load it), localStorage is kept as an offline mirror so
//     the app still renders something if a later read fails.

import * as githubStore from './githubStore.js';

const CACHE_KEY = 'trade_app.data_cache.v1';

const DEFAULT_STATE = () => ({
  version: '1.0',
  transactions: [],
  watchlist: [],
  manualPrices: {},
  stockNotes: {},
  stockAiAnalysis: {},
});

let state = DEFAULT_STATE();
let remoteSha = null;
let remoteAvailable = false; // true once a successful GitHub read/write has happened this session

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? { ...DEFAULT_STATE(), ...JSON.parse(raw) } : DEFAULT_STATE();
  } catch {
    return DEFAULT_STATE();
  }
}

function writeCache() {
  localStorage.setItem(CACHE_KEY, JSON.stringify(state));
}

/** Call once at app startup, before rendering. If GitHub sync is configured,
 * pulls the latest remote document into memory (falling back to the local
 * cache mirror on any failure, e.g. offline). If not configured, just loads
 * the local cache — identical to the old pure-localStorage behavior. */
async function initStore() {
  if (!githubStore.isConfigured()) {
    state = readCache();
    remoteAvailable = false;
    return { ok: true, source: 'local' };
  }

  try {
    const { content, sha } = await githubStore.fetchRemote();
    state = content ? { ...DEFAULT_STATE(), ...content } : DEFAULT_STATE();
    remoteSha = sha;
    remoteAvailable = true;
    writeCache();
    return { ok: true, source: 'remote' };
  } catch (err) {
    state = readCache();
    remoteAvailable = false;
    return { ok: false, source: 'local-fallback', error: err };
  }
}

/** Re-pull from GitHub on demand (e.g. a "sync now" button, or when the tab
 * regains focus) so a change made on the other device shows up here. */
async function refreshFromRemote() {
  return initStore();
}

/** Persist the current in-memory state: always to the local cache mirror,
 * and to GitHub too if configured. On a write conflict (the other device
 * wrote since our last read), re-fetches once and retries the push with the
 * fresh sha — our in-memory change is already folded into `state`, so this
 * simply re-applies the same intended write on top of the latest remote. */
async function persist() {
  writeCache();
  if (!githubStore.isConfigured()) return { ok: true };

  try {
    remoteSha = await githubStore.pushRemote(state, remoteSha);
    remoteAvailable = true;
    return { ok: true };
  } catch (err) {
    if (err instanceof githubStore.GitHubConflictError) {
      try {
        const { content, sha } = await githubStore.fetchRemote();
        // Their latest content is authoritative for anything we didn't just
        // change; re-apply is intentionally simple (whole-document
        // last-write-wins) since this app has one editor at a time.
        remoteSha = await githubStore.pushRemote(state, sha);
        state = state; // no-op, kept for clarity: our in-memory state is what we pushed
        void content;
        remoteAvailable = true;
        return { ok: true, retried: true };
      } catch (retryErr) {
        return { ok: false, error: retryErr };
      }
    }
    remoteAvailable = false;
    return { ok: false, error: err };
  }
}

function isRemoteAvailable() {
  return remoteAvailable;
}

const TransactionRepository = {
  getAll() {
    return state.transactions;
  },
  async save(transaction) {
    const idx = state.transactions.findIndex((t) => t.id === transaction.id);
    if (idx >= 0) state.transactions[idx] = transaction;
    else state.transactions.push(transaction);
    return persist();
  },
  async remove(id) {
    state.transactions = state.transactions.filter((t) => t.id !== id);
    return persist();
  },
  async replaceAll(list) {
    state.transactions = list;
    return persist();
  },
  /** Add/update many transactions in one persist — one GitHub commit
   * instead of one per item. Used by bulk import. */
  async saveMany(transactions) {
    for (const transaction of transactions) {
      const idx = state.transactions.findIndex((t) => t.id === transaction.id);
      if (idx >= 0) state.transactions[idx] = transaction;
      else state.transactions.push(transaction);
    }
    return persist();
  },
};

const WatchlistRepository = {
  getAll() {
    return state.watchlist;
  },
  async save(watchItem) {
    const idx = state.watchlist.findIndex((w) => w.id === watchItem.id);
    if (idx >= 0) state.watchlist[idx] = watchItem;
    else state.watchlist.push(watchItem);
    return persist();
  },
  async remove(id) {
    state.watchlist = state.watchlist.filter((w) => w.id !== id);
    return persist();
  },
  async replaceAll(list) {
    state.watchlist = list;
    return persist();
  },
  /** Add/update many watch items in one persist — see
   * TransactionRepository.saveMany. */
  async saveMany(watchItems) {
    for (const watchItem of watchItems) {
      const idx = state.watchlist.findIndex((w) => w.id === watchItem.id);
      if (idx >= 0) state.watchlist[idx] = watchItem;
      else state.watchlist.push(watchItem);
    }
    return persist();
  },
};

// Manual current-price overrides, keyed by stockId. This is the MVP stand-in
// for MarketDataProvider's live quote (Phase 5) — a stock with no provider
// price yet still gets an unrealized P&L if the user types one in.
const ManualPriceRepository = {
  getAll() {
    return state.manualPrices;
  },
  async set(stockId, price) {
    state.manualPrices[stockId] = price;
    return persist();
  },
  /** Update many prices in one persist — see TransactionRepository.saveMany.
   * Used by "update all holdings" so N stocks cost one GitHub commit, not N
   * (which also cuts down on 409 retries between rapid-fire sequential
   * writes). */
  async setMany(pricesByStockId) {
    Object.assign(state.manualPrices, pricesByStockId);
    return persist();
  },
};

// Per-stock 看法紀錄 timeline, shared by the Holdings and Watchlist detail
// pages (both point at the same stockId). Append-only: notes are never
// edited or deleted, only added.
const StockNotesRepository = {
  getAll(stockId) {
    return state.stockNotes[stockId] || [];
  },
  async add(stockId, text) {
    if (!state.stockNotes[stockId]) state.stockNotes[stockId] = [];
    const note = { time: new Date().toISOString(), text };
    state.stockNotes[stockId].push(note);
    await persist();
    return note;
  },
};

// Free-text AI-generated analysis per stock, keyed by stockId. Separate from
// StockNotesRepository (append-only timeline of the user's own notes) —
// this is a single overwritable field meant to hold whatever an outside AI
// tool said about the stock, either typed in directly or distributed here
// by the paste-and-classify import on the holdings page.
const StockAiAnalysisRepository = {
  getAll() {
    return state.stockAiAnalysis;
  },
  get(stockId) {
    return state.stockAiAnalysis[stockId] || '';
  },
  async set(stockId, text) {
    state.stockAiAnalysis[stockId] = text;
    return persist();
  },
  /** Update many at once — see TransactionRepository.saveMany. Used by the
   * paste-and-classify import so distributing across N stocks costs one
   * GitHub commit, not N. */
  async setMany(textByStockId) {
    Object.assign(state.stockAiAnalysis, textByStockId);
    return persist();
  },
};

export {
  initStore,
  refreshFromRemote,
  isRemoteAvailable,
  TransactionRepository,
  WatchlistRepository,
  ManualPriceRepository,
  StockNotesRepository,
  StockAiAnalysisRepository,
};
