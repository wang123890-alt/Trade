// Plain Node test runner. Run with: node tests/aiAnalysisImport.test.js
import assert from 'node:assert/strict';
import { classifyAiAnalysisText, appendAiAnalysis } from '../js/core/aiAnalysisImport.js';

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

const stocks = [
  { stockId: '2330', stockName: '台積電' },
  { stockId: '2886', stockName: '兆豐金' },
];

test('splits text by stock code header lines', () => {
  const text = '2330 台積電：短期均線轉強，留意季線支撐。\n上檔壓力在900附近。\n\n2886 兆豐金：股利政策穩定，適合長抱。';
  const { byStock, unmatched } = classifyAiAnalysisText(text, stocks);
  assert.ok(byStock['2330'].includes('短期均線轉強'));
  assert.ok(byStock['2330'].includes('上檔壓力'));
  assert.ok(byStock['2886'].includes('股利政策穩定'));
  assert.equal(unmatched, '');
});

test('splits text by stock name mentions when no code is given', () => {
  const text = '台積電目前偏多，量能放大。\n兆豐金區間整理，等待突破。';
  const { byStock } = classifyAiAnalysisText(text, stocks);
  assert.ok(byStock['2330'].includes('偏多'));
  assert.ok(byStock['2886'].includes('區間整理'));
});

test('lines with no mention attach to the most recently mentioned stock', () => {
  const text = '2330 台積電分析：\n基本面穩健。\n技術面轉強。';
  const { byStock } = classifyAiAnalysisText(text, stocks);
  assert.ok(byStock['2330'].includes('基本面穩健'));
  assert.ok(byStock['2330'].includes('技術面轉強'));
});

test('leading text before any stock mention goes to unmatched', () => {
  const text = '以下是本週個股分析：\n2330 台積電：偏多。';
  const { byStock, unmatched } = classifyAiAnalysisText(text, stocks);
  assert.equal(unmatched, '以下是本週個股分析：');
  assert.ok(byStock['2330'].includes('偏多'));
});

test('text mentioning no known stock is entirely unmatched', () => {
  const text = '2317 鴻海：法說會後轉強。';
  const { byStock, unmatched } = classifyAiAnalysisText(text, stocks);
  assert.equal(Object.keys(byStock).length, 0);
  assert.equal(unmatched, '2317 鴻海：法說會後轉強。');
});

test('appendAiAnalysis returns the new text as-is when there is nothing to append to', () => {
  assert.equal(appendAiAnalysis('', '第一次的分析', '2026/09/14'), '第一次的分析');
  assert.equal(appendAiAnalysis(null, '第一次的分析', '2026/09/14'), '第一次的分析');
});

test('appendAiAnalysis appends new text after existing content with a dated separator', () => {
  const result = appendAiAnalysis('舊的分析', '新的詳解', '2026/09/14');
  assert.equal(result, '舊的分析\n\n---- 2026/09/14 ----\n新的詳解');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
