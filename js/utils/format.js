function formatMoney(n) {
  if (n == null || Number.isNaN(n)) return '—';
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(n).toLocaleString('zh-TW', { maximumFractionDigits: 0 })}`;
}

function formatPercent(n) {
  if (n == null || Number.isNaN(n)) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('zh-TW', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('zh-TW', { hour: '2-digit', minute: '2-digit' });
}

function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('zh-TW', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

// Every stock name/id and free-text tag (strategy, note, AI analysis...) is
// user-entered and ends up interpolated into innerHTML across the views —
// escaping it here once, and importing this everywhere, is what keeps a
// stock named e.g. `<img src=x onerror=...>` (typed directly, or arriving
// via a merged backup-file import) from executing instead of just
// displaying. Escapes quotes too so the same helper is also safe to use
// inside a double-quoted HTML attribute (e.g. data-stock-id="${...}"), not
// only inside element text content.
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function pnlClass(n) {
  if (n == null) return 'text-dim';
  // Taiwan convention: red = 上漲/獲利, green = 下跌/虧損, 平盤（0）維持預設白字。
  return n > 0 ? 'text-red' : n < 0 ? 'text-green' : '';
}

export { formatMoney, formatPercent, formatDate, formatTime, formatDateTime, pnlClass, escapeHtml };
