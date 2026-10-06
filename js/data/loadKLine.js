import { FinMindProvider, YahooFinanceProvider } from './marketdata.js';
import { getTodayBar } from './twseDailyKLine.js';

const FRESH_MS = 60 * 1000;
const DISK_KEY = 'trade_app.kline_fast.v1';

const mem = {};
const inflight = {};

function mergeToday(bars, today) {
  if (!today) return bars || [];
  const byDate = new Map((bars || []).map((b) => [b.date, b]));
  const existing = byDate.get(today.date);
  if (!existing || existing.close !== today.close) byDate.set(today.date, today);
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function readDisk(id) {
  try {
    const all = JSON.parse(localStorage.getItem(DISK_KEY) || '{}');
    const hit = all[id];
    if (!hit?.bars?.length) return null;
    return hit;
  } catch {
    return null;
  }
}

function writeDisk(id, hit) {
  try {
    const all = JSON.parse(localStorage.getItem(DISK_KEY) || '{}');
    all[id] = { bars: hit.bars, source: hit.source, cachedAt: hit.cachedAt };
    const keys = Object.keys(all);
    if (keys.length > 30) {
      keys.sort((a, b) => (all[a].cachedAt || 0) - (all[b].cachedAt || 0));
      for (const k of keys.slice(0, keys.length - 30)) delete all[k];
    }
    localStorage.setItem(DISK_KEY, JSON.stringify(all));
  } catch { /* quota */ }
}

async function fetchFresh(id) {
  const histP = Promise.any([
    YahooFinanceProvider.getKLine(id).then((bars) => {
      if (!bars?.length) throw new Error('empty');
      return { bars, source: '雅虎股市' };
    }),
    FinMindProvider.getKLine(id).then((bars) => {
      if (!bars?.length) throw new Error('empty');
      return { bars, source: 'FinMind' };
    }),
  ]).catch(() => null);
  const todayP = getTodayBar(id).catch(() => null);
  const [hist, today] = await Promise.all([histP, todayP]);
  const bars = mergeToday(hist?.bars, today);
  if (!bars.length) throw new Error('empty');
  const source = today ? `${hist?.source || '證交所今日'} · 證交所今日` : (hist?.source || '');
  const hit = { bars, source, cachedAt: Date.now() };
  mem[id] = hit;
  writeDisk(id, hit);
  return hit;
}

function startFresh(id) {
  if (inflight[id]) return inflight[id];
  inflight[id] = fetchFresh(id).finally(() => { delete inflight[id]; });
  return inflight[id];
}

async function loadKLineFast(stockId) {
  const id = String(stockId || '').trim();
  if (!id) return { bars: [], source: '' };
  const cached = mem[id] || readDisk(id);
  if (cached?.bars?.length) {
    mem[id] = cached;
    const stale = Date.now() - (cached.cachedAt || 0) >= FRESH_MS;
    return stale ? { ...cached, refresh: startFresh(id) } : cached;
  }
  return startFresh(id);
}

export { loadKLineFast, FRESH_MS as CACHE_TTL_MS };
