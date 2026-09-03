# Enfusion MCP - Prefab Recipe System Overview

## Architecture Summary

The MCP now has an intelligent prefab creation system that guides users through creating game entities with correct base game parents, inherited components, and customization checklists.

### Core Components

#### 1. Recipe Schema (`src/templates/recipe.ts` - 55 lines)

- `PrefabRecipe`: Top-level recipe configuration with entity type, parent, subdirectory, components
- `RecipeVariant`: Specializations like "handgun" within "firearm" category
- `RecipeOverrideComponent`: Placeholder components users must customize with guidance comments

#### 2. Recipe Loader (`src/templates/recipe-loader.ts` - 182 lines)

- Lazy-loads JSON recipes from `data/recipes/` (12 files, 514 lines)
- Validates schema at runtime
- Caches recipes in memory
- Merges variant overrides on demand
- Exports singleton `recipeLoader` with `getRecipe(id, variant?)` method

#### 3. Prefab Generator (`src/templates/prefab.ts` - 142 lines)

- **Changed**: Removed hardcoded `PREFAB_CONFIGS` object (140+ lines)
- **Now uses**: `recipeLoader.getRecipe()` based on `prefabType` + optional `variant`
- Process:
  1. Load recipe → get defaultParent, subdirectory, overrideComponents
  2. Resolve ancestry (if parentPrefab provided) → get inherited components with GUIDs
  3. Merge: ancestry (GUIDs preserved) + recipe overrides + user components
  4. Generate Enfusion .et text

#### 4. Prefab Tool (`src/tools/prefab.ts` - 332 lines)

- MCP tool registered in Phase 1
- Actions: `create` (new prefab), `inspect` (view chain)
- **New features**:
  - `variant` parameter for recipe specialization
  - `postCreateNotes`: Checklist formatted as `[ ] Item` in response
  - Recipe validation at tool entry point

---

## Data Layer: 12 Recipe Categories

### Complete Inventory

| Recipe ID          | Entity Type                    | Variants                             | Example                                           |
| ------------------ | ------------------------------ | ------------------------------------ | ------------------------------------------------- |
| **firearm**        | GenericEntity                  | handgun, rifle, launcher, machinegun | "handgun" → Prefabs/Weapons/Handguns              |
| **attachment**     | GenericEntity                  | suppressor, optic, muzzle_device     | "optic" → WeaponSight_Base.et                     |
| **ground_vehicle** | Vehicle                        | car, truck, apc, tracked             | "apc" → Wheeled_APC_Base.et                       |
| **air_vehicle**    | Vehicle                        | (none)                               | Helicopter_Base.et                                |
| **character**      | SCR_ChimeraCharacter           | soldier, civilian                    | "soldier" → Soldier_Base.et                       |
| **prop**           | GenericEntity                  | static, destructible                 | "destructible" → DestructibleEntity_Props_Base.et |
| **building**       | SCR_DestructibleBuildingEntity | (none)                               | Building_Base.et                                  |
| **item**           | GenericEntity                  | (none)                               | Item_Base.et                                      |
| **group**          | SCR_AIGroup                    | (none)                               | PlayableGroup.et                                  |
| **spawnpoint**     | GenericEntity                  | (none)                               | SpawnPosition.et                                  |
| **gamemode**       | GenericEntity                  | conflict, coop                       | "conflict" → SCR_MissionHeaderCampaign            |
| **generic**        | GenericEntity                  | (none)                               | Custom standalone                                 |

**Total Paths**: 12 categories + 16 variants = 28 creation paths

### Example Recipe Structure (firearm.json)

```json
{
  "id": "firearm",
  "name": "Firearm",
  "description": "Rifles, handguns, machine guns, launchers, and shotguns",
  "entityType": "GenericEntity",
  "subdirectory": "Prefabs/Weapons",
  "defaultParent": "Prefabs/Weapons/Core/Weapon_Base.et",
  "overrideComponents": [
    {
      "type": "MeshObject",
      "properties": { "Object": "" },
      "comment": "Path to your weapon .xob model"
    },
    {
      "type": "WeaponSoundComponent",
      "properties": { "Filenames": "" },
      "comment": "Path(s) to .acp sound configuration files"
    }
  ],
  "postCreateNotes": [
    "Set MeshObject.Object to your weapon model path (.xob)",
    "Configure WeaponSoundComponent with fire/reload sound files",
    "Set up fire modes in MuzzleComponent (default: Safe + Single, 500 RPM)",
    "Configure SightsComponent ADS camera (PivotID: 'eye')",
    "Verify magazine/ammo compatibility in WeaponComponent properties"
  ],
  "variants": [
    {
      "name": "handgun",
      "description": "Pistols and revolvers",
      "defaultParent": "Prefabs/Weapons/Core/Handgun_Base.et",
      "subdirectory": "Prefabs/Weapons/Handguns"
    },
    {
      "name": "rifle",
      "description": "Assault rifles and designated marksman rifles",
      "defaultParent": "Prefabs/Weapons/Core/Rifle_Base.et",
      "subdirectory": "Prefabs/Weapons/Rifles"
    },
    ...
  ]
}
```

---

## Data Flow: User Request to Prefab Creation

```
User: "Create a handgun called MyPistol"
  ↓
prefab create(name="MyPistol", prefabType="firearm", variant="handgun")
  ↓
Tool validates inputs and loads recipe:
  RecipeLoader.getRecipe("firearm", "handgun")
  → Reads firearm.json
  → Applies handgun variant overrides
  → Returns:
    • defaultParent = "Prefabs/Weapons/Core/Handgun_Base.et"
    • subdirectory = "Prefabs/Weapons/Handguns"
    • overrideComponents = [MeshObject, WeaponSoundComponent]
    • postCreateNotes = [5-item checklist]
  ↓
Ancestry resolution (if parentPrefab provided):
  walkChain("Prefabs/Weapons/Core/Handgun_Base.et")
  → Resolves: Weapon_Base.et → Handgun_Base.et
  → Extracts ~25 inherited components with real GUIDs
  → Merges components preserving GUIDs (ancestry wins)
  ↓
generatePrefab({
  name: "MyPistol",
  prefabType: "firearm",
  variant: "handgun",
  ancestorComponents: [from chain, with GUIDs],
  parentPrefab: recipe.defaultParent
})
  → Creates GenericEntity with inheritance
  → Merges: ancestor GUIDs + recipe overrides + user components
  → Serializes to Enfusion text format
  ↓
Write to disk:
  {projectPath}/Prefabs/Weapons/Handguns/MyPistol.et
  ↓
Response to user:
  ✓ Prefab created: Prefabs/Weapons/Handguns/MyPistol.et
  Type: firearm (variant: handgun)
  Ancestry: 2 levels, 25 inherited components

  Required follow-up:
  [ ] Set MeshObject.Object to your weapon model path (.xob)
  [ ] Configure WeaponSoundComponent with fire/reload sound files
  [ ] Set up fire modes in MuzzleComponent
  [ ] Configure SightsComponent ADS camera
  [ ] Verify magazine/ammo compatibility
```

---

## Integration with Existing Systems

### Ancestry Resolver (`src/utils/prefab-ancestry.ts`)

- **Status**: ✓ Unchanged, used as-is
- **Role**: Walks parent prefab chains, extracts inherited components
- **Interaction**: Recipe system provides correct `defaultParent` → resolver fills in all inherited components automatically
- **Benefit**: Recipes stay thin (just override components); inheritance is automatic

### Enfusion Text Serializer (`src/formats/enfusion-text.ts`)

- **Status**: ✓ Unchanged
- **Role**: Converts entity tree to .et file format
- **Interaction**: `generatePrefab()` creates node tree → serializer outputs it
- **Benefit**: Recipe system decoupled from serialization format

### Workbench Live Tools (`src/tools/wb-*.ts`)

- **Status**: ✓ Independent, unchanged
- **Role**: Live editing, entity manipulation in Workbench UI
- **Interaction**: Recipes generate starting points; Workbench refines them
- **Benefit**: Recipe system handles creation; Workbench handles iteration

### Pattern Library (`src/patterns/loader.ts`)

- **Status**: ✓ Unchanged, orthogonal
- **Role**: Mod scaffolding (factions, game modes, etc.)
- **Interaction**: Patterns can use recipes internally for smart scaffolding
- **Benefit**: Patterns get richer prefab templates

### Script Generator (`src/tools/script-create.ts`)

- **Status**: ✓ Unchanged
- **Interaction**: Scripts pair with recipe-generated prefabs
- **Benefit**: Scripts + recipes are complementary

### Mod Tool (`src/tools/mod.ts`)

- **Status**: ✓ Unchanged
- **Interaction**: Mod scaffolding can include recipe-based templates
- **Benefit**: New mods start with intelligent prefab structure

---

## Key Design Decisions

### 1. JSON Recipes (Not TypeScript)

✓ Editable without code rebuild
✓ Centralized, auditable data
✓ Extensible by users/automation
✗ Runtime validation needed (implemented)

### 2. Thin Recipes (Override Components Only)

✓ Point to correct parent; ancestry resolver fills in inherited components
✓ No duplication of parent components
✓ Parent updates automatically reflected
✓ Smaller data (514 lines vs. thousands)
✗ Requires working ancestry resolver (acceptable dependency)

### 3. Override Components with Placeholders

✓ Users know exactly what to customize
✓ Guidance comments ("Path to your .xob model")
✓ Reduces cognitive load
✗ Empty string values don't cover all customization points

### 4. Variant System

✓ Specializations (handgun, rifle) → different parents + subdirectories
✓ Variant-specific checklists
✓ Extensible without code changes
✗ Slight loader complexity

### 5. Post-Creation Checklists

✓ Clear, actionable guidance in tool response
✓ Variant-specific (launcher checklist ≠ handgun checklist)
✓ Reduces "What do I do next?" questions
✗ Checklists can drift as game evolves

---

## Testing & Validation

### Test Coverage

- **17 prefab tests passing** (including all new recipe types)
- **136+ template tests passing** (no regressions)
- Tests cover:
  - All 12 recipe types with correct entity types
  - Variant-specific subdirectories
  - Component merging (ancestry + overrides)
  - Custom component addition

### Validation

- ✓ TypeScript compiles without errors
- ✓ Recipe schema validated at load time
- ✓ Ancestry resolution tested with real component chains
- ✓ All tool entry points tested

---

## Known Limitations

1. **Recipe paths assume standard game structure** — Base game parent paths are hardcoded
2. **No dynamic parent discovery** — Recipes don't auto-detect new parents in mods
3. **Placeholder values are empty** — Users must manually fill in model/sound paths
4. **Checklists require manual updates** — Can drift as game evolves

---

## Future Enhancements

1. **Recipe verification tool** — Validate parent paths at startup
2. **Dynamic parent discovery** — Asset search suggests available parents
3. **Smart placeholder population** — Auto-suggest model/sound paths
4. **Version-tagged recipes** — Track game version compatibility
5. **Custom recipes in mods** — Users define recipes in mod directories
6. **Recipe inheritance** — "special_rifle" extends "rifle"
7. **Batch recipe creation** — Create multiple variants at once

---

## Usage Examples

### Example 1: Create Handgun

```
> prefab create(name=MyM9Pistol, prefabType=firearm, variant=handgun)

✓ Prefab created: Prefabs/Weapons/Handguns/MyM9Pistol.et
Type: firearm (variant: handgun)
Ancestry: 2 levels, 25 inherited components

Required follow-up:
[ ] Set MeshObject.Object to your weapon model path (.xob)
[ ] Configure WeaponSoundComponent with fire/reload sound files
[ ] Set up fire modes in MuzzleComponent
[ ] Configure SightsComponent ADS camera (PivotID: "eye")
[ ] Verify magazine/ammo compatibility in WeaponComponent properties
```

### Example 2: Create APC Vehicle

```
> prefab create(name=CustomAPC, prefabType=ground_vehicle, variant=apc)

✓ Prefab created: Prefabs/Vehicles/APCs/CustomAPC.et
Type: ground_vehicle (variant: apc)
Ancestry: 3 levels, 35+ inherited components

Required follow-up:
[ ] Set up 4-6 wheels with heavy suspension
[ ] Configure armor plating and protection values
[ ] Set up weapon mounts (machine guns, cannons)
[ ] Define seating: 2-12 passengers + gunners
[ ] Configure viewports/periscopes for occupants
```

### Example 3: Create Building

```
> prefab create(name=Warehouse, prefabType=building)

✓ Prefab created: Prefabs/Structures/Warehouse.et
Type: building

Required follow-up:
[ ] Set MeshObject.Object to building model
[ ] Configure destruction stages and models
[ ] Set up armor/structural integrity values
[ ] Define spawn points or interior waypoints if applicable
[ ] Configure ambient effects (fire, smoke) on destruction
[ ] Set up cover points for AI if tactical building
[ ] Test destruction physics and debris
```

---

## System Statistics

| Component               | Type           | Size            | Purpose                      |
| ----------------------- | -------------- | --------------- | ---------------------------- |
| recipe.ts               | Schema         | 55 lines        | TypeScript interfaces        |
| recipe-loader.ts        | Implementation | 182 lines       | Loading, validation, caching |
| 12 recipe files         | Data           | 514 lines       | Category definitions         |
| prefab.ts (template)    | Updated        | 142 lines       | Generation logic             |
| prefab.ts (tool)        | Updated        | 332 lines       | MCP interface                |
| **Total Recipe System** | **All**        | **1,225 lines** | Complete system              |

---

## Conclusion

The recipe system provides **intelligent, guided prefab creation** across 12 categories with optional variants. Key achievements:

- ✓ **Reduced cognitive load**: "Create a handgun" → prefab with correct parent + inherited components
- ✓ **Correct base game references**: Each recipe points to actual base game parent
- ✓ **Automatic inheritance**: Ancestry resolver pulls in 20+ components automatically
- ✓ **Clear guidance**: Post-creation checklists tell users exactly what to configure
- ✓ **Maintainable**: Recipes are JSON, not TypeScript — can be extended without rebuilding
- ✓ **Tested**: 17 new tests passing, no regressions
- ✓ **Integrated**: Works seamlessly with ancestry resolver, Workbench, patterns, scripts

The system is **production-ready** and sets the foundation for future enhancements like dynamic parent discovery, user-defined recipes, and recipe inheritance.
