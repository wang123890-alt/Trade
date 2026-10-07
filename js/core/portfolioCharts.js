// 持股頁儀表板：資金配置圓環圖、各檔未實現損益長條圖、總覽數字卡。
// 純函式，只吃 positions（computePositions 的輸出）回傳 HTML 字串，方便測試。
//
// 配色（2026-10-07，用 dataviz skill 的 validate_palette.js 在深色底
// #10151d 驗證過：亮度帶、彩度、色盲分辨、對比全過）：圓環圖的類別色刻意
// 不用紅/綠——這個 App 裡紅綠是「漲跌」的意思，持股身分不能跟漲跌搶顏色。
// 色盲 tritan 只有 6.4（合法下限區），所以一定要搭配圖例文字＋扇區間 2px 縫，
// 不能只靠顏色分辨哪一檔。損益長條圖則照產品慣例紅漲綠跌。
import { escapeHtml } from '../utils/format.js';

const CATEGORICAL = ['#0891b2', '#8b5cf6', '#d97706', '#db2777', '#2563eb', '#0d9488'];
const OTHER_COLOR = '#4b5563';
const UP = '#ef4444';
const DOWN = '#10b981';

function valueOf(p) {
  return p.marketValue ?? p.totalCost ?? 0;
}

function fmtInt(n) {
  return Math.round(n).toLocaleString('zh-TW');
}

function fmtSigned(n) {
  const s = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${s}${fmtInt(Math.abs(n))}`;
}

function fmtWan(n) {
  if (Math.abs(n) >= 10000) return `${(n / 10000).toFixed(1)}萬`;
  return fmtInt(n);
}

/** 依市值（沒市價就用成本）由大到小，超過 maxSlices 的併成「其他」。
 * 顏色跟著股票走，不跟名次走：依代號排序後分配，避免某檔市值一變動就換色。 */
function allocationSlices(positions, maxSlices = 5) {
  const items = positions
    .map((p) => ({ stockId: p.stockId, label: p.stockName || p.stockId, value: valueOf(p) }))
    .filter((it) => it.value > 0)
    .sort((a, b) => b.value - a.value);
  const total = items.reduce((s, it) => s + it.value, 0);
  if (total <= 0) return [];

  const head = items.length > maxSlices + 1 ? items.slice(0, maxSlices) : items;
  const tail = items.length > maxSlices + 1 ? items.slice(maxSlices) : [];
  const colorOrder = [...head].sort((a, b) => a.stockId.localeCompare(b.stockId));
  const colorOf = new Map(colorOrder.map((it, i) => [it.stockId, CATEGORICAL[i % CATEGORICAL.length]]));

  const slices = head.map((it) => ({ ...it, pct: it.value / total, color: colorOf.get(it.stockId) }));
  if (tail.length > 0) {
    const value = tail.reduce((s, it) => s + it.value, 0);
    slices.push({ stockId: '', label: `其他 ${tail.length} 檔`, value, pct: value / total, color: OTHER_COLOR });
  }
  return slices;
}

function renderAllocationDonut(positions) {
  const slices = allocationSlices(positions);
  if (slices.length === 0) return '';
  const r = 54;
  const c = 2 * Math.PI * r;
  const gap = slices.length > 1 ? 2 : 0;
  let offset = 0;
  const arcs = slices.map((s) => {
    const len = Math.max(s.pct * c - gap, 0.5);
    const arc = `<circle cx="70" cy="70" r="${r}" fill="none" stroke="${s.color}" stroke-width="18" stroke-dasharray="${len.toFixed(2)} ${c.toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}"><title>${escapeHtml(s.label)}：${(s.pct * 100).toFixed(1)}% · ${fmtInt(s.value)}</title></circle>`;
    offset += s.pct * c;
    return arc;
  }).join('');
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  const legend = slices.map((s) => `
    <div class="dash-legend-row">
      <span class="dash-swatch" style="background:${s.color};"></span>
      <span class="dash-legend-label">${escapeHtml(s.label)}</span>
      <span class="num">${(s.pct * 100).toFixed(0)}%</span>
    </div>`).join('');
  return `
    <div class="card dash-card">
      <div class="dash-title">資金配置</div>
      <div class="dash-sub">各持股佔總市值比例（沒有市價的用成本計）</div>
      <div class="dash-donut-row">
        <div class="dash-donut">
          <svg viewBox="0 0 140 140" style="width:100%; height:auto; display:block;" role="img" aria-label="資金配置圓環圖">
            <g transform="rotate(-90 70 70)">${arcs}</g>
          </svg>
          <div class="dash-donut-center">
            <div class="text-dim" style="font-size:10.5px;">${positions.length} 檔</div>
            <div class="num" style="font-size:14px; font-weight:600;">${fmtWan(total)}</div>
          </div>
        </div>
        <div class="dash-legend">${legend}</div>
      </div>
    </div>`;
}

/** 各檔未實現損益，以零為中線：紅色往右（賺）、綠色往左（賠）。只畫已有市價的。 */
function renderPnLBars(positions) {
  const rows = positions
    .filter((p) => p.unrealizedPnL != null)
    .sort((a, b) => b.unrealizedPnL - a.unrealizedPnL);
  if (rows.length === 0) {
    return `
      <div class="card dash-card">
        <div class="dash-title">各檔未實現損益</div>
        <div class="text-faint" style="font-size:12.5px; margin-top:8px;">按「全部更新」取得市價後顯示</div>
      </div>`;
  }
  const maxAbs = Math.max(...rows.map((p) => Math.abs(p.unrealizedPnL)), 1);
  const W = 340;
  const labelW = 84;
  const valueW = 58; // 數值標籤的保留寬度，避免最長那根的數字被切掉
  const hasUp = rows.some((p) => p.unrealizedPnL >= 0);
  const hasDown = rows.some((p) => p.unrealizedPnL < 0);
  // 全部同方向時不留另一半空白：全賺從左邊長出去，全賠從右邊長回來
  let mid;
  let half;
  if (hasUp && hasDown) {
    mid = labelW + (W - labelW) / 2;
    half = (W - labelW) / 2 - valueW;
  } else if (hasUp) {
    mid = labelW;
    half = W - labelW - valueW;
  } else {
    mid = W;
    half = W - labelW - valueW;
  }
  const rowH = 30;
  const H = rows.length * rowH + 6;
  const bars = rows.map((p, i) => {
    const y = i * rowH + 8;
    const len = Math.max((Math.abs(p.unrealizedPnL) / maxAbs) * half, 1.5);
    const up = p.unrealizedPnL >= 0;
    const x = up ? mid : mid - len;
    const textX = up ? mid + len + 4 : mid - len - 4;
    const pct = p.unrealizedPnLPercent != null ? `（${p.unrealizedPnLPercent >= 0 ? '+' : ''}${p.unrealizedPnLPercent.toFixed(1)}%）` : '';
    const name = p.stockName || p.stockId;
    const shortName = name.length > 6 ? `${name.slice(0, 5)}…` : name;
    return `
      <text x="0" y="${y + 12}" fill="var(--text)" font-size="12">${escapeHtml(shortName)}</text>
      <rect x="${x.toFixed(1)}" y="${y}" width="${len.toFixed(1)}" height="16" rx="3" fill="${up ? UP : DOWN}"><title>${escapeHtml(p.stockName || p.stockId)}：${fmtSigned(p.unrealizedPnL)}${pct}</title></rect>
      <text x="${textX.toFixed(1)}" y="${y + 12}" fill="var(--text-dim)" font-size="10.5" text-anchor="${up ? 'start' : 'end'}" font-family="IBM Plex Mono, monospace">${fmtSigned(p.unrealizedPnL)}</text>`;
  }).join('');
  return `
    <div class="card dash-card">
      <div class="dash-title">各檔未實現損益</div>
      <div class="dash-sub">紅色獲利、綠色虧損${hasUp && hasDown ? '，以零為中線' : ''}</div>
      <svg viewBox="0 0 ${W} ${H}" style="width:100%; height:auto; display:block; margin-top:10px;" role="img" aria-label="各檔未實現損益長條圖">
        <line x1="${mid}" y1="0" x2="${mid}" y2="${H}" stroke="var(--border)"></line>
        ${bars}
      </svg>
    </div>`;
}

function summarize(positions) {
  const priced = positions.filter((p) => p.marketValue != null);
  const marketValue = priced.reduce((s, p) => s + p.marketValue, 0);
  const pricedCost = priced.reduce((s, p) => s + p.totalCost, 0);
  const totalCost = positions.reduce((s, p) => s + p.totalCost, 0);
  const pnl = priced.reduce((s, p) => s + (p.unrealizedPnL ?? 0), 0);
  return {
    pricedCount: priced.length,
    count: positions.length,
    marketValue,
    totalCost,
    pnl,
    pnlPercent: pricedCost > 0 ? (pnl / pricedCost) * 100 : null,
  };
}

function renderSummaryTiles(positions) {
  const s = summarize(positions);
  const pnlClass = s.pnl > 0 ? 'text-red' : s.pnl < 0 ? 'text-green' : '';
  const partial = s.pricedCount < s.count
    ? `<div class="text-faint" style="font-size:11px; margin-top:4px;">${s.pricedCount}/${s.count} 檔有市價</div>`
    : '';
  return `
    <div class="dash-tiles">
      <div class="card dash-tile">
        <div class="dash-tile-label">總市值</div>
        <div class="num dash-tile-value">${s.pricedCount ? fmtInt(s.marketValue) : '—'}</div>
        ${partial}
      </div>
      <div class="card dash-tile">
        <div class="dash-tile-label">未實現損益</div>
        <div class="num dash-tile-value ${pnlClass}">${s.pricedCount ? fmtSigned(s.pnl) : '—'}</div>
        <div class="num text-dim" style="font-size:11.5px; margin-top:4px;">${s.pnlPercent != null ? `報酬率 ${s.pnlPercent >= 0 ? '+' : ''}${s.pnlPercent.toFixed(1)}%` : `成本 ${fmtInt(s.totalCost)}`}</div>
      </div>
    </div>`;
}

function renderPortfolioDashboard(positions) {
  return renderSummaryTiles(positions) + renderAllocationDonut(positions) + renderPnLBars(positions);
}

export { allocationSlices, summarize, renderAllocationDonut, renderPnLBars, renderSummaryTiles, renderPortfolioDashboard };
