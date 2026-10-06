import { TransactionRepository, WatchlistRepository } from './storage.js';

const DIRECT_TIMEOUT_MS = 2500;
const PROXY_TIMEOUT_MS = 6000;
const MIS = 'https://mis.twse.com.tw/stock/api/getStockInfo.jsp';
const CACHE_KEY = 'trade_app.stock_lookup.v1';
const DIR_KEY = 'trade_app.stock_dir.v1';
const DIR_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TWSE_LIST = 'https://openapi.twse.com.tw/v1/opendata/t187ap03_L';
const TPEX_LIST = 'https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O';

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
  try {
    const dir = JSON.parse(localStorage.getItem(DIR_KEY) || 'null');
    if (dir?.byId) {
      for (const [i, n] of Object.entries(dir.byId)) add(i, n);
    }
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

function matchName(name, byName) {
  if (byName[name]) return { stockId: byName[name], stockName: name };
  const hit = Object.entries(byName).find(([n]) => n.includes(name) || name.includes(n));
  if (hit) return { stockId: hit[1], stockName: hit[0] };
  return null;
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

async function loadDirectory() {
  try {
    const cached = JSON.parse(localStorage.getItem(DIR_KEY) || 'null');
    if (cached?.savedAt && Date.now() - cached.savedAt < DIR_TTL_MS && cached.byId) return cached.byId;
  } catch { /* refetch */ }
  const byId = {};
  const pull = async (url, idKey, nameKey) => {
    try {
      const res = await fetchWithTimeout(url, 8000);
      if (!res.ok) return;
      const rows = await res.json();
      if (!Array.isArray(rows)) return;
      for (const row of rows) {
        const id = String(row[idKey] || '').trim();
        const name = String(row[nameKey] || row['公司簡稱'] || '').trim();
        if (id && name) byId[id] = name;
      }
    } catch { /* next source */ }
  };
  await pull(TWSE_LIST, '公司代號', '公司簡稱');
  await pull(TPEX_LIST, '公司代號', '公司簡稱');
  if (Object.keys(byId).length > 0) {
    try {
      localStorage.setItem(DIR_KEY, JSON.stringify({ savedAt: Date.now(), byId }));
    } catch { /* quota */ }
  }
  return byId;
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

async function lookupByName(stockName) {
  const name = String(stockName || '').trim();
  if (!name) return null;
  const local = matchName(name, localPairs().byName);
  if (local) return local;
  const dir = await loadDirectory();
  const byName = {};
  for (const [id, n] of Object.entries(dir)) byName[n] = id;
  const hit = matchName(name, byName);
  if (hit) remember(hit.stockId, hit.stockName);
  return hit;
}

export { lookupById, lookupByName };
