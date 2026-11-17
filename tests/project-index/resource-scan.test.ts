import { describe, it, expect } from "vitest";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync, unlinkSync, statSync, utimesSync } from "node:fs";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { openProjectIndex } from "../../src/project-index/migrate.js";
import { scanProject } from "../../src/project-index/resource-scan.js";

const fixtureRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures/sample-project");

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

      const countRow = db.prepare("SELECT COUNT(*) AS n FROM resources").get() as { n: number };
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

      // The .et's resource GUID comes from its .meta Name line; its root
      // `ID` is the entity id and is kept apart (audit refactor-index-01).
      const et = db
        .prepare(
          "SELECT guid, entity_id, root_type, parent_inherit FROM resources WHERE file_path = ?",
        )
        .get("prefabs/test.et") as {
        guid: string;
        entity_id: string | null;
        root_type: string;
        parent_inherit: string | null;
      };
      expect(et.guid).toBe("E1AA11BB22CC33DD");
      expect(et.entity_id).toBe("55AA11BB22CC33DD");
      expect(et.root_type).toBe("GenericEntity");
      expect(et.parent_inherit).toBe("{A9806AF617972E97}Prefabs/Base.et");

      // A .conf root node id is an object id, not the GUID either.
      const conf = db
        .prepare("SELECT guid, entity_id FROM resources WHERE file_path = ?")
        .get("configs/test.conf") as { guid: string; entity_id: string | null };
      expect(conf.guid).toBe("E2AA11BB22CC33DD");
      expect(conf.entity_id).toBe("77AA11BB22CC33DD");

      // Each file gets a row in `files` as well.
      const fileCount = db.prepare("SELECT COUNT(*) AS n FROM files").get() as { n: number };
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
      'SubScene {\n Parent "{A9806AF617972E97}worlds/Arland/Arland.ent"\n}\n',
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
      const fileRow = db.prepare("SELECT path FROM files WHERE path = ?").get("scene-stub.ent") as
        | { path: string }
        | undefined;
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
      const fileRow = db.prepare("SELECT path FROM files WHERE path = ?").get("corrupt.et") as
        | { path: string }
        | undefined;
      expect(fileRow).toBeDefined();

      // ...but no resources row was written for it.
      const resCount = db.prepare("SELECT COUNT(*) AS n FROM resources").get() as { n: number };
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

describe("scanProject: resource GUIDs from .meta sidecars (audit refactor-index-01/03/04)", () => {
  const meta = (guid: string, path: string): string =>
    `MetaFileClass {\n Name "{${guid}}${path}"\n Configurations {\n }\n}\n`;
  // Two prefabs inheriting one base share the entity ID, as on disk.
  const SHARED_ID = "520EC961A090B1EE";
  const prefab = `SCR_ChimeraCharacter : "{284E735C6C70DAD2}Prefabs/Base.et" {\n ID "${SHARED_ID}"\n}\n`;

  function project(): { root: string; db: ReturnType<typeof openProjectIndex>; done: () => void } {
    const root = mkdtempSync(join(tmpdir(), "scan-meta-"));
    mkdirSync(join(root, "Prefabs"), { recursive: true });
    const db = openProjectIndex(":memory:");
    db.prepare(
      "INSERT INTO projects (id, guid, title, root_path, source, last_scan) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("P", "1111111111111111", "P", root, "user", Date.now());
    return {
      root,
      db,
      done: () => {
        db.close();
        rmSync(root, { recursive: true, force: true });
      },
    };
  }
  const rowsOf = (db: ReturnType<typeof openProjectIndex>) =>
    db
      .prepare("SELECT guid, file_path, entity_id, root_type FROM resources ORDER BY file_path")
      .all() as { guid: string; file_path: string; entity_id: string | null; root_type: string }[];

  it("keys each prefab by its .meta GUID, not the shared entity ID", () => {
    const p = project();
    try {
      writeFileSync(join(p.root, "Prefabs", "A.et"), prefab);
      writeFileSync(join(p.root, "Prefabs", "A.et.meta"), meta("687483D33CAB3952", "Prefabs/A.et"));
      writeFileSync(join(p.root, "Prefabs", "B.et"), prefab);
      writeFileSync(join(p.root, "Prefabs", "B.et.meta"), meta("1234ABCD5678EF90", "Prefabs/B.et"));
      scanProject(p.db, p.root, "user", { projectId: "P" });
      expect(rowsOf(p.db)).toEqual([
        { guid: "687483D33CAB3952", file_path: "Prefabs/A.et", entity_id: SHARED_ID, root_type: "SCR_ChimeraCharacter" },
        { guid: "1234ABCD5678EF90", file_path: "Prefabs/B.et", entity_id: SHARED_ID, root_type: "SCR_ChimeraCharacter" },
      ]);
    } finally {
      p.done();
    }
  });

  it("indexes binary resources by their sidecar, and gives no row to a text file without one", () => {
    const p = project();
    try {
      mkdirSync(join(p.root, "Textures"));
      writeFileSync(join(p.root, "Textures", "wood.edds"), Buffer.from([0, 1, 2, 3]));
      writeFileSync(join(p.root, "Textures", "wood.edds.meta"), meta("AB00000000000001", "Textures/wood.edds"));
      writeFileSync(join(p.root, "Textures", "loose.edds"), Buffer.from([0, 1]));
      writeFileSync(join(p.root, "Prefabs", "Unregistered.et"), prefab);
      const r = scanProject(p.db, p.root, "user", { projectId: "P" });
      expect(rowsOf(p.db)).toEqual([
        { guid: "AB00000000000001", file_path: "Textures/wood.edds", entity_id: null, root_type: ".edds" },
      ]);
      expect(r.errors).toEqual([]);
      expect(r.unindexable.map((u) => u.path)).toEqual(["Prefabs/Unregistered.et"]);
    } finally {
      p.done();
    }
  });

  it("a GUID change in the .meta alone replaces the row; the old GUID is gone", () => {
    const p = project();
    try {
      const et = join(p.root, "Prefabs", "A.et");
      writeFileSync(et, prefab);
      writeFileSync(`${et}.meta`, meta("AAAA000000000001", "Prefabs/A.et"));
      scanProject(p.db, p.root, "user", { projectId: "P" });
      // Rewrite only the sidecar (what refactor_replace_guid does), with a
      // clearly later mtime so the change is seen.
      writeFileSync(`${et}.meta`, meta("BBBB000000000002", "Prefabs/A.et"));
      const later = new Date(Date.now() + 10_000);
      utimesSync(`${et}.meta`, later, later);
      const r = scanProject(p.db, p.root, "user", { projectId: "P" });
      expect(r.resourcesUpserted).toBe(1);
      expect(rowsOf(p.db).map((x) => x.guid)).toEqual(["BBBB000000000002"]);
      expect(p.db.prepare("SELECT COUNT(*) AS n FROM resources WHERE guid = ?").get("AAAA000000000001")).toEqual({ n: 0 });
    } finally {
      p.done();
    }
  });

  it("drops files, resources and refs rows for a file deleted between scans", () => {
    const p = project();
    try {
      const a = join(p.root, "Prefabs", "A.et");
      writeFileSync(a, prefab);
      writeFileSync(`${a}.meta`, meta("AAAA000000000001", "Prefabs/A.et"));
      const keep = join(p.root, "Prefabs", "Keep.et");
      writeFileSync(keep, prefab);
      writeFileSync(`${keep}.meta`, meta("CCCC000000000003", "Prefabs/Keep.et"));
      scanProject(p.db, p.root, "user", { projectId: "P" });
      // A ref row from A.et, as the crawler's ref-scan would have written it.
      p.db
        .prepare(
          "INSERT INTO resource_refs (project_id, source_file, target_guid, ref_kind, context) VALUES (?,?,?,?,?)",
        )
        .run("P", "Prefabs/A.et", "284E735C6C70DAD2", "inheritance", "SCR_ChimeraCharacter");

      // Deleted while no watcher ran.
      rmSync(a);
      rmSync(`${a}.meta`);
      const r = scanProject(p.db, p.root, "user", { projectId: "P" });
      expect(r.filesRemoved).toBe(1);
      expect(rowsOf(p.db).map((x) => x.file_path)).toEqual(["Prefabs/Keep.et"]);
      const count = (sql: string) => (p.db.prepare(sql).get("Prefabs/A.et") as { n: number }).n;
      expect(count("SELECT COUNT(*) AS n FROM files WHERE path = ?")).toBe(0);
      expect(count("SELECT COUNT(*) AS n FROM resource_refs WHERE source_file = ?")).toBe(0);
    } finally {
      p.done();
    }
  });

  it("a removed sidecar drops the resource row but keeps the file tracked", () => {
    const p = project();
    try {
      const a = join(p.root, "Prefabs", "A.et");
      writeFileSync(a, prefab);
      writeFileSync(`${a}.meta`, meta("AAAA000000000001", "Prefabs/A.et"));
      scanProject(p.db, p.root, "user", { projectId: "P" });
      rmSync(`${a}.meta`);
      scanProject(p.db, p.root, "user", { projectId: "P" });
      expect(rowsOf(p.db)).toEqual([]);
      expect(p.db.prepare("SELECT path FROM files").all()).toEqual([{ path: "Prefabs/A.et" }]);
    } finally {
      p.done();
    }
  });
});

describe("scanProject: audio files (.acp .sig .afm)", () => {
  it("discovers Audio Editor text files and records them in the files table", () => {
    const root = mkdtempSync(join(tmpdir(), "scan-audio-"));
    const db = openProjectIndex(":memory:");
    db.prepare(
      "INSERT INTO projects (id, guid, title, root_path, source, last_scan) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("P", "1111111111111111", "P", root, "user", Date.now());
    try {
      mkdirSync(join(root, "Sounds"), { recursive: true });
      writeFileSync(join(root, "Sounds", "a.acp"), 'AudioClass "{AAAA111122223333}" {\n}\n');
      writeFileSync(join(root, "Sounds", "b.sig"), 'SignalResClass "{BBBB111122223333}" {\n}\n');
      writeFileSync(
        join(root, "Sounds", "c.afm"),
        'AudioOutputStateResClass "{CCCC111122223333}" {\n}\n',
      );
      writeFileSync(join(root, "Sounds", "d.wav"), "RIFF");
      const result = scanProject(db, root, "user", { projectId: "P" });
      expect(result.filesScanned).toBe(3);
      const paths = (
        db.prepare("SELECT path FROM files ORDER BY path").all() as { path: string }[]
      ).map((r) => r.path);
      expect(paths).toEqual(["Sounds/a.acp", "Sounds/b.sig", "Sounds/c.afm"]);
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
