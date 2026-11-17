# script_create

```text
Create a new Enforce Script (.c) file for an Arma Reforger mod from a template, with its class hierarchy and method stubs. With parentClass and no methods, the overridable methods come from the API index. A plugin goes to Scripts/WorkbenchGame.
```

| Field | Value |
| --- | --- |
| Tier | core |
| Registered under ENFUSION_TOOLSET | core, extended, all |
| Census KB page | [data/kb/census/tools/script_create.md](../../../data/kb/census/tools/script_create.md) |

## Input parameters (9)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `className` | string | yes | Class name with its prefix, e.g. 'TAG_MyComponent' |
| `scriptType` | string | yes | modded: override a class; component: ScriptComponent; gamemode: game mode; action: UserAction; entity: entity; manager: singleton; basic: plain class; plugin: Workbench plugin or tool. One of: `modded`, `component`, `gamemode`, `action`, `entity`, `manager`, `basic`, `plugin`. |
| `parentClass` | string | no | Base class; required for modded, else a default per type. plugin: WorkbenchPlugin (default), WorldEditorPlugin, ResourceManagerPlugin, LocalizationEditorPlugin, WorldEditorTool. |
| `methods` | array<string> | no | Signatures to stub, e.g. ['void OnGameStart()']; per-type defaults if omitted. |
| `description` | string | no | Header comment of the file |
| `module` | string | no | plugin on WorkbenchPlugin: wbModules module (WorldEditor, ResourceManager, ScriptEditor, LocalizationEditor). |
| `shortcut` | string | no | plugin: shortcut, e.g. 'Ctrl+Shift+X'. |
| `awesomeFontCode` | integer \| string | no | plugin: Font Awesome icon code, e.g. '0xF0C5'. |
| `projectPath` | string | no | Addon root; the configured project if omitted. |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/script_create.<action>`. A row that links several actions is counted under each (2 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 2 | T2 2 | `file:.c`, `mcp:action/script_create.run` |
