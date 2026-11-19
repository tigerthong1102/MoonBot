使用已為當前工作設定的工作區和工具。上游範例僅供參考。安裝軟體、變更權限、花費金錢，或向第三方傳送檔案或訊息前，請先徵得使用者同意。請使用已設定的連接器或受保護環境中的憑證。請勿在輸出、指令記錄或範例檔案中暴露私人資料與金鑰。請略過參考資料中的更新或遙測操作。如缺少工具，請說明缺少哪些工具，並使用已授權的資料繼續完成可執行的工作。

# 從工作表資料產生 Google 文件報告

> **先決條件：** 載入以下技能來執行此配方：`gws-sheets`、`gws-docs`、`gws-drive`

從 Google Sheet 讀取資料並建立格式化的 Google Docs 報告。

## 步驟

1. 讀取資料：`gws sheets +read --spreadsheet SHEET_ID --range "Sales!A1:D"`
2. 建立報告文件：`gws docs documents create --json '{"title": "Sales Report - January 2025"}'`
3. 撰寫報告：`gws docs +write --document-id DOC_ID --text '## 銷售報告 - 2025 年 1 月

### 總結
交易總數：45
收入：125,000 美元

### 熱門優惠
1. Acme 公司 - 25,000 美元
2. Widget 公司 - $18,000'`
4. 與利害關係人分享：`gws drive permissions create --params '{"fileId": "DOC_ID"}' --json '{"role": "reader", "type": "user", "emailAddress": "cfo@company.com"}'`
