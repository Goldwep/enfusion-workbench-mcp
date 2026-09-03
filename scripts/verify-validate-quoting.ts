/**
 * Live verification for the wb_validate_scripts quoting + early-verdict fix
 * (2026-08-20). Drives the real runWorkbench/buildValidateArgs code path
 * against a .gproj whose path contains spaces, then reads the engine's
 * `CLI Params:` echo out of the new log session's console.log to prove the
 * full path survived tokenization, and reports the script.log verdict.
 *
 * Usage: npx tsx scripts/verify-validate-quoting.ts [path-to-gproj]
 * Default target: Test1 under `Documents\My Games\...` (spacey path).
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { runWorkbench } from "../src/workbench/cli-runner.js";
import {
  buildValidateArgs,
  findNewSessionDir,
  matchValidationVerdict,
  snapshotSessionDirs,
} from "../src/tools/wb-validate-scripts.js";

const WORKBENCH_PATH =
  process.env.ENFUSION_WORKBENCH_PATH ??
  "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Arma Reforger Tools";
const LOGS_ROOT = join(homedir(), "Documents", "My Games", "ArmaReforgerWorkbench", "logs");
const gproj =
  process.argv[2] ??
  join(
    homedir(),
    "Documents",
    "My Games",
    "ArmaReforgerWorkbench",
    "addons",
    "Test1",
    "addon.gproj",
  );

if (!existsSync(gproj)) {
  console.error(`target .gproj not found: ${gproj}`);
  process.exit(1);
}
if (!gproj.includes(" ")) {
  console.warn("WARN: target path has no spaces — quoting bug would not reproduce anyway");
}

const args = buildValidateArgs(gproj, "PC");
console.log(`argv: ${JSON.stringify(args)}`);

const priorSessions = snapshotSessionDirs(LOGS_ROOT);
let sessionDir: string | null = null;

const result = await runWorkbench({
  workbenchPath: WORKBENCH_PATH,
  args,
  timeoutMs: 180_000,
  pollSignal: {
    intervalMs: 2000,
    check: () => {
      sessionDir ??= findNewSessionDir(LOGS_ROOT, priorSessions);
      if (!sessionDir) return null;
      const scriptLog = join(sessionDir, "script.log");
      if (!existsSync(scriptLog)) return null;
      return matchValidationVerdict(readFileSync(scriptLog, "utf-8"));
    },
  },
});

console.log(`earlySignal: ${result.earlySignal}`);
console.log(`timedOut: ${result.timedOut}  exitCode: ${result.exitCode}`);
console.log(`duration: ${(result.durationMs / 1000).toFixed(1)}s`);
console.log(`session: ${sessionDir}`);

if (!sessionDir) {
  console.error("FAIL: no new log session detected");
  process.exit(1);
}

const consoleLog = readFileSync(join(sessionDir, "console.log"), "utf-8");
const cliLine = consoleLog.split(/\r?\n/).find((l) => l.includes("CLI Params:"));
console.log(`engine echo: ${cliLine?.trim() ?? "(CLI Params line not found)"}`);

const pathParsedFully = cliLine?.includes(gproj) ?? false;
console.log(
  pathParsedFully
    ? "PASS: full spacey path survived engine tokenization"
    : "FAIL: engine echo does not contain the full gproj path",
);
if (!pathParsedFully || result.earlySignal === null) process.exit(1);
