/**
 * Faction catalog walker — scans a project root for entity files that
 * declare a faction-affiliation key on a `SCR_FactionAffiliationComponent`,
 * grouping by faction key.
 *
 * Walks `.et` and `.conf` files under the project root, parses each via the
 * shared `parseEnfusionText` helper, and collects every node whose type
 * matches `SCR_FactionAffiliationComponent` / `FactionAffiliationComponent`.
 * The serialized property is `"faction affiliation"` (a quoted key with a
 * space) — verified against `data/kb/patterns/Modding_And_Extensions/faction-creation.md`
 * and `src/tools/wb-scenario.ts`. See `faction_list_units` docs for the
 * source of this schema.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, basename } from "node:path";
import { parse, type EnfusionNode } from "../formats/enfusion-text.js";
import { logger } from "../utils/logger.js";
import { readTextFileBounded } from "../utils/safe-read.js";

// ── Types ─────────────────────────────────────────────────────────────────────

/** One entity discovered to declare a faction affiliation. */
export interface FactionUnit {
  /** Project-relative file path (forward slashes). */
  file: string;
  /** Top-level entity type (e.g. `GenericEntity`, `Character`). */
  rootType: string;
  /** Faction key string from `"faction affiliation"`. */
  factionKey: string;
  /** Best-effort display name (m_sDisplayName on a SCR_EditableEntityComponent or similar). */
  displayName: string | null;
}

/** Result of a walk. */
export interface CatalogWalkResult {
  /** Every unit found, grouped externally by faction key. */
  units: FactionUnit[];
  /** Files that failed to parse — surfaced as warnings only. */
  parseErrors: { file: string; message: string }[];
  /** Total entity files scanned. */
  filesScanned: number;
}

// ── Extension allow-list ──────────────────────────────────────────────────────

/** File extensions that may contain entities with faction affiliation. */
const ENTITY_EXTENSIONS = new Set([".et", ".conf"]);

/** Directory names we never descend into — performance + correctness. */
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  ".vs",
  ".cache",
]);

// ── File walking ──────────────────────────────────────────────────────────────

/**
 * Recursive directory walker yielding absolute file paths matching
 * `ENTITY_EXTENSIONS`. Defensive: skips entries that throw on `statSync`
 * (broken symlinks, permission issues) rather than aborting the walk.
 */
function* walkFiles(root: string): Generator<string> {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    /* unreadable directory — skip */
    return;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(root, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      /* broken symlink / race */
      continue;
    }
    if (st.isDirectory()) {
      yield* walkFiles(full);
    } else if (st.isFile()) {
      const dot = name.lastIndexOf(".");
      if (dot < 0) continue;
      const ext = name.slice(dot).toLowerCase();
      if (ENTITY_EXTENSIONS.has(ext)) yield full;
    }
  }
}

// ── Component extraction ──────────────────────────────────────────────────────

/** Component type names that carry the `"faction affiliation"` property. */
const FACTION_COMPONENT_TYPES = new Set([
  "SCR_FactionAffiliationComponent",
  "FactionAffiliationComponent",
  "SCR_CharacterFactionAffiliationComponent",
]);

/**
 * Walk a parsed node tree, calling `visit` for every descendant. Order is
 * depth-first; the root node itself is visited.
 */
function visitAll(node: EnfusionNode, visit: (n: EnfusionNode) => void): void {
  visit(node);
  for (const child of node.children) visitAll(child, visit);
  for (const prop of node.properties) {
    if (typeof prop.value !== "string") visitAll(prop.value, visit);
  }
}

/** Read a property value off a node, treating string values only. */
function getStringProp(node: EnfusionNode, key: string): string | null {
  const prop = node.properties.find((p) => p.key === key);
  if (!prop || typeof prop.value !== "string") return null;
  return prop.value;
}

/**
 * Pull the faction-affiliation key off a single component node.
 *
 * The serialized form is `"faction affiliation" "US"` — two adjacent quoted
 * strings. The Enfusion parser tokenizes both as standalone values inside
 * `node.values`, NOT as a key-value property pair (it only recognizes
 * bare-word keys). So the strategy is:
 *
 *   1. Check `properties` for the bare-key form (`faction affiliation`
 *      isn't a valid bare identifier because of the space, but a hand-written
 *      file could use the alternative `m_FactionKey` / `m_DefaultFactionKey`
 *      identifier — handled here as a defensive fallback).
 *   2. Scan `values` for the pair `["faction affiliation", "<key>"]` —
 *      the canonical Workbench-serialized form per
 *      `data/kb/patterns/Modding_And_Extensions/faction-creation.md`.
 *
 * Returns null when the component carries no key — common for components
 * that just inherit from a prefab parent.
 */
export function extractFactionKey(component: EnfusionNode): string | null {
  // (1) Identifier-keyed fallback for hand-written or alternative schemas.
  for (const altKey of ["faction_affiliation", "m_FactionKey", "m_sFactionKey"]) {
    const v = getStringProp(component, altKey);
    if (v !== null && v.length > 0) return v;
  }
  // (2) Canonical Workbench-serialized form: paired bare quoted strings.
  const values = component.values;
  for (let i = 0; i < values.length - 1; i++) {
    if (values[i] === "faction affiliation") {
      const next = values[i + 1];
      if (typeof next === "string" && next.length > 0) return next;
    }
  }
  return null;
}

/**
 * Best-effort display name. Tries common candidates on the root node:
 *   1. `m_sDisplayName` (SCR_EditableEntityComponent on children)
 *   2. `m_sName`
 *   3. `m_sCharacterName`
 *   4. falls back to the file basename without extension.
 *
 * Returns null when nothing useful is found so the caller can decide
 * whether to suppress the column.
 */
export function extractDisplayName(
  root: EnfusionNode,
  fallbackFile: string,
): string | null {
  let best: string | null = null;
  visitAll(root, (n) => {
    if (best !== null) return;
    for (const key of ["m_sDisplayName", "m_sName", "m_sCharacterName"]) {
      const v = getStringProp(n, key);
      if (v !== null && v.length > 0) {
        best = v;
        return;
      }
    }
  });
  if (best !== null) return best;
  const base = basename(fallbackFile);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

// ── Public walker ─────────────────────────────────────────────────────────────

/**
 * Walk `projectRoot`, parse every `.et` / `.conf` file, and emit one
 * `FactionUnit` per entity that has an `SCR_FactionAffiliationComponent`
 * carrying a non-empty `"faction affiliation"` key.
 *
 * Optional `factionKey` filters the result to one key — but the full walk
 * still happens, so the same in-memory result is callable cheaply with
 * different filters. Pre-filtering during walk wasn't worth the duplication
 * given the small expected file counts (low thousands).
 *
 * `parseErrors` are surfaced rather than thrown so a single corrupt file
 * doesn't void the rest of the report. The walker is `find what you can,
 * skip what you can't`.
 */
export function walkFactionCatalog(
  projectRoot: string,
  options: { factionKey?: string } = {},
): CatalogWalkResult {
  const units: FactionUnit[] = [];
  const parseErrors: { file: string; message: string }[] = [];
  let filesScanned = 0;

  if (!existsSync(projectRoot)) {
    return { units, parseErrors, filesScanned };
  }

  for (const fullPath of walkFiles(projectRoot)) {
    filesScanned++;
    let root: EnfusionNode;
    try {
      const content = readTextFileBounded(fullPath);
      root = parse(content);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      parseErrors.push({
        file: relative(projectRoot, fullPath).split("\\").join("/"),
        message: msg,
      });
      logger.debug(`[faction-walker] parse failed for ${fullPath}: ${msg}`);
      continue;
    }

    let foundKey: string | null = null;
    visitAll(root, (n) => {
      if (foundKey !== null) return;
      if (FACTION_COMPONENT_TYPES.has(n.type)) {
        const key = extractFactionKey(n);
        if (key !== null) foundKey = key;
      }
    });
    if (foundKey === null) continue;
    // String-narrow: `foundKey` is now definitely a non-null string. TS's
    // control-flow analysis can't see through the visitor mutation, so we
    // re-assert into a local before use.
    const key: string = foundKey;
    if (options.factionKey !== undefined && key !== options.factionKey) {
      continue;
    }
    const file = relative(projectRoot, fullPath).split("\\").join("/");
    units.push({
      file,
      rootType: root.type,
      factionKey: key,
      displayName: extractDisplayName(root, file),
    });
  }

  return { units, parseErrors, filesScanned };
}

// ── Grouping helper ───────────────────────────────────────────────────────────

/**
 * Group walk results by faction key. Returns a Map keyed by faction key,
 * with stable insertion order matching first-encountered key in the input.
 */
export function groupByFaction(units: FactionUnit[]): Map<string, FactionUnit[]> {
  const out = new Map<string, FactionUnit[]>();
  for (const u of units) {
    const list = out.get(u.factionKey);
    if (list) list.push(u);
    else out.set(u.factionKey, [u]);
  }
  // Sort each group by file path for deterministic output.
  for (const [, list] of out) {
    list.sort((a, b) => a.file.localeCompare(b.file));
  }
  return out;
}
