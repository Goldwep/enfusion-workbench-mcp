/**
 * scripts/build-stamp.ts: the generated stamp equals client.ts bundleDigest, the stamp file is
 * left out of its own digest, and --check fails on a stale or missing stamp. Temp folders only.
 */

import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readStamp, run, stampSource } from "../../scripts/build-stamp.js";
import { memoryIo } from "../../scripts/census/cli-common.js";
import { BUILD_STAMP_FILE, bundleDigest } from "../../src/workbench/client.js";

const dirs: string[] = [];
function bundle(): string {
  const dir = mkdtempSync(join(tmpdir(), "build-stamp-"));
  dirs.push(dir);
  writeFileSync(join(dir, "EMCP_WB_A.c"), "class A {}\n");
  writeFileSync(join(dir, "EMCP_WB_B.c"), "class B {}\n");
  writeFileSync(join(dir, "notes.txt"), "not a handler\n");
  return dir;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("build-stamp", () => {
  it("writes the client's bundleDigest into the generated file", () => {
    const dir = bundle();
    expect(run(["--dir", dir], memoryIo())).toBe(0);
    const text = readFileSync(join(dir, BUILD_STAMP_FILE), "utf-8");
    expect(readStamp(text)).toBe(bundleDigest(dir));
    expect(text).toContain("class EMCP_WB_BuildStamp");
  });

  it("leaves the stamp file out of the digest, so writing it does not change the digest", () => {
    const dir = bundle();
    const before = bundleDigest(dir);
    run(["--dir", dir], memoryIo());
    expect(bundleDigest(dir)).toBe(before);
    expect(run(["--dir", dir, "--check"], memoryIo())).toBe(0);
  });

  it("--check fails when a handler changes after the stamp was written", () => {
    const dir = bundle();
    run(["--dir", dir], memoryIo());
    writeFileSync(join(dir, "EMCP_WB_A.c"), "class A { int x; }\n");
    const io = memoryIo();
    expect(run(["--dir", dir, "--check"], io)).toBe(1);
    expect(io.stderr()).toContain("STALE");
  });

  it("--check fails when the stamp file is missing and writes nothing", () => {
    const dir = bundle();
    expect(run(["--dir", dir, "--check"], memoryIo())).toBe(1);
    expect(() => readFileSync(join(dir, BUILD_STAMP_FILE))).toThrow();
  });

  it("a CRLF and an LF copy of the same handlers hash equal", () => {
    const lf = bundle();
    const crlf = bundle();
    writeFileSync(join(lf, "EMCP_WB_C.c"), "class C\n{\n\tint x;\n}\n");
    writeFileSync(join(crlf, "EMCP_WB_C.c"), "class C\r\n{\r\n\tint x;\r\n}\r\n");
    expect(bundleDigest(crlf)).toBe(bundleDigest(lf));
    run(["--dir", lf], memoryIo());
    writeFileSync(join(crlf, BUILD_STAMP_FILE), readFileSync(join(lf, BUILD_STAMP_FILE)));
    expect(run(["--dir", crlf, "--check"], memoryIo())).toBe(0);
  });

  it("usage errors and an empty folder exit 2", () => {
    expect(run(["--bogus"], memoryIo())).toBe(2);
    const empty = mkdtempSync(join(tmpdir(), "build-stamp-empty-"));
    dirs.push(empty);
    expect(run(["--dir", empty], memoryIo())).toBe(2);
  });

  it("the generated source holds exactly one constant that readStamp reads back", () => {
    const src = stampSource("abc123");
    expect(readStamp(src)).toBe("abc123");
    expect(src.match(/static const/g)).toHaveLength(1);
  });

  it("the shipped stamp file is generated text", () => {
    const shipped = readFileSync(
      join("mod", "Scripts", "WorkbenchGame", "EnfusionMCP", BUILD_STAMP_FILE),
      "utf-8",
    );
    const stamp = readStamp(shipped);
    expect(stamp).toMatch(/^[0-9a-f]{40}$/);
    expect(shipped).toBe(stampSource(stamp as string));
  });

  it("the shipped stamp matches the shipped handler bundle (live-client-10: run scripts/build-stamp.ts after a handler edit)", () => {
    const dir = join("mod", "Scripts", "WorkbenchGame", "EnfusionMCP");
    const stamp = readStamp(readFileSync(join(dir, BUILD_STAMP_FILE), "utf-8"));
    expect(stamp).toBe(bundleDigest(dir));
  });
});
