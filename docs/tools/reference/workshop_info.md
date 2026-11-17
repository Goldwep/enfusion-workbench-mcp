# workshop_info

```text
Read Workshop metadata from a mod's .gproj file. Shows mod ID, GUID, title, dependencies, and configurations. Useful for checking publish state before releasing.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/workshop_info.md](../../../data/kb/census/tools/workshop_info.md) |

## Input parameters (2)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `projectPath` | string | no | Absolute path to the mod directory (containing the .gproj). Uses configured default if omitted. |
| `modName` | string | no | Mod/addon name to look up. Used to find the .gproj if projectPath points to the addons directory. |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/workshop_info.<action>`. A row that links several actions is counted under each (1 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 1 | T2 1 | `file:.gproj` |
