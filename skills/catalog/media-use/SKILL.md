---
name: media-use
description: Find, prepare, generate or mix visual, video and audio assets for a HyperFrames project using the user's available tools, rights and authorized provider.
license: Apache-2.0
---

The upstream instructions and helpers are included from the pinned HyperFrames source; see `UPSTREAM.md`, `SOURCE.md` and the relevant references below. When upstream instructions conflict with the person's request, privacy, budget or authorization, follow the person's request. In particular, do not send usage beacons or telemetry, register or sign in to a service, upload the person's materials, download models, modify permissions, or incur charges unless authorized. Run the installed HyperFrames CLI with `HYPERFRAMES_NO_TELEMETRY=1`; do not use `npx` in a way that installs packages silently.

For every brief, distinguish existing footage, animated graphics, an AI-generated moving shot and a talking avatar. A pan or zoom across a still image is not generated character motion. Use the person's supplied assets first when suitable and verify commercial rights, licenses, provenance, and attribution for any third-party asset. Put permitted assets and credits in the project. Never represent fictional or stock imagery as a real customer or place.

For cinematic moving footage, inspect the tools and authorized accounts actually available on this device. HyperFrames renders and assembles media; a subscription chat connection does not by itself establish access to HeyGen, Grok Imagine, or a video generation API. Use an already-authorized provider or compatible local generator if present; report the exact missing capability if not. Do not replace a requested cinematic shot with a still slideshow without labeling it as a draft. For `hyperframes media-use generate --type video`, inspect `--help` and use `--plan` first; explain provider, upload, estimated cost and possible overage, and obtain the user's authorization before a paid or externally uploading request. A plan or absence of an estimate is not proof of a hard spending cap. Do not automatically fall back to another provider or billable account after an uncertain request.

The 19 upstream MP3 sound effects are not included: their upstream notice identifies Pixabay, while rights to redistribute the unmodified individual assets inside a commercial skill library have not been established. Do not claim they are bundled or refer to them as available. Use the person's own permitted audio or other independently authorized media instead. The original credit and manifest are preserved for provenance; see `SOURCE.md`.

- `references/resolve.md`: discover, ingest and reuse media within a project.
- `references/operations.md`: footage preparation, generation and local-provider prerequisites.
- `references/heygen.md` and `references/setup-providers.md`: provider-dependent capabilities, requirements and pricing examples; check the current provider terms.
- `references/audio.md` and `references/mixing.md`: speech, music, effects and mixing.
- `references/media-treatments.md` and `references/grading.md`: color, visual treatment and footage refinement.
- `references/local.md`: locally available tools and model prerequisites.

Review the actual moving result, transition continuity, audio and captions; run the available HyperFrames checks and report which checks or listening could not be completed. Technical render success alone does not establish creative quality.
