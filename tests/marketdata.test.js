// Plain Node test runner. Run with: node tests/marketdata.test.js
// The CSV fallback path needs no network and is tested synchronously.
// FinMindProvider's, TwseRealtimeProvider's and YahooFinanceProvider's live
// API calls were verified manually against the real endpoints; here they're
// tested against a mocked global.fetch so `node tests/*.test.js` never
// depends on network access.
import assert from 'node:assert/strict';
import { CsvProvider, MarketDataError, TwseRealtimeProvider, YahooFinanceProvider, getLiveQuote, getLiveQuotes } from '../js/data/marketdata.js';

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
    console.log(`    ${err.stack}`);
  }
}

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

test('CsvProvider.parse reads a valid CSV into Bar[]', () => {
  const csv = 'date,open,high,low,close,volume\n2026-01-01,100,105,99,103,1000000';
  const bars = CsvProvider.parse(csv);
  assert.equal(bars.length, 1);
  assert.deepEqual(bars[0], {
    date: '2026-01-01', open: 100, high: 105, low: 99, close: 103, volume: 1000000,
  });
});

test('CsvProvider.parse rejects a CSV missing a required column', () => {
  const csv = 'date,open,high,low,close\n2026-01-01,100,105,99,103';
  assert.throws(() => CsvProvider.parse(csv), MarketDataError);
});

test('CsvProvider.parse rejects a CSV with only a header row', () => {
  const csv = 'date,open,high,low,close,volume';
  assert.throws(() => CsvProvider.parse(csv), MarketDataError);
});

test('CsvProvider.parse tolerates column order different from the canonical one', () => {
  const csv = 'volume,close,low,high,open,date\n1000000,103,99,105,100,2026-01-01';
  const bars = CsvProvider.parse(csv);
  assert.equal(bars[0].date, '2026-01-01');
  assert.equal(bars[0].close, 103);
});

await testAsync('TwseRealtimeProvider.getQuote returns the live traded price when the market row has one', async () => {
  globalThis.fetch = async (url) => {
    assert.ok(url.includes('tse_2330.tw'));
    return { ok: true, json: async () => ({ msgArray: [{ z: '1090.00', y: '1080.00', d: '20260912' }] }) };
  };
  const quote = await TwseRealtimeProvider.getQuote('2330');
  assert.deepEqual(quote, { price: 1090, date: '2026-09-12', isIntraday: true });
});

await testAsync('TwseRealtimeProvider.getQuote falls back to previous close when there is no trade yet ("z" is "-")', async () => {
  globalThis.fetch = async () => ({
    ok: true, json: async () => ({ msgArray: [{ z: '-', y: '1080.00', d: '20260912' }] }),
  });
  const quote = await TwseRealtimeProvider.getQuote('2330');
  assert.deepEqual(quote, { price: 1080, date: '2026-09-12', isIntraday: false });
});

await testAsync('TwseRealtimeProvider.getQuote tries the OTC prefix when the listed one has no match', async () => {
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(url);
    if (url.includes('tse_')) return { ok: true, json: async () => ({ msgArray: [] }) };
    return { ok: true, json: async () => ({ msgArray: [{ z: '55.5', y: '55.0', d: '20260912' }] }) };
  };
  const quote = await TwseRealtimeProvider.getQuote('6488');
  assert.equal(quote.price, 55.5);
  assert.equal(urls.length, 2);
  assert.ok(urls[0].includes('tse_6488.tw'));
  assert.ok(urls[1].includes('otc_6488.tw'));
});

await testAsync('TwseRealtimeProvider.getQuote returns null (never throws) when both markets fail', async () => {
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  const quote = await TwseRealtimeProvider.getQuote('2330');
  assert.equal(quote, null);
});

await testAsync('TwseRealtimeProvider.getQuotes fetches all stockIds in ONE request per market, not one per stock', async () => {
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(url);
    return {
      ok: true,
      json: async () => ({
        msgArray: [
          { c: '2330', z: '1090.00', y: '1080.00', d: '20260912' },
          { c: '2317', z: '105.00', y: '104.00', d: '20260912' },
        ],
      }),
    };
  };
  const quotes = await TwseRealtimeProvider.getQuotes(['2330', '2317']);
  assert.equal(urls.length, 1);
  assert.ok(urls[0].includes('tse_2330.tw%7Ctse_2317.tw') || urls[0].includes('tse_2330.tw|tse_2317.tw'));
  assert.deepEqual(quotes['2330'], { price: 1090, date: '2026-09-12', isIntraday: true });
  assert.deepEqual(quotes['2317'], { price: 105, date: '2026-09-12', isIntraday: true });
});

await testAsync('TwseRealtimeProvider.getQuotes retries only the unmatched stockIds on the OTC pass', async () => {
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(url);
    if (url.includes('tse_')) {
      return { ok: true, json: async () => ({ msgArray: [{ c: '2330', z: '1090.00', y: '1080.00', d: '20260912' }] }) };
    }
    return { ok: true, json: async () => ({ msgArray: [{ c: '6488', z: '55.5', y: '55.0', d: '20260912' }] }) };
  };
  const quotes = await TwseRealtimeProvider.getQuotes(['2330', '6488']);
  assert.equal(quotes['2330'].price, 1090);
  assert.equal(quotes['6488'].price, 55.5);
  assert.equal(urls.length, 2);
  assert.ok(urls[0].includes('tse_2330.tw') && urls[0].includes('tse_6488.tw'));
  assert.ok(urls[1].includes('otc_6488.tw') && !urls[1].includes('2330'));
});

await testAsync('getLiveQuotes falls back to Yahoo/FinMind per stock for anything TWSE\'s batch call missed', async () => {
  globalThis.fetch = async (url) => {
    if (url.includes('mis.twse.com.tw')) {
      return { ok: true, json: async () => ({ msgArray: [{ c: '2330', z: '1090.00', y: '1080.00', d: '20260912' }] }) };
    }
    if (url.includes('allorigins.win')) {
      return { ok: true, json: async () => ({ chart: { result: [{ meta: { regularMarketPrice: 55.5, regularMarketTime: 1757649600 } }] } }) };
    }
    return { ok: false };
  };
  const quotes = await getLiveQuotes(['2330', '6488']);
  assert.equal(quotes['2330'].price, 1090);
  assert.equal(quotes['6488'].price, 55.5);
});

await testAsync('YahooFinanceProvider.getQuote routes through the CORS proxy and reads regularMarketPrice', async () => {
  globalThis.fetch = async (url) => {
    assert.ok(url.startsWith('https://api.allorigins.win/raw?url='));
    assert.ok(decodeURIComponent(url).includes('query1.finance.yahoo.com/v8/finance/chart/2330.TW'));
    return {
      ok: true,
      json: async () => ({
        chart: { result: [{ meta: { regularMarketPrice: 1090, regularMarketTime: 1789104608 } }] },
      }),
    };
  };
  const quote = await YahooFinanceProvider.getQuote('2330');
  assert.equal(quote.price, 1090);
  assert.equal(quote.isIntraday, true);
});

await testAsync('YahooFinanceProvider.getQuote tries the .TWO (OTC) suffix when .TW has no price on any proxy', async () => {
  const targets = [];
  globalThis.fetch = async (url) => {
    const target = decodeURIComponent(url.split('url=')[1] ?? url.split('quest=')[1]);
    targets.push(target);
    if (target.includes('.TW?')) return { ok: true, json: async () => ({ chart: { result: [{ meta: {} }] } }) };
    return { ok: true, json: async () => ({ chart: { result: [{ meta: { regularMarketPrice: 55.5 } }] } }) };
  };
  const quote = await YahooFinanceProvider.getQuote('6488');
  assert.equal(quote.price, 55.5);
  assert.ok(targets.some((t) => t.includes('6488.TW?')));
  assert.ok(targets.some((t) => t.includes('6488.TWO?')));
});

await testAsync('YahooFinanceProvider.getQuote returns null (never throws) when the proxy is unreachable', async () => {
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  const quote = await YahooFinanceProvider.getQuote('2330');
  assert.equal(quote, null);
});

await testAsync('getLiveQuote prefers TWSE\'s intraday quote over Yahoo and FinMind', async () => {
  globalThis.fetch = async (url) => {
    if (url.includes('mis.twse.com.tw')) {
      return { ok: true, json: async () => ({ msgArray: [{ z: '1090.00', y: '1080.00', d: '20260912' }] }) };
    }
    throw new Error('should not reach Yahoo or FinMind when TWSE succeeds');
  };
  const quote = await getLiveQuote('2330');
  assert.equal(quote.price, 1090);
  assert.equal(quote.isIntraday, true);
});

await testAsync('getLiveQuote falls back to Yahoo (via proxy) when TWSE has nothing', async () => {
  globalThis.fetch = async (url) => {
    if (url.includes('mis.twse.com.tw')) throw new TypeError('Failed to fetch');
    if (url.includes('api.allorigins.win')) {
      return { ok: true, json: async () => ({ chart: { result: [{ meta: { regularMarketPrice: 1095 } }] } }) };
    }
    throw new Error('should not fall back to FinMind when Yahoo succeeds');
  };
  const quote = await getLiveQuote('2330');
  assert.equal(quote.price, 1095);
  assert.equal(quote.isIntraday, true);
});

await testAsync('getLiveQuote falls back to FinMind\'s daily close only when both TWSE and Yahoo fail', async () => {
  globalThis.fetch = async (url) => {
    if (url.includes('mis.twse.com.tw') || url.includes('api.allorigins.win')) {
      throw new TypeError('Failed to fetch');
    }
    return {
      ok: true,
      json: async () => ({
        status: 200,
        data: [{ date: '2026-09-11', open: 100, max: 105, min: 99, close: 103, Trading_Volume: 1000 }],
      }),
    };
  };
  const quote = await getLiveQuote('2330');
  assert.deepEqual(quote, { price: 103, date: '2026-09-11' });
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
