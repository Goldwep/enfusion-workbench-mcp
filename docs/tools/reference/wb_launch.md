# wb_launch

```text
Launch Arma Reforger Workbench (Arma Reforger Tools). Automatically copies handler scripts into the target mod's Scripts/WorkbenchGame/ directory (so NET API handlers compile as part of the mod), starts the Workbench executable, and waits for the NET API to become available. If the launcher holds at its Projects picker instead of auto-opening the project (waiting for a human click on Open, often minimized), the launch auto-confirms it by restoring the window and posting Enter; a genuine block (picker or 'Missing Addon Dependencies' modal) fails fast with a diagnosis and dependency remedies instead of the full launch timeout. Requires a project: pass gprojPath, or have ENFUSION_DEFAULT_MOD name an addon folder (with a .gproj) under the project path; without either the launch is refused and no addon is guessed. An explicit gprojPath works even while the no-autolaunch marker exists. Launching takes the machine-wide Workbench lease and is refused while another session holds it. Other wb_* tools auto-launch only the ENFUSION_DEFAULT_MOD project, and never while the no-autolaunch marker exists. IMPORTANT: When done working with Workbench, call wb_cleanup to remove the handler scripts from the mod before the user publishes.
```

| Field | Value |
| --- | --- |
| Tier | core |
| Registered under ENFUSION_TOOLSET | core, extended, all |
| Census KB page | [data/kb/census/tools/wb_launch.md](../../../data/kb/census/tools/wb_launch.md) |

## Input parameters (3)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `gprojPath` | string | no | Path to a .gproj file to open directly. Skips the Workbench launcher screen. Handler scripts are copied into the mod so all wb_* tools work. If omitted, the ENFUSION_DEFAULT_MOD addon's .gproj is used; with no default mod configured the launch is refused, so pass the project you want opened. |
| `world` | string | no | Project-relative path of a world/scenario to open in the World Editor after launch (e.g., 'worlds/MP/MyMission.ent'). Without an open world most entity/terrain tools have nothing to operate on. If omitted and the mod contains exactly one .ent file, that world is opened automatically; with several, they are listed instead. |
| `forceSettings` | string | no | Absolute path of a scratch settings ini to launch with (`-forceSettings <ini>`), so the session does not touch the user's Workbench settings. Used only when this call launches Workbench. |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/wb_launch.<action>`. A row that links several actions is counted under each (3 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 3 | T2 1, T3 2 | `cli:-forcesettings`, `cli:-scriptauthorizeall`, `mcp:handler-action/EMCP_WB_EditorControl.openResource` |
