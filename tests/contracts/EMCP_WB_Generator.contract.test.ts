/**
 * The W7 Generator handler (EMCP_WB_Generator.c) checked over its Enforce text offline
 * (phase5-w7-spec.md section 2.2, DEC-075 OD-2, OD-6, OD-7, OD-12): the contract matches the structs
 * and the dispatch, the guards come in the order the spec asks, every mutating action refuses GATED
 * before any engine call while its gate is false, both regenerate routes are built with route A
 * chosen, prefabs resolve through Workbench.GetResourceName, the refusal codes are the vocabulary's
 * (NOT_A_GENERATOR lands with W7), and no banned call is made. Nothing here talks to Workbench.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadContract, regVKeys } from "../../src/manifest/contract.js";
import { buildDescription } from "../../src/manifest/generate.js";
import { actionFindings, denyFindings } from "../../scripts/enforce-lint.js";
import { ERROR_CODES } from "../../src/manifest/vocabulary.js";

const DIR = join("mod", "Scripts", "WorkbenchGame", "EnfusionMCP");
const FILE = join(DIR, "EMCP_WB_Generator.c");
const LINT_PATH = FILE.replace(/\\/g, "/");
const src = readFileSync(FILE, "utf-8");
const contract = loadContract(join("contracts", "EMCP_WB_Generator.json"));

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

/** Occurrences of text in body. */
function count(body: string, text: string): number {
  return body.split(text).length - 1;
}

const c = code(src);
const MUTATING = ["attach", "detach", "regenerate", "pointData", "events"];
const ACTIONS = ["list", ...MUTATING];
/** Codes the spec adds to the vocabulary with W7 (section 1.2 rule 13); Main lands them. */
const W7_NEW_CODES = ["NOT_A_GENERATOR"];
/** Each mutating action's method, its gate flag and the probe that opens it (spec 1.2 rule 9). */
const GATES: { action: string; method: string; gate: string; probe: string }[] = [
  { action: "attach", method: "AttachGenerator", gate: "ATTACH_OPEN", probe: "P-W7-10" },
  { action: "detach", method: "DetachGenerator", gate: "ATTACH_OPEN", probe: "P-W7-10" },
  { action: "regenerate", method: "RegenerateShape", gate: "REGENERATE_OPEN", probe: "P-W7-11" },
  { action: "pointData", method: "EditPointData", gate: "POINTDATA_OPEN", probe: "P-W7-13" },
  { action: "events", method: "SetEvents", gate: "EVENTS_OPEN", probe: "P-W7-12" },
];

describe("EMCP_WB_Generator structs and contract", () => {
  it("request and response RegV keys are the contract's", () => {
    expect(regVKeys(src, "EMCP_WB_GeneratorRequest")).toEqual(contract.request);
    expect(regVKeys(src, "EMCP_WB_GeneratorResponse")).toEqual(contract.response);
  });

  it("the per-action linter check finds nothing", () => {
    expect(actionFindings({ path: LINT_PATH, text: src }, contract)).toEqual([]);
  });

  it("dispatches the spec's 6 actions and nothing else", () => {
    const branches = [...c.matchAll(/req\.action == "([A-Za-z]+)"/g)].map((m) => m[1]);
    expect(branches.sort()).toEqual(contract.actions.map((a) => a.name).sort());
    expect(contract.actions.map((a) => a.name).sort()).toEqual([...ACTIONS].sort());
  });

  it("mutating actions are project-only and take no confirm (one undo point each, OD-12)", () => {
    for (const a of contract.actions) {
      expect(a.mutating, a.name).toBe(MUTATING.includes(a.name));
      expect(a.projectOnly, a.name).toBe(MUTATING.includes(a.name));
      expect(
        a.params.map((p) => p.key),
        a.name,
      ).not.toContain("confirm");
    }
  });

  it("every mutating action names its gate's probe in the contract; list refuses nothing", () => {
    const by = new Map(contract.actions.map((a) => [a.name, a]));
    for (const g of GATES)
      expect(by.get(g.action)!.refuses, g.action).toMatch(new RegExp(`GATED.*${g.probe}`));
    expect(by.get("attach")!.refuses).toMatch(/NOT_A_GENERATOR/);
    expect(by.get("list")!.refuses).toBeUndefined();
  });

  it("events answers was and eventsEnabled (OD-6)", () => {
    const events = contract.actions.find((a) => a.name === "events")!;
    expect(events.response.map((r) => r.key)).toEqual(
      expect.arrayContaining(["was", "eventsEnabled"]),
    );
  });

  it("the promoted contract points at the shared schema", () => {
    const raw = JSON.parse(readFileSync(join("contracts", "EMCP_WB_Generator.json"), "utf-8"));
    expect(raw.$schema).toBe("./_schema/contract.schema.json");
    expect(raw.source).toBe(LINT_PATH);
  });

  it("the tool description stays within 400 characters", () => {
    expect(buildDescription(contract).length).toBeLessThanOrEqual(400);
  });

  it("no out parameter carries an engine pointer (W1 compile lesson)", () => {
    expect(c).not.toMatch(
      /out\s+(?:IEntitySource|IEntity|ShapeEntity|GeneratorBaseEntity|BaseContainer|WorldEditorAPI|BaseContainerList|Resource|BaseResourceObject)\b/,
    );
    expect(c).not.toMatch(/\bout\s+[\w<> ]+\s+\w+\s*=\s*null/);
  });

  it("no float or vector travels through a request field", () => {
    const req = /class EMCP_WB_GeneratorRequest[\s\S]*?\n}\r?\n/.exec(c)![0];
    expect(req).not.toMatch(/\bfloat\b/);
    expect(req).not.toMatch(/\bvector\b/);
  });

  it("every refusal code is the vocabulary's or one W7 adds", () => {
    const consts = new Map(
      [...c.matchAll(/static const string (\w+) = "([A-Z_]+)";/g)].map((m) => [m[1], m[2]]),
    );
    const used = new Set<string>();
    for (const m of c.matchAll(/(?:Answer|Refuse)\(resp, (?:"\w+", )?(\w+|"[A-Z_]+"),/g)) {
      const raw = m[1];
      if (raw.startsWith('"')) used.add(raw.slice(1, -1));
      else if (consts.has(raw)) used.add(consts.get(raw)!);
    }
    used.add("NOT_IN_PROJECT");
    used.add("ENTITY_NOT_FOUND");
    for (const k of used) {
      if (k === "") continue;
      expect(
        k in ERROR_CODES || W7_NEW_CODES.includes(k),
        `code ${k} is not in vocabulary.ts`,
      ).toBe(true);
    }
    for (const k of ["NOT_A_SHAPE", "NOT_A_GENERATOR", "GATED", "RESOURCE_NOT_FOUND"])
      expect([...used]).toContain(k);
  });
});

describe("no banned call", () => {
  it("no FindFiles, Dialog, RunCommandline, RunCmd, Configure, FileIO, GetAbsolutePath or project name", () => {
    expect(denyFindings({ path: LINT_PATH, text: src }).filter((f) => f.level === "fail")).toEqual(
      [],
    );
    for (const banned of [
      "FindFiles",
      "Workbench.Dialog",
      "ScriptDialog",
      "WBProgressDialog",
      "RunCommandline",
      "RunCmd",
      "RunProcess",
      "Configure(",
      "FileIO",
      "GetAbsolutePath",
      "Sleep(",
      "EMCP2_sandbox",
      "_throwaway",
      "OpenResource",
      "SetOpenedResource",
      "RegenerateForest",
      "OnRegenerate",
    ]) {
      expect(c, banned).not.toContain(banned);
    }
  });

  it("no reserved identifier (Wait, vanilla) and no ternary operator", () => {
    expect(c).not.toMatch(/\b(?:Wait|vanilla)\b/);
    expect(c.replace(/"(?:[^"\\]|\\.)*"/g, '""')).not.toMatch(/\?[^?]*:/);
  });
});

describe("guards", () => {
  it("every World Editor call goes through the shared world-loaded check", () => {
    inOrder(
      method(src, "EditorApi"),
      ["Workbench.GetModule(WorldEditor)", "worldEditor.GetApi()", "EMCP_WB_Common.NoWorldReason"],
      "EditorApi",
    );
  });

  it("the edit guard: project found, a loaded world, edit mode, the world in the project", () => {
    inOrder(
      method(src, "EditApi"),
      [
        "EMCP_WB_Guard.IsProjectFound()",
        "EMCP_WB_Guard.ProjectId()",
        "EditorApi(resp)",
        "api.IsGameMode()",
        "api.GetWorldPath(worldPath)",
        'worldPath.StartsWith("$" + projectId + ":")',
      ],
      "EditApi",
    );
  });

  it("list reads with EditorApi, no project guard and no entity action", () => {
    const read = method(src, "ListGenerators");
    expect(read).toContain("EditorApi(resp)");
    expect(read).not.toContain("EditApi(resp)");
    expect(read).not.toContain("BeginEntityAction");
    expect(read).not.toContain("ToggleGeneratorEvents");
  });

  it("each gate is false and refuses GATED before the guard and any engine call", () => {
    for (const g of GATES) {
      expect(src, g.gate).toMatch(new RegExp(`static const bool ${g.gate} = false;`));
      const body = method(src, g.method);
      const gateAt = body.indexOf(`if (!${g.gate})`);
      expect(gateAt, g.method).toBeGreaterThanOrEqual(0);
      expect(body.indexOf("Refuse(resp, GATED", gateAt), g.method).toBeGreaterThan(gateAt);
      expect(body, g.method).toContain(g.probe);
      const guard = body.indexOf("EditApi(resp)");
      expect(guard, g.method).toBeGreaterThan(gateAt);
      const firstApi = body.search(/\bapi\.|Resource\.Load|Workbench\./);
      expect(firstApi, g.method).toBeGreaterThan(guard);
    }
  });

  it("each entity edit is one BeginEntityAction / EndEntityAction with its undo name", () => {
    const edits: [string, string][] = [
      ["AttachGenerator", "UNDO_ATTACH"],
      ["DetachGenerator", "UNDO_DETACH"],
      ["RegenerateShape", "UNDO_REGENERATE"],
      ["EditPointData", "UNDO_POINTDATA"],
    ];
    for (const [m, undo] of edits) {
      const body = method(src, m);
      expect(count(body, "api.BeginEntityAction("), m).toBe(1);
      expect(count(body, "api.EndEntityAction("), m).toBe(1);
      inOrder(
        body,
        [
          "EditApi(resp)",
          `resp.undoName = ${undo};`,
          `api.BeginEntityAction(${undo})`,
          "api.EndEntityAction()",
        ],
        m,
      );
    }
    const events = method(src, "SetEvents");
    expect(events).not.toContain("BeginEntityAction");
  });
});

describe("engine calls", () => {
  it("list: the editor walk or the shape's children, IsInherited GeneratorBaseEntity, events state", () => {
    inOrder(
      method(src, "ListGenerators"),
      [
        "ShapeOf(api, shapeSrc, resp)",
        "GeneratorChildren(shapeSrc, items)",
        "api.GetEditorEntityCount()",
        "api.GetEditorEntity(e)",
        // One ToType per class name, not per entity (enforce-review W7 G2).
        "generatorClasses.Find(srcClass)",
        "ClassInherits(srcClass, GeneratorBaseEntity)",
        "api.AreGeneratorEventsEnabled()",
        "Row(items.Get(i))",
      ],
      "list",
    );
    inOrder(
      method(src, "ClassInherits"),
      ["className.ToType()", "classType.IsInherited(baseType)"],
      "ClassInherits",
    );
    expect(method(src, "IsGenerator")).toContain("GeneratorBaseEntity");
    inOrder(
      method(src, "Row"),
      ["EMCP_WB_EntityRef.Format(src)", "src.GetClassName()", "AncestorOf(src)", "ParentOf(src)"],
      "Row",
    );
    inOrder(
      method(src, "ShapeOf"),
      ["api.SourceToEntity(src)", "ShapeEntity.Cast(ent)", "Refuse(resp, NOT_A_SHAPE"],
      "ShapeOf",
    );
  });

  it("attach: GetResourceName (never GetAbsolutePath), Load, IsInherited, CreateEntity under the shape", () => {
    const prefab = method(src, "PrefabOf");
    expect(prefab).toContain("Workbench.GetResourceName(braced)");
    expect(prefab).toContain("Workbench.GetResourceName(clean)");
    expect(prefab).toContain('lower.EndsWith(".et")');
    inOrder(
      method(src, "AttachGenerator"),
      [
        "ShapeOf(api, shapeSrc, resp)",
        "PrefabOf(req.prefab, resp)",
        "Resource.Load(prefabName)",
        "loaded.GetResource()",
        "prefabObject.ToEntitySource()",
        "Refuse(resp, NOT_A_GENERATOR",
        "ClassInherits(prefabClass, GeneratorBaseEntity)",
        "api.BeginEntityAction(UNDO_ATTACH)",
        "api.CreateEntity(prefabName, req.name, shapeSrc.GetLayerID(), shapeSrc, vector.Zero, vector.Zero)",
        "api.EndEntityAction()",
      ],
      "attach",
    );
  });

  it("detach: a generator, or a shape's generator children, deleted in one action", () => {
    inOrder(
      method(src, "DetachGenerator"),
      [
        "IsGenerator(src)",
        "ShapeEntity.Cast(ent)",
        "Refuse(resp, NOT_A_GENERATOR",
        "GeneratorChildren(src, doomed)",
        "api.BeginEntityAction(UNDO_DETACH)",
        "api.DeleteEntity(gen)",
        "api.EndEntityAction()",
      ],
      "detach",
    );
  });

  it("regenerate: both routes built, route A chosen, local box arrays, no protected call", () => {
    expect(src).toMatch(/static const int ROUTE_A = 1;/);
    expect(src).toMatch(/static const int ROUTE_B = 2;/);
    expect(src).toMatch(/static const int REGENERATE_ROUTE = 1;/);
    const body = method(src, "RegenerateShape");
    inOrder(
      body,
      [
        "GeneratorChildren(shapeSrc, gens)",
        "if (REGENERATE_ROUTE == ROUTE_B)",
        "shapeEnt.GetPointsPositions(localPoints)",
        "api.BeginEntityAction(UNDO_REGENERATE)",
        "new ContainerIdPathEntry(POINTS_KEY, 0)",
        'api.SetVariableValue(shapeSrc, pointPath, "Position"',
        "array<vector> mins = {};",
        "array<vector> maxes = {};",
        "shapeEnt.GetAllInfluenceBBoxes(shapeSrc, mins, maxes)",
        "GeneratorBaseEntity.Cast(genEnt)",
        "generator.OnShapeChanged(shapeSrc, shapeEnt, mins, maxes)",
        "api.EndEntityAction()",
      ],
      "regenerate",
    );
  });

  it("pointData: the import plugin's array calls on the point's Data, count read back", () => {
    expect(src).toContain('static const string POINTS_KEY = "Points";');
    expect(src).toContain('static const string DATA_KEY = "Data";');
    inOrder(
      method(src, "EditPointData"),
      [
        "ClassInherits(req.dataClass, ShapePointDataScriptBase)",
        "if (!POINTDATA_OPEN)",
        "PointDataCount(shapeSrc, req.index)",
        "new ContainerIdPathEntry(POINTS_KEY, req.index)",
        "api.BeginEntityAction(UNDO_POINTDATA)",
        "api.CreateObjectArrayVariableMember(shapeSrc, pointPath, DATA_KEY, req.dataClass, before)",
        "api.RemoveObjectArrayVariableMember(shapeSrc, pointPath, DATA_KEY, req.dataIndex)",
        "api.EndEntityAction()",
        "resp.count = PointDataCount(shapeSrc, req.index)",
      ],
      "pointData",
    );
    inOrder(
      method(src, "PointDataCount"),
      [
        "shapeSrc.GetObjectArray(POINTS_KEY)",
        "points.Get(pointIndex)",
        "point.GetObjectArray(DATA_KEY)",
        "data.Count()",
      ],
      "PointDataCount",
    );
  });

  it("events: was read before the toggle, eventsEnabled read back after", () => {
    inOrder(
      method(src, "SetEvents"),
      [
        "if (!EVENTS_OPEN)",
        "EditApi(resp)",
        "resp.was = api.AreGeneratorEventsEnabled()",
        "api.ToggleGeneratorEvents(wanted)",
        "resp.eventsEnabled = api.AreGeneratorEventsEnabled()",
      ],
      "events",
    );
  });
});

// Ledger rows this file covers through its dispatch test ("dispatches every contract action"):
// census:mcp:handler-action/EMCP_WB_Generator.attach
// census:mcp:handler-action/EMCP_WB_Generator.detach
// census:mcp:handler-action/EMCP_WB_Generator.events
// census:mcp:handler-action/EMCP_WB_Generator.list
// census:mcp:handler-action/EMCP_WB_Generator.pointData
// census:mcp:handler-action/EMCP_WB_Generator.regenerate
