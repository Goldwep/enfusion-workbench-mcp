/**
 * Generates the tool reference under docs/tools/reference/ from the live registration:
 *
 *   npx tsx scripts/gen-tool-docs.ts [--entry <dist/index.js>] [--out <dir>] [--check]
 *   npx tsx scripts/gen-tool-docs.ts --readme-block [--entry <dist/index.js>]
 *
 * One page per registered tool (<tool>.md) plus index.md. A page carries the description and the
 * input schema exactly as tools/list returns them, the tier and toolset (src/manifest/tiers.ts),
 * the per-action table from the handler contract (contracts/*.json) when the tool has one, the
 * census rows whose `mcp` links name the tool's actions (data/census ledger), and a link to
 * data/kb/census/tools/<tool>.md when that page exists.
 *
 * Output is deterministic: sorted, LF, no dates, no machine paths. Default: write the pages (and
 * remove .md files in the output folder that no registered tool owns). --check: write nothing;
 * exit 1 when a page is missing, stale or orphaned. --readme-block: print the README count lines
 * between the markers <!-- counts:start --> / <!-- counts:end -->; README.md is never written here.
 *
 * Tiers and descriptions change as other work lands, so rerun this after the last change to a
 * tool description, schema or tier, then run --check.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { censusPaths, loadLedger } from "../src/census/ledger-io.js";
import type { ListedTool } from "../src/manifest/budget.js";
import { tierOf, type Tier } from "../src/manifest/tiers.js";
import { fetchLiveTools, summariseTools } from "./count-inventory.js";
import { isMainModule, parseArgs } from "./live/cli.js";

const ROOT = resolve(import.meta.dirname ?? ".", "..");
export const DEFAULT_OUT = join("docs", "tools", "reference");
export const README_START = "<!-- counts:start -->";
export const README_END = "<!-- counts:end -->";

// ── Input ──────────────────────────────────────────────────────────────────────

export interface ContractParamDoc {
  key: string;
  type: string;
  required: boolean;
  note?: string;
}
export interface ContractActionDoc {
  name: string;
  summary: string;
  mutating: boolean;
  projectOnly: boolean;
  refuses?: string;
  params: ContractParamDoc[];
  paging: boolean;
}
export interface ContractDoc {
  handler: string;
  tool: string;
  purpose: string;
  actions: ContractActionDoc[];
}
/** The part of a ledger row this generator reads. */
export interface LedgerRowDoc {
  id: string;
  tier: string;
  mcp: Array<{ action: string; role: string }>;
}
export interface DocInput {
  tools: ListedTool[];
  contracts: ContractDoc[];
  rows: LedgerRowDoc[];
  /** Tool names that have a page under data/kb/census/tools/. */
  kbTools: Set<string>;
}

const TOOL_LINK = /^mcp:action\/([a-z0-9_]+)\.(.+)$/;

export function loadContracts(root: string): ContractDoc[] {
  const dir = join(root, "contracts");
  const out: ContractDoc[] = [];
  for (const f of readdirSync(dir)
    .filter((n) => n.endsWith(".json"))
    .sort()) {
    const c = JSON.parse(readFileSync(join(dir, f), "utf-8")) as Partial<ContractDoc>;
    if (typeof c.tool === "string" && Array.isArray(c.actions) && typeof c.handler === "string") {
      out.push(c as ContractDoc);
    }
  }
  return out;
}

export function loadDocInput(root: string, tools: ListedTool[]): DocInput {
  const ledger = loadLedger(censusPaths(join(root, "data", "census")));
  const kbDir = join(root, "data", "kb", "census", "tools");
  const kbTools = new Set(
    existsSync(kbDir)
      ? readdirSync(kbDir)
          .filter((n) => n.endsWith(".md"))
          .map((n) => n.slice(0, -3))
      : [],
  );
  return {
    tools,
    contracts: loadContracts(root),
    rows: ledger.rows as unknown as LedgerRowDoc[],
    kbTools,
  };
}

// ── Rendering helpers ──────────────────────────────────────────────────────────

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function lf(s: string): string {
  return s.replace(/\r\n?/g, "\n");
}

/** One table cell: no newlines, pipes escaped. */
function cell(s: string): string {
  return lf(s).trim().replace(/\n+/g, " ").replace(/\|/g, "\\|");
}

function table(head: string[], rows: string[][]): string {
  const lines = [`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`];
  for (const r of rows) lines.push(`| ${r.map(cell).join(" | ")} |`);
  return lines.join("\n");
}

/** Toolsets a tier is registered under (src/manifest/tiers.ts inToolset). */
export function toolsetsOf(tier: Tier): string {
  if (tier === "core") return "core, extended, all";
  if (tier === "extended") return "extended, all";
  return "all";
}

interface JsonSchemaNode {
  type?: string | string[];
  enum?: unknown[];
  items?: JsonSchemaNode;
  anyOf?: JsonSchemaNode[];
  oneOf?: JsonSchemaNode[];
  description?: string;
  default?: unknown;
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
}

function typeName(s: JsonSchemaNode | undefined): string {
  if (!s) return "any";
  if (s.anyOf ?? s.oneOf) return (s.anyOf ?? s.oneOf ?? []).map(typeName).join(" | ");
  if (Array.isArray(s.type)) return s.type.join(" | ");
  if (s.type === "array") return `array<${typeName(s.items)}>`;
  if (s.type) return s.type;
  if (s.enum) return "enum";
  return "any";
}

function paramNotes(s: JsonSchemaNode): string {
  const parts: string[] = [];
  if (s.description) parts.push(lf(s.description).trim());
  if (s.enum) parts.push(`One of: ${s.enum.map((v) => `\`${String(v)}\``).join(", ")}.`);
  if (s.default !== undefined) parts.push(`Default: \`${JSON.stringify(s.default)}\`.`);
  return parts.join(" ");
}

function schemaParams(tool: ListedTool): { rows: string[][]; actions: string[] } {
  const schema = (tool.inputSchema ?? {}) as JsonSchemaNode;
  const props = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const names = Object.keys(props);
  const actionEnum = props.action?.enum?.map(String) ?? [];
  const rows = names.map((n): string[] => {
    const p = props[n];
    return [`\`${n}\``, typeName(p), required.has(n) ? "yes" : "no", paramNotes(p)];
  });
  return { rows, actions: actionEnum };
}

function firstSentence(desc: string, max = 110): string {
  const flat = lf(desc).trim().replace(/\s+/g, " ");
  const m = /^(.+?[.!?])(\s|$)/.exec(flat);
  const s = m ? m[1] : flat;
  return s.length > max ? `${s.slice(0, max - 3).trimEnd()}...` : s;
}

interface ActionLinks {
  count: number;
  byTier: Map<string, number>;
  sample: string[];
}

function linksByAction(rows: LedgerRowDoc[], tool: string): Map<string, ActionLinks> {
  const out = new Map<string, ActionLinks>();
  for (const r of rows) {
    const seen = new Set<string>();
    for (const l of r.mcp ?? []) {
      const m = TOOL_LINK.exec(l.action);
      if (!m || m[1] !== tool || seen.has(m[2])) continue;
      seen.add(m[2]);
      let e = out.get(m[2]);
      if (!e) {
        e = { count: 0, byTier: new Map(), sample: [] };
        out.set(m[2], e);
      }
      e.count++;
      e.byTier.set(r.tier, (e.byTier.get(r.tier) ?? 0) + 1);
      e.sample.push(r.id);
    }
  }
  for (const e of out.values()) e.sample = e.sample.sort(cmp).slice(0, 3);
  return out;
}

const tierList = (m: Map<string, number>): string =>
  [...m.entries()]
    .sort((a, b) => cmp(a[0], b[0]))
    .map(([t, n]) => `${t} ${n}`)
    .join(", ");

// ── Pages ──────────────────────────────────────────────────────────────────────

export function renderToolPage(tool: ListedTool, input: DocInput): string {
  const tier = tierOf(tool.name);
  const contract = input.contracts.find((c) => c.tool === tool.name);
  const { rows: paramRows, actions: enumActions } = schemaParams(tool);
  const links = linksByAction(input.rows, tool.name);
  const out: string[] = [`# ${tool.name}`, ""];
  out.push("```text", lf(tool.description ?? "(no description)").trim(), "```", "");

  const facts: string[][] = [
    ["Tier", tier],
    ["Registered under ENFUSION_TOOLSET", toolsetsOf(tier)],
  ];
  if (contract)
    facts.push([
      "Handler contract",
      `\`contracts/${contract.handler}.json\` (${contract.handler})`,
    ]);
  if (input.kbTools.has(tool.name)) {
    facts.push([
      "Census KB page",
      `[data/kb/census/tools/${tool.name}.md](../../../data/kb/census/tools/${tool.name}.md)`,
    ]);
  }
  out.push(table(["Field", "Value"], facts), "");

  if (contract) {
    out.push(`## Actions (${contract.actions.length})`, "");
    out.push(
      table(
        ["Action", "Writes", "Project only", "Summary", "Parameters"],
        contract.actions.map((a) => [
          `\`${a.name}\``,
          a.mutating ? "yes" : "no",
          a.projectOnly ? "yes" : "no",
          a.summary + (a.refuses ? ` Refuses: ${a.refuses}` : ""),
          a.params.length
            ? a.params.map((p) => `\`${p.key}\`${p.required ? "*" : ""} (${p.type})`).join(", ")
            : "none",
        ]),
      ),
      "",
      "`*` marks a required parameter of that action.",
      "",
    );
  } else if (enumActions.length) {
    out.push(
      `## Actions (${enumActions.length})`,
      "",
      enumActions.map((a) => `\`${a}\``).join(", "),
      "",
    );
  }

  out.push(`## Input parameters (${paramRows.length})`, "");
  if (paramRows.length) out.push(table(["Name", "Type", "Required", "Notes"], paramRows), "");
  else out.push("The tool takes no input parameters.", "");

  out.push("## Linked census rows", "");
  if (links.size === 0) {
    out.push(`No ledger row links an action of \`${tool.name}\` through its \`mcp\` field.`, "");
  } else {
    let total = 0;
    for (const e of links.values()) total += e.count;
    out.push(
      `Ledger rows whose \`mcp\` links name \`mcp:action/${tool.name}.<action>\`. A row that links several actions is counted under each (${total} links in all).`,
      "",
    );
    out.push(
      table(
        ["Action", "Rows", "By tier", "First ids"],
        [...links.entries()]
          .sort((a, b) => cmp(a[0], b[0]))
          .map(([a, e]) => [
            `\`${a}\``,
            String(e.count),
            tierList(e.byTier),
            e.sample.map((s) => `\`${s}\``).join(", "),
          ]),
      ),
      "",
    );
  }
  return (
    out
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trimEnd() + "\n"
  );
}

export function renderIndex(input: DocInput): string {
  const inv = summariseTools(input.tools);
  const byName = new Map(input.tools.map((t) => [t.name, t]));
  const out: string[] = [
    "# Tool reference",
    "",
    "Generated by `scripts/gen-tool-docs.ts` from the live tool registration. Do not edit by hand; rerun the script.",
    "",
    `${inv.total} tools registered under ENFUSION_TOOLSET=all: ${inv.byTier.core} core, ${inv.byTier.extended} extended, ${inv.byTier.alias} alias. ENFUSION_TOOLSET=core registers ${inv.byToolset.core}, extended registers ${inv.byToolset.extended}, all registers ${inv.byToolset.all}.`,
    "",
  ];
  const rows = inv.list.map((e): string[] => {
    const t = byName.get(e.name) as ListedTool;
    const actions =
      input.contracts.find((c) => c.tool === e.name)?.actions.length ??
      schemaParams(t).actions.length;
    return [
      `[\`${e.name}\`](${e.name}.md)`,
      e.tier,
      actions ? String(actions) : "",
      firstSentence(t.description ?? ""),
    ];
  });
  out.push(table(["Tool", "Tier", "Actions", "Summary"], rows), "");
  return out.join("\n");
}

/** Path (relative to the output folder) -> page text, for every tool plus index.md. */
export function generateFiles(input: DocInput): Map<string, string> {
  const files = new Map<string, string>();
  for (const t of [...input.tools].sort((a, b) => cmp(a.name, b.name))) {
    files.set(`${t.name}.md`, renderToolPage(t, input));
  }
  files.set("index.md", renderIndex(input));
  return files;
}

/** The README count line(s) between the markers, markers included. */
export function renderReadmeBlock(tools: ListedTool[]): string {
  const inv = summariseTools(tools);
  const line =
    `**${inv.byToolset.all} tools with ENFUSION_TOOLSET=all** ` +
    `(${inv.byToolset.core} in the default core set, ${inv.byToolset.extended} with extended)`;
  return [README_START, line, README_END].join("\n") + "\n";
}

// ── Disk ───────────────────────────────────────────────────────────────────────

export interface Difference {
  file: string;
  kind: "missing" | "stale" | "orphan";
}

export function diffAgainstDisk(files: Map<string, string>, dir: string): Difference[] {
  const diffs: Difference[] = [];
  for (const [name, text] of [...files.entries()].sort((a, b) => cmp(a[0], b[0]))) {
    const p = join(dir, name);
    if (!existsSync(p)) diffs.push({ file: name, kind: "missing" });
    else if (readFileSync(p, "utf-8") !== text) diffs.push({ file: name, kind: "stale" });
  }
  if (existsSync(dir)) {
    for (const n of readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .sort()) {
      if (!files.has(n)) diffs.push({ file: n, kind: "orphan" });
    }
  }
  return diffs;
}

export function writeFiles(files: Map<string, string>, dir: string): void {
  mkdirSync(dir, { recursive: true });
  for (const [name, text] of files) writeFileSync(join(dir, name), text, { encoding: "utf-8" });
  for (const d of diffAgainstDisk(files, dir)) {
    if (d.kind === "orphan") unlinkSync(join(dir, d.file));
  }
}

/** Runs the check or the write; returns the process exit code and the lines to print. */
export function runGenerate(
  input: DocInput,
  dir: string,
  check: boolean,
): { code: number; lines: string[] } {
  const files = generateFiles(input);
  if (check) {
    const diffs = diffAgainstDisk(files, dir);
    if (diffs.length === 0)
      return { code: 0, lines: [`tool reference is current (${files.size} files)`] };
    return {
      code: 1,
      lines: [
        ...diffs.map((d) => `${d.kind}: ${d.file}`),
        `${diffs.length} file(s) differ; run npx tsx scripts/gen-tool-docs.ts`,
      ],
    };
  }
  writeFiles(files, dir);
  return { code: 0, lines: [`wrote ${files.size} files`] };
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2), ["entry", "out"]);
  const entry = resolve(args.options.entry ?? join(ROOT, "dist", "index.js"));
  const tools = await fetchLiveTools(entry);
  if (args.flags.has("readme-block")) {
    process.stdout.write(renderReadmeBlock(tools));
    return 0;
  }
  const dir = resolve(ROOT, args.options.out ?? DEFAULT_OUT);
  const { code, lines } = runGenerate(loadDocInput(ROOT, tools), dir, args.flags.has("check"));
  for (const l of lines) (code === 0 ? console.log : console.error)(l);
  return code;
}

if (isMainModule(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (e: unknown) => {
      console.error(e instanceof Error ? e.message : String(e));
      process.exit(1);
    },
  );
}
