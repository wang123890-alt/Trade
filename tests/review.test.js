// Plain Node test runner. Run with: node tests/review.test.js
import assert from 'node:assert/strict';
import { RuleBasedProvider, attachLossReviews, summarizeLossPatterns } from '../js/features/review.js';
import { createTradeMatch, createTransaction } from '../js/core/models.js';

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
    id: 'm1', buyTransactionId: 'b1', sellTransactionId: 's1', stockId: '2330',
    quantity: 1000, buyPrice: 100, sellPrice: 90, buyCost: 100000, sellIncome: 90000,
    realizedPnL: -10000, realizedPnLPercent: -10, holdingDays: 5, closedAt: '2026-01-10',
    ...overrides,
  });
}

test('analyzeLoss returns null for a profitable match', () => {
  const result = RuleBasedProvider.analyzeLoss(match({ realizedPnL: 5000, realizedPnLPercent: 5 }));
  assert.equal(result, null);
});

test('analyzeLoss flags wide stop loss when loss percent breaches threshold', () => {
  const result = RuleBasedProvider.analyzeLoss(match({ realizedPnLPercent: -10 }), {});
  assert.ok(result.triggers.includes('停損幅度偏大'));
});

test('analyzeLoss flags short-hold reversal', () => {
  const result = RuleBasedProvider.analyzeLoss(match({ holdingDays: 1, realizedPnLPercent: -3 }), {});
  assert.ok(result.triggers.includes('短時間反轉'));
});

test('analyzeLoss flags missing stop-loss mention when buy reason has none', () => {
  const buyTransaction = createTransaction({
    id: 'b1', stockId: '2330', stockName: '台積電', type: 'BUY',
    dateTime: '2026-01-01', price: 100, quantity: 1000, reason: '突破月線',
  });
  const result = RuleBasedProvider.analyzeLoss(match({ realizedPnLPercent: -3, holdingDays: 10 }), { buyTransaction });
  assert.ok(result.triggers.includes('未設定停損條件'));
});

test('analyzeLoss does not flag missing stop-loss when the reason mentions it', () => {
  const buyTransaction = createTransaction({
    id: 'b1', stockId: '2330', stockName: '台積電', type: 'BUY',
    dateTime: '2026-01-01', price: 100, quantity: 1000, reason: '突破月線，停損設在95',
  });
  const result = RuleBasedProvider.analyzeLoss(match({ realizedPnLPercent: -3, holdingDays: 10 }), { buyTransaction });
  assert.ok(!result.triggers.includes('未設定停損條件'));
});

test('analyzeLoss flags low strategy win rate only with enough sample size', () => {
  const buyTransaction = createTransaction({
    id: 'b1', stockId: '2330', stockName: '台積電', type: 'BUY',
    dateTime: '2026-01-01', price: 100, quantity: 1000, strategy: '突破策略',
    reason: '停損設好了',
  });
  const tooFewTrades = { strategy: '突破策略', closedCount: 2, winRate: 0 };
  const resultTooFew = RuleBasedProvider.analyzeLoss(match({ realizedPnLPercent: -3, holdingDays: 10 }), {
    buyTransaction, strategySummary: tooFewTrades,
  });
  assert.ok(!resultTooFew.triggers.includes('策略勝率偏低'));

  const enoughTrades = { strategy: '突破策略', closedCount: 5, winRate: 30 };
  const resultEnough = RuleBasedProvider.analyzeLoss(match({ realizedPnLPercent: -3, holdingDays: 10 }), {
    buyTransaction, strategySummary: enoughTrades,
  });
  assert.ok(resultEnough.triggers.includes('策略勝率偏低'));
});

test('analyzeLoss falls back to "no rule matched" when nothing triggers', () => {
  const buyTransaction = createTransaction({
    id: 'b1', stockId: '2330', stockName: '台積電', type: 'BUY',
    dateTime: '2026-01-01', price: 100, quantity: 1000, reason: '停損設好了',
  });
  const result = RuleBasedProvider.analyzeLoss(match({ realizedPnLPercent: -3, holdingDays: 10 }), { buyTransaction });
  assert.deepEqual(result.triggers, ['無明顯規則命中']);
});

test('attachLossReviews leaves winning matches untouched and does not mutate input', () => {
  const win = match({ id: 'win', realizedPnL: 5000, realizedPnLPercent: 5 });
  const loss = match({ id: 'loss', realizedPnLPercent: -10 });
  const original = [win, loss];
  const reviewed = attachLossReviews(original, {}, {});
  assert.equal(reviewed[0].review, null);
  assert.ok(reviewed[1].review.triggers.length > 0);
  assert.equal(original[1].review, null); // original untouched
});

test('summarizeLossPatterns counts trigger frequency across reviewed matches', () => {
  const buyTransaction = createTransaction({
    id: 'b1', stockId: '2330', stockName: '台積電', type: 'BUY',
    dateTime: '2026-01-01', price: 100, quantity: 1000,
  });
  const matches = [
    match({ id: 'm1', realizedPnLPercent: -10, holdingDays: 1 }),
    match({ id: 'm2', realizedPnLPercent: -9, holdingDays: 1 }),
  ];
  const reviewed = attachLossReviews(matches, { b1: buyTransaction }, {});
  const summary = summarizeLossPatterns(reviewed);
  const wideStop = summary.find((s) => s.trigger === '停損幅度偏大');
  const shortHold = summary.find((s) => s.trigger === '短時間反轉');
  assert.equal(wideStop.count, 2);
  assert.equal(shortHold.count, 2);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
