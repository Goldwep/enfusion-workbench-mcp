/**
 * Enforce Script AST type definitions (L6 mini-parser).
 *
 * v1 scope: enough to support `script_analyze`, `script_overrides`,
 * `script_lint`, `script_format`, `script_class_hierarchy`, and the
 * RPC/RplProp finders. Method-body expressions are NOT parsed — we
 * capture the body as opaque text so format/diff tools can still
 * round-trip without losing fidelity.
 */

// ── Source positions ────────────────────────────────────────────────────────

export interface SourcePos {
  /** 1-based line number. */
  line: number;
  /** 1-based column. */
  column: number;
  /** 0-based byte offset in the source text. */
  offset: number;
}

export interface SourceRange {
  start: SourcePos;
  end: SourcePos;
}

// ── Token types ──────────────────────────────────────────────────────────────

export type TokenType =
  | "keyword"
  | "identifier"
  | "string"
  | "number"
  | "punct"
  | "attribute_open" // [
  | "attribute_close" // ]
  | "lbrace"
  | "rbrace"
  | "lparen"
  | "rparen"
  | "semicolon"
  | "comma"
  | "colon"
  | "comment_line"
  | "comment_block"
  | "preprocessor" // `#ifdef X` / `#define` / `#endif` — one token per line, trivia
  | "eof";

export interface Token {
  type: TokenType;
  /** Raw lexeme. */
  text: string;
  /** Decoded value for string tokens (escape sequences resolved). */
  value?: string;
  range: SourceRange;
}

// ── Known keywords (v1 subset) ───────────────────────────────────────────────

/**
 * Enforce Script reserved words we lex as `keyword` (others stay
 * `identifier` even if the engine treats them specially — extraction
 * tools check by lexeme).
 */
export const ENFORCE_KEYWORDS = new Set<string>([
  "class",
  "modded",
  "extends",
  "void",
  "bool",
  "int",
  "float",
  "string",
  "vector",
  "array",
  "ref",
  "out",
  "inout",
  "auto",
  "static",
  "protected",
  "private",
  "override",
  "proto",
  "native",
  "return",
  "if",
  "else",
  "while",
  "for",
  "foreach",
  "switch",
  "case",
  "default",
  "break",
  "continue",
  "true",
  "false",
  "null",
  "new",
  "delete",
  "this",
  "super",
  "typename",
  "void",
  "enum",
  "typedef",
]);

// ── Declared symbol shapes ───────────────────────────────────────────────────

export type ClassKind = "class" | "modded_class";

export interface AttributeNode {
  /** Attribute identifier, e.g. "RPC", "RplProp", "Attribute". */
  name: string;
  /** Raw argument text inside the parens, e.g. `RplChannel.Reliable, RplRcver.Owner`.
   *  Not further parsed — string is preserved verbatim. */
  args: string;
  range: SourceRange;
}

export interface ParameterNode {
  /** Parameter type (may include `ref`/`out`/`inout` prefix). */
  type: string;
  name: string;
  /** Default-value text if present (`= 42`, `= "foo"`). */
  defaultValue?: string;
}

export interface MethodNode {
  name: string;
  returnType: string;
  parameters: ParameterNode[];
  /** Modifiers (static / override / protected / private / proto / native). */
  modifiers: string[];
  /** Attributes attached above the method (`[RPC(...)]`). */
  attributes: AttributeNode[];
  /** Method-body raw text, or null for abstract / proto declarations. */
  bodyText: string | null;
  range: SourceRange;
}

export interface FieldNode {
  name: string;
  type: string;
  /** Modifiers (static / protected / private). */
  modifiers: string[];
  attributes: AttributeNode[];
  /** Initializer expression text, if present. */
  initializer: string | null;
  range: SourceRange;
}

export interface TypedefNode {
  /** Alias being declared, e.g. `TStringIntMap`. */
  name: string;
  /** Aliased type text, e.g. `map<string, int>` or `func`. */
  type: string;
  range: SourceRange;
}

export interface EnumNode {
  name: string;
  /** Underlying/base enum for `enum EFoo : EBase`. */
  baseType: string | null;
  members: string[];
  range: SourceRange;
}

export interface ClassNode {
  kind: ClassKind;
  name: string;
  /** Class-level modifiers (`sealed`, `static`). */
  modifiers: string[];
  /** Template parameters for `class Tpl<Class T, Class U>` — raw text per param. */
  typeParameters: string[];
  /** Base class name for `class Foo : Bar`. Undefined for `modded class Foo`
   *  (which reopens an existing declaration). */
  baseClass: string | null;
  methods: MethodNode[];
  fields: FieldNode[];
  attributes: AttributeNode[];
  range: SourceRange;
}

export interface ScriptAst {
  /** Source file path (relative to project_root if known). */
  filePath: string;
  classes: ClassNode[];
  /** Top-level `typedef` declarations. */
  typedefs: TypedefNode[];
  /** Top-level `enum` declarations. */
  enums: EnumNode[];
  /** Global (non-member) functions, including bodiless prototypes. */
  functions: MethodNode[];
  /** Diagnostic messages from the parser (recoverable). */
  diagnostics: { message: string; range: SourceRange }[];
}
