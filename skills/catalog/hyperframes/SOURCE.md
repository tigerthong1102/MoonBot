# Source and modifications

Upstream directory https://github.com/heygen-com/hyperframes/tree/77ea9d80cfc8b347ccca966487a8ff902ce28320/skills/hyperframes

Upstream license https://github.com/heygen-com/hyperframes/blob/77ea9d80cfc8b347ccca966487a8ff902ce28320/LICENSE

StartupBot modified SKILL.md on 2026-11-19 to supply local execution guidance. The placeholder example in references/types/launch.md was changed to avoid implying an application-specific Settings path. The map, image-location and preset instructions were adapted to describe the restored helpers, their external dependencies and authorization requirements. Except where noted below, other included upstream files retain their original contents.

Included the upstream preset design documents, caption skins, showcase HTML, helper scripts, references and the unmodified code-editorial font files with their SIL Open Font License notices. Modified SKILL.md to use configured local tools and omit the usage beacon. Added HTML document structure, resolution and offline font guidance after testing HyperFrames CLI 0.9.88. Added guidance for finding commercially usable visual assets when online access is authorized. Modified scripts/locate.mjs to send the Gemini API key in its supported authentication header rather than the URL, to read images using Node instead of a platform-specific base64 command, and to draw numeric grid labels without fonts when FFmpeg lacks drawtext. The locate test accepts either supported renderer and still requires FFmpeg.

In scripts/lib/main-module.test.mjs and scripts/lib/windows-exe-search.test.mjs, replaced test-file suffix regular expressions with equivalent string suffix checks for supported skill file paths. The guard and CLI-entry tests check the included HyperFrames and media-use directories, rather than assuming the unrelated upstream figma skill, CLI source tree, and repository-wide layout are present.

## Upstream behavior to configure before use

The restored upstream plugin launcher can download CLI releases through npx. The image-location helper can transmit an image to Google Gemini; the basemap helper fetches map tiles and scripts from external services. Preset HTML may load fonts and animation scripts from remote servers. These files are not an authorization to transmit user material, spend money, download tools or ignore offline requests.
