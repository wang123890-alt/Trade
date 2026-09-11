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

const { getAllWatchItems, addWatchItem, removeWatchItem } = await import('../js/features/watchlist.js');

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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
