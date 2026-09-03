/**
 * `faction_list_units` — walk a project, group entities by faction key, and
 * emit a markdown report (L8).
 *
 * Discovery method: parse every `.et` / `.conf` under the project root, look
 * for any node typed `SCR_FactionAffiliationComponent` (or its base
 * `FactionAffiliationComponent` / specialized `SCR_CharacterFactionAffiliationComponent`),
 * read its `"faction affiliation"` property, and emit one row per entity.
 *
 * Schema source: the `"faction affiliation"` property name was verified
 * against `src/tools/wb-scenario.ts` (lines 531, 588) and
 * `data/kb/patterns/Modding_And_Extensions/faction-creation.md` (line 107).
 * Probe of `data/api/arma-classes.json` shows `FactionAffiliationComponent`
 * has zero serialized properties documented — the visible-to-Workbench
 * property name comes from the C++ component's serializer, hence the
 * quoted-with-space key style.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolve } from "node:path";
import type { Config } from "../config.js";
import {
  walkFactionCatalog,
  groupByFaction,
  type FactionUnit,
} from "../faction/catalog-walker.js";

// ── Formatter (exported for tests) ────────────────────────────────────────────

/**
 * Render the walk result as the markdown the tool returns. The format is
 * pinned by the docs so the LLM can rely on the shape across versions.
 *
 * Example output:
 *
 *     ## Factions in /path/to/project
 *
 *     ### US — 3 units
 *     | File | Class | Display Name |
 *     |---|---|---|
 *     | Prefabs/Vehicles/UAZ.et | GenericEntity | UAZ-469 |
 *     ...
 *
 *     (parse errors: 2 — see below)
 *     ...
 */
export function formatFactionList(input: {
  projectRoot: string;
  units: FactionUnit[];
  parseErrors: { file: string; message: string }[];
  filesScanned: number;
  factionFilter: string | null;
}): string {
  const { projectRoot, units, parseErrors, filesScanned, factionFilter } = input;
  const lines: string[] = [];
  lines.push(`## Factions in ${projectRoot}`);
  lines.push("");
  if (factionFilter !== null) {
    lines.push(`Filter: faction_key = \`${factionFilter}\``);
    lines.push("");
  }
  lines.push(
    `Scanned ${filesScanned} entity file${filesScanned !== 1 ? "s" : ""}.`,
  );
  lines.push("");

  if (units.length === 0) {
    if (factionFilter !== null) {
      lines.push(
        `No entities found with \`"faction affiliation"\` = \`${factionFilter}\`. ` +
          "Either no entity declares this key, or the key spelling differs (the property is case-sensitive).",
      );
    } else {
      lines.push(
        "No entities found declaring a `\"faction affiliation\"` on a " +
          "`SCR_FactionAffiliationComponent`. Either this project has no " +
          "faction-bound entities, or all affiliations are inherited from " +
          "parent prefabs (the walker does not chase inheritance).",
      );
    }
  } else {
    const groups = groupByFaction(units);
    // Stable display order: alphabetic by faction key.
    const sortedKeys = [...groups.keys()].sort((a, b) => a.localeCompare(b));
    for (const key of sortedKeys) {
      const groupUnits = groups.get(key)!;
      lines.push(`### ${key} — ${groupUnits.length} unit${groupUnits.length !== 1 ? "s" : ""}`);
      lines.push("| File | Class | Display Name |");
      lines.push("|---|---|---|");
      for (const u of groupUnits) {
        const name = u.displayName ?? "—";
        lines.push(`| ${u.file} | ${u.rootType} | ${name} |`);
      }
      lines.push("");
    }
  }

  if (parseErrors.length > 0) {
    lines.push(`### Parse errors (${parseErrors.length})`);
    for (const err of parseErrors.slice(0, 25)) {
      lines.push(`- \`${err.file}\` — ${err.message}`);
    }
    if (parseErrors.length > 25) {
      lines.push(`... and ${parseErrors.length - 25} more (truncated).`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ── Registration ──────────────────────────────────────────────────────────────

export function registerFactionListUnits(server: McpServer, config: Config): void {
  server.registerTool(
    "faction_list_units",
    {
      description:
        "Walk a project root, parse every .et / .conf entity, and group those that " +
        "declare a faction affiliation by faction key. Emits a markdown table " +
        "per faction with file, root class, and best-effort display name. " +
        "Use this to audit which entities belong to which faction, or to find orphans " +
        "after renaming a faction key. Note: the walker reads the literal `\"faction affiliation\"` " +
        "property on `SCR_FactionAffiliationComponent` — it does NOT resolve affiliations inherited " +
        "from a parent prefab (those would require an inheritance walk, not supported here).",
      inputSchema: {
        project_path: z
          .string()
          .optional()
          .describe(
            "Project root to scan. Defaults to the configured projectPath. " +
              "Must not start with '-' (flag-smuggle guard).",
          ),
        faction_key: z
          .string()
          .optional()
          .describe(
            "Filter to a single faction key (e.g. 'US'). When omitted, every faction key found is reported. " +
              "Comparison is case-sensitive, matching the engine's behavior.",
          ),
      },
    },
    async ({ project_path, faction_key }) => {
      try {
        if (project_path !== undefined && project_path.startsWith("-")) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Invalid project_path: must not start with '-' (got: ${project_path})`,
              },
            ],
            isError: true,
          };
        }
        const rawPath = project_path ?? config.projectPath;
        if (!rawPath) {
          return {
            content: [
              {
                type: "text" as const,
                text:
                  "No project_path configured. Set ENFUSION_PROJECT_PATH or pass project_path explicitly.",
              },
            ],
            isError: true,
          };
        }
        const projectRoot = resolve(rawPath);

        const walkResult = walkFactionCatalog(projectRoot, {
          factionKey: faction_key,
        });

        const text = formatFactionList({
          projectRoot,
          units: walkResult.units,
          parseErrors: walkResult.parseErrors,
          filesScanned: walkResult.filesScanned,
          factionFilter: faction_key ?? null,
        });

        return { content: [{ type: "text" as const, text }] };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [
            { type: "text" as const, text: `Error listing faction units: ${msg}` },
          ],
          isError: true,
        };
      }
    },
  );
}
