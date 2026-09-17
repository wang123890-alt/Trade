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

test('section mode (text with "---" dividers): each block stays with its own header stock, unaffected by other stocks mentioned inside it', () => {
  const threeStocks = [
    { stockId: '2330', stockName: '台積電' },
    { stockId: '2454', stockName: '聯發科' },
    { stockId: '0050', stockName: '台灣50' },
  ];
  const text = [
    '2330 台積電',
    '',
    '目前續抱，短線震盪。',
    '---',
    '2454 聯發科',
    '',
    '目前明顯不如台積電強，因此相對強弱屬偏弱。',
    '---',
    '0050 台灣50',
    '',
    '0050 目前台積電：約 57%，聯發科：約 6.53%，高度集中在大型科技權值股。',
  ].join('\n');
  const { byStock } = classifyAiAnalysisText(text, threeStocks);
  assert.ok(byStock['2330'].includes('目前續抱'));
  assert.ok(!byStock['2330'].includes('不如台積電強')); // stayed with 2454's own section
  assert.ok(byStock['2454'].includes('不如台積電強'));
  assert.ok(byStock['0050'].includes('高度集中')); // stayed with 0050 despite naming 台積電/聯發科 inside
});

test('section mode: a block naming several stocks roughly evenly (a ranking table) is unmatched, not guessed onto the first one', () => {
  const text = [
    '2330 台積電',
    '',
    '個股分析內容。',
    '---',
    '2886 兆豐金',
    '',
    '個股分析內容。',
    '---',
    '排名：1. 2330 台積電 2. 2886 兆豐金',
  ].join('\n');
  const { byStock, unmatched } = classifyAiAnalysisText(text, stocks);
  assert.ok(!byStock['2330'].includes('排名'));
  assert.ok(!byStock['2886'] || !byStock['2886'].includes('排名'));
  assert.ok(unmatched.includes('排名'));
});

test('section mode: one "---" only before the list (not between every stock) still splits per-paragraph, and cross-references inside a paragraph don\'t steal it', () => {
  // Reproduces a real report the user pasted: a single "---" separates the
  // intro from the whole list, and every stock is its own blank-line
  // paragraph starting "code name：analysis text" all on one line (the
  // Excel-export note's own "每檔股票另起一段，且每段開頭要標代號"
  // instruction) rather than a standalone header line. Before the fix, the
  // 9-paragraph block either collapsed entirely into unmatched (ambiguous
  // whole-block mention count) or, in an intermediate broken version,
  // wrongly claimed every paragraph for whichever stock's paragraph came
  // first.
  const nineStocks = [
    { stockId: '2059', stockName: '川湖' },
    { stockId: '2330', stockName: '台積電' },
    { stockId: '0050', stockName: '元大台灣50' },
    { stockId: '00631L', stockName: '元大台灣50正2' },
  ];
  const text = [
    '依現價、成本、部位大小，近期各檔最佳動作如下。',
    '---',
    '2059 川湖：最佳動作是續抱、停止加碼。2 股已賺約 42%。',
    '',
    '2330 台積電：最佳動作是當核心續抱、現價不加。20 股接近成本。',
    '',
    '0050 元大台灣50：最佳動作是續抱當底倉。你已有 2330 與正2，再加 0050 只是重複押權值。',
    '',
    '00631L 元大台灣50正2：最佳動作是反彈減碼、不再加碼。單日兩倍不適合作底倉，且與 2330、0050 高度重疊。',
  ].join('\n');
  const { byStock, unmatched } = classifyAiAnalysisText(text, nineStocks);
  assert.ok(byStock['2059'].includes('停止加碼'));
  assert.ok(byStock['2330'].includes('當核心續抱'));
  assert.ok(byStock['0050'].includes('續抱當底倉'));
  assert.ok(!byStock['2330'].includes('續抱當底倉')); // 0050's cross-reference to 2330 didn't steal its own paragraph
  assert.ok(byStock['00631L'].includes('反彈減碼'));
  assert.ok(!byStock['2330'].includes('反彈減碼'));
  assert.ok(!byStock['0050'].includes('反彈減碼'));
  assert.ok(unmatched.includes('依現價、成本、部位大小'));
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
