# EnfusionMCP — NET API Handlers

Patterns for extending the EnfusionMCP Workbench bridge with custom NetApiHandler scripts.

---

## Handler Script Location and Compilation

- Handler scripts live in `Scripts/WorkbenchGame/EnfusionMCP/` inside the mod being tested.
- They are **injected by wb_launch** (copied from the npm package) and must be present at Workbench startup.
- **Hot reload does NOT work** for NetApiHandler subclasses — only full Workbench restart picks up changes.
- After editing a handler `.c` file, close Workbench, then call `wb_launch` again.

---

## NetApiHandler Skeleton

```c
class EMCP_WB_MyHandlerRequest : JsonApiStruct
{
    string param1;
    string param2;

    void EMCP_WB_MyHandlerRequest()
    {
        RegV("param1");
        RegV("param2");
    }
}

class EMCP_WB_MyHandlerResponse : JsonApiStruct
{
    string status;
    string message;

    void EMCP_WB_MyHandlerResponse()
    {
        RegV("status");
        RegV("message");
    }
}

class EMCP_WB_MyHandler : NetApiHandler
{
    override JsonApiStruct GetRequest()
    {
        return new EMCP_WB_MyHandlerRequest();
    }

    override JsonApiStruct GetResponse(JsonApiStruct request)
    {
        EMCP_WB_MyHandlerRequest req = EMCP_WB_MyHandlerRequest.Cast(request);
        EMCP_WB_MyHandlerResponse resp = new EMCP_WB_MyHandlerResponse();
        // ... logic ...
        resp.status = "ok";
        resp.message = "done";
        return resp;
    }
}
```

---

## WorldEditorAPI — SetVariableValue

```c
// Correct: pass IEntitySource directly
bool result = api.SetVariableValue(entSrc, pathEntries, propertyKey, value);

// WRONG: do NOT pass entSrc.ToBaseContainer() — SetVariableValue expects IEntitySource
```

For component properties, build the path with `ContainerIdPathEntry`:

```c
array<ref ContainerIdPathEntry> pathEntries = {};
array<string> pathParts = {};
propertyPath.Split(".", pathParts, true); // propertyPath = "SCR_SomeComponent"
for (int p = 0; p < pathParts.Count(); p++)
    pathEntries.Insert(new ContainerIdPathEntry(pathParts[p]));

api.SetVariableValue(entSrc, pathEntries, propertyKey, value);
```

For entity-level properties (`coords`, `angles` — each a single "x y z" vector; there are no angleX/angleY/angleZ keys) pass `null` for pathEntries:

```c
api.SetVariableValue(entSrc, null, "coords", "100 0 200");
```

---

## WorldEditorAPI — Reading Properties

`WorldEditorAPI` does NOT have `GetVariableValue` (confirmed via API search — upstream v0.6.0 mistakenly used it and it will crash). Use `IEntityComponentSource.Get()`:

```c
// Navigate to component by class name
IEntityComponentSource compSrc = null;
int compCount = entSrc.GetComponentCount();
for (int ci = 0; ci < compCount; ci++)
{
    IEntityComponentSource c = entSrc.GetComponent(ci);
    if (c && c.GetClassName() == componentClassName)
    {
        compSrc = c;
        break;
    }
}

// Read a property value
string val;
if (compSrc)
    compSrc.Get(propertyKey, val);
else
    entSrc.Get(propertyKey, val); // entity-level property
```

---

## Listing Properties

```c
// Entity-level
int numVars = entSrc.GetNumVars();
for (int v = 0; v < numVars; v++)
    Print(entSrc.GetVarName(v));

// Component-level
int numVars = compSrc.GetNumVars();
for (int v = 0; v < numVars; v++)
    Print(compSrc.GetVarName(v));
```

---

## EnfusionMCP.gproj GUID

The EnfusionMCP project GUID must be valid hex: `454E465553494D435000`
(The original broken value `454E46555349ON4D4350` contained non-hex "ON" — caused dependency errors.)

---

## wb_launch — Game Directory Resolution

`findGameDir()` in `client.js` checks `ENFUSION_GAME_PATH` env var first (set in `claude_desktop_config.json`, read by both Claude Desktop and Claude Code VS Code extension). If not set, walks up two directory levels from `workbenchPath` and tries `Arma Reforger` / `ArmaReforger` sibling folders.

---

## MCP Tool Fixes for wb_entity_modify

In `wb-entities.js` (npm package dist), `getProperty` and `listProperties` must be added to the action enum and `value` made optional:

```js
action: z.enum([
  "move",
  "rotate",
  "rename",
  "reparent",
  "setProperty",
  "clearProperty",
  "getProperty",
  "listProperties",
]);
value: z.string().optional().default("");
```

---

## WorldEditorAPI — Array-of-Objects Properties

Use `GetObjectArray(key)` to read, and `CreateObjectArrayVariableMember` / `RemoveObjectArrayVariableMember` to modify.

### Reading array contents

```c
// On component source — returns BaseContainerList
BaseContainerList itemList = compSrc.GetObjectArray(propertyKey);
// On entity source
BaseContainerList itemList = entSrc.GetObjectArray(propertyKey);

int count = itemList.Count();
for (int i = 0; i < count; i++)
{
    BaseContainer item = itemList.Get(i);
    string className = item.GetClassName();
}
```

Note: `compSrc.Get(key, out BaseContainerList)` does NOT work for arrays — use `GetObjectArray()`.

### CRITICAL: topLevel must be the component, not the entity

`CreateObjectArrayVariableMember` and `RemoveObjectArrayVariableMember` take a `BaseContainer topLevel`. When the array is on a component, pass the **component source** as `topLevel` with `null` path — NOT the entity with the component name as a path entry:

```c
// CORRECT — component as topLevel, null path
IEntityComponentSource compSrc = ...; // find by class name
api.RemoveObjectArrayVariableMember(compSrc, null, "Slots", 2);

// WRONG — entity as topLevel with component name as path entry
array<ref ContainerIdPathEntry> path = { new ContainerIdPathEntry("SlotManagerComponent") };
api.RemoveObjectArrayVariableMember(entSrc, path, "Slots", 2); // returns false
```

### Adding an item

```c
api.BeginEntityAction("Add array item");
api.CreateObjectArrayVariableMember(compSrc, null, "m_aTriggerActions", "SCR_ScenarioFrameworkActionSpawnObjects", -1); // -1 = append
api.EndEntityAction();
```

### Removing an item (array shifts after each removal — always remove same index)

```c
api.BeginEntityAction("Remove array item");
api.RemoveObjectArrayVariableMember(compSrc, null, "Slots", 2);
api.EndEntityAction();
```

---

## setProperty / clearProperty — No BeginEntityAction

Wrapping `SetVariableValue` / `ClearVariableValue` in `BeginEntityAction` / `EndEntityAction` causes a **crash** when setting enum properties. Call them without the action wrapper:

```c
// CORRECT
bool result = api.SetVariableValue(entSrc, pathEntries, propertyKey, value);

// CRASHES on enum properties
api.BeginEntityAction("...");
api.SetVariableValue(entSrc, pathEntries, propertyKey, value);
api.EndEntityAction();
```

---

## installHandlerScripts — Always Overwrite

The original implementation skips copying if `EMCP_WB_Ping.c` already exists. In the fork, the skip check is removed so scripts are always overwritten on `wb_launch`. This ensures the latest handler code is always injected.

---

## wb_launch — Handler Scripts Not Installed When Workbench Already Running

**Bug (fixed in fork):** `wb_launch` calls `client.ping()` first. If Workbench is already running, it returned early without installing handler scripts. Result: `wb_connect` succeeds but all `EMCP_WB_*` handler calls return "Undefined API func".

**Fix in `dist/tools/wb-launch.js`:** When `alreadyRunning && gprojPath`, call `client.installHandlerScripts(dirname(gprojPath))` before returning. Then tell user to reload scripts in Workbench.

**Workflow when Workbench is already open:**

1. Call `wb_launch` with `gprojPath` — installs handler scripts to mod's `Scripts/WorkbenchGame/EnfusionMCP/`
2. In Workbench: reload the scripts (see "Reloading Scripts" below; the shipped wiki does not document a Reload Scripts entry under a Tools menu)
3. `wb_connect` will then fully work

**Reloading Scripts — what is known, what is not:**

- Shipped wiki (Resource Manager, Script Editor Plugin and Workbench plugin tutorials): `Plugins > Settings > Reload WB Scripts` reloads the Workbench plugin scripts (the `WorkbenchGame` handlers live there). In the World Editor the wiki names `Reload Game Scripts` (`Ctrl+R`) for game scripts, and the Script Editor `Build` menu for `Compile and Reload Scripts` (`Shift+F7`) and `Validate Scripts`.
- Menu labels found as strings in the 1.8.0.13 Workbench executable: `&Reload WB Scripts`, `&Reload Scripts`, `&Validate and Reload Scripts`, `Reload Game Scripts`, `Reload Workbench Scripts`. The string `Compile and Reload Scripts` is not in the executable, so that wiki label may be out of date for this build.
- **Not verified live:** which menu each label sits under in 1.8.0.13, and the exact path array that `WBModuleDef.ExecuteAction` accepts for a reload. Do not rely on a menu path; confirm in the running Workbench.
- The NET API also has a native `ReloadScripts` function (shipped `NetApiDocs.c`: no payload, error code `Ok` on success or `Compilation failed`). Whether it recompiles the `WorkbenchGame` handler scripts is not verified live.

**`wb_component add` adds to world instance, not prefab file.** `CreateComponent` via `WorldEditorAPI` operates on the world-placed entity. The component class must be compiled (not "Unknown") for `setProperty` to work. If it shows as "Unknown", scripts haven't compiled — reload scripts first.

---

## Animation Editor — GetModule Is Declared, Live Behaviour Unverified

`Workbench.GetModule(typename type)` returns a `WBModuleDef`. The game scripts declare 11 module types, each
`sealed class X: WBModuleDef`: `AnimEditor`, `AudioEditor`, `BehaviorEditor`, `DialogueEditor`,
`LocalizationEditor`, `NavmeshGeneratorMain`, `ParticleEditor`, `ProcAnimEditor`, `ResourceManager`,
`ScriptEditor`, `WorldEditor` (`scripts/GameLib/generated/WorkbenchAPI/Modules/`). `AnimEditor` is therefore a
module type that can be passed to `GetModule` (`sealed class AnimEditor: WBModuleDef {}`, no members of its own).
An earlier version of this note said the Animation Editor cannot be reached through `GetModule`; the source does not support that.

**Not verified live:** whether `Workbench.GetModule(AnimEditor)` returns a non-null handle while an animation
workspace is open, and what the inherited `WBModuleDef` methods (`SetOpenedResource`, `ExecuteAction`, ...) do on it.
No shipped script calls `GetModule(AnimEditor)` (the shipped calls use `WorldEditor`, `ResourceManager`,
`ScriptEditor` and `LocalizationEditor`), so there is no first-party example either way. Test it in a running
Workbench before building on it.

Modules this server's handlers use (confirmed via Bohemia samples + EnfusionMCP handlers):

- `WorldEditor` — world scene editing
- `ScriptEditor` — script file editing
- `LocalizationEditor` — string tables
- `ResourceManager` — resource registration/reload

**For animation graph work:** Use file-based tools (`animation_graph_inspect`, `animation_graph_author`,
`animation_graph_setup` in the enfusion-mcp-BK fork) — these read/write AGR/AGF/AST/ASI directly
without needing Workbench. Then call `ResourceManager` reload to pick up changes.

**When working with animation files via MCP tools:** Ask the user for the path to their animations
folder within the current project (e.g. `Fire system/Anims/napalm/New Folder/`) since there is no
way to query which animation workspace is currently open in the editor.

---

## Claude Code MCP Config

Claude Code uses `~/.claude.json` (not `claude_desktop_config.json`). To point at the local fork:

```bash
claude mcp remove enfusion-mcp
claude mcp add --scope user enfusion-mcp -- node /path/to/enfusion-mcp-BK/dist/index.js
```

Requires Claude Code restart to pick up new tool schemas.

---

## Using Base Game Prefabs

**Never use `wb_open_resource` on a `.et` file when a world is open** — it switches Workbench to prefab edit mode and closes the world.

**DO NOT file-copy prefabs from the extracted library into your mod folder without registering.**
File-copied prefabs have no GUID registered in Workbench's resource DB → `{0000000000000000}` errors at runtime → slot fails to spawn.

**Correct MCP workflow (game_duplicate tool — confirmed working):**

1. Read the loose `.et` from `ENFUSION_GAME_PATH/addons/data/DataXXX/` (files are unpacked on disk, no pak needed)
2. Write copy to mod folder
3. Call `ResourceManager.RegisterResourceFile(absPath, false)` → Workbench creates a `.meta` file with a new GUID
4. Reference the duplicate using the GUID from the `.meta` file: `{METAGUID}Prefabs/path/to/copy.et`

Key: the GUID that matters is in the `.meta` file (`Name "{GUID}path"`), NOT the `ID` field inside the `.et`.
`CreateEntityTemplate` on a placed scene entity produces a thin scene override — do NOT use it for duplication.

**Manual Workbench workflow:**

1. Use `E:\Arma reforger data\extracted_files\` to find the prefab path and GUID
2. In Workbench resource browser, find the base game prefab
3. **Right-click → Duplicate** into your mod's folder — Workbench assigns a proper GUID and registers it
4. Reference the duplicate by its new GUID+path

**Or, reference base game prefabs directly** (without copying) using the GUID found in the extracted library:

- Find GUID by grepping `E:\Arma reforger data\extracted_files\Configs\EntityCatalog\` for the prefab name
- Set `m_sObjectToSpawn` in UI using `{GUID}Prefabs/path/to/file.et` format
- Base game prefabs are always loaded alongside the mod, so their GUIDs resolve at runtime
