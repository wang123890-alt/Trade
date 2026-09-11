import { exportAsJson, exportTransactionsAsCsv, importFromPayload } from '../data/importExport.js';
import { autoAddFullyClosedFromTransactions } from './watchlist.js';
import { TransactionRepository } from '../data/storage.js';

function renderSettingsView(container) {
  container.innerHTML = `
    <div style="font-size:20px; font-weight:700; margin-bottom:16px;">資料設定</div>

    <div class="card" style="margin-bottom:16px;">
      <div style="font-size:14px; font-weight:700; margin-bottom:10px;">匯出備份</div>
      <div class="text-faint" style="font-size:12px; margin-bottom:12px;">
        資料只存在這個瀏覽器裡，建議定期匯出備份，或用來搬到其他裝置。
      </div>
      <button class="btn btn-primary btn-block" id="export-json-btn" style="margin-bottom:8px;">匯出完整備份 (JSON)</button>
      <button class="btn btn-block" id="export-csv-btn">匯出交易紀錄 (CSV)</button>
    </div>

    <div class="card">
      <div style="font-size:14px; font-weight:700; margin-bottom:10px;">匯入備份</div>
      <div id="import-result"></div>
      <div class="form-field">
        <label>選擇備份JSON檔案</label>
        <input type="file" id="import-file" accept="application/json">
      </div>
      <div class="text-faint" style="font-size:11.5px;">
        匯入採合併模式：已存在的交易/觀察項目不會重複，也不會覆蓋現有資料。
      </div>
    </div>
  `;

  container.querySelector('#export-json-btn').addEventListener('click', () => exportAsJson());
  container.querySelector('#export-csv-btn').addEventListener('click', () => exportTransactionsAsCsv());

  container.querySelector('#import-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const resultBox = container.querySelector('#import-result');
      let payload;
      try {
        payload = JSON.parse(reader.result);
      } catch {
        resultBox.innerHTML = '<div class="error-banner">檔案不是有效的JSON格式</div>';
        return;
      }
      const result = importFromPayload(payload);
      if (!result.success) {
        resultBox.innerHTML = `<div class="error-banner">${result.errors.join('；')}</div>`;
        return;
      }
      const warningHtml = result.warnings.length > 0
        ? `<div class="error-banner">合併後發現問題：${result.warnings.join('；')}，建議到交易紀錄頁檢查</div>`
        : '';

      const autoWatched = autoAddFullyClosedFromTransactions(TransactionRepository.getAll());
      const autoWatchHtml = autoWatched.length > 0
        ? `<div class="card" style="background:var(--yellow-dim); border-color:rgba(251,191,36,0.25); margin-bottom:12px;">
             自動加入觀察名單 ${autoWatched.length} 檔已賣光的標的：${autoWatched.map((w) => w.stockName).join('、')}
           </div>`
        : '';

      resultBox.innerHTML = `
        <div class="card" style="background:var(--green-dim); border-color:rgba(52,211,153,0.25); margin-bottom:12px;">
          匯入完成：新增 ${result.added.transactions} 筆交易、${result.added.watchlist} 筆觀察項目
          （略過重複 ${result.skipped.transactions + result.skipped.watchlist} 筆）
        </div>
        ${autoWatchHtml}
        ${warningHtml}
      `;
      e.target.value = '';
    };
    reader.readAsText(file);
  });
}

export { renderSettingsView };
