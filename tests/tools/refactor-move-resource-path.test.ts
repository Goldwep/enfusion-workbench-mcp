import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openProjectIndex } from "../../src/project-index/migrate.js";
import { ProjectIndex } from "../../src/project-index/project-index.js";
import { registerRefactorMoveResourcePath } from "../../src/tools/refactor-move-resource-path.js";
import { captureTool, makeConfig, textOf } from "./_tool-harness.js";

describe("refactor_move_resource_path", () => {
  let base: string;
  let root: string;
  let outside: string;
  const cleanups: (() => void)[] = [];

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "moveres-"));
    root = join(base, "root");
    outside = join(base, "outside");
    mkdirSync(join(root, "prefabs"), { recursive: true });
    mkdirSync(outside, { recursive: true });
  });
  afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()?.();
    rmSync(base, { recursive: true, force: true });
  });

  function makeTool() {
    const db = openProjectIndex(":memory:");
    cleanups.push(() => db.close());
    const index = new ProjectIndex(db);
    const tool = captureTool((s) =>
      registerRefactorMoveResourcePath(s, db, index, makeConfig({ projectPath: root })),
    );
    return { db, tool };
  }

  it("refuses a project_root outside every configured root (H7)", async () => {
    const { tool } = makeTool();
    writeFileSync(join(outside, "a.et"), "GenericEntity {\n}\n", "utf-8");
    const r = await tool({ project_root: outside, old_path: "a.et", new_path: "b.et", commit: true, force: true });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/project_root resolves outside every configured root/);
    expect(existsSync(join(outside, "a.et"))).toBe(true);
    expect(existsSync(join(outside, "b.et"))).toBe(false);
  });

  it("refuses a new_path that escapes project_root (H7)", async () => {
    const { tool } = makeTool();
    writeFileSync(join(root, "prefabs", "a.et"), "GenericEntity {\n}\n", "utf-8");
    const r = await tool({
      project_root: root,
      old_path: "prefabs/a.et",
      new_path: "../outside/a.et",
      commit: true,
      force: true,
    });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/new_path resolves outside project root/);
    expect(existsSync(join(root, "prefabs", "a.et"))).toBe(true);
    expect(existsSync(join(outside, "a.et"))).toBe(false);
  });

  it("renames first, then commits refs; a failed ref commit undoes the rename (M11 / RBE-5)", async () => {
    const { db, tool } = makeTool();
    const guid = "ABCD000000000001";
    const oldRel = "prefabs/a.et";
    const newRel = "prefabs/sub/b.et";
    const oldAbs = join(root, "prefabs", "a.et");
    const refAbs = join(root, "prefabs", "consumer.et");
    writeFileSync(oldAbs, `GenericEntity {\n ID "${guid}"\n}\n`, "utf-8");
    const refOriginal = `GenericEntity : "{${guid}}${oldRel}" {\n}\n`;
    writeFileSync(refAbs, refOriginal, "utf-8");

    const now = Date.now();
    db.prepare(
      "INSERT INTO projects (id, guid, title, root_path, source, last_scan) VALUES (?,?,?,?,?,?)",
    ).run("Root", "AAAA111111111111", "Root", root, "user", now);
    db.prepare(
      "INSERT INTO resources (guid, file_path, root_type, class_name, parent_inherit, source, project_id, last_indexed) VALUES (?,?,?,?,?,?,?,?)",
    ).run(guid, oldRel, "GenericEntity", null, null, "user", "Root", now);
    const refCols = (db.prepare("PRAGMA table_info(resource_refs)").all() as { name: string }[]).map(
      (c) => c.name,
    );
    if (refCols.includes("project_id")) {
      db.prepare(
        "INSERT INTO resource_refs (project_id, source_file, target_guid, ref_kind, context) VALUES (?,?,?,?,?)",
      ).run("Root", "prefabs/consumer.et", guid, "inheritance", "");
    } else {
      db.prepare(
        "INSERT INTO resource_refs (source_file, target_guid, ref_kind, context) VALUES (?,?,?,?)",
      ).run("prefabs/consumer.et", guid, "inheritance", "");
    }

    // Dry-run: nothing moves.
    const dry = await tool({ project_root: root, old_path: oldRel, new_path: newRel, commit: false, force: true });
    expect(dry.isError).toBeUndefined();
    expect(existsSync(oldAbs)).toBe(true);

    // Make the ref file unwritable so the ref commit fails AFTER the rename.
    chmodSync(refAbs, 0o444);
    let failed: ReturnType<typeof tool> extends Promise<infer R> ? R : never;
    try {
      failed = await tool({ project_root: root, old_path: oldRel, new_path: newRel, commit: true, force: true });
    } finally {
      chmodSync(refAbs, 0o644);
    }
    if (failed.isError) {
      // Ref commit threw → rename must have been undone, refs untouched.
      expect(existsSync(oldAbs)).toBe(true);
      expect(existsSync(join(root, "prefabs", "sub", "b.et"))).toBe(false);
      expect(readFileSync(refAbs, "utf-8")).toBe(refOriginal);
    }
    // (If chmod didn't make the file unwritable on this platform, the
    // commit simply succeeded — verified by the happy path below.)

    // Happy path.
    if (!failed.isError) {
      expect(existsSync(join(root, "prefabs", "sub", "b.et"))).toBe(true);
      expect(readFileSync(refAbs, "utf-8")).toContain(`{${guid}}${newRel}`);
      return;
    }
    const ok = await tool({ project_root: root, old_path: oldRel, new_path: newRel, commit: true, force: true });
    expect(ok.isError).toBeUndefined();
    expect(existsSync(oldAbs)).toBe(false);
    expect(existsSync(join(root, "prefabs", "sub", "b.et"))).toBe(true);
    expect(readFileSync(refAbs, "utf-8")).toContain(`{${guid}}${newRel}`);
  });
});
