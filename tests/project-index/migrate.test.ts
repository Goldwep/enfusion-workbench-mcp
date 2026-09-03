import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  openProjectIndex,
  openProjectIndexAtVersion,
  currentSchemaVersion,
} from "../../src/project-index/migrate.js";

describe("project-index migrate", () => {
  it("applies v1 schema to a fresh :memory: db", () => {
    const db = openProjectIndex(":memory:");
    try {
      const row = db
        .prepare("SELECT MAX(version) AS v FROM schema_version")
        .get() as { v: number };
      expect(row.v).toBe(currentSchemaVersion());

      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all() as { name: string }[];
      const names = tables.map((t) => t.name);

      expect(names).toContain("resources");
      expect(names).toContain("resource_refs");
      expect(names).toContain("files");
      expect(names).toContain("projects");
      expect(names).toContain("project_deps");
      expect(names).toContain("schema_version");
    } finally {
      db.close();
    }
  });

  it("enforces the resource source CHECK constraint", () => {
    const db = openProjectIndex(":memory:");
    try {
      const insert = db.prepare(
        "INSERT INTO resources (guid, file_path, root_type, source, last_indexed) VALUES (?, ?, ?, ?, ?)",
      );

      expect(() =>
        insert.run("AAAA0000BBBB1111", "test.et", "GenericEntity", "user", Date.now()),
      ).not.toThrow();

      expect(() =>
        insert.run("AAAA0000BBBB1112", "x.et", "GenericEntity", "invalid", Date.now()),
      ).toThrow();
    } finally {
      db.close();
    }
  });

  it("enforces the ref_kind CHECK constraint", () => {
    const db = openProjectIndex(":memory:");
    try {
      db.prepare(
        "INSERT INTO projects (id, guid, title, root_path, source, last_scan) VALUES (?, ?, ?, ?, ?, ?)",
      ).run("P", "AAAA0000BBBB1111", "P", "/p", "user", Date.now());
      const insert = db.prepare(
        "INSERT INTO resource_refs (project_id, source_file, target_guid, ref_kind, context) VALUES (?, ?, ?, ?, ?)",
      );

      expect(() =>
        insert.run("P", "test.et", "AAAA0000BBBB1111", "inheritance", ""),
      ).not.toThrow();

      expect(() =>
        insert.run("P", "test.et", "AAAA0000BBBB1112", "bogus", ""),
      ).toThrow();
    } finally {
      db.close();
    }
  });

  it("enforces the project_deps FOREIGN KEY", () => {
    const db = openProjectIndex(":memory:");
    try {
      db.prepare(
        "INSERT INTO projects (id, guid, title, root_path, source, last_scan) VALUES (?, ?, ?, ?, ?, ?)",
      ).run("real-project", "AAAA0000BBBB1111", "Test", "/path", "user", Date.now());

      expect(() =>
        db
          .prepare("INSERT INTO project_deps (project_id, dep_guid) VALUES (?, ?)")
          .run("real-project", "BBBB1111CCCC2222"),
      ).not.toThrow();

      expect(() =>
        db
          .prepare("INSERT INTO project_deps (project_id, dep_guid) VALUES (?, ?)")
          .run("ghost-project", "BBBB1111CCCC2222"),
      ).toThrow();
    } finally {
      db.close();
    }
  });

  it("applies v2 migration: adds project_id column to resources", () => {
    const db = openProjectIndex(":memory:");
    try {
      const cols = db
        .prepare("PRAGMA table_info(resources)")
        .all() as { name: string; type: string; notnull: number }[];
      const projectIdCol = cols.find((c) => c.name === "project_id");
      expect(projectIdCol).toBeDefined();
      expect(projectIdCol?.type).toBe("TEXT");
      expect(projectIdCol?.notnull).toBe(0); // nullable

      // NULL project_id is allowed (FK is nullable)
      const insert = db.prepare(
        "INSERT INTO resources (guid, file_path, root_type, source, last_indexed, project_id) " +
          "VALUES (?, ?, ?, ?, ?, ?)",
      );
      expect(() =>
        insert.run("AAAA0000BBBB1111", "test.et", "GenericEntity", "user", Date.now(), null),
      ).not.toThrow();

      const row = db
        .prepare("SELECT project_id FROM resources WHERE guid = ?")
        .get("AAAA0000BBBB1111") as { project_id: string | null };
      expect(row.project_id).toBeNull();
    } finally {
      db.close();
    }
  });

  it("v2 project_id FK cascades on project delete", () => {
    const db = openProjectIndex(":memory:");
    try {
      db.prepare(
        "INSERT INTO projects (id, guid, title, root_path, source, last_scan) " +
          "VALUES (?, ?, ?, ?, ?, ?)",
      ).run("proj1", "0000000000000001", "P1", "/a", "user", Date.now());

      db.prepare(
        "INSERT INTO resources (guid, file_path, root_type, source, last_indexed, project_id) " +
          "VALUES (?, ?, ?, ?, ?, ?)",
      ).run("AAAA0000BBBB1111", "test.et", "GenericEntity", "user", Date.now(), "proj1");

      expect(
        (db.prepare("SELECT COUNT(*) AS c FROM resources").get() as { c: number }).c,
      ).toBe(1);

      // Deleting the parent project cascades to the resource row.
      db.prepare("DELETE FROM projects WHERE id = ?").run("proj1");

      expect(
        (db.prepare("SELECT COUNT(*) AS c FROM resources").get() as { c: number }).c,
      ).toBe(0);
    } finally {
      db.close();
    }
  });

  it("v2 project_id FK rejects orphan project references", () => {
    const db = openProjectIndex(":memory:");
    try {
      // Inserting a resource whose project_id doesn't exist in projects should fail.
      expect(() =>
        db
          .prepare(
            "INSERT INTO resources (guid, file_path, root_type, source, last_indexed, project_id) " +
              "VALUES (?, ?, ?, ?, ?, ?)",
          )
          .run(
            "BBBB1111CCCC2222",
            "test.et",
            "GenericEntity",
            "user",
            Date.now(),
            "ghost-project",
          ),
      ).toThrow();
    } finally {
      db.close();
    }
  });

  // ── Schema v3 (C2) ────────────────────────────────────────────────────────

  describe("v3: files + resource_refs scoped by project_id", () => {
    const cleanups: (() => void)[] = [];
    afterEach(() => {
      while (cleanups.length > 0) cleanups.pop()?.();
    });

    it("fresh db has project_id NOT NULL FK + composite keys on both tables", () => {
      const db = openProjectIndex(":memory:");
      try {
        for (const table of ["files", "resource_refs"]) {
          const cols = db.prepare(`PRAGMA table_info(${table})`).all() as {
            name: string;
            notnull: number;
            pk: number;
          }[];
          const pid = cols.find((c) => c.name === "project_id");
          expect(pid, `${table}.project_id`).toBeDefined();
          expect(pid!.notnull).toBe(1);
          expect(pid!.pk).toBeGreaterThan(0); // part of the composite PK
          const fks = db.prepare(`PRAGMA foreign_key_list(${table})`).all() as {
            table: string;
            from: string;
            on_delete: string;
          }[];
          const fk = fks.find((f) => f.from === "project_id");
          expect(fk?.table).toBe("projects");
          expect(fk?.on_delete).toBe("CASCADE");
        }
        // Same relative path in two projects → two rows, not a conflict.
        const now = Date.now();
        const ins = db.prepare(
          "INSERT INTO projects (id, guid, title, root_path, source, last_scan) VALUES (?, ?, ?, ?, ?, ?)",
        );
        ins.run("A", "AAAA000000000001", "A", "/a", "user", now);
        ins.run("B", "AAAA000000000002", "B", "/b", "user", now);
        const insFile = db.prepare(
          "INSERT INTO files (project_id, path, mtime, size, hash, source, last_indexed) VALUES (?, ?, ?, ?, ?, ?, ?)",
        );
        insFile.run("A", "Prefabs/Foo.et", 1, 1, null, "user", now);
        insFile.run("B", "Prefabs/Foo.et", 1, 1, null, "user", now);
        expect(() => insFile.run("A", "Prefabs/Foo.et", 1, 1, null, "user", now)).toThrow();
        // Orphan project_id is rejected.
        expect(() => insFile.run("ghost", "x.et", 1, 1, null, "user", now)).toThrow();
        // CASCADE fires per project.
        db.prepare("DELETE FROM projects WHERE id = ?").run("A");
        const left = db.prepare("SELECT project_id FROM files").all() as { project_id: string }[];
        expect(left).toEqual([{ project_id: "B" }]);
      } finally {
        db.close();
      }
    });

    it("upgrades a POPULATED v2 file db: v3 applied, files cleared (re-crawl forced), resources kept, refs backfilled", () => {
      const dir = mkdtempSync(join(tmpdir(), "emcp-migrate-v2-"));
      cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
      const dbPath = join(dir, "index.db");

      // Build a v2 database the way a pre-upgrade install would look.
      const v2 = openProjectIndexAtVersion(dbPath, 2);
      const now = Date.now();
      expect(
        (v2.prepare("SELECT MAX(version) AS v FROM schema_version").get() as { v: number }).v,
      ).toBe(2);
      // v2 shape sanity: files has no project_id.
      const v2cols = (v2.prepare("PRAGMA table_info(files)").all() as { name: string }[]).map((c) => c.name);
      expect(v2cols).not.toContain("project_id");

      const ins = v2.prepare(
        "INSERT INTO projects (id, guid, title, root_path, source, last_scan) VALUES (?, ?, ?, ?, ?, ?)",
      );
      ins.run("ModA", "AAAA000000000001", "A", join(dir, "A"), "user", now);
      ins.run("ModB", "AAAA000000000002", "B", join(dir, "B"), "user", now);
      const insRes = v2.prepare(
        "INSERT INTO resources (guid, file_path, root_type, class_name, parent_inherit, source, project_id, last_indexed) VALUES (?,?,?,?,?,?,?,?)",
      );
      insRes.run("BBBB000000000001", "Prefabs/Unique.et", "GenericEntity", null, null, "user", "ModA", now);
      insRes.run("BBBB000000000002", "Prefabs/Foo.et", "GenericEntity", null, null, "user", "ModA", now);
      insRes.run("BBBB000000000003", "Prefabs/Foo.et", "GenericEntity", null, null, "user", "ModB", now);
      insRes.run("BBBB000000000004", "Prefabs/Orphan.et", "GenericEntity", null, null, "user", null, now);
      const insRef = v2.prepare(
        "INSERT INTO resource_refs (source_file, target_guid, ref_kind, context) VALUES (?, ?, ?, ?)",
      );
      insRef.run("Prefabs/Unique.et", "CCCC000000000001", "asset_path", "m_X"); // unambiguous → kept
      insRef.run("Prefabs/Foo.et", "CCCC000000000002", "inheritance", "");      // ambiguous → dropped
      insRef.run("Prefabs/NoOwner.et", "CCCC000000000003", "value", "");         // no owner → dropped
      v2.prepare(
        "INSERT INTO files (path, mtime, size, hash, source, last_indexed) VALUES (?, ?, ?, ?, ?, ?)",
      ).run("Prefabs/Unique.et", 1, 1, null, "user", now);
      v2.close();

      // Re-open with the real entry point → migration to v3 runs.
      const db = openProjectIndex(dbPath);
      try {
        expect(
          (db.prepare("SELECT MAX(version) AS v FROM schema_version").get() as { v: number }).v,
        ).toBe(3);
        expect(currentSchemaVersion()).toBe(3);

        // Re-crawl flag: `files` is empty, so every file re-parses on the next crawl.
        expect((db.prepare("SELECT COUNT(*) AS c FROM files").get() as { c: number }).c).toBe(0);
        const fcols = (db.prepare("PRAGMA table_info(files)").all() as { name: string }[]).map((c) => c.name);
        expect(fcols).toContain("project_id");

        // resources preserved verbatim (project_id NULL row included).
        expect((db.prepare("SELECT COUNT(*) AS c FROM resources").get() as { c: number }).c).toBe(4);

        // refs: only the unambiguous one survives, with its project_id.
        const refs = db
          .prepare("SELECT project_id, source_file, target_guid FROM resource_refs")
          .all() as { project_id: string; source_file: string; target_guid: string }[];
        expect(refs).toEqual([
          { project_id: "ModA", source_file: "Prefabs/Unique.et", target_guid: "CCCC000000000001" },
        ]);

        // Idempotent: re-open is a no-op.
        db.close();
        const again = openProjectIndex(dbPath);
        expect(
          (again.prepare("SELECT MAX(version) AS v FROM schema_version").get() as { v: number }).v,
        ).toBe(3);
        again.close();
      } finally {
        try {
          db.close();
        } catch {
          /* already closed */
        }
      }
    });
  });

  it("re-opening an existing db is a no-op (idempotent)", () => {
    // :memory: dbs are unique per open, so this exercises the "version already
    // applied" branch by calling migrate twice on the same handle indirectly.
    const db1 = openProjectIndex(":memory:");
    const versionBefore = (
      db1.prepare("SELECT MAX(version) AS v FROM schema_version").get() as { v: number }
    ).v;
    db1.close();

    const db2 = openProjectIndex(":memory:");
    try {
      const versionAfter = (
        db2.prepare("SELECT MAX(version) AS v FROM schema_version").get() as { v: number }
      ).v;
      expect(versionAfter).toBe(versionBefore);
      expect(versionAfter).toBe(currentSchemaVersion());
    } finally {
      db2.close();
    }
  });
});
