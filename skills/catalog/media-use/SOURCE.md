# Source and modifications

Upstream directory: https://github.com/heygen-com/hyperframes/tree/77ea9d80cfc8b347ccca966487a8ff902ce28320/skills/media-use

Upstream license: https://github.com/heygen-com/hyperframes/blob/77ea9d80cfc8b347ccca966487a8ff902ce28320/LICENSE

StartupBot retains the pinned upstream instructions as `UPSTREAM.md` and the upstream `.gitignore` as `UPSTREAM.gitignore`, and supplies an adapted `SKILL.md` for provider, cost, privacy and commercial-rights boundaries. Included upstream files retain the upstream directory structure. `audio/scripts/lib/concurrency.mjs` uses an equivalent sparse-array initialization, and `audio/scripts/lib/audio-carve.mjs` is formatted and adapted to satisfy project lint rules while retaining its exported behavior. The media downloader and resolve shim include security fixes from upstream commit `559ad7b6d9569bd286cd4a0e5fb895610d02c220`: they block DNS-resolved private addresses and refuse a CLI planted beside a project. The SFX documentation and script describe the 19 included files; an additional offline test verifies each replacement. The original pinned sources remain available at the upstream link above.

## Excluded upstream audio files

The upstream `audio/assets/sfx/CREDITS.md` identifies Pixabay as the source of the 19 MP3 files. Pixabay's Content License distinguishes incorporating material into a new work from redistribution of content on a standalone basis. Permission to redistribute these unchanged audio files as extractable assets in a commercial skill library has not been established. The original files listed below are not included. StartupBot instead supplies CC0 synthesized alternatives under the same filenames; they are not the original recordings. The upstream credits and manifest are preserved as `audio/assets/sfx/UPSTREAM-CREDITS.md` and `audio/assets/sfx/UPSTREAM-manifest.json`. The active credits and manifest describe the replacements; see `audio/assets/sfx/REPLACEMENT-SOURCES.md` for each recipe, duration and hash. Pixabay terms are separate from the Apache license on HyperFrames code.

- audio/assets/sfx/chime.mp3
- audio/assets/sfx/click-soft.mp3
- audio/assets/sfx/click.mp3
- audio/assets/sfx/error.mp3
- audio/assets/sfx/glitch-1.mp3
- audio/assets/sfx/glitch-2.mp3
- audio/assets/sfx/glitch-3.mp3
- audio/assets/sfx/impact-bass-1.mp3
- audio/assets/sfx/impact-bass-2.mp3
- audio/assets/sfx/key-press.mp3
- audio/assets/sfx/notification.mp3
- audio/assets/sfx/ping.mp3
- audio/assets/sfx/pop.mp3
- audio/assets/sfx/riser.mp3
- audio/assets/sfx/sparkle.mp3
- audio/assets/sfx/typing.mp3
- audio/assets/sfx/whoosh-cinematic.mp3
- audio/assets/sfx/whoosh-short.mp3
- audio/assets/sfx/whoosh.mp3

StartupBot defaults media-use telemetry to off. It can be enabled with STARTUPBOT_MEDIA_TELEMETRY=1, subject to upstream opt-outs.
