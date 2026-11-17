# server_config

```text
Generate a dedicated server config (server.json) for Arma Reforger using the current schema (v0.9.8.73+: bindAddress / publicAddress / rcon / passwordAdmin / admins). Configures ports, mod list, scenario, game properties, RCON, and admin auth. The tool RESPONSE shows a redacted variant — passwords appear as '<redacted>'. The actual file written to disk contains the real values. Pair with `server_validate_config` to lint the result.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/server_config.md](../../../data/kb/census/tools/server_config.md) |

## Input parameters (19)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string | yes | Server display name (e.g. 'My Mod Test Server') |
| `modName` | string | no | Addon ID from .gproj (e.g. 'MyCustomMod') |
| `modId` | string | no | Addon GUID from .gproj |
| `scenarioId` | string | no | Scenario resource path (e.g. '{GUID}Missions/MissionHeader.conf') |
| `maxPlayers` | number | no | Maximum players (default 32) |
| `bindPort` | number | no | Game host bind port (default 2001) |
| `publicPort` | number | no | Public/register port (default = bindPort) |
| `bindAddress` | string | no | Bind address (default '0.0.0.0') |
| `publicAddress` | string | no | Public/register address (leave empty for auto-detect) |
| `a2sPort` | number | no | A2S query port (default 17777) |
| `visible` | boolean | no | Show in server browser (default false for local testing) |
| `password` | string | no | Join password (empty = no password) |
| `passwordAdmin` | string | no | Admin console password — sensitive, redacted on output |
| `admins` | array<string> | no | Admin SteamID list (Steam64 IDs as strings) |
| `rconPassword` | string | no | If set, enables an RCON block with this password (sensitive, redacted) |
| `rconPort` | number | no | RCON port (default 19999) |
| `crossPlatform` | boolean | no | Allow PC + console mixing (default false) |
| `projectPath` | string | no | Project root to write server.json. Uses configured default if omitted. |
| `overwrite` | boolean | no | Overwrite an existing server.json (default false — refuses if file exists) Default: `false`. |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/server_config.<action>`. A row that links several actions is counted under each (1 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 1 | T2 1 | `file:.json` |
