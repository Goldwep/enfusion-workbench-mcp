/**
 * Review round 1, F9: the offline writers replace a file by write-then-rename, so a failed write
 * leaves the target as it was instead of cut short.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renameOver, writeFileAtomic } from "../../src/utils/atomic-write.js";

let dir = "";
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "atomic-write-"));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("writeFileAtomic (review F9)", () => {
  it("replaces the file and leaves no temporary sibling", () => {
    const f = join(dir, "a.txt");
    writeFileSync(f, "old");
    writeFileAtomic(f, "new");
    expect(readFileSync(f, "utf-8")).toBe("new");
    expect(readdirSync(dir).filter((n) => n.includes(".tmp-"))).toEqual([]);
  });

  it("writes a Buffer byte exact", () => {
    const f = join(dir, "b.bin");
    const bytes = Buffer.from([0xef, 0xbb, 0xbf, 0x00, 0xff, 0x0d, 0x0a]);
    writeFileAtomic(f, bytes);
    expect(readFileSync(f).equals(bytes)).toBe(true);
  });

  it("a failed write leaves the target unchanged and removes the temporary file", () => {
    // The target is a folder holding a file: the rename over it fails, the folder stays.
    const target = join(dir, "busy");
    mkdirSync(target);
    writeFileSync(join(target, "keep.txt"), "kept");
    expect(() => writeFileAtomic(target, "x")).toThrow();
    expect(readFileSync(join(target, "keep.txt"), "utf-8")).toBe("kept");
    expect(readdirSync(dir).filter((n) => n.includes(".tmp-"))).toEqual([]);
  });

  it("a rename refused EPERM for good (Workbench holds the file open) falls back to an in-place write", () => {
    const f = join(dir, "held.conf");
    writeFileSync(f, "old");
    const rename = () => {
      throw Object.assign(new Error("held"), { code: "EPERM" });
    };
    writeFileAtomic(f, "new", { rename });
    expect(readFileSync(f, "utf-8")).toBe("new");
    expect(readdirSync(dir).filter((n) => n.includes(".tmp-"))).toEqual([]);
  }, 15_000);

  it("mkdir creates the folder first", () => {
    const f = join(dir, "new", "deep", "c.txt");
    writeFileAtomic(f, "c", { mkdir: true });
    expect(readFileSync(f, "utf-8")).toBe("c");
  });
});

describe("renameOver busy retry", () => {
  const busy = (n: number) => {
    let calls = 0;
    const rename = () => {
      calls++;
      if (calls <= n) throw Object.assign(new Error("busy"), { code: "EBUSY" });
    };
    return { rename, calls: () => calls };
  };

  it("retries an EBUSY rename when asked", () => {
    const b = busy(2);
    renameOver("t", "f", true, b.rename);
    expect(b.calls()).toBe(3);
  });

  it("does not retry without busyRetry", () => {
    const b = busy(1);
    expect(() => renameOver("t", "f", false, b.rename)).toThrow("busy");
    expect(b.calls()).toBe(1);
  });

  it("does not retry another error", () => {
    let calls = 0;
    const rename = () => {
      calls++;
      throw Object.assign(new Error("nope"), { code: "ENOENT" });
    };
    expect(() => renameOver("t", "f", true, rename)).toThrow("nope");
    expect(calls).toBe(1);
  });
});
