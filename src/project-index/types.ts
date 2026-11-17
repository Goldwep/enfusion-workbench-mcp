/**
 * Type definitions for the project-index SQLite store.
 *
 * Row shapes mirror the schema in migrate.ts. Keep in sync when adding
 * migrations.
 */

/** Where a resource was discovered. Determines indexing priority and filters. */
export type ResourceSource = "user" | "core" | "workshop";

/** How a reference is expressed in the source file. */
export type RefKind =
  /** `Class : "{GUID}path/parent.et"` — inheritance clause on a node. */
  | "inheritance"
  /** `Key "{GUID}path/file.ext"` — property value pointing at another resource. */
  | "asset_path"
  /** Entry inside a `Dependencies { ... }` block in a .gproj. */
  | "dep"
  /** Standalone `{GUID}`-shaped value inside a values block (rare). */
  | "value";

/**
 * One row of the `resources` table (schema v4: one row per file).
 *
 * `guid` is the RESOURCE GUID that `{GUID}path` references use: the `Name`
 * line of the file's `.meta` sidecar, or a `.gproj`'s `GUID` property. It is
 * never an `.et` root `ID` (an entity id) nor a node id; that value is kept
 * separately in `entity_id`. `root_type` is the parsed root node type for
 * Enfusion text files, or the file extension (e.g. `.edds`) for resources the
 * index does not parse.
 */
export interface ResourceRow {
  guid: string;
  file_path: string;
  root_type: string;
  class_name: string | null;
  parent_inherit: string | null;
  source: ResourceSource;
  last_indexed: number;
  /** Owning project (schema v2+). Present when the query selects it. */
  project_id?: string | null;
  /** Root `ID` (entity id) of an `.et`, when the query selects it. */
  entity_id?: string | null;
}

/** One row of the `resource_refs` table (schema v3: keyed by project). */
export interface ResourceRefRow {
  /** Owning project (`projects.id`) — the project `source_file` is relative to. */
  project_id: string;
  source_file: string;
  target_guid: string;
  ref_kind: RefKind;
  /** Property name (or empty string) where the ref was found, for find_references context. */
  context: string;
}

/** One row of the `files` table — per-file metadata for change-detection (schema v3: keyed by project). */
export interface FileRow {
  /** Owning project (`projects.id`) — the project `path` is relative to. */
  project_id: string;
  path: string;
  mtime: number;
  size: number;
  hash: string | null;
  source: ResourceSource;
  last_indexed: number;
}

/** One row of the `projects` table — one per discovered .gproj. */
export interface ProjectRow {
  id: string;
  guid: string;
  title: string;
  root_path: string;
  source: ResourceSource;
  last_scan: number;
}

/** One row of the `project_deps` table — Dependencies entries from a .gproj. */
export interface ProjectDepRow {
  project_id: string;
  dep_guid: string;
}
