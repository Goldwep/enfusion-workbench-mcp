import { ERROR_CODES } from "../../src/manifest/vocabulary.js";
import { describe, expect, it } from "vitest";
import { WorkbenchError } from "../../src/workbench/client.js";
import type { WorkbenchClient, WorkbenchCallOptions } from "../../src/workbench/client.js";
import { DESCRIPTION_MAX } from "../../src/manifest/generate.js";
import {
  FLOAT_PARAMS,
  HANDLER,
  HANDLER_ACTIONS,
  PARTICLE_CONTRACT,
  checkEffectPath,
  flatInputShape,
  prepareRequest,
  registerWbParticle,
  runParticle,
  wbParticleDescription,
} from "../../src/tools/wb-particle.js";
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

const EFFECT = "Particles/Test/Fire.ptc";
const ENT = "id:0x00000000000000ab";
const ENT_CANON = "id:0x00000000000000ab";

describe("wb_particle contract", () => {
  it("loads and names the seven handler actions", () => {
    expect(PARTICLE_CONTRACT.tool).toBe("wb_particle");
    expect(HANDLER).toBe("EMCP_WB_Particle");
    expect([...HANDLER_ACTIONS].sort()).toEqual(
      ["control", "param", "remove", "setParam", "simulate", "spawn", "stats"].sort(),
    );
  });

  it("its description fits the 400-char budget", () => {
    expect(wbParticleDescription().length).toBeLessThanOrEqual(DESCRIPTION_MAX);
  });

  it("the flat input shape carries every request key of the contract", () => {
    const keys = Object.keys(flatInputShape());
    for (const k of PARTICLE_CONTRACT.request) expect(keys).toContain(k);
  });

  it("answers the two W5 particle codes from the vocabulary", () => {
    for (const c of ["NOT_A_PARTICLE_EFFECT", "NO_PARTICLES"])
      expect(ERROR_CODES).toHaveProperty(c);
  });

  it("lists 23 float params including CURRENT_TIME", () => {
    expect(FLOAT_PARAMS).toHaveLength(23);
    expect(FLOAT_PARAMS).toContain("CURRENT_TIME");
  });
});

describe("checkEffectPath", () => {
  it("accepts a relative .ptc, backslashes turned to slashes", () => {
    expect(checkEffectPath("Particles\\Test\\Fire.ptc")).toBe("Particles/Test/Fire.ptc");
  });
  it("keeps a {GUID}path form", () => {
    expect(checkEffectPath("{0123456789ABCDEF}Particles/Fire.PTC")).toBe(
      "{0123456789ABCDEF}Particles/Fire.PTC",
    );
  });
  it("refuses a non-.ptc, absolute forms and '..'", () => {
    expect(() => checkEffectPath("Particles/Fire.emat")).toThrow(/\.ptc/);
    expect(() => checkEffectPath("C:/x/Fire.ptc")).toThrow(/absolute/);
    expect(() => checkEffectPath("a/../Fire.ptc")).toThrow(/'\.\.'/);
    expect(() => checkEffectPath(" ")).toThrow(/empty/);
  });
});

describe("prepareRequest refusals (nothing is sent)", () => {
  const refuse = (input: unknown, code: string, text?: RegExp) => {
    const p = prepareRequest(input);
    expect(p.ok).toBe(false);
    if (!p.ok) {
      expect(p.error.code).toBe(code);
      if (text) expect(p.error.message).toMatch(text);
    }
  };

  it("an unknown action", () =>
    refuse({ action: "nope", entity: ENT }, "INVALID_ARGUMENT", /unknown action/));
  it("spawn without effect", () => refuse({ action: "spawn" }, "INVALID_ARGUMENT", /effect/));
  it("spawn with a non-.ptc effect", () =>
    refuse({ action: "spawn", effect: "a/b.emat" }, "INVALID_ARGUMENT", /\.ptc/));
  it("spawn with an absolute effect path", () =>
    refuse({ action: "spawn", effect: "C:\\a\\b.ptc" }, "ABSOLUTE_PATH"));
  it("spawn with bad coords", () => {
    refuse({ action: "spawn", effect: EFFECT, coords: "1 2" }, "INVALID_ARGUMENT", /coords/);
    refuse({ action: "spawn", effect: EFFECT, coords: "1 2 x" }, "INVALID_ARGUMENT", /coords/);
  });
  it("spawn with an empty name", () =>
    refuse({ action: "spawn", effect: EFFECT, name: " " }, "INVALID_ARGUMENT", /name/));
  it("spawn takes no entity", () =>
    refuse({ action: "spawn", effect: EFFECT, entity: ENT }, "INVALID_ARGUMENT"));
  it("stats without entity or with a malformed one", () => {
    refuse({ action: "stats" }, "INVALID_ARGUMENT", /entity/);
    refuse({ action: "stats", entity: "foo" }, "INVALID_ARGUMENT", /entity reference/);
    refuse({ action: "stats", entity: "id:zz" }, "INVALID_ARGUMENT", /hex/);
  });
  it("control with an unknown op", () =>
    refuse({ action: "control", entity: ENT, op: "explode" }, "INVALID_ARGUMENT", /op must/));
  it("simulate seconds out of range or not a number", () => {
    refuse({ action: "simulate", entity: ENT, seconds: "0" }, "INVALID_ARGUMENT", /seconds/);
    refuse({ action: "simulate", entity: ENT, seconds: 61 }, "INVALID_ARGUMENT", /seconds/);
    refuse({ action: "simulate", entity: ENT, seconds: "abc" }, "INVALID_ARGUMENT", /seconds/);
    refuse({ action: "simulate", entity: ENT, seconds: -1 }, "INVALID_ARGUMENT", /seconds/);
  });
  it("simulate minFps out of range", () => {
    refuse(
      { action: "simulate", entity: ENT, seconds: 1, minFps: 0 },
      "INVALID_ARGUMENT",
      /minFps/,
    );
    refuse(
      { action: "simulate", entity: ENT, seconds: 1, minFps: "241" },
      "INVALID_ARGUMENT",
      /minFps/,
    );
  });
  it("a non-finite number", () =>
    refuse({ action: "simulate", entity: ENT, seconds: Infinity }, "INVALID_ARGUMENT", /finite/));
  it("param with a non-float param name", () =>
    refuse(
      { action: "param", entity: ENT, emitter: 0, param: "COLOR" },
      "INVALID_ARGUMENT",
      /float/,
    ));
  it("param with emitter -1", () =>
    refuse(
      { action: "param", entity: ENT, emitter: -1, param: "SIZE" },
      "INVALID_ARGUMENT",
      /emitter/,
    ));
  it("setParam with emitter below -1", () =>
    refuse(
      { action: "setParam", entity: ENT, emitter: -2, param: "SIZE", value: "1" },
      "INVALID_ARGUMENT",
      /emitter/,
    ));
  it("setParam on CURRENT_TIME", () =>
    refuse(
      { action: "setParam", entity: ENT, emitter: 0, param: "CURRENT_TIME", value: "1" },
      "INVALID_ARGUMENT",
      /read only/,
    ));
  it("setParam value not a number or above 10000", () => {
    refuse(
      { action: "setParam", entity: ENT, emitter: 0, param: "SIZE", value: "big" },
      "INVALID_ARGUMENT",
      /value/,
    );
    refuse(
      { action: "setParam", entity: ENT, emitter: 0, param: "SIZE", value: 10001 },
      "INVALID_ARGUMENT",
      /10000/,
    );
  });
  it("setParam multiplier outside 0..10", () => {
    refuse(
      { action: "setParam", entity: ENT, emitter: 0, param: "SIZE", value: 11, multiply: true },
      "INVALID_ARGUMENT",
      /multiplier/,
    );
    refuse(
      { action: "setParam", entity: ENT, emitter: 0, param: "SIZE", value: -1, multiply: true },
      "INVALID_ARGUMENT",
      /multiplier/,
    );
  });
  it("remove takes no op", () =>
    refuse({ action: "remove", entity: ENT, op: "play" }, "INVALID_ARGUMENT"));
});

describe("prepareRequest accepts and normalizes", () => {
  it("sends floats as text, the entity canonical, and confirm explicit on spawn and remove", () => {
    const sim = prepareRequest({ action: "simulate", entity: "id:AB", seconds: 2.5, minFps: 30 });
    expect(sim.ok).toBe(true);
    if (sim.ok) {
      expect(sim.params).toEqual({
        action: "simulate",
        entity: ENT_CANON,
        seconds: "2.5",
        minFps: "30",
      });
      expect(sim.mutating).toBe(true);
      expect(sim.target).toBe(`entity:${ENT_CANON}`);
    }
    const sp = prepareRequest({ action: "spawn", effect: "Particles\\Fire.ptc" });
    expect(sp.ok).toBe(true);
    if (sp.ok) {
      expect(sp.params).toEqual({ action: "spawn", effect: "Particles/Fire.ptc", confirm: false });
      expect(sp.target).toBe("path:Particles/Fire.ptc");
    }
    const rm = prepareRequest({ action: "remove", entity: ENT, confirm: true });
    expect(rm.ok && rm.params.confirm).toBe(true);
    const set = prepareRequest({
      action: "setParam",
      entity: ENT,
      emitter: -1,
      param: "BIRTH_RATE",
      value: 0.5,
      multiply: true,
    });
    expect(set.ok).toBe(true);
    if (set.ok) {
      expect(set.params.value).toBe("0.5");
      expect(set.params).not.toHaveProperty("confirm");
    }
    // A tiny value goes as plain decimal text, never an exponent (review W5-03).
    const tiny = prepareRequest({
      action: "setParam",
      entity: ENT,
      emitter: -1,
      param: "BIRTH_RATE",
      value: 1e-7,
    });
    expect(tiny.ok && tiny.params.value).toBe("0.0000001");
  });

  it("stats and param are reads", () => {
    const s = prepareRequest({ action: "stats", entity: "index:3" });
    expect(s.ok && s.mutating).toBe(false);
    const p = prepareRequest({ action: "param", entity: "name:Fx", emitter: 0, param: "SIZE" });
    expect(p.ok && p.mutating).toBe(false);
  });
});

describe("runParticle: spawn", () => {
  it("dry run sends confirm false and answers dryRun with a resend hint", async () => {
    const { client, sent } = fakeClient(() =>
      ok({ dryRun: 1, effectPath: "{AAAAAAAAAAAAAAAA}Particles/Fire.ptc", coords: "1 2 3" }),
    );
    const r = await runParticle(client, { action: "spawn", effect: EFFECT, coords: "1 2 3" });
    expect(sent).toHaveLength(1);
    expect(sent[0].fn).toBe(HANDLER);
    expect(sent[0].options.access).toBe("mutate");
    expect(sent[0].params).toEqual({
      action: "spawn",
      effect: EFFECT,
      coords: "1 2 3",
      confirm: false,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.changed).toBeNull();
      expect(r.readback).toMatchObject({ dryRun: true, entity: null, coords: "1 2 3" });
      expect(r.next).toMatch(/confirm: true/);
    }
  });

  it("a confirmed spawn answers the entity and a change, with undo advice", async () => {
    const { client, sent } = fakeClient(() =>
      ok({ entity: ENT, effectPath: "{A}x.ptc", coords: "0 0 0", dryRun: 0 }),
    );
    const r = await runParticle(client, { action: "spawn", effect: EFFECT, confirm: true });
    expect(sent[0].params.confirm).toBe(true);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.changed).toEqual([{ path: "world.entities", before: null, after: ENT }]);
      expect(r.readback).toMatchObject({ dryRun: false, entity: ENT });
      expect(r.next).toMatch(/undo/);
      expect(r.warnings).toEqual([]);
    }
  });

  it("warns when no entity id comes back", async () => {
    const { client } = fakeClient(() => ok({ dryRun: 0 }));
    const r = await runParticle(client, { action: "spawn", effect: EFFECT, confirm: true });
    expect(r.ok && r.warnings.length).toBe(1);
  });
});

describe("runParticle: reads and runtime actions", () => {
  it("stats shapes counts, names, active and time", async () => {
    const { client, sent } = fakeClient(() =>
      ok({
        entity: ENT,
        effectPath: "{A}Fire.ptc",
        state: "PLAYING",
        emitters: 2,
        particles: 40,
        emitterNames: ["Flame", "Smoke"],
        active: 1,
        time: "1.5",
      }),
    );
    const r = await runParticle(client, { action: "stats", entity: ENT });
    expect(sent[0].options.access).toBe("read");
    expect(sent[0].params).toEqual({ action: "stats", entity: ENT_CANON });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.changed).toBeNull();
      expect(r.readback).toEqual({
        entity: ENT,
        effectPath: "{A}Fire.ptc",
        state: "PLAYING",
        emitters: 2,
        particles: 40,
        emitterNames: ["Flame", "Smoke"],
        active: true,
        time: 1.5,
      });
    }
  });

  it("control reports the state change", async () => {
    const { client, sent } = fakeClient(() =>
      ok({ entity: ENT, stateBefore: "PLAYING", state: "PAUSED" }),
    );
    const r = await runParticle(client, { action: "control", entity: ENT, op: "pause" });
    expect(sent[0].options.access).toBe("mutate");
    expect(sent[0].params).toEqual({ action: "control", entity: ENT_CANON, op: "pause" });
    expect(r.ok && r.changed).toEqual([{ path: "state", before: "PLAYING", after: "PAUSED" }]);
  });

  it("control with no state change answers an empty change list", async () => {
    const { client } = fakeClient(() =>
      ok({ entity: ENT, stateBefore: "PLAYING", state: "PLAYING" }),
    );
    const r = await runParticle(client, { action: "control", entity: ENT, op: "play" });
    expect(r.ok && r.changed).toEqual([]);
  });

  it("simulate sends text floats and points at stats", async () => {
    const { client, sent } = fakeClient(() => ok({ entity: ENT, particles: 12, time: "3" }));
    const r = await runParticle(client, {
      action: "simulate",
      entity: ENT,
      seconds: 3,
      minFps: "60",
    });
    expect(sent[0].params).toMatchObject({ seconds: "3", minFps: "60" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.readback).toMatchObject({ particles: 12, time: 3 });
      expect(r.next).toMatch(/stats/);
    }
  });

  it("param answers value and original as numbers", async () => {
    const { client, sent } = fakeClient(() =>
      ok({ entity: ENT, param: "BIRTH_RATE", value: "12.5", original: "10" }),
    );
    const r = await runParticle(client, {
      action: "param",
      entity: ENT,
      emitter: 1,
      param: "BIRTH_RATE",
    });
    expect(sent[0].options.access).toBe("read");
    expect(sent[0].params).toEqual({
      action: "param",
      entity: ENT_CANON,
      emitter: 1,
      param: "BIRTH_RATE",
    });
    expect(r.ok && r.readback).toMatchObject({
      emitter: 1,
      param: "BIRTH_RATE",
      value: 12.5,
      original: 10,
    });
  });

  it("setParam answers before and after as a change and warns on an unread value", async () => {
    const { client, sent } = fakeClient(() =>
      ok({ entity: ENT, param: "SIZE", before: "1", after: "2" }),
    );
    const r = await runParticle(client, {
      action: "setParam",
      entity: ENT,
      emitter: 0,
      param: "SIZE",
      value: "2",
    });
    expect(sent[0].options.access).toBe("mutate");
    expect(r.ok && r.changed).toEqual([{ path: "emitters[0].SIZE", before: 1, after: 2 }]);
    expect(r.ok && r.warnings).toEqual([]);

    const weak = fakeClient(() => ok({ entity: ENT, param: "SIZE", before: "", after: "" }));
    const w = await runParticle(weak.client, {
      action: "setParam",
      entity: ENT,
      emitter: -1,
      param: "SIZE",
      value: "2",
    });
    expect(w.ok && w.changed?.[0].path).toBe("emitters[*].SIZE");
    expect(w.ok && w.warnings.length).toBe(2);
  });
});

describe("runParticle: remove", () => {
  it("dry run, then confirmed", async () => {
    const dry = fakeClient(() => ok({ entity: ENT, dryRun: 1, removed: 0 }));
    const d = await runParticle(dry.client, { action: "remove", entity: ENT });
    expect(dry.sent[0].params).toEqual({ action: "remove", entity: ENT_CANON, confirm: false });
    expect(d.ok && d.changed).toBeNull();
    expect(d.ok && d.readback).toMatchObject({ dryRun: true, removed: false });

    const real = fakeClient(() => ok({ entity: ENT, dryRun: 0, removed: 1 }));
    const r = await runParticle(real.client, { action: "remove", entity: ENT, confirm: true });
    expect(real.sent[0].params.confirm).toBe(true);
    expect(r.ok && r.changed).toEqual([{ path: "world.entities", before: ENT, after: null }]);
    expect(r.ok && r.next).toMatch(/undo/);
  });

  it("warns when the handler does not report it removed", async () => {
    const { client } = fakeClient(() => ok({ entity: ENT, dryRun: 0, removed: 0 }));
    const r = await runParticle(client, { action: "remove", entity: ENT, confirm: true });
    expect(r.ok && r.warnings.length).toBe(1);
  });
});

describe("runParticle: refusals and failures", () => {
  const codes = [
    "NOT_IN_PROJECT",
    "NO_WORLD",
    "WRONG_MODE",
    "RESOURCE_NOT_FOUND",
    "ENTITY_NOT_FOUND",
    "NOT_A_PARTICLE_EFFECT",
    "NO_PARTICLES",
    "UNPROVEN",
    "INVALID_ARGUMENT",
  ];
  for (const code of codes) {
    it(`maps a handler ${code} refusal, keeping its message and next`, async () => {
      const { client } = fakeClient(() => refused(code, `why ${code}`, "do this"));
      const r = await runParticle(client, { action: "stats", entity: ENT });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.code).toBe(code);
        expect(r.message).toBe(`why ${code}`);
        expect(r.next).toBe("do this");
        expect(r.target).toBe(`entity:${ENT_CANON}`);
      }
    });
  }

  it("a refusal with no next falls back to the code's table text", async () => {
    const { client } = fakeClient(() => ({ status: "refused", code: "NOT_A_PARTICLE_EFFECT" }));
    const r = await runParticle(client, { action: "stats", entity: ENT });
    expect(!r.ok && r.next).toBe(ERROR_CODES.NOT_A_PARTICLE_EFFECT);
  });

  it("a handler error status without a known code is HANDLER_ERROR with a warning", async () => {
    const { client } = fakeClient(() => ({ status: "error", code: "WEIRD", message: "boom" }));
    const r = await runParticle(client, { action: "stats", entity: ENT });
    expect(!r.ok && r.code).toBe("HANDLER_ERROR");
    expect(!r.ok && r.warnings[0]).toMatch(/WEIRD/);
  });

  it("an unknown status is UNREACHABLE", async () => {
    const { client } = fakeClient(() => ({ status: "maybe" }));
    const r = await runParticle(client, { action: "stats", entity: ENT });
    expect(!r.ok && r.code).toBe("UNREACHABLE");
  });

  it("maps WorkbenchError LOST, MODAL_OPEN and WEDGED to their names", async () => {
    for (const c of ["LOST", "MODAL_OPEN", "WEDGED"] as const) {
      const { client } = fakeClient(() => new WorkbenchError(`bad ${c}`, c));
      const r = await runParticle(client, { action: "stats", entity: ENT });
      expect(!r.ok && r.code).toBe(c);
    }
  });

  it("a lost spawn says to list entities and never retries", async () => {
    const { client, sent } = fakeClient(() => new WorkbenchError("lost", "LOST"));
    const r = await runParticle(client, { action: "spawn", effect: EFFECT, confirm: true });
    expect(sent).toHaveLength(1);
    expect(!r.ok && r.next).toMatch(/wb_entity list/);
  });

  it("a refusal before sending sends nothing", async () => {
    const { client, sent } = fakeClient(() => ok());
    const r = await runParticle(client, { action: "simulate", entity: ENT, seconds: 99 });
    expect(r.ok).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it("any other client error is UNREACHABLE", async () => {
    const { client } = fakeClient(() => new Error("socket closed"));
    const r = await runParticle(client, { action: "stats", entity: ENT });
    expect(!r.ok && r.code).toBe("UNREACHABLE");
  });
});

describe("registerWbParticle", () => {
  it("registers wb_particle, drops undefined keys and answers JSON", async () => {
    const { client, sent } = fakeClient(() => ok({ entity: ENT, state: "PLAYING" }));
    const handler = captureTool((s) => registerWbParticle(s, client));
    const res = await handler({ action: "stats", entity: ENT, op: undefined, confirm: undefined });
    expect(sent[0].params).toEqual({ action: "stats", entity: ENT_CANON });
    expect(res.isError).toBeUndefined();
    expect(JSON.parse(textOf(res))).toMatchObject({ ok: true, action: "stats" });
  });

  it("flags a refusal as an error result", async () => {
    const { client } = fakeClient(() => ok());
    const handler = captureTool((s) => registerWbParticle(s, client));
    const res = await handler({ action: "control", entity: ENT, op: "nope" });
    expect(res.isError).toBe(true);
    expect(JSON.parse(textOf(res))).toMatchObject({ ok: false, code: "INVALID_ARGUMENT" });
  });
});

// Census rows this file tests (W5 close-out, EV-W5-081).
// census:mcp:action/wb_particle.control
// census:mcp:action/wb_particle.param
// census:mcp:action/wb_particle.remove
// census:mcp:action/wb_particle.setParam
// census:mcp:action/wb_particle.spawn
// census:mcp:action/wb_particle.stats
