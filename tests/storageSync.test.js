// Plain Node test runner. Run with: node tests/storageSync.test.js
// Exercises storage.js's GitHub-sync path (mocked fetch) — the
// conflict-retry logic, and that reads stay synchronous while only
// mutations touch the network.
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

const githubStore = await import('../js/data/githubStore.js');
const storage = await import('../js/data/storage.js');
const { createTransaction } = await import('../js/core/models.js');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  localStorage.clear();
  githubStore.setConfig({ token: 't', owner: 'me', repo: 'trade', path: 'data/store.json' });
  try {
    await fn();
    passed++;
    console.log(`  ok - ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL - ${name}`);
    console.log(`    ${err.stack}`);
  }
}

function b64(obj) {
  return Buffer.from(JSON.stringify(obj), 'utf-8').toString('base64');
}

function tx(id) {
  return createTransaction({
    id, stockId: '2330', stockName: '台積電', type: 'BUY',
    dateTime: '2026-01-01', price: 100, quantity: 1000,
  });
}

await test('initStore loads remote content and TransactionRepository.getAll reflects it synchronously', async () => {
  const remoteDoc = { version: '1.0', transactions: [tx('remote-1')], watchlist: [], manualPrices: {}, stockNotes: {} };
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ content: b64(remoteDoc), sha: 'sha-1' }) });

  const result = await storage.initStore();
  assert.equal(result.ok, true);
  assert.equal(result.source, 'remote');
  // Read is synchronous — no await needed, no network call happens here.
  assert.equal(storage.TransactionRepository.getAll().length, 1);
  assert.equal(storage.TransactionRepository.getAll()[0].id, 'remote-1');
});

await test('initStore falls back to local cache when GitHub is unreachable', async () => {
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  const result = await storage.initStore();
  assert.equal(result.ok, false);
  assert.equal(result.source, 'local-fallback');
  // Falls back to an empty document rather than crashing.
  assert.deepEqual(storage.TransactionRepository.getAll(), []);
});

await test('save() pushes to GitHub and updates the in-memory sha for the next write', async () => {
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    if (!opts || opts.method !== 'PUT') {
      return { ok: true, status: 200, json: async () => ({ content: b64({ version: '1.0', transactions: [], watchlist: [], manualPrices: {}, stockNotes: {} }), sha: 'sha-0' }) };
    }
    calls.push(JSON.parse(opts.body));
    return { ok: true, status: 200, json: async () => ({ content: { sha: `sha-${calls.length}` } }) };
  };
  await storage.initStore();
  const result = await storage.TransactionRepository.save(tx('t1'));
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].sha, 'sha-0'); // used the sha from initStore's read
});

await test('save() retries once after a 409 conflict, re-fetching a fresh sha', async () => {
  let putCount = 0;
  let getCount = 0;
  globalThis.fetch = async (url, opts) => {
    if (!opts || opts.method !== 'PUT') {
      getCount++;
      // First read (initStore) and the retry's re-fetch both land here.
      return { ok: true, status: 200, json: async () => ({ content: b64({ version: '1.0', transactions: [], watchlist: [], manualPrices: {}, stockNotes: {} }), sha: `sha-get-${getCount}` }) };
    }
    putCount++;
    if (putCount === 1) {
      return { ok: false, status: 409 }; // first write attempt conflicts
    }
    return { ok: true, status: 200, json: async () => ({ content: { sha: 'sha-after-retry' } }) };
  };

  await storage.initStore(); // getCount -> 1
  const result = await storage.TransactionRepository.save(tx('t1'));
  assert.equal(result.ok, true);
  assert.equal(result.retried, true);
  assert.equal(putCount, 2); // first conflicted, second (after re-fetch) succeeded
  assert.equal(getCount, 2); // initStore's read + the conflict re-fetch
  // The transaction we were trying to save is still present after the retry.
  assert.equal(storage.TransactionRepository.getAll().length, 1);
});

await test('saveMany persists once for the whole batch, not once per item', async () => {
  let putCount = 0;
  globalThis.fetch = async (url, opts) => {
    if (!opts || opts.method !== 'PUT') {
      return { ok: true, status: 200, json: async () => ({ content: b64({ version: '1.0', transactions: [], watchlist: [], manualPrices: {}, stockNotes: {} }), sha: 'sha-0' }) };
    }
    putCount++;
    return { ok: true, status: 200, json: async () => ({ content: { sha: 'sha-1' } }) };
  };
  await storage.initStore();
  await storage.TransactionRepository.saveMany([tx('a'), tx('b'), tx('c')]);
  assert.equal(putCount, 1);
  assert.equal(storage.TransactionRepository.getAll().length, 3);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
