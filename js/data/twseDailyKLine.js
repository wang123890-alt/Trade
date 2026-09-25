import { MarketDataError } from './marketdata.js';

const DIRECT_TIMEOUT_MS = 2500;
const PROXY_TIMEOUT_MS = 6000;
const CACHE_TTL_MS = 20 * 60 * 1000;
const CACHE_KEY = 'trade_app.kline_cache.v1';
const TWSE_REALTIME_BASE = 'https://mis.twse.com.tw/stock/api/getStockInfo.jsp';
const CORS_PROXIES = [
  (target) => `https://r.jina.ai/${target}`,
  (target) => `https://api.allorigins.win/raw?url=${encodeURIComponent(target)}`,
];

const memCache = {};

function readDiskCache(stockId) {
  try {
    const all = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
    const hit = all[stockId];
    if (!hit || Date.now() - hit.at > CACHE_TTL_MS) return null;
    return hit.bars;
  } catch {
    return null;
  }
}

function writeDiskCache(stockId, bars) {
  try {
    const all = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
    all[stockId] = { at: Date.now(), bars };
    const keys = Object.keys(all);
    if (keys.length > 40) {
      keys.sort((a, b) => (all[a].at || 0) - (all[b].at || 0));
      for (const k of keys.slice(0, keys.length - 40)) delete all[k];
    }
    localStorage.setItem(CACHE_KEY, JSON.stringify(all));
  } catch { /* quota */ }
}

async function fetchWithTimeout(url, options = {}, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function parseJsonLoose(text) {
  try {
    return JSON.parse(text);
  } catch (err) {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end <= start) throw err;
    return JSON.parse(text.slice(start, end + 1));
  }
}

async function fetchJsonWithProxyFallback(targetUrl) {
  try {
    const response = await fetchWithTimeout(targetUrl, {}, DIRECT_TIMEOUT_MS);
    if (response.ok) return parseJsonLoose(await response.text());
  } catch { /* CORS */ }
  const proxyAttempts = CORS_PROXIES.map(async (buildProxyUrl) => {
    const response = await fetchWithTimeout(buildProxyUrl(targetUrl), {}, PROXY_TIMEOUT_MS);
    if (!response.ok) throw new Error(`proxy HTTP ${response.status}`);
    return parseJsonLoose(await response.text());
  });
  try {
    return await Promise.any(proxyAttempts);
  } catch {
    return null;
  }
}

function rocDateToIso(s) {
  const m = String(s).match(/(\d{2,3})\/(\d{1,2})\/(\d{1,2})/);
  if (!m) return null;
  const y = Number(m[1]) + 1911;
  return `${y}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
}

function parseTwseNum(v) {
  if (v == null) return null;
  const n = parseFloat(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function parseTwseDate(d) {
  if (!d || d.length !== 8) return new Date().toISOString().slice(0, 10);
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}

function defaultStartDate() {
  const d = new Date();
  d.setMonth(d.getMonth() - 4);
  return d.toISOString().slice(0, 10);
}

function monthKeys(startDate) {
  const start = new Date(`${startDate || defaultStartDate()}T00:00:00Z`);
  const now = new Date();
  const keys = [];
  const cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  while (cur <= end) {
    keys.push({
      yyyymmdd: `${cur.getUTCFullYear()}${String(cur.getUTCMonth() + 1).padStart(2, '0')}01`,
      rocYm: `${cur.getUTCFullYear() - 1911}/${String(cur.getUTCMonth() + 1).padStart(2, '0')}`,
    });
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }
  return keys;
}

function parseStockDayPayload(payload) {
  const rows = payload?.data;
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const bars = [];
  for (const r of rows) {
    const date = rocDateToIso(r[0]);
    const close = parseTwseNum(r[6]);
    if (!date || close == null) continue;
    bars.push({
      date,
      open: parseTwseNum(r[3]),
      high: parseTwseNum(r[4]),
      low: parseTwseNum(r[5]),
      close,
      volume: parseTwseNum(r[1]),
    });
  }
  return bars;
}

function parseTpexSt43(payload) {
  const rows = payload?.aaData || payload?.data || payload?.tables?.[0]?.data;
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const bars = [];
  for (const r of rows) {
    const date = rocDateToIso(r[0]);
    const close = parseTwseNum(r[6]);
    if (!date || close == null) continue;
    const lots = parseTwseNum(r[1]);
    bars.push({
      date,
      open: parseTwseNum(r[3]),
      high: parseTwseNum(r[4]),
      low: parseTwseNum(r[5]),
      close,
      volume: lots == null ? null : lots * 1000,
    });
  }
  return bars;
}

function parseMisIntradayBar(row) {
  if (!row) return null;
  const date = parseTwseDate(row.d);
  const close = parseTwseNum(row.z) ?? parseTwseNum(row.trade?.z);
  const open = parseTwseNum(row.o);
  if (close == null || open == null) return null;
  const high = parseTwseNum(row.h);
  const low = parseTwseNum(row.l);
  const lots = parseTwseNum(row.v);
  return {
    date,
    open,
    high: high ?? close,
    low: low ?? close,
    close,
    volume: lots == null ? null : lots * 1000,
  };
}

async function fetchMonth(stockId, m, market) {
  if (market !== 'otc') {
    const url = `https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=${m.yyyymmdd}&stockNo=${encodeURIComponent(stockId)}`;
    const bars = parseStockDayPayload(await fetchJsonWithProxyFallback(url));
    if (bars.length) return { market: 'tse', bars };
  }
  if (market !== 'tse') {
    const url = `https://www.tpex.org.tw/web/stock/aftertrading/daily_trading_info/st43_result.php?l=zh-tw&d=${encodeURIComponent(m.rocYm)}&stkno=${encodeURIComponent(stockId)}`;
    const bars = parseTpexSt43(await fetchJsonWithProxyFallback(url));
    if (bars.length) return { market: 'otc', bars };
  }
  return { market, bars: [] };
}

const TwseDailyKLineProvider = {
  async getKLine(stockId, { startDate } = {}) {
    const cached = memCache[stockId] || readDiskCache(stockId);
    if (cached?.length) return startDate ? cached.filter((b) => b.date >= startDate) : cached;

    const months = monthKeys(startDate);
    const latest = months[months.length - 1];
    const probe = await fetchMonth(stockId, latest, null);
    const market = probe.market;
    const rest = months.slice(0, -1);
    const parts = await Promise.all(rest.map((m) => fetchMonth(stockId, m, market)));
    const all = [...parts.flatMap((p) => p.bars), ...probe.bars];
    if (all.length === 0) throw new MarketDataError('證交所盤後日K無法取得');

    const byDate = new Map();
    for (const b of all) byDate.set(b.date, b);

    const misUrl = `${TWSE_REALTIME_BASE}?ex_ch=tse_${stockId}.tw|otc_${stockId}.tw&json=1&delay=0`;
    const mis = await fetchJsonWithProxyFallback(misUrl);
    for (const row of mis?.msgArray || []) {
      const bar = parseMisIntradayBar(row);
      if (!bar) continue;
      const existing = byDate.get(bar.date);
      if (!existing || existing.close !== bar.close) byDate.set(bar.date, bar);
    }
    const merged = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
    memCache[stockId] = merged;
    writeDiskCache(stockId, merged);
    return startDate ? merged.filter((b) => b.date >= startDate) : merged;
  },
};

export { TwseDailyKLineProvider };
