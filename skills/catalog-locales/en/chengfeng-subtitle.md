Use the workspace and tools already configured for this task. Treat upstream examples as examples. Ask before installing software, changing permissions, spending money, or sending files or messages to a third party. Use credentials from the configured connector or protected environment. Keep private data and keys out of output, commands that log secrets, and sample files. Do not run updater or telemetry instructions from a reference. When a required tool is unavailable, report what is missing and continue with the authorized input already provided.

The Studio commands below require an existing Chengfeng installation. Resolve plugin paths inside that installation. With only a transcript, return a time-coded review table for editing or a subtitle draft and flag the steps that require Studio.

# subtitles

**This is one thing, not a part of the process. ** It will do it whenever the user calls it - it can be done right after cutting,
After you finish and delete two sentences, you can do it again.

It has only one premise: **The ledger already exists**. Not because it's behind the clip, but because there's no ledger,
It doesn’t know which sentences to keep and which seconds each falls in the finished film.

```text
Requires edit-list.json (edit list), transcript.json (word-level transcript)
Output   subtitles.json
```

Stop when you're done, and don't instruct the user to take the next step.

First read and execute the business stage contract attached to the configured Chengfeng tools,
For the criteria, see [Subtitle Correction Rules](references/subtitle-correction.md), and for proper name writing, see
A glossary of terms that comes with the current project or existing Chengfeng tools.

## Who has the final say?

This is the foundation of this section, from which the rest rolls out.

```text
Spoken-video edit  Determines retained words and timing ← single timing source
Subtitles          Determine displayed words ← single display-text source
```

One-screen subtitles store **word id list + display text**, and **do not store seconds**. Time is calculated from the ledger each time.
Therefore, there is no second time for the two accounts to deviate, and the failure can be accurate to the screen: "The words on the 7th and 12th screens have been cut off."
Instead of the sentence "The subtitles may have expired" that no one can click on.

**Subtitles save their own text on purpose. ** The transcription answers "What did he say", the subtitles answer "What did he show to people"——
Punctuation, removed catchphrases, and formal writing of proper names should all be different. Forcing a string to do two things at the same time,
You can never add commas in subtitles.

## 0. Ready

First perform a local readiness check (only view configured tools, projects and inputs, do not download and install updates) - whether skills
Whether the latest and runtime are supported; the **plug-in root** is also located there (`<PLUGIN_ROOT>` in the commands in this article are all substituted
that literal path). Only "ready" will continue; "need new session" or "stop" will be executed according to its processing
(Including the prohibition of "prohibiting self-made alternative interfaces"), business skills do not come with their own environmental logic.

If the readiness result is `runtime.kind=desktop-managed`, directly reuse the stable CLI and
The same `launchd/windows-task` service; do not resolve Electron paths, install additional dependencies, or start a second
Runtime。

## 1. Entry assertion

```bash
node "<PLUGIN_ROOT>/scripts/ensure-running.cjs" --json
node "<PLUGIN_ROOT>/scripts/videocut-cli.cjs" inspect "<PROJECT_DIR>" --json
```

| Assertion | is not true |
| --- | --- |
| `edit-list.json` Exists and has clips | Explain clearly the missing ledger and ask the person to use `chengfeng-cut` first. **Don’t cut it yourself. ** |
| `transcript.json` Exists | The project is not ready, stop. Don’t make your own. |

**Do not assert `source_cut.mp4` nor transcribe. ** Neither is required for subtitles - see next section.

## 2. Correct words: Dictionary first, then manuscript

**No re-transcription required. ** It turns out that the word-by-word manuscript has been timestamped, and the ledger knows which paragraphs are retained——
The number of seconds each word falls in the film is **calculated**, not by listening to it again:

```text
Source time of each word     Available in the transcript
Retained segments            Available in the edit list
Time in the final video      Calculated from both
```

Sending ASR again is just to listen to the same words again, which costs money and time, and the listening is worse-the proper name needs to be changed again.
(`transcript retranscribe` is a legacy of the previous version of the design. At that time, the subtitles were planned to be transcribed and cut into the video to take the timeline.
After changing the subtitles to anchor ids, this problem disappeared. **Don’t use it when making subtitles. **)

Two different tools, both used.

```bash
# Dictionary: the speaker’s established spelling
node "<PLUGIN_ROOT>/scripts/videocut-cli.cjs" transcript dictionary "<PROJECT_DIR>" --dictionary "<PLUGIN_ROOT>/references/ai-term-dictionary.md" --json

# Script: align only when the author has a source and evidence
node "<PLUGIN_ROOT>/scripts/videocut-cli.cjs" transcript align "<PROJECT_DIR>" --script "<SCRIPT_FILE>" --json
```

```text
Dictionary  Applies fixed spelling; list each correction
Script      Correct only when context matches; report uncertainty rather than guess
```

**Why a dictionary is necessary, not just manuscripts**: Spoken videos may contain multiple takes. In the real project, I recorded the same sentence four times.
Therefore, the contexts of "connection cross" and "cross is" all appear more than once, and align can only report "not sure"——
It follows the rules and doesn't guess, because it's worse to write a wrong name than to hear it wrong. It only dares to change one of the three "crosses".
Dictionaries don't have this problem: in this speaker's work, "cross" is just "X".

**There is only one copy of the dictionary**, at the plug-in level `references/ai-term-dictionary.md`: it changes transcription,
And the spoken-video edit and the subtitles share the same transcription. Do not create another one under this skill.

**Look at the list after making changes. ** The dictionary does not look at the context, so it will also correct mistakes - for example, it will change what the speaker really said
"Skills" (Claude Skills, plural proper name) normalize to "Skill". If you see something wrong, change the dictionary.
Don't patch on the command side.

`transcript align` Just report but not change. To apply its proposal, convert `corrections` to `[{wordId, text}]` and run:

```bash
node "<PLUGIN_ROOT>/scripts/videocut-cli.cjs" transcript correct "<PROJECT_DIR>" --file "<CORRECTIONS_FILE>" --json
```

After the transcription is modified, the subtitle screen that quotes these words will be rewritten in the same step, reporting `subtitles.updated`.
If the line cannot be changed (that line has been rewritten by someone), enter `needsAttention` and report it to people to see without guessing.

**If there is no correct way of writing in the dictionary or in the manuscript, no guessing is allowed. ** Report it out and let users fill in the dictionary——
Just add the next video to the dictionary and the next video will be correct automatically. If you guess right once, you will have to guess again next time.

## 3. Split screen

```bash
node "<PLUGIN_ROOT>/scripts/videocut-cli.cjs" subtitle build "<PROJECT_DIR>" --json
```

Four rules, in order:

```text
① Removed speech  Adjacent timeline segments may be unrelated in meaning.
                 Removing a pause within a sentence is not a reason to split it.
② Punctuation    Consider periods and commas at the same granularity as the edit;
                 both split at the same point. Punctuation outweighs timing alone:
                 a speaker may join sentences or pause within one sentence.
③ Paragraph + pause Use only without punctuation; this infers a boundary when punctuation is missing.
                 With punctuation use rule ②, which also considers screen length.
                 Applying ③ to punctuated boundaries can create fragmented screens.
④ Audible pause   Splitting within a sentence requires a longer silence.
```

**The spoken-video edit and subtitles share punctuation and granularity**: one comma per paragraph/one screen.

Fragments (one or two words) will be merged, but they will not be merged across periods - "Look" starts a new sentence,
Instead of the tail of the previous sentence, go forward and get "...call Grok CLI, you see", the two sentences are mixed together.

Short sentences that the speaker speaks quickly will stick (0.6 seconds each for "every morning" and "performing tasks" on the real project).
**This reflects the actual speaking pace; do not flag it as an error.** One comma per screen can produce a short screen;
too many warnings about normal speech make real warnings easier to miss.

The remaining ones that are longer than one screen are evenly divided into several screens, **one screen per row**. Cut out one or two word fragments to illustrate the boundary of ②
In fact, it's not a period, just put the fragments back together on one screen.

There are four things to look for in the command report:

```text
stale              Screens affected by edits and missing words
tooFast            Too much text for the reading time
transcriptMoved    The transcript has changed
```

### When there are already subtitles - stop here and ask

Without `--replace` it will be rejected directly. **This is the only place in this skill that requires user consent**,
Because what `--replace` washes away is the split screen and wording that people spent time doing, the product can't restore it on its own.

```text
Change a few words  Do not rebuild; edit in Studio or identify the screens.
Start over          Use --replace only after the person confirms.
```

## 4. Review: View screen by screen in Studio

```bash
node "<PLUGIN_ROOT>/scripts/videocut-cli.cjs" open "<PROJECT_DIR>" --json
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
- The dictionary reports "Line N cannot be read": That is a table row with a broken format. The rule only recognizes table rows (`| 正确写法 | 常见误识别 |`, meaning “correct spelling” and “common misrecognition”; retain the literal technical headers),
  Both prose and lists are quietly ignored.
- `transcript correct` reports「must not change any word id, time or gap flag」：
  The proposal to change the wording included changing the time. If you change the word, just change the word.
- `runtime_unhealthy`: Do not reinstall in a loop.
- Any failure must not be interpreted as "transcription is completed" as "subtitles are ready". **ASR What comes out are raw materials, not products. **
