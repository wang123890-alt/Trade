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
//
// 2026-10-07: loadKLineFast() was rewritten to stale-while-revalidate (show
// the old chart immediately, race a background refetch, repaint when it
// lands) plus a localStorage disk layer — see the history comment at the top
// of js/data/loadKLine.js. `localStorage` is undefined in this plain-Node
// test run, so the disk layer silently no-ops throughout (same as it does in
// any environment without it); these tests only exercise the memory layer.
import assert from 'node:assert/strict';
import { loadKLineFast, invalidateKLineCache, CACHE_TTL_MS } from '../js/data/loadKLine.js';

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

await testAsync('loadKLineFast still serves from cache within CACHE_TTL_MS (2026-10-05: price updated but the chart stayed stale — this cache having no expiry at all was the original root cause)', async () => {
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
    const stillFresh = await loadKLineFast('2330e');
    assert.equal(fetchCount, countAfterFirst, 'still within TTL — should be served from cache, no fetch at all');
    assert.equal(stillFresh.refresh, undefined, 'not stale yet — no background refresh attached');
  } finally {
    Date.now = realNow;
  }
});

await testAsync('loadKLineFast goes stale-while-revalidate once past CACHE_TTL_MS: returns the old bars immediately, plus a refresh promise, instead of blocking the caller on a fresh fetch (2026-10-07 rewrite, replacing block-until-fresh)', async () => {
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
    const first = await loadKLineFast('2330f');
    assert.equal(first.refresh, undefined, 'fresh on first fetch — no refresh attached yet');
    const countAfterFirst = fetchCount;
    assert.ok(countAfterFirst > 0);

    Date.now = () => 1_000_000_000_000 + CACHE_TTL_MS + 1;
    const stale = await loadKLineFast('2330f');
    assert.deepEqual(stale.bars, first.bars, 'returns the old bars immediately, not blocked on the new fetch finishing');
    assert.ok(stale.refresh, 'past CACHE_TTL_MS — comes back with a refresh promise for the caller to await and repaint');
    assert.ok(fetchCount > countAfterFirst, 'the background refetch should already have been kicked off synchronously');

    const refreshed = await stale.refresh;
    assert.ok(refreshed?.bars?.length > 0, 'the refresh promise resolves to a real result');
  } finally {
    Date.now = realNow;
  }
});

await testAsync('invalidateKLineCache(stockId) forces the next loadKLineFast for that stock to do a real fetch, without touching other stocks\' cached entries', async () => {
  let fetchCount = 0;
  globalThis.fetch = async (url) => {
    fetchCount++;
    if (url.includes('.TW?') || url.includes('.TWO?') || url.includes('r.jina.ai') || url.includes('allorigins')) {
      return yahooChartResponse([{ date: '2026-09-01', open: 1, high: 1, low: 1, close: 1, volume: 100 }]);
    }
    if (url.includes('getStockInfo.jsp')) return emptyMis;
    return { ok: false };
  };
  await loadKLineFast('2330g');
  await loadKLineFast('2330h');
  const countAfterBoth = fetchCount;

  invalidateKLineCache('2330g');
  const untouched = await loadKLineFast('2330h');
  assert.equal(fetchCount, countAfterBoth, '2330h is untouched by invalidating 2330g — still served from cache');
  assert.equal(untouched.refresh, undefined);

  const refetched = await loadKLineFast('2330g');
  assert.ok(fetchCount > countAfterBoth, '2330g was invalidated — this call should have done a real fetch');
  assert.equal(refetched.refresh, undefined, 'a forced fresh fetch, not a stale-while-revalidate response');
});

await testAsync('invalidateKLineCache() with no stockId clears every cached entry', async () => {
  let fetchCount = 0;
  globalThis.fetch = async (url) => {
    fetchCount++;
    if (url.includes('.TW?') || url.includes('.TWO?') || url.includes('r.jina.ai') || url.includes('allorigins')) {
      return yahooChartResponse([{ date: '2026-09-01', open: 1, high: 1, low: 1, close: 1, volume: 100 }]);
    }
    if (url.includes('getStockInfo.jsp')) return emptyMis;
    return { ok: false };
  };
  await loadKLineFast('2330i');
  await loadKLineFast('2330j');
  const countAfterBoth = fetchCount;

  invalidateKLineCache();
  await loadKLineFast('2330i');
  await loadKLineFast('2330j');
  assert.ok(fetchCount > countAfterBoth, 'clearing the whole cache should force both stocks to refetch');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
