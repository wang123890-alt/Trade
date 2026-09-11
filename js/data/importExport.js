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
 * id already present. Returns a summary of what happened. */
function importFromPayload(payload) {
  const errors = validateImportPayload(payload);
  if (errors.length > 0) {
    return {
      success: false, errors, warnings: [],
      added: { transactions: 0, watchlist: 0 },
      skipped: { transactions: 0, watchlist: 0 },
    };
  }

  const existingTx = TransactionRepository.getAll();
  const existingTxIds = new Set(existingTx.map((t) => t.id));
  let addedTx = 0;
  let skippedTx = 0;
  for (const t of payload.transactions) {
    if (existingTxIds.has(t.id)) { skippedTx++; continue; }
    TransactionRepository.save(t);
    addedTx++;
  }

  const existingWatch = WatchlistRepository.getAll();
  const existingWatchIds = new Set(existingWatch.map((w) => w.id));
  let addedWatch = 0;
  let skippedWatch = 0;
  for (const w of payload.watchlist) {
    if (existingWatchIds.has(w.id)) { skippedWatch++; continue; }
    WatchlistRepository.save(w);
    addedWatch++;
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
    added: { transactions: addedTx, watchlist: addedWatch },
    skipped: { transactions: skippedTx, watchlist: skippedWatch },
  };
}

export { buildExportPayload, exportAsJson, exportTransactionsAsCsv, validateImportPayload, importFromPayload };
