# Source and modifications

Upstream directory https://github.com/ReScienceLab/opc-skills/tree/0c44a6a6e654c38cfd3c8aceda86d7d8de40a183/skills/producthunt

Upstream license https://github.com/ReScienceLab/opc-skills/blob/0c44a6a6e654c38cfd3c8aceda86d7d8de40a183/LICENSE

StartupBot adapted SKILL.md for configured credentials and expanded the read-only operations. StartupBot modified `scripts/producthunt_api.py` to avoid printing credentials or untrusted HTTP response bodies in errors and to distinguish missing counts from zero. Other included upstream files retain their original contents.

Excluded the hidden Claude manifest and shell-profile setup instructions.

## Excluded upstream files

- .claude-plugin/plugin.json
