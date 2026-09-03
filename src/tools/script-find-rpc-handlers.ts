/**
 * `script_find_rpc_handlers` — locate every method decorated with an
 * `[RPC(...)]` attribute across a project's `.c` files (L6-9).
 *
 * Network-code modders need to audit every entry point. This tool
 * surfaces them with their channel/reliability args + class context
 * so an LLM can suggest tightening (e.g. "this RPC accepts unauth'd
 * clients, consider checking permissions").
 *
 * Built on the L6-2 parser. Walks disk for `.c` files independently
 * of the project-index (same pattern as `script_overrides`).
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFileSync, statSync } from "node:fs";
import { resolve, relative } from "node:path";
import { z } from "zod";
import { parseScript, formatParseIssues, parseIssueFor, type ParseIssue } from "../script-parser/index.js";
import { findCFiles } from "./script-overrides.js";

interface RpcHit {
  className: string;
  methodName: string;
  returnType: string;
  attributes: string[];
  relPath: string;
  line: number;
  modifiers: string[];
}

// ── Core query ───────────────────────────────────────────────────────────────

export function findRpcHandlers(
  projectRoot: string,
  filter: { attributeName?: string } = {},
  /** Optional sink: one entry per file whose parse reported diagnostics (audit H13). */
  parseIssues?: ParseIssue[],
): RpcHit[] {
  const attrFilter = filter.attributeName ?? "RPC";
  const hits: RpcHit[] = [];
  const files = findCFiles(projectRoot);
  for (const abs of files) {
    let source: string;
    try {
      source = readFileSync(abs, "utf-8");
    } catch {
      continue;
    }
    // Quick reject — `[RPC` substring check before parsing.
    if (!source.includes(`[${attrFilter}`)) continue;
    let ast;
    try {
      ast = parseScript(source, abs);
    } catch {
      continue;
    }
    const issue = parseIssueFor(ast, relative(projectRoot, abs).split("\\").join("/"));
    if (issue && parseIssues) parseIssues.push(issue);
    for (const cls of ast.classes) {
      for (const m of cls.methods) {
        const matched = m.attributes.filter((a) => a.name === attrFilter);
        if (matched.length === 0) continue;
        hits.push({
          className: cls.name,
          methodName: m.name,
          returnType: m.returnType,
          attributes: matched.map((a) => (a.args ? `${a.name}(${a.args})` : a.name)),
          relPath: relative(projectRoot, abs).split("\\").join("/"),
          line: m.range.start.line,
          modifiers: m.modifiers,
        });
      }
    }
  }
  return hits.sort((a, b) => {
    if (a.className !== b.className) return a.className.localeCompare(b.className);
    return a.methodName.localeCompare(b.methodName);
  });
}

// ── Formatter ────────────────────────────────────────────────────────────────

export function formatRpcReport(input: {
  projectRoot: string;
  attributeName: string;
  hits: RpcHit[];
  filesScanned: number;
  parseIssues?: ParseIssue[];
}): string {
  const { projectRoot, attributeName, hits, filesScanned, parseIssues = [] } = input;
  const lines: string[] = [];
  lines.push(`## ${attributeName} handlers in ${projectRoot}`);
  lines.push("");
  lines.push(
    `Scanned ${filesScanned} .c file${filesScanned !== 1 ? "s" : ""}. Found ${hits.length} \`[${attributeName}]\`-decorated method${hits.length !== 1 ? "s" : ""}.`,
  );
  lines.push("");
  const issueLines = formatParseIssues(parseIssues);
  if (hits.length === 0) {
    lines.push(`(No ${attributeName} handlers found. Either the project has no network code, or the attribute name differs.)`);
    if (issueLines.length > 0) {
      lines.push("");
      lines.push(...issueLines);
    }
    return lines.join("\n");
  }
  for (const h of hits) {
    const modifiers = h.modifiers.length > 0 ? h.modifiers.join(" ") + " " : "";
    const attrs = h.attributes.map((a) => `[${a}]`).join(" ");
    lines.push(`- **${h.className}.${h.methodName}** — ${h.relPath}:${h.line}`);
    lines.push(`    ${attrs}`);
    lines.push(`    ${modifiers}${h.returnType} ${h.methodName}(...)`);
    lines.push("");
  }
  if (issueLines.length > 0) {
    lines.push(...issueLines);
  }
  return lines.join("\n").trimEnd();
}

// ── Registration ─────────────────────────────────────────────────────────────

export function registerScriptFindRpcHandlers(server: McpServer): void {
  server.registerTool(
    "script_find_rpc_handlers",
    {
      description:
        "Locate every method decorated with an `[RPC(...)]` attribute (or another custom attribute name) across a project's `.c` files. " +
        "Surfaces class context, method signature, and the attribute arguments (channel/reliability/etc). " +
        "Use to audit network-code entry points or to find every `[RplProp]`/`[Replicated]` field by passing the attribute name explicitly.",
      inputSchema: {
        project_root: z
          .string()
          .describe("Absolute path to the project to scan"),
        attribute_name: z
          .string()
          .optional()
          .default("RPC")
          .describe(
            "Which attribute to match. Defaults to 'RPC'. Use 'RplProp' to find replicated fields, 'Attribute' for editor attributes, etc.",
          ),
      },
    },
    async ({ project_root, attribute_name }) => {
      try {
        if (project_root.startsWith("-")) {
          return {
            content: [{ type: "text" as const, text: "Invalid project_root: must not start with '-'" }],
            isError: true,
          };
        }
        const rootAbs = resolve(project_root);
        let stat;
        try {
          stat = statSync(rootAbs);
        } catch {
          return {
            content: [{ type: "text" as const, text: `project_root not found: ${rootAbs}` }],
            isError: true,
          };
        }
        if (!stat.isDirectory()) {
          return {
            content: [{ type: "text" as const, text: `project_root is not a directory: ${rootAbs}` }],
            isError: true,
          };
        }
        const files = findCFiles(rootAbs);
        const parseIssues: ParseIssue[] = [];
        const hits = findRpcHandlers(rootAbs, { attributeName: attribute_name }, parseIssues);
        const text = formatRpcReport({
          projectRoot: rootAbs,
          attributeName: attribute_name ?? "RPC",
          hits,
          filesScanned: files.length,
          parseIssues,
        });
        return { content: [{ type: "text" as const, text }] };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [{ type: "text" as const, text: `Error finding RPC handlers: ${msg}` }],
          isError: true,
        };
      }
    },
  );
}
