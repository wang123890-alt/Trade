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

function pnlClass(n) {
  if (n == null) return 'text-dim';
  return n > 0 ? 'text-green' : n < 0 ? 'text-red' : 'text-dim';
}

export { formatMoney, formatPercent, formatDate, pnlClass };
