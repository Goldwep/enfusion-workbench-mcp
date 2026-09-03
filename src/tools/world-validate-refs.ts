/**
 * `world_validate_refs` — file-scoped variant of `find_broken_refs`.
 *
 * Reads a single `.ent` or `.layer` (or any Enfusion-text) file from disk,
 * walks the parsed tree extracting every `{GUID}path` reference (inheritance,
 * property values, standalone values), and — if the GUID resolves against the
 * project-index — flags each ref as resolved or unresolved.
 *
 * Pure FS + index lookup: never writes the index, never touches the network.
 * Use to spot-check one prefab/world before publish; use `find_broken_refs`
 * for the index-wide pre-publish sweep.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFileSync, existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { parse, type EnfusionNode } from "../formats/enfusion-text.js";
import { ProjectIndex } from "../project-index/project-index.js";
import type { ResourceRow } from "../project-index/types.js";

// ── Types ────────────────────────────────────────────────────────────────────

/** How a ref was expressed in the source file — mirrors `RefKind` semantics. */
export type WorldRefKind = "inheritance" | "asset_path" | "value";

/** One reference discovered during the walk. */
export interface WorldRefEntry {
  /** Uppercased 16-hex GUID. */
  guid: string;
  /** Where the ref came from. */
  refKind: WorldRefKind;
  /** Property key (for asset_path) or enclosing node type (otherwise). */
  context: string;
  /** Type of the immediate enclosing node — useful for visual scanning. */
  enclosingType: string;
  /** Row from the project-index when the GUID resolves; null when it doesn't. */
  resolved: ResourceRow | null;
}

/** Input to `formatReport` — everything needed to render the markdown. */
export interface ReportInput {
  filePath: string;
  refs: WorldRefEntry[];
}

// ── Walker (exported for tests) ──────────────────────────────────────────────

/** `{<16-hex>}<optional path>` — matches refs in inheritance + property values. */
const GUID_BRACED_RE = /^\{([0-9A-Fa-f]{16})\}/;
/** `<16-hex>` standalone — matches dep-style bare GUID values. */
const GUID_BARE_RE = /^[0-9A-Fa-f]{16}$/;

/**
 * Try parsing `value` as a braced GUID ref. Bare 16-hex strings are NOT
 * matched here — property values like `ID "55AA11BB22CC33DD"` are entity
 * instance IDs, not refs to indexed resources, and `ref-scan.ts` treats them
 * the same way (braced-only for inheritance/property positions).
 */
function extractBracedGuid(value: string): string | null {
  if (!value.startsWith("{")) return null;
  const m = GUID_BRACED_RE.exec(value);
  return m !== null ? m[1].toUpperCase() : null;
}

/**
 * Try parsing a standalone value as either braced or bare 16-hex. The bare
 * form covers Dependencies-block entries (`"AAAA000000000001"`) and any
 * other place where a value list contains raw GUIDs.
 */
function extractValueGuid(value: string): string | null {
  const braced = extractBracedGuid(value);
  if (braced !== null) return braced;
  if (GUID_BARE_RE.test(value)) return value.toUpperCase();
  return null;
}

/**
 * Depth-first walk over a parsed Enfusion tree. Collects every GUID-shaped
 * reference into `out`. Same walk shape as `ref-scan.ts`, but emits in-memory
 * entries instead of DB rows and skips the GameProject/Dependencies special-
 * casing — `dep` refs are reported as `value`s here.
 */
export function collectRefs(node: EnfusionNode, out: WorldRefEntry[]): void {
  // Inheritance clause — braced form only.
  if (node.inheritance !== undefined) {
    const guid = extractBracedGuid(node.inheritance);
    if (guid !== null) {
      out.push({
        guid,
        refKind: "inheritance",
        context: node.inheritance,
        enclosingType: node.type,
        resolved: null,
      });
    }
  }

  // Property values that look like asset paths — braced form only. Bare
  // 16-hex values in properties (e.g. `ID "55AA11BB22CC33DD"`) are entity
  // instance IDs, not refs to indexed resources.
  for (const prop of node.properties) {
    if (typeof prop.value !== "string") continue;
    const guid = extractBracedGuid(prop.value);
    if (guid !== null) {
      out.push({
        guid,
        refKind: "asset_path",
        context: prop.key,
        enclosingType: node.type,
        resolved: null,
      });
    }
  }

  // Standalone values (dep entries, raw GUID lists, etc.) — both braced
  // and bare 16-hex forms.
  for (const val of node.values) {
    const guid = extractValueGuid(val);
    if (guid !== null) {
      out.push({
        guid,
        refKind: "value",
        context: val,
        enclosingType: node.type,
        resolved: null,
      });
    }
  }

  // Recurse into property nodes and children.
  for (const prop of node.properties) {
    if (typeof prop.value !== "string") {
      collectRefs(prop.value, out);
    }
  }
  for (const child of node.children) {
    collectRefs(child, out);
  }
}

// ── Formatter (exported for tests) ───────────────────────────────────────────

/** Render the resolved/unresolved breakdown as markdown. */
export function formatReport(input: ReportInput): string {
  const { filePath, refs } = input;
  const total = refs.length;
  const resolved = refs.filter((r) => r.resolved !== null);
  const unresolved = refs.filter((r) => r.resolved === null);

  const lines: string[] = [];
  lines.push(`## Refs in ${filePath}`);
  lines.push("");

  if (total === 0) {
    lines.push("No GUID references found.");
    return lines.join("\n");
  }

  lines.push(
    `Total refs found: ${total} (${resolved.length} resolved, ${unresolved.length} unresolved)`,
  );
  lines.push("");

  if (unresolved.length > 0) {
    lines.push(`### Unresolved (${unresolved.length})`);
    for (const r of unresolved) {
      lines.push(
        `  - {${r.guid}} — at ${r.refKind} "${r.context}" (inside ${r.enclosingType})`,
      );
    }
    lines.push("");
  }

  if (resolved.length > 0) {
    lines.push(`### Resolved (${resolved.length})`);
    for (const r of resolved) {
      // resolved.row is guaranteed non-null in this branch.
      const row = r.resolved!;
      lines.push(`  - {${r.guid}} → ${row.file_path} (${row.root_type})`);
    }
  }

  return lines.join("\n").trimEnd();
}

// ── Registration ─────────────────────────────────────────────────────────────

export function registerWorldValidateRefs(
  server: McpServer,
  index: ProjectIndex,
): void {
  server.registerTool(
    "world_validate_refs",
    {
      description:
        "File-scoped variant of `find_broken_refs`. Reads a single `.ent` or `.layer` file, " +
        "walks the parsed tree to extract every `{GUID}path` reference, and reports which GUIDs resolve " +
        "against the project-index and which don't. Use for spot-checking one prefab/world before publish; " +
        "use `find_broken_refs` for the index-wide sweep.",
      inputSchema: {
        file_path: z
          .string()
          .describe(
            "Path to the `.ent` or `.layer` file. Absolute, or relative to the MCP server's working directory.",
          ),
      },
    },
    async ({ file_path }) => {
      try {
        const resolved = isAbsolute(file_path)
          ? file_path
          : resolve(process.cwd(), file_path);

        if (!existsSync(resolved)) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error validating world refs: file not found at ${resolved}`,
              },
            ],
            isError: true,
          };
        }

        const content = readFileSync(resolved, "utf-8");
        const root = parse(content);

        const refs: WorldRefEntry[] = [];
        collectRefs(root, refs);

        // Resolve each ref against the project-index. Same GUID may appear
        // many times in a file — cache lookups so we don't slam the DB.
        const cache = new Map<string, ResourceRow | null>();
        for (const ref of refs) {
          let row = cache.get(ref.guid);
          if (row === undefined) {
            row = index.resolveGuid(ref.guid);
            cache.set(ref.guid, row);
          }
          ref.resolved = row;
        }

        const text = formatReport({ filePath: resolved, refs });
        return { content: [{ type: "text" as const, text }] };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error validating world refs: ${msg}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
