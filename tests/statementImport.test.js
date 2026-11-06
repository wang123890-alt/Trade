// Plain Node test runner. Run with: node tests/statementImport.test.js
import assert from 'node:assert/strict';

globalThis.localStorage = (() => {
  let store = {};
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { store = {}; },
  };
})();

const {
  DEFAULT_TYPE_WORDS, loadMap, saveMap, parseCsv, buildCandidates, preview, commit,
} = await import('../js/features/statementImport.js');
const { TransactionRepository, initStore } = await import('../js/data/storage.js');
const { createTransaction } = await import('../js/core/models.js');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  localStorage.clear();
  await initStore();
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

const COLS = {
  dateTime: '日期', stockId: '代號', stockName: '名稱', type: '買賣別',
  quantity: '股數', price: '單價', fee: '手續費', tax: '證交稅',
};

const CSV_TEXT = '\uFEFF' + [
  '日期,代號,名稱,買賣別,股數,單價,手續費,證交稅',
  '2026/09/01,2330,"台積電,股份",現股買進,"1,000",900,20,0',
  '115/09/02,2317,鴻海,現股賣出,500,180,10,135',
  '2026-09-03,2454,聯發科,現金股利,100,50,0,0',
  '20260904,2303,聯電,融資買進,1000,50,0,0',
  '2026/9/5,2330,台積電,現股賣出,2000,910,0,0',
  '20260901,2330,台積電,現股買進,1000,900,20,0',
  '2026/09/06,2330,台積電,現股買進,0,900,0,0',
  '1150924,0050,元大台灣50,現股買進,100,150,1,0',
].join('\n');

await test('parseCsv keeps a comma inside quotes and strips a BOM', async () => {
  const rows = parseCsv(CSV_TEXT);
  assert.equal(rows[0][0], '日期');
  assert.equal(rows[1][2], '台積電,股份');
  assert.equal(rows[1][4], '1,000');
  assert.equal(rows.length, 9);
});

await test('現股買賣入帳，股利和融資略過，民國日期轉西元', async () => {
  const rows = parseCsv(CSV_TEXT);
  const { candidates, skipped } = buildCandidates(rows, COLS, DEFAULT_TYPE_WORDS);
  const by = (id, type) => candidates.filter((t) => t.stockId === id && t.type === type);
  assert.equal(by('2330', 'BUY').length, 2);
  assert.equal(by('2330', 'BUY')[0].dateTime, '2026-09-01');
  assert.equal(by('2330', 'BUY')[0].quantity, 1000);
  assert.equal(by('2330', 'BUY')[0].stockName, '台積電,股份');
  assert.equal(by('2330', 'BUY')[0].strategy, '');
  assert.equal(by('2330', 'BUY')[0].reason, '');
  assert.equal(by('2330', 'BUY')[0].note, '對帳單匯入');
  assert.equal(by('2317', 'SELL')[0].dateTime, '2026-09-02');
  assert.equal(by('2317', 'SELL')[0].tax, 135);
  assert.equal(by('0050', 'BUY')[0].dateTime, '2026-09-24');
  assert.equal(by('2330', 'SELL').length, 1);
  assert.ok(skipped.some((s) => s.reason.includes('現金股利')));
  assert.ok(skipped.some((s) => s.reason.includes('融資買進')));
  assert.ok(skipped.some((s) => s.reason.includes('股數必須大於 0')));
  assert.equal(candidates.length, 5);
});

await test('同一檔重複列只留一筆，超賣的賣出擋下，買進仍可寫', async () => {
  const rows = parseCsv(CSV_TEXT);
  const { candidates } = buildCandidates(rows, COLS, DEFAULT_TYPE_WORDS);
  const pv = preview(candidates, []);
  assert.equal(pv.skip.length, 1);
  assert.equal(pv.add.length, 2);
  assert.ok(pv.add.every((t) => t.type === 'BUY'));
  assert.equal(pv.reject.length, 2);
  assert.ok(pv.reject.every((m) => m.includes('賣出數量超過庫存')));
});

await test('確認後寫入，再匯一次不覆蓋', async () => {
  const rows = parseCsv(CSV_TEXT);
  const { candidates } = buildCandidates(rows, COLS, DEFAULT_TYPE_WORDS);
  const first = preview(candidates, TransactionRepository.getAll());
  const result = await commit(first.add);
  assert.equal(result.ok, true);
  assert.equal(result.added, 2);
  assert.equal(TransactionRepository.getAll().length, 2);

  const again = buildCandidates(rows, COLS, DEFAULT_TYPE_WORDS);
  const second = preview(again.candidates, TransactionRepository.getAll());
  assert.equal(second.add.length, 0);
  assert.equal(second.skip.length, 3);
  const result2 = await commit(second.add);
  assert.equal(result2.ok, true);
  assert.equal(result2.added, 0);
  assert.equal(TransactionRepository.getAll().length, 2);
});

await test('已有庫存時，對得上的賣出可以寫，超賣的不寫', async () => {
  await TransactionRepository.save(createTransaction({
    id: 'have', stockId: '2330', stockName: '台積電', type: 'BUY',
    dateTime: '2026-08-01', price: 800, quantity: 3000,
  }));
  const rows = parseCsv(CSV_TEXT);
  const { candidates } = buildCandidates(rows, COLS, DEFAULT_TYPE_WORDS);
  const pv = preview(candidates, TransactionRepository.getAll());
  const sell = pv.add.find((t) => t.stockId === '2330' && t.type === 'SELL');
  assert.ok(sell);
  assert.equal(pv.reject.length, 1);
  assert.ok(pv.reject[0].includes('2317'));
  const result = await commit(pv.add);
  assert.equal(result.ok, true);
  assert.ok(TransactionRepository.getAll().some((t) => t.stockId === '2330' && t.type === 'SELL'));
  assert.ok(!TransactionRepository.getAll().some((t) => t.stockId === '2317'));
});

await test('整批含超賣時，commit 拒絕且不寫入', async () => {
  const bad = createTransaction({
    id: 'bad', stockId: '2317', stockName: '鴻海', type: 'SELL',
    dateTime: '2026-09-02', price: 180, quantity: 500,
  });
  const result = await commit([bad]);
  assert.equal(result.ok, false);
  assert.ok(result.error.includes('賣出數量超過庫存'));
  assert.equal(TransactionRepository.getAll().length, 0);
});

await test('欄位對應會記住', async () => {
  assert.equal(loadMap(), null);
  saveMap({ columns: COLS, type: DEFAULT_TYPE_WORDS });
  assert.equal(loadMap().columns.stockId, '代號');
  assert.ok(loadMap().type.buy.includes('現股買進'));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
