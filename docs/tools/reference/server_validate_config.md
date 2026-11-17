# server_validate_config

```text
Validate an existing `server.json` for schema correctness, port-range issues, and semantic warnings. Reports deprecated v0.9.8.72 field names (gameHostBindAddress et al — silently ignored now). Output is REDACTED — never echoes plaintext passwords from the file under inspection.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/server_validate_config.md](../../../data/kb/census/tools/server_validate_config.md) |

## Input parameters (1)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `config_path` | string | no | Path to server.json. Defaults to <projectPath>/server.json. May be absolute. |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/server_validate_config.<action>`. A row that links several actions is counted under each (1 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 1 | T2 1 | `file:.json` |
