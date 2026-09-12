# 交易損益（Trade）App — 協作備忘

## 效率優先（重要，額度有限）

- **動手前先查現有資源，不重工**：使用者名下還有其他 repo（例如 `wang123890-alt/Choose`，一個台股篩選/分析工具），裡面可能已經踩過同樣的坑、驗證過同樣的資料來源或寫過類似邏輯。遇到資料來源、API串接、已知限制等問題時，**先查其他 repo 的程式碼或 `docs/` 底下的紀錄**，能直接引用結論就直接用，不要重新測試、重新踩雷、重新調研已經有答案的事。
- 使用者的方案額度有限、正在考慮是否續約，**浪費額度是實際成本**，不是抽象原則。每次操作前想一下「這步是必要的嗎，還是可以省略/合併」。
- 不要為了保險而重複驗證已經驗證過的東西（例如同一個 API 的 CORS 行為、同一段程式碼的既有邏輯）。

## PR 流程

- 分支：`claude/trade-records-pnl-6cbsak`，對 repo `wang123890-alt/Trade`（public）。
- 每個功能改動開一個 PR（draft），完成後：
  - **無特殊需求或必要（無衝突、測試全過、無需要跟使用者確認的設計決策），直接合併，不用每次都問。**
  - 只有在真的有衝突、測試失敗、或設計上需要使用者決定時，才停下來問。
- 合併後固定流程：
  1. `git fetch origin main`
  2. 比對舊 commit 與新 `origin/main` 的 diff——如果只有 `data/store.json`（使用者手機/電腦透過 App 自動同步的交易資料）變動或完全無差異，代表可以安全對齊
  3. `git reset --soft origin/main`（絕不用 `--hard`，避免弄丟本地未推送的東西）
  4. `git push --force-with-lease origin claude/trade-records-pnl-6cbsak`
  5. 用 `curl` 輪詢 GitHub Pages 確認新內容已上線，再跟使用者說可以測試（瀏覽器快取可能落後，必要時提醒強制重新整理）
- main 分支偶爾會被 App 本身的 GitHub 同步功能直接寫入 `data/store.json`（"更新交易資料" commit，作者是使用者本人，透過手機/電腦的 App 觸發）——這是正常的資料同步，不是別人動了程式碼，diff 只會動到那個檔案。

## 測試

- 每次改動後跑 `node tests/*.test.js`（純 Node，無框架，逐檔執行），全部要過才能推送。
- `renderKLineChart`（`js/core/chart.js`）沒有專門的測試檔，改動後用臨時腳本（`node --input-type=module -e "..."`）驗證輸出的 SVG 字串。

## 安全

- **絕對不要**接受、記錄、或使用使用者在對話中貼的 GitHub PAT 或其他密鑰。若使用者不慎貼出，立刻提醒撤銷/重新產生，並說明新的 token 只能直接輸入到 App 本身的 Settings 頁面（裝置端），不能再透過對話傳遞。

## 產品慣例（台股，非西式）

- **K線蠟燭**：紅漲綠跌（`js/core/chart.js` 的 `candles`）。
- **損益金額文字顏色**（`pnlClass`，`js/utils/format.js`）：正值（獲利/上漲）紅色、負值（虧損/下跌）綠色、剛好0（平盤）維持預設白字——沿用同一套「紅漲綠跌」邏輯，不是西式的「綠漲紅跌」。
- **月份標籤**：民國年（`rocMonthLabel`，西元年 - 1911），例如 2026-06 → "115/06"。
- **K線週刻度**：不是固定「每5個交易日」或「每週一」，而是偵測「ISO週別變化後第一個實際出現的交易日」（`isoWeekKey`）——因為國定假日、颱風假補班等因素，一週的交易日數不固定。
- **K線標示（買賣點）**：只顯示價格數字，不加「買/賣」文字（顏色已經代表方向：紅=買、綠=賣）；時間相近的多筆標示會自動垂直錯開，避免重疊。

## 資料來源（`js/data/marketdata.js`）

- **K線歷史資料**：FinMind（`api.finmindtrade.com`），免費版只有日K，且有 CORS 支援，可直接前端 fetch。
- **持股頁盤中即時報價**（`getLiveQuote`）三層備援，理由是任何單一公開/非官方端點都可能不穩：
  1. `TwseRealtimeProvider` — TWSE MIS（`mis.twse.com.tw`），依序試 `tse_`/`otc_` 前綴
  2. `YahooFinanceProvider` — 雅虎財經 chart API（`query1.finance.yahoo.com`，`.TW`/`.TWO`後綴）。**這個端點沒有 CORS 標頭**，因為這個 App 是純前端（無後端），改透過公開 CORS 代理轉發（`api.allorigins.win`、`api.codetabs.com` 依序嘗試）——這兩個代理本身也不穩定，實測時都出現過短暫 5xx，這是已知、能接受的風險，設計上任何一層失敗都回傳 `null` 而非拋錯，最終還有 FinMind 兜底。
  3. `FinMindProvider.getQuote` — 只在前兩者都失敗時才用，因為它本質是「最新一根日K收盤價」，只有收盤後才準確，盤中沒有意義。
- 雅虎股市（`tw.stock.yahoo.com`）網頁本身也沒有 CORS 標頭，一樣走不通，已測試過不用重測。

## 環境限制（不是程式問題）

- 這個沙盒的網路代理會擋掉對 `mis.twse.com.tw` 的連線（安全性限制），所以沙盒內無法直接測試 TWSE 這條路徑本身是否連得到；但這是台灣股市 App/網站廣泛使用的公開端點，失敗時的備援機制已經涵蓋這個情境。
- 週末/非交易時間不會有真正的盤中成交價，所有來源都一樣，這是正常現象不是 bug。
