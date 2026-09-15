// Plain Node test runner. Run with: node tests/review.test.js
import assert from 'node:assert/strict';
import { RuleBasedProvider, computeBuyFacts, attachLossReviews, summarizeLossPatterns, NO_PATTERN_TRIGGER } from '../js/features/review.js';
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

test('analyzeLoss flags an oversized loss when loss percent breaches threshold', () => {
  const result = RuleBasedProvider.analyzeLoss(match({ realizedPnLPercent: -10 }), {});
  assert.ok(result.triggers.includes('虧損幅度偏大'));
});

test('analyzeLoss flags short-hold reversal', () => {
  const result = RuleBasedProvider.analyzeLoss(match({ holdingDays: 1, realizedPnLPercent: -3 }), {});
  assert.ok(result.triggers.includes('短時間反轉'));
});

test('analyzeLoss never flags on note text alone: a buy with no written reason triggers nothing by itself', () => {
  // Guards the reason the 未設定停損條件 rule was removed: it keyed off
  // whether the word 停損 appeared in free text, so every imported row
  // (which has no hand-written reason) tripped it — 44/44 on real data.
  const buyTransaction = createTransaction({
    id: 'b1', stockId: '2330', stockName: '台積電', type: 'BUY',
    dateTime: '2026-01-01', price: 100, quantity: 1000, reason: '', note: '元大對帳單匯入',
  });
  const result = RuleBasedProvider.analyzeLoss(match({ realizedPnLPercent: -3, holdingDays: 10 }), { buyTransaction });
  assert.deepEqual(result.triggers, [NO_PATTERN_TRIGGER]);
});

test('analyzeLoss flags averaging down into a losing position', () => {
  const result = RuleBasedProvider.analyzeLoss(
    match({ realizedPnLPercent: -3, holdingDays: 10 }),
    { buyFacts: { averagedDown: true, positionWeight: 0.1, daysSincePriorLoss: null } }
  );
  assert.ok(result.triggers.includes('加碼攤平'));
});

test('analyzeLoss flags an oversized single position and names the actual weight', () => {
  const result = RuleBasedProvider.analyzeLoss(
    match({ realizedPnLPercent: -3, holdingDays: 10 }),
    { buyFacts: { averagedDown: false, positionWeight: 0.42, daysSincePriorLoss: null } }
  );
  assert.ok(result.triggers.includes('單一部位過重'));
  assert.ok(result.suggestions.some((s) => s.includes('42%')));
});

test('analyzeLoss does not flag a position weight at or below the threshold', () => {
  const result = RuleBasedProvider.analyzeLoss(
    match({ realizedPnLPercent: -3, holdingDays: 10 }),
    { buyFacts: { averagedDown: false, positionWeight: 0.25, daysSincePriorLoss: null } }
  );
  assert.ok(!result.triggers.includes('單一部位過重'));
});

test('analyzeLoss flags buying the same stock back soon after a losing exit', () => {
  const result = RuleBasedProvider.analyzeLoss(
    match({ realizedPnLPercent: -3, holdingDays: 10 }),
    { buyFacts: { averagedDown: false, positionWeight: 0.1, daysSincePriorLoss: 4 } }
  );
  assert.ok(result.triggers.includes('虧損後迅速回補'));
});

test('analyzeLoss does not flag a re-entry long after the earlier loss', () => {
  const result = RuleBasedProvider.analyzeLoss(
    match({ realizedPnLPercent: -3, holdingDays: 10 }),
    { buyFacts: { averagedDown: false, positionWeight: 0.1, daysSincePriorLoss: 40 } }
  );
  assert.ok(!result.triggers.includes('虧損後迅速回補'));
});

test('computeBuyFacts marks a buy below the running average cost as averaging down', () => {
  const txs = [
    createTransaction({ id: 'b1', stockId: '2330', stockName: '台積電', type: 'BUY', dateTime: '2026-01-01', price: 100, quantity: 1000 }),
    createTransaction({ id: 'b2', stockId: '2330', stockName: '台積電', type: 'BUY', dateTime: '2026-01-05', price: 80, quantity: 1000 }),
    createTransaction({ id: 'b3', stockId: '2330', stockName: '台積電', type: 'BUY', dateTime: '2026-01-08', price: 120, quantity: 1000 }),
  ];
  const facts = computeBuyFacts(txs, []);
  assert.equal(facts.b1.averagedDown, false); // nothing held yet
  assert.equal(facts.b2.averagedDown, true); // 80 < average 100
  assert.equal(facts.b3.averagedDown, false); // 120 > average 90
});

test('computeBuyFacts measures position weight against the whole portfolio at that moment', () => {
  const txs = [
    createTransaction({ id: 'a1', stockId: '2317', stockName: '鴻海', type: 'BUY', dateTime: '2026-01-01', price: 100, quantity: 1000 }),
    createTransaction({ id: 'b1', stockId: '2330', stockName: '台積電', type: 'BUY', dateTime: '2026-01-02', price: 300, quantity: 1000 }),
  ];
  const facts = computeBuyFacts(txs, []);
  assert.equal(facts.a1.positionWeight, 1); // only holding at the time
  assert.equal(facts.b1.positionWeight, 0.75); // 300k of a 400k book
});

test('computeBuyFacts dates a re-entry from the most recent LOSING sell of that stock', () => {
  const txs = [
    createTransaction({ id: 'b1', stockId: '2330', stockName: '台積電', type: 'BUY', dateTime: '2026-01-01', price: 100, quantity: 1000 }),
    createTransaction({ id: 's1', stockId: '2330', stockName: '台積電', type: 'SELL', dateTime: '2026-01-10', price: 90, quantity: 1000 }),
    createTransaction({ id: 'b2', stockId: '2330', stockName: '台積電', type: 'BUY', dateTime: '2026-01-13', price: 95, quantity: 1000 }),
  ];
  const losingMatch = createTradeMatch({
    id: 'm1', buyTransactionId: 'b1', sellTransactionId: 's1', stockId: '2330',
    quantity: 1000, buyPrice: 100, sellPrice: 90, buyCost: 100000, sellIncome: 90000,
    realizedPnL: -10000, realizedPnLPercent: -10, holdingDays: 9, closedAt: '2026-01-10',
  });
  const facts = computeBuyFacts(txs, [losingMatch]);
  assert.equal(facts.b1.daysSincePriorLoss, null); // nothing before it
  assert.equal(facts.b2.daysSincePriorLoss, 3);
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
  assert.deepEqual(result.triggers, [NO_PATTERN_TRIGGER]);
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
  const wideStop = summary.find((s) => s.trigger === '虧損幅度偏大');
  const shortHold = summary.find((s) => s.trigger === '短時間反轉');
  assert.equal(wideStop.count, 2);
  assert.equal(shortHold.count, 2);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
