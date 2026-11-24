使用已为当前任务配置的工作区和工具。上游示例仅供参考。安装软件、更改权限、花费资金，或向第三方发送文件或消息之前，请征得用户同意。请使用已配置的连接器或受保护环境中的凭据。请勿在输出、命令日志或示例文件中暴露私人数据和密钥。请跳过参考材料中的更新或遥测操作。缺少工具时，请说明缺少哪些工具，并使用现有授权数据继续完成可执行的工作。


# 网站性能审计

有关网站性能指标、阈值和工具 API 的知识可能已过时。引用具体数字或建议时，**优先检索资料**。

## 检索来源

| 来源 | 检索方式 | 用途 |
|--------|----------------|---------|
| web.dev | `https://web.dev/articles/vitals` | Core Web Vitals 阈值和定义 |
| Chrome DevTools 文档 | `https://developer.chrome.com/docs/devtools/performance` | 工具 API、trace 分析 |
| Lighthouse 评分 | `https://developer.chrome.com/docs/lighthouse/performance/performance-scoring` | 评分权重、指标阈值 |

## 首先：确认 MCP 工具可用

开始前发现可用的浏览器和性能工具，使用本次审计所需且实际可用的功能。若没有 trace 工具，继续进行有价值的源码或网络分析，并说明无法收集哪些测量数据。

## 主要原则

- **结论明确且有证据**：通过网络请求、DOM 或代码验证后，再明确陈述发现。
- **建议前先核实**：确认确实未使用后再建议删除。
- **量化影响**：使用 insight 的预计节省时间，不优先处理影响为 0ms 的更改。
- **跳过非问题**：渲染阻塞资源预计影响为 0ms 时，只记录，不建议处理。
- **具体明确**：说“将 hero.png（450KB）压缩为 WebP”，而不是“优化图片”。
- **严格排序**：LCP 为 200ms 且 CLS 为 0 的网站已经非常优秀，应明确说明。

## 快速参考

| 任务 | 工具调用 |
|------|-----------|
| 加载页面 | `navigate_page(url: "...")` |
| 开始 trace | `performance_start_trace(autoStop: true, reload: true)` |
| 分析 insight | `performance_analyze_insight(insightSetId: "...", insightName: "...")` |
| 列出请求 | `list_network_requests(resourceTypes: ["Script", "Stylesheet", ...])` |
| 请求详情 | `get_network_request(reqid: <id>)` |
| 无障碍快照 | `take_snapshot(verbose: true)` |

## 工作流程

复制以下清单以跟踪进度：

```
Audit Progress:
- [ ] Phase 1: Performance trace (navigate + record)
- [ ] Phase 2: Core Web Vitals analysis (includes CLS culprits)
- [ ] Phase 3: Network analysis
- [ ] Phase 4: Accessibility snapshot
- [ ] Phase 5: Codebase analysis (skip if third-party site)
```

### 阶段 1：性能 trace

1. 导航至目标 URL：
   ```
   navigate_page(url: "<target-url>")
   ```

2. 启动性能 trace 并重新加载，以捕获冷加载指标：
   ```
   performance_start_trace(autoStop: true, reload: true)
   ```

3. 等待 trace 完成，然后获取结果。

**故障排查：**
- 如果 trace 为空或失败，先用 `navigate_page` 确认页面正确加载。
- 如果 insight 名称不匹配，检查 trace 响应以列出可用 insight。

### 阶段 2：Core Web Vitals 分析

使用 `performance_analyze_insight` 提取关键指标。

**注意：** insight 名称可能因 Chrome DevTools 版本而异。如果某个名称不可用，检查 trace 响应中的 `insightSetId`，了解可用 insight。

常见 insight 名称：

| 指标 | Insight 名称 | 检查内容 |
|--------|--------------|------------------|
| LCP | `LCPBreakdown` | 最大内容绘制时间；分解 TTFB、资源加载和渲染延迟 |
| CLS | `CLSCulprits` | 导致布局偏移的元素（未指定尺寸的图片、注入内容、字体切换） |
| 渲染阻塞 | `RenderBlocking` | 阻塞首次绘制的 CSS/JS |
| 文档延迟 | `DocumentLatency` | 服务器响应时间问题 |
| 网络依赖 | `NetworkRequestsDepGraph` | 延迟关键资源的请求链 |

示例：
```
performance_analyze_insight(insightSetId: "<id-from-trace>", insightName: "LCPBreakdown")
```

**主要阈值（良好/需改进/较差）：**
- TTFB: < 800ms / < 1.8s / > 1.8s
- FCP: < 1.8s / < 3s / > 3s
- LCP: < 2.5s / < 4s / > 4s
- INP: < 200ms / < 500ms / > 500ms
- TBT: < 200ms / < 600ms / > 600ms
- CLS: < 0.1 / < 0.25 / > 0.25
- Speed Index: < 3.4s / < 5.8s / > 5.8s

### 阶段 3：网络分析

列出所有网络请求以寻找优化机会：
```
list_network_requests(resourceTypes: ["Script", "Stylesheet", "Document", "Font", "Image"])
```

**检查：**

1. **渲染阻塞资源**：`<head>` 中没有 `async`/`defer`/`media` 属性的 JS/CSS。
2. **网络请求链**：因依赖其他资源先加载而较晚发现的资源（如 CSS imports、JS 加载的字体）。
3. **缺失预加载**：关键资源（字体、主图、关键脚本）未预加载。
4. **缓存问题**：缺少或弱化的 `Cache-Control`、`ETag` 或 `Last-Modified` 标头。
5. **负载过大**：未压缩或过大的 JS/CSS 包。
6. **未使用的 preconnect**：被标记时，检查是否有任何请求发送到该 origin。零请求则明确未使用，可建议删除；如果有请求但加载较晚，preconnect 可能仍有价值。

查看请求详情：
```
get_network_request(reqid: <id>)
```

### 阶段 4：无障碍快照

获取无障碍树快照：
```
take_snapshot(verbose: true)
```

**标记主要问题：**
- ARIA ID 缺失或重复
- 元素对比度不足（对照 WCAG AA：普通文字 4.5:1，大字 3:1）
- 焦点陷阱或缺少焦点指示
- 交互元素缺少无障碍名称

## 阶段 5：代码库分析

**审计第三方网站且无法访问代码库时跳过。**

分析代码，了解可以改进的位置。

### 识别框架和打包工具

查找配置文件以确定技术栈：

| 工具 | 配置文件 |
|------|--------------|
| Webpack | `webpack.config.js`, `webpack.*.js` |
| Vite | `vite.config.js`, `vite.config.ts` |
| Rollup | `rollup.config.js`, `rollup.config.mjs` |
| esbuild | `esbuild.config.js`，使用 `esbuild` 的构建脚本 |
| Parcel | `.parcelrc`, `package.json`（parcel 字段） |
| Next.js | `next.config.js`, `next.config.mjs` |
| Nuxt | `nuxt.config.js`, `nuxt.config.ts` |
| SvelteKit | `svelte.config.js` |
| Astro | `astro.config.mjs` |

同时检查 `package.json` 中的框架依赖和构建脚本。

### Tree-shaking 与无用代码

- **Webpack**：检查 `mode: 'production'`、package.json 中的 `sideEffects`、`usedExports` 优化。
- **Vite/Rollup**：默认启用 tree-shaking；检查 `treeshake` 选项。
- **查找**：barrel 文件（`index.js` 重新导出）、整体导入的大型工具库（lodash、moment）。

### 未使用的 JS/CSS

- 检查 CSS-in-JS 与静态 CSS 提取。
- 查找 PurgeCSS/UnCSS 配置（Tailwind 的 `content` 配置）。
- 区分动态导入与立即加载。

### Polyfill

- 检查 `@babel/preset-env` 的目标和 `useBuiltIns` 设置。
- 查找 `core-js` 导入（通常过大）。
- 检查 `browserslist` 配置是否覆盖过广。

### 压缩与精简

- 检查 `terser`、`esbuild` 或 `swc` 精简。
- 检查构建输出或服务器配置中的 gzip/brotli 压缩。
- 检查生产环境的 source map（应为外部文件或关闭）。

## 输出格式

按以下形式呈现结果：

1. **Core Web Vitals 摘要** — 指标、数值和评级（良好/需改进/较差）的表格。
2. **主要问题** — 按优先级列出问题和预计影响（高/中/低）。
3. **建议** — 具体可执行的修复措施，附代码片段或配置更改。
4. **代码库发现** — 已识别的框架/打包工具和优化机会（无法访问代码时省略）。

## 技能反馈
