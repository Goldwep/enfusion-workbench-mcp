# TODO

## Bugs

### [BUG] `scenario_create_objective` - SlotKill ends up inside Layer_AI, not as direct LayerTask child

**Error:** `ScenarioFramework: USSR_Ambush_LayerTask could not init task due to missing m_SlotTask!`

**Root cause:** `GetSlotTask(m_aChildren)` in `SCR_ScenarioFrameworkLayerTask` only searches _direct_ children of
LayerTask for `SCR_ScenarioFrameworkSlotTask`. The slot must NOT be nested inside Layer_AI.

**Required hierarchy:**

```
Area
└── LayerTask
    ├── Slot (SlotKill / SlotClearArea / SlotDestroy)  ← direct child of LayerTask
    └── Layer_AI
        └── SlotAI
```

**Current state:** `wb-scenario.ts` reparents the slot to `layerTask` (fixed in code), but Workbench
appears to rewrite the layer file with the slot inside Layer_AI anyway — the in-memory reparent
via `EMCP_WB_ModifyEntity` may not produce the correct saved nesting.

**Investigation needed:**

- Verify whether `ParentEntity(false)` in `EMCP_WB_ModifyEntity.c` actually nests entities
  correctly in the saved `.layer` file, or whether Workbench flattens/reorders children on save.
- Consider writing the full hierarchy directly to the `.layer` file from the tool (like the
  manual fix that worked before), rather than relying on individual reparent API calls.

**Files:**

- `src/tools/wb-scenario.ts` (slot reparent order fixed, may need layer-file-write approach)
- `mod/Scripts/WorkbenchGame/EnfusionMCP/EMCP_WB_ModifyEntity.c` (reparent handler)
- Test layer: `<sample project>/worlds/unnamed_Layers/default.layer`

---

### [BUG] `m_eActivationType ON_TRIGGER_ACTIVATION` not settable via `setProperty`

Enum string values cannot be set via `SetVariableValue` — `setProperty` silently fails.
Currently must be written directly to the `.layer` file.
If the layer-file-write approach is adopted for the hierarchy fix above, this can be solved at the same time.

---

## Features / Improvements

### [FEAT] Write hierarchy directly to `.layer` file from `scenario_create_objective`

Instead of placing entities one-by-one via API and reparenting (which has nesting persistence issues),
generate the complete `.layer` file block and append/write it directly.
This would also solve the `m_eActivationType` enum issue.

### [FEAT] `scenario_create_objective` — add `m_sSpawnRadius` / spawn offset support

Allow placing SlotAI at an offset from the area center, so AI spawns slightly away from the trigger edge.

### [FEAT] Support for multiple SlotAI entities under Layer_AI

Currently only one SlotAI is placed. Allow an optional `aiSpawnCount` parameter to place N SlotAIs.
