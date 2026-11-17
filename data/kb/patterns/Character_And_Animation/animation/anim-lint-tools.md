# Animation Lint Tools: animation_find_unused_clips and weapon_pose_lint

Prose moved out of the two tool descriptions (DEC-067 OD-7: tool descriptions stay at 400 characters or less). Both tools are read-only and keep their 1.x names; folding them into one lint tool waits for wave W8.

---

## animation_find_unused_clips

Walks the project's `.anm` animation clip files and reports any that no AGF, ASI, AGR or character `.conf` references. It never deletes anything. Run it before publishing a mod to prune dead clip assets.

**Scope**

- Default: the configured user-mod project root (`config.projectPath`), or the `project_path` argument.
- `include_workshop: true` also folds the workshop project roots from the ProjectIndex into the disk walk and into the reference scan. Use it when the unused check has to account for workshop addons that the mod cross-references.
- `project_path` must not start with `-` (flag-smuggle guard).

**Output**

- `format: markdown` (default) or `json`.
- The heavy lifting is in `src/animation/find-unused-clips.ts`; the tool file only validates input, resolves the roots and formats.

**Reading the answer**

- A clip listed as unused has no reference by path or GUID in the scanned roots. A clip used only from a root that was not scanned shows as unused: scan the root that uses it before deleting anything.
- Deleting is always a separate step; use `refactor_remove_unused` or remove the file by hand once the list is confirmed.

---

## weapon_pose_lint

A string-level check of a character `.agr` (Animation Graph Runtime) file against the expected `GlobalTags { "WEAPON" "ADS" "STANCE" ... }` block.

**Severity**

- A missing expected tag is an error.
- A tag in the file that is not in the expected set is a warning.
- The result is ok when it holds zero errors.

**Default expected tags:** `WEAPON`, `ADS`, `STANCE`, `CROUCH`, `PRONE`, `RELOAD`.

**Why regex-only**

The check is regex and brace matching on purpose. An `.agr` is author-edited text, and a missing tag should be flagged even when the block is syntactically off but the tag set is still readable. There is no Enforce parser and no `.anm` cross-reference, so it is a fast pre-publish gate and nothing more.

**Going deeper**

- `animation_graph` with `action=inspect` reads the whole graph structure.
- `animation_graph` with `inspect` and `inspectAction=validate` checks the graph rules.
- `agr_path` is an absolute path to a character `.agr`; it must not start with `-` (flag-smuggle guard).
