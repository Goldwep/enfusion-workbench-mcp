/**
 * `script_analyze` — parse an Enforce Script `.c` file and emit a
 * structured summary (L6-3, first script tool).
 *
 * Thin wrapper over the L6-1/L6-2 mini-parser. Returns the AST
 * highlights as readable markdown: class names + kinds, base classes,
 * method signatures with attributes, field declarations.
 *
 * Pure FS read + parser; no DB.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFileSync, existsSync } from "node:fs";
import { resolve, basename } from "node:path";
import { z } from "zod";
import { parseScript, formatParseDiagnostics, isFatalParse } from "../script-parser/index.js";
import type { ScriptAst, ClassNode } from "../script-parser/ast.js";

// ── Formatter ────────────────────────────────────────────────────────────────

export function formatScriptSummary(input: {
  filePath: string;
  ast: ScriptAst;
}): string {
  const { filePath, ast } = input;
  const lines: string[] = [];
  lines.push(`## script_analyze: ${basename(filePath)}`);
  lines.push("");
  if (ast.classes.length === 0) {
    lines.push("(no class declarations found)");
    const diag = formatParseDiagnostics(ast);
    if (diag.length > 0) {
      lines.push("");
      lines.push(...diag);
    }
    return lines.join("\n");
  }
  lines.push(
    `Found ${ast.classes.length} class${ast.classes.length !== 1 ? "es" : ""}, ${countMethods(ast)} method${countMethods(ast) !== 1 ? "s" : ""}, ${countFields(ast)} field${countFields(ast) !== 1 ? "s" : ""}.`,
  );
  const diag = formatParseDiagnostics(ast);
  if (diag.length > 0) {
    lines.push("");
    lines.push(...diag);
  }
  lines.push("");

  for (const cls of ast.classes) {
    lines.push(formatClass(cls));
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

function formatClass(cls: ClassNode): string {
  const lines: string[] = [];
  const kindLabel = cls.kind === "modded_class" ? "modded class" : "class";
  const base = cls.baseClass ? ` : ${cls.baseClass}` : "";
  lines.push(`### ${kindLabel} ${cls.name}${base}`);
  lines.push(`*${cls.range.start.line}–${cls.range.end.line}, ${cls.methods.length} methods, ${cls.fields.length} fields*`);
  if (cls.attributes.length > 0) {
    lines.push(`Attributes: ${cls.attributes.map((a) => formatAttr(a)).join(", ")}`);
  }
  if (cls.methods.length > 0) {
    lines.push("");
    lines.push("**Methods**");
    for (const m of cls.methods) {
      const attrs = m.attributes.length > 0 ? m.attributes.map((a) => `[${formatAttr(a)}]`).join(" ") + " " : "";
      const modifiers = m.modifiers.length > 0 ? m.modifiers.join(" ") + " " : "";
      const params = m.parameters
        .map((p) => `${p.type} ${p.name}${p.defaultValue !== undefined ? ` = ${p.defaultValue}` : ""}`)
        .join(", ");
      const body = m.bodyText === null ? " (proto)" : "";
      lines.push(`  - ${attrs}${modifiers}${m.returnType} **${m.name}**(${params})${body}`);
    }
  }
  if (cls.fields.length > 0) {
    lines.push("");
    lines.push("**Fields**");
    for (const f of cls.fields) {
      const attrs = f.attributes.length > 0 ? f.attributes.map((a) => `[${formatAttr(a)}]`).join(" ") + " " : "";
      const modifiers = f.modifiers.length > 0 ? f.modifiers.join(" ") + " " : "";
      const init = f.initializer !== null ? ` = ${f.initializer}` : "";
      lines.push(`  - ${attrs}${modifiers}${f.type} **${f.name}**${init}`);
    }
  }
  return lines.join("\n");
}

function formatAttr(a: { name: string; args: string }): string {
  return a.args ? `${a.name}(${a.args})` : a.name;
}

function countMethods(ast: ScriptAst): number {
  return ast.classes.reduce((n, c) => n + c.methods.length, 0);
}
function countFields(ast: ScriptAst): number {
  return ast.classes.reduce((n, c) => n + c.fields.length, 0);
}

// ── Registration ─────────────────────────────────────────────────────────────

export function registerScriptAnalyze(server: McpServer): void {
  server.registerTool(
    "script_analyze",
    {
      description:
        "Parse an Enforce Script `.c` file and emit a structured summary — class declarations (including `modded class`), inheritance, method signatures with attributes (e.g. [RPC], [RplProp]), and fields. " +
        "Pure FS read; no Workbench connection. Method body content is not parsed — only the structural surface. " +
        "Foundation tool for `script_overrides`, `script_lint`, `script_class_hierarchy`, `script_find_rpc_handlers`.",
      inputSchema: {
        script_path: z
          .string()
          .describe("Path to the .c file (absolute or repo-relative)"),
      },
    },
    async ({ script_path }) => {
      try {
        if (script_path.startsWith("-")) {
          return {
            content: [
              { type: "text" as const, text: "Invalid script_path: must not start with '-'" },
            ],
            isError: true,
          };
        }
        const fullPath = resolve(script_path);
        if (!existsSync(fullPath)) {
          return {
            content: [
              { type: "text" as const, text: `Script file not found: ${fullPath}` },
            ],
            isError: true,
          };
        }
        const source = readFileSync(fullPath, "utf-8");
        const ast = parseScript(source, fullPath);
        const text = formatScriptSummary({ filePath: fullPath, ast });
        return {
          content: [{ type: "text" as const, text }],
          ...(isFatalParse(ast) ? { isError: true } : {}),
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [{ type: "text" as const, text: `Error analyzing script: ${msg}` }],
          isError: true,
        };
      }
    },
  );
}
