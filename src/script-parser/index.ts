/**
 * Enforce Script mini-parser — public API.
 *
 * Re-exports the entry points + types so consumers import from one
 * place: `import { parseScript, type ScriptAst } from "../script-parser/index.js"`.
 */

export { tokenize, withoutTrivia } from "./tokenizer.js";
export { parseScript } from "./parser.js";
export {
  formatParseDiagnostics,
  formatParseIssues,
  isFatalParse,
  parseIssueFor,
  PARSE_DIAGNOSTICS_HEADING,
  type ParseIssue,
} from "./diagnostics.js";
export type {
  AttributeNode,
  ClassKind,
  ClassNode,
  EnumNode,
  FieldNode,
  MethodNode,
  ParameterNode,
  ScriptAst,
  SourcePos,
  SourceRange,
  Token,
  TokenType,
  TypedefNode,
} from "./ast.js";
