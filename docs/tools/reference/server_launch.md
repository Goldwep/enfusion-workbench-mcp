# server_launch

```text
Launch ArmaReforgerServer.exe (the dedicated server — separate from the Workbench/game install, Steam app 1874900) with the supplied server.json; the scenario is the file's game.scenarioId. Always defaults to dry_run=true: the tool prints the argv that WOULD run plus a redacted view of the config, but does not spawn unless dry_run is explicitly false. Passwords are never echoed — uses RedactedServerConfig at the type boundary. On a real spawn, writes `<dirname(server_config_path)>/.arma-reforger-server.pid` and refuses a second concurrent launch against the same server.json unless `force=true`. Use `server_stop` to terminate.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/server_launch.md](../../../data/kb/census/tools/server_launch.md) |

## Input parameters (5)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `server_config_path` | string | yes | Absolute path to the server.json to launch with. |
| `scenario_id` | string | no | Optional check, {GUID}path form: must equal the server.json's game.scenarioId, which is what the server loads. |
| `extra_args` | array<string> | no | Additional CLI flags. Each must match `^-[a-zA-Z0-9_=:.,/\-]+$` — no shell metacharacters. Max 10. |
| `dry_run` | boolean | no | When true (the default), print the spawn argv + redacted config without launching. Flip to false to actually spawn ArmaReforgerServer.exe. Default: `true`. |
| `force` | boolean | no | When true, bypass the double-launch guard (will spawn even if the PID file indicates an already-running server). Use with care — concurrent servers will fight for the same a2s/RCON ports. Default: `false`. |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/server_launch.<action>`. A row that links several actions is counted under each (1 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 1 | T2 1 | `cli:-config` |
