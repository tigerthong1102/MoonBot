使用已為當前工作設定的工作區和工具。上游範例僅供參考。安裝軟體、變更權限、花費金錢，或向第三方傳送檔案或訊息前，請先徵得使用者同意。請使用已設定的連接器或受保護環境中的憑證。請勿在輸出、指令記錄或範例檔案中暴露私人資料與金鑰。請略過參考資料中的更新或遙測操作。如缺少工具，請說明缺少哪些工具，並使用已授權的資料繼續完成可執行的工作。

# 驅動器（v3）

> **先決條件：** 閱讀 `../gws-shared/SKILL.md` 了解身份驗證、全域標誌和安全規則。如果缺少，請執行 `gws generate-skills` 建立它​​。

```bash
gws drive <resource> <method> [flags]
```

## 輔助命令

| 指令 | 說明 |
|---------|-------------|
| `+upload` | 上傳帶有自動元資料的檔案 |

## API資源

### 關於

  - `get` — 取得有關使用者、使用者的驅動器和系統功能的資訊。有關詳細信息，請參閱[返回用戶資訊](https://developers.google.com/workspace/drive/api/guides/user-info)。必需：必須設定`fields`參數。若要返回您需要的確切字段，請參閱[返回特定字段](https://developers.google.com/workspace/drive/api/guides/fields-parameter)。

### 訪問建議

  - `get` — 按 ID 擷取存取建議。有關詳細信息，請參閱[管理待處理的訪問建議](https://developers.google.com/workspace/drive/api/guides/pending-access)。
  - `list` — 列出文件的存取建議。有關詳細信息，請參閱[管理待處理的訪問建議](https://developers.google.com/workspace/drive/api/guides/pending-access)。注意：只有批准者才能列出文件的存取建議。如果使用者不是審核者，則傳回 403 錯誤。
  - `resolve` — 批准或拒絕訪問建議。有關詳細信息，請參閱[管理待處理的訪問建議](https://developers.google.com/workspace/drive/api/guides/pending-access)。

### 核准

  - `get` — 獲得 ID 批准。
  - `list` — 列出文件的批准。

### 應用程式

  - `get` — 取得特定應用程式。有關詳細信息，請參閱[返回用戶資訊](https://developers.google.com/workspace/drive/api/guides/user-info)。
  - `list` — 列出使用者安裝的應用程式。有關詳細信息，請參閱[返回用戶資訊](https://developers.google.com/workspace/drive/api/guides/user-info)。

### 變化

  - `getStartPageToken` — 取得用於列出未來變更的起始 pageToken。有關詳細信息，請參閱[檢索更改](https://developers.google.com/workspace/drive/api/guides/manage-changes)。
  - `list` — 列出使用者或共用磁碟機的變更。有關詳細信息，請參閱[檢索更改](https://developers.google.com/workspace/drive/api/guides/manage-changes)。
  - `watch` — 訂閱用戶的變更。有關詳細信息，請參閱[資源變更通知](https://developers.google.com/workspace/drive/api/guides/push)。

### 頻道

  - `stop` — 停止透過該頻道觀看資源。有關詳細信息，請參閱[資源變更通知](https://developers.google.com/workspace/drive/api/guides/push)。

### 評論

  - `create` — 在文件上建立註解。欲了解更多信息，請參閱[管理評論和回复](https://developers.google.com/workspace/drive/api/guides/manage-comments)。必需：必須設定`fields`參數。若要返回您需要的確切字段，請參閱[返回特定字段](https://developers.google.com/workspace/drive/api/guides/fields-parameter)。
  - `delete` — 刪除評論。欲了解更多信息，請參閱[管理評論和回复](https://developers.google.com/workspace/drive/api/guides/manage-comments)。
  - `get` — 透過 ID 取得評論。欲了解更多信息，請參閱[管理評論和回复](https://developers.google.com/workspace/drive/api/guides/manage-comments)。必需：必須設定`fields`參數。若要返回您需要的確切字段，請參閱[返回特定字段](https://developers.google.com/workspace/drive/api/guides/fields-parameter)。
  - `list` — 列出文件的註解。欲了解更多信息，請參閱[管理評論和回复](https://developers.google.com/workspace/drive/api/guides/manage-comments)。必需：必須設定`fields`參數。若要返回您需要的確切字段，請參閱[返回特定字段](https://developers.google.com/workspace/drive/api/guides/fields-parameter)。
  - `update` - 使用補丁語意更新註解。欲了解更多信息，請參閱[管理評論和回复](https://developers.google.com/workspace/drive/api/guides/manage-comments)。必需：必須設定`fields`參數。若要返回您需要的確切字段，請參閱[返回特定字段](https://developers.google.com/workspace/drive/api/guides/fields-parameter)。

### 驅動器

  - `create` — 建立共用磁碟機。有關詳細信息，請參閱[管理共享雲端硬碟](https://developers.google.com/workspace/drive/api/guides/manage-shareddrives)。
  - `get` — 按 ID 取得共用磁碟機的元資料。有關詳細信息，請參閱[管理共享雲端硬碟](https://developers.google.com/workspace/drive/api/guides/manage-shareddrives)。
  - `hide` — 在預設視圖中隱藏共用磁碟機。有關詳細信息，請參閱[管理共享雲端硬碟](https://developers.google.com/workspace/drive/api/guides/manage-shareddrives)。
  - `list` — 列出使用者的共用磁碟機。此方法接受 `q` 參數，該參數是組合一個或多個搜尋字詞的搜尋查詢。有關詳細信息，請參閱[搜尋共用磁碟機](https://developers.google.com/workspace/drive/api/guides/search-shareddrives) 指南。
  - `unhide` — 將共用磁碟機還原為預設視圖。有關詳細信息，請參閱[管理共享雲端硬碟](https://developers.google.com/workspace/drive/api/guides/manage-shareddrives)。
  - `update` — 更新共用磁碟機的元資料。有關詳細信息，請參閱[管理共享雲端硬碟](https://developers.google.com/workspace/drive/api/guides/manage-shareddrives)。

### 文件

  - `copy` — 建立文件的副本並使用補丁語意應用任何要求的更新。有關詳細信息，請參閱[建立和管理文件](https://developers.google.com/workspace/drive/api/guides/create-file)。
  - `create` — 建立一個檔案。有關詳細信息，請參閱[建立和管理文件](https://developers.google.com/workspace/drive/api/guides/create-file)。此方法支援 */upload* URI 並接受具有以下特徵的上傳媒體： - *最大檔案大小：* 5,120 GB - *接受的媒體 MIME 類型：* `*/*` （指定有效的 MIME 類型，而不是文字 `*/*` 值。文字 `*/*` 僅用於指示 MIME 類型可以上傳任何有效的 MIME 類型。
  - `download` — 下載檔案的內容。有關詳細信息，請參閱[下載並匯出檔案](https://developers.google.com/workspace/drive/api/guides/manage-downloads)。操作自創建之日起 24 小時內有效。
  - `export` — 將 Google Workspace 文件匯出為要求的 MIME 類型並傳回匯出的位元組內容。有關詳細信息，請參閱[下載並匯出檔案](https://developers.google.com/workspace/drive/api/guides/manage-downloads)。請注意，匯出的內容限制為 10 MB。
  - `generateIds` — 產生一組可在建立或複製要求中提供的檔案 ID。有關詳細信息，請參閱[建立和管理文件](https://developers.google.com/workspace/drive/api/guides/create-file)。
  - `get` — 按 ID 取得檔案的元資料或內容。有關詳細信息，請參閱[搜尋文件和資料夾](https://developers.google.com/workspace/drive/api/guides/search-files)。如果您提供 URL 參數 `alt=media`，則回應將在回應正文中包含文件內容。只有當檔案儲存在雲端硬碟時，才可以使用 `alt=media` 下載內容。
  - `list` — 列出使用者的檔案。有關詳細信息，請參閱[搜尋文件和資料夾](https://developers.google.com/workspace/drive/api/guides/search-files)。此方法接受 `q` 參數，該參數是組合一個或多個搜尋字詞的搜尋查詢。此方法預設傳回*所有*文件，包括已刪除的文件。如果您不希望已刪除的檔案出現在清單中，請使用 `trashed=false` 查詢參數從結果中刪除已刪除的檔案。
  - `listLabels` — 列出文件上的標籤。有關詳細信息，請參閱[列出文件上的標籤](https://developers.google.com/workspace/drive/api/guides/list-labels)。
  - `modifyLabels` - 修改套用於檔案的標籤集。有關詳細信息，請參閱[在文件上設定標籤欄位](https://developers.google.com/workspace/drive/api/guides/set-label)。傳回已新增或修改的標籤的清單。
  - `update` — 更新檔案的元資料、內容或兩者。呼叫此方法時，僅填入請求中要修改的欄位。更新欄位時，某些欄位可能會自動更改，例如`modifiedDate`。此方法支援補丁語義。此方法支援 */upload* URI 並接受具有以下特徵的上傳媒體： - *最大檔案大小：* 5,120 GB - *接受的媒體 MIME 類型：* `*/*`（指定有效的 MIME 類型，而不是文字 `*/*` 值。
  - `watch` — 訂閱檔案的變更。有關詳細信息，請參閱[資源變更通知](https://developers.google.com/workspace/drive/api/guides/push)。

### 營運

  - `get` — 取得長時間運行的操作的最新狀態。用戶端可以使用此方法來依照API服務建議的時間間隔輪詢操作結果。

### 權限

  - `create` — 建立檔案或共用磁碟機的權限。有關詳細信息，請參閱[共用檔案、資料夾和磁碟機](https://developers.google.com/workspace/drive/api/guides/manage-sharing)。 **警告：** 不支援對相同檔案進行並發權限操作；僅套用最後一次更新。
  - `delete` — 刪除權限。有關詳細信息，請參閱[共用檔案、資料夾和磁碟機](https://developers.google.com/workspace/drive/api/guides/manage-sharing)。 **警告：** 不支援對相同檔案進行並發權限操作；僅套用最後一次更新。
  - `get` — 透過 ID 取得權限。有關詳細信息，請參閱[共用檔案、資料夾和磁碟機](https://developers.google.com/workspace/drive/api/guides/manage-sharing)。
  - `list` — 列出檔案或共用磁碟機的權限。有關詳細信息，請參閱[共用檔案、資料夾和磁碟機](https://developers.google.com/workspace/drive/api/guides/manage-sharing)。
  - `update` — 使用補丁語意更新權限。有關詳細信息，請參閱[共用檔案、資料夾和磁碟機](https://developers.google.com/workspace/drive/api/guides/manage-sharing)。 **警告：** 不支援對相同檔案進行並發權限操作；僅套用最後一次更新。

### 回覆

  - `create` — 建立評論回應。欲了解更多信息，請參閱[管理評論和回复](https://developers.google.com/workspace/drive/api/guides/manage-comments)。
  - `delete` — 刪除回覆。欲了解更多信息，請參閱[管理評論和回复](https://developers.google.com/workspace/drive/api/guides/manage-comments)。
  - `get` — 透過 ID 取得回應。欲了解更多信息，請參閱[管理評論和回复](https://developers.google.com/workspace/drive/api/guides/manage-comments)。
  - `list` — 列出評論的回應。欲了解更多信息，請參閱[管理評論和回复](https://developers.google.com/workspace/drive/api/guides/manage-comments)。
  - `update` - 使用補丁語意更新回覆。欲了解更多信息，請參閱[管理評論和回复](https://developers.google.com/workspace/drive/api/guides/manage-comments)。

### 修訂

  - `delete` — 永久刪除檔案版本。您只能刪除 Google 雲端硬碟中包含二進位內容的檔案（例如影像或影片）的修訂版本。其他文件（例如 Google 文件或表格）的修訂以及最後剩餘的文件版本無法刪除。有關詳細信息，請參閱[管理文件修訂](https://developers.google.com/drive/api/guides/manage-revisions)。
  - `get` — 按 ID 取得修訂的元資料或內容。有關詳細信息，請參閱[管理文件修訂](https://developers.google.com/workspace/drive/api/guides/manage-revisions)。
  - `list` — 列出文件的修訂版本。有關詳細信息，請參閱[管理文件修訂](https://developers.google.com/workspace/drive/api/guides/manage-revisions)。 **重要提示：** 對於具有大量修訂歷史記錄的文件（包括經常編輯的 Google 文件、表格和投影片），此方法傳回的修訂清單可能不完整。回應中可能會省略較舊的修訂版本，這意味著傳回的第一個修訂版本可能不是最舊的現有修訂版本。
  - `update` — 使用補丁語意更新修訂版。有關詳細信息，請參閱[管理文件修訂](https://developers.google.com/workspace/drive/api/guides/manage-revisions)。

### 團隊驅動

  - `create` — 已棄用：使用 `drives.create` 代替。
  - `get` — 已棄用：使用 `drives.get` 代替。
  - `list` — 已棄用：使用 `drives.list` 代替。
  - `update` — 已棄用：使用 `drives.update` 代替。

## 發現命令

在呼叫任何 API 方法之前，請檢查它：

```bash
# Browse resources and methods
gws drive --help

# Inspect a method's required params, types, and defaults
gws schema drive.<resource>.<method>
```

使用 `gws schema` 輸出來建構 `--params` 和 `--json` 標誌。
