/**
 * `string_table`: read, check, write and build Enfusion string tables as files.
 *
 * Two file types, both BaseContainer text read through the lossless parser
 * (`formats/enfusion-cst.ts`; no second parser):
 *
 *   `.st`    `StringTable { ItemClassName "CustomStringTableItem" Items { CustomStringTableItem
 *            { Id "..." Target_en_us "..." } } }` (create writes ItemClassName: W3 run 3, P-W3-21)
 *            the editable table the Localization Editor opens (ruling W3 OD-10:
 *            this grammar, not the XML of the 1.x template).
 *   `.conf`  `StringTableRuntime { Ids { "..." } Texts { "..." } }` the per-language
 *            runtime table the game loads (`Language/localization.<lang>.conf`).
 *
 * Reads take a file under the project root or a game resource from the paks.
 * Writes go under the project root only, on a file that exists (create: a new
 * one), never over an existing file without `overwrite`, and are a DRY RUN
 * unless `confirm` is true. A file whose bytes the parser cannot give back
 * unchanged is refused, never rewritten. Edits are splices of the original
 * text: bytes outside the edited span never change, and the result is read
 * back and compared with the announced change before anything is written.
 *
 * What is proven and what is not: both grammars round-trip byte for byte on
 * the vanilla runtime tables (tests/tools/string-table.test.ts). No `.st`
 * ships in the paks, so the `.st` shape follows the engine's BaseContainer
 * style and the class sources (CustomStringTableItem.c); the engine-accept
 * proof of a written `.st` is a live step (probe P-W3-21).
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { writeFileAtomic } from "../utils/atomic-write.js";
import { basename, dirname, extname, isAbsolute, relative, resolve } from "node:path";
import { z } from "zod";
import type { Config } from "../config.js";
import {
  parseCstBytes,
  type CstDocument,
  type CstEntry,
  type CstObject,
  type Token,
} from "../formats/enfusion-cst.js";
import {
  LIMIT_DEFAULT,
  LIMIT_MAX,
  VocabularyError,
  checkCursor,
  checkRelativePath,
  errorResponse,
  nextCursor,
  parseCursor,
  type ActionError,
  type ActionOk,
  type Change,
  type ErrorCode,
} from "../manifest/vocabulary.js";
import { PakVirtualFS } from "../pak/vfs.js";
import { assertInsideRoot, pinnedProjectRoot } from "../utils/path-guard.js";

// ── Constants ────────────────────────────────────────────────────────────────

export const STRING_TABLE_ACTIONS = [
  "inspect",
  "get",
  "lint",
  "lookup",
  "create",
  "upsert",
  "remove",
  "buildRuntime",
] as const;
export type StringTableAction = (typeof STRING_TABLE_ACTIONS)[number];

/** The thirteen languages of the base game's runtime tables (`Language/localization.<code>.conf`). */
export const KNOWN_LANGUAGES = [
  "en_us",
  "cs_cz",
  "de_de",
  "es_es",
  "fr_fr",
  "it_it",
  "ja_jp",
  "ko_kr",
  "pl_pl",
  "pt_br",
  "ru_ru",
  "uk_ua",
  "zh_cn",
] as const;

const DEFAULT_ITEM_CLASS = "CustomStringTableItem";
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const LANG = /^[a-z]{2}_[a-z]{2}$/;
const TARGET = /^Target_([a-z]{2}_[a-z]{2})(_edited)?$/;
const FIELDS_DEFAULT_ST = "Id,Target_en_us";
const DIFF_LINE_CAP = 160;

/** Enum names by value, from scripts/Game/Language/EStringTable*.c (1.9.0.37). */
const ENUMS: Readonly<Record<string, readonly string[]>> = {
  Status: [
    "DEVELOPMENT_PENDING",
    "DEVELOPMENT_DONE",
    "PROOFREADING_PENDING",
    "PROOFREADING_DONE",
    "TRANSLATION_PENDING",
    "TRANSLATION_DONE",
  ],
  ActorGender: ["NONE", "MALE", "FEMALE"],
  Terminology: ["NONE", "INTERNAL", "EXTERNAL"],
};
const BOOL_FIELDS = new Set(["NonTranslatable", "Hidden"]);
const INT_FIELDS = new Set(["MaxLength", "Modified"]);
const TEXT_FIELDS = new Set([
  "Id",
  "Comment",
  "DevNote",
  "Repro",
  "Author",
  "LastChanged",
  "ImageLink",
  "SourceFile",
]);

const OD5_WARNING =
  "The engine's SCR_LocModifiedPlugin writes the Workbench user name into Author and LastChanged when an item is edited in the Localization Editor; this tool neither stamps nor blanks those fields.";
const UNPROVEN_WARNING =
  "Checked offline against the grammar of the class sources, not by the engine: open the file in the Localization Editor (probe P-W3-21) to confirm it loads.";

// ── Errors ───────────────────────────────────────────────────────────────────

function refuse(code: ErrorCode, message: string): never {
  throw new VocabularyError(code, message);
}

// ── Text codec ───────────────────────────────────────────────────────────────

/**
 * One quoted part of a value as the engine writes it: backslashes stay literal
 * and a quote is `\"` (the vanilla tables hold `\\"` for a literal backslash
 * before a quote, which this reads and writes back the same way). A value with
 * line breaks is several quoted parts, each but the last followed by `\`.
 */
export function decodePart(raw: string): string {
  let inner = raw;
  if (inner.startsWith('"')) {
    inner = inner.length >= 2 && inner.endsWith('"') ? inner.slice(1, -1) : inner.slice(1);
    return inner.replace(/\\"/g, '"');
  }
  return inner;
}

/** The text of a value from its parts: parts are lines. */
function joinParts(parts: readonly string[]): string {
  return parts.map(decodePart).join("\n");
}

/** Quotes one line of text; a line that would end in a backslash is refused (it would escape the closing quote). */
function quoteLine(line: string): string {
  if (line.endsWith("\\")) {
    refuse("INVALID_ARGUMENT", `text cannot end a line with a backslash: ${JSON.stringify(line)}`);
  }
  if (line.includes("\0")) refuse("INVALID_ARGUMENT", "text cannot hold a NUL character");
  return `"${line.replace(/"/g, '\\"')}"`;
}

/** Text as quoted parts (one per line), joined the way continuation lines are written. */
export function encodeText(text: string, eol: string, indent: string): string {
  return text
    .split(/\r\n|\n|\r/)
    .map(quoteLine)
    .join(`\\${eol}${indent}`);
}

// ── Splices over the original text ───────────────────────────────────────────

interface Splice {
  start: number;
  end: number;
  text: string;
}

function applySplices(text: string, splices: readonly Splice[]): string {
  const sorted = splices
    .map((s, i) => ({ s, i }))
    .sort((a, b) => a.s.start - b.s.start || a.s.end - b.s.end || a.i - b.i)
    .map((x) => x.s);
  let out = "";
  let cursor = 0;
  for (const s of sorted) {
    if (s.start < cursor || s.end < s.start) {
      refuse("INVALID_ARGUMENT", "two edits overlap; nothing was changed");
    }
    out += text.slice(cursor, s.start) + s.text;
    cursor = s.end;
  }
  return out + text.slice(cursor);
}

function lineStart(text: string, offset: number): number {
  let i = offset;
  while (i > 0 && text[i - 1] !== "\n" && text[i - 1] !== "\r") i--;
  return i;
}

function lineStop(text: string, offset: number): number {
  let i = offset;
  while (i < text.length && text[i] !== "\n" && text[i] !== "\r") i++;
  return i;
}

/** The indent of the line `offset` starts, when only blanks come before it on the line. */
function indentAt(text: string, offset: number): string | undefined {
  const pre = text.slice(lineStart(text, offset), offset);
  return /^[ \t]*$/.test(pre) ? pre : undefined;
}

function eolOf(doc: CstDocument): string {
  return doc.tokens.find((t) => t.kind === "eol")?.text ?? "\n";
}

/** From the start of an entry's line through its line ending, when nothing else shares the lines. */
function wholeLines(text: string, start: number, end: number): [number, number] | undefined {
  const ls = lineStart(text, start);
  if (!/^[ \t]*$/.test(text.slice(ls, start))) return undefined;
  let j = end;
  while (j < text.length && (text[j] === " " || text[j] === "\t")) j++;
  if (j < text.length && text[j] !== "\n" && text[j] !== "\r") return undefined;
  if (text[j] === "\r") j += text[j + 1] === "\n" ? 2 : 1;
  else if (text[j] === "\n") j++;
  return [ls, j];
}

/** Lines to add at the end of a block, before its closing brace. */
function appendInBlock(doc: CstDocument, block: CstObject, body: string, eol: string): Splice {
  const text = doc.text;
  if (!block.close) refuse("INVALID_ARGUMENT", `block '${block.key}' is not closed`);
  const c = block.close.start;
  if (indentAt(text, c) !== undefined) {
    const ls = lineStart(text, c);
    return { start: ls, end: ls, text: body + eol };
  }
  const hi = indentAt(text, block.start) ?? "";
  return { start: c, end: c, text: eol + body + eol + hi };
}

/** A unified-style diff of the splices: whole lines, `-` old and `+` new, capped. */
export function diffOfSplices(label: string, old: string, splices: readonly Splice[]): string {
  const lines: string[] = [`--- a/${label}`, `+++ b/${label}`];
  const sorted = [...splices].sort((a, b) => a.start - b.start);
  const split = (s: string): string[] => {
    const parts = s.split(/\r\n|\n|\r/);
    if (parts[parts.length - 1] === "") parts.pop();
    return parts;
  };
  for (const s of sorted) {
    const ls = lineStart(old, s.start);
    let oldRegion: string;
    let newRegion: string;
    if (s.start === s.end && s.start === ls) {
      oldRegion = "";
      newRegion = s.text;
    } else {
      const stop = s.end > s.start && /[\r\n]/.test(old[s.end - 1]) ? s.end : lineStop(old, s.end);
      oldRegion = old.slice(ls, stop);
      newRegion = old.slice(ls, s.start) + s.text + old.slice(s.end, stop);
    }
    let lineNo = 1;
    for (let i = 0; i < ls; i++) {
      if (old[i] === "\n" || (old[i] === "\r" && old[i + 1] !== "\n")) lineNo++;
    }
    lines.push(`@@ line ${lineNo} @@`);
    for (const l of split(oldRegion)) lines.push(`-${l}`);
    for (const l of split(newRegion)) lines.push(`+${l}`);
  }
  if (lines.length > DIFF_LINE_CAP) {
    const more = lines.length - DIFF_LINE_CAP;
    return [...lines.slice(0, DIFF_LINE_CAP), `... ${more} more diff line(s)`].join("\n");
  }
  return lines.join("\n");
}

// ── Reading a document ───────────────────────────────────────────────────────

interface Part {
  raw: string;
  /** True when the line ends with the `\` continuation marker. */
  cont: boolean;
  /** Offsets of the part's text in the document (the marker excluded). */
  start: number;
  end: number;
  /** Not one clean string or bare word (a quote the lexer reads differently from the engine). */
  irregular: boolean;
}

function lineTokens(e: CstEntry): Token[] | undefined {
  if (e.kind === "scalar") return [e.keyToken, ...e.values];
  if (e.kind === "value") return e.values;
  return undefined;
}

function partOf(text: string, toks: readonly Token[], fallbackAt: number): Part {
  const last = toks[toks.length - 1];
  const cont = toks.length > 0 && last.kind === "word" && last.text === "\\";
  const core = cont ? toks.slice(0, -1) : toks;
  if (core.length === 0) {
    return { raw: "", cont, start: fallbackAt, end: fallbackAt, irregular: false };
  }
  const start = core[0].start;
  const end = core[core.length - 1].end;
  const irregular =
    core.length > 1 ||
    (core[0].kind === "string" && !(core[0].text.length >= 2 && core[0].text.endsWith('"')));
  return { raw: text.slice(start, end), cont, start, end, irregular };
}

interface Field {
  key: string;
  /** The key's entry and the continuation entries after it. */
  entries: CstEntry[];
  parts: Part[];
  text: string;
  quoted: boolean;
  /** `[valueStart, valueEnd)` covers the value, every part and the markers between them. */
  valueStart: number;
  valueEnd: number;
  irregular: boolean;
  /** The field is a nested block (an array), not a scalar. */
  block: boolean;
}

export interface Item {
  index: number;
  cls: string;
  id: string;
  node: CstObject;
  fields: Field[];
  /** Keys that occur more than once in the item. */
  repeated: string[];
}

function readFields(doc: CstDocument, node: CstObject): { fields: Field[]; repeated: string[] } {
  const text = doc.text;
  const fields: Field[] = [];
  const kids = node.children;
  for (let i = 0; i < kids.length; i++) {
    const e = kids[i];
    if (e.kind === "object") {
      fields.push({
        key: e.key,
        entries: [e],
        parts: [],
        text: "",
        quoted: false,
        valueStart: e.start,
        valueEnd: e.end,
        irregular: false,
        block: true,
      });
      continue;
    }
    if (e.kind !== "scalar") continue;
    const parts: Part[] = [partOf(text, e.values, e.end)];
    const entries: CstEntry[] = [e];
    let irregular = parts[0].irregular;
    while (parts[parts.length - 1].cont) {
      const next = kids[i + 1];
      const toks = next ? lineTokens(next) : undefined;
      if (!next || !toks) {
        irregular = true;
        break;
      }
      i++;
      entries.push(next);
      const p = partOf(text, toks, next.end);
      parts.push(p);
      irregular = irregular || p.irregular;
    }
    const first = parts[0];
    const last = parts[parts.length - 1];
    fields.push({
      key: e.key,
      entries,
      parts,
      text: joinParts(parts.map((p) => p.raw)),
      quoted: e.values.length > 0 && e.values[0].kind === "string",
      valueStart: first.start,
      valueEnd: last.end,
      irregular,
      block: false,
    });
  }
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const f of fields) {
    if (seen.has(f.key)) repeated.add(f.key);
    seen.add(f.key);
  }
  return { fields, repeated: [...repeated] };
}

export interface StTable {
  doc: CstDocument;
  root: CstObject;
  items: CstObject | undefined;
  list: Item[];
  itemsBlocks: number;
}

function fieldText(item: Item, key: string): string {
  return item.fields.find((f) => f.key === key && !f.block)?.text ?? "";
}

export function readSt(doc: CstDocument): StTable {
  const root = doc.base;
  if (root.kind !== "object" || root.key !== "StringTable") {
    refuse(
      "INVALID_ARGUMENT",
      "not a string table: the file does not start with a StringTable block",
    );
  }
  const blocks = root.children.filter(
    (c): c is CstObject => c.kind === "object" && c.key === "Items",
  );
  const items = blocks[0];
  const list: Item[] = [];
  if (items) {
    for (const c of items.children) {
      if (c.kind !== "object") continue;
      const { fields, repeated } = readFields(doc, c);
      const item: Item = { index: list.length, cls: c.key, id: "", node: c, fields, repeated };
      item.id = fieldText(item, "Id");
      list.push(item);
    }
  }
  return { doc, root, items, list, itemsBlocks: blocks.length };
}

export interface Runtime {
  ids: string[];
  texts: string[];
  /** Entries whose text the lexer reads differently from the engine (counted, informational). */
  irregular: number;
  multiline: number;
  eol: string;
}

function readLogical(
  doc: CstDocument,
  children: readonly CstEntry[],
): { values: string[]; irregular: number; multiline: number } {
  const text = doc.text;
  const values: string[] = [];
  let irregular = 0;
  let multiline = 0;
  for (let i = 0; i < children.length; i++) {
    const parts: Part[] = [];
    let bad = false;
    for (;;) {
      const e = children[i];
      const toks = lineTokens(e);
      if (!toks) {
        bad = true;
        parts.push({
          raw: text.slice(e.start, e.end),
          cont: false,
          start: e.start,
          end: e.end,
          irregular: true,
        });
        break;
      }
      const p = partOf(text, toks, e.end);
      parts.push(p);
      bad = bad || p.irregular;
      if (!p.cont) break;
      if (i + 1 >= children.length) {
        bad = true;
        break;
      }
      i++;
    }
    if (parts.length > 1) multiline++;
    if (bad) irregular++;
    values.push(joinParts(parts.map((p) => p.raw)));
  }
  return { values, irregular, multiline };
}

export function readRuntime(doc: CstDocument): Runtime {
  const root = doc.base;
  if (root.kind !== "object" || root.key !== "StringTableRuntime") {
    refuse(
      "INVALID_ARGUMENT",
      "not a runtime string table: the file does not start with a StringTableRuntime block",
    );
  }
  const ids = root.children.find((c): c is CstObject => c.kind === "object" && c.key === "Ids");
  const texts = root.children.find((c): c is CstObject => c.kind === "object" && c.key === "Texts");
  const a = ids ? readLogical(doc, ids.children) : { values: [], irregular: 0, multiline: 0 };
  const b = texts ? readLogical(doc, texts.children) : { values: [], irregular: 0, multiline: 0 };
  return {
    ids: a.values,
    texts: b.values,
    irregular: a.irregular + b.irregular,
    multiline: a.multiline + b.multiline,
    eol: eolOf(doc),
  };
}

/** Sort order of the runtime tables' Ids (vanilla: case-insensitive code-unit order; 0 descents in the 16,455 Ids of 1.9.0.37). */
export function idOrder(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  if (x !== y) return x < y ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** A runtime table as text, in the shape of the vanilla files (one space of indent per depth, no final line ending). */
export function emitRuntime(
  ids: readonly string[],
  texts: readonly string[],
  eol: string = "\n",
): string {
  const block = (name: string, values: readonly string[], idsBlock: boolean): string => {
    if (values.length === 0) return ` ${name} {${eol} }`;
    const body = values
      .map((v) => {
        if (idsBlock && /[\r\n]/.test(v))
          refuse("INVALID_ARGUMENT", `an Id cannot hold a line break: ${JSON.stringify(v)}`);
        return `  ${encodeText(v, eol, "  ")}`;
      })
      .join(eol);
    return ` ${name} {${eol}${body}${eol} }`;
  };
  return `StringTableRuntime {${eol}${block("Ids", ids, true)}${eol}${block("Texts", texts, false)}${eol}}`;
}

// ── Field planning (what a write may say) ────────────────────────────────────

type Scalar = string | number | boolean;

type FieldKind = "text" | "enum" | "bool" | "int" | "other";

interface PlannedField {
  key: string;
  kind: FieldKind;
  /** The normalised value; undefined removes the field. */
  value: string | undefined;
}

function kindOf(key: string): FieldKind | undefined {
  if (TEXT_FIELDS.has(key) || TARGET.test(key)) return "text";
  if (key in ENUMS) return "enum";
  if (BOOL_FIELDS.has(key)) return "bool";
  if (INT_FIELDS.has(key)) return "int";
  return undefined;
}

function planField(key: string, raw: Scalar | null, unknown: Set<string>): PlannedField {
  if (!IDENT.test(key)) refuse("INVALID_ARGUMENT", `not a field name: ${JSON.stringify(key)}`);
  if (raw === null) return { key, kind: kindOf(key) ?? "other", value: undefined };
  const known = kindOf(key);
  if (known === undefined) unknown.add(key);
  const kind = known ?? "other";
  switch (kind) {
    case "text": {
      if (typeof raw !== "string") refuse("INVALID_ARGUMENT", `${key} takes text`);
      encodeText(raw, "\n", ""); // refuses a line the writer could not quote
      return { key, kind, value: raw.replace(/\r\n|\r/g, "\n") };
    }
    case "enum": {
      const names = ENUMS[key];
      let name: string | undefined;
      if (typeof raw === "number" || (typeof raw === "string" && /^\d+$/.test(raw))) {
        name = names[Number(raw)];
      } else if (typeof raw === "string") {
        name = names.find((n) => n === raw);
      }
      if (name === undefined) {
        refuse(
          "INVALID_ARGUMENT",
          `${key} takes one of ${names.join(", ")} (or its number); got ${JSON.stringify(raw)}`,
        );
      }
      return { key, kind, value: name };
    }
    case "bool": {
      const v = raw === true || raw === 1 || raw === "1" || raw === "true";
      const f = raw === false || raw === 0 || raw === "0" || raw === "false";
      if (!v && !f)
        refuse("INVALID_ARGUMENT", `${key} takes true or false; got ${JSON.stringify(raw)}`);
      return { key, kind, value: v ? "1" : "0" };
    }
    case "int": {
      const n = typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : raw;
      if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 0) {
        refuse(
          "INVALID_ARGUMENT",
          `${key} takes a whole number of 0 or more; got ${JSON.stringify(raw)}`,
        );
      }
      return { key, kind, value: String(n) };
    }
    default: {
      if (typeof raw === "string") {
        encodeText(raw, "\n", "");
        return { key, kind: "text", value: raw.replace(/\r\n|\r/g, "\n") };
      }
      if (typeof raw === "boolean") return { key, kind: "bool", value: raw ? "1" : "0" };
      if (!Number.isFinite(raw)) refuse("INVALID_ARGUMENT", `${key}: not a finite number`);
      return { key, kind: "int", value: String(raw) };
    }
  }
}

interface PlannedItem {
  id: string;
  fields: PlannedField[];
}

function planItems(
  items: readonly Record<string, Scalar | null>[] | undefined,
  warnings: string[],
): PlannedItem[] {
  if (!items || items.length === 0)
    refuse("INVALID_ARGUMENT", "items is required: a list of {Id, <field>: value, ...}");
  const unknown = new Set<string>();
  const seen = new Set<string>();
  const out: PlannedItem[] = [];
  items.forEach((rec, n) => {
    const keys = Object.keys(rec);
    if (keys.includes("Id") && keys.includes("id")) {
      refuse("INVALID_ARGUMENT", `item ${n}: both Id and id given`);
    }
    const idRaw = rec.Id ?? rec.id;
    if (typeof idRaw !== "string" || idRaw === "" || /[\r\n]/.test(idRaw)) {
      refuse("INVALID_ARGUMENT", `item ${n}: Id must be a non-empty one-line text`);
    }
    if (idRaw !== idRaw.trim()) {
      refuse("INVALID_ARGUMENT", `item ${n}: Id has blanks at its ends: ${JSON.stringify(idRaw)}`);
    }
    if (seen.has(idRaw)) {
      refuse("DUPLICATE_ID", `Id given twice in one call: ${idRaw}`);
    }
    seen.add(idRaw);
    const fields: PlannedField[] = [{ key: "Id", kind: "text", value: idRaw }];
    for (const k of keys) {
      if (k === "Id" || k === "id") continue;
      fields.push(planField(k, rec[k], unknown));
    }
    out.push({ id: idRaw, fields });
  });
  if (unknown.size > 0) {
    warnings.push(
      `Fields not in CustomStringTableItem, written as given: ${[...unknown].join(", ")}. A mod's own item class may declare them.`,
    );
  }
  return out;
}

/** The value text of a planned field as the file shows it. */
function valueText(
  f: PlannedField,
  value: string,
  quoted: boolean,
  eol: string,
  indent: string,
): string {
  if (f.kind === "text") return encodeText(value, eol, indent);
  return quoted ? `"${value}"` : value;
}

function formatItemText(
  cls: string,
  fields: readonly PlannedField[],
  indent: string,
  unit: string,
  eol: string,
): string {
  const fi = indent + unit;
  const lines = [`${indent}${cls} {`];
  for (const f of fields) {
    if (f.value === undefined) continue;
    if (f.key !== "Id" && f.kind === "text" && f.value === "") continue;
    lines.push(`${fi}${f.key} ${valueText(f, f.value, false, eol, fi)}`);
  }
  lines.push(`${indent}}`);
  return lines.join(eol);
}

// ── The model, for verifying a write ─────────────────────────────────────────

type Model = { cls: string; fields: [string, string][] }[];

/** Normal form of a value for comparing the file with the intended change. */
function normValue(key: string, text: string): string {
  const names = ENUMS[key];
  if (names && /^\d+$/.test(text) && names[Number(text)] !== undefined) return names[Number(text)];
  return text;
}

function modelOf(table: StTable): Model {
  return table.list.map((it) => ({
    cls: it.cls,
    fields: it.fields
      .filter((f) => !f.block)
      .map((f): [string, string] => [f.key, normValue(f.key, f.text)]),
  }));
}

function sameModel(a: Model, b: Model): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ── Sources and targets ──────────────────────────────────────────────────────

interface Source {
  buf: Buffer;
  /** For the reply. */
  label: string;
  file?: string;
  /** Resource path (game data, or relative to the project). */
  resource: string;
  game: boolean;
}

const stripGuid = (ref: string): string => ref.replace(/^\{[0-9A-Fa-f]{16}\}/, "");

function vfsOf(config: Config): PakVirtualFS | null {
  try {
    return config.gamePath ? PakVirtualFS.get(config.gamePath) : null;
  } catch {
    return null;
  }
}

function inside(file: string, root: string, label: string): void {
  try {
    assertInsideRoot(file, root, label);
  } catch (e) {
    refuse("ABSOLUTE_PATH", e instanceof Error ? e.message : String(e));
  }
}

function forward(p: string): string {
  return p.replace(/\\/g, "/");
}

/** A path under the project: its file and the path relative to the root. */
function projectFile(path: string, root: string): { file: string; rel: string } {
  const clean = stripGuid(path.trim());
  if (clean === "") refuse("INVALID_ARGUMENT", "empty path");
  if (clean.startsWith("-")) refuse("INVALID_ARGUMENT", "paths starting with '-' are refused");
  if (isAbsolute(clean)) {
    const file = resolve(clean);
    inside(file, root, "path");
    return { file, rel: forward(relative(root, file)) };
  }
  const rel = checkRelativePath(clean);
  const file = resolve(root, rel);
  inside(file, root, "path");
  return { file, rel };
}

/** A file under the project, else a game resource (read only). */
function readSource(path: string, root: string | undefined, config: Config): Source {
  const clean = stripGuid(path.trim());
  if (clean === "") refuse("INVALID_ARGUMENT", "empty path");
  if (clean.startsWith("-")) refuse("INVALID_ARGUMENT", "paths starting with '-' are refused");
  if (isAbsolute(clean)) {
    if (!root)
      refuse(
        "NOT_IN_PROJECT",
        "an absolute path needs a project path (ENFUSION_PROJECT_PATH or projectPath)",
      );
    const { file, rel } = projectFile(clean, root);
    if (!existsSync(file)) refuse("PATH_NOT_FOUND", `no file at ${file}`);
    return { buf: readFileSync(file), label: file, file, resource: rel, game: false };
  }
  const rel = checkRelativePath(clean);
  if (root) {
    const file = resolve(root, rel);
    inside(file, root, "path");
    if (existsSync(file) && statSync(file).isFile()) {
      return { buf: readFileSync(file), label: file, file, resource: rel, game: false };
    }
  }
  const vfs = vfsOf(config);
  if (vfs?.exists(rel) && vfs.fileSize(rel) >= 0) {
    return { buf: vfs.readFile(rel), label: `${rel} (game data)`, resource: rel, game: true };
  }
  refuse(
    "PATH_NOT_FOUND",
    `no file at "${path}": not under ${root ?? "(no project path)"} and not in the game data` +
      (vfs ? "" : " (game paks not available: ENFUSION_GAME_PATH)"),
  );
}

function languageOf(path: string): string | undefined {
  return /\.([a-z]{2}_[a-z]{2})\.conf$/i.exec(path)?.[1].toLowerCase();
}

// ── Reply shapes ─────────────────────────────────────────────────────────────

export type StringTableResponse = ActionOk | ActionError;

function ok(
  action: string,
  target: string,
  changed: Change[] | null,
  readback: unknown,
  next: string | undefined,
  warnings: string[] = [],
): ActionOk {
  return { ok: true, action, target, changed, readback, ...(next ? { next } : {}), warnings };
}

export function toToolResult(r: StringTableResponse) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(r, null, 2) }],
    ...(r.ok ? {} : { isError: true as const }),
  };
}

// ── Arguments ────────────────────────────────────────────────────────────────

export interface StringTableArgs {
  action: StringTableAction;
  path?: string;
  prefix?: string;
  ids?: string[];
  fields?: string;
  cursor?: string;
  limit?: number;
  languages?: string[];
  items?: Record<string, Scalar | null>[];
  itemClass?: string;
  outDir?: string;
  overwrite?: boolean;
  confirm?: boolean;
  projectPath?: string;
}

function need<T>(v: T | undefined, what: string, action: string): T {
  if (v === undefined || v === "") refuse("INVALID_ARGUMENT", `${action} needs ${what}`);
  return v;
}

// ── Runtime cache (lookup reads 13 tables of ~1.6 MB) ────────────────────────

interface Indexed extends Runtime {
  map: Map<string, string>;
}
const runtimeCache = new Map<string, { sig: string; value: Indexed }>();

function indexRuntime(src: Source): Indexed {
  const sig = `${src.buf.length}:${src.file && !src.game ? statSync(src.file).mtimeMs : 0}`;
  const key = `${src.game ? "game" : "project"}:${src.resource}`;
  const hit = runtimeCache.get(key);
  if (hit && hit.sig === sig) return hit.value;
  const rt = readRuntime(parseCstBytes(src.buf));
  const map = new Map<string, string>();
  const n = Math.min(rt.ids.length, rt.texts.length);
  for (let i = 0; i < n; i++) if (!map.has(rt.ids[i])) map.set(rt.ids[i], rt.texts[i]);
  const value = { ...rt, map };
  if (runtimeCache.size >= 16) runtimeCache.delete(runtimeCache.keys().next().value as string);
  runtimeCache.set(key, { sig, value });
  return value;
}

// ── Reads ────────────────────────────────────────────────────────────────────

type Kind = "st" | "runtime";

function openDoc(src: Source): { doc: CstDocument; kind: Kind } {
  const doc = parseCstBytes(src.buf);
  const root = doc.base;
  if (root.kind === "object" && root.key === "StringTable") return { doc, kind: "st" };
  if (root.kind === "object" && root.key === "StringTableRuntime") return { doc, kind: "runtime" };
  return refuse(
    "INVALID_ARGUMENT",
    `${src.label} is neither a StringTable (.st) nor a StringTableRuntime (.conf)`,
  );
}

function languageColumns(table: StTable): { code: string; filled: number; edited: number }[] {
  const by = new Map<string, { code: string; filled: number; edited: number }>();
  for (const it of table.list) {
    for (const f of it.fields) {
      const m = TARGET.exec(f.key);
      if (!m || f.block) continue;
      let e = by.get(m[1]);
      if (!e) by.set(m[1], (e = { code: m[1], filled: 0, edited: 0 }));
      if (f.text !== "") {
        if (m[2]) e.edited++;
        else e.filled++;
      }
    }
  }
  return [...by.values()];
}

function actionInspect(src: Source, target: string): ActionOk {
  const { doc, kind } = openDoc(src);
  const roundTrip = doc.toBytes().equals(src.buf);
  const common = {
    source: src.label,
    kind,
    bytes: src.buf.length,
    encoding: doc.encoding,
    eol: JSON.stringify(eolOf(doc)),
    byteExactRoundTrip: roundTrip,
    parseDiagnostics: doc.diagnostics.length,
  };
  if (kind === "runtime") {
    const rt = readRuntime(doc);
    const dup = rt.ids.length - new Set(rt.ids).size;
    let sorted = true;
    for (let i = 1; i < rt.ids.length; i++) {
      if (idOrder(rt.ids[i - 1], rt.ids[i]) > 0) {
        sorted = false;
        break;
      }
    }
    return ok(
      "inspect",
      target,
      null,
      {
        ...common,
        language: languageOf(src.resource) ?? null,
        ids: rt.ids.length,
        texts: rt.texts.length,
        countsMatch: rt.ids.length === rt.texts.length,
        emptyTexts: rt.texts.filter((t) => t === "").length,
        multilineTexts: rt.multiline,
        irregularEntries: rt.irregular,
        duplicateIds: dup,
        idsInOrder: sorted,
      },
      "lint for the findings; get or lookup for the rows.",
    );
  }
  const table = readSt(doc);
  const columns = new Map<string, number>();
  const classes = new Map<string, number>();
  const status = new Map<string, number>();
  let hidden = 0;
  for (const it of table.list) {
    classes.set(it.cls, (classes.get(it.cls) ?? 0) + 1);
    for (const f of it.fields) if (!f.block) columns.set(f.key, (columns.get(f.key) ?? 0) + 1);
    const s = normValue("Status", fieldText(it, "Status") || "0");
    status.set(s, (status.get(s) ?? 0) + 1);
    if (["1", "true"].includes(fieldText(it, "Hidden"))) hidden++;
  }
  const ids = table.list.map((i) => i.id);
  return ok(
    "inspect",
    target,
    null,
    {
      ...common,
      items: table.list.length,
      itemClasses: Object.fromEntries(classes),
      columns: [...columns].map(([name, items]) => ({ name, items })),
      languages: languageColumns(table),
      status: Object.fromEntries(status),
      hidden,
      duplicateIds: ids.length - new Set(ids).size,
      itemsBlocks: table.itemsBlocks,
    },
    "lint for the findings; get for the rows.",
  );
}

function pageOf<T>(
  all: readonly T[],
  cursorRaw: string | undefined,
  limit: number | undefined,
): { rows: T[]; start: number; next: string | undefined } {
  const lim = limit ?? LIMIT_DEFAULT;
  if (!Number.isInteger(lim) || lim < 1 || lim > LIMIT_MAX) {
    refuse("INVALID_ARGUMENT", `limit must be 1 to ${LIMIT_MAX}`);
  }
  let start = 0;
  if (cursorRaw !== undefined) {
    const c = parseCursor(cursorRaw);
    checkCursor(c, all.length);
    start = c.start;
  }
  return { rows: all.slice(start, start + lim), start, next: nextCursor(start, lim, all.length) };
}

function actionGet(src: Source, target: string, a: StringTableArgs): ActionOk {
  const { doc, kind } = openDoc(src);
  const idSet = a.ids ? new Set(a.ids) : undefined;
  const match = (id: string): boolean =>
    (idSet === undefined || idSet.has(id)) && (a.prefix === undefined || id.startsWith(a.prefix));
  let rows: Record<string, unknown>[];
  if (kind === "runtime") {
    const rt = readRuntime(doc);
    rows = [];
    for (let i = 0; i < rt.ids.length; i++) {
      if (match(rt.ids[i])) rows.push({ Index: i, Id: rt.ids[i], Text: rt.texts[i] ?? null });
    }
  } else {
    const wanted = (a.fields ?? FIELDS_DEFAULT_ST)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const all = wanted.includes("*");
    rows = readSt(doc)
      .list.filter((it) => match(it.id))
      .map((it) => {
        const row: Record<string, unknown> = { Index: it.index, Id: it.id };
        if (all) {
          for (const f of it.fields) if (f.key !== "Id" && !f.block) row[f.key] = f.text;
        } else {
          for (const k of wanted) if (k !== "Id") row[k] = fieldText(it, k);
        }
        return row;
      });
  }
  const page = pageOf(rows, a.cursor, a.limit);
  return ok(
    "get",
    target,
    null,
    { kind, total: rows.length, start: page.start, rows: page.rows, next: page.next },
    page.next ? `get again with cursor ${page.next}.` : undefined,
  );
}

interface Finding {
  level: "error" | "warning" | "info";
  code: string;
  id?: string;
  message: string;
}

export function lintSt(table: StTable): Finding[] {
  const out: Finding[] = [];
  const seen = new Map<string, number>();
  const langs = languageColumns(table)
    .filter((l) => l.code !== "en_us" && l.filled + l.edited > 0)
    .map((l) => l.code);
  for (const it of table.list) {
    if (it.id === "") {
      out.push({ level: "error", code: "EMPTY_ID", message: `item ${it.index} has no Id` });
    } else {
      const n = (seen.get(it.id) ?? 0) + 1;
      seen.set(it.id, n);
      if (n > 1) {
        out.push({
          level: "error",
          code: "DUPLICATE_ID",
          id: it.id,
          message: `Id used again at item ${it.index}`,
        });
      }
    }
    for (const k of it.repeated) {
      out.push({
        level: "warning",
        code: "REPEATED_FIELD",
        id: it.id,
        message: `${k} appears more than once`,
      });
    }
    const en = fieldText(it, "Target_en_us");
    const edited = fieldText(it, "Target_en_us_edited");
    if (en === "" && edited === "") {
      out.push({
        level: "warning",
        code: "EMPTY_SOURCE",
        id: it.id,
        message: "Target_en_us is empty",
      });
    }
    const max = Number(fieldText(it, "MaxLength") || "0");
    if (max > 0) {
      for (const f of it.fields) {
        if (f.block || !TARGET.test(f.key)) continue;
        if (f.text.length > max) {
          out.push({
            level: "warning",
            code: "OVER_MAX_LENGTH",
            id: it.id,
            message: `${f.key} is ${f.text.length} characters, MaxLength ${max}`,
          });
        }
      }
    }
    const hidden = ["1", "true"].includes(fieldText(it, "Hidden"));
    if (hidden)
      out.push({
        level: "info",
        code: "HIDDEN",
        id: it.id,
        message: "Hidden: left out of the runtime tables",
      });
    const nonTranslatable = ["1", "true"].includes(fieldText(it, "NonTranslatable"));
    if (!hidden && !nonTranslatable && (en !== "" || edited !== "")) {
      for (const l of langs) {
        if (fieldText(it, `Target_${l}`) === "") {
          out.push({
            level: "info",
            code: "MISSING_TRANSLATION",
            id: it.id,
            message: `Target_${l} is empty (the runtime table falls back to English)`,
          });
        }
      }
    }
  }
  return out;
}

export function lintRuntime(rt: Runtime): Finding[] {
  const out: Finding[] = [];
  if (rt.ids.length !== rt.texts.length) {
    out.push({
      level: "error",
      code: "COUNT_MISMATCH",
      message: `${rt.ids.length} Ids but ${rt.texts.length} Texts`,
    });
  }
  const seen = new Set<string>();
  rt.ids.forEach((id, i) => {
    if (id === "") out.push({ level: "error", code: "EMPTY_ID", message: `entry ${i} has no Id` });
    if (seen.has(id))
      out.push({
        level: "error",
        code: "DUPLICATE_ID",
        id,
        message: `Id used again at entry ${i}`,
      });
    seen.add(id);
    if (rt.texts[i] === "")
      out.push({ level: "warning", code: "EMPTY_TEXT", id, message: "empty text" });
    if (i > 0 && idOrder(rt.ids[i - 1], id) > 0) {
      out.push({
        level: "info",
        code: "UNSORTED",
        id,
        message: "out of the vanilla order (case-insensitive by Id)",
      });
    }
  });
  if (rt.irregular > 0) {
    out.push({
      level: "info",
      code: "IRREGULAR_ENTRY",
      message: `${rt.irregular} entr${rt.irregular === 1 ? "y" : "ies"} with quoting the lexer reads differently from the engine`,
    });
  }
  return out;
}

function actionLint(src: Source, target: string, a: StringTableArgs): ActionOk {
  const { doc, kind } = openDoc(src);
  const findings = kind === "st" ? lintSt(readSt(doc)) : lintRuntime(readRuntime(doc));
  const counts: Record<string, number> = {};
  for (const f of findings) counts[f.code] = (counts[f.code] ?? 0) + 1;
  const page = pageOf(findings, a.cursor, a.limit);
  const errors = findings.filter((f) => f.level === "error").length;
  return ok(
    "lint",
    target,
    null,
    {
      kind,
      errors,
      warnings: findings.filter((f) => f.level === "warning").length,
      infos: findings.filter((f) => f.level === "info").length,
      counts,
      total: findings.length,
      start: page.start,
      findings: page.rows,
      next: page.next,
    },
    errors
      ? "fix the errors listed, then lint again."
      : page.next
        ? `lint again with cursor ${page.next}.`
        : undefined,
  );
}

function actionLookup(config: Config, root: string | undefined, a: StringTableArgs): ActionOk {
  if (a.ids !== undefined && a.prefix !== undefined)
    refuse("INVALID_ARGUMENT", "lookup takes ids or prefix, not both");
  if (a.ids === undefined && a.prefix === undefined)
    refuse("INVALID_ARGUMENT", "lookup needs ids or prefix");
  const path = a.path ?? "Language/localization.en_us.conf";
  const m = /^(.*)\.([a-z]{2}_[a-z]{2})\.conf$/i.exec(path.replace(/\\/g, "/"));
  if (!m)
    refuse("INVALID_ARGUMENT", "lookup path must be a runtime table named <name>.<lang>.conf");
  const stem = m[1];
  const given = m[2].toLowerCase();
  const langs = a.languages ?? [...new Set([given, ...KNOWN_LANGUAGES])];
  for (const l of langs)
    if (!LANG.test(l)) refuse("INVALID_ARGUMENT", `not a language code (xx_yy): ${l}`);
  const tables = new Map<string, Indexed>();
  const sources: Record<string, string> = {};
  const missing: string[] = [];
  for (const l of langs) {
    try {
      const src = readSource(`${stem}.${l}.conf`, root, config);
      tables.set(l, indexRuntime(src));
      sources[l] = src.game ? "game" : "project";
    } catch (e) {
      if (e instanceof VocabularyError && e.code === "PATH_NOT_FOUND") missing.push(l);
      else throw e;
    }
  }
  if (tables.size === 0) {
    refuse(
      "PATH_NOT_FOUND",
      `no runtime table found for ${stem}.<lang>.conf (tried ${langs.join(", ")})`,
    );
  }
  let ids: string[];
  if (a.ids !== undefined) ids = [...new Set(a.ids)];
  else {
    const union = new Set<string>();
    for (const t of tables.values())
      for (const id of t.map.keys()) if (id.startsWith(a.prefix as string)) union.add(id);
    ids = [...union].sort(idOrder);
  }
  const page = pageOf(ids, a.cursor, a.limit);
  const warnings: string[] = [];
  const rows = page.rows.map((id) => {
    const texts: Record<string, string> = {};
    for (const [l, t] of tables) {
      const v = t.map.get(id);
      if (v !== undefined) texts[l] = v;
    }
    return { Id: id, texts };
  });
  const absent = rows.filter((r) => Object.keys(r.texts).length === 0).map((r) => r.Id);
  if (absent.length > 0) warnings.push(`No text in any language for: ${absent.join(", ")}`);
  if (missing.length > 0) warnings.push(`No runtime table for: ${missing.join(", ")}`);
  return ok(
    "lookup",
    `path:${stem}.<lang>.conf`,
    null,
    {
      languagesRead: [...tables.keys()],
      languagesMissing: missing,
      sources,
      total: ids.length,
      start: page.start,
      rows,
      next: page.next,
    },
    page.next ? `lookup again with cursor ${page.next}.` : undefined,
    warnings,
  );
}

// ── Writes ───────────────────────────────────────────────────────────────────

function needExt(rel: string, ext: string, what: string): void {
  if (extname(rel).toLowerCase() !== ext)
    refuse("INVALID_ARGUMENT", `${what} must be a ${ext} file: ${rel}`);
}

interface Loaded {
  file: string;
  rel: string;
  buf: Buffer;
  doc: CstDocument;
  table: StTable;
}

/** An existing project `.st` the writer can give back byte for byte, or a refusal. */
function loadSt(path: string, root: string): Loaded {
  const { file, rel } = projectFile(path, root);
  needExt(rel, ".st", "path");
  if (!existsSync(file) || !statSync(file).isFile()) {
    refuse(
      "PATH_NOT_FOUND",
      `no file at ${rel}: upsert and remove edit an existing table (create makes a new one)`,
    );
  }
  const buf = readFileSync(file);
  const doc = parseCstBytes(buf);
  if (doc.encoding !== "utf8")
    refuse("INVALID_ARGUMENT", `${rel} is not UTF-8; the writer leaves it alone`);
  if (!doc.toBytes().equals(buf)) {
    refuse(
      "INVALID_ARGUMENT",
      `${rel} has content this writer could not reproduce byte for byte; it is left alone. Edit it in the Localization Editor.`,
    );
  }
  const table = readSt(doc);
  if (doc.diagnostics.length > 0) {
    refuse(
      "INVALID_ARGUMENT",
      `${rel} does not parse cleanly (${doc.diagnostics[0].message} at line ${doc.diagnostics[0].line}); it is left alone`,
    );
  }
  if (table.itemsBlocks > 1)
    refuse("INVALID_ARGUMENT", `${rel} has more than one Items block; it is left alone`);
  return { file, rel, buf, doc, table };
}

/**
 * Writes bytes through write-then-rename (a failed write leaves the file as it was: review round
 * 1, F9) and reads them back; a mismatch is SAVE_FAILED.
 */
function writeVerified(file: string, bytes: Buffer): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileAtomic(file, bytes);
  if (!readFileSync(file).equals(bytes)) {
    refuse("SAVE_FAILED", `${file} does not read back as written`);
  }
}

const CONFIRM_NEXT = "Pass confirm: true to write exactly this.";

function dryOrWrite(opts: {
  action: string;
  rel: string;
  file: string;
  oldText: string;
  splices: Splice[];
  newText: string;
  changed: Change[];
  warnings: string[];
  confirm: boolean;
  summary: Record<string, unknown>;
}): ActionOk {
  const diff = diffOfSplices(opts.rel, opts.oldText, opts.splices);
  const bytes = Buffer.from(opts.newText, "utf8");
  if (!opts.confirm) {
    return ok(
      opts.action,
      `path:${opts.rel}`,
      opts.changed,
      {
        written: false,
        dryRun: true,
        ...opts.summary,
        bytesBefore: Buffer.byteLength(opts.oldText),
        bytesAfter: bytes.length,
        diff,
      },
      CONFIRM_NEXT,
      opts.warnings,
    );
  }
  writeVerified(opts.file, bytes);
  return ok(
    opts.action,
    `path:${opts.rel}`,
    opts.changed,
    {
      written: true,
      ...opts.summary,
      bytesBefore: Buffer.byteLength(opts.oldText),
      bytesAfter: bytes.length,
      diff,
    },
    "Open the table in the Localization Editor (wb_localization open) to see it; an editor tab opened earlier keeps its own copy.",
    opts.warnings,
  );
}

function snapshot(it: Item): Record<string, string> {
  const o: Record<string, string> = {};
  for (const f of it.fields) if (!f.block) o[f.key] = f.text;
  return o;
}

function actionCreate(root: string | undefined, a: StringTableArgs): ActionOk {
  if (!root)
    refuse("NOT_IN_PROJECT", "create needs a project path (ENFUSION_PROJECT_PATH or projectPath)");
  const { file, rel } = projectFile(need(a.path, "path", "create"), root);
  needExt(rel, ".st", "path");
  const cls = a.itemClass ?? DEFAULT_ITEM_CLASS;
  if (!IDENT.test(cls)) refuse("INVALID_ARGUMENT", `itemClass is not a class name: ${cls}`);
  const warnings: string[] = [OD5_WARNING, UNPROVEN_WARNING];
  const planned = a.items && a.items.length > 0 ? planItems(a.items, warnings) : [];
  const eol = "\n";
  const body = planned.map((p) => formatItemText(cls, p.fields, "  ", " ", eol));
  // W3 live run 3 (P-W3-21): a table written without ItemClassName did not load ("LocalizationEditor:
  // Can't find StringTableItem class 'StringTableItem'"), while byte copies of the editor's own
  // File > New table, which starts `StringTable {` / ` ItemClassName "CustomStringTableItem"`, did.
  const text = `StringTable {${eol} ItemClassName "${cls}"${eol} Items {${eol}${body.map((b) => b + eol).join("")} }${eol}}`;
  // Read it back before anything is written: the announced items are the ones the parser finds.
  const check = readSt(parseCstBytes(Buffer.from(text, "utf8")));
  if (check.list.length !== planned.length || check.list.some((it, i) => it.id !== planned[i].id)) {
    refuse(
      "INVALID_ARGUMENT",
      "the table to write does not read back as the items given; nothing written",
    );
  }
  let before: unknown = null;
  let oldText = "";
  if (existsSync(file)) {
    if (a.overwrite !== true) {
      refuse("INVALID_ARGUMENT", `${rel} already exists; pass overwrite: true to replace it`);
    }
    const existing = loadSt(rel, root);
    oldText = existing.doc.text;
    before = { items: existing.table.list.length, bytes: existing.buf.length };
    warnings.push(
      `overwrite: the ${existing.table.list.length} item(s) of the existing table are replaced by the items given.`,
    );
  }
  const changed: Change[] = [
    { path: rel, before, after: { items: planned.length, bytes: Buffer.byteLength(text) } },
  ];
  return dryOrWrite({
    action: "create",
    rel,
    file,
    oldText,
    splices: [{ start: 0, end: oldText.length, text }],
    newText: text,
    changed,
    warnings,
    confirm: a.confirm === true,
    summary: { items: planned.map((p) => p.id), itemClass: cls },
  });
}

function actionUpsert(root: string | undefined, a: StringTableArgs): ActionOk {
  if (!root)
    refuse("NOT_IN_PROJECT", "upsert needs a project path (ENFUSION_PROJECT_PATH or projectPath)");
  const loaded = loadSt(need(a.path, "path", "upsert"), root);
  const warnings: string[] = [OD5_WARNING, UNPROVEN_WARNING];
  const planned = planItems(a.items, warnings);
  const { doc, table } = loaded;
  const text = doc.text;
  const eol = eolOf(doc);
  const unit = (indentAt(text, (table.items ?? table.root).start) ?? "").includes("\t")
    ? "\t"
    : " ";
  const byId = new Map<string, Item[]>();
  for (const it of table.list) byId.set(it.id, [...(byId.get(it.id) ?? []), it]);

  const splices: Splice[] = [];
  const changed: Change[] = [];
  const expected = modelOf(table);
  const added: string[] = [];
  const updated: string[] = [];
  const unchanged: string[] = [];
  const newItems: string[] = [];
  const itemClass = a.itemClass ?? table.list[table.list.length - 1]?.cls ?? DEFAULT_ITEM_CLASS;
  if (!IDENT.test(itemClass))
    refuse("INVALID_ARGUMENT", `itemClass is not a class name: ${itemClass}`);
  const itemIndent = table.list.length
    ? (indentAt(text, table.list[table.list.length - 1].node.start) ?? "")
    : table.items
      ? (indentAt(text, table.items.start) ?? "") + unit
      : unit + unit;

  for (const p of planned) {
    const hits = byId.get(p.id) ?? [];
    if (hits.length > 1) {
      refuse(
        "DUPLICATE_ID",
        `Id ${p.id} appears ${hits.length} times in the table; remove the extras first`,
      );
    }
    if (hits.length === 0) {
      const live = p.fields.filter(
        (f) => f.value !== undefined && (f.key === "Id" || f.kind !== "text" || f.value !== ""),
      );
      newItems.push(formatItemText(itemClass, p.fields, itemIndent, unit, eol));
      expected.push({
        cls: itemClass,
        fields: live.map((f): [string, string] => [f.key, f.value as string]),
      });
      added.push(p.id);
      changed.push({
        path: `Items[${p.id}]`,
        before: null,
        after: Object.fromEntries(live.map((f) => [f.key, f.value])),
      });
      continue;
    }
    const it = hits[0];
    const model = expected[it.index];
    const append: PlannedField[] = [];
    let touched = false;
    for (const f of p.fields) {
      if (f.key === "Id") continue;
      const cur = it.fields.find((x) => x.key === f.key);
      if (it.repeated.includes(f.key)) {
        refuse(
          "INVALID_ARGUMENT",
          `Item ${p.id}: ${f.key} appears more than once in the file; edit it in the Localization Editor`,
        );
      }
      if (cur?.block)
        refuse(
          "INVALID_ARGUMENT",
          `Item ${p.id}: ${f.key} is a block (an array); this writer does not edit blocks`,
        );
      if (cur?.irregular)
        refuse(
          "INVALID_ARGUMENT",
          `Item ${p.id}: ${f.key} holds text this writer would not reproduce; left alone`,
        );
      if (f.value === undefined) {
        if (!cur) continue;
        const span = wholeLines(
          text,
          cur.entries[0].start,
          cur.entries[cur.entries.length - 1].end,
        );
        if (!span)
          refuse(
            "INVALID_ARGUMENT",
            `Item ${p.id}: ${f.key} shares its line with other text; cannot remove it cleanly`,
          );
        splices.push({ start: span[0], end: span[1], text: "" });
        model.fields = model.fields.filter(([k]) => k !== f.key);
        changed.push({ path: `Items[${p.id}].${f.key}`, before: cur.text, after: null });
        touched = true;
        continue;
      }
      if (!cur) {
        if (f.kind === "text" && f.value === "") continue;
        append.push(f);
        model.fields.push([f.key, f.value]);
        changed.push({ path: `Items[${p.id}].${f.key}`, before: null, after: f.value });
        touched = true;
        continue;
      }
      if (normValue(f.key, cur.text) === f.value) continue;
      const fieldIndent = indentAt(text, cur.entries[0].start) ?? "";
      const enc = valueText(f, f.value, cur.quoted && f.kind !== "text", eol, fieldIndent);
      if (cur.valueStart === cur.valueEnd) {
        splices.push({ start: cur.entries[0].end, end: cur.entries[0].end, text: ` ${enc}` });
      } else {
        splices.push({ start: cur.valueStart, end: cur.valueEnd, text: enc });
      }
      const slot = model.fields.find(([k]) => k === f.key);
      if (slot) slot[1] = f.value;
      changed.push({ path: `Items[${p.id}].${f.key}`, before: cur.text, after: f.value });
      touched = true;
    }
    if (append.length > 0) {
      const last = it.fields[it.fields.length - 1];
      const fi = last
        ? (indentAt(text, last.entries[0].start) ?? itemIndent + unit)
        : itemIndent + unit;
      const lines = append
        .map((f) => `${fi}${f.key} ${valueText(f, f.value as string, false, eol, fi)}`)
        .join(eol);
      splices.push(appendInBlock(doc, it.node, lines, eol));
    }
    (touched ? updated : unchanged).push(p.id);
  }
  if (newItems.length > 0) {
    if (table.items) {
      splices.push(appendInBlock(doc, table.items, newItems.join(eol), eol));
    } else {
      const ri = indentAt(text, table.root.start) ?? "";
      const ind = ri + unit;
      const items = planned
        .filter((p) => added.includes(p.id))
        .map((p) => formatItemText(itemClass, p.fields, ind + unit, unit, eol));
      splices.push(
        appendInBlock(doc, table.root, `${ind}Items {${eol}${items.join(eol)}${eol}${ind}}`, eol),
      );
    }
  }
  const newText = applySplices(text, splices);
  const after = readSt(parseCstBytes(Buffer.from(newText, "utf8")));
  if (!sameModel(modelOf(after), expected)) {
    refuse("INVALID_ARGUMENT", "the edited table does not read back as announced; nothing written");
  }
  if (splices.length === 0) {
    return ok(
      "upsert",
      `path:${loaded.rel}`,
      [],
      {
        written: false,
        dryRun: a.confirm !== true,
        added,
        updated,
        unchanged,
        note: "nothing to change",
      },
      undefined,
      warnings,
    );
  }
  return dryOrWrite({
    action: "upsert",
    rel: loaded.rel,
    file: loaded.file,
    oldText: text,
    splices,
    newText,
    changed,
    warnings,
    confirm: a.confirm === true,
    summary: { added, updated, unchanged, items: after.list.length },
  });
}

function actionRemove(root: string | undefined, a: StringTableArgs): ActionOk {
  if (!root)
    refuse("NOT_IN_PROJECT", "remove needs a project path (ENFUSION_PROJECT_PATH or projectPath)");
  const loaded = loadSt(need(a.path, "path", "remove"), root);
  const ids = need(a.ids, "ids", "remove");
  if (ids.length === 0) refuse("INVALID_ARGUMENT", "remove needs at least one id");
  const warnings: string[] = [OD5_WARNING, UNPROVEN_WARNING];
  const { doc, table } = loaded;
  const text = doc.text;
  const want = new Set(ids);
  const missing = [...want].filter((id) => !table.list.some((it) => it.id === id));
  if (missing.length > 0) {
    refuse("ITEM_NOT_FOUND", `no item with Id: ${missing.join(", ")}; nothing was changed`);
  }
  const splices: Splice[] = [];
  const changed: Change[] = [];
  const hit = table.list.filter((it) => want.has(it.id));
  for (const it of hit) {
    const span = wholeLines(text, it.node.start, it.node.end);
    if (!span)
      refuse(
        "INVALID_ARGUMENT",
        `Item ${it.id} shares its lines with other text; cannot remove it cleanly`,
      );
    splices.push({ start: span[0], end: span[1], text: "" });
    changed.push({ path: `Items[${it.id}]`, before: snapshot(it), after: null });
  }
  if (hit.length > want.size)
    warnings.push(`${hit.length - want.size} extra item(s) with a repeated Id were removed too.`);
  const expected = modelOf(table).filter((_, i) => !want.has(table.list[i].id));
  const newText = applySplices(text, splices);
  const after = readSt(parseCstBytes(Buffer.from(newText, "utf8")));
  if (!sameModel(modelOf(after), expected)) {
    refuse("INVALID_ARGUMENT", "the edited table does not read back as announced; nothing written");
  }
  return dryOrWrite({
    action: "remove",
    rel: loaded.rel,
    file: loaded.file,
    oldText: text,
    splices,
    newText,
    changed,
    warnings,
    confirm: a.confirm === true,
    summary: { removed: hit.map((i) => i.id), items: after.list.length },
  });
}

/** Which column of an item a language's runtime text comes from (SCR_LocExportPlugin.GetExportColumn). */
export function exportColumn(item: Item, lang: string): string | undefined {
  if (["1", "true"].includes(fieldText(item, "Hidden"))) return undefined;
  if (lang === "en_us") {
    return fieldText(item, "Target_en_us_edited") !== "" ? "Target_en_us_edited" : "Target_en_us";
  }
  return fieldText(item, `Target_${lang}`) === "" ? "Target_en_us" : `Target_${lang}`;
}

/** The runtime table (Ids sorted, Texts aligned) one language of a string table builds. */
export function buildRuntimeOf(
  table: StTable,
  lang: string,
): { ids: string[]; texts: string[]; skippedHidden: number; duplicates: string[] } {
  const rows: { id: string; text: string }[] = [];
  const seen = new Set<string>();
  const duplicates: string[] = [];
  let skippedHidden = 0;
  for (const it of table.list) {
    const col = exportColumn(it, lang);
    if (col === undefined) {
      skippedHidden++;
      continue;
    }
    if (it.id === "") continue;
    if (seen.has(it.id)) {
      duplicates.push(it.id);
      continue;
    }
    seen.add(it.id);
    rows.push({ id: it.id, text: fieldText(it, col) });
  }
  rows.sort((x, y) => idOrder(x.id, y.id));
  return { ids: rows.map((r) => r.id), texts: rows.map((r) => r.text), skippedHidden, duplicates };
}

function actionBuildRuntime(root: string | undefined, a: StringTableArgs): ActionOk {
  if (!root)
    refuse(
      "NOT_IN_PROJECT",
      "buildRuntime needs a project path (ENFUSION_PROJECT_PATH or projectPath)",
    );
  const loaded = loadSt(need(a.path, "path", "buildRuntime"), root);
  const warnings: string[] = [UNPROVEN_WARNING];
  const stem = basename(loaded.rel, extname(loaded.rel));
  const outRel =
    a.outDir !== undefined
      ? checkRelativePath(a.outDir).replace(/\/+$/, "")
      : forward(dirname(loaded.rel));
  const present = languageColumns(loaded.table)
    .filter((l) => l.filled + l.edited > 0)
    .map((l) => l.code);
  const langs = a.languages ?? [...new Set(["en_us", ...present])];
  if (langs.length === 0) refuse("INVALID_ARGUMENT", "languages is empty");
  for (const l of langs)
    if (!LANG.test(l)) refuse("INVALID_ARGUMENT", `not a language code (xx_yy): ${l}`);
  if (new Set(langs).size !== langs.length)
    refuse("INVALID_ARGUMENT", "languages lists a code twice");

  interface Out {
    lang: string;
    rel: string;
    file: string;
    text: string;
    ids: string[];
    texts: string[];
  }
  const outs: Out[] = [];
  for (const lang of langs) {
    const built = buildRuntimeOf(loaded.table, lang);
    const { file, rel } = projectFile(
      `${outRel === "." || outRel === "" ? "" : outRel + "/"}${stem}.${lang}.conf`,
      root,
    );
    if (rel === loaded.rel)
      refuse("INVALID_ARGUMENT", "the output would overwrite the source table");
    if (built.duplicates.length > 0 && lang === langs[0]) {
      warnings.push(
        `Duplicate Ids kept once (first wins): ${[...new Set(built.duplicates)].join(", ")}`,
      );
    }
    if (built.skippedHidden > 0 && lang === langs[0]) {
      warnings.push(
        `${built.skippedHidden} Hidden item(s) are left out (SCR_LocExportPlugin without LOCALIZATION_BUILD_HIDDEN).`,
      );
    }
    outs.push({
      lang,
      rel,
      file,
      text: emitRuntime(built.ids, built.texts),
      ids: built.ids,
      texts: built.texts,
    });
  }
  // Nothing is written unless every output may be.
  const existing: string[] = [];
  const files: Record<string, unknown>[] = [];
  const changed: Change[] = [];
  for (const o of outs) {
    let before: { ids: number; bytes: number } | null = null;
    let diffSummary: Record<string, unknown> = {};
    if (existsSync(o.file)) {
      existing.push(o.rel);
      if (a.overwrite === true) {
        const buf = readFileSync(o.file);
        const doc = parseCstBytes(buf);
        if (
          doc.base.kind !== "object" ||
          doc.base.key !== "StringTableRuntime" ||
          !doc.toBytes().equals(buf)
        ) {
          refuse(
            "INVALID_ARGUMENT",
            `${o.rel} exists and is not a runtime string table this writer can reproduce; it is left alone`,
          );
        }
        const old = readRuntime(doc);
        before = { ids: old.ids.length, bytes: buf.length };
        const oldMap = new Map(old.ids.map((id, i) => [id, old.texts[i]]));
        const newMap = new Map(o.ids.map((id, i) => [id, o.texts[i]]));
        const addedIds = o.ids.filter((id) => !oldMap.has(id));
        const removedIds = old.ids.filter((id) => !newMap.has(id));
        const changedIds = o.ids.filter(
          (id) => oldMap.has(id) && oldMap.get(id) !== newMap.get(id),
        );
        diffSummary = {
          added: addedIds.length,
          removed: removedIds.length,
          changed: changedIds.length,
          examples: {
            added: addedIds.slice(0, 5),
            removed: removedIds.slice(0, 5),
            changed: changedIds
              .slice(0, 5)
              .map((id) => ({ Id: id, before: oldMap.get(id), after: newMap.get(id) })),
          },
        };
      }
    }
    changed.push({
      path: o.rel,
      before,
      after: { ids: o.ids.length, bytes: Buffer.byteLength(o.text) },
    });
    files.push({
      language: o.lang,
      path: o.rel,
      ids: o.ids.length,
      emptyTexts: o.texts.filter((t) => t === "").length,
      replaces: before !== null,
      ...diffSummary,
    });
  }
  if (existing.length > 0 && a.overwrite !== true) {
    refuse(
      "INVALID_ARGUMENT",
      `already exists: ${existing.join(", ")}; pass overwrite: true to replace ${existing.length === 1 ? "it" : "them"}`,
    );
  }
  // Read each output back before writing: it must hold the ids and texts announced.
  for (const o of outs) {
    const rt = readRuntime(parseCstBytes(Buffer.from(o.text, "utf8")));
    if (
      JSON.stringify(rt.ids) !== JSON.stringify(o.ids) ||
      JSON.stringify(rt.texts) !== JSON.stringify(o.texts)
    ) {
      refuse(
        "INVALID_ARGUMENT",
        `the ${o.lang} table does not read back as built; nothing written`,
      );
    }
  }
  const confirm = a.confirm === true;
  if (confirm) for (const o of outs) writeVerified(o.file, Buffer.from(o.text, "utf8"));
  return ok(
    "buildRuntime",
    `path:${loaded.rel}`,
    changed,
    { written: confirm, dryRun: !confirm, source: loaded.rel, files },
    confirm
      ? "Register the runtime tables in the project (gproj StringTables) and check them in the game; the engine-accept proof is probe P-W3-21."
      : CONFIRM_NEXT,
    warnings,
  );
}

// ── Entry point ──────────────────────────────────────────────────────────────

export function runStringTable(config: Config, args: StringTableArgs): StringTableResponse {
  const target = args.path !== undefined ? `path:${args.path}` : "";
  try {
    const root = pinnedProjectRoot(args.projectPath, config.projectPath);
    switch (args.action) {
      case "inspect":
        return actionInspect(readSource(need(args.path, "path", "inspect"), root, config), target);
      case "get":
        return actionGet(readSource(need(args.path, "path", "get"), root, config), target, args);
      case "lint":
        return actionLint(readSource(need(args.path, "path", "lint"), root, config), target, args);
      case "lookup":
        return actionLookup(config, root, args);
      case "create":
        return actionCreate(root, args);
      case "upsert":
        return actionUpsert(root, args);
      case "remove":
        return actionRemove(root, args);
      case "buildRuntime":
        return actionBuildRuntime(root, args);
      default:
        return refuse("INVALID_ARGUMENT", `unknown action ${String(args.action)}`);
    }
  } catch (e) {
    if (e instanceof VocabularyError) return errorResponse(args.action, target, e.code, e.message);
    return errorResponse(
      args.action,
      target,
      "HANDLER_ERROR",
      e instanceof Error ? e.message : String(e),
    );
  }
}

export const STRING_TABLE_DESCRIPTION =
  "Offline string tables as files: .st (StringTable/Items) and runtime .conf (Ids/Texts). " +
  "Read: inspect, get, lint, lookup (base-game Language/*.conf, 13 languages). " +
  "Write, project only, dry run unless confirm:true: create, upsert, remove, buildRuntime (<name>.<lang>.conf, SCR_LocExportPlugin rules). " +
  "Refuses files it cannot rewrite byte-exact.";

export function registerStringTable(server: McpServer, config: Config): void {
  server.registerTool(
    "string_table",
    {
      description: STRING_TABLE_DESCRIPTION,
      inputSchema: {
        action: z.enum(STRING_TABLE_ACTIONS),
        path: z
          .string()
          .optional()
          .describe(
            "A .st or runtime .conf: project-relative, or a game resource path (read only). lookup: a runtime table (default Language/localization.en_us.conf).",
          ),
        prefix: z.string().optional().describe("get/lookup: Ids that start with this."),
        ids: z
          .array(z.string())
          .optional()
          .describe("get/lookup: exact Ids. remove: the Ids to remove."),
        fields: z
          .string()
          .optional()
          .describe("get (.st): comma list of columns, or *. Default Id,Target_en_us."),
        cursor: z.string().optional().describe("Paging: the next value an earlier reply gave."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(LIMIT_MAX)
          .optional()
          .describe("Rows per page (default 100)."),
        languages: z
          .array(z.string())
          .optional()
          .describe("lookup/buildRuntime: language codes such as en_us."),
        items: z
          .array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])))
          .optional()
          .describe(
            "create/upsert: [{Id, Target_en_us, Status, ...}]; null removes a field on upsert.",
          ),
        itemClass: z
          .string()
          .optional()
          .describe("create/upsert: item class (default CustomStringTableItem)."),
        outDir: z
          .string()
          .optional()
          .describe(
            "buildRuntime: project folder for the .conf files (default: the .st's folder).",
          ),
        overwrite: z.boolean().optional().describe("create/buildRuntime: replace existing files."),
        confirm: z
          .boolean()
          .optional()
          .describe("Write. Without it a write action only answers the change."),
        projectPath: z
          .string()
          .optional()
          .describe("Addon root. Uses the configured project when omitted."),
      },
    },
    async (args) => {
      const clean = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined));
      return toToolResult(runStringTable(config, clean as unknown as StringTableArgs));
    },
  );
}
