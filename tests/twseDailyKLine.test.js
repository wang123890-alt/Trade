// Plain Node test runner. Run with: node tests/twseDailyKLine.test.js
// TwseDailyKLineProvider's live calls (STOCK_DAY, st43, MIS) were verified
// manually against the real endpoints; here they're tested against a mocked
// global.fetch so `node tests/*.test.js` never depends on network access.
// getKLine() fetches one month at a time; every test here passes a startDate
// inside the current month so monthKeys() stays to a single month.
// NOTE: getKLine() now memoizes by stockId (memCache/inflight, added
// 2026-09-2x for the parallel-month rewrite) for the lifetime of the module —
// each test below MUST use its own stockId, never reuse one across tests,
// or a later test silently gets an earlier test's cached bars back instead
// of hitting its own mocked fetch (caught by this file itself going red
// after that rewrite landed: tests reusing '2330' started failing because
// the first test's result was served from cache to the later ones).
import assert from 'node:assert/strict';
import { TwseDailyKLineProvider } from '../js/data/twseDailyKLine.js';
import { MarketDataError } from '../js/data/marketdata.js';

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

// Dates below are built off the CURRENT month rather than hardcoded, so this
// file doesn't quietly rot into a different month/year than whenever it's
// actually run. Day-of-month is fabricated (1st/2nd/3rd) — these are mock
// historical rows, not meant to reflect where "today" actually falls in the
// month.
const now = new Date();
const isoYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
const rocYM = `${now.getFullYear() - 1911}/${String(now.getMonth() + 1).padStart(2, '0')}`;
const iso = (day) => `${isoYM}-${String(day).padStart(2, '0')}`;
const roc = (day) => `${rocYM}/${String(day).padStart(2, '0')}`;
const startOfMonth = iso(1); // startDate needs to be in-month for monthKeys(), and
// on/before every mock row's date so getKLine's own inclusive filter doesn't
// strip them back out.

const emptyMis = { ok: true, text: async () => JSON.stringify({ msgArray: [] }) };

await testAsync('getKLine parses TSE STOCK_DAY rows: ROC date, comma-thousands, and correct OHLCV column mapping', async () => {
  globalThis.fetch = async (url) => {
    if (url.includes('STOCK_DAY')) {
      return {
        ok: true,
        text: async () => JSON.stringify({
          data: [
            [roc(2), '12,345,678', '...', '102.00', '103.50', '101.50', '103.00', '+1.00', '...'],
          ],
        }),
      };
    }
    if (url.includes('getStockInfo.jsp')) return emptyMis;
    throw new Error(`unexpected url: ${url}`);
  };
  const bars = await TwseDailyKLineProvider.getKLine('2330', { startDate: startOfMonth });
  assert.equal(bars.length, 1);
  assert.deepEqual(bars[0], { date: iso(2), open: 102, high: 103.5, low: 101.5, close: 103, volume: 12345678 });
});

await testAsync('getKLine falls back to TPEx st43 (and converts lots to shares) when STOCK_DAY has no rows for the stock', async () => {
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(url);
    if (url.includes('STOCK_DAY')) {
      return { ok: true, text: async () => JSON.stringify({ data: [] }) };
    }
    if (url.includes('st43_result')) {
      return {
        ok: true,
        text: async () => JSON.stringify({
          aaData: [[roc(2), '500', '...', '50.00', '51.00', '49.50', '50.50', '...']],
        }),
      };
    }
    if (url.includes('getStockInfo.jsp')) return emptyMis;
    throw new Error(`unexpected url: ${url}`);
  };
  const bars = await TwseDailyKLineProvider.getKLine('6488', { startDate: startOfMonth });
  assert.equal(bars.length, 1);
  assert.deepEqual(bars[0], { date: iso(2), open: 50, high: 51, low: 49.5, close: 50.5, volume: 500000 });
  assert.ok(urls.some((u) => u.includes('st43_result')), 'expected a TPEx st43 attempt after STOCK_DAY came back empty');
});

await testAsync("getKLine merges in today's still-open MIS bar, reading trade.z when z is blank", async () => {
  globalThis.fetch = async (url) => {
    if (url.includes('STOCK_DAY')) {
      return {
        ok: true,
        text: async () => JSON.stringify({
          data: [[roc(2), '1,000,000', '...', '100.00', '101.00', '99.00', '100.50', '...', '...']],
        }),
      };
    }
    if (url.includes('getStockInfo.jsp')) {
      return {
        ok: true,
        text: async () => JSON.stringify({
          msgArray: [{ d: `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}03`, z: '-', o: '101.00', h: '102.00', l: '100.50', trade: { z: '101.50' }, v: '2000' }],
        }),
      };
    }
    throw new Error(`unexpected url: ${url}`);
  };
  const bars = await TwseDailyKLineProvider.getKLine('2454', { startDate: startOfMonth });
  const misBar = bars.find((b) => b.date === iso(3));
  assert.ok(misBar, 'expected the MIS intraday bar to be merged in as a new day');
  assert.equal(misBar.close, 101.5); // fell back to trade.z since z was '-'
  assert.equal(misBar.volume, 2000000); // lots -> shares
  assert.equal(bars.length, 2); // the closed day plus the MIS-only day
});

await testAsync('getKLine filters out bars before startDate after merging', async () => {
  globalThis.fetch = async (url) => {
    if (url.includes('STOCK_DAY')) {
      return {
        ok: true,
        text: async () => JSON.stringify({
          data: [
            [roc(1), '1,000', '...', '10.00', '10.50', '9.50', '10.00', '...', '...'],
            [roc(5), '1,000', '...', '11.00', '11.50', '10.50', '11.00', '...', '...'],
          ],
        }),
      };
    }
    if (url.includes('getStockInfo.jsp')) return emptyMis;
    throw new Error(`unexpected url: ${url}`);
  };
  const bars = await TwseDailyKLineProvider.getKLine('2317', { startDate: iso(3) });
  assert.equal(bars.length, 1);
  assert.equal(bars[0].date, iso(5));
});

await testAsync('getKLine throws MarketDataError (not an empty array) when every source has nothing for the stock', async () => {
  globalThis.fetch = async (url) => {
    if (url.includes('STOCK_DAY')) return { ok: true, text: async () => JSON.stringify({ data: [] }) };
    if (url.includes('st43_result')) return { ok: true, text: async () => JSON.stringify({ aaData: [] }) };
    throw new Error(`unexpected url: ${url}`);
  };
  await assert.rejects(
    () => TwseDailyKLineProvider.getKLine('9999', { startDate: startOfMonth }),
    MarketDataError
  );
});

await testAsync('getKLine caches by stockId: a second call for the same stock does not fetch again', async () => {
  let fetchCount = 0;
  globalThis.fetch = async (url) => {
    fetchCount++;
    if (url.includes('STOCK_DAY')) {
      return { ok: true, text: async () => JSON.stringify({ data: [[roc(2), '100', '...', '1.00', '1.10', '0.90', '1.00', '...', '...']] }) };
    }
    if (url.includes('getStockInfo.jsp')) return emptyMis;
    throw new Error(`unexpected url: ${url}`);
  };
  const first = await TwseDailyKLineProvider.getKLine('1101', { startDate: startOfMonth });
  const countAfterFirst = fetchCount;
  assert.ok(countAfterFirst > 0, 'first call should hit fetch');
  const second = await TwseDailyKLineProvider.getKLine('1101', { startDate: startOfMonth });
  assert.equal(fetchCount, countAfterFirst, 'second call for the same stockId should be served from cache, not refetch');
  assert.deepEqual(second, first);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
