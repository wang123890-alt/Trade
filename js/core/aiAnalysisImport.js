// Splits a block of freeform AI-analysis text (pasted from an outside AI
// tool covering multiple stocks at once) into per-stock sections, so the
// holdings page can distribute each section into that stock's own
// AI-analysis field instead of the user copy-pasting it manually stock by
// stock.
//
// Two strategies, picked by what the pasted text actually looks like:
//
// - Section mode (real multi-stock reports almost always look like this):
//   the text is split on "---" divider lines into blocks, and each whole
//   block is assigned to whichever stock its own header names — never
//   reassigned mid-block. This was added after a real AI-generated report
//   broke the older line-by-line heuristic: 2330(台積電) is mentioned
//   throughout nearly every OTHER stock's section too (e.g. 2454's own
//   section says "目前明顯不如台積電強"), so switching "current stock" on
//   every mention glued most of the document onto 2330 instead of each
//   stock's own section.
// - Line mode (fallback when the text has no "---" dividers at all):
//   whichever stock a line mentions becomes the "current" stock, and lines
//   that mention no stock stay attached to whatever stock was last
//   mentioned. Kept for less structured pastes (a quick list, or prose
//   with no section markers) where there's no block boundary to lean on.
//
// Either way, text that never resolves to a specific stock is returned
// separately as `unmatched` rather than silently dropped or guessed at.

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findStockMention(line, stocks) {
  for (const s of stocks) {
    const idRe = new RegExp(`(^|[^0-9])${escapeRegExp(s.stockId)}([^0-9]|$)`);
    if (idRe.test(line)) return s;
  }
  for (const s of stocks) {
    if (s.stockName && line.includes(s.stockName)) return s;
  }
  return null;
}

function lineMentionsStock(line, stock) {
  const idRe = new RegExp(`(^|[^0-9])${escapeRegExp(stock.stockId)}([^0-9]|$)`);
  if (idRe.test(line)) return true;
  return !!(stock.stockName && line.includes(stock.stockName));
}

const LIST_MARKER_RE = /^[\s•\-*>]+|^[0-9]+[.)、]\s*|^[🥇🥈🥉]\s*|^[0-9]️⃣\s*/;

/** A line counts as a stock's own section header only when, once its id and
 * name are stripped out, almost nothing else is left on the line — "2330
 * 台積電" or "00631L 元大台灣50正2" qualify, but "目前明顯不如台積電強"
 * or "2330 台積電 → 直接持有" (a bullet inside a shared overview) don't. */
function isHeaderLineFor(line, stock) {
  let s = line.replace(LIST_MARKER_RE, '');
  const idIdx = s.indexOf(stock.stockId);
  const nameIdx = stock.stockName ? s.indexOf(stock.stockName) : -1;
  if (idIdx === -1 && nameIdx === -1) return false;
  if (idIdx !== -1) s = s.slice(0, idIdx) + s.slice(idIdx + stock.stockId.length);
  const nameIdx2 = stock.stockName ? s.indexOf(stock.stockName) : -1;
  if (nameIdx2 !== -1) s = s.slice(0, nameIdx2) + s.slice(nameIdx2 + stock.stockName.length);
  const remaining = s.replace(/[\s:：\-–—→]/g, '');
  return remaining.length <= 4;
}

function classifyBySections(lines, stocks, dividerRe) {
  const blocks = [];
  let current = [];
  for (const line of lines) {
    if (dividerRe.test(line.trim())) {
      blocks.push(current);
      current = [];
    } else {
      current.push(line);
    }
  }
  blocks.push(current);

  const byStock = {};
  const unmatchedParts = [];

  for (const rawBlock of blocks) {
    const joined = rawBlock.join('\n').trim();
    if (!joined) continue;

    const firstNonBlank = rawBlock.find((l) => l.trim() !== '');
    let owner = firstNonBlank ? stocks.find((s) => isHeaderLineFor(firstNonBlank, s)) : undefined;

    if (!owner) {
      const counts = new Map();
      for (const line of rawBlock) {
        for (const s of stocks) {
          if (lineMentionsStock(line, s)) counts.set(s.stockId, (counts.get(s.stockId) || 0) + 1);
        }
      }
      const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
      // A block is confidently "about" one stock only if that stock is the
      // only one mentioned at all, or clearly dominates the others — a
      // block that name-drops several stocks roughly evenly (a ranking
      // table, a "here's my priority order" list) is shared commentary,
      // not any one stock's section, so it goes to unmatched instead of
      // being guessed onto whichever stock happens to be listed first.
      if (sorted.length === 1) {
        owner = stocks.find((s) => s.stockId === sorted[0][0]);
      } else if (sorted.length > 1 && sorted[0][1] >= 2 && sorted[0][1] > sorted[1][1] * 2) {
        owner = stocks.find((s) => s.stockId === sorted[0][0]);
      }
    }

    if (owner) {
      byStock[owner.stockId] = byStock[owner.stockId] ? `${byStock[owner.stockId]}\n\n${joined}` : joined;
    } else {
      unmatchedParts.push(joined);
    }
  }

  return { byStock, unmatched: unmatchedParts.join('\n\n').trim() };
}

function classifyByLine(lines, stocks) {
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

/** stocks: { stockId, stockName }[]. Returns { byStock: { [stockId]: text }, unmatched: text }. */
function classifyAiAnalysisText(text, stocks) {
  const lines = (text || '').split(/\r?\n/);
  const dividerRe = /^-{3,}$/;
  const hasDividers = lines.some((l) => dividerRe.test(l.trim()));
  return hasDividers ? classifyBySections(lines, stocks, dividerRe) : classifyByLine(lines, stocks);
}

/** Appends newly pasted analysis onto whatever a stock's field already
 * holds, separated by a dated marker so old context isn't silently lost —
 * used by both the batch paste-and-classify import and a single-stock
 * paste, so pasting a fresh detailed writeup behaves the same way no
 * matter which of the two paths it comes in through. */
function appendAiAnalysis(existing, newText, dateLabel) {
  return existing ? `${existing}\n\n---- ${dateLabel} ----\n${newText}` : newText;
}

export { classifyAiAnalysisText, appendAiAnalysis };
