import { recompute } from './transactions.js';
import { ManualPriceRepository } from '../data/storage.js';
import { computeRealizedSummary, computeUnrealizedSummary, groupByStock, groupByStrategy } from '../core/statistics.js';
import { attachLossReviews, summarizeLossPatterns } from './review.js';
import { formatMoney, formatDate, pnlClass } from '../utils/format.js';
import { navigate } from '../router.js';

function renderOverviewView(container) {
  const manualPrices = ManualPriceRepository.getAll();
  const { transactions, matches, positions } = recompute(manualPrices);

  if (transactions.length === 0) {
    container.innerHTML = `
      <div style="font-size:20px; font-weight:700; margin-bottom:16px;">市場總覽</div>
      <div class="empty-state">還沒有任何交易紀錄，先到「交易紀錄」新增一筆</div>
    `;
    return;
  }

  const realized = computeRealizedSummary(matches);
  const unrealized = computeUnrealizedSummary(positions);
  const totalPnL = realized.totalRealizedPnL + unrealized.totalUnrealizedPnL;
  const byStock = groupByStock(matches);

  // A stock currently held counts as 持有中 regardless of past realized
  // P&L; only fully-closed stocks (no open position) split into 獲利/虧損.
  const holdingStockIds = new Set(positions.map((p) => p.stockId));
  const profitStocks = byStock.filter((g) => !holdingStockIds.has(g.stockId) && g.totalRealizedPnL > 0);
  const lossStocks = byStock.filter((g) => !holdingStockIds.has(g.stockId) && g.totalRealizedPnL < 0);

  const transactionsById = Object.fromEntries(transactions.map((t) => [t.id, t]));
  const strategySummariesByName = Object.fromEntries(
    groupByStrategy(matches, transactionsById).map((s) => [s.strategy, s])
  );
  const reviewedMatches = attachLossReviews(matches, transactionsById, strategySummariesByName);
  const lossPatterns = summarizeLossPatterns(reviewedMatches);

  container.innerHTML = `
    <div style="font-size:20px; font-weight:700; margin-bottom:16px;">市場總覽</div>

    <div class="kpi-grid">
      <div class="card">
        <div class="kpi-label">總損益</div>
        <div class="kpi-value ${pnlClass(totalPnL)}">${formatMoney(totalPnL)}</div>
      </div>
      <div class="card">
        <div class="kpi-label">已實現損益</div>
        <div class="kpi-value ${pnlClass(realized.totalRealizedPnL)}">${formatMoney(realized.totalRealizedPnL)}</div>
        <div class="text-faint" style="font-size:11px; margin-top:4px;">累計 ${realized.closedCount} 筆平倉</div>
      </div>
      <div class="card">
        <div class="kpi-label">未實現損益</div>
        <div class="kpi-value ${pnlClass(unrealized.totalUnrealizedPnL)}">${formatMoney(unrealized.totalUnrealizedPnL)}</div>
        <div class="text-faint" style="font-size:11px; margin-top:4px;">
          ${unrealized.positionsWithPrice}/${unrealized.positionsTotal} 檔已輸入現價
        </div>
      </div>
      <div class="card">
        <div class="kpi-label">勝率 / 賺賠比</div>
        <div class="kpi-value">
          ${realized.winRate != null ? realized.winRate.toFixed(1) + '%' : '—'}
          <span class="text-faint" style="font-weight:500; font-size:13px;">
            / ${realized.profitLossRatio != null ? realized.profitLossRatio.toFixed(2) : '—'}
          </span>
        </div>
        <div class="text-faint" style="font-size:11px; margin-top:4px;">
          ${realized.winCount} 勝 · ${realized.lossCount} 敗
        </div>
      </div>
    </div>

    <div class="card">
      <div style="font-size:15px; font-weight:700; margin-bottom:10px;">個股分類</div>
      ${[
        renderStockCategory('獲利中', 'tag-red', 'profit', profitStocks.map((g) => {
          const latestTx = [...transactions].reverse().find((t) => t.stockId === g.stockId);
          return {
            stockId: g.stockId,
            stockName: latestTx?.stockName || g.stockId,
            detail: `${g.closedCount} 筆 · 勝率 ${g.winRate != null ? g.winRate.toFixed(0) + '%' : '—'}`,
            amount: formatMoney(g.totalRealizedPnL),
            amountClass: pnlClass(g.totalRealizedPnL),
          };
        })),
        renderStockCategory('虧損中', 'tag-green', 'loss', lossStocks.map((g) => {
          const latestTx = [...transactions].reverse().find((t) => t.stockId === g.stockId);
          return {
            stockId: g.stockId,
            stockName: latestTx?.stockName || g.stockId,
            detail: `${g.closedCount} 筆 · 勝率 ${g.winRate != null ? g.winRate.toFixed(0) + '%' : '—'}`,
            amount: formatMoney(g.totalRealizedPnL),
            amountClass: pnlClass(g.totalRealizedPnL),
          };
        })),
        renderStockCategory('持有中', 'tag-accent', 'holding', positions.map((p) => ({
          stockId: p.stockId,
          stockName: p.stockName,
          detail: `持有 ${p.totalQuantity} 股 · 成本均價 ${p.averageCost.toFixed(2)}`,
          amount: p.unrealizedPnL != null ? formatMoney(p.unrealizedPnL) : '未輸入現價',
          amountClass: p.unrealizedPnL != null ? pnlClass(p.unrealizedPnL) : 'text-faint',
        }))),
      ]
        .filter(Boolean)
        .join('') || '<div class="empty-state">尚無資料</div>'}
    </div>

    ${lossPatterns.length > 0 ? `
    <div class="card">
      <div style="font-size:15px; font-weight:700; margin-bottom:10px;">常見虧損原因統計</div>
      ${lossPatterns
        .map(
          (p, i) => `
        <div>
          <div class="tx-row" data-action="toggle-pattern" data-pattern-index="${i}" style="cursor:pointer;">
            <div style="font-size:13px;">${p.trigger}</div>
            <span class="tag tag-yellow">${p.count} 次</span>
          </div>
          <div data-pattern-examples="${i}" hidden style="padding:4px 0 8px 0;">
            ${p.examples
              .map((m) => {
                const buyTx = transactionsById[m.buyTransactionId];
                const stockName = buyTx?.stockName || m.stockId;
                return `
                <div class="tx-row" data-action="view-example" data-stock-id="${m.stockId}" style="cursor:pointer; padding-left:10px; border-left:2px solid var(--border);">
                  <div>
                    <div style="font-size:12.5px; font-weight:600;">${stockName} <span class="text-faint" style="font-weight:500;">${m.stockId}</span></div>
                    <div class="text-faint" style="font-size:11px; margin-top:2px;">${formatDate(m.closedAt)} · ${m.buyPrice} → ${m.sellPrice}</div>
                  </div>
                  <div class="${pnlClass(m.realizedPnL)}" style="font-size:12.5px; font-weight:600;">${formatMoney(m.realizedPnL)}</div>
                </div>
              `;
              })
              .join('')}
          </div>
        </div>
      `
        )
        .join('')}
    </div>
    ` : ''}
  `;

  container.querySelectorAll('[data-action="view-stock"]').forEach((row) => {
    row.addEventListener('click', () => {
      navigate('detail', row.getAttribute('data-stock-id'));
    });
  });

  container.querySelectorAll('[data-action="toggle-pattern"]').forEach((row) => {
    row.addEventListener('click', () => {
      const idx = row.getAttribute('data-pattern-index');
      const examples = container.querySelector(`[data-pattern-examples="${idx}"]`);
      examples.hidden = !examples.hidden;
    });
  });

  container.querySelectorAll('[data-action="view-example"]').forEach((row) => {
    row.addEventListener('click', (e) => {
      e.stopPropagation();
      navigate('detail', row.getAttribute('data-stock-id'));
    });
  });

  container.querySelectorAll('[data-action="toggle-category"]').forEach((row) => {
    row.addEventListener('click', () => {
      const kind = row.getAttribute('data-category');
      const list = container.querySelector(`[data-category-list="${kind}"]`);
      list.hidden = !list.hidden;
    });
  });
}

/** items: { stockId, stockName, detail, amount, amountClass }[] */
function renderStockCategory(title, tagColor, kind, items) {
  if (items.length === 0) return '';
  return `
    <div>
      <div class="tx-row" data-action="toggle-category" data-category="${kind}" style="cursor:pointer;">
        <div style="font-size:13.5px; font-weight:600;">${title}</div>
        <span class="tag ${tagColor}">${items.length} 檔</span>
      </div>
      <div data-category-list="${kind}" hidden style="padding:4px 0 8px 0;">
        ${items
          .map(
            (it) => `
          <div class="tx-row" data-action="view-stock" data-stock-id="${it.stockId}" style="cursor:pointer; padding-left:10px; border-left:2px solid var(--border);">
            <div>
              <div style="font-size:12.5px; font-weight:600;">${it.stockName} <span class="text-faint" style="font-weight:500;">${it.stockId}</span></div>
              <div class="text-faint" style="font-size:11px; margin-top:2px;">${it.detail}</div>
            </div>
            <div class="${it.amountClass}" style="font-size:12.5px; font-weight:600;">${it.amount}</div>
          </div>
        `
          )
          .join('')}
      </div>
    </div>
  `;
}

export { renderOverviewView };
