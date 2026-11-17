import { describe, expect, it } from "vitest";
import { WorkbenchError } from "../../src/workbench/client.js";
import type { WorkbenchClient, WorkbenchCallOptions } from "../../src/workbench/client.js";
import { DESCRIPTION_MAX } from "../../src/manifest/generate.js";
import type { DiagCatalog, DiagEntry } from "../../src/census/diag-catalog.js";
import {
  ALLOW_LIST_SWITCH,
  CATALOG_SWITCH,
  DIAG_CONTRACT,
  HANDLER,
  HANDLER_ACTIONS,
  checkSetValue,
  flatInputShape,
  prepareRequest,
  redactUser,
  registerWbDiag,
  runDiag,
  setAllowListOf,
  wbDiagDescription,
  type DiagDeps,
} from "../../src/tools/wb-diag.js";
import { captureTool, textOf } from "./_tool-harness.js";
import { ERROR_CODES } from "../../src/manifest/vocabulary.js";

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

function e(
  enumName: string,
  kind: DiagEntry["kind"],
  path = "",
  extra: Partial<DiagEntry> = {},
): DiagEntry {
  return {
    enumName,
    enum: kind === "engine" ? "EDiagMenu" : "SCR_DebugMenuID",
    id: 0,
    kind,
    path,
    label: path.split("/").pop() ?? "",
    values: "",
    shortcut: "",
    guard: "",
    declared: "scripts/Game/Utilities/DebugMenuID.c:1",
    registered: kind === "unknown" || kind === "engine" ? "" : "scripts/Game/X.c:1",
    registrations: kind === "unknown" || kind === "engine" ? 0 : 1,
    ...extra,
  };
}

/** A small catalog excerpt: one of each kind, a guarded id and a menu with a space in its name. */
const ENTRIES: DiagEntry[] = [
  e("DEBUGUI_AI_SCRIPT", "menu", "AI/AIScript", { id: 121, label: "AIScript" }),
  e("DEBUGUI_AI_PRINT_DEBUG", "bool", "AI/AIScript/Print debug"),
  e("DEBUGUI_AI_DEBUG_CATEGORY", "value", "AI/AIScript/Debug category", { values: "a,b" }),
  e("DEBUGUI_CHARACTER_ADS_CAMERA", "range", "Character/ADS Camera", { values: "0, 3, 0, 1" }),
  e("DEBUGUI_MANUAL_CAMERA", "menu", "Manual Camera", { id: 114, label: "Manual Camera" }),
  e("DEBUGUI_SINGLEPLAYER", "unknown"),
  e("DEBUGUI_AUTOTEST_PROGRESS", "bool", "GameCode/Autotest status", {
    id: null,
    guard: "ENABLE_DIAG",
  }),
  e("DM_REND_VSYNC_OVERRIDE", "engine", "", { id: 6 }),
];

const CATALOG: DiagCatalog = {
  $diag_catalog: 1,
  build: "1.9.0.37",
  generator: "scripts/census/gen-diag-catalog.ts",
  sources: {
    index_inputs_sha256: "x",
    scripts_scanned: 4,
    register_calls: 6,
    register_calls_other: 0,
  },
  counts: { script: 7, script_guarded: 1, engine: 1, registered: 6, unknown: 1 },
  entries: ENTRIES,
};

const ALL_ALLOWED = ENTRIES.map((x) => x.enumName);

const deps = (over: Partial<DiagDeps> = {}): DiagDeps => ({
  catalog: () => CATALOG,
  allowList: () => [],
  env: { USERNAME: "envuser" },
  ...over,
});

const neverCalled = () => fakeClient(() => new Error("must not be called"));

describe("wb_diag contract", () => {
  it("loads and names the five handler actions", () => {
    expect(DIAG_CONTRACT.tool).toBe("wb_diag");
    expect(HANDLER).toBe("EMCP_WB_Diag");
    expect([...HANDLER_ACTIONS].sort()).toEqual(["catalog", "get", "info", "select", "set"]);
  });

  it("its description fits the 400-char budget", () => {
    expect(wbDiagDescription().length).toBeLessThanOrEqual(DESCRIPTION_MAX);
  });

  it("the flat input shape carries every request key, arrays as arrays", () => {
    const shape = flatInputShape();
    for (const k of DIAG_CONTRACT.request) expect(Object.keys(shape)).toContain(k);
    expect(shape.names.safeParse(["A", "B"]).success).toBe(true);
    expect(shape.cmdNames.safeParse("A").success).toBe(false);
  });

  it("answers DIAG_UNKNOWN from the vocabulary (landed by the W8 integration)", () => {
    expect(ERROR_CODES.DIAG_UNKNOWN).toMatch(/SCR_DebugMenuID or EDiagMenu/);
  });
});

describe("catalog (served by the TS tool)", () => {
  it("answers rows without calling Workbench", async () => {
    const { client, sent } = neverCalled();
    const r = await runDiag(client, { action: "catalog" }, deps());
    expect(sent).toHaveLength(0);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const rb = r.readback as { total: number; rows: string[]; nextCursor: string | null };
    expect(rb.total).toBe(ENTRIES.length);
    expect(rb.rows[0]).toBe("AI/AIScript;DEBUGUI_AI_SCRIPT;menu;");
    expect(rb.rows).toContain("Character/ADS Camera;DEBUGUI_CHARACTER_ADS_CAMERA;range;0, 3, 0, 1");
    expect(rb.nextCursor).toBeNull();
  });

  it("pages with limit and cursor", async () => {
    const { client } = neverCalled();
    const first = await runDiag(client, { action: "catalog", limit: 3 }, deps());
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const rb1 = first.readback as { rows: string[]; nextCursor: string };
    expect(rb1.rows).toHaveLength(3);
    expect(rb1.nextCursor).toBe(`3:${ENTRIES.length}`);
    expect(first.next).toContain(rb1.nextCursor);
    const second = await runDiag(
      client,
      { action: "catalog", limit: 3, cursor: rb1.nextCursor },
      deps(),
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect((second.readback as { rows: string[] }).rows[0]).toContain(
      "DEBUGUI_CHARACTER_ADS_CAMERA",
    );
  });

  it("filters by menu path and warns about a guarded id on the page", async () => {
    const { client } = neverCalled();
    const ai = await runDiag(client, { action: "catalog", menu: "AI/AIScript" }, deps());
    expect(ai.ok && (ai.readback as { total: number }).total).toBe(3);
    const gc = await runDiag(client, { action: "catalog", menu: "GameCode" }, deps());
    expect(gc.ok).toBe(true);
    if (!gc.ok) return;
    expect(gc.warnings.join(" ")).toContain("#ifdef ENABLE_DIAG");
  });

  it("answers STALE_CURSOR when the total changed, INVALID_ARGUMENT for a bad cursor", async () => {
    const { client } = neverCalled();
    const stale = await runDiag(client, { action: "catalog", cursor: "3:99" }, deps());
    expect(!stale.ok && stale.code).toBe("STALE_CURSOR");
    const bad = await runDiag(client, { action: "catalog", cursor: "x" }, deps());
    expect(!bad.ok && bad.code).toBe("INVALID_ARGUMENT");
    const limit = await runDiag(client, { action: "catalog", limit: 500 }, deps());
    expect(!limit.ok && limit.code).toBe("INVALID_ARGUMENT");
  });

  it("answers GATED naming the generator when the catalog is absent or malformed", async () => {
    const { client } = neverCalled();
    const absent = await runDiag(client, { action: "catalog" }, deps({ catalog: () => undefined }));
    expect(absent.ok).toBe(false);
    if (absent.ok) return;
    expect(absent.code).toBe("GATED");
    expect(absent.next).toContain(CATALOG_SWITCH);
    const broken = await runDiag(
      client,
      { action: "catalog" },
      deps({
        catalog: () => {
          throw new Error("bad line");
        },
      }),
    );
    expect(!broken.ok && broken.code).toBe("GATED");
    expect(!broken.ok && broken.message).toContain("malformed");
  });
});

describe("get", () => {
  it("sends the names as a read and maps values, missing and gameMode", async () => {
    const { client, sent } = fakeClient(() =>
      ok({
        values: ["DEBUGUI_AI_PRINT_DEBUG=1", "DEBUGUI_CHARACTER_ADS_CAMERA=0"],
        missing: ["NOPE"],
        gameMode: 1,
        message: "2 values read",
      }),
    );
    const r = await runDiag(
      client,
      { action: "get", names: ["DEBUGUI_AI_PRINT_DEBUG", "DEBUGUI_CHARACTER_ADS_CAMERA", "NOPE"] },
      deps(),
    );
    expect(sent).toHaveLength(1);
    expect(sent[0].fn).toBe("EMCP_WB_Diag");
    expect(sent[0].options.access).toBe("read");
    expect(sent[0].params).toEqual({
      action: "get",
      names: ["DEBUGUI_AI_PRINT_DEBUG", "DEBUGUI_CHARACTER_ADS_CAMERA", "NOPE"],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.readback).toMatchObject({
      values: [
        { name: "DEBUGUI_AI_PRINT_DEBUG", value: "1" },
        { name: "DEBUGUI_CHARACTER_ADS_CAMERA", value: "0" },
      ],
      missing: ["NOPE"],
      gameMode: true,
    });
    expect(r.warnings.join(" ")).toContain("NOPE");
  });

  it("refuses before sending: no names, too many, a bad name, a bad kind or kind count", async () => {
    const cases: Record<string, unknown>[] = [
      { action: "get", names: [] },
      { action: "get", names: Array.from({ length: 301 }, (_, i) => `N${i}`) },
      { action: "get", names: ["has space"] },
      { action: "get", names: ["A", "B", "C"], kinds: ["bool", "value"] },
      { action: "get", names: ["A"], kinds: ["float"] },
      { action: "get", names: ["A"], extra: 1 },
    ];
    for (const input of cases) {
      const { client, sent } = neverCalled();
      const r = await runDiag(client, input, deps());
      expect(r.ok, JSON.stringify(input).slice(0, 80)).toBe(false);
      if (!r.ok) expect(r.code).toBe("INVALID_ARGUMENT");
      expect(sent).toHaveLength(0);
    }
  });

  it("maps the handler's DIAG_UNKNOWN and passes UNPROVEN for engine kinds through", async () => {
    const unknown = fakeClient(() =>
      refused("DIAG_UNKNOWN", "no name is a value", "wb_diag catalog"),
    );
    const r1 = await runDiag(unknown.client, { action: "get", names: ["NOPE"] }, deps());
    expect(!r1.ok && r1.code).toBe("DIAG_UNKNOWN");
    expect(!r1.ok && r1.warnings).toEqual([]);
    const engine = fakeClient(() => refused("UNPROVEN", "engine kinds wait for probe P-W8-08"));
    const r2 = await runDiag(
      engine.client,
      { action: "get", names: ["DM_REND_VSYNC_OVERRIDE"] },
      deps(),
    );
    expect(engine.sent).toHaveLength(1);
    expect(!r2.ok && r2.code).toBe("UNPROVEN");
    expect(!r2.ok && r2.message).toContain("P-W8-08");
  });

  it("does not need the catalog", async () => {
    const { client, sent } = fakeClient(() => ok({ values: ["A=0"], missing: [], gameMode: 0 }));
    const r = await runDiag(
      client,
      { action: "get", names: ["A"] },
      deps({ catalog: () => undefined }),
    );
    expect(r.ok).toBe(true);
    expect(sent).toHaveLength(1);
  });
});

describe("info", () => {
  const raw = {
    userName: "JaneDoe",
    cwd: "C:/Work/janedoe-mods",
    executable: "C:/Users/JaneDoe/Tools/ArmaReforgerWorkbenchSteamDiag.exe",
    projectFile: "D:/Projects/envuser/addon.gproj",
    projectSettingsClass: "ArmaReforgerProjectSettings",
    utcTime: "2026-11-12 10:11:12",
    scriptModules: ["WB=1", "WBGame=0"],
    cmdLine: ["gproj=C:/Users/JaneDoe/addon.gproj", "wbModule=WorldEditor"],
    gameMode: 0,
    message: "environment read; JaneDoe",
  };

  it("redacts the user name before the answer, everywhere it appears", async () => {
    const { client, sent } = fakeClient(() => ok(raw));
    const r = await runDiag(
      client,
      { action: "info", cmdNames: ["gproj", "wbModule", "absent"] },
      deps(),
    );
    expect(sent[0].options.access).toBe("read");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const text = JSON.stringify(r);
    expect(text).not.toMatch(/janedoe/i);
    expect(text).not.toContain("envuser");
    expect(r.readback).toMatchObject({
      userName: "<user>",
      cwd: "C:/Work/<user>-mods",
      executable: "<home-path>/Tools/ArmaReforgerWorkbenchSteamDiag.exe",
      projectFile: "D:/Projects/<user>/addon.gproj",
      projectSettingsClass: "ArmaReforgerProjectSettings",
      utcTime: "2026-11-12 10:11:12",
      scriptModules: { WB: true, WBGame: false },
      cmdLine: { gproj: "<home-path>/addon.gproj", wbModule: "WorldEditor" },
      gameMode: false,
    });
    expect(r.warnings.join(" ")).toContain("absent");
  });

  it("answers an empty userName when the handler read none", async () => {
    const { client } = fakeClient(() => ok({ ...raw, userName: "" }));
    const r = await runDiag(client, { action: "info" }, deps());
    expect(r.ok && (r.readback as { userName: string }).userName).toBe("");
  });

  it("refuses before sending: unknown module, the Particle Editor, too many or bad cmdNames", async () => {
    const cases: Record<string, unknown>[] = [
      { action: "info", module: "Nope" },
      { action: "info", module: "ParticleEditor" },
      { action: "info", cmdNames: Array.from({ length: 21 }, (_, i) => `n${i}`) },
      { action: "info", cmdNames: ["a=b"] },
    ];
    for (const input of cases) {
      const { client, sent } = neverCalled();
      const r = await runDiag(client, input, deps());
      expect(!r.ok && r.code).toBe("INVALID_ARGUMENT");
      expect(sent).toHaveLength(0);
    }
  });

  it("maps the handler's MODULE_NOT_OPEN", async () => {
    const { client } = fakeClient(() =>
      refused("MODULE_NOT_OPEN", "AudioEditor is not open", "wb_module open AudioEditor"),
    );
    const r = await runDiag(
      client,
      { action: "info", module: "AudioEditor", cmdNames: ["x"] },
      deps(),
    );
    expect(!r.ok && r.code).toBe("MODULE_NOT_OPEN");
    expect(!r.ok && r.next).toBe("wb_module open AudioEditor");
  });

  it("redactUser leaves short names alone and replaces home prefixes", () => {
    expect(redactUser("a b", "a", {})).toBe("a b");
    expect(redactUser("C:\\Users\\Someone\\x", "", {})).toBe("<home-path>\\x");
    expect(redactUser("Bob and BOB", "bob", {})).toBe("<user> and <user>");
  });
});

describe("set", () => {
  it("refuses DIAG_UNKNOWN for a name the catalog does not hold, before sending", async () => {
    const { client, sent } = neverCalled();
    const r = await runDiag(
      client,
      { action: "set", name: "NOPE", value: "1" },
      deps({ allowList: () => ["NOPE"] }),
    );
    expect(!r.ok && r.code).toBe("DIAG_UNKNOWN");
    expect(sent).toHaveLength(0);
  });

  it("refuses NOT_ALLOWLISTED while the allow-list is empty (seeded empty, OD-6)", async () => {
    const { client, sent } = neverCalled();
    const r = await runDiag(
      client,
      { action: "set", name: "DEBUGUI_AI_PRINT_DEBUG", value: "1" },
      deps(),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("NOT_ALLOWLISTED");
    expect(r.next).toContain(ALLOW_LIST_SWITCH);
    expect(sent).toHaveLength(0);
  });

  it("refuses a kind unknown id even when it is allow-listed", async () => {
    const { client, sent } = neverCalled();
    const r = await runDiag(
      client,
      { action: "set", name: "DEBUGUI_SINGLEPLAYER", value: "1" },
      deps({ allowList: () => ALL_ALLOWED }),
    );
    expect(!r.ok && r.code).toBe("NOT_ALLOWLISTED");
    expect(!r.ok && r.message).toContain("kind unknown");
    expect(sent).toHaveLength(0);
  });

  it("refuses a menu id, a kind that does not match the catalog and a bad value", async () => {
    const cases: Record<string, unknown>[] = [
      { action: "set", name: "DEBUGUI_AI_SCRIPT", value: "1" },
      { action: "set", name: "DEBUGUI_AI_PRINT_DEBUG", kind: "range", value: "1" },
      { action: "set", name: "DEBUGUI_AI_PRINT_DEBUG", value: "2" },
      { action: "set", name: "DEBUGUI_AI_DEBUG_CATEGORY", value: "1.5" },
      { action: "set", name: "DEBUGUI_CHARACTER_ADS_CAMERA", value: "x" },
      { action: "set", name: "DEBUGUI_AI_DEBUG_CATEGORY", value: "" },
      { action: "set", name: "bad name", value: "1" },
    ];
    for (const input of cases) {
      const { client, sent } = neverCalled();
      const r = await runDiag(client, input, deps({ allowList: () => ALL_ALLOWED }));
      expect(!r.ok && r.code, JSON.stringify(input)).toBe("INVALID_ARGUMENT");
      expect(sent).toHaveLength(0);
    }
  });

  it("refuses GATED when the catalog has not been generated", async () => {
    const { client, sent } = neverCalled();
    const r = await runDiag(
      client,
      { action: "set", name: "DEBUGUI_AI_PRINT_DEBUG", value: "1" },
      deps({ catalog: () => undefined, allowList: () => ALL_ALLOWED }),
    );
    expect(!r.ok && r.code).toBe("GATED");
    expect(sent).toHaveLength(0);
  });

  it("sends an allow-listed option as a mutate with the catalog's kind, and maps the answer", async () => {
    const { client, sent } = fakeClient(() =>
      ok({ previous: "0", readback: "1", changed: 1, gameMode: 1, message: "0 -> 1" }),
    );
    const r = await runDiag(
      client,
      { action: "set", name: "DEBUGUI_AI_PRINT_DEBUG", value: "1" },
      deps({ allowList: () => ["DEBUGUI_AI_PRINT_DEBUG"] }),
    );
    expect(sent).toHaveLength(1);
    expect(sent[0].options.access).toBe("mutate");
    expect(sent[0].params).toEqual({
      action: "set",
      name: "DEBUGUI_AI_PRINT_DEBUG",
      kind: "bool",
      value: "1",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.readback).toMatchObject({
      previous: "0",
      readback: "1",
      changed: true,
      gameMode: true,
    });
    expect(r.changed).toEqual([{ path: "diag.DEBUGUI_AI_PRINT_DEBUG", before: "0", after: "1" }]);
    expect(r.next).toContain('value "0"');
  });

  it("warns when the value read back equals the value before", async () => {
    const { client } = fakeClient(() => ok({ previous: "1", readback: "1", changed: 0 }));
    const r = await runDiag(
      client,
      { action: "set", name: "DEBUGUI_AI_PRINT_DEBUG", value: "true" },
      deps({ allowList: () => ALL_ALLOWED }),
    );
    expect(r.ok && r.changed).toBeNull();
    expect(r.ok && r.warnings.join(" ")).toContain("equals the value before");
  });

  it("warns when the handler answers the asked value was not applied (review W8-DIAG-01)", async () => {
    const { client } = fakeClient(() =>
      ok({ previous: "1", readback: "3", changed: 1, applied: 0, message: "1 -> 3" }),
    );
    const r = await runDiag(
      client,
      { action: "set", name: "DEBUGUI_AI_DEBUG_CATEGORY", value: "5" },
      deps({ allowList: () => ALL_ALLOWED }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.readback).toMatchObject({ applied: false, readback: "3" });
    expect(r.warnings.join(" ")).toMatch(/not the value asked for \(5\)/);
    const yes = fakeClient(() => ok({ previous: "0", readback: "1", changed: 1, applied: 1 }));
    const y = await runDiag(
      yes.client,
      { action: "set", name: "DEBUGUI_AI_PRINT_DEBUG", value: "1" },
      deps({ allowList: () => ALL_ALLOWED }),
    );
    expect(y.ok && y.readback).toMatchObject({ applied: true });
    expect(y.ok && y.warnings.join(" ")).not.toMatch(/not the value asked for/);
  });

  it("passes the handler's UNPROVEN for range and engine kinds through", async () => {
    for (const [name, value, kind] of [
      ["DEBUGUI_CHARACTER_ADS_CAMERA", "0.5", "range"],
      ["DM_REND_VSYNC_OVERRIDE", "1", "engine"],
      ["DM_REND_VSYNC_OVERRIDE", "1.5", "engineRange"],
    ]) {
      const { client, sent } = fakeClient(() => refused("UNPROVEN", `${kind} waits for its probe`));
      const input: Record<string, unknown> = { action: "set", name, value };
      if (kind === "engineRange") input.kind = kind;
      const r = await runDiag(client, input, deps({ allowList: () => ALL_ALLOWED }));
      expect(sent).toHaveLength(1);
      expect(sent[0].params.kind).toBe(kind);
      expect(!r.ok && r.code).toBe("UNPROVEN");
    }
  });

  it("maps LOST (never retried, read back first), MODAL_OPEN and WEDGED", async () => {
    const lost = fakeClient(() => new WorkbenchError("lost", "LOST"));
    const r1 = await runDiag(
      lost.client,
      { action: "set", name: "DEBUGUI_AI_PRINT_DEBUG", value: "1" },
      deps({ allowList: () => ALL_ALLOWED }),
    );
    expect(!r1.ok && r1.code).toBe("LOST");
    expect(!r1.ok && r1.next).toContain('wb_diag get names ["DEBUGUI_AI_PRINT_DEBUG"]');
    expect(lost.sent).toHaveLength(1);
    for (const code of ["MODAL_OPEN", "WEDGED"] as const) {
      const { client } = fakeClient(() => new WorkbenchError(code, code));
      const r = await runDiag(
        client,
        { action: "set", name: "DEBUGUI_AI_PRINT_DEBUG", value: "1" },
        deps({ allowList: () => ALL_ALLOWED }),
      );
      expect(!r.ok && r.code).toBe(code);
    }
  });

  it("checkSetValue follows the handler's value rules", () => {
    expect(checkSetValue("bool", "false")).toBeUndefined();
    expect(checkSetValue("value", "-3")).toBeUndefined();
    expect(checkSetValue("range", "1e-3")).toBeUndefined();
    // Inf would be stored and raise the BadFloat modal on the next read: refused before the call.
    expect(checkSetValue("range", "1e999")).toMatch(/within/);
    expect(checkSetValue("engineRange", "-2e9")).toMatch(/within/);
    expect(checkSetValue("engine", "1.0")).toMatch(/integer/);
    expect(checkSetValue("value", "1".repeat(65))).toMatch(/at most 64/);
  });
});

describe("select", () => {
  it("sends a menuId as a mutate and maps selected", async () => {
    const { client, sent } = fakeClient(() =>
      ok({ selected: "DEBUGUI_AI_SCRIPT", message: "selected" }),
    );
    const r = await runDiag(client, { action: "select", menuId: 121 }, deps());
    expect(sent[0].options.access).toBe("mutate");
    expect(sent[0].params).toEqual({ action: "select", menuId: 121 });
    expect(r.ok && r.readback).toMatchObject({ selected: "DEBUGUI_AI_SCRIPT" });
  });

  it("refuses neither or both of menu and menuId, and a negative menuId", async () => {
    for (const input of [
      { action: "select" },
      { action: "select", menu: "AIScript", menuId: 1 },
      { action: "select", menuId: -1 },
    ]) {
      const { client, sent } = neverCalled();
      const r = await runDiag(client, input, deps());
      expect(!r.ok && r.code).toBe("INVALID_ARGUMENT");
      expect(sent).toHaveLength(0);
    }
  });

  it("refuses a menu name the handler cannot take, pointing at its menuId", async () => {
    const { client, sent } = neverCalled();
    const r = await runDiag(client, { action: "select", menu: "Manual Camera" }, deps());
    expect(!r.ok && r.code).toBe("INVALID_ARGUMENT");
    expect(!r.ok && r.next).toContain("menuId 114");
    expect(sent).toHaveLength(0);
  });

  it("maps the handler's WRONG_MODE outside play mode", async () => {
    const { client } = fakeClient(() => refused("WRONG_MODE", "select runs in play mode only"));
    const r = await runDiag(client, { action: "select", menu: "AIScript" }, deps());
    expect(!r.ok && r.code).toBe("WRONG_MODE");
  });
});

describe("handler answers and policy", () => {
  it("maps an unknown refusal code to INVALID_ARGUMENT with a warning, an error to HANDLER_ERROR", async () => {
    const odd = fakeClient(() => refused("SOMETHING_NEW"));
    const r1 = await runDiag(odd.client, { action: "get", names: ["A"] }, deps());
    expect(!r1.ok && r1.code).toBe("INVALID_ARGUMENT");
    expect(!r1.ok && r1.warnings[0]).toContain("SOMETHING_NEW");
    const err = fakeClient(() => ({ status: "error", code: "", message: "boom" }));
    const r2 = await runDiag(err.client, { action: "get", names: ["A"] }, deps());
    expect(!r2.ok && r2.code).toBe("HANDLER_ERROR");
    const weird = fakeClient(() => ({ status: "maybe" }));
    const r3 = await runDiag(weird.client, { action: "get", names: ["A"] }, deps());
    expect(!r3.ok && r3.code).toBe("UNREACHABLE");
  });

  it("refuses an unknown action", () => {
    const p = prepareRequest({ action: "eval" }, deps());
    expect(!p.ok && p.error.code).toBe("INVALID_ARGUMENT");
  });

  it("reads diag.set_allow_list names, not the probe pack's list", () => {
    expect(setAllowListOf(null)).toEqual([]);
    expect(setAllowListOf({ diag: { set_allow_list: ["A", { name: "B" }, 3, ""] } })).toEqual([
      "A",
      "B",
    ]);
    expect(setAllowListOf({ probe_mut: { diag_set_allow_list: [{ key: "script:A" }] } })).toEqual(
      [],
    );
  });
});

describe("registerWbDiag", () => {
  it("serves catalog through the registered handler and flags refusals as errors", async () => {
    const { client } = neverCalled();
    const handler = captureTool((s) => registerWbDiag(s, client, deps()));
    const r = await handler({ action: "catalog", limit: 2, menu: undefined });
    expect(r.isError).toBeUndefined();
    expect(JSON.parse(textOf(r)).readback.rows).toHaveLength(2);
    const bad = await handler({ action: "set", name: "DEBUGUI_AI_PRINT_DEBUG", value: "1" });
    expect(bad.isError).toBe(true);
    expect(JSON.parse(textOf(bad)).code).toBe("NOT_ALLOWLISTED");
  });
});

// Census rows this file tests (W8 close-out, EV-W8-211).
// census:mcp:action/wb_diag.info
