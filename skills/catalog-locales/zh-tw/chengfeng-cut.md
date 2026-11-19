使用已為當前工作設定的工作區和工具。上游範例僅供參考。安裝軟體、變更權限、花費金錢，或向第三方傳送檔案或訊息前，請先徵得使用者同意。請使用已設定的連接器或受保護環境中的憑證。請勿在輸出、指令記錄或範例檔案中暴露私人資料與金鑰。請略過參考資料中的更新或遙測操作。如缺少工具，請說明缺少哪些工具，並使用已授權的資料繼續完成可執行的工作。

以下 Studio 指令需要現有的 Chengfeng 安裝。解析該安裝內的插件路徑。僅使用腳本，返回時間編碼的審閱表進行編輯或字幕草稿，並標記需要 Studio 的步驟。

# 剪口播

從一部電影到**一份人工複核過的刪詞帳本（Cuts + EDL）**，不碰媒體檔案。七步一線：

```text
0  就绪     引用「检查更新」的就绪检查（本 Skill 不带环境逻辑）
1  建档     真实视频 → 云端逐词转录 → 产品建项目 → 起服务 → 读回状态
2  修字     词典把字改对（通用一本 + 用户一本）→ 出修字表
3  删词     读偏好与规则 → 五轮扫描，每轮只找一类，只记行
4  汇总     删词汇总表 + 重复句子表 → 按表自读校验
5  审核     全量提交 → 两张表呈给用户 → 打开 Studio 亲自复核
6  复盘交棒  对比提案与终版 → 归档三抽屉 → 报告四件事
```

**不切媒體**：帳本改一次是幾十毫秒，切一次是一個不可撤銷的文件。到本 Skill 結束，
磁碟上沒有任何新影片。 Skill 做語意判斷與編排；產品 Runtime 是專案、Cuts 和
Studio 狀態的唯一寫入者。

**使用者只在三處說話**：同源項目選繼續還是重來（僅剪過時）、Studio 複核、完成確認。
其餘一律單向報告，不停下等回覆。 **每步的完成判據是它的產出**：沒出表，不算完成。

先讀取並執行 已設定的成峰工具中附帶的業務階段合約。
本文步驟與合約階段的對應：1=preflight+Product state readback，5=proposal+Product CAS，
審核=project-level review binding。合約後三個階段（確認、執行、驗收）屬於導出 Skill。

各條規矩的事故來歷在 [事故簿](references/lessons.md)－規矩在正文，故事在那邊。

## 0. 就緒

先執行 本機就緒檢查（僅查看已設定的工具、專案與輸入，不下載安裝更新）－skills 是否
最新、Runtime 是否配套；**插件根**也在那裡定位（本文命令裡的 `<插件根>` 都代入
那個字面路徑）。只有拿到「就緒」才繼續；「需新會話」或「停」都依照它的處置執行
（含「禁止自製替代介面」禁令）。

若就緒結果為 `runtime.kind=desktop-managed`，它與 CLI 安裝共用相同穩定入口和
`launchd/windows-task` 服務，直接繼續；不要找 Electron 安裝目錄、另裝 Bun /
FFmpeg，或啟動第二個 Runtime。

## 1. 建檔：真實輸入 → 轉錄 → 產品建置項目

**幹什麼**：把用戶的本地真實影片和雲端逐詞稿交給產品，原子建檔，起服務，讀回狀態。

```bash
# 云端逐词转录（生成任务目录内的 transcript 候选）之后：
node "<插件根>/scripts/videocut-cli.cjs" project create "<项目目录>" --video "<任务目录内的视频文件>" --transcript "<任务目录内的逐词稿>" --json

node "<插件根>/scripts/ensure-running.cjs" --json          # 产品声明式确保常驻服务（5190）

node "<插件根>/scripts/videocut-cli.cjs" workflow get "<项目目录>" --json    # Product state readback
node "<插件根>/scripts/videocut-cli.cjs" cuts get "<项目目录>" --json
```

規矩：

- 只接受使用者給予的真實口播影片或現有真實項目；沒有真實媒體就停止，禁止用範例、
  佔位視訊頂替
- 轉錄只用目前環境已獲準的**雲端 ASR**；禁止回退本地 ASR；沒有可用雲端 ASR 時報告
  `missing_cloud_transcription_adapter`，不開 Studio、不偽造 transcript
- `--video` / `--transcript` 必須是任務目錄內的真實檔案；畫幅比不要傳－產品會
  從影片實際尺寸自動推導（Runtime 0.4.4+）。只有用戶明確要求特殊畫幅時才加
  `--aspect-ratio W:H`
- 已有規範項目先 `inspect` 確認並重複使用，不重複建立 `projectId`；同一個影片剪過時
  問用戶：繼續上次，還是重來（這是三個說話點之一）。 `project prepare` 是冪等
  編譯器，只在恢復中斷或明確刷新時用，中斷了直接重跑即可
- `project create` 是唯一入口：不經過素材庫、上傳會話或額外 Skill；Skill 不得先寫
  `project.json`
- 服務必須由腳本確認 `healthy=true`、`runtimeMode=launchd`（macOS）或
  `runtimeMode=windows-task`（Windows）、版本相容、URL 為
  canonical 5190 後才繼續；失敗透傳結構化錯誤並停止，禁止回退 foreground、換端口、
  殺未知進程
- 兩份 readback 必須指向同一個 `projectId`，保存 workflow stage 與
  Project / Cuts / EditList 三個 revision；缺失或不一致即停止

## 2. 修字：把字改對，出修字表

**幹什麼**：在一切刪詞判斷**之前**用字典修正轉錄聽錯的字－字不對，後面的判斷必錯；
聽錯的字不是多餘的話，刪詞也修不掉它。

```bash
node "<插件根>/scripts/videocut-cli.cjs" transcript dictionary "<项目目录>" --dictionary "<插件根>/references/ai-term-dictionary.md" --json
```

用你的檔案工具檢查 `$HOME/.chengfeng-videocut/dictionary.md` 是否存在；存在就再過一遍
（過渡做法：CLI 暫只收單文件，分兩次跑；它只能補充、不能撤銷上一遍——完整的
用戶優先合併等多字典 CLI 發布）：

```bash
node "<插件根>/scripts/videocut-cli.cjs" transcript dictionary "<项目目录>" --dictionary "$HOME/.chengfeng-videocut/dictionary.md" --json
```

**產出：修字表**——把兩次調用回傳的 `applied` 清單合併成一張小表（原詞 → 改成 →
上下文），報給用戶。 **改完必須看這份表**－字典不看上下文也會改錯；看到不對就改
字典，不在別處打補丁。

只有字典解決不了、作者手上有稿子時，才追加一次上下文對齊：

```bash
node "<插件根>/scripts/videocut-cli.cjs" transcript align "<项目目录>" --script "<口播稿文件>" --json   # 只报不改
node "<插件根>/scripts/videocut-cli.cjs" transcript correct "<项目目录>" --file "<修正文件>" --json
```

規矩：

- **只改文字，不改時間、詞數、wordId**－產品逐詞比對時間戳，動了直接拒絕
- **只換寫法，不換意思**－真說錯又重說的屬於殘句改口，歸刪詞管
- 字典沒有、稿子也確認不了的，**不許猜**：報告出來留給人補字典。塞一個編的名字
  比留一個聽錯的名字更壞
- 中文口語按原文保留：說「叉」「大模型」就是他說的話
- 字典是**每次轉錄都要過的一道閘**（同一段音頻轉兩遍結果都不一樣，見事故簿）

**文稿依標點分段**：轉錄裡每個字帶標點，文稿一個逗號一段、一句一行；字幕吃同一份
標點，兩邊斷句一致。 2026-07-28 之前的舊項目沒有標點，跑
`node "<插件根>/scripts/videocut-cli.cjs" transcript regroup "<项目目录>" --json` 重切段落即可（逐詞校驗 id/時間/文字
不變，對剪過的項目安全）；真要標點得重轉－標點在舊轉錄裡根本不存在。

## 3. 刪詞：五輪掃描，每輪只找一類

**幹嘛**：讀資料，然後把播放順序完整讀五遍，每遍只帶一個判據。一次帶一個判據去讀，
判斷品質遠高於一次帶六個；每回合產出小、可檢查。

先讀材料：

```bash
node "<插件根>/scripts/videocut-cli.cjs" transcript playback "<项目目录>" --json
```

再用你的讀檔工具讀 `$HOME/.chengfeng-videocut/cut-preferences.md`（使用者偏好，
他說過的算數；文件不存在就是新用戶，跳過）。

判據在 [語意刪除規則](references/semantic-deletion.md)（原則 + 判例）。
教材優先：**使用者偏好 > 使用者判例 > 通用判例**。

```text
第 1 轮  重复          句间重复、句内重复（最客观：两遍相同）
第 2 轮  残句与改口     说一半断掉、换个说法重说
第 3 轮  口误重说       说错的数字、专名、词，后面重说对的
第 4 轮  英文卡壳       词头 / 字母 / 音节重复
第 5 轮  口头禅与语气词  最主观，按用户偏好的密度与容忍度来
```

每輪動作固定：依本輪類型查判例 → 找出一處記一行（wordIds + 類型 + 風險）→
**不定奪別的類型**。後面輪次遇到已標記的字直接跳過，衝突留到總解決。

規矩：

- **判斷只用 `transcript playback` 的播放順序，不准自己從 `transcript.json` 拼**——
  「說了兩遍」靠播出來相鄰，自己拼會把跳號讀成缺內容而誤否（見事故簿）
- 刪除只有「刪除 / 未刪除」兩態；AI 原因不形成「建議刪除」第三態
- 口誤、重複、殘句預設刪前保後；長句、整句、分岔重說必須高風險覆核
- 普通停頓不由 Skill 計算：相鄰靜音合併與 `natural-pause-v2` 由產品確定性執行

## 4. 總結：兩張表，表出來才動手

**幹什麼**：五輪的行合併成兩張表－這是本步的產出物，也是給使用者看的東西。

**刪詞彙總表**（逐條刪詞決定）：

```text
| # | 时间   | 类型   | 删除              | 剩下读作          | 风险 | 依据      |
|---|-------|--------|------------------|------------------|-----|----------|
| 1 | 00:12 | 重复   | 这个功能呢         | 这个功能它其实      | 低  | 判例 R2   |
| 2 | 02:31 | 改口   | 比如我就让他跟踪    | 比如我让grok跟踪    | 高  | 判例 R5   |
```

**重複句子表**（說了多遍的句子，逐詞表看不出“錄了幾遍、保哪遍”，而這正是用戶
最想核對的）：

```text
| 句子（开头）      | 说了几遍 | 保了哪遍        | 删了哪几遍   | 风险            |
|-----------------|--------|---------------|------------|-----------------|
| 因为今天有什么…   | 3      | 第 3 遍 00:08  | 第 1、2 遍  | 低——三遍基本一致  |
| 多数Agent能搜…   | 2      | 第 2 遍 04:40  | 第 1 遍     | 高——两遍说法有出入，重点听 |
```

然後**自讀**：依照表格把刪後的全文依照播放順序通讀一遍，讀不通的行撤銷。
這是複核的定義：AI 自己再看一遍，不是拿去問用戶；拿不準 = 不列（兩態）。

## 5. 審核：到人工審核時才開啟 Studio

**幹什麼**：全量提交候選，把兩張表呈給用戶，然後打開產品審核頁讓用戶親自複核。

```bash
node "<插件根>/scripts/videocut-cli.cjs" cuts get "<项目目录>" --json              # 取 Cuts 自己的 revision
node "<插件根>/scripts/videocut-cli.cjs" cuts set "<项目目录>" --file "<提案文件>" --expected-revision "<Cuts当前revision>" --json
```

候選只引用穩定性 `wordIds`：

```json
{
  "schemaVersion": 1,
  "cutWordIds": ["word-12", "word-13"],
  "reasons": [
    { "wordIds": ["word-12", "word-13"], "kind": "repeat", "risk": "low" }
  ]
}
```

提交規矩：

- 候選是**本輪判斷的完整結論，不是增量**——`cuts set` 是替換語義，交增量會把上一輪
  語意刪詞靜默丟掉（見事故簿）；提交候選時禁止讀取或手動合併
  `initialization.baselineCutWordIds`（產品自動併入停頓基線）
- `reasons` 落盤，如實寫；產品會裁掉提到未刪詞的部分
- 不直接寫入 `cut-selection.json`、`project.json` 或事件日誌
- `cuts get.data.revision` 是 Cuts 的 revision，`workflow get.data.revision` 是專案的，
  **禁止混用**
- 提交成功後必看 `noLongerCut`（本次不再刪的詞數）：不為零且非有意撤回 = 交了增量，
  回去補全量重交；讀到 `"unknown"` 也要看見
- 隨後立即再次 `workflow get` + `cuts get`，確認 `cut_review_ready` 與三個 revision；
  不一致即停，絕不直接寫 JSON 或自動覆蓋
- **提交後把 `<提案文件>` 留在任務目錄**－第 6 步驟複盤要使用（reasons 在使用者編輯後
  會被產品裁掉，事後從帳本反查不可靠）

然後**先呈表、再開頁**：把兩張表發給用戶，請他拿著表格進 Studio 複核。

```bash
node "<插件根>/scripts/ensure-running.cjs" --json                    # 打开前再次幂等 ensure
node "<插件根>/scripts/videocut-cli.cjs" open "<项目目录>" --json          # 取产品返回的项目 URL

node "<插件根>/scripts/ensure-studio.cjs" --url "<产品项目URL>" --view koubo --json                                  # 能力门禁：确认 5190 注册了 koubo 视图
```

規矩：

- 只有門禁返回 `ok=true` 才用 Codex 內建瀏覽器開啟 `studio.url`，然後停止自動推進，
  等用戶劃詞、恢復、保存
- 打開前把 `productUrl` 的 `#project/<projectId>` 與 readback 的 `projectId` 嚴格比對，
  並綁定 `stage=cut_review_ready` 與三個 revision——門禁 `ok=true` 只證明產品面能力，
  不能替代專案級綁定；任何不一致重新 readback
- `studio_capability_missing`：停止並說明版本不相容，可建議 `$chengfeng-report-bug`；
  禁止因 URL 帶 `?view=koubo` 就認為新介面存在，禁止回退舊任務面板
- 不要把「打開工作台」當任務第一步；不訪問舊 `review.html`、8898/8899；
  不控制 Studio DOM、不直接改媒體元素；不建立獨立音訊軌或占位字幕軌

## 6. 複盤交棒：用戶批改的作業不准扔

使用者復核完成後，先讀回：

```bash
node "<插件根>/scripts/videocut-cli.cjs" workflow get "<项目目录>" --json
node "<插件根>/scripts/videocut-cli.cjs" cuts get "<项目目录>" --json
```

**複盤**（過渡做法，產品的 `cuts diff` 指令發布後替換）：拿第 5 步留存的
`<提案文件>` 與讀回的終版 `cutWordIds` 比較——

- **用戶恢復的**（提案裡有、終版沒有）= AI 刪錯了。對照 proposal 自己寫的
  reason 問：錯在哪一類？
- **用戶補刪的**（終版有、提案沒有、也不在 `initialization.baselineCutWordIds`
  停頓基線）= AI 漏了。問：這屬於哪個類型，為什麼沒辨識出來？
  （基線只在這裡用於剔除停頓詞，仍然禁止把它並進提交）

歸檔三個抽屜：

- 口味差異 → `~/.chengfeng-videocut/cut-preferences.md` 追加（Agent 維護的
  markdown，只追加與改寫自己的詩節；檔案不存在就建立）
- 專名錯誤 → `~/.chengfeng-videocut/dictionary.md` 追加（兩個列表格，追加前查重）
- 規則空白 → 偏好檔案「待升級判例」節記一筆；同類第三次出現時向使用者報告，
  建議升級進通用判例（人審後才動 skills 倉庫）
- 零差異也要記：偏好文件項目記錄一行「全盤採納」

**報告四件事**：刪了多少字、少了多少秒；目前 stage（應為 `cut_review_ready`）；
項目 / Cuts / EDL 三個 revision；複盤摘要（提案 N 條，採納 X 恢復 Y 補刪 Z，
主要分歧一句話）。然後告訴用戶下一步跑導出。

**不彈確認卡，不執行剪切**－物理剪切的確認卡屬於導出 Skill，那張卡凍結的必須是
用戶按下確認那一刻的 revision。

`return_cut_review`：先再次 `node "<插件根>/scripts/ensure-running.cjs" --json`，再返回同一 Studio 繼續複核；
不觸發複盤，複盤只在最後交棒做一次。

報告分級：Product 結構化 revision 為 **API/readback PASS**；真實瀏覽器幀審核才是
**visual frame PASS**；沒人實際聽音一律 **human listening UNVERIFIED**，不得用播放、
DOM、截圖或媒體探測替代。

## 恢復與失敗

- `revision_conflict`：重新讀取狀態，說明使用者剛才的編輯，不自動覆蓋
- `runtime_unhealthy`：不循環重裝
- `service_identity_mismatch` / `service_port_conflict`：停止，不回退 foreground、
  不換埠、不殺未知進程
- 頁面關閉但服務仍在：讀取 workflow 後從目前狀態續做，不新建項目
- 任何失敗都不得把「帳本已寫」說成「已經剪好」——到這段為止沒有任何媒體文件產生

附註：本 Skill 接受**本地真實影片**與**雲端逐詞稿**直接進入產品，這是合約 preflight
的要求；兩者都真實存在是一切判斷的前提。
