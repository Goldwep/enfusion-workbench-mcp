# faction_create

```text
Scaffold a new Configs/Factions/<Key>.conf file for an Arma Reforger mod. Emits SCR_Faction with FactionKey, FactionColor (0-1 floats) and UIInfo.Name, the names vanilla faction configs use. Refuses to overwrite an existing file or to write when the target has uncommitted git changes — pass force=true to override. Use dry_run=true to preview without writing. config_create with configType='faction' writes the same shape from an RGBA string.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/faction_create.md](../../../data/kb/census/tools/faction_create.md) |

## Input parameters (6)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `faction_key` | string | yes | Faction key — e.g. 'US', 'FIA', 'RUR'. Must match /^[A-Z][A-Z0-9_]{1,15}$/ (starts uppercase, 2-16 chars, uppercase + digits + underscore only). Must not start with '-' (flag-smuggle guard). |
| `display_name` | string | yes | Human-readable name shown in UI, e.g. 'United States Army'. |
| `color_rgb` | object | no | RGB color 0-255 per channel. Defaults to neutral gray (128,128,128). |
| `out_path` | string | no | Override target path. Default: <projectPath>/Configs/Factions/<faction_key>.conf. Must end in .conf and must not start with '-' (flag-smuggle guard). |
| `dry_run` | boolean | no | When true, return the rendered content without writing the file. Default: `false`. |
| `force` | boolean | no | Bypass overwrite refusal and uncommitted-changes refusal. Use sparingly. Default: `false`. |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/faction_create.<action>`. A row that links several actions is counted under each (1 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 1 | T2 1 | `file:.conf` |
