/** scripts/audit/deny-list-regen.ts: label evidence, :confirm matching and candidates on a synthetic ledger. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  looseKey,
  mergeRows,
  parseUiRows,
  regen,
  run,
  walkEnumerator,
  walkFiles,
  walkRows,
} from "../../scripts/audit/deny-list-regen.js";

const L = [{ enumerator: "L04", build: "1.0" }];
const S = [{ enumerator: "E05", build: "1.0" }];
const ledger = [
  { id: "ui:WE/menu-item/New World", dim: "ui", kind: "menu-item", label: "New World", sources: L },
  {
    id: "ui:WE/menu-item/Save World As",
    dim: "ui",
    kind: "menu-item",
    label: "Save World &As...",
    sources: L,
  },
  { id: "ui:WE/dialog/cw", dim: "ui", kind: "dialog", label: "Create world", sources: S },
  {
    id: "ui:WE/control/cw/OK",
    dim: "ui",
    kind: "control",
    parent: "ui:WE/dialog/cw",
    label: "OK",
    sources: L,
  },
  {
    id: "ui:WE/menu-item/Pack Project",
    dim: "ui",
    kind: "menu-item",
    label: "Pack Project",
    sources: S,
  },
  {
    id: "ui:RM/menu-item/Wipe",
    dim: "ui",
    kind: "menu-item",
    label: "Wipe Cache",
    risk: "destructive",
    sources: L,
  },
  {
    id: "ui:RM/menu-item/Log out",
    dim: "ui",
    kind: "menu-item",
    label: "Log out",
    risk: "read",
    sources: L,
  },
  {
    id: "ui:RM/menu-item/Static",
    dim: "ui",
    kind: "menu-item",
    label: "Delete All",
    risk: "destructive",
    sources: S,
  },
].map((r) => JSON.stringify(r));
ledger.push("not json", JSON.stringify({ id: "api:x", dim: "api", label: "x" }));

const policy = {
  risk_overrides: { destructive: {} },
  deny_lists: {
    a: {
      labels: [
        "New World",
        "Save World As",
        "Create World:confirm",
        "Pack Project:confirm",
        "Gone",
      ],
    },
  },
};

describe("deny-list-regen", () => {
  const rows = parseUiRows(ledger);
  const report = regen(policy, rows);
  const by = (label: string) => report.labels.find((l) => l.label === label)!;

  it("reads only labelled ui rows", () => {
    expect(rows.length).toBe(8);
    expect(report.ledgerUiRows).toBe(8);
  });

  it("keys labels ignoring case, ampersands, a trailing ellipsis and spacing", () => {
    expect(looseKey("Save World &As...")).toBe("save world as");
    expect(looseKey("  Create   world ")).toBe("create world");
  });

  it("marks a plain label live on an exact or a loose live row", () => {
    expect(by("New World").verdict).toBe("live");
    expect(by("Save World As").verdict).toBe("live");
    expect(by("Save World As").exact).toEqual([]);
    expect(by("Save World As").loose.map((r) => r.id)).toEqual(["ui:WE/menu-item/Save World As"]);
    expect(by("Gone").verdict).toBe("no-row");
  });

  it("backs X:confirm with the confirm control of dialog X, not with the opener", () => {
    expect(by("Create World:confirm").verdict).toBe("live");
    expect(by("Create World:confirm").confirmControls.map((r) => r.id)).toEqual([
      "ui:WE/control/cw/OK",
    ]);
    expect(by("Pack Project:confirm").verdict).toBe("static-only");
    expect(by("Pack Project:confirm").dialogs).toEqual([]);
  });

  it("proposes live, uncovered rows by risk class or label pattern, never static ones", () => {
    expect(report.candidates.map((c) => c.label)).toEqual(["Log out", "Wipe Cache"]);
    expect(report.candidates.find((c) => c.label === "Wipe Cache")!.why).toBe(
      "ledger risk destructive",
    );
  });

  it("refuses unknown flags, --md with --json, and --build without --walks", () => {
    const err: string[] = [];
    const io = { out: () => {}, err: (s: string) => err.push(s) };
    expect(run(["--bogus"], io)).toBe(2);
    expect(run(["--md", "--json"], io)).toBe(2);
    expect(run(["--build", "1.9.0.37"], io)).toBe(2);
    expect(err.length).toBe(3);
  });
});

// W12 run 1: the L02 walker's raw obs lines, read before (or without) normalise.ts.
describe("deny-list-regen --walks", () => {
  const TMP = mkdtempSync(join(tmpdir(), "emcp-denyregen-"));
  afterAll(() => rmSync(TMP, { recursive: true, force: true }));
  const menu = (module: string, path: string[], label: string, kind = "menu-item"): string =>
    JSON.stringify({
      dim: "ui",
      kind,
      module,
      key: { path },
      label,
      label_raw: label,
      parent_key: path.length > 1 ? { dim: "ui", kind: "menu", module, key: { path: path.slice(0, -1) } } : null,
    });
  const obs = [
    menu("WorldEditor", ["File"], "File", "menu"),
    menu("WorldEditor", ["File", "New World"], "New World"),
    menu("WorldEditor", ["Tools", "Bake MLOD Texture"], "Bake MLOD Texture"),
    JSON.stringify({ dim: "ui", kind: "window", module: "WorldEditor", key: { object_name: "worldEditorMain" } }),
    "not json",
  ];

  it("names the enumerator from the obs file name, and lists obs files under a folder", () => {
    expect(walkEnumerator("x/L02-WorldEditor-edit-none.obs.jsonl")).toBe("L02");
    expect(walkEnumerator("x/p4-l02-file.json")).toBeNull();
    const dir = join(TMP, "walks", "w12-10-we-menus-L02-WorldEditor");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "L02-WorldEditor-edit-none.obs.jsonl"), obs.join("\n"));
    writeFileSync(join(dir, "p4-l02-worldeditor-file-edit-none.json"), "{}");
    expect(walkFiles([join(TMP, "walks")]).map((f) => f.replace(/\\/g, "/").split("/").pop())).toEqual([
      "L02-WorldEditor-edit-none.obs.jsonl",
    ]);
  });

  it("turns labelled ui lines into rows with the normaliser's id, parent and one source", () => {
    const rows = walkRows(obs, "L02", "1.9.0.37");
    expect(rows.map((r) => r.id)).toEqual([
      "ui:WorldEditor/menu/File",
      "ui:WorldEditor/menu-item/File/New World",
      "ui:WorldEditor/menu-item/Tools/Bake MLOD Texture",
    ]);
    expect(rows[1]).toMatchObject({
      parent: "ui:WorldEditor/menu/File",
      label: "New World",
      sources: [{ enumerator: "L02", build: "1.9.0.37" }],
    });
  });

  it("merges a walk row on an existing id as a source only, and adds a new id", () => {
    const ledgerRows = [
      { id: "ui:WorldEditor/menu-item/File/New World", dim: "ui", kind: "menu-item", label: "New World", risk: "mutating", sources: [{ enumerator: "E01", build: "1.9.0.37" }] },
    ];
    const m = mergeRows(ledgerRows, walkRows(obs, "L02", "1.9.0.37"));
    expect(m.merged).toBe(1);
    expect(m.added).toBe(2);
    const nw = m.rows.find((r) => r.id === "ui:WorldEditor/menu-item/File/New World")!;
    expect(nw.risk).toBe("mutating");
    expect(nw.sources).toEqual([
      { enumerator: "E01", build: "1.9.0.37" },
      { enumerator: "L02", build: "1.9.0.37" },
    ]);
    expect(ledgerRows[0]!.sources).toHaveLength(1);
    const r = regen({ deny_lists: { a: { labels: ["New World"] } } }, m.rows);
    expect(r.labels[0]!.verdict).toBe("live");
    expect(r.candidates.map((c) => c.label)).toEqual(["Bake MLOD Texture"]);
  });

  it("run --walks reads the folder into the report and says it is not ingested", () => {
    const root = join(TMP, "repo");
    mkdirSync(join(root, "data", "census"), { recursive: true });
    writeFileSync(join(root, "data", "census", "policy.json"), JSON.stringify({ deny_lists: { a: { labels: ["New World"] } } }));
    const out: string[] = [];
    const io = { out: (s: string) => out.push(s), err: (s: string) => out.push(s) };
    expect(run(["--walks", join(TMP, "walks"), "--build", "1.9.0.37"], io, root)).toBe(0);
    expect(out[0]).toMatch(/^walks: 1 obs file\(s\), 3 labelled ui line\(s\) at 1\.9\.0\.37: 0 on existing rows, 3 new id\(s\) \(not ingested\)/);
    expect(out[0]).toMatch(/live +a :: New World/);
    out.length = 0;
    expect(run(["--walks", join(TMP, "nope")], io, root)).toBe(2);
    expect(out[0]).toMatch(/no such walk file or folder/);
  });
});
