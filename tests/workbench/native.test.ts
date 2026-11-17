import { describe, it, expect } from "vitest";
import {
  bringModuleWindowToFront,
  getState,
  isWorkbenchRunning,
  isWorldEditorRunning,
  makeScreenshotOutputPath,
  openResource,
  reloadScripts,
  validateScripts,
  type NativeCaller,
} from "../../src/workbench/native.js";
import type { WorkbenchCallOptions } from "../../src/workbench/client.js";

interface Seen {
  apiFunc: string;
  params: Record<string, unknown>;
  options: WorkbenchCallOptions;
  via: "call" | "probe";
}

function fake(answer: unknown): { c: NativeCaller; seen: Seen[] } {
  const seen: Seen[] = [];
  const rec =
    (via: "call" | "probe") =>
    async (apiFunc: string, params: Record<string, unknown> = {}, options = {}) => {
      seen.push({ apiFunc, params, options, via });
      return answer;
    };
  const c = { call: rec("call"), probe: rec("probe") } as unknown as NativeCaller;
  return { c, seen };
}

describe("native wrappers (DEC-040 frame shapes)", () => {
  it("IsWorkbenchRunning: read-only, high priority, ScriptsCompiled", async () => {
    const { c, seen } = fake({ ScriptsCompiled: true });
    expect((await isWorkbenchRunning(c)).scriptsCompiled).toBe(true);
    expect(seen[0]).toMatchObject({
      apiFunc: "IsWorkbenchRunning",
      params: {},
      options: { access: "read", priority: "high", allowEmptyPayload: true },
    });
  });

  it("IsWorkbenchRunning tolerates an empty answer", async () => {
    const { c } = fake({});
    expect((await isWorkbenchRunning(c)).scriptsCompiled).toBeNull();
  });

  it("IsWorldEditorRunning: lease-free probe, read-only, reads IsRunning and ScriptsCompiled", async () => {
    const { c, seen } = fake({ IsRunning: false, ScriptsCompiled: true });
    const r = await isWorldEditorRunning(c);
    expect(r).toMatchObject({ running: false, scriptsCompiled: true });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      apiFunc: "IsWorldEditorRunning",
      params: {},
      via: "probe",
      options: { access: "read", priority: "high", allowEmptyPayload: true },
    });
    expect(seen[0].options.timeout).toBeLessThanOrEqual(10_000);
  });

  it("IsWorldEditorRunning reads 1/0 and tolerates an empty or non-object answer", async () => {
    expect(await isWorldEditorRunning(fake({ IsRunning: 1 }).c)).toMatchObject({ running: true });
    expect(await isWorldEditorRunning(fake({}).c)).toMatchObject({
      running: null,
      scriptsCompiled: null,
    });
    expect((await isWorldEditorRunning(fake("Ok").c)).raw).toEqual({});
  });

  it("IsWorldEditorRunning lets a client error through", async () => {
    const c = {
      call: async () => ({}),
      probe: async () => {
        throw new Error("Undefined API func");
      },
    } as unknown as NativeCaller;
    await expect(isWorldEditorRunning(c)).rejects.toThrow("Undefined API func");
  });

  it("ValidateScripts sends Configuration and reads Errors, Warnings, Success", async () => {
    const { c, seen } = fake({ Errors: [], Warnings: 3, Success: true });
    const r = await validateScripts(c, "WORKBENCH");
    expect(r).toMatchObject({ success: true, errors: 0, warnings: 3 });
    expect(seen[0]).toMatchObject({
      apiFunc: "ValidateScripts",
      params: { Configuration: "WORKBENCH" },
      options: { access: "read" },
    });
    expect(seen[0].options.timeout).toBeGreaterThan(120_000);
  });

  it("ReloadScripts is mutating with empty params", async () => {
    const { c, seen } = fake({});
    expect(await reloadScripts(c)).toEqual({});
    expect(seen[0]).toMatchObject({
      apiFunc: "ReloadScripts",
      params: {},
      options: { access: "mutate" },
    });
  });

  it("GetState is the EMCP_WB_GetState handler, read-only", async () => {
    const { c, seen } = fake({ mode: "edit" });
    expect(await getState(c)).toEqual({ mode: "edit" });
    expect(seen[0]).toMatchObject({ apiFunc: "EMCP_WB_GetState", options: { access: "read" } });
  });

  it("OpenResource sends ResourceName and reads Opened false for an absent file", async () => {
    const { c, seen } = fake({ Opened: false });
    expect((await openResource(c, "UI/absent.st")).opened).toBe(false);
    expect(seen[0]).toMatchObject({
      apiFunc: "OpenResource",
      params: { ResourceName: "UI/absent.st" },
      options: { access: "mutate", allowEmptyPayload: true },
    });
  });

  it("BringModuleWindowToFront sends ModuleName and accepts {} or a non-object", async () => {
    const { c, seen } = fake(undefined);
    expect(await bringModuleWindowToFront(c, "ScriptEditor")).toEqual({});
    expect(seen[0]).toMatchObject({
      apiFunc: "BringModuleWindowToFront",
      params: { ModuleName: "ScriptEditor" },
    });
  });

  it("MakeScreenshot output name gets .png appended (DEC-042 U28)", () => {
    expect(makeScreenshotOutputPath("_throwaway/a-1.bmp")).toBe("_throwaway/a-1.bmp.png");
  });

  it("A-3: the liveness reads go through probe() (no lease, no auto-launch)", async () => {
    const { c, seen } = fake({});
    await isWorkbenchRunning(c);
    await getState(c);
    await reloadScripts(c);
    expect(seen.map((x) => x.via)).toEqual(["probe", "probe", "call"]);
  });
});
