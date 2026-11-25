---
name: byted-text-to-speech
description: "Generate narration with an authorized ByteDance speech connector"
license: Apache-2.0
---

**StartupBot adaptation, 2026-11-19.** Source and changes are recorded in SOURCE.md.

Use the workspace and tools already configured for this task. Treat upstream examples as examples. Ask before installing software, changing permissions, spending money, or sending files or messages to a third party. Use credentials from the configured connector or protected environment. Keep private data and keys out of output, commands that log secrets, and sample files. Do not run updater or telemetry instructions from a reference. When a required tool is unavailable, report what is missing and continue with the authorized input already provided.

# Generate narration with an authorized ByteDance speech connector

Use `scripts/synthesize.mjs` with Node.js 20 or newer, an explicitly configured `MODEL_SPEECH_API_KEY`, and text in a task-owned UTF-8 file: `node scripts/synthesize.mjs --text-file INPUT --output NEW_AUDIO.mp3 --speaker VOICE`. The script sends that text to ByteDance and may incur service charges; only run it when the person authorized this service and its cost. It requires a new output path and does not provision credentials. It supports mp3, pcm and ogg_opus and speech, pitch, loudness and sample-rate options. Verify the resulting audio and report whether you actually listened.

The original guide is preserved in `references/upstream.md` for feature comparison. Its automatic key provisioning and Python commands are not supported by this adaptation; do not run them.

Use an existing ByteDance TTS connection. Confirm the text, voice choice and audio format. Synthesize, save the audio in the task workspace, and check duration and audible quality. Use only voices the user is authorized to use.

If ByteDance is not connected, explain that its service requires separate access and may charge for use; do not claim a chat subscription provides it. If the user accepts a different voice provider and this is a Mac, offer the system speech synthesizer as a local alternative. List available voices with `say -v '?'`, choose an installed voice matching the requested language, and write to a new `.aiff` file with `say -v VOICE -f INPUT_TEXT_FILE -o OUTPUT.aiff`. Use a task-owned text file or standard input so private text is not embedded in shell command history. Check that the output exists, has nonzero duration, and sounds intelligible. Make clear that this is a macOS voice, not a ByteDance voice; quality and voice availability differ by machine. For another platform or an unavailable voice, report the missing requirement rather than claiming synthesis succeeded.
