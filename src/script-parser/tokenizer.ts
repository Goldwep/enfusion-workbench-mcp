/**
 * Enforce Script tokenizer (L6 lexer).
 *
 * Hand-rolled scanner — no regex engine. Single-pass, position-tracking.
 * Emits a flat token stream that the parser walks for class/method/
 * field/attribute extraction.
 *
 * Comments are emitted as tokens (rather than swallowed) so the parser
 * can preserve doc-comments above declarations, and tools like
 * `script_format` can reconstruct the source.
 */

import {
  ENFORCE_KEYWORDS,
  type Token,
  type TokenType,
  type SourcePos,
  type SourceRange,
} from "./ast.js";

interface ScannerState {
  source: string;
  offset: number;
  line: number;
  column: number;
}

function makePos(state: ScannerState): SourcePos {
  return { line: state.line, column: state.column, offset: state.offset };
}

function advance(state: ScannerState): string {
  const ch = state.source.charAt(state.offset);
  state.offset += 1;
  if (ch === "\n") {
    state.line += 1;
    state.column = 1;
  } else {
    state.column += 1;
  }
  return ch;
}

function peek(state: ScannerState, lookahead = 0): string {
  return state.source.charAt(state.offset + lookahead);
}

function isAtEnd(state: ScannerState): boolean {
  return state.offset >= state.source.length;
}

function isIdentStart(ch: string): boolean {
  return /[A-Za-z_]/.test(ch);
}
function isIdentBody(ch: string): boolean {
  return /[A-Za-z0-9_]/.test(ch);
}
function isDigit(ch: string): boolean {
  return /[0-9]/.test(ch);
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Tokenize an Enforce Script source string. Always succeeds — invalid
 * characters become a one-char `punct` token so the parser can decide
 * how to recover.
 */
export function tokenize(source: string): Token[] {
  const state: ScannerState = { source, offset: 0, line: 1, column: 1 };
  const tokens: Token[] = [];

  while (!isAtEnd(state)) {
    const ch = peek(state);

    // Whitespace
    if (/\s/.test(ch)) {
      advance(state);
      continue;
    }
    // Line comment
    if (ch === "/" && peek(state, 1) === "/") {
      tokens.push(readLineComment(state));
      continue;
    }
    // Block comment
    if (ch === "/" && peek(state, 1) === "*") {
      tokens.push(readBlockComment(state));
      continue;
    }
    // Preprocessor directive — `#ifdef`, `#define`, `#endif`, `#include`...
    // One token spanning to end of line; stripped by `withoutTrivia` so the
    // parser never sees `#` inside a class body (audit H12).
    if (ch === "#") {
      tokens.push(readPreprocessor(state));
      continue;
    }
    // String
    if (ch === '"') {
      tokens.push(readString(state));
      continue;
    }
    // Number — digit-leading only. A leading `-` is ALWAYS the unary minus
    // operator (audit-fix L6 C9). Lexing `-5` as a negative literal corrupted
    // initializer / default-parameter text in the AST (`x = a - 5` became
    // `a -5` after .join(" ") round-trip), so we treat `-` purely as punct.
    if (isDigit(ch)) {
      tokens.push(readNumber(state));
      continue;
    }
    // Identifier / keyword
    if (isIdentStart(ch)) {
      tokens.push(readIdentifier(state));
      continue;
    }
    // Multi-char operators FIRST (==, !=, <=, >=, &&, ||, ::) — otherwise
    // the single-char `:` case below would eat the first colon of `::`.
    const two = ch + peek(state, 1);
    if (["==", "!=", "<=", ">=", "&&", "||", "::"].includes(two)) {
      const start = makePos(state);
      advance(state);
      advance(state);
      tokens.push({ type: "punct", text: two, range: { start, end: makePos(state) } });
      continue;
    }
    // Single-char structural punctuation.
    const punctType = punctTypeFor(ch);
    if (punctType !== null) {
      const start = makePos(state);
      advance(state);
      tokens.push({ type: punctType, text: ch, range: { start, end: makePos(state) } });
      continue;
    }
    // Single-char operators / unknown — emit as `punct`.
    const startU = makePos(state);
    advance(state);
    tokens.push({ type: "punct", text: ch, range: { start: startU, end: makePos(state) } });
  }

  tokens.push({
    type: "eof",
    text: "",
    range: { start: makePos(state), end: makePos(state) },
  });
  return tokens;
}

function punctTypeFor(ch: string): TokenType | null {
  switch (ch) {
    case "{":
      return "lbrace";
    case "}":
      return "rbrace";
    case "(":
      return "lparen";
    case ")":
      return "rparen";
    case "[":
      return "attribute_open";
    case "]":
      return "attribute_close";
    case ";":
      return "semicolon";
    case ",":
      return "comma";
    case ":":
      return "colon";
    default:
      return null;
  }
}

// ── Sub-readers ──────────────────────────────────────────────────────────────

function readLineComment(state: ScannerState): Token {
  const start = makePos(state);
  let text = "";
  while (!isAtEnd(state) && peek(state) !== "\n") {
    text += advance(state);
  }
  return { type: "comment_line", text, range: { start, end: makePos(state) } };
}

function readPreprocessor(state: ScannerState): Token {
  const start = makePos(state);
  let text = "";
  while (!isAtEnd(state) && peek(state) !== "\n") {
    text += advance(state);
  }
  return { type: "preprocessor", text: text.replace(/\r$/, ""), range: { start, end: makePos(state) } };
}

function readBlockComment(state: ScannerState): Token {
  const start = makePos(state);
  let text = "";
  // Eat the opening `/*`.
  text += advance(state);
  text += advance(state);
  while (!isAtEnd(state)) {
    if (peek(state) === "*" && peek(state, 1) === "/") {
      text += advance(state);
      text += advance(state);
      break;
    }
    text += advance(state);
  }
  return { type: "comment_block", text, range: { start, end: makePos(state) } };
}

function readString(state: ScannerState): Token {
  const start = makePos(state);
  let text = advance(state); // opening quote
  let value = "";
  while (!isAtEnd(state) && peek(state) !== '"') {
    const ch = peek(state);
    if (ch === "\\") {
      // Escape sequence — preserve text but decode value.
      text += advance(state);
      const next = advance(state);
      text += next;
      switch (next) {
        case "n":
          value += "\n";
          break;
        case "t":
          value += "\t";
          break;
        case "r":
          value += "\r";
          break;
        case '"':
          value += '"';
          break;
        case "\\":
          value += "\\";
          break;
        default:
          value += next;
      }
      continue;
    }
    if (ch === "\n") {
      // Unterminated string — emit what we have.
      break;
    }
    text += advance(state);
    value += ch;
  }
  if (!isAtEnd(state) && peek(state) === '"') {
    text += advance(state); // closing quote
  }
  return {
    type: "string",
    text,
    value,
    range: { start, end: makePos(state) },
  };
}

function readNumber(state: ScannerState): Token {
  const start = makePos(state);
  let text = "";
  while (!isAtEnd(state) && isDigit(peek(state))) {
    text += advance(state);
  }
  if (peek(state) === "." && isDigit(peek(state, 1))) {
    text += advance(state);
    while (!isAtEnd(state) && isDigit(peek(state))) {
      text += advance(state);
    }
  }
  // Optional `f` / `F` suffix for float literals.
  if (peek(state) === "f" || peek(state) === "F") {
    text += advance(state);
  }
  return { type: "number", text, range: { start, end: makePos(state) } };
}

function readIdentifier(state: ScannerState): Token {
  const start = makePos(state);
  let text = "";
  while (!isAtEnd(state) && isIdentBody(peek(state))) {
    text += advance(state);
  }
  const type: TokenType = ENFORCE_KEYWORDS.has(text) ? "keyword" : "identifier";
  return { type, text, range: { start, end: makePos(state) } };
}

// ── Convenience: stream-filter ───────────────────────────────────────────────

/**
 * Filter out whitespace + comment tokens for parser convenience. The
 * comment tokens are kept by the raw tokenizer so doc-attachment passes
 * can find them; this helper strips them for the structural walk.
 */
export function withoutTrivia(tokens: Token[]): Token[] {
  return tokens.filter(
    (t) =>
      t.type !== "comment_line" &&
      t.type !== "comment_block" &&
      t.type !== "preprocessor",
  );
}

void ({} as SourceRange);
