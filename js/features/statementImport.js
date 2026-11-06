// Broker statement import. Brokers differ, so nothing is hardcoded:
// the user maps columns and type words once (saved in localStorage),
// then confirms a preview before anything is written.
//
// Writes go through the same path as manual entries: validate, dry-run
// FIFO on the combined list, then TransactionRepository.saveMany. Rules,
// strategy and reason stay blank — the statement has none of those.

import { TransactionRepository } from '../data/storage.js';
import { createTransaction, genId } from '../core/models.js';
import { runFifo } from '../core/fifo.js';
import { validateTransaction } from './transactions.js';

const MAP_KEY = 'trade_app.statement_map.v1';

const FIELDS = [
  { key: 'dateTime', label: '日期', required: true },
  { key: 'stockId', label: '代號', required: true },
  { key: 'stockName', label: '名稱', required: true },
  { key: 'type', label: '買賣別', required: true },
  { key: 'quantity', label: '股數', required: true },
  { key: 'price', label: '單價', required: true },
  { key: 'fee', label: '手續費', required: false },
  { key: 'tax', label: '證交稅', required: false },
];

const DEFAULT_TYPE_WORDS = {
  buy: '現股買進,買進,普通買進,一般買進,BUY',
  sell: '現股賣出,賣出,普通賣出,一般賣出,SELL',
};

// 融資、融券、股利 are not cash trades. Matched before the buy/sell words
// so a short word like「買進」does not swallow「融資買進」.
const SKIP_WORD = /融資|融券|股利|股息|配息|除權|除息|借券/;

function loadMap() {
  try {
    return JSON.parse(localStorage.getItem(MAP_KEY) || 'null');
  } catch {
    return null;
  }
}

function saveMap(map) {
  localStorage.setItem(MAP_KEY, JSON.stringify(map));
}

/** Minimal CSV parser. Handles quoted fields and commas inside quotes. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const s = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim()));
}

function ymd(y, mo, d) {
  let year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return '';
  if (year < 1911) year += 1911;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function normalizeDate(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const m = s.match(/(\d{2,4})[/\-.](\d{1,2})[/\-.](\d{1,2})/);
  if (m) return ymd(m[1], m[2], m[3]);
  if (/^\d{8}$/.test(s)) return ymd(s.slice(0, 4), s.slice(4, 6), s.slice(6, 8));
  if (/^\d{7}$/.test(s)) return ymd(s.slice(0, 3), s.slice(3, 5), s.slice(5, 7));
  if (/^\d{6}$/.test(s)) return ymd(s.slice(0, 2), s.slice(2, 4), s.slice(4, 6));
  return '';
}

function toNumber(raw) {
  if (raw == null || raw === '') return 0;
  const n = Number(String(raw).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : NaN;
}

function typeFromWord(word, typeMap) {
  const w = String(word || '').trim();
  if (!w || SKIP_WORD.test(w)) return null;
  const buys = typeMap.buy.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
  const sells = typeMap.sell.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
  if (buys.some((b) => w.includes(b))) return 'BUY';
  if (sells.some((s) => w.includes(s))) return 'SELL';
  return null;
}

function rowKey(t) {
  return `${t.stockId}|${t.type}|${String(t.dateTime).slice(0, 10)}|${t.price}|${t.quantity}`;
}

/** Build candidate transactions from parsed rows + current mapping.
 * Returns { candidates, skipped }. Skipped are rows that are not buy/sell
 * (margin, dividend, etc.) or missing a required field. */
function buildCandidates(rows, columnMap, typeMap) {
  if (!rows.length) return { candidates: [], skipped: [] };
  const header = rows[0].map((h) => String(h).trim());
  const idx = {};
  for (const f of FIELDS) {
    const col = columnMap[f.key];
    idx[f.key] = col ? header.indexOf(col) : -1;
  }
  const candidates = [];
  const skipped = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const typeWord = idx.type >= 0 ? r[idx.type] : '';
    const type = typeFromWord(typeWord, typeMap);
    if (!type) {
      skipped.push({ row: i + 1, reason: `非買賣（${String(typeWord || '').trim() || '空'}）` });
      continue;
    }
    const input = {
      stockId: String(idx.stockId >= 0 ? r[idx.stockId] : '').trim(),
      stockName: String(idx.stockName >= 0 ? r[idx.stockName] : '').trim(),
      type,
      dateTime: normalizeDate(idx.dateTime >= 0 ? r[idx.dateTime] : ''),
      price: toNumber(idx.price >= 0 ? r[idx.price] : ''),
      quantity: Math.abs(toNumber(idx.quantity >= 0 ? r[idx.quantity] : '')),
      fee: Math.abs(toNumber(idx.fee >= 0 ? r[idx.fee] : 0)),
      tax: Math.abs(toNumber(idx.tax >= 0 ? r[idx.tax] : 0)),
      strategy: '',
      reason: '',
      note: '對帳單匯入',
    };
    const errors = validateTransaction(input);
    if (errors.length) {
      skipped.push({ row: i + 1, reason: errors[0] });
      continue;
    }
    candidates.push(createTransaction({ id: genId('tx'), ...input }));
  }
  return { candidates, skipped };
}

/** Classify candidates against existing transactions.
 * Duplicate = same stockId + type + date + price + quantity, including
 * a repeated row inside this file.
 * An over-sell is dropped from `add` (the rest can still be written). */
function preview(candidates, existing) {
  const have = new Set(existing.map(rowKey));
  const add = [];
  const skip = [];
  for (const c of candidates) {
    const k = rowKey(c);
    if (have.has(k)) skip.push(c);
    else { add.push(c); have.add(k); }
  }
  const { errors } = runFifo([...existing, ...add]);
  if (!errors.length) return { add, skip, reject: [] };
  const bad = new Set(errors.map((e) => e.transaction.id));
  return {
    add: add.filter((t) => !bad.has(t.id)),
    skip,
    reject: errors.map((e) => e.error.message),
  };
}

/** Persist the non-duplicate, FIFO-safe candidates. */
async function commit(addList) {
  if (!addList.length) return { ok: true, added: 0 };
  const existing = TransactionRepository.getAll();
  const { errors } = runFifo([...existing, ...addList]);
  if (errors.length) {
    return { ok: false, error: errors.map((e) => e.error.message).join('；') };
  }
  const result = await TransactionRepository.saveMany(addList);
  if (!result.ok) return { ok: false, error: result.error?.message || '同步失敗' };
  return { ok: true, added: addList.length };
}

export {
  FIELDS,
  DEFAULT_TYPE_WORDS,
  loadMap,
  saveMap,
  parseCsv,
  buildCandidates,
  preview,
  commit,
};
