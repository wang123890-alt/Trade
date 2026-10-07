// Plain Node test runner. Run with: node tests/portfolioCharts.test.js
import assert from 'node:assert/strict';
import { allocationSlices, summarize, renderAllocationDonut, renderPnLBars, renderSummaryTiles } from '../js/core/portfolioCharts.js';

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok - ${name}`); }
  catch (err) { failed++; console.log(`  FAIL - ${name}`); console.log(`    ${err.stack}`); }
}

function pos(stockId, { name = stockId, cost = 100, value = null, pnl = null, pct = null } = {}) {
  return { stockId, stockName: name, totalCost: cost, marketValue: value, unrealizedPnL: pnl, unrealizedPnLPercent: pct, totalQuantity: 1, averageCost: cost };
}

test('allocationSlices uses market value, falls back to cost, sorts largest first and sums to 100%', () => {
  const slices = allocationSlices([pos('A', { cost: 100, value: 300 }), pos('B', { cost: 100 })]);
  assert.deepEqual(slices.map((s) => s.stockId), ['A', 'B']);
  assert.equal(slices[0].pct, 0.75);
  assert.equal(slices[1].pct, 0.25);
});

test('allocationSlices folds the tail into 其他 once there are more than maxSlices+1 holdings', () => {
  const ps = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((id, i) => pos(id, { cost: 100 - i }));
  const slices = allocationSlices(ps, 5);
  assert.equal(slices.length, 6);
  assert.equal(slices[5].label, '其他 3 檔');
  assert.ok(Math.abs(slices.reduce((s, x) => s + x.pct, 0) - 1) < 1e-9);
});

test('allocationSlices does not fold when only one extra would be folded (no lone 其他 1 檔)', () => {
  const ps = ['A', 'B', 'C', 'D', 'E', 'F'].map((id) => pos(id));
  assert.equal(allocationSlices(ps, 5).length, 6);
});

test('allocationSlices colors follow the stock, not its rank', () => {
  const before = allocationSlices([pos('2330', { value: 900 }), pos('2454', { value: 100 })]);
  const after = allocationSlices([pos('2330', { value: 100 }), pos('2454', { value: 900 })]);
  const colorOf = (slices, id) => slices.find((s) => s.stockId === id).color;
  assert.equal(colorOf(before, '2330'), colorOf(after, '2330'));
  assert.equal(colorOf(before, '2454'), colorOf(after, '2454'));
});

test('summarize only counts priced holdings toward market value and P&L', () => {
  const s = summarize([pos('A', { cost: 100, value: 150, pnl: 50 }), pos('B', { cost: 200 })]);
  assert.equal(s.marketValue, 150);
  assert.equal(s.pnl, 50);
  assert.equal(s.pnlPercent, 50);
  assert.equal(s.pricedCount, 1);
  assert.equal(s.totalCost, 300);
});

test('renderPnLBars shows a prompt instead of an empty chart when nothing is priced', () => {
  assert.match(renderPnLBars([pos('A')]), /全部更新/);
});

test('renderPnLBars draws gains in red and losses in green', () => {
  const html = renderPnLBars([pos('A', { pnl: 100, pct: 10 }), pos('B', { pnl: -50, pct: -5 })]);
  assert.match(html, /fill="#ef4444"/);
  assert.match(html, /fill="#10b981"/);
});

test('stock names are HTML-escaped in every chart', () => {
  const evil = pos('X', { name: '<img src=x>', value: 100, pnl: 10, pct: 1 });
  for (const html of [renderAllocationDonut([evil]), renderPnLBars([evil])]) {
    assert.ok(!html.includes('<img src=x>'), 'raw tag leaked into chart markup');
    assert.ok(html.includes('&lt;img'));
  }
});

test('renderSummaryTiles notes partial pricing', () => {
  assert.match(renderSummaryTiles([pos('A', { value: 10, pnl: 1 }), pos('B')]), /1\/2 檔有市價/);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
