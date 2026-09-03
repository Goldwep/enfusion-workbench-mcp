import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { parse, type EnfusionNode } from "../formats/enfusion-text.js";

/**
 * High-level structural shape of a scenario .conf, suitable for diffing the
 * Beta-Branch version of a scenario against the main version without drowning
 * the user in per-property noise (which is what `world_diff` is for).
 *
 * Everything that genuinely lives in a .conf is extracted directly; fields
 * that conventionally live in linked layer files (factions, objectives,
 * layer set) are best-effort — populated only when the .conf actually
 * carries them as overrides.
 */
export interface ScenarioShape {
  /** Root type, e.g. "SCR_MissionHeaderCampaign", "SCR_MissionHeader". */
  gameModeClass: string;
  /** Resource ref from the `World` property, or null when absent. */
  linkedWorld: string | null;
  /** Factions extracted from `m_aFactions` (rarely in .conf, but possible). */
  factions: string[];
  /** Count of bases listed under `m_aCampaignCustomBaseList`. */
  baseCount: number;
  /** Count of objective-like entries (m_aTasksConfig / m_aObjective*). */
  objectiveCount: number;
  /** Layer file refs if any (most .conf files don't list these). */
  layerFiles: string[];
  /**
   * Flat key→value map of scalar properties at the root, for the
   * "Changed properties" section. Skips composite children to keep noise low.
   */
  scalars: Record<string, string>;
}

export interface ScenarioDiffSummary {
  before: { path: string; shape: ScenarioShape };
  after: { path: string; shape: ScenarioShape };
  gameModeChanged: boolean;
  linkedWorldChanged: boolean;
  factionsAdded: string[];
  factionsRemoved: string[];
  baseDelta: number;
  objectiveDelta: number;
  layersAdded: string[];
  layersRemoved: string[];
  /** Scalar properties whose stringified value differs between before/after. */
  changedScalars: Array<{ key: string; before: string | null; after: string | null }>;
}

const OBJECTIVE_KEYS = new Set([
  "m_aTasksConfig",
  "m_aObjective",
  "m_aObjectives",
  "m_aTasks",
]);

const LAYER_KEYS = new Set(["m_aLayers", "m_aMissionLayers", "m_aLayerFiles"]);

/**
 * Pull the structural shape out of a parsed scenario .conf root.
 *
 * Pure — no FS, no I/O. Safe to call on synthetic trees in tests.
 */
export function extractScenarioShape(root: EnfusionNode): ScenarioShape {
  const scalars: Record<string, string> = {};
  let linkedWorld: string | null = null;
  let baseCount = 0;
  let objectiveCount = 0;
  const factions: string[] = [];
  const layerFiles: string[] = [];

  for (const prop of root.properties) {
    if (typeof prop.value === "string") {
      scalars[prop.key] = prop.value;
      if (prop.key === "World") linkedWorld = prop.value;
    } else {
      // Property whose value is a sub-node (e.g., m_aCampaignCustomBaseList { ... })
      const sub = prop.value;
      if (prop.key === "m_aCampaignCustomBaseList") {
        baseCount += sub.children.length;
      } else if (prop.key === "m_aFactions") {
        // Factions can appear as bare values, child node ids, or string props
        for (const v of sub.values) factions.push(v);
        for (const c of sub.children) {
          if (c.id) factions.push(c.id);
          else factions.push(c.type);
        }
      } else if (OBJECTIVE_KEYS.has(prop.key)) {
        objectiveCount += sub.children.length + sub.values.length;
      } else if (LAYER_KEYS.has(prop.key)) {
        for (const v of sub.values) layerFiles.push(v);
      }
    }
  }

  // Some scenario.conf variants put bases / factions as direct children rather
  // than property-valued sub-nodes. Cover that shape too.
  for (const child of root.children) {
    if (child.type === "m_aCampaignCustomBaseList") {
      baseCount += child.children.length;
    } else if (child.type === "SCR_CampaignCustomBase") {
      baseCount += 1;
    } else if (child.type === "m_aFactions") {
      for (const v of child.values) factions.push(v);
      for (const c of child.children) factions.push(c.id ?? c.type);
    }
  }

  return {
    gameModeClass: root.type,
    linkedWorld,
    factions: [...new Set(factions)].sort(),
    baseCount,
    objectiveCount,
    layerFiles: [...new Set(layerFiles)].sort(),
    scalars,
  };
}

/** Pure structural diff. No formatting, no I/O. */
export function diffScenarios(
  before: { path: string; shape: ScenarioShape },
  after: { path: string; shape: ScenarioShape },
): ScenarioDiffSummary {
  const beforeFactions = new Set(before.shape.factions);
  const afterFactions = new Set(after.shape.factions);
  const beforeLayers = new Set(before.shape.layerFiles);
  const afterLayers = new Set(after.shape.layerFiles);

  const scalarKeys = new Set([
    ...Object.keys(before.shape.scalars),
    ...Object.keys(after.shape.scalars),
  ]);
  const changedScalars: ScenarioDiffSummary["changedScalars"] = [];
  for (const key of [...scalarKeys].sort()) {
    // World is reported on its own line — don't double-print it here.
    if (key === "World") continue;
    const b = before.shape.scalars[key] ?? null;
    const a = after.shape.scalars[key] ?? null;
    if (b !== a) changedScalars.push({ key, before: b, after: a });
  }

  return {
    before,
    after,
    gameModeChanged: before.shape.gameModeClass !== after.shape.gameModeClass,
    linkedWorldChanged: before.shape.linkedWorld !== after.shape.linkedWorld,
    factionsAdded: [...afterFactions].filter((f) => !beforeFactions.has(f)).sort(),
    factionsRemoved: [...beforeFactions].filter((f) => !afterFactions.has(f)).sort(),
    baseDelta: after.shape.baseCount - before.shape.baseCount,
    objectiveDelta: after.shape.objectiveCount - before.shape.objectiveCount,
    layersAdded: [...afterLayers].filter((l) => !beforeLayers.has(l)).sort(),
    layersRemoved: [...beforeLayers].filter((l) => !afterLayers.has(l)).sort(),
    changedScalars,
  };
}

function fmtSet(items: string[]): string {
  return items.length === 0 ? "{}" : `{${items.join(", ")}}`;
}

function fmtDelta(delta: number): string {
  if (delta === 0) return "unchanged";
  return delta > 0 ? `+${delta}` : `${delta}`;
}

/** Pure markdown formatter — accepts the summary and renders the report. */
export function formatScenarioDiff(d: ScenarioDiffSummary): string {
  const lines: string[] = [];
  const beforeName = basename(d.before.path);
  const afterName = basename(d.after.path);
  lines.push(`## Scenario diff: ${beforeName} -> ${afterName}`);
  lines.push("");

  lines.push(
    `- Game mode: ${d.before.shape.gameModeClass} -> ${d.after.shape.gameModeClass}  [${d.gameModeChanged ? "CHANGED" : "unchanged"}]`,
  );
  lines.push(
    `- Linked world: ${d.before.shape.linkedWorld ?? "(none)"} -> ${d.after.shape.linkedWorld ?? "(none)"}  [${d.linkedWorldChanged ? "CHANGED" : "unchanged"}]`,
  );

  const factionTags: string[] = [];
  if (d.factionsAdded.length > 0) factionTags.push(`added: ${d.factionsAdded.join(", ")}`);
  if (d.factionsRemoved.length > 0) factionTags.push(`removed: ${d.factionsRemoved.join(", ")}`);
  const factionTag = factionTags.length > 0 ? `  [${factionTags.join("; ")}]` : "  [unchanged]";
  lines.push(
    `- Factions: ${fmtSet(d.before.shape.factions)} -> ${fmtSet(d.after.shape.factions)}${factionTag}`,
  );

  lines.push(
    `- Bases/spawns: ${d.before.shape.baseCount} -> ${d.after.shape.baseCount}  [${fmtDelta(d.baseDelta)}]`,
  );
  lines.push(
    `- Objectives: ${d.before.shape.objectiveCount} -> ${d.after.shape.objectiveCount}  [${fmtDelta(d.objectiveDelta)}]`,
  );

  const layerTags: string[] = [];
  if (d.layersAdded.length > 0) layerTags.push(`added: ${d.layersAdded.join(", ")}`);
  if (d.layersRemoved.length > 0) layerTags.push(`removed: ${d.layersRemoved.join(", ")}`);
  const layerTag = layerTags.length > 0 ? `  [${layerTags.join("; ")}]` : "  [unchanged]";
  lines.push(
    `- Layer files: ${fmtSet(d.before.shape.layerFiles)} -> ${fmtSet(d.after.shape.layerFiles)}${layerTag}`,
  );

  if (d.changedScalars.length > 0) {
    lines.push("");
    lines.push("### Changed properties");
    for (const c of d.changedScalars) {
      const b = c.before === null ? "(absent)" : `"${c.before}"`;
      const a = c.after === null ? "(absent)" : `"${c.after}"`;
      lines.push(`  - ${c.key}: ${b} -> ${a}`);
    }
  }

  return lines.join("\n");
}

/** Format a standard error response (success-shaped IS error path). */
function errorResponse(msg: string) {
  return {
    content: [{ type: "text" as const, text: msg }],
    isError: true,
  };
}

export function registerScenarioDiff(server: McpServer): void {
  server.registerTool(
    "scenario_diff",
    {
      description:
        "Compute a high-level structural diff between two scenario .conf files. " +
        "Reports per-section deltas (game-mode class, linked world, factions, base/spawn count, objective count, layer set) " +
        "plus a list of scalar properties whose values differ. " +
        "Differs from `world_diff` (per-entity): this is per-section summary, useful for spotting what changed between a " +
        "Beta-Branch version of a scenario and its main-branch counterpart before merging. " +
        "Pure filesystem read — no project-index dependency.",
      inputSchema: {
        before_path: z
          .string()
          .describe("Absolute path to the BEFORE scenario .conf (e.g., main-branch version)."),
        after_path: z
          .string()
          .describe("Absolute path to the AFTER scenario .conf (e.g., Beta-Branch version)."),
      },
    },
    async ({ before_path, after_path }) => {
      try {
        let beforeContent: string;
        let afterContent: string;
        try {
          beforeContent = readFileSync(before_path, "utf-8");
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return errorResponse(`Error reading before_path "${before_path}": ${msg}`);
        }
        try {
          afterContent = readFileSync(after_path, "utf-8");
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return errorResponse(`Error reading after_path "${after_path}": ${msg}`);
        }

        let beforeRoot: EnfusionNode;
        let afterRoot: EnfusionNode;
        try {
          beforeRoot = parse(beforeContent);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return errorResponse(`Error parsing before_path "${before_path}": ${msg}`);
        }
        try {
          afterRoot = parse(afterContent);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return errorResponse(`Error parsing after_path "${after_path}": ${msg}`);
        }

        const summary = diffScenarios(
          { path: before_path, shape: extractScenarioShape(beforeRoot) },
          { path: after_path, shape: extractScenarioShape(afterRoot) },
        );

        return {
          content: [{ type: "text" as const, text: formatScenarioDiff(summary) }],
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return errorResponse(`Error computing scenario diff: ${msg}`);
      }
    },
  );
}
