import { TransactionRepository, WatchlistRepository } from './storage.js';

const DIRECT_TIMEOUT_MS = 2500;
const PROXY_TIMEOUT_MS = 6000;
const MIS = 'https://mis.twse.com.tw/stock/api/getStockInfo.jsp';
const CACHE_KEY = 'trade_app.stock_lookup.v1';

function localPairs() {
  const byId = {};
  const byName = {};
  const add = (id, name) => {
    if (!id || !name) return;
    const i = String(id).trim();
    const n = String(name).trim();
    byId[i] = n;
    byName[n] = i;
  };
  for (const t of TransactionRepository.getAll()) add(t.stockId, t.stockName);
  for (const w of WatchlistRepository.getAll()) add(w.stockId, w.stockName);
  try {
    const extra = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
    for (const [i, n] of Object.entries(extra)) add(i, n);
  } catch { /* ignore */ }
  return { byId, byName };
}

function remember(id, name) {
  if (!id || !name) return;
  try {
    const extra = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
    extra[id] = name;
    localStorage.setItem(CACHE_KEY, JSON.stringify(extra));
  } catch { /* ignore */ }
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function misName(stockId) {
  const target = `${MIS}?ex_ch=tse_${stockId}.tw|otc_${stockId}.tw&json=1&delay=0`;
  const urls = [target, `https://r.jina.ai/${target}`];
  for (const url of urls) {
    try {
      const res = await fetchWithTimeout(url, url === target ? DIRECT_TIMEOUT_MS : PROXY_TIMEOUT_MS);
      if (!res.ok) continue;
      const text = await res.text();
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start < 0) continue;
      const json = JSON.parse(text.slice(start, end + 1));
      const row = json?.msgArray?.[0];
      const name = row?.n || row?.nf;
      if (name) {
        remember(stockId, name);
        return name;
      }
    } catch { /* next */ }
  }
  return null;
}

async function lookupById(stockId) {
  const id = String(stockId || '').trim();
  if (!id) return null;
  const { byId } = localPairs();
  if (byId[id]) return { stockId: id, stockName: byId[id] };
  const name = await misName(id);
  return name ? { stockId: id, stockName: name } : null;
}

function lookupByName(stockName) {
  const name = String(stockName || '').trim();
  if (!name) return null;
  const { byName } = localPairs();
  if (byName[name]) return { stockId: byName[name], stockName: name };
  const hit = Object.entries(byName).find(([n]) => n.includes(name) || name.includes(n));
  if (hit) return { stockId: hit[1], stockName: hit[0] };
  return null;
}

export { lookupById, lookupByName };
