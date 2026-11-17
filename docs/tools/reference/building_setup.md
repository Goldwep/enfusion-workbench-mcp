# building_setup

```text
Set up an Arma Reforger destructible building from a Blender export manifest.

Reads a building_manifest.json (exported by bk_building_tools Blender plugin), then creates the building structure prefab with slot wiring (SlotBoneMappingObject / BaseSlotComponent) and individual part prefabs with SCR_DestructionMultiPhaseComponent for each destruction phase.

The manifest contains: building name, socket list, part definitions with FBX paths and destruction phases.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/building_setup.md](../../../data/kb/census/tools/building_setup.md) |

## Input parameters (4)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `manifestPath` | string | yes | Absolute path to the building_manifest.json file exported from Blender |
| `modPrefix` | string | no | Mod resource prefix path (e.g., 'MyMod/Assets/Buildings/'). Prepended to FBX-derived .xob paths. Default: `""`. |
| `outputDir` | string | no | Output directory for generated .et prefab files. Defaults to mod prefabs directory from config. |
| `dryRun` | boolean | no | If true, return what would be created without writing files Default: `false`. |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/building_setup.<action>`. A row that links several actions is counted under each (3 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 3 | T2 3 | `file:.et`, `file:.xob`, `mcp:action/building_setup.run` |
