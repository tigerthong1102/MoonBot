---
name: gemini-api
description: "Use a configured Gemini service for text, multimodal analysis, structured output and media generation"
license: Apache-2.0
---

**StartupBot adaptation, 2026-11-19.** Source and changes are recorded in SOURCE.md.

Use the workspace and tools already configured for this task. Treat upstream examples as examples. Ask before installing software, changing permissions, spending money, or sending files or messages to a third party. Use credentials from the configured connector or protected environment. Keep private data and keys out of output, commands that log secrets, and sample files. Do not run updater or telemetry instructions from a reference. When a required tool is unavailable, report what is missing and continue with the authorized input already provided.


The original guide is preserved in `references/upstream.md` for feature comparison. It may describe tools or setup unavailable here; verify compatibility and authorization before acting. Do not automatically install, create credentials, upload, change settings or spend money.

# Gemini tasks with a configured service

Determine the task and available connection first: the Gemini model selected in StartupBot, a configured Gemini API service, and Google Cloud Agent Platform are distinct access paths. Do not assume that a chat subscription or a free chat model includes API access or video generation. Check the actual connector's available models and capabilities and current pricing before choosing a model or submitting a billable request.

For text, request the intended language, audience and output format, then review the answer against the user's source material. For image, document, audio or video understanding, use only authorized inputs accepted by the selected model; report uncertainty and distinguish observations from conclusions. For structured output, provide a schema when supported and validate the result before using it. For function calling, describe the available tools and validate arguments; follow the user's permissions before tool actions.

For implementation details, read only the relevant pinned upstream reference: `references/text_and_multimodal.md` for text and multimodal inputs; `references/structured_and_tools.md` for schemas and function calling; `references/media_generation.md` for image, video, speech or music; `references/embeddings.md` for embeddings; `references/bounding_box.md` for spatial output; `references/live_api.md` for live sessions; `references/advanced_features.md` for advanced features; `references/safety.md` for safety controls; or `references/model_tuning.md` for tuning. Examples and model IDs describe the upstream snapshot, not guaranteed current availability. Check the current official documentation, selected endpoint, account permissions and prices before running them. Do not run usage attribution or telemetry from references without the person's request.

For a new video, agree on the prompt, aspect ratio, duration and any source media to send. Identify a currently available video-generation model through the configured service, submit through that service, poll an asynchronous operation when required, and retrieve its output using the same service. Save the clip in the chosen workspace, open it and report its duration and any visible or audio problems. If generation is unavailable, explain the missing access; where suitable, offer the local HyperFrames skill for an animated video without claiming it is equivalent to generative footage.

Consult the current official Gemini video-generation documentation for supported models, limits and request formats. Model previews may be retired; do not hard-code an old Veo preview as available. For Google Cloud Agent Platform work, use the configured project, location and credentials, and check access before sending data. Never place secrets in chat, source files, logs or URLs. Do not enable a service, send private media or incur charges without the user's authorization.
