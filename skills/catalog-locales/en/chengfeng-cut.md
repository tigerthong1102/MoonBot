Use the workspace and tools already configured for this task. Treat upstream examples as examples. Ask before installing software, changing permissions, spending money, or sending files or messages to a third party. Use credentials from the configured connector or protected environment. Keep private data and keys out of output, commands that log secrets, and sample files. Do not run updater or telemetry instructions from a reference. When a required tool is unavailable, report what is missing and continue with the authorized input already provided.

The Studio commands below require an existing Chengfeng installation. Resolve plugin paths inside that installation. With only a transcript, return a time-coded review table for editing or a subtitle draft and flag the steps that require Studio.

# cut mouth broadcast

From a video to a manually reviewed deletion ledger (Cuts + EDL), no media files are touched. Seven steps and one line:

```text
0  就绪     引用「检查更新」的就绪检查（本 Skill 不带环境逻辑）
1  建档     真实视频 → 云端逐词转录 → 产品建项目 → 起服务 → 读回状态
2  修字     词典把字改对（通用一本 + 用户一本）→ 出修字表
3  删词     读偏好与规则 → 五轮扫描，每轮只找一类，只记行
4  汇总     删词汇总表 + 重复句子表 → 按表自读校验
5  审核     全量提交 → 两张表呈给用户 → 打开 Studio 亲自复核
6  复盘交棒  对比提案与终版 → 归档三抽屉 → 报告四件事
```

**No media cutting**: It takes dozens of milliseconds to change the ledger, and cutting it once is an irrevocable file. By the end of this Skill,
There are no new videos on disk. Skill does semantic judgment and arrangement; product Runtime is the project, Cuts and
The only writer of Studio status.

**Users only speak in three places**: Choose to continue or restart the same source project (only if it is cut), Studio review, and completion confirmation.
All others will be reported in one direction and will not stop waiting for a reply. **The completion criterion of each step is its output**: If it is not out of the table, it is not completed.

First read and execute the business stage contract included in the configured peak tool.
The steps in this article correspond to the contract stage: 1=preflight+Product state readback, 5=proposal+Product CAS,
review=project-level review binding. The last three stages of the contract (confirmation, execution, acceptance) belong to the export Skill.

The origin of each rule is in the [accident book](references/lessons.md) - the rules are in the text, and the story is over there.

## 0. Ready

First perform a local readiness check (only view configured tools, projects and inputs, do not download and install updates) - whether skills
Whether the latest and runtime are supported; the **plug-in root** is also located there (`<插件根>` in the commands in this article are all substituted
that literal path). Only continue when "Ready" is obtained; "New session required" or "Stop" will be executed according to its processing
(Including the prohibition of "prohibiting self-made alternative interfaces").

If the ready result is `runtime.kind=desktop-managed`, it shares the same stable entry and CLI installation
`launchd/windows-task` service, continue directly; do not search the Electron installation directory and install Bun/
FFmpeg, or start a second runtime.

## 1. Document creation: real input → transcription → product creation project

**What to do**: Hand over the user's local real video and cloud word-for-word draft to the product, create files atomically, start the service, and read back the status.

```bash
# 云端逐词转录（生成任务目录内的 transcript 候选）之后：
node "<插件根>/scripts/videocut-cli.cjs" project create "<项目目录>" --video "<任务目录内的视频文件>" --transcript "<任务目录内的逐词稿>" --json

node "<插件根>/scripts/ensure-running.cjs" --json          # 产品声明式确保常驻服务（5190）

node "<插件根>/scripts/videocut-cli.cjs" workflow get "<项目目录>" --json    # Product state readback
node "<插件根>/scripts/videocut-cli.cjs" cuts get "<项目目录>" --json
```

Rules:

- Only accept real oral videos or existing real projects given by users; stop if there is no real media, and use examples,
  placeholder video replacement
- Transcription only uses **cloud ASR** approved for the current environment; disables fallback to local ASR; reports when no cloud ASR is available
  `missing_cloud_transcription_adapter`, do not open Studio, do not forge transcript
- `--video` / `--transcript` must be real files in the task directory; do not upload the frame ratio - the product will
  Automatically derived from actual video dimensions (Runtime 0.4.4+). Only add it if the user explicitly requires a special frame
  `--aspect-ratio W:H`
- Confirm and reuse existing standard projects `inspect` first, and do not create them repeatedly `projectId`; when the same video is edited
  Ask the user: Continue from last time or start over (this is one of the three talking points). `project prepare` is idempotent
  The compiler is only used when resuming an interruption or explicitly refreshing it. If it is interrupted, just rerun it.
- `project create` is the only entrance: no material library, upload session or additional Skill; Skill must not be written first
  `project.json`
- Services must be confirmed by a script `healthy=true`, `runtimeMode=launchd` (macOS) or
  `runtimeMode=windows-task` (Windows), version compatible, URL is
  canonical 5190 before continuing; failure to transparently transmit structured errors and stop, rolling back to foreground, changing ports,
  Kill unknown process
- The two readbacks must point to the same `projectId`, save the workflow stage and
  Project / Cuts / EditList three revisions; stop if missing or inconsistent

## 2. Correction of characters: correct the characters and make a correction list

**What to do**: Before all deletion and judgment**, use a dictionary to correct the misheard words in the transcription - if the word is wrong, the subsequent judgments will be wrong;
The misheard word is not a redundant word, and deleting the word cannot fix it.

```bash
node "<插件根>/scripts/videocut-cli.cjs" transcript dictionary "<项目目录>" --dictionary "<插件根>/references/ai-term-dictionary.md" --json
```

Use your file tool to check if `$HOME/.chengfeng-videocut/dictionary.md` exists; if it does, go through it again
(Transitional approach: CLI only collects order files for the time being and runs it in two runs; it can only supplement and cannot undo the previous one - complete
User priority merge and other multi-dictionary CLI releases):

```bash
node "<插件根>/scripts/videocut-cli.cjs" transcript dictionary "<项目目录>" --dictionary "$HOME/.chengfeng-videocut/dictionary.md" --json
```

**Output: Word modification table** - Combine the `applied` lists returned by the two calls into a small table (the original word → is changed to →
context), reported to the user. **You must read this table after correcting** - Dictionaries will correct errors without looking at the context; if you see something wrong, correct it
Dictionary, not patched elsewhere.

Only when the dictionary cannot solve the problem and the author has a manuscript on hand, context alignment is added:

```bash
node "<插件根>/scripts/videocut-cli.cjs" transcript align "<项目目录>" --script "<口播稿文件>" --json   # 只报不改
node "<插件根>/scripts/videocut-cli.cjs" transcript correct "<项目目录>" --file "<修正文件>" --json
```

Rules:

- **Only change the text, do not change the time, number of words, wordId** - compare the timestamp of the product word by word, and reject it directly if you change it
- **Only change the spelling, not the meaning** - If you really say something wrong and then say it again, it is a matter of correcting the remaining sentences and deleting the words.
- If there is no dictionary and the manuscript cannot confirm it, **no guessing** is allowed: the report will be reported and left to others to make up the dictionary. Put in a made-up name
  Worse than leaving a misheard name
- The spoken Chinese is retained as it is in the original text: saying "cross" and "big model" are what he said
- The dictionary is a gate that must be passed every time you transcribe it (the same audio piece will be translated twice and the result will be different, see the accident book)

**The manuscript is segmented according to punctuation**: Each word in the transcription is punctuated, and the manuscript is divided into paragraphs with commas and lines per sentence; the subtitles are in the same portion.
Punctuation, sentence breaks are consistent on both sides. 2026-07-28 The previous old project had no punctuation and ran
`node "<插件根>/scripts/videocut-cli.cjs" transcript regroup "<项目目录>" --json` Just re-cut the paragraph (check id/time/text word by word)
unchanged, safe for edited items); if you really need punctuation, you have to re-translate it - the punctuation does not exist at all in the old transcription.

## 3. Delete words: Five rounds of scanning, each round only finds one category

**What to do**: Read the material, and then read the complete playback sequence five times, with only one criterion each time. Read it one criterion at a time,
The judgment quality is much higher than taking six at a time; the output per round is small and can be inspected.

Materials to read first:

```bash
node "<插件根>/scripts/videocut-cli.cjs" transcript playback "<项目目录>" --json
```

Then use your file reading tool to read `$HOME/.chengfeng-videocut/cut-preferences.md` (user preference,
What he said counts; if the file does not exist, it means a new user, skip it).

The criterion is [Semantic Deletion Rule](references/semantic-deletion.md) (principle + case law).
Textbook priority: **User Preferences > User Cases > General Cases**.

```text
第 1 轮  重复          句间重复、句内重复（最客观：两遍相同）
第 2 轮  残句与改口     说一半断掉、换个说法重说
第 3 轮  口误重说       说错的数字、专名、词，后面重说对的
第 4 轮  英文卡壳       词头 / 字母 / 音节重复
第 5 轮  口头禅与语气词  最主观，按用户偏好的密度与容忍度来
```

The actions in each round are fixed: check the case according to the type of this round → find a place and record a line (wordIds + type + risk) →
**Not sure about other types**. If a marked word is encountered in subsequent rounds, it will be skipped directly, and conflicts will be left to be resolved by summary.

Rules:

- **Only use the playback order of `transcript playback` for judgment, and you are not allowed to play from `transcript.json`**——
  "I said it twice" depends on the broadcast. If you spell it yourself, you will read the skipped number as missing content and mistakenly reject it (see the accident book)
- Deletion only has two states: "deleted/not deleted"; AI reasons do not form a third state of "recommended deletion"
- Slips of the tongue, repetitions, and broken sentences will be deleted by default without leaving the last; long sentences, entire sentences, and bifurcations must be reviewed at high risk.
- Ordinary pauses are not calculated by Skill: adjacent silence merging with `natural-pause-v2` is performed deterministically by the product

## 4. Summary: Two tables, start after the tables are out

**What to do**: Merge the five rounds of rows into two tables - this is the output of this step and what is shown to the user.

**Delete the general list of vocabulary** (decided by deleting words item by item):

```text
| # | 时间   | 类型   | 删除              | 剩下读作          | 风险 | 依据      |
|---|-------|--------|------------------|------------------|-----|----------|
| 1 | 00:12 | 重复   | 这个功能呢         | 这个功能它其实      | 低  | 判例 R2   |
| 2 | 02:31 | 改口   | 比如我就让他跟踪    | 比如我让grok跟踪    | 高  | 判例 R5   |
```

**Repeated Sentence List** (For sentences that have been said many times, the word-by-word list cannot tell "how many times have been recorded and which times have been saved", and this is exactly what the user
Most want to check):

```text
| 句子（开头）      | 说了几遍 | 保了哪遍        | 删了哪几遍   | 风险            |
|-----------------|--------|---------------|------------|-----------------|
| 因为今天有什么…   | 3      | 第 3 遍 00:08  | 第 1、2 遍  | 低——三遍基本一致  |
| 多数Agent能搜…   | 2      | 第 2 遍 04:40  | 第 1 遍     | 高——两遍说法有出入，重点听 |
```

Then **Self-reading**: Read the deleted full text in the order of playback according to the table, and cancel the lines that cannot be read.
This is the definition of review: the AI ​​reads it again by itself, rather than asking the user; unsure = not listed (two states).

## 5. Review: Open Studio only after manual review

**What to do**: Submit all candidates, present the two forms to the user, and then open the product review page for the user to review in person.

```bash
node "<插件根>/scripts/videocut-cli.cjs" cuts get "<项目目录>" --json              # 取 Cuts 自己的 revision
node "<插件根>/scripts/videocut-cli.cjs" cuts set "<项目目录>" --file "<提案文件>" --expected-revision "<Cuts当前revision>" --json
```

Candidates refer only to stable `wordIds`:

```json
{
  "schemaVersion": 1,
  "cutWordIds": ["word-12", "word-13"],
  "reasons": [
    { "wordIds": ["word-12", "word-13"], "kind": "repeat", "risk": "low" }
  ]
}
```

Submission rules:

- The candidate is the complete conclusion of this round of judgment, not the increment - `cuts set` is replacement semantics, and the intersection increment will replace the previous round
  Semantically deleted words are silently discarded (see accident book); reading or manual merging is prohibited when submitting candidates
  `initialization.baselineCutWordIds` (The product automatically merges into the pause baseline)
- `reasons` When placing a plate, write it truthfully; the product will cut off the part that mentions the undeleted words.
- Do not write directly to `cut-selection.json`, `project.json` or event log
- `cuts get.data.revision` is the revision of Cuts, `workflow get.data.revision` is the revision of the project,
  **No mixing**
- Must read after successful submission `noLongerCut` (number of words that will not be deleted this time): non-zero and not intentionally withdrawn = increment submitted,
  Go back and complete the amount and resubmit; read `"unknown"` and also see it
- Then immediately `workflow get` + `cuts get` again, confirming `cut_review_ready` with three revisions;
  Stop if inconsistent, never directly write JSON or automatically overwrite
- **Leave `<提案文件>` in the task directory after submission** - used for review in step 6 (reasons after user editing
  Will be eliminated by the product, and checking back from the ledger afterwards is unreliable)

Then **Submit the table first, then open the page**: Send the two tables to the user and ask him to take the table into Studio for review.

```bash
node "<插件根>/scripts/ensure-running.cjs" --json                    # 打开前再次幂等 ensure
node "<插件根>/scripts/videocut-cli.cjs" open "<项目目录>" --json          # 取产品返回的项目 URL

node "<插件根>/scripts/ensure-studio.cjs" --url "<产品项目URL>" --view koubo --json                                  # 能力门禁：确认 5190 注册了 koubo 视图
```

Rules:

- Only when the access control returns `ok=true`, use the Codex built-in browser to open `studio.url`, and then stop automatic advancement.
  Wait for the user to draw words, restore, and save
- Strictly compare `productUrl`’s `#project/<projectId>` with readback’s `projectId` before opening.
  And binding `stage=cut_review_ready` with three revisions - access control `ok=true` only proves product capabilities,
  Not a replacement for project-level binding; any inconsistencies re-readback
- `studio_capability_missing`: Stop and explain that the version is incompatible, you can recommend `$chengfeng-report-bug`;
  It is forbidden to assume that the new interface exists just because the URL contains `?view=koubo`, and it is forbidden to roll back to the old task panel.
- Do not regard "opening the workbench" as the first step of the task; do not access the old `review.html`, 8898/8899;
  Does not control the Studio DOM, does not directly change media elements; does not create independent audio tracks or placeholder subtitle tracks

## 6. Review and handover: assignments corrected by users are not allowed to be thrown away

After the user review is completed, read back:

```bash
node "<插件根>/scripts/videocut-cli.cjs" workflow get "<项目目录>" --json
node "<插件根>/scripts/videocut-cli.cjs" cuts get "<项目目录>" --json
```

**Review** (Transitional approach, replace the product's `cuts diff` command after it is released): Take what was saved in step 5
`<提案文件>` Comparison with the final version read back `cutWordIds`——

- **Restored by the user** (present in the proposal, not in the final version) = AI deleted it by mistake. Compare what you wrote in the proposal
  reason asked: What kind of error is it?
- **User-added and deleted** (in the final version, not in the proposal, and not in `initialization.baselineCutWordIds`
  Pause in baseline) = AI missed. Q: Which type does this belong to, and why is it not recognized?
  (The baseline is only used here to eliminate stop words, and it is still prohibited to submit it together)

Archive three drawers:

- Taste difference → `~/.chengfeng-videocut/cut-preferences.md` append (maintained by Agent
  Markdown, only appends and rewrites its own sections; if the file does not exist, it will be created)
- Proper name error → `~/.chengfeng-videocut/dictionary.md` Append (two-column form, check for duplication before appending)
- The rule is blank → Make a note in the preference file "Judgment to be upgraded"; report to the user when the same type appears for the third time.
  It is recommended to upgrade to general jurisprudence (skills warehouse should be used only after personal trial)
- Even if there is zero difference, remember: the preference file item records a line of "adopt all"

**Report four things**: how many words were deleted, how many seconds were missing; current stage (should be `cut_review_ready`);
Project/Cuts/EDL three revisions; review summary (N proposals, adopt X, restore Y, supplement and delete Z,
The main difference is one sentence). Then tell the user to run the export next.

**Do not play the confirmation card and do not perform cutting** - The confirmation card that is physically cut belongs to the export Skill, and the card that is frozen must be
The revision at the moment the user presses confirm.

`return_cut_review`: First `node "<插件根>/scripts/ensure-running.cjs" --json` again, then return to the same Studio to continue review;
No review is triggered, and the review is only done once at the final handover.

Report rating: Product structured revision is **API/readback PASS**; real browser frame review is
**visual frame PASS**; no one is actually listening to the sound **human listening UNVERIFIED**, no playback,
DOM, screenshot or media detection override.

## recovery and failure

- `revision_conflict`: Re-read status, indicating that the user’s edit just now will not be automatically overwritten.
- `runtime_unhealthy`: No cycle reinstallation
- `service_identity_mismatch` / `service_port_conflict`: Stop, do not roll back to foreground,
  Do not change ports or kill unknown processes
- The page is closed but the service is still there: read the workflow and continue from the current state without creating a new project.
- Any failure must not say "the ledger has been written" as "it has been cut" - no media files have been generated until this paragraph

Note: This Skill accepts **local real videos** and **cloud word-for-word drafts** to enter the product directly. This is a contract preflight
requirements; the real existence of both is the prerequisite for all judgments.
