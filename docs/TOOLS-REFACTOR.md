# Refactor tools (L5)

Six surgical refactor primitives built on top of the project-index. All edit on-disk files; all default to DRY-RUN; all use the same safety doctrine.

## Safety doctrine

The L5 refactor cluster is the highest-risk surface in the codebase — these tools rewrite files an LLM asked them to rewrite. Five guardrails make the surface safe:

1. **Surgical byte-edits, not file rewrites.** Tools build a minimal `PendingEdit { filePath, newContent }` from a regex-driven `planFileEdit`, then atomically commit. The plan/commit split lets dry-run preview the exact diff without touching disk.
2. **`.bak` sidecar on every committed file.** `atomicCommit` (`src/refactor/byte-edit.ts:438`) writes each edit's pre-state to `<file>.bak` before the new content lands. Any mid-write failure rolls every file back from its sidecar. The sidecar persists after success so a human can manually revert.
3. **Git-clean refuse.** Before committing, every tool checks `git status` on each target file. If the working tree has uncommitted changes to the file, the commit refuses — pass `force: true` to override. Prevents the LLM from compounding edits on top of unreviewed work.
4. **Dry-run defaults.** Every refactor tool defaults `commit: false`. The tool returns the full diff plan as readable markdown; the human (or another agent in a verification step) decides whether to flip `commit: true`. This is opt-in destructiveness.
5. **No-op detection.** Empty plans, identical old/new values, and missing targets render as informational responses, NOT errors. Tools fail soft so an LLM doesn't loop on a refactor that's already done.

The `force: true` escape hatch and the `keep_backup` flag are intentionally exposed — the doctrine is "safe by default with explicit overrides", not "never let the LLM do anything risky".

## refactor_replace_guid

Swap one 16-hex GUID for another across the entire indexed project set. Updates the resource definition's own GUID (in the `GUID` / `ID` / node.id slot) AND every braced (`{GUID}`) or bare reference to it across every indexed file.

**Input:**

```json
{
  "old_guid": "657590C1EC9E27D3",
  "new_guid": "B1C2D3E4F5A6B7C8",
  "commit": false
}
```

**Refuses on:**

- Collision — the new GUID already names another resource.
- Uncommitted git changes — unless `force: true`.
- No-op — old and new are identical (after normalization).

**Sample output (dry-run, abbreviated):**

```
refactor_replace_guid: {657590C1EC9E27D3} → {B1C2D3E4F5A6B7C8}

Plan (DRY-RUN):
  3 files touched, 7 replacements total

  - Prefabs/Vehicles/UAZ_469.et       (1 byte-span, definition GUID)
  - Configs/Vehicles/UAZ_469.conf     (3 byte-spans, ref + nested refs)
  - Missions/Conflict_Everon.conf     (3 byte-spans, refs only)

Pass commit: true to write. .bak sidecars will be left next to each file.
```

## refactor_move_resource_path

Rename a resource file on disk and update every `{GUID}<oldPath>` reference across the project. GUID stays; only the path bytes change. Order on commit: ref updates land first (atomically), THEN the file rename — so a failure leaves the file at its original path.

**Input:**

```json
{
  "project_root": "C:/Users/<you>/.../addons/MyMod",
  "old_path": "prefabs/base.et",
  "new_path": "prefabs/military/base.et",
  "commit": false
}
```

**Refuses on:** collision (new path exists), missing source file, out-of-index resource, uncommitted git changes (unless `force: true`).

**Why ref updates first:** if the rename happened before the refs were rewritten, a mid-commit crash would leave the project in a state where refs point at a non-existent path and disaster recovery requires understanding the half-applied state. With refs-first, a crash leaves the project pointing at the new path *intended* — and the file rename is the last thing to fail or succeed atomically.

## refactor_rename_project_id

Surgical single-line edit of a `.gproj` file's `ID` property. The `ID` is the FK column on resources in the project-index (schema v2), so after committing this you should re-run the crawl (any tool that reads the index will trigger it lazily).

**Input:**

```json
{
  "gproj_path": "C:/Users/<you>/.../addons/MyMod/MyMod.gproj",
  "old_id": "MyMod",
  "new_id": "MyMod_Renamed",
  "commit": false
}
```

**Validates:** `new_id` must match `^[A-Za-z0-9_\-.]+$`. No spaces, no slashes.

**Single-line guarantee:** the edit touches exactly the `ID "<value>"` line. Surrounding properties (`Name`, `Author`, `Version`) are untouched.

## refactor_normalize_dependencies

Sort + dedupe + validate the `Dependencies { ... }` block in a `.gproj`. Produces a canonical form: alphabetized by GUID, no duplicates, one entry per line. With `check_resolution: true`, also flags any dep whose GUID doesn't resolve in the project-index (likely a missing Workshop subscription).

**Input:**

```json
{
  "gproj_path": "C:/Users/<you>/.../addons/MyMod/MyMod.gproj",
  "check_resolution": true,
  "commit": false
}
```

**Sample output (dry-run):**

```
refactor_normalize_dependencies: MyMod.gproj

Before: 12 entries, 2 duplicates, unsorted
After:  10 entries, sorted, deduped

Resolution check:
  - {A9806AF617972E97} (Arland) — resolves
  - {DEADBEEFCAFEBABE} — UNRESOLVED (missing Workshop sub or stale GUID)

Pass commit: true to write.
```

## refactor_remove_unused

DRY-RUN ONLY — emits a removal script (bash / PowerShell / cmd) for resources with zero inbound references. Composes with `find_unused_resources` for the underlying query. Live-delete is intentionally NOT provided to prevent LLM-induced data loss.

**Input:**

```json
{
  "source": "user",
  "shell": "powershell",
  "limit": 500
}
```

**Sample output:**

```powershell
# refactor_remove_unused — 23 candidates (source=user, limit=500)
# Review every line before running. .bak sidecars NOT created — this is a
# raw script. Run inside the project root or with absolute paths.

Remove-Item -LiteralPath 'C:\...\addons\MyMod\prefabs\unused_a.et'
Remove-Item -LiteralPath 'C:\...\addons\MyMod\prefabs\unused_b.et'
# ... 21 more
```

**Doctrine:** the human (or a separate, audited tool) executes the script. The MCP tool's job ends at script generation.

## refactor_merge_duplicate_guids

DIAGNOSE-ONLY. Walks the project root for `.gproj` / `.et` / `.conf` / `.ent` / `.layout` files and groups by extracted root GUID. Surfaces collisions — two or more files claiming the same 16-hex GUID. The recommended fix is `refactor_replace_guid` per duplicate to issue fresh GUIDs.

**Input:**

```json
{ "project_root": "C:/Users/<you>/.../addons/MyMod" }
```

**Sample output:**

```
refactor_merge_duplicate_guids: MyMod (scanned 412 files)

2 collision groups found:

### {DEADBEEFCAFEBABE} (3 files claim this GUID)
  - prefabs/military/jeep.et
  - prefabs/civ/sedan.et         ← likely the duplicate (forked from jeep)
  - configs/spawn_lookup.conf

### {1234567890ABCDEF} (2 files)
  - layouts/menu_main.layout
  - layouts/menu_main.layout.bak  ← stale backup, not a real collision

Recommended fix: refactor_replace_guid on each duplicate to issue fresh GUIDs.
```

**Why diagnose-only:** picking which file keeps the original GUID and which gets a new one is a human decision. The tool surfaces the collision; the human decides the resolution.

## When to use which

| Goal | Tool |
|---|---|
| Issue a fresh GUID for a resource and update every ref | `refactor_replace_guid` |
| Move a resource into a subdirectory | `refactor_move_resource_path` |
| Rename a `.gproj`'s `ID` field | `refactor_rename_project_id` |
| Clean up a `.gproj`'s Dependencies block | `refactor_normalize_dependencies` |
| Generate a delete-script for orphan files | `refactor_remove_unused` (compose with `find_unused_resources`) |
| Find duplicate GUIDs after a Workshop fork | `refactor_merge_duplicate_guids` |

## Composing refactors

The refactor cluster is designed to compose. A typical "fork a mod, rename it, clean up" sequence:

1. `refactor_merge_duplicate_guids` — find every collision after the fork.
2. `refactor_replace_guid` (per collision) — issue fresh GUIDs.
3. `refactor_rename_project_id` — give the fork its own ID.
4. `refactor_normalize_dependencies` — sort + dedupe the Dependencies block.
5. `find_unused_resources` → `refactor_remove_unused` — drop any files that were only referenced by the original mod's ID.

Each step is dry-run-first. The intended workflow is: run each tool in dry-run, eyeball the plan, then re-run with `commit: true`.
