// AnalysisProvider: the abstraction confirmed during planning so that a
// future AI-backed implementation can replace RuleBasedProvider without
// touching callers. Contract:
//   analyzeLoss(match, context) -> { triggers: string[], suggestions: string[] }
// where context = { buyTransaction, strategySummary } — strategySummary is
// the result of statistics.groupByStrategy for the match's strategy tag
// (or null if it has none / too few trades to judge).
//
// Rules only use data the app actually has today (TradeMatch fields, the
// originating BUY's reason/strategy/note, and win-rate by strategy).
// Judging "was this a false breakout" would need the price path *during*
// the trade, which Phase 8's chart data will make available — that rule is
// deliberately not included here rather than faked.

const STOP_LOSS_PERCENT_THRESHOLD = -8; // realizedPnLPercent at/below this = "wide stop"
const SHORT_HOLD_DAYS = 2;
const MIN_TRADES_FOR_STRATEGY_JUDGEMENT = 3;
const LOW_WIN_RATE_THRESHOLD = 50;

function hasStopLossMention(text) {
  if (!text) return false;
  return /停損|stop.?loss/i.test(text);
}

const RuleBasedProvider = {
  analyzeLoss(match, context = {}) {
    if (match.realizedPnL >= 0) return null;

    const { buyTransaction, strategySummary } = context;
    const triggers = [];
    const suggestions = [];

    if (match.realizedPnLPercent <= STOP_LOSS_PERCENT_THRESHOLD) {
      triggers.push('停損幅度偏大');
      suggestions.push('這筆虧損幅度偏大，建議設定更嚴格的停損百分比，避免單筆虧損擴大');
    }

    if (match.holdingDays <= SHORT_HOLD_DAYS) {
      triggers.push('短時間反轉');
      suggestions.push('進場後短時間即反轉出場，留意是否為追高或情緒性進場，可考慮進場前多一次確認');
    }

    const reasonText = `${buyTransaction?.reason || ''} ${buyTransaction?.note || ''}`;
    if (!hasStopLossMention(reasonText)) {
      triggers.push('未設定停損條件');
      suggestions.push('這筆交易進場時未標記停損條件，建議往後進場就同時記錄停損價位');
    }

    if (
      buyTransaction?.strategy &&
      strategySummary &&
      strategySummary.closedCount >= MIN_TRADES_FOR_STRATEGY_JUDGEMENT &&
      strategySummary.winRate != null &&
      strategySummary.winRate < LOW_WIN_RATE_THRESHOLD
    ) {
      triggers.push('策略勝率偏低');
      suggestions.push(
        `策略「${buyTransaction.strategy}」近期勝率為 ${strategySummary.winRate.toFixed(0)}%，偏低，建議重新檢視這個策略的進場條件`
      );
    }

    if (triggers.length === 0) {
      triggers.push('無明顯規則命中');
      suggestions.push('這筆虧損沒有命中目前規則庫的常見模式，建議自行回顧當時的進出場理由');
    }

    return { triggers, suggestions };
  },
};

/** Run the loss review over every losing match, attaching `.review` to each.
 * Returns a new array — matches are never mutated in place. */
function attachLossReviews(matches, transactionsById, strategySummariesByName, provider = RuleBasedProvider) {
  return matches.map((m) => {
    if (m.realizedPnL >= 0) return m;
    const buyTransaction = transactionsById[m.buyTransactionId];
    const strategySummary = buyTransaction?.strategy
      ? strategySummariesByName[buyTransaction.strategy]
      : null;
    const review = provider.analyzeLoss(m, { buyTransaction, strategySummary });
    return { ...m, review };
  });
}

/** Aggregate how often each trigger appears across all reviewed losses —
 * powers the "常見虧損原因統計" card. */
function summarizeLossPatterns(reviewedMatches) {
  const counts = {};
  for (const m of reviewedMatches) {
    if (!m.review) continue;
    for (const trigger of m.review.triggers) {
      if (!counts[trigger]) counts[trigger] = { trigger, count: 0, examples: [] };
      counts[trigger].count += 1;
      counts[trigger].examples.push(m);
    }
  }
  return Object.values(counts).sort((a, b) => b.count - a.count);
}

export { RuleBasedProvider, attachLossReviews, summarizeLossPatterns };
