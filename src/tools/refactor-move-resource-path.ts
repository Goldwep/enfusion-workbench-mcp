/**
 * `refactor_move_resource_path` — rename/move a resource file on disk
 * and update every `{GUID}<oldPath>` reference across the project to
 * point at the new path (L5-2). The GUID stays the same; only the path
 * suffix changes.
 *
 * Why: in Reforger, asset references take the form
 * `Texture0 "{A9806AF617972E97}path/to/foo.edds"`. Renaming the file on
 * disk leaves every consumer with `{GUID}old/path/...` which Workbench
 * may auto-repair via the GUID alone, but the on-disk text drift makes
 * diff review noisy and is an actual breakage for any consumer that
 * compares paths.
 *
 * Safety per L4-2 doctrine: dry-run by default; atomicCommit with .bak
 * sidecars; git-clean refuse. Commit order (RBE-5 / M11): the file is
 * renamed FIRST; only then are the ref edits committed atomically. If the
 * rename throws (EPERM, locked file) nothing has been touched. If the ref
 * commit throws, atomicCommit has already rolled the ref files back and we
 * rename the file back to its original path — so the two halves never
 * disagree.
 *
 * Sidecar: every registered resource has a `<file>.<ext>.meta` next to it
 * holding its GUID and import settings. It moves WITH the resource in the
 * same operation (dry-run lists both files), and its top-level
 * `Name "{GUID}<path>"` line is rewritten to the new path. A destination
 * `.meta` that already exists is refused like any other collision. If the
 * sidecar rename, the Name rewrite or the ref commit fails, the renames and
 * the Name rewrite are undone in reverse order so no half-moved pair is left.
 *
 * GUID and references: the GUID is read from the sidecar's Name line (the
 * index row is the fallback). References are the indexed ones plus every
 * other text file under the editable roots that names `{GUID}<oldPath>`
 * (the index does not parse .physmat, .imageset, .asy, ...).
 *
 * Containment (H7): `project_root` must sit inside a configured root
 * (projectPath / workshopPath) and both `old_path` / `new_path` must stay
 * inside `project_root`.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { readFileSync, existsSync, renameSync, mkdirSync, rmSync, statSync } from "node:fs";
import { resolve, dirname, basename, relative, sep } from "node:path";
import { z } from "zod";
import { ProjectIndex } from "../project-index/project-index.js";
import { extractMetaGuid, readMetaGuid } from "../project-index/meta-guid.js";
import {
  atomicCommit,
  checkGitState,
  decodeUtf8Strict,
  type PendingEdit,
} from "../refactor/byte-edit.js";
import { backUp } from "../utils/backup.js";
import { readTextFile, walkTextCandidates } from "../refactor/text-walk.js";
import { loadConfig, type Config } from "../config.js";
import { assertInsideAnyRoot, assertInsideRoot } from "../utils/path-guard.js";
import { writeFileAtomic } from "../utils/atomic-write.js";

// ── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Build the regex that matches `{GUID}<oldPath>` references. The path
 * portion is matched literally (escaped); the closing quote (or other
 * delimiter) is left to the caller — we match just the inside of the
 * braced-GUID + path body. Case-insensitive on the GUID hex, case-
 * sensitive on the path (Enfusion paths are case-sensitive).
 */
export function buildRefPattern(guid: string, oldPath: string): RegExp {
  const escaped = oldPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\{${guid}\\}${escaped}`, "gi");
}

/**
 * Rewrite the sidecar's top-level `Name "{GUID}<oldPath>"` line to the new
 * path, keeping whatever GUID the meta already carries. Returns null when the
 * meta has no Name line for `oldPath` (the caller then moves it unchanged and
 * says so). Format as Workbench writes it next to addon resources (the game
 * paks ship no `.meta` files; the GUID and path here are illustrative):
 *   MetaFileClass {
 *    Name "{5A2220DD0C16958B}Prefabs/MP/Spawning/SpawnPoint_US.et"
 *    Configurations { ... }
 *   }
 */
export function rewriteMetaName(content: string, oldPath: string, newPath: string): string | null {
  const escaped = oldPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(^[ \\t]*Name[ \\t]+"\\{[0-9A-Fa-f]{16}\\})${escaped}(")`, "m");
  if (!pattern.test(content)) return null;
  return content.replace(pattern, (_m, head: string, tail: string) => `${head}${newPath}${tail}`);
}

interface PerFilePlan {
  absPath: string;
  relPath: string;
  matches: number;
  newContent: string;
  /** Found by the disk walk: a text file the index does not parse. */
  unindexed?: boolean;
  /**
   * mtime and size taken before the file was read for the plan (refactor-index-10): the commit's
   * M15 check refuses a file that changed since (src/refactor/byte-edit.ts PendingEdit).
   */
  mtimeMs?: number;
  size?: number;
}

interface MovePlan {
  guid: string;
  oldRelPath: string;
  newRelPath: string;
  oldAbsPath: string;
  newAbsPath: string;
  refEdits: PerFilePlan[];
  totalRefMatches: number;
  fileExists: boolean;
  newPathOccupied: boolean;
  resourceFoundInIndex: boolean;
  /** Sidecar `<file>.meta`; it moves with the resource when it exists. */
  oldMetaAbsPath: string;
  newMetaAbsPath: string;
  metaExists: boolean;
  newMetaOccupied: boolean;
  /** Sidecar content before / after the Name rewrite (undefined: no rewrite). */
  oldMetaContent?: string;
  newMetaContent?: string;
}

// ── Plan builder ─────────────────────────────────────────────────────────────

export function buildPlan(
  db: Database.Database,
  index: ProjectIndex,
  oldPath: string,
  newPath: string,
  projectRoot: string,
): MovePlan {
  const oldAbsPath = resolve(projectRoot, oldPath);
  const newAbsPath = resolve(projectRoot, newPath);
  const fileExists = existsSync(oldAbsPath);
  const newPathOccupied = existsSync(newAbsPath);
  const oldMetaAbsPath = `${oldAbsPath}.meta`;
  const newMetaAbsPath = `${newAbsPath}.meta`;
  const metaExists = existsSync(oldMetaAbsPath);
  const newMetaOccupied = existsSync(newMetaAbsPath);

  // The resource GUID is the key to the ref edits. Its authority is the
  // sidecar's Name line (audit refactor-index-01: an .et root `ID` is an
  // entity id, not the GUID references use); the index row is the fallback
  // for a resource without a sidecar (a .gproj). Schema v3: resources are
  // scoped by project_id, so resolve the owning project from the absolute
  // path first (same-named files in other addons must not match).
  let metaContent: string | undefined;
  let metaGuid: string | null = null;
  if (metaExists) {
    try {
      // Strict decode: a sidecar that is not valid UTF-8 can't be rewritten
      // from a decoded string without corrupting it.
      metaContent = decodeUtf8Strict(readFileSync(oldMetaAbsPath), oldMetaAbsPath);
      metaGuid = extractMetaGuid(metaContent);
    } catch {
      // Unreadable or non-UTF-8 sidecar: it still moves, byte for byte, with
      // no Name rewrite; its GUID is still read leniently.
      metaGuid = readMetaGuid(oldMetaAbsPath);
    }
  }
  const owner = index.resolveOwningProject(oldAbsPath);
  const ownerRow = owner
    ? (db
        .prepare("SELECT guid FROM resources WHERE project_id = ? AND file_path = ?")
        .get(owner.id, oldPath) as { guid: string } | undefined)
    : undefined;
  const guid = metaGuid ?? ownerRow?.guid ?? "";
  const resourceFoundInIndex = guid !== "";

  const plan: MovePlan = {
    guid,
    oldRelPath: oldPath,
    newRelPath: newPath,
    oldAbsPath,
    newAbsPath,
    refEdits: [],
    totalRefMatches: 0,
    fileExists,
    newPathOccupied,
    resourceFoundInIndex,
    oldMetaAbsPath,
    newMetaAbsPath,
    metaExists,
    newMetaOccupied,
  };
  if (!resourceFoundInIndex || !fileExists || newPathOccupied || newMetaOccupied) return plan;

  if (metaContent !== undefined) {
    const renamed = rewriteMetaName(metaContent, oldPath, newPath);
    if (renamed !== null) {
      plan.oldMetaContent = metaContent;
      plan.newMetaContent = renamed;
    }
  }

  // Find every file referencing this GUID — those are candidates for
  // text-level path replacement. Each ref resolves against ITS OWN
  // project's root (not the caller's), and we never edit game data or
  // workshop content in place unless that workshop project is the one
  // being refactored.
  const refRows = index.referencingFiles(guid);
  const planned = new Set<string>([
    oldAbsPath.toLowerCase(),
    oldMetaAbsPath.toLowerCase(),
  ]);
  const addEdit = (
    absPath: string,
    relPath: string,
    content: string,
    unindexed: boolean,
    stat: { mtimeMs: number; size: number } | null,
  ): void => {
    const key = absPath.toLowerCase();
    if (planned.has(key)) return;
    planned.add(key);
    let matches = 0;
    const newContent = content.replace(buildRefPattern(guid, oldPath), () => {
      matches += 1;
      return `{${guid}}${newPath}`;
    });
    if (matches > 0) {
      plan.refEdits.push({
        absPath,
        relPath,
        matches,
        newContent,
        ...(unindexed ? { unindexed } : {}),
        ...(stat ? { mtimeMs: stat.mtimeMs, size: stat.size } : {}),
      });
      plan.totalRefMatches += matches;
    }
  };

  for (const r of refRows) {
    if (r.source === "core") continue;
    if (r.source === "workshop" && resolve(r.root_path) !== projectRoot) continue;
    const absPath = resolve(r.root_path, r.source_file);
    let content: string;
    // Stat BEFORE the read: a write after the stat moves the mtime, so the commit refuses.
    const stat = statOrNull(absPath);
    try {
      content = readFileSync(absPath, "utf-8");
    } catch {
      continue;
    }
    addEdit(absPath, r.source_file, content, false, stat);
  }

  // Audit refactor-index-07: the index parses only some text formats, so
  // walk the editable roots for every other text file (.physmat, .imageset,
  // .asy, other .meta, ...) naming `{GUID}<oldPath>`. Same edit policy as
  // the indexed refs: user projects, plus the workshop project being moved
  // in; core never. Binaries and .bak/.tmp sidecars are skipped.
  // Cheap pre-filter, as case-insensitive as buildRefPattern.
  const needle = `{${guid}}${oldPath}`.toLowerCase();
  for (const walkRoot of editableRoots(db, projectRoot)) {
    for (const abs of walkTextCandidates(walkRoot)) {
      if (planned.has(resolve(abs).toLowerCase())) continue;
      const stat = statOrNull(abs);
      const text = readTextFile(abs);
      if (text === null) continue;
      if (!text.toLowerCase().includes(needle)) continue;
      addEdit(resolve(abs), relative(walkRoot, abs).split(sep).join("/"), text, true, stat);
    }
  }
  return plan;
}

/** mtime and size of a file, or null when it cannot be read. */
function statOrNull(abs: string): { mtimeMs: number; size: number } | null {
  try {
    const st = statSync(abs);
    return { mtimeMs: st.mtimeMs, size: st.size };
  } catch {
    return null;
  }
}

/**
 * The moved resource and its sidecar with uncommitted git changes (refactor-index-10): the
 * git-clean refusal covers what the move renames and rewrites, not only the referencing files.
 */
export function dirtyMovedFiles(plan: Pick<MovePlan, "oldAbsPath" | "oldMetaAbsPath" | "metaExists">): string[] {
  const files = plan.metaExists ? [plan.oldAbsPath, plan.oldMetaAbsPath] : [plan.oldAbsPath];
  const dirty: string[] = [];
  for (const f of files) {
    const state = checkGitState(f);
    if (state.kind === "dirty") dirty.push(f);
  }
  return dirty;
}

/**
 * Roots the ref rewrite may edit: every indexed `user` project, plus the
 * project being refactored (a workshop project only when it is that one).
 * Deduplicated; nested projects are handled by the caller's path set.
 */
function editableRoots(db: Database.Database, projectRoot: string): string[] {
  const rows = db.prepare("SELECT root_path, source FROM projects").all() as {
    root_path: string;
    source: string;
  }[];
  const out = new Map<string, string>();
  out.set(projectRoot.toLowerCase(), projectRoot);
  for (const r of rows) {
    if (r.source !== "user") continue;
    const abs = resolve(r.root_path);
    out.set(abs.toLowerCase(), abs);
  }
  return [...out.values()];
}

// ── Formatter ────────────────────────────────────────────────────────────────

export function formatPlan(plan: MovePlan, mode: "dry-run" | "committed"): string {
  const lines: string[] = [];
  lines.push(`## refactor_move_resource_path`);
  lines.push("");
  lines.push(`- Old: ${plan.oldRelPath}`);
  lines.push(`- New: ${plan.newRelPath}`);
  if (plan.guid) lines.push(`- GUID: {${plan.guid}}`);
  lines.push("");

  if (!plan.resourceFoundInIndex) {
    lines.push(
      `❌ No resource GUID for ${plan.oldRelPath}: no \`.meta\` Name line beside it and no resource indexed there. Crawl your project first.`,
    );
    return lines.join("\n");
  }
  if (!plan.fileExists) {
    lines.push(`❌ Source file does not exist on disk: ${plan.oldAbsPath}`);
    return lines.join("\n");
  }
  if (plan.newPathOccupied) {
    lines.push(`❌ Destination already exists: ${plan.newAbsPath}`);
    lines.push("Refusing to overwrite.");
    return lines.join("\n");
  }
  if (plan.newMetaOccupied) {
    lines.push(`❌ Destination sidecar already exists: ${plan.newMetaAbsPath}`);
    lines.push("Refusing to overwrite.");
    return lines.join("\n");
  }

  const verb = mode === "dry-run" ? "Would update" : "Updated";
  lines.push(`${verb} ${plan.totalRefMatches} ref${plan.totalRefMatches !== 1 ? "s" : ""} across ${plan.refEdits.length} file${plan.refEdits.length !== 1 ? "s" : ""}:`);
  lines.push("");
  for (const f of plan.refEdits) {
    lines.push(
      `  - ${f.relPath} (${f.matches} match${f.matches !== 1 ? "es" : ""})${f.unindexed ? " (unindexed file, found on disk)" : ""}`,
    );
  }
  lines.push("");
  lines.push(`${mode === "dry-run" ? "Would move" : "Moved"} files:`);
  lines.push(`  - ${plan.oldRelPath} -> ${plan.newRelPath}`);
  if (plan.metaExists) {
    lines.push(`  - ${plan.oldRelPath}.meta -> ${plan.newRelPath}.meta (sidecar)`);
    lines.push(
      plan.newMetaContent !== undefined
        ? `    Sidecar Name line ${mode === "dry-run" ? "would be" : "was"} rewritten to {GUID}${plan.newRelPath} (not verified live: how Workbench treats an offline move on next open).`
        : '    Sidecar has no `Name "{GUID}<old path>"` line to rewrite; it moves unchanged (not verified live).',
    );
  } else {
    lines.push("  (no .meta sidecar next to the source; nothing to carry)");
  }
  lines.push("");
  if (mode === "dry-run") {
    lines.push("DRY-RUN. Pass `commit: true` to write ref updates + rename the file and its .meta sidecar.");
    lines.push(
      "Order on commit: (1) file rename first, then the sidecar rename + Name rewrite — if one fails the earlier steps are undone; (2) atomic ref edits with .bak sidecars — if they fail the ref files are rolled back and the file, its sidecar and the Name line are put back.",
    );
  } else {
    lines.push(
      `✅ Committed. File${plan.metaExists ? " and .meta sidecar" : ""} renamed; .bak sidecars left next to each updated ref-file.`,
    );
  }
  return lines.join("\n");
}

// ── Registration ─────────────────────────────────────────────────────────────

export function registerRefactorMoveResourcePath(
  server: McpServer,
  db: Database.Database,
  index: ProjectIndex,
  config?: Config,
): void {
  // Optional so existing call sites keep compiling; resolve lazily from the
  // environment when the caller doesn't hand us the loaded config.
  let cfg: Config | undefined = config;
  const roots = (): (string | undefined)[] => {
    if (!cfg) cfg = loadConfig();
    return [cfg.projectPath, cfg.workshopPath];
  };
  server.registerTool(
    "refactor_move_resource_path",
    {
      description:
        "Rename/move a resource file on disk and update every `{GUID}<oldPath>` reference across the project to point at the new path. " +
        "GUID stays; path bytes change. DRY-RUN by default — pass `commit: true` to write. " +
        "The `<file>.meta` sidecar (GUID + import settings) moves with the file and its `Name \"{GUID}path\"` line is rewritten to the new path; the dry-run lists both files. " +
        "Order on commit: file rename first (a failed rename touches nothing), then the sidecar, THEN atomic ref updates — a failure rolls the refs back and undoes the sidecar and file renames. " +
        "Refuses on collision (destination file or destination `.meta`), missing source, or no GUID (.meta or index). " +
        "Not verified live: how Workbench treats an offline move on its next open. " +
        "Paths are project-relative (forward slashes), resolved against the supplied project_root.",
      inputSchema: {
        project_root: z.string().describe("Absolute path to the owning project (the .gproj directory)"),
        old_path: z
          .string()
          .describe("Existing resource path relative to project_root (e.g. 'prefabs/base.et')"),
        new_path: z
          .string()
          .describe("New path relative to project_root. Intermediate directories are created."),
        commit: z.boolean().default(false).describe("True to write."),
        force: z.boolean().default(false).describe("Skip git-clean check."),
      },
    },
    async ({ project_root, old_path, new_path, commit, force }) => {
      try {
        for (const [k, v] of [
          ["project_root", project_root],
          ["old_path", old_path],
          ["new_path", new_path],
        ] as const) {
          if (v.startsWith("-")) {
            return {
              content: [{ type: "text" as const, text: `Invalid ${k}: must not start with '-'` }],
              isError: true,
            };
          }
        }
        if (old_path === new_path) {
          return {
            content: [
              { type: "text" as const, text: "(no-op — old_path and new_path are identical)" },
            ],
          };
        }
        // Normalize forward slashes (file_path in DB is forward-slash form).
        const oldNorm = old_path.split("\\").join("/");
        const newNorm = new_path.split("\\").join("/");
        const projectRoot = resolve(project_root);
        // H7 containment: project_root inside a configured root; both
        // paths inside project_root (blocks `../` in new_path).
        assertInsideAnyRoot(projectRoot, roots(), "project_root");
        assertInsideRoot(resolve(projectRoot, oldNorm), projectRoot, "old_path");
        assertInsideRoot(resolve(projectRoot, newNorm), projectRoot, "new_path");
        const plan = buildPlan(db, index, oldNorm, newNorm, projectRoot);

        const blocked =
          !plan.resourceFoundInIndex ||
          !plan.fileExists ||
          plan.newPathOccupied ||
          plan.newMetaOccupied;
        if (blocked && commit) {
          // A commit that cannot run is an error, not a quiet dry run (W11 run 2).
          return {
            content: [
              {
                type: "text" as const,
                text: `REFUSED: nothing was moved or rewritten.\n\n${formatPlan(plan, "dry-run")}`,
              },
            ],
            isError: true,
          };
        }
        if (blocked || !commit) {
          return { content: [{ type: "text" as const, text: formatPlan(plan, "dry-run") }] };
        }

        // The git-clean refusal covers the moved resource and its sidecar too, also when no
        // file refers to it (refactor-index-10); `force` skips it, as for the ref files.
        if (!force) {
          const dirty = dirtyMovedFiles(plan);
          if (dirty.length > 0) {
            return {
              content: [
                {
                  type: "text" as const,
                  text:
                    `REFUSED: nothing was moved or rewritten. Uncommitted git changes in ${dirty.join(", ")}; ` +
                    "commit them first or pass `force: true`.",
                },
              ],
              isError: true,
            };
          }
        }

        // Phase 1 (RBE-5): rename FIRST. If this throws (EPERM, locked
        // file, cross-device) nothing else has been touched.
        mkdirSync(dirname(plan.newAbsPath), { recursive: true });
        renameSync(plan.oldAbsPath, plan.newAbsPath);
        // Everything after the first rename is undone, newest step first, if
        // a later step throws — the file, its sidecar and the refs never end
        // up half-moved.
        const undo: (() => void)[] = [() => renameSync(plan.newAbsPath, plan.oldAbsPath)];
        let metaMoved = false;
        let metaBackup: string | null = null;
        try {
          // Phase 2: the sidecar follows the file, then its Name line.
          if (plan.metaExists) {
            renameSync(plan.oldMetaAbsPath, plan.newMetaAbsPath);
            metaMoved = true;
            undo.push(() => renameSync(plan.newMetaAbsPath, plan.oldMetaAbsPath));
            if (plan.newMetaContent !== undefined && plan.oldMetaContent !== undefined) {
              const originalMeta = plan.oldMetaContent;
              // The Name rewrite replaces the sidecar: its original bytes are kept as a numbered
              // backup beside it, as the ref files keep theirs (refactor-index-10).
              const bak = backUp(plan.newMetaAbsPath, (m) => {
                throw new Error(m);
              });
              metaBackup = bak;
              // Undone with the move: no backup is left beside a path the resource is not at.
              undo.push(() => rmSync(bak, { force: true }));
              // Both writes replace the moved sidecar, so each goes through write-then-rename
              // (write-safety audit gap 19): a failed write leaves the moved bytes whole.
              undo.push(() => writeFileAtomic(plan.newMetaAbsPath, originalMeta));
              writeFileAtomic(plan.newMetaAbsPath, plan.newMetaContent);
            }
          }
          // Phase 3: atomic-commit the ref edits. atomicCommit rolls the ref
          // files back on failure; the catch then undoes the renames so disk
          // state matches the (unchanged) refs.
          const edits: PendingEdit[] = plan.refEdits.map((f) => ({
            filePath: f.absPath,
            newContent: f.newContent,
            ...(f.mtimeMs !== undefined ? { expectedMtimeMs: f.mtimeMs } : {}),
            ...(f.size !== undefined ? { expectedSize: f.size } : {}),
          }));
          if (edits.length > 0) atomicCommit(edits, { force, keepBackup: true });
        } catch (commitErr) {
          const undoFailures: string[] = [];
          for (const step of undo.reverse()) {
            try {
              step();
            } catch (undoErr) {
              undoFailures.push(undoErr instanceof Error ? undoErr.message : String(undoErr));
            }
          }
          if (undoFailures.length > 0) {
            throw new Error(
              `${commitErr instanceof Error ? commitErr.message : String(commitErr)} ` +
                `(and the move could NOT be fully undone — the file may now be at ${plan.newAbsPath}` +
                `${metaMoved ? `, its sidecar at ${plan.newMetaAbsPath}` : ""}: ${undoFailures.join("; ")})`,
            );
          }
          throw commitErr;
        }
        const committed = formatPlan(plan, "committed");
        return {
          content: [
            {
              type: "text" as const,
              text: metaBackup
                ? `${committed}\nSidecar backup (before the Name rewrite): ${metaBackup}`
                : committed,
            },
          ],
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [{ type: "text" as const, text: `Error moving resource: ${msg}` }],
          isError: true,
        };
      }
    },
  );
}

// silence unused import warnings if any
void basename;
