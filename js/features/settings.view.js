import { exportAsJson, exportTransactionsAsCsv, importFromPayload } from '../data/importExport.js';
import { autoAddFullyClosedFromTransactions } from './watchlist.js';
import { TransactionRepository, initStore, refreshFromRemote, isRemoteAvailable } from '../data/storage.js';
import * as githubStore from '../data/githubStore.js';
import { getRiskSettings, setRiskSettings } from '../data/riskSettings.js';

function renderSettingsView(container) {
  const config = githubStore.getConfig() || {};
  const configured = githubStore.isConfigured();

  container.innerHTML = `
    <div style="font-size:20px; font-weight:700; margin-bottom:16px;">資料設定</div>

    <div class="card" style="margin-bottom:16px;">
      <div style="font-size:14px; font-weight:700; margin-bottom:10px;">跨裝置同步（GitHub）</div>
      <div id="sync-status" class="text-faint" style="font-size:12px; margin-bottom:12px;">
        ${syncStatusText(configured)}
      </div>
      <div id="sync-form-result"></div>
      <div class="form-field">
        <label>GitHub Personal Access Token</label>
        <input type="password" id="sync-token" placeholder="ghp_..." value="${config.token || ''}">
      </div>
      <div class="form-row">
        <div class="form-field">
          <label>Repo 擁有者</label>
          <input type="text" id="sync-owner" placeholder="wang123890-alt" value="${config.owner || ''}">
        </div>
        <div class="form-field">
          <label>Repo 名稱</label>
          <input type="text" id="sync-repo" placeholder="Trade" value="${config.repo || ''}">
        </div>
      </div>
      <div class="form-field">
        <label>資料檔案路徑</label>
        <input type="text" id="sync-path" placeholder="data/store.json" value="${config.path || 'data/store.json'}">
      </div>
      <button class="btn btn-primary btn-block" id="sync-save-btn" style="margin-bottom:8px;">儲存並連線</button>
      ${configured ? '<button class="btn btn-block" id="sync-now-btn">立即同步（拉取最新資料）</button>' : ''}
      <div class="text-faint" style="font-size:11px; margin-top:10px;">
        Token 建議用細粒度（Fine-grained）Token，只授權這一個repo、只給「Contents」讀寫權限。手機、電腦兩台裝置都要各自輸入一次。
      </div>
    </div>

    <div class="card" style="margin-bottom:16px;">
      <div style="font-size:14px; font-weight:700; margin-bottom:10px;">波段本金（只存在這台裝置）</div>
      <div class="text-faint" style="font-size:12px; margin-bottom:12px;">
        個股頁用「本金 × 單筆風險％ ÷（進場參考 − 停損）」反推可買股數。不寫入交易帳、Excel。
      </div>
      <div class="form-row">
        <div class="form-field">
          <label>波段本金（元）</label>
          <input type="number" id="risk-capital" min="0" step="1000" placeholder="例如 300000">
        </div>
        <div class="form-field">
          <label>單筆風險％</label>
          <input type="number" id="risk-pct" min="0.1" step="0.1" placeholder="1">
        </div>
      </div>
      <button class="btn btn-primary btn-block" id="risk-save-btn">儲存風險設定</button>
      <div id="risk-save-result" class="text-faint" style="font-size:12px; margin-top:8px;"></div>
    </div>

    <div class="card" style="margin-bottom:16px;">
      <div style="font-size:14px; font-weight:700; margin-bottom:10px;">匯出備份</div>
      <div class="text-faint" style="font-size:12px; margin-bottom:12px;">
        建議定期匯出備份，或用來搬到其他裝置。
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

  const risk = getRiskSettings();
  const capEl = container.querySelector('#risk-capital');
  const pctEl = container.querySelector('#risk-pct');
  if (capEl && risk.capital) capEl.value = risk.capital;
  if (pctEl) pctEl.value = risk.riskPct;
  container.querySelector('#risk-save-btn').addEventListener('click', () => {
    const saved = setRiskSettings({ capital: capEl.value, riskPct: pctEl.value });
    container.querySelector('#risk-save-result').textContent =
      saved.capital ? `已存：本金 ${saved.capital}、單筆 ${saved.riskPct}%` : '本金未填，個股頁股數會空白';
  });

  container.querySelector('#export-json-btn').addEventListener('click', () => exportAsJson());
  container.querySelector('#export-csv-btn').addEventListener('click', () => exportTransactionsAsCsv());

  container.querySelector('#sync-save-btn').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const resultBox = container.querySelector('#sync-form-result');
    const token = container.querySelector('#sync-token').value.trim();
    const owner = container.querySelector('#sync-owner').value.trim();
    const repo = container.querySelector('#sync-repo').value.trim();
    const path = container.querySelector('#sync-path').value.trim() || 'data/store.json';

    if (!token || !owner || !repo) {
      resultBox.innerHTML = '<div class="error-banner">Token、擁有者、Repo名稱都不可空白</div>';
      return;
    }

    btn.disabled = true;
    btn.textContent = '連線中…';
    githubStore.setConfig({ token, owner, repo, path });
    const result = await initStore();
    btn.disabled = false;
    btn.textContent = '儲存並連線';

    if (!result.ok) {
      resultBox.innerHTML = `<div class="error-banner">連線失敗：${result.error?.message || '未知錯誤'}（設定已儲存，之後可以再按「立即同步」重試）</div>`;
    } else {
      resultBox.innerHTML = '<div class="card" style="background:var(--green-dim); border-color:rgba(52,211,153,0.25);">連線成功，已載入最新資料</div>';
    }
    renderSettingsView(container);
  });

  const syncNowBtn = container.querySelector('#sync-now-btn');
  if (syncNowBtn) {
    syncNowBtn.addEventListener('click', async () => {
      syncNowBtn.disabled = true;
      syncNowBtn.textContent = '同步中…';
      const result = await refreshFromRemote();
      syncNowBtn.disabled = false;
      syncNowBtn.textContent = '立即同步（拉取最新資料）';
      const resultBox = container.querySelector('#sync-form-result');
      resultBox.innerHTML = result.ok
        ? '<div class="card" style="background:var(--green-dim); border-color:rgba(52,211,153,0.25);">已更新為最新資料</div>'
        : `<div class="error-banner">同步失敗：${result.error?.message || '未知錯誤'}</div>`;
    });
  }

  container.querySelector('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const resultBox = container.querySelector('#import-result');
    const text = await file.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      resultBox.innerHTML = '<div class="error-banner">檔案不是有效的JSON格式</div>';
      return;
    }

    resultBox.innerHTML = '<div class="empty-state">匯入中…</div>';
    const result = await importFromPayload(payload);
    if (!result.success) {
      resultBox.innerHTML = `<div class="error-banner">${result.errors.join('；')}</div>`;
      return;
    }
    const warningHtml = result.warnings.length > 0
      ? `<div class="error-banner">合併後發現問題：${result.warnings.join('；')}，建議到交易紀錄頁檢查</div>`
      : '';

    const autoWatched = await autoAddFullyClosedFromTransactions(TransactionRepository.getAll());
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
  });
}

function syncStatusText(configured) {
  if (!configured) return '尚未設定，目前資料只存在這個瀏覽器裡（localStorage）。';
  return isRemoteAvailable()
    ? '✓ 已連線 GitHub 同步，資料會即時寫入你的repo，兩台裝置共用。'
    : '⚠ 已設定但目前連不上 GitHub，暫時使用本機備份資料。';
}

export { renderSettingsView };
