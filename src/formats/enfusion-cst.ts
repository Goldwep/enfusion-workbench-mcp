/**
 * Lossless concrete syntax tree for Enfusion text resources (plan 8 work
 * package 3.4, DEC-048 package D).
 *
 * Every character of the input belongs to exactly one token, trivia included
 * (spaces, tabs, comments and each line ending as written), so `serialize()`
 * is the concatenation of the tokens and equals the input for any input. The
 * tree is built on top of the tokens and never throws: a construct the
 * builder does not know (a stray `}`, an entry that starts with `:`) becomes
 * an `opaque` entry with a diagnostic, and its bytes stay in place.
 *
 * Constructs (vanilla shapes, read through tests/corpus/_corpus.ts):
 *   object   `Type [Name | "Name" | "{GUID}"] [: "{GUID}base.et"] {` ... `}`
 *            also `Key Class "{GUID}" {` and legacy `$grp Type : "..." {`
 *   scalar   `Key value...` on one line: one value, a bare multi-word enum or
 *            a bare number list (`Alignment 0.5 0.5`), quoting kept as written
 *   value    a keyless line inside a block: `"text"`, `3`, `2 8 20 50`
 *   opaque   anything else, kept verbatim
 *
 * Edits splice the text and parse again: bytes outside the edited span never
 * change. Fresh nodes are written in the engine's style as the vanilla files
 * show it (see FRESH STYLE below). The engine loads non-canonical text and
 * `SaveContainer` canonicalises (DEC-044, U11), so the style is a courtesy to
 * diffs, not a load requirement.
 *
 * Metas: this module writes no `.meta`. Where a meta writer comes, note
 * DEC-044 U25: a hand-written `.conf` meta resolves; hand `.et` and `.png`
 * metas did not.
 */

// ── Tokens ───────────────────────────────────────────────────────────────────

export type TokenKind =
  | "ws"
  | "eol"
  | "comment"
  | "string"
  | "word"
  | "lbrace"
  | "rbrace"
  | "colon";

export interface Token {
  kind: TokenKind;
  start: number;
  end: number;
  text: string;
}

export interface Diagnostic {
  offset: number;
  line: number;
  message: string;
}

function isWs(c: string): boolean {
  return c === " " || c === "\t" || c === "\f" || c === "\v" || c === "\uFEFF";
}

/** Splits `text` into tokens that cover every character exactly once. */
export function tokenize(text: string, diags: Diagnostic[] = []): Token[] {
  const out: Token[] = [];
  const n = text.length;
  let i = 0;
  const push = (kind: TokenKind, s: number, e: number) =>
    out.push({ kind, start: s, end: e, text: text.slice(s, e) });
  while (i < n) {
    const c = text[i];
    const s = i;
    if (c === "\r") {
      i += text[i + 1] === "\n" ? 2 : 1;
      push("eol", s, i);
    } else if (c === "\n") {
      i++;
      push("eol", s, i);
    } else if (isWs(c)) {
      while (i < n && isWs(text[i])) i++;
      push("ws", s, i);
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < n && text[i] !== "\n" && text[i] !== "\r") i++;
      push("comment", s, i);
    } else if (c === "/" && text[i + 1] === "*") {
      const close = text.indexOf("*/", i + 2);
      i = close < 0 ? n : close + 2;
      if (close < 0) diags.push(diag(text, s, "unterminated block comment"));
      push("comment", s, i);
    } else if (c === '"') {
      let j = i + 1;
      let closed = false;
      while (j < n) {
        const d = text[j];
        if (d === "\r" || d === "\n") break; // strings stay on one line
        if (d === "\\" && j + 1 < n && text[j + 1] !== "\r" && text[j + 1] !== "\n") j += 2;
        else if (d === '"') {
          j++;
          closed = true;
          break;
        } else j++;
      }
      if (!closed) {
        // Unterminated: it ends at the line end so the rest of the file still parses.
        j = Math.min(j, n);
        diags.push(diag(text, s, "unterminated string"));
      }
      i = j;
      push("string", s, i);
    } else if (c === "{") {
      i++;
      push("lbrace", s, i);
    } else if (c === "}") {
      i++;
      push("rbrace", s, i);
    } else if (c === ":") {
      i++;
      push("colon", s, i);
    } else {
      while (i < n) {
        const d = text[i];
        if (d === "\r" || d === "\n" || isWs(d) || d === '"' || d === "{" || d === "}" || d === ":")
          break;
        if (d === "/" && (text[i + 1] === "/" || text[i + 1] === "*") && i > s) break;
        i++;
      }
      push("word", s, i);
    }
  }
  return out;
}

function diag(text: string, offset: number, message: string): Diagnostic {
  let line = 1;
  for (let k = 0; k < offset; k++) {
    if (text[k] === "\n" || (text[k] === "\r" && text[k + 1] !== "\n")) line++;
  }
  return { offset, line, message };
}

// ── Tree ─────────────────────────────────────────────────────────────────────

export interface CstObject {
  kind: "object";
  /** First header word (`components`, `GenericEntity`, `$grp`); "" for a bare `{`. */
  key: string;
  /** Header tokens before the colon (words and strings), the key first. */
  head: Token[];
  /** Header tokens after the colon (the base reference). */
  base: Token[];
  /** True for a `$`-prefixed legacy node. */
  legacy: boolean;
  open: Token;
  /** Undefined when the block is not closed before the end of the text. */
  close?: Token;
  children: CstEntry[];
  start: number;
  end: number;
}

export interface CstScalar {
  kind: "scalar";
  key: string;
  keyToken: Token;
  values: Token[];
  start: number;
  end: number;
}

export interface CstValue {
  kind: "value";
  values: Token[];
  start: number;
  end: number;
}

export interface CstOpaque {
  kind: "opaque";
  tokens: Token[];
  reason: string;
  start: number;
  end: number;
}

export type CstEntry = CstObject | CstScalar | CstValue | CstOpaque;

/** The document root: a block without header or braces. */
export interface CstRoot {
  kind: "root";
  children: CstEntry[];
}

const NUMERIC_START = /^[-+]?(?:0[xX][0-9A-Fa-f]|\d|\.\d)/;

function build(text: string, tokens: Token[], diags: Diagnostic[]): CstRoot {
  const root: CstRoot = { kind: "root", children: [] };
  const stack: (CstRoot | CstObject)[] = [root];
  let pending: Token[] = [];
  const top = () => stack[stack.length - 1];
  const flush = () => {
    if (pending.length === 0) return;
    const p = pending;
    pending = [];
    const start = p[0].start;
    const end = p[p.length - 1].end;
    const first = p[0];
    let entry: CstEntry;
    if (first.kind === "word" && !NUMERIC_START.test(first.text)) {
      entry = { kind: "scalar", key: first.text, keyToken: first, values: p.slice(1), start, end };
    } else if (first.kind === "string" || first.kind === "word") {
      entry = { kind: "value", values: p, start, end };
    } else {
      entry = { kind: "opaque", tokens: p, reason: "entry starts with ':'", start, end };
      diags.push(diag(text, start, entry.reason));
    }
    top().children.push(entry);
  };
  for (const t of tokens) {
    switch (t.kind) {
      case "ws":
      case "comment":
        break;
      case "eol":
        flush();
        break;
      case "lbrace": {
        const header = pending;
        pending = [];
        const ci = header.findIndex((h) => h.kind === "colon");
        const head = ci < 0 ? header : header.slice(0, ci);
        const base = ci < 0 ? [] : header.slice(ci + 1).filter((h) => h.kind !== "colon");
        const key = head[0]?.text ?? "";
        const obj: CstObject = {
          kind: "object",
          key,
          head,
          base,
          legacy: key.startsWith("$"),
          open: t,
          children: [],
          start: header[0]?.start ?? t.start,
          end: t.end,
        };
        top().children.push(obj);
        stack.push(obj);
        break;
      }
      case "rbrace": {
        flush();
        if (stack.length > 1) {
          const obj = stack.pop() as CstObject;
          obj.close = t;
          obj.end = t.end;
        } else {
          root.children.push({
            kind: "opaque",
            tokens: [t],
            reason: "unmatched '}'",
            start: t.start,
            end: t.end,
          });
          diags.push(diag(text, t.start, "unmatched '}'"));
        }
        break;
      }
      default:
        pending.push(t);
    }
  }
  flush();
  while (stack.length > 1) {
    const obj = stack.pop() as CstObject;
    const last = obj.children[obj.children.length - 1];
    obj.end = last ? Math.max(last.end, obj.open.end) : obj.open.end;
    diags.push(diag(text, obj.open.start, `block '${obj.key}' not closed`));
  }
  return root;
}

// ── Values ───────────────────────────────────────────────────────────────────

/**
 * A token's value: a string without its quotes and with `\"` undone, a word
 * as is. Other backslashes are literal both ways (`quote` writes them as
 * given), so set then get returns the same value.
 */
export function tokenValue(t: Token): string {
  if (t.kind !== "string") return t.text;
  const inner = t.text.endsWith('"') && t.text.length >= 2 ? t.text.slice(1, -1) : t.text.slice(1);
  return inner.replace(/\\"/g, '"');
}

export type ScalarItem = string | number | boolean;
export type ScalarInput = ScalarItem | readonly ScalarItem[];

export type CstGet =
  | { kind: "scalar"; key: string; values: string[]; raw: string; quoted: boolean[] }
  | { kind: "value"; values: string[]; raw: string; quoted: boolean[] }
  | {
      kind: "object";
      key: string;
      head: string[];
      base?: string;
      legacy: boolean;
      count: number;
    }
  | { kind: "opaque"; raw: string; reason: string };

/**
 * Codes as in the response contract (design section 4): a malformed path or
 * value is INVALID_ARGUMENT; PATH_NOT_FOUND lists the sibling keys.
 */
export type CstErrorCode = "PATH_NOT_FOUND" | "INVALID_ARGUMENT" | "UNSUPPORTED";

export class CstEditError extends Error {
  constructor(
    readonly code: CstErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CstEditError";
  }
}

// ── Fresh style ──────────────────────────────────────────────────────────────
// FRESH STYLE, from vanilla files read through the corpus harness at build
// 1.8.0.13 (Configs/Actions/SupportStationActions/Refuel/Refuel_CargoTank.conf,
// UI/layouts/AirSupport/MapAreaDot.layout, Assets/Items/Equipment/workspaces/
// Binoculars_B12.agr, AI/BehaviorTrees/Animals/AnimalReactToDanger.bt,
// Configs/.../ActionsManagerComponent_RepairVehicleLight.ct): one space of
// indent per depth; `Key value` with one space; several values on one line
// separated by one space (`Alignment 0.5 0.5`); numbers and enums bare,
// strings and resource names quoted (`Texture "{GUID}path"`); booleans 0/1;
// headers `Type Name {`, `Type "Spaced Name" {`, `Type "{GUID}" : "{GUID}base" {`;
// the closing brace on its own line at the header's indent, also when empty.
// A fresh line takes its sibling's indent when the block has children, and
// the line ending of the block's own header line.

export interface ObjectSpec {
  /** The first header word: a property key (`Slot`) or the class (`ImageWidgetClass`). */
  key: string;
  /** Class after a property key (`Slot FrameWidgetSlot "{GUID}" {`). */
  className?: string;
  /** Instance name; bare when it is an identifier, else quoted. */
  name?: string;
  /** Instance GUID, 16 hex digits with or without braces. */
  guid?: string;
  /** Base reference after the colon, written quoted. */
  base?: string;
  entries?: EntrySpec[];
}

export type EntrySpec =
  | { key: string; value: ScalarInput; quoted?: boolean }
  | { value: ScalarInput; quoted?: boolean }
  | { object: ObjectSpec };

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

function quote(s: string): string {
  if (/["\r\n]/.test(s) || s.endsWith("\\")) {
    throw new CstEditError(
      "INVALID_ARGUMENT",
      `string value cannot hold a quote or line break: ${s}`,
    );
  }
  return `"${s}"`;
}

/** True when `v` can stand bare: no blank, quote, brace, colon or comment opener. */
function bareSafe(v: string): boolean {
  return v !== "" && !/[\s"{}:]|\/[/*]/.test(v);
}

function formatItem(v: ScalarItem, quoted: boolean | undefined): string {
  if (typeof v === "boolean") return quoted === true ? quote(v ? "1" : "0") : v ? "1" : "0";
  if (typeof v === "number") {
    if (!Number.isFinite(v))
      throw new CstEditError("INVALID_ARGUMENT", `not a finite number: ${v}`);
    return quoted === true ? quote(String(v)) : String(v);
  }
  if (quoted === false) {
    if (!bareSafe(v)) {
      throw new CstEditError(
        "INVALID_ARGUMENT",
        `bare value cannot be empty or hold a blank, quote, brace, colon or comment opener: ${v}`,
      );
    }
    return v;
  }
  return quote(v);
}

function formatValues(v: ScalarInput, quoted: (i: number) => boolean | undefined): string {
  const items = Array.isArray(v) ? (v as readonly ScalarItem[]) : [v as ScalarItem];
  if (items.length === 0) throw new CstEditError("INVALID_ARGUMENT", "empty value list");
  return items.map((x, i) => formatItem(x, quoted(i))).join(" ");
}

function formatGuid(g: string): string {
  const m = /^\{?([0-9A-Fa-f]{16})\}?$/.exec(g);
  if (!m) throw new CstEditError("INVALID_ARGUMENT", `not a 16-digit GUID: ${g}`);
  return `"{${m[1].toUpperCase()}}"`;
}

function formatEntry(e: EntrySpec, indent: string, unit: string, eol: string): string {
  if ("object" in e) return formatObject(e.object, indent, unit, eol);
  if ("key" in e) {
    if (!IDENT.test(e.key)) throw new CstEditError("INVALID_ARGUMENT", `not a key: ${e.key}`);
    return `${indent}${e.key} ${formatValues(e.value, () => e.quoted)}`;
  }
  return `${indent}${formatValues(e.value, () => e.quoted)}`;
}

function formatObject(o: ObjectSpec, indent: string, unit: string, eol: string): string {
  if (!/^\$?[A-Za-z_][A-Za-z0-9_]*$/.test(o.key)) {
    throw new CstEditError("INVALID_ARGUMENT", `not a header word: ${o.key}`);
  }
  const head = [o.key];
  if (o.className !== undefined) {
    if (!IDENT.test(o.className))
      throw new CstEditError("INVALID_ARGUMENT", `not a class: ${o.className}`);
    head.push(o.className);
  }
  if (o.name !== undefined) head.push(IDENT.test(o.name) ? o.name : quote(o.name));
  if (o.guid !== undefined) head.push(formatGuid(o.guid));
  if (o.base !== undefined) head.push(":", quote(o.base));
  const lines = [`${indent}${head.join(" ")} {`];
  for (const c of o.entries ?? []) lines.push(formatEntry(c, indent + unit, unit, eol));
  lines.push(`${indent}}`);
  return lines.join(eol);
}

// ── Paths ────────────────────────────────────────────────────────────────────

type Segment = { name?: string; index?: number };

/**
 * One segment: a name with optional indices, the grammar of
 * `src/manifest/vocabulary.ts` `parsePath` (`components[2].MeshObject.Object`).
 * Deliberate superset, for documents only this module walks: a name may carry
 * the legacy `$` (`$grp`), and the first segment may be indices alone
 * (`[1].Name`), which address the base block's entries by position.
 */
const SEGMENT = /^(\$?[A-Za-z_][A-Za-z0-9_]*)?((?:\[\d+\])*)$/;

export function parsePath(path: string): Segment[] {
  if (path === "") throw new CstEditError("INVALID_ARGUMENT", "empty property path");
  const out: Segment[] = [];
  path.split(".").forEach((part, k) => {
    const m = SEGMENT.exec(part);
    if (!m || part === "" || (m[1] === undefined && k > 0)) {
      throw new CstEditError("INVALID_ARGUMENT", `bad path segment '${part}' in ${path}`);
    }
    if (m[1] !== undefined) out.push({ name: m[1] });
    for (const x of m[2].matchAll(/\[(\d+)\]/g)) {
      const i = Number(x[1]);
      if (!Number.isSafeInteger(i)) {
        throw new CstEditError("INVALID_ARGUMENT", `index out of range in ${path}`);
      }
      out.push({ index: i });
    }
  });
  return out;
}

function siblings(block: CstRoot | CstObject): string {
  const keys = block.children.map((c, i) => keyOf(c) ?? `[${i}]`);
  if (keys.length === 0) return "no entries";
  return `entries: ${keys.slice(0, 20).join(", ")}${keys.length > 20 ? ", ..." : ""}`;
}

function keyOf(e: CstEntry): string | undefined {
  return e.kind === "object" || e.kind === "scalar" ? e.key : undefined;
}

// ── Document ─────────────────────────────────────────────────────────────────

export type CstEncoding = "utf8" | "utf16le" | "latin1";

/** What an edit replaced: `[start, end)` of the old text became `inserted`. */
export interface CstEdit {
  start: number;
  end: number;
  inserted: string;
}

export class CstDocument {
  text!: string;
  tokens!: Token[];
  root!: CstRoot;
  diagnostics!: Diagnostic[];

  constructor(
    text: string,
    /** Encoding `toBytes()` writes back (`parseCstBytes` detects it). */
    readonly encoding: CstEncoding = "utf8",
  ) {
    this.load(text);
  }

  private load(text: string): void {
    this.text = text;
    this.diagnostics = [];
    this.tokens = tokenize(text, this.diagnostics);
    this.root = build(text, this.tokens, this.diagnostics);
  }

  serialize(): string {
    let s = "";
    for (const t of this.tokens) s += t.text;
    return s;
  }

  toBytes(): Buffer {
    return Buffer.from(this.serialize(), this.encoding);
  }

  /**
   * The block paths start from: the single top-level object when the
   * document has exactly one (an `.et` or `.conf` root), else the document.
   */
  get base(): CstRoot | CstObject {
    const objs = this.root.children.filter((c) => c.kind !== "opaque");
    return objs.length === 1 && objs[0].kind === "object" ? objs[0] : this.root;
  }

  /** The entry a path names; throws PATH_NOT_FOUND. `""` is not a path. */
  resolve(path: string): CstEntry {
    const segs = parsePath(path);
    let cur: CstRoot | CstEntry = this.base;
    for (const s of segs) {
      if (cur.kind !== "root" && cur.kind !== "object") {
        throw new CstEditError(
          "PATH_NOT_FOUND",
          `${path}: '${keyOf(cur) ?? "value"}' has no children`,
        );
      }
      const block: CstRoot | CstObject = cur;
      let next: CstEntry | undefined;
      if (s.name !== undefined) next = block.children.find((c) => keyOf(c) === s.name);
      else next = block.children[s.index as number];
      if (!next) {
        throw new CstEditError(
          "PATH_NOT_FOUND",
          `${path}: no ${s.name !== undefined ? `'${s.name}'` : `[${s.index}]`} (${siblings(block)})`,
        );
      }
      cur = next;
    }
    return cur as CstEntry;
  }

  private resolveBlock(path: string): CstRoot | CstObject {
    if (path === "") return this.base;
    const e = this.resolve(path);
    if (e.kind !== "object") throw new CstEditError("UNSUPPORTED", `${path} is not a block`);
    return e;
  }

  get(path: string): CstGet {
    const e = this.resolve(path);
    const raw = this.text.slice(e.start, e.end);
    switch (e.kind) {
      case "scalar":
      case "value": {
        const vs = e.values;
        return {
          ...(e.kind === "scalar"
            ? { kind: "scalar" as const, key: e.key }
            : { kind: "value" as const }),
          values: vs.map(tokenValue),
          raw: vs.length ? this.text.slice(vs[0].start, vs[vs.length - 1].end) : "",
          quoted: vs.map((t) => t.kind === "string"),
        } as CstGet;
      }
      case "object":
        return {
          kind: "object",
          key: e.key,
          head: e.head.map(tokenValue),
          base: e.base.length ? tokenValue(e.base[0]) : undefined,
          legacy: e.legacy,
          count: e.children.length,
        };
      default:
        return { kind: "opaque", raw, reason: e.reason };
    }
  }

  /**
   * Sets a scalar. An existing one keeps its key and the quoting of each
   * value it had (`quoted` overrides); a missing last segment that is a name
   * is appended to its block as a fresh `Key value` line.
   */
  set(path: string, value: ScalarInput, opts: { quoted?: boolean } = {}): CstEdit {
    let e: CstEntry | undefined;
    try {
      e = this.resolve(path);
    } catch (err) {
      if (!(err instanceof CstEditError) || err.code !== "PATH_NOT_FOUND") throw err;
    }
    if (e) {
      if (e.kind !== "scalar" && e.kind !== "value") {
        throw new CstEditError("UNSUPPORTED", `${path} is a ${e.kind}, not a scalar`);
      }
      let vs = e.values;
      const segs = parsePath(path);
      if (e.kind === "scalar" && segs[segs.length - 1].index !== undefined) {
        // Reached by index: an array item. A lone bare word (`ENUM_A`) parses
        // as a key without values; the item is the word itself.
        if (vs.length > 0 && vs.every((t) => t.kind === "word")) {
          throw new CstEditError(
            "UNSUPPORTED",
            `${path}: '${this.text.slice(e.start, e.end)}' is a keyed scalar or a bare word list; set it by key`,
          );
        }
        if (vs.length === 0) vs = [e.keyToken];
      }
      // Each slot keeps the quoting it had (`quoted` overrides); extra values
      // follow the last slot. An inherited bare slot quotes a value that
      // cannot stand bare instead of refusing it.
      const items = Array.isArray(value) ? (value as readonly ScalarItem[]) : [value as ScalarItem];
      const txt = formatValues(value, (i) => {
        if (opts.quoted !== undefined) return opts.quoted;
        if (vs.length === 0) return undefined;
        const q = vs[Math.min(i, vs.length - 1)].kind === "string";
        const v = items[i];
        return !q && typeof v === "string" && !bareSafe(v) ? true : q;
      });
      if (vs.length === 0) return this.splice(e.end, e.end, ` ${txt}`);
      return this.splice(vs[0].start, vs[vs.length - 1].end, txt);
    }
    const segs = parsePath(path);
    const last = segs[segs.length - 1];
    if (last.name === undefined) throw new CstEditError("PATH_NOT_FOUND", `${path}: no such index`);
    const parentPath = pathOf(segs.slice(0, -1));
    return this.insert(this.resolveBlock(parentPath), undefined, {
      key: last.name,
      value,
      quoted: opts.quoted,
    });
  }

  /** Adds an entry to the block at `path` (`""` = the base), at `index` or at the end. */
  arrayAdd(path: string, item: EntrySpec | ScalarInput, index?: number): CstEdit {
    const spec: EntrySpec =
      typeof item === "object" && item !== null && !Array.isArray(item)
        ? (item as EntrySpec)
        : { value: item as ScalarInput };
    return this.insert(this.resolveBlock(path), index, spec);
  }

  /** Creates an object in the block at `path`, at `index` or at the end. */
  createObject(path: string, spec: ObjectSpec, index?: number): CstEdit {
    return this.insert(this.resolveBlock(path), index, { object: spec });
  }

  arrayRemove(path: string, index: number): CstEdit {
    const block = this.resolveBlock(path);
    const e = block.children[index];
    if (!e) throw new CstEditError("PATH_NOT_FOUND", `${path}[${index}]: no such entry`);
    const [s, en] = this.entrySpan(e);
    return this.splice(s, en, "");
  }

  /** Deletes the entry a path names, with its whole line(s) when it stands alone. */
  delete(path: string): CstEdit {
    const e = this.resolve(path);
    const [s, en] = this.entrySpan(e);
    return this.splice(s, en, "");
  }

  /** Moves entry `from` of a block to position `to` (positions after the move). */
  arrayMove(path: string, from: number, to: number): CstEdit {
    const block = this.resolveBlock(path);
    const n = block.children.length;
    const e = block.children[from];
    if (!e || to < 0 || to >= n) {
      throw new CstEditError(
        "PATH_NOT_FOUND",
        `${path}: move ${from} to ${to} out of range (${n})`,
      );
    }
    if (from === to) return { start: e.start, end: e.start, inserted: "" };
    const [s, en] = this.entrySpan(e);
    if (!this.wholeLine(s, en)) throw new CstEditError("UNSUPPORTED", "entry shares its line");
    const chunk = this.text.slice(s, en);
    const old = this.text;
    const blockStart = block.kind === "object" ? block.start : 0;
    const before = this.text.slice(0, s) + this.text.slice(en);
    this.load(before);
    // Find the same block again by its start offset (unchanged: it precedes the cut).
    const again = block.kind === "root" ? this.root : findObjectAt(this.root, blockStart);
    if (!again) throw new CstEditError("UNSUPPORTED", "block lost after cut");
    let at: number;
    if (to < again.children.length) {
      at = lineStart(this.text, again.children[to].start);
    } else {
      const last = again.children[again.children.length - 1];
      const [, le] = this.entrySpan(last);
      at = le;
    }
    let ins = chunk;
    if (at > 0 && !/[\r\n]$/.test(this.text.slice(0, at))) {
      // The block's last line had no line ending (end of text): move the ending.
      ins = this.eolNear(again) + chunk.replace(/(\r\n|\n|\r)$/, "");
    }
    this.load(this.text.slice(0, at) + ins + this.text.slice(at));
    // The replaced range in old-text coordinates (`at` is after the cut).
    const atOld = at <= s ? at : at + (en - s);
    const start = Math.min(s, atOld);
    const end = Math.max(en, atOld);
    return { start, end, inserted: this.text.slice(start, this.text.length - (old.length - end)) };
  }

  // ── internals ──

  private splice(start: number, end: number, inserted: string): CstEdit {
    if (this.encoding === "latin1" && /[^\x00-\xff]/.test(inserted)) {
      throw new CstEditError("INVALID_ARGUMENT", "text outside latin-1 in a latin-1 document");
    }
    this.load(this.text.slice(0, start) + inserted + this.text.slice(end));
    return { start, end, inserted };
  }

  private eolNear(block: CstRoot | CstObject): string {
    if (block.kind === "object") {
      const t = this.tokens.find(
        (x) => x.start >= block.open.end && x.kind !== "ws" && x.kind !== "comment",
      );
      if (t && t.kind === "eol") return t.text;
    }
    return this.tokens.find((x) => x.kind === "eol")?.text ?? "\n";
  }

  private indentOf(offset: number): string | undefined {
    const ls = lineStart(this.text, offset);
    const pre = this.text.slice(ls, offset);
    return /^[ \t]*$/.test(pre) ? pre : undefined;
  }

  private childIndent(block: CstRoot | CstObject): { indent: string; unit: string } {
    if (block.kind === "root") {
      return { indent: "", unit: " " };
    }
    const hi = this.indentOf(block.start) ?? "";
    const unit = hi.includes("\t") ? "\t" : " ";
    const sib = block.children.length
      ? this.indentOf(block.children[block.children.length - 1].start)
      : undefined;
    return { indent: sib ?? hi + unit, unit };
  }

  private insert(block: CstRoot | CstObject, index: number | undefined, spec: EntrySpec): CstEdit {
    const eol = this.eolNear(block);
    const { indent, unit } = this.childIndent(block);
    const n = block.children.length;
    if (index !== undefined && (index < 0 || index > n || !Number.isInteger(index))) {
      throw new CstEditError("PATH_NOT_FOUND", `index ${index} out of range (${n})`);
    }
    const body = formatEntry(spec, indent, unit, eol);
    if (index !== undefined && index < n) {
      const at = block.children[index].start;
      const ls = lineStart(this.text, at);
      if (this.indentOf(at) !== undefined) return this.splice(ls, ls, body + eol);
      return this.splice(at, at, body.trimStart() + eol + indent);
    }
    if (block.kind === "root") {
      const t = this.text;
      const sep = t.length === 0 || /[\r\n]$/.test(t) ? "" : eol;
      return this.splice(t.length, t.length, sep + body);
    }
    if (!block.close) throw new CstEditError("UNSUPPORTED", `block '${block.key}' is not closed`);
    const c = block.close.start;
    if (this.indentOf(c) !== undefined) {
      const ls = lineStart(this.text, c);
      return this.splice(ls, ls, body + eol);
    }
    const hi = this.indentOf(block.start) ?? "";
    return this.splice(c, c, eol + body + eol + hi);
  }

  private wholeLine(s: number, e: number): boolean {
    return (
      (s === 0 || /[\r\n]/.test(this.text[s - 1])) &&
      (e === this.text.length || /[\r\n]$/.test(this.text.slice(s, e)))
    );
  }

  /**
   * The span an entry's removal takes: its whole line(s), from the line start
   * through the line ending, when nothing else shares them (a trailing comment
   * goes with it); else the entry and the blanks after it.
   */
  private entrySpan(e: CstEntry): [number, number] {
    const t = this.text;
    let s = e.start;
    let en = e.end;
    const ls = lineStart(t, s);
    const alone = /^[ \t\uFEFF]*$/.test(t.slice(ls, s));
    let j = en;
    while (j < t.length && (t[j] === " " || t[j] === "\t")) j++;
    if (t.startsWith("//", j)) while (j < t.length && t[j] !== "\n" && t[j] !== "\r") j++;
    const atEol = j === t.length || t[j] === "\n" || t[j] === "\r";
    if (alone && atEol) {
      s = ls;
      en = j;
      if (t[en] === "\r") en += t[en + 1] === "\n" ? 2 : 1;
      else if (t[en] === "\n") en++;
      else if (s > 0) {
        // Last line without a line ending: take the ending before it instead.
        let k = s;
        if (t[k - 1] === "\n") k--;
        if (k > 0 && t[k - 1] === "\r") k--;
        s = k;
      }
      return [s, en];
    }
    while (en < t.length && (t[en] === " " || t[en] === "\t")) en++;
    return [s, en];
  }
}

function lineStart(text: string, offset: number): number {
  let i = offset;
  while (i > 0 && text[i - 1] !== "\n" && text[i - 1] !== "\r") i--;
  return i;
}

function findObjectAt(block: CstRoot | CstObject, start: number): CstObject | undefined {
  for (const c of block.children) {
    if (c.kind !== "object") continue;
    if (c.start === start) return c;
    if (c.start < start && c.end >= start) {
      const f = findObjectAt(c, start);
      if (f) return f;
    }
  }
  return undefined;
}

function pathOf(segs: Segment[]): string {
  let s = "";
  for (const g of segs) {
    if (g.name !== undefined) s += (s ? "." : "") + g.name;
    else s += `[${g.index}]`;
  }
  return s;
}

// ── Entry points ─────────────────────────────────────────────────────────────

/** Parses text; never throws. */
export function parseCst(text: string): CstDocument {
  return new CstDocument(text, "utf8");
}

/**
 * Parses file bytes; never throws. UTF-16LE with a byte-order mark and bytes
 * that are not valid UTF-8 (read as latin-1) are decoded so that `toBytes()`
 * gives the same bytes back.
 */
export function parseCstBytes(buf: Uint8Array): CstDocument {
  const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe && b.length % 2 === 0) {
    return new CstDocument(b.toString("utf16le"), "utf16le");
  }
  const u = b.toString("utf8");
  if (Buffer.from(u, "utf8").equals(b)) return new CstDocument(u, "utf8");
  return new CstDocument(b.toString("latin1"), "latin1");
}

/** `parseCst(text).serialize()`: equals `text` for every input. */
export function roundTrip(text: string): string {
  return parseCst(text).serialize();
}
