# Source and modifications

Upstream directory https://github.com/bytedance/agentkit-samples/tree/909a2b4d4365e0d897d98afc86aeef3c20c2f06c/skills/byted-seedream-image-generate

Upstream license https://github.com/bytedance/agentkit-samples/blob/909a2b4d4365e0d897d98afc86aeef3c20c2f06c/skills/byted-seedream-image-generate/LICENSE

StartupBot modified SKILL.md to supply local execution guidance. StartupBot also modified scripts/seedream_image_generate.py to keep authorization headers and request bodies out of diagnostic output, redact the API key from provider errors, explain a missing HTTPX dependency and reject streaming before submission. The StartupBot guide omits the unsupported streaming flags. `requirements.txt` pins an independently distributed HTTPX dependency; it is not bundled. Other included upstream files retain their original contents.

Included upstream notices: upstream-notices/LICENSE, NOTICE.
