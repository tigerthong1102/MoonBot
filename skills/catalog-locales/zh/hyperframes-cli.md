**StartupBot 适配。** 本指南和参考资料改编自 SOURCE.md 中列出的 Apache-2.0 上游来源。使用已配置的 AI 账户，包括受支持的订阅连接。本地渲染需要 Node.js、HyperFrames、Chrome 和 FFmpeg。仅在服务要求时才需要 API 凭据。运行 CLI 时设置 `HYPERFRAMES_NO_TELEMETRY=1`。使用本地素材和已安装字体；除非用户要求，不要遵循遥测、云上传、自动更新或服务注册说明。将 `npx hyperframes` 示例改为已安装的 CLI，不要自动下载包。缺少工具或服务时说明依赖。

# HyperFrames CLI

运行已安装的 `hyperframes` CLI。已配置的 Mac 使用 `"$HOME/.local/share/startupbot/hyperframes/node_modules/.bin/hyperframes"`。它需要 Node.js 22+ 和 FFmpeg。每个命令都有 `--help`；大多数接受 `--json`。失败时输出 `✗ …` 和 `Fix:` 行，并以非零状态退出。

`--json` 结果可能包含 `_meta.updateNotice`，表示有新版本。每次对话在适当的暂停时用自己的话告知用户一次；是否更新由用户决定。

## 按任务选择命令

| 任务 | 命令 |
| --- | --- |
| 开始 | `init <dir> --skip-skills`（空项目；仅按要求使用 `--example <name>`）、`capture <url>` |
| 读取项目 | `info`、`compositions`、`timeline --json`、`docs <topic>` |
| 检查 | 编写时用 `lint`；以 `check --json` 为检查关卡（lint、运行时、布局、对比度） |
| 查看 | `snapshot`（`--at <t,…>`、`--range START,END`、`--composition <id>`、`--zoom`、`--angle`、`--against <video>`）、`keyframes`、`compare`、`audio` |
| 编辑时间线 | `timeline` 配合 `move`、`trim`、`split`、`set`、`duplicate`、`delete`、`apply`、`undo`、`ids` |
| 复用 | `catalog`、`add` |
| 媒体和声音 | `media-treatment`、`grade-compare`、`remove-background`、`tts`、`transcribe`、`beats`、`normalize-audio` |
| 展示与交付 | `preview`、`present`、`render`、`share`、`publish`（旧版）、`cloud`、`lambda`、`cloudrun` |
| 桌面应用 | `open`、`catch-up` |
| 维护 | `doctor`、`browser`、`upgrade`、`usage`、`clean`、`feedback` |

`captions` 不是命令：运行 `transcribe`，然后阅读 ../hyperframes/references/captions.md。

`validate`、`inspect` 和 `layout` 是 `check` 已弃用的别名；`events` 是技能的遥测数据。不要运行这些命令。

## 流程

1. 编写后，在首轮和结构变更后运行 `npx hyperframes lint`。
2. 运行 `npx hyperframes check --json`，修复所有错误。存在 lint 错误时不会运行布局和对比度检查；“0 samples”表示没有检查任何内容。对比度错误包含 `suggestedColor`。仅出现在一个采样点的发现（如入场过程）是提示；3 秒以上的视频没有可见变化会导致 `sweep_static` 失败。
3. 运行 `npx hyperframes snapshot` 并查看 PNG（在 `.hyperframes/artifacts/snapshots/` 中）：这是查看视频的方法。对于子合成，截取每个场景的中点；内容很小且无样式或主体缺失表示挂载有误（`../hyperframes/references/format.md`）。
4. 运行 `npx hyperframes preview --background`，检查 URL 返回 200，向用户提供项目 URL 并等待，除非用户要求文件或不要中断。仅通过检查不代表可以渲染。
5. 满足第 4 步的渲染条件时，运行 `npx hyperframes render -o out.mp4`。确认文件非空且 `ffprobe` 时长与根元素 `data-duration` 一致，然后查看解码后的帧。

“这个元素”或当前选区：`npx hyperframes preview --context --json --context-fields selection`；`no-selection` 表示要请用户点击选中。

## 编辑时间线

这些编辑与 Studio 自身使用的操作一致，因此结果保持 Studio 的结构。

- `timeline --json` 列出片段、绝对时间 `absStart`/`absEnd`、所属 `file` 以及编辑命令使用的 `#id` 引用（`timeline ids` 补充缺失的 id）。
- `timeline move|trim|split|set|duplicate|delete <ref> … --plan --json` 预览一次编辑；再次运行并去掉 `--plan` 即应用。`--start`、`--end`、`--duration` 设置边界或长度。
- 如果片段会与相邻片段重叠（使用 `--overwrite` 或先移动相邻片段）或超出合成结尾，编辑会被拒绝；先增加根元素的 `data-duration`。没有命令会更改 `data-duration`。
- 批量编辑：创建如 `[{"verb": "move", "ref": "#outro", "time": "9"}]` 的 JSON 文件，然后运行 `timeline apply plan.json --json`。每次运行输出 `receipt`；保存后可用 `timeline undo receipt.json` 撤销。

## 项目历史

每次写入都会保留且可撤销。回合开始时运行 `npx hyperframes history begin --who <you> --label "<plan>"`，然后用 `history --since mine --who <you>` 查看用户的更改并在其基础上工作。检查失败或用户表示效果变差时，使用 `history undo --who <you>`，不要手动改回。回合结束时运行 `history end`。

## 渲染位置

| 需求 | 命令 |
| --- | --- |
| 本地 | `render --quality looks -o out.mp4`（`draft`、`delivery`） |
| 可复现容器 | `render --docker --strict -o out.mp4` |
| 从变量批量渲染 | `render --batch rows.json -o "renders/{name}.mp4"` |
| 托管服务，本地无 Chrome 或 FFmpeg | `cloud render`（`references/cloud.md`） |
| 自有 AWS 或 GCP | `lambda render`、`cloudrun render`（`references/lambda.md`、`references/cloudrun.md`） |

30 秒影片通常渲染一两分钟：在前台运行。仅当渲染时间超过工具超时才分离进程（`HYPERFRAMES_RENDER_DETACHED=1`、独立进程组、输出到日志），并用 `until grep -qE 'Render (complete|failed)' render.log; do sleep 5; done` 等待；不要用 `pgrep -f`，它会匹配自己的循环并等待到超时。

## 命令失败时

| 症状 | 处理方法 |
| --- | --- |
| Chrome 缺失或无法启动 | `npx hyperframes browser ensure`；`doctor --json` 总是以 0 退出，应检查 `.ok` |
| 复杂页面未及时准备好 | 增大 `check` 或 `snapshot` 的 `--timeout` |
| 特殊编码画面空白 | 保持 `--proxy` 开启（默认） |
| Linux 渲染缓慢 | 摘要第二行显示 `screenshot` + `software gpu`：慢路径 |
| `capture` 失败或写入 `BLOCKED.md` | 不使用部分文件；重试时使用新的 `-o` 目录 |
| 磁盘空间不足 | 先 `clean --dry-run`，再 `clean`；不要删除保存历史的 `.hyperframes` |

## 参考资料

运行命令前先阅读对应行。

| 命令 | 阅读 |
| --- | --- |
| `init`、`capture`、`skills` | `references/init-and-scaffold.md` |
| `lint`、`check`、motion sidecars、`snapshot` | `references/lint-validate-inspect.md` |
| `compare`、`grade-compare`、`render --batch` | `references/compare-and-batch.md` |
| `beats` | `references/beats.md` |
| `preview`、`play`、`render`、`share`、`publish`（旧版）、Studio 上下文 | `references/preview-render.md` |
| `doctor`、`browser` | `references/doctor-browser.md` |
| `auth`、`cloud`、模板变量 | `references/cloud.md` |
| `lambda`、`cloudrun` | `references/lambda.md`、`references/cloudrun.md` |
| `info`、`upgrade`、`compositions`、`timeline`、`docs`、`usage`、遥测 | `references/upgrade-info-misc.md` |
| `--strict` 标志、运行 id、`clean`、shader lint、JSON 路径 | `references/conventions.md` |
| `keyframes` | `../hyperframes/references/motion.md`（查看运动） |
