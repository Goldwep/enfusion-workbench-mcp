# L7 execution plan — EMCP handler architecture + 9 live tools

**Status (start of L7):** 97 tools shipped, L1–L6 complete + audited. L7 is the largest remaining lift (~2 sessions). This document is the next-session opening read.

## L7-1 EMCP handler consolidation pattern (foundation, must land first)

Existing `mod/Scripts/WorkbenchGame/EnfusionMCP/` has per-action `.c` handler files. The L7 plan consolidates to **one handler per domain with an `action` dispatch field**. Hard cap: ≤15 handler files at v1.0.0.

**Domains for L7:**
- `EMCP_WB_Terrain.c` — heightmap / road / river / water / navmesh actions
- `EMCP_WB_Character.c` — character inspect (CharacterAnimationComponent details)
- `EMCP_WB_Job.c` — long-running task host (drives JobStore from Enforce side)

**Handler skeleton (consume from existing JsonApiStruct pattern in upstream):**
```enforce
class EMCP_WB_TerrainRequest : JsonApiStruct
{
    string action;       // "inspect" | "navmesh_status" | "navmesh_bake" |
                         // "export_heightmap" | "road_export_graph" |
                         // "road_validate" | "river_export" |
                         // "water_surface_query" | "save_world_as"
    string world_path;   // for actions that scope to a world
    // ... per-action fields packed into the JsonApi shape
}

class EMCP_WB_TerrainResponse : JsonApiStruct
{
    string status;       // "ok" | "error" | "pending"
    string job_id;       // set when async (navmesh_bake etc)
    string payload;      // JSON-encoded action-specific data
    string error;
}

[WorkbenchPluginAttribute(name: "EMCP_WB_Terrain", wbModules: { "WorldEditor" })]
class EMCP_WB_Terrain : WorkbenchPlugin
{
    void EMCP_WB_Terrain() {
        // Register the JsonApi handler.
    }
    
    void Handle(EMCP_WB_TerrainRequest req, out EMCP_WB_TerrainResponse resp) {
        switch (req.action) {
        case "inspect":          DispatchInspect(req, resp);          break;
        case "navmesh_status":   DispatchNavmeshStatus(req, resp);    break;
        case "navmesh_bake":     DispatchNavmeshBake(req, resp);      break;
        case "export_heightmap": DispatchExportHeightmap(req, resp);  break;
        case "road_export_graph": DispatchRoadExportGraph(req, resp); break;
        // ...
        default: resp.status = "error"; resp.error = "unknown action"; break;
        }
    }
}
```

**Per-action dispatch methods** call into the documented Workbench APIs (per DOMAIN-MAP §4):
- `inspect` → `GenericTerrainEntity.GetTileNumber/GetTileTextureResName` + `RoadNetworkManager.GetRoadsInAABB`
- `navmesh_status` → `NavmeshWorldComponent.IsTileLoaded/Valid/Requested` over a grid
- `navmesh_bake` → `Workbench.OpenModule(NavmeshGeneratorMain)` → `ExecuteAction(menuPath)` → `Save()` (long-running → spawn into EMCP_WB_Job)
- `export_heightmap` → try `ExportTerrainRequest` JsonApi first, fall back to grid-sample via `TryGetHeightTC`
- `road_export_graph` → `RoadNetworkManager.GetRoadsInAABB` → per-road `GetPoints + GetWidth`
- `river_export` → enumerate `RiverEntity`, call `GetCentralPolyline`
- `water_surface_query` → `ChimeraWorldUtils.TryGetWaterSurface`
- `save_world_as` → `GameWorldEditor.SaveWorldAs`

## L7-2 Long-running task pattern wired through JobStore

`EMCP_WB_Job.c` becomes the Enforce-side counterpart to `src/runtime/job.ts`:

```enforce
class EMCP_WB_JobRequest : JsonApiStruct {
    string action;   // "spawn" | "status" | "cancel" | "list"
    string job_id;
    string kind;     // "navmesh-bake" | "build-data" | "publish"
    string payload;  // JSON-encoded sub-request
}
```

Node-side: a new `src/workbench/job-client.ts` wraps the JsonApi handshake. Each long-running tool spawns a job via the Enforce side, polls status, surfaces log lines as they arrive in the response payload.

## L7-3 First live tool — `terrain_inspect` (verification probe)

Node-side tool ships now (`src/tools/terrain-inspect.ts` placeholder below); EMCP_WB_Terrain.c handler ships next session as the load-bearing artifact. The tool returns a clear "EMCP handler not deployed" error until then — gives a real signal to verify the architecture E2E.

## L7-4..9 Remaining tools (squad-delegate next session)

After EMCP_WB_Terrain handler ships, each of these is a thin Node-side tool wrapping a `client.call("EMCP_WB_Terrain", { action: "...", ... })`:

| Tool | Action |
|---|---|
| `terrain_inspect` | `inspect` |
| `terrain_navmesh_status` | `navmesh_status` |
| `terrain_navmesh_bake` | `navmesh_bake` (async, JobStore) |
| `terrain_export_heightmap` | `export_heightmap` (try-bulk then fallback) |
| `terrain_road_export_graph` | `road_export_graph` |
| `terrain_road_validate` | `road_validate` (pure JS over road graph) |
| `terrain_river_export` | `river_export` |
| `terrain_water_surface_query` | `water_surface_query` |
| `terrain_save_world_as` | `save_world_as` |
| `character_inspect` | (EMCP_WB_Character.c) `inspect` |

## L7→L8 audit gate

After L7 ships, run the standard 3-agent audit team on:
- `mod/Scripts/WorkbenchGame/EnfusionMCP/EMCP_WB_*.c` (new Enforce Script handlers)
- `src/tools/terrain-*.ts` + `character-inspect.ts`
- `src/workbench/job-client.ts`

Apply the L4 + L6 deferred fixes (C-1 atomicCommit, A1 parser-cache, S1 path-guard) here as well — by L7 they'll have compounded across enough surface to justify the cleanup.

## Critical-path note

**L7 cannot ship without functional EMCP_WB_*.c handlers.** Writing them requires the Workbench actually running to test. The Node-side tool placeholders can land now (they degrade gracefully when handler is absent), but the user-facing value of L7 is gated on the handler-deployment step.
