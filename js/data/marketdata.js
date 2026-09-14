// MarketDataProvider: the only module that knows where price data comes
// from. Everything else calls getKLine()/getQuote() on the shape below —
// swapping FinMind for another source, or adding a fallback, never touches
// callers.
//
// Provider contract:
//   getKLine(stockId, { startDate, endDate }) -> Promise<Bar[]>
//   getQuote(stockId) -> Promise<{ price: number, date: string } | null>
// Bar = { date: 'YYYY-MM-DD', open, high, low, close, volume }
//
// A provider throws MarketDataError on failure (network, rate limit,
// unexpected response shape) rather than returning null/[] silently — the
// caller decides whether that means "show an error" or "fall back to CSV".

class MarketDataError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'MarketDataError';
    this.cause = cause;
  }
}

const FINMIND_BASE = 'https://api.finmindtrade.com/api/v4/data';

const FinMindProvider = {
  async getKLine(stockId, { startDate, endDate } = {}) {
    const params = new URLSearchParams({
      dataset: 'TaiwanStockPrice',
      data_id: stockId,
      start_date: startDate || defaultStartDate(),
    });
    if (endDate) params.set('end_date', endDate);

    let response;
    try {
      response = await fetch(`${FINMIND_BASE}?${params.toString()}`);
    } catch (err) {
      throw new MarketDataError('無法連線到 FinMind API', err);
    }

    if (!response.ok) {
      throw new MarketDataError(`FinMind API 回應錯誤：HTTP ${response.status}`);
    }

    let payload;
    try {
      payload = await response.json();
    } catch (err) {
      throw new MarketDataError('FinMind API 回應格式無法解析', err);
    }

    if (payload.status !== 200 || !Array.isArray(payload.data)) {
      throw new MarketDataError(payload.msg || 'FinMind API 回傳非預期格式');
    }

    return payload.data.map((row) => ({
      date: row.date,
      open: row.open,
      high: row.max,
      low: row.min,
      close: row.close,
      volume: row.Trading_Volume,
    }));
  },

  async getQuote(stockId) {
    // FinMind's free tier has no true intraday quote; the latest daily bar's
    // close stands in for "current price". Prefer TwseRealtimeProvider (or
    // getLiveQuote below) when an intraday price is wanted.
    const today = new Date();
    const start = new Date(today);
    start.setDate(start.getDate() - 10); // small window, just need the latest bar
    const bars = await FinMindProvider.getKLine(stockId, {
      startDate: start.toISOString().slice(0, 10),
    });
    if (bars.length === 0) return null;
    const latest = bars[bars.length - 1];
    return { price: latest.close, date: latest.date };
  },
};

const TWSE_REALTIME_BASE = 'https://mis.twse.com.tw/stock/api/getStockInfo.jsp';

function parseTwseDate(d) {
  if (!d || d.length !== 8) return new Date().toISOString().slice(0, 10);
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}

/** Best-effort intraday quote from TWSE's public real-time feed
 * (mis.twse.com.tw — the same source most Taiwan stock apps/sites use for
 * live quotes). Free, no API key, but unofficial: never throws, just
 * returns null on any failure so callers fall back to a daily close. */
const TwseRealtimeProvider = {
  async getQuote(stockId) {
    // A stock's market (上市 vs 上櫃) isn't known ahead of time, so try
    // both prefixes — the wrong one simply comes back with no match.
    for (const market of ['tse', 'otc']) {
      try {
        const url = `${TWSE_REALTIME_BASE}?ex_ch=${market}_${stockId}.tw&json=1&delay=0`;
        const response = await fetch(url);
        if (!response.ok) continue;
        const payload = await response.json();
        const row = payload?.msgArray?.[0];
        if (!row) continue;
        const date = parseTwseDate(row.d);
        const traded = parseFloat(row.z); // 最新成交價；開盤前/無成交時是 '-'
        if (Number.isFinite(traded)) return { price: traded, date, isIntraday: true };
        const prevClose = parseFloat(row.y); // 昨收，作為尚無成交時的退而求其次
        if (Number.isFinite(prevClose)) return { price: prevClose, date, isIntraday: false };
      } catch (err) {
        // Network error, blocked, or unexpected shape — try the other
        // market prefix, then give up (getLiveQuote falls back to FinMind).
      }
    }
    return null;
  },

  /** Batch quote for many stocks in ONE request per market prefix, instead of
   * one request per stock. TWSE's `ex_ch` param accepts a "|"-joined list
   * (e.g. `tse_2330.tw|tse_2317.tw`) — firing a separate request per stock in
   * a tight loop (as looping getQuote() would for a "update all holdings"
   * button) trips their anti-scraping throttle during market hours once
   * there are more than a couple of stocks, even though a single stock's
   * update works fine. Returns { [stockId]: {price,date,isIntraday} },
   * omitting any stockId that didn't match on either market (caller falls
   * back to Yahoo/FinMind for those). Never throws. */
  async getQuotes(stockIds) {
    const result = {};
    let remaining = [...new Set(stockIds)];
    for (const market of ['tse', 'otc']) {
      if (remaining.length === 0) break;
      try {
        const query = remaining.map((id) => `${market}_${id}.tw`).join('|');
        const url = `${TWSE_REALTIME_BASE}?ex_ch=${query}&json=1&delay=0`;
        const response = await fetch(url);
        if (response.ok) {
          const payload = await response.json();
          for (const row of payload?.msgArray || []) {
            const id = row.c; // stock code
            if (!id || result[id]) continue;
            const date = parseTwseDate(row.d);
            const traded = parseFloat(row.z);
            if (Number.isFinite(traded)) { result[id] = { price: traded, date, isIntraday: true }; continue; }
            const prevClose = parseFloat(row.y);
            if (Number.isFinite(prevClose)) result[id] = { price: prevClose, date, isIntraday: false };
          }
        }
      } catch (err) {
        // Network error or blocked — leave these for the OTC pass (or the
        // caller's per-stock Yahoo/FinMind fallback if that fails too).
      }
      remaining = remaining.filter((id) => !result[id]);
    }
    return result;
  },
};

// Yahoo Finance's chart API (query1.finance.yahoo.com) has real intraday
// data for TW-listed stocks but sends no CORS header, so a pure front-end
// page (no backend of its own) cannot read its response directly. Routed
// through a public CORS-passthrough proxy instead — the proxy only relays
// bytes, it never sees anything besides the stock code being requested.
// Public proxies are themselves flaky (observed both of these return a
// transient 5xx within the same minute during testing), so more than one is
// tried in order rather than trusting a single one to be up.
const CORS_PROXIES = [
  (target) => `https://api.allorigins.win/raw?url=${encodeURIComponent(target)}`,
  (target) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(target)}`,
];
const YAHOO_CHART_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';

/** Best-effort intraday quote from Yahoo Finance, used when TWSE's own feed
 * doesn't come back with anything. Tries the listed (.TW) suffix first, then
 * OTC (.TWO) — same reasoning as TwseRealtimeProvider not knowing a stock's
 * market ahead of time — and for each suffix tries each CORS proxy in turn.
 * Never throws; returns null when nothing works. */
const YahooFinanceProvider = {
  async getQuote(stockId) {
    for (const suffix of ['TW', 'TWO']) {
      const target = `${YAHOO_CHART_BASE}/${stockId}.${suffix}?interval=1m&range=1d`;
      for (const buildProxyUrl of CORS_PROXIES) {
        try {
          const response = await fetch(buildProxyUrl(target));
          if (!response.ok) continue;
          const payload = await response.json();
          const meta = payload?.chart?.result?.[0]?.meta;
          if (!meta) continue;
          const price = meta.regularMarketPrice;
          if (!Number.isFinite(price)) continue;
          const date = meta.regularMarketTime
            ? new Date(meta.regularMarketTime * 1000).toISOString().slice(0, 10)
            : new Date().toISOString().slice(0, 10);
          return { price, date, isIntraday: true };
        } catch (err) {
          // This proxy is down or the response was unexpected — try the
          // next proxy, then the OTC suffix, then give up (getLiveQuote
          // falls back to FinMind).
        }
      }
    }
    return null;
  },
};

/** The quote callers should actually use: TWSE's live feed first, Yahoo
 * Finance (via CORS proxy) if that has nothing, and FinMind's daily close
 * only as the last resort — FinMind is only ever accurate after the market
 * closes, so it's a safety net rather than a real intraday source. */
async function getLiveQuote(stockId) {
  const twse = await TwseRealtimeProvider.getQuote(stockId);
  if (twse) return twse;
  const yahoo = await YahooFinanceProvider.getQuote(stockId);
  if (yahoo) return yahoo;
  return FinMindProvider.getQuote(stockId);
}

/** Like getLiveQuote, but for many stocks at once — used by a bulk "update
 * all holdings" action. Fetches TWSE in one batched call (see
 * TwseRealtimeProvider.getQuotes) instead of looping getLiveQuote() per
 * stock, which would fire one separate TWSE request per stock and trip its
 * anti-scraping throttle during market hours. Anything TWSE didn't match
 * still falls back to Yahoo, then FinMind, per stock.
 * Returns { [stockId]: {price,date,isIntraday} }, omitting stocks nothing
 * could quote. Never throws. */
async function getLiveQuotes(stockIds) {
  const result = await TwseRealtimeProvider.getQuotes(stockIds);
  const missing = stockIds.filter((id) => !result[id]);
  for (const id of missing) {
    try {
      const yahoo = await YahooFinanceProvider.getQuote(id);
      if (yahoo) { result[id] = yahoo; continue; }
      const finmind = await FinMindProvider.getQuote(id);
      if (finmind) result[id] = finmind;
    } catch (err) {
      // This stock's fallback chain failed entirely — leave it out of the
      // result; the caller (bulk update) just skips it and moves on.
    }
  }
  return result;
}

/** Fallback when the live provider is unreachable: parse a user-pasted CSV.
 * Expected columns (header row required): date,open,high,low,close,volume */
const CsvProvider = {
  parse(csvText) {
    const lines = csvText.trim().split('\n').filter((l) => l.trim().length > 0);
    if (lines.length < 2) throw new MarketDataError('CSV 內容太少，至少需要標題列＋一筆資料');

    const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
    const required = ['date', 'open', 'high', 'low', 'close', 'volume'];
    for (const col of required) {
      if (!header.includes(col)) {
        throw new MarketDataError(`CSV 缺少必要欄位：${col}（需要 date,open,high,low,close,volume）`);
      }
    }

    return lines.slice(1).map((line) => {
      const cells = line.split(',');
      const row = {};
      header.forEach((col, i) => { row[col] = cells[i]; });
      return {
        date: row.date,
        open: parseFloat(row.open),
        high: parseFloat(row.high),
        low: parseFloat(row.low),
        close: parseFloat(row.close),
        volume: parseFloat(row.volume),
      };
    });
  },
};

function defaultStartDate() {
  const d = new Date();
  d.setMonth(d.getMonth() - 6); // ~6 months of daily bars by default
  return d.toISOString().slice(0, 10);
}

export { FinMindProvider, TwseRealtimeProvider, YahooFinanceProvider, getLiveQuote, getLiveQuotes, CsvProvider, MarketDataError };
