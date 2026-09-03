# Animation tools (L8)

Three shipped animation tools plus an unshipped `project_validate scope=anim` slot. All operate on Reforger's animation file formats: `.agr` (Animation Graph Runtime), `.agf` (Animation Graph File), `.ast` (Animation State Table), `.asi` (Animation State Instance), `.aw` (Animation Workspace), `.anm` (Animation clip).

## animation_graph

The omnibus animation tool — `action` field discriminates between three modes. Scoped to **vehicles** (wheeled / tracked / helicopter / boat); character animation lives in `weapon_pose_lint` and the unshipped `project_validate scope=anim`.

### action: "author"

Generate and write `.agr` and `.ast` scaffold files for a new vehicle. Produces the boilerplate the user fills in via the AGF visual editor.

**Input:**

```json
{
  "action": "author",
  "vehicleName": "MyTruck",
  "vehicleType": "wheeled",
  "wheelCount": 4,
  "hasTurret": false,
  "hasSuspensionIK": true,
  "outputDir": "C:/.../addons/MyMod/Animation/Vehicles/MyTruck"
}
```

Validates wheel count is even (2/4/6/8).

### action: "inspect"

Read and summarize an animation graph file. Sub-action `validate` runs pitfall checks against the file structure.

**Input:**

```json
{ "action": "inspect", "file_path": "Animation/Characters/Rifleman.agr", "subAction": "validate" }
```

**Sample output (excerpt):**

```
## animation_graph inspect: Rifleman.agr

- **Format:** AGR (Animation Graph Runtime)
- **Bone count:** 142
- **GlobalTags block:** present
  - WEAPON: rifle, pistol, launcher
  - ADS: aim, hipfire
  - STANCE: stand, crouch, prone

Validation:
  ✓ GlobalTags block well-formed
  ⚠ Bone 'spine03' referenced but not defined in skeleton
```

### action: "setup"

Full guided workflow wizard — generates scaffold, AGF node graph instructions, prefab setup, and verification checklist as markdown. Designed for the LLM to walk a user through a multi-step vehicle animation setup.

**Input:**

```json
{ "action": "setup", "vehicleName": "MyTruck", "vehicleType": "wheeled", "wheelCount": 4 }
```

Returns a long-form markdown guide rather than file output. Compose with `wb_launch` + `wb_open_resource` to drive the user through the AGF visual editor in Workbench.

## animation_find_unused_clips

**Read-only.** Walk the project's `.anm` animation clip files and report any that aren't referenced by any AGF / ASI / AGR / character `.conf`. Never deletes — emits a list. Use before publishing a mod to prune dead clip assets.

**Input:**

```json
{
  "project_path": "C:/.../addons/MyMod",
  "include_workshop": false,
  "format": "markdown"
}
```

**Scope:** defaults to the user-mod project root (`config.projectPath`). Pass `include_workshop: true` to also fold workshop project roots from the ProjectIndex into the disk walk and reference scan — useful when your mod inherits from a workshop dep and you want to confirm the inherited clips are actually used.

**Sample output:**

```
## animation_find_unused_clips: MyMod

47 .anm files total, 8 unused (17%).

| Clip                                                       | Last modified       |
|------------------------------------------------------------|---------------------|
| Animation/Characters/Rifleman/old_idle_v1.anm              | 2025-11-14T08:22:14 |
| Animation/Characters/Rifleman/playtest_throw_grenade.anm   | 2025-12-02T16:48:51 |
| Animation/Vehicles/UAZ_469/wheel_spin_test.anm             | 2026-01-09T12:01:33 |
| ...                                                                                   |
```

Use the output to drive `refactor_remove_unused` if you want a removal script, but most workflows let the human inspect each clip first.

## weapon_pose_lint

**Read-only.** String-level check of a character `.agr` against the expected `GlobalTags { "WEAPON" "ADS" "STANCE" ... }` block. Reports missing tags as errors and unknown tags as warnings. Fast pre-publish gate — regex-only, no Enforce parser, no `.anm` cross-reference. Pair with `animation_graph action=inspect` for deeper analysis.

**Input:**

```json
{
  "agr_path": "C:/.../addons/MyMod/Animation/Characters/Rifleman.agr"
}
```

**With custom tag set:**

```json
{
  "agr_path": "C:/.../addons/MyMod/Animation/Characters/Civilian.agr",
  "expected_tags": ["STANCE", "ADS"]
}
```

(A civilian doesn't need `WEAPON` tags — override the default expected set.)

**Sample output:**

```
## weapon_pose_lint: Rifleman.agr

GlobalTags block: present

Required tags:
  ✓ WEAPON   — defined (3 values: rifle, pistol, launcher)
  ✓ ADS      — defined (2 values: aim, hipfire)
  ✗ STANCE   — MISSING (expected)
  ✓ MOVEMENT — defined (4 values: idle, walk, run, sprint)

1 error, 0 warnings.
```

**Known limits:**

- Regex-only — won't catch logical errors (e.g., a `WEAPON` tag with the wrong set of values).
- Comparison is case-sensitive, matching the engine's behavior.
- Default expected set: `WEAPON`, `ADS`, `STANCE`, `MOVEMENT`. Override per file.

## project_validate scope=anim — NOT YET SHIPPED

The omnibus `project_validate` tool ships scopes `mod` / `scenario` / `faction` at v1.0.0. The `anim` scope is documented in `docs/L8-PLAN.md` (rules V06-V10 in the L8 plan, expanded to V14-V18 in later planning) but is **not yet implemented**. The tool's source explicitly lists `anim (L8)` under "Future scopes" — calling `project_validate scope=anim` today fails with a zod-validation rejection.

When shipped, the rules will lint:

- **V14** — `.agr` GlobalTags block well-formed (subsumes the bulk of `weapon_pose_lint`).
- **V15** — `.agf` node graph references only resolve to in-project `.anm` clips.
- **V16** — `.ast` state-machine transitions form a connected graph (no orphan states).
- **V17** — every character `.conf` referenced animation graph exists and is loadable.
- **V18** — `GlobalTags` consistency across a faction's character roster.

Until shipped, `weapon_pose_lint` + `animation_graph action=inspect subAction=validate` cover the V14 territory; the other rules require new tooling.

## Workflow: cleaning up animation assets before publish

1. **`animation_find_unused_clips`** — list unused `.anm` files.
2. (Human review) — confirm which are actually safe to drop.
3. **`refactor_remove_unused`** with the unused clip GUIDs — emit a removal script.
4. (Human or external CI) — execute the script.
5. **`weapon_pose_lint`** on every character `.agr` — pre-publish tag-set gate.
6. **`animation_graph action=inspect subAction=validate`** on each character + vehicle `.agr` — deeper structural check.
7. (Future: `project_validate scope=anim`) — single-call gate over the whole anim cluster.
