/**
 * `ui_layout_inspect` — static, one-shot widget-tree dump of a `.layout` file.
 *
 * Pure file parsing: reads `.layout` from disk, parses via the Enfusion text
 * parser, walks the widget tree and emits ASCII indent + per-node key
 * properties (Name, size, anchors).
 *
 * No Workbench connection, no project-index lookups — runs against any
 * `.layout` file on disk.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFileSync, existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { parse, type EnfusionNode } from "../formats/enfusion-text.js";

// ── Types ────────────────────────────────────────────────────────────────────

/** A simplified widget projection — what we render per node. */
export interface WidgetNode {
  /** Widget class type (e.g. "TextWidgetClass", "OverlayWidget"). */
  type: string;
  /** The `Name "..."` property if present. */
  name?: string;
  /** className qualifier on the node, when present. */
  className?: string;
  /** Anchor as raw "left top right bottom" string when the Slot carries one. */
  anchor?: string;
  /** Offset as raw "left top right bottom" string when the Slot carries one. */
  offset?: string;
  /** m_iWidth / m_iHeight if declared directly on the widget node. */
  width?: string;
  height?: string;
  /** Child widget nodes (descended into `Children { ... }` containers). */
  children: WidgetNode[];
}

// ── Helpers (exported for tests) ─────────────────────────────────────────────

/**
 * Property keys that house a single sibling sub-node of children but otherwise
 * carry no widget identity of their own. We walk straight through them when
 * building the widget tree so the rendered structure mirrors what the layout
 * editor displays — not the verbose Enfusion serialization form.
 */
const CHILDREN_CONTAINER_TYPES = new Set<string>(["Children"]);

/** Extract the first matching property's string value, if any. */
function getStringProp(node: EnfusionNode, key: string): string | undefined {
  for (const p of node.properties) {
    if (p.key === key && typeof p.value === "string") return p.value;
  }
  return undefined;
}

/**
 * Locate the `Slot` child of a widget node (if any) and pull out its Anchor /
 * Offset properties. Layouts encode positioning as a child block:
 *   Slot "FrameWidgetSlot {GUID}" { Anchor "..."; Offset "..." }
 * so neither lives directly on the widget itself.
 */
function findSlotInfo(node: EnfusionNode): { anchor?: string; offset?: string } {
  for (const child of node.children) {
    if (child.type === "Slot") {
      return {
        anchor: getStringProp(child, "Anchor"),
        offset: getStringProp(child, "Offset"),
      };
    }
  }
  return {};
}

/**
 * Map an EnfusionNode (widget) into a WidgetNode projection. Recurses through
 * `Children { ... }` containers to flatten the serialization layer.
 */
export function toWidgetNode(node: EnfusionNode): WidgetNode {
  const slot = findSlotInfo(node);
  const widget: WidgetNode = {
    type: node.type,
    name: getStringProp(node, "Name"),
    className: node.className,
    anchor: slot.anchor,
    offset: slot.offset,
    width: getStringProp(node, "m_iWidth"),
    height: getStringProp(node, "m_iHeight"),
    children: [],
  };

  for (const child of node.children) {
    if (child.type === "Slot") continue; // already absorbed into anchor/offset
    if (CHILDREN_CONTAINER_TYPES.has(child.type)) {
      // Children { Widget { ... } Widget { ... } } — descend into wrapper
      for (const grand of child.children) {
        widget.children.push(toWidgetNode(grand));
      }
      continue;
    }
    // Non-Slot, non-Children child — could be a sub-widget directly attached
    // (rare but possible for OverlayWidget / vertical-stack layouts).
    widget.children.push(toWidgetNode(child));
  }

  return widget;
}

/** Build the indent prefix for the given depth. Two spaces per level. */
function indent(depth: number): string {
  return "  ".repeat(depth);
}

/**
 * One line summarizing a widget. Type comes first, then `[Name]`, then any
 * key positioning fields wrapped in parens. Missing fields are simply omitted.
 */
function widgetLine(w: WidgetNode, depth: number): string {
  const parts: string[] = [];
  parts.push(`${indent(depth)}- ${w.type}`);
  if (w.className) parts[0] += ` (${w.className})`;
  if (w.name) parts[0] += ` [${w.name}]`;

  const meta: string[] = [];
  if (w.anchor) meta.push(`anchor=${w.anchor}`);
  if (w.offset) meta.push(`offset=${w.offset}`);
  if (w.width) meta.push(`w=${w.width}`);
  if (w.height) meta.push(`h=${w.height}`);
  if (meta.length > 0) parts[0] += `  (${meta.join(", ")})`;
  return parts[0];
}

/**
 * Render the widget tree as a markdown block with bullet indentation. Pure —
 * no I/O.
 */
export function formatWidgetTree(root: WidgetNode, sourcePath: string): string {
  const lines: string[] = [];
  lines.push(`# Layout: ${sourcePath}`);
  lines.push("");
  const totals = countWidgets(root);
  lines.push(`- **Root type:** ${root.type}${root.className ? ` (${root.className})` : ""}`);
  if (root.name) lines.push(`- **Root name:** ${root.name}`);
  lines.push(`- **Total widgets:** ${totals}`);
  lines.push("");
  lines.push("## Widget tree");
  lines.push("");

  const stack: { node: WidgetNode; depth: number }[] = [{ node: root, depth: 0 }];
  while (stack.length > 0) {
    const { node, depth } = stack.shift()!;
    lines.push(widgetLine(node, depth));
    // Children pushed in reverse so the first child comes off the queue next.
    for (let i = node.children.length - 1; i >= 0; i--) {
      stack.unshift({ node: node.children[i], depth: depth + 1 });
    }
  }
  return lines.join("\n").trimEnd();
}

/** Recursive widget count (root inclusive). */
export function countWidgets(root: WidgetNode): number {
  let n = 1;
  for (const c of root.children) n += countWidgets(c);
  return n;
}

// ── Registration ─────────────────────────────────────────────────────────────

export function registerUiLayoutInspect(server: McpServer): void {
  server.registerTool(
    "ui_layout_inspect",
    {
      description:
        "Parse a `.layout` file and emit an ASCII widget tree with key properties per node " +
        "(class type, Name, anchor, offset, width/height). " +
        "Static analysis — pure file parsing, no Workbench connection required.",
      inputSchema: {
        layout_path: z
          .string()
          .min(1)
          .describe("Path to a .layout file. Absolute or relative to MCP cwd."),
      },
    },
    async ({ layout_path }) => {
      try {
        if (layout_path.startsWith("-")) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error inspecting layout: path cannot start with '-': ${layout_path}`,
              },
            ],
            isError: true,
          };
        }
        const resolved = isAbsolute(layout_path)
          ? layout_path
          : resolve(process.cwd(), layout_path);
        if (!existsSync(resolved)) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error inspecting layout: file not found at ${resolved}`,
              },
            ],
            isError: true,
          };
        }
        const content = readFileSync(resolved, "utf-8");
        const parsed = parse(content);
        const widget = toWidgetNode(parsed);
        const text = formatWidgetTree(widget, resolved);
        return { content: [{ type: "text" as const, text }] };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [{ type: "text" as const, text: `Error inspecting layout: ${msg}` }],
          isError: true,
        };
      }
    },
  );
}
