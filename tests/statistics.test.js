// Plain Node test runner. Run with: node tests/statistics.test.js
import assert from 'node:assert/strict';
import {
  computeRealizedSummary,
  computeUnrealizedSummary,
  groupByStock,
  groupByStrategy,
} from '../js/core/statistics.js';
import { createTradeMatch, createPosition } from '../js/core/models.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok - ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL - ${name}`);
    console.log(`    ${err.stack}`);
  }
}

function match(overrides) {
  return createTradeMatch({
    id: overrides.id ?? `m_${Math.random()}`,
    buyTransactionId: overrides.buyTransactionId ?? 'b1',
    sellTransactionId: overrides.sellTransactionId ?? 's1',
    stockId: overrides.stockId ?? '2330',
    quantity: overrides.quantity ?? 1000,
    buyPrice: overrides.buyPrice ?? 100,
    sellPrice: overrides.sellPrice ?? 110,
    buyCost: overrides.buyCost ?? 100000,
    sellIncome: overrides.sellIncome ?? 110000,
    realizedPnL: overrides.realizedPnL,
    realizedPnLPercent: overrides.realizedPnLPercent ?? 0,
    holdingDays: overrides.holdingDays ?? 5,
    closedAt: overrides.closedAt ?? '2026-01-10',
  });
}

test('computeRealizedSummary handles empty input without dividing by zero', () => {
  const s = computeRealizedSummary([]);
  assert.equal(s.totalRealizedPnL, 0);
  assert.equal(s.closedCount, 0);
  assert.equal(s.winRate, null);
  assert.equal(s.profitLossRatio, null);
  assert.equal(s.realizedPnLPercent, null);
});

test('computeRealizedSummary weights realizedPnLPercent by cost, not by averaging each match\'s own percent', () => {
  const matches = [
    match({ buyCost: 100000, realizedPnL: 10000 }), // +10% on a big lot
    match({ buyCost: 1000, realizedPnL: -900 }), // -90% on a tiny lot
  ];
  const s = computeRealizedSummary(matches);
  // Naive averaging of (+10%, -90%) would give -40%; cost-weighted should
  // stay close to the dominant lot's return since it's 100x the size.
  assert.equal(s.totalRealizedPnL, 9100);
  assert.ok(Math.abs(s.realizedPnLPercent - (9100 / 101000) * 100) < 1e-9);
  assert.ok(s.realizedPnLPercent > 0);
});

test('computeRealizedSummary computes win rate and profit/loss ratio correctly', () => {
  const matches = [
    match({ realizedPnL: 1000 }),
    match({ realizedPnL: 2000 }),
    match({ realizedPnL: -500 }),
  ];
  const s = computeRealizedSummary(matches);
  assert.equal(s.totalRealizedPnL, 2500);
  assert.equal(s.closedCount, 3);
  assert.equal(s.winCount, 2);
  assert.equal(s.lossCount, 1);
  assert.equal(s.winRate, (2 / 3) * 100);
  assert.equal(s.avgWin, 1500);
  assert.equal(s.avgLoss, -500);
  assert.equal(s.profitLossRatio, 3); // |1500 / -500|
});

test('computeUnrealizedSummary only counts positions that have a market price', () => {
  const positions = [
    createPosition({ stockId: '2330', stockName: '台積電', totalQuantity: 1000, averageCost: 100, totalCost: 100000, openedAt: '2026-01-01', unrealizedPnL: 5000 }),
    createPosition({ stockId: '2317', stockName: '鴻海', totalQuantity: 500, averageCost: 100, totalCost: 50000, openedAt: '2026-01-01' }), // no price
  ];
  const s = computeUnrealizedSummary(positions);
  assert.equal(s.totalUnrealizedPnL, 5000);
  assert.equal(s.positionsWithPrice, 1);
  assert.equal(s.positionsTotal, 2);
});

test('groupByStock groups and sorts by closed-trade count descending', () => {
  const matches = [
    match({ stockId: '2330', realizedPnL: 1000 }),
    match({ stockId: '2330', realizedPnL: -200 }),
    match({ stockId: '2317', realizedPnL: 500 }),
  ];
  const groups = groupByStock(matches);
  assert.equal(groups[0].stockId, '2330');
  assert.equal(groups[0].closedCount, 2);
  assert.equal(groups[1].stockId, '2317');
  assert.equal(groups[1].closedCount, 1);
});

test('groupByStrategy falls back to (未標記) when the buy transaction has no strategy tag', () => {
  const matches = [
    match({ buyTransactionId: 'b1', realizedPnL: 1000 }),
    match({ buyTransactionId: 'b2', realizedPnL: -300 }),
  ];
  const transactionsById = {
    b1: { strategy: 'MA20拉回' },
    b2: { strategy: '' },
  };
  const groups = groupByStrategy(matches, transactionsById);
  const byName = Object.fromEntries(groups.map((g) => [g.strategy, g]));
  assert.equal(byName['MA20拉回'].closedCount, 1);
  assert.equal(byName['(未標記)'].closedCount, 1);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
