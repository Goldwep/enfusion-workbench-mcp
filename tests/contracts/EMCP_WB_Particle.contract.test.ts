/**
 * The W5 Particle handler (EMCP_WB_Particle.c) checked over its Enforce text offline
 * (phase5-w5-spec.md section 2.2, DEC-068): the contract matches the structs and the dispatch, the
 * guards come in the order the spec's guard column asks, the engine calls are the spec's, the
 * GetParam calls of probe P-W5-08 sit in one isolated reader, the Particle Editor is never touched,
 * and no banned call is made. Nothing here talks to Workbench.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadContract, regVKeys } from "../../src/manifest/contract.js";
import { buildDescription } from "../../src/manifest/generate.js";
import { actionFindings, denyFindings } from "../../scripts/enforce-lint.js";
import { ERROR_CODES } from "../../src/manifest/vocabulary.js";

const DIR = join("mod", "Scripts", "WorkbenchGame", "EnfusionMCP");
const FILE = join(DIR, "EMCP_WB_Particle.c");
const LINT_PATH = FILE.replace(/\\/g, "/");
const src = readFileSync(FILE, "utf-8");
const contract = loadContract(join("contracts", "EMCP_WB_Particle.json"));

/** The 14 codes W5 adds to vocabulary.ts (spec section 1.3; the integrator lands them). */
const W5_CODES = [
  "NO_AI_WORLD",
  "NO_NAVMESH_COMPONENT",
  "NOT_SCR_AI_WORLD",
  "NO_SOUND_COMPONENT",
  "NO_SIGNALS_MANAGER",
  "NO_SOUND_WORLD",
  "EVENT_NOT_FOUND",
  "VARIABLE_NOT_FOUND",
  "PLAY_FAILED",
  "NOT_A_PARTICLE_EFFECT",
  "NO_PARTICLES",
  "BOX_TOO_LARGE",
  "WRONG_MODULE",
  "SIG_COMPILED_STALE",
];

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
const PROJECT_ACTIONS = ["spawn", "remove"];
const RUNTIME_WRITES = ["control", "simulate", "setParam"];
const READS = ["stats", "param"];
const ACTIONS = [...PROJECT_ACTIONS, ...RUNTIME_WRITES, ...READS];
/** Dispatch branch -> method name. */
const METHODS: Record<string, string> = {
  spawn: "Spawn",
  stats: "Stats",
  control: "Control",
  simulate: "SimulateEffect",
  param: "ReadParam",
  setParam: "WriteParam",
  remove: "Remove",
};

describe("EMCP_WB_Particle structs and contract", () => {
  it("request and response RegV keys are the contract's", () => {
    expect(regVKeys(src, "EMCP_WB_ParticleRequest")).toEqual(contract.request);
    expect(regVKeys(src, "EMCP_WB_ParticleResponse")).toEqual(contract.response);
  });

  it("the per-action linter check finds nothing", () => {
    expect(actionFindings({ path: LINT_PATH, text: src }, contract)).toEqual([]);
  });

  it("dispatches the spec's 7 actions and nothing else", () => {
    const branches = [...c.matchAll(/req\.action == "([A-Za-z]+)"/g)].map((m) => m[1]);
    expect(branches.sort()).toEqual(contract.actions.map((a) => a.name).sort());
    expect(contract.actions.map((a) => a.name).sort()).toEqual([...ACTIONS].sort());
    for (const [action, m] of Object.entries(METHODS))
      expect(c, action).toContain(`req.action == "${action}")\n\t\t\t${m}(req, resp);`);
  });

  it("spawn and remove are project-only with confirm; runtime writes are mutating without; reads are not", () => {
    for (const a of contract.actions) {
      expect(a.projectOnly, a.name).toBe(PROJECT_ACTIONS.includes(a.name));
      expect(a.mutating, a.name).toBe(!READS.includes(a.name));
      expect(a.params.map((p) => p.key).includes("confirm"), a.name).toBe(
        PROJECT_ACTIONS.includes(a.name),
      );
    }
  });

  it("the tool description stays within 400 characters and the purpose within 160", () => {
    expect(buildDescription(contract).length).toBeLessThanOrEqual(400);
    expect(contract.purpose.length).toBeLessThanOrEqual(160);
  });

  it("no out parameter carries an engine pointer (W1 compile lesson)", () => {
    expect(c).not.toMatch(
      /out\s+(?:IEntitySource|IEntity|ParticleEffectEntity|Particles|BaseContainer|WorldEditorAPI|BaseWorld)\b/,
    );
  });

  it("float values never travel through a request field", () => {
    const req = /class EMCP_WB_ParticleRequest[\s\S]*?\n}\r?\n/.exec(c)![0];
    expect(req).not.toMatch(/\bfloat\b/);
    for (const k of ["seconds", "minFps", "value", "coords"]) expect(req).toContain(`string ${k};`);
    for (const k of ["time", "value", "original", "before", "after"]) {
      const resp = /class EMCP_WB_ParticleResponse[\s\S]*?\n}\r?\n/.exec(c)![0];
      expect(resp).toContain(`string ${k};`);
    }
  });

  it("every float the request carries is parsed with the EMCP_WB_Common parsers", () => {
    expect(method(src, "SimulateEffect")).toContain("EMCP_WB_Common.ParseFloat(req.seconds,");
    expect(method(src, "SimulateEffect")).toContain("EMCP_WB_Common.ParseFloat(req.minFps,");
    expect(method(src, "WriteParam")).toContain("EMCP_WB_Common.ParseFloat(req.value,");
    expect(method(src, "Spawn")).toContain("EMCP_WB_Common.ParseVectorString(req.coords,");
  });

  it("every code the handler answers is in the vocabulary or among W5's new codes", () => {
    const known = new Set([...Object.keys(ERROR_CODES), ...W5_CODES]);
    const consts = [...c.matchAll(/static const string ([A-Z_]+) = "([A-Z_]+)";/g)];
    const codeConsts = consts.filter((m) => m[1] === m[2]).map((m) => m[2]);
    expect(codeConsts.length).toBeGreaterThan(5);
    for (const k of codeConsts) expect(known.has(k), k).toBe(true);
    for (const lit of ["MODULE_NOT_OPEN"]) expect(known.has(lit), lit).toBe(true);
  });
});

describe("no banned call and no Particle Editor", () => {
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
      "GetAbsolutePath",
    ]) {
      expect(c, banned).not.toContain(banned);
    }
  });

  it("never opens or reads the Particle Editor and never calls SpawnParticleEffect (DEC-042, DEC-068)", () => {
    for (const banned of [
      "ParticleEditor",
      "SpawnParticleEffect",
      "OpenResource",
      "SetOpenedResource",
      "EMCP_WB_OpenResource",
      "CreateEntityInWindowEx",
    ]) {
      expect(c, banned).not.toContain(banned);
    }
    const modules = [...c.matchAll(/Workbench\.GetModule\((\w+)\)/g)].map((m) => m[1]);
    expect(new Set(modules)).toEqual(new Set(["WorldEditor"]));
  });

  it("no ternary operator", () => {
    expect(c.replace(/"(?:[^"\\]|\\.)*"/g, '""')).not.toMatch(/\?[^?]*:/);
  });

  it("no reserved name", () => {
    expect(c).not.toMatch(/\b(?:Wait|vanilla)\b/);
  });
});

describe("guards", () => {
  it("project+world: the project, the world check, the modes, then the project's world prefix", () => {
    inOrder(
      method(src, "ProjectWorldApi"),
      [
        "EMCP_WB_Guard.ProjectId()",
        "WorldApi(resp)",
        "api.GetWorldPath(worldPath)",
        '"$" + projectId + ":"',
      ],
      "ProjectWorldApi",
    );
    inOrder(
      method(src, "WorldApi"),
      [
        "Workbench.GetModule(WorldEditor)",
        "EMCP_WB_Common.NoWorldReason(worldEditor, api)",
        "worldEditor.IsPrefabEditMode()",
        "api.IsGameMode()",
      ],
      "WorldApi",
    );
  });

  it("spawn and remove take the project+world guard; the others the world guard", () => {
    for (const a of ACTIONS) {
      const body = method(src, METHODS[a]);
      if (PROJECT_ACTIONS.includes(a)) {
        expect(body, a).toContain("ProjectWorldApi(resp)");
      } else {
        expect(body, a).toContain("WorldApi(resp)");
        expect(body, a).not.toContain("ProjectWorldApi");
      }
    }
  });

  it("spawn: guard, resolve, dry run, then the drop-plugin sequence in one entity action", () => {
    inOrder(
      method(src, "Spawn"),
      [
        "ProjectWorldApi(resp)",
        "EffectNameOf(req.effect, code, why)",
        "if (!req.confirm)",
        "resp.dryRun = true;",
        "api.BeginEntityAction(UNDO_SPAWN)",
        "api.GetCurrentEntityLayerId()",
        "api.CreateEntity(EFFECT_CLASS, req.name, layerId, null, pos, vector.Zero)",
        "api.SetVariableValue(created, null, EFFECT_KEY, effectName)",
      ],
      "Spawn",
    );
    // Every path after a true BeginEntityAction closes it: create failed, path not set, success.
    const body = method(src, "Spawn");
    const afterBegin = body.slice(body.indexOf("api.BeginEntityAction(UNDO_SPAWN)"));
    expect((afterBegin.match(/api\.EndEntityAction\(\);/g) ?? []).length).toBe(3);
    expect(afterBegin.lastIndexOf("api.EndEntityAction();")).toBeGreaterThan(
      afterBegin.indexOf("api.SetVariableValue(created, null, EFFECT_KEY, effectName)"),
    );
    expect(afterBegin).toContain("api.DeleteEntity(created);");
    expect(c).toContain('EFFECT_CLASS = "ParticleEffectEntity"');
    expect(c).toContain('EFFECT_KEY = "EffectPath"');
  });

  it("remove: guard, a particle effect only, dry run, then DeleteEntity in one entity action", () => {
    inOrder(
      method(src, "Remove"),
      [
        "ProjectWorldApi(resp)",
        "ResolveEffect(api, req.entity, resp, target)",
        "if (!req.confirm)",
        "api.BeginEntityAction(UNDO_REMOVE)",
        "api.DeleteEntity(src)",
        "api.EndEntityAction()",
      ],
      "Remove",
    );
    expect(method(src, "ResolveEffect")).toContain("ParticleEffectEntity.Cast(ent)");
    // The resolved source is null-checked before Format, SourceToEntity and GetClassName use it.
    expect(method(src, "ResolveEffect").indexOf("if (!src)")).toBeLessThan(
      method(src, "ResolveEffect").indexOf("EMCP_WB_EntityRef.Format(src)"),
    );
    expect(method(src, "ResolveEffect")).toContain("if (!src)");
  });

  it("every EndEntityAction pairs with a BeginEntityAction that returned true", () => {
    for (const m of ["Spawn", "Remove"]) {
      const body = method(src, m);
      expect(body, m).toMatch(/if \(!api\.BeginEntityAction\(UNDO_\w+\)\)\s*\{[\s\S]*?return;/);
    }
    expect((c.match(/BeginEntityAction\(/g) ?? []).length).toBe(2);
  });

  it("an effect resolves by GetResourceName and a packed one by its GUID, never by a file path", () => {
    inOrder(
      method(src, "EffectNameOf"),
      [
        "EMCP_WB_Guard.CleanRelative(pathPart, clean, cleanWhy)",
        "Workbench.GetResourceName(effectInput)",
        "Workbench.GetResourceName(braced)",
        'lower.EndsWith(".ptc")',
      ],
      "EffectNameOf",
    );
  });
});

describe("runtime calls (spec section 2.2)", () => {
  it("stats reads the effect and its Particles", () => {
    inOrder(
      method(src, "Stats"),
      [
        "ResolveEffect(api, req.entity, resp, target)",
        "effect.HasActiveParticles()",
        "effect.GetTotalSimulationTime()",
        "ParticlesOf(effect, resp)",
        "particles.GetNumEmitters()",
        "particles.GetNumParticles()",
        "particles.GetEmitterNames(names)",
      ],
      "Stats",
    );
    expect(method(src, "StateName")).toContain(
      "typename.EnumToString(EParticleEffectState, effect.GetState())",
    );
  });

  it("control validates the op before any engine call and maps each op to its call", () => {
    const body = method(src, "Control");
    expect(body.indexOf('"restart"')).toBeLessThan(body.indexOf("WorldApi(resp)"));
    for (const call of [
      "effect.Play()",
      "effect.Stop()",
      "effect.Pause()",
      "effect.StopEmission()",
      "particles.Restart(false)",
    ])
      expect(body, call).toContain(call);
  });

  it("simulate caps seconds at 60 before the call and uses SimulateMultiStep only with minFps", () => {
    expect(c).toContain("static const float MAX_SECONDS = 60;");
    inOrder(
      method(src, "SimulateEffect"),
      [
        "duration > MAX_SECONDS",
        "WorldApi(resp)",
        "particles.SimulateMultiStep(duration, stepsPerSecond)",
        "particles.Simulate(duration)",
      ],
      "SimulateEffect",
    );
  });

  it("params are resolved by name through typename.StringToEnum, float params only", () => {
    const body = method(src, "ParamOf");
    inOrder(
      body,
      ["FLOAT_PARAMS.Contains(", "typename.StringToEnum(EmitterParam, paramName)"],
      "ParamOf",
    );
    const floats = /FLOAT_PARAMS = "\|([A-Z_|]+)\|"/.exec(c)![1].split("|");
    expect(floats).toHaveLength(23);
    for (const nonFloat of [
      "SHAPE_SIZE",
      "CONEANGLE",
      "EMITOFFSET",
      "RANDOM_ANGLE",
      "REPEAT",
      "ACTIVE_PARTICLES",
      "WIND",
    ])
      expect(floats, nonFloat).not.toContain(nonFloat);
  });

  it("setParam refuses CURRENT_TIME, checks the emitter range, and uses SetParam or MultParam", () => {
    inOrder(
      method(src, "WriteParam"),
      [
        "ParamOf(req.param, why)",
        "req.param == READ_ONLY_PARAM",
        "WorldApi(resp)",
        "EmitterOk(particles, req.emitter, true, resp)",
        "EMCP_WB_ParticleParamRead.ReadFloat(",
        "particles.MultParam(req.emitter, which, amount)",
        "particles.SetParam(req.emitter, which, amount)",
      ],
      "WriteParam",
    );
    expect(method(src, "ReadParam")).toContain("EmitterOk(particles, req.emitter, false, resp)");
  });
});

describe("P-W5-08 isolation", () => {
  it("GetParam and GetParamOrig are called only inside EMCP_WB_ParticleParamRead.ReadFloat", () => {
    const reader = method(src, "ReadFloat");
    const outside = c.replace(reader, "");
    expect(reader).toContain("particles.GetParam(emitterIdx, which, readValue)");
    expect(reader).toContain("particles.GetParamOrig(emitterIdx, which, readValue)");
    expect(outside).not.toMatch(/\.GetParam(?:Orig)?\(/);
    expect(reader).toMatch(/float readValue = 0;/);
  });

  it("each probe call sits alone in its own block, so a kill deletes two lines", () => {
    const marked = src.split(/\r?\n/).filter((l) => l.includes("// P-W5-08"));
    expect(marked).toHaveLength(2);
    expect(src).toMatch(/\{\r?\n\t+particles\.GetParamOrig\([^\n]*\/\/ P-W5-08\r?\n\t+\}/);
    expect(src).toMatch(/\{\r?\n\t+particles\.GetParam\([^\n]*\/\/ P-W5-08\r?\n\t+\}/);
  });

  it("the PARAM_READ switch makes param refuse UNPROVEN and setParam answer without a readback", () => {
    expect(c).toContain("static const bool PARAM_READ = true;");
    inOrder(
      method(src, "ReadParam"),
      ["EMCP_WB_ParticleParamRead.PARAM_READ", "UNPROVEN"],
      "ReadParam",
    );
    inOrder(method(src, "WriteParam"), ["bool readable =", "if (!readable)"], "WriteParam");
  });
});

// Census rows this file tests (W5 close-out, EV-W5-081).
// census:mcp:handler-action/EMCP_WB_Particle.control
// census:mcp:handler-action/EMCP_WB_Particle.param
// census:mcp:handler-action/EMCP_WB_Particle.remove
// census:mcp:handler-action/EMCP_WB_Particle.setParam
// census:mcp:handler-action/EMCP_WB_Particle.spawn
// census:mcp:handler-action/EMCP_WB_Particle.stats

// Ledger rows this file covers through its dispatch test ("dispatches every contract action"):
// census:mcp:handler-action/EMCP_WB_Particle.simulate
