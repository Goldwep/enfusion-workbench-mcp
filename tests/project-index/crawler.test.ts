import { describe, it, expect, afterEach } from "vitest";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { openProjectIndex } from "../../src/project-index/migrate.js";
import { crawl, pruneStaleProjects } from "../../src/project-index/crawler.js";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = resolve(TEST_DIR, "../fixtures");
// FIXTURE_ROOT contains sample-project/ (and upstream HTML fixtures, which
// findGprojs will ignore since they're not .gproj files).

describe("crawler", () => {
  it("crawls a single project end-to-end", () => {
    const db = openProjectIndex(":memory:");
    try {
      const result = crawl(db, [{ path: FIXTURE_ROOT, kind: "user" }]);

      expect(result.projectsFound).toBe(1);
      expect(result.projectsIndexed).toBe(1);
      expect(result.errors).toEqual([]);

      // Project row
      const project = db
        .prepare("SELECT id, guid, title, source FROM projects WHERE id = ?")
        .get("SampleProject") as
        | { id: string; guid: string; title: string; source: string }
        | undefined;
      expect(project).toBeDefined();
      expect(project!.guid).toBe("11AA22BB33CC44DD");
      expect(project!.title).toBe("Sample Project for Tests");
      expect(project!.source).toBe("user");

      // Project deps
      const deps = db
        .prepare("SELECT dep_guid FROM project_deps WHERE project_id = ?")
        .all("SampleProject") as { dep_guid: string }[];
      expect(deps).toHaveLength(1);
      expect(deps[0].dep_guid).toBe("58D0FB3206B6F859");

      // Resources: 3 root nodes (gproj, et, conf)
      const resCount = (
        db.prepare("SELECT COUNT(*) AS c FROM resources").get() as { c: number }
      ).c;
      expect(resCount).toBe(3);

      // Refs include the dep + inheritance + 2 value refs from the .conf
      const depRef = db
        .prepare(
          "SELECT * FROM resource_refs WHERE ref_kind = 'dep' AND target_guid = ?",
        )
        .get("58D0FB3206B6F859");
      expect(depRef).toBeDefined();

      const inheritanceRef = db
        .prepare(
          "SELECT * FROM resource_refs WHERE ref_kind = 'inheritance' AND target_guid = ?",
        )
        .get("A9806AF617972E97");
      expect(inheritanceRef).toBeDefined();

      expect(result.refs.totalUnique).toBeGreaterThanOrEqual(4);
    } finally {
      db.close();
    }
  });

  it("is idempotent on re-crawl", () => {
    const db = openProjectIndex(":memory:");
    try {
      crawl(db, [{ path: FIXTURE_ROOT, kind: "user" }]);
      const refCount1 = (
        db.prepare("SELECT COUNT(*) AS c FROM resource_refs").get() as { c: number }
      ).c;
      const resCount1 = (
        db.prepare("SELECT COUNT(*) AS c FROM resources").get() as { c: number }
      ).c;
      const depCount1 = (
        db.prepare("SELECT COUNT(*) AS c FROM project_deps").get() as { c: number }
      ).c;

      const result2 = crawl(db, [{ path: FIXTURE_ROOT, kind: "user" }]);
      expect(result2.files.filesSkipped).toBeGreaterThan(0);

      const refCount2 = (
        db.prepare("SELECT COUNT(*) AS c FROM resource_refs").get() as { c: number }
      ).c;
      const resCount2 = (
        db.prepare("SELECT COUNT(*) AS c FROM resources").get() as { c: number }
      ).c;
      const depCount2 = (
        db.prepare("SELECT COUNT(*) AS c FROM project_deps").get() as { c: number }
      ).c;

      expect(refCount2).toBe(refCount1);
      expect(resCount2).toBe(resCount1);
      expect(depCount2).toBe(depCount1);
    } finally {
      db.close();
    }
  });

  it("tolerates a missing source root", () => {
    const db = openProjectIndex(":memory:");
    try {
      const result = crawl(db, [
        { path: "C:/path/that/does/not/exist", kind: "user" },
      ]);
      expect(result.projectsFound).toBe(0);
      expect(result.projectsIndexed).toBe(0);
      expect(result.errors).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("propagates the source classification", () => {
    const db = openProjectIndex(":memory:");
    try {
      crawl(db, [{ path: FIXTURE_ROOT, kind: "core" }]);

      const project = db
        .prepare("SELECT source FROM projects WHERE id = ?")
        .get("SampleProject") as { source: string };
      expect(project.source).toBe("core");

      const anyResource = db
        .prepare("SELECT source FROM resources LIMIT 1")
        .get() as { source: string };
      expect(anyResource.source).toBe("core");
    } finally {
      db.close();
    }
  });

  describe("M16: stale project pruning", () => {
    const cleanups: (() => void)[] = [];
    afterEach(() => {
      while (cleanups.length > 0) cleanups.pop()?.();
    });

    it("deletes projects whose root vanished from disk and cascades their rows", () => {
      const tmp = mkdtempSync(join(tmpdir(), "crawl-prune-"));
      cleanups.push(() => rmSync(tmp, { recursive: true, force: true }));
      const goneRoot = join(tmp, "Gone");
      mkdirSync(goneRoot);
      writeFileSync(
        join(goneRoot, "addon.gproj"),
        `GameProject {\n ID "Gone"\n GUID "DEAD000000000001"\n TITLE "Gone"\n}\n`,
      );
      const db = openProjectIndex(":memory:");
      cleanups.push(() => db.close());

      const first = crawl(db, [{ path: tmp, kind: "user" }]);
      expect(first.projectsIndexed).toBe(1);
      expect(first.staleProjectsRemoved).toEqual([]);
      expect((db.prepare("SELECT COUNT(*) AS c FROM files").get() as { c: number }).c).toBe(1);

      // Remove the addon from disk, crawl again.
      rmSync(goneRoot, { recursive: true, force: true });
      const second = crawl(db, [{ path: tmp, kind: "user" }]);
      expect(second.staleProjectsRemoved.map((p) => p.id)).toEqual(["Gone"]);
      expect((db.prepare("SELECT COUNT(*) AS c FROM projects").get() as { c: number }).c).toBe(0);
      // CASCADE cleared the dependent tables.
      expect((db.prepare("SELECT COUNT(*) AS c FROM files").get() as { c: number }).c).toBe(0);
      expect((db.prepare("SELECT COUNT(*) AS c FROM resources").get() as { c: number }).c).toBe(0);
      expect((db.prepare("SELECT COUNT(*) AS c FROM resource_refs").get() as { c: number }).c).toBe(0);
    });

    it("pruneStaleProjects treats a root without any .gproj as stale, keeps live roots", () => {
      const db = openProjectIndex(":memory:");
      cleanups.push(() => db.close());
      const tmp = mkdtempSync(join(tmpdir(), "crawl-prune2-"));
      cleanups.push(() => rmSync(tmp, { recursive: true, force: true }));
      const emptyDir = join(tmp, "NoGproj");
      mkdirSync(emptyDir);
      const ins = db.prepare(
        "INSERT INTO projects (id, guid, title, root_path, source, last_scan) VALUES (?, ?, ?, ?, ?, ?)",
      );
      ins.run("Live", "AAAA000000000001", "Live", FIXTURE_ROOT + "/sample-project", "user", 1);
      ins.run("NoGproj", "AAAA000000000002", "NoGproj", emptyDir, "user", 1);
      ins.run("Missing", "AAAA000000000003", "Missing", join(tmp, "does-not-exist"), "user", 1);
      const r = pruneStaleProjects(db);
      expect(r.removed.map((p) => p.id).sort()).toEqual(["Missing", "NoGproj"]);
      expect(
        (db.prepare("SELECT id FROM projects").all() as { id: string }[]).map((p) => p.id),
      ).toEqual(["Live"]);
    });
  });

  describe("RBE-9: torn atomic-commit journals are recovered on crawl", () => {
    const cleanups: (() => void)[] = [];
    afterEach(() => {
      while (cleanups.length > 0) cleanups.pop()?.();
    });

    it("rolls back an in_progress journal under <projectRoot>/.emcp/journals before indexing", () => {
      const tmp = mkdtempSync(join(tmpdir(), "crawl-recover-"));
      cleanups.push(() => rmSync(tmp, { recursive: true, force: true }));
      const root = join(tmp, "Addon");
      mkdirSync(join(root, "Prefabs"), { recursive: true });
      writeFileSync(
        join(root, "addon.gproj"),
        `GameProject {\n ID "Addon"\n GUID "DEAD000000000002"\n TITLE "Addon"\n}\n`,
      );
      const target = join(root, "Prefabs", "Foo.et");
      const original = `GenericEntity {\n ID "AAAA000000000001"\n}\n`;
      const torn = `GenericEntity {\n ID "BBBB000000000001"\n}\n`;
      // Simulate a crash mid-commit: target already swapped, .bak holds the
      // original, journal still in_progress.
      writeFileSync(target, torn);
      writeFileSync(`${target}.bak`, original);
      writeFileSync(`${target}.tmp.deadbeef`, torn);
      const journalDir = join(root, ".emcp", "journals");
      mkdirSync(journalDir, { recursive: true });
      writeFileSync(
        join(journalDir, ".atomic-commit.deadbeef.json"),
        JSON.stringify({
          id: "deadbeef",
          status: "in_progress",
          targets: [
            {
              path: target,
              bak: `${target}.bak`,
              tmp: `${target}.tmp.deadbeef`,
              bytes_before: original.length,
              bytes_after: torn.length,
            },
          ],
        }),
      );

      const db = openProjectIndex(":memory:");
      cleanups.push(() => db.close());
      const res = crawl(db, [{ path: tmp, kind: "user" }]);

      expect(res.journals.recovered).toBe(1);
      expect(res.journals.errors).toEqual([]);
      // File restored from .bak, tmp + journal gone.
      expect(readFileSync(target, "utf-8")).toBe(original);
      expect(existsSync(`${target}.tmp.deadbeef`)).toBe(false);
      expect(existsSync(join(journalDir, ".atomic-commit.deadbeef.json"))).toBe(false);
      // And the index reflects the RESTORED content, not the torn write.
      const row = db
        .prepare("SELECT guid FROM resources WHERE project_id = 'Addon' AND file_path = ?")
        .get("Prefabs/Foo.et") as { guid: string } | undefined;
      expect(row?.guid).toBe("AAAA000000000001");
    });
  });
});
