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
 * Containment (H7): `project_root` must sit inside a configured root
 * (projectPath / workshopPath) and both `old_path` / `new_path` must stay
 * inside `project_root`.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { readFileSync, existsSync, renameSync, mkdirSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { z } from "zod";
import { ProjectIndex } from "../project-index/project-index.js";
import {
  atomicCommit,
  type PendingEdit,
} from "../refactor/byte-edit.js";
import { loadConfig, type Config } from "../config.js";
import { assertInsideAnyRoot, assertInsideRoot } from "../utils/path-guard.js";

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

interface PerFilePlan {
  absPath: string;
  relPath: string;
  matches: number;
  newContent: string;
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

  // Find the owning resource — its GUID is the key to the ref edits.
  // Schema v3: resources are scoped by project_id, so resolve the owning
  // project from the absolute path first (same-named files in other addons
  // must not match).
  const owner = index.resolveOwningProject(oldAbsPath);
  const ownerRow = owner
    ? (db
        .prepare("SELECT guid FROM resources WHERE project_id = ? AND file_path = ?")
        .get(owner.id, oldPath) as { guid: string } | undefined)
    : undefined;
  const resourceFoundInIndex = ownerRow !== undefined;
  const guid = ownerRow?.guid ?? "";

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
  };
  if (!resourceFoundInIndex || !fileExists || newPathOccupied) return plan;

  // Find every file referencing this GUID — those are candidates for
  // text-level path replacement. Each ref resolves against ITS OWN
  // project's root (not the caller's), and we never edit game data or
  // workshop content in place unless that workshop project is the one
  // being refactored.
  const refRows = index.referencingFiles(guid);

  const pattern = buildRefPattern(guid, oldPath);
  for (const r of refRows) {
    if (r.source === "core") continue;
    if (r.source === "workshop" && resolve(r.root_path) !== projectRoot) continue;
    const absPath = resolve(r.root_path, r.source_file);
    let content: string;
    try {
      content = readFileSync(absPath, "utf-8");
    } catch {
      continue;
    }
    let matches = 0;
    pattern.lastIndex = 0;
    const newContent = content.replace(pattern, () => {
      matches += 1;
      return `{${guid}}${newPath}`;
    });
    if (matches > 0) {
      plan.refEdits.push({ absPath, relPath: r.source_file, matches, newContent });
      plan.totalRefMatches += matches;
    }
  }
  return plan;
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
    lines.push(`❌ No resource indexed at ${plan.oldRelPath}. Crawl your project first.`);
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

  const verb = mode === "dry-run" ? "Would update" : "Updated";
  lines.push(`${verb} ${plan.totalRefMatches} ref${plan.totalRefMatches !== 1 ? "s" : ""} across ${plan.refEdits.length} file${plan.refEdits.length !== 1 ? "s" : ""}:`);
  lines.push("");
  for (const f of plan.refEdits) {
    lines.push(`  - ${f.relPath} (${f.matches} match${f.matches !== 1 ? "es" : ""})`);
  }
  lines.push("");
  if (mode === "dry-run") {
    lines.push("DRY-RUN. Pass `commit: true` to write ref updates + rename the file.");
    lines.push(
      "Order on commit: (1) file rename first — if it fails nothing is touched; (2) atomic ref edits with .bak sidecars — if they fail the ref files are rolled back and the file is renamed back.",
    );
  } else {
    lines.push("✅ Committed. File renamed; .bak sidecars left next to each updated ref-file.");
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
        "Order on commit: file rename first (a failed rename touches nothing), THEN atomic ref updates — a failed ref commit rolls the refs back and renames the file back. " +
        "Refuses on collision, missing source, or out-of-index resource. " +
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

        if (
          !plan.resourceFoundInIndex ||
          !plan.fileExists ||
          plan.newPathOccupied ||
          !commit
        ) {
          return { content: [{ type: "text" as const, text: formatPlan(plan, "dry-run") }] };
        }

        // Phase 1 (RBE-5): rename FIRST. If this throws (EPERM, locked
        // file, cross-device) nothing else has been touched.
        mkdirSync(dirname(plan.newAbsPath), { recursive: true });
        renameSync(plan.oldAbsPath, plan.newAbsPath);
        // Phase 2: atomic-commit the ref edits. atomicCommit rolls the ref
        // files back on failure; we then undo the rename so disk state
        // matches the (unchanged) refs.
        const edits: PendingEdit[] = plan.refEdits.map((f) => ({
          filePath: f.absPath,
          newContent: f.newContent,
        }));
        if (edits.length > 0) {
          try {
            atomicCommit(edits, { force, keepBackup: true });
          } catch (commitErr) {
            try {
              renameSync(plan.newAbsPath, plan.oldAbsPath);
            } catch (undoErr) {
              const undoMsg = undoErr instanceof Error ? undoErr.message : String(undoErr);
              throw new Error(
                `${commitErr instanceof Error ? commitErr.message : String(commitErr)} ` +
                  `(and the file rename could NOT be undone — file is now at ${plan.newAbsPath}: ${undoMsg})`,
              );
            }
            throw commitErr;
          }
        }
        return {
          content: [{ type: "text" as const, text: formatPlan(plan, "committed") }],
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
