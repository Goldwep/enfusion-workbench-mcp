/**
 * E07 — wiki tables and structure (plan 4.5). Reads `data/wiki/export.xml`, a
 * MediaWiki Special:Export file of the Bohemia community wiki (cached
 * 2026-05-21). Its raw wikitext keeps the tables that `data/wiki/pages.json`
 * strips. Nothing is fetched; nothing is executed.
 *
 * What it writes
 *  - `data/census/observations/E07/<build>.jsonl`: menu, menu-item, shortcut,
 *    panel, toolbar, toolbar-button, tab, tool, dialog, control, option,
 *    canvas-gesture, context-menu, context-item, debug-panel, cli-switch,
 *    file-type, link-format and diag-menu rows (kinds and dims come from the E07
 *    entry of `universes.json`; a row of any other kind is counted as blocked,
 *    never written).
 *  - Outside the repository (the artifacts folder, `census/<build>/E07/`):
 *    `page-decisions.json` (one in-scope or out-of-scope decision with its
 *    reason for every page of the export) and `report.json` (every table with
 *    the spec that mapped it or the reason it was skipped, every row not
 *    emitted and why, and `unmapped_sections`: sections of pages that emitted
 *    rows which hold list items or bold-led lines no row cites).
 *
 * How it reads
 *  1. `parseExport` / `parseWikitext`: pages, headings with MediaWiki anchors,
 *     tables (header, rowspan and colspan cells, templates and links in cells,
 *     headings inside cells, nested tables), bullet and definition lists.
 *  2. Mappers (`mapMenuTable`, `mapContextTable`, `mapColumnsTable`,
 *     `mapBullets`, `mapHeadings`, `mapFileTypes`, `mapCliHeadings`,
 *     `mapLinks`, `mapCurated`...) turn one table, list or section into rows.
 *  3. `SPECS` says which mapper runs on which page, section or table, with the
 *     module taken from the page title. Nothing is guessed from content: a
 *     table the specs do not name is skipped, with a reason.
 *  4. `finalize` derives parents (a parent of a blocked kind is replaced by the
 *     nearest emitted ancestor), sets `children_count` only where every child
 *     is emitted by the same spec, and validates each line against the ledger
 *     schema.
 *  5. `checkRows` is the gate: every ref resolves to a page and a section (or
 *     table index) that exist in the export, every quote is verbatim page text.
 *
 * Identity notes
 *  - ref: `wiki:<Page_title>#<heading anchor>`; a table with no heading above
 *    it uses `#table-<n>`; a row from the lead section has no fragment.
 *  - A literal `&` in a label is written `&&` in the key (ids.ts removes a
 *    single `&` as a mnemonic marker), so ids keep "Info & Diags".
 *  - Module: UI rows take the module of the page title. cli-switch rows carry
 *    `none`, as E05 / E08 / E13 write theirs: a module that differs between
 *    sources is a ledger problem. A file-type row takes the module of the editor
 *    the File Types table's "Saved/Used by" cell names (`fileTypeModule`,
 *    `FILE_TYPE_USED_BY_MODULE`): Animation Editor -> AnimEditor, Resource
 *    Manager's Config Editor -> ResourceManager.Config, and so on by the
 *    vocabulary; several editors or none named give `none`. E09 applies the same
 *    table to the same cells. A provisional E01 row that says otherwise does not
 *    constrain E07 (DEC-020).
 *  - `what` and labels are the page's own words (`pageUnits`): a heading, a cell,
 *    a list item, the label or description part of an item, a bold phrase, a link
 *    label, a title, or a whole sentence. A fragment cut out of a sentence is not:
 *    a description that is one is widened to its sentence (at most 200
 *    characters) or left out, and a label that is one is left out (the key path
 *    keeps the composed name; `quote` is the page's sentence). Both are listed in
 *    report.json (`rewritten_descriptions`, `skipped_rows`).
 *  - `shortcut_default`: the keys of one chord are joined with `+`, alternatives
 *    with ` / ` and nothing else; key names are the page's own (`PageDown`,
 *    `Page Down` and `Spacebar` are kept as written).
 *  - Identity decisions are on the rows (`unverified`), and in report.json
 *    (`identity_decisions`). One row kept for two page locations (a General
 *    Shortcuts row that repeats a menu row's key; the Script Editor's `Debug: Step
 *    Over` and the Debug section's `Step Over`; the World Editor's `Terrain Tool`
 *    heading, which points at the Terrain Creation Tool page) carries an entry that
 *    names the other location and quotes the page text the merge rests on. Two rows
 *    the pages do not call one thing (`Vector Entity Tool` on the top bar, the
 *    Vector Tool page) are both kept and each names the other. A statement the page
 *    contradicts elsewhere (the Resource Manager's tab keys: Ctrl+Page Up is "Next
 *    tab" in General Shortcuts and "Previous Tab" in the Window menu section) keeps
 *    both rows, each with an entry that states the contradiction and cites the other
 *    section. A description that is a `{{Wiki|TODO|...}}` maintenance template is not
 *    a `what`: it is left out and the row carries the template in `unverified`. Two
 *    headings of one name under one section (`Snap to terrain`, a checkbox and then a
 *    button) are two rows: the later one carries the section heading in its path.
 *  - Parents: a row's parent is the row of its nearest emitted ancestor by key path
 *    (Terrain Creation Tool > Manage > ... hangs off the Manage tab, not the tool).
 *    A shortcut row that stands beside an item takes that item (the row with the same
 *    key path) as its parent, else the nearest emitted ancestor (`parentByPath`,
 *    resolved in `finalize`). The test checks the whole file for a longer emitted
 *    key-path prefix than a row's parent.
 *  - A `what` is a whole sentence or statement of the page: it is not cut at an
 *    ellipsis inside a menu name (`Select entities...`) or at a dash inside one list
 *    item. A label that is a control name the page states in running prose (`Pause`,
 *    `Clear Console`; the spec marks it `named`) is kept when those exact words occur
 *    in the cited section.
 *  - A leaf heading under which the page holds only an HTML comment is not a
 *    control or option row (the editors hid the content).
 *
 *   npx tsx scripts/census/enumerators/e07-wiki-tables.ts [--export <file>] [--build <tag>]
 *       [--out <file under observations/E07/>] [--artifacts <dir>] [--no-artifacts]
 *       [--data <dir>] [--json]
 *
 * --export     default <repo>/data/wiki/export.xml
 * --build      default data/census/current-build.json `tag`
 * --artifacts  default the harness artifacts folder (scripts/live/paths.ts)
 *
 * Exit: 0 written; 1 refused (output outside observations/E07/) or a gate
 * problem (nothing is written); 2 usage or no export (NO DATA); 3 malformed
 * census configuration.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { compareCodeUnits, jsonlLine, sha256 } from "../../../src/census/canon.js";
import { loadCurrentBuild, loadUniverses } from "../../../src/census/census-config.js";
import { allStrings, containsMachinePath } from "../../../src/census/hygiene.js";
import { deriveId, normalizeLabel } from "../../../src/census/ids.js";
import { writeFileAtomic, type CensusPaths } from "../../../src/census/ledger-io.js";
import {
  observationSchema,
  type Observation,
  type ObservationKey,
} from "../../../src/census/schemas.js";
import {
  MODULES,
  type Confidence,
  type Dim,
  type Kind,
  type Module,
  type Risk,
} from "../../../src/census/vocab.js";
import { artifactsDir, insideGitWorkTree } from "../../live/paths.js";
import {
  EXIT_FAIL,
  EXIT_MALFORMED,
  EXIT_OK,
  EXIT_USAGE,
  PROCESS_IO,
  guard,
  isMainModule,
  pathsFrom,
  type Io,
} from "../cli-common.js";

// ── Export reader ─────────────────────────────────────────────────────────────

export interface WikiPage {
  /** Title as exported (spaces, `&` unescaped). */
  title: string;
  /** Namespace number. */
  ns: number;
  /** Page id in the export. */
  id: number;
  /** Raw wikitext of the latest revision. */
  text: string;
}

const XML_ENTITIES: Record<string, string> = {
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&amp;": "&",
};

/** Unescapes the five XML entities (one pass, so `&amp;lt;` stays `&lt;`). */
export function xmlUnescape(s: string): string {
  return s.replace(/&(?:lt|gt|quot|apos|amp);/g, (m) => XML_ENTITIES[m]);
}

/** Every `<page>` element of a Special:Export file, in file order. */
export function parseExport(xml: string): WikiPage[] {
  const pages: WikiPage[] = [];
  for (const m of xml.matchAll(/<page>([\s\S]*?)<\/page>/g)) {
    const body = m[1];
    const title = /<title>([\s\S]*?)<\/title>/.exec(body)?.[1];
    if (title === undefined) continue;
    const ns = Number(/<ns>(-?\d+)<\/ns>/.exec(body)?.[1] ?? "0");
    const id = Number(/<id>(\d+)<\/id>/.exec(body)?.[1] ?? "0");
    const text = /<text\b[^>]*>([\s\S]*?)<\/text>/.exec(body)?.[1] ?? "";
    pages.push({ title: xmlUnescape(title), ns, id, text: xmlUnescape(text) });
  }
  return pages;
}

export function readExportFile(file: string): WikiPage[] {
  return parseExport(readFileSync(file, "utf-8"));
}

/** `Arma Reforger:File Types` -> `Arma_Reforger:File_Types` (ids and refs hold no whitespace). */
export function titleSlug(title: string): string {
  return title.trim().replace(/\s+/g, "_");
}

// ── Inline cleaning ───────────────────────────────────────────────────────────

const HTML_ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&rarr;": "→",
  "&larr;": "←",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#32;": " ",
  "&ndash;": "–",
  "&mdash;": "—",
};

/** Templates that print nothing useful in running text. */
const SILENT_TEMPLATES = new Set([
  "clear",
  "toc",
  "gamecategory",
  "gvi",
  "icon",
  "armar",
  "arma",
  "arma3",
  "arma4",
  "tkoh",
  "dayz",
  "infobox",
  "sticky",
  "columns",
  "messagebox",
  "feature",
]);

/** Splits `a|b|{{c|d}}|[[e|f]]` on top-level pipes. */
export function splitTopLevel(s: string, sep = "|"): string[] {
  const out: string[] = [];
  let cur = "";
  let brace = 0;
  let bracket = 0;
  for (let i = 0; i < s.length; i++) {
    const two = s.slice(i, i + 2);
    if (two === "{{") {
      brace++;
      cur += two;
      i++;
    } else if (two === "}}") {
      brace = Math.max(0, brace - 1);
      cur += two;
      i++;
    } else if (two === "[[") {
      bracket++;
      cur += two;
      i++;
    } else if (two === "]]") {
      bracket = Math.max(0, bracket - 1);
      cur += two;
      i++;
    } else if (s[i] === sep && brace === 0 && bracket === 0) {
      out.push(cur);
      cur = "";
    } else cur += s[i];
  }
  out.push(cur);
  return out;
}

function renderTemplate(inner: string): string {
  const parts = splitTopLevel(inner);
  const name = parts[0].trim().toLowerCase();
  const args = parts.slice(1).map((p) => p.trim());
  if (name === "controls") return args.filter((a) => a !== "").join("+");
  if (name === "hl" || name === "color" || name === "colour") {
    // {{hl|text}} or {{hl|c= code}}; {{Color|blue|text}}
    if (name !== "hl") return args[args.length - 1] ?? "";
    const arg = args.find((a) => !/^[a-z]+\s*=/.test(a) || /^c\s*=/.test(a)) ?? "";
    return arg.replace(/^c\s*=\s*/, "");
  }
  if (name === "link" || name === "link/internal" || name === "link/external") {
    const target = args[0] ?? "";
    const label = args[1];
    if (label !== undefined && label !== "") return label;
    if (/^(https?|enfusion):/i.test(target)) return target;
    return target.replace(/^Arma Reforger:/i, "").replace(/^#/, "");
  }
  if (name === "link/enfusion") return args[args.length - 1] ?? "";
  if (name === "argtitle") return args.find((a) => !/^\d$/.test(a)) ?? "";
  if (name === "gamecategory") {
    // `{{GameCategory|armaR|...|link= y|text= Workbench}}` prints its `text=` argument.
    const text = args.find((a) => /^text\s*=/.test(a));
    return text ? text.replace(/^text\s*=\s*/, "") : "";
  }
  if (name === "n/a") return "n/a";
  // `{{Wiki|TODO|...}}` is an editors' maintenance note, not text of the page about the thing.
  if (name === "wiki" && /^todo$/i.test(args[0] ?? "")) return "";
  if (name === "=") return "=";
  if (name === "!") return "|";
  if (name === "sic" || name === "trim") return args[0] ?? "";
  if (SILENT_TEMPLATES.has(name)) {
    if (name === "feature" || name === "messagebox") {
      const text = args.slice(1).join(" ");
      return text ? ` ${text} ` : "";
    }
    return "";
  }
  return args.filter((a) => a !== "" && !/^[a-z0-9_ -]+\s*=/.test(a)).join(" ");
}

/**
 * Plain text of a wikitext fragment: templates, links, emphasis, HTML tags,
 * entities and nested lists flattened to one line.
 */
export function cleanWiki(input: string): string {
  let s = input;
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/<nowiki\s*\/>/g, "").replace(/<nowiki>([\s\S]*?)<\/nowiki>/g, "$1");
  // Templates, innermost first.
  for (let guard = 0; guard < 12 && /\{\{/.test(s); guard++) {
    const next = s.replace(/\{\{((?:(?!\{\{|\}\}).)*)\}\}/gs, (_m, inner: string) =>
      renderTemplate(inner),
    );
    if (next === s) break;
    s = next;
  }
  s = s.replace(/\[\[(?:File|Image|Category):[^\]]*\]\]/gi, "");
  s = s.replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2");
  s = s.replace(/\[\[:?([^\]]*)\]\]/g, (_m, t: string) => t.replace(/^.*#/, (h) => h.slice(1)));
  s = s.replace(/\[(?:https?|enfusion):\/\/\S+\s+([^\]]+)\]/g, "$1");
  s = s.replace(/\[((?:https?|enfusion):\/\/\S+)\]/g, "$1");
  s = s.replace(/<br\s*\/?>/gi, " ");
  s = s.replace(/<\/?[a-zA-Z][^>]*>/g, "");
  s = s.replace(/'''''|'''|''/g, "");
  s = s.replace(/&[#a-zA-Z0-9]+;/g, (m) => HTML_ENTITIES[m] ?? m);
  s = s.replace(/^\s*[*#:;]+\s*/gm, "");
  return s.replace(/\s+/g, " ").trim();
}

// ── Headings and anchors ──────────────────────────────────────────────────────

export interface Heading {
  level: number;
  /** Heading text as written (markup kept). */
  raw: string;
  /** Plain text. */
  text: string;
  /** MediaWiki anchor (spaces to underscores, de-duplicated with `_2`, `_3`). */
  anchor: string;
  /** 1-based line of the heading in the page text. */
  line: number;
  /** True for a heading written inside a table cell. */
  inCell: boolean;
}

const HEADING_RE = /^(={1,6})\s*(.*?)\s*\1\s*$/;
const ARGTITLE_RE = /^\{\{ArgTitle\|(\d)\|([^|}]+)(?:\|.*)?\}\}\s*$/;

/** The anchor MediaWiki would give a heading with this plain text (before de-duplication). */
export function anchorOf(text: string): string {
  return text.trim().replace(/\s+/g, "_");
}

/** Heading on one line: `== Title ==` or `{{ArgTitle|3|name|...}}`; null for any other line. */
export function headingOfLine(line: string): { level: number; raw: string; text: string } | null {
  const m = HEADING_RE.exec(line);
  if (m && m[2] !== "") return { level: m[1].length, raw: m[2], text: cleanWiki(m[2]) };
  const a = ARGTITLE_RE.exec(line.trim());
  if (a) return { level: Number(a[1]), raw: a[2], text: a[2].trim() };
  return null;
}

/** Removes `<!-- -->` comments but keeps line count (a comment spanning lines leaves its newlines). */
export function stripComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ""));
}

// ── Tables ────────────────────────────────────────────────────────────────────

export interface Cell {
  header: boolean;
  attrs: string;
  /** Raw wikitext of the cell content (heading lines inside the cell removed). */
  raw: string;
  /** Plain text of the cell. */
  text: string;
  colspan: number;
  rowspan: number;
  /** Logical column index (after earlier rowspans), 0-based. */
  col: number;
  /** Headings written inside the cell (File Types keeps the extension there). */
  headings: Heading[];
  /** Tables nested in this cell. */
  tables: Table[];
}

export interface Row {
  attrs: string;
  cells: Cell[];
}

export interface Table {
  /** 1-based, document order of `{|` openers, nested tables included. */
  index: number;
  attrs: string;
  caption: string;
  rows: Row[];
  /** Index of the enclosing table, if nested. */
  parent: number | null;
  /** Anchor of the nearest heading above the opener (cell headings do not count); `""` if none. */
  section: string;
  /** 1-based line of `{|`. */
  line: number;
  /** 1-based line of the closing `|}` (last line of the page if it never closes). */
  endLine: number;
}

export interface ParsedPage {
  headings: Heading[];
  tables: Table[];
}

function parseAttrSpan(attrs: string, name: "colspan" | "rowspan"): number {
  const m = new RegExp(`${name}\\s*=\\s*["']?(\\d+)`, "i").exec(attrs);
  return m ? Math.max(1, Number(m[1])) : 1;
}

const ATTR_ONLY_RE = /^\s*(?:[\w:-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"']+)\s*)+$/;

function splitInlineCells(rest: string, header: boolean): string[] {
  // `||` always separates cells; `!!` only in a header line.
  const out: string[] = [];
  let cur = "";
  let brace = 0;
  let bracket = 0;
  for (let i = 0; i < rest.length; i++) {
    const two = rest.slice(i, i + 2);
    if (two === "{{") {
      brace++;
      cur += two;
      i++;
    } else if (two === "}}") {
      brace = Math.max(0, brace - 1);
      cur += two;
      i++;
    } else if (two === "[[") {
      bracket++;
      cur += two;
      i++;
    } else if (two === "]]") {
      bracket = Math.max(0, bracket - 1);
      cur += two;
      i++;
    } else if (brace === 0 && bracket === 0 && (two === "||" || (header && two === "!!"))) {
      out.push(cur);
      cur = "";
      i++;
    } else cur += rest[i];
  }
  out.push(cur);
  return out;
}

function splitAttrs(cellSrc: string): { attrs: string; content: string } {
  const parts = splitTopLevel(cellSrc);
  if (parts.length >= 2 && ATTR_ONLY_RE.test(parts[0])) {
    return { attrs: parts[0].trim(), content: parts.slice(1).join("|") };
  }
  return { attrs: "", content: cellSrc };
}

interface BuildCell {
  header: boolean;
  attrs: string;
  lines: string[];
  tables: Table[];
  headings: Heading[];
}

interface Frame {
  table: Table;
  rows: BuildCell[][];
  rowAttrs: string[];
  row: BuildCell[] | null;
  cur: BuildCell | null;
}

/**
 * Parses headings and tables of one page. Tables nest; a `{|` that starts a
 * line inside a cell belongs to that cell. Headings inside a table cell (the
 * File Types page keeps the extension there) are reported with `inCell` and
 * attached to the cell, and do not move the section pointer.
 */
export function parseWikitext(text: string): ParsedPage {
  const lines = stripComments(text).split(/\r?\n/);
  const headings: Heading[] = [];
  const tables: Table[] = [];
  const stack: Frame[] = [];
  const seenAnchors = new Map<string, number>();
  let section = "";
  let tableCounter = 0;

  const addHeading = (
    h: { level: number; raw: string; text: string },
    line: number,
    inCell: boolean,
  ): Heading => {
    const base = anchorOf(h.text);
    const n = (seenAnchors.get(base) ?? 0) + 1;
    seenAnchors.set(base, n);
    const heading: Heading = {
      level: h.level,
      raw: h.raw,
      text: h.text,
      anchor: n === 1 ? base : `${base}_${n}`,
      line,
      inCell,
    };
    headings.push(heading);
    return heading;
  };

  const finishTable = (): void => {
    const top = stack.pop();
    if (!top) return;
    const rows: Row[] = [];
    top.rows.forEach((cells, r) => {
      if (cells.length === 0) return;
      const built: Cell[] = cells.map((c) => {
        const raw = c.lines.join("\n").trim();
        return {
          header: c.header,
          attrs: c.attrs,
          raw,
          text: cleanWiki(raw),
          colspan: parseAttrSpan(c.attrs, "colspan"),
          rowspan: parseAttrSpan(c.attrs, "rowspan"),
          col: 0,
          headings: c.headings,
          tables: c.tables,
        };
      });
      rows.push({ attrs: top.rowAttrs[r] ?? "", cells: built });
    });
    assignColumns(rows);
    top.table.rows = rows;
  };

  lines.forEach((rawLine, i) => {
    const lineNo = i + 1;
    const line = rawLine.replace(/\s+$/, "");
    const trimmed = line.trimStart();
    const top = stack[stack.length - 1];

    if (trimmed.startsWith("{|")) {
      const table: Table = {
        index: ++tableCounter,
        attrs: trimmed.slice(2).trim(),
        caption: "",
        rows: [],
        parent: top ? top.table.index : null,
        section,
        line: lineNo,
        endLine: lines.length,
      };
      tables.push(table);
      if (top?.cur) top.cur.tables.push(table);
      stack.push({ table, rows: [], rowAttrs: [], row: null, cur: null });
      return;
    }
    if (top && trimmed.startsWith("|}")) {
      top.table.endLine = lineNo;
      finishTable();
      return;
    }
    if (top) {
      if (trimmed.startsWith("|+")) {
        top.table.caption = cleanWiki(trimmed.slice(2));
        return;
      }
      if (trimmed.startsWith("|-")) {
        top.row = [];
        top.rows.push(top.row);
        top.rowAttrs.push(trimmed.replace(/^\|-+/, "").trim());
        top.cur = null;
        return;
      }
      if (trimmed.startsWith("!") || trimmed.startsWith("|")) {
        const header = trimmed.startsWith("!");
        if (!top.row) {
          top.row = [];
          top.rows.push(top.row);
          top.rowAttrs.push("");
        }
        let last: BuildCell | null = null;
        for (const piece of splitInlineCells(trimmed.slice(1), header)) {
          const { attrs, content } = splitAttrs(piece);
          const cell: BuildCell = {
            header,
            attrs,
            lines: content.trim() === "" ? [] : [content.replace(/^ /, "")],
            tables: [],
            headings: [],
          };
          top.row.push(cell);
          last = cell;
        }
        top.cur = last;
        return;
      }
      if (top.cur) {
        const h = headingOfLine(trimmed);
        if (h) top.cur.headings.push(addHeading(h, lineNo, true));
        else top.cur.lines.push(line);
      }
      return;
    }
    const h = headingOfLine(trimmed);
    if (h) section = addHeading(h, lineNo, false).anchor;
  });
  while (stack.length) finishTable();
  return { headings, tables };
}

/** Sets `col` of every cell, honouring rowspans of earlier rows. */
export function assignColumns(rows: Row[]): void {
  const carry: number[] = []; // rows each column is still occupied by an earlier rowspan
  for (const row of rows) {
    let col = 0;
    for (const cell of row.cells) {
      while ((carry[col] ?? 0) > 0) col++;
      cell.col = col;
      for (let k = 0; k < cell.colspan; k++) carry[col + k] = cell.rowspan;
      col += cell.colspan;
    }
    for (let c = 0; c < carry.length; c++) if ((carry[c] ?? 0) > 0) carry[c]--;
  }
}

// ── Lists and definition lists ────────────────────────────────────────────────

export interface ListItem {
  /** Nesting depth, 1 for `*` / `#`. */
  depth: number;
  /** The marker run (`*`, `**`, `#`, `*#`...). */
  marker: string;
  /** Item text as written (markup kept). */
  raw: string;
  /** 1-based line within the text the list was parsed from (offset applied). */
  line: number;
  children: ListItem[];
}

const LIST_LINE_RE = /^([*#]+)\s*(.*)$/;

/**
 * Parses `*` and `#` list lines into a forest. Blank lines do not end a list
 * (the Resource Manager menu cells separate groups with blank lines); any other
 * line that is not a list line ends it and is skipped. `firstLine` is the page
 * line of `lines[0]`.
 */
export function parseList(lines: readonly string[], firstLine = 1): ListItem[] {
  const roots: ListItem[] = [];
  const stack: ListItem[] = [];
  lines.forEach((l, i) => {
    const m = LIST_LINE_RE.exec(l.trimStart());
    if (!m) return;
    const item: ListItem = {
      depth: m[1].length,
      marker: m[1],
      raw: m[2].trim(),
      line: firstLine + i,
      children: [],
    };
    while (stack.length && stack[stack.length - 1].depth >= item.depth) stack.pop();
    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(item);
    else roots.push(item);
    stack.push(item);
  });
  return roots;
}

export interface Definition {
  term: string;
  /** Definition text (empty when the term stands alone). */
  def: string;
  line: number;
}

/**
 * Definition list: `; term : definition` on one line, or `; term` followed by
 * `: definition` lines. A colon inside a template or link does not split.
 */
export function parseDefinitionList(lines: readonly string[], firstLine = 1): Definition[] {
  const out: Definition[] = [];
  lines.forEach((l, i) => {
    const t = l.trimStart();
    if (t.startsWith(";")) {
      const body = t.replace(/^;+\s*/, "");
      const parts = splitTopLevel(body, ":");
      out.push({
        term: parts[0].trim(),
        def: parts.slice(1).join(":").trim(),
        line: firstLine + i,
      });
    } else if (t.startsWith(":") && out.length) {
      const last = out[out.length - 1];
      const extra = t.replace(/^:+\s*/, "");
      last.def = last.def === "" ? extra : `${last.def} ${extra}`;
    }
  });
  return out;
}

// ── Page index ────────────────────────────────────────────────────────────────

export interface PageIndex {
  page: WikiPage;
  slug: string;
  /** Page lines with comments removed (line numbers equal the raw text's). */
  lines: string[];
  parsed: ParsedPage;
  /** Non-cell headings in line order. */
  sections: Heading[];
  anchors: Set<string>;
  byAnchor: Map<string, Heading>;
}

export function indexPage(page: WikiPage): PageIndex {
  const parsed = parseWikitext(page.text);
  const byAnchor = new Map<string, Heading>();
  for (const h of parsed.headings) byAnchor.set(h.anchor, h);
  return {
    page,
    slug: titleSlug(page.title),
    lines: stripComments(page.text).split(/\r?\n/),
    parsed,
    sections: parsed.headings.filter((h) => !h.inCell),
    anchors: new Set(parsed.headings.map((h) => h.anchor)),
    byAnchor,
  };
}

/** Anchor of the nearest non-cell heading at or above `line`, `""` when there is none. */
export function sectionAt(ix: PageIndex, line: number): string {
  let found = "";
  for (const h of ix.sections) {
    if (h.line <= line) found = h.anchor;
    else break;
  }
  return found;
}

/** First line after `h` that starts a heading of level <= `maxLevel` (default any), else past the end. */
function nextHeadingLine(ix: PageIndex, h: Heading, maxLevel = 6): number {
  for (const n of ix.sections) {
    if (n.line > h.line && n.level <= maxLevel) return n.line;
  }
  return ix.lines.length + 1;
}

function insideTable(ix: PageIndex, line: number): boolean {
  return ix.parsed.tables.some((t) => line >= t.line && line <= t.endLine);
}

/** Lines directly under a heading, before the next heading of any level; table lines removed. */
export function bodyLines(ix: PageIndex, h: Heading): { line: number; text: string }[] {
  const end = nextHeadingLine(ix, h);
  const out: { line: number; text: string }[] = [];
  for (let n = h.line + 1; n < end; n++) {
    if (insideTable(ix, n)) continue;
    out.push({ line: n, text: ix.lines[n - 1] });
  }
  return out;
}

/** Lines of the whole subtree of a heading (deeper headings included); table lines removed. */
export function subtreeLines(ix: PageIndex, h: Heading): { line: number; text: string }[] {
  const end = nextHeadingLine(ix, h, h.level);
  const out: { line: number; text: string }[] = [];
  for (let n = h.line + 1; n < end; n++) {
    if (insideTable(ix, n)) continue;
    out.push({ line: n, text: ix.lines[n - 1] });
  }
  return out;
}

/** Non-cell headings under `h` (any depth), in line order. */
export function descendants(ix: PageIndex, h: Heading): Heading[] {
  const end = nextHeadingLine(ix, h, h.level);
  return ix.sections.filter((n) => n.line > h.line && n.line < end);
}

const NON_PROSE_RE =
  /^(?:\{\||\|\}|\||!|\{\{(?:Feature|TOC|Clear|GVI|ArgTitle|Columns|Messagebox|Informative|Wiki|Icon|GameCategory)\b|\*|#|:|;|\[\[(?:File|Image)|<gallery|<enforce|<syntaxhighlight|__|=)/i;

/**
 * First sentence of the first prose line in `lines`: markup cleaned, a trailing
 * "Shortcut: ..." removed, cut at the first sentence end, at most `max` chars
 * (cut at a space). `undefined` when there is no prose or the line is a bare dash.
 */
export function firstSentence(lines: readonly { text: string }[], max = 200): string | undefined {
  for (const { text } of lines) {
    const t = text.trim();
    if (t === "" || NON_PROSE_RE.test(t)) continue;
    let s = cleanWiki(t);
    s = s.replace(/\s*(?:Default\s+)?[Ss]hortcuts?:.*$/, "");
    s = cutSentence(s).trim();
    if (s === "" || /^[-–—.]+$/.test(s)) return undefined;
    if (s.length > max) {
      const sub = s.slice(0, max);
      const sp = sub.lastIndexOf(" ");
      s = (sp > max / 2 ? sub.slice(0, sp) : sub).trim();
    }
    return s;
  }
  return undefined;
}

/**
 * Cuts at the first sentence end that is not an abbreviation (`e.g.`, `i.e.`, `etc.`), a
 * lone letter, or the end of an ellipsis (`Select entities...` is a menu name, the sentence
 * goes on).
 */
export function cutSentence(s: string): string {
  for (const m of s.matchAll(/[.!?](?=\s|$)/g)) {
    const before = s.slice(0, m.index);
    const word = /([A-Za-z.]+)$/.exec(before)?.[1] ?? "";
    if (m[0] === "." && before.endsWith(".")) continue;
    if (m[0] === "." && (/^(e\.g|i\.e|etc|vs|approx|cf)$/i.test(word) || /^[A-Za-z]$/.test(word)))
      continue;
    return s.slice(0, (m.index ?? 0) + 1);
  }
  return s;
}

/** `Shortcut: {{Controls|Ctrl|N}}` or `Default shortcut: ...` in a block of lines. */
export function shortcutIn(lines: readonly { text: string }[]): string | undefined {
  for (const { text } of lines) {
    const m =
      /(?:Default\s+)?[Ss]hortcut:\s*(\{\{Controls\|[^}]*\}\}(?:\s*[/,]\s*\{\{Controls\|[^}]*\}\})?)/.exec(
        text,
      );
    if (m) return shortcutText(m[1]);
  }
  return undefined;
}

/** The one separator between alternative shortcuts in `shortcut_default`. */
export const SHORTCUT_ALT_SEP = " / ";

/**
 * A shortcut cell as plain text: `{{Controls|Ctrl|S}}` -> `Ctrl+S`; stray braces
 * removed. Keys of one chord are joined with `+`; alternatives are joined with
 * `SHORTCUT_ALT_SEP` and nothing else, whichever way the page writes them (a
 * line break, a `<br>`, a `/` or `,` or `or` between two key templates, or two
 * key templates side by side). The key names are the page's own (`Page Down`,
 * `PageDown` and `Spacebar` stay as written): only the separators are unified.
 */
export function shortcutText(raw: string): string {
  const parts = raw
    .replace(/\}\}\s*(?:[/,]|\bor\b)?\s*\{\{\s*Controls\b/gi, "}}\n{{Controls")
    .split(/<br\s*\/?>|\r?\n/i)
    .map((p) => cleanWiki(p).replace(/^[{}\s]+|[{}\s]+$/g, ""))
    .filter((p) => p !== "");
  return parts.join(SHORTCUT_ALT_SEP);
}

/**
 * Do two shortcut texts name the same keys? Only for comparing: the page spells a key
 * several ways (`Page Down`, `PageDown`; `Space`, `Spacebar`) and the rows keep each
 * spelling as written.
 */
export function sameShortcut(a: string | undefined, b: string | undefined): boolean {
  const canon = (s: string | undefined): string =>
    (s ?? "")
      .replace(/\s+/g, "")
      .toLowerCase()
      .replace(/spacebar/g, "space");
  return a !== undefined && b !== undefined && canon(a) === canon(b);
}

/** Alternatives for a chord written with a slash between its last keys, in the page's words: `RMB`, `W`, `S` -> `RMB+W / RMB+S`. */
export function chordAlternatives(prefix: string, keys: readonly string[]): string {
  return keys.map((k) => `${prefix}+${k}`).join(SHORTCUT_ALT_SEP);
}

// ── Machine-path hygiene ──────────────────────────────────────────────────────

/**
 * Text safe to put in an observation: machine paths are replaced by `<path>`
 * (the ledger rejects any string that looks like one); `undefined` if a path
 * pattern survives.
 */
export function safeText(s: string | undefined): string | undefined {
  if (s === undefined) return undefined;
  if (!containsMachinePath(s)) return s;
  const t = s
    .replace(/[A-Za-z]:[\\/][^\s)"'<>|]*/g, "<path>")
    .replace(/(^|[^A-Za-z0-9_.<>%-])\/(?:home|Users|root)\/[^\s)"'<>|]*/g, "$1<path>")
    .replace(/\\Users\\[^\s)"'<>|]*/gi, "<path>");
  return containsMachinePath(t) ? undefined : t;
}

// ── Drafts and the collector ──────────────────────────────────────────────────

export interface DraftRef {
  dim: Dim;
  kind: Kind;
  module: Module;
  key: ObservationKey;
}

/** One row before the ledger checks: identity, text and where it came from. */
export interface Draft extends DraftRef {
  label?: string;
  what?: string;
  shortcut?: string;
  risk?: Risk;
  parent: DraftRef | null;
  /** Page title (spaces). */
  page: string;
  /** Heading anchor, `table-<n>`, or `""` for the lead section. */
  anchor: string;
  quote?: string;
  confidence: Confidence;
  /** The spec enumerates every child of this row (children_count may be set). */
  container?: boolean;
  /** Spec id that produced the row (reports only). */
  spec: string;
  /**
   * What the pages do not settle about this row, written as `unverified`: a row
   * kept for two page locations (and the sentence the merge rests on), two rows
   * the pages do not call one thing, a statement the page contradicts elsewhere,
   * a description the page marks as a maintenance TODO.
   */
  unverified?: string[];
  /**
   * The parent is derived when the rows are finalized, from the key paths: the
   * row with the same key path of another kind (the item a shortcut row belongs
   * to), else the nearest emitted ancestor by key path. `parent` is ignored.
   */
  parentByPath?: boolean;
}

export interface Skipped {
  spec: string;
  page: string;
  anchor: string;
  what: string;
  reason: string;
}

export class Collector {
  /** Every draft by derived id, insertion order, blocked kinds included. */
  readonly all = new Map<string, Draft>();
  readonly duplicates: Skipped[] = [];
  readonly invalid: Skipped[] = [];
  /** Rows a spec wanted to emit that the spec skipped for a stated reason (not duplicates). */
  readonly skipped: Skipped[] = [];
  /** Descriptions replaced by the page's own wording (a fragment widened to its sentence). */
  readonly rewritten: Skipped[] = [];
  /** Identity decisions: two places that are one row, or two rows the pages do not call the same. */
  readonly decisions: Skipped[] = [];
  /** Table index -> spec id, per page title. */
  readonly mappedTables = new Map<string, Map<number, string>>();

  add(d: Draft): string | null {
    let id: string;
    try {
      id = deriveId(d);
    } catch (e) {
      this.invalid.push({
        spec: d.spec,
        page: d.page,
        anchor: d.anchor,
        what: `${d.kind} ${JSON.stringify(d.key)}`,
        reason: e instanceof Error ? e.message : String(e),
      });
      return null;
    }
    if (this.all.has(id)) {
      this.duplicates.push({
        spec: d.spec,
        page: d.page,
        anchor: d.anchor,
        what: id,
        reason: `same id as a row from ${this.all.get(id)?.spec}`,
      });
      return null;
    }
    this.all.set(id, d);
    return id;
  }

  markTable(page: string, table: Table, spec: string): void {
    const m = this.mappedTables.get(page) ?? new Map<number, string>();
    m.set(table.index, spec);
    this.mappedTables.set(page, m);
  }

  /** Adds an `unverified` statement to a row (once; a text that holds a machine path is dropped). */
  note(d: Draft | undefined, text: string): void {
    const t = safeText(squash(text));
    if (!d || t === undefined || t === "") return;
    const list = d.unverified ?? (d.unverified = []);
    if (!list.includes(t)) list.push(t);
  }

  find(kind: Kind, module: Module, path: readonly string[]): Draft | undefined {
    try {
      return this.all.get(deriveId(uiRef(module, kind, path)));
    } catch {
      return undefined;
    }
  }
}

export interface Ctx {
  c: Collector;
  ix: PageIndex;
  module: Module;
  spec: string;
}

const QUOTE_MAX = 200;
const WHAT_MAX = 200;

/**
 * A path segment as the ledger key wants it. `normalizeLabel` treats `&` as a
 * mnemonic marker and drops it, so a literal ampersand (`Info & Diags`) is
 * written `&&`, which `normalizeLabel` turns back into one `&`.
 */
export function keySeg(s: string): string {
  return s.replace(/\s+/g, " ").trim().replace(/&/g, "&&");
}

/** Inverse of `keySeg`. */
export function unkey(s: string): string {
  return s.replace(/&&/g, "&");
}

function uiRef(module: Module, kind: Kind, path: readonly string[]): DraftRef {
  return { dim: "ui", kind, module, key: { path: path.map(keySeg).filter((x) => x.length > 0) } };
}

/** `quote` as the ledger wants it: verbatim in the page, at most 200 chars, no machine path. */
export function quoteFrom(ix: PageIndex, text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  const t = text.trim().split("\n")[0].trim().slice(0, QUOTE_MAX).trim();
  if (t === "" || !ix.page.text.includes(t)) return undefined;
  return safeText(t) === t ? t : undefined;
}

/** Descriptions that only point elsewhere or describe the page layout say nothing about the row. */
const WHAT_REJECT = /^(?:See\b|The (?:first|second) section|same as above)/i;

function whatFrom(s: string | undefined): string | undefined {
  if (s === undefined) return undefined;
  const t = safeText(s.replace(/\s+/g, " ").trim());
  if (t === undefined || t === "" || /^[-–—.]+$/.test(t) || WHAT_REJECT.test(t)) return undefined;
  const one = cutSentence(t).trim();
  if (one !== t) return whatFrom(one);
  if (t.length <= WHAT_MAX) return t;
  const sub = t.slice(0, WHAT_MAX);
  const sp = sub.lastIndexOf(" ");
  return (sp > WHAT_MAX / 2 ? sub.slice(0, sp) : sub).trim();
}

const pageTextCache = new WeakMap<PageIndex, { raw: string; clean: string }>();

function squash(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Does the page hold this text, as written or as plain text (markup cleaned line by line)? */
export function pageHasText(ix: PageIndex, text: string): boolean {
  let t = pageTextCache.get(ix);
  if (!t) {
    t = {
      raw: squash(ix.page.text),
      // `safeText` as well: a `what` that held a machine path was written with `<path>`.
      clean: squash(ix.lines.map((l) => safeText(cleanWiki(l)) ?? "").join(" ")),
    };
    pageTextCache.set(ix, t);
  }
  const q = squash(text);
  return t.raw.includes(q) || t.clean.includes(q);
}

/**
 * The units of a page's own wording: a heading, a table cell (or one line of it),
 * a list item, the label part and the description part of an item split at its
 * colon, dash, `<br>` or arrow, a bold phrase, a link label, a quoted name, and
 * every whole sentence. A label or a `what` that is none of these is a fragment
 * cut out of a sentence (a clause, a verb phrase): it is the author's wording, not
 * the page's, even though its letters occur in the page.
 */
export interface PageUnits {
  all: Set<string>;
  /** Whole sentences of the page, in first-seen order; used to widen a fragment to its sentence. */
  sentences: string[];
}

const unitsCache = new WeakMap<PageIndex, PageUnits>();

function trimEnd(s: string): string {
  return s.replace(/[\s.:;,!]+$/, "");
}

/** A verb that points at a menu or button (`select File`, `Go to Table`, `click on Save`). */
const UNIT_VERB =
  /^(?:select|go to|click(?: on)?|choose|open|press|use|via|through|by selecting|selecting)\s+/i;

const UNIT_SEPARATORS = [
  /\s+[–—-]\s+/,
  /:\s+/,
  /\s*(?:→|&rarr;|->)\s*/,
  /\s*&gt;\s*|\s+>\s+|(?<=[A-Za-z])>(?=[A-Z])/,
];

export function pageUnits(ix: PageIndex): PageUnits {
  const hit = unitsCache.get(ix);
  if (hit) return hit;
  const all = new Set<string>();
  const sentences: string[] = [];
  const seenSentence = new Set<string>();
  const addExact = (s: string): void => {
    const t = squash(s);
    if (t === "") return;
    all.add(t);
    const b = trimEnd(t);
    if (b !== "") all.add(b);
    // A description that held a machine path is written with `<path>`.
    const safe = safeText(t);
    if (safe !== undefined && safe !== t) {
      all.add(safe);
      const sb = trimEnd(safe);
      if (sb !== "") all.add(sb);
    }
  };
  const add = (s: string): void => {
    addExact(s);
    // The same unit without a trailing "(...)" and without a verb that points at a menu or button.
    const noParen = squash(s).replace(/\s*\([^)]*\)[\s.]*$/, "");
    if (noParen !== squash(s)) addExact(noParen);
    const noVerb = squash(noParen).replace(UNIT_VERB, "");
    if (noVerb !== squash(noParen)) addExact(noVerb);
  };
  const addSentences = (cleaned: string): void => {
    let rest = cleaned.trim();
    for (let guard = 0; rest !== "" && guard < 40; guard++) {
      const first = cutSentence(rest).trim();
      if (first === "") break;
      add(first);
      if (!seenSentence.has(first)) {
        seenSentence.add(first);
        sentences.push(first);
        const safe = safeText(first);
        if (safe !== undefined && safe !== first && !seenSentence.has(safe)) {
          seenSentence.add(safe);
          sentences.push(safe);
        }
      }
      const next = rest.slice(rest.indexOf(first) + first.length).trim();
      if (next === rest) break;
      rest = next;
    }
  };
  /** A piece of an item (the label part, the description part, one step of a menu path). */
  const addPiece = (piece: string, depth: number): void => {
    add(piece);
    addSentences(piece);
    if (depth < 3) {
      for (const sep of UNIT_SEPARATORS) {
        const parts = piece.split(sep);
        if (parts.length > 1) for (const part of parts) addPiece(part, depth + 1);
      }
      // A menu path inside a sentence (`from the top menu Game -> Copy view link`): the menu names.
      for (const arrow of piece
        .split(/\s*(?:→|&rarr;|->)\s*/)
        .slice(0, -1)
        .entries()) {
        const [i, left] = arrow;
        const lastRun = /((?:[A-Z][\w'-]*\s*)+)$/.exec(left)?.[1];
        if (lastRun !== undefined) add(lastRun);
        const right = piece.split(/\s*(?:→|&rarr;|->)\s*/)[i + 1];
        const firstRun = /^((?:[A-Z][\w'-]*\s*)+)/.exec(right ?? "")?.[1];
        if (firstRun !== undefined) add(firstRun);
      }
    }
  };
  const addText = (raw: string): void => {
    const cleaned = cleanWiki(raw);
    if (cleaned === "") return;
    addPiece(cleaned, 0);
    // Without a trailing "Shortcut: ..." (the way a description is cut).
    const noShortcut = cleaned.replace(/\s*(?:Default\s+)?[Ss]hortcuts?:.*$/, "");
    if (noShortcut !== cleaned) addPiece(noShortcut, 0);
    // The description part after the first separator, whole.
    for (const sep of UNIT_SEPARATORS) {
      const parts = cleaned.split(sep);
      if (parts.length > 1) addPiece(parts.slice(1).join(" "), 1);
    }
    // `'''Label''': {{Controls|F5}} description` -> the description (the way `splitItem` reads it).
    const afterLabel =
      /^\s*'''.+?'''\s*(?::|→|&rarr;|[-–—]\s)?\s*(?:\{\{Controls\|[^}]*\}\}\s*)*(.*)$/s.exec(
        raw,
      )?.[1];
    if (afterLabel !== undefined) {
      const d = cleanWiki(afterLabel);
      if (/^[A-Za-z0-9"']/.test(d)) addPiece(d, 1);
    }
    // Phrases the markup sets apart.
    for (const m of raw.matchAll(/'''(.+?)'''/g)) {
      const inner = cleanWiki(m[1]);
      if (inner !== "") addPiece(inner, 1);
    }
    for (const m of raw.matchAll(/\[\[[^\]|]*\|([^\]]+)\]\]/g)) add(cleanWiki(m[1]));
    for (const m of raw.matchAll(/\{\{\s*(?:Link|hl)\s*\|([^{}]*)\}\}/gi)) {
      const args = m[1].split("|");
      add(cleanWiki(args[args.length - 1]));
    }
    for (const m of cleaned.matchAll(/"([^"]{2,80})"/g)) add(m[1]);
  };
  const addLine = (line: string): void => {
    const body = line
      .trim()
      .replace(/^[|!*#:;\s]+/, "")
      .replace(/^=+\s*|\s*=+$/g, "");
    if (body === "" || body.startsWith("{|") || body.startsWith("|}")) return;
    for (const cell of body.split(/\|\||!!/)) {
      // A cell may start with attributes (`style="..." | text`).
      const content = /^[^|[{<]*=[^|]*\|(?!\|)(.*)$/.exec(cell)?.[1] ?? cell;
      addText(content);
      for (const part of content.split(/<br\s*\/?>/i)) addText(part);
    }
  };
  for (const line of ix.lines) addLine(line);
  for (const t of ix.parsed.tables) {
    for (const row of t.rows) {
      for (const cell of row.cells) {
        addText(cell.raw);
        for (const l of cell.raw.split(/\r?\n/)) addLine(l);
      }
    }
  }
  for (const h of ix.parsed.headings) addText(h.raw);
  // The page's own title (without the namespace) and its parts: `World Editor: Vector Tool` -> `Vector Tool`.
  const title = ix.page.title.replace(/^Arma Reforger:/i, "");
  add(title);
  for (const part of title.split(/:\s*/)) add(part);
  const units = { all, sentences };
  unitsCache.set(ix, units);
  return units;
}

/** Is this text a whole unit of the page (see `PageUnits`)? A leading `.` of an extension and a leading `+ ` of a button are not part of the unit. */
export function isPageUnit(ix: PageIndex, text: string): boolean {
  const t = squash(text);
  if (t === "") return false;
  const u = pageUnits(ix).all;
  return u.has(t) || u.has(trimEnd(t)) || u.has(t.replace(/^[.+]\s*/, "")) || u.has(`+ ${t}`);
}

/** `text` as whole words, in the exact case, in the cited section's own lines (`""`: the lead). */
export function statedInSection(ix: PageIndex, anchor: string, text: string): boolean {
  const h = anchor === "" ? undefined : ix.byAnchor.get(anchor);
  const lines = anchor === "" ? leadLines(ix) : h ? bodyLines(ix, h) : [];
  const hay = squash(lines.map((l) => cleanWiki(l.text)).join(" "));
  const needle = squash(text);
  if (needle === "") return false;
  const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![A-Za-z0-9])${esc}(?![A-Za-z0-9])`).test(hay);
}

/**
 * A label as the ledger keeps it: a unit of the page, or nothing (the key keeps the name).
 * A row marked `named` (the spec says the key's last segment is a control name the page
 * states in running prose, `Pause`, `Clear Console`) also keeps its label when those exact
 * words occur in the cited section; an author-composed phrase is never marked.
 */
function labelChecked(
  ctx: Ctx,
  anchor: string,
  label: string | undefined,
  named = false,
): string | undefined {
  if (label === undefined) return undefined;
  const l = safeText(label);
  if (l === undefined || isPageUnit(ctx.ix, l)) return l;
  if (named && statedInSection(ctx.ix, anchor, l)) return l;
  ctx.c.skipped.push({
    spec: ctx.spec,
    page: ctx.ix.page.title,
    anchor,
    what: label.slice(0, 80),
    reason:
      "label is not a unit of the page (a fragment of a sentence); omitted, the key path keeps the name",
  });
  return undefined;
}

/**
 * `what` as the ledger wants it: a whole sentence (or item, or cell) of the page.
 * A fragment of a sentence (the clause after a bold name, the tail of a
 * sentence) is widened to the sentence it sits in when that sentence is at most
 * 200 characters, which is the page's own wording; otherwise it is left out and
 * reported. A sentence longer than 200 characters is cut at a word, as before.
 */
function whatChecked(
  ctx: Ctx,
  anchor: string,
  label: string,
  what: string | undefined,
): string | undefined {
  const w = whatFrom(what);
  if (w === undefined) return undefined;
  if (isPageUnit(ctx.ix, w)) return w;
  const { sentences } = pageUnits(ctx.ix);
  const q = squash(w);
  const widened = sentences
    .filter((s) => s.length <= WHAT_MAX && s.includes(q))
    .sort((a, b) => a.length - b.length)[0];
  if (widened !== undefined) {
    const out = whatFrom(widened);
    if (out !== undefined) {
      ctx.c.rewritten.push({
        spec: ctx.spec,
        page: ctx.ix.page.title,
        anchor,
        what: label,
        reason: `description was a fragment ("${q.slice(0, 60)}"); widened to its sentence`,
      });
      return out;
    }
  }
  if (q.length >= WHAT_MAX - 60 && sentences.some((s) => s.length > WHAT_MAX && s.startsWith(q)))
    return w;
  ctx.c.skipped.push({
    spec: ctx.spec,
    page: ctx.ix.page.title,
    anchor,
    what: label,
    reason: "description is not a sentence of the page; omitted",
  });
  return undefined;
}

export interface RowOpts {
  what?: string;
  shortcut?: string;
  risk?: Risk;
  parent?: DraftRef | null;
  anchor: string;
  quote?: string;
  confidence?: Confidence;
  container?: boolean;
  label?: string;
  /** The key's last segment is a control name the page states in running prose (see `labelChecked`). */
  named?: boolean;
  /** What the pages do not settle about the row (see `Draft.unverified`). */
  unverified?: readonly string[];
  /** The parent is derived from the key paths when the rows are finalized (see `Draft.parentByPath`). */
  parentByPath?: boolean;
}

/** Adds one `ui` row. Returns its ref (also when it was a duplicate, so children can still hang off it). */
export function addUi(ctx: Ctx, kind: Kind, path: readonly string[], o: RowOpts): DraftRef {
  const segs = path.map((s) => normalizeLabel(keySeg(s))).filter((s) => s.length > 0);
  const ref = uiRef(ctx.module, kind, segs);
  if (segs.length === 0) return ref;
  const added = ctx.c.add({
    ...ref,
    label: labelChecked(ctx, o.anchor, o.label ?? segs[segs.length - 1], o.named),
    what: whatChecked(ctx, o.anchor, segs[segs.length - 1], o.what),
    shortcut: o.shortcut ? safeText(o.shortcut) : undefined,
    risk: o.risk,
    parent: o.parent ?? null,
    page: ctx.ix.page.title,
    anchor: o.anchor,
    quote: quoteFrom(ctx.ix, o.quote),
    confidence: o.confidence ?? "high",
    container: o.container,
    spec: ctx.spec,
    parentByPath: o.parentByPath,
  });
  if (added !== null) for (const u of o.unverified ?? []) ctx.c.note(ctx.c.all.get(added), u);
  return ref;
}

/**
 * A shortcut row for something that has a default shortcut. It sits beside that
 * item, so unless the caller names a parent it takes the item (the row with the same
 * key path) or the nearest emitted ancestor as its parent when the rows are finalized.
 */
function addShortcut(
  ctx: Ctx,
  path: readonly string[],
  shortcut: string,
  o: RowOpts & { gesture?: boolean },
): void {
  addUi(ctx, o.gesture ? "canvas-gesture" : "shortcut", path, {
    ...o,
    shortcut,
    parentByPath: o.parent == null ? true : undefined,
  });
}

// ── Cell and list helpers ─────────────────────────────────────────────────────

/** The cell covering column `col` of row `r`, honouring rowspans of earlier rows. */
export function gridCell(table: Table, r: number, col: number): Cell | undefined {
  for (let k = r; k >= 0; k--) {
    for (const cell of table.rows[k].cells) {
      if (cell.col <= col && col < cell.col + cell.colspan && k + cell.rowspan > r) return cell;
    }
  }
  return undefined;
}

/** True when every cell of the row is a header cell. */
export function isHeaderRow(row: Row): boolean {
  return row.cells.length > 0 && row.cells.every((c) => c.header);
}

/** Splits `Label<br>what` and `'''Label''': what` item texts. */
export function splitItem(raw: string): { label: string; what?: string } {
  const bold = /^'''(.+?)'''\s*(?::|→|&rarr;|[-–—]\s)?\s*(.*)$/.exec(raw.trim());
  if (bold) {
    const label = cleanWiki(bold[1]).replace(/\s*:$/, "");
    // A shortcut written right after the label is a shortcut, not description; one inside a sentence stays.
    const rest = cleanWiki(bold[2].replace(/^(?:\{\{Controls\|[^}]*\}\}\s*)+/, ""));
    return rest ? { label, what: rest } : { label };
  }
  const br = /<br\s*\/?>/i.exec(raw);
  if (br) {
    const label = cleanWiki(raw.slice(0, br.index));
    const what = cleanWiki(raw.slice(br.index + br[0].length));
    return what ? { label, what } : { label };
  }
  return { label: cleanWiki(raw) };
}

/** Trailing `(Ctrl+N)` shortcut of a phrase item: `create new workspace ({{Controls|Ctrl|N}})`. */
export function splitTrailingShortcut(raw: string): { text: string; shortcut?: string } {
  const m = /^(.*?)\s*\((\{\{Controls\|[^)]*\}\})\)\s*$/.exec(raw);
  if (!m) return { text: cleanWiki(raw) };
  return { text: cleanWiki(m[1]), shortcut: shortcutText(m[2]) };
}

function lineList(raw: string): string[] {
  return raw.split("\n");
}

// ── Mappers ───────────────────────────────────────────────────────────────────

export interface MenuTableOpts {
  /** Anchor of the section holding the per-menu headings (`Window_Menu`), for what and shortcuts. */
  headingRoot?: string;
  /** Menu or item label (lowercase) -> label the table uses. */
  synonyms?: Record<string, string>;
  /** Risk hints by item label. */
  risk?: Record<string, Risk>;
}

/**
 * A menu table: header row, then one row per menu with the menu title in a
 * header cell and its items as a bullet list in the next cell (`**` marks a
 * sub-menu). Menu and item rows come from the table (confidence high); the
 * headings below `headingRoot` add descriptions and shortcuts, and items the
 * table lacks (confidence medium).
 */
export function mapMenuTable(ctx: Ctx, table: Table, opts: MenuTableOpts = {}): void {
  ctx.c.markTable(ctx.ix.page.title, table, ctx.spec);
  const anchor = table.section || `table-${table.index}`;
  const walk = (items: ListItem[], base: string[], parent: DraftRef): void => {
    for (const it of items) {
      const { label, what } = splitItem(it.raw);
      if (!label) continue;
      const path = [...base, label];
      const risk = opts.risk?.[label];
      if (it.children.length) {
        const ref = addUi(ctx, "menu", path, {
          what,
          parent,
          anchor,
          quote: it.raw,
          container: true,
          risk,
        });
        walk(it.children, path, ref);
      } else {
        addUi(ctx, "menu-item", path, { what, parent, anchor, quote: it.raw, risk });
      }
    }
  };
  table.rows.forEach((row) => {
    if (isHeaderRow(row)) return;
    const [titleCell, listCell] = row.cells;
    if (!titleCell || !listCell) return;
    const title = cleanWiki(titleCell.raw);
    if (!title) return;
    const menu = addUi(ctx, "menu", [title], {
      parent: null,
      anchor,
      quote: titleCell.raw,
      container: true,
    });
    walk(parseList(lineList(listCell.raw)), [title], menu);
  });
  if (opts.headingRoot) enrichMenusFromHeadings(ctx, opts);
}

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function enrichMenusFromHeadings(ctx: Ctx, opts: MenuTableOpts): void {
  const { ix, c } = ctx;
  const root = ix.byAnchor.get(opts.headingRoot ?? "");
  if (!root) return;
  const syn = opts.synonyms ?? {};
  const canon = (l: string): string => syn[norm(l)] ?? norm(l);
  const drafts = (): Draft[] =>
    [...c.all.values()].filter((d) => d.spec === ctx.spec && d.dim === "ui");
  const pathOf = (d: Draft): string[] => (d.key.path ?? []).map(unkey);
  for (const mh of descendants(ix, root).filter((h) => h.level === root.level + 1)) {
    const menu = c.find("menu", ctx.module, [mh.text]);
    if (!menu) continue;
    menu.what ??= whatFrom(firstSentence(bodyLines(ix, mh)));
    const sub = descendants(ix, mh);
    for (const h of sub) {
      const rel = h.level - mh.level; // 1 = item, 2 = item of a sub-menu
      const body = bodyLines(ix, h);
      const what = whatFrom(firstSentence(body));
      const shortcut = shortcutIn(body);
      const label = h.text;
      // Existing draft: same label (after synonyms) directly under this menu, or anywhere in it.
      const inMenu = drafts().filter((d) => pathOf(d)[0] === mh.text && pathOf(d).length > 1);
      const parentHeading =
        rel >= 2 ? sub.filter((p) => p.level === h.level - 1 && p.line < h.line).pop() : undefined;
      const wantedBase = rel === 1 ? [mh.text] : [mh.text, parentHeading?.text ?? ""];
      const exact = inMenu.find(
        (d) =>
          canon(pathOf(d)[pathOf(d).length - 1]) === canon(label) &&
          pathOf(d).slice(0, -1).join("\u0000") === wantedBase.join("\u0000"),
      );
      const loose =
        exact ?? inMenu.find((d) => canon(pathOf(d)[pathOf(d).length - 1]) === canon(label));
      let target = loose;
      if (!target && rel === 1) {
        const next = sub[sub.indexOf(h) + 1];
        const hasKids = next !== undefined && next.level > h.level;
        const ref = addUi(ctx, hasKids ? "menu" : "menu-item", [mh.text, label], {
          what,
          parent: uiRef(ctx.module, "menu", [mh.text]),
          anchor: h.anchor,
          quote: h.raw,
          confidence: "medium",
          container: hasKids ? false : undefined,
        });
        target = c.find(ref.kind, ref.module, (ref.key.path ?? []).map(unkey));
      }
      if (!target) continue;
      target.what ??= what;
      if (shortcut) {
        target.shortcut ??= shortcut;
        addShortcut(ctx, [mh.text, ...pathOf(target).slice(1)], shortcut, {
          what: target.what,
          parent: null,
          anchor: h.anchor,
          quote: h.raw,
          confidence: "medium",
        });
      }
    }
  }
}

export interface ContextTableOpts {
  /** Parent row of the context menus (a panel), if the page names one. */
  parent?: DraftRef | null;
  /** Use this name for the context menu of a one-row table. */
  singleName?: string;
}

/**
 * Context-menu table: one row per context (first cell), the entries as a
 * bullet list in the second cell; an entry with sub-entries is a nested menu.
 */
export function mapContextTable(ctx: Ctx, table: Table, opts: ContextTableOpts = {}): void {
  ctx.c.markTable(ctx.ix.page.title, table, ctx.spec);
  const anchor = table.section || `table-${table.index}`;
  const walk = (items: ListItem[], base: string[], parent: DraftRef): void => {
    for (const it of items) {
      const { label, what } = splitItem(it.raw);
      if (!label) continue;
      const path = [...base, label];
      if (it.children.length) {
        const ref = addUi(ctx, "context-menu", path, {
          what,
          parent,
          anchor,
          quote: it.raw,
          container: true,
        });
        walk(it.children, path, ref);
      } else addUi(ctx, "context-item", path, { what, parent, anchor, quote: it.raw });
    }
  };
  for (const row of table.rows) {
    if (isHeaderRow(row) || row.cells.length < 2) continue;
    const [nameCell, listCell] = row.cells;
    const name =
      opts.singleName && table.rows.filter((r) => !isHeaderRow(r)).length === 1
        ? opts.singleName
        : cleanWiki(nameCell.raw);
    if (!name) continue;
    const menu = addUi(ctx, "context-menu", [name], {
      parent: opts.parent ?? null,
      anchor,
      quote: nameCell.raw,
      container: true,
    });
    walk(parseList(lineList(listCell.raw)), [name], menu);
  }
}

export interface ColsOpts {
  /** Kind of every row, or a function of the row's cells (e.g. gesture when the key is a mouse chord). */
  kind: Kind | ((cells: { label: string; key: string }) => Kind);
  label: number;
  what?: number;
  /** Column holding the shortcut / key text. */
  shortcut?: number;
  /** Path group: `header` = the table's first row (a single header cell with colspan), or a fixed name. */
  group?: "header" | string;
  base?: readonly string[];
  parent?: DraftRef | null;
  /** The label is the first heading inside the label cell (File Types, tool-option tables). */
  headingLabel?: boolean;
  confidence?: Confidence;
  risk?: Risk;
  /** Rows whose label matches are notes, not entries. */
  skipLabel?: RegExp;
  /**
   * A reason to leave a row out because the same thing is already a row (undefined: emit it).
   * `raw` is the row's label cell and key cell as the page writes them (first line, trimmed).
   */
  skipRow?: (label: string, key: string, raw: { label: string; key: string }) => string | undefined;
}

/** The page's maintenance template `{{Wiki|TODO|...}}` in a block of wikitext, verbatim; undefined when there is none. */
export function todoTemplate(raw: string): string | undefined {
  return /\{\{\s*Wiki\s*\|\s*TODO\b(?:(?!\}\}).)*\}\}/is.exec(raw)?.[0];
}

const MOUSE_RE = /\b(?:LMB2?|MMB|RMB|MSW[UD]?|Mouse|Mousewheel|Scroll Wheel)\b/i;

/** Mouse chords (`Ctrl+LMB`, `Shift+Mouse up`) are canvas gestures, everything else a shortcut. */
export function isMouseChord(s: string): boolean {
  return MOUSE_RE.test(s);
}

/**
 * Generic two-or-more column table to rows. Header rows (all header cells) and
 * the leading group row are skipped; a row with an empty label or an empty
 * key (when `shortcut` is set) is skipped.
 */
export function mapColumnsTable(ctx: Ctx, table: Table, opts: ColsOpts): void {
  ctx.c.markTable(ctx.ix.page.title, table, ctx.spec);
  const anchor = table.section || `table-${table.index}`;
  let group: string | undefined;
  if (opts.group === "header") {
    const first = table.rows[0];
    if (first && isHeaderRow(first) && first.cells.length === 1)
      group = cleanWiki(first.cells[0].raw);
  } else group = opts.group;
  table.rows.forEach((row, r) => {
    if (isHeaderRow(row)) return;
    const cell = (col: number | undefined): Cell | undefined =>
      col === undefined ? undefined : gridCell(table, r, col);
    const labelCell = cell(opts.label);
    if (!labelCell) return;
    const label = opts.headingLabel
      ? (labelCell.headings[0]?.text ?? "")
      : cleanWiki(labelCell.raw);
    const keyCell = cell(opts.shortcut);
    const key = keyCell ? shortcutText(keyCell.raw) : "";
    if (label && opts.skipLabel?.test(label)) {
      ctx.c.skipped.push({
        spec: ctx.spec,
        page: ctx.ix.page.title,
        anchor,
        what: label.slice(0, 80),
        reason: "row is a note, not an entry",
      });
      return;
    }
    if (!label || (opts.shortcut !== undefined && !key)) {
      ctx.c.skipped.push({
        spec: ctx.spec,
        page: ctx.ix.page.title,
        anchor,
        what: row.cells
          .map((x) => x.text)
          .join(" | ")
          .slice(0, 80),
        reason: "row with an empty label or key",
      });
      return;
    }
    const dup = opts.skipRow?.(label, key, {
      label: (lineList(labelCell.raw)[0] ?? "").trim(),
      key: (keyCell ? (lineList(keyCell.raw)[0] ?? "") : "").trim(),
    });
    if (dup) {
      ctx.c.skipped.push({
        spec: ctx.spec,
        page: ctx.ix.page.title,
        anchor,
        what: label.slice(0, 80),
        reason: dup,
      });
      return;
    }
    const kind = typeof opts.kind === "function" ? opts.kind({ label, key }) : opts.kind;
    const path = [...(opts.base ?? []), ...(group ? [group] : []), label];
    const whatCell = cell(opts.what);
    const whatLine = whatCell ? lineList(whatCell.raw)[0] : undefined;
    const rowAnchor = opts.headingLabel ? (labelCell.headings[0]?.anchor ?? anchor) : anchor;
    // A maintenance TODO in the description cell is no description (`cleanWiki` prints nothing
    // for it, so `what` is left out); the row says the page carries it, since the editors' note
    // may be speculative.
    const todo = whatCell ? todoTemplate(whatCell.raw) : undefined;
    addUi(ctx, kind, path, {
      unverified: todo
        ? [
            `The page carries a maintenance TODO in this row's description cell, not a description: ${todo}`,
          ]
        : undefined,
      what: whatLine !== undefined ? cleanWiki(whatLine) : undefined,
      shortcut: kind === "shortcut" || kind === "canvas-gesture" ? key || undefined : undefined,
      parent: opts.parent ?? null,
      anchor: rowAnchor,
      quote: opts.headingLabel ? labelCell.headings[0]?.raw : labelCell.raw,
      confidence: opts.confidence ?? "high",
      risk: opts.risk,
    });
  });
}

export interface BulletOpts {
  /** Kind of each item at depth 1, 2, ... (null: not emitted but still walked). */
  kinds: (Kind | null)[];
  base?: readonly string[];
  parent?: DraftRef | null;
  /** Items are `'''Label''': text` (bold) or plain phrases; `label` picks the rule. */
  labels: "bold" | "phrase" | "links";
  confidence?: Confidence;
  /** Only items whose raw text matches (after the first depth). */
  skip?: (label: string) => boolean;
  /** Take only the sub-list under the first item whose label starts with this. */
  pick?: string;
  /** Key the section by this anchor instead of the nearest heading (when the list is in a table cell). */
  anchor?: string;
  risk?: Risk;
  /** Also emit a shortcut row for an item that names a default shortcut. */
  shortcutRows?: boolean;
}

/** Link labels of a list item: `[[#Outline|'''Outline''']] and [[#Projects|'''Projects''']]` or `{{Link|#Workspace}}`. */
export function linkLabels(raw: string): string[] {
  const out: string[] = [];
  for (const m of raw.matchAll(
    /\[\[#?[^|\]]*\|(?:''')?([^'\]]+?)(?:''')?\s*\]\]|\{\{Link\|#?([^|}]+)(?:\|([^}]*))?\}\}/g,
  )) {
    const label = (m[1] ?? m[3] ?? m[2] ?? "").trim();
    if (label) out.push(label);
  }
  return out;
}

/** `label: description` or `label - description` in a plain phrase (the left part is short). */
export function splitPhrase(text: string): { label: string; what?: string } {
  const t = text.trim().replace(/:$/, "");
  const colon = /^(.{1,40}?):\s+(.+)$/.exec(t);
  if (colon) return { label: colon[1].trim(), what: colon[2].trim() };
  const dash = /^(.{1,60}?)\s[-–—]\s(.+)$/.exec(t);
  if (dash) return { label: dash[1].trim(), what: dash[2].trim() };
  if (t.length > 60) {
    // A long phrase: the label stops at the first parenthesis or comma.
    const at = [t.indexOf(" ("), t.indexOf(", ")].filter((i) => i > 8).sort((a, b) => a - b)[0];
    if (at !== undefined) {
      return {
        label: t.slice(0, at).trim(),
        what: t
          .slice(at)
          .replace(/^[\s,(]+|\)\s*$/g, "")
          .trim(),
      };
    }
  }
  return { label: t };
}

/** First prose sentence under a heading, looking through its sub-headings (`Summary`). */
export function whatOfHeading(ix: PageIndex, h: Heading): string | undefined {
  const prose = subtreeLines(ix, h).filter((l) => !/^=/.test(l.text.trim()));
  return firstSentence(prose);
}

/** Lines before the first non-cell heading. */
export function leadLines(ix: PageIndex): { line: number; text: string }[] {
  const end = ix.sections[0]?.line ?? ix.lines.length + 1;
  const out: { line: number; text: string }[] = [];
  for (let n = 1; n < end; n++)
    if (!insideTable(ix, n)) out.push({ line: n, text: ix.lines[n - 1] });
  return out;
}

/** Items of the lists inside `lines` (page lines with their numbers) as rows. */
export function mapBullets(
  ctx: Ctx,
  lines: readonly { line: number; text: string }[],
  opts: BulletOpts,
): void {
  const items = parseList(
    lines.map((l) => l.text),
    lines[0]?.line ?? 1,
  );
  const emit = (list: ListItem[], base: string[], parent: DraftRef | null, depth: number): void => {
    for (const it of list) {
      const kind = opts.kinds[Math.min(depth, opts.kinds.length) - 1] ?? null;
      const anchor = opts.anchor ?? (sectionAt(ctx.ix, it.line) || "");
      let labels: { label: string; what?: string; shortcut?: string; anchor?: string }[];
      if (opts.labels === "links") {
        labels = linkLabels(it.raw).map((l) => {
          const h = ctx.ix.byAnchor.get(anchorOf(l));
          return { label: l, what: h ? whatOfHeading(ctx.ix, h) : undefined, anchor: h?.anchor };
        });
      } else if (opts.labels === "bold") {
        const s = splitItem(it.raw);
        const sc = /\{\{Controls\|[^}]*\}\}/.exec(it.raw);
        labels = [{ label: s.label, what: s.what, shortcut: sc ? shortcutText(sc[0]) : undefined }];
      } else {
        const t = splitTrailingShortcut(it.raw);
        const s = splitItem(t.text === cleanWiki(it.raw) ? it.raw : t.text);
        const p = s.what === undefined ? splitPhrase(s.label) : s;
        labels = [{ label: p.label, what: p.what, shortcut: t.shortcut }];
      }
      let childParent = parent;
      let childBase = base;
      for (const l of labels) {
        if (!l.label || opts.skip?.(l.label)) continue;
        if (kind) {
          const ref = addUi(ctx, kind, [...base, l.label], {
            what: l.what,
            shortcut: l.shortcut,
            parent,
            anchor: l.anchor ?? anchor,
            quote: it.raw,
            confidence: opts.confidence,
            container: it.children.length > 0 ? true : undefined,
            risk: opts.risk,
          });
          childParent = ref;
          childBase = [...base, l.label];
          if (opts.shortcutRows && l.shortcut && kind !== "shortcut") {
            addShortcut(ctx, [...base, l.label], l.shortcut, {
              what: l.what,
              parent: null,
              anchor,
              quote: it.raw,
              confidence: opts.confidence,
            });
          }
        }
      }
      if (it.children.length) emit(it.children, childBase, childParent, depth + 1);
    }
  };
  let forest = items;
  if (opts.pick) {
    const hit = (function find(list: ListItem[]): ListItem | undefined {
      for (const it of list) {
        if (cleanWiki(it.raw).toLowerCase().startsWith(opts.pick!.toLowerCase())) return it;
        const k = find(it.children);
        if (k) return k;
      }
      return undefined;
    })(items);
    forest = hit ? hit.children : [];
  }
  emit(forest, [...(opts.base ?? [])], opts.parent ?? null, 1);
}

export interface FeatureTableOpts {
  /** Path prefix of every row (tool and tab). */
  base: readonly string[];
  parent: DraftRef;
  confidence?: Confidence;
}

/** Label and description of one list item or bold-led line of a feature table; null for prose. */
export function featureItemLabel(raw: string): { label: string; what?: string } | null {
  if (/^'''.+?'''/.test(raw.trim())) {
    const s = splitItem(raw);
    return s.label ? s : null;
  }
  const m = /^(.{1,40}?)\s[-–—]\s(.+)$/.exec(cleanWiki(raw));
  if (m && !/[.!?]$/.test(m[1])) return { label: m[1].trim(), what: m[2].trim() };
  return null;
}

/**
 * A `Feature | Screenshot | Description` or `Step | Screenshot | Description`
 * table (Terrain Creation Tool, Paint and Info & Diags). The first cell holds a
 * section title, not a control, so it is not a row. The controls are inside the
 * Description cell: bold-led lines, bullets (labelled by a bold phrase or by
 * `label – description`), and sub-headings. A sub-heading followed by labelled
 * bullets is a group (a path segment); one followed by prose is an option.
 * Numbered lists are procedure steps and prose is prose: neither is a row.
 */
export function mapFeatureTable(ctx: Ctx, table: Table, o: FeatureTableOpts): void {
  const { ix } = ctx;
  ctx.c.markTable(ix.page.title, table, ctx.spec);
  const anchorOfTable = table.section || `table-${table.index}`;
  const confidence = o.confidence ?? "medium";
  table.rows.forEach((row) => {
    if (isHeaderRow(row)) return;
    const title = row.cells[0]?.headings[0];
    if (!title) return;
    ctx.c.skipped.push({
      spec: ctx.spec,
      page: ix.page.title,
      anchor: title.anchor,
      what: title.text,
      reason:
        "feature table row title (a section of the tab, not a control); its controls are rows of their own",
    });
    // The row's lines: from its title to the next row separator or the end of the table.
    const lines: { line: number; text: string }[] = [];
    for (let n = title.line + 1; n <= table.endLine; n++) {
      const t = ix.lines[n - 1].trim();
      if (t.startsWith("|-") || t.startsWith("|}")) break;
      lines.push({ line: n, text: t.replace(/^\|\s?/, "") });
    }
    // Split at sub-headings.
    interface Block {
      heading?: Heading;
      lines: { line: number; text: string }[];
    }
    const blocks: Block[] = [{ lines: [] }];
    for (const l of lines) {
      const h = headingOfLine(l.text);
      if (h) {
        const found = ix.parsed.headings.find((x) => x.line === l.line);
        if (found) {
          blocks.push({ heading: found, lines: [] });
          continue;
        }
      }
      blocks[blocks.length - 1].lines.push(l);
    }
    for (const b of blocks) {
      // Items of the block: bold-led lines and bullets whose label the line states.
      const items: { label: string; what?: string; raw: string; line: number }[] = [];
      const labelled: (boolean | undefined)[] = [];
      for (const l of b.lines) {
        const m = /^(\*+)\s*(.*)$/.exec(l.text);
        const raw = m ? m[2] : l.text;
        const depth = m ? m[1].length : 0;
        if (!m && !/^'''.+?'''/.test(raw)) continue;
        if (/^#/.test(l.text)) continue;
        // A bullet below an unlabelled bullet (a legend or a remark) is part of that remark.
        if (depth > 1 && labelled[depth - 1] === false) {
          labelled[depth] = false;
          continue;
        }
        const it = featureItemLabel(raw);
        labelled[depth] = it !== null;
        labelled.length = depth + 1;
        if (it) items.push({ ...it, raw, line: l.line });
      }
      const group = b.heading && items.length > 0 ? b.heading.text : undefined;
      if (b.heading && items.length === 0) {
        // A sub-heading over prose: an option; its first sentence after a `range:` line is the description.
        const prose = b.lines.filter((l) => !/^range:/i.test(l.text.trim()));
        addUi(ctx, "option", [...o.base, b.heading.text], {
          what: firstSentence(prose),
          parent: o.parent,
          anchor: b.heading.anchor,
          quote: b.heading.raw,
          confidence,
        });
        continue;
      }
      for (const it of items) {
        addUi(ctx, "control", [...o.base, ...(group ? [group] : []), it.label], {
          what: it.what,
          parent: o.parent,
          anchor: b.heading?.anchor ?? title.anchor ?? anchorOfTable,
          quote: it.raw,
          confidence,
        });
      }
    }
  });
}

/**
 * `; Term` lines with the description on the line below (a MediaWiki definition
 * list written one term per line): one row per term.
 */
export function mapTermLines(
  ctx: Ctx,
  lines: readonly { line: number; text: string }[],
  o: {
    kind: Kind;
    base: readonly string[];
    parent: DraftRef;
    anchor: string;
    confidence?: Confidence;
  },
): void {
  lines.forEach((l, i) => {
    const m = /^;\s*(.+?)\s*$/.exec(l.text.trim());
    if (!m) return;
    const rest = lines.slice(i + 1);
    const stop = rest.findIndex((x) => /^;/.test(x.text.trim()));
    const body = (stop < 0 ? rest : rest.slice(0, stop)).filter((x) => x.text.trim() !== "");
    addUi(ctx, o.kind, [...o.base, cleanWiki(m[1])], {
      what: firstSentence(body),
      parent: o.parent,
      anchor: o.anchor,
      quote: l.text.trim(),
      confidence: o.confidence ?? "medium",
    });
  });
}

export interface HeadingOpts {
  /** Anchor of the section whose descendants are walked; null walks every heading of the page. */
  root: string | null;
  /** Kind by depth below the root heading (1 = direct children); null skips that depth. */
  kinds: (Kind | null)[];
  /** `leaf`: only headings without sub-headings; `all`: every heading with a kind. */
  mode: "leaf" | "all";
  /** Path prefix and parent of the emitted rows. */
  base?: readonly string[];
  parent?: DraftRef | null;
  /** Group headings (headings with sub-headings) become path segments below the nearest emitted ancestor. */
  groups?: boolean;
  /** Pull `Shortcut:` text into shortcut_default and a shortcut row. */
  shortcuts?: boolean;
  /** Choose the kind from the heading (overrides `kinds`). */
  kindOf?: (text: string, depth: number, parent: Heading | undefined) => Kind | null;
  confidence?: Confidence;
  skip?: (text: string) => boolean;
  /** Emit rows for these anchors only. */
  only?: readonly string[];
  /** Path prefix by kind, when it differs from `base` (tools carry no bar name). */
  baseFor?: (kind: Kind) => readonly string[];
  /** Heading text -> the name the page itself gives the same thing (a link target or a stated synonym). */
  alias?: Readonly<Record<string, string>>;
  /** A `control` whose body opens with "Checkbox:" is an `option` (the page says it is a tick box). */
  checkboxOption?: boolean;
}

/**
 * Rows from the headings below `root`: the heading text is the label, the
 * first prose sentence under it is `what`. A row's parent is the row of its
 * nearest emitted ancestor heading (else `parent`); with `groups`, group
 * headings that are not rows become path segments.
 */
export function mapHeadings(ctx: Ctx, o: HeadingOpts): void {
  const { ix } = ctx;
  let subs: Heading[];
  let rootLevel: number;
  if (o.root === null) {
    subs = ix.sections;
    rootLevel = 0;
  } else {
    const root = ix.byAnchor.get(o.root);
    if (!root) {
      ctx.c.skipped.push({
        spec: ctx.spec,
        page: ix.page.title,
        anchor: o.root,
        what: "section",
        reason: "root heading not found in the page",
      });
      return;
    }
    subs = descendants(ix, root);
    rootLevel = root.level;
  }
  const emitted = new Map<Heading, { ref: DraftRef; path: string[] }>();
  const seenNames = new Set<string>();
  const stack: Heading[] = [];
  subs.forEach((h, i) => {
    while (stack.length && stack[stack.length - 1].level >= h.level) stack.pop();
    const parentHeading = stack[stack.length - 1];
    const next = subs[i + 1];
    const leaf = !(next !== undefined && next.level > h.level);
    stack.push(h);
    const depth = h.level - rootLevel;
    const kind = o.kindOf
      ? o.kindOf(h.text, depth, parentHeading)
      : (o.kinds[Math.min(depth, o.kinds.length) - 1] ?? null);
    if (!kind || o.skip?.(h.text) || (o.only && !o.only.includes(h.anchor))) return;
    if (o.mode === "leaf" && !leaf) return;
    if (leaf && (kind === "control" || kind === "option") && commentOnlyBody(ix, h)) {
      ctx.c.skipped.push({
        spec: ctx.spec,
        page: ix.page.title,
        anchor: h.anchor,
        what: `${kind} ${h.text}`,
        reason:
          "section whose only content is an HTML comment (the page documents nothing under it)",
      });
      return;
    }
    // Nearest emitted ancestor and the group headings between it and this one.
    let ancestor: { ref: DraftRef; path: string[] } | undefined;
    const between: string[] = [];
    for (let k = stack.length - 2; k >= 0; k--) {
      const hit = emitted.get(stack[k]);
      if (hit) {
        ancestor = hit;
        break;
      }
      if (o.groups) between.unshift(stack[k].text);
    }
    const basePath = ancestor ? ancestor.path : [...(o.baseFor ? o.baseFor(kind) : (o.base ?? []))];
    const label = o.alias?.[h.text] ?? h.text;
    if (label !== h.text) {
      ctx.c.decisions.push({
        spec: ctx.spec,
        page: ix.page.title,
        anchor: h.anchor,
        what: h.text,
        reason: `the section's text points at the page of "${label}": one row, keyed by that name, with this section as its ref and "${h.text}" as its label`,
      });
    }
    // The same heading text twice under one place (`Snap to terrain`, a checkbox and then a button,
    // both under `Terrain Snapping`): the later one is a control of its own, so its path carries the
    // section heading that holds it.
    const sameName = `${[...basePath, ...between].join("\u0000")}\u0000${label}`;
    const section =
      o.root === null ? undefined : (parentHeading?.text ?? ix.byAnchor.get(o.root)?.text);
    const repeated = seenNames.has(sameName) && section !== undefined && section !== label;
    seenNames.add(sameName);
    const path = [...basePath, ...between, ...(repeated ? [section] : []), label];
    const body = bodyLines(ix, h);
    const what = firstSentence(body);
    const sc = o.shortcuts ? shortcutIn(body) : undefined;
    const firstLine = body.find((l) => l.text.trim() !== "")?.text ?? "";
    const rowKind: Kind =
      o.checkboxOption && kind === "control" && /^Checkbox:/i.test(firstLine.trim())
        ? "option"
        : kind;
    // One row kept for two page locations: the kept row says where the other one is and which
    // sentence of the page the merge rests on.
    const otherPage = /\{\{Link\|([^|}#]+)/.exec(firstLine)?.[1];
    const merged =
      label !== h.text
        ? [
            `One row stands for two page locations: the heading "${h.text}" here (wiki:${ix.slug}#${h.anchor}) and the page of "${label}"${otherPage ? ` (wiki:${titleSlug(otherPage)})` : ""}, which this section points at. They are merged on this sentence of the section: "${firstLine.trim()}". The pages do not state that they are one thing.`,
          ]
        : undefined;
    const ref = addUi(ctx, rowKind, path, {
      what,
      shortcut: sc,
      parent: ancestor ? ancestor.ref : (o.parent ?? null),
      anchor: h.anchor,
      quote: h.raw,
      confidence: o.confidence ?? "medium",
      // The page's own heading, when the key carries the name the page gives the same thing elsewhere.
      label: h.text,
      unverified: merged,
    });
    emitted.set(h, { ref, path });
    if (sc) {
      addShortcut(ctx, [...(o.base ?? []).slice(-1), label], sc, {
        what,
        parent: null,
        anchor: h.anchor,
        quote: h.raw,
        confidence: o.confidence ?? "medium",
        label: h.text,
        unverified: merged,
      });
    }
  });
}

/**
 * True when the lines under a heading (up to the next heading) are blank apart
 * from one or more HTML comments: the wiki editors hid whatever was there, so
 * the page documents nothing under the heading.
 */
export function commentOnlyBody(ix: PageIndex, h: Heading): boolean {
  const end = nextHeadingLine(ix, h);
  const raw = ix.page.text
    .split(/\r?\n/)
    .slice(h.line, end - 1)
    .join("\n");
  return raw.includes("<!--") && stripComments(raw).trim() === "";
}

export interface CuratedRow {
  kind: Kind;
  path: string[];
  what?: string;
  shortcut?: string;
  risk?: Risk;
  /** Parent by kind and path (same module unless `parentModule`). */
  parent?: { kind: Kind; path: string[]; module?: Module };
  /** Section anchor of the evidence ("" = lead section, no fragment). */
  anchor: string;
  /** Text that must occur verbatim in the page; it is also the row's quote. */
  quote: string;
  confidence?: Confidence;
  container?: boolean;
  /** Module different from the spec's. */
  module?: Module;
  /** The last path segment is a control name the page states in running prose (it keeps its label when the section holds those exact words). */
  named?: boolean;
}

/**
 * Rows read by hand from running text, each tied to a verbatim quote that is
 * checked against the export when the generator runs; a row whose quote is
 * not found (the export changed) is dropped and reported.
 */
export function mapCurated(ctx: Ctx, rows: readonly CuratedRow[]): void {
  for (const r of rows) {
    if (!ctx.ix.page.text.includes(r.quote)) {
      ctx.c.skipped.push({
        spec: ctx.spec,
        page: ctx.ix.page.title,
        anchor: r.anchor,
        what: `${r.kind} ${r.path.join(" > ")}`,
        reason: "curated quote not found in the export",
      });
      continue;
    }
    if (r.anchor !== "" && !ctx.ix.anchors.has(r.anchor)) {
      ctx.c.skipped.push({
        spec: ctx.spec,
        page: ctx.ix.page.title,
        anchor: r.anchor,
        what: `${r.kind} ${r.path.join(" > ")}`,
        reason: "curated anchor not found in the export",
      });
      continue;
    }
    const module = r.module ?? ctx.module;
    const sub: Ctx = { ...ctx, module };
    const parent = r.parent ? uiRef(r.parent.module ?? module, r.parent.kind, r.parent.path) : null;
    addUi(sub, r.kind, r.path, {
      what: r.what,
      shortcut: r.shortcut,
      risk: r.risk,
      parent,
      anchor: r.anchor,
      quote: r.quote,
      confidence: r.confidence ?? "medium",
      container: r.container,
      named: r.named,
    });
    if (r.shortcut && r.kind !== "shortcut" && r.kind !== "canvas-gesture") {
      addShortcut(sub, r.path, r.shortcut, {
        what: r.what,
        parent: null,
        anchor: r.anchor,
        quote: r.quote,
        confidence: r.confidence ?? "medium",
      });
    }
  }
}

// ── Special mappers ───────────────────────────────────────────────────────────

/** Adds one non-`ui` row (cli, file, link, diag). */
export function addRow(
  ctx: Ctx,
  dim: Dim,
  kind: Kind,
  key: ObservationKey,
  label: string,
  o: RowOpts,
): void {
  ctx.c.add({
    dim,
    kind,
    module: ctx.module,
    key,
    label: labelChecked(ctx, o.anchor, label),
    what: whatChecked(ctx, o.anchor, label, o.what),
    shortcut: undefined,
    risk: o.risk,
    parent: o.parent ?? null,
    page: ctx.ix.page.title,
    anchor: o.anchor,
    quote: quoteFrom(ctx.ix, o.quote),
    confidence: o.confidence ?? "high",
    container: o.container,
    spec: ctx.spec,
  });
}

/**
 * What the File Types table's "Saved/Used by" column names, as the module of the
 * editor it names (vocabulary of `src/census/vocab.ts`). The key is the cell's
 * plain text, lower case. The Resource Manager's own sub-editors map to their
 * `ResourceManager.<Sub>` module. A name that is not an editor of the vocabulary
 * (`Workbench`, `Resource Browser`, `Art Tools`, `3D software`, `Proprietary
 * format`, `Audio software`, `Animation offline debugger`) names no module.
 * E09 applies the same table to the same cells.
 */
export const FILE_TYPE_USED_BY_MODULE: Readonly<Record<string, Module>> = {
  "audio editor": "AudioEditor",
  "animation editor": "AnimEditor",
  "particle editor": "ParticleEditor",
  "string editor": "LocalizationEditor",
  "localization editor": "LocalizationEditor",
  "behavior editor": "BehaviorEditor",
  "procedural animation editor": "ProcAnimEditor",
  "world editor": "WorldEditor",
  "script editor": "ScriptEditor",
  "dialogue editor": "DialogueEditor",
  "navmesh generator tool": "NavmeshGeneratorMain",
  "resource manager": "ResourceManager",
  "resource manager's config editor": "ResourceManager.Config",
  "config editor": "ResourceManager.Config",
  "resource manager's layout editor": "ResourceManager.Layout",
  "resource manager's imageset editor": "ResourceManager.Imageset",
  "resource manager's model editor": "ResourceManager.Model",
  "resource manager's texture editor": "ResourceManager.Texture",
  "resource manager's material editor": "ResourceManager.Material",
  "resource manager's font viewer": "ResourceManager.Font",
  "resource manager's styles editor": "ResourceManager.Styles",
};

/**
 * Module of a file type from its "Saved/Used by" cell. The cell's alternatives
 * (`Animation Editor + various plugins`) are split at `+`, a trailing "(see ...)"
 * is dropped, and each part is looked up in `FILE_TYPE_USED_BY_MODULE`. Exactly
 * one distinct module found gives that module; none or several give `none`.
 */
export function fileTypeModule(usedByCell: string): Module {
  const text = cleanWiki(usedByCell)
    .replace(/\([^)]*\)/g, " ")
    .replace(/\u2019/g, "'");
  const found = new Set<Module>();
  for (const part of text.split("+")) {
    const m = FILE_TYPE_USED_BY_MODULE[squash(part).toLowerCase()];
    if (m !== undefined) found.add(m);
  }
  return found.size === 1 ? [...found][0] : "none";
}

/** File Types table: the extension is a heading in the first cell of each row. */
export function mapFileTypes(ctx: Ctx, table: Table): void {
  ctx.c.markTable(ctx.ix.page.title, table, ctx.spec);
  table.rows.forEach((row) => {
    if (isHeaderRow(row)) return;
    const [extCell, typeCell, usedByCell, descCell] = row.cells;
    const heading = extCell?.headings[0];
    const ext = heading?.text.replace(/^\.+/, "").trim().toLowerCase();
    if (!heading || !ext) {
      ctx.c.skipped.push({
        spec: ctx.spec,
        page: ctx.ix.page.title,
        anchor: table.section || `table-${table.index}`,
        what: row.cells
          .map((x) => x.text)
          .join(" | ")
          .slice(0, 80),
        reason: "row without an extension heading",
      });
      return;
    }
    // `what` is the table's own words: the first line of the Description cell, or the File Type
    // cell when the description is empty. The module is the editor the Saved/Used by cell names
    // (`fileTypeModule`); several editors or none named give `none`.
    const type = cleanWiki(typeCell?.raw ?? "");
    const descLine = descCell ? cleanWiki(lineList(descCell.raw)[0] ?? "") : "";
    const what = descLine || type;
    addRow(
      { ...ctx, module: fileTypeModule(usedByCell?.raw ?? "") },
      "file",
      "file-type",
      { ext },
      `.${ext}`,
      {
        what,
        anchor: heading.anchor,
        quote: heading.raw,
      },
    );
  });
}

/**
 * Sections of the Startup Parameters page. Every switch row carries module
 * `none`, as the executable (E05), shipped-docs (E08) and launch-log (E13)
 * enumerators write theirs: a module that differs between sources is a join
 * problem in the ledger, and a switch belongs to an executable, not to one
 * module window. The section a switch sits in goes into `what` only when the
 * page states it (module-specific sections say "Module" in their title).
 */
export const CLI_SECTIONS: readonly string[] = [
  "General",
  "Window",
  "Workbench",
  "Workbench - AnimationEditor Module",
  "Workbench - LocalizationEditor Module",
  "Workbench - NavmeshGeneratorMain Module",
  "Workbench - ResourceManager Module",
  "Workbench - ScriptEditor Module",
  "Workbench - WorldEditor Module",
  "Hosting",
  "Network Tuning",
  "Debug",
  "Profiling",
];

/** Risk hints of switches, from what the page says they do. */
export const CLI_RISK: Record<string, Risk> = {
  wbBackendLogin: "credential",
  publishAddon: "external",
  publishAddonDir: "external",
  publishAddonVersion: "external",
  publishAddonChangeNote: "external",
  publishAddonChangeNoteFile: "external",
  publishAddonPreviewImage: "external",
  publishAddonScreenshots: "external",
  clearSettings: "destructive",
  packAddon: "mutating",
  buildData: "mutating",
  forceSaveAll: "mutating",
  autogenerate: "mutating",
};

/**
 * Startup Parameters: every level-3 heading under a level-2 section is one
 * switch (`=== addons ===` or `{{ArgTitle|3|addonTempDir|...}}`). A switch
 * under two sections (`saveDir`) is one row (the same id); the second
 * occurrence is reported as a duplicate.
 */
export function mapCliHeadings(ctx: Ctx): number {
  const { ix } = ctx;
  const seen = new Set<string>();
  let count = 0;
  let section: Heading | undefined;
  const subs = ix.sections;
  subs.forEach((h, i) => {
    if (h.level === 2) {
      section = h;
      return;
    }
    if (h.level !== 3 || !section) return;
    if (!CLI_SECTIONS.includes(section.text)) {
      ctx.c.skipped.push({
        spec: ctx.spec,
        page: ix.page.title,
        anchor: h.anchor,
        what: h.text,
        reason: `section "${section.text}" is not a known Startup Parameters section`,
      });
      return;
    }
    const name = h.text.replace(/^-+/, "");
    // Body: own lines; a heading with no body shares the next heading's text (posX / posY).
    let body = bodyLines(ix, h);
    for (
      let k = i + 1;
      body.every((l) => l.text.trim() === "") && k < subs.length && subs[k].level === 3;
      k++
    ) {
      body = bodyLines(ix, subs[k]);
    }
    const own = body.find((l) => new RegExp(`\\{\\{hl\\|-${name}\\b`, "i").test(l.text));
    let what = firstSentence(own ? [own] : body);
    if (what !== undefined && what.replace(/^-+/, "").toLowerCase() === name.toLowerCase())
      what = undefined;
    const quoteLine = own?.text ?? body.find((l) => l.text.trim() !== "")?.text;
    if (seen.has(name)) {
      ctx.c.duplicates.push({
        spec: ctx.spec,
        page: ix.page.title,
        anchor: h.anchor,
        what: `-${name}`,
        reason: `also documented under "${section.text}" (same id as the first occurrence)`,
      });
      return;
    }
    seen.add(name);
    addRow(ctx, "cli", "cli-switch", { switch: name }, h.text, {
      what,
      anchor: h.anchor,
      quote: quoteLine,
      risk: CLI_RISK[name],
    });
    count++;
  });
  return count;
}

/** Table with a `Parameters | Values | Description` header (the Autotest command line). */
export function mapCliTable(ctx: Ctx, table: Table): void {
  ctx.c.markTable(ctx.ix.page.title, table, ctx.spec);
  table.rows.forEach((row) => {
    if (isHeaderRow(row)) return;
    const written = cleanWiki(row.cells[0]?.raw ?? "");
    const name = written.replace(/^-+/, "");
    if (!/^[A-Za-z][\w-]*$/.test(name)) return;
    addRow(ctx, "cli", "cli-switch", { switch: name }, written, {
      what: cleanWiki(row.cells[2]?.raw ?? ""),
      anchor: table.section || `table-${table.index}`,
      quote: row.cells[0]?.raw,
    });
  });
}

/** Workbench Links: one link-format row per module base link, plus the protocol and the web redirect. */
export function mapLinks(ctx: Ctx, table: Table): void {
  ctx.c.markTable(ctx.ix.page.title, table, ctx.spec);
  const anchor = table.section || `table-${table.index}`;
  let noFile = false;
  let noFileSentence = "";
  table.rows.forEach((row, r) => {
    if (isHeaderRow(row)) return;
    if (row.cells.length === 1 && row.cells[0].colspan >= 2) {
      // "The following modules do not support a file parameter..."
      noFile = /do not support a file parameter/i.test(row.cells[0].text);
      if (noFile) noFileSentence = row.cells[0].text;
      return;
    }
    const base = cleanWiki(gridCell(table, r, 2)?.raw ?? "");
    if (!/^enfusion:\/\/[A-Za-z]+$/.test(base)) return;
    // `what` is the page's own sentence: the banner row that says the following modules take no
    // file parameter. The parameter lists of Script Editor and World Editor are bullet lists, not
    // sentences, and are not carried.
    const what = noFile ? noFileSentence : undefined;
    // The module a link opens is the table's own "Module Name" cell (exact vocabulary names).
    const named = cleanWiki(gridCell(table, r, 1)?.raw ?? "");
    const module = (MODULES as readonly string[]).includes(named) ? (named as Module) : "none";
    addRow({ ...ctx, module }, "link", "link-format", { name: base }, base, {
      what,
      anchor,
      quote: row.cells[2]?.raw ?? row.cells[0].raw,
    });
  });
}

/** Rows of an AI-debug-panel style availability table: `Data | Groups | Characters`, icons checked / unchecked. */
export function mapAvailabilityTable(
  ctx: Ctx,
  table: Table,
  base: readonly string[],
  parent: DraftRef,
): void {
  ctx.c.markTable(ctx.ix.page.title, table, ctx.spec);
  const anchor = table.section || `table-${table.index}`;
  table.rows.forEach((row) => {
    if (row.cells.length < 3 || row.cells[0].header) return;
    const label = cleanWiki(row.cells[0].raw);
    // The Groups / Characters columns are check icons, not sentences: not carried in `what`.
    if (!label) return;
    addUi(ctx, "control", [...base, label], {
      parent,
      anchor,
      quote: row.cells[0].raw,
    });
  });
}

/** Diag Menu: only the top-level menus (level-1 headings); its option tables are E14's. */
export function mapDiagSkeleton(ctx: Ctx): number {
  let n = 0;
  for (const h of ctx.ix.sections) {
    if (h.level !== 1 || h.text === "General Use") continue;
    addRow(ctx, "diag", "diag-menu", { path: [h.text] }, h.text, {
      anchor: h.anchor,
      quote: h.raw,
      parent: null,
    });
    n++;
  }
  return n;
}

// ── Specs ─────────────────────────────────────────────────────────────────────

const AR = "Arma Reforger:";

export interface SpecEnv {
  pages: Map<string, PageIndex>;
  c: Collector;
  missing: string[];
}

function ctxOf(env: SpecEnv, title: string, module: Module, spec: string): Ctx | null {
  const ix = env.pages.get(title);
  if (!ix) {
    env.missing.push(title);
    return null;
  }
  return { c: env.c, ix, module, spec };
}

function sectionLines(ix: PageIndex, anchor: string): { line: number; text: string }[] {
  const h = ix.byAnchor.get(anchor);
  return h ? bodyLines(ix, h) : [];
}

function tableAt(ix: PageIndex, n: number): Table | undefined {
  return ix.parsed.tables.find((t) => t.index === n);
}

/** Tables of `ix` whose section anchor is `section`, in order. */
function tablesIn(ix: PageIndex, section: string): Table[] {
  return ix.parsed.tables.filter((t) => t.section === section);
}

const TOOL_RE = /\btool$/i;

type SpecFn = (env: SpecEnv) => void;

function curatedSpec(
  id: string,
  title: string,
  module: Module,
  rows: readonly CuratedRow[],
): { id: string; fn: SpecFn } {
  return {
    id,
    fn: (env) => {
      const ctx = ctxOf(env, title, module, id);
      if (ctx) mapCurated(ctx, rows);
    },
  };
}

/** Parent panels and containers named by several specs. */
const REF = {
  rmBrowser: uiRef("ResourceManager", "panel", ["Resource Browser"]),
};

/**
 * General Shortcuts rows of the Resource Manager page that describe an action
 * the Window or Edit menu section already lists with the same key: the menu row
 * is the one kept.
 */
const RM_GENERAL_TWINS: Readonly<Record<string, readonly string[]>> = {
  "Closes active tab": ["Window", "Close Current Tab"],
  "Cycles between opened tab": ["Window", "Cycle Tabs"],
  "Locates active resource in Resource Browser": ["Edit", "Locate file in resource browser"],
  "Reimports active resource": ["Edit", "Reimport resource"],
  "Opens/closes Resource Browser window": ["Window", "Resource Browser"],
  "Opens/closes log console": ["Window", "Log Console"],
};

/**
 * The page contradicts itself on the tab keys: the General Shortcuts table calls Ctrl+Page Up
 * "Next tab" and Ctrl+Page Down "Previous tab"; the Window Menu section gives Ctrl+PageUp to
 * "Previous Tab" and Ctrl+PageDown to "Next Tab". Neither side is right as far as the page goes,
 * so nothing is merged or dropped: both rows are kept, each with an `unverified` statement of
 * the contradiction that cites the other section. [General Shortcuts label, Window menu item,
 * Window Menu section heading anchor]
 */
const RM_TAB_KEY_CONTRADICTIONS: readonly (readonly [string, string, string])[] = [
  ["Next tab", "Prev Tab", "Previous_Tab"],
  ["Previous tab", "Next Tab", "Next_Tab"],
];

/** The page line (comments removed, list marker dropped, trimmed) that holds `text`, as the page writes it; undefined when none does. */
function lineHolding(ix: PageIndex, text: string | undefined): string | undefined {
  if (!text) return undefined;
  const line = ix.lines.find((l) => l.includes(text));
  return line?.replace(/^\s*[*#:;]+\s*/, "").trim();
}

/** First non-blank line under a heading, as the page writes it (comments removed). */
function firstBodyLine(ix: PageIndex, anchor: string): string | undefined {
  const h = ix.byAnchor.get(anchor);
  return h
    ? bodyLines(ix, h)
        .map((l) => l.text.trim())
        .find((t) => t !== "")
    : undefined;
}

export const SPECS: { id: string; fn: SpecFn }[] = [
  // ── Resource Manager ──
  {
    id: "rm-window",
    fn: (env) => {
      const ctx = ctxOf(env, `${AR}Resource Manager`, "ResourceManager", "rm-window");
      if (!ctx) return;
      const iface = ctx.ix.byAnchor.get("Interface");
      if (iface) {
        mapBullets(ctx, bodyLines(ctx.ix, iface), {
          kinds: ["panel"],
          labels: "bold",
          skip: (l) => l === "Window Menu",
          anchor: "Interface",
        });
      }
      const menu = tableAt(ctx.ix, 1);
      if (menu)
        mapMenuTable(ctx, menu, {
          headingRoot: "Window_Menu",
          synonyms: {
            "previous tab": "prev tab",
            "file system dump": "file system sources",
          },
          risk: { "Publish Project": "external", "Login/Logout": "credential" },
        });
      const context = tableAt(ctx.ix, 2);
      if (context) mapContextTable(ctx, context, { parent: REF.rmBrowser });
      const tabs = tableAt(ctx.ix, 4);
      if (tabs) mapContextTable(ctx, tabs, { singleName: "Tabs" });
      const shortcuts = tableAt(ctx.ix, 5);
      if (shortcuts) {
        mapColumnsTable(ctx, shortcuts, {
          kind: "shortcut",
          label: 1,
          shortcut: 0,
          skipRow: (label, key, raw) => {
            const twin = RM_GENERAL_TWINS[label];
            const row = twin ? ctx.c.find("shortcut", "ResourceManager", twin) : undefined;
            if (!twin || !row || !sameShortcut(row.shortcut, key)) return undefined;
            // One row kept for two page locations: the kept rows (the menu entry and its shortcut
            // row) name the absorbed table row and the sentences the merge rests on.
            const section = firstBodyLine(ctx.ix, row.anchor);
            const text = `Merged from two page locations: the General Shortcuts table row with the cells "${raw.key}" and "${raw.label}", and this entry's own section (wiki:${ctx.ix.slug}#${row.anchor})${section ? `, which reads "${section}"` : ""}. They give the same key; the page does not say they are one action.`;
            for (const kind of ["menu-item", "shortcut"] as const)
              ctx.c.note(ctx.c.find(kind, "ResourceManager", twin), text);
            return `same shortcut as the menu row ${twin.join(" > ")}`;
          },
        });
        // The tab keys: both sides are kept and each says the page contradicts itself.
        for (const [general, itemLabel, anchor] of RM_TAB_KEY_CONTRADICTIONS) {
          const tableRow = shortcuts.rows.find(
            (r) => cleanWiki(r.cells[1]?.raw ?? "").toLowerCase() === general.toLowerCase(),
          );
          const heading = ctx.ix.byAnchor.get(anchor);
          const section = firstBodyLine(ctx.ix, anchor);
          const row = ctx.c.find("shortcut", "ResourceManager", [general]);
          if (!tableRow || !heading || !section || !row) continue;
          const cells = `"${(lineList(tableRow.cells[0].raw)[0] ?? "").trim()}" and "${(lineList(tableRow.cells[1].raw)[0] ?? "").trim()}"`;
          const there = `the Window Menu section "${heading.text}" (wiki:${ctx.ix.slug}#${anchor}) reads "${section}" and gives that key to "${heading.text}"`;
          const here = `the General Shortcuts table row with the cells ${cells} gives the key to "${general}"`;
          const contradiction = (side: string, other: string): string =>
            `The page contradicts itself on this key: ${side}, but ${other}. Both rows are kept; neither side is taken as the right one.`;
          ctx.c.note(row, contradiction(here, there));
          for (const kind of ["menu-item", "shortcut"] as const)
            ctx.c.note(
              ctx.c.find(kind, "ResourceManager", ["Window", itemLabel]),
              contradiction(there, here),
            );
        }
      }
      for (const [anchor, label] of [
        ["Filters", "Filters"],
        ["Options_2", "Options"],
      ] as const) {
        const h = ctx.ix.byAnchor.get(anchor);
        if (h)
          mapBullets(ctx, bodyLines(ctx.ix, h), {
            kinds: ["option"],
            labels: "bold",
            base: ["Resource Browser", label],
            parent: REF.rmBrowser,
            anchor,
          });
      }
      mapCurated(ctx, [
        {
          kind: "control",
          path: ["Resource Browser", "Search bar"],
          what: "The Search bar allows the typing of words/sequences, separated by a space, that should be found in the file name - including keywords.",
          parent: { kind: "panel", path: ["Resource Browser"] },
          anchor: "Search_bar",
          quote:
            "The '''Search bar''' allows the typing of words/sequences, separated by a space, that should be found in the file name - including keywords.",
        },
        {
          kind: "tab",
          path: ["Details"],
          anchor: "Details_/_Import_Settings",
          quote: "'''Details''' and '''Import Settings''' tabs",
        },
        {
          kind: "tab",
          path: ["Import Settings"],
          anchor: "Details_/_Import_Settings",
          quote: "'''Details''' and '''Import Settings''' tabs",
        },
        {
          kind: "control",
          path: ["Import Settings", "Edit also selected files"],
          what: "It is possible to edit multiple files at once.",
          parent: { kind: "tab", path: ["Import Settings"] },
          anchor: "Edit_also_selected_files",
          quote: "It is possible to edit multiple files at once.",
        },
      ]);
    },
  },
  {
    id: "rm-options",
    fn: (env) => {
      const ctx = ctxOf(env, `${AR}Resource Manager: Options`, "ResourceManager", "rm-options");
      if (!ctx) return;
      const dialog = addUi(ctx, "dialog", ["Options"], {
        what: firstSentence(ctx.ix.lines.map((text) => ({ text }))),
        anchor: "",
        quote:
          "Access the [[Arma Reforger:Resource Manager|Resource Manager]] Options through '''Workbench > Options'''.",
        parent: null,
        container: true,
      });
      for (const h of ctx.ix.sections.filter((x) => x.level === 1)) {
        const tab = addUi(ctx, "tab", ["Options", h.text], {
          parent: dialog,
          anchor: h.anchor,
          quote: h.raw,
          confidence: "medium",
        });
        if (["Game Project", "Shortcuts"].includes(h.text)) continue;
        mapHeadings(ctx, {
          root: h.anchor,
          kinds: ["option"],
          mode: "leaf",
          groups: true,
          base: ["Options", h.text],
          parent: tab,
          confidence: "medium",
        });
      }
    },
  },
  // ── Script Editor ──
  {
    id: "se-window",
    fn: (env) => {
      const ctx = ctxOf(env, `${AR}Script Editor`, "ScriptEditor", "se-window");
      if (!ctx) return;
      mapBullets(ctx, sectionLines(ctx.ix, "Default_Layout"), {
        kinds: ["panel"],
        labels: "links",
        skip: (l) => l === "Menu Bar",
        anchor: "Default_Layout",
        confidence: "medium",
      });
      // Menu bar: bullets `'''File''' -> ''Provides ... like'' '''Save All'''`.
      const mb = sectionLines(ctx.ix, "Menu_Bar");
      for (const it of parseList(
        mb.map((l) => l.text),
        mb[0]?.line ?? 1,
      )) {
        const bolds = [...it.raw.matchAll(/'''([^']+?)'''/g)].map((m) =>
          m[1].replace(/\s*(?:&rarr;|→)\s*$/, "").trim(),
        );
        const title = bolds[0];
        if (!title) continue;
        const what = cleanWiki(it.raw.replace(/^'''[^']+?'''\s*(?:&rarr;|→)?/, ""));
        const menu = addUi(ctx, "menu", [title], {
          what,
          parent: null,
          anchor: "Menu_Bar",
          quote: it.raw,
          confidence: "medium",
        });
        for (const item of bolds.slice(1)) {
          if (item.startsWith("(")) continue;
          addUi(ctx, "menu-item", [title, item], {
            parent: menu,
            anchor: "Menu_Bar",
            quote: it.raw,
            confidence: "medium",
          });
        }
      }
      const dbg = ctx.ix.byAnchor.get("Debug");
      if (dbg) {
        mapBullets(ctx, bodyLines(ctx.ix, dbg), {
          kinds: ["control"],
          labels: "bold",
          base: ["Debug"],
          parent: uiRef("ScriptEditor", "panel", ["Debug"]),
          anchor: "Debug",
          confidence: "high",
        });
      }
      const shortcuts = tablesIn(ctx.ix, "Keyboard_Shortcuts")[0];
      if (shortcuts)
        mapColumnsTable(ctx, shortcuts, {
          kind: "shortcut",
          label: 1,
          shortcut: 0,
          // "Debug: Step Over" with F10 is the Debug section's "Step Over: F10": one thing, the control row is kept.
          skipRow: (label, key, raw) => {
            const m = /^Debug:\s*(.+)$/.exec(label);
            const row = m ? ctx.c.find("control", "ScriptEditor", ["Debug", m[1]]) : undefined;
            if (!m || !row || !sameShortcut(row.shortcut, key)) return undefined;
            // One row kept for two page locations: the Debug section's control row names the
            // absorbed Keyboard Shortcuts row and the sentences the merge rests on.
            const line = lineHolding(ctx.ix, row.quote);
            ctx.c.note(
              row,
              `Merged from two page locations: the Keyboard Shortcuts table row with the cells "${raw.key}" and "${raw.label}", and this entry of the Debug section (wiki:${ctx.ix.slug}#${row.anchor})${line ? `, which reads "${line}"` : ""}. They give the same action name and the same key; the page does not say they are one action.`,
            );
            return `same action and key as the Debug section's control row Debug > ${m[1]}`;
          },
        });
      mapCurated(ctx, [
        {
          kind: "menu-item",
          path: ["Debug", "Debug Custom"],
          what: "which allows us to connect to a user provided port",
          parent: { kind: "menu", path: ["Debug"] },
          anchor: "Connecting_the_debugger",
          quote:
            "'''Debug &rarr; Debug Custom''', which allows us to connect to a user provided port",
        },
        {
          kind: "dialog",
          path: ["Debug Custom"],
          what: "in which the debugger's port can be set",
          anchor: "Connecting_the_debugger",
          quote:
            "Selecting the '''Debug &rarr; Debug Custom''' will make the following '''''window (1)''''' appear in which the debugger's port can be set.",
        },
      ]);
    },
  },
  {
    id: "se-svn",
    fn: (env) => {
      const ctx = ctxOf(env, `${AR}Script Editor: SVN Plugins`, "ScriptEditor", "se-svn");
      const t = ctx ? tableAt(ctx.ix, 1) : undefined;
      if (ctx && t)
        mapColumnsTable(ctx, t, {
          kind: "shortcut",
          label: 0,
          shortcut: 1,
          what: 2,
          base: ["SVN Plugins"],
        });
    },
  },
  // ── World Editor ──
  {
    id: "we-window",
    fn: (env) => {
      const ctx = ctxOf(env, `${AR}World Editor`, "WorldEditor", "we-window");
      if (!ctx) return;
      const topBar = addUi(ctx, "toolbar", ["Top Bar"], {
        what: firstSentence(sectionLines(ctx.ix, "Top_Bar")),
        parent: null,
        anchor: "Top_Bar",
        quote: "The top bar contains World Editor quick access buttons grouped in three sections:",
        container: false,
      });
      mapBullets(ctx, sectionLines(ctx.ix, "Top_Bar"), {
        kinds: ["toolbar"],
        labels: "bold",
        base: ["Top Bar"],
        parent: topBar,
        anchor: "Top_Bar",
      });
      const top = ctx.ix.byAnchor.get("Top_Bar");
      if (top) {
        mapHeadings(ctx, {
          root: "Top_Bar",
          kinds: ["toolbar-button"],
          mode: "all",
          shortcuts: true,
          base: ["Top Bar"],
          parent: topBar,
          kindOf: (text) => (TOOL_RE.test(text) ? "tool" : "toolbar-button"),
          baseFor: (kind) => (kind === "tool" ? [] : ["Top Bar"]),
          // The Terrain Tool entry only points at the Terrain Creation Tool page ("See ...:
          // Terrain Creation Tool#Sculpt"): one tool, kept under the name of its own page.
          alias: { "Terrain Tool": "Terrain Creation Tool" },
          confidence: "medium",
        });
        // Tools are tools, not children of the bar: no parent.
        for (const d of [...ctx.c.all.values()]) {
          if (d.spec === "we-window" && d.kind === "tool") d.parent = null;
        }
      }
      mapHeadings(ctx, {
        root: "Hierarchy/Create",
        kinds: ["panel"],
        mode: "all",
        confidence: "medium",
      });
      for (const [root, kinds] of [
        ["Object_Properties/Tool_Properties", ["panel"]],
        ["Resource_Browser/Prefab_Library", ["panel", "tab"]],
      ] as const) {
        mapHeadings(ctx, {
          root,
          kinds: [...kinds],
          mode: "all",
          confidence: "medium",
          kindOf: (t, depth) => (depth === 1 ? "panel" : /\bTab$/.test(t) ? "tab" : null),
        });
      }
      for (const anchor of ["Viewport", "Log_Console"]) {
        const h = ctx.ix.byAnchor.get(anchor);
        if (h) {
          const label = h.text;
          addUi(ctx, "panel", [label], {
            what: firstSentence(bodyLines(ctx.ix, h)),
            parent: null,
            anchor,
            quote: h.raw,
            confidence: "medium",
          });
        }
      }
      mapBullets(ctx, sectionLines(ctx.ix, "Log_Console"), {
        kinds: ["control"],
        labels: "bold",
        base: ["Log Console"],
        parent: uiRef("WorldEditor", "panel", ["Log Console"]),
        anchor: "Log_Console",
        confidence: "high",
      });
      const play = ctx.ix.byAnchor.get("Play_Game");
      if (play) {
        const menu = addUi(ctx, "menu", ["Play Game"], {
          what: "Multiple options appear by clicking on the side arrow",
          parent: null,
          anchor: "Play_Game",
          quote: "Multiple options appear by clicking on the side arrow:",
          confidence: "medium",
          container: true,
        });
        mapBullets(ctx, bodyLines(ctx.ix, play), {
          kinds: ["menu-item"],
          labels: "bold",
          base: ["Play Game"],
          parent: menu,
          anchor: "Play_Game",
          confidence: "medium",
        });
      }
      const details = tablesIn(ctx.ix, "Details_Tab")[0];
      if (details)
        mapColumnsTable(ctx, details, {
          kind: "option",
          label: 0,
          what: 1,
          base: ["Prefab Library", "Details Tab"],
          parent: uiRef("WorldEditor", "tab", ["Prefab Library", "Details Tab"]),
        });
      mapCurated(ctx, [
        {
          kind: "control",
          path: ["Log Console", "Clear Console"],
          named: true,
          what: "It can be cleaned by pressing the Clear Console button",
          parent: { kind: "panel", path: ["Log Console"] },
          anchor: "Log_Console",
          quote: "It can be cleaned by pressing the Clear Console button.",
        },
        {
          kind: "control",
          path: ["Log Console", "Filter Options"],
          what: "allows for advanced filtering",
          parent: { kind: "panel", path: ["Log Console"] },
          anchor: "Log_Console",
          quote: "'''Filter Options''', allows for advanced filtering",
        },
        {
          kind: "canvas-gesture",
          path: ["Viewport", "move the camera forward and backward"],
          shortcut: "MMB",
          what: "With the mouse wheel alone MMB you can move the camera forward and backward",
          parent: { kind: "panel", path: ["Viewport"] },
          anchor: "Navigation",
          quote:
            "With the mouse wheel alone {{Controls|MMB}} you can move the camera forward and backward.",
        },
        {
          kind: "canvas-gesture",
          path: ["Viewport", "change the orientation of the camera"],
          shortcut: "RMB",
          what: "By moving the mouse, you can change the orientation of the camera.",
          parent: { kind: "panel", path: ["Viewport"] },
          anchor: "Navigation",
          quote: "* By moving the mouse, you can change the orientation of the camera.",
        },
        {
          kind: "canvas-gesture",
          path: ["Viewport", "changes the speed at which the camera moves"],
          shortcut: "RMB+MMB",
          what: "The mouse wheel MMB changes the speed at which the camera moves - scroll up to increase the speed, scroll down to decrease it.",
          parent: { kind: "panel", path: ["Viewport"] },
          anchor: "Navigation",
          quote:
            "* The mouse wheel {{Controls|MMB}} changes the speed at which the camera moves - scroll up to increase the speed, scroll down to decrease it.",
        },
        {
          kind: "canvas-gesture",
          path: ["Viewport", "Use the W and S keys to move the camera forward and backward"],
          shortcut: chordAlternatives("RMB", ["W", "S"]),
          what: "Use the W and S keys to move the camera forward and backward",
          parent: { kind: "panel", path: ["Viewport"] },
          anchor: "Navigation",
          quote:
            "* Use the {{Controls|W}} and {{Controls|S}} keys to move the camera forward and backward",
        },
        {
          kind: "canvas-gesture",
          path: ["Viewport", "Use the A and D keys to move the camera sideways"],
          shortcut: chordAlternatives("RMB", ["A", "D"]),
          what: "Use the A and D keys to move the camera sideways",
          parent: { kind: "panel", path: ["Viewport"] },
          anchor: "Navigation",
          quote: "* Use the {{Controls|A}} and {{Controls|D}} keys to move the camera sideways.",
        },
        {
          kind: "canvas-gesture",
          path: ["Viewport", "Use the Q and Z keys to move the camera up and down"],
          shortcut: chordAlternatives("RMB", ["Q", "Z"]),
          what: "Use the Q and Z keys to move the camera up and down",
          parent: { kind: "panel", path: ["Viewport"] },
          anchor: "Navigation",
          quote: "* Use the {{Controls|Q}} and {{Controls|Z}} keys to move the camera up and down.",
        },
        {
          kind: "canvas-gesture",
          path: ["Viewport", "focuses on the currently selected entity"],
          shortcut: "F",
          what: "Pressing the F key focuses on the currently selected entity as well.",
          parent: { kind: "panel", path: ["Viewport"] },
          anchor: "Navigation",
          quote:
            "Pressing the {{Controls|F}} key focuses on the currently selected entity as well.",
        },
      ]);
    },
  },
];

// ── More specs: the other editors, tools, CLI, files, links, publish ─────────

function toolRef(name: string): DraftRef {
  return uiRef("WorldEditor", "tool", [name]);
}

/** Adds the tool row of a tool page unless the World Editor top bar already made it. */
function ensureTool(ctx: Ctx, name: string, anchor: string, quote: string): DraftRef {
  const ex = ctx.c.find("tool", ctx.module, [name]);
  if (ex) {
    ex.container = true;
    return toolRef(name);
  }
  return addUi(ctx, "tool", [name], {
    what: whatFrom(firstSentence(leadLines(ctx.ix))),
    parent: null,
    anchor,
    quote,
    container: true,
  });
}

function toolPageSpec(
  spec: string,
  title: string,
  tool: string,
  body: (ctx: Ctx, t: DraftRef) => void,
): SpecFn {
  return (env) => {
    const ctx = ctxOf(env, `${AR}${title}`, "WorldEditor", spec);
    if (!ctx) return;
    const t = ensureTool(ctx, tool, "", `'''${tool}'''`.replace(/^'''(.*)'''$/, "$1"));
    body(ctx, t);
  };
}

/** Rows of a tool-option table: the option name is a heading inside the first cell. */
function toolOptionTables(
  ctx: Ctx,
  tool: string,
  t: DraftRef,
  tables: Table[],
  nameCol = 0,
  whatCol = 1,
): void {
  for (const table of tables) {
    const group = ctx.ix.byAnchor.get(table.section)?.text;
    mapColumnsTable(ctx, table, {
      kind: "option",
      label: nameCol,
      what: whatCol,
      headingLabel: true,
      base: group ? [tool, group] : [tool],
      parent: t,
    });
  }
}

const MORE_SPECS: { id: string; fn: SpecFn }[] = [
  // ── Animation Editor ──
  {
    id: "ae-window",
    fn: (env) => {
      const ctx = ctxOf(env, `${AR}Animation Editor`, "AnimEditor", "ae-window");
      if (!ctx) return;
      mapBullets(ctx, sectionLines(ctx.ix, "Toolbar"), {
        kinds: ["menu"],
        labels: "bold",
        anchor: "Toolbar",
        confidence: "medium",
      });
      mapBullets(ctx, leadLines(ctx.ix), {
        kinds: ["panel"],
        labels: "links",
        skip: (l) => l === "Toolbar",
        confidence: "medium",
      });
      const top = addUi(ctx, "toolbar", ["Top Bar"], {
        parent: null,
        anchor: "Top_Bar",
        quote: "Top Bar",
        container: true,
      });
      mapBullets(ctx, sectionLines(ctx.ix, "Top_Bar"), {
        kinds: ["toolbar-button"],
        labels: "phrase",
        base: ["Top Bar"],
        parent: top,
        anchor: "Top_Bar",
        shortcutRows: true,
        confidence: "medium",
      });
      const previewTop = addUi(ctx, "toolbar", ["Anim Editor Preview", "Top Bar"], {
        parent: uiRef("AnimEditor", "panel", ["Anim Editor Preview"]),
        anchor: "Top_Bar_2",
        quote: "Top Bar",
        container: true,
      });
      mapBullets(ctx, sectionLines(ctx.ix, "Top_Bar_2"), {
        kinds: ["toolbar-button"],
        labels: "phrase",
        base: ["Anim Editor Preview", "Top Bar"],
        parent: previewTop,
        anchor: "Top_Bar_2",
        confidence: "medium",
      });
      mapBullets(ctx, sectionLines(ctx.ix, "Buttons"), {
        kinds: ["control"],
        labels: "bold",
        base: ["Anim Editor Preview"],
        parent: uiRef("AnimEditor", "panel", ["Anim Editor Preview"]),
        anchor: "Buttons",
        confidence: "medium",
      });
      mapBullets(ctx, sectionLines(ctx.ix, "Display"), {
        kinds: ["control", "option"],
        labels: "phrase",
        pick: "Timeline Controls",
        base: ["Anim Editor Preview", "Timeline Controls"],
        parent: uiRef("AnimEditor", "panel", ["Anim Editor Preview"]),
        anchor: "Display",
        confidence: "medium",
      });
      mapBullets(ctx, sectionLines(ctx.ix, "Log_Console"), {
        kinds: ["control"],
        labels: "phrase",
        base: ["Log Console"],
        parent: uiRef("AnimEditor", "panel", ["Log Console"]),
        anchor: "Log_Console",
        confidence: "medium",
      });
      const gesture = (
        panel: string,
        anchor: string,
        label: string,
        shortcut: string | undefined,
        quote: string,
      ): CuratedRow => ({
        kind: "canvas-gesture",
        path: [panel, label],
        shortcut,
        parent: { kind: "panel", path: [panel] },
        anchor,
        quote,
        confidence: "medium",
      });
      mapCurated(ctx, [
        gesture(
          "Animation Graph",
          "Animation_Graph",
          "Left Click to select",
          "LMB",
          "Use '''Left Click''' to select, drag to select multiple nodes.",
        ),
        gesture(
          "Animation Graph",
          "Animation_Graph",
          "add to current selection",
          "Ctrl+LMB",
          "alternatively, press '''Left Ctrl''' and '''left click''' to add to current selection.",
        ),
        gesture(
          "Animation Graph",
          "Animation_Graph",
          "move around the graph",
          "MMB",
          "Press '''Middle Mouse Button''' and drag to move around the graph",
        ),
        gesture(
          "Animation Graph",
          "Animation_Graph",
          "zoom/unzoom",
          "MMB",
          "Scroll '''Middle Mouse Button''' to zoom/unzoom",
        ),
        gesture(
          "Animation Graph",
          "Animation_Graph",
          "opens a contextual menu",
          "RMB",
          "'''Right Click''' opens a contextual menu that depends on your current selection/what is under the mouse cursor.",
        ),
        gesture(
          "Anim Editor Preview",
          "Anim_Editor_Preview",
          "The camera can be rotated around the center",
          "LMB",
          "The camera can be rotated around the center by pressing left mouse button in the viewport and dragging.",
        ),
        gesture(
          "Anim Editor Preview",
          "Anim_Editor_Preview",
          "The camera can be rotated around its own axis",
          "RMB",
          "The camera can be rotated around its own axis be pressing right mouse button in the viewport and dragging.",
        ),
        gesture(
          "Anim Editor Preview",
          "Anim_Editor_Preview",
          "The camera can be moved",
          "MMB",
          "The camera can be moved by pressing middle mouse button in the viewport and dragging.",
        ),
      ]);
    },
  },
  // ── Audio Editor ──
  {
    id: "audio-window",
    fn: (env) => {
      const ctx = ctxOf(env, `${AR}Audio Editor`, "AudioEditor", "audio-window");
      if (!ctx) return;
      mapBullets(ctx, sectionLines(ctx.ix, "Panels"), {
        kinds: ["panel"],
        labels: "bold",
        anchor: "Panels",
      });
      const groupMenu = addUi(ctx, "context-menu", ["Group Options"], {
        parent: null,
        anchor: "Group_Options",
        quote: "Group Options",
        confidence: "medium",
        container: true,
      });
      const groupTable = tablesIn(ctx.ix, "Group_Options")[0];
      if (groupTable)
        mapColumnsTable(ctx, groupTable, {
          kind: "context-item",
          label: 0,
          what: 1,
          base: ["Group Options"],
          parent: groupMenu,
          confidence: "medium",
        });
      for (const t of tablesIn(ctx.ix, "Keyboard_Shortcuts")) {
        mapColumnsTable(ctx, t, {
          kind: ({ key }) => (isMouseChord(key) ? "canvas-gesture" : "shortcut"),
          label: 0,
          shortcut: 1,
          group: "header",
        });
      }
    },
  },
  // ── Behavior Editor ──
  {
    id: "behavior-window",
    fn: (env) => {
      const ctx = ctxOf(env, `${AR}Behavior Editor`, "BehaviorEditor", "behavior-window");
      if (!ctx) return;
      const basics = tablesIn(ctx.ix, "Editor_Basics")[0];
      if (basics) mapColumnsTable(ctx, basics, { kind: "panel", label: 1 });
      const sc = tablesIn(ctx.ix, "Shortcuts")[0];
      if (sc) mapColumnsTable(ctx, sc, { kind: "shortcut", label: 1, shortcut: 0 });
      const controls = tablesIn(ctx.ix, "Controls")[0];
      if (controls)
        mapColumnsTable(ctx, controls, {
          kind: "canvas-gesture",
          label: 0,
          what: 1,
          base: ["Node area"],
          parent: uiRef("BehaviorEditor", "panel", ["Node area"]),
        });
    },
  },
  // ── Particle Editor ──
  {
    id: "particle-window",
    fn: (env) => {
      const ctx = ctxOf(env, `${AR}Particle Editor`, "ParticleEditor", "particle-window");
      if (!ctx) return;
      mapHeadings(ctx, {
        root: "Panels",
        kinds: [],
        mode: "all",
        groups: false,
        kindOf: (text, depth, parent) =>
          depth === 1
            ? "panel"
            : depth === 2 && parent?.text === "Preview Panel"
              ? "toolbar-button"
              : depth === 2 &&
                  parent?.text === "Animation Panel" &&
                  [
                    "Snap to Grid",
                    "Lock Horizontal Axis",
                    "See Through Layers",
                    "Point Editor",
                  ].includes(text)
                ? "toolbar-button"
                : depth === 2 && parent?.text === "Animation Panel" && /Graphs$/.test(text)
                  ? "tab"
                  : null,
      });
      // Effect Panel controls the page describes in prose.
      const effect: CuratedRow["parent"] = { kind: "panel", path: ["Effect Panel"] };
      mapCurated(ctx, [
        {
          kind: "panel",
          path: ["Material Editor"],
          anchor: "Material_Editor",
          quote: "Material Editor",
        },
        {
          kind: "control",
          path: ["Effect Panel", "Emitters"],
          named: true,
          what: "Their full list can be found in the box labeled as Emitters.",
          parent: effect,
          anchor: "Effect_Panel",
          quote: "Their full list can be found in the box labeled as Emitters.",
        },
        {
          kind: "control",
          path: ["Effect Panel", "Restart"],
          named: true,
          what: "Next there are controls which allow you to Restart or Pause the effect.",
          parent: effect,
          anchor: "Effect_Panel",
          quote: "Next there are controls which allow you to Restart or Pause the effect.",
        },
        {
          kind: "control",
          path: ["Effect Panel", "Pause"],
          named: true,
          what: "Next there are controls which allow you to Restart or Pause the effect.",
          parent: effect,
          anchor: "Effect_Panel",
          quote: "Next there are controls which allow you to Restart or Pause the effect.",
        },
        {
          kind: "control",
          path: ["Effect Panel", "Step"],
          named: true,
          what: "When the effect is paused, the Step button allows you to step forward (by clicking) or to play in slow motion (by pressing and holding) the effect.",
          parent: effect,
          anchor: "Effect_Panel",
          quote: "When the effect is paused, the Step button allows you to step forward",
        },
        {
          kind: "control",
          path: ["Effect Panel", "drop-down menu"],
          what: "A specific LOD can be manually forced using the drop-down menu in the Particle Effect window, ignoring the engine's formula.",
          parent: effect,
          anchor: "Effect_Panel",
          quote: "A specific LOD can be manually forced using the drop-down menu",
        },
        {
          kind: "option",
          path: ["Effect Panel", "Hide inactive"],
          named: true,
          what: "inactive emitters are struckthrough or hidden completely if Hide inactive checkbox is checked",
          parent: effect,
          anchor: "Effect_Panel",
          quote: "hidden completely if Hide inactive checkbox is checked",
        },
        {
          kind: "option",
          path: ["Effect Panel", "Restart on change"],
          named: true,
          what: "If Restart on change checkbox is checked, the effect will restart every time a different item is selected",
          parent: effect,
          anchor: "Effect_Panel",
          quote: "If Restart on change checkbox is checked, the effect will restart every time",
        },
      ]);
    },
  },
  // ── Procedural Animation Editor ──
  {
    id: "proc-window",
    fn: (env) => {
      const ctx = ctxOf(env, `${AR}Procedural Animation Editor`, "ProcAnimEditor", "proc-window");
      if (!ctx) return;
      mapBullets(ctx, sectionLines(ctx.ix, "Editor_Panels"), {
        kinds: ["panel"],
        labels: "bold",
        anchor: "Editor_Panels",
      });
    },
  },
  // ── Resource Manager sub-editors ──
  {
    id: "rm-config",
    fn: (env) => {
      const ctx = ctxOf(
        env,
        `${AR}Resource Manager: Config Editor`,
        "ResourceManager.Config",
        "rm-config",
      );
      if (ctx) mapHeadings(ctx, { root: "Main_Interface", kinds: ["control"], mode: "leaf" });
    },
  },
  {
    id: "rm-imageset",
    fn: (env) => {
      const ctx = ctxOf(
        env,
        `${AR}Resource Manager: Imageset Editor`,
        "ResourceManager.Imageset",
        "rm-imageset",
      );
      if (!ctx) return;
      const top = addUi(ctx, "toolbar", ["Top Bar"], {
        parent: null,
        anchor: "Top_Bar",
        quote: "Top Bar",
        container: true,
      });
      mapHeadings(ctx, {
        root: "Top_Bar",
        kinds: [],
        mode: "all",
        parent: top,
        kindOf: (t, depth) =>
          depth === 1
            ? /Tab$/.test(t)
              ? "tab"
              : "toolbar-button"
            : depth === 2
              ? "control"
              : null,
      });
      for (const anchor of ["Quads_Tab", "Import_Settings_Tab"]) {
        const h = ctx.ix.byAnchor.get(anchor);
        if (!h) continue;
        addUi(ctx, "tab", [h.text], {
          what: firstSentence(bodyLines(ctx.ix, h)),
          parent: null,
          anchor,
          quote: h.raw,
          confidence: "medium",
        });
      }
      mapHeadings(ctx, {
        root: "Quads_Tab",
        kinds: [],
        mode: "all",
        parent: uiRef("ResourceManager.Imageset", "tab", ["Quads Tab"]),
        kindOf: (t, depth, parent) =>
          depth === 1
            ? t === "Quads Buttons"
              ? "toolbar"
              : "panel"
            : depth === 2 && parent?.text === "Quads Buttons"
              ? "toolbar-button"
              : depth === 2 && parent?.text === "Quad Properties"
                ? "control"
                : null,
      });
    },
  },
  {
    id: "rm-layout",
    fn: (env) => {
      const ctx = ctxOf(
        env,
        `${AR}Resource Manager: Layout Editor`,
        "ResourceManager.Layout",
        "rm-layout",
      );
      if (!ctx) return;
      const top = addUi(ctx, "toolbar", ["Top Bar"], {
        parent: null,
        anchor: "Top_Bar",
        quote: "Top Bar",
        container: true,
      });
      mapHeadings(ctx, { root: "Top_Bar", kinds: ["toolbar-button"], mode: "all", parent: top });
      const hier = ctx.ix.byAnchor.get("Hierarchy");
      if (hier)
        addUi(ctx, "panel", ["Hierarchy"], {
          what: firstSentence(bodyLines(ctx.ix, hier)),
          parent: null,
          anchor: "Hierarchy",
          quote: hier.raw,
          confidence: "medium",
        });
      const cm = ctx.ix.byAnchor.get("Contextual_Menu");
      if (cm) {
        const menu = addUi(ctx, "context-menu", ["Contextual Menu"], {
          parent: uiRef("ResourceManager.Layout", "panel", ["Hierarchy"]),
          anchor: "Contextual_Menu",
          quote: cm.raw,
          confidence: "medium",
          container: true,
        });
        mapHeadings(ctx, {
          root: "Contextual_Menu",
          kinds: ["context-item"],
          mode: "all",
          base: ["Contextual Menu"],
          parent: menu,
        });
      }
      for (const anchor of ["Properties_Tab", "Classes_Tab", "Last_Used_Prefabs_Tab"]) {
        const h = ctx.ix.byAnchor.get(anchor);
        if (h)
          addUi(ctx, "tab", [h.text], {
            what: firstSentence(bodyLines(ctx.ix, h)),
            parent: null,
            anchor,
            quote: h.raw,
            confidence: "medium",
          });
      }
      // Properties tab: the Search and Name fields and the Property Grid Options button are bullets
      // of the tab's lead; the button's menu and the right-click menu of a property group are
      // heading lists.
      const props = uiRef("ResourceManager.Layout", "tab", ["Properties Tab"]);
      mapCurated(ctx, [
        {
          kind: "control",
          path: ["Properties Tab", "Search field"],
          what: "to search by properties name",
          parent: { kind: "tab", path: ["Properties Tab"] },
          anchor: "Properties_Tab",
          quote: "* a Search field to search by properties name,",
        },
        {
          kind: "control",
          path: ["Properties Tab", "Name field"],
          what: "to rename the currently selected widget",
          parent: { kind: "tab", path: ["Properties Tab"] },
          anchor: "Properties_Tab",
          quote: "* a widget's Name field to rename the currently selected widget,",
        },
      ]);
      const gridButton = addUi(ctx, "control", ["Properties Tab", "Property Grid Options"], {
        parent: props,
        anchor: "Property_Grid_Options",
        quote: "* a Property Grid Options button.",
        container: true,
      });
      mapHeadings(ctx, {
        root: "Property_Grid_Options",
        kinds: ["menu-item"],
        mode: "all",
        base: ["Properties Tab", "Property Grid Options"],
        parent: gridButton,
      });
      const groupMenu = addUi(ctx, "context-menu", ["Properties Tab", "Property Group Options"], {
        what: "Right-clicking on a property group will display its contextual menu.",
        parent: props,
        anchor: "Property_Group_Options",
        quote: "Right-clicking on a property group will display its contextual menu.",
        container: true,
      });
      mapHeadings(ctx, {
        root: "Property_Group_Options",
        kinds: ["context-item"],
        mode: "all",
        base: ["Properties Tab", "Property Group Options"],
        parent: groupMenu,
      });
    },
  },
  {
    id: "rm-model",
    fn: (env) => {
      const ctx = ctxOf(
        env,
        `${AR}Resource Manager: Model Editor`,
        "ResourceManager.Model",
        "rm-model",
      );
      if (!ctx) return;
      const bar = addUi(ctx, "toolbar", ["Horizontal bar"], {
        parent: null,
        anchor: "Horizontal_bar",
        quote: "Horizontal bar",
        container: true,
      });
      const t = tablesIn(ctx.ix, "Horizontal_bar")[0];
      if (t)
        mapColumnsTable(ctx, t, {
          kind: "toolbar-button",
          label: 0,
          what: 1,
          base: ["Horizontal bar"],
          parent: bar,
          confidence: "medium",
          skipLabel: /^The following tools appear/i,
        });
      for (const anchor of ["Details_Tab", "Import_Settings_Tab"]) {
        const h = ctx.ix.byAnchor.get(anchor);
        if (h)
          addUi(ctx, "tab", [h.text], {
            what: firstSentence(bodyLines(ctx.ix, h)),
            parent: null,
            anchor,
            quote: h.raw,
            confidence: "medium",
          });
      }
    },
  },
  {
    id: "rm-texture",
    fn: (env) => {
      const ctx = ctxOf(
        env,
        `${AR}Resource Manager: Texture Editor`,
        "ResourceManager.Texture",
        "rm-texture",
      );
      if (!ctx) return;
      const bar = addUi(ctx, "toolbar", ["Horizontal Bar"], {
        parent: null,
        anchor: "Horizontal_Bar",
        quote: "Horizontal Bar",
        container: true,
      });
      mapHeadings(ctx, {
        root: "Horizontal_Bar",
        kinds: ["toolbar-button"],
        mode: "all",
        parent: bar,
      });
      for (const anchor of ["Details_Tab", "Import_Settings_Tab"]) {
        const h = ctx.ix.byAnchor.get(anchor);
        if (h)
          addUi(ctx, "tab", [h.text], {
            what: firstSentence(bodyLines(ctx.ix, h)),
            parent: null,
            anchor,
            quote: h.raw,
            confidence: "medium",
          });
      }
    },
  },
  // ── World Editor tool pages ──
  {
    id: "tool-coords",
    fn: toolPageSpec("tool-coords", "World Editor: Coords Tool", "Coords Tool", (ctx, t) => {
      for (const [anchor, kind] of [
        ["Coordinates", "control"],
        ["Options", "option"],
        ["Data", "control"],
      ] as const) {
        mapBullets(ctx, sectionLines(ctx.ix, anchor), {
          kinds: [kind],
          labels: "bold",
          base: ["Coords Tool"],
          parent: t,
          anchor,
        });
      }
      mapCurated(ctx, [
        {
          kind: "menu-item",
          path: ["Tools", "Coords Tool"],
          parent: { kind: "menu", path: ["Tools"] },
          anchor: "User_Interface",
          quote: "The tool can be accessed through '''Menu''': Tools &rarr; Coords Tool.",
        },
        {
          kind: "menu",
          path: ["Tools"],
          anchor: "User_Interface",
          quote: "The tool can be accessed through '''Menu''': Tools &rarr; Coords Tool.",
        },
      ]);
    }),
  },
  {
    id: "tool-ground",
    fn: toolPageSpec(
      "tool-ground",
      "World Editor: Ground Manipulation Tool",
      "Ground Manipulation Tool",
      (ctx, t) => {
        mapHeadings(ctx, {
          root: "Settings",
          kinds: ["option"],
          mode: "leaf",
          groups: true,
          base: ["Ground Manipulation Tool"],
          parent: t,
        });
      },
    ),
  },
  {
    id: "tool-navmesh",
    fn: toolPageSpec("tool-navmesh", "World Editor: Navmesh Tool", "Navmesh Tool", (ctx, t) => {
      mapHeadings(ctx, {
        root: "Main_Interface",
        kinds: ["control"],
        mode: "leaf",
        base: ["Navmesh Tool"],
        parent: t,
      });
    }),
  },
  {
    id: "tool-brush",
    fn: toolPageSpec(
      "tool-brush",
      "World Editor: Object Brush Tool",
      "Object Brush Tool",
      (ctx, t) => {
        toolOptionTables(ctx, "Object Brush Tool", t, ctx.ix.parsed.tables);
      },
    ),
  },
  {
    id: "tool-parallel",
    fn: toolPageSpec(
      "tool-parallel",
      "World Editor: Parallel Shape Tool",
      "Parallel Shape Tool",
      (ctx, t) => {
        mapHeadings(ctx, {
          root: "Main_Interface",
          kinds: ["option"],
          mode: "leaf",
          groups: true,
          base: ["Parallel Shape Tool"],
          parent: t,
        });
      },
    ),
  },
  {
    id: "tool-prefab",
    fn: toolPageSpec(
      "tool-prefab",
      "World Editor: Prefab Management Tool",
      "Prefab Management Tool",
      (ctx, t) => {
        const params = ctx.ix.byAnchor.get("Parameters");
        if (!params) return;
        for (const g of descendants(ctx.ix, params)) {
          mapBullets(ctx, bodyLines(ctx.ix, g), {
            kinds: ["option"],
            labels: "bold",
            base: ["Prefab Management Tool", g.text],
            parent: t,
            anchor: g.anchor,
          });
        }
      },
    ),
  },
  {
    id: "tool-rotate",
    fn: toolPageSpec("tool-rotate", "World Editor: Rotate Tool", "Rotate Tool", (ctx, t) => {
      mapHeadings(ctx, {
        root: null,
        kinds: ["option"],
        mode: "all",
        only: ["Snap_angle", "Rotate_separately", "Transform_children"],
        base: ["Rotate Tool"],
        parent: t,
      });
      mapCurated(ctx, [
        {
          kind: "canvas-gesture",
          path: ["Rotate Tool", "Holding Ctrl while rotating"],
          shortcut: "Ctrl",
          what: "Holding Ctrl while rotating will temporarily enable Snap angle",
          parent: { kind: "tool", path: ["Rotate Tool"] },
          anchor: "Shortcuts",
          quote:
            "Holding {{Controls|Ctrl}} while rotating will temporarily enable '''Snap angle'''",
        },
        {
          kind: "canvas-gesture",
          path: ["Rotate Tool", "duplicate the element and rotate the copy"],
          shortcut: "Alt+LMB",
          what: "Alt+LMB will duplicate the element and rotate the copy",
          parent: { kind: "tool", path: ["Rotate Tool"] },
          anchor: "Shortcuts",
          quote: "{{Controls|Alt|LMB}} will duplicate the element and rotate the copy.",
        },
      ]);
    }),
  },
  {
    id: "tool-shape",
    fn: toolPageSpec("tool-shape", "World Editor: Shape Area Tool", "Shape Area Tool", (ctx, t) => {
      mapHeadings(ctx, {
        root: "Main_Interface",
        kinds: ["option"],
        mode: "leaf",
        groups: true,
        base: ["Shape Area Tool"],
        parent: t,
      });
    }),
  },
  {
    id: "tool-terrain",
    fn: toolPageSpec(
      "tool-terrain",
      "World Editor: Terrain Creation Tool",
      "Terrain Creation Tool",
      (ctx, t) => {
        // The four tabs hang off the tool; everything the page puts inside a tab (its key path
        // starts with the tab's) hangs off that tab, or off a row nested in it.
        const tabRef = (name: string): DraftRef =>
          uiRef("WorldEditor", "tab", ["Terrain Creation Tool", name]);
        const tabParent = (name: string): { kind: Kind; path: string[] } => ({
          kind: "tab",
          path: ["Terrain Creation Tool", name],
        });
        for (const anchor of ["Manage", "Sculpt", "Paint", "Info_&_Diags"]) {
          const h = ctx.ix.byAnchor.get(anchor);
          if (h)
            addUi(ctx, "tab", ["Terrain Creation Tool", h.text], {
              what: firstSentence(bodyLines(ctx.ix, h)),
              parent: t,
              anchor,
              quote: h.raw,
              confidence: "medium",
            });
        }
        mapHeadings(ctx, {
          root: "Manage",
          kinds: ["control"],
          mode: "leaf",
          groups: true,
          base: ["Terrain Creation Tool", "Manage"],
          parent: tabRef("Manage"),
        });
        const common = tablesIn(ctx.ix, "Common_Controls")[0];
        if (common)
          mapColumnsTable(ctx, common, {
            kind: "canvas-gesture",
            label: 1,
            shortcut: 0,
            base: ["Terrain Creation Tool", "Sculpt"],
            parent: tabRef("Sculpt"),
            confidence: "medium",
          });
        // Paint and Info & Diags: the first column holds section titles; the controls sit inside
        // the Description column.
        for (const [section, tab] of [
          ["Paint", "Paint"],
          ["Info_&_Diags", "Info & Diags"],
        ] as const) {
          for (const table of tablesIn(ctx.ix, section)) {
            mapFeatureTable(ctx, table, {
              base: ["Terrain Creation Tool", tab],
              parent: tabRef(tab),
            });
          }
        }
        // Sculpt: the common values are bold-led lines, the Cogwheel menu a term list.
        mapCurated(ctx, [
          {
            kind: "option",
            path: ["Terrain Creation Tool", "Sculpt", "Strength"],
            what: "strength of the effect - range 0..500",
            parent: tabParent("Sculpt"),
            anchor: "Common_Values",
            quote: "'''Strength''': strength of the effect - range 0..500",
          },
          {
            kind: "option",
            path: ["Terrain Creation Tool", "Sculpt", "Height"],
            what: "wanted terrain's absolute height",
            parent: tabParent("Sculpt"),
            anchor: "Common_Values",
            quote: "'''Height''' (in '''Flatten''' mode): wanted terrain's absolute height",
          },
          {
            kind: "option",
            path: ["Terrain Creation Tool", "Sculpt", "Radius"],
            what: "radius (in metres) range 0..200",
            parent: tabParent("Sculpt"),
            anchor: "Common_Values",
            quote: "'''Radius''': radius (in metres) range 0..200",
          },
          {
            kind: "option",
            path: ["Terrain Creation Tool", "Sculpt", "Falloff"],
            what: 'the "cone/cylinder" slope ratio (see below) - range 0..100',
            parent: tabParent("Sculpt"),
            anchor: "Common_Values",
            quote: "'''Falloff''': the \"cone/cylinder\" slope ratio (see below) - range 0..100",
          },
          {
            kind: "option",
            path: ["Terrain Creation Tool", "Sculpt", "Angle"],
            what: "the effect angle - range 0..360",
            parent: tabParent("Sculpt"),
            anchor: "Common_Values",
            quote: "'''Angle''': the effect angle - range 0..360",
          },
          {
            kind: "shortcut",
            path: [
              "Terrain Creation Tool",
              "Info & Diags",
              "visualize surface layers painted on the terrain ground",
            ],
            shortcut: "Ctrl+X",
            parent: tabParent("Info & Diags"),
            anchor: "Block_and_Pixel_Under_Cursor_Diagnostics",
            quote:
              "you can press Ctrl+X in World Editor's viewport to visualize surface layers painted on the terrain ground",
          },
        ]);
        const cog = ctx.ix.byAnchor.get("Cogwheel");
        if (cog)
          mapTermLines(ctx, bodyLines(ctx.ix, cog), {
            kind: "menu-item",
            base: ["Terrain Creation Tool", "Manage", "Tile Map", "Minimap Controls", "Cogwheel"],
            parent: uiRef("WorldEditor", "control", [
              "Terrain Creation Tool",
              "Manage",
              "Tile Map",
              "Minimap Controls",
              "Cogwheel",
            ]),
            anchor: "Cogwheel",
          });
      },
    ),
  },
  {
    id: "tool-vector",
    fn: toolPageSpec("tool-vector", "World Editor: Vector Tool", "Vector Tool", (ctx, t) => {
      for (const root of ["Terrain_Snapping", "Point_management"]) {
        mapHeadings(ctx, {
          root,
          kinds: ["control"],
          mode: "leaf",
          base: ["Vector Tool"],
          parent: t,
          // "Snap to terrain" is two things on the page: a checkbox and a button.
          checkboxOption: true,
        });
      }
      const vt: CuratedRow["parent"] = { kind: "tool", path: ["Vector Tool"] };
      ctx.c.decisions.push({
        spec: ctx.spec,
        page: ctx.ix.page.title,
        anchor: "",
        what: "Vector Tool",
        reason:
          "the World Editor top bar lists a Vector Entity Tool (V) and this page describes the Vector Tool; the pages do not say they are the same tool, so both rows are kept",
      });
      // Two rows the pages do not call one thing: each names the other.
      const entityTool = ctx.c.find("tool", "WorldEditor", ["Vector Entity Tool"]);
      const pageTool = ctx.c.find("tool", "WorldEditor", ["Vector Tool"]);
      if (entityTool && pageTool) {
        const entityRows = [
          entityTool,
          ctx.c.find("shortcut", "WorldEditor", ["Top Bar", "Vector Entity Tool"]),
        ];
        for (const row of entityRows)
          ctx.c.note(
            row,
            `Kept apart from the Vector Tool row (${refOf(pageTool)}): the pages do not say that this top bar entry, "Vector Entity Tool", and the "Vector Tool" that page describes are one tool.`,
          );
        ctx.c.note(
          pageTool,
          `Kept apart from the Vector Entity Tool row (${refOf(entityTool)}): the pages do not say that the "Vector Entity Tool" in the World Editor top bar and this page's "Vector Tool" are one tool.`,
        );
      }
      mapCurated(ctx, [
        {
          kind: "control",
          path: ["Vector Tool", "New Polyline"],
          what: "is used to create a new shape",
          parent: vt,
          anchor: "New_Shape",
          quote: "'''New Polyline''' / '''New Spline''' is used to create a new shape.",
        },
        {
          kind: "control",
          path: ["Vector Tool", "New Spline"],
          what: "is used to create a new shape",
          parent: vt,
          anchor: "New_Shape",
          quote: "'''New Polyline''' / '''New Spline''' is used to create a new shape.",
        },
        {
          kind: "canvas-gesture",
          path: ["Vector Tool", "adds a point after the selected one"],
          shortcut: "Ctrl+LMB",
          parent: vt,
          anchor: "New_Shape",
          quote: "{{Controls|Ctrl|LMB}} adds a point '''after''' the selected one, whereas",
        },
        {
          kind: "canvas-gesture",
          path: ["Vector Tool", "adds a point before the selected one"],
          shortcut: "Alt+LMB",
          parent: vt,
          anchor: "New_Shape",
          quote: "{{Controls|Alt|LMB}} adds a point '''before''' the selected one.",
        },
      ]);
    }),
  },
];
SPECS.push(...MORE_SPECS);

// ── CLI, files, links, publish, debug panel, diag, launcher ──────────────────

const LAST_SPECS: { id: string; fn: SpecFn }[] = [
  {
    id: "cli-startup",
    fn: (env) => {
      const ctx = ctxOf(env, `${AR}Startup Parameters`, "none", "cli-startup");
      if (ctx) mapCliHeadings(ctx);
    },
  },
  {
    id: "cli-autotest",
    fn: (env) => {
      const ctx = ctxOf(env, `${AR}Autotest Framework`, "none", "cli-autotest");
      const t = ctx ? tablesIn(ctx.ix, "Command_Line")[0] : undefined;
      if (ctx && t) mapCliTable(ctx, t);
    },
  },
  {
    id: "file-types",
    fn: (env) => {
      const ctx = ctxOf(env, `${AR}File Types`, "ResourceManager", "file-types");
      const t = ctx ? ctx.ix.parsed.tables[0] : undefined;
      if (ctx && t) mapFileTypes(ctx, t);
    },
  },
  {
    id: "links",
    fn: (env) => {
      const ctx = ctxOf(env, `${AR}Workbench Links`, "none", "links");
      if (!ctx) return;
      const t = tablesIn(ctx.ix, "Format")[0];
      if (t) mapLinks(ctx, t);
      addRow(ctx, "link", "link-format", { name: "enfusion://" }, "enfusion://", {
        what: "A Workbench link is a protocol link that allows to share a direct point to a resource/script/game world location",
        anchor: "",
        quote:
          "A {{GameCategory|armaR|Modding|Official Tools|link= y|text= Workbench}} link is a protocol link that allows to share a direct point to a resource/script/game world location.",
      });
      addRow(
        ctx,
        "link",
        "link-format",
        { name: "https://enfusionengine.com/api/redirect?to=" },
        "https://enfusionengine.com/api/redirect?to=",
        {
          what: "provides a redirection for platforms that do not see enfusion:// as a valid protocol (e.g Discord)",
          anchor: "Format",
          quote:
            "the {{Link|https://enfusionengine.com|Enfusion Engine website}} provides a redirection for platforms that do not see {{hl|enfusion://}} as a valid protocol (e.g Discord).",
          confidence: "medium",
        },
      );
      // The two menu entries and the shortcut the "Link Creation" sections name (Resource
      // Manager's "Copy Link" is a row of the Resource Manager page's context table).
      mapCurated(ctx, [
        {
          kind: "menu-item",
          module: "ScriptEditor",
          path: ["Edit", "Copy link option"],
          shortcut: "Ctrl+Shift+L",
          what: "Create a link by selecting from the top menu Edit → Copy link option or by using the Ctrl+Shift+L shortcut",
          parent: { kind: "menu", path: ["Edit"] },
          anchor: "Script_Editor",
          quote: "'''Copy link option''' or by using the {{Controls|Ctrl|Shift|L}} shortcut",
          confidence: "medium",
        },
        {
          kind: "menu",
          module: "WorldEditor",
          path: ["Game"],
          anchor: "World_Editor",
          quote: "''Game →'' '''Copy view link''' option",
          confidence: "medium",
        },
        {
          kind: "menu-item",
          module: "WorldEditor",
          path: ["Game", "Copy view link"],
          shortcut: "Ctrl+Shift+L",
          what: "Create a link by selecting from the top menu Game → Copy view link option or by using the Ctrl+Shift+L shortcut",
          parent: { kind: "menu", path: ["Game"] },
          anchor: "World_Editor",
          quote:
            "''Game →'' '''Copy view link''' option or by using the {{Controls|Ctrl|Shift|L}} shortcut",
          confidence: "medium",
        },
      ]);
    },
  },
  {
    id: "publish",
    fn: (env) => {
      const ctx = ctxOf(env, `${AR}Mod Publishing Process`, "ResourceManager", "publish");
      if (!ctx) return;
      const dialog = addUi(ctx, "dialog", ["Publish Project"], {
        what: "Publishing a mod is the process of making the mod available on the Workshop.",
        risk: "external",
        parent: null,
        anchor: "Interface",
        quote: "In order to do so, click on '''Workbench > Publish Project'''.",
        container: true,
      });
      const fields = tablesIn(ctx.ix, "Interface")[0];
      if (fields)
        mapColumnsTable(ctx, fields, {
          kind: "control",
          label: 0,
          what: 1,
          base: ["Publish Project"],
          parent: dialog,
          risk: "external",
        });
      addUi(ctx, "dialog", ["Login"], {
        what: "This option should open new pop up window where it is possible to type email & password associated with Bohemia Account.",
        risk: "credential",
        parent: null,
        anchor: "Prerequisites",
        quote: "you can click on '''Login''' button",
        confidence: "medium",
        container: true,
      });
      mapCurated(ctx, [
        {
          kind: "control",
          path: ["Publish Project", "Publish"],
          what: "to publish the package to the workshop",
          risk: "external",
          parent: { kind: "dialog", path: ["Publish Project"] },
          anchor: "Publishing_Process",
          quote: "click on '''Publish''' to publish the package to the workshop",
          confidence: "medium",
        },
        {
          kind: "control",
          path: ["Login", "email"],
          what: "type email & password associated with Bohemia Account",
          risk: "credential",
          parent: { kind: "dialog", path: ["Login"] },
          anchor: "Prerequisites",
          quote: "type email & password associated with '''Bohemia Account'''",
          confidence: "medium",
        },
        {
          kind: "control",
          path: ["Login", "password"],
          what: "type email & password associated with Bohemia Account",
          risk: "credential",
          parent: { kind: "dialog", path: ["Login"] },
          anchor: "Prerequisites",
          quote: "type email & password associated with '''Bohemia Account'''",
          confidence: "medium",
        },
        {
          kind: "control",
          path: ["Login", "Login"],
          what: "if password and account are correct, this will log into your Bohemia Account",
          risk: "credential",
          parent: { kind: "dialog", path: ["Login"] },
          anchor: "Prerequisites",
          quote: "you can click on '''Login''' button",
          confidence: "medium",
        },
        {
          kind: "control",
          path: ["Login", "Forgot Password?"],
          what: "to initiate password recovery",
          risk: "external",
          parent: { kind: "dialog", path: ["Login"] },
          anchor: "Prerequisites",
          quote: "'''Forgot Password?''' link",
          confidence: "medium",
        },
        {
          kind: "control",
          path: ["Login", "Create Account"],
          what: "to create a new Bohemia Account",
          risk: "external",
          parent: { kind: "dialog", path: ["Login"] },
          anchor: "Prerequisites",
          quote: "'''Create Account''' link",
          confidence: "medium",
        },
        {
          kind: "menu-item",
          path: ["Workbench", "Remove from Workshop"],
          what: "Mods can be removed from by selecting Workbench → Remove from Workshop option in Resource Manager top bar.",
          risk: "destructive",
          parent: { kind: "menu", path: ["Workbench"] },
          anchor: "Removing_mod",
          quote: "Remove from Workshop''' option in '''Resource Manager''' top bar.",
          confidence: "medium",
        },
        {
          kind: "menu-item",
          path: ["Workbench", "Check Pending Invitation"],
          what: "Contributor needs to accept invitation via Workbench>Check Pending Invitation option in the toolbar.",
          risk: "external",
          parent: { kind: "menu", path: ["Workbench"] },
          anchor: "Interface",
          quote: "'''Pending Invitation''' option in the toolbar",
          confidence: "medium",
        },
      ]);
    },
  },
  {
    id: "debug-panel",
    fn: (env) => {
      const ctx = ctxOf(env, `${AR}AI Debug Panel Tutorial`, "Shared", "debug-panel");
      if (!ctx) return;
      const panel = addUi(ctx, "debug-panel", ["AI Debug Panel"], {
        what: firstSentence(leadLines(ctx.ix)),
        parent: null,
        anchor: "",
        quote: "The AI Debug Panel is an important tool for AI debug",
        container: true,
        // The lead names it in running prose: "The AI Debug Panel is an important tool ...".
        named: true,
      });
      const avail = tablesIn(ctx.ix, "Available_Data")[0];
      if (avail) mapAvailabilityTable(ctx, avail, ["AI Debug Panel"], panel);
      mapHeadings(ctx, {
        root: "Available_Buttons",
        kinds: ["control"],
        mode: "leaf",
        base: ["AI Debug Panel"],
        parent: panel,
        confidence: "medium",
      });
    },
  },
  {
    id: "diag-skeleton",
    fn: (env) => {
      const ctx = ctxOf(env, `${AR}Diag Menu`, "Shared", "diag-skeleton");
      if (ctx) mapDiagSkeleton(ctx);
    },
  },
  curatedSpec("launcher", `${AR}Mod Project Setup`, "Launcher", [
    {
      kind: "control",
      path: ["Add Existing"],
      anchor: "Adding_Arma_Reforger_Project",
      quote: 'Click "Add Existing" button',
    },
    {
      kind: "control",
      path: ["Add Project"],
      anchor: "Adding_Other_Existing_Projects",
      quote: "Click on '''+ Add Project''' button",
    },
    {
      kind: "control",
      path: ["Scan for Projects"],
      what: "Select folder where you have addons located, which you want to use as dependencies",
      anchor: "Adding_Other_Existing_Projects",
      quote: "Select '''Scan for Projects''' from the list",
    },
    {
      kind: "control",
      path: ["Create New"],
      what: "to open the project creation interface",
      anchor: "Project_Creation",
      quote: "Click \"'''Create New'''\" to open the project creation interface",
    },
    {
      kind: "dialog",
      path: ["Project Creation"],
      what: "the project creation interface",
      anchor: "Project_Creation",
      quote: "Click \"'''Create New'''\" to open the project creation interface",
      container: true,
    },
    {
      kind: "control",
      path: ["Project Creation", "project's name"],
      what: "Enter the project's name",
      parent: { kind: "dialog", path: ["Project Creation"] },
      anchor: "Project_Creation",
      quote: "Enter the project's name",
    },
    {
      kind: "control",
      path: ["Project Creation", "project's location"],
      what: "Confirm or edit the project's location",
      parent: { kind: "dialog", path: ["Project Creation"] },
      anchor: "Project_Creation",
      quote: "Confirm or edit the project's location",
    },
    {
      kind: "control",
      path: ["Project Creation", "Dependencies"],
      what: "dependencies are other projects (and/or mods) on which the current project relies to work",
      parent: { kind: "dialog", path: ["Project Creation"] },
      anchor: "Project_Creation",
      quote: "Pick the project's dependencies:",
    },
    {
      kind: "control",
      path: ["Project Creation", "OK"],
      what: "to create the project",
      parent: { kind: "dialog", path: ["Project Creation"] },
      anchor: "Project_Creation",
      quote: "Click \"'''OK'''\" to create the project.",
    },
  ]),
  curatedSpec("string-editor", `${AR}String Editor`, "LocalizationEditor", [
    {
      kind: "menu",
      path: ["File"],
      anchor: "Open_String_Editor",
      quote: "select File &rarr; Open",
    },
    {
      kind: "menu-item",
      path: ["File", "Open"],
      parent: { kind: "menu", path: ["File"] },
      anchor: "Open_String_Editor",
      quote: "select File &rarr; Open",
    },
    {
      kind: "menu-item",
      path: ["File", "Save"],
      shortcut: "Ctrl+S",
      parent: { kind: "menu", path: ["File"] },
      anchor: "Add_a_New_Localised_String",
      quote: "File &rarr; Save (or {{Controls|Ctrl|S}})",
    },
    {
      kind: "menu",
      path: ["Table"],
      anchor: "Add_a_New_Localised_String",
      quote: "Table &rarr; Build Runtime Table",
    },
    {
      kind: "menu-item",
      path: ["Table", "Build Runtime Table"],
      shortcut: "Ctrl+B",
      what: "Only after the following confirmation is the text ready to be used in game",
      parent: { kind: "menu", path: ["Table"] },
      anchor: "Add_a_New_Localised_String",
      quote: "Table &rarr; Build Runtime Table (or {{Controls|Ctrl|B}})",
    },
  ]),
];
SPECS.push(...LAST_SPECS);

// ── Page decisions ────────────────────────────────────────────────────────────

export interface PageDecision {
  title: string;
  slug: string;
  ns: number;
  id: number;
  in_scope: boolean;
  category: string;
  reason: string;
  /** Enumerator that owns the page's rows when it is not E07 (`E10`, `E14`...). */
  owner?: string;
  tables: number;
  tables_mapped: number;
  rows_emitted: number;
}

interface PageRule {
  test: (t: string, p: WikiPage) => boolean;
  in_scope: boolean;
  category: string;
  reason: string;
  owner?: string;
}

const EDITOR_PAGES =
  /^(?:World Editor|Resource Manager|Script Editor|String Editor|Animation Editor|Procedural Animation Editor|Behavior Editor|Audio Editor|Particle Editor)$/;

/** Ordered: the first rule that matches decides. Titles are tested without the `Arma Reforger:` prefix. */
export const PAGE_RULES: PageRule[] = [
  {
    test: (_t, p) => p.ns === 10,
    in_scope: false,
    category: "wiki-template",
    reason:
      "MediaWiki template (namespace Template): renders wiki markup and documents no Workbench surface",
  },
  {
    test: (t, p) => p.ns === 0 && t === "Doxygen",
    in_scope: false,
    category: "other-tool",
    reason:
      "page about the Doxygen tool; the 23 Doxygen pages shipped with the Tools install are E08's",
    owner: "E08",
  },
  {
    test: (_t, p) => p.ns === 0,
    in_scope: false,
    category: "general-wiki",
    reason: "general wiki page outside the Arma Reforger namespace; no Workbench surface",
  },
  // Workbench modules and their reference pages
  {
    test: (t) => EDITOR_PAGES.test(t),
    in_scope: true,
    category: "module-page",
    reason: "documents a Workbench module window: menus, panels, shortcuts",
  },
  {
    test: (t) => t === "Resource Manager: Options",
    in_scope: true,
    category: "options-dialog",
    reason: "documents the Workbench Options dialog",
  },
  {
    test: (t) =>
      /^Resource Manager: (?:Config|Imageset|Layout|Material|Model|Texture) Editor$/.test(t),
    in_scope: true,
    category: "rm-sub-editor",
    reason: "documents a Resource Manager sub-editor",
  },
  {
    test: (t) => /^World Editor: .+ Tool$/.test(t),
    in_scope: true,
    category: "we-tool-page",
    reason: "documents a World Editor tool and its options",
  },
  {
    test: (t) => /^World Editor: .+ Generator$/.test(t),
    in_scope: true,
    category: "we-generator-page",
    reason:
      "documents a World Editor generator entity; its properties belong to the attribute and schema censuses",
    owner: "E15",
  },
  {
    test: (t) =>
      /^(?:Animation Editor: .*Tutorial|Audio Editor: .*Tutorial|Procedural Animation Editor Basics Tutorial|Resource Manager: Getting Started Tutorial|World Editor: .*Tutorial|Navmesh Tutorial|New Terrain Setup|Terrain Tutorial|2D Map Creation|Mod Localisation)$/.test(
        t,
      ),
    in_scope: true,
    category: "module-tutorial",
    reason:
      "usage tutorial or workflow guide for a Workbench module (World Editor terrain and navmesh tools, Audio Editor, String Editor); no UI inventory beyond the module page",
  },
  {
    test: (t) =>
      /^(?:Animation Editor: (?:Nodes|Human Variables|Vehicle Action Commands|Character Action Commands|State Machine|Custom Properties)|Behavior Editor: Nodes|Audio Editor: (?:Audio Variables|Directivity|DSP Nodes|Nodes|Signal Editor|Signal Editor: Nodes)|Procedural Animation Editor: Nodes)$/.test(
        t,
      ),
    in_scope: true,
    category: "module-data-reference",
    reason: "Workbench editor node or variable reference: data schema rows, not UI",
    owner: "E10",
  },
  {
    test: (t) =>
      /^(?:Resource Manager: .*(?:Plugin|Plugins|Data To Spreadsheet)|Script Editor: .*Plugin.*|Floaters Finder Plugin|FPS Diagnostic Plugin|Scenario Framework Update Plugin|Snap And Orient Entities To Terrain Plugin|Object Import Tool|Autotest Framework)$/.test(
        t,
      ),
    in_scope: true,
    category: "plugin-page",
    reason: "documents a Workbench plugin or tool; plugin rows belong to the plugin census",
    owner: "E03",
  },
  {
    test: (t) =>
      /^(?:Workbench Plugin|Workbench Plugin Tutorial|World Editor Plugin|World Editor Tool|Resource Manager Plugin|Script Editor Plugin|String Editor Plugin)$/.test(
        t,
      ),
    in_scope: true,
    category: "plugin-scripting-guide",
    reason: "guide to writing Workbench plugins and tools; the API is E02's and the registry E03's",
    owner: "E02",
  },
  {
    test: (t) => t === "Startup Parameters",
    in_scope: true,
    category: "cli",
    reason: "startup parameters of the game, server and Workbench executables",
  },
  {
    test: (t) => t === "Workbench Links",
    in_scope: true,
    category: "link",
    reason: "documents the enfusion:// link forms",
  },
  {
    test: (t) => t === "File Types",
    in_scope: true,
    category: "file-types",
    reason: "table of the file types the Workbench works with",
  },
  {
    test: (t) => t === "Mod Publishing Process",
    in_scope: true,
    category: "publish",
    reason: "documents the Publish Project dialog and the Workshop login",
  },
  {
    test: (t) => t === "Mod Project Setup",
    in_scope: true,
    category: "launcher",
    reason: "documents the Workbench Launcher and project creation",
  },
  {
    test: (t) => t === "Diag Menu",
    in_scope: true,
    category: "diag-menu",
    reason: "the Diag Menu page: E14 owns its options; E07 emits only the top-level menu skeleton",
    owner: "E14",
  },
  {
    test: (t) => t === "AI Debug Panel Tutorial",
    in_scope: true,
    category: "debug-panel",
    reason: "documents the in-play AI Debug Panel",
  },
  {
    test: (t) => t === "Crash Report",
    in_scope: true,
    category: "hazard-dialog",
    reason: "documents the Crash Reporter dialog and log locations",
    owner: "E13",
  },
  {
    test: (t) => t === "Development Executables",
    in_scope: true,
    category: "executables",
    reason: "describes the Diag executables the Workbench debugging tools connect to",
  },
  {
    test: (t) => t === "Script Profiling",
    in_scope: true,
    category: "diag-menu-usage",
    reason: "names Diag Menu options and startup parameters used for script profiling",
    owner: "E14",
  },
  {
    test: (t) => t === "Workbench Metadata",
    in_scope: true,
    category: "file-format",
    reason: ".meta and .gproj resource metadata files the Workbench writes",
    owner: "E09",
  },
  // Out of scope
  {
    test: (t) => /^Enfusion Blender Tools|^Animation Export Profiles$/.test(t),
    in_scope: false,
    category: "blender-addon",
    reason: "Blender add-on documentation (module BlenderTools); E19 owns it",
    owner: "E19",
  },
  {
    test: (t) => /^Game Master/.test(t),
    in_scope: false,
    category: "in-game-editor",
    reason: "in-game Game Master editor (runtime), not a Workbench surface",
  },
  {
    test: (t) => /^(?:Server (?:Config|Hosting|Management|Area Code))$/.test(t),
    in_scope: false,
    category: "server",
    reason: "dedicated server hosting and configuration, not a Workbench surface",
  },
  {
    test: (t) =>
      /^(?:Enforce Script Syntax|Scripting\b.*|Create (?:a|an) .*|From SQF to Enforce Script|Class Template Example|Object Oriented Programming .*|Event Handlers|Entity (?:Activeness|Lifecycle)|JsonApiStruct Usage|Multiplayer Scripting|REST API Usage|ScriptInvoker Usage|Serialisation|Prefab Data|Resource Usage|BaseContainer Usage|WorldEditorAPI Usage|BaseDoorComponent|Input Manager|Damage Effects|Damage System|Persistence System|Terrain: Terrain Entity)$/.test(
        t,
      ),
    in_scope: false,
    category: "scripting-guide",
    reason:
      "Enforce scripting or game-API usage guide; the script API is E02's, not a Workbench surface",
  },
  {
    test: (t) => t === "From Arma 3 Tools to Workbench",
    in_scope: false,
    category: "migration-guide",
    reason:
      "equivalence table to Arma 3 tools that names Workbench actions without describing the UI",
  },
  {
    test: (t) =>
      /^(?:Experimental Branch|Getting Started|Workshop|Update History|Roadmap|Known Issues|Dictionary|Game Identity|Video Settings|Armavision|Field Manual.*|Directory Structure)$/.test(
        t,
      ),
    in_scope: false,
    category: "general-info",
    reason: "general game, distribution or release information; no Workbench surface",
  },
  {
    test: (t) =>
      /^(?:Conflict|Arland|Everon|Kolguyev|Capture & Hold Setup|General Game Mode Setup|Respawn Setup|Scenario Framework.*|Task System Usage|Hint Usage|Notification Creation|End Screen Creation|Dialog Configuration Tutorial|Layout Creation|Modular Button Component Tutorial|Widget Tooltip Setup|Action Context Setup|Commanding Menu Modding|Mod Localisation|Field Manual Modding)$/.test(
        t,
      ),
    in_scope: false,
    category: "gameplay-content",
    reason:
      "game mode, scenario or in-game UI content guide; uses the Workbench but documents no Workbench surface",
  },
  {
    test: () => true,
    in_scope: false,
    category: "asset-content",
    reason:
      "asset, audio or gameplay content authoring guide or reference; uses the Workbench but documents no Workbench surface",
  },
];

export function decidePage(p: WikiPage): {
  in_scope: boolean;
  category: string;
  reason: string;
  owner?: string;
} {
  const t = p.title.replace(/^Arma Reforger:/, "");
  const rule = PAGE_RULES.find((r) => r.test(t, p)) as PageRule;
  return {
    in_scope: rule.in_scope,
    category: rule.category,
    reason: rule.reason,
    owner: rule.owner,
  };
}

// ── Table decisions ───────────────────────────────────────────────────────────

export interface TableDecision {
  page: string;
  index: number;
  section: string;
  rows: number;
  status: "mapped" | "skipped";
  /** Spec id for a mapped table, the reason for a skipped one. */
  detail: string;
}

/** Reason a table was not mapped to rows. */
export function skipReason(
  ix: PageIndex,
  table: Table,
  pageDecision: { in_scope: boolean; category: string; owner?: string },
): string {
  if (!pageDecision.in_scope) return `page out of scope (${pageDecision.category})`;
  if (pageDecision.category === "module-data-reference")
    return "node or variable reference table (data schema, E10)";
  if (pageDecision.category === "we-generator-page") return "generator property table (E15)";
  if (pageDecision.category === "module-tutorial")
    return "tutorial example or reference table (no UI inventory)";
  if (pageDecision.category === "plugin-page" || pageDecision.category === "plugin-scripting-guide")
    return "plugin documentation table (E03 / E02)";
  const named = NAMED_SKIPS.find((r) => r.page === ix.page.title && r.section.test(table.section));
  if (named) return named.reason;
  const header = (
    table.rows[0] ? table.rows[0].cells.map((c) => c.text).join(" | ") : ""
  ).toLowerCase();
  if (table.parent !== null) return "nested table inside a cell of another table";
  if (/\bmessage\b.*\bmeaning\b/.test(header)) return "console message table (log text, not UI)";
  if (/^icon\b/.test(header)) return "icon legend";
  if (/before.*after|bad example|^do \||^name \| type \| usage/.test(header))
    return "example or comparison table";
  if (/^feature \| description/.test(header))
    return "feature description table, not a UI inventory";
  if (/^character \| function/.test(header))
    return "search syntax table (characters typed into the search bar)";
  if (
    /^status \| operation|^name \| description$/.test(header) &&
    ix.slug.endsWith("String_Editor")
  )
    return "localisation workflow or naming convention table";
  if (/keyword \| description|^type \| examples/.test(header)) return "code snippet table";
  if (/prefab \| notes|data \| |^h:/.test(header)) return "tutorial example table";
  if (/\{lighting\}|lighting/.test(header))
    return "lighting and channel option lists (shading menu choices)";
  if (/^name \| shortcut \| description \| command/.test(header))
    return "mapped by plugin shortcuts";
  if (ix.page.title.includes("Tutorial")) return "tutorial example table";
  return "descriptive or example table; no menu, shortcut, panel, option, file, CLI or link inventory";
}

/** Tables on in-scope pages that are deliberately not mapped, each with its reason. */
const NAMED_SKIPS: { page: string; section: RegExp; reason: string }[] = [
  {
    page: `${AR}Startup Parameters`,
    section: /^(?:wbModule|minidump)$/,
    reason: "value list of one CLI switch (values, not switches)",
  },
  {
    page: `${AR}Crash Report`,
    section: /./,
    reason:
      "Crash Reporter guidance, availability and path tables (hazard dialog and log paths belong to E13 and L16)",
  },
  {
    page: `${AR}Mod Project Setup`,
    section: /^Project_Creation$/,
    reason: "screenshot layout table (images only)",
  },
  {
    page: `${AR}Resource Manager: Layout Editor`,
    section: /^Events$/,
    reason: "widget event name list (script events, E02)",
  },
  {
    page: `${AR}Resource Manager: Model Editor`,
    section: /^Shading$/,
    reason:
      "lists of the shading menu's lighting and channel choices (the header cells carry the names)",
  },
  {
    page: `${AR}World Editor: Terrain Creation Tool`,
    section: /^Import_Height_Map$/,
    reason: "worked example of a height range conversion",
  },
  {
    page: `${AR}Diag Menu`,
    section: /^Hotkeys_List$/,
    reason: "Diag Menu hotkey table: E14 owns the option tables",
  },
];

// ── Finalize: parents, children counts, observations ─────────────────────────

export interface FinalRow {
  id: string;
  obs: Observation;
  draft: Draft;
}

export interface Finalized {
  rows: FinalRow[];
  /** Rows a spec produced whose kind or dim E07 may not emit, by kind. */
  blocked: Record<string, number>;
  blockedRows: { id: string; kind: string; page: string; anchor: string }[];
  /** Rows whose parent was a blocked or missing row and was re-pointed to the nearest emitted ancestor. */
  reparented: number;
  /** Rows whose named parent was never added: left as roots. */
  orphans: string[];
  invalid: { id: string; reason: string }[];
}

export function refOf(d: Draft): string {
  return `wiki:${titleSlug(d.page)}${d.anchor ? `#${d.anchor}` : ""}`;
}

export function finalize(
  c: Collector,
  allowed: { kinds: ReadonlySet<string>; dims: ReadonlySet<string> },
): Finalized {
  const can = (d: Draft): boolean => allowed.kinds.has(d.kind) && allowed.dims.has(d.dim);
  const blocked: Record<string, number> = {};
  const blockedRows: Finalized["blockedRows"] = [];
  const orphans: string[] = [];
  const invalid: Finalized["invalid"] = [];
  let reparented = 0;

  const idOfRef = (r: DraftRef): string | null => {
    try {
      return deriveId(r);
    } catch {
      return null;
    }
  };

  // Rows that stand beside an item (the shortcut row of a menu entry) take as parent the item (the
  // emitted row with the same key path of another kind) or, failing that, the nearest emitted
  // ancestor by key path: the key path says what contains the row.
  const emittedAt = new Map<string, string[]>();
  const pathKey = (d: DraftRef): string =>
    `${d.dim}\u0000${d.module}\u0000${(d.key.path ?? []).join("\u0000")}`;
  for (const [id, d] of c.all) {
    if (!can(d) || !d.key.path) continue;
    const k = pathKey(d);
    emittedAt.set(k, [...(emittedAt.get(k) ?? []), id]);
  }
  const derived = new Map<string, DraftRef | null>();
  const ITEM_KINDS_NOT_OWNERS = new Set<string>(["shortcut", "canvas-gesture"]);
  for (const [id, d] of c.all) {
    if (!d.parentByPath || !can(d) || !d.key.path) continue;
    const owner = (ids: readonly string[] | undefined): Draft | undefined =>
      (ids ?? [])
        .map((i) => ({ i, o: c.all.get(i) as Draft }))
        .find((x) => x.i !== id && !ITEM_KINDS_NOT_OWNERS.has(x.o.kind))?.o;
    let found = owner(emittedAt.get(pathKey(d)));
    for (let n = d.key.path.length - 1; !found && n >= 1; n--)
      found = owner(emittedAt.get(pathKey({ ...d, key: { path: d.key.path.slice(0, n) } })));
    derived.set(id, found ?? null);
  }
  const parentOf = (id: string, d: Draft): DraftRef | null =>
    d.parentByPath ? (derived.get(id) ?? null) : d.parent;

  const resolved = new Map<string, string | null>();
  const expected = new Map<string, number>();
  const emittedKids = new Map<string, number>();
  const kidSpecs = new Map<string, Set<string>>();
  for (const [id, d] of c.all) {
    const declared = parentOf(id, d);
    if (declared) {
      const pid = idOfRef(declared);
      if (pid) expected.set(pid, (expected.get(pid) ?? 0) + 1);
    }
    if (!can(d)) {
      blocked[d.kind] = (blocked[d.kind] ?? 0) + 1;
      blockedRows.push({ id, kind: d.kind, page: d.page, anchor: d.anchor });
      continue;
    }
    let pid: string | null = declared ? idOfRef(declared) : null;
    let climbed = false;
    for (let guard = 0; pid !== null && guard < 20; guard++) {
      const pd = c.all.get(pid);
      if (!pd) {
        orphans.push(`${id} -> ${pid}`);
        pid = null;
        break;
      }
      if (can(pd)) break;
      climbed = true;
      const up = parentOf(pid, pd);
      pid = up ? idOfRef(up) : null;
    }
    if (climbed) reparented++;
    resolved.set(id, pid);
    if (pid !== null) {
      emittedKids.set(pid, (emittedKids.get(pid) ?? 0) + 1);
      const set = kidSpecs.get(pid) ?? new Set<string>();
      set.add(d.spec);
      kidSpecs.set(pid, set);
    }
  }

  const rows: FinalRow[] = [];
  for (const [id, d] of c.all) {
    if (!can(d)) continue;
    const pid = resolved.get(id) ?? null;
    const pd = pid ? c.all.get(pid) : undefined;
    const count = emittedKids.get(id) ?? 0;
    const obs: Observation = {
      dim: d.dim,
      kind: d.kind,
      module: d.module,
      key: d.key,
      parent_key: pd ? { dim: pd.dim, kind: pd.kind, module: pd.module, key: pd.key } : null,
      label: d.label,
      what: d.what,
      shortcut_default: d.shortcut,
      risk_hint: d.risk,
      origin: "vanilla",
      ref: refOf(d),
      quote: d.quote,
      confidence: d.confidence,
      unverified: d.unverified?.length ? d.unverified : undefined,
      children_count:
        d.container === true &&
        count > 0 &&
        count === (expected.get(id) ?? 0) &&
        kidSpecs.get(id)?.size === 1 &&
        kidSpecs.get(id)?.has(d.spec)
          ? count
          : undefined,
    };
    const parsed = observationSchema.safeParse(obs);
    if (!parsed.success) {
      invalid.push({
        id,
        reason: `${parsed.error.issues[0].path.join(".")}: ${parsed.error.issues[0].message}`,
      });
      continue;
    }
    if (allStrings(parsed.data).some(containsMachinePath)) {
      invalid.push({ id, reason: "contains a machine path" });
      continue;
    }
    rows.push({ id, obs: parsed.data, draft: d });
  }
  rows.sort((a, b) => compareCodeUnits(a.id, b.id));
  return { rows, blocked, blockedRows, reparented, orphans, invalid };
}

// ── Gate checks ───────────────────────────────────────────────────────────────

/** Does a `wiki:` ref resolve to a page and a section (or table index) of the export? */
export function resolveRef(ref: string, bySlug: ReadonlyMap<string, PageIndex>): string | null {
  const m = /^wiki:([^#\s]+)(?:#(.+))?$/.exec(ref);
  if (!m) return "ref does not have the form wiki:<Page_title>#<anchor>";
  const ix = bySlug.get(m[1]);
  if (!ix) return `page ${m[1]} is not in the export`;
  const frag = m[2];
  if (frag === undefined) return null;
  if (ix.anchors.has(frag)) return null;
  const t = /^table-(\d+)$/.exec(frag);
  if (t && Number(t[1]) >= 1 && Number(t[1]) <= ix.parsed.tables.length) return null;
  return `section ${frag} does not exist on page ${m[1]}`;
}

export interface GateProblem {
  id: string;
  problem: string;
}

/** The refs of every row resolve; quotes are verbatim page text; no whitespace in the title part. */
export function checkRows(
  rows: readonly { id: string; obs: Observation }[],
  bySlug: ReadonlyMap<string, PageIndex>,
  refPattern: RegExp,
): GateProblem[] {
  const problems: GateProblem[] = [];
  for (const { id, obs } of rows) {
    if (!refPattern.test(obs.ref))
      problems.push({ id, problem: `ref ${obs.ref} does not match the ref pattern` });
    const bad = resolveRef(obs.ref, bySlug);
    if (bad) problems.push({ id, problem: bad });
    const slug = /^wiki:([^#]+)/.exec(obs.ref)?.[1] ?? "";
    const ix = bySlug.get(slug);
    if (obs.quote !== undefined && ix && !ix.page.text.includes(obs.quote)) {
      problems.push({ id, problem: "quote is not verbatim page text" });
    }
    if (obs.quote !== undefined && obs.quote.length > QUOTE_MAX)
      problems.push({ id, problem: "quote longer than 200 characters" });
  }
  return problems;
}

// ── The whole run ─────────────────────────────────────────────────────────────

export interface E07Allowed {
  kinds: ReadonlySet<string>;
  dims: ReadonlySet<string>;
}

export interface E07Result {
  rows: FinalRow[];
  finalized: Finalized;
  pages: PageDecision[];
  tables: TableDecision[];
  bySlug: Map<string, PageIndex>;
  collector: Collector;
  missingPages: string[];
  /** Sections of pages that emitted rows which hold list items or bold-led lines but no row. */
  unmapped: UnmappedSection[];
}

export interface UnmappedSection {
  page: string;
  anchor: string;
  heading: string;
  /** List items, definition terms and bold-led lines in the section's own lines. */
  items: number;
}

/**
 * Sections with list-like content that no emitted row cites. The tables are
 * tracked one by one (`tables`); this is the same account for the rest of a
 * page, so content a spec does not reach is visible instead of silent.
 */
export function unmappedSections(
  ix: PageIndex,
  rowAnchors: ReadonlySet<string>,
): UnmappedSection[] {
  const out: UnmappedSection[] = [];
  for (const h of ix.sections) {
    if (rowAnchors.has(h.anchor)) continue;
    const items = bodyLines(ix, h).filter((l) => {
      const t = l.text.trim();
      return /^(?:[*#;]+\s*\S|'''[^']+?''')/.test(t);
    }).length;
    if (items > 0) out.push({ page: ix.page.title, anchor: h.anchor, heading: h.text, items });
  }
  return out;
}

/** Runs every spec over the pages and returns rows, page decisions and table decisions. */
export function buildE07(pages: readonly WikiPage[], allowed: E07Allowed): E07Result {
  const index = new Map<string, PageIndex>();
  const bySlug = new Map<string, PageIndex>();
  for (const p of pages) {
    const ix = indexPage(p);
    index.set(p.title, ix);
    bySlug.set(ix.slug, ix);
  }
  const c = new Collector();
  const env: SpecEnv = { pages: index, c, missing: [] };
  for (const s of SPECS) s.fn(env);
  const finalized = finalize(c, allowed);

  const rowsByPage = new Map<string, number>();
  for (const r of finalized.rows)
    rowsByPage.set(r.draft.page, (rowsByPage.get(r.draft.page) ?? 0) + 1);

  const anchorsByPage = new Map<string, Set<string>>();
  for (const r of finalized.rows) {
    const set = anchorsByPage.get(r.draft.page) ?? new Set<string>();
    set.add(r.draft.anchor);
    anchorsByPage.set(r.draft.page, set);
  }
  const unmapped: UnmappedSection[] = [];
  const pageDecisions: PageDecision[] = [];
  const tableDecisions: TableDecision[] = [];
  for (const p of pages) {
    const ix = index.get(p.title) as PageIndex;
    const d = decidePage(p);
    const mapped = c.mappedTables.get(p.title) ?? new Map<number, string>();
    const cited = anchorsByPage.get(p.title);
    if (d.in_scope && cited) unmapped.push(...unmappedSections(ix, cited));
    for (const t of ix.parsed.tables) {
      const spec = mapped.get(t.index);
      tableDecisions.push({
        page: p.title,
        index: t.index,
        section: t.section,
        rows: t.rows.length,
        status: spec ? "mapped" : "skipped",
        detail: spec ?? skipReason(ix, t, d),
      });
    }
    pageDecisions.push({
      title: p.title,
      slug: ix.slug,
      ns: p.ns,
      id: p.id,
      in_scope: d.in_scope,
      category: d.category,
      reason: d.reason,
      ...(d.owner ? { owner: d.owner } : {}),
      tables: ix.parsed.tables.length,
      tables_mapped: mapped.size,
      rows_emitted: rowsByPage.get(p.title) ?? 0,
    });
  }
  return {
    rows: finalized.rows,
    finalized,
    pages: pageDecisions,
    tables: tableDecisions,
    bySlug,
    collector: c,
    missingPages: env.missing,
    unmapped,
  };
}

// ── Output file and CLI ───────────────────────────────────────────────────────

/** Enumerator id (plan 4.5). */
export const ENUMERATOR_ID = "E07";
/** Registered generator path (must equal universes.json `enumerators.E07.generator`). */
export const GENERATOR = "scripts/census/enumerators/e07-wiki-tables.ts";
const EXPORT_PLACEHOLDER = "<repo>/data/wiki/export.xml";

/** Exact text of the E07 observation file. */
export function observationFileText(
  rows: readonly FinalRow[],
  build: string,
  inputs: { path: string; sha256: string }[],
): string {
  const header = {
    $header: 1,
    build,
    enumerator: ENUMERATOR_ID,
    generator: GENERATOR,
    inputs,
    provisional: false,
    row_count: rows.length,
  };
  return [jsonlLine(header, ["$header"]), ...rows.map((r) => jsonlLine(r.obs))].join("\n") + "\n";
}

/** Counts that the main session re-computes (gate numbers and headline counts). */
export interface Headlines {
  pages_in_export: number;
  pages_decided: number;
  pages_in_scope: number;
  pages_out_of_scope: number;
  tables_total: number;
  tables_mapped: number;
  tables_skipped: number;
  skipped_by_reason: Record<string, number>;
  rows: number;
  rows_by_kind: Record<string, number>;
  rows_by_module: Record<string, number>;
  rows_by_dim: Record<string, number>;
  /** Rows that carry an `unverified` statement (identity merges, contradictions, TODOs). */
  rows_with_unverified: number;
  cli_switches: number;
  cli_switches_startup_parameters: number;
  file_types: number;
  link_formats: number;
  blocked_by_kind: Record<string, number>;
  /** Sections with list-like content on pages that emitted rows, cited by no row (see report.json). */
  unmapped_sections: number;
  unmapped_items: number;
}

function tally<T>(xs: readonly T[], key: (x: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of xs) out[key(x)] = (out[key(x)] ?? 0) + 1;
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => compareCodeUnits(a, b)));
}

export function headlines(r: E07Result, pagesInExport: number): Headlines {
  const skipped = r.tables.filter((t) => t.status === "skipped");
  return {
    pages_in_export: pagesInExport,
    pages_decided: r.pages.length,
    pages_in_scope: r.pages.filter((p) => p.in_scope).length,
    pages_out_of_scope: r.pages.filter((p) => !p.in_scope).length,
    tables_total: r.tables.length,
    tables_mapped: r.tables.length - skipped.length,
    tables_skipped: skipped.length,
    skipped_by_reason: tally(skipped, (t) => t.detail),
    rows: r.rows.length,
    rows_by_kind: tally(r.rows, (x) => x.obs.kind),
    rows_by_module: tally(r.rows, (x) => x.obs.module),
    rows_by_dim: tally(r.rows, (x) => x.obs.dim),
    rows_with_unverified: r.rows.filter((x) => x.obs.unverified !== undefined).length,
    cli_switches: r.rows.filter((x) => x.obs.kind === "cli-switch").length,
    cli_switches_startup_parameters: r.rows.filter(
      (x) => x.obs.kind === "cli-switch" && x.draft.page === `${AR}Startup Parameters`,
    ).length,
    file_types: r.rows.filter((x) => x.obs.kind === "file-type").length,
    link_formats: r.rows.filter((x) => x.obs.kind === "link-format").length,
    blocked_by_kind: Object.fromEntries(
      Object.entries(r.finalized.blocked).sort(([a], [b]) => compareCodeUnits(a, b)),
    ),
    unmapped_sections: r.unmapped.length,
    unmapped_items: r.unmapped.reduce((n, u) => n + u.items, 0),
  };
}

/** Text of `page-decisions.json` (artifacts folder). */
export function pageDecisionsText(r: E07Result, build: string, exportSha: string): string {
  const h = headlines(r, r.pages.length);
  return (
    JSON.stringify(
      {
        build,
        enumerator: ENUMERATOR_ID,
        export: { path: EXPORT_PLACEHOLDER, sha256: exportSha, pages: r.pages.length },
        summary: {
          pages: h.pages_decided,
          in_scope: h.pages_in_scope,
          out_of_scope: h.pages_out_of_scope,
        },
        pages: r.pages,
      },
      null,
      2,
    ) + "\n"
  );
}

/** Text of `report.json`: everything E07 did not emit and why. */
export function reportText(r: E07Result, build: string, pagesInExport: number): string {
  const c = r.collector;
  const sortBy = <T extends { page?: string; anchor?: string; what?: string }>(xs: T[]): T[] =>
    [...xs].sort(
      (a, b) =>
        compareCodeUnits(a.page ?? "", b.page ?? "") ||
        compareCodeUnits(a.anchor ?? "", b.anchor ?? "") ||
        compareCodeUnits(a.what ?? "", b.what ?? ""),
    );
  return (
    JSON.stringify(
      {
        build,
        enumerator: ENUMERATOR_ID,
        headlines: headlines(r, pagesInExport),
        tables: r.tables,
        blocked_rows: [...r.finalized.blockedRows].sort((a, b) => compareCodeUnits(a.id, b.id)),
        reparented_rows: r.finalized.reparented,
        orphan_rows: [...r.finalized.orphans].sort(compareCodeUnits),
        duplicates: sortBy(c.duplicates),
        skipped_rows: sortBy(c.skipped),
        rewritten_descriptions: sortBy(c.rewritten),
        identity_decisions: sortBy(c.decisions),
        unmapped_sections: r.unmapped,
        invalid_drafts: sortBy(c.invalid),
        invalid_observations: r.finalized.invalid,
        missing_pages: r.missingPages,
      },
      null,
      2,
    ) + "\n"
  );
}

const USAGE =
  "usage: e07-wiki-tables.ts [--export <export.xml>] [--build <tag>] [--out <file under observations/E07/>] [--artifacts <dir>] [--no-artifacts] [--data <dir>] [--json]";

/** Resolves `--out`, refusing anything outside `<census>/observations/E07/`. */
export function resolveOut(paths: CensusPaths, out: string | undefined, build: string): string {
  const dir = join(paths.observations, ENUMERATOR_ID);
  const file = out ? resolve(out) : join(dir, `${build}.jsonl`);
  if (dirname(file) !== dir || !file.endsWith(".jsonl")) {
    throw new Error(
      "refusing --out outside observations/E07/ (E07 writes only its own observation directory)",
    );
  }
  return file;
}

export function run(argv: string[], io: Io = PROCESS_IO): number {
  return guard(io, "e07-wiki-tables", () => {
    const { values } = parseArgs({
      args: argv,
      options: {
        export: { type: "string" },
        build: { type: "string" },
        out: { type: "string" },
        artifacts: { type: "string" },
        "no-artifacts": { type: "boolean" },
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
    if (
      values.artifacts &&
      !values["no-artifacts"] &&
      insideGitWorkTree(resolve(values.artifacts))
    ) {
      io.err(
        "e07-wiki-tables: refusing --artifacts inside a git working tree (raw material stays out of the repository); nothing written",
      );
      return EXIT_FAIL;
    }
    const paths = pathsFrom(values.data);
    const build = values.build ?? loadCurrentBuild(paths).tag;
    let out: string;
    try {
      out = resolveOut(paths, values.out, build);
    } catch (e) {
      io.err(`e07-wiki-tables: ${e instanceof Error ? e.message : String(e)}`);
      return EXIT_FAIL;
    }
    const def = loadUniverses(paths).enumerators[ENUMERATOR_ID];
    if (!def) {
      io.err("e07-wiki-tables: universes.json declares no E07");
      return EXIT_MALFORMED;
    }
    const exportFile = values.export
      ? resolve(values.export)
      : join(paths.repo, "data", "wiki", "export.xml");
    if (!existsSync(exportFile)) {
      io.out("NO DATA: no data/wiki/export.xml (cached wiki export); nothing enumerated");
      return EXIT_USAGE;
    }
    const raw = readFileSync(exportFile);
    const xml = raw.toString("utf-8");
    const pagesInExport = (xml.match(/<page>/g) ?? []).length;
    const pages = parseExport(xml);
    const result = buildE07(pages, {
      kinds: new Set<string>(def.kinds),
      dims: new Set<string>(def.dims),
    });
    const problems: string[] = [];
    if (pages.length !== pagesInExport)
      problems.push(`parsed ${pages.length} pages but the export holds ${pagesInExport}`);
    if (result.pages.length !== pagesInExport)
      problems.push(`${result.pages.length} page decisions for ${pagesInExport} pages`);
    for (const p of checkRows(result.rows, result.bySlug, new RegExp(def.ref_pattern)))
      problems.push(`${p.id}: ${p.problem}`);
    for (const p of result.finalized.invalid) problems.push(`${p.id}: ${p.reason}`);
    for (const m of result.missingPages) problems.push(`page not in the export: ${m}`);
    if (problems.length) {
      for (const p of problems.slice(0, 50)) io.err(`gate: ${p}`);
      io.err(`e07-wiki-tables: ${problems.length} gate problem(s); nothing written`);
      return EXIT_FAIL;
    }
    const sha = sha256(raw);
    mkdirSync(dirname(out), { recursive: true });
    writeFileAtomic(
      out,
      observationFileText(result.rows, build, [{ path: EXPORT_PLACEHOLDER, sha256: sha }]),
    );
    let artifactDir = "";
    if (!values["no-artifacts"]) {
      const root = values.artifacts ? resolve(values.artifacts) : artifactsDir();
      artifactDir = join(root, "census", build, ENUMERATOR_ID);
      mkdirSync(artifactDir, { recursive: true });
      writeFileAtomic(
        join(artifactDir, "page-decisions.json"),
        pageDecisionsText(result, build, sha),
      );
      writeFileAtomic(join(artifactDir, "report.json"), reportText(result, build, pagesInExport));
    }
    const h = headlines(result, pagesInExport);
    if (values.json) {
      io.out(JSON.stringify({ ok: true, command: "e07-wiki-tables", build, ...h }));
      return EXIT_OK;
    }
    io.out(
      `E07 at build ${build}: ${h.rows} observations; pages ${h.pages_in_export} (${h.pages_in_scope} in scope, ${h.pages_out_of_scope} out); ` +
        `tables ${h.tables_total} (${h.tables_mapped} mapped, ${h.tables_skipped} skipped); ` +
        `cli ${h.cli_switches}, file types ${h.file_types}, links ${h.link_formats}`,
    );
    for (const [k, n] of Object.entries(h.rows_by_kind)) io.out(`  ${k}: ${n}`);
    for (const [k, n] of Object.entries(h.blocked_by_kind))
      io.out(`  not emitted (kind not allowed for E07): ${k}: ${n}`);
    return EXIT_OK;
  });
}

if (isMainModule(import.meta.url)) process.exitCode = run(process.argv.slice(2));
