#!/usr/bin/env node
// Run by .github/workflows/update-institutional.yml, weekdays after TWSE
// close. Pulls 三大法人買賣超（外資/投信/自營商/合計）for the stocks the
// app actually cares about — current holdings + watchlist, NOT the whole
// market — and writes a small rolling-window JSON (data/institutional.json)
// that the deployed static site reads directly (js/data/institutionalData.js).
//
// Why this runs on a schedule instead of being called live from the browser:
// the primary source (Google Drive "台股資料" API, see CLAUDE.md「環境限
// 制」) needs a secret key, and Trade is a pure static GitHub Pages site —
// there is nowhere in the browser to keep that key safe. A scheduled job
// using a GitHub Actions secret, committing only the *result* as a public
// JSON file, keeps the key server-side while the page itself stays a plain
// static read (same contract as every other static asset it already serves).
//
// Source order: Google Drive first (richer: includes 上櫃/OTC, backfilled
// history); TWSE's own public T86 report as fallback, but ONLY for codes
// Drive didn't return — T86 covers 上市 (TSE) stocks only, so an OTC code
// that Drive misses simply stays missing this run (documented gap, not a
// bug to chase).
import fs from 'node:fs/promises';
import { runFifo } from '../js/core/fifo.js';
import { fromDriveRow, fromT86Row, mergeSnapshot } from '../js/core/institutional.js';

const STORE_PATH = new URL('../data/store.json', import.meta.url);
const OUT_PATH = new URL('../data/institutional.json', import.meta.url);
const API_URL = process.env.TW_STOCK_API_URL;
const API_KEY = process.env.TW_STOCK_API_KEY;
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36';

function taipeiToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

async function stockIdsToTrack() {
  const store = JSON.parse(await fs.readFile(STORE_PATH, 'utf8'));
  const { openLots } = runFifo(store.transactions || []);
  const holdingIds = Object.entries(openLots)
    .filter(([, lots]) => lots.some((l) => l.remainingQty > 0))
    .map(([stockId]) => stockId);
  const watchIds = (store.watchlist || []).map((w) => w.stockId);
  return [...new Set([...holdingIds, ...watchIds])];
}

async function fetchDriveSnapshot(date, stockIds) {
  if (!API_URL || !API_KEY) {
    console.warn('TW_STOCK_API_URL/TW_STOCK_API_KEY not set — skipping Drive source, going straight to TWSE fallback');
    return {};
  }
  const url = `${API_URL}?key=${encodeURIComponent(API_KEY)}&date=${date}&format=json&limit=3000`;
  const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
  if (!res.ok) throw new Error(`Drive API HTTP ${res.status}`);
  const body = await res.json();
  if (!body.ok) throw new Error(body.error?.message || 'Drive API error');
  const wanted = new Set(stockIds);
  const snapshot = {};
  for (const row of body.data || []) {
    if (wanted.has(row.code)) snapshot[row.code] = fromDriveRow(row);
  }
  return snapshot;
}

// TWSE T86 column order (response=json): 0 證券代號, 1 證券名稱,
// 2 外陸資買進, 3 外陸資賣出, 4 外陸資買賣超(不含外資自營商),
// 5 外資自營商買進, 6 外資自營商賣出, 7 外資自營商買賣超,
// 8 投信買進, 9 投信賣出, 10 投信買賣超,
// 11 自營商買賣超(合計), 12-17 自營商自行買賣/避險細項,
// 18 三大法人買賣超合計. See js/core/institutional.js's fromT86Row for how
// these map into our {foreign_net,trust_net,dealer_net,inst_total_net} shape.
async function fetchT86Snapshot(date, stockIds) {
  const ymd = date.replaceAll('-', '');
  const target = `https://www.twse.com.tw/rwd/zh/fund/T86?response=json&date=${ymd}&selectType=ALL`;
  // Direct calls from a datacenter IP get TWSE's own WAF block page; relaying
  // through r.jina.ai is the same documented workaround used throughout
  // js/data/marketdata.js for this exact reason (see CLAUDE.md「資料來源」).
  const res = await fetch(`https://r.jina.ai/${target}`, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`T86 relay HTTP ${res.status}`);
  const text = await res.text();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('T86 relay response had no JSON payload');
  const body = JSON.parse(text.slice(start, end + 1));
  if (body.stat !== 'OK') return {}; // non-trading day — not an error, just nothing to report
  const wanted = new Set(stockIds);
  const snapshot = {};
  for (const cols of body.data || []) {
    if (wanted.has(cols[0])) snapshot[cols[0]] = fromT86Row(date, cols);
  }
  return snapshot;
}

async function main() {
  const date = taipeiToday();
  const stockIds = await stockIdsToTrack();
  if (stockIds.length === 0) {
    console.log('no holdings/watchlist stocks to track, skipping');
    return;
  }

  let snapshot = {};
  try {
    snapshot = await fetchDriveSnapshot(date, stockIds);
  } catch (err) {
    console.warn('Drive API failed, falling back to TWSE T86 for all tracked stocks:', err.message);
  }

  const missing = stockIds.filter((id) => !snapshot[id]);
  if (missing.length > 0) {
    try {
      const fallback = await fetchT86Snapshot(date, missing);
      snapshot = { ...snapshot, ...fallback };
    } catch (err) {
      console.warn('TWSE T86 fallback failed:', err.message);
    }
  }

  if (Object.keys(snapshot).length === 0) {
    console.log(`no institutional data for ${date} from either source (holiday, or both sources down) — leaving stored file unchanged`);
    return;
  }

  let store = {};
  try {
    store = JSON.parse(await fs.readFile(OUT_PATH, 'utf8'));
  } catch { /* first run, no file yet */ }

  const merged = mergeSnapshot(store, snapshot, date);
  await fs.writeFile(OUT_PATH, `${JSON.stringify(merged, null, 2)}\n`);
  console.log(`wrote institutional data for ${date}: ${Object.keys(snapshot).length}/${stockIds.length} tracked stocks covered`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
