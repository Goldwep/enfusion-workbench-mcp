import { describe, expect, it, vi } from "vitest";
import { WorkbenchError } from "../../src/workbench/client.js";
import { DESCRIPTION, inputShape, registerWbBiTool, runBi } from "../../src/tools/wb-bi.js";
import { AUTH_GATED_NEXT, MUTATING_GATED_NEXT } from "../../src/workbench/bi-handlers.js";

function deps(impl: (...a: unknown[]) => unknown = async () => ({})) {
  const call = vi.fn(impl);
  return { client: { call } as never, call };
}

const SHAPE = ["ok", "action", "target", "changed", "readback", "warnings"];

describe("wb_bi description and schema", () => {
  it("description is at most 400 chars and names the mutating action", () => {
    expect(DESCRIPTION.length).toBeLessThanOrEqual(400);
    expect(DESCRIPTION).toMatch(/callMutating/);
  });
  it("registers wb_bi with the flat shape", () => {
    const registerTool = vi.fn();
    registerWbBiTool({ registerTool } as never, {} as never);
    expect(registerTool.mock.calls[0][0]).toBe("wb_bi");
    expect(Object.keys(inputShape()).sort()).toEqual(["action", "handler", "request"]);
  });
});

describe("list and describe", () => {
  it("list answers 42 rows with class, live flag and callable, no Workbench call", async () => {
    const d = deps();
    const r = await runBi({ action: "list" }, d);
    expect(r.ok).toBe(true);
    for (const k of SHAPE) expect(r).toHaveProperty(k);
    const rb = (
      r as {
        readback: { total: number; callable: number; rows: Array<Record<string, unknown>> };
      }
    ).readback;
    expect(rb.total).toBe(42);
    expect(rb.callable).toBe(14);
    expect(rb.rows.filter((x) => x.callable)).toHaveLength(14);
    expect(rb.rows.find((x) => x.name === "LocatePrefabsFromPath")).toMatchObject({
      class: "read",
      verifiedLive: false,
      callable: false,
    });
    expect(d.call).not.toHaveBeenCalled();
  });
  it("describe gives typed fields; unknown names refused", async () => {
    const r = await runBi({ action: "describe", handler: "GetResourceInfo" }, deps());
    expect(r).toMatchObject({
      ok: true,
      target: "bi:GetResourceInfo",
      readback: {
        fields: [
          { key: "expandResource", type: "bool" },
          { key: "path", type: "string" },
        ],
        class: "read",
      },
    });
    expect(await runBi({ action: "describe", handler: "Nope" }, deps())).toMatchObject({
      ok: false,
      code: "NOT_ALLOWLISTED",
    });
    expect(await runBi({ action: "describe" }, deps())).toMatchObject({
      code: "INVALID_ARGUMENT",
    });
  });
});

describe("call", () => {
  it("sends a verified handler with access read and returns the answer as readback", async () => {
    const d = deps(async () => ({ status: "ok", guid: "ABC" }));
    const r = await runBi(
      { action: "call", handler: "GetPrefabGUID", request: { prefabPath: "Prefabs/a.et" } },
      d,
    );
    expect(r).toMatchObject({ ok: true, action: "call", changed: null, readback: { guid: "ABC" } });
    expect((r as { warnings: string[] }).warnings[0]).toMatch(/on-disk metas/);
    expect((r as { warnings: string[] }).warnings[1]).toMatch(/Authorization prompt/);
    expect(d.call).toHaveBeenCalledWith(
      "GetPrefabGUID",
      { prefabPath: "Prefabs/a.et" },
      expect.objectContaining({ access: "read" }),
    );
  });
  it("an undeclared key is INVALID_ARGUMENT before anything is sent", async () => {
    const d = deps();
    const r = await runBi(
      { action: "call", handler: "LocateProject", request: { path: "a", projectName: "x" } },
      d,
    );
    expect(r).toMatchObject({ ok: false, code: "INVALID_ARGUMENT" });
    expect((r as { message: string }).message).toMatch(/projectName/);
    expect(d.call).not.toHaveBeenCalled();
  });
  it("a missing or mistyped field is INVALID_ARGUMENT, nothing sent", async () => {
    const d = deps();
    expect(await runBi({ action: "call", handler: "CheckGUID" }, d)).toMatchObject({
      code: "INVALID_ARGUMENT",
    });
    expect(
      await runBi(
        { action: "call", handler: "PrefabImporter", request: { absPath: "a", start: "0" } },
        d,
      ),
    ).toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(d.call).not.toHaveBeenCalled();
  });
  it("LocatePrefabsFromPath is GATED with the battery next step", async () => {
    const d = deps();
    const r = await runBi(
      {
        action: "call",
        handler: "LocatePrefabsFromPath",
        request: { selectedProject: "a", projectPath: "b", selectedFolder: "c" },
      },
      d,
    );
    expect(r).toMatchObject({ ok: false, code: "GATED", next: AUTH_GATED_NEXT });
    expect(d.call).not.toHaveBeenCalled();
  });
  it("mutating, unverified and unknown names are NOT_ALLOWLISTED", async () => {
    const d = deps();
    for (const h of [
      "RegisterResource",
      "TextureValidator",
      "OpenXOB",
      "BakeInfo",
      "EMCP_WB_Ping",
      "X",
    ])
      expect(await runBi({ action: "call", handler: h, request: {} }, d), h).toMatchObject({
        ok: false,
        code: "NOT_ALLOWLISTED",
      });
    expect(d.call).not.toHaveBeenCalled();
  });
  it("maps client errors and in-payload errors", async () => {
    const req = { action: "call", handler: "GetLoadedProjects" };
    const cases = [
      ["MODAL_OPEN", "MODAL_OPEN"],
      ["LOST", "LOST"],
      ["WEDGED", "WEDGED"],
      ["API_ERROR", "HANDLER_ERROR"],
      ["CONNECTION_REFUSED", "UNREACHABLE"],
      ["TIMEOUT", "UNREACHABLE"],
      ["PROTOCOL_ERROR", "UNREACHABLE"],
    ] as const;
    for (const [code, want] of cases) {
      const r = await runBi(
        req,
        deps(async () => {
          throw new WorkbenchError("m", code);
        }),
      );
      expect(r, code).toMatchObject({ ok: false, code: want });
      if (code === "TIMEOUT" || code === "PROTOCOL_ERROR")
        expect((r as { next: string }).next, code).toMatch(/modal/);
    }
    expect(
      await runBi(
        req,
        deps(async () => ({ status: "error", message: "Meta file not found!" })),
      ),
    ).toMatchObject({ ok: false, code: "HANDLER_ERROR", message: "Meta file not found!" });
    // Bohemia's NET handlers answer upper-case ERROR (live-tools-b-4).
    expect(
      await runBi(
        req,
        deps(async () => ({ status: "ERROR", message: "Not in any addon" })),
      ),
    ).toMatchObject({ ok: false, code: "HANDLER_ERROR", message: "Not in any addon" });
  });
});

describe("callMutating and arguments", () => {
  it("callMutating is GATED for every handler, nothing sent", async () => {
    const d = deps();
    for (const h of ["RegisterResource", "GetLoadedProjects", undefined])
      expect(await runBi({ action: "callMutating", handler: h }, d)).toMatchObject({
        ok: false,
        code: "GATED",
        next: MUTATING_GATED_NEXT,
      });
    expect(d.call).not.toHaveBeenCalled();
  });
  it("an unknown action or top-level key is INVALID_ARGUMENT", async () => {
    expect(await runBi({ action: "run" }, deps())).toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(await runBi({ action: "list", method: "x" }, deps())).toMatchObject({
      code: "INVALID_ARGUMENT",
    });
  });
});
