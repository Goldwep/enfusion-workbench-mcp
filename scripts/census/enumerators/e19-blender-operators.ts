/**
 * E19 — Blender add-on operators (plan 4.5; ENUMERATORS.md). Reads the Python
 * source of Bohemia's Enfusion Blender Tools add-on under `<tools>/Blender`
 * (a folder tree, or `.zip` archives holding `.py` entries, read in memory
 * and never extracted) as text. Nothing is executed and no network call is
 * made (decision D9: evidence and documentation only, never driven).
 *
 * Output:
 *  - `data/census/observations/E19/<build>.jsonl`: one `blender-operator`
 *    row per operator class (a class deriving, directly or through other
 *    classes of the add-on, from `bpy.types.Operator`) that has a literal
 *    `bl_idname` and reaches Workbench's NET API, directly or through the
 *    add-on's Workbench client module. Operators that never reach Workbench
 *    are counted and listed, not emitted.
 *  - `<artifacts>/census/<build>/E19/net-call-sites.json`: every call site
 *    of the Workbench client with the NET function name it calls, the keys of
 *    the parameter dict it sends, the response keys it reads, file and line.
 *    This is the table E04 consumes (plan 4.5, E04 row). Raw material lives
 *    outside the git tree (ENUMERATORS.md "Inputs").
 *
 * HOW REACH IS DECIDED (a static, name-resolved call graph; not a Python
 * interpreter). The source is tokenised into logical lines and split into
 * module, class and function scopes by indentation. Calls are resolved through
 * the file's imports, `self` / `cls` and class hierarchies (ancestors and
 * overriding descendants), `Class.method(...)`, `bpy.ops.<ns>.<name>(...)`
 * (to the operator carrying that `bl_idname`) and bare references to
 * functions (callbacks). The type of a receiver (`x.m()`) is read from the
 * source where it can be: a parameter annotation, a constructor call, a
 * factory's return annotation or return statements, an attribute assigned in
 * the class, a standard-library call (see `Resolver.typeOfName`); a receiver
 * of a library or Blender class is proved to be no project code. Only a call
 * on a receiver whose type the source does not give is matched by method name
 * (edge kind "name"); those never make a row on their own. Every operator
 * row's reach is recorded in the JSON artifact with the shortest chain found.
 *
 * CONDITIONS. An operator whose every path to a Workbench call passes at
 * least one enclosing `if`/`elif`/`else`/`while` (a call edge or the call site
 * itself) keeps its row, at confidence `medium`, with the conditions of the
 * path with the fewest of them in `unverified`: the source states them, this
 * enumerator does not evaluate them. The one exception is a condition the
 * operator decides itself: a bare module variable (`if N:`, `if not N:`) that an
 * entry point of the operator class assigns a constant to, at the top level of
 * its body and before the call the path continues with, while nothing else in
 * the add-on can write the variable otherwise (see `VariableFlow`). When every
 * path of an operator to Workbench is dead that way the operator does not
 * reach Workbench: it gets no row and is listed under left-out with the
 * statement and the condition. A condition the operator does not decide
 * (`if bpy.app.background:`, a parameter, an attribute) is never evaluated.
 *
 * Identity: the ledger derives a `ui` id from `{object_name}` or `{path}`
 * (a `{name}` key is refused for a non-provisional `ui` row, ids.ts), so the
 * key is `{path: [<bl_idname>]}`: `ui:BlenderTools/blender-operator/<bl_idname>`.
 *
 *   npx tsx scripts/census/enumerators/e19-blender-operators.ts [--tools <dir>] [--build <tag>]
 *       [--out <file under observations/E19/>] [--artifacts <dir>] [--data <dir>] [--json]
 *
 * Exit: 0 written; 1 refused (output outside observations/E19/); 2 usage or
 * no add-on source (NO DATA); 3 malformed census configuration.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { inflateRawSync } from "node:zlib";
import { parseArgs } from "node:util";
import { compareCodeUnits, formatJson, jsonlLine, sha256 } from "../../../src/census/canon.js";
import { loadCurrentBuild } from "../../../src/census/census-config.js";
import { containsMachinePath } from "../../../src/census/hygiene.js";
import { loadConfig } from "../../../src/config.js";
import { writeFileAtomic, type CensusPaths } from "../../../src/census/ledger-io.js";
import { artifactsDir } from "../../live/paths.js";
import { observationSchema, type Observation } from "../../../src/census/schemas.js";
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

export const ENUMERATOR_ID = "E19";
export const GENERATOR = "scripts/census/enumerators/e19-blender-operators.ts";
const QUOTE_MAX = 200;

// ── Sources ───────────────────────────────────────────────────────────────────

export interface PySource {
  /** Path relative to `<tools>/Blender`, `/`-separated; zip entries are `<zip>!/<entry>`. */
  rel: string;
  raw: Buffer;
  text: string;
}

function decode(raw: Buffer): string {
  const t = raw.toString("utf-8");
  return t.charCodeAt(0) === 0xfeff ? t.slice(1) : t;
}

/** Entries of a zip archive, read from memory (stored and deflate; no zip64). */
export function readZipEntries(buf: Buffer): { name: string; data: Buffer }[] {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error("not a zip archive (no end-of-central-directory record)");
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const out: { name: string; data: Buffer }[] = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error("bad zip central directory");
    const method = buf.readUInt16LE(off + 10);
    const csize = buf.readUInt32LE(off + 20);
    const nl = buf.readUInt16LE(off + 28);
    const el = buf.readUInt16LE(off + 30);
    const cl = buf.readUInt16LE(off + 32);
    const lho = buf.readUInt32LE(off + 42);
    const name = buf.toString("utf-8", off + 46, off + 46 + nl);
    off += 46 + nl + el + cl;
    if (name.endsWith("/")) continue;
    const lnl = buf.readUInt16LE(lho + 26);
    const lel = buf.readUInt16LE(lho + 28);
    const start = lho + 30 + lnl + lel;
    const comp = buf.subarray(start, start + csize);
    if (method === 0) out.push({ name, data: Buffer.from(comp) });
    else if (method === 8) out.push({ name, data: inflateRawSync(comp) });
    else throw new Error(`unsupported zip method ${method} for ${name}`);
  }
  return out;
}

function walk(dir: string, rel: string, out: { rel: string; abs: string }[]): void {
  const names = readdirSync(dir).sort(compareCodeUnits);
  for (const n of names) {
    if (n === "__pycache__") continue;
    const abs = join(dir, n);
    const r = rel ? `${rel}/${n}` : n;
    if (statSync(abs).isDirectory()) walk(abs, r, out);
    else out.push({ rel: r, abs });
  }
}

/** Every `.py` file under `blenderDir`, plus `.py` entries of `.zip` archives, sorted by `rel`. */
export function readSources(blenderDir: string): PySource[] {
  const files: { rel: string; abs: string }[] = [];
  walk(blenderDir, "", files);
  const out: PySource[] = [];
  for (const f of files) {
    if (f.rel.endsWith(".py")) {
      const raw = readFileSync(f.abs);
      out.push({ rel: f.rel, raw, text: decode(raw) });
    } else if (f.rel.toLowerCase().endsWith(".zip")) {
      let entries: { name: string; data: Buffer }[];
      try {
        entries = readZipEntries(readFileSync(f.abs));
      } catch {
        continue;
      }
      for (const e of entries) {
        if (e.name.endsWith(".py")) {
          out.push({ rel: `${f.rel}!/${e.name}`, raw: e.data, text: decode(e.data) });
        }
      }
    }
  }
  return out.sort((a, b) => compareCodeUnits(a.rel, b.rel));
}

// ── Python tokenizer ──────────────────────────────────────────────────────────

export type TokKind = "name" | "num" | "str" | "op";
export interface Tok {
  k: TokKind;
  /** Name, number or operator text; for a string the decoded content (raw content when `f`). */
  v: string;
  /** 1-based physical line the token starts on. */
  line: number;
  /** An f-string: `v` is the raw template, never a literal value. */
  f?: boolean;
}
export interface LogicalLine {
  line: number;
  endLine: number;
  indent: number;
  toks: Tok[];
}

const OPS3 = ["**=", "//=", ">>=", "<<=", "..."];
const OPS2 = [
  "->",
  ":=",
  "==",
  "!=",
  "<=",
  ">=",
  "+=",
  "-=",
  "*=",
  "/=",
  "%=",
  "&=",
  "|=",
  "^=",
  "@=",
  "**",
  "//",
  "<<",
  ">>",
];
const STR_PREFIX = /^[rRbBuUfF]{1,2}$/;
const NAME_START = /[\p{L}_]/u;
const NAME_PART = /[\p{L}\p{N}_]/u;

function unescape(s: string): string {
  return s.replace(/\\(\r?\n|[\\'"abfnrtv])/g, (_m, c: string) => {
    switch (c) {
      case "n":
        return "\n";
      case "t":
        return "\t";
      case "r":
        return "\r";
      case "a":
        return "\x07";
      case "b":
        return "\b";
      case "f":
        return "\f";
      case "v":
        return "\v";
      case "\n":
      case "\r\n":
        return "";
      default:
        return c;
    }
  });
}

export interface TokenizeResult {
  lines: LogicalLine[];
  /** Brackets still open at the end of the file, or an unterminated string (0 when clean). */
  problems: number;
}

/** Splits Python source into logical lines of tokens. Comments and blank lines are dropped. */
export function tokenize(text: string): TokenizeResult {
  const src = text.replace(/\r\n?/g, "\n");
  const n = src.length;
  const lines: LogicalLine[] = [];
  let i = 0;
  let line = 1;
  let depth = 0;
  let cur: Tok[] = [];
  let curLine = 0;
  let curIndent = 0;
  let atStart = true;
  let problems = 0;

  const flush = (endLine: number): void => {
    if (cur.length) lines.push({ line: curLine, endLine, indent: curIndent, toks: cur });
    cur = [];
  };

  while (i < n) {
    if (atStart) {
      let col = 0;
      let j = i;
      while (j < n && (src[j] === " " || src[j] === "\t" || src[j] === "\f")) {
        col += src[j] === "\t" ? 8 - (col % 8) : 1;
        j++;
      }
      if (j >= n) break;
      if (src[j] === "\n") {
        line++;
        i = j + 1;
        continue;
      }
      if (src[j] === "#") {
        while (j < n && src[j] !== "\n") j++;
        line++;
        i = j + 1;
        continue;
      }
      curIndent = col;
      curLine = line;
      i = j;
      atStart = false;
    }
    const ch = src[i];
    if (ch === "\n") {
      if (depth > 0) {
        line++;
        i++;
        continue;
      }
      flush(line);
      line++;
      i++;
      atStart = true;
      continue;
    }
    if (ch === " " || ch === "\t" || ch === "\f") {
      i++;
      continue;
    }
    if (ch === "\\" && src[i + 1] === "\n") {
      line++;
      i += 2;
      continue;
    }
    if (ch === "#") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    const startLine = line;
    // Strings (with an optional prefix).
    let prefix = "";
    let isString = false;
    if (ch === '"' || ch === "'") isString = true;
    else if (NAME_START.test(ch)) {
      let j = i;
      while (j < n && NAME_PART.test(src[j])) j++;
      const word = src.slice(i, j);
      if (STR_PREFIX.test(word) && (src[j] === '"' || src[j] === "'")) {
        prefix = word;
        i = j;
        isString = true;
      }
    }
    if (isString) {
      const q = src[i];
      const triple = src[i + 1] === q && src[i + 2] === q;
      const raw = /[rR]/.test(prefix);
      let j = i + (triple ? 3 : 1);
      const bodyStart = j;
      let closed = false;
      while (j < n) {
        const c = src[j];
        if (c === "\\") {
          if (src[j + 1] === "\n") line++;
          j += 2;
          continue;
        }
        if (c === "\n") {
          if (!triple) break;
          line++;
          j++;
          continue;
        }
        if (c === q && (!triple || (src[j + 1] === q && src[j + 2] === q))) {
          closed = true;
          break;
        }
        j++;
      }
      const body = src.slice(bodyStart, j);
      if (!closed) problems++;
      const isF = /[fF]/.test(prefix);
      cur.push({
        k: "str",
        v: isF || raw ? body : unescape(body),
        line: startLine,
        ...(isF ? { f: true } : {}),
      });
      i = closed ? j + (triple ? 3 : 1) : j;
      continue;
    }
    if (NAME_START.test(ch)) {
      let j = i;
      while (j < n && NAME_PART.test(src[j])) j++;
      cur.push({ k: "name", v: src.slice(i, j), line: startLine });
      i = j;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      const m =
        /^(0[xXoObB][0-9a-fA-F_]+|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d+)?[jJ]?)/.exec(
          src.slice(i, i + 64),
        );
      const v = m ? m[0] : ch;
      cur.push({ k: "num", v, line: startLine });
      i += v.length;
      continue;
    }
    const three = src.slice(i, i + 3);
    const two = src.slice(i, i + 2);
    let op = ch;
    if (OPS3.includes(three)) op = three;
    else if (OPS2.includes(two)) op = two;
    if (op === "(" || op === "[" || op === "{") depth++;
    else if (op === ")" || op === "]" || op === "}") depth = Math.max(0, depth - 1);
    cur.push({ k: "op", v: op, line: startLine });
    i += op.length;
  }
  if (cur.length) flush(line);
  if (depth !== 0) problems++;
  return { lines, problems };
}

// ── Scopes ────────────────────────────────────────────────────────────────────

export interface PyNode {
  id: string;
  kind: "module" | "class" | "function";
  name: string;
  /** `Class.method` or `function`. */
  qual: string;
  file: FileInfo;
  line: number;
  endLine: number;
  /** Enclosing class of a method. */
  cls?: PyNode;
  parent?: PyNode;
  params: string[];
  /** Annotation tokens of the parameters that carry one. */
  paramAnn: Map<string, Tok[]>;
  /** Tokens of the return annotation (`-> X`), when there is one. */
  returnAnn?: Tok[];
  baseChains: string[][];
  decorators: string[];
  /** Statements of this scope (nested function bodies are flattened into their function). */
  lines: LogicalLine[];
  children: PyNode[];
}

interface ImportBinding {
  alias: string;
  /** Dotted module (absolute); for `from M import n` the module M. */
  module: string;
  /** The imported name for `from M import n`; undefined for `import M`. */
  name?: string;
}

export interface FileInfo {
  rel: string;
  text: string;
  textLines: string[];
  dotted: string;
  /** The dotted name of the package this file's relative imports start from. */
  pkg: string;
  isPackageInit: boolean;
  module: PyNode;
  nodes: PyNode[];
  defs: Map<string, PyNode>;
  imports: Map<string, ImportBinding>;
  tokenProblems: number;
}

const KEYWORDS = new Set(
  "False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield".split(
    " ",
  ),
);

function splitTopLevel(toks: Tok[], sep: string): Tok[][] {
  const out: Tok[][] = [];
  let cur: Tok[] = [];
  let d = 0;
  for (const t of toks) {
    if (t.k === "op") {
      if (t.v === "(" || t.v === "[" || t.v === "{") d++;
      else if (t.v === ")" || t.v === "]" || t.v === "}") d--;
      else if (t.v === sep && d === 0) {
        out.push(cur);
        cur = [];
        continue;
      }
    }
    cur.push(t);
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Index of the bracket matching the opener at `open`, or -1. */
function matching(toks: Tok[], open: number): number {
  let d = 0;
  for (let i = open; i < toks.length; i++) {
    const t = toks[i];
    if (t.k !== "op") continue;
    if (t.v === "(" || t.v === "[" || t.v === "{") d++;
    else if (t.v === ")" || t.v === "]" || t.v === "}") {
      d--;
      if (d === 0) return i;
    }
  }
  return -1;
}

/** Index of the first operator `v` at bracket depth 0 from `from`, or -1. */
function indexAtTop(toks: Tok[], v: string, from = 0): number {
  let d = 0;
  for (let i = from; i < toks.length; i++) {
    const t = toks[i];
    if (t.k !== "op") continue;
    if (t.v === "(" || t.v === "[" || t.v === "{") d++;
    else if (t.v === ")" || t.v === "]" || t.v === "}") d--;
    else if (t.v === v && d === 0) return i;
  }
  return -1;
}

function parseHeader(toks: Tok[]): {
  kind: "class" | "def";
  name: string;
  params: string[];
  paramAnn: Map<string, Tok[]>;
  returnAnn?: Tok[];
  baseChains: string[][];
  rest: Tok[];
} | null {
  let i = 0;
  if (toks[i]?.v === "async" && toks[i + 1]?.v === "def") i++;
  const kw = toks[i];
  if (!kw || kw.k !== "name" || (kw.v !== "class" && kw.v !== "def")) return null;
  const nameTok = toks[i + 1];
  if (!nameTok || nameTok.k !== "name") return null;
  let j = i + 2;
  let inner: Tok[] = [];
  if (toks[j]?.v === "(") {
    const close = matching(toks, j);
    if (close === -1) return null;
    inner = toks.slice(j + 1, close);
    j = close + 1;
  }
  // The header colon: first depth-0 ":" after the parameter list.
  let d = 0;
  let colon = -1;
  for (let k = j; k < toks.length; k++) {
    const t = toks[k];
    if (t.k !== "op") continue;
    if (t.v === "(" || t.v === "[" || t.v === "{") d++;
    else if (t.v === ")" || t.v === "]" || t.v === "}") d--;
    else if (t.v === ":" && d === 0) {
      colon = k;
      break;
    }
  }
  const rest = colon === -1 ? [] : toks.slice(colon + 1);
  const params: string[] = [];
  const paramAnn = new Map<string, Tok[]>();
  let returnAnn: Tok[] | undefined;
  const baseChains: string[][] = [];
  if (kw.v === "def") {
    for (const part of splitTopLevel(inner, ",")) {
      const first = part.find((t) => t.k === "name");
      if (first && part[0] && (part[0].k === "name" || part[0].v === "*" || part[0].v === "**")) {
        params.push(first.v);
        const c = indexAtTop(part, ":");
        if (c !== -1) {
          const e = indexAtTop(part, "=", c + 1);
          const ann = part.slice(c + 1, e === -1 ? undefined : e);
          if (ann.length) paramAnn.set(first.v, ann);
        }
      }
    }
    if (colon !== -1 && toks[j]?.v === "->") returnAnn = toks.slice(j + 1, colon);
  } else {
    for (const part of splitTopLevel(inner, ",")) {
      if (part.some((t) => t.k === "op" && t.v === "=")) continue; // metaclass=...
      const chain: string[] = [];
      for (let k = 0; k < part.length; k++) {
        const t = part[k];
        if (t.k === "name") chain.push(t.v);
        else if (t.v === ".") continue;
        else break;
      }
      if (chain.length) baseChains.push(chain);
    }
  }
  return {
    kind: kw.v as "class" | "def",
    name: nameTok.v,
    params,
    paramAnn,
    returnAnn,
    baseChains,
    rest,
  };
}

function decoratorName(toks: Tok[]): string {
  const parts: string[] = [];
  for (let i = 1; i < toks.length; i++) {
    if (toks[i].k === "name") parts.push(toks[i].v);
    else if (toks[i].v === ".") continue;
    else break;
  }
  return parts.join(".");
}

/** Builds the scope tree of one file. */
export function parseFile(rel: string, text: string, dotted: string, pkg: string): FileInfo {
  const tk = tokenize(text);
  const textLines = text.replace(/\r\n?/g, "\n").split("\n");
  const file: FileInfo = {
    rel,
    text,
    textLines,
    dotted,
    pkg,
    isPackageInit: rel.endsWith("__init__.py"),
    module: undefined as unknown as PyNode,
    nodes: [],
    defs: new Map(),
    imports: new Map(),
    tokenProblems: tk.problems,
  };
  const mk = (
    kind: PyNode["kind"],
    name: string,
    qual: string,
    line: number,
    extra: Partial<PyNode> = {},
  ): PyNode => ({
    id: `${rel}::${qual || "<module>"}`,
    kind,
    name,
    qual,
    file,
    line,
    endLine: line,
    params: [],
    paramAnn: new Map(),
    baseChains: [],
    decorators: [],
    lines: [],
    children: [],
    ...extra,
  });
  const moduleNode = mk("module", "<module>", "", 1);
  file.module = moduleNode;
  const stack: { node: PyNode; indent: number }[] = [{ node: moduleNode, indent: -1 }];
  let pending: string[] = [];

  for (const ll of tk.lines) {
    while (stack.length > 1 && stack[stack.length - 1].indent >= ll.indent) stack.pop();
    const top = stack[stack.length - 1].node;
    const first = ll.toks[0];
    if (first.k === "op" && first.v === "@") {
      pending.push(decoratorName(ll.toks));
      continue;
    }
    const h = parseHeader(ll.toks);
    const inFunction = top.kind === "function";
    if (h && !inFunction) {
      const parentClass = top.kind === "class" ? top : undefined;
      const qual = parentClass ? `${parentClass.qual}.${h.name}` : h.name;
      const node = mk(h.kind === "class" ? "class" : "function", h.name, qual, ll.line, {
        params: h.params,
        paramAnn: h.paramAnn,
        returnAnn: h.returnAnn,
        baseChains: h.baseChains,
        decorators: pending,
        parent: top.kind === "module" ? undefined : top,
        ...(parentClass && h.kind === "def" ? { cls: parentClass } : {}),
      });
      pending = [];
      top.children.push(node);
      file.nodes.push(node);
      if (top.kind === "module") file.defs.set(h.name, node);
      if (h.rest.length) {
        node.lines.push({
          line: ll.line,
          endLine: ll.endLine,
          indent: ll.indent + 1,
          toks: h.rest,
        });
      }
      node.endLine = ll.endLine;
      stack.push({ node, indent: ll.indent });
      continue;
    }
    pending = [];
    top.lines.push(ll);
    for (const s of stack) s.node.endLine = Math.max(s.node.endLine, ll.endLine);
  }
  moduleNode.endLine = Math.max(moduleNode.endLine, textLines.length);
  return file;
}

// ── Literals ──────────────────────────────────────────────────────────────────

/** The value of tokens that are only string literals joined by `+` or implicit concatenation. */
export function stringLiteral(toks: Tok[]): string | undefined {
  let out = "";
  let seen = false;
  let depth = 0;
  for (const t of toks) {
    if (t.k === "str") {
      if (t.f) return undefined;
      out += t.v;
      seen = true;
    } else if (t.k === "op" && t.v === "+") continue;
    else if (t.k === "op" && t.v === "(") depth++;
    else if (t.k === "op" && t.v === ")") depth--;
    else return undefined;
  }
  return seen && depth === 0 ? out : undefined;
}

function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

// ── Project model ─────────────────────────────────────────────────────────────

export interface Project {
  files: FileInfo[];
  byRel: Map<string, FileInfo>;
  /** Dotted module name (and unique suffixes of two or more segments) to file. */
  modules: Map<string, FileInfo>;
  /** Dotted package directory names (namespace packages included). */
  packages: Set<string>;
  rootPrefix: string;
  allNodes: PyNode[];
  methodsByName: Map<string, PyNode[]>;
  classesByName: Map<string, PyNode[]>;
}

function dirOf(rel: string): string {
  const i = rel.lastIndexOf("/");
  return i === -1 ? "" : rel.slice(0, i);
}

/** Parses every source and wires the module index. */
export function buildProject(sources: PySource[]): Project {
  // The add-on root: the shallowest `__init__.py` that holds `bl_info`.
  let rootDir: string | null = null;
  for (const s of sources) {
    if (!s.rel.endsWith("/__init__.py") && s.rel !== "__init__.py") continue;
    if (!/\bbl_info\b/.test(s.text)) continue;
    const d = dirOf(s.rel);
    if (rootDir === null || d.split("/").length < rootDir.split("/").length) rootDir = d;
  }
  const rootPrefix = rootDir ? (rootDir.split("/").pop() as string).replace(/^.*!\//, "") : "";
  const files: FileInfo[] = [];
  for (const s of sources) {
    let segs: string[];
    const inRoot = rootDir !== null && (rootDir === "" || s.rel.startsWith(rootDir + "/"));
    const relToRoot =
      rootDir === null ? s.rel : rootDir === "" ? s.rel : s.rel.slice(rootDir.length + 1);
    if (inRoot) segs = [rootPrefix, ...relToRoot.split("/")].filter(Boolean);
    else segs = s.rel.replace(/^.*!\//, "").split("/");
    const last = segs[segs.length - 1].replace(/\.py$/, "");
    const isInit = last === "__init__";
    const modSegs = isInit ? segs.slice(0, -1) : [...segs.slice(0, -1), last];
    const dotted = modSegs.join(".");
    const pkg = isInit ? dotted : modSegs.slice(0, -1).join(".");
    files.push(parseFile(s.rel, s.text, dotted, pkg));
  }
  const byRel = new Map(files.map((f) => [f.rel, f]));
  const modules = new Map<string, FileInfo>();
  const packages = new Set<string>();
  const suffixCount = new Map<string, FileInfo[]>();
  for (const f of files) {
    modules.set(f.dotted, f);
    const segs = f.dotted.split(".");
    for (let k = 1; k < segs.length - 1; k++) {
      const suffix = segs.slice(k).join(".");
      const arr = suffixCount.get(suffix) ?? [];
      arr.push(f);
      suffixCount.set(suffix, arr);
    }
    const dirSegs = f.isPackageInit ? segs : segs.slice(0, -1);
    for (let a = 0; a < dirSegs.length; a++) {
      for (let b = a + 1; b <= dirSegs.length; b++) packages.add(dirSegs.slice(a, b).join("."));
    }
  }
  for (const [suffix, arr] of suffixCount) {
    if (!modules.has(suffix) && arr.length === 1) modules.set(suffix, arr[0]);
  }
  const allNodes: PyNode[] = [];
  const methodsByName = new Map<string, PyNode[]>();
  const classesByName = new Map<string, PyNode[]>();
  for (const f of files) {
    allNodes.push(f.module, ...f.nodes);
    for (const nd of f.nodes) {
      if (nd.kind === "function" && nd.cls) {
        const arr = methodsByName.get(nd.name) ?? [];
        arr.push(nd);
        methodsByName.set(nd.name, arr);
      }
      if (nd.kind === "class") {
        const arr = classesByName.get(nd.name) ?? [];
        arr.push(nd);
        classesByName.set(nd.name, arr);
      }
    }
  }
  const project: Project = {
    files,
    byRel,
    modules,
    packages,
    rootPrefix,
    allNodes,
    methodsByName,
    classesByName,
  };
  for (const f of files) parseImports(f);
  return project;
}

function parseImports(f: FileInfo): void {
  const all: LogicalLine[] = [...f.module.lines];
  for (const nd of f.nodes) all.push(...nd.lines);
  for (const ll of all) {
    const t = ll.toks;
    if (t[0].k !== "name") continue;
    if (t[0].v === "import") {
      for (const part of splitTopLevel(t.slice(1), ",")) {
        const names: string[] = [];
        let i = 0;
        while (i < part.length && (part[i].k === "name" || part[i].v === ".")) {
          if (part[i].v === "as") break;
          if (part[i].k === "name") names.push(part[i].v);
          i++;
        }
        const asIdx = part.findIndex((x) => x.k === "name" && x.v === "as");
        const mod = names.join(".");
        if (!mod) continue;
        if (asIdx !== -1 && part[asIdx + 1])
          f.imports.set(part[asIdx + 1].v, { alias: part[asIdx + 1].v, module: mod });
        else f.imports.set(names[0], { alias: names[0], module: names[0] });
      }
    } else if (t[0].v === "from") {
      let i = 1;
      let level = 0;
      while (t[i] && t[i].k === "op" && (t[i].v === "." || t[i].v === "...")) {
        level += t[i].v.length;
        i++;
      }
      const modParts: string[] = [];
      while (t[i] && !(t[i].k === "name" && t[i].v === "import")) {
        if (t[i].k === "name") modParts.push(t[i].v);
        i++;
      }
      if (!t[i]) continue;
      let base = "";
      if (level > 0) {
        const pkgSegs = f.pkg ? f.pkg.split(".") : [];
        base = pkgSegs.slice(0, Math.max(0, pkgSegs.length - (level - 1))).join(".");
      }
      const module = [base, ...modParts].filter(Boolean).join(".");
      let rest = t.slice(i + 1);
      if (rest[0]?.v === "(")
        rest = rest.slice(1, rest.length && rest[rest.length - 1].v === ")" ? -1 : undefined);
      for (const part of splitTopLevel(rest, ",")) {
        if (!part.length || part[0].v === "*") continue;
        const name = part[0].v;
        const alias = part[1]?.v === "as" && part[2] ? part[2].v : name;
        f.imports.set(alias, { alias, module, name });
      }
    }
  }
}

// ── Resolution ────────────────────────────────────────────────────────────────

type Target =
  | { type: "module"; file: FileInfo }
  | { type: "package"; dotted: string }
  | { type: "symbol"; node: PyNode }
  | { type: "external" };

// ── Receiver type inference: constants and statement splitting ─────────────────

export type Ty = { k: "ext"; derive: boolean } | { k: "cls"; classes: PyNode[] } | { k: "none" };

/** Roots of Blender's own Python modules: their objects can be project property groups. */
const BPY_ROOTS: ReadonlySet<string> = new Set([
  "bpy",
  "bmesh",
  "mathutils",
  "bpy_extras",
  "gpu",
  "blf",
  "idprop",
  "bgl",
  "aud",
  "imbuf",
]);
/** Modules whose functions can hand back an object they were given. */
const PASS_THROUGH_ROOTS: ReadonlySet<string> = new Set([
  "typing",
  "typing_extensions",
  "copy",
  "functools",
  "itertools",
  "operator",
  "collections",
  "contextlib",
  "builtins",
  "dataclasses",
  "abc",
  "enum",
  "types",
  "weakref",
  "inspect",
  "queue",
  "concurrent",
  "asyncio",
  "threading",
  "multiprocessing",
]);
/** Standard-library modules whose calls return library objects, never a caller-supplied object. */
const SAFE_EXT_ROOTS: ReadonlySet<string> = new Set([
  "sqlite3",
  "json",
  "os",
  "pathlib",
  "shutil",
  "subprocess",
  "socket",
  "struct",
  "zipfile",
  "hashlib",
  "re",
  "datetime",
  "time",
  "math",
  "uuid",
  "tempfile",
  "io",
  "base64",
  "urllib",
  "logging",
  "sys",
  "platform",
  "glob",
  "fnmatch",
  "string",
  "textwrap",
  "random",
  "secrets",
]);
const SCALAR_TYPES: ReadonlySet<string> = new Set(["str", "int", "float", "bool", "bytes"]);
const CONTAINER_TYPES: ReadonlySet<string> = new Set([
  "list",
  "dict",
  "set",
  "tuple",
  "frozenset",
  "List",
  "Dict",
  "Set",
  "Tuple",
  "FrozenSet",
]);
const SCALAR_BUILTINS: ReadonlySet<string> = new Set([
  "str",
  "int",
  "float",
  "bool",
  "bytes",
  "len",
  "repr",
  "format",
  "ord",
  "chr",
  "open",
  "hash",
  "id",
  "round",
]);
const CONTAINER_BUILTINS: ReadonlySet<string> = new Set([
  "list",
  "dict",
  "set",
  "tuple",
  "frozenset",
  "bytearray",
  "sorted",
  "range",
  "enumerate",
  "reversed",
  "zip",
]);
const COMPOUND_HEADS: ReadonlySet<string> = new Set([
  "if",
  "elif",
  "else",
  "for",
  "while",
  "try",
  "except",
  "finally",
  "with",
]);

/** A logical line as simple statements: a compound header and the statement after its colon. */
function statementsOf(ll: LogicalLine): Tok[][] {
  const t = ll.toks;
  if (t[0]?.k === "name" && COMPOUND_HEADS.has(t[0].v)) {
    const c = indexAtTop(t, ":");
    if (c !== -1 && c < t.length - 1) return [t.slice(0, c), t.slice(c + 1)];
    return [t];
  }
  return [t];
}

class Resolver {
  private ancestorsCache = new Map<PyNode, PyNode[]>();
  private descendants = new Map<PyNode, PyNode[]>();
  readonly operatorsById = new Map<string, PyNode>();
  private opCache = new Map<PyNode, boolean>();
  /** Calls whose receiver type was read from the source instead of matching the method name. */
  readonly typedCalls = new Map<string, TypedCall>();

  constructor(readonly p: Project) {
    for (const c of p.allNodes) {
      if (c.kind !== "class") continue;
      for (const a of this.ancestors(c)) {
        const arr = this.descendants.get(a) ?? [];
        arr.push(c);
        this.descendants.set(a, arr);
      }
    }
  }

  lookupSymbol(file: FileInfo, name: string, depth = 0): PyNode | undefined {
    const d = file.defs.get(name);
    if (d) return d;
    if (depth > 4) return undefined;
    const b = file.imports.get(name);
    if (b && b.name) {
      const mod = this.p.modules.get(b.module);
      if (mod && mod !== file) return this.lookupSymbol(mod, b.name, depth + 1);
    }
    return undefined;
  }

  bindingTarget(file: FileInfo, name: string): Target | undefined {
    const b = file.imports.get(name);
    if (b) {
      if (b.name === undefined) {
        const mod = this.p.modules.get(b.module);
        if (mod) return { type: "module", file: mod };
        if (this.p.packages.has(b.module)) return { type: "package", dotted: b.module };
        return { type: "external" };
      }
      const sub = `${b.module}.${b.name}`;
      const subMod = this.p.modules.get(sub);
      if (subMod) return { type: "module", file: subMod };
      const mod = this.p.modules.get(b.module);
      if (mod) {
        const s = this.lookupSymbol(mod, b.name);
        if (s) return { type: "symbol", node: s };
      }
      if (this.p.packages.has(sub)) return { type: "package", dotted: sub };
      return { type: "external" };
    }
    const d = file.defs.get(name);
    if (d) return { type: "symbol", node: d };
    return undefined;
  }

  resolveClassRef(file: FileInfo, chain: string[]): PyNode | undefined {
    const t = this.bindingTarget(file, chain[0]);
    if (!t) return undefined;
    let cur: Target = t;
    for (let k = 1; k < chain.length; k++) {
      if (cur.type === "module") {
        const s = this.lookupSymbol(cur.file, chain[k]);
        if (s) cur = { type: "symbol", node: s };
        else {
          const sub = this.p.modules.get(`${cur.file.dotted}.${chain[k]}`);
          if (!sub) return undefined;
          cur = { type: "module", file: sub };
        }
      } else if (cur.type === "package") {
        const dotted = `${cur.dotted}.${chain[k]}`;
        const m = this.p.modules.get(dotted);
        cur = m
          ? { type: "module", file: m }
          : this.p.packages.has(dotted)
            ? { type: "package", dotted }
            : { type: "external" };
      } else return undefined;
    }
    return cur.type === "symbol" && cur.node.kind === "class" ? cur.node : undefined;
  }

  ancestors(cls: PyNode): PyNode[] {
    const cached = this.ancestorsCache.get(cls);
    if (cached) return cached;
    this.ancestorsCache.set(cls, []);
    const out: PyNode[] = [];
    for (const chain of cls.baseChains) {
      const b = this.resolveClassRef(cls.file, chain);
      if (b && b !== cls && !out.includes(b)) {
        out.push(b);
        for (const a of this.ancestors(b)) if (!out.includes(a)) out.push(a);
      }
    }
    this.ancestorsCache.set(cls, out);
    return out;
  }

  /** Methods named `name` on the class, its ancestors and (overrides) descendants. */
  methods(cls: PyNode, name: string, withDescendants = true): PyNode[] {
    const out: PyNode[] = [];
    const seen = new Set<PyNode>();
    const consider = (c: PyNode): void => {
      if (seen.has(c)) return;
      seen.add(c);
      for (const ch of c.children) if (ch.kind === "function" && ch.name === name) out.push(ch);
    };
    consider(cls);
    for (const a of this.ancestors(cls)) consider(a);
    if (withDescendants) for (const d of this.descendants.get(cls) ?? []) consider(d);
    return out;
  }

  // ── Receiver types ────────────────────────────────────────────────────────
  // A method call `x.m()` on a name that is not an import is matched by method
  // name alone unless the type of `x` can be read from the source: a parameter
  // annotation, a constructor call, a factory's return annotation or return
  // statements, an attribute assigned in the class, a standard-library call.
  // Every assignment of the name in the scope must agree; anything the reader
  // does not understand leaves the receiver unknown (and the call name-matched).

  private nameGuard = new Set<string>();
  private retGuard = new Set<PyNode>();
  private attrGuard = new Set<string>();
  private foreignBases: Set<string> | undefined;

  /** Last segments of the external base classes that project classes derive from. */
  private externalBaseNames(): Set<string> {
    if (this.foreignBases) return this.foreignBases;
    const out = new Set<string>();
    for (const c of this.p.allNodes) {
      if (c.kind !== "class") continue;
      for (const chain of c.baseChains) {
        if (!this.resolveClassRef(c.file, chain)) out.add(chain[chain.length - 1]);
      }
    }
    this.foreignBases = out;
    return out;
  }

  private static combine(list: (Ty | undefined)[]): Ty | undefined {
    const real = list.filter((x) => x === undefined || x.k !== "none");
    if (!real.length || real.some((x) => x === undefined)) return undefined;
    const tys = real as Ty[];
    if (tys.every((x) => x.k === "ext")) {
      const e = tys as { k: "ext"; derive: boolean }[];
      return { k: "ext", derive: e.every((x) => x.derive) };
    }
    if (tys.every((x) => x.k === "cls")) {
      const classes: PyNode[] = [];
      for (const x of tys) {
        for (const c of (x as { k: "cls"; classes: PyNode[] }).classes) {
          if (!classes.includes(c)) classes.push(c);
        }
      }
      return { k: "cls", classes };
    }
    return undefined;
  }

  /** The type an annotation names, or undefined when it is not one of the understood forms. */
  annotationType(file: FileInfo, ctx: PyNode | undefined, toks: Tok[], depth = 0): Ty | undefined {
    if (depth > 4 || !toks.length) return undefined;
    if (toks.length === 1 && toks[0].k === "str" && !toks[0].f) {
      const inner = tokenize(toks[0].v).lines[0]?.toks;
      return inner ? this.annotationType(file, ctx, inner, depth + 1) : undefined;
    }
    const isNone = (a: Tok[]): boolean => a.length === 1 && a[0].v === "None";
    const alts = splitTopLevel(toks, "|");
    if (alts.length > 1) {
      return Resolver.combine(
        alts.filter((a) => !isNone(a)).map((a) => this.annotationType(file, ctx, a, depth + 1)),
      );
    }
    const br = indexAtTop(toks, "[");
    if (br > 0) {
      if (toks[toks.length - 1].v !== "]" || matching(toks, br) !== toks.length - 1)
        return undefined;
      const head = toks.slice(0, br);
      if (!head.every((t) => t.k === "name" || t.v === ".")) return undefined;
      const names = head.filter((t) => t.k === "name").map((t) => t.v);
      const last = names[names.length - 1];
      const inner = toks.slice(br + 1, -1);
      if (last === "Optional") return this.annotationType(file, ctx, inner, depth + 1);
      if (last === "Union") {
        return Resolver.combine(
          splitTopLevel(inner, ",")
            .filter((a) => !isNone(a))
            .map((a) => this.annotationType(file, ctx, a, depth + 1)),
        );
      }
      if (CONTAINER_TYPES.has(last) && (names.length === 1 || names[0] === "typing")) {
        return { k: "ext", derive: false };
      }
      return undefined;
    }
    if (!toks.every((t) => t.k === "name" || t.v === ".")) return undefined;
    const chain = toks.filter((t) => t.k === "name").map((t) => t.v);
    const last = chain[chain.length - 1];
    if (last === "Self") return ctx ? { k: "cls", classes: [ctx] } : undefined;
    if (last === "Any" || last === "object" || last === "None") return undefined;
    if (chain.length === 1 && !file.imports.has(last) && !file.defs.has(last)) {
      if (SCALAR_TYPES.has(last)) return { k: "ext", derive: true };
      if (CONTAINER_TYPES.has(last)) return { k: "ext", derive: false };
    }
    const c = this.resolveClassRef(file, chain);
    if (c) return { k: "cls", classes: [c] };
    const t = this.bindingTarget(file, chain[0]);
    if (!t || t.type !== "external") return undefined;
    const root = this.rootOf(file, chain[0]);
    if (root === "typing" || root === "typing_extensions") {
      if (chain.length === 2 && SCALAR_TYPES.has(last)) return { k: "ext", derive: true };
      if (chain.length === 2 && CONTAINER_TYPES.has(last)) return { k: "ext", derive: false };
      return undefined;
    }
    if (PASS_THROUGH_ROOTS.has(root)) return undefined;
    if (BPY_ROOTS.has(root)) {
      // A project class may derive from the annotated class (Operator, PropertyGroup...).
      return this.externalBaseNames().has(last) ? undefined : { k: "ext", derive: false };
    }
    return { k: "ext", derive: SAFE_EXT_ROOTS.has(root) };
  }

  private rootOf(file: FileInfo, name: string): string {
    const b = file.imports.get(name);
    return (b ? b.module : name).split(".")[0];
  }

  /** The assignments of `n` in the scope, or `other` when it is bound in a way that is not read. */
  private bindingsOf(
    node: PyNode,
    n: string,
  ): { assigns: { toks: Tok[]; ann?: Tok[] }[]; other: boolean } {
    const key = `${node.id}|${n}`;
    const hit = this.bindingCache.get(key);
    if (hit) return hit;
    const out = this.scanBindings(node, n);
    this.bindingCache.set(key, out);
    return out;
  }

  private bindingCache = new Map<
    string,
    { assigns: { toks: Tok[]; ann?: Tok[] }[]; other: boolean }
  >();

  private scanBindings(
    node: PyNode,
    n: string,
  ): { assigns: { toks: Tok[]; ann?: Tok[] }[]; other: boolean } {
    const out = { assigns: [] as { toks: Tok[]; ann?: Tok[] }[], other: false };
    for (const ll of node.lines) {
      if (!ll.toks.some((x) => x.k === "name" && x.v === n)) continue;
      for (const st of statementsOf(ll)) {
        const f = st[0];
        if (!f) continue;
        if (f.k === "name" && (f.v === "global" || f.v === "nonlocal")) {
          if (st.some((x) => x.k === "name" && x.v === n)) out.other = true;
          continue;
        }
        if (f.k === "name" && (f.v === "import" || f.v === "from")) continue;
        if (f.k === "name" && (f.v === "def" || f.v === "class" || f.v === "async")) {
          const h = parseHeader(st);
          if (h && (h.name === n || h.params.includes(n))) out.other = true;
          continue;
        }
        for (let i = 0; i < st.length; i++) {
          const t = st[i];
          if (t.k !== "name") continue;
          if (t.v === "lambda") {
            const c = indexAtTop(st.slice(i + 1), ":");
            const ps = st.slice(i + 1, c === -1 ? undefined : i + 1 + c);
            if (ps.some((x) => x.k === "name" && x.v === n)) out.other = true;
          } else if (t.v === "for") {
            let d = 0;
            for (let k = i + 1; k < st.length; k++) {
              const u = st[k];
              if (u.k === "op" && (u.v === "(" || u.v === "[" || u.v === "{")) d++;
              else if (u.k === "op" && (u.v === ")" || u.v === "]" || u.v === "}")) d--;
              else if (u.k === "name" && u.v === "in" && d === 0) break;
              else if (u.k === "name" && u.v === n && st[k - 1]?.v !== ".") out.other = true;
            }
          } else if (t.v === "as" && st[i + 1]?.v === n) out.other = true;
          else if (t.v === n && st[i + 1]?.v === ":=" && st[i - 1]?.v !== ".") out.other = true;
        }
        if (indexAtTop(st, "=") === -1) {
          if (st[0]?.v === n && st[1]?.v === ":" && st.length > 2) {
            out.assigns.push({ toks: [], ann: st.slice(2) });
          }
          continue;
        }
        const segs = splitTopLevel(st, "=");
        const rhs = segs[segs.length - 1] ?? [];
        for (const seg of segs.slice(0, -1)) {
          if (seg.length === 1 && seg[0].v === n) out.assigns.push({ toks: rhs });
          else if (seg[0]?.v === n && seg[1]?.v === ":") {
            out.assigns.push({ toks: rhs, ann: seg.slice(2) });
          } else if (seg[0]?.k === "op" && (seg[0].v === "(" || seg[0].v === "[")) {
            if (seg.some((x) => x.k === "name" && x.v === n)) out.other = true;
          } else if (seg.some((x) => x.k === "op" && x.v === ",")) {
            for (const part of splitTopLevel(seg, ",")) {
              const bare = part.length === 1 && part[0].v === n;
              const star = part.length === 2 && part[0].v === "*" && part[1].v === n;
              if (bare || star) out.other = true;
            }
          }
        }
      }
    }
    return out;
  }

  /** The type of a name in a scope (parameter, local or module variable), or undefined. */
  typeOfName(node: PyNode, name: string, depth = 0): Ty | undefined {
    if (depth > 6) return undefined;
    const key = `${node.id}|${name}`;
    if (this.nameGuard.has(key)) return undefined;
    this.nameGuard.add(key);
    try {
      const b = this.bindingsOf(node, name);
      if (node.kind === "function" && node.params.includes(name)) {
        if (b.other || b.assigns.length) return undefined;
        const ann = node.paramAnn.get(name);
        if (ann) return this.annotationType(node.file, node.cls, ann);
        if (node.cls && node.params[0] === name && !node.decorators.includes("staticmethod")) {
          return { k: "cls", classes: [node.cls] };
        }
        return undefined;
      }
      if (b.other) return undefined;
      if (b.assigns.length) {
        const list = b.assigns.map((a) => {
          const t = a.ann ? this.annotationType(node.file, node.cls, a.ann) : undefined;
          return t ?? this.typeOfExpr(node, a.toks, depth + 1);
        });
        return Resolver.combine(list);
      }
      if (node.kind !== "module") {
        // Not bound here: a module variable (assigned only at module level).
        const file = node.file;
        if (file.imports.has(name) || file.defs.has(name)) return undefined;
        const globalDeclared = file.nodes.some((f) =>
          f.lines.some((l) => l.toks[0]?.v === "global" && l.toks.some((x) => x.v === name)),
        );
        if (globalDeclared) return undefined;
        return this.typeOfName(file.module, name, depth + 1);
      }
      return undefined;
    } finally {
      this.nameGuard.delete(key);
    }
  }

  /** Whether the scope binds the name itself (parameter or assignment of any kind). */
  private bindsHere(node: PyNode, name: string): boolean {
    if (node.kind === "function" && node.params.includes(name)) return true;
    const b = this.bindingsOf(node, name);
    return b.other || b.assigns.length > 0;
  }

  /** The type of an expression made of one name, attributes, calls and literals; undefined otherwise. */
  typeOfExpr(node: PyNode, toks: Tok[], depth = 0): Ty | undefined {
    if (depth > 6 || !toks.length) return undefined;
    if (toks.length === 1) {
      const t = toks[0];
      if (t.k === "num" || t.k === "str") return { k: "ext", derive: true };
      if (t.k === "name" && (t.v === "True" || t.v === "False")) return { k: "ext", derive: true };
      if (t.k === "name" && t.v === "None") return { k: "none" };
    }
    if (toks.every((t) => t.k === "str")) return { k: "ext", derive: true };
    if (toks[0].k === "op" && matching(toks, 0) === toks.length - 1) {
      if (toks[0].v === "[" || toks[0].v === "{") return { k: "ext", derive: false };
      if (toks[0].v === "(") {
        const inner = toks.slice(1, -1);
        if (indexAtTop(inner, ",") !== -1) return { k: "ext", derive: false };
        return this.typeOfExpr(node, inner, depth + 1);
      }
    }
    if (toks[0].k !== "name" || KEYWORDS.has(toks[0].v)) return undefined;
    // Postfix chain: name (.name | (...))*
    type Cur =
      | { t: "ty"; ty: Ty | undefined }
      | { t: "module"; file: FileInfo }
      | { t: "package"; dotted: string }
      | { t: "sym"; node: PyNode }
      | { t: "clsattr"; cls: PyNode; name: string }
      | { t: "extmod"; root: string };
    const head = toks[0].v;
    const file = node.file;
    let cur: Cur;
    if (this.bindsHere(node, head)) {
      cur = { t: "ty", ty: this.typeOfName(node, head, depth + 1) };
    } else {
      const bt = this.bindingTarget(file, head);
      if (bt) {
        if (bt.type === "module") cur = { t: "module", file: bt.file };
        else if (bt.type === "package") cur = { t: "package", dotted: bt.dotted };
        else if (bt.type === "symbol") cur = { t: "sym", node: bt.node };
        else cur = { t: "extmod", root: this.rootOf(file, head) };
      } else if (
        toks[1]?.v === "(" &&
        (SCALAR_BUILTINS.has(head) || CONTAINER_BUILTINS.has(head))
      ) {
        const close = matching(toks, 1);
        if (close === -1) return undefined;
        cur = { t: "ty", ty: { k: "ext", derive: SCALAR_BUILTINS.has(head) } };
        return this.chainRest(node, cur, toks, close + 1, depth);
      } else cur = { t: "ty", ty: this.typeOfName(node, head, depth + 1) };
    }
    return this.chainRest(node, cur, toks, 1, depth);
  }

  private chainRest(
    node: PyNode,
    start:
      | { t: "ty"; ty: Ty | undefined }
      | { t: "module"; file: FileInfo }
      | { t: "package"; dotted: string }
      | { t: "sym"; node: PyNode }
      | { t: "clsattr"; cls: PyNode; name: string }
      | { t: "extmod"; root: string },
    toks: Tok[],
    from: number,
    _depth: number,
  ): Ty | undefined {
    type Cur = typeof start;
    let cur: Cur = start;
    const unknown: Cur = { t: "ty", ty: undefined };
    let i = from;
    while (i < toks.length) {
      const t = toks[i];
      if (t.k === "op" && t.v === ".") {
        const nm = toks[i + 1];
        if (!nm || nm.k !== "name") return undefined;
        i += 2;
        if (cur.t === "module") {
          const s = this.lookupSymbol(cur.file, nm.v);
          if (s) cur = { t: "sym", node: s };
          else {
            const sub = this.p.modules.get(`${cur.file.dotted}.${nm.v}`);
            cur = sub ? { t: "module", file: sub } : unknown;
          }
        } else if (cur.t === "package") {
          const dotted = `${cur.dotted}.${nm.v}`;
          const m = this.p.modules.get(dotted);
          cur = m
            ? { t: "module", file: m }
            : this.p.packages.has(dotted)
              ? { t: "package", dotted }
              : unknown;
        } else if (cur.t === "sym" && cur.node.kind === "class") {
          cur = { t: "clsattr", cls: cur.node, name: nm.v };
        } else if (cur.t === "extmod") {
          // a module attribute: still the module's namespace (os.path, ...)
        } else if (cur.t === "ty" && cur.ty?.k === "ext") {
          if (!cur.ty.derive) cur = unknown;
        } else if (cur.t === "ty" && cur.ty?.k === "cls") {
          if (toks[i]?.v === "(") {
            // a method of the instance's class: its return type is read at the call
            const classes = cur.ty.classes;
            const close = matching(toks, i);
            if (close === -1) return undefined;
            const ms: PyNode[] = [];
            for (const c of classes)
              for (const m of this.methods(c, nm.v)) if (!ms.includes(m)) ms.push(m);
            cur = ms.length
              ? {
                  t: "ty",
                  ty: Resolver.combine(
                    ms.map((m) =>
                      this.returnType(m, classes.length === 1 ? classes[0] : undefined),
                    ),
                  ),
                }
              : unknown;
            i = close + 1;
          } else cur = { t: "ty", ty: this.attrType(cur.ty.classes, nm.v) };
        } else cur = unknown;
        continue;
      }
      if (t.k === "op" && t.v === "(") {
        const close = matching(toks, i);
        if (close === -1) return undefined;
        i = close + 1;
        if (cur.t === "sym") {
          if (cur.node.kind === "class") cur = { t: "ty", ty: { k: "cls", classes: [cur.node] } };
          else if (cur.node.kind === "function") cur = { t: "ty", ty: this.returnType(cur.node) };
          else cur = unknown;
        } else if (cur.t === "clsattr") {
          const owner = cur.cls;
          const ms = this.methods(owner, cur.name, false);
          cur = ms.length
            ? { t: "ty", ty: Resolver.combine(ms.map((m) => this.returnType(m, owner))) }
            : unknown;
        } else if (cur.t === "extmod") {
          if (BPY_ROOTS.has(cur.root) || PASS_THROUGH_ROOTS.has(cur.root)) cur = unknown;
          else
            cur = SAFE_EXT_ROOTS.has(cur.root)
              ? { t: "ty", ty: { k: "ext", derive: true } }
              : unknown;
        } else if (cur.t === "ty" && cur.ty?.k === "ext") {
          if (!cur.ty.derive) cur = unknown;
        } else cur = unknown;
        continue;
      }
      return undefined; // subscripts and anything else
    }
    return cur.t === "ty" ? cur.ty : undefined;
  }

  /** The type a function returns: its return annotation, or every return statement agreeing. */
  returnType(fn: PyNode, selfCls?: PyNode): Ty | undefined {
    if (this.retGuard.has(fn)) return undefined;
    this.retGuard.add(fn);
    try {
      if (fn.returnAnn) return this.annotationType(fn.file, selfCls ?? fn.cls, fn.returnAnn);
      const list: (Ty | undefined)[] = [];
      for (const ll of fn.lines) {
        const t = ll.toks;
        if (t.some((x) => x.k === "name" && x.v === "yield")) return undefined;
        const r = t.findIndex((x, k) => x.k === "name" && x.v === "return" && t[k - 1]?.v !== ".");
        if (r === -1) continue;
        if (r !== 0) return undefined;
        list.push(t.length === 1 ? { k: "none" } : this.typeOfExpr(fn, t.slice(1), 1));
      }
      if (!list.length) return undefined;
      return Resolver.combine(list);
    } finally {
      this.retGuard.delete(fn);
    }
  }

  /** The type of attribute `attr` on instances of the classes, from assignments in the classes and their relatives. */
  attrType(classes: PyNode[], attr: string): Ty | undefined {
    const all: PyNode[] = [];
    for (const c of classes) {
      for (const k of [c, ...this.ancestors(c), ...(this.descendants.get(c) ?? [])]) {
        if (!all.includes(k)) all.push(k);
      }
    }
    const key = all.map((c) => c.id).join("|") + `#${attr}`;
    if (this.attrGuard.has(key)) return undefined;
    this.attrGuard.add(key);
    try {
      const list: (Ty | undefined)[] = [];
      for (const c of all) {
        const cb = this.bindingsOf(c, attr);
        if (cb.other) return undefined;
        for (const a of cb.assigns) {
          const t = a.ann ? this.annotationType(c.file, c, a.ann) : undefined;
          list.push(t ?? this.typeOfExpr(c, a.toks, 1));
        }
        for (const m of c.children) {
          if (m.kind !== "function" || m.decorators.includes("staticmethod")) continue;
          const self = m.params[0];
          if (!self) continue;
          for (const ll of m.lines) {
            for (const st of statementsOf(ll)) {
              if (indexAtTop(st, "=") === -1) continue;
              const segs = splitTopLevel(st, "=");
              const rhs = segs[segs.length - 1];
              for (const seg of segs.slice(0, -1)) {
                const direct = seg[0]?.v === self && seg[1]?.v === "." && seg[2]?.v === attr;
                if (direct && seg.length === 3) list.push(this.typeOfExpr(m, rhs, 1));
                else if (direct && seg[3]?.v === ":") {
                  list.push(
                    this.annotationType(m.file, c, seg.slice(4)) ?? this.typeOfExpr(m, rhs, 1),
                  );
                } else if (
                  seg.some(
                    (x, k) => x.v === attr && seg[k - 1]?.v === "." && seg[k - 2]?.v === self,
                  ) &&
                  seg.some((x) => x.v === ",")
                ) {
                  return undefined;
                }
              }
            }
          }
        }
      }
      if (!list.length) return undefined;
      return Resolver.combine(list);
    } finally {
      this.attrGuard.delete(key);
    }
  }

  isOperator(cls: PyNode): boolean {
    const c = this.opCache.get(cls);
    if (c !== undefined) return c;
    this.opCache.set(cls, false);
    let result = false;
    for (const chain of cls.baseChains) {
      const last = chain[chain.length - 1];
      if (last === "Operator") {
        if (chain.length >= 2) {
          const head = this.bindingTarget(cls.file, chain[0]);
          if (chain[0] === "bpy" || (head && head.type === "external")) result = true;
        } else {
          const b = cls.file.imports.get("Operator");
          if (b && /(^|\.)types$/.test(b.module)) result = true;
        }
      }
      const b = this.resolveClassRef(cls.file, chain);
      if (b && this.isOperator(b)) result = true;
      if (result) break;
    }
    this.opCache.set(cls, result);
    return result;
  }
}

/** The methods Blender itself calls on an operator. */
export const OPERATOR_ENTRY_POINTS: ReadonlySet<string> = new Set([
  "execute",
  "invoke",
  "modal",
  "poll",
  "draw",
  "check",
  "cancel",
]);

export type EdgeKind = "call" | "op" | "ref" | "name";
/** A condition the source states around a statement: an enclosing `if`, `elif`, `else` or `while`. */
export interface Guard {
  file: string;
  line: number;
  /** The header as written (an `else` names the chain it closes). */
  text: string;
}

export interface Edge {
  to: PyNode;
  kind: EdgeKind;
  line: number;
  /** Conditions enclosing the call that makes this edge. */
  guards: Guard[];
}

const GUARD_HEADS: ReadonlySet<string> = new Set(["if", "elif", "else", "while"]);
const GUARD_TEXT_MAX = 140;

/** Guards of a chain: the enclosing blocks, plus the line's own header when the chain sits after its colon. */
function guardsAt(
  node: PyNode,
  table: Map<LogicalLine, Guard[]>,
  ll: LogicalLine,
  tokIdx: number,
): Guard[] {
  const base = table.get(ll) ?? [];
  const f = ll.toks[0];
  if (f && f.k === "name" && GUARD_HEADS.has(f.v)) {
    const colon = indexAtTop(ll.toks, ":");
    if (colon !== -1 && tokIdx > colon) {
      const raw = collapse(node.file.textLines.slice(ll.line - 1, ll.endLine).join(" "));
      const text = raw.length > GUARD_TEXT_MAX ? `${raw.slice(0, GUARD_TEXT_MAX - 3)}...` : raw;
      return [...base, { file: node.file.rel, line: ll.line, text }];
    }
  }
  return base;
}

/** Enclosing conditions of every logical line of a scope, by indentation. */
function guardTable(node: PyNode): Map<LogicalLine, Guard[]> {
  const out = new Map<LogicalLine, Guard[]>();
  const stack: { indent: number; guard: Guard | null }[] = [];
  // The `if`/`elif` chain a following `elif` or `else` at the same indent would close, by indent. A chain
  // lives only while every statement at its indent is one of its own branches: any other statement there
  // (a `for`, `while`, `try`, a plain statement, a new `if`) ends it, and so does leaving its block. An
  // `else` that closes a `for`, `while` or `try` therefore finds no chain and keeps its own header.
  const chains = new Map<number, string[]>();
  for (const ll of node.lines) {
    while (stack.length && stack[stack.length - 1].indent >= ll.indent) stack.pop();
    out.set(
      ll,
      stack.flatMap((x) => (x.guard ? [x.guard] : [])),
    );
    const f = ll.toks[0];
    const continuesChain = f?.k === "name" && (f.v === "elif" || f.v === "else");
    for (const at of [...chains.keys()]) {
      if (at > ll.indent || (at === ll.indent && !continuesChain)) chains.delete(at);
    }
    const opens = indexAtTop(ll.toks, ":") !== -1;
    if (!f || f.k !== "name" || !opens) continue;
    if (!GUARD_HEADS.has(f.v)) {
      // other compound statements open a block without a condition
      if (["for", "try", "except", "finally", "with", "def", "class", "async"].includes(f.v)) {
        stack.push({ indent: ll.indent, guard: null });
      }
      continue;
    }
    const raw = collapse(node.file.textLines.slice(ll.line - 1, ll.endLine).join(" "));
    let text = raw.length > GUARD_TEXT_MAX ? `${raw.slice(0, GUARD_TEXT_MAX - 3)}...` : raw;
    if (f.v === "if") chains.set(ll.indent, [raw]);
    else if (f.v === "elif") chains.set(ll.indent, [...(chains.get(ll.indent) ?? []), raw]);
    else if (f.v === "else") {
      const prior = chains.get(ll.indent);
      if (prior) {
        text = `else (none of: ${prior.join(" / ")})`;
        if (text.length > GUARD_TEXT_MAX) text = `${text.slice(0, GUARD_TEXT_MAX - 3)}...`;
      }
      chains.delete(ll.indent);
    }
    stack.push({ indent: ll.indent, guard: { file: node.file.rel, line: ll.line, text } });
  }
  return out;
}

interface ChainRef {
  chain: string[];
  /** Index of the first token of the chain. */
  start: number;
  /** Index of the last token of the chain. */
  end: number;
  isCall: boolean;
  /** Index of "(" when a call. */
  open?: number;
  line: number;
  /** The receiver is an expression (`).x(`), so only the method name is known. */
  unknownHead: boolean;
  /** Source of the logical line the chain sits in. */
  ll: LogicalLine;
}

function chainsOf(ll: LogicalLine): ChainRef[] {
  const t = ll.toks;
  const out: ChainRef[] = [];
  const f = t[0];
  if (f.k === "name" && (f.v === "import" || f.v === "from")) return out;
  let i = 0;
  while (i < t.length) {
    const tok = t[i];
    if (tok.k !== "name" || KEYWORDS.has(tok.v)) {
      i++;
      continue;
    }
    const prev = t[i - 1];
    if (prev && prev.k === "op" && prev.v === ".") {
      const pp = t[i - 2];
      if (pp && pp.k === "op" && (pp.v === ")" || pp.v === "]")) {
        // `...).name(`: receiver is an expression.
        const next = t[i + 1];
        out.push({
          chain: ["?", tok.v],
          start: i,
          end: i,
          isCall: !!next && next.k === "op" && next.v === "(",
          open: next && next.v === "(" ? i + 1 : undefined,
          line: tok.line,
          unknownHead: true,
          ll,
        });
      }
      i++;
      continue;
    }
    if (prev && prev.k === "name" && (prev.v === "def" || prev.v === "class")) {
      i++;
      continue;
    }
    let chain = [tok.v];
    let j = i;
    if (tok.v === "super" && t[i + 1]?.v === "(" && t[i + 2]?.v === ")" && t[i + 3]?.v === ".") {
      chain = ["super()"];
      j = i + 2;
    }
    while (t[j + 1]?.k === "op" && t[j + 1].v === "." && t[j + 2]?.k === "name") {
      chain.push(t[j + 2].v);
      j += 2;
    }
    const next = t[j + 1];
    const isCall = !!next && next.k === "op" && next.v === "(";
    // A keyword-argument name (`f(update=cb)`): not a reference.
    const isKw =
      chain.length === 1 &&
      next?.k === "op" &&
      next.v === "=" &&
      !!prev &&
      prev.k === "op" &&
      (prev.v === "(" || prev.v === ",");
    if (!isKw) {
      out.push({
        chain,
        start: i,
        end: j,
        isCall,
        open: isCall ? j + 1 : undefined,
        line: tok.line,
        unknownHead: false,
        ll,
      });
    }
    i = j + 1;
  }
  return out;
}

export interface TypedCall {
  file: string;
  line: number;
  caller: string;
  /** The call as written, receiver included when it is a name; `<expr>.m` for an expression. */
  callee: string;
  /** `external` (a library or Blender class, no project code) or the project classes. */
  receiver: string;
  /** Project methods the call reaches (0 for an external receiver). */
  targets: number;
}

export interface Resolved {
  targets: PyNode[];
  /** `strong` for import / self / class resolution; `name` for method-name matches. */
  strength: "strong" | "name" | "none";
  /** The head names a class (constructor or `Class.method` call). */
  viaClass: boolean;
  viaOp?: boolean;
}

/** Tokens of the receiver expression of an `<expr>).name(` call, from the start of its postfix chain. */
function receiverTokens(c: ChainRef): Tok[] | undefined {
  const t = c.ll.toks;
  let i = c.start - 2; // the token before the "."
  if (i < 0) return undefined;
  for (;;) {
    const tk = t[i];
    if (!tk) return undefined;
    if (tk.k === "op" && (tk.v === ")" || tk.v === "]")) {
      let d = 0;
      let k = i;
      for (; k >= 0; k--) {
        const u = t[k];
        if (u.k !== "op") continue;
        if (u.v === ")" || u.v === "]" || u.v === "}") d++;
        else if (u.v === "(" || u.v === "[" || u.v === "{") {
          d--;
          if (d === 0) break;
        }
      }
      if (k < 0) return undefined;
      i = k - 1;
      // a call or subscript: the name before it belongs to the chain
      continue;
    }
    if (tk.k === "name" && !KEYWORDS.has(tk.v)) {
      if (t[i - 1]?.k === "op" && t[i - 1].v === ".") {
        i -= 2;
        continue;
      }
      return t.slice(i, c.start - 1);
    }
    return undefined;
  }
}

/**
 * The methods a typed receiver resolves to, as a strong resolution; `undefined` when the type is not known
 * (the caller then falls back to a name match). `path` is the attribute chain after the receiver.
 */
function typedMethods(rs: Resolver, ty: Ty | undefined, path: string[]): Resolved | undefined {
  const none: Resolved = { targets: [], strength: "none", viaClass: false };
  if (!ty || ty.k === "none") return undefined;
  if (ty.k === "ext") return path.length === 1 || ty.derive ? none : undefined;
  let classes = ty.classes;
  for (let k = 0; k < path.length - 1; k++) {
    const at = rs.attrType(classes, path[k]);
    if (!at) return undefined;
    if (at.k === "ext") return path.length - 1 === k + 1 || at.derive ? none : undefined;
    if (at.k === "none") return undefined;
    classes = at.classes;
  }
  const out: PyNode[] = [];
  for (const c of classes)
    for (const m of rs.methods(c, path[path.length - 1])) if (!out.includes(m)) out.push(m);
  return out.length ? { targets: out, strength: "strong", viaClass: false } : none;
}

function logTyped(
  rs: Resolver,
  caller: PyNode,
  c: ChainRef,
  callee: string,
  ty: Ty | undefined,
  res: Resolved,
): Resolved {
  if (!c.isCall) return res;
  const key = `${caller.file.rel}#L${c.line}#${callee}`;
  if (!rs.typedCalls.has(key)) {
    rs.typedCalls.set(key, {
      file: caller.file.rel,
      line: c.line,
      caller: caller.qual || "<module>",
      callee,
      receiver:
        ty?.k === "cls"
          ? ty.classes
              .map((k) => k.qual)
              .sort(compareCodeUnits)
              .join(" | ")
          : "external",
      targets: res.targets.length,
    });
  }
  return res;
}

function resolveChain(rs: Resolver, caller: PyNode, c: ChainRef): Resolved {
  const none: Resolved = { targets: [], strength: "none", viaClass: false };
  const file = caller.file;
  const chain = c.chain;
  const cls = caller.kind === "class" ? caller : caller.cls;
  const isSelf =
    cls !== undefined &&
    chain.length >= 2 &&
    (chain[0] === "self" || chain[0] === "cls" || (caller.cls && caller.params[0] === chain[0]));
  if (c.unknownHead || chain[0] === "?") {
    // The receiver is an expression: read its type when the source gives it.
    const recv = receiverTokens(c);
    const ty = recv ? rs.typeOfExpr(caller, recv) : undefined;
    const typed = typedMethods(rs, ty, [chain[chain.length - 1]]);
    if (typed) return logTyped(rs, caller, c, "<expr>." + chain[chain.length - 1], ty, typed);
    const m = rs.p.methodsByName.get(chain[chain.length - 1]) ?? [];
    return m.length ? { targets: m, strength: "name", viaClass: false } : none;
  }
  if (isSelf && cls) {
    if (chain.length === 2) {
      const m = rs.methods(cls, chain[1]);
      return m.length ? { targets: m, strength: "strong", viaClass: false } : none;
    }
    return none;
  }
  if (caller.kind === "class" && chain.length === 1) {
    // A bare name in a class body can name one of the class's own methods (`update=on_change`).
    const m = rs.methods(caller, chain[0], false);
    if (m.length) return { targets: m, strength: "strong", viaClass: false };
  }
  if (chain[0] === "super()" && cls) {
    const out: PyNode[] = [];
    for (const a of rs.ancestors(cls)) {
      for (const ch of a.children) if (ch.kind === "function" && ch.name === chain[1]) out.push(ch);
    }
    return out.length ? { targets: out, strength: "strong", viaClass: false } : none;
  }
  if (chain[0] === "bpy" && chain[1] === "ops" && chain.length === 4) {
    const op = rs.operatorsById.get(`${chain[2]}.${chain[3]}`);
    return op ? { targets: [op], strength: "strong", viaClass: false, viaOp: true } : none;
  }
  const t = rs.bindingTarget(file, chain[0]);
  if (!t) {
    // Unbound head: a local variable, a parameter, or a builtin.
    if (chain.length >= 2 && !KEYWORDS.has(chain[0])) {
      const ty = rs.typeOfName(caller, chain[0]);
      const typed = typedMethods(rs, ty, chain.slice(1));
      if (typed) return logTyped(rs, caller, c, chain.join("."), ty, typed);
      const m = rs.p.methodsByName.get(chain[chain.length - 1]) ?? [];
      return m.length ? { targets: m, strength: "name", viaClass: false } : none;
    }
    return none;
  }
  if (t.type === "external") return none;
  let cur: Target = t;
  for (let k = 1; k < chain.length; k++) {
    if (cur.type === "module") {
      const s = rs.lookupSymbol(cur.file, chain[k]);
      if (s) cur = { type: "symbol", node: s };
      else {
        const sub = rs.p.modules.get(`${cur.file.dotted}.${chain[k]}`);
        if (sub) cur = { type: "module", file: sub };
        else return none;
      }
    } else if (cur.type === "package") {
      const dotted: string = `${cur.dotted}.${chain[k]}`;
      const m = rs.p.modules.get(dotted);
      if (m) cur = { type: "module", file: m };
      else if (rs.p.packages.has(dotted)) cur = { type: "package", dotted };
      else return none;
    } else if (cur.type === "symbol" && cur.node.kind === "class") {
      if (k !== chain.length - 1) return none;
      const m = rs.methods(cur.node, chain[k]);
      return m.length ? { targets: m, strength: "strong", viaClass: true } : none;
    } else return none;
  }
  if (cur.type === "symbol") {
    if (cur.node.kind === "function")
      return { targets: [cur.node], strength: "strong", viaClass: false };
    const ctor = [
      ...rs.methods(cur.node, "__init__", false),
      ...rs.methods(cur.node, "__post_init__", false),
    ];
    return { targets: ctor, strength: "strong", viaClass: true };
  }
  return none;
}

// ── Module variables an operator fixes before it calls on ─────────────────────
//
// A condition such as `if NOTIFY_WORKBENCH:` tests a module variable. When the operator's own entry point
// assigns that variable a constant that makes the condition false, before the call that leads to the
// guarded Workbench call, the call cannot run from that operator. The rule, read from the source:
//  - the condition is a bare module variable, `if N:` / `elif N:` / `while N:` or the same with `not`;
//  - an entry point of the operator class itself (`execute`, `invoke`, ...) holds, at the top level of its
//    body, a statement that assigns N a constant: a call of a function that only does `global N; N = <param>`
//    with a constant argument, or `N = <constant>` after `global N`, or `<module>.N = <constant>`;
//  - that statement comes before the call (a call edge or call site) the path continues with;
//  - nothing in the project can set N back: every other write of N outside the module's own
//    initialisation is a constant that gives the same answer (a call that passes anything else, a
//    setter used as a callback, an augmented or unpacking assignment all leave the condition undecided).
// Anything the reader does not understand leaves the condition undecided and the row in place.

const AUG_OPS: ReadonlySet<string> = new Set([
  "+=",
  "-=",
  "*=",
  "/=",
  "//=",
  "%=",
  "**=",
  ">>=",
  "<<=",
  "&=",
  "|=",
  "^=",
  "@=",
]);

/** The condition of a guard header when it is one bare name, `if N:` (`negated` false) or `if not N:`. */
export interface GuardVar {
  name: string;
  negated: boolean;
}

/** One statement that gives a module variable a value. */
export interface WriteEvent {
  /** The scope the statement sits in. */
  node: PyNode;
  line: number;
  endLine: number;
  text: string;
  /** Truth value of the constant assigned; `undefined` when the value is not a constant. */
  truth: boolean | undefined;
  /** A plain statement at the top level of its function body: it runs whenever the function runs on. */
  top: boolean;
}

interface VarWrites {
  /** Some write of the variable is in a form the reader does not follow. */
  unsafe: boolean;
  /** Writes outside the module's own initialisation. */
  events: WriteEvent[];
}

/** Truth value of a constant (`False`, `None`, `0`, `""`, `True`, a number, a string), else undefined. */
export function constTruth(toks: Tok[]): boolean | undefined {
  let t = toks;
  while (t.length >= 3 && t[0].v === "(" && matching(t, 0) === t.length - 1) t = t.slice(1, -1);
  if (t.length !== 1) return undefined;
  const x = t[0];
  if (x.k === "name")
    return x.v === "True" ? true : x.v === "False" || x.v === "None" ? false : undefined;
  if (x.k === "num") {
    const n = Number(x.v.replace(/_/g, ""));
    return Number.isNaN(n) ? undefined : n !== 0;
  }
  if (x.k === "str") return x.f ? undefined : x.v.length > 0;
  return undefined;
}

function bodyIndent(node: PyNode): number {
  return node.lines.reduce((m, l) => Math.min(m, l.indent), Number.MAX_SAFE_INTEGER);
}

function declaresGlobal(node: PyNode, name: string): boolean {
  return node.lines.some(
    (l) =>
      l.toks[0]?.k === "name" &&
      l.toks[0].v === "global" &&
      l.toks.some((x) => x.k === "name" && x.v === name),
  );
}

/** A statement that is not a compound header or a header with a one-line body. */
function isSimpleLine(ll: LogicalLine): boolean {
  const f = ll.toks[0];
  return statementsOf(ll).length === 1 && !(f?.k === "name" && COMPOUND_HEADS.has(f.v));
}

/**
 * How the statements of one scope bind `name`: plain assignments with their right-hand sides, and `unsafe`
 * for every other binding form (augmented, unpacking, `for` / `with` / `except` target, walrus, `del`,
 * import, def, class, parameter of a nested def).
 */
function writesIn(
  node: PyNode,
  name: string,
): { sets: { rhs: Tok[]; ll: LogicalLine }[]; unsafe: boolean } {
  const out = { sets: [] as { rhs: Tok[]; ll: LogicalLine }[], unsafe: false };
  const bare = (t: Tok[], i: number): boolean =>
    t[i].k === "name" && t[i].v === name && t[i - 1]?.v !== ".";
  for (const ll of node.lines) {
    if (!ll.toks.some((x) => x.k === "name" && x.v === name)) continue;
    for (const st of statementsOf(ll)) {
      const f = st[0];
      if (!f) continue;
      if (f.k === "name" && (f.v === "global" || f.v === "nonlocal")) continue;
      if (f.k === "name" && (f.v === "import" || f.v === "from" || f.v === "del")) {
        if (st.some((_x, i) => bare(st, i))) out.unsafe = true;
        continue;
      }
      if (f.k === "name" && (f.v === "def" || f.v === "class" || f.v === "async")) {
        const h = parseHeader(st);
        if (h && (h.name === name || h.params.includes(name))) out.unsafe = true;
        continue;
      }
      for (let i = 0; i < st.length; i++) {
        const t = st[i];
        if (t.k === "name" && t.v === "for") {
          let d = 0;
          for (let k = i + 1; k < st.length; k++) {
            const u = st[k];
            if (u.k === "op" && (u.v === "(" || u.v === "[" || u.v === "{")) d++;
            else if (u.k === "op" && (u.v === ")" || u.v === "]" || u.v === "}")) d--;
            else if (u.k === "name" && u.v === "in" && d === 0) break;
            else if (bare(st, k)) out.unsafe = true;
          }
        } else if (t.k === "name" && t.v === "as" && st[i + 1]?.v === name) out.unsafe = true;
        else if (t.k === "op" && t.v === ":=" && st[i - 1]?.v === name && st[i - 2]?.v !== ".")
          out.unsafe = true;
      }
      let aug = -1;
      let d = 0;
      for (let i = 0; i < st.length && aug === -1; i++) {
        const t = st[i];
        if (t.k !== "op") continue;
        if (t.v === "(" || t.v === "[" || t.v === "{") d++;
        else if (t.v === ")" || t.v === "]" || t.v === "}") d--;
        else if (d === 0 && AUG_OPS.has(t.v)) aug = i;
      }
      if (aug !== -1 && aug === 1 && st[0].v === name) out.unsafe = true;
      if (indexAtTop(st, "=") === -1) continue;
      const segs = splitTopLevel(st, "=");
      const rhs = segs[segs.length - 1] ?? [];
      for (const seg of segs.slice(0, -1)) {
        if ((seg.length === 1 && seg[0].v === name) || (seg[0]?.v === name && seg[1]?.v === ":")) {
          out.sets.push({ rhs, ll });
        } else if (
          (seg[0]?.v === "(" ||
            seg[0]?.v === "[" ||
            seg[0]?.v === "*" ||
            indexAtTop(seg, ",") !== -1) &&
          seg.some((_x, i) => bare(seg, i))
        ) {
          out.unsafe = true;
        }
      }
    }
  }
  return out;
}

class VariableFlow {
  private writeCache = new Map<string, VarWrites>();
  private varCache = new Map<string, GuardVar | null>();

  constructor(private readonly rs: Resolver) {}

  /** The module variable a guard tests, or null when it tests anything else (or a local or imported name). */
  guardVar(g: Guard): GuardVar | null {
    const key = `${g.file}#${g.line}`;
    const hit = this.varCache.get(key);
    if (hit !== undefined) return hit;
    const v = this.readGuardVar(g);
    this.varCache.set(key, v);
    return v;
  }

  private readGuardVar(g: Guard): GuardVar | null {
    const file = this.rs.p.byRel.get(g.file);
    if (!file) return null;
    for (const scope of [file.module, ...file.nodes]) {
      const ll = scope.lines.find((l) => l.line === g.line);
      if (!ll) continue;
      const t = ll.toks;
      if (t[0]?.k !== "name" || !(t[0].v === "if" || t[0].v === "elif" || t[0].v === "while"))
        return null;
      const colon = indexAtTop(t, ":");
      if (colon === -1) return null;
      const unwrap = (x: Tok[]): Tok[] => {
        let c = x;
        while (c.length >= 3 && c[0].v === "(" && matching(c, 0) === c.length - 1)
          c = c.slice(1, -1);
        return c;
      };
      let cond = unwrap(t.slice(1, colon));
      let negated = false;
      if (cond[0]?.k === "name" && cond[0].v === "not") {
        negated = true;
        cond = unwrap(cond.slice(1));
      }
      if (cond.length !== 1 || cond[0].k !== "name" || KEYWORDS.has(cond[0].v)) return null;
      const name = cond[0].v;
      if (scope.kind === "class") return null;
      if (scope.kind === "function" && !declaresGlobal(scope, name)) {
        if (scope.params.includes(name)) return null;
        const local = writesIn(scope, name);
        if (local.sets.length || local.unsafe) return null;
      }
      const init = writesIn(file.module, name);
      if (!init.sets.length || init.unsafe) return null;
      return { name, negated };
    }
    return null;
  }

  /** The module of `file`'s name chain (`pkg.mod`, an import alias), when it is a module of the add-on. */
  private moduleOf(file: FileInfo, chain: string[]): FileInfo | undefined {
    const p = this.rs.p;
    let cur: Target | undefined = this.rs.bindingTarget(file, chain[0]);
    for (let k = 1; k < chain.length && cur; k++) {
      if (cur.type === "module") {
        const sub = p.modules.get(`${cur.file.dotted}.${chain[k]}`);
        cur = sub ? { type: "module", file: sub } : undefined;
      } else if (cur.type === "package") {
        const dotted: string = `${cur.dotted}.${chain[k]}`;
        const m = p.modules.get(dotted);
        cur = m
          ? { type: "module", file: m }
          : p.packages.has(dotted)
            ? { type: "package", dotted }
            : undefined;
      } else cur = undefined;
    }
    return cur?.type === "module" ? cur.file : undefined;
  }

  /** Every write of the module variable `name` of `file` outside the module's own initialisation. */
  writes(file: FileInfo, name: string): VarWrites {
    const key = `${file.rel}|${name}`;
    const hit = this.writeCache.get(key);
    if (hit) return hit;
    const out: VarWrites = { unsafe: false, events: [] };
    this.writeCache.set(key, out);
    const event = (
      node: PyNode,
      ll: LogicalLine,
      truth: boolean | undefined,
      simple: boolean,
    ): WriteEvent => ({
      node,
      line: ll.line,
      endLine: ll.endLine,
      text: (node.file.textLines[ll.line - 1] ?? "").trim().slice(0, QUOTE_MAX),
      truth,
      top: simple && node.kind === "function" && ll.indent === bodyIndent(node),
    });
    for (const node of this.rs.p.allNodes) {
      // `global name` in a function of the module: the assignments there write the variable.
      if (node.kind === "function" && node.file === file && declaresGlobal(node, name)) {
        const w = writesIn(node, name);
        if (w.unsafe) out.unsafe = true;
        for (const s of w.sets) {
          const truth = constTruth(s.rhs);
          const param = s.rhs.length === 1 && s.rhs[0].k === "name" ? s.rhs[0].v : undefined;
          if (truth !== undefined) out.events.push(event(node, s.ll, truth, isSimpleLine(s.ll)));
          else if (
            param !== undefined &&
            node.params.includes(param) &&
            !node.cls &&
            !node.parent
          ) {
            this.setterCalls(node, param, out, event);
          } else out.unsafe = true;
        }
      }
      // `<module>.name = value` from anywhere (the module's own top level is its initialisation).
      if (node.kind === "module" && node.file === file) continue;
      for (const ll of node.lines) {
        if (!ll.toks.some((x) => x.k === "name" && x.v === name)) continue;
        for (const st of statementsOf(ll)) {
          const dotted = (seg: Tok[]): string[] | null =>
            seg.length >= 3 &&
            seg.every((x, i) => (i % 2 === 0 ? x.k === "name" : x.v === ".")) &&
            seg[seg.length - 1].v === name
              ? seg.filter((x) => x.k === "name").map((x) => x.v)
              : null;
          const aug = st.findIndex((x) => x.k === "op" && AUG_OPS.has(x.v));
          if (aug > 0) {
            const chain = dotted(st.slice(0, aug));
            if (chain && this.moduleOf(node.file, chain.slice(0, -1)) === file) out.unsafe = true;
          }
          if (indexAtTop(st, "=") === -1) continue;
          const segs = splitTopLevel(st, "=");
          const rhs = segs[segs.length - 1] ?? [];
          for (const seg of segs.slice(0, -1)) {
            const chain = dotted(seg);
            if (!chain || this.moduleOf(node.file, chain.slice(0, -1)) !== file) continue;
            const truth = constTruth(rhs);
            if (truth === undefined) out.unsafe = true;
            else out.events.push(event(node, ll, truth, isSimpleLine(ll)));
          }
        }
      }
    }
    return out;
  }

  /** The calls of the setter `fn(param)` (a module function that assigns the parameter to a global). */
  private setterCalls(
    fn: PyNode,
    param: string,
    out: VarWrites,
    event: (
      node: PyNode,
      ll: LogicalLine,
      truth: boolean | undefined,
      simple: boolean,
    ) => WriteEvent,
  ): void {
    const idx = fn.params.indexOf(param);
    for (const caller of this.rs.p.allNodes) {
      for (const ll of caller.lines) {
        if (!ll.toks.some((x) => x.k === "name" && x.v === fn.name)) continue;
        for (const c of chainsOf(ll)) {
          if (c.chain[c.chain.length - 1] !== fn.name) continue;
          if (!resolveChain(this.rs, caller, c).targets.includes(fn)) continue;
          if (!c.isCall || c.open === undefined) {
            out.unsafe = true; // the setter is passed around: it can be called with any argument
            continue;
          }
          const slices = argSlices(ll.toks, c.open);
          if (slices.some((s) => s[0]?.v === "*" || s[0]?.v === "**")) {
            out.unsafe = true;
            continue;
          }
          const kw = slices.find((s) => s[0]?.k === "name" && s[0].v === param && s[1]?.v === "=");
          const pos = slices.filter((s) => !(s[0]?.k === "name" && s[1]?.v === "="));
          const arg = kw ? kw.slice(2) : pos[idx];
          const truth = arg ? constTruth(arg) : undefined;
          if (truth === undefined) {
            out.unsafe = true; // not given (the default applies) or not a constant
            continue;
          }
          const whole = c.start === 0 && matching(ll.toks, c.open) === ll.toks.length - 1;
          out.events.push(event(caller, ll, truth, whole && isSimpleLine(ll)));
        }
      }
    }
  }

  /**
   * The statement in `entry` that makes the condition of `g` false for a path that continues at `beforeLine`
   * of `entry` or later; null when the condition is not decided by the rule above.
   */
  decides(g: Guard, entry: PyNode, beforeLine: number): WriteEvent | null {
    const v = this.guardVar(g);
    if (!v) return null;
    const file = this.rs.p.byRel.get(g.file);
    if (!file) return null;
    const w = this.writes(file, v.name);
    if (w.unsafe || !w.events.length) return null;
    // `if N:` is false when N is false, `if not N:` when N is true: every write must give that answer.
    if (!w.events.every((e) => e.truth === v.negated)) return null;
    return w.events.find((e) => e.node === entry && e.top && e.endLine < beforeLine) ?? null;
  }
}

// ── Analysis ──────────────────────────────────────────────────────────────────

export interface KeyRead {
  key: string;
  file: string;
  line: number;
}

export interface ParamKeys {
  keys: string[];
  /** `literal`, `variable` (assembled in the function), `parameter`, `expression`, `none`. */
  source: string;
  variable?: string;
  /** Spread or computed entries that cannot be listed by name. */
  other: string[];
}

export interface CallSite {
  file: string;
  line: number;
  /** Enclosing function, `Class.method` form. */
  enclosing: string;
  /** The call as written: `workbench.call_function`. */
  callee: string;
  /** `module-function` (module-level client) or `class-method` (legacy `Workbench` class). */
  client: string;
  /** The NET function / handler name (the `APIFunc` value) when literal. */
  net_function: string | null;
  net_function_expr: string | null;
  params: ParamKeys;
  response_var: string | null;
  response_keys: KeyRead[];
  response_iterated: boolean;
  /** The response is returned or otherwise leaves the function unread. */
  response_escapes: boolean;
  /** Conditions the source states around the call (enclosing `if`, `elif`, `else`, `while`). */
  guards: Guard[];
  /** Operators whose entry points reach this site through calls (and `bpy.ops` invocations). */
  operators: string[];
  /** Operators that reach it only through a function passed as a callback. */
  operators_via_refs: string[];
}

export interface OperatorInfo {
  bl_idname: string | null;
  bl_idname_line: number | null;
  bl_idname_text: string | null;
  bl_label: string | null;
  bl_description: string | null;
  docstring: string | null;
  class_name: string;
  file: string;
  line: number;
  node: PyNode;
  /** `direct`, `call`, `ref`, `name` or `none`: the weakest edge kind needed to reach a call site. */
  reach: "direct" | "call" | "ref" | "name" | "none";
  chain: string[];
  nets: string[];
  /** NET functions reachable only through callbacks (bare function references). */
  nets_via_refs: string[];
  /**
   * Empty when some path to a Workbench call is not behind a condition the source states; otherwise the
   * conditions on the path with the fewest of them.
   */
  conditions: Guard[];
  /**
   * Empty unless the operator's own entry point sets a module variable so that the condition guarding
   * each of its paths to Workbench is false before that path (see `VariableFlow`); then the operator does
   * not reach Workbench and gets no row. One entry per statement and condition it relies on.
   */
  switchedOff: SwitchOff[];
}

/** A statement of an operator's own entry point and the condition on its path to Workbench it makes false. */
export interface SwitchOff {
  statement: { file: string; line: number; text: string };
  condition: Guard;
}

export interface Analysis {
  project: Project;
  sources: number;
  bytes: number;
  operators: OperatorInfo[];
  operatorClasses: number;
  withoutBlIdname: OperatorInfo[];
  duplicates: OperatorInfo[];
  clientFiles: { file: string; functions: { name: string; line: number }[] }[];
  callSites: CallSite[];
  edgeCounts: Record<EdgeKind, number>;
  /** Calls whose receiver type was read from the source (resolved, or proved to be no project code). */
  typedCalls: TypedCall[];
  /** Calls still matched by method name only (the receiver's type is not in the source). */
  nameCalls: { file: string; line: number; caller: string; callee: string; targets: number }[];
  tokenProblems: string[];
  version: AddonVersion;
}

export interface AddonVersion {
  bl_info_version: string | null;
  bl_info_blender: string | null;
  bl_info_file: string | null;
  bl_info_line: number | null;
  build_number: string | null;
  core_version: string | null;
}

function classAssign(
  cls: PyNode,
  name: string,
): { value: string | undefined; line: number; text: string } | null {
  for (const ll of cls.lines) {
    const t = ll.toks;
    if (t[0]?.k !== "name" || t[0].v !== name) continue;
    let eq = -1;
    if (t[1]?.v === "=") eq = 1;
    else if (t[1]?.v === ":") eq = t.findIndex((x) => x.k === "op" && x.v === "=");
    if (eq === -1) continue;
    return {
      value: stringLiteral(t.slice(eq + 1)),
      line: ll.line,
      text: cls.file.textLines[ll.line - 1]?.trim() ?? "",
    };
  }
  return null;
}

function docstringOf(cls: PyNode): string | null {
  const ll = cls.lines[0];
  if (!ll || ll.toks.length !== 1 || ll.toks[0].k !== "str" || ll.toks[0].f) return null;
  const para = ll.toks[0].v.trim().split(/\n\s*\n/)[0];
  const s = collapse(para);
  return s || null;
}

function lineNodes(node: PyNode): LogicalLine[] {
  return node.lines;
}

function keysOfDict(toks: Tok[]): { keys: string[]; other: string[] } | null {
  if (toks[0]?.v !== "{") return null;
  const close = matching(toks, 0);
  if (close === -1) return null;
  const inner = toks.slice(1, close);
  const keys: string[] = [];
  const other: string[] = [];
  for (const part of splitTopLevel(inner, ",")) {
    if (!part.length) continue;
    if (part[0].v === "**") {
      other.push(
        `**${part
          .slice(1)
          .map((x) => x.v)
          .join("")}`,
      );
    } else if (part[0].k === "str" && !part[0].f && part[1]?.v === ":") keys.push(part[0].v);
    else if (part.some((x) => x.k === "name" && x.v === "for")) other.push("<comprehension>");
    else {
      const colon = part.findIndex((x) => x.k === "op" && x.v === ":");
      other.push(
        `[${part
          .slice(0, colon === -1 ? part.length : colon)
          .map((x) => x.v)
          .join("")}]`,
      );
    }
  }
  return { keys, other };
}

interface DictEvent {
  line: number;
  type: "set" | "add";
  keys: string[];
  other: string[];
  literal: boolean;
}

function dictEvents(node: PyNode, v: string): DictEvent[] {
  const ev: DictEvent[] = [];
  for (const ll of node.lines) {
    const t = ll.toks;
    // `v = {...}` / `v: T = {...}`
    if (t[0]?.k === "name" && t[0].v === v) {
      let eq = -1;
      if (t[1]?.v === "=") eq = 1;
      else if (t[1]?.v === ":") eq = t.findIndex((x) => x.k === "op" && x.v === "=");
      if (eq !== -1) {
        const rhs = t.slice(eq + 1);
        const d = keysOfDict(rhs);
        ev.push({
          line: ll.line,
          type: "set",
          keys: d?.keys ?? [],
          other: d?.other ?? [],
          literal: d !== null && matching(rhs, 0) === rhs.length - 1,
        });
        continue;
      }
      // `v["k"] = ...` / `v["k"] += ...`
      if (t[1]?.v === "[" && t[2]?.k === "str" && !t[2].f && t[3]?.v === "]") {
        ev.push({ line: ll.line, type: "add", keys: [t[2].v], other: [], literal: true });
        continue;
      }
      if (t[1]?.v === "." && t[2]?.v === "update" && t[3]?.v === "(") {
        const close = matching(t, 3);
        const inner = t.slice(4, close === -1 ? undefined : close);
        const d = keysOfDict(inner);
        if (d) ev.push({ line: ll.line, type: "add", keys: d.keys, other: d.other, literal: true });
        else {
          const kws = splitTopLevel(inner, ",")
            .filter((p) => p[0]?.k === "name" && p[1]?.v === "=")
            .map((p) => p[0].v);
          ev.push({
            line: ll.line,
            type: "add",
            keys: kws,
            other: kws.length ? [] : ["update(...)"],
            literal: false,
          });
        }
        continue;
      }
      if (t[1]?.v === "." && t[2]?.v === "setdefault" && t[3]?.v === "(" && t[4]?.k === "str") {
        ev.push({ line: ll.line, type: "add", keys: [t[4].v], other: [], literal: true });
      }
    }
  }
  return ev.sort((a, b) => a.line - b.line);
}

function paramKeys(node: PyNode, argToks: Tok[], callLine: number): ParamKeys {
  if (argToks.length === 0) return { keys: [], source: "none", other: [] };
  const lit = keysOfDict(argToks);
  if (lit && matching(argToks, 0) === argToks.length - 1) {
    return {
      keys: [...new Set(lit.keys)].sort(compareCodeUnits),
      source: "literal",
      other: lit.other,
    };
  }
  if (argToks.length === 1 && argToks[0].k === "name") {
    const v = argToks[0].v;
    const ev = dictEvents(node, v);
    const sets = ev.filter((e) => e.type === "set");
    if (!sets.length) {
      return {
        keys: [],
        source: node.params.includes(v) ? "parameter" : "expression",
        variable: v,
        other: [],
      };
    }
    let startIdx = -1;
    for (let k = 0; k < ev.length; k++)
      if (ev[k].type === "set" && ev[k].line <= callLine) startIdx = k;
    if (startIdx === -1) startIdx = ev.findIndex((e) => e.type === "set");
    const keys: string[] = [];
    const other: string[] = [];
    for (let k = startIdx; k < ev.length; k++) {
      if (k > startIdx && ev[k].type === "set" && ev[k].line > callLine) break;
      if (k > startIdx && ev[k].type === "set") break;
      keys.push(...ev[k].keys);
      other.push(...ev[k].other);
    }
    return {
      keys: [...new Set(keys)].sort(compareCodeUnits),
      source: "variable",
      variable: v,
      other: [...new Set(other)],
    };
  }
  return {
    keys: [],
    source: "expression",
    other: [
      argToks
        .map((x) => (x.k === "str" ? JSON.stringify(x.v) : x.v))
        .join(" ")
        .slice(0, 80),
    ],
  };
}

function argSlices(toks: Tok[], open: number): Tok[][] {
  const close = matching(toks, open);
  const inner = toks.slice(open + 1, close === -1 ? undefined : close);
  return splitTopLevel(inner, ",");
}

function scanReads(
  node: PyNode,
  v: string,
  fromLine: number,
  rs: Resolver,
  edgeIndex: Map<PyNode, Map<string, Resolved>>,
  depth: number,
  seen: Set<string>,
  out: { reads: KeyRead[]; iterated: boolean; returned: boolean },
): void {
  const guardKey = `${node.id}|${v}|${fromLine}`;
  if (seen.has(guardKey) || depth > 3) return;
  seen.add(guardKey);
  for (const ll of node.lines) {
    if (ll.endLine < fromLine) continue;
    const t = ll.toks;
    for (let i = 0; i < t.length; i++) {
      if (t[i].k !== "name" || t[i].v !== v) continue;
      if (t[i - 1]?.v === ".") continue;
      if (
        t[i + 1]?.v === "." &&
        t[i + 2]?.v === "get" &&
        t[i + 3]?.v === "(" &&
        t[i + 4]?.k === "str"
      ) {
        out.reads.push({ key: t[i + 4].v, file: node.file.rel, line: t[i].line });
      } else if (
        t[i + 1]?.v === "[" &&
        t[i + 2]?.k === "str" &&
        !t[i + 2].f &&
        t[i + 3]?.v === "]"
      ) {
        if (t[i + 4]?.v !== "=")
          out.reads.push({ key: t[i + 2].v, file: node.file.rel, line: t[i].line });
      } else if (
        t[i - 1]?.v === "in" &&
        ((t[i - 2]?.k === "str" && !t[i - 2].f) || (t[i - 2]?.v === "not" && t[i - 3]?.k === "str"))
      ) {
        const s = t[i - 2].k === "str" ? t[i - 2] : t[i - 3];
        out.reads.push({ key: s.v, file: node.file.rel, line: t[i].line });
      } else if (
        t[i + 1]?.v === "." &&
        (t[i + 2]?.v === "items" ||
          t[i + 2]?.v === "keys" ||
          t[i + 2]?.v === "values" ||
          t[i + 2]?.v === "copy")
      ) {
        out.iterated = true;
      } else if (t[0]?.v === "return" && t[1]?.v === v && t.length === 2) {
        out.returned = true;
      }
    }
    // Pass-through: `v` as an argument of a call resolved to a project function.
    for (const c of chainsOf(ll)) {
      if (!c.isCall || c.open === undefined) continue;
      const slices = argSlices(t, c.open);
      const idx = slices.findIndex((s) => s.length === 1 && s[0].k === "name" && s[0].v === v);
      const kw = slices.findIndex(
        (s) => s.length === 3 && s[0].k === "name" && s[1].v === "=" && s[2].v === v,
      );
      if (idx === -1 && kw === -1) continue;
      const res = resolveChain(rs, node, c);
      if (res.strength !== "strong") continue;
      for (const target of res.targets) {
        const ps = target.params.slice();
        const isStatic = target.decorators.includes("staticmethod");
        if (target.cls && !isStatic) ps.shift();
        const pname = kw !== -1 ? (slices[kw][0].v as string) : ps[idx];
        if (!pname) continue;
        scanReads(target, pname, 0, rs, edgeIndex, depth + 1, seen, out);
      }
    }
  }
}

/** Runs the whole analysis over a set of sources. */
export function analyze(sources: PySource[], versionFiles: { build_ver?: string } = {}): Analysis {
  const project = buildProject(sources);
  const rs = new Resolver(project);

  // Operator classes.
  const opClasses = project.allNodes.filter((n) => n.kind === "class" && rs.isOperator(n));
  const operators: OperatorInfo[] = opClasses.map((c) => {
    const id = classAssign(c, "bl_idname");
    const label = classAssign(c, "bl_label");
    const desc = classAssign(c, "bl_description");
    return {
      bl_idname: id?.value ?? null,
      bl_idname_line: id?.line ?? null,
      bl_idname_text: id?.text ?? null,
      bl_label: label?.value ?? null,
      bl_description: desc?.value ?? null,
      docstring: docstringOf(c),
      class_name: c.name,
      file: c.file.rel,
      line: c.line,
      node: c,
      reach: "none",
      chain: [],
      nets: [],
      nets_via_refs: [],
      conditions: [],
      switchedOff: [],
    };
  });
  const seenIds = new Set<string>();
  const duplicates: OperatorInfo[] = [];
  const withoutBlIdname: OperatorInfo[] = [];
  for (const o of operators) {
    if (o.bl_idname === null) {
      withoutBlIdname.push(o);
      continue;
    }
    if (seenIds.has(o.bl_idname)) {
      duplicates.push(o);
      continue;
    }
    seenIds.add(o.bl_idname);
    rs.operatorsById.set(o.bl_idname, o.node);
  }

  // Client modules and their `call_function` definitions.
  const clientDefs = project.allNodes.filter(
    (n) => n.kind === "function" && n.name === "call_function" && /\bsocket\b/.test(n.file.text),
  );
  const clientSet = new Set(clientDefs);

  // Edges and call sites.
  const edges = new Map<PyNode, Edge[]>();
  const edgeCounts: Record<EdgeKind, number> = { call: 0, op: 0, ref: 0, name: 0 };
  const nameCalls: Analysis["nameCalls"] = [];
  const rawSites: { node: PyNode; ref: ChainRef; res: Resolved; def?: PyNode; guards: Guard[] }[] =
    [];
  const edgeIndex = new Map<PyNode, Map<string, Resolved>>();
  const allScopes = project.allNodes;
  for (const n of allScopes) {
    const list: Edge[] = [];
    const gt = guardTable(n);
    for (const ll of lineNodes(n)) {
      for (const c of chainsOf(ll)) {
        const first = c.chain[0];
        if (!c.isCall && c.chain.length === 1 && n.params.includes(first)) continue;
        const res = resolveChain(rs, n, c);
        if (res.strength === "none") continue;
        const gs = guardsAt(n, gt, ll, c.start);
        if (c.isCall) {
          if (res.strength === "strong") {
            const def = res.targets.find((t) => clientSet.has(t));
            if (def) rawSites.push({ node: n, ref: c, res, def, guards: gs });
          } else if (c.chain[c.chain.length - 1] === "call_function") {
            // unresolved head: still a call_function(...) site (kept, flagged)
            rawSites.push({ node: n, ref: c, res, guards: gs });
          }
          if (res.strength === "name") {
            nameCalls.push({
              file: n.file.rel,
              line: c.line,
              caller: n.qual || "<module>",
              callee: c.chain.join("."),
              targets: res.targets.length,
            });
          }
          for (const t of res.targets) {
            const kind: EdgeKind = res.viaOp ? "op" : res.strength === "strong" ? "call" : "name";
            list.push({ to: t, kind, line: c.line, guards: gs });
            if (res.viaOp) {
              // Invoking an operator runs its entry points (execute, invoke, ...).
              for (const anc of [t, ...rs.ancestors(t)]) {
                for (const ch of anc.children) {
                  if (ch.kind === "function" && OPERATOR_ENTRY_POINTS.has(ch.name)) {
                    list.push({ to: ch, kind, line: c.line, guards: gs });
                  }
                }
              }
            }
          }
        } else if (res.strength === "strong" && !res.viaClass) {
          for (const t of res.targets)
            if (t.kind === "function") list.push({ to: t, kind: "ref", line: c.line, guards: gs });
        }
      }
    }
    // a class also "contains" its methods for reach purposes: handled in BFS seeds.
    edges.set(n, list);
    for (const e of list) edgeCounts[e.kind]++;
  }

  // Call sites with parameter and response keys.
  const callSites: CallSite[] = [];
  const siteNodes = new Map<PyNode, CallSite[]>();
  for (const rsite of rawSites) {
    const { node, ref: c, def, guards } = rsite;
    const toks = c.ll.toks;
    const slices = c.open !== undefined ? argSlices(toks, c.open) : [];
    const defParams = def
      ? def.params.slice()
      : ["connection_info", "function_name", "function_parameters"];
    if (def?.cls && !def.decorators.includes("staticmethod")) defParams.shift();
    const argFor = (p: string, fallbackIdx: number): Tok[] | undefined => {
      const kw = slices.find((s) => s[0]?.k === "name" && s[0].v === p && s[1]?.v === "=");
      if (kw) return kw.slice(2);
      const pos = slices.filter((s) => !(s[0]?.k === "name" && s[1]?.v === "="));
      const i = defParams.indexOf(p);
      return pos[i === -1 ? fallbackIdx : i];
    };
    const nameArg = argFor(
      defParams[defParams.length - 2] ?? "function_name",
      defParams.length - 2,
    );
    const paramArg = argFor(
      defParams[defParams.length - 1] ?? "function_parameters",
      defParams.length - 1,
    );
    let net: string | null = null;
    let netExpr: string | null = null;
    if (nameArg && nameArg.length) {
      const lit = stringLiteral(nameArg);
      if (lit !== undefined) net = lit;
      else if (nameArg.length === 1 && nameArg[0].k === "name") {
        // `name = "X"` in the same function
        for (const ll of node.lines) {
          const t = ll.toks;
          if (t[0]?.v === nameArg[0].v && t[1]?.v === "=") {
            const l2 = stringLiteral(t.slice(2));
            if (l2 !== undefined) net = l2;
          }
        }
        if (net === null) netExpr = nameArg[0].v;
      } else
        netExpr = nameArg
          .map((x) => x.v)
          .join(" ")
          .slice(0, 80);
    }
    const params = paramKeys(node, paramArg ?? [], c.line);

    // Response: assigned variable, or chained read.
    let respVar: string | null = null;
    const startTok = toks[c.start - 1];
    if (startTok?.v === "=" && toks[0].k === "name" && (toks[1]?.v === "=" || toks[1]?.v === ":"))
      respVar = toks[0].v;
    else if (startTok?.v === ":=" && toks[c.start - 2]?.k === "name") respVar = toks[c.start - 2].v;
    const out = { reads: [] as KeyRead[], iterated: false, returned: false };
    if (respVar) scanReads(node, respVar, c.ll.line, rs, edgeIndex, 0, new Set(), out);
    if (c.open !== undefined) {
      const close = matching(toks, c.open);
      if (close !== -1) {
        const a = toks[close + 1];
        if (
          a?.v === "." &&
          toks[close + 2]?.v === "get" &&
          toks[close + 3]?.v === "(" &&
          toks[close + 4]?.k === "str"
        ) {
          out.reads.push({ key: toks[close + 4].v, file: node.file.rel, line: c.line });
        } else if (a?.v === "[" && toks[close + 2]?.k === "str" && toks[close + 3]?.v === "]") {
          out.reads.push({ key: toks[close + 2].v, file: node.file.rel, line: c.line });
        }
      }
    }
    if (!respVar && toks[0]?.v === "return") out.returned = true;
    const seenKey = new Set<string>();
    const reads = out.reads
      .filter((r) => {
        const k = `${r.key}|${r.file}|${r.line}`;
        if (seenKey.has(k)) return false;
        seenKey.add(k);
        return true;
      })
      .sort(
        (a, b) =>
          compareCodeUnits(a.key, b.key) || compareCodeUnits(a.file, b.file) || a.line - b.line,
      );
    const site: CallSite = {
      file: node.file.rel,
      line: c.line,
      enclosing: node.qual || "<module>",
      callee: c.chain.join("."),
      client: def ? (def.cls ? "class-method" : "module-function") : "unresolved",
      net_function: net,
      net_function_expr: netExpr,
      params,
      response_var: respVar,
      response_keys: reads,
      response_iterated: out.iterated,
      response_escapes: out.returned,
      guards,
      operators: [],
      operators_via_refs: [],
    };
    callSites.push(site);
    const arr = siteNodes.get(node) ?? [];
    arr.push(site);
    siteNodes.set(node, arr);
  }
  callSites.sort((a, b) => compareCodeUnits(a.file, b.file) || a.line - b.line);

  // Reach: BFS from each operator's own code, by edge-kind tiers.
  const bfs = (
    seeds: PyNode[],
    kinds: EdgeKind[],
  ): { sites: Set<CallSite>; chain: string[]; direct: boolean } => {
    const parent = new Map<PyNode, { from: PyNode | null; edge: Edge | null }>();
    const queue: PyNode[] = [];
    for (const s of seeds) {
      parent.set(s, { from: null, edge: null });
      queue.push(s);
    }
    const sites = new Set<CallSite>();
    let firstHit: PyNode | null = null;
    for (let qi = 0; qi < queue.length; qi++) {
      const cur = queue[qi];
      const hs = siteNodes.get(cur);
      if (hs) {
        for (const s of hs) sites.add(s);
        if (!firstHit) firstHit = cur;
      }
      for (const e of edges.get(cur) ?? []) {
        if (!kinds.includes(e.kind) || parent.has(e.to)) continue;
        parent.set(e.to, { from: cur, edge: e });
        queue.push(e.to);
      }
    }
    const chain: string[] = [];
    let c: PyNode | null = firstHit;
    while (c) {
      const p = parent.get(c);
      chain.unshift(
        `${c.file.rel}:${c.line} ${c.qual || "<module>"}${p?.edge ? ` (${p.edge.kind})` : ""}`,
      );
      c = p?.from ?? null;
    }
    return { sites, chain, direct: firstHit !== null && seeds.includes(firstHit) };
  };
  /**
   * The path to a call site with the fewest conditioned steps (an edge or a site that sits inside an
   * `if`/`elif`/`else`/`while`). Cost 0 means some path to Workbench is not behind any stated condition.
   */
  const leastGuarded = (
    seeds: PyNode[],
    kinds: EdgeKind[],
  ): { cost: number; guards: Guard[] } | null => {
    const dist = new Map<PyNode, number>();
    const prev = new Map<PyNode, { from: PyNode; edge: Edge } | null>();
    let level: PyNode[] = [];
    for (const sd of seeds) {
      dist.set(sd, 0);
      prev.set(sd, null);
      level.push(sd);
    }
    let best: { cost: number; node: PyNode; site: CallSite } | null = null;
    for (let cost = 0; level.length; cost++) {
      const next: PyNode[] = [];
      for (let qi = 0; qi < level.length; qi++) {
        const cur = level[qi];
        if (dist.get(cur) !== cost) continue;
        for (const st of siteNodes.get(cur) ?? []) {
          const c = cost + (st.guards.length ? 1 : 0);
          if (!best || c < best.cost) best = { cost: c, node: cur, site: st };
        }
        for (const e of edges.get(cur) ?? []) {
          if (!kinds.includes(e.kind)) continue;
          const nd = cost + (e.guards.length ? 1 : 0);
          const od = dist.get(e.to);
          if (od !== undefined && od <= nd) continue;
          dist.set(e.to, nd);
          prev.set(e.to, { from: cur, edge: e });
          if (nd === cost) level.push(e.to);
          else next.push(e.to);
        }
      }
      if (best && best.cost <= cost + 1) break;
      level = next;
    }
    if (!best) return null;
    const steps: Guard[][] = [];
    if (best.site.guards.length) steps.push(best.site.guards);
    let cur: PyNode | undefined = best.node;
    while (cur) {
      const pv: { from: PyNode; edge: Edge } | null | undefined = prev.get(cur);
      if (!pv) break;
      if (pv.edge.guards.length) steps.push(pv.edge.guards);
      cur = pv.from;
    }
    const seen = new Set<string>();
    const guards: Guard[] = [];
    for (const g of steps.reverse().flat()) {
      const k = `${g.file}#${g.line}`;
      if (!seen.has(k)) {
        seen.add(k);
        guards.push(g);
      }
    }
    return { cost: best.cost, guards };
  };
  const netName = (s: CallSite): string =>
    s.net_function ?? `<${s.net_function_expr ?? "dynamic"}>`;
  const flow = new VariableFlow(rs);
  /**
   * The statements of the operator's own entry points that make every path to a Workbench call dead, or
   * null when some path is still open. A step (an edge or a call site) is dead when a condition around it
   * is false because of a statement of the entry point the path starts in that comes before the step the
   * path continues with. Paths from the class body, from inherited entry points and from entry points
   * that fix nothing are walked without pruning.
   */
  const switchedOff = (o: OperatorInfo, seeds: PyNode[], kinds: EdgeKind[]): SwitchOff[] | null => {
    const used = new Map<string, SwitchOff>();
    type Dead = (gs: Guard[], to?: PyNode) => boolean;
    const anyOpen = (starts: PyNode[], dead: Dead): boolean => {
      const seen = new Set<PyNode>(starts);
      const queue = [...starts];
      for (let qi = 0; qi < queue.length; qi++) {
        const cur = queue[qi];
        if ((siteNodes.get(cur) ?? []).some((s) => !dead(s.guards))) return true;
        for (const e of edges.get(cur) ?? []) {
          if (!kinds.includes(e.kind) || seen.has(e.to) || dead(e.guards, e.to)) continue;
          seen.add(e.to);
          queue.push(e.to);
        }
      }
      return false;
    };
    const reachesWorkbench = new Map<PyNode, boolean>();
    const reaches = (n: PyNode): boolean => {
      let r = reachesWorkbench.get(n);
      if (r === undefined) {
        r = anyOpen([n], () => false);
        reachesWorkbench.set(n, r);
      }
      return r;
    };
    const ownEntries = new Set(
      o.node.children.filter((ch) => ch.kind === "function" && OPERATOR_ENTRY_POINTS.has(ch.name)),
    );
    // A decision is cited only when the step it kills leads to a Workbench call.
    const deadAfter =
      (entry: PyNode, line: number): Dead =>
      (gs, to) =>
        gs.some((g) => {
          const ev = flow.decides(g, entry, line);
          if (!ev) return false;
          if (to === undefined || reaches(to)) {
            used.set(`${ev.node.file.rel}#${ev.line}|${g.file}#${g.line}`, {
              statement: { file: ev.node.file.rel, line: ev.line, text: ev.text },
              condition: g,
            });
          }
          return true;
        });
    for (const sd of seeds) {
      if (!ownEntries.has(sd)) {
        if (anyOpen([sd], () => false)) return null;
        continue;
      }
      if ((siteNodes.get(sd) ?? []).some((s) => !deadAfter(sd, s.line)(s.guards))) return null;
      for (const e of edges.get(sd) ?? []) {
        if (!kinds.includes(e.kind)) continue;
        const dead = deadAfter(sd, e.line);
        if (dead(e.guards, e.to)) continue;
        if (anyOpen([e.to], dead)) return null;
      }
    }
    return used.size
      ? [...used.entries()].sort((a, b) => compareCodeUnits(a[0], b[0])).map((x) => x[1])
      : null;
  };
  for (const o of operators) {
    const seeds: PyNode[] = [o.node];
    for (const a of [o.node, ...rs.ancestors(o.node)]) {
      if (a !== o.node) seeds.push(a);
      for (const ch of a.children) {
        if (ch.kind === "function" && OPERATOR_ENTRY_POINTS.has(ch.name)) seeds.push(ch);
      }
    }
    const viaCalls = bfs(seeds, ["call", "op"]);
    const viaRefs = bfs(seeds, ["call", "op", "ref"]);
    o.nets = [...new Set([...viaCalls.sites].map(netName))].sort(compareCodeUnits);
    o.nets_via_refs = [
      ...new Set([...viaRefs.sites].filter((s) => !viaCalls.sites.has(s)).map(netName)),
    ].sort(compareCodeUnits);
    if (viaCalls.sites.size > 0) {
      o.reach = viaCalls.direct ? "direct" : "call";
      o.chain = viaCalls.chain;
    } else if (viaRefs.sites.size > 0) {
      o.reach = "ref";
      o.chain = viaRefs.chain;
    } else {
      const viaNames = bfs(seeds, ["call", "op", "ref", "name"]);
      if (viaNames.sites.size > 0) {
        o.reach = "name";
        o.chain = viaNames.chain;
        o.nets = [...new Set([...viaNames.sites].map(netName))].sort(compareCodeUnits);
      } else o.reach = "none";
    }
    if (o.reach === "direct" || o.reach === "call" || o.reach === "ref") {
      const lg = leastGuarded(seeds, o.reach === "ref" ? ["call", "op", "ref"] : ["call", "op"]);
      o.conditions = lg && lg.cost > 0 ? lg.guards : [];
      if (o.conditions.length) {
        o.switchedOff =
          switchedOff(o, seeds, o.reach === "ref" ? ["call", "op", "ref"] : ["call", "op"]) ?? [];
      }
    }
    if (o.bl_idname) {
      for (const s of viaCalls.sites) s.operators.push(o.bl_idname);
      for (const s of viaRefs.sites)
        if (!viaCalls.sites.has(s)) s.operators_via_refs.push(o.bl_idname);
    }
  }
  for (const s of callSites) {
    s.operators = [...new Set(s.operators)].sort(compareCodeUnits);
    s.operators_via_refs = [...new Set(s.operators_via_refs)].sort(compareCodeUnits);
  }

  // Client files.
  const clientFiles = [...new Set(clientDefs.map((d) => d.file))].map((f) => ({
    file: f.rel,
    functions: f.nodes
      .filter((n) => n.kind === "function")
      .map((n) => ({ name: n.qual, line: n.line }))
      .sort((a, b) => a.line - b.line),
  }));

  // Version.
  const version: AddonVersion = {
    bl_info_version: null,
    bl_info_blender: null,
    bl_info_file: null,
    bl_info_line: null,
    build_number: null,
    core_version: null,
  };
  for (const f of project.files) {
    if (!/\bbl_info\b/.test(f.text) || !f.isPackageInit) continue;
    const re = /^bl_info\s*=\s*\{/m;
    const m = re.exec(f.text);
    if (!m) continue;
    const lines = f.textLines;
    const startIdx = f.text.slice(0, m.index).split("\n").length - 1;
    for (let i = startIdx; i < Math.min(lines.length, startIdx + 40); i++) {
      const vm = /"version"\s*:\s*(\([^)]*\))/.exec(lines[i]);
      if (vm && !version.bl_info_version) {
        version.bl_info_version = vm[1];
        version.bl_info_file = f.rel;
        version.bl_info_line = i + 1;
      }
      const bm = /"blender"\s*:\s*(\([^)]*\))/.exec(lines[i]);
      if (bm && !version.bl_info_blender) version.bl_info_blender = bm[1];
      if (lines[i].startsWith("}")) break;
    }
    break;
  }
  if (versionFiles.build_ver) {
    try {
      const j = JSON.parse(versionFiles.build_ver) as {
        build_number?: string;
        core_version?: string;
      };
      version.build_number = j.build_number ?? null;
      version.core_version = j.core_version ?? null;
    } catch {
      /* malformed: leave null */
    }
  }

  return {
    project,
    sources: sources.length,
    bytes: sources.reduce((a, s) => a + s.raw.length, 0),
    operators,
    operatorClasses: operators.length,
    withoutBlIdname,
    duplicates,
    clientFiles,
    callSites,
    edgeCounts,
    typedCalls: [...rs.typedCalls.values()].sort(
      (a, b) =>
        compareCodeUnits(a.file, b.file) || a.line - b.line || compareCodeUnits(a.callee, b.callee),
    ),
    nameCalls: nameCalls.sort(
      (a, b) =>
        compareCodeUnits(a.file, b.file) || a.line - b.line || compareCodeUnits(a.callee, b.callee),
    ),
    tokenProblems: project.files.filter((f) => f.tokenProblems > 0).map((f) => f.rel),
    version,
  };
}

// ── Rows ──────────────────────────────────────────────────────────────────────

export const REACH_FOR_ROW: ReadonlySet<OperatorInfo["reach"]> = new Set(["direct", "call", "ref"]);

export function toolsRef(rel: string, line: number): string {
  return `<tools>/Blender/${rel}#L${line}`;
}

/** The `unverified` claim of an operator whose every path to Workbench sits inside a stated condition. */
export function conditionClaim(o: OperatorInfo): string | undefined {
  if (!o.conditions.length) return undefined;
  const list = o.conditions.map((g) => `${toolsRef(g.file, g.line)} ${g.text}`).join("; ");
  return (
    "Every path from this operator to a Workbench call in the add-on source sits inside a condition " +
    "the source states, so whether the call runs when the operator is used was not read. " +
    `Conditions on the path with the fewest: ${list}`
  );
}

/** The observation of one operator (never `name`-only reach; see `emittedOperators`). */
export function observationOf(o: OperatorInfo): Observation {
  const what = o.bl_description ? collapse(o.bl_description) : (o.docstring ?? "");
  const claim = conditionClaim(o);
  const obs: Observation = {
    dim: "ui",
    kind: "blender-operator",
    module: "BlenderTools",
    key: { path: [o.bl_idname as string] },
    parent_key: null,
    label: o.bl_label ? collapse(o.bl_label) || undefined : undefined,
    class_name: o.class_name,
    signature: o.bl_idname_text ? o.bl_idname_text.slice(0, QUOTE_MAX) : undefined,
    what: what || undefined,
    origin: "vanilla",
    ref: toolsRef(o.file, o.line),
    // the class statement line the ref points at, verbatim
    quote: (o.node.file.textLines[o.line - 1]?.trim() ?? "").slice(0, QUOTE_MAX) || undefined,
    confidence: claim ? "medium" : "high",
    ...(claim ? { unverified: [claim] } : {}),
    paths_proposed: [
      {
        path: "none-known",
        reason: "Blender add-on operator: documented surface only (decision D9)",
      },
    ],
  };
  return observationSchema.parse(obs);
}

function isEmitted(a: Analysis, o: OperatorInfo): boolean {
  return (
    o.bl_idname !== null &&
    REACH_FOR_ROW.has(o.reach) &&
    !a.duplicates.includes(o) &&
    o.switchedOff.length === 0
  );
}

export function emittedOperators(a: Analysis): OperatorInfo[] {
  return a.operators
    .filter((o) => isEmitted(a, o))
    .sort((x, y) => compareCodeUnits(x.bl_idname as string, y.bl_idname as string));
}

export interface E19Result {
  analysis: Analysis;
  rows: { id: string; obs: Observation }[];
  inputs: { path: string; sha256: string }[];
  /**
   * Operators not emitted: no Workbench reach, no literal bl_idname, duplicate, name-only reach, or a
   * condition the operator itself makes false. `evidence` carries the source line behind each name where
   * the reason needs one.
   */
  leftOut: { what: string; why: string; names: string[]; evidence?: string[] }[];
}

/** Runs the analysis and builds the observations. Pure apart from the sources it is given. */
export function importOperators(sources: PySource[], buildVer?: string): E19Result {
  const analysis = analyze(sources, { build_ver: buildVer });
  const rows = emittedOperators(analysis).map((o) => {
    const obs = observationOf(o);
    return { id: `ui:BlenderTools/blender-operator/${o.bl_idname}`, obs };
  });
  const inputs = sources.map((s) => ({ path: `<tools>/Blender/${s.rel}`, sha256: sha256(s.raw) }));
  const named = (list: OperatorInfo[]): string[] =>
    list.map((o) => o.bl_idname ?? o.class_name).sort(compareCodeUnits);
  const leftOut: E19Result["leftOut"] = [];
  const none = analysis.operators.filter(
    (o) => o.bl_idname !== null && o.reach === "none" && !analysis.duplicates.includes(o),
  );
  if (none.length)
    leftOut.push({
      what: "operators that never reach Workbench",
      why: "no call site of the Workbench client is reachable from the class",
      names: named(none),
    });
  const nameOnly = analysis.operators.filter((o) => o.reach === "name" && o.bl_idname !== null);
  if (nameOnly.length)
    leftOut.push({
      what: "operators reaching Workbench only through name-matched calls",
      why: "the only path to a call site goes through a method called on a receiver of unknown type",
      names: named(nameOnly),
    });
  const switchedOff = analysis.operators.filter(
    (o) =>
      o.bl_idname !== null &&
      REACH_FOR_ROW.has(o.reach) &&
      o.switchedOff.length > 0 &&
      !analysis.duplicates.includes(o),
  );
  if (switchedOff.length)
    leftOut.push({
      what: "operators that switch off the condition guarding their only path to Workbench",
      why:
        "an entry point of the operator class assigns a constant to the module variable the condition " +
        "tests, before the call that leads to the Workbench call, and nothing in the add-on sets it back; " +
        "the Workbench call cannot run from the operator",
      names: named(switchedOff),
      evidence: switchedOff
        .slice()
        .sort((x, y) => compareCodeUnits(x.bl_idname as string, y.bl_idname as string))
        .flatMap((o) =>
          o.switchedOff.map(
            (s) =>
              `${o.bl_idname}: ${toolsRef(s.statement.file, s.statement.line)} ${s.statement.text} ` +
              `makes false ${toolsRef(s.condition.file, s.condition.line)} ${s.condition.text}`,
          ),
        ),
    });
  if (analysis.withoutBlIdname.length)
    leftOut.push({
      what: "operator classes without a literal bl_idname",
      why: "base or abstract classes; no identity",
      names: named(analysis.withoutBlIdname),
    });
  if (analysis.duplicates.length)
    leftOut.push({
      what: "operator classes repeating a bl_idname",
      why: "the first class in file order keeps the id",
      names: named(analysis.duplicates),
    });
  return { analysis, rows, inputs, leftOut };
}

/** Exact text of the E19 observation file. */
export function observationFileText(result: E19Result, build: string): string {
  const header = {
    $header: 1,
    build,
    enumerator: ENUMERATOR_ID,
    generator: GENERATOR,
    inputs: result.inputs,
    provisional: false,
    row_count: result.rows.length,
  };
  const lines = [jsonlLine(header, ["$header"]), ...result.rows.map((r) => jsonlLine(r.obs))];
  return lines.join("\n") + "\n";
}

// ── The call-site table (E04's input) ─────────────────────────────────────────

export interface NetFunctionSummary {
  name: string;
  call_sites: number;
  request_keys: string[];
  response_keys: string[];
  sites: string[];
  operators: string[];
  operators_via_callbacks: string[];
}

export function netFunctionTable(a: Analysis): NetFunctionSummary[] {
  const byName = new Map<string, CallSite[]>();
  for (const s of a.callSites) {
    const k = s.net_function ?? `<${s.net_function_expr ?? "dynamic"}>`;
    const arr = byName.get(k) ?? [];
    arr.push(s);
    byName.set(k, arr);
  }
  return [...byName.entries()]
    .map(([name, sites]) => ({
      name,
      call_sites: sites.length,
      request_keys: [...new Set(sites.flatMap((s) => s.params.keys))].sort(compareCodeUnits),
      response_keys: [...new Set(sites.flatMap((s) => s.response_keys.map((r) => r.key)))].sort(
        compareCodeUnits,
      ),
      sites: sites.map((s) => `${s.file}#L${s.line}`),
      operators: [...new Set(sites.flatMap((s) => s.operators))].sort(compareCodeUnits),
      operators_via_callbacks: [...new Set(sites.flatMap((s) => s.operators_via_refs))].sort(
        compareCodeUnits,
      ),
    }))
    .sort((x, y) => compareCodeUnits(x.name, y.name));
}

/** Response keys grouped by name with the places that read them. */
export function groupReads(reads: KeyRead[]): { key: string; at: string[] }[] {
  const m = new Map<string, string[]>();
  for (const r of reads) {
    const arr = m.get(r.key) ?? [];
    arr.push(`${r.file}#L${r.line}`);
    m.set(r.key, arr);
  }
  return [...m.entries()]
    .map(([key, at]) => ({ key, at }))
    .sort((x, y) => compareCodeUnits(x.key, y.key));
}

export function callSitesDocument(result: E19Result, build: string): unknown {
  const a = result.analysis;
  return {
    $comment:
      "E19 raw material for E04 (plan 4.5): every call site of the Enfusion Blender Tools add-on's Workbench client. File paths are relative to <tools>/Blender. Request keys come from the dict literal or the variable assembled in the calling function; response keys are the keys the caller reads (directly, or after passing the response to a project function). Static reading, not execution.",
    enumerator: ENUMERATOR_ID,
    build,
    addon: {
      files: a.sources,
      bytes: a.bytes,
      ...a.version,
    },
    client_modules: a.clientFiles,
    net_functions: netFunctionTable(a),
    call_sites: a.callSites.map((s) => ({ ...s, response_keys: groupReads(s.response_keys) })),
    operators: a.operators
      .map((o) => ({
        bl_idname: o.bl_idname,
        class_name: o.class_name,
        file: o.file,
        line: o.line,
        reach: o.reach,
        emitted: isEmitted(a, o),
        net_functions: o.nets,
        net_functions_via_callbacks: o.nets_via_refs,
        only_behind_conditions: o.conditions.map((g) => `${g.file}#L${g.line} ${g.text}`),
        switched_off_by: o.switchedOff.map(
          (s) =>
            `${s.statement.file}#L${s.statement.line} ${s.statement.text} -> ${s.condition.file}#L${s.condition.line} ${s.condition.text}`,
        ),
        chain: o.chain,
      }))
      .sort((x, y) => compareCodeUnits(x.bl_idname ?? x.class_name, y.bl_idname ?? y.class_name)),
    left_out: result.leftOut,
    receiver_resolutions: a.typedCalls,
    name_matched_calls: a.nameCalls,
    parse_problems: a.tokenProblems,
  };
}

// ── CLI ───────────────────────────────────────────────────────────────────────

const USAGE =
  "usage: e19-blender-operators.ts [--tools <dir>] [--build <tag>] [--out <file under observations/E19/>] [--artifacts <dir>] [--data <dir>] [--json]";

export function resolveOut(paths: CensusPaths, out: string | undefined, build: string): string {
  const dir = join(paths.observations, ENUMERATOR_ID);
  const file = out ? resolve(out) : join(dir, `${build}.jsonl`);
  if (dirname(file) !== dir || !file.endsWith(".jsonl")) {
    throw new Error(
      "refusing --out outside observations/E19/ (E19 writes only its own observation directory)",
    );
  }
  return file;
}

/** `<tools>/Blender` plus the build_ver.json text when present. */
function loadSources(blenderDir: string): { sources: PySource[]; buildVer?: string } {
  const sources = readSources(blenderDir);
  let buildVer: string | undefined;
  for (const s of sources) {
    if (s.rel.endsWith("/__init__.py") && /\bbl_info\b/.test(s.text)) {
      const p = join(blenderDir, dirOf(s.rel), "build_ver.json");
      if (!s.rel.includes("!/") && existsSync(p)) buildVer = readFileSync(p, "utf-8");
      break;
    }
  }
  return { sources, buildVer };
}

export function run(argv: string[], io: Io = PROCESS_IO): number {
  return guard(io, "e19-blender-operators", () => {
    const { values } = parseArgs({
      args: argv,
      options: {
        tools: { type: "string" },
        build: { type: "string" },
        out: { type: "string" },
        artifacts: { type: "string" },
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
      io.err(`e19-blender-operators: ${e instanceof Error ? e.message : String(e)}`);
      return EXIT_FAIL;
    }
    const toolsDir = values.tools ? resolve(values.tools) : loadConfig().workbenchPath;
    const blenderDir = join(toolsDir, "Blender");
    if (!existsSync(blenderDir)) {
      io.out("NO DATA: no <tools>/Blender directory; nothing enumerated");
      return EXIT_USAGE;
    }
    const { sources, buildVer } = loadSources(blenderDir);
    if (sources.length === 0) {
      io.out("NO DATA: no Python source under <tools>/Blender; nothing enumerated");
      return EXIT_USAGE;
    }
    const result = importOperators(sources, buildVer);
    const docText = formatJson(callSitesDocument(result, build));
    if (containsMachinePath(docText)) {
      io.err("e19-blender-operators: the call-site table holds a machine path; not written");
      return EXIT_FAIL;
    }
    mkdirSync(dirname(out), { recursive: true });
    writeFileAtomic(out, observationFileText(result, build));
    const artifactRoot = values.artifacts ? resolve(values.artifacts) : artifactsDir();
    const sitesFile = join(artifactRoot, "census", build, ENUMERATOR_ID, "net-call-sites.json");
    mkdirSync(dirname(sitesFile), { recursive: true });
    writeFileAtomic(sitesFile, docText);

    const a = result.analysis;
    const byReach: Record<string, number> = {};
    for (const o of a.operators) byReach[o.reach] = (byReach[o.reach] ?? 0) + 1;
    const distinct = new Set(
      a.callSites.map((s) => s.net_function).filter((x): x is string => x !== null),
    );
    if (values.json) {
      io.out(
        JSON.stringify({
          ok: true,
          command: "e19-blender-operators",
          build,
          py_files: a.sources,
          py_bytes: a.bytes,
          operator_classes: a.operatorClasses,
          operators_by_reach: byReach,
          rows: result.rows.length,
          net_functions: [...distinct].sort(compareCodeUnits),
          call_sites: a.callSites.length,
          version: a.version,
          left_out: result.leftOut.map((l) => ({
            what: l.what,
            count: l.names.length,
            ...(l.evidence ? { evidence: l.evidence } : {}),
          })),
        }),
      );
      return EXIT_OK;
    }
    const reachText = Object.entries(byReach)
      .map(([k, v]) => `${k} ${v}`)
      .join(", ");
    io.out(
      `E19 at build ${build}: ${a.sources} .py files (${a.bytes} bytes), ${a.operatorClasses} operator classes ` +
        `(reach: ${reachText}), ${result.rows.length} rows, ${distinct.size} distinct NET functions, ` +
        `${a.callSites.length} call sites`,
    );
    for (const l of result.leftOut) {
      io.out(`left out: ${l.names.length} ${l.what}`);
      for (const line of l.evidence ?? []) io.out(`  ${line}`);
    }
    return EXIT_OK;
  });
}

if (isMainModule(import.meta.url)) process.exitCode = run(process.argv.slice(2));
