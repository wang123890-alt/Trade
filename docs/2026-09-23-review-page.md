# 覆盤要什麼（2026-09-23）

協作看這篇。覆盤要知道：買賣基於什麼、有無遵守規則、為什麼賺為什麼賠。

## 欄位（已寫入）

交易表單：reason、ruleTrend / ruleBreakout / ruleAdx / ruleVolume、ruleExitFlag、followedRules、pnlKind。
覆盤頁可寫：selfReview（存在賣單）。

## 覆盤頁（2026-09-23 晚已寫入）

路由 `#review`，檔案 `js/features/review.view.js`。
每筆已平倉一張卡，順序：

1. 買賣 K 圖：一張，個股頁同款均線（MA5/10/20），台股紅漲綠跌，標 買 / 賣
2. 進出場原因
3. 當日規則塊（保留）
4. 總結（由規則欄自動組）
5. 自我解析（可改可存）

個股頁「虧損覆盤」不動。
