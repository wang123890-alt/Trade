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
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(url);
    return { ok: true, text: async () => JSON.stringify({ msgArray: [{ z: '1090.00', y: '1080.00', d: '20260912' }] }) };
  };
  const quote = await TwseRealtimeProvider.getQuote('2330');
  assert.deepEqual(quote, { price: 1090, date: '2026-09-12', isIntraday: true, source: 'TWSE' });
  // Both market-prefix guesses go in ONE request — not one request per guess.
  assert.equal(urls.length, 1);
  assert.ok(urls[0].includes('tse_2330.tw') && urls[0].includes('otc_2330.tw'));
});

await testAsync('TwseRealtimeProvider.getQuote falls back to previous close when there is no trade yet ("z" is "-")', async () => {
  globalThis.fetch = async () => ({
    ok: true, text: async () => JSON.stringify({ msgArray: [{ z: '-', y: '1080.00', d: '20260912' }] }),
  });
  const quote = await TwseRealtimeProvider.getQuote('2330');
  assert.deepEqual(quote, { price: 1080, date: '2026-09-12', isIntraday: false, source: 'TWSE昨收' });
});

await testAsync('TwseRealtimeProvider.getQuote reads whichever prefix actually appears in the single response', async () => {
  // Both prefix guesses are requested in one shot; only the one that's a real
  // channel comes back with a row (the wrong guess simply doesn't appear).
  globalThis.fetch = async (url) => {
    assert.ok(url.includes('tse_6488.tw') && url.includes('otc_6488.tw'));
    return { ok: true, text: async () => JSON.stringify({ msgArray: [{ z: '55.5', y: '55.0', d: '20260912' }] }) };
  };
  const quote = await TwseRealtimeProvider.getQuote('6488');
  assert.equal(quote.price, 55.5);
});

await testAsync('TwseRealtimeProvider.getQuote returns null (never throws) when every attempt fails', async () => {
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  const quote = await TwseRealtimeProvider.getQuote('2330');
  assert.equal(quote, null);
});

await testAsync('TwseRealtimeProvider.getQuote falls back to a CORS proxy when the direct request is blocked', async () => {
  // mis.twse.com.tw is documented not to send CORS headers to arbitrary
  // origins, so a direct browser fetch can reject outright (a TypeError,
  // same shape as any other network/CORS failure) even though the endpoint
  // itself is up — this must not be treated as "no data", it must retry via
  // the same CORS-proxy chain Yahoo already uses.
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(url);
    if (!url.includes('allorigins.win') && !url.includes('r.jina.ai')) {
      throw new TypeError('Failed to fetch'); // simulated CORS rejection
    }
    return { ok: true, text: async () => JSON.stringify({ msgArray: [{ z: '1090.00', y: '1080.00', d: '20260912' }] }) };
  };
  const quote = await TwseRealtimeProvider.getQuote('2330');
  assert.deepEqual(quote, { price: 1090, date: '2026-09-12', isIntraday: true, source: 'TWSE' });
  assert.ok(urls.some((u) => u.includes('allorigins.win')), 'expected a proxied retry after the direct call was blocked');
});

await testAsync('TwseRealtimeProvider.getQuotes fetches all stockIds (and both market guesses) in exactly ONE request', async () => {
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(url);
    return {
      ok: true,
      text: async () => JSON.stringify({
        msgArray: [
          { c: '2330', z: '1090.00', y: '1080.00', d: '20260912' },
          { c: '2317', z: '105.00', y: '104.00', d: '20260912' },
        ],
      }),
    };
  };
  const quotes = await TwseRealtimeProvider.getQuotes(['2330', '2317']);
  assert.equal(urls.length, 1);
  assert.ok(urls[0].includes('tse_2330.tw') && urls[0].includes('otc_2330.tw'));
  assert.ok(urls[0].includes('tse_2317.tw') && urls[0].includes('otc_2317.tw'));
  assert.deepEqual(quotes['2330'], { price: 1090, date: '2026-09-12', isIntraday: true, source: 'TWSE' });
  assert.deepEqual(quotes['2317'], { price: 105, date: '2026-09-12', isIntraday: true, source: 'TWSE' });
});

await testAsync('TwseRealtimeProvider.getQuotes omits a stockId that matched on neither market guess', async () => {
  globalThis.fetch = async () => ({
    ok: true,
    text: async () => JSON.stringify({ msgArray: [{ c: '2330', z: '1090.00', y: '1080.00', d: '20260912' }] }),
  });
  const quotes = await TwseRealtimeProvider.getQuotes(['2330', '9999']);
  assert.equal(quotes['2330'].price, 1090);
  assert.equal(quotes['9999'], undefined);
});

await testAsync('getLiveQuotes quotes every stock in parallel and omits the ones nothing could price', async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  globalThis.fetch = async (url) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 5));
    inFlight -= 1;
    if (url.includes('2330') && (url.includes('allorigins.win') || url.includes('r.jina.ai'))) {
      return { ok: true, text: async () => JSON.stringify({ chart: { result: [{ meta: { regularMarketPrice: 55.5, regularMarketTime: 1757649600 } }] } }) };
    }
    return { ok: false }; // 9999 has nothing on any source
  };
  const quotes = await getLiveQuotes(['2330', '9999']);
  assert.equal(quotes['2330'].price, 55.5);
  assert.equal(quotes['9999'], undefined);
  assert.ok(maxInFlight > 1, `expected the stocks to be fetched in parallel, saw max ${maxInFlight} concurrent request(s)`);
});

await testAsync('YahooFinanceProvider.getQuote routes through a CORS proxy and reads regularMarketPrice', async () => {
  globalThis.fetch = async (url) => {
    if (url.includes('api.allorigins.win') || url.includes('r.jina.ai')) {
      assert.ok(decodeURIComponent(url).includes('query1.finance.yahoo.com/v8/finance/chart/2330.TW'));
      return {
        ok: true,
        text: async () => JSON.stringify({
          chart: { result: [{ meta: { regularMarketPrice: 1090, regularMarketTime: 1789104608 } }] },
        }),
      };
    }
    return { ok: false }; // the direct (unproxied) attempt never gets CORS access
  };
  const quote = await YahooFinanceProvider.getQuote('2330');
  assert.equal(quote.price, 1090);
  assert.equal(quote.isIntraday, true);
});

await testAsync('YahooFinanceProvider.getQuote tries the .TWO (OTC) suffix in parallel when .TW has no price on any proxy', async () => {
  const targets = [];
  globalThis.fetch = async (url) => {
    if (!(url.includes('api.allorigins.win') || url.includes('r.jina.ai'))) return { ok: false };
    const target = decodeURIComponent(url.split('url=')[1] ?? url.split('quest=')[1]);
    targets.push(target);
    if (target.includes('.TW?')) return { ok: true, text: async () => JSON.stringify({ chart: { result: [{ meta: {} }] } }) };
    return { ok: true, text: async () => JSON.stringify({ chart: { result: [{ meta: { regularMarketPrice: 55.5 } }] } }) };
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

await testAsync('getLiveQuote never touches TWSE — a browser cannot read it, so it is out of the chain', async () => {
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(url);
    if (url.includes('api.allorigins.win') || url.includes('r.jina.ai')) {
      return { ok: true, text: async () => JSON.stringify({ chart: { result: [{ meta: { regularMarketPrice: 1095 } }] } }) };
    }
    return { ok: false };
  };
  const quote = await getLiveQuote('2330');
  assert.equal(quote.price, 1095);
  assert.equal(quote.source, '雅虎');
  assert.ok(!urls.some((u) => u.includes('mis.twse.com.tw')), `expected no TWSE request, got ${JSON.stringify(urls)}`);
});

await testAsync('getLiveQuote reads a relay that wraps its JSON in surrounding text (r.jina.ai)', async () => {
  globalThis.fetch = async (url) => {
    if (!url.includes('r.jina.ai')) return { ok: false };
    // r.jina.ai answers text/plain with a header block before the payload.
    const payload = JSON.stringify({ chart: { result: [{ meta: { regularMarketPrice: 2390 } }] } });
    return { ok: true, text: async () => `Title: \n\nURL Source: https://example\n\nMarkdown Content:\n${payload}\n` };
  };
  const quote = await getLiveQuote('2330');
  assert.equal(quote.price, 2390);
});

await testAsync('getLiveQuote falls back to FinMind\'s daily close, tagged as a close rather than a live price, when Yahoo fails', async () => {
  globalThis.fetch = async (url) => {
    if (url.includes('api.allorigins.win') || url.includes('r.jina.ai')) {
      throw new TypeError('Failed to fetch');
    }
    if (url.includes('query1.finance.yahoo.com')) return { ok: false }; // Yahoo's direct attempt — no CORS access
    return {
      ok: true,
      text: async () => JSON.stringify({
        status: 200,
        data: [{ date: '2026-09-11', open: 100, max: 105, min: 99, close: 103, Trading_Volume: 1000 }],
      }),
    };
  };
  const quote = await getLiveQuote('2330');
  // The source tag is what tells a stale close apart from a live price on
  // screen — a number that "didn't move" after 更新 is expected when it's a
  // settled close, and only alarming when it claims to be intraday.
  assert.deepEqual(quote, { price: 103, date: '2026-09-11', isIntraday: false, source: '09/11收盤' });
});

await testAsync('getLiveQuote throws a descriptive error (not a silent null) when Yahoo and FinMind both have nothing', async () => {
  globalThis.fetch = async () => ({ ok: false });
  await assert.rejects(() => getLiveQuote('2330'), MarketDataError);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
