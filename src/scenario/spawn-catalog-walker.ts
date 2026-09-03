/**
 * Walker + parser for `SCR_PlaceableEntitiesRegistry` configs — the Game Master
 * spawn-menu catalog. Each registry .conf points at a source directory and
 * lists prefab refs that show up under that source in the GM editor.
 *
 * Schema (confirmed by probing core paks under `Configs/Editor/PlaceableEntities/`
 * and `Prefabs/Editor/Modes/EditorModeBuilding.et` on 2026-05-21):
 *
 *   SCR_PlaceableEntitiesRegistry "{GUID}" {
 *     m_sSourceDirectory "{GUID}Prefabs/.../Faction"   // resource ref
 *     m_bExposed 1                                       // 0/1 flag
 *     m_sAddon "ArmaReforger"                            // owning addon
 *     m_Prefabs {
 *       "{GUID}Prefabs/.../X.et"
 *       "{GUID}Prefabs/.../Y.et"
 *     }
 *   }
 *
 * Faction key is heuristic: BI groups registries under
 * `Configs/Editor/PlaceableEntities/<Category>/<File>.conf`. The file stem
 * (`Characters_BLUFOR`, `Structures_Forest`) and the parent directory
 * (`Characters`, `Objects`, `Systems`) carry the grouping. We expose both:
 * `factionKey` derived from the stem suffix when present, else the parent dir;
 * `category` always = parent dir.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, join, relative, sep } from "node:path";
import { parse, type EnfusionNode } from "../formats/enfusion-text.js";

// ── Types ────────────────────────────────────────────────────────────────────

/** A single prefab listed inside an `m_Prefabs` block. */
export interface SpawnEntry {
  /** Category derived from the parent directory under `Configs/Editor/PlaceableEntities/`. */
  category: string;
  /** Display name — filename stem of the prefab (no extension). */
  display: string;
  /** Prefab path without the `{GUID}` brace prefix, e.g. `Prefabs/.../X.et`. */
  prefab: string;
  /** Original prefab ref including `{GUID}` prefix when present. */
  rawRef: string;
  /** Source file (relative to project root) that contributed this entry. */
  sourceFile: string;
}

/** A faction group — collected from one or more registry files. */
export interface FactionGroup {
  /** Stable key used for filtering (e.g., `BLUFOR`, `Forest`, `Tasks`). */
  key: string;
  /** Human-readable display name. Currently same as `key`. */
  name: string;
  /** All entries belonging to this group, in file-then-prefab order. */
  entries: SpawnEntry[];
}

/** Aggregate result of walking a project for spawn-list registries. */
export interface SpawnCatalog {
  /** Project root that was walked (absolute, normalized). */
  projectRoot: string;
  /** Number of `.conf` files inspected. */
  filesScanned: number;
  /** Number of files that successfully parsed as a registry. */
  registriesFound: number;
  /** Factions, sorted by key. */
  factions: FactionGroup[];
}

// ── Constants ────────────────────────────────────────────────────────────────

/** Root type we recognize as a spawn-list registry. */
const REGISTRY_ROOT_TYPE = "SCR_PlaceableEntitiesRegistry";

/**
 * Canonical sub-directory BI uses for these configs. We walk the entire project
 * but use this segment to derive the category. Falls back to the file's parent
 * dir name when the convention isn't followed.
 */
const CANONICAL_SUBDIR = "Configs/Editor/PlaceableEntities";

/**
 * Filename-stem suffix-extraction pattern: `Characters_BLUFOR` -> `BLUFOR`,
 * `Vehicles_USSR` -> `USSR`. Group 1 is the faction-ish suffix.
 */
const STEM_SUFFIX_RE = /_([A-Za-z0-9]+)$/;

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Strip a leading `{GUID}` brace prefix from a resource ref. Returns the path
 * portion. If the prefix is absent the ref is returned unchanged.
 */
export function stripGuidPrefix(ref: string): string {
  return ref.replace(/^\{[^}]+\}/, "");
}

/**
 * Best-effort faction key from a registry .conf path.
 *
 *  - `Configs/Editor/PlaceableEntities/Characters/Characters_BLUFOR.conf`
 *      -> key=`BLUFOR`, category=`Characters`
 *  - `Configs/Editor/PlaceableEntities/Objects/Structures_Forest.conf`
 *      -> key=`Forest`, category=`Objects`
 *  - `Configs/Editor/PlaceableEntities/Systems/Tasks.conf`
 *      -> key=`Tasks`, category=`Systems`
 *  - any other layout: parent-dir as both key and category.
 */
export function deriveFactionKey(relPath: string): { key: string; category: string } {
  const stem = basename(relPath, extname(relPath));
  const parent = basename(dirname(relPath));
  const suffix = stem.match(STEM_SUFFIX_RE)?.[1];
  if (suffix) {
    return { key: suffix, category: parent };
  }
  return { key: stem, category: parent };
}

/**
 * True if a parsed root node is (or contains, in the multi-root document case)
 * an `SCR_PlaceableEntitiesRegistry`. The parser wraps multi-root files in a
 * synthetic `_document` root, so we check both.
 */
function isRegistryNode(root: EnfusionNode): boolean {
  if (root.type === REGISTRY_ROOT_TYPE || root.className === REGISTRY_ROOT_TYPE) return true;
  for (const child of root.children) {
    if (child.type === REGISTRY_ROOT_TYPE || child.className === REGISTRY_ROOT_TYPE) return true;
  }
  return false;
}

/** Collect every registry node from a (possibly multi-root) document tree. */
function collectRegistryNodes(root: EnfusionNode): EnfusionNode[] {
  const out: EnfusionNode[] = [];
  if (root.type === REGISTRY_ROOT_TYPE || root.className === REGISTRY_ROOT_TYPE) {
    out.push(root);
  }
  for (const child of root.children) {
    if (child.type === REGISTRY_ROOT_TYPE || child.className === REGISTRY_ROOT_TYPE) {
      out.push(child);
    }
  }
  return out;
}

/**
 * Pull every prefab ref out of an `m_Prefabs` block.
 *
 * The Enfusion parser emits `m_Prefabs { ... }` as a CHILD node (type=`m_Prefabs`,
 * standalone quoted strings collected into `node.values`), not as a property.
 * We check both forms defensively: bareword-named children (the common case) and
 * properties whose value is a node (rare but possible if the parser shape ever
 * shifts).
 */
function extractPrefabRefs(registry: EnfusionNode): string[] {
  const refs: string[] = [];
  for (const child of registry.children) {
    if (child.type === "m_Prefabs") {
      for (const v of child.values) refs.push(v);
    }
  }
  for (const prop of registry.properties) {
    if (prop.key !== "m_Prefabs") continue;
    if (typeof prop.value === "string") {
      if (prop.value !== "") refs.push(prop.value);
      continue;
    }
    for (const v of prop.value.values) refs.push(v);
  }
  return refs;
}

/**
 * Walk a directory tree and return all `.conf` files (relative to `root`).
 * Opportunistic — unreadable subtrees are skipped.
 */
function findConfFiles(root: string): string[] {
  const out: string[] = [];

  function walk(abs: string): void {
    let entries: { name: string; isDir: boolean }[];
    try {
      entries = readdirSync(abs, { withFileTypes: true }).map((d) => ({
        name: d.name,
        isDir: d.isDirectory(),
      }));
    } catch {
      // unreadable dir — skip silently (opportunistic discovery)
      return;
    }
    for (const e of entries) {
      const full = join(abs, e.name);
      if (e.isDir) {
        walk(full);
      } else if (e.name.toLowerCase().endsWith(".conf")) {
        out.push(full);
      }
    }
  }

  walk(root);
  return out;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse a single registry .conf into zero or more `SpawnEntry` rows.
 * Returns `null` if the file isn't a registry (so callers can quick-skip).
 *
 * Pure: no I/O. Caller passes the already-read contents and a relative path.
 */
export function parseRegistryFile(
  content: string,
  relPath: string,
): { key: string; category: string; entries: SpawnEntry[] } | null {
  let root: EnfusionNode;
  try {
    root = parse(content);
  } catch {
    return null;
  }
  if (!isRegistryNode(root)) return null;

  const { key, category } = deriveFactionKey(relPath);
  const entries: SpawnEntry[] = [];

  for (const reg of collectRegistryNodes(root)) {
    for (const rawRef of extractPrefabRefs(reg)) {
      const stripped = stripGuidPrefix(rawRef);
      if (stripped === "") continue;
      const display = basename(stripped, extname(stripped));
      entries.push({
        category,
        display,
        prefab: stripped,
        rawRef,
        sourceFile: relPath,
      });
    }
  }

  return { key, category, entries };
}

/**
 * Walk `projectRoot` for any .conf file with root type `SCR_PlaceableEntitiesRegistry`,
 * grouping prefab entries by an inferred faction key. Read-only.
 *
 * The walker prefers `Configs/Editor/PlaceableEntities/` when it exists (the
 * canonical BI sub-directory) and falls back to the full project tree otherwise.
 */
export function buildSpawnCatalog(projectRoot: string): SpawnCatalog {
  if (!existsSync(projectRoot)) {
    throw new Error(`Project root does not exist: ${projectRoot}`);
  }
  const stat = statSync(projectRoot);
  if (!stat.isDirectory()) {
    throw new Error(`Project root is not a directory: ${projectRoot}`);
  }

  const canonicalDir = join(projectRoot, CANONICAL_SUBDIR);
  const scanRoot = existsSync(canonicalDir) ? canonicalDir : projectRoot;
  const files = findConfFiles(scanRoot);

  const groupMap = new Map<string, FactionGroup>();
  let registriesFound = 0;

  for (const abs of files) {
    let content: string;
    try {
      content = readFileSync(abs, "utf-8");
    } catch {
      // unreadable file — skip
      continue;
    }
    const rel = relative(projectRoot, abs).split(sep).join("/");
    const parsed = parseRegistryFile(content, rel);
    if (!parsed) continue;
    registriesFound++;
    if (parsed.entries.length === 0) continue;
    let group = groupMap.get(parsed.key);
    if (!group) {
      group = { key: parsed.key, name: parsed.key, entries: [] };
      groupMap.set(parsed.key, group);
    }
    group.entries.push(...parsed.entries);
  }

  // Sort groups by key for deterministic output.
  const factions = [...groupMap.values()].sort((a, b) => a.key.localeCompare(b.key));
  // Sort entries inside each faction by (category, display) for readability.
  for (const f of factions) {
    f.entries.sort((a, b) => {
      const c = a.category.localeCompare(b.category);
      return c !== 0 ? c : a.display.localeCompare(b.display);
    });
  }

  return {
    projectRoot,
    filesScanned: files.length,
    registriesFound,
    factions,
  };
}

// ── Formatters ───────────────────────────────────────────────────────────────

/**
 * Render a catalog as the markdown contract documented in the tool description.
 * Pure: no I/O.
 */
export function formatCatalogMarkdown(
  catalog: SpawnCatalog,
  projectLabel: string,
  factionFilter?: string,
): string {
  const lines: string[] = [];
  lines.push(`## GM Spawn List: ${projectLabel}`);
  lines.push("");

  const factions = factionFilter
    ? catalog.factions.filter((f) => f.key === factionFilter)
    : catalog.factions;

  if (factions.length === 0) {
    if (factionFilter) {
      const available = catalog.factions.map((f) => f.key).join(", ") || "(none)";
      lines.push(`No faction matches "${factionFilter}". Known factions: ${available}.`);
    } else if (catalog.registriesFound === 0) {
      lines.push(
        `No \`${REGISTRY_ROOT_TYPE}\` configs found under ${catalog.projectRoot}. ` +
          `Scanned ${catalog.filesScanned} .conf file(s).`,
      );
    } else {
      lines.push(
        `Found ${catalog.registriesFound} registry file(s) but none contained any prefab entries.`,
      );
    }
    return lines.join("\n");
  }

  for (const f of factions) {
    lines.push(`### Faction ${f.name} — ${f.entries.length} entries`);
    lines.push("| Category | Display | Prefab Path |");
    lines.push("|---|---|---|");
    for (const e of f.entries) {
      lines.push(`| ${e.category} | ${e.display} | ${e.prefab} |`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

/**
 * Serializable JSON view of the catalog.
 */
export function catalogToJson(
  catalog: SpawnCatalog,
  factionFilter?: string,
): { factions: Array<{ key: string; name: string; entries: SpawnEntry[] }> } {
  const factions = factionFilter
    ? catalog.factions.filter((f) => f.key === factionFilter)
    : catalog.factions;
  return {
    factions: factions.map((f) => ({ key: f.key, name: f.name, entries: f.entries })),
  };
}
