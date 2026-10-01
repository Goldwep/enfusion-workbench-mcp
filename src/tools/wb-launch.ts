import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { basename, dirname, join, resolve } from "node:path";
import { existsSync, readdirSync } from "node:fs";
import type { Config } from "../config.js";
import { WorkbenchError, findDefaultModGproj, type WorkbenchClient } from "../workbench/client.js";
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
        "Requires a project: pass gprojPath, or have ENFUSION_DEFAULT_MOD name an addon folder (with a " +
        ".gproj) under the project path; without either the launch is refused and no addon is guessed. " +
        "An explicit gprojPath works even while the no-autolaunch marker exists. Launching takes the " +
        "machine-wide Workbench lease and is refused while another session holds it. Other wb_* tools " +
        "auto-launch only the ENFUSION_DEFAULT_MOD project, and never while the no-autolaunch marker " +
        "exists. IMPORTANT: When done working with Workbench, call wb_cleanup to remove the " +
        "handler scripts from the mod before the user publishes.",
      inputSchema: {
        gprojPath: z
          .string()
          .optional()
          .describe(
            "Path to a .gproj file to open directly. Skips the Workbench launcher screen. " +
              "Handler scripts are copied into the mod so all wb_* tools work. " +
              "If omitted, the ENFUSION_DEFAULT_MOD addon's .gproj is used; with no default mod " +
              "configured the launch is refused, so pass the project you want opened.",
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
        // An explicit project, or the configured default mod's project. Never
        // a guessed addon: without either, a LAUNCH is refused. A Workbench
        // that is already running needs no project to be opened, so the
        // refusal applies only when something would actually be launched.
        const explicitGproj = gprojPath ?? findDefaultModGproj(config);
        const alreadyRunning = await client.ping();
        if (!explicitGproj && !alreadyRunning) {
          return {
            content: [
              {
                type: "text" as const,
                text:
                  "**Launch Refused — no project given**\n\n" +
                  "Pass `gprojPath` (the .gproj of the addon Workbench should open). " +
                  (config.defaultMod
                    ? `The configured default mod "${config.defaultMod}" has no .gproj under ${config.projectPath}, so it cannot be used. `
                    : "No ENFUSION_DEFAULT_MOD is configured. ") +
                  "No addon is picked automatically." +
                  formatConnectionStatus(client),
              },
            ],
            isError: true,
          };
        }
        const modDir = explicitGproj ? dirname(resolve(explicitGproj)) : null;

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
              "Open one with `wb_open_resource`:\n" +
              ents.map((w) => `- ${w}`).join("\n");
          }
        }

        if (!alreadyRunning) {
          await client.ensureRunning(explicitGproj ?? undefined);
        }
        // Remember which addon was requested so other tools default to it
        // (only once the launch was not refused).
        if (gprojPath && modDir) {
          config.defaultMod = basename(modDir);
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

        const note =
          `\n\nNote: Handler scripts were copied to ${modDir}/Scripts/WorkbenchGame/EnfusionMCP/. ` +
          "Call **wb_cleanup** with the mod directory path when done to remove them before publishing.";

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
        if (e instanceof WorkbenchError && e.code === "LEASE_HELD") {
          // Another session holds the Workbench lease. Nothing was installed
          // or started for this request.
          return {
            content: [
              {
                type: "text" as const,
                text: `**Launch Refused — Workbench lease held by another session**\n\n${msg}${formatConnectionStatus(client)}`,
              },
            ],
            isError: true,
          };
        }
        if (e instanceof WorkbenchError && e.code === "AUTOLAUNCH_REFUSED") {
          return {
            content: [
              {
                type: "text" as const,
                text: `**Launch Refused — no explicit project**\n\n${msg}${formatConnectionStatus(client)}`,
              },
            ],
            isError: true,
          };
        }
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
