import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { openProjectIndex } from "../../src/project-index/migrate.js";
import {
  formatStatus,
  formatRelativeDuration,
  formatBytes,
  queryTotals,
  queryProjectRollups,
  readDbLocation,
  type IndexTotals,
  type ProjectRollup,
  type DbLocation,
} from "../../src/tools/project-index-status.js";

/** Frozen `now` so relative-duration assertions stay stable. */
const NOW_MS = new Date("2026-05-21T12:00:00.000Z").getTime();

const EMPTY_TOTALS: IndexTotals = { projects: 0, resources: 0, refs: 0, files: 0 };
const MEMORY_DB: DbLocation = { name: ":memory:", sizeBytes: null };

describe("formatRelativeDuration", () => {
  it("renders 'seconds ago' under a minute", () => {
    expect(formatRelativeDuration(NOW_MS, NOW_MS - 5_000)).toBe("5 seconds ago");
  });

  it("renders 'minutes ago' under an hour", () => {
    expect(formatRelativeDuration(NOW_MS, NOW_MS - 3 * 60_000)).toBe("3 minutes ago");
  });

  it("renders 'hours ago' under a day", () => {
    expect(formatRelativeDuration(NOW_MS, NOW_MS - 2 * 3_600_000)).toBe("2 hours ago");
  });

  it("renders 'yesterday' at exactly one day", () => {
    expect(formatRelativeDuration(NOW_MS, NOW_MS - 24 * 3_600_000)).toBe("yesterday");
  });
});

describe("formatBytes", () => {
  it("formats sub-KB sizes in bytes", () => {
    expect(formatBytes(512)).toBe("512 B");
  });

  it("formats KB sizes", () => {
    expect(formatBytes(2048)).toBe("2.0 KB");
  });

  it("formats MB sizes", () => {
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});

describe("formatStatus", () => {
  it("renders zero-project case with an explicit '(No projects indexed.)' marker", () => {
    const text = formatStatus(EMPTY_TOTALS, [], MEMORY_DB, NOW_MS);
    expect(text).toContain("## Project Index Status");
    expect(text).toContain("**Total projects:** 0");
    expect(text).toContain("**Total resources:** 0");
    expect(text).toContain("**Total references:** 0");
    expect(text).toContain("**Total files tracked:** 0");
    expect(text).toContain("(No projects indexed.)");
    // In-memory DBs render as "in-memory" not as the literal ":memory:" string.
    expect(text).toContain("in-memory");
  });

  it("renders one project with its title, source, path, and resource count", () => {
    const totals: IndexTotals = { projects: 1, resources: 42, refs: 7, files: 12 };
    const project: ProjectRollup = {
      id: "addons/MyMod",
      title: "MyMod",
      source: "user",
      root_path: "C:/Users/Test/MyMod",
      last_scan: NOW_MS - 3 * 60_000,
      resourceCount: 42,
    };
    const text = formatStatus(totals, [project], MEMORY_DB, NOW_MS);

    expect(text).toContain("**Total projects:** 1");
    expect(text).toContain("**Total resources:** 42");
    expect(text).toContain("**Total references:** 7");
    expect(text).toContain("**Total files tracked:** 12");
    expect(text).toContain("MyMod");
    expect(text).toContain("source=user");
    expect(text).toContain("3 minutes ago");
    expect(text).toContain("C:/Users/Test/MyMod");
    expect(text).toContain("42");
    // Negative assertion: empty-state marker must NOT appear when there's data.
    expect(text).not.toContain("(No projects indexed.)");
  });

  it("renders multiple projects in the order provided (last_scan DESC by caller convention)", () => {
    const totals: IndexTotals = { projects: 3, resources: 100, refs: 50, files: 80 };
    // Caller is responsible for ordering — formatStatus is order-preserving.
    const projects: ProjectRollup[] = [
      {
        id: "addons/Alpha",
        title: "Alpha",
        source: "user",
        root_path: "/p/Alpha",
        last_scan: NOW_MS - 2 * 60_000, // 2 minutes ago — newest
        resourceCount: 40,
      },
      {
        id: "addons/Bravo",
        title: "Bravo",
        source: "workshop",
        root_path: "/p/Bravo",
        last_scan: NOW_MS - 2 * 3_600_000, // 2 hours ago
        resourceCount: 35,
      },
      {
        id: "addons/Charlie",
        title: "Charlie",
        source: "core",
        root_path: "/p/Charlie",
        last_scan: NOW_MS - 5 * 24 * 3_600_000, // 5 days ago — oldest
        resourceCount: 25,
      },
    ];
    const text = formatStatus(totals, projects, MEMORY_DB, NOW_MS);

    // All three titles present.
    expect(text).toContain("Alpha");
    expect(text).toContain("Bravo");
    expect(text).toContain("Charlie");

    // Numbered list reflects provided order.
    expect(text).toContain("1. **Alpha**");
    expect(text).toContain("2. **Bravo**");
    expect(text).toContain("3. **Charlie**");

    // Index of each title in the rendered string must follow the provided order.
    const alphaIdx = text.indexOf("Alpha");
    const bravoIdx = text.indexOf("Bravo");
    const charlieIdx = text.indexOf("Charlie");
    expect(alphaIdx).toBeGreaterThan(0);
    expect(bravoIdx).toBeGreaterThan(alphaIdx);
    expect(charlieIdx).toBeGreaterThan(bravoIdx);

    // Different relative-time buckets for each.
    expect(text).toContain("2 minutes ago");
    expect(text).toContain("2 hours ago");
    expect(text).toContain("5 days ago");
  });
});

describe("formatStatus stale-project line (M16)", () => {
  it("reports removed stale projects when given", () => {
    const text = formatStatus(EMPTY_TOTALS, [], MEMORY_DB, NOW_MS, [
      { id: "addons/Gone", root_path: "/p/Gone" },
    ]);
    expect(text).toContain("Removed 1 stale project");
    expect(text).toContain("addons/Gone");
  });

  it("omits the line when nothing was removed", () => {
    const text = formatStatus(EMPTY_TOTALS, [], MEMORY_DB, NOW_MS);
    expect(text).not.toContain("stale project");
  });
});

describe("integration: open in-memory DB, seed, query, and format", () => {
  it("reports seeded totals and per-project rollup through the helpers end-to-end", () => {
    const db: Database.Database = openProjectIndex(":memory:");

    // Seed two projects, three resources (two share source=user), two refs, one file.
    db.prepare(
      "INSERT INTO projects (id, guid, title, root_path, source, last_scan) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("addons/Alpha", "AAAA000000000001", "Alpha", "/p/Alpha", "user", NOW_MS - 60_000);
    db.prepare(
      "INSERT INTO projects (id, guid, title, root_path, source, last_scan) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("addons/Bravo", "AAAA000000000002", "Bravo", "/p/Bravo", "workshop", NOW_MS - 90 * 60_000);

    const insertResource = db.prepare(
      "INSERT INTO resources (guid, file_path, root_type, class_name, parent_inherit, source, last_indexed) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    insertResource.run("ABCDEF0000000001", "Alpha/a.et", "Prefab", "Cls1", null, "user", NOW_MS);
    insertResource.run("ABCDEF0000000002", "Alpha/b.et", "Prefab", "Cls2", null, "user", NOW_MS);
    insertResource.run("ABCDEF0000000003", "Bravo/c.et", "Prefab", "Cls3", null, "workshop", NOW_MS);

    db.prepare(
      "INSERT INTO resource_refs (project_id, source_file, target_guid, ref_kind, context) VALUES (?, ?, ?, ?, ?)",
    ).run("addons/Alpha", "Alpha/a.et", "ABCDEF0000000002", "asset_path", "m_Other");
    db.prepare(
      "INSERT INTO resource_refs (project_id, source_file, target_guid, ref_kind, context) VALUES (?, ?, ?, ?, ?)",
    ).run("addons/Bravo", "Bravo/c.et", "ABCDEF0000000001", "inheritance", "");

    db.prepare(
      "INSERT INTO files (project_id, path, mtime, size, hash, source, last_indexed) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run("addons/Alpha", "Alpha/a.et", NOW_MS, 1234, null, "user", NOW_MS);

    // --- Query through the helpers ---
    const totals = queryTotals(db);
    expect(totals).toEqual({ projects: 2, resources: 3, refs: 2, files: 1 });

    const rollups = queryProjectRollups(db);
    expect(rollups).toHaveLength(2);
    // Alpha last_scan (-1m) is newer than Bravo (-90m) → Alpha first.
    expect(rollups[0].title).toBe("Alpha");
    expect(rollups[1].title).toBe("Bravo");
    // resourceCount uses the source-grouping approximation:
    //   Alpha (source=user) → 2 user resources.
    //   Bravo (source=workshop) → 1 workshop resource.
    expect(rollups[0].resourceCount).toBe(2);
    expect(rollups[1].resourceCount).toBe(1);

    const location = readDbLocation(db);
    expect(location.name).toBe(":memory:");
    expect(location.sizeBytes).toBeNull();

    // --- Format and verify structure ---
    const text = formatStatus(totals, rollups, location, NOW_MS);
    expect(text).toContain("## Project Index Status");
    expect(text).toContain("**Total projects:** 2");
    expect(text).toContain("**Total resources:** 3");
    expect(text).toContain("**Total references:** 2");
    expect(text).toContain("**Total files tracked:** 1");
    expect(text).toContain("in-memory");
    expect(text).toContain("1. **Alpha**");
    expect(text).toContain("source=user");
    expect(text).toContain("2. **Bravo**");
    expect(text).toContain("source=workshop");
    expect(text).toContain("/p/Alpha");
    expect(text).toContain("/p/Bravo");

    db.close();
  });
});
