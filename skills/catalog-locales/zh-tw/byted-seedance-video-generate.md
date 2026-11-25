使用已為當前工作設定的工作區和工具。上游範例僅供參考。安裝軟體、變更權限、花費金錢，或向第三方傳送檔案或訊息前，請先徵得使用者同意。請使用已設定的連接器或受保護環境中的憑證。請勿在輸出、指令記錄或範例檔案中暴露私人資料與金鑰。請略過參考資料中的更新或遙測操作。如缺少工具，請說明缺少哪些工具，並使用已授權的資料繼續完成可執行的工作。

# 影片生成技巧

該技能使用Doubao Seedance 1.0/1.5模型產生影片。

## 觸發條件

1. 用戶想要根據文字描述生成視頻
2. 用戶想要基於圖像（第一幀/最後一幀）創建視頻
3. 用戶想要使用參考材料（圖像、視頻、音頻）創建視頻
4. 用戶要求視頻生成功能

## 用途

### 環境變數

在使用此技能之前，請確保設定以下環境變數：

- `ARK_API_KEY` 或 `MODEL_VIDEO_API_KEY` 或 `MODEL_AGENT_API_KEY`：視訊產生服務的 API 金鑰
- `MODEL_VIDEO_API_BASE`：API 基本 URL（可選，有預設值）
- `MODEL_VIDEO_NAME`：型號名稱（可選，有預設值）

### 函數簽名

```python
async def video_generate(
    params: list,
    batch_size: int = 10,
    max_wait_seconds: int = 1200,
    model_name: str = None,
) -> Dict:
```

### 參數

#### 參數（列表[字典]）

影片產生請求清單。每個項目都是一個具有以下欄位的字典：

**每項所需：**

- `video_name`（str）：輸出視訊檔案的名稱/標識符
- `prompt` (str)：描述要產生的影片的文字。支援中文和英文。

**每項可選 - 輸入材質：**

- `first_frame` (str): 第一幀影像的 URL
- `last_frame` (str): 最後一幀圖像的 URL
- `reference_images` (list[str])：1-4 個參考圖像 URL，用於樣式/內容指導
- `reference_videos` (list[str])：0-3個參考影片URL（mp4/mov，每個2-15秒，總計≤15秒）
- `reference_audios` (list[str])：0-3個參考音訊URL（mp3/wav，每個2-15秒，總共≤15秒）

**每項可選 - 視訊輸出參數：**

- `ratio` (str)：縱橫比。選項：“16:9”（預設）、“9:16”、“4:3”、“3:4”、“1:1”、“2:1”、“21:9”、“自適應”
- `duration`（int）：影片長度（以秒為單位）。範圍：2-12 秒，取決於型號
- `resolution` (str)：視訊解析度。選項：“480p”、“720p”、“1080p”
- `frames`（int）：總幀數。必須為 [29, 289] 並遵循格式 25 + 4n
- `camera_fixed`（布爾）：鎖定相機運動。預設值：假
- `seed` (int)：用於再現性的隨機種子。範圍：[-1, 2^32-1]
- `watermark` (bool): 是否新增浮水印。預設值：假
- `generate_audio` (bool): 是否產生音訊。僅 Seedance 1.5 支援此功能
- `tools` (list[dict]): 工具配置，例如 `[{"type": "web_search"}]`

### 輸入模式

1. **文字轉視頻**：僅提供提示，無圖像/視頻
2. **第一幀導引**：為起始影像提供first_frame
3. **第一幀 + 最後一幀指導**：為過渡影片提供兩者
4. **參考圖像**：提供參考圖像以進行樣式/內容指導
5. **多模態參考**：結合參考影像、參考影片、參考音頻

### 傳回值

## 腳本回傳訊息

video_generate.py 腳本將傳回這些資訊：

```python
{
    "status": "success" | "partial_success" | "error",
    "success_list": [{"video_name": "video_url"}],
    "error_list": ["video_name"],
    "error_details": [{"video_name": "...", "error": {...}}],
    "pending_list": [{"video_name": "...", "task_id": "cgt-xxx", ...}]
}
```

根據腳本傳回訊息，傳回給使用者的最終回應包含影片產生任務的描述和影片 URL。您可以從該URL下載視頻，但仍應將視頻URL提供給用戶觀看和下載。

注意：URL是腳本回傳訊息的success_list中的'url'。
URL 必須以兩種方式傳回：

## 最終退貨訊息

### 對於開爪
1. **首先，將產生的影片儲存/下載到允許的目錄**：
   - 推薦：`~/.openclaw/workspace/`

2. **使用 `message tool` 傳送影片**，參數如下：
   ```json
   {
     "action": "send",
     "message": "Optional text description",
     "media": "/root/.openclaw/workspace/generated-video.mp4"
   }
   ```
   - 該工具將自動：讀取本地文件，以網址形式上傳到頻道伺服器，並以視訊訊息形式發送

3. **驗證成功**：檢查工具是否回傳`{"ok": true}`，確認視訊傳送成功

4. **普通文字**非訊息工具：產生後，顯示Markdown格式的影片列表，例如：
   ```
   <video src="https://example.com/video1.mp4" width="640" controls>video-1</video>
   ```
   **非常重要**：
   視訊網址必須是`https://`開頭的**原始線上資源連結**，**不是**您下載的本地視訊位址。

### 對於普通
您應該傳回三種類型的信息：
1. 文件格式，返回視訊檔案（如果您有其他方法發送視訊檔案）和視訊的本機路徑，例如：
local_path：/root/.openclaw/workspace/skills/video-generate/xxx.mp4
2. 產生後，顯示Markdown格式的影片列表，例如：
```
<video src="https://example.com/video1.mp4" width="640" controls>video-1</video>
<video src="https://example.com/video2.mp4" width="640" controls>video-2</video>
```

## 程式碼實現

請參閱 [scripts/video_generate.py](scripts/video_generate.py) 以了解完整的實作。

## 用法範例

```bash
# Text-to-Video
python scripts/video_generate.py -p "小猫骑着滑板穿过公园" -n cat_park -r 16:9 -d 5 --resolution 720p

# First Frame Guidance
python scripts/video_generate.py -p "小猫跳起来" -n cat_jump -f "https://example.com/cat.png" -r adaptive -d 5

# First + Last Frame Guidance
python scripts/video_generate.py -p "平滑过渡动画" -n transition \
    -f "https://example.com/start.png" \
    -l "https://example.com/end.png" \
    -d 6

# Reference Images (style/content guidance)
python scripts/video_generate.py -p "[图1]戴着眼镜的男生和[图2]柯基小狗坐在草坪上" -n styled \
    --ref-images "https://example.com/boy.png" "https://example.com/dog.png" \
    -r 16:9 -d 5

# Multimodal Reference (video + audio)
python scripts/video_generate.py -p "将视频中的人物换成[图1]中的男孩" -n multimodal \
    --ref-images "https://example.com/boy.png" \
    --ref-videos "https://example.com/source.mp4" \
    --ref-audios "https://example.com/voice.wav" \
    -d 5

# With Audio Generation (Seedance 1.5 only)
python scripts/video_generate.py -p "女孩抱着狐狸，可以听到风声和树叶沙沙声" -n with_audio \
    -f "https://example.com/girl_fox.png" \
    --generate-audio \
    -m doubao-seedance-1-5-pro-251215 \
    -d 6 --resolution 1080p

# Query task status
python scripts/video_generate.py -q "cgt-20260222165751-wsnw8"

# Use specific model
python scripts/video_generate.py -p "A futuristic city" -m doubao-seedance-2-5-260628

# No watermark
python scripts/video_generate.py -p "A beautiful landscape" --no-watermark
```

### 命令列選項

| 選項 | 短 | 描述 |
| -------- | ------- | ------------- |
| `--prompt` | `-p` | 影片的文字描述（必填） |
| `--name` | `-n` | 視訊名稱識別碼（預設：視訊） |
| `--model` | `-m` | 型號名稱（預設：doubao-seedance-2-5-260628） |
| `--ratio` | `-r` | 寬高比（預設值：16:9） |
| `--duration` | `-d` | 影片長度（以秒為單位）(2-12) |
| `--resolution` | | 視訊解析度：480p、720p、1080p |
| `--first-frame` | `-f` | 第一幀圖 URL |
| `--last-frame` | `-l` | 最後一幀圖片 URL |
| `--ref-images` | | 參考圖片 URL（以空格分隔，1-4 張圖片） |
| `--ref-videos` | | 參考影片 URL（以空格分隔，0-3 個影片） |
| `--ref-audios` | | 參考音訊 URL（空格分隔，0-3 個音訊） |
| `--generate-audio` | | 產生音訊（僅限 Seedance 1.5）|
| `--seed` | | 用於再現性的隨機種子 |
| `--no-watermark` | | 停用浮水印 |
| `--timeout` | `-t` | 最長等待時間（以秒為單位）（預設值：1200） |
| `--query-task` | `-q` | 透過task_id查詢任務狀態 |

## 模型回退

如果遇到與模型相關的錯誤（如`ModelNotOpen`），您可以降級到以下模型：

- `doubao-seedance-1-5-pro-251215`
- `doubao-seedance-1-0-pro-250528`

## 錯誤處理

- 如果缺少 API 金鑰，請指導使用者透過其環境中安全的憑證機制設定 `ARK_API_KEY` 或 `MODEL_VIDEO_API_KEY` 或 `MODEL_AGENT_API_KEY`。不要要求在聊天中傳送金鑰、將其寫入專案檔案或列印金鑰。僅在使用者完成設定並授權請求後重試。

## 註解

- 保持提示簡潔（建議≤500個字元）
- 對於第一幀/最後一幀，請確保寬高比符合您選擇的比率
- 參考圖片：1-4張圖片，格式：jpeg/png/webp/bmp/tiff/gif
- 參考影片：0-3個視頻，格式：mp4/mov，總長度≤15s
- 參考音頻：0-3個音頻，格式：mp3/wav，總長度≤15s
- 多模式需要至少一張圖像或視訊（不支援僅音訊）
- 僅 Seedance 1.5 pro 支援音訊生成
- 如果輪詢逾時，請使用 `--query-task` 和傳回的 task_id

隨附指令碼需要可用的 Python 解譯器及 `requirements.txt` 中的 `httpx`；缺少 `httpx` 時 `--help` 仍可用。檢查實際環境中的 `startupbot-media-python`、`python3`、`python` 或 Windows 的 `py -3`。缺少依賴時，在獲授權的任務專用 Python 環境中從可信來源安裝固定版本，不修改全域 Python。沒有 Python 時使用已設定的相容服務或說明缺少的條件。ByteDance API 帳戶及產生費用的授權仍是獨立條件。
