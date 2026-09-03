/**
 * `refactor_replace_guid` — swap one 16-hex GUID for another across the
 * project (L5-1). The highest-leverage refactor primitive: most other
 * GUID-touching refactors compose from this.
 *
 * Safety model (per L4-2 byte-edit lib's doctrine):
 *   - Default mode is DRY-RUN — produces a plan, writes nothing.
 *   - `commit: true` triggers an atomic multi-file write with `.bak`
 *     sidecars and rollback on any failure mid-batch.
 *   - Refuses if `new_guid` already exists in the project-index
 *     (collision — would silently merge two distinct resources).
 *   - Refuses if any candidate file has uncommitted git changes,
 *     unless `force: true`.
 *
 * Match locations:
 *   1. Resource definitions — the file whose own GUID is `old_guid`.
 *      Updates the root-level `GUID "..."`, `ID "..."`, or `node.id`
 *      slot — whichever form the file uses.
 *   2. Asset-path refs — `Key "{GUID}path/file.ext"` shapes anywhere in
 *      any indexed file.
 *   3. Dependency entries — bare `"GUID"` (no braces) inside a
 *      `Dependencies { ... }` block of a `.gproj`.
 *   4. Value refs — standalone `{GUID}*` shapes in `values` blocks.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import type { Config } from "../config.js";
import { ProjectIndex } from "../project-index/project-index.js";
import type { ResourceSource } from "../project-index/types.js";
import {
  atomicCommit,
  readTextStrict,
  type PendingEdit,
} from "../refactor/byte-edit.js";

// ── Types ────────────────────────────────────────────────────────────────────

interface PerFilePlan {
  absPath: string;
  relPath: string;
  /** Owning project (schema v3) — `relPath` is relative to its root_path. */
  projectId: string;
  /** Number of textual matches that would be replaced. */
  matches: number;
  /** Original content (for the actual commit). Held in memory between
   *  dry-run and commit-call paths, but the public MCP tool is a single
   *  call so we just recompute on commit. */
  newContent?: string;
  /** Stat snapshot from plan time — pins the commit (M15 TOCTOU). */
  mtimeMs?: number;
  size?: number;
}

/** A candidate the plan deliberately did not touch, with the reason. */
export interface SkippedFile {
  relPath: string;
  projectId: string;
  reason: string;
}

interface ReplaceGuidPlan {
  oldGuid: string;
  newGuid: string;
  files: PerFilePlan[];
  totalMatches: number;
  collision: boolean;
  collisionFile?: string;
  /**
   * M14: candidates in `core` projects (always) and `workshop` projects
   * (unless `include_workshop`) are never edited in place — Steam re-syncs
   * workshop content and core is the game's own data. Also holds files that
   * could not be read strictly (non-UTF-8, vanished since crawl).
   */
  skipped: SkippedFile[];
}

/** Which project sources a plan may write to. */
export interface PlanOptions {
  /** Allow editing files in `workshop` projects. `core` is never editable. */
  includeWorkshop?: boolean;
}

/** One candidate file with its owning project resolved. */
export interface Candidate {
  projectId: string;
  relPath: string;
  rootPath: string;
  source: ResourceSource;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const GUID_VALIDATE_RE = /^[0-9A-Fa-f]{16}$/;

/** Normalize a 16-hex GUID input: trim braces if present, uppercase. Throws on invalid. */
export function normalizeGuid(raw: string): string {
  const stripped = raw.replace(/^\{/, "").replace(/\}$/, "").trim();
  if (!GUID_VALIDATE_RE.test(stripped)) {
    throw new Error(
      `Invalid GUID "${raw}": expected 16 hex chars (with or without braces)`,
    );
  }
  return stripped.toUpperCase();
}

/**
 * Replace every occurrence of `oldGuid` with `newGuid` in `content`,
 * regardless of case in the input but emitting the new GUID in
 * canonical uppercase. Returns the new content + match count.
 *
 * Replaces both braced (`{OLDGUID}path`) and bare (`OLDGUID`) forms in
 * one pass — they share the same hex token. The 16-hex regex with
 * boundary check prevents matching a longer hex string that happens
 * to start with the GUID.
 */
export function replaceGuidInContent(
  content: string,
  oldGuid: string,
  newGuid: string,
): { newContent: string; matches: number } {
  // Case-insensitive 16-hex match with non-word/hex boundaries on each side
  // so we don't gobble part of a longer hex token. Boundaries: not [0-9A-Fa-f].
  const re = new RegExp(`(?<![0-9A-Fa-f])${oldGuid}(?![0-9A-Fa-f])`, "gi");
  let matches = 0;
  const newContent = content.replace(re, () => {
    matches += 1;
    return newGuid;
  });
  return { newContent, matches };
}

/**
 * Identify every file that may contain a textual reference to `oldGuid` —
 * from resource_refs (where it's an indexed ref target) AND from resources
 * (the file that defines the GUID itself) — each paired with its OWNING
 * project (schema v3, C2), so the same relative path in two addons yields
 * two distinct candidates resolved against two distinct roots. This replaces
 * the pre-v3 `LIMIT 1` owner lookup that picked an arbitrary project.
 *
 * A `resources` row whose `project_id` is still NULL (pre-v2 row awaiting
 * the backfill crawl) is resolved by probing every project root
 * longest-first for a file that exists on disk — the only option without an
 * FK — and is dropped when nothing matches.
 */
export function findCandidateFiles(
  db: Database.Database,
  oldGuid: string,
): Candidate[] {
  const byKey = new Map<string, Candidate>();
  const add = (c: Candidate): void => {
    byKey.set(`${c.projectId}\u0000${c.relPath}`, c);
  };

  const refRows = db
    .prepare(
      `SELECT DISTINCT ref.project_id AS project_id, ref.source_file AS source_file,
              p.root_path AS root_path, p.source AS source
         FROM resource_refs ref
         JOIN projects p ON p.id = ref.project_id
        WHERE ref.target_guid = ?`,
    )
    .all(oldGuid) as {
    project_id: string;
    source_file: string;
    root_path: string;
    source: ResourceSource;
  }[];
  for (const r of refRows) {
    add({ projectId: r.project_id, relPath: r.source_file, rootPath: r.root_path, source: r.source });
  }

  const ownerRow = db
    .prepare(
      `SELECT r.file_path AS file_path, r.project_id AS project_id, r.source AS r_source,
              p.root_path AS root_path, p.source AS p_source
         FROM resources r
         LEFT JOIN projects p ON p.id = r.project_id
        WHERE r.guid = ?`,
    )
    .get(oldGuid) as
    | {
        file_path: string;
        project_id: string | null;
        r_source: ResourceSource;
        root_path: string | null;
        p_source: ResourceSource | null;
      }
    | undefined;
  if (ownerRow) {
    if (ownerRow.project_id !== null && ownerRow.root_path !== null) {
      add({
        projectId: ownerRow.project_id,
        relPath: ownerRow.file_path,
        rootPath: ownerRow.root_path,
        source: ownerRow.p_source ?? ownerRow.r_source,
      });
    } else {
      // Pre-backfill row: probe roots longest-first for an existing file.
      const projects = db
        .prepare(
          "SELECT id, root_path, source FROM projects ORDER BY length(root_path) DESC",
        )
        .all() as { id: string; root_path: string; source: ResourceSource }[];
      for (const p of projects) {
        if (existsSync(resolve(p.root_path, ownerRow.file_path))) {
          add({
            projectId: p.id,
            relPath: ownerRow.file_path,
            rootPath: p.root_path,
            source: p.source,
          });
          break;
        }
      }
    }
  }

  return [...byKey.values()].sort((a, b) =>
    a.projectId === b.projectId
      ? a.relPath.localeCompare(b.relPath)
      : a.projectId.localeCompare(b.projectId),
  );
}

// ── Plan builder ─────────────────────────────────────────────────────────────

export function buildPlan(
  db: Database.Database,
  index: ProjectIndex,
  oldGuid: string,
  newGuid: string,
  options: PlanOptions = {},
): ReplaceGuidPlan {
  // Collision check — refuse if new_guid already names a different resource.
  const existing = index.resolveGuid(newGuid);
  const collision = existing !== null && existing.guid !== oldGuid;

  const plan: ReplaceGuidPlan = {
    oldGuid,
    newGuid,
    files: [],
    totalMatches: 0,
    collision,
    collisionFile: collision ? existing!.file_path : undefined,
    skipped: [],
  };

  if (collision) return plan;
  if (oldGuid === newGuid) return plan;

  for (const cand of findCandidateFiles(db, oldGuid)) {
    // M14: never edit core content; workshop only on explicit opt-in.
    if (cand.source === "core") {
      plan.skipped.push({
        relPath: cand.relPath,
        projectId: cand.projectId,
        reason: "core (game data) files are never edited in place",
      });
      continue;
    }
    if (cand.source === "workshop" && !options.includeWorkshop) {
      plan.skipped.push({
        relPath: cand.relPath,
        projectId: cand.projectId,
        reason: "workshop file — pass include_workshop: true to edit Steam-synced content",
      });
      continue;
    }

    const absPath = resolve(cand.rootPath, cand.relPath);
    let read;
    try {
      read = readTextStrict(absPath);
    } catch (e) {
      // Vanished since the last crawl, or not valid UTF-8 (M15) — report,
      // don't silently drop.
      plan.skipped.push({
        relPath: cand.relPath,
        projectId: cand.projectId,
        reason: e instanceof Error ? e.message : String(e),
      });
      continue;
    }
    const { newContent, matches } = replaceGuidInContent(read.content, oldGuid, newGuid);
    if (matches === 0) continue;
    plan.files.push({
      absPath,
      relPath: cand.relPath,
      projectId: cand.projectId,
      matches,
      newContent,
      mtimeMs: read.mtimeMs,
      size: read.size,
    });
    plan.totalMatches += matches;
  }
  return plan;
}

// ── Formatter ────────────────────────────────────────────────────────────────

export function formatPlan(plan: ReplaceGuidPlan, mode: "dry-run" | "committed"): string {
  const lines: string[] = [];
  lines.push(`## refactor_replace_guid: {${plan.oldGuid}} → {${plan.newGuid}}`);
  lines.push("");
  if (plan.collision) {
    lines.push(`❌ COLLISION — new GUID already names a resource:`);
    lines.push(`   ${plan.collisionFile}`);
    lines.push("");
    lines.push("Refusing to replace — would silently merge two distinct resources.");
    lines.push("Generate a fresh GUID and retry, or use `refactor_merge_duplicate_guids` if merge is intended.");
    return lines.join("\n");
  }
  if (plan.oldGuid === plan.newGuid) {
    lines.push("(no-op — old and new GUID are identical)");
    return lines.join("\n");
  }
  if (plan.files.length === 0) {
    lines.push("(no matches — the old GUID isn't referenced anywhere indexed)");
    lines.push("");
    lines.push("Either the project containing the references isn't indexed, or the GUID was a typo.");
    appendSkipped(lines, plan);
    return lines.join("\n");
  }

  const verb = mode === "dry-run" ? "Would replace" : "Replaced";
  lines.push(
    `${verb} ${plan.totalMatches} occurrence${plan.totalMatches !== 1 ? "s" : ""} across ${plan.files.length} file${plan.files.length !== 1 ? "s" : ""}:`,
  );
  lines.push("");
  for (const f of plan.files) {
    lines.push(
      `  - ${f.relPath} [${f.projectId}] (${f.matches} match${f.matches !== 1 ? "es" : ""})`,
    );
  }
  lines.push("");
  appendSkipped(lines, plan);
  if (mode === "dry-run") {
    lines.push("DRY-RUN. Pass `commit: true` to actually write the changes.");
    lines.push(
      "Files will be backed up to `<path>.bak` before writing; rollback runs automatically on partial failure.",
    );
  } else {
    lines.push("✅ Committed. `.bak` sidecars left next to each modified file.");
  }
  return lines.join("\n");
}

function appendSkipped(lines: string[], plan: ReplaceGuidPlan): void {
  if (plan.skipped.length === 0) return;
  lines.push(`Skipped ${plan.skipped.length} candidate file${plan.skipped.length !== 1 ? "s" : ""}:`);
  for (const sk of plan.skipped) {
    lines.push(`  - ${sk.relPath} [${sk.projectId}] — ${sk.reason}`);
  }
  lines.push("");
}

// ── Registration ─────────────────────────────────────────────────────────────

export function registerRefactorReplaceGuid(
  server: McpServer,
  db: Database.Database,
  index: ProjectIndex,
  _config: Config,
): void {
  void _config;
  server.registerTool(
    "refactor_replace_guid",
    {
      description:
        "Swap one 16-hex GUID for another across the project. Updates the resource definition's own GUID (in the `GUID`/`ID`/node.id slot) AND every braced/bare reference to it across all indexed files. " +
        "Default mode is DRY-RUN — produces a plan. Pass `commit: true` to actually write. " +
        "Refuses on collision (new GUID already names another resource), on uncommitted git changes (use `force: true` to override), or no-op (old == new). " +
        "Only files in `user` projects are edited by default — workshop files need `include_workshop: true`, core files are never touched. " +
        "Atomic: any mid-write failure rolls every modified file back from .bak sidecars.",
      inputSchema: {
        old_guid: z
          .string()
          .describe("Existing GUID to replace (16 hex, with or without braces)"),
        new_guid: z
          .string()
          .describe("Replacement GUID (16 hex, with or without braces). Must not name an existing resource."),
        commit: z
          .boolean()
          .default(false)
          .describe("When true, atomically writes the changes. Default false = dry-run only."),
        force: z
          .boolean()
          .default(false)
          .describe("Bypass the uncommitted-changes refusal (skips git-clean check)."),
        include_workshop: z
          .boolean()
          .default(false)
          .describe(
            "Also edit files inside Steam-workshop projects. Default false: only `user` projects are edited; core files are never edited.",
          ),
      },
    },
    async ({ old_guid, new_guid, commit, force, include_workshop }) => {
      try {
        const oldNorm = normalizeGuid(old_guid);
        const newNorm = normalizeGuid(new_guid);
        const plan = buildPlan(db, index, oldNorm, newNorm, {
          includeWorkshop: include_workshop,
        });

        if (plan.collision || plan.oldGuid === plan.newGuid || plan.files.length === 0) {
          return { content: [{ type: "text" as const, text: formatPlan(plan, "dry-run") }] };
        }

        if (!commit) {
          return { content: [{ type: "text" as const, text: formatPlan(plan, "dry-run") }] };
        }

        // Build and apply the atomic commit.
        const edits: PendingEdit[] = plan.files.map((f) => ({
          filePath: f.absPath,
          newContent: f.newContent!,
          expectedMtimeMs: f.mtimeMs,
          expectedSize: f.size,
        }));
        atomicCommit(edits, { force, keepBackup: true });
        return {
          content: [{ type: "text" as const, text: formatPlan(plan, "committed") }],
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [
            { type: "text" as const, text: `Error in refactor_replace_guid: ${msg}` },
          ],
          isError: true,
        };
      }
    },
  );
}
