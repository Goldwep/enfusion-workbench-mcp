# layout_create

```text
Create a UI layout (.layout) file for an Arma Reforger mod. Generates a properly structured layout with widgets in valid Enfusion text serialization format. Use for HUD elements, menus, dialogs, and custom UI.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/layout_create.md](../../../data/kb/census/tools/layout_create.md) |

## Input parameters (8)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string | yes | Layout name (e.g., 'HealthDisplay', 'ScoreboardMenu') |
| `layoutType` | string | yes | Layout template type. 'hud' creates a bottom-left HUD element. 'menu' creates a centered menu panel. 'dialog' creates a centered confirmation dialog. 'list' creates a left-side list panel. 'custom' creates a blank full-screen frame. One of: `hud`, `menu`, `dialog`, `list`, `custom`. |
| `rootWidgetType` | string | no | Override the root widget class (default: FrameWidgetClass) |
| `anchor` | string | no | Root anchor as 'left top right bottom' floats 0-1 (e.g., '0 1 0 1' = bottom-left corner). Uses layout type default if omitted. |
| `offset` | string | no | Root offset as 'left top right bottom' in pixels relative to anchor (e.g., '20 -120 220 -20'). Uses layout type default if omitted. |
| `widgets` | array<object> | no | Additional widgets to add beyond the layout type defaults. Each widget needs at minimum a type and name. |
| `description` | string | no | Description comment for the layout |
| `projectPath` | string | no | Addon root path. Uses configured default if omitted. |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/layout_create.<action>`. A row that links several actions is counted under each (2 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 2 | T2 2 | `file:.layout`, `mcp:action/layout_create.run` |
