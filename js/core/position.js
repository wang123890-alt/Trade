// Derives current open Positions from FIFO's openLots output. Never stored —
// recomputed from runFifo() every time transactions change.

import { createPosition } from './models.js';

/**
 * @param {Object} openLots - output of runFifo(): { [stockId]: lot[] }
 * @param {Object} stockNames - { [stockId]: name } for display
 * @param {Object} marketPrices - optional { [stockId]: price } for unrealized P&L
 * @returns {Array} Position[], one per stock with any remaining quantity
 */
function computePositions(openLots, stockNames = {}, marketPrices = {}) {
  const positions = [];

  for (const [stockId, lots] of Object.entries(openLots)) {
    const totalQuantity = lots.reduce((sum, l) => sum + l.remainingQty, 0);
    if (totalQuantity <= 0) continue;

    const totalCost = lots.reduce(
      (sum, l) => sum + l.remainingQty * (l.price + l.feePerUnit),
      0
    );
    const averageCost = totalQuantity > 0 ? totalCost / totalQuantity : 0;
    const openedAt = lots.reduce(
      (earliest, l) => (l.dateTime < earliest ? l.dateTime : earliest),
      lots[0].dateTime
    );

    const marketPrice = marketPrices[stockId] ?? null;
    const marketValue = marketPrice != null ? marketPrice * totalQuantity : null;
    const unrealizedPnL = marketValue != null ? marketValue - totalCost : null;
    const unrealizedPnLPercent =
      unrealizedPnL != null && totalCost > 0 ? (unrealizedPnL / totalCost) * 100 : null;

    positions.push(
      createPosition({
        stockId,
        stockName: stockNames[stockId] ?? stockId,
        totalQuantity,
        averageCost,
        totalCost,
        openedAt,
        marketPrice,
        marketValue,
        unrealizedPnL,
        unrealizedPnLPercent,
      })
    );
  }

  return positions;
}

export { computePositions };
