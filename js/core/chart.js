// Renders a candlestick chart + MA overlay lines + buy/sell markers as an
// inline SVG string. Pure function: (bars, options) -> SVG markup string.
// No external chart library (CDN allowlist doesn't cover charting libs, and
// this keeps the app dependency-free).

// ISO week number (Thursday-anchored), used to detect "a new trading week
// started" from whatever the first trading day of that week actually is —
// Taiwan markets don't always resume on Monday (holidays) or stop at Friday
// (occasional Saturday make-up trading days), so a week can run short or long.
function isoWeekKey(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const day = (d.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  d.setUTCDate(d.getUTCDate() - day + 3); // nearest Thursday
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const firstDay = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDay + 3);
  const week = 1 + Math.round((d - firstThursday) / (7 * 86400000));
  return `${d.getUTCFullYear()}-W${week}`;
}

// Taiwan (ROC/民國) calendar year label for a month boundary, e.g. 2026-06 -> "115/06".
function rocMonthLabel(dateStr) {
  const [year, month] = dateStr.slice(0, 7).split('-');
  return `${Number(year) - 1911}/${month}`;
}

function renderKLineChart(bars, {
  width = 1040,
  height = 300,
  volumeHeight = 70,
  axisHeight = 22,
  maSeries = [], // [{ label, color, values }] — values same length as bars
  markers = [], // [{ index, label, color }]
} = {}) {
  if (bars.length === 0) return '<div class="empty-state">沒有K線資料</div>';

  const hasVolume = bars.some((b) => b.volume != null);
  const volumeGap = hasVolume ? 16 : 0;
  const chartBottom = height + (hasVolume ? volumeHeight + volumeGap : 0);
  const totalHeight = chartBottom + axisHeight;

  const padding = { top: 44, right: 10, bottom: 10, left: 10 };
  const plotWidthForSlot = width - padding.left - padding.right;
  const barSlot = plotWidthForSlot / bars.length;
  const candleWidth = Math.max(2, Math.min(18, barSlot * 0.6));

  function xAt(i) {
    return padding.left + barSlot * i + barSlot / 2;
  }

  // Markers close together in time (e.g. a quick buy/sell round trip) would
  // otherwise print their price labels on top of each other — stagger each
  // one progressively higher than the last nearby marker instead. Computed
  // up front so padding.top can grow to fit however high the staggering
  // pushes the tallest label.
  const MARKER_OVERLAP_DISTANCE = barSlot * 4;
  const sortedMarkers = [...markers].sort((a, b) => a.index - b.index);
  let lastMarkerX = null;
  let staggerLevel = 0;
  let maxStaggerLevel = 0;
  const markerStaggerLevels = sortedMarkers.map((m) => {
    const x = xAt(m.index);
    staggerLevel = lastMarkerX != null && Math.abs(x - lastMarkerX) < MARKER_OVERLAP_DISTANCE
      ? staggerLevel + 1
      : 0;
    lastMarkerX = x;
    maxStaggerLevel = Math.max(maxStaggerLevel, staggerLevel);
    return staggerLevel;
  });
  padding.top += maxStaggerLevel * 22;

  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const allLows = bars.map((b) => b.low);
  const allHighs = bars.map((b) => b.high);
  const allMaValues = maSeries.flatMap((s) => s.values.filter((v) => v != null));
  const minPrice = Math.min(...allLows, ...(allMaValues.length ? allMaValues : allLows));
  const maxPrice = Math.max(...allHighs, ...(allMaValues.length ? allMaValues : allHighs));
  const priceRange = maxPrice - minPrice || 1;

  function yAt(price) {
    return padding.top + plotHeight * (1 - (price - minPrice) / priceRange);
  }

  const gridLines = [0.25, 0.5, 0.75, 1].map((frac) => {
    const y = padding.top + plotHeight * frac;
    return `<line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="var(--border)" stroke-width="1"></line>`;
  }).join('');

  // Month boundaries, used both for the full-height background guide lines
  // and the axis labels below the chart.
  const monthStarts = [];
  for (let i = 0; i < bars.length; i++) {
    const monthKey = bars[i].date.slice(0, 7);
    const prevMonthKey = i > 0 ? bars[i - 1].date.slice(0, 7) : null;
    if (monthKey !== prevMonthKey) monthStarts.push(i);
  }
  const useMonthGuides = monthStarts.length >= 2;
  const monthGuides = useMonthGuides
    ? monthStarts
        .map((i) => {
          const x = xAt(i);
          return `<line x1="${x}" y1="${padding.top}" x2="${x}" y2="${chartBottom}" stroke="var(--border)" stroke-width="1"></line>`;
        })
        .join('')
    : '';

  const candles = bars.map((b, i) => {
    const isUp = b.close >= b.open;
    // Taiwan/Chinese convention: red = price up, green = price down.
    const color = isUp ? 'var(--red)' : 'var(--green)';
    // Solid-filled body (not just an outline) for both directions.
    const bg = color;
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

  const markerEls = sortedMarkers.map((m, i) => {
    if (m.index < 0 || m.index >= bars.length) return '';
    const x = xAt(m.index);
    const candleTopY = yAt(bars[m.index].high);
    const circleY = candleTopY - 6;
    const textY = circleY - 28 - markerStaggerLevels[i] * 22;
    return `
      <line x1="${x}" y1="${textY + 6}" x2="${x}" y2="${circleY - 6}" stroke="${m.color}" stroke-width="1.2"></line>
      <circle cx="${x}" cy="${circleY}" r="4" fill="var(--bg)" stroke="${m.color}" stroke-width="2"></circle>
      <text x="${x}" y="${textY}" text-anchor="middle" font-size="16" fill="${m.color}" font-weight="700">${m.label}</text>
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

  // X-axis: baseline along the bottom, a tick + ROC-year date label at each
  // month boundary (the full-height guide for the same boundary is drawn
  // behind the candles, above), and a short unlabeled tick at the first
  // trading day of each ISO week for finer granularity without crowding
  // the labels.
  const axisTop = chartBottom + 4;
  const weekTickY2 = axisTop + 5;
  const monthTickY2 = axisTop + 6;
  const labelY = axisTop + 17;
  const axisEls = [`<line x1="${padding.left}" y1="${axisTop}" x2="${width - padding.right}" y2="${axisTop}" stroke="var(--border)" stroke-width="1"></line>`];

  if (useMonthGuides) {
    const monthStartSet = new Set(monthStarts);
    let prevWeekKey = null;
    for (let i = 0; i < bars.length; i++) {
      const x = xAt(i);
      const weekKey = isoWeekKey(bars[i].date);
      const isNewWeek = weekKey !== prevWeekKey;
      prevWeekKey = weekKey;
      if (monthStartSet.has(i)) {
        axisEls.push(`<line x1="${x}" y1="${axisTop}" x2="${x}" y2="${monthTickY2}" stroke="var(--text-faint)" stroke-width="1.4"></line>`);
        axisEls.push(`<text x="${x}" y="${labelY}" text-anchor="middle" font-size="10" fill="var(--text-faint)" font-weight="600">${rocMonthLabel(bars[i].date)}</text>`);
      } else if (isNewWeek) {
        // First trading day actually present for this ISO week — not
        // necessarily a Monday, since a week's trading days aren't fixed at 5.
        axisEls.push(`<line x1="${x}" y1="${axisTop}" x2="${x}" y2="${weekTickY2}" stroke="var(--text-faint)" stroke-width="1"></line>`);
      }
    }
  } else {
    // Bars span too short a range for month boundaries to be useful —
    // fall back to evenly spaced labels instead.
    const maxLabels = Math.max(2, Math.min(6, Math.floor(width / 130)));
    const labelStep = Math.max(1, Math.ceil(bars.length / maxLabels));
    for (let i = 0; i < bars.length; i += labelStep) {
      const x = xAt(i);
      axisEls.push(`<line x1="${x}" y1="${axisTop}" x2="${x}" y2="${weekTickY2}" stroke="var(--text-faint)" stroke-width="1"></line>`);
      axisEls.push(`<text x="${x}" y="${labelY}" text-anchor="middle" font-size="10" fill="var(--text-faint)">${bars[i].date.slice(5)}</text>`);
    }
  }
  const axis = axisEls.join('');

  return `
    <svg viewBox="0 0 ${width} ${totalHeight}" style="display:block; width:100%; height:auto;">
      ${gridLines}
      ${monthGuides}
      ${maLines}
      ${candles}
      ${markerEls}
      ${volumeBars}
      ${axis}
    </svg>
  `;
}

export { renderKLineChart };
