/**
 * Generates the census knowledge-base pages from the ledger (work package
 * 3.7). Offline; reads the ledger shards only.
 *
 *   npx tsx scripts/census/gen-kb.ts            write data/kb/census/
 *   npx tsx scripts/census/gen-kb.ts --check    exit 1 when the committed pages differ or a
 *                                               hand page cites a row id the ledger lacks, or
 *                                               has a fact line with no citation
 *
 * Output: `modules/<Module>.md` (one per module with rows), `tools/<tool>.md`
 * (one per MCP tool row) and `index.md`. `hand/*.md` are hand-written pages
 * (never generated or removed); each fact line cites `[row: <id>]` or carries
 * `[unverified]`, and index.md and the matching module page link them. Deterministic: sorted by code unit,
 * LF line ends, no dates, no machine paths.
 *
 * Options: --data <dir> (census root), --out <dir> (default data/kb/census).
 * Exit: 0 ok; 1 differs (--check); 2 usage or no ledger; 3 malformed ledger.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { compareCodeUnits } from "../../src/census/canon.js";
import {
  ledgerMissing,
  loadLedger,
  readJson,
  type LoadedLedger,
} from "../../src/census/ledger-io.js";
import { redact } from "../../src/census/query-engine.js";
import type { Row } from "../../src/census/schemas.js";
import { TIERS } from "../../src/census/vocab.js";
import {
  EXIT_FAIL,
  EXIT_OK,
  EXIT_USAGE,
  PROCESS_IO,
  guard,
  isMainModule,
  pathsFrom,
  type Io,
} from "./cli-common.js";

const DEFAULT_OUT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "data",
  "kb",
  "census",
);

const sorted = <T>(xs: Iterable<T>, key: (x: T) => string): T[] =>
  [...xs].sort((a, b) => compareCodeUnits(key(a), key(b)));

function tally(rows: Row[], key: (r: Row) => string): [string, number][] {
  const m = new Map<string, number>();
  for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + 1);
  return sorted(m.entries(), (e) => e[0]);
}

function cell(s: string): string {
  return redact(s.replace(/\s+/g, " ").replace(/\|/g, "\\|").trim());
}

function nameOf(r: Row): string {
  return r.label ?? r.object_name ?? r.class_name ?? r.signature ?? "";
}

/** Hand pages for the documentation holes: file name -> the module it documents. */
export const HAND_PAGE_MODULES: Readonly<Record<string, string>> = {
  "MaterialEditor.md": "ResourceManager.Material",
  "FontViewer.md": "ResourceManager.Font",
  "StylesEditor.md": "ResourceManager.Styles",
  "DialogueEditor.md": "DialogueEditor",
};

/** Rows listed per kind on a module page before the rest is a count. */
const KIND_LIST_CAP = 40;
/** Below-target rows listed before the rest is a count. */
const BELOW_LIST_CAP = 60;
/** Kinds that name a surface of the module (window, dock, panel, declaration). */
const SURFACE_KINDS = new Set([
  "window",
  "module",
  "dock",
  "panel",
  "class",
  "file-type",
  "schema-class",
]);
const SURFACE_CAP = 12;

function versionKey(v: string): string {
  return v
    .split(".")
    .map((p) => p.padStart(6, "0"))
    .join(".");
}

function isBelowTarget(r: Row): boolean {
  return TIERS.indexOf(r.tier) < TIERS.indexOf(r.target_tier);
}

/** The path column: the chosen path, else the candidate paths. */
function pathOf(r: Row): string {
  if (r.chosen_path) return r.chosen_path;
  const ps = [...new Set(r.paths.map((p) => p.path))].sort(compareCodeUnits);
  return ps.length === 0 ? "none" : `candidate: ${ps.join(", ")}`;
}

/** The tool actions linked on a row (row.mcp), as links to the tool pages where one exists. */
function actionLinks(r: Row, tools: ReadonlySet<string>): string {
  const links = sorted(r.mcp, (m) => m.action).map((m) => {
    const name = m.action.slice("mcp:action/".length);
    const tool = name.slice(0, name.lastIndexOf("."));
    return tools.has(tool) ? `[${name}](../tools/${tool}.md) ${m.role}` : `${name} ${m.role}`;
  });
  return links.length === 0 ? "none" : cell(links.join(", "));
}

function modulePage(
  module: string,
  rows: Row[],
  tools: ReadonlySet<string> = new Set(),
  handFile: string | null = null,
  handTitle = "",
): string {
  const counted = rows.filter((r) => !r.aggregate);
  const L = [`# Census: ${module}`, ""];
  L.push(`${counted.length} rows (${rows.length - counted.length} aggregate excluded).`, "");
  L.push("## What it is", "");
  const dims = tally(counted, (r) => r.dim)
    .map(([d, n]) => `${d} ${n}`)
    .join(", ");
  const builds = counted.flatMap((r) => [r.build.first_seen, r.build.last_seen]);
  const byVersion = sorted(builds, versionKey);
  L.push(
    `Module ${module}: ${dims || "no rows"}.` +
      (byVersion.length > 0
        ? ` Seen in builds ${byVersion[0]} to ${byVersion[byVersion.length - 1]}.`
        : ""),
    "",
  );
  const surfaces = sorted(
    counted.filter((r) => SURFACE_KINDS.has(r.kind)),
    (r) => r.id,
  );
  if (surfaces.length > 0) {
    L.push("Surfaces:", "");
    for (const r of surfaces.slice(0, SURFACE_CAP)) {
      const what = r.what_source === "observed" && r.what ? `: ${cell(r.what)}` : "";
      L.push(`- ${r.kind} ${cell(nameOf(r) || r.id)} (${cell(r.id)})${what}`);
    }
    if (surfaces.length > SURFACE_CAP) L.push(`- ... ${surfaces.length - SURFACE_CAP} more`);
    L.push("");
  }
  if (handFile) L.push(`Hand page: [${cell(handTitle || handFile)}](../hand/${handFile})`, "");
  L.push("## By dimension and tier", "", `| dim | ${TIERS.join(" | ")} | total |`);
  L.push(`| --- | ${TIERS.map(() => "---").join(" | ")} | --- |`);
  for (const [dim, n] of tally(counted, (r) => r.dim)) {
    const cs = TIERS.map((t) => counted.filter((r) => r.dim === dim && r.tier === t).length);
    L.push(`| ${dim} | ${cs.join(" | ")} | ${n} |`);
  }
  L.push("", "## By kind", "");
  for (const [k, n] of tally(counted, (r) => r.kind)) L.push(`- ${k}: ${n}`);
  L.push("", "## By risk", "");
  for (const [k, n] of tally(counted, (r) => r.risk ?? "not assigned")) L.push(`- ${k}: ${n}`);
  L.push("", "## Rows by kind", "");
  for (const [kind, n] of tally(counted, (r) => r.kind)) {
    const ofKind = sorted(
      counted.filter((r) => r.kind === kind),
      (r) => r.id,
    );
    L.push(
      `### ${kind} (${n})`,
      "",
      "| id | tier | path | tool actions |",
      "| --- | --- | --- | --- |",
    );
    for (const r of ofKind.slice(0, KIND_LIST_CAP)) {
      L.push(
        `| ${cell(r.id)} | ${r.tier}/${r.target_tier} | ${cell(pathOf(r))} | ${actionLinks(r, tools)} |`,
      );
    }
    if (ofKind.length > KIND_LIST_CAP) {
      L.push(
        "",
        `${ofKind.length - KIND_LIST_CAP} more: wb_census find with module=${module} kind=${kind}.`,
      );
    }
    L.push("");
  }
  const below = sorted(counted.filter(isBelowTarget), (r) => r.id);
  L.push(`## Below target (${below.length})`, "");
  if (below.length === 0) L.push("No counted row is below its target tier.");
  else {
    for (const [gap, n] of tally(below, (r) => `${r.tier} to ${r.target_tier}`)) {
      L.push(`- ${gap}: ${n}`);
    }
    L.push("", "| id | tier | path |", "| --- | --- | --- |");
    for (const r of below.slice(0, BELOW_LIST_CAP)) {
      L.push(`| ${cell(r.id)} | ${r.tier}/${r.target_tier} | ${cell(pathOf(r))} |`);
    }
    if (below.length > BELOW_LIST_CAP) {
      L.push("", `${below.length - BELOW_LIST_CAP} more: wb_census find with module=${module}.`);
    }
  }
  const disp = sorted(
    rows.filter((r) => r.disposition),
    (r) => r.id,
  );
  L.push("", `## Dispositions (${disp.length})`, "");
  if (disp.length === 0) L.push("No row of this module carries a disposition.");
  else {
    L.push("| id | kind | why | evidence |", "| --- | --- | --- | --- |");
    for (const r of disp) {
      const d = r.disposition as NonNullable<Row["disposition"]>;
      L.push(`| ${cell(r.id)} | ${d.kind} | ${cell(d.why)} | ${cell(d.evidence)} |`);
    }
  }
  L.push("");
  return L.join("\n");
}

/** The entries of known-defects.json (all are open) that this generator reads. */
export interface KnownDefect {
  id: string;
  title: string;
  where?: string;
  evidence?: string;
  switch?: string;
}

/** Tool names a defect names in its `where` (src/tools/<kebab>.ts becomes snake_case). */
function defectTools(d: KnownDefect): string[] {
  return [...(d.where ?? "").matchAll(/src\/tools\/([a-z0-9-]+)\.ts/g)].map((m) =>
    m[1].replace(/-/g, "_"),
  );
}

function defectLines(tool: string, defects: KnownDefect[]): string[] {
  const mine = defects.filter((d) => defectTools(d).includes(tool));
  if (mine.length === 0) return [];
  const L = ["## Known defects", ""];
  for (const d of sorted(mine, (x) => x.id)) {
    L.push(`- ${d.id}: ${cell(d.title)}`);
    if (d.switch && /not a Workbench parameter/i.test(`${d.title} ${d.evidence ?? ""}`)) {
      L.push(`  \`${d.switch}\` is not a Workbench parameter; do not pass it.`);
    }
  }
  L.push("");
  return L;
}

function toolOf(r: Row): string | null {
  const m = /^mcp:tool\/(.+)$/.exec(r.id);
  return m ? m[1] : null;
}

function toolPage(
  tool: string,
  row: Row,
  actions: Row[],
  linked: Row[],
  defects: KnownDefect[],
): string {
  const L = [`# Tool: ${tool}`, "", cell(row.what ?? "(no description in the source)"), ""];
  L.push(`Row: ${row.id}. Tier ${row.tier}/${row.target_tier}.`, "");
  L.push(`## Actions (${actions.length})`, "", "| action | risk | what |", "| --- | --- | --- |");
  for (const a of sorted(actions, (x) => x.id)) {
    const name = a.id.slice(a.id.lastIndexOf(".") + 1);
    L.push(`| ${cell(name)} | ${a.risk ?? "not assigned"} | ${cell(a.what ?? "")} |`);
  }
  L.push("", `## Rows linked to this tool (${linked.length})`, "");
  if (linked.length === 0) L.push("(none linked yet)");
  for (const r of linked.slice(0, 50))
    L.push(
      `- ${cell(r.id)} (${r.mcp
        .filter((m) => m.action.startsWith(`mcp:action/${tool}.`))
        .map((m) => `${m.action.slice(m.action.lastIndexOf(".") + 1)} ${m.role}`)
        .join(", ")})`,
    );
  if (linked.length > 50) L.push(`- ... ${linked.length - 50} more`);
  L.push("", ...defectLines(tool, defects));
  return L.join("\n");
}

/** First heading of a hand page, else its file name. */
function handTitle(file: string, text: string): string {
  const m = /^# (.+)$/m.exec(text.replace(/\r\n/g, "\n"));
  return m ? m[1].trim() : file;
}

/** Every page as relative path -> text. `hand` maps hand-page file name -> text (data/kb/census/hand/). */
export function generatePages(
  ledger: LoadedLedger,
  defects: KnownDefect[] = [],
  hand: ReadonlyMap<string, string> = new Map(),
): Map<string, string> {
  const pages = new Map<string, string>();
  const tools = new Set(ledger.rows.map(toolOf).filter((t): t is string => t !== null));
  const handFor = (module: string): string | null =>
    Object.entries(HAND_PAGE_MODULES).find(([file, m]) => m === module && hand.has(file))?.[0] ??
    null;
  const byModule = new Map<string, Row[]>();
  for (const r of ledger.rows) byModule.set(r.module, [...(byModule.get(r.module) ?? []), r]);
  const index = [
    "# Census knowledge base",
    "",
    "Generated from the ledger by scripts/census/gen-kb.ts. Do not edit.",
    "",
  ];
  index.push("## Modules", "");
  for (const [m, rows] of sorted(byModule.entries(), (e) => e[0])) {
    if (m === "none") {
      // Rows no module claims (review-1 finding 5): one page per kind, under modules/none/.
      const counted = rows.filter((r) => !r.aggregate).length;
      const kinds = tally(rows, (r) => r.kind);
      const links = kinds.map(([k, n]) => `[${k}](modules/none/${k}.md) ${n}`);
      index.push(
        `- none (rows no module claims): ${counted} rows, one page per kind: ${links.join(", ")}`,
      );
      for (const [kind] of kinds) {
        const page = modulePage(
          "none",
          rows.filter((r) => r.kind === kind),
          tools,
        ).replace(/^# Census: none\n/, `# Census: no module, kind ${kind}\n`);
        pages.set(`modules/none/${kind}.md`, page.split("](../tools/").join("](../../tools/"));
      }
      continue;
    }
    const hf = handFor(m);
    pages.set(
      `modules/${m}.md`,
      modulePage(m, rows, tools, hf, hf ? handTitle(hf, hand.get(hf) as string) : ""),
    );
    index.push(`- [${m}](modules/${m}.md): ${rows.filter((r) => !r.aggregate).length} rows`);
  }
  if (hand.size > 0) {
    index.push("", "## Hand pages", "");
    for (const [file, text] of sorted(hand.entries(), (e) => e[0])) {
      index.push(`- [${cell(handTitle(file, text))}](hand/${file})`);
    }
  }
  index.push("", "## Tools", "");
  const toolRows = ledger.rows.filter((r) => toolOf(r) !== null);
  for (const t of sorted(toolRows, (r) => r.id)) {
    const tool = toolOf(t) as string;
    const prefix = `mcp:action/${tool}.`;
    const actions = ledger.rows.filter((r) => r.id.startsWith(prefix));
    const linked = ledger.rows.filter((r) => r.mcp.some((m) => m.action.startsWith(prefix)));
    pages.set(
      `tools/${tool}.md`,
      toolPage(
        tool,
        t,
        actions,
        sorted(linked, (r) => r.id),
        defects,
      ),
    );
    index.push(`- [${tool}](tools/${tool}.md): ${actions.length} actions`);
  }
  index.push("");
  pages.set("index.md", index.join("\n"));
  return pages;
}

/** The text of every `[row: <id>]` citation on a line (ids may contain brackets). */
export function extractCitations(line: string): string[] {
  const out: string[] = [];
  const open = "[row: ";
  let at = line.indexOf(open);
  while (at !== -1) {
    let depth = 1;
    let i = at + 1;
    for (; i < line.length && depth > 0; i++) {
      if (line[i] === "[") depth++;
      else if (line[i] === "]") depth--;
    }
    if (depth !== 0) {
      out.push(line.slice(at + open.length));
      break;
    }
    out.push(line.slice(at + open.length, i - 1));
    at = line.indexOf(open, i);
  }
  return out;
}

/** A line that carries no fact: blank, a heading, a table rule, or a bare relative link. */
function isFactFree(line: string): boolean {
  const t = line.trim();
  return (
    t === "" ||
    /^#{1,6}\s/.test(t) ||
    /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?$/.test(t) ||
    /^([-*]\s+)?\[[^\]]*\]\([^)]*\)$/.test(t)
  );
}

const CITE = "\u0000";
const UNVERIFIED = "\u0001";

/** How many items a sentence lists ("A, B and C" is 3, "A and B" is 2), or 1 when it lists none. */
export function listedItems(sentence: string): number {
  const at = sentence.search(/\s(?:and|or)\s/);
  if (at < 0) return 1;
  const head = sentence.slice(0, at);
  return (head.match(/,\s/g) ?? []).length + 2;
}

/**
 * Citation problems inside one fact line (review-1 finding 6): every sentence must carry its own
 * `[row: <id>]` or `[unverified]` (one citation at the end no longer covers two sentences), and a
 * sentence that cites more than one row is a list of row facts, so it must cite at least as many
 * rows as it lists items ("A, B, C and D" with three citations leaves one item uncited).
 */
export function lineCitationProblems(line: string): string[] {
  let marked = line.replace(/^\s*[-*]\s+/, "");
  for (const id of extractCitations(marked)) marked = marked.split(`[row: ${id}]`).join(CITE);
  marked = marked.split("[unverified]").join(UNVERIFIED);
  const parts = marked.split(/(?<=[.!?\u0000\u0001])\s+(?=[A-Z`\u0000\u0001])/);
  const sentences: string[] = [];
  for (const p of parts) {
    if (sentences.length > 0 && p.replace(/[\u0000\u0001\s]/g, "") === "") {
      sentences[sentences.length - 1] += ` ${p}`;
    } else sentences.push(p);
  }
  const problems: string[] = [];
  sentences.forEach((s, i) => {
    const text = s.replace(/[\u0000\u0001]/g, "").trim();
    if (text === "") return;
    const cites = s.split(CITE).length - 1;
    if (cites === 0 && !s.includes(UNVERIFIED)) {
      problems.push(`sentence ${i + 1} has no [row: id] citation or [unverified]`);
      return;
    }
    const items = listedItems(text);
    if (cites > 1 && cites < items) {
      problems.push(`sentence ${i + 1} lists ${items} items but cites ${cites} rows`);
    }
  });
  return problems;
}

/**
 * Problems in the hand pages: a cited row id that is not in the ledger, a
 * fact line with neither a `[row: <id>]` citation nor the `[unverified]` marker,
 * and a line whose citations do not cover each of its facts (`lineCitationProblems`).
 */
export function checkHandPages(ledger: LoadedLedger, hand: ReadonlyMap<string, string>): string[] {
  const ids = new Set(ledger.rows.map((r) => r.id));
  const problems: string[] = [];
  for (const [file, text] of sorted(hand.entries(), (e) => e[0])) {
    const lines = text.replace(/\r\n/g, "\n").split("\n");
    lines.forEach((line, i) => {
      const where = `hand/${file}:${i + 1}`;
      const cites = extractCitations(line);
      for (const id of cites) {
        if (!ids.has(id)) problems.push(`${where}: dangling row id ${redact(id)}`);
      }
      if (isFactFree(line)) return;
      if (cites.length === 0 && !line.includes("[unverified]")) {
        problems.push(`${where}: fact line without a [row: id] citation or [unverified]`);
        return;
      }
      for (const p of lineCitationProblems(line)) problems.push(`${where}: ${p}`);
    });
  }
  return problems;
}

function readHandPages(out: string): Map<string, string> {
  const dir = join(out, "hand");
  const m = new Map<string, string>();
  if (!existsSync(dir)) return m;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isFile() && e.name.endsWith(".md")) {
      m.set(e.name, readFileSync(join(dir, e.name), "utf8").replace(/\r\n/g, "\n"));
    }
  }
  return m;
}

/** Generated files only: the hand/ folder is written by people and is never stale or removed. */
function listFiles(dir: string, base = ""): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() && base === "" && e.name === "hand"
      ? []
      : e.isDirectory()
        ? listFiles(join(dir, e.name), `${base}${e.name}/`)
        : [`${base}${e.name}`],
  );
}

export function run(argv: string[], io: Io = PROCESS_IO): number {
  return guard(io, "gen-kb", () => {
    const { values } = parseArgs({
      args: argv,
      options: {
        check: { type: "boolean" },
        data: { type: "string" },
        out: { type: "string" },
      },
      strict: true,
    });
    const paths = pathsFrom(values.data);
    if (ledgerMissing(paths)) {
      io.err("gen-kb: no ledger under the census root; run build.ts first");
      return EXIT_USAGE;
    }
    const out = values.out ? resolve(values.out) : DEFAULT_OUT;
    const defects = readJson<{ defects?: KnownDefect[] }>(paths.knownDefects, {}).defects ?? [];
    const ledger = loadLedger(paths);
    const hand = readHandPages(out);
    const pages = generatePages(ledger, defects, hand);
    const handProblems = checkHandPages(ledger, hand);
    if (values.check) {
      const problems: string[] = [...handProblems];
      for (const [rel, text] of pages) {
        const f = join(out, rel);
        if (!existsSync(f)) problems.push(`missing: ${rel}`);
        else if (readFileSync(f, "utf8").replace(/\r\n/g, "\n") !== text)
          problems.push(`differs: ${rel}`);
      }
      for (const rel of listFiles(out)) if (!pages.has(rel)) problems.push(`stale: ${rel}`);
      if (problems.length > 0) {
        io.err(
          `gen-kb: committed pages differ from the ledger (${problems.length}); run gen-kb.ts\n${problems.slice(0, 20).join("\n")}`,
        );
        return EXIT_FAIL;
      }
      io.out(`gen-kb: ${pages.size} pages match the ledger`);
      return EXIT_OK;
    }
    for (const rel of listFiles(out)) if (!pages.has(rel)) rmSync(join(out, rel));
    for (const [rel, text] of pages) {
      const f = join(out, rel);
      mkdirSync(dirname(f), { recursive: true });
      writeFileSync(f, text);
    }
    io.out(`gen-kb: wrote ${pages.size} pages`);
    if (handProblems.length > 0) {
      io.err(
        `gen-kb: hand pages have ${handProblems.length} problem(s)\n${handProblems.slice(0, 20).join("\n")}`,
      );
      return EXIT_FAIL;
    }
    return EXIT_OK;
  });
}

if (isMainModule(import.meta.url)) process.exitCode = run(process.argv.slice(2));
