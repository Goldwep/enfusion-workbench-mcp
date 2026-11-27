/**
 * `wb_validate_scripts` — alias of `wb_scripts validate` (aliases.ts), plus the
 * headless-run helpers `wb_cli_run buildScripts` still uses.
 *
 * The tool itself no longer spawns Workbench: it forwards to the native
 * `ValidateScripts` (DEC-040 U3) through `wb_scripts`. Kept here:
 *
 *  - `buildValidateArgs`: the `-validate=<CFG>` command line, now
 *    `-gproj <gproj> -wbModule=ScriptEditor -validate=<CFG>` (DEC-047 L7; the
 *    module switch is required, VALIDATE_MODULE_ARG). It never carries
 *    `-wbProjectPath`, `-config=` or `-logCRC`.
 *  - `ValidateRunTracker` and the script.log parsers, which end a headless
 *    `-validate` run on the "Script validation successful." line (the run
 *    never exits by itself; DEC-035).
 *  - the launch-report builders re-exported for existing importers.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "../config.js";
import { DEFAULT_TIMEOUT_MS } from "../workbench/cli-runner.js";
import {
  SCRIPT_AUTHORIZE_ALL,
  VALIDATE_SUCCESS_LINE,
  withScriptAuthorizeAll,
  type WorkbenchClient,
} from "../workbench/client.js";
import {
  WorkbenchLaunchTracker,
  findNewSessionDir,
  snapshotSessionDirs,
} from "../workbench/launch-tracker.js";
import {
  buildPreflightNote,
  buildStuckReport,
  buildTimeoutDiagnostics,
  type StuckReportInput,
} from "../workbench/launch-reports.js";
import { routeAlias } from "../manifest/aliases.js";
import { VocabularyError, errorResponse } from "../manifest/vocabulary.js";
import { runScripts, toToolResult, type ScriptsArgs } from "./wb-scripts.js";

// Shared launch machinery re-exported for existing importers (tests +
// verify scripts) — the implementations moved to src/workbench/.
export { findNewSessionDir, snapshotSessionDirs };
export { buildPreflightNote, buildStuckReport, buildTimeoutDiagnostics };
export type { StuckReportInput };

/** Default wall-clock budget in seconds — fits one MCP call (H11). */
export const DEFAULT_VALIDATE_TIMEOUT_S = DEFAULT_TIMEOUT_MS / 1000;

export const ALLOWED_FLAGS = ["-gproj", "-wbModule", "-validate", SCRIPT_AUTHORIZE_ALL];

/**
 * The module `-validate` belongs to. The Script Editor reads `-validate` when it
 * opens; without `-wbModule=ScriptEditor` the switch is echoed in "CLI Params"
 * and never acted on: no verdict line, Workbench idles to the timeout
 * (2026-11-14 on 1.9.0.37, docs/v2/inbox/phase7/cli-battery-1.9.md; the passing
 * S-A runs of October carried it, EV-S-A-002, EV-s003-001).
 */
export const VALIDATE_MODULE_ARG = "-wbModule=ScriptEditor";

/**
 * Build the headless `-validate` argv: `-gproj <path> -wbModule=ScriptEditor
 * -validate=<CFG>`. The path is its own argv entry: the engine re-tokenizes
 * the raw command line and only honors quotes around a standalone value
 * token, so a single `-flag=<path with spaces>` token is truncated at the
 * first space.
 */
export function buildValidateArgs(gprojFullPath: string, platformConfig: string): string[] {
  return withScriptAuthorizeAll([
    "-gproj",
    gprojFullPath,
    VALIDATE_MODULE_ARG,
    `-validate=${platformConfig}`,
  ]);
}

/**
 * Match the engine's validation verdict in script.log content. Returns
 * the last verdict seen (a session can accumulate more than one if the
 * idle GUI recompiles later — irrelevant while polling, where we kill
 * at the first one, but it makes post-hoc parses deterministic).
 */
export function matchValidationVerdict(content: string): "successful" | "failed" | null {
  const successIdx = content.lastIndexOf(VALIDATE_SUCCESS_LINE);
  const failIdx = content.lastIndexOf("Script validation failed.");
  if (successIdx < 0 && failIdx < 0) return null;
  return successIdx > failIdx ? "successful" : "failed";
}

/**
 * Strip the `HH:MM:SS.mmm` prefix and dedupe, preserving order. The
 * engine validates every platform configuration in one -validate run,
 * so each error repeats once per config.
 */
function dedupeLogLines(lines: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    const stripped = line.replace(/^\d{2}:\d{2}:\d{2}\.\d{3}\s+/, "").trim();
    if (seen.has(stripped)) continue;
    seen.add(stripped);
    out.push(stripped);
  }
  return out;
}

export function extractErrorLines(text: string): string[] {
  return dedupeLogLines(
    text.split(/\r?\n/).filter((l) => /\(E\)|^error|: error\b/i.test(l) && !/0 errors/i.test(l)),
  );
}

export function extractObsoleteLines(text: string): string[] {
  return dedupeLogLines(text.split(/\r?\n/).filter((l) => /obsolete/i.test(l)));
}

/**
 * The generic launch tracker with the script.log verdict probe wired in.
 * The verdict always wins the tick — a run that reaches a verdict was
 * never stuck.
 */
export class ValidateRunTracker extends WorkbenchLaunchTracker {
  constructor(logsRoot: string, priorSessions: Set<string>) {
    super(logsRoot, priorSessions, (sessionDir) => {
      const scriptLog = join(sessionDir, "script.log");
      if (!existsSync(scriptLog)) return null;
      return matchValidationVerdict(readFileSync(scriptLog, "utf-8"));
    });
  }
}

// ── Registration ─────────────────────────────────────────────────────────────

/**
 * The 1.x tool, now an alias of `wb_scripts validate`. `gproj_path`,
 * `timeout_seconds` and `launcher_nudge` belonged to the headless spawn and
 * are refused when given (the alias rule, src/manifest/aliases.ts; live-tools-b-6:
 * a gproj_path that named another project got the open project's verdict);
 * `config` becomes `configuration` (PC or WORKBENCH; the old
 * HEADLESS answers "unknown configuration" natively, DEC-040 U3, so it is
 * refused). `client` is the server's single WorkbenchClient: a second one
 * would break the one-queue rule (U30), so without it the tool says so.
 */
export function registerWbValidateScripts(
  server: McpServer,
  _config: Config,
  client?: WorkbenchClient,
): void {
  server.registerTool(
    "wb_validate_scripts",
    {
      description:
        "Alias of wb_scripts validate: ValidateScripts through the running Workbench.\n" +
        "Read: compile errors, warnings, success for configuration PC or WORKBENCH. Needs Workbench running; no project edits.",
      inputSchema: {
        config: z
          .enum(["PC", "WORKBENCH"])
          .default("WORKBENCH")
          .describe("Script configuration to compile"),
        gproj_path: z.string().optional().describe("1.x key, refused when given: validates the open project"),
        timeout_seconds: z.number().optional().describe("1.x key, refused when given"),
        launcher_nudge: z.boolean().optional().describe("1.x key, refused when given"),
      },
      annotations: {
        title: "Validate scripts",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ config: cfg, gproj_path, timeout_seconds, launcher_nudge }) => {
      if (!client) {
        return {
          content: [
            {
              type: "text" as const,
              text: "wb_validate_scripts is an alias of wb_scripts validate and needs the server's Workbench client; registerWbValidateScripts was called without one.",
            },
          ],
          isError: true as const,
        };
      }
      let routed: ReturnType<typeof routeAlias>;
      try {
        routed = routeAlias("wb_validate_scripts", {
          configuration: cfg,
          gproj_path,
          timeout_seconds,
          launcher_nudge,
        });
      } catch (e) {
        if (e instanceof VocabularyError) {
          return toToolResult(errorResponse("validate", "workbench:scripts", e.code, e.message));
        }
        throw e;
      }
      if (!routed) throw new Error("wb_validate_scripts alias is not routed");
      return toToolResult(await runScripts(client, routed.args as unknown as ScriptsArgs));
    },
  );
}
