使用已為當前工作設定的工作區和工具。上游範例僅供參考。安裝軟體、變更權限、花費金錢，或向第三方傳送檔案或訊息前，請先徵得使用者同意。請使用已設定的連接器或受保護環境中的憑證。請勿在輸出、指令記錄或範例檔案中暴露私人資料與金鑰。請略過參考資料中的更新或遙測操作。如缺少工具，請說明缺少哪些工具，並使用已授權的資料繼續完成可執行的工作。

# 從範本建立 Google 文件

> **先決條件：** 載入以下技能來執行此配方：`gws-drive`、`gws-docs`

複製 Google 文件模板，填寫內容並與協作者共用。

## 步驟

1. 複製模板：`gws drive files copy --params '{"fileId": "TEMPLATE_DOC_ID"}' --json '{"name": "Project Brief - Q2 Launch"}'`
2. 從回應中取得新的文件 ID
3. 新增內容：`gws docs +write --document-id NEW_DOC_ID --text '## 專案：第二季度啟動

### 目的
在第二季末推出新功能。 '`
4. 與團隊分享：`gws drive permissions create --params '{"fileId": "NEW_DOC_ID"}' --json '{"role": "writer", "type": "user", "emailAddress": "team@company.com"}'`
