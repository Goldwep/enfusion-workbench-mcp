/**
 * Enforce Script parser (L6-2).
 *
 * Recursive-descent over the token stream from `tokenizer.ts`. Scope:
 * structural extraction only — class / modded class / method signatures /
 * field declarations / attributes / typedefs / enums / global functions.
 * Method bodies are captured as opaque text (start..end range over the
 * source), NOT parsed further. This is enough to power script_analyze /
 * script_overrides / script_lint / script_format / script_class_hierarchy /
 * script_find_rpc_handlers.
 *
 * Grammar notes (audit H12 — modifiers were previously consumed as types,
 * producing phantom fields on nearly every real vanilla file):
 *
 *   member     := attribute* modifier* type declarator
 *   modifier   := static | const | protected | private | override | proto
 *               | native | external | sealed | ref | autoptr | out | inout
 *               | notnull | event | owned | volatile
 *   type       := (type-keyword | identifier) generic-args?
 *   generic    := '<' (type | ref type) (',' ...)* '>'   -- nested, balanced
 *   declarator := identifier '(' params ')' (';' | body)         -- method
 *               | '~' identifier '(' params ')' body               -- destructor
 *               | identifier ('[' n ']')? ('=' init)? (',' ...)* ';' -- field(s)
 *
 * A modifier word that is immediately followed by `;` `=` `,` `)` `(` or `[`
 * is treated as an identifier (e.g. a parameter named `event`), so the
 * modifier set is safe even for non-reserved words.
 *
 * Preprocessor lines (`#ifdef` / `#else` / `#endif` / `#define`) are
 * lexed as trivia and never reach the parser. Both branches of an
 * `#ifdef/#else` therefore get parsed — acceptable for extraction.
 *
 * Error recovery: on an unrecognized construct inside a class body, skip
 * to the end of the statement (`;`, or a balanced `{...}` block) so a
 * single bad member doesn't cascade into dozens of diagnostics; at top
 * level, additionally resynchronize on the next `class` / `modded`.
 */

import { tokenize, withoutTrivia } from "./tokenizer.js";
import type {
  AttributeNode,
  ClassNode,
  EnumNode,
  FieldNode,
  MethodNode,
  ParameterNode,
  ScriptAst,
  SourceRange,
  Token,
  TypedefNode,
} from "./ast.js";

interface ParserState {
  source: string;
  tokens: Token[];
  pos: number;
  diagnostics: ScriptAst["diagnostics"];
}

/** Declaration modifiers — consumed before the type, never AS the type. */
const MODIFIER_WORDS = new Set<string>([
  "static",
  "const",
  "protected",
  "private",
  "override",
  "proto",
  "native",
  "external",
  "sealed",
  "ref",
  "autoptr",
  "out",
  "inout",
  "notnull",
  "event",
  "owned",
  "volatile",
]);

/** Keywords that can start a type. Everything else that starts a type is an identifier. */
const TYPE_KEYWORDS = new Set<string>([
  "void",
  "bool",
  "int",
  "float",
  "string",
  "vector",
  "array",
  "auto",
  "typename",
]);

type MemberResult =
  | { kind: "method"; node: MethodNode }
  | { kind: "fields"; nodes: FieldNode[] }
  | { kind: "skip" }
  | null;

// ── Public API ───────────────────────────────────────────────────────────────

export function parseScript(source: string, filePath = "<input>"): ScriptAst {
  const tokens = withoutTrivia(tokenize(source));
  const state: ParserState = { source, tokens, pos: 0, diagnostics: [] };
  const classes: ClassNode[] = [];
  const typedefs: TypedefNode[] = [];
  const enums: EnumNode[] = [];
  const functions: MethodNode[] = [];

  while (!atEnd(state)) {
    const startTok = peek(state);
    const attrs = parseAttributes(state);
    if (atEnd(state)) break;
    const tok = peek(state);

    if (tok.type === "semicolon") {
      advance(state);
      continue;
    }

    // Class-level modifiers (`sealed class Foo`).
    const modifiers = parseModifiers(state);
    const head = peek(state);

    if (head.type === "keyword" && (head.text === "class" || head.text === "modded")) {
      const cls = parseClass(state, attrs, modifiers);
      if (cls) classes.push(cls);
      continue;
    }
    if (head.type === "keyword" && head.text === "enum") {
      const en = parseEnum(state);
      if (en) enums.push(en);
      continue;
    }
    if (head.type === "keyword" && head.text === "typedef") {
      const td = parseTypedef(state);
      if (td) typedefs.push(td);
      continue;
    }

    // Global function / prototype / global variable.
    const member = parseMemberAfterPrefix(state, startTok, attrs, modifiers, true);
    if (member === null) {
      recoverStatement(state, true);
      continue;
    }
    if (member.kind === "method") functions.push(member.node);
    // Global variables are dropped (rare; not needed by any consumer).
  }

  return { filePath, classes, typedefs, enums, functions, diagnostics: state.diagnostics };
}

// ── Token primitives ─────────────────────────────────────────────────────────

function peek(state: ParserState, lookahead = 0): Token {
  return state.tokens[state.pos + lookahead] ?? state.tokens[state.tokens.length - 1];
}

function advance(state: ParserState): Token {
  const tok = state.tokens[state.pos];
  if (state.pos < state.tokens.length - 1) state.pos += 1;
  return tok;
}

function atEnd(state: ParserState): boolean {
  return peek(state).type === "eof";
}

function isPunct(tok: Token, text: string): boolean {
  return tok.type === "punct" && tok.text === text;
}

function isKeyword(tok: Token, text: string): boolean {
  return tok.type === "keyword" && tok.text === text;
}

function expect(state: ParserState, type: Token["type"], lexeme?: string): Token | null {
  const tok = peek(state);
  if (tok.type !== type || (lexeme !== undefined && tok.text !== lexeme)) {
    state.diagnostics.push({
      message: `expected ${lexeme ?? type}, got ${tok.type} "${tok.text}"`,
      range: tok.range,
    });
    return null;
  }
  return advance(state);
}

function rangeFromTo(start: Token, end: Token): SourceRange {
  return { start: start.range.start, end: end.range.end };
}

function prevToken(state: ParserState): Token {
  return state.tokens[Math.max(0, state.pos - 1)];
}

/** Skip a balanced `{ ... }` block. Assumes current token is `{`. */
function skipBalancedBraces(state: ParserState): Token {
  let depth = 0;
  let last = peek(state);
  while (!atEnd(state)) {
    const t = advance(state);
    last = t;
    if (t.type === "lbrace") depth += 1;
    else if (t.type === "rbrace") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return last;
}

/**
 * Error recovery: consume through the end of the current statement.
 * Stops (without consuming) at a `}` that would close the enclosing class,
 * and — at top level — at the next `class` / `modded` keyword.
 */
function recoverStatement(state: ParserState, topLevel: boolean): void {
  let consumed = 0;
  while (!atEnd(state)) {
    const t = peek(state);
    if (t.type === "semicolon") {
      advance(state);
      return;
    }
    if (t.type === "lbrace") {
      skipBalancedBraces(state);
      return;
    }
    if (t.type === "rbrace") {
      if (topLevel) advance(state);
      return;
    }
    if (topLevel && consumed > 0 && t.type === "keyword" && (t.text === "class" || t.text === "modded")) {
      return;
    }
    advance(state);
    consumed += 1;
  }
}

// ── Attribute parser ─────────────────────────────────────────────────────────

/**
 * Consume zero-or-more attribute blocks: `[Name(args)]`, `[Name]`, and
 * comma-separated lists `[Attribute(...), RplProp(...)]` (one node each).
 */
function parseAttributes(state: ParserState): AttributeNode[] {
  const out: AttributeNode[] = [];
  while (peek(state).type === "attribute_open") {
    const start = advance(state); // [
    let sawAny = false;
    while (!atEnd(state)) {
      if (peek(state).type !== "identifier") break;
      const nameTok = advance(state);
      sawAny = true;
      let args = "";
      if (peek(state).type === "lparen") {
        advance(state); // (
        const argTokens: Token[] = [];
        let depth = 1;
        while (!atEnd(state) && depth > 0) {
          const t = peek(state);
          if (t.type === "lparen") depth += 1;
          else if (t.type === "rparen") {
            depth -= 1;
            if (depth === 0) {
              advance(state);
              break;
            }
          }
          argTokens.push(advance(state));
        }
        args = argTokens.map((t) => t.text).join(" ").trim();
      }
      const endTok = peek(state).type === "attribute_close" ? peek(state) : prevToken(state);
      out.push({
        name: nameTok.text,
        args,
        range: rangeFromTo(start, endTok),
      });
      if (peek(state).type === "comma") {
        advance(state);
        continue;
      }
      break;
    }
    if (!sawAny) {
      // Malformed attribute (probably an Enforce statement using `[` for
      // indexing — unlikely at declaration level but defensive).
      while (!atEnd(state) && peek(state).type !== "attribute_close") {
        advance(state);
      }
      if (peek(state).type === "attribute_close") advance(state);
      continue;
    }
    expect(state, "attribute_close");
  }
  return out;
}

// ── Modifiers / types ────────────────────────────────────────────────────────

/** True when the current token is a modifier word used AS a modifier (not as a name). */
function isModifierAt(state: ParserState): boolean {
  const t = peek(state);
  if (t.type !== "keyword" && t.type !== "identifier") return false;
  if (!MODIFIER_WORDS.has(t.text)) return false;
  const n = peek(state, 1);
  // `int event;` / `Foo(SCR_Event event)` / `event = 1` — a name, not a modifier.
  if (
    n.type === "semicolon" ||
    n.type === "comma" ||
    n.type === "rparen" ||
    n.type === "lparen" ||
    n.type === "attribute_open" ||
    isPunct(n, "=") ||
    n.type === "eof"
  ) {
    return false;
  }
  return true;
}

function parseModifiers(state: ParserState): string[] {
  const out: string[] = [];
  while (isModifierAt(state)) out.push(advance(state).text);
  return out;
}

function isTypeStart(tok: Token): boolean {
  if (tok.type === "identifier") return true;
  return tok.type === "keyword" && TYPE_KEYWORDS.has(tok.text);
}

/**
 * Parse a type: `int`, `Foo`, `array<ref map<string, int>>`, `typename`.
 * Returns the normalized type text, or null if the current token can't
 * start a type (nothing consumed in that case).
 */
function parseType(state: ParserState): string | null {
  if (!isTypeStart(peek(state))) return null;
  let text = advance(state).text;
  if (isPunct(peek(state), "<")) text += parseGenericArgs(state);
  return text;
}

/** Consume a balanced `<...>` generic suffix and return it normalized (`<ref map<string, int>>`). */
function parseGenericArgs(state: ParserState): string {
  const open = peek(state);
  let out = "";
  let depth = 0;
  while (!atEnd(state)) {
    const t = peek(state);
    if (isPunct(t, "<")) {
      depth += 1;
      out += "<";
      advance(state);
      continue;
    }
    if (isPunct(t, ">")) {
      depth -= 1;
      out += ">";
      advance(state);
      if (depth === 0) return out;
      continue;
    }
    if (isPunct(t, ">=")) {
      // `array<int>=` — never valid; treat as close + `=` left for caller.
      break;
    }
    if (t.type === "comma") {
      out += ", ";
      advance(state);
      continue;
    }
    if (
      t.type === "semicolon" ||
      t.type === "lbrace" ||
      t.type === "rbrace" ||
      t.type === "lparen" ||
      t.type === "rparen"
    ) {
      break;
    }
    const last = out[out.length - 1];
    if (last !== undefined && last !== "<" && last !== " ") out += " ";
    out += t.text;
    advance(state);
  }
  state.diagnostics.push({
    message: `unbalanced generic type arguments starting at "${open.text}"`,
    range: open.range,
  });
  return out;
}

// ── Class parser ─────────────────────────────────────────────────────────────

function parseClass(
  state: ParserState,
  leadingAttrs: AttributeNode[],
  classModifiers: string[],
): ClassNode | null {
  const startTok = peek(state);
  let kind: ClassNode["kind"] = "class";
  if (startTok.text === "modded") {
    advance(state);
    if (!isKeyword(peek(state), "class")) {
      state.diagnostics.push({
        message: `expected 'class' after 'modded', got "${peek(state).text}"`,
        range: peek(state).range,
      });
      return null;
    }
    advance(state); // class
    kind = "modded_class";
  } else {
    advance(state); // class
  }

  const nameTok = expect(state, "identifier");
  if (!nameTok) {
    syncToNextClass(state);
    return null;
  }

  // Template header: `class Tpl<Class T, Class U>`.
  const typeParameters: string[] = [];
  if (isPunct(peek(state), "<")) {
    const raw = parseGenericArgs(state); // "<Class T, Class U>"
    const inner = raw.replace(/^<|>$/g, "").trim();
    if (inner.length > 0) {
      for (const p of inner.split(",")) typeParameters.push(p.trim());
    }
  }

  let baseClass: string | null = null;
  if (peek(state).type === "colon" || isKeyword(peek(state), "extends")) {
    advance(state);
    const baseTok = expect(state, "identifier");
    if (baseTok) baseClass = baseTok.text;
    // `class Foo : Bar<T>` — drop the generic args; hierarchy lookups want the bare name.
    if (isPunct(peek(state), "<")) parseGenericArgs(state);
  }

  const lbrace = expect(state, "lbrace");
  if (!lbrace) {
    syncToNextClass(state);
    return null;
  }

  const methods: MethodNode[] = [];
  const fields: FieldNode[] = [];

  // Parse class body.
  while (!atEnd(state) && peek(state).type !== "rbrace") {
    const member = parseMember(state);
    if (member === null) {
      recoverStatement(state, false);
      continue;
    }
    if (member.kind === "method") methods.push(member.node);
    else if (member.kind === "fields") fields.push(...member.nodes);
  }

  const endTok = expect(state, "rbrace") ?? peek(state);
  return {
    kind,
    name: nameTok.text,
    modifiers: classModifiers,
    typeParameters,
    baseClass,
    methods,
    fields,
    attributes: leadingAttrs,
    range: rangeFromTo(startTok, endTok),
  };
}

function syncToNextClass(state: ParserState): void {
  while (!atEnd(state)) {
    const t = peek(state);
    if (t.type === "keyword" && (t.text === "class" || t.text === "modded")) {
      return;
    }
    advance(state);
  }
}

// ── typedef / enum ───────────────────────────────────────────────────────────

function parseTypedef(state: ParserState): TypedefNode | null {
  const startTok = advance(state); // typedef
  const type = parseType(state);
  if (type === null) {
    state.diagnostics.push({
      message: `expected type after 'typedef', got "${peek(state).text}"`,
      range: peek(state).range,
    });
    recoverStatement(state, true);
    return null;
  }
  const nameTok = expect(state, "identifier");
  if (!nameTok) {
    recoverStatement(state, true);
    return null;
  }
  const endTok = expect(state, "semicolon") ?? prevToken(state);
  return { name: nameTok.text, type, range: rangeFromTo(startTok, endTok) };
}

function parseEnum(state: ParserState): EnumNode | null {
  const startTok = advance(state); // enum
  const nameTok = expect(state, "identifier");
  if (!nameTok) {
    recoverStatement(state, true);
    return null;
  }
  let baseType: string | null = null;
  if (peek(state).type === "colon" || isKeyword(peek(state), "extends")) {
    advance(state);
    baseType = parseType(state);
    if (baseType === null) {
      state.diagnostics.push({
        message: `expected base type after ':' in enum ${nameTok.text}, got "${peek(state).text}"`,
        range: peek(state).range,
      });
    }
  }
  if (peek(state).type !== "lbrace") {
    state.diagnostics.push({
      message: `expected '{' after enum ${nameTok.text}, got "${peek(state).text}"`,
      range: peek(state).range,
    });
    recoverStatement(state, true);
    return null;
  }
  // Members: identifiers at depth 1 that directly follow `{` or `,`.
  const members: string[] = [];
  let depth = 0;
  let prev: Token | null = null;
  let endTok = peek(state);
  while (!atEnd(state)) {
    const t = advance(state);
    endTok = t;
    if (t.type === "lbrace") depth += 1;
    else if (t.type === "rbrace") {
      depth -= 1;
      if (depth === 0) break;
    } else if (
      depth === 1 &&
      t.type === "identifier" &&
      prev !== null &&
      (prev.type === "lbrace" || prev.type === "comma")
    ) {
      members.push(t.text);
    }
    prev = t;
  }
  if (peek(state).type === "semicolon") advance(state);
  return { name: nameTok.text, baseType, members, range: rangeFromTo(startTok, endTok) };
}

// ── Member parser (method or field) ──────────────────────────────────────────

function parseMember(state: ParserState): MemberResult {
  const startTok = peek(state);
  const attrs = parseAttributes(state);
  if (peek(state).type === "rbrace" && attrs.length > 0) {
    // Dangling attribute before `}` — nothing to attach to.
    state.diagnostics.push({
      message: `attribute block is not followed by a declaration`,
      range: attrs[0].range,
    });
    return { kind: "skip" };
  }
  if (isKeyword(peek(state), "typedef")) {
    parseTypedef(state);
    return { kind: "skip" };
  }
  if (peek(state).type === "semicolon") {
    advance(state);
    return { kind: "skip" };
  }
  const modifiers = parseModifiers(state);
  return parseMemberAfterPrefix(state, startTok, attrs, modifiers, false);
}

function parseMemberAfterPrefix(
  state: ParserState,
  startTok: Token,
  attrs: AttributeNode[],
  modifiers: string[],
  topLevel: boolean,
): MemberResult {
  // Destructor without return type: `~Foo()`.
  if (isPunct(peek(state), "~") && peek(state, 1).type === "identifier" && peek(state, 2).type === "lparen") {
    advance(state); // ~
    const nameTok = advance(state);
    return {
      kind: "method",
      node: parseMethodAfterName(state, startTok, attrs, modifiers, "void", `~${nameTok.text}`, nameTok),
    };
  }

  const type = parseType(state);
  if (type === null) {
    state.diagnostics.push({
      message: `unrecognized ${topLevel ? "top-level" : "class-body"} construct starting at "${peek(state).text}"`,
      range: peek(state).range,
    });
    return null;
  }

  const t = peek(state);

  // `Foo(` — constructor-style declaration without a return type: the
  // thing we parsed as a type is really the name.
  if (t.type === "lparen") {
    const nameTok = prevToken(state);
    return {
      kind: "method",
      node: parseMethodAfterName(state, startTok, attrs, modifiers, "void", type, nameTok),
    };
  }

  // Destructor with explicit return type: `void ~Foo()`.
  if (isPunct(t, "~") && peek(state, 1).type === "identifier") {
    advance(state); // ~
    const nameTok = advance(state);
    return {
      kind: "method",
      node: parseMethodAfterName(state, startTok, attrs, modifiers, type, `~${nameTok.text}`, nameTok),
    };
  }

  // Operator overload: `bool operator==(Foo other)` — name is `operator` +
  // the punctuation up to `(`.
  if (t.type === "identifier" && t.text === "operator" && peek(state, 1).type !== "lparen") {
    const nameTok = advance(state);
    let name = "operator";
    while (!atEnd(state) && peek(state).type !== "lparen") {
      const p = peek(state);
      if (p.type === "punct" || p.type === "attribute_open" || p.type === "attribute_close") {
        name += advance(state).text;
      } else {
        break;
      }
    }
    return {
      kind: "method",
      node: parseMethodAfterName(state, startTok, attrs, modifiers, type, name, nameTok),
    };
  }

  if (t.type !== "identifier") {
    state.diagnostics.push({
      message: `expected declaration name after type "${type}", got ${t.type} "${t.text}"`,
      range: t.range,
    });
    return null;
  }

  const nameTok = advance(state);
  if (peek(state).type === "lparen") {
    return {
      kind: "method",
      node: parseMethodAfterName(state, startTok, attrs, modifiers, type, nameTok.text, nameTok),
    };
  }

  return { kind: "fields", nodes: parseFieldsAfterName(state, startTok, attrs, modifiers, type, nameTok) };
}

function parseMethodAfterName(
  state: ParserState,
  startTok: Token,
  attrs: AttributeNode[],
  modifiers: string[],
  returnType: string,
  name: string,
  nameTok: Token,
): MethodNode {
  expect(state, "lparen");
  const params: ParameterNode[] = [];
  while (!atEnd(state) && peek(state).type !== "rparen") {
    const p = parseParameter(state);
    if (p) params.push(p);
    if (peek(state).type === "comma") {
      advance(state);
      continue;
    }
    if (peek(state).type !== "rparen") {
      // parseParameter already reported; skip to the next separator.
      skipToParamBoundary(state);
      if (peek(state).type === "comma") {
        advance(state);
        continue;
      }
    }
    break;
  }
  expect(state, "rparen");

  // Method body: balanced braces, captured as opaque text, OR `;` for proto.
  let bodyText: string | null = null;
  if (peek(state).type === "semicolon") {
    advance(state);
  } else if (peek(state).type === "lbrace") {
    const open = advance(state); // {
    let depth = 1;
    const startOffset = open.range.start.offset;
    while (!atEnd(state) && depth > 0) {
      const t = advance(state);
      if (t.type === "lbrace") depth += 1;
      else if (t.type === "rbrace") {
        depth -= 1;
        if (depth === 0) {
          bodyText = state.source.slice(startOffset + 1, t.range.start.offset);
          break;
        }
      }
    }
  } else {
    state.diagnostics.push({
      message: `expected method body or ';' after ${name}(...), got ${peek(state).type} "${peek(state).text}"`,
      range: peek(state).range,
    });
  }
  const endRange = prevToken(state).range ?? nameTok.range;
  return {
    name,
    returnType,
    parameters: params,
    modifiers,
    attributes: attrs,
    bodyText,
    range: { start: startTok.range.start, end: endRange.end },
  };
}

/** Skip tokens until a top-depth `,` or `)` (does not consume it). */
function skipToParamBoundary(state: ParserState): void {
  let depth = 0;
  while (!atEnd(state)) {
    const t = peek(state);
    if (depth === 0 && (t.type === "comma" || t.type === "rparen")) return;
    if (t.type === "lparen" || t.type === "lbrace" || t.type === "attribute_open") depth += 1;
    else if (t.type === "rparen" || t.type === "rbrace" || t.type === "attribute_close") depth -= 1;
    if (t.type === "semicolon" && depth <= 0) return;
    advance(state);
  }
}

function parseParameter(state: ParserState): ParameterNode | null {
  const prefixes = parseModifiers(state); // ref / out / inout / notnull / autoptr / const ...
  const baseType = parseType(state);
  if (baseType === null) {
    state.diagnostics.push({
      message: `expected parameter type, got ${peek(state).type} "${peek(state).text}"`,
      range: peek(state).range,
    });
    return null;
  }
  const nameTok = peek(state);
  if (nameTok.type !== "identifier") {
    state.diagnostics.push({
      message: `expected parameter name after "${baseType}", got ${nameTok.type} "${nameTok.text}"`,
      range: nameTok.range,
    });
    return null;
  }
  advance(state);
  let type = [...prefixes, baseType].join(" ");
  // Static-array parameter: `int values[]`.
  if (peek(state).type === "attribute_open") type += consumeArraySuffix(state);

  let defaultValue: string | undefined;
  if (isPunct(peek(state), "=")) {
    advance(state); // =
    defaultValue = collectExpression(state, /* stopAtComma */ true, /* stopAtRparen */ true);
  }
  return { type, name: nameTok.text, defaultValue };
}

/** Consume `[...]` after a declarator name and return it as text (`[4]`, `[]`). */
function consumeArraySuffix(state: ParserState): string {
  let out = "";
  while (peek(state).type === "attribute_open") {
    out += advance(state).text;
    while (!atEnd(state) && peek(state).type !== "attribute_close" && peek(state).type !== "semicolon") {
      out += advance(state).text;
    }
    if (peek(state).type === "attribute_close") out += advance(state).text;
  }
  return out;
}

/**
 * Collect an expression's tokens (initializer / default value) up to a
 * depth-0 terminator. Parens, braces, brackets AND angle brackets nest —
 * so `new map<string, int>()` doesn't split on its comma.
 */
function collectExpression(state: ParserState, stopAtComma: boolean, stopAtRparen: boolean): string {
  const out: Token[] = [];
  let depth = 0;
  let angle = 0;
  while (!atEnd(state)) {
    const t = peek(state);
    if (depth === 0 && angle === 0) {
      if (t.type === "semicolon") break;
      if (stopAtComma && t.type === "comma") break;
      if (stopAtRparen && t.type === "rparen") break;
    }
    if (t.type === "lparen" || t.type === "lbrace" || t.type === "attribute_open") depth += 1;
    else if (t.type === "rparen" || t.type === "rbrace" || t.type === "attribute_close") {
      depth -= 1;
      if (depth < 0) break; // unbalanced close — belongs to the enclosing construct
    } else if (isPunct(t, "<")) angle += 1;
    else if (isPunct(t, ">") && angle > 0) angle -= 1;
    else if (t.type === "semicolon" && depth > 0) {
      // A `;` inside braces is not an initializer — bail out to the declaration.
      break;
    }
    out.push(advance(state));
  }
  return out.map((t) => t.text).join(" ").trim();
}

function parseFieldsAfterName(
  state: ParserState,
  startTok: Token,
  attrs: AttributeNode[],
  modifiers: string[],
  type: string,
  firstNameTok: Token,
): FieldNode[] {
  const out: FieldNode[] = [];
  let nameTok: Token | null = firstNameTok;
  let declStart = startTok;
  while (nameTok !== null) {
    let fieldType = type;
    if (peek(state).type === "attribute_open") fieldType += consumeArraySuffix(state);
    let initializer: string | null = null;
    if (isPunct(peek(state), "=")) {
      advance(state); // =
      initializer = collectExpression(state, /* stopAtComma */ true, /* stopAtRparen */ false);
    }
    const last = prevToken(state);
    out.push({
      name: nameTok.text,
      type: fieldType,
      modifiers,
      attributes: attrs,
      initializer,
      range: { start: declStart.range.start, end: last.range.end },
    });
    if (peek(state).type === "comma") {
      advance(state);
      const next = peek(state);
      if (next.type !== "identifier") {
        state.diagnostics.push({
          message: `expected declarator after ',' in field list, got ${next.type} "${next.text}"`,
          range: next.range,
        });
        break;
      }
      declStart = next;
      nameTok = advance(state);
      continue;
    }
    nameTok = null;
  }
  const endTok = expect(state, "semicolon") ?? prevToken(state);
  if (out.length > 0) out[out.length - 1].range.end = endTok.range.end;
  return out;
}
