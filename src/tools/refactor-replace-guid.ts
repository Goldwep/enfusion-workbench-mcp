/**
 * `refactor_replace_guid` — swap one 16-hex GUID for another across the
 * project (L5-1). The highest-leverage refactor primitive: most other
 * GUID-touching refactors compose from this.
 *
 * Safety model (per L4-2 byte-edit lib's doctrine):
 *   - Default mode is DRY-RUN — produces a plan, writes nothing.
 *   - `commit: true` triggers an atomic multi-file write with `.bak`
 *     sidecars and rollback on any failure mid-batch.
 *   - Refuses if `new_guid` already exists in the project-index, or a
 *     `.meta` under a non-core project root already names it (collision —
 *     would silently merge two distinct resources).
 *   - Refuses if any candidate file has uncommitted git changes,
 *     unless `force: true`.
 *
 * Match locations:
 *   1. Resource definitions — a `.gproj` whose `GUID "..."` is `old_guid`.
 *      (An `.et` root `ID` is an entity id and a node id is an object id;
 *      neither is a resource GUID, so neither is an owner slot.)
 *   2. Asset-path refs — `Key "{GUID}path/file.ext"` shapes anywhere in
 *      any indexed file.
 *   3. Dependency entries — bare `"GUID"` (no braces) inside a
 *      `Dependencies { ... }` block of a `.gproj`.
 *   4. Value refs — standalone `{GUID}*` shapes in `values` blocks.
 *   5. The owner's `.meta` sidecar — `Name "{GUID}path"` in `<file>.meta`.
 *      Every resource other than a .gproj keeps its GUID ONLY there; the
 *      index reads it from there (schema v4), and the owner is looked up
 *      three ways in case the index is stale: the index row's file and its
 *      `.meta`; the `.meta` beside each `{GUID}path` a reference names; a
 *      walk of the editable project roots for a `.meta` whose Name holds the
 *      GUID (W11 run 3, EV-W11-052: the references were rewritten and the
 *      parent's .meta left on the old GUID).
 *
 * Unindexed references: the editable roots are walked for text files the
 * index never scans; any that names `{GUID}` is planned as an unindexed
 * reference and only its braced spans are rewritten (W11 run 4: a .physmat
 * child kept its parent's old GUID). Binaries and .bak/.tmp sidecars are
 * skipped.
 *
 * Owner refusal: a commit that would rewrite references while no editable
 * file owns `old_guid` leaves every reference naming a GUID no resource owns,
 * so it answers isError unless `references_only: true`.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { existsSync, readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { z } from "zod";
import type { Config } from "../config.js";
import { ProjectIndex } from "../project-index/project-index.js";
import type { ResourceSource } from "../project-index/types.js";
import {
  atomicCommit,
  readTextStrict,
  type PendingEdit,
} from "../refactor/byte-edit.js";
import { readTextFile, walkMetaFiles, walkTextCandidates } from "../refactor/text-walk.js";
import { assertInsideRoot, isPathInsideRoot } from "../utils/path-guard.js";

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
  /** Found by the disk walk, not the index: only braced `{GUID}` spans are rewritten. */
  unindexed?: boolean;
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
  /**
   * Plan files that carry `old_guid` as the resource's OWN identity: the
   * index-owned file (when its text holds the GUID) and the owner's `.meta`
   * sidecar. Empty means no editable owner was found.
   */
  ownerFiles: string[];
  /** Owners that were found but cannot be edited (core, workshop without opt-in, unreadable). */
  ownerSkipped: SkippedFile[];
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
  /** True for the `resources` row whose own GUID is the target. */
  owner?: boolean;
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

  // Schema v4: every file claiming the GUID is an owner (a fork can carry
  // the same GUID in two projects; rewriting the refs in both while leaving
  // one owner on the old GUID would break that project).
  const ownerRows = db
    .prepare(
      `SELECT r.file_path AS file_path, r.project_id AS project_id, r.source AS r_source,
              p.root_path AS root_path, p.source AS p_source
         FROM resources r
         LEFT JOIN projects p ON p.id = r.project_id
        WHERE r.guid = ?
        ORDER BY r.project_id, r.file_path`,
    )
    .all(oldGuid) as {
    file_path: string;
    project_id: string | null;
    r_source: ResourceSource;
    root_path: string | null;
    p_source: ResourceSource | null;
  }[];
  for (const ownerRow of ownerRows) {
    if (ownerRow.project_id !== null && ownerRow.root_path !== null) {
      add({
        projectId: ownerRow.project_id,
        relPath: ownerRow.file_path,
        rootPath: ownerRow.root_path,
        source: ownerRow.p_source ?? ownerRow.r_source,
        owner: true,
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
            owner: true,
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
  // The index holds every resource GUID (schema v4: .meta Name GUIDs and
  // .gproj GUIDs, never entity ids); a stale index is backed by a disk walk
  // for a sidecar that already carries new_guid.
  let collisionFile: string | undefined;
  if (oldGuid !== newGuid) {
    const existing = index.resolveGuid(newGuid);
    collisionFile = existing
      ? existing.file_path
      : (findMetaClaimingGuid(db, newGuid) ?? undefined);
  }
  const collision = collisionFile !== undefined;

  const plan: ReplaceGuidPlan = {
    oldGuid,
    newGuid,
    files: [],
    totalMatches: 0,
    collision,
    collisionFile,
    skipped: [],
    ownerFiles: [],
    ownerSkipped: [],
  };

  if (collision) return plan;
  if (oldGuid === newGuid) return plan;

  const seen = new Set<string>();
  /** Gate + read + rewrite one file; returns true when it entered the plan. */
  const consider = (cand: Candidate, isOwner: boolean, unindexed = false): boolean => {
    const absPath = resolve(cand.rootPath, cand.relPath);
    const key = absPath.toLowerCase();
    if (seen.has(key)) return plan.files.some((f) => f.absPath.toLowerCase() === key);
    seen.add(key);
    const skip = (reason: string): false => {
      const sk = { relPath: cand.relPath, projectId: cand.projectId, reason };
      plan.skipped.push(sk);
      if (isOwner) plan.ownerSkipped.push(sk);
      return false;
    };
    // M14: never edit core content; workshop only on explicit opt-in.
    if (cand.source === "core") return skip("core (game data) files are never edited in place");
    if (cand.source === "workshop" && !options.includeWorkshop)
      return skip("workshop file — pass include_workshop: true to edit Steam-synced content");
    let read;
    try {
      // Containment: a path built from a reference must stay inside its root.
      assertInsideRoot(absPath, cand.rootPath, cand.relPath);
      read = readTextStrict(absPath);
    } catch (e) {
      // Vanished since the last crawl, outside its root, or not valid UTF-8
      // (M15) — report, don't silently drop.
      return skip(e instanceof Error ? e.message : String(e));
    }
    // A file the index never parsed is rewritten only where it names the GUID
    // as a braced reference (`{GUID}`), never at a bare hex run.
    const { newContent, matches } = unindexed
      ? replaceBracedGuid(read.content, oldGuid, newGuid)
      : replaceGuidInContent(read.content, oldGuid, newGuid);
    if (matches === 0) return false;
    plan.files.push({
      absPath,
      relPath: cand.relPath,
      projectId: cand.projectId,
      matches,
      newContent,
      mtimeMs: read.mtimeMs,
      size: read.size,
      ...(unindexed ? { unindexed: true } : {}),
    });
    plan.totalMatches += matches;
    if (isOwner) plan.ownerFiles.push(cand.relPath);
    return true;
  };

  const candidates = findCandidateFiles(db, oldGuid);
  for (const cand of candidates) consider(cand, false);

  // The owner. 1: the index row's own file (a .gproj holds the GUID in its
  // text; any other resource in its sidecar), plus that file's .meta sidecar.
  for (const cand of candidates.filter((c) => c.owner)) {
    markOwner(plan, cand);
    considerMeta(cand.rootPath, cand.projectId, cand.source, cand.relPath);
  }
  // 2: the .meta beside every `{GUID}path` a candidate file names, looked up
  // in each project root, longest root first.
  if (!ownerFound(plan)) {
    const projects = projectRows(db);
    for (const relPath of referencedPaths(candidates, oldGuid)) {
      for (const p of projects) {
        if (considerMeta(p.root_path, p.id, p.source, relPath)) break;
      }
    }
  }
  // 3: walk the editable roots (longest first, so a nested project owns its
  // files) for the text files the index never scans (.physmat, .meta, ...):
  // a .meta whose Name holds the GUID is the owner; any other text file that
  // names `{GUID}` is an unindexed reference (W11 run 4: the .physmat child
  // kept the parent's old GUID). Binaries and .bak/.tmp sidecars are skipped.
  const braced = new RegExp(`\\{${oldGuid}\\}`, "i");
  for (const p of projectRows(db)) {
    if (p.source === "core") continue; // game data is never edited in place
    if (p.source === "workshop" && !options.includeWorkshop) continue;
    for (const abs of walkTextCandidates(p.root_path)) {
      if (seen.has(resolve(abs).toLowerCase())) continue;
      const text = readTextFile(abs);
      if (text === null || !braced.test(text)) continue;
      const rel = relative(p.root_path, abs).split(sep).join("/");
      const cand = { projectId: p.id, relPath: rel, rootPath: p.root_path, source: p.source };
      if (rel.toLowerCase().endsWith(".meta") && metaNamesGuid(abs, oldGuid)) consider(cand, true);
      else consider(cand, false, true);
    }
  }
  return plan;

  /** Plan `<relPath>.meta` under `root` when its Name line names the GUID. */
  function considerMeta(
    root: string,
    projectId: string,
    source: ResourceSource,
    relPath: string,
  ): boolean {
    const metaRel = `${relPath}.meta`;
    const metaAbs = resolve(root, metaRel);
    if (!isPathInsideRoot(metaAbs, root) || !existsSync(metaAbs)) return false;
    if (!metaNamesGuid(metaAbs, oldGuid)) return false;
    consider({ projectId, relPath: metaRel, rootPath: root, source }, true);
    return true;
  }
}

function ownerFound(plan: ReplaceGuidPlan): boolean {
  return plan.ownerFiles.length > 0 || plan.ownerSkipped.length > 0;
}

function markOwner(plan: ReplaceGuidPlan, cand: Candidate): void {
  const same = (f: { projectId: string; relPath: string }): boolean =>
    f.projectId === cand.projectId && f.relPath === cand.relPath;
  if (plan.files.some(same)) plan.ownerFiles.push(cand.relPath);
  else {
    const sk = plan.skipped.find(same);
    if (sk) plan.ownerSkipped.push(sk);
  }
}

function projectRows(db: Database.Database): { id: string; root_path: string; source: ResourceSource }[] {
  return db
    .prepare("SELECT id, root_path, source FROM projects ORDER BY length(root_path) DESC")
    .all() as { id: string; root_path: string; source: ResourceSource }[];
}

/** Every `{GUID}path` path a candidate file names, in first-seen order. */
function referencedPaths(candidates: Candidate[], guid: string): string[] {
  const re = new RegExp(`\\{${guid}\\}([^"\\s}]+)`, "gi");
  const out = new Set<string>();
  const texts: string[] = [];
  for (const c of candidates) {
    try {
      texts.push(readTextStrict(resolve(c.rootPath, c.relPath)).content);
    } catch {
      /* skipped already, with its reason */
    }
  }
  for (const t of texts) for (const m of t.matchAll(re)) out.add(m[1]);
  return [...out];
}

/** A `.meta` whose top-level `Name "{GUID}..."` line names `guid`. */
export function metaNamesGuid(metaAbs: string, guid: string): boolean {
  try {
    const text = readFileSync(metaAbs, "utf-8");
    return new RegExp(`^[ \\t]*Name[ \\t]+"\\{${guid}\\}`, "im").test(text);
  } catch {
    return false;
  }
}

/**
 * A `.meta` under any non-core project root whose Name line already holds
 * `guid`, as `root-relative path [project]`, or null. Backs the collision
 * check when the index is stale (the watcher may not have seen a sidecar
 * edit): the sidecar on disk is the authority for a resource's GUID
 * (audit refactor-index-06). Core content is packed and ships no `.meta`.
 */
export function findMetaClaimingGuid(db: Database.Database, guid: string): string | null {
  for (const p of projectRows(db)) {
    if (p.source === "core") continue;
    for (const abs of walkMetaFiles(p.root_path)) {
      if (metaNamesGuid(abs, guid)) {
        return `${relative(p.root_path, abs).split(sep).join("/")} [${p.id}]`;
      }
    }
  }
  return null;
}

/** Replace only the braced `{GUID}` spans (the form a resource reference takes). */
export function replaceBracedGuid(
  content: string,
  oldGuid: string,
  newGuid: string,
): { newContent: string; matches: number } {
  const re = new RegExp(`\\{${oldGuid}\\}`, "gi");
  let matches = 0;
  const newContent = content.replace(re, () => {
    matches += 1;
    return `{${newGuid}}`;
  });
  return { newContent, matches };
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
      `  - ${f.relPath} [${f.projectId}] (${f.matches} match${f.matches !== 1 ? "es" : ""})${f.unindexed ? " (unindexed reference)" : ""}`,
    );
  }
  lines.push("");
  appendOwner(lines, plan);
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

/** The refusal text when no editable file owns the old GUID. */
export function ownerMissingText(plan: ReplaceGuidPlan): string {
  if (plan.ownerSkipped.length > 0) {
    return (
      `The resource that owns {${plan.oldGuid}} was found but cannot be edited ` +
      `(${plan.ownerSkipped.map((s) => `${s.relPath} [${s.projectId}]: ${s.reason}`).join("; ")}). ` +
      "Rewriting the references alone would leave them naming a GUID no resource owns."
    );
  }
  return (
    `No resource owning {${plan.oldGuid}} was found: no index row, and no .meta under the editable project roots ` +
    "has a Name line with it. Rewriting the references alone would leave them naming a GUID no resource owns."
  );
}

function appendOwner(lines: string[], plan: ReplaceGuidPlan): void {
  if (plan.ownerFiles.length > 0) {
    lines.push(`Owner (the resource's own GUID): ${plan.ownerFiles.join(", ")}`);
  } else {
    lines.push(`⚠ OWNER NOT FOUND. ${ownerMissingText(plan)}`);
    lines.push("A commit refuses unless `references_only: true` is passed.");
  }
  lines.push("");
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
        "Swap one 16-hex GUID for another across the project. Updates the owning resource's own GUID (a .gproj `GUID`, or the `Name` line of its `.meta` sidecar, found on disk when the index has no row) AND every braced/bare reference to it across all indexed files, plus braced `{GUID}` references in text files the index does not scan (e.g. .physmat; binaries and .bak skipped). " +
        "Default mode is DRY-RUN — produces a plan. Pass `commit: true` to actually write. " +
        "Refuses on collision (new GUID already names another resource), on uncommitted git changes (use `force: true` to override), or no-op (old == new). " +
        "When no editable owner is found the dry run says so and a commit refuses with an error, unless `references_only: true`. " +
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
        references_only: z
          .boolean()
          .default(false)
          .describe(
            "Commit even when no editable resource owns old_guid: rewrites the references only, leaving them on a GUID no resource owns. Default false refuses.",
          ),
      },
    },
    async ({ old_guid, new_guid, commit, force, include_workshop, references_only }) => {
      try {
        const oldNorm = normalizeGuid(old_guid);
        const newNorm = normalizeGuid(new_guid);
        const plan = buildPlan(db, index, oldNorm, newNorm, {
          includeWorkshop: include_workshop,
        });

        if (plan.collision || plan.oldGuid === plan.newGuid || plan.files.length === 0) {
          if (commit) {
            // A commit that cannot run is an error, not a quiet dry run (as refactor_move_resource_path).
            return {
              content: [
                {
                  type: "text" as const,
                  text: `REFUSED: nothing was rewritten.\n\n${formatPlan(plan, "dry-run")}`,
                },
              ],
              isError: true,
            };
          }
          return { content: [{ type: "text" as const, text: formatPlan(plan, "dry-run") }] };
        }

        if (!commit) {
          return { content: [{ type: "text" as const, text: formatPlan(plan, "dry-run") }] };
        }

        // No editable owner: the commit would leave dangling references.
        if (plan.ownerFiles.length === 0 && !references_only) {
          return {
            content: [
              {
                type: "text" as const,
                text:
                  `Error in refactor_replace_guid: refusing to commit. ${ownerMissingText(plan)} ` +
                  "Nothing was written. Pass `references_only: true` to rewrite the references anyway.\n\n" +
                  formatPlan(plan, "dry-run"),
              },
            ],
            isError: true,
          };
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
