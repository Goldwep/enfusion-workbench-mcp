/**
 * E12 — API-index reconcile (plan 4.5; plan 2.1 finding 3; DEC-018).
 *
 * The scraped API index (`data/api/enfusion-classes.json` and
 * `arma-classes.json`, Bohemia's Doxygen output read by `src/scraper/`, served
 * by `api_search`) against the E02 source index (every class and method of
 * the 6,568 script files in the game paks). Plan Phase 1 item 1 wants the full
 * list of declarations the index lost before the scraper is repaired; this
 * enumerator produces it. It repairs nothing.
 *
 * Two outputs:
 *
 *  1. Observation rows (`data/census/observations/E12/<build>.jsonl`) for the
 *     Workbench API scope only (the seven folders of E02's `WORKBENCH_SCOPE`,
 *     DEC-018): a class row for every index class whose class is declared in
 *     those folders, and a method / static-method / event row for every index
 *     entry of such a class that is a declaration of that class. Keys are
 *     E02's ({class}, {class, method, arity}) so the rows merge; module and
 *     kind are E02's for the same id (module `none` where E02 has no row). The
 *     ref is `<repo>/data/api/<file>#L<line>` of the entry's `"name"` line in
 *     the JSON file as stored, and the quote is that line. An index entry that
 *     the source does not confirm is emitted under the key the index gives it
 *     and so shows up as a row E02 does not have.
 *  2. A diff report in the artifacts folder
 *     (`census/<build>/E12/api-index-diff.json`): for every class of the source
 *     index (all script modules), methods in source but not in the index,
 *     methods in the index but not in source, classes missing from the index,
 *     classes in the index the source does not declare, signature differences,
 *     per-script-module totals, the classes with the largest losses, and a scan
 *     of all script files for Doxygen block typos (`/endcode` and similar
 *     unterminated `\code` blocks) with file and line, offered as the cause of
 *     each loss.
 *
 * How the two sides are read
 *  - The index file is parsed by a small JSON reader that keeps the line of
 *    every `"name"` key as the file stores it (`ref`, `quote`).
 *  - An index method's `name` field is Doxygen's anchor (name plus parameter
 *    types: `SetDebugint`), so the method name is read from `signature`. The
 *    arity is the parameter count the signature states, counting a generic's
 *    comma (`map< K, V >`) as one: the scraper splits that comma and its
 *    `params` array then holds one entry too many (and it drops the last one
 *    after a default that holds a call, `Color.FromInt(Color.WHITE)`), so
 *    `params.length` is kept apart (`params_length`) and is never the arity. The header's input hashes
 *    are taken over the text with CRLF read as LF, so they equal the hash of
 *    the committed blob on any checkout.
 *  - The index lists inherited members under each derived class. An entry that
 *    matches no method of the class itself but one of an ancestor's is an
 *    inherited listing, not a declaration of that class: it is counted and left
 *    out of the rows. An entry matching nothing in the chain is emitted.
 *  - The index does not carry `event` (Doxygen drops the word); an entry that
 *    pairs with a source `event` method takes kind `event`, so the row does not
 *    contradict E02 on something the index cannot say. A real disagreement
 *    (static versus instance) is emitted as the index says it.
 *  - Source methods Doxygen does not extract are not counted as losses:
 *    `private` ones and ones declared in a `modded class` are reported apart.
 *  - A source class with no index page of its exact name is read against the
 *    one index page whose name differs only in case and is not itself the name
 *    of a source class (Doxygen writes the script class `typename` as
 *    `TypeName`). With two such pages, or a twin that is a source class, it
 *    stays missing. `indexClassLookup` is the twin of `indexByName` in
 *    `src/scraper/backfill.ts`; the two must agree. The paired page is not an
 *    index class the source lacks; the report's `class_name_pairs` lists the
 *    pairs made (`paired: true`) and the ones refused.
 *  - A guarded source method with no index entry, whose class holds a
 *    same-named method matched in the index from the opposite branch of one of
 *    its guards (`#ifndef X` against its `#else`, `#ifdef X` against
 *    `#ifndef X`), is an inactive-branch alternative: the index has the method
 *    from one of the two branches. Only the name is compared, not the arity (a
 *    `DISABLE_*` stub may take other parameters than the real body). When both
 *    bodies have the same signature the data does not show which branch Doxygen
 *    read; the one that comes later in the file is the one reported as the
 *    alternative. Guards are compared as text, so `#ifdef X` and
 *    `#if !defined(X)` are not opposites. It has the cause `inactive-branch-alternative`,
 *    is not in `lost_total` or `loss_causes`, and is reported as its own
 *    headline count (`methods.inactive_branch_alternatives`) with every method
 *    listed, by guard and by class, under `inactive_branch_alternatives` in the
 *    report. A sibling in the same branch, under another guard, unguarded or
 *    itself without an index entry does not qualify. This is the withholding
 *    rule of `src/scraper/backfill.ts` (`lostMethods`), which the backfill
 *    reports as `withheld`.
 *  - The method name comes from `signature`; the `name` field of an entry is
 *    read only when the signature has no `(` (no entry of the committed index
 *    is like that), so no count depends on `name`.
 *
 *   npx tsx scripts/census/enumerators/e12-api-index.ts [--build <tag>] [--data <dir>]
 *       [--api-dir <dir>] [--source-index <file>] [--game <dir>] [--out <file under observations/E12/>]
 *       [--artifacts <dir>] [--no-artifacts] [--json]
 *
 * --api-dir       default <repo>/data/api
 * --source-index  default <artifacts>/census/<build>/E02/source-index.jsonl (built from the paks when absent)
 * --game          game install for the comment scan (default ENFUSION_GAME_PATH); without it the scan is skipped
 *
 * Exit: 0 written; 1 refused (--out outside observations/E12/) or a row failed
 * the schema; 2 usage or no data (NO DATA); 3 malformed census configuration.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { compareCodeUnits, jsonlLine, sha256 } from "../../../src/census/canon.js";
import { loadCurrentBuild } from "../../../src/census/census-config.js";
import { firstSentence } from "../../../src/census/enforce-source.js";
import { containsMachinePath } from "../../../src/census/hygiene.js";
import { deriveId } from "../../../src/census/ids.js";
import { writeFileAtomic, type CensusPaths } from "../../../src/census/ledger-io.js";
import { observationSchema, type Observation } from "../../../src/census/schemas.js";
import {
  buildSourceIndex,
  loadSourceIndex,
  methodsOf,
  saveSourceIndex,
  sourceIndexPath,
  type ClassRecord,
  type MergedClass,
  type MethodRecord,
  type SourceIndex,
} from "../../../src/census/source-index.js";
import { MODULES, type Module } from "../../../src/census/vocab.js";
import { loadConfig } from "../../../src/config.js";
import { PakVirtualFS } from "../../../src/pak/vfs.js";
import { artifactsDir } from "../../live/paths.js";
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
export const ENUMERATOR_ID = "E12";
/** Registered generator path (must equal universes.json `enumerators.E12.generator`). */
export const GENERATOR = "scripts/census/enumerators/e12-api-index.ts";
const QUOTE_MAX = 200;
const WHAT_MAX = 400;
/** Names of the two index files, in the order they are read. */
export const API_FILES = ["enfusion-classes.json", "arma-classes.json"] as const;

/** The seven folders of the Workbench API scope (DEC-018); a test keeps this equal to E02's list. */
export const WORKBENCH_SCOPE = [
  "scripts/Core/generated/WorkbenchAPI/",
  "scripts/GameLib/generated/WorkbenchAPI/",
  "scripts/GameLib/workbench/",
  "scripts/Workbench/",
  "scripts/WorkbenchCommon/",
  "scripts/WorkbenchGame/",
  "scripts/WorkbenchGameCommon/",
] as const;

export function inWorkbenchScope(path: string): boolean {
  const p = path.replace(/\\/g, "/").toLowerCase();
  return WORKBENCH_SCOPE.some((s) => p.startsWith(s.toLowerCase()));
}

// ── JSON reader that keeps the stored line of every "name" key ───────────────

/** Line (1-based, counted in `\n` as the ledger's ref check counts) and trimmed text of a `"name"` key line. */
export interface NameLine {
  line: number;
  text: string;
}

export interface LineParsed {
  value: unknown;
  /** For every object that has a `name` key: where that key sits. */
  nameLines: WeakMap<object, NameLine>;
}

/**
 * Parses JSON text and records, for every object with a `name` key, the line
 * and text of that key (so a ref can point at the entry as stored). Strict
 * enough for `JSON.stringify` output; throws on anything malformed.
 */
export function parseJsonWithNameLines(input: string): LineParsed {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const nameLines = new WeakMap<object, NameLine>();
  const n = text.length;
  let pos = 0;
  let line = 1;
  let lineStart = 0;
  const NUMBER = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

  const fail = (msg: string): never => {
    throw new Error(`JSON parse error at line ${line}: ${msg}`);
  };
  const skip = (): void => {
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        line++;
        pos++;
        lineStart = pos;
      } else if (c === 32 || c === 13 || c === 9) pos++;
      else break;
    }
  };
  const str = (): string => {
    const open = pos;
    let from = pos + 1;
    for (;;) {
      const q = text.indexOf('"', from);
      if (q < 0) return fail("unterminated string");
      let b = 0;
      for (let j = q - 1; j > open && text.charCodeAt(j) === 92; j--) b++;
      if (b % 2 === 0) {
        const raw = text.slice(open + 1, q);
        pos = q + 1;
        return raw.includes("\\") ? (JSON.parse(`"${raw}"`) as string) : raw;
      }
      from = q + 1;
    }
  };
  const value = (): unknown => {
    skip();
    const c = text[pos];
    if (c === "{") {
      pos++;
      const obj: Record<string, unknown> = {};
      skip();
      if (text[pos] === "}") {
        pos++;
        return obj;
      }
      for (;;) {
        skip();
        if (text[pos] !== '"') return fail("object key expected");
        const keyLine = line;
        const keyStart = lineStart;
        const key = str();
        if (key === "name" && !nameLines.has(obj)) {
          let end = text.indexOf("\n", pos);
          if (end < 0) end = n;
          nameLines.set(obj, {
            line: keyLine,
            text: text.slice(keyStart, end).trim().slice(0, QUOTE_MAX),
          });
        }
        skip();
        if (text[pos] !== ":") return fail("':' expected");
        pos++;
        obj[key] = value();
        skip();
        if (text[pos] === ",") {
          pos++;
          continue;
        }
        if (text[pos] === "}") {
          pos++;
          return obj;
        }
        return fail("',' or '}' expected");
      }
    }
    if (c === "[") {
      pos++;
      const arr: unknown[] = [];
      skip();
      if (text[pos] === "]") {
        pos++;
        return arr;
      }
      for (;;) {
        arr.push(value());
        skip();
        if (text[pos] === ",") {
          pos++;
          continue;
        }
        if (text[pos] === "]") {
          pos++;
          return arr;
        }
        return fail("',' or ']' expected");
      }
    }
    if (c === '"') return str();
    if (text.startsWith("true", pos)) {
      pos += 4;
      return true;
    }
    if (text.startsWith("false", pos)) {
      pos += 5;
      return false;
    }
    if (text.startsWith("null", pos)) {
      pos += 4;
      return null;
    }
    NUMBER.lastIndex = pos;
    const m = NUMBER.exec(text);
    if (!m) return fail("value expected");
    pos += m[0].length;
    return Number(m[0]);
  };

  const v = value();
  skip();
  if (pos < n) fail("trailing text");
  return { value: v, nameLines };
}

// ── The API index model ──────────────────────────────────────────────────────

export type ApiArray = "methods" | "protectedMethods" | "staticMethods";

export interface ApiMethod {
  /** The index file the entry is in. */
  file: string;
  array: ApiArray;
  /** The index's `name` field (Doxygen anchor: name plus parameter types). */
  raw_name: string;
  /** Method name read from `signature`. */
  name: string;
  /** Parameters the `signature` states (generic-aware: `map< K, V >` is one): the arity of the key. */
  arity: number;
  /** `params.length`: larger than `arity` when the scraper split a generic's comma, smaller when it cut a default such as `Color.FromInt(Color.WHITE)` short. */
  params_length: number;
  static: boolean;
  protected: boolean;
  /** Leading modifier words of `returnType` (`proto`, `external`, `static`, ...). */
  modifiers: string[];
  /** `returnType` without the modifier words. */
  return_type: string;
  signature: string;
  /** The `type` of each parameter, modifiers included (`out float`). */
  param_types: string[];
  description: string;
  /** Line of the entry's `"name"` key in the file as stored. */
  line: number;
  /** Trimmed text of that line. */
  quote: string;
}

export interface ApiClass {
  /** `enfusion-classes.json` or `arma-classes.json`. */
  file: string;
  raw_name: string;
  /** Name with Doxygen's page-title suffix and template parameters removed. */
  name: string;
  /** True when `raw_name` is not the class name (`Tuple1< Class T1 > Interface Template Reference`). */
  mangled: boolean;
  line: number;
  quote: string;
  description: string;
  methods: ApiMethod[];
  counts: { public: number; protected: number; static: number };
}

export interface ApiIndexFile {
  file: string;
  sha256: string;
  classes: ApiClass[];
}

const METHOD_MODIFIERS = new Set([
  "static",
  "proto",
  "native",
  "external",
  "override",
  "event",
  "private",
  "protected",
  "sealed",
  "volatile",
]);

/** sha256 of bytes with CRLF read as LF: equal for a CRLF working tree and the LF blob git commits. */
export function sha256Lf(bytes: Buffer): string {
  return sha256(Buffer.from(bytes.toString("latin1").replace(/\r\n/g, "\n"), "latin1"));
}

/** Class name behind a Doxygen page title: drops the title suffix and the template parameter list. */
export function normalizeClassName(raw: string): string {
  const t = raw
    .replace(/\s*(?:Interface|Class)?\s*Template Reference\s*$/, "")
    .replace(/\s*(?:Interface|Class) Reference\s*$/, "")
    .trim();
  const lt = t.indexOf("<");
  return (lt > 0 ? t.slice(0, lt) : t).trim();
}

/** Method name of a signature: the identifier before the first `(`. */
export function signatureName(signature: string): string | undefined {
  const i = signature.indexOf("(");
  if (i < 0) return undefined;
  return /(~?[A-Za-z_]\w*)\s*$/.exec(signature.slice(0, i))?.[1];
}

/** The parameter texts of a signature, a generic's commas (`map< string, int >`) not splitting; empty segments dropped. */
export function splitSignatureParams(signature: string): string[] {
  const i = signature.indexOf("(");
  if (i < 0) return [];
  const out: string[] = [];
  let depth = 0;
  let quote = false;
  let from = i + 1;
  let end = signature.length;
  for (let j = i + 1; j < signature.length; j++) {
    const ch = signature[j];
    if (quote) {
      if (ch === "\\") j++;
      else if (ch === '"') quote = false;
      continue;
    }
    if (ch === '"') quote = true;
    else if (ch === "(" || ch === "[" || ch === "{" || ch === "<") depth++;
    else if (ch === "]" || ch === "}" || ch === ">") depth = Math.max(0, depth - 1);
    else if (ch === ")") {
      if (depth === 0) {
        end = j;
        break;
      }
      depth--;
    } else if (ch === "," && depth === 0) {
      out.push(signature.slice(from, j));
      from = j + 1;
    }
  }
  out.push(signature.slice(from, end));
  return out.map((t) => t.trim()).filter((t) => t !== "");
}

/** Parameters in a signature, counting a generic's commas (`map< string, int >`) as one. */
export function signatureArity(signature: string): number {
  return splitSignatureParams(signature).length;
}

/** The type of one parameter text (`notnull map< K, V > m=null` gives `notnull map< K, V >`). */
function typeOfParam(text: string): string {
  let depth = 0;
  let quote = false;
  let cut = text.length;
  for (let j = 0; j < text.length; j++) {
    const ch = text[j];
    if (quote) {
      if (ch === "\\") j++;
      else if (ch === '"') quote = false;
      continue;
    }
    if (ch === '"') quote = true;
    else if (ch === "(" || ch === "[" || ch === "{" || ch === "<") depth++;
    else if (ch === ")" || ch === "]" || ch === "}" || ch === ">") depth = Math.max(0, depth - 1);
    else if (ch === "=" && depth === 0) {
      cut = j;
      break;
    }
  }
  return text
    .slice(0, cut)
    .trim()
    .replace(/\s+[A-Za-z_]\w*$/, "");
}

function stringField(o: Record<string, unknown>, key: string): string {
  const v = o[key];
  return typeof v === "string" ? v : "";
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** Reads one API index file's text into the model; throws when it is not an array of class objects. */
export function parseApiIndex(file: string, input: string | Buffer): ApiIndexFile {
  const bytes = typeof input === "string" ? Buffer.from(input, "utf-8") : input;
  const { value, nameLines } = parseJsonWithNameLines(bytes.toString("utf-8"));
  if (!Array.isArray(value)) throw new Error(`${file}: expected a JSON array of classes`);
  const classes: ApiClass[] = [];
  for (const c of value) {
    if (!c || typeof c !== "object" || Array.isArray(c))
      throw new Error(`${file}: a class entry is not an object`);
    const co = c as Record<string, unknown>;
    const raw = stringField(co, "name");
    const at = nameLines.get(co);
    if (!raw || !at) throw new Error(`${file}: a class entry has no name`);
    const methods: ApiMethod[] = [];
    const counts = { public: 0, protected: 0, static: 0 };
    for (const array of ["methods", "protectedMethods", "staticMethods"] as const) {
      for (const m of asArray(co[array])) {
        if (!m || typeof m !== "object") continue;
        const mo = m as Record<string, unknown>;
        const mat = nameLines.get(mo);
        const signature = stringField(mo, "signature");
        const rawName = stringField(mo, "name");
        if (!mat) continue;
        if (array === "methods") counts.public++;
        else if (array === "protectedMethods") counts.protected++;
        else counts.static++;
        const ret = stringField(mo, "returnType").trim().split(/\s+/).filter(Boolean);
        const modifiers: string[] = [];
        while (ret.length > 0 && METHOD_MODIFIERS.has(ret[0]))
          modifiers.push(ret.shift() as string);
        const params = asArray(mo.params);
        const sigParams = splitSignatureParams(signature);
        methods.push({
          file,
          array,
          raw_name: rawName,
          name: signatureName(signature) ?? rawName,
          arity: sigParams.length > 0 || params.length === 0 ? sigParams.length : params.length,
          params_length: params.length,
          static: array === "staticMethods" || modifiers.includes("static"),
          protected: array === "protectedMethods",
          modifiers,
          return_type: ret.join(" "),
          signature,
          // The params array as the index holds it, unless it was split inside a generic: then the
          // types are read from the signature.
          param_types:
            params.length === sigParams.length || sigParams.length === 0
              ? params.map((p) =>
                  p && typeof p === "object"
                    ? stringField(p as Record<string, unknown>, "type")
                    : "",
                )
              : sigParams.map(typeOfParam),
          description: stringField(mo, "description"),
          line: mat.line,
          quote: mat.text,
        });
      }
    }
    const name = normalizeClassName(raw);
    classes.push({
      file,
      raw_name: raw,
      name,
      mangled: name !== raw,
      line: at.line,
      quote: at.text,
      description: stringField(co, "description"),
      methods,
      counts,
    });
  }
  return { file, sha256: sha256Lf(bytes), classes };
}

// ── The source side ──────────────────────────────────────────────────────────

const TYPE_LEAD_MODIFIERS = new Set(["out", "inout", "notnull", "const"]);
const TYPE_DROPPED = new Set(["ref", "autoptr", "owned"]);

/** A type for comparison: whitespace-insensitive, leading `out`/`inout`/`notnull`/`const` sorted, `ref`/`autoptr`/`owned` dropped. */
export function normalizeType(t: string): string {
  const tokens = t.trim().split(/\s+/).filter(Boolean);
  const lead: string[] = [];
  while (tokens.length > 0 && (TYPE_LEAD_MODIFIERS.has(tokens[0]) || TYPE_DROPPED.has(tokens[0]))) {
    const tok = tokens.shift() as string;
    if (TYPE_LEAD_MODIFIERS.has(tok)) lead.push(tok);
  }
  lead.sort();
  // Doxygen writes `typename` as `TypeName`.
  const core = tokens
    .join("")
    .replace(/\s+/g, "")
    .replace(/typename/gi, "typename");
  return [...lead, core].join(" ");
}

/** A return type for comparison: as `normalizeType`, without `notnull` (the source keeps it as a method modifier). */
export function normalizeReturn(t: string): string {
  return normalizeType(
    t
      .trim()
      .split(/\s+/)
      .filter((w) => w !== "notnull")
      .join(" "),
  );
}

export interface SrcMethod {
  rec: MethodRecord;
  name: string;
  arity: number;
  /** Declared in a `modded class` body. */
  modded: boolean;
  private: boolean;
  protected: boolean;
  static: boolean;
  event: boolean;
  ctor: boolean;
  /** Doxygen is expected to list it: not private, not in a modded class. */
  expected: boolean;
  ret: string;
  params: string[];
}

function srcMethodsOf(cls: MergedClass): SrcMethod[] {
  const out: SrcMethod[] = [];
  for (const m of cls.methods) {
    const decl = cls.declarations.find(
      (d) => d.file === m.file && m.line >= d.line && m.line <= d.end_line,
    );
    const modded = decl?.modded ?? false;
    const priv = m.modifiers.includes("private");
    out.push({
      rec: m,
      name: m.name,
      arity: m.arity,
      modded,
      private: priv,
      protected: m.modifiers.includes("protected"),
      static: m.modifiers.includes("static"),
      event: m.modifiers.includes("event"),
      ctor: m.is_constructor === true || m.is_destructor === true,
      expected: !priv && !modded,
      ret: normalizeReturn(m.return_type),
      params: m.params.map((p) => normalizeType([...p.modifiers, p.type].join(" "))),
    });
  }
  return out;
}

const idxRet = (m: ApiMethod): string => normalizeReturn(m.return_type);
const idxParams = (m: ApiMethod): string[] => m.param_types.map(normalizeType);
const methodKey = (name: string, arity: number): string => `${name}/${arity}`;
const sigKeySrc = (s: SrcMethod): string => [s.static ? 1 : 0, s.ret, s.params.join(",")].join("|");
const sigKeyIdx = (m: ApiMethod): string =>
  [m.static ? 1 : 0, idxRet(m), idxParams(m).join(",")].join("|");

// ── Doxygen block typo scan ──────────────────────────────────────────────────

const OPEN_RE =
  /([\\@])(code|verbatim|dot|msc|startuml|htmlonly|latexonly|xmlonly|manonly|rtfonly|docbookonly)\b/g;
const CLOSE_RE =
  /([\\@])(endcode|endverbatim|enddot|endmsc|enduml|endhtmlonly|endlatexonly|endxmlonly|endmanonly|endrtfonly|enddocbookonly)\b/g;
const SLASH_RE =
  /(^|[^\\@\w])\/(endcode|endverbatim|enddot|endmsc|enduml|endhtmlonly|endlatexonly|endxmlonly|endmanonly|endrtfonly|enddocbookonly)\b/g;
const BARE_RE = /(?<![\\@\w/])(endcode|endverbatim|enddot|endmsc|enduml)\b/g;
const QUICK_RE =
  /(?:code|verbatim|\bdot|\bmsc|uml|htmlonly|latexonly|xmlonly|manonly|rtfonly|docbookonly)\b/;
/** One Doxygen verbatim-style block that is not closed where it opens. */
export interface DocRegion {
  file: string;
  /** Line of the `\code` (or other opener) that is never closed in its own comment. */
  open_line: number;
  command: string;
  /** Lines of the typo tokens (`/endcode`, bare `endcode`) met while the block was open. */
  typo_lines: number[];
  /** Lines of further openers met while the block was open (Doxygen reads them as plain text). */
  reopened_lines: number[];
  /** Line of the first proper closer after the opener (`\endcode`), or null at end of file. */
  close_line: number | null;
}

export interface DocTypo {
  file: string;
  line: number;
  /** The token as written, e.g. `/endcode`. */
  token: string;
  kind: "slash" | "bare";
  /** Open line of the region the typo sits in, or null when no block was open there. */
  region_open_line: number | null;
}

export interface DocScan {
  files_scanned: number;
  files_with_typo: number;
  files_with_unterminated_block: number;
  typos: DocTypo[];
  regions: DocRegion[];
  /** A proper closer with no block open. */
  stray_closers: { file: string; line: number; token: string }[];
}

interface CommentState {
  inBlock: boolean;
}

/** Comment spans of one line, given whether a block comment is open at its start. */
function commentSpans(line: string, st: CommentState): [number, number][] {
  const spans: [number, number][] = [];
  let i = 0;
  const n = line.length;
  let start = st.inBlock ? 0 : -1;
  while (i < n) {
    if (st.inBlock) {
      const e = line.indexOf("*/", i);
      if (e < 0) {
        spans.push([start, n]);
        return spans;
      }
      spans.push([start, e + 2]);
      st.inBlock = false;
      i = e + 2;
      continue;
    }
    const ch = line[i];
    if (ch === '"') {
      i++;
      while (i < n && line[i] !== '"') i += line[i] === "\\" ? 2 : 1;
      i++;
    } else if (ch === "/" && line[i + 1] === "/") {
      spans.push([i, n]);
      return spans;
    } else if (ch === "/" && line[i + 1] === "*") {
      st.inBlock = true;
      start = i;
      i += 2;
    } else i++;
  }
  if (st.inBlock) spans.push([start, n]);
  return spans;
}

/**
 * Scans script files for Doxygen verbatim-style blocks (`\code` ... `\endcode`
 * and the like) that are not closed, and for the typos that cause it
 * (`/endcode`, a bare `endcode`). Doxygen reads a block as open until the next
 * proper closer, so a `\code` closed by `/endcode` swallows everything up to
 * the next `\endcode` (plan 2.1 finding 3). Only text inside comments counts.
 */
export function scanDocBlocks(files: Iterable<{ file: string; text: string }>): {
  scan: DocScan;
  byFile: Map<string, DocRegion[]>;
} {
  const scan: DocScan = {
    files_scanned: 0,
    files_with_typo: 0,
    files_with_unterminated_block: 0,
    typos: [],
    regions: [],
    stray_closers: [],
  };
  const byFile = new Map<string, DocRegion[]>();
  for (const f of files) {
    scan.files_scanned++;
    if (!QUICK_RE.test(f.text)) continue;
    const lines = f.text.split("\n");
    const st: CommentState = { inBlock: false };
    interface Tok {
      line: number;
      kind: "open" | "close" | "slash" | "bare";
      cmd: string;
      token: string;
      pos: number;
    }
    const toks: Tok[] = [];
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      const spans = commentSpans(line, st);
      if (spans.length === 0) continue;
      const inSpan = (p: number): boolean => spans.some(([a, b]) => p >= a && p < b);
      const collect = (re: RegExp, kind: Tok["kind"], group: number, prefixLen: boolean): void => {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(line)) !== null) {
          const at = m.index + (prefixLen ? m[1].length : 0);
          if (!inSpan(at)) continue;
          toks.push({
            line: li + 1,
            kind,
            cmd: m[group],
            token: kind === "slash" ? `/${m[2]}` : m[0].slice(prefixLen ? m[1].length : 0),
            pos: at,
          });
        }
      };
      collect(OPEN_RE, "open", 2, false);
      collect(CLOSE_RE, "close", 2, false);
      collect(SLASH_RE, "slash", 2, true);
      collect(BARE_RE, "bare", 1, false);
    }
    if (toks.length === 0) continue;
    toks.sort((a, b) => a.line - b.line || a.pos - b.pos);
    let region: DocRegion | undefined;
    let sawTypo = false;
    for (const t of toks) {
      if (t.kind === "open") {
        // An opener starts a region that lasts until the next proper closer; an opener met
        // inside a region is plain text to Doxygen, and is noted.
        if (!region)
          region = {
            file: f.file,
            open_line: t.line,
            command: t.cmd,
            typo_lines: [],
            reopened_lines: [],
            close_line: null,
          };
        else region.reopened_lines.push(t.line);
      } else if (t.kind === "close") {
        if (region) {
          region.close_line = t.line;
          scan.regions.push(region);
          region = undefined;
        } else scan.stray_closers.push({ file: f.file, line: t.line, token: t.token });
      } else {
        sawTypo = true;
        if (region) region.typo_lines.push(t.line);
        scan.typos.push({
          file: f.file,
          line: t.line,
          token: t.token,
          kind: t.kind,
          region_open_line: region?.open_line ?? null,
        });
      }
    }
    if (region) scan.regions.push(region);
    if (sawTypo) scan.files_with_typo++;
  }
  // An opener closed by its own closer with nothing odd in between is balanced, not a defect:
  // keep only regions with a typo, another opener inside, or no closer at all.
  const kept: DocRegion[] = [];
  for (const r of scan.regions) {
    if (r.typo_lines.length > 0 || r.reopened_lines.length > 0 || r.close_line === null)
      kept.push(r);
  }
  scan.regions = kept.sort((a, b) => compareCodeUnits(a.file, b.file) || a.open_line - b.open_line);
  scan.typos.sort((a, b) => compareCodeUnits(a.file, b.file) || a.line - b.line);
  scan.stray_closers.sort((a, b) => compareCodeUnits(a.file, b.file) || a.line - b.line);
  const withRegion = new Set(scan.regions.map((r) => r.file));
  scan.files_with_unterminated_block = withRegion.size;
  for (const r of scan.regions) {
    const l = byFile.get(r.file) ?? [];
    l.push(r);
    byFile.set(r.file, l);
  }
  return { scan, byFile };
}

// ── Comparison of one class ──────────────────────────────────────────────────

export interface Pair {
  idx: ApiMethod;
  src: SrcMethod;
  /** Which fields differ: `static`, `access`, `return_type`, `param_types`, `event` (index cannot carry it). */
  diffs: string[];
}

export interface ClassComparison {
  name: string;
  api: ApiClass;
  /** Methods of the class's own declarations (every declaration, modded ones included). */
  src: SrcMethod[];
  pairs: Pair[];
  /** Index entries that match an ancestor's method, not the class's own. */
  inherited: { idx: ApiMethod; from: string }[];
  /** Index entries that match nothing in the class or its ancestors. */
  indexOnly: ApiMethod[];
  /** Own source methods with no index entry (every category). */
  lost: SrcMethod[];
}

const srcAccess = (s: SrcMethod): string =>
  s.private ? "private" : s.protected ? "protected" : "public";
const idxAccess = (m: ApiMethod): string => (m.protected ? "protected" : "public");

/**
 * Pairs the index entries of a class with its source methods on (name,
 * arity), exact signature first, then in file order. Leftover entries are
 * matched against the ancestors' methods (the index lists inherited members
 * under each derived class); what remains is index-only. Source methods left
 * unpaired are lost.
 */
export function compareClass(index: SourceIndex, cls: MergedClass, api: ApiClass): ClassComparison {
  const src = srcMethodsOf(cls);
  const srcByKey = new Map<string, SrcMethod[]>();
  for (const s of src) {
    const k = methodKey(s.name, s.arity);
    const l = srcByKey.get(k);
    if (l) l.push(s);
    else srcByKey.set(k, [s]);
  }
  const ancestors = new Map<string, string[]>();
  for (const v of methodsOf(index, cls.name, { inherited: true })) {
    if (!v.inherited) continue;
    const k = methodKey(v.method.name, v.method.arity);
    const l = ancestors.get(k);
    if (l) l.push(v.declared_in);
    else ancestors.set(k, [v.declared_in]);
  }
  const idxByKey = new Map<string, ApiMethod[]>();
  for (const m of api.methods) {
    const k = methodKey(m.name, m.arity);
    const l = idxByKey.get(k);
    if (l) l.push(m);
    else idxByKey.set(k, [m]);
  }
  const pairs: Pair[] = [];
  const inherited: ClassComparison["inherited"] = [];
  const indexOnly: ApiMethod[] = [];
  const paired = new Set<SrcMethod>();
  for (const [k, entries] of idxByKey) {
    const cands = srcByKey.get(k) ?? [];
    const taken = new Set<ApiMethod>();
    const make = (e: ApiMethod, s: SrcMethod): void => {
      paired.add(s);
      taken.add(e);
      const diffs: string[] = [];
      if (e.static !== s.static) diffs.push("static");
      if (idxAccess(e) !== srcAccess(s)) diffs.push("access");
      if (idxRet(e) !== s.ret) diffs.push("return_type");
      if (idxParams(e).join(",") !== s.params.join(",")) diffs.push("param_types");
      if (s.event) diffs.push("event");
      pairs.push({ idx: e, src: s, diffs });
    };
    for (const e of entries) {
      const s = cands.find((c) => !paired.has(c) && sigKeySrc(c) === sigKeyIdx(e));
      if (s) make(e, s);
    }
    for (const e of entries) {
      if (taken.has(e)) continue;
      const s = cands.find((c) => !paired.has(c));
      if (s) make(e, s);
    }
    const froms = [...(ancestors.get(k) ?? [])];
    for (const e of entries) {
      if (taken.has(e)) continue;
      const from = froms.shift();
      if (from !== undefined) inherited.push({ idx: e, from });
      else indexOnly.push(e);
    }
  }
  pairs.sort((a, b) => a.idx.line - b.idx.line);
  inherited.sort((a, b) => a.idx.line - b.idx.line);
  indexOnly.sort((a, b) => a.line - b.line);
  return {
    name: cls.name,
    api,
    src,
    pairs,
    inherited,
    indexOnly,
    lost: src.filter((s) => !paired.has(s)),
  };
}

// ── The E02 observation file (module and kind per id) ───────────────────────

export interface E02Row {
  id: string;
  kind: string;
  module: string;
}

/** Id, kind and module of every row of an E02 observation file's text. */
export function readE02Rows(text: string): Map<string, E02Row> {
  const out = new Map<string, E02Row>();
  for (const raw of text.split("\n")) {
    if (!raw.trim()) continue;
    const o = JSON.parse(raw) as Record<string, unknown>;
    if ("$header" in o) continue;
    const parsed = observationSchema.parse(o);
    const id = deriveId(parsed);
    out.set(id, { id, kind: parsed.kind, module: parsed.module });
  }
  return out;
}

// ── Observation rows ─────────────────────────────────────────────────────────

export interface Merge {
  id: string;
  count: number;
  reason: string;
  refs: string[];
}

export interface RowsResult {
  observations: { id: string; obs: Observation }[];
  /** Entries that share a key with another entry of the same class (overloads of one arity). */
  merges: Merge[];
  /** Index entries listed under a derived class that are an ancestor's method: not emitted. */
  inheritedLeftOut: number;
  /** Rows whose id E02 also has. */
  sharedWithE02: number;
  /** Shared ids where the two enumerators say a different kind. */
  kindDisagreements: { id: string; e12: string; e02: string }[];
  /** Fields dropped from a row because they held a machine path. */
  scrubbed: { id: string; field: string }[];
  /** In-scope source classes the index does not hold. */
  scopeClassesNotInIndex: string[];
  scopeClasses: number;
  perKind: Record<string, number>;
}

const NO_MODULE: Module = "none";
const isModule = (s: string): s is Module => (MODULES as readonly string[]).includes(s);

function what(text: string): string | undefined {
  const s = firstSentence(text);
  if (!s) return undefined;
  return s.length > WHAT_MAX ? s.slice(0, WHAT_MAX) : s;
}

/** `<repo>/data/api/<file>#L<line>`. */
export const apiRef = (file: string, line: number): string => `<repo>/data/api/${file}#L${line}`;

/**
 * Observation rows: a class row per index class declared in the Workbench
 * scope, and a method row per index entry of such a class that is a
 * declaration of that class (own source method, or unconfirmed by the
 * source). Entries that are an ancestor's method are counted, not emitted.
 */
export function observationRows(
  index: SourceIndex,
  comparisons: Map<string, ClassComparison>,
  e02: Map<string, E02Row>,
): RowsResult {
  const scrubbed: RowsResult["scrubbed"] = [];
  const moduleOf = (id: string): Module => {
    const m = e02.get(id)?.module;
    return m !== undefined && isModule(m) ? m : NO_MODULE;
  };
  const clean = (id: string, obs: Observation): Observation => {
    for (const f of ["signature", "what", "quote"] as const) {
      const v = obs[f];
      if (v === undefined) delete obs[f];
      else if (containsMachinePath(v)) {
        delete obs[f];
        scrubbed.push({ id, field: f });
      }
    }
    return observationSchema.parse(obs);
  };

  const scopeNames = [...index.classes.values()]
    .filter((c) => c.declarations.some((d) => !d.forward && inWorkbenchScope(d.file)))
    .map((c) => c.name)
    .sort(compareCodeUnits);
  const notInIndex: string[] = [];
  const out: { id: string; obs: Observation }[] = [];
  const merges: Merge[] = [];
  let inheritedLeftOut = 0;

  for (const name of scopeNames) {
    const cmp = comparisons.get(name);
    if (!cmp) {
      notInIndex.push(name);
      continue;
    }
    const classId = `api:${name}`;
    const classModule = moduleOf(classId);
    inheritedLeftOut += cmp.inherited.length;

    interface Cand {
      m: ApiMethod;
      kind: "method" | "static-method" | "event";
    }
    const cands = new Map<string, Cand[]>();
    const add = (m: ApiMethod, kind: Cand["kind"]): void => {
      const id = `api:${name}.${m.name}/${m.arity}`;
      const l = cands.get(id);
      if (l) l.push({ m, kind });
      else cands.set(id, [{ m, kind }]);
    };
    for (const p of cmp.pairs)
      add(p.idx, p.src.event ? "event" : p.idx.static ? "static-method" : "method");
    for (const m of cmp.indexOnly) add(m, m.static ? "static-method" : "method");

    const children: { id: string; obs: Observation }[] = [];
    for (const [id, group] of [...cands].sort((a, b) => compareCodeUnits(a[0], b[0]))) {
      // The row cites the first public entry (a protected one only when no public entry shares the key).
      const rank = (c: Cand): number => (c.m.protected ? 1 : 0);
      const primary = group.reduce((best, c) => (rank(c) < rank(best) ? c : best), group[0]);
      if (group.length > 1) {
        const reasons = new Set<string>();
        const kinds = [...new Set(group.map((c) => c.kind))];
        if (kinds.length > 1) reasons.add(`kinds differ (${kinds.join(" / ")})`);
        const sigs = new Set(group.map((c) => c.m.param_types.map(normalizeType).join(",")));
        if (sigs.size > 1)
          reasons.add(
            "overloads with the same name and arity; the {class, method, arity} key cannot tell them apart",
          );
        if (reasons.size === 0) reasons.add("repeated entry");
        merges.push({
          id,
          count: group.length,
          reason: [...reasons].join("; "),
          refs: group.map((c) => apiRef(c.m.file, c.m.line)),
        });
      }
      const m = primary.m;
      const obs = clean(id, {
        dim: "api",
        kind: primary.kind,
        module: moduleOf(id),
        key: { class: name, method: m.name, arity: m.arity },
        parent_key: { dim: "api", kind: "class", module: classModule, key: { class: name } },
        label: m.name,
        signature: m.signature || undefined,
        what: what(m.description),
        origin: "vanilla",
        ref: apiRef(m.file, m.line),
        quote: m.quote || undefined,
        confidence: "high",
      });
      children.push({ id, obs });
    }
    const classObs = clean(classId, {
      dim: "api",
      kind: "class",
      module: classModule,
      key: { class: name },
      parent_key: null,
      label: name,
      what: what(cmp.api.description),
      origin: "vanilla",
      ref: apiRef(cmp.api.file, cmp.api.line),
      quote: cmp.api.quote || undefined,
      confidence: "high",
      children_count: children.length,
    });
    out.push({ id: classId, obs: classObs }, ...children);
  }
  out.sort((a, b) => compareCodeUnits(a.id, b.id));
  const perKind: Record<string, number> = {};
  let shared = 0;
  const kindDisagreements: RowsResult["kindDisagreements"] = [];
  for (const o of out) {
    perKind[o.obs.kind] = (perKind[o.obs.kind] ?? 0) + 1;
    const theirs = e02.get(o.id);
    if (theirs) {
      shared++;
      if (theirs.kind !== o.obs.kind)
        kindDisagreements.push({ id: o.id, e12: o.obs.kind, e02: theirs.kind });
    }
  }
  merges.sort((a, b) => compareCodeUnits(a.id, b.id));
  return {
    observations: out,
    merges,
    inheritedLeftOut,
    sharedWithE02: shared,
    kindDisagreements,
    scrubbed,
    scopeClassesNotInIndex: notInIndex,
    scopeClasses: scopeNames.length,
    perKind,
  };
}

// ── Class pairing by case, inactive-branch alternatives ──────────────────────

/**
 * The index class a source class is read against: the page of its exact name,
 * else the one page whose name differs only in case and is not itself the name
 * of a source class (Doxygen writes the script class `typename` as `TypeName`).
 * Two such pages, or a twin that is a source class, pair with nothing.
 *
 * Twin of `indexByName` in `src/scraper/backfill.ts`, which the backfill uses
 * to decide what the index lacks; the two must agree, so a change to one is a
 * change to the other. (A shared helper would belong in `src/census/` or
 * `src/scraper/signature.ts`; the enumerator imports nothing from `src/scraper`.)
 */
export function indexClassLookup(
  indexNames: Iterable<string>,
  isSourceClass: (name: string) => boolean,
): (sourceName: string) => string | undefined {
  const names = new Set(indexNames);
  const byLower = new Map<string, string[]>();
  for (const name of names) {
    if (isSourceClass(name)) continue;
    const k = name.toLowerCase();
    byLower.set(k, [...(byLower.get(k) ?? []), name]);
  }
  return (sourceName) => {
    if (names.has(sourceName)) return sourceName;
    const alias = byLower.get(sourceName.toLowerCase());
    return alias && alias.length === 1 ? alias[0] : undefined;
  };
}

/**
 * The guard that holds in the other branch of `g`'s conditional (as the source index flips it at `#else`).
 * `flipGuard` and `opposes` are twins of the same helpers in `src/scraper/backfill.ts`.
 */
function flipGuard(g: string): string {
  return g.startsWith("!") ? g.slice(1) : `!${g}`;
}

/** True when `a` and `b` sit in opposite branches of one guard. */
function opposes(a: readonly string[], b: readonly string[]): boolean {
  return a.some((g) => b.includes(flipGuard(g)));
}

/** The loss cause of a source method that is the other branch of a method the index holds. */
export const INACTIVE_BRANCH_CAUSE = "inactive-branch-alternative";

/** A lost source method that is the alternative body of a method the index holds (the branch Doxygen did not read). */
export interface InactiveAlternative {
  s: SrcMethod;
  /** The same-named method of the opposite branch that the index holds. */
  of: SrcMethod;
}

/**
 * Splits the unpaired expected methods of a class into real losses and
 * inactive-branch alternatives. A guarded unpaired method whose class holds a
 * same-named method that IS paired with an index entry and sits in the opposite
 * branch of one of its guards (`#ifndef X` against its `#else`, `#ifdef X`
 * against `#ifndef X`) is not lost: the index has the method, from one of the
 * two branches (the name is compared, not the arity). A sibling in the same
 * branch, under another guard, unguarded or itself unpaired does not make it one.
 *
 * Twin of the withholding rule in `lostMethods` of `src/scraper/backfill.ts`
 * (same-named, name only, first paired opposite sibling); keep the two equal.
 */
export function splitInactiveAlternatives(cmp: ClassComparison): {
  lost: SrcMethod[];
  alternatives: InactiveAlternative[];
} {
  const paired = new Set(cmp.pairs.map((p) => p.src));
  const lost: SrcMethod[] = [];
  const alternatives: InactiveAlternative[] = [];
  for (const s of cmp.lost) {
    if (!s.expected) continue;
    const of =
      s.rec.guards.length === 0
        ? undefined
        : cmp.src.find(
            (t) =>
              t !== s && paired.has(t) && t.name === s.name && opposes(s.rec.guards, t.rec.guards),
          );
    if (of) alternatives.push({ s, of });
    else lost.push(s);
  }
  return { lost, alternatives };
}

/** Exact text of the E12 observation file. */
export function observationFileText(
  rows: RowsResult,
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
    row_count: rows.observations.length,
  };
  return (
    [jsonlLine(header, ["$header"]), ...rows.observations.map((o) => jsonlLine(o.obs))].join("\n") +
    "\n"
  );
}

// ── The diff report ──────────────────────────────────────────────────────────

const PLUGIN_ATTRS = ["WorkbenchPluginAttribute", "WorkbenchToolAttribute"];

export interface LostMethod {
  name: string;
  arity: number;
  signature: string;
  file: string;
  line: number;
  modifiers: string[];
  guards: string[];
  cause: string;
  /** The Doxygen block that swallowed it, when the cause is a block typo. */
  region?: { open_line: number; typo_lines: number[]; close_line: number | null };
}

/** One inactive-branch alternative as the report lists it. */
export interface InactiveRecord {
  class: string;
  name: string;
  arity: number;
  signature: string;
  file: string;
  line: number;
  guards: string[];
  cause: typeof INACTIVE_BRANCH_CAUSE;
  /** The same-named method of the opposite branch that the index holds. */
  alternative_of: { file: string; line: number; guards: string[] };
}

export interface DiffReport {
  build: string;
  generator: string;
  inputs: { path: string; sha256: string }[];
  /** How to read the numbers: what counts as a loss and what does not. */
  notes: string[];
  headline: Record<string, unknown>;
  per_script_module: Record<string, Record<string, number>>;
  largest_losses: Record<string, unknown>[];
  loss_causes: Record<string, number>;
  classes_missing_from_index: Record<string, unknown>[];
  classes_in_index_not_in_source: Record<string, unknown>[];
  /**
   * Source classes and the index page whose name differs only in case:
   * `paired` is true when the enumerator read the class against that page
   * (`typename` against `TypeName`), false when it refused (two such pages, or
   * the twin is a source class's own name).
   */
  class_name_pairs: { source: string; index: string; paired: boolean }[];
  /** Lost methods that are the other branch of a method the index holds: not in `lost_total`. */
  inactive_branch_alternatives: {
    count: number;
    by_guard: Record<string, number>;
    by_class: Record<string, number>;
    methods: InactiveRecord[];
  };
  plugin_classes: Record<string, unknown>;
  worldeditorapi: Record<string, unknown>;
  signature_differences: { counts: Record<string, number>; examples: Record<string, unknown>[] };
  arity_differences: Record<string, unknown>[];
  classes: Record<string, unknown>[];
  doc_comment_scan: Record<string, unknown> | null;
}

export interface Analysis {
  report: DiffReport;
  rows: RowsResult;
  comparisons: Map<string, ClassComparison>;
}

export interface AnalyzeInput {
  build: string;
  index: SourceIndex;
  api: ApiIndexFile[];
  /** Inputs of the header, with placeholder paths. */
  inputs: { path: string; sha256: string }[];
  docs?: { scan: DocScan; byFile: Map<string, DocRegion[]> };
  e02?: Map<string, E02Row>;
}

const EXAMPLE_CAP = 300;

const REPORT_NOTES = [
  "A method is lost when the class's own source declaration has no index entry with the same name and arity; the index name field is Doxygen's anchor, so the name is read from the signature and the arity is the parameter count the signature states (a generic's comma, map< K, V >, counts once: the scraper splits it, so params.length is one too many for those entries, and drops a parameter after a default that holds a call; both are counted under methods.index_entries_params_array_*_than_signature and reported as params_length).",
  "Not counted as lost: private methods and methods declared in a modded class (Doxygen does not extract them); they are reported apart (methods.private_not_in_index, methods.modded_not_in_index).",
  "The index lists inherited members under each derived class. An entry that matches an ancestor's method is counted (methods.index_entries_that_are_inherited), never as index-only.",
  "Pairing within a name and arity prefers an exact signature, then file order; a class held twice by the index (api_index_duplicate_class_names) is read as one class with the entries of both pages.",
  "Types compare ignoring whitespace, typename versus TypeName (Doxygen's spelling), ref/autoptr/owned, and notnull on a return type. The index never carries the event modifier, so every paired event is counted under signature_differences.counts.event and is not an error.",
  "Loss causes are candidates read from the source, not proof: doxygen-block-typo (a method after a /endcode typo, inside the block Doxygen leaves open), doxygen-block-unterminated, arity-differs-in-index (the index holds the name with another arity), protected-static-method, preprocessor-guard (declared under an #ifdef; tested before the constructor case, since the index holds constructors and destructors), constructor-or-destructor, unexplained, class-missing-from-index.",
  "Inactive-branch alternatives are not losses (cause inactive-branch-alternative, listed in inactive_branch_alternatives, counted in headline methods.inactive_branch_alternatives, never in lost_total or loss_causes): a guarded source method with no index entry whose class holds a same-named method, matched in the index, in the opposite branch of one of its guards (#ifndef X against #else, #ifdef X against #ifndef X). The index has the method from one of the two branches (only the name is compared, not the arity; with identical signatures the later one in the file is reported as the alternative, the data does not show which branch Doxygen read); this is the other body of it. A sibling in the same branch, under another guard, unguarded, or itself without an index entry does not qualify. The src/scraper/backfill.ts withholding rule is the same rule.",
  "A source class with no index page of its exact name is read against the one index page whose name differs only in case and is not itself the name of a source class (Doxygen writes the script class typename as TypeName); with two such pages, or a twin that is a source class, it stays missing. class_name_pairs lists the pairs made and the ones refused. The paired page is not an index class missing from the source.",
  "A class name that is a Doxygen page title (Tuple1< Class T1 > Interface Template Reference) is read as the class name behind the title; the raw name is kept.",
];

function lossCause(
  m: SrcMethod,
  byFile: Map<string, DocRegion[]> | undefined,
  arityPaired: boolean,
): { cause: string; region?: DocRegion } {
  const region = byFile
    ?.get(m.rec.file)
    ?.find((r) => m.rec.line > r.open_line && (r.close_line === null || m.rec.line < r.close_line));
  if (region)
    return {
      cause: region.typo_lines.length > 0 ? "doxygen-block-typo" : "doxygen-block-unterminated",
      region,
    };
  if (arityPaired) return { cause: "arity-differs-in-index" };
  if (m.protected && m.static) return { cause: "protected-static-method" };
  // A guard comes before the constructor test: the index holds constructors and destructors
  // like any method, so one that is missing under an #ifdef is lost to the guard.
  if (m.rec.guards.length > 0) return { cause: "preprocessor-guard" };
  if (m.ctor) return { cause: "constructor-or-destructor" };
  return { cause: "unexplained" };
}

const sortedEntries = <T>(o: Record<string, T>): [string, T][] =>
  Object.entries(o).sort((a, b) => compareCodeUnits(a[0], b[0]));
const sortedObject = <T>(o: Record<string, T>): Record<string, T> =>
  Object.fromEntries(sortedEntries(o));

function tally<T>(items: readonly T[], key: (item: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of items) out[key(i)] = (out[key(i)] ?? 0) + 1;
  return out;
}

/** Compares the whole source index with the API index and builds the observation rows. */
export function analyze(input: AnalyzeInput): Analysis {
  const { index, api } = input;
  const e02 = input.e02 ?? new Map<string, E02Row>();

  // Index side: classes by normalized name. A name the index holds twice (a class split across
  // script modules, two template pages) becomes one class: the entries are joined, the first
  // page is the one the class row cites, and every method cites its own file and line.
  const apiByName = new Map<string, ApiClass>();
  const apiDuplicates: { class: string; files: string[] }[] = [];
  for (const f of api)
    for (const c of f.classes) {
      const prev = apiByName.get(c.name);
      if (prev) {
        const d = apiDuplicates.find((x) => x.class === c.name);
        if (d) d.files.push(f.file);
        else apiDuplicates.push({ class: c.name, files: [prev.file, f.file] });
        apiByName.set(c.name, {
          ...prev,
          methods: [...prev.methods, ...c.methods],
          counts: {
            public: prev.counts.public + c.counts.public,
            protected: prev.counts.protected + c.counts.protected,
            static: prev.counts.static + c.counts.static,
          },
        });
      } else apiByName.set(c.name, c);
    }

  const srcClasses = [...index.classes.values()]
    .filter((c) => c.declarations.some((d) => !d.forward))
    .sort((a, b) => compareCodeUnits(a.name, b.name));
  const declOf = (c: MergedClass): ClassRecord =>
    (c.declarations.find((d) => !d.forward && !d.modded) ??
      c.declarations.find((d) => !d.forward)) as ClassRecord;
  const srcNames = new Set(srcClasses.map((c) => c.name));
  // A source class is read against the index page of its exact name, else its case twin.
  // "Is a source class" is the source index's class table, as the backfill reads it.
  const indexNameOf = indexClassLookup(apiByName.keys(), (n) => index.classes.has(n));
  const apiOf = (name: string): ApiClass | undefined => {
    const n = indexNameOf(name);
    return n === undefined ? undefined : apiByName.get(n);
  };
  const casePaired = new Map<string, string>();

  const perModule: Record<string, Record<string, number>> = {};
  const mod = (m: string): Record<string, number> =>
    (perModule[m] ??= {
      files: 0,
      classes_in_source: 0,
      classes_in_source_and_index: 0,
      classes_in_index_not_in_source: 0,
      classes_missing_from_index: 0,
      methods_in_source: 0,
      methods_expected_in_index: 0,
      methods_matched: 0,
      methods_lost: 0,
      methods_inactive_branch_alternatives: 0,
      methods_in_missing_classes: 0,
      methods_private_not_in_index: 0,
      methods_modded_not_in_index: 0,
      methods_in_index_not_in_source: 0,
      classes_with_loss: 0,
    });
  for (const f of index.files) mod(f.script_module).files++;

  const comparisons = new Map<string, ClassComparison>();
  const classDetails: Record<string, unknown>[] = [];
  const missing: Record<string, unknown>[] = [];
  const lossCauses: Record<string, number> = {};
  const sigCounts: Record<string, number> = {};
  const sigExamples: Record<string, unknown>[] = [];
  const arityDiffs: Record<string, unknown>[] = [];
  const largest: Record<string, unknown>[] = [];
  const alternatives: InactiveRecord[] = [];
  const totals = {
    classes_in_source: srcClasses.length,
    classes_in_both: 0,
    classes_missing_from_index: 0,
    methods_in_source: 0,
    methods_expected_in_index: 0,
    methods_matched: 0,
    methods_lost_in_indexed_classes: 0,
    methods_inactive_branch_alternatives: 0,
    methods_in_missing_classes: 0,
    methods_lost_total: 0,
    methods_private_not_in_index: 0,
    methods_modded_not_in_index: 0,
    index_entries_own: 0,
    index_entries_inherited: 0,
    index_entries_not_in_source: 0,
    classes_with_loss: 0,
    arity_differences: 0,
  };

  for (const cls of srcClasses) {
    const decl = declOf(cls);
    const m = mod(decl.script_module);
    m.classes_in_source++;
    const own = srcMethodsOf(cls);
    const expected = own.filter((s) => s.expected);
    totals.methods_in_source += own.length;
    totals.methods_expected_in_index += expected.length;
    m.methods_in_source += own.length;
    m.methods_expected_in_index += expected.length;
    const apiClass = apiOf(cls.name);
    if (!apiClass) {
      totals.classes_missing_from_index++;
      m.classes_missing_from_index++;
      totals.methods_in_missing_classes += expected.length;
      m.methods_in_missing_classes += expected.length;
      totals.methods_lost_total += expected.length;
      lossCauses["class-missing-from-index"] =
        (lossCauses["class-missing-from-index"] ?? 0) + expected.length;
      missing.push({
        class: cls.name,
        script_module: decl.script_module,
        file: decl.file,
        line: decl.line,
        methods_in_source: own.length,
        methods_expected_in_index: expected.length,
        plugin: cls.attributes.some((a) => PLUGIN_ATTRS.includes(a.name)),
        in_workbench_scope: inWorkbenchScope(decl.file),
      });
      continue;
    }
    totals.classes_in_both++;
    m.classes_in_source_and_index++;
    if (apiClass.name !== cls.name) casePaired.set(cls.name, apiClass.name);
    const cmp = compareClass(index, cls, apiClass);
    comparisons.set(cls.name, cmp);
    const split = splitInactiveAlternatives(cmp);
    const lostExpected = split.lost;
    const lostPrivate = cmp.lost.filter((s) => s.private);
    const lostModded = cmp.lost.filter((s) => !s.private && s.modded);
    totals.methods_matched += cmp.pairs.length;
    m.methods_matched += cmp.pairs.length;
    totals.methods_lost_in_indexed_classes += lostExpected.length;
    totals.methods_inactive_branch_alternatives += split.alternatives.length;
    totals.methods_lost_total += lostExpected.length;
    totals.methods_private_not_in_index += lostPrivate.length;
    totals.methods_modded_not_in_index += lostModded.length;
    totals.index_entries_own += cmp.pairs.length;
    totals.index_entries_inherited += cmp.inherited.length;
    totals.index_entries_not_in_source += cmp.indexOnly.length;
    m.methods_lost += lostExpected.length;
    m.methods_inactive_branch_alternatives += split.alternatives.length;
    for (const { s, of } of split.alternatives)
      alternatives.push({
        class: cls.name,
        name: s.name,
        arity: s.arity,
        signature: s.rec.signature,
        file: s.rec.file,
        line: s.rec.line,
        guards: s.rec.guards,
        cause: INACTIVE_BRANCH_CAUSE,
        alternative_of: { file: of.rec.file, line: of.rec.line, guards: of.rec.guards },
      });
    m.methods_private_not_in_index += lostPrivate.length;
    m.methods_modded_not_in_index += lostModded.length;
    m.methods_in_index_not_in_source += cmp.indexOnly.length;
    if (lostExpected.length > 0) {
      totals.classes_with_loss++;
      m.classes_with_loss++;
    }

    // Arity differences: an index-only entry and an unpaired source method of the same name.
    const arityPaired = new Set<SrcMethod>();
    for (const e of cmp.indexOnly) {
      const s = cmp.lost.find(
        (x) => x.name === e.name && x.arity !== e.arity && !arityPaired.has(x),
      );
      if (!s) continue;
      arityPaired.add(s);
      const rec = {
        class: cls.name,
        method: e.name,
        source_arity: s.arity,
        index_arity: e.arity,
        index_params_length: e.params_length,
        source: `${s.rec.file}#L${s.rec.line}`,
        index: apiRef(e.file, e.line),
      };
      totals.arity_differences++;
      arityDiffs.push(rec);
    }
    const lostRecords: LostMethod[] = lostExpected.map((s) => {
      const c = lossCause(s, input.docs?.byFile, arityPaired.has(s));
      lossCauses[c.cause] = (lossCauses[c.cause] ?? 0) + 1;
      const rec: LostMethod = {
        name: s.name,
        arity: s.arity,
        signature: s.rec.signature,
        file: s.rec.file,
        line: s.rec.line,
        modifiers: s.rec.modifiers,
        guards: s.rec.guards,
        cause: c.cause,
      };
      if (c.region)
        rec.region = {
          open_line: c.region.open_line,
          typo_lines: c.region.typo_lines,
          close_line: c.region.close_line,
        };
      return rec;
    });
    for (const p of cmp.pairs) {
      for (const d of p.diffs) {
        sigCounts[d] = (sigCounts[d] ?? 0) + 1;
        if (d !== "event" && sigExamples.length < EXAMPLE_CAP * 5)
          sigExamples.push({
            class: cls.name,
            method: p.src.name,
            arity: p.src.arity,
            field: d,
            source: p.src.rec.signature,
            index: p.idx.signature,
            source_at: `${p.src.rec.file}#L${p.src.rec.line}`,
          });
      }
    }
    if (lostExpected.length > 0 || cmp.indexOnly.length > 0) {
      classDetails.push({
        class: cls.name,
        script_module: decl.script_module,
        source_file: decl.file,
        methods_in_source: own.length,
        methods_expected_in_index: expected.length,
        index_entries: apiClass.methods.length,
        matched: cmp.pairs.length,
        inherited_entries: cmp.inherited.length,
        lost: lostRecords,
        not_in_source: cmp.indexOnly.map((e) => ({
          name: e.name,
          arity: e.arity,
          signature: e.signature,
          index: apiRef(e.file, e.line),
          params_length: e.params_length,
        })),
        unpaired_not_expected: cmp.lost
          .filter((s) => !s.expected)
          .map((s) => ({
            name: s.name,
            arity: s.arity,
            reason: s.private ? "private" : "modded class",
            at: `${s.rec.file}#L${s.rec.line}`,
          })),
      });
      if (lostExpected.length > 0)
        largest.push({
          class: cls.name,
          script_module: decl.script_module,
          source_file: decl.file,
          methods_expected_in_index: expected.length,
          lost: lostExpected.length,
          matched: cmp.pairs.length,
          causes: sortedObject(
            lostRecords.reduce<Record<string, number>>((acc, r) => {
              acc[r.cause] = (acc[r.cause] ?? 0) + 1;
              return acc;
            }, {}),
          ),
        });
    }
  }
  largest.sort(
    (a, b) =>
      (b.lost as number) - (a.lost as number) ||
      compareCodeUnits(a.class as string, b.class as string),
  );

  // Index classes the source does not declare, and name pairs that differ only by case.
  const notInSource: Record<string, unknown>[] = [];
  const lowerMissing = new Map<string, string>(
    missing.map((x) => [(x.class as string).toLowerCase(), x.class as string]),
  );
  const pairs: DiffReport["class_name_pairs"] = [...casePaired].map(([source, name]) => ({
    source,
    index: apiByName.get(name)?.raw_name ?? name,
    paired: true,
  }));
  const pairedIndexNames = new Set(casePaired.values());
  for (const f of api)
    for (const c of f.classes) {
      if (srcNames.has(c.name) || pairedIndexNames.has(c.name)) continue;
      const counterpart = lowerMissing.get(c.name.toLowerCase());
      if (counterpart) pairs.push({ source: counterpart, index: c.raw_name, paired: false });
      notInSource.push({
        class: c.name,
        raw_name: c.raw_name,
        index_file: c.file,
        index: apiRef(c.file, c.line),
        page_title_not_class_name: c.mangled,
        methods: c.methods.length,
        differs_from_source_name_by_case_only: counterpart !== undefined,
      });
      mod("(index only)").classes_in_index_not_in_source++;
      mod("(index only)").methods_in_index_not_in_source += c.methods.length;
      totals.index_entries_not_in_source += c.methods.length;
    }
  notInSource.sort((a, b) => compareCodeUnits(a.raw_name as string, b.raw_name as string));
  missing.sort((a, b) => compareCodeUnits(a.class as string, b.class as string));

  // Plugin classes.
  const pluginClasses = srcClasses.filter((c) =>
    c.attributes.some((a) => PLUGIN_ATTRS.includes(a.name)),
  );
  const pluginDecls = index.records.filter(
    (r): r is ClassRecord =>
      r.kind === "class" && r.attributes.some((a) => PLUGIN_ATTRS.includes(a.name)),
  );
  const pluginMissing = pluginClasses.filter((c) => !apiOf(c.name));

  // WorldEditorAPI.
  const wea = comparisons.get("WorldEditorAPI");
  const weaSrc = index.classes.get("WorldEditorAPI");
  const weaOwn = weaSrc ? srcMethodsOf(weaSrc) : [];
  const weaFile = weaSrc?.declarations[0]?.file ?? "";
  const weaRegions = (input.docs?.byFile.get(weaFile) ?? []).filter((r) => r.typo_lines.length > 0);
  const weaLost = wea ? splitInactiveAlternatives(wea).lost : [];
  const weaBetween = !wea
    ? []
    : wea.src
        .filter((s) =>
          weaRegions.some(
            (r) => s.rec.line > r.open_line && (r.close_line === null || s.rec.line < r.close_line),
          ),
        )
        .map((s) => `${s.name}/${s.arity}`)
        .sort(compareCodeUnits);
  const weaLostNames = weaLost.map((s) => `${s.name}/${s.arity}`).sort(compareCodeUnits);
  const worldeditorapi = {
    source_file: weaSrc ? weaFile : null,
    methods_in_source: weaOwn.length,
    private_constructor_destructor: weaOwn.filter((s) => s.private).length,
    methods_declared_public_or_protected: weaOwn.filter((s) => s.expected).length,
    methods_in_index: wea ? wea.api.methods.length : null,
    lost: weaLost.length,
    lost_names: weaLostNames,
    typo_regions: weaRegions.map((r) => ({
      open_line: r.open_line,
      typo_lines: r.typo_lines,
      close_line: r.close_line,
    })),
    methods_inside_typo_regions: weaBetween,
    lost_equals_inside_typo_regions:
      weaBetween.length > 0 && weaBetween.join("\n") === weaLostNames.join("\n"),
  };

  const indexFiles: Record<string, unknown> = {};
  let paramsLonger = 0;
  let paramsShorter = 0;
  for (const f of api) {
    const cnt = { public: 0, protected: 0, static: 0 };
    let titles = 0;
    for (const c of f.classes) {
      for (const m of c.methods) {
        if (m.params_length > m.arity) paramsLonger++;
        else if (m.params_length < m.arity) paramsShorter++;
      }
      cnt.public += c.counts.public;
      cnt.protected += c.counts.protected;
      cnt.static += c.counts.static;
      if (c.mangled) titles++;
    }
    indexFiles[f.file] = {
      sha256: f.sha256,
      classes: f.classes.length,
      methods_public: cnt.public,
      methods_static: cnt.static,
      methods_protected: cnt.protected,
      methods_public_plus_static: cnt.public + cnt.static,
      methods_all: cnt.public + cnt.static + cnt.protected,
      class_names_that_are_page_titles: titles,
    };
  }
  const rows = observationRows(index, comparisons, e02);

  const headline = {
    api_index_files: indexFiles,
    api_index_duplicate_class_names: apiDuplicates,
    source: {
      script_files: index.files.length,
      classes: srcClasses.length,
      methods_in_class_bodies: totals.methods_in_source,
      methods_expected_in_index: totals.methods_expected_in_index,
    },
    classes: {
      in_source: totals.classes_in_source,
      in_both: totals.classes_in_both,
      missing_from_index: totals.classes_missing_from_index,
      in_index_not_in_source: notInSource.length,
      paired_by_case: casePaired.size,
    },
    methods: {
      matched: totals.methods_matched,
      lost_in_indexed_classes: totals.methods_lost_in_indexed_classes,
      in_classes_missing_from_index: totals.methods_in_missing_classes,
      lost_total: totals.methods_lost_total,
      inactive_branch_alternatives: totals.methods_inactive_branch_alternatives,
      private_not_in_index: totals.methods_private_not_in_index,
      modded_not_in_index: totals.methods_modded_not_in_index,
      index_entries_that_are_own_methods: totals.index_entries_own,
      index_entries_that_are_inherited: totals.index_entries_inherited,
      index_entries_not_in_source: totals.index_entries_not_in_source,
      arity_differences: totals.arity_differences,
      index_entries_params_array_longer_than_signature: paramsLonger,
      index_entries_params_array_shorter_than_signature: paramsShorter,
    },
    classes_with_loss: totals.classes_with_loss,
    worldeditorapi: {
      source: worldeditorapi.methods_declared_public_or_protected,
      index: worldeditorapi.methods_in_index,
      lost: worldeditorapi.lost,
    },
    plugin_classes: {
      class_declarations_with_plugin_or_tool_attribute: pluginDecls.length,
      distinct_classes: pluginClasses.length,
      missing_from_index: pluginMissing.length,
    },
    rows: {
      total: rows.observations.length,
      by_kind: sortedObject(rows.perKind),
      shared_with_e02: rows.sharedWithE02,
    },
  };

  const report: DiffReport = {
    build: input.build,
    generator: GENERATOR,
    inputs: input.inputs,
    notes: REPORT_NOTES,
    headline,
    per_script_module: sortedObject(perModule),
    largest_losses: largest.slice(0, 50),
    loss_causes: sortedObject(lossCauses),
    classes_missing_from_index: missing,
    classes_in_index_not_in_source: notInSource,
    class_name_pairs: pairs.sort((a, b) => compareCodeUnits(a.source, b.source)),
    inactive_branch_alternatives: {
      count: alternatives.length,
      by_guard: sortedObject(tally(alternatives, (a) => a.guards.join(" && "))),
      by_class: sortedObject(tally(alternatives, (a) => a.class)),
      methods: alternatives.sort(
        (a, b) =>
          compareCodeUnits(a.class, b.class) || compareCodeUnits(a.file, b.file) || a.line - b.line,
      ),
    },
    plugin_classes: {
      class_declarations_with_plugin_or_tool_attribute: pluginDecls.length,
      distinct_classes: pluginClasses.length,
      in_index: pluginClasses.length - pluginMissing.length,
      missing_from_index: pluginMissing.map((c) => c.name).sort(compareCodeUnits),
    },
    worldeditorapi,
    signature_differences: {
      counts: sortedObject(sigCounts),
      examples: sigExamples
        .sort(
          (a, b) =>
            compareCodeUnits(a.class as string, b.class as string) ||
            compareCodeUnits(a.method as string, b.method as string) ||
            compareCodeUnits(a.field as string, b.field as string),
        )
        .slice(0, EXAMPLE_CAP),
    },
    arity_differences: arityDiffs,
    classes: classDetails,
    doc_comment_scan: input.docs
      ? {
          files_scanned: input.docs.scan.files_scanned,
          files_with_typo: input.docs.scan.files_with_typo,
          files_with_unterminated_block: input.docs.scan.files_with_unterminated_block,
          typos: input.docs.scan.typos,
          unterminated_or_typo_blocks: input.docs.scan.regions,
          stray_closers: input.docs.scan.stray_closers,
        }
      : null,
  };
  return { report, rows, comparisons };
}

/** Exact text of the diff report. */
export function reportText(report: DiffReport): string {
  return JSON.stringify(report, null, 2) + "\n";
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const USAGE =
  "usage: e12-api-index.ts [--build <tag>] [--data <dir>] [--api-dir <dir>] [--source-index <file>] [--game <dir>] [--out <file under observations/E12/>] [--artifacts <dir>] [--no-artifacts] [--json]";

/** Resolves `--out`, refusing anything outside `<census>/observations/E12/`. */
export function resolveOut(paths: CensusPaths, out: string | undefined, build: string): string {
  const dir = join(paths.observations, ENUMERATOR_ID);
  const file = out ? resolve(out) : join(dir, `${build}.jsonl`);
  if (dirname(file) !== dir || !file.endsWith(".jsonl")) {
    throw new Error(
      "refusing --out outside observations/E12/ (E12 writes only its own observation directory)",
    );
  }
  return file;
}

export function run(argv: string[], io: Io = PROCESS_IO): number {
  return guard(io, "e12-api-index", () => {
    const { values } = parseArgs({
      args: argv,
      options: {
        build: { type: "string" },
        data: { type: "string" },
        "api-dir": { type: "string" },
        "source-index": { type: "string" },
        game: { type: "string" },
        out: { type: "string" },
        artifacts: { type: "string" },
        "no-artifacts": { type: "boolean" },
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
      io.err(`e12-api-index: ${e instanceof Error ? e.message : String(e)}`);
      return EXIT_FAIL;
    }
    const apiDir = values["api-dir"]
      ? resolve(values["api-dir"])
      : resolve(dirname(paths.observations), "..", "api");
    const apiPaths = API_FILES.map((f) => join(apiDir, f));
    if (!apiPaths.every((p) => existsSync(p))) {
      io.out("NO DATA: the API index files are not under <repo>/data/api; nothing written");
      return EXIT_USAGE;
    }
    const artifacts = values.artifacts ? resolve(values.artifacts) : artifactsDir();

    // Source index (E02): load, else build from the paks.
    const gamePath = values.game ? resolve(values.game) : loadConfig().gamePath;
    const vfs =
      gamePath && existsSync(join(gamePath, "addons")) ? PakVirtualFS.get(gamePath) : null;
    const indexFile = values["source-index"]
      ? resolve(values["source-index"])
      : sourceIndexPath(build, artifacts);
    let index = loadSourceIndex(build, { file: indexFile });
    if (!index) {
      if (!vfs) {
        io.out(
          "NO DATA: no source index for this build (run E02) and no game install to build one from; nothing written",
        );
        return EXIT_USAGE;
      }
      index = buildSourceIndex(vfs, { build });
      saveSourceIndex(index, { file: indexFile });
    }
    const indexBytes = readFileSync(indexFile);

    const api = API_FILES.map((f, i) => parseApiIndex(f, readFileSync(apiPaths[i])));
    const e02File = join(paths.observations, "E02", `${build}.jsonl`);
    const e02Bytes = existsSync(e02File) ? readFileSync(e02File) : undefined;
    const e02 = e02Bytes ? readE02Rows(e02Bytes.toString("utf-8")) : new Map<string, E02Row>();
    if (!e02Bytes)
      io.err(
        `e12-api-index: no E02 observation file for build ${build}; every module is written as none`,
      );

    const scanFiles = index.files;
    const docs = vfs
      ? scanDocBlocks(
          (function* () {
            for (const f of scanFiles) yield { file: f.file, text: vfs.readTextFile(f.file) };
          })(),
        )
      : undefined;
    if (!docs) io.err("e12-api-index: no game install; the comment scan is skipped");

    const indexLabel = values["source-index"]
      ? `<source-index>/${basename(indexFile)}`
      : `<artifacts>/census/${build}/E02/source-index.jsonl`;
    const inputs = [
      ...api.map((f) => ({ path: `<repo>/data/api/${f.file}`, sha256: f.sha256 })),
      ...(e02Bytes
        ? [
            {
              path: `<repo>/data/census/observations/E02/${build}.jsonl`,
              sha256: sha256Lf(e02Bytes),
            },
          ]
        : []),
      { path: indexLabel, sha256: sha256Lf(indexBytes) },
    ];
    const analysis = analyze({ build, index, api, inputs, docs, e02 });
    mkdirSync(dirname(out), { recursive: true });
    writeFileAtomic(out, observationFileText(analysis.rows, build, inputs));
    let wroteReport = false;
    if (!values["no-artifacts"]) {
      const reportFile = join(artifacts, "census", build, ENUMERATOR_ID, "api-index-diff.json");
      mkdirSync(dirname(reportFile), { recursive: true });
      writeFileAtomic(reportFile, reportText(analysis.report));
      wroteReport = true;
    }
    const r = analysis.rows;
    if (values.json) {
      io.out(
        JSON.stringify({
          ok: true,
          command: "e12-api-index",
          build,
          rows: r.observations.length,
          rows_by_kind: r.perKind,
          shared_with_e02: r.sharedWithE02,
          kind_disagreements: r.kindDisagreements,
          inherited_entries_left_out: r.inheritedLeftOut,
          headline: analysis.report.headline,
        }),
      );
      return EXIT_OK;
    }
    io.out(JSON.stringify(analysis.report.headline, null, 2));
    for (const m of r.merges) io.out(`merged ${m.id}: ${m.count} entries (${m.reason})`);
    if (r.kindDisagreements.length)
      io.out(`kind disagreements with E02: ${r.kindDisagreements.length}`);
    io.out(
      `E12 at build ${build}: ${r.observations.length} observations (${sortedEntries(r.perKind)
        .map(([k, n]) => `${k} ${n}`)
        .join(
          ", ",
        )}), ${r.sharedWithE02} share an id with E02, ${r.inheritedLeftOut} inherited entries left out${wroteReport ? `, report written to <artifacts>/census/${build}/E12/api-index-diff.json` : ""}`,
    );
    return EXIT_OK;
  });
}

if (isMainModule(import.meta.url)) process.exitCode = run(process.argv.slice(2));
