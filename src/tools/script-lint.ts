/**
 * `script_lint` — static analysis for Enforce Script files (L6-5).
 *
 * v1 rules — ported from BI's `SCR_BasicCodeFormatterPlugin` plus a
 * few modding-specific extras. Pure regex + L6-2 parser; no expression
 * evaluation.
 *
 * Rules shipped:
 *   - trailing_whitespace  — lines with trailing spaces/tabs
 *   - indent_mixed         — file mixes tab and space indentation
 *   - if_paren_spacing     — `if (`/`while (`/`for (` should not have
 *                            a space between keyword and `(`
 *   - missing_super_modded — `modded class Foo` methods that don't
 *                            invoke `super.<methodName>(...)` at all
 *   - rpc_missing_channel  — `[RPC]` with empty args (no channel/
 *                            reliability specified)
 *
 * The full BI plugin has more rules; this v1 ships the highest-signal
 * subset. Extending the rule set is a matter of adding entries to the
 * `RULES` table — each rule is a pure function over the source +
 * parsed AST.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFileSync, existsSync } from "node:fs";
import { resolve, basename } from "node:path";
import { z } from "zod";
import { parseScript, formatParseDiagnostics, isFatalParse } from "../script-parser/index.js";
import type { ScriptAst } from "../script-parser/ast.js";

export interface LintFinding {
  rule: string;
  severity: "error" | "warning" | "info";
  line: number;
  message: string;
}

// ── Rule implementations ─────────────────────────────────────────────────────

function ruleTrailingWhitespace(source: string): LintFinding[] {
  const out: LintFinding[] = [];
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (/[ \t]+$/.test(lines[i])) {
      out.push({
        rule: "trailing_whitespace",
        severity: "warning",
        line: i + 1,
        message: "Line has trailing whitespace.",
      });
    }
  }
  return out;
}

function ruleIndentMixed(source: string): LintFinding[] {
  const lines = source.split(/\r?\n/);
  let sawTab = false;
  let sawSpace = false;
  let firstTabLine = 0;
  let firstSpaceLine = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^[ \t]+/);
    if (!m) continue;
    if (m[0].includes("\t") && !sawTab) {
      sawTab = true;
      firstTabLine = i + 1;
    }
    if (m[0].includes(" ") && !sawSpace) {
      sawSpace = true;
      firstSpaceLine = i + 1;
    }
  }
  if (sawTab && sawSpace) {
    return [
      {
        rule: "indent_mixed",
        severity: "warning",
        line: Math.min(firstTabLine, firstSpaceLine),
        message: `File mixes tab and space indentation (first tab line ${firstTabLine}, first space line ${firstSpaceLine}). Pick one.`,
      },
    ];
  }
  return [];
}

function ruleIfParenSpacing(source: string): LintFinding[] {
  const out: LintFinding[] = [];
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    // Match `if (` / `while (` / `for (` / `switch (` with a space between
    // keyword and paren. Tolerant of leading whitespace.
    if (/\b(?:if|while|for|switch)\s+\(/.test(lines[i])) {
      out.push({
        rule: "if_paren_spacing",
        severity: "info",
        line: i + 1,
        message: "Control-flow keyword has a space before `(` — BI style is `if(...)` not `if (...)`.",
      });
    }
  }
  return out;
}

function ruleMissingSuperModded(ast: ScriptAst): LintFinding[] {
  const out: LintFinding[] = [];
  for (const cls of ast.classes) {
    if (cls.kind !== "modded_class") continue;
    for (const m of cls.methods) {
      if (!m.bodyText) continue; // proto methods don't have a body
      const expected = `super.${m.name}`;
      if (!m.bodyText.includes(expected)) {
        out.push({
          rule: "missing_super_modded",
          severity: "warning",
          line: m.range.start.line,
          message: `modded class ${cls.name}.${m.name}() does not call super.${m.name}(...) — may unintentionally short-circuit the base implementation.`,
        });
      }
    }
  }
  return out;
}

function ruleRpcMissingChannel(ast: ScriptAst): LintFinding[] {
  const out: LintFinding[] = [];
  for (const cls of ast.classes) {
    for (const m of cls.methods) {
      const rpcAttrs = m.attributes.filter((a) => a.name === "RPC");
      for (const a of rpcAttrs) {
        if (!a.args || a.args.trim().length === 0) {
          out.push({
            rule: "rpc_missing_channel",
            severity: "warning",
            line: m.range.start.line,
            message: `${cls.name}.${m.name}() has [RPC] with no channel/reliability args. Common shapes: [RPC(RplChannel.Reliable, RplRcver.Server)].`,
          });
        }
      }
    }
  }
  return out;
}

// ── Engine ───────────────────────────────────────────────────────────────────

export interface LintReport {
  filePath: string;
  findings: LintFinding[];
  rulesRun: string[];
  /** Parser diagnostics (audit H13) — non-empty means AST-based rules may have missed cases. */
  parseDiagnostics: ScriptAst["diagnostics"];
  /** Parser recovered zero classes despite reporting problems — the report is not trustworthy. */
  fatalParse: boolean;
  /** Retained for formatting the diagnostics section. */
  ast: ScriptAst;
}

const ALL_RULES = [
  "trailing_whitespace",
  "indent_mixed",
  "if_paren_spacing",
  "missing_super_modded",
  "rpc_missing_channel",
] as const;

export function lintScript(
  source: string,
  filePath: string,
  rules?: string[],
): LintReport {
  const ast = parseScript(source, filePath);
  const enabled = new Set<string>(rules ?? ALL_RULES);
  const findings: LintFinding[] = [];
  if (enabled.has("trailing_whitespace")) findings.push(...ruleTrailingWhitespace(source));
  if (enabled.has("indent_mixed")) findings.push(...ruleIndentMixed(source));
  if (enabled.has("if_paren_spacing")) findings.push(...ruleIfParenSpacing(source));
  if (enabled.has("missing_super_modded")) findings.push(...ruleMissingSuperModded(ast));
  if (enabled.has("rpc_missing_channel")) findings.push(...ruleRpcMissingChannel(ast));
  // Sort by line, then rule for deterministic output.
  findings.sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule));
  return {
    filePath,
    findings,
    rulesRun: [...enabled],
    parseDiagnostics: ast.diagnostics,
    fatalParse: isFatalParse(ast),
    ast,
  };
}

// ── Formatter ────────────────────────────────────────────────────────────────

export function formatLintReport(report: LintReport): string {
  const lines: string[] = [];
  lines.push(`## script_lint: ${basename(report.filePath)}`);
  lines.push("");
  const errors = report.findings.filter((f) => f.severity === "error");
  const warnings = report.findings.filter((f) => f.severity === "warning");
  const infos = report.findings.filter((f) => f.severity === "info");
  lines.push(
    `${errors.length} error${errors.length !== 1 ? "s" : ""}, ${warnings.length} warning${warnings.length !== 1 ? "s" : ""}, ${infos.length} info${infos.length !== 1 ? "s" : ""}.`,
  );
  lines.push(`Rules run: ${report.rulesRun.join(", ")}`);
  lines.push("");
  const diagLines = formatParseDiagnostics(report.ast);
  if (diagLines.length > 0) {
    if (report.fatalParse) {
      lines.push("❌ Fatal parse: the parser recovered no class declarations from this file. Lint results below are unreliable.");
    }
    lines.push(...diagLines);
    lines.push("");
  }
  if (report.findings.length === 0) {
    if (diagLines.length > 0) {
      lines.push(
        "No lint findings — but parse diagnostics above mean AST-based rules (missing_super_modded, rpc_missing_channel) may have skipped members.",
      );
    } else {
      lines.push("✅ Clean. No findings.");
    }
    return lines.join("\n");
  }
  if (diagLines.length > 0) lines.push("### Findings");
  for (const f of report.findings) {
    const label = f.severity === "error" ? "[E]" : f.severity === "warning" ? "[W]" : "[i]";
    lines.push(`${label} L${f.line} (${f.rule}): ${f.message}`);
  }
  return lines.join("\n");
}

// ── Registration ─────────────────────────────────────────────────────────────

export function registerScriptLint(server: McpServer): void {
  server.registerTool(
    "script_lint",
    {
      description:
        "Static analysis on an Enforce Script `.c` file. v1 rules: trailing_whitespace, indent_mixed, if_paren_spacing, missing_super_modded, rpc_missing_channel. " +
        "Ported from BI's Basic Code Formatter Plugin + modding-specific extras. " +
        "Pass `rules` to enable only a subset (e.g. `[\"missing_super_modded\"]`).",
      inputSchema: {
        script_path: z
          .string()
          .describe("Path to the .c file (absolute or repo-relative)"),
        rules: z
          .array(z.string())
          .optional()
          .describe(
            "Subset of rule names to run. Default: all 5. Available: trailing_whitespace / indent_mixed / if_paren_spacing / missing_super_modded / rpc_missing_channel.",
          ),
      },
    },
    async ({ script_path, rules }) => {
      try {
        if (script_path.startsWith("-")) {
          return {
            content: [{ type: "text" as const, text: "Invalid script_path: must not start with '-'" }],
            isError: true,
          };
        }
        const fullPath = resolve(script_path);
        if (!existsSync(fullPath)) {
          return {
            content: [{ type: "text" as const, text: `Script file not found: ${fullPath}` }],
            isError: true,
          };
        }
        const source = readFileSync(fullPath, "utf-8");
        const report = lintScript(source, fullPath, rules);
        return {
          content: [{ type: "text" as const, text: formatLintReport(report) }],
          ...(report.fatalParse ? { isError: true } : {}),
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [{ type: "text" as const, text: `Error linting script: ${msg}` }],
          isError: true,
        };
      }
    },
  );
}
