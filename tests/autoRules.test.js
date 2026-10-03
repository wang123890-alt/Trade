// Plain Node test runner. Run with: node tests/autoRules.test.js
import assert from 'node:assert/strict';
import { computeAutoRules } from '../js/core/autoRules.js';

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

function bar(date, open, high, low, close, volume = 1000) {
  return { date, open, high, low, close, volume };
}

// Enough runway for MA60/ADX, ending at the trade date itself.
function uptrendBars(n, startDate = '2026-01-02') {
  const bars = [];
  const d = new Date(`${startDate}T00:00:00Z`);
  let close = 100;
  for (let i = 0; i < n; i++) {
    close += 0.3;
    bars.push(bar(d.toISOString().slice(0, 10), close - 0.5, close + 0.5, close - 1, close, 1000 + i));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return bars;
}

function lastDate(bars) {
  return bars[bars.length - 1].date;
}

await testAsync('returns null when there is not enough history before the trade date', async () => {
  const bars = uptrendBars(10);
  const result = await computeAutoRules(async () => bars, '2330', lastDate(bars), 'BUY');
  assert.equal(result, null);
});

await testAsync('BUY: fills all four fields, never partial, when history is sufficient', async () => {
  const bars = uptrendBars(90);
  const result = await computeAutoRules(async () => bars, '2330', lastDate(bars), 'BUY');
  assert.ok(result, 'expected a result with 90 bars of runway');
  assert.deepEqual(Object.keys(result.fields).sort(), ['ruleAdx', 'ruleBreakout', 'ruleTrend', 'ruleVolume'].sort());
  for (const v of Object.values(result.fields)) assert.ok(v === 'yes' || v === 'no');
  assert.equal(typeof result.note, 'string');
  assert.ok(result.note.length > 0);
});

await testAsync('SELL: fills only ruleExitFlag, with the exit basis as the note', async () => {
  const bars = uptrendBars(90);
  const result = await computeAutoRules(async () => bars, '2330', lastDate(bars), 'SELL');
  assert.ok(result);
  assert.deepEqual(Object.keys(result.fields), ['ruleExitFlag']);
  assert.ok(result.fields.ruleExitFlag === 'yes' || result.fields.ruleExitFlag === 'no');
  assert.ok(result.note.length > 0);
});

await testAsync('trims to the trade date — later bars never leak into the judgment (no future function)', async () => {
  const bars = uptrendBars(90);
  const cutoffDate = bars[70].date;
  // Bars after the cutoff spike hard, which would flip ruleBreakout/ruleAdx
  // if trimming failed to exclude them.
  const withFuture = bars.map((b, i) => (i > 70 ? { ...b, close: b.close + 50, high: b.high + 50 } : b));
  const trimmed = await computeAutoRules(async () => withFuture, '2330', cutoffDate, 'BUY');
  const untouched = await computeAutoRules(async () => bars.slice(0, 71), '2330', cutoffDate, 'BUY');
  assert.deepEqual(trimmed.fields, untouched.fields);
});

await testAsync('a fetchBars failure propagates rather than being silently swallowed here', async () => {
  const fetchBars = async () => { throw new Error('network down'); };
  await assert.rejects(
    computeAutoRules(fetchBars, '2330', '2026-06-01', 'BUY'),
    /network down/,
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
