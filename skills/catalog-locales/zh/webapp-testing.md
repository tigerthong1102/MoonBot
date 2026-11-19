使用已为当前任务配置的工作区和工具。上游示例仅供参考。安装软件、更改权限、花费资金，或向第三方发送文件或消息之前，请征得用户同意。请使用已配置的连接器或受保护环境中的凭据。请勿在输出、命令日志或示例文件中暴露私人数据和密钥。请跳过参考材料中的更新或遥测操作。缺少工具时，请说明缺少哪些工具，并使用现有授权数据继续完成可执行的工作。

# 网络应用程序测试

要测试本地 Web 应用程序，请编写本机 Python Playwright 脚本。

**可用的帮助脚本**：
- `scripts/with_server.py` - 管理服务器生命周期（支持多个服务器）

**始终首先使用 `--help` 运行脚本**以查看用法。在您首先尝试运行脚本并发现绝对需要定制解决方案之前，请勿阅读源代码。这些脚本可能非常大，从而污染您的上下文窗口。它们的存在是为了作为黑盒脚本直接调用，而不是摄入到上下文窗口中。

## 决策树：选择你的方法

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

## 示例：使用 with_server.py

要启动服务器，请先运行 `--help`，然后使用帮助程序：

**单服务器：**
```bash
python scripts/with_server.py --server "npm run dev" --port 5173 -- python your_automation.py
```

**多个服务器（例如后端+前端）：**
```bash
python scripts/with_server.py \
  --server "cd backend && python server.py" --port 3000 \
  --server "cd frontend && npm run dev" --port 5173 \
  -- python your_automation.py
```

要创建自动化脚本，请仅包含 Playwright 逻辑（服务器自动管理）：
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

## 先侦察后行动模式

1. **检查渲染的 DOM**：
   ```python
   page.screenshot(path='/tmp/inspect.png', full_page=True)
   content = page.content()
   page.locator('button').all()
   ```

2. **从检查结果中识别选择器**

3. **使用发现的选择器执行操作**

## 常见陷阱

❌ **在动态应用上等待 `networkidle` 之前不要**检查 DOM
✅ **请**在检查前等待`page.wait_for_load_state('networkidle')`

## 最佳实践

- **将捆绑脚本用作黑匣子** - 要完成任务，请考虑其中一个脚本是否可用`scripts/`可以提供帮助。这些脚本可以可靠地处理常见、复杂的工作流程，而不会扰乱上下文窗口。使用`--help`查看用法，然后直接调用。
- 使用 `sync_playwright()` 进行同步脚本
- 完成后始终关闭浏览器
- 使用描述性选择器：`text=`、`role=`、CSS 选择器或 ID
- 添加适当的等待：`page.wait_for_selector()` 或 `page.wait_for_timeout()`

## 参考文件

- **示例/** - 显示常见模式的示例：
  - `element_discovery.py` - 发现页面上的按钮、链接和输入
  - `static_html_automation.py` - 对本地 HTML 使用 file:// URL
  - `console_logging.py` - 在自动化过程中捕获控制台日志
