# AI 解析預覽框尺寸（2026-09-17）

## 問題

持股頁「匯入AI解析」分類後的預覽視窗太小（原 `min-height: 70px`），手機上難以看完一段解析。

## 誰動的

Grok 改 UI；使用者串試後回饋。

## 變更

1. 先把貼上框、預覽框、單檔貼上欄都加高（約 220–240px）。
2. 使用者：視窗有大，但過大，要依字數調整。
3. 改成依內容 `scrollHeight` 自動撐高：
   - 最短約 72px（空白／短文）
   - 字變多就跟著長
   - 最高約半螢幕，再長在框內捲
   - 貼上時隊輸入重算

## 檔案

- `style.css`：`.ai-paste` / `.ai-preview` / `.ai-unmatched`
- `js/features/holdings.view.js`：`fitAiTextarea`、`bindFitAiTextareas`

## 沒改

分類邏輯、寫入規則、Excel 匯出都沒動。
