# asset_search

```text
Search for base game assets (prefabs, models, textures, scripts, configs) by name. Searches both unpacked files and .pak archives transparently. Returns file paths and GUIDs (for prefabs) that can be used in prefab references. The first search may take a few seconds to build the file index.
```

| Field | Value |
| --- | --- |
| Tier | core |
| Registered under ENFUSION_TOOLSET | core, extended, all |
| Census KB page | [data/kb/census/tools/asset_search.md](../../../data/kb/census/tools/asset_search.md) |

## Input parameters (4)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `query` | string | yes | Search term to match against file names (e.g., 'AK47', 'BarrelGreen', 'soldier') |
| `type` | string | no | Filter by asset type One of: `prefab`, `model`, `texture`, `script`, `config`, `material`, `layout`, `any`. Default: `"any"`. |
| `limit` | number | no | Maximum results to return Default: `20`. |
| `refresh` | boolean | no | Force rebuild of the file index (clears cache). Use if results seem stale. Default: `false`. |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/asset_search.<action>`. A row that links several actions is counted under each (8 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 8 | T2 8 | `file:.c`, `file:.conf`, `file:.edds` |
