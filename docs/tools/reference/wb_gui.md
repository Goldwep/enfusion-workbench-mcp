# wb_gui

```text
Workbench GUI through UI Automation (opt-in: ENFUSION_GUI=1; Windows). Read: tree, find, screenshot, modals, read (a census row by id), context (read an open context menu). Drive a census row by id when it has a locator captured on this build: invoke, expand, toggle, select, setValue; dismiss presses Cancel, Close or No only. Commit buttons and deny-listed labels are never pressed.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/wb_gui.md](../../../data/kb/census/tools/wb_gui.md) |

## Actions (12)

`tree`, `find`, `screenshot`, `modals`, `read`, `context`, `invoke`, `expand`, `toggle`, `select`, `setValue`, `dismiss`

## Input parameters (19)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `action` | string | yes | One of: `tree`, `find`, `screenshot`, `modals`, `read`, `context`, `invoke`, `expand`, `toggle`, `select`, `setValue`, `dismiss`. |
| `pid` | integer | no | Workbench process id (required except screenshot; with screenshot, windowTitle or hwnd: that window only) |
| `rowId` | string | no | read and drive actions: a ui census row id |
| `confirm` | boolean | no | drive actions: act (else a dry run) |
| `value` | string | no | setValue: the text |
| `dialog` | string | no | dismiss: the dialog's exact title |
| `windowTitle` | string | no | Regular expression matched against the whole window title |
| `className` | string | no | Win32 window class |
| `hwnd` | integer | no |  |
| `depth` | integer | no | tree: maximum depth (default 40) |
| `rowSampling` | integer | no | rows read per list or tree (default 40) |
| `view` | string | no | One of: `control`, `raw`. |
| `query` | string | no | find: substring of name or automation id |
| `controlType` | string | no |  |
| `automationId` | string | no |  |
| `name` | string | no |  |
| `limit` | integer | no |  |
| `label` | string | no | screenshot/tree file label |
| `rebaseline` | boolean | no | modals: take the windows open now as the baseline |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/wb_gui.<action>`. A row that links several actions is counted under each (17 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `context` | 6 | T0 5, T3 1 | `mcp:action/wb_gui.context`, `ui:WorldEditor/context-menu/Hierarchy/default`, `ui:WorldEditor/context-menu/Hierarchy/entity` |
| `dismiss` | 1 | T3 1 | `mcp:action/wb_gui.dismiss` |
| `expand` | 1 | T3 1 | `mcp:action/wb_gui.expand` |
| `find` | 1 | T3 1 | `mcp:action/wb_gui.find` |
| `invoke` | 1 | T3 1 | `mcp:action/wb_gui.invoke` |
| `modals` | 1 | T3 1 | `mcp:action/wb_gui.modals` |
| `read` | 1 | T3 1 | `mcp:action/wb_gui.read` |
| `screenshot` | 1 | T3 1 | `mcp:action/wb_gui.screenshot` |
| `select` | 1 | T3 1 | `mcp:action/wb_gui.select` |
| `setValue` | 1 | T3 1 | `mcp:action/wb_gui.setValue` |
| `toggle` | 1 | T3 1 | `mcp:action/wb_gui.toggle` |
| `tree` | 1 | T3 1 | `mcp:action/wb_gui.tree` |
