# Trade 進出場設定（已寫入程式）

記錄日期：2026-09-17；用語 2026-09-18；資料來源 2026-09-21；覆盤 2026-09-23
詳細過程：docs/2026-09-17-entry-exit-backtest.md
用語規則：docs/terms-range.md
證交所日 K：docs/2026-09-21-twse-kline.md
覆盤要什麼：docs/2026-09-23-review-page.md（含原 review-plan 設計約束；review-plan 已改 stub）

## 已寫入 js/core/tradeLevels.js

### 趨勢三態（程式現況）
- 多頭：MA5 > MA20 > MA60
- 空頭：MA5 < MA20 < MA60
- 其餘：range，畫面仍寫「橫盤（盤整）」

### 用語（尚未寫入程式）
- 橫盤＝盤整：躺著走
- 箱子 → 區間；高低亂甩 → 震盪

### 進場（須同時成立）
1. MA5 > MA20 > MA60
2. 收盤價 > 前 20 日最高價
3. ADX(14) ≥ 25
4. 成交量 ≥ 1.0× 二十日均量

### 出場旗標
- 收盤 < MA5 且 MA5 < MA10

### 資料來源
- K 圖／觀察名單：證交所 → 雅虎 → FinMind

### 覆盤（2026-09-23 晚已寫入）
- 路由 `#review`，`js/features/review.view.js`
- 每筆已平倉：紅漲綠跌 K（標買賣、MA5/10/20）+原因+當日規則塊+總結+自我解析
- docs/2026-09-23-review-page.md

### 未改
- Excel、FIFO、稅費
