import { TwseDailyKLineProvider } from './twseDailyKLine.js';
import { FinMindProvider, YahooFinanceProvider } from './marketdata.js';

async function loadKLineFast(stockId) {
  try {
    return await Promise.any([
      TwseDailyKLineProvider.getKLine(stockId).then((bars) => {
        if (!bars?.length) throw new Error('empty');
        return { bars, source: '證交所' };
      }),
      YahooFinanceProvider.getKLine(stockId).then((bars) => {
        if (!bars?.length) throw new Error('empty');
        return { bars, source: '雅虎股市' };
      }),
    ]);
  } catch {
    const bars = await FinMindProvider.getKLine(stockId);
    return { bars, source: 'FinMind' };
  }
}

export { loadKLineFast };
