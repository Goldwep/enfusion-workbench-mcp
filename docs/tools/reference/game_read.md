# game_read

```text
Read a file from the base game data. Reads from both unpacked files and .pak archives transparently. Use this to read vanilla .c script files to understand what to override, or inspect prefab .et files and config .conf files.
```

| Field | Value |
| --- | --- |
| Tier | core |
| Registered under ENFUSION_TOOLSET | core, extended, all |
| Census KB page | [data/kb/census/tools/game_read.md](../../../data/kb/census/tools/game_read.md) |

## Input parameters (1)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `path` | string | yes | Relative path within the game data (e.g., 'Scripts/Game/Character/SCR_CharacterControllerComponent.c') |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/game_read.<action>`. A row that links several actions is counted under each (4 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 4 | T2 4 | `file:.c`, `file:.conf`, `file:.et` |
