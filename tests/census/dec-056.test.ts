/**
 * DEC-056 (Phase 4 exit rulings) tooling: W-series work items without a
 * deferral, the new dispose batch line types, the owner-deferral flag on a
 * batch outcome, the `live-only` explanation kind, G8's policy exemption,
 * G3/G9 skipping provisional rows, the state matrix's `values` and
 * `except`, and the ledger's synthesised `what`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildLedger } from "../../src/census/build-ledger.js";
import { runGates, type GateId, type Phase } from "../../src/census/gates.js";
import type { Row } from "../../src/census/schemas.js";
import { foldProbes, foldState } from "../../src/census/state.js";
import { run as runBuild } from "../../scripts/census/build.js";
import { run as runDispose } from "../../scripts/census/dispose.js";
import {
  apiClass,
  apiMethod,
  makeCensus,
  mcpTool,
  runIn,
  uiItem,
  writeEvidence,
  writeObservations,
  type Fixture,
} from "./helpers.js";

const BUILD = "1.0.0.1";
const CLASS = "api:WorldEditorAPI";
const METHOD = "api:WorldEditorAPI.GetSelectedEntity/1";
const ACTION = "mcp:action/wb_world.getSelection";
const EV = "EV-s1-001";

function census(): Fixture {
  const fx = makeCensus(BUILD);
  writeObservations(fx, "E02", BUILD, [
    apiClass("WorldEditorAPI", { children_count: 1 }),
    apiMethod("WorldEditorAPI", "GetSelectedEntity", 1),
  ]);
  writeObservations(fx, "E11", BUILD, mcpTool("wb_world", ["getSelection"]));
  writeEvidence(fx, EV);
  expect(runIn(fx, runBuild, []).code).toBe(0);
  return fx;
}

function rowOf(fx: Fixture, id: string): Row {
  const row = buildLedger(fx.paths).rows.find((r) => r.id === id);
  if (!row) throw new Error(`no row ${id}`);
  return row;
}

function batch(fx: Fixture, items: object[], evidence = EV): ReturnType<typeof runIn> {
  const file = join(fx.root, "batch.jsonl");
  writeFileSync(file, items.map((x) => JSON.stringify(x)).join("\n") + "\n");
  return runIn(fx, runDispose, ["--batch", file, "--evidence", evidence]);
}

function offendersOf(fx: Fixture, gate: GateId, phase: Phase = "4"): string[] {
  expect(runIn(fx, runBuild, []).code).toBe(0);
  return runGates(fx.paths, { gates: [gate], phase }).gates[0].offenders.map((o) => o.message);
}

describe("ruling 1: work items", () => {
  it("accepts a W-series id and sets a work item without deferring", () => {
    const fx = census();
    const r = runIn(fx, runDispose, [
      METHOD,
      "--work-item",
      "W1",
      "--reason",
      "wave W1 owns api/WorldEditor",
      "--evidence",
      EV,
    ]);
    expect(r.code).toBe(0);
    const row = rowOf(fx, METHOD);
    expect(row.status).toBe("active");
    expect(row.work_item).toBe("W1");
    expect(foldState(fx.paths).overlays.get(METHOD)?.work_item_reason).toBe(
      "wave W1 owns api/WorldEditor",
    );
    expect(offendersOf(fx, "G9").filter((m) => m.includes(METHOD))).toEqual([]);
  });

  it("refuses --work-item without --reason and an id outside the pattern", () => {
    const fx = census();
    expect(runIn(fx, runDispose, [METHOD, "--work-item", "W1", "--evidence", EV]).code).toBe(1);
    const bad = runIn(fx, runDispose, [
      METHOD,
      "--work-item",
      "wave-1",
      "--reason",
      "x",
      "--evidence",
      EV,
    ]);
    expect(bad.code).toBe(1);
    expect(bad.stderr).toContain("work_item");
  });
});

describe("ruling 1 and 12: batch line types", () => {
  it("applies disposition, work_item, defer and mcp lines under one evidence id", () => {
    const fx = census();
    const r = batch(fx, [
      { id: METHOD, as: "not-automatable", why: "needs a hand on the mouse" },
      { id: CLASS, work_item: "W1", reason: "wave W1" },
      { id: ACTION, defer: { reason: "waits on the manifest", work_item: "P6" } },
      { id: CLASS, mcp: [{ action: ACTION, role: "read" }] },
    ]);
    expect(r.code, r.stderr).toBe(0);
    expect(rowOf(fx, METHOD).disposition?.kind).toBe("not-automatable");
    const cls = rowOf(fx, CLASS);
    expect(cls.work_item).toBe("W1");
    expect(cls.status).toBe("active");
    expect(cls.mcp).toEqual([{ action: ACTION, role: "read" }]);
    const action = rowOf(fx, ACTION);
    expect(action.status).toBe("deferred");
    expect(action.work_item).toBe("P6");
    expect(offendersOf(fx, "G8")).toEqual([]);
  });

  it("writes nothing when one line is malformed", () => {
    const fx = census();
    const before = readFileSync(fx.paths.state, "utf-8");
    const cases: object[][] = [
      [{ id: METHOD, as: "not-automatable" }],
      [{ id: METHOD, as: "deferred", why: "x" }],
      [{ id: METHOD, work_item: "W1" }],
      [{ id: METHOD, defer: { reason: "x" } }],
      [
        { id: METHOD, defer: { reason: "x", work_item: "W1" } },
        { id: CLASS, defer: {} },
      ],
      [{ id: METHOD, mcp: [{ action: "mcp:action/nope.x", role: "read" }] }],
    ];
    for (const items of cases) {
      const r = batch(fx, items);
      expect(r.code, JSON.stringify(items)).toBe(1);
      expect(readFileSync(fx.paths.state, "utf-8")).toBe(before);
    }
  });

  it("retires an absent candidate as absent-in-build from a batch line", () => {
    const fx = census();
    const r = batch(fx, [{ id: "api:NoSuchRow.Gone/0", as: "absent-in-build", why: "gone" }]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("is not a ledger row");
  });
});

describe("ruling 2 and 13: owner-accepted deferral on a batch outcome", () => {
  it("sets deferral_accepted_by_owner and passes G6 at phase 4", () => {
    const fx = census();
    writeFileSync(
      fx.paths.probes,
      JSON.stringify({
        seq: 1,
        id: "P-E01-x-L1",
        op: "open",
        source: "recon",
        question: "Does x answer?",
        status: "scheduled",
        scheduled_session: "P4-8",
        by: "test",
      }) + "\n",
    );
    expect(offendersOf(fx, "G6").some((m) => m.includes("P-E01-x-L1"))).toBe(true);
    const r = batch(fx, [
      {
        probe: "P-E01-x-L1",
        outcome: "Deferred to wave W1: needs W1's handlers.",
        status: "deferred",
        owner_deferral: true,
      },
    ]);
    expect(r.code).toBe(0);
    const p = foldProbes(fx.paths).probes.get("P-E01-x-L1");
    expect(p?.status).toBe("deferred");
    expect(p?.deferral_accepted_by_owner).toBe(true);
    expect(offendersOf(fx, "G6").some((m) => m.includes("P-E01-x-L1"))).toBe(false);
  });
});

describe("ruling 7: live-only explanation", () => {
  it("is an accepted reconcile_explained kind", () => {
    const fx = census();
    const r = batch(fx, [
      {
        id: METHOD,
        reconcile_explained: {
          universe: "kind:control",
          enumerator: "L01",
          kind: "live-only",
          ref: "positional id; blind exploration P4-8 is the independent check",
        },
      },
    ]);
    expect(r.code).toBe(0);
    expect(foldState(fx.paths).overlays.get(METHOD)?.reconcile_explained[0].kind).toBe("live-only");
  });
});

describe("ruling 12: G8 policy exemption", () => {
  it("asks no row of an action listed in mcp_link_exempt", () => {
    const fx = census();
    expect(offendersOf(fx, "G8").some((m) => m.includes(ACTION))).toBe(true);
    const file = join(fx.root, "policy.json");
    const policy = JSON.parse(readFileSync(file, "utf-8")) as Record<string, unknown>;
    policy.mcp_link_exempt = [{ action: ACTION, reason: "touches no census surface" }];
    writeFileSync(file, JSON.stringify(policy, null, 2) + "\n");
    expect(offendersOf(fx, "G8")).toEqual([]);
    const g8 = runGates(fx.paths, { gates: ["G8"], phase: "4" }).gates[0];
    expect(g8.status).toBe("PASS");
    expect(g8.summary).toContain("1 exempt");
  });
});

describe("ruling 3: provisional rows belong to G6", () => {
  it("are skipped by G3 and G9 at phase 4", () => {
    const fx = makeCensus(BUILD);
    writeObservations(fx, "E01", BUILD, [
      {
        ...apiClass("Foo"),
        ref: "<repo>/docs/v2/recon/world-editor.md#L3",
        confidence: "high",
      },
    ]);
    writeEvidence(fx, EV);
    const row = rowOf(fx, "api:Foo");
    expect(row.provisional).toBe(true);
    expect(row.children_enumerated).toBe(false);
    expect(offendersOf(fx, "G3").filter((m) => m.includes("api:Foo"))).toEqual([]);
    expect(offendersOf(fx, "G9").filter((m) => m.includes("api:Foo"))).toEqual([]);
    expect(offendersOf(fx, "G6").filter((m) => m.includes("api:Foo"))).toHaveLength(1);
  });
});

describe("ruling 11: state matrix values and except", () => {
  const MENU = "ui:WorldEditor/menu/File";
  function matrixCensus(entry: Record<string, unknown>): Fixture {
    const fx = makeCensus(BUILD);
    writeObservations(fx, "E07", BUILD, [uiItem("WorldEditor", "menu", ["File"])]);
    writeEvidence(fx, EV);
    writeFileSync(
      join(fx.root, "state-matrix.json"),
      JSON.stringify(
        {
          version: 1,
          axes: { mode: ["edit", "play", "prefab-edit"] },
          applies: [{ kind: "menu", module: "WorldEditor", axes: ["mode"], why: "test", ...entry }],
        },
        null,
        2,
      ) + "\n",
    );
    return fx;
  }

  it("expands every axis value without them", () => {
    const fx = matrixCensus({});
    const mine = offendersOf(fx, "G3").filter((m) => m.startsWith(`${MENU}: state`));
    expect(mine).toHaveLength(3);
  });

  it("narrows an axis to the listed values", () => {
    const fx = matrixCensus({ values: { mode: ["edit", "play"] } });
    const mine = offendersOf(fx, "G3").filter((m) => m.startsWith(`${MENU}: state`));
    expect(mine).toHaveLength(2);
    expect(mine.some((m) => m.includes("prefab-edit"))).toBe(false);
  });

  it("asks nothing of an enumerate_only entry", () => {
    const fx = matrixCensus({ enumerate_only: true });
    expect(offendersOf(fx, "G3").filter((m) => m.startsWith(`${MENU}: state`))).toEqual([]);
  });

  it("leaves out a row named in except", () => {
    const fx = matrixCensus({ except: [MENU] });
    expect(offendersOf(fx, "G3").filter((m) => m.startsWith(`${MENU}: state`))).toEqual([]);
  });
});

describe("ruling 6: synthesised what", () => {
  it("writes what from kind, label and parent for a measured row that has none, and marks the source", () => {
    const fx = makeCensus(BUILD);
    writeObservations(fx, "E07", BUILD, [
      uiItem("WorldEditor", "menu", ["File"]),
      uiItem("WorldEditor", "menu-item", ["File", "Save World"], {
        parent_key: { dim: "ui", kind: "menu", module: "WorldEditor", key: { path: ["File"] } },
      }),
    ]);
    writeObservations(fx, "E02", BUILD, [apiClass("Foo")]);
    const item = rowOf(fx, "ui:WorldEditor/menu-item/File/Save World");
    expect(item.what_source).toBe("synthesised");
    expect(item.what).toBe("menu item 'Save World' in WorldEditor under File");
    expect(rowOf(fx, "ui:WorldEditor/menu/File").what).toBe("menu 'File' in WorldEditor");
    expect(rowOf(fx, "api:Foo").what_source).toBe("observed");
  });

  it("leaves a provisional row alone", () => {
    const fx = makeCensus(BUILD);
    writeObservations(fx, "E01", BUILD, [
      {
        ...uiItem("WorldEditor", "menu", ["File"]),
        ref: "<repo>/docs/v2/recon/world-editor.md#L3",
      },
    ]);
    const row = rowOf(fx, "ui:WorldEditor/menu/File");
    expect(row.provisional).toBe(true);
    expect(row.what).toBeUndefined();
    expect(row.what_source).toBeUndefined();
  });
});

describe("rulings 4 and 8: G2 reports a row that carries a work item as open", () => {
  it("moves the row from hard to open", () => {
    const fx = makeCensus(BUILD);
    const sw = (name: string, ref: string) => ({
      dim: "cli",
      kind: "cli-switch",
      module: "none",
      key: { switch: name },
      origin: "vanilla",
      ref,
      confidence: "high",
    });
    writeObservations(fx, "E05", BUILD, [sw("gproj", "exe:0x10"), sw("lsp", "exe:0x20")]);
    writeObservations(fx, "L13", BUILD, [sw("gproj", "ev:EV-s1-001")]);
    writeEvidence(fx, EV);
    expect(runIn(fx, runBuild, []).code).toBe(0);
    const before = runGates(fx.paths, { gates: ["G2"], phase: "4" }).gates[0];
    expect(before.status).toBe("FAIL");
    expect(before.offenders.some((o) => o.id === "cli:-lsp")).toBe(true);
    expect(
      runIn(fx, runDispose, [
        "cli:-lsp",
        "--work-item",
        "W1",
        "--reason",
        "L13 deferred",
        "--evidence",
        EV,
      ]).code,
    ).toBe(0);
    expect(runIn(fx, runBuild, []).code).toBe(0);
    const after = runGates(fx.paths, { gates: ["G2"], phase: "4" }).gates[0];
    expect(after.status).toBe("SOFT");
    expect(after.offenders.map((o) => o.message)).toEqual([
      expect.stringContaining("carries work item W1"),
    ]);
  });
});

describe("ruling 2: a deferred outcome needs the owner", () => {
  it("fails G6 at phase 4 until the deferral is owner-accepted", () => {
    const fx = census();
    writeFileSync(
      fx.paths.probes,
      JSON.stringify({
        seq: 1,
        id: "P-E01-x-L1",
        op: "open",
        source: "recon",
        question: "Does x answer?",
        status: "scheduled",
        scheduled_session: "W1",
        by: "test",
      }) + "\n",
    );
    expect(batch(fx, [{ probe: "P-E01-x-L1", outcome: "partial", status: "deferred" }]).code).toBe(
      0,
    );
    expect(
      offendersOf(fx, "G6").some((m) => m.includes("deferred outcome without an owner-accepted")),
    ).toBe(true);
    expect(
      batch(fx, [
        { probe: "P-E01-x-L1", outcome: "partial", status: "deferred", owner_deferral: true },
      ]).code,
    ).toBe(0);
    expect(offendersOf(fx, "G6").some((m) => m.includes("P-E01-x-L1"))).toBe(false);
  });
});

describe("ruling 1: G3 skips a row that carries a work item", () => {
  it("drops the frontier and state offenders of the row", () => {
    const fx = makeCensus(BUILD);
    writeObservations(fx, "E02", BUILD, [apiClass("Foo")]);
    writeEvidence(fx, EV);
    expect(offendersOf(fx, "G3").filter((m) => m.includes("api:Foo"))).toHaveLength(1);
    expect(
      runIn(fx, runDispose, ["api:Foo", "--work-item", "W1", "--reason", "W1 lists the members", "--evidence", EV]).code,
    ).toBe(0);
    expect(offendersOf(fx, "G3").filter((m) => m.includes("api:Foo"))).toEqual([]);
  });
});

describe("ruling 11: resource_type takes its values from measured file types only", () => {
  it("ignores a provisional file-type row", () => {
    const fx = makeCensus(BUILD);
    writeObservations(fx, "E07", BUILD, [
      uiItem("ResourceManager", "context-menu", ["Tree context"]),
      { dim: "file", kind: "file-type", module: "none", key: { ext: "et" }, label: ".et", origin: "vanilla", ref: "wiki:Arma_Reforger:File_Types#.et", confidence: "high" },
    ]);
    writeObservations(fx, "E01", BUILD, [
      { dim: "file", kind: "file-type", module: "none", key: { ext: "btx" }, label: ".btx", origin: "vanilla", ref: "<repo>/docs/v2/recon/world-editor.md#L9", confidence: "low" },
    ]);
    writeEvidence(fx, EV);
    const mine = offendersOf(fx, "G3").filter((m) => m.includes("context-menu/Tree context: state"));
    expect(mine).toHaveLength(1);
    expect(mine[0]).toContain("resource_type=et");
  });
});

describe("ruling 8: G6 keeps a recon row open while its live enumerator has not run", () => {
  it("reports the row as open with the enumerator it waits for, and as open with a work item otherwise", () => {
    const fx = makeCensus(BUILD);
    writeObservations(fx, "E01", BUILD, [
      { dim: "cli", kind: "cli-switch", module: "none", key: { switch: "lsp" }, origin: "vanilla", ref: "<repo>/docs/v2/recon/world-editor.md#L3", confidence: "low" },
      { ...apiClass("Foo"), ref: "<repo>/docs/v2/recon/world-editor.md#L4", confidence: "low" },
    ]);
    writeEvidence(fx, EV);
    expect(runIn(fx, runBuild, []).code).toBe(0);
    const g6 = runGates(fx.paths, { gates: ["G6"], phase: "4" }).gates[0];
    expect(g6.status).toBe("FAIL");
    expect(g6.offenders.map((o) => o.message)).toEqual([
      expect.stringContaining("api:Foo: recon row neither merged nor explained"),
      expect.stringContaining("cli:-lsp: recon row not merged yet; its kind awaits L13, which has not run"),
    ]);
    expect(
      runIn(fx, runDispose, ["api:Foo", "--work-item", "W8", "--reason", "no live walk read it", "--evidence", EV]).code,
    ).toBe(0);
    expect(runIn(fx, runBuild, []).code).toBe(0);
    const after = runGates(fx.paths, { gates: ["G6"], phase: "4" }).gates[0];
    expect(after.status).toBe("SOFT");
    expect(after.offenders.map((o) => o.message)).toEqual([
      expect.stringContaining("api:Foo: recon row not merged yet; carries work item W8"),
      expect.stringContaining("cli:-lsp: recon row not merged yet; its kind awaits L13"),
    ]);
  });
});

describe("ruling 8: G3 keeps a row's asks open while its live enumerator has not run", () => {
  it("reports the state pairs of a diag row as open, naming L15, and leaves the gate SOFT", () => {
    const fx = makeCensus(BUILD);
    writeObservations(fx, "E14", BUILD, [
      { dim: "diag", kind: "diag-option", module: "Shared", key: { path: ["Render", "Wireframe"] }, label: "Wireframe", origin: "vanilla", ref: "wiki:Arma_Reforger:Diag_Menu#Wireframe", confidence: "high", what: "Toggle wireframe rendering" },
    ]);
    writeEvidence(fx, EV);
    expect(runIn(fx, runBuild, []).code).toBe(0);
    const g3 = runGates(fx.paths, { gates: ["G3"], phase: "4" }).gates[0];
    const mine = g3.offenders.filter((o) => o.id === "diag:Render/Wireframe");
    expect(mine.map((o) => o.message)).toEqual([
      expect.stringContaining("state mode=edit not enumerated; awaits L15, which has not run"),
      expect.stringContaining("state mode=play not enumerated; awaits L15, which has not run"),
    ]);
    expect(g3.status).toBe("SOFT");
  });
});
