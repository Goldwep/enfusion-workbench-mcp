/**
 * `script_extract_interface` — emit a class's public-facing surface as
 * readable markdown (L6-8).
 *
 * Pure AST query — filters methods + fields by NOT being `protected` or
 * `private`. Output is the kind of API doc you'd hand off to another
 * modder collaborating on the same project.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFileSync, existsSync } from "node:fs";
import { resolve, basename } from "node:path";
import { z } from "zod";
import { parseScript, formatParseDiagnostics, isFatalParse } from "../script-parser/index.js";
import type { ScriptAst } from "../script-parser/ast.js";
import type { ClassNode } from "../script-parser/ast.js";

const HIDDEN_MODIFIERS = new Set<string>(["protected", "private"]);

function isPublic(modifiers: string[]): boolean {
  for (const m of modifiers) if (HIDDEN_MODIFIERS.has(m)) return false;
  return true;
}

// ── Formatter ────────────────────────────────────────────────────────────────

export function formatInterface(input: {
  filePath: string;
  classes: ClassNode[];
  className?: string;
  /** Pass the AST so parser diagnostics are surfaced (audit H13). */
  ast?: ScriptAst;
}): string {
  const { filePath, classes, className, ast } = input;
  const targetClasses = className
    ? classes.filter((c) => c.name === className)
    : classes;

  const lines: string[] = [];
  lines.push(`## Public interface: ${basename(filePath)}`);
  lines.push("");
  if (ast) {
    const diag = formatParseDiagnostics(ast);
    if (diag.length > 0) {
      lines.push(...diag);
      lines.push("");
    }
  }
  if (targetClasses.length === 0) {
    if (className) {
      lines.push(`No class \`${className}\` in this file.`);
    } else {
      lines.push("No classes found.");
    }
    return lines.join("\n");
  }

  for (const cls of targetClasses) {
    const kindLabel = cls.kind === "modded_class" ? "modded class" : "class";
    const base = cls.baseClass ? ` : ${cls.baseClass}` : "";
    lines.push(`### \`${kindLabel} ${cls.name}${base}\``);
    lines.push("");

    const publicMethods = cls.methods.filter((m) => isPublic(m.modifiers));
    const publicFields = cls.fields.filter((f) => isPublic(f.modifiers));

    if (publicMethods.length === 0 && publicFields.length === 0) {
      lines.push("*(no public surface — class is entirely private/protected)*");
      lines.push("");
      continue;
    }

    if (publicMethods.length > 0) {
      lines.push("**Methods**");
      lines.push("");
      lines.push("```enfusion");
      for (const m of publicMethods) {
        const params = m.parameters
          .map((p) => `${p.type} ${p.name}${p.defaultValue !== undefined ? ` = ${p.defaultValue}` : ""}`)
          .join(", ");
        const modifiers = m.modifiers.length > 0 ? m.modifiers.join(" ") + " " : "";
        lines.push(`${modifiers}${m.returnType} ${m.name}(${params});`);
      }
      lines.push("```");
      lines.push("");
    }

    if (publicFields.length > 0) {
      lines.push("**Fields**");
      lines.push("");
      lines.push("```enfusion");
      for (const f of publicFields) {
        const modifiers = f.modifiers.length > 0 ? f.modifiers.join(" ") + " " : "";
        lines.push(`${modifiers}${f.type} ${f.name};`);
      }
      lines.push("```");
      lines.push("");
    }
  }
  return lines.join("\n").trimEnd();
}

// ── Registration ─────────────────────────────────────────────────────────────

export function registerScriptExtractInterface(server: McpServer): void {
  server.registerTool(
    "script_extract_interface",
    {
      description:
        "Emit the public-facing surface of a class as readable markdown. " +
        "Filters out `protected` and `private` methods/fields. " +
        "Use for handoff docs, API audits, or feeding the public surface back to an LLM as compact context.",
      inputSchema: {
        script_path: z
          .string()
          .describe("Path to the .c file (absolute or repo-relative)"),
        class_name: z
          .string()
          .optional()
          .describe("Optional — restrict output to a specific class. Default: all classes in the file."),
      },
    },
    async ({ script_path, class_name }) => {
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
        const ast = parseScript(source, fullPath);
        const text = formatInterface({
          filePath: fullPath,
          classes: ast.classes,
          className: class_name,
          ast,
        });
        return {
          content: [{ type: "text" as const, text }],
          ...(isFatalParse(ast) ? { isError: true } : {}),
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [{ type: "text" as const, text: `Error extracting interface: ${msg}` }],
          isError: true,
        };
      }
    },
  );
}
