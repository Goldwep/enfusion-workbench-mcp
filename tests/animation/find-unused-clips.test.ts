import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  extractAnmRefs,
  findUnusedClips,
  formatBytes,
  formatModifiedDate,
  formatUnusedClipsJson,
  formatUnusedClipsMarkdown,
  walkExtensions,
} from "../../src/animation/find-unused-clips.js";

describe("extractAnmRefs", () => {
  it("extracts a single ref", () => {
    const refs = extractAnmRefs('Source "{ABCDEF1234567890}Anims/idle.anm"');
    expect([...refs]).toEqual(["anims/idle.anm"]);
  });

  it("ignores refs without the GUID prefix", () => {
    const refs = extractAnmRefs('Source "Anims/idle.anm"');
    expect(refs.size).toBe(0);
  });

  it("ignores refs to non-.anm files", () => {
    const refs = extractAnmRefs('Asset "{ABCDEF1234567890}Anims/idle.xob"');
    expect(refs.size).toBe(0);
  });

  it("collects refs from a multi-line block (AGF Source nodes)", () => {
    const content = `AnimSrcNodeSource Idle {
       Source "{1111111111111111}Anims/idle.anm"
     }
     AnimSrcNodeSource Walk {
       Source "{2222222222222222}Anims/walk_fwd.anm"
     }`;
    expect([...extractAnmRefs(content)].sort()).toEqual([
      "anims/idle.anm",
      "anims/walk_fwd.anm",
    ]);
  });

  it("collects ASI column refs", () => {
    const content = `
     AnimSetInstanceColumn Erc {
      Animations {
       "{AAAAAAAAAAAAAAAA}Anims/idle_erc.anm"
       "{BBBBBBBBBBBBBBBB}Anims/walk_fwd_erc.anm"
       ""
      }
     }`;
    expect([...extractAnmRefs(content)].sort()).toEqual([
      "anims/idle_erc.anm",
      "anims/walk_fwd_erc.anm",
    ]);
  });

  it("lowercases and forward-slashes", () => {
    const refs = extractAnmRefs('Source "{ABCDEF1234567890}Anims\\Sub\\Idle.ANM"');
    expect([...refs]).toEqual(["anims/sub/idle.anm"]);
  });

  it("de-duplicates repeated refs", () => {
    const content =
      'a "{1111111111111111}Anims/dup.anm" b "{2222222222222222}Anims/dup.anm"';
    const refs = extractAnmRefs(content);
    expect(refs.size).toBe(1);
    expect([...refs]).toEqual(["anims/dup.anm"]);
  });
});

describe("walkExtensions", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "fuc-walk-"));
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("returns empty for missing directory", () => {
    const out = walkExtensions(join(tmpRoot, "does-not-exist"), new Set([".anm"]));
    expect(out).toEqual([]);
  });

  it("collects matching files recursively, forward-slashed", () => {
    mkdirSync(join(tmpRoot, "a", "b"), { recursive: true });
    writeFileSync(join(tmpRoot, "a", "one.anm"), "x");
    writeFileSync(join(tmpRoot, "a", "b", "two.anm"), "y");
    writeFileSync(join(tmpRoot, "a", "skip.txt"), "z");
    const out = walkExtensions(tmpRoot, new Set([".anm"])).sort();
    expect(out).toEqual(["a/b/two.anm", "a/one.anm"]);
  });

  it("skips node_modules / .git / dist", () => {
    mkdirSync(join(tmpRoot, "node_modules"), { recursive: true });
    mkdirSync(join(tmpRoot, ".git"), { recursive: true });
    mkdirSync(join(tmpRoot, "dist"), { recursive: true });
    mkdirSync(join(tmpRoot, "src"), { recursive: true });
    writeFileSync(join(tmpRoot, "node_modules", "skip.anm"), "x");
    writeFileSync(join(tmpRoot, ".git", "skip.anm"), "x");
    writeFileSync(join(tmpRoot, "dist", "skip.anm"), "x");
    writeFileSync(join(tmpRoot, "src", "keep.anm"), "x");
    const out = walkExtensions(tmpRoot, new Set([".anm"]));
    expect(out).toEqual(["src/keep.anm"]);
  });

  it("matches extension set case-insensitively", () => {
    writeFileSync(join(tmpRoot, "UPPER.ANM"), "x");
    writeFileSync(join(tmpRoot, "lower.anm"), "x");
    const out = walkExtensions(tmpRoot, new Set([".anm"])).sort();
    expect(out).toEqual(["UPPER.ANM", "lower.anm"]);
  });
});

describe("findUnusedClips", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "fuc-"));
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("flags clips not referenced by any AGF/ASI/AGR/.conf", () => {
    mkdirSync(join(tmpRoot, "Anims"), { recursive: true });
    mkdirSync(join(tmpRoot, "Graph"), { recursive: true });
    writeFileSync(join(tmpRoot, "Anims", "used.anm"), "X");
    writeFileSync(join(tmpRoot, "Anims", "unused.anm"), "YYYY");
    writeFileSync(
      join(tmpRoot, "Graph", "graph.agf"),
      'Source "{1111111111111111}Anims/used.anm"',
    );

    const r = findUnusedClips([{ rootPath: tmpRoot }]);
    expect(r.totalOnDisk).toBe(2);
    expect(r.referencedCount).toBe(1);
    expect(r.unused).toHaveLength(1);
    expect(r.unused[0].relPath).toBe("Anims/unused.anm");
    expect(r.unused[0].size).toBe(4);
    expect(r.filesScanned).toBe(1);
  });

  it("returns no unused when every clip is referenced", () => {
    mkdirSync(join(tmpRoot, "Anims"), { recursive: true });
    writeFileSync(join(tmpRoot, "Anims", "idle.anm"), "x");
    writeFileSync(join(tmpRoot, "Anims", "walk.anm"), "x");
    writeFileSync(
      join(tmpRoot, "graph.agf"),
      `Source "{1111111111111111}Anims/idle.anm"
       Source "{2222222222222222}Anims/walk.anm"`,
    );
    const r = findUnusedClips([{ rootPath: tmpRoot }]);
    expect(r.unused).toEqual([]);
    expect(r.referencedCount).toBe(2);
  });

  it("counts refs from .agf, .asi, .agr, and .conf", () => {
    mkdirSync(join(tmpRoot, "Anims"), { recursive: true });
    writeFileSync(join(tmpRoot, "Anims", "a.anm"), "x");
    writeFileSync(join(tmpRoot, "Anims", "b.anm"), "x");
    writeFileSync(join(tmpRoot, "Anims", "c.anm"), "x");
    writeFileSync(join(tmpRoot, "Anims", "d.anm"), "x");
    writeFileSync(join(tmpRoot, "x.agf"), '"{1111111111111111}Anims/a.anm"');
    writeFileSync(join(tmpRoot, "x.asi"), '"{2222222222222222}Anims/b.anm"');
    writeFileSync(join(tmpRoot, "x.agr"), '"{3333333333333333}Anims/c.anm"');
    writeFileSync(join(tmpRoot, "x.conf"), '"{4444444444444444}Anims/d.anm"');
    const r = findUnusedClips([{ rootPath: tmpRoot }]);
    expect(r.unused).toEqual([]);
    expect(r.referencedCount).toBe(4);
    expect(r.filesScanned).toBe(4);
  });

  it("handles empty project", () => {
    mkdirSync(join(tmpRoot, "empty"), { recursive: true });
    const r = findUnusedClips([{ rootPath: tmpRoot }]);
    expect(r.totalOnDisk).toBe(0);
    expect(r.referencedCount).toBe(0);
    expect(r.unused).toEqual([]);
  });

  it("dedupes .anm across multiple roots when same relative path appears", () => {
    const a = join(tmpRoot, "projA");
    const b = join(tmpRoot, "projB");
    mkdirSync(join(a, "Anims"), { recursive: true });
    mkdirSync(join(b, "Anims"), { recursive: true });
    writeFileSync(join(a, "Anims", "shared.anm"), "AAAA");
    writeFileSync(join(b, "Anims", "shared.anm"), "B");
    writeFileSync(join(a, "Anims", "onlyA.anm"), "x");
    writeFileSync(
      join(a, "ref.agf"),
      '"{1111111111111111}Anims/shared.anm"',
    );

    const r = findUnusedClips([
      { rootPath: a, projectId: "projA" },
      { rootPath: b, projectId: "projB" },
    ]);
    // shared.anm and onlyA.anm — shared.anm is referenced; onlyA.anm is not.
    expect(r.totalOnDisk).toBe(2);
    expect(r.unused.map((u) => u.relPath)).toEqual(["Anims/onlyA.anm"]);
  });

  it("sorts unused output by path", () => {
    mkdirSync(join(tmpRoot, "Anims"), { recursive: true });
    writeFileSync(join(tmpRoot, "Anims", "zzz.anm"), "x");
    writeFileSync(join(tmpRoot, "Anims", "aaa.anm"), "x");
    writeFileSync(join(tmpRoot, "Anims", "mmm.anm"), "x");
    const r = findUnusedClips([{ rootPath: tmpRoot }]);
    expect(r.unused.map((u) => u.relPath)).toEqual([
      "Anims/aaa.anm",
      "Anims/mmm.anm",
      "Anims/zzz.anm",
    ]);
  });

  it("captures size + mtime metadata", () => {
    mkdirSync(join(tmpRoot, "Anims"), { recursive: true });
    writeFileSync(join(tmpRoot, "Anims", "x.anm"), "1234567");
    const r = findUnusedClips([{ rootPath: tmpRoot }]);
    expect(r.unused).toHaveLength(1);
    expect(r.unused[0].size).toBe(7);
    expect(r.unused[0].lastModified).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("formatters", () => {
  it("formatBytes covers each unit", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe("3.0 GB");
  });

  it("formatModifiedDate strips time", () => {
    expect(formatModifiedDate("2025-12-01T13:14:15.000Z")).toBe("2025-12-01");
    expect(formatModifiedDate("")).toBe("(unknown)");
  });

  it("markdown formatter renders a table when there are unused", () => {
    const md = formatUnusedClipsMarkdown({
      projectLabel: "ProjA",
      result: {
        totalOnDisk: 2,
        referencedCount: 1,
        unused: [
          {
            relPath: "Anims/orphan.anm",
            size: 2048,
            lastModified: "2025-12-01T00:00:00.000Z",
          },
        ],
        filesScanned: 3,
      },
    });
    expect(md).toContain("## Unused .anm clips in ProjA");
    expect(md).toContain("Total .anm on disk: 2");
    expect(md).toContain("Referenced: 1");
    expect(md).toContain("Unused: 1");
    expect(md).toContain("| File | Size | Last Modified |");
    expect(md).toContain("Anims/orphan.anm");
    expect(md).toContain("2.0 KB");
    expect(md).toContain("2025-12-01");
  });

  it("markdown formatter says 'no unused' when empty", () => {
    const md = formatUnusedClipsMarkdown({
      projectLabel: "Clean",
      result: { totalOnDisk: 5, referencedCount: 5, unused: [], filesScanned: 4 },
    });
    expect(md).toContain("No unused .anm clips found");
    expect(md).not.toContain("| File |");
  });

  it("json formatter emits parseable JSON", () => {
    const json = formatUnusedClipsJson({
      projectLabel: "ProjA",
      result: {
        totalOnDisk: 1,
        referencedCount: 0,
        unused: [
          {
            relPath: "Anims/orphan.anm",
            size: 100,
            lastModified: "2025-12-01T00:00:00.000Z",
          },
        ],
        filesScanned: 0,
      },
    });
    const parsed = JSON.parse(json);
    expect(parsed.project).toBe("ProjA");
    expect(parsed.unused).toHaveLength(1);
    expect(parsed.unused[0].relPath).toBe("Anims/orphan.anm");
  });
});
