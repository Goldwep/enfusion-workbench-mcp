/**
 * `terrain_road_export_graph`: the 1.x name of the world's road network as a graph (nodes, edges),
 * now a TypeScript composition of `wb_generator list` and `wb_shape points` (W7, DEC-075 OD-10).
 * It no longer calls EMCP_WB_Terrain (whose road_export_graph branch stays a placeholder).
 *
 * How the graph is built, for the world open in the World Editor:
 *   1. wb_generator list (all pages) gives every generator; the road generators are the rows whose
 *      class is RoadGeneratorEntity or a class under it in the API index.
 *   2. Each road's parent shape is read once with wb_shape points (tesselated, world space, all
 *      pages), so a spline road is its curve and not only its anchors.
 *   3. Points within NODE_TOLERANCE metres of each other become one node (a spatial hash), so roads
 *      that meet share a node; each pair of neighbouring points is one edge, and a closed shape
 *      gets its closing edge.
 *
 * Limits, said plainly: the generator API gives no road width, so edges carry none; roads that cross
 * without a shared point are not joined; at most MAX_ROADS shapes are read per call. `world_path` is
 * optional: the open world is read, and a `world_path` that names another world is refused.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { WorkbenchClient } from "../workbench/client.js";
import { WorkbenchError } from "../workbench/client.js";
import { ERROR_CODES } from "../manifest/vocabulary.js";
import {
  PAGE_MAX,
  roadGeneratorClasses,
  runGenerator,
  type GeneratorOptions,
  type GeneratorRow,
} from "./wb-generator.js";
import { runShape } from "./wb-shape.js";

export const WORLD_HANDLER = "EMCP_WB_World";
export const TARGET = "open:WorldEditor";
/** Points closer than this (metres, 3D) are one node. */
export const NODE_TOLERANCE = 1;
/** Road shapes read per call. */
export const MAX_ROADS = 300;
/** Page requests per list, a guard against a handler that never ends a cursor. */
const MAX_PAGES = 200;

type Raw = Record<string, unknown>;
type Vec = [number, number, number];

export interface RoadGraphNode {
  id: string;
  x: number;
  y: number;
  z: number;
}

export interface RoadGraphEdge {
  from: string;
  to: string;
  road: string;
  length: number;
}

export interface RoadGraphRoad {
  id: string;
  shape: string;
  className: string;
  prefab: string;
  closed: boolean;
  points: number;
}

export interface RoadGraph {
  roads: RoadGraphRoad[];
  nodes: RoadGraphNode[];
  edges: RoadGraphEdge[];
}

interface Failure {
  code: string;
  message: string;
  next: string;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** "x y z" world-space point text to numbers; undefined when it is not three finite numbers. */
export function parsePoint(text: string): Vec | undefined {
  const p = text.trim().split(/\s+/).map(Number);
  return p.length === 3 && p.every(Number.isFinite) ? [p[0], p[1], p[2]] : undefined;
}

/**
 * Builds the graph from the roads' point lists: points within `tolerance` metres merge into one
 * node (a spatial hash over cubes of that size, the 27 neighbours checked), neighbouring points
 * make edges, a closed road adds its closing edge. A pair of points that merge into one node makes
 * no edge.
 */
export function buildGraph(
  roads: Array<{ meta: RoadGraphRoad; points: Vec[] }>,
  tolerance: number = NODE_TOLERANCE,
): RoadGraph {
  const nodes: RoadGraphNode[] = [];
  const cells = new Map<string, number[]>();
  const cellOf = (p: Vec): Vec => [
    Math.floor(p[0] / tolerance),
    Math.floor(p[1] / tolerance),
    Math.floor(p[2] / tolerance),
  ];
  const keyOf = (c: Vec) => `${c[0]}:${c[1]}:${c[2]}`;

  const nodeFor = (p: Vec): number => {
    const [cx, cy, cz] = cellOf(p);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          for (const i of cells.get(keyOf([cx + dx, cy + dy, cz + dz])) ?? []) {
            const n = nodes[i];
            if (Math.hypot(n.x - p[0], n.y - p[1], n.z - p[2]) <= tolerance) return i;
          }
        }
      }
    }
    const i = nodes.length;
    nodes.push({ id: `n${i}`, x: p[0], y: p[1], z: p[2] });
    const k = keyOf([cx, cy, cz]);
    cells.set(k, [...(cells.get(k) ?? []), i]);
    return i;
  };

  const edges: RoadGraphEdge[] = [];
  for (const { meta, points } of roads) {
    const ids = points.map(nodeFor);
    const link = (a: number, b: number) => {
      if (ids[a] === ids[b]) return;
      const pa = points[a];
      const pb = points[b];
      edges.push({
        from: nodes[ids[a]].id,
        to: nodes[ids[b]].id,
        road: meta.id,
        length: round3(Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2])),
      });
    };
    for (let i = 1; i < points.length; i++) link(i - 1, i);
    if (meta.closed && points.length > 2) link(points.length - 1, 0);
  }
  return {
    roads: roads.map((r) => r.meta),
    nodes: nodes.map((n) => ({ ...n, x: round3(n.x), y: round3(n.y), z: round3(n.z) })),
    edges,
  };
}

/** `$addon:path` and `{GUID}path` prefixes dropped, slashes forward, lower case. */
export function normalizeWorldPath(p: string): string {
  return p
    .trim()
    .replace(/^\$[^:]*:/, "")
    .replace(/^\{[0-9A-Fa-f]{16}\}/, "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .toLowerCase();
}

/** True when two world paths name the same file, one possibly written with extra leading folders. */
export function sameWorld(open: string, asked: string): boolean {
  const a = normalizeWorldPath(open);
  const b = normalizeWorldPath(asked);
  return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
}

/** A failure answer of a composed call, or undefined when it is ok. */
function failureOf(r: { ok: boolean } & Raw): Failure | undefined {
  if (r.ok) return undefined;
  return {
    code: String(r.code ?? "HANDLER_ERROR"),
    message: String(r.message ?? ""),
    next: String(r.next ?? ""),
  };
}

async function openWorld(client: WorkbenchClient): Promise<{ path: string } | Failure> {
  try {
    const r = await client.call<Raw>(WORLD_HANDLER, { action: "state" }, { access: "read" });
    if (r?.status !== "ok") {
      return {
        code: String(r?.code || "HANDLER_ERROR"),
        message: String(r?.message || "wb_world state failed"),
        next: String(r?.next || ""),
      };
    }
    return { path: String(r.worldPath ?? "") };
  } catch (e) {
    if (e instanceof WorkbenchError) {
      const code =
        e.code === "MODAL_OPEN" || e.code === "LOST" || e.code === "WEDGED"
          ? e.code
          : "UNREACHABLE";
      return { code, message: e.message, next: (ERROR_CODES as Record<string, string>)[code] };
    }
    throw e;
  }
}

/** Every generator row of the open world, all pages; one retry from the start on STALE_CURSOR. */
async function allGenerators(
  client: WorkbenchClient,
  options: GeneratorOptions,
): Promise<{ rows: GeneratorRow[] } | Failure> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const rows: GeneratorRow[] = [];
    let cursor: string | undefined;
    let stale = false;
    for (let page = 0; page < MAX_PAGES; page++) {
      const input: Raw = { action: "list", limit: PAGE_MAX };
      if (cursor) input.cursor = cursor;
      const r = await runGenerator(client, input, options);
      if (!r.ok) {
        if (r.code === "STALE_CURSOR" && attempt === 0) {
          stale = true;
          break;
        }
        return failureOf(r as unknown as { ok: boolean } & Raw)!;
      }
      const rb = r.readback as { rows: GeneratorRow[]; nextCursor: string | null };
      rows.push(...rb.rows);
      cursor = rb.nextCursor ?? undefined;
      if (!cursor) return { rows };
    }
    if (!stale) {
      return {
        code: "HANDLER_ERROR",
        message: "wb_generator list never ended its cursor",
        next: "",
      };
    }
  }
  return {
    code: "STALE_CURSOR",
    message: "the generator list kept changing",
    next: ERROR_CODES.STALE_CURSOR,
  };
}

/** One shape's tessellated world-space points, all pages. NOT_A_SHAPE and ENTITY_NOT_FOUND come back as `skip`. */
async function shapePoints(
  client: WorkbenchClient,
  shape: string,
): Promise<{ points: Vec[]; closed: boolean } | { skip: string } | Failure> {
  const points: Vec[] = [];
  let closed = false;
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const input: Raw = { action: "points", entity: shape, tesselated: true };
    if (cursor) input.cursor = cursor;
    const r = await runShape(client as WorkbenchClient, input);
    if (!r.ok) {
      if (r.code === "NOT_A_SHAPE" || r.code === "ENTITY_NOT_FOUND") {
        return { skip: `${shape}: ${r.code}` };
      }
      return failureOf(r as unknown as { ok: boolean } & Raw)!;
    }
    const rb = r.readback as { closed: boolean; points: string[]; nextCursor: string | null };
    closed = rb.closed;
    for (const t of rb.points) {
      const p = parsePoint(t);
      if (p) points.push(p);
    }
    cursor = rb.nextCursor ?? undefined;
    if (!cursor) return { points, closed };
  }
  return {
    code: "HANDLER_ERROR",
    message: `wb_shape points never ended its cursor for ${shape}`,
    next: "",
  };
}

export interface RoadExport {
  graph: RoadGraph;
  warnings: string[];
}

/** The whole composition. Returns the graph, or the failure that stopped it. */
export async function exportRoadGraph(
  client: WorkbenchClient,
  worldPath: string | undefined,
  options: GeneratorOptions = {},
): Promise<RoadExport | Failure> {
  const world = await openWorld(client);
  if ("code" in world) return world;
  if (world.path === "") {
    return {
      code: "NO_WORLD",
      message: "no world is open in the World Editor",
      next: ERROR_CODES.NO_WORLD,
    };
  }
  if (worldPath && !sameWorld(world.path, worldPath)) {
    return {
      code: "INVALID_ARGUMENT",
      message: `the open world is ${world.path}, not ${worldPath}; roads are read from the open world`,
      next: "Open the world first (wb_module setResource), or omit world_path.",
    };
  }

  const listed = await allGenerators(client, options);
  if ("code" in listed) return listed;
  const roadClasses = roadGeneratorClasses(options.dataDir);
  const warnings: string[] = [];
  const generators = listed.rows.filter((g) => roadClasses.has(g.className));

  // One shape can carry several road generators: read each shape once.
  const byShape = new Map<string, GeneratorRow>();
  for (const g of generators) {
    if (g.shapeId === "") {
      warnings.push(`${g.id} (${g.className}) has no parent shape and is skipped`);
    } else if (!byShape.has(g.shapeId)) {
      byShape.set(g.shapeId, g);
    }
  }
  let shapes = [...byShape.entries()];
  if (shapes.length > MAX_ROADS) {
    warnings.push(`${shapes.length} road shapes; the first ${MAX_ROADS} were read`);
    shapes = shapes.slice(0, MAX_ROADS);
  }

  const roads: Array<{ meta: RoadGraphRoad; points: Vec[] }> = [];
  for (const [shape, gen] of shapes) {
    const got = await shapePoints(client, shape);
    if ("code" in got) return got;
    if ("skip" in got) {
      warnings.push(`${got.skip}: the road generator's parent is not a shape and is skipped`);
      continue;
    }
    roads.push({
      meta: {
        id: gen.id,
        shape,
        className: gen.className,
        prefab: gen.prefab,
        closed: got.closed,
        points: got.points.length,
      },
      points: got.points,
    });
  }
  if (generators.length === 0) warnings.push("the open world has no road generators");
  warnings.push("road width is not read: the generator API gives none, so edges carry no width");
  return { graph: buildGraph(roads), warnings };
}

function errorResult(f: Failure) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            ok: false,
            action: "road_export_graph",
            target: TARGET,
            code: f.code,
            message: f.message,
            next: f.next || (ERROR_CODES as Record<string, string>)[f.code] || "See the message.",
            warnings: [],
          },
          null,
          2,
        ),
      },
    ],
    isError: true as const,
  };
}

export function registerTerrainRoadExportGraph(
  server: McpServer,
  client: WorkbenchClient,
  options: GeneratorOptions = {},
): void {
  server.registerTool(
    "terrain_road_export_graph",
    {
      description:
        "1.x alias, now built from wb_generator list and wb_shape points: the road generators of the open world as a graph (nodes, edges with length). " +
        "Points within 1 m merge into one node. No road width is read. world_path is optional: the open world is read, and another world is refused.",
      inputSchema: {
        world_path: z
          .string()
          .optional()
          .describe("Optional: must name the open world; roads are read from the open world."),
        format: z
          .enum(["json", "mermaid"])
          .default("json")
          .describe("Output format. json = raw graph data; mermaid = visualizable diagram"),
      },
    },
    async ({ world_path, format }) => {
      try {
        if (world_path?.startsWith("-")) {
          return errorResult({
            code: "INVALID_ARGUMENT",
            message: "Invalid world_path: must not start with '-'",
            next: "",
          });
        }
        const done = await exportRoadGraph(client, world_path, options);
        if ("code" in done) return errorResult(done);
        const { graph, warnings } = done;
        const lines: string[] = [];
        lines.push(
          `## terrain_road_export_graph: ${world_path ?? "(open world)"} (${format ?? "json"})`,
        );
        lines.push("");
        if ((format ?? "json") === "json") {
          lines.push("```json");
          lines.push(JSON.stringify(graph, null, 2));
          lines.push("```");
        } else {
          lines.push("```mermaid");
          lines.push("graph LR");
          for (const e of graph.edges) lines.push(`  ${e.from} -->|${e.length}m| ${e.to}`);
          lines.push("```");
        }
        lines.push("");
        lines.push(
          `Roads: ${graph.roads.length}, Nodes: ${graph.nodes.length}, Edges: ${graph.edges.length}`,
        );
        for (const w of warnings) lines.push(`Note: ${w}`);
        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return errorResult({
          code: "HANDLER_ERROR",
          message: `Error in terrain_road_export_graph: ${msg}`,
          next: "",
        });
      }
    },
  );
}
