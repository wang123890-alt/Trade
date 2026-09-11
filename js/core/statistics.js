// Pure statistics functions over TradeMatch[] and Position[]. Nothing here
// touches storage — callers pass in whatever recompute() already gave them.

function sum(arr, fn) {
  return arr.reduce((acc, x) => acc + fn(x), 0);
}

function computeRealizedSummary(matches) {
  const totalRealizedPnL = sum(matches, (m) => m.realizedPnL);
  const wins = matches.filter((m) => m.realizedPnL > 0);
  const losses = matches.filter((m) => m.realizedPnL < 0);
  const winRate = matches.length > 0 ? (wins.length / matches.length) * 100 : null;
  const avgWin = wins.length > 0 ? sum(wins, (m) => m.realizedPnL) / wins.length : null;
  const avgLoss = losses.length > 0 ? sum(losses, (m) => m.realizedPnL) / losses.length : null;
  const profitLossRatio =
    avgWin != null && avgLoss != null && avgLoss !== 0 ? Math.abs(avgWin / avgLoss) : null;

  return {
    totalRealizedPnL,
    closedCount: matches.length,
    winCount: wins.length,
    lossCount: losses.length,
    winRate,
    avgWin,
    avgLoss,
    profitLossRatio,
  };
}

function computeUnrealizedSummary(positions) {
  const withPrice = positions.filter((p) => p.unrealizedPnL != null);
  const totalUnrealizedPnL = sum(withPrice, (p) => p.unrealizedPnL);
  return {
    totalUnrealizedPnL,
    positionsWithPrice: withPrice.length,
    positionsTotal: positions.length,
  };
}

/** Group realized matches by stockId, most-traded first. */
function groupByStock(matches) {
  const groups = {};
  for (const m of matches) {
    if (!groups[m.stockId]) groups[m.stockId] = [];
    groups[m.stockId].push(m);
  }
  return Object.entries(groups)
    .map(([stockId, stockMatches]) => ({
      stockId,
      ...computeRealizedSummary(stockMatches),
    }))
    .sort((a, b) => b.closedCount - a.closedCount);
}

/** Group realized matches by the strategy tag on the originating BUY.
 * Matches with no strategy tag are grouped under '(未標記)'. */
function groupByStrategy(matches, transactionsById) {
  const groups = {};
  for (const m of matches) {
    const buyTx = transactionsById[m.buyTransactionId];
    const strategy = (buyTx && buyTx.strategy) || '(未標記)';
    if (!groups[strategy]) groups[strategy] = [];
    groups[strategy].push(m);
  }
  return Object.entries(groups)
    .map(([strategy, strategyMatches]) => ({
      strategy,
      ...computeRealizedSummary(strategyMatches),
    }))
    .sort((a, b) => b.closedCount - a.closedCount);
}

export { computeRealizedSummary, computeUnrealizedSummary, groupByStock, groupByStrategy };
