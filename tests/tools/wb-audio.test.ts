import { ERROR_CODES } from "../../src/manifest/vocabulary.js";
import { describe, expect, it } from "vitest";
import { WorkbenchError } from "../../src/workbench/client.js";
import type { WorkbenchClient, WorkbenchCallOptions } from "../../src/workbench/client.js";
import { DESCRIPTION_MAX } from "../../src/manifest/generate.js";
import {
  AUDIO_CONTRACT,
  AUDIO_OPEN_PROVEN,
  HANDLER,
  HANDLER_ACTIONS,
  PLAY_MODE_ACTIONS,
  checkResource,
  flatInputShape,
  floatText,
  parseKeyed,
  positionText,
  prepareRequest,
  registerWbAudio,
  runAudio,
  signalList,
  wbAudioDescription,
} from "../../src/tools/wb-audio.js";
import { captureTool, textOf } from "./_tool-harness.js";

interface Sent {
  fn: string;
  params: Record<string, unknown>;
  options: WorkbenchCallOptions;
}

/** A client whose call() answers from a function and records what was sent. */
function fakeClient(
  answer: (p: Record<string, unknown>, n: number) => Record<string, unknown> | Error,
): { client: WorkbenchClient; sent: Sent[] } {
  const sent: Sent[] = [];
  const client = {
    call: async (fn: string, params: Record<string, unknown>, options: WorkbenchCallOptions) => {
      sent.push({ fn, params, options });
      const a = answer(params, sent.length - 1);
      if (a instanceof Error) throw a;
      return a;
    },
  } as unknown as WorkbenchClient;
  return { client, sent };
}

const ok = (extra: Record<string, unknown> = {}) => ({ status: "ok", code: "", ...extra });
const refused = (code: string, message = "no", next = "fix it") => ({
  status: "refused",
  code,
  message,
  next,
});

const ACP = "Sounds/Rifle.acp";
const GUID_ACP = "{0123456789ABCDEF}Sounds/Rifle.acp";
const CONF = "Sounds/Vars.conf";

describe("wb_audio contract", () => {
  it("names the 17 handler actions", () => {
    expect(AUDIO_CONTRACT.tool).toBe("wb_audio");
    expect(HANDLER).toBe("EMCP_WB_Audio");
    expect([...HANDLER_ACTIONS].sort()).toEqual(
      [
        "play",
        "playSound",
        "isPlaying",
        "stop",
        "audible",
        "variable",
        "setVariable",
        "resetVariables",
        "masters",
        "setMaster",
        "pause",
        "outputStates",
        "entityEvents",
        "entityPlay",
        "setSignal",
        "soundMap",
        "open",
      ].sort(),
    );
  });

  it("its description is the spec 1.1 draft with the play-mode note of fix-up 1 (budget 400)", () => {
    const d = wbAudioDescription();
    expect(d.length).toBe(343);
    // open takes only what the Audio Editor owns (review W5-04): .afm is not opened here.
    expect(d).toContain("open a project .acp/.sig in the Audio Editor");
    expect(d).not.toContain(".sig/.afm");
    expect(d.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    expect(d).toContain("(these need wb_world play)");
    expect(d).toContain("Runtime only: nothing is saved.");
  });

  it("PLAY_MODE_ACTIONS: the AudioSystem actions, never stop or the entity and editor actions", () => {
    expect([...PLAY_MODE_ACTIONS].sort()).toEqual(
      [
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
      ].sort(),
    );
    for (const a of PLAY_MODE_ACTIONS) expect(HANDLER_ACTIONS, a).toContain(a);
    for (const a of ["stop", "entityEvents", "entityPlay", "setSignal", "soundMap", "open"])
      expect(PLAY_MODE_ACTIONS, a).not.toContain(a);
  });

  it("only open is project-only, and the reads are the six non-mutating actions", () => {
    const projectOnly = AUDIO_CONTRACT.actions.filter((a) => a.projectOnly).map((a) => a.name);
    expect(projectOnly).toEqual(["open"]);
    const reads = AUDIO_CONTRACT.actions.filter((a) => !a.mutating).map((a) => a.name);
    expect(reads.sort()).toEqual(
      [
        "audible",
        "entityEvents",
        "isPlaying",
        "masters",
        "outputStates",
        "soundMap",
        "variable",
      ].sort(),
    );
  });

  it("the flat input shape carries every request key of the contract", () => {
    const keys = Object.keys(flatInputShape());
    for (const k of AUDIO_CONTRACT.request) expect(keys).toContain(k);
  });

  it("open stays gated in this build", () => {
    expect(AUDIO_OPEN_PROVEN).toBe(false);
  });
});

describe("helpers", () => {
  it("checkResource keeps a GUID prefix and refuses absolute forms", () => {
    expect(checkResource(GUID_ACP)).toBe(GUID_ACP);
    expect(checkResource("Sounds\\Rifle.acp")).toBe("Sounds/Rifle.acp");
    expect(() => checkResource("C:/x/Rifle.acp")).toThrow(/absolute/);
    expect(() => checkResource("../Rifle.acp")).toThrow(/\.\./);
    expect(() => checkResource("  ")).toThrow(/empty/);
  });

  it("floatText sends plain decimal text and accepts number text (review W5-03)", () => {
    expect(floatText(0.5, "v")).toBe("0.5");
    expect(floatText(1e-7, "v")).toBe("0.0000001");
    expect(floatText("1e-7", "v")).toBe("0.0000001");
    expect(floatText(" 2.50 ", "v")).toBe("2.5");
    expect(floatText("-3", "v")).toBe("-3");
    expect(() => floatText("abc", "v")).toThrow(/number/);
    expect(() => floatText(Number.NaN, "v")).toThrow(/finite/);
    expect(() => floatText("", "v")).toThrow(/number/);
    expect(() => floatText(Infinity, "v")).toThrow(/finite/);
  });

  it("positionText takes a triple or text", () => {
    expect(positionText([1, 2.5, -3])).toBe("1 2.5 -3");
    expect(positionText("1 2 3")).toBe("1 2 3");
    expect(positionText("1, 2, 3")).toBe("1 2 3");
    expect(() => positionText([1, 2])).toThrow(/3 numbers/);
    expect(() => positionText("1 2 x")).toThrow(/position\[2\]/);
    expect(() => positionText(5)).toThrow(/position/);
  });

  it("signalList builds name=value from a list or an object", () => {
    expect(signalList(["Speed=0.5", "Wind = 2"])).toEqual(["Speed=0.5", "Wind=2"]);
    expect(signalList({ Speed: 0.5, Wind: "2" })).toEqual(["Speed=0.5", "Wind=2"]);
    expect(() => signalList(["Speed"])).toThrow(/name=value/);
    expect(() => signalList(["Speed=fast"])).toThrow(/signal 'Speed'/);
    expect(() => signalList(5)).toThrow(/list/);
    expect(() => signalList(Array.from({ length: 65 }, (_, i) => `S${i}=1`))).toThrow(/at most 64/);
  });

  it("parseKeyed turns floats into numbers and keeps other text", () => {
    expect(parseKeyed(["SFX=0.5", "Music=1", "odd=x", "bare"])).toEqual({
      SFX: 0.5,
      Music: 1,
      odd: "x",
      bare: "",
    });
  });
});

describe("prepareRequest refusals (nothing is sent)", () => {
  const cases: Array<[string, Record<string, unknown>, string, string]> = [
    ["unknown action", { action: "nope" }, "INVALID_ARGUMENT", "unknown action"],
    ["play without eventName", { action: "play", resource: ACP }, "INVALID_ARGUMENT", "eventName"],
    ["play without resource", { action: "play", eventName: "E" }, "INVALID_ARGUMENT", "resource"],
    [
      "play a wav",
      { action: "play", resource: "a.wav", eventName: "E" },
      "INVALID_ARGUMENT",
      ".acp",
    ],
    [
      "play absolute resource",
      { action: "play", resource: "C:/a/b.acp", eventName: "E" },
      "ABSOLUTE_PATH",
      "absolute",
    ],
    [
      "play empty eventName",
      { action: "play", resource: ACP, eventName: " " },
      "INVALID_ARGUMENT",
      "eventName is empty",
    ],
    [
      "play bad position",
      { action: "play", resource: ACP, eventName: "E", position: [1, 2] },
      "INVALID_ARGUMENT",
      "3 numbers",
    ],
    [
      "play bad signal",
      { action: "play", resource: ACP, eventName: "E", signals: ["Speed"] },
      "INVALID_ARGUMENT",
      "name=value",
    ],
    [
      "playSound an acp",
      { action: "playSound", resource: ACP },
      "INVALID_ARGUMENT",
      ".wav or .snd",
    ],
    ["isPlaying without handle", { action: "isPlaying" }, "INVALID_ARGUMENT", "handle"],
    [
      "isPlaying negative handle",
      { action: "isPlaying", handle: -1 },
      "INVALID_ARGUMENT",
      "handle",
    ],
    [
      "isPlaying fractional handle",
      { action: "isPlaying", handle: 1.5 },
      "INVALID_ARGUMENT",
      "handle",
    ],
    [
      "stop fade too long",
      { action: "stop", handle: 3, fadeTime: 61 },
      "INVALID_ARGUMENT",
      "0 to 60",
    ],
    [
      "stop fade negative",
      { action: "stop", handle: 3, fadeTime: -1 },
      "INVALID_ARGUMENT",
      "0 to 60",
    ],
    [
      "stop fade text",
      { action: "stop", handle: 3, fadeTime: "soon" },
      "INVALID_ARGUMENT",
      "fadeTime",
    ],
    [
      "audible without event",
      { action: "audible", resource: ACP },
      "INVALID_ARGUMENT",
      "eventName",
    ],
    [
      "variable a wav",
      { action: "variable", resource: "a.wav", name: "V" },
      "INVALID_ARGUMENT",
      ".conf",
    ],
    [
      "variable empty name",
      { action: "variable", resource: CONF, name: "" },
      "INVALID_ARGUMENT",
      "name is empty",
    ],
    [
      "setVariable not a float",
      { action: "setVariable", resource: CONF, name: "V", value: "high" },
      "INVALID_ARGUMENT",
      "value",
    ],
    [
      "setVariable without value",
      { action: "setVariable", resource: CONF, name: "V" },
      "INVALID_ARGUMENT",
      "value",
    ],
    [
      "resetVariables with a key",
      { action: "resetVariables", handle: 1 },
      "INVALID_ARGUMENT",
      "handle",
    ],
    [
      "setMaster unknown master",
      { action: "setMaster", master: "Bass", value: 1 },
      "INVALID_ARGUMENT",
      "master must be one of",
    ],
    [
      "setMaster negative",
      { action: "setMaster", master: "SFX", value: -0.1 },
      "INVALID_ARGUMENT",
      "0 or more",
    ],
    [
      "setMaster not a float",
      { action: "setMaster", master: "SFX", value: "x" },
      "INVALID_ARGUMENT",
      "value",
    ],
    ["pause empty list", { action: "pause", masters: [] }, "INVALID_ARGUMENT", "masters is empty"],
    [
      "pause unknown master",
      { action: "pause", masters: ["SFX", "Bass"] },
      "INVALID_ARGUMENT",
      "master must be one of",
    ],
    ["outputStates an acp", { action: "outputStates", resource: ACP }, "INVALID_ARGUMENT", ".afm"],
    [
      "outputStates name only",
      { action: "outputStates", name: "Sig" },
      "INVALID_ARGUMENT",
      "needs resource",
    ],
    ["entityEvents without entity", { action: "entityEvents" }, "INVALID_ARGUMENT", "entity"],
    [
      "entityEvents empty entity",
      { action: "entityEvents", entity: " " },
      "INVALID_ARGUMENT",
      "entity is empty",
    ],
    [
      "entityPlay without event",
      { action: "entityPlay", entity: "id:a" },
      "INVALID_ARGUMENT",
      "eventName",
    ],
    [
      "setSignal not a float",
      { action: "setSignal", entity: "id:a", name: "S", value: "z" },
      "INVALID_ARGUMENT",
      "value",
    ],
    [
      "soundMap bad position",
      { action: "soundMap", position: "a b c" },
      "INVALID_ARGUMENT",
      "position",
    ],
    ["open absolute", { action: "open", path: "C:/x/a.acp" }, "ABSOLUTE_PATH", "absolute"],
    ["open an ent", { action: "open", path: "Worlds/a.ent" }, "WRONG_MODULE", "WorldEditor"],
    ["open a conf", { action: "open", path: CONF }, "WRONG_MODULE", "ResourceManager"],
    ["open an afm", { action: "open", path: "Sounds/Mix.afm" }, "WRONG_MODULE", "ResourceManager"],
    [
      "open with a stray key",
      { action: "open", path: ACP, handle: 1 },
      "INVALID_ARGUMENT",
      "handle",
    ],
  ];
  for (const [name, input, code, text] of cases) {
    it(`${name}: ${code}`, () => {
      const p = prepareRequest(input);
      expect(p.ok).toBe(false);
      if (p.ok) return;
      expect(p.error.code).toBe(code);
      expect(p.error.message).toContain(text);
      expect(p.error.next.length).toBeGreaterThan(0);
      expect(p.error.ok).toBe(false);
    });
  }

  it("WRONG_MODULE is carried locally with its own default next", () => {
    expect(ERROR_CODES.WRONG_MODULE).toContain("never opened");
    const p = prepareRequest({ action: "open", path: "Worlds/a.ent" });
    expect(p.ok === false && p.error.next).toContain("wb_module setResource");
  });
});

describe("play", () => {
  it("sends text floats and a name=value signal list, access mutate", async () => {
    const { client, sent } = fakeClient(() =>
      ok({ action: "play", handle: 7, playing: 1, position: "1 2 3" }),
    );
    const r = await runAudio(client, {
      action: "play",
      resource: "Sounds\\Rifle.acp",
      eventName: "SOUND_FIRE",
      position: [1, 2, 3],
      signals: { Speed: 0.5, Wind: "2" },
    });
    expect(sent).toHaveLength(1);
    expect(sent[0].fn).toBe("EMCP_WB_Audio");
    expect(sent[0].options.access).toBe("mutate");
    expect(sent[0].params).toEqual({
      action: "play",
      resource: ACP,
      eventName: "SOUND_FIRE",
      position: "1 2 3",
      signals: ["Speed=0.5", "Wind=2"],
    });
    expect(r).toMatchObject({
      ok: true,
      action: "play",
      target: `path:${ACP}`,
      changed: null,
      readback: { handle: 7, playing: true, position: "1 2 3" },
    });
    expect(r.ok && r.next).toContain("handle 7");
    expect(r.warnings).toEqual([]);
  });

  it("keeps a {GUID} resource and warns when the handle is not playing", async () => {
    const { client, sent } = fakeClient(() => ok({ handle: 2, playing: 0, position: "0 0 0" }));
    const r = await runAudio(client, { action: "play", resource: GUID_ACP, eventName: "E" });
    expect(sent[0].params.resource).toBe(GUID_ACP);
    expect(sent[0].params).not.toHaveProperty("position");
    expect(r.ok && r.readback).toMatchObject({ handle: 2, playing: false });
    expect(r.warnings.join(" ")).toContain("not playing");
  });

  it.each([
    ["NO_WORLD"],
    ["WRONG_MODE"],
    ["RESOURCE_NOT_FOUND"],
    ["INVALID_ARGUMENT"],
    ["PLAY_FAILED"],
  ])("maps the handler refusal %s", async (code) => {
    const { client } = fakeClient(() => refused(code, `${code}: text | next: step`, "step"));
    const r = await runAudio(client, { action: "play", resource: ACP, eventName: "E" });
    expect(r).toMatchObject({ ok: false, action: "play", code, next: "step" });
  });
});

describe("playSound", () => {
  it("plays a wav and a snd", async () => {
    const { client, sent } = fakeClient(() => ok({ handle: 4, playing: true }));
    for (const res of ["Sounds/a.wav", "Sounds/b.SND", "{AAAAAAAAAAAAAAAA}Sounds/c.wav"]) {
      const r = await runAudio(client, { action: "playSound", resource: res });
      expect(r).toMatchObject({ ok: true, readback: { handle: 4, playing: true } });
    }
    expect(sent.map((s) => s.params.resource)).toEqual([
      "Sounds/a.wav",
      "Sounds/b.SND",
      "{AAAAAAAAAAAAAAAA}Sounds/c.wav",
    ]);
    expect(sent[0].options.access).toBe("mutate");
  });

  it("maps PLAY_FAILED and NO_WORLD", async () => {
    for (const code of ["PLAY_FAILED", "NO_WORLD", "RESOURCE_NOT_FOUND"]) {
      const { client } = fakeClient(() => refused(code));
      expect(await runAudio(client, { action: "playSound", resource: "a.wav" })).toMatchObject({
        ok: false,
        code,
      });
    }
  });
});

describe("isPlaying", () => {
  it("reads with access read and sends the integer handle", async () => {
    const { client, sent } = fakeClient(() => ok({ handle: 9, playing: 1 }));
    const r = await runAudio(client, { action: "isPlaying", handle: 9 });
    expect(sent[0].options.access).toBe("read");
    expect(sent[0].params).toEqual({ action: "isPlaying", handle: 9 });
    expect(r).toMatchObject({
      ok: true,
      target: "handle:9",
      changed: null,
      readback: { handle: 9, playing: true },
    });
  });

  it("handle 0 is a valid handle", async () => {
    const { client, sent } = fakeClient(() => ok({ handle: 0, playing: 0 }));
    const r = await runAudio(client, { action: "isPlaying", handle: 0 });
    expect(sent[0].params.handle).toBe(0);
    expect(r).toMatchObject({ ok: true, readback: { handle: 0, playing: false } });
  });
});

describe("stop", () => {
  it("cuts without fadeTime and records the change", async () => {
    const { client, sent } = fakeClient(() => ok({ handle: 3, playingBefore: 1, playing: 0 }));
    const r = await runAudio(client, { action: "stop", handle: 3 });
    expect(sent[0].params).toEqual({ action: "stop", handle: 3 });
    expect(sent[0].options.access).toBe("mutate");
    expect(r).toMatchObject({
      ok: true,
      readback: { handle: 3, playingBefore: true, playing: false },
      changed: [{ path: "handle:3.playing", before: true, after: false }],
    });
    expect(r.warnings).toEqual([]);
  });

  it("sends fadeTime as text", async () => {
    const { client, sent } = fakeClient(() => ok({ handle: 3, playingBefore: 1, playing: 1 }));
    const r = await runAudio(client, { action: "stop", handle: 3, fadeTime: 2.5 });
    expect(sent[0].params.fadeTime).toBe("2.5");
    expect(r.warnings.join(" ")).toContain("fade may be running");
  });

  it("accepts fade 0 and 60 as limits, and text", async () => {
    const { client, sent } = fakeClient(() => ok({ handle: 3, playingBefore: 1, playing: 0 }));
    await runAudio(client, { action: "stop", handle: 3, fadeTime: 0 });
    await runAudio(client, { action: "stop", handle: 3, fadeTime: "60" });
    expect(sent.map((s) => s.params.fadeTime)).toEqual(["0", "60"]);
  });

  it("warns when the handle was already stopped", async () => {
    const { client } = fakeClient(() => ok({ handle: 3, playingBefore: 0, playing: 0 }));
    const r = await runAudio(client, { action: "stop", handle: 3 });
    expect(r.ok && r.changed).toEqual([]);
    expect(r.warnings.join(" ")).toContain("not playing before");
  });

  it("maps a handler INVALID_ARGUMENT", async () => {
    const { client } = fakeClient(() => refused("INVALID_ARGUMENT"));
    expect(await runAudio(client, { action: "stop", handle: 3 })).toMatchObject({
      ok: false,
      code: "INVALID_ARGUMENT",
    });
  });
});

describe("audible", () => {
  it("answers numbers for the float text", async () => {
    const { client, sent } = fakeClient(() => ok({ audibility: "0.75", distance: "12.5" }));
    const r = await runAudio(client, {
      action: "audible",
      resource: ACP,
      eventName: "E",
      position: "10 0 5",
    });
    expect(sent[0].options.access).toBe("read");
    expect(sent[0].params.position).toBe("10 0 5");
    expect(r).toMatchObject({
      ok: true,
      changed: null,
      readback: { audibility: 0.75, distance: 12.5 },
    });
  });

  it("keeps text that is not a number", async () => {
    const { client } = fakeClient(() => ok({ audibility: "nan", distance: "" }));
    const r = await runAudio(client, { action: "audible", resource: ACP, eventName: "E" });
    expect(r.ok && r.readback).toEqual({ audibility: "nan", distance: "" });
  });

  it("maps NO_WORLD", async () => {
    const { client } = fakeClient(() => refused("NO_WORLD"));
    expect(
      await runAudio(client, { action: "audible", resource: ACP, eventName: "E" }),
    ).toMatchObject({ ok: false, code: "NO_WORLD" });
  });
});

describe("variable", () => {
  it("reads id and value", async () => {
    const { client, sent } = fakeClient(() => ok({ id: 4, value: "0.25" }));
    const r = await runAudio(client, { action: "variable", resource: CONF, name: "Wind" });
    expect(sent[0].options.access).toBe("read");
    expect(r).toMatchObject({ ok: true, readback: { id: 4, value: 0.25 } });
  });

  it("maps VARIABLE_NOT_FOUND (a code carried locally) and RESOURCE_NOT_FOUND", async () => {
    for (const code of ["VARIABLE_NOT_FOUND", "RESOURCE_NOT_FOUND"]) {
      const { client } = fakeClient(() => refused(code, "x", ""));
      const r = await runAudio(client, { action: "variable", resource: CONF, name: "Wind" });
      expect(r).toMatchObject({ ok: false, code });
      expect(r.ok === false && r.next.length).toBeGreaterThan(0);
    }
  });
});

describe("setVariable", () => {
  it("sends the value as text and records before and after with the inverse", async () => {
    const { client, sent } = fakeClient(() => ok({ id: 4, before: "0", after: "0.8" }));
    const r = await runAudio(client, {
      action: "setVariable",
      resource: CONF,
      name: "Wind",
      value: 0.8,
    });
    expect(sent[0].params).toEqual({
      action: "setVariable",
      resource: CONF,
      name: "Wind",
      value: "0.8",
    });
    expect(sent[0].options.access).toBe("mutate");
    expect(r).toMatchObject({
      ok: true,
      changed: [{ path: "variable.Wind", before: 0, after: 0.8 }],
      readback: { id: 4, before: 0, after: 0.8 },
    });
    expect(r.ok && r.next).toContain("value 0");
  });

  it("an unchanged value gives no change entry", async () => {
    const { client } = fakeClient(() => ok({ id: 4, before: "0.8", after: "0.8" }));
    const r = await runAudio(client, {
      action: "setVariable",
      resource: CONF,
      name: "Wind",
      value: "0.8",
    });
    expect(r.ok && r.changed).toEqual([]);
  });

  it("maps VARIABLE_NOT_FOUND and ENGINE_FALSE", async () => {
    for (const [reply, code] of [
      [refused("VARIABLE_NOT_FOUND"), "VARIABLE_NOT_FOUND"],
      [{ status: "error", code: "ENGINE_FALSE", message: "m", next: "n" }, "ENGINE_FALSE"],
    ] as const) {
      const { client } = fakeClient(() => ({ ...reply }));
      expect(
        await runAudio(client, { action: "setVariable", resource: CONF, name: "W", value: 1 }),
      ).toMatchObject({ ok: false, code });
    }
  });
});

describe("resetVariables", () => {
  it("sends no keys and reads back reset", async () => {
    const { client, sent } = fakeClient(() => ok({ reset: 1 }));
    const r = await runAudio(client, { action: "resetVariables" });
    expect(sent[0].params).toEqual({ action: "resetVariables" });
    expect(sent[0].options.access).toBe("mutate");
    expect(r).toMatchObject({ ok: true, target: "audio:runtime", readback: { reset: true } });
  });
});

describe("masters", () => {
  it("parses the master rows into numbers", async () => {
    const { client, sent } = fakeClient(() =>
      ok({
        outputVolume: "1",
        masters: ["SFX=0.8", "Music=0.5", "VoiceChat=1", "Dialog=1", "UI=0.25"],
      }),
    );
    const r = await runAudio(client, { action: "masters" });
    expect(sent[0].options.access).toBe("read");
    expect(r).toMatchObject({
      ok: true,
      changed: null,
      readback: {
        outputVolume: 1,
        masters: { SFX: 0.8, Music: 0.5, VoiceChat: 1, Dialog: 1, UI: 0.25 },
      },
    });
  });
});

describe("setMaster", () => {
  it("sends the value as text and records the change with the inverse", async () => {
    const { client, sent } = fakeClient(() => ok({ master: "SFX", before: "1", after: "0.5" }));
    const r = await runAudio(client, { action: "setMaster", master: "SFX", value: 0.5 });
    expect(sent[0].params).toEqual({ action: "setMaster", master: "SFX", value: "0.5" });
    expect(sent[0].options.access).toBe("mutate");
    expect(r).toMatchObject({
      ok: true,
      target: "master:SFX",
      changed: [{ path: "master.SFX", before: 1, after: 0.5 }],
    });
    expect(r.ok && r.next).toContain("value 1");
  });

  it("maps a handler range refusal and ENGINE_FALSE", async () => {
    const a = fakeClient(() => refused("INVALID_ARGUMENT", "value must be 0 to 1"));
    expect(await runAudio(a.client, { action: "setMaster", master: "UI", value: 4 })).toMatchObject(
      {
        ok: false,
        code: "INVALID_ARGUMENT",
      },
    );
    const b = fakeClient(() => ({
      status: "error",
      code: "ENGINE_FALSE",
      message: "m",
      next: "n",
    }));
    expect(await runAudio(b.client, { action: "setMaster", master: "UI", value: 1 })).toMatchObject(
      {
        ok: false,
        code: "ENGINE_FALSE",
      },
    );
  });

  it("accepts every master name", async () => {
    const { client, sent } = fakeClient(() => ok({ master: "x", before: "1", after: "1" }));
    for (const m of ["SFX", "Music", "VoiceChat", "Dialog", "UI"]) {
      await runAudio(client, { action: "setMaster", master: m, value: 1 });
    }
    expect(sent).toHaveLength(5);
  });
});

describe("pause", () => {
  it("pauses by master name and gives the inverse", async () => {
    const { client, sent } = fakeClient(() => ok({ masters: ["SFX", "Music"], paused: 1 }));
    const r = await runAudio(client, { action: "pause", masters: ["SFX", "Music"] });
    expect(sent[0].params).toEqual({ action: "pause", masters: ["SFX", "Music"] });
    expect(sent[0].options.access).toBe("mutate");
    expect(r).toMatchObject({ ok: true, readback: { masters: ["SFX", "Music"], paused: true } });
    expect(r.ok && r.next).toContain("resume: true");
  });

  it("resume sends the flag and reads back not paused", async () => {
    const { client, sent } = fakeClient(() => ok({ masters: ["SFX"], paused: 0 }));
    const r = await runAudio(client, { action: "pause", masters: ["SFX"], resume: true });
    expect(sent[0].params.resume).toBe(true);
    expect(r).toMatchObject({ ok: true, readback: { paused: false } });
    expect(r.ok && r.next).toContain("running again");
  });

  it("maps a handler INVALID_ARGUMENT", async () => {
    const { client } = fakeClient(() => refused("INVALID_ARGUMENT"));
    expect(await runAudio(client, { action: "pause", masters: ["SFX"] })).toMatchObject({
      ok: false,
      code: "INVALID_ARGUMENT",
    });
  });
});

describe("outputStates", () => {
  it("count only", async () => {
    const { client, sent } = fakeClient(() => ok({ count: 3, index: -1, signalIndex: -1 }));
    const r = await runAudio(client, { action: "outputStates" });
    expect(sent[0].params).toEqual({ action: "outputStates" });
    expect(sent[0].options.access).toBe("read");
    expect(r).toMatchObject({ ok: true, readback: { count: 3, index: -1, signalIndex: -1 } });
    expect(r.warnings).toEqual([]);
  });

  it("a mixer with no instance warns", async () => {
    const { client } = fakeClient(() => ok({ count: 3, index: -1, signalIndex: -1 }));
    const r = await runAudio(client, { action: "outputStates", resource: "Sounds/Mix.afm" });
    expect(r.warnings.join(" ")).toContain("no instance");
  });

  it("an instance with a signal name", async () => {
    const { client, sent } = fakeClient(() => ok({ count: 3, index: 1, signalIndex: 2 }));
    const r = await runAudio(client, {
      action: "outputStates",
      resource: "Sounds/Mix.afm",
      name: "Wind",
    });
    expect(sent[0].params).toEqual({
      action: "outputStates",
      resource: "Sounds/Mix.afm",
      name: "Wind",
    });
    expect(r).toMatchObject({ ok: true, readback: { index: 1, signalIndex: 2 } });
    expect(r.warnings).toEqual([]);
  });

  it("an unknown signal on an instance warns", async () => {
    const { client } = fakeClient(() => ok({ count: 3, index: 1, signalIndex: -1 }));
    const r = await runAudio(client, {
      action: "outputStates",
      resource: "Sounds/Mix.afm",
      name: "Nope",
    });
    expect(r.warnings.join(" ")).toContain("signalIndex -1");
  });

  it("maps RESOURCE_NOT_FOUND", async () => {
    const { client } = fakeClient(() => refused("RESOURCE_NOT_FOUND"));
    expect(
      await runAudio(client, { action: "outputStates", resource: "Sounds/Mix.afm" }),
    ).toMatchObject({ ok: false, code: "RESOURCE_NOT_FOUND" });
  });
});

describe("entityEvents", () => {
  it("lists events and signals", async () => {
    const { client, sent } = fakeClient(() =>
      ok({
        entity: "id:abc",
        component: "SCR_SoundComponent",
        events: ["SOUND_A", "SOUND_B"],
        signals: ["Speed"],
        count: 2,
      }),
    );
    const r = await runAudio(client, { action: "entityEvents", entity: "id:abc" });
    expect(sent[0].options.access).toBe("read");
    expect(sent[0].params).toEqual({ action: "entityEvents", entity: "id:abc" });
    expect(r).toMatchObject({
      ok: true,
      target: "entity:id:abc",
      readback: {
        entity: "id:abc",
        component: "SCR_SoundComponent",
        events: ["SOUND_A", "SOUND_B"],
        signals: ["Speed"],
        count: 2,
      },
    });
  });

  it("an SndComponent answer (no events) carries the offline warning (fix-up 1)", async () => {
    const { client } = fakeClient(() =>
      ok({ entity: "id:abc", component: "SoundComponent", events: [], signals: ["Speed"], count: 0 }),
    );
    const r = await runAudio(client, { action: "entityEvents", entity: "id:abc" });
    expect(r).toMatchObject({ ok: true, readback: { events: [], signals: ["Speed"], count: 0 } });
    expect(r.warnings.join(" ")).toMatch(/SndComponent has no GetEvents.*audio events/);
  });

  it.each([["NO_WORLD"], ["WRONG_MODE"], ["ENTITY_NOT_FOUND"], ["NO_SOUND_COMPONENT"]])(
    "maps %s",
    async (code) => {
      const { client } = fakeClient(() => refused(code));
      expect(await runAudio(client, { action: "entityEvents", entity: "name:x" })).toMatchObject({
        ok: false,
        code,
      });
    },
  );
});

describe("entityPlay", () => {
  it("plays an entity event", async () => {
    const { client, sent } = fakeClient(() => ok({ entity: "id:abc", handle: 12, playing: 1 }));
    const r = await runAudio(client, {
      action: "entityPlay",
      entity: "id:abc",
      eventName: "SOUND_A",
    });
    expect(sent[0].params).toEqual({
      action: "entityPlay",
      entity: "id:abc",
      eventName: "SOUND_A",
    });
    expect(sent[0].options.access).toBe("mutate");
    expect(r).toMatchObject({
      ok: true,
      changed: null,
      readback: { entity: "id:abc", handle: 12, playing: true },
    });
    expect(r.ok && r.next).toContain("handle 12");
  });

  it.each([
    ["ENTITY_NOT_FOUND"],
    ["NO_SOUND_COMPONENT"],
    ["EVENT_NOT_FOUND"],
    ["PLAY_FAILED"],
    ["NO_WORLD"],
    ["WRONG_MODE"],
  ])("maps %s", async (code) => {
    const { client } = fakeClient(() => refused(code, "m", ""));
    const r = await runAudio(client, { action: "entityPlay", entity: "id:a", eventName: "E" });
    expect(r).toMatchObject({ ok: false, code });
    expect(r.ok === false && r.next.length).toBeGreaterThan(0);
  });
});

describe("setSignal", () => {
  it("sets a signal and records the change", async () => {
    const { client, sent } = fakeClient(() =>
      ok({ entity: "id:abc", index: 2, before: "0", after: "0.5" }),
    );
    const r = await runAudio(client, {
      action: "setSignal",
      entity: "id:abc",
      name: "Speed",
      value: 0.5,
    });
    expect(sent[0].params).toEqual({
      action: "setSignal",
      entity: "id:abc",
      name: "Speed",
      value: "0.5",
    });
    expect(sent[0].options.access).toBe("mutate");
    expect(r).toMatchObject({
      ok: true,
      changed: [{ path: "signal.Speed", before: 0, after: 0.5 }],
      readback: { entity: "id:abc", index: 2, set: true },
    });
    expect(r.ok && r.next).toContain("value 0");
  });

  it("an unknown signal (index -1) is ok with a warning and no change", async () => {
    const { client } = fakeClient(() => ok({ entity: "id:abc", index: -1, before: "", after: "" }));
    const r = await runAudio(client, {
      action: "setSignal",
      entity: "id:abc",
      name: "Nope",
      value: 1,
    });
    expect(r).toMatchObject({
      ok: true,
      changed: null,
      readback: { index: -1, set: false },
    });
    expect(r.warnings.join(" ")).toContain("nothing was set");
    expect(r.ok && r.next).toContain("entityEvents");
  });

  it.each([["ENTITY_NOT_FOUND"], ["NO_SIGNALS_MANAGER"], ["NO_WORLD"], ["WRONG_MODE"]])(
    "maps %s",
    async (code) => {
      const { client } = fakeClient(() => refused(code));
      expect(
        await runAudio(client, { action: "setSignal", entity: "id:a", name: "S", value: 1 }),
      ).toMatchObject({ ok: false, code });
    },
  );
});

describe("soundMap", () => {
  it("parses the map rows", async () => {
    const { client, sent } = fakeClient(() =>
      ok({
        position: "10 0 5",
        values: [
          "sea=0",
          "forest=0.5",
          "city=0",
          "meadow=0.5",
          "river=0",
          "riverSlope=0",
          "lake=0",
          "coast=0",
        ],
      }),
    );
    const r = await runAudio(client, { action: "soundMap", position: [10, 0, 5] });
    expect(sent[0].params).toEqual({ action: "soundMap", position: "10 0 5" });
    expect(sent[0].options.access).toBe("read");
    expect(r).toMatchObject({
      ok: true,
      changed: null,
      readback: { position: "10 0 5", values: { sea: 0, forest: 0.5, meadow: 0.5, coast: 0 } },
    });
  });

  it("works without a position (the camera)", async () => {
    const { client, sent } = fakeClient(() => ok({ position: "0 1 0", values: [] }));
    await runAudio(client, { action: "soundMap" });
    expect(sent[0].params).toEqual({ action: "soundMap" });
  });

  it.each([["NO_WORLD"], ["WRONG_MODE"], ["NO_SOUND_WORLD"]])("maps %s", async (code) => {
    const { client } = fakeClient(() => refused(code, "m", ""));
    const r = await runAudio(client, { action: "soundMap" });
    expect(r).toMatchObject({ ok: false, code });
    expect(r.ok === false && r.next.length).toBeGreaterThan(0);
  });
});

describe("open", () => {
  it("sends a dry run when confirm is absent, explicit false on the wire", async () => {
    const { client, sent } = fakeClient(() =>
      ok({
        path: ACP,
        module: "AudioEditor",
        opened: 0,
        dryRun: 1,
        message: "dry run: would open",
      }),
    );
    const r = await runAudio(client, { action: "open", path: "Sounds\\Rifle.acp" });
    expect(sent[0].params).toEqual({ action: "open", path: ACP, confirm: false });
    expect(sent[0].options.access).toBe("mutate");
    expect(r).toMatchObject({
      ok: true,
      target: `path:${ACP}`,
      changed: null,
      readback: { path: ACP, module: "AudioEditor", opened: false, dryRun: true },
    });
    expect(r.ok && r.next).toContain(AUDIO_OPEN_PROVEN ? "confirm: true" : "P-W5-12");
  });

  it("a .sig is the Audio Editor's too", async () => {
    const { client, sent } = fakeClient(() =>
      ok({ path: "S/a.sig", module: "AudioEditor", dryRun: 1 }),
    );
    const r = await runAudio(client, { action: "open", path: "S/a.sig", confirm: false });
    expect(sent[0].params.confirm).toBe(false);
    expect(r.ok).toBe(true);
  });

  it("with confirm answers GATED from here, sending nothing (probe P-W5-12)", async () => {
    const { client, sent } = fakeClient(() => ok());
    const r = await runAudio(client, { action: "open", path: ACP, confirm: true });
    expect(sent).toHaveLength(0);
    expect(r).toMatchObject({ ok: false, code: "GATED", action: "open", target: `path:${ACP}` });
    expect(r.ok === false && r.message).toContain("P-W5-12");
    expect(r.ok === false && r.next).toContain("dry run");
  });

  it("maps the handler's NOT_IN_PROJECT, WRONG_MODULE, MODAL_OPEN, GATED and ENGINE_FALSE", async () => {
    for (const [reply, code] of [
      [refused("NOT_IN_PROJECT"), "NOT_IN_PROJECT"],
      [refused("WRONG_MODULE"), "WRONG_MODULE"],
      [refused("MODAL_OPEN"), "MODAL_OPEN"],
      [refused("GATED"), "GATED"],
      [{ status: "error", code: "ENGINE_FALSE", message: "m", next: "n" }, "ENGINE_FALSE"],
    ] as const) {
      const { client } = fakeClient(() => ({ ...reply }));
      expect(await runAudio(client, { action: "open", path: ACP })).toMatchObject({
        ok: false,
        code,
      });
    }
  });
});

describe("handler answers", () => {
  it("an unknown code falls back and warns", async () => {
    const { client } = fakeClient(() => ({
      status: "error",
      code: "WEIRD",
      message: "m",
      next: "",
    }));
    const r = await runAudio(client, { action: "masters" });
    expect(r).toMatchObject({ ok: false, code: "HANDLER_ERROR" });
    expect(r.warnings.join(" ")).toContain("unknown code 'WEIRD'");
  });

  it("a refusal with an unknown code is INVALID_ARGUMENT", async () => {
    const { client } = fakeClient(() => refused("WEIRD"));
    expect(await runAudio(client, { action: "masters" })).toMatchObject({
      ok: false,
      code: "INVALID_ARGUMENT",
    });
  });

  it("an unknown status is UNREACHABLE", async () => {
    const { client } = fakeClient(() => ({ status: "weird" }));
    expect(await runAudio(client, { action: "masters" })).toMatchObject({
      ok: false,
      code: "UNREACHABLE",
    });
  });

  it("a refusal without next takes the code's default", async () => {
    const { client } = fakeClient(() => ({
      status: "refused",
      code: "NO_SOUND_WORLD",
      message: "m",
    }));
    const r = await runAudio(client, { action: "soundMap" });
    expect(r.ok === false && r.next).toBe(ERROR_CODES.NO_SOUND_WORLD);
  });

  it("the World Editor not being open keeps its code", async () => {
    const { client } = fakeClient(() => refused("MODULE_NOT_OPEN"));
    expect(await runAudio(client, { action: "entityEvents", entity: "id:a" })).toMatchObject({
      ok: false,
      code: "MODULE_NOT_OPEN",
    });
  });
});

describe("client failures", () => {
  it("keeps LOST, MODAL_OPEN and WEDGED, and never retries a lost write", async () => {
    for (const code of ["LOST", "MODAL_OPEN", "WEDGED"] as const) {
      const { client, sent } = fakeClient(() => new WorkbenchError(`boom ${code}`, code));
      const r = await runAudio(client, { action: "setMaster", master: "SFX", value: 1 });
      expect(r).toMatchObject({ ok: false, code });
      expect(sent).toHaveLength(1);
      if (code === "LOST") expect(r.ok === false && r.next).toContain("never retried");
    }
  });

  it("a lost read is not given the write advice", async () => {
    const { client } = fakeClient(() => new WorkbenchError("lost", "LOST"));
    const r = await runAudio(client, { action: "masters" });
    expect(r.ok === false && r.next).not.toContain("never retried");
  });

  it("any other client failure is UNREACHABLE", async () => {
    const { client } = fakeClient(() => new WorkbenchError("refused", "CONNECTION_REFUSED"));
    expect(await runAudio(client, { action: "masters" })).toMatchObject({
      ok: false,
      code: "UNREACHABLE",
    });
  });
});

describe("registerWbAudio", () => {
  it("registers wb_audio, drops undefined keys and answers JSON", async () => {
    const { client, sent } = fakeClient(() => ok({ outputVolume: "1", masters: ["SFX=1"] }));
    const handler = captureTool((s) => registerWbAudio(s, client));
    const res = await handler({ action: "masters", handle: undefined, value: undefined });
    expect(sent[0].params).toEqual({ action: "masters" });
    expect(res.isError).toBeUndefined();
    expect(JSON.parse(textOf(res))).toMatchObject({ ok: true, action: "masters" });
  });

  it("flags a refusal as an error result", async () => {
    const { client, sent } = fakeClient(() => ok());
    const handler = captureTool((s) => registerWbAudio(s, client));
    const res = await handler({ action: "setMaster", master: "Bass", value: 1 });
    expect(sent).toHaveLength(0);
    expect(res.isError).toBe(true);
    expect(JSON.parse(textOf(res))).toMatchObject({ ok: false, code: "INVALID_ARGUMENT" });
  });

  it("registers under the name wb_audio with the spec description", () => {
    let name = "";
    let description = "";
    const fake = {
      registerTool: (n: string, def: { description: string }) => {
        name = n;
        description = def.description;
      },
    };
    const { client } = fakeClient(() => ok());
    registerWbAudio(fake as never, client);
    expect(name).toBe("wb_audio");
    expect(description).toBe(wbAudioDescription());
  });
});

// Census rows this file tests (W5 close-out, EV-W5-081).
// census:mcp:action/wb_audio.audible
// census:mcp:action/wb_audio.isPlaying
// census:mcp:action/wb_audio.masters
// census:mcp:action/wb_audio.outputStates
// census:mcp:action/wb_audio.play
// census:mcp:action/wb_audio.playSound
// census:mcp:action/wb_audio.setMaster
// census:mcp:action/wb_audio.setVariable
// census:mcp:action/wb_audio.stop
// census:mcp:action/wb_audio.variable
