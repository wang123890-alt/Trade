import { FinMindProvider, YahooFinanceProvider } from './marketdata.js';
import { getTodayBar } from './twseDailyKLine.js';

// 2026-10-05: 使用者回報「盤中價格有更新、K線沒更新」——根因是這份
// memory cache原本完全沒有過期時間，同一檔股票一旦在這個session抓過一
// 次，之後不管隔多久重新進個股詳細頁都是吃同一份快取（hash router的SPA
// 導航不會重新載入模組，`mem`活在整個session），跟持股頁即時報價
// （getLiveQuote，完全沒有快取）是兩條完全獨立的路徑，所以才會看到
// 「價格新、K線舊」這種分裂的狀態。CACHE_TTL_MS讓快取會過期：盤中短時
// 間內重複切換個股頁還是吃快取（不會每次都重打），但超過這個時間再回
// 來就會真的重抓一次，merge進當日MIS這根未收盤的K棒。
const CACHE_TTL_MS = 60 * 1000;

const mem = {};
const inflight = {};

function mergeToday(bars, today) {
  if (!today) return bars;
  const byDate = new Map(bars.map((b) => [b.date, b]));
  const existing = byDate.get(today.date);
  if (!existing || existing.close !== today.close) byDate.set(today.date, today);
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

async function historyOnce(stockId) {
  try {
    const bars = await YahooFinanceProvider.getKLine(stockId);
    if (bars?.length) return { bars, source: '雅虎股市' };
  } catch { /* next */ }
  const bars = await FinMindProvider.getKLine(stockId);
  if (!bars?.length) throw new Error('empty');
  return { bars, source: 'FinMind' };
}

async function loadKLineFast(stockId) {
  const id = String(stockId || '').trim();
  if (!id) return { bars: [], source: '' };
  const cached = mem[id];
  if (cached?.bars?.length && Date.now() - cached.cachedAt < CACHE_TTL_MS) return cached;
  if (inflight[id]) return inflight[id];

  inflight[id] = (async () => {
    try {
      const hist = await historyOnce(id);
      let today = null;
      try {
        today = await getTodayBar(id);
      } catch { /* history is enough */ }
      const bars = mergeToday(hist.bars, today);
      const source = today ? `${hist.source} · 證交所今日` : hist.source;
      const hit = { bars, source, cachedAt: Date.now() };
      mem[id] = hit;
      return hit;
    } finally {
      delete inflight[id];
    }
  })();

  return inflight[id];
}

export { loadKLineFast, CACHE_TTL_MS };
