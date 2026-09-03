import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolve, sep } from "node:path";
import {
  assertInsideRoot,
  isPathInsideRoot,
} from "../../src/utils/path-guard.js";

describe("isPathInsideRoot", () => {
  const root = resolve("/testroot/project");

  it("accepts the root itself", () => {
    expect(isPathInsideRoot(root, root)).toBe(true);
  });

  it("accepts immediate children", () => {
    expect(isPathInsideRoot(resolve(root, "file.conf"), root)).toBe(true);
  });

  it("accepts deeply nested descendants", () => {
    expect(
      isPathInsideRoot(resolve(root, "a/b/c/d.conf"), root),
    ).toBe(true);
  });

  it("rejects a sibling directory", () => {
    expect(isPathInsideRoot(resolve("/testroot/other/file.conf"), root)).toBe(
      false,
    );
  });

  it("rejects parent directory", () => {
    expect(isPathInsideRoot(resolve("/testroot"), root)).toBe(false);
  });

  it("rejects ../ traversal", () => {
    // resolve() flattens ..; the resulting path is outside root.
    const escape = resolve(root, "..", "..", "etc", "passwd");
    expect(isPathInsideRoot(escape, root)).toBe(false);
  });

  it("prevents prefix-collision attacks (projectEvil vs project)", () => {
    // Sibling path that shares a name prefix with root.
    const evil = resolve("/testroot/projectEvil/hack.conf");
    expect(isPathInsideRoot(evil, root)).toBe(false);
  });

  it("re-resolves the root argument", () => {
    // Trailing slashes / redundant segments in `root` should normalize.
    expect(
      isPathInsideRoot(resolve(root, "file.conf"), root + sep),
    ).toBe(true);
  });
});

describe("assertInsideRoot", () => {
  const root = resolve("/testroot/project");

  it("does not throw for paths inside root", () => {
    expect(() =>
      assertInsideRoot(resolve(root, "Configs/Factions/US.conf"), root, "out_path"),
    ).not.toThrow();
  });

  it("throws for paths outside root", () => {
    expect(() =>
      assertInsideRoot(
        resolve("/testroot/escape.conf"),
        root,
        "out_path",
      ),
    ).toThrow(/resolves outside project root/);
  });

  it("includes the label in the error message", () => {
    expect(() =>
      assertInsideRoot(resolve("/elsewhere/hack.conf"), root, "out_path"),
    ).toThrow(/out_path resolves outside project root/);
  });

  it("includes the resolved path in the error message", () => {
    const bad = resolve("/elsewhere/hack.conf");
    expect(() => assertInsideRoot(bad, root, "out_path")).toThrow(bad);
  });

  it("includes the root in the error message", () => {
    const bad = resolve("/elsewhere/hack.conf");
    expect(() => assertInsideRoot(bad, root, "out_path")).toThrow(root);
  });
});

// ── L6 hardening: realpath, win32 prefixes, case, junctions ──────────────────

import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertInsideAnyRoot, canonicalizePath, stripWin32Prefix } from "../../src/utils/path-guard.js";

const IS_WIN = process.platform === "win32";

describe("path-guard hardening (L6)", () => {
  let base: string;
  let root: string;
  let outside: string;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "pathguard-"));
    root = join(base, "root");
    outside = join(base, "outside");
    mkdirSync(root, { recursive: true });
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, "secret.txt"), "x", "utf-8");
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it("rejects `..` that only escapes after normalization (existing root)", () => {
    const sneaky = resolve(root, "sub", "..", "..", "outside", "secret.txt");
    expect(isPathInsideRoot(sneaky, root)).toBe(false);
    expect(() => assertInsideRoot(sneaky, root, "path")).toThrow(/outside project root/);
  });

  it("accepts a not-yet-existing descendant of an existing root", () => {
    const fresh = resolve(root, "Prefabs", "New", "thing.et");
    expect(existsSync(fresh)).toBe(false);
    expect(isPathInsideRoot(fresh, root)).toBe(true);
  });

  it.skipIf(!IS_WIN)("rejects a case-flipped drive letter only when it actually escapes", () => {
    // Same path, drive letter case flipped → still inside (NTFS is case-insensitive).
    const flippedInside = root.charAt(0).toLowerCase() + root.slice(1) + sep + "file.conf";
    expect(isPathInsideRoot(flippedInside, root)).toBe(true);
    // Case-flipped path that really points elsewhere → outside.
    const flippedOutside = outside.charAt(0).toLowerCase() + outside.slice(1) + sep + "secret.txt";
    expect(isPathInsideRoot(flippedOutside, root)).toBe(false);
  });

  it.skipIf(!IS_WIN)("strips win32 device / UNC prefixes before comparing", () => {
    const BS = "\\";
    const devQ = BS + BS + "?" + BS; // \\?\
    const devDot = BS + BS + "." + BS; // \\.\
    expect(stripWin32Prefix(devQ + "C:" + BS + "x" + BS + "y")).toBe("C:" + BS + "x" + BS + "y");
    expect(stripWin32Prefix(devDot + "C:" + BS + "x" + BS + "y")).toBe("C:" + BS + "x" + BS + "y");
    expect(stripWin32Prefix(devQ + "UNC" + BS + "srv" + BS + "share" + BS + "f")).toBe(
      BS + BS + "srv" + BS + "share" + BS + "f",
    );
    // A \\?\-prefixed traversal must not bypass the `..` fold.
    const prefixed = devQ + [root, "sub", "..", "..", "outside", "secret.txt"].join(BS);
    expect(isPathInsideRoot(prefixed, root)).toBe(false);
    // A \\?\-prefixed path INSIDE the root is still accepted.
    const prefixedInside = devQ + root + BS + "file.conf";
    expect(isPathInsideRoot(prefixedInside, root)).toBe(true);
  });

  it.skipIf(!IS_WIN)("refuses a junction inside the root that points outside it", (ctx) => {
    const link = join(root, "link");
    try {
      execFileSync("cmd.exe", ["/c", "mklink", "/J", link, outside], { stdio: "ignore" });
    } catch {
      // Junction creation not permitted in this environment — nothing to test.
      ctx.skip();
      return;
    }
    if (!existsSync(join(link, "secret.txt"))) {
      ctx.skip();
      return;
    }
    const viaLink = resolve(link, "secret.txt");
    // Naive prefix check would pass this; realpath must refuse it.
    expect(viaLink.toLowerCase().startsWith(root.toLowerCase())).toBe(true);
    expect(canonicalizePath(viaLink).toLowerCase()).toBe(
      canonicalizePath(join(outside, "secret.txt")).toLowerCase(),
    );
    expect(isPathInsideRoot(viaLink, root)).toBe(false);
    expect(() => assertInsideRoot(viaLink, root, "path")).toThrow(/outside project root/);
  });

  it("assertInsideAnyRoot accepts a match in any listed root and ignores undefined roots", () => {
    expect(() =>
      assertInsideAnyRoot(resolve(outside, "secret.txt"), [root, undefined, outside], "p"),
    ).not.toThrow();
    expect(() => assertInsideAnyRoot(resolve(outside, "secret.txt"), [root, undefined], "p")).toThrow(
      /outside every configured root/,
    );
    expect(() => assertInsideAnyRoot(resolve(root, "a"), [undefined, ""], "p")).toThrow(
      /no configured project roots/,
    );
  });
});
