/**
 * The NET surface (E04, plan 4.5): everything a client can call on
 * Workbench's NET API port, read from the game's script source.
 *
 *  - Native functions: the built-in `APIFunc` names that Bohemia's
 *    `scripts/WorkbenchGameCommon/NetApiDocs.c` documents, with the request
 *    and response shape of each `\code{.json}` block.
 *  - Script handlers: every class whose parent chain reaches `NetApiHandler`
 *    (the class name is the `APIFunc`, per the base class's doc comment).
 *    The request class is what `GetRequest()` returns; the response classes
 *    are what `GetResponse()` returns.
 *  - Fields: the JSON keys those classes register. The mechanism is
 *    `JsonApiStruct` (`scripts/GameLib/generated/online/JsonApiStruct.c`):
 *    `RegV("name")` registers one member variable, `RegAll()` registers every
 *    variable on the object, `UnregV("name")` removes one, and an `OnPack()`
 *    override writes keys itself with `StoreString` / `StartArray` /
 *    `StartObject` and the like. Constructors of every class in the chain
 *    run, so a parent's `RegV` calls count for the child (inherited fields).
 *
 * Pure functions over the E02 source index (`source-index.ts`) and the text
 * of the files it names. Method bodies are not in the index, so they are
 * read here with the E02 lexer (`lex`) from the file text. Nothing is
 * executed.
 */
import { compareCodeUnits } from "./canon.js";
import { firstSentence, lex, type MethodRecord } from "./enforce-source.js";
import {
  classChain,
  findClass,
  methodsOf,
  pakRef,
  type FieldRecord,
  type MergedClass,
  type SourceIndex,
} from "./source-index.js";
import { MODULES, type Module } from "./vocab.js";

export const NET_HANDLER_BASE = "NetApiHandler";
export const JSON_STRUCT_BASE = "JsonApiStruct";
export const NET_DOCS_FILE = "scripts/WorkbenchGameCommon/NetApiDocs.c";
const QUOTE_MAX = 200;

type Tok = ReturnType<typeof lex>["toks"][number];

/** File text by virtual path (undefined when absent). */
export type ReadText = (path: string) => string | undefined;

/** Lexed files, cached. */
export class SourceTexts {
  private readonly toksCache = new Map<string, Tok[] | null>();
  private readonly linesCache = new Map<string, string[] | null>();
  /** Every file read so far (inputs of the run). */
  readonly touched = new Set<string>();
  constructor(private readonly read: ReadText) {}

  lines(file: string): string[] | undefined {
    let l = this.linesCache.get(file);
    if (l === undefined) {
      const t = this.read(file);
      l = t === undefined ? null : t.replace(/^﻿/, "").split(/\r?\n/);
      this.linesCache.set(file, l);
      if (t !== undefined) this.touched.add(file);
    }
    return l ?? undefined;
  }

  toks(file: string): Tok[] | undefined {
    let t = this.toksCache.get(file);
    if (t === undefined) {
      const text = this.read(file);
      t = text === undefined ? null : lex(text).toks;
      this.toksCache.set(file, t);
      if (text !== undefined) this.touched.add(file);
    }
    return t ?? undefined;
  }

  /** The trimmed line, at most 200 characters. */
  quote(file: string, line: number): string | undefined {
    const t = this.lines(file)?.[line - 1]?.trim();
    return t ? t.slice(0, QUOTE_MAX) : undefined;
  }
}

// ── Native functions (NetApiDocs.c) ─────────────────────────────────────────

export interface DocField {
  name: string;
  type: string;
}

export interface NativeDoc {
  name: string;
  /** Line of the `- **Name**` bullet. */
  line: number;
  quote: string;
  request: DocField[];
  response: DocField[];
  /**
   * The `//` comments of the request and response blocks, in order. They
   * describe keys, not the function, so they never become a row's `what`
   * (NetApiDocs.c has no sentence describing any of the functions).
   */
  comments: string[];
  /** Lines of the request and response code blocks. */
  requestLine: number;
  responseLine: number;
}

/** Removes `//` comments outside strings; returns the text and the comments in order. */
function stripJsonComments(text: string): { json: string; comments: string[] } {
  let out = "";
  const comments: string[] = [];
  let i = 0;
  let str = false;
  while (i < text.length) {
    const c = text[i];
    if (str) {
      out += c;
      if (c === "\\") {
        out += text[i + 1] ?? "";
        i += 2;
        continue;
      }
      if (c === '"') str = false;
      i++;
      continue;
    }
    if (c === '"') {
      str = true;
      out += c;
      i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "/") {
      const end = text.indexOf("\n", i);
      const stop = end === -1 ? text.length : end;
      comments.push(text.slice(i + 2, stop).trim());
      i = stop;
      continue;
    }
    out += c;
    i++;
  }
  return { json: out.replace(/,(\s*[}\]])/g, "$1"), comments };
}

const TYPE_WORDS = new Set(["string", "bool", "int", "float", "vector", "object", "array"]);

function docType(v: unknown): string {
  if (typeof v === "string") return TYPE_WORDS.has(v) ? v : "string";
  if (typeof v === "boolean") return "bool";
  if (typeof v === "number") return Number.isInteger(v) ? "int" : "float";
  if (Array.isArray(v)) {
    const first = v[0];
    if (first && typeof first === "object" && !Array.isArray(first)) {
      const inner = Object.entries(first as Record<string, unknown>)
        .map(([k, x]) => `${k}: ${docType(x)}`)
        .join(", ");
      return `array<{${inner}}>`;
    }
    return first === undefined ? "array" : `array<${docType(first)}>`;
  }
  if (v && typeof v === "object") return "object";
  return "null";
}

/**
 * The built-in functions documented in NetApiDocs.c: every `- **Name**`
 * bullet of the request-payload section, with its two `\code{.json}` blocks
 * (request, then response). Keys are kept in source order; `APIFunc` is the
 * function selector, not a parameter.
 */
export function parseNetApiDocs(text: string): NativeDoc[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const start = lines.findIndex((l) => /\\subsubsection\s+Page_NetApiDocs_RequestPayload/.test(l));
  const stop = lines.findIndex((l) => /\\subsection\s+Page_NetApiDocs_Response\b/.test(l));
  if (start === -1) return [];
  const end = stop === -1 ? lines.length : stop;
  const out: NativeDoc[] = [];
  for (let i = start; i < end; i++) {
    const m = /^\s*-\s+\*\*(\w+)\*\*\s*$/.exec(lines[i]);
    if (!m) continue;
    const blocks: { at: number; body: string }[] = [];
    let j = i + 1;
    while (j < end && blocks.length < 2 && !/^\s*-\s+\*\*\w+\*\*\s*$/.test(lines[j])) {
      if (/\\code\{\.json\}/.test(lines[j])) {
        const at = j + 1;
        const body: string[] = [];
        j++;
        while (j < end && !/\\endcode/.test(lines[j])) body.push(lines[j++]);
        blocks.push({ at, body: body.join("\n") });
      }
      j++;
    }
    if (blocks.length < 2) continue;
    const req = stripJsonComments(blocks[0].body);
    const resp = stripJsonComments(blocks[1].body);
    const reqObj = JSON.parse(req.json) as Record<string, unknown>;
    const respObj = JSON.parse(resp.json) as Record<string, unknown>;
    out.push({
      name: m[1],
      line: i + 1,
      quote: lines[i].trim(),
      request: Object.entries(reqObj)
        .filter(([k]) => k !== "APIFunc")
        .map(([k, v]) => ({ name: k, type: docType(v) })),
      response: Object.entries(respObj).map(([k, v]) => ({ name: k, type: docType(v) })),
      comments: [...req.comments, ...resp.comments].filter(Boolean),
      requestLine: blocks[0].at,
      responseLine: blocks[1].at,
    });
    i = j - 1;
  }
  return out;
}

/** `Name(a: t, ...) -> {k: t, ...}`, the shape form E08 also writes. */
export function shapeSignature(name: string, req: DocField[], resp: DocField[]): string {
  return `${name}(${req.map((f) => `${f.name}: ${f.type}`).join(", ")}) -> {${resp
    .map((f) => `${f.name}: ${f.type}`)
    .join(", ")}}`;
}

// ── Token helpers ─────────────────────────────────────────────────────────────

const KEYWORDS = new Set([
  "if",
  "for",
  "foreach",
  "while",
  "switch",
  "return",
  "sizeof",
  "typename",
  "case",
  "else",
  "new",
  "delete",
  "thread",
  "super",
  "this",
]);

function matchClose(toks: Tok[], open: number): number {
  const o = toks[open].t;
  const c = o === "(" ? ")" : o === "{" ? "}" : o === "[" ? "]" : ">";
  let depth = 0;
  for (let i = open; i < toks.length; i++) {
    if (toks[i].t === o) depth++;
    else if (toks[i].t === c) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return toks.length - 1;
}

/** Token range of a method's body (between the braces), or undefined for a declaration without one. */
export function bodyRange(
  toks: Tok[],
  name: string,
  line: number,
): { start: number; end: number } | undefined {
  let at = -1;
  for (let i = 0; i < toks.length - 1; i++) {
    const t = toks[i];
    if (t.line < line) continue;
    if (t.line > line + 3) break;
    if (t.k === "id" && t.t === name && toks[i + 1].t === "(") {
      at = i;
      break;
    }
  }
  if (at === -1) return undefined;
  let k = matchClose(toks, at + 1) + 1;
  while (k < toks.length && toks[k].t !== "{" && toks[k].t !== ";") k++;
  if (k >= toks.length || toks[k].t === ";") return undefined;
  return { start: k + 1, end: matchClose(toks, k) };
}

/** A string token's value without its quotes. */
function strValue(t: Tok): string {
  return t.t.slice(1, -1).replace(/\\(.)/g, "$1");
}

/** Base identifier of a declared type: `ref array<string>` -> `array`, `notnull MetaFile` -> `MetaFile`. */
export function baseType(type: string): string {
  const words = type
    .replace(/<.*$/s, "")
    .replace(/\[.*$/s, "")
    .trim()
    .split(/\s+/)
    .filter(
      (w) =>
        ![
          "ref",
          "notnull",
          "out",
          "inout",
          "const",
          "owned",
          "autoptr",
          "private",
          "protected",
          "static",
          "local",
        ].includes(w),
    );
  return words[words.length - 1] ?? "";
}

/** A field's type as a signature: `ref array<ref MatParam>` -> `array<MatParam>`. */
export function fieldTypeText(f: FieldRecord): string {
  const t = f.type
    .replace(/\b(ref|autoptr|owned|notnull)\s+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return f.array ? `${t}[${f.array}]` : t;
}

// ── Code-path scan ────────────────────────────────────────────────────────────

/** A call in a scanned body. */
export interface CallSite {
  /** `Class.Method` when the receiver resolved, else the method name. */
  api: string;
  cls?: string;
  name: string;
  file: string;
  line: number;
  /** First argument when it is a single identifier or string. */
  arg0?: string;
}

interface Ctx {
  index: SourceIndex;
  src: SourceTexts;
}

function isClass(ctx: Ctx, name: string): boolean {
  const c = findClass(ctx.index, name);
  return c !== undefined && c.declarations.length > 0;
}

/** True when the class's parent chain reaches `base` (the class itself excluded). */
export function inheritsFrom(index: SourceIndex, name: string, base: string): boolean {
  return classChain(index, name)
    .slice(1)
    .some((c) => c.name === base);
}

function returnTypeOf(ctx: Ctx, cls: string | undefined, name: string): string | undefined {
  if (cls === undefined) {
    const f = ctx.index.functions.get(name)?.[0];
    return f ? baseType(f.return_type) : undefined;
  }
  const m = methodsOf(ctx.index, cls).find((v) => v.method.name === name);
  return m ? baseType(m.method.return_type) : undefined;
}

/**
 * Declared type of identifier `name` used at token `before` inside the body
 * [`start`, `before`) of `method`: a local declaration (nearest first), a
 * parameter, then a member of the method's class chain.
 */
function varType(
  ctx: Ctx,
  toks: Tok[],
  start: number,
  before: number,
  name: string,
  method: MethodRecord | undefined,
): string | undefined {
  const FOLLOW = new Set(["=", ";", ",", ")", ":"]);
  for (let k = before - 1; k > start; k--) {
    const t = toks[k];
    if (t.k !== "id" || t.t !== name || !FOLLOW.has(toks[k + 1]?.t ?? "")) continue;
    let p = k - 1;
    if (toks[p].t === ">") {
      let depth = 0;
      for (; p > start; p--) {
        if (toks[p].t === ">") depth++;
        else if (toks[p].t === "<") {
          depth--;
          if (depth === 0) break;
        }
      }
      p--;
    }
    const prev = toks[p];
    if (!prev || prev.k !== "id" || KEYWORDS.has(prev.t)) continue;
    if (prev.t === "auto" && toks[k + 1].t === "=") {
      const a = toks[k + 2];
      const b = toks[k + 3];
      if (a?.t === "new") return toks[k + 3]?.t;
      if (a?.k === "id" && b?.t === "(") return returnTypeOf(ctx, undefined, a.t);
      if (a?.k === "id" && b?.t === "." && toks[k + 5]?.t === "(" && isClass(ctx, a.t))
        return returnTypeOf(ctx, a.t, toks[k + 4].t);
      return undefined;
    }
    return prev.t;
  }
  const param = method?.params.find((p) => p.name === name);
  if (param) return baseType(param.type);
  if (method?.owner) {
    for (const c of classChain(ctx.index, method.owner)) {
      const f = c.fields.find((x) => x.name === name);
      if (f) return baseType(f.type);
    }
  }
  return undefined;
}

/** Calls in a body, with resolved receivers where the source declares them. */
function callsIn(
  ctx: Ctx,
  file: string,
  toks: Tok[],
  range: { start: number; end: number },
  method: MethodRecord | undefined,
): { site: CallSite; targets: MethodRecord[] }[] {
  const out: { site: CallSite; targets: MethodRecord[] }[] = [];
  const owner = method?.owner;
  const methodsNamed = (cls: string, name: string): MethodRecord[] =>
    methodsOf(ctx.index, cls)
      .filter((v) => v.method.name === name)
      .map((v) => v.method);
  const ctors = (cls: string): MethodRecord[] =>
    classChain(ctx.index, cls).flatMap((c) =>
      c.methods.filter((m) => m.name === c.name && m.owner === c.name),
    );
  for (let i = range.start; i < range.end; i++) {
    const t = toks[i];
    if (t.t === "new" && toks[i + 1]?.k === "id") {
      const cls = toks[i + 1].t;
      out.push({
        site: { api: `new ${cls}`, cls, name: cls, file, line: t.line },
        targets: isClass(ctx, cls) ? ctors(cls) : [],
      });
      i++;
      continue;
    }
    if (t.k !== "id" || toks[i + 1]?.t !== "(" || KEYWORDS.has(t.t)) continue;
    const a0 = toks[i + 2];
    const a1 = toks[i + 3];
    const arg0 =
      a0 && (a1?.t === ")" || a1?.t === ",") && (a0.k === "id" || a0.k === "str")
        ? a0.k === "str"
          ? strValue(a0)
          : a0.t
        : undefined;
    const prev = toks[i - 1];
    let cls: string | undefined;
    let targets: MethodRecord[] = [];
    if (prev?.t === ".") {
      const recv = toks[i - 2];
      if (recv?.k === "id") {
        if (recv.t === "this" || recv.t === "super") cls = owner;
        else if (isClass(ctx, recv.t) && !varType(ctx, toks, range.start, i - 2, recv.t, method))
          cls = recv.t;
        else cls = varType(ctx, toks, range.start, i - 2, recv.t, method);
      }
      if (cls && isClass(ctx, cls)) targets = methodsNamed(cls, t.t);
    } else if (prev?.t === "new") {
      continue;
    } else if (isClass(ctx, t.t)) {
      cls = t.t;
      targets = ctors(t.t);
    } else if (owner && methodsNamed(owner, t.t).length > 0) {
      cls = owner;
      targets = methodsNamed(owner, t.t);
    } else {
      targets = ctx.index.functions.get(t.t) ?? [];
    }
    const site: CallSite = {
      api: cls ? `${cls}.${t.t}` : t.t,
      name: t.t,
      file,
      line: t.line,
      ...(cls ? { cls } : {}),
      ...(arg0 !== undefined ? { arg0 } : {}),
    };
    out.push({ site, targets });
  }
  return out;
}

/** Every call reachable from `roots` through script bodies (depth-limited). */
export function reachableCalls(
  index: SourceIndex,
  src: SourceTexts,
  roots: MethodRecord[],
  maxDepth = 8,
): CallSite[] {
  const ctx: Ctx = { index, src };
  const seen = new Set<string>();
  const out: CallSite[] = [];
  let frontier = roots.map((m) => ({ m, d: 0 }));
  while (frontier.length > 0) {
    const next: { m: MethodRecord; d: number }[] = [];
    for (const { m, d } of frontier) {
      const key = `${m.file}\u0000${m.line}\u0000${m.name}`;
      if (seen.has(key) || !m.has_body) continue;
      seen.add(key);
      const toks = src.toks(m.file);
      if (!toks) continue;
      const range = bodyRange(toks, m.name, m.line);
      if (!range) continue;
      for (const c of callsIn(ctx, m.file, toks, range, m)) {
        out.push(c.site);
        if (d < maxDepth) for (const t of c.targets) next.push({ m: t, d: d + 1 });
      }
    }
    frontier = next;
  }
  return out;
}

/** True when a call's resolved class is, or inherits from, `cls`. */
function callOn(index: SourceIndex, site: CallSite, cls: string): boolean {
  return site.cls !== undefined && classChain(index, site.cls).some((c) => c.name === cls);
}

/**
 * Calls that write files or asset data, each stated by the API's own name
 * and doc comment in the source index: `SaveContainer` ("Save BaseContainer
 * to file"), `RegisterResourceFile` ("create meta file"),
 * `RebuildResourceFile`, `MetaFile.Save`, `FileIO.CopyFile` ("copy file"),
 * `SaveEntityTemplate`, `SetVariableValue` / `CreateObjectArrayVariableMember`
 * (prefab edits), `SetTerrainSurfaceTile` ("Write terrain height"),
 * `TxaExporter.TrackExport`.
 */
export const WRITER_APIS: readonly { cls: string; name: string }[] = [
  { cls: "BaseContainerTools", name: "SaveContainer" },
  { cls: "ResourceManager", name: "RegisterResourceFile" },
  { cls: "ResourceManager", name: "RebuildResourceFile" },
  { cls: "MetaFile", name: "Save" },
  { cls: "FileIO", name: "CopyFile" },
  { cls: "WorldEditorAPI", name: "SaveEntityTemplate" },
  { cls: "WorldEditorAPI", name: "SetVariableValue" },
  { cls: "WorldEditorAPI", name: "CreateObjectArrayVariableMember" },
  { cls: "WorldEditorAPI", name: "SetTerrainSurfaceTile" },
  { cls: "TxaExporter", name: "TrackExport" },
];

/** Calls that open a modal dialog and wait for it (`Workbench.ScriptDialog`, `Workbench.Dialog`). */
export const DIALOG_APIS: readonly { cls: string; name: string }[] = [
  { cls: "Workbench", name: "ScriptDialog" },
  { cls: "Workbench", name: "Dialog" },
];

const WB_MODULES: readonly string[] = MODULES.slice(0, 11);

// ── Field registration ────────────────────────────────────────────────────────

export type FieldMechanism = "RegV" | "RegAll" | "OnPack";

export interface FieldInfo {
  name: string;
  dir: "req" | "resp";
  type: string;
  mechanism: FieldMechanism;
  /** The JsonApiStruct class the field belongs to (request or response class). */
  struct: string;
  /** Class whose code registers it (an ancestor of `struct` for inherited fields). */
  registered_in: string;
  inherited: boolean;
  file: string;
  line: number;
  doc?: string;
  /** Set when `UnregV` may remove the field again. */
  unregistered_at?: string;
}

export interface StructScan {
  fields: FieldInfo[];
  /** Keys written under a name the source computes at run time. */
  dynamic: string[];
}

function adjacentComment(src: SourceTexts, file: string, line: number): string | undefined {
  const prev = src.lines(file)?.[line - 2];
  const m = prev !== undefined ? /^\s*\/\/+!?\s*(.*?)\s*$/.exec(prev) : null;
  if (!m || !/[A-Za-z]/.test(m[1]) || /^\[.*\]$/.test(m[1])) return undefined;
  return m[1];
}

function docOf(
  src: SourceTexts,
  rec: { doc?: string; file: string; line: number },
): string | undefined {
  const s = firstSentence(rec.doc);
  return s ?? adjacentComment(src, rec.file, rec.line);
}

const STORE_TYPES: Readonly<Record<string, string>> = {
  StoreString: "string",
  StoreInteger: "int",
  StoreFloat: "float",
  StoreBoolean: "bool",
  StoreVector: "vector",
  StoreObject: "object",
  StartObject: "object",
  StartArray: "array",
};

function fieldOf(index: SourceIndex, struct: string, name: string): FieldRecord | undefined {
  for (const c of classChain(index, struct)) {
    const f = c.fields.find((x) => x.name === name);
    if (f) return f;
  }
  return undefined;
}

function instanceFields(index: SourceIndex, struct: string): FieldRecord[] {
  const chain = classChain(index, struct);
  const stop = chain.findIndex((c) => c.name === JSON_STRUCT_BASE);
  return chain
    .slice(0, stop === -1 ? chain.length : stop)
    .reverse()
    .flatMap((c) =>
      c.fields.filter((f) => !f.modifiers.includes("static") && !f.modifiers.includes("const")),
    );
}

/** The JSON keys a JsonApiStruct class registers (RegV / RegAll / UnregV in its constructors, OnPack keys at the top level). */
export function scanStruct(
  index: SourceIndex,
  src: SourceTexts,
  struct: string,
  dir: "req" | "resp",
): StructScan {
  const fields = new Map<string, FieldInfo>();
  const dynamic: string[] = [];
  const chain = classChain(index, struct);
  const stop = chain.findIndex((c) => c.name === JSON_STRUCT_BASE);
  const own = chain.slice(0, stop === -1 ? chain.length : stop).reverse();
  const add = (f: FieldInfo): void => {
    if (!fields.has(f.name)) fields.set(f.name, f);
  };
  const ctxFor = (c: MergedClass): MethodRecord[] =>
    c.methods.filter((m) => m.name === c.name && m.owner === c.name && m.has_body);
  // Constructors base-first; same-class methods they call are followed.
  for (const c of own) {
    const visited = new Set<string>();
    const walk = (m: MethodRecord, depth: number): void => {
      const key = `${m.file}:${m.line}`;
      if (visited.has(key) || depth > 3) return;
      visited.add(key);
      const toks = src.toks(m.file);
      const r = toks ? bodyRange(toks, m.name, m.line) : undefined;
      if (!toks || !r) return;
      for (let i = r.start; i < r.end; i++) {
        const t = toks[i];
        if (t.k !== "id" || toks[i + 1]?.t !== "(") continue;
        const prev = toks[i - 1];
        if (prev?.t === "." && toks[i - 2]?.t !== "this") continue;
        const a0 = toks[i + 2];
        if (t.t === "RegV" && a0?.k === "str") {
          const name = strValue(a0);
          const decl = fieldOf(index, struct, name);
          add({
            name,
            dir,
            type: decl ? fieldTypeText(decl) : "unknown",
            mechanism: "RegV",
            struct,
            registered_in: c.name,
            inherited: c.name !== struct,
            file: m.file,
            line: t.line,
            ...(decl && docOf(src, decl) ? { doc: docOf(src, decl) } : {}),
          });
        } else if (t.t === "RegAll") {
          for (const f of instanceFields(index, struct)) {
            add({
              name: f.name,
              dir,
              type: fieldTypeText(f),
              mechanism: "RegAll",
              struct,
              registered_in: c.name,
              inherited: f.owner !== struct,
              file: f.file,
              line: f.line,
              ...(docOf(src, f) ? { doc: docOf(src, f) } : {}),
            });
          }
        } else if (t.t === "UnregV" && a0?.k === "str") {
          const f = fields.get(strValue(a0));
          if (f) f.unregistered_at = pakRef({ file: m.file, line: t.line });
        } else if (prev?.t !== ".") {
          const callee = c.methods.find((x) => x.name === t.t && x.has_body);
          if (callee) walk(callee, depth + 1);
        }
      }
    };
    for (const ctor of ctxFor(c)) walk(ctor, 0);
  }
  // OnPack: keys written at the top level of the JSON object.
  const onPack = methodsOf(index, struct).find(
    (v) => v.method.name === "OnPack" && v.method.has_body && v.declared_in !== JSON_STRUCT_BASE,
  );
  if (onPack) {
    const owner = findClass(index, onPack.declared_in);
    const stack: string[] = [];
    const walk = (m: MethodRecord, depth0: number): void => {
      const key = `${m.file}:${m.line}`;
      if (stack.includes(key)) return;
      stack.push(key);
      const toks = src.toks(m.file);
      const r = toks ? bodyRange(toks, m.name, m.line) : undefined;
      let depth = depth0;
      if (toks && r) {
        for (let i = r.start; i < r.end; i++) {
          const t = toks[i];
          if (t.k !== "id" || toks[i + 1]?.t !== "(") continue;
          const prev = toks[i - 1];
          if (prev?.t === "." && toks[i - 2]?.t !== "this") {
            // An external writer handed `this` writes keys the source does not name.
            const close = matchClose(toks, i + 1);
            const passesThis = toks.slice(i + 2, close).some((x) => x.t === "this");
            if (passesThis && depth === 0)
              dynamic.push(
                `${toks[i - 2]?.t}.${t.t} at ${pakRef({ file: m.file, line: t.line })} writes keys named by data`,
              );
            continue;
          }
          const a0 = toks[i + 2];
          const a1 = toks[i + 3];
          if (t.t in STORE_TYPES) {
            if (depth === 0) {
              if (a0?.k === "str" && (a1?.t === "," || a1?.t === ")")) {
                add({
                  name: strValue(a0),
                  dir,
                  type: STORE_TYPES[t.t],
                  mechanism: "OnPack",
                  struct,
                  registered_in: onPack.declared_in,
                  inherited: onPack.declared_in !== struct,
                  file: m.file,
                  line: t.line,
                });
              } else {
                dynamic.push(
                  `${t.t} with a computed name at ${pakRef({ file: m.file, line: t.line })}`,
                );
              }
            }
            if (t.t === "StartObject" || t.t === "StartArray") depth++;
          } else if (t.t === "EndObject" || t.t === "EndArray") {
            depth--;
          } else if (owner && prev?.t !== ".") {
            const callee = methodsOf(index, owner.name).find(
              (v) => v.method.name === t.t && v.method.has_body,
            );
            if (callee) walk(callee.method, depth);
          }
        }
      }
      stack.pop();
    };
    walk(onPack.method, 0);
  }
  return {
    fields: [...fields.values()].sort(
      (a, b) => a.line - b.line || compareCodeUnits(a.name, b.name),
    ),
    dynamic,
  };
}

// ── Handlers ──────────────────────────────────────────────────────────────────

export interface HandlerInfo {
  name: string;
  file: string;
  line: number;
  quote: string;
  guards: string[];
  /** Declared only under `#ifdef DOXYGEN` (documentation, never compiled in a session). */
  doxygenOnly: boolean;
  what?: string;
  request: string[];
  requestNote?: string;
  response: string[];
  responseNote?: string;
  fields: FieldInfo[];
  dynamic: string[];
  /** Modules the code path drives through `Workbench.GetModule` / `OpenModule`. */
  drives: string[];
  module: Module;
  moduleRule: string;
  dialogs: CallSite[];
  writers: CallSite[];
}

function returnedClasses(
  ctx: Ctx,
  m: MethodRecord,
): { classes: string[]; nulls: number; unresolved: string[] } {
  const toks = ctx.src.toks(m.file);
  const r = toks ? bodyRange(toks, m.name, m.line) : undefined;
  const classes: string[] = [];
  const unresolved: string[] = [];
  let nulls = 0;
  if (!toks || !r) return { classes, nulls, unresolved };
  for (let i = r.start; i < r.end; i++) {
    if (toks[i].t !== "return") continue;
    const e: Tok[] = [];
    let depth = 0;
    for (let j = i + 1; j < r.end; j++) {
      const t = toks[j];
      if (t.t === "(") depth++;
      else if (t.t === ")") depth--;
      else if (t.t === ";" && depth === 0) break;
      e.push(t);
    }
    let cls: string | undefined;
    if (e[0]?.t === "null") {
      nulls++;
      continue;
    } else if (e[0]?.t === "new" && e[1]) cls = e[1].t;
    else if (e[0]?.k === "id" && e[1]?.t === "(")
      cls = isClass(ctx, e[0].t)
        ? e[0].t
        : ((m.owner !== undefined ? returnTypeOf(ctx, m.owner, e[0].t) : undefined) ??
          returnTypeOf(ctx, undefined, e[0].t));
    else if (e[0]?.k === "id" && e[1]?.t === "." && e[2]?.k === "id" && e[3]?.t === "(") {
      const recvCls = isClass(ctx, e[0].t) ? e[0].t : varType(ctx, toks, r.start, i, e[0].t, m);
      cls = recvCls ? returnTypeOf(ctx, recvCls, e[2].t) : undefined;
    } else if (e.length === 1 && e[0].k === "id") cls = varType(ctx, toks, r.start, i, e[0].t, m);
    if (cls && inheritsFrom(ctx.index, cls, JSON_STRUCT_BASE)) {
      if (!classes.includes(cls)) classes.push(cls);
    } else unresolved.push(`${pakRef({ file: m.file, line: toks[i].line })}`);
  }
  return { classes, nulls, unresolved };
}

/** Every class whose parent chain reaches NetApiHandler, sorted by name. */
export function handlerClasses(index: SourceIndex): MergedClass[] {
  return [...index.classes.values()]
    .filter((c) => c.declarations.length > 0 && inheritsFrom(index, c.name, NET_HANDLER_BASE))
    .sort((a, b) => compareCodeUnits(a.name, b.name));
}

function moduleOf(drives: string[], decl: { file: string }): { module: Module; rule: string } {
  const parts = decl.file.split("/");
  for (let i = parts.length - 2; i >= 0; i--)
    if (WB_MODULES.includes(parts[i])) return { module: parts[i] as Module, rule: "folder" };
  if (drives.length === 1) return { module: drives[0] as Module, rule: "drives one module" };
  if (drives.length > 1) return { module: "Shared", rule: "drives several modules" };
  return { module: "none", rule: "no folder and no module driven" };
}

/** Reads every handler: request and response classes, fields, modal and writer calls, module. */
export function analyzeHandlers(index: SourceIndex, src: SourceTexts): HandlerInfo[] {
  const ctx: Ctx = { index, src };
  return handlerClasses(index).map((c) => {
    const decl = c.declarations.find((d) => !d.modded) ?? c.declarations[0];
    const own = methodsOf(index, c.name).filter((v) => v.declared_in !== NET_HANDLER_BASE);
    const getReq = own.find((v) => v.method.name === "GetRequest")?.method;
    const getResp = own.find((v) => v.method.name === "GetResponse")?.method;
    const fields: FieldInfo[] = [];
    const dynamic: string[] = [];
    let request: string[] = [];
    let requestNote: string | undefined;
    if (!getReq)
      requestNote = "GetRequest is not overridden (NetApiHandler.GetRequest has no script body)";
    else {
      const r = returnedClasses(ctx, getReq);
      request = r.classes;
      if (r.classes.length === 0 && r.nulls > 0) requestNote = "GetRequest returns null";
      else if (r.unresolved.length) requestNote = `unresolved return at ${r.unresolved.join(", ")}`;
    }
    let response: string[] = [];
    let responseNote: string | undefined;
    if (!getResp) responseNote = "GetResponse is not overridden";
    else {
      const r = returnedClasses(ctx, getResp);
      response = r.classes;
      if (r.classes.length === 0 && r.nulls > 0) responseNote = "GetResponse returns null";
      else if (r.unresolved.length)
        responseNote = `unresolved return at ${r.unresolved.join(", ")}`;
    }
    for (const s of request) {
      const sc = scanStruct(index, src, s, "req");
      fields.push(...sc.fields);
      dynamic.push(...sc.dynamic.map((d) => `request ${s}: ${d}`));
    }
    const respSeen = new Set<string>();
    for (const s of response) {
      const sc = scanStruct(index, src, s, "resp");
      for (const f of sc.fields) {
        if (respSeen.has(f.name)) continue;
        respSeen.add(f.name);
        fields.push(f);
      }
      dynamic.push(...sc.dynamic.map((d) => `response ${s}: ${d}`));
    }
    const roots = [getReq, getResp].filter((m): m is MethodRecord => m !== undefined);
    const calls = reachableCalls(index, src, roots);
    const matches = (list: readonly { cls: string; name: string }[], s: CallSite): boolean =>
      list.some((w) => w.name === s.name && callOn(index, s, w.cls));
    const uniq = (list: CallSite[]): CallSite[] => {
      const seen = new Set<string>();
      return list
        .filter((s) => {
          const k = `${s.api}\u0000${s.file}\u0000${s.line}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        })
        .sort(
          (a, b) =>
            compareCodeUnits(a.file, b.file) || a.line - b.line || compareCodeUnits(a.api, b.api),
        );
    };
    const dialogs = uniq(calls.filter((s) => matches(DIALOG_APIS, s)));
    const writers = uniq(calls.filter((s) => matches(WRITER_APIS, s)));
    const drives = [
      ...new Set(
        calls
          .filter(
            (s) =>
              (s.name === "GetModule" || s.name === "OpenModule") &&
              callOn(index, s, "Workbench") &&
              s.arg0 !== undefined &&
              WB_MODULES.includes(s.arg0),
          )
          .map((s) => s.arg0 as string),
      ),
    ].sort(compareCodeUnits);
    const { module, rule } = moduleOf(drives, decl);
    const what = docOf(src, decl);
    return {
      name: c.name,
      file: decl.file,
      line: decl.line,
      quote: src.quote(decl.file, decl.line) ?? decl.signature,
      guards: [...decl.guards],
      doxygenOnly: decl.guards.includes("DOXYGEN"),
      ...(what ? { what } : {}),
      request,
      ...(requestNote ? { requestNote } : {}),
      response,
      ...(responseNote ? { responseNote } : {}),
      fields,
      dynamic,
      drives,
      module,
      moduleRule: rule,
      dialogs,
      writers,
    };
  });
}

/** Handler signature in the native-function shape: `Name(req: t, ...) -> {resp: t, ...}`. */
export function handlerSignature(h: HandlerInfo): string {
  const f = (dir: "req" | "resp"): DocField[] =>
    h.fields.filter((x) => x.dir === dir).map((x) => ({ name: x.name, type: x.type }));
  return shapeSignature(h.name, f("req"), f("resp"));
}

// ── Contract table ────────────────────────────────────────────────────────────

export interface ContractEntry {
  /** Handler class or native function name (the APIFunc). */
  name: string;
  kind: "handler" | "native";
  request: string[];
  response: string[];
  ref: string;
}

/** The request and response keys every callable APIFunc declares (DOXYGEN-only handlers left out). */
export function contractTable(handlers: HandlerInfo[], natives: NativeDoc[]): ContractEntry[] {
  const sorted = (xs: string[]): string[] => [...xs].sort(compareCodeUnits);
  return [
    ...handlers
      .filter((h) => !h.doxygenOnly)
      .map((h) => ({
        name: h.name,
        kind: "handler" as const,
        request: sorted(h.fields.filter((f) => f.dir === "req").map((f) => f.name)),
        response: sorted(h.fields.filter((f) => f.dir === "resp").map((f) => f.name)),
        ref: pakRef(h),
      })),
    ...natives.map((n) => ({
      name: n.name,
      kind: "native" as const,
      request: sorted(n.request.map((f) => f.name)),
      response: sorted(n.response.map((f) => f.name)),
      ref: pakRef({ file: NET_DOCS_FILE, line: n.line }),
    })),
  ].sort((a, b) => compareCodeUnits(a.name, b.name));
}

// ── Cross-checks ──────────────────────────────────────────────────────────────

/** One NET function as E19 summarises the Blender add-on's calls to it. */
export interface BlenderNetFunction {
  name: string;
  request_keys: string[];
  response_keys: string[];
  sites: string[];
}

/** Keys the Blender client reads off its own result object, not off the payload. */
export const BLENDER_PROTOCOL_KEYS: readonly string[] = ["ErrorCode"];

export interface CrossEntry {
  name: string;
  kind: "handler" | "native" | "unknown";
  ref?: string;
  sites: string[];
  sent: string[];
  declared_request: string[];
  sent_not_declared: string[];
  declared_not_sent: string[];
  read: string[];
  /** Keys in `read` / `protocol_keys_read` that E04's re-read of the Python added to E19's list. */
  read_added_by_rescan?: RescanRead[];
  protocol_keys_read: string[];
  declared_response: string[];
  read_not_declared: string[];
  declared_not_read: string[];
  /** No key sent that the handler does not declare and no key read that it does not set. */
  consistent: boolean;
  /** Both directions equal as sets. */
  exact: boolean;
}

/** A response key a re-read of the add-on's Python finds and E19's artifact does not list. */
export interface RescanRead {
  key: string;
  /** `<file>#L<line>`, relative to `<tools>/Blender`. */
  at: string;
}

const indentOf = (l: string): number => /^[ \t]*/.exec(l)![0].length;
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Keys read off the variable that holds a NET call's response, from the call
 * line to the end of the enclosing `def` (or until the variable is assigned
 * again): `var["k"]`, `var['k']`, `var.get("k"...)`, `var.pop("k"...)`,
 * anywhere on a non-comment line, so subscripts inside an f-string's braces
 * count.
 * A plain line scan, used only to add keys to E19's per-site lists; it does
 * not follow the response into helpers (E19 does).
 */
export function pythonResponseReads(
  text: string,
  callLine: number,
  responseVar: string,
): { key: string; line: number }[] {
  if (!/^[A-Za-z_]\w*$/.test(responseVar)) return [];
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const at = callLine - 1;
  if (at < 0 || at >= lines.length) return [];
  const callIndent = indentOf(lines[at]);
  let defIndent = -1;
  for (let i = at - 1; i >= 0; i--) {
    if (/^\s*(async\s+)?def\s/.test(lines[i]) && indentOf(lines[i]) < callIndent) {
      defIndent = indentOf(lines[i]);
      break;
    }
  }
  const v = escapeRe(responseVar);
  const reads = [
    new RegExp(`\\b${v}\\s*\\[\\s*(['"])([^'"\\\\\\n]+)\\1\\s*\\]`, "g"),
    new RegExp(`\\b${v}\\.(?:get|pop)\\(\\s*(['"])([^'"\\\\\\n]+)\\1`, "g"),
  ];
  const reassigned = new RegExp(`^\\s*${v}\\s*=(?!=)`);
  const out: { key: string; line: number }[] = [];
  for (let i = at + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*(#.*)?$/.test(l)) continue; // blank or comment-only
    if (indentOf(l) <= defIndent) break;
    if (reassigned.test(l)) break;
    for (const re of reads) {
      re.lastIndex = 0;
      for (let m = re.exec(l); m; m = re.exec(l)) out.push({ key: m[2], line: i + 1 });
    }
  }
  return out;
}

export function crossCheck(
  table: ContractEntry[],
  calls: BlenderNetFunction[],
  rescan?: Map<string, RescanRead[]>,
): { entries: CrossEntry[]; not_called: string[] } {
  const by = new Map(table.map((e) => [e.name, e]));
  const minus = (a: string[], b: string[]): string[] =>
    a.filter((x) => !b.includes(x)).sort(compareCodeUnits);
  const entries = calls
    .map((c): CrossEntry => {
      const e = by.get(c.name);
      const added = (rescan?.get(c.name) ?? [])
        .filter((r) => !c.response_keys.includes(r.key))
        .sort((a, b) => compareCodeUnits(a.key, b.key) || compareCodeUnits(a.at, b.at));
      const allRead = [...new Set([...c.response_keys, ...added.map((r) => r.key)])];
      const read = allRead.filter((k) => !BLENDER_PROTOCOL_KEYS.includes(k));
      const protocol = allRead
        .filter((k) => BLENDER_PROTOCOL_KEYS.includes(k))
        .sort(compareCodeUnits);
      const req = e?.request ?? [];
      const resp = e?.response ?? [];
      const snd = minus(c.request_keys, req);
      const rnd = minus(read, resp);
      return {
        name: c.name,
        kind: e?.kind ?? "unknown",
        ...(e ? { ref: e.ref } : {}),
        sites: [...c.sites].sort(compareCodeUnits),
        sent: [...c.request_keys].sort(compareCodeUnits),
        declared_request: req,
        sent_not_declared: snd,
        declared_not_sent: minus(req, c.request_keys),
        read: [...read].sort(compareCodeUnits),
        ...(rescan ? { read_added_by_rescan: added } : {}),
        protocol_keys_read: protocol,
        declared_response: resp,
        read_not_declared: rnd,
        declared_not_read: minus(resp, read),
        consistent: e !== undefined && snd.length === 0 && rnd.length === 0,
        exact:
          e !== undefined &&
          snd.length === 0 &&
          rnd.length === 0 &&
          minus(req, c.request_keys).length === 0 &&
          minus(resp, read).length === 0,
      };
    })
    .sort((a, b) => compareCodeUnits(a.name, b.name));
  const called = new Set(calls.map((c) => c.name));
  return {
    entries,
    not_called: table
      .filter((e) => !called.has(e.name))
      .map((e) => e.name)
      .sort(compareCodeUnits),
  };
}

/** Parameter and response key names of an E08 shape signature `Name(a: t, ...) -> {k: v, ...}`. */
export function parseShapeSignature(sig: string): { request: string[]; response: string[] } | null {
  const m = /^\w+\((.*?)\)\s*->\s*\{(.*)\}\s*$/s.exec(sig);
  if (!m) return null;
  const split = (s: string): string[] => {
    const out: string[] = [];
    let depth = 0;
    let cur = "";
    for (const ch of s) {
      if ("[{(<".includes(ch)) depth++;
      else if ("]})>".includes(ch)) depth--;
      if (ch === "," && depth === 0) {
        out.push(cur);
        cur = "";
      } else cur += ch;
    }
    if (cur.trim()) out.push(cur);
    return out.map((x) => x.split(":")[0].trim()).filter(Boolean);
  };
  return { request: split(m[1]), response: split(m[2]) };
}
