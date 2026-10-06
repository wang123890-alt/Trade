async function loadAndRenderChart(container, stockId, stockTx) {
  const chartArea = container.querySelector('#chart-area');
  try {
    const hit = await loadKLineFast(stockId);
    if (!hit?.bars?.length) {
      chartArea.innerHTML = '<div class="empty-state">查無此標的的K線資料</div>';
      return;
    }
    const paint = (bars, source) => {
      if (!chartArea.isConnected) return;
      renderChartFromBars(chartArea, bars, stockTx, { source, fetchedAt: new Date().toISOString() });
    };
    paint(hit.bars, hit.refresh ? `${hit.source} · 更新中` : hit.source);
    if (hit.refresh) {
      const next = await hit.refresh;
      if (next?.bars?.length) paint(next.bars, next.source);
    }
  } catch (err) {
    renderCsvFallback(chartArea, stockId, err);
  }
}
