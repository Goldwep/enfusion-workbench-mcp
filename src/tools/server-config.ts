/**
 * `server_config` — generate `server.json` for a dedicated Arma Reforger
 * server (L3-1).
 *
 * Schema: v0.9.8.73+ field names (`bindAddress` / `publicAddress` / `rcon`
 * block / `passwordAdmin` / `admins`). Old emission used deprecated names
 * which Reforger Server silently ignores; this fix is wire-compat.
 *
 * Secret handling (SEC-001/SEC-002 from the L2 security audit):
 *   - Raw config (with plaintext passwords) is written to disk.
 *   - Tool RESPONSE echoes only the REDACTED form — passwords appear as
 *     `"<redacted>"` so the LLM conversation transcript never carries
 *     plaintext credentials.
 *   - `RedactedServerConfig` enforces the boundary at the type level.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Config } from "../config.js";
import {
  buildServerConfig,
  type ServerConfigOptions,
} from "../templates/server-config.js";
import {
  redactServerConfig,
  stringifyRedacted,
} from "./server-redact.js";
import { assertInsideRoot } from "../utils/path-guard.js";

export function registerServerConfig(server: McpServer, config: Config): void {
  server.registerTool(
    "server_config",
    {
      description:
        "Generate a dedicated server config (server.json) for Arma Reforger using the current schema (v0.9.8.73+: bindAddress / publicAddress / rcon / passwordAdmin / admins). " +
        "Configures ports, mod list, scenario, game properties, RCON, and admin auth. " +
        "The tool RESPONSE shows a redacted variant — passwords appear as '<redacted>'. The actual file written to disk contains the real values. " +
        "Pair with `server_validate_config` to lint the result.",
      inputSchema: {
        name: z.string().min(1).describe("Server display name (e.g. 'My Mod Test Server')"),
        modName: z.string().optional().describe("Addon ID from .gproj (e.g. 'MyCustomMod')"),
        modId: z.string().optional().describe("Addon GUID from .gproj"),
        scenarioId: z
          .string()
          .optional()
          .describe("Scenario resource path (e.g. '{GUID}Missions/MissionHeader.conf')"),
        maxPlayers: z.number().min(1).max(128).optional().describe("Maximum players (default 32)"),
        bindPort: z.number().min(1).max(65535).optional().describe("Game host bind port (default 2001)"),
        publicPort: z
          .number()
          .min(1)
          .max(65535)
          .optional()
          .describe("Public/register port (default = bindPort)"),
        bindAddress: z.string().optional().describe("Bind address (default '0.0.0.0')"),
        publicAddress: z
          .string()
          .optional()
          .describe("Public/register address (leave empty for auto-detect)"),
        a2sPort: z.number().min(1).max(65535).optional().describe("A2S query port (default 17777)"),
        visible: z
          .boolean()
          .optional()
          .describe("Show in server browser (default false for local testing)"),
        password: z.string().optional().describe("Join password (empty = no password)"),
        passwordAdmin: z
          .string()
          .optional()
          .describe("Admin console password — sensitive, redacted on output"),
        admins: z
          .array(z.string())
          .optional()
          .describe("Admin SteamID list (Steam64 IDs as strings)"),
        rconPassword: z
          .string()
          .optional()
          .describe("If set, enables an RCON block with this password (sensitive, redacted)"),
        rconPort: z.number().min(1).max(65535).optional().describe("RCON port (default 19999)"),
        crossPlatform: z
          .boolean()
          .optional()
          .describe("Allow PC + console mixing (default false)"),
        projectPath: z
          .string()
          .optional()
          .describe("Project root to write server.json. Uses configured default if omitted."),
        overwrite: z
          .boolean()
          .optional()
          .default(false)
          .describe("Overwrite an existing server.json (default false — refuses if file exists)"),
      },
    },
    async ({
      name,
      modName,
      modId,
      scenarioId,
      maxPlayers,
      bindPort,
      publicPort,
      bindAddress,
      publicAddress,
      a2sPort,
      visible,
      password,
      passwordAdmin,
      admins,
      rconPassword,
      rconPort,
      crossPlatform,
      projectPath,
      overwrite,
    }) => {
      const basePath = projectPath || config.projectPath;
      try {
        const opts: ServerConfigOptions = {
          name,
          modName,
          modId,
          scenarioId,
          maxPlayers,
          bindPort,
          publicPort,
          bindAddress,
          publicAddress,
          a2sPort,
          visible,
          password,
          passwordAdmin,
          admins,
          crossPlatform,
        };
        if (rconPassword) {
          opts.rcon = {
            password: rconPassword,
            port: rconPort,
          };
        }

        const raw = buildServerConfig(opts);
        const rawJson = JSON.stringify(raw, null, 2);
        const redactedJson = stringifyRedacted(redactServerConfig(raw));

        if (basePath) {
          const targetPath = resolve(basePath, "server.json");
          // H7 containment: LLM-supplied projectPath must stay inside the
          // configured project root.
          assertInsideRoot(resolve(basePath), config.projectPath, "projectPath");
          assertInsideRoot(targetPath, config.projectPath, "server.json path");
          if (existsSync(targetPath) && !overwrite) {
            return {
              content: [
                {
                  type: "text" as const,
                  text:
                    `File already exists: server.json (pass overwrite=true to replace)\n\n` +
                    `Generated config (redacted, not written):\n\n\`\`\`json\n${redactedJson}\n\`\`\``,
                },
              ],
            };
          }
          writeFileSync(targetPath, rawJson, "utf-8");
          return {
            content: [
              {
                type: "text" as const,
                text:
                  `Server config written: ${targetPath}\n\n` +
                  `Redacted contents (real secrets are on disk):\n\n\`\`\`json\n${redactedJson}\n\`\`\`\n\n` +
                  `Launch with: ArmaReforgerServer.exe -config server.json`,
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text:
                `Generated server config (redacted; not written — no project path configured):\n\n` +
                `\`\`\`json\n${redactedJson}\n\`\`\`\n\n` +
                `Set ENFUSION_PROJECT_PATH or pass projectPath to write to disk.`,
            },
          ],
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [{ type: "text" as const, text: `Error creating server config: ${msg}` }],
          isError: true,
        };
      }
    },
  );
}
