/**
 * Enforce Script declaration parser for the E02 script-source index
 * (DEC-018). Stricter than `src/script-parser/` (which the script_* tools
 * keep using unchanged): it keeps exact signatures, parameter lists with
 * modifiers and default values, the arity, the `#ifdef` guards around every
 * declaration, explicit enum values and doc comments, and it reports every
 * construct it cannot read instead of silently skipping it.
 *
 * Scope: declarations only. Method bodies and initialisers are skipped by
 * balanced brackets over a real token stream (strings and comments are
 * tokens, so a brace or a comment marker inside a string never counts).
 * Both branches of an `#ifdef ... #else ... #endif` are parsed; each
 * declaration records the guard stack it sits under.
 *
 * Grammar read (declaration level):
 *
 *   item       := attribute* modifier* ( class | enum | typedef | member )
 *   attribute  := '[' entry (',' entry)* ']'      entry := Name ( '(' raw ')' )?
 *   class      := ['modded'] 'class' Name generics? ((':' | 'extends') type)? ( '{' item* '}' ';'? | ';' )
 *   enum       := ['modded'] 'enum' Name (':' type)? '{' (Name ('=' raw)? ','?)* '}' ';'?
 *   typedef    := 'typedef' type Name ';'
 *   member     := type ( '~'? Name '(' params ')' trailer* (';' | body)
 *                      | Name array? ('=' raw)? (',' Name array? ('=' raw)?)* ';' )
 *   params     := ( param (',' param)* (',' '...')? )?
 *   param      := ('out' | 'inout' | 'notnull' | 'const')* type Name? array? ('=' raw)?
 *   type       := ('ref' | 'autoptr' | 'owned')* Name ('<' type-args '>')?
 *
 * Every public type here is part of the source-index interface read by E03,
 * E12, E15, E16, E18, the Enforce linter and `exists.ts`.
 */

// ── Public record types ───────────────────────────────────────────────────────

/** One `[Name(args)]` annotation, attached to the declaration that follows it. */
export interface AttributeUse {
  /** Attribute class name, e.g. `Attribute`, `WorkbenchPluginAttribute`, `RplProp`. */
  name: string;
  /** Argument text between the outer parentheses, comments removed and whitespace collapsed; absent for `[Name]`. */
  args?: string;
  /** 1-based line of the attribute name. */
  line: number;
}

/** One method parameter. */
export interface ParamInfo {
  /** Parameter name; absent for an unnamed prototype parameter. */
  name?: string;
  /** Type text including `ref` / `autoptr` / `owned` and generic arguments, e.g. `array<ref Foo>`. */
  type: string;
  /** Parameter modifiers in source order: `out`, `inout`, `notnull`, `const`. */
  modifiers: string[];
  /** Static-array suffix, e.g. `[4]`. */
  array?: string;
  /** Default value text exactly as written (comments removed, whitespace collapsed). */
  default?: string;
}

interface RecordBase {
  /** Virtual pak path, e.g. `scripts/Core/generated/WorkbenchAPI/WorldEditorAPI.c`. */
  file: string;
  /** 1-based line of the declared name. */
  line: number;
  /** Script module: the folder directly under `scripts/` (`Game`, `GameLib`, `Core`, `Workbench`...). */
  script_module: string;
  /** Enclosing preprocessor guards, outermost first: `WORKBENCH`, `!DOXYGEN`, `if <expr>`. */
  guards: string[];
  /** Doc comment text with comment markers stripped (Doxygen `//!`, `///`, `/*!`, `/**`, `//!<`). */
  doc?: string;
}

/** `class` or `modded class` declaration (also a forward declaration `class X;`). */
export interface ClassRecord extends RecordBase {
  kind: "class";
  name: string;
  /** Parent type text as written (`Managed`, `array<int>`); absent when none. */
  parent?: string;
  /** Base identifier of `parent` (`array` for `array<int>`). */
  parent_name?: string;
  modded: boolean;
  /** For a modded class: the class it modifies (its own name). */
  modifies?: string;
  sealed: boolean;
  /** Class modifiers other than `modded` (`sealed`, `static`...). */
  modifiers: string[];
  /** Generic parameters as written, e.g. `["Class T"]`. */
  generics: string[];
  /** True for `class X;`. */
  forward?: boolean;
  attributes: AttributeUse[];
  /** Declaration header on one line, e.g. `sealed class WorldEditorAPI`. */
  signature: string;
  /** 1-based line of the closing brace (or of the `;` of a forward declaration). */
  end_line: number;
}

export interface EnumRecord extends RecordBase {
  kind: "enum";
  name: string;
  /** Underlying / base type after `:`. */
  base?: string;
  modded: boolean;
  modifiers: string[];
  attributes: AttributeUse[];
  signature: string;
  end_line: number;
  /** Number of values declared. */
  value_count: number;
}

export interface EnumValueRecord extends RecordBase {
  kind: "enum-value";
  /** Enum the value belongs to. */
  owner: string;
  name: string;
  /** Explicit value text after `=`, exactly as written. */
  value?: string;
  /** 0-based position in the enum body. */
  ordinal: number;
  /** `NAME` or `NAME = value`. */
  signature: string;
}

/** A method of a class (`owner` set) or a global function (`kind: "function"`, no owner). */
export interface MethodRecord extends RecordBase {
  kind: "method" | "function";
  /** Declaring class; absent for a global function. */
  owner?: string;
  /** Method name; a destructor is `~Name`. */
  name: string;
  /** Return type text (`void` for constructors written with it; empty for one written without). */
  return_type: string;
  params: ParamInfo[];
  /** Number of declared parameters (a trailing `...` is not counted). */
  arity: number;
  /** Parameters without a default value. */
  required: number;
  /** True when the parameter list ends with `...`. */
  variadic?: boolean;
  /** Declaration modifiers in source order: static, proto, native, external, private, protected, override, event, sealed, volatile, const... */
  modifiers: string[];
  /** Words after the closing parenthesis (e.g. `const`). */
  trailing?: string[];
  is_constructor?: boolean;
  is_destructor?: boolean;
  /** True when a body `{...}` follows; false for prototypes ending in `;`. */
  has_body: boolean;
  attributes: AttributeUse[];
  /** The declaration on one line, from the first modifier to the closing parenthesis (and trailing words). */
  signature: string;
}

/** A member variable (`owner` set) or a global variable (no owner). */
export interface FieldRecord extends RecordBase {
  kind: "field" | "variable";
  owner?: string;
  name: string;
  type: string;
  modifiers: string[];
  array?: string;
  /** Initialiser text after `=`. */
  init?: string;
  attributes: AttributeUse[];
  signature: string;
}

export interface TypedefRecord extends RecordBase {
  kind: "typedef";
  name: string;
  /** Aliased type text (`func`, `array<string>`, `int`). */
  type: string;
  /** Base identifier of `type`. */
  type_name: string;
  signature: string;
}

export type SourceRecord =
  | ClassRecord
  | EnumRecord
  | EnumValueRecord
  | MethodRecord
  | FieldRecord
  | TypedefRecord;

/** A construct the parser could not read. Any error makes the file "failed". */
export interface ParseError {
  line: number;
  message: string;
}

/**
 * Source the engine accepts but that departs from the usual grammar (a
 * missing `;`, a stray `;` after an attribute, a trailing comma, an omitted
 * type). The declaration is still recorded; the file is not "failed".
 */
export interface ParseWarning {
  line: number;
  message: string;
}

/** A doc-comment oddity worth knowing (e.g. `\code` closed by `/endcode`). */
export interface DocWarning {
  line: number;
  message: string;
}

export interface ParsedFile {
  file: string;
  script_module: string;
  records: SourceRecord[];
  errors: ParseError[];
  warnings: ParseWarning[];
  doc_warnings: DocWarning[];
  /** `#define` names in source order. */
  defines: string[];
  /** Line count of the file. */
  lines: number;
}

// ── Tokens ────────────────────────────────────────────────────────────────────

type TokKind = "id" | "num" | "str" | "op";

interface Tok {
  k: TokKind;
  t: string;
  /** Start / end offsets in the source. */
  s: number;
  e: number;
  line: number;
  endLine: number;
  /** Guard stack in force at this token. */
  g: readonly string[];
  /** Comments between the previous significant token and this one: [from, to) into `comments`. */
  c0: number;
  c1: number;
}

interface Comment {
  text: string;
  line: number;
  endLine: number;
  block: boolean;
}

interface Lexed {
  toks: Tok[];
  comments: Comment[];
  errors: ParseError[];
  warnings: ParseWarning[];
  defines: string[];
  lines: number;
}

const NUMBER_RE = /(?:0[xX][0-9a-fA-F]+|[0-9]+(?:\.[0-9]*)?(?:[eE][+-]?[0-9]+)?)[fFuUlL]?/y;
const IDENT_RE = /[A-Za-z_][A-Za-z0-9_]*/y;

function flipGuard(g: string): string {
  return g.startsWith("!") ? g.slice(1) : `!${g}`;
}

/** Tokenises Enforce source: significant tokens, comments, preprocessor guards. */
export function lex(source: string): Lexed {
  const src = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const toks: Tok[] = [];
  const comments: Comment[] = [];
  const errors: ParseError[] = [];
  const warnings: ParseWarning[] = [];
  const defines: string[] = [];
  let stack: string[] = [];
  let guards: readonly string[] = Object.freeze([]);
  const guardOpen: number[] = [];
  let i = 0;
  let line = 1;
  let lineStart = true; // only whitespace since the last newline
  let pendingC0 = 0;
  const n = src.length;

  const countLines = (from: number, to: number): number => {
    let k = 0;
    for (let x = from; x < to; x++) if (src.charCodeAt(x) === 10) k++;
    return k;
  };

  while (i < n) {
    const ch = src[i];
    if (ch === "\n") {
      line++;
      i++;
      lineStart = true;
      continue;
    }
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\f" || ch === "\v") {
      i++;
      continue;
    }
    if (ch === "/" && src[i + 1] === "/") {
      let j = i;
      while (j < n && src[j] !== "\n") j++;
      comments.push({
        text: src.slice(i, j).replace(/\r$/, ""),
        line,
        endLine: line,
        block: false,
      });
      i = j;
      continue;
    }
    if (ch === "/" && src[i + 1] === "*") {
      const close = src.indexOf("*/", i + 2);
      const j = close === -1 ? n : close + 2;
      if (close === -1) errors.push({ line, message: "unterminated block comment" });
      const text = src.slice(i, j);
      const nl = countLines(i, j);
      comments.push({ text, line, endLine: line + nl, block: true });
      line += nl;
      i = j;
      lineStart = false;
      continue;
    }
    if (ch === "#" && lineStart) {
      let j = i;
      while (j < n && src[j] !== "\n") j++;
      const raw = src
        .slice(i + 1, j)
        .replace(/\r$/, "")
        .replace(/\/\/.*$/, "")
        .replace(/\/\*.*?\*\//g, "")
        .trim();
      const m = /^(\w+)\s*(.*)$/.exec(raw);
      const word = m?.[1] ?? "";
      const arg = (m?.[2] ?? "").trim();
      if (word === "ifdef" || word === "ifndef" || word === "if") {
        const g = word === "ifdef" ? arg : word === "ifndef" ? `!${arg}` : `if ${arg}`;
        stack = [...stack, g];
        guardOpen.push(line);
        guards = Object.freeze(stack.slice());
      } else if (word === "else") {
        if (stack.length === 0) errors.push({ line, message: "#else without #ifdef" });
        else {
          stack = [...stack.slice(0, -1), flipGuard(stack[stack.length - 1])];
          guards = Object.freeze(stack.slice());
        }
      } else if (word === "endif") {
        if (stack.length === 0) errors.push({ line, message: "#endif without #ifdef" });
        else {
          stack = stack.slice(0, -1);
          guardOpen.pop();
          guards = Object.freeze(stack.slice());
        }
      } else if (word === "define" || word === "undef") {
        if (word === "define") defines.push(arg.split(/\s+/)[0]);
      } else if (word !== "include") {
        errors.push({ line, message: `unknown preprocessor directive #${word || raw}` });
      }
      i = j;
      continue;
    }
    lineStart = false;
    const start = i;
    const startLine = line;
    let k: TokKind;
    if (ch === '"') {
      let j = i + 1;
      let closed = false;
      while (j < n) {
        const c = src[j];
        if (c === "\\") {
          j += 2;
          continue;
        }
        if (c === '"') {
          closed = true;
          j++;
          break;
        }
        if (c === "\n") break;
        j++;
      }
      if (!closed) errors.push({ line, message: "unterminated string" });
      i = j;
      k = "str";
    } else if (ch >= "0" && ch <= "9") {
      NUMBER_RE.lastIndex = i;
      const m = NUMBER_RE.exec(src);
      i += m ? m[0].length : 1;
      k = "num";
    } else if (/[A-Za-z_]/.test(ch)) {
      IDENT_RE.lastIndex = i;
      const m = IDENT_RE.exec(src);
      i += m ? m[0].length : 1;
      k = "id";
    } else {
      i++;
      k = "op";
    }
    toks.push({
      k,
      t: src.slice(start, i),
      s: start,
      e: i,
      line: startLine,
      endLine: line,
      g: guards,
      c0: pendingC0,
      c1: comments.length,
    });
    pendingC0 = comments.length;
  }
  // The engine compiles files whose last `#ifdef` is never closed; the
  // guard then runs to the end of the file, as it does here.
  for (const l of guardOpen)
    warnings.push({
      line: l,
      message: "#ifdef without #endif (the guard runs to the end of the file)",
    });
  // Sentinel end token carries the trailing comments.
  toks.push({
    k: "op",
    t: "",
    s: n,
    e: n,
    line,
    endLine: line,
    g: guards,
    c0: pendingC0,
    c1: comments.length,
  });
  return { toks, comments, errors, warnings, defines, lines: line };
}

// ── Doc comments ──────────────────────────────────────────────────────────────

const DOC_START = /^(\/\/[!/](?!\/)|\/\*[!*](?!\*?\/$))/;
const DOC_TRAILING = /^(\/\/[!/]<|\/\*[!*]<)/;
const GROUPING =
  /^[\\@](addtogroup|defgroup|ingroup|name|file|\{|\})|^[\\@]?\{$|^[\\@]?\}$|^@\{|^@\}/;

/** Comment text with Doxygen markers removed. */
export function cleanDoc(raw: string): string {
  let t: string;
  if (raw.startsWith("/*")) {
    t = raw
      .replace(/^\/\*[!*]?<?/, "")
      .replace(/\*\/$/, "")
      .split(/\r?\n/)
      .map((l) => l.replace(/^\s*\*(?!\/)\s?/, "").replace(/\s+$/, ""))
      .join("\n");
  } else {
    t = raw.replace(/^\/\/[!/]?<?\s?/, "").replace(/\s+$/, "");
  }
  return t.replace(/^\s*\n/, "").trim();
}

function isDocComment(c: Comment): boolean {
  if (!DOC_START.test(c.text)) return false;
  const body = cleanDoc(c.text);
  if (body === "" || /^[/*\-=\s]*$/.test(body)) return false;
  return !GROUPING.test(body);
}

const ABBREV = /(?:^|\s)(?:e\.g|i\.e|eg|ie|etc|vs|approx|incl|resp|No)\.$/i;
const BLOCK_CMD =
  /(^|\s)[\\@](param|tparam|return|returns|retval|code|endcode|see|sa|note|warning|deprecated|example|snippet|verbatim|throws|exception|attention|remark|remarks|pre|post|todo|bug)\b/;

/**
 * The first sentence of a doc comment: the text before the first block
 * command (`\param`, `\code`, ...), `\brief` removed, whitespace collapsed,
 * cut at the first `.`, `!` or `?` that ends a word (abbreviations such as
 * `e.g.` do not end it). Undefined when nothing is left.
 */
export function firstSentence(doc: string | undefined): string | undefined {
  if (!doc) return undefined;
  let t = doc;
  const cmd = BLOCK_CMD.exec(t);
  if (cmd) t = t.slice(0, cmd.index);
  t = t
    .replace(/[\\@]brief\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return undefined;
  const re = /[.!?](?=\s|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t)) !== null) {
    const head = t.slice(0, m.index + 1);
    if (ABBREV.test(head)) continue;
    return head.trim() || undefined;
  }
  return t;
}

// ── Parser ────────────────────────────────────────────────────────────────────

/** Modifiers that may precede a declaration (class, enum, member, function). */
const DECL_MODIFIERS = new Set([
  "static",
  "proto",
  "native",
  "external",
  "private",
  "protected",
  "override",
  "event",
  "sealed",
  "volatile",
  "const",
  "modded",
  "notnull",
]);
/** Words kept as part of a type. */
const TYPE_QUALIFIERS = new Set(["ref", "autoptr", "owned"]);
/** Parameter modifiers. */
const PARAM_MODIFIERS = new Set(["out", "inout", "notnull", "const"]);

class FileParser {
  private i = 0;
  readonly records: SourceRecord[] = [];
  readonly errors: ParseError[];
  readonly docWarnings: DocWarning[] = [];
  readonly warnings: ParseWarning[];

  constructor(
    private readonly file: string,
    private readonly scriptModule: string,
    private readonly lx: Lexed,
    private readonly src: string,
  ) {
    this.errors = [...lx.errors];
    this.warnings = [...lx.warnings];
  }

  private get toks(): Tok[] {
    return this.lx.toks;
  }
  private peek(n = 0): Tok {
    const t = this.toks[this.i + n];
    return t ?? this.toks[this.toks.length - 1];
  }
  private atEnd(): boolean {
    return this.i >= this.toks.length - 1;
  }
  private next(): Tok {
    const t = this.peek();
    if (!this.atEnd()) this.i++;
    return t;
  }
  private isOp(t: Tok, op: string): boolean {
    return t.k === "op" && t.t === op;
  }
  private isWord(t: Tok, w: string): boolean {
    return t.k === "id" && t.t === w;
  }

  /** Records source the engine accepts but that breaks the usual grammar. */
  private warn(t: Tok, message: string): void {
    this.warnings.push({ line: t.line, message });
  }

  private fail(t: Tok, message: string): never {
    throw new ParseFailure(t.line, message);
  }

  /** Text of tokens [a, b] with one space wherever the source had whitespace or a comment. */
  private textOf(a: number, b: number): string {
    if (b < a) return "";
    let out = this.toks[a].t;
    for (let k = a + 1; k <= b; k++) {
      if (this.toks[k].s > this.toks[k - 1].e) out += " ";
      out += this.toks[k].t;
    }
    return out;
  }

  // ── doc comments ──

  private docBefore(tokIdx: number): string | undefined {
    const t = this.toks[tokIdx];
    const run: Comment[] = [];
    let nextLine = t.line;
    for (let c = t.c1 - 1; c >= t.c0; c--) {
      const cm = this.lx.comments[c];
      if (cm.endLine < nextLine - 1) break;
      run.unshift(cm);
      nextLine = cm.line;
    }
    const docs = run.filter((c) => isDocComment(c) && !DOC_TRAILING.test(c.text));
    if (docs.length === 0) return undefined;
    // A trailing comment of the previous line (`int a; //!< x`) is not ours.
    const prev = this.toks[tokIdx - 1];
    const own = docs.filter((c) => !(prev && c.line === prev.endLine && tokIdx > 0));
    if (own.length === 0) return undefined;
    this.checkDoc(own[0].line, own.map((c) => c.text).join("\n"));
    return own.map((c) => cleanDoc(c.text)).join("\n");
  }

  /** `//!< doc` on the same line after token `tokIdx`. */
  private docAfter(tokIdx: number): string | undefined {
    const t = this.toks[tokIdx];
    const nx = this.toks[tokIdx + 1];
    if (!nx) return undefined;
    for (let c = nx.c0; c < nx.c1; c++) {
      const cm = this.lx.comments[c];
      if (cm.line !== t.endLine) break;
      if (DOC_TRAILING.test(cm.text)) {
        const body = cleanDoc(cm.text);
        if (body) return body;
      }
    }
    return undefined;
  }

  private readonly checkedDocs = new Set<number>();

  /** Flags a doc block (its comments joined) whose `\code` is never closed by `\endcode`. */
  private checkDoc(line: number, body: string): void {
    if (this.checkedDocs.has(line)) return;
    this.checkedDocs.add(line);
    const codeAt = body.search(/[\\@]code\b/);
    if (codeAt === -1) return;
    if (!/[\\@]endcode\b/.test(body.slice(codeAt))) {
      const slash = /(^|\s)\/endcode\b/.test(body) ? " (written `/endcode`)" : "";
      this.docWarnings.push({
        line,
        message: `doc comment opens \\code without \\endcode${slash}; Doxygen treats what follows as code until the next \\endcode`,
      });
    }
  }

  // ── entry ──

  parseFile(): void {
    this.parseItems(undefined);
  }

  /** Items until EOF (owner undefined) or the closing brace of `owner`. */
  private parseItems(owner: string | undefined): void {
    for (;;) {
      if (this.atEnd()) {
        if (owner !== undefined)
          this.fail(this.peek(), `unexpected end of file inside class ${owner}`);
        return;
      }
      const t = this.peek();
      if (owner !== undefined && this.isOp(t, "}")) return;
      if (this.isOp(t, ";")) {
        this.next();
        continue;
      }
      const startIdx = this.i;
      try {
        this.parseItem(owner, startIdx);
      } catch (e) {
        if (!(e instanceof ParseFailure)) throw e;
        this.errors.push({ line: e.line, message: e.message });
        this.recover(startIdx, owner !== undefined);
      }
    }
  }

  /**
   * Skips to the end of the broken statement so one error does not cascade.
   *
   * Recovery never crosses out of the `#ifdef` region the broken statement
   * started in: text under a guard such as `#ifdef BREAK_COMPILATION` may
   * be deliberate non-code, and the declaration after its `#endif` must not
   * be swallowed as the "rest" of the broken statement. When the failed parse
   * already read past the region's end, parsing resumes at the first token
   * outside it.
   */
  private recover(startIdx: number, inClass: boolean): void {
    const region = this.toks[startIdx].g;
    const inside = (t: Tok): boolean =>
      t.g === region || (t.g.length >= region.length && region.every((g, k) => t.g[k] === g));
    if (region.length > 0) {
      for (let k = startIdx + 1; k < this.i && k < this.toks.length - 1; k++) {
        if (!inside(this.toks[k])) {
          this.i = k;
          return;
        }
      }
    }
    if (this.i === startIdx) this.next();
    while (!this.atEnd()) {
      const t = this.peek();
      if (region.length > 0 && !inside(t)) return;
      if (this.isOp(t, ";")) {
        this.next();
        return;
      }
      if (this.isOp(t, "{")) {
        this.skipBalanced("{", "}");
        return;
      }
      if (this.isOp(t, "}")) {
        if (!inClass) this.next();
        return;
      }
      this.next();
    }
  }

  private parseItem(owner: string | undefined, startIdx: number): void {
    const attrs = this.parseAttributes();
    const declIdx = this.i;
    const mods: string[] = [];
    for (;;) {
      const t = this.peek();
      const nx = this.peek(1);
      if (t.k === "id" && DECL_MODIFIERS.has(t.t) && nx.k === "id") {
        mods.push(this.next().t);
        continue;
      }
      // `ref const array<int> X`, `owned external string F()`: a type
      // qualifier written among the modifiers is kept as a modifier.
      if (t.k === "id" && TYPE_QUALIFIERS.has(t.t) && nx.k === "id" && DECL_MODIFIERS.has(nx.t)) {
        mods.push(this.next().t);
        continue;
      }
      break;
    }
    const head = this.peek();
    if (this.isWord(head, "class")) return this.parseClass(attrs, mods, startIdx, declIdx, owner);
    if (this.isWord(head, "enum")) return this.parseEnum(attrs, mods, startIdx, declIdx);
    if (this.isWord(head, "typedef")) return this.parseTypedef(startIdx, declIdx);
    this.parseMember(attrs, mods, owner, startIdx, declIdx);
  }

  private guardsAt(idx: number): string[] {
    return [...this.toks[idx].g];
  }

  // ── attributes ──

  private parseAttributes(): AttributeUse[] {
    const out: AttributeUse[] = [];
    while (this.isOp(this.peek(), "[")) {
      const open = this.next();
      for (;;) {
        const nameTok = this.peek();
        if (nameTok.k !== "id")
          this.fail(nameTok, `expected an attribute name after "[", got "${nameTok.t}"`);
        this.next();
        const use: AttributeUse = { name: nameTok.t, line: nameTok.line };
        if (this.isOp(this.peek(), "(")) {
          const a = this.i;
          this.skipBalanced("(", ")");
          use.args = this.textOf(a + 1, this.i - 2);
        }
        out.push(use);
        if (this.isOp(this.peek(), ",")) {
          this.next();
          continue;
        }
        break;
      }
      if (!this.isOp(this.peek(), "]"))
        this.fail(this.peek(), `expected "]" closing the attribute opened on line ${open.line}`);
      this.next();
      if (this.isOp(this.peek(), ";")) {
        this.warn(this.peek(), `stray ";" after the attribute opened on line ${open.line}`);
        this.next();
      }
    }
    return out;
  }

  /** At `openCh`: consumes through the matching `closeCh` (all bracket kinds nest). */
  private skipBalanced(openCh: string, closeCh: string): void {
    const open = this.peek();
    if (!this.isOp(open, openCh)) this.fail(open, `expected "${openCh}"`);
    const stack: string[] = [];
    const pairs: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
    for (;;) {
      if (this.atEnd()) this.fail(open, `"${openCh}" opened on line ${open.line} is never closed`);
      const t = this.next();
      if (t.k !== "op") continue;
      if (pairs[t.t]) stack.push(pairs[t.t]);
      else if (t.t === ")" || t.t === "]" || t.t === "}") {
        const want = stack.pop();
        if (want !== t.t)
          this.fail(t, `"${t.t}" does not match the "${openCh}" opened on line ${open.line}`);
        if (stack.length === 0) {
          if (t.t !== closeCh) this.fail(t, `expected "${closeCh}"`);
          return;
        }
      }
    }
  }

  // ── types ──

  /** Parses a type; returns the index range [a, b] of its tokens. */
  private parseType(): { a: number; b: number; base: string } {
    const a = this.i;
    while (
      this.peek().k === "id" &&
      TYPE_QUALIFIERS.has(this.peek().t) &&
      this.peek(1).k === "id"
    ) {
      // `static ref s_X = new X();` leaves the type out: `ref` is then the whole type.
      const after = this.peek(2);
      if (after.k === "op" && (after.t === "=" || after.t === ";" || after.t === ",")) {
        this.warn(this.peek(), `type omitted after "${this.peek().t}"`);
        break;
      }
      this.next();
    }
    const baseTok = this.peek();
    if (baseTok.k !== "id")
      this.fail(baseTok, `expected a type, got "${baseTok.t || "end of file"}"`);
    this.next();
    if (this.isOp(this.peek(), "<")) this.skipGenerics();
    // `vector[] transform`, `float[4] m`: an array suffix written on the type.
    while (this.isOp(this.peek(), "[")) this.skipBalanced("[", "]");
    return { a, b: this.i - 1, base: baseTok.t };
  }

  /** At `<`: consumes a balanced generic argument list. */
  private skipGenerics(): void {
    const open = this.next();
    let depth = 1;
    while (depth > 0) {
      if (this.atEnd())
        this.fail(open, `generic argument list opened on line ${open.line} is never closed`);
      const t = this.next();
      if (this.isOp(t, "<")) depth++;
      else if (this.isOp(t, ">")) depth--;
      else if (t.k === "op" && !/^[,.[\]0-9]$/.test(t.t))
        this.fail(t, `unexpected "${t.t}" in a generic argument list`);
    }
    // `ref array<string>> m_a;` compiles: an extra `>` before the name is tolerated.
    while (this.isOp(this.peek(), ">") && this.peek(1).k === "id") {
      this.warn(
        this.peek(),
        `extra ">" after the generic argument list opened on line ${open.line}`,
      );
      this.next();
    }
  }

  /** Optional `[...]` static-array suffix; returns its text. */
  private parseArraySuffix(): string | undefined {
    // Only on the name's line: a `[` on a later line opens the next
    // declaration's attribute (after a variable whose `;` is missing).
    const sameLine = (): boolean =>
      this.isOp(this.peek(), "[") && this.peek().line === this.toks[this.i - 1].endLine;
    if (!sameLine()) return undefined;
    let out = "";
    while (sameLine()) {
      const a = this.i;
      this.skipBalanced("[", "]");
      out += this.textOf(a, this.i - 1);
    }
    return out;
  }

  /**
   * Scans an expression (initialiser, default value, enum value) up to a
   * top-level token in `stops`; returns its token range. Generic arguments
   * after `new` are skipped as a unit so `new map<string, int>()` stays whole.
   */
  private scanExpr(stops: readonly string[]): { a: number; b: number } {
    const a = this.i;
    const pairs: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
    const stack: string[] = [];
    for (;;) {
      if (this.atEnd()) this.fail(this.toks[a], "expression never ends");
      const t = this.peek();
      if (stack.length === 0 && t.k === "op" && stops.includes(t.t)) break;
      if (
        t.k === "id" &&
        t.t === "new" &&
        this.peek(1).k === "id" &&
        this.isOp(this.peek(2), "<")
      ) {
        this.next();
        this.next();
        this.skipGenerics();
        continue;
      }
      this.next();
      if (t.k !== "op") continue;
      if (pairs[t.t]) stack.push(pairs[t.t]);
      else if (t.t === ")" || t.t === "]" || t.t === "}") {
        if (stack.pop() !== t.t) this.fail(t, `unbalanced "${t.t}" in an expression`);
      }
    }
    if (this.i === a) this.fail(this.peek(), "empty expression");
    return { a, b: this.i - 1 };
  }

  // ── class ──

  private parseClass(
    attrs: AttributeUse[],
    mods: string[],
    startIdx: number,
    declIdx: number,
    owner: string | undefined,
  ): void {
    if (owner !== undefined) this.fail(this.peek(), `nested class inside ${owner}`);
    this.next(); // class
    const nameTok = this.next();
    if (nameTok.k !== "id") this.fail(nameTok, `expected a class name, got "${nameTok.t}"`);
    const generics: string[] = [];
    if (this.isOp(this.peek(), "<")) {
      const a = this.i;
      this.skipGenerics();
      const inner = this.textOf(a + 1, this.i - 2);
      for (const g of splitTopLevel(inner)) generics.push(g);
    }
    let parent: { a: number; b: number; base: string } | undefined;
    if (this.isOp(this.peek(), ":") || this.isWord(this.peek(), "extends")) {
      this.next();
      parent = this.parseType();
    }
    const headerEnd = this.i - 1;
    const modded = mods.includes("modded");
    const rec: ClassRecord = {
      kind: "class",
      file: this.file,
      line: nameTok.line,
      script_module: this.scriptModule,
      guards: this.guardsAt(startIdx),
      name: nameTok.t,
      modded,
      sealed: mods.includes("sealed"),
      modifiers: mods.filter((m) => m !== "modded"),
      generics,
      attributes: attrs,
      signature: this.textOf(declIdx, headerEnd),
      end_line: nameTok.line,
    };
    if (modded) rec.modifies = nameTok.t;
    if (parent) {
      rec.parent = this.textOf(parent.a, parent.b);
      rec.parent_name = parent.base;
    }
    const doc =
      this.docBefore(startIdx) ?? (declIdx !== startIdx ? this.docBefore(declIdx) : undefined);
    if (doc) rec.doc = doc;
    if (this.isOp(this.peek(), ";")) {
      rec.forward = true;
      rec.end_line = this.next().line;
      this.records.push(rec);
      return;
    }
    if (!this.isOp(this.peek(), "{"))
      this.fail(this.peek(), `expected "{" after class ${nameTok.t}, got "${this.peek().t}"`);
    this.next();
    this.records.push(rec);
    this.parseItems(nameTok.t);
    const close = this.next(); // }
    rec.end_line = close.line;
  }

  // ── enum ──

  private parseEnum(
    attrs: AttributeUse[],
    mods: string[],
    startIdx: number,
    declIdx: number,
  ): void {
    this.next(); // enum
    const nameTok = this.next();
    if (nameTok.k !== "id") this.fail(nameTok, `expected an enum name, got "${nameTok.t}"`);
    let base: string | undefined;
    if (this.isOp(this.peek(), ":")) {
      this.next();
      const ty = this.parseType();
      base = this.textOf(ty.a, ty.b);
    }
    const headerEnd = this.i - 1;
    if (!this.isOp(this.peek(), "{"))
      this.fail(this.peek(), `expected "{" after enum ${nameTok.t}`);
    this.next();
    const rec: EnumRecord = {
      kind: "enum",
      file: this.file,
      line: nameTok.line,
      script_module: this.scriptModule,
      guards: this.guardsAt(startIdx),
      name: nameTok.t,
      modded: mods.includes("modded"),
      modifiers: mods.filter((m) => m !== "modded"),
      attributes: attrs,
      signature: this.textOf(declIdx, headerEnd),
      end_line: nameTok.line,
      value_count: 0,
    };
    if (base) rec.base = base;
    const doc =
      this.docBefore(startIdx) ?? (declIdx !== startIdx ? this.docBefore(declIdx) : undefined);
    if (doc) rec.doc = doc;
    this.records.push(rec);
    let ordinal = 0;
    for (;;) {
      const t = this.peek();
      if (this.isOp(t, "}")) break;
      if (t.k !== "id")
        this.fail(t, `expected an enum value name in ${nameTok.t}, got "${t.t || "end of file"}"`);
      const vIdx = this.i;
      this.next();
      const v: EnumValueRecord = {
        kind: "enum-value",
        file: this.file,
        line: t.line,
        script_module: this.scriptModule,
        guards: this.guardsAt(vIdx),
        owner: nameTok.t,
        name: t.t,
        ordinal: ordinal++,
        signature: t.t,
      };
      if (this.isOp(this.peek(), "=")) {
        this.next();
        const ex = this.scanExpr([",", "}"]);
        v.value = this.textOf(ex.a, ex.b);
      }
      v.signature = this.textOf(vIdx, this.i - 1);
      let lastIdx = this.i - 1;
      if (this.isOp(this.peek(), ",")) {
        lastIdx = this.i;
        this.next();
      } else if (!this.isOp(this.peek(), "}")) {
        this.fail(
          this.peek(),
          `expected "," or "}" after enum value ${t.t}, got "${this.peek().t}"`,
        );
      }
      const vdoc = this.docBefore(vIdx) ?? this.docAfter(lastIdx);
      if (vdoc) v.doc = vdoc;
      this.records.push(v);
    }
    const close = this.next();
    rec.end_line = close.line;
    rec.value_count = ordinal;
  }

  // ── typedef ──

  private parseTypedef(startIdx: number, declIdx: number): void {
    this.next(); // typedef
    const ty = this.parseType();
    const nameTok = this.next();
    if (nameTok.k !== "id") this.fail(nameTok, `expected a typedef name, got "${nameTok.t}"`);
    if (!this.isOp(this.peek(), ";"))
      this.fail(this.peek(), `expected ";" after typedef ${nameTok.t}`);
    const end = this.i;
    this.next();
    const rec: TypedefRecord = {
      kind: "typedef",
      file: this.file,
      line: nameTok.line,
      script_module: this.scriptModule,
      guards: this.guardsAt(startIdx),
      name: nameTok.t,
      type: this.textOf(ty.a, ty.b),
      type_name: ty.base,
      signature: this.textOf(declIdx, end),
    };
    const doc = this.docBefore(startIdx) ?? this.docAfter(end);
    if (doc) rec.doc = doc;
    this.records.push(rec);
  }

  // ── members, functions, variables ──

  private parseMember(
    attrs: AttributeUse[],
    mods: string[],
    owner: string | undefined,
    startIdx: number,
    declIdx: number,
  ): void {
    const ty = this.parseType();
    let nameTok: Tok;
    let nameIdx: number;
    let returnType = this.textOf(ty.a, ty.b);
    let destructor = false;
    if (this.isOp(this.peek(), "~")) {
      this.next();
      nameIdx = this.i;
      nameTok = this.next();
      if (nameTok.k !== "id") this.fail(nameTok, `expected a destructor name, got "${nameTok.t}"`);
      destructor = true;
    } else if (
      this.isOp(this.peek(), "(") &&
      owner !== undefined &&
      ty.a === ty.b &&
      this.toks[ty.a].t === owner
    ) {
      // Constructor written without a return type.
      nameIdx = ty.a;
      nameTok = this.toks[ty.a];
      returnType = "";
    } else {
      nameIdx = this.i;
      nameTok = this.next();
      if (nameTok.k !== "id")
        this.fail(
          nameTok,
          `expected a name after type "${returnType}", got "${nameTok.t || "end of file"}"`,
        );
    }

    if (this.isOp(this.peek(), "(")) {
      this.parseMethodRest(attrs, mods, owner, startIdx, declIdx, nameTok, returnType, destructor);
      return;
    }
    if (destructor) this.fail(this.peek(), `expected "(" after ~${nameTok.t}`);
    // One or more variables sharing the type.
    const type = returnType;
    let first = true;
    let nm = nameTok;
    let nmIdx = nameIdx;
    const docBefore =
      this.docBefore(startIdx) ?? (declIdx !== startIdx ? this.docBefore(declIdx) : undefined);
    const pending: FieldRecord[] = [];
    for (;;) {
      const arr = this.parseArraySuffix();
      let init: string | undefined;
      if (this.isOp(this.peek(), "=")) {
        this.next();
        const ex = this.scanExpr([",", ";"]);
        init = this.textOf(ex.a, ex.b);
      }
      const rec: FieldRecord = {
        kind: owner !== undefined ? "field" : "variable",
        file: this.file,
        line: nm.line,
        script_module: this.scriptModule,
        guards: this.guardsAt(startIdx),
        name: nm.t,
        type,
        modifiers: mods,
        attributes: attrs,
        signature: first
          ? this.textOf(declIdx, this.i - 1)
          : `${type} ${this.textOf(nmIdx, this.i - 1)}`,
      };
      if (owner !== undefined) rec.owner = owner;
      if (arr) rec.array = arr;
      if (init !== undefined) rec.init = init;
      if (first && docBefore) rec.doc = docBefore;
      pending.push(rec);
      first = false;
      if (this.isOp(this.peek(), ",")) {
        this.next();
        nmIdx = this.i;
        nm = this.next();
        if (nm.k !== "id") this.fail(nm, `expected a variable name after ",", got "${nm.t}"`);
        continue;
      }
      let end = this.i;
      if (this.isOp(this.peek(), ";")) this.next();
      else if (!this.atEnd() && this.peek().line > this.toks[this.i - 1].endLine) {
        // The engine accepts a variable whose `;` is missing at the end of its line.
        this.warn(this.toks[this.i - 1], `missing ";" after variable ${nm.t}`);
        end = this.i - 1;
      } else
        this.fail(
          this.peek(),
          `expected ";" after variable ${nm.t}, got "${this.peek().t || "end of file"}"`,
        );
      const after = this.docAfter(end);
      if (after) for (const r of pending) if (!r.doc) r.doc = after;
      break;
    }
    this.records.push(...pending);
  }

  private parseMethodRest(
    attrs: AttributeUse[],
    mods: string[],
    owner: string | undefined,
    startIdx: number,
    declIdx: number,
    nameTok: Tok,
    returnType: string,
    destructor: boolean,
  ): void {
    this.next(); // (
    const params: ParamInfo[] = [];
    let variadic = false;
    if (!this.isOp(this.peek(), ")")) {
      for (;;) {
        if (
          this.isOp(this.peek(), ".") &&
          this.isOp(this.peek(1), ".") &&
          this.isOp(this.peek(2), ".")
        ) {
          this.next();
          this.next();
          this.next();
          variadic = true;
          if (!this.isOp(this.peek(), ")"))
            this.fail(this.peek(), `"..." must be the last parameter`);
          break;
        }
        const p: ParamInfo = { type: "", modifiers: [] };
        while (
          this.peek().k === "id" &&
          PARAM_MODIFIERS.has(this.peek().t) &&
          this.peek(1).k === "id"
        ) {
          p.modifiers.push(this.next().t);
        }
        const ty = this.parseType();
        p.type = this.textOf(ty.a, ty.b);
        if (this.peek().k === "id") p.name = this.next().t;
        const arr = this.parseArraySuffix();
        if (arr) p.array = arr;
        if (this.isOp(this.peek(), "=")) {
          this.next();
          const ex = this.scanExpr([",", ")"]);
          p.default = this.textOf(ex.a, ex.b);
        }
        params.push(p);
        if (this.isOp(this.peek(), ",")) {
          this.next();
          if (this.isOp(this.peek(), ")")) {
            this.warn(this.peek(), `trailing comma in the parameters of ${nameTok.t}`);
            break;
          }
          continue;
        }
        if (this.isOp(this.peek(), ")")) break;
        this.fail(
          this.peek(),
          `expected "," or ")" in the parameters of ${nameTok.t}, got "${this.peek().t || "end of file"}"`,
        );
      }
    }
    this.next(); // )
    const trailing: string[] = [];
    while (
      this.peek().k === "id" &&
      (this.peek().t === "const" || DECL_MODIFIERS.has(this.peek().t))
    )
      trailing.push(this.next().t);
    const sigEnd = this.i - 1;
    let hasBody: boolean;
    let endIdx: number;
    if (this.isOp(this.peek(), ";")) {
      endIdx = this.i;
      this.next();
      hasBody = false;
    } else if (this.isOp(this.peek(), "{")) {
      endIdx = this.i;
      this.skipBalanced("{", "}");
      hasBody = true;
    } else {
      this.fail(
        this.peek(),
        `expected ";" or a body after ${nameTok.t}(...), got "${this.peek().t || "end of file"}"`,
      );
    }
    const name = destructor ? `~${nameTok.t}` : nameTok.t;
    const rec: MethodRecord = {
      kind: owner !== undefined ? "method" : "function",
      file: this.file,
      line: nameTok.line,
      script_module: this.scriptModule,
      guards: this.guardsAt(startIdx),
      name,
      return_type: returnType,
      params,
      arity: params.length,
      required: params.filter((p) => p.default === undefined).length,
      modifiers: mods,
      has_body: hasBody,
      attributes: attrs,
      signature: this.textOf(declIdx, sigEnd),
    };
    if (owner !== undefined) {
      rec.owner = owner;
      if (destructor) rec.is_destructor = true;
      else if (nameTok.t === owner) rec.is_constructor = true;
    }
    if (variadic) rec.variadic = true;
    if (trailing.length) rec.trailing = trailing;
    const doc =
      this.docBefore(startIdx) ??
      (declIdx !== startIdx ? this.docBefore(declIdx) : undefined) ??
      (hasBody ? undefined : this.docAfter(endIdx));
    if (doc) rec.doc = doc;
    this.records.push(rec);
  }
}

class ParseFailure extends Error {
  constructor(
    readonly line: number,
    message: string,
  ) {
    super(message);
  }
}

/** Splits text at top-level commas (outside (), [], {}, <>). */
export function splitTopLevel(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  let inStr = false;
  for (let k = 0; k < text.length; k++) {
    const c = text[k];
    if (inStr) {
      cur += c;
      if (c === "\\") {
        cur += text[++k] ?? "";
      } else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if ("([{<".includes(c)) depth++;
    else if (")]}>".includes(c)) depth--;
    else if (c === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** The script module of a virtual path: the folder directly under `scripts/`. */
export function scriptModuleOf(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[0].toLowerCase() === "scripts" && parts.length > 2 ? parts[1] : "";
}

/**
 * Parses one Enforce source file into declaration records. Never throws for
 * malformed input: every construct it cannot read becomes an entry in
 * `errors` (and the parser resynchronises at the next statement).
 */
export function parseEnforceSource(file: string, source: string): ParsedFile {
  const src = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const lx = lex(src);
  const p = new FileParser(file, scriptModuleOf(file), lx, src);
  p.parseFile();
  return {
    file,
    script_module: scriptModuleOf(file),
    records: p.records,
    errors: p.errors.sort((a, b) => a.line - b.line),
    warnings: p.warnings,
    doc_warnings: p.docWarnings,
    defines: lx.defines,
    lines: lx.lines,
  };
}
