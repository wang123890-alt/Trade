// Plain Node test runner. Run with: node tests/indicators.test.js
import assert from 'node:assert/strict';
import { computeMA, computeRSI, computeMACD, computeDMI, detectMACross } from '../js/core/indicators.js';

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

function bar(close) {
  return { date: '2026-01-01', open: close, high: close, low: close, close, volume: 1000 };
}

test('computeMA pads with null before there is enough history, then averages the window', () => {
  const bars = [1, 2, 3, 4, 5].map(bar);
  const ma3 = computeMA(bars, 3);
  assert.deepEqual(ma3.slice(0, 2), [null, null]);
  assert.equal(ma3[2], 2); // (1+2+3)/3
  assert.equal(ma3[3], 3); // (2+3+4)/3
  assert.equal(ma3[4], 4); // (3+4+5)/3
});

test('computeRSI returns 100 when there are no losses in the window', () => {
  const bars = Array.from({ length: 20 }, (_, i) => bar(100 + i)); // strictly rising
  const rsi = computeRSI(bars, 14);
  assert.equal(rsi[14], 100);
});

test('computeRSI returns 0 when there are no gains in the window', () => {
  const bars = Array.from({ length: 20 }, (_, i) => bar(100 - i)); // strictly falling
  const rsi = computeRSI(bars, 14);
  assert.equal(rsi[14], 0);
});

test('computeRSI is null before enough history exists', () => {
  const bars = Array.from({ length: 10 }, (_, i) => bar(100 + i));
  const rsi = computeRSI(bars, 14);
  assert.ok(rsi.every((v) => v === null));
});

test('detectMACross finds a golden cross when short MA crosses above long MA', () => {
  const shortMA = [null, 9, 11]; // was below (9<10), now above (11>10)
  const longMA = [null, 10, 10];
  assert.equal(detectMACross(shortMA, longMA, 2), 'golden');
});

test('detectMACross finds a death cross when short MA crosses below long MA', () => {
  const shortMA = [null, 11, 9];
  const longMA = [null, 10, 10];
  assert.equal(detectMACross(shortMA, longMA, 2), 'death');
});

test('detectMACross returns null when either series lacks history at that index', () => {
  const shortMA = [null, null, 11];
  const longMA = [null, null, 10];
  assert.equal(detectMACross(shortMA, longMA, 2), null);
});

test('computeMACD is null before the slow EMA has enough history, then settles to the steady-state gap for a constant-slope trend', () => {
  // close rises by 1 every bar: the fast(12)/slow(26) EMA gap converges to
  // (slow-1)/2 - (fast-1)/2 = 12.5 - 5.5 = 7, and once the signal line (EMA
  // of the MACD line) catches up the histogram converges to ~0.
  const bars = Array.from({ length: 60 }, (_, i) => bar(100 + i));
  const { macdLine, signalLine, histogram } = computeMACD(bars);
  assert.ok(macdLine.slice(0, 25).every((v) => v === null));
  assert.ok(macdLine[25] != null);
  assert.ok(Math.abs(macdLine.at(-1) - 7) < 1e-6);
  assert.ok(Math.abs(signalLine.at(-1) - 7) < 1e-6);
  assert.ok(Math.abs(histogram.at(-1)) < 1e-6);
});

test('computeDMI is null before enough history, then reads strongly directional for a one-way trend', () => {
  const bars = Array.from({ length: 40 }, (_, i) => ({
    date: '2026-01-01', open: 100 + i - 0.3, high: 100 + i + 0.6, low: 100 + i - 0.6, close: 100 + i, volume: 1000,
  }));
  const { plusDI, minusDI, adx } = computeDMI(bars, 14);
  assert.ok(plusDI.slice(0, 14).every((v) => v === null));
  assert.ok(plusDI[14] != null);
  // Steady uptrend: +DI should dominate -DI, and ADX (trend strength)
  // should end up high once it has enough history to compute.
  assert.ok(plusDI.at(-1) > minusDI.at(-1));
  assert.equal(minusDI.at(-1), 0);
  assert.ok(adx.at(-1) > 50);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
