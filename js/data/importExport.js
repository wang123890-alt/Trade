// Export/import for backup and cross-device transfer. Import MERGES into
// existing data (skipping any id already present) rather than replacing it —
// a wrong file should never silently wipe what's already recorded.

import { TransactionRepository, WatchlistRepository } from './storage.js';
import { runFifo } from '../core/fifo.js';

const EXPORT_VERSION = '1.0';

function buildExportPayload() {
  return {
    version: EXPORT_VERSION,
    exportDate: new Date().toISOString(),
    transactions: TransactionRepository.getAll(),
    watchlist: WatchlistRepository.getAll(),
  };
}

function downloadTextFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function exportAsJson() {
  const payload = buildExportPayload();
  downloadTextFile(
    `trade-backup-${payload.exportDate.slice(0, 10)}.json`,
    JSON.stringify(payload, null, 2),
    'application/json'
  );
}

function csvEscape(value) {
  const s = String(value ?? '');
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function exportTransactionsAsCsv() {
  const transactions = TransactionRepository.getAll();
  const header = ['stockId', 'stockName', 'type', 'dateTime', 'price', 'quantity', 'fee', 'tax', 'strategy', 'reason', 'note'];
  const rows = transactions.map((t) => header.map((k) => csvEscape(t[k])).join(','));
  const csv = [header.join(','), ...rows].join('\n');
  downloadTextFile(`trade-transactions-${new Date().toISOString().slice(0, 10)}.csv`, csv, 'text/csv');
}

/** Validate the shape of a parsed export payload without touching storage. */
function validateImportPayload(payload) {
  const errors = [];
  if (typeof payload !== 'object' || payload === null) {
    errors.push('檔案格式錯誤，不是有效的JSON物件');
    return errors;
  }
  if (!payload.version) errors.push('缺少 version 欄位');
  if (!Array.isArray(payload.transactions)) errors.push('缺少或格式錯誤的 transactions 欄位');
  if (!Array.isArray(payload.watchlist)) errors.push('缺少或格式錯誤的 watchlist 欄位');
  return errors;
}

/** Merge imported transactions/watchlist into existing storage, skipping any
 * id already present. Returns a summary of what happened. Writes are
 * batched into a single persist each (one GitHub commit per collection)
 * rather than one per item, so a large import stays fast. */
async function importFromPayload(payload) {
  const errors = validateImportPayload(payload);
  if (errors.length > 0) {
    return {
      success: false, errors, warnings: [],
      added: { transactions: 0, watchlist: 0 },
      skipped: { transactions: 0, watchlist: 0 },
    };
  }

  const existingTxIds = new Set(TransactionRepository.getAll().map((t) => t.id));
  const newTx = payload.transactions.filter((t) => !existingTxIds.has(t.id));
  const skippedTx = payload.transactions.length - newTx.length;
  if (newTx.length > 0) {
    const result = await TransactionRepository.saveMany(newTx);
    if (!result.ok) {
      return {
        success: false, errors: [result.error?.message || '同步失敗'], warnings: [],
        added: { transactions: 0, watchlist: 0 }, skipped: { transactions: 0, watchlist: 0 },
      };
    }
  }

  const existingWatchIds = new Set(WatchlistRepository.getAll().map((w) => w.id));
  const newWatch = payload.watchlist.filter((w) => !existingWatchIds.has(w.id));
  const skippedWatch = payload.watchlist.length - newWatch.length;
  if (newWatch.length > 0) {
    const result = await WatchlistRepository.saveMany(newWatch);
    if (!result.ok) {
      return {
        success: false, errors: [result.error?.message || '同步失敗'], warnings: [],
        added: { transactions: newTx.length, watchlist: 0 }, skipped: { transactions: skippedTx, watchlist: 0 },
      };
    }
  }

  // Post-merge sanity check: the combined transaction history must still be
  // FIFO-consistent (no over-sell). Import already committed by this point —
  // rejecting after the fact would need a rollback we don't have — so this
  // surfaces as a warning to fix manually, not a blocking error.
  const { errors: fifoErrors } = runFifo(TransactionRepository.getAll());
  const warnings = fifoErrors.map((e) => e.error.message);

  return {
    success: true,
    errors: [],
    warnings,
    added: { transactions: newTx.length, watchlist: newWatch.length },
    skipped: { transactions: skippedTx, watchlist: skippedWatch },
  };
}

export { buildExportPayload, exportAsJson, exportTransactionsAsCsv, validateImportPayload, importFromPayload };
