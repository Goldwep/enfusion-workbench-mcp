/**
 * Prints the inventory numbers quoted in README.md so they can be refreshed
 * from source instead of by hand:
 *
 *   npx tsx scripts/count-inventory.ts [--entry <dist/index.js>] [--json]
 *
 * tools                  - counted from the LIVE registration: the server entry is spawned over
 *                          stdio under ENFUSION_TOOLSET=all and answers tools/list (fetchToolsList,
 *                          src/manifest/budget.ts). Tier comes from tierOf (src/manifest/tiers.ts);
 *                          the per-toolset counts apply filterTools to that list.
 * handler files          - files in mod/Scripts/WorkbenchGame/EnfusionMCP/*.c that declare a
 *                          class derived from NetApiHandler
 * ledger                 - rows and rows per tier, from loadLedger (src/census/ledger-io.ts)
 * prompts / resources    - counted from registerPrompt( / registerResource( calls under src/
 * classes, wiki, kb      - data/api, data/wiki/pages.json, data/kb/index.json
 * tests                  - it(/test( calls in *.test.ts under tests/ and src/ (approximate:
 *                          it.each / dynamic loops count once)
 *
 * The server entry defaults to dist/index.js. A stale dist/ gives stale counts: build to a scratch
 * directory (tsc -p tsconfig.build.json --outDir <dir>/dist, with data/ and contracts/ reachable
 * beside it) and pass --entry, or rebuild dist/ first.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { censusPaths, loadLedger } from "../src/census/ledger-io.js";
import { fetchToolsList, type ListedTool } from "../src/manifest/budget.js";
import { filterTools, tierOf, type Tier, type Toolset } from "../src/manifest/tiers.js";
import { isMainModule, parseArgs } from "./live/cli.js";

const ROOT = resolve(import.meta.dirname ?? ".", "..");
const HANDLER_DIR = ["mod", "Scripts", "WorkbenchGame", "EnfusionMCP"] as const;

export interface ToolEntry {
  name: string;
  tier: Tier;
}

export interface Inventory {
  tools: {
    total: number;
    byTier: Record<Tier, number>;
    byToolset: Record<Toolset, number>;
    list: ToolEntry[];
  };
  handlers: { count: number; sourceFiles: number; dir: string; files: string[] };
  ledger: { rows: number; byTier: Record<string, number> };
  prompts: number;
  resources: number;
  classes: { arma: number; enfusion: number };
  wikiPages: number;
  kbPatterns: number;
  testFiles: number;
  testsApprox: number;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === ".claude" || name === ".git") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function countMatches(files: string[], re: RegExp): number {
  let n = 0;
  for (const f of files) n += (readFileSync(f, "utf-8").match(re) ?? []).length;
  return n;
}

/** Tool entries (sorted by name) and the counts that follow from tierOf and filterTools. */
export function summariseTools(tools: ListedTool[]): Inventory["tools"] {
  const list: ToolEntry[] = tools
    .map((t) => ({ name: t.name, tier: tierOf(t.name) }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const byTier: Record<Tier, number> = { core: 0, extended: 0, alias: 0 };
  for (const t of list) byTier[t.tier]++;
  const count = (set: Toolset): number => filterTools(tools, { ENFUSION_TOOLSET: set }).length;
  return {
    total: list.length,
    byTier,
    byToolset: { core: count("core"), extended: count("extended"), all: count("all") },
    list,
  };
}

/** Files directly in the handler folder that declare `class X : NetApiHandler`. */
export function countHandlers(root: string): Inventory["handlers"] {
  const dir = join(root, ...HANDLER_DIR);
  const cFiles = readdirSync(dir)
    .filter((f) => f.endsWith(".c"))
    .sort();
  const re = /^\s*class\s+\w+\s*:\s*NetApiHandler\b/m;
  const files = cFiles.filter((f) => re.test(readFileSync(join(dir, f), "utf-8")));
  return { count: files.length, sourceFiles: cFiles.length, dir: HANDLER_DIR.join("/"), files };
}

export function ledgerTotals(root: string): Inventory["ledger"] {
  const ledger = loadLedger(censusPaths(join(root, "data", "census")));
  const byTier: Record<string, number> = {};
  for (const r of ledger.rows) byTier[r.tier] = (byTier[r.tier] ?? 0) + 1;
  const sorted: Record<string, number> = {};
  for (const k of Object.keys(byTier).sort()) sorted[k] = byTier[k];
  return { rows: ledger.rows.length, byTier: sorted };
}

export async function fetchLiveTools(entry: string): Promise<ListedTool[]> {
  if (!existsSync(entry)) {
    throw new Error(
      `server entry not found: ${entry}. Build it (tsc -p tsconfig.build.json) or pass --entry <path to index.js>`,
    );
  }
  return fetchToolsList(entry);
}

export async function collectInventory(root: string, entry: string): Promise<Inventory> {
  const tools = await fetchLiveTools(entry);
  const srcFiles = walk(join(root, "src")).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
  const testFiles = [...walk(join(root, "tests")), ...walk(join(root, "src"))].filter((f) =>
    /\.(test|spec)\.ts$/.test(f),
  );
  const jsonLen = (rel: string): number => (JSON.parse(readFileSync(join(root, rel), "utf-8")) as unknown[]).length;
  return {
    tools: summariseTools(tools),
    handlers: countHandlers(root),
    ledger: ledgerTotals(root),
    prompts: countMatches(srcFiles, /\.registerPrompt\(/g),
    resources: countMatches(srcFiles, /\.registerResource\(/g),
    classes: { arma: jsonLen("data/api/arma-classes.json"), enfusion: jsonLen("data/api/enfusion-classes.json") },
    wikiPages: jsonLen("data/wiki/pages.json"),
    kbPatterns: jsonLen("data/kb/index.json"),
    testFiles: testFiles.length,
    testsApprox: countMatches(testFiles, /^\s*(it|test)(\.only|\.skip|\.each\([^)]*\))?\(/gm),
  };
}

export function formatInventory(inv: Inventory): string {
  const rows: Array<[string, number | string]> = [
    ["tools (live registration, toolset all)", inv.tools.total],
    ["  tier core / extended / alias", `${inv.tools.byTier.core} / ${inv.tools.byTier.extended} / ${inv.tools.byTier.alias}`],
    [
      "  toolset core / extended / all",
      `${inv.tools.byToolset.core} / ${inv.tools.byToolset.extended} / ${inv.tools.byToolset.all}`,
    ],
    ["handler files (declare a NetApiHandler)", `${inv.handlers.count} of ${inv.handlers.sourceFiles} .c files`],
    ["ledger rows", inv.ledger.rows],
    ...Object.entries(inv.ledger.byTier).map(([k, v]): [string, number] => [`  ledger tier ${k}`, v]),
    ["prompts (static)", inv.prompts],
    ["resources (static)", inv.resources],
    ["classes (arma + enfusion)", `${inv.classes.arma + inv.classes.enfusion} (${inv.classes.arma} + ${inv.classes.enfusion})`],
    ["wiki pages", inv.wikiPages],
    ["kb pattern entries", inv.kbPatterns],
    ["test files", inv.testFiles],
    ["tests (approx, static it()/test() count)", inv.testsApprox],
  ];
  const lines = rows.map(([k, v]) => `${k.padEnd(42)} ${v}`);
  lines.push("", "For the exact vitest count: npx vitest run --pool=forks --poolOptions.forks.singleFork");
  return lines.join("\n");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2), ["entry"]);
  const entry = resolve(args.options.entry ?? join(ROOT, "dist", "index.js"));
  const inv = await collectInventory(ROOT, entry);
  if (args.flags.has("json")) console.log(JSON.stringify(inv, null, 2));
  else console.log(formatInventory(inv));
}

if (isMainModule(import.meta.url)) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
