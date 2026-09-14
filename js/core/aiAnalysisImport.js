// Splits a block of freeform AI-analysis text (pasted from an outside AI
// tool covering multiple stocks at once) into per-stock sections, so the
// holdings page can distribute each section into that stock's own
// AI-analysis field instead of the user copy-pasting it manually stock by
// stock.
//
// Heuristic, line-based: whichever stock a line mentions (by code or name)
// becomes the "current" stock; lines that mention no stock stay attached to
// whatever stock was last mentioned (most AI writeups lead each section with
// a header naming the stock, then talk about it for several lines without
// repeating the name). Lines before the first mention of any stock, and any
// text left over if no stock is ever mentioned, are returned separately as
// `unmatched` rather than silently dropped.

function findStockMention(line, stocks) {
  for (const s of stocks) {
    const idRe = new RegExp(`(^|[^0-9])${s.stockId}([^0-9]|$)`);
    if (idRe.test(line)) return s;
  }
  for (const s of stocks) {
    if (s.stockName && line.includes(s.stockName)) return s;
  }
  return null;
}

/** stocks: { stockId, stockName }[]. Returns { byStock: { [stockId]: text }, unmatched: text }. */
function classifyAiAnalysisText(text, stocks) {
  const lines = (text || '').split(/\r?\n/);
  const buckets = {};
  const unmatched = [];
  let current = null;

  for (const line of lines) {
    if (line.trim() === '') {
      if (current) (buckets[current] ||= []).push(line);
      continue;
    }
    const hit = findStockMention(line, stocks);
    if (hit) {
      current = hit.stockId;
      (buckets[current] ||= []).push(line);
    } else if (current) {
      (buckets[current] ||= []).push(line);
    } else {
      unmatched.push(line);
    }
  }

  const byStock = {};
  for (const [stockId, lns] of Object.entries(buckets)) {
    const joined = lns.join('\n').trim();
    if (joined) byStock[stockId] = joined;
  }

  return { byStock, unmatched: unmatched.join('\n').trim() };
}

export { classifyAiAnalysisText };
