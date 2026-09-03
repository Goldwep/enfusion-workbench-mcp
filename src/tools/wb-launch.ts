import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { basename, dirname, join, resolve } from "node:path";
import { existsSync, readdirSync } from "node:fs";
import type { Config } from "../config.js";
import { WorkbenchError, type WorkbenchClient } from "../workbench/client.js";
import { formatConnectionStatus } from "../workbench/status.js";
import { handlerErrorMessage } from "../workbench/response.js";
import { openResourceFailed } from "./wb-editor.js";

/** Project-relative paths of all .ent world files in a mod (skips Scripts/, capped walk). */
function findWorldFiles(modDir: string, maxDepth = 4): string[] {
  const found: string[] = [];
  const walk = (dir: string, rel: string, depth: number): void => {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (e.name === "Scripts" || e.name.startsWith(".")) continue;
        walk(join(dir, e.name), rel ? `${rel}/${e.name}` : e.name, depth + 1);
      } else if (e.name.endsWith(".ent")) {
        found.push(rel ? `${rel}/${e.name}` : e.name);
      }
    }
  };
  walk(modDir, "", 0);
  return found;
}

export function registerWbLaunch(server: McpServer, config: Config, client: WorkbenchClient): void {
  server.registerTool(
    "wb_launch",
    {
      description:
        "Launch Arma Reforger Workbench (Arma Reforger Tools). Automatically copies handler scripts " +
        "into the target mod's Scripts/WorkbenchGame/ directory (so NET API handlers compile as part " +
        "of the mod), starts the Workbench executable, and waits for the NET API to become available. " +
        "If the launcher holds at its Projects picker instead of auto-opening the project (waiting for a " +
        "human click on Open, often minimized), the launch auto-confirms it by restoring the window and " +
        "posting Enter; a genuine block (picker or 'Missing Addon Dependencies' modal) fails fast with a " +
        "diagnosis and dependency remedies instead of the full launch timeout. " +
        "All other wb_* tools call this automatically if Workbench is not running, so you rarely need to " +
        "call this directly. IMPORTANT: When done working with Workbench, call wb_cleanup to remove the " +
        "handler scripts from the mod before the user publishes.",
      inputSchema: {
        gprojPath: z
          .string()
          .optional()
          .describe(
            "Path to a .gproj file to open directly. Skips the Workbench launcher screen. " +
              "Handler scripts are copied into the mod so all wb_* tools work. " +
              "If omitted, Workbench opens to its launcher.",
          ),
        world: z
          .string()
          .optional()
          .describe(
            "Project-relative path of a world/scenario to open in the World Editor after launch " +
              "(e.g., 'worlds/MP/MyMission.ent'). Without an open world most entity/terrain tools " +
              "have nothing to operate on. If omitted and the mod contains exactly one .ent file, " +
              "that world is opened automatically; with several, they are listed instead.",
          ),
      },
    },
    async ({ gprojPath, world }) => {
      try {
        // Remember which addon was requested so other tools default to it
        if (gprojPath) {
          config.defaultMod = basename(dirname(resolve(gprojPath)));
        }
        const modDir = gprojPath ? dirname(resolve(gprojPath)) : null;

        // No world requested: if the mod has exactly one .ent, open it —
        // Workbench itself never auto-opens a world, so a bare launch strands
        // the editor at the home screen with no world loaded.
        let worldNote = "";
        if (!world && modDir) {
          const ents = findWorldFiles(modDir);
          if (ents.length === 1) {
            world = ents[0];
          } else if (ents.length > 1) {
            worldNote =
              `\n\nThis mod has ${ents.length} worlds — none opened automatically. ` +
              `Open one with \`wb_open_resource\`:\n` +
              ents.map((w) => `- ${w}`).join("\n");
          }
        }

        const alreadyRunning = await client.ping();
        if (!alreadyRunning) {
          await client.ensureRunning(gprojPath);
        }

        let worldFailed = false;
        if (world) {
          const openRes = await client.call<Record<string, unknown>>("EMCP_WB_EditorControl", {
            action: "openResource",
            path: world,
          });
          if (openResourceFailed(openRes)) {
            worldFailed = true;
            worldNote =
              `\n\n**World NOT opened** — \`${world}\` failed to open: ${handlerErrorMessage(openRes)}. ` +
              "Workbench is running but no world is loaded; open one with `wb_open_resource` (check the project-relative path).";
          } else {
            worldNote =
              `\n\nOpening world **${world}** in the World Editor — large worlds take ` +
              "a moment to load; `wb_state` reports edit mode with an entity count once ready.";
          }
        }

        if (alreadyRunning) {
          return {
            content: [
              {
                type: "text" as const,
                text: `**Workbench Already Running** — NET API is responding. All \`wb_*\` tools are available.${worldNote}${formatConnectionStatus(client)}`,
              },
            ],
            ...(worldFailed ? { isError: true } : {}),
          };
        }

        const note = modDir
          ? `\n\nNote: Handler scripts were copied to ${modDir}/Scripts/WorkbenchGame/EnfusionMCP/. ` +
            "Call **wb_cleanup** with the mod directory path when done to remove them before publishing."
          : "";

        // Launch-time observations (launcher picker auto-confirmed,
        // dependency visibility warnings) recorded by the client.
        const launchNotes =
          client.lastLaunchNotes.length > 0
            ? `\n\n${client.lastLaunchNotes.map((n) => `ℹ️ ${n}`).join("\n")}`
            : "";

        return {
          content: [
            {
              type: "text" as const,
              text: `**Workbench Ready** — Launched, handler scripts installed, NET API responding. All \`wb_*\` tools are available.${launchNotes}${worldNote}${note}${formatConnectionStatus(client)}`,
            },
          ],
          ...(worldFailed ? { isError: true } : {}),
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (e instanceof WorkbenchError && e.code === "LAUNCH_MISMATCH") {
          // A launch for a different .gproj is already in flight (M2). Nothing
          // was copied or started for this request — say so without the
          // "handlers copied" note.
          return {
            content: [
              {
                type: "text" as const,
                text: `**Launch Refused — different project already launching**\n\n${msg}${client.inFlightLaunchTarget ? `\nIn-flight project: ${client.inFlightLaunchTarget}` : ""}\n\nWait for that launch to finish (wb_connect), then retry.${formatConnectionStatus(client)}`,
              },
            ],
            isError: true,
          };
        }
        return {
          content: [
            {
              type: "text" as const,
              text: `**Launch Failed**\n\n${msg}${formatConnectionStatus(client)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // Cleanup tool to remove handler scripts after Workbench work is done
  server.registerTool(
    "wb_cleanup",
    {
      description:
        "Remove the temporary EnfusionMCP handler scripts from a mod's directory. " +
        "Deletes Scripts/WorkbenchGame/EnfusionMCP/ from the mod. " +
        "Call this after finishing Workbench work and before the user publishes their mod. " +
        "Safe to call even if scripts were never installed.",
      inputSchema: {
        modDir: z
          .string()
          .describe("Path to the mod's root directory (the folder containing the .gproj file)."),
      },
    },
    async ({ modDir }) => {
      // Resolve to absolute path and validate
      const resolvedModDir = resolve(modDir);
      if (!existsSync(resolvedModDir)) {
        return {
          content: [
            {
              type: "text" as const,
              text: `**Error:** Directory not found: ${modDir}${formatConnectionStatus(client)}`,
            },
          ],
          isError: true,
        };
      }
      const hasGproj = readdirSync(resolvedModDir).some((f) => f.endsWith(".gproj"));
      if (!hasGproj) {
        return {
          content: [
            {
              type: "text" as const,
              text: `**Error:** "${resolvedModDir}" does not appear to be a mod directory (no .gproj file found). Provide the mod root directory containing the .gproj file.${formatConnectionStatus(client)}`,
            },
          ],
          isError: true,
        };
      }

      const removed = client.cleanupHandlerScripts(resolvedModDir);
      if (removed) {
        return {
          content: [
            {
              type: "text" as const,
              text: `**Cleanup Complete** — EnfusionMCP handler scripts removed from the mod. The mod is ready to publish.${formatConnectionStatus(client)}`,
            },
          ],
        };
      }
      return {
        content: [
          {
            type: "text" as const,
            text: `**No Cleanup Needed** — Handler scripts were not present in the mod directory.${formatConnectionStatus(client)}`,
          },
        ],
      };
    },
  );
}
