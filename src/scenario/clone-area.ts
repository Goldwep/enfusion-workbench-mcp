/**
 * Clone a rectangular world-coord area of a scenario layer into a new layer
 * text, regenerating every embedded GUID so the clone does not collide with
 * the source.
 *
 * Pure logic only: no FS, no MCP. The tool wrapper
 * (`src/tools/scenario-clone-area.ts`) owns I/O and the write.
 *
 * Works on the lossless CST (src/formats/enfusion-cst.ts) through
 * `layer-cst.ts`. The destination is the source text with three kinds of
 * splice and nothing else:
 *   1. every entity outside the area (or without `coords`) is removed, whole
 *      lines where it stands alone;
 *   2. every GUID slot inside a kept entity gets a fresh GUID, written in the
 *      slot's own shape (quoted or bare, braced or not);
 *   3. with a translate, the kept entity's own `coords` X and Z are moved,
 *      keeping the bare or quoted form and the Y component as written.
 * Every other byte (header, root properties, comments, line ends, indents,
 * block order, an entity's class and name) is the source's.
 *
 * Entity model: the entities are the object children of the layer block, the
 * document root for a `.layer`, or the single root object for a `.conf` /
 * `.ent` (`singleRoot`). An entity's position is its own `coords` scalar,
 * `coords X Y Z` (bare) or `coords "X Y Z"` (quoted). Non-object entries of
 * the block (root-level properties) are kept as they are.
 */

import { generateGuid } from "../formats/guid.js";
import { tokenValue, type CstObject, type CstScalar, type Token } from "../formats/enfusion-cst.js";
import { applyEdits, entitiesOf, openLayer, removalSpan, type TextEdit } from "./layer-cst.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface Area {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export interface Translate {
  x: number;
  z: number;
}

export interface GuidSwap {
  old: string;
  new: string;
}

export interface CloneAreaOptions {
  /** As `openLayer`: true for a `.conf` / `.ent` source. */
  singleRoot?: boolean;
}

export interface CloneAreaResult {
  /** The destination layer text. */
  text: string;
  /** Count of entities cloned (top-level). */
  clonedCount: number;
  /** Every old→new GUID swap performed (across all entities, all depths). */
  guidSwaps: GuidSwap[];
  /** Applied translate (echoes the option, or {0,0} when none). */
  translate: Translate;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const GUID_HEX_RE = /^[0-9A-Fa-f]{16}$/;

/**
 * Parse a `coords "X Y Z"` property value into a [x, y, z] tuple. Returns
 * null when the string isn't a valid space-separated triple of numbers.
 */
export function parseCoords(raw: string): [number, number, number] | null {
  const parts = raw.trim().split(/\s+/);
  if (parts.length < 3) return null;
  const x = Number(parts[0]);
  const y = Number(parts[1]);
  const z = Number(parts[2]);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return [x, y, z];
}

/** Format a [x, y, z] tuple back to a `coords` string. */
export function formatCoords(x: number, y: number, z: number): string {
  return `${x} ${y} ${z}`;
}

/** The entity's own `coords` scalar (a direct child), if any. */
function coordsScalar(entity: CstObject): CstScalar | undefined {
  return entity.children.find((c): c is CstScalar => c.kind === "scalar" && c.key === "coords");
}

/** The [x, y, z] of a `coords` scalar, bare (`coords 1 2 3`) or quoted (`coords "1 2 3"`). */
function coordsOf(s: CstScalar): [number, number, number] | null {
  if (s.values.length === 1 && s.values[0].kind === "string") return parseCoords(tokenValue(s.values[0]));
  if (s.values.length >= 3 && s.values.slice(0, 3).every((t) => t.kind === "word")) {
    return parseCoords(s.values.slice(0, 3).map((t) => t.text).join(" "));
  }
  return null;
}

/** The edits that move a `coords` scalar's X and Z by (dx, dz), in its own form. */
function translateEdits(s: CstScalar, x: number, z: number, dx: number, dz: number): TextEdit[] {
  if (s.values.length === 1) {
    const t = s.values[0];
    const parts = tokenValue(t).trim().split(/\s+/);
    if (dx !== 0) parts[0] = String(x + dx);
    if (dz !== 0) parts[2] = String(z + dz);
    return [{ start: t.start, end: t.end, text: `"${parts.join(" ")}"` }];
  }
  const out: TextEdit[] = [];
  if (dx !== 0) out.push({ start: s.values[0].start, end: s.values[0].end, text: String(x + dx) });
  if (dz !== 0) out.push({ start: s.values[2].start, end: s.values[2].end, text: String(z + dz) });
  return out;
}

/** A fresh-GUID edit for a token holding a GUID (`ABCD...`, `"ABCD..."`, `"{ABCD...}"`). */
function guidEdit(t: Token, swaps: GuidSwap[]): TextEdit | undefined {
  const stripped = tokenValue(t).replace(/^\{/, "").replace(/\}$/, "");
  if (!GUID_HEX_RE.test(stripped)) return undefined;
  const next = generateGuid();
  swaps.push({ old: stripped.toUpperCase(), new: next });
  return { start: t.start, end: t.end, text: t.text.replace(stripped, next) };
}

/**
 * Fresh GUIDs for every GUID slot in an entity's subtree:
 *   1. an object's own id, the last header word or string before the colon
 *      when the header has more than its type (`MeshObject "{GUID}" {`,
 *      `Attributes Class "{GUID}" {`); a plain name is not a GUID and stays;
 *   2. `ID` and `GUID` scalars holding one GUID-shaped value.
 * Base references after the colon (`: "{GUID}Prefabs/X.et"`) and resource
 * values point at external resources and are never touched.
 */
function guidEdits(obj: CstObject, swaps: GuidSwap[], out: TextEdit[]): void {
  if (obj.head.length >= 2) {
    const e = guidEdit(obj.head[obj.head.length - 1], swaps);
    if (e) out.push(e);
  }
  for (const c of obj.children) {
    if (c.kind === "scalar" && (c.key === "ID" || c.key === "GUID") && c.values.length === 1) {
      const e = guidEdit(c.values[0], swaps);
      if (e) out.push(e);
    } else if (c.kind === "object") {
      guidEdits(c, swaps, out);
    }
  }
}

// ── Core ─────────────────────────────────────────────────────────────────────

/**
 * Keep the source layer's entities whose coords (world X, Z) fall inside the
 * area (inclusive), regenerate their GUIDs, optionally translate them, and
 * return the destination text. The source text is not changed.
 */
export function cloneArea(
  sourceText: string | Uint8Array,
  area: Area,
  translate?: Translate,
  opts: CloneAreaOptions = {},
): CloneAreaResult {
  if (area.minX > area.maxX) {
    throw new Error(`Invalid area: minX (${area.minX}) > maxX (${area.maxX})`);
  }
  if (area.minZ > area.maxZ) {
    throw new Error(`Invalid area: minZ (${area.minZ}) > maxZ (${area.maxZ})`);
  }

  const dx = translate?.x ?? 0;
  const dz = translate?.z ?? 0;
  const layer = openLayer(sourceText, { singleRoot: opts.singleRoot });
  const text = layer.doc.text;
  const swaps: GuidSwap[] = [];
  const edits: TextEdit[] = [];
  const cuts: [number, number][] = [];
  let cloned = 0;

  for (const entity of entitiesOf(layer.block)) {
    const cs = coordsScalar(entity);
    const coords = cs ? coordsOf(cs) : null;
    const inside =
      coords !== null &&
      coords[0] >= area.minX &&
      coords[0] <= area.maxX &&
      coords[2] >= area.minZ &&
      coords[2] <= area.maxZ;
    if (!inside) {
      cuts.push(removalSpan(text, entity));
      continue;
    }
    cloned++;
    guidEdits(entity, swaps, edits);
    if (dx !== 0 || dz !== 0) edits.push(...translateEdits(cs!, coords![0], coords![2], dx, dz));
  }

  // Merge the cuts: a removed last entity with no final line end takes the
  // line end before it, which the removed entity before it may already hold.
  cuts.sort((a, b) => a[0] - b[0]);
  for (let i = 0; i < cuts.length; i++) {
    let [s, e] = cuts[i];
    while (i + 1 < cuts.length && cuts[i + 1][0] <= e) e = Math.max(e, cuts[++i][1]);
    if (e === text.length && !/[\r\n]$/.test(text)) {
      // The text ends without a line end: so must the result. Take the line
      // end before the cut too, when the cut does not already start on one.
      if (s > 0 && text[s - 1] === "\n") s--;
      if (s > 0 && text[s - 1] === "\r") s--;
    }
    edits.push({ start: s, end: e, text: "" });
  }

  return {
    text: applyEdits(text, edits),
    clonedCount: cloned,
    guidSwaps: swaps,
    translate: { x: dx, z: dz },
  };
}
