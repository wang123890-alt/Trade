# 證交所日 K 來源（2026-09-21）

協作看這篇。

## 現程式（已寫入）

K 圖／觀察名單順序：證交所 → 雅虎 → FinMind

- 盤後歷史：上市 `STOCK_DAY`（一個月一包）；上櫃 `st43`
- 盤中今日：MIS `getStockInfo` 拼一根未收盤 K
- 月與月間隔 350ms；瀏覽器走 `r.jina.ai` 中繼
- 實作：`js/data/twseDailyKLine.js`

即時報價（持股「更新」）仍是 MIS → 雅虎 → FinMind，沒改。

## 盤中、盤後接點不一樣

| 時段 | 接點 |
|---|---|
| 盤中 | MIS `getStockInfo` |
| 盤後 | 上市 `STOCK_DAY`；上櫃 `st43` |

`STOCK_DAY_ALL`（OpenAPI 全市場當日）不用來畫個股圖。
