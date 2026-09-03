/**
 * `script_class_hierarchy` — render a class's inheritance + modded chain
 * as an ASCII tree (L6-7).
 *
 * Combines:
 *   - Direct `class X : Y` inheritance from the requested class's own
 *     definition (walks `.c` files for the matching declaration).
 *   - Every `modded class X` declaration that augments the chain.
 *
 * The Doxygen-indexed engine classes (from upstream's data dir) form the
 * roots; we stop walking when the base class isn't in any user `.c`.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFileSync, statSync } from "node:fs";
import { resolve, relative } from "node:path";
import { z } from "zod";
import { parseScript, formatParseIssues, parseIssueFor, type ParseIssue } from "../script-parser/index.js";
import type { ClassNode } from "../script-parser/ast.js";
import { findCFiles } from "./script-overrides.js";

interface ClassRecord {
  name: string;
  baseClass: string | null;
  filePath: string;
  line: number;
  kind: "class" | "modded_class";
}

// ── Core ─────────────────────────────────────────────────────────────────────

/**
 * Build a map of class-name → records (definition + all modded overrides).
 */
export function indexClassRecords(
  projectRoot: string,
  /** Optional sink: one entry per file whose parse reported diagnostics (audit H13). */
  parseIssues?: ParseIssue[],
): Map<string, ClassRecord[]> {
  const out = new Map<string, ClassRecord[]>();
  for (const abs of findCFiles(projectRoot)) {
    let source: string;
    try {
      source = readFileSync(abs, "utf-8");
    } catch {
      continue;
    }
    if (!/class\b/.test(source)) continue;
    let ast;
    try {
      ast = parseScript(source, abs);
    } catch {
      continue;
    }
    const issue = parseIssueFor(ast, relative(projectRoot, abs).split("\\").join("/"));
    if (issue && parseIssues) parseIssues.push(issue);
    for (const cls of ast.classes) {
      const rec: ClassRecord = {
        name: cls.name,
        baseClass: cls.baseClass,
        filePath: relative(projectRoot, abs).split("\\").join("/"),
        line: cls.range.start.line,
        kind: cls.kind,
      };
      const list = out.get(cls.name) ?? [];
      list.push(rec);
      out.set(cls.name, list);
    }
  }
  return out;
}

interface HierarchyNode {
  className: string;
  records: ClassRecord[];
  parent: HierarchyNode | null;
  cycleDetected: boolean;
}

export function buildHierarchy(
  index: Map<string, ClassRecord[]>,
  startClass: string,
  maxDepth = 32,
): HierarchyNode {
  // Walk upward from startClass via the FIRST non-modded record's
  // baseClass field.
  const visited = new Set<string>();
  let depth = 0;
  let current: string | null = startClass;
  let head: HierarchyNode | null = null;
  let tail: HierarchyNode | null = null;
  while (current !== null && depth < maxDepth) {
    if (visited.has(current)) {
      if (tail) tail.cycleDetected = true;
      break;
    }
    visited.add(current);
    const records: ClassRecord[] = index.get(current) ?? [];
    const node: HierarchyNode = {
      className: current,
      records,
      parent: null,
      cycleDetected: false,
    };
    if (!head) head = node;
    if (tail) tail.parent = node;
    tail = node;
    const defRecord: ClassRecord | undefined =
      records.find((r: ClassRecord) => r.kind === "class") ?? records[0];
    current = defRecord?.baseClass ?? null;
    depth += 1;
  }
  return head ?? {
    className: startClass,
    records: [],
    parent: null,
    cycleDetected: false,
  };
}

// ── Formatter ────────────────────────────────────────────────────────────────

export function formatHierarchy(input: {
  projectRoot: string;
  root: HierarchyNode;
  parseIssues?: ParseIssue[];
}): string {
  const { projectRoot, root, parseIssues = [] } = input;
  const lines: string[] = [];
  lines.push(`## Class hierarchy: ${root.className}`);
  lines.push(`*Project: ${projectRoot}*`);
  lines.push("");

  // Walk parents back into an array for top-down rendering.
  const chain: HierarchyNode[] = [];
  let cur: HierarchyNode | null = root;
  while (cur) {
    chain.push(cur);
    cur = cur.parent;
  }
  // chain[0] = startClass (lowest), chain[last] = topmost ancestor.
  // We want top-down: reverse for display.
  chain.reverse();

  for (let i = 0; i < chain.length; i++) {
    const node = chain[i];
    const indent = "  ".repeat(i);
    const arrow = i === 0 ? "" : "↓ ";
    if (node.records.length === 0) {
      lines.push(`${indent}${arrow}${node.className} *(not in project — likely engine class)*`);
      continue;
    }
    const defRecord = node.records.find((r) => r.kind === "class");
    if (defRecord) {
      lines.push(`${indent}${arrow}${node.className} → ${defRecord.filePath}:${defRecord.line}`);
    } else {
      lines.push(`${indent}${arrow}${node.className} *(modded only — no in-project definition)*`);
    }
    const moddedRecords = node.records.filter((r) => r.kind === "modded_class");
    if (moddedRecords.length > 0) {
      for (const r of moddedRecords) {
        lines.push(`${indent}  ↪ modded class @ ${r.filePath}:${r.line}`);
      }
    }
  }
  if (root.cycleDetected) {
    lines.push("");
    lines.push("⚠ CYCLE DETECTED in inheritance chain (broken data).");
  }
  const issueLines = formatParseIssues(parseIssues);
  if (issueLines.length > 0) {
    lines.push("");
    lines.push(...issueLines);
  }
  return lines.join("\n");
}

// ── Registration ─────────────────────────────────────────────────────────────

export function registerScriptClassHierarchy(server: McpServer): void {
  server.registerTool(
    "script_class_hierarchy",
    {
      description:
        "Render a class's inheritance + modded chain as an ASCII tree. " +
        "Walks the project's `.c` files to find both `class Foo : Bar` parent links AND every `modded class Foo` override. " +
        "Stops at the topmost ancestor not defined in the project (typically an engine/Doxygen class).",
      inputSchema: {
        project_root: z.string().describe("Absolute path to the project to scan"),
        class_name: z.string().describe("Class name to start walking from"),
        max_depth: z
          .number()
          .min(1)
          .max(64)
          .default(32)
          .describe("Stop after this many parent hops (default 32, max 64)"),
      },
    },
    async ({ project_root, class_name, max_depth }) => {
      try {
        if (project_root.startsWith("-")) {
          return {
            content: [
              { type: "text" as const, text: "Invalid project_root: must not start with '-'" },
            ],
            isError: true,
          };
        }
        const rootAbs = resolve(project_root);
        let stat;
        try {
          stat = statSync(rootAbs);
        } catch {
          return {
            content: [
              { type: "text" as const, text: `project_root not found: ${rootAbs}` },
            ],
            isError: true,
          };
        }
        if (!stat.isDirectory()) {
          return {
            content: [
              { type: "text" as const, text: `project_root is not a directory: ${rootAbs}` },
            ],
            isError: true,
          };
        }
        const parseIssues: ParseIssue[] = [];
        const idx = indexClassRecords(rootAbs, parseIssues);
        const hierarchy = buildHierarchy(idx, class_name, max_depth);
        const text = formatHierarchy({ projectRoot: rootAbs, root: hierarchy, parseIssues });
        return { content: [{ type: "text" as const, text }] };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [{ type: "text" as const, text: `Error walking class hierarchy: ${msg}` }],
          isError: true,
        };
      }
    },
  );
}

// silence unused
void ({} as ClassNode);
