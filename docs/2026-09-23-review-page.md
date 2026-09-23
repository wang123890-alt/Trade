# 覆盤要什麼（2026-09-23）

協作看這篇。覆盤要知道：買賣基於什麼、有無遵守規則、為什麼賺為什麼賠。

## 欄位（已寫入）

新增交易：reason、ruleTrend / ruleBreakout / ruleAdx / ruleVolume、ruleExitFlag、followedRules、pnlKind。
空字串=未填，舊單不當成「否」。
selfReview：覆盤頁「自我解析」，寫在賣單，`editTransaction` 存。

## 覆盤頁（2026-09-23 17:30 已寫入）

路由 `#review`。底部導航、側欄都有「覆盤」。
每筆已平倉一張卡，順序：

1. 買賣 K 圖：證交所→雅虎→FinMind；截買前 15 日到賣後數日；MA5/10/20；紅漲綠跌；標買賣
2. 進出場原因（買.reason / 賣.reason）
3. 當日規則塊（保留）
4. 總結：由規則欄自動組，未填則寫「規則未填，無法自動總結」
5. 自我解析

### 改過的檔
- `js/features/review.view.js` 新增
- `js/app.js` 註冊 review
- `index.html` 導航
- `js/core/models.js` selfReview

個股頁「虧損覆盤」（review.js）不動。Excel / FIFO / 稅費不動。
