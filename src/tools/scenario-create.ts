import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { mkdirSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { resolve, join } from "node:path";
import type { Config } from "../config.js";
import {
  generateConflictScenario,
  KNOWN_WORLDS,
  type ConflictBaseSpec,
} from "../templates/scenario.js";
import { validateFilename } from "../utils/safe-path.js";
import { assertInsideRoot } from "../utils/path-guard.js";

const BASE_SPEC_SCHEMA = z.object({
  name: z.string().min(1).describe("callsign, no spaces; entity name and header whitelist entry"),
  position: z.string().describe("'x y z'; Y=0 is fine (snapped on open)"),
  faction: z.string().describe("Starting faction key: 'US', 'USSR', 'FIA', or a custom key."),
  type: z
    .enum(["base", "major", "MOB", "controlPoint", "sourceBase", "harbor"])
    .optional()
    .describe(
      "base (default, contested), major (with CAH areas), MOB (HQ, not seizable), " +
        "controlPoint, sourceBase (supply only), harbor (supply income, not in Bases.layer)",
    ),
  radioRange: z
    .number()
    .optional()
    .describe("ignored: 1.9.0.37 has no base radio-range property"),
  patrolCount: z
    .number()
    .min(0)
    .max(6)
    .optional()
    .describe("Number of ambient patrol spawnpoints around this base (0-6, default 2)."),
});

export function registerScenarioCreate(server: McpServer, config: Config): void {
  server.registerTool(
    "scenario_create_conflict",
    {
      description:
        "Generate a Conflict scenario (up to 7 files): mission header .conf, SubScene .ent, and layers " +
        "default (game mode, managers), Bases, CAH (major-base capture zones), Defenders, and " +
        "AmbientVehicles (when civVehicleCount > 0). " +
        "Known worlds: " +
        KNOWN_WORLDS.join(", ") +
        ". " +
        "Open the .ent in Workbench afterwards to snap entities to terrain.",
      inputSchema: {
        scenarioName: z.string().min(1).describe("file name, no spaces; display name by default"),
        scenarioDisplayName: z.string().optional(),
        worldName: z.string().describe("a known world or a {GUID}worlds/X.ent ref"),
        bases: z
          .array(BASE_SPEC_SCHEMA)
          .min(1)
          .describe("bases to place: at least one MOB per faction and 2+ contested bases"),
        playerCount: z
          .number()
          .min(1)
          .max(256)
          .optional()
          .describe("Max player count (default 40)."),
        xpMultiplier: z.number().optional().describe("default 1.0; 0.5 suits PvE"),
        savingEnabled: z
          .boolean()
          .optional()
          .describe("Enable Conflict persistence/saving (default true)."),
        gameModeLabel: z
          .string()
          .optional()
          .describe("Game mode display label shown in the server browser (default 'Conflict')."),
        description: z
          .string()
          .optional()
          .describe("Scenario description shown in the mission browser."),
        author: z.string().optional().describe("Author name shown in the mission browser."),
        civVehicleCount: z
          .number()
          .min(0)
          .max(50)
          .optional()
          .describe("civilian vehicle spawnpoints, default 0"),
        projectPath: z
          .string()
          .optional()
          .describe("Addon root path. Uses configured default if omitted."),
      },
    },
    async ({
      scenarioName,
      scenarioDisplayName,
      worldName,
      bases,
      playerCount,
      xpMultiplier,
      savingEnabled,
      gameModeLabel,
      description,
      author,
      civVehicleCount,
      projectPath,
    }) => {
      try {
        validateFilename(scenarioName);

        const output = generateConflictScenario({
          scenarioName: scenarioDisplayName ?? scenarioName,
          worldName,
          bases: bases as ConflictBaseSpec[],
          playerCount,
          xpMultiplier,
          savingEnabled,
          gameModeLabel,
          description,
          author,
          civVehicleCount,
        });

        const basePath = projectPath || config.projectPath;

        if (basePath) {
          // H7 containment: LLM-supplied projectPath must stay inside the
          // configured project root. Every write below derives from it.
          assertInsideRoot(resolve(basePath), config.projectPath, "projectPath");
          const missionsDir = resolve(basePath, "Missions");
          const worldsDir = resolve(basePath, "Worlds");
          const layersDir = resolve(basePath, "Worlds", `${scenarioName}_Layers`);
          const confPath = join(missionsDir, `${scenarioName}.conf`);
          const entPath = join(worldsDir, `${scenarioName}.ent`);
          const defaultLayPath = join(layersDir, "default.layer");
          const basesLayPath = join(layersDir, "Bases.layer");
          const cahLayPath = join(layersDir, "CAH.layer");
          const defendersLayPath = join(layersDir, "Defenders.layer");
          const vehiclesLayPath = join(layersDir, "AmbientVehicles.layer");
          assertInsideRoot(layersDir, config.projectPath, "layers path");

          mkdirSync(missionsDir, { recursive: true });
          mkdirSync(worldsDir, { recursive: true });
          mkdirSync(layersDir, { recursive: true });

          const existing: string[] = [];
          if (existsSync(confPath)) existing.push(`Missions/${scenarioName}.conf`);
          if (existsSync(entPath)) existing.push(`Worlds/${scenarioName}.ent`);
          if (existsSync(defaultLayPath))
            existing.push(`Worlds/${scenarioName}_Layers/default.layer`);
          if (existsSync(basesLayPath)) existing.push(`Worlds/${scenarioName}_Layers/Bases.layer`);
          if (existsSync(defendersLayPath))
            existing.push(`Worlds/${scenarioName}_Layers/Defenders.layer`);
          if (existsSync(cahLayPath)) existing.push(`Worlds/${scenarioName}_Layers/CAH.layer`);
          if (existsSync(vehiclesLayPath))
            existing.push(`Worlds/${scenarioName}_Layers/AmbientVehicles.layer`);

          if (existing.length > 0) {
            return {
              content: [
                {
                  type: "text" as const,
                  text:
                    `Files already exist: ${existing.join(", ")}\n\n` +
                    "Generated content (not written):\n\n" +
                    `**Missions/${scenarioName}.conf**\n\`\`\`\n${output.missionConf}\n\`\`\`\n\n` +
                    `**Worlds/${scenarioName}.ent**\n\`\`\`\n${output.worldEnt}\n\`\`\`\n\n` +
                    `**Worlds/${scenarioName}_Layers/default.layer**\n\`\`\`\n${output.defaultLayer}\n\`\`\`\n\n` +
                    `**Worlds/${scenarioName}_Layers/Bases.layer**\n\`\`\`\n${output.basesLayer}\n\`\`\``,
                },
              ],
            };
          }

          // Write all files with rollback on partial failure. Exclusive creates (flag wx): a file
          // that appeared after the existence check above is never replaced.
          const writtenPaths: string[] = [];
          try {
            writeFileSync(confPath, output.missionConf, { encoding: "utf-8", flag: "wx" });
            writtenPaths.push(confPath);
            writeFileSync(entPath, output.worldEnt, { encoding: "utf-8", flag: "wx" });
            writtenPaths.push(entPath);
            writeFileSync(defaultLayPath, output.defaultLayer, { encoding: "utf-8", flag: "wx" });
            writtenPaths.push(defaultLayPath);
            writeFileSync(basesLayPath, output.basesLayer, { encoding: "utf-8", flag: "wx" });
            writtenPaths.push(basesLayPath);
            writeFileSync(defendersLayPath, output.defendersLayer, { encoding: "utf-8", flag: "wx" });
            writtenPaths.push(defendersLayPath);
            if (output.cahLayer) {
              writeFileSync(cahLayPath, output.cahLayer, { encoding: "utf-8", flag: "wx" });
              writtenPaths.push(cahLayPath);
            }
            if (output.ambientVehiclesLayer) {
              writeFileSync(vehiclesLayPath, output.ambientVehiclesLayer, { encoding: "utf-8", flag: "wx" });
              writtenPaths.push(vehiclesLayPath);
            }
          } catch (writeErr) {
            // Rollback: remove any files we already wrote to avoid partial scenarios
            for (const p of writtenPaths) {
              try {
                unlinkSync(p);
              } catch {
                /* best-effort cleanup */
              }
            }
            throw writeErr;
          }

          const factions = [...new Set(bases.map((b) => b.faction))];
          const writtenFiles = [
            `  Missions/${scenarioName}.conf`,
            `  Worlds/${scenarioName}.ent`,
            `  Worlds/${scenarioName}_Layers/default.layer`,
            `  Worlds/${scenarioName}_Layers/Bases.layer`,
            `  Worlds/${scenarioName}_Layers/Defenders.layer`,
            ...(output.cahLayer ? [`  Worlds/${scenarioName}_Layers/CAH.layer`] : []),
            ...(output.ambientVehiclesLayer
              ? [`  Worlds/${scenarioName}_Layers/AmbientVehicles.layer`]
              : []),
          ];

          return {
            content: [
              {
                type: "text" as const,
                text: [
                  `**Conflict scenario created: ${scenarioName}**`,
                  "",
                  "Files written:",
                  ...writtenFiles,
                  "",
                  `Bases (${bases.length}): ${bases.map((b) => `${b.name} [${b.type ?? "base"}, ${b.faction}]`).join(", ")}`,
                  `Factions: ${factions.join(", ")}`,
                  `Players: ${playerCount ?? 40}`,
                  "",
                  "Next steps:",
                  `1. Open Worlds/${scenarioName}.ent in Workbench.`,
                  '2. Select all base entities and use "Snap to Terrain" to fix Y positions.',
                  "3. Adjust patrol spawnpoint positions around each base (currently offset ±30m).",
                  "4. Add defender spawnpoints (SCR_DefenderSpawnerComponent) inside base buildings.",
                  "5. Add ConflictRelayRadio entities between distant bases to extend radio coverage.",
                  "6. Save and run a test with the scenario in the server browser.",
                ].join("\n"),
              },
            ],
          };
        }

        // No project path — return generated content only
        const parts: string[] = [
          "Generated conflict scenario (no project path configured — not written to disk):",
          "",
          `**Missions/${scenarioName}.conf**`,
          "```",
          output.missionConf,
          "```",
          "",
          `**Worlds/${scenarioName}.ent**`,
          "```",
          output.worldEnt,
          "```",
          "",
          `**Worlds/${scenarioName}_Layers/default.layer**`,
          "```",
          output.defaultLayer,
          "```",
          "",
          `**Worlds/${scenarioName}_Layers/Bases.layer**`,
          "```",
          output.basesLayer,
          "```",
          "",
          `**Worlds/${scenarioName}_Layers/Defenders.layer**`,
          "```",
          output.defendersLayer,
          "```",
        ];
        if (output.cahLayer) {
          parts.push(
            "",
            `**Worlds/${scenarioName}_Layers/CAH.layer**`,
            "```",
            output.cahLayer,
            "```",
          );
        }
        if (output.ambientVehiclesLayer) {
          parts.push(
            "",
            `**Worlds/${scenarioName}_Layers/AmbientVehicles.layer**`,
            "```",
            output.ambientVehiclesLayer,
            "```",
          );
        }
        parts.push("", "Set ENFUSION_PROJECT_PATH to write files automatically.");
        return {
          content: [{ type: "text" as const, text: parts.join("\n") }],
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [{ type: "text" as const, text: `Error creating scenario: ${msg}` }],
          isError: true,
        };
      }
    },
  );
}
