// Plain Node test runner, zero dependencies (consistent with the no-build
// front-end). Run with: node tests/fifo.test.js
import assert from 'node:assert/strict';
import { runFifo, OverSellError } from '../js/core/fifo.js';
import { createTransaction } from '../js/core/models.js';

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
    console.log(`    ${err.message}`);
  }
}

function tx(overrides) {
  return createTransaction({
    id: overrides.id ?? `tx_${Math.random()}`,
    stockId: overrides.stockId ?? '2330',
    stockName: overrides.stockName ?? '台積電',
    type: overrides.type,
    dateTime: overrides.dateTime,
    price: overrides.price,
    quantity: overrides.quantity,
    fee: overrides.fee ?? 0,
    tax: overrides.tax ?? 0,
    createdAt: overrides.createdAt ?? overrides.dateTime,
  });
}

// Case 1: simple full buy/sell
test('Case 1: Buy 1000@100 -> Sell 1000@110 fully closes, no open lots', () => {
  const txs = [
    tx({ id: 'b1', type: 'BUY', dateTime: '2026-01-01', price: 100, quantity: 1000 }),
    tx({ id: 's1', type: 'SELL', dateTime: '2026-01-05', price: 110, quantity: 1000 }),
  ];
  const { matches, openLots, errors } = runFifo(txs);
  assert.equal(errors.length, 0);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].quantity, 1000);
  assert.equal(matches[0].buyPrice, 100);
  assert.equal(matches[0].sellPrice, 110);
  assert.equal(matches[0].realizedPnL, 10000);
  assert.equal(openLots['2330'].length, 0);
});

// Case 2: partial sell leaves remainder
test('Case 2: Buy 1000@100 -> Sell 500@110 leaves 500@100 open', () => {
  const txs = [
    tx({ id: 'b1', type: 'BUY', dateTime: '2026-01-01', price: 100, quantity: 1000 }),
    tx({ id: 's1', type: 'SELL', dateTime: '2026-01-05', price: 110, quantity: 500 }),
  ];
  const { matches, openLots } = runFifo(txs);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].quantity, 500);
  assert.equal(openLots['2330'].length, 1);
  assert.equal(openLots['2330'][0].remainingQty, 500);
  assert.equal(openLots['2330'][0].price, 100);
});

// Case 3: two buys, sell spans both lots FIFO order
test('Case 3: Buy 1000@100, Buy 1000@120 -> Sell 1500@130 matches FIFO across both lots', () => {
  const txs = [
    tx({ id: 'b1', type: 'BUY', dateTime: '2026-01-01', price: 100, quantity: 1000 }),
    tx({ id: 'b2', type: 'BUY', dateTime: '2026-01-02', price: 120, quantity: 1000 }),
    tx({ id: 's1', type: 'SELL', dateTime: '2026-01-10', price: 130, quantity: 1500 }),
  ];
  const { matches, openLots } = runFifo(txs);
  assert.equal(matches.length, 2);
  assert.equal(matches[0].buyPrice, 100);
  assert.equal(matches[0].quantity, 1000);
  assert.equal(matches[1].buyPrice, 120);
  assert.equal(matches[1].quantity, 500);
  assert.equal(openLots['2330'].length, 1);
  assert.equal(openLots['2330'][0].remainingQty, 500);
  assert.equal(openLots['2330'][0].price, 120);
});

// Case 4: same-day multiple buys then a sell — order within the day must
// follow createdAt (entry order), not be arbitrary.
test('Case 4: same-day 09:00 Buy, 10:00 Buy, 11:00 Sell resolves in entry order', () => {
  const txs = [
    tx({ id: 'b1', type: 'BUY', dateTime: '2026-01-01T09:00:00', price: 100, quantity: 500 }),
    tx({ id: 'b2', type: 'BUY', dateTime: '2026-01-01T10:00:00', price: 105, quantity: 500 }),
    tx({ id: 's1', type: 'SELL', dateTime: '2026-01-01T11:00:00', price: 110, quantity: 600 }),
  ];
  const { matches } = runFifo(txs);
  assert.equal(matches.length, 2);
  assert.equal(matches[0].buyPrice, 100);
  assert.equal(matches[0].quantity, 500);
  assert.equal(matches[1].buyPrice, 105);
  assert.equal(matches[1].quantity, 100);
});

// Case 5: transactions supplied out of chronological order must still sort
test('Case 5: out-of-order input (Sell before Buy in array) is sorted by dateTime first', () => {
  const txs = [
    tx({ id: 's1', type: 'SELL', dateTime: '2026-01-10', price: 110, quantity: 1000 }),
    tx({ id: 'b1', type: 'BUY', dateTime: '2026-01-01', price: 100, quantity: 1000 }),
  ];
  const { matches, errors } = runFifo(txs);
  assert.equal(errors.length, 0);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].realizedPnL, 10000);
});

// Case 6: deleting a historical transaction means re-running FIFO on the
// remaining full list — simulated here by calling runFifo twice.
test('Case 6: deleting the first Buy and re-running FIFO fully rebuilds matches', () => {
  const original = [
    tx({ id: 'b1', type: 'BUY', dateTime: '2026-01-01', price: 100, quantity: 1000 }),
    tx({ id: 'b2', type: 'BUY', dateTime: '2026-01-02', price: 120, quantity: 1000 }),
    tx({ id: 's1', type: 'SELL', dateTime: '2026-01-10', price: 130, quantity: 1000 }),
  ];
  const before = runFifo(original);
  assert.equal(before.matches[0].buyPrice, 100);

  // user deletes b1 -> full transaction list is rebuilt from scratch
  const afterDelete = original.filter((t) => t.id !== 'b1');
  const after = runFifo(afterDelete);
  assert.equal(after.matches.length, 1);
  assert.equal(after.matches[0].buyPrice, 120);
  assert.equal(after.matches[0].quantity, 1000);
});

// Case 7: editing a historical transaction's price changes downstream P&L
// when the full list is recomputed.
test('Case 7: editing a Buy price changes realizedPnL after full recompute', () => {
  const original = [
    tx({ id: 'b1', type: 'BUY', dateTime: '2026-01-01', price: 100, quantity: 1000 }),
    tx({ id: 's1', type: 'SELL', dateTime: '2026-01-10', price: 130, quantity: 1000 }),
  ];
  const before = runFifo(original);
  assert.equal(before.matches[0].realizedPnL, 30000);

  const edited = original.map((t) => (t.id === 'b1' ? { ...t, price: 110 } : t));
  const after = runFifo(edited);
  assert.equal(after.matches[0].realizedPnL, 20000);
});

// Case 8: editing quantity likewise flows through on full recompute.
test('Case 8: editing a Buy quantity changes matched quantity after full recompute', () => {
  const original = [
    tx({ id: 'b1', type: 'BUY', dateTime: '2026-01-01', price: 100, quantity: 1000 }),
    tx({ id: 's1', type: 'SELL', dateTime: '2026-01-10', price: 130, quantity: 800 }),
  ];
  const before = runFifo(original);
  assert.equal(before.openLots['2330'][0].remainingQty, 200);

  const edited = original.map((t) => (t.id === 'b1' ? { ...t, quantity: 500 } : t));
  // now selling 800 against only 500 available -> over-sell error, matches skipped
  const after = runFifo(edited);
  assert.equal(after.errors.length, 1);
  assert.ok(after.errors[0].error instanceof OverSellError);
});

// Case 9: selling more than held must error, never create negative inventory.
test('Case 9: Sell more than held raises OverSellError, no negative inventory', () => {
  const txs = [
    tx({ id: 'b1', type: 'BUY', dateTime: '2026-01-01', price: 100, quantity: 1000 }),
    tx({ id: 's1', type: 'SELL', dateTime: '2026-01-10', price: 130, quantity: 1500 }),
  ];
  const { matches, openLots, errors } = runFifo(txs);
  assert.equal(matches.length, 0);
  assert.equal(errors.length, 1);
  assert.ok(errors[0].error instanceof OverSellError);
  assert.equal(errors[0].error.available, 1000);
  assert.equal(errors[0].error.requested, 1500);
  // inventory must remain untouched, never negative
  assert.equal(openLots['2330'][0].remainingQty, 1000);
});

// Fee/tax allocation sanity check
test('Fee/tax: fees and tax are allocated proportionally into realizedPnL', () => {
  const txs = [
    tx({ id: 'b1', type: 'BUY', dateTime: '2026-01-01', price: 100, quantity: 1000, fee: 100 }),
    tx({ id: 's1', type: 'SELL', dateTime: '2026-01-10', price: 110, quantity: 1000, fee: 110, tax: 30 }),
  ];
  const { matches } = runFifo(txs);
  // buyCost = 1000*100 + 100(fee) = 100100
  // sellIncome = 1000*110 - 110(fee) - 30(tax) = 109860
  // realizedPnL = 109860 - 100100 = 9760
  assert.equal(matches[0].buyCost, 100100);
  assert.equal(matches[0].sellIncome, 109860);
  assert.equal(matches[0].realizedPnL, 9760);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
