**StartupBot 適配。** 本指南和參考資料改編自 SOURCE.md 中列出的 Apache-2.0 上游來源。使用已配置的 AI 賬戶，包括受支援的訂閱連線。本地渲染需要 Node.js、HyperFrames、Chrome 和 FFmpeg。僅在服務要求時才需要 API 憑據。執行 CLI 時設定 `HYPERFRAMES_NO_TELEMETRY=1`。使用本地素材和已安裝字型；除非使用者要求，不要遵循遙測、雲上傳、自動更新或服務註冊說明。將 `npx hyperframes` 示例改為已安裝的 CLI，不要自動下載包。缺少工具或服務時說明依賴。

# HyperFrames

**排除問題並完成。** 首先檢查實際執行環境的作業系統和所需工具，不要假定各台電腦具有相同路徑或軟體。優先使用已安裝的相容工具或可用替代方案。需要 Python 時，檢查 `python3`、`python` 或 Windows 的 `py -3` 啟動器，並使用可執行的選項；不要僅為了別名安裝 Python。缺少渲染器、瀏覽器、媒體工具或語音服務時，使用合適的可用替代方案，或在允許時從獲授權的來源進行任務級設定；如果沒有可行方案，保留專案並說明具體缺少的條件。如果 HyperFrames 檢查失敗，閱讀完整的 JSON 報告並檢查所有項目，包括對比度、製作品質、執行階段和版面；區分錯誤、警告以及嚴格模式導致的失敗。修正具體錯誤，重新檢查，並在使用者要求完整影片時繼續匯出。如果無法轉錄原有語音，保留原始素材；使用者已授權重寫腳本時，建立相符的新旁白和字幕，而不是放棄專案。檢查匯出檔案，並說明無法完成的檢查。

對於沒有分鏡腳本的短行銷影片，規劃清楚的開場吸引點、產品或利益展示，以及結尾行動呼籲。預設製作至少三個視覺上不同的段落，並使用有目的的動作或轉場；若使用者要求單鏡頭或其他創意處理，則遵循其要求。使用使用者提供或獲授權的素材；插畫可能被誤認為真實產品或地點時應明確標註。確保重要文字易讀並位於安全區域。檢查開頭、中間、結尾及轉場處的代表性畫面，匯出前修正文字裁切、重複靜態畫面及拼字錯誤。若要求旁白或字幕，檢查時間同步和匯出的音訊；如無法完成某項品質檢查，應如實說明，不要聲稱聽過或看過。

對於需求明確的短影片，先制定簡短鏡頭計劃，立即建立專案。閱讀 `references/format.md` 和所需效果對應的資料。使用 `hyperframes init <project> --example blank --non-interactive --skip-skills`，替換佔位內容，然後檢查、檢視代表性畫面並渲染所需檔案。使用者要求離線影片時使用已安裝的本地素材和字型。無法渲染或缺少工具時，報告具體錯誤並保留專案。

HyperFrames 透過逐幀定位暫停的時間線把 HTML 渲染成影片，因此每次渲染一致；使用者在 Studio 預覽中編輯同一組檔案。除非要求其他框架或直接錄製瀏覽器，否則使用它。使用已安裝的 `hyperframes` CLI；已配置的 Mac 使用 `"$HOME/.local/share/startupbot/hyperframes/node_modules/.bin/hyperframes"`。

`index.html` 是根合成：宣告影片變數，並掛載 `compositions/` 中每個場景的子合成。素材和字型放在 `assets/`。新專案：`npx hyperframes init <dir> --skip-skills`。以網站為主題：`npx hyperframes capture <url> --json`。

按要求製作：除非需求或來源需要，不新增旁白、字幕或更改比例；超過約 15 秒且講述內容的影片應有音樂及可見動作的音效，除非使用者要求靜音（`references/sound.md`）。新影片預設 1920×1080、30 fps。問題、暫停要求或模糊想法應得到回答或提案，而不是直接編輯。使用可用本地素材和工具製作效果、轉場和字幕。需要外部生成或授權素材時說明條件，並使用獲授權的已配置服務。真實事物使用其來源（產品介面、品牌標誌、真實地點影像）；僅繪製沒有此類來源的內容。

## 規則

`npx hyperframes check --json` 會報告大部分違規項並給出 `Fix:` 行。

1. 每個定時元素都要有 `class="clip"`、以秒計的 `data-start` 和 `data-duration`，在 `[start, start + duration)` 內顯示；在結束前完成最終狀態。`data-track-index` 僅表示 Studio 軌道（不重疊的片段可共用：`references/format.md`）；繪製順序用 `z-index`。
2. 影片長度為根元素的 `data-duration`：超出部分被裁切，提前結束則保持最後一幀。
3. 每個合成建立一個暫停的時間線，並在 tween 後註冊：`window.__timelines["<data-composition-id>"] = tl`。
4. 禁止使用 `Date.now()`、未設種子的 `Math.random()`、網路請求、計時器或 `repeat: -1`。所有可見內容必須由時間線時間決定。
5. 不要對 `.clip` 的 `display`、`visibility` 或 `autoAlpha` 做 tween；應給子元素做動畫。
6. 不要在由 GSAP 變換的元素上設定 CSS `transform`；動畫使用 transform，不使用 `left`/`top`/`width`/`height`。
7. 不要對媒體呼叫 `play()`、`pause()` 或定位。`<video>` 使用 `data-has-audio="true"` 保留聲音，否則設為 `muted`；音樂、旁白、替換音效和 J/L 切點使用單獨的 `<audio>`。
8. 每個 `<audio>` 都需要 `id`，否則不會進入混音。媒體不要設定 `crossorigin`。為 `<video>` 定時，不為其包裝元素定時。
9. 只有內建字型（`references/format.md`）可按名稱解析；其他字型必須透過 `@font-face` 指向 `assets/fonts/` 內檔案。
10. 素材路徑為 `assets/...`（不帶開頭的 `/`），子合成中也一樣。
11. 片段的調色、顆粒、模糊和暗角使用 `npx hyperframes media-treatment`，不要使用 CSS 濾鏡。
12. 場景檔案將樣式、標記和指令碼放入 `<template>`，以 `#root` 設定根元素樣式。有意溢位或重疊時使用 `data-layout-allow-overflow`、`data-layout-allow-overlap`。

## 保持可編輯

Studio 編輯你編寫的標籤。

- 每個場景一個子合成，id 簡短易讀；根元素只包含場景宿主、媒體和音訊。
- 定時元素寫在 HTML 中，不由指令碼建立；每個元素有穩定的 `id`。
- 文案、品牌顏色及可替換媒體使用變數（`data-var-text`、`data-var-src`、`var(--id)`）。
- 每條軌道一種型別：場景和疊加層宿主使用 `data-track-kind="graphics"`；包含所有字幕組的唯一宿主使用 `captions`。
- 內容位於 90% 動作安全區內，字幕及關鍵文字位於 80% 標題安全區內；輔助線由 Studio 繪製，不要自行新增。

## 工作流程

- 已有專案：`npx hyperframes timeline --json` 顯示播放時序；修改前用 `npx hyperframes history --since mine --who <you>` 檢視使用者自上輪以來的更改，並在其基礎上繼續（`/hyperframes-cli`）。
- 超過約 15 秒的新敘事影片：先讀下表對應型別的檔案，再讀 `references/story.md`；僅用文字提出三個不同故事方案，讓使用者選擇，除非使用者要求直接交付或不停止。然後建立 `SPEC.md`（`references/spec.md`）：量化每個形容詞，明確禁止的預設值，並按幀描述鏡頭。
- 最後一次編輯後執行 `npx hyperframes check --json`；修復所有錯誤並評估每個警告。影片使用 `npx hyperframes snapshot --at <seconds>` 檢查代表性畫面及轉場，參考 `references/review.md` 並完成 `REVIEW.md`。有用時執行 `npx hyperframes snapshot --review`；如果卡住，停止自己啟動的行程並改用定點截圖，不得跳過畫面檢查。小改動則為修改部分截圖（`--at`、`--range`、`--composition`），回覆前檢視。
- 使用者批准 Studio 預覽、要求檔案或要求不中斷時，在檢查和審閱透過後渲染；否則停在預覽並等待。

## 需要閱讀的資料

| 需求 | 閱讀 |
| --- | --- |
| 將另一影片的風格用於新主題 | `references/look.md` |
| 釋出、宣傳、功能 | `references/types/launch.md` |
| 講解、教程 | `references/types/explainer.md` |
| 音樂影片 | `references/types/music.md` |
| 圖表、數字 | `references/types/data.md` |
| 豎屏或社交影片 | `references/types/vertical.md` |
| 3D、模擬、生成 | `references/types/3d.md` |
| 角色、吉祥物、敘事短片 | `references/types/character.md` |
| 真實地點或地圖；網站、PR 或指令碼；動態文字 | `references/film.md` |
| 字幕；人物畫面的疊加卡片 | `references/captions.md`；`references/overlays.md` |
| 動效：緩動、標題、剪輯、推進、速度、停留 | `references/motion.md` |
| 場景、屬性、媒體、lint；GSAP、Lottie、3D、canvas | `references/format.md`；`references/runtimes.md` |

使用已安裝的 CLI 版本及其內建幫助。
