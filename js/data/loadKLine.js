import { TwseDailyKLineProvider } from './twseDailyKLine.js';
import { FinMindProvider, YahooFinanceProvider } from './marketdata.js';

const mem = {};
const inflight = {};

async function loadKLineFast(stockId) {
  const id = String(stockId || '').trim();
  if (!id) return { bars: [], source: '' };
  if (mem[id]?.bars?.length) return mem[id];
  if (inflight[id]) return inflight[id];

  inflight[id] = (async () => {
    try {
      const hit = await Promise.any([
        TwseDailyKLineProvider.getKLine(id).then((bars) => {
          if (!bars?.length) throw new Error('empty');
          return { bars, source: '證交所' };
        }),
        YahooFinanceProvider.getKLine(id).then((bars) => {
          if (!bars?.length) throw new Error('empty');
          return { bars, source: '雅虎股市' };
        }),
      ]);
      mem[id] = hit;
      return hit;
    } catch {
      const bars = await FinMindProvider.getKLine(id);
      const hit = { bars, source: 'FinMind' };
      if (bars?.length) mem[id] = hit;
      return hit;
    } finally {
      delete inflight[id];
    }
  })();

  return inflight[id];
}

export { loadKLineFast };
