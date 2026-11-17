import { describe, expect, it } from "vitest";
import { join, resolve } from "node:path";
import { WorkbenchError } from "../../src/workbench/client.js";
import type { WorkbenchClient, WorkbenchCallOptions } from "../../src/workbench/client.js";
import { DESCRIPTION_MAX } from "../../src/manifest/generate.js";
import {
  HANDLER,
  HANDLER_ACTIONS,
  IGNORE_NOTE,
  VALIDATE_CONTRACT,
  diffLines,
  flatInputShape,
  parseChecks,
  parseReports,
  prepareRequest,
  registerWbValidate,
  runValidate,
  toResourcePath,
  wbValidateDescription,
  type RootConfig,
} from "../../src/tools/wb-validate.js";
import type { Config } from "../../src/config.js";
import { captureTool, makeConfig, textOf } from "./_tool-harness.js";

interface Sent {
  fn: string;
  params: Record<string, unknown>;
  options: WorkbenchCallOptions;
}

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

const EMAT = "Materials/Rock.emat";
const TEX = "Textures/Rock_co.png";

// Absolute roots built with resolve() so they are absolute on the host OS.
const PROJECT = resolve("/wbv-test/project");
const WORKSHOP = resolve("/wbv-test/workshop");
const CORE = resolve("/wbv-test/core");
const ROOTS: RootConfig = { projectPath: PROJECT, workshopPath: WORKSHOP, corePath: CORE };

describe("wb_validate contract", () => {
  it("loads and names the three handler actions", () => {
    expect(VALIDATE_CONTRACT.tool).toBe("wb_validate");
    expect(HANDLER).toBe("EMCP_WB_Validate");
    expect([...HANDLER_ACTIONS].sort()).toEqual(["fixTexture", "material", "texture"]);
  });

  it("its description fits the 400-char budget", () => {
    expect(wbValidateDescription().length).toBeLessThanOrEqual(DESCRIPTION_MAX);
  });

  it("only fixTexture mutates, and it is projectOnly", () => {
    for (const a of VALIDATE_CONTRACT.actions) {
      expect(a.mutating, a.name).toBe(a.name === "fixTexture");
      expect(a.projectOnly, a.name).toBe(a.mutating);
    }
  });

  it("the flat input shape carries every request key of the contract", () => {
    const keys = Object.keys(flatInputShape());
    for (const k of VALIDATE_CONTRACT.request) expect(keys).toContain(k);
  });
});

describe("toResourcePath", () => {
  it("passes a project-relative path, slashes normalised", () => {
    expect(toResourcePath("Materials\\Rock.emat")).toBe("Materials/Rock.emat");
  });

  it("keeps a {GUID}path name", () => {
    expect(toResourcePath("{ABCDEF1234567890}Materials/Rock.emat")).toBe(
      "{ABCDEF1234567890}Materials/Rock.emat",
    );
  });

  it("refuses a flag-shaped path", () => {
    expect(() => toResourcePath("-rf")).toThrow(/flag-smuggle/);
  });

  it("refuses '..' and a drive or URL form", () => {
    expect(() => toResourcePath("a/../b.emat")).toThrow(/'\.\.'/);
    expect(() => toResourcePath("file:///x.emat")).toThrow(/absolute/);
  });

  it("turns an absolute path under the project root into a relative one", () => {
    expect(toResourcePath(join(PROJECT, "Materials", "Rock.emat"), ROOTS)).toBe(
      "Materials/Rock.emat",
    );
  });

  it("strips the defaultMod folder first when the path sits under it", () => {
    const cfg: RootConfig = { ...ROOTS, defaultMod: "Test1" };
    expect(toResourcePath(join(PROJECT, "Test1", "Materials", "Rock.emat"), cfg)).toBe(
      "Materials/Rock.emat",
    );
    expect(toResourcePath(join(PROJECT, "Other", "Rock.emat"), cfg)).toBe("Other/Rock.emat");
  });

  it("accepts an absolute path under the workshop or core root for a read", () => {
    expect(toResourcePath(join(WORKSHOP, "Materials", "Ws.emat"), ROOTS)).toBe("Materials/Ws.emat");
    expect(toResourcePath(join(CORE, "Materials", "Core.emat"), ROOTS)).toBe("Materials/Core.emat");
  });

  it("projectOnly (a write) refuses the workshop and core roots", () => {
    expect(() => toResourcePath(join(CORE, "Materials", "Core.emat"), ROOTS, true)).toThrow(
      /project root/,
    );
    expect(toResourcePath(join(PROJECT, "T", "a.png"), ROOTS, true)).toBe("T/a.png");
  });

  it("refuses an absolute path outside every root, and any without a config", () => {
    expect(() => toResourcePath(resolve("/elsewhere/x.emat"), ROOTS)).toThrow(/not under/);
    expect(() => toResourcePath(join(PROJECT, "..", "evil", "x.emat"), ROOTS)).toThrow(/not under/);
    expect(() => toResourcePath(resolve("/wbv-test/project/x.emat"))).toThrow(/absolute/);
  });

  it("refuses a path that is a root itself", () => {
    expect(() => toResourcePath(PROJECT, ROOTS)).toThrow(/absolute/);
  });
});

describe("prepareRequest refusals (nothing is sent)", () => {
  const refuse = (input: unknown, code: string, text?: RegExp, config?: RootConfig) => {
    const p = prepareRequest(input, config);
    expect(p.ok).toBe(false);
    if (!p.ok) {
      expect(p.error.code).toBe(code);
      if (text) expect(p.error.message).toMatch(text);
    }
  };

  it("an unknown action", () =>
    refuse({ action: "nope", path: EMAT }, "INVALID_ARGUMENT", /unknown action/));
  it("a missing path", () => refuse({ action: "material" }, "INVALID_ARGUMENT", /path/));
  it("material of a file that is not an .emat", () =>
    refuse({ action: "material", path: TEX }, "INVALID_ARGUMENT", /\.emat/));
  it("a key the action does not take", () => {
    refuse({ action: "material", path: EMAT, typeName: "co" }, "INVALID_ARGUMENT");
    refuse({ action: "texture", path: TEX, confirm: true }, "INVALID_ARGUMENT");
    refuse({ action: "texture", path: TEX, rebuild: true }, "INVALID_ARGUMENT");
  });
  it("an empty typeName", () =>
    refuse({ action: "texture", path: TEX, typeName: " " }, "INVALID_ARGUMENT", /typeName/));
  it("a flag-shaped path", () =>
    refuse({ action: "texture", path: "-x.png" }, "INVALID_ARGUMENT", /flag-smuggle/));
  it("a traversal path", () =>
    refuse({ action: "texture", path: "Textures/../../x_co.png" }, "ABSOLUTE_PATH"));
  it("an absolute path with no config", () =>
    refuse({ action: "texture", path: join(PROJECT, "x_co.png") }, "ABSOLUTE_PATH"));
  it("an absolute path outside the roots", () =>
    refuse({ action: "material", path: resolve("/x/y.emat") }, "ABSOLUTE_PATH", undefined, ROOTS));
  it("fixTexture of a core file (a write stays in the project)", () =>
    refuse(
      { action: "fixTexture", path: join(CORE, "Textures", "a_co.png") },
      "ABSOLUTE_PATH",
      /project root/,
      ROOTS,
    ));
  it("a non-boolean confirm", () =>
    refuse({ action: "fixTexture", path: TEX, confirm: "yes" }, "INVALID_ARGUMENT"));

  it("sends nothing through runValidate", async () => {
    const { client, sent } = fakeClient(() => ok());
    const r = await runValidate(client, { action: "material", path: "a/b.png" });
    expect(r).toMatchObject({ ok: false, code: "INVALID_ARGUMENT" });
    expect(sent).toHaveLength(0);
  });
});

describe("1.x inputs still work", () => {
  it("material with a root-relative path", async () => {
    const { client, sent } = fakeClient(() => ok({ severity: 0, reports: [], textures: [] }));
    const r = await runValidate(client, { action: "material", path: "Materials\\Rock.emat" });
    expect(sent[0].params).toEqual({ action: "material", path: EMAT });
    expect(r.ok).toBe(true);
  });

  it("texture with a {GUID}path name", async () => {
    const { client, sent } = fakeClient(() => ok({ textureType: "_co", checks: [], fatal: 0 }));
    await runValidate(client, {
      action: "texture",
      path: "{ABCDEF1234567890}Textures/Rock_co.png",
    });
    expect(sent[0].params.path).toBe("{ABCDEF1234567890}Textures/Rock_co.png");
  });

  it("texture with an absolute path under the project root is sent relative", async () => {
    const { client, sent } = fakeClient(() => ok({ textureType: "_co", checks: [], fatal: 0 }));
    const r = await runValidate(
      client,
      { action: "texture", path: join(PROJECT, "Textures", "Rock_co.png") },
      ROOTS,
    );
    expect(sent[0].params.path).toBe(TEX);
    expect(r).toMatchObject({ ok: true, target: `path:${TEX}` });
  });
});

describe("parsers", () => {
  it("parseReports reads '<severity>: <text>' and a skipped note", () => {
    expect(
      parseReports([
        "2: UV out of range: it said: so",
        "0: fine",
        "skipped: CheckTextures not run: no GUID",
        "oops",
        "x: bad level",
      ]),
    ).toEqual([
      { severity: 2, text: "UV out of range: it said: so", skipped: false },
      { severity: 0, text: "fine", skipped: false },
      { severity: null, text: "CheckTextures not run: no GUID", skipped: true },
      { severity: null, text: "oops", skipped: false },
      { severity: null, text: "bad level", skipped: false },
    ]);
  });
  it("parseChecks splits Check=Result", () => {
    expect(
      parseChecks(["CheckConfigurations=NothingChanged", "CheckAncestors=skipped", "odd"]),
    ).toEqual([
      { check: "CheckConfigurations", result: "NothingChanged" },
      { check: "CheckAncestors", result: "skipped" },
      { check: "odd", result: "" },
    ]);
  });
  it("diffLines reports differing keys and one-sided keys", () => {
    expect(
      diffLines(
        ["PC.ancestor=", "PC.Mode=1", "XBOX.Mode=1"],
        ["PC.ancestor={A}b.conf", "XBOX.Mode=1", "PC.New=a=b"],
      ),
    ).toEqual([
      { path: "PC.ancestor", before: "", after: "{A}b.conf" },
      { path: "PC.Mode", before: "1", after: null },
      { path: "PC.New", before: null, after: "a=b" },
    ]);
  });
});

describe("material", () => {
  it("shapes the reports, the highest severity and the textures", async () => {
    const { client, sent } = fakeClient(() =>
      ok({
        severity: 2,
        reports: ["1: default left on", "2: extreme value"],
        textures: ["Textures/Rock_co.edds"],
      }),
    );
    const r = await runValidate(client, { action: "material", path: EMAT });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      fn: "EMCP_WB_Validate",
      params: { action: "material", path: EMAT },
      options: { access: "read" },
    });
    expect(sent[0].params).not.toHaveProperty("confirm");
    expect(r).toMatchObject({
      ok: true,
      action: "material",
      target: `path:${EMAT}`,
      changed: null,
      readback: {
        severity: 2,
        reports: [
          { severity: 1, text: "default left on", skipped: false },
          { severity: 2, text: "extreme value", skipped: false },
        ],
        textures: ["Textures/Rock_co.edds"],
      },
    });
  });

  it("no reports is a clean verdict, with severity 0", async () => {
    const { client } = fakeClient(() => ok({ severity: 0, reports: [], textures: [] }));
    const r = await runValidate(client, { action: "material", path: EMAT });
    expect(r).toMatchObject({ ok: true, readback: { severity: 0, reports: [] } });
    expect(r.ok && r.next).toContain("passed");
  });

  it("a skipped CheckTextures is lifted into a warning", async () => {
    const { client } = fakeClient(() =>
      ok({
        severity: 0,
        reports: ["skipped: CheckTextures not run: Tex: shorter than a GUID"],
        textures: [],
      }),
    );
    const r = await runValidate(client, { action: "material", path: EMAT });
    expect(r.ok && r.warnings).toEqual(["CheckTextures not run: Tex: shorter than a GUID"]);
    expect(
      r.ok && (r.readback as { reports: Array<{ skipped: boolean }> }).reports[0].skipped,
    ).toBe(true);
  });

  it("the answer no longer carries the KD-011 'No Verdict Available' text", async () => {
    const { client } = fakeClient(() => ok({ severity: 0, reports: [], textures: [] }));
    const r = await runValidate(client, { action: "material", path: EMAT });
    expect(JSON.stringify(r)).not.toContain("No Verdict");
  });

  it("a material that does not load is PATH_NOT_FOUND", async () => {
    const { client } = fakeClient(() => ({
      status: "error",
      code: "PATH_NOT_FOUND",
      message: "LoadContainer found no valid resource",
      next: "an existing .emat",
    }));
    expect(await runValidate(client, { action: "material", path: EMAT })).toMatchObject({
      ok: false,
      code: "PATH_NOT_FOUND",
      next: "an existing .emat",
    });
  });
});

describe("texture", () => {
  const CHECKS = [
    "CheckConfigurations=NothingChanged",
    "CheckAncestors=UnfixedFatalIssue",
    "CheckUnnecessarySettingInPc=skipped",
    "CheckSuspiciousNonPcSetting=skipped",
    "CheckWrongPropertyValues=skipped",
  ];

  it("shapes the type, the checks and the fatal flag (1 from Enforce)", async () => {
    const { client, sent } = fakeClient(() => ok({ textureType: "_co", checks: CHECKS, fatal: 1 }));
    const r = await runValidate(client, { action: "texture", path: TEX, typeName: "co" });
    expect(sent[0].params).toEqual({ action: "texture", path: TEX, typeName: "co" });
    expect(sent[0].options.access).toBe("read");
    expect(r).toMatchObject({
      ok: true,
      changed: null,
      readback: {
        textureType: "_co",
        fatal: true,
        checks: [
          { check: "CheckConfigurations", result: "NothingChanged" },
          { check: "CheckAncestors", result: "UnfixedFatalIssue" },
          { check: "CheckUnnecessarySettingInPc", result: "skipped" },
          { check: "CheckSuspiciousNonPcSetting", result: "skipped" },
          { check: "CheckWrongPropertyValues", result: "skipped" },
        ],
      },
    });
  });

  it("says that Ignore leaves two of the checks without a verdict", async () => {
    const { client } = fakeClient(() => ok({ textureType: "unspecified", checks: [], fatal: 0 }));
    const r = await runValidate(client, { action: "texture", path: TEX });
    expect(r.ok && r.warnings).toEqual([IGNORE_NOTE]);
    expect(r.ok && r.next).toContain("fixTexture");
  });

  it("a type that cannot be found without FileIO is the handler's INVALID_ARGUMENT, with its next", async () => {
    const { client } = fakeClient(() => ({
      status: "error",
      code: "INVALID_ARGUMENT",
      message: "no texture suffix matches Textures/x.png",
      next: "pass typeName (for example co, nohq, fnt or unspecified)",
    }));
    const r = await runValidate(client, { action: "texture", path: "Textures/x.png" });
    expect(r).toMatchObject({
      ok: false,
      code: "INVALID_ARGUMENT",
      next: "pass typeName (for example co, nohq, fnt or unspecified)",
    });
  });

  it("a meta that is not a texture's is UNSUPPORTED_TYPE", async () => {
    const { client } = fakeClient(() => ({
      status: "error",
      code: "UNSUPPORTED_TYPE",
      message: "the meta's first configuration is FBXResourceClass, not an image",
      next: "",
    }));
    expect(await runValidate(client, { action: "texture", path: "Models/a.fbx" })).toMatchObject({
      ok: false,
      code: "UNSUPPORTED_TYPE",
    });
  });

  it("a packed texture is META_NOT_FOUND", async () => {
    const { client } = fakeClient(() => ({
      status: "error",
      code: "META_NOT_FOUND",
      message: "no file on disk",
      next: "",
    }));
    expect(await runValidate(client, { action: "texture", path: TEX })).toMatchObject({
      ok: false,
      code: "META_NOT_FOUND",
    });
  });
});

describe("fixTexture", () => {
  const input = { action: "fixTexture", path: TEX };

  it("a dry run (confirm left out) sends confirm false and answers the current values", async () => {
    const { client, sent } = fakeClient(() =>
      ok({
        dryRun: 1,
        saved: 0,
        textureType: "_co",
        checks: ["CheckConfigurations=NothingChanged"],
        fatal: 0,
        before: ["PC.ancestor={A}b.conf", "PC.Mode=1"],
      }),
    );
    const r = await runValidate(client, input);
    expect(sent[0].params).toEqual({ ...input, confirm: false });
    expect(sent[0].options.access).toBe("mutate");
    expect(r).toMatchObject({
      ok: true,
      changed: null,
      readback: {
        dryRun: true,
        saved: false,
        textureType: "_co",
        current: ["PC.ancestor={A}b.conf", "PC.Mode=1"],
      },
    });
    expect(r.ok && r.next).toContain("confirm: true");
    expect(r.ok && r.warnings).toEqual([IGNORE_NOTE]);
  });

  it("confirm fixes and saves: before and after become Changes", async () => {
    const { client, sent } = fakeClient(() =>
      ok({
        dryRun: 0,
        saved: 1,
        rebuilt: 1,
        textureType: "_co",
        checks: ["CheckConfigurations=NothingChanged", "CheckAncestors=SomethingChanged"],
        fatal: 0,
        before: ["PC.ancestor=", "PC.Mode=1"],
        after: ["PC.ancestor={A}b.conf"],
        message: "fixed and saved",
      }),
    );
    const r = await runValidate(client, { ...input, rebuild: true, confirm: true });
    expect(sent[0].params).toEqual({ ...input, rebuild: true, confirm: true });
    expect(r).toMatchObject({
      ok: true,
      changed: [
        { path: "PC.ancestor", before: "", after: "{A}b.conf" },
        { path: "PC.Mode", before: "1", after: null },
      ],
      readback: { dryRun: false, saved: true, rebuilt: true },
    });
    expect(r.ok && r.next).toContain("wb_meta set");
    expect(r.ok && r.warnings).toEqual([]);
  });

  it("a rebuild that did not finish warns", async () => {
    const { client } = fakeClient(() =>
      ok({ saved: 1, rebuilt: 0, before: ["PC.Mode=1"], after: ["PC.Mode=2"], checks: [] }),
    );
    const r = await runValidate(client, { ...input, rebuild: true, confirm: true });
    expect(r.ok && r.warnings.join(" ")).toContain("WaitForFile");
  });

  it("nothing to fix: no Changes, saved false", async () => {
    const { client } = fakeClient(() =>
      ok({
        saved: 0,
        rebuilt: 0,
        checks: ["CheckConfigurations=NothingChanged"],
        message: "nothing to fix; the meta was not written",
      }),
    );
    const r = await runValidate(client, { ...input, confirm: true });
    expect(r).toMatchObject({ ok: true, changed: null, readback: { saved: false } });
    expect(r.ok && r.next).toContain("not written");
  });

  it("nothing to fix with rebuild asked says nothing was rebuilt", async () => {
    const { client } = fakeClient(() => ok({ saved: 0, checks: [] }));
    const r = await runValidate(client, { ...input, rebuild: true, confirm: true });
    expect(r.ok && r.warnings.join(" ")).toContain("nothing was rebuilt");
  });

  it("a fatal verdict is answered as data, not an error", async () => {
    const { client } = fakeClient(() =>
      ok({ saved: 0, fatal: 1, checks: ["CheckConfigurations=UnfixedFatalIssue"] }),
    );
    const r = await runValidate(client, { ...input, confirm: true });
    expect(r).toMatchObject({ ok: true, readback: { fatal: true } });
  });

  it("a refused project guard maps to NOT_IN_PROJECT", async () => {
    const { client } = fakeClient(() => ({
      status: "refused",
      code: "NOT_IN_PROJECT",
      message: "ProjectRefused: nothing was changed",
      next: "install the handlers in the project you have open",
    }));
    expect(await runValidate(client, { ...input, confirm: true })).toMatchObject({
      ok: false,
      code: "NOT_IN_PROJECT",
      next: "install the handlers in the project you have open",
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
    const r = await runValidate(client, { action: "texture", path: TEX });
    expect(r).toMatchObject({ ok: false, code: "HANDLER_ERROR" });
    expect(r.warnings.join(" ")).toContain("unknown code 'WEIRD'");
  });

  it("a refusal with an unknown code is INVALID_ARGUMENT", async () => {
    const { client } = fakeClient(() => ({
      status: "refused",
      code: "WEIRD",
      message: "m",
      next: "",
    }));
    expect(await runValidate(client, { action: "texture", path: TEX })).toMatchObject({
      ok: false,
      code: "INVALID_ARGUMENT",
    });
  });

  it("an unknown status is UNREACHABLE", async () => {
    const { client } = fakeClient(() => ({ status: "weird" }));
    expect(await runValidate(client, { action: "texture", path: TEX })).toMatchObject({
      ok: false,
      code: "UNREACHABLE",
    });
  });
});

describe("client failures", () => {
  it("keeps LOST, MODAL_OPEN and WEDGED, and never retries a lost fix", async () => {
    for (const code of ["LOST", "MODAL_OPEN", "WEDGED"] as const) {
      const { client, sent } = fakeClient(() => new WorkbenchError(`boom ${code}`, code));
      const r = await runValidate(client, { action: "fixTexture", path: TEX, confirm: true });
      expect(r).toMatchObject({ ok: false, code });
      expect(sent).toHaveLength(1);
      if (code === "LOST") expect(r.ok === false && r.next).toContain("never retried");
    }
  });

  it("a lost read is not given the write advice", async () => {
    const { client } = fakeClient(() => new WorkbenchError("lost", "LOST"));
    const r = await runValidate(client, { action: "material", path: EMAT });
    expect(r.ok === false && r.next).not.toContain("never retried");
  });

  it("any other client failure is UNREACHABLE", async () => {
    const { client } = fakeClient(() => new WorkbenchError("refused", "CONNECTION_REFUSED"));
    expect(await runValidate(client, { action: "material", path: EMAT })).toMatchObject({
      ok: false,
      code: "UNREACHABLE",
    });
  });
});

describe("registerWbValidate", () => {
  const config: Config = makeConfig({ projectPath: PROJECT });

  it("registers wb_validate with the three-argument call server.ts makes", async () => {
    const { client, sent } = fakeClient(() => ok({ severity: 0, reports: [], textures: [] }));
    const handler = captureTool((s) => registerWbValidate(s, client, config));
    const res = await handler({ action: "material", path: EMAT, typeName: undefined });
    expect(sent[0].params).toEqual({ action: "material", path: EMAT });
    expect(res.isError).toBeUndefined();
    expect(JSON.parse(textOf(res))).toMatchObject({ ok: true, action: "material" });
  });

  it("uses the config to turn an absolute 1.x path into a relative one", async () => {
    const { client, sent } = fakeClient(() => ok({ textureType: "_co", checks: [], fatal: 0 }));
    const handler = captureTool((s) => registerWbValidate(s, client, config));
    await handler({ action: "texture", path: join(PROJECT, "Textures", "Rock_co.png") });
    expect(sent[0].params.path).toBe(TEX);
  });

  it("works without a config too (relative paths only)", async () => {
    const { client } = fakeClient(() => ok());
    const handler = captureTool((s) => registerWbValidate(s, client));
    const res = await handler({ action: "texture", path: join(PROJECT, "x_co.png") });
    expect(res.isError).toBe(true);
    expect(JSON.parse(textOf(res))).toMatchObject({ ok: false, code: "ABSOLUTE_PATH" });
  });
});

// Census rows this file tests (W2 promotion, EV-W2-085).
// census:mcp:action/wb_validate.fixTexture
// census:mcp:action/wb_validate.material
// census:mcp:action/wb_validate.texture
