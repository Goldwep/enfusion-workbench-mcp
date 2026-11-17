/**
 * enforce-lint script checks added for DEC-048 3.3: both contract forms, the per-action
 * dispatch-branch key check (linterRows), and the deny keys. The index-backed linter itself is
 * tested in tests/census/enforce-lint.test.ts.
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DENY_ALLOWED,
  REPO_ROOT,
  actionFindings,
  applyExtraChecks,
  denyFindings,
  loadLintContracts,
} from "../../scripts/enforce-lint.js";
import type { LintReport } from "../../src/census/enforce-lint.js";
import { loadContract, type Contract } from "../../src/manifest/contract.js";

const EC_PATH = "mod/Scripts/WorkbenchGame/EnfusionMCP/EMCP_WB_EditorControl.c";
const EC_TEXT = readFileSync(join(REPO_ROOT, EC_PATH), "utf-8");
const EC: Contract = loadContract(join(REPO_ROOT, "contracts", "EMCP_WB_EditorControl.json"));

const fails = (path: string, text: string, c: Contract = EC) =>
  actionFindings({ path, text }, c).filter((f) => f.level === "fail");

describe("per-action contract check", () => {
  it("passes the shipped EMCP_WB_EditorControl.c against its per-action contract", () => {
    expect(fails(EC_PATH, EC_TEXT)).toEqual([]);
  });

  it("fails a branch that never reads a required key, by action and line", () => {
    const text = EC_TEXT.replace('if (req.path == "")', "if (false)").replace(
      /OpenInOwningModule\(req\.path\)/,
      'OpenInOwningModule("x")',
    );
    const text2 = text.replace(/\+ req\.path/g, '+ "x"');
    const f = fails("mod/x.c", text2);
    expect(f).toHaveLength(1);
    expect(f[0].subject).toBe("openResource");
    expect(f[0].message).toMatch(/requires key "path", but its branch never reads it/);
    expect(f[0].line).toBe(151);
  });

  it("fails a request key read outside the action's allowed keys", () => {
    const text = EC_TEXT.replace(
      "worldEditor.SwitchToEditMode();",
      "worldEditor.SwitchToEditMode(); bool d = req.debugMode;",
    );
    const f = fails("mod/x.c", text);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ subject: "stop", line: 97 });
    expect(f[0].message).toMatch(/reads request key "debugMode"/);
  });

  it("fails a response field the action does not declare, and an undeclared branch", () => {
    // The retired save branch (review F11) still writes its message; a stray key there is caught.
    const text = EC_TEXT.replace(
      'resp.message = "save is retired on EMCP_WB_EditorControl',
      'resp.extra = "x"; resp.message = "save is retired on EMCP_WB_EditorControl',
    ).replace(
      // Both the dispatch branch and the undo/redo guard above it (DEC-107, live-tools-a-03).
      /req\.action == "redo"/g,
      'req.action == "redoAll"',
    );
    const f = fails("mod/x.c", text);
    const msgs = f.map((x) => `${x.subject}: ${x.message}`);
    expect(msgs.some((m) => /^save: .*writes response key "extra"/.test(m))).toBe(true);
    expect(msgs.some((m) => /^redoAll: branch for action "redoAll"/.test(m))).toBe(true);
    expect(msgs.some((m) => /^redo: the contract declares action "redo"/.test(m))).toBe(true);
  });

  it("follows a same-file method the branch passes the request to", () => {
    const text = EC_TEXT.replace(
      "worldEditor.SwitchToEditMode();",
      "worldEditor.SwitchToEditMode(); Helper(req);",
    ).replace(
      "class EMCP_WB_EditorControl : NetApiHandler",
      "void Helper(EMCP_WB_EditorControlRequest r)\n{\n\tstring p = r.path;\n}\n\nclass EMCP_WB_EditorControl : NetApiHandler",
    );
    const f = fails("mod/x.c", text);
    expect(f).toHaveLength(1);
    expect(f[0].message).toMatch(/action "stop" reads request key "path"/);
  });

  it("checks request reads in the dispatch condition itself (LINT-3)", () => {
    const text = EC_TEXT.replace('req.action == "stop"', 'req.action == "stop" && req.path != ""');
    const f = fails("mod/x.c", text);
    expect(f).toHaveLength(1);
    expect(f[0].message).toMatch(/action "stop" reads request key "path"/);
  });

  it("follows a helper given only the response and checks its writes (LINT-2)", () => {
    const text = EC_TEXT.replace(
      "worldEditor.SwitchToEditMode();",
      "worldEditor.SwitchToEditMode(); Answer(resp);",
    ).replace(
      "class EMCP_WB_EditorControl : NetApiHandler",
      'void Answer(EMCP_WB_EditorControlResponse r)\n{\n\tr.code = "x";\n}\n\nclass EMCP_WB_EditorControl : NetApiHandler',
    );
    const f = fails("mod/x.c", text);
    expect(f).toHaveLength(1);
    expect(f[0].message).toMatch(/action "stop" writes response key "code"/);
  });

  it("returns nothing for a file without the handler class", () => {
    expect(actionFindings({ path: "mod/y.c", text: "class Other {}" }, EC)).toEqual([]);
  });
});

describe("contract loading", () => {
  it("reads both forms from one directory: flat keys for each, per-action where stated", () => {
    const dir = mkdtempSync(join(tmpdir(), "lint-contracts-"));
    writeFileSync(
      join(dir, "ECEN_Flat.json"),
      JSON.stringify({ request: ["action", "x"], response: ["status"] }),
    );
    writeFileSync(
      join(dir, "EMCP_WB_EditorControl.json"),
      readFileSync(join(REPO_ROOT, "contracts", "EMCP_WB_EditorControl.json")),
    );
    const c = loadLintContracts(dir);
    expect(c.flat.get("ECEN_Flat")).toEqual({ request: ["action", "x"], response: ["status"] });
    expect(c.flat.get("EMCP_WB_EditorControl")?.request).toEqual([
      "action",
      "debugMode",
      "fullScreen",
      "path",
    ]);
    expect([...c.perAction.keys()]).toEqual(["EMCP_WB_EditorControl"]);
  });

  it("throws a named error for a malformed per-action contract", () => {
    const dir = mkdtempSync(join(tmpdir(), "lint-contracts-"));
    writeFileSync(
      join(dir, "Bad.json"),
      JSON.stringify({ request: [], response: [], actions: [] }),
    );
    expect(() => loadLintContracts(dir)).toThrow(/Bad\.json/);
  });
});

describe("deny keys", () => {
  const SRC = [
    "class A",
    "{",
    "\t// FileIO.FindFiles in a comment is not code",
    '\tvoid F() { string s = "Workbench.Dialog"; FileIO.FindFiles(Cb, "x", ".c"); }',
    '\tvoid G() { Workbench.Dialog("a", "b"); Workbench.RunCommandline("x"); }',
    "\toverride void Configure() {}",
    "\tvoid H() { plugin.Configure(); }",
    "}",
  ].join("\n");

  it("fails each deny key under mod/ (not in comments, strings or a declaration)", () => {
    const f = denyFindings({ path: "mod/A.c", text: SRC });
    expect(f.map((x) => `${x.level} L${x.line} ${x.subject}`).sort()).toEqual([
      "fail L4 FileIO.FindFiles",
      "fail L5 RunCommandline",
      "fail L5 Workbench.Dialog",
      "fail L7 Configure(",
    ]);
  });

  it("catches whitespace, newline and alias variants (LINT-1)", () => {
    const text = [
      "typedef FileIO FIO;",
      'void A() { FileIO .FindFiles(Cb, "x", ".c"); }',
      'void B() { FileIO\n\t.FindFiles(Cb, "x", ".c"); }',
      'void C() { FIO.FindFiles(Cb, "x", ".c"); }',
      "typedef Workbench WB;",
    ].join("\n");
    const f = denyFindings({ path: "mod/B.c", text });
    expect(f.map((x) => `${x.level} L${x.line} ${x.subject}`).sort()).toEqual([
      "fail L1 typedef FileIO/Workbench",
      "fail L2 FileIO.FindFiles",
      "fail L4 FileIO.FindFiles",
      "fail L5 FileIO.FindFiles",
      "fail L6 typedef FileIO/Workbench",
    ]);
  });

  it("warns under mod-dev/ and allows the probe pack's listed uses by file and line", () => {
    expect(denyFindings({ path: "mod-dev/A.c", text: SRC }).every((x) => x.level === "warn")).toBe(
      true,
    );
    const allowed = DENY_ALLOWED[2];
    const text = `${"\n".repeat(allowed.line - 1)}Workbench.Dialog("a", "b");`;
    expect(denyFindings({ path: allowed.file, text })).toMatchObject([
      { level: "allowed", line: allowed.line },
    ]);
    expect(denyFindings({ path: allowed.file, text: `\n${text}` })[0].level).toBe("warn");
  });

  it("lists in DENY_ALLOWED only lines that still hold that call in the probe pack", () => {
    for (const a of DENY_ALLOWED) {
      const text = readFileSync(join(REPO_ROOT, a.file), "utf-8");
      const hits = denyFindings({ path: a.file, text }).filter((x) => x.line === a.line);
      expect(hits.map((x) => x.level)).toEqual(["allowed"]);
    }
  });

  it("turns failures into level-1 failures in the report, and warnings into notes", () => {
    const report: LintReport = {
      build: "b",
      index_files: 0,
      index_records: 0,
      notes: [],
      files: ["mod/A.c", "mod-dev/A.c"].map((file) => ({
        file,
        failures: [],
        unresolved: [],
        notes: [],
        parse_errors: [],
        counts: {
          calls: 0,
          resolved: 0,
          failed_calls: 0,
          unresolved: 0,
          failures: 0,
          parse_errors: 0,
        },
      })),
      totals: {
        files: 2,
        files_failed: 0,
        calls: 0,
        resolved: 0,
        failed_calls: 0,
        unresolved: 0,
        failures: 0,
        parse_errors: 0,
      },
    };
    applyExtraChecks(
      report,
      [
        { path: "mod/A.c", text: SRC },
        { path: "mod-dev/A.c", text: SRC },
      ],
      undefined,
    );
    expect(report.totals.failures).toBe(4);
    expect(report.totals.files_failed).toBe(1);
    expect(report.files[1].notes.every((n) => n.message.startsWith("warning: deny key"))).toBe(
      true,
    );
  });
});
