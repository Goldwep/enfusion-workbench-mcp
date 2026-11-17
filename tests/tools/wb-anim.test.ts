import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkbenchError } from "../../src/workbench/client.js";
import type { WorkbenchClient, WorkbenchCallOptions } from "../../src/workbench/client.js";
import { DESCRIPTION_MAX } from "../../src/manifest/generate.js";
import { ERROR_CODES } from "../../src/manifest/vocabulary.js";
import { parseLogFile } from "../../src/logs/parser.js";
import { FIND_UNUSED_CLIPS_DESCRIPTION } from "../../src/tools/animation-find-unused-clips.js";
import { WEAPON_POSE_LINT_DESCRIPTION } from "../../src/tools/weapon-pose-lint.js";
import {
  ANIM_CONTRACT,
  ANIM_GATES,
  CHECK_EXTENSIONS,
  HANDLER,
  HANDLER_ACTIONS,
  OWNER_STEP_OI_W4_1,
  checkFilePath,
  checkProfile,
  extractMarked,
  flatInputShape,
  formatFloat,
  isFloatText,
  makeLogReader,
  parseChannels,
  parseEvents,
  parseProfiles,
  parseProps,
  parseVars,
  prepareRequest,
  registerWbAnim,
  runAnim,
  splitFixed,
  wbAnimDescription,
  type LogRead,
} from "../../src/tools/wb-anim.js";
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

const TXA = "Anim/Fire.txa";
const APR = "$EMCPAddon:Anim/Rifle.apr";

describe("wb_anim contract", () => {
  it("loads and names the six handler actions", () => {
    expect(ANIM_CONTRACT.tool).toBe("wb_anim");
    expect(HANDLER).toBe("EMCP_WB_Anim");
    expect([...HANDLER_ACTIONS].sort()).toEqual(
      ["check", "txaChannels", "txaEdit", "txaExport", "txaProfiles", "txaRead"].sort(),
    );
  });

  it("its description fits the 400-char budget", () => {
    expect(wbAnimDescription().length).toBeLessThanOrEqual(DESCRIPTION_MAX);
  });

  it("marks the three writers mutating and the three reads not", () => {
    for (const a of ANIM_CONTRACT.actions) {
      expect(a.mutating, a.name).toBe(["check", "txaExport", "txaEdit"].includes(a.name));
      expect(a.projectOnly, a.name).toBe(["txaExport", "txaEdit"].includes(a.name));
    }
  });

  it("the flat input shape carries every request key of the contract", () => {
    const keys = Object.keys(flatInputShape());
    for (const k of ANIM_CONTRACT.request) expect(keys).toContain(k);
  });

  it("takes TXA_ERROR from the vocabulary with its default next", () => {
    expect(ERROR_CODES.TXA_ERROR).toMatch(/errMsg/);
  });

  it("every gate switch starts closed", () => {
    expect(ANIM_GATES).toEqual({ checkLogMarkers: false, txaEditWrite: false });
  });
});

describe("the trimmed 1.x lint tool descriptions (DEC-067 OD-7)", () => {
  it("animation_find_unused_clips is at most 400 characters and points at the KB page", () => {
    expect(FIND_UNUSED_CLIPS_DESCRIPTION.length).toBeLessThanOrEqual(400);
    expect(FIND_UNUSED_CLIPS_DESCRIPTION).toMatch(/anim-lint-tools/);
    expect(FIND_UNUSED_CLIPS_DESCRIPTION).toMatch(/include_workshop/);
  });
  it("weapon_pose_lint is at most 400 characters and points at the KB page", () => {
    expect(WEAPON_POSE_LINT_DESCRIPTION.length).toBeLessThanOrEqual(400);
    expect(WEAPON_POSE_LINT_DESCRIPTION).toMatch(/anim-lint-tools/);
    expect(WEAPON_POSE_LINT_DESCRIPTION).toMatch(/GlobalTags/);
  });
});

describe("float text", () => {
  it("formats numbers without an exponent", () => {
    expect(formatFloat(0.5)).toBe("0.5");
    expect(formatFloat(-3)).toBe("-3");
    expect(formatFloat(1e-7)).toBe("0.0000001");
    expect(formatFloat(1e-15)).toBe("0");
  });
  it("refuses a non-finite or huge value", () => {
    expect(() => formatFloat(Number.NaN)).toThrow(/float/);
    expect(() => formatFloat(Infinity)).toThrow(/float/);
    expect(() => formatFloat(1e22)).toThrow(/float/);
  });
  it("recognises float text", () => {
    for (const t of ["1", "-1.5", ".5", "2.", "1e3", "+0.25"]) expect(isFloatText(t), t).toBe(true);
    for (const t of ["", "abc", "1,5", "1.2.3", "0x10"]) expect(isFloatText(t), t).toBe(false);
  });
});

describe("path and profile checks", () => {
  it("checkFilePath keeps a GUID prefix and turns backslashes to slashes", () => {
    expect(checkFilePath("{0123456789ABCDEF}Anim\\a.agr")).toBe("{0123456789ABCDEF}Anim/a.agr");
    expect(checkFilePath("Anim\\a.agr")).toBe("Anim/a.agr");
    expect(() => checkFilePath("C:/a.agr")).toThrow(/absolute/);
    expect(() => checkFilePath("a/../b.agr")).toThrow(/'\.\.'/);
  });
  it("checkProfile takes $addon:path, a path or a name", () => {
    expect(checkProfile(APR)).toBe(APR);
    expect(checkProfile("Rifle")).toBe("Rifle");
    expect(() => checkProfile(" ")).toThrow(/empty/);
    expect(() => checkProfile("C:\\x\\Rifle.apr")).toThrow(/absolute/);
    expect(() => checkProfile("a/../Rifle.apr")).toThrow(/'\.\.'/);
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
  const exp = {
    action: "txaExport",
    profile: APR,
    target: "Anim/New.txa",
    frames: 2,
    fps: 30,
    channelCount: 2,
    keyData: [1, 2, 3, 4],
  };

  it("an unknown action", () => refuse({ action: "nope" }, "INVALID_ARGUMENT", /unknown action/));
  it("txaChannels without a profile", () =>
    refuse({ action: "txaChannels" }, "INVALID_ARGUMENT", /profile/));
  it("a key the action does not take", () =>
    refuse({ action: "txaProfiles", path: TXA }, "INVALID_ARGUMENT"));
  it("an empty addon", () =>
    refuse({ action: "txaProfiles", addon: " " }, "INVALID_ARGUMENT", /addon/));
  it("txaRead of a path that is not a .txa", () =>
    refuse({ action: "txaRead", path: "Anim/Fire.anm" }, "INVALID_ARGUMENT", /\.txa/));
  it("txaRead with an absolute path", () =>
    refuse({ action: "txaRead", path: "C:\\a\\Fire.txa" }, "ABSOLUTE_PATH"));
  it("txaRead with '..'", () =>
    refuse({ action: "txaRead", path: "a/../Fire.txa" }, "ABSOLUTE_PATH"));
  it("limit out of range", () => {
    refuse({ action: "txaRead", path: TXA, limit: 0 }, "INVALID_ARGUMENT", /limit/);
    refuse({ action: "txaRead", path: TXA, limit: 201 }, "INVALID_ARGUMENT", /limit/);
  });
  it("a malformed cursor", () =>
    refuse({ action: "txaRead", path: TXA, cursor: "abc" }, "INVALID_ARGUMENT", /cursor/));
  it("a cursor past its count", () =>
    refuse({ action: "txaRead", path: TXA, cursor: "9:3" }, "INVALID_ARGUMENT", /past/));
  it("check of a file no animation editor owns", () => {
    refuse({ action: "check", path: "Scripts/a.c" }, "INVALID_ARGUMENT", /Anim, Behavior/);
    refuse({ action: "check", path: "Prefabs/a.et" }, "INVALID_ARGUMENT", /Anim, Behavior/);
  });
  it("check with an absolute path", () =>
    refuse({ action: "check", path: "D:\\a.agr" }, "ABSOLUTE_PATH"));
  it("txaExport target that is not a .txa", () =>
    refuse({ ...exp, target: "Anim/New.anm" }, "INVALID_ARGUMENT", /\.txa/));
  it("txaExport with frames, fps or channelCount under 1", () => {
    refuse({ ...exp, frames: 0 }, "INVALID_ARGUMENT", /at least 1/);
    refuse({ ...exp, fps: 0 }, "INVALID_ARGUMENT", /at least 1/);
    refuse({ ...exp, channelCount: 0 }, "INVALID_ARGUMENT", /at least 1/);
  });
  it("txaExport with keyData that is not a multiple of channelCount * frames", () =>
    refuse(
      { ...exp, keyData: [1, 2, 3] },
      "INVALID_ARGUMENT",
      /multiple of channelCount \* frames = 4/,
    ));
  it("txaExport with empty keyData", () =>
    refuse({ ...exp, keyData: [] }, "INVALID_ARGUMENT", /multiple/));
  it("txaExport keyData holding text that is not a number", () =>
    refuse({ ...exp, keyData: ["1", "x", "3", "4"] }, "INVALID_ARGUMENT", /keyData\[1\]/));
  it("txaExport keyData holding NaN", () =>
    refuse({ ...exp, keyData: [1, Number.NaN, 3, 4] }, "INVALID_ARGUMENT", /float/));
  it("txaExport diffData holding text that is not a number", () =>
    refuse({ ...exp, diffData: ["z"] }, "INVALID_ARGUMENT", /diffData/));
  it("txaExport without a required key", () => {
    const { fps: _fps, ...rest } = exp;
    refuse(rest, "INVALID_ARGUMENT", /fps/);
  });
  it("txaEdit with an unknown op", () =>
    refuse({ action: "txaEdit", path: TXA, op: "move" }, "INVALID_ARGUMENT", /op must be/));
  it("txaEdit add without eventType", () =>
    refuse({ action: "txaEdit", path: TXA, op: "add" }, "INVALID_ARGUMENT", /eventType/));
  it("txaEdit add with a bad eventType", () =>
    refuse(
      { action: "txaEdit", path: TXA, op: "add", eventType: "x" },
      "INVALID_ARGUMENT",
      /eventType/,
    ));
  it("txaEdit erase without an index", () =>
    refuse({ action: "txaEdit", path: TXA, op: "erase" }, "INVALID_ARGUMENT", /index/));
  it("txaEdit edit with a negative index", () =>
    refuse(
      { action: "txaEdit", path: TXA, op: "edit", index: -1, fields: ["a"], values: ["1"] },
      "INVALID_ARGUMENT",
      /index/,
    ));
  it("txaEdit edit without fields", () =>
    refuse({ action: "txaEdit", path: TXA, op: "edit", index: 0 }, "INVALID_ARGUMENT", /fields/));
  it("txaEdit fields and values of different length", () =>
    refuse(
      { action: "txaEdit", path: TXA, op: "edit", index: 0, fields: ["a", "b"], values: ["1"] },
      "INVALID_ARGUMENT",
      /same length/,
    ));
  it("txaEdit setProp without propName or propValue", () => {
    refuse(
      { action: "txaEdit", path: TXA, op: "setProp", propValue: "1" },
      "INVALID_ARGUMENT",
      /propName/,
    );
    refuse(
      { action: "txaEdit", path: TXA, op: "setProp", propName: "x" },
      "INVALID_ARGUMENT",
      /propValue/,
    );
  });
  it("txaEdit eventType on a op other than add", () =>
    refuse(
      { action: "txaEdit", path: TXA, op: "erase", index: 0, eventType: "audio" },
      "INVALID_ARGUMENT",
      /op add only/,
    ));
  it("txaEdit propName on a op other than setProp", () =>
    refuse(
      { action: "txaEdit", path: TXA, op: "clearProps", propName: "x" },
      "INVALID_ARGUMENT",
      /setProp only/,
    ));
  it("txaEdit fields on erase", () =>
    refuse(
      { action: "txaEdit", path: TXA, op: "erase", index: 0, fields: ["a"], values: ["1"] },
      "INVALID_ARGUMENT",
      /add and edit only/,
    ));
});

describe("request building", () => {
  it("sends floats as strings and the dry-run flag explicitly", () => {
    const p = prepareRequest({
      action: "txaExport",
      profile: APR,
      target: "Anim\\New.txa",
      frames: 2,
      fps: 30,
      channelCount: 1,
      keyData: [0.5, -1, 1e-7, "2.25"],
      diffData: [0.1, 0.2],
    });
    expect(p.ok).toBe(true);
    if (p.ok) {
      expect(p.mutating).toBe(true);
      expect(p.params.keyData).toEqual(["0.5", "-1", "0.0000001", "2.25"]);
      expect(p.params.diffData).toEqual(["0.1", "0.2"]);
      expect(p.params.target).toBe("Anim/New.txa");
      expect(p.params.confirm).toBe(false);
      expect(p.target).toBe("path:Anim/New.txa");
    }
  });

  it("turns number and boolean text keys to strings", () => {
    const p = prepareRequest({
      action: "txaEdit",
      path: TXA,
      op: "edit",
      index: 1,
      fields: ["Time", "Loop"],
      values: [0.25, true],
    });
    expect(p.ok).toBe(true);
    if (p.ok) expect(p.params.values).toEqual(["0.25", "true"]);
    const q = prepareRequest({
      action: "txaEdit",
      path: TXA,
      op: "setProp",
      propName: "speed",
      propValue: 3,
    });
    expect(q.ok).toBe(true);
    if (q.ok) expect(q.params.propValue).toBe("3");
  });

  it("a read sends no confirm and takes the read route", () => {
    const p = prepareRequest({ action: "txaRead", path: "Anim\\Fire.txa", limit: 10 });
    expect(p.ok).toBe(true);
    if (p.ok) {
      expect(p.mutating).toBe(false);
      expect(p.params).toEqual({ action: "txaRead", path: "Anim/Fire.txa", limit: 10 });
    }
  });

  it("check keeps a GUID path and is a mutating (opens a file) call", () => {
    const p = prepareRequest({ action: "check", path: "{0123456789ABCDEF}Anim/a.agr" });
    expect(p.ok).toBe(true);
    if (p.ok) {
      expect(p.mutating).toBe(true);
      expect(p.params.path).toBe("{0123456789ABCDEF}Anim/a.agr");
    }
  });

  it("every check extension is accepted", () => {
    for (const ext of CHECK_EXTENSIONS) {
      expect(prepareRequest({ action: "check", path: `Anim/x${ext}` }).ok, ext).toBe(true);
    }
  });
});

describe("OI-W4-1: no profile is found", () => {
  const noProfile = refused(
    "RESOURCE_NOT_FOUND",
    "RESOURCE_NOT_FOUND: no animation export profile (.apr) in any loaded addon",
    OWNER_STEP_OI_W4_1,
  );

  it.each([
    ["txaProfiles", {}],
    ["txaChannels", { profile: APR }],
    ["txaRead", { path: TXA }],
    [
      "txaExport",
      { profile: APR, target: "Anim/New.txa", frames: 1, fps: 30, channelCount: 1, keyData: [1] },
    ],
    ["txaEdit", { path: TXA, op: "clearProps" }],
  ])("%s answers RESOURCE_NOT_FOUND with the owner step in next", async (action, rest) => {
    const { client, sent } = fakeClient(() => noProfile);
    const r = await runAnim(client, { action, ...rest });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("RESOURCE_NOT_FOUND");
      expect(r.next).toContain("OI-W4-1");
      expect(r.next).toContain(".apr");
    }
    expect(sent).toHaveLength(1);
  });

  it("adds the owner step when the handler's next lacks it", async () => {
    const { client } = fakeClient(() =>
      refused("RESOURCE_NOT_FOUND", "no profile .apr in the loaded addons", "look again"),
    );
    const r = await runAnim(client, { action: "txaProfiles" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.next).toMatch(/look again.*OI-W4-1/);
  });

  it("txaProfiles that answers ok with none says so and never invents a profile", async () => {
    const { client } = fakeClient(() => ok({ profiles: [], total: 0, warnings: [] }));
    const r = await runAnim(client, { action: "txaProfiles" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect((r.readback as { profiles: unknown[] }).profiles).toEqual([]);
      expect(r.warnings.join(" ")).toMatch(/no animation export profile/);
      expect(r.next).toContain("OI-W4-1");
    }
  });

  it("a RESOURCE_NOT_FOUND that names neither .apr nor a profile keeps the handler's next", async () => {
    const { client } = fakeClient(() =>
      refused("RESOURCE_NOT_FOUND", "no resource with that GUID", "search for it"),
    );
    const r = await runAnim(client, { action: "txaChannels", profile: "Rifle" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("RESOURCE_NOT_FOUND");
      expect(r.next).toBe("search for it");
    }
  });
});

describe("txaProfiles and txaChannels", () => {
  it("parses profile rows and sends the addon", async () => {
    const { client, sent } = fakeClient(() =>
      ok({
        profiles: ["Rifle|12|$EMCPAddon:Anim/Rifle.apr", "Pistol|9|$EMCPAddon:Anim/Pistol.apr"],
        total: 2,
        warnings: ["one folder had no profile"],
      }),
    );
    const r = await runAnim(client, { action: "txaProfiles", addon: "EMCPAddon" });
    expect(sent[0]).toMatchObject({
      fn: HANDLER,
      params: { action: "txaProfiles", addon: "EMCPAddon" },
      options: { access: "read" },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.readback).toEqual({
        total: 2,
        profiles: [
          { name: "Rifle", channels: 12, path: "$EMCPAddon:Anim/Rifle.apr" },
          { name: "Pistol", channels: 9, path: "$EMCPAddon:Anim/Pistol.apr" },
        ],
      });
      expect(r.warnings).toEqual(["one folder had no profile"]);
      expect(r.changed).toBeNull();
    }
  });

  it("parses channel rows and carries errCode and errMsg", async () => {
    const { client } = fakeClient(() =>
      ok({
        channels: ["0|Hips|Position", "1|Spine|Rotation|extra"],
        total: 2,
        errCode: 0,
        errMsg: "",
      }),
    );
    const r = await runAnim(client, { action: "txaChannels", profile: APR });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.target).toBe(`profile:${APR}`);
      expect(r.readback).toMatchObject({
        total: 2,
        channels: [
          { index: 0, name: "Hips", genFn: "Position" },
          { index: 1, name: "Spine", genFn: "Rotation|extra" },
        ],
        errCode: 0,
      });
    }
  });

  it("a TxaExporter warning (errCode 1) answers ok with the message in warnings", async () => {
    const { client } = fakeClient(() =>
      ok({
        channels: ["0|Hips|Position"],
        total: 1,
        errCode: 1,
        errMsg: "profile has a duplicate",
      }),
    );
    const r = await runAnim(client, { action: "txaChannels", profile: APR });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toContain("TxaExporter warning: profile has a duplicate");
  });

  it("parse helpers tolerate short rows", () => {
    expect(parseProfiles(["Rifle"])).toEqual([{ name: "Rifle", channels: 0, path: "" }]);
    expect(parseChannels(["x|y"])).toEqual([{ index: -1, name: "y", genFn: "" }]);
    expect(splitFixed("a|b|c|d", 3)).toEqual(["a", "b", "c|d"]);
  });
});

describe("TXA_ERROR", () => {
  it("is mapped with errCode and errMsg kept", async () => {
    const { client } = fakeClient(() => ({
      status: "error",
      code: "TXA_ERROR",
      message: "TXA_ERROR: LoadProfiles: bad header",
      next: "check the profile",
      errCode: 2,
      errMsg: "bad header",
    }));
    const r = await runAnim(client, { action: "txaChannels", profile: APR });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("TXA_ERROR");
      expect(r.txa).toEqual({ errCode: 2, errMsg: "bad header" });
      expect(r.next).toBe("check the profile");
    }
  });

  it("a TXA_ERROR with no next gets the local default", async () => {
    const { client } = fakeClient(() => ({
      status: "error",
      code: "TXA_ERROR",
      message: "x",
      errCode: 2,
      errMsg: "boom",
    }));
    const r = await runAnim(client, { action: "txaRead", path: TXA });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.next).toBe(ERROR_CODES.TXA_ERROR);
  });
});

describe("txaRead and paging", () => {
  const page1 = ok({
    path: TXA,
    eventCount: 5,
    events: ["0|AnimEvtGeneric|Time=0.1;Name=a;b|c", "1|AnimEvtAudio|Time=0.2"],
    props: ["speed=3", "note=a=b"],
    nextCursor: "2:5",
    errCode: 0,
    errMsg: "",
  });

  it("parses events and props and offers the next cursor", async () => {
    const { client, sent } = fakeClient(() => page1);
    const r = await runAnim(client, {
      action: "txaRead",
      path: TXA,
      hint: "Src\\Fire.fbx",
      propNames: ["speed", "note"],
      limit: 2,
    });
    expect(sent[0].params).toEqual({
      action: "txaRead",
      path: TXA,
      hint: "Src/Fire.fbx",
      propNames: ["speed", "note"],
      limit: 2,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const rb = r.readback as {
        eventCount: number;
        events: Array<{ index: number; className: string; vars: unknown[]; raw: string }>;
        props: unknown[];
        nextCursor: string | null;
      };
      expect(rb.eventCount).toBe(5);
      expect(rb.events[0]).toMatchObject({
        index: 0,
        className: "AnimEvtGeneric",
        vars: [
          { name: "Time", value: "0.1" },
          { name: "Name", value: "a;b|c" },
        ],
      });
      expect(rb.events[1].vars).toEqual([{ name: "Time", value: "0.2" }]);
      expect(rb.props).toEqual([
        { name: "speed", value: "3" },
        { name: "note", value: "a=b" },
      ]);
      expect(rb.nextCursor).toBe("2:5");
      expect(r.next).toContain('cursor "2:5"');
    }
  });

  it("sends the cursor unchanged and ends with a null cursor", async () => {
    const { client, sent } = fakeClient(() =>
      ok({
        path: TXA,
        eventCount: 5,
        events: ["4|AnimEvtGeneric|Time=0.9"],
        props: [],
        nextCursor: "",
      }),
    );
    const r = await runAnim(client, { action: "txaRead", path: TXA, cursor: "4:5" });
    expect(sent[0].params.cursor).toBe("4:5");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect((r.readback as { nextCursor: unknown }).nextCursor).toBeNull();
      expect(r.next).toBeUndefined();
    }
  });

  it("maps STALE_CURSOR", async () => {
    const { client } = fakeClient(() =>
      refused("STALE_CURSOR", "the track now has 6 events", "read again without a cursor"),
    );
    const r = await runAnim(client, { action: "txaRead", path: TXA, cursor: "2:5" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("STALE_CURSOR");
      expect(r.next).toBe("read again without a cursor");
    }
  });

  it("maps PATH_NOT_FOUND", async () => {
    const { client } = fakeClient(() => ({
      status: "error",
      code: "PATH_NOT_FOUND",
      message: "no file",
      next: "a .txa that exists",
    }));
    const r = await runAnim(client, { action: "txaRead", path: TXA });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("PATH_NOT_FOUND");
  });

  it("parseVars / parseEvents / parseProps edge cases", () => {
    expect(parseVars("")).toEqual([]);
    expect(parseVars("lonely")).toEqual([{ name: "lonely", value: "" }]);
    expect(parseEvents(["bad"])[0]).toMatchObject({ index: -1, className: "", vars: [] });
    expect(parseProps(["x"])).toEqual([{ name: "x", value: "" }]);
  });
});

describe("txaExport", () => {
  const input = {
    action: "txaExport",
    profile: APR,
    target: "Anim/New.txa",
    source: "fire.fbx",
    frames: 2,
    fps: 30,
    channelCount: 2,
    keyData: [0, 1, 0.5, 0.25],
  };

  it("a dry run sends confirm false and says how to write", async () => {
    const { client, sent } = fakeClient(() =>
      ok({ target: "Anim/New.txa", dryRun: true, written: false, warnings: [] }),
    );
    const r = await runAnim(client, input);
    expect(sent[0].params.confirm).toBe(false);
    expect(sent[0].options.access).toBe("mutate");
    expect(sent[0].options.timeout).toBeGreaterThanOrEqual(60_000);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.changed).toBeNull();
      expect(r.next).toMatch(/confirm: true/);
      expect(r.readback).toMatchObject({ dryRun: true, written: false });
    }
  });

  it("a confirmed write answers what was created, registered and rebuilt", async () => {
    const { client, sent } = fakeClient(() =>
      ok({
        target: "Anim/New.txa",
        dryRun: false,
        written: true,
        registered: true,
        rebuilt: true,
        warnings: ["rebuild took 4s"],
        errCode: 0,
        errMsg: "",
      }),
    );
    const r = await runAnim(client, { ...input, confirm: true });
    expect(sent[0].params.confirm).toBe(true);
    expect(sent[0].params.keyData).toEqual(["0", "1", "0.5", "0.25"]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.changed).toEqual([{ path: "Anim/New.txa", before: null, after: "created" }]);
      expect(r.readback).toMatchObject({ written: true, registered: true, rebuilt: true });
      expect(r.warnings).toEqual(["rebuild took 4s"]);
    }
  });

  it("warns when the handler does not confirm the write, the registration or the rebuild", async () => {
    const { client } = fakeClient(() => ok({ target: "Anim/New.txa", dryRun: false }));
    const r = await runAnim(client, { ...input, confirm: true });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toHaveLength(3);
  });

  it.each([
    ["NOT_IN_PROJECT", "refused"],
    ["INVALID_ARGUMENT", "error"],
    ["SAVE_FAILED", "error"],
    ["TXA_ERROR", "error"],
  ])("maps %s", async (code, status) => {
    const { client } = fakeClient(() => ({ status, code, message: "m", next: "n" }));
    const r = await runAnim(client, { ...input, confirm: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(code);
  });

  it("a lost write is never retried and points at a read-back", async () => {
    const { client, sent } = fakeClient(() => new WorkbenchError("queue reset", "LOST"));
    const r = await runAnim(client, { ...input, confirm: true });
    expect(sent).toHaveLength(1);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("LOST");
      expect(r.next).toMatch(/never retried/);
      expect(r.next).toMatch(/txaRead/);
    }
  });
});

describe("txaEdit", () => {
  const edit = {
    action: "txaEdit",
    path: TXA,
    op: "edit",
    index: 0,
    fields: ["Time"],
    values: ["0.3"],
  };

  it("a dry run reaches the handler and answers before and the resend hint", async () => {
    const { client, sent } = fakeClient(() =>
      ok({
        path: TXA,
        before: ["0|AnimEvtGeneric|Time=0.1"],
        after: [],
        dryRun: true,
        written: false,
      }),
    );
    const r = await runAnim(client, edit);
    expect(sent).toHaveLength(1);
    expect(sent[0].params.confirm).toBe(false);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.changed).toBeNull();
      expect(r.readback).toMatchObject({ dryRun: true, before: ["0|AnimEvtGeneric|Time=0.1"] });
    }
  });

  it("confirm is GATED (P-W4-06) while the switch is closed, and nothing is sent", async () => {
    const { client, sent } = fakeClient(() => ok());
    const r = await runAnim(client, { ...edit, confirm: true });
    expect(sent).toHaveLength(0);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("GATED");
      expect(r.message).toMatch(/P-W4-06/);
      expect(r.message).toMatch(/ANIM_GATES\.txaEditWrite/);
    }
  });

  describe("with the P-W4-06 switch open", () => {
    beforeEach(() => {
      ANIM_GATES.txaEditWrite = true;
    });
    afterEach(() => {
      ANIM_GATES.txaEditWrite = false;
    });

    it("a confirmed edit answers before, after and one change", async () => {
      const { client, sent } = fakeClient(() =>
        ok({
          path: TXA,
          before: ["0|AnimEvtGeneric|Time=0.1"],
          after: ["0|AnimEvtGeneric|Time=0.3"],
          eventCount: 1,
          dryRun: false,
          written: true,
        }),
      );
      const r = await runAnim(client, { ...edit, confirm: true });
      expect(sent[0].params.confirm).toBe(true);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.changed).toEqual([
          {
            path: TXA,
            before: ["0|AnimEvtGeneric|Time=0.1"],
            after: ["0|AnimEvtGeneric|Time=0.3"],
          },
        ]);
        expect(r.warnings).toEqual([]);
      }
    });

    it("the handler's own UNPROVEN refusal is passed through", async () => {
      const { client } = fakeClient(() =>
        refused("UNPROVEN", "txaEdit writes wait for P-W4-06", "txaExport"),
      );
      const r = await runAnim(client, { ...edit, confirm: true });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.code).toBe("UNPROVEN");
        expect(r.next).toBe("txaExport");
      }
    });

    it("maps ITEM_NOT_FOUND and TXA_ERROR", async () => {
      for (const code of ["ITEM_NOT_FOUND", "TXA_ERROR"]) {
        const { client } = fakeClient(() => ({ status: "error", code, message: "m", next: "n" }));
        const r = await runAnim(client, { ...edit, confirm: true });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.code).toBe(code);
      }
    });

    it("warns when the write is not confirmed", async () => {
      const { client } = fakeClient(() =>
        ok({ path: TXA, before: ["a"], after: ["b"], dryRun: false }),
      );
      const r = await runAnim(client, { ...edit, confirm: true });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.warnings.join(" ")).toMatch(/not report the .txa written/);
    });
  });
});

describe("check and the log-marker reader", () => {
  const checkAnswer = {
    path: "Anim/a.agr",
    openedIn: "AnimEditor",
    result: 1,
    marker: "EMCP_CHECK_7",
    docClass: "AnimSrcGraph",
  };
  const line = (time: string, level: "" | "(W)" | "(E)", msg: string) =>
    `${time}  RESOURCES  ${level}: ${msg}`.replace("  : ", "  : ");

  /** A parsed console.log from raw lines. */
  function parsed(raw: string[]) {
    const dir = mkdtempSync(join(tmpdir(), "wb-anim-log-"));
    const file = join(dir, "console.log");
    writeFileSync(file, raw.join("\n") + "\n", "utf-8");
    try {
      return parseLogFile(file);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  const FULL = [
    "Log started",
    line("12:00:00.100", "", "EMCP_CHECK_7 begin"),
    line("12:00:00.200", "(W)", "Anim/a.agr: unused node"),
    line("12:00:00.300", "(E)", "Anim/a.agr: dangling reference {0123}"),
    line("12:00:00.400", "", "loaded Anim/a.agr"),
    line("12:00:00.500", "", "EMCP_CHECK_7 end"),
    line("12:00:00.600", "(E)", "elsewhere: not in the span"),
  ];

  it("check is GATED (P-W4-14) while the switch is closed, and nothing is sent", async () => {
    const { client, sent } = fakeClient(() => ok(checkAnswer));
    const r = await runAnim(client, { action: "check", path: "Anim/a.agr" });
    expect(sent).toHaveLength(0);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("GATED");
      expect(r.message).toMatch(/P-W4-14/);
      expect(r.message).toMatch(/ANIM_GATES\.checkLogMarkers/);
    }
  });

  it("a bad request refuses before the gate", async () => {
    const { client, sent } = fakeClient(() => ok());
    const r = await runAnim(client, { action: "check", path: "Scripts/a.c" });
    expect(sent).toHaveLength(0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("INVALID_ARGUMENT");
  });

  describe("extractMarked", () => {
    it("takes the lines strictly between the markers", () => {
      const r = extractMarked(parsed(FULL), "EMCP_CHECK_7");
      expect(r.found).toBe(true);
      expect(r.complete).toBe(true);
      expect(r.lines).toHaveLength(3);
      expect(r.errors).toHaveLength(1);
      expect(r.errors[0]).toMatch(/dangling reference/);
      expect(r.warnings).toHaveLength(1);
      expect(r.errors.join(" ")).not.toMatch(/elsewhere/);
    });

    it("a marker that is not there", () => {
      const r = extractMarked(parsed(FULL), "OTHER");
      expect(r).toMatchObject({ found: false, complete: false, lines: [] });
      expect(r.note).toMatch(/not in the log/);
    });

    it("a missing end marker is incomplete, not clean", () => {
      const r = extractMarked(parsed(FULL.slice(0, 4)), "EMCP_CHECK_7");
      expect(r.found).toBe(true);
      expect(r.complete).toBe(false);
      expect(r.note).toMatch(/end marker/);
      expect(r.errors).toHaveLength(1);
    });

    it("an empty marker", () => {
      expect(extractMarked(parsed(FULL), "").note).toMatch(/no marker/);
    });

    it("an empty span", () => {
      const r = extractMarked(
        parsed([line("12:00:00.100", "", "M1 begin"), line("12:00:00.200", "", "M1 end")]),
        "M1",
      );
      expect(r).toMatchObject({ found: true, complete: true, lines: [], errors: [] });
    });
  });

  describe("makeLogReader", () => {
    let root = "";
    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), "wb-anim-logs-"));
    });
    afterEach(() => {
      rmSync(root, { recursive: true, force: true });
    });

    function session(name: string, lines: string[]) {
      const dir = join(root, name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "console.log"), lines.join("\n") + "\n", "utf-8");
    }

    it("reads the newest session's console.log", async () => {
      session("logs_2026-11-12_08-00-00", [line("08:00:00.100", "", "EMCP_CHECK_7 begin")]);
      session("logs_2026-11-12_09-00-00", FULL);
      const read = makeLogReader(root, { sleep: async () => {} });
      const r = await read("EMCP_CHECK_7");
      expect(r.complete).toBe(true);
      expect(r.session).toBe("logs_2026-11-12_09-00-00");
      expect(r.errors).toHaveLength(1);
    });

    it("re-reads while the end marker is missing, then gives up honestly", async () => {
      session("logs_2026-11-12_09-00-00", FULL.slice(0, 4));
      let sleeps = 0;
      const read = makeLogReader(root, { sleep: async () => void sleeps++, attempts: 3 });
      const r = await read("EMCP_CHECK_7");
      expect(sleeps).toBe(2);
      expect(r.complete).toBe(false);
      expect(r.found).toBe(true);
    });

    it("no session at all", async () => {
      const read = makeLogReader(root, { sleep: async () => {} });
      const r = await read("EMCP_CHECK_7");
      expect(r.found).toBe(false);
      expect(r.note).toMatch(/no Workbench log session/);
    });
  });

  describe("with the P-W4-14 switch open", () => {
    beforeEach(() => {
      ANIM_GATES.checkLogMarkers = true;
    });
    afterEach(() => {
      ANIM_GATES.checkLogMarkers = false;
    });

    const reader = (log: LogRead) => async () => log;
    const full: LogRead = {
      found: true,
      complete: true,
      lines: ["l1", "l2"],
      errors: ["E: dangling"],
      warnings: ["W: unused"],
      session: "logs_x",
    };

    it("sends a mutating call and reports the errors between the markers", async () => {
      const { client, sent } = fakeClient(() => ok(checkAnswer));
      const r = await runAnim(
        client,
        { action: "check", path: "Anim\\a.agr" },
        { readLog: reader(full) },
      );
      expect(sent[0]).toMatchObject({
        fn: HANDLER,
        params: { action: "check", path: "Anim/a.agr" },
        options: { access: "mutate" },
      });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.changed).toBeNull();
        expect(r.readback).toMatchObject({
          openedIn: "AnimEditor",
          result: true,
          docClass: "AnimSrcGraph",
          marker: "EMCP_CHECK_7",
          log: {
            read: true,
            errorCount: 1,
            errors: ["E: dangling"],
            clean: false,
            session: "logs_x",
          },
        });
        expect(r.next).toMatch(/Fix what the log lines name/);
      }
    });

    it("a clean span is clean only when the open call returned true", async () => {
      const clean: LogRead = { ...full, errors: [], warnings: [] };
      const a = fakeClient(() => ok(checkAnswer));
      const r1 = await runAnim(
        a.client,
        { action: "check", path: "Anim/a.agr" },
        { readLog: reader(clean) },
      );
      expect(r1.ok && (r1.readback as { log: { clean: boolean } }).log.clean).toBe(true);
      const b = fakeClient(() => ok({ ...checkAnswer, result: 0 }));
      const r2 = await runAnim(
        b.client,
        { action: "check", path: "Anim/a.agr" },
        { readLog: reader(clean) },
      );
      expect(r2.ok).toBe(true);
      if (r2.ok) {
        expect((r2.readback as { log: { clean: boolean } }).log.clean).toBe(false);
        expect(r2.warnings.join(" ")).toMatch(/returned false/);
      }
    });

    it("an incomplete log read claims nothing about errors", async () => {
      const partial: LogRead = {
        ...full,
        complete: false,
        note: "the end marker is not in the log (yet)",
      };
      const { client } = fakeClient(() => ok(checkAnswer));
      const r = await runAnim(
        client,
        { action: "check", path: "Anim/a.agr" },
        { readLog: reader(partial) },
      );
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect((r.readback as { log: { clean: unknown; read: boolean } }).log).toMatchObject({
          read: false,
          clean: null,
        });
        expect(r.warnings).toContain("the end marker is not in the log (yet)");
        expect(r.next).toMatch(/not read in full/);
      }
    });

    it("no log reader: the check answers and says the log was not read", async () => {
      const { client } = fakeClient(() => ok(checkAnswer));
      const r = await runAnim(client, { action: "check", path: "Anim/a.agr" });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.warnings.join(" ")).toMatch(/log was not read/);
        expect((r.readback as { log: { clean: unknown } }).log.clean).toBeNull();
      }
    });

    it("no marker from the handler: the log is not read", async () => {
      let called = false;
      const { client } = fakeClient(() => ok({ ...checkAnswer, marker: "" }));
      const r = await runAnim(
        client,
        { action: "check", path: "Anim/a.agr" },
        {
          readLog: async () => {
            called = true;
            return full;
          },
        },
      );
      expect(called).toBe(false);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.warnings.join(" ")).toMatch(/no marker/);
    });

    it("maps MODAL_HAZARD, MODULE_NOT_SUPPORTED, ENGINE_FALSE and a modal open", async () => {
      for (const code of [
        "MODAL_HAZARD",
        "MODULE_NOT_SUPPORTED",
        "ENGINE_FALSE",
        "PATH_NOT_FOUND",
      ]) {
        const { client } = fakeClient(() => refused(code, "m", "n"));
        const r = await runAnim(client, { action: "check", path: "Anim/a.agr" });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.code).toBe(code);
      }
      const { client } = fakeClient(() => new WorkbenchError("dialog", "MODAL_OPEN"));
      const r = await runAnim(client, { action: "check", path: "Anim/a.agr" });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("MODAL_OPEN");
    });
  });
});

describe("handler and client failures", () => {
  it("an unknown handler code falls back with a warning", async () => {
    const { client } = fakeClient(() => ({
      status: "error",
      code: "WEIRD",
      message: "m",
      next: "n",
    }));
    const r = await runAnim(client, { action: "txaRead", path: TXA });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("HANDLER_ERROR");
      expect(r.warnings[0]).toMatch(/unknown code 'WEIRD'/);
    }
  });

  it("an unknown status is UNREACHABLE", async () => {
    const { client } = fakeClient(() => ({ status: "weird" }));
    const r = await runAnim(client, { action: "txaRead", path: TXA });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("UNREACHABLE");
  });

  it.each(["LOST", "MODAL_OPEN", "WEDGED"] as const)("maps WorkbenchError %s", async (code) => {
    const { client } = fakeClient(() => new WorkbenchError("x", code));
    const r = await runAnim(client, { action: "txaRead", path: TXA });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(code);
  });

  it("any other client failure is UNREACHABLE", async () => {
    const { client } = fakeClient(() => new Error("ECONNREFUSED"));
    const r = await runAnim(client, { action: "txaProfiles" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("UNREACHABLE");
  });
});

describe("registerWbAnim", () => {
  it("registers a handler that drops undefined keys and wraps the answer", async () => {
    const { client } = fakeClient(() => ok({ profiles: ["A|3|p"], total: 1 }));
    const handler = captureTool((s) => registerWbAnim(s, client));
    const res = await handler({ action: "txaProfiles", addon: undefined, path: undefined });
    expect(res.isError).toBeUndefined();
    expect(JSON.parse(textOf(res))).toMatchObject({ ok: true, action: "txaProfiles" });
  });

  it("a refusal comes back as an error result", async () => {
    const { client, sent } = fakeClient(() => ok());
    const handler = captureTool((s) => registerWbAnim(s, client));
    const res = await handler({ action: "txaRead" });
    expect(res.isError).toBe(true);
    expect(sent).toHaveLength(0);
    expect(JSON.parse(textOf(res))).toMatchObject({ ok: false, code: "INVALID_ARGUMENT" });
  });

  it("a config with a logs path wires the log reader (GATED check still answers GATED)", async () => {
    const { client } = fakeClient(() => ok());
    const handler = captureTool((s) =>
      registerWbAnim(s, client, { logsPath: "C:/nonexistent/logs" }),
    );
    const res = await handler({ action: "check", path: "Anim/a.agr" });
    expect(JSON.parse(textOf(res))).toMatchObject({ ok: false, code: "GATED" });
  });
});
