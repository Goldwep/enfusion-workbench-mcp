/**
 * E16 — property-editor kinds (plan 4.5). The widgets that Workbench's
 * property grids use to edit a value: the members of the `UIWidgets` script
 * class (`scripts/Core/attributes.c` in the game paks at build 1.8.0.13).
 * Nothing is executed and nothing is fetched.
 *
 * What it writes
 *  - `data/census/observations/E16/<build>.jsonl`: one `property-editor` row per
 *    `UIWidgets` member (dim ui, module Shared, key {path: ["UIWidgets", <Member>]},
 *    ref `pak:<file>#L<line>` of the member's declaration, label the member name,
 *    `what` the first paragraph of its doc comment when that paragraph is a
 *    sentence about the kind (left out when the member has no doc comment, and
 *    when the first paragraph is only a lead-in ending in a colon: the source
 *    says nothing then; the usage count is in the report, not in a row),
 *    quote the declaration line), and one `dialog` row as the child of each kind whose
 *    source shows that it opens a popup (key {path: ["UIWidgets", <Member>, "popup"]}).
 *  - Outside the repository (the artifacts folder, `census/<build>/E16/report.json`):
 *    the usage table, the popup decision for every member and the wiki cross-check.
 *
 * How it reads
 *  1. The members come from the E02 source index (`src/census/source-index.ts`):
 *     the fields of class `UIWidgets`, with their doc comments and lines. The
 *     verbatim quote of each row is the declaration line read as bytes from the pak.
 *  2. Usage: every attribute annotation of every record of the index whose
 *     arguments name `UIWidgets.<Member>` as a bare top-level argument or as the
 *     value of `uiwidget:`. A member of the class counts the annotations that name
 *     it. This is a reading of what the source names; how the engine binds an
 *     argument that follows a named one is not read (the report counts those
 *     annotations as `annotations_widget_after_named_argument`: 177 at build
 *     1.8.0.13, 137 of them `defvalue: X, UIWidgets.Y`) [unverified].
 *  3. A popup child exists only where a source shows one, strongest first:
 *     a doc comment line that says the kind "opens" a window, dialog or popup
 *     (confidence high, ref at that line); a sentence of the community wiki's
 *     widget table that says clicking displays a picker, dialog or window
 *     (medium: the wiki says a picker is displayed, not that a window opens, and
 *     the ref is the declaration, which says nothing about it); the member's own
 *     name, where it holds "Picker" or "Dialog" (medium). The statement each row rests on is in its
 *     `unverified` list. A kind whose source names an editor or says "picker" in
 *     its doc comment only is not given a popup row (listed in the report).
 *
 *   npx tsx scripts/census/enumerators/e16-property-editors.ts [--build <tag>]
 *       [--game <dir> | --scripts <dir>] [--wiki <file>] [--artifacts <dir>] [--no-artifacts]
 *       [--out <file under observations/E16/>] [--data <dir>] [--json]
 *
 * --game       game install with pak files (default ENFUSION_GAME_PATH); the source
 *              index is read from the artifacts folder, or built in memory when absent
 * --scripts    a loose tree of script files (virtual paths) instead of the paks; the
 *              index is built from it (tests)
 * --wiki       default <repo>/data/wiki/export.xml, taken from the census root's repository
 *              when that has it, else from the repository this script is in (so a run on
 *              a temporary copy of data/census still reads the wiki); absent: no wiki evidence
 * --artifacts  default the harness artifacts folder (scripts/live/paths.ts); refused inside
 *              a git working tree
 *
 * Exit: 0 written; 1 refused (output outside observations/E16/) or a row failed the
 * schema; 2 usage or no data (NO DATA); 3 malformed census configuration.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { compareCodeUnits, jsonlLine, sha256 } from "../../../src/census/canon.js";
import { loadCurrentBuild, loadUniverses } from "../../../src/census/census-config.js";
import { allStrings, containsMachinePath } from "../../../src/census/hygiene.js";
import { deriveId } from "../../../src/census/ids.js";
import { writeFileAtomic, type CensusPaths } from "../../../src/census/ledger-io.js";
import { observationSchema, type Observation } from "../../../src/census/schemas.js";
import {
  buildSourceIndex,
  findClass,
  loadSourceIndex,
  pakRef,
  type FieldRecord,
  type SourceIndex,
  type SourceInput,
} from "../../../src/census/source-index.js";
import type { Module } from "../../../src/census/vocab.js";
import { loadConfig } from "../../../src/config.js";
import { PakVirtualFS } from "../../../src/pak/vfs.js";
import { artifactsDir, insideGitWorkTree } from "../../live/paths.js";
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
export const ENUMERATOR_ID = "E16";
/** Registered generator path (must equal universes.json `enumerators.E16.generator`). */
export const GENERATOR = "scripts/census/enumerators/e16-property-editors.ts";
/** The script class whose members are the editor kinds. */
export const WIDGETS_CLASS = "UIWidgets";
/** The plan's count of members (plan 4.5 E16, universes.json `expected`). */
export const EXPECTED_MEMBERS = 31;
/** Module of every row: the property grid is shared by all modules. */
const MODULE: Module = "Shared";
const QUOTE_MAX = 200;
const WHAT_MAX = 400;
/** Default location of the wiki export, relative to the repository. */
export const WIKI_EXPORT = "data/wiki/export.xml";

// ── Members ───────────────────────────────────────────────────────────────────

export interface WidgetMember {
  name: string;
  /** The string the member holds (`colorPicker`), without quotes. */
  value: string | undefined;
  file: string;
  line: number;
  /** Doc comment text, as the index holds it. */
  doc: string | undefined;
  /** Declaration without the trailing `;`. */
  signature: string;
}

/** Unquotes a string literal initialiser; undefined for anything else. */
export function stringValue(init: string | undefined): string | undefined {
  if (init === undefined) return undefined;
  const m = /^"((?:[^"\\]|\\.)*)"$/.exec(init.trim());
  return m ? m[1] : undefined;
}

/** The static string members of class `UIWidgets`, in declaration order. */
export function widgetMembers(index: SourceIndex): WidgetMember[] {
  const cls = findClass(index, WIDGETS_CLASS);
  if (!cls || cls.declarations.every((d) => d.forward)) return [];
  return cls.fields
    .filter((f: FieldRecord) => f.owner === WIDGETS_CLASS && f.kind === "field")
    .map((f) => ({
      name: f.name,
      value: stringValue(f.init),
      file: f.file,
      line: f.line,
      doc: f.doc,
      signature: f.signature,
    }));
}

// ── Usage: attribute annotations that name a widget ──────────────────────────

/** Splits attribute argument text at top-level commas (strings and brackets respected). */
export function splitArguments(args: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inString = false;
  let cur = "";
  for (let i = 0; i < args.length; i++) {
    const c = args[i];
    if (inString) {
      cur += c;
      if (c === "\\") cur += args[++i] ?? "";
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      cur += c;
    } else if (c === "(" || c === "{" || c === "[") {
      depth++;
      cur += c;
    } else if (c === ")" || c === "}" || c === "]") {
      depth--;
      cur += c;
    } else if (c === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  if (cur.trim() !== "" || out.length > 0) out.push(cur.trim());
  return out;
}

const NAMED_ARG = /^([A-Za-z_]\w*)\s*:(?!:)\s*([\s\S]*)$/;
const WIDGET_REF = /^UIWidgets\.([A-Za-z_]\w*)$/;

/**
 * Names of the `UIWidgets` members an annotation's arguments name: a bare
 * top-level argument `UIWidgets.<Name>`, or the value of `uiwidget:`. A named
 * argument other than `uiwidget` never counts. Distinct, in argument order.
 */
export function widgetsNamedBy(args: string | undefined): string[] {
  if (!args) return [];
  const out: string[] = [];
  for (const arg of splitArguments(args)) {
    const named = NAMED_ARG.exec(arg);
    let value: string;
    if (named) {
      if (named[1] !== "uiwidget") continue;
      value = named[2].trim();
    } else value = arg;
    const m = WIDGET_REF.exec(value);
    if (m && !out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/**
 * True when a bare `UIWidgets.<Name>` argument follows a named argument
 * (`defvalue: "1", UIWidgets.EditBox`). Counted so the report can say how many
 * annotations rest on the positional reading.
 */
export function widgetAfterNamedArgument(args: string | undefined): boolean {
  if (!args) return false;
  let sawNamed = false;
  for (const arg of splitArguments(args)) {
    if (NAMED_ARG.test(arg)) sawNamed = true;
    else if (sawNamed && WIDGET_REF.test(arg)) return true;
  }
  return false;
}

export interface UsageTable {
  /** Attribute annotations of every record of the index (any attribute name). */
  annotations_scanned: number;
  /** Annotations whose arguments name at least one `UIWidgets` member. */
  annotations_naming_a_widget: number;
  /** Of those, annotations that write the widget as a bare argument after a named one. */
  annotations_widget_after_named_argument: number;
  /** Per member name of the class: annotations that name it (every member present, 0 when unused). */
  by_member: Record<string, number>;
  /** Names written as `UIWidgets.<Name>` that are not members of the class. */
  unknown_members: Record<string, number>;
  /** Annotations naming a widget, by attribute name. */
  by_attribute_name: Record<string, number>;
  /** Annotations naming a widget, by the kind of record that carries them. */
  by_host_kind: Record<string, number>;
}

/** Counts, for every member, the annotations of the index that name it. */
export function usageTable(index: SourceIndex, members: readonly string[]): UsageTable {
  const known = new Set(members);
  const table: UsageTable = {
    annotations_scanned: 0,
    annotations_naming_a_widget: 0,
    annotations_widget_after_named_argument: 0,
    by_member: Object.fromEntries(members.map((m) => [m, 0])),
    unknown_members: {},
    by_attribute_name: {},
    by_host_kind: {},
  };
  for (const r of index.records) {
    const attrs = "attributes" in r ? r.attributes : undefined;
    if (!attrs) continue;
    for (const a of attrs) {
      table.annotations_scanned++;
      const named = widgetsNamedBy(a.args);
      if (named.length === 0) continue;
      table.annotations_naming_a_widget++;
      if (widgetAfterNamedArgument(a.args)) table.annotations_widget_after_named_argument++;
      table.by_attribute_name[a.name] = (table.by_attribute_name[a.name] ?? 0) + 1;
      table.by_host_kind[r.kind] = (table.by_host_kind[r.kind] ?? 0) + 1;
      for (const n of named) {
        if (known.has(n)) table.by_member[n]++;
        else table.unknown_members[n] = (table.unknown_members[n] ?? 0) + 1;
      }
    }
  }
  return table;
}

/** The `n` most used members: count descending, then name in code-unit order; unused ones never listed. */
export function topUsed(table: UsageTable, n: number): { member: string; count: number }[] {
  return Object.entries(table.by_member)
    .filter(([, c]) => c > 0)
    .map(([member, count]) => ({ member, count }))
    .sort((a, b) => b.count - a.count || compareCodeUnits(a.member, b.member))
    .slice(0, n);
}

// ── Wiki widget table ─────────────────────────────────────────────────────────

export interface WikiWidgetRow {
  /** Wiki page title. */
  page: string;
  /** The widget name in the first cell, as written. */
  name: string;
  /** The description cell, markup removed. */
  description: string;
  /** Which table of the page the row is in (tables are numbered in order of their `{|`; nested ones too). */
  table: number;
}

const XML_ENTITIES: Record<string, string> = {
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&amp;": "&",
};

function xmlUnescape(s: string): string {
  return s.replace(/&(?:lt|gt|quot|apos|amp);/g, (m) => XML_ENTITIES[m]);
}

/** Wikitext to plain words: templates dropped, links reduced to their label, emphasis removed. */
export function plainWikitext(s: string): string {
  let t = s.replace(/<!--[\s\S]*?-->/g, " ");
  for (let i = 0; i < 4; i++) t = t.replace(/\{\{[^{}]*\}\}/g, " ");
  t = t.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1");
  t = t.replace(/'{2,}/g, "").replace(/<[^>]+>/g, " ");
  return t.replace(/\s+/g, " ").trim();
}

/**
 * The rows `| <Name>` / `| <description>` of every wikitext table on a page
 * of the export that names `UIWidgets`. The export is read as text; nothing
 * is fetched.
 */
export function wikiWidgetRows(xml: string): WikiWidgetRow[] {
  const rows: WikiWidgetRow[] = [];
  for (const m of xml.matchAll(/<page>([\s\S]*?)<\/page>/g)) {
    const title = /<title>([\s\S]*?)<\/title>/.exec(m[1])?.[1];
    const body = /<text\b[^>]*>([\s\S]*?)<\/text>/.exec(m[1])?.[1];
    if (title === undefined || body === undefined) continue;
    const text = xmlUnescape(body);
    if (!text.includes(WIDGETS_CLASS)) continue;
    const lines = text.split(/\r?\n/);
    const open: number[] = [];
    let tables = 0;
    for (let i = 0; i + 1 < lines.length; i++) {
      if (/^\{\|/.test(lines[i])) open.push(++tables);
      else if (/^\|\}/.test(lines[i])) open.pop();
      if (!/^\|-\s*$/.test(lines[i])) continue;
      const table = open[open.length - 1] ?? 0;
      const name = /^\|\s*([A-Za-z_]\w*)\s*$/.exec(lines[i + 1])?.[1];
      if (name === undefined) continue;
      let j = i + 2;
      if (j >= lines.length || !/^\|(?![-}])/.test(lines[j])) continue;
      const cell = [lines[j].replace(/^\|\s*/, "")];
      for (j++; j < lines.length && !/^(\||!|<!--|\{\|)/.test(lines[j]); j++) cell.push(lines[j]);
      rows.push({
        page: xmlUnescape(title),
        name,
        description: plainWikitext(cell.join("\n")),
        table,
      });
    }
  }
  return rows;
}

/** Tables holding at least this many member names are the widget tables. */
const WIDGET_TABLE_MIN_MATCHES = 3;

/**
 * The rows of the tables that are the wiki's widget table: those in which at
 * least three first-cell names equal a member name (case-insensitive). Other
 * tables of the same page (the attribute parameter table, the default-widget
 * table) are left out.
 */
export function widgetTableRows(
  rows: readonly WikiWidgetRow[],
  memberNames: readonly string[],
): WikiWidgetRow[] {
  const names = new Set(memberNames.map((n) => n.toLowerCase()));
  const matches = new Map<string, number>();
  for (const r of rows)
    if (names.has(r.name.toLowerCase()))
      matches.set(`${r.page}\u0000${r.table}`, (matches.get(`${r.page}\u0000${r.table}`) ?? 0) + 1);
  return rows.filter(
    (r) => (matches.get(`${r.page}\u0000${r.table}`) ?? 0) >= WIDGET_TABLE_MIN_MATCHES,
  );
}

// ── Popup evidence ────────────────────────────────────────────────────────────

/** A doc sentence that says the kind opens a window, dialog or popup. */
const DOC_POPUP = /\bopens?\b[^.]*\b(?:window|dialog|popup|pop-up)\b/i;
/** A wiki sentence that says using the kind displays a picker, dialog or window. */
const WIKI_POPUP = /\b(?:display|show|open)s?\b[^.]*\b(?:picker|dialog|popup|pop-up|window)\b/i;
/** A member name that is itself a picker or a dialog. */
const NAME_POPUP = /Picker|Dialog/;
/** Words that make a doc comment worth a mention in the report when no popup row follows. */
const POPUP_HINT = /\b(?:picker|picking|opens?|window|dialog|popup|pop-up|editor)\b/i;

function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+/)
    .filter((s) => s !== "");
}

export interface PopupEvidence {
  kind: "doc" | "wiki" | "name";
  confidence: "high" | "medium";
  /** Line the row cites (the declaration line for wiki and name evidence). */
  line: number;
  /** The sentence the popup rests on, when a source has one. */
  sentence?: string;
  /** Entry for the row's `unverified` list. */
  unverified: string;
}

/** The first line of the doc comment that ends just above `declLine` and matches `re`. */
function docLines(lines: readonly string[], declLine: number): { from: number; to: number } | null {
  let end = declLine - 1;
  while (end >= 1 && lines[end - 1].trim() === "") end--;
  if (end < 1) return null;
  const last = lines[end - 1].trim();
  if (last.endsWith("*/")) {
    let from = end;
    while (from >= 1 && !lines[from - 1].includes("/*")) from--;
    return from >= 1 ? { from, to: end } : null;
  }
  if (last.startsWith("//")) {
    let from = end;
    while (from > 1 && lines[from - 2].trim().startsWith("//")) from--;
    return { from, to: end };
  }
  return null;
}

/**
 * What the sources show about a popup for one member, or undefined when
 * none does. `lines` are the raw lines of the member's file.
 */
export function popupEvidence(
  member: WidgetMember,
  lines: readonly string[] | undefined,
  wiki: readonly WikiWidgetRow[],
): PopupEvidence | undefined {
  // 1. A doc comment that says it opens a window, dialog or popup.
  const sentence = sentences(member.doc ?? "").find((s) => DOC_POPUP.test(s));
  if (sentence !== undefined) {
    let line = member.line;
    const range = lines ? docLines(lines, member.line) : null;
    if (lines && range) {
      for (let n = range.from; n <= range.to; n++)
        if (/\bopens?\b/i.test(lines[n - 1])) {
          line = n;
          break;
        }
    }
    return {
      kind: "doc",
      confidence: "high",
      line,
      sentence,
      unverified: `doc comment of UIWidgets.${member.name} says: "${sentence}"; it does not say whether the window is modal`,
    };
  }
  // 2. A sentence of the wiki's widget table.
  const lower = member.name.toLowerCase();
  for (const row of wiki) {
    if (row.name.toLowerCase() !== lower) continue;
    const s = sentences(row.description).find((x) => WIKI_POPUP.test(x));
    if (s !== undefined)
      return {
        kind: "wiki",
        confidence: "medium",
        line: member.line,
        sentence: s,
        unverified: `wiki page "${row.page}" (uiwidget values table, row ${row.name}) says: "${s}"; the script source does not state it`,
      };
  }
  // 3. The member's own name.
  if (NAME_POPUP.test(member.name))
    return {
      kind: "name",
      confidence: "medium",
      line: member.line,
      unverified: `inferred from the member name ${member.name} (it holds "Picker" or "Dialog"); no doc comment or wiki sentence says that it opens a popup`,
    };
  return undefined;
}

// ── Rows ──────────────────────────────────────────────────────────────────────

/** Where the raw bytes of a script file come from (the pak, or a loose tree in tests). */
export interface ScriptBytes {
  readFile(virtualPath: string): Buffer | undefined;
}

export interface MemberReport {
  member: string;
  value: string | null;
  ref: string;
  has_doc: boolean;
  uses: number;
  popup: null | { evidence: "doc" | "wiki" | "name"; confidence: "high" | "medium"; ref: string };
  /** Why a member with a doc comment that hints at an editor or picker has no popup row. */
  no_popup_note?: string;
}

export interface RowsResult {
  observations: Observation[];
  members: MemberReport[];
  usage: UsageTable;
  /** Wiki widget rows read, and the ones that name no member. */
  wiki: { rows: WikiWidgetRow[]; not_members: string[]; members_without_row: string[] };
  /** Strings dropped from a row because they looked like a machine path. */
  scrubbed: string[];
  inputs: { path: string; sha256: string }[];
}

function firstParagraph(doc: string | undefined): string | undefined {
  if (!doc) return undefined;
  const p = doc
    .split(/\n[ \t]*\n/)[0]
    .replace(/\s+/g, " ")
    .trim();
  // A paragraph that only introduces what follows ("... consists of:") says nothing about the kind.
  if (p === "" || p.endsWith(":")) return undefined;
  return p.length > WHAT_MAX ? p.slice(0, WHAT_MAX).trimEnd() : p;
}

function quoteOf(lines: readonly string[] | undefined, line: number): string | undefined {
  const t = lines?.[line - 1]?.trim();
  return t ? t.slice(0, QUOTE_MAX) : undefined;
}

export interface RowsOptions {
  build: string;
  /** Raw bytes of script files (for quotes and input hashes). */
  scripts: ScriptBytes;
  /** Rows of the wiki's widget table; omit when no wiki export was read. */
  wikiRows?: readonly WikiWidgetRow[];
  /** sha256 of the wiki export's bytes, when it was read. */
  wikiSha256?: string;
}

/** The rows of E16 for one index. Pure: the same index, bytes and wiki give the same rows. */
export function observationRows(index: SourceIndex, opts: RowsOptions): RowsResult {
  const members = widgetMembers(index);
  const usage = usageTable(
    index,
    members.map((m) => m.name),
  );
  const wikiRows = widgetTableRows(
    opts.wikiRows ?? [],
    members.map((m) => m.name),
  );
  const fileLines = new Map<string, string[] | undefined>();
  const linesOf = (file: string): string[] | undefined => {
    if (!fileLines.has(file)) {
      const bytes = opts.scripts.readFile(file);
      fileLines.set(file, bytes ? bytes.toString("utf-8").split(/\r?\n/) : undefined);
    }
    return fileLines.get(file);
  };

  const scrubbed: string[] = [];
  const clean = (id: string, field: string, v: string | undefined): string | undefined => {
    if (v === undefined) return undefined;
    if (containsMachinePath(v)) {
      scrubbed.push(`${id}: ${field}`);
      return undefined;
    }
    return v;
  };

  const out: { id: string; obs: Observation }[] = [];
  const reports: MemberReport[] = [];
  for (const m of members) {
    const lines = linesOf(m.file);
    const uses = usage.by_member[m.name] ?? 0;
    const evidence = popupEvidence(m, lines, wikiRows);
    const peKey = { path: [WIDGETS_CLASS, m.name] };
    const peId = deriveId({ dim: "ui", kind: "property-editor", module: MODULE, key: peKey });
    const what = firstParagraph(m.doc);
    const pe: Observation = {
      dim: "ui",
      kind: "property-editor",
      module: MODULE,
      key: peKey,
      parent_key: null,
      label: m.name,
      signature: clean(peId, "signature", m.signature),
      what: clean(peId, "what", what),
      origin: "vanilla",
      ref: pakRef(m),
      quote: clean(peId, "quote", quoteOf(lines, m.line)),
      confidence: "high",
      children_count: evidence ? 1 : 0,
    };
    out.push({ id: peId, obs: pe });

    const report: MemberReport = {
      member: m.name,
      value: m.value ?? null,
      ref: pakRef(m),
      has_doc: m.doc !== undefined,
      uses,
      popup: null,
    };
    if (evidence) {
      const dKey = { path: [WIDGETS_CLASS, m.name, "popup"] };
      const dId = deriveId({ dim: "ui", kind: "dialog", module: MODULE, key: dKey });
      const ref = pakRef({ file: m.file, line: evidence.line });
      const dialog: Observation = {
        dim: "ui",
        kind: "dialog",
        module: MODULE,
        key: dKey,
        parent_key: { dim: "ui", kind: "property-editor", module: MODULE, key: peKey },
        what: clean(dId, "what", evidence.sentence),
        origin: "vanilla",
        ref,
        quote: clean(dId, "quote", quoteOf(lines, evidence.line)),
        confidence: evidence.confidence,
        unverified: [clean(dId, "unverified", evidence.unverified)].filter(
          (x): x is string => x !== undefined,
        ),
      };
      out.push({ id: dId, obs: dialog });
      report.popup = { evidence: evidence.kind, confidence: evidence.confidence, ref };
    } else if (m.doc && POPUP_HINT.test(m.doc)) {
      const hint = sentences(m.doc).find((s) => POPUP_HINT.test(s));
      report.no_popup_note = `doc comment mentions an editor or picker but no source says it opens a popup: "${hint}"`;
    }
    reports.push(report);
  }

  // Strip undefined fields and validate every row against the ledger schema.
  const observations = out
    .sort((a, b) => compareCodeUnits(a.id, b.id))
    .map(({ obs }) => {
      const o = Object.fromEntries(
        Object.entries(obs).filter(([, v]) => v !== undefined),
      ) as Observation;
      if (o.unverified && o.unverified.length === 0) delete o.unverified;
      return observationSchema.parse(o);
    });

  const memberNames = new Set(members.map((m) => m.name.toLowerCase()));
  const wikiNames = new Set(wikiRows.map((r) => r.name.toLowerCase()));
  const notMembers = [
    ...new Set(wikiRows.filter((r) => !memberNames.has(r.name.toLowerCase())).map((r) => r.name)),
  ].sort(compareCodeUnits);
  const withoutRow = members
    .filter((m) => !wikiNames.has(m.name.toLowerCase()))
    .map((m) => m.name)
    .sort(compareCodeUnits);

  // Inputs: the index's own script digest, the file(s) the members were read from, the wiki.
  const inputs = new Map<string, string>();
  inputs.set("<game>/addons/**/scripts/**/*.c", index.header.inputs_sha256);
  for (const f of new Set(members.map((m) => m.file))) {
    const bytes = opts.scripts.readFile(f);
    if (bytes) inputs.set(`<game>/pak:${f}`, sha256(bytes));
  }
  if (opts.wikiSha256 !== undefined) inputs.set(`<repo>/${WIKI_EXPORT}`, opts.wikiSha256);

  return {
    observations,
    members: reports,
    usage,
    wiki: { rows: [...wikiRows], not_members: notMembers, members_without_row: withoutRow },
    scrubbed,
    inputs: [...inputs.entries()]
      .map(([path, hash]) => ({ path, sha256: hash }))
      .sort((a, b) => compareCodeUnits(a.path, b.path)),
  };
}

/** Exact text of the observation file. */
export function observationFileText(result: RowsResult, build: string): string {
  const header = {
    $header: 1,
    build,
    enumerator: ENUMERATOR_ID,
    generator: GENERATOR,
    inputs: result.inputs,
    provisional: false,
    row_count: result.observations.length,
  };
  return (
    [jsonlLine(header, ["$header"]), ...result.observations.map((o) => jsonlLine(o))].join("\n") +
    "\n"
  );
}

// ── Headline counts and report ────────────────────────────────────────────────

export interface Headline {
  members: number;
  /** Distinct values among the members (Hidden and None share one). */
  distinct_values: number;
  with_doc_comment: number;
  without_doc_comment: string[];
  used: number;
  unused: string[];
  popup_rows: { member: string; evidence: string; confidence: string; ref: string }[];
  top5: { member: string; count: number }[];
  rows: { property_editor: number; dialog: number };
}

export function headline(result: RowsResult): Headline {
  const values = new Set(result.members.map((m) => m.value));
  return {
    members: result.members.length,
    distinct_values: values.size,
    with_doc_comment: result.members.filter((m) => m.has_doc).length,
    without_doc_comment: result.members.filter((m) => !m.has_doc).map((m) => m.member),
    used: result.members.filter((m) => m.uses > 0).length,
    unused: result.members.filter((m) => m.uses === 0).map((m) => m.member),
    popup_rows: result.members
      .filter((m) => m.popup)
      .map((m) => ({
        member: m.member,
        evidence: m.popup!.evidence,
        confidence: m.popup!.confidence,
        ref: m.popup!.ref,
      })),
    top5: topUsed(result.usage, 5),
    rows: {
      property_editor: result.observations.filter((o) => o.kind === "property-editor").length,
      dialog: result.observations.filter((o) => o.kind === "dialog").length,
    },
  };
}

/** Contents of `<artifacts>/census/<build>/E16/report.json`. */
export function reportJson(result: RowsResult, build: string, e15UsageTable: boolean): string {
  const report = {
    build,
    generator: GENERATOR,
    headline: headline(result),
    members: result.members,
    usage: result.usage,
    usage_rule:
      "an annotation counts for a member when a top-level argument is exactly UIWidgets.<Member>, bare or as the value of uiwidget: (a bare argument after a named one counts too; usage.annotations_widget_after_named_argument says how many)",
    e15_usage_table: e15UsageTable ? "present (not read)" : "absent (usage computed here)",
    wiki: {
      widget_rows_read: result.wiki.rows.length,
      names_that_are_not_members: result.wiki.not_members,
      members_without_a_row: result.wiki.members_without_row,
    },
    scrubbed: result.scrubbed,
  };
  return JSON.stringify(report, null, 2) + "\n";
}

// ── Sources for the CLI ───────────────────────────────────────────────────────

/** Raw bytes from a game install's paks; null when there is none. */
export function pakBytes(gamePath: string | undefined): ScriptBytes | null {
  if (!gamePath || !existsSync(join(gamePath, "addons"))) return null;
  const vfs = PakVirtualFS.get(gamePath);
  if (!vfs) return null;
  return {
    readFile: (p) => {
      try {
        return vfs.readFile(p);
      } catch {
        return undefined;
      }
    },
  };
}

/** A loose tree of script files: every `.c` under `root`, by virtual path (tests). */
export function directoryScripts(root: string): { bytes: ScriptBytes; inputs: SourceInput[] } {
  const inputs: SourceInput[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      compareCodeUnits(a.name, b.name),
    )) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(join(dir, e.name), r);
      else if (e.name.endsWith(".c"))
        inputs.push({ path: r, text: readFileSync(join(dir, e.name), "utf-8") });
    }
  };
  walk(root, "");
  return {
    inputs,
    bytes: {
      readFile: (p) => {
        const f = join(root, p);
        return existsSync(f) ? readFileSync(f) : undefined;
      },
    },
  };
}

// ── CLI ───────────────────────────────────────────────────────────────────────

const USAGE =
  "usage: e16-property-editors.ts [--build <tag>] [--game <dir> | --scripts <dir>] [--wiki <file>] [--artifacts <dir>] [--no-artifacts] [--out <file under observations/E16/>] [--data <dir>] [--json]";

/** The repository this script lives in (two levels above scripts/census/enumerators). */
const SCRIPT_REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/**
 * The wiki export to read when --wiki is absent: the census root's repository
 * when it has one, else the repository this script is in. A run on a temporary
 * copy of data/census (--data) puts paths.repo two levels above the copy, where
 * there is no wiki.
 */
export function defaultWikiFile(paths: CensusPaths): string {
  const own = join(paths.repo, WIKI_EXPORT);
  return existsSync(own) ? own : join(SCRIPT_REPO, WIKI_EXPORT);
}

/** Resolves `--out`, refusing anything outside `<census>/observations/E16/`. */
export function resolveOut(paths: CensusPaths, out: string | undefined, build: string): string {
  const dir = join(paths.observations, ENUMERATOR_ID);
  const file = out ? resolve(out) : join(dir, `${build}.jsonl`);
  if (dirname(file) !== dir || !file.endsWith(".jsonl")) {
    throw new Error(
      "refusing --out outside observations/E16/ (E16 writes only its own observation directory)",
    );
  }
  return file;
}

export function run(argv: string[], io: Io = PROCESS_IO): number {
  return guard(io, "e16-property-editors", () => {
    const { values } = parseArgs({
      args: argv,
      options: {
        build: { type: "string" },
        game: { type: "string" },
        scripts: { type: "string" },
        wiki: { type: "string" },
        artifacts: { type: "string" },
        "no-artifacts": { type: "boolean" },
        out: { type: "string" },
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
      io.err(`e16-property-editors: ${e instanceof Error ? e.message : String(e)}`);
      return EXIT_FAIL;
    }
    const def = loadUniverses(paths).enumerators[ENUMERATOR_ID];
    if (
      values.artifacts &&
      !values["no-artifacts"] &&
      insideGitWorkTree(resolve(values.artifacts))
    ) {
      io.err(
        "e16-property-editors: refusing --artifacts inside a git working tree; raw artifacts never enter one (plan 4.2)",
      );
      return EXIT_FAIL;
    }
    const artifactsRoot = values.artifacts ? resolve(values.artifacts) : artifactsDir();

    // Index and bytes.
    let index: SourceIndex | undefined;
    let bytes: ScriptBytes | null;
    let indexNote: string;
    if (values.scripts) {
      const dir = resolve(values.scripts);
      if (!existsSync(dir) || !statSync(dir).isDirectory()) {
        io.out("NO DATA: the --scripts directory does not exist; nothing written");
        return EXIT_USAGE;
      }
      const tree = directoryScripts(dir);
      index = buildSourceIndex(tree.inputs, { build });
      bytes = tree.bytes;
      indexNote = "built from the --scripts tree";
    } else {
      const gamePath = values.game ? resolve(values.game) : loadConfig().gamePath;
      bytes = pakBytes(gamePath);
      index = loadSourceIndex(build, { dir: artifactsRoot });
      indexNote = "loaded from the artifacts folder";
      if (!index && bytes) {
        const vfs = PakVirtualFS.get(gamePath);
        if (vfs) {
          index = buildSourceIndex(vfs, { build });
          indexNote = "built in memory from the paks (no saved index)";
        }
      }
    }
    if (!index) {
      io.out(
        `NO DATA: no source index for build ${build} in the artifacts folder and no game install to build one from (ENFUSION_GAME_PATH or --game); nothing written`,
      );
      return EXIT_USAGE;
    }
    if (!bytes) {
      io.out(
        "NO DATA: no game paks to read the declaration lines from (ENFUSION_GAME_PATH or --game); nothing written",
      );
      return EXIT_USAGE;
    }

    // Wiki (auxiliary: absent means no wiki evidence, not NO DATA).
    const wikiFile = values.wiki ? resolve(values.wiki) : defaultWikiFile(paths);
    let wikiRows: WikiWidgetRow[] | undefined;
    let wikiSha: string | undefined;
    if (existsSync(wikiFile) && statSync(wikiFile).isFile()) {
      const raw = readFileSync(wikiFile);
      wikiSha = sha256(raw);
      wikiRows = wikiWidgetRows(raw.toString("utf-8"));
    }

    const result = observationRows(index, {
      build,
      scripts: bytes,
      wikiRows,
      wikiSha256: wikiSha,
    });
    if (result.members.length === 0) {
      io.out(`NO DATA: class ${WIDGETS_CLASS} is not in the source index; nothing written`);
      return EXIT_USAGE;
    }
    // Emission allow-list of universes.json.
    const kinds = new Set<string>(def.kinds);
    const dims = new Set<string>(def.dims);
    const refRe = new RegExp(def.ref_pattern);
    for (const o of result.observations) {
      const id = deriveId(o);
      if (!kinds.has(o.kind) || !dims.has(o.dim) || !def.id_prefixes.some((p) => id.startsWith(p)))
        throw new Error(`row ${id} is outside the E16 allow-list of universes.json`);
      if (!refRe.test(o.ref)) throw new Error(`row ${id}: ref ${o.ref} does not match ref_pattern`);
      if (allStrings(o).some(containsMachinePath))
        throw new Error(`row ${id}: a string looks like a machine path`);
    }

    mkdirSync(dirname(out), { recursive: true });
    writeFileAtomic(out, observationFileText(result, build));
    const h = headline(result);
    const e15 = join(artifactsRoot, "census", build, "E15", "uiwidgets-usage.json");
    if (!values["no-artifacts"]) {
      const reportFile = join(artifactsRoot, "census", build, ENUMERATOR_ID, "report.json");
      mkdirSync(dirname(reportFile), { recursive: true });
      writeFileAtomic(reportFile, reportJson(result, build, existsSync(e15)));
    }

    if (values.json) {
      io.out(
        JSON.stringify({
          ok: true,
          command: "e16-property-editors",
          build,
          index: indexNote,
          rows: result.observations.length,
          headline: h,
          expected_members: EXPECTED_MEMBERS,
          wiki_rows_read: wikiRows?.length ?? null,
          scrubbed: result.scrubbed,
        }),
      );
      return EXIT_OK;
    }
    io.out(
      `source index ${indexNote}: ${index.files.length} files, ${index.records.length} records`,
    );
    io.out(
      `${WIDGETS_CLASS}: ${h.members} members (${h.distinct_values} distinct values), ${h.with_doc_comment} with a doc comment; ` +
        `${h.used} used by at least one attribute, ${h.unused.length} unused (${h.unused.join(", ")})`,
    );
    io.out(
      `usage: ${result.usage.annotations_naming_a_widget} of ${result.usage.annotations_scanned} annotations name a widget; top five ` +
        h.top5.map((t) => `${t.member} ${t.count}`).join(", "),
    );
    for (const p of h.popup_rows)
      io.out(`popup ${p.member}: ${p.evidence} evidence, ${p.confidence} (${p.ref})`);
    if (h.members !== EXPECTED_MEMBERS)
      io.out(`note: the plan expects ${EXPECTED_MEMBERS} members, the source has ${h.members}`);
    if (wikiRows === undefined)
      io.out(`note: no wiki export at ${WIKI_EXPORT}; wiki evidence skipped`);
    io.out(
      `E16 at build ${build}: ${result.observations.length} observations (property-editor ${h.rows.property_editor}, dialog ${h.rows.dialog})`,
    );
    return EXIT_OK;
  });
}

if (isMainModule(import.meta.url)) process.exitCode = run(process.argv.slice(2));
