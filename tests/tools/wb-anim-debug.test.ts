import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkbenchError } from "../../src/workbench/client.js";
import type { WorkbenchClient, WorkbenchCallOptions } from "../../src/workbench/client.js";
import { DESCRIPTION_MAX } from "../../src/manifest/generate.js";
import {
  ANIM_DEBUG_CONTRACT,
  ANIM_DEBUG_GATES,
  HANDLER,
  HANDLER_ACTIONS,
  MAX_NAMES,
  checkTarget,
  flatInputShape,
  formatFloat,
  parseIndexed,
  parseTagRows,
  parseVarRows,
  prepareRequest,
  registerWbAnimDebug,
  runAnimDebug,
  sameValue,
  splitFixed,
  valueWhy,
  wbAnimDebugDescription,
} from "../../src/tools/wb-anim-debug.js";
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

const T = "entity:id:0xABCDEF";
const CANON = "id:0x0000000000abcdef";

describe("wb_anim_debug contract", () => {
  it("loads and names the six handler actions", () => {
    expect(ANIM_DEBUG_CONTRACT.tool).toBe("wb_anim_debug");
    expect(HANDLER).toBe("EMCP_WB_AnimDebug");
    expect([...HANDLER_ACTIONS].sort()).toEqual(
      ["btBreakpoint", "command", "procAnim", "set", "tags", "vars"].sort(),
    );
  });

  it("its description fits the 400-char budget", () => {
    expect(wbAnimDebugDescription().length).toBeLessThanOrEqual(DESCRIPTION_MAX);
  });

  it("marks set, command and btBreakpoint mutating, none projectOnly", () => {
    for (const a of ANIM_DEBUG_CONTRACT.actions) {
      expect(a.mutating, a.name).toBe(["set", "command", "btBreakpoint"].includes(a.name));
      expect(a.projectOnly, a.name).toBe(false);
    }
  });

  it("the flat input shape carries every request key of the contract", () => {
    const keys = Object.keys(flatInputShape());
    for (const k of ANIM_DEBUG_CONTRACT.request) expect(keys).toContain(k);
  });

  it("every gate switch starts closed", () => {
    expect(ANIM_DEBUG_GATES).toEqual({ setCommand: false, btBreakpoint: false });
  });
});

describe("checkTarget", () => {
  it("takes entity:<ref> or a bare ref and answers the canonical bare ref", () => {
    expect(checkTarget(T)).toBe(CANON);
    expect(checkTarget("id:abcdef")).toBe(CANON);
    expect(checkTarget("name:Soldier")).toBe("name:Soldier");
    expect(checkTarget("entity:index:3")).toBe("index:3");
  });
  it("refuses an empty or malformed reference", () => {
    expect(() => checkTarget("")).toThrow(/empty/);
    expect(() => checkTarget("entity:")).toThrow(/empty/);
    expect(() => checkTarget("entity:Soldier")).toThrow();
    expect(() => checkTarget("id:zz")).toThrow(/hex/);
    expect(() => checkTarget("index:x")).toThrow();
  });
});

describe("value checks", () => {
  it("valueWhy", () => {
    expect(valueWhy("int", "-4")).toBeUndefined();
    expect(valueWhy("int", "1.5")).toMatch(/not an int/);
    expect(valueWhy("float", "0.25")).toBeUndefined();
    expect(valueWhy("float", "x")).toMatch(/not a float/);
    expect(valueWhy("bool", "TRUE")).toBeUndefined();
    expect(valueWhy("bool", "yes")).toMatch(/true, false, 1 or 0/);
  });
  it("sameValue", () => {
    expect(sameValue("bool", "1", "true")).toBe(true);
    expect(sameValue("bool", "0", "true")).toBe(false);
    expect(sameValue("float", "0.5", "0.50")).toBe(true);
    expect(sameValue("int", "3", "4")).toBe(false);
  });
  it("formatFloat", () => {
    expect(formatFloat(0.75)).toBe("0.75");
    expect(formatFloat(1e-7)).toBe("0.0000001");
    expect(() => formatFloat(Number.NaN)).toThrow(/float/);
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
    refuse({ action: "nope", target: T }, "INVALID_ARGUMENT", /unknown action/));
  it("a missing target", () =>
    refuse({ action: "tags", names: ["a"] }, "INVALID_ARGUMENT", /target/));
  it("an empty target", () =>
    refuse({ action: "tags", target: " ", names: ["a"] }, "INVALID_ARGUMENT", /empty/));
  it("a target that is not an entity reference", () =>
    refuse({ action: "tags", target: "entity:Soldier", names: ["a"] }, "INVALID_ARGUMENT"));
  it("a key the action does not take", () =>
    refuse({ action: "procAnim", target: T, names: ["a"] }, "INVALID_ARGUMENT"));
  it("vars without varTypes", () =>
    refuse({ action: "vars", target: T, names: ["a"] }, "INVALID_ARGUMENT", /varTypes/));
  it("vars with no names", () =>
    refuse(
      { action: "vars", target: T, names: [], varTypes: [] },
      "INVALID_ARGUMENT",
      /at least one/,
    ));
  it("vars with too many names", () => {
    const names = Array.from({ length: MAX_NAMES + 1 }, (_, i) => `v${i}`);
    refuse(
      { action: "vars", target: T, names, varTypes: names.map(() => "int") },
      "INVALID_ARGUMENT",
      /at most 64/,
    );
  });
  it("vars with an empty name", () =>
    refuse(
      { action: "vars", target: T, names: ["a", " "], varTypes: ["int", "int"] },
      "INVALID_ARGUMENT",
      /names\[1\]/,
    ));
  it("vars with a varTypes count that differs", () =>
    refuse(
      { action: "vars", target: T, names: ["a", "b"], varTypes: ["int"] },
      "INVALID_ARGUMENT",
      /1 types/,
    ));
  it("vars with an unknown type", () =>
    refuse(
      { action: "vars", target: T, names: ["a"], varTypes: ["string"] },
      "INVALID_ARGUMENT",
      /varTypes\[0\]/,
    ));
  it("tags with a bad kind", () =>
    refuse({ action: "tags", target: T, names: ["a"], kind: "state" }, "INVALID_ARGUMENT", /kind/));
  it("procAnim with a negative ctrl", () =>
    refuse({ action: "procAnim", target: T, ctrl: -1 }, "INVALID_ARGUMENT", /ctrl/));
  it("set without a name", () =>
    refuse(
      { action: "set", target: T, name: " ", varType: "int", value: "1" },
      "INVALID_ARGUMENT",
      /name/,
    ));
  it("set with a bad varType", () =>
    refuse(
      { action: "set", target: T, name: "a", varType: "str", value: "1" },
      "INVALID_ARGUMENT",
      /varType/,
    ));
  it("set with a value that does not fit its type", () => {
    refuse(
      { action: "set", target: T, name: "a", varType: "int", value: "1.5" },
      "INVALID_ARGUMENT",
      /not an int/,
    );
    refuse(
      { action: "set", target: T, name: "a", varType: "float", value: "x" },
      "INVALID_ARGUMENT",
      /not a float/,
    );
    refuse(
      { action: "set", target: T, name: "a", varType: "bool", value: "maybe" },
      "INVALID_ARGUMENT",
      /true, false/,
    );
  });
  it("set with a NaN value", () =>
    refuse(
      { action: "set", target: T, name: "a", varType: "float", value: Number.NaN },
      "INVALID_ARGUMENT",
      /float/,
    ));
  it("command without a name", () =>
    refuse({ action: "command", target: T, name: "" }, "INVALID_ARGUMENT", /name/));
  it("command with a floatParam that is not a number", () =>
    refuse(
      { action: "command", target: T, name: "Jump", floatParam: "x" },
      "INVALID_ARGUMENT",
      /floatParam/,
    ));
  it("btBreakpoint without enable", () =>
    refuse({ action: "btBreakpoint", target: T }, "INVALID_ARGUMENT", /enable/));
});

describe("request building", () => {
  it("sends the canonical bare reference, not the entity: prefix", () => {
    const p = prepareRequest({ action: "tags", target: T, names: ["Sprint"] });
    expect(p.ok).toBe(true);
    if (p.ok) {
      expect(p.params).toEqual({ action: "tags", target: CANON, names: ["Sprint"] });
      expect(p.target).toBe(`entity:${CANON}`);
      expect(p.mutating).toBe(false);
    }
  });

  it("sends numbers and booleans as text", () => {
    const f = prepareRequest({
      action: "set",
      target: T,
      name: "Speed",
      varType: "float",
      value: 0.5,
    });
    expect(f.ok && f.params.value).toBe("0.5");
    const b = prepareRequest({
      action: "set",
      target: T,
      name: "Aim",
      varType: "bool",
      value: true,
    });
    expect(b.ok && b.params.value).toBe("true");
    const i = prepareRequest({
      action: "set",
      target: T,
      name: "Stance",
      varType: "int",
      value: 2,
    });
    expect(i.ok && i.params.value).toBe("2");
    const c = prepareRequest({
      action: "command",
      target: T,
      name: "Jump",
      intParam: 1,
      floatParam: 0.25,
    });
    expect(c.ok && c.params.floatParam).toBe("0.25");
    expect(c.ok && c.mutating).toBe(true);
  });
});

describe("vars and tags", () => {
  it("vars: parses rows, keeps floats as text, warns about unknown names", async () => {
    const { client, sent } = fakeClient(() =>
      ok({
        values: ["Speed|float|3|1.250000", "Stance|int|4|2", "Missing|bool|-1|"],
        warnings: ["engine note"],
      }),
    );
    const r = await runAnimDebug(client, {
      action: "vars",
      target: T,
      names: ["Speed", "Stance", "Missing"],
      varTypes: ["float", "int", "bool"],
    });
    expect(sent[0]).toMatchObject({
      fn: HANDLER,
      params: {
        action: "vars",
        target: CANON,
        names: ["Speed", "Stance", "Missing"],
        varTypes: ["float", "int", "bool"],
      },
      options: { access: "read" },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.target).toBe(`entity:${CANON}`);
      expect(r.readback).toEqual({
        values: [
          { name: "Speed", type: "float", id: 3, known: true, value: "1.250000" },
          { name: "Stance", type: "int", id: 4, known: true, value: "2" },
          { name: "Missing", type: "bool", id: -1, known: false, value: "" },
        ],
      });
      expect(r.warnings).toEqual([
        "engine note",
        "no graph variable of this name (id -1): Missing",
      ]);
      expect(r.changed).toBeNull();
    }
  });

  it("tags: parses rows, defaults kind to tag, warns about unknown names", async () => {
    const { client, sent } = fakeClient(() =>
      ok({ values: ["Sprint|7|1", "Nope|-1|0"], warnings: [] }),
    );
    const r = await runAnimDebug(client, {
      action: "tags",
      target: "name:Soldier",
      names: ["Sprint", "Nope"],
    });
    expect(sent[0].params).toEqual({
      action: "tags",
      target: "name:Soldier",
      names: ["Sprint", "Nope"],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.readback).toEqual({
        kind: "tag",
        values: [
          { name: "Sprint", id: 7, known: true, on: true },
          { name: "Nope", id: -1, known: false, on: false },
        ],
      });
      expect(r.warnings).toHaveLength(1);
    }
  });

  it("tags with kind event", async () => {
    const { client, sent } = fakeClient(() => ok({ values: ["Fire|2|0"] }));
    const r = await runAnimDebug(client, {
      action: "tags",
      target: T,
      names: ["Fire"],
      kind: "event",
    });
    expect(sent[0].params.kind).toBe("event");
    expect(r.ok && (r.readback as { kind: string }).kind).toBe("event");
  });

  it("parse helpers tolerate short rows and a value holding |", () => {
    expect(parseVarRows(["a|int"])).toEqual([
      { name: "a", type: "int", id: -1, known: false, value: "" },
    ]);
    expect(parseVarRows(["a|int|1|x|y"])[0].value).toBe("x|y");
    expect(parseTagRows(["a"])[0]).toMatchObject({ id: -1, on: false });
    expect(parseIndexed(["3|Hips"])).toEqual([{ index: 3, name: "Hips" }]);
    expect(splitFixed("a|b", 3)).toEqual(["a", "b", ""]);
  });
});

describe("procAnim", () => {
  it("parses the controllers, signals, bones and slots", async () => {
    const { client, sent } = fakeClient(() =>
      ok({
        controllers: 2,
        signals: ["0|steer", "1|speed"],
        bones: ["0|Hips"],
        slots: [],
        warnings: [],
      }),
    );
    const r = await runAnimDebug(client, { action: "procAnim", target: T, ctrl: 1 });
    expect(sent[0].params).toEqual({ action: "procAnim", target: CANON, ctrl: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.readback).toEqual({
        ctrl: 1,
        controllers: 2,
        signals: [
          { index: 0, name: "steer" },
          { index: 1, name: "speed" },
        ],
        bones: [{ index: 0, name: "Hips" }],
        slots: [],
      });
      expect(r.warnings).toEqual([]);
    }
  });

  it("warns when the entity has no controller", async () => {
    const { client } = fakeClient(() => ok({ controllers: 0, signals: [], bones: [], slots: [] }));
    const r = await runAnimDebug(client, { action: "procAnim", target: T });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect((r.readback as { ctrl: number }).ctrl).toBe(0);
      expect(r.warnings.join(" ")).toMatch(/no ProcAnim controller/);
    }
  });
});

describe("handler refusals", () => {
  it("WRONG_MODE keeps the handler's own next (play, not edit)", async () => {
    const { client } = fakeClient(() =>
      refused("WRONG_MODE", "WRONG_MODE: not in play mode", "wb_world play"),
    );
    const r = await runAnimDebug(client, { action: "tags", target: T, names: ["a"] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("WRONG_MODE");
      expect(r.next).toBe("wb_world play");
    }
  });

  it.each(["ENTITY_NOT_FOUND", "NO_WORLD", "MODULE_NOT_OPEN", "INVALID_ARGUMENT"])(
    "maps %s",
    async (code) => {
      const { client } = fakeClient(() => refused(code));
      const r = await runAnimDebug(client, { action: "procAnim", target: T });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe(code);
    },
  );

  it("an unknown code falls back with a warning; an unknown status is UNREACHABLE", async () => {
    const a = fakeClient(() => ({ status: "error", code: "WEIRD", message: "m", next: "n" }));
    const r1 = await runAnimDebug(a.client, { action: "procAnim", target: T });
    expect(r1.ok).toBe(false);
    if (!r1.ok) {
      expect(r1.code).toBe("HANDLER_ERROR");
      expect(r1.warnings[0]).toMatch(/WEIRD/);
    }
    const b = fakeClient(() => ({ status: "weird" }));
    const r2 = await runAnimDebug(b.client, { action: "procAnim", target: T });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.code).toBe("UNREACHABLE");
  });

  it.each(["LOST", "MODAL_OPEN", "WEDGED"] as const)("maps WorkbenchError %s", async (code) => {
    const { client } = fakeClient(() => new WorkbenchError("x", code));
    const r = await runAnimDebug(client, { action: "procAnim", target: T });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(code);
  });

  it("any other client failure is UNREACHABLE", async () => {
    const { client } = fakeClient(() => new Error("ECONNREFUSED"));
    const r = await runAnimDebug(client, { action: "procAnim", target: T });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("UNREACHABLE");
  });
});

describe("set, command and btBreakpoint: GATED while their switches are closed", () => {
  it.each([
    [
      "set",
      { name: "Speed", varType: "float", value: "1" },
      /P-W4-19/,
      /ANIM_DEBUG_GATES\.setCommand/,
    ],
    ["command", { name: "Jump" }, /P-W4-19/, /ANIM_DEBUG_GATES\.setCommand/],
    ["btBreakpoint", { enable: true }, /P-W4-21/, /ANIM_DEBUG_GATES\.btBreakpoint/],
  ])(
    "%s answers GATED, names its probe and its switch, and sends nothing",
    async (action, rest, probe, sw) => {
      const { client, sent } = fakeClient(() => ok());
      const r = await runAnimDebug(client, { action, target: T, ...rest });
      expect(sent).toHaveLength(0);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.code).toBe("GATED");
        expect(r.message).toMatch(probe);
        expect(r.message).toMatch(sw);
      }
    },
  );

  it("a bad request refuses before the gate", async () => {
    const { client, sent } = fakeClient(() => ok());
    const r = await runAnimDebug(client, {
      action: "set",
      target: T,
      name: "a",
      varType: "int",
      value: "x",
    });
    expect(sent).toHaveLength(0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("INVALID_ARGUMENT");
  });
});

describe("set with the P-W4-19 switch open", () => {
  beforeEach(() => {
    ANIM_DEBUG_GATES.setCommand = true;
  });
  afterEach(() => {
    ANIM_DEBUG_GATES.setCommand = false;
  });

  const req = { action: "set", target: T, name: "Speed", varType: "float", value: 0.5 };

  it("sends a mutating call and answers before, after and one change", async () => {
    const { client, sent } = fakeClient(() =>
      ok({ before: ["Speed|float|3|0.000000"], after: ["Speed|float|3|0.500000"] }),
    );
    const r = await runAnimDebug(client, req);
    expect(sent[0]).toMatchObject({
      params: { action: "set", target: CANON, name: "Speed", varType: "float", value: "0.5" },
      options: { access: "mutate" },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.changed).toEqual([{ path: "Speed", before: "0.000000", after: "0.500000" }]);
      expect(r.warnings).toEqual([]);
      expect(r.next).toMatch(/inverse/);
    }
  });

  it("warns when the value read back differs from the value sent", async () => {
    const { client } = fakeClient(() =>
      ok({ before: ["Speed|float|3|0"], after: ["Speed|float|3|0.1"] }),
    );
    const r = await runAnimDebug(client, req);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.join(" ")).toMatch(/overwrite/);
  });

  it("the handler's own UNPROVEN refusal is passed through", async () => {
    const { client } = fakeClient(() =>
      refused("UNPROVEN", "set waits for P-W4-19", "read with vars"),
    );
    const r = await runAnimDebug(client, req);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("UNPROVEN");
      expect(r.next).toBe("read with vars");
    }
  });

  it("a lost set is never retried and points at vars", async () => {
    const { client, sent } = fakeClient(() => new WorkbenchError("reset", "LOST"));
    const r = await runAnimDebug(client, req);
    expect(sent).toHaveLength(1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.next).toMatch(/never retried.*vars/);
  });

  it("command answers the id and whether it was called", async () => {
    const { client, sent } = fakeClient(() => ok({ id: 5, called: true }));
    const r = await runAnimDebug(client, {
      action: "command",
      target: T,
      name: "Jump",
      intParam: 2,
      floatParam: 0.25,
    });
    expect(sent[0].params).toEqual({
      action: "command",
      target: CANON,
      name: "Jump",
      intParam: 2,
      floatParam: "0.25",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.readback).toEqual({ id: 5, called: true });
      expect(r.warnings).toEqual([]);
    }
  });

  it("command with an unknown name warns", async () => {
    const { client } = fakeClient(() => ok({ id: -1, called: false }));
    const r = await runAnimDebug(client, { action: "command", target: T, name: "Nope" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toHaveLength(2);
  });
});

describe("btBreakpoint with the P-W4-21 switch open", () => {
  beforeEach(() => {
    ANIM_DEBUG_GATES.btBreakpoint = true;
  });
  afterEach(() => {
    ANIM_DEBUG_GATES.btBreakpoint = false;
  });

  it("answers called and the requested state", async () => {
    const { client, sent } = fakeClient(() => ok({ called: 1 }));
    const r = await runAnimDebug(client, { action: "btBreakpoint", target: T, enable: true });
    expect(sent[0].params).toEqual({ action: "btBreakpoint", target: CANON, enable: true });
    expect(sent[0].options.access).toBe("mutate");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.readback).toEqual({ called: true, enable: true });
  });

  it("warns when nothing was called", async () => {
    const { client } = fakeClient(() => ok({ called: 0 }));
    const r = await runAnimDebug(client, { action: "btBreakpoint", target: T, enable: false });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toHaveLength(1);
  });
});

describe("registerWbAnimDebug", () => {
  it("registers a handler that drops undefined keys and wraps the answer", async () => {
    const { client } = fakeClient(() => ok({ controllers: 1, signals: [], bones: [], slots: [] }));
    const handler = captureTool((s) => registerWbAnimDebug(s, client));
    const res = await handler({ action: "procAnim", target: T, ctrl: undefined, names: undefined });
    expect(res.isError).toBeUndefined();
    expect(JSON.parse(textOf(res))).toMatchObject({ ok: true, action: "procAnim" });
  });

  it("a refusal comes back as an error result and sends nothing", async () => {
    const { client, sent } = fakeClient(() => ok());
    const handler = captureTool((s) => registerWbAnimDebug(s, client));
    const res = await handler({ action: "vars", target: T });
    expect(res.isError).toBe(true);
    expect(sent).toHaveLength(0);
    expect(JSON.parse(textOf(res))).toMatchObject({ ok: false, code: "INVALID_ARGUMENT" });
  });
});
