/**
 * Project-index SQLite schema migrations.
 *
 * Inline SQL keeps the .sql file out of the build/ship pipeline. Each
 * migration is a self-contained DDL block applied inside a transaction.
 *
 * `openProjectIndex` is the public entry point: it opens (or creates) the
 * .db file, applies any missing migrations, and returns the ready Database
 * handle.
 */

import Database from "better-sqlite3";
import { logger } from "../utils/logger.js";

interface Migration {
  version: number;
  description: string;
  sql: string;
}

const SCHEMA_V1 = `
-- Resources: anything with a GUID — gproj, prefab, config, layout, world entity, etc.
CREATE TABLE IF NOT EXISTS resources (
  guid TEXT PRIMARY KEY,
  file_path TEXT NOT NULL,
  root_type TEXT NOT NULL,
  class_name TEXT,
  parent_inherit TEXT,
  source TEXT NOT NULL CHECK (source IN ('user', 'core', 'workshop')),
  last_indexed INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_resources_file ON resources(file_path);
CREATE INDEX IF NOT EXISTS idx_resources_class ON resources(class_name);
CREATE INDEX IF NOT EXISTS idx_resources_root_type ON resources(root_type);

-- References from one file to another resource (inheritance, asset path, dep, value).
CREATE TABLE IF NOT EXISTS resource_refs (
  source_file TEXT NOT NULL,
  target_guid TEXT NOT NULL,
  ref_kind TEXT NOT NULL CHECK (ref_kind IN ('inheritance', 'asset_path', 'dep', 'value')),
  context TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (source_file, target_guid, ref_kind, context)
);
CREATE INDEX IF NOT EXISTS idx_refs_target ON resource_refs(target_guid);
CREATE INDEX IF NOT EXISTS idx_refs_source ON resource_refs(source_file);

-- Per-file metadata for change-detection (skip-unchanged on re-scan).
CREATE TABLE IF NOT EXISTS files (
  path TEXT PRIMARY KEY,
  mtime INTEGER NOT NULL,
  size INTEGER NOT NULL,
  hash TEXT,
  source TEXT NOT NULL CHECK (source IN ('user', 'core', 'workshop')),
  last_indexed INTEGER NOT NULL
);

-- Projects (one per .gproj file).
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  guid TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  root_path TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('user', 'core', 'workshop')),
  last_scan INTEGER NOT NULL
);

-- Declared dependencies (entries from each .gproj's Dependencies block).
CREATE TABLE IF NOT EXISTS project_deps (
  project_id TEXT NOT NULL,
  dep_guid TEXT NOT NULL,
  PRIMARY KEY (project_id, dep_guid),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
`;

/**
 * v2: add `project_id` FK to `resources` for proper per-project counts and
 * faster per-project queries.
 *
 * SQLite's ALTER TABLE supports adding a column with a REFERENCES clause; the
 * FK is enforced only when `foreign_keys = ON` (set in `openProjectIndex`).
 * ON DELETE CASCADE: removing a project drops its resources from the index —
 * disk files are untouched, and a re-scan will re-detect them under whatever
 * project owns them next.
 *
 * Backfill strategy (audit-fix C-2): existing `resources` + `resource_refs`
 * rows are NOT wiped — that would be destructive on warm indexes. Instead
 * we clear ONLY `files` so the mtime-skip check doesn't block re-parsing
 * on the next crawl. As each file re-parses, `scanProject`'s upsert
 * statement runs `ON CONFLICT(guid) DO UPDATE SET ..., project_id = excluded.project_id`
 * which backfills `project_id` on every existing row. Refs are re-emitted
 * via `scanRefs` and the existing DELETE-then-INSERT-OR-IGNORE pattern
 * keeps them consistent. Net effect: same end state as a wipe-and-recrawl,
 * but with no observable empty-index window mid-migration.
 */
const SCHEMA_V2 = `
-- Add project_id column with FK + cascade.
ALTER TABLE resources ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_resources_project_id ON resources(project_id);

-- Clear ONLY the files table so mtime-skip doesn't prevent the backfill scan.
-- resources + resource_refs are preserved; the upcoming crawl's UPSERT
-- writes project_id into every existing row as files re-parse.
DELETE FROM files;
`;

/**
 * v3 (audit C2, 2026-09): `files` and `resource_refs` were keyed by the
 * project-RELATIVE path alone. Two addons that both ship `Prefabs/Foo.et`
 * clobbered each other's rows, a watcher unlink in one addon deleted the
 * other's rows too, and `refactor_replace_guid` picked an arbitrary owner
 * (`LIMIT 1`) — a silent partial refactor.
 *
 * Both tables now carry a NOT NULL `project_id` FK (ON DELETE CASCADE) and
 * their unique keys are `(project_id, path)` / `(project_id, source_file,
 * target_guid, ref_kind, context)`.
 *
 * SQLite can't add a NOT NULL column to a populated table nor rewrite a
 * PRIMARY KEY in place, so both tables are rebuilt:
 *
 *   - `resource_refs`: rows whose `source_file` maps to EXACTLY ONE owning
 *     project (via `resources.file_path` + `resources.project_id`) are
 *     carried over with that project_id. Ambiguous rows (the very collision
 *     this migration exists to fix) and rows with no owning resource are
 *     dropped — the forced re-crawl below re-emits them under the correct
 *     project. Same "no empty-index window" rationale as v2.
 *   - `files`: recreated EMPTY. That is the v2 re-crawl mechanism — with no
 *     mtime/size row to match, `scanProject` re-parses every file on the
 *     next crawl, which rewrites `files` and `resource_refs` with correct
 *     project scoping. `resources` is untouched.
 */
const SCHEMA_V3 = `
-- resource_refs: rebuild with project_id in the key.
CREATE TABLE resource_refs_v3 (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_file TEXT NOT NULL,
  target_guid TEXT NOT NULL,
  ref_kind TEXT NOT NULL CHECK (ref_kind IN ('inheritance', 'asset_path', 'dep', 'value')),
  context TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (project_id, source_file, target_guid, ref_kind, context)
);
INSERT OR IGNORE INTO resource_refs_v3 (project_id, source_file, target_guid, ref_kind, context)
  SELECT r.project_id, ref.source_file, ref.target_guid, ref.ref_kind, ref.context
    FROM resource_refs ref
    JOIN resources r ON r.file_path = ref.source_file AND r.project_id IS NOT NULL
   WHERE (SELECT COUNT(DISTINCT r2.project_id)
            FROM resources r2
           WHERE r2.file_path = ref.source_file AND r2.project_id IS NOT NULL) = 1;
DROP TABLE resource_refs;
ALTER TABLE resource_refs_v3 RENAME TO resource_refs;
CREATE INDEX IF NOT EXISTS idx_refs_target ON resource_refs(target_guid);
CREATE INDEX IF NOT EXISTS idx_refs_source ON resource_refs(project_id, source_file);

-- files: rebuild empty with project_id in the key (forces the re-crawl).
DROP TABLE files;
CREATE TABLE files (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  mtime INTEGER NOT NULL,
  size INTEGER NOT NULL,
  hash TEXT,
  source TEXT NOT NULL CHECK (source IN ('user', 'core', 'workshop')),
  last_indexed INTEGER NOT NULL,
  PRIMARY KEY (project_id, path)
);

-- resources: composite index so per-project path lookups don't scan.
CREATE INDEX IF NOT EXISTS idx_resources_project_file ON resources(project_id, file_path);
`;

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: "Initial project-index schema",
    sql: SCHEMA_V1,
  },
  {
    version: 2,
    description: "Add project_id FK to resources (forces re-crawl)",
    sql: SCHEMA_V2,
  },
  {
    version: 3,
    description: "Scope files + resource_refs by project_id (forces re-crawl)",
    sql: SCHEMA_V3,
  },
];

/**
 * Open the project-index database. Creates the file if missing, applies any
 * pending migrations, and returns the ready handle.
 *
 * @param dbPath Path to the .db file, or `":memory:"` for an in-memory DB
 *   (tests, ephemeral indexes).
 */
export function openProjectIndex(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

/** Highest migration version this build knows how to apply. */
export function currentSchemaVersion(): number {
  return Math.max(...MIGRATIONS.map((m) => m.version));
}

/**
 * TEST HELPER — open `dbPath` and apply migrations only up to `version`,
 * so a migration test can build a populated legacy DB (e.g. v2) and then
 * re-open it with {@link openProjectIndex} to exercise the upgrade path.
 * Not used by the server.
 */
export function openProjectIndexAtVersion(
  dbPath: string,
  version: number,
): Database.Database {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db, version);
  return db;
}

/**
 * Apply any pending migrations. Safe to call repeatedly — applied versions
 * are skipped.
 *
 * L6 (dual-process race): the version read and every pending migration run
 * inside ONE `BEGIN IMMEDIATE` transaction. The immediate write lock means a
 * second process opening the same .db concurrently blocks on the lock, then
 * re-reads the version AFTER the first process committed — so it sees the
 * migrations already applied instead of racing to apply them twice.
 */
function migrate(
  db: Database.Database,
  upTo: number = Number.MAX_SAFE_INTEGER,
): void {
  // Bootstrap: ensure the version table exists before reading.
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);

  const applyAll = db.transaction(() => {
    const currentVersion = getCurrentVersion(db);
    for (const m of MIGRATIONS) {
      if (m.version <= currentVersion) continue;
      if (m.version > upTo) break;
      logger.info(`Applying project-index migration v${m.version}: ${m.description}`);
      db.exec(m.sql);
      db.prepare(
        "INSERT INTO schema_version (version, applied_at) VALUES (?, ?)",
      ).run(m.version, Date.now());
    }
  });
  applyAll.immediate();
}

function getCurrentVersion(db: Database.Database): number {
  const row = db
    .prepare("SELECT MAX(version) AS v FROM schema_version")
    .get() as { v: number | null };
  return row.v ?? 0;
}
