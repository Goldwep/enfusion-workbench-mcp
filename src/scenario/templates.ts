/**
 * Curated layer-entity templates that can be stamped into an existing scenario
 * layer at a world position.
 *
 * Each template emits a fresh array of top-level `EnfusionNode` entities
 * (regenerated GUIDs, positions rotated and translated relative to the stamp
 * origin). `ResourceName` references are intentionally PLACEHOLDER GUIDs —
 * downstream the caller is expected to invoke `refactor_replace_guid` to
 * substitute real prefab GUIDs from their project's asset library.
 *
 * Pure — no FS, no MCP. Tool wrapper owns I/O.
 */

import { generateGuid } from "../formats/guid.js";
import type { EnfusionNode } from "../formats/enfusion-text.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type TemplateName = "fob_basic" | "checkpoint" | "patrol_grid";

export const TEMPLATE_NAMES: readonly TemplateName[] = [
  "fob_basic",
  "checkpoint",
  "patrol_grid",
] as const;

export interface Position {
  x: number;
  y: number;
  z: number;
}

export interface ApplyTemplateResult {
  /** Cloned, regenerated entities ready to append to the target root. */
  entities: EnfusionNode[];
  /** Placeholder resource refs the caller is expected to replace post-stamp. */
  placeholders: string[];
}

// ── Placeholder resource refs ────────────────────────────────────────────────
//
// Sixteen-zero GUIDs with descriptive paths. Real prefabs live behind the
// project's asset library — agents downstream call `refactor_replace_guid`
// to swap these for project-specific resources.

const PLACEHOLDER_SANDBAG_WALL = "{0000000000000001}Prefabs/Cover/Sandbag_Wall.et";
const PLACEHOLDER_SPAWN_POINT = "{0000000000000002}Prefabs/Spawn/SpawnPoint.et";
const PLACEHOLDER_BARRIER = "{0000000000000003}Prefabs/Cover/Barrier_Concrete.et";
const PLACEHOLDER_WATCH_TOWER = "{0000000000000004}Prefabs/Structures/Watchtower.et";
const PLACEHOLDER_WAYPOINT = "{0000000000000005}Prefabs/AI/Waypoints/AIWaypoint_Patrol.et";

// ── Geometry helpers ─────────────────────────────────────────────────────────

interface LocalEntity {
  /** Resource ref to stamp. */
  resource: string;
  /** Offset from stamp origin, in world units (pre-rotation). */
  dx: number;
  dz: number;
  /** Local Y offset (height above stamp position). */
  dy?: number;
}

/**
 * Rotate (dx, dz) around the origin by `yawDeg` degrees (Y-up, clockwise when
 * viewed from above) and translate by `position`. Returns world-space x,y,z.
 */
function placeLocal(position: Position, yawDeg: number, local: LocalEntity): [number, number, number] {
  const rad = (yawDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // Standard 2D rotation on the XZ plane.
  const rx = local.dx * cos - local.dz * sin;
  const rz = local.dx * sin + local.dz * cos;
  return [position.x + rx, position.y + (local.dy ?? 0), position.z + rz];
}

/**
 * Build a `GenericEntity : "{resource}" { ID "..." coords "..." }` node ready
 * to append to a layer's top-level entity list. The GUID is freshly generated
 * for every call so successive stamps don't collide.
 */
function buildEntity(resource: string, x: number, y: number, z: number): EnfusionNode {
  return {
    type: "GenericEntity",
    inheritance: resource,
    properties: [
      { key: "ID", value: generateGuid() },
      { key: "coords", value: `${x} ${y} ${z}` },
    ],
    values: [],
    children: [],
  };
}

// ── Template definitions ─────────────────────────────────────────────────────

/**
 * Forward operating base (FOB) starter kit: a 4x4-meter square of sandbag
 * walls plus a single spawn point in the centre. Five entities.
 */
const TEMPLATE_FOB_BASIC: LocalEntity[] = [
  { resource: PLACEHOLDER_SANDBAG_WALL, dx: 4, dz: 0 }, // east wall
  { resource: PLACEHOLDER_SANDBAG_WALL, dx: -4, dz: 0 }, // west wall
  { resource: PLACEHOLDER_SANDBAG_WALL, dx: 0, dz: 4 }, // north wall
  { resource: PLACEHOLDER_SANDBAG_WALL, dx: 0, dz: -4 }, // south wall
  { resource: PLACEHOLDER_SPAWN_POINT, dx: 0, dz: 0 }, // centre spawn
];

/**
 * Vehicle checkpoint: two flanking sandbag walls, one concrete barrier, and
 * a watch tower offset behind. Four entities.
 */
const TEMPLATE_CHECKPOINT: LocalEntity[] = [
  { resource: PLACEHOLDER_SANDBAG_WALL, dx: 3, dz: 0 }, // right wall
  { resource: PLACEHOLDER_SANDBAG_WALL, dx: -3, dz: 0 }, // left wall
  { resource: PLACEHOLDER_BARRIER, dx: 0, dz: 0 }, // centre barrier
  { resource: PLACEHOLDER_WATCH_TOWER, dx: 0, dz: -5 }, // tower behind
];

/**
 * Hex-grid of six patrol waypoints, ~10m radius. Six entities arranged at
 * 60-degree increments — gives downstream AI a closed patrol loop.
 */
const TEMPLATE_PATROL_GRID: LocalEntity[] = (() => {
  const radius = 10;
  const out: LocalEntity[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI * 2) / 6;
    out.push({
      resource: PLACEHOLDER_WAYPOINT,
      dx: Math.round(radius * Math.cos(a)),
      dz: Math.round(radius * Math.sin(a)),
    });
  }
  return out;
})();

const TEMPLATES: Record<TemplateName, LocalEntity[]> = {
  fob_basic: TEMPLATE_FOB_BASIC,
  checkpoint: TEMPLATE_CHECKPOINT,
  patrol_grid: TEMPLATE_PATROL_GRID,
};

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Build a fresh batch of entities for the named template, rotated by
 * `yawDeg` around the stamp origin and translated to `position`.
 *
 * Returns the entities plus the deduped list of placeholder resource refs
 * (so the tool wrapper can call them out in the response).
 */
export function buildTemplate(
  name: TemplateName,
  position: Position,
  yawDeg: number,
): ApplyTemplateResult {
  const spec = TEMPLATES[name];
  if (!spec) {
    throw new Error(`Unknown template: ${name}`);
  }
  const entities: EnfusionNode[] = [];
  const seen = new Set<string>();
  for (const local of spec) {
    const [wx, wy, wz] = placeLocal(position, yawDeg, local);
    entities.push(buildEntity(local.resource, wx, wy, wz));
    seen.add(local.resource);
  }
  return {
    entities,
    placeholders: [...seen].sort(),
  };
}

/**
 * Describe each template's footprint for the MCP tool description string.
 * Stays in sync with the `LocalEntity[]` arrays above.
 */
export function describeTemplate(name: TemplateName): string {
  switch (name) {
    case "fob_basic":
      return "4 sandbag walls + 1 spawn point (5 entities)";
    case "checkpoint":
      return "2 sandbag walls + 1 barrier + 1 watch tower (4 entities)";
    case "patrol_grid":
      return "6 waypoint nodes in a 10m hex (6 entities)";
  }
}
