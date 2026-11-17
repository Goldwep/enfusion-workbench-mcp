# wb_link

```text
enfusion:// links. parse and build: WorldEditor (world;pos;angles;time;entity), ResourceManager (~addon:path), ScriptEditor (path;line), editor-only links, the web redirect prefix. fromView: the open World Editor view as a link. open: dispatch a link through wb_module, wb_view and wb_script_editor (dry run unless confirm). Web links are answered, never opened.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/wb_link.md](../../../data/kb/census/tools/wb_link.md) |

## Actions (4)

`parse`, `build`, `fromView`, `open`

## Input parameters (14)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `action` | string | yes | One of: `parse`, `build`, `fromView`, `open`. |
| `link` | string | no | parse, open: an enfusion:// link or a web link |
| `kind` | string | no | build One of: `world`, `resource`, `script`, `editor`. |
| `module` | string | no | build editor: the module to open One of: `WorldEditor`, `ResourceManager`, `ScriptEditor`, `ParticleEditor`, `AnimEditor`, `AudioEditor`, `BehaviorEditor`, `LocalizationEditor`, `ProcAnimEditor`. |
| `world` | string | no | build world: ~Addon:worlds/x.ent |
| `addon` | string | no | build: addon id (with path) |
| `path` | string | no | build: relative path |
| `pos` | array<number> \| string | no | build world: x,y,z |
| `angles` | any | no | build world: pitch,yaw,roll |
| `time` | any | no | build world: daytime 0..1,year,month,day |
| `entity` | string | no | build world: EntityID |
| `line` | integer | no | build script |
| `webPrefix` | boolean | no | build, fromView: add the redirect prefix |
| `confirm` | boolean | no | open: dispatch (else dry run) |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/wb_link.<action>`. A row that links several actions is counted under each (53 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `build` | 17 | T0 5, T1 11, T3 1 | `link:Editor-only-links`, `link:Resource-Manager-link`, `link:Script-Editor-link` |
| `fromView` | 3 | T0 1, T1 1, T3 1 | `link:World-Editor-link`, `link:enfusion://WorldEditor`, `mcp:action/wb_link.fromView` |
| `open` | 16 | T0 5, T1 10, T3 1 | `link:Editor-only-links`, `link:Resource-Manager-link`, `link:Script-Editor-link` |
| `parse` | 17 | T0 5, T1 11, T3 1 | `link:Editor-only-links`, `link:Resource-Manager-link`, `link:Script-Editor-link` |
