/**
 * Cold-test question sampler (plan 4.6, Phase 1 item 8): determinism for a seed,
 * a different draw for another seed, stratification by dimension, no id in any
 * question text, a disambiguating fact for an ambiguous label, recon-only and
 * aggregate rows never drawn. The synthetic ledger is built inside the test; a
 * last block runs the sampler over the real ledger when it is present.
 */
import { describe, it, expect } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toJsonl } from "../../src/census/canon.js";
import { censusPaths, loadLedger, type LoadedLedger } from "../../src/census/ledger-io.js";
import { normalizeLabel } from "../../src/census/ids.js";
import { describe as describeRow, find, toolActionFor } from "../../src/census/query-engine.js";
import { howto, loadReach } from "../../src/tools/wb-census.js";
import { ROW_FIELD_ORDER, type Row } from "../../src/census/schemas.js";
import { DIMS, MODULES } from "../../src/census/vocab.js";
import {
  EMPTY_KEY_DATA,
  allocate,
  answerPasses,
  buildQuestion,
  expectedFor,
  factsFor,
  loadKeyData,
  type KeyData,
  makeResolver,
  needsOwner,
  run as runSampler,
  sampleQuestions,
} from "../../scripts/census/sample-questions.js";
import { memoryIo } from "../../scripts/census/cli-common.js";
import { REAL_CENSUS } from "./helpers.js";

// ── Synthetic ledger ──────────────────────────────────────────────────────────

function row(id: string, extra: Partial<Row> = {}): Row {
  const dim = id.slice(0, id.indexOf(":"));
  return {
    id,
    shard: "core",
    dim,
    kind: "menu-item",
    module: "WorldEditor",
    parent: null,
    label: id.slice(id.lastIndexOf("/") + 1),
    risk_confirmed: false,
    origin: "vanilla",
    aggregate: false,
    provisional: false,
    sources: [{ enumerator: "E07", build: "1.0.0.1", ref: "doc:x", confidence: "high" }],
    build: { first_seen: "1.0.0.1", last_seen: "1.0.0.1" },
    children_enumerated: "n/a",
    observed_states: [],
    status: "active",
    paths: [{ path: "gui-automation", status: "candidate" }],
    tier: "T0",
    target_tier: "T5",
    target_tier_source: "policy",
    tier_evidence: [],
    weak_only: false,
    mcp: [],
    mcp_proposed: [],
    tests: [],
    unverified: [],
    ...extra,
  } as Row;
}

function recon(r: Row): Row {
  return {
    ...r,
    provisional: true,
    sources: [{ enumerator: "E01", build: "1.0.0.1", ref: "recon:x", confidence: "low" }],
  };
}

function ledgerOf(rows: Row[]): LoadedLedger {
  const byId = new Map<string, Row>();
  const children = new Map<string, Row[]>();
  for (const r of rows) {
    byId.set(r.id, r);
    if (typeof r.parent === "string") {
      const list = children.get(r.parent);
      if (list) list.push(r);
      else children.set(r.parent, [r]);
    }
  }
  return {
    rows,
    byId,
    children,
    meta: { build: { tag: "1.0.0.1", branch: "stable", ui_language: "en" } },
  };
}

/** The kinds and modules each dimension is built from, `perCell` rows per (kind, module). */
const SHAPE: Record<string, { kinds: Row["kind"][]; modules: Row["module"][] }> = {
  ui: { kinds: ["menu-item", "dialog", "panel"], modules: ["WorldEditor", "ScriptEditor"] },
  api: { kinds: ["method", "class"], modules: ["Shared", "ResourceManager"] },
  plugin: { kinds: ["plugin", "plugin-setting"], modules: ["ResourceManager", "WorldEditor"] },
  net: { kinds: ["net-handler", "net-field"], modules: ["none", "Shared"] },
  cli: { kinds: ["cli-switch"], modules: ["none", "WorldEditor"] },
  file: { kinds: ["file-type"], modules: ["AudioEditor", "ParticleEditor"] },
  schema: { kinds: ["schema-class", "schema-key"], modules: ["AnimEditor", "BehaviorEditor"] },
  setting: { kinds: ["setting-key", "option"], modules: ["WorldEditor", "Launcher"] },
  link: { kinds: ["link-format"], modules: ["none", "Shared"] },
  diag: { kinds: ["diag-menu", "diag-option"], modules: ["Shared", "none"] },
  mcp: { kinds: ["mcp-tool", "mcp-action"], modules: ["none", "WorldEditor"] },
};

function syntheticRows(perCell = 4): Row[] {
  const rows: Row[] = [];
  for (const dim of DIMS) {
    for (const kind of SHAPE[dim].kinds) {
      for (const module of SHAPE[dim].modules) {
        for (let i = 0; i < perCell; i++) {
          const name = `${dim}${kind.replace(/-/g, "")}${module.replace(/\W/g, "")}${i}`;
          rows.push(row(`${dim}:${kind}/${name}`, { kind, module, label: name } as Partial<Row>));
        }
      }
    }
  }
  return rows;
}

const ids = (s: { questions: { id: string }[] }): string[] => s.questions.map((q) => q.id);
const isUnnamed = (r: Row): boolean => !r.label && !r.object_name && !r.class_name;

// ── allocate ──────────────────────────────────────────────────────────────────

describe("allocate", () => {
  it("gives every dimension with rows at least two and sums to the count", () => {
    const eligible = Object.fromEntries(DIMS.map((d) => [d, 0])) as Record<string, number>;
    Object.assign(eligible, { ui: 1582, api: 11816, schema: 15366, cli: 157, link: 28, file: 68 });
    const q = allocate(eligible, 30);
    expect(Object.values(q).reduce((s, n) => s + n, 0)).toBe(30);
    for (const d of ["ui", "api", "schema", "cli", "link", "file"]) {
      expect(q[d]).toBeGreaterThanOrEqual(2);
    }
    expect(q.diag).toBeUndefined();
    expect(q.schema).toBeGreaterThan(q.ui);
    expect(q.api).toBeGreaterThan(q.cli);
  });

  it("follows the share of rows when the shares are large enough", () => {
    const eligible = Object.fromEntries(DIMS.map((d) => [d, 0])) as Record<string, number>;
    Object.assign(eligible, { ui: 6000, api: 3000, schema: 1000 });
    expect(allocate(eligible, 30)).toEqual({ ui: 18, api: 9, schema: 3 });
  });

  it("never gives a dimension more than it has and never fewer than it can", () => {
    const eligible = Object.fromEntries(DIMS.map((d) => [d, 0])) as Record<string, number>;
    Object.assign(eligible, { ui: 1, api: 3 });
    const q = allocate(eligible, 30);
    expect(q).toEqual({ ui: 1, api: 3 });
  });

  it("lowers the floor when the count is below two per dimension", () => {
    const eligible = Object.fromEntries(DIMS.map((d) => [d, 10])) as Record<string, number>;
    const q = allocate(eligible, 6);
    expect(Object.values(q).reduce((s, n) => s + n, 0)).toBe(6);
    expect(Math.max(...Object.values(q))).toBeLessThanOrEqual(1);
  });
});

// ── sampleQuestions ───────────────────────────────────────────────────────────

describe("sampleQuestions", () => {
  const ledger = ledgerOf(syntheticRows());

  it("is deterministic for a seed: same questions, same key", () => {
    const a = sampleQuestions(ledger, { seed: 42 });
    const b = sampleQuestions(ledgerOf(syntheticRows()), { seed: 42 });
    expect(a).toEqual(b);
    expect(a.questions).toHaveLength(30);
  });

  it("draws differently for another seed", () => {
    const a = sampleQuestions(ledger, { seed: 1 });
    const b = sampleQuestions(ledger, { seed: 2 });
    expect(ids(a)).not.toEqual(ids(b));
    expect([...ids(a)].sort()).not.toEqual([...ids(b)].sort());
  });

  it("does not depend on the order the rows were loaded in", () => {
    const rows = syntheticRows();
    const a = sampleQuestions(ledgerOf(rows), { seed: 7 });
    const b = sampleQuestions(ledgerOf([...rows].reverse()), { seed: 7 });
    expect(a).toEqual(b);
  });

  it("gives every dimension with eligible rows at least two questions", () => {
    for (const seed of [1, 2, 3]) {
      const s = sampleQuestions(ledger, { seed });
      for (const d of DIMS) expect(s.summary.spread[d]).toBeGreaterThanOrEqual(2);
      expect(Object.values(s.summary.spread).reduce((n, v) => n + v, 0)).toBe(30);
    }
  });

  it("gives a dimension that has only one eligible row that one question", () => {
    const rows = syntheticRows().filter((r) => r.dim !== "link");
    rows.push(
      row("link:Only one", { dim: "link", kind: "link-format", module: "none", label: "Only one" }),
    );
    const s = sampleQuestions(ledgerOf(rows), { seed: 5 });
    expect(s.summary.eligible.link).toBe(1);
    expect(s.summary.spread.link).toBe(1);
    expect(s.questions).toHaveLength(30);
  });

  it("draws nothing from a dimension that has rows but none a reader can be asked about", () => {
    const rows = syntheticRows().filter((r) => r.dim !== "link");
    rows.push(
      recon(
        row("link:Recon only one", {
          dim: "link",
          kind: "link-format",
          module: "none",
          label: "Recon only one",
        }),
      ),
    );
    const s = sampleQuestions(ledgerOf(rows), { seed: 5 });
    expect(s.summary.eligible.link).toBe(0);
    expect(s.summary.spread.link).toBe(0);
    expect(s.questions).toHaveLength(30);
  });

  it("spreads a dimension's questions over its kinds and modules", () => {
    const s = sampleQuestions(ledger, { seed: 11, count: 22 });
    for (const d of DIMS) {
      expect(s.summary.spread[d]).toBe(2);
      const qs = s.questions.filter((q) => q.dim === d);
      if (SHAPE[d].kinds.length >= 2) expect(new Set(qs.map((q) => q.kind)).size).toBe(2);
    }
    const wide = sampleQuestions(ledger, { seed: 11, count: 60 });
    const ui = wide.questions.filter((q) => q.dim === "ui");
    expect(new Set(ui.map((q) => q.kind)).size).toBe(3);
    expect(new Set(ui.map((q) => q.module)).size).toBe(2);
  });

  it("never draws a recon-only or an aggregate row", () => {
    const rows = syntheticRows();
    const planted: string[] = [];
    for (const d of DIMS) {
      const kind = SHAPE[d].kinds[0];
      const r = row(`${d}:${kind}/Planted recon ${d}`, { kind, module: SHAPE[d].modules[0] });
      planted.push(recon(r).id);
      rows.push(recon(r));
      const a = row(`${d}:${kind}/Planted aggregate ${d}`, {
        kind,
        module: SHAPE[d].modules[0],
        aggregate: true,
      });
      planted.push(a.id);
      rows.push(a);
      // measured by E01 and nothing else, but not flagged provisional: still recon-only
      const e01 = row(`${d}:${kind}/Planted E01 ${d}`, {
        kind,
        module: SHAPE[d].modules[0],
        sources: [{ enumerator: "E01", build: "1.0.0.1", ref: "recon:y", confidence: "low" }],
      });
      planted.push(e01.id);
      rows.push(e01);
    }
    const l = ledgerOf(rows);
    for (let seed = 1; seed <= 25; seed++) {
      const s = sampleQuestions(l, { seed, count: 60 });
      for (const q of s.questions) expect(planted).not.toContain(q.id);
    }
    const s = sampleQuestions(l, { seed: 1 });
    expect(s.summary.excluded["recon-only"]).toBe(2 * DIMS.length);
    expect(s.summary.excluded.aggregate).toBe(DIMS.length);
  });

  it("leaves out rows with no name to ask about", () => {
    const rows = syntheticRows();
    const nameless = row("cli:cli-switch/", {
      kind: "cli-switch",
      module: "none",
      label: undefined,
    });
    rows.push(nameless);
    const s = sampleQuestions(ledgerOf(rows), { seed: 3, count: 200 });
    expect(ids(s)).not.toContain(nameless.id);
    expect(s.summary.excluded["no-name"]).toBe(1);
  });

  it("never puts a row id in a question", () => {
    for (const seed of [1, 2, 3, 4]) {
      const s = sampleQuestions(ledger, { seed, count: 80 });
      for (const q of s.questions) {
        for (const r of ledger.rows) expect(q.text.includes(r.id)).toBe(false);
        expect(q.text).not.toContain(q.id);
      }
    }
  });

  it("writes every question about a name the row has, in plain words", () => {
    const s = sampleQuestions(ledger, { seed: 9 });
    for (const q of s.questions) {
      const r = ledger.byId.get(q.id) as Row;
      expect(q.text).toContain(`'${r.label}'`);
      expect(q.text).toMatch(
        /^Which row describes the .+, and by which path could it be (driven|read or changed|reached)\?$/,
      );
    }
  });

  it("carries the paths recorded on the row into the answer key", () => {
    const rows = syntheticRows();
    rows[0] = {
      ...rows[0],
      paths: [
        { path: "net-api-handler", status: "candidate", reason: "r" },
        { path: "gui-automation", status: "candidate" },
      ],
    };
    const s = sampleQuestions(ledgerOf(rows), { seed: 1, count: 400 });
    const q = s.questions.find((x) => x.id === rows[0].id);
    expect(q?.paths).toEqual([
      { path: "net-api-handler", status: "candidate", reason: "r" },
      { path: "gui-automation", status: "candidate" },
    ]);
  });

  it("reports the askable rows per dimension on request", () => {
    const s = sampleQuestions(ledger, { seed: 1, askable: true });
    expect(s.summary.askable?.ui).toBe(s.summary.eligible.ui);
  });
});

// ── Ambiguity ─────────────────────────────────────────────────────────────────

describe("buildQuestion", () => {
  it("adds the module when two modules share a label", () => {
    const l = ledgerOf([
      row("ui:WorldEditor/menu-item/Save", { module: "WorldEditor" }),
      row("ui:ScriptEditor/menu-item/Save", { module: "ScriptEditor" }),
    ]);
    const res = makeResolver(l);
    const a = buildQuestion(l, res, l.rows[0]);
    const b = buildQuestion(l, res, l.rows[1]);
    expect(a?.text).toContain("in the World Editor");
    expect(b?.text).toContain("in the Script Editor");
  });

  it("adds the parent's label when module and label are shared", () => {
    const l = ledgerOf([
      row("ui:WorldEditor/menu/File", { kind: "menu" }),
      row("ui:WorldEditor/menu/Project", { kind: "menu" }),
      row("ui:WorldEditor/menu-item/File/Save", {
        parent: "ui:WorldEditor/menu/File",
        label: "Save",
      }),
      row("ui:WorldEditor/menu-item/Project/Save", {
        parent: "ui:WorldEditor/menu/Project",
        label: "Save",
      }),
    ]);
    const res = makeResolver(l);
    const file = buildQuestion(l, res, l.byId.get("ui:WorldEditor/menu-item/File/Save") as Row);
    const proj = buildQuestion(l, res, l.byId.get("ui:WorldEditor/menu-item/Project/Save") as Row);
    expect(file?.text).toBe(
      "Which row describes the menu item 'Save' under the menu 'File' in the World Editor, and by which path could it be driven?",
    );
    expect(proj?.text).toContain("under the menu 'Project'");
    for (const b of [file, proj]) {
      expect(b && res.satisfiers(b.spec)).toHaveLength(1);
    }
  });

  it("adds the class when the parent does not tell two rows apart", () => {
    const l = ledgerOf([
      row("ui:BlenderTools/blender-operator/a.one", {
        kind: "blender-operator",
        module: "BlenderTools",
        label: "Run Background Task",
        class_name: "EBT_OT_one",
      }),
      row("ui:BlenderTools/blender-operator/a.two", {
        kind: "blender-operator",
        module: "BlenderTools",
        label: "Run Background Task",
        class_name: "EBT_OT_two",
      }),
    ]);
    const res = makeResolver(l);
    const a = buildQuestion(l, res, l.rows[0]);
    expect(a?.text).toContain("whose class is 'EBT_OT_one'");
    expect(a?.text).not.toContain("a.one");
    expect(res.satisfiers((a as { spec: Parameters<typeof res.satisfiers>[0] }).spec)).toEqual([
      l.rows[0],
    ]);
  });

  it("adds a setting's section when the module does not settle it", () => {
    const l = ledgerOf([
      row("setting:World Editor%2FGrid/Size", {
        dim: "setting",
        kind: "setting-key",
        module: "WorldEditor",
        label: undefined,
      }),
      row("setting:World Editor%2FSnap/Size", {
        dim: "setting",
        kind: "setting-key",
        module: "WorldEditor",
        label: undefined,
      }),
    ]);
    const res = makeResolver(l);
    const a = buildQuestion(l, res, l.rows[0]);
    expect(a?.text).toContain("in the settings section 'World Editor/Grid'");
    expect(a?.text).toContain("the setting 'Size'");
  });

  it("looks at the whole ledger, recon-only rows included", () => {
    const l = ledgerOf([
      row("ui:WorldEditor/menu-item/Save", { module: "WorldEditor" }),
      recon(row("ui:WorldEditor/menu-item/Save (recon)", { module: "WorldEditor", label: "Save" })),
    ]);
    expect(buildQuestion(l, makeResolver(l), l.rows[0])).toBeNull();
  });

  it("gives up on a row nothing can tell from another, and the sampler draws another", () => {
    const twins = [
      row("ui:WorldEditor/menu-item/Twin/1", { label: "Twin" }),
      row("ui:WorldEditor/menu-item/Twin/2", { label: "Twin" }),
    ];
    const l = ledgerOf([...syntheticRows(), ...twins]);
    expect(buildQuestion(l, makeResolver(l), twins[0])).toBeNull();
    for (let seed = 1; seed <= 20; seed++) {
      const s = sampleQuestions(l, { seed, count: 300 });
      expect(ids(s)).not.toContain(twins[0].id);
      expect(ids(s)).not.toContain(twins[1].id);
    }
  });

  it("matches a name without regard to case and mnemonic markers", () => {
    const l = ledgerOf([
      row("ui:WorldEditor/menu-item/Save", { label: "Save" }),
      row("ui:WorldEditor/menu-item/save-again", { label: "save", label_raw: "&save" }),
    ]);
    expect(buildQuestion(l, makeResolver(l), l.rows[0])).toBeNull();
  });

  it("refuses a name whose search would not list the row", () => {
    // 201 exact-name rows of one kind: the expected row sits past the 200-row page.
    const parents = Array.from({ length: 201 }, (_, i) =>
      row(`ui:WorldEditor/menu/P${String(i).padStart(3, "0")}`, {
        kind: "menu",
        label: `P${String(i).padStart(3, "0")}`,
      }),
    );
    const kids = parents.map((p, i) =>
      row(`ui:WorldEditor/menu-item/${p.label}/Same`, {
        parent: p.id,
        label: "Same",
        sources: [{ enumerator: "E07", build: "1.0.0.1", ref: `doc:${i}`, confidence: "high" }],
      }),
    );
    const l = ledgerOf([...parents, ...kids]);
    const res = makeResolver(l);
    const last = kids[kids.length - 1];
    const built = buildQuestion(l, res, last);
    expect(built).toBeNull();
    expect(buildQuestion(l, res, last, { skipFind: true })).not.toBeNull();
    expect(find(l, "Same", { kind: "menu-item", module: "WorldEditor" }, 1, 200).rows).toHaveLength(
      200,
    );
  });
});

// ── Cold test 2026-11-14: the four misses ─────────────────────────────────────

/** The shapes behind the four misses of the first Phase 6 cold test, and enough noise around them. */
function coldRows(): Row[] {
  const out: Row[] = [
    row("schema:IOPItemOpEnvClass", {
      dim: "schema",
      kind: "schema-class",
      module: "AudioEditor",
      label: "IOPItemOpEnvClass",
      paths: [{ path: "file-format", status: "candidate" }],
    }),
    row("schema:IOPItemOpEnvClass.d", {
      dim: "schema",
      kind: "schema-key",
      module: "AudioEditor",
      parent: "schema:IOPItemOpEnvClass",
      label: "d",
      paths: [{ path: "file-format", status: "candidate" }],
    }),
  ];
  // 230 other one-letter keys 'd': more than find's 200-row page.
  for (let i = 0; i < 230; i++) {
    const cls = `NoiseClass${String(i).padStart(3, "0")}`;
    out.push(
      row(`schema:${cls}`, { dim: "schema", kind: "schema-class", module: "AnimEditor", label: cls }),
      row(`schema:${cls}.d`, {
        dim: "schema",
        kind: "schema-key",
        module: "AnimEditor",
        parent: `schema:${cls}`,
        label: "d",
      }),
    );
  }
  for (const [h, module] of [
    ["OverrideMeshObjectMaterial", "Shared"],
    ["BakeInfo", "none"],
    ["OpenXOB", "ResourceManager"],
  ] as const) {
    out.push(
      row(`net:handler/${h}`, { dim: "net", kind: "net-handler", module, label: h }),
      row(`net:handler/${h}#resp:Output`, {
        dim: "net",
        kind: "net-field",
        module,
        parent: `net:handler/${h}`,
        label: "Output",
        class_name: `${h}Response`,
        paths: [{ path: "builtin-net-handler", status: "candidate" }],
      }),
    );
  }
  for (const [cls, kind] of [
    ["ResourceManagerPlugin", "event"],
    ["ResourceImportPlugin", "method"],
    ["TerrainImportPlugin", "method"],
  ] as const) {
    out.push(
      row(`api:${cls}`, { dim: "api", kind: "class", module: "ResourceManager", label: cls }),
      row(`api:${cls}.OnRegisterResource/2`, {
        dim: "api",
        kind,
        module: "ResourceManager",
        parent: `api:${cls}`,
        label: "OnRegisterResource",
        paths: [{ path: "net-api-handler", status: "candidate" }],
      }),
    );
  }
  out.push(
    row("mcp:tool/wb_localization", {
      dim: "mcp",
      kind: "mcp-tool",
      module: "LocalizationEditor",
      label: "wb_localization",
      paths: [{ path: "none-known", status: "candidate" }],
    }),
    row("mcp:action/wb_localization.insert", {
      dim: "mcp",
      kind: "mcp-action",
      module: "LocalizationEditor",
      parent: "mcp:tool/wb_localization",
      label: "wb_localization.insert",
      paths: [{ path: "net-api-handler", status: "verified" }],
    }),
  );
  return out;
}

describe("cold test 2026-11-14: questions name the owner, howto and describe find it", () => {
  const l = ledgerOf(coldRows());
  const res = makeResolver(l);
  const q = (id: string) => buildQuestion(l, res, l.byId.get(id) as Row, { howto: true });
  const none = new Map<string, string[]>();
  const D = "schema:IOPItemOpEnvClass.d";
  const OUT = "net:handler/OverrideMeshObjectMaterial#resp:Output";
  const EV = "api:ResourceManagerPlugin.OnRegisterResource/2";

  it("names the owner of a one-letter key, of a field several handlers share, of an event several classes share", () => {
    expect(q(D)?.text).toBe(
      "How do I read or change the schema key 'd' of the schema class 'IOPItemOpEnvClass' in the Audio Editor?",
    );
    expect(q(OUT)?.text).toBe(
      "How do I read or change the network field 'Output' of the network handler 'OverrideMeshObjectMaterial' in the shared editor code?",
    );
    // The other rows are methods, not events: the name is shared in the dimension all the same.
    expect(q(EV)?.text).toBe(
      "How do I use the script event 'OnRegisterResource' of the script class 'ResourceManagerPlugin' in the Resource Manager?",
    );
    // A unique name with no owner keeps the plain wording.
    expect(q("mcp:tool/wb_localization")?.text).toBe(
      "How do I reach the MCP tool 'wb_localization' in the Localization Editor?",
    );
  });

  it("howto answers each owner-qualified question with the row, and the key's answer stated", () => {
    for (const id of [D, OUT, EV, "mcp:tool/wb_localization", "mcp:action/wb_localization.insert"]) {
      const built = q(id) as { text: string };
      const text = howto(l, [], built.text, { registered: none }).text;
      const e = expectedFor(l.byId.get(id) as Row, EMPTY_KEY_DATA);
      expect(answerPasses(text, id, e), `${built.text}\n${text}`).toBe(true);
    }
  });

  it("finds the row from shorter owner-qualified wordings, in howto and describe", () => {
    for (const [wording, id] of [
      ["the key 'd' of IOPItemOpEnvClass", D],
      ["IOPItemOpEnvClass.d", D],
      ["how do I change the key 'd' of the schema class 'IOPItemOpEnvClass'", D],
      ["the field 'Output' of 'OverrideMeshObjectMaterial'", OUT],
      ["Output of OverrideMeshObjectMaterial", OUT],
      ["OnRegisterResource of ResourceManagerPlugin", EV],
      ["ResourceManagerPlugin.OnRegisterResource", EV],
    ] as const) {
      expect(howto(l, [], wording, { registered: none }).id, wording).toBe(id);
      const d = describeRow(l, [], wording, { wording: true });
      expect(d.row?.id, wording).toBe(id);
      expect(d.wording).toBe(wording);
    }
    // Without the option, describe still takes ids and aliases only.
    expect(describeRow(l, [], "IOPItemOpEnvClass.d").row).toBeNull();
  });

  it("keys an MCP tool row to the tool, and an MCP action row to its tool and action", () => {
    expect(expectedFor(l.byId.get("mcp:tool/wb_localization") as Row, EMPTY_KEY_DATA)).toMatchObject(
      { answer: "tool", tool: "wb_localization", action: "", tool_action: "wb_localization" },
    );
    expect(
      expectedFor(l.byId.get("mcp:action/wb_localization.insert") as Row, EMPTY_KEY_DATA),
    ).toMatchObject({ answer: "tool", tool_action: "wb_localization.insert" });
    const t = howto(l, [], "How do I reach the MCP tool 'wb_localization'?", { registered: none });
    expect(t.text).toContain("Use: wb_localization (this row is that MCP tool");
    expect(t.tool).toBe("wb_localization");
    const a = howto(l, [], "How do I use the MCP action 'wb_localization.insert'?", {
      registered: none,
    });
    expect(a.text).toContain("Use: wb_localization action insert");
  });

  it("lists rows that fit equally well and says it could not choose", () => {
    const h = howto(l, [], "How do I read or change the network field 'Output'?", {
      registered: none,
    });
    expect(h.text.split("\n")[0]).toBe(
      "Ambiguous: 3 rows fit equally well; howto could not choose one.",
    );
    expect(h.id).toBeUndefined();
    expect(h.ambiguous).toEqual({
      ids: [
        "net:handler/BakeInfo#resp:Output",
        "net:handler/OpenXOB#resp:Output",
        "net:handler/OverrideMeshObjectMaterial#resp:Output",
      ],
      count: 3,
    });
    for (const id of h.ambiguous!.ids) expect(h.text).toContain(`- ${id} `);
    // An answer that does not choose never passes the key.
    expect(answerPasses(h.text, OUT, { answer: "no-tool", basis: "" })).toBe(false);
    const d = describeRow(l, [], "Output", { wording: true });
    expect(d.row).toBeNull();
    expect(d.tiedCount).toBe(3);
    // The module alone settles it when it is the only one with that name there.
    expect(
      howto(l, [], "How do I read or change the network field 'Output' in the Resource Manager?", {
        registered: none,
      }).id,
    ).toBe("net:handler/OpenXOB#resp:Output");
  });

  it("every sampled question is unambiguous against the ledger by construction", () => {
    const lg = ledgerOf([...syntheticRows(), ...coldRows()]);
    assertUnambiguous(lg, [1, 2, 3, 4, 5], 120);
  });
});

/**
 * For each sampled question: the spec that produced it is satisfied by its row alone, ledger-wide;
 * and when another row of the dimension answers to the name (or the name is under three
 * characters) the question states the owner.
 */
function assertUnambiguous(lg: LoadedLedger, seeds: number[], count: number): void {
  const res = makeResolver(lg);
  for (const seed of seeds) {
    for (const mode of ["howto", "locate"] as const) {
      checkQuestions(lg, res, sampleQuestions(lg, { seed, count, mode }).questions, mode);
    }
  }
}

function checkQuestions(
  lg: LoadedLedger,
  res: ReturnType<typeof makeResolver>,
  questions: { id: string; text: string }[],
  mode: "howto" | "locate",
): void {
  for (const qq of questions) {
    const r = lg.byId.get(qq.id) as Row;
    const built = buildQuestion(lg, res, r, { howto: mode === "howto", skipFind: true });
    expect(built?.text, qq.id).toBe(qq.text);
    const spec = built!.spec;
    expect(res.satisfiers(spec).map((x) => x.id), qq.text).toEqual([qq.id]);
    const facts = factsFor(lg, r);
    if (needsOwner(res, r, spec.name, facts)) expect(spec.facts[0], qq.text).toEqual(facts[0]);
  }
}

// ── CLI ───────────────────────────────────────────────────────────────────────

function censusWith(rows: Row[]): { root: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "sample-q-"));
  const root = join(dir, "data", "census");
  mkdirSync(root, { recursive: true });
  const sorted = [...rows].sort((a, b) => (a.id < b.id ? -1 : 1));
  writeFileSync(join(root, "ledger.jsonl"), toJsonl(sorted, ROW_FIELD_ORDER));
  writeFileSync(
    join(root, "ledger.meta.json"),
    JSON.stringify({ build: { tag: "1.0.0.1", branch: "stable", ui_language: "en" } }) + "\n",
  );
  return { root, dir };
}

describe("sample-questions CLI", () => {
  const { root, dir } = censusWith(syntheticRows());

  function go(args: string[]): { code: number; stdout: string; stderr: string } {
    const io = memoryIo();
    const code = runSampler([...args, "--data", root], io);
    return { code, stdout: io.stdout(), stderr: io.stderr() };
  }

  it("requires --seed, and an integer one", () => {
    expect(go([]).code).toBe(2);
    expect(go([]).stderr).toContain("--seed is required");
    expect(go(["--seed", "abc"]).code).toBe(2);
    expect(go(["--seed", "1.5"]).code).toBe(2);
    expect(go(["--seed", "1", "--count", "0"]).code).toBe(2);
    expect(go(["--seed", "1", "--bogus"]).code).toBe(2);
  });

  it("prints numbered questions and no id or dimension", () => {
    const r = go(["--seed", "3"]);
    expect(r.code).toBe(0);
    const lines = r.stdout.trim().split("\n");
    expect(lines).toHaveLength(31);
    expect(lines[1]).toMatch(/^1\. Which row describes /);
    expect(lines[30]).toMatch(/^30\. /);
    const ledger = ledgerOf(syntheticRows());
    for (const x of ledger.rows) expect(r.stdout).not.toContain(x.id);
  });

  it("honours --count and prints one JSON document with --json", () => {
    const r = go(["--seed", "3", "--count", "12", "--json"]);
    expect(r.code).toBe(0);
    const doc = JSON.parse(r.stdout);
    expect(doc.seed).toBe(3);
    expect(doc.questions).toHaveLength(12);
    expect(Object.keys(doc.questions[0]).sort()).toEqual(["n", "text"]);
    expect(Object.values(doc.summary.spread).reduce((s: number, n) => s + (n as number), 0)).toBe(
      12,
    );
    expect(r.stdout).not.toContain('"id"');
  });

  it("writes the answer key to the file named by --answers, matching the questions", () => {
    const file = join(dir, "out", "key.json");
    const r = go(["--seed", "3", "--answers", file, "--json"]);
    expect(r.code).toBe(0);
    const key = JSON.parse(readFileSync(file, "utf-8"));
    const doc = JSON.parse(r.stdout);
    expect(key.seed).toBe(3);
    expect(key.answers).toHaveLength(30);
    key.answers.forEach(
      (a: { n: number; id: string; paths: unknown[]; question: string }, i: number) => {
        expect(a.n).toBe(i + 1);
        expect(a.question).toBe(doc.questions[i].text);
        expect(a.paths).toEqual([{ path: "gui-automation", status: "candidate" }]);
        expect(ledgerOf(syntheticRows()).byId.has(a.id)).toBe(true);
      },
    );
    // the same seed writes the same bytes
    const again = join(dir, "out", "key2.json");
    go(["--seed", "3", "--answers", again]);
    expect(readFileSync(again, "utf-8")).toBe(readFileSync(file, "utf-8"));
  });

  it("refuses an answer file inside the census root", () => {
    const r = go(["--seed", "3", "--answers", join(root, "key.json")]);
    expect(r.code).toBe(2);
    expect(existsSync(join(root, "key.json"))).toBe(false);
  });

  it("exits 2 with no ledger and 1 when fewer questions could be drawn", () => {
    const empty = mkdtempSync(join(tmpdir(), "sample-q-empty-"));
    const io = memoryIo();
    expect(runSampler(["--seed", "1", "--data", empty], io)).toBe(2);
    const small = censusWith(syntheticRows().slice(0, 5));
    const io2 = memoryIo();
    expect(runSampler(["--seed", "1", "--data", small.root], io2)).toBe(1);
    expect(io2.stderr()).toContain("only 5 of 30");
  });
});

// ── The real ledger ───────────────────────────────────────────────────────────

const HAS_LEDGER = existsSync(join(REAL_CENSUS, "ledger.jsonl"));

/** Loaded once, on first use, so a checkout without the ledger never reads it. */
let realCache: { ledger: LoadedLedger; sample: ReturnType<typeof sampleQuestions> } | undefined;
function real(): { ledger: LoadedLedger; sample: ReturnType<typeof sampleQuestions> } {
  if (!realCache) {
    const ledger = loadLedger(censusPaths(REAL_CENSUS));
    realCache = { ledger, sample: sampleQuestions(ledger, { seed: 1 }) };
  }
  return realCache;
}

describe.skipIf(!HAS_LEDGER)("real ledger", () => {
  it("emits 30 questions for seed 1 and the key resolves to existing rows", () => {
    const { ledger, sample } = real();
    expect(sample.questions).toHaveLength(30);
    expect(new Set(ids(sample)).size).toBe(30);
    for (const q of sample.questions) {
      const r = ledger.byId.get(q.id);
      expect(r).toBeDefined();
      expect(q.paths).toEqual(
        (r as Row).paths.map((p) => ({
          path: p.path,
          status: p.status,
          ...(p.reason ? { reason: p.reason } : {}),
        })),
      );
      expect(q.text.includes(q.id)).toBe(false);
    }
  }, 120_000);

  it("draws only measured, non-aggregate rows and gives every dimension two questions", () => {
    const { ledger, sample } = real();
    for (const q of sample.questions) {
      const r = ledger.byId.get(q.id) as Row;
      expect(r.provisional).toBe(false);
      expect(r.aggregate).toBe(false);
      expect(r.sources.some((s) => s.enumerator !== "E01")).toBe(true);
    }
    for (const d of DIMS) {
      if (sample.summary.eligible[d] >= 2)
        expect(sample.summary.spread[d]).toBeGreaterThanOrEqual(2);
    }
    expect(MODULES.length).toBeGreaterThan(0);
  }, 120_000);

  it("is findable: a find on the name with the question's own filters lists the expected row", () => {
    const { ledger, sample } = real();
    for (const q of sample.questions) {
      const r = ledger.byId.get(q.id) as Row;
      const name = /'([^']+)'/.exec(q.text)?.[1] as string;
      const res = find(ledger, name, { kind: r.kind }, 1, 200);
      expect(res.rows.map((x) => x.id)).toContain(q.id);
    }
  }, 120_000);

  it("names the row's kind and name, and no other row of that kind and module carries a name the question states alone", () => {
    const { ledger, sample } = real();
    for (const q of sample.questions) {
      if (/ (under|of|within) the | whose class is | in the settings section /.test(q.text))
        continue;
      const r = ledger.byId.get(q.id) as Row;
      if (isUnnamed(r)) continue;
      const name = (/'([^']+)'/.exec(q.text)?.[1] as string).toLowerCase();
      const same = ledger.rows.filter(
        (x) =>
          x.kind === r.kind &&
          x.module === r.module &&
          [x.label, x.object_name, x.class_name].some(
            (v) => v && normalizeLabel(v).toLowerCase() === name,
          ),
      );
      expect(same.map((x) => x.id)).toContain(q.id);
      expect(same).toHaveLength(1);
    }
  }, 120_000);

  it("words every sampled question so that only its row fits, owner named where the name is shared", () => {
    const { ledger, sample } = real();
    checkQuestions(ledger, makeResolver(ledger), sample.questions, "locate");
  }, 120_000);

  it("is deterministic for a seed over the real ledger", () => {
    const { ledger, sample } = real();
    expect(sampleQuestions(ledger, { seed: 1 })).toEqual(sample);
    expect(ids(sampleQuestions(ledger, { seed: 2 }))).not.toEqual(ids(sample));
  }, 120_000);
});

// ── howto mode ────────────────────────────────────────────────────────────────

describe("sampleQuestions: howto mode", () => {
  const ledger = ledgerOf(syntheticRows());
  const none = new Map<string, string[]>();

  it("asks 'How do I ...' with no id and no tool name, and is deterministic for a seed", () => {
    const a = sampleQuestions(ledger, { seed: 5, mode: "howto" });
    const b = sampleQuestions(ledger, { seed: 5, mode: "howto" });
    expect(a).toEqual(b);
    expect(a.questions).toHaveLength(30);
    for (const q of a.questions) {
      expect(q.text).toMatch(/^How do I (use|reach|read or change) the /);
      expect(q.text).not.toContain("Which row");
      expect(q.text.includes(q.id)).toBe(false);
      expect(q.text).not.toMatch(/wb_[a-z]+/);
    }
    expect(ids(sampleQuestions(ledger, { seed: 6, mode: "howto" }))).not.toEqual(ids(a));
  });

  it("leaves the default mode as it was", () => {
    const loc = sampleQuestions(ledger, { seed: 5 });
    expect(sampleQuestions(ledger, { seed: 5, mode: "locate" })).toEqual(loc);
    expect(loc.questions.every((q) => q.text.startsWith("Which row describes"))).toBe(true);
    expect(loc.questions.every((q) => q.expected === undefined)).toBe(true);
  });

  it("keys a row with an mcp link to that tool.action, and a path with no locator to 'not drivable'", () => {
    const rows = syntheticRows(2).map((r, i) =>
      i % 3 === 0
        ? ({ ...r, mcp: [{ action: "mcp:action/wb_view.cursor", role: "drive" }] } as Row)
        : r,
    );
    const lg = ledgerOf(rows);
    const s = sampleQuestions(lg, { seed: 2, mode: "howto" });
    expect(s.questions.length).toBeGreaterThan(0);
    for (const q of s.questions) {
      const r = lg.byId.get(q.id) as Row;
      if (r.mcp.length > 0) {
        expect(q.expected).toMatchObject({ answer: "tool", tool_action: "wb_view.cursor" });
      } else if (r.dim === "setting" && r.kind === "setting-key") {
        expect(q.expected).toMatchObject({ answer: "tool", tool_action: "wb_settings.get" });
      } else if (r.kind === "diag-menu") {
        expect(q.expected).toMatchObject({ answer: "tool", tool_action: "wb_diag.select" });
      } else expect(q.expected?.answer, r.id).toBe("not-drivable");
      expect(JSON.stringify(q.expected)).not.toContain("wb_gui");
    }
  });

  it("draws a row no tool reaches, keyed 'no tool reaches this row'", () => {
    const rows = syntheticRows(2).map((r) =>
      r.dim === "api"
        ? ({ ...r, paths: [{ path: "net-api-handler", status: "candidate" }] } as Row)
        : r,
    );
    const lg = ledgerOf(rows);
    const s = sampleQuestions(lg, { seed: 4, mode: "howto" });
    const api = s.questions.filter((q) => q.dim === "api");
    expect(api.length).toBeGreaterThan(0);
    for (const q of api) expect(q.expected).toMatchObject({ answer: "no-tool" });
    expect(s.summary.eligible.api).toBeGreaterThan(0);
  });

  it("builds the key from the census files, not from howto: diag catalog, settings, locators, gates", () => {
    const base = (id: string, extra: Partial<Row>) => row(id, extra);
    const k: KeyData = {
      ...EMPTY_KEY_DATA,
      locators: new Set(["ui:panel/Located", "ui:panel/Enabled"]),
      guiInvoke: true,
      guiRows: new Set(["ui:panel/Enabled"]),
      diagKinds: new Map([
        ["ai/debug", "bool"],
        ["ai", "menu"],
        ["render/rain", "range"],
      ]),
    };
    const e = (r: Row) => expectedFor(r, k);
    expect(e(base("diag:AI/Debug", { dim: "diag", kind: "diag-option" }))).toMatchObject({
      tool_action: "wb_diag.get",
    });
    expect(e(base("diag:AI", { dim: "diag", kind: "diag-menu" }))).toMatchObject({
      tool_action: "wb_diag.select",
    });
    expect(e(base("diag:Render/Rain", { dim: "diag", kind: "diag-option" })).answer).toBe(
      "not-drivable",
    );
    // An uncatalogued diag option falls back to its gui path: no locator, not drivable.
    expect(e(base("diag:X/Y", { dim: "diag", kind: "diag-option" })).answer).toBe("not-drivable");
    expect(e(base("setting:a/b", { dim: "setting", kind: "setting-key" }))).toMatchObject({
      tool_action: "wb_settings.get",
    });
    expect(e(base("setting:o", { dim: "setting", kind: "option" })).answer).toBe("not-drivable");
    expect(e(base("ui:panel/Located", { kind: "panel" })).answer).toBe("not-drivable");
    expect(e(base("ui:panel/Enabled", { kind: "panel" }))).toMatchObject({
      tool_action: "wb_gui.invoke",
    });
    expect(e(base("ui:panel/Plain", { kind: "panel" }))).toMatchObject({
      answer: "not-drivable",
      basis: "no locator on this build",
    });
    expect(e(base("api:x", { kind: "method", paths: [] })).answer).toBe("no-tool");
  });

  it("is answered by howto: the row first, and the key's answer stated", () => {
    const s = sampleQuestions(ledger, { seed: 9, mode: "howto" });
    for (const q of s.questions) {
      const text = howto(ledger, [], q.text, { registered: none }).text;
      expect(answerPasses(text, q.id, q.expected!), `${q.text}\n${text}`).toBe(true);
    }
  });
});

describe("sample-questions CLI: --kind howto", () => {
  const { root, dir } = censusWith(syntheticRows());
  function go(args: string[]): { code: number; stdout: string; stderr: string } {
    const io = memoryIo();
    const code = runSampler([...args, "--data", root], io);
    return { code, stdout: io.stdout(), stderr: io.stderr() };
  }

  it("rejects an unknown kind", () => {
    const r = go(["--seed", "1", "--kind", "bogus"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("--kind takes locate or howto");
  });

  it("prints howto questions and writes the expected row and tool.action to the key", () => {
    const file = join(dir, "out", "howto-key.json");
    const r = go(["--seed", "3", "--kind", "howto", "--answers", file, "--json"]);
    expect(r.code).toBe(0);
    const doc = JSON.parse(r.stdout);
    const key = JSON.parse(readFileSync(file, "utf-8"));
    expect(key.kind).toBe("howto");
    expect(key.answers).toHaveLength(30);
    key.answers.forEach(
      (a: { n: number; id: string; question: string; expected: { answer: string } }, i: number) => {
        expect(a.question).toBe(doc.questions[i].text);
        expect(a.question.startsWith("How do I ")).toBe(true);
        expect(["tool", "not-drivable", "no-tool"]).toContain(a.expected.answer);
        expect(ledgerOf(syntheticRows()).byId.has(a.id)).toBe(true);
      },
    );
    expect(JSON.stringify(doc)).not.toContain("wb_gui");
    const again = join(dir, "out", "howto-key2.json");
    go(["--seed", "3", "--kind", "howto", "--answers", again]);
    expect(readFileSync(again, "utf-8")).toBe(readFileSync(file, "utf-8"));
  });

  it("leaves the key of the default mode without expected or kind", () => {
    const file = join(dir, "out", "locate-key.json");
    go(["--seed", "3", "--answers", file]);
    const key = JSON.parse(readFileSync(file, "utf-8"));
    expect(key.kind).toBeUndefined();
    expect(key.answers[0].expected).toBeUndefined();
  });
});

describe.skipIf(!HAS_LEDGER)("real ledger: howto rehearsal", () => {
  it("agrees with howto on every row, and answers at least 27 of 30 sampled questions", () => {
    const { ledger } = real();
    const reach = loadReach(REAL_CENSUS);
    const keyData = loadKeyData(REAL_CENSUS);
    // The key is built independently; over the whole ledger it must name what howto names.
    let disagree = 0;
    for (const r of ledger.rows) {
      const ex = expectedFor(r, keyData);
      const t = toolActionFor(r, reach);
      const h = !t
        ? "no-tool"
        : t.drivable === false
          ? "not-drivable"
          : `${t.tool}.${t.action ?? ""}`;
      const k = ex.answer === "tool" ? `${ex.tool}.${ex.action}` : ex.answer;
      if (h !== k) disagree++;
    }
    expect(disagree).toBe(0);
    const s = sampleQuestions(ledger, { seed: 1, count: 30, mode: "howto", keyData });
    expect(s.questions).toHaveLength(30);
    let pass = 0;
    for (const q of s.questions) {
      const text = howto(ledger, [], q.text, { reach }).text;
      if (answerPasses(text, q.id, q.expected!)) pass++;
    }
    expect(pass).toBeGreaterThanOrEqual(27);
  }, 240_000);
});
