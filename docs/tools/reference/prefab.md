# prefab

```text
Create or inspect Arma Reforger prefab (.et) files.

action=create: Create a new Entity Template (.et) prefab file for an Arma Reforger mod. Generates a properly structured prefab with components in valid Enfusion text serialization format. When parentPrefab is provided, automatically resolves the full ancestor chain and pre-populates inherited components (set includeAncestry=false to skip). IMPORTANT: For 'interactive' and other visible prefabs, the MeshObject component MUST have its 'Object' property set to a base game .xob model path (e.g., '{5F4C4181F065B447}Assets/Props/Military/Barrels/BarrelGreen_01.xob') or the entity will be invisible in-game. Use api_search to find model paths.

action=inspect: Inspect an Arma Reforger prefab (.et file) and its full inheritance chain. Reads each ancestor prefab, parses all components, and returns a fully merged view showing which ancestor each component comes from. Child values override parent values (matched by component GUID). Use this to understand the complete component set of a prefab, including all inherited values not visible in the prefab file itself.
```

| Field | Value |
| --- | --- |
| Tier | core |
| Registered under ENFUSION_TOOLSET | core, extended, all |
| Census KB page | [data/kb/census/tools/prefab.md](../../../data/kb/census/tools/prefab.md) |

## Actions (2)

`create`, `inspect`

## Input parameters (11)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `action` | string | yes | Action to perform: 'create' to generate a new prefab file, 'inspect' to view the full inheritance chain of an existing prefab. One of: `create`, `inspect`. |
| `name` | string | no | (create) Prefab name (e.g., 'MySpawnPoint', 'CustomVehicle') |
| `prefabType` | string | no | (create) Prefab template type. Determines the root entity type, default components, and file location. One of: `firearm`, `attachment`, `ground_vehicle`, `air_vehicle`, `character`, `prop`, `building`, `item`, `group`, `spawnpoint`, `gamemode`, `generic`. |
| `variant` | string | no | (create) Optional recipe variant (e.g., 'handgun' for firearm, 'rifle', 'launcher', 'machinegun'). Variants specialize the recipe with different base parents and placeholder components. |
| `parentPrefab` | string | no | (create) Parent prefab to inherit from (e.g., '{GUID}Prefabs/Weapons/AK47.et'). Omit to create a standalone prefab. |
| `components` | array<object> | no | (create) Additional components to add beyond the defaults for this prefab type |
| `description` | string | no | (create) Description for the prefab. Used as the display name in Game Master. |
| `includeAncestry` | boolean | no | (create) When parentPrefab is provided, resolve the full ancestor chain and pre-populate inherited components. Defaults to true. Set false to skip ancestry resolution (uses hardcoded template defaults instead). Default: `true`. |
| `path` | string | no | (inspect) Relative prefab path, e.g. 'Prefabs/Weapons/Handguns/M9/Handgun_M9.et'. A leading {GUID} prefix is accepted and stripped automatically. |
| `include_raw` | boolean | no | (inspect) Include the full raw .et text for each ancestor at the bottom of the report. Default: `false`. |
| `projectPath` | string | no | Addon root path / mod project root. Uses configured default if omitted. |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/prefab.<action>`. A row that links several actions is counted under each (4 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `create` | 2 | T2 1, T3 1 | `file:.et`, `mcp:action/prefab.create` |
| `inspect` | 2 | T2 1, T3 1 | `file:.et`, `mcp:action/prefab.inspect` |
