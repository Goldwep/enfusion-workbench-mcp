/**
 * `ProjectIndex` — wrapper class collocating every query against the
 * project-index SQLite database (L2-3).
 *
 * Tools (resolve_guid, find_references, find_unused_resources, etc.) call
 * methods here rather than hand-rolling SQL. Centralizing the queries
 * keeps the SQL surface diff-reviewable, surfaces query reuse, and gives a
 * single place to add schema-version awareness when v3+ migrations land.
 *
 * Constructor injection (matches CONVENTIONS): the DB handle is passed in;
 * the class never opens or closes the file. Lifecycle stays with the caller
 * (server.ts / tests).
 */

import type Database from "better-sqlite3";
import { resolve, dirname } from "node:path";
import type {
  ResourceRow,
  ResourceRefRow,
  ResourceSource,
  RefKind,
  ProjectRow,
} from "./types.js";

// ── Path helpers ─────────────────────────────────────────────────────────────

/**
 * True when `ancestor` is the same directory as `descendant`, or a parent of
 * it. Normalizes separators (chokidar, config, and the projects table may
 * disagree on `\` vs `/` on Windows) and compares case-insensitively on
 * Windows where the filesystem is case-insensitive. A trailing separator on
 * `ancestor` guards against `/foo/bar` matching `/foo/bartender`.
 */
export function isAncestorOrSelf(ancestor: string, descendant: string): boolean {
  const a = normalizePathForCompare(ancestor);
  const d = normalizePathForCompare(descendant);
  return d === a || d.startsWith(a + "/");
}

function normalizePathForCompare(p: string): string {
  let s = p.replace(/\\/g, "/").replace(/\/+$/, "");
  if (process.platform === "win32") s = s.toLowerCase();
  return s;
}

/**
 * Find the indexed project that owns `absPath`: the project whose
 * `root_path` is the LONGEST ancestor of the file's directory. This mirrors
 * how the crawler assigns ownership (every `files` / `resource_refs` /
 * `resources` row is keyed by `dirname(its .gproj)`), so the result is the
 * right `project_id` to scope any path-keyed query with (schema v3, C2).
 *
 * Returns null when no indexed project contains the path.
 */
export function resolveOwningProject(
  db: Database.Database,
  absPath: string,
): ProjectRow | null {
  const fileDir = dirname(absPath);
  const projects = db
    .prepare("SELECT id, guid, title, root_path, source, last_scan FROM projects")
    .all() as ProjectRow[];
  let best: ProjectRow | null = null;
  for (const p of projects) {
    if (
      isAncestorOrSelf(p.root_path, fileDir) &&
      (best === null || p.root_path.length > best.root_path.length)
    ) {
      best = p;
    }
  }
  return best;
}

// ── Shared result types ──────────────────────────────────────────────────────

/** Paged-query envelope. `total` is the COUNT(*) for the same WHERE filter. */
export interface PagedResult<T> {
  rows: T[];
  total: number;
  offset: number;
  limit: number;
}

/** A reference pointing at a target that doesn't exist in `resources`. */
export interface BrokenRef {
  /** Owning project of `source_file` (schema v3). */
  project_id: string;
  source_file: string;
  target_guid: string;
  ref_kind: RefKind;
  context: string;
}

/** One step in an inheritance chain, plus the next parent ref (if any). */
export interface InheritanceStep {
  guid: string;
  file_path: string;
  root_type: string;
  class_name: string | null;
  /**
   * Raw `parent_inherit` string from the row (`{GUID}path` form), null when
   * the resource doesn't inherit. Caller uses this for follow-up lookups.
   */
  parent_inherit: string | null;
}

/** Result of `inheritanceChain` — the chain plus a truncation marker. */
export interface InheritanceChain {
  steps: InheritanceStep[];
  /**
   * True when the walker stopped because it hit `maxDepth`, false when it
   * stopped naturally (root reached, parent unresolvable, or cycle detected).
   */
  truncated: boolean;
  /** Set when the walker stopped because of an unresolved parent. */
  unresolvedParent: string | null;
  /** Set when the walker detected a cycle (rare, indicates broken data). */
  cycleDetected: boolean;
}

/** One row of `listDependencies` output — joined with the target resource. */
export interface DependencyRow {
  dep_guid: string;
  /** When the dep GUID resolves to an indexed resource, fields are populated. */
  file_path: string | null;
  root_type: string | null;
  source: ResourceSource | null;
}

// ── Filter shapes ────────────────────────────────────────────────────────────

export interface ListResourcesFilter {
  source?: ResourceSource;
  rootType?: string;
  projectId?: string;
  limit: number;
  offset: number;
}

export interface PagedFilter {
  source?: ResourceSource;
  limit: number;
  offset: number;
}

// ── Public class ─────────────────────────────────────────────────────────────

/** 16-hex GUID matcher — used to strip braces from `parent_inherit`. */
const GUID_PREFIX = /^\{([0-9A-Fa-f]{16})\}/;

export class ProjectIndex {
  constructor(private readonly db: Database.Database) {}

  /**
   * Owning project for an absolute on-disk path (longest matching
   * `projects.root_path`). See {@link resolveOwningProject}.
   */
  resolveOwningProject(absPath: string): ProjectRow | null {
    return resolveOwningProject(this.db, absPath);
  }

  /**
   * Every file that references `targetGuid`, joined with its owning project
   * so callers can resolve `source_file` against the RIGHT root and filter
   * by the project's source (user / core / workshop). Schema v3: the same
   * relative path may appear once per project.
   */
  referencingFiles(targetGuid: string): {
    project_id: string;
    source_file: string;
    root_path: string;
    source: ResourceSource;
  }[] {
    return this.db
      .prepare(
        `SELECT DISTINCT ref.project_id AS project_id,
                ref.source_file AS source_file,
                p.root_path AS root_path,
                p.source AS source
           FROM resource_refs ref
           JOIN projects p ON p.id = ref.project_id
          WHERE ref.target_guid = ?
          ORDER BY ref.project_id, ref.source_file`,
      )
      .all(targetGuid) as {
      project_id: string;
      source_file: string;
      root_path: string;
      source: ResourceSource;
    }[];
  }

  /**
   * Look up a single resource by its 16-hex GUID. Returns null when the
   * GUID isn't in the project-index.
   */
  resolveGuid(normalizedGuid: string): ResourceRow | null {
    const row = this.db
      .prepare(
        "SELECT guid, file_path, root_type, class_name, parent_inherit, source, last_indexed " +
          "FROM resources WHERE guid = ?",
      )
      .get(normalizedGuid) as ResourceRow | undefined;
    return row ?? null;
  }

  /**
   * Resolve the absolute on-disk path for a resource, keyed by its GUID.
   *
   * `resources.file_path` is stored relative to the OWNING project's
   * `root_path`, so a bare file_path is useless on its own — it's neither
   * absolute nor reliably CWD-relative (RBE-8). This joins the resource to
   * its owning project (schema v2 `project_id` FK) and resolves file_path
   * against that project's `root_path`.
   *
   * Returns null when the GUID isn't indexed, or when the resource has no
   * owning project (NULL project_id — pre-v2-backfill rows) so the caller can
   * fall back / flag the row instead of emitting a wrong path.
   */
  resolveAbsPathByGuid(guid: string): string | null {
    const row = this.db
      .prepare(
        `SELECT p.root_path AS root_path, r.file_path AS file_path
           FROM resources r
           JOIN projects p ON p.id = r.project_id
          WHERE r.guid = ?
          LIMIT 1`,
      )
      .get(guid) as { root_path: string; file_path: string } | undefined;
    if (!row) return null;
    return resolve(row.root_path, row.file_path);
  }

  /**
   * Resources with zero inbound references — index-orphans that no
   * inheritance / asset_path / dep / value entry points at.
   *
   * Filterable by source so callers can scope to user-mod content (the
   * common use case) without seeing every unreferenced core resource.
   */
  findUnusedResources(filter: PagedFilter): PagedResult<ResourceRow> {
    const sourceClause = filter.source ? " AND r.source = ?" : "";
    const args: (string | number)[] = filter.source ? [filter.source] : [];

    const countRow = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM resources r
         LEFT JOIN resource_refs ref ON ref.target_guid = r.guid
         WHERE ref.target_guid IS NULL${sourceClause}`,
      )
      .get(...args) as { n: number };

    const rows = this.db
      .prepare(
        `SELECT r.guid, r.file_path, r.root_type, r.class_name, r.parent_inherit, r.source, r.last_indexed
         FROM resources r
         LEFT JOIN resource_refs ref ON ref.target_guid = r.guid
         WHERE ref.target_guid IS NULL${sourceClause}
         ORDER BY r.guid
         LIMIT ? OFFSET ?`,
      )
      .all(...args, filter.limit, filter.offset) as ResourceRow[];

    return { rows, total: countRow.n, offset: filter.offset, limit: filter.limit };
  }

  /**
   * References whose target GUID doesn't exist in the `resources` table —
   * broken inheritance, asset paths, or value refs. The most useful pre-publish
   * check.
   */
  findBrokenRefs(filter: PagedFilter): PagedResult<BrokenRef> {
    // `source` filter applies to the file the BROKEN REF is in. We need a
    // join through `files` since resource_refs doesn't carry the source.
    //
    // Audit-fix BUG-1: when a source filter is supplied, use INNER JOIN —
    // not LEFT JOIN — against `files`. A LEFT JOIN + a WHERE predicate on
    // the right-hand table silently degrades to INNER JOIN semantics AND
    // drops rows where `files` is missing the source_file row, so an
    // unindexed-source ref would vanish from results. Explicit INNER JOIN
    // documents the intent and is no slower than the implicit form.
    //
    // Schema v3: the `files` join is scoped by project_id as well as path —
    // the same relative path can exist in several projects.
    const sourceClause = filter.source ? " AND f.source = ?" : "";
    const fromClause = filter.source
      ? "FROM resource_refs ref LEFT JOIN resources r ON r.guid = ref.target_guid INNER JOIN files f ON f.project_id = ref.project_id AND f.path = ref.source_file"
      : "FROM resource_refs ref LEFT JOIN resources r ON r.guid = ref.target_guid";
    const args: (string | number)[] = filter.source ? [filter.source] : [];

    const countRow = this.db
      .prepare(
        `SELECT COUNT(*) AS n ${fromClause}
         WHERE r.guid IS NULL${sourceClause}`,
      )
      .get(...args) as { n: number };

    const rows = this.db
      .prepare(
        `SELECT ref.project_id, ref.source_file, ref.target_guid, ref.ref_kind, ref.context ${fromClause}
         WHERE r.guid IS NULL${sourceClause}
         ORDER BY ref.project_id, ref.source_file, ref.target_guid, ref.ref_kind
         LIMIT ? OFFSET ?`,
      )
      .all(...args, filter.limit, filter.offset) as BrokenRef[];

    return { rows, total: countRow.n, offset: filter.offset, limit: filter.limit };
  }

  /**
   * Walk the inheritance chain starting at `startGuid`. Each step's
   * `parent_inherit` is parsed to extract the next GUID, which is then
   * looked up in `resources`. Stops at: a root with no parent, an
   * unresolvable parent, `maxDepth`, or a cycle.
   */
  inheritanceChain(startGuid: string, maxDepth: number = 32): InheritanceChain {
    const result: InheritanceChain = {
      steps: [],
      truncated: false,
      unresolvedParent: null,
      cycleDetected: false,
    };

    const visited = new Set<string>();
    let currentGuid: string | null = startGuid;
    let depth = 0;

    while (currentGuid !== null) {
      if (depth >= maxDepth) {
        result.truncated = true;
        return result;
      }
      if (visited.has(currentGuid)) {
        result.cycleDetected = true;
        return result;
      }
      visited.add(currentGuid);

      const row = this.resolveGuid(currentGuid);
      if (!row) {
        // Couldn't resolve — record the unresolved parent and stop. The
        // first step is special: if even the START is unresolvable, the
        // chain is empty and the unresolved guid IS the start.
        result.unresolvedParent = currentGuid;
        return result;
      }

      result.steps.push({
        guid: row.guid,
        file_path: row.file_path,
        root_type: row.root_type,
        class_name: row.class_name,
        parent_inherit: row.parent_inherit,
      });

      // Extract the next GUID from `parent_inherit` ({GUID}path form).
      if (!row.parent_inherit) {
        // Natural end of chain — root reached.
        return result;
      }
      const match = GUID_PREFIX.exec(row.parent_inherit);
      if (!match) {
        // parent_inherit is in some non-GUID form (rare, malformed data).
        return result;
      }
      currentGuid = match[1].toUpperCase();
      depth += 1;
    }

    return result;
  }

  /**
   * Paginated list of resources, filterable by source / root_type / project_id.
   * Ordered by guid for deterministic pagination.
   */
  listResources(filter: ListResourcesFilter): PagedResult<ResourceRow> {
    const clauses: string[] = [];
    const args: (string | number)[] = [];
    if (filter.source) {
      clauses.push("source = ?");
      args.push(filter.source);
    }
    if (filter.rootType) {
      clauses.push("root_type = ?");
      args.push(filter.rootType);
    }
    if (filter.projectId) {
      clauses.push("project_id = ?");
      args.push(filter.projectId);
    }
    const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

    const countRow = this.db
      .prepare(`SELECT COUNT(*) AS n FROM resources ${whereClause}`)
      .get(...args) as { n: number };

    const rows = this.db
      .prepare(
        `SELECT guid, file_path, root_type, class_name, parent_inherit, source, last_indexed
         FROM resources
         ${whereClause}
         ORDER BY guid
         LIMIT ? OFFSET ?`,
      )
      .all(...args, filter.limit, filter.offset) as ResourceRow[];

    return { rows, total: countRow.n, offset: filter.offset, limit: filter.limit };
  }

  /**
   * Dependencies declared by a project's `.gproj`, joined with the resource
   * row for each dep (when the dep is indexed) so callers can see what each
   * dep actually resolves to. Returns empty when the project_id is unknown.
   */
  listDependencies(projectId: string): DependencyRow[] {
    return this.db
      .prepare(
        `SELECT pd.dep_guid,
                r.file_path AS file_path,
                r.root_type AS root_type,
                r.source AS source
         FROM project_deps pd
         LEFT JOIN resources r ON r.guid = pd.dep_guid
         WHERE pd.project_id = ?
         ORDER BY pd.dep_guid`,
      )
      .all(projectId) as DependencyRow[];
  }

  /**
   * Indexed file paths joined with their owning project's root_path. Used by
   * `asset_orphan_scan` to enumerate the disk roots to walk and the indexed
   * files to scan for asset-path references.
   *
   * `source` filters by file source (user/core/workshop).
   *
   * Audit-fix BUG-2: this used to INNER JOIN through `resources`, which
   * silently dropped any file lacking a resources row — SubScene files
   * (canonically untyped, just a `Parent "{GUID}path"` wrapper) and any
   * future asset class without a GUID. Their on-disk content references
   * textures/meshes that asset_orphan_scan needed to see, so the INNER JOIN
   * produced false-positive orphans.
   *
   * Fix is a LEFT JOIN: untyped files now surface with `root_type` /
   * `class_name` / `guid` set to `null`. Callers that only care about typed
   * resources pass `{include_untyped: false}`.
   *
   * Schema v3: `files.project_id` is a NOT NULL FK, so `project_id` and
   * `root_path` are always populated — untyped files included. The
   * `string | null` return type is kept for source compatibility with
   * existing consumers that null-check.
   *
   * Sort order is deterministic (project_id, file_path) for stable paging
   * downstream.
   */
  listIndexedProjectFiles(
    source?: ResourceSource,
    options?: { include_untyped?: boolean },
  ): {
    project_id: string | null;
    root_path: string | null;
    file_path: string;
    source: ResourceSource;
    root_type: string | null;
    class_name: string | null;
    guid: string | null;
  }[] {
    const includeUntyped = options?.include_untyped ?? true;
    const clauses: string[] = [];
    const args: string[] = [];
    if (source) {
      clauses.push("f.source = ?");
      args.push(source);
    }
    if (!includeUntyped) {
      // Caller wants only files with a backing resources row.
      clauses.push("r.guid IS NOT NULL");
    }
    const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    return this.db
      .prepare(
        `SELECT p.id AS project_id,
                p.root_path AS root_path,
                f.path AS file_path,
                f.source AS source,
                r.root_type AS root_type,
                r.class_name AS class_name,
                r.guid AS guid
         FROM files f
         JOIN projects p ON p.id = f.project_id
         LEFT JOIN resources r ON r.project_id = f.project_id AND r.file_path = f.path
         ${whereClause}
         GROUP BY f.project_id, f.path
         ORDER BY f.project_id, f.path`,
      )
      .all(...args) as {
      project_id: string | null;
      root_path: string | null;
      file_path: string;
      source: ResourceSource;
      root_type: string | null;
      class_name: string | null;
      guid: string | null;
    }[];
  }

  /**
   * Paginated `find_references` query — the L2-3 home for what `find_references.ts`
   * currently hand-rolls. New tools should consume this; the existing tool
   * can migrate during L5 cleanup.
   */
  findReferences(
    targetGuid: string,
    kind: RefKind | "any",
    limit: number,
    offset: number,
  ): PagedResult<ResourceRefRow> {
    const kindClause = kind !== "any" ? " AND ref_kind = ?" : "";
    const args: (string | number)[] =
      kind !== "any" ? [targetGuid, kind] : [targetGuid];

    const countRow = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM resource_refs
         WHERE target_guid = ?${kindClause}`,
      )
      .get(...args) as { n: number };

    const rows = this.db
      .prepare(
        `SELECT project_id, source_file, target_guid, ref_kind, context
         FROM resource_refs
         WHERE target_guid = ?${kindClause}
         ORDER BY project_id, source_file, ref_kind, context
         LIMIT ? OFFSET ?`,
      )
      .all(...args, limit, offset) as ResourceRefRow[];

    return { rows, total: countRow.n, offset, limit };
  }
}
