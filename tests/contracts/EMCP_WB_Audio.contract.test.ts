/**
 * The W5 Audio handler (EMCP_WB_Audio.c) checked over its Enforce text offline
 * (phase5-w5-spec.md section 2.1, DEC-068): the contract matches the structs and the dispatch, the
 * world guard comes before every World Editor call, floats travel as text, the engine calls are the
 * spec's (and the calls the spec leaves out are absent), open is gated on P-W5-12, and no banned call
 * is made. Nothing here talks to Workbench.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadContract, regVKeys } from "../../src/manifest/contract.js";
import { buildDescription } from "../../src/manifest/generate.js";
import { actionFindings, denyFindings } from "../../scripts/enforce-lint.js";
import { ERROR_CODES } from "../../src/manifest/vocabulary.js";

const DIR = join("mod", "Scripts", "WorkbenchGame", "EnfusionMCP");
const FILE = join(DIR, "EMCP_WB_Audio.c");
const LINT_PATH = FILE.replace(/\\/g, "/");
const src = readFileSync(FILE, "utf-8");
const contract = loadContract(join("contracts", "EMCP_WB_Audio.json"));

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

/** Spec 2.1 actions with their handler method. */
const METHODS: Record<string, string> = {
  play: "DoPlay",
  playSound: "DoPlaySound",
  isPlaying: "DoIsPlaying",
  stop: "DoStop",
  audible: "DoAudible",
  variable: "DoVariable",
  setVariable: "DoSetVariable",
  resetVariables: "DoResetVariables",
  masters: "DoMasters",
  setMaster: "DoSetMaster",
  pause: "DoPause",
  outputStates: "DoOutputStates",
  entityEvents: "DoEntityEvents",
  entityPlay: "DoEntityPlay",
  setSignal: "DoSetSignal",
  soundMap: "DoSoundMap",
  open: "DoOpen",
};
/** Spec 2.1 Mut column. */
const MUTATING = [
  "play",
  "playSound",
  "stop",
  "setVariable",
  "resetVariables",
  "setMaster",
  "pause",
  "entityPlay",
  "setSignal",
  "open",
];
/** Spec 2.1 Guard column "world", less the AudioSystem actions fix-up 1 moved to play mode. */
const WORLD = ["entityEvents", "entityPlay", "setSignal", "soundMap"];
/**
 * Fix-up 1 (probe P-W5-06 KILLED in W5 run 1, its repoint): the AudioSystem actions take the
 * play-mode guard. stop is not guarded (it must always be sendable).
 */
const PLAY = [
  "play",
  "playSound",
  "isPlaying",
  "audible",
  "variable",
  "setVariable",
  "resetVariables",
  "masters",
  "setMaster",
  "pause",
  "outputStates",
];
/** The 14 codes W5 adds to vocabulary.ts (spec 1.3); the integrator lands them. */
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

describe("EMCP_WB_Audio structs and contract", () => {
  it("request and response RegV keys are the contract's", () => {
    expect(regVKeys(src, "EMCP_WB_AudioRequest")).toEqual(contract.request);
    expect(regVKeys(src, "EMCP_WB_AudioResponse")).toEqual(contract.response);
  });

  it("the per-action linter check finds nothing", () => {
    expect(actionFindings({ path: LINT_PATH, text: src }, contract)).toEqual([]);
  });

  it("dispatches the spec's 17 actions and nothing else", () => {
    const branches = [...c.matchAll(/req\.action == "([A-Za-z]+)"/g)].map((m) => m[1]);
    expect(branches.sort()).toEqual(contract.actions.map((a) => a.name).sort());
    expect(contract.actions.map((a) => a.name).sort()).toEqual(Object.keys(METHODS).sort());
    for (const [action, m] of Object.entries(METHODS))
      expect(c, action).toMatch(
        new RegExp(`req\\.action == "${action}"\\)\\s*${m}\\(req, resp\\);`),
      );
  });

  it("mutating flags follow the spec; only open is project-only and takes confirm", () => {
    for (const a of contract.actions) {
      expect(a.mutating, a.name).toBe(MUTATING.includes(a.name));
      expect(a.projectOnly, a.name).toBe(a.name === "open");
      expect(
        a.params.some((p) => p.key === "confirm"),
        a.name,
      ).toBe(a.name === "open");
      expect(a.paging, a.name).toBe(false);
    }
  });

  it("the event key is eventName: event is an Enforce keyword (lint SUSPECT_NAMES)", () => {
    expect(contract.request).toContain("eventName");
    expect(contract.request).not.toContain("event");
    expect(c).not.toMatch(/\bstring event;/);
  });

  it("the tool description stays within 400 characters", () => {
    expect(buildDescription(contract).length).toBeLessThanOrEqual(400);
  });

  it("no out parameter carries an engine pointer (W1 compile lesson)", () => {
    expect(c).not.toMatch(
      /out\s+(?:IEntity|IEntitySource|BaseContainer|WorldEditorAPI|BaseWorld|ChimeraWorld|SoundWorld|BaseSoundComponent|SignalsManagerComponent|WBModuleDef)\b/,
    );
  });

  it("float values never travel through a request field; every float key is a string", () => {
    const req = /class EMCP_WB_AudioRequest[\s\S]*?\n}\r?\n/.exec(c)![0];
    expect(req).not.toMatch(/\bfloat\b/);
    const resp = /class EMCP_WB_AudioResponse[\s\S]*?\n}\r?\n/.exec(c)![0];
    expect(resp).not.toMatch(/\bfloat\b/);
    for (const a of contract.actions)
      for (const p of a.params)
        if (["value", "fadeTime", "position"].includes(p.key))
          expect(p.type, `${a.name}.${p.key}`).toBe("string");
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
      "RunCommandline",
      "RunCmd",
      "RunProcess",
      "Configure(",
      "FileIO",
      "EMCP2_sandbox",
      "_throwaway",
      "GetAbsolutePath",
      "SetOpenedResource",
      "ParticleEditor",
    ]) {
      expect(c, banned).not.toContain(banned);
    }
  });

  it("the calls spec 2.1 leaves out are never made", () => {
    for (const absent of [
      "AddOrFindSignal",
      "AddOrFindMPSignal",
      "SetBoundingVolumeParams",
      "CreateOutputState",
      "SetOutputStateSignal",
      "MusicProject",
      "GetMusicManager",
    ]) {
      expect(c, absent).not.toContain(absent);
    }
  });

  it("no ternary operator", () => {
    expect(c.replace(/"(?:[^"\\]|\\.)*"/g, '""')).not.toMatch(/\?[^?]*:/);
  });
});

describe("engine calls (spec 2.1 Engine calls column)", () => {
  const calls: Record<string, string[]> = {
    DoPlay: [
      "AudioSystem.PlayEventInitialize(resourceName)",
      "Math3D.MatrixIdentity4(transf)",
      "AudioSystem.PlayEvent(resourceName, req.eventName, transf, sigNames, sigValues)",
      "AudioSystem.IsSoundPlayed(played)",
    ],
    DoPlaySound: ["AudioSystem.PlaySound(resourceName)", "AudioSystem.IsSoundPlayed(played)"],
    DoIsPlaying: ["AudioSystem.IsSoundPlayed(asked)"],
    DoStop: [
      "AudioSystem.IsSoundPlayed(asked)",
      "AudioSystem.TerminateSoundFadeOut(asked, true, fadeSeconds)",
      "AudioSystem.TerminateSound(asked)",
    ],
    DoAudible: [
      "AudioSystem.IsAudible(resourceName, req.eventName, pos)",
      "AudioSystem.GetDistance(pos)",
    ],
    DoVariable: [
      "AudioSystem.GetVariableIDByName(req.name, resourceName)",
      "AudioSystem.GetVariableValue(req.name, resourceName)",
    ],
    DoSetVariable: [
      "AudioSystem.GetVariableIDByName(req.name, resourceName)",
      "AudioSystem.GetVariableValue(req.name, resourceName)",
      "AudioSystem.SetVariableByName(req.name, wanted, resourceName)",
    ],
    DoResetVariables: ["AudioSystem.ResetVariables()"],
    DoMasters: ["AudioSystem.OutputVolume()", "AudioSystem.GetMasterVolume(masterId)"],
    DoSetMaster: [
      "AudioSystem.GetMasterVolume(masterId)",
      "AudioSystem.SetMasterVolume(masterId, wanted)",
    ],
    DoPause: ["AudioSystem.Resume(mask)", "AudioSystem.Pause(mask)"],
    DoOutputStates: [
      "AudioSystem.GetOutputStateCount()",
      "AudioSystem.GetOutputStateIdx(resourceName)",
      "AudioSystem.GetOutpuStateSignalIdx(stateIdx, req.name)",
    ],
    DoEntityEvents: ["sound.GetEvents(eventNames)", "sound.GetSignalNames(signalNames)"],
    DoEntityPlay: [
      "sound.GetEvents(eventNames)",
      "sound.PlayStr(req.eventName)",
      "sound.IsPlaying()",
    ],
    DoSetSignal: [
      "SignalsManagerComponent.Cast(ent.FindComponent(SignalsManagerComponent))",
      "signalsManager.FindSignal(req.name)",
      "signalsManager.GetSignalValue(signalIdx)",
      "signalsManager.SetSignalValue(signalIdx, wanted)",
    ],
    DoSoundMap: [
      "ChimeraWorld.CastFrom(api.GetWorld())",
      "chimeraWorld.GetSoundWorld()",
      "soundWorld.GetMapValuesAtPos(pos, sea, forest, city, meadow)",
      "soundWorld.GetMapValuesAdvAtPos(pos, river, riverSlope, lake, coast)",
    ],
    DoOpen: ["Workbench.OpenResource(absolute)"],
  };

  it("each action makes the spec's calls", () => {
    for (const [m, list] of Object.entries(calls)) {
      const body = method(src, m);
      for (const call of list) expect(body, `${m}: ${call}`).toContain(call);
    }
  });

  it("entity actions resolve by EMCP_WB_EntityRef and reach the live entity by SourceToEntity", () => {
    inOrder(
      method(src, "EntityOf"),
      [
        "new EMCP_WB_EntityRefResult()",
        "EMCP_WB_EntityRef.Resolve(api, entityRef, resolved)",
        "EMCP_WB_EntityRef.Format(src)",
        "api.SourceToEntity(src)",
      ],
      "EntityOf",
    );
    expect(method(src, "SoundOf")).toContain(
      "BaseSoundComponent.Cast(ent.FindComponent(BaseSoundComponent))",
    );
    // Fix-up 1: the game's SoundComponent family derives from SndComponent, not BaseSoundComponent.
    expect(method(src, "SndOf")).toContain("SndComponent.Cast(ent.FindComponent(SndComponent))");
    expect(method(src, "NoSound")).toContain('"NO_SOUND_COMPONENT"');
    inOrder(
      method(src, "DoEntityEvents"),
      [
        "EMCP_WB_AudioUtil.SoundOf(ent)",
        "EMCP_WB_AudioUtil.SndOf(ent)",
        "EMCP_WB_AudioUtil.NoSound(resp)",
        "sndEvents.GetSignalNames(sndSignalNames)",
        "sound.GetEvents(eventNames)",
      ],
      "DoEntityEvents",
    );
    inOrder(
      method(src, "DoEntityPlay"),
      [
        "EMCP_WB_AudioUtil.SoundOf(ent)",
        "EMCP_WB_AudioUtil.SndOf(ent)",
        "EMCP_WB_AudioUtil.NoSound(resp)",
        "sndPlay.PlayStr(req.eventName)",
        "sndPlay.IsPlaying()",
        "sound.GetEvents(eventNames)",
        "sound.PlayStr(req.eventName)",
      ],
      "DoEntityPlay",
    );
    for (const m of ["DoEntityEvents", "DoEntityPlay", "DoSetSignal"])
      expect(method(src, m), m).toContain("EMCP_WB_AudioUtil.EntityOf(api, req.entity, resp)");
  });

  it("pause builds its mask as (1 << id), the engine's documented form", () => {
    expect(method(src, "DoPause")).toContain("mask = mask | (1 << masterId);");
    inOrder(
      method(src, "MasterId"),
      [
        "AudioSystem.SFX",
        "AudioSystem.Music",
        "AudioSystem.VoiceChat",
        "AudioSystem.Dialog",
        "AudioSystem.UI",
      ],
      "MasterId",
    );
  });

  it("a resource resolves through Workbench.GetResourceName ({GUID} alone for a packed file)", () => {
    inOrder(
      method(src, "ResourceOf"),
      [
        'input.IndexOf("}") != 17',
        "Workbench.GetResourceName(braced)",
        '"RESOURCE_NOT_FOUND"',
        "EMCP_WB_Guard.CleanRelative(input, clean, why)",
        "Workbench.GetResourceName(clean)",
        "EndsWithAny(lower, exts)",
      ],
      "ResourceOf",
    );
    expect(method(src, "DoPlay")).toContain(
      "ResourceOf(req.resource, EMCP_WB_AudioUtil.ACP_EXT, resp)",
    );
    expect(method(src, "DoAudible")).toContain(
      "ResourceOf(req.resource, EMCP_WB_AudioUtil.ACP_EXT, resp)",
    );
    expect(method(src, "DoPlaySound")).toContain(
      "ResourceOf(req.resource, EMCP_WB_AudioUtil.SAMPLE_EXTS, resp)",
    );
    for (const m of ["DoVariable", "DoSetVariable"])
      expect(method(src, m), m).toContain(
        "ResourceOf(req.resource, EMCP_WB_AudioUtil.CONF_EXT, resp)",
      );
    expect(method(src, "DoOutputStates")).toContain(
      "ResourceOf(req.resource, EMCP_WB_AudioUtil.MIXER_EXT, resp)",
    );
  });
});

describe("guards", () => {
  it("the world guard: GetModule, NoWorldReason, prefab edit mode, play mode, in that order", () => {
    const body = method(src, "WorldApi");
    inOrder(
      body,
      [
        "Workbench.GetModule(WorldEditor)",
        "worldEditor.GetApi()",
        "EMCP_WB_Common.NoWorldReason(worldEditor, api)",
        "worldEditor.IsPrefabEditMode()",
        "api.IsGameMode()",
      ],
      "WorldApi",
    );
    expect(body).toContain("GetModule may have opened the World Editor");
    expect((body.match(/"WRONG_MODE"/g) ?? []).length).toBe(2);
  });

  it("the play-mode guard (fix-up 1): GetModule, GetApi, IsGameMode, else WRONG_MODE naming P-W5-06", () => {
    const body = method(src, "PlayApi");
    inOrder(
      body,
      ["Workbench.GetModule(WorldEditor)", "worldEditor.GetApi()", "!api.IsGameMode()", '"WRONG_MODE"'],
      "PlayApi",
    );
    expect(body).toContain("P-W5-06");
    expect(body).toContain("NEXT_PLAY");
    expect(src).toContain('static const string NEXT_PLAY = "wb_world play');
  });

  it("world actions take the world guard, AudioSystem actions the play-mode guard, before any engine call; stop and open neither", () => {
    const engineRe =
      /AudioSystem\.|Math3D\.|ChimeraWorld\.|sound\.|sndEvents\.|sndPlay\.|signalsManager\.|EntityOf\(|PositionOf\(/;
    for (const [action, m] of Object.entries(METHODS)) {
      const body = method(src, m);
      if (WORLD.includes(action) || PLAY.includes(action)) {
        const guardCall = WORLD.includes(action)
          ? "EMCP_WB_AudioUtil.WorldApi(resp)"
          : "EMCP_WB_AudioUtil.PlayApi(resp)";
        const other = WORLD.includes(action) ? "PlayApi" : "WorldApi";
        const guard = body.indexOf(guardCall);
        expect(guard, action).toBeGreaterThanOrEqual(0);
        expect(body, action).not.toContain(other);
        const engine = body.search(engineRe);
        expect(guard, action).toBeLessThan(engine);
      } else {
        expect(body, action).not.toContain("WorldApi");
        expect(body, action).not.toContain("PlayApi");
        expect(body, action).not.toContain("GetModule");
      }
    }
    expect([...WORLD, ...PLAY, "stop", "open"].sort()).toEqual(Object.keys(METHODS).sort());
  });

  it("floats and vectors are parsed with the EMCP_WB_Common parsers before the engine call", () => {
    expect(method(src, "FloatOf")).toContain("EMCP_WB_Common.ParseFloat(text, result)");
    expect(method(src, "PositionOf")).toContain("EMCP_WB_Common.ParseVectorString(text, pos, why)");
    expect(method(src, "PositionOf")).toContain("world.GetCurrentCamera(cam)");
    const first: Record<string, [string, string]> = {
      DoSetVariable: ['FloatOf(req.value, "value", wanted, resp)', "AudioSystem."],
      DoSetMaster: ['FloatOf(req.value, "value", wanted, resp)', "AudioSystem."],
      DoSetSignal: ['FloatOf(req.value, "value", wanted, resp)', "WorldApi(resp)"],
      DoStop: ['FloatOf(req.fadeTime, "fadeTime", fadeSeconds, resp)', "AudioSystem."],
      DoPlay: ["ParseSignals(req.signals, sigNames, sigValues, resp)", "AudioSystem."],
    };
    for (const [m, [parse, engine]] of Object.entries(first)) {
      const body = method(src, m);
      expect(body.indexOf(parse), m).toBeGreaterThanOrEqual(0);
      expect(body.indexOf(parse), m).toBeLessThan(body.indexOf(engine));
    }
    expect(method(src, "ParseSignals")).toContain("FloatOf(sigText,");
  });

  it("setSignal never creates a signal: an unknown name answers index -1 and sets nothing", () => {
    const body = method(src, "DoSetSignal");
    inOrder(
      body,
      [
        "signalsManager.FindSignal(req.name)",
        "resp.index = signalIdx;",
        "if (signalIdx < 0)",
        "signalsManager.SetSignalValue(signalIdx, wanted)",
      ],
      "DoSetSignal",
    );
    expect(body).toMatch(
      /if \(signalIdx < 0\)\s*\{\s*resp\.status = "ok";\s*resp\.message = "warning: [^\n]*\n\s*return;\s*\}/,
    );
  });

  it("setMaster refuses a value outside 0 to max(1, current) before SetMasterVolume", () => {
    inOrder(
      method(src, "DoSetMaster"),
      [
        "AudioSystem.GetMasterVolume(masterId)",
        "if (current > upper)",
        "if (wanted < 0 || wanted > upper)",
        "AudioSystem.SetMasterVolume(masterId, wanted)",
      ],
      "DoSetMaster",
    );
  });

  it("open: project file, Audio Editor owner, dry run unless confirm, then GATED until P-W5-12", () => {
    expect(src).toContain("static const bool OPEN_PROVEN = false;");
    expect(src).toContain('static const string OPEN_PROBE = "P-W5-12";');
    inOrder(
      method(src, "DoOpen"),
      [
        "EMCP_WB_Guard.CleanRelative(req.path, clean, why)",
        "EMCP_WB_Guard.TargetExistsInProject(clean, absolute, why)",
        "EMCP_WB_OpenResource.OwnerOf(clean)",
        "if (owner != EMCP_WB_AudioUtil.AUDIO_EDITOR)",
        '"WRONG_MODULE"',
        "if (!req.confirm)",
        "resp.dryRun = true;",
        "resp.dryRun = false;",
        "if (!EMCP_WB_AudioUtil.OPEN_PROVEN)\n\t\t{",
        '"GATED"',
        "Workbench.OpenResource(absolute)",
      ],
      "DoOpen",
    );
    const body = method(src, "DoOpen");
    expect(body).toMatch(/if \(!req\.confirm\)\s*\{[^}]*resp\.dryRun = true;[\s\S]*?return;\s*\}/);
    expect(body).toMatch(
      /if \(!EMCP_WB_AudioUtil\.OPEN_PROVEN\)\s*\{\s*EMCP_WB_AudioUtil\.Refuse\(resp, "GATED",[^\n]*\n\s*return;\s*\}/,
    );
    expect(src).toContain('static const string AUDIO_EDITOR = "AudioEditor";');
  });
});

describe("refusals", () => {
  it("Refuse uses the guard's status and message form with next set", () => {
    const body = method(src, "Refuse");
    expect(body).toContain("resp.status = EMCP_WB_Guard.REFUSED;");
    expect(body).toContain("resp.next = nextStep;");
    expect(body).toContain("EMCP_WB_Guard.RefusalMessage(code,");
  });

  it("every literal refusal code is in the vocabulary or among the 14 W5 codes", () => {
    const known = new Set([...Object.keys(ERROR_CODES), ...W5_CODES]);
    const codes = [
      ...c.matchAll(/(?:Refuse\(resp, |resp\.code = |RefusalMessage\()"([A-Z_]+)"/g),
    ].map((m) => m[1]);
    for (const k of codes) expect(known.has(k), k).toBe(true);
    for (const k of [
      "INVALID_ARGUMENT",
      "MODULE_NOT_OPEN",
      "NO_WORLD",
      "WRONG_MODE",
      "RESOURCE_NOT_FOUND",
      "ENTITY_NOT_FOUND",
      "ENGINE_FALSE",
      "GATED",
      "PLAY_FAILED",
      "VARIABLE_NOT_FOUND",
      "NO_SOUND_COMPONENT",
      "EVENT_NOT_FOUND",
      "NO_SIGNALS_MANAGER",
      "NO_SOUND_WORLD",
      "WRONG_MODULE",
    ])
      expect(codes, k).toContain(k);
  });

  it("each code a contract refuses line names is one the handler can answer", () => {
    const known = new Set([...Object.keys(ERROR_CODES), ...W5_CODES]);
    for (const a of contract.actions) {
      for (const m of (a.refuses ?? "").matchAll(/\b[A-Z][A-Z_]{3,}\b/g)) {
        expect(known.has(m[0]), `${a.name}: ${m[0]}`).toBe(true);
      }
    }
  });
});

// Census rows this file tests (W5 close-out, EV-W5-081).
// census:mcp:handler-action/EMCP_WB_Audio.audible
// census:mcp:handler-action/EMCP_WB_Audio.isPlaying
// census:mcp:handler-action/EMCP_WB_Audio.masters
// census:mcp:handler-action/EMCP_WB_Audio.outputStates
// census:mcp:handler-action/EMCP_WB_Audio.play
// census:mcp:handler-action/EMCP_WB_Audio.playSound
// census:mcp:handler-action/EMCP_WB_Audio.setMaster
// census:mcp:handler-action/EMCP_WB_Audio.setVariable
// census:mcp:handler-action/EMCP_WB_Audio.stop
// census:mcp:handler-action/EMCP_WB_Audio.variable

// Ledger rows this file covers through its dispatch test ("dispatches every contract action"):
// census:mcp:handler-action/EMCP_WB_Audio.entityEvents
// census:mcp:handler-action/EMCP_WB_Audio.entityPlay
// census:mcp:handler-action/EMCP_WB_Audio.open
// census:mcp:handler-action/EMCP_WB_Audio.pause
// census:mcp:handler-action/EMCP_WB_Audio.resetVariables
// census:mcp:handler-action/EMCP_WB_Audio.setSignal
// census:mcp:handler-action/EMCP_WB_Audio.soundMap
