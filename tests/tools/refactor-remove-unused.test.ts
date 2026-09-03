import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openProjectIndex } from "../../src/project-index/migrate.ts";
import { ProjectIndex } from "../../src/project-index/project-index.ts";
import { formatScript } from "../../src/tools/refactor-remove-unused.ts";

/**
 * RBE-8 regression: the removal script must emit an ABSOLUTE on-disk path,
 * resolved against the owning project's root_path via the project_id FK.
 * The pre-fix code used `row.file_path` verbatim (relative to the owning
 * project root), producing a "NOT ON DISK" / CWD-dependent line that the
 * human can't safely run.
 */
describe("resolveAbsPathByGuid (RBE-8)", () => {
  const cleanups: (() => void)[] = [];
  afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()?.();
  });

  it("resolves a resource's relative file_path against its owning project root", () => {
    const baseDir = mkdtempSync(join(tmpdir(), "rbe8-"));
    cleanups.push(() => rmSync(baseDir, { recursive: true, force: true }));
    const projRoot = join(baseDir, "MyAddon");
    mkdirSync(join(projRoot, "prefabs"), { recursive: true });
    const onDisk = join(projRoot, "prefabs", "orphan.et");
    writeFileSync(onDisk, `GenericEntity {\n ID "0123000000000001"\n}\n`, "utf-8");

    const db = openProjectIndex(":memory:");
    cleanups.push(() => db.close());
    const now = Date.now();
    db.prepare(
      "INSERT INTO projects (id, guid, title, root_path, source, last_scan) VALUES (?,?,?,?,?,?)",
    ).run("MyAddon", "AAAA111111111111", "MyAddon", projRoot, "user", now);
    db.prepare(
      "INSERT INTO resources (guid, file_path, root_type, class_name, parent_inherit, source, project_id, last_indexed) VALUES (?,?,?,?,?,?,?,?)",
    ).run("0123000000000001", "prefabs/orphan.et", "GenericEntity", null, null, "user", "MyAddon", now);

    const idx = new ProjectIndex(db);
    expect(idx.resolveAbsPathByGuid("0123000000000001")).toBe(onDisk);
  });

  it("returns null for an unknown GUID or NULL project_id", () => {
    const db = openProjectIndex(":memory:");
    try {
      const now = Date.now();
      // Resource with NULL project_id (pre-backfill row) → no owning project.
      db.prepare(
        "INSERT INTO resources (guid, file_path, root_type, class_name, parent_inherit, source, project_id, last_indexed) VALUES (?,?,?,?,?,?,?,?)",
      ).run("FFFF000000000001", "x.et", "GenericEntity", null, null, "user", null, now);
      const idx = new ProjectIndex(db);
      expect(idx.resolveAbsPathByGuid("FFFF000000000001")).toBeNull();
      expect(idx.resolveAbsPathByGuid("NOTINDEXED0000001")).toBeNull();
    } finally {
      db.close();
    }
  });
});

describe("formatScript path emission (RBE-8)", () => {
  it("emits the resolved absolute path, flagged on-disk", () => {
    const baseDir = mkdtempSync(join(tmpdir(), "rbe8-script-"));
    try {
      const abs = join(baseDir, "MyAddon", "prefabs", "orphan.et");
      const script = formatScript({
        candidates: [
          {
            guid: "0123000000000001",
            relPath: "prefabs/orphan.et",
            absPath: abs,
            source: "user",
            sizeBytes: 42,
            exists: true,
          },
        ],
        shell: "bash",
      });
      expect(script).toContain(abs);
      // A real absolute path must NOT be flagged as missing.
      expect(script).not.toContain("NOT ON DISK");
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });
});

/**
 * M12: cmd has no trailing-comment syntax — `REM` after `del` is just more
 * arguments. Comments must sit on their own line, and NOT-ON-DISK entries
 * must be comment-only in every shell so they can never execute.
 */
describe("formatScript comment placement (M12)", () => {
  const onDisk = {
    guid: "0123000000000001",
    relPath: "prefabs/a.et",
    absPath: "C:\proj\prefabs\a.et",
    source: "user" as const,
    sizeBytes: 1,
    exists: true,
  };
  const missing = { ...onDisk, guid: "0123000000000002", absPath: "C:\proj\prefabs\gone.et", exists: false };

  it("cmd: REM lines stand alone; del lines carry only the path", () => {
    const script = formatScript({ candidates: [onDisk, missing], shell: "cmd" });
    const lines = script.split("\n");
    for (const l of lines) {
      if (l.startsWith("del ")) {
        expect(l).toBe(`del /F "${onDisk.absPath}"`);
        expect(l).not.toMatch(/REM/);
      }
    }
    expect(lines).toContain(`REM {${onDisk.guid}} [user]`);
    // Missing file: comment-only line, no del anywhere near it.
    expect(lines.some((l) => l.startsWith("REM NOT ON DISK") && l.includes(missing.absPath))).toBe(true);
    expect(lines.filter((l) => l.startsWith("del ")).length).toBe(1);
  });

  it("bash / powershell: NOT ON DISK entries are comment-only", () => {
    for (const shell of ["bash", "powershell"] as const) {
      const script = formatScript({ candidates: [onDisk, missing], shell });
      const lines = script.split("\n");
      const missingLines = lines.filter((l) => l.includes(missing.absPath));
      expect(missingLines.length).toBe(1);
      expect(missingLines[0].startsWith("#")).toBe(true);
      const execLines = lines.filter((l) => /^(rm |Remove-Item )/.test(l));
      expect(execLines.length).toBe(1);
      expect(execLines[0]).toContain(onDisk.absPath);
    }
  });
});
