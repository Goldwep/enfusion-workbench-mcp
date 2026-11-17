# mod

```text
Manage Arma Reforger addons: build with the Workbench CLI, scaffold a new addon, or validate an existing addon without building.
```

| Field | Value |
| --- | --- |
| Tier | core |
| Registered under ENFUSION_TOOLSET | core, extended, all |
| Census KB page | [data/kb/census/tools/mod.md](../../../data/kb/census/tools/mod.md) |

## Actions (3)

`build`, `create`, `validate`

## Input parameters (12)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `action` | string | yes | Action to perform: 'build' compiles the addon, 'create' scaffolds a new addon, 'validate' checks an existing addon. One of: `build`, `create`, `validate`. |
| `addonName` | string | no | (build) Name of the addon to build (must match the .gproj ID) |
| `platform` | string | no | (build) Target platform for the build One of: `PC`, `PC_WB`, `HEADLESS`. Default: `"PC"`. |
| `outputPath` | string | no | (build) Build output directory. Auto-generated if omitted. |
| `gprojPath` | string | no | (build) Path to .gproj file. Auto-detected if omitted. |
| `filterPath` | string | no | (build) Limit build to a single folder or file for faster iteration |
| `name` | string | no | (create) Addon name (e.g., 'MyCustomMod'). Used as the project folder name. |
| `description` | string | no | (create) Brief description of what the mod does |
| `prefix` | string | no | (create) Class name prefix (e.g., 'MCM'). Auto-derived from name if omitted. |
| `pattern` | string | no | (create) Mod pattern to apply (e.g., 'custom-faction', 'game-mode'). Use without this to get a bare scaffold. |
| `projectPath` | string | no | (create/validate) Parent directory where the addon folder will be created (create), or addon root directory (validate). Uses configured default if omitted. |
| `checks` | array<string> | no | (validate) Specific checks to run. Runs all checks if omitted. |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/mod.<action>`. A row that links several actions is counted under each (14 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `build` | 5 | T2 4, T3 1 | `cli:-builddata`, `cli:-filterpath`, `cli:-gproj` |
| `create` | 4 | T2 3, T3 1 | `file:.c`, `file:.conf`, `file:.gproj` |
| `validate` | 5 | T2 4, T3 1 | `file:.c`, `file:.conf`, `file:.et` |
