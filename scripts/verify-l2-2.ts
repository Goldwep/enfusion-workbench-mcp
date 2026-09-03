/**
 * L2-2 verification helper.
 * Prints current resources state, then forces a re-crawl, then prints again.
 * Used to confirm project_id wiring end-to-end on the real DB.
 *
 * Run: `npx tsx scripts/verify-l2-2.ts`
 * Safe to delete after L2-2 is verified.
 */

import Database from "better-sqlite3";
import { loadConfig } from "../src/config.js";
import { openProjectIndex } from "../src/project-index/migrate.js";
import { crawl } from "../src/project-index/crawler.js";

const config = loadConfig();
console.log("[verify] project path:  ", config.projectPath);
console.log("[verify] index DB path: ", config.projectIndexPath);
console.log("");

const db: Database.Database = openProjectIndex(config.projectIndexPath);

function dumpResources(label: string): void {
  console.log(`=== ${label} ===`);
  const rows = db
    .prepare("SELECT guid, file_path, source, project_id FROM resources ORDER BY guid")
    .all() as { guid: string; file_path: string; source: string; project_id: string | null }[];
  for (const r of rows) {
    console.log(`  ${r.guid}  ${r.file_path}  source=${r.source}  project_id=${r.project_id ?? "<null>"}`);
  }
  console.log(`  total: ${rows.length}`);
  console.log("");
}

dumpResources("BEFORE forced re-crawl");

// Force re-parse by clearing the files mtime cache.
const cleared = db.prepare("DELETE FROM files").run();
console.log(`[verify] cleared ${cleared.changes} files-table rows to force re-scan`);
console.log("");

crawl(db, [{ path: config.projectPath, kind: "user" }]);
console.log("");

dumpResources("AFTER forced re-crawl");

db.close();
console.log("[verify] done");
