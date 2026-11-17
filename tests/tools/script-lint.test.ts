/**
 * Audit H13 — script_lint must surface parser diagnostics and must never
 * print "Clean" over a mangled AST.
 */
import { describe, it, expect } from "vitest";
import { lintScript, formatLintReport } from "../../src/tools/script-lint.js";

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

describe("script_lint — rpc_missing_channel", () => {
  it("flags Enforce's [RplRpc()] with no channel args", () => {
    const src = `class SCR_R : ScriptComponent\n{\n\t[RplRpc()]\n\tprotected void RpcDo_Thing() {}\n}\n`;
    const report = lintScript(src, "SCR_R.c", ["rpc_missing_channel"]);
    const f = report.findings.filter((x) => x.rule === "rpc_missing_channel");
    expect(f).toHaveLength(1);
    expect(f[0].message).toContain("[RplRpc(RplChannel.Reliable, RplRcver.Server)]");
    expect(formatLintReport(report)).not.toContain("Clean");
  });

  it("does not flag [RplRpc(...)] with args", () => {
    const src = `class SCR_R : ScriptComponent\n{\n\t[RplRpc(RplChannel.Reliable, RplRcver.Owner)]\n\tprotected void RpcDo_Thing() {}\n}\n`;
    const report = lintScript(src, "SCR_R.c", ["rpc_missing_channel"]);
    expect(report.findings).toHaveLength(0);
  });
});

describe("script_lint — unknown rule names (read-knowledge-10)", () => {
  it("a misspelled rule is refused with isError, not reported Clean", async () => {
    const { captureTool, textOf } = await import("./_tool-harness.js");
    const { registerScriptLint } = await import("../../src/tools/script-lint.js");
    const tool = captureTool((s) => registerScriptLint(s));
    const r = await tool({ script_path: "Foo.c", rules: ["trailing-whitespace"] });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/Unknown rule name\(s\): trailing-whitespace/);
    expect(textOf(r)).not.toContain("Clean");
  });
});
