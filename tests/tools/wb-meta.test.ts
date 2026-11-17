import { describe, expect, it } from "vitest";
import { WorkbenchError } from "../../src/workbench/client.js";
import type { WorkbenchClient, WorkbenchCallOptions } from "../../src/workbench/client.js";
import { DESCRIPTION_MAX } from "../../src/manifest/generate.js";
import {
  HANDLER,
  HANDLER_ACTIONS,
  META_CONTRACT,
  checkSourcePath,
  diffPairs,
  flatInputShape,
  parsePlatforms,
  parseVarRows,
  prepareRequest,
  registerWbMeta,
  runMeta,
  wbMetaDescription,
} from "../../src/tools/wb-meta.js";
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

const PATH = "Models/Rock.fbx";
const ANCESTOR = "{0123456789ABCDEF}Configs/Base.conf";
const EMAT = "{FEDCBA9876543210}Materials/Rock.emat";

describe("wb_meta contract", () => {
  it("loads and names the six handler actions", () => {
    expect(META_CONTRACT.tool).toBe("wb_meta");
    expect(HANDLER).toBe("EMCP_WB_Meta");
    expect([...HANDLER_ACTIONS].sort()).toEqual(
      ["assignMaterial", "clear", "get", "set", "setAncestor", "vars"].sort(),
    );
  });

  it("its description fits the 400-char budget", () => {
    expect(wbMetaDescription().length).toBeLessThanOrEqual(DESCRIPTION_MAX);
  });

  it("marks every write projectOnly and the reads not", () => {
    for (const a of META_CONTRACT.actions) {
      expect(a.projectOnly, a.name).toBe(a.mutating);
      expect(a.mutating, a.name).toBe(!["get", "vars"].includes(a.name));
    }
  });

  it("the flat input shape carries every request key of the contract", () => {
    const keys = Object.keys(flatInputShape());
    for (const k of META_CONTRACT.request) expect(keys).toContain(k);
  });
});

describe("checkSourcePath", () => {
  it("accepts a relative path, backslashes turned to slashes", () => {
    expect(checkSourcePath("Models\\Rock.fbx")).toBe("Models/Rock.fbx");
  });
  it("keeps a {GUID}path form", () => {
    expect(checkSourcePath("{0123456789ABCDEF}Models/Rock.fbx")).toBe(
      "{0123456789ABCDEF}Models/Rock.fbx",
    );
  });
  it("refuses absolute forms, '..' and a .meta name", () => {
    expect(() => checkSourcePath("C:/x/Rock.fbx")).toThrow(/absolute/);
    expect(() => checkSourcePath("/x/Rock.fbx")).toThrow(/absolute/);
    expect(() => checkSourcePath("a/../b.fbx")).toThrow(/'\.\.'/);
    expect(() => checkSourcePath("Models/Rock.fbx.meta")).toThrow(/\.meta/);
    expect(() => checkSourcePath("{0123456789ABCDEF}Models/Rock.FBX.META")).toThrow(/\.meta/);
    expect(() => checkSourcePath("  ")).toThrow(/empty/);
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
    refuse({ action: "nope", path: PATH }, "INVALID_ARGUMENT", /unknown action/));
  it("a missing path", () => refuse({ action: "get" }, "INVALID_ARGUMENT", /path/));
  it("a key the action does not take", () =>
    refuse({ action: "get", path: PATH, platform: "PC" }, "INVALID_ARGUMENT"));
  it("set without name or value", () => {
    refuse({ action: "set", path: PATH, value: "1" }, "INVALID_ARGUMENT", /name/);
    refuse({ action: "set", path: PATH, name: "X" }, "INVALID_ARGUMENT", /value/);
  });
  it("clear takes no value", () =>
    refuse({ action: "clear", path: PATH, name: "X", value: "1" }, "INVALID_ARGUMENT"));
  it("an absolute path", () => refuse({ action: "get", path: "C:\\a\\b.fbx" }, "ABSOLUTE_PATH"));
  it("a '..' path", () => refuse({ action: "get", path: "a/../b.fbx" }, "ABSOLUTE_PATH"));
  it("a .meta path", () =>
    refuse({ action: "get", path: "a/b.fbx.meta" }, "INVALID_ARGUMENT", /\.meta/));
  it("limit out of range", () => {
    refuse({ action: "vars", path: PATH, limit: 0 }, "INVALID_ARGUMENT", /limit/);
    refuse({ action: "vars", path: PATH, limit: 201 }, "INVALID_ARGUMENT", /limit/);
  });
  it("a malformed cursor", () =>
    refuse({ action: "vars", path: PATH, cursor: "abc" }, "INVALID_ARGUMENT", /cursor/));
  it("a cursor past its count", () =>
    refuse({ action: "vars", path: PATH, cursor: "9:3" }, "INVALID_ARGUMENT", /past/));
  it("an empty platform", () =>
    refuse({ action: "vars", path: PATH, platform: " " }, "INVALID_ARGUMENT", /platform/));
  it("an empty name", () =>
    refuse({ action: "clear", path: PATH, name: " " }, "INVALID_ARGUMENT", /name/));
  it("setAncestor with a value that is not a ResourceName", () =>
    refuse(
      { action: "setAncestor", path: PATH, value: "Configs/Base.conf" },
      "INVALID_ARGUMENT",
      /ResourceName/,
    ));
  it("assignMaterial with a value that is not an .emat ResourceName", () => {
    refuse(
      { action: "assignMaterial", path: PATH, name: "Slot", value: "Materials/Rock.emat" },
      "INVALID_ARGUMENT",
      /\.emat/,
    );
    refuse(
      { action: "assignMaterial", path: PATH, name: "Slot", value: ANCESTOR },
      "INVALID_ARGUMENT",
      /\.emat/,
    );
  });
  it("a non-boolean confirm", () =>
    refuse(
      { action: "set", path: PATH, name: "X", value: "1", confirm: "yes" },
      "INVALID_ARGUMENT",
    ));

  it("sends nothing through runMeta", async () => {
    const { client, sent } = fakeClient(() => ok());
    const r = await runMeta(client, { action: "get", path: "a/b.fbx.meta" });
    expect(r).toMatchObject({ ok: false, code: "INVALID_ARGUMENT" });
    expect(sent).toHaveLength(0);
  });
});

describe("prepareRequest accepts", () => {
  it("a read with the GUID form, and does not add confirm", () => {
    const p = prepareRequest({ action: "get", path: "{0123456789ABCDEF}Models/Rock.fbx" });
    expect(p).toMatchObject({ ok: true, mutating: false });
    if (p.ok)
      expect(p.params).toEqual({ action: "get", path: "{0123456789ABCDEF}Models/Rock.fbx" });
  });
  it("a write sends confirm false when it was left out", () => {
    const p = prepareRequest({ action: "set", path: PATH, name: "X", value: "1" });
    expect(p).toMatchObject({ ok: true, mutating: true });
    if (p.ok) expect(p.params.confirm).toBe(false);
  });
  it("a value of the empty string for set (a string variable)", () => {
    expect(prepareRequest({ action: "set", path: PATH, name: "X", value: "" }).ok).toBe(true);
  });
  it("the target names the cleaned path", () => {
    const p = prepareRequest({ action: "get", path: "Models\\Rock.fbx" });
    if (p.ok) expect(p.target).toBe("path:Models/Rock.fbx");
  });
});

describe("parsers", () => {
  it("parsePlatforms splits PLATFORM=Class:ancestor", () => {
    expect(
      parsePlatforms([
        "PC=PNGResourceClass:{0123456789ABCDEF}Cfg/B.conf",
        "XBOX_ONE=PNGResourceClass:",
      ]),
    ).toEqual([
      { platform: "PC", className: "PNGResourceClass", ancestor: "{0123456789ABCDEF}Cfg/B.conf" },
      { platform: "XBOX_ONE", className: "PNGResourceClass", ancestor: "" },
    ]);
  });
  it("parseVarRows reshapes row-major cells and drops a partial row", () => {
    expect(parseVarRows("name,type", ["A", "int", "B", "string", "C"])).toEqual([
      { name: "A", type: "int" },
      { name: "B", type: "string" },
    ]);
    expect(parseVarRows("", ["x"])).toEqual([]);
  });
  it("diffPairs reports only differing keys, a missing side as null", () => {
    expect(diffPairs(["PC=1", "XBOX=2"], ["PC=3", "XBOX=2", "NEW=a=b"], "")).toEqual([
      { path: "PC", before: "1", after: "3" },
      { path: "NEW", before: null, after: "a=b" },
    ]);
  });
});

describe("get", () => {
  it("shapes identity, platforms and tags", async () => {
    const { client, sent } = fakeClient(() =>
      ok({
        resourceName: "{0123456789ABCDEF}Models/Rock.fbx",
        guid: "0123456789ABCDEF",
        sourcePath: "Models/Rock.fbx",
        count: 2,
        platforms: ["PC=FBXResourceClass:", "XBOX_ONE=FBXResourceClass:{AAAAAAAAAAAAAAAA}b.conf"],
        tags: ["prop", "rock"],
      }),
    );
    const r = await runMeta(client, { action: "get", path: PATH });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      fn: "EMCP_WB_Meta",
      params: { action: "get", path: PATH },
      options: { access: "read" },
    });
    expect(r).toMatchObject({
      ok: true,
      action: "get",
      target: `path:${PATH}`,
      changed: null,
      readback: {
        guid: "0123456789ABCDEF",
        count: 2,
        tags: ["prop", "rock"],
        platforms: [
          { platform: "PC", className: "FBXResourceClass", ancestor: "" },
          {
            platform: "XBOX_ONE",
            className: "FBXResourceClass",
            ancestor: "{AAAAAAAAAAAAAAAA}b.conf",
          },
        ],
      },
    });
  });

  it("a packed resource answers META_NOT_FOUND through the handler error", async () => {
    const { client } = fakeClient(() => ({
      status: "error",
      code: "META_NOT_FOUND",
      message: "no file",
      next: "",
    }));
    const r = await runMeta(client, { action: "get", path: "Game/Packed.fbx" });
    expect(r).toMatchObject({ ok: false, code: "META_NOT_FOUND" });
    // an empty handler next falls back to the vocabulary text
    expect(r.ok === false && r.next).toContain("wb_resources register");
  });
});

describe("vars", () => {
  const COLS = "name,type,value";
  const page = (cells: string[], next = "") =>
    ok({ total: 120, columns: COLS, rows: cells, nextCursor: next });

  it("shapes one page and points at the next", async () => {
    const { client, sent } = fakeClient(() =>
      page(["A", "INTEGER", "1", "B", "BOOLEAN", "true"], "2:120"),
    );
    const r = await runMeta(client, { action: "vars", path: PATH, limit: 2, fields: COLS });
    expect(sent[0].params).toEqual({ action: "vars", path: PATH, limit: 2, fields: COLS });
    expect(sent[0].options.access).toBe("read");
    expect(r).toMatchObject({
      ok: true,
      readback: {
        platform: "PC",
        total: 120,
        columns: ["name", "type", "value"],
        rows: [
          { name: "A", type: "INTEGER", value: "1" },
          { name: "B", type: "BOOLEAN", value: "true" },
        ],
        nextCursor: "2:120",
      },
    });
    expect(r.ok && r.next).toContain('cursor "2:120"');
  });

  it("the last page has no next cursor", async () => {
    const { client } = fakeClient(() => page(["Z", "STRING", "z"]));
    const r = await runMeta(client, {
      action: "vars",
      path: PATH,
      platform: "XBOX_ONE",
      cursor: "118:120",
    });
    expect(r).toMatchObject({ ok: true, readback: { platform: "XBOX_ONE", nextCursor: null } });
    expect(r.ok && r.next).toBeUndefined();
  });

  it("passes the cursor and platform through unchanged", async () => {
    const { client, sent } = fakeClient(() => page([]));
    await runMeta(client, { action: "vars", path: PATH, platform: "XBOX_ONE", cursor: "50:120" });
    expect(sent[0].params).toMatchObject({ platform: "XBOX_ONE", cursor: "50:120" });
  });

  it("warns when the cells do not fill whole rows", async () => {
    const { client } = fakeClient(() => page(["A", "INTEGER"]));
    const r = await runMeta(client, { action: "vars", path: PATH });
    expect(r.ok && r.warnings.join(" ")).toContain("partial row");
  });

  it("a stale cursor keeps its code", async () => {
    const { client } = fakeClient(() => ({
      status: "error",
      code: "STALE_CURSOR",
      message: "changed",
      next: "read again without a cursor",
    }));
    const r = await runMeta(client, { action: "vars", path: PATH, cursor: "50:99" });
    expect(r).toMatchObject({
      ok: false,
      code: "STALE_CURSOR",
      next: "read again without a cursor",
    });
  });
});

describe("set", () => {
  const input = { action: "set", path: PATH, name: "Compression", value: "BC7" };

  it("a dry run answers before and the proposed after, changes nothing", async () => {
    const { client, sent } = fakeClient(() =>
      ok({ dryRun: 1, saved: 0, before: ["PC=BC1"], after: ["PC=BC7"], message: "dry run" }),
    );
    const r = await runMeta(client, input);
    expect(sent[0].params).toEqual({ ...input, confirm: false });
    expect(sent[0].options.access).toBe("mutate");
    expect(r).toMatchObject({
      ok: true,
      changed: null,
      readback: { dryRun: true, saved: false, before: ["PC=BC1"], after: ["PC=BC7"] },
    });
    expect(r.ok && r.next).toContain("confirm: true");
  });

  it("confirm writes: one Change per platform, saved read back as 1", async () => {
    const { client, sent } = fakeClient(() =>
      ok({
        dryRun: 0,
        saved: 1,
        before: ["PC=BC1", "XBOX_ONE=BC1"],
        after: ["PC=BC7", "XBOX_ONE=BC7"],
      }),
    );
    const r = await runMeta(client, { ...input, allPlatforms: true, confirm: true });
    expect(sent[0].params).toMatchObject({ allPlatforms: true, confirm: true });
    expect(r).toMatchObject({
      ok: true,
      changed: [
        { path: "PC.Compression", before: "BC1", after: "BC7" },
        { path: "XBOX_ONE.Compression", before: "BC1", after: "BC7" },
      ],
      readback: { dryRun: false, saved: true },
    });
    expect(r.ok && r.next).toContain("inverse");
    expect(r.ok && r.warnings).toEqual([]);
  });

  it("a value that equals the one before warns", async () => {
    const { client } = fakeClient(() => ok({ saved: 1, before: ["PC=BC7"], after: ["PC=BC7"] }));
    const r = await runMeta(client, { ...input, confirm: true });
    expect(r).toMatchObject({ ok: true, changed: [] });
    expect(r.ok && r.warnings.join(" ")).toContain("equals the value before");
  });

  it("an unsaved write warns", async () => {
    const { client } = fakeClient(() => ok({ saved: 0, before: ["PC=1"], after: ["PC=2"] }));
    const r = await runMeta(client, { ...input, confirm: true });
    expect(r.ok && r.warnings.join(" ")).toContain("not report the meta saved");
  });

  it("a value with '=' inside keeps it whole", async () => {
    const { client } = fakeClient(() => ok({ saved: 1, before: ["PC=a=b"], after: ["PC=c=d"] }));
    const r = await runMeta(client, { ...input, confirm: true });
    expect(r.ok && r.changed).toEqual([{ path: "PC.Compression", before: "a=b", after: "c=d" }]);
  });

  it("a refused project guard maps to NOT_IN_PROJECT", async () => {
    const { client } = fakeClient(() =>
      refused("NOT_IN_PROJECT", "ProjectRefused: nothing was changed"),
    );
    const r = await runMeta(client, { ...input, confirm: true });
    expect(r).toMatchObject({
      ok: false,
      code: "NOT_IN_PROJECT",
      message: "ProjectRefused: nothing was changed",
    });
  });

  it("a failed engine write keeps what was read and says it was not saved", async () => {
    const { client } = fakeClient(() => ({
      status: "error",
      code: "ENGINE_FALSE",
      message: "Set returned false",
      next: "read back",
      before: ["PC=1"],
      after: ["PC=1"],
      saved: 0,
    }));
    const r = await runMeta(client, { ...input, confirm: true });
    expect(r).toMatchObject({
      ok: false,
      code: "ENGINE_FALSE",
      readback: { before: ["PC=1"], after: ["PC=1"], saved: false },
    });
  });

  it("an invalid value answered by the handler is INVALID_ARGUMENT", async () => {
    const { client } = fakeClient(() => ({
      status: "error",
      code: "INVALID_ARGUMENT",
      message: "value is not an integer",
      next: "wb_meta vars shows the enum column",
    }));
    const r = await runMeta(client, { ...input, confirm: true });
    expect(r).toMatchObject({ ok: false, code: "INVALID_ARGUMENT" });
    expect(r.ok === false && r.readback).toBeUndefined();
  });
});

describe("clear", () => {
  it("a confirmed clear reports the inherited value as after", async () => {
    const { client, sent } = fakeClient(() =>
      ok({ saved: 1, before: ["PC=BC7"], after: ["PC=BC1"] }),
    );
    const r = await runMeta(client, {
      action: "clear",
      path: PATH,
      name: "Compression",
      confirm: true,
    });
    expect(sent[0].params).toEqual({
      action: "clear",
      path: PATH,
      name: "Compression",
      confirm: true,
    });
    expect(r).toMatchObject({
      ok: true,
      changed: [{ path: "PC.Compression", before: "BC7", after: "BC1" }],
    });
    expect(r.ok && r.next).toContain("wb_meta set");
  });

  it("a dry run changes nothing and says how to confirm", async () => {
    const { client } = fakeClient(() =>
      ok({ dryRun: true, before: ["PC=BC7"], after: ["PC=BC1"] }),
    );
    const r = await runMeta(client, { action: "clear", path: PATH, name: "Compression" });
    expect(r).toMatchObject({ ok: true, changed: null, readback: { dryRun: true } });
    expect(r.ok && r.next).toContain("clear the setting");
  });

  it("a missing variable is the handler's INVALID_ARGUMENT", async () => {
    const { client } = fakeClient(() => ({
      status: "error",
      code: "INVALID_ARGUMENT",
      message: "configuration PC has no variable Nope",
      next: "a name wb_meta vars lists",
    }));
    const r = await runMeta(client, { action: "clear", path: PATH, name: "Nope", confirm: true });
    expect(r).toMatchObject({ ok: false, code: "INVALID_ARGUMENT" });
  });
});

describe("setAncestor", () => {
  const input = { action: "setAncestor", path: PATH, value: ANCESTOR };

  it("a confirmed write answers the ancestor change on the platform", async () => {
    const { client, sent } = fakeClient(() =>
      ok({
        saved: 1,
        before: ["PC="],
        after: [`PC=${ANCESTOR}`],
        message: "ancestor set and saved",
      }),
    );
    const r = await runMeta(client, { ...input, confirm: true });
    expect(sent[0].params).toEqual({ ...input, confirm: true });
    expect(r).toMatchObject({
      ok: true,
      changed: [{ path: "PC.ancestor", before: "", after: ANCESTOR }],
    });
    expect(r.ok && r.next).toContain("setAncestor");
  });

  it("carries the handler's class note as a warning", async () => {
    const { client } = fakeClient(() =>
      ok({
        dryRun: 1,
        before: ["PC="],
        after: [`PC=${ANCESTOR}`],
        message:
          "dry run: nothing was set or written (the ancestor's class A is not the configuration's B)",
      }),
    );
    const r = await runMeta(client, input);
    expect(r.ok && r.warnings[0]).toContain("the ancestor's class A is not the configuration's B");
  });

  it("an ancestor that does not load is PATH_NOT_FOUND", async () => {
    const { client } = fakeClient(() => ({
      status: "error",
      code: "PATH_NOT_FOUND",
      message: "LoadContainer found no valid resource",
      next: "an existing base config",
    }));
    const r = await runMeta(client, { ...input, confirm: true });
    expect(r).toMatchObject({ ok: false, code: "PATH_NOT_FOUND" });
  });
});

describe("assignMaterial", () => {
  const input = { action: "assignMaterial", path: PATH, name: "Slot0", value: EMAT };

  it("an existing slot: one Change on the slot", async () => {
    const { client } = fakeClient(() =>
      ok({
        saved: 1,
        before: ["Slot0={AAAAAAAAAAAAAAAA}Old.emat", "Slot1=m1"],
        after: [`Slot0=${EMAT}`, "Slot1=m1"],
      }),
    );
    const r = await runMeta(client, { ...input, confirm: true });
    expect(r).toMatchObject({
      ok: true,
      changed: [
        { path: "MaterialAssigns.Slot0", before: "{AAAAAAAAAAAAAAAA}Old.emat", after: EMAT },
      ],
    });
  });

  it("a new slot: before is null", async () => {
    const { client } = fakeClient(() => ok({ saved: 1, before: [], after: [`Slot0=${EMAT}`] }));
    const r = await runMeta(client, { ...input, confirm: true });
    expect(r.ok && r.changed).toEqual([
      { path: "MaterialAssigns.Slot0", before: null, after: EMAT },
    ]);
  });

  it("a dry run lists the proposed slots only", async () => {
    const { client, sent } = fakeClient(() =>
      ok({ dryRun: 1, before: [], after: [`Slot0=${EMAT}`] }),
    );
    const r = await runMeta(client, input);
    expect(sent[0].params.confirm).toBe(false);
    expect(r).toMatchObject({ ok: true, changed: null, readback: { dryRun: true } });
    expect(r.ok && r.next).toContain("assign the material");
  });

  it("a meta that is not a model's is UNSUPPORTED_TYPE", async () => {
    const { client } = fakeClient(() => ({
      status: "error",
      code: "UNSUPPORTED_TYPE",
      message: "no MaterialAssigns",
      next: "a model source file (.fbx)",
    }));
    const r = await runMeta(client, { ...input, confirm: true });
    expect(r).toMatchObject({
      ok: false,
      code: "UNSUPPORTED_TYPE",
      next: "a model source file (.fbx)",
    });
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
    const r = await runMeta(client, { action: "get", path: PATH });
    expect(r).toMatchObject({ ok: false, code: "HANDLER_ERROR" });
    expect(r.warnings.join(" ")).toContain("unknown code 'WEIRD'");
  });

  it("a refusal with an unknown code is INVALID_ARGUMENT", async () => {
    const { client } = fakeClient(() => refused("WEIRD"));
    const r = await runMeta(client, { action: "get", path: PATH });
    expect(r).toMatchObject({ ok: false, code: "INVALID_ARGUMENT" });
  });

  it("an unknown status is UNREACHABLE", async () => {
    const { client } = fakeClient(() => ({ status: "weird" }));
    expect(await runMeta(client, { action: "get", path: PATH })).toMatchObject({
      ok: false,
      code: "UNREACHABLE",
    });
  });

  it("the Resource Manager not being open keeps its code", async () => {
    const { client } = fakeClient(() => ({
      status: "error",
      code: "MODULE_NOT_OPEN",
      message: "GetModule returned null",
      next: "",
    }));
    expect(await runMeta(client, { action: "get", path: PATH })).toMatchObject({
      ok: false,
      code: "MODULE_NOT_OPEN",
    });
  });
});

describe("client failures", () => {
  it("keeps LOST, MODAL_OPEN and WEDGED, and never retries a lost write", async () => {
    for (const code of ["LOST", "MODAL_OPEN", "WEDGED"] as const) {
      const { client, sent } = fakeClient(() => new WorkbenchError(`boom ${code}`, code));
      const r = await runMeta(client, {
        action: "set",
        path: PATH,
        name: "X",
        value: "1",
        confirm: true,
      });
      expect(r).toMatchObject({ ok: false, code });
      expect(sent).toHaveLength(1);
      if (code === "LOST") expect(r.ok === false && r.next).toContain("never retried");
    }
  });

  it("a lost read is not given the write advice", async () => {
    const { client } = fakeClient(() => new WorkbenchError("lost", "LOST"));
    const r = await runMeta(client, { action: "get", path: PATH });
    expect(r.ok === false && r.next).not.toContain("never retried");
  });

  it("any other client failure is UNREACHABLE", async () => {
    const { client } = fakeClient(() => new WorkbenchError("refused", "CONNECTION_REFUSED"));
    expect(await runMeta(client, { action: "get", path: PATH })).toMatchObject({
      ok: false,
      code: "UNREACHABLE",
    });
  });
});

describe("registerWbMeta", () => {
  it("registers wb_meta, drops undefined keys and answers JSON", async () => {
    const { client, sent } = fakeClient(() => ok({ platforms: [], tags: [] }));
    const handler = captureTool((s) => registerWbMeta(s, client));
    const res = await handler({
      action: "get",
      path: PATH,
      platform: undefined,
      confirm: undefined,
    });
    expect(sent[0].params).toEqual({ action: "get", path: PATH });
    expect(res.isError).toBeUndefined();
    expect(JSON.parse(textOf(res))).toMatchObject({ ok: true, action: "get" });
  });

  it("flags a refusal as an error result", async () => {
    const { client } = fakeClient(() => ok());
    const handler = captureTool((s) => registerWbMeta(s, client));
    const res = await handler({ action: "get", path: "x.meta" });
    expect(res.isError).toBe(true);
    expect(JSON.parse(textOf(res))).toMatchObject({ ok: false, code: "INVALID_ARGUMENT" });
  });
});

// Census rows this file tests (W2 promotion, EV-W2-085).
// census:mcp:action/wb_meta.clear
// census:mcp:action/wb_meta.get
// census:mcp:action/wb_meta.set
// census:mcp:action/wb_meta.setAncestor
// census:mcp:action/wb_meta.vars
