// Renders a candlestick chart + MA overlay lines + buy/sell markers as an
// inline SVG string. Pure function: (bars, options) -> SVG markup string.
// No external chart library (CDN allowlist doesn't cover charting libs, and
// this keeps the app dependency-free).

function renderKLineChart(bars, {
  width = 1040,
  height = 300,
  volumeHeight = 70,
  maSeries = [], // [{ label, color, values }] — values same length as bars
  markers = [], // [{ index, label, color }]
} = {}) {
  if (bars.length === 0) return '<div class="empty-state">沒有K線資料</div>';

  const hasVolume = bars.some((b) => b.volume != null);
  const volumeGap = hasVolume ? 16 : 0;
  const totalHeight = height + (hasVolume ? volumeHeight + volumeGap : 0);

  const padding = { top: 20, right: 10, bottom: 10, left: 10 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const allLows = bars.map((b) => b.low);
  const allHighs = bars.map((b) => b.high);
  const allMaValues = maSeries.flatMap((s) => s.values.filter((v) => v != null));
  const minPrice = Math.min(...allLows, ...(allMaValues.length ? allMaValues : allLows));
  const maxPrice = Math.max(...allHighs, ...(allMaValues.length ? allMaValues : allHighs));
  const priceRange = maxPrice - minPrice || 1;

  const barSlot = plotWidth / bars.length;
  const candleWidth = Math.max(2, Math.min(18, barSlot * 0.6));

  function xAt(i) {
    return padding.left + barSlot * i + barSlot / 2;
  }
  function yAt(price) {
    return padding.top + plotHeight * (1 - (price - minPrice) / priceRange);
  }

  const gridLines = [0.25, 0.5, 0.75, 1].map((frac) => {
    const y = padding.top + plotHeight * frac;
    return `<line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="var(--border)" stroke-width="1"></line>`;
  }).join('');

  const candles = bars.map((b, i) => {
    const isUp = b.close >= b.open;
    // Taiwan/Chinese convention: red = price up, green = price down.
    const color = isUp ? 'var(--red)' : 'var(--green)';
    const bg = isUp ? 'var(--red-dim)' : 'var(--green-dim)';
    const x = xAt(i);
    const yHigh = yAt(b.high);
    const yLow = yAt(b.low);
    const yOpen = yAt(b.open);
    const yClose = yAt(b.close);
    const bodyTop = Math.min(yOpen, yClose);
    const bodyHeight = Math.max(1, Math.abs(yClose - yOpen));
    return `
      <line x1="${x}" y1="${yHigh}" x2="${x}" y2="${yLow}" stroke="${color}" stroke-width="1.4"></line>
      <rect x="${x - candleWidth / 2}" y="${bodyTop}" width="${candleWidth}" height="${bodyHeight}" fill="${bg}" stroke="${color}" stroke-width="1.2"></rect>
    `;
  }).join('');

  const maLines = maSeries.map((series) => {
    const points = series.values
      .map((v, i) => (v == null ? null : `${xAt(i)},${yAt(v)}`))
      .filter(Boolean)
      .join(' ');
    if (!points) return '';
    return `<polyline points="${points}" fill="none" stroke="${series.color}" stroke-width="1.6"></polyline>`;
  }).join('');

  const markerEls = markers.map((m) => {
    if (m.index < 0 || m.index >= bars.length) return '';
    const x = xAt(m.index);
    const y = yAt(bars[m.index].high) - 8;
    return `
      <circle cx="${x}" cy="${y}" r="5" fill="var(--bg)" stroke="${m.color}" stroke-width="2"></circle>
      <text x="${x}" y="${y - 10}" text-anchor="middle" font-size="10" fill="${m.color}" font-weight="600">${m.label}</text>
    `;
  }).join('');

  let volumeBars = '';
  if (hasVolume) {
    const volTop = height + volumeGap;
    const maxVolume = Math.max(...bars.map((b) => b.volume || 0), 1);
    function volYAt(v) {
      return volTop + volumeHeight * (1 - v / maxVolume);
    }
    volumeBars = bars.map((b, i) => {
      const isUp = b.close >= b.open;
      const color = isUp ? 'var(--red)' : 'var(--green)';
      const x = xAt(i);
      const y = volYAt(b.volume || 0);
      const barHeight = Math.max(1, volTop + volumeHeight - y);
      return `<rect x="${x - candleWidth / 2}" y="${y}" width="${candleWidth}" height="${barHeight}" fill="${color}" opacity="0.5"></rect>`;
    }).join('');
  }

  return `
    <svg viewBox="0 0 ${width} ${totalHeight}" width="100%" height="${totalHeight}" style="display:block;">
      ${gridLines}
      ${maLines}
      ${candles}
      ${markerEls}
      ${volumeBars}
    </svg>
  `;
}

export { renderKLineChart };
