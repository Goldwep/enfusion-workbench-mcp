/**
 * `world_diff` — semantic diff between two `.ent` (or any Enfusion text)
 * files. Groups entities by a stable key (preferring the `ID` property, then
 * `node.id`, falling back to type+className+inheritance+position-hash,
 * finally array index) and reports four
 * categories: added, removed, moved (transform delta > epsilon), and
 * modified (property changed).
 *
 * Pure file I/O — no DB, no project-index. Suited to version-comparison
 * workflows: "what changed between two saved versions of a world?"
 *
 * The diff is intentionally one level deep — direct children of the root
 * node, which matches how `.ent`/layer files lay out placed entities.
 * Nested structural changes show up as "modified" via property comparison
 * but are not themselves recursed into.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFileSync, existsSync } from "node:fs";
import { basename } from "node:path";
import { z } from "zod";
import { parse, type EnfusionNode } from "../formats/enfusion-text.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface AddedEntity {
  key: string;
  type: string;
  position: Vec3 | null;
}

export interface RemovedEntity {
  key: string;
  type: string;
  position: Vec3 | null;
}

export interface MovedEntity {
  key: string;
  type: string;
  before: Vec3;
  after: Vec3;
}

export interface PropertyChange {
  key: string;
  before: string;
  after: string;
}

export interface ModifiedEntity {
  key: string;
  type: string;
  changes: PropertyChange[];
}

export interface DiffResult {
  added: AddedEntity[];
  removed: RemovedEntity[];
  moved: MovedEntity[];
  modified: ModifiedEntity[];
}

// ── Position helpers ─────────────────────────────────────────────────────────

/**
 * Parse a `coords` property into a Vec3, or null if unparseable.
 *
 * The Enfusion text parser captures a coordinate triple as a single
 * space-joined string value regardless of whether the source wrote it quoted
 * (`coords "x y z"`) or bare (`coords x y z`) — real `.layer`/`.ent` files and
 * this project's scenario template use the bare form. We split that value on
 * whitespace and read the first three components.
 */
export function parsePosition(node: EnfusionNode): Vec3 | null {
  const coords = node.properties.find((p) => p.key === "coords");
  if (!coords || typeof coords.value !== "string") return null;
  const parts = coords.value.trim().split(/\s+/);
  if (parts.length < 3) return null;
  const x = Number.parseFloat(parts[0]);
  const y = Number.parseFloat(parts[1]);
  const z = Number.parseFloat(parts[2]);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return { x, y, z };
}

function vec3Equal(a: Vec3, b: Vec3, epsilon: number): boolean {
  return (
    Math.abs(a.x - b.x) < epsilon && Math.abs(a.y - b.y) < epsilon && Math.abs(a.z - b.z) < epsilon
  );
}

function fmtVec3(v: Vec3): string {
  // 2 decimal places is enough for world coords in human-readable output.
  const round = (n: number): string => (Math.round(n * 100) / 100).toString();
  return `(${round(v.x)}, ${round(v.y)}, ${round(v.z)})`;
}

// ── Key strategy ─────────────────────────────────────────────────────────────

/**
 * Stable key for an entity. Order of preference:
 *   1. The `ID` property — the 16-hex entity ID the engine writes into every
 *      placed entity (`GenericEntity : "{res}" { ID "..." coords ... }`).
 *      The parser stores it as a property, not as `node.id`. Best key.
 *   2. `node.id` — the name or quoted id written after the type.
 *   3. `<type>:<className?>:<inheritance?>:<x|y|z>` with coords rounded to int.
 *   4. `idx:<arrayIndex>` as last resort — caller passes the index.
 *
 * Index-keyed entries are inherently unstable across reorders, but they at
 * least give the diff something to grip on for unnamed nodes.
 */
export function entityKey(node: EnfusionNode, fallbackIndex: number): string {
  const idProp = node.properties.find((p) => p.key === "ID");
  if (idProp && typeof idProp.value === "string" && idProp.value.trim().length > 0) {
    return `id:${idProp.value.trim()}`;
  }
  if (node.id) return `id:${node.id}`;
  const pos = parsePosition(node);
  if (pos) {
    const xi = Math.round(pos.x);
    const yi = Math.round(pos.y);
    const zi = Math.round(pos.z);
    const cls = node.className ?? "";
    const inh = node.inheritance ?? "";
    return `pos:${node.type}:${cls}:${inh}:${xi}|${yi}|${zi}`;
  }
  return `idx:${node.type}:${fallbackIndex}`;
}

/**
 * Key every direct child. Two children that share a key (e.g. identical
 * prefabs at the same rounded spot) get `#2`, `#3`... suffixes in file
 * order, so neither is silently dropped from the diff.
 */
function keyChildren(parent: EnfusionNode): Map<string, EnfusionNode> {
  const out = new Map<string, EnfusionNode>();
  parent.children.forEach((c, i) => {
    const base = entityKey(c, i);
    let key = base;
    let n = 2;
    while (out.has(key)) key = `${base}#${n++}`;
    out.set(key, c);
  });
  return out;
}

// ── Property comparison ──────────────────────────────────────────────────────

/**
 * Compare two property lists, returning only the string-valued property
 * changes. Properties whose value is a child node are skipped here — those
 * structural diffs would either show up as moves or as separate added/removed
 * children one level deeper, and conflating them with leaf-property changes
 * just makes the output noisier.
 *
 * `coords` is also skipped — that's handled by the move check.
 *
 * `inheritance` is folded in as a pseudo-property `:inheritance` so a
 * re-parented entity surfaces as a single, scannable change.
 */
function diffProperties(before: EnfusionNode, after: EnfusionNode): PropertyChange[] {
  const changes: PropertyChange[] = [];

  const beforeProps = new Map<string, string>();
  for (const p of before.properties) {
    if (typeof p.value === "string" && p.key !== "coords") {
      beforeProps.set(p.key, p.value);
    }
  }
  const afterProps = new Map<string, string>();
  for (const p of after.properties) {
    if (typeof p.value === "string" && p.key !== "coords") {
      afterProps.set(p.key, p.value);
    }
  }

  const allKeys = new Set<string>([...beforeProps.keys(), ...afterProps.keys()]);
  for (const key of allKeys) {
    const b = beforeProps.get(key);
    const a = afterProps.get(key);
    if (b !== a) {
      changes.push({ key, before: b ?? "<unset>", after: a ?? "<unset>" });
    }
  }

  // Inheritance treated as a property for diff purposes.
  if ((before.inheritance ?? "") !== (after.inheritance ?? "")) {
    changes.push({
      key: ":inheritance",
      before: before.inheritance ?? "<unset>",
      after: after.inheritance ?? "<unset>",
    });
  }

  return changes;
}

// ── Core diff ────────────────────────────────────────────────────────────────

/**
 * Pure-function diff. Compares direct children of `before` vs `after`,
 * bucketing each match into added / removed / moved / modified.
 */
export function diffWorlds(before: EnfusionNode, after: EnfusionNode, epsilon: number): DiffResult {
  const beforeMap = keyChildren(before);
  const afterMap = keyChildren(after);

  const added: AddedEntity[] = [];
  const removed: RemovedEntity[] = [];
  const moved: MovedEntity[] = [];
  const modified: ModifiedEntity[] = [];

  for (const [key, node] of afterMap) {
    if (!beforeMap.has(key)) {
      added.push({ key, type: node.type, position: parsePosition(node) });
    }
  }
  for (const [key, node] of beforeMap) {
    if (!afterMap.has(key)) {
      removed.push({ key, type: node.type, position: parsePosition(node) });
    }
  }
  for (const [key, beforeNode] of beforeMap) {
    const afterNode = afterMap.get(key);
    if (!afterNode) continue;

    const bPos = parsePosition(beforeNode);
    const aPos = parsePosition(afterNode);
    if (bPos && aPos && !vec3Equal(bPos, aPos, epsilon)) {
      moved.push({ key, type: beforeNode.type, before: bPos, after: aPos });
    }

    const propChanges = diffProperties(beforeNode, afterNode);
    if (propChanges.length > 0) {
      modified.push({ key, type: beforeNode.type, changes: propChanges });
    }
  }

  return { added, removed, moved, modified };
}

// ── Formatter ────────────────────────────────────────────────────────────────

export function formatDiff(
  result: DiffResult,
  beforeLabel: string,
  afterLabel: string,
  maxDiffs: number,
): string {
  const lines: string[] = [];
  lines.push(`## World diff: ${beforeLabel} → ${afterLabel}`);
  lines.push("");
  lines.push(`Added:    ${result.added.length} entities`);
  lines.push(`Removed:  ${result.removed.length} entities`);
  lines.push(`Moved:    ${result.moved.length} entities (transform changed > epsilon)`);
  lines.push(`Modified: ${result.modified.length} entities (property change)`);

  const section = <T>(title: string, rows: T[], render: (r: T) => string): void => {
    if (rows.length === 0) return;
    const shown = Math.min(rows.length, maxDiffs);
    lines.push("");
    lines.push(`### ${title} (showing ${shown} of ${rows.length})`);
    for (let i = 0; i < shown; i++) {
      lines.push(render(rows[i]));
    }
  };

  section("Added entities", result.added, (e) => {
    const pos = e.position ? ` at ${fmtVec3(e.position)}` : "";
    return `  - ${e.type} ${e.key}${pos}`;
  });
  section("Removed entities", result.removed, (e) => {
    const pos = e.position ? ` at ${fmtVec3(e.position)}` : "";
    return `  - ${e.type} ${e.key}${pos}`;
  });
  section("Moved entities", result.moved, (e) => {
    return `  - ${e.type} ${e.key}: ${fmtVec3(e.before)} → ${fmtVec3(e.after)}`;
  });
  section("Modified entities", result.modified, (e) => {
    const changesPreview = e.changes
      .slice(0, 3)
      .map((c) => `${c.key}: "${c.before}" → "${c.after}"`)
      .join(", ");
    const more = e.changes.length > 3 ? ` (+${e.changes.length - 3} more)` : "";
    return `  - ${e.type} ${e.key}: ${changesPreview}${more}`;
  });

  if (
    result.added.length === 0 &&
    result.removed.length === 0 &&
    result.moved.length === 0 &&
    result.modified.length === 0
  ) {
    lines.push("");
    lines.push("No semantic differences detected.");
  }

  return lines.join("\n");
}

// ── Registration ─────────────────────────────────────────────────────────────

export function registerWorldDiff(server: McpServer): void {
  server.registerTool(
    "world_diff",
    {
      description:
        "Semantic diff between two Enfusion text files (typically `.ent` worlds or `.layer` files). " +
        "Groups direct-child entities by stable key (id → type+position → array index) and reports " +
        "added/removed/moved/modified buckets. Useful for reviewing what changed between two versions " +
        "of a layer before merging from a beta branch. Pure file I/O — no project-index required.",
      inputSchema: {
        before_path: z.string().describe("Absolute path to the pre-change .ent/.layer file"),
        after_path: z.string().describe("Absolute path to the post-change .ent/.layer file"),
        position_epsilon: z
          .number()
          .positive()
          .default(0.01)
          .describe(
            "Transforms differing by less than this (per axis) are treated as the same position. Default 0.01.",
          ),
        max_diffs: z
          .number()
          .int()
          .positive()
          .default(100)
          .describe(
            "Cap on entries shown per section. Counts are still reported in full. Default 100.",
          ),
      },
    },
    async ({ before_path, after_path, position_epsilon, max_diffs }) => {
      try {
        if (!existsSync(before_path)) {
          return {
            content: [{ type: "text" as const, text: `before_path not found: ${before_path}` }],
            isError: true,
          };
        }
        if (!existsSync(after_path)) {
          return {
            content: [{ type: "text" as const, text: `after_path not found: ${after_path}` }],
            isError: true,
          };
        }
        const beforeText = readFileSync(before_path, "utf-8");
        const afterText = readFileSync(after_path, "utf-8");
        const beforeNode = parse(beforeText);
        const afterNode = parse(afterText);
        const result = diffWorlds(beforeNode, afterNode, position_epsilon);
        const text = formatDiff(result, basename(before_path), basename(after_path), max_diffs);
        return { content: [{ type: "text" as const, text }] };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [{ type: "text" as const, text: `Error computing world diff: ${msg}` }],
          isError: true,
        };
      }
    },
  );
}
