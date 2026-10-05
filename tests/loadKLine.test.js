// Plain Node test runner. Run with: node tests/loadKLine.test.js
// loadKLineFast() (js/data/loadKLine.js) is the code path the app's chart
// screens actually call (stock-detail/review/watchlist views) — the older
// TwseDailyKLineProvider.getKLine() month-by-month history fetch it used to
// go through is currently unused (superseded by Yahoo→FinMind history +
// TWSE MIS's getTodayBar() for just today's still-open bar). Tested here
// against a mocked global.fetch so `node tests/*.test.js` never depends on
// network access. Every test uses its own stockId — loadKLineFast memoizes
// by stockId for the module's lifetime, so reusing one across tests would
// silently serve an earlier test's cached result (see twseDailyKLine.test.js
// for the same footgun already hit once).
import assert from 'node:assert/strict';
import { loadKLineFast, CACHE_TTL_MS } from '../js/data/loadKLine.js';

let passed = 0;
let failed = 0;

async function testAsync(name, fn) {
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

function yahooChartResponse(bars) {
  return {
    ok: true,
    text: async () => JSON.stringify({
      chart: { result: [{
        timestamp: bars.map((b) => new Date(`${b.date}T00:00:00Z`).getTime() / 1000),
        indicators: { quote: [{
          open: bars.map((b) => b.open), high: bars.map((b) => b.high),
          low: bars.map((b) => b.low), close: bars.map((b) => b.close), volume: bars.map((b) => b.volume),
        }] },
      }] },
    }),
  };
}

const finmindOk = (bars) => ({
  ok: true,
  text: async () => JSON.stringify({
    status: 200,
    data: bars.map((b) => ({ date: b.date, open: b.open, max: b.high, min: b.low, close: b.close, Trading_Volume: b.volume })),
  }),
});

const emptyMis = { ok: true, text: async () => JSON.stringify({ msgArray: [] }) };
const misBar = (date, close) => ({
  ok: true,
  text: async () => JSON.stringify({ msgArray: [{ d: date.replace(/-/g, ''), z: String(close), o: String(close), trade: {} }] }),
});

await testAsync('loadKLineFast prefers Yahoo, appends 證交所今日 to the source label when MIS has a today bar', async () => {
  globalThis.fetch = async (url) => {
    if (url.includes('.TW?') || url.includes('.TWO?') || url.includes('r.jina.ai') || url.includes('allorigins')) {
      return yahooChartResponse([{ date: '2026-09-01', open: 10, high: 11, low: 9, close: 10.5, volume: 1000 }]);
    }
    if (url.includes('getStockInfo.jsp')) return misBar('2026-09-02', 10.8);
    return { ok: false };
  };
  const { bars, source } = await loadKLineFast('2330a');
  assert.equal(bars.length, 2);
  assert.equal(bars[1].date, '2026-09-02');
  assert.equal(bars[1].close, 10.8);
  assert.equal(source, '雅虎股市 · 證交所今日');
});

await testAsync('loadKLineFast falls back to FinMind when Yahoo has nothing, with no 證交所今日 suffix when MIS is empty', async () => {
  globalThis.fetch = async (url) => {
    if (url.includes('finmindtrade.com')) return finmindOk([{ date: '2026-09-01', open: 5, high: 5.5, low: 4.5, close: 5, volume: 500 }]);
    if (url.includes('getStockInfo.jsp')) return emptyMis;
    return { ok: false }; // Yahoo (direct + every proxy) comes up empty
  };
  const { bars, source } = await loadKLineFast('2330b');
  assert.equal(bars.length, 1);
  assert.equal(bars[0].close, 5);
  assert.equal(source, 'FinMind');
});

await testAsync("loadKLineFast still returns history when today's MIS bar fetch itself throws", async () => {
  globalThis.fetch = async (url) => {
    if (url.includes('.TW?') || url.includes('.TWO?') || url.includes('r.jina.ai') || url.includes('allorigins')) {
      return yahooChartResponse([{ date: '2026-09-01', open: 1, high: 1, low: 1, close: 1, volume: 100 }]);
    }
    if (url.includes('getStockInfo.jsp')) throw new TypeError('network error');
    return { ok: false };
  };
  const { bars, source } = await loadKLineFast('2330c');
  assert.equal(bars.length, 1);
  assert.equal(source, '雅虎股市'); // no 證交所今日 suffix — history alone is still usable
});

await testAsync('loadKLineFast returns an empty result without touching fetch for a blank stockId', async () => {
  let called = false;
  globalThis.fetch = async () => { called = true; return { ok: false }; };
  const result = await loadKLineFast('  ');
  assert.deepEqual(result, { bars: [], source: '' });
  assert.equal(called, false);
});

await testAsync('loadKLineFast caches by stockId: a second call for the same stock does not fetch again', async () => {
  let fetchCount = 0;
  globalThis.fetch = async (url) => {
    fetchCount++;
    if (url.includes('.TW?') || url.includes('.TWO?') || url.includes('r.jina.ai') || url.includes('allorigins')) {
      return yahooChartResponse([{ date: '2026-09-01', open: 1, high: 1, low: 1, close: 1, volume: 100 }]);
    }
    if (url.includes('getStockInfo.jsp')) return emptyMis;
    return { ok: false };
  };
  const first = await loadKLineFast('2330d');
  const countAfterFirst = fetchCount;
  assert.ok(countAfterFirst > 0, 'first call should hit fetch');
  const second = await loadKLineFast('2330d');
  assert.equal(fetchCount, countAfterFirst, 'second call for the same stockId should be served from cache, not refetch');
  assert.deepEqual(second, first);
});

await testAsync('loadKLineFast refetches once the cache entry is older than CACHE_TTL_MS (2026-10-05: price updated but the chart stayed stale — this cache having no expiry at all was the root cause)', async () => {
  let fetchCount = 0;
  globalThis.fetch = async (url) => {
    fetchCount++;
    if (url.includes('.TW?') || url.includes('.TWO?') || url.includes('r.jina.ai') || url.includes('allorigins')) {
      return yahooChartResponse([{ date: '2026-09-01', open: 1, high: 1, low: 1, close: 1, volume: 100 }]);
    }
    if (url.includes('getStockInfo.jsp')) return emptyMis;
    return { ok: false };
  };
  const realNow = Date.now;
  try {
    Date.now = () => 1_000_000_000_000;
    await loadKLineFast('2330e');
    const countAfterFirst = fetchCount;
    assert.ok(countAfterFirst > 0, 'first call should hit fetch');

    Date.now = () => 1_000_000_000_000 + CACHE_TTL_MS - 1;
    await loadKLineFast('2330e');
    assert.equal(fetchCount, countAfterFirst, 'still within TTL — should be served from cache');

    Date.now = () => 1_000_000_000_000 + CACHE_TTL_MS + 1;
    await loadKLineFast('2330e');
    assert.ok(fetchCount > countAfterFirst, 'past TTL — should refetch, not keep serving the stale entry forever');
  } finally {
    Date.now = realNow;
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
