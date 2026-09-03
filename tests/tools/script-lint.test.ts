/**
 * Audit H13 — script_lint must surface parser diagnostics and must never
 * print "Clean" over a mangled AST.
 */
import { describe, it, expect } from "vitest";
import { lintScript, formatLintReport } from "../../src/tools/script-lint.ts";

describe("script_lint — parse diagnostics surfacing (H13)", () => {
  it("clean file with no findings prints Clean and no diagnostics section", () => {
    const src = `class Foo {\n\tstatic const string TAG = "x";\n\tvoid Init() {}\n}\n`;
    const report = lintScript(src, "Foo.c");
    expect(report.parseDiagnostics).toEqual([]);
    expect(report.fatalParse).toBe(false);
    const text = formatLintReport(report);
    expect(text).toContain("Clean");
    expect(text).not.toContain("Parse diagnostics");
  });

  it("recoverable parse problem: lists diagnostics, does NOT print Clean, not fatal", () => {
    // `int = 5;` is a bad member; the class itself still parses.
    const src = `class Foo {\n\tint = 5;\n\tint m_ok;\n}\n`;
    const report = lintScript(src, "Foo.c");
    expect(report.parseDiagnostics.length).toBeGreaterThan(0);
    expect(report.fatalParse).toBe(false);
    expect(report.findings).toEqual([]);
    const text = formatLintReport(report);
    expect(text).toMatch(/Parse diagnostics \(\d+\)/);
    expect(text).not.toContain("Clean");
    expect(text).toContain("- L2:");
    expect(text).not.toContain("Fatal parse");
  });

  it("fatal parse (zero classes recovered) is flagged", () => {
    const src = `class { not valid at all\n`;
    const report = lintScript(src, "Broken.c");
    expect(report.parseDiagnostics.length).toBeGreaterThan(0);
    expect(report.fatalParse).toBe(true);
    const text = formatLintReport(report);
    expect(text).toContain("Fatal parse");
    expect(text).toMatch(/Parse diagnostics \(\d+\)/);
    expect(text).not.toContain("Clean");
  });

  it("findings and diagnostics coexist under separate headings", () => {
    const src = `modded class Foo {\n\tint = 5;\n\toverride void Bar() { }\n}\n`;
    const report = lintScript(src, "Foo.c", ["missing_super_modded"]);
    expect(report.findings.some((f) => f.rule === "missing_super_modded")).toBe(true);
    const text = formatLintReport(report);
    expect(text).toMatch(/Parse diagnostics \(\d+\)/);
    expect(text).toContain("### Findings");
    expect(text).toContain("[W] L3 (missing_super_modded)");
    expect(text).not.toContain("Clean");
  });

  it("preprocessor guards and modifiers in a realistic file produce no diagnostics", () => {
    const src = `class SCR_X : Base
{
	#ifdef WORKBENCH
	static bool s_Dbg = false;
	#endif
	const static string CAT = "Game Mode";
	protected ref ScriptInvokerBase<SCR_Id> m_On = new ScriptInvokerBase<SCR_Id>();
	[Attribute("0", uiwidget: UIWidgets.Flags, "desc", "", ParamEnumArray.FromEnum(EFlags), CAT)]
	protected EFlags m_eFlags;
	override void EOnFrame(IEntity owner, float timeSlice) { super.EOnFrame(owner, timeSlice); }
}
`;
    const report = lintScript(src, "SCR_X.c", ["missing_super_modded", "rpc_missing_channel"]);
    expect(report.parseDiagnostics).toEqual([]);
    expect(formatLintReport(report)).toContain("Clean");
  });
});
