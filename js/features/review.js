// AnalysisProvider: the abstraction confirmed during planning so that a
// future AI-backed implementation can replace RuleBasedProvider without
// touching callers. Contract:
//   analyzeLoss(match, context) -> { triggers: string[], suggestions: string[] }
// where context = { buyTransaction, strategySummary, buyFacts } —
// strategySummary is statistics.groupByStrategy's entry for the match's
// strategy tag (null when it has none / too few trades to judge), and
// buyFacts is computeBuyFacts()'s entry for the originating BUY.
//
// EVERY RULE HERE NAMES WHAT IT ACTUALLY MEASURES. That sounds obvious; it
// was learned the hard way. An earlier rule called 未設定停損條件 really
// tested "does the buy's reason/note text contain the word 停損", which on
// real data (44 losses, all imported from a broker statement with no
// hand-written reason) fired on 44/44 — 100%. A rule that fires on every
// case carries zero information, but because it was NAMED for a behavior it
// never observed, it read as a finding: an outside AI review took that 100%
// at face value and concluded the portfolio's biggest problem was stop-loss
// discipline, citing a statistic that only ever measured "this row came
// from a CSV import". The rule was removed rather than renamed: whether a
// stop was planned is genuinely not in this app's data today. If a
// stopLossPrice field is ever added to a BUY, it can come back as a real
// rule that compares the plan against the exit.
//
// Thresholds below are calibrated against the actual trade history rather
// than picked by feel, so each label fires on a meaningful minority. A
// label that fires on everything and a label that fires on nothing are
// equally useless for telling losses apart.

const LOSS_PERCENT_THRESHOLD = -8; // realizedPnLPercent at/below this (fires on ~23% of real losses)
const SHORT_HOLD_DAYS = 2; // (~18%)
const HEAVY_POSITION_WEIGHT = 0.25; // share of portfolio cost at the time of the buy (~9%)
const QUICK_REENTRY_DAYS = 10;
const MIN_TRADES_FOR_STRATEGY_JUDGEMENT = 3;
const LOW_WIN_RATE_THRESHOLD = 50;

/** The catch-all for a loss no rule explains. It is deliberately NOT a
 * cause, so summarizeLossPatterns always sorts it last no matter how often
 * it occurs — on real data it is the single most common outcome (57%), and
 * letting it head a chart titled 常見虧損原因 would read as "your most
 * common loss cause is: unknown". Its real job is to keep the ruleset's
 * coverage visible instead of implying every loss has been explained. */
const NO_PATTERN_TRIGGER = '無明顯型態';

/**
 * Replay the whole transaction history in order and record, for each BUY,
 * the three things about its context that the loss rules need and that no
 * single TradeMatch can know on its own:
 *
 *   averagedDown        - this BUY lowered an existing average cost, i.e. it
 *                         added to a position already under water
 *   positionWeight      - what share of the portfolio's total cost this
 *                         stock represented once this BUY went on
 *   daysSincePriorLoss  - days between this BUY and the most recent LOSING
 *                         sell of the same stock (null if there wasn't one)
 *
 * Pure: takes the full transaction list and FIFO matches, returns a lookup
 * keyed by BUY transaction id. Never mutates its inputs.
 */
function computeBuyFacts(transactions, matches = []) {
  const sorted = [...transactions].sort((a, b) => {
    const t = new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime();
    if (t !== 0) return t;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

  const losingSellDatesByStock = {};
  for (const m of matches) {
    if (m.realizedPnL < 0) (losingSellDatesByStock[m.stockId] ??= []).push(m.closedAt);
  }

  const lots = {}; // stockId -> [{ price, quantity }], oldest first
  const facts = {};

  for (const tx of sorted) {
    lots[tx.stockId] ??= [];
    const stockLots = lots[tx.stockId];

    if (tx.type === 'BUY') {
      const heldQty = stockLots.reduce((sum, l) => sum + l.quantity, 0);
      const heldCost = stockLots.reduce((sum, l) => sum + l.price * l.quantity, 0);
      const averageCost = heldQty > 0 ? heldCost / heldQty : null;

      const portfolioCost =
        Object.values(lots)
          .flat()
          .reduce((sum, l) => sum + l.price * l.quantity, 0) + tx.price * tx.quantity;
      const stockCost = heldCost + tx.price * tx.quantity;

      const priorLosses = (losingSellDatesByStock[tx.stockId] || []).filter(
        (d) => new Date(d).getTime() < new Date(tx.dateTime).getTime()
      );
      const daysSincePriorLoss = priorLosses.length
        ? Math.min(
            ...priorLosses.map(
              (d) => (new Date(tx.dateTime).getTime() - new Date(d).getTime()) / 86400000
            )
          )
        : null;

      facts[tx.id] = {
        averagedDown: averageCost != null && tx.price < averageCost,
        positionWeight: portfolioCost > 0 ? stockCost / portfolioCost : 0,
        daysSincePriorLoss,
      };

      stockLots.push({ price: tx.price, quantity: tx.quantity });
      continue;
    }

    let remaining = tx.quantity;
    while (remaining > 0 && stockLots.length > 0) {
      const lot = stockLots[0];
      const matched = Math.min(remaining, lot.quantity);
      lot.quantity -= matched;
      remaining -= matched;
      if (lot.quantity <= 0) stockLots.shift();
    }
  }

  return facts;
}

const RuleBasedProvider = {
  analyzeLoss(match, context = {}) {
    if (match.realizedPnL >= 0) return null;

    const { buyTransaction, strategySummary, buyFacts } = context;
    const triggers = [];
    const suggestions = [];

    if (match.realizedPnLPercent <= LOSS_PERCENT_THRESHOLD) {
      triggers.push('虧損幅度偏大');
      suggestions.push('這筆單筆虧損幅度偏大，檢查出場是否太晚：進場時就先想好「跌到哪裡代表我看錯了」，比事後才決定容易執行');
    }

    if (match.holdingDays <= SHORT_HOLD_DAYS) {
      triggers.push('短時間反轉');
      suggestions.push('進場後很快就反向出場。這可能是追高、也可能只是被正常波動洗出場——兩者的對策相反，可對照K線看出場後價格是否很快收復');
    }

    if (buyFacts?.averagedDown) {
      triggers.push('加碼攤平');
      suggestions.push('這筆是在原有持股已經虧損的情況下往下加碼。攤平會讓單一標的的曝險在看錯時同步放大，留意是否偏離原本的部位規劃');
    }

    if (buyFacts?.positionWeight > HEAVY_POSITION_WEIGHT) {
      triggers.push('單一部位過重');
      suggestions.push(
        `進場當下這檔約占投組成本 ${(buyFacts.positionWeight * 100).toFixed(0)}%，比重偏高。部位越重，越容易在正常回檔時被迫出場`
      );
    }

    if (buyFacts?.daysSincePriorLoss != null && buyFacts.daysSincePriorLoss <= QUICK_REENTRY_DAYS) {
      triggers.push('虧損後迅速回補');
      suggestions.push(
        `這檔在 ${Math.round(buyFacts.daysSincePriorLoss)} 天前才剛虧損出場就再度買回。確認這是原本計畫中的再進場條件，而不是想把上一筆賺回來`
      );
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
      triggers.push(NO_PATTERN_TRIGGER);
      suggestions.push('這筆虧損沒有命中目前規則庫的任何型態，多半就是一筆幅度不大的普通虧損，建議自行回顧當時的進出場理由');
    }

    return { triggers, suggestions };
  },
};

/** Run the loss review over every losing match, attaching `.review` to each.
 * Returns a new array — matches are never mutated in place.
 * `options.buyFacts` is computeBuyFacts()'s output; without it the rules
 * that depend on trade context simply don't fire. */
function attachLossReviews(matches, transactionsById, strategySummariesByName, options = {}) {
  const { buyFacts = {}, provider = RuleBasedProvider } = options;
  return matches.map((m) => {
    if (m.realizedPnL >= 0) return m;
    const buyTransaction = transactionsById[m.buyTransactionId];
    const strategySummary = buyTransaction?.strategy
      ? strategySummariesByName[buyTransaction.strategy]
      : null;
    const review = provider.analyzeLoss(m, {
      buyTransaction,
      strategySummary,
      buyFacts: buyFacts[m.buyTransactionId],
    });
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
  return Object.values(counts).sort((a, b) => {
    if (a.trigger === NO_PATTERN_TRIGGER) return 1;
    if (b.trigger === NO_PATTERN_TRIGGER) return -1;
    return b.count - a.count;
  });
}

export { RuleBasedProvider, computeBuyFacts, attachLossReviews, summarizeLossPatterns, NO_PATTERN_TRIGGER };
