import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  findDepsBlock,
  parseDepBody,
  normalizeEntries,
  renderDepBody,
  registerRefactorNormalizeDependencies,
} from "../../src/tools/refactor-normalize-dependencies.js";
import type { ProjectIndex } from "../../src/project-index/project-index.js";
import { captureTool, makeConfig, textOf } from "./_tool-harness.js";

const fakeIndex = { resolveGuid: () => null } as unknown as ProjectIndex;

describe("findDepsBlock (RBE-7 / M13)", () => {
  it("finds the matching brace even when the body contains nested braces", () => {
    const content = `GameProject {\n ID "X"\n Dependencies {\n  "AAAA000000000001"\n  Nested {\n   "BBBB000000000002"\n  }\n  "CCCC000000000003"\n }\n TITLE "t"\n}\n`;
    const b = findDepsBlock(content);
    expect(b).not.toBeNull();
    expect(content.slice(b!.start, b!.end)).toBe(
      `Dependencies {\n  "AAAA000000000001"\n  Nested {\n   "BBBB000000000002"\n  }\n  "CCCC000000000003"\n }`,
    );
    // The old `[^}]*` regex would have stopped at the Nested `}` and
    // orphaned `"CCCC..." }` — everything after the block is intact here.
    expect(content.slice(b!.end)).toBe(`\n TITLE "t"\n}\n`);
  });

  it("ignores braces inside quoted strings and returns null when unbalanced", () => {
    const b = findDepsBlock(`Dependencies {\n "we{ird}"\n}`);
    expect(b).not.toBeNull();
    expect(b!.body).toBe(`\n "we{ird}"\n`);
    expect(findDepsBlock(`Dependencies {\n "A"\n`)).toBeNull();
    expect(findDepsBlock(`NoDeps { }`)).toBeNull();
    expect(findDepsBlock(`XDependencies { }`)).toBeNull();
  });
});

describe("parseDepBody / renderDepBody", () => {
  it("preserves non-GUID lines byte-for-byte and never re-quotes them", () => {
    const body = `\n "bbbb000000000002"\n   weird_line_with   spaces\n "AAAA000000000001"\n`;
    const parsed = parseDepBody(body);
    expect(parsed.passthrough).toEqual(["   weird_line_with   spaces"]);
    expect(parsed.indent).toBe(" ");
    expect(parsed.eol).toBe("\n");
    const { sorted } = normalizeEntries(parsed.entries);
    const out = renderDepBody(sorted, {
      indent: parsed.indent,
      eol: parsed.eol ?? "\n",
      passthrough: parsed.passthrough,
    });
    expect(out).toBe(`\n "AAAA000000000001"\n "BBBB000000000002"\n   weird_line_with   spaces\n`);
  });

  it("emits CRLF when the body uses CRLF", () => {
    const body = `\r\n  "BBBB000000000002"\r\n  "AAAA000000000001"\r\n`;
    const parsed = parseDepBody(body);
    expect(parsed.eol).toBe("\r\n");
    expect(parsed.indent).toBe("  ");
    const { sorted } = normalizeEntries(parsed.entries);
    const out = renderDepBody(sorted, { indent: parsed.indent, eol: parsed.eol!, passthrough: [] });
    expect(out).toBe(`\r\n  "AAAA000000000001"\r\n  "BBBB000000000002"\r\n`);
    expect(out).not.toMatch(/[^\r]\n/);
  });
});

describe("refactor_normalize_dependencies handler", () => {
  let base: string;
  let root: string;
  let outside: string;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "normdeps-"));
    root = join(base, "root");
    outside = join(base, "outside");
    mkdirSync(root, { recursive: true });
    mkdirSync(outside, { recursive: true });
  });
  afterEach(() => rmSync(base, { recursive: true, force: true }));

  function tool() {
    return captureTool((s) =>
      registerRefactorNormalizeDependencies(s, fakeIndex, makeConfig({ projectPath: root })),
    );
  }

  it("refuses a gproj_path outside every configured root and writes nothing (H7)", async () => {
    const gproj = join(outside, "Evil.gproj");
    const original = `GameProject {\n Dependencies {\n  "BBBB000000000002"\n  "AAAA000000000001"\n }\n}\n`;
    writeFileSync(gproj, original, "utf-8");
    const r = await tool()({ gproj_path: gproj, check_resolution: false, commit: true, force: true });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/outside every configured root/);
    expect(readFileSync(gproj, "utf-8")).toBe(original);
  });

  it("refuses a non-.gproj path (H7)", async () => {
    const p = join(root, "notes.txt");
    writeFileSync(p, "Dependencies {\n}\n", "utf-8");
    const r = await tool()({ gproj_path: p, check_resolution: false, commit: true, force: true });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/must end in \.gproj/);
  });

  it("commits a normalized block, keeping CRLF, nested tail text and non-GUID lines (M13)", async () => {
    const gproj = join(root, "Mod.gproj");
    const original =
      `GameProject {\r\n ID "Mod"\r\n Dependencies {\r\n  "bbbb000000000002"\r\n  Nested {\r\n   x 1\r\n  }\r\n  "AAAA000000000001"\r\n  "AAAA000000000001"\r\n }\r\n TITLE "t"\r\n}\r\n`;
    writeFileSync(gproj, original, "utf-8");
    const r = await tool()({ gproj_path: gproj, check_resolution: false, commit: true, force: true });
    expect(r.isError).toBeUndefined();
    expect(textOf(r)).toMatch(/Committed/);
    const after = readFileSync(gproj, "utf-8");
    expect(after).toBe(
      `GameProject {\r\n ID "Mod"\r\n Dependencies {\r\n  "AAAA000000000001"\r\n  "BBBB000000000002"\r\n  Nested {\r\n   x 1\r\n  }\r\n }\r\n TITLE "t"\r\n}\r\n`,
    );
    // No bare LF introduced anywhere.
    expect(after.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("reports already-canonical without writing", async () => {
    const gproj = join(root, "Mod.gproj");
    const original = `GameProject {\n Dependencies {\n  "AAAA000000000001"\n  "BBBB000000000002"\n }\n}\n`;
    writeFileSync(gproj, original, "utf-8");
    const r = await tool()({ gproj_path: gproj, check_resolution: false, commit: true, force: true });
    expect(r.isError).toBeUndefined();
    expect(textOf(r)).toMatch(/Already canonical/);
    expect(readFileSync(gproj, "utf-8")).toBe(original);
  });
});
