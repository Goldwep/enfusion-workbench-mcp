import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  DEFAULT_MAX_FILES,
  SKIP_DIRS,
  walkExtensions,
} from "../../src/utils/walk-extensions.js";

describe("walkExtensions", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "walk-ext-"));
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("exposes the canonical SKIP_DIRS set", () => {
    expect(SKIP_DIRS.has("node_modules")).toBe(true);
    expect(SKIP_DIRS.has(".git")).toBe(true);
    expect(SKIP_DIRS.has("dist")).toBe(true);
    expect(SKIP_DIRS.has(".vs")).toBe(true);
    expect(SKIP_DIRS.has(".cache")).toBe(true);
  });

  it("returns empty for missing directory", () => {
    const out = walkExtensions(join(tmpRoot, "does-not-exist"), new Set([".anm"]));
    expect(out).toEqual([]);
  });

  it("returns empty for a file path (not a directory)", () => {
    const filePath = join(tmpRoot, "a-file.txt");
    writeFileSync(filePath, "x");
    expect(walkExtensions(filePath, new Set([".txt"]))).toEqual([]);
  });

  it("collects matching files recursively, forward-slashed", () => {
    mkdirSync(join(tmpRoot, "a", "b"), { recursive: true });
    writeFileSync(join(tmpRoot, "a", "one.anm"), "x");
    writeFileSync(join(tmpRoot, "a", "b", "two.anm"), "y");
    writeFileSync(join(tmpRoot, "a", "skip.txt"), "z");
    const out = walkExtensions(tmpRoot, new Set([".anm"])).sort();
    expect(out).toEqual(["a/b/two.anm", "a/one.anm"]);
  });

  it("skips every entry in SKIP_DIRS", () => {
    for (const skip of SKIP_DIRS) {
      mkdirSync(join(tmpRoot, skip), { recursive: true });
      writeFileSync(join(tmpRoot, skip, "skip.anm"), "x");
    }
    mkdirSync(join(tmpRoot, "src"), { recursive: true });
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

  it("matches multiple extensions", () => {
    writeFileSync(join(tmpRoot, "a.agf"), "x");
    writeFileSync(join(tmpRoot, "b.asi"), "x");
    writeFileSync(join(tmpRoot, "c.txt"), "x");
    const out = walkExtensions(tmpRoot, new Set([".agf", ".asi"])).sort();
    expect(out).toEqual(["a.agf", "b.asi"]);
  });

  it("returns an empty list when no extensions match", () => {
    writeFileSync(join(tmpRoot, "a.txt"), "x");
    expect(walkExtensions(tmpRoot, new Set([".pdf"]))).toEqual([]);
  });

  it("respects an explicit maxFiles cap", () => {
    for (let i = 0; i < 10; i++) {
      writeFileSync(join(tmpRoot, `f${i}.anm`), "x");
    }
    const out = walkExtensions(tmpRoot, new Set([".anm"]), 3);
    expect(out.length).toBe(3);
  });

  it("exposes a generous default cap", () => {
    expect(DEFAULT_MAX_FILES).toBe(50_000);
  });

  it("treats a ReadonlySet the same as a Set", () => {
    writeFileSync(join(tmpRoot, "a.anm"), "x");
    const ro: ReadonlySet<string> = new Set([".anm"]);
    expect(walkExtensions(tmpRoot, ro)).toEqual(["a.anm"]);
  });
});
