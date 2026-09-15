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

// A person clicking "更新" is watching the button, so every attempt gets a
// short leash rather than the generous timeout a background job could
// afford — modeled on this project's own Choose repo (a Python backend that
// hits the same TWSE endpoint server-side, so it never deals with CORS at
// all): it gives an interactive quote fetch a single attempt on a 3-second
// timeout rather than retrying with backoff. This module can't skip CORS the
// way a backend can, but it borrows the same "short leash, then move on"
// philosophy: a slow attempt is abandoned quickly, and — critically —
// independent attempts (both market prefixes, both CORS proxies) run in
// PARALLEL instead of one after another, so a multi-layer fallback chain
// costs roughly its slowest single step, not the sum of every step.
const DIRECT_TIMEOUT_MS = 3000;
// Relays are raced in parallel, so this only bounds how long a straggler is
// allowed to keep trying after the fast one has already answered — it costs
// nothing when any relay is healthy. It was 6s, which silently killed
// allorigins responses measured at 19s, leaving the whole chain to fall
// through to FinMind's stale daily close.
const PROXY_TIMEOUT_MS = 12000;
// FinMind's K-line history fetch isn't part of that interactive "更新"
// button flow — it's a chart load with its own "載入中" state — so it gets
// a more generous timeout than a live-quote attempt does.
const KLINE_TIMEOUT_MS = 10000;

// How long the official TWSE answer may hold up a quote that the parallel
// Yahoo request has probably already produced. TWSE via relay measured
// 3.0–4.8s on 2026-09-15 (Yahoo: 0.52–0.70s), so 6s covers a healthy TWSE
// while capping what a hung one can cost.
const TWSE_PREFERENCE_WINDOW_MS = 6000;

/** Every network call in this module goes through this instead of raw
 * fetch(). A plain fetch() has no timeout of its own — if a public endpoint
 * or CORS proxy hangs instead of failing outright, a quote fetch can look
 * frozen for a long time with no error and no way to recover except
 * reloading the page. Aborting after a fixed timeout guarantees every
 * attempt resolves (as a caught error) within a bounded time. */
async function fetchWithTimeout(url, options = {}, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Public CORS-passthrough relays — the relay only passes bytes through, it
// never sees anything besides the target URL being requested (a stock code,
// no user data). Needed because the quote sources below don't send CORS
// headers to arbitrary origins, so a pure front-end page (no backend of its
// own) can't read their responses directly.
//
// Order and membership here are measured, not guessed (2026-09-14, same
// minute, same target):
//   r.jina.ai       5/5 success, 0.53-0.76s, sends Access-Control-Allow-Origin
//   allorigins.win  2/5 success, and the successes took 3.6s and 19.3s
//   codetabs.com    0/5 — every attempt 522, the service itself is down
// codetabs was dropped for being entirely dead; allorigins stays as a
// second opinion only because it does sometimes work. They're raced in
// parallel (first usable answer wins), so a slow straggler costs nothing.
const CORS_PROXIES = [
  // Returns text/plain with a short header block ("Title: ... URL Source:
  // ... Markdown Content:") before the payload, so its JSON has to be
  // extracted from the text rather than read straight off the response.
  (target) => `https://r.jina.ai/${target}`,
  (target) => `https://api.allorigins.win/raw?url=${encodeURIComponent(target)}`,
];

/** Parse a response body that should contain JSON but might be wrapped in
 * surrounding text (r.jina.ai prefixes a plain-text header block). Falls
 * back to slicing from the first brace to the last. */
/** Resolve to null if `promise` hasn't settled within `ms`. Used to bound how
 * long a preferred-but-flaky source may delay an answer a parallel fallback
 * already has ready — the underlying request keeps its own AbortController
 * timeout, its result is simply no longer wanted. */
function withDeadline(promise, ms) {
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([promise.catch(() => null), deadline]).finally(() => clearTimeout(timer));
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

/** Fetch JSON from a URL that may not send CORS headers: try the request
 * directly first (cheap, short leash, and some public endpoints do allow
 * it), and if that's blocked or errors out, race every CORS proxy in
 * parallel and take whichever answers first. Returns the parsed JSON, or
 * null if every attempt failed. Never throws. */
async function fetchJsonWithProxyFallback(targetUrl) {
  try {
    const response = await fetchWithTimeout(targetUrl, {}, DIRECT_TIMEOUT_MS);
    if (response.ok) return parseJsonLoose(await response.text());
  } catch (err) {
    // Most likely a CORS rejection (the browser blocks the response before
    // it ever reaches this code) — fall through to a proxied retry instead
    // of giving up.
  }
  const proxyAttempts = CORS_PROXIES.map(async (buildProxyUrl) => {
    const response = await fetchWithTimeout(buildProxyUrl(targetUrl), {}, PROXY_TIMEOUT_MS);
    if (!response.ok) throw new Error(`proxy responded HTTP ${response.status}`);
    return parseJsonLoose(await response.text());
  });
  try {
    return await Promise.any(proxyAttempts);
  } catch (err) {
    // Every proxy failed (AggregateError) — nothing more to try here.
    return null;
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
      response = await fetchWithTimeout(`${FINMIND_BASE}?${params.toString()}`, {}, KLINE_TIMEOUT_MS);
    } catch (err) {
      throw new MarketDataError('無法連線到 FinMind API', err);
    }

    if (!response.ok) {
      throw new MarketDataError(`FinMind API 回應錯誤：HTTP ${response.status}`);
    }

    let payload;
    try {
      payload = parseJsonLoose(await response.text());
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
    return { price: latest.close, date: latest.date, isIntraday: false, source: `${latest.date.slice(5).replace('-', '/')}收盤` };
  },
};

const TWSE_REALTIME_BASE = 'https://mis.twse.com.tw/stock/api/getStockInfo.jsp';

function parseTwseDate(d) {
  if (!d || d.length !== 8) return new Date().toISOString().slice(0, 10);
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}

function parseTwseRow(row) {
  const date = parseTwseDate(row.d);
  // Every empty MIS field is the string '-', never null and never 0 (the same
  // trap wang123890-alt/Choose's fetcher documents). `z` is the price of the
  // most recent match, so mid-session it is blank surprisingly often —
  // measured 2026-09-15 12:03, 2454 had z '-' while it was plainly trading
  // (o 4505 / h 4575 / l 4465 / v 4007). `trade.z` carries that same last
  // trade (4495 at 12:01:56), so it's checked before giving up on today.
  const traded = parseFloat(row.z);
  if (Number.isFinite(traded)) return { price: traded, date, isIntraday: true, source: '證交所' };
  const lastTick = parseFloat(row.trade?.z);
  if (Number.isFinite(lastTick)) return { price: lastTick, date, isIntraday: true, source: '證交所' };
  // Nothing has traded today at all (pre-open). Yesterday's close is a real
  // number but not a live one, so it's tagged accordingly — getLiveQuote
  // prefers Yahoo's live price over this.
  const prevClose = parseFloat(row.y);
  if (Number.isFinite(prevClose)) return { price: prevClose, date, isIntraday: false, source: '證交所昨收' };
  return null;
}

/** Best-effort intraday quote from TWSE's public real-time feed
 * (mis.twse.com.tw — the same source most Taiwan stock apps/sites use for
 * live quotes). Free, no API key, but unofficial: never throws, just
 * returns null on any failure so callers fall back to a daily close. */
const TwseRealtimeProvider = {
  async getQuote(stockId) {
    // A stock's market (上市 vs 上櫃) isn't known ahead of time — but ex_ch
    // accepts both prefix guesses in ONE request (the wrong one simply comes
    // back with no row for it), so there's no need to try them one at a time.
    const url = `${TWSE_REALTIME_BASE}?ex_ch=tse_${stockId}.tw|otc_${stockId}.tw&json=1&delay=0`;
    const payload = await fetchJsonWithProxyFallback(url);
    for (const row of payload?.msgArray || []) {
      const quote = parseTwseRow(row);
      if (quote) return quote;
    }
    return null;
  },

  /** Batch quote for many stocks in ONE request total — not one per stock,
   * and not even one per market: both prefix guesses for every stockId go
   * into a single "|"-joined `ex_ch` list (e.g.
   * `tse_2330.tw|otc_2330.tw|tse_2317.tw|otc_2317.tw`), the same technique
   * getQuote() uses for one stock. Firing a separate request per stock (as
   * looping getQuote() would for a "update all holdings" button) risked
   * tripping TWSE's anti-scraping throttle during market hours; this makes
   * that impossible by construction — there is exactly one request,
   * regardless of how many holdings there are. Returns
   * { [stockId]: {price,date,isIntraday} }, omitting any stockId that
   * matched on neither prefix (caller falls back to Yahoo/FinMind for
   * those). Never throws. */
  async getQuotes(stockIds) {
    const ids = [...new Set(stockIds)];
    if (ids.length === 0) return {};
    const query = ids.flatMap((id) => [`tse_${id}.tw`, `otc_${id}.tw`]).join('|');
    const url = `${TWSE_REALTIME_BASE}?ex_ch=${query}&json=1&delay=0`;
    const payload = await fetchJsonWithProxyFallback(url);
    const result = {};
    for (const row of payload?.msgArray || []) {
      const id = row.c; // stock code
      if (!id || result[id]) continue;
      const quote = parseTwseRow(row);
      if (quote) result[id] = quote;
    }
    return result;
  },
};

const YAHOO_CHART_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';

function parseYahooMeta(payload) {
  const meta = payload?.chart?.result?.[0]?.meta;
  const price = meta?.regularMarketPrice;
  if (!Number.isFinite(price)) return null;
  const date = meta.regularMarketTime
    ? new Date(meta.regularMarketTime * 1000).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  return { price, date, isIntraday: true, source: '雅虎' };
}

/** Best-effort intraday quote from Yahoo Finance, used when TWSE's own feed
 * doesn't come back with anything. A stock's market isn't known ahead of
 * time, same as TwseRealtimeProvider — but Yahoo's chart API takes only one
 * symbol per request (unlike TWSE's `ex_ch`, no combined-request trick is
 * possible), so both suffix guesses (.TW listed, .TWO OTC) are raced in
 * parallel instead of tried one after another. Never throws; returns null
 * when nothing works. */
// Maps a requested history window to one of Yahoo's fixed `range` values —
// it doesn't take an arbitrary start date, only enum buckets.
function yahooRangeFor(startDate) {
  if (!startDate) return '6mo';
  const days = (Date.now() - new Date(`${startDate}T00:00:00Z`).getTime()) / 86400000;
  if (days <= 5) return '5d';
  if (days <= 28) return '1mo';
  if (days <= 90) return '3mo';
  if (days <= 180) return '6mo';
  if (days <= 365) return '1y';
  if (days <= 730) return '2y';
  return '5y';
}

/** Turn a chart-endpoint payload into Bar[], the same shape
 * FinMindProvider.getKLine returns. Yahoo pads non-trading days with a null
 * close in some ranges — those are dropped rather than turned into a
 * zero-price candle. Returns null (not []) when the shape is unusable, so
 * the caller can tell "no data" from "couldn't parse this at all". */
function parseYahooChartBars(payload, startDate) {
  const result = payload?.chart?.result?.[0];
  const timestamps = result?.timestamp;
  const quote = result?.indicators?.quote?.[0];
  if (!Array.isArray(timestamps) || !quote) return null;
  const bars = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (quote.close[i] == null) continue;
    const date = new Date(timestamps[i] * 1000).toISOString().slice(0, 10);
    if (startDate && date < startDate) continue;
    bars.push({
      date,
      open: quote.open[i],
      high: quote.high[i],
      low: quote.low[i],
      close: quote.close[i],
      volume: quote.volume[i],
    });
  }
  return bars;
}

const YahooFinanceProvider = {
  async getQuote(stockId) {
    const attempts = ['TW', 'TWO'].map(async (suffix) => {
      const target = `${YAHOO_CHART_BASE}/${stockId}.${suffix}?interval=1m&range=1d`;
      const payload = await fetchJsonWithProxyFallback(target);
      const quote = parseYahooMeta(payload);
      if (!quote) throw new Error(`no usable quote for .${suffix}`);
      return quote;
    });
    try {
      return await Promise.any(attempts);
    } catch (err) {
      return null;
    }
  },

  /** Daily K-line history — same contract as FinMindProvider.getKLine, and
   * preferred over it: Yahoo's chart data includes today's in-progress bar,
   * while FinMind's free-tier daily dataset lags by several days (measured
   * 2026-09-14: FinMind's latest bar was 09-11, Yahoo's was today, 09-14).
   * Throws MarketDataError on failure, matching the provider contract, so
   * callers fall back the same way they already do for FinMind. */
  async getKLine(stockId, { startDate } = {}) {
    const range = yahooRangeFor(startDate);
    const attempts = ['TW', 'TWO'].map(async (suffix) => {
      const target = `${YAHOO_CHART_BASE}/${stockId}.${suffix}?interval=1d&range=${range}`;
      const payload = await fetchJsonWithProxyFallback(target);
      const bars = parseYahooChartBars(payload, startDate);
      if (!bars || bars.length === 0) throw new Error(`no bars for .${suffix}`);
      return bars;
    });
    try {
      return await Promise.any(attempts);
    } catch (err) {
      throw new MarketDataError('雅虎財經K線資料無法取得', err);
    }
  },
};

// Source order below is 證交所 (TWSE MIS) → 雅虎 → FinMind, with TWSE and
// Yahoo always fired AT THE SAME TIME rather than one after the other.
//
// TWSE first because it is the exchange itself: Yahoo's Taiwan quotes are
// derived from it, so going straight to the origin skips a middleman.
// In parallel because TWSE's WAF refuses datacenter/relay IPs on and off —
// measured via r.jina.ai 0/5 on 2026-09-14 (HTTP 401 "bad IP reputation")
// but 5/5 on 2026-09-15 (3.0–4.8s each). That flip is exactly why it can't
// be a serial first link: awaiting a blocked TWSE before even starting
// Yahoo is what once cost ~9 seconds of dead waiting per update. Firing
// both together means a blocked TWSE costs nothing — Yahoo's answer
// (0.52–0.70s) is already sitting there when TWSE's window expires.
//
// The price of that is one extra request per quote on the happy path. That
// is the same trade the CORS proxy race already makes, and this path only
// ever runs when a person presses 更新 — never on a timer, matching how
// wang123890-alt/Choose's D31 decision limits its use of the same endpoint
// (user-triggered, small batches, cooldown, never polled).

/** Yahoo → FinMind, the non-official half of the chain. Split out so both
 * getLiveQuote and getLiveQuotes can run it alongside TWSE instead of after. */
async function quoteWithoutTwse(stockId) {
  const yahoo = await YahooFinanceProvider.getQuote(stockId);
  if (yahoo) return yahoo;
  // Unlike YahooFinanceProvider (which swallows every failure and just
  // returns null), FinMindProvider.getQuote can throw a MarketDataError —
  // it's meant to surface real problems (bad response shape, HTTP error)
  // rather than hide them. Let that propagate: the caller shows err.message
  // directly, which is the only way to tell "Yahoo had nothing and here's
  // exactly why FinMind also failed" from "everything returned null
  // silently", since Yahoo's own reasons are invisible by design.
  return FinMindProvider.getQuote(stockId);
}

/** The quote callers should actually use: the exchange's own live price when
 * it can be had, Yahoo's intraday price when it can't, and FinMind's daily
 * close only as a last resort — FinMind is only ever accurate after the
 * close, so it's a safety net rather than a real intraday source. */
async function getLiveQuote(stockId) {
  const fallback = quoteWithoutTwse(stockId);
  // Held now so a TWSE win doesn't leave this rejecting unhandled; the
  // real error (if TWSE misses too) is re-raised by awaiting it below.
  fallback.catch(() => {});

  const twse = await withDeadline(TwseRealtimeProvider.getQuote(stockId), TWSE_PREFERENCE_WINDOW_MS);
  // Only a LIVE exchange price outranks Yahoo. TWSE's pre-open answer is
  // yesterday's close (isIntraday false), which is worth less than Yahoo's
  // actual intraday number, so it waits behind it rather than in front.
  if (twse?.isIntraday) return twse;

  let fallbackError = null;
  const quote = await fallback.catch((err) => { fallbackError = err; return null; });
  if (quote) return quote;
  // A stale exchange number still beats no number: only report failure when
  // TWSE had nothing either.
  if (twse) return twse;
  // FinMindProvider's own error message says exactly what went wrong, and the
  // caller puts it straight in front of the user — don't flatten it.
  if (fallbackError) throw fallbackError;
  throw new MarketDataError('證交所、雅虎財經與 FinMind 都查無這檔的價格資料');
}

/** Like getLiveQuote, but for many stocks at once — used by a bulk "update
 * all holdings" action. TWSE covers the whole portfolio in ONE request (see
 * TwseRealtimeProvider.getQuotes), while the per-stock Yahoo/FinMind chains
 * run alongside it — Yahoo's chart API takes only one symbol per request, so
 * those are one chain per stock, all in PARALLEL: ten holdings cost about as
 * long as one, instead of ten times as long.
 * Returns { [stockId]: {price,date,isIntraday,source} }, omitting stocks
 * nothing could quote. Never throws. */
async function getLiveQuotes(stockIds) {
  const ids = [...new Set(stockIds)];
  if (ids.length === 0) return {};

  const twsePromise = withDeadline(TwseRealtimeProvider.getQuotes(ids), TWSE_PREFERENCE_WINDOW_MS);
  const fallbacks = new Map(ids.map((id) => [id, quoteWithoutTwse(id).catch(() => null)]));

  const twseQuotes = (await twsePromise) || {};
  const settled = await Promise.all(ids.map(async (id) => {
    const twse = twseQuotes[id];
    if (twse?.isIntraday) return [id, twse]; // see getLiveQuote: only a live exchange price outranks Yahoo
    return [id, (await fallbacks.get(id)) || twse || null];
  }));
  return Object.fromEntries(settled.filter(([, quote]) => quote));
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
