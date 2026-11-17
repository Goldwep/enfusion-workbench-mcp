# game_browse

```text
Browse base game data files (scripts, prefabs, configs). Shows both unpacked files and contents of .pak archives transparently. Do NOT try to use filesystem tools on the game install directory.
```

| Field | Value |
| --- | --- |
| Tier | core |
| Registered under ENFUSION_TOOLSET | core, extended, all |
| Census KB page | [data/kb/census/tools/game_browse.md](../../../data/kb/census/tools/game_browse.md) |

## Input parameters (2)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `path` | string | no | Subdirectory to list (e.g., 'Prefabs/Weapons', 'Scripts/Game/Character'). Omit for root. Default: `""`. |
| `pattern` | string | no | File extension filter (e.g., '*.et', '*.xob', '*.c') |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/game_browse.<action>`. A row that links several actions is counted under each (4 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 4 | T2 4 | `file:.c`, `file:.conf`, `file:.et` |
