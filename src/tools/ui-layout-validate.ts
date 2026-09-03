/**
 * `ui_layout_validate` — lint a `.layout` file for malformed anchors,
 * duplicate widget names, empty Name properties, and missing style refs
 * (when the styles file is indexed in the ProjectIndex).
 *
 * Pure file parsing + an OPTIONAL ProjectIndex lookup for the style-ref
 * check. The tool degrades gracefully when the index has no styles indexed.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFileSync, existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { parse, type EnfusionNode } from "../formats/enfusion-text.js";
import type { ProjectIndex } from "../project-index/project-index.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type FindingSeverity = "error" | "warning" | "info";

export interface Finding {
  /** Severity bucket the finding rolls into in the rendered report. */
  severity: FindingSeverity;
  /** Stable rule id — used for filtering / deduplication downstream. */
  rule: string;
  /** Human-readable description (one sentence). */
  message: string;
  /** Best-effort widget path ("root > Children > Background") when known. */
  where?: string;
}

// ── Helpers (exported for tests) ─────────────────────────────────────────────

/** Get the first string-typed property value with the given key. */
function getStringProp(node: EnfusionNode, key: string): string | undefined {
  for (const p of node.properties) {
    if (p.key === key && typeof p.value === "string") return p.value;
  }
  return undefined;
}

/**
 * Parse a 4-tuple anchor string ("left top right bottom"). Returns null when
 * the value isn't four space-separated numbers — caller treats that as a
 * "malformed" finding rather than throwing.
 */
export function parseAnchor(raw: string): [number, number, number, number] | null {
  const parts = raw.trim().split(/\s+/);
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isFinite(n))) return null;
  return [nums[0], nums[1], nums[2], nums[3]];
}

/**
 * Walk the widget tree and produce findings. Pure — no I/O. `availableStyles`
 * is a Set of style names known to exist; pass an empty set to skip the
 * style-ref check entirely (the most common test-time path).
 */
export function lintLayout(
  root: EnfusionNode,
  availableStyles: Set<string> = new Set(),
): Finding[] {
  const findings: Finding[] = [];
  const seenNames = new Map<string, string>(); // name → where it first appeared

  function visit(node: EnfusionNode, path: string): void {
    const localPath = `${path} > ${node.type}`;

    // Name property — duplicate / empty checks
    const nameProp = node.properties.find((p) => p.key === "Name");
    if (nameProp && typeof nameProp.value === "string") {
      const name = nameProp.value;
      if (name === "") {
        findings.push({
          severity: "warning",
          rule: "empty-widget-name",
          message: `Widget has an empty Name property`,
          where: localPath,
        });
      } else if (seenNames.has(name)) {
        findings.push({
          severity: "error",
          rule: "duplicate-widget-name",
          message: `Duplicate widget Name "${name}" (also at ${seenNames.get(name)})`,
          where: localPath,
        });
      } else {
        seenNames.set(name, localPath);
      }
    }

    // Anchor / Offset validation — looks at the widget's `Slot` child block.
    for (const child of node.children) {
      if (child.type !== "Slot") continue;
      const anchor = getStringProp(child, "Anchor");
      if (anchor !== undefined) {
        const parsed = parseAnchor(anchor);
        if (parsed === null) {
          findings.push({
            severity: "error",
            rule: "malformed-anchor",
            message: `Slot Anchor is not four space-separated numbers: "${anchor}"`,
            where: localPath,
          });
        } else {
          // Anchors are normalized [0,1] floats — flag out-of-range values.
          for (let i = 0; i < 4; i++) {
            if (parsed[i] < 0 || parsed[i] > 1) {
              findings.push({
                severity: "warning",
                rule: "anchor-out-of-range",
                message: `Slot Anchor component[${i}] = ${parsed[i]} is outside [0,1]`,
                where: localPath,
              });
              break; // only one per anchor — keeps the report readable
            }
          }
        }
      }
    }

    // Style-ref check — m_sStyleName "X" should resolve to an indexed style.
    const styleRef = getStringProp(node, "m_sStyleName");
    if (styleRef !== undefined && styleRef !== "" && availableStyles.size > 0) {
      if (!availableStyles.has(styleRef)) {
        findings.push({
          severity: "warning",
          rule: "unknown-style-ref",
          message: `Referenced style "${styleRef}" was not found in any indexed .styles file`,
          where: localPath,
        });
      }
    }

    // Recurse into children (real widget children + Children-wrapper).
    for (const c of node.children) {
      if (c.type === "Slot") continue; // already linted above
      visit(c, localPath);
    }
    // Properties whose value is a sub-node still get walked — covers rare
    // value-as-node forms without rewriting the recursion strategy.
    for (const p of node.properties) {
      if (typeof p.value !== "string") visit(p.value, localPath);
    }
  }
  visit(root, "root");
  return findings;
}

/**
 * Best-effort style-name collector against the ProjectIndex. We pull every
 * `.styles` resource and crack the file for top-level WidgetStyle entries.
 * Returns an empty set when no styles are indexed — the linter then skips
 * the style-ref check.
 */
export function collectIndexedStyleNames(
  index: ProjectIndex,
  readFile: (p: string) => string,
): Set<string> {
  const names = new Set<string>();
  // ProjectIndex doesn't carry a "styles only" filter, so we list and filter.
  // Pull a generous page — modders rarely ship >1000 styles files.
  const { rows } = index.listResources({ limit: 1000, offset: 0 });
  for (const row of rows) {
    if (!row.file_path.toLowerCase().endsWith(".styles")) continue;
    try {
      const text = readFile(row.file_path);
      const parsed = parse(text);
      // Every direct child of the styles root is a style entry — record its
      // Name property (preferred) or fall back to its id / type.
      for (const child of parsed.children) {
        const name = getStringProp(child, "Name");
        if (name) names.add(name);
        else if (child.id) names.add(child.id);
      }
      // Also accept root.children-of-children for grouped styles files.
      for (const child of parsed.children) {
        for (const grand of child.children) {
          const name = getStringProp(grand, "Name");
          if (name) names.add(name);
        }
      }
    } catch {
      // Don't let one broken file kill the lint; the validator continues.
    }
  }
  return names;
}

/** Render findings as a markdown block grouped by severity. Pure. */
export function formatFindings(layoutPath: string, findings: Finding[]): string {
  const lines: string[] = [];
  lines.push(`# Layout validation: ${layoutPath}`);
  lines.push("");
  if (findings.length === 0) {
    lines.push("_No findings — layout looks clean._");
    return lines.join("\n");
  }
  const buckets: Record<FindingSeverity, Finding[]> = {
    error: [],
    warning: [],
    info: [],
  };
  for (const f of findings) buckets[f.severity].push(f);
  for (const sev of ["error", "warning", "info"] as FindingSeverity[]) {
    const bucket = buckets[sev];
    if (bucket.length === 0) continue;
    lines.push(`## ${sev.toUpperCase()} (${bucket.length})`);
    lines.push("");
    for (const f of bucket) {
      lines.push(`- **[${f.rule}]** ${f.message}${f.where ? ` _(at ${f.where})_` : ""}`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

// ── Registration ─────────────────────────────────────────────────────────────

export function registerUiLayoutValidate(server: McpServer, index?: ProjectIndex): void {
  server.registerTool(
    "ui_layout_validate",
    {
      description:
        "Lint a .layout file for duplicate widget names, malformed / out-of-range anchors, empty Name properties, and unknown style references. " +
        "When a ProjectIndex is supplied, style refs (`m_sStyleName`) are cross-checked against indexed .styles files. " +
        "Pure file parsing — no Workbench connection required.",
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
                text: `Error validating layout: path cannot start with '-': ${layout_path}`,
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
                text: `Error validating layout: file not found at ${resolved}`,
              },
            ],
            isError: true,
          };
        }
        const content = readFileSync(resolved, "utf-8");
        const root = parse(content);
        const styles = index
          ? collectIndexedStyleNames(index, (p) => readFileSync(p, "utf-8"))
          : new Set<string>();
        const findings = lintLayout(root, styles);
        const text = formatFindings(resolved, findings);
        return { content: [{ type: "text" as const, text }] };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [
            { type: "text" as const, text: `Error validating layout: ${msg}` },
          ],
          isError: true,
        };
      }
    },
  );
}
