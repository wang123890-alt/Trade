# 觀察名單排序與均線上下（2026-09-21）

使用者要求：觀察頁加排序（價格漲跌、單日漲跌幅、5日漲跌幅）；MA 標上／下；有直線顯示直線K 高低，沒直線就最新K 高低。

## 寫入

- `js/core/watchSnapshot.js`：純計算
- `js/features/watchlist.view.js`：列表與排序按鈕
- `tests/watchSnapshot.test.js`

## 直線怎麼判

近 8 根 MA20 波幅 ≤ 收盤的 0.8%，當成均線躺平（直線），高低取這 8 根 K。否則只顯最新一根高低。
這段門檻可改。
