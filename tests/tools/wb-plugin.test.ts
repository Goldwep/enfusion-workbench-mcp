import { ERROR_CODES } from "../../src/manifest/vocabulary.js";
import { describe, expect, it, vi } from "vitest";
import { WorkbenchError } from "../../src/workbench/client.js";
import { checkedDescription } from "../../src/manifest/generate.js";
import {
  FOCUS_WARNING,
  NEVER_CALLED,
  allowListOf,
  catalogRows,
  inputShape,
  loadAllowList,
  loadCatalog,
  loadRunAllowList,
  pluginContract,
  registerWbPluginTool,
  runPlugin,
  type CatalogRow,
  type PluginDeps,
} from "../../src/tools/wb-plugin.js";

const SNAP = "SCR_SnapAndOrientToTerrainPlugin";
const ALLOW = [{ module: "WorldEditor", className: SNAP }];
const CATALOG: CatalogRow[] = Array.from({ length: 5 }, (_, i) => ({
  id: `plugin:P${i}`,
  className: `P${i}`,
  kind: "plugin",
  module: i % 2 ? "ScriptEditor" : "WorldEditor",
  label: `p${i}`,
  modal: i === 0 ? "opens" : "none",
  verdict: i === 0 ? "modal" : "unknown",
  risk: "read-only",
}));
// A modal catalog row that is also (wrongly) on the run list, and a clean one.
const MODAL = { ...CATALOG[0], id: "plugin:SCR_ModalPlugin", className: "SCR_ModalPlugin" };
const SNAP_ROW = { ...CATALOG[1], id: `plugin:${SNAP}`, className: SNAP, verdict: "safe" };
const RUN_ALLOW = [
  { module: "WorldEditor", className: SNAP },
  { module: "WorldEditor", className: "SCR_ModalPlugin" },
];

function deps(call = vi.fn()): PluginDeps & { call: ReturnType<typeof vi.fn> } {
  return {
    client: { call } as never,
    catalog: () => [...CATALOG, MODAL, SNAP_ROW],
    allowList: () => ALLOW,
    runAllowList: () => RUN_ALLOW,
    call,
  };
}

const snapReq = (action: string, extra: Record<string, unknown> = {}) => ({
  action,
  moduleName: "WorldEditor",
  className: SNAP,
  ...extra,
});

describe("wb_plugin contract and description", () => {
  it("loads, stays within 400 chars, reads unmutating, gated actions mutating", () => {
    const c = pluginContract();
    expect(c.tool).toBe("wb_plugin");
    expect(checkedDescription(c).length).toBeLessThanOrEqual(400);
    const m = Object.fromEntries(c.actions.map((a) => [a.name, a.mutating]));
    expect(m).toEqual({
      list: false,
      describe: false,
      getSettings: false,
      setSettings: true,
      run: true,
    });
  });
  it("run has no free-form method parameter", () => {
    const run = pluginContract().actions.find((a) => a.name === "run")!;
    expect(run.params.map((p) => p.key).sort()).toEqual(["className", "confirm", "moduleName"]);
    expect(Object.keys(inputShape())).not.toContain("method");
  });
});

describe("catalog from the ledger", () => {
  it("keeps E03 plugin and tool rows; modal unknown when unclassified", () => {
    const e03 = [{ enumerator: "E03" }];
    const rows = catalogRows([
      { id: "plugin:B", dim: "plugin", kind: "tool", module: "WorldEditor", sources: e03 },
      { id: "plugin:A", dim: "plugin", kind: "plugin", modal: "opens", sources: e03 },
      { id: "plugin:C", dim: "plugin", kind: "plugin", sources: [{ enumerator: "E01" }] },
      { id: "plugin:D", dim: "plugin", kind: "plugin-setting", sources: e03 },
    ]);
    expect(rows.map((r) => [r.id, r.className, r.modal])).toEqual([
      ["plugin:A", "A", "opens"],
      ["plugin:B", "B", "unknown"],
    ]);
  });
  it("the real ledger holds 143 E03 plugins and tools", () => {
    const rows = loadCatalog();
    expect(rows.length).toBe(143);
    expect(rows.every((r) => ["opens", "none", "unknown"].includes(r.modal))).toBe(true);
  });
  it("the allow-list comes from policy.json plugin_read_allow_list.allow_list", () => {
    expect(loadAllowList()).toEqual([
      ...ALLOW,
      { module: "ScriptEditor", className: "SCR_CopyClassAndMethodPlugin" },
      { module: "ScriptEditor", className: "SCR_DebugLinePlugin" },
    ]);
    expect(allowListOf({})).toEqual([]);
  });
});

describe("list", () => {
  it("pages with cursor and limit; nothing is sent", async () => {
    const d = deps();
    d.catalog = () => CATALOG;
    const r = await runPlugin({ action: "list", limit: 2 }, d);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const rb = r.readback as { total: number; rows: CatalogRow[]; nextCursor: string };
    expect(rb.total).toBe(5);
    expect(rb.rows.map((x) => x.id)).toEqual(["plugin:P0", "plugin:P1"]);
    expect(rb.nextCursor).toBe("2");
    expect(r.changed).toBeNull();
    const r2 = await runPlugin({ action: "list", limit: 2, cursor: "4" }, d);
    expect(r2.ok && (r2.readback as { nextCursor: unknown }).nextCursor).toBeNull();
    expect(d.call).not.toHaveBeenCalled();
  });
  it("filters by module and rejects a bad limit or cursor", async () => {
    const d = deps();
    d.catalog = () => CATALOG;
    const r = await runPlugin({ action: "list", moduleName: "ScriptEditor" }, d);
    expect(r.ok && (r.readback as { total: number }).total).toBe(2);
    expect((await runPlugin({ action: "list", limit: 201 }, d)).ok).toBe(false);
    const bad = await runPlugin({ action: "list", cursor: "x" }, d);
    expect(!bad.ok && bad.code).toBe("INVALID_ARGUMENT");
  });
});

describe("describe and getSettings", () => {
  it("refuses a class off the allow-list with NOT_ALLOWLISTED and sends nothing", async () => {
    const d = deps();
    const r = await runPlugin(
      { action: "describe", moduleName: "ScriptEditor", className: "SCR_NotListedPlugin" },
      d,
    );
    expect(!r.ok && r.code).toBe("NOT_ALLOWLISTED");
    expect(d.call).not.toHaveBeenCalled();
  });
  it("refuses ParticleEditor reads and the never-called entry points", async () => {
    const d = deps();
    const p = await runPlugin(
      { action: "describe", moduleName: "ParticleEditor", className: "X" },
      d,
    );
    expect(!p.ok && p.code).toBe("MODULE_NOT_SUPPORTED");
    expect(!p.ok && p.message).toContain("crashed the Workbench");
    const n = await runPlugin(
      { action: "describe", moduleName: "WorldEditor", className: "Configure" },
      d,
    );
    expect(!n.ok && n.message).toBe(NEVER_CALLED);
    expect(d.call).not.toHaveBeenCalled();
  });
  it("describe calls the handler with access read and maps the readback", async () => {
    const d = deps(
      vi.fn().mockResolvedValue({
        status: "ok",
        moduleName: "WorldEditor",
        className: SNAP,
        present: true,
        instance: true,
        instanceClass: SNAP,
      }),
    );
    const r = await runPlugin(snapReq("describe"), d);
    expect(d.call).toHaveBeenCalledWith(
      "EMCP_WB_Plugin",
      { action: "describe", moduleName: "WorldEditor", className: SNAP },
      { access: "read" },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.target).toBe(`plugin:${SNAP}`);
    expect(r.changed).toBeNull();
    expect((r.readback as { instance: boolean }).instance).toBe(true);
    expect(r.warnings).toEqual([FOCUS_WARNING]);
  });
  it("getSettings passes paging and returns the settings with next", async () => {
    const d = deps(
      vi.fn().mockResolvedValue({
        status: "ok",
        variableCount: 3,
        attributeCount: 2,
        settings: [{ name: "a", type: "int", attribute: "true", value: "1" }],
        nextCursor: "1",
      }),
    );
    const r = await runPlugin(snapReq("getSettings", { limit: 1 }), d);
    expect(d.call.mock.calls[0][1]).toMatchObject({ action: "getSettings", limit: 1 });
    expect(r.ok && r.next).toBe('getSettings with cursor "1"');
    expect(r.ok && (r.readback as { settings: unknown[] }).settings).toHaveLength(1);
  });
  it("getSettings rejects a bad cursor or limit before sending", async () => {
    const d = deps();
    const c = await runPlugin(snapReq("getSettings", { cursor: "x" }), d);
    expect(!c.ok && c.code).toBe("INVALID_ARGUMENT");
    const l = await runPlugin(snapReq("getSettings", { limit: 0 }), d);
    expect(!l.ok && l.code).toBe("INVALID_ARGUMENT");
    expect(d.call).not.toHaveBeenCalled();
  });
  it("maps a STALE_CURSOR handler refusal", async () => {
    const d = deps(
      vi.fn().mockResolvedValue({ status: "refused", code: "STALE_CURSOR", message: "stale" }),
    );
    const r = await runPlugin(snapReq("getSettings", { cursor: "3" }), d);
    expect(!r.ok && r.code).toBe("STALE_CURSOR");
  });
  it("maps a handler refusal's code and nextStep", async () => {
    const d = deps(
      vi.fn().mockResolvedValue({
        status: "refused",
        code: "MODULE_NOT_OPEN",
        message: "MODULE_NOT_OPEN: module WorldEditor is not open",
        nextStep: "open the module first: wb_module open",
      }),
    );
    const r = await runPlugin(snapReq("describe"), d);
    expect(!r.ok && [r.code, r.next]).toEqual([
      "MODULE_NOT_OPEN",
      "open the module first: wb_module open",
    ]);
  });
  it("maps MODAL_OPEN from the client", async () => {
    const err = Object.assign(Object.create(WorkbenchError.prototype), {
      code: "MODAL_OPEN",
      message: "modal",
    });
    const r = await runPlugin(snapReq("describe"), deps(vi.fn().mockRejectedValue(err)));
    expect(!r.ok && r.code).toBe("MODAL_OPEN");
  });
});

const wbErr = (code: string, message = code) =>
  Object.assign(Object.create(WorkbenchError.prototype), { code, message });

describe("describe adds verdict, runnable and focusWarning", () => {
  const okAnswer = {
    status: "ok",
    moduleName: "WorldEditor",
    className: SNAP,
    present: 1,
    instance: 1,
  };
  it("reads verdict from the catalog and runnable from the run list", async () => {
    const r = await runPlugin(snapReq("describe"), deps(vi.fn().mockResolvedValue(okAnswer)));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.readback).toMatchObject({
      verdict: "safe",
      runnable: true,
      focusWarning: FOCUS_WARNING,
      present: true,
      instance: true,
    });
  });
  it("a class off the run list is not runnable; a class off the catalog reads unknown", async () => {
    const d = deps(vi.fn().mockResolvedValue(okAnswer));
    d.runAllowList = () => [];
    d.catalog = () => [];
    const r = await runPlugin(snapReq("describe"), d);
    expect(r.ok && r.readback).toMatchObject({ verdict: "unknown", runnable: false });
  });
  it("the run list defaults to empty when the deps carry none", async () => {
    const d = deps(vi.fn().mockResolvedValue(okAnswer));
    delete d.runAllowList;
    const r = await runPlugin(snapReq("describe"), d);
    expect(r.ok && (r.readback as { runnable: boolean }).runnable).toBe(false);
  });
  it("the ledger verdict field wins; modal opens falls back to modal", () => {
    const e03 = [{ enumerator: "E03" }];
    const rows = catalogRows([
      {
        id: "plugin:A",
        dim: "plugin",
        kind: "plugin",
        verdict: "effects",
        modal: "none",
        sources: e03,
      },
      { id: "plugin:B", dim: "plugin", kind: "plugin", modal: "opens", sources: e03 },
      { id: "plugin:C", dim: "plugin", kind: "plugin", modal: "none", sources: e03 },
    ]);
    expect(rows.map((r) => r.verdict)).toEqual(["effects", "modal", "unknown"]);
  });
});

describe("run allow-list from the policy", () => {
  it("reads plugin_run_allow_list and is empty when the key is absent", () => {
    const policy = { plugin_run_allow_list: { allow_list: [["WorldEditor", "A"], ["x"]] } };
    expect(allowListOf(policy, "plugin_run_allow_list")).toEqual([
      { module: "WorldEditor", className: "A" },
    ]);
    expect(
      allowListOf({ plugin_read_allow_list: { allow_list: [] } }, "plugin_run_allow_list"),
    ).toEqual([]);
    expect(allowListOf(null, "plugin_run_allow_list")).toEqual([]);
  });
  it("loadRunAllowList returns an array whatever the real policy holds today", () => {
    expect(Array.isArray(loadRunAllowList())).toBe(true);
  });
});

describe("setSettings", () => {
  const set = (extra: Record<string, unknown> = {}) =>
    snapReq("setSettings", { name: "Margin", value: "1.5", ...extra });
  it("requires name and value", async () => {
    const d = deps();
    for (const bad of [snapReq("setSettings"), snapReq("setSettings", { name: "Margin" })]) {
      const r = await runPlugin(bad, d);
      expect(!r.ok && r.code).toBe("INVALID_ARGUMENT");
    }
    const e = await runPlugin(set({ name: "  " }), d);
    expect(!e.ok && e.code).toBe("INVALID_ARGUMENT");
    expect(d.call).not.toHaveBeenCalled();
  });
  it("refuses a class off the read list, ParticleEditor and the never-called names; sends nothing", async () => {
    const d = deps();
    const a = await runPlugin(
      {
        action: "setSettings",
        moduleName: "ScriptEditor",
        className: "SCR_Other",
        name: "a",
        value: "1",
      },
      d,
    );
    expect(!a.ok && a.code).toBe("NOT_ALLOWLISTED");
    const p = await runPlugin(
      {
        action: "setSettings",
        moduleName: "ParticleEditor",
        className: "X",
        name: "a",
        value: "1",
      },
      d,
    );
    expect(!p.ok && p.code).toBe("MODULE_NOT_SUPPORTED");
    const n = await runPlugin(
      {
        action: "setSettings",
        moduleName: "WorldEditor",
        className: "Configure",
        name: "a",
        value: "1",
      },
      d,
    );
    expect(!n.ok && n.message).toBe(NEVER_CALLED);
    expect(d.call).not.toHaveBeenCalled();
  });
  it("a dry run sends confirm false with access mutate and reads back the previous value", async () => {
    const d = deps(
      vi.fn().mockResolvedValue({
        status: "ok",
        name: "Margin",
        type: "float",
        value: "1.0",
        previous: "1.0",
        changed: 0,
        message: "dry run: would set Margin",
        nextStep: "run with confirm",
      }),
    );
    const r = await runPlugin(set(), d);
    expect(d.call).toHaveBeenCalledWith(
      "EMCP_WB_Plugin",
      {
        action: "setSettings",
        moduleName: "WorldEditor",
        className: SNAP,
        name: "Margin",
        value: "1.5",
        confirm: false,
      },
      { access: "mutate" },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.changed).toBeNull();
    expect(r.readback).toMatchObject({
      previous: "1.0",
      changed: false,
      dryRun: true,
      type: "float",
    });
    expect(r.warnings).toContain("dry run: nothing was written");
    expect(r.next).toBe("run with confirm");
  });
  it("floats and text go as text; confirm true is sent as true", async () => {
    const d = deps(
      vi.fn().mockResolvedValue({ status: "ok", changed: 1, previous: "1", value: "2" }),
    );
    const r = await runPlugin(set({ value: "2", confirm: true }), d);
    expect(d.call.mock.calls[0][1]).toMatchObject({ value: "2", confirm: true });
    expect(r.ok && r.changed).toEqual([{ path: `plugin:${SNAP}.Margin`, before: "1", after: "2" }]);
    expect(r.ok && (r.readback as { dryRun: boolean }).dryRun).toBe(false);
  });
  it("maps NO_SETTER, NOT_IN_PROJECT and INVALID_ARGUMENT handler refusals", async () => {
    for (const code of ["NO_SETTER", "NOT_IN_PROJECT", "INVALID_ARGUMENT"]) {
      const d = deps(
        vi
          .fn()
          .mockResolvedValue({ status: "refused", code, message: `${code}: no`, nextStep: "n" }),
      );
      const r = await runPlugin(set({ confirm: true }), d);
      expect(!r.ok && [r.code, r.message, r.next]).toEqual([code, `${code}: no`, "n"]);
    }
  });
  it("NO_SETTER without a nextStep takes the local default text", async () => {
    const d = deps(
      vi.fn().mockResolvedValue({ status: "refused", code: "NO_SETTER", message: "m" }),
    );
    const r = await runPlugin(set({ confirm: true }), d);
    expect(!r.ok && r.next).toBe(ERROR_CODES.NO_SETTER);
  });
  it("an unknown handler code becomes HANDLER_ERROR with a warning", async () => {
    const d = deps(vi.fn().mockResolvedValue({ status: "refused", code: "WHAT", message: "m" }));
    const r = await runPlugin(set(), d);
    expect(!r.ok && r.code).toBe("HANDLER_ERROR");
    expect(!r.ok && r.warnings[0]).toContain("WHAT");
  });
});

describe("run", () => {
  it("is a dry run by default: confirm false, access mutate, preconditions only", async () => {
    const d = deps(
      vi.fn().mockResolvedValue({
        status: "ok",
        ran: 0,
        entry: "Run",
        message: "dry run: the preconditions are met",
        nextStep: "run with confirm true",
      }),
    );
    const r = await runPlugin(snapReq("run"), d);
    expect(d.call).toHaveBeenCalledWith(
      "EMCP_WB_Plugin",
      { action: "run", moduleName: "WorldEditor", className: SNAP, confirm: false },
      { access: "mutate" },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.readback).toMatchObject({ ran: false, entry: "Run", dryRun: true });
    expect(r.warnings).toContain("dry run: only the preconditions were checked");
    expect(r.next).toBe("run with confirm true");
    expect(r.changed).toBeNull();
  });
  it("confirm true maps ran 1 to true and warns that the effect is not read back", async () => {
    const d = deps(vi.fn().mockResolvedValue({ status: "ok", ran: 1, entry: "Run" }));
    const r = await runPlugin(snapReq("run", { confirm: true }), d);
    expect(d.call.mock.calls[0][1]).toMatchObject({ confirm: true });
    expect(r.ok && r.readback).toMatchObject({ ran: true, dryRun: false });
    expect(r.ok && r.warnings.join(" ")).toContain("effect is not read back");
  });
  it("refuses a class the catalog marks modal with PLUGIN_MODAL; nothing is sent", async () => {
    const d = deps();
    const r = await runPlugin(
      { action: "run", moduleName: "WorldEditor", className: "SCR_ModalPlugin" },
      d,
    );
    expect(!r.ok && [r.code, r.next]).toEqual(["PLUGIN_MODAL", ERROR_CODES.PLUGIN_MODAL]);
    expect(d.call).not.toHaveBeenCalled();
  });
  it("refuses a class off the run list with NOT_ALLOWLISTED even when it is on the read list", async () => {
    const d = deps();
    d.runAllowList = () => [];
    const r = await runPlugin(snapReq("run"), d);
    expect(!r.ok && r.code).toBe("NOT_ALLOWLISTED");
    expect(!r.ok && r.message).toContain("run allow-list");
    expect(d.call).not.toHaveBeenCalled();
  });
  it("refuses ParticleEditor, an unknown module and the never-called entry points", async () => {
    const d = deps();
    const a = await runPlugin({ action: "run", moduleName: "ParticleEditor", className: "X" }, d);
    expect(!a.ok && a.code).toBe("MODULE_NOT_SUPPORTED");
    const b = await runPlugin({ action: "run", moduleName: "Nope", className: "X" }, d);
    expect(!b.ok && b.code).toBe("INVALID_ARGUMENT");
    const c = await runPlugin(
      { action: "run", moduleName: "WorldEditor", className: "RunCommandline" },
      d,
    );
    expect(!c.ok && c.message).toBe(NEVER_CALLED);
    expect(d.call).not.toHaveBeenCalled();
  });
  it("maps PRECONDITION_UNMET, GATED, NOT_IN_PROJECT and MODULE_NOT_OPEN from the handler", async () => {
    for (const code of [
      "PRECONDITION_UNMET",
      "GATED",
      "NOT_IN_PROJECT",
      "MODULE_NOT_OPEN",
      "PLUGIN_MODAL",
    ]) {
      const d = deps(
        vi
          .fn()
          .mockResolvedValue({ status: "refused", code, message: `${code}: x`, nextStep: "step" }),
      );
      const r = await runPlugin(snapReq("run", { confirm: true }), d);
      expect(!r.ok && [r.code, r.message, r.next]).toEqual([code, `${code}: x`, "step"]);
    }
  });
  it("PRECONDITION_UNMET without a nextStep takes the local default text", async () => {
    const d = deps(
      vi.fn().mockResolvedValue({ status: "refused", code: "PRECONDITION_UNMET", message: "m" }),
    );
    const r = await runPlugin(snapReq("run"), d);
    expect(!r.ok && r.next).toBe(ERROR_CODES.PRECONDITION_UNMET);
  });
  it("a handler error status and a missing status are HANDLER_ERROR", async () => {
    const e = await runPlugin(
      snapReq("run"),
      deps(vi.fn().mockResolvedValue({ status: "error", message: "no script class" })),
    );
    expect(!e.ok && [e.code, e.message]).toEqual(["HANDLER_ERROR", "no script class"]);
    const m = await runPlugin(snapReq("run"), deps(vi.fn().mockResolvedValue({})));
    expect(!m.ok && m.code).toBe("HANDLER_ERROR");
  });
  it("maps client errors: MODAL_OPEN, WEDGED, LOST (never retried) and anything else UNREACHABLE", async () => {
    const run = (e: unknown) =>
      runPlugin(snapReq("run", { confirm: true }), deps(vi.fn().mockRejectedValue(e)));
    expect((await run(wbErr("MODAL_OPEN"))) as { code: string }).toMatchObject({
      code: "MODAL_OPEN",
    });
    expect((await run(wbErr("WEDGED"))) as { code: string }).toMatchObject({ code: "WEDGED" });
    const lost = await run(wbErr("LOST"));
    expect(!lost.ok && lost.code).toBe("LOST");
    expect(!lost.ok && lost.next).toContain("never retried");
    expect((await run(wbErr("TIMEOUT"))) as { code: string }).toMatchObject({
      code: "UNREACHABLE",
    });
    expect((await run(new Error("boom"))) as { code: string }).toMatchObject({
      code: "UNREACHABLE",
    });
  });
  it("a read call lost keeps the default LOST next", async () => {
    const r = await runPlugin(snapReq("describe"), deps(vi.fn().mockRejectedValue(wbErr("LOST"))));
    expect(!r.ok && r.next).not.toContain("never retried");
  });
});

describe("registration and schema", () => {
  it("the registered tool's input schema is strict: a method key is refused, not stripped", () => {
    let schema: { safeParse: (v: unknown) => { success: boolean } } | undefined;
    const server = {
      registerTool: (_n: string, cfg: { inputSchema: typeof schema }) => {
        schema = cfg.inputSchema;
      },
    };
    registerWbPluginTool(server as never, {} as never, { catalog: () => [], allowList: () => [] });
    expect(schema!.safeParse(snapReq("run", { method: "RunCommandline" })).success).toBe(false);
    expect(schema!.safeParse(snapReq("run")).success).toBe(true);
    expect(schema!.safeParse(snapReq("run", { confirm: true })).success).toBe(true);
    expect(schema!.safeParse(snapReq("run", { confirm: "yes" })).success).toBe(false);
    expect(
      schema!.safeParse(snapReq("setSettings", { name: "a", value: "1.5", confirm: false }))
        .success,
    ).toBe(true);
  });
  it("run rejects a method parameter (strict per-action schema)", async () => {
    const d = deps();
    const r = await runPlugin(snapReq("run", { method: "RunCommandline" }), d);
    expect(!r.ok && r.code).toBe("INVALID_ARGUMENT");
    expect(d.call).not.toHaveBeenCalled();
  });
  it("an unknown action is INVALID_ARGUMENT", async () => {
    const r = await runPlugin({ action: "nope" }, deps());
    expect(!r.ok && r.code).toBe("INVALID_ARGUMENT");
  });
});
