import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  MAX_TEXT_FILE_BYTES,
  readTextFileBounded,
} from "../../src/utils/safe-read.js";

describe("readTextFileBounded", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "safe-read-"));
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("exposes an 8 MiB default cap", () => {
    expect(MAX_TEXT_FILE_BYTES).toBe(8 * 1024 * 1024);
  });

  it("returns the file's text when under the cap", () => {
    const p = join(tmpRoot, "small.txt");
    writeFileSync(p, "hello world");
    expect(readTextFileBounded(p)).toBe("hello world");
  });

  it("returns an empty string for an empty file", () => {
    const p = join(tmpRoot, "empty.txt");
    writeFileSync(p, "");
    expect(readTextFileBounded(p)).toBe("");
  });

  it("throws when the file exceeds an explicit cap", () => {
    const p = join(tmpRoot, "big.txt");
    // 1 KiB of data, cap at 512 B.
    writeFileSync(p, "x".repeat(1024));
    expect(() => readTextFileBounded(p, 512)).toThrow(/File too large/);
  });

  it("throws when the file equals cap + 1 bytes", () => {
    const p = join(tmpRoot, "boundary.txt");
    writeFileSync(p, "x".repeat(101));
    expect(() => readTextFileBounded(p, 100)).toThrow(/File too large/);
  });

  it("succeeds when the file is exactly at the cap", () => {
    const p = join(tmpRoot, "atcap.txt");
    writeFileSync(p, "x".repeat(100));
    expect(readTextFileBounded(p, 100)).toBe("x".repeat(100));
  });

  it("succeeds when the file is one byte under the cap", () => {
    const p = join(tmpRoot, "undercap.txt");
    writeFileSync(p, "x".repeat(99));
    expect(readTextFileBounded(p, 100)).toBe("x".repeat(99));
  });

  it("throws when the file is missing", () => {
    expect(() => readTextFileBounded(join(tmpRoot, "nope.txt"))).toThrow();
  });

  it("includes the path and byte count in the error message", () => {
    const p = join(tmpRoot, "named.txt");
    writeFileSync(p, "x".repeat(200));
    expect(() => readTextFileBounded(p, 50)).toThrow(/named\.txt/);
    expect(() => readTextFileBounded(p, 50)).toThrow(/200 bytes/);
    expect(() => readTextFileBounded(p, 50)).toThrow(/50 byte cap/);
  });
});
