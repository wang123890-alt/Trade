// Plain Node test runner. Run with: node tests/importExport.test.js
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

const { buildExportPayload, validateImportPayload, importFromPayload } = await import('../js/data/importExport.js');
const { TransactionRepository, WatchlistRepository } = await import('../js/data/storage.js');
const { createTransaction, createWatchItem } = await import('../js/core/models.js');

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

function tx(id, overrides = {}) {
  return createTransaction({
    id, stockId: '2330', stockName: '台積電', type: 'BUY',
    dateTime: '2026-01-01', price: 100, quantity: 1000, ...overrides,
  });
}

test('buildExportPayload carries version, transactions, and watchlist', () => {
  TransactionRepository.save(tx('t1'));
  WatchlistRepository.save(createWatchItem({ id: 'w1', stockId: '2317', stockName: '鴻海' }));
  const payload = buildExportPayload();
  assert.equal(payload.version, '1.0');
  assert.equal(payload.transactions.length, 1);
  assert.equal(payload.watchlist.length, 1);
  assert.ok(payload.exportDate);
});

test('validateImportPayload rejects a payload missing required fields', () => {
  assert.ok(validateImportPayload({}).length > 0);
  assert.ok(validateImportPayload({ version: '1.0', transactions: [] }).length > 0); // missing watchlist
  assert.ok(validateImportPayload(null).length > 0);
  assert.equal(validateImportPayload({ version: '1.0', transactions: [], watchlist: [] }).length, 0);
});

test('importFromPayload adds new transactions and skips ones already present', () => {
  TransactionRepository.save(tx('existing'));
  const payload = {
    version: '1.0',
    transactions: [tx('existing'), tx('new-one', { price: 110 })],
    watchlist: [],
  };
  const result = importFromPayload(payload);
  assert.equal(result.success, true);
  assert.equal(result.added.transactions, 1);
  assert.equal(result.skipped.transactions, 1);
  assert.equal(TransactionRepository.getAll().length, 2);
});

test('importFromPayload rejects a malformed payload without touching storage', () => {
  TransactionRepository.save(tx('existing'));
  const result = importFromPayload({ version: '1.0' }); // missing transactions/watchlist arrays
  assert.equal(result.success, false);
  assert.ok(result.errors.length > 0);
  assert.equal(TransactionRepository.getAll().length, 1); // untouched
});

test('importFromPayload warns (but does not block) when the merged history over-sells', () => {
  const payload = {
    version: '1.0',
    transactions: [
      tx('b1', { type: 'BUY', dateTime: '2026-01-01', quantity: 500 }),
      tx('s1', { type: 'SELL', dateTime: '2026-01-05', quantity: 1000 }), // over-sells relative to b1 alone
    ],
    watchlist: [],
  };
  const result = importFromPayload(payload);
  assert.equal(result.success, true); // still imported — no rollback mechanism
  assert.equal(result.added.transactions, 2);
  assert.ok(result.warnings.length > 0);
  assert.ok(result.warnings[0].includes('賣出數量超過庫存'));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
