使用已為當前工作設定的工作區和工具。上游範例僅供參考。安裝軟體、變更權限、花費金錢，或向第三方傳送檔案或訊息前，請先徵得使用者同意。請使用已設定的連接器或受保護環境中的憑證。請勿在輸出、指令記錄或範例檔案中暴露私人資料與金鑰。請略過參考資料中的更新或遙測操作。如缺少工具，請說明缺少哪些工具，並使用已授權的資料繼續完成可執行的工作。

# 床單 (v4)

> **先決條件：** 閱讀 `../gws-shared/SKILL.md` 了解身份驗證、全域標誌和安全規則。如果缺少，請執行 `gws generate-skills` 建立它​​。

```bash
gws sheets <resource> <method> [flags]
```

## 輔助命令

| 指令 | 說明 |
|---------|-------------|
| `+append` | 將行追加到電子表格 |
| `+read` | 從電子表格讀取值 |

## API資源

### 試算表

  - `batchUpdate` — 對電子表格套用一項或多項更新。每個請求在應用之前都會經過驗證。如果任何請求無效，則整個請求將失敗並且不會套用任何內容。有些請求會得到回复，為您提供一些有關如何應用它們的資訊。回復將反映請求。例如，如果您應用了 4 個更新，而第 3 個更新有回复，則響應將按順序包含 2 個空回复、實際回復和另一個空回复。
  - `create` - 建立電子表格，返回新建立的電子表格。
  - `get`— 傳回給定 ID 處的電子表格。呼叫者必須指定電子表格 ID。預設情況下，不傳回網格內的資料。您可以透過以下兩種方式之一包含網格資料： * 指定 [欄位遮罩](https://developers.google.com/workspace/sheets/api/guides/field-masks）使用列出您想要的字段`fields`HTTP 中的 URL 參數 * 將 includeGridData URL 參數設為 true。
  - `getByDataFilter` — 傳回給定 ID 處的電子表格。呼叫者必須指定電子表格 ID。有關詳細信息，請參閱[讀取、寫入和搜尋元資料](https://developers.google.com/workspace/sheets/api/guides/metadata)。此方法與 GetSpreadsheet 的不同之處在於，它允許透過指定 dataFilters 參數來選擇要傳回的電子表格資料子集。可以指定多個資料過濾器。
  - `developerMetadata` - 對「developerMetadata」資源的操作
  - `sheets` - 對「sheets」資源的操作
  - `values` - 對「值」資源的操作

## 發現命令

在呼叫任何 API 方法之前，請檢查它：

```bash
# Browse resources and methods
gws sheets --help

# Inspect a method's required params, types, and defaults
gws schema sheets.<resource>.<method>
```

使用 `gws schema` 輸出來建構 `--params` 和 `--json` 標誌。
