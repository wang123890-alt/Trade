import { FinMindProvider, YahooFinanceProvider } from './marketdata.js';
import { getTodayBar } from './twseDailyKLine.js';

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
  if (mem[id]?.bars?.length) return mem[id];
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
      const hit = { bars, source };
      mem[id] = hit;
      return hit;
    } finally {
      delete inflight[id];
    }
  })();

  return inflight[id];
}

export { loadKLineFast };
