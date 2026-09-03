/**
 * L2-4 verification — exercises the 5 reverse-query tool formatters against
 * the real on-disk DB. Confirms wiring + markdown shape end-to-end without
 * requiring an MCP server restart.
 *
 * Run: `npx tsx scripts/verify-l2-4.ts`
 * Safe to delete after L2-4 verified.
 */

import { loadConfig } from "../src/config.js";
import { openProjectIndex } from "../src/project-index/migrate.js";
import { ProjectIndex } from "../src/project-index/project-index.js";
import { formatUnusedPage, encodeCursor as encUnused } from "../src/tools/find-unused-resources.js";
import { formatBrokenPage, encodeCursor as encBroken } from "../src/tools/find-broken-refs.js";
import { formatChain } from "../src/tools/inheritance-chain.js";
import { formatListPage, encodeCursor as encList } from "../src/tools/list-resources.js";
import { formatDependencies } from "../src/tools/list-dependencies.js";

const config = loadConfig();
console.log(`[verify] index DB: ${config.projectIndexPath}`);
console.log("");

const db = openProjectIndex(config.projectIndexPath);
const index = new ProjectIndex(db);

function section(title: string): void {
  console.log("");
  console.log(`==================== ${title} ====================`);
}

// --- find_unused_resources --------------------------------------------------
section("find_unused_resources (source=user)");
const unused = index.findUnusedResources({ source: "user", limit: 10, offset: 0 });
const unusedNext =
  unused.offset + unused.rows.length < unused.total
    ? encUnused({ o: unused.offset + unused.rows.length, s: "user", v: 1 })
    : null;
console.log(
  formatUnusedPage({
    rows: unused.rows,
    total: unused.total,
    offset: unused.offset,
    sourceFilter: "user",
    nextCursor: unusedNext,
  }),
);

// --- find_broken_refs -------------------------------------------------------
section("find_broken_refs (no filter)");
const broken = index.findBrokenRefs({ limit: 10, offset: 0 });
const brokenNext =
  broken.offset + broken.rows.length < broken.total
    ? encBroken({ o: broken.offset + broken.rows.length, s: "*", v: 1 })
    : null;
console.log(
  formatBrokenPage({
    rows: broken.rows,
    total: broken.total,
    offset: broken.offset,
    sourceFilter: "*",
    nextCursor: brokenNext,
  }),
);

// --- inheritance_chain ------------------------------------------------------
// Pick a real GUID from the DB — Test1's addon.gproj (6968F5564CA31D9D).
section("inheritance_chain ({6968F5564CA31D9D})");
const chain = index.inheritanceChain("6968F5564CA31D9D");
console.log(formatChain({ startGuid: "6968F5564CA31D9D", chain }));

// --- list_resources ---------------------------------------------------------
section("list_resources (no filter)");
const list = index.listResources({ limit: 10, offset: 0 });
const listNext =
  list.offset + list.rows.length < list.total
    ? encList({ o: list.offset + list.rows.length, s: "*", t: "*", p: "*", v: 1 })
    : null;
console.log(
  formatListPage({
    rows: list.rows,
    total: list.total,
    offset: list.offset,
    filterDescription: "(all)",
    nextCursor: listNext,
  }),
);

// --- list_dependencies ------------------------------------------------------
section("list_dependencies (project_id=Test1)");
const deps = index.listDependencies("Test1");
console.log(formatDependencies({ projectId: "Test1", rows: deps }));

db.close();
console.log("");
console.log("[verify] done");
