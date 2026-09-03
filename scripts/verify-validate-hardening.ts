/**
 * Live verification of the wb_validate_scripts launch hardening
 * (2026-08-31) against the real Workbench: dependency pre-flight, the
 * ValidateRunTracker + LaunchWatchdog wiring (exactly as the tool wires
 * them), and the script.log verdict path.
 *
 * On a project the launcher already knows, this proves the watchdog
 * stays quiet on a healthy run; on a project new to the launcher it
 * exercises the restore+Enter auto-confirm live.
 *
 * Usage: npx tsx scripts/verify-validate-hardening.ts [path-to-gproj]
 * Default target: Test1 under `Documents\My Games\...` (spacey path).
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { runWorkbench } from "../src/workbench/cli-runner.js";
import { LaunchWatchdog } from "../src/workbench/launch-watchdog.js";
import {
  inspectProcessWindows,
  nudgeEnfusionLauncher,
} from "../src/workbench/launcher-nudge.js";
import { checkWorkbenchVisibleDeps, formatDepFindings } from "../src/workbench/wb-deps.js";
import {
  ValidateRunTracker,
  buildStuckReport,
  buildValidateArgs,
  snapshotSessionDirs,
} from "../src/tools/wb-validate-scripts.js";

const WORKBENCH_PATH =
  process.env.ENFUSION_WORKBENCH_PATH ??
  "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Arma Reforger Tools";
const GAME_PATH =
  process.env.ENFUSION_GAME_PATH ?? "D:\\SteamLibrary\\steamapps\\common\\Arma Reforger";
const MY_GAMES = join(homedir(), "Documents", "My Games");
const LOGS_ROOT = join(MY_GAMES, "ArmaReforgerWorkbench", "logs");
const gproj =
  process.argv[2] ?? join(MY_GAMES, "ArmaReforgerWorkbench", "addons", "Test1", "addon.gproj");

if (!existsSync(gproj)) {
  console.error(`target .gproj not found: ${gproj}`);
  process.exit(1);
}

const depPaths = {
  projectPath: join(MY_GAMES, "ArmaReforgerWorkbench", "addons"),
  corePath: join(WORKBENCH_PATH, "Workbench", "addons"),
  gamePath: GAME_PATH,
  workshopPath: join(MY_GAMES, "ArmaReforger", "addons"),
};

console.log("=== dependency pre-flight ===");
const depCheck = checkWorkbenchVisibleDeps(gproj, depPaths);
console.log(formatDepFindings(depCheck).join("\n"));
if (!depCheck.allWbVisible) {
  console.log("(non-visible deps noted — the tool warns and proceeds; the watchdog handles a real block)");
}

console.log("\n=== spawn + watchdog ===");
const args = buildValidateArgs(gproj, "PC");
console.log(`argv: ${JSON.stringify(args)}`);

const tracker = new ValidateRunTracker(LOGS_ROOT, snapshotSessionDirs(LOGS_ROOT));
tracker.watchdog = new LaunchWatchdog({
  readConsoleLog: tracker.readConsoleLog,
  nudge: nudgeEnfusionLauncher,
  inspectWindows: inspectProcessWindows,
});

const result = await runWorkbench({
  workbenchPath: WORKBENCH_PATH,
  args,
  timeoutMs: 180_000,
  pollSignal: { intervalMs: 2000, check: tracker.check },
});

console.log(`earlySignal: ${result.earlySignal}`);
console.log(`timedOut: ${result.timedOut}  exitCode: ${result.exitCode}`);
console.log(`duration: ${(result.durationMs / 1000).toFixed(1)}s`);
console.log(`session: ${tracker.sessionDir}`);
console.log(`watchdog: cliParamsSeen=${tracker.watchdog.cliParamsSeen}`);
if (tracker.watchdog.nudgeOutcome) {
  console.log(`watchdog nudge: ${JSON.stringify(tracker.watchdog.nudgeOutcome)}`);
}

if (result.earlySignal === "stuck:launcher-picker" || result.earlySignal === "stuck:missing-deps") {
  console.log("\n=== stuck report (as the tool would emit) ===");
  console.log(
    buildStuckReport(result.earlySignal, {
      gprojPath: gproj,
      platform: "PC",
      durationMs: result.durationMs,
      sessionDir: tracker.sessionDir,
      logsRoot: LOGS_ROOT,
      watchdog: tracker.watchdog,
      consoleTail: tracker.readConsoleLog().split(/\r?\n/).slice(-15).join("\n"),
      depCheck,
    }),
  );
  process.exit(1);
}

if (!tracker.sessionDir) {
  console.error("FAIL: no new log session detected");
  process.exit(1);
}

const consoleLog = readFileSync(join(tracker.sessionDir, "console.log"), "utf-8");
const cliLine = consoleLog.split(/\r?\n/).find((l) => l.includes("CLI Params:"));
console.log(`engine echo: ${cliLine?.trim() ?? "(CLI Params line not found)"}`);

const verdictReached = result.earlySignal === "successful" || result.earlySignal === "failed";
console.log(
  verdictReached
    ? `PASS: verdict '${result.earlySignal}' reached${tracker.watchdog.nudgeOutcome?.enterPosted ? " (launcher picker auto-confirmed live!)" : " (no nudge needed)"}`
    : "FAIL: no verdict reached",
);
process.exit(verdictReached ? 0 : 1);
