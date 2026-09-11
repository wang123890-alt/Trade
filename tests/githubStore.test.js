// Plain Node test runner. Run with: node tests/githubStore.test.js
// Mocks global.fetch — no real network calls, no dependency on GitHub being
// reachable from this environment.
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

let passed = 0;
let failed = 0;

function test(name, fn) {
  localStorage.clear();
  githubStore.setConfig({ token: 'test-token', owner: 'me', repo: 'trade', path: 'data/store.json' });
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log(`  ok - ${name}`); })
    .catch((err) => { failed++; console.log(`  FAIL - ${name}`); console.log(`    ${err.stack}`); });
}

function mockFetch(handler) {
  globalThis.fetch = handler;
}

await test('isConfigured is false until setConfig is called', () => {
  githubStore.clearConfig();
  assert.equal(githubStore.isConfigured(), false);
  githubStore.setConfig({ token: 't', owner: 'o', repo: 'r', path: 'p.json' });
  assert.equal(githubStore.isConfigured(), true);
});

await test('fetchRemote decodes base64 UTF-8 content and returns the sha', async () => {
  const data = { transactions: [{ stockName: '台積電' }] };
  const b64 = Buffer.from(JSON.stringify(data), 'utf-8').toString('base64');
  mockFetch(async (url, opts) => {
    assert.ok(url.includes('/repos/me/trade/contents/data/store.json'));
    assert.equal(opts.headers.Authorization, 'Bearer test-token');
    return { ok: true, status: 200, json: async () => ({ content: b64, sha: 'sha-123' }) };
  });
  const { content, sha } = await githubStore.fetchRemote();
  assert.deepEqual(content, data);
  assert.equal(sha, 'sha-123');
});

await test('fetchRemote returns null content on 404 (file does not exist yet)', async () => {
  mockFetch(async () => ({ ok: false, status: 404 }));
  const { content, sha } = await githubStore.fetchRemote();
  assert.equal(content, null);
  assert.equal(sha, null);
});

await test('fetchRemote throws GitHubStoreError on 401/403', async () => {
  mockFetch(async () => ({ ok: false, status: 401 }));
  await assert.rejects(() => githubStore.fetchRemote(), githubStore.GitHubStoreError);
});

await test('fetchRemote throws GitHubStoreError when the network call itself fails', async () => {
  mockFetch(async () => { throw new TypeError('Failed to fetch'); });
  await assert.rejects(() => githubStore.fetchRemote(), githubStore.GitHubStoreError);
});

await test('pushRemote sends base64-encoded UTF-8 content and includes sha when updating', async () => {
  let capturedBody;
  mockFetch(async (url, opts) => {
    capturedBody = JSON.parse(opts.body);
    return { ok: true, status: 200, json: async () => ({ content: { sha: 'new-sha' } }) };
  });
  const data = { note: '中文測試' };
  const newSha = await githubStore.pushRemote(data, 'old-sha');
  assert.equal(newSha, 'new-sha');
  assert.equal(capturedBody.sha, 'old-sha');
  const decoded = JSON.parse(Buffer.from(capturedBody.content, 'base64').toString('utf-8'));
  assert.deepEqual(decoded, data);
});

await test('pushRemote omits sha on first write (no existing file)', async () => {
  let capturedBody;
  mockFetch(async (url, opts) => {
    capturedBody = JSON.parse(opts.body);
    return { ok: true, status: 200, json: async () => ({ content: { sha: 'first-sha' } }) };
  });
  await githubStore.pushRemote({ a: 1 }, null);
  assert.equal('sha' in capturedBody, false);
});

await test('pushRemote throws GitHubConflictError on 409', async () => {
  mockFetch(async () => ({ ok: false, status: 409 }));
  await assert.rejects(() => githubStore.pushRemote({}, 'stale-sha'), githubStore.GitHubConflictError);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
