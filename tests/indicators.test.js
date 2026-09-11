// Plain Node test runner. Run with: node tests/indicators.test.js
import assert from 'node:assert/strict';
import { computeMA, computeRSI, detectMACross } from '../js/core/indicators.js';

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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
