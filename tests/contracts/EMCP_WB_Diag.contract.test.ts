/**
 * The W8 Diag handler (EMCP_WB_Diag.c) checked over its Enforce text offline (phase5-w8-spec.md
 * section 2.4, DEC-076): the contract matches the structs and the dispatch, ids travel as enum
 * names checked back through typename, values as text, every name and kind is checked before the
 * first DiagMenu call, engine kinds and range are gated, select runs in play mode only, info keeps
 * its out strings in locals, and none of the calls the spec leaves out is made. Nothing here talks
 * to Workbench; the compile proof is probe P-W8-24.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadContract, regVKeys } from "../../src/manifest/contract.js";
import { buildDescription } from "../../src/manifest/generate.js";
import { actionFindings, denyFindings } from "../../scripts/enforce-lint.js";
import { ERROR_CODES } from "../../src/manifest/vocabulary.js";

const DIR = join("mod", "Scripts", "WorkbenchGame", "EnfusionMCP");
const FILE = join(DIR, "EMCP_WB_Diag.c");
const LINT_PATH = FILE.replace(/\\/g, "/");
const src = readFileSync(FILE, "utf-8");
const contract = loadContract(join("contracts", "EMCP_WB_Diag.json"));

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

/** Index of each text in body; all present and in the given order. */
function inOrder(body: string, texts: string[], label: string): void {
  const at = texts.map((t) => body.indexOf(t));
  texts.forEach((t, i) => expect(at[i], `${label}: ${t}`).toBeGreaterThanOrEqual(0));
  expect(
    [...at].sort((a, b) => a - b),
    label,
  ).toEqual(at);
}

const c = code(src);

/** Spec 2.4 actions with their handler method. */
const METHODS: Record<string, string> = {
  catalog: "DoCatalog",
  get: "DoGet",
  info: "DoInfo",
  set: "DoSet",
  select: "DoSelect",
};
/** The code W8 adds to vocabulary.ts for this handler (spec 1.2 rule 10); the integrator lands it. */
const W8_CODES = ["DIAG_UNKNOWN"];

describe("EMCP_WB_Diag structs and contract", () => {
  it("request and response RegV keys are the contract's", () => {
    expect(regVKeys(src, "EMCP_WB_DiagRequest")).toEqual(contract.request);
    expect(regVKeys(src, "EMCP_WB_DiagResponse")).toEqual(contract.response);
  });

  it("the per-action linter check finds nothing", () => {
    expect(actionFindings({ path: LINT_PATH, text: src }, contract)).toEqual([]);
  });

  it("dispatches the spec's 5 actions and nothing else", () => {
    const branches = [...c.matchAll(/req\.action == "([A-Za-z]+)"/g)].map((m) => m[1]);
    expect(branches.sort()).toEqual(contract.actions.map((a) => a.name).sort());
    expect(contract.actions.map((a) => a.name).sort()).toEqual(Object.keys(METHODS).sort());
    for (const [action, m] of Object.entries(METHODS))
      expect(c, action).toMatch(
        new RegExp(`req\\.action == "${action}"\\)\\s*${m}\\(req, resp\\);`),
      );
  });

  it("set and select are mutating; nothing is project-only or takes confirm; only catalog pages", () => {
    for (const a of contract.actions) {
      expect(a.mutating, a.name).toBe(a.name === "set" || a.name === "select");
      expect(a.projectOnly, a.name).toBe(false);
      expect(
        a.params.some((p) => p.key === "confirm"),
        a.name,
      ).toBe(false);
      expect(a.paging, a.name).toBe(a.name === "catalog");
    }
  });

  it("the tool description stays within 400 characters", () => {
    expect(buildDescription(contract).length).toBeLessThanOrEqual(400);
  });

  it("no out parameter carries an engine pointer (W1 compile lesson)", () => {
    expect(c).not.toMatch(
      /out\s+(?:IEntity|IEntitySource|BaseContainer|WorldEditorAPI|WorldEditor|BaseWorld|WBModuleDef|ScriptModule)\b/,
    );
  });

  it("no float travels through a request or response field; set's value is a string", () => {
    const req = /class EMCP_WB_DiagRequest[\s\S]*?\n}\r?\n/.exec(c)![0];
    expect(req).not.toMatch(/\bfloat\b/);
    const resp = /class EMCP_WB_DiagResponse[\s\S]*?\n}\r?\n/.exec(c)![0];
    expect(resp).not.toMatch(/\bfloat\b/);
    const set = contract.actions.find((a) => a.name === "set")!;
    expect(set.params.find((p) => p.key === "value")!.type).toBe("string");
    for (const k of ["previous", "readback"])
      expect(set.response.find((r) => r.key === k)!.type, k).toBe("string");
  });

  it("no declared name is Wait or vanilla (reserved on 1.9.0.37)", () => {
    expect(c).not.toMatch(/\b(?:Wait|vanilla)\b/);
  });
});

describe("no banned call", () => {
  it("no FindFiles, Dialog, RunCommandline, RunCmd, RunProcess, Configure, FileIO or project name", () => {
    expect(denyFindings({ path: LINT_PATH, text: src }).filter((f) => f.level === "fail")).toEqual(
      [],
    );
    for (const banned of [
      "FindFiles",
      "Workbench.Dialog",
      "ScriptDialog",
      "RunCommandline",
      "RunCmd",
      "RunProcess",
      "KillProcess",
      "Workbench.Exit",
      "Configure(",
      "FileIO",
      "EMCP2_sandbox",
      "_throwaway",
      "GetAbsolutePath",
      "ParticleEditor",
    ]) {
      expect(c, banned).not.toContain(banned);
    }
  });

  it("the calls spec 2.4 leaves out are never made: no registration, no ScriptModule.Call", () => {
    for (const absent of [
      "RegisterMenu",
      "RegisterItem",
      "RegisterBool",
      "RegisterRange",
      "Unregister",
      ".Call(",
      "CompileScript",
      "LoadScript",
    ]) {
      expect(c, absent).not.toContain(absent);
    }
  });

  it("set keeps no allow-list of its own: the TS tool checks diag.set_allow_list (OD-6)", () => {
    expect(c).not.toMatch(/AllowList|allow_list|set_allow/);
  });

  it("no ternary operator", () => {
    expect(c.replace(/"(?:[^"\\]|\\.)*"/g, '""')).not.toMatch(/\?[^?]*:/);
  });
});

describe("engine calls (spec 2.4 Engine calls column)", () => {
  it("an enum name resolves through StringToEnum checked back with EnumToString, SCR_DebugMenuID first", () => {
    inOrder(
      method(src, "IdOf"),
      [
        "IsPlainName(enumName)",
        "typename.StringToEnum(SCR_DebugMenuID, enumName)",
        "typename.EnumToString(SCR_DebugMenuID, scriptId) == enumName",
        "typename.StringToEnum(EDiagMenu, enumName)",
        "typename.EnumToString(EDiagMenu, engineId) == enumName",
        "isEngine = true;",
      ],
      "IdOf",
    );
  });

  it("reads and writes by kind with the spec's DiagMenu calls", () => {
    const read = method(src, "ReadText");
    for (const call of [
      "DiagMenu.GetBool(id)",
      "DiagMenu.GetRangeValue(id)",
      "DiagMenu.GetEngineValue(id)",
      "DiagMenu.GetEngineRangeValue(id)",
      "DiagMenu.GetValue(id)",
    ])
      expect(read, call).toContain(call);
    const write = method(src, "WriteValue");
    for (const call of [
      "DiagMenu.SetRangeValue(id, wantedFloat)",
      "DiagMenu.SetEngineValue(id, wantedInt)",
      "DiagMenu.SetEngineRangeValue(id, wantedFloat)",
      "DiagMenu.SetValue(id, wantedInt)",
    ])
      expect(write, call).toContain(call);
    // DiagMenu calls live in ReadText, WriteValue and DoSelect only.
    for (const m of ["DoGet", "DoSet", "DoInfo", "DoCatalog", "KindFor", "IdOf", "ParseValue"])
      expect(method(src, m), m).not.toContain("DiagMenu.");
  });

  it("info makes the spec's calls with its out strings in locals it owns", () => {
    inOrder(
      method(src, "DoInfo"),
      [
        "EMCP_WB_Guard.ModuleTypeForRead(moduleName)",
        "Workbench.GetModule(moduleType)",
        'string userName = "";',
        "Workbench.GetUserName(userName);",
        "resp.userName = userName;",
        'string currentDir = "";',
        "Workbench.GetCwd(currentDir);",
        'string exePath = "";',
        "Workbench.GetExecutableFilePath(exePath);",
        "Workbench.GetCurrentGameProjectFile()",
        "Workbench.GetGameProjectSettings()",
        "if (settings)",
        "settings.GetClassName()",
        "Workbench.GetPackedUtcTime()",
        "Workbench.GetWBScriptModule()",
        "Workbench.GetWBGameScriptModule()",
        "wbModule.GetCmdLine(cmdName, cmdValue)",
        "EMCP_WB_DiagUtil.InPlay()",
      ],
      "DoInfo",
    );
    const body = method(src, "DoInfo");
    // userName goes back raw (the TS side redacts it); paths go through ScrubHome.
    expect(body).not.toContain("ScrubHome(userName)");
    for (const k of ["currentDir", "exePath", "cmdValue"])
      expect(body, k).toContain(`EMCP_WB_Guard.ScrubHome(${k})`);
    for (const g of ["GetYear", "GetMonth", "GetDay", "GetHour", "GetMinute", "GetSecond"])
      expect(method(src, "UtcText"), g).toContain(`packed.${g}()`);
  });

  it("info reaches GetModule and GetCmdLine only with cmdNames, after every name is checked", () => {
    const body = method(src, "DoInfo");
    expect(body).toMatch(
      /if \(cmdCount > 0\)\s*\{\s*wbModule = Workbench\.GetModule\(moduleType\);/,
    );
    expect(body.indexOf("IsPlainName(checkedName)")).toBeLessThan(
      body.indexOf("Workbench.GetModule(moduleType)"),
    );
    expect(body).toContain('"MODULE_NOT_OPEN"');
    expect(body).toContain("GetModule may have opened it");
  });

  it("select calls SelectMenuByName or SelectMenuById after the play-mode check", () => {
    inOrder(
      method(src, "DoSelect"),
      [
        "typename.EnumToString(SCR_DebugMenuID, req.menuId)",
        "typename.StringToEnum(SCR_DebugMenuID, idName) != req.menuId",
        '"DIAG_UNKNOWN"',
        "if (!EMCP_WB_DiagUtil.InPlay())",
        '"WRONG_MODE"',
        "DiagMenu.SelectMenuByName(req.menu)",
        "DiagMenu.SelectMenuById(req.menuId)",
      ],
      "DoSelect",
    );
    expect(src).toContain("menuId = -1;");
  });
});

describe("guards", () => {
  it("gameMode: GetModule, GetApi, NoWorldReason, then IsGameMode", () => {
    inOrder(
      method(src, "InPlay"),
      [
        "Workbench.GetModule(WorldEditor)",
        "worldEditor.GetApi()",
        "EMCP_WB_Common.NoWorldReason(worldEditor, api)",
        "api.IsGameMode()",
      ],
      "InPlay",
    );
    expect(src).toContain("which opens a closed World Editor");
  });

  it("engine kinds and range are gated until their probes; the gate runs before any read", () => {
    expect(src).toContain("static const bool ENGINE_PROVEN = false;");
    expect(src).toContain('static const string ENGINE_PROBE = "P-W8-08";');
    expect(src).toContain("static const bool RANGE_PROVEN = false;");
    expect(src).toContain('static const string RANGE_PROBE = "P-W8-07";');
    inOrder(
      method(src, "KindFor"),
      [
        "if (!IsKind(kind))",
        "if (isEngine && !engineKind)",
        "if (!isEngine && engineKind)",
        "if (engineKind && !ENGINE_PROVEN)",
        '"UNPROVEN"',
        // Both float kinds wait for the range probe (enforce-review W7 D1).
        "if (IsFloatKind(kind) && !RANGE_PROVEN)",
      ],
      "KindFor",
    );
    // A float past +-1e9 (Inf from "1e999") is refused before any DiagMenu call (D2).
    expect(method(src, "ParseValue")).toContain("wantedFloat <= FLOAT_ABS_MAX && wantedFloat >= -FLOAT_ABS_MAX");
  });

  it("get resolves every name and kind before the first read", () => {
    inOrder(
      method(src, "DoGet"),
      [
        "EMCP_WB_DiagUtil.NAMES_MAX",
        "EMCP_WB_DiagUtil.IdOf(enumName, isEngine)",
        "resp.missing.Insert(enumName)",
        "EMCP_WB_DiagUtil.KindFor(enumName, isEngine, given, resp)",
        '"DIAG_UNKNOWN"',
        "EMCP_WB_DiagUtil.InPlay()",
        "EMCP_WB_DiagUtil.ReadText(",
      ],
      "DoGet",
    );
  });

  it("set checks name, kind and value, then reads, writes and reads back", () => {
    inOrder(
      method(src, "DoSet"),
      [
        "EMCP_WB_DiagUtil.IdOf(req.name, isEngine)",
        '"DIAG_UNKNOWN"',
        "EMCP_WB_DiagUtil.KindFor(req.name, isEngine, req.kind, resp)",
        "EMCP_WB_DiagUtil.ParseValue(req.value, kind, wantedInt, wantedFloat, resp)",
        "resp.previous = EMCP_WB_DiagUtil.ReadText(id, kind);",
        "EMCP_WB_DiagUtil.WriteValue(id, kind, wantedInt, wantedFloat);",
        "resp.readback = EMCP_WB_DiagUtil.ReadText(id, kind);",
        "resp.changed = resp.previous != resp.readback;",
      ],
      "DoSet",
    );
  });

  it("values arrive as text and are parsed with the EMCP_WB_Common parsers", () => {
    const body = method(src, "ParseValue");
    expect(body).toContain("EMCP_WB_Common.ParseFloat(text, wantedFloat)");
    expect(body).toContain("EMCP_WB_Common.ParseInt(text, wantedInt)");
    expect(body).toContain("VALUE_LEN_MAX");
  });

  it("catalog is the TS tool's: the handler refuses it and reads no request key", () => {
    const body = method(src, "DoCatalog");
    expect(body).toContain('"INVALID_ARGUMENT"');
    expect(body).not.toMatch(/req\./);
  });
});

describe("refusals", () => {
  it("Refuse uses the guard's status and message form with next set", () => {
    const body = method(src, "Refuse");
    expect(body).toContain("resp.status = EMCP_WB_Guard.REFUSED;");
    expect(body).toContain("resp.next = nextStep;");
    expect(body).toContain("EMCP_WB_Guard.RefusalMessage(code,");
  });

  it("every literal refusal code is in the vocabulary or is DIAG_UNKNOWN", () => {
    const known = new Set([...Object.keys(ERROR_CODES), ...W8_CODES]);
    const codes = [...c.matchAll(/(?:Refuse\(resp, |resp\.code = )"([A-Z_]+)"/g)].map((m) => m[1]);
    for (const k of codes) expect(known.has(k), k).toBe(true);
    for (const k of [
      "INVALID_ARGUMENT",
      "MODULE_NOT_OPEN",
      "WRONG_MODE",
      "UNPROVEN",
      "DIAG_UNKNOWN",
    ])
      expect(codes, k).toContain(k);
  });

  it("each code a contract refuses line names is one the handler can answer", () => {
    const known = new Set([...Object.keys(ERROR_CODES), ...W8_CODES]);
    for (const a of contract.actions) {
      for (const m of (a.refuses ?? "").matchAll(/\b[A-Z][A-Z_]{3,}\b/g)) {
        expect(known.has(m[0]), `${a.name}: ${m[0]}`).toBe(true);
      }
    }
  });
});

// Census rows this file tests (W8 close-out, EV-W8-211).
// census:mcp:handler-action/EMCP_WB_Diag.info

// Ledger rows this file covers through its dispatch test ("dispatches every contract action"):
// census:mcp:handler-action/EMCP_WB_Diag.catalog
// census:mcp:handler-action/EMCP_WB_Diag.get
// census:mcp:handler-action/EMCP_WB_Diag.select
// census:mcp:handler-action/EMCP_WB_Diag.set
