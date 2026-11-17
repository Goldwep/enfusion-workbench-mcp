/**
 * E08 — shipped HTML docs (plan 4.5). Reads the Doxygen pages that ship with
 * the Tools (`<tools>/Workbench/docs/**\/Page_*.html`) as files and writes the
 * observation file `data/census/observations/E08/<build>.jsonl`. Nothing under
 * the Tools or game install is executed; the pages are plain HTML text.
 *
 * WHAT IS EXTRACTED (each reading is structural, never a guess at a name):
 *   - cli-switch rows from every table whose first header cell is "Parameter"
 *     and whose heading is not a plugin heading (Page_CLI: the common engine
 *     tables, the Workbench tables, the per-module tables). One row per
 *     distinct switch name; a switch documented in more than one table keeps
 *     the first occurrence, the others are reported as duplicates. A switch
 *     under a "Module: X" heading carries that module; one under any other
 *     heading carries `none` (the page does not say).
 *   - plugin-cli-arg rows from the tables whose heading names a plugin
 *     ("Module: X Plugin: Y"): the arguments that one plugin reads after
 *     `-plugin=`. The page prints the plugin's script class name; it is
 *     resolved through the source index (`src/census/source-index.ts`, built by
 *     E02) to a class carrying a WorkbenchPluginAttribute, by class name first
 *     and by the attribute's `name` argument second. Id form
 *     `plugin:<Class>#cli:-<name>` (one leading dash, name in lower case; the
 *     key keeps the name as the page prints it), parent the plugin row (E03
 *     owns it). Module `none` on the row and on its parent: the heading's
 *     "Module: X" is the module a launch names with -wbModule, not the plugin's
 *     own module, which E03 reads from the plugin's wbModules. A plugin that
 *     does not resolve (or no source index) gives no rows; each argument is
 *     reported in `dropped` and each plugin in `plugins`.
 *   - net-function rows from the built-in function list of the NET API page
 *     (the list that follows "Following list contains all the built-in
 *     function"), with the request and response fields recorded in the row's
 *     `signature`. The ledger has no net-field form for a native function
 *     (`{native, req}` does not exist in ids.ts), so those fields are not rows.
 *   - net-handler and net-field rows from the example script on the same page
 *     (a class extending NetApiHandler, its request and response classes
 *     extending JsonApiStruct, the fields each registers with RegV).
 *
 * WHAT IS NOT EXTRACTED, AND WHY (reported per page, with the reason):
 *   - Page_Menu documents the in-game MenuManager (MenuPreset configuration),
 *     and Page_Input the in-game InputManager (actions, contexts, filters).
 *     Neither lists Workbench menus or Workbench shortcuts, so they yield no
 *     menu, menu-item or shortcut rows. The plan expected otherwise (4.5, E08);
 *     the measurement is the finding.
 *   - Tables nobody consumes (file types, LSP features, language tables) are
 *     listed per page with their header, so a later build that adds a table of
 *     menus or shortcuts is visible in the report instead of silently skipped.
 *
 * Every row's `ref` is `<tools>/Workbench/docs/<relative path>#<anchor>`, where
 * the anchor is an `id` that exists in the page (the nearest `<a class="anchor">`
 * before the table or list). `quote` is at most 200 characters of the page's own
 * text at that place; `what` is a sentence of the same text. Nothing else is
 * copied.
 *
 *   npx tsx scripts/census/enumerators/e08-shipped-docs.ts [--tools <dir>] [--build <tag>]
 *       [--source-index <file>] [--out <file under observations/E08/>] [--data <dir>] [--json]
 *
 * --tools         the Tools install (default: `workbenchPath` of loadConfig())
 * --build         default data/census/current-build.json `tag`
 * --source-index  the E02 source index (default: the artifacts folder's copy for the build)
 *
 * Exit: 0 written; 1 refused (output outside observations/E08/); 2 usage or no
 * docs directory (NO DATA); 3 malformed census configuration.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadConfig } from "../../../src/config.js";
import { compareCodeUnits, jsonlLine, sha256 } from "../../../src/census/canon.js";
import { loadCurrentBuild } from "../../../src/census/census-config.js";
import { allStrings, containsMachinePath } from "../../../src/census/hygiene.js";
import { deriveId } from "../../../src/census/ids.js";
import { writeFileAtomic, type CensusPaths } from "../../../src/census/ledger-io.js";
import { observationSchema, type Observation } from "../../../src/census/schemas.js";
import {
  SOURCE_INDEX_FILE,
  loadSourceIndex,
  sourceIndexPath,
  type SourceIndex,
} from "../../../src/census/source-index.js";
import { MODULES, type Module } from "../../../src/census/vocab.js";
import {
  EXIT_FAIL,
  EXIT_OK,
  EXIT_USAGE,
  PROCESS_IO,
  guard,
  isMainModule,
  pathsFrom,
  type Io,
} from "../cli-common.js";

/** Enumerator id. */
export const ENUMERATOR_ID = "E08";
/** Registered generator path (must equal universes.json `enumerators.E08.generator`). */
export const GENERATOR = "scripts/census/enumerators/e08-shipped-docs.ts";
/** Placeholder root of every ref and input path. */
export const DOCS_ROOT = "<tools>/Workbench/docs";
const QUOTE_MAX = 200;
const WHAT_MAX = 200;

// ── HTML text ─────────────────────────────────────────────────────────────────

const NAMED_ENTITIES: Record<string, string> = {
  lt: "<",
  gt: ">",
  amp: "&",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  rarr: "→",
  larr: "←",
  hellip: "…",
};

/** Decodes the named and numeric entities Doxygen emits. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[A-Za-z]+);/g, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000
        ? String.fromCodePoint(code)
        : whole;
    }
    return NAMED_ENTITIES[body] ?? whole;
  });
}

/** Visible text of an HTML fragment: tags removed, entities decoded, whitespace collapsed. */
export function htmlText(html: string): string {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<[^>]*>/g, ""),
  )
    .replace(/\s+/g, " ")
    .trim();
}

/** Every `id` attribute of the page (the anchors a ref may name). */
export function pageIds(html: string): Set<string> {
  const ids = new Set<string>();
  for (const m of html.matchAll(/\bid="([^"]+)"/g)) ids.add(m[1]);
  return ids;
}

export function pageTitle(html: string): string | undefined {
  const m = /<title>([^<]*)<\/title>/.exec(html);
  return m ? htmlText(m[1]) : undefined;
}

/** First `n` characters, by code point. */
function clip(s: string, n: number): string {
  const chars = Array.from(s);
  return chars.length <= n ? s : chars.slice(0, n).join("");
}

interface AnchorPos {
  pos: number;
  id: string;
  heading: string;
}

function anchorsOf(html: string): AnchorPos[] {
  const out: AnchorPos[] = [];
  for (const m of html.matchAll(/<a class="anchor" id="([^"]+)"><\/a>\s*([^<]*)/g)) {
    out.push({ pos: m.index ?? 0, id: m[1], heading: htmlText(m[2]) });
  }
  return out;
}

function anchorBefore(anchors: readonly AnchorPos[], pos: number): AnchorPos | undefined {
  let found: AnchorPos | undefined;
  for (const a of anchors) {
    if (a.pos < pos) found = a;
    else break;
  }
  return found;
}

// ── Tables ────────────────────────────────────────────────────────────────────

export interface HtmlTable {
  /** Nearest anchor id before the table, when there is one. */
  anchor?: string;
  /** Heading text of that anchor (empty for an anchor that is not a heading). */
  heading: string;
  header: string[];
  rows: { cells: string[]; cellsHtml: string[] }[];
}

/** Every Doxygen markdown table of a page, in document order. */
export function parseTables(html: string): HtmlTable[] {
  const anchors = anchorsOf(html);
  const tables: HtmlTable[] = [];
  for (const t of html.matchAll(/<table class="markdownTable">([\s\S]*?)<\/table>/g)) {
    const at = anchorBefore(anchors, t.index ?? 0);
    const table: HtmlTable = {
      anchor: at?.id,
      heading: at?.heading ?? "",
      header: [],
      rows: [],
    };
    for (const tr of t[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
      const heads = [...tr[1].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) => htmlText(m[1]));
      if (heads.length) {
        table.header = heads;
        continue;
      }
      const cellsHtml = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
      table.rows.push({ cells: cellsHtml.map(htmlText), cellsHtml });
    }
    tables.push(table);
  }
  return tables;
}

// ── Candidates ────────────────────────────────────────────────────────────────

export interface Skipped {
  /** Page-relative file, set by the importer. */
  file: string;
  reason: string;
  text: string;
}

export interface CliCandidate {
  name: string;
  /** Module named by the table's "Module: <name>" heading, `none` when it names none in the vocabulary. */
  module: Module;
  /** Plugin named by the table's "Plugin: <name>" heading, for a plugin argument. */
  plugin?: string;
  /** The parameter cell's text for this switch (forms joined with " / "). */
  usage: string;
  visibility: string;
  description: string;
  /** Row text, cells joined by single spaces. */
  rowText: string;
  anchor?: string;
}

const SWITCH_RE = /^-{1,2}([A-Za-z][A-Za-z0-9_-]*)/;

/**
 * What a CLI table's heading says it documents: a module ("Module: World
 * Editor" names WorldEditor) and, for a plugin table, the plugin ("Module:
 * ResourceManager Plugin: ResavePlugin").
 */
export function tableScope(heading: string): { module: Module; plugin?: string } {
  const mod = /^Module:\s*(.+?)(?=\s+Plugin:|\s*$)/.exec(heading)?.[1]?.replace(/\s+/g, "");
  const plugin = /\bPlugin:\s*(\S+)/.exec(heading)?.[1];
  const module = (MODULES as readonly string[]).includes(mod ?? "") ? (mod as Module) : "none";
  return { module, plugin };
}

/**
 * Switch candidates of every table whose first header cell is "Parameter".
 * Candidates of a plugin table go to `pluginArgs`, the rest to `switches`.
 * `tablesUsed` counts every such table.
 */
export function extractCliTables(html: string): {
  switches: CliCandidate[];
  pluginArgs: CliCandidate[];
  skipped: Omit<Skipped, "file">[];
  tablesUsed: number;
} {
  const switches: CliCandidate[] = [];
  const pluginArgs: CliCandidate[] = [];
  const skipped: Omit<Skipped, "file">[] = [];
  let tablesUsed = 0;
  for (const t of parseTables(html)) {
    if (!/^parameter$/i.test(t.header[0] ?? "")) continue;
    tablesUsed++;
    const scope = tableScope(t.heading);
    const col = (re: RegExp): number => t.header.findIndex((h) => re.test(h));
    const visCol = col(/^visibility$/i);
    const descCol = col(/^description$/i);
    for (const r of t.rows) {
      const spans = [
        ...(r.cellsHtml[0] ?? "").matchAll(/<span class="tt">([\s\S]*?)<\/span>/g),
      ].map((m) => htmlText(m[1]));
      const forms = spans.length ? spans : (r.cells[0] ?? "").split(/\s+\/\s+/).filter(Boolean);
      const byName = new Map<string, string[]>();
      for (const form of forms) {
        const m = SWITCH_RE.exec(form);
        if (!m) {
          skipped.push({ reason: "parameter cell is not a switch", text: clip(form, 80) });
          continue;
        }
        byName.set(m[1], [...(byName.get(m[1]) ?? []), form]);
      }
      const rowText = r.cells.filter((c) => c !== "").join(" ");
      for (const [name, used] of byName) {
        (scope.plugin ? pluginArgs : switches).push({
          name,
          module: scope.module,
          plugin: scope.plugin,
          usage: used.join(" / "),
          visibility: visCol >= 0 ? (r.cells[visCol] ?? "") : "",
          description: descCol >= 0 ? (r.cells[descCol] ?? "") : "",
          rowText,
          anchor: t.anchor,
        });
      }
    }
  }
  return { switches, pluginArgs, skipped, tablesUsed };
}

// ── NET API page ──────────────────────────────────────────────────────────────

export interface FieldDoc {
  name: string;
  /** The type word the page gives in quotes ("string", "bool"); `[]` for an array, `{}` for an object. */
  type?: string;
  /** The bare value the page writes instead of a type word (`false`, `147`). */
  example?: string;
  comment?: string;
  /** Name of the containing field for a nested field. */
  parent?: string;
}

export interface NetFunctionDoc {
  name: string;
  request: FieldDoc[];
  response: FieldDoc[];
  /** The page's own line that best shows the function (first line with a comment). */
  quoteLine: string;
  anchor?: string;
}

const FIELD_LINE = /^"([^"]+)"\s*:\s*("(?:[^"\\]|\\.)*"|\[|\{|[^,\s/]+)\s*,?\s*(?:\/\/\s*(.*))?$/;

/** Lines (visible text) of every code fragment inside `html`, with the fragment's offset. */
function fragmentLines(html: string): { pos: number; lines: string[] }[] {
  const out: { pos: number; lines: string[] }[] = [];
  for (const f of html.matchAll(/<div class="fragment">([\s\S]*?)<\/div><!-- fragment -->/g)) {
    out.push({
      pos: f.index ?? 0,
      lines: [...f[1].matchAll(/<div class="line">([\s\S]*?)<\/div>/g)].map((l) => htmlText(l[1])),
    });
  }
  return out;
}

/**
 * Reads one JSON-with-comments example: the top-level fields and the nested
 * ones (with their container's name).
 */
export function parseJsonish(lines: readonly string[]): FieldDoc[] {
  const fields: FieldDoc[] = [];
  const stack: string[] = [];
  for (const raw of lines) {
    const t = raw.trim();
    if (t === "" || t.startsWith("//")) continue;
    if (/^[}\]],?$/.test(t)) {
      stack.pop();
      continue;
    }
    if (/^[{[]$/.test(t)) {
      stack.push(stack.length ? stack[stack.length - 1] : "");
      continue;
    }
    const m = FIELD_LINE.exec(t);
    if (!m) continue;
    const [, name, value, comment] = m;
    const field: FieldDoc = { name };
    if (value.startsWith('"')) field.type = value.slice(1, -1);
    else if (value === "[") field.type = "[]";
    else if (value === "{") field.type = "{}";
    else field.example = value;
    if (comment) field.comment = comment.trim();
    if (stack.length > 1) field.parent = stack[stack.length - 1];
    fields.push(field);
    if (value === "[" || value === "{") stack.push(name);
  }
  return fields;
}

const FUNCTION_LIST_MARKER = "Following list contains all the built-in function";

/**
 * The page's own text that shows a function with its first commented line:
 * the request lines from `"APIFunc"` through the first comment, or, when the
 * request has none, the text from the function name through the first comment
 * of the response. Always a contiguous stretch of the page.
 */
function functionQuote(name: string, req: readonly string[], resp: readonly string[]): string {
  const commented = (l: string): boolean => /\/\/\s*\S/.test(l);
  const r = req.map((l) => l.trim()).filter((l) => l !== "");
  const ri = r.findIndex(commented);
  if (ri !== -1) {
    const start = Math.max(
      0,
      r.findIndex((l) => l.startsWith('"APIFunc"')),
    );
    return r.slice(start <= ri ? start : 0, ri + 1).join(" ");
  }
  const p = resp.map((l) => l.trim()).filter((l) => l !== "");
  const pi = p.findIndex(commented);
  if (pi !== -1) {
    return [name, "required parameters for input:", ...r, "response:", ...p.slice(0, pi + 1)].join(
      " ",
    );
  }
  return name;
}

/** The built-in functions of the NET API page, in page order. */
export function extractNetFunctions(html: string): NetFunctionDoc[] {
  const start = html.indexOf(FUNCTION_LIST_MARKER);
  if (start === -1) return [];
  const anchor = anchorBefore(anchorsOf(html), start)?.id;
  const rest = html.slice(start);
  const end = rest.search(/<h[12] class="doxsection"><a class="anchor"/);
  const region = end === -1 ? rest : rest.slice(0, end);
  const out: NetFunctionDoc[] = [];
  for (const item of region.split("<li><b>").slice(1)) {
    const name = htmlText(item.slice(0, item.indexOf("</b>")));
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue;
    const body = item.slice(item.indexOf("</b>"));
    const split = body.search(/<li>\s*response:/i);
    const reqHtml = split === -1 ? body : body.slice(0, split);
    const respHtml = split === -1 ? "" : body.slice(split);
    const req = fragmentLines(reqHtml).flatMap((f) => f.lines);
    const resp = fragmentLines(respHtml).flatMap((f) => f.lines);
    const selector = (f: FieldDoc): boolean => f.name === "APIFunc";
    out.push({
      name,
      request: parseJsonish(req).filter((f) => !selector(f)),
      response: parseJsonish(resp),
      quoteLine: functionQuote(name, req, resp),
      anchor,
    });
  }
  return out;
}

export interface NetExampleDoc {
  handler: string;
  handlerBase: string;
  /** The comment line immediately above the handler class, when there is one. */
  comment?: string;
  requestClass: string;
  responseClass: string;
  requestFields: { name: string; type: string }[];
  responseFields: { name: string; type: string }[];
  anchor?: string;
}

function matchBrace(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return i;
  }
  return -1;
}

/** The example NetApiHandler of the NET API page, with the fields its two structs register. */
export function extractNetExample(html: string): NetExampleDoc | undefined {
  const anchors = anchorsOf(html);
  for (const fragment of fragmentLines(html)) {
    const text = fragment.lines.join("\n");
    if (!/:\s*NetApiHandler\b/.test(text)) continue;
    const classes = new Map<string, { base: string; body: string; start: number }>();
    for (const m of text.matchAll(/\bclass\s+(\w+)\s*:\s*(\w+)\s*\n?\s*\{/g)) {
      const open = (m.index ?? 0) + m[0].lastIndexOf("{");
      const close = matchBrace(text, open);
      if (close === -1) continue;
      classes.set(m[1], { base: m[2], body: text.slice(open + 1, close), start: m.index ?? 0 });
    }
    const handlerEntry = [...classes].find(([, c]) => c.base === "NetApiHandler");
    if (!handlerEntry) continue;
    const [handler, hc] = handlerEntry;
    const structs = new Set(
      [...classes].filter(([, c]) => c.base === "JsonApiStruct").map(([n]) => n),
    );
    const getRequest = /GetRequest\s*\([^)]*\)[\s\S]*?\breturn\s+new\s+(\w+)/.exec(hc.body)?.[1];
    const respBody = /GetResponse\s*\([^)]*\)([\s\S]*)/.exec(hc.body)?.[1] ?? "";
    const getResponse = [...respBody.matchAll(/\bnew\s+(\w+)\s*\(/g)]
      .map((m) => m[1])
      .find((n) => structs.has(n));
    if (!getRequest || !getResponse || !structs.has(getRequest)) continue;
    const fieldsOf = (cls: string): { name: string; type: string }[] => {
      const body = classes.get(cls)?.body ?? "";
      const registered = new Set([...body.matchAll(/\bRegV\(\s*"(\w+)"/g)].map((m) => m[1]));
      const out: { name: string; type: string }[] = [];
      for (const m of body.matchAll(/^\s*([A-Za-z_][\w<>]*)\s+(\w+)\s*;/gm)) {
        if (registered.has(m[2])) out.push({ name: m[2], type: m[1] });
      }
      return out;
    };
    const before = text.slice(0, hc.start);
    const comment = /(?:^|\n)[ \t]*\/\/[ \t]*([^\n]*)\s*$/.exec(before)?.[1]?.trim();
    return {
      handler,
      handlerBase: hc.base,
      comment: comment || undefined,
      requestClass: getRequest,
      responseClass: getResponse,
      requestFields: fieldsOf(getRequest),
      responseFields: fieldsOf(getResponse),
      anchor: anchorBefore(anchors, fragment.pos)?.id,
    };
  }
  return undefined;
}

// ── Page classification ───────────────────────────────────────────────────────

/**
 * What each shipped page holds, read from the pages at build 1.8.0.13. A page
 * that is not in this table is reported as "unclassified" so a later build's
 * new page is noticed.
 */
export const PAGE_CONTENT: Record<string, string> = {
  "Page_CLI.html":
    "command line switches: common engine tables, Workbench tables, per-module and per-plugin tables",
  "Page_Enforce.html": "index of the Enforce language pages (link table only)",
  "Page_Enforce_CodingGuidelines.html": "script coding guidelines (prose and code samples)",
  "Page_Enforce_EnforceScriptARC.html": "automatic reference counting (prose)",
  "Page_Enforce_Syntax.html": "language syntax: type, operator and directive tables",
  "Page_Enforce_Syntax_Keywords.html": "language keywords (prose and code samples)",
  "Page_Enforce_Syntax_Operators.html": "operator table (C/C++ name, Enforce alternative)",
  "Page_Enforce_Syntax_Values.html":
    "value type table (name, C++ equivalent, range, default, size)",
  "Page_EventSystem.html": "script event system: providers and receivers (prose and code)",
  "Page_FileTypes.html": "file type table (extension, type, saved by, description, comment)",
  "Page_Input.html":
    "in-game InputManager: actions, contexts, filters, device handlers (game runtime, not Workbench shortcuts)",
  "Page_LSP.html": "language server setup steps and index of the LSP pages",
  "Page_LSP_Features.html": "LSP server feature table and go-to table (protocol capabilities)",
  "Page_LSP_Neovim.html": "Neovim client configuration (client-side editor keys)",
  "Page_LSP_VSCode.html": "Visual Studio Code client configuration (client-side editor keys)",
  "Page_Menu.html":
    "in-game MenuManager and MenuBase: MenuPreset configuration (game runtime, not Workbench menus)",
  "Page_NetApi.html":
    "Workbench NET API: protocol, built-in functions with request and response JSON, example NetApiHandler",
  "Page_Replication.html": "replication system (prose, code and RplRcver tables)",
  "Page_Replication_EntitiesAndComponents.html":
    "replicating entities, components and hierarchies (prose)",
  "Page_Replication_LoadtimeAndRuntime.html": "loadtime and runtime replication (prose)",
  "Page_Replication_RplNode.html": "RplNode (prose)",
  "Page_System_ScriptTestingFramework.html": "script testing framework (prose and code)",
  "Page_WorldSystems.html":
    "world systems tutorial: prose, code, a multiplayer-mode table; mentions Workbench menu paths in prose only",
};

export interface PageReport {
  /** Path relative to the docs root. */
  file: string;
  title?: string;
  content: string;
  tables: number;
  tablesUsed: number;
  /** Header of every table no extractor reads. */
  unreadTables: string[];
  /** Body rows of those tables, in the same order. */
  unreadRows: number[];
  /** Argument occurrences in plugin tables (before the duplicate and resolution checks). */
  pluginArgs: number;
  rows: number;
  /** Why the page yielded no row (set only when `rows` is 0). */
  reason?: string;
}

export interface Dropped {
  file: string;
  reason: string;
  text: string;
}

export interface DirCount {
  dir: string;
  html: number;
  pages: number;
}

/** How one "Plugin: X" heading of the CLI page resolved through the source index. */
export interface PluginResolution {
  /** The name the heading prints. */
  plugin: string;
  /** The script class it resolved to (absent when it did not). */
  class?: string;
  how?: "class-name" | "display-name";
  /** Why it did not resolve. */
  reason?: string;
  /** Argument occurrences under headings that name it. */
  args: number;
}

export interface ImportResult {
  observations: { id: string; obs: Observation }[];
  pages: PageReport[];
  dropped: Dropped[];
  /** One entry per distinct plugin name the CLI tables print, in page order. */
  plugins: PluginResolution[];
  inventory: DirCount[];
  inputs: { path: string; sha256: string }[];
}

/** The source index and its header input, as `importDocs` takes them. */
export interface SourceIndexInput {
  index: SourceIndex;
  /** Header input for the index file (placeholder path, sha256 over its bytes). */
  input?: { path: string; sha256: string };
}

// ── Plugin class resolution ───────────────────────────────────────────────────

/** Splits attribute argument text at top-level commas (strings and braces respected). */
function splitTopLevel(args: string): string[] {
  const out: string[] = [];
  let cur = "";
  let depth = 0;
  let inStr = false;
  for (let i = 0; i < args.length; i++) {
    const ch = args[i];
    if (inStr) {
      cur += ch;
      if (ch === "\\" && i + 1 < args.length) cur += args[++i];
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{" || ch === "(" || ch === "[") depth++;
    else if (ch === "}" || ch === ")" || ch === "]") depth--;
    else if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim() !== "") out.push(cur.trim());
  return out;
}

/** The `name` argument of a WorkbenchPluginAttribute: `name: "X"` anywhere, else a leading positional string. */
export function pluginDisplayName(args: string | undefined): string | undefined {
  if (!args) return undefined;
  const parts = splitTopLevel(args);
  for (const p of parts) {
    const m = /^name\s*:\s*"((?:[^"\\]|\\.)*)"$/.exec(p);
    if (m) return m[1];
  }
  const first = /^"((?:[^"\\]|\\.)*)"$/.exec(parts[0] ?? "");
  return first?.[1];
}

const PLUGIN_ATTRIBUTES = new Set(["WorkbenchPluginAttribute", "WorkbenchPlugin"]);

function carriesPluginAttribute(index: SourceIndex, cls: string): boolean {
  return (index.classes.get(cls)?.attributes ?? []).some((a) => PLUGIN_ATTRIBUTES.has(a.name));
}

/**
 * The script class a "Plugin: X" heading names: the class called X when it
 * carries a WorkbenchPluginAttribute, else the one class carrying the attribute
 * whose `name` argument is X. Anything else (no class, a class without the
 * attribute, two display-name matches) does not resolve.
 */
export function resolvePluginClass(
  index: SourceIndex,
  plugin: string,
): { class: string; how: "class-name" | "display-name" } | { reason: string } {
  if (carriesPluginAttribute(index, plugin)) return { class: plugin, how: "class-name" };
  const byName: string[] = [];
  for (const [name, c] of index.classes) {
    if (
      !c.attributes.some(
        (a) => PLUGIN_ATTRIBUTES.has(a.name) && pluginDisplayName(a.args) === plugin,
      )
    )
      continue;
    byName.push(name);
  }
  if (byName.length === 1) return { class: byName[0], how: "display-name" };
  if (byName.length > 1) {
    return {
      reason: `ambiguous: ${byName.length} plugin classes carry the name "${plugin}" (${byName.sort(compareCodeUnits).join(", ")})`,
    };
  }
  return {
    reason: index.classes.has(plugin)
      ? `class ${plugin} exists but carries no WorkbenchPluginAttribute`
      : `no class named ${plugin} and no WorkbenchPluginAttribute with that name`,
  };
}

// ── Walking the docs directory ────────────────────────────────────────────────

function walkHtml(dir: string, base: string, out: string[]): void {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) walkHtml(full, base, out);
    else if (e.isFile() && e.name.toLowerCase().endsWith(".html")) {
      out.push(relative(base, full).split("\\").join("/"));
    }
  }
}

/** Every `.html` under the docs directory (relative, forward slashes, code-unit order). */
export function listHtml(docsDir: string): string[] {
  const out: string[] = [];
  walkHtml(docsDir, docsDir, out);
  return out.sort(compareCodeUnits);
}

/** `.html` files per directory, with how many of them are `Page_*.html`. */
export function inventoryOf(files: readonly string[]): DirCount[] {
  const counts = new Map<string, DirCount>();
  for (const f of files) {
    const i = f.lastIndexOf("/");
    const dir = i === -1 ? "." : f.slice(0, i);
    const c = counts.get(dir) ?? { dir, html: 0, pages: 0 };
    c.html++;
    if (/^Page_[^/]*\.html$/.test(f.slice(i + 1))) c.pages++;
    counts.set(dir, c);
  }
  return [...counts.values()].sort((a, b) => compareCodeUnits(a.dir, b.dir));
}

// ── Rows ──────────────────────────────────────────────────────────────────────

function refOf(file: string, anchor: string | undefined): string {
  return `${DOCS_ROOT}/${file}${anchor ? `#${anchor}` : ""}`;
}

/** A sentence of `text`, at most `WHAT_MAX` characters (cut at a word, marked with "..."). */
export function sentenceOf(text: string): string | undefined {
  const t = text.trim();
  if (!t) return undefined;
  const first = /^.*?[.!?](?=\s+[A-Z(]|$)/.exec(t)?.[0] ?? t;
  if (Array.from(first).length <= WHAT_MAX) return first;
  const cut = clip(first, WHAT_MAX - 3);
  const at = cut.lastIndexOf(" ");
  return `${at > 0 ? cut.slice(0, at) : cut}...`;
}

type Candidate = { id: string; obs: Observation };

function finish(
  draft: Observation,
  file: string,
  dropped: Dropped[],
  ids: Set<string>,
  anchor: string | undefined,
): Candidate | undefined {
  const drop = (reason: string): undefined => {
    dropped.push({ file, reason, text: clip(draft.quote ?? draft.label ?? "", 80) });
    return undefined;
  };
  if (anchor !== undefined && !ids.has(anchor)) return drop(`anchor ${anchor} is not in the page`);
  if (allStrings(draft).some(containsMachinePath)) return drop("row contains a machine path");
  const parsed = observationSchema.safeParse(draft);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return drop(`observation invalid: ${i.path.join(".")}: ${i.message}`);
  }
  try {
    return { id: deriveId(parsed.data), obs: parsed.data };
  } catch (e) {
    return drop(e instanceof Error ? e.message : String(e));
  }
}

/**
 * Cuts `text` before the first drive-letter path it holds (a page example such
 * as `-saveDir` followed by a drive path), so the quote keeps the page's words
 * without a machine path. Text with no such path is returned unchanged.
 */
export function cutAtMachinePath(text: string): string {
  if (!containsMachinePath(text)) return text;
  const m = /[A-Za-z]:[\\/]/.exec(text);
  return m ? text.slice(0, m.index).trimEnd() : text;
}

/**
 * The row's module is the one the table's "Module: X" heading names, `none`
 * under any other heading. `none` is no claim, so it never conflicts with the
 * module another enumerator (E05's executable string table, which cannot say
 * one) states for the same id (ledger rule after DEC-020).
 */
function cliObservation(c: CliCandidate, file: string): Observation {
  const what = sentenceOf(cutAtMachinePath(c.description));
  return {
    dim: "cli",
    kind: "cli-switch",
    module: c.module,
    key: { switch: c.name },
    parent_key: null,
    label: `-${c.name}`,
    signature: clip(c.usage, 200),
    what,
    origin: "vanilla",
    ref: refOf(file, c.anchor),
    quote: clip(cutAtMachinePath(c.rowText), QUOTE_MAX),
    confidence: "high",
    paths_proposed: [{ path: "cli" }],
  };
}

/**
 * One argument of a plugin, from the CLI page's per-plugin table. The key is
 * `{class, cli}` (id `plugin:<Class>#cli:-<lower-cased name>`), the parent the plugin row
 * itself, which E03 emits from the script source. `plugin` is the resolved
 * script class, never the name the page prints.
 */
function pluginCliObservation(
  c: CliCandidate,
  pluginClass: string,
  file: string,
  note?: string,
): Observation {
  const what = sentenceOf(cutAtMachinePath(c.description));
  // Module `none`: the page's "Module: X" heading is the module the launch
  // names with -wbModule, not the plugin's own module. That comes from the
  // plugin's wbModules attribute, which E03 reads (main-session ruling).
  return {
    dim: "plugin",
    kind: "plugin-cli-arg",
    module: "none",
    key: { class: pluginClass, cli: c.name },
    parent_key: {
      dim: "plugin",
      kind: "plugin",
      module: "none",
      key: { class: pluginClass },
    },
    label: `-${c.name}`,
    signature: clip(c.usage, 200),
    what,
    origin: "vanilla",
    ref: refOf(file, c.anchor),
    quote: clip(cutAtMachinePath(c.rowText), QUOTE_MAX),
    confidence: "high",
    ...(note ? { unverified: [note] } : {}),
  };
}

function signatureOfFunction(f: NetFunctionDoc): string {
  const part = (x: FieldDoc): string =>
    x.type ? `${x.name}: ${x.type}` : x.example ? `${x.name}: ${x.example}` : x.name;
  const req = f.request.filter((x) => !x.parent).map(part);
  const resp = f.response.filter((x) => !x.parent).map(part);
  return clip(`${f.name}(${req.join(", ")}) -> {${resp.join(", ")}}`, 200);
}

function netFunctionObservation(f: NetFunctionDoc, file: string): Observation {
  return {
    dim: "net",
    kind: "net-function",
    module: "none",
    key: { native: f.name },
    parent_key: null,
    label: f.name,
    signature: signatureOfFunction(f),
    origin: "vanilla",
    ref: refOf(file, f.anchor),
    quote: clip(f.quoteLine, QUOTE_MAX),
    confidence: "high",
    paths_proposed: [{ path: "builtin-net-handler", reason: "documented as a built-in APIFunc" }],
  };
}

function netExampleObservations(e: NetExampleDoc, file: string): Observation[] {
  const ref = refOf(file, e.anchor);
  const handlerKey = { handler: e.handler };
  const parent = {
    dim: "net" as const,
    kind: "net-handler" as const,
    module: "none" as const,
    key: handlerKey,
  };
  const handler: Observation = {
    dim: "net",
    kind: "net-handler",
    module: "none",
    key: handlerKey,
    parent_key: null,
    label: e.handler,
    signature: `${e.handler} : ${e.handlerBase}`,
    what: e.comment,
    origin: "vanilla",
    ref,
    quote: clip(
      `${e.comment ? `// ${e.comment} ` : ""}class ${e.handler} : ${e.handlerBase}`,
      QUOTE_MAX,
    ),
    confidence: "medium",
    children_count: e.requestFields.length + e.responseFields.length,
    unverified: [
      "the class is an example script on the NET API page; whether it exists in the build is for the pak read (E04)",
    ],
  };
  const field = (f: { name: string; type: string }, side: "req" | "resp"): Observation => ({
    dim: "net",
    kind: "net-field",
    module: "none",
    key:
      side === "req" ? { handler: e.handler, req: f.name } : { handler: e.handler, resp: f.name },
    parent_key: parent,
    label: f.name,
    signature: `${f.type} ${f.name}`,
    origin: "vanilla",
    ref,
    quote: `${f.type} ${f.name};`,
    confidence: "medium",
  });
  return [
    handler,
    ...e.requestFields.map((f) => field(f, "req")),
    ...e.responseFields.map((f) => field(f, "resp")),
  ];
}

// ── Import ────────────────────────────────────────────────────────────────────

/**
 * Reads every `Page_*.html` under `docsDir`. Pure apart from reading files.
 * `sourceIndex` resolves the plugin names of the per-plugin CLI tables to
 * script classes; without it those arguments give no rows.
 */
export function importDocs(docsDir: string, sourceIndex?: SourceIndexInput): ImportResult {
  const files = listHtml(docsDir);
  const pageFiles = files.filter((f) => /^Page_[^/]*\.html$/.test(f.slice(f.lastIndexOf("/") + 1)));
  const observations: Candidate[] = [];
  const seen = new Map<string, string>();
  const pages: PageReport[] = [];
  const dropped: Dropped[] = [];
  const plugins = new Map<string, PluginResolution>();
  const inputs: { path: string; sha256: string }[] = [];

  const add = (c: Candidate | undefined, file: string): boolean => {
    if (!c) return false;
    const prior = seen.get(c.id);
    if (prior) {
      dropped.push({
        file,
        reason: `same key as ${prior} (${c.id}); the first occurrence is kept`,
        text: clip(c.obs.quote ?? "", 80),
      });
      return false;
    }
    seen.set(c.id, c.obs.ref);
    observations.push(c);
    return true;
  };

  for (const file of pageFiles) {
    const raw = readFileSync(join(docsDir, file));
    const html = raw.toString("utf-8");
    inputs.push({ path: `${DOCS_ROOT}/${file}`, sha256: sha256(raw) });
    const ids = pageIds(html);
    const tables = parseTables(html);
    const base = file.slice(file.lastIndexOf("/") + 1);
    const report: PageReport = {
      file,
      title: pageTitle(html),
      content: PAGE_CONTENT[base] ?? "unclassified",
      tables: tables.length,
      tablesUsed: 0,
      unreadTables: [],
      unreadRows: [],
      pluginArgs: 0,
      rows: 0,
    };

    const cli = extractCliTables(html);
    report.tablesUsed += cli.tablesUsed;
    for (const s of cli.skipped) dropped.push({ file, ...s });
    for (const c of cli.switches) {
      if (add(finish(cliObservation(c, file), file, dropped, ids, c.anchor), file)) report.rows++;
    }
    // Where the page documents one plugin argument under several modules, the first
    // table's row is kept and says so.
    const modulesOf = new Map<string, Set<string>>();
    for (const c of cli.pluginArgs) {
      const k = `${c.plugin}\u0000${c.name}`;
      modulesOf.set(k, (modulesOf.get(k) ?? new Set()).add(c.module));
    }
    for (const c of cli.pluginArgs) {
      report.pluginArgs++;
      const name = c.plugin ?? "";
      let res = plugins.get(name);
      if (!res) {
        const r = sourceIndex ? resolvePluginClass(sourceIndex.index, name) : undefined;
        res = {
          plugin: name,
          args: 0,
          ...(r === undefined
            ? { reason: "no source index: run E02 first (or pass --source-index)" }
            : "class" in r
              ? { class: r.class, how: r.how }
              : { reason: r.reason }),
        };
        plugins.set(name, res);
      }
      res.args++;
      if (!res.class) {
        dropped.push({
          file,
          reason: `plugin argument of ${name || "?"} left out, plugin does not resolve to a script class (${res.reason}): -${c.name}`,
          text: clip(cutAtMachinePath(c.rowText), 80),
        });
        continue;
      }
      const also = [...(modulesOf.get(`${c.plugin}\u0000${c.name}`) ?? [])].filter(
        (m) => m !== c.module,
      );
      const note = also.length
        ? `the page documents this argument of ${res.class} under module ${also.join(", ")} as well; the first table is kept`
        : undefined;
      if (
        add(
          finish(pluginCliObservation(c, res.class, file, note), file, dropped, ids, c.anchor),
          file,
        )
      )
        report.rows++;
    }

    for (const f of extractNetFunctions(html)) {
      if (add(finish(netFunctionObservation(f, file), file, dropped, ids, f.anchor), file))
        report.rows++;
    }
    const example = extractNetExample(html);
    if (example) {
      for (const o of netExampleObservations(example, file)) {
        if (add(finish(o, file, dropped, ids, example.anchor), file)) report.rows++;
      }
    }

    const unread = tables.filter((t) => !/^parameter$/i.test(t.header[0] ?? ""));
    report.unreadTables = unread.map((t) => t.header.join(" | "));
    report.unreadRows = unread.map((t) => t.rows.length);
    if (report.rows === 0) {
      report.reason =
        PAGE_CONTENT[base] === undefined
          ? "unclassified page: no extractor matched"
          : `no extractor applies: ${PAGE_CONTENT[base]}`;
    }
    pages.push(report);
  }
  if (sourceIndex?.input && plugins.size > 0) inputs.push(sourceIndex.input);
  observations.sort((a, b) => compareCodeUnits(a.id, b.id));
  return {
    observations,
    pages,
    dropped,
    plugins: [...plugins.values()],
    inventory: inventoryOf(files),
    inputs,
  };
}

/** Exact text of the E08 observation file. */
export function observationFileText(result: ImportResult, build: string): string {
  const header = {
    $header: 1,
    build,
    enumerator: ENUMERATOR_ID,
    generator: GENERATOR,
    inputs: result.inputs,
    provisional: false,
    row_count: result.observations.length,
  };
  const lines = [
    jsonlLine(header, ["$header"]),
    ...result.observations.map((o) => jsonlLine(o.obs)),
  ];
  return lines.join("\n") + "\n";
}

// ── CLI ───────────────────────────────────────────────────────────────────────

const USAGE =
  "usage: e08-shipped-docs.ts [--tools <dir>] [--build <tag>] [--source-index <file>] [--out <file under observations/E08/>] [--data <dir>] [--json]";

/**
 * The E02 source index for `build` (the given file, else the artifacts
 * folder's copy) with its header input; undefined when there is none.
 */
export function loadIndexInput(build: string, file?: string): SourceIndexInput | undefined {
  const opts = file ? { file: resolve(file) } : {};
  const index = loadSourceIndex(build, opts);
  if (!index) return undefined;
  const path = file ? resolve(file) : sourceIndexPath(build);
  return {
    index,
    input: {
      path: `<artifacts>/census/${build}/E02/${SOURCE_INDEX_FILE}`,
      sha256: sha256(readFileSync(path)),
    },
  };
}

/** Resolves `--out`, refusing anything outside `<census>/observations/E08/`. */
export function resolveOut(paths: CensusPaths, out: string | undefined, build: string): string {
  const dir = join(paths.observations, ENUMERATOR_ID);
  const file = out ? resolve(out) : join(dir, `${build}.jsonl`);
  if (dirname(file) !== dir || !file.endsWith(".jsonl")) {
    throw new Error(
      "refusing --out outside observations/E08/ (E08 writes only its own observation directory)",
    );
  }
  return file;
}

export function run(argv: string[], io: Io = PROCESS_IO): number {
  return guard(io, "e08-shipped-docs", () => {
    const { values } = parseArgs({
      args: argv,
      options: {
        tools: { type: "string" },
        build: { type: "string" },
        out: { type: "string" },
        "source-index": { type: "string" },
        data: { type: "string" },
        json: { type: "boolean" },
        help: { type: "boolean" },
      },
      strict: true,
    });
    if (values.help) {
      io.out(USAGE);
      return EXIT_OK;
    }
    const paths = pathsFrom(values.data);
    const build = values.build ?? loadCurrentBuild(paths).tag;
    let out: string;
    try {
      out = resolveOut(paths, values.out, build);
    } catch (e) {
      io.err(`e08-shipped-docs: ${e instanceof Error ? e.message : String(e)}`);
      return EXIT_FAIL;
    }
    const tools = values.tools ? resolve(values.tools) : loadConfig().workbenchPath;
    const docsDir = join(tools, "Workbench", "docs");
    if (!existsSync(docsDir)) {
      io.out("NO DATA: no <tools>/Workbench/docs directory; nothing read");
      return EXIT_USAGE;
    }
    const sourceIndex = loadIndexInput(build, values["source-index"]);
    if (!sourceIndex) {
      io.err(
        `e08-shipped-docs: no source index for build ${build}; plugin-cli-arg rows are left out (run E02 first, or pass --source-index)`,
      );
    }
    const result = importDocs(docsDir, sourceIndex);
    mkdirSync(dirname(out), { recursive: true });
    writeFileAtomic(out, observationFileText(result, build));

    const byKind = new Map<string, number>();
    for (const o of result.observations) byKind.set(o.obs.kind, (byKind.get(o.obs.kind) ?? 0) + 1);
    const pageCount = result.pages.length;
    const emitted = result.observations.length;
    if (values.json) {
      io.out(
        JSON.stringify({
          ok: true,
          command: "e08-shipped-docs",
          build,
          page_files: pageCount,
          emitted,
          by_kind: Object.fromEntries([...byKind].sort(([a], [b]) => compareCodeUnits(a, b))),
          inventory: result.inventory,
          pages: result.pages,
          plugins: result.plugins,
          dropped: result.dropped,
        }),
      );
      return EXIT_OK;
    }
    for (const d of result.inventory) {
      io.out(`html ${d.dir}: ${d.html} files, ${d.pages} Page_*.html`);
    }
    for (const p of result.pages) {
      io.out(
        `${p.file}: ${p.content}; tables ${p.tables} (read ${p.tablesUsed}, unread ${p.unreadTables.length} with ` +
          `${p.unreadRows.reduce((a, b) => a + b, 0)} body rows), plugin args read ${p.pluginArgs}, rows ${p.rows}` +
          `${p.reason ? ` [${p.reason}]` : ""}`,
      );
    }
    for (const p of result.plugins) {
      io.out(
        `plugin ${p.plugin}: ${p.class ? `class ${p.class} (by ${p.how})` : `not resolved (${p.reason})`}, ${p.args} argument${p.args !== 1 ? "s" : ""}`,
      );
    }
    for (const d of result.dropped) io.out(`dropped ${d.file}: ${d.reason} (${d.text})`);
    io.out(
      `E08 at build ${build}: ${emitted} observation${emitted !== 1 ? "s" : ""} from ${pageCount} Page_*.html ` +
        `(${[...byKind].map(([k, n]) => `${k} ${n}`).join(", ")}), ${result.dropped.length} dropped`,
    );
    return EXIT_OK;
  });
}

if (isMainModule(import.meta.url)) process.exitCode = run(process.argv.slice(2));
