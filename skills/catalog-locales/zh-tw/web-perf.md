使用已為當前工作設定的工作區和工具。上游範例僅供參考。安裝軟體、變更權限、花費金錢，或向第三方傳送檔案或訊息前，請先徵得使用者同意。請使用已設定的連接器或受保護環境中的憑證。請勿在輸出、指令記錄或範例檔案中暴露私人資料與金鑰。請略過參考資料中的更新或遙測操作。如缺少工具，請說明缺少哪些工具，並使用已授權的資料繼續完成可執行的工作。


# 網站效能審計

有關網站效能指標、閾值和工具 API 的知識可能已過時。引用具體數字或建議時，**優先檢索資料**。

## 檢索來源

| 來源 | 檢索方式 | 用途 |
|--------|----------------|---------|
| web.dev | `https://web.dev/articles/vitals` | Core Web Vitals 閾值和定義 |
| Chrome DevTools 文件 | `https://developer.chrome.com/docs/devtools/performance` | 工具 API、trace 分析 |
| Lighthouse 評分 | `https://developer.chrome.com/docs/lighthouse/performance/performance-scoring` | 評分權重、指標閾值 |

## 首先：確認 MCP 工具可用

開始前發現可用的瀏覽器和效能工具，使用本次審計所需且實際可用的功能。若沒有 trace 工具，繼續進行有價值的原始碼或網路分析，並說明無法收集哪些測量資料。

## 主要原則

- **結論明確且有證據**：透過網路請求、DOM 或程式碼驗證後，再明確陳述發現。
- **建議前先核實**：確認確實未使用後再建議刪除。
- **量化影響**：使用 insight 的預計節省時間，不優先處理影響為 0ms 的更改。
- **跳過非問題**：渲染阻塞資源預計影響為 0ms 時，只記錄，不建議處理。
- **具體明確**：說“將 hero.png（450KB）壓縮為 WebP”，而不是“最佳化圖片”。
- **嚴格排序**：LCP 為 200ms 且 CLS 為 0 的網站已經非常優秀，應明確說明。

## 快速參考

| 任務 | 工具呼叫 |
|------|-----------|
| 載入頁面 | `navigate_page(url: "...")` |
| 開始 trace | `performance_start_trace(autoStop: true, reload: true)` |
| 分析 insight | `performance_analyze_insight(insightSetId: "...", insightName: "...")` |
| 列出請求 | `list_network_requests(resourceTypes: ["Script", "Stylesheet", ...])` |
| 請求詳情 | `get_network_request(reqid: <id>)` |
| 無障礙快照 | `take_snapshot(verbose: true)` |

## 工作流程

複製以下清單以跟蹤進度：

```
Audit Progress:
- [ ] Phase 1: Performance trace (navigate + record)
- [ ] Phase 2: Core Web Vitals analysis (includes CLS culprits)
- [ ] Phase 3: Network analysis
- [ ] Phase 4: Accessibility snapshot
- [ ] Phase 5: Codebase analysis (skip if third-party site)
```

### 階段 1：效能 trace

1. 導航至目標 URL：
   ```
   navigate_page(url: "<target-url>")
   ```

2. 啟動效能 trace 並重新載入，以捕獲冷載入指標：
   ```
   performance_start_trace(autoStop: true, reload: true)
   ```

3. 等待 trace 完成，然後獲取結果。

**故障排查：**
- 如果 trace 為空或失敗，先用 `navigate_page` 確認頁面正確載入。
- 如果 insight 名稱不匹配，檢查 trace 響應以列出可用 insight。

### 階段 2：Core Web Vitals 分析

使用 `performance_analyze_insight` 提取關鍵指標。

**注意：** insight 名稱可能因 Chrome DevTools 版本而異。如果某個名稱不可用，檢查 trace 響應中的 `insightSetId`，瞭解可用 insight。

常見 insight 名稱：

| 指標 | Insight 名稱 | 檢查內容 |
|--------|--------------|------------------|
| LCP | `LCPBreakdown` | 最大內容繪製時間；分解 TTFB、資源載入和渲染延遲 |
| CLS | `CLSCulprits` | 導致佈局偏移的元素（未指定尺寸的圖片、注入內容、字型切換） |
| 渲染阻塞 | `RenderBlocking` | 阻塞首次繪製的 CSS/JS |
| 文件延遲 | `DocumentLatency` | 伺服器響應時間問題 |
| 網路依賴 | `NetworkRequestsDepGraph` | 延遲關鍵資源的請求鏈 |

示例：
```
performance_analyze_insight(insightSetId: "<id-from-trace>", insightName: "LCPBreakdown")
```

**主要閾值（良好/需改進/較差）：**
- TTFB: < 800ms / < 1.8s / > 1.8s
- FCP: < 1.8s / < 3s / > 3s
- LCP: < 2.5s / < 4s / > 4s
- INP: < 200ms / < 500ms / > 500ms
- TBT: < 200ms / < 600ms / > 600ms
- CLS: < 0.1 / < 0.25 / > 0.25
- Speed Index: < 3.4s / < 5.8s / > 5.8s

### 階段 3：網路分析

列出所有網路請求以尋找最佳化機會：
```
list_network_requests(resourceTypes: ["Script", "Stylesheet", "Document", "Font", "Image"])
```

**檢查：**

1. **渲染阻塞資源**：`<head>` 中沒有 `async`/`defer`/`media` 屬性的 JS/CSS。
2. **網路請求鏈**：因依賴其他資源先載入而較晚發現的資源（如 CSS imports、JS 載入的字型）。
3. **缺失預載入**：關鍵資源（字型、主圖、關鍵指令碼）未預載入。
4. **快取問題**：缺少或弱化的 `Cache-Control`、`ETag` 或 `Last-Modified` 標頭。
5. **負載過大**：未壓縮或過大的 JS/CSS 包。
6. **未使用的 preconnect**：被標記時，檢查是否有任何請求傳送到該 origin。零請求則明確未使用，可建議刪除；如果有請求但載入較晚，preconnect 可能仍有價值。

檢視請求詳情：
```
get_network_request(reqid: <id>)
```

### 階段 4：無障礙快照

獲取無障礙樹快照：
```
take_snapshot(verbose: true)
```

**標記主要問題：**
- ARIA ID 缺失或重複
- 元素對比度不足（對照 WCAG AA：普通文字 4.5:1，大字 3:1）
- 焦點陷阱或缺少焦點指示
- 互動元素缺少無障礙名稱

## 階段 5：程式碼庫分析

**審計第三方網站且無法訪問程式碼庫時跳過。**

分析程式碼，瞭解可以改進的位置。

### 識別框架和打包工具

查詢配置檔案以確定技術棧：

| 工具 | 配置檔案 |
|------|--------------|
| Webpack | `webpack.config.js`, `webpack.*.js` |
| Vite | `vite.config.js`, `vite.config.ts` |
| Rollup | `rollup.config.js`, `rollup.config.mjs` |
| esbuild | `esbuild.config.js`，使用 `esbuild` 的構建指令碼 |
| Parcel | `.parcelrc`, `package.json`（parcel 欄位） |
| Next.js | `next.config.js`, `next.config.mjs` |
| Nuxt | `nuxt.config.js`, `nuxt.config.ts` |
| SvelteKit | `svelte.config.js` |
| Astro | `astro.config.mjs` |

同時檢查 `package.json` 中的框架依賴和構建指令碼。

### Tree-shaking 與無用程式碼

- **Webpack**：檢查 `mode: 'production'`、package.json 中的 `sideEffects`、`usedExports` 最佳化。
- **Vite/Rollup**：預設啟用 tree-shaking；檢查 `treeshake` 選項。
- **查詢**：barrel 檔案（`index.js` 重新匯出）、整體匯入的大型工具庫（lodash、moment）。

### 未使用的 JS/CSS

- 檢查 CSS-in-JS 與靜態 CSS 提取。
- 查詢 PurgeCSS/UnCSS 配置（Tailwind 的 `content` 配置）。
- 區分動態匯入與立即載入。

### Polyfill

- 檢查 `@babel/preset-env` 的目標和 `useBuiltIns` 設定。
- 查詢 `core-js` 匯入（通常過大）。
- 檢查 `browserslist` 配置是否覆蓋過廣。

### 壓縮與精簡

- 檢查 `terser`、`esbuild` 或 `swc` 精簡。
- 檢查構建輸出或伺服器配置中的 gzip/brotli 壓縮。
- 檢查生產環境的 source map（應為外部檔案或關閉）。

## 輸出格式

按以下形式呈現結果：

1. **Core Web Vitals 摘要** — 指標、數值和評級（良好/需改進/較差）的表格。
2. **主要問題** — 按優先順序列出問題和預計影響（高/中/低）。
3. **建議** — 具體可執行的修復措施，附程式碼片段或配置更改。
4. **程式碼庫發現** — 已識別的框架/打包工具和最佳化機會（無法訪問程式碼時省略）。

## 技能反饋
