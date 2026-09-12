// Plain Node test runner. Run with: node tests/marketdata.test.js
// The CSV fallback path needs no network and is tested synchronously.
// FinMindProvider's and TwseRealtimeProvider's live API calls were verified
// manually against the real endpoints; here they're tested against a mocked
// global.fetch so `node tests/*.test.js` never depends on network access.
import assert from 'node:assert/strict';
import { CsvProvider, MarketDataError, TwseRealtimeProvider, getLiveQuote } from '../js/data/marketdata.js';

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

await testAsync('getLiveQuote prefers the intraday quote over FinMind\'s daily close', async () => {
  globalThis.fetch = async (url) => {
    if (url.includes('mis.twse.com.tw')) {
      return { ok: true, json: async () => ({ msgArray: [{ z: '1090.00', y: '1080.00', d: '20260912' }] }) };
    }
    throw new Error('should not fall back to FinMind when intraday succeeds');
  };
  const quote = await getLiveQuote('2330');
  assert.equal(quote.price, 1090);
  assert.equal(quote.isIntraday, true);
});

await testAsync('getLiveQuote falls back to FinMind\'s daily close when the intraday feed is unreachable', async () => {
  globalThis.fetch = async (url) => {
    if (url.includes('mis.twse.com.tw')) throw new TypeError('Failed to fetch');
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
