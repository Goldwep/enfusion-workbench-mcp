/**
 * The W4 play-mode animation debug handler (EMCP_WB_AnimDebug.c) checked over its Enforce text
 * offline (phase5-w4-spec.md section 2.2, DEC-067 OD-1): the contract matches the structs and the
 * dispatch, every action resolves its target through the world check, play mode, the entity
 * reference and SourceToEntity in that order, set and command refuse UNPROVEN until P-W4-19 and
 * btBreakpoint until P-W4-21 before any engine call, the Game and GameLib classes stay inside their
 * helper classes (P-W4-01 compile gate), and no banned call is made. Nothing here talks to Workbench.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadContract, regVKeys } from "../../src/manifest/contract.js";
import { buildDescription } from "../../src/manifest/generate.js";
import { actionFindings, denyFindings } from "../../scripts/enforce-lint.js";
import { ERROR_CODES } from "../../src/manifest/vocabulary.js";

const DIR = join("mod", "Scripts", "WorkbenchGame", "EnfusionMCP");
const FILE = join(DIR, "EMCP_WB_AnimDebug.c");
const LINT_PATH = FILE.replace(/\\/g, "/");
const src = readFileSync(FILE, "utf-8");
const contract = loadContract(join("contracts", "EMCP_WB_AnimDebug.json"));

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

/** Body of one class, from its `class` line to the next top-level class. */
function classBody(s: string, name: string): string {
  const at = s.search(new RegExp(`^class ${name}\\b`, "m"));
  expect(at, `class ${name}`).toBeGreaterThanOrEqual(0);
  const next = s.indexOf("\nclass ", at + 1);
  return code(s.slice(at, next < 0 ? undefined : next));
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
const READS = ["vars", "tags", "procAnim"];
const GATED = ["set", "command", "btBreakpoint"];
const ACTIONS = [...READS, ...GATED];
/** Handler method per action (the dispatch). */
const METHOD: Record<string, string> = {
  vars: "Vars",
  tags: "Tags",
  procAnim: "ProcAnim",
  set: "SetVar",
  command: "CallCmd",
  btBreakpoint: "BtBreakpoint",
};

describe("EMCP_WB_AnimDebug structs and contract", () => {
  it("request and response RegV keys are the contract's", () => {
    expect(regVKeys(src, "EMCP_WB_AnimDebugRequest")).toEqual(contract.request);
    expect(regVKeys(src, "EMCP_WB_AnimDebugResponse")).toEqual(contract.response);
  });

  it("the per-action linter check finds nothing", () => {
    expect(actionFindings({ path: LINT_PATH, text: src }, contract)).toEqual([]);
  });

  it("dispatches the spec's 6 actions and nothing else, each to its method", () => {
    const branches = [...c.matchAll(/req\.action == "([A-Za-z]+)"/g)].map((m) => m[1]);
    expect(branches.sort()).toEqual(contract.actions.map((a) => a.name).sort());
    expect(contract.actions.map((a) => a.name).sort()).toEqual([...ACTIONS].sort());
    for (const [action, m] of Object.entries(METHOD))
      expect(c, action).toMatch(
        new RegExp(`req\\.action == "${action}"\\)\\s*${m}\\(req, resp\\);`),
      );
  });

  it("every action takes target; none is project-only, none writes a file (no confirm)", () => {
    for (const a of contract.actions) {
      const target = a.params.find((p) => p.key === "target");
      expect(target?.required, a.name).toBe(true);
      expect(a.projectOnly, a.name).toBe(false);
      expect(a.mutating, a.name).toBe(GATED.includes(a.name));
      expect(
        a.params.map((p) => p.key),
        a.name,
      ).not.toContain("confirm");
    }
  });

  it("the gated actions say why they refuse", () => {
    const refuses = Object.fromEntries(contract.actions.map((a) => [a.name, a.refuses ?? ""]));
    expect(refuses.set).toMatch(/^UNPROVEN until P-W4-19/);
    expect(refuses.command).toMatch(/^UNPROVEN until P-W4-19/);
    expect(refuses.btBreakpoint).toMatch(/^UNPROVEN until P-W4-21/);
    for (const r of READS) expect(refuses[r], r).toBe("");
  });

  it("the tool description stays within 400 characters", () => {
    expect(buildDescription(contract).length).toBeLessThanOrEqual(400);
  });

  it("no key is named type, event or a reserved word (spec 1.1)", () => {
    for (const k of [...contract.request, ...contract.response])
      expect(["type", "event", "Wait", "vanilla", "proto"], k).not.toContain(k);
  });

  it("no out parameter carries an engine pointer (W1 compile lesson)", () => {
    expect(c).not.toMatch(
      /out\s+(?:IEntity|IEntitySource|BaseContainer|WorldEditorAPI|BaseAnimationControllerComponent|BaseProcAnimComponent|AIAgent|AIControlComponent|AIBehaviorTreeComponent)\b/,
    );
  });

  it("no float travels through a request or response field (floats as text)", () => {
    const req = classBody(src, "EMCP_WB_AnimDebugRequest");
    const resp = classBody(src, "EMCP_WB_AnimDebugResponse");
    expect(req).not.toMatch(/\bfloat\b/);
    expect(resp).not.toMatch(/\bfloat\b/);
    expect(src).toMatch(/string floatParam;/);
    expect(src).toMatch(/string value;/);
  });

  it("every refusal code is in the vocabulary", () => {
    const literals = [...c.matchAll(/"([A-Z][A-Z_]{3,})"/g)].map((m) => m[1]);
    expect(literals.length).toBeGreaterThan(0);
    for (const code of new Set(literals)) expect(Object.keys(ERROR_CODES), code).toContain(code);
  });
});

describe("no banned call, nothing written", () => {
  it("no FindFiles, Dialog, RunCommandline, RunCmd, RunProcess, Configure, FileIO or project name", () => {
    expect(denyFindings({ path: LINT_PATH, text: src }).filter((f) => f.level === "fail")).toEqual(
      [],
    );
    for (const banned of [
      "FindFiles",
      "Workbench.Dialog",
      "RunCommandline",
      "RunCmd",
      "RunProcess",
      "Configure(",
      "FileIO",
      "EMCP2_sandbox",
      "_throwaway",
      "EMCPFixtures",
    ]) {
      expect(c, banned).not.toContain(banned);
    }
  });

  it("no file or world write: no save, register, create, delete or entity action", () => {
    for (const write of [
      "Save(",
      "SaveContainer",
      "RegisterResourceFile",
      "RebuildResourceFile",
      "CreateEntity",
      "DeleteEntity",
      "BeginEntityAction",
      "SetVariableValue",
      "SetOpenedResource",
      "SwitchToGameMode",
      "SwitchToEditMode",
    ])
      expect(c, write).not.toContain(write);
  });

  it("no ternary operator", () => {
    expect(c.replace(/"(?:[^"\\]|\\.)*"/g, '""')).not.toMatch(/\?[^?]*:/);
  });

  it("a missing request is refused before it is read", () => {
    expect(src).toMatch(
      /if \(!req\)\s*\{\s*Refuse\(resp, INVALID_ARGUMENT, "no request", "send action"\);\s*return resp;\s*\}\s*resp\.action = req\.action;/,
    );
  });
});

describe("the runtime target (spec 2.2: play mode only, W1 reference, SourceToEntity)", () => {
  it("checks the World Editor, the world, play mode, the reference, then SourceToEntity", () => {
    const body = method(src, "Runtime");
    inOrder(
      body,
      [
        'if (req.target == "")',
        "Workbench.GetModule(WorldEditor)",
        "worldEditor.GetApi()",
        "EMCP_WB_Common.NoWorldReason(worldEditor, api)",
        "if (!api.IsGameMode())",
        "WRONG_MODE",
        "EMCP_WB_EntityRef.Resolve(api, req.target, resolved)",
        "IEntitySource src = resolved.m_Src;",
        "if (!src)",
        "api.SourceToEntity(src)",
        "if (!ent)",
      ],
      "Runtime",
    );
    expect(body).toContain("GetModule may have opened the World Editor");
    // W4 fix-up 1 (P-W4-18 retry): a null SourceToEntity asks the game world by the source's name.
    inOrder(body, ["api.SourceToEntity(src)", "GameEntityByName(src.GetName(), notes)"], "Runtime");
    inOrder(
      method(src, "GameEntityByName"),
      [
        'if (entName == "")',
        "GetGame()",
        "if (!game)",
        "game.GetWorld()",
        "if (!gameWorld)",
        "gameWorld.FindEntityByName(entName)",
        "notes.Insert(",
      ],
      "GameEntityByName",
    );
    expect(body).toContain("new EMCP_WB_EntityRefResult()");
  });

  it("every action reaches the engine only through Runtime", () => {
    for (const [action, m] of Object.entries(METHOD)) {
      const body = method(src, m);
      const runtime = body.indexOf("Runtime(req, resp, ");
      expect(runtime, action).toBeGreaterThanOrEqual(0);
      const helper = body.search(/EMCP_WB_AnimDebug(?:Graph|Proc|Bt)\./);
      expect(helper, action).toBeGreaterThan(runtime);
      expect(body, action).toMatch(
        /IEntity ent = Runtime\(req, resp, (?:resp\.warnings|new array<string>\(\))\);\s*if \(!ent\)\s*return;/,
      );
    }
  });

  it("the read actions check their inputs before Runtime", () => {
    inOrder(
      method(src, "Vars"),
      ["NamesWhy(req.names)", "VarTypesWhy(req.names, req.varTypes)", "Runtime(req, resp, "],
      "Vars",
    );
    inOrder(
      method(src, "Tags"),
      ["NamesWhy(req.names)", "req.kind == KIND_EVENT", "Runtime(req, resp, "],
      "Tags",
    );
    inOrder(method(src, "ProcAnim"), ["if (req.ctrl < 0)", "Runtime(req, resp, "], "ProcAnim");
    expect(src).toContain("static const int MAX_NAMES = 64;");
  });
});

describe("gated actions refuse before any engine call", () => {
  it("the probe flags stay false", () => {
    expect(src).toContain("static const bool SET_COMMAND_PROVEN = false;");
    expect(src).toContain("static const bool BT_BREAKPOINT_PROVEN = false;");
  });

  it("set and command refuse UNPROVEN (P-W4-19) first; btBreakpoint (P-W4-21) first", () => {
    const gates: Record<string, [string, string]> = {
      SetVar: ["SET_COMMAND_PROVEN", "P-W4-19"],
      CallCmd: ["SET_COMMAND_PROVEN", "P-W4-19"],
      BtBreakpoint: ["BT_BREAKPOINT_PROVEN", "P-W4-21"],
    };
    for (const [m, [flag, probe]] of Object.entries(gates)) {
      const body = method(src, m);
      expect(body, m).toMatch(
        new RegExp(
          `resp\\.target = req\\.target;\\s*if \\(!${flag}\\)\\s*\\{\\s*Refuse\\(resp, UNPROVEN, "[^"]*${probe}[^"]*nothing was called"`,
        ),
      );
      inOrder(body, [`if (!${flag})`, "return;", "Runtime(req, resp, "], m);
    }
  });

  it("set and command parse their text before the call", () => {
    inOrder(
      method(src, "SetVar"),
      [
        "EMCP_WB_AnimDebugText.IsVarType(req.varType)",
        "ValueWhy(req.varType, req.value)",
        "Runtime(req, resp, ",
        "EMCP_WB_AnimDebugGraph.WriteVar(ent, req.name, req.varType, req.value, resp.before, resp.after, res)",
      ],
      "SetVar",
    );
    inOrder(
      method(src, "CallCmd"),
      [
        "EMCP_WB_Common.ParseFloat(req.floatParam, floatValue)",
        "Runtime(req, resp, ",
        "EMCP_WB_AnimDebugGraph.Command(ent, req.name, req.intParam, floatValue, res)",
      ],
      "CallCmd",
    );
  });
});

describe("engine calls are the spec's", () => {
  it("vars: Bind*Variable, and Get*Variable only for a bound id", () => {
    const bind = method(src, "Bind");
    for (const call of [
      "anim.BindIntVariable(varName)",
      "anim.BindFloatVariable(varName)",
      "anim.BindBoolVariable(varName)",
    ])
      expect(bind, call).toContain(call);
    const get = method(src, "ValueText");
    inOrder(
      get,
      [
        "if (!anim || varId < 0)",
        "anim.GetIntVariable(varId)",
        "anim.GetFloatVariable(varId)",
        "anim.GetBoolVariable(varId)",
      ],
      "ValueText",
    );
    expect(get).toContain("floatValue.ToString()");
  });

  it("tags: BindTag/IsTag or BindEvent/IsEvent, the Is call only for a bound id", () => {
    inOrder(
      method(src, "ReadTags"),
      [
        "anim.BindEvent(tagName)",
        "anim.BindTag(tagName)",
        "if (tagId >= 0)",
        "anim.IsEvent(tagId)",
        "anim.IsTag(tagId)",
      ],
      "ReadTags",
    );
  });

  it("the controller is found by FindComponent and null-checked", () => {
    expect(method(src, "AnimOf")).toContain(
      "BaseAnimationControllerComponent.Cast(ent.FindComponent(BaseAnimationControllerComponent))",
    );
    for (const m of ["ReadVars", "ReadTags", "WriteVar", "Command"])
      expect(method(src, m), m).toMatch(/= AnimOf\(ent\);\s*if \(!anim\)/);
  });

  it("procAnim: GetControllerCount, GetSignals into a new array, GetSignalIndex, bones, slots", () => {
    expect(method(src, "Controllers")).toMatch(
      /BaseProcAnimComponent proc = ProcOf\(ent\);\s*if \(!proc\)\s*return -1;\s*return proc\.GetControllerCount\(\);/,
    );
    inOrder(
      method(src, "Read"),
      [
        "if (!proc)",
        "array<string> signalNames = {};",
        "proc.GetSignals(ctrlIdx, signalNames);",
        "if (signalNames)",
        "proc.GetSignalIndex(ctrlIdx, signalName)",
        "array<string> boneNames = {};",
        "proc.GetBoneNames(ctrlIdx, boneNames);",
        "array<string> slotNames = {};",
        "proc.GetBoneSlotNames(ctrlIdx, slotNames);",
      ],
      "Read",
    );
    // The controller index is range-checked before Read.
    inOrder(
      method(src, "ProcAnim"),
      [
        "EMCP_WB_AnimDebugProc.Controllers(ent)",
        "if (count < 0)",
        "if (req.ctrl >= count)",
        "EMCP_WB_AnimDebugProc.Read(ent, req.ctrl, resp.signals, resp.bones, resp.slots)",
      ],
      "ProcAnim",
    );
  });

  it("set: bind, the value before, Set*Variable, the value after", () => {
    inOrder(
      method(src, "WriteVar"),
      [
        "int varId = Bind(anim, varName, varType);",
        "if (varId < 0)",
        "beforeRows.Insert(",
        "anim.SetIntVariable(varId, intValue)",
        "anim.SetFloatVariable(varId, floatValue)",
        "anim.SetBoolVariable(varId, flag)",
        "afterRows.Insert(",
      ],
      "WriteVar",
    );
  });

  it("command: BindCommand, then CallCommand only for a bound id", () => {
    inOrder(
      method(src, "Command"),
      [
        "anim.BindCommand(cmdName)",
        "if (cmdId < 0)",
        "anim.CallCommand(cmdId, cmdInt, cmdFloat)",
        "res.m_Called = true;",
      ],
      "Command",
    );
  });

  it("btBreakpoint: the AI agent (itself or GetControlAIAgent), its tree, SetBtBreakpoint", () => {
    inOrder(
      method(src, "SetBreakpoint"),
      [
        "AIAgent.Cast(ent)",
        "AIControlComponent.Cast(ent.FindComponent(AIControlComponent))",
        "if (!control)",
        "control.GetControlAIAgent()",
        "GetControlAIAgent returned no AI agent",
        "AIBehaviorTreeComponent.Cast(agent.FindComponent(AIBehaviorTreeComponent))",
        "if (!tree)",
        "tree.SetBtBreakpoint(enable)",
      ],
      "SetBreakpoint",
    );
  });
});

describe("P-W4-01: Game and GameLib classes stay in their helper classes", () => {
  const CLASSES: Record<string, string[]> = {
    EMCP_WB_AnimDebugGraph: ["BaseAnimationControllerComponent"],
    EMCP_WB_AnimDebugProc: ["BaseProcAnimComponent"],
    EMCP_WB_AnimDebugBt: ["AIAgent", "AIControlComponent", "AIBehaviorTreeComponent"],
  };
  const all = Object.values(CLASSES).flat();
  const classes = [...src.matchAll(/^class (\w+)/gm)].map((m) => m[1]);

  it("the file declares the structs, the result holder, the text rules, three helpers and the handler", () => {
    expect(classes).toEqual([
      "EMCP_WB_AnimDebugRequest",
      "EMCP_WB_AnimDebugResponse",
      "EMCP_WB_AnimDebugResult",
      "EMCP_WB_AnimDebugText",
      "EMCP_WB_AnimDebugGraph",
      "EMCP_WB_AnimDebugProc",
      "EMCP_WB_AnimDebugBt",
      "EMCP_WB_AnimDebug",
    ]);
  });

  it("each Game or GameLib class is named only in its own helper", () => {
    for (const cls of classes) {
      // A class name inside a message string is not a compile reference.
      const body = classBody(src, cls).replace(/"(?:[^"\\]|\\.)*"/g, '""');
      const own = CLASSES[cls] ?? [];
      for (const name of all) {
        const named = new RegExp(`\\b${name}\\b`).test(body);
        expect(named, `${name} in ${cls}`).toBe(own.includes(name));
      }
    }
  });
});

// Ledger rows this file covers through its dispatch test ("dispatches every contract action"):
// census:mcp:handler-action/EMCP_WB_AnimDebug.btBreakpoint
// census:mcp:handler-action/EMCP_WB_AnimDebug.command
// census:mcp:handler-action/EMCP_WB_AnimDebug.procAnim
// census:mcp:handler-action/EMCP_WB_AnimDebug.set
// census:mcp:handler-action/EMCP_WB_AnimDebug.tags
// census:mcp:handler-action/EMCP_WB_AnimDebug.vars
