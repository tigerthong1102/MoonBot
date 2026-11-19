使用已為當前工作設定的工作區和工具。上游範例僅供參考。安裝軟體、變更權限、花費金錢，或向第三方傳送檔案或訊息前，請先徵得使用者同意。請使用已設定的連接器或受保護環境中的憑證。請勿在輸出、指令記錄或範例檔案中暴露私人資料與金鑰。請略過參考資料中的更新或遙測操作。如缺少工具，請說明缺少哪些工具，並使用已授權的資料繼續完成可執行的工作。

# 檢查表單回复

> **先決條件：** 載入以下技能來執行此配方：`gws-forms`

檢索並查看 Google 表單的回應。

## 步驟

1. 列出表單：`gws forms forms list`（如果您沒有表單 ID）
2. 取得表格詳細資訊：`gws forms forms get --params '{"formId": "FORM_ID"}'`
3. 取得回應：`gws forms forms responses list --params '{"formId": "FORM_ID"}' --format table`
