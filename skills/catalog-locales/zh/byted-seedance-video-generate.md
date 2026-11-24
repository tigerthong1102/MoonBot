使用已为当前任务配置的工作区和工具。上游示例仅供参考。安装软件、更改权限、花费资金，或向第三方发送文件或消息之前，请征得用户同意。请使用已配置的连接器或受保护环境中的凭据。请勿在输出、命令日志或示例文件中暴露私人数据和密钥。请跳过参考材料中的更新或遥测操作。缺少工具时，请说明缺少哪些工具，并使用现有授权数据继续完成可执行的工作。

# 视频生成技巧

该技能使用Doubao Seedance 1.0/1.5模型生成视频。

## 触发条件

1. 用户想要根据文本描述生成视频
2. 用户想要基于图像（第一帧/最后一帧）创建视频
3. 用户想要使用参考材料（图像、视频、音频）创建视频
4. 用户要求视频生成功能

## 用途

### 环境变量

在使用此技能之前，请确保设置以下环境变量：

- `ARK_API_KEY` 或 `MODEL_VIDEO_API_KEY` 或 `MODEL_AGENT_API_KEY`：视频生成服务的 API 密钥
- `MODEL_VIDEO_API_BASE`：API 基本 URL（可选，有默认值）
- `MODEL_VIDEO_NAME`：型号名称（可选，有默认值）

### 函数签名

```python
async def video_generate(
    params: list,
    batch_size: int = 10,
    max_wait_seconds: int = 1200,
    model_name: str = None,
) -> Dict:
```

### 参数

#### 参数（列表[字典]）

视频生成请求列表。每个项目都是一个具有以下字段的字典：

**每项所需：**

- `video_name`（str）：输出视频文件的名称/标识符
- `prompt` (str)：描述要生成的视频的文本。支持中文和英文。

**每项可选 - 输入材料：**

- `first_frame` (str): 第一帧图像的 URL
- `last_frame` (str): 最后一帧图像的 URL
- `reference_images` (list[str])：1-4 个参考图像 URL，用于样式/内容指导
- `reference_videos` (list[str])：0-3个参考视频URL（mp4/mov，每个2-15秒，总计≤15秒）
- `reference_audios` (list[str])：0-3个参考音频URL（mp3/wav，每个2-15秒，总共≤15秒）

**每项可选 - 视频输出参数：**

- `ratio` (str)：纵横比。选项：“16:9”（默认）、“9:16”、“4:3”、“3:4”、“1:1”、“2:1”、“21:9”、“自适应”
- `duration`（int）：视频长度（以秒为单位）。范围：2-12 秒，具体取决于型号
- `resolution` (str)：视频分辨率。选项：“480p”、“720p”、“1080p”
- `frames`（int）：总帧数。必须为 [29, 289] 并遵循格式 25 + 4n
- `camera_fixed`（布尔）：锁定相机运动。默认值：假
- `seed` (int)：用于再现性的随机种子。范围：[-1, 2^32-1]
- `watermark` (bool): 是否添加水印。默认值：假
- `generate_audio` (bool): 是否生成音频。仅 Seedance 1.5 支持此功能
- `tools` (list[dict]): 工具配置，例如 `[{"type": "web_search"}]`

### 输入模式

1. **文字转视频**：仅提供提示，无图像/视频
2. **第一帧指导**：为起始图像提供first_frame
3. **第一帧 + 最后一帧指导**：为过渡视频提供两者
4. **参考图像**：提供参考图像以进行样式/内容指导
5. **多模态参考**：结合参考图像、参考视频、参考音频

### 返回值

## 脚本返回信息

video_generate.py 脚本将返回这些信息：

```python
{
    "status": "success" | "partial_success" | "error",
    "success_list": [{"video_name": "video_url"}],
    "error_list": ["video_name"],
    "error_details": [{"video_name": "...", "error": {...}}],
    "pending_list": [{"video_name": "...", "task_id": "cgt-xxx", ...}]
}
```

根据脚本返回信息，返回给用户的最终响应包含视频生成任务的描述和视频 URL。您可以从该URL下载视频，但仍应将视频URL提供给用户观看和下载。

注意：URL是脚本返回信息的success_list中的'url'。
URL 必须以两种方式返回：

## 最终退货信息

### 对于开爪
1. **首先，将生成的视频保存/下载到允许的目录**：
   - 推荐：`~/.openclaw/workspace/`

2. **使用 `message tool` 发送视频**，参数如下：
   ```json
   {
     "action": "send",
     "message": "Optional text description",
     "media": "/root/.openclaw/workspace/generated-video.mp4"
   }
   ```
   - 该工具将自动：读取本地文件，以网址形式上传到频道服务器，并以视频消息形式发送

3. **验证成功**：检查工具是否返回`{"ok": true}`，确认视频发送成功

4. **普通文本**非消息工具：生成后，显示Markdown格式的视频列表，例如：
   ```
   <video src="https://example.com/video1.mp4" width="640" controls>video-1</video>
   ```
   **非常重要**：
   视频网址必须是`https://`开头的**原始在线资源链接**，**不是**您下载的本地视频地址。

### 对于普通
您应该返回三种类型的信息：
1. 文件格式，返回视频文件（如果您有其他方法发送视频文件）和视频的本地路径，例如：
local_path：/root/.openclaw/workspace/skills/video-generate/xxx.mp4
2. 生成后，显示Markdown格式的视频列表，例如：
```
<video src="https://example.com/video1.mp4" width="640" controls>video-1</video>
<video src="https://example.com/video2.mp4" width="640" controls>video-2</video>
```

## 代码实现

请参阅 [scripts/video_generate.py](scripts/video_generate.py) 了解完整的实现。

## 用法示例

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

### 命令行选项

| 选项 | 短 | 描述 |
| -------- | ------- | ------------- |
| `--prompt` | `-p` | 视频的文字描述（必填） |
| `--name` | `-n` | 视频名称标识符（默认：视频） |
| `--model` | `-m` | 型号名称（默认：doubao-seedance-2-5-260628） |
| `--ratio` | `-r` | 宽高比（默认值：16:9） |
| `--duration` | `-d` | 视频时长（以秒为单位）(2-12) |
| `--resolution` | | 视频分辨率：480p、720p、1080p |
| `--first-frame` | `-f` | 第一帧图像 URL |
| `--last-frame` | `-l` | 最后一帧图像 URL |
| `--ref-images` | | 参考图像 URL（以空格分隔，1-4 张图像） |
| `--ref-videos` | | 参考视频 URL（以空格分隔，0-3 个视频） |
| `--ref-audios` | | 参考音频 URL（空格分隔，0-3 个音频） |
| `--generate-audio` | | 生成音频（仅限 Seedance 1.5）|
| `--seed` | | 用于再现性的随机种子 |
| `--no-watermark` | | 禁用水印 |
| `--timeout` | `-t` | 最长等待时间（以秒为单位）（默认值：1200） |
| `--query-task` | `-q` | 通过task_id查询任务状态 |

## 模型回退

如果遇到与模型相关的错误（如`ModelNotOpen`），您可以降级到以下模型：

- `doubao-seedance-1-5-pro-251215`
- `doubao-seedance-1-0-pro-250528`

## 错误处理

- 如果脚本引发错误“PermissionError：在环境变量中未找到 ARK_API_KEY 或 MODEL_VIDEO_API_KEY 或 MODEL_AGENT_API_KEY”，请通知用户需要提供 `ARK_API_KEY` 或 `MODEL_VIDEO_API_KEY` 或 `MODEL_AGENT_API_KEY` 环境变量。将其写入工作区的环境变量文件中。如果文件已存在，请将其附加到末尾。确保环境变量格式正确，使环境变量生效，然后重试刚才失败的视频生成任务。

## 注释

- 保持提示简洁（建议≤500个字符）
- 对于第一帧/最后一帧，确保宽高比符合您选择的比率
- 参考图片：1-4张图片，格式：jpeg/png/webp/bmp/tiff/gif
- 参考视频：0-3个视频，格式：mp4/mov，总时长≤15s
- 参考音频：0-3个音频，格式：mp3/wav，总时长≤15s
- 多模式需要至少一张图像或视频（不支持仅音频）
- 仅 Seedance 1.5 pro 支持音频生成
- 如果轮询超时，请使用 `--query-task` 和返回的 task_id

随附脚本需要可用的 Python 解释器及 `requirements.txt` 中的 `httpx`；缺少 `httpx` 时 `--help` 仍可用。检查实际环境中的 `startupbot-media-python`、`python3`、`python` 或 Windows 的 `py -3`。缺少依赖时，在获授权的任务专用 Python 环境中从可信来源安装固定版本，不修改全局 Python。没有 Python 时使用已配置的兼容服务或说明缺少的条件。ByteDance API 账户及产生费用的授权仍是独立条件。
