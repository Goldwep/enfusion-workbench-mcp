import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { openProjectIndex } from "../../src/project-index/migrate.js";
import { ProjectIndex } from "../../src/project-index/project-index.js";

/** Seed an in-memory DB with a small fixture: 1 project, 4 resources, 3 refs. */
function seed(db: Database.Database): void {
  const now = Date.now();
  db.prepare(
    "INSERT INTO projects (id, guid, title, root_path, source, last_scan) VALUES (?, ?, ?, ?, ?, ?)",
  ).run("TestMod", "1111111111111111", "Test Mod", "/x", "user", now);
  // A core project so core-sourced files have an owner (schema v3 FK).
  db.prepare(
    "INSERT INTO projects (id, guid, title, root_path, source, last_scan) VALUES (?, ?, ?, ?, ?, ?)",
  ).run("Vanilla", "2222222222222222", "Vanilla", "/core", "core", now);

  // Two project_deps.
  db.prepare("INSERT INTO project_deps (project_id, dep_guid) VALUES (?, ?)").run(
    "TestMod",
    "AAAA000000000001",
  );
  db.prepare("INSERT INTO project_deps (project_id, dep_guid) VALUES (?, ?)").run(
    "TestMod",
    "AAAA000000000002",
  );

  const insertRes = db.prepare(
    "INSERT INTO resources (guid, file_path, root_type, class_name, parent_inherit, source, project_id, last_indexed) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  // Project's own gproj.
  insertRes.run(
    "1111111111111111",
    "addon.gproj",
    "GameProject",
    null,
    null,
    "user",
    "TestMod",
    now,
  );
  // A base prefab — referenced by inheritance.
  insertRes.run(
    "BBBB000000000001",
    "prefabs/base.et",
    "GenericEntity",
    null,
    null,
    "user",
    "TestMod",
    now,
  );
  // A child prefab inheriting from the base.
  insertRes.run(
    "BBBB000000000002",
    "prefabs/child.et",
    "GenericEntity",
    null,
    "{BBBB000000000001}prefabs/base.et",
    "user",
    "TestMod",
    now,
  );
  // An unused resource — nothing references it.
  insertRes.run(
    "CCCC000000000001",
    "configs/orphan.conf",
    "SomeConfig",
    null,
    null,
    "user",
    "TestMod",
    now,
  );

  const insertRef = db.prepare(
    "INSERT INTO resource_refs (project_id, source_file, target_guid, ref_kind, context) VALUES (?, ?, ?, ?, ?)",
  );
  // child inherits base — inbound ref to BBBB000000000001
  insertRef.run("TestMod", "prefabs/child.et", "BBBB000000000001", "inheritance", "");
  // Two dep refs in the gproj.
  insertRef.run("TestMod", "addon.gproj", "AAAA000000000001", "dep", "Dependencies");
  insertRef.run("TestMod", "addon.gproj", "AAAA000000000002", "dep", "Dependencies");
  // A broken ref — points at a GUID that doesn't exist in resources.
  insertRef.run("TestMod", "configs/broken.conf", "DEADDEADDEADDEAD", "asset_path", "BadProp");
}

describe("ProjectIndex", () => {
  let db: Database.Database;
  let index: ProjectIndex;

  beforeEach(() => {
    db = openProjectIndex(":memory:");
    seed(db);
    index = new ProjectIndex(db);
  });

  describe("resolveGuid", () => {
    it("returns the row for a known GUID", () => {
      const row = index.resolveGuid("BBBB000000000001");
      expect(row).not.toBeNull();
      expect(row!.file_path).toBe("prefabs/base.et");
      expect(row!.root_type).toBe("GenericEntity");
    });

    it("returns null for an unknown GUID", () => {
      expect(index.resolveGuid("FFFF000000000000")).toBeNull();
    });
  });

  describe("findUnusedResources", () => {
    it("returns resources with zero inbound refs", () => {
      const result = index.findUnusedResources({ limit: 100, offset: 0 });
      // The orphan + the two GenericEntities that aren't referenced + the gproj.
      // Actually: BBBB000000000001 IS referenced (by child via inheritance). The
      // child itself isn't referenced. The orphan isn't. The gproj isn't.
      const guids = result.rows.map((r) => r.guid).sort();
      expect(guids).toContain("CCCC000000000001"); // explicit orphan
      expect(guids).toContain("BBBB000000000002"); // child (no inbound)
      expect(guids).toContain("1111111111111111"); // gproj (no inbound)
      expect(guids).not.toContain("BBBB000000000001"); // referenced by child
      expect(result.total).toBe(result.rows.length);
    });

    it("filters by source", () => {
      const result = index.findUnusedResources({ source: "core", limit: 100, offset: 0 });
      // No core resources in seed — all are user.
      expect(result.total).toBe(0);
      expect(result.rows).toEqual([]);
    });

    it("paginates", () => {
      const page1 = index.findUnusedResources({ limit: 2, offset: 0 });
      const page2 = index.findUnusedResources({ limit: 2, offset: 2 });
      expect(page1.rows.length).toBe(2);
      expect(page1.total).toBe(page2.total);
      expect(page1.total).toBeGreaterThanOrEqual(2);
    });
  });

  describe("findBrokenRefs", () => {
    it("returns refs pointing at non-existent GUIDs", () => {
      const result = index.findBrokenRefs({ limit: 100, offset: 0 });
      // 3 broken: the intentional DEADDEAD asset_path, plus the two dep refs
      // (AAAA000000000001, AAAA000000000002) — those dep GUIDs target other
      // projects we don't have indexed in this in-memory fixture, so the
      // broken-ref query correctly flags them.
      expect(result.total).toBe(3);
      const targetGuids = result.rows.map((r) => r.target_guid).sort();
      expect(targetGuids).toEqual([
        "AAAA000000000001",
        "AAAA000000000002",
        "DEADDEADDEADDEAD",
      ]);
      const deadRow = result.rows.find((r) => r.target_guid === "DEADDEADDEADDEAD");
      expect(deadRow?.source_file).toBe("configs/broken.conf");
      expect(deadRow?.ref_kind).toBe("asset_path");
    });
  });

  describe("inheritanceChain", () => {
    it("walks from a child up to a root", () => {
      const chain = index.inheritanceChain("BBBB000000000002");
      expect(chain.steps.length).toBe(2);
      expect(chain.steps[0].guid).toBe("BBBB000000000002");
      expect(chain.steps[1].guid).toBe("BBBB000000000001");
      expect(chain.truncated).toBe(false);
      expect(chain.cycleDetected).toBe(false);
      expect(chain.unresolvedParent).toBeNull();
    });

    it("returns a single-step chain for a resource with no parent", () => {
      const chain = index.inheritanceChain("BBBB000000000001");
      expect(chain.steps.length).toBe(1);
      expect(chain.steps[0].parent_inherit).toBeNull();
    });

    it("flags unresolvedParent when the start GUID is unknown", () => {
      const chain = index.inheritanceChain("FFFF000000000000");
      expect(chain.steps).toEqual([]);
      expect(chain.unresolvedParent).toBe("FFFF000000000000");
    });

    it("respects maxDepth", () => {
      const chain = index.inheritanceChain("BBBB000000000002", 1);
      expect(chain.steps.length).toBe(1);
      expect(chain.truncated).toBe(true);
    });
  });

  describe("listResources", () => {
    it("paginates ordered by guid", () => {
      const page1 = index.listResources({ limit: 2, offset: 0 });
      const page2 = index.listResources({ limit: 2, offset: 2 });
      expect(page1.total).toBe(4);
      expect(page1.rows.length).toBe(2);
      expect(page2.rows.length).toBe(2);
      const allGuids = [...page1.rows, ...page2.rows].map((r) => r.guid);
      expect(allGuids).toEqual([...allGuids].sort());
    });

    it("filters by source", () => {
      const result = index.listResources({ source: "core", limit: 100, offset: 0 });
      expect(result.total).toBe(0);
    });

    it("filters by rootType", () => {
      const result = index.listResources({
        rootType: "GenericEntity",
        limit: 100,
        offset: 0,
      });
      expect(result.total).toBe(2);
    });

    it("filters by projectId", () => {
      const result = index.listResources({
        projectId: "TestMod",
        limit: 100,
        offset: 0,
      });
      expect(result.total).toBe(4);
    });
  });

  describe("listDependencies", () => {
    it("returns deps for an indexed project", () => {
      const deps = index.listDependencies("TestMod");
      expect(deps.length).toBe(2);
      expect(deps.map((d) => d.dep_guid).sort()).toEqual([
        "AAAA000000000001",
        "AAAA000000000002",
      ]);
      // Neither dep GUID was inserted into resources — file_path stays null.
      for (const d of deps) {
        expect(d.file_path).toBeNull();
      }
    });

    it("returns empty for an unknown project", () => {
      expect(index.listDependencies("ghost-project")).toEqual([]);
    });
  });

  describe("schema v3 cross-project path collisions", () => {
    it("keeps same-named files/refs from two projects as distinct rows", () => {
      const now = Date.now();
      db.prepare(
        "INSERT INTO projects (id, guid, title, root_path, source, last_scan) VALUES (?, ?, ?, ?, ?, ?)",
      ).run("OtherMod", "3333333333333333", "Other", "/y", "user", now);
      const insertFile = db.prepare(
        "INSERT INTO files (project_id, path, mtime, size, hash, source, last_indexed) VALUES (?, ?, ?, ?, ?, ?, ?)",
      );
      insertFile.run("TestMod", "Prefabs/Foo.et", 1, 10, null, "user", now);
      insertFile.run("OtherMod", "Prefabs/Foo.et", 2, 20, null, "user", now);
      const insertRef = db.prepare(
        "INSERT INTO resource_refs (project_id, source_file, target_guid, ref_kind, context) VALUES (?, ?, ?, ?, ?)",
      );
      insertRef.run("TestMod", "Prefabs/Foo.et", "BBBB000000000001", "inheritance", "");
      insertRef.run("OtherMod", "Prefabs/Foo.et", "BBBB000000000001", "inheritance", "");

      const refs = index.findReferences("BBBB000000000001", "inheritance", 100, 0);
      expect(refs.total).toBe(3); // child.et + both Foo.et copies
      expect(refs.rows.filter((r) => r.source_file === "Prefabs/Foo.et").map((r) => r.project_id).sort())
        .toEqual(["OtherMod", "TestMod"]);

      const files = index.listIndexedProjectFiles("user");
      const foo = files.filter((f) => f.file_path === "Prefabs/Foo.et");
      expect(foo.map((f) => f.root_path).sort()).toEqual(["/x", "/y"]);

      // Deleting one project cascades ONLY its rows.
      db.prepare("DELETE FROM projects WHERE id = ?").run("OtherMod");
      const after = index.findReferences("BBBB000000000001", "inheritance", 100, 0);
      expect(after.total).toBe(2);
      expect(
        (db.prepare("SELECT COUNT(*) AS c FROM files WHERE path = ?").get("Prefabs/Foo.et") as { c: number }).c,
      ).toBe(1);
    });

    it("resolveOwningProject picks the longest matching root", () => {
      const now = Date.now();
      db.prepare(
        "INSERT INTO projects (id, guid, title, root_path, source, last_scan) VALUES (?, ?, ?, ?, ?, ?)",
      ).run("Nested", "4444444444444444", "Nested", "/x/addons/Nested", "user", now);
      expect(index.resolveOwningProject("/x/addons/Nested/Prefabs/Foo.et")?.id).toBe("Nested");
      expect(index.resolveOwningProject("/x/Prefabs/Foo.et")?.id).toBe("TestMod");
      expect(index.resolveOwningProject("/elsewhere/Foo.et")).toBeNull();
    });
  });

  describe("findReferences", () => {
    it("returns paginated refs by target GUID", () => {
      const result = index.findReferences("BBBB000000000001", "any", 100, 0);
      expect(result.total).toBe(1);
      expect(result.rows[0].source_file).toBe("prefabs/child.et");
      expect(result.rows[0].ref_kind).toBe("inheritance");
    });

    it("filters by kind", () => {
      const inh = index.findReferences("BBBB000000000001", "inheritance", 100, 0);
      const dep = index.findReferences("BBBB000000000001", "dep", 100, 0);
      expect(inh.total).toBe(1);
      expect(dep.total).toBe(0);
    });
  });

  describe("listIndexedProjectFiles", () => {
    /**
     * Seed `files` rows for each existing resource path plus one untyped file
     * (a SubScene-style file with no resources row — the BUG-2 case).
     */
    function seedFiles(): void {
      const now = Date.now();
      const insertFile = db.prepare(
        "INSERT INTO files (project_id, path, mtime, size, hash, source, last_indexed) VALUES (?, ?, ?, ?, ?, ?, ?)",
      );
      // Typed-resource files (have a row in `resources`).
      insertFile.run("TestMod", "addon.gproj", 1, 100, null, "user", now);
      insertFile.run("TestMod", "prefabs/base.et", 1, 100, null, "user", now);
      insertFile.run("TestMod", "prefabs/child.et", 1, 100, null, "user", now);
      insertFile.run("TestMod", "configs/orphan.conf", 1, 100, null, "user", now);
      // Untyped file — SubScene case, no resources row.
      insertFile.run("TestMod", "scenes/intro.subscene", 1, 100, null, "user", now);
      // Untyped file in a different source — proves source filter works.
      insertFile.run("Vanilla", "vanilla/junk.subscene", 1, 100, null, "core", now);
    }

    it("returns typed files with project info populated (BUG-2 regression: LEFT JOIN preserves prior behavior)", () => {
      seedFiles();
      const rows = index.listIndexedProjectFiles("user");
      const typed = rows.filter((r) => r.guid !== null);
      // 4 typed files (addon.gproj, base.et, child.et, orphan.conf) all
      // belong to TestMod.
      const typedPaths = typed.map((r) => r.file_path).sort();
      expect(typedPaths).toEqual([
        "addon.gproj",
        "configs/orphan.conf",
        "prefabs/base.et",
        "prefabs/child.et",
      ]);
      for (const r of typed) {
        expect(r.project_id).toBe("TestMod");
        expect(r.root_path).toBe("/x");
        expect(r.root_type).not.toBeNull();
      }
    });

    it("surfaces untyped files (SubScene-style) with NULL resource fields when include_untyped is true (default)", () => {
      seedFiles();
      const rows = index.listIndexedProjectFiles("user");
      const untyped = rows.filter((r) => r.guid === null);
      expect(untyped.length).toBe(1);
      expect(untyped[0].file_path).toBe("scenes/intro.subscene");
      expect(untyped[0].root_type).toBeNull();
      expect(untyped[0].class_name).toBeNull();
      // Schema v3: files carry their own project_id FK, so even untyped
      // files resolve to an owning project + root.
      expect(untyped[0].project_id).toBe("TestMod");
      expect(untyped[0].root_path).toBe("/x");
      expect(untyped[0].source).toBe("user");
    });

    it("filters out untyped files when include_untyped is false", () => {
      seedFiles();
      const rows = index.listIndexedProjectFiles("user", { include_untyped: false });
      for (const r of rows) {
        expect(r.guid).not.toBeNull();
      }
      // No SubScene file should appear.
      expect(rows.find((r) => r.file_path === "scenes/intro.subscene")).toBeUndefined();
      // Typed files are unaffected.
      expect(rows.length).toBe(4);
    });

    it("respects the source filter for both typed and untyped rows", () => {
      seedFiles();
      const userRows = index.listIndexedProjectFiles("user");
      const coreRows = index.listIndexedProjectFiles("core");
      expect(userRows.find((r) => r.source === "core")).toBeUndefined();
      expect(coreRows.find((r) => r.source === "user")).toBeUndefined();
      // The core seed file is untyped.
      expect(coreRows.length).toBe(1);
      expect(coreRows[0].file_path).toBe("vanilla/junk.subscene");
      expect(coreRows[0].guid).toBeNull();
    });

    it("returns no rows when source filter matches nothing", () => {
      seedFiles();
      expect(index.listIndexedProjectFiles("workshop")).toEqual([]);
    });

    it("without a source filter, returns every file (typed + untyped) across sources", () => {
      seedFiles();
      const rows = index.listIndexedProjectFiles();
      // 4 typed (user) + 1 untyped (user) + 1 untyped (core) = 6.
      expect(rows.length).toBe(6);
      expect(rows.filter((r) => r.guid === null).length).toBe(2);
      expect(rows.filter((r) => r.guid !== null).length).toBe(4);
    });
  });
});
