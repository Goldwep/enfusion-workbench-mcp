/**
 * `gm_spawn_list_export` — walk a project's `SCR_PlaceableEntitiesRegistry`
 * configs (the Game Master spawn-menu catalog) and emit a per-faction listing.
 *
 * Output is either a markdown table per faction or a JSON document. Read-only.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { existsSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { Config } from "../config.js";
import {
  buildSpawnCatalog,
  catalogToJson,
  formatCatalogMarkdown,
} from "../scenario/spawn-catalog-walker.js";

/**
 * Resolve the project path the user supplied (or fall back to `config.projectPath`)
 * to an absolute directory. Rejects leading-`-` paths so the resolved string
 * cannot smuggle a CLI flag if downstream code ever shells out.
 */
function resolveProjectRoot(input: string | undefined, fallback: string | undefined): string {
  const raw = (input ?? fallback ?? "").trim();
  if (raw === "") {
    throw new Error(
      "project_path is required when no project path is configured. " +
        "Provide an absolute path or set ENFUSION_PROJECT_PATH.",
    );
  }
  if (raw.startsWith("-")) {
    throw new Error("project_path must not start with '-' (flag-smuggle guard)");
  }
  const abs = isAbsolute(raw) ? raw : resolve(raw);
  if (!existsSync(abs)) {
    throw new Error(`Project root does not exist: ${abs}`);
  }
  if (!statSync(abs).isDirectory()) {
    throw new Error(`Project root is not a directory: ${abs}`);
  }
  return abs;
}

export function registerGmSpawnListExport(server: McpServer, config?: Config): void {
  server.registerTool(
    "gm_spawn_list_export",
    {
      description:
        "Walk a project's `SCR_PlaceableEntitiesRegistry` configs — the Game Master spawn-menu catalog — " +
          "and group spawnable prefabs by faction/category. " +
          "Returns one markdown table per faction by default, or JSON when `format='json'`. " +
          "Faction keys are inferred from the registry filename stem (e.g., `Characters_BLUFOR.conf` -> `BLUFOR`); " +
          "category is the parent directory name under `Configs/Editor/PlaceableEntities/`. " +
          "Read-only — no files are modified.",
      inputSchema: {
        project_path: z
          .string()
          .optional()
          .describe(
            "Absolute path (or one resolved against CWD) to the project root to scan. " +
              "Defaults to the configured `projectPath` (ENFUSION_PROJECT_PATH).",
          ),
        faction_filter: z
          .string()
          .optional()
          .describe(
            "Narrow the output to a single faction key (e.g., 'BLUFOR', 'US', 'Forest'). " +
              "Match is exact — omit the filter for a list of every group.",
          ),
        format: z
          .enum(["markdown", "json"])
          .default("markdown")
          .describe(
            "Output format. 'markdown' (default) yields one table per faction; " +
              "'json' yields `{factions: [{key, name, entries: [{category, display, prefab}]}]}` " +
              "wrapped in a fenced code block.",
          ),
      },
    },
    async ({ project_path, faction_filter, format }) => {
      try {
        const projectRoot = resolveProjectRoot(project_path, config?.projectPath);
        const catalog = buildSpawnCatalog(projectRoot);

        if (format === "json") {
          const json = catalogToJson(catalog, faction_filter);
          const lines: string[] = [];
          lines.push(`## GM Spawn List: ${projectRoot}`);
          lines.push("");
          lines.push("```json");
          lines.push(JSON.stringify(json, null, 2));
          lines.push("```");
          return { content: [{ type: "text" as const, text: lines.join("\n") }] };
        }

        const md = formatCatalogMarkdown(catalog, projectRoot, faction_filter);
        return { content: [{ type: "text" as const, text: md }] };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [{ type: "text" as const, text: `Error exporting GM spawn list: ${msg}` }],
          isError: true,
        };
      }
    },
  );
}
