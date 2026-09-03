/**
 * `script_overrides` — find every `modded class <name>` declaration across
 * a project's `.c` files (L6-4).
 *
 * Walks the project root recursively (independent of the project-index,
 * which doesn't currently track `.c` files), parses each `.c` via the
 * L6-1/L6-2 mini-parser, and reports every modded chain.
 *
 * Use case: refactor planning ("if I rename SCR_PlayerController, what
 * mods need to update?") and override-impact analysis.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { z } from "zod";
import { parseScript, formatParseIssues, parseIssueFor, type ParseIssue } from "../script-parser/index.js";
import type { ClassNode } from "../script-parser/ast.js";
import { logger } from "../utils/logger.js";

const SKIP_DIRS = new Set<string>(["node_modules", ".git", "dist"]);

interface ModdedHit {
  className: string;
  relPath: string;
  line: number;
  methodCount: number;
  fieldCount: number;
}

// ── Walker ───────────────────────────────────────────────────────────────────

export function findCFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      logger.debug(`[script_overrides] skip ${dir}: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue; // SEC-004 safety
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(abs);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".c")) {
        out.push(abs);
      }
    }
  };
  walk(root);
  return out;
}

// ── Core query ───────────────────────────────────────────────────────────────

export function findModdedChains(
  projectRoot: string,
  filter: { className?: string } = {},
  /** Optional sink: one entry per file whose parse reported diagnostics (audit H13). */
  parseIssues?: ParseIssue[],
): ModdedHit[] {
  const hits: ModdedHit[] = [];
  const files = findCFiles(projectRoot);
  for (const abs of files) {
    let source: string;
    try {
      source = readFileSync(abs, "utf-8");
    } catch {
      continue;
    }
    // Quick reject — if "modded" isn't in the file, parsing is wasted work.
    if (!/\bmodded\b/.test(source)) continue;
    let ast;
    try {
      ast = parseScript(source, abs);
    } catch {
      continue;
    }
    const issue = parseIssueFor(ast, relative(projectRoot, abs).split("\\").join("/"));
    if (issue && parseIssues) parseIssues.push(issue);
    for (const cls of ast.classes) {
      if (cls.kind !== "modded_class") continue;
      if (filter.className && cls.name !== filter.className) continue;
      hits.push({
        className: cls.name,
        relPath: relative(projectRoot, abs).split("\\").join("/"),
        line: cls.range.start.line,
        methodCount: cls.methods.length,
        fieldCount: cls.fields.length,
      });
    }
  }
  return hits.sort((a, b) => a.className.localeCompare(b.className));
}

// ── Formatter ────────────────────────────────────────────────────────────────

export function formatOverrides(input: {
  projectRoot: string;
  filter: { className?: string };
  hits: ModdedHit[];
  filesScanned: number;
  parseIssues?: ParseIssue[];
}): string {
  const { projectRoot, filter, hits, filesScanned, parseIssues = [] } = input;
  const lines: string[] = [];
  const filterDesc = filter.className ? ` for class \`${filter.className}\`` : "";
  lines.push(`## modded class declarations${filterDesc} in ${projectRoot}`);
  lines.push("");
  lines.push(`Scanned ${filesScanned} .c file${filesScanned !== 1 ? "s" : ""}. Found ${hits.length} modded chain${hits.length !== 1 ? "s" : ""}.`);
  lines.push("");
  const issueLines = formatParseIssues(parseIssues);
  if (hits.length === 0) {
    if (filter.className) {
      lines.push(`No \`modded class ${filter.className}\` declarations found in this project.`);
    } else {
      lines.push("No modded classes found.");
    }
    if (issueLines.length > 0) {
      lines.push("");
      lines.push(...issueLines);
    }
    return lines.join("\n");
  }
  // Group by class name when no filter is set — show every override of each class.
  if (filter.className) {
    for (const h of hits) {
      lines.push(
        `  - ${h.relPath}:${h.line} — ${h.methodCount} method${h.methodCount !== 1 ? "s" : ""}, ${h.fieldCount} field${h.fieldCount !== 1 ? "s" : ""}`,
      );
    }
  } else {
    const grouped = new Map<string, ModdedHit[]>();
    for (const h of hits) {
      const list = grouped.get(h.className) ?? [];
      list.push(h);
      grouped.set(h.className, list);
    }
    for (const [className, group] of grouped) {
      lines.push(`### modded class ${className}  (${group.length} override${group.length !== 1 ? "s" : ""})`);
      for (const h of group) {
        lines.push(`  - ${h.relPath}:${h.line} — ${h.methodCount} methods, ${h.fieldCount} fields`);
      }
      lines.push("");
    }
  }
  if (issueLines.length > 0) {
    lines.push("");
    lines.push(...issueLines);
  }
  return lines.join("\n").trimEnd();
}

// ── Registration ─────────────────────────────────────────────────────────────

export function registerScriptOverrides(server: McpServer): void {
  server.registerTool(
    "script_overrides",
    {
      description:
        "Find every `modded class <name>` declaration in a project's `.c` files. " +
        "With no `class_name` filter, lists every modded chain grouped by base. " +
        "With a filter, lists only overrides of the specified class. " +
        "Walks the project root directly (not the project-index, which doesn't track .c files). " +
        "Use for refactor impact analysis: if you rename a vanilla class, this tells you which mods need to update.",
      inputSchema: {
        project_root: z
          .string()
          .describe("Absolute path to the project to scan (typically a .gproj's directory)"),
        class_name: z
          .string()
          .optional()
          .describe("Optional class-name filter. Returns only `modded class <class_name>` matches."),
      },
    },
    async ({ project_root, class_name }) => {
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
        const hits = findModdedChains(rootAbs, { className: class_name }, parseIssues);
        const text = formatOverrides({
          projectRoot: rootAbs,
          filter: { className: class_name },
          hits,
          filesScanned: files.length,
          parseIssues,
        });
        return { content: [{ type: "text" as const, text }] };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [{ type: "text" as const, text: `Error finding overrides: ${msg}` }],
          isError: true,
        };
      }
    },
  );
}
