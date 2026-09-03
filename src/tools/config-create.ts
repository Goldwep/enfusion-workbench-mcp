import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import type { Config } from "../config.js";
import {
  generateConfig,
  getConfigSubdirectory,
  getConfigFilename,
  type ConfigType,
} from "../templates/config.js";
import { validateFilename } from "../utils/safe-path.js";
import { assertInsideRoot } from "../utils/path-guard.js";

export function registerConfigCreate(server: McpServer, config: Config): void {
  server.registerTool(
    "config_create",
    {
      description:
        "Create a config (.conf) file for an Arma Reforger mod. Generates faction definitions, mission headers, entity catalogs, and editor placeables in valid Enfusion text format.",
      inputSchema: {
        configType: z
          .enum(["mission-header", "faction", "entity-catalog", "editor-placeables"])
          .describe(
            "Config type. 'mission-header' for scenarios. 'faction' for faction definitions. 'entity-catalog' for categorized prefab lists. 'editor-placeables' for Game Master content.",
          ),
        name: z.string().min(1).describe("Config name (used for filename, e.g., 'MyFaction')"),
        factionKey: z
          .string()
          .optional()
          .describe("Faction identifier key (faction type). Auto-derived from name if omitted."),
        factionColor: z
          .string()
          .optional()
          .describe("Faction RGBA color string, e.g., '255,0,0,255' (faction type)"),
        flagPath: z
          .string()
          .optional()
          .describe("Resource path to faction flag texture (faction type)"),
        worldPath: z
          .string()
          .optional()
          .describe(
            "Path to .ent world file (mission-header type). For Conflict mode use the full resource ref e.g. '{9DF143A76F5C6460}worlds/MP/CTI_Campaign_Eden.ent'.",
          ),
        scenarioName: z
          .string()
          .optional()
          .describe("Display name for the scenario (mission-header type)"),
        scenarioDescription: z
          .string()
          .optional()
          .describe("Scenario description (mission-header type)"),
        missionMode: z
          .enum(["Conflict", "SF"])
          .optional()
          .describe(
            "Mission header mode (mission-header type only). " +
              "'Conflict' (default) generates SCR_MissionHeaderCampaign for multiplayer Conflict/Campaign scenarios. " +
              "'SF' generates SCR_MissionHeader for Scenario Framework single-player/co-op narrative missions.",
          ),
        author: z
          .string()
          .optional()
          .describe("Scenario author name (mission-header Conflict mode)"),
        gameModeLabel: z
          .string()
          .optional()
          .describe(
            "Game mode display name, e.g. 'Conflict', 'Seize & Secure' (mission-header Conflict mode, default 'Conflict')",
          ),
        playerCount: z
          .number()
          .optional()
          .describe("Max player count (mission-header Conflict mode, default 40)"),
        xpMultiplier: z
          .number()
          .optional()
          .describe(
            "XP multiplier, e.g. 0.5 for PvE (mission-header Conflict mode, omitted if 1.0)",
          ),
        prefabRefs: z
          .array(z.string())
          .optional()
          .describe("Prefab resource paths (entity-catalog, editor-placeables types)"),
        categoryName: z
          .string()
          .optional()
          .describe("Category name (entity-catalog, editor-placeables types)"),
        projectPath: z
          .string()
          .optional()
          .describe("Addon root path. Uses configured default if omitted."),
      },
    },
    async ({
      configType,
      name,
      factionKey,
      factionColor,
      flagPath,
      worldPath,
      scenarioName,
      scenarioDescription,
      missionMode,
      author,
      gameModeLabel,
      playerCount,
      xpMultiplier,
      prefabRefs,
      categoryName,
      projectPath,
    }) => {
      const basePath = projectPath || config.projectPath;

      try {
        validateFilename(name);

        const content = generateConfig({
          configType: configType as ConfigType,
          name,
          factionKey,
          factionColor,
          flagPath,
          worldPath,
          scenarioName,
          scenarioDescription,
          missionMode,
          author,
          gameModeLabel,
          playerCount,
          xpMultiplier,
          prefabRefs,
          categoryName,
        });

        if (basePath) {
          const subdir = getConfigSubdirectory(configType as ConfigType);
          const filename = getConfigFilename(name);
          const targetDir = resolve(basePath, subdir);
          const targetPath = join(targetDir, filename);

          // H7 containment: LLM-supplied projectPath must stay inside the
          // configured project root; check the final write path too.
          assertInsideRoot(resolve(basePath), config.projectPath, "projectPath");
          assertInsideRoot(targetPath, config.projectPath, "config path");

          mkdirSync(targetDir, { recursive: true });

          if (existsSync(targetPath)) {
            return {
              content: [
                {
                  type: "text",
                  text: `File already exists: ${subdir}/${filename}\n\nGenerated content (not written):\n\n\`\`\`\n${content}\n\`\`\``,
                },
              ],
            };
          }

          writeFileSync(targetPath, content, "utf-8");

          return {
            content: [
              {
                type: "text",
                text: `Config created: ${subdir}/${filename}\n\n\`\`\`\n${content}\n\`\`\``,
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text",
              text: `Generated config (no project path configured — not written to disk):\n\n\`\`\`\n${content}\n\`\`\`\n\nSet ENFUSION_PROJECT_PATH to write files automatically.`,
            },
          ],
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [{ type: "text", text: `Error creating config: ${msg}` }],
          isError: true,
        };
      }
    },
  );
}
