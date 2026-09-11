// Plain Node test runner. Run with: node tests/transactions.test.js
// Provides a minimal in-memory localStorage shim since storage.js targets
// the browser API directly (by design — it's the one place that touches it).
import assert from 'node:assert/strict';

globalThis.localStorage = (() => {
  let store = {};
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { store = {}; },
  };
})();

const { addTransaction, editTransaction, deleteTransaction, recompute } = await import(
  '../js/features/transactions.js'
);

let passed = 0;
let failed = 0;

function test(name, fn) {
  localStorage.clear();
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

test('addTransaction rejects invalid input without saving', () => {
  const { transaction, errors } = addTransaction({
    stockId: '',
    stockName: '',
    type: 'BUY',
    dateTime: '2026-01-01',
    price: 0,
    quantity: 0,
  });
  assert.equal(transaction, null);
  assert.ok(errors.length > 0);
  assert.equal(recompute().transactions.length, 0);
});

test('addTransaction rejects a SELL that would over-sell current holdings', () => {
  addTransaction({
    stockId: '2330', stockName: '台積電', type: 'BUY',
    dateTime: '2026-01-01', price: 100, quantity: 1000,
  });
  const { transaction, errors } = addTransaction({
    stockId: '2330', stockName: '台積電', type: 'SELL',
    dateTime: '2026-01-05', price: 110, quantity: 5000,
  });
  assert.equal(transaction, null);
  assert.ok(errors[0].includes('賣出數量超過庫存'));
  assert.equal(recompute().transactions.length, 1); // sell was not saved
});

test('editTransaction rejects an edit that would cause a downstream over-sell', () => {
  const buy = addTransaction({
    stockId: '2330', stockName: '台積電', type: 'BUY',
    dateTime: '2026-01-01', price: 100, quantity: 1000,
  }).transaction;
  addTransaction({
    stockId: '2330', stockName: '台積電', type: 'SELL',
    dateTime: '2026-01-05', price: 110, quantity: 800,
  });

  // shrinking the buy to 500 means the existing sell of 800 now over-sells
  const { transaction, errors } = editTransaction(buy.id, { quantity: 500 });
  assert.equal(transaction, null);
  assert.ok(errors[0].includes('賣出數量超過庫存'));

  // original buy quantity must be untouched
  const stillOriginal = recompute().transactions.find((t) => t.id === buy.id);
  assert.equal(stillOriginal.quantity, 1000);
});

test('editTransaction applies a valid change and downstream recompute reflects it', () => {
  const buy = addTransaction({
    stockId: '2330', stockName: '台積電', type: 'BUY',
    dateTime: '2026-01-01', price: 100, quantity: 1000,
  }).transaction;
  addTransaction({
    stockId: '2330', stockName: '台積電', type: 'SELL',
    dateTime: '2026-01-10', price: 130, quantity: 1000,
  });

  editTransaction(buy.id, { price: 110 });
  const { matches } = recompute();
  assert.equal(matches[0].buyPrice, 110);
  assert.equal(matches[0].realizedPnL, 20000);
});

test('deleteTransaction rejects deleting a Buy that a later Sell depends on', () => {
  const buy = addTransaction({
    stockId: '2330', stockName: '台積電', type: 'BUY',
    dateTime: '2026-01-01', price: 100, quantity: 1000,
  }).transaction;
  addTransaction({
    stockId: '2330', stockName: '台積電', type: 'SELL',
    dateTime: '2026-01-10', price: 130, quantity: 1000,
  });

  const { success, errors } = deleteTransaction(buy.id);
  assert.equal(success, false);
  assert.ok(errors[0].includes('賣出數量超過庫存'));
  assert.equal(recompute().transactions.length, 2); // nothing deleted
});

test('deleteTransaction succeeds when nothing depends on it', () => {
  const buy1 = addTransaction({
    stockId: '2330', stockName: '台積電', type: 'BUY',
    dateTime: '2026-01-01', price: 100, quantity: 500,
  }).transaction;
  addTransaction({
    stockId: '2330', stockName: '台積電', type: 'BUY',
    dateTime: '2026-01-02', price: 105, quantity: 500,
  });

  const { success } = deleteTransaction(buy1.id);
  assert.equal(success, true);
  assert.equal(recompute().transactions.length, 1);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
