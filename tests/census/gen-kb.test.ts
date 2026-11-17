import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toJsonl } from "../../src/census/canon.js";
import { loadLedger } from "../../src/census/ledger-io.js";
import { ROW_FIELD_ORDER, type Row } from "../../src/census/schemas.js";
import {
  checkHandPages,
  extractCitations,
  generatePages,
  listedItems,
  run as runGenKb,
} from "../../scripts/census/gen-kb.js";
import { memoryIo } from "../../scripts/census/cli-common.js";
import { makeCensus, type Fixture } from "./helpers.js";

function row(id: string, kind: string, extra: Record<string, unknown> = {}): Row {
  return {
    id,
    shard: "core",
    dim: "mcp",
    kind,
    module: "none",
    parent: null,
    label: id,
    what: `desc of ${id}`,
    risk_confirmed: false,
    origin: "vanilla",
    aggregate: false,
    provisional: false,
    sources: [{ enumerator: "E11", build: "1.0.0.1", ref: "ev:EV-s1-001", confidence: "high" }],
    build: { first_seen: "1.0.0.1", last_seen: "1.0.0.1" },
    children_enumerated: "n/a",
    observed_states: [],
    status: "active",
    paths: [],
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

function ledgerWithTool(): Fixture {
  const fx = makeCensus();
  const rows = [
    row("mcp:tool/demo_tool", "mcp-tool"),
    row("mcp:action/demo_tool.run", "mcp-action", { risk: "safe", parent: "mcp:tool/demo_tool" }),
    row("ui:WorldEditor/menu/File", "menu", {
      dim: "ui",
      module: "WorldEditor",
      mcp: [{ action: "mcp:action/demo_tool.run", role: "drive" }],
    }),
  ].sort((a, b) => (a.id < b.id ? -1 : 1));
  writeFileSync(join(fx.root, "ledger.jsonl"), toJsonl(rows, ROW_FIELD_ORDER));
  writeFileSync(
    join(fx.root, "ledger.meta.json"),
    JSON.stringify({ build: { tag: "1.0.0.1", branch: "stable", ui_language: "en" } }) + "\n",
  );
  return fx;
}

describe("gen-kb", () => {
  it("builds module, tool and index pages deterministically", () => {
    const fx = ledgerWithTool();
    const a = generatePages(loadLedger(fx.paths));
    const b = generatePages(loadLedger(fx.paths));
    expect([...a.keys()].sort()).toEqual([
      "index.md",
      "modules/WorldEditor.md",
      "modules/none/mcp-action.md",
      "modules/none/mcp-tool.md",
      "tools/demo_tool.md",
    ]);
    expect([...a.entries()]).toEqual([...b.entries()]);
    expect(a.get("tools/demo_tool.md")).toContain("| run | safe |");
    expect(a.get("tools/demo_tool.md")).toContain("ui:WorldEditor/menu/File (run drive)");
    expect(a.get("modules/WorldEditor.md")).toContain("# Census: WorldEditor");
    for (const t of a.values()) expect(t).not.toContain("\r");
  });

  it("gives rows no module claims one page per kind and an index entry", () => {
    const a = generatePages(loadLedger(ledgerWithTool().paths));
    const page = a.get("modules/none/mcp-action.md") as string;
    expect(page.split("\n")[0]).toBe("# Census: no module, kind mcp-action");
    expect(page).toContain("mcp:action/demo_tool.run");
    expect(page).not.toContain("](../tools/");
    expect(a.get("index.md")).toContain(
      "- none (rows no module claims): 2 rows, one page per kind: [mcp-action](modules/none/mcp-action.md) 1, [mcp-tool](modules/none/mcp-tool.md) 1",
    );
  });

  it("adds a Known defects section to a tool page named by a defect", () => {
    const fx = ledgerWithTool();
    const pages = generatePages(loadLedger(fx.paths), [
      {
        id: "KD-001",
        title: "Tools pass -wbProjectPath, which is not a Workbench parameter",
        where: "src/tools/demo-tool.ts",
        switch: "-wbProjectPath",
      },
    ]);
    const page = pages.get("tools/demo_tool.md") as string;
    expect(page).toContain("## Known defects");
    expect(page).toContain("- KD-001:");
    expect(page).toContain("`-wbProjectPath` is not a Workbench parameter; do not pass it.");
    expect(generatePages(loadLedger(fx.paths)).get("tools/demo_tool.md")).not.toContain(
      "Known defects",
    );
  });

  it("writes, then --check passes; an edit or a stale file fails it", () => {
    const fx = ledgerWithTool();
    const out = join(mkdtempSync(join(tmpdir(), "kb-")), "census");
    mkdirSync(out, { recursive: true });
    expect(runGenKb(["--data", fx.root, "--out", out], memoryIo())).toBe(0);
    expect(runGenKb(["--data", fx.root, "--out", out, "--check"], memoryIo())).toBe(0);
    writeFileSync(join(out, "index.md"), readFileSync(join(out, "index.md"), "utf8") + "x\n");
    const bad = memoryIo();
    expect(runGenKb(["--data", fx.root, "--out", out, "--check"], bad)).toBe(1);
    expect(bad.stderr()).toContain("differs: index.md");
    runGenKb(["--data", fx.root, "--out", out], memoryIo());
    writeFileSync(join(out, "extra.md"), "x\n");
    const stale = memoryIo();
    expect(runGenKb(["--data", fx.root, "--out", out, "--check"], stale)).toBe(1);
    expect(stale.stderr()).toContain("stale: extra.md");
  });

  it("module pages group rows by kind with tier, path and linked tool action", () => {
    const fx = ledgerWithTool();
    const page = generatePages(loadLedger(fx.paths)).get("modules/WorldEditor.md") as string;
    expect(page).toContain("## What it is");
    expect(page).toContain("Module WorldEditor: ui 1.");
    expect(page).toContain("Seen in builds 1.0.0.1 to 1.0.0.1.");
    expect(page).toContain("### menu (1)");
    expect(page).toContain(
      "| ui:WorldEditor/menu/File | T0/T5 | none | [demo_tool.run](../tools/demo_tool.md) drive |",
    );
    expect(page).toContain("## Below target (1)");
    expect(page).toContain("- T0 to T5: 1");
    expect(page).toContain("No row of this module carries a disposition.");
  });

  it("lists dispositions and the chosen path of a row", () => {
    const fx = makeCensus();
    const rows = [
      row("ui:Shared/window/A", "window", {
        dim: "ui",
        module: "Shared",
        tier: "T3",
        target_tier: "T3",
        chosen_path: "execute-action",
        disposition: {
          kind: "excluded-policy",
          why: "owner ruling",
          evidence: "EV-P4-exit-002",
        },
      }),
    ];
    writeFileSync(join(fx.root, "ledger.jsonl"), toJsonl(rows, ROW_FIELD_ORDER));
    writeFileSync(
      join(fx.root, "ledger.meta.json"),
      JSON.stringify({ build: { tag: "1.0.0.1", branch: "stable", ui_language: "en" } }) + "\n",
    );
    const page = generatePages(loadLedger(fx.paths)).get("modules/Shared.md") as string;
    expect(page).toContain("| ui:Shared/window/A | T3/T3 | execute-action | none |");
    expect(page).toContain("## Below target (0)");
    expect(page).toContain("## Dispositions (1)");
    expect(page).toContain(
      "| ui:Shared/window/A | excluded-policy | owner ruling | EV-P4-exit-002 |",
    );
  });

  it("links hand pages from the index and the matching module page", () => {
    const fx = makeCensus();
    const rows = [
      row("ui:DialogueEditor/dock/#A", "dock", { dim: "ui", module: "DialogueEditor" }),
    ];
    writeFileSync(join(fx.root, "ledger.jsonl"), toJsonl(rows, ROW_FIELD_ORDER));
    writeFileSync(
      join(fx.root, "ledger.meta.json"),
      JSON.stringify({ build: { tag: "1.0.0.1", branch: "stable", ui_language: "en" } }) + "\n",
    );
    const hand = new Map([
      ["DialogueEditor.md", "# Dialogue Editor\n\n- A dock. [row: ui:DialogueEditor/dock/#A]\n"],
    ]);
    const a = generatePages(loadLedger(fx.paths), [], hand);
    expect(a.get("index.md")).toContain("[Dialogue Editor](hand/DialogueEditor.md)");
    expect(a.get("modules/DialogueEditor.md")).toContain(
      "Hand page: [Dialogue Editor](../hand/DialogueEditor.md)",
    );
    expect(generatePages(loadLedger(fx.paths)).get("index.md")).not.toContain("Hand pages");
    expect([...a.entries()]).toEqual([...generatePages(loadLedger(fx.paths), [], hand).entries()]);
  });

  describe("hand page citations", () => {
    const ledger = () => loadLedger(ledgerWithTool().paths);
    const page = (body: string) => new Map([["X.md", `# X\n\n${body}\n`]]);

    it("passes a cited line, an [unverified] line, headings, tables rules and bare links", () => {
      const body = [
        "- Fact. [row: mcp:tool/demo_tool]",
        "- Two facts. [row: mcp:tool/demo_tool] [row: ui:WorldEditor/menu/File]",
        "- Not checked. [unverified]",
        "| --- | --- |",
        "[Module page](../modules/WorldEditor.md)",
      ].join("\n");
      expect(checkHandPages(ledger(), page(body))).toEqual([]);
    });

    it("fails a dangling id", () => {
      const problems = checkHandPages(ledger(), page("- Fact. [row: ui:Nope/missing]"));
      expect(problems).toEqual(["hand/X.md:3: dangling row id ui:Nope/missing"]);
    });

    it("fails a fact line with no citation", () => {
      const problems = checkHandPages(ledger(), page("Plain claim with no source."));
      expect(problems).toEqual([
        "hand/X.md:3: fact line without a [row: id] citation or [unverified]",
      ]);
    });

    it("fails a line whose one citation covers two sentences", () => {
      const problems = checkHandPages(
        ledger(),
        page("- First fact. Second fact. [row: mcp:tool/demo_tool]"),
      );
      expect(problems).toEqual([
        "hand/X.md:3: sentence 1 has no [row: id] citation or [unverified]",
      ]);
      expect(
        checkHandPages(
          ledger(),
          page("- First fact. [row: mcp:tool/demo_tool] Second fact. [unverified]"),
        ),
      ).toEqual([]);
    });

    it("fails a list of row facts that cites fewer rows than it lists", () => {
      const body =
        "- A, B and C are siblings. [row: mcp:tool/demo_tool] [row: ui:WorldEditor/menu/File]";
      expect(checkHandPages(ledger(), page(body))).toEqual([
        "hand/X.md:3: sentence 1 lists 3 items but cites 2 rows",
      ]);
      expect(
        listedItems("Font Viewer, Styles Editor, Ragdoll and a text or hex view are listed"),
      ).toBe(4);
      expect(listedItems("One fact about one row")).toBe(1);
    });

    it("reads an id that contains brackets", () => {
      expect(extractCitations("a [row: x[1]] b [row: y]")).toEqual(["x[1]", "y"]);
    });

    it("--check exits 1 on a dangling id and a clean tree exits 0; hand/ is never stale", () => {
      const fx = ledgerWithTool();
      const out = join(mkdtempSync(join(tmpdir(), "kb-")), "census");
      mkdirSync(join(out, "hand"), { recursive: true });
      writeFileSync(
        join(out, "hand", "WorldEditor.md"),
        "# W\n\n- ok. [row: mcp:tool/demo_tool]\n",
      );
      expect(runGenKb(["--data", fx.root, "--out", out], memoryIo())).toBe(0);
      expect(runGenKb(["--data", fx.root, "--out", out, "--check"], memoryIo())).toBe(0);
      writeFileSync(join(out, "hand", "Bad.md"), "# B\n\n- no. [row: ui:Nope/missing]\n");
      const bad = memoryIo();
      expect(runGenKb(["--data", fx.root, "--out", out, "--check"], bad)).toBe(1);
      expect(bad.stderr()).toContain("hand/Bad.md:3: dangling row id ui:Nope/missing");
      const write = memoryIo();
      expect(runGenKb(["--data", fx.root, "--out", out], write)).toBe(1);
      expect(readFileSync(join(out, "hand", "Bad.md"), "utf8")).toContain("Nope");
    });
  });

  it("exits 2 without a ledger", () => {
    const fx = makeCensus();
    expect(runGenKb(["--data", fx.root, "--out", join(fx.root, "kb")], memoryIo())).toBe(2);
  });
});
