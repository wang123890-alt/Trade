# Trade 進出場設定（已寫入程式）

記錄日期：2026-09-17；用語 2026-09-18；資料來源 2026-09-21；覆盤 2026-09-23（WIP）
詳細過程：docs/2026-09-17-entry-exit-backtest.md
用語規則：docs/terms-range.md
證交所日 K：docs/2026-09-21-twse-kline.md
覆盤：docs/2026-09-23-review-page.md

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

### 覆盤（WIP，尚未正式）
- `#review` 已掛上，先放著改，不影響帳
- docs/2026-09-23-review-page.md

### 未改
- Excel、FIFO、稅費
