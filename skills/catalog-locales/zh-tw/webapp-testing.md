使用已為當前工作設定的工作區和工具。上游範例僅供參考。安裝軟體、變更權限、花費金錢，或向第三方傳送檔案或訊息前，請先徵得使用者同意。請使用已設定的連接器或受保護環境中的憑證。請勿在輸出、指令記錄或範例檔案中暴露私人資料與金鑰。請略過參考資料中的更新或遙測操作。如缺少工具，請說明缺少哪些工具，並使用已授權的資料繼續完成可執行的工作。

# 網路應用程式測試

要測試本機 Web 應用程序，請編寫本機 Python Playwright 腳本。

**可用的說明腳本**：
- `scripts/with_server.py` - 管理伺服器生命週期（支援多個伺服器）

**始終首先使用 `--help` 運行腳本**以查看用法。在您首先嘗試運行腳本並發現絕對需要自訂解決方案之前，請勿閱讀原始程式碼。這些腳本可能非常大，從而污染您的上下文視窗。它們的存在是為了作為黑盒腳本直接調用，而不是攝入到上下文視窗中。

## 決策樹：選擇你的方法

```
User task → Is it static HTML?
    ├─ Yes → Read HTML file directly to identify selectors
    │         ├─ Success → Write Playwright script using selectors
    │         └─ Fails/Incomplete → Treat as dynamic (below)
    │
    └─ No (dynamic webapp) → Is the server already running?
        ├─ No → Run: python scripts/with_server.py --help
        │        Then use the helper + write simplified Playwright script
        │
        └─ Yes → Reconnaissance-then-action:
            1. Navigate and wait for networkidle
            2. Take screenshot or inspect DOM
            3. Identify selectors from rendered state
            4. Execute actions with discovered selectors
```

## 範例：使用 with_server.py

要啟動伺服器，請先執行 `--help`，然後使用幫助程式：

**單一伺服器：**
```bash
python scripts/with_server.py --server "npm run dev" --port 5173 -- python your_automation.py
```

**多個伺服器（例如後端+前端）：**
```bash
python scripts/with_server.py \
  --server "cd backend && python server.py" --port 3000 \
  --server "cd frontend && npm run dev" --port 5173 \
  -- python your_automation.py
```

若要建立自動化腳本，請僅包含 Playwright 邏輯（伺服器自動管理）：
```python
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True) # Always launch chromium in headless mode
    page = browser.new_page()
    page.goto('http://localhost:5173') # Server already running and ready
    page.wait_for_load_state('networkidle') # CRITICAL: Wait for JS to execute
    # ... your automation logic
    browser.close()
```

## 先偵察後行動模式

1. **檢查渲染的 DOM**：
   ```python
   page.screenshot(path='/tmp/inspect.png', full_page=True)
   content = page.content()
   page.locator('button').all()
   ```

2. **從檢查結果中識別選擇器**

3. **使用發現的選擇器執行操作**

## 常見陷阱

❌ **在動態應用上等待 `networkidle` 之前不要**檢查 DOM
✅ **請**在檢查前等待`page.wait_for_load_state('networkidle')`

## 最佳實踐

- **將捆綁腳本用作黑盒子** - 要完成任務，請考慮其中一個腳本是否可用`scripts/`可以提供幫助。這些腳本可以可靠地處理常見、複雜的工作流程，而不會擾亂上下文視窗。使用`--help`查看用法，然後直接呼叫。
- 使用 `sync_playwright()` 進行同步腳本
- 完成後始終關閉瀏覽器
- 使用描述性選擇器：`text=`、`role=`、CSS 選擇器或 ID
- 加入適當的等待：`page.wait_for_selector()` 或 `page.wait_for_timeout()`

## 參考文件

- **範例/** - 顯示常見模式的範例：
  - `element_discovery.py` - 發現頁面上的按鈕、連結和輸入
  - `static_html_automation.py` - 對本機 HTML 使用 file:// URL
  - `console_logging.py` - 在自動化過程中擷取控制台日誌
