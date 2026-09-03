/**
 * `ui_styles_inspect` — parse a `.styles` file and emit a markdown summary
 * of each declared widget-style entry along with its property list.
 *
 * Pure file parsing — no Workbench connection or DB required.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFileSync, existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { parse, type EnfusionNode } from "../formats/enfusion-text.js";

// ── Types ────────────────────────────────────────────────────────────────────

/** One style entry projected out of the parsed .styles tree. */
export interface StyleEntry {
  /** The node's `type` string (e.g. "WidgetStyle", "TextWidgetStyle"). */
  type: string;
  /** className qualifier when present. */
  className?: string;
  /** The `Name` property if set (or falls back to node.id). */
  name?: string;
  /** Plain-string properties with their raw value. */
  properties: { key: string; value: string }[];
}

// ── Helpers (exported for tests) ─────────────────────────────────────────────

/** Get the first string-typed property value for a key, or undefined. */
function getStringProp(node: EnfusionNode, key: string): string | undefined {
  for (const p of node.properties) {
    if (p.key === key && typeof p.value === "string") return p.value;
  }
  return undefined;
}

/**
 * Project the parsed .styles root into a flat list of style entries.
 *
 * Real Enfusion .styles files put every widget-style as a direct child of
 * the root. We also accept a one-level wrapper (e.g. `Styles { ... }`)
 * so files that group styles still surface every entry.
 */
export function extractStyles(root: EnfusionNode): StyleEntry[] {
  const entries: StyleEntry[] = [];
  const candidates: EnfusionNode[] = [];

  // Direct children are the common case.
  for (const c of root.children) candidates.push(c);

  // One layer of wrapping (e.g., a single `Styles { ... }` container) — flatten.
  if (root.children.length === 1 && root.children[0].children.length > 0) {
    for (const c of root.children[0].children) candidates.push(c);
  }

  // De-dup nodes — if a wrapper was used, the direct children pass already
  // captured the wrapper itself; skip it from the entry list.
  const seen = new Set<EnfusionNode>();
  for (const c of candidates) {
    if (seen.has(c)) continue;
    // Skip wrapper containers that have no Name and no string properties.
    const looksLikeWrapper =
      c.properties.length === 0 && getStringProp(c, "Name") === undefined && c.children.length > 0;
    if (looksLikeWrapper && root.children.length === 1) continue;
    seen.add(c);

    const properties: { key: string; value: string }[] = [];
    for (const p of c.properties) {
      if (typeof p.value === "string") {
        properties.push({ key: p.key, value: p.value });
      }
    }
    entries.push({
      type: c.type,
      className: c.className,
      name: getStringProp(c, "Name") ?? c.id,
      properties,
    });
  }
  return entries;
}

/** Format the style list as markdown. Pure — no I/O. */
export function formatStylesInspection(
  filePath: string,
  entries: StyleEntry[],
): string {
  const lines: string[] = [];
  lines.push(`# Styles: ${filePath}`);
  lines.push("");
  lines.push(`- **Total styles:** ${entries.length}`);
  lines.push("");
  if (entries.length === 0) {
    lines.push("_No widget-style entries found in this file._");
    return lines.join("\n");
  }
  for (const e of entries) {
    const heading = e.name ? `${e.type}: ${e.name}` : e.type;
    lines.push(`## ${heading}`);
    if (e.className) lines.push(`- **Class:** ${e.className}`);
    if (e.properties.length === 0) {
      lines.push("- _(no string properties declared)_");
    } else {
      lines.push("- **Properties:**");
      for (const p of e.properties) {
        lines.push(`  - \`${p.key}\` = ${p.value}`);
      }
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

// ── Registration ─────────────────────────────────────────────────────────────

export function registerUiStylesInspect(server: McpServer): void {
  server.registerTool(
    "ui_styles_inspect",
    {
      description:
        "Parse a .styles file and emit a markdown summary of every widget-style entry with its property list. " +
        "Pure file parsing — no Workbench connection required.",
      inputSchema: {
        styles_path: z
          .string()
          .min(1)
          .describe("Path to a .styles file. Absolute or relative to MCP cwd."),
      },
    },
    async ({ styles_path }) => {
      try {
        if (styles_path.startsWith("-")) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error inspecting styles: path cannot start with '-': ${styles_path}`,
              },
            ],
            isError: true,
          };
        }
        const resolved = isAbsolute(styles_path)
          ? styles_path
          : resolve(process.cwd(), styles_path);
        if (!existsSync(resolved)) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error inspecting styles: file not found at ${resolved}`,
              },
            ],
            isError: true,
          };
        }
        const content = readFileSync(resolved, "utf-8");
        const parsed = parse(content);
        const entries = extractStyles(parsed);
        const text = formatStylesInspection(resolved, entries);
        return { content: [{ type: "text" as const, text }] };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [
            { type: "text" as const, text: `Error inspecting styles: ${msg}` },
          ],
          isError: true,
        };
      }
    },
  );
}
