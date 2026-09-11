// Plain Node test runner. Run with: node tests/watchlist.test.js
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

const { getAllWatchItems, addWatchItem, removeWatchItem, autoAddFullyClosedFromTransactions } =
  await import('../js/features/watchlist.js');
const { createTransaction } = await import('../js/core/models.js');

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

test('addWatchItem rejects blank stockId/stockName', () => {
  const { watchItem, errors } = addWatchItem({ stockId: '', stockName: '' });
  assert.equal(watchItem, null);
  assert.ok(errors.length > 0);
});

test('addWatchItem adds a manual entry', () => {
  const { watchItem, errors } = addWatchItem({ stockId: '2330', stockName: '台積電' });
  assert.equal(errors.length, 0);
  assert.equal(watchItem.stockId, '2330');
  assert.equal(watchItem.source, 'manual');
  assert.equal(getAllWatchItems().length, 1);
});

test('addWatchItem records sold price/date when added from a sell flow', () => {
  const { watchItem } = addWatchItem({
    stockId: '2330', stockName: '台積電', source: 'sold', soldPrice: 168, soldAt: '2026-09-05',
  });
  assert.equal(watchItem.source, 'sold');
  assert.equal(watchItem.soldPrice, 168);
  assert.equal(watchItem.soldAt, '2026-09-05');
});

test('addWatchItem rejects a duplicate stockId', () => {
  addWatchItem({ stockId: '2330', stockName: '台積電' });
  const { watchItem, errors } = addWatchItem({ stockId: '2330', stockName: '台積電' });
  assert.equal(watchItem, null);
  assert.ok(errors[0].includes('已經在觀察名單中'));
  assert.equal(getAllWatchItems().length, 1);
});

test('removeWatchItem deletes the entry', () => {
  const { watchItem } = addWatchItem({ stockId: '2330', stockName: '台積電' });
  removeWatchItem(watchItem.id);
  assert.equal(getAllWatchItems().length, 0);
});

function tx(overrides) {
  return createTransaction({
    id: overrides.id ?? `tx_${Math.random()}`,
    stockId: overrides.stockId ?? '2330',
    stockName: overrides.stockName ?? '台積電',
    type: overrides.type,
    dateTime: overrides.dateTime,
    price: overrides.price,
    quantity: overrides.quantity,
  });
}

test('autoAddFullyClosedFromTransactions adds a stock with no remaining position', () => {
  const txs = [
    tx({ id: 'b1', stockId: '2330', stockName: '台積電', type: 'BUY', dateTime: '2026-01-01', price: 100, quantity: 1000 }),
    tx({ id: 's1', stockId: '2330', stockName: '台積電', type: 'SELL', dateTime: '2026-01-10', price: 120, quantity: 1000 }),
  ];
  const added = autoAddFullyClosedFromTransactions(txs);
  assert.equal(added.length, 1);
  assert.equal(added[0].stockId, '2330');
  assert.equal(added[0].source, 'sold');
  assert.equal(added[0].soldPrice, 120);
  assert.equal(added[0].soldAt, '2026-01-10');
  assert.equal(getAllWatchItems().length, 1);
});

test('autoAddFullyClosedFromTransactions skips a stock that still has an open position', () => {
  const txs = [
    tx({ id: 'b1', stockId: '2330', stockName: '台積電', type: 'BUY', dateTime: '2026-01-01', price: 100, quantity: 1000 }),
    tx({ id: 's1', stockId: '2330', stockName: '台積電', type: 'SELL', dateTime: '2026-01-10', price: 120, quantity: 400 }),
  ];
  const added = autoAddFullyClosedFromTransactions(txs);
  assert.equal(added.length, 0);
  assert.equal(getAllWatchItems().length, 0);
});

test('autoAddFullyClosedFromTransactions skips a stock already in the watchlist', () => {
  addWatchItem({ stockId: '2330', stockName: '台積電' });
  const txs = [
    tx({ id: 'b1', stockId: '2330', stockName: '台積電', type: 'BUY', dateTime: '2026-01-01', price: 100, quantity: 1000 }),
    tx({ id: 's1', stockId: '2330', stockName: '台積電', type: 'SELL', dateTime: '2026-01-10', price: 120, quantity: 1000 }),
  ];
  const added = autoAddFullyClosedFromTransactions(txs);
  assert.equal(added.length, 0);
  assert.equal(getAllWatchItems().length, 1); // still just the manually-added one
});

test('autoAddFullyClosedFromTransactions uses the most recent SELL for sold price/date', () => {
  const txs = [
    tx({ id: 'b1', stockId: '2330', stockName: '台積電', type: 'BUY', dateTime: '2026-01-01', price: 100, quantity: 1000 }),
    tx({ id: 's1', stockId: '2330', stockName: '台積電', type: 'SELL', dateTime: '2026-01-05', price: 110, quantity: 500 }),
    tx({ id: 's2', stockId: '2330', stockName: '台積電', type: 'SELL', dateTime: '2026-01-10', price: 120, quantity: 500 }),
  ];
  const added = autoAddFullyClosedFromTransactions(txs);
  assert.equal(added.length, 1);
  assert.equal(added[0].soldPrice, 120);
  assert.equal(added[0].soldAt, '2026-01-10');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
