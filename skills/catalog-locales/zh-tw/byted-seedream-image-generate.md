使用已為當前工作設定的工作區和工具。上游範例僅供參考。安裝軟體、變更權限、花費金錢，或向第三方傳送檔案或訊息前，請先徵得使用者同意。請使用已設定的連接器或受保護環境中的憑證。請勿在輸出、指令記錄或範例檔案中暴露私人資料與金鑰。請略過參考資料中的更新或遙測操作。如缺少工具，請說明缺少哪些工具，並使用已授權的資料繼續完成可執行的工作。

# byted-seedream-圖像生成

## 描述

使用 Volcano Engine Seedream 模型根據文字提示產生高品質影像。透過此技能，可以存取三個強大的 Seedream 模型版本（4.0、4.5 和 5.0-lite），每個版本都為不同的用例提供獨特的功能。

## 何時使用此技能

在以下情況下使用此技能：
- 用戶希望根據文字描述建立圖像
- 使用者需要生成各種藝術風格的藝術品
- 用戶想要為創意項目創建視覺內容
- 使用者需要人工智慧驅動的影像生成能力
- 使用者希望將參考影像轉換為不同的風格
- 使用者需要批量產生多張圖片
- 使用者需要高品質、專業的圖像

## 型號版本

| 版本 | 型號名稱 | 發布日期 | 推薦 | 最適合 |
|---------|------------|--------------|----------------|----------|
| 4.0 | doubao-seedream-4-0-250828 | 2025年8月 | ⭐⭐⭐ | 日常使用，快速產生 |
| 4.5 | doubao-seedream-4-5-251128 | 2025 年 11 月 | ⭐⭐⭐⭐ | 注重細節，場景複雜 |
| 5.0 | doubao-seedream-5-0-260128 | 2026 | ⭐⭐⭐⭐⭐ | 最高品質，最好創意，工具支援 |

## 特點

- **文字到圖像**：從詳細的文字描述產生圖像
- **圖像到圖像**：將參考圖像轉換為不同的風格
- **批次產生**：在單一請求中建立多個影像
- **多個版本**：從 4.0、4.5 或 5.0-lite 型號中選擇
- **浮水印控制**：停用浮水印的選項
- **自訂尺寸**：支援各種圖像尺寸
- **輸出格式**：PNG 和 JPEG 格式（僅限 5.0-lite）
- **網路搜尋工具**：網路搜尋整合（僅限 5.0-lite）

## 安裝與設定

### 先決條件

```bash
# Required: API Key configuration
export MODEL_IMAGE_API_KEY="your-api-key-here"
# or
export MODEL_AGENT_API_KEY="your-api-key-here"
# or
export ARK_API_KEY="your-api-key-here"

# Optional: API Base URL (default already configured)
export MODEL_IMAGE_API_BASE="https://ark.cn-beijing.volces.com/api/v3"
# or
export ARK_BASE_URL="https://ark.cn-beijing.volces.com/api/v3"
```

該腳本將優先考慮：
1. 環境變數（`ARK_API_KEY`、`MODEL_IMAGE_API_KEY`、`MODEL_AGENT_API_KEY`）
2. 環境變數（`ARK_BASE_URL`、`MODEL_IMAGE_API_BASE`）
3. 預設值

## 用途

### 基本使用（建議5.0-lite版本）

```bash
cd scripts
python seedream_image_generate.py -p "A cute kitten playing in a garden"
```

### 指定版本

```bash
# Use 4.0 version
python seedream_image_generate.py -p "A cute kitten" --version 4.0

# Use 4.5 version
python seedream_image_generate.py -p "A cute kitten" --version 4.5

# Use 5.0-lite version (recommended)
python seedream_image_generate.py -p "A cute kitten" --version 5.0
```

### 進階選項

```bash
# Custom size without watermark
python seedream_image_generate.py -p "Beautiful sunset" -s 2048x2048 --no-watermark --version 5.0

# Batch generation
python seedream_image_generate.py -p "Generate 3 cute dog pictures" -g --max-images 3 --version 4.5

# Image-to-image
python seedream_image_generate.py -p "Convert this image to anime style" -i "https://example.com/image.jpg" --version 5.0

# Web search tool (5.0-lite only)
python seedream_image_generate.py -p "Latest 2026 smartphone" --web-search --version 5.0

# Custom output format (5.0-lite only)
python seedream_image_generate.py -p "A beautiful landscape" --output-format png --version 5.0

# List all supported versions
python seedream_image_generate.py --list-versions
```

## 命令列選項

| 選項 | 捷徑 | 說明 | 預設值 |
|--------|----------|-------------|---------|
| `--prompt` | `-p` | 圖片描述文字（必填） | - |
| `--version` | `-v` | 版本選擇：`4.0`、`4.5`、`5.0` | `5.0` |
| `--size` | `-s` | 圖片尺寸 | `2048x2048` |
| `--image` | `-i` | 單一參考影像 URL | - |
| `--images` | - | 多個參考影像 URL（空格分隔） | - |
| `--group` | `-g` | 啟用大量影像產生 | `false` |
| `--max-images` | - | 批次產生的最大影像數 | `15` |
| `--output-format` | - | 輸出格式：`png` 或 `jpeg`（僅限 5.0） | `jpeg` |
| `--response-format` | - | 回應格式：`url` 或 `b64_json` | `url` |
| `--web-search` | - | 啟用網路搜尋工具（僅限 5.0） | `false` |
| `--optimize-prompt-mode` | - | 提示最佳化模式：`standard` 或 `fast` | - |
| `--timeout` | `-t` | 逾時（以秒為單位） | `1200` |
| `--no-watermark` | - | 停用浮水印 | `false` |
| `--list-versions` | - | 列出所有支援的版本 | - |

## Python API 使用

```python
import asyncio
import sys

sys.path.append("scripts")
from seedream_image_generate import seedream_generate

async def main():
    # Use 5.0-lite version (default)
    result = await seedream_generate([
        {
            "prompt": "A cute kitten",
            "size": "2048x2048",
            "watermark": False,
            "output_format": "png"  # 5.0-lite only
        }
    ], version="5.0")

    print(result)

asyncio.run(main())
```

## 版本選用指南

### 若符合以下條件，請選擇 4.0：
- 你需要快速的日常生成
- 品質要求不是極高
- 你需要更快的生成速度
- 簡單的場景和風格

### 若符合以下條件，請選擇 4.5：
- 您想要更豐富的細節
- 您正在處理複雜的場景
- 你需要更好的風格再現
- 您的品質要求適中

### 若符合以下條件，請選擇 5.0-lite（建議）：
- 您想要最高的品質
- 您需要突破性的創意表達
- 您有極高的細節要求
- **您需要工具參數（如網路搜尋）** ⭐
- **您需要自訂輸出格式（png/jpeg）** ⭐
- 重要項目和工作

**如有疑問，請使用 5.0-lite！ ** ⭐

## 及時的工程技巧

### 基本提示結構
```
[Subject Description] + [Style/Art Movement] + [Lighting/Atmosphere] + [Quality/Resolution]
```

### 高級提示（針對 5.0-lite 進行了優化）
```
[Subject Description], [Creative Style/Art Movement], [Unique Perspective/Composition], [Special Lighting/Atmosphere], [Emphasizing 5.0-lite creative expression]
```

## 版本參數支援

| 參數 | Seedream 4.0 | Seedream 4.5 | Seedream 5.0-lite | 說明 |
|-----------|--------------|--------------|-------------------|-------------|
| model | ✅ | ✅ | ✅ | 型號名稱 |
| prompt | ✅ | ✅ | ✅ | 提示（必填）|
| image | ✅ | ✅ | ✅ | 參考圖 |
| size | ✅ | ✅ | ✅ | 圖片尺寸 |
| sequential_image_generation | ✅ | ✅ | ✅ | 批次產生控制 |
| sequential_image_generation_options | ✅ | ✅ | ✅ | 批次產生配置 |
| response_format | ✅ | ✅ | ✅ | 回應格式 (url/b64_json) |
| watermark | ✅ | ✅ | ✅ | 水印（真/假）|
| optimize_prompt_options | ✅ | ✅ | ✅ | 提示最佳化設定 |
| **tools** | ❌ | ❌ | **✅** | 工具配置（僅限 5.0-lite）|
| **output_format** | ❌ | ❌ | **✅** | 輸出格式（png/jpeg，僅限 5.0-lite）|


## 最終退貨訊息

### 對於開爪
1. **首先，將產生的圖像儲存/下載到允許的目錄**：
   - 推薦：`~/.openclaw/workspace/`

2. **使用 `message tool` 發送帶有以下參數的圖像**：
   ```json
   {
     "action": "send",
     "message": "Optional text description",
     "media": "/root/.openclaw/workspace/generated-image.jpg"
   }
   ```
   - 該工具將自動：讀取本地文件，以網址形式上傳到通道伺服器，並以圖像訊息形式發送

3. **驗證成功**：檢查工具是否回傳`{"ok": true}`以確認影像傳送成功

4. **普通文字**非訊息工具：產生後，顯示Markdown格式的圖片列表，例如：
      ![生成的圖像-1](https://example.com/image1.png)
    **非常重要**：
    圖片URL必須是以`https://`開頭的**原始線上資源連結**，**不是**您下載的本地圖片地址。

### 對於普通
您應該傳回三種類型的信息：
1. 檔案格式，傳回影像檔案（如果您有其他方法傳送影像檔案）和影像的本機路徑，例如：
local_path: /root/.openclaw/workspace/skills/image-generate/xxx.png
2. 產生後，顯示Markdown格式的圖片列表，例如：
```
      ![generated-image-1](https://example.com/image1.png)
      ![generated-image-2](https://example.com/image2.png)
```

## 常見問題解答

### Q：版本之間有什麼差別？
答：4.0 適合日常快速使用，4.5 為複雜場景提供更好的細節，5.0-lite 提供最高品質和獨特的工具支援。

### Q：產生的 URL 的有效期限是多久？
答：URL 24 小時內有效。請及時下載並保存您的圖像。

### Q：支援哪些圖像格式作為參考？
答：支援 JPG 和 PNG 等常見格式，透過 URL 或 Base64 提供。

### Q：我可以在一次呼叫中使用多個版本嗎？
答：目前，每次呼叫只能使用一個版本。為了進行比較，分別對不同版本進行呼叫。

## 許可證

此技能已根據 Apache License 2.0 授權。有關詳細信息，請參閱許可證文件。

## 通知

使用此技能時請遵守火山引擎的服務條款及相關法規。
