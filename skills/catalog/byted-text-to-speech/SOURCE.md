# Source and modifications

Upstream directory https://github.com/bytedance/agentkit-samples/tree/909a2b4d4365e0d897d98afc86aeef3c20c2f06c/skills/byted-text-to-speech

Upstream license https://github.com/bytedance/agentkit-samples/blob/909a2b4d4365e0d897d98afc86aeef3c20c2f06c/skills/byted-text-to-speech/LICENSE

StartupBot modified SKILL.md on 2026-11-19 to supply local execution guidance. Other included upstream files retain their original contents.

Excluded credential provisioning and local dotenv writing scripts.

Added an optional macOS system-voice fallback; it is separate from the ByteDance service.

Included upstream notices: upstream-notices/LICENSE, NOTICE.

## Excluded upstream files

- references/docs-index.md
- references/setup-guide.md
- requirements.txt
- scripts/api_key.py
- scripts/text_to_speech.py

Preserved the unmodified upstream guide in references/upstream.md for comparison; the excluded Python and key-provisioning steps in it are not supported. Added scripts/synthesize.mjs as an independent Node.js implementation of the upstream SSE request and audio options. It uses an explicitly supplied API key, does not create or persist credentials, and does not overwrite output files. The original Python scripts remain excluded; service compatibility has not been verified with a real ByteDance account.
