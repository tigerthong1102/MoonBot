---
name: hyperframes
description: Read first to make, edit, animate or render any video with HyperFrames (HTML rendered to video), including launch films, explainers, music videos, charts, maps, vertical clips, title cards, captions and overlays. Holds the render contract, the work loop and what each kind of video needs.
license: Apache-2.0
---


**StartupBot adaptation.** The instructions and references are adapted from the Apache-2.0 upstream source in SOURCE.md. Use the configured AI account, including a supported subscription connection. Local rendering needs Node.js, HyperFrames, Chrome and FFmpeg. API credentials are only needed for services that require them. Use `HYPERFRAMES_NO_TELEMETRY=1` when running the CLI. Use permitted local or online media and installed fonts; respect offline requests, and do not follow reference instructions for telemetry, cloud upload, automated updates or service signup without the user's request. Resolve `npx hyperframes` examples to the installed CLI, do not download packages automatically. If a tool or service is missing, explain the dependency.



**Offline fonts.** When the user asks for offline work, defining a font by an installed family name alone is not sufficient: HyperFrames may fetch a font alias during `check`, `snapshot`, or render. Use font files that are already available and licensed for this use, copy them into the task project and explicitly declare each family with local `@font-face` URLs; use generic fallback families. Avoid remote stylesheet and media URLs. Where supported, restrict outbound network access for the entire rendering process and verify it; if that cannot be established, say so rather than claiming the work was offline. Do not package system fonts for distribution without permission.

**HTML document structure.** Preserve the scaffolded `<!doctype html>`, `<html>`, `<head>`, and `<body>` tags, including their closing tags, when authoring the root composition. HyperFrames CLI 0.9.88 can fail to initialize its player when the source omits these tags even if a browser repairs the HTML; a visible GSAP timeline is not proof that the HyperFrames player initialized. If `check` or `snapshot` reports that `window.__player` was never set, inspect the document structure, fix it, and retry the real CLI before considering an alternative renderer.

**Report the renderer.** If HyperFrames `check`, `snapshot` or render fails and another renderer produces the file, explicitly say which renderer produced it and which HyperFrames checks failed or were skipped. Never describe the fallback file as a successful HyperFrames render. Do not say audio was heard or captions synchronized unless those were actually checked.

For marketing, read `references/look.md` and choose a visual direction appropriate to the brief before building scenes; use the included preset design documents when useful, or the user’s brand or references when supplied. Plan the visual hierarchy and motion across shots, and inspect the result for repetitive placeholder-like graphics. Prefer suitable authorized photography, footage, illustration or motion assets when available; when they are missing, be candid about the resulting limitation.

**Visual assets for the brief.** First inspect user-provided or already-licensed assets. If a realistic or premium visual needs assets and network access is allowed, search for relevant reusable imagery or footage through available search tools or public source websites before falling back to basic drawn shapes. Check each asset’s actual commercial-use terms, attribution, restrictions and provenance on its source page, keep a credits file, and use only material whose rights are clear. Do not send private project data to external sites without authorization or register accounts, spend money, or use paid APIs without permission. Download approved assets into the project and render locally. When no suitable authorized material or configured generation service is available, explain that limitation; do not pretend a simple illustration is photographic footage or character animation.

For narration, verify the generated speech against the script and subtitle timing. When a suitable local speech recognizer is already available, use it as an additional check and inspect material differences; recognition can be wrong, so do not treat it as a substitute for listening. If words or pronunciation remain uncertain, try another available voice or re-record the affected line, then recheck. Do not download models or use a paid voice service without authorization. If no one has listened, say so and do not claim the pronunciation is verified.

# HyperFrames

**Design for the requested motion.** For character animation or a story, read `references/types/character.md` and `references/story.md` before planning shots. Treat camera moves over a still illustration as a storyboard, not character animation: give characters independent, timed poses and actions using a rig, suitably licensed animated footage, or an available authorized generation service. Keep their appearance consistent, make actions readable and sync speech, mouth movement and sound when requested. If the necessary source or capability is unavailable, say what is missing and identify any still-image version as a draft; do not silently deliver it as the requested animation.

Before building a named effect, title or transition by hand, search the installed CLI's local catalog with `hyperframes catalog --query "<English search words>" --json`. Choose an exact matching item only if it suits the brief; `hyperframes add <exact-name> --dir <project> --no-clipboard --json` downloads editable source and its dependencies into that project. Inspect the item's license, media and external scripts before use; replace remote dependencies with authorized local ones when possible, and never force-overwrite edited files. If offline, unavailable or unsuitable, build the effect locally. Do not send catalog feedback or enable model downloads without the person's request.

Judge the result as a moving video, not only a set of stills: review short excerpts and transitions at normal speed, check action continuity and audio/caption timing, then fix visible defects and rerender. A passing technical check or an MP4 alone does not establish creative quality. State plainly what was actually reviewed and any limitation.

**Recover and finish.** First inspect the operating system and the actual execution environment for the tools needed; never assume this computer has the same paths or software as another. Prefer an installed compatible tool or an available equivalent. If Python is needed, check `python3` and `python`, or the Windows `py -3` launcher, and use whichever works; do not install Python merely to create an alias. If a required renderer, browser, media tool or voice service is missing, use a suitable available alternative or a task-local setup from an authorized source when permitted; preserve the project and explain the precise missing prerequisite when no usable route exists. If a HyperFrames check fails, read the complete JSON report and inspect every section, including contrast, craft, runtime and layout; distinguish errors from warnings and strict-mode failures. Fix the specific errors, rerun the check and continue to rendering when the user asked for a finished video. If existing speech cannot be transcribed, preserve the original media and, when the user authorized a new script, create matching narration and subtitles instead of abandoning the project. Verify the exported file and report any checks that could not be performed.

For a short marketing video without a supplied storyboard, plan a clear hook, product or benefit, and closing action. By default make at least three visually distinct beats with purposeful motion or transitions; honor a request for a single shot or another creative treatment. Use supplied or authorized assets, and label illustrative material when it might be mistaken for the real product or location. Keep key text readable and inside the safe area. Review representative frames at the beginning, middle, end and scene transitions; correct clipped text, repeated static scenes and spelling before export. If narration or captions were requested, check their timing and the exported audio; report any quality checks you could not perform without claiming to have heard or seen them.

For a short, simple video with a clear brief, start with a compact shot plan and create the project immediately. Read `references/format.md` and the references needed for the requested effects. For marketing when network use is allowed, inspect a starter in a scratch project first: run `hyperframes init <scratch-project> --example product-promo --non-interactive --skip-skills` when supported, then use it if it fits; use `blank` for custom work or when no suitable starter is available. Initialize with `hyperframes init <project> --example <example> --non-interactive --skip-skills`. Replace placeholder content and third-party branding, and verify rights and external dependencies before use. Check, review motion and render the requested file. Use installed local assets and fonts when the person requests an offline video. If the result cannot be rendered or a required tool is missing, report the concrete error and preserve the project. The `product-promo` starter may fetch files from GitHub; for offline requests use the locally available `blank` starter and do not attempt remote catalog or example downloads.

HyperFrames renders HTML to video by seeking a paused timeline frame by frame, so every render is identical; the person edits the same files in the Studio preview. Use it unless another framework or a plain browser recording is asked for. Use the installed `hyperframes` CLI. On the provisioned Mac, use `"$HOME/.local/share/startupbot/hyperframes/node_modules/.bin/hyperframes"`.

`index.html` is the root composition: it declares the video's variables and mounts one scene per sub-composition from `compositions/`. Media and fonts live in `assets/`. A new project: `npx hyperframes init <dir> --skip-skills`. A website as the subject: `npx hyperframes capture <url> --json`.

Build what was asked: no voiceover or captions and no new aspect ratio unless the request or the source calls for them; a film over ~15 s that tells something gets music and sound on its visible actions unless the person asked for silence (`references/sound.md`). A new video is 1920×1080 at 30 fps. A question, a hold or a loose idea gets an answer or a proposal, not an edit. Use the available local media and tools to create effects, transitions and captions. When external generation or licensed assets are needed, explain the requirement and use an authorized configured service. Show real things from their source (the product's screens, the brand's logo, a real place's imagery); draw only what has none.

## Contract

`npx hyperframes check --json` reports most violations with a `Fix:` line.

1. Every timed element has `class="clip"`, `data-start` and `data-duration` in seconds, and shows over `[start, start + duration)`: land an end state just before its end. `data-track-index` is only a Studio lane (clips that never overlap share one: `references/format.md`); paint order is `z-index`.
2. The video's length is the root's `data-duration`: overrun is cut, an early end holds the last frame.
3. Each composition builds one paused timeline and registers it after its tweens: `window.__timelines["<data-composition-id>"] = tl`.
4. No `Date.now()`, unseeded `Math.random()`, network fetches, timers or `repeat: -1`. Everything visible is a function of timeline time.
5. Never tween `display`, `visibility` or `autoAlpha` on a `.clip`; animate a child.
6. No CSS `transform` on an element GSAP transforms; animate transforms, not `left`/`top`/`width`/`height`.
7. Never `play()`, `pause()` or seek media. A `<video>` keeps its sound with `data-has-audio="true"`, else it is `muted`; music, voice, replacement sound and J/L cuts are a separate `<audio>`.
8. Every `<audio>` has an `id` or it is left out of the mix. No `crossorigin` on media. Time the `<video>`, never its wrapper.
9. Only the bundled fonts (`references/format.md`) resolve by name; any other family needs `@font-face` to a file in `assets/fonts/`.
10. Asset paths: `assets/...` (no leading `/`), in sub-compositions too.
11. Grades, grain, blur and vignettes on footage go through `npx hyperframes media-treatment`, never CSS filters.
12. A scene file puts its styles, markup and scripts inside `<template>` and styles its root as `#root`. Intended overflow or overlap: `data-layout-allow-overflow`, `data-layout-allow-overlap`.

## Keep it editable

Studio edits the tags you write.

- One scene per sub-composition, short readable ids; the root holds only scene hosts, media and audio.
- Timed elements are written in the HTML, not made by script, each with a stable `id`.
- Copy, brand colours and swappable media are variables (`data-var-text`, `data-var-src`, `var(--id)`).
- One kind per track: `data-track-kind="graphics"` on scene and overlay hosts, `captions` on the one host that holds every caption group.
- Content stays inside the 90% action-safe box, captions and key text inside 80% title-safe; Studio draws the guides, never add them.

## Work loop

- An existing project: `npx hyperframes timeline --json` shows what plays when; before any change, `npx hyperframes history --since mine --who <you>` shows what the person changed since your last turn: build on it (`/hyperframes-cli`).
- A new film over ~15 s that tells something: its type's file (below), then `references/story.md`: three storylines that are three different films, in words only; the person picks unless they asked for the file or no stops. Then `SPEC.md` (`references/spec.md`): every adjective as a number, the defaults banned by name, the shots by frame.
- After your last edit: `npx hyperframes check --json`; fix every error, weigh every warning. A film: inspect representative frames and transitions with `npx hyperframes snapshot --at <seconds>` and `references/review.md`, ending in `REVIEW.md`. Use `npx hyperframes snapshot --review` when useful, but if it stalls, stop the owned process and use targeted snapshots; do not skip visual review. A small edit: snapshot what you changed (`--at`, `--range`, `--composition`) and look before you reply.
- Render when the person approves the Studio preview, asks for the file or asks for no stops, after your check and review pass; otherwise stop at the preview and wait.

## What to read

| The request | Read |
| --- | --- |
| Another film's style on a new topic | `references/look.md` |
| Launch, promo, feature | `references/types/launch.md` |
| Explainer, tutorial | `references/types/explainer.md` |
| Music video | `references/types/music.md` |
| Chart, numbers | `references/types/data.md` |
| Vertical or social clip | `references/types/vertical.md` |
| 3D, simulation, generative | `references/types/3d.md` |
| Character, mascot, story short | `references/types/character.md` |
| A real place or map; a website, PR or script; kinetic type | `references/film.md` |
| Captions; cards over a talking head | `references/captions.md`; `references/overlays.md` |
| Motion: eases, titles, cuts, punch-ins, speed, holds | `references/motion.md` |
| Scenes, attributes, media, lint; GSAP, Lottie, 3D, canvas | `references/format.md`; `references/runtimes.md` |

Use the installed CLI version and its built-in help.
