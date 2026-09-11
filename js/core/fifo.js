// FIFO matching engine. Pure functions: given the full immutable list of
// Transactions, deterministically recompute TradeMatches and remaining
// inventory (open lots). Never mutates its input, never keeps state between
// calls — editing or deleting a transaction means calling this again on the
// full updated Transaction list, not patching a stored result.

import { createTradeMatch, genId } from './models.js';

/** Thrown when a SELL would take a stock's inventory below zero. */
class OverSellError extends Error {
  constructor(stockId, requested, available, transaction) {
    super(
      `賣出數量超過庫存：${stockId} 要賣 ${requested}，但只有 ${available} 股可賣`
    );
    this.name = 'OverSellError';
    this.stockId = stockId;
    this.requested = requested;
    this.available = available;
    this.transaction = transaction;
  }
}

function daysBetween(isoStart, isoEnd) {
  const start = new Date(isoStart);
  const end = new Date(isoEnd);
  const ms = end.getTime() - start.getTime();
  return Math.max(0, Math.round(ms / (1000 * 60 * 60 * 24)));
}

/**
 * Run FIFO matching over the full transaction history.
 *
 * @param {Array} transactions - full Transaction list (any order; sorted internally)
 * @returns {{ matches: Array, openLots: Object, errors: Array }}
 *   - matches: TradeMatch[] in the order they were closed
 *   - openLots: { [stockId]: Array<{ txId, price, remainingQty, fee, dateTime }> }
 *   - errors: [{ transaction, error }] for any SELL that could not be matched
 *     (over-sell) — that transaction is skipped, matching continues for others
 */
function runFifo(transactions) {
  // Sort by dateTime first, then by createdAt as a tiebreaker so same-day
  // entries still resolve deterministically regardless of input order.
  const sorted = [...transactions].sort((a, b) => {
    const t = new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime();
    if (t !== 0) return t;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

  const openLots = {}; // stockId -> array of lots, oldest first
  const matches = [];
  const errors = [];

  for (const tx of sorted) {
    if (!openLots[tx.stockId]) openLots[tx.stockId] = [];
    const lots = openLots[tx.stockId];

    if (tx.type === 'BUY') {
      lots.push({
        txId: tx.id,
        price: tx.price,
        remainingQty: tx.quantity,
        feePerUnit: tx.quantity > 0 ? tx.fee / tx.quantity : 0,
        dateTime: tx.dateTime,
      });
      continue;
    }

    if (tx.type === 'SELL') {
      const available = lots.reduce((sum, l) => sum + l.remainingQty, 0);
      if (tx.quantity > available) {
        errors.push({ transaction: tx, error: new OverSellError(tx.stockId, tx.quantity, available, tx) });
        continue;
      }

      let remainingToSell = tx.quantity;
      const sellFeePerUnit = tx.quantity > 0 ? tx.fee / tx.quantity : 0;
      const sellTaxPerUnit = tx.quantity > 0 ? tx.tax / tx.quantity : 0;

      while (remainingToSell > 0 && lots.length > 0) {
        const lot = lots[0];
        const matchedQty = Math.min(remainingToSell, lot.remainingQty);

        const buyCost = matchedQty * lot.price + matchedQty * lot.feePerUnit;
        const sellIncome =
          matchedQty * tx.price - matchedQty * sellFeePerUnit - matchedQty * sellTaxPerUnit;
        const realizedPnL = sellIncome - buyCost;
        const realizedPnLPercent = buyCost > 0 ? (realizedPnL / buyCost) * 100 : 0;

        matches.push(
          createTradeMatch({
            id: genId('match'),
            buyTransactionId: lot.txId,
            sellTransactionId: tx.id,
            stockId: tx.stockId,
            quantity: matchedQty,
            buyPrice: lot.price,
            sellPrice: tx.price,
            buyCost,
            sellIncome,
            realizedPnL,
            realizedPnLPercent,
            holdingDays: daysBetween(lot.dateTime, tx.dateTime),
            closedAt: tx.dateTime,
          })
        );

        lot.remainingQty -= matchedQty;
        remainingToSell -= matchedQty;
        if (lot.remainingQty <= 0) lots.shift();
      }
    }
  }

  return { matches, openLots, errors };
}

export { runFifo, OverSellError };
