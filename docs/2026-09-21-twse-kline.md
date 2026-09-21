# 證交所日 K 來源更正（2026-09-21）

協作看這篇。之前誤以為證交所沒有歷史日 K，那是打錯接口。

## 現程式（尚未改）

- 即時報價（持股「更新」）：證交所 MIS → 雅虎 → FinMind
- 個股 K 圖：雅虎日 K → FinMind
- 畫面寫「雅虎股市」是因為圖真的用雅虎，不是優先順序弄反

## 三條路不能混

| 端點 | 給什麼 | 不要當成 |
|---|---|---|
| `mis.twse.com.tw/.../getStockInfo` | 當下報價 | 歷史 K |
| `openapi.twse.com.tw/.../STOCK_DAY_ALL` | 全市場「當天」一包；帶 date 也不追溯 | 個股多月歷史 |
| `www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=YYYYMM01&stockNo=2330` | 單檔、**一個月**的開高低收 | 一次拿整段年 |

上櫃走櫃買 `st43`（個股日成交資訊），不是 STOCK_DAY。

## 被擋多半是方法不對

1. 拿 MIS 去凑日 K
2. 機房 IP 直打 MIS／官網 → WAF 502
3. GitHub Pages 瀏覽器直打 `twse.com.tw` → 沒 CORS
4. 一次連打很多月、沒間隔、沒官網 Referer

## 若要改 K 圖改證交所優先（尚未寫入）

- 上市：STOCK_DAY，一個月一包，需幾個月就打幾次
- 上櫃：st43 同樣按月
- 瀏覽器端走現有 `r.jina.ai` 中繼，不直連
- 月與月留間隔
- 今日未收盤那根可再疊 MIS 即時
