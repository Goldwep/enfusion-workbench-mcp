# server_health_probe

```text
Run a UDP Valve A2S info query against `host:query_port`. Returns the server's current player count, map, name, version, and protocol metadata. Anonymous and read-only — no auth needed. RCON read-only allow-list deferred to v2 (see RCON_ALLOW_LIST comment in source).
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/server_health_probe.md](../../../data/kb/census/tools/server_health_probe.md) |

## Input parameters (3)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `host` | string | yes | Hostname or IPv4 address of the server. |
| `query_port` | integer | no | UDP A2S query port (matches `a2s.port` in server.json — default 17777). Default: `17777`. |
| `timeout_ms` | integer | no | Timeout in ms (1 - 10000, default 2000). Default: `2000`. |

## Linked census rows

No ledger row links an action of `server_health_probe` through its `mcp` field.
