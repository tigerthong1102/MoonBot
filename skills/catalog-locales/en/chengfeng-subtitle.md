Use the workspace and tools already configured for this task. Treat upstream examples as examples. Ask before installing software, changing permissions, spending money, or sending files or messages to a third party. Use credentials from the configured connector or protected environment. Keep private data and keys out of output, commands that log secrets, and sample files. Do not run updater or telemetry instructions from a reference. When a required tool is unavailable, report what is missing and continue with the authorized input already provided.

The Studio commands below require an existing Chengfeng installation. Resolve plugin paths inside that installation. With only a transcript, return a time-coded review table for editing or a subtitle draft and flag the steps that require Studio.

# subtitles

**This is one thing, not a part of the process. ** It will do it whenever the user calls it - it can be done right after cutting,
After you finish and delete two sentences, you can do it again.

It has only one premise: **The ledger already exists**. Not because it's behind the clip, but because there's no ledger,
It doesn’t know which sentences to keep and which seconds each falls in the finished film.

```text
需要   edit-list.json（账本）、transcript.json（逐词稿）
产出   subtitles.json
```

Stop when you're done, and don't instruct the user to take the next step.

First read and execute the business stage contract attached to the configured peak tool,
For the criteria, see [Subtitle Correction Rules](references/subtitle-correction.md), and for proper name writing, see
A glossary of terms that comes with the current project or existing peaking tool.

## Who has the final say?

This is the foundation of this section, from which the rest rolls out.

```text
剪口播   说了算「留哪些话、在什么时候」    ← 时间的唯一真相
字幕     说了算「屏幕上显示什么字」        ← 显示的唯一真相
```

One-screen subtitles store **word id list + display text**, and **do not store seconds**. Time is calculated from the ledger each time.
Therefore, there is no second time for the two accounts to deviate, and the failure can be accurate to the screen: "The words on the 7th and 12th screens have been cut off."
Instead of the sentence "The subtitles may have expired" that no one can click on.

**Subtitles save their own text on purpose. ** The transcription answers "What did he say", the subtitles answer "What did he show to people"——
Punctuation, removed catchphrases, and formal writing of proper names should all be different. Forcing a string to do two things at the same time,
You can never add commas in subtitles.

## 0. Ready

First perform a local readiness check (only view configured tools, projects and inputs, do not download and install updates) - whether skills
Whether the latest and runtime are supported; the **plug-in root** is also located there (`<插件根>` in the commands in this article are all substituted
that literal path). Only "ready" will continue; "need new session" or "stop" will be executed according to its processing
(Including the prohibition of "prohibiting self-made alternative interfaces"), business skills do not come with their own environmental logic.

If the readiness result is `runtime.kind=desktop-managed`, directly reuse the stable CLI and
The same `launchd/windows-task` service; do not resolve Electron paths, install additional dependencies, or start a second
Runtime。

## 1. Entry assertion

```bash
node "<插件根>/scripts/ensure-running.cjs" --json
node "<插件根>/scripts/videocut-cli.cjs" inspect "<项目目录>" --json
```

| Assertion | is not true |
| --- | --- |
| `edit-list.json` Exists and has clips | Explain clearly the missing ledger and let the user call Jiankoubo first. **Don’t cut it yourself. ** |
| `transcript.json` Exists | The project is not ready, stop. Don’t make your own. |

**Do not assert `source_cut.mp4` nor transcribe. ** Neither is required for subtitles - see next section.

## 2. Correct words: Dictionary first, then manuscript

**No re-transcription required. ** It turns out that the word-by-word manuscript has been timestamped, and the ledger knows which paragraphs are retained——
The number of seconds each word falls in the film is **calculated**, not by listening to it again:

```text
词在源片的第几秒   转录里就有
哪几段留着         账本里就有
词在成片的第几秒   两者一算就出来
```

Sending ASR again is just to listen to the same words again, which costs money and time, and the listening is worse-the proper name needs to be changed again.
(`transcript retranscribe` is a legacy of the previous version of the design. At that time, the subtitles were planned to be transcribed and cut into the video to take the timeline.
After changing the subtitles to anchor ids, this problem disappeared. **Don’t use it when making subtitles. **)

Two different tools, both used.

```bash
# 词典：这个说话人的固定写法，不需要证据
node "<插件根>/scripts/videocut-cli.cjs" transcript dictionary "<项目目录>" --dictionary "<插件根>/references/ai-term-dictionary.md" --json

# 文稿：作者手上有稿子时才做，逐处要证据
node "<插件根>/scripts/videocut-cli.cjs" transcript align "<项目目录>" --script "<口播稿文件>" --json
```

```text
词典    永远这么写            不看上下文，直接改，列出改了哪几处
文稿    上下文对得上才这么写   逐处要证据，对不上的报「不敢定」，不猜
```

**Why a dictionary is necessary, not just manuscripts**: Spoken broadcasts will be re-recorded. In the real project, I recorded the same sentence four times.
Therefore, the contexts of "connection cross" and "cross is" all appear more than once, and align can only report "not sure"——
It follows the rules and doesn't guess, because it's worse to write a wrong name than to hear it wrong. It only dares to change one of the three "crosses".
Dictionaries don't have this problem: in this speaker's work, "cross" is just "X".

**There is only one copy of the dictionary**, at the plug-in level `references/ai-term-dictionary.md`: it changes transcription,
And the cut-out broadcast and the subtitles share the same transcription. Do not create another one under this skill.

**Look at the list after making changes. ** The dictionary does not look at the context, so it will also correct mistakes - for example, it will change what the speaker really said
"Skills" (Claude Skills, plural proper name) normalize to "Skill". If you see something wrong, change the dictionary.
Don't patch on the command side.

`transcript align` Just report but not change. To apply its proposal, convert `corrections` to `[{wordId, text}]` and run:

```bash
node "<插件根>/scripts/videocut-cli.cjs" transcript correct "<项目目录>" --file "<修正文件>" --json
```

After the transcription is modified, the subtitle screen that quotes these words will be rewritten in the same step, reporting `subtitles.updated`.
If the line cannot be changed (that line has been rewritten by someone), enter `needsAttention` and report it to people to see without guessing.

**If there is no correct way of writing in the dictionary or in the manuscript, no guessing is allowed. ** Report it out and let users fill in the dictionary——
Just add the next video to the dictionary and the next video will be correct automatically. If you guess right once, you will have to guess again next time.

## 3. Split screen

```bash
node "<插件根>/scripts/videocut-cli.cjs" subtitle build "<项目目录>" --json
```

Four rules, in order:

```text
① 这里删掉过话    删掉的两边在时间轴上挨着，意思上毫无关系。
                 删掉的是「静音」不算 —— 把句子中间的停顿剪掉，不能把句子劈开。
② 任何标点        火山给的，句号和逗号都算 —— **和剪口播分段是同一个粒度**，
                 两边断在同一处。标点比任何时间证据都强：说话人可以两句连着
                 说不喘气，也可以在一句中间停顿。
③ 段落边界 + 停顿  **只在这个词没有标点时才用**。它是「没标点时靠段落猜句子结束了」，
                 有标点就该由②和逗号那条管 —— 它们会考虑屏够不够长，③ 不会。
                 （在带标点的边界上也触发③，真实项目从 40 屏变 43 屏，切出更多碎屏）
④ 观众听到长停顿   句子内部要断，得有更长的静音才够格。
```

**Bottom broadcasting and subtitles share the same punctuation mark, and the granularity is the same**: one comma per paragraph/one screen.

Fragments (one or two words) will be merged, but they will not be merged across periods - "Look" starts a new sentence,
Instead of the tail of the previous sentence, go forward and get "...call Grok CLI, you see", the two sentences are mixed together.

Short sentences that the speaker speaks quickly will stick (0.6 seconds each for "every morning" and "performing tasks" on the real project).
**That’s what he really said, don’t call the police. ** One comma per screen will inevitably produce this screen,
Calling the police for it is equivalent to calling the police for normal speech - if you call the police too much, no one will read the warning.

The remaining ones that are longer than one screen are evenly divided into several screens, **one screen per row**. Cut out one or two word fragments to illustrate the boundary of ②
In fact, it's not a period, just put the fragments back together on one screen.

There are four things to look for in the command report:

```text
stale              被剪辑改动的屏 —— 精确到第几屏、丢了哪几个字
tooFast            字太多、时间不够读
transcriptMoved    转录已经不是当初那一份了
```

### When there are already subtitles - stop here and ask

Without `--replace` it will be rejected directly. **This is the only place in this skill that requires user consent**,
Because what `--replace` washes away is the split screen and wording that people spent time doing, the product can't restore it on its own.

```text
用户想改几个字     不要 build。让他在 Studio 里直接改，或者告诉你改哪几屏。
用户要推倒重来     确认过了再加 --replace。
```

## 4. Review: View screen by screen in Studio

```bash
node "<插件根>/scripts/videocut-cli.cjs" open "<项目目录>" --json
```

After opening, switch to the **"Subtitles" tab** in the left column. One line per screen: serial number and time on the left, words on the right, click in to change directly.

- **Enter** = start a new screen from the cursor
- **Backspace at the beginning of line** = Merge into the previous screen
- Select one of the four presets in "Parameters → Subtitles" in the right column, and one style for the entire film.
- Subtitles can be seen directly on the screen, and the position and font size are proportional to the screen - **The preview and the finished film are the same set of numbers**

When reviewing, at least let the user confirm: whether the proper name is correct, whether there are swallowed words, whether the sentence fragments are read smoothly, and whether one screen stay is enough to finish reading.

## 5. Until `subtitles.json`

**This section is finished. ** No physical cutting, no storyboarding, no animation, no rendering, and ** no urging users to take the next step **.

The report must be written separately: Product structured readback is **API/readback PASS**; the real same project browser frame
Review is **visual frame PASS**; if no one has actually seen the subtitles and the picture are correct, it will be
**human listening UNVERIFIED**, may not be replaced by DOM, screenshots or file probing.

## Boundary: Burning into the screen is not a matter of this paragraph

The output method is set to **burn into the screen**, and the screen is exported from that section of the painting. The output of the subtitles is `subtitles.json`——
The sizes inside are all percentages of the screen. When exporting, just convert them into pixels according to the output resolution. The numbers are the same on both sides.

**There are no subtitles in the mp4 exported today**, that step has not been done yet. The consequences must be clearly stated in the report.
Don’t just say “subtitles are ready” and that’s it – users will think they are included in the finished film.

## recovery and failure

- `subtitles_exist`: There are already subtitles. **Ask first, don’t directly `--replace`. **
- `revision_conflict`: I am also writing in another place. Re-read without automatic overwriting.
- The dictionary reports "Line N cannot be read": That is a table row with a broken format. The rule only recognizes table rows (`| 正确写法 | 常见误识别 |`),
  Both prose and lists are quietly ignored.
- `transcript correct` 报「must not change any word id, time or gap flag」：
  The proposal to change the wording included changing the time. If you change the word, just change the word.
- `runtime_unhealthy`: Do not reinstall in a loop.
- Any failure must not be interpreted as "transcription is completed" as "subtitles are ready". **ASR What comes out are raw materials, not products. **
