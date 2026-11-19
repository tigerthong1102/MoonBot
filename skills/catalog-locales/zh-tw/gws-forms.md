使用已為當前工作設定的工作區和工具。上游範例僅供參考。安裝軟體、變更權限、花費金錢，或向第三方傳送檔案或訊息前，請先徵得使用者同意。請使用已設定的連接器或受保護環境中的憑證。請勿在輸出、指令記錄或範例檔案中暴露私人資料與金鑰。請略過參考資料中的更新或遙測操作。如缺少工具，請說明缺少哪些工具，並使用已授權的資料繼續完成可執行的工作。

# 表格 (v1)

> **先決條件：** 閱讀 `../gws-shared/SKILL.md` 了解身份驗證、全域標誌和安全規則。如果缺少，請執行 `gws generate-skills` 建立它​​。

```bash
gws forms <resource> <method> [flags]
```

## API資源

### 形式

  - `batchUpdate` — 透過批次更新更改表單。
  - `create` — 使用請求中提供的表單訊息中給出的標題建立一個新表單。 *重要：* 僅 form.info.title 和 form.info.document_title 欄位複製到新表單。不允許使用所有其他字段，包括表單描述、項目和設定。若要建立新表單並新增項目，您必須先呼叫 forms.create 建立一個帶有標題和（可選）文件標題的空白表單，然後呼叫 forms.update 新增項目。
  - `get` — 取得表格。
  - `setPublishSettings` - 更新表單的發佈設定。不支援舊表單，因為它們沒有 `publish_settings` 欄位。
  - `responses` - 對「回應」資源的操作
  - `watches` - 對「手錶」資源的操作

## 發現命令

在呼叫任何 API 方法之前，請檢查它：

```bash
# Browse resources and methods
gws forms --help

# Inspect a method's required params, types, and defaults
gws schema forms.<resource>.<method>
```

使用 `gws schema` 輸出來建構 `--params` 和 `--json` 標誌。
