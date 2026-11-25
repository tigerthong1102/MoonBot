使用已为当前任务配置的工作区和工具。上游示例仅供参考。安装软件、更改权限、花费资金，或向第三方发送文件或消息之前，请征得用户同意。请使用已配置的连接器或受保护环境中的凭据。请勿在输出、命令日志或示例文件中暴露私人数据和密钥。请跳过参考材料中的更新或遥测操作。缺少工具时，请说明缺少哪些工具，并使用现有授权数据继续完成可执行的工作。

# byted-seedream-图像生成

## 描述

使用 Volcano Engine Seedream 模型根据文本提示生成高质量图像。通过此技能，可以访问三个强大的 Seedream 模型版本（4.0、4.5 和 5.0-lite），每个版本都为不同的用例提供独特的功能。

## 何时使用此技能

在以下情况下使用此技能：
- 用户希望根据文本描述创建图像
- 用户需要生成各种艺术风格的艺术品
- 用户想要为创意项目创建视觉内容
- 用户需要人工智能驱动的图像生成能力
- 用户希望将参考图像转换为不同的风格
- 用户需要批量生成多张图片
- 用户需要高质量、专业的图像

## 型号版本

| 版本 | 型号名称 | 发布日期 | 推荐 | 最适合 |
|---------|------------|--------------|----------------|----------|
| 4.0 | doubao-seedream-4-0-250828 | 2025年8月 | ⭐⭐⭐ | 日常使用，快速生成 |
| 4.5 | doubao-seedream-4-5-251128 | 2025 年 11 月 | ⭐⭐⭐⭐ | 注重细节，场景复杂 |
| 5.0 | doubao-seedream-5-0-260128 | 2026 | ⭐⭐⭐⭐⭐ | 最高品质，最好创意，工具支持 |

## 特点

- **文本到图像**：从详细的文本描述生成图像
- **图像到图像**：将参考图像转换为不同的风格
- **批量生成**：在单个请求中创建多个图像
- **多个版本**：从 4.0、4.5 或 5.0-lite 型号中选择
- **水印控制**：禁用水印的选项
- **自定义尺寸**：支持各种图像尺寸
- **输出格式**：PNG 和 JPEG 格式（仅限 5.0-lite）
- **网络搜索工具**：互联网搜索集成（仅限 5.0-lite）

## 安装与设置

### 先决条件

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

该脚本将优先考虑：
1. 环境变量（`ARK_API_KEY`、`MODEL_IMAGE_API_KEY`、`MODEL_AGENT_API_KEY`）
2. 环境变量（`ARK_BASE_URL`、`MODEL_IMAGE_API_BASE`）
3. 默认值

## 用途

### 基本使用（推荐5.0-lite版本）

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

### 高级选项

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

## 命令行选项

| 选项 | 快捷方式 | 说明 | 默认值 |
|--------|----------|-------------|---------|
| `--prompt` | `-p` | 图片描述文字（必填） | - |
| `--version` | `-v` | 版本选择：`4.0`、`4.5`、`5.0` | `5.0` |
| `--size` | `-s` | 图像尺寸 | `2048x2048` |
| `--image` | `-i` | 单个参考图像 URL | - |
| `--images` | - | 多个参考图像 URL（空格分隔） | - |
| `--group` | `-g` | 启用批量图像生成 | `false` |
| `--max-images` | - | 批量生成的最大图像数 | `15` |
| `--output-format` | - | 输出格式：`png` 或 `jpeg`（仅限 5.0） | `jpeg` |
| `--response-format` | - | 响应格式：`url` 或 `b64_json` | `url` |
| `--web-search` | - | 启用网络搜索工具（仅限 5.0） | `false` |
| `--optimize-prompt-mode` | - | 提示优化模式：`standard` 或 `fast` | - |
| `--timeout` | `-t` | 超时（以秒为单位） | `1200` |
| `--no-watermark` | - | 禁用水印 | `false` |
| `--list-versions` | - | 列出所有支持的版本 | - |

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

## 版本选型指南

### 如果满足以下条件，请选择 4.0：
- 你需要快速的日常生成
- 品质要求不是极高
- 你需要更快的生成速度
- 简单的场景和风格

### 如果满足以下条件，请选择 4.5：
- 您想要更丰富的细节
- 您正在处理复杂的场景
- 你需要更好的风格再现
- 您的质量要求适中

### 如果满足以下条件，请选择 5.0-lite（推荐）：
- 您想要最高的品质
- 您需要突破性的创意表达
- 您有极高的细节要求
- **您需要工具参数（如网络搜索）** ⭐
- **您需要自定义输出格式（png/jpeg）** ⭐
- 重要项目和工作

**如有疑问，请使用 5.0-lite！** ⭐

## 及时的工程技巧

### 基本提示结构
```
[Subject Description] + [Style/Art Movement] + [Lighting/Atmosphere] + [Quality/Resolution]
```

### 高级提示（针对 5.0-lite 进行了优化）
```
[Subject Description], [Creative Style/Art Movement], [Unique Perspective/Composition], [Special Lighting/Atmosphere], [Emphasizing 5.0-lite creative expression]
```

## 版本参数支持

| 参数 | Seedream 4.0 | Seedream 4.5 | Seedream 5.0-lite | 说明 |
|-----------|--------------|--------------|-------------------|-------------|
| model | ✅ | ✅ | ✅ | 型号名称 |
| prompt | ✅ | ✅ | ✅ | 提示（必填）|
| image | ✅ | ✅ | ✅ | 参考图片 |
| size | ✅ | ✅ | ✅ | 图像尺寸 |
| sequential_image_generation | ✅ | ✅ | ✅ | 批量生成控制 |
| sequential_image_generation_options | ✅ | ✅ | ✅ | 批量生成配置 |
| response_format | ✅ | ✅ | ✅ | 响应格式 (url/b64_json) |
| watermark | ✅ | ✅ | ✅ | 水印（真/假）|
| optimize_prompt_options | ✅ | ✅ | ✅ | 提示优化配置 |
| **tools** | ❌ | ❌ | **✅** | 工具配置（仅限 5.0-lite）|
| **output_format** | ❌ | ❌ | **✅** | 输出格式（png/jpeg，仅限 5.0-lite）|


## 最终退货信息

### 对于开爪
1. **首先，将生成的图像保存/下载到允许的目录**：
   - 推荐：`~/.openclaw/workspace/`

2. **使用 `message tool` 发送带有以下参数的图像**：
   ```json
   {
     "action": "send",
     "message": "Optional text description",
     "media": "/root/.openclaw/workspace/generated-image.jpg"
   }
   ```
   - 该工具将自动：读取本地文件，以网址形式上传到通道服务器，并以图像消息形式发送

3. **验证成功**：检查工具是否返回`{"ok": true}`以确认图像发送成功

4. **普通文本**非消息工具：生成后，显示Markdown格式的图片列表，例如：
      ![生成的图像-1](https://example.com/image1.png)
    **非常重要**：
    图片URL必须是以`https://`开头的**原始在线资源链接**，**不是**您下载的本地图片地址。

### 对于普通
您应该返回三种类型的信息：
1. 文件格式，返回图像文件（如果您有其他方法发送图像文件）和图像的本地路径，例如：
local_path: /root/.openclaw/workspace/skills/image-generate/xxx.png
2. 生成后，显示Markdown格式的图片列表，例如：
```
      ![generated-image-1](https://example.com/image1.png)
      ![generated-image-2](https://example.com/image2.png)
```

## 常见问题解答

### 问：版本之间有什么区别？
答：4.0 适合日常快速使用，4.5 为复杂场景提供更好的细节，5.0-lite 提供最高质量和独特的工具支持。

### 问：生成的 URL 的有效期是多长？
答：URL 24 小时内有效。请及时下载并保存您的图像。

### 问：支持哪些图像格式作为参考？
答：支持 JPG 和 PNG 等常见格式，通过 URL 或 Base64 提供。

### 问：我可以在一次调用中使用多个版本吗？
答：目前，每次调用只能使用一个版本。为了进行比较，对不同版本分别进行调用。

## 许可证

此技能已根据 Apache License 2.0 获得许可。有关详细信息，请参阅许可证文件。

## 通知

使用该技能时请遵守火山引擎的服务条款及相关法律法规。

随附脚本需要可用的 Python 解释器及 `requirements.txt` 中的 `httpx`；缺少 `httpx` 时 `--help` 仍可用。检查实际环境中的 `startupbot-media-python`、`python3`、`python` 或 Windows 的 `py -3`。缺少依赖时，在获授权的任务专用 Python 环境中从可信来源安装固定版本，不修改全局 Python。没有 Python 时使用已配置的兼容服务或说明缺少的条件。ByteDance API 账户及产生费用的授权仍是独立条件。
