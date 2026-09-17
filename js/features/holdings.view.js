import { recompute } from './transactions.js';
import { ManualPriceRepository, StockAiAnalysisRepository } from '../data/storage.js';
import { getLiveQuote, getLiveQuotes } from '../data/marketdata.js';
import { classifyAiAnalysisText, appendAiAnalysis } from '../core/aiAnalysisImport.js';
import { downloadExcel } from '../utils/exportExcel.js';
import { formatMoney, formatPercent, formatTime, pnlClass, escapeHtml } from '../utils/format.js';
import { navigate } from '../router.js';

const priceMeta = {};

function fitAiTextarea(el) {
  if (!el) return;
  el.style.height = 'auto';
  const cap = Math.round(window.innerHeight * 0.5);
  const next = Math.min(Math.max(el.scrollHeight, 72), cap);
  el.style.height = `${next}px`;
  el.style.overflowY = el.scrollHeight > cap ? 'auto' : 'hidden';
}

function bindFitAiTextareas(root) {
  if (!root) return;
  root.querySelectorAll('textarea.ai-paste, textarea.ai-preview').forEach((el) => {
    fitAiTextarea(el);
    if (el.dataset.fitBound) return;
    el.dataset.fitBound = '1';
    el.addEventListener('input', () => fitAiTextarea(el));
  });
}

function renderHoldingsView(container) {
  render(container);
}

function render(container) {
  const manualPrices = ManualPriceRepository.getAll();
  const { positions } = recompute(manualPrices);

  if (positions.length === 0) {
    container.innerHTML = `
      <div style="font-size:20px; font-weight:700; margin-bottom:16px;">我的持股</div>
      <div class="empty-state">目前沒有持倉，先到「交易紀錄」新增一筆買進</div>
    `;
    return;
  }

  container.innerHTML = `
    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:16px; gap:8px; flex-wrap:wrap;">
      <div style="font-size:20px; font-weight:700;">我的持股</div>
      <div style="display:flex; gap:8px;">
        <button class="btn" id="export-excel">匯出Excel</button>
        <button class="btn" id="toggle-ai-import">匯入AI解析</button>
        <button class="btn" id="refresh-all-prices">全部更新</button>
      </div>
    </div>
    <div id="ai-import-panel" hidden></div>
    <div id="positions-list"></div>
  `;

  container.querySelector('#export-excel').addEventListener('click', () => {
    const headers = ['代號', '名稱', '股數', '成本均價', '市價', '未實現損益', '損益%', 'AI解析'];
    const rows = positions.map((p) => [
      p.stockId, p.stockName, p.totalQuantity, Number(p.averageCost.toFixed(2)),
      p.marketPrice ?? '', p.unrealizedPnL ?? '',
      p.unrealizedPnLPercent != null ? Number(p.unrealizedPnLPercent.toFixed(2)) : '',
      StockAiAnalysisRepository.get(p.stockId),
    ]);
    const today = new Date().toISOString().slice(0, 10);
    const note = '這是我的持股清單，請針對「每一列」分別分析。回覆時每檔股票另起一段，且每段都要以該股票的「代號」開頭（例如：2330 台積電：分析內容…），不要把多檔股票的共同建議寫成不標代號的單一段落——這樣我才能把你的回覆自動分類貼回對應股票。';
    downloadExcel(`持股_${today}.xls`, '持股', headers, rows, note);
  });

  container.querySelector('#toggle-ai-import').addEventListener('click', () => {
    const panel = container.querySelector('#ai-import-panel');
    panel.hidden = !panel.hidden;
    if (!panel.hidden) renderAiImportPanel(panel, positions, container);
  });

  container.querySelector('#refresh-all-prices').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = '更新中…';
    try {
      const quotes = await getLiveQuotes(positions.map((p) => p.stockId));
      const prices = {};
      const fetchedAt = new Date().toISOString();
      for (const [stockId, quote] of Object.entries(quotes)) {
        prices[stockId] = quote.price;
        priceMeta[stockId] = { source: quote.source, fetchedAt };
      }
      if (Object.keys(prices).length > 0) {
        await ManualPriceRepository.setMany(prices);
        if (Object.keys(prices).length < positions.length) {
          const missed = positions.filter((p) => !(p.stockId in prices)).map((p) => p.stockName).join('、');
          alert(`部分更新成功，這幾檔沒有查到資料：${missed}`);
        }
      } else {
        alert('全部更新失敗：雅虎股市與 FinMind 都查無資料，請稍後再試');
      }
    } catch (err) {
      alert(err?.message || '全部更新失敗，請稍後再試');
    }
    render(container);
  });

  const list = container.querySelector('#positions-list');
  list.innerHTML = positions.map((p) => {
    const hasPrice = p.marketPrice != null;
    const aiText = StockAiAnalysisRepository.get(p.stockId);
    return `
      <div class="card" data-stock-id="${escapeHtml(p.stockId)}" style="padding:10px 14px;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
          <button class="stock-link" data-action="view-detail" style="background:none; border:none; padding:0; cursor:pointer; text-align:left; color:inherit; min-width:0; overflow:hidden;">
            <div style="font-size:14px; font-weight:700; text-decoration:underline; text-decoration-color:var(--border); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(p.stockName)}
              <span class="text-faint" style="font-weight:500; font-size:12px;">${escapeHtml(p.stockId)}</span>
            </div>
          </button>
          <button class="btn" data-action="save-price" style="flex:0 0 auto;">更新</button>
        </div>
        <div class="text-faint" style="font-size:11px; margin-top:2px;">
          持有 ${p.totalQuantity} 股 · 成本 ${p.averageCost.toFixed(2)}
        </div>
        <div style="margin-top:8px;">
          ${hasPrice
            ? `<div style="font-size:14px; font-weight:700;">${p.marketPrice}
                 ${priceMeta[p.stockId] ? `<span class="text-faint" style="font-size:11px; font-weight:500;">${priceMeta[p.stockId].source} · ${formatTime(priceMeta[p.stockId].fetchedAt)}更新</span>` : ''}
               </div>
               <div class="${pnlClass(p.unrealizedPnL)}" style="font-size:11.5px; font-weight:600;">
                 ${formatMoney(p.unrealizedPnL)} (${formatPercent(p.unrealizedPnLPercent)})
               </div>`
            : `<div class="text-faint" style="font-size:12px;">尚未取得市價</div>`}
        </div>
        <div style="margin-top:8px; border-top:1px solid var(--border); padding-top:8px;">
          <div data-action="toggle-ai" style="cursor:pointer; display:flex; align-items:center; justify-content:space-between;">
            <span class="text-faint" style="font-size:11.5px; font-weight:600;">AI解析${aiText ? '' : '（未填寫）'}</span>
            <span class="text-faint" style="font-size:11px;">展開/新增</span>
          </div>
          <div data-ai-body hidden style="margin-top:6px;">
            ${aiText ? `<div class="ai-unmatched" style="margin-bottom:8px; border-left:2px solid var(--border); padding-left:8px;">${escapeHtml(aiText)}</div>` : ''}
            <div class="form-field">
              <textarea class="ai-preview" data-ai-input placeholder="貼上這檔的AI詳解…"></textarea>
            </div>
            <button class="btn btn-block" data-action="save-ai">${aiText ? '附加新內容' : '儲存AI解析'}</button>
          </div>
        </div>
      </div>`;
  }).join('');

  list.querySelectorAll('[data-action="view-detail"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      navigate('detail', btn.closest('[data-stock-id]').getAttribute('data-stock-id'));
    });
  });

  list.querySelectorAll('[data-action="toggle-ai"]').forEach((row) => {
    row.addEventListener('click', () => {
      const body = row.parentElement.querySelector('[data-ai-body]');
      body.hidden = !body.hidden;
      if (!body.hidden) bindFitAiTextareas(body);
    });
  });

  list.querySelectorAll('[data-action="save-ai"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const cardEl = btn.closest('[data-stock-id]');
      const stockId = cardEl.getAttribute('data-stock-id');
      const newText = cardEl.querySelector('[data-ai-input]').value.trim();
      if (!newText) return;
      btn.disabled = true;
      const existing = StockAiAnalysisRepository.get(stockId);
      const today = new Date().toLocaleDateString('zh-TW');
      await StockAiAnalysisRepository.set(stockId, appendAiAnalysis(existing, newText, today));
      render(container);
    });
  });

  list.querySelectorAll('[data-action="save-price"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const cardEl = btn.closest('[data-stock-id]');
      const stockId = cardEl.getAttribute('data-stock-id');
      btn.disabled = true;
      btn.textContent = '取得中…';
      let price = null;
      let fetchError = null;
      try {
        const quote = await getLiveQuote(stockId);
        if (quote) {
          price = quote.price;
          priceMeta[stockId] = { source: quote.source, fetchedAt: new Date().toISOString() };
        }
      } catch (err) {
        fetchError = err;
      }
      btn.textContent = '更新';
      if (!(price > 0)) {
        alert(fetchError?.message || '自動取得市價失敗，請稍後再試');
        btn.disabled = false;
        return;
      }
      const result = await ManualPriceRepository.set(stockId, price);
      if (!result.ok) {
        alert(result.error?.message || '同步失敗');
        btn.disabled = false;
        return;
      }
      render(container);
    });
  });
}

function renderAiImportPanel(panel, positions, container) {
  panel.innerHTML = `
    <div class="card">
      <div style="font-size:13.5px; font-weight:700; margin-bottom:8px;">貼上AI分析（會依股票代號/名稱自動分類）</div>
      <div class="form-field">
        <textarea id="ai-paste-input" class="ai-paste" placeholder="貼上涵蓋多檔股票的AI分析文字…"></textarea>
      </div>
      <button class="btn btn-primary" id="ai-classify-btn">分類並預覽</button>
      <div id="ai-preview-area" style="margin-top:12px;"></div>
    </div>
  `;
  bindFitAiTextareas(panel);
  panel.querySelector('#ai-classify-btn').addEventListener('click', () => {
    const text = panel.querySelector('#ai-paste-input').value;
    const stocks = positions.map((p) => ({ stockId: p.stockId, stockName: p.stockName }));
    const { byStock, unmatched } = classifyAiAnalysisText(text, stocks);
    renderAiPreview(panel, byStock, unmatched, positions, container);
  });
}

function renderAiPreview(panel, byStock, unmatched, positions, container) {
  const previewArea = panel.querySelector('#ai-preview-area');
  const stockNameById = Object.fromEntries(positions.map((p) => [p.stockId, p.stockName]));
  const matchedIds = Object.keys(byStock);
  if (matchedIds.length === 0) {
    previewArea.innerHTML = '<div class="empty-state">沒有比對到任何持股的股票代號或名稱，請確認貼上的文字有提到股票代號或全名</div>';
    return;
  }
  previewArea.innerHTML = `
    ${matchedIds.map((stockId) => `
      <div style="border-top:1px solid var(--border); padding:10px 0;">
        <label style="display:flex; align-items:center; gap:6px; font-size:12.5px; font-weight:600; margin-bottom:6px;">
          <input type="checkbox" data-preview-include="${escapeHtml(stockId)}" checked>
          ${escapeHtml(stockNameById[stockId] || stockId)} <span class="text-faint" style="font-weight:500;">${escapeHtml(stockId)}</span>
        </label>
        <textarea class="ai-preview" data-preview-text="${escapeHtml(stockId)}">${escapeHtml(byStock[stockId])}</textarea>
      </div>`).join('')}
    ${unmatched ? `
      <div style="border-top:1px solid var(--border); padding:10px 0;">
        <div class="text-faint" style="font-size:11.5px; margin-bottom:4px;">未比對到任何持股，不會寫入（僅供確認沒有漏掉重要內容）</div>
        <div class="ai-unmatched">${escapeHtml(unmatched)}</div>
      </div>` : ''}
    <button class="btn btn-primary btn-block" id="ai-confirm-import" style="margin-top:10px;">確認匯入</button>
  `;
  bindFitAiTextareas(previewArea);
  previewArea.querySelector('#ai-confirm-import').addEventListener('click', async () => {
    const btn = previewArea.querySelector('#ai-confirm-import');
    btn.disabled = true;
    const today = new Date().toLocaleDateString('zh-TW');
    const updates = {};
    for (const stockId of matchedIds) {
      const checkbox = previewArea.querySelector(`[data-preview-include="${stockId}"]`);
      if (!checkbox.checked) continue;
      const newText = previewArea.querySelector(`[data-preview-text="${stockId}"]`).value;
      updates[stockId] = appendAiAnalysis(StockAiAnalysisRepository.get(stockId), newText, today);
    }
    if (Object.keys(updates).length === 0) { btn.disabled = false; return; }
    await StockAiAnalysisRepository.setMany(updates);
    render(container);
  });
}

export { renderHoldingsView };
