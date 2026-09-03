/**
 * Audit H13 — every AST consumer prints a "Parse diagnostics" section when
 * the parser reported problems: script_analyze, script_extract_interface,
 * script_class_hierarchy, script_overrides, script_find_rpc_handlers.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseScript } from "../../src/script-parser/parser.ts";
import { isFatalParse, formatParseDiagnostics, parseIssueFor } from "../../src/script-parser/diagnostics.ts";
import { formatScriptSummary } from "../../src/tools/script-analyze.ts";
import { formatInterface } from "../../src/tools/script-extract-interface.ts";
import { indexClassRecords, buildHierarchy, formatHierarchy } from "../../src/tools/script-class-hierarchy.ts";
import { findModdedChains, formatOverrides } from "../../src/tools/script-overrides.ts";
import { findRpcHandlers, formatRpcReport } from "../../src/tools/script-find-rpc-handlers.ts";
import type { ParseIssue } from "../../src/script-parser/diagnostics.ts";

const BAD_MEMBER = `class Foo : Base {\n\tint = 5;\n\tint m_ok;\n\t[RPC(RplChannel.Reliable)]\n\tvoid Rpc_Do() {}\n}\n`;
const MODDED_BAD = `modded class Foo {\n\tint = 5;\n\toverride void Bar() { super.Bar(); }\n}\n`;
const CLEAN = `class Clean : Foo {\n\tint m_i;\n}\n`;

describe("diagnostics helpers", () => {
  it("isFatalParse only when diagnostics exist and zero classes recovered", () => {
    expect(isFatalParse(parseScript(CLEAN))).toBe(false);
    expect(isFatalParse(parseScript(BAD_MEMBER))).toBe(false);
    expect(isFatalParse(parseScript(`class { broken`))).toBe(true);
    expect(isFatalParse(parseScript(``))).toBe(false);
  });

  it("formatParseDiagnostics is empty for a clean AST and capped otherwise", () => {
    expect(formatParseDiagnostics(parseScript(CLEAN))).toEqual([]);
    const many = `class Foo {\n${"\tint = 1;\n".repeat(40)}}`;
    const lines = formatParseDiagnostics(parseScript(many), 5);
    expect(lines[0]).toMatch(/^### Parse diagnostics \(\d+\)$/);
    expect(lines.some((l) => l.startsWith("- ... and "))).toBe(true);
  });

  it("parseIssueFor returns null for clean, issue with first message otherwise", () => {
    expect(parseIssueFor(parseScript(CLEAN), "a.c")).toBeNull();
    const issue = parseIssueFor(parseScript(BAD_MEMBER), "b.c");
    expect(issue).toMatchObject({ relPath: "b.c", fatal: false });
    expect(issue!.count).toBeGreaterThan(0);
    expect(issue!.first).toMatch(/^L2:/);
  });
});

describe("script_analyze surfaces parse diagnostics", () => {
  it("prints the section with class output when recoverable", () => {
    const ast = parseScript(BAD_MEMBER, "Foo.c");
    const text = formatScriptSummary({ filePath: "Foo.c", ast });
    expect(text).toContain("### class Foo : Base");
    expect(text).toMatch(/Parse diagnostics \(\d+\)/);
  });
  it("prints the section when nothing was recovered", () => {
    const ast = parseScript(`class { broken`, "Broken.c");
    const text = formatScriptSummary({ filePath: "Broken.c", ast });
    expect(text).toContain("(no class declarations found)");
    expect(text).toMatch(/Parse diagnostics \(\d+\)/);
  });
  it("no section on a clean file", () => {
    const text = formatScriptSummary({ filePath: "Clean.c", ast: parseScript(CLEAN, "Clean.c") });
    expect(text).not.toContain("Parse diagnostics");
  });
});

describe("script_extract_interface surfaces parse diagnostics", () => {
  it("prints the section when the ast is passed", () => {
    const ast = parseScript(BAD_MEMBER, "Foo.c");
    const text = formatInterface({ filePath: "Foo.c", classes: ast.classes, ast });
    expect(text).toMatch(/Parse diagnostics \(\d+\)/);
    expect(text).toContain("Rpc_Do");
  });
  it("no section on a clean file", () => {
    const ast = parseScript(CLEAN, "Clean.c");
    expect(formatInterface({ filePath: "Clean.c", classes: ast.classes, ast })).not.toContain("Parse diagnostics");
  });
});

describe("project walkers surface per-file parse issues", () => {
  let root: string;
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "emcp-h13-"));
    mkdirSync(join(root, "scripts"), { recursive: true });
    writeFileSync(join(root, "scripts", "Foo.c"), BAD_MEMBER);
    writeFileSync(join(root, "scripts", "FooMod.c"), MODDED_BAD);
    writeFileSync(join(root, "scripts", "Clean.c"), CLEAN);
  });
  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("script_class_hierarchy lists files with diagnostics", () => {
    const issues: ParseIssue[] = [];
    const idx = indexClassRecords(root, issues);
    expect(idx.has("Clean")).toBe(true);
    expect(issues.map((i) => i.relPath).sort()).toEqual(["scripts/Foo.c", "scripts/FooMod.c"]);
    const text = formatHierarchy({ projectRoot: root, root: buildHierarchy(idx, "Clean"), parseIssues: issues });
    expect(text).toContain("Clean → scripts/Clean.c:1");
    expect(text).toMatch(/### Parse diagnostics \(\d+ in 2 files\)/);
    expect(text).toContain("scripts/Foo.c:");
  });

  it("script_overrides lists files with diagnostics (with and without hits)", () => {
    const issues: ParseIssue[] = [];
    const hits = findModdedChains(root, {}, issues);
    expect(hits.map((h) => h.className)).toEqual(["Foo"]);
    // Only files containing `modded` are parsed by this walker.
    expect(issues.map((i) => i.relPath)).toEqual(["scripts/FooMod.c"]);
    const withHits = formatOverrides({ projectRoot: root, filter: {}, hits, filesScanned: 3, parseIssues: issues });
    expect(withHits).toMatch(/### Parse diagnostics \(\d+ in 1 file\)/);
    const noHits = formatOverrides({ projectRoot: root, filter: { className: "Nope" }, hits: [], filesScanned: 3, parseIssues: issues });
    expect(noHits).toContain("No `modded class Nope`");
    expect(noHits).toMatch(/### Parse diagnostics/);
  });

  it("script_find_rpc_handlers lists files with diagnostics", () => {
    const issues: ParseIssue[] = [];
    const hits = findRpcHandlers(root, { attributeName: "RPC" }, issues);
    expect(hits.map((h) => h.methodName)).toEqual(["Rpc_Do"]);
    expect(issues.map((i) => i.relPath)).toEqual(["scripts/Foo.c"]);
    const text = formatRpcReport({ projectRoot: root, attributeName: "RPC", hits, filesScanned: 3, parseIssues: issues });
    expect(text).toContain("Foo.Rpc_Do");
    expect(text).toMatch(/### Parse diagnostics \(\d+ in 1 file\)/);
    const none = formatRpcReport({ projectRoot: root, attributeName: "RPC", hits: [], filesScanned: 3, parseIssues: issues });
    expect(none).toContain("No RPC handlers found");
    expect(none).toMatch(/### Parse diagnostics/);
  });

  it("walkers print no section when every file is clean", () => {
    const cleanRoot = mkdtempSync(join(tmpdir(), "emcp-h13-clean-"));
    try {
      writeFileSync(join(cleanRoot, "Clean.c"), CLEAN);
      const issues: ParseIssue[] = [];
      const idx = indexClassRecords(cleanRoot, issues);
      expect(issues).toEqual([]);
      const text = formatHierarchy({ projectRoot: cleanRoot, root: buildHierarchy(idx, "Clean"), parseIssues: issues });
      expect(text).not.toContain("Parse diagnostics");
    } finally {
      rmSync(cleanRoot, { recursive: true, force: true });
    }
  });
});
