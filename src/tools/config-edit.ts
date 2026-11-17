/**
 * `config_edit`: read and edit Enfusion text configs as files, offline.
 *
 * File types: `.conf .emat .gamemat .physmat .vhcsurf .styles`. Every one is
 * the same text format, read and written through the lossless parser
 * (src/formats/enfusion-cst.ts): bytes outside an edit never change, and a
 * file the parser cannot give back byte for byte (a parse diagnostic, text it
 * keeps but cannot address) is refused, not rewritten.
 *
 * Reads take a file under the project root, or a game resource from the paks
 * (read only). Writes go inside the project root only, on a file that exists
 * (the creating actions, `createInherited` and `override`, on one that does
 * not, unless `overwrite`), and are a dry run unless `confirm` is true: the
 * dry run answers the exact change (before/after of the touched entry and a
 * line diff). No Workbench call, no network, no child process: a new file is
 * registered afterwards (`wb_resources register`).
 *
 * Response shape: {ok, action, target, changed, readback, next, warnings}
 * (src/manifest/vocabulary.ts), as JSON text.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { writeFileAtomic } from "../utils/atomic-write.js";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { z } from "zod";
import type { Config } from "../config.js";
import {
  CstDocument,
  CstEditError,
  parseCst,
  parseCstBytes,
  tokenValue,
  type CstEntry,
  type CstObject,
  type CstRoot,
  type EntrySpec,
  type ObjectSpec,
  type ScalarInput,
} from "../formats/enfusion-cst.js";
import {
  VocabularyError,
  checkRelativePath,
  errorResponse,
  type ActionResponse,
  type Change,
  type ErrorCode,
} from "../manifest/vocabulary.js";
import { PakVirtualFS } from "../pak/vfs.js";
import { assertInsideRoot, pinnedProjectRoot } from "../utils/path-guard.js";

export const CONFIG_EDIT_EXTENSIONS = [
  ".conf",
  ".emat",
  ".gamemat",
  ".physmat",
  ".vhcsurf",
  ".styles",
] as const;

export const CONFIG_EDIT_ACTIONS = [
  "read",
  "set",
  "clear",
  "arrayAdd",
  "arrayRemove",
  "setAncestor",
  "createInherited",
  "override",
] as const;
export type ConfigEditAction = (typeof CONFIG_EDIT_ACTIONS)[number];

export const CONFIG_EDIT_DESCRIPTION =
  "Read and edit Enfusion text configs offline (.conf .emat .gamemat .physmat .vhcsurf .styles) through the lossless parser. " +
  "Actions: read (outline, schema from the API index), set, clear, arrayAdd, arrayRemove, setAncestor, createInherited, override. " +
  "Writes stay in the project and are a dry run unless confirm:true; a file it cannot reproduce byte for byte is refused.";

type Scalar = string | number | boolean;
type ScalarValue = Scalar | Scalar[];

export interface ConfigEditArgs {
  action: ConfigEditAction;
  /** Project-relative resource path (a game resource for read, createInherited, override). */
  path: string;
  /** Property path inside the file (`Actions.Action[1].Type`); a block path for arrayAdd/arrayRemove. */
  property?: string;
  value?: ScalarValue;
  quoted?: boolean;
  /** arrayAdd: a scalar, `{value}`, `{key, value}`, `{object: ObjectSpec}` or an ObjectSpec (`{key, className?, name?, guid?, base?, entries?}`). */
  item?: unknown;
  index?: number;
  /** setAncestor, createInherited, override: the base reference (`{GUID}path`). setAncestor: "" removes it. */
  ancestor?: string;
  /** createInherited: where the new file goes (project-relative). */
  newPath?: string;
  /** createInherited, override: properties to set in the new file, as {propertyPath: value}. */
  values?: Record<string, ScalarValue>;
  depth?: number;
  limit?: number;
  schema?: boolean;
  confirm?: boolean;
  overwrite?: boolean;
  projectPath?: string;
}

// ── Errors ───────────────────────────────────────────────────────────────────

class Refusal extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly next?: string,
  ) {
    super(message);
    this.name = "Refusal";
  }
}

const MESSAGE_CAP = 400;

function failure(action: string, target: string, e: unknown): ActionResponse {
  if (e instanceof Refusal) return errorResponse(action, target, e.code, e.message, e.next);
  if (e instanceof VocabularyError) return errorResponse(action, target, e.code, e.message);
  if (e instanceof CstEditError) {
    return errorResponse(
      action,
      target,
      e.code === "PATH_NOT_FOUND" ? "PATH_NOT_FOUND" : "INVALID_ARGUMENT",
      e.message,
    );
  }
  const msg = e instanceof Error ? e.message : String(e);
  return errorResponse(action, target, "INVALID_ARGUMENT", msg.slice(0, MESSAGE_CAP));
}

// ── Locating the file ────────────────────────────────────────────────────────

interface Located {
  /** Resource path from the project root, forward slashes. */
  rel: string;
  source: "project" | "game" | "absent";
  /** Absolute file path (the project's, also for a file that does not exist yet). */
  abs?: string;
  bytes?: Buffer;
}

function extOf(rel: string): string {
  const i = rel.lastIndexOf(".");
  return i < 0 ? "" : rel.slice(i).toLowerCase();
}

function checkExtension(rel: string, label: string): void {
  if (!(CONFIG_EDIT_EXTENSIONS as readonly string[]).includes(extOf(rel))) {
    throw new Refusal(
      "INVALID_ARGUMENT",
      `${label} "${rel}" is not one of ${CONFIG_EDIT_EXTENSIONS.join(" ")}`,
      "config_edit handles the Enfusion text configs only; other types have their own tools.",
    );
  }
}

function stripRef(raw: string): string {
  return raw
    .trim()
    .replace(/^path:/, "")
    .replace(/^\{[0-9A-Fa-f]{16}\}/, "");
}

function vfsOf(config: Config): PakVirtualFS | null {
  try {
    return config.gamePath ? PakVirtualFS.get(config.gamePath) : null;
  } catch {
    return null;
  }
}

/**
 * A resource path to a project-relative one and an absolute file inside the
 * root. An absolute input must already sit inside the root. Throws
 * NOT_IN_PROJECT on an escape (also through a junction) and ABSOLUTE_PATH on
 * `..` or a drive in a relative one.
 */
function projectFile(raw: string, root: string | undefined, label: string) {
  const p = stripRef(raw);
  if (p === "") throw new Refusal("INVALID_ARGUMENT", `${label} is empty`);
  if (!root) {
    throw new Refusal(
      "NOT_IN_PROJECT",
      "no project root: set ENFUSION_PROJECT_PATH or pass projectPath",
    );
  }
  let abs: string;
  let rel: string;
  if (isAbsolute(p)) {
    abs = resolve(p);
    const r = relative(resolve(root), abs);
    if (r === "" || isAbsolute(r) || r.split(/[\\/]/)[0] === "..") {
      throw new Refusal("NOT_IN_PROJECT", `${label} is outside the project root: ${p}`);
    }
    rel = r.replace(/\\/g, "/");
  } else {
    rel = checkRelativePath(p);
    abs = resolve(root, rel);
  }
  try {
    assertInsideRoot(abs, root, label);
  } catch (e) {
    throw new Refusal("NOT_IN_PROJECT", e instanceof Error ? e.message : String(e));
  }
  return { rel, abs };
}

function locate(raw: string, root: string | undefined, config: Config, isRead: boolean): Located {
  const p = stripRef(raw);
  if (!root && !isAbsolute(p)) {
    // A game resource needs no project root: only a read can use that.
    const rel = checkRelativePath(p);
    checkExtension(rel, "path");
    if (!isRead) {
      throw new Refusal(
        "NOT_IN_PROJECT",
        "no project root: set ENFUSION_PROJECT_PATH or pass projectPath",
      );
    }
    return locateGame(rel, config);
  }
  if (!root) throw new Refusal("NOT_IN_PROJECT", "no project root for an absolute path");
  const { rel, abs } = projectFile(raw, root, "path");
  checkExtension(rel, "path");
  if (existsSync(abs)) {
    if (!statSync(abs).isFile()) throw new Refusal("INVALID_ARGUMENT", `${rel} is not a file`);
    return { rel, source: "project", abs, bytes: readFileSync(abs) };
  }
  if (isAbsolute(p)) throw new Refusal("PATH_NOT_FOUND", `no file at ${abs}`);
  const g = vfsOf(config);
  if (g?.exists(rel)) return { rel, source: "game", abs, bytes: g.readFile(rel) };
  return { rel, source: "absent", abs };
}

function locateGame(rel: string, config: Config): Located {
  const g = vfsOf(config);
  if (g?.exists(rel)) return { rel, source: "game", bytes: g.readFile(rel) };
  return { rel, source: "absent" };
}

function mustExist(l: Located): asserts l is Located & { bytes: Buffer } {
  if (l.source === "absent" || !l.bytes) {
    throw new Refusal(
      "PATH_NOT_FOUND",
      `no file "${l.rel}" in the project or the game data`,
      "Check the path; read a folder's files with list_resources or game_browse.",
    );
  }
}

// ── The document and the write guard ─────────────────────────────────────────

function eachOpaque(entries: readonly CstEntry[], visit: (e: CstEntry) => void): void {
  for (const e of entries) {
    if (e.kind === "opaque") visit(e);
    else if (e.kind === "object") eachOpaque(e.children, visit);
  }
}

function lineStartsOf(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\n") starts.push(i + 1);
    else if (c === "\r" && text[i + 1] !== "\n") starts.push(i + 1);
  }
  return starts;
}

function lineAt(starts: number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/** Why the writer would not touch this file, or undefined when it can. */
function unwritableReason(doc: CstDocument, bytes: Buffer): string | undefined {
  if (!doc.toBytes().equals(bytes)) return "the parser does not give the file back byte for byte";
  if (doc.diagnostics.length > 0) {
    const d = doc.diagnostics[0];
    return `the file has ${doc.diagnostics.length} parse diagnostic(s), the first at line ${d.line}: ${d.message}`;
  }
  const opaque: CstEntry[] = [];
  eachOpaque(doc.root.children, (e) => opaque.push(e));
  if (opaque.length > 0) {
    const first = opaque[0];
    const line = lineAt(lineStartsOf(doc.text), first.start);
    const reason = first.kind === "opaque" ? first.reason : "";
    return `the file has text the writer cannot address (line ${line}: ${reason})`;
  }
  return undefined;
}

function guardWritable(
  l: Located,
  doc: CstDocument,
  verb: string,
): asserts l is Located & {
  abs: string;
  bytes: Buffer;
} {
  mustExist(l);
  if (l.source === "game") {
    throw new Refusal(
      "NOT_IN_PROJECT",
      `${l.rel} is a game resource: read only. ${verb} edits a file inside the project`,
      "Make a project copy first: config_edit createInherited or override, or game_duplicate.",
    );
  }
  const why = unwritableReason(doc, l.bytes);
  if (why) {
    throw new Refusal(
      "INVALID_ARGUMENT",
      `${l.rel} is refused, not rewritten: ${why}`,
      "Edit it in the Workbench, or fix the text by hand and retry.",
    );
  }
}

function cloneDoc(doc: CstDocument): CstDocument {
  return new CstDocument(doc.text, doc.encoding);
}

function blockOf(doc: CstDocument, path: string): CstRoot | CstObject {
  if (path === "") return doc.base;
  const e = doc.resolve(path);
  if (e.kind !== "object") throw new CstEditError("UNSUPPORTED", `${path} is not a block`);
  return e;
}

const RAW_CAP = 4000;

/** The text of an entry, capped for the reply (a note says so). */
function rawOf(doc: CstDocument, e: CstEntry, notes: string[]): string {
  const raw = doc.text.slice(e.start, e.end);
  if (raw.length <= RAW_CAP) return raw;
  notes.push(
    `an entry of ${raw.length} characters is shown cut to ${RAW_CAP}: the inverse needs the file's own text`,
  );
  return raw.slice(0, RAW_CAP) + "...";
}

function valueText(doc: CstDocument, e: CstEntry): string {
  if ((e.kind === "scalar" || e.kind === "value") && e.values.length > 0) {
    return doc.text.slice(e.values[0].start, e.values[e.values.length - 1].end);
  }
  return doc.text.slice(e.start, e.end);
}

/** A small unified diff of what an edit changed, from the two whole texts. */
export function lineDiff(before: string, after: string, context = 2): string {
  if (before === after) return "(no change)";
  const a = before.split(/\r\n|\n|\r/);
  const b = after.split(/\r\n|\n|\r/);
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  const from = Math.max(0, p - context);
  const aEnd = a.length - s;
  const bEnd = b.length - s;
  const toA = Math.min(a.length, aEnd + context);
  const out = [`@@ -${from + 1},${toA - from} +${from + 1},${bEnd - from + (toA - aEnd)} @@`];
  for (let i = from; i < p; i++) out.push(` ${a[i]}`);
  for (let i = p; i < aEnd; i++) out.push(`-${a[i]}`);
  for (let i = p; i < bEnd; i++) out.push(`+${b[i]}`);
  for (let i = aEnd; i < toA; i++) out.push(` ${a[i]}`);
  const MAX = 80;
  return out.length > MAX
    ? [...out.slice(0, MAX), `... (${out.length - MAX} more lines)`].join("\n")
    : out.join("\n");
}

// ── Reading ──────────────────────────────────────────────────────────────────

interface ApiClass {
  name: string;
  parents?: string[];
  source?: string;
  properties?: { name: string; type: string }[];
  protectedProperties?: { name: string; type: string }[];
}

let apiCache: { dir: string; classes: Map<string, ApiClass> } | undefined;

/** The scraped API classes by name; empty when the index is missing or unreadable. */
function apiClasses(dataDir: string): Map<string, ApiClass> {
  if (apiCache?.dir === dataDir) return apiCache.classes;
  const classes = new Map<string, ApiClass>();
  for (const f of ["enfusion-classes.json", "arma-classes.json"]) {
    try {
      const list = JSON.parse(readFileSync(join(dataDir, "api", f), "utf-8")) as ApiClass[];
      for (const c of list) if (!classes.has(c.name)) classes.set(c.name, c);
    } catch {
      // A missing index file only drops the schema block.
    }
  }
  apiCache = { dir: dataDir, classes };
  return classes;
}

/** The API class an object is an instance of: `Key Class "{GUID}" {` gives Class, `Class Name {` gives Class. */
function classOfObject(o: CstObject, api: Map<string, ApiClass>): string | undefined {
  const words = o.head.filter((t) => t.kind === "word").map((t) => t.text);
  for (const w of [words[1], words[0]]) if (w && api.has(w)) return w;
  return undefined;
}

interface SchemaProperty {
  name: string;
  type: string;
  declaredIn: string;
  set: boolean;
}

function schemaOf(block: CstObject, dataDir: string, limit: number) {
  const api = apiClasses(dataDir);
  const cls = classOfObject(block, api);
  const asked = block.head.find((t) => t.kind === "word")?.text ?? "";
  if (!cls) {
    return {
      class: asked,
      found: false,
      note: api.size
        ? `${asked || "this block"} is not a class of the API index (an engine resource type, or not scraped)`
        : "no API index in the data directory",
    };
  }
  const present = new Set(
    block.children.map((c) => (c.kind === "object" || c.kind === "scalar" ? c.key : "")),
  );
  const props: SchemaProperty[] = [];
  const seen = new Set<string>();
  const chain: string[] = [];
  let cur: ApiClass | undefined = api.get(cls);
  while (cur && !chain.includes(cur.name)) {
    chain.push(cur.name);
    for (const p of [...(cur.properties ?? []), ...(cur.protectedProperties ?? [])]) {
      if (seen.has(p.name)) continue;
      seen.add(p.name);
      props.push({ name: p.name, type: p.type, declaredIn: cur.name, set: present.has(p.name) });
    }
    cur = cur.parents?.[0] ? api.get(cur.parents[0]) : undefined;
  }
  const unknown = [...present].filter((k) => k !== "" && !seen.has(k));
  return {
    class: cls,
    found: true,
    chain,
    properties: props.slice(0, limit),
    propertiesTotal: props.length,
    truncated: props.length > limit,
    unknownKeys: unknown,
  };
}

interface OutlineEntry {
  path: string;
  line: number;
  kind: CstEntry["kind"];
  key?: string;
  head?: string[];
  base?: string;
  value?: string;
  count?: number;
}

const SEGMENT_OK = /^\$?[A-Za-z_][A-Za-z0-9_]*$/;
const VALUE_CAP = 200;

function outline(
  doc: CstDocument,
  start: CstRoot | CstObject,
  prefix: string,
  depth: number,
  limit: number,
) {
  const starts = lineStartsOf(doc.text);
  const entries: OutlineEntry[] = [];
  let truncated = false;
  const walk = (block: CstRoot | CstObject, path: string, level: number): void => {
    const counts = new Map<string, number>();
    for (const c of block.children) {
      if (c.kind === "object" || c.kind === "scalar")
        counts.set(c.key, (counts.get(c.key) ?? 0) + 1);
    }
    block.children.forEach((c, i) => {
      if (truncated) return;
      if (entries.length >= limit) {
        truncated = true;
        return;
      }
      const named =
        (c.kind === "object" || c.kind === "scalar") &&
        counts.get(c.key) === 1 &&
        SEGMENT_OK.test(c.key);
      const p = named
        ? path
          ? `${path}.${(c as { key: string }).key}`
          : (c as { key: string }).key
        : `${path}[${i}]`;
      const o: OutlineEntry = { path: p, line: lineAt(starts, c.start), kind: c.kind };
      if (c.kind === "object") {
        o.key = c.key;
        o.head = c.head.map(tokenValue);
        if (c.base.length) o.base = tokenValue(c.base[0]);
        o.count = c.children.length;
      } else if (c.kind === "scalar" || c.kind === "value") {
        if (c.kind === "scalar") o.key = c.key;
        const v = valueText(doc, c);
        o.value = v.length > VALUE_CAP ? v.slice(0, VALUE_CAP) + "..." : v;
      }
      entries.push(o);
      if (c.kind === "object" && level < depth) walk(c, p, level + 1);
    });
  };
  walk(start, prefix, 1);
  return { entries, truncated };
}

function eolOf(doc: CstDocument): string {
  const t = doc.tokens.find((x) => x.kind === "eol");
  if (!t) return "none";
  return t.text === "\r\n" ? "crlf" : t.text === "\n" ? "lf" : "cr";
}

function guidOfRef(ref: string | undefined): string | undefined {
  return ref ? /^\{([0-9A-Fa-f]{16})\}/.exec(ref)?.[1].toUpperCase() : undefined;
}

function doRead(args: ConfigEditArgs, l: Located, config: Config): ActionResponse {
  mustExist(l);
  const doc = parseCstBytes(l.bytes);
  const warnings: string[] = [];
  const depth = Math.min(Math.max(args.depth ?? 2, 1), 8);
  const limit = Math.min(Math.max(args.limit ?? 100, 1), 200);
  const base = doc.base;
  const rootEntry = base.kind === "object" ? base : undefined;
  const why = l.source === "game" ? "game resource (read only)" : unwritableReason(doc, l.bytes);
  if (doc.diagnostics.length > 0) {
    warnings.push(
      `${doc.diagnostics.length} parse diagnostic(s), the first at line ${doc.diagnostics[0].line}: ${doc.diagnostics[0].message}`,
    );
  }

  let start: CstRoot | CstObject = base;
  let prefix = "";
  let value: unknown;
  if (args.property) {
    const e = doc.resolve(args.property);
    if (e.kind === "object") {
      start = e;
      prefix = args.property;
    } else if (e.kind === "scalar" || e.kind === "value") {
      value = {
        path: args.property,
        raw: valueText(doc, e),
        values: e.values.map(tokenValue),
        quoted: e.values.map((t) => t.kind === "string"),
      };
    } else {
      value = { path: args.property, raw: doc.text.slice(e.start, e.end), opaque: true };
    }
  }
  const tree = value === undefined ? outline(doc, start, prefix, depth, limit) : undefined;
  const schemaBlock = start.kind === "object" ? start : rootEntry;
  const schema =
    args.schema !== false && schemaBlock ? schemaOf(schemaBlock, config.dataDir, 150) : undefined;

  return {
    ok: true,
    action: "read",
    target: `path:${l.rel}`,
    changed: null,
    readback: {
      source: l.source,
      bytes: l.bytes.length,
      encoding: doc.encoding,
      eol: eolOf(doc),
      lines: lineStartsOf(doc.text).length,
      rootClass: rootEntry?.key,
      ancestor: rootEntry?.base.length ? tokenValue(rootEntry.base[0]) : undefined,
      topLevelBlocks: base.kind === "root" ? doc.root.children.length : 1,
      writable: why === undefined,
      ...(why ? { notWritable: why } : {}),
      ...(value !== undefined ? { value } : { entries: tree!.entries, truncated: tree!.truncated }),
      ...(schema ? { schema } : {}),
    },
    next:
      why === undefined
        ? "set / clear / arrayAdd / arrayRemove / setAncestor with property paths from entries; add confirm:true to write."
        : l.source === "game"
          ? "createInherited or override makes a project file that inherits from this one."
          : "This file is read only for config_edit.",
    warnings,
  };
}

// ── Writing ──────────────────────────────────────────────────────────────────

interface Plan {
  changed: Change[];
  /** The new document. */
  doc: CstDocument;
  warnings: string[];
}

function asScalar(v: unknown, what: string): ScalarInput {
  const one = (x: unknown): boolean =>
    typeof x === "string" || typeof x === "number" || typeof x === "boolean";
  if (one(v) || (Array.isArray(v) && v.length > 0 && v.every(one))) return v as ScalarInput;
  throw new Refusal(
    "INVALID_ARGUMENT",
    `${what} must be a string, number, boolean or a non-empty list of them`,
  );
}

function entrySpecOf(item: unknown): EntrySpec | ScalarInput {
  if (typeof item === "object" && item !== null && !Array.isArray(item)) {
    const r = item as Record<string, unknown>;
    if ("object" in r) {
      if (typeof r.object !== "object" || r.object === null) {
        throw new Refusal("INVALID_ARGUMENT", "item.object must be an object spec");
      }
      return { object: r.object as ObjectSpec };
    }
    if ("value" in r) {
      const e: { key?: string; value: ScalarInput; quoted?: boolean } = {
        value: asScalar(r.value, "item.value"),
      };
      if (r.key !== undefined) e.key = String(r.key);
      if (typeof r.quoted === "boolean") e.quoted = r.quoted;
      return e as EntrySpec;
    }
    if (typeof r.key === "string") return { object: r as unknown as ObjectSpec };
    throw new Refusal(
      "INVALID_ARGUMENT",
      "item needs value, key+value, object, or an object spec with key",
    );
  }
  return asScalar(item, "item");
}

function planSet(doc: CstDocument, args: ConfigEditArgs): Plan {
  if (!args.property) throw new Refusal("INVALID_ARGUMENT", "set needs property");
  if (args.value === undefined) throw new Refusal("INVALID_ARGUMENT", "set needs value");
  const value = asScalar(args.value, "value");
  const notes: string[] = [];
  const work = cloneDoc(doc);
  let before: string | null = null;
  try {
    before = rawOf(doc, doc.resolve(args.property), notes);
  } catch (e) {
    if (!(e instanceof CstEditError) || e.code !== "PATH_NOT_FOUND") throw e;
  }
  work.set(args.property, value, { quoted: args.quoted });
  const after = rawOf(work, work.resolve(args.property), notes);
  const warnings = [...new Set(notes)];
  if (before === after) warnings.push("the value already is this: no change");
  if (before === null) warnings.push("the property was not in the file: it is added as a new line");
  return { changed: [{ path: args.property, before, after }], doc: work, warnings };
}

function planClear(doc: CstDocument, args: ConfigEditArgs): Plan {
  if (!args.property) throw new Refusal("INVALID_ARGUMENT", "clear needs property");
  const notes: string[] = [];
  const e = doc.resolve(args.property);
  if (doc.base.kind === "object" && e === doc.base) {
    throw new Refusal("INVALID_ARGUMENT", "clear does not remove the file's root block");
  }
  const before = rawOf(doc, e, notes);
  const work = cloneDoc(doc);
  work.delete(args.property);
  return {
    changed: [{ path: args.property, before, after: null }],
    doc: work,
    warnings: [...new Set(notes)],
  };
}

function planArrayAdd(doc: CstDocument, args: ConfigEditArgs): Plan {
  if (args.item === undefined) throw new Refusal("INVALID_ARGUMENT", "arrayAdd needs item");
  const blockPath = args.property ?? "";
  const block = blockOf(doc, blockPath);
  const n = block.children.length;
  const at = args.index ?? n;
  const work = cloneDoc(doc);
  const edit = work.arrayAdd(blockPath, entrySpecOf(args.item), args.index);
  const path = `${blockPath}[${at}]`;
  const after = work.text.slice(edit.start, edit.start + edit.inserted.length).trim();
  return { changed: [{ path, before: null, after }], doc: work, warnings: [] };
}

function planArrayRemove(doc: CstDocument, args: ConfigEditArgs): Plan {
  if (args.index === undefined) throw new Refusal("INVALID_ARGUMENT", "arrayRemove needs index");
  const blockPath = args.property ?? "";
  const block = blockOf(doc, blockPath);
  const e = block.children[args.index];
  if (!e) {
    throw new Refusal(
      "PATH_NOT_FOUND",
      `${blockPath}[${args.index}]: the block has ${block.children.length} entries`,
    );
  }
  const notes: string[] = [];
  const before = rawOf(doc, e, notes);
  const work = cloneDoc(doc);
  work.arrayRemove(blockPath, args.index);
  return {
    changed: [{ path: `${blockPath}[${args.index}]`, before, after: null }],
    doc: work,
    warnings: [...new Set(notes)],
  };
}

const ANCESTOR = /^(\{[0-9A-Fa-f]{16}\})?[^"\r\n]+$/;

/** A base reference as the engine writes it: GUID uppercase, in braces, then the path. */
function normalizeAncestor(raw: string, warnings: string[]): string {
  const t = raw.trim();
  if (!ANCESTOR.test(t) || t.endsWith("\\")) {
    throw new Refusal("INVALID_ARGUMENT", `ancestor must be {GUID}path or a path, got: ${raw}`);
  }
  const m = /^\{([0-9A-Fa-f]{16})\}(.*)$/.exec(t);
  if (!m) {
    warnings.push(
      "the ancestor has no GUID: the engine resolves it by path; register the file to bind it",
    );
    return t;
  }
  if (m[2] === "") throw new Refusal("INVALID_ARGUMENT", "ancestor has a GUID and no path");
  return `{${m[1].toUpperCase()}}${m[2]}`;
}

function planSetAncestor(doc: CstDocument, args: ConfigEditArgs, rel: string): Plan {
  if (args.ancestor === undefined)
    throw new Refusal("INVALID_ARGUMENT", "setAncestor needs ancestor");
  const warnings: string[] = [];
  const target = blockOf(doc, args.property ?? "");
  if (target.kind !== "object" || target.head.length === 0) {
    throw new Refusal(
      "INVALID_ARGUMENT",
      "setAncestor needs a block with a header: the file has no single root block, give property",
    );
  }
  const ref = args.ancestor.trim() === "" ? "" : normalizeAncestor(args.ancestor, warnings);
  if (ref !== "" && stripRef(ref).toLowerCase() === rel.toLowerCase()) {
    throw new Refusal("INVALID_ARGUMENT", "a file cannot be its own ancestor");
  }
  const lastHead = target.head[target.head.length - 1];
  const before = target.base.length ? tokenValue(target.base[0]) : null;
  let text: string;
  if (target.base.length) {
    const last = target.base[target.base.length - 1];
    text =
      ref === ""
        ? doc.text.slice(0, lastHead.end) + doc.text.slice(last.end)
        : doc.text.slice(0, target.base[0].start) + `"${ref}"` + doc.text.slice(last.end);
  } else if (ref === "") {
    throw new Refusal("INVALID_ARGUMENT", "the block has no ancestor to remove");
  } else {
    text = doc.text.slice(0, lastHead.end) + ` : "${ref}"` + doc.text.slice(lastHead.end);
  }
  if (doc.encoding === "latin1" && /[^\x00-\xff]/.test(text)) {
    throw new Refusal("INVALID_ARGUMENT", "text outside latin-1 in a latin-1 file");
  }
  if (before === (ref === "" ? null : ref))
    warnings.push("the ancestor already is this: no change");
  return {
    changed: [
      {
        path: `${args.property ? args.property + "." : ""}ancestor`,
        before,
        after: ref === "" ? null : ref,
      },
    ],
    doc: new CstDocument(text, doc.encoding),
    warnings,
  };
}

/** Everything a plan must satisfy before a byte is written. */
function checkPlan(plan: Plan, before: CstDocument): void {
  if (plan.doc.diagnostics.length > before.diagnostics.length) {
    throw new Refusal(
      "INVALID_ARGUMENT",
      `the edit would leave the file with a parse diagnostic (${plan.doc.diagnostics[plan.doc.diagnostics.length - 1].message}): nothing written`,
    );
  }
  const opaque: CstEntry[] = [];
  eachOpaque(plan.doc.root.children, (e) => opaque.push(e));
  if (opaque.length > 0)
    throw new Refusal(
      "INVALID_ARGUMENT",
      "the edit would leave text the writer cannot address: nothing written",
    );
  if (!plan.doc.toBytes().equals(Buffer.from(plan.doc.serialize(), plan.doc.encoding))) {
    throw new Refusal("INVALID_ARGUMENT", "the new text does not serialize back: nothing written");
  }
}

function commitEdit(
  args: ConfigEditArgs,
  l: Located & { abs: string; bytes: Buffer },
  plan: Plan,
  doc: CstDocument,
): ActionResponse {
  checkPlan(plan, doc);
  const newBytes = plan.doc.toBytes();
  const diff = lineDiff(doc.text, plan.doc.text);
  const target = `path:${l.rel}`;
  const confirm = args.confirm === true;
  const readback: Record<string, unknown> = {
    dryRun: !confirm,
    diff,
    bytesBefore: l.bytes.length,
    bytesAfter: newBytes.length,
  };
  if (!confirm) {
    return {
      ok: true,
      action: args.action,
      target,
      changed: plan.changed,
      readback,
      next: "Nothing was written. Repeat the call with confirm:true to write exactly this change.",
      warnings: plan.warnings,
    };
  }
  if (newBytes.equals(l.bytes)) {
    readback.written = false;
    return {
      ok: true,
      action: args.action,
      target,
      changed: plan.changed,
      readback,
      next: "The file already had this content: nothing written.",
      warnings: plan.warnings,
    };
  }
  // Nothing may have changed the file since it was read (an editor saving over it).
  if (!readFileSync(l.abs).equals(l.bytes)) {
    throw new Refusal(
      "INVALID_ARGUMENT",
      `${l.rel} changed on disk while the edit was planned: nothing written`,
      "Read it again and repeat the call.",
    );
  }
  // Write-then-rename: a failed write leaves the file as it was (review round 1, F9).
  writeFileAtomic(l.abs, newBytes);
  const verified = readFileSync(l.abs).equals(newBytes);
  readback.written = true;
  readback.verified = verified;
  return {
    ok: true,
    action: args.action,
    target,
    changed: plan.changed,
    readback,
    next:
      "Written. A Workbench tab that has this file open keeps its own copy: reopen it there, and do not save the old tab over this file. " +
      "The inverse is the same action with the before value.",
    warnings: verified
      ? plan.warnings
      : [...plan.warnings, "the file read back differs from what was written"],
  };
}

// ── Creating ─────────────────────────────────────────────────────────────────

/** The `{GUID}path` of a project file, from its `.meta` sidecar; undefined when there is none. */
function projectRefOf(abs: string, rel: string): string | undefined {
  const metaPath = `${abs}.meta`;
  if (!existsSync(metaPath)) return undefined;
  try {
    const name = parseCst(readFileSync(metaPath, "utf-8")).get("Name");
    const v = name.kind === "scalar" ? name.values[0] : undefined;
    const g = guidOfRef(v);
    return g ? `{${g}}${rel}` : undefined;
  } catch {
    return undefined;
  }
}

function planCreate(
  args: ConfigEditArgs,
  src: Located & { bytes: Buffer },
  srcDoc: CstDocument,
  destRel: string,
): { text: string; changed: Change[]; warnings: string[]; ancestor: string } {
  const warnings: string[] = [];
  const root = srcDoc.base;
  if (root.kind !== "object" || !root.key) {
    throw new Refusal(
      "INVALID_ARGUMENT",
      `${src.rel} has no single root block to inherit from`,
      "Only a file with one root block (a .conf, .emat, .gamemat, .physmat or .vhcsurf) can be inherited.",
    );
  }
  let ref: string;
  if (args.ancestor !== undefined && args.ancestor.trim() !== "") {
    ref = normalizeAncestor(args.ancestor, warnings);
    if (stripRef(ref).toLowerCase() !== src.rel.toLowerCase()) {
      warnings.push(`the ancestor path ${stripRef(ref)} differs from the source ${src.rel}`);
    }
  } else {
    const fromMeta = src.source === "project" ? projectRefOf(src.abs ?? "", src.rel) : undefined;
    if (fromMeta) ref = fromMeta;
    else {
      ref = src.rel;
      warnings.push(
        "no GUID for the ancestor (a game resource carries none in the paks, and no .meta was found): it is written as a path; pass ancestor:{GUID}path to bind it",
      );
    }
  }
  if (destRel.toLowerCase() === stripRef(ref).toLowerCase() && src.source === "project") {
    throw new Refusal("INVALID_ARGUMENT", "a file cannot inherit from itself");
  }
  const eol = (() => {
    const t = srcDoc.tokens.find((x) => x.kind === "eol");
    return t ? t.text : "\n";
  })();
  const trailing = /[\r\n]$/.test(srcDoc.text) ? eol : "";
  let work = new CstDocument(`${root.key} : "${ref}" {${eol}}${trailing}`, srcDoc.encoding);
  const changed: Change[] = [{ path: "ancestor", before: null, after: ref }];
  for (const [prop, v] of Object.entries(args.values ?? {})) {
    work = cloneDoc(work);
    const childProp = overrideBlocks(work, srcDoc, prop);
    work.set(childProp, asScalar(v, `values.${prop}`));
    const e = work.resolve(childProp);
    changed.push({ path: prop, before: null, after: work.text.slice(e.start, e.end) });
    if (childProp !== prop) {
      warnings.push(
        `${prop}: the blocks above it are written as overrides of the ancestor's (their header only: key, class, GUID); in the new file it is ${childProp}`,
      );
    }
  }
  return { text: work.text, changed, warnings, ancestor: ref };
}

/**
 * createInherited/override: a new inherited file holds only what it overrides (W2 run 3: a value
 * under `m_aHintEntries.SCR_HintEntry.m_HintInfo` was refused PATH_NOT_FOUND on the empty child).
 * Each block on the path to `prop` that the child lacks is added as an override of the ancestor's
 * block: its header copied (key, class, name, GUID; no base, no entries), the form an inherited
 * Enfusion file overrides an ancestor's element by. Returns the path of `prop` in the child; an
 * index segment becomes the child's own position of that block.
 */
export function overrideBlocks(work: CstDocument, srcDoc: CstDocument, prop: string): string {
  const segs = splitPath(prop);
  const childSegs: string[] = [];
  for (let k = 0; k < segs.length - 1; k++) {
    const srcPath = joinPath(segs.slice(0, k + 1));
    let srcEntry: CstEntry;
    try {
      srcEntry = srcDoc.resolve(srcPath);
    } catch (e) {
      if (e instanceof CstEditError && e.code === "PATH_NOT_FOUND") {
        throw new CstEditError("PATH_NOT_FOUND", `the ancestor has no ${srcPath}: ${e.message}`);
      }
      throw e;
    }
    if (srcEntry.kind !== "object") {
      throw new CstEditError("UNSUPPORTED", `${srcPath} is not a block in the ancestor`);
    }
    // GUIDs compare case aside: the added header writes them upper case.
    const headKey = (o: CstObject): string =>
      o.head
        .map((t) => `${t.kind}:${tokenValue(t)}`)
        .join("\u0000")
        .toLowerCase();
    const head = headKey(srcEntry);
    const parentPath = joinPath(childSegs);
    const sameHead = (c: CstEntry): boolean => c.kind === "object" && headKey(c) === head;
    let block = blockOf(work, parentPath);
    let at = block.children.findIndex(sameHead);
    if (at < 0) {
      work.createObject(parentPath, headerSpec(srcEntry, srcPath));
      block = blockOf(work, parentPath);
      at = block.children.findIndex(sameHead);
      if (at < 0)
        throw new CstEditError(
          "UNSUPPORTED",
          `${srcPath}: the override block was not found after it was added`,
        );
    }
    // The block's key reaches it when it is the first child with that key; else its index does.
    const key = (block.children[at] as CstObject).key;
    const firstWithKey = block.children.findIndex((c) => c.kind === "object" && c.key === key);
    childSegs.push(
      firstWithKey === at && /^\$?[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? key : `[${at}]`,
    );
  }
  childSegs.push(segs[segs.length - 1]!);
  return joinPath(childSegs);
}

/** The path's segments, an index (`[2]`) its own segment. */
function splitPath(prop: string): string[] {
  const out: string[] = [];
  for (const part of prop.split(".")) {
    const m = /^([^[]*)((?:\[\d+\])*)$/.exec(part);
    if (!m) throw new CstEditError("INVALID_ARGUMENT", `bad path segment '${part}' in ${prop}`);
    if (m[1]) out.push(m[1]);
    for (const x of m[2]!.matchAll(/\[\d+\]/g)) out.push(x[0]);
  }
  if (!out.length) throw new CstEditError("INVALID_ARGUMENT", "empty property path");
  return out;
}

function joinPath(segs: readonly string[]): string {
  let s = "";
  for (const g of segs) s += g.startsWith("[") ? g : (s ? "." : "") + g;
  return s;
}

/** The header of an ancestor block as an ObjectSpec: key, then class, name and GUID. */
function headerSpec(o: CstObject, where: string): ObjectSpec {
  const spec: ObjectSpec = { key: tokenValue(o.head[0]!) };
  for (const t of o.head.slice(1)) {
    const v = tokenValue(t);
    if (
      t.kind === "word" &&
      spec.className === undefined &&
      spec.name === undefined &&
      spec.guid === undefined
    ) {
      spec.className = v;
    } else if (t.kind === "string" && /^\{[0-9A-Fa-f]{16}\}$/.test(v) && spec.guid === undefined) {
      spec.guid = v;
    } else if (spec.name === undefined && spec.guid === undefined) {
      spec.name = v;
    } else {
      throw new CstEditError(
        "UNSUPPORTED",
        `${where}: a header this tool does not copy (${o.head.map((h) => h.text).join(" ")})`,
      );
    }
  }
  return spec;
}

function doCreate(args: ConfigEditArgs, src: Located, root: string | undefined): ActionResponse {
  mustExist(src);
  const srcDoc = parseCstBytes(src.bytes);
  let destRel: string;
  if (args.action === "override") {
    if (src.source !== "game") {
      throw new Refusal(
        "INVALID_ARGUMENT",
        `${src.rel} is already in the project: override copies a game resource`,
        "Edit the project file with set / arrayAdd, or createInherited for a new file that inherits from it.",
      );
    }
    destRel = src.rel;
  } else {
    if (!args.newPath) throw new Refusal("INVALID_ARGUMENT", "createInherited needs newPath");
    destRel = projectFile(args.newPath, root, "newPath").rel;
    checkExtension(destRel, "newPath");
    if (extOf(destRel) !== extOf(src.rel)) {
      throw new Refusal("INVALID_ARGUMENT", `newPath must keep the extension ${extOf(src.rel)}`);
    }
  }
  const { abs } = projectFile(destRel, root, "newPath");
  const target = `path:${destRel}`;
  if (existsSync(abs) && args.overwrite !== true) {
    throw new Refusal(
      "INVALID_ARGUMENT",
      `${destRel} already exists in the project; pass overwrite:true to replace it`,
      "Nothing was written. Use set / arrayAdd on the existing file, or another newPath.",
    );
  }
  const plan = planCreate(args, src as Located & { bytes: Buffer }, srcDoc, destRel);
  const doc = new CstDocument(plan.text, srcDoc.encoding);
  if (doc.diagnostics.length > 0) {
    throw new Refusal(
      "INVALID_ARGUMENT",
      `the new file does not parse: ${doc.diagnostics[0].message}`,
    );
  }
  const bytes = doc.toBytes();
  const overwriting = existsSync(abs);
  const warnings = [...plan.warnings];
  if (overwriting) warnings.push(`${destRel} is replaced (overwrite:true)`);
  if (args.action === "override") {
    warnings.push(
      "override writes the game file's own relative path into the project; whether the engine takes it over is checked live, not here",
    );
  }
  const confirm = args.confirm === true;
  const readback: Record<string, unknown> = {
    dryRun: !confirm,
    created: destRel,
    ancestor: plan.ancestor,
    bytes: bytes.length,
    text: doc.text,
  };
  const register = `wb_resources register path:${destRel}`;
  if (!confirm) {
    return {
      ok: true,
      action: args.action,
      target,
      changed: plan.changed,
      readback,
      next: `Nothing was written. Repeat with confirm:true to create the file, then ${register}.`,
      warnings,
    };
  }
  mkdirSync(dirname(abs), { recursive: true });
  writeFileAtomic(abs, bytes);
  readback.written = true;
  readback.verified = readFileSync(abs).equals(bytes);
  return {
    ok: true,
    action: args.action,
    target,
    changed: plan.changed,
    readback,
    next: `Written. The Workbench does not know it yet: ${register}. To undo, delete the file.`,
    warnings,
  };
}

// ── Entry point ──────────────────────────────────────────────────────────────

/** One call of the tool; never throws. */
export function runConfigEdit(args: ConfigEditArgs, config: Config): ActionResponse {
  const target = `path:${stripRef(args.path ?? "")}`;
  try {
    if (!args.path) throw new Refusal("INVALID_ARGUMENT", "path is required");
    const root = pinnedProjectRoot(args.projectPath, config.projectPath);
    // A write on a game resource is found too, so it is refused with the way forward.
    const l = locate(args.path, root, config, args.action === "read");
    if (args.action === "read") return doRead(args, l, config);
    if (args.action === "createInherited" || args.action === "override") {
      return doCreate(args, l, root);
    }
    mustExist(l);
    const doc = parseCstBytes(l.bytes);
    guardWritable(l, doc, args.action);
    let plan: Plan;
    switch (args.action) {
      case "set":
        plan = planSet(doc, args);
        break;
      case "clear":
        plan = planClear(doc, args);
        break;
      case "arrayAdd":
        plan = planArrayAdd(doc, args);
        break;
      case "arrayRemove":
        plan = planArrayRemove(doc, args);
        break;
      case "setAncestor":
        plan = planSetAncestor(doc, args, l.rel);
        break;
      default:
        throw new Refusal("INVALID_ARGUMENT", `unknown action ${String(args.action)}`);
    }
    return commitEdit(args, l, plan, doc);
  } catch (e) {
    return failure(args.action, target, e);
  }
}

const SCALAR = z.union([z.string(), z.number(), z.boolean()]);
const VALUE = z.union([SCALAR, z.array(SCALAR)]);

export function registerConfigEdit(server: McpServer, config: Config): void {
  server.registerTool(
    "config_edit",
    {
      description: CONFIG_EDIT_DESCRIPTION,
      inputSchema: {
        action: z.enum(CONFIG_EDIT_ACTIONS),
        path: z
          .string()
          .describe(
            "Project-relative resource path (read, createInherited, override also take a game resource).",
          ),
        property: z
          .string()
          .optional()
          .describe(
            "Path inside the file, as read lists it (Actions.Action[1].Type). arrayAdd/arrayRemove: the block ('' or omitted = the root block).",
          ),
        value: VALUE.optional().describe("set: the new value; a list writes several on one line."),
        quoted: z
          .boolean()
          .optional()
          .describe("set: force quotes on or off (default: as the slot has)."),
        item: z
          .unknown()
          .optional()
          .describe(
            "arrayAdd: a scalar, {value}, {key,value} or an object {key, className?, name?, guid?, base?, entries?: [...]}.",
          ),
        index: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("arrayAdd position (default end); arrayRemove entry."),
        ancestor: z
          .string()
          .optional()
          .describe(
            "setAncestor, createInherited, override: {GUID}path. setAncestor: '' removes it.",
          ),
        newPath: z.string().optional().describe("createInherited: the new file, project-relative."),
        values: z
          .record(z.string(), VALUE)
          .optional()
          .describe("createInherited, override: {propertyPath: value} set in the new file."),
        depth: z
          .number()
          .int()
          .min(1)
          .max(8)
          .optional()
          .describe("read: outline depth (default 2)."),
        limit: z.number().int().min(1).max(200).optional().describe("read: entries (default 100)."),
        schema: z.boolean().optional().describe("read: add the API-index schema (default true)."),
        confirm: z.boolean().optional().describe("true writes; otherwise a dry run."),
        overwrite: z
          .boolean()
          .optional()
          .describe("createInherited, override: replace an existing file."),
        projectPath: z
          .string()
          .optional()
          .describe("Addon root. Uses the configured project when omitted."),
      },
    },
    async (args) => {
      const res = runConfigEdit(args as ConfigEditArgs, config);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(res, null, 2) }],
        isError: !res.ok,
      };
    },
  );
}
