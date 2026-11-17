import { describe, it, expect } from "vitest";
import {
  actionCount,
  buildReport,
  formatTable,
  measureTools,
  toolsetTotals,
  usageFromRows,
} from "../../scripts/measure-tool-metadata.js";
import { listChars } from "../../src/manifest/budget.js";

// wb_state is core, wb_save is an alias, terrain_inspect and audio are extended (tiers.ts).
const tools = [
  { name: "wb_state", description: "abc", inputSchema: { type: "object", properties: {} } },
  {
    name: "audio",
    description: "x".repeat(50),
    inputSchema: {
      type: "object",
      properties: { action: { type: "string", enum: ["a", "b", "c"] } },
    },
  },
  { name: "wb_save", description: "hello", inputSchema: { type: "object" } },
  { name: "terrain_inspect" },
];

const usage = usageFromRows([
  { mcp: [{ action: "mcp:action/audio.a" }, { action: "mcp:action/audio.b" }] },
  { mcp: [{ action: "mcp:action/audio.c" }, { action: "mcp:action/wb_state.read" }] },
  { mcp: [] },
  {},
]);

describe("usageFromRows", () => {
  it("counts distinct rows per tool, not links", () => {
    expect(usage.get("audio")).toBe(2);
    expect(usage.get("wb_state")).toBe(1);
    expect(usage.has("wb_save")).toBe(false);
  });
});

describe("actionCount", () => {
  it("reads properties.action.enum, else 0", () => {
    expect(actionCount(tools[1].inputSchema)).toBe(3);
    expect(actionCount({ type: "object" })).toBe(0);
    expect(actionCount(undefined)).toBe(0);
  });
});

describe("measureTools", () => {
  const m = measureTools(tools, usage);
  const by = (n: string) => m.find((x) => x.name === n)!;

  it("sums name, description and schema chars per tool", () => {
    const s = JSON.stringify(tools[0].inputSchema).length;
    expect(by("wb_state")).toMatchObject({
      nameChars: 8,
      descriptionChars: 3,
      schemaChars: s,
      totalChars: 8 + 3 + s,
      tier: "core",
      actions: 0,
      ledgerRows: 1,
    });
    expect(by("terrain_inspect")).toMatchObject({
      descriptionChars: 0,
      schemaChars: 0,
      totalChars: 15,
    });
    expect(by("audio")).toMatchObject({ actions: 3, ledgerRows: 2, tier: "extended" });
    expect(by("wb_save").tier).toBe("alias");
  });

  it("records the served JSON length of each tool", () => {
    expect(by("audio").listChars).toBe(listChars([tools[1]]));
  });

  it("sorts by total chars descending, name ascending on a tie", () => {
    const totals = m.map((x) => x.totalChars);
    expect(totals).toEqual([...totals].sort((a, b) => b - a));
    const tie = measureTools(
      [
        { name: "b_t", description: "xx" },
        { name: "a_t", description: "xx" },
      ],
      new Map(),
    );
    expect(tie.map((x) => x.name)).toEqual(["a_t", "b_t"]);
  });
});

describe("toolsetTotals", () => {
  const m = measureTools(tools, usage);
  const t = Object.fromEntries(toolsetTotals(tools, m).map((x) => [x.toolset, x]));

  it("core is the core tier only, extended drops aliases, all keeps everything", () => {
    expect(t.core.tools).toBe(1);
    expect(t.extended.tools).toBe(3);
    expect(t.all.tools).toBe(4);
  });

  it("measures list chars as budget.ts does and field sums from the per-tool rows", () => {
    expect(t.all.listChars).toBe(listChars(tools));
    expect(t.core.listChars).toBe(listChars([tools[0]]));
    expect(t.all.totalChars).toBe(m.reduce((n, x) => n + x.totalChars, 0));
    expect(t.core.totalChars).toBe(m.find((x) => x.name === "wb_state")!.totalChars);
  });
});

describe("buildReport and formatTable", () => {
  it("prints the rows in report order, then the toolset lines", () => {
    const r = buildReport(tools, usage, "fixture");
    expect(r.toolCount).toBe(4);
    const lines = formatTable(r).split("\n");
    const order = lines.slice(1, 1 + r.tools.length).map((l) => l.split(/\s+/)[0]);
    expect(order).toEqual(r.tools.map((x) => x.name));
    expect(lines.some((l) => l.startsWith("all") && l.includes("4 tools"))).toBe(true);
  });
});
