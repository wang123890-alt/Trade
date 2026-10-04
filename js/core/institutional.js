// 三大法人買賣超：把兩種來源（Google Drive「台股資料」API 的 date 模式、
// 證交所官方 T86 報表）正規化成同一個形狀，並維護一份「每檔股票近N個日曆天」
// 的滾動視窗。純函式，供 scripts/updateInstitutional.mjs（寫檔，I/O）跟未來
// 若要加測試的呼叫端共用，不依賴 fetch／檔案系統。

// 10個日曆天，涵蓋週末/國定假日後仍有約5~7個交易日可看，跟畫面上想呈現的
// 「近幾個交易日」需求留一點餘裕，檔案也不會無限長大。
const WINDOW_DAYS = 10;

function num(v) {
  if (v == null) return null;
  const n = typeof v === 'string' ? parseFloat(v.replace(/,/g, '')) : v;
  return Number.isFinite(n) ? n : null;
}

/** Google Drive API `date` 模式回傳的一列（已經是我們要的欄位名）。 */
function fromDriveRow(row) {
  return {
    date: row.date,
    foreign_net: num(row.foreign_net),
    trust_net: num(row.trust_net),
    dealer_net: num(row.dealer_net),
    inst_total_net: num(row.inst_total_net),
  };
}

/** 證交所 T86「三大法人買賣超日報」的原始欄位陣列（見
 * scripts/updateInstitutional.mjs 的 fetchT86Snapshot 附的完整欄位清單）：
 * index 4 = 外陸資買賣超(不含自營商)，7 = 外資自營商買賣超（外資=4+7）
 * index 10 = 投信買賣超，11 = 自營商買賣超(合計)，18 = 三大法人買賣超合計。
 * 只有上市（TSE）股票有這份報表，上櫃（OTC）沒有對應的官方備援——已知缺口。 */
function fromT86Row(date, cols) {
  const foreignForeign = num(cols[4]) || 0;
  const foreignDealer = num(cols[7]) || 0;
  return {
    date,
    foreign_net: foreignForeign + foreignDealer,
    trust_net: num(cols[10]),
    dealer_net: num(cols[11]),
    inst_total_net: num(cols[18]),
  };
}

/** 把一天的快照（{stockId: row}）併入既有的滾動視窗存檔
 * （{stockId: row[]}，依日期由舊到新排序），同一天重跑是冪等的（取代舊的
 * 同日資料，不會疊加），並裁掉 WINDOW_DAYS 天以外的舊資料。 */
function mergeSnapshot(store, snapshot, asOfDate) {
  const cutoff = new Date(`${asOfDate}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - WINDOW_DAYS);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const next = {};
  const stockIds = new Set([...Object.keys(store), ...Object.keys(snapshot)]);
  for (const stockId of stockIds) {
    const todayRow = snapshot[stockId];
    const kept = (store[stockId] || []).filter(
      (r) => r.date >= cutoffStr && (!todayRow || r.date !== todayRow.date)
    );
    const merged = todayRow ? [...kept, todayRow] : kept;
    merged.sort((a, b) => a.date.localeCompare(b.date));
    if (merged.length > 0) next[stockId] = merged;
  }
  return next;
}

export { fromDriveRow, fromT86Row, mergeSnapshot, WINDOW_DAYS };
