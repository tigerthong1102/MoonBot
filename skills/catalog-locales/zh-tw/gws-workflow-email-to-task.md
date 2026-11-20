使用已為當前工作設定的工作區和工具。上游範例僅供參考。安裝軟體、變更權限、花費金錢，或向第三方傳送檔案或訊息前，請先徵得使用者同意。請使用已設定的連接器或受保護環境中的憑證。請勿在輸出、指令記錄或範例檔案中暴露私人資料與金鑰。請略過參考資料中的更新或遙測操作。如缺少工具，請說明缺少哪些工具，並使用已授權的資料繼續完成可執行的工作。

# 工作流程+電子郵件到任務

> **先決條件：** 閱讀 `../gws-shared/SKILL.md` 了解身份驗證、全域標誌和安全規則。如果缺少，請執行 `gws generate-skills` 建立它​​。

將 Gmail 郵件轉換為 Google Tasks 條目

## 用途

```bash
gws workflow +email-to-task --message-id <ID>
```

## 旗幟

| 標誌 | 必需 | 預設 | 描述 |
|------|----------|---------|-------------|
| `--message-id` | ✓ | — | 要轉換的 Gmail 郵件 ID |
| `--tasklist` | — | @default | 任務清單 ID（預設：@default） |

## 範例

```bash
gws workflow +email-to-task --message-id MSG_ID
gws workflow +email-to-task --message-id MSG_ID --tasklist LIST_ID
```

## 溫馨提示

- 將電子郵件主題讀取為任務標題，將摘要讀取為註釋。
- 建立一個新任務 - 在執行之前與使用者確認。

## 另請參閱

- [gws-shared](../gws-shared/SKILL.md) — 全域標誌與驗證
- `gws workflow --help` — 可用的跨服務工作流程
