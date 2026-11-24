**StartupBot 適配。** 本指南和參考資料改編自 SOURCE.md 中列出的 Apache-2.0 上游來源。使用已配置的 AI 賬戶，包括受支援的訂閱連線。本地渲染需要 Node.js、HyperFrames、Chrome 和 FFmpeg。僅在服務要求時才需要 API 憑據。執行 CLI 時設定 `HYPERFRAMES_NO_TELEMETRY=1`。使用本地素材和已安裝字型；除非使用者要求，不要遵循遙測、雲上傳、自動更新或服務註冊說明。將 `npx hyperframes` 示例改為已安裝的 CLI，不要自動下載包。缺少工具或服務時說明依賴。

# HyperFrames CLI

執行已安裝的 `hyperframes` CLI。已配置的 Mac 使用 `"$HOME/.local/share/startupbot/hyperframes/node_modules/.bin/hyperframes"`。它需要 Node.js 22+ 和 FFmpeg。每個命令都有 `--help`；大多數接受 `--json`。失敗時輸出 `✗ …` 和 `Fix:` 行，並以非零狀態退出。

`--json` 結果可能包含 `_meta.updateNotice`，表示有新版本。每次對話在適當的暫停時用自己的話告知使用者一次；是否更新由使用者決定。

## 按任務選擇命令

| 任務 | 命令 |
| --- | --- |
| 開始 | `init <dir> --skip-skills`（空專案；僅按要求使用 `--example <name>`）、`capture <url>` |
| 讀取專案 | `info`、`compositions`、`timeline --json`、`docs <topic>` |
| 檢查 | 編寫時用 `lint`；以 `check --json` 為檢查關卡（lint、執行時、佈局、對比度） |
| 檢視 | `snapshot`（`--at <t,…>`、`--range START,END`、`--composition <id>`、`--zoom`、`--angle`、`--against <video>`）、`keyframes`、`compare`、`audio` |
| 編輯時間線 | `timeline` 配合 `move`、`trim`、`split`、`set`、`duplicate`、`delete`、`apply`、`undo`、`ids` |
| 複用 | `catalog`、`add` |
| 媒體和聲音 | `media-treatment`、`grade-compare`、`remove-background`、`tts`、`transcribe`、`beats`、`normalize-audio` |
| 展示與交付 | `preview`、`present`、`render`、`share`、`publish`（舊版）、`cloud`、`lambda`、`cloudrun` |
| 桌面應用 | `open`、`catch-up` |
| 維護 | `doctor`、`browser`、`upgrade`、`usage`、`clean`、`feedback` |

`captions` 不是命令：執行 `transcribe`，然後閱讀 ../hyperframes/references/captions.md。

`validate`、`inspect` 和 `layout` 是 `check` 已棄用的別名；`events` 是技能的遙測資料。不要執行這些命令。

## 流程

1. 編寫後，在首輪和結構變更後執行 `npx hyperframes lint`。
2. 執行 `npx hyperframes check --json`，修復所有錯誤。存在 lint 錯誤時不會執行佈局和對比度檢查；“0 samples”表示沒有檢查任何內容。對比度錯誤包含 `suggestedColor`。僅出現在一個取樣點的發現（如入場過程）是提示；3 秒以上的影片沒有可見變化會導致 `sweep_static` 失敗。
3. 執行 `npx hyperframes snapshot` 並檢視 PNG（在 `.hyperframes/artifacts/snapshots/` 中）：這是檢視影片的方法。對於子合成，擷取每個場景的中點；內容很小且無樣式或主體缺失表示掛載有誤（`../hyperframes/references/format.md`）。
4. 執行 `npx hyperframes preview --background`，檢查 URL 返回 200，向使用者提供專案 URL 並等待，除非使用者要求檔案或不要中斷。僅透過檢查不代表可以渲染。
5. 滿足第 4 步的渲染條件時，執行 `npx hyperframes render -o out.mp4`。確認檔案非空且 `ffprobe` 時長與根元素 `data-duration` 一致，然後檢視解碼後的幀。

“這個元素”或當前選區：`npx hyperframes preview --context --json --context-fields selection`；`no-selection` 表示要請使用者點選選中。

## 編輯時間線

這些編輯與 Studio 自身使用的操作一致，因此結果保持 Studio 的結構。

- `timeline --json` 列出片段、絕對時間 `absStart`/`absEnd`、所屬 `file` 以及編輯命令使用的 `#id` 引用（`timeline ids` 補充缺失的 id）。
- `timeline move|trim|split|set|duplicate|delete <ref> … --plan --json` 預覽一次編輯；再次執行並去掉 `--plan` 即應用。`--start`、`--end`、`--duration` 設定邊界或長度。
- 如果片段會與相鄰片段重疊（使用 `--overwrite` 或先移動相鄰片段）或超出合成結尾，編輯會被拒絕；先增加根元素的 `data-duration`。沒有命令會更改 `data-duration`。
- 批次編輯：建立如 `[{"verb": "move", "ref": "#outro", "time": "9"}]` 的 JSON 檔案，然後執行 `timeline apply plan.json --json`。每次執行輸出 `receipt`；儲存後可用 `timeline undo receipt.json` 撤銷。

## 專案歷史

每次寫入都會保留且可撤銷。回合開始時執行 `npx hyperframes history begin --who <you> --label "<plan>"`，然後用 `history --since mine --who <you>` 檢視使用者的更改並在其基礎上工作。檢查失敗或使用者表示效果變差時，使用 `history undo --who <you>`，不要手動改回。回合結束時執行 `history end`。

## 渲染位置

| 需求 | 命令 |
| --- | --- |
| 本地 | `render --quality looks -o out.mp4`（`draft`、`delivery`） |
| 可復現容器 | `render --docker --strict -o out.mp4` |
| 從變數批次渲染 | `render --batch rows.json -o "renders/{name}.mp4"` |
| 託管服務，本地無 Chrome 或 FFmpeg | `cloud render`（`references/cloud.md`） |
| 自有 AWS 或 GCP | `lambda render`、`cloudrun render`（`references/lambda.md`、`references/cloudrun.md`） |

30 秒影片通常渲染一兩分鐘：在前臺執行。僅當渲染時間超過工具超時才分離程序（`HYPERFRAMES_RENDER_DETACHED=1`、獨立程序組、輸出到日誌），並用 `until grep -qE 'Render (complete|failed)' render.log; do sleep 5; done` 等待；不要用 `pgrep -f`，它會匹配自己的迴圈並等待到超時。

## 命令失敗時

| 症狀 | 處理方法 |
| --- | --- |
| Chrome 缺失或無法啟動 | `npx hyperframes browser ensure`；`doctor --json` 總是以 0 退出，應檢查 `.ok` |
| 複雜頁面未及時準備好 | 增大 `check` 或 `snapshot` 的 `--timeout` |
| 特殊編碼畫面空白 | 保持 `--proxy` 開啟（預設） |
| Linux 渲染緩慢 | 摘要第二行顯示 `screenshot` + `software gpu`：慢路徑 |
| `capture` 失敗或寫入 `BLOCKED.md` | 不使用部分檔案；重試時使用新的 `-o` 目錄 |
| 磁碟空間不足 | 先 `clean --dry-run`，再 `clean`；不要刪除儲存歷史的 `.hyperframes` |

## 參考資料

執行命令前先閱讀對應行。

| 命令 | 閱讀 |
| --- | --- |
| `init`、`capture`、`skills` | `references/init-and-scaffold.md` |
| `lint`、`check`、motion sidecars、`snapshot` | `references/lint-validate-inspect.md` |
| `compare`、`grade-compare`、`render --batch` | `references/compare-and-batch.md` |
| `beats` | `references/beats.md` |
| `preview`、`play`、`render`、`share`、`publish`（舊版）、Studio 上下文 | `references/preview-render.md` |
| `doctor`、`browser` | `references/doctor-browser.md` |
| `auth`、`cloud`、模板變數 | `references/cloud.md` |
| `lambda`、`cloudrun` | `references/lambda.md`、`references/cloudrun.md` |
| `info`、`upgrade`、`compositions`、`timeline`、`docs`、`usage`、遙測 | `references/upgrade-info-misc.md` |
| `--strict` 標誌、執行 id、`clean`、shader lint、JSON 路徑 | `references/conventions.md` |
| `keyframes` | `../hyperframes/references/motion.md`（檢視運動） |
