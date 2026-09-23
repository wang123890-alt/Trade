// Core domain models. Plain factory functions (no classes needed) — these are
// data shapes shared by fifo.js, position.js, statistics.js and storage.js.

/**
 * Review fields (2026-09-23): snapshot of the rule checklist ON THE TRADE
 * DATE, not today's recalculation. Empty string = not filled (old CSV rows).
 *   ruleTrend / ruleBreakout / ruleAdx / ruleVolume : '' | 'yes' | 'no'  (BUY)
 *   ruleExitFlag : '' | 'yes' | 'no'  (SELL)
 *   followedRules : '' | 'yes' | 'no'
 *   pnlKind : '' | 'rule' | 'broke'
 *   selfReview : free text written on the review page
 */
function createTransaction({
  id,
  stockId,
  stockName,
  type,
  dateTime,
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
  selfReview = '',
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
    selfReview,
    createdAt,
    updatedAt,
  };
}

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
  review = null,
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

function createWatchItem({
  id,
  stockId,
  stockName,
  source = 'manual',
  soldPrice = null,
  soldAt = null,
  addedAt = new Date().toISOString(),
  notes = [],
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
