// Transaction service: the single entry point for reading/mutating
// transactions. Every mutation re-runs the full pipeline —
// Transactions -> FIFO -> Positions -> (statistics, computed by callers as
// needed) — so nothing ever patches TradeMatch/Position state directly.

import { TransactionRepository } from '../data/storage.js';
import { runFifo } from '../core/fifo.js';
import { computePositions } from '../core/position.js';
import { createTransaction, genId } from '../core/models.js';

function validateTransaction(input) {
  const errors = [];
  if (!input.stockId) errors.push('標的代號不可空白');
  if (!input.stockName) errors.push('標的名稱不可空白');
  if (input.type !== 'BUY' && input.type !== 'SELL') errors.push('交易類型必須是 BUY 或 SELL');
  if (!input.dateTime) errors.push('交易日期時間不可空白');
  if (!(input.price > 0)) errors.push('價格必須大於 0');
  if (!(input.quantity > 0)) errors.push('股數必須大於 0');
  if (input.fee != null && input.fee < 0) errors.push('手續費不可為負數');
  if (input.tax != null && input.tax < 0) errors.push('證交稅不可為負數');
  return errors;
}

/** Recompute FIFO + positions from whatever is currently in storage.
 * Stock display names are derived from the transactions themselves (the
 * most recent transaction for each stockId wins) — callers only ever need
 * to supply market prices for unrealized P&L. */
function recompute(marketPrices = {}) {
  const transactions = TransactionRepository.getAll();
  const { matches, openLots, errors } = runFifo(transactions);

  const stockNames = {};
  [...transactions]
    .sort((a, b) => new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime())
    .forEach((t) => { stockNames[t.stockId] = t.stockName; });

  const positions = computePositions(openLots, stockNames, marketPrices);
  return { transactions, matches, positions, openLots, errors };
}

/**
 * Add a new transaction. Returns { transaction, errors } — on validation
 * failure the transaction is NOT saved and errors is non-empty. On an
 * over-sell (caught by recompute after saving would be too late to prevent),
 * we validate against current holdings *before* saving.
 */
async function addTransaction(input) {
  const validationErrors = validateTransaction(input);
  if (validationErrors.length > 0) return { transaction: null, errors: validationErrors };

  const transaction = createTransaction({ id: genId('tx'), ...input });

  // Dry-run FIFO with the candidate transaction included, without persisting,
  // so an over-sell is rejected before it ever touches storage.
  const existing = TransactionRepository.getAll();
  const { errors: fifoErrors } = runFifo([...existing, transaction]);
  if (fifoErrors.length > 0) {
    return { transaction: null, errors: fifoErrors.map((e) => e.error.message) };
  }

  const result = await TransactionRepository.save(transaction);
  if (!result.ok) return { transaction: null, errors: [syncErrorMessage(result.error)] };
  return { transaction, errors: [] };
}

/**
 * Edit an existing transaction. The full transaction list (with this one
 * replaced) is re-validated via FIFO before the change is persisted — this
 * is the "full recompute" rule: an edit that would make history inconsistent
 * (e.g. now over-selling) is rejected, not silently applied.
 */
async function editTransaction(id, changes) {
  const existing = TransactionRepository.getAll();
  const current = existing.find((t) => t.id === id);
  if (!current) return { transaction: null, errors: ['交易紀錄不存在'] };

  const updated = { ...current, ...changes, id, updatedAt: new Date().toISOString() };
  const validationErrors = validateTransaction(updated);
  if (validationErrors.length > 0) return { transaction: null, errors: validationErrors };

  const candidateList = existing.map((t) => (t.id === id ? updated : t));
  const { errors: fifoErrors } = runFifo(candidateList);
  if (fifoErrors.length > 0) {
    return { transaction: null, errors: fifoErrors.map((e) => e.error.message) };
  }

  const result = await TransactionRepository.save(updated);
  if (!result.ok) return { transaction: null, errors: [syncErrorMessage(result.error)] };
  return { transaction: updated, errors: [] };
}

/**
 * Delete a transaction. Like edit, the resulting list is validated via FIFO
 * first — deleting a BUY that a later SELL depends on would over-sell the
 * remaining history, and that is rejected rather than silently corrupting
 * downstream positions.
 */
async function deleteTransaction(id) {
  const existing = TransactionRepository.getAll();
  const candidateList = existing.filter((t) => t.id !== id);
  const { errors: fifoErrors } = runFifo(candidateList);
  if (fifoErrors.length > 0) {
    return { success: false, errors: fifoErrors.map((e) => e.error.message) };
  }
  const result = await TransactionRepository.remove(id);
  if (!result.ok) return { success: false, errors: [syncErrorMessage(result.error)] };
  return { success: true, errors: [] };
}

function syncErrorMessage(error) {
  return error?.message || '同步到 GitHub 失敗，請檢查網路連線或Token設定';
}

export { validateTransaction, recompute, addTransaction, editTransaction, deleteTransaction };
