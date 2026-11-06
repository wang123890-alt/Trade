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
  const s = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else field += c;
    }
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim()));
}

function normalizeDate(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const m = s.match(/(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  const m2 = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m2) return `${m2[1]}-${m2[2]}-${m2[3]}`;
  return '';
}

function toNumber(raw) {
  if (raw == null || raw === '') return 0;
  const n = Number(String(raw).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : NaN;
}

function typeFromWord(word, typeMap) {
  const w = String(word || '').trim();
  if (!w) return null;
  const buys = typeMap.buy.split(/[,\uff0c]/).map((s) => s.trim()).filter(Boolean);
  const sells = typeMap.sell.split(/[,\uff0c]/).map((s) => s.trim()).filter(Boolean);
  if (buys.some((b) => w.includes(b))) return 'BUY';
  if (sells.some((s) => w.includes(s))) return 'SELL';
  return null;
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
      skipped.push({ row: i + 1, reason: `非買賣（${String(typeWord || '').trim() || '空'} ）` });
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
 * Duplicate = same stockId + type + date + price + quantity.
 * Over-sell is checked on the combined list (existing + non-duplicates). */
function preview(candidates, existing) {
  const key = (t) => `${t.stockId}|${t.type}|${t.dateTime}|${t.price}|${t.quantity}`;
  const have = new Set(existing.map(key));
  const add = [];
  const skip = [];
  for (const c of candidates) {
    if (have.has(key(c))) skip.push(c);
    else add.push(c);
  }
  const { errors } = runFifo([...existing, ...add]);
  return {
    add,
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
