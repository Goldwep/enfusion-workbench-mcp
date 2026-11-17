import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  README_END,
  README_START,
  diffAgainstDisk,
  generateFiles,
  renderReadmeBlock,
  renderToolPage,
  runGenerate,
  type DocInput,
} from "../../scripts/gen-tool-docs.js";

const input: DocInput = {
  tools: [
    {
      name: "wb_entity",
      description: "Entities of the open world.\nRead:\nlist: Filtered, paged",
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["list", "get"] },
          limit: { type: "integer", description: "default 50 | max 200" },
        },
        required: ["action"],
      },
    },
    {
      name: "script_lint",
      description: "Search the script API. Second sentence.",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string", default: "x" } },
        required: ["query"],
      },
    },
    {
      name: "wb_reload",
      description: "Reload scripts.",
      inputSchema: { type: "object", properties: {} },
    },
  ],
  contracts: [
    {
      handler: "EMCP_WB_Entity",
      tool: "wb_entity",
      purpose: "Entities",
      actions: [
        {
          name: "list",
          summary: "Filtered, paged",
          mutating: false,
          projectOnly: false,
          params: [{ key: "limit", type: "int", required: false }],
          paging: true,
        },
        {
          name: "get",
          summary: "One entity",
          mutating: false,
          projectOnly: false,
          params: [{ key: "entity", type: "string", required: true }],
          paging: false,
        },
      ],
    },
  ],
  rows: [
    { id: "api:A.B/1", tier: "T5", mcp: [{ action: "mcp:action/wb_entity.get", role: "drive" }] },
    {
      id: "api:A.C/1",
      tier: "T2",
      mcp: [
        { action: "mcp:action/wb_entity.get", role: "drive" },
        { action: "mcp:action/wb_entity.list", role: "drive" },
        { action: "mcp:action/other_tool.list", role: "drive" },
      ],
    },
  ],
  kbTools: new Set(["wb_entity"]),
};

describe("renderToolPage", () => {
  it("renders description, tier, toolset, actions, parameters and census links", () => {
    const page = renderToolPage(input.tools[0], input);
    expect(page.startsWith("# wb_entity\n")).toBe(true);
    expect(page).toContain(
      "```text\nEntities of the open world.\nRead:\nlist: Filtered, paged\n```",
    );
    expect(page).toContain("| Tier | core |");
    expect(page).toContain("| Registered under ENFUSION_TOOLSET | core, extended, all |");
    expect(page).toContain("## Actions (2)");
    expect(page).toContain("| `get` | no | no | One entity | `entity`* (string) |");
    expect(page).toContain("| `limit` | integer | no | default 50 \\| max 200 |");
    expect(page).toContain(
      "[data/kb/census/tools/wb_entity.md](../../../data/kb/census/tools/wb_entity.md)",
    );
    expect(page).toContain("| `get` | 2 | T2 1, T5 1 | `api:A.B/1`, `api:A.C/1` |");
    expect(page).toContain("| `list` | 1 | T2 1 | `api:A.C/1` |");
    expect(page).not.toContain("other_tool");
  });

  it("handles a tool without contract, kb page, or links", () => {
    const page = renderToolPage(input.tools[1], input);
    expect(page).not.toContain("Census KB page");
    expect(page).not.toContain("## Actions");
    expect(page).toContain('Default: `"x"`.');
    expect(page).toContain("No ledger row links an action of `script_lint`");
    const alias = renderToolPage(input.tools[2], input);
    expect(alias).toContain("| Tier | alias |");
    expect(alias).toContain("| Registered under ENFUSION_TOOLSET | all |");
    expect(alias).toContain("The tool takes no input parameters.");
  });
});

describe("generateFiles", () => {
  it("makes one page per tool plus an index, deterministic, LF, no dates", () => {
    const a = generateFiles(input);
    const b = generateFiles({ ...input, tools: [...input.tools].reverse() });
    expect([...a.keys()].sort()).toEqual([
      "index.md",
      "script_lint.md",
      "wb_entity.md",
      "wb_reload.md",
    ]);
    expect(JSON.stringify([...a.entries()].sort())).toBe(JSON.stringify([...b.entries()].sort()));
    for (const text of a.values()) {
      expect(text).not.toContain("\r");
      expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/);
      expect(text).not.toMatch(/[A-Za-z]:[\\/]/);
      expect(text.endsWith("\n")).toBe(true);
    }
    const index = a.get("index.md") as string;
    expect(index).toContain(
      "3 tools registered under ENFUSION_TOOLSET=all: 1 core, 1 extended, 1 alias.",
    );
    expect(index).toContain(
      "| [`wb_entity`](wb_entity.md) | core | 2 | Entities of the open world. |",
    );
  });
});

describe("--check", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "gen-tool-docs-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("writes, then reports clean (exit 0)", () => {
    expect(runGenerate(input, dir, false).code).toBe(0);
    const r = runGenerate(input, dir, true);
    expect(r.code).toBe(0);
    expect(diffAgainstDisk(generateFiles(input), dir)).toEqual([]);
  });

  it("exits 1 when a page differs, is missing, or is orphaned, and writes nothing", () => {
    runGenerate(input, dir, false);
    writeFileSync(join(dir, "wb_entity.md"), "stale\n");
    rmSync(join(dir, "script_lint.md"));
    writeFileSync(join(dir, "gone_tool.md"), "x\n");
    const r = runGenerate(input, dir, true);
    expect(r.code).toBe(1);
    expect(r.lines).toContain("stale: wb_entity.md");
    expect(r.lines).toContain("missing: script_lint.md");
    expect(r.lines).toContain("orphan: gone_tool.md");
    expect(readFileSync(join(dir, "wb_entity.md"), "utf-8")).toBe("stale\n");
  });

  it("a write run removes orphans", () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "gone_tool.md"), "x\n");
    runGenerate(input, dir, false);
    expect(diffAgainstDisk(generateFiles(input), dir)).toEqual([]);
  });

  it("exits 1 when the output folder does not exist", () => {
    expect(runGenerate(input, join(dir, "nope"), true).code).toBe(1);
  });
});

describe("renderReadmeBlock", () => {
  it("prints the counts between the markers", () => {
    const block = renderReadmeBlock(input.tools);
    expect(block).toBe(
      `${README_START}\n**3 tools with ENFUSION_TOOLSET=all** (1 in the default core set, 2 with extended)\n${README_END}\n`,
    );
    expect(README_START).toBe("<!-- counts:start -->");
    expect(README_END).toBe("<!-- counts:end -->");
  });
});
