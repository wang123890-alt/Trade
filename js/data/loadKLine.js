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

// 持股頁「更新」／「全部更新」按下去的當下，就該讓之後再打開的任何頁面
// （個股詳細頁、覆盤頁、觀察名單——全部走同一個loadKLineFast）看到新
// K線，不是乾等FRESH_MS過期才觸發背景重抓。只刪mem不夠：loadKLineFast
// 在mem沒有時會退回讀disk cache，disk那份的cachedAt若還在FRESH_MS內，
// 下一次呼叫一樣會判定「還新鮮」直接吃掉、完全不會觸發startFresh()，
// 所以mem跟disk兩層都要清，下一次loadKLineFast()才會真的走全新fetch
// （不是stale-while-revalidate那種先吐舊資料、背景才更新的路徑）。
function invalidateKLineCache(stockId) {
  if (stockId) {
    delete mem[stockId];
  } else {
    for (const id of Object.keys(mem)) delete mem[id];
  }
  try {
    const all = JSON.parse(localStorage.getItem(DISK_KEY) || '{}');
    if (stockId) {
      delete all[stockId];
    } else {
      for (const id of Object.keys(all)) delete all[id];
    }
    localStorage.setItem(DISK_KEY, JSON.stringify(all));
  } catch { /* no localStorage (tests/SSR) or quota — mem is already cleared, good enough */ }
}

export { loadKLineFast, invalidateKLineCache, FRESH_MS as CACHE_TTL_MS };
