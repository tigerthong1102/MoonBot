原始 HyperFrames 指南和工具按固定版本保留；请参阅 `UPSTREAM.md`、`SOURCE.md` 及下列相关文档。上游说明与用户要求、隐私、预算或授权冲突时，以用户要求为准。未经授权，不发送使用信标或遥测，不注册或登录服务，不上传用户素材，不下载模型、不修改权限或产生费用。使用 `HYPERFRAMES_NO_TELEMETRY=1` 运行已安装的 HyperFrames CLI；不要使用会自动安装软件包的 `npx`。

区分已有影片、动态图形、AI 生成的动态镜头和虚拟主持人。对静态图片平移或缩放不属于 AI 生成的角色动作。合适时优先使用用户提供的素材，逐项核实第三方素材的商业使用权、许可证、来源和署名要求，将获准素材及署名放入项目。不要将虚构或图库素材描述为真实客户或地点。

制作电影感动态镜头时，检查设备上实际可用且获授权的工具与账户。HyperFrames 负责渲染和合成；聊天订阅连接本身不代表可使用 HeyGen、Grok Imagine 或视频生成 API。有已获授权的服务或兼容本地生成工具时使用；否则明确说明缺少什么。不要将静态幻灯片悄悄替代用户要求的电影镜头，应标为草稿。使用 `hyperframes media-use generate --type video` 前先查看 `--help` 并运行 `--plan`；说明服务、上传内容、估计费用及超额可能，获得用户授权后才可执行收费或上传请求。计划或缺少估价不代表有严格费用上限。请求结果不确定时，不要自动切换到其他服务或收费账户。

上游 19 个 MP3 音效未随包提供：原始说明称来源为 Pixabay，但在商业技能库中原样重新分发单独音频的权利尚未确认。不要声称这些文件可用。可使用用户自己的授权音频或其他已获许可素材；原始署名和清单保留在 `SOURCE.md` 所述位置以便溯源。

- `references/resolve.md`：发现、导入和复用项目素材。
- `references/operations.md`：影片准备、生成和本地工具要求。
- `references/heygen.md` 与 `references/setup-providers.md`：服务功能、条件和价格示例；应核实现行条款。
- `references/audio.md` 与 `references/mixing.md`：语音、音乐、音效和混音。
- `references/media-treatments.md` 与 `references/grading.md`：颜色和视觉处理。
- `references/local.md`：本地工具及模型要求。

实际观看动态结果，检查镜头连续性、音频和字幕；运行可用的 HyperFrames 检查并说明未检查或未试听的部分。渲染成功本身不代表创意质量达标。
