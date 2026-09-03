/**
 * `wb_cli_run` — curated command runner for ArmaReforgerWorkbenchSteamDiag.exe
 * (L3-7).
 *
 * Strict allow-list of high-leverage Workbench CLI invocations. Each
 * `command` maps to a fixed argv template that accepts only narrowly-
 * scoped user inputs. Per security audit (SEC-004), path-shaped args
 * are rejected when they start with `-`.
 *
 * Launch hardening (2026-08-31): every command runs under the shared
 * LaunchWatchdog — if the Workbench launcher holds at its Projects
 * picker instead of auto-opening the target, the watchdog restores the
 * window and posts Enter; a genuine block (picker or the Missing Addon
 * Dependencies modal) fails fast with a diagnosis instead of a bare
 * timeout. Project-targeted commands also pre-flight dependency GUID
 * visibility (warn-only). `buildScripts` additionally reuses the
 * script.log verdict probe: like `-validate`, it never exits on its own,
 * so the verdict is the completion signal and the idling GUI is killed.
 *
 * Use when you want to invoke Workbench from automation but a dedicated
 * tool like `wb_validate_scripts` or `wb_build_data` doesn't fit.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { Config } from "../config.js";
import {
  DEFAULT_TIMEOUT_MS,
  finishRun,
  runWorkbench,
  tailLines,
  headlessSpawnBlocker,
} from "../workbench/cli-runner.js";
import { LaunchWatchdog } from "../workbench/launch-watchdog.js";
import { inspectProcessWindows, nudgeEnfusionLauncher } from "../workbench/launcher-nudge.js";
import { WorkbenchLaunchTracker, snapshotSessionDirs } from "../workbench/launch-tracker.js";
import {
  buildPreflightNote,
  buildStuckReport,
  buildTimeoutDiagnostics,
} from "../workbench/launch-reports.js";
import { checkWorkbenchVisibleDeps, type WbDepsCheck } from "../workbench/wb-deps.js";
import { ValidateRunTracker } from "./wb-validate-scripts.js";

const COMMANDS = ["openProject", "navmeshGenerate", "buildScripts", "forceSaveAll"] as const;
type Command = (typeof COMMANDS)[number];

const COMMAND_DESCRIPTIONS: Record<Command, string> = {
  openProject: "Open Workbench with a project loaded (-wbProjectPath). Useful for headless smoke.",
  navmeshGenerate: "-wbModule=NavmeshGeneratorMain -run -autogenerate <world> — long-running",
  buildScripts: "Headless script build for the configured platform",
  forceSaveAll: "-wbModule=WorldEditor -run -load <ent> -forceSaveAll — bulk-resave a world",
};

/** Commands whose target is a .gproj — dependency pre-flight applies. */
const GPROJ_COMMANDS: ReadonlySet<Command> = new Set(["openProject", "buildScripts"]);

/**
 * Commands whose target is an engine resource path (`world/myworld.ent`,
 * `Prefabs/.../Villa.et` — BIKI examples) that the engine resolves against
 * the loaded project's addons, NOT a file on this machine's disk. These
 * accept either an absolute on-disk path or an engine-relative one.
 */
const RESOURCE_COMMANDS: ReadonlySet<Command> = new Set(["navmeshGenerate", "forceSaveAll"]);

/** Default wall-clock budget in seconds — fits one MCP call (H11). */
export const DEFAULT_CLI_TIMEOUT_S = DEFAULT_TIMEOUT_MS / 1000;

/**
 * Reject anything a resource-path target must never carry: a leading
 * dash (flag smuggling, SEC-004), NUL, double quotes (engine tokenizer),
 * or a `..` segment (escapes the project's addon roots). Returns an error
 * string or null. Pure — exported for tests.
 */
export function validateResourceTarget(target: string): string | null {
  if (target.length === 0) return "Target must not be empty";
  if (target.startsWith("-")) return "Target may not start with '-' (looks like a CLI flag)";
  if (target.includes("\0")) return "Target may not contain NULL bytes";
  if (target.includes('"')) return "Target may not contain double quotes";
  if (target.split(/[\\/]/).includes("..")) return "Target may not contain '..' segments";
  return null;
}

/**
 * Resolve the argv target for a command. Project commands need a real
 * .gproj on disk (resolved absolute). Resource commands pass an absolute
 * path through as-is and otherwise hand the engine-relative string to
 * Workbench verbatim — never `resolve()`d against this process's cwd.
 */
export function resolveTargetFor(cmd: Command, target: string): string {
  if (RESOURCE_COMMANDS.has(cmd) && !isAbsolute(target)) return target;
  return resolve(target);
}

export function planFor(cmd: Command, target: string, platformConfig: string): string[] {
  // Path values ride as their own argv entry (never `-flag=<path>`): the
  // Enfusion engine re-tokenizes the raw command line and truncates a
  // whole-token-quoted `-flag=<path with spaces>` at the first space.
  switch (cmd) {
    case "openProject":
      return ["-wbProjectPath", target, "-noPause"];
    case "navmeshGenerate":
      return ["-wbModule=NavmeshGeneratorMain", "-run", "-autogenerate", target, "-noPause"];
    case "buildScripts":
      return [
        "-wbModule=ScriptEditor",
        "-validate",
        "-wbProjectPath",
        target,
        `-config=${platformConfig}`,
        "-noPause",
      ];
    case "forceSaveAll":
      return ["-wbModule=WorldEditor", "-run", "-load", target, "-forceSaveAll", "-noPause"];
  }
}

export function registerWbCliRun(server: McpServer, config: Config): void {
  server.registerTool(
    "wb_cli_run",
    {
      description:
        "Run one of a curated set of Workbench CLI commands. The `command` parameter is enum-restricted — raw flag construction is NOT supported. " +
        "Targets that start with '-' are rejected to prevent flag-smuggling. " +
        `Default timeout is ${DEFAULT_CLI_TIMEOUT_S}s so the call fits an MCP client window; on timeout the whole Workbench process tree is killed and the call returns isError. Long-running commands (navmesh) MUST pass an explicit \`timeout_seconds\`. ` +
        "`navmeshGenerate` / `forceSaveAll` accept an engine-relative resource path (e.g. `worlds/MyWorld.ent`) or an absolute file path. " +
        "A failed verdict, a non-zero exit or a timeout is reported with isError and the console/script.log tail. " +
        "If the launcher holds at its Projects picker (waiting for a human click on Open, often minimized), the run auto-confirms it by restoring the window and posting Enter; " +
        "a genuine launch block reports the diagnosis (and, for project targets, dependency GUID visibility with remedies) instead of a bare timeout. " +
        "`buildScripts` reports the script.log validation verdict and terminates the idling GUI (like wb_validate_scripts). " +
        `Available commands: ${COMMANDS.map((c) => `\`${c}\` (${COMMAND_DESCRIPTIONS[c]})`).join("; ")}.`,
      inputSchema: {
        command: z.enum(COMMANDS).describe("Which curated command to run"),
        target: z
          .string()
          .describe(
            "Target argument for the command — a .gproj path (openProject/buildScripts, must exist on disk) or a world/.ent/.et resource path (navmeshGenerate/forceSaveAll — engine-relative like `worlds/MyWorld.ent`, or absolute). Must not start with '-' or contain '..'.",
          ),
        config: z
          .enum(["PC", "HEADLESS", "XBOX_ONE", "XBOX_SERIES", "PS4", "PS5"])
          .default("PC")
          .describe("Platform config (only used by buildScripts)"),
        timeout_seconds: z
          .number()
          .min(10)
          .max(1800)
          .default(DEFAULT_CLI_TIMEOUT_S)
          .describe(
            `Wall-clock timeout in seconds (10-1800, default ${DEFAULT_CLI_TIMEOUT_S}). Raise explicitly for navmesh bakes / big projects.`,
          ),
        launcher_nudge: z
          .boolean()
          .default(true)
          .describe(
            "Auto-confirm the launcher's project picker by restoring its window and posting Enter when it holds instead of auto-opening (Windows only)",
          ),
      },
    },
    async ({ command, target, config: platformConfig, timeout_seconds, launcher_nudge }) => {
      try {
        // Audit-fix L3 B1/SEC-L3-006: flag-smuggle guard MUST check the raw
        // user input — resolve() prepends cwd which masks a leading dash.
        const targetErr = validateResourceTarget(target);
        if (targetErr !== null) {
          return {
            content: [
              { type: "text" as const, text: `Invalid target: ${targetErr} (got: ${target})` },
            ],
            isError: true,
          };
        }
        const resolved = resolveTargetFor(command, target);
        // Only project targets must exist on this disk; resource targets
        // are resolved by the engine against the project's addons (L3).
        const mustExist = GPROJ_COMMANDS.has(command) || isAbsolute(resolved);
        if (mustExist && !existsSync(resolved)) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Target not found on disk: ${resolved}`,
              },
            ],
            isError: true,
          };
        }
        const args = planFor(command, resolved, platformConfig);

        // Warn-only dependency pre-flight for project targets (see
        // wb-validate-scripts.ts for the rationale).
        let depCheck: WbDepsCheck | null = null;
        let depCheckError: string | undefined;
        if (GPROJ_COMMANDS.has(command)) {
          try {
            depCheck = checkWorkbenchVisibleDeps(resolved, config);
          } catch (e) {
            depCheckError = e instanceof Error ? e.message : String(e);
          }
        }

        const logsRoot = config.logsPath;
        const priorSessions = snapshotSessionDirs(logsRoot);
        // buildScripts is `-validate` under the hood: it never exits on its
        // own, so the script.log verdict is the completion signal.
        const tracker =
          command === "buildScripts"
            ? new ValidateRunTracker(logsRoot, priorSessions)
            : new WorkbenchLaunchTracker(logsRoot, priorSessions);
        if (launcher_nudge) {
          tracker.watchdog = new LaunchWatchdog({
            readConsoleLog: tracker.readConsoleLog,
            nudge: nudgeEnfusionLauncher,
            inspectWindows: inspectProcessWindows,
          });
        }

        const blocker = headlessSpawnBlocker();

        if (blocker) {
          return { content: [{ type: "text" as const, text: blocker }], isError: true };
        }

        const result = await runWorkbench({
          workbenchPath: config.workbenchPath,
          gamePath: config.gamePath,
          args,
          timeoutMs: timeout_seconds * 1000,
          pollSignal: { intervalMs: 2000, check: tracker.check },
        });

        const consoleTail = tailLines(tracker.readConsoleLog(), 15);

        if (
          result.earlySignal === "stuck:launcher-picker" ||
          result.earlySignal === "stuck:missing-deps"
        ) {
          return {
            content: [
              {
                type: "text" as const,
                text: buildStuckReport(result.earlySignal, {
                  toolLabel: `wb_cli_run (${command})`,
                  gprojPath: resolved,
                  platform: command === "buildScripts" ? platformConfig : undefined,
                  durationMs: result.durationMs,
                  sessionDir: tracker.sessionDir,
                  logsRoot,
                  watchdog: tracker.watchdog!,
                  consoleTail,
                  depCheck,
                  depCheckError,
                }),
              },
            ],
            isError: true,
          };
        }

        // Success is derived from evidence, not process state (H10): a
        // failed verdict, a timeout or a non-zero exit is an error.
        const outcome = finishRun(result);

        const lines: string[] = [];
        lines.push(`## wb_cli_run: ${command} — ${resolved}`);
        lines.push("");
        if (result.earlySignal === "successful" || result.earlySignal === "failed") {
          lines.push(
            `Verdict: ${result.earlySignal === "successful" ? "✅ Script validation successful" : "❌ Script validation failed"} ` +
              `(script.log, ${(result.durationMs / 1000).toFixed(1)}s; idle Workbench process terminated).`,
          );
        } else {
          lines.push(
            `Exit code: ${result.exitCode ?? "(killed)"}${result.timedOut ? " — TIMEOUT (process tree killed)" : ""}`,
          );
          lines.push(`Duration: ${(result.durationMs / 1000).toFixed(1)}s`);
          lines.push(outcome.ok ? "✅ Command exited cleanly." : `❌ ${outcome.reason}.`);
        }
        if (tracker.watchdog?.nudgeOutcome?.enterPosted) {
          lines.push(
            "ℹ️ Launcher project picker was auto-confirmed (launcher window restored, Enter posted on the preselected Open).",
          );
        }
        const preflightNote = buildPreflightNote(depCheck);
        if (preflightNote && tracker.watchdog?.cliParamsSeen) {
          lines.push(preflightNote);
        }
        if (tracker.sessionDir) {
          lines.push(`Log session: ${tracker.sessionDir}`);
        }
        lines.push("");
        if (result.timedOut && result.earlySignal === null) {
          lines.push(
            ...buildTimeoutDiagnostics({
              watchdog: tracker.watchdog,
              consoleTail,
              depCheck,
              depCheckError,
            }),
          );
          lines.push("");
        } else if (!outcome.ok && consoleTail.trim().length > 0) {
          lines.push("### console.log tail");
          lines.push("```");
          lines.push(consoleTail);
          lines.push("```");
          lines.push("");
        }
        lines.push("### Last 30 lines (stdout)");
        lines.push("```");
        lines.push(tailLines(result.stdout, 30));
        lines.push("```");
        if (result.stderr.trim().length > 0) {
          lines.push("");
          lines.push("### Last 10 lines (stderr)");
          lines.push("```");
          lines.push(tailLines(result.stderr, 10));
          lines.push("```");
        }
        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
          ...(outcome.ok ? {} : { isError: true as const }),
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [{ type: "text" as const, text: `Error running wb command: ${msg}` }],
          isError: true,
        };
      }
    },
  );
}
