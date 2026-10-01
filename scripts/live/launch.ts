/**
 * Workbench launch for the live lane (plan 5.3 pre-flight step 8) and the
 * explicit handler install into the 2.0 sandbox (plan 5.1 "The sandbox").
 *
 * The proven launch form: the executable from config, `-gproj` and the
 * sandbox `.gproj` as SEPARATE argv elements (the engine re-tokenises the raw
 * command line and only honours quotes around a standalone value token, see
 * `src/workbench/cli-runner.ts`), working directory `<game>`, plus
 * `-forceSettings <ini>` once U12 has passed. The launcher-walk variant passes
 * no project at all.
 *
 * `--install-handlers <sandbox dir>` copies the shipped handler set
 * (`mod/Scripts/WorkbenchGame/EnfusionMCP/*.c`) into the sandbox. It only
 * copies; it never deletes anything. `--probe-pack <dir>` additionally copies
 * a development-only pack from `mod-dev/` into the sandbox's own
 * `Scripts/WorkbenchGame/EnfusionCensus/` folder (plan 4.2, 5.4 item 7). The
 * probe pack is never installed alone (plan 5.1). NOTE: `mod-dev/` does not
 * exist in this repository yet (the probe pack is a Phase 2 deliverable), so
 * the flag refuses until its source directory exists.
 *
 * Everything defaults to a dry run that prints what would happen. A real
 * spawn needs `--really`, a win32 host and the lease held by this lane
 * (`--id`); a real copy needs `--really` and the same held lease.
 *
 * Usage:
 *   npx tsx scripts/live/launch.ts [--gproj <path> | --no-project] [--force-settings <ini>]
 *       [--workbench-path <tools>] [--game-path <game>] [--id <lane id>] [--really]
 *   npx tsx scripts/live/launch.ts --install-handlers <sandbox dir> [--probe-pack <dir>]
 *       [--id <lane id>] [--really]
 */

import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { loadConfig } from "../../src/config.js";
import { isMainModule, liveGateReason, parseArgs } from "./cli.js";
import { Lane } from "./lane.js";
import { REPO_ROOT, SANDBOX_NAME } from "./paths.js";

// ── Constants ────────────────────────────────────────────────────────────────

/** Workbench executable name, as `src/workbench/client.ts` and `cli-runner.ts` use it. */
export const WORKBENCH_EXE = "ArmaReforgerWorkbenchSteamDiag.exe";

/** Handler folder of the shipped set (`src/workbench/client.ts` HANDLER_FOLDER). */
export const HANDLER_FOLDER = "EnfusionMCP";

/** Folder the development probe pack is installed into (plan 4.2). */
export const PROBE_PACK_FOLDER = "EnfusionCensus";

/** File prefix of probe-pack scripts (plan 5.1: `ECEN_*.c`, own class prefix). */
export const PROBE_PACK_PREFIX = "ECEN_";

/** The shipped handler set inside this repository. */
export const BUNDLED_HANDLER_DIR = join(
  REPO_ROOT,
  "mod",
  "Scripts",
  "WorkbenchGame",
  HANDLER_FOLDER,
);

/** Root under which development-only packs live (plan 5.4 item 7). Absent today. */
export const MOD_DEV_ROOT = join(REPO_ROOT, "mod-dev");

// ── Launch form ──────────────────────────────────────────────────────────────

export interface LaunchInput {
  /** Arma Reforger Tools install (config.workbenchPath). */
  workbenchPath: string;
  /** Arma Reforger game install (config.gamePath): the working directory. */
  gamePath: string;
  /** Sandbox `.gproj`, or null for the launcher-walk variant (no project). */
  gproj: string | null;
  /** Scratch settings file for `-forceSettings` (after U12, or session S-B). */
  forceSettings?: string;
  /** Existence probe, injectable for tests. */
  exists?: (path: string) => boolean;
}

export interface LaunchPlan {
  exe: string;
  args: string[];
  cwd: string;
  /** The command line as Windows would see it, for the dry-run print. */
  commandLine: string;
}

/**
 * Executable path from the Tools install: `<tools>/Workbench/<exe>` first,
 * then `<tools>/<exe>`, the same order as `WorkbenchClient.findWorkbenchExe`.
 * When neither exists the first form is returned so the dry run shows it.
 */
export function resolveWorkbenchExe(
  workbenchPath: string,
  exists: (path: string) => boolean = existsSync,
): string {
  const sub = join(workbenchPath, "Workbench", WORKBENCH_EXE);
  if (exists(sub)) return sub;
  const root = join(workbenchPath, WORKBENCH_EXE);
  return exists(root) ? root : sub;
}

/** Quote one argument by the Windows command-line rules (CommandLineToArgvW). */
export function quoteWindowsArg(arg: string): string {
  if (arg !== "" && !/[\s"]/.test(arg)) return arg;
  let out = '"';
  let backslashes = 0;
  for (const c of arg) {
    if (c === "\\") {
      backslashes++;
    } else if (c === '"') {
      out += "\\".repeat(backslashes * 2 + 1) + '"';
      backslashes = 0;
    } else {
      out += "\\".repeat(backslashes) + c;
      backslashes = 0;
    }
  }
  return out + "\\".repeat(backslashes * 2) + '"';
}

/** The full command line for a dry-run print. */
export function formatCommandLine(exe: string, args: string[]): string {
  return [exe, ...args].map(quoteWindowsArg).join(" ");
}

/** Build the proven launch form. Throws on a flag-shaped path. */
export function buildLaunch(input: LaunchInput): LaunchPlan {
  const exe = resolveWorkbenchExe(input.workbenchPath, input.exists);
  const args: string[] = [];
  if (input.gproj !== null) {
    if (input.gproj.startsWith("-"))
      throw new Error(`Refusing flag-shaped project path: ${input.gproj}`);
    if (!input.gproj.toLowerCase().endsWith(".gproj")) {
      throw new Error(`Project path must be a .gproj file: ${input.gproj}`);
    }
    args.push("-gproj", input.gproj);
  }
  if (input.forceSettings !== undefined) {
    if (input.forceSettings.startsWith("-")) {
      throw new Error(`Refusing flag-shaped settings path: ${input.forceSettings}`);
    }
    args.push("-forceSettings", input.forceSettings);
  }
  return { exe, args, cwd: input.gamePath, commandLine: formatCommandLine(exe, args) };
}

/** Default sandbox `.gproj`: `<addons>/EMCP2_sandbox/EMCP2_sandbox.gproj`. */
export function defaultSandboxGproj(addonsDir: string): string {
  return join(addonsDir, SANDBOX_NAME, `${SANDBOX_NAME}.gproj`);
}

// ── Handler install (copy only) ──────────────────────────────────────────────

export interface CopyPlan {
  source: string;
  target: string;
  files: string[];
  /** True when the files were actually copied. */
  copied: boolean;
}

function hasGproj(dir: string): boolean {
  try {
    return readdirSync(dir).some((f) => f.toLowerCase().endsWith(".gproj"));
  } catch {
    return false;
  }
}

function copyFiles(source: string, target: string, files: string[]): void {
  mkdirSync(target, { recursive: true });
  for (const f of files) copyFileSync(join(source, f), join(target, f));
}

/** The `.c` files of a handler set directory, sorted. */
export function handlerFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".c"))
    .sort();
}

/**
 * Copy the shipped handler set into `<sandbox>/Scripts/WorkbenchGame/EnfusionMCP/`.
 * Copy only: files already there are overwritten by the bundled version and
 * nothing is ever deleted. Refuses unless `sandboxDir` holds a `.gproj`.
 */
export function installHandlers(
  sandboxDir: string,
  opts: { really: boolean; bundledDir?: string },
): CopyPlan {
  const source = opts.bundledDir ?? BUNDLED_HANDLER_DIR;
  if (!existsSync(source)) throw new Error(`Bundled handler set not found: ${source}`);
  if (!hasGproj(sandboxDir)) {
    throw new Error(`Refusing to install handlers: ${sandboxDir} holds no .gproj (not an addon)`);
  }
  const files = handlerFiles(source);
  if (files.length === 0) throw new Error(`Bundled handler set is empty: ${source}`);
  const target = join(sandboxDir, "Scripts", "WorkbenchGame", HANDLER_FOLDER);
  if (opts.really) copyFiles(source, target, files);
  return { source, target, files, copied: opts.really };
}

/**
 * Copy a development probe pack (`ECEN_*.c`) from under `mod-dev/` into
 * `<sandbox>/Scripts/WorkbenchGame/EnfusionCensus/`. Refuses when the source
 * is absent, outside `mod-dev/`, holds a file without the ECEN_ prefix, or
 * when the shipped handler set is not installed in the sandbox (the pack is
 * never installed alone).
 */
export function installProbePack(
  sandboxDir: string,
  packDir: string,
  opts: { really: boolean; modDevRoot?: string },
): CopyPlan {
  const root = resolve(opts.modDevRoot ?? MOD_DEV_ROOT);
  const source = resolve(packDir);
  const rel = relative(root, source);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`Refusing probe pack outside ${root}: ${packDir}`);
  }
  if (!existsSync(source) || !statSync(source).isDirectory()) {
    throw new Error(
      `Probe pack source ${packDir} does not exist. mod-dev/ is created with the probe pack ` +
        "(plan Phase 2); until then this flag refuses.",
    );
  }
  const all = handlerFiles(source);
  const foreign = all.filter((f) => !f.startsWith(PROBE_PACK_PREFIX));
  if (foreign.length > 0) {
    throw new Error(
      `Probe pack holds files without the ${PROBE_PACK_PREFIX} prefix: ${foreign.join(", ")}`,
    );
  }
  if (all.length === 0) throw new Error(`Probe pack ${basename(source)} holds no .c files`);
  const shipped = join(sandboxDir, "Scripts", "WorkbenchGame", HANDLER_FOLDER);
  const shippedFiles = existsSync(BUNDLED_HANDLER_DIR) ? handlerFiles(BUNDLED_HANDLER_DIR) : [];
  if (opts.really && !shippedFiles.every((f) => existsSync(join(shipped, f)))) {
    throw new Error(
      "Refusing to install the probe pack alone: install the shipped handler set first",
    );
  }
  const target = join(sandboxDir, "Scripts", "WorkbenchGame", PROBE_PACK_FOLDER);
  if (opts.really) copyFiles(source, target, all);
  return { source, target, files: all, copied: opts.really };
}

// ── Spawn ────────────────────────────────────────────────────────────────────

/**
 * Start Workbench with `plan`, detached, and record its pid and project in the
 * lane's lease. Callers must have passed the live gate first.
 */
export function spawnWorkbench(plan: LaunchPlan, lane: Lane, gproj: string | null): number {
  const child = spawn(plan.exe, plan.args, {
    cwd: plan.cwd,
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });
  const pid = child.pid;
  child.unref();
  if (pid === undefined) throw new Error(`Workbench did not start: ${plan.commandLine}`);
  lane.record(pid, gproj);
  return pid;
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function printCopy(label: string, plan: CopyPlan): void {
  console.log(`${label}: ${plan.copied ? "copied" : "would copy"} ${plan.files.length} files`);
  console.log(`  from ${plan.source}`);
  console.log(`  to   ${plan.target}`);
  for (const f of plan.files) console.log(`  ${f}`);
}

export function main(argv: string[]): number {
  let args;
  try {
    args = parseArgs(argv, [
      "gproj",
      "force-settings",
      "workbench-path",
      "game-path",
      "install-handlers",
      "probe-pack",
      "id",
      "lease-path",
      "marker-path",
    ]);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 2;
  }
  const really = args.flags.has("really");
  try {
    const lane = args.options.id
      ? new Lane({
          id: args.options.id,
          leasePath: args.options["lease-path"],
          markerPath: args.options["marker-path"],
        })
      : null;
    const leaseHeld = lane ? lane.holdsLease() : false;

    // Handler install mode.
    if (args.options["install-handlers"] !== undefined) {
      const sandbox = args.options["install-handlers"];
      // Copying is not platform-bound, so only --really and the lease gate it.
      const reason = liveGateReason({ really, platform: "win32", leaseHeld });
      const handlers = installHandlers(sandbox, { really: reason === null });
      printCopy("handler set", handlers);
      if (args.options["probe-pack"] !== undefined) {
        const pack = installProbePack(sandbox, args.options["probe-pack"], {
          really: reason === null,
        });
        printCopy("probe pack", pack);
      }
      if (reason) console.log(reason);
      return 0;
    }
    if (args.options["probe-pack"] !== undefined) {
      console.error("--probe-pack is only valid together with --install-handlers (never alone)");
      return 2;
    }

    // Launch mode.
    const needConfig = !args.options["workbench-path"] || !args.options["game-path"];
    const needGproj = !args.options.gproj && !args.flags.has("no-project");
    const config = needConfig || needGproj ? loadConfig() : null;
    const gproj = args.flags.has("no-project")
      ? null
      : (args.options.gproj ?? defaultSandboxGproj(config!.projectPath));
    // Plan 5.1: the harness always passes the explicit 2.0 sandbox project.
    // Anything else needs --any-project, and is never Test1_sandbox.
    if (gproj && !args.flags.has("any-project") && basename(dirname(gproj)) !== SANDBOX_NAME) {
      console.error(
        `Refusing to launch ${gproj}: the 2.0 harness drives only the ${SANDBOX_NAME} addon ` +
          "(plan 5.1). Pass --any-project to override for a throwaway copy.",
      );
      return 1;
    }
    const plan = buildLaunch({
      workbenchPath: args.options["workbench-path"] ?? config!.workbenchPath,
      gamePath: args.options["game-path"] ?? config!.gamePath,
      gproj,
      forceSettings: args.options["force-settings"],
    });
    console.log(`exe:  ${plan.exe}`);
    console.log(`args: ${JSON.stringify(plan.args)}`);
    console.log(`cwd:  ${plan.cwd}`);
    console.log(`command line: ${plan.commandLine}`);
    const reason = liveGateReason({ really, platform: process.platform, leaseHeld });
    if (reason) {
      console.log(reason);
      return really ? 1 : 0;
    }
    const pid = spawnWorkbench(plan, lane!, gproj);
    console.log(`started Workbench pid ${pid}; recorded in the lane lease`);
    return 0;
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 1;
  }
}

if (isMainModule(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
