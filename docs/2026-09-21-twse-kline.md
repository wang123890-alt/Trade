# 證交所日 K 來源（2026-09-21，2026-09-25 更正）

協作看這篇。個股畫圖現況以 docs/2026-09-25-kline-speed-lookup.md 為準。

## 個股畫圖（2026-09-25 起）

不按月。歷史一次取雅虎（失敗才 FinMind）；今日 MIS 補一根。

`STOCK_DAY` / `st43` 官方就是一個月一包，不用來畫個股圖。

## 接點（仍有效）

| 用途 | 接點 |
|---|---|
| 個股歷史 | 雅虎 `chart` 一次；備援 FinMind |
| 個股今日 | MIS `getStockInfo` |
| 持股報價「更新」 | MIS → 雅虎 → FinMind |

`STOCK_DAY_ALL`（OpenAPI 全市場當日）不用來畫個股圖。

按月實作仍留在 `js/data/twseDailyKLine.js`，畫圖不呼。
