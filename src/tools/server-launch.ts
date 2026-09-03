/**
 * `server_launch` — MCP wrapper around the L8 server-mgmt launch core.
 *
 * This is the ONLY place that calls `spawn()` for ArmaReforgerServer.exe.
 * The validation work happens in `src/server-mgmt/launch.ts`; this module
 * is the I/O boundary (spawn, read+redact config, format response).
 *
 * Security checklist for this file:
 *   - `dry_run` defaults to `true` — spawn is opt-in
 *   - `shell: false` — argv is passed as an array, no shell-string
 *   - All path inputs go through `rejectFlagLikePath` BEFORE `resolve()`
 *   - extra_args are gated by the strict EXTRA_ARG_RE in launch.ts
 *   - Response NEVER echoes the raw server.json — only the redacted view
 *   - Child PID surfaced for visibility; no wait() on completion
 *   - PID file written next to server.json; second concurrent launch
 *     refused unless `force=true`. Companion `server_stop` cleans up.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { spawn } from "node:child_process";
import { dirname } from "node:path";
import type { Config } from "../config.js";
import {
  buildLaunchArgv,
  checkRunningServer,
  DEFAULT_SERVER_EXE_PATH,
  deletePidFile,
  pidFilePathFor,
  prepareLaunchInputs,
  probeServerExe,
  writePidFile,
} from "../server-mgmt/launch.js";
import {
  readRedactedServerConfig,
} from "../server-mgmt/redact-io.js";
import { stringifyRedacted } from "./server-redact.js";
import { logger } from "../utils/logger.js";

export function registerServerLaunch(server: McpServer, _config: Config): void {
  server.registerTool(
    "server_launch",
    {
      description:
        "Launch ArmaReforgerServer.exe (the dedicated server — separate from the Workbench/game install, Steam app 1874900) " +
        "with the supplied server.json and scenarioId. Always defaults to dry_run=true: the tool prints the argv that " +
        "WOULD run plus a redacted view of the config, but does not spawn unless dry_run is explicitly false. " +
        "Passwords are never echoed — uses RedactedServerConfig at the type boundary. " +
        "On a real spawn, writes `<dirname(server_config_path)>/.arma-reforger-server.pid` and refuses a second " +
        "concurrent launch against the same server.json unless `force=true`. Use `server_stop` to terminate.",
      inputSchema: {
        server_config_path: z
          .string()
          .describe("Absolute path to the server.json to launch with."),
        scenario_id: z
          .string()
          .describe(
            "Full scenarioId in {GUID}path form, e.g. `{DFAC5FABD11D2507}Missions/23_Campaign_NorthCentral.conf`.",
          ),
        extra_args: z
          .array(z.string())
          .max(10)
          .optional()
          .describe(
            "Additional CLI flags. Each must match `^-[a-zA-Z0-9_=:.,/\\-]+$` — no shell metacharacters. Max 10.",
          ),
        dry_run: z
          .boolean()
          .optional()
          .default(true)
          .describe(
            "When true (the default), print the spawn argv + redacted config without launching. " +
              "Flip to false to actually spawn ArmaReforgerServer.exe.",
          ),
        force: z
          .boolean()
          .optional()
          .default(false)
          .describe(
            "When true, bypass the double-launch guard (will spawn even if the PID file indicates " +
              "an already-running server). Use with care — concurrent servers will fight for the same a2s/RCON ports.",
          ),
      },
    },
    async ({ server_config_path, scenario_id, extra_args, dry_run, force }) => {
      try {
        // 1. Validate + canonicalize inputs. Throws on any violation.
        const prepared = prepareLaunchInputs({
          serverConfigPath: server_config_path,
          scenarioId: scenario_id,
          extraArgs: extra_args,
        });

        // 2. Read the server.json — redacted only. Raw value never escapes
        // redact-io.ts. If the file is missing or unparseable, this throws.
        const { config: redacted, absolutePath: configAbsPath } =
          readRedactedServerConfig(prepared.absoluteConfigPath);

        // 3. Probe for the server exe.
        const probe = probeServerExe();

        // 4. Build the argv we'd pass to spawn.
        const argv = buildLaunchArgv({
          serverConfigPath: configAbsPath,
          scenarioId: prepared.scenarioId,
          extraArgs: prepared.extraArgs,
        });

        if (!probe.exists) {
          return {
            content: [
              {
                type: "text" as const,
                text:
                  `ArmaReforgerServer.exe not found at ${probe.path}. ` +
                  "Install Steam app 1874900 (Arma Reforger Server) — separate download from the game / Tools.",
              },
            ],
            isError: true,
          };
        }

        // 5. Compose response. ALWAYS show the redacted config + argv that
        // would run, regardless of dry_run.
        const redactedJson = stringifyRedacted(redacted);
        const argvForDisplay = [probe.path, ...argv]
          .map((a) => (/\s/.test(a) ? `"${a}"` : a))
          .join(" ");

        if (dry_run) {
          return {
            content: [
              {
                type: "text" as const,
                text:
                  "## server_launch (dry run — nothing spawned)\n\n" +
                  `**Exe:** \`${probe.path}\`\n` +
                  `**Argv (display only):** \`${argvForDisplay}\`\n\n` +
                  `### Redacted server.json (\`${configAbsPath}\`)\n\n` +
                  `\`\`\`json\n${redactedJson}\n\`\`\`\n\n` +
                  "_Re-call with `dry_run: false` to actually spawn the server._",
              },
            ],
          };
        }

        // 6. Pre-launch guard: refuse a second concurrent launch unless
        // the caller passes force=true. A stale PID file (process dead)
        // is auto-cleaned and we proceed.
        const pidFilePath = pidFilePathFor(configAbsPath);
        const running = checkRunningServer({ pidFilePath });
        if (running.state === "alive" && !force) {
          return {
            content: [
              {
                type: "text" as const,
                text:
                  "## server_launch — refused (already running)\n\n" +
                  `A server appears to already be running against \`${configAbsPath}\`.\n\n` +
                  `- **PID:** ${running.contents.pid}\n` +
                  `- **Started:** ${running.contents.started_at}\n` +
                  `- **Scenario:** \`${running.contents.scenario_id}\`\n` +
                  `- **PID file:** \`${pidFilePath}\`\n\n` +
                  "Use `server_stop` to terminate it, or re-call with " +
                  "`force: true` to launch anyway (concurrent servers will fight for the same a2s/RCON ports).",
              },
            ],
            isError: true,
          };
        }
        if (running.state === "stale") {
          logger.warn(
            `[server_launch] stale PID file at ${pidFilePath} (pid=${running.contents.pid} not alive); cleaning up`,
          );
          deletePidFile(pidFilePath);
        }

        // 7. Actually spawn. shell: false, detached so it keeps running
        // after the MCP request returns. stdio is fully ignored: this MCP
        // talks JSON-RPC over its own stdout, so an inherited stdout would
        // let the server's console output corrupt the protocol stream. The
        // dedicated server writes its own logs under its profile directory.
        const cwd = dirname(probe.path);
        logger.info(
          `[server_launch] spawning ${probe.path} (argc=${argv.length}, cwd=${cwd})`,
        );

        const child = spawn(probe.path, argv, {
          stdio: ["ignore", "ignore", "ignore"],
          shell: false,
          detached: true,
          cwd,
        });

        // Spawn failures (EACCES, ENOENT, EPERM…) surface as an async
        // 'error' event. Attach the listener BEFORE anything else can
        // return: with no listener the event is thrown and kills the MCP
        // process. Wait for either 'spawn' or 'error' so a failed spawn is
        // reported as isError instead of "spawned, PID (not assigned)".
        const spawnOutcome = await new Promise<
          { ok: true } | { ok: false; err: NodeJS.ErrnoException }
        >((res) => {
          child.once("spawn", () => res({ ok: true }));
          child.once("error", (err: NodeJS.ErrnoException) =>
            res({ ok: false, err }),
          );
        });
        // Keep a listener for the child's lifetime — a late error (e.g. a
        // failed kill signal) must never become an unhandled 'error'.
        child.on("error", (err: NodeJS.ErrnoException) => {
          logger.warn(
            `[server_launch] child process error (pid=${child.pid ?? "?"}): ${err.code ?? ""} ${err.message}`,
          );
        });

        if (!spawnOutcome.ok) {
          const err = spawnOutcome.err;
          // Nothing is running; make sure no PID file claims otherwise.
          try {
            deletePidFile(pidFilePath);
          } catch (cleanupErr) {
            logger.warn(
              `[server_launch] could not remove PID file after failed spawn: ${String(cleanupErr)}`,
            );
          }
          return {
            content: [
              {
                type: "text" as const,
                text:
                  "## server_launch — spawn failed\n\n" +
                  `**Exe:** \`${probe.path}\`\n` +
                  `**Error:** \`${err.code ?? "UNKNOWN"}\` — ${err.message}\n\n` +
                  "No server process is running and no PID file was written.",
              },
            ],
            isError: true,
          };
        }

        // Detach the parent from the child so we return immediately.
        child.unref();

        // We capture the PID but DO NOT block on the process — the server
        // is a long-running daemon.
        const pid = child.pid;

        // 8. Persist the PID file. Best-effort — if the write fails we
        // surface a warning but don't kill the spawned server (the user
        // will at least see the PID in the response and can stop it by
        // hand).
        let pidFileNote = "";
        if (typeof pid === "number") {
          try {
            writePidFile(pidFilePath, {
              pid,
              started_at: new Date().toISOString(),
              server_config_path: configAbsPath,
              scenario_id: prepared.scenarioId,
              argv,
            });
            pidFileNote = `**PID file:** \`${pidFilePath}\`\n`;
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            logger.warn(
              `[server_launch] failed to write PID file ${pidFilePath}: ${msg}`,
            );
            pidFileNote =
              `**PID file:** (failed to write \`${pidFilePath}\`: ${msg} — \`server_stop\` will not be able to terminate this instance automatically)\n`;
          }
        }

        return {
          content: [
            {
              type: "text" as const,
              text:
                "## server_launch (spawned)\n\n" +
                `**Exe:** \`${probe.path}\`\n` +
                `**Argv (display only):** \`${argvForDisplay}\`\n` +
                `**PID:** ${pid ?? "(not assigned — spawn may have failed)"}\n` +
                pidFileNote +
                "\n" +
                `### Redacted server.json (\`${configAbsPath}\`)\n\n` +
                `\`\`\`json\n${redactedJson}\n\`\`\`\n\n` +
                "_Server is running in the background. Use `server_health_probe` " +
                "to confirm it's responding, or `server_stop` to terminate it._",
            },
          ],
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [
            { type: "text" as const, text: `Error launching server: ${msg}` },
          ],
          isError: true,
        };
      }
    },
  );
}

// Re-export for tests/wiring scripts that want the canonical default.
export { DEFAULT_SERVER_EXE_PATH };
