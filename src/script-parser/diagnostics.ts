/**
 * Shared rendering for parser diagnostics (audit H13).
 *
 * Every tool that consumes a `ScriptAst` must surface `ast.diagnostics`
 * so a mangled AST never masquerades as a clean read. Two shapes:
 *
 *   - single-file tools (lint / analyze / extract_interface) render the
 *     diagnostic list via `formatParseDiagnostics`;
 *   - project walkers (class_hierarchy / overrides / find_rpc_handlers)
 *     collect one `ParseIssue` per file with problems and render them via
 *     `formatParseIssues`.
 *
 * `isFatalParse` is the isError threshold: the parser recovered nothing.
 */

import type { ScriptAst } from "./ast.js";

export const PARSE_DIAGNOSTICS_HEADING = "Parse diagnostics";

/** True when the parser reported problems AND recovered zero classes. */
export function isFatalParse(ast: ScriptAst): boolean {
  return ast.diagnostics.length > 0 && ast.classes.length === 0;
}

/** Render `ast.diagnostics` as a report section. Empty array when there are none. */
export function formatParseDiagnostics(ast: ScriptAst, limit = 25): string[] {
  const n = ast.diagnostics.length;
  if (n === 0) return [];
  const lines: string[] = [];
  lines.push(`### ${PARSE_DIAGNOSTICS_HEADING} (${n})`);
  lines.push(
    `⚠ The parser hit ${n} problem${n !== 1 ? "s" : ""} in this file — extracted structure may be incomplete or wrong. Verify before trusting.`,
  );
  for (const d of ast.diagnostics.slice(0, limit)) {
    lines.push(`- L${d.range.start.line}:${d.range.start.column} ${d.message}`);
  }
  if (n > limit) lines.push(`- ... and ${n - limit} more`);
  return lines;
}

export interface ParseIssue {
  /** Project-relative path (forward slashes). */
  relPath: string;
  /** Number of diagnostics in that file. */
  count: number;
  /** First diagnostic, `L<line>:<col> message`. */
  first: string;
  /** Parser recovered zero classes from the file. */
  fatal: boolean;
}

/** Build a `ParseIssue` for a file, or null when the AST is clean. */
export function parseIssueFor(ast: ScriptAst, relPath: string): ParseIssue | null {
  if (ast.diagnostics.length === 0) return null;
  const d = ast.diagnostics[0];
  return {
    relPath,
    count: ast.diagnostics.length,
    first: `L${d.range.start.line}:${d.range.start.column} ${d.message}`,
    fatal: isFatalParse(ast),
  };
}

/** Render per-file parse issues collected by a project walker. Empty when none. */
export function formatParseIssues(issues: ParseIssue[], limit = 25): string[] {
  if (issues.length === 0) return [];
  const total = issues.reduce((a, i) => a + i.count, 0);
  const lines: string[] = [];
  lines.push(`### ${PARSE_DIAGNOSTICS_HEADING} (${total} in ${issues.length} file${issues.length !== 1 ? "s" : ""})`);
  lines.push(
    "⚠ These files did not parse cleanly — classes/methods/fields from them may be missing or wrong in the results above.",
  );
  for (const i of issues.slice(0, limit)) {
    lines.push(`- ${i.relPath}: ${i.count} diagnostic${i.count !== 1 ? "s" : ""}${i.fatal ? " (no classes recovered)" : ""} — first: ${i.first}`);
  }
  if (issues.length > limit) lines.push(`- ... and ${issues.length - limit} more files`);
  return lines;
}
