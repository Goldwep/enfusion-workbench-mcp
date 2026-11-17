# server_mod_list

```text
Read a server.json and list every entry in its `game.mods[]` block, resolving each modId against the project-index to show which mods are present in the crawled sources (user / core / workshop) and which are unknown. Output is markdown; passwords from the config are never echoed.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/server_mod_list.md](../../../data/kb/census/tools/server_mod_list.md) |

## Input parameters (1)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `server_config_path` | string | yes | Absolute path to the server.json to read. |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/server_mod_list.<action>`. A row that links several actions is counted under each (1 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 1 | T2 1 | `file:.json` |
