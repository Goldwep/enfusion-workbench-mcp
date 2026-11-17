/**
 * E14 — Diag Menu (plan 4.5). Static enumerator, no model.
 *
 * Reads two sources and writes `data/census/observations/E14/<build>.jsonl`:
 *
 *  1. The wiki "Arma Reforger:Diag Menu" page in `data/wiki/export.xml`. The
 *     page is tool-generated: every Diag Menu entry is a heading wrapped in
 *     `<span title="...">` (the three intro headings carry no span and are not
 *     menu entries). The heading nesting is the menu tree; a heading with
 *     child headings is a menu (`diag-menu`), a leaf is an option
 *     (`diag-option`). A leaf carries an `<!-- ID: ... -->` comment, a
 *     description, then `'''Available Options'''` (a value list),
 *     `'''Range Settings'''` (Min / Max / Current Value / Step), an
 *     `Options: min max start step` line, and/or `'''Hotkey'''`.
 *  2. The game scripts, through `PakVirtualFS` (or a directory of loose `.c`
 *     files for tests): the `DiagMenu` and `DbgUI` classes (static method
 *     counts as declared) and every call of `DiagMenu.RegisterMenu`,
 *     `RegisterItem`, `RegisterBool` and `RegisterRange` (comments blanked
 *     first; local `string` constants and one level of wrapper function are
 *     resolved).
 *
 * KEYS. A row's key is `{path: [menu, ..., entry]}` (id `diag:<menu path>`).
 * The path of a wiki row is its heading nesting. A script site joins a wiki
 * row three ways, in this order: by the wiki's `<!-- ID: SCR_DebugMenuID.X -->`
 * comment (the id the script passes as first argument; most reliable), by the
 * vote of its children (a script menu name whose registered options sit under
 * one wiki menu), and by name (parent name resolved through script menus, then
 * wiki menus). One row per key: when both sources know a path the row is the
 * wiki row (ref `wiki:`) and `what` names the script site; a path only script
 * knows gets a `pak:<virtual path>#L<line>` ref. Two wiki entries that derive
 * the same key (same display name under one menu, different IDs) are all
 * disambiguated with ` [<ID>]` on the last segment; a repeat of the same path
 * AND the same ID is one option listed twice and becomes one row.
 *
 * `what` of a wiki row: the description, `Values: ...`, `Range: ...`, `Id <wiki id>.`, then the script sites.
 * `DbgUI` is not a menu registry (immediate-mode windows): it contributes its
 * static method count only. Exit: 0 written; 1 refused (output outside
 * observations/E14/); 2 usage or NO DATA (no wiki page, no script source);
 * 3 malformed census configuration.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { compareCodeUnits, jsonlLine, sha256 } from "../../../src/census/canon.js";
import { loadCurrentBuild } from "../../../src/census/census-config.js";
import { allStrings, containsMachinePath } from "../../../src/census/hygiene.js";
import { deriveId } from "../../../src/census/ids.js";
import { writeFileAtomic, type CensusPaths } from "../../../src/census/ledger-io.js";
import { loadConfig } from "../../../src/config.js";
import { PakVirtualFS } from "../../../src/pak/vfs.js";
import type { Observation } from "../../../src/census/schemas.js";
import type { Confidence } from "../../../src/census/vocab.js";
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

/** Enumerator id (main ruling 11). */
export const ENUMERATOR_ID = "E14";
/** Registered generator path (must equal universes.json `enumerators.E14.generator`). */
export const GENERATOR = "scripts/census/enumerators/e14-diag-menu.ts";
/** Title of the wiki page in the export. */
export const WIKI_PAGE_TITLE = "Arma Reforger:Diag Menu";
const MODULE = "Shared" as const;
const QUOTE_MAX = 200;
const DIAG_MENU_FILE = "scripts/Core/generated/Debug/DiagMenu.c";
const DBGUI_FILE = "scripts/Core/generated/Debug/DbgUI.c";

// ── Text helpers ──────────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  rarr: "→",
  larr: "←",
  ndash: "–",
  mdash: "—",
  hellip: "…",
};

/** Decodes numeric and the common named entities; unknown names stay as written. */
export function decodeEntities(s: string): string {
  return s.replace(
    /&(?:#(\d+)|#x([0-9a-fA-F]+)|([A-Za-z]+));/g,
    (m, dec: string | undefined, hex: string | undefined, name: string | undefined) => {
      if (dec !== undefined) return String.fromCodePoint(Number(dec));
      if (hex !== undefined) return String.fromCodePoint(parseInt(hex, 16));
      return name !== undefined && name in ENTITIES ? ENTITIES[name] : m;
    },
  );
}

function decodeXml(s: string): string {
  return s.replace(
    /&(?:#(\d+)|#x([0-9a-fA-F]+)|(amp|lt|gt|quot|apos));/g,
    (_m, dec: string | undefined, hex: string | undefined, name: string | undefined) => {
      if (dec !== undefined) return String.fromCodePoint(Number(dec));
      if (hex !== undefined) return String.fromCodePoint(parseInt(hex, 16));
      return ENTITIES[name as string];
    },
  );
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function collapse(s: string): string {
  return s.replace(/[\s ]+/g, " ").trim();
}

/** Adds a closing full stop when the text does not end in punctuation. */
function endSentence(s: string): string {
  return /[.!?)]$/.test(s) ? s : `${s}.`;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max);
}

// ── Wiki page ─────────────────────────────────────────────────────────────────

export interface WikiSource {
  title: string;
  /** Wikitext after XML decoding, CR LF folded to LF (what an XML parser hands over). */
  text: string;
  /** UTF-8 byte length of `text`. */
  bytes: number;
  /** The `bytes` attribute of the export's `<text>` element, when present. */
  declaredBytes: number | null;
}

/** Pulls one page's wikitext out of a MediaWiki export. `null` when the page is absent. */
export function extractWikiPage(xml: string, title: string): WikiSource | null {
  const at = xml.indexOf(`<title>${xmlEscape(title)}</title>`);
  if (at < 0) return null;
  const start = xml.lastIndexOf("<page>", at);
  const end = xml.indexOf("</page>", at);
  if (start < 0 || end < 0) return null;
  const page = xml.slice(start, end);
  const m = /<text\b([^>]*?)(?:\/>|>([\s\S]*?)<\/text>)/.exec(page);
  if (!m) return null;
  const declared = /\bbytes="(\d+)"/.exec(m[1]);
  const text = decodeXml(m[2] ?? "").replace(/\r\n?/g, "\n");
  return {
    title,
    text,
    bytes: Buffer.byteLength(text, "utf-8"),
    declaredBytes: declared ? Number(declared[1]) : null,
  };
}

export interface RangeSpec {
  min?: string;
  max?: string;
  current?: string;
  step?: string;
}

export interface WikiNode {
  /** Position in document order among the diag entries. */
  index: number;
  level: number;
  /** Heading text without the hover span, entities decoded. */
  text: string;
  /** 1-based line of the heading in the wikitext. */
  line: number;
  /** MediaWiki anchor of the heading (underscores; `_2`, `_3` for repeats). */
  anchor: string;
  /** Decoded `title` attribute of the hover span (the page's own access path). */
  titleAttr: string;
  parent: number | null;
  children: number[];
  /** Heading nesting from the top-level menu down to this entry. */
  path: string[];
  /** The `<!-- ID: ... -->` token (the engine or script id). */
  id?: string;
  idMalformed?: boolean;
  /** Description text (markup removed): paragraphs, then "Items: ..." for bullet lists. */
  description: string;
  /** First raw description line, for the quote. */
  quoteLine?: string;
  /** `Available Options` entries (present, possibly empty, when the page gives a list). */
  values?: string[];
  /** Cleaned text of an `Available Options` line that is a link or prose, not a value list. */
  valuesNotList?: string;
  /** Names set in bold at the head of every description bullet (absent unless every bullet has one). */
  bulletNames?: string[];
  range?: RangeSpec;
  hotkey?: string;
}

export interface WikiPage {
  title: string;
  nodes: WikiNode[];
  /** Every heading anchor on the page, intro headings included. */
  anchors: string[];
  /** Headings with no hover span (not Diag Menu entries). */
  nonEntryHeadings: string[];
  /** Entries whose hover title disagrees with the heading nesting. */
  titleMismatches: { text: string; title: string; nesting: string }[];
}

const HEADING = /^(={1,6})\s*(.*?)\s*\1\s*$/;
const SPAN_HEADING = /^<span title="([^"]*)">([\s\S]*)<\/span>$/;

/**
 * Templates, innermost first and repeated, so a template wrapped around another
 * (`{{Sticky|{{Feature|...}}|bottom}}`) goes whole. `Controls` becomes its keys
 * joined with "+", `Link` its label; every other template is dropped. Unbalanced
 * leftover braces are removed last.
 */
function stripTemplates(s: string): string {
  let t = s;
  for (let i = 0; i < 40; i++) {
    const before = t;
    t = t.replace(/\{\{\s*Controls\s*\|([^{}]*)\}\}/gi, (_m, a: string) =>
      a
        .split("|")
        .map((x) => x.trim())
        .filter((x) => x.length > 0)
        .join("+"),
    );
    t = t.replace(
      /\{\{\s*Link\s*\|\s*#?([^{}|]*)(?:\|([^{}]*))?\}\}/gi,
      (_m, a: string, b?: string) => (b ?? a).trim(),
    );
    t = t.replace(/\{\{[^{}]*\}\}/g, "");
    if (t === before) break;
  }
  return t.replace(/\{\{|\}\}/g, "");
}

/**
 * Internal links, innermost first: `[[File:...]]` and `[[Image:...]]` (captions
 * may hold links of their own) vanish, `[[a|b]]` becomes b, `[[a]]` becomes a.
 */
function flattenLinks(s: string): string {
  let t = s;
  const re = /\[\[((?:(?!\[\[|\]\])[\s\S])*)\]\]/g;
  for (let i = 0; i < 40; i++) {
    const before = t;
    t = t.replace(re, (_m, inner: string) => {
      if (/^\s*:?(?:File|Image)\s*:/i.test(inner)) return "";
      const bar = inner.indexOf("|");
      return bar >= 0 ? inner.slice(bar + 1) : inner;
    });
    if (t === before) break;
  }
  return t.replace(/\[\[|\]\]/g, "");
}

/** Removes `<gallery>` blocks wherever they open (a closing tag is optional: an open one runs to the end). */
export function stripGalleries(s: string): string {
  return s.replace(/<gallery\b[^>]*>[\s\S]*?(?:<\/gallery\s*>|$)/gi, "");
}

/** Removes wiki markup from a text fragment. */
export function cleanWikitext(s: string): string {
  let t = stripGalleries(s);
  t = t.replace(/<!--[\s\S]*?-->/g, "");
  t = stripTemplates(t);
  t = flattenLinks(t);
  t = t.replace(/'''|''/g, "");
  t = t.replace(/<br\s*\/?>/gi, " ");
  t = t.replace(/<\/?(?:code|tt|b|i|u|nowiki|small|big|span)[^>]*>/gi, "");
  return collapse(decodeEntities(t));
}

interface BodyInfo {
  id?: string;
  idMalformed?: boolean;
  text: string[];
  bullets: string[];
  rawFirst?: string;
  values?: string[];
  valuesNotList?: string;
  /** Bold lead name of each bullet, `null` when a bullet has none. */
  bulletNames: (string | null)[];
  range?: RangeSpec;
  hotkey?: string;
}

/** True when an `Available Options` entry list is a link or a sentence, not values. */
function isNotValueList(raw: string, vals: readonly string[]): boolean {
  if (/\[\[|\{\{|<[A-Za-z/!]|https?:\/\//.test(raw)) return true;
  if (vals.length !== 1) return false;
  return /[.!?]$/.test(vals[0]) || vals[0].split(/\s+/).length >= 5;
}

function parseBody(lines: readonly string[]): BodyInfo {
  const info: BodyInfo = { text: [], bullets: [], bulletNames: [] };
  let inRange = false;
  const hotkeys: string[] = [];
  // Galleries go first, even when one opens on the same line as the description.
  for (const raw of stripGalleries(lines.join("\n")).split("\n")) {
    const t = raw.trim();
    if (!t) continue;
    const idc = /^<!--\s*ID:\s*([\s\S]*?)\s*-->$/.exec(t);
    if (idc) {
      const c = idc[1];
      if (/^\S+$/.test(c)) info.id = c;
      else {
        // The generator once glued the description into the comment:
        // "<!-- ID: DM_X_ENABLEDEnable/disable X. -->". Split at the last
        // upper-case run that is followed by a capitalised word.
        const g = /^([A-Z0-9_.]*[A-Z0-9])([A-Z][a-z][\s\S]*)$/.exec(c);
        info.idMalformed = true;
        if (g) {
          info.id = g[1];
          info.text.push(g[2]);
          info.rawFirst ??= g[2];
        }
      }
      continue;
    }
    if (t.startsWith("<!--")) continue;
    if (/^'''\s*Available Options\s*'''/i.test(t)) {
      inRange = false;
      const after = t.replace(/^'''\s*Available Options\s*'''\s*:?\s*/i, "");
      const vals = after
        .split(",")
        .map((v) => collapse(decodeEntities(v)))
        .filter((v) => v.length > 0);
      if (isNotValueList(after, vals)) {
        info.values = undefined;
        info.valuesNotList = cleanWikitext(after);
      } else {
        info.values = vals;
        info.valuesNotList = undefined;
      }
      continue;
    }
    if (/^'''\s*Range Settings\s*'''/i.test(t)) {
      inRange = true;
      info.range ??= {};
      continue;
    }
    const hk = /^'''\s*Hotkey\s*'''\s*:?\s*(.*)$/i.exec(t);
    if (hk) {
      inRange = false;
      const keys = cleanWikitext(hk[1]);
      if (keys) hotkeys.push(keys);
      continue;
    }
    if (inRange) {
      const rv = /^\*?\s*(Min|Max|Current Value|Step)\s*:\s*(.+)$/i.exec(t);
      if (rv) {
        const k = rv[1].toLowerCase();
        const v = collapse(rv[2]);
        const r = (info.range ??= {});
        if (k === "min") r.min = v;
        else if (k === "max") r.max = v;
        else if (k === "step") r.step = v;
        else r.current = v;
        continue;
      }
      inRange = false;
    }
    const ol = /^Options:\s*(.+)$/.exec(t);
    if (ol) {
      const tok = ol[1].trim().split(/\s+/);
      if (tok.length === 4 && tok.every((x) => /^[-+]?\d*\.?\d+(?:e[-+]?\d+)?$/i.test(x))) {
        info.range = { min: tok[0], max: tok[1], current: tok[2], step: tok[3] };
        continue;
      }
    }
    if (/^\[\[(?:File|Image):/i.test(t)) continue;
    const bl = /^\*+\s*(.*)$/.exec(t);
    if (bl) {
      const c = cleanWikitext(bl[1]);
      if (c) {
        info.bullets.push(c);
        const lead = /^'''\s*([^']+?)\s*'''/.exec(bl[1].trim());
        info.bulletNames.push(lead ? collapse(decodeEntities(lead[1])) : null);
      }
      info.rawFirst ??= t;
      continue;
    }
    const c = cleanWikitext(t);
    if (c) info.text.push(c);
    info.rawFirst ??= t;
  }
  if (hotkeys.length > 0) info.hotkey = hotkeys.join(" / ");
  return info;
}

/** Parses the Diag Menu wikitext into the menu tree. */
export function parseWikiPage(title: string, text: string): WikiPage {
  const lines = text.split("\n");
  interface Head {
    line: number;
    level: number;
    raw: string;
  }
  const heads: Head[] = [];
  let inEnforce = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/<enforce>/i.test(l)) inEnforce = true;
    if (!inEnforce) {
      const h = HEADING.exec(l);
      if (h) heads.push({ line: i + 1, level: h[1].length, raw: h[2] });
    }
    if (/<\/enforce>/i.test(l)) inEnforce = false;
  }

  // Anchors over every heading, MediaWiki style.
  const anchors: string[] = [];
  const seenAnchor = new Map<string, number>();
  const anchorOf: string[] = [];
  const nonEntryHeadings: string[] = [];
  for (const h of heads) {
    const sp = SPAN_HEADING.exec(h.raw);
    const label = collapse(decodeEntities(sp ? sp[2] : h.raw));
    const base = label.replace(/\s/g, "_");
    const n = (seenAnchor.get(base) ?? 0) + 1;
    seenAnchor.set(base, n);
    const anchor = n === 1 ? base : `${base}_${n}`;
    anchors.push(anchor);
    anchorOf.push(anchor);
    if (!sp) nonEntryHeadings.push(label);
  }

  const nodes: WikiNode[] = [];
  const stack: WikiNode[] = [];
  const titleMismatches: WikiPage["titleMismatches"] = [];
  for (let k = 0; k < heads.length; k++) {
    const h = heads[k];
    const sp = SPAN_HEADING.exec(h.raw);
    if (!sp) continue;
    const label = collapse(decodeEntities(sp[2]));
    if (!label) continue;
    while (stack.length > 0 && stack[stack.length - 1].level >= h.level) stack.pop();
    const parent = stack.length > 0 ? stack[stack.length - 1] : null;
    const bodyEnd = k + 1 < heads.length ? heads[k + 1].line - 1 : lines.length;
    const body = parseBody(lines.slice(h.line, bodyEnd));
    const descParts = body.text.map(endSentence);
    if (body.bullets.length > 0) descParts.push(`Items: ${body.bullets.join("; ")}.`);
    const desc = descParts.join(" ");
    const node: WikiNode = {
      index: nodes.length,
      level: h.level,
      text: label,
      line: h.line,
      anchor: anchorOf[k],
      titleAttr: collapse(decodeEntities(sp[1])),
      parent: parent ? parent.index : null,
      children: [],
      path: [...(parent ? parent.path : []), label],
      id: body.id,
      idMalformed: body.idMalformed,
      description: desc,
      quoteLine: body.rawFirst,
      values: body.values,
      valuesNotList: body.valuesNotList,
      bulletNames:
        body.bulletNames.length > 0 && body.bulletNames.every((x) => x !== null)
          ? (body.bulletNames as string[])
          : undefined,
      range: body.range,
      hotkey: body.hotkey,
    };
    if (parent) parent.children.push(node.index);
    nodes.push(node);
    stack.push(node);
    // The hover title names the parent path ("A → B"); a top-level entry names itself.
    const expected = parent ? parent.path.join(" → ") : label;
    if (node.titleAttr !== expected) {
      titleMismatches.push({ text: label, title: node.titleAttr, nesting: expected });
    }
  }
  return { title, nodes, anchors, nonEntryHeadings, titleMismatches };
}

// ── Script source ─────────────────────────────────────────────────────────────

export interface ScriptSource {
  /** Virtual paths of every `.c` file. */
  list(): string[];
  read(path: string): string;
  /** Number of files in the source (any extension), for the report. */
  fileCount?: number;
}

/** A directory of loose script files as a source (tests, extracted trees). */
export function directoryScriptSource(root: string): ScriptSource {
  const out: string[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      compareCodeUnits(a.name, b.name),
    )) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(join(dir, e.name), r);
      else if (e.name.endsWith(".c")) out.push(r);
    }
  };
  walk(root, "");
  return { list: () => out, read: (p) => readFileSync(join(root, p), "utf-8") };
}

/** Blanks `//` and block comments, keeping line structure and string literals. */
export function stripComments(text: string): string {
  let out = "";
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    const d = text[i + 1];
    if (c === '"') {
      let j = i + 1;
      while (j < n && text[j] !== '"' && text[j] !== "\n") {
        if (text[j] === "\\") j++;
        j++;
      }
      out += text.slice(i, Math.min(j + 1, n));
      i = j + 1;
    } else if (c === "/" && d === "/") {
      while (i < n && text[i] !== "\n") {
        out += " ";
        i++;
      }
    } else if (c === "/" && d === "*") {
      out += "  ";
      i += 2;
      while (i < n && !(text[i] === "*" && text[i + 1] === "/")) {
        out += text[i] === "\n" ? "\n" : " ";
        i++;
      }
      if (i < n) {
        out += "  ";
        i += 2;
      }
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/**
 * Blanks `#ifdef DOXYGEN ... #endif` regions (documentation samples the game
 * never compiles), keeping line structure. Returns the blanked text and the
 * removed regions.
 */
export function blankDoxygenBlocks(text: string): { text: string; removed: string[] } {
  const lines = text.split("\n");
  const removed: string[] = [];
  let depth = 0;
  let from = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (from < 0 && /^#\s*ifdef\s+DOXYGEN\b/.test(t)) {
      from = i;
      depth = 1;
      continue;
    }
    if (from >= 0) {
      if (/^#\s*if/.test(t)) depth++;
      else if (/^#\s*endif\b/.test(t)) depth--;
      if (depth === 0) {
        removed.push(lines.slice(from, i + 1).join("\n"));
        for (let k = from; k <= i; k++) lines[k] = "";
        from = -1;
      }
    }
  }
  return { text: lines.join("\n"), removed };
}

/** Same text with the inside of every string literal blanked (same length), for locating code. */
export function maskStrings(text: string): string {
  let out = "";
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (!inStr) {
      if (c === '"') inStr = true;
      out += c;
    } else if (c === "\\") {
      out += i + 1 < text.length ? "  " : " ";
      i++;
    } else if (c === '"' || c === "\n") {
      inStr = false;
      out += c;
    } else out += " ";
  }
  return out;
}

/** Splits call arguments starting after the opening parenthesis; returns the arguments and the index of the closing one. */
function splitArgs(s: string, start: number): { args: string[]; end: number } | null {
  let depth = 0;
  let cur = "";
  let inStr = false;
  const args: string[] = [];
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      cur += ch;
      if (ch === "\\") cur += s[++i] ?? "";
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      cur += ch;
    } else if (ch === "(" || ch === "[" || ch === "{") {
      depth++;
      cur += ch;
    } else if (ch === ")" || ch === "]" || ch === "}") {
      if (depth === 0) {
        if (cur.trim() !== "" || args.length > 0) args.push(cur.trim());
        return { args, end: i };
      }
      depth--;
      cur += ch;
    } else if (ch === "," && depth === 0) {
      args.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  return null;
}

function lineOf(text: string, index: number): number {
  let n = 1;
  for (let i = text.indexOf("\n"); i !== -1 && i < index; i = text.indexOf("\n", i + 1)) n++;
  return n;
}

const STRING_LITERAL = /^"((?:[^"\\]|\\.)*)"$/;

function unquote(s: string): string {
  return s.slice(1, -1).replace(/\\(.)/g, "$1");
}

/** A literal string, `string.Empty`, or a local `string NAME = "..."` declared before `pos`. */
function literalOf(expr: string, stripped: string, pos: number): string | null {
  const e = expr.trim();
  if (STRING_LITERAL.test(e)) return unquote(e);
  if (e === "string.Empty") return "";
  if (/^[A-Za-z_]\w*$/.test(e)) {
    const re = new RegExp(`\\bstring\\s+${e}\\s*=\\s*("(?:[^"\\\\]|\\\\.)*")\\s*;`, "g");
    let last: string | null = null;
    let m: RegExpExecArray | null;
    while ((m = re.exec(stripped)) && m.index < pos) last = unquote(m[1]);
    return last;
  }
  return null;
}

export type RegisterApi = "RegisterMenu" | "RegisterItem" | "RegisterBool" | "RegisterRange";

export interface ScriptSite {
  /** Virtual path of the script file. */
  file: string;
  line: number;
  api: RegisterApi;
  /** First argument as written (the id expression). */
  idExpr: string;
  /** Item or menu name, when it is a literal. */
  name: string | null;
  /** Parent menu name ("" = root), when it is a literal. */
  parent: string | null;
  /** Shortcut literal ("" when empty). RegisterMenu has none. */
  shortcut: string | null;
  /** RegisterItem value list or RegisterRange "min,max,start,step" literal. */
  spec: string | null;
  /** Source line, trimmed (verbatim quote). */
  lineText: string;
  /** Name of the wrapper function when the site was expanded from a call to it. */
  via?: string;
  /** Raw name / parent expressions, for the report when unresolved. */
  nameExpr: string;
  parentExpr: string;
}

interface FuncDef {
  name: string;
  params: string[];
  bodyStart: number;
  bodyEnd: number;
}

const NOT_FUNCTIONS = new Set(["if", "while", "for", "foreach", "switch", "return", "else", "new"]);

function findFunctions(stripped: string): FuncDef[] {
  const out: FuncDef[] = [];
  const re =
    /(?:^|[;{}\n])[ \t]*(?:(?:private|protected|public|static|override|proto|native|event|sealed|const|autoptr)\s+)*[A-Za-z_][\w<>,\[\]]*\s+([A-Za-z_]\w*)\s*\(([^()]*)\)\s*(?:const\s*)?\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped))) {
    if (NOT_FUNCTIONS.has(m[1])) continue;
    const open = m.index + m[0].length - 1;
    let depth = 0;
    let end = -1;
    for (let i = open; i < stripped.length; i++) {
      if (stripped[i] === "{") depth++;
      else if (stripped[i] === "}") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end < 0) continue;
    const params = m[2]
      .split(",")
      .map((p) => p.replace(/=.*$/, "").trim().split(/\s+/).pop() ?? "")
      .filter((p) => p.length > 0);
    out.push({ name: m[1], params, bodyStart: open, bodyEnd: end });
  }
  return out;
}

/**
 * Finds the DiagMenu registration calls of one script file. Calls whose id or
 * name is a parameter of the enclosing function are expanded once per call of
 * that function in the same file (one synthetic site per call).
 */
export function scanScriptRegistrations(file: string, text: string): ScriptSite[] {
  const stripped = blankDoxygenBlocks(stripComments(text)).text;
  const masked = maskStrings(stripped);
  const rawLines = text.split("\n");
  const sites: ScriptSite[] = [];
  const re = /\bDiagMenu\s*\.\s*(RegisterMenu|RegisterItem|RegisterBool|RegisterRange)\s*\(/g;
  let funcs: FuncDef[] | null = null;
  let m: RegExpExecArray | null;
  const pending: { api: RegisterApi; args: string[]; pos: number }[] = [];
  while ((m = re.exec(masked))) {
    const parsed = splitArgs(stripped, m.index + m[0].length);
    if (!parsed) continue;
    pending.push({ api: m[1] as RegisterApi, args: parsed.args, pos: m.index });
  }
  const mk = (
    api: RegisterApi,
    args: string[],
    litPos: number,
    line: number,
    via?: string,
    override?: { id?: string; name?: string; parent?: string; spec?: string },
  ): ScriptSite => {
    const isMenu = api === "RegisterMenu";
    const idExpr = override?.id ?? args[0] ?? "";
    const nameExpr = override?.name ?? (isMenu ? args[1] : args[2]) ?? "";
    const parentExpr = override?.parent ?? (isMenu ? args[2] : args[3]) ?? "";
    const specExpr =
      override?.spec ?? (api === "RegisterItem" || api === "RegisterRange" ? args[4] : undefined);
    const shortcutExpr = isMenu ? undefined : args[1];
    return {
      file,
      line,
      api,
      idExpr,
      name: literalOf(nameExpr, stripped, litPos),
      parent: literalOf(parentExpr, stripped, litPos),
      shortcut: shortcutExpr === undefined ? null : literalOf(shortcutExpr, stripped, litPos),
      spec: specExpr === undefined ? null : literalOf(specExpr, stripped, litPos),
      lineText: truncate((rawLines[line - 1] ?? "").trim(), QUOTE_MAX),
      via,
      nameExpr,
      parentExpr,
    };
  };
  const wrapperUse = new Map<string, { fn: FuncDef; items: typeof pending }>();
  for (const p of pending) {
    const isMenu = p.api === "RegisterMenu";
    const nameExpr = (isMenu ? p.args[1] : p.args[2]) ?? "";
    const idExpr = p.args[0] ?? "";
    const idOk = /^[A-Za-z_]\w*(?:\.\w+)+$/.test(idExpr);
    const nameOk = literalOf(nameExpr, stripped, p.pos) !== null;
    if (idOk && nameOk) {
      sites.push(mk(p.api, p.args, p.pos, lineOf(stripped, p.pos)));
      continue;
    }
    funcs ??= findFunctions(masked);
    const fn = funcs.find((f) => p.pos > f.bodyStart && p.pos < f.bodyEnd);
    if (fn && (fn.params.includes(idExpr) || fn.params.includes(nameExpr))) {
      const slot = wrapperUse.get(fn.name) ?? { fn, items: [] };
      slot.items.push(p);
      wrapperUse.set(fn.name, slot);
      continue;
    }
    sites.push(mk(p.api, p.args, p.pos, lineOf(stripped, p.pos)));
  }
  for (const { fn, items } of wrapperUse.values()) {
    const first = items[0];
    const single = items.length === 1;
    const isMenu = first.api === "RegisterMenu";
    const idParam = fn.params.indexOf(first.args[0] ?? "");
    const nameParam = fn.params.indexOf((isMenu ? first.args[1] : first.args[2]) ?? "");
    const callRe = new RegExp(`\\b${fn.name}\\s*\\(`, "g");
    let c: RegExpExecArray | null;
    while ((c = callRe.exec(masked))) {
      if (c.index > fn.bodyStart && c.index < fn.bodyEnd) continue;
      const before = masked.slice(Math.max(0, c.index - 40), c.index);
      if (/[\w>\]]\s+$/.test(before) && !/\b(?:return|else|do)\s+$/.test(before)) continue;
      const call = splitArgs(stripped, c.index + c[0].length);
      if (!call) continue;
      const sub = (expr: string): string => {
        const i = fn.params.indexOf(expr);
        return i >= 0 && i < call.args.length ? call.args[i] : expr;
      };
      const parentExprW = (isMenu ? first.args[2] : first.args[3]) ?? "";
      const override = {
        id: idParam >= 0 ? call.args[idParam] : first.args[0],
        name: nameParam >= 0 ? call.args[nameParam] : undefined,
        parent: sub(parentExprW),
        spec: single ? first.args[4] : undefined,
      };
      const site = mk(
        first.api,
        first.args,
        c.index,
        lineOf(stripped, c.index),
        fn.name,
        override as { id?: string; name?: string; parent?: string; spec?: string },
      );
      // The wrapper's own literals (parent, shortcut) were resolved at the call position;
      // resolve the wrapper-local ones at the wrapper site instead.
      if (site.parent === null) site.parent = literalOf(parentExprW, stripped, first.pos);
      if (site.shortcut === null && first.args[1] !== undefined)
        site.shortcut = literalOf(first.args[1], stripped, first.pos);
      if (!single) site.spec = null;
      else if (site.spec === null && first.args[4] !== undefined)
        site.spec = literalOf(first.args[4], stripped, first.pos);
      sites.push(site);
    }
  }
  sites.sort((a, b) => a.line - b.line || compareCodeUnits(a.idExpr, b.idExpr));
  return sites;
}

/** Registration calls sitting in `#ifdef DOXYGEN` samples (not compiled, so not sites). */
export function countExcludedRegistrations(text: string): number {
  const { removed } = blankDoxygenBlocks(stripComments(text));
  const re = /\bDiagMenu\s*\.\s*Register(?:Menu|Item|Bool|Range)\s*\(/g;
  return removed.reduce((n, r) => n + (r.match(re)?.length ?? 0), 0);
}

/** Static method declarations of `class <name>` as written in source (comments ignored). */
export function countStaticMethods(text: string, className: string): number {
  const stripped = stripComments(text);
  const m = new RegExp(`\\bclass\\s+${className}\\b[^{;]*\\{`).exec(stripped);
  if (!m) return 0;
  let depth = 1;
  let i = m.index + m[0].length;
  const start = i;
  while (i < stripped.length && depth > 0) {
    if (stripped[i] === "{") depth++;
    else if (stripped[i] === "}") depth--;
    i++;
  }
  const body = stripped.slice(start, i - 1);
  // Split into top-level declarations: chunks ending at ';' or at the close of a '{...}' block.
  let count = 0;
  let d = 0;
  let chunk = "";
  for (const ch of body) {
    if (ch === "{") {
      d++;
      if (d === 1) chunk += ch;
      continue;
    }
    if (ch === "}") {
      d--;
      if (d === 0) {
        if (/\bstatic\b[^(;=]*\(/.test(chunk)) count++;
        chunk = "";
      }
      continue;
    }
    if (d > 0) continue;
    if (ch === ";") {
      if (/\bstatic\b[^(;=]*\(/.test(chunk)) count++;
      chunk = "";
    } else chunk += ch;
  }
  return count;
}

// ── Rows ──────────────────────────────────────────────────────────────────────

type Row = {
  kind: "diag-menu" | "diag-option";
  path: string[];
  label: string;
  parentPath: string[] | null;
  what?: string;
  shortcut?: string;
  ref: string;
  quote?: string;
  confidence: Confidence;
  unverified: string[];
  source: "wiki" | "script" | "both";
  node?: WikiNode;
  sites: ScriptSite[];
  hasValues: boolean;
  hasRange: boolean;
  hasHotkey: boolean;
};

export interface BuildStats {
  wiki: {
    bytes: number;
    declaredBytes: number | null;
    headings: number;
    entries: number;
    topLevelMenus: number;
    menus: number;
    options: number;
    nonEntryHeadings: string[];
    titleMismatches: number;
    sameIdRepeats: number;
    disambiguated: number;
    malformedIds: number;
    rowsEmitted: number;
  };
  script: {
    filesScanned: number;
    sitesDirect: number;
    sitesFromWrappers: number;
    sitesTotal: number;
    excludedDoxygenSites: number;
    byApi: Record<string, number>;
    unresolved: number;
    resolvedSites: number;
    distinctPaths: number;
    joinedByWikiId: number;
    joinedByPath: number;
    scriptOnlyMenus: number;
    scriptOnlyOptions: number;
    implicitParentMenus: number;
    diagMenuStatics: number | null;
    dbgUiStatics: number | null;
  };
  overlap: { both: number; wikiOnly: number; scriptOnly: number };
  totals: {
    rows: number;
    topLevelMenus: number;
    menus: number;
    options: number;
    optionsWithValueList: number;
    optionsWithRange: number;
    optionsWithHotkey: number;
  };
}

export interface BuildResult {
  observations: Observation[];
  stats: BuildStats;
  unresolvedSites: { site: ScriptSite; reason: string }[];
}

function idOfPath(path: readonly string[]): string {
  return deriveId({ dim: "diag", kind: "diag-option", module: MODULE, key: { path: [...path] } });
}

function rangeText(r: RangeSpec): string {
  const parts: string[] = [];
  if (r.min !== undefined) parts.push(`min ${r.min}`);
  if (r.max !== undefined) parts.push(`max ${r.max}`);
  if (r.current !== undefined) parts.push(`current ${r.current}`);
  if (r.step !== undefined) parts.push(`step ${r.step}`);
  return `Range: ${parts.join(", ")}.`;
}

function specToRange(spec: string): RangeSpec | null {
  const tok = spec
    .split(/[\s,]+/)
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
  if (tok.length !== 4 || !tok.every((x) => /^[-+]?\d*\.?\d+(?:e[-+]?\d+)?$/i.test(x))) return null;
  return { min: tok[0], max: tok[1], current: tok[2], step: tok[3] };
}

function wikiRef(title: string, anchor: string): string {
  return `wiki:${title.replace(/\s/g, "_")}#${anchor}`;
}

function pakRef(file: string, line: number): string {
  return `pak:${file}#L${line}`;
}

function sitePhrase(s: ScriptSite): string {
  return `${pakRef(s.file, s.line)}${s.via ? ` (through ${s.via})` : ""}`;
}

/** Builds the diag rows from the parsed wiki page and the script registration sites. */
export function buildDiagRows(
  wiki: WikiPage,
  wikiInfo: { bytes: number; declaredBytes: number | null },
  sites: readonly ScriptSite[],
  scriptInfo: {
    filesScanned: number;
    sitesDirect: number;
    excludedDoxygenSites: number;
    diagMenuStatics: number | null;
    dbgUiStatics: number | null;
  },
): BuildResult {
  const nodes = wiki.nodes;
  const rows = new Map<string, Row>();

  // ── Wiki keys: heading nesting; collisions resolved by ID, then ordinal ──────
  const suffix = new Map<number, string>();
  const dropped = new Set<number>(); // same path, same ID: one option listed twice
  const repeats = new Map<number, number[]>();
  let keys: string[][] = [];
  const computeKeys = (): void => {
    keys = new Array<string[]>(nodes.length);
    for (const n of nodes) {
      const parent = n.parent === null ? [] : keys[n.parent];
      keys[n.index] = [...parent, n.text + (suffix.get(n.index) ?? "")];
    }
  };
  for (let round = 0; round < 6; round++) {
    computeKeys();
    const groups = new Map<string, WikiNode[]>();
    for (const n of nodes) {
      if (dropped.has(n.index)) continue;
      const id = idOfPath(keys[n.index]);
      const g = groups.get(id);
      if (g) g.push(n);
      else groups.set(id, [n]);
    }
    let changed = false;
    for (const g of groups.values()) {
      if (g.length < 2) continue;
      // Same wiki ID on options: the page lists one option twice.
      const byId = new Map<string, WikiNode>();
      const rest: WikiNode[] = [];
      for (const n of g) {
        const isOption = n.children.length === 0;
        if (isOption && n.id !== undefined && byId.has(n.id)) {
          const first = byId.get(n.id) as WikiNode;
          dropped.add(n.index);
          repeats.set(first.index, [...(repeats.get(first.index) ?? []), n.index]);
          changed = true;
        } else {
          if (isOption && n.id !== undefined) byId.set(n.id, n);
          rest.push(n);
        }
      }
      if (rest.length < 2) continue;
      rest.forEach((n, i) => {
        const tag = n.id !== undefined && n.children.length === 0 ? n.id : String(i + 1);
        suffix.set(n.index, ` [${tag}]`);
      });
      changed = true;
    }
    if (!changed) break;
  }
  computeKeys();

  const sectionOf = (n: WikiNode): string => n.anchor;
  // Entries that share one plain path (parent key plus display name): the siblings a suffix was told apart from.
  const plainKey = (n: WikiNode): string =>
    `${n.parent === null ? "" : keys[n.parent].join(" ")}${n.text}`;
  const plainGroups = new Map<string, WikiNode[]>();
  for (const n of nodes) {
    if (dropped.has(n.index) || !suffix.has(n.index)) continue;
    const g = plainGroups.get(plainKey(n)) ?? [];
    g.push(n);
    plainGroups.set(plainKey(n), g);
  }
  for (const n of nodes) {
    if (dropped.has(n.index)) continue;
    const isMenu = n.children.length > 0;
    const path = keys[n.index];
    const unv: string[] = [];
    if (n.idMalformed)
      unv.push(
        "the ID comment on the page is malformed (description glued to the id); the id and description were split by pattern",
      );
    for (const r of repeats.get(n.index) ?? []) {
      const d = nodes[r];
      const second = [
        d.description ? truncate(d.description, 120) : "",
        d.values && d.values.length > 0 ? `Values: ${d.values.join(", ")}.` : "",
      ]
        .filter((x) => x.length > 0)
        .join(" ");
      unv.push(
        `the page lists this path and ID twice (section ${d.anchor} repeats section ${n.anchor}); second listing: ${second || "no description"}`,
      );
    }
    if (suffix.has(n.index)) {
      const plain = [...(n.parent === null ? [] : keys[n.parent]), n.text].join(" > ");
      const sibs = (plainGroups.get(plainKey(n)) ?? []).filter((x) => x !== n);
      const named = sibs
        .map((x) => `"${keys[x.index][keys[x.index].length - 1]}" (section ${x.anchor})`)
        .join(", ");
      unv.push(
        `the plain path "${plain}" is shared by ${sibs.length + 1} entries on the page; this row was disambiguated from ${named} by appending the entry's id to the last key segment`,
      );
    }
    let values = n.values;
    if (n.valuesNotList !== undefined) {
      const said = truncate(n.valuesNotList, 120);
      if (n.bulletNames !== undefined && n.bulletNames.length > 0) {
        values = n.bulletNames;
        unv.push(
          `the page's Available Options line is a link or prose ("${said}"), not a value list; Values are the names in bold at the head of the description's bullets, which the page gives as examples, so the set may be incomplete`,
        );
      } else {
        unv.push(
          `the page's Available Options line is a link or prose ("${said}"), not a value list; no Values emitted`,
        );
      }
    }
    const whatParts: string[] = [];
    if (n.description) whatParts.push(n.description);
    const hasValues = values !== undefined && values.length > 0;
    if (hasValues) whatParts.push(`Values: ${(values as string[]).join(", ")}.`);
    if (n.range) whatParts.push(rangeText(n.range));
    if (n.id !== undefined) whatParts.push(`Id ${n.id}.`);
    const hasRange = n.range !== undefined && Object.keys(n.range).length > 0;
    rows.set(idOfPath(path), {
      kind: isMenu ? "diag-menu" : "diag-option",
      path,
      label: n.text,
      parentPath: n.parent === null ? null : keys[n.parent],
      what: whatParts.length > 0 ? whatParts.join(" ") : undefined,
      shortcut: n.hotkey,
      ref: wikiRef(wiki.title, sectionOf(n)),
      quote: truncate(n.quoteLine ?? n.text, QUOTE_MAX),
      confidence: "high",
      unverified: unv,
      source: "wiki",
      node: n,
      sites: [],
      hasValues,
      hasRange,
      hasHotkey: n.hotkey !== undefined,
    });
  }
  const wikiRowCount = rows.size;

  // ── Script: join to wiki rows ────────────────────────────────────────────────
  const nodeByWikiId = new Map<string, WikiNode[]>();
  for (const n of nodes) {
    if (dropped.has(n.index) || n.id === undefined || n.children.length > 0) continue;
    const g = nodeByWikiId.get(n.id);
    if (g) g.push(n);
    else nodeByWikiId.set(n.id, [n]);
  }
  const wikiMenusByName = new Map<string, WikiNode[]>();
  for (const n of nodes) {
    if (dropped.has(n.index) || n.children.length === 0) continue;
    const g = wikiMenusByName.get(n.text);
    if (g) g.push(n);
    else wikiMenusByName.set(n.text, [n]);
  }

  const unresolved: { site: ScriptSite; reason: string }[] = [];
  const usable: ScriptSite[] = [];
  for (const s of sites) {
    if (s.name === null || collapse(s.name) === "")
      unresolved.push({ site: s, reason: `name is not a literal (${s.nameExpr})` });
    else if (s.parent === null)
      unresolved.push({ site: s, reason: `parent is not a literal (${s.parentExpr})` });
    else usable.push(s);
  }

  const joinNode = (s: ScriptSite): WikiNode | null => {
    const cands = nodeByWikiId.get(s.idExpr);
    if (!cands || s.api === "RegisterMenu") return null;
    return cands.find((c) => c.text === s.name) ?? cands[0];
  };

  // Votes: for a parent-menu name used by sites that joined a wiki option by id,
  // the key path of the wiki menu those options sit in.
  const votes = new Map<string, Map<string, { path: string[]; n: number }>>();
  for (const s of usable) {
    if (s.api === "RegisterMenu") continue;
    const w = joinNode(s);
    if (!w || w.parent === null) continue;
    const pp = keys[w.parent];
    const byPath = votes.get(s.parent as string) ?? new Map();
    const k = pp.join("\u0000");
    const cur = byPath.get(k) ?? { path: pp, n: 0 };
    cur.n++;
    byPath.set(k, cur);
    votes.set(s.parent as string, byPath);
  }
  const scriptMenus = new Map<string, ScriptSite[]>();
  for (const s of usable) {
    if (s.api !== "RegisterMenu") continue;
    const g = scriptMenus.get(s.name as string) ?? [];
    g.push(s);
    scriptMenus.set(s.name as string, g);
  }

  type How = "vote" | "script" | "wiki" | "root" | "fallback";
  const memo = new Map<string, { path: string[]; how: How }>();
  const pathOfName = (name: string, seen: Set<string>): { path: string[]; how: How } => {
    if (name === "") return { path: [], how: "root" };
    const hit = memo.get(name);
    if (hit) return hit;
    let out: { path: string[]; how: How } | null = null;
    const v = votes.get(name);
    if (v && v.size === 1) out = { path: [...v.values()][0].path, how: "vote" };
    if (!out && !seen.has(name)) {
      seen.add(name);
      const sm = scriptMenus.get(name);
      if (sm) {
        const cands = new Map<string, string[]>();
        for (const m of sm) {
          const p = pathOfName(m.parent as string, seen).path;
          cands.set([...p, name].join("\u0000"), [...p, name]);
        }
        if (v && v.size > 1) {
          for (const k of [...cands.keys()])
            if (!v.has(k.split("\u0000").slice(0, -1).join("\u0000"))) cands.delete(k);
        }
        if (cands.size === 1) out = { path: [...cands.values()][0], how: "script" };
      }
      seen.delete(name);
    }
    if (!out) {
      const wm = wikiMenusByName.get(name);
      if (wm) {
        const distinct = new Map(wm.map((n) => [keys[n.index].join("\u0000"), keys[n.index]]));
        if (distinct.size === 1) out = { path: [...distinct.values()][0], how: "wiki" };
        else {
          const top = [...distinct.values()].filter((p) => p.length === 1);
          if (top.length === 1) out = { path: top[0], how: "wiki" };
        }
      }
    }
    out ??= { path: [name], how: "fallback" };
    memo.set(name, out);
    return out;
  };

  const attach = (row: Row, s: ScriptSite): void => {
    row.sites.push(s);
    if (row.source === "wiki") row.source = "both";
  };
  let joinedById = 0;
  let joinedByPath = 0;
  let scriptOnlyMenus = 0;
  let scriptOnlyOptions = 0;
  let implicitParents = 0;
  const scriptPaths = new Set<string>();
  const addScriptOnly = (
    s: ScriptSite,
    path: string[],
    kind: Row["kind"],
    confidence: Confidence,
    unverified: string[],
  ): Row => {
    const id = idOfPath(path);
    const existing = rows.get(id);
    if (existing) {
      attach(existing, s);
      return existing;
    }
    const spec = s.spec ?? "";
    const parts: string[] = [];
    if (s.api === "RegisterMenu") parts.push("Registers a new menu (DiagMenu.RegisterMenu).");
    else if (s.api === "RegisterBool")
      parts.push("Registers a boolean setting (DiagMenu.RegisterBool).");
    else if (s.api === "RegisterItem")
      parts.push("Registers a new item in a menu (DiagMenu.RegisterItem).");
    else parts.push("Registers a range-setting menu item (DiagMenu.RegisterRange).");
    parts.push(`Id ${s.idExpr}.`);
    let hasValues = false;
    let hasRange = false;
    if (s.api === "RegisterItem" && spec.trim() !== "") {
      const vals = spec
        .split(",")
        .map((v) => v.trim())
        .filter((v) => v.length > 0);
      if (vals.length > 0) {
        parts.push(`Values: ${vals.join(", ")}.`);
        hasValues = true;
      }
    }
    if (s.api === "RegisterRange") {
      const r = specToRange(spec);
      if (r) {
        parts.push(rangeText(r));
        hasRange = true;
      }
    }
    const row: Row = {
      kind,
      path,
      label: s.name as string,
      parentPath: path.length > 1 ? path.slice(0, -1) : null,
      what: parts.join(" "),
      shortcut: s.shortcut ? s.shortcut : undefined,
      ref: pakRef(s.file, s.line),
      quote: s.lineText || undefined,
      confidence,
      unverified,
      source: "script",
      sites: [s],
      hasValues,
      hasRange,
      hasHotkey: !!s.shortcut,
    };
    rows.set(id, row);
    if (kind === "diag-menu") scriptOnlyMenus++;
    else scriptOnlyOptions++;
    return row;
  };

  // Menus first (their paths feed option parents), then options.
  const order = [...usable].sort(
    (a, b) =>
      (a.api === "RegisterMenu" ? 0 : 1) - (b.api === "RegisterMenu" ? 0 : 1) ||
      compareCodeUnits(a.file, b.file) ||
      a.line - b.line,
  );
  const siteKeys = new Map<ScriptSite, string>();
  for (const s of order) {
    if (s.api === "RegisterMenu") {
      const r = pathOfName(s.name as string, new Set());
      let how = r.how;
      let path = r.path;
      if (how === "fallback") {
        const pp = pathOfName(s.parent as string, new Set());
        path = [...pp.path, s.name as string];
        how = pp.how;
      }
      const id = idOfPath(path);
      const existing = rows.get(id);
      if (existing && existing.kind === "diag-menu") {
        attach(existing, s);
        joinedByPath++;
        siteKeys.set(s, id);
        scriptPaths.add(id);
        continue;
      }
      const row = addScriptOnly(
        s,
        path,
        "diag-menu",
        how === "wiki" || how === "fallback" ? "medium" : "high",
        how === "fallback"
          ? [
              `parent menu "${s.parent}" is not on the wiki page or registered by script; treated as a top-level menu`,
            ]
          : [],
      );
      siteKeys.set(s, idOfPath(row.path));
      scriptPaths.add(idOfPath(row.path));
      continue;
    }
    const w = joinNode(s);
    if (w) {
      const id = idOfPath(keys[w.index]);
      const row = rows.get(id) as Row;
      attach(row, s);
      joinedById++;
      siteKeys.set(s, id);
      scriptPaths.add(id);
      continue;
    }
    const pp = pathOfName(s.parent as string, new Set());
    const path = [...pp.path, s.name as string];
    const id = idOfPath(path);
    const existing = rows.get(id);
    if (existing && existing.kind === "diag-option") {
      attach(existing, s);
      joinedByPath++;
      siteKeys.set(s, id);
      scriptPaths.add(id);
      continue;
    }
    const conf: Confidence = pp.how === "wiki" || pp.how === "fallback" ? "medium" : "high";
    const unv =
      pp.how === "fallback"
        ? [
            `parent menu "${s.parent}" is not on the wiki page or registered by script; treated as a top-level menu`,
          ]
        : [];
    if (existing)
      unv.push(`a menu with the same path exists (${existing.ref}); the option is keyed by id`);
    const finalPath = existing
      ? [...path.slice(0, -1), `${path[path.length - 1]} [${s.idExpr}]`]
      : path;
    const row = addScriptOnly(s, finalPath, "diag-option", conf, unv);
    siteKeys.set(s, idOfPath(row.path));
    scriptPaths.add(idOfPath(row.path));
  }

  // Every row's parent menu needs a row: create the missing ones from script evidence.
  const firstSiteFor = (row: Row): ScriptSite => row.sites[0];
  for (const row of [...rows.values()]) {
    if (row.source === "wiki") continue;
    let p = row.parentPath;
    while (p !== null && p.length > 0) {
      const id = idOfPath(p);
      if (rows.has(id)) break;
      const s = firstSiteFor(row);
      const menu: Row = {
        kind: "diag-menu",
        path: p,
        label: p[p.length - 1],
        parentPath: p.length > 1 ? p.slice(0, -1) : null,
        what: `Parent menu named by a DiagMenu registration at ${sitePhrase(s)}; the menu itself is not registered by script and not on the wiki page.`,
        ref: pakRef(s.file, s.line),
        quote: s.lineText || undefined,
        confidence: "medium",
        unverified: ["menu inferred from the parent name of a script registration"],
        source: "script",
        sites: [s],
        hasValues: false,
        hasRange: false,
        hasHotkey: false,
      };
      rows.set(id, menu);
      implicitParents++;
      scriptPaths.add(id);
      p = menu.parentPath;
    }
  }

  // ── Compose observations ────────────────────────────────────────────────────
  const childCount = new Map<string, number>();
  for (const row of rows.values()) {
    if (row.parentPath === null) continue;
    const pid = idOfPath(row.parentPath);
    childCount.set(pid, (childCount.get(pid) ?? 0) + 1);
  }
  const out: { id: string; obs: Observation }[] = [];
  for (const [id, row] of rows) {
    const whatParts: string[] = [];
    if (row.what) whatParts.push(row.what);
    if (row.source === "both") {
      const listed = row.sites.slice(0, 4).map(sitePhrase);
      const more = row.sites.length > 4 ? ` and ${row.sites.length - 4} more` : "";
      whatParts.push(`Registered in script at ${listed.join(", ")}${more}.`);
      const names = new Set(row.sites.map((s) => s.name).filter((x): x is string => x !== null));
      if (row.node && [...names].some((x) => x !== row.node?.text))
        whatParts.push(`Script name: ${[...names].map((x) => `"${x}"`).join(", ")}.`);
      const sc = row.sites.map((s) => s.shortcut).find((x) => x);
      if (sc && !row.shortcut) row.shortcut = sc;
      else if (
        sc &&
        row.shortcut &&
        sc.toLowerCase() !== row.shortcut.toLowerCase().replace(/\s/g, "")
      )
        whatParts.push(`Script shortcut: ${sc}.`);
    } else if (row.source === "script" && row.sites.length > 1) {
      const rest = row.sites.slice(1, 4).map(sitePhrase);
      whatParts.push(`Also registered at ${rest.join(", ")}.`);
    }
    const parentKey: Observation["parent_key"] =
      row.parentPath === null
        ? null
        : {
            dim: "diag",
            kind: "diag-menu",
            module: MODULE,
            key: { path: row.parentPath },
          };
    const obs: Observation = {
      dim: "diag",
      kind: row.kind,
      module: MODULE,
      key: { path: row.path },
      parent_key: parentKey,
      label: row.label,
      what: whatParts.length > 0 ? whatParts.join(" ") : undefined,
      shortcut_default: row.shortcut,
      origin: "vanilla",
      ref: row.ref,
      quote: row.quote,
      confidence: row.confidence,
      children_count: row.kind === "diag-menu" ? (childCount.get(id) ?? 0) : undefined,
      unverified: row.unverified.length > 0 ? row.unverified : undefined,
    };
    out.push({ id, obs });
  }
  out.sort((a, b) => compareCodeUnits(a.id, b.id));

  // ── Statistics ──────────────────────────────────────────────────────────────
  const all = [...rows.values()];
  const options = all.filter((r) => r.kind === "diag-option");
  const menus = all.filter((r) => r.kind === "diag-menu");
  const wikiRows = all.filter((r) => r.source !== "script");
  const both = all.filter((r) => r.source === "both").length;
  const byApi: Record<string, number> = {};
  for (const s of sites) byApi[s.api] = (byApi[s.api] ?? 0) + 1;
  const wikiMenus = nodes.filter((n) => !dropped.has(n.index) && n.children.length > 0).length;
  const stats: BuildStats = {
    wiki: {
      bytes: wikiInfo.bytes,
      declaredBytes: wikiInfo.declaredBytes,
      headings: wiki.anchors.length,
      entries: nodes.length,
      topLevelMenus: nodes.filter((n) => n.parent === null).length,
      menus: wikiMenus,
      options: nodes.length - dropped.size - wikiMenus,
      nonEntryHeadings: wiki.nonEntryHeadings,
      titleMismatches: wiki.titleMismatches.length,
      sameIdRepeats: dropped.size,
      disambiguated: suffix.size,
      malformedIds: nodes.filter((n) => n.idMalformed).length,
      rowsEmitted: wikiRowCount,
    },
    script: {
      filesScanned: scriptInfo.filesScanned,
      sitesDirect: scriptInfo.sitesDirect,
      sitesFromWrappers: sites.length - scriptInfo.sitesDirect,
      sitesTotal: sites.length,
      excludedDoxygenSites: scriptInfo.excludedDoxygenSites,
      byApi,
      unresolved: unresolved.length,
      resolvedSites: usable.length,
      distinctPaths: scriptPaths.size - implicitParents,
      joinedByWikiId: joinedById,
      joinedByPath,
      scriptOnlyMenus,
      scriptOnlyOptions,
      implicitParentMenus: implicitParents,
      diagMenuStatics: scriptInfo.diagMenuStatics,
      dbgUiStatics: scriptInfo.dbgUiStatics,
    },
    overlap: {
      both,
      wikiOnly: wikiRows.length - both,
      scriptOnly: all.length - wikiRows.length,
    },
    totals: {
      rows: all.length,
      topLevelMenus: menus.filter((r) => r.parentPath === null).length,
      menus: menus.length,
      options: options.length,
      optionsWithValueList: options.filter((r) => r.hasValues).length,
      optionsWithRange: options.filter((r) => r.hasRange).length,
      optionsWithHotkey: options.filter((r) => r.hasHotkey).length,
    },
  };
  return { observations: out.map((x) => x.obs), stats, unresolvedSites: unresolved };
}

// ── Whole run ─────────────────────────────────────────────────────────────────

export interface E14Result extends BuildResult {
  inputs: { path: string; sha256: string }[];
}

/** Reads both sources and builds the rows. `wikiXml` is the export text. */
export function enumerateDiag(
  wikiXml: string,
  wikiInputPath: string,
  source: ScriptSource,
  title: string = WIKI_PAGE_TITLE,
): E14Result | null {
  const page = extractWikiPage(wikiXml, title);
  if (!page) return null;
  const wiki = parseWikiPage(title, page.text);
  const sites: ScriptSite[] = [];
  const inputs: { path: string; sha256: string }[] = [
    { path: wikiInputPath, sha256: sha256(wikiXml) },
  ];
  const files = source.list();
  let diagMenuStatics: number | null = null;
  let dbgUiStatics: number | null = null;
  let direct = 0;
  let excluded = 0;
  for (const f of files) {
    const norm = f.replace(/\\/g, "/");
    const isDiagDecl = norm.toLowerCase() === DIAG_MENU_FILE.toLowerCase();
    const isDbgDecl = norm.toLowerCase() === DBGUI_FILE.toLowerCase();
    const cheap = /DiagMenu|DbgUI/;
    const text = source.read(f);
    if (!cheap.test(text)) continue;
    if (isDiagDecl || /\bclass\s+DiagMenu\b/.test(stripComments(text))) {
      diagMenuStatics = (diagMenuStatics ?? 0) + countStaticMethods(text, "DiagMenu");
      inputs.push({ path: `<game>/pak:${norm}`, sha256: sha256(text) });
    }
    if (isDbgDecl || /\bclass\s+DbgUI\b/.test(stripComments(text))) {
      dbgUiStatics = (dbgUiStatics ?? 0) + countStaticMethods(text, "DbgUI");
      inputs.push({ path: `<game>/pak:${norm}`, sha256: sha256(text) });
    }
    if (!/DiagMenu\s*\.\s*Register/.test(text)) continue;
    excluded += countExcludedRegistrations(text);
    const found = scanScriptRegistrations(norm, text);
    if (found.length === 0) continue;
    direct += found.filter((s) => !s.via).length;
    sites.push(...found);
    if (!inputs.some((i) => i.path === `<game>/pak:${norm}`))
      inputs.push({ path: `<game>/pak:${norm}`, sha256: sha256(text) });
  }
  inputs.sort((a, b) => compareCodeUnits(a.path, b.path));
  sites.sort(
    (a, b) =>
      compareCodeUnits(a.file, b.file) || a.line - b.line || compareCodeUnits(a.idExpr, b.idExpr),
  );
  const built = buildDiagRows(
    wiki,
    { bytes: page.bytes, declaredBytes: page.declaredBytes },
    sites,
    {
      filesScanned: files.length,
      sitesDirect: direct,
      excludedDoxygenSites: excluded,
      diagMenuStatics,
      dbgUiStatics,
    },
  );
  return { ...built, inputs };
}

/** Exact text of the E14 observation file. */
export function observationFileText(result: E14Result, build: string): string {
  const header = {
    $header: 1,
    build,
    enumerator: ENUMERATOR_ID,
    generator: GENERATOR,
    inputs: result.inputs,
    provisional: false,
    row_count: result.observations.length,
  };
  const lines = [jsonlLine(header, ["$header"]), ...result.observations.map((o) => jsonlLine(o))];
  return lines.join("\n") + "\n";
}

/** Strings of the rows that would trip the ledger's machine-path check (should be none). */
export function machinePathProblems(result: BuildResult): string[] {
  return result.observations
    .flatMap((o) => allStrings(o))
    .filter((s) => containsMachinePath(s))
    .slice(0, 5);
}

// ── CLI ───────────────────────────────────────────────────────────────────────

const USAGE =
  "usage: e14-diag-menu.ts [--wiki <export.xml>] [--page <title>] [--game <install dir> | --scripts <dir of .c files>] [--build <tag>] [--out <file under observations/E14/>] [--data <dir>] [--json]";

/** Resolves `--out`, refusing anything outside `<census>/observations/E14/`. */
export function resolveOut(paths: CensusPaths, out: string | undefined, build: string): string {
  const dir = join(paths.observations, ENUMERATOR_ID);
  const file = out ? resolve(out) : join(dir, `${build}.jsonl`);
  if (dirname(file) !== dir || !file.endsWith(".jsonl")) {
    throw new Error(
      "refusing --out outside observations/E14/ (E14 writes only its own observation directory)",
    );
  }
  return file;
}

function openPakSource(gamePath: string): ScriptSource | null {
  if (!existsSync(join(gamePath, "addons"))) return null;
  const vfs = PakVirtualFS.get(gamePath);
  if (!vfs) return null;
  const files = vfs.allFilePaths().filter((p) => p.endsWith(".c"));
  return { list: () => files, read: (p) => vfs.readTextFile(p), fileCount: vfs.fileCount };
}

export function run(argv: string[], io: Io = PROCESS_IO): number {
  return guard(io, "e14-diag-menu", () => {
    const { values } = parseArgs({
      args: argv,
      options: {
        wiki: { type: "string" },
        page: { type: "string" },
        game: { type: "string" },
        scripts: { type: "string" },
        build: { type: "string" },
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
      io.err(`e14-diag-menu: ${e instanceof Error ? e.message : String(e)}`);
      return EXIT_FAIL;
    }
    const wikiFile = values.wiki
      ? resolve(values.wiki)
      : join(paths.repo, "data", "wiki", "export.xml");
    if (!existsSync(wikiFile) || !statSync(wikiFile).isFile()) {
      io.out("NO DATA: no wiki export (data/wiki/export.xml); nothing enumerated");
      return EXIT_USAGE;
    }
    let source: ScriptSource | null;
    if (values.scripts) {
      const dir = resolve(values.scripts);
      source = existsSync(dir) ? directoryScriptSource(dir) : null;
    } else {
      source = openPakSource(values.game ?? loadConfig().gamePath);
    }
    if (!source) {
      io.out(
        "NO DATA: no game paks (set ENFUSION_GAME_PATH or pass --game / --scripts); nothing enumerated",
      );
      return EXIT_USAGE;
    }
    const title = values.page ?? WIKI_PAGE_TITLE;
    const result = enumerateDiag(
      readFileSync(wikiFile, "utf-8"),
      "<repo>/data/wiki/export.xml",
      source,
      title,
    );
    if (!result) {
      io.out(`NO DATA: wiki page "${title}" is not in the export; nothing enumerated`);
      return EXIT_USAGE;
    }
    const bad = machinePathProblems(result);
    if (bad.length > 0) {
      io.err(`e14-diag-menu: a row string looks like a machine path: ${bad[0]}`);
      return EXIT_FAIL;
    }
    mkdirSync(dirname(out), { recursive: true });
    writeFileAtomic(out, observationFileText(result, build));
    const s = result.stats;
    if (values.json) {
      io.out(
        JSON.stringify({
          ok: true,
          command: "e14-diag-menu",
          build,
          emitted: result.observations.length,
          stats: s,
          unresolved: result.unresolvedSites.map((u) => ({
            ref: pakRef(u.site.file, u.site.line),
            reason: u.reason,
          })),
        }),
      );
      return EXIT_OK;
    }
    io.out(
      `wiki page ${title}: ${s.wiki.bytes} bytes, ${s.wiki.entries} entries (${s.wiki.menus} menus, ${s.wiki.options} options)`,
    );
    io.out(
      `script: ${s.script.sitesTotal} registration sites (${s.script.sitesDirect} direct, ${s.script.sitesFromWrappers} through wrappers), ` +
        `${s.script.unresolved} unresolved, ${s.script.distinctPaths} distinct paths; ` +
        `DiagMenu statics ${s.script.diagMenuStatics}, DbgUI statics ${s.script.dbgUiStatics}`,
    );
    io.out(
      `overlap: ${s.overlap.both} paths in both, ${s.overlap.wikiOnly} wiki only, ${s.overlap.scriptOnly} script only`,
    );
    io.out(
      `E14 at build ${build}: ${result.observations.length} observations (${s.totals.topLevelMenus} top-level menus, ${s.totals.menus} menus, ${s.totals.options} options; ` +
        `${s.totals.optionsWithValueList} with a value list, ${s.totals.optionsWithRange} with a range, ${s.totals.optionsWithHotkey} with a hotkey)`,
    );
    return EXIT_OK;
  });
}

if (isMainModule(import.meta.url)) process.exitCode = run(process.argv.slice(2));
