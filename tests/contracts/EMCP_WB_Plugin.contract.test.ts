/**
 * The W6 plugin handler (EMCP_WB_Plugin.c) checked over its Enforce text offline
 * (phase5-w6-spec.md sections 1.2, 2.1 and 2.1.1, DEC-069): the contract matches the structs and
 * the dispatch, run's checks come in the spec's order and every run-listed class stays unproven
 * until P-W6-05, setSettings never writes (NO_SETTER until P-W6-03), the refusal codes are the
 * vocabulary's or the four W6 codes the integrator lands, and no banned call is made. Nothing here
 * talks to Workbench.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadContract, regVKeys } from "../../src/manifest/contract.js";
import { buildDescription } from "../../src/manifest/generate.js";
import { actionFindings, denyFindings } from "../../scripts/enforce-lint.js";
import { ERROR_CODES } from "../../src/manifest/vocabulary.js";

const DIR = join("mod", "Scripts", "WorkbenchGame", "EnfusionMCP");
const FILE = join(DIR, "EMCP_WB_Plugin.c");
const LINT_PATH = FILE.replace(/\\/g, "/");
const src = readFileSync(FILE, "utf-8");
const contract = loadContract(join("contracts", "EMCP_WB_Plugin.json"));

/** Source with comments removed, so a word in a comment never counts as a call. */
function code(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/** Body of `static <type> <name>(` up to the next method separator or the class end. */
function method(s: string, name: string): string {
  const at = s.search(new RegExp(`static [\\w<>]+ ${name}\\(`));
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
const ACTIONS = ["list", "describe", "getSettings", "setSettings", "run"];
const MUTATING = ["setSettings", "run"];

/** Spec 2.1.1, with the module E03 reads from each class's wbModules attribute. */
const RUN_LIST: Array<[string, string]> = [
  ["WorldEditor", "SCR_SnapAndOrientToTerrainPlugin"],
  ["WorldEditor", "SCR_WrapEntitiesPlugin"],
  ["WorldEditor", "SCR_AddPrefabToSelectedEntitiesPlugin"],
  ["WorldEditor", "EntityOrientationTool"],
  ["WorldEditor", "CameraOrientationTool"],
  ["ScriptEditor", "SCR_CopyClassAndMethodPlugin"],
  ["ScriptEditor", "SCR_DebugLinePlugin"],
  ["LocalizationEditor", "SCR_LocEditedTextPlugin"],
  ["LocalizationEditor", "SCR_LocStatusPlugin"],
  ["LocalizationEditor", "SCR_LocLengthPlugin"],
  // The spec table says WorldEditor; the class's attribute says wbModules: { "ResourceManager" }.
  ["ResourceManager", "SCR_CheckRuinModelsAndUsagePlugin"],
  ["ResourceManager", "SCR_ReforgerEngineSettingsPlugin"],
  ["ResourceManager", "SCR_ReforgerGameSettingsPlugin"],
];

/** Spec 1.2 rule 12: the integrator adds these to vocabulary.ts (GATED is already there). */
const W6_CODES = ["PLUGIN_MODAL", "PRECONDITION_UNMET", "NO_SETTER", "NOT_A_SHAPE"];

describe("EMCP_WB_Plugin structs and contract", () => {
  it("request and response RegV keys are the contract's (packed row keys aside)", () => {
    expect(regVKeys(src, "EMCP_WB_PluginRequest")).toEqual(contract.request);
    const packed = ["plugins", "settings", "attribute"];
    expect(regVKeys(src, "EMCP_WB_PluginResponse")).toEqual(
      contract.response.filter((k) => !packed.includes(k)),
    );
  });

  it("the per-action linter check finds nothing", () => {
    expect(actionFindings({ path: LINT_PATH, text: src }, contract)).toEqual([]);
  });

  it("dispatches the five actions and nothing else", () => {
    const branches = [...c.matchAll(/req\.action == "([A-Za-z]+)"/g)].map((m) => m[1]);
    expect(branches.sort()).toEqual([...ACTIONS].sort());
    expect(contract.actions.map((a) => a.name).sort()).toEqual([...ACTIONS].sort());
  });

  it("setSettings and run are mutating, project-only and take confirm; the reads are not", () => {
    for (const a of contract.actions) {
      expect(a.mutating, a.name).toBe(MUTATING.includes(a.name));
      expect(a.projectOnly, a.name).toBe(MUTATING.includes(a.name));
      if (a.mutating)
        expect(
          a.params.map((p) => p.key),
          a.name,
        ).toContain("confirm");
    }
  });

  it("no method-name and no resources parameter (DEC-048, DEC-069 OD-3, OD-8)", () => {
    for (const key of ["method", "methodName", "button", "resources"]) {
      expect(contract.request, key).not.toContain(key);
      for (const a of contract.actions)
        expect(
          a.params.map((p) => p.key),
          `${a.name} ${key}`,
        ).not.toContain(key);
    }
  });

  it("the tool description stays within 400 characters", () => {
    expect(buildDescription(contract).length).toBeLessThanOrEqual(400);
  });

  it("the contract sits in contracts/ with the repository schema path", () => {
    const raw = JSON.parse(readFileSync(join("contracts", "EMCP_WB_Plugin.json"), "utf-8"));
    expect(raw.$schema).toBe("./_schema/contract.schema.json");
    expect(existsSync(join("docs", "v2", "inbox", "w6", "contracts", "EMCP_WB_Plugin.json"))).toBe(
      false,
    );
  });

  it("no out parameter carries an engine pointer (W1 compile lesson)", () => {
    expect(c).not.toMatch(
      /out\s+(?:WorkbenchPlugin|WBModuleDef|IEntitySource|IEntity|BaseContainer|BaseContainerList|WorldEditorAPI|WorldEditor|ScriptEditor|LocalizationEditor|ResourceManager)\b/,
    );
  });

  it("float values never travel through a request field", () => {
    const req = /class EMCP_WB_PluginRequest[\s\S]*?\n}\r?\n/.exec(c)![0];
    expect(req).not.toMatch(/\bfloat\b/);
  });

  it("no method parameter or local shadows a member of its class", () => {
    const classes = [...src.matchAll(/^class (\w+)[^\n]*\r?\n\{([\s\S]*?)\r?\n\}/gm)];
    expect(classes.length).toBe(3);
    for (const [, name, body] of classes) {
      const members = new Set(
        [...body.matchAll(/^\t(?:static const |ref )?[\w<>]+ (\w+)(?: = [^;]*)?;$/gm)].map(
          (m) => m[1],
        ),
      );
      for (const m of body.matchAll(/^\t(?:static |override )?[\w<>]+ \w+\(([^)]*)\)$/gm)) {
        for (const p of m[1].split(",").filter((x) => x.trim())) {
          const param = p.trim().split(/\s+/).pop()!;
          expect(members.has(param), `${name}: ${m[0].trim()} shadows ${param}`).toBe(false);
        }
      }
      for (const m of body.matchAll(/^\t\t+(?:[\w<>]+) (\w+)(?: = [^;]*)?;$/gm))
        expect(members.has(m[1]), `${name}: local ${m[1]} shadows a member`).toBe(false);
    }
  });
});

describe("no banned call", () => {
  it("no FindFiles, Dialog, RunCommandline, RunCmd, Configure, FileIO, a setter or a project name", () => {
    expect(denyFindings({ path: LINT_PATH, text: src }).filter((f) => f.level === "fail")).toEqual(
      [],
    );
    for (const banned of [
      "FindFiles",
      "Workbench.Dialog",
      "ScriptDialog",
      "RunCommandline(",
      "RunCmd",
      "RunProcess",
      "Configure(",
      "FileIO",
      "SetOpenedResource",
      "SetVariableValue",
      "SetClassVar",
      "modded",
      "EMCP2_sandbox",
      "_throwaway",
    ]) {
      // Code only: a refusal text may name a call it explains (SetOpenedResource, SetVariableValue).
      expect(c.replace(/"(?:[^"\\]|\\.)*"/g, '""'), banned).not.toContain(banned);
    }
  });

  it("no ternary operator", () => {
    expect(c.replace(/"(?:[^"\\]|\\.)*"/g, '""')).not.toMatch(/\?[^?]*:/);
  });

  it("the unconditional GATED path of P3 is retired", () => {
    expect(src).not.toContain("RefuseGated");
    expect(src).not.toContain("GATED_NEXT");
    expect(src).not.toContain("waits for the Phase 3 plugin battery");
  });

  it("RunCommandline and Configure are refused by name, before any lookup", () => {
    expect(method(src, "NeverCalled")).toContain(
      'return entryPoint == "RunCommandline" || entryPoint == "Configure";',
    );
    expect(src).toContain(
      'static const string NEVER_CALLED = "RunCommandline and Configure are never called";',
    );
    for (const m of ["FindPlugin", "RunPlugin"]) {
      const body = method(src, m);
      expect(body.indexOf("NeverCalled(pluginClass)"), m).toBeGreaterThanOrEqual(0);
      expect(body.indexOf("NeverCalled(pluginClass)"), m).toBeLessThan(
        body.indexOf("Workbench.GetModule") < 0 ? Infinity : body.indexOf("Workbench.GetModule"),
      );
    }
  });
});

describe("refusal codes", () => {
  it("every code the handler answers is in the vocabulary or one of the W6 codes", () => {
    const consts = new Map(
      [...src.matchAll(/static const string (\w+) = "([A-Z_]+)";/g)].map((m) => [m[1], m[2]]),
    );
    const codes = new Set<string>();
    for (const m of c.matchAll(/Refuse\(("([A-Z_]+)"|[\w.]+),/g)) {
      const v = m[2] ?? consts.get(m[1].replace(/^\w+\./, "")) ?? m[1];
      codes.add(v);
    }
    for (const m of c.matchAll(/unmetCode = "([A-Z_]+)";/g)) codes.add(m[1]);
    for (const m of c.matchAll(/unmetCode = ([A-Z_]+);/g)) codes.add(consts.get(m[1]) ?? m[1]);
    // The shared guard's constant: its value is NOT_IN_PROJECT.
    codes.delete("EMCP_WB_Guard.NOT_IN_PROJECT");
    if (c.includes("EMCP_WB_Guard.NOT_IN_PROJECT")) codes.add("NOT_IN_PROJECT");
    codes.delete("unmetCode");
    expect(codes.size).toBeGreaterThan(5);
    for (const code of codes)
      expect(code in ERROR_CODES || W6_CODES.includes(code), code).toBe(true);
    for (const code of ["PLUGIN_MODAL", "PRECONDITION_UNMET", "NO_SETTER", "GATED"])
      expect(codes, code).toContain(code);
  });
});

describe("run (spec 2.1, 2.1.1)", () => {
  it("the compiled run allow-list is the spec's 13 classes with their E03 modules", () => {
    const listed = [
      ...method(src, "RunListed").matchAll(/moduleId == "(\w+)" && pluginClass == "(\w+)"/g),
    ].map((m) => [m[1], m[2]]);
    expect(listed).toEqual(RUN_LIST);
  });

  it("only the three live-proven DEC-103 classes are true; the other ten stay one false line each", () => {
    const body = method(src, "RunProven");
    const lines = [...body.matchAll(/if \(pluginClass == "(\w+)"\)\s*return (true|false);/g)].map(
      (m) => [m[1], m[2]],
    );
    expect(lines.map((l) => l[0])).toEqual(RUN_LIST.map((r) => r[1]));
    const PROVEN = [
      "CameraOrientationTool",
      "SCR_CheckRuinModelsAndUsagePlugin",
      "SCR_LocLengthPlugin", // W12 run 1 (w12-20)
    ];
    for (const [cls, value] of lines)
      expect(value, cls).toBe(PROVEN.includes(cls) ? "true" : "false");
    expect(lines.filter((l) => l[1] === "true").map((l) => l[0]).sort()).toEqual([...PROVEN].sort());
    expect(lines.filter((l) => l[1] === "false")).toHaveLength(10);
    // The DEC-103 marker comment on each true line (the method slice may stop at the comment).
    for (const cls of PROVEN)
      expect(src).toMatch(
        new RegExp(`if \\(pluginClass == "${cls}"\\)\\s*return true; // DEC-103`),
      );
    expect(body.match(/return true/g)).toHaveLength(3);
  });

  it("every run-listed class has a precondition branch; the two settings plugins stay unmet", () => {
    const body = method(src, "Preconditions");
    for (const [, cls] of RUN_LIST) expect(body, cls).toContain(`"${cls}"`);
    expect(body).toMatch(
      /if \(pluginClass == "SCR_ReforgerEngineSettingsPlugin" \|\| pluginClass == "SCR_ReforgerGameSettingsPlugin"\)\s*\{\s*unmetWhy = [^;]+;\s*return false;\s*\}/,
    );
    expect(body).toMatch(
      /unmetWhy = pluginClass \+ " has no precondition check in this handler";\s*return false;/,
    );
  });

  it("the modal list holds 71 classes, none on the run list or the read list", () => {
    const names = [...method(src, "IsModal").matchAll(/"(\w+)"/g)].map((m) => m[1]);
    expect(names.length).toBe(71);
    expect(new Set(names).size).toBe(71);
    for (const [, cls] of RUN_LIST) expect(names, cls).not.toContain(cls);
    for (const m of method(src, "Listed").matchAll(/pluginClass == "(\w+)"/g))
      expect(names, m[1]).not.toContain(m[1]);
  });

  it("the modal list equals the E03 catalog's modal verdicts when the catalog is present", () => {
    const base = process.env.LOCALAPPDATA;
    const file = base
      ? join(base, "enfusion-mcp", "artifacts", "census", "1.9.0.37", "E03", "plugin-catalog.json")
      : "";
    if (!file || !existsSync(file)) return;
    const catalog = JSON.parse(readFileSync(file, "utf-8")) as {
      classes: Array<{ class: string; run?: { verdict?: string } }>;
    };
    const modal = catalog.classes
      .filter((k) => k.run?.verdict === "modal")
      .map((k) => k.class)
      .sort();
    const names = [...method(src, "IsModal").matchAll(/"(\w+)"/g)].map((m) => m[1]).sort();
    expect(names).toEqual(modal);
  });

  it("checks in the spec's order: entry points, module, modal, run list, project, class, preconditions, confirm, proof, Run", () => {
    inOrder(
      method(src, "RunPlugin"),
      [
        'if (pluginClass == "" || moduleName == "")',
        "if (NeverCalled(pluginClass))",
        'if (moduleName == "ParticleEditor")',
        "EMCP_WB_Guard.ModuleTypeForRead(moduleName)",
        "if (IsModal(pluginClass))",
        "resp.Refuse(PLUGIN_MODAL,",
        "if (!RunListed(moduleName, pluginClass))",
        '"NOT_ALLOWLISTED"',
        "if (!EMCP_WB_Guard.IsProjectFound())",
        "EMCP_WB_Guard.NOT_IN_PROJECT",
        "pluginClass.ToType()",
        "pluginType.IsInherited(WorkbenchPlugin)",
        "if (!Preconditions(pluginClass, unmetCode, unmetWhy))",
        "if (!req.confirm)",
        "if (!RunProven(pluginClass))",
        "resp.Refuse(GATED,",
        "Workbench.GetModule(moduleType)",
        "wbModule.GetPlugin(pluginType)",
        "plugin.Run();",
        "resp.ran = true;",
      ],
      "RunPlugin",
    );
  });

  it("no engine call before the request checks; Run is called once, from RunPlugin only", () => {
    const body = method(src, "RunPlugin");
    const firstEngine = body.search(/Workbench\.|\.ToType\(|Preconditions\(/);
    expect(firstEngine).toBeGreaterThan(body.indexOf("if (!EMCP_WB_Guard.IsProjectFound())"));
    expect((c.match(/\.Run\(\)/g) ?? []).length).toBe(1);
    expect(body).toContain("plugin.Run();");
    expect(c).not.toMatch(/\.(?:RunCommandline|Configure|OnResourceContextMenu)\s*\(/);
  });

  it("the dry run returns before the GATED refusal and any GetPlugin", () => {
    const body = method(src, "RunPlugin");
    const dry = body.indexOf("if (!req.confirm)");
    const ret = body.indexOf("return;", dry);
    expect(dry).toBeGreaterThan(0);
    expect(ret).toBeLessThan(body.indexOf("resp.Refuse(GATED,"));
    expect(ret).toBeLessThan(body.indexOf("GetPlugin("));
  });

  it("World Editor preconditions: world loaded, not play mode, selection resolves, browser prefabs capped", () => {
    inOrder(
      method(src, "WorldReady"),
      [
        "Workbench.GetModule(WorldEditor)",
        "worldEditor.GetApi()",
        "EMCP_WB_Common.NoWorldReason(worldEditor, api)",
        "api.IsGameMode()",
        "editOnly && worldEditor.IsPrefabEditMode()",
        "api.GetSelectedEntitiesCount()",
        "api.GetSelectedEntity(i)",
        "api.SourceToEntity(selected)",
        "worldEditor.GetResourceBrowserSelection(picked.Insert, true)",
        'pickedName.EndsWith(".et")',
        "pickedCount * selectedCount > ADD_PREFAB_MAX",
      ],
      "WorldReady",
    );
    const pre = method(src, "Preconditions");
    expect(pre).toMatch(/"EntityOrientationTool"\)\s*return WorldReady\(1, 1, true, false,/);
    expect(pre).toMatch(
      /"SCR_SnapAndOrientToTerrainPlugin"\)\s*return WorldReady\(1, -1, true, false,/,
    );
    expect(pre).toMatch(/"SCR_WrapEntitiesPlugin"\)\s*return WorldReady\(1, -1, true, false,/);
    expect(pre).toMatch(
      /"SCR_AddPrefabToSelectedEntitiesPlugin"\)\s*return WorldReady\(1, -1, true, true,/,
    );
    expect(pre).toMatch(/"CameraOrientationTool"\)\s*return WorldReady\(1, 1, false, false,/);
  });

  it("Script Editor preconditions: a .c open, caret inside, DebugLine's file inside the project", () => {
    inOrder(
      method(src, "ScriptReady"),
      [
        "Workbench.GetModule(ScriptEditor)",
        "EMCP_WB_ScriptEditorUtil.ReadDoc(scriptEditor, doc)",
        "if (!doc.m_Opened)",
        'folded.EndsWith(".c")',
        "scriptEditor.GetCurrentLine()",
        "scriptEditor.GetLinesCount()",
        "if (inProject && !doc.m_InProject)",
      ],
      "ScriptReady",
    );
    const pre = method(src, "Preconditions");
    expect(pre).toMatch(/"SCR_DebugLinePlugin"\)\s*return ScriptReady\(true,/);
    expect(pre).toMatch(/"SCR_CopyClassAndMethodPlugin"\)\s*return ScriptReady\(false,/);
  });

  it("String Editor preconditions: table, Items, selection in range, project table and no modal hazard for EditedText", () => {
    inOrder(
      method(src, "TableReady"),
      [
        "Workbench.GetModule(LocalizationEditor)",
        "locEditor.GetTable()",
        "table.GetObjectArray(EMCP_WB_LocalizationUtil.VAR_ITEMS)",
        "locEditor.GetSelectedRows(selected)",
        "row < 0 || row >= itemCount",
        'EMCP_WB_Guard.SourceAddonsAreOnly(table, EMCP_WB_Guard.ProjectId(), sourceAddons) || sourceAddons == ""',
        "EMCP_WB_LocalizationUtil.StatusOf(item, statusNow)",
        "EMCP_WB_LocalizationUtil.ModalHazard(item, fieldNames, encoded, hasStatus, statusNow)",
      ],
      "TableReady",
    );
    const pre = method(src, "Preconditions");
    expect(pre).toMatch(/"SCR_LocEditedTextPlugin"\)\s*return TableReady\(true, true,/);
    expect(pre).toMatch(/"SCR_LocStatusPlugin"\)\s*return TableReady\(true, false,/);
    expect(pre).toMatch(/"SCR_LocLengthPlugin"\)\s*return TableReady\(false, false,/);
  });
});

describe("setSettings (spec 2.1, DEC-069 OD-4, OD-5)", () => {
  it("read list, project, instance, [Attribute], scalar parse, dry run, then NO_SETTER", () => {
    inOrder(
      method(src, "SetSettings"),
      [
        'if (varName == "")',
        "if (!Listed(req.moduleName, req.className))",
        "if (!EMCP_WB_Guard.IsProjectFound())",
        "FindPlugin(req, resp)",
        "instanceType.GetVariableName(i) == varName",
        "if (!HasAttribute(instanceType, index))",
        "if (!NormalValue(varType, wanted, normal, why))",
        "resp.previous = ShowPath(VariableValue(instanceType, plugin, index));",
        "if (!req.confirm)",
        "resp.Refuse(NO_SETTER, NO_SETTER_TEXT",
      ],
      "SetSettings",
    );
    expect(method(src, "SetSettings")).toContain("resp.changed = false;");
    expect(method(src, "SetSettings")).not.toContain("resp.changed = true");
  });

  it("only bool, int, float, string, ResourceName and vector are accepted, floats parsed from text", () => {
    const body = method(src, "NormalValue");
    const types = [...body.matchAll(/varType == (\w+)/g)].map((m) => m[1]);
    expect(types).toEqual(["int", "float", "bool", "string", "ResourceName", "vector"]);
    for (const call of [
      "EMCP_WB_Common.ParseInt(text, intValue)",
      "EMCP_WB_Common.ParseFloat(text, floatValue)",
      "EMCP_WB_Common.ParseVectorString(text, vectorValue, vectorWhy)",
    ])
      expect(body, call).toContain(call);
    expect(body).toMatch(
      /why = "type " \+ varType\.ToString\(\) \+ " is not written[^;]*;\s*return false;\s*\}\s*$/,
    );
  });
});

describe("the reads keep their P3 behaviour (existing callers)", () => {
  it("the read allow-list equals policy.json plugin_read_allow_list.allow_list", () => {
    const policy = JSON.parse(readFileSync(join("data", "census", "policy.json"), "utf-8"));
    const allow = (policy.plugin_read_allow_list.allow_list as Array<[string, string]>).map(
      ([m, k]) => [m, k],
    );
    const listed = [
      ...method(src, "Listed").matchAll(/moduleId == "(\w+)" && pluginClass == "(\w+)"/g),
    ].map((m) => [m[1], m[2]]);
    expect(listed).toEqual(allow);
    const rows = [...method(src, "ListPlugins").matchAll(/AddPlugin\("(\w+)", "(\w+)"\)/g)].map(
      (m) => [m[1], m[2]],
    );
    expect(rows).toEqual(allow);
  });

  it("FindPlugin checks the read module enum and the read list before resolving", () => {
    inOrder(
      method(src, "FindPlugin"),
      [
        "EMCP_WB_Guard.ModuleTypeForRead(moduleName)",
        '"NOT_ALLOWLISTED"',
        "pluginClass.ToType()",
        "Workbench.GetModule(moduleType)",
        "wbModule.GetPlugin(pluginType)",
      ],
      "FindPlugin",
    );
  });

  it("describe and getSettings take the same keys as before (the TS tool sends these)", () => {
    for (const name of ["describe", "getSettings"]) {
      const a = contract.actions.find((x) => x.name === name)!;
      const keys = a.params.map((p) => p.key);
      expect(keys.slice(0, 2), name).toEqual(["moduleName", "className"]);
    }
    expect(
      contract.actions.find((x) => x.name === "getSettings")!.params.map((p) => p.key),
    ).toEqual(["moduleName", "className", "cursor", "limit"]);
    // A refusal keeps writing the P3 nextStep key (the TS tool reads it as `next`).
    expect(src).toContain("nextStep = step;");
  });
});

// Ledger rows this file covers through its dispatch test ("dispatches every contract action"):
// census:mcp:handler-action/EMCP_WB_Plugin.describe
// census:mcp:handler-action/EMCP_WB_Plugin.getSettings
// census:mcp:handler-action/EMCP_WB_Plugin.list
// census:mcp:handler-action/EMCP_WB_Plugin.run
// census:mcp:handler-action/EMCP_WB_Plugin.setSettings
