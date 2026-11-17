# script_find_rpc_handlers

```text
Locate every method decorated with an `[RPC(...)]` attribute (or another custom attribute name) across a project's `.c` files. Surfaces class context, method signature, and the attribute arguments (channel/reliability/etc). Use to audit network-code entry points or to find every `[RplProp]`/`[Replicated]` field by passing the attribute name explicitly.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/script_find_rpc_handlers.md](../../../data/kb/census/tools/script_find_rpc_handlers.md) |

## Input parameters (2)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `project_root` | string | yes | Absolute path to the project to scan |
| `attribute_name` | string | no | Which attribute to match. Defaults to 'RPC', which also matches 'RplRpc'. Use 'RplProp' to find replicated fields, 'Attribute' for editor attributes, etc. Default: `"RPC"`. |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/script_find_rpc_handlers.<action>`. A row that links several actions is counted under each (1 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 1 | T2 1 | `file:.c` |
