# layout_edit

```text
Read and edit .layout widget trees offline (lossless parser). Actions: read, addWidget, removeWidget, moveWidget, duplicateWidget, wrap (unwrap:true undoes), convert, setProperty (value null removes), saveAsPrefab, genClass. A widget is root, an index path 0/2, a Name or a {GUID}. Writes stay in the project and are a dry run until confirm:true.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/layout_edit.md](../../../data/kb/census/tools/layout_edit.md) |

## Actions (10)

`read`, `addWidget`, `removeWidget`, `moveWidget`, `duplicateWidget`, `wrap`, `convert`, `setProperty`, `saveAsPrefab`, `genClass`

## Input parameters (24)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `action` | string | yes | One of: `read`, `addWidget`, `removeWidget`, `moveWidget`, `duplicateWidget`, `wrap`, `convert`, `setProperty`, `saveAsPrefab`, `genClass`. |
| `path` | string | yes | Project-relative .layout (read also takes a game resource path). |
| `widget` | string | no | Target widget; default root. |
| `parent` | string | no | addWidget/moveWidget: parent widget; default root. |
| `index` | integer | no | Position among the siblings; default last. |
| `widgetClass` | string | no | addWidget: e.g. TextWidgetClass. |
| `name` | string | no | addWidget/duplicateWidget/wrap: Name of the new widget. |
| `base` | string | no | addWidget: base layout resource ({GUID}path). |
| `props` | object | no | addWidget: scalar properties. |
| `slot` | object | no | addWidget: slot class (default from the parent) and properties. |
| `text` | string | no | addWidget: a widget block verbatim (undoes removeWidget). |
| `wrapper` | string | no | wrap: container widget class. |
| `unwrap` | boolean | no | wrap: remove a one-child wrapper. |
| `toClass` | string | no | convert: the new widget class. |
| `property` | string | no | setProperty: Name, Slot.PositionX, components.Cls.key. |
| `value` | any \| null | no | setProperty: new value; null removes. |
| `quoted` | boolean | no | setProperty: force quotes on or off. |
| `to` | string | no | saveAsPrefab (.layout) / genClass (.c): new project path. |
| `className` | string | no | genClass: script class name. |
| `overwrite` | boolean | no | saveAsPrefab/genClass: replace an existing file. |
| `confirm` | boolean | no | Write. Without it every write is a dry run. |
| `cursor` | string | no | read: paging cursor. |
| `limit` | integer | no | read: widgets per page. |
| `projectPath` | string | no | Addon root; the configured project when omitted. |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/layout_edit.<action>`. A row that links several actions is counted under each (20 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `addWidget` | 2 | T2 1, T5 1 | `file:.layout`, `mcp:action/layout_edit.addWidget` |
| `convert` | 2 | T2 1, T5 1 | `file:.layout`, `mcp:action/layout_edit.convert` |
| `duplicateWidget` | 2 | T2 1, T5 1 | `file:.layout`, `mcp:action/layout_edit.duplicateWidget` |
| `genClass` | 2 | T2 1, T3 1 | `file:.layout`, `mcp:action/layout_edit.genClass` |
| `moveWidget` | 2 | T2 1, T5 1 | `file:.layout`, `mcp:action/layout_edit.moveWidget` |
| `read` | 2 | T2 1, T5 1 | `file:.layout`, `mcp:action/layout_edit.read` |
| `removeWidget` | 2 | T2 1, T5 1 | `file:.layout`, `mcp:action/layout_edit.removeWidget` |
| `saveAsPrefab` | 2 | T2 1, T3 1 | `file:.layout`, `mcp:action/layout_edit.saveAsPrefab` |
| `setProperty` | 2 | T2 1, T5 1 | `file:.layout`, `mcp:action/layout_edit.setProperty` |
| `wrap` | 2 | T2 1, T5 1 | `file:.layout`, `mcp:action/layout_edit.wrap` |
