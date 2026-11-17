import { describe, it, expect, vi } from "vitest";
import type { WorkbenchClient } from "../../src/workbench/client.js";
import { registerWbProjects, isBiHandlerError } from "../../src/tools/wb-projects.js";
import { captureTool, textOf } from "./_tool-harness.js";

// Declared fields of Bohemia's LocateProject handler, as read from the pak
// source (scripts/WorkbenchGameCommon/EnfusionBlenderTools/AssetLibraryUtils.c).
// Not verified against a live Workbench.
const LOCATE_PROJECT = {
  request: ["path"], // LocateProjectRequest, RegV("path") at line 59
  response: ["status", "message", "projectName", "projectPath"], // fields lines 65-68, RegAll() at line 76
  statusValues: ["OK", "ERROR"], // lines 102 and 106 (upper case)
} as const;

function makeClient(response: Record<string, unknown>) {
  const calls: { apiFunc: string; params: Record<string, unknown> }[] = [];
  const client = {
    state: { connected: true, mode: "edit", lastUpdated: 0 },
    call: vi.fn(async (apiFunc: string, params: Record<string, unknown> = {}) => {
      calls.push({ apiFunc, params });
      return response;
    }),
  } as unknown as WorkbenchClient;
  return { client, calls };
}

async function locate(name: string, response: Record<string, unknown>) {
  const { client, calls } = makeClient(response);
  const handler = captureTool((s) => registerWbProjects(s, client));
  const result = await handler({ action: "locate", name });
  return { calls, result, text: textOf(result) };
}

describe("wb_projects locate: LocateProject contract", () => {
  const abs = "C:/Addons/MyMod/Prefabs/Weapons";
  const ok = {
    status: "OK",
    message: "",
    projectName: "MyMod",
    projectPath: "C:/Addons/MyMod",
  };

  it("sends exactly the declared request field (path), not name", async () => {
    const { calls } = await locate(abs, ok);
    expect(calls).toHaveLength(1);
    expect(calls[0].apiFunc).toBe("LocateProject");
    expect(Object.keys(calls[0].params).sort()).toEqual([...LOCATE_PROJECT.request].sort());
    expect(calls[0].params.path).toBe(abs);
  });

  it("reads projectName / projectPath from the declared response", async () => {
    for (const k of Object.keys(ok)) {
      expect(LOCATE_PROJECT.response as readonly string[]).toContain(k);
    }
    expect(LOCATE_PROJECT.statusValues).toContain(ok.status);
    const { text, result } = await locate(abs, ok);
    expect(text).toContain("**Project:** MyMod");
    expect(text).toContain("**Project path:** C:/Addons/MyMod");
    expect(text).toContain("Not verified live");
    expect(result.isError).not.toBe(true);
  });

  it("does not read the undeclared keys path / guid", async () => {
    const { text } = await locate(abs, {
      status: "OK",
      path: "C:/wrong",
      projectPath: "C:/Addons/MyMod",
      guid: "0123456789ABCDEF",
    });
    expect(text).not.toContain("C:/wrong");
    expect(text).not.toContain("0123456789ABCDEF");
  });

  it("treats the handler's upper-case status ERROR as an error, not a '(not found)' success", async () => {
    const { text, result } = await locate("Prefabs/Weapons", {
      status: "ERROR",
      message:
        'Could not find active project in path "Prefabs/Weapons". Please select a different path.',
      projectName: "",
      projectPath: "",
    });
    expect(result.isError).toBe(true);
    expect(text).toContain("Could not find active project");
    expect(text).not.toContain("Project Located");
  });
});

describe("isBiHandlerError", () => {
  it("matches upper-case ERROR and the lower-case forms isHandlerError knows", () => {
    expect(isBiHandlerError({ status: "ERROR" })).toBe(true);
    expect(isBiHandlerError({ status: "error" })).toBe(true);
    expect(isBiHandlerError({ status: "OK" })).toBe(false);
    expect(isBiHandlerError({ status: "ok" })).toBe(false);
    expect(isBiHandlerError(null)).toBe(false);
  });
});

// live-tools-b-3: open used to send EditorControl openResource (a .gproj only reaches
// ResourceManager.SetOpenedResource) and answered "Project Opened / Loaded" on any true.
describe("wb_projects open: no project is switched, and the answer says so", () => {
  it("sends nothing and refuses, naming wb_launch, even when the handler would answer ok", async () => {
    const { client, calls } = makeClient({
      status: "ok",
      action: "openResource",
      message: "Opened resource: D:/Other/Other.gproj (through ResourceManager)",
    });
    const handler = captureTool((s) => registerWbProjects(s, client));
    const result = await handler({ action: "open", name: "D:/Other/Other.gproj" });
    const text = textOf(result);
    expect(calls).toEqual([]);
    expect(result.isError).toBe(true);
    expect(text).toContain("Project NOT opened");
    expect(text).toContain("wb_launch gprojPath");
    expect(text).toContain("Nothing was sent");
    expect(text).not.toContain("Project Opened");
    expect(text).not.toContain("Loaded:");
  });

  it("refuses the same way without a name", async () => {
    const { client, calls } = makeClient({ status: "ok" });
    const handler = captureTool((s) => registerWbProjects(s, client));
    const result = await handler({ action: "open" });
    expect(calls).toEqual([]);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("Project NOT opened");
  });
});
