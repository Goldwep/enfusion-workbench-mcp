/**
 * `wb_validate_scripts` — headless script-compile check for an addon
 * (L3-7).
 *
 * Spawns `ArmaReforgerWorkbenchSteamDiag.exe -wbModule=ScriptEditor
 * -validate -wbProjectPath <gproj>` and watches the run's log session
 * (script.log in the new `<logsPath>/logs_<timestamp>` dir) for the
 * engine's verdict line:
 * `Script validation successful.` / `Script validation failed.`
 *
 * The verdict is the completion signal — after emitting it Workbench
 * keeps booting into the ScriptEditor GUI and idles indefinitely, so
 * waiting for process exit only ever produces a timeout. Once the
 * verdict appears the spawned process is killed and errors/deprecations
 * are read from script.log. The log-session path is surfaced in the
 * result for follow-up via the logs_* tools.
 *
 * Launch hardening (2026-08-31, field-diagnosed in the EC29 session):
 * two launcher states used to end as bare -32001 timeouts —
 * 1. Project-picker hold: when the launcher doesn't auto-open the CLI
 *    project (typically one new to its registry/scan) it holds at the
 *    Projects picker with the project preselected, waiting for a human
 *    click on Open — often minimized (console.log freezes right after
 *    `Workbench Create Engine took`, no `CLI Params` echo). A
 *    LaunchWatchdog now restores the launcher window and posts Enter —
 *    the proven remedy (re-proven live on this code 2026-08-31).
 * 2. Missing Addon Dependencies modal: Workbench doesn't search the
 *    game's workshop downloads when resolving dep GUIDs. A pre-flight
 *    classifies every dep and the watchdog detects the modal live, so
 *    the failure names the missing GUIDs and the copy remedy instead of
 *    timing out. The pre-flight WARNS rather than blocks: the live run
 *    proved Workbench can resolve deps from launcher-registered
 *    projects outside every folder the scan can see.
 *
 * The HEADLESS platform is a real validated config — running with
 * `-config=HEADLESS` produces server-side compile errors that PC config
 * may miss. This tool surfaces both.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Config } from "../config.js";
import {
  DEFAULT_TIMEOUT_MS,
  finishRun,
  runWorkbench,
  tailLines,
  validateArgs,
  headlessSpawnBlocker,
} from "../workbench/cli-runner.js";
import { LaunchWatchdog } from "../workbench/launch-watchdog.js";
import { inspectProcessWindows, nudgeEnfusionLauncher } from "../workbench/launcher-nudge.js";
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
import { checkWorkbenchVisibleDeps, type WbDepsCheck } from "../workbench/wb-deps.js";

// Shared launch machinery re-exported for existing importers (tests +
// verify scripts) — the implementations moved to src/workbench/.
export { findNewSessionDir, snapshotSessionDirs };
export { buildPreflightNote, buildStuckReport, buildTimeoutDiagnostics };
export type { StuckReportInput };

/** Default wall-clock budget in seconds — fits one MCP call (H11). */
export const DEFAULT_VALIDATE_TIMEOUT_S = DEFAULT_TIMEOUT_MS / 1000;

export const ALLOWED_FLAGS = [
  "-wbModule",
  "-validate",
  "-wbProjectPath",
  "-config",
  "-logCRC",
  "-noPause",
];

/**
 * Build the -validate argv. `-wbProjectPath` and its value MUST be
 * separate entries: the Enfusion engine re-tokenizes the raw command
 * line and only honors quotes around a standalone value token (the
 * proven `-gproj "<path>"` form). A single `-wbProjectPath=<path>`
 * token gets whole-token-quoted by Node and the engine then truncates
 * the path at the first space (e.g. under `Documents\My Games\...`).
 */
export function buildValidateArgs(gprojFullPath: string, platformConfig: string): string[] {
  return [
    "-wbModule=ScriptEditor",
    "-validate",
    "-wbProjectPath",
    gprojFullPath,
    `-config=${platformConfig}`,
    "-noPause",
  ];
}

/**
 * Match the engine's validation verdict in script.log content. Returns
 * the last verdict seen (a session can accumulate more than one if the
 * idle GUI recompiles later — irrelevant while polling, where we kill
 * at the first one, but it makes post-hoc parses deterministic).
 */
export function matchValidationVerdict(content: string): "successful" | "failed" | null {
  const successIdx = content.lastIndexOf("Script validation successful.");
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

export function registerWbValidateScripts(server: McpServer, config: Config): void {
  server.registerTool(
    "wb_validate_scripts",
    {
      description:
        "Headless script-compile validation. Spawns `ArmaReforgerWorkbenchSteamDiag.exe -wbModule=ScriptEditor -validate -wbProjectPath <.gproj> [-config=<HEADLESS|PC>]`, " +
        "watches the run's log session for the engine's `Script validation successful/failed` verdict in script.log, then terminates the process " +
        "(after -validate, Workbench idles in the GUI instead of exiting — process exit never comes). " +
        "Pre-flights the project's dependency GUIDs the way Workbench resolves them (Workbench addons dir + project siblings + base install + launcher-registered projects — NOT the game's workshop downloads); non-visible deps are warned about up front and, if the launcher's 'Missing Addon Dependencies' modal actually blocks the run, the error names the GUIDs and the copy remedy instead of timing out. " +
        "If the launcher holds at its Projects picker (waiting for a human click on Open, often minimized), the run auto-confirms it by restoring the window and posting Enter. " +
        "Reports the verdict, a summary of script errors / deprecated-API hits, and the log-session path. " +
        "`config=HEADLESS` runs the server-side compile (catches things PC config misses). " +
        `Typically returns in 15–60s depending on project size; default timeout ${DEFAULT_VALIDATE_TIMEOUT_S}s (raise \`timeout_seconds\` explicitly for very large projects). ` +
        "A failed verdict, a timeout (process tree killed) or a non-zero exit is reported with isError plus the script.log / console tail. No project edits — read-only.",
      inputSchema: {
        gproj_path: z
          .string()
          .describe("Path to the .gproj to validate (absolute or repo-relative)"),
        config: z
          .enum(["PC", "HEADLESS", "XBOX_ONE", "XBOX_SERIES", "PS4", "PS5"])
          .default("PC")
          .describe("Platform config (HEADLESS is the server-side compile)"),
        timeout_seconds: z
          .number()
          .min(10)
          .max(600)
          .default(DEFAULT_VALIDATE_TIMEOUT_S)
          .describe(
            `Wall-clock timeout in seconds (10-600, default ${DEFAULT_VALIDATE_TIMEOUT_S}). Raise explicitly for very large projects.`,
          ),
        launcher_nudge: z
          .boolean()
          .default(true)
          .describe(
            "Auto-confirm the launcher's project picker by restoring its window and posting Enter when it holds instead of auto-opening (Windows only)",
          ),
      },
    },
    async ({ gproj_path, config: platformConfig, timeout_seconds, launcher_nudge }) => {
      try {
        // Audit-fix L3 B2: missing flag-smuggle guard — caller-supplied path
        // is passed as the `-wbProjectPath` value and validateArgs only
        // checks the allow-list, never the value side. Double quotes are
        // rejected too: they're invalid in Windows paths and special to the
        // engine's command-line tokenizer.
        if (gproj_path.startsWith("-") || gproj_path.includes("\0") || gproj_path.includes('"')) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Invalid gproj_path: must not start with '-' or contain NULL bytes or double quotes (got: ${gproj_path})`,
              },
            ],
            isError: true,
          };
        }
        const fullPath = resolve(gproj_path);
        if (!existsSync(fullPath)) {
          return {
            content: [{ type: "text" as const, text: `.gproj not found: ${fullPath}` }],
            isError: true,
          };
        }

        // Pre-flight: classify every dep GUID as Workbench would resolve it.
        // Warn-only — launcher-registered projects outside every scanned
        // folder can still resolve a dep (live-proven 2026-08-31), so a
        // hard block would false-positive. If deps genuinely block the
        // launch, the watchdog catches the modal and this data feeds the
        // diagnosis.
        let depCheck: WbDepsCheck | null = null;
        let depCheckError: string | undefined;
        try {
          depCheck = checkWorkbenchVisibleDeps(fullPath, config);
        } catch (e) {
          depCheckError = e instanceof Error ? e.message : String(e);
        }

        const args = buildValidateArgs(fullPath, platformConfig);
        validateArgs(args, ALLOWED_FLAGS);

        const logsRoot = config.logsPath;
        const tracker = new ValidateRunTracker(logsRoot, snapshotSessionDirs(logsRoot));
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
          args,
          timeoutMs: timeout_seconds * 1000,
          pollSignal: { intervalMs: 2000, check: tracker.check },
        });

        const sessionDir = tracker.sessionDir;
        const consoleTail = tailLines(tracker.readConsoleLog(), 15);

        // Launcher-stuck verdicts replace the normal output entirely.
        if (
          result.earlySignal === "stuck:launcher-picker" ||
          result.earlySignal === "stuck:missing-deps"
        ) {
          return {
            content: [
              {
                type: "text" as const,
                text: buildStuckReport(result.earlySignal, {
                  gprojPath: fullPath,
                  platform: platformConfig,
                  durationMs: result.durationMs,
                  sessionDir,
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

        // Prefer script.log as the error source — the exe is a GUI app and
        // rarely writes anything useful to stdout/stderr.
        let scriptLogContent = "";
        if (sessionDir) {
          const scriptLog = join(sessionDir, "script.log");
          if (existsSync(scriptLog)) {
            scriptLogContent = readFileSync(scriptLog, "utf-8");
          }
        }
        const errorSource = scriptLogContent || result.stdout + "\n" + result.stderr;
        const errors = extractErrorLines(errorSource);
        const obsoletes = extractObsoleteLines(errorSource);

        // Success is derived from evidence, not process state (H10). A
        // clean exit with no verdict still counts as "no evidence" — the
        // artefact is the script.log verdict itself.
        const outcome = finishRun(result, () => ({
          ok: result.earlySignal === "successful",
          detail: "no `Script validation successful.` verdict in script.log",
        }));

        const lines: string[] = [];
        lines.push(`## wb_validate_scripts: ${fullPath}`);
        lines.push("");
        lines.push(`Platform: ${platformConfig}`);
        if (result.earlySignal === "successful") {
          lines.push(
            `Verdict: ✅ Script validation successful (script.log, ${(result.durationMs / 1000).toFixed(1)}s; idle Workbench process terminated).`,
          );
        } else if (result.earlySignal === "failed") {
          lines.push(
            `Verdict: ❌ Script validation failed (script.log, ${(result.durationMs / 1000).toFixed(1)}s; idle Workbench process terminated).`,
          );
        } else if (result.timedOut) {
          lines.push(
            `Verdict: ⏱ TIMEOUT after ${(result.durationMs / 1000).toFixed(1)}s — no validation verdict appeared in script.log. Process tree killed. ` +
              "Raise timeout_seconds explicitly for very large projects.",
          );
        } else {
          // The exe exited on its own before any verdict was polled — fall
          // back to the exit code.
          lines.push(
            `Verdict: process exited with code ${result.exitCode ?? "(killed)"} after ${(result.durationMs / 1000).toFixed(1)}s (no script.log verdict seen).`,
          );
        }
        if (tracker.watchdog?.nudgeOutcome?.enterPosted) {
          lines.push(
            "ℹ️ Launcher project picker was auto-confirmed (launcher window restored, Enter posted on the preselected Open).",
          );
        }
        const preflightNote = buildPreflightNote(depCheck);
        if (
          preflightNote &&
          (result.earlySignal === "successful" || result.earlySignal === "failed")
        ) {
          lines.push(preflightNote);
        }
        lines.push(
          sessionDir
            ? `Log session: ${sessionDir}`
            : `Log session: (none detected under ${logsRoot})`,
        );
        lines.push("");

        if (result.earlySignal === "successful" && errors.length === 0 && obsoletes.length === 0) {
          lines.push("✅ Clean validation — no errors or deprecation warnings.");
        } else {
          if (errors.length > 0) {
            lines.push(`### Errors (${errors.length} unique)`);
            lines.push("```");
            lines.push(errors.slice(0, 50).join("\n"));
            if (errors.length > 50) lines.push(`... (${errors.length - 50} more)`);
            lines.push("```");
            lines.push("");
          }
          if (obsoletes.length > 0) {
            lines.push(`### Deprecation warnings (${obsoletes.length} unique)`);
            lines.push("```");
            lines.push(obsoletes.slice(0, 20).join("\n"));
            if (obsoletes.length > 20) lines.push(`... (${obsoletes.length - 20} more)`);
            lines.push("```");
            lines.push("");
          }
        }

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
        }

        // On failure surface the script.log tail (the real evidence), or
        // the console tail when no script.log exists yet.
        if (!outcome.ok && !(result.timedOut && result.earlySignal === null)) {
          if (scriptLogContent) {
            lines.push("### script.log tail");
            lines.push("```");
            lines.push(tailLines(scriptLogContent, 20));
            lines.push("```");
            lines.push("");
          } else if (consoleTail.trim().length > 0) {
            lines.push("### console.log tail");
            lines.push("```");
            lines.push(consoleTail);
            lines.push("```");
            lines.push("");
          }
        }

        // Without a script.log the stderr tail is the only evidence we have.
        if (!scriptLogContent && result.stderr.trim().length > 0) {
          lines.push("### Last 20 lines (stderr)");
          lines.push("```");
          lines.push(tailLines(result.stderr, 20));
          lines.push("```");
        }

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
          ...(outcome.ok ? {} : { isError: true as const }),
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [{ type: "text" as const, text: `Error validating scripts: ${msg}` }],
          isError: true,
        };
      }
    },
  );
}
