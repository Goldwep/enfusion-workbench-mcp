/**
 * Shared diagnosis reports for Workbench launch failures — used by every
 * tool that spawns the exe (wb_validate_scripts / wb_cli_run /
 * wb_build_data / wb_launch). Pure formatters over the LaunchWatchdog's
 * evidence and the wb-deps visibility check, so a stuck launcher or a
 * dependency modal reads as a diagnosis with remedies instead of a bare
 * timeout.
 */

import type { LaunchWatchdog } from "./launch-watchdog.js";
import { formatDepFindings, type WbDepsCheck } from "./wb-deps.js";

export interface StuckReportInput {
  /** Header label — which tool's run this was (e.g. "wb_cli_run (openProject)"). */
  toolLabel?: string;
  gprojPath: string;
  /** Platform config line — omitted entirely when not applicable. */
  platform?: string;
  durationMs: number;
  sessionDir: string | null;
  logsRoot: string;
  watchdog: LaunchWatchdog;
  consoleTail: string;
  depCheck: WbDepsCheck | null;
  depCheckError?: string;
}

export function describeNudgeEvidence(watchdog: LaunchWatchdog): string[] {
  const lines: string[] = [];
  const n = watchdog.nudgeOutcome;
  if (!n) {
    lines.push("- Auto-nudge: not attempted (engine marker never appeared, or the run ended first).");
  } else if (n.error) {
    lines.push(`- Auto-nudge: window probe failed — ${n.error}`);
  } else if (!n.windowFound) {
    lines.push(
      `- Auto-nudge: no launcher-titled window found for the spawned pid (titles seen: ${
        n.windowTitles.length > 0 ? n.windowTitles.join(" | ") : "none"
      }).`,
    );
  } else {
    lines.push(
      `- Auto-nudge: launcher window "${n.windowTitle}"${n.wasMinimized ? " (was minimized)" : ""} restored, Enter ${
        n.enterPosted ? "posted on the preselected Open" : "NOT posted"
      }.`,
    );
  }
  const fi = watchdog.finalInspection;
  if (fi && !fi.error) {
    lines.push(
      `- Windows at final check: ${fi.windowTitles.length > 0 ? fi.windowTitles.join(" | ") : "(none with a title)"}`,
    );
  }
  return lines;
}

function depSection(input: StuckReportInput): string[] {
  // No dep data and no failure to report (e.g. an .ent target where
  // dependency analysis doesn't apply) — omit the section entirely.
  if (!input.depCheck && !input.depCheckError) return [];
  const lines: string[] = [];
  lines.push("### Dependency check");
  if (input.depCheck) {
    if (input.depCheck.allWbVisible) {
      lines.push(
        `All ${input.depCheck.findings.length} declared dependencies look Workbench-visible — ` +
          "this was most likely the benign launcher picker hold, not a dependency problem. " +
          "Re-run the tool (the launcher may remember the project now), or open the project once in Workbench manually.",
      );
    } else {
      lines.push(...formatDepFindings(input.depCheck));
    }
  } else {
    lines.push(`(dependency check unavailable${input.depCheckError ? `: ${input.depCheckError}` : ""})`);
  }
  return lines;
}

export function buildStuckReport(
  kind: "stuck:launcher-picker" | "stuck:missing-deps",
  input: StuckReportInput,
): string {
  const lines: string[] = [];
  lines.push(`## ${input.toolLabel ?? "wb_validate_scripts"}: ${input.gprojPath}`);
  lines.push("");
  if (input.platform) lines.push(`Platform: ${input.platform}`);
  if (kind === "stuck:missing-deps") {
    lines.push(
      `⛔ STUCK after ${(input.durationMs / 1000).toFixed(1)}s — Workbench popped its "Missing Addon Dependencies" modal: ` +
        "the project declares addons Workbench cannot locate. Process killed.",
    );
  } else {
    lines.push(
      `⛔ STUCK after ${(input.durationMs / 1000).toFixed(1)}s — the Workbench launcher held at its Projects picker ` +
        'and the engine never took the CLI project (no "CLI Params" echo in console.log). Process killed.',
    );
    lines.push(
      "The launcher does this when it declines to auto-open the CLI project (typically one new to its registry/scan): " +
        "the project is preselected but a human is expected to click Open, while the launcher window often sits minimized and invisible.",
    );
  }
  lines.push("");
  lines.push(...describeNudgeEvidence(input.watchdog));
  const deps = depSection(input);
  if (deps.length > 0) {
    lines.push("");
    lines.push(...deps);
  }
  lines.push("");
  lines.push(
    input.sessionDir
      ? `Log session: ${input.sessionDir}`
      : `Log session: (none detected under ${input.logsRoot})`,
  );
  if (input.consoleTail.trim().length > 0) {
    lines.push("");
    lines.push("### console.log tail");
    lines.push("```");
    lines.push(input.consoleTail);
    lines.push("```");
  }
  return lines.join("\n");
}

/**
 * One-liner appended to successful output when the pre-flight saw deps
 * outside every scanned folder yet the run proceeded anyway — evidence
 * of a launcher-registered project the scan can't see.
 */
export function buildPreflightNote(depCheck: WbDepsCheck | null): string | null {
  if (!depCheck || depCheck.allWbVisible) return null;
  const n = depCheck.findings.filter((f) => f.status !== "wb-visible").length;
  return (
    `⚠ Dependency note: ${n} declared dep${n === 1 ? "" : "s"} not found in any Workbench-scanned folder, ` +
    "yet the launch proceeded — most likely resolved via a launcher-registered project. " +
    "Run workshop_check_deps for the breakdown."
  );
}

export function buildTimeoutDiagnostics(input: {
  watchdog: LaunchWatchdog | null;
  consoleTail: string;
  depCheck: WbDepsCheck | null;
  depCheckError?: string;
}): string[] {
  const lines: string[] = [];
  lines.push("### Launch diagnostics");
  if (input.watchdog?.cliParamsSeen) {
    lines.push(
      "- Engine `CLI Params` echo: seen — the project WAS accepted; the run just never finished " +
        "within the timeout (large project? raise timeout_seconds).",
    );
  } else {
    lines.push(
      "- Engine `CLI Params` echo: NOT seen — the engine never accepted the CLI project. " +
        "Launcher picker hold or a dependency modal is the usual cause.",
    );
    if (input.watchdog) lines.push(...describeNudgeEvidence(input.watchdog));
    if (input.depCheck && !input.depCheck.allWbVisible) {
      lines.push("");
      lines.push(...formatDepFindings(input.depCheck));
    } else if (input.depCheckError) {
      lines.push(`- Dependency check unavailable: ${input.depCheckError}`);
    }
  }
  if (input.consoleTail.trim().length > 0) {
    lines.push("");
    lines.push("### console.log tail");
    lines.push("```");
    lines.push(input.consoleTail);
    lines.push("```");
  }
  return lines;
}
