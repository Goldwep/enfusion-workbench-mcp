import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { diff, isNetZero, noisePattern, takeSnapshot } from "../../scripts/live/snapshot.js";

function makeTree(): string {
  const root = mkdtempSync(join(tmpdir(), "emcp-snap-"));
  mkdirSync(join(root, "Worlds"), { recursive: true });
  mkdirSync(join(root, "Backup"), { recursive: true });
  writeFileSync(join(root, "Worlds", "tiny.ent"), "a");
  writeFileSync(join(root, "Worlds", "tiny.layer"), "b");
  writeFileSync(join(root, "Backup", "x.bak"), "c");
  writeFileSync(join(root, "untouched.txt"), "outside the declared list");
  return root;
}

describe("takeSnapshot", () => {
  it("hashes only files under the declared paths", () => {
    const root = makeTree();
    try {
      const m = takeSnapshot(root, ["Worlds", "missing.conf"]);
      expect(Object.keys(m.files)).toEqual(["Worlds/tiny.ent", "Worlds/tiny.layer"]);
      expect(m.files["Worlds/tiny.ent"]).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects declared paths that escape the root", () => {
    expect(() => takeSnapshot(tmpdir(), ["../etc"])).toThrow("escapes the root");
  });
});

describe("diff", () => {
  it("reports added, removed and changed files", () => {
    const root = makeTree();
    try {
      const before = takeSnapshot(root, ["Worlds", "Backup"]);
      writeFileSync(join(root, "Worlds", "tiny.ent"), "changed");
      rmSync(join(root, "Worlds", "tiny.layer"));
      writeFileSync(join(root, "Worlds", "new.ent"), "new");
      const d = diff(before, takeSnapshot(root, ["Worlds", "Backup"]));
      expect(d).toEqual({
        added: ["Worlds/new.ent"],
        removed: ["Worlds/tiny.layer"],
        changed: ["Worlds/tiny.ent"],
        noise: [],
      });
      expect(isNetZero(d)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("drops differences on the expected-noise list", () => {
    const root = makeTree();
    try {
      const before = takeSnapshot(root, ["Worlds", "Backup"]);
      writeFileSync(join(root, "Backup", "y.bak"), "noise");
      writeFileSync(join(root, "Worlds", "tiny.layer"), "noise too");
      const d = diff(before, takeSnapshot(root, ["Worlds", "Backup"]), ["Backup/", "**/*.layer"]);
      expect(isNetZero(d)).toBe(true);
      expect(d.noise).toEqual(["Backup/y.bak", "Worlds/tiny.layer"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("noisePattern", () => {
  it("keeps a single star within one segment", () => {
    expect(noisePattern("Worlds/*.ent").test("Worlds/a.ent")).toBe(true);
    expect(noisePattern("Worlds/*.ent").test("Worlds/sub/a.ent")).toBe(false);
  });

  it("lets a double star cross segments", () => {
    expect(noisePattern("**/*.meta").test("a/b/c.meta")).toBe(true);
    expect(noisePattern("**/*.meta").test("c.meta")).toBe(true);
  });
});
