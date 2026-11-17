# server_stop

```text
Terminate an ArmaReforgerServer.exe previously launched by `server_launch` against the same server.json. Reads the PID file at `<dirname(server_config_path)>/.arma-reforger-server.pid`, sends SIGTERM, polls for exit up to `timeout_ms` (default 5000), and falls back to a force-kill (taskkill /F /T on Windows, SIGKILL on POSIX) if needed. Reports `not_running` when no live process matches the PID file.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/server_stop.md](../../../data/kb/census/tools/server_stop.md) |

## Input parameters (2)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `server_config_path` | string | yes | Absolute path to the server.json the running server was launched with. Used only to derive the PID-file path next to it. |
| `timeout_ms` | integer | no | Time budget for the graceful SIGTERM wait before falling back to a force-kill. Default 5000. Default: `5000`. |

## Linked census rows

No ledger row links an action of `server_stop` through its `mcp` field.
