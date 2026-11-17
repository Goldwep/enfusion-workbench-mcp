/**
 * Tolerant reader for Enfusion text documents (E10, the data-schema census).
 *
 * Every text format that Workbench's editors author (.bt, .agf, .acp, .ptc,
 * .conf, .layout, .et, ...) is the same serialisation:
 *
 *   ClassName [name] [: "{GUID}parent"] {
 *    key value ...                     scalar values on the key's line
 *    key {  ...  }                     an array: values, blocks or arrays
 *    key ClassName [name] { ... }      an inline object
 *    { ... }                           an unkeyed child list (layouts)
 *   }
 *
 * This reader needs only block class names, key names and value shapes, so it
 * does not build values and never depends on `src/formats/enfusion-text.ts`
 * (which throws on some vanilla files). It reads quoted strings with escapes
 * and `"..."\` line continuations, `//` and block comments outside strings,
 * `$`-prefixed class names, and reports the first structural error with its
 * line instead of throwing. A backslash outside a string that is not a line
 * continuation is such an error: it is a `\"` escape left outside a string
 * that an unescaped quote closed early.
 *
 * `SchemaCollector` folds many documents into per-class and per-key
 * statistics; the E10 generator turns those into observation rows.
 */

// ── Tokens ────────────────────────────────────────────────────────────────────

export type TokenType = "open" | "close" | "colon" | "str" | "word";

export interface Token {
  t: TokenType;
  /** Raw text (strings without their quotes; continuation pieces joined). */
  v: string;
  line: number;
  /** Last line the token touches (a continued string spans several). */
  endLine: number;
}

export class SchemaReadError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(`L${line}: ${message}`);
  }
}

const isSpace = (c: string): boolean => c === " " || c === "\t" || c === "\r" || c === "\f";

/**
 * Tokenizes one document. Throws `SchemaReadError` on an unterminated string
 * or comment, or on a backslash outside a string that is not a continuation.
 */
export function tokenize(text: string): Token[] {
  const r = scan(text);
  if (r.error) throw r.error;
  return r.tokens;
}

/**
 * Tokens of a document, and the first error: an unterminated string or
 * comment stops the scan; a stray backslash is recorded and the scan goes on,
 * so the parser can report an earlier structural error first.
 */
function scan(text: string): { tokens: Token[]; error?: SchemaReadError } {
  let bad: SchemaReadError | undefined;
  try {
    const tokens = scanTokens(text, (e) => {
      bad ??= e;
    });
    return { tokens, error: bad };
  } catch (e) {
    if (!(e instanceof SchemaReadError)) throw e;
    return { tokens: [], error: bad && bad.line <= e.line ? bad : e };
  }
}

function scanTokens(text: string, stray: (e: SchemaReadError) => void): Token[] {
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const out: Token[] = [];
  let i = 0;
  let line = 1;
  const n = s.length;

  const readString = (): string => {
    // s[i] === '"'
    const start = line;
    i++;
    let v = "";
    while (i < n) {
      const c = s[i];
      // Only `\"` is an escape: other backslashes are literal (`\\"` in a
      // vanilla layout is a backslash followed by an escaped quote).
      if (c === "\\" && s[i + 1] === '"') {
        v += c + s[i + 1];
        i += 2;
        continue;
      }
      if (c === '"') {
        i++;
        return v;
      }
      if (c === "\n") line++;
      v += c;
      i++;
    }
    throw new SchemaReadError("unterminated string", start);
  };

  while (i < n) {
    const c = s[i];
    if (c === "\n") {
      line++;
      i++;
      continue;
    }
    if (isSpace(c)) {
      i++;
      continue;
    }
    if (c === "/" && s[i + 1] === "/") {
      while (i < n && s[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && s[i + 1] === "*") {
      const start = line;
      i += 2;
      while (i < n && !(s[i] === "*" && s[i + 1] === "/")) {
        if (s[i] === "\n") line++;
        i++;
      }
      if (i >= n) throw new SchemaReadError("unterminated block comment", start);
      i += 2;
      continue;
    }
    if (c === "{") {
      out.push({ t: "open", v: c, line, endLine: line });
      i++;
      continue;
    }
    if (c === "}") {
      out.push({ t: "close", v: c, line, endLine: line });
      i++;
      continue;
    }
    if (c === "\\") {
      // A stray continuation outside a string (the backslash ends its line):
      // skip it. Any other backslash outside a string is a quote escaped
      // outside its string (see the word case below).
      let j = i + 1;
      while (j < n && isSpace(s[j])) j++;
      if (j < n && s[j] !== "\n") stray(new SchemaReadError("backslash outside a string", line));
      i++;
      continue;
    }
    if (c === '"') {
      const startLine = line;
      let v = readString();
      // `"..."\` + newline + `"..."`: one string continued over lines.
      for (;;) {
        let j = i;
        while (j < n && isSpace(s[j])) j++;
        if (s[j] !== "\\") break;
        j++;
        while (j < n && isSpace(s[j])) j++;
        if (s[j] !== "\n") break;
        j++;
        let lines = 1;
        while (j < n && (isSpace(s[j]) || s[j] === "\n")) {
          if (s[j] === "\n") lines++;
          j++;
        }
        if (s[j] !== '"') {
          // Continuation with no string after it: drop the backslash.
          i = j;
          line += lines;
          break;
        }
        i = j;
        line += lines;
        v += readString();
      }
      out.push({ t: "str", v, line: startLine, endLine: line });
      continue;
    }
    let j = i;
    while (j < n) {
      const d = s[j];
      if (d === "\n" || isSpace(d) || d === "{" || d === "}" || d === '"') break;
      if (d === "/" && (s[j + 1] === "/" || s[j + 1] === "*") && j > i) break;
      j++;
    }
    const w = s.slice(i, j);
    // A backslash inside a bare word means a string was closed early by an
    // unescaped quote and its `\"` escapes now sit outside it (vanilla rich
    // text: `"<image set=\"{GUID}path" name=\"x\"/>"` pairs its quotes on the
    // line but reads as string + word `name=\` + string). Reading on would
    // invent a bare-word value, so the document is reported unreadable.
    if (w.includes("\\")) stray(new SchemaReadError(`backslash outside a string ('${w}')`, line));
    out.push({ t: w === ":" ? "colon" : "word", v: w, line, endLine: line });
    i = j;
  }
  return out;
}

// ── Value shapes ──────────────────────────────────────────────────────────────

const NUMBER_RE = /^([-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?|0[xX][0-9A-Fa-f]+)$/;
const RESOURCE_RE = /^\{[0-9A-Fa-f]{16}\}./;

export type ScalarKind = "number" | "quoted string" | "resource ref" | "bare word";

export function scalarKind(tok: Token): ScalarKind {
  if (tok.t === "str") return RESOURCE_RE.test(tok.v) ? "resource ref" : "quoted string";
  return NUMBER_RE.test(tok.v) ? "number" : "bare word";
}

const PLURAL: Record<ScalarKind, string> = {
  number: "numbers",
  "quoted string": "quoted strings",
  "resource ref": "resource refs",
  "bare word": "bare words",
};

/** Shape of the scalar values on one key line. */
export function lineShape(values: readonly Token[]): string {
  if (values.length === 0) return "no value";
  const kinds = values.map(scalarKind);
  const first = kinds[0];
  if (kinds.every((k) => k === first)) {
    return values.length === 1 ? first : `${PLURAL[first]}[${values.length}]`;
  }
  // Runs of one kind, in order: `resource ref + bare words[2]`.
  const runs: string[] = [];
  let j = 0;
  while (j < kinds.length) {
    let k = j;
    while (k < kinds.length && kinds[k] === kinds[j]) k++;
    runs.push(k - j === 1 ? kinds[j] : `${PLURAL[kinds[j]]}[${k - j}]`);
    j = k;
  }
  return runs.join(" + ");
}

// ── Document tree ─────────────────────────────────────────────────────────────

export interface BlockNode {
  cls: string;
  name?: string;
  /** Raw parent reference text (`"{GUID}path"`). */
  parentRef?: string;
  line: number;
  members: MemberNode[];
  /** Unkeyed child lists (`{ ... }` directly in an object body). */
  lists: ArrayNode[];
}

export interface MemberNode {
  key: string;
  /** The key was written as a quoted string. */
  quoted?: boolean;
  /** `key + { ... }`: the array is appended to the inherited one. */
  append?: boolean;
  line: number;
  value:
    | { kind: "scalar"; tokens: Token[] }
    | { kind: "block"; block: BlockNode }
    | { kind: "array"; array: ArrayNode };
}

export interface ArrayNode {
  line: number;
  items: (
    | { kind: "scalar"; token: Token }
    | { kind: "block"; block: BlockNode }
    | { kind: "array"; array: ArrayNode }
  )[];
}

/** Shape of an array value. */
export function arrayShape(a: ArrayNode): string {
  if (a.items.length === 0) return "empty array";
  const kinds = new Set<string>();
  for (const it of a.items) {
    if (it.kind === "block") kinds.add("blocks");
    else if (it.kind === "array") kinds.add("arrays");
    else kinds.add(PLURAL[scalarKind(it.token)]);
  }
  if (kinds.size === 1) return `array of ${[...kinds][0]}`;
  return "mixed array";
}

/** Shape of a member's value. */
export function memberShape(m: MemberNode): string {
  if (m.value.kind === "scalar") return lineShape(m.value.tokens);
  if (m.value.kind === "block") return "block";
  return arrayShape(m.value.array);
}

/**
 * Parses one document into its root blocks. Throws `SchemaReadError` at the
 * first structural error (unbalanced braces, a header that is not
 * `Class [name] [: parent] {`, a value outside any key).
 */
export function parseDocument(text: string): BlockNode[] {
  const scanned = scan(text);
  // A stray backslash makes the document unreadable; the error reported is
  // the earliest one, the parser's when it comes first.
  if (scanned.error && scanned.tokens.length === 0) throw scanned.error;
  const stray = scanned.error;
  try {
    const roots = parseTokens(scanned.tokens);
    if (stray) throw stray;
    return roots;
  } catch (e) {
    if (stray && e instanceof SchemaReadError && stray.line < e.line) throw stray;
    throw e;
  }
}

function parseTokens(toks: Token[]): BlockNode[] {
  let i = 0;
  const n = toks.length;

  /** Tokens from `i` that share a line with the previous one, up to (not incl.) `{`, `}` or a new line. */
  const sameLine = (from: number, line: number): number => {
    let j = from;
    let last = line;
    while (j < n) {
      const t = toks[j];
      if (t.t === "open" || t.t === "close") break;
      if (t.line !== last) break;
      last = t.endLine;
      j++;
    }
    return j;
  };

  /** Reads a block header `Class [name] [: parent]` from toks[a..b) followed by `{` at b. */
  const header = (a: number, b: number): BlockNode => {
    const h = toks.slice(a, b);
    const cls = h[0];
    if (!cls || cls.t !== "word")
      throw new SchemaReadError(`block header must start with a class name`, toks[a]?.line ?? 0);
    const node: BlockNode = { cls: cls.v, line: cls.line, members: [], lists: [] };
    let k = 1;
    if (k < h.length && (h[k].t === "word" || h[k].t === "str")) {
      node.name = h[k].v;
      k++;
    }
    if (k < h.length && h[k].t === "colon") {
      if (k + 1 >= h.length || h[k + 1].t !== "str")
        throw new SchemaReadError(
          `':' in a block header must be followed by a quoted parent`,
          h[k].line,
        );
      node.parentRef = h[k + 1].v;
      k += 2;
    }
    if (k !== h.length)
      throw new SchemaReadError(
        `unexpected ${h[k].t === "str" ? "string" : `'${h[k].v}'`} in block header of ${cls.v}`,
        h[k].line,
      );
    return node;
  };

  /**
   * Body of a block after its `{`. Legacy `$`-prefixed nodes hold
   * positional values (`$Node AnimNodeSource { "a" "b" }`), read as an
   * unkeyed list; `$grp Class [: parent] { { ... } { ... } }` groups unkeyed
   * instances of `Class` (entity groups in prefabs).
   */
  const blockBody = (node: BlockNode): void => {
    if (node.cls === "$grp") {
      const list: ArrayNode = { line: node.line, items: [] };
      for (;;) {
        // An instance is `{ ... }` or `<entity name> { ... }`.
        let instName: string | undefined;
        const at = toks[i]?.line ?? node.line;
        if (
          i + 1 < n &&
          (toks[i].t === "word" || toks[i].t === "str") &&
          toks[i + 1].t === "open" &&
          toks[i + 1].line === toks[i].endLine
        ) {
          instName = toks[i].v;
          i++;
        }
        if (i >= n || toks[i].t !== "open") break;
        const inst: BlockNode = {
          cls: node.name ?? "$grp",
          name: instName,
          parentRef: node.parentRef,
          line: at,
          members: [],
          lists: [],
        };
        i++;
        objectBody(inst);
        list.items.push({ kind: "block", block: inst });
      }
      if (i >= n || toks[i].t !== "close")
        throw new SchemaReadError(
          "$grp holds something other than unkeyed instances",
          toks[i]?.line ?? node.line,
        );
      i++;
      node.lists.push(list);
      return;
    }
    if (node.cls.startsWith("$")) {
      node.lists.push(arrayBody(node.line));
      return;
    }
    objectBody(node);
  };

  const objectBody = (node: BlockNode): void => {
    while (i < n) {
      const t = toks[i];
      if (t.t === "close") {
        i++;
        return;
      }
      if (t.t === "open") {
        i++;
        node.lists.push(arrayBody(t.line));
        continue;
      }
      // A key is a bare word, or a quoted string when it is a reserved word
      // or holds spaces (`"static" 1`, `"Loop count" 255` in audio
      // components); a quoted key must have something after it on its line.
      const quotedKey =
        t.t === "str" && i + 1 < n && toks[i + 1].line === t.endLine && toks[i + 1].t !== "close";
      if (t.t !== "word" && !quotedKey) {
        throw new SchemaReadError(
          `value outside a key in ${node.cls} (${t.t === "str" ? "a string" : `'${t.v}'`})`,
          t.line,
        );
      }
      const end = sameLine(i + 1, t.endLine);
      const lastLine = end > i + 1 ? toks[end - 1].endLine : t.endLine;
      if (end < n && toks[end].t === "open" && toks[end].line === lastLine) {
        // `key {` is an array; `key + {` (or `key +{`) appends to the inherited array.
        const append = end === i + 2 && toks[i + 1].t === "word" && toks[i + 1].v === "+";
        if (end === i + 1 || append) {
          const at = toks[end].line;
          i = end + 1;
          node.members.push({
            key: t.v,
            quoted: quotedKey || undefined,
            append: append || undefined,
            line: t.line,
            value: { kind: "array", array: arrayBody(at) },
          });
        } else {
          const child = header(i + 1, end);
          i = end + 1;
          blockBody(child);
          node.members.push({
            key: t.v,
            quoted: quotedKey || undefined,
            line: t.line,
            value: { kind: "block", block: child },
          });
        }
        continue;
      }
      node.members.push({
        key: t.v,
        quoted: quotedKey || undefined,
        line: t.line,
        value: { kind: "scalar", tokens: toks.slice(i + 1, end) },
      });
      i = end;
    }
    throw new SchemaReadError(`unexpected end of file inside ${node.cls}`, node.line);
  };

  const arrayBody = (line: number): ArrayNode => {
    const arr: ArrayNode = { line, items: [] };
    while (i < n) {
      const t = toks[i];
      if (t.t === "close") {
        i++;
        return arr;
      }
      if (t.t === "open") {
        i++;
        arr.items.push({ kind: "array", array: arrayBody(t.line) });
        continue;
      }
      if (t.t === "word") {
        const end = sameLine(i + 1, t.endLine);
        const lastLine = end > i + 1 ? toks[end - 1].endLine : t.endLine;
        if (end < n && toks[end].t === "open" && toks[end].line === lastLine) {
          const child = header(i, end);
          i = end + 1;
          blockBody(child);
          arr.items.push({ kind: "block", block: child });
          continue;
        }
      }
      if (t.t === "colon") throw new SchemaReadError(`stray ':' in an array`, t.line);
      arr.items.push({ kind: "scalar", token: t });
      i++;
    }
    throw new SchemaReadError(`unexpected end of file inside an array`, line);
  };

  const roots: BlockNode[] = [];
  while (i < n) {
    const t = toks[i];
    if (t.t !== "word") {
      throw new SchemaReadError(
        `top level must hold blocks (found ${t.t === "str" ? "a string" : `'${t.v}'`})`,
        t.line,
      );
    }
    const end = sameLine(i + 1, t.endLine);
    if (end >= n || toks[end].t !== "open") {
      throw new SchemaReadError(`top-level '${t.v}' is not followed by a block`, t.line);
    }
    const node = header(i, end);
    i = end + 1;
    blockBody(node);
    roots.push(node);
  }
  return roots;
}

// ── Collection ────────────────────────────────────────────────────────────────

export interface Occurrence {
  path: string;
  line: number;
  /** The source line, trimmed. */
  text: string;
}

export interface KeyStat {
  key: string;
  instances: number;
  files: number;
  /** Extensions the key was seen in. */
  exts: Set<string>;
  shapes: Map<string, number>;
  /** Bare-word values with counts; null once more than `LITERAL_CAP` distinct values were seen. */
  words: Map<string, number> | null;
  /** The key was written quoted at least once. */
  quoted: boolean;
  first: Occurrence;
}

export interface ClassStat {
  cls: string;
  instances: number;
  root: number;
  nested: number;
  /** Files per extension. */
  filesByExt: Map<string, number>;
  /** Instances per extension. */
  instancesByExt: Map<string, number>;
  /** First occurrence per extension (processing order). */
  firstByExt: Map<string, Occurrence>;
  /**
   * `<ext>:<container>` contexts: `root`, the key of the array or member that
   * holds the block, or `{}` for an unkeyed child list.
   */
  contexts: Set<string>;
  keys: Map<string, KeyStat>;
  /** Instances whose body is a positional list (legacy `$` nodes, `$grp`). */
  positional: number;
}

/** At most this many distinct bare-word values make a literal set. */
export const LITERAL_CAP = 40;

export interface CollectOptions {
  /** Extensions whose keys are not collected (classes only). */
  classesOnly?: ReadonlySet<string>;
}

export class SchemaCollector {
  readonly classes = new Map<string, ClassStat>();
  private readonly classesOnly: ReadonlySet<string>;

  constructor(options: CollectOptions = {}) {
    this.classesOnly = options.classesOnly ?? new Set();
  }

  /** Folds one parsed document; `text` is the document (for the cited lines). */
  add(ext: string, path: string, roots: readonly BlockNode[], text: string): void {
    const filesSeen = new Set<ClassStat>();
    const keysSeen = new Set<KeyStat>();
    const withKeys = !this.classesOnly.has(ext);
    let lines: string[] | undefined;
    const at = (line: number): Occurrence => {
      lines ??= (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).split("\n");
      return { path, line, text: (lines[line - 1] ?? "").trim() };
    };

    const cls = (name: string): ClassStat => {
      let c = this.classes.get(name);
      if (!c) {
        c = {
          cls: name,
          instances: 0,
          root: 0,
          nested: 0,
          filesByExt: new Map(),
          instancesByExt: new Map(),
          firstByExt: new Map(),
          contexts: new Set(),
          keys: new Map(),
          positional: 0,
        };
        this.classes.set(name, c);
      }
      return c;
    };

    const visitArray = (a: ArrayNode, container: string): void => {
      for (const it of a.items) {
        if (it.kind === "block") visitBlock(it.block, container);
        else if (it.kind === "array") visitArray(it.array, container);
      }
    };

    const visitBlock = (b: BlockNode, container: string | null): void => {
      const c = cls(b.cls);
      c.instances++;
      if (container === null) c.root++;
      else c.nested++;
      if (b.cls.startsWith("$")) c.positional++;
      c.instancesByExt.set(ext, (c.instancesByExt.get(ext) ?? 0) + 1);
      if (!c.firstByExt.has(ext)) c.firstByExt.set(ext, at(b.line));
      c.contexts.add(`${ext}:${container ?? "root"}`);
      if (!filesSeen.has(c)) {
        filesSeen.add(c);
        c.filesByExt.set(ext, (c.filesByExt.get(ext) ?? 0) + 1);
      }
      for (const m of b.members) {
        if (withKeys) {
          let k = c.keys.get(m.key);
          if (!k) {
            k = {
              key: m.key,
              instances: 0,
              files: 0,
              exts: new Set(),
              shapes: new Map(),
              words: new Map(),
              quoted: false,
              first: at(m.line),
            };
            c.keys.set(m.key, k);
          }
          k.instances++;
          k.exts.add(ext);
          if (m.quoted) k.quoted = true;
          if (!keysSeen.has(k)) {
            keysSeen.add(k);
            k.files++;
          }
          const shape = memberShape(m);
          k.shapes.set(shape, (k.shapes.get(shape) ?? 0) + 1);
          if (m.value.kind === "scalar" && k.words) {
            for (const tok of m.value.tokens) {
              if (scalarKind(tok) !== "bare word") continue;
              k.words.set(tok.v, (k.words.get(tok.v) ?? 0) + 1);
              if (k.words.size > LITERAL_CAP) {
                k.words = null;
                break;
              }
            }
          }
        }
        if (m.value.kind === "block") visitBlock(m.value.block, m.key);
        else if (m.value.kind === "array") visitArray(m.value.array, m.key);
      }
      for (const l of b.lists) visitArray(l, "{}");
    };

    for (const r of roots) visitBlock(r, null);
  }
}

/**
 * The literal set of a key: its bare-word values when there are at most
 * `LITERAL_CAP` distinct ones, each seen at least twice; otherwise undefined.
 */
export function literalSet(k: KeyStat): string[] | undefined {
  if (!k.words || k.words.size === 0) return undefined;
  for (const n of k.words.values()) if (n < 2) return undefined;
  return [...k.words.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
