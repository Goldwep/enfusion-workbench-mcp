/**
 * Measures the tools/list metadata of a built server, per tool and per toolset (Phase 6, DEC-065,
 * DEC-077), and joins it with a usage proxy from the census ledger: how many ledger rows link to
 * each tool through `row.mcp`.
 *
 *   tsx scripts/measure-tool-metadata.ts --entry <dist>/index.js [--out <file>] [--census <dir>]
 *
 * The entry is built into a scratch dir (`tsc -p tsconfig.build.json --outDir <scratch>/dist`);
 * never `npm run build`. Writes JSON (default docs/v2/inbox/phase6/metadata-measure.json) and
 * prints the table sorted by total chars, largest first.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { censusPaths, loadLedger } from "../src/census/ledger-io.js";
import { fetchToolsList, listChars, type ListedTool } from "../src/manifest/budget.js";
import { filterTools, tierOf, type Tier, type Toolset } from "../src/manifest/tiers.js";

export interface ToolMeasure {
  name: string;
  tier: Tier;
  nameChars: number;
  descriptionChars: number;
  schemaChars: number;
  /** nameChars + descriptionChars + schemaChars (the three fields, not the JSON framing). */
  totalChars: number;
  /** listChars([tool]): JSON.stringify of a one-tool array, so the tool object plus two bracket characters. */
  listChars: number;
  /** Entries of inputSchema.properties.action.enum; 0 when the tool has no action enum. */
  actions: number;
  /** Ledger rows with at least one mcp link to this tool. */
  ledgerRows: number;
}

export interface ToolsetTotal {
  toolset: Toolset;
  tools: number;
  /** JSON.stringify(tools).length, the budget.ts measure. */
  listChars: number;
  /** Sum of the per-tool totalChars. */
  totalChars: number;
}

export interface MeasureReport {
  generatedFrom: string;
  toolCount: number;
  toolsets: ToolsetTotal[];
  tools: ToolMeasure[];
}

/** Count of entries in inputSchema.properties.action.enum, 0 when absent. */
export function actionCount(inputSchema: unknown): number {
  const props = (inputSchema as { properties?: Record<string, unknown> } | undefined)?.properties;
  const en = (props?.action as { enum?: unknown } | undefined)?.enum;
  return Array.isArray(en) ? en.length : 0;
}

/** Distinct rows per tool from ledger rows' `mcp` links (`mcp:action/<tool>.<action>`). */
export function usageFromRows(
  rows: ReadonlyArray<{ mcp?: ReadonlyArray<{ action: string }> }>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    const tools = new Set<string>();
    for (const m of r.mcp ?? []) {
      const mt = /^mcp:action\/([^.]+)\./.exec(m.action);
      if (mt) tools.add(mt[1]);
    }
    for (const t of tools) out.set(t, (out.get(t) ?? 0) + 1);
  }
  return out;
}

export function measureTools(
  tools: ListedTool[],
  usage: ReadonlyMap<string, number>,
): ToolMeasure[] {
  const rows = tools.map((t): ToolMeasure => {
    const nameChars = t.name.length;
    const descriptionChars = (t.description ?? "").length;
    const schemaChars =
      t.inputSchema === undefined ? 0 : (JSON.stringify(t.inputSchema) ?? "").length;
    return {
      name: t.name,
      tier: tierOf(t.name),
      nameChars,
      descriptionChars,
      schemaChars,
      totalChars: nameChars + descriptionChars + schemaChars,
      listChars: listChars([t]),
      actions: actionCount(t.inputSchema),
      ledgerRows: usage.get(t.name) ?? 0,
    };
  });
  return rows.sort(
    (a, b) => b.totalChars - a.totalChars || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  );
}

export function toolsetTotals(tools: ListedTool[], measures: ToolMeasure[]): ToolsetTotal[] {
  const byName = new Map(measures.map((m) => [m.name, m]));
  return (["core", "extended", "all"] as const).map((toolset) => {
    const subset = filterTools(tools, { ENFUSION_TOOLSET: toolset });
    return {
      toolset,
      tools: subset.length,
      listChars: listChars(subset),
      totalChars: subset.reduce((n, t) => n + (byName.get(t.name)?.totalChars ?? 0), 0),
    };
  });
}

export function buildReport(
  tools: ListedTool[],
  usage: ReadonlyMap<string, number>,
  generatedFrom: string,
): MeasureReport {
  const tools_ = measureTools(tools, usage);
  return {
    generatedFrom,
    toolCount: tools.length,
    toolsets: toolsetTotals(tools, tools_),
    tools: tools_,
  };
}

export function formatTable(report: MeasureReport): string {
  const head = ["tool", "tier", "name", "desc", "schema", "total", "actions", "rows"];
  const w = Math.max(4, ...report.tools.map((t) => t.name.length));
  const line = (c: (string | number)[]) =>
    String(c[0]).padEnd(w) +
    "  " +
    String(c[1]).padEnd(8) +
    c
      .slice(2)
      .map((x) => String(x).padStart(7))
      .join(" ");
  const out = [line(head)];
  for (const t of report.tools)
    out.push(
      line([
        t.name,
        t.tier,
        t.nameChars,
        t.descriptionChars,
        t.schemaChars,
        t.totalChars,
        t.actions,
        t.ledgerRows,
      ]),
    );
  out.push("");
  for (const s of report.toolsets)
    out.push(
      `${s.toolset.padEnd(9)} ${String(s.tools).padStart(4)} tools  list ${s.listChars} chars  field sum ${s.totalChars}`,
    );
  return out.join("\n");
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const entry = arg("--entry");
  if (!entry)
    throw new Error(
      "usage: measure-tool-metadata.ts --entry <dist>/index.js [--out file] [--census dir]",
    );
  const repo = resolve(import.meta.dirname ?? ".", "..");
  const out = resolve(arg("--out") ?? resolve(repo, "docs/v2/inbox/phase6/metadata-measure.json"));
  const ledger = loadLedger(censusPaths(arg("--census") ?? resolve(repo, "data/census")));
  const tools = await fetchToolsList(resolve(entry));
  const report = buildReport(
    tools,
    usageFromRows(ledger.rows),
    "tools/list of the entry under ENFUSION_TOOLSET=all",
  );
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(report, null, 2) + "\n", "utf-8");
  console.log(formatTable(report));
  console.log(`\nwrote ${out}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
