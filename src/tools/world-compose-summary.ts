/**
 * `world_compose_summary` — static, one-shot summary of a `.ent` world file.
 *
 * Pure file parsing: reads the file from disk, parses via the Enfusion text
 * parser, and emits a markdown overview (entity counts by class, SubScene
 * parent refs, sibling layer files, bounding info if discoverable).
 *
 * No Workbench connection, no project-index lookups — runs against any `.ent`
 * file on disk, indexed or not.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, resolve, dirname, basename, extname } from "node:path";
import { parse, type EnfusionNode } from "../formats/enfusion-text.js";

// ── Types ────────────────────────────────────────────────────────────────────

/** One {class → count} bucket in the type-count tally. */
export interface ClassCount {
  /** The label we group by — `className` if present, else `type`. */
  label: string;
  count: number;
}

/** A SubScene parent reference: `SubScene { Parent "{GUID}path/to/world.ent" }`. */
export interface SubSceneRef {
  /** Where the SubScene node sits — "root" if the file itself IS a SubScene. */
  where: string;
  /** Raw parent reference value (typically `{GUID}path`). */
  parent: string;
}

/** Optional XYZ bounding box, computed from any `coords`-style properties found. */
export interface BoundingInfo {
  min: [number, number, number];
  max: [number, number, number];
  /** Number of entities whose position contributed to the bounds. */
  samples: number;
}

/** Input to `formatWorldSummary`. */
export interface WorldSummaryInput {
  worldPath: string;
  totalEntities: number;
  classCounts: ClassCount[];
  subScenes: SubSceneRef[];
  layerCount: number;
  layerFiles?: string[];
  bounding?: BoundingInfo;
}

// ── Helpers (exported for tests) ─────────────────────────────────────────────

/**
 * Walk the tree, counting every node by its label (`className` if set, else
 * `type`). The root node is included. SubScene wrapper roots are still counted
 * even though they're really references — caller filters separately.
 */
export function countEntitiesByClass(root: EnfusionNode): ClassCount[] {
  const tally = new Map<string, number>();
  const stack: EnfusionNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    const label = node.className ?? node.type;
    tally.set(label, (tally.get(label) ?? 0) + 1);
    for (const child of node.children) {
      stack.push(child);
    }
    for (const prop of node.properties) {
      if (typeof prop.value !== "string") {
        stack.push(prop.value);
      }
    }
  }
  return [...tally.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** Total entity count = sum of all per-class counts. */
export function totalEntities(counts: ClassCount[]): number {
  return counts.reduce((n, c) => n + c.count, 0);
}

/**
 * Collect every `SubScene` node with a `Parent` property — including the root
 * itself when the world IS a SubScene stub. `where` is a breadcrumb so callers
 * can see whether the ref is root-level or nested deep.
 */
export function collectSubScenes(root: EnfusionNode): SubSceneRef[] {
  const refs: SubSceneRef[] = [];
  function visit(node: EnfusionNode, path: string): void {
    if (node.type === "SubScene") {
      const parentProp = node.properties.find((p) => p.key === "Parent");
      if (parentProp && typeof parentProp.value === "string") {
        refs.push({ where: path, parent: parentProp.value });
      }
    }
    for (const child of node.children) {
      visit(child, `${path} > ${child.className ?? child.type}`);
    }
    for (const prop of node.properties) {
      if (typeof prop.value !== "string") {
        visit(prop.value, `${path}.${prop.key}`);
      }
    }
  }
  visit(root, "root");
  return refs;
}

/**
 * Find sibling `*_Layers/*.layer` files. Pattern: `MyWorld.ent` →
 * `MyWorld_Layers/*.layer` in the same directory. Returns `[]` if the
 * directory doesn't exist (no layers — totally normal for self-contained
 * worlds).
 */
export function findSiblingLayerFiles(worldFilePath: string): string[] {
  const dir = dirname(worldFilePath);
  const stem = basename(worldFilePath, extname(worldFilePath));
  const layersDir = resolve(dir, `${stem}_Layers`);
  if (!existsSync(layersDir)) return [];
  try {
    const stat = statSync(layersDir);
    if (!stat.isDirectory()) return [];
  } catch {
    return [];
  }
  try {
    return readdirSync(layersDir)
      .filter((name) => name.toLowerCase().endsWith(".layer"))
      .sort();
  } catch {
    return [];
  }
}

/**
 * Parse three space-separated numbers (`"1.5 2.5 3.5"`) into `[x, y, z]`.
 * Returns `null` if the value doesn't cleanly match — bounding is opportunistic.
 */
function parseVec3(raw: string): [number, number, number] | null {
  const parts = raw.trim().split(/\s+/);
  if (parts.length !== 3) return null;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isFinite(n))) return null;
  return [nums[0], nums[1], nums[2]];
}

/**
 * Best-effort bounding box from any `coords` / `m_vPos` / `Position` property
 * we find on any node. Returns `undefined` if no usable positions surfaced.
 */
export function computeBounding(root: EnfusionNode): BoundingInfo | undefined {
  const POSITION_KEYS = new Set(["coords", "m_vPos", "Position", "position"]);
  let min: [number, number, number] | null = null;
  let max: [number, number, number] | null = null;
  let samples = 0;
  const stack: EnfusionNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    for (const prop of node.properties) {
      if (typeof prop.value === "string" && POSITION_KEYS.has(prop.key)) {
        const vec = parseVec3(prop.value);
        if (vec) {
          samples += 1;
          if (!min || !max) {
            min = [vec[0], vec[1], vec[2]];
            max = [vec[0], vec[1], vec[2]];
          } else {
            for (let i = 0; i < 3; i++) {
              if (vec[i] < min[i]) min[i] = vec[i];
              if (vec[i] > max[i]) max[i] = vec[i];
            }
          }
        }
      } else if (typeof prop.value !== "string") {
        stack.push(prop.value);
      }
    }
    for (const child of node.children) {
      stack.push(child);
    }
  }
  if (!min || !max || samples === 0) return undefined;
  return { min, max, samples };
}

/**
 * Render the world summary as markdown. Pure function — no I/O.
 * Top N class buckets are listed in full; remainder collapses to a single
 * "(plus N more classes)" line so very dense worlds don't blow context.
 */
export function formatWorldSummary(input: WorldSummaryInput): string {
  const { worldPath, totalEntities: total, classCounts, subScenes, layerCount, layerFiles, bounding } = input;
  const TOP_N = 15;
  const lines: string[] = [];
  lines.push(`# World summary: ${worldPath}`);
  lines.push("");
  lines.push(`- **Total entities:** ${total}`);
  lines.push(`- **Distinct classes:** ${classCounts.length}`);
  lines.push(`- **SubScene parent refs:** ${subScenes.length}`);
  lines.push(`- **Sibling layer files:** ${layerCount}`);
  if (bounding) {
    const fmt = (v: [number, number, number]): string =>
      `(${v[0].toFixed(1)}, ${v[1].toFixed(1)}, ${v[2].toFixed(1)})`;
    lines.push(
      `- **Bounding (from ${bounding.samples} positions):** min ${fmt(bounding.min)}, max ${fmt(bounding.max)}`,
    );
  }
  lines.push("");

  if (classCounts.length > 0) {
    lines.push("## Top entity classes");
    lines.push("");
    const head = classCounts.slice(0, TOP_N);
    for (const c of head) {
      lines.push(`  - ${c.label}: ${c.count}`);
    }
    const remaining = classCounts.length - head.length;
    if (remaining > 0) {
      lines.push(`  - (plus ${remaining} more class${remaining === 1 ? "" : "es"})`);
    }
    lines.push("");
  }

  if (subScenes.length > 0) {
    lines.push("## SubScene parent references");
    lines.push("");
    for (const ref of subScenes) {
      lines.push(`  - \`${ref.parent}\` (at ${ref.where})`);
    }
    lines.push("");
  }

  if (layerCount > 0 && layerFiles && layerFiles.length > 0) {
    lines.push("## Layer files");
    lines.push("");
    for (const name of layerFiles) {
      lines.push(`  - ${name}`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

// ── Registration ─────────────────────────────────────────────────────────────

export function registerWorldComposeSummary(server: McpServer): void {
  server.registerTool(
    "world_compose_summary",
    {
      description:
        "Produce a static markdown summary of a `.ent` world file — total entity count, top entity classes by count, SubScene parent references (worlds that wrap another world via `SubScene { Parent \"{GUID}path\" }`), sibling `*_Layers/*.layer` file count, and a best-effort XYZ bounding box from any positional properties found. " +
        "This is a STATIC analysis — pure file parsing, no Workbench connection or project-index required. " +
        "Accepts an absolute path or a path relative to the current working directory.",
      inputSchema: {
        world_path: z
          .string()
          .describe(
            "Path to a `.ent` world file. Absolute, or relative to the MCP server's working directory.",
          ),
      },
    },
    async ({ world_path }) => {
      try {
        const resolved = isAbsolute(world_path)
          ? world_path
          : resolve(process.cwd(), world_path);

        if (!existsSync(resolved)) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error analyzing world: file not found at ${resolved}`,
              },
            ],
            isError: true,
          };
        }

        const content = readFileSync(resolved, "utf-8");
        const root = parse(content);

        const classCounts = countEntitiesByClass(root);
        const subScenes = collectSubScenes(root);
        const layerFiles = findSiblingLayerFiles(resolved);
        const bounding = computeBounding(root);

        const text = formatWorldSummary({
          worldPath: resolved,
          totalEntities: totalEntities(classCounts),
          classCounts,
          subScenes,
          layerCount: layerFiles.length,
          layerFiles,
          bounding,
        });

        return { content: [{ type: "text" as const, text }] };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [
            { type: "text" as const, text: `Error analyzing world: ${msg}` },
          ],
          isError: true,
        };
      }
    },
  );
}
