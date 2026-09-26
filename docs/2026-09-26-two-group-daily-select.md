# 兩組每日選股（10日循環）

2026-09-26 規格。2026-09-27 補 Choose／Termux。不改 FIFO／帳。App 進出場程式尚未改。

## 兩組（文件已留）

A 林昇結構
- 進場：收盤 > MA60 且 收盤 > 前20日最高（不含當日）
- 停損：前10日最低（不含當日）
- 停利：進場 + 1.5×（進場−停損）；須停損 < 進場

B APP四關進＋林昇出
- 進場四關同時成立：MA5>MA20>MA60、收盤>前20日最高、ADX(14)≥25、量≥前20日均量
- 出場同 A（前低停、1.5R）

不用樞紐高、不用進場日必須已有前高目標、不用 TWII 硬濾。

## 全市場路徑（2026-09-27）

走 `wang123890-alt/Choose`，不走 Trade 手機帳本。
- 抓檔：TWSE `STOCK_DAY_ALL` + TPEx OpenAPI，寫 `data/choose.db`
- 策略：`app/strategies/two_groups.py`
  - `linsheng_structure`
  - `app_four_gate`
- 純 Python，不需 numpy；Termux 不裝 ruff
- 排程：平日 15:30 Asia/Taipei（Choose 原設定）

Termux 安裝（2026-09-27）：
- `gh auth login`（瀏覽器 device code）後 `gh repo clone wang123890-alt/Choose`
- 只裝：fastapi uvicorn sqlalchemy apscheduler jinja2 requests python-multipart pytz
- `python run.py`；手機內建瀏覽器開 `http://127.0.0.1:8000`
- 不要在 Grok App 開 localhost；家目錄的 `run.py` 是別專案
- 技術面需約 60 個全市場交易日才算得出兩組

10 日滾動表、連日標記尚未接上 Choose 匠表板。
