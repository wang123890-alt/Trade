// Core domain models. Plain factory functions (no classes needed) — these are
// data shapes shared by fifo.js, position.js, statistics.js and storage.js.

/**
 * A single buy/sell fill. Transactions are immutable facts: editing one means
 * replacing it and re-running the full FIFO/Position/Statistics pipeline,
 * never patching downstream state directly.
 *
 * Review fields (2026-09-23): snapshot of the rule checklist ON THE TRADE
 * DATE, not today's recalculation. Empty string = not filled (old CSV rows).
 *   ruleTrend / ruleBreakout / ruleAdx / ruleVolume : '' | 'yes' | 'no'  (BUY)
 *   ruleExitFlag : '' | 'yes' | 'no'  (SELL: 收盤<MA5 且 MA5<MA10)
 *   followedRules : '' | 'yes' | 'no'
 *   pnlKind : '' | 'rule' | 'broke'  (規則內試錯 / 沒守規則)
 */
function createTransaction({
  id,
  stockId,
  stockName,
  type, // 'BUY' | 'SELL'
  dateTime, // ISO 8601 string
  price,
  quantity,
  fee = 0,
  tax = 0,
  strategy = '',
  reason = '',
  note = '',
  ruleTrend = '',
  ruleBreakout = '',
  ruleAdx = '',
  ruleVolume = '',
  ruleExitFlag = '',
  followedRules = '',
  pnlKind = '',
  createdAt = new Date().toISOString(),
  updatedAt = new Date().toISOString(),
}) {
  return {
    id,
    stockId,
    stockName,
    type,
    dateTime,
    price,
    quantity,
    fee,
    tax,
    strategy,
    reason,
    note,
    ruleTrend,
    ruleBreakout,
    ruleAdx,
    ruleVolume,
    ruleExitFlag,
    followedRules,
    pnlKind,
    createdAt,
    updatedAt,
  };
}

/**
 * One FIFO-matched closed lot: part or all of a BUY matched against part or
 * all of a SELL. Produced only by fifo.js — never hand-authored or edited.
 */
function createTradeMatch({
  id,
  buyTransactionId,
  sellTransactionId,
  stockId,
  quantity,
  buyPrice,
  sellPrice,
  buyCost,
  sellIncome,
  realizedPnL,
  realizedPnLPercent,
  holdingDays,
  closedAt,
  review = null, // filled in by the loss-review engine when realizedPnL < 0
}) {
  return {
    id,
    buyTransactionId,
    sellTransactionId,
    stockId,
    quantity,
    buyPrice,
    sellPrice,
    buyCost,
    sellIncome,
    realizedPnL,
    realizedPnLPercent,
    holdingDays,
    closedAt,
    review,
  };
}

/** Current open lot summary for one stock. Always derived, never stored. */
function createPosition({
  stockId,
  stockName,
  totalQuantity,
  averageCost,
  totalCost,
  openedAt,
  marketPrice = null,
  marketValue = null,
  unrealizedPnL = null,
  unrealizedPnLPercent = null,
  updatedAt = new Date().toISOString(),
}) {
  return {
    stockId,
    stockName,
    totalQuantity,
    averageCost,
    totalCost,
    openedAt,
    marketPrice,
    marketValue,
    unrealizedPnL,
    unrealizedPnLPercent,
    updatedAt,
  };
}

/** A stock kept under observation after being fully sold (or added manually). */
function createWatchItem({
  id,
  stockId,
  stockName,
  source = 'manual', // 'manual' | 'sold'
  soldPrice = null,
  soldAt = null,
  addedAt = new Date().toISOString(),
  notes = [], // [{ time, text }], append-only
}) {
  return {
    id,
    stockId,
    stockName,
    source,
    soldPrice,
    soldAt,
    addedAt,
    notes,
  };
}

function genId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export {
  createTransaction,
  createTradeMatch,
  createPosition,
  createWatchItem,
  genId,
};
