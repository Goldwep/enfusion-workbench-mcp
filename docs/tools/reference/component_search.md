# component_search

```text
Search for Enfusion ScriptComponent descendants — the building blocks you attach to entities in prefabs. Filter by category (character, vehicle, weapon, damage, inventory, ai, ui, editor, camera, sound, general) and/or by event handler name (e.g., 'OnPlayerConnected', 'EOnFrame', 'OnDamage'). Use this when you need to find what component to attach to an entity to achieve specific functionality.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/component_search.md](../../../data/kb/census/tools/component_search.md) |

## Input parameters (5)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `query` | string | no | Component name or keyword to search for |
| `category` | string | no | Filter by target entity type or functional area One of: `character`, `vehicle`, `weapon`, `damage`, `inventory`, `ai`, `ui`, `editor`, `camera`, `sound`, `general`, `any`. Default: `"any"`. |
| `event` | string | no | Filter by event handler name (e.g., 'EOnFrame', 'OnPlayerConnected', 'OnDamage') |
| `source` | string | no | Search enfusion engine API, arma reforger API, or both One of: `enfusion`, `arma`, `all`. Default: `"all"`. |
| `limit` | number | no | Maximum results to return Default: `20`. |

## Linked census rows

No ledger row links an action of `component_search` through its `mcp` field.
