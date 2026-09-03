/**
 * Clone a rectangular world-coord area of a scenario layer into a fresh layer
 * tree, regenerating every embedded GUID so the clone doesn't collide with the
 * source.
 *
 * Pure logic only — no FS, no MCP. The tool wrapper
 * (`src/tools/scenario-clone-area.ts`) owns I/O and atomic writes.
 *
 * Top-level entity model:
 *   A scenario layer is the parsed root container; its top-level entities are
 *   `root.children`. Each entity carries a `coords "X Y Z"` property (string).
 *   We filter by the Vector3 first and third components (world X, Z) against
 *   the rectangular area, deep-clone matching entities, translate their
 *   `coords` if requested, and regenerate every GUID-like `id` / `ID` slot
 *   encountered in the subtree.
 */

import { generateGuid } from "../formats/guid.js";
import { parse, serialize, type EnfusionNode } from "../formats/enfusion-text.js";

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

export interface CloneAreaResult {
  /** Top-level entities cloned into the destination root. */
  clonedEntities: EnfusionNode[];
  /** Count of entities cloned (top-level). */
  clonedCount: number;
  /** Every old→new GUID swap performed (across all entities, all depths). */
  guidSwaps: GuidSwap[];
  /** Applied translate (echoes the option, or {0,0} when none). */
  translate: Translate;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const GUID_HEX_RE = /^[0-9A-Fa-f]{16}$/;
const BRACED_GUID_HEX_RE = /^\{[0-9A-Fa-f]{16}\}$/;

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

/**
 * Look up the `coords` value on an entity. Handles two emission shapes:
 *
 *   1. Quoted   — `coords "X Y Z"` parses as a single property whose value is
 *      the full space-separated string.
 *   2. Bare-split — `coords X Y Z` is how upstream `scenario_create_conflict`
 *      emits coords, but the parser cannot represent three bare numbers as a
 *      single property. It splits them into three: `coords→X`, `Y→Z`, and
 *      whatever follows. We detect the run by looking at the property index
 *      right after `coords` and combining the first three numeric tokens.
 *
 * Returns null when the entity has no coords or the values aren't numeric.
 * Always returns the [x, y, z] tuple — callers don't care about the form.
 */
function getCoords(node: EnfusionNode): [number, number, number] | null {
  for (let i = 0; i < node.properties.length; i++) {
    const prop = node.properties[i];
    if (prop.key !== "coords") continue;
    if (typeof prop.value !== "string") return null;

    // Quoted form — value contains whitespace.
    if (/\s/.test(prop.value)) {
      return parseCoords(prop.value);
    }

    // Bare-split form — value is the first component; the next properties'
    // KEYS and VALUES are the rest.
    const x = Number(prop.value);
    if (!Number.isFinite(x)) return null;
    const next = node.properties[i + 1];
    if (!next || typeof next.value !== "string") return null;
    const y = Number(next.key);
    const z = Number(next.value);
    if (!Number.isFinite(y) || !Number.isFinite(z)) return null;
    return [x, y, z];
  }
  return null;
}

/**
 * Set the `coords` property on a node in place. Always emits the QUOTED form
 * (`coords "X Y Z"`) — Workbench accepts either, and the quoted form
 * round-trips cleanly through the parser. If the previous shape was the
 * bare-split form, the trailing split-property is removed so we don't leave
 * a stale `{key:"Y", value:"Z"}` artefact behind.
 */
function setCoords(node: EnfusionNode, x: number, y: number, z: number): void {
  const value = formatCoords(x, y, z);
  for (let i = 0; i < node.properties.length; i++) {
    const prop = node.properties[i];
    if (prop.key !== "coords") continue;
    // If we're replacing a bare-split form, drop the trailing split entry too.
    if (
      typeof prop.value === "string" &&
      !/\s/.test(prop.value) &&
      Number.isFinite(Number(prop.value)) &&
      node.properties[i + 1] !== undefined &&
      typeof node.properties[i + 1].value === "string" &&
      Number.isFinite(Number(node.properties[i + 1].key)) &&
      Number.isFinite(Number(node.properties[i + 1].value as string))
    ) {
      node.properties.splice(i + 1, 1);
    }
    prop.value = value;
    return;
  }
  node.properties.push({ key: "coords", value });
}

/** Deep clone an EnfusionNode tree. Plain JSON-style clone is sufficient — the
 *  node tree contains only strings, numbers, arrays, and nested nodes. */
function cloneNode(node: EnfusionNode): EnfusionNode {
  const next: EnfusionNode = {
    type: node.type,
    id: node.id,
    className: node.className,
    inheritance: node.inheritance,
    properties: [],
    values: [...node.values],
    children: [],
    rawContent: node.rawContent,
  };
  for (const prop of node.properties) {
    if (typeof prop.value === "string") {
      next.properties.push({ key: prop.key, value: prop.value });
    } else {
      next.properties.push({ key: prop.key, value: cloneNode(prop.value) });
    }
  }
  for (const child of node.children) {
    next.children.push(cloneNode(child));
  }
  return next;
}

/**
 * Generate a swap mapping for every GUID-bearing slot in the subtree, then
 * apply the swaps. Slots covered:
 *
 *   1. `node.id` — when it parses as 16-hex or `{16-hex}` (the entity's
 *      own GUID, e.g. an `ID "..."` property promoted to the parser's
 *      `id` slot, or a `Component "{GUID}"` instance ID).
 *   2. `ID "..."` properties — string-valued, hex shape.
 *   3. `GUID "..."` properties — same shape as above.
 *
 * Does NOT touch braced `{GUID}path/file.ext` resource refs in property
 * values — those point at *external* resources (prefabs etc.), not at
 * GUIDs owned by this entity. Rewriting them would silently dereference
 * the cloned entity's prefab inheritance.
 *
 * Returns the swap list (mostly so the caller can surface a sample).
 */
function regenerateGuidsInPlace(node: EnfusionNode, swaps: GuidSwap[]): void {
  // 1. node.id slot
  if (node.id !== undefined) {
    const stripped = node.id.replace(/^\{/, "").replace(/\}$/, "");
    if (GUID_HEX_RE.test(stripped)) {
      const next = generateGuid();
      swaps.push({ old: stripped.toUpperCase(), new: next });
      node.id = BRACED_GUID_HEX_RE.test(node.id) ? `{${next}}` : next;
    }
  }

  // 2/3. ID / GUID properties (string-valued, hex-shaped)
  for (const prop of node.properties) {
    if (typeof prop.value === "string" && (prop.key === "ID" || prop.key === "GUID")) {
      const stripped = prop.value.replace(/^\{/, "").replace(/\}$/, "");
      if (GUID_HEX_RE.test(stripped)) {
        const next = generateGuid();
        swaps.push({ old: stripped.toUpperCase(), new: next });
        prop.value = /^\{[0-9A-Fa-f]{16}\}$/.test(prop.value) ? `{${next}}` : next;
      }
    } else if (typeof prop.value !== "string") {
      regenerateGuidsInPlace(prop.value, swaps);
    }
  }

  // Recurse into children
  for (const child of node.children) {
    regenerateGuidsInPlace(child, swaps);
  }
}

/**
 * Apply a translate offset to every node that carries a top-level `coords`
 * property in the subtree. Top-level meaning "the node's own coords", not
 * arbitrary descendants — but we recurse into children so nested entities
 * (e.g. `$grp` wrappers around per-base coords) also shift.
 */
function translateInPlace(node: EnfusionNode, dx: number, dz: number): void {
  const coords = getCoords(node);
  if (coords !== null) {
    setCoords(node, coords[0] + dx, coords[1], coords[2] + dz);
  }
  for (const child of node.children) {
    translateInPlace(child, dx, dz);
  }
  for (const prop of node.properties) {
    if (typeof prop.value !== "string") {
      translateInPlace(prop.value, dx, dz);
    }
  }
}

// ── Core ─────────────────────────────────────────────────────────────────────

/**
 * Filter a parsed layer's top-level entities by the rectangular area on the
 * world XZ plane, deep-clone the matches, regenerate every embedded GUID,
 * and optionally translate the clones by `translate`.
 *
 * Pure — does not mutate `source`.
 */
export function cloneArea(
  source: EnfusionNode,
  area: Area,
  translate?: Translate,
): CloneAreaResult {
  if (area.minX > area.maxX) {
    throw new Error(`Invalid area: minX (${area.minX}) > maxX (${area.maxX})`);
  }
  if (area.minZ > area.maxZ) {
    throw new Error(`Invalid area: minZ (${area.minZ}) > maxZ (${area.maxZ})`);
  }

  const dx = translate?.x ?? 0;
  const dz = translate?.z ?? 0;
  const swaps: GuidSwap[] = [];
  const cloned: EnfusionNode[] = [];

  for (const entity of source.children) {
    const coords = getCoords(entity);
    if (coords === null) continue;
    const [x, y, z] = coords;
    if (x < area.minX || x > area.maxX) continue;
    if (z < area.minZ || z > area.maxZ) continue;
    const copy = cloneNode(entity);
    regenerateGuidsInPlace(copy, swaps);
    // Always normalize coords to the quoted form on the clone — covers both
    // the no-translate path (where the source was bare-split and would
    // round-trip as junk) and the translate path.
    setCoords(copy, x + dx, y, z + dz);
    cloned.push(copy);
  }

  return {
    clonedEntities: cloned,
    clonedCount: cloned.length,
    guidSwaps: swaps,
    translate: { x: dx, z: dz },
  };
}

// ── Multi-root layer wrappers ────────────────────────────────────────────────

/**
 * Layer files (`*.layer`, `*.conf` mission headers, etc.) are commonly emitted
 * as a sequence of top-level nodes — for example, `default.layer` opens with
 * `SCR_GameModeCampaign ... { }` immediately followed by another top-level
 * `SCR_CampaignFactionManager ... { }`. The Enfusion text parser only accepts
 * one root, so we wrap multi-root content in a synthetic outer container, then
 * unwrap when serializing back.
 *
 * Single-root files (e.g. a `.conf` that wraps everything in
 * `SCR_MissionHeaderCampaign { ... }`) round-trip identically.
 */
const LAYER_SENTINEL = "__EMCP_LAYER_ROOT__";

/**
 * Options for {@link parseLayer}.
 */
export interface ParseLayerOptions {
  /**
   * When true, treat the input as a single typed root (e.g.
   * `SCR_MissionHeaderCampaign { m_sName "Foo"; ... }`) and return the root
   * verbatim — its `properties` / `values` / `children` are the header's
   * own state and must be preserved.
   *
   * When false (default), wrap the input in a sentinel container so callers
   * can iterate `root.children` as the top-level entity list regardless of
   * how many entities the file held.
   *
   * Tools dispatch on file extension: `.conf` / `.ent` → singleRoot=true;
   * `.layer` and friends → singleRoot=false. Audit fix H-4: the previous
   * always-wrap behavior silently dropped the header root's properties when
   * the caller rebuilt the destination.
   */
  singleRoot?: boolean;
}

/**
 * Parse a layer file's text. Two shapes:
 *
 *   - Multi-root (`.layer`, or a `.conf` written by `scenario_create_conflict`
 *     as a flat sequence of top-level entities) — default. Wrap in the
 *     sentinel container so the caller can iterate the `children` array as
 *     the top-level entity list.
 *   - Single typed root (`.conf` / `.ent` with a top-level node like
 *     `SCR_MissionHeaderCampaign { ... }`) — pass `singleRoot: true`. The
 *     real root is returned unchanged; its `properties` / `values` / nested
 *     `children` survive the round-trip so the caller can rebuild the
 *     destination without dropping the header's own state.
 *
 * Defensive: when `singleRoot` is set but the wrapped parse yields zero or
 * multiple top-level nodes, fall back to the sentinel rather than silently
 * picking the first node. This catches a malformed `.conf` early.
 */
export function parseLayer(text: string, opts: ParseLayerOptions = {}): EnfusionNode {
  const wrapped = `${LAYER_SENTINEL} {\n${text}\n}\n`;
  const sentinel = parse(wrapped);
  if (opts.singleRoot && sentinel.children.length === 1) {
    // Caller signals the file is structured as a single typed root. Return
    // it directly so callers see its own type/properties/values/children,
    // not the sentinel's empty shell.
    return sentinel.children[0];
  }
  return sentinel;
}

/**
 * Serialize a layer-root container back to text. Strips the synthetic outer
 * container and re-emits each child as a top-level node, producing output
 * that matches the conventions of `scenario_create_conflict` (which writes
 * the same multi-root shape).
 */
export function serializeLayer(root: EnfusionNode): string {
  if (root.type !== LAYER_SENTINEL) {
    // Caller handed us a real single-root container — just round-trip it.
    return `${serialize(root)}\n`;
  }
  const parts: string[] = [];
  for (const child of root.children) {
    parts.push(serialize(child));
  }
  return parts.join("\n") + "\n";
}
