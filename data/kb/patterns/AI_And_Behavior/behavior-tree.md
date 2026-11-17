# Behavior Tree (AI)

---

## Overview

- Behavior Trees (BTs) drive AI logic in Arma Reforger.
- BTs return **Success**, **Failure**, or **Running** per node. Failure is not an error — it means `false`.
- Running propagates to Root, making the whole tree state "Running".
- Unlike FSMs, BTs can run multiple branches simultaneously (via Parallel node).

**File format:** `.bt` — assigned to `AIControlComponent.OverrideAIBehaviorData`.

---

## Editor UI

| Panel           | Purpose                     |
| --------------- | --------------------------- |
| Node area       | Main graph canvas           |
| Nodes palette   | Drag nodes from here        |
| Node parameters | Properties of selected node |
| Variables       | Create/manage BT variables  |
| Debug           | Runtime read-only view      |

**Shortcuts:**

| Key                        | Action                               |
| -------------------------- | ------------------------------------ |
| F9                         | Toggle breakpoint                    |
| Ctrl+O/S/Shift+S           | Open / Save / Save As                |
| Ctrl+C/X/V                 | Copy / Cut / Paste                   |
| Del                        | Delete node, variable, or connection |
| Hold MMB                   | Pan                                  |
| LMB drag (black bar)       | Connect nodes                        |
| Shift+LMB drag             | Multi-select                         |
| Double-click scripted node | Open script                          |

---

## In-Game Setup for Testing

1. Place `ChimeraCharacterAI` (has `AIControlComponent`, `AICharacterAimingComponent`, `AICharacterMovementComponent`, `PerceptionComponent`).
2. In `AIControlComponent`: set `OverrideAIBehaviorData` to your `.bt` file; tick "Enable AI".
3. Run game with BT Editor open → click soldier in right panel debug list.

**Pitfall:** BT variable outputs cannot connect directly to task inputs — store in a typed variable first.

---

## Debug Colors

| Color    | Meaning                       |
| -------- | ----------------------------- |
| Green    | Success (variable assigned)   |
| Red      | Failure (variable unassigned) |
| Blue     | Running                       |
| Dark red | Suspended at breakpoint       |

Breakpoints stop BT execution on that node but game continues running.

---

## Flow Nodes

| Node             | Description                                         | Notes                                                                  |
| ---------------- | --------------------------------------------------- | ---------------------------------------------------------------------- |
| `Root`           | Entry point                                         | Cannot be removed                                                      |
| `Selector`       | OR logic — executes until one child returns Success | —                                                                      |
| `Sequence`       | AND logic — executes while children return Success  | —                                                                      |
| `Parallel`       | Executes all children simultaneously                | `Use Child Result`: which child's result to return                     |
| `Repeater`       | Sequence repeated N times                           | `Repeat Times` (default 1)                                             |
| `Run BT`         | Runs another BT on agent                            | `Behavior Tree`, `Run Repeatedly`, `InBehaviorTree` input              |
| `Run Once`       | Executes once on init                               | Always returns Success                                                 |
| `Run On Entity`  | Executes children on a different entity             | Input: Entity                                                          |
| `Switch`         | Picks child by variable value or random             | `Values Array`, `Random Range`, `Abort Variable Changed`, `InVariable` |
| `For Each Child` | Iterates AI group children                          | `Index from/to`, `Return controlled entity`; Output: Entity            |

---

## Decorators

Conditional wrappers — evaluate a test, optionally execute child. All share:

- `Negative result` — invert
- `Use child result` — run child and return its result
- `Always true` — always run child and return true
- `Abort type`: None / Abort Children Branch / Abort Parent Node With Children / Abort Parent Node Further Children

**Abort type detail:**

- **Abort Children Branch** — re-evaluates each tick; if condition becomes false, aborts children.
- **Abort Parent Node Further Children** — if condition becomes true, aborts siblings to the right.
- **Combined** — both behaviors active.
- If no AbortType: evaluated only once per tree execution.

| Decorator                 | Tests                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------ |
| `Decorator`               | Generic conditional                                                                  |
| `Test Variable`           | Assigned / Equals / Bigger than / Lower than / Was changed; Input: Variable          |
| `Test Entity`             | Entity validity, life state; Input: Entity                                           |
| `Test Distance to Entity` | Distance smaller than threshold; Params: Entity name, Distance threshold             |
| `Danger Event`            | Has danger events (projectile, death nearby); Params: Has Any, Danger type, Distance |
| `Test Order`              | Has order or specific order type; Params: Has Any, Order Type                        |
| `Aiming`                  | Is aimed / Is aiming in limits; Param: Aim Threshold                                 |
| `Scripted Decorator`      | Base class for custom script decorators                                              |

---

## Task Nodes

**Key rule:** Async tasks that return `Running` must override `CanReturnRunning()` → return `true`.

### General Tasks

| Task                        | Description                                    | Key Params/I/O                                                                                                           |
| --------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `Get Controlled Entity`     | Gets character entity from agent               | `Character Only`; Output: Entity                                                                                         |
| `Create Position`           | Creates world position (optionally randomised) | Entity name, Offset, Random Offset Multiplier; Output: Position                                                          |
| `Move`                      | Move to static position                        | Target location, Precision XZ/Y, Target rotation, Time to complete (-1=unlimited), Enable avoidance                      |
| `Move to Entity`            | Move to entity (dynamically updated)           | Precision XZ, Entity update precision; Input: Entity                                                                     |
| `Aim`                       | Aim at entity/position/direction               | Precision XZ/Y; Inputs: Direction, Position, Entity                                                                      |
| `Stop`                      | Cancel movement/aiming                         | `Stop flags` (Movements, Aiming)                                                                                         |
| `Idle`                      | Wait N seconds                                 | `Period`, `Period random`; Input: Period key                                                                             |
| `Orient`                    | Change orientation                             | Rotation precision; Input: Target location                                                                               |
| `Set Movement Speed`        | Change movement speed                          | Speed (m/s)                                                                                                              |
| `Enable Obstacle Avoidance` | Toggle avoidance                               | Input: Obstacle avoidance bool                                                                                           |
| `Get Aiming Position`       | Target position with lead                      | Lead movement time; Input: Entity; Output: Position                                                                      |
| `Get in Vehicle`            | Enter vehicle                                  | Position (Pilot/Gunner/Turret/Cargo), Vehicle Name; Input: Vehicle                                                       |
| `Get Out Vehicle`           | Exit vehicle                                   | —                                                                                                                        |
| `Land`                      | Aircraft landing                               | Target location, Precision, Time to complete                                                                             |
| `Follow Path`               | Follow waypath                                 | Params: Path points; Input: Target Location                                                                              |
| `Send Order`                | Add order to entity queue                      | Order type (None/Hold/Move/Follow/Rearm/Defend/Get In), Priority; Inputs: Sender, Receiver, Position, Entity, Order type |
| `Current Order`             | Get current order                              | Outputs: Order object, Position, Type                                                                                    |
| `Finish Order`              | Finish current order                           | —                                                                                                                        |

### Utility Tasks

| Task                 | Description                                               |
| -------------------- | --------------------------------------------------------- |
| `Set/Clear Variable` | Set value or deassign variable                            |
| `Find Entity`        | Find by entity name or class name; optional Distance test |

### Character Tasks (character-only)

| Task                           | Description                               | Params                                                       |
| ------------------------------ | ----------------------------------------- | ------------------------------------------------------------ |
| `Fire`                         | Request fire action                       | —                                                            |
| `Change Stance`                | Change stance                             | Prone/Crouch/Stand                                           |
| `Character Raise Weapon`       | Raise/lower weapon                        | True/False                                                   |
| `Character Set Movement Speed` | Set movement type                         | Idle/Walk/Run/Sprint                                         |
| `Play Gesture`                 | Play gesture animation                    | Greeting, Point, Thumb up/down, Silence, Middle finger, etc. |
| `Perform Object Action`        | Perform action on object (open door etc.) | Input: Action Entity                                         |

### Perception Tasks

| Task          | Description                                            |
| ------------- | ------------------------------------------------------ |
| `Pick Target` | Pick one target from known target list; Output: Entity |

### Smart Action Tasks

| Task                       | Description                               |
| -------------------------- | ----------------------------------------- |
| `Perform Smart Action`     | Perform smart action; Input: Smart action |
| `Find Smart Action`        | Find by radius/tags; Output: Smart action |
| `Get Current Smart Action` | Output: Smart action                      |
| `Get Smart Action Pos`     | Output: Action position                   |
| `Get Smart Action BT`      | Output: Behavior tree                     |

### Waypoint Tasks

| Task           | Description                                                                           |
| -------------- | ------------------------------------------------------------------------------------- |
| `Get Waypoint` | Get waypoint by index; Outputs: Waypoint, Behavior, Contact behavior, Danger behavior |

---

## AI Debug Panel

**Requires:** `-scrDefine AI_DEBUG` startup parameter.

**Access:** Select character/group in Game Master → Diag Menu → AI → AI Script → Open Debug Panel.

**Shows per group/character:** Call sign, Current action, Available actions + priority, Threat level, Unit roles, Unit states.

**Buttons:** Dump Debug Msgs (with time interval), Breakpoint (Script Editor break on next AI update), Locate (character only).

**Custom debug:** mod `SCR_AIAgentDebugPanel`.

---

## BaseContainer (AI Config System)

`BaseContainer` holds data for prefabs, configs, entity sources, component sources, UI sources.

```
// Create
Resource resource = BaseContainerTools.CreateContainer("GenericEntity");
BaseContainer bc = resource.GetResource().ToBaseContainer();

// Read
int value;
bc.Get("m_iValue", value);

// Write
bc.Set("m_iValue", 42); // property must already exist

// Save
BaseContainerTools.SaveContainer(bc, resourceName);
BaseContainerTools.SaveContainer(bc, ResourceName.Empty, absolutePath);
```

**IEntitySource (World Editor plugins):**

```c
entitySource = worldEditorAPI.CreateEntity(prefab, "", worldEditorAPI.GetRootEntity(), null, null);
entitySource = worldEditorAPI.EntityToSource(entity);

// Set variable
worldEditorAPI.SetVariableValue(entitySource, null, "m_iValue", "42");

// Nested path
array<ref ContainerIdPathEntry> path = { new ContainerIdPathEntry("m_SubObject") };
worldEditorAPI.SetVariableValue(entitySource, path, "m_iValue", "42");

// Component
array<ref ContainerIdPathEntry> path = { new ContainerIdPathEntry("Components", compIdx) };
worldEditorAPI.SetVariableValue(entitySource, path, "m_iValue", "42");
```

**Critical:** `IEntitySource` must be edited via `WorldEditorAPI`. Direct BaseContainer edits only change memory — not persisted to disk.

**Pitfall:** `BaseContainer` cannot be strongly `ref`-referenced in script.

---

## The behavior_tree tool (offline .bt reader, checker, writer and diff)

The Behavior Editor's script API (`BehaviorEditor: WBModuleDef`) opens and saves a resource and nothing else: no script call reads or changes a node. The `behavior_tree` tool works on the `.bt` file instead. Every check is offline, against the shape of the vanilla trees: the engine has the last word, so open the tree in the Behavior Editor (or run it) to confirm it loads.

**Actions:**

- `inspect`: Outline: node paths, properties, variables and port wiring. `path` = a file, a path under the project, or a game resource path such as `AI/BehaviorTrees/Chimera/Soldier/Soldier.bt` (read from the paks).
- `validate`: Structure (one RootNode with one child), variable and port indexes, child counts, RunBT targets, node and TEST classes against the catalog, properties and ports no vanilla node of that class carries.
- `nodes`: The catalog: every `Node` descendant and every `BaseDecoratorTest` descendant of the build's source index (401 and 38 at 1.9.0.37), with what the vanilla trees do with each (properties with samples, variable properties, ports, child counts, TEST classes) and what the index says (parent, family, declaring file, `[Attribute]` fields). Give `type` for one class in full, or `query` for a substring.
- `create`: A new tree from `spec`, laid out for the canvas, written under the project (`overwrite` to replace, `dry_run` to see the text).
- `edit`: `ops` on an existing project tree, all or nothing; a file with comments or a hand layout is left alone.
- `diff`: `path` (before) against `other` (after), node by node: added, removed, moved, changed params; variables and the header too. Paged with `cursor` and `limit`.

**Spec (create):**

- `spec = {path, guid?, variables?: [{name, type, flag?: input|output, desc?}], root: node}`
- `node = {type, name?, props?, vars?: {InVariable: varName}, in?: {PortName: varName}, out?, tests?, children?}`
- `root` is the single child of the RootNode, which the writer makes.
- A property value is a string, number, boolean, a list of those, or `{value, quoted}`; without `quoted` the writer quotes as vanilla does for that class and key.

**Ops (edit):**

- `set_property {node, key, value}` and `remove_property {node, key}`
- `rename_node {node, name}`
- `add_node {parent, index?, node}`, `remove_node {node}`, `move_node {node, parent, index?}`
- `add_variable {variable}`
- `connect {node, port, variable|null}` (null disconnects)

A node is addressed by its path from `inspect` (`"root"`, `"0"`, `"0/2"`: child indexes from the RootNode) or by a unique name. Children run left to right.

**Diff matching.** A `.bt` node has no id, so the diff matches nodes by class and name where that pair is unique, then by class and name among the children of matched parents, then by the same path and class (a renamed node), then by what is left in tree order. A class change reads as a removal plus an addition. A node has moved when its parent changed or its order among matched siblings changed; an insertion does not mark its siblings as moved. Canvas positions (`EditorPos`) and groups are not compared.

**After a write.** The Workbench registers a new file (and writes its `.meta`) when it next scans the project. An open Behavior Editor tab keeps its own copy: reopen the tree there, and do not save the old tab over the file.

**Catalog upkeep.** `scripts/gen-bt-catalog.ts` rebuilds `data/behavior-tree/catalog.json` from the build's source index (census E02) and the game's vanilla trees, and fails when a class a vanilla tree uses is missing from the index's list.
