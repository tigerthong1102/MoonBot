**StartupBot 适配。** 本指南和参考资料改编自 SOURCE.md 中列出的 Apache-2.0 上游来源。使用已配置的 AI 账户，包括受支持的订阅连接。本地渲染需要 Node.js、HyperFrames、Chrome 和 FFmpeg。仅在服务要求时才需要 API 凭据。运行 CLI 时设置 `HYPERFRAMES_NO_TELEMETRY=1`。使用本地素材和已安装字体；除非用户要求，不要遵循遥测、云上传、自动更新或服务注册说明。将 `npx hyperframes` 示例改为已安装的 CLI，不要自动下载包。缺少工具或服务时说明依赖。

# HyperFrames

**排除问题并完成。** 首先检查实际执行环境的操作系统和所需工具，不要假定各台电脑具有相同路径或软件。优先使用已安装的兼容工具或可用替代方案。需要 Python 时，检查 `python3`、`python` 或 Windows 的 `py -3` 启动器，并使用可运行的选项；不要仅为了别名安装 Python。缺少渲染器、浏览器、媒体工具或语音服务时，使用合适的可用替代方案，或在允许时从获授权的来源进行任务级设置；如果没有可行方案，保留项目并说明具体缺失条件。如果 HyperFrames 检查失败，阅读完整的 JSON 报告并检查所有项目，包括对比度、制作质量、运行时和布局；区分错误、警告以及严格模式导致的失败。修复具体错误，重新检查，并在用户要求完整视频时继续导出。如果无法转录原有语音，保留原始素材；用户已授权重写脚本时，创建匹配的新旁白和字幕，而不是放弃项目。检查导出文件，并说明无法完成的检查。

对于没有分镜脚本的短营销视频，规划清晰的开场吸引点、产品或利益展示以及结尾行动号召。默认制作至少三个视觉上不同的段落，并使用有目的的运动或转场；若用户要求单镜头或其他创意处理，则遵循其要求。使用用户提供或获授权的素材；插画可能被误认为真实产品或地点时应明确标注。确保重要文字易读并处于安全区域。检查开头、中间、结尾和转场处的代表性画面，导出前修正文字裁切、重复静态画面及拼写错误。若要求旁白或字幕，检查时间同步和导出的音频；如无法完成某项质量检查，应如实说明，不要声称听过或看过。

对于需求明确的短视频，先制定简短镜头计划，立即创建项目。阅读 `references/format.md` 和所需效果对应的资料。使用 `hyperframes init <project> --example blank --non-interactive --skip-skills`，替换占位内容，然后检查、查看代表性画面并渲染所需文件。用户要求离线视频时使用已安装的本地素材和字体。无法渲染或缺少工具时，报告具体错误并保留项目。

HyperFrames 通过逐帧定位暂停的时间线把 HTML 渲染成视频，因此每次渲染一致；用户在 Studio 预览中编辑同一组文件。除非要求其他框架或直接录制浏览器，否则使用它。使用已安装的 `hyperframes` CLI；已配置的 Mac 使用 `"$HOME/.local/share/startupbot/hyperframes/node_modules/.bin/hyperframes"`。

`index.html` 是根合成：声明视频变量，并挂载 `compositions/` 中每个场景的子合成。素材和字体放在 `assets/`。新项目：`npx hyperframes init <dir> --skip-skills`。以网站为主题：`npx hyperframes capture <url> --json`。

按要求制作：除非需求或来源需要，不添加旁白、字幕或更改比例；超过约 15 秒且讲述内容的影片应有音乐及可见动作的音效，除非用户要求静音（`references/sound.md`）。新视频默认 1920×1080、30 fps。问题、暂停要求或模糊想法应得到回答或提案，而不是直接编辑。使用可用本地素材和工具制作效果、转场和字幕。需要外部生成或授权素材时说明条件，并使用获授权的已配置服务。真实事物使用其来源（产品界面、品牌标志、真实地点影像）；仅绘制没有此类来源的内容。

## 规则

`npx hyperframes check --json` 会报告大部分违规项并给出 `Fix:` 行。

1. 每个定时元素都要有 `class="clip"`、以秒计的 `data-start` 和 `data-duration`，在 `[start, start + duration)` 内显示；在结束前完成最终状态。`data-track-index` 仅表示 Studio 轨道（不重叠的片段可共用：`references/format.md`）；绘制顺序用 `z-index`。
2. 视频长度为根元素的 `data-duration`：超出部分被裁切，提前结束则保持最后一帧。
3. 每个合成创建一个暂停的时间线，并在 tween 后注册：`window.__timelines["<data-composition-id>"] = tl`。
4. 禁止使用 `Date.now()`、未设种子的 `Math.random()`、网络请求、计时器或 `repeat: -1`。所有可见内容必须由时间线时间决定。
5. 不要对 `.clip` 的 `display`、`visibility` 或 `autoAlpha` 做 tween；应给子元素做动画。
6. 不要在由 GSAP 变换的元素上设置 CSS `transform`；动画使用 transform，不使用 `left`/`top`/`width`/`height`。
7. 不要对媒体调用 `play()`、`pause()` 或定位。`<video>` 使用 `data-has-audio="true"` 保留声音，否则设为 `muted`；音乐、旁白、替换音效和 J/L 切点使用单独的 `<audio>`。
8. 每个 `<audio>` 都需要 `id`，否则不会进入混音。媒体不要设置 `crossorigin`。为 `<video>` 定时，不为其包装元素定时。
9. 只有内置字体（`references/format.md`）可按名称解析；其他字体必须通过 `@font-face` 指向 `assets/fonts/` 内文件。
10. 素材路径为 `assets/...`（不带开头的 `/`），子合成中也一样。
11. 片段的调色、颗粒、模糊和暗角使用 `npx hyperframes media-treatment`，不要使用 CSS 滤镜。
12. 场景文件将样式、标记和脚本放入 `<template>`，以 `#root` 设置根元素样式。有意溢出或重叠时使用 `data-layout-allow-overflow`、`data-layout-allow-overlap`。

## 保持可编辑

Studio 编辑你编写的标签。

- 每个场景一个子合成，id 简短易读；根元素只包含场景宿主、媒体和音频。
- 定时元素写在 HTML 中，不由脚本创建；每个元素有稳定的 `id`。
- 文案、品牌颜色及可替换媒体使用变量（`data-var-text`、`data-var-src`、`var(--id)`）。
- 每条轨道一种类型：场景和叠加层宿主使用 `data-track-kind="graphics"`；包含所有字幕组的唯一宿主使用 `captions`。
- 内容位于 90% 动作安全区内，字幕及关键文字位于 80% 标题安全区内；辅助线由 Studio 绘制，不要自行添加。

## 工作流程

- 已有项目：`npx hyperframes timeline --json` 显示播放时序；修改前用 `npx hyperframes history --since mine --who <you>` 查看用户自上轮以来的更改，并在其基础上继续（`/hyperframes-cli`）。
- 超过约 15 秒的新叙事影片：先读下表对应类型的文件，再读 `references/story.md`；仅用文字提出三个不同故事方案，让用户选择，除非用户要求直接交付或不停止。然后创建 `SPEC.md`（`references/spec.md`）：量化每个形容词，明确禁止的默认值，并按帧描述镜头。
- 最后一次编辑后运行 `npx hyperframes check --json`；修复所有错误并评估每个警告。影片使用 `npx hyperframes snapshot --at <seconds>` 检查代表性画面及转场，参考 `references/review.md` 并完成 `REVIEW.md`。有用时运行 `npx hyperframes snapshot --review`；如果卡住，停止自己启动的进程并改用定点截图，不得跳过画面检查。小改动则为修改部分截图（`--at`、`--range`、`--composition`），回复前查看。
- 用户批准 Studio 预览、要求文件或要求不中断时，在检查和审阅通过后渲染；否则停在预览并等待。

## 需要阅读的资料

| 需求 | 阅读 |
| --- | --- |
| 将另一影片的风格用于新主题 | `references/look.md` |
| 发布、宣传、功能 | `references/types/launch.md` |
| 讲解、教程 | `references/types/explainer.md` |
| 音乐视频 | `references/types/music.md` |
| 图表、数字 | `references/types/data.md` |
| 竖屏或社交视频 | `references/types/vertical.md` |
| 3D、模拟、生成 | `references/types/3d.md` |
| 角色、吉祥物、叙事短片 | `references/types/character.md` |
| 真实地点或地图；网站、PR 或脚本；动态文字 | `references/film.md` |
| 字幕；人物画面的叠加卡片 | `references/captions.md`；`references/overlays.md` |
| 动效：缓动、标题、剪辑、推进、速度、停留 | `references/motion.md` |
| 场景、属性、媒体、lint；GSAP、Lottie、3D、canvas | `references/format.md`；`references/runtimes.md` |

使用已安装的 CLI 版本及其内置帮助。
