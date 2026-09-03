import { describe, it, expect, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  unlinkSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openProjectIndex } from "../../src/project-index/migrate.js";
import { crawl } from "../../src/project-index/crawler.js";
import { ProjectWatcher } from "../../src/watch/project-watcher.js";

/**
 * Resolve after `ms` milliseconds. chokidar is filesystem-event driven on
 * Windows and can take a moment to settle; tests use longer waits than the
 * 100ms watcher debounce to absorb that latency.
 */
function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Minimal valid Enfusion text-container file content for a prefab. */
const PREFAB_CONTENT = `GenericEntity : "{A9806AF617972E97}Prefabs/Base.et" {
 ID "AAAA1111BBBB2222"
}
`;

const PREFAB_CONTENT_V2 = `GenericEntity : "{A9806AF617972E97}Prefabs/Base.et" {
 ID "AAAA1111BBBB2222"
 components {
  ItemComponent ItemComponent "{CCCC3333DDDD4444}" {
   m_iWeight 99
  }
 }
}
`;

const GPROJ_CONTENT = `GameProject {
 ID "WatcherTest"
 GUID "9999AAAA8888BBBB"
 TITLE "Watcher test project"
}
`;

describe("ProjectWatcher", () => {
  const cleanups: (() => void)[] = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      const fn = cleanups.pop();
      if (fn) {
        try {
          fn();
        } catch {
          /* ignore */
        }
      }
    }
  });

  it("can start and stop without throwing", async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), "watcher-startstop-"));
    cleanups.push(() => rmSync(tmpRoot, { recursive: true, force: true }));

    const db = openProjectIndex(":memory:");
    cleanups.push(() => db.close());

    const watcher = new ProjectWatcher(db, tmpRoot, "user");
    cleanups.push(async () => watcher.stop());

    expect(() => watcher.start()).not.toThrow();
    // Double-start is a no-op.
    expect(() => watcher.start()).not.toThrow();

    await watcher.stop();
    // Double-stop is a no-op.
    await watcher.stop();
  });

  it("indexes a file added after start", async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), "watcher-add-"));
    cleanups.push(() => rmSync(tmpRoot, { recursive: true, force: true }));

    // Seed with the gproj so the project exists (crawl needs a .gproj).
    writeFileSync(join(tmpRoot, "addon.gproj"), GPROJ_CONTENT, "utf-8");

    const db = openProjectIndex(":memory:");
    cleanups.push(() => db.close());

    const watcher = new ProjectWatcher(db, tmpRoot, "user");
    cleanups.push(async () => watcher.stop());
    watcher.start();

    // Give chokidar a moment to bind.
    await wait(200);

    mkdirSync(join(tmpRoot, "prefabs"));
    writeFileSync(join(tmpRoot, "prefabs", "test.et"), PREFAB_CONTENT, "utf-8");

    // Wait past the debounce + chokidar fs settling.
    await wait(800);

    const row = db
      .prepare("SELECT guid, root_type FROM resources WHERE file_path = ?")
      .get("prefabs/test.et") as { guid: string; root_type: string } | undefined;

    expect(row).toBeDefined();
    expect(row!.guid).toBe("AAAA1111BBBB2222");
    expect(row!.root_type).toBe("GenericEntity");
  });

  it("re-indexes a file on change", async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), "watcher-change-"));
    cleanups.push(() => rmSync(tmpRoot, { recursive: true, force: true }));

    writeFileSync(join(tmpRoot, "addon.gproj"), GPROJ_CONTENT, "utf-8");
    mkdirSync(join(tmpRoot, "prefabs"));
    writeFileSync(join(tmpRoot, "prefabs", "test.et"), PREFAB_CONTENT, "utf-8");

    const db = openProjectIndex(":memory:");
    cleanups.push(() => db.close());

    const watcher = new ProjectWatcher(db, tmpRoot, "user");
    cleanups.push(async () => watcher.stop());
    watcher.start();
    await wait(200);

    // Write v2 — adds a component referencing CCCC3333DDDD4444.
    writeFileSync(join(tmpRoot, "prefabs", "test.et"), PREFAB_CONTENT_V2, "utf-8");
    await wait(800);

    // The component GUID should now appear as a ref or resource — at minimum
    // the file should have been re-indexed (file row mtime updated).
    const fileRow = db
      .prepare("SELECT mtime FROM files WHERE path = ?")
      .get("prefabs/test.et") as { mtime: number } | undefined;
    expect(fileRow).toBeDefined();
    expect(fileRow!.mtime).toBeGreaterThan(0);
  });

  it("drops rows on unlink", async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), "watcher-unlink-"));
    cleanups.push(() => rmSync(tmpRoot, { recursive: true, force: true }));

    writeFileSync(join(tmpRoot, "addon.gproj"), GPROJ_CONTENT, "utf-8");
    mkdirSync(join(tmpRoot, "prefabs"));
    const etPath = join(tmpRoot, "prefabs", "test.et");
    writeFileSync(etPath, PREFAB_CONTENT, "utf-8");

    const db = openProjectIndex(":memory:");
    cleanups.push(() => db.close());

    const watcher = new ProjectWatcher(db, tmpRoot, "user");
    cleanups.push(async () => watcher.stop());
    watcher.start();
    await wait(200);

    // Seed by writing the file again (triggers an add event so it gets indexed).
    writeFileSync(etPath, PREFAB_CONTENT, "utf-8");
    await wait(800);

    // Confirm it's indexed.
    let count = (
      db
        .prepare("SELECT COUNT(*) AS c FROM resources WHERE file_path = ?")
        .get("prefabs/test.et") as { c: number }
    ).c;
    expect(count).toBe(1);

    // Delete and wait.
    unlinkSync(etPath);
    await wait(800);

    count = (
      db
        .prepare("SELECT COUNT(*) AS c FROM resources WHERE file_path = ?")
        .get("prefabs/test.et") as { c: number }
    ).c;
    expect(count).toBe(0);

    const fileCount = (
      db.prepare("SELECT COUNT(*) AS c FROM files WHERE path = ?").get("prefabs/test.et") as {
        c: number;
      }
    ).c;
    expect(fileCount).toBe(0);
  });

  // WATCH-2 regression: nested-addon layout. The addon's .gproj lives in a
  // SUBFOLDER of the watched source root, so the crawler stores each
  // resource/file/ref with a file_path relative to that subfolder (the
  // owning project root), NOT relative to the source root. Before the fix,
  // handleUnlink keyed deletes off `relative(sourceRoot, file)` — which for a
  // nested addon produces "MyAddon/prefabs/test.et", matching ZERO rows and
  // leaking the index entries forever. After the fix it resolves the owning
  // project's root and keys off "prefabs/test.et", deleting the right rows.
  it("drops rows on unlink for a nested addon (gproj in a subfolder)", async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), "watcher-unlink-nested-"));
    cleanups.push(() => rmSync(tmpRoot, { recursive: true, force: true }));

    // Addon project root is a SUBFOLDER of the watched source root.
    const addonRoot = join(tmpRoot, "MyAddon");
    mkdirSync(addonRoot);
    writeFileSync(join(addonRoot, "addon.gproj"), GPROJ_CONTENT, "utf-8");
    mkdirSync(join(addonRoot, "prefabs"));
    const etPath = join(addonRoot, "prefabs", "test.et");
    writeFileSync(etPath, PREFAB_CONTENT, "utf-8");

    const db = openProjectIndex(":memory:");
    cleanups.push(() => db.close());

    // Watch the OUTER source root, mirroring how a source dir containing
    // multiple addons is watched in production.
    const watcher = new ProjectWatcher(db, tmpRoot, "user");
    cleanups.push(async () => watcher.stop());
    watcher.start();
    await wait(200);

    // Seed the index by touching the file (triggers an add → crawl).
    writeFileSync(etPath, PREFAB_CONTENT, "utf-8");
    await wait(800);

    // The crawler stores file_path relative to the owning project root
    // (addonRoot), i.e. "prefabs/test.et" — NOT "MyAddon/prefabs/test.et".
    let count = (
      db
        .prepare("SELECT COUNT(*) AS c FROM resources WHERE file_path = ?")
        .get("prefabs/test.et") as { c: number }
    ).c;
    expect(count).toBe(1);

    // The project root_path is the subfolder.
    const proj = db
      .prepare("SELECT root_path FROM projects WHERE id = ?")
      .get("WatcherTest") as { root_path: string } | undefined;
    expect(proj).toBeDefined();

    // Delete the file and wait for the unlink to propagate.
    unlinkSync(etPath);
    await wait(800);

    // All three tables must be cleared off the owning-project-relative path.
    count = (
      db
        .prepare("SELECT COUNT(*) AS c FROM resources WHERE file_path = ?")
        .get("prefabs/test.et") as { c: number }
    ).c;
    expect(count).toBe(0);

    const fileCount = (
      db.prepare("SELECT COUNT(*) AS c FROM files WHERE path = ?").get("prefabs/test.et") as {
        c: number;
      }
    ).c;
    expect(fileCount).toBe(0);

    // Belt-and-suspenders: nothing should remain under the WRONG (source-root
    // relative) key either, confirming we didn't just shift the bug.
    const wrongKey = (
      db
        .prepare("SELECT COUNT(*) AS c FROM resources WHERE file_path = ?")
        .get("MyAddon/prefabs/test.et") as { c: number }
    ).c;
    expect(wrongKey).toBe(0);
  });

  // C2 (schema v3) cross-project collision: two addons under one watched
  // source root both ship `Prefabs/Foo.et`. Pre-v3 the path-only keys made
  // the second crawl clobber the first's files/refs rows and an unlink in
  // one addon deleted BOTH addons' rows. Now every row is (project_id, path).
  it("keeps same-named files in two addons distinct and unlinks only the owner's rows", async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), "watcher-collision-"));
    cleanups.push(() => rmSync(tmpRoot, { recursive: true, force: true }));

    const mk = (name: string, id: string, gprojGuid: string, etGuid: string): string => {
      const root = join(tmpRoot, name);
      mkdirSync(join(root, "Prefabs"), { recursive: true });
      writeFileSync(
        join(root, "addon.gproj"),
        `GameProject {\n ID "${id}"\n GUID "${gprojGuid}"\n TITLE "${id}"\n}\n`,
        "utf-8",
      );
      writeFileSync(
        join(root, "Prefabs", "Foo.et"),
        `GenericEntity : "{A9806AF617972E97}Prefabs/Base.et" {\n ID "${etGuid}"\n}\n`,
        "utf-8",
      );
      return root;
    };
    const rootA = mk("AddonA", "AddonA", "1111111111111111", "AAAA000000000001");
    mk("AddonB", "AddonB", "2222222222222222", "BBBB000000000001");

    const db = openProjectIndex(":memory:");
    cleanups.push(() => db.close());

    // Crawl both addons via the shared source root.
    const res = crawl(db, [{ path: tmpRoot, kind: "user" }]);
    expect(res.projectsIndexed).toBe(2);

    const count = (sql: string, ...args: unknown[]): number =>
      (db.prepare(sql).get(...args) as { c: number }).c;

    // Both projects' rows for the SAME relative path survive.
    expect(count("SELECT COUNT(*) AS c FROM files WHERE path = ?", "Prefabs/Foo.et")).toBe(2);
    expect(count("SELECT COUNT(*) AS c FROM resources WHERE file_path = ?", "Prefabs/Foo.et")).toBe(2);
    // Each copy emits an inheritance ref to the same base GUID — one per project.
    expect(
      count(
        "SELECT COUNT(*) AS c FROM resource_refs WHERE source_file = ? AND target_guid = ?",
        "Prefabs/Foo.et",
        "A9806AF617972E97",
      ),
    ).toBe(2);
    expect(
      (db.prepare("SELECT DISTINCT project_id FROM resource_refs WHERE source_file = ? ORDER BY project_id")
        .all("Prefabs/Foo.et") as { project_id: string }[]).map((r) => r.project_id),
    ).toEqual(["AddonA", "AddonB"]);

    // Now watch the source root and delete ONLY AddonA's copy.
    const watcher = new ProjectWatcher(db, tmpRoot, "user");
    cleanups.push(async () => watcher.stop());
    watcher.start();
    await wait(200);
    unlinkSync(join(rootA, "Prefabs", "Foo.et"));
    await wait(800);

    // AddonA's rows are gone…
    expect(count("SELECT COUNT(*) AS c FROM files WHERE project_id = 'AddonA' AND path = ?", "Prefabs/Foo.et")).toBe(0);
    expect(count("SELECT COUNT(*) AS c FROM resources WHERE project_id = 'AddonA' AND file_path = ?", "Prefabs/Foo.et")).toBe(0);
    expect(count("SELECT COUNT(*) AS c FROM resource_refs WHERE project_id = 'AddonA' AND source_file = ?", "Prefabs/Foo.et")).toBe(0);
    // …and AddonB's are untouched.
    expect(count("SELECT COUNT(*) AS c FROM files WHERE project_id = 'AddonB' AND path = ?", "Prefabs/Foo.et")).toBe(1);
    expect(count("SELECT COUNT(*) AS c FROM resources WHERE project_id = 'AddonB' AND file_path = ?", "Prefabs/Foo.et")).toBe(1);
    expect(count("SELECT COUNT(*) AS c FROM resource_refs WHERE project_id = 'AddonB' AND source_file = ?", "Prefabs/Foo.et")).toBe(1);
  });
});
