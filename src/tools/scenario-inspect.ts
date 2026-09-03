import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, isAbsolute, basename, dirname, join, extname } from "node:path";
import type { Config } from "../config.js";
import { parse, type EnfusionNode } from "../formats/enfusion-text.js";

/**
 * Structured summary extracted from a scenario .conf tree.
 * Pure data shape — no I/O concerns.
 */
export interface ScenarioSummary {
  /** Root node type, e.g. "SCR_MissionHeaderCampaign". */
  rootType: string;
  /** className qualifier on the root if present. */
  className?: string;
  /**
   * Linked world reference. The raw value of the `World` / `m_sWorld` property.
   * Typically `{GUID}path/to/World.ent` but may be just a GUID or a bare path.
   */
  world?: string;
  /** Factions explicitly named in the .conf (m_aFactions, FactionManager entries, etc.). */
  factions: string[];
  /** Capturable base / spawn-point entries (e.g., SCR_CampaignCustomBase items). */
  baseCount: number;
  /** Objective entries (CAH areas, generic objectives). */
  objectiveCount: number;
}

/** Property keys we accept as the world link. BI uses `World`; some mods use `m_sWorld`. */
const WORLD_KEYS = ["World", "m_sWorld", "m_sWorldFile"];

/** Property keys whose value is an array of faction identifiers. */
const FACTION_LIST_KEYS = ["m_aFactions", "m_aFactionKeys", "m_FactionKeys"];

/** Node types that name a faction. */
const FACTION_NODE_TYPES = new Set([
  "SCR_Faction",
  "SCR_FactionManagerComponent",
  "FactionManager",
]);

/** Node types that count as a base / spawn anchor. */
const BASE_NODE_TYPES = new Set([
  "SCR_CampaignCustomBase",
  "SCR_CampaignMilitaryBase",
  "SCR_SpawnPoint",
  "SCR_BaseSpawnPoint",
]);

/** Property keys whose nested array entries should be counted as bases. */
const BASE_LIST_KEYS = ["m_aCampaignCustomBaseList", "m_aSpawnPoints", "m_aBases"];

/** Node types that count as an objective. */
const OBJECTIVE_NODE_TYPES = new Set([
  "SCR_CaptureAndHoldArea",
  "SCR_BaseObjective",
  "SCR_Objective",
]);

/** Property keys whose nested array entries should be counted as objectives. */
const OBJECTIVE_LIST_KEYS = ["m_aObjectives", "m_aCAHAreas", "m_aCaptureAndHoldAreaNames"];

/**
 * Walk every descendant node (preorder, including `root`).
 * Properties whose value is itself a node are also visited.
 */
function* walk(root: EnfusionNode): Iterable<EnfusionNode> {
  yield root;
  for (const child of root.children) yield* walk(child);
  for (const prop of root.properties) {
    if (typeof prop.value !== "string") yield* walk(prop.value);
  }
}

/**
 * Extract the world reference from a node's properties.
 * Returns the first matching property value (string only).
 */
function findWorldRef(root: EnfusionNode): string | undefined {
  for (const prop of root.properties) {
    if (WORLD_KEYS.includes(prop.key) && typeof prop.value === "string" && prop.value !== "") {
      return prop.value;
    }
  }
  return undefined;
}

/**
 * Extract scenario summary from a parsed Enfusion tree.
 * Pure: no FS, no DB, no parser invocation — caller passes an already-parsed root.
 */
export function extractScenarioSummary(root: EnfusionNode): ScenarioSummary {
  const factionSet = new Set<string>();
  // De-dup: when a bareword list container (e.g. `m_aObjectives { ... }`) wraps
  // typed entries (`SCR_CaptureAndHoldArea { ... }`), we'd otherwise tally both
  // the wrapper's children and each child via its node type.
  const countedBases = new Set<EnfusionNode>();
  const countedObjectives = new Set<EnfusionNode>();
  let baseCount = 0;
  let objectiveCount = 0;

  for (const node of walk(root)) {
    // Faction nodes — pull display key if available
    if (FACTION_NODE_TYPES.has(node.type) || FACTION_NODE_TYPES.has(node.className ?? "")) {
      const keyProp = node.properties.find((p) => p.key === "m_sKey" || p.key === "m_sFactionKey");
      if (keyProp && typeof keyProp.value === "string") {
        factionSet.add(keyProp.value);
      } else if (node.id) {
        factionSet.add(node.id);
      } else {
        factionSet.add(node.type);
      }
    }

    // Faction list — can appear as either a property whose value is a node,
    // or (more commonly in BI .conf output) as a bareword-named child node.
    for (const prop of node.properties) {
      if (FACTION_LIST_KEYS.includes(prop.key) && typeof prop.value !== "string") {
        for (const v of prop.value.values) factionSet.add(v);
        for (const c of prop.value.children) {
          if (c.id) factionSet.add(c.id);
          else factionSet.add(c.type);
        }
      }
    }
    if (FACTION_LIST_KEYS.includes(node.type)) {
      for (const v of node.values) factionSet.add(v);
      for (const c of node.children) {
        if (c.id) factionSet.add(c.id);
        else factionSet.add(c.type);
      }
    }

    // Base nodes — direct typed nodes, plus bareword-named list containers.
    if (
      (BASE_NODE_TYPES.has(node.type) || BASE_NODE_TYPES.has(node.className ?? "")) &&
      !countedBases.has(node)
    ) {
      countedBases.add(node);
      baseCount++;
    }
    const baseListChildren: EnfusionNode[] = [];
    for (const prop of node.properties) {
      if (BASE_LIST_KEYS.includes(prop.key) && typeof prop.value !== "string") {
        baseListChildren.push(...prop.value.children);
        baseCount += prop.value.values.length;
      }
    }
    if (BASE_LIST_KEYS.includes(node.type)) {
      baseListChildren.push(...node.children);
      baseCount += node.values.length;
    }
    for (const c of baseListChildren) {
      if (!countedBases.has(c)) {
        countedBases.add(c);
        baseCount++;
      }
    }

    // Objective nodes — direct typed nodes, plus bareword-named list containers.
    if (
      (OBJECTIVE_NODE_TYPES.has(node.type) || OBJECTIVE_NODE_TYPES.has(node.className ?? "")) &&
      !countedObjectives.has(node)
    ) {
      countedObjectives.add(node);
      objectiveCount++;
    }
    const objListChildren: EnfusionNode[] = [];
    for (const prop of node.properties) {
      if (OBJECTIVE_LIST_KEYS.includes(prop.key) && typeof prop.value !== "string") {
        objListChildren.push(...prop.value.children);
        objectiveCount += prop.value.values.length;
      }
    }
    if (OBJECTIVE_LIST_KEYS.includes(node.type)) {
      objListChildren.push(...node.children);
      objectiveCount += node.values.length;
    }
    for (const c of objListChildren) {
      if (!countedObjectives.has(c)) {
        countedObjectives.add(c);
        objectiveCount++;
      }
    }
  }

  return {
    rootType: root.type,
    className: root.className,
    world: findWorldRef(root),
    factions: [...factionSet].sort(),
    baseCount,
    objectiveCount,
  };
}

/**
 * Build a one-paragraph shape description from the summary numbers.
 * Conservative — only claims what the counts support.
 */
function describeShape(s: ScenarioSummary, layerCount: number): string {
  const parts: string[] = [];
  const cls = s.className ?? s.rootType;
  if (/Conflict|Campaign|Seize/i.test(cls)) {
    parts.push("Conflict/Campaign scenario");
  } else if (/CaptureAndHold|CAH/i.test(cls)) {
    parts.push("Capture-and-Hold scenario");
  } else if (/MissionHeader/i.test(cls)) {
    parts.push("Mission scenario");
  } else {
    parts.push(`Scenario rooted at ${cls}`);
  }
  if (s.factions.length > 0) parts.push(`with ${s.factions.length} faction(s)`);
  if (s.baseCount > 0) parts.push(`${s.baseCount} base/spawn entries`);
  if (s.objectiveCount > 0) parts.push(`${s.objectiveCount} objective(s)`);
  if (layerCount > 0) parts.push(`split across ${layerCount} layer file(s)`);
  return parts.join(", ") + ".";
}

/**
 * Render a ScenarioSummary as the markdown contract the tool documents.
 * `filename` and `layerFiles` are I/O context — passed in so the formatter
 * stays pure relative to the summary.
 */
export function formatScenarioSummary(
  s: ScenarioSummary,
  filename: string,
  layerFiles: string[] = [],
): string {
  const cls = s.className ?? "(no className)";
  const world = s.world ?? "(not set)";
  const factions = s.factions.length > 0 ? s.factions.join(", ") : "(none detected)";
  const lines = [
    `## Scenario: ${filename}`,
    "",
    `- **Game mode**: ${cls} [${s.rootType}]`,
    `- **Linked world**: ${world}`,
    `- **Factions** (${s.factions.length}): ${factions}`,
    `- **Bases/spawns**: ${s.baseCount}`,
    `- **Objectives**: ${s.objectiveCount}`,
    `- **Layer files**: ${layerFiles.length}${layerFiles.length > 0 ? ` (${layerFiles.join(", ")})` : ""}`,
    "",
    "### Detected scenario shape",
    describeShape(s, layerFiles.length),
  ];
  return lines.join("\n");
}

/**
 * Resolve scenario_path into an absolute path. Accepts absolute paths verbatim;
 * repo-relative paths are resolved against config.projectPath.
 */
function resolveScenarioPath(scenarioPath: string, projectPath: string | undefined): string {
  if (isAbsolute(scenarioPath)) return scenarioPath;
  if (!projectPath) {
    throw new Error(
      "scenario_path is relative but no project path is configured. " +
        "Provide an absolute path or set ENFUSION_PROJECT_PATH.",
    );
  }
  return resolve(projectPath, scenarioPath);
}

/**
 * Find sibling `<scenario>_Layers/*.layer` files for a given .conf path.
 * Naming convention follows scenario_create: layers live in a sibling directory
 * named after the scenario stem under Worlds/. Returns just filenames (sorted).
 */
function findSiblingLayers(confPath: string): string[] {
  const stem = basename(confPath, extname(confPath));
  // .conf usually lives under Missions/, with layers under Worlds/<stem>_Layers/
  const projectRoot = dirname(dirname(confPath));
  const candidates = [
    join(projectRoot, "Worlds", `${stem}_Layers`),
    join(dirname(confPath), `${stem}_Layers`),
  ];
  for (const dir of candidates) {
    if (!existsSync(dir)) continue;
    try {
      if (!statSync(dir).isDirectory()) continue;
      return readdirSync(dir)
        .filter((f) => f.toLowerCase().endsWith(".layer"))
        .sort();
    } catch {
      // best-effort — sibling layers are informational
    }
  }
  return [];
}

export function registerScenarioInspect(server: McpServer, config?: Config): void {
  server.registerTool(
    "scenario_inspect",
    {
      description:
        "Read-only inspector for an Enfusion scenario .conf file. " +
        "Parses the mission header and reports the game mode class, linked world, factions, " +
        "base/spawn-point count, objective count, and any sibling *_Layers/*.layer files. " +
        "Pure filesystem operation — no project-index DB required. " +
        "Complement to `scenario_create_conflict` (which writes scenarios).",
      inputSchema: {
        scenario_path: z
          .string()
          .min(1)
          .describe(
            "Path to the scenario .conf file. Absolute path, or repo-relative path resolved against the configured project path " +
              "(e.g., 'Missions/MyConflict_Everon.conf').",
          ),
      },
    },
    async ({ scenario_path }) => {
      try {
        const fullPath = resolveScenarioPath(scenario_path, config?.projectPath);

        if (!existsSync(fullPath)) {
          return {
            content: [{ type: "text" as const, text: `Scenario file not found: ${fullPath}` }],
            isError: true,
          };
        }

        const content = readFileSync(fullPath, "utf-8");
        const root = parse(content);
        const summary = extractScenarioSummary(root);
        const layerFiles = findSiblingLayers(fullPath);

        return {
          content: [
            {
              type: "text" as const,
              text: formatScenarioSummary(summary, basename(fullPath), layerFiles),
            },
          ],
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [
            { type: "text" as const, text: `Error inspecting scenario: ${msg}` },
          ],
          isError: true,
        };
      }
    },
  );
}
