import { describe, it, expect } from "vitest";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  readFileSync,
  writeFileSync,
  unlinkSync,
  statSync,
  utimesSync,
} from "node:fs";
import { openProjectIndex } from "../../src/project-index/migrate.js";
import { scanProject } from "../../src/project-index/resource-scan.js";

const fixtureRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures/sample-project",
);

/** Schema v3: files are keyed by project — every scan needs a projects row. */
function openWithProject(): ReturnType<typeof openProjectIndex> {
  const db = openProjectIndex(":memory:");
  db.prepare(
    "INSERT INTO projects (id, guid, title, root_path, source, last_scan) VALUES (?, ?, ?, ?, ?, ?)",
  ).run("P", "1111111111111111", "P", fixtureRoot, "user", Date.now());
  return db;
}
const OPTS = { projectId: "P" };

describe("scanProject", () => {
  it("fresh scan of sample-project upserts every resource", () => {
    const db = openWithProject();
    try {
      const result = scanProject(db, fixtureRoot, "user", OPTS);

      expect(result.filesScanned).toBe(3);
      expect(result.filesSkipped).toBe(0);
      expect(result.resourcesUpserted).toBe(3);
      expect(result.errors).toEqual([]);

      const countRow = db
        .prepare("SELECT COUNT(*) AS n FROM resources")
        .get() as { n: number };
      expect(countRow.n).toBe(3);

      const gproj = db
        .prepare(
          "SELECT guid, root_type, class_name, parent_inherit, file_path, source FROM resources WHERE file_path = ?",
        )
        .get("addon.gproj") as {
        guid: string;
        root_type: string;
        class_name: string | null;
        parent_inherit: string | null;
        file_path: string;
        source: string;
      };
      expect(gproj).toBeDefined();
      expect(gproj.guid).toBe("11AA22BB33CC44DD");
      expect(gproj.root_type).toBe("GameProject");
      expect(gproj.class_name).toBeNull();
      expect(gproj.parent_inherit).toBeNull();
      expect(gproj.source).toBe("user");

      // The .et's root carries inheritance — should round-trip.
      const et = db
        .prepare(
          "SELECT guid, root_type, parent_inherit FROM resources WHERE file_path = ?",
        )
        .get("prefabs/test.et") as {
        guid: string;
        root_type: string;
        parent_inherit: string | null;
      };
      expect(et.guid).toBe("55AA11BB22CC33DD");
      expect(et.root_type).toBe("GenericEntity");
      expect(et.parent_inherit).toBe("{A9806AF617972E97}Prefabs/Base.et");

      // Each file gets a row in `files` as well.
      const fileCount = db
        .prepare("SELECT COUNT(*) AS n FROM files")
        .get() as { n: number };
      expect(fileCount.n).toBe(3);
    } finally {
      db.close();
    }
  });

  it("re-scan of unchanged project skips every file", () => {
    const db = openWithProject();
    try {
      scanProject(db, fixtureRoot, "user", OPTS);
      const second = scanProject(db, fixtureRoot, "user", OPTS);

      expect(second.filesScanned).toBe(3);
      expect(second.filesSkipped).toBe(3);
      expect(second.resourcesUpserted).toBe(0);
      expect(second.errors).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("touching a file re-parses just that file", () => {
    const db = openWithProject();
    const touched = join(fixtureRoot, "configs", "test.conf");
    const original = readFileSync(touched, "utf-8");
    const originalStat = statSync(touched);
    try {
      scanProject(db, fixtureRoot, "user", OPTS);

      // Re-write same content but with a bumped mtime — the scanner should
      // detect the mtime change and re-parse only this file.
      writeFileSync(touched, original);
      // Force a clearly-later mtime so the test is robust against same-ms writes.
      const future = new Date(originalStat.mtimeMs + 5000);
      utimesSync(touched, future, future);

      const result = scanProject(db, fixtureRoot, "user", OPTS);

      expect(result.filesScanned).toBe(3);
      expect(result.filesSkipped).toBe(2);
      expect(result.resourcesUpserted).toBe(1);
      expect(result.errors).toEqual([]);
    } finally {
      // Restore the original mtime so re-running the test suite stays clean.
      writeFileSync(touched, original);
      try {
        utimesSync(touched, originalStat.atime, originalStat.mtime);
      } catch {
        /* ignore */
      }
      db.close();
    }
  });

  it("classifies SubScene files as unindexable, not errors (L2-5.2)", () => {
    const db = openWithProject();
    const subscenePath = join(fixtureRoot, "scene-stub.ent");
    // Minimal SubScene shape — a Parent ref, no own GUID. Matches the
    // real-world Testerz.ent pattern.
    writeFileSync(
      subscenePath,
      `SubScene {\n Parent "{A9806AF617972E97}worlds/Arland/Arland.ent"\n}\n`,
    );
    try {
      const result = scanProject(db, fixtureRoot, "user", OPTS);

      // 4 candidate files (3 valid + 1 SubScene).
      expect(result.filesScanned).toBe(4);
      // 3 valid resources, the SubScene is NOT a resource.
      expect(result.resourcesUpserted).toBe(3);
      // SubScene goes into unindexable, not errors.
      expect(result.errors).toEqual([]);
      expect(result.unindexable.length).toBe(1);
      expect(result.unindexable[0].path).toBe("scene-stub.ent");
      expect(result.unindexable[0].reason).toMatch(/SubScene/);

      // No resources row for the SubScene.
      const subSceneRow = db
        .prepare("SELECT guid FROM resources WHERE file_path = ?")
        .get("scene-stub.ent") as { guid: string } | undefined;
      expect(subSceneRow).toBeUndefined();

      // Files row still written so we don't keep re-parsing.
      const fileRow = db
        .prepare("SELECT path FROM files WHERE path = ?")
        .get("scene-stub.ent") as { path: string } | undefined;
      expect(fileRow).toBeDefined();
    } finally {
      try {
        unlinkSync(subscenePath);
      } catch {
        /* ignore */
      }
      db.close();
    }
  });

  it("tolerates a corrupted file and keeps scanning", () => {
    const db = openWithProject();
    const corruptPath = join(fixtureRoot, "corrupt.et");
    writeFileSync(corruptPath, "not a valid {{{ enfusion file");
    try {
      const result = scanProject(db, fixtureRoot, "user", OPTS);

      // Four candidate files now (the 3 valid + 1 corrupt).
      expect(result.filesScanned).toBe(4);
      // Three valid resources upserted.
      expect(result.resourcesUpserted).toBe(3);
      // The corrupt file shows up in errors.
      expect(result.errors.length).toBe(1);
      expect(result.errors[0].path).toBe("corrupt.et");
      expect(result.errors[0].reason).toMatch(/parse failed/);

      // The corrupt file still gets a row in `files` so we don't re-attempt.
      const fileRow = db
        .prepare("SELECT path FROM files WHERE path = ?")
        .get("corrupt.et") as { path: string } | undefined;
      expect(fileRow).toBeDefined();

      // ...but no resources row was written for it.
      const resCount = db
        .prepare("SELECT COUNT(*) AS n FROM resources")
        .get() as { n: number };
      expect(resCount.n).toBe(3);
    } finally {
      try {
        unlinkSync(corruptPath);
      } catch {
        /* ignore */
      }
      db.close();
    }
  });
});
