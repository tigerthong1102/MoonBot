# Source and modifications

Upstream directory https://github.com/bytedance/agentkit-samples/tree/909a2b4d4365e0d897d98afc86aeef3c20c2f06c/skills/byted-seedance-video-generate

Upstream license https://github.com/bytedance/agentkit-samples/blob/909a2b4d4365e0d897d98afc86aeef3c20c2f06c/skills/byted-seedance-video-generate/LICENSE.txt

StartupBot modified SKILL.md to supply local execution guidance. StartupBot also modified scripts/video_generate.py to retain task identifiers when a status request fails, avoid leaking the API key in provider errors and explain a missing HTTPX dependency. `requirements.txt` pins an independently distributed HTTPX dependency; it is not bundled. Other included upstream files retain their original contents.

Included upstream notices: upstream-notices/LICENSE, NOTICE.
