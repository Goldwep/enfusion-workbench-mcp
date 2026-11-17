/**
 * EMCP_WB_ScriptEditor.c (wave W3, phase5-w3-spec.md section 2.1) checked over its Enforce text
 * offline: one action surface (DEC-061: the 1.x names are mapped in TypeScript), the contract
 * matches the structs and the per-action reads and writes, lines are 0-based and bounds-checked
 * before any engine edit (KD-010), every action makes the engine calls the spec names (each checked
 * against the 1.9.0.37 index by scripts/enforce-lint.ts), line edits and save run the project
 * guard on the open file first (projectOnly), save is a dry run without confirm, and close is
 * GATED with no engine call (W3 OD-3, DEC-063). Nothing here talks to Workbench.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadContract, regVKeys } from "../../src/manifest/contract.js";
import { checkedDescription } from "../../src/manifest/generate.js";
import { actionFindings, denyFindings } from "../../scripts/enforce-lint.js";

const DIR = join("mod", "Scripts", "WorkbenchGame", "EnfusionMCP");
const FILE = join(DIR, "EMCP_WB_ScriptEditor.c");
const LINT_PATH = FILE.replace(/\\/g, "/");
const src = readFileSync(FILE, "utf-8");
const contract = loadContract(join("contracts", "EMCP_WB_ScriptEditor.json"));

/** Source with comments removed, so a word in a comment never counts as a call. */
function code(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/** Body of `static <type> <name>(` up to the next method separator or the class end. */
function method(s: string, name: string): string {
  const at = s.search(new RegExp(`static \\w+ ${name}\\(`));
  expect(at, `method ${name}`).toBeGreaterThanOrEqual(0);
  const classEnd = s.slice(at).search(/\r?\n}\r?\n/);
  const ends = [s.indexOf("//-----", at), classEnd >= 0 ? at + classEnd : -1].filter((e) => e >= 0);
  return code(s.slice(at, ends.length ? Math.min(...ends) : undefined));
}

const C = code(src);

/** Action -> the method its dispatch branch calls. */
const METHOD: Record<string, string> = {
  state: "ReadState",
  getLines: "ReadLines",
  open: "OpenScript",
  jump: "JumpTo",
  setLine: "SetOne",
  insertLine: "InsertOne",
  removeLine: "RemoveOne",
  replaceRange: "ReplaceLines",
  save: "SaveFile",
  close: "CloseEditor",
};
const READS = ["state", "getLines"];
const VIEW = ["open", "jump"];
const EDITS = ["setLine", "insertLine", "removeLine", "replaceRange", "save"];

describe("EMCP_WB_ScriptEditor structs and contract", () => {
  it("request and response RegV keys are the contract's", () => {
    expect(regVKeys(src, "EMCP_WB_ScriptEditorRequest")).toEqual(contract.request);
    expect(regVKeys(src, "EMCP_WB_ScriptEditorResponse")).toEqual(contract.response);
  });

  it("the per-action linter check finds nothing", () => {
    expect(actionFindings({ path: LINT_PATH, text: src }, contract)).toEqual([]);
  });

  it("has the 10 spec actions and a description within 400 chars", () => {
    expect(contract.actions.map((a) => a.name)).toEqual(Object.keys(METHOD));
    expect(checkedDescription(contract).length).toBeLessThanOrEqual(400);
    for (const a of contract.actions) expect(a.summary.length, a.name).toBeLessThanOrEqual(80);
  });

  it("dispatches every contract action to its method and nothing else (DEC-061)", () => {
    const branches = [...C.matchAll(/req\.action == "([A-Za-z]+)"\)\s*\n\s*(\w+)\(/g)];
    expect(branches.map((m) => m[1]).sort()).toEqual(contract.actions.map((a) => a.name).sort());
    for (const m of branches) expect(m[2]).toBe(METHOD[m[1]]);
    for (const old of ["getCurrentFile", "getLine", "getLinesCount", "openFile"])
      expect(C, old).not.toContain(`"${old}"`);
  });

  it("marks the line edits and save projectOnly, and every action but state and getLines mutating", () => {
    for (const a of contract.actions) {
      expect(a.projectOnly, a.name).toBe(EDITS.includes(a.name));
      expect(a.mutating, a.name).toBe(!READS.includes(a.name));
    }
  });

  it("every action that calls GetModule declares mayHaveOpened; close does not call it", () => {
    for (const a of contract.actions) {
      const keys = a.response.map((r) => r.key);
      expect(keys.includes("mayHaveOpened"), a.name).toBe(a.name !== "close");
    }
  });

  it("no FindFiles, FileIO, RunCmd, RunCommandline, Configure, Dialog or project name", () => {
    expect(denyFindings({ path: LINT_PATH, text: src }).filter((f) => f.level === "fail")).toEqual(
      [],
    );
    for (const banned of [
      "FindFiles",
      "FileIO",
      "RunCmd",
      "RunCommandline",
      "Configure(",
      "Workbench.Dialog",
      "ScriptDialog",
      "EMCP2_sandbox",
      "_throwaway",
      "SaveContainer",
      "CloseModule",
      ".Close()",
    ]) {
      expect(C, banned).not.toContain(banned);
    }
  });

  it("uses no ternary operator", () => {
    const noStrings = C.replace(/"(?:[^"\\\n]|\\.)*"/g, '""');
    expect(noStrings).not.toMatch(/\?/);
  });

  it("carries no engine pointer in an out parameter (W1 fix-up 1)", () => {
    expect(C).not.toMatch(/\bout\s+(ScriptEditor|WBModuleDef|BaseContainer|Resource)\b/);
    expect(C).not.toMatch(/\binout\s+\w+/);
  });
});

describe("guards", () => {
  it("Editor sets mayHaveOpened before GetModule and refuses MODULE_NOT_OPEN on null", () => {
    const body = method(src, "Editor");
    const flag = body.indexOf("resp.mayHaveOpened = true;");
    const get = body.indexOf("Workbench.GetModule(ScriptEditor)");
    expect(flag).toBeGreaterThanOrEqual(0);
    expect(get).toBeGreaterThan(flag);
    expect(body).toMatch(/if \(!se\)\s*\{\s*Refuse\(resp, MODULE_NOT_OPEN,/);
  });

  it("OpenDoc refuses NO_DOCUMENT when no file is open", () => {
    const body = method(src, "OpenDoc");
    expect(body).toContain("EMCP_WB_ScriptEditorUtil.ReadDoc(se, doc)");
    expect(body).toMatch(/if \(!doc\.m_Opened\)\s*\{\s*Refuse\(resp, NO_DOCUMENT,/);
  });

  it("EditDoc: project found, then a file open, then the file inside the project", () => {
    const body = method(src, "EditDoc");
    const order = [
      "EMCP_WB_Guard.IsProjectFound()",
      "EMCP_WB_Guard.NOT_IN_PROJECT",
      "OpenDoc(resp, doc)",
      "if (!doc.m_InProject)",
    ].map((t) => body.indexOf(t));
    for (const i of order) expect(i).toBeGreaterThanOrEqual(0);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("every line edit and save starts with EditDoc; no read or view action calls it", () => {
    for (const a of EDITS) {
      expect(method(src, METHOD[a]), a).toMatch(
        /\{\s*EMCP_WB_ScriptEditorDoc doc = new EMCP_WB_ScriptEditorDoc\(\);\s*ScriptEditor se = EditDoc\(resp, doc\);\s*if \(!se\)\s*return;/,
      );
    }
    for (const a of [...READS, ...VIEW, "close"]) {
      const body = method(src, METHOD[a]);
      expect(body, a).not.toContain("EditDoc(");
      expect(body, a).not.toContain("IsProjectFound");
    }
  });

  it("the project test of the open file is TargetExistsInProject on each path form (P-W3-01)", () => {
    const body = method(src, "ClassifyFile");
    expect(body).toContain("EMCP_WB_Guard.Project(addonId, projectDir, why)");
    expect(body).toContain('EMCP_WB_Guard.Fold("$" + addonId + ":")');
    expect(body).toContain('else if (s.StartsWith("$"))');
    expect(body).toContain("FilePath.IsAbsolutePath(s)");
    expect(body).toContain("EMCP_WB_Guard.IsUnder(s, projectDir)");
    expect(body).toContain("EMCP_WB_Guard.TargetExistsInProject(rel, abs, guardWhy)");
    expect(body).toContain("if (absoluteForm && EMCP_WB_Guard.Fold(abs) != folded)");
    expect(body.indexOf("doc.m_InProject = true;")).toBeGreaterThan(
      body.indexOf("TargetExistsInProject("),
    );
  });

  it("the file shown is scrubbed of a home folder", () => {
    expect(method(src, "ReadDoc")).toContain("doc.m_Shown = EMCP_WB_Guard.ScrubHome(current);");
    expect(C).not.toMatch(/resp\.file = doc\.m_File/);
  });

  it("refusals use the guard's status and message form", () => {
    expect(method(src, "Refuse")).toContain("EMCP_WB_Guard.REFUSED");
    expect(method(src, "Answer")).toContain("EMCP_WB_Guard.RefusalMessage(code, text, nextStep)");
  });
});

describe("0-based lines (KD-010)", () => {
  it("line defaults to -1, which every line edit refuses before any engine call", () => {
    expect(src).toMatch(/line = -1;/);
    const max: Record<string, string> = {
      SetOne: "int maxLine = lineCount - 1;",
      InsertOne: "int maxLine = lineCount;",
      RemoveOne: "int maxLine = lineCount - 1;",
    };
    const edit: Record<string, string> = {
      SetOne: "se.SetLineText(req.text, req.line)",
      InsertOne: "se.InsertLine(req.text, req.line)",
      RemoveOne: "se.RemoveLine(req.line)",
    };
    for (const [m, decl] of Object.entries(max)) {
      const body = method(src, m);
      expect(body, m).toContain(decl);
      const gate = body.indexOf("if (req.line < 0 || req.line > maxLine)");
      expect(gate, m).toBeGreaterThan(0);
      expect(body.indexOf(edit[m]), m).toBeGreaterThan(gate);
      expect(body.slice(gate, body.indexOf(edit[m]))).toContain("valid 0..");
    }
  });

  it("no engine line call is sent the -1 current-line default", () => {
    expect(C).not.toMatch(/(GetLineText|SetLineText|InsertLine|RemoveLine)\([^)]*-1\)/);
    expect(C).not.toMatch(/\.RemoveLine\(\)/);
    for (const m of C.matchAll(/se\.(GetLineText|SetLineText|InsertLine)\(([^;]*)\);?/g))
      expect(m[2], m[0]).toMatch(/,/);
  });

  it("a text with a line break is refused before setLine and insertLine", () => {
    expect(method(src, "HasBreak")).toContain('s.Contains("\\n") || s.Contains("\\r")');
    for (const [m, call] of [
      ["SetOne", "se.SetLineText("],
      ["InsertOne", "se.InsertLine("],
    ]) {
      const body = method(src, m);
      const gate = body.indexOf("EMCP_WB_ScriptEditorUtil.HasBreak(req.text)");
      expect(gate, m).toBeGreaterThan(0);
      expect(body.indexOf(call)).toBeGreaterThan(gate);
    }
  });
});

describe("engine calls per action (spec section 2.1)", () => {
  const CALLS: Record<string, string[]> = {
    ReadDoc: ["se.GetCurrentFile(current)"],
    ReadState: ["se.GetCurrentLine()", "se.GetLinesCount()", "EMCP_WB_ScriptEditorUtil.ReadDoc("],
    ReadLines: ["se.GetLinesCount()", "se.GetLineText(lineText, i)"],
    OpenScript: [
      "EMCP_WB_Guard.CleanRelative(req.path, clean, why)",
      "EMCP_WB_ScriptEditorUtil.ResolvesInAnyAddon(clean)",
      "Workbench.OpenModule(ScriptEditor)",
      "se.SetOpenedResource(clean)",
    ],
    ResolvesInAnyAddon: [
      "GameProject.GetLoadedAddons(addons)",
      "GameProject.GetAddonID(",
      'Workbench.GetAbsolutePath("$" + id + ":" + clean, abs, true)',
    ],
    JumpTo: [
      "EMCP_WB_ScriptEditorUtil.ValidSymbol(req.symbol, className, why)",
      "className.ToType()",
      "Workbench.JumpToScriptSymbol(req.symbol)",
      "se.GetCurrentLine()",
    ],
    SetOne: [
      "se.GetLineText(oldText, req.line)",
      "se.SetLineText(req.text, req.line)",
      "se.GetLineText(readback, req.line)",
    ],
    InsertOne: ["se.InsertLine(req.text, req.line)", "se.GetLineText(readback, req.line)"],
    RemoveOne: ["se.GetLineText(oldText, req.line)", "se.RemoveLine(req.line)"],
    ReplaceLines: [
      "se.GetLineText(oldText, oldLine)",
      "se.SetLineText(req.lines.Get(s), req.start + s)",
      "se.InsertLine(req.lines.Get(a), req.start + a)",
      "se.RemoveLine(req.start + overlap)",
      "se.GetLineText(readback, req.start + b)",
    ],
    SaveFile: ["se.Save()"],
  };
  for (const [m, calls] of Object.entries(CALLS)) {
    it(`${m} makes ${calls.length} call(s)`, () => {
      const body = method(src, m);
      for (const call of calls) expect(body, call).toContain(call);
    });
  }

  it("open checks the path and its existence before any module call", () => {
    const body = method(src, "OpenScript");
    const resolves = body.indexOf("ResolvesInAnyAddon(clean)");
    expect(body.indexOf('lower.EndsWith(".c")')).toBeLessThan(resolves);
    expect(resolves).toBeLessThan(body.indexOf("Workbench.GetModule(ScriptEditor)"));
    expect(body).toMatch(/PATH_NOT_FOUND/);
  });

  it("jump refuses an unknown class before asking the engine (P-W3-05)", () => {
    const body = method(src, "JumpTo");
    const gate = body.indexOf("if (!symbolType)");
    expect(gate).toBeGreaterThan(body.indexOf("className.ToType()"));
    expect(body.slice(gate, body.indexOf("Workbench.JumpToScriptSymbol("))).toMatch(
      /Refuse\(resp, ITEM_NOT_FOUND,[\s\S]*return;/,
    );
  });

  it("setLine reads before, then edits, then reads back and compares", () => {
    const body = method(src, "SetOne");
    const before = body.indexOf("se.GetLineText(oldText, req.line)");
    const edit = body.indexOf("se.SetLineText(req.text, req.line)");
    const back = body.indexOf("se.GetLineText(readback, req.line)");
    expect(before).toBeLessThan(edit);
    expect(edit).toBeLessThan(back);
    expect(body).toContain("resp.before = oldText;");
    expect(body).toContain("resp.after = readback;");
    expect(body).toContain("readback != req.text");
  });

  it("insertLine and removeLine read the count back", () => {
    expect(method(src, "InsertOne")).toContain("countAfter != lineCount + 1");
    const rm = method(src, "RemoveOne");
    expect(rm).toContain("countAfter != lineCount - 1");
    expect(rm).toContain("resp.before = oldText;");
    expect(rm).toMatch(/if \(lineCount < 2\)\s*\{\s*Refuse\(resp, INVALID_ARGUMENT,/);
  });
});

describe("replaceRange", () => {
  const body = method(src, "ReplaceLines");
  const firstEdit = body.indexOf("se.SetLineText(");

  it("checks every argument before the first edit", () => {
    for (const gate of [
      "if (req.start < 0 || req.start > lineTotal)",
      "if (replaced < 0 || req.start + replaced > lineTotal)",
      "if (replaced == 0 && newCount == 0)",
      "EMCP_WB_ScriptEditorUtil.RANGE_MAX",
      "if (lineTotal - replaced + newCount < 1)",
      "EMCP_WB_ScriptEditorUtil.HasBreak(req.lines.Get(n))",
      "if (expectedCount > 0 && expectedCount != replaced)",
    ]) {
      const at = body.indexOf(gate);
      expect(at, gate).toBeGreaterThan(0);
      expect(at, gate).toBeLessThan(firstEdit);
    }
    expect(src).toMatch(/count = -1;/);
  });

  it("expected that differs answers TEXT_CHANGED before any edit", () => {
    const at = body.indexOf("Refuse(resp, TEXT_CHANGED,");
    expect(at).toBeGreaterThan(body.indexOf("resp.removed.Insert(oldText);"));
    expect(at).toBeLessThan(firstEdit);
    expect(src).toContain('static const string TEXT_CHANGED = "TEXT_CHANGED";');
  });

  it("sets the overlap, inserts the rest or removes the rest, then reads back", () => {
    const ins = body.indexOf("se.InsertLine(");
    const rm = body.indexOf("se.RemoveLine(");
    const back = body.indexOf("se.GetLineText(readback,");
    expect(firstEdit).toBeLessThan(ins);
    expect(ins).toBeLessThan(rm);
    expect(rm).toBeLessThan(back);
    expect(body).toContain("int countWanted = lineTotal - replaced + newCount;");
    expect(body).toContain("resp.rows.Insert(readback);");
  });
});

describe("save and close", () => {
  it("save without confirm is a dry run that returns before Save", () => {
    const body = method(src, "SaveFile");
    const dry = body.indexOf("if (!req.confirm)");
    const save = body.indexOf("se.Save()");
    expect(dry).toBeGreaterThan(0);
    expect(save).toBeGreaterThan(dry);
    expect(body.slice(dry, save)).toMatch(/resp\.dryRun = true;[\s\S]*return;/);
    expect(body).toContain("resp.warnings.Insert(SAVE_WARNING);");
    expect(src).toMatch(/SAVE_WARNING = "[^"]*P-W3-03/);
  });

  it("close is GATED and makes no engine call (W3 OD-3)", () => {
    const body = method(src, "CloseEditor");
    expect(body).toContain("Refuse(resp, GATED,");
    expect(body).toContain("P-W3-04");
    expect(body).not.toMatch(/\bse\.|Workbench\.|GetModule/);
    const close = contract.actions.find((a) => a.name === "close");
    expect(close?.refuses).toMatch(/GATED/);
  });
});

describe("paging", () => {
  it("cursor is <start>:<count>; a changed count is STALE_CURSOR; limit 100 default, 200 max", () => {
    expect(src).toContain("static const int PAGE_DEFAULT = 100;");
    expect(src).toContain("static const int PAGE_MAX = 200;");
    const body = method(src, "PageWindow");
    expect(body).toMatch(/if \(issued != total \|\| at > total\)\s*\{\s*code = "STALE_CURSOR";/);
    expect(method(src, "ReadLines")).toContain(
      "EMCP_WB_ScriptEditorUtil.PageWindow(req.cursor, req.start, req.limit, lineTotal, first, stop, pageCode, why)",
    );
  });

  it("answers the W3 codes", () => {
    for (const c of [
      '"INVALID_ARGUMENT"',
      '"PATH_NOT_FOUND"',
      '"MODULE_NOT_OPEN"',
      '"ENGINE_FALSE"',
      '"ITEM_NOT_FOUND"',
      '"GATED"',
      '"NO_DOCUMENT"',
      '"TEXT_CHANGED"',
    ])
      expect(src, c).toContain(c);
  });
});

// Census rows this file tests (W3 close-out, EV-W3-099).
// census:api:ScriptEditor.GetCurrentFile/1
// census:api:ScriptEditor.GetCurrentLine/0
// census:api:ScriptEditor.GetLineText/2
// census:api:ScriptEditor.GetLinesCount/0
// census:api:ScriptEditor.InsertLine/2
// census:api:ScriptEditor.RemoveLine/1
// census:api:ScriptEditor.SetLineText/2
// census:mcp:handler-action/EMCP_WB_ScriptEditor.getLines
// census:mcp:handler-action/EMCP_WB_ScriptEditor.jump
// census:mcp:handler-action/EMCP_WB_ScriptEditor.open
// census:mcp:handler-action/EMCP_WB_ScriptEditor.replaceRange
// census:mcp:handler-action/EMCP_WB_ScriptEditor.state
