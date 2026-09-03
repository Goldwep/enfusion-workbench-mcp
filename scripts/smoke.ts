/**
 * Smoke test — populates the project-index from the user's real project
 * directory and runs a few queries to verify the pipeline end-to-end.
 *
 * Usage:
 *   npx tsx scripts/smoke.ts
 *
 * Respects the standard env vars (ENFUSION_PROJECT_PATH,
 * ENFUSION_PROJECT_INDEX_PATH, etc.). With no env, crawls the default
 * user-addons path and writes to ~/.enfusion-mcp/project-index.db.
 */

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { loadConfig } from "../src/config.js";
import { openProjectIndex } from "../src/project-index/migrate.js";
import { crawl } from "../src/project-index/crawler.js";

const config = loadConfig();

console.error(`[smoke] project path:  ${config.projectPath}`);
console.error(`[smoke] index DB path: ${config.projectIndexPath}`);
console.error("");

mkdirSync(dirname(config.projectIndexPath), { recursive: true });
const db = openProjectIndex(config.projectIndexPath);

const t0 = Date.now();
const result = crawl(db, [{ path: config.projectPath, kind: "user" }]);
const elapsedMs = Date.now() - t0;

console.error("=== Crawl result ===");
console.error(`Projects found:        ${result.projectsFound}`);
console.error(`Projects indexed:      ${result.projectsIndexed}`);
console.error(`Files scanned:         ${result.files.filesScanned}`);
console.error(`Files skipped:         ${result.files.filesSkipped}`);
console.error(`Resources upserted:    ${result.files.resourcesUpserted}`);
console.error(`Refs extracted:        ${result.refs.totalExtracted}`);
console.error(`Refs unique in DB:     ${result.refs.totalUnique}`);
console.error(`Errors:                ${result.errors.length}`);
console.error(`Unindexable:           ${result.files.unindexable.length}`);
console.error(`Elapsed:               ${elapsedMs}ms`);

if (result.errors.length > 0) {
  console.error("");
  console.error("=== Errors (first 5) ===");
  for (const err of result.errors.slice(0, 5)) {
    console.error(`  ${err.path}: ${err.reason}`);
  }
}

if (result.files.unindexable.length > 0) {
  console.error("");
  console.error("=== Unindexable (by design, not errors — first 5) ===");
  for (const u of result.files.unindexable.slice(0, 5)) {
    console.error(`  ${u.path}: ${u.reason}`);
  }
}

console.error("");
console.error("=== Indexed projects ===");
const projects = db
  .prepare(
    "SELECT id, title, source, last_scan FROM projects ORDER BY last_scan DESC",
  )
  .all() as { id: string; title: string; source: string; last_scan: number }[];
for (const p of projects) {
  console.error(`  [${p.source}] ${p.id} — ${p.title}`);
}

console.error("");
console.error("=== Top 5 most-referenced GUIDs ===");
const topRefs = db
  .prepare(
    `SELECT target_guid, COUNT(*) AS ref_count
     FROM resource_refs
     WHERE ref_kind IN ('asset_path', 'value', 'inheritance')
     GROUP BY target_guid
     ORDER BY ref_count DESC
     LIMIT 5`,
  )
  .all() as { target_guid: string; ref_count: number }[];
for (const row of topRefs) {
  console.error(`  {${row.target_guid}} — ${row.ref_count} refs`);
}

db.close();
console.error("");
console.error("[smoke] OK");
