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
 * (`mod/Scripts/WorkbenchGame/EnfusionMCP/*.c`) into the sandbox, then deletes
 * from that one folder every `EMCP_WB_*.c` file the bundle does not hold (a
 * retired handler must not stay compiled: session 023); nothing else is deleted.
 *
 * `--probe-pack <dir>`, given once per pack (`mod-dev/probe`, `mod-dev/probe-mut`),
 * additionally installs development-only packs from `mod-dev/` into the
 * sandbox's own `Scripts/WorkbenchGame/EnfusionCensus/` folder (plan 4.2, 5.4
 * item 7). A pack is never installed alone (plan 5.1), and only into the 2.0
 * sandbox (a folder named `EMCP2_sandbox`; any other sandbox is refused). With
 * --really that folder ends up holding exactly the `ECEN_*.c` files of the packs
 * named: every other `ECEN_*.c` file in it is deleted first, so a pack installed
 * for an earlier session (the mutating pack after S-E) or a file removed from a
 * pack never stays compiled. DEVIATION from plan 5.1, which says the install
 * "never deletes anything" (DEC-029): this is the one deletion the installer
 * performs for a pack, limited to files named `ECEN_*.c` directly in that folder
 * of the 2.0 sandbox. Other files there are left alone. The handler set's
 * prune (`EMCP_WB_*.c` not in the bundle, directly in its own folder) is the
 * second deletion.
 *
 * Everything defaults to a dry run that prints what would happen. A real
 * spawn needs `--really`, a win32 host and the lease held by this lane
 * (`--id`); a real copy needs `--really` and the same held lease.
 *
 * Usage:
 *   npx tsx scripts/live/launch.ts [--gproj <path> | --no-project] [--force-settings <ini>]
 *       [--workbench-path <tools>] [--game-path <game>] [--id <lane id>] [--really]
 *   npx tsx scripts/live/launch.ts --install-handlers <sandbox dir>
 *       [--probe-pack <dir> [--probe-pack <dir>]] [--id <lane id>] [--really]
 */

import { spawn } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { loadConfig } from "../../src/config.js";
import { pruneStaleHandlers } from "../../src/workbench/handler-prune.js";
import { isMainModule, liveGateReason, optionValues, parseArgs } from "./cli.js";
import { Lane } from "./lane.js";
import {
  REPO_ROOT,
  SANDBOX_NAME,
  defaultPlaceholderContext,
  toPlaceholders,
  type PlaceholderContext,
} from "./paths.js";

// ── Constants ────────────────────────────────────────────────────────────────

/** Workbench executable name, as `src/workbench/client.ts` and `cli-runner.ts` use it. */
export const WORKBENCH_EXE = "ArmaReforgerWorkbenchSteamDiag.exe";

/** Handler folder of the shipped set (`src/workbench/client.ts` HANDLER_FOLDER). */
export const HANDLER_FOLDER = "EnfusionMCP";

/** Folder the development probe pack is installed into (plan 4.2). */
export const PROBE_PACK_FOLDER = "EnfusionCensus";

/**
 * S-A's U14 throwaway folder (`scripts/live/s-a-headless.ts`), planted beside where the shipped
 * set goes and removed by the same run. While it is in the sandbox, nothing installs handlers
 * and every sitting's pre-flight refuses (DEC-030, DEC-031).
 */
export const U14_THROWAWAY_FOLDER = "EMCP2_U14_Throwaway";

/**
 * S-C's U3 plant folder (`scripts/live/s-c-natives.ts`, step sc-15): a copy of a handler with one
 * syntax error, planted and removed by the same step. While it is in the sandbox, nothing installs
 * handlers and every sitting's pre-flight refuses, because the next launch would compile the
 * planted error (DEC-032).
 */
export const U3_PLANT_FOLDER = "EnfusionCensusU3";

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

/** Root under which development-only packs live (plan 5.4 item 7). */
export const MOD_DEV_ROOT = join(REPO_ROOT, "mod-dev");

/** File prefix of the mutating pack's scripts (installed for session S-E only). */
export const PROBE_MUT_PREFIX = "ECEN_ProbeMut";

/** `<sandbox>/Scripts/WorkbenchGame/EnfusionCensus`, where the probe packs are installed. */
export function probePackTarget(sandboxDir: string): string {
  return join(sandboxDir, "Scripts", "WorkbenchGame", PROBE_PACK_FOLDER);
}

/** True for a probe-pack script name: `ECEN_*.c`, case ignored (Windows file names). */
export function isProbePackFile(name: string): boolean {
  return /^ECEN_.*\.c$/i.test(name);
}

/** The mutating pack's scripts installed in the sandbox (`ECEN_ProbeMut*.c`), sorted. */
export function probeMutFiles(sandboxDir: string): string[] {
  const dir = probePackTarget(sandboxDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^ECEN_ProbeMut.*\.c$/i.test(f))
    .sort();
}

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
  /**
   * Probe packs: the `ECEN_*.c` files in the target that are not part of the
   * packs named, deleted before the copy with --really (listed on a dry run).
   * Handler set: the `EMCP_WB_*.c` files in the target that the bundle does not
   * hold, deleted after the copy with --really (listed on a dry run).
   */
  removed?: string[];
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
 * Files already there are overwritten by the bundled version. After the copy,
 * every `EMCP_WB_*.c` file in that one folder that the bundle does not hold is
 * deleted (pruneStaleHandlers: session 023 found two retired 1.x handlers still
 * installed, which would have kept compiling); nothing else is ever deleted.
 * Refuses unless `sandboxDir` holds a `.gproj`, and
 * while S-A's U14 throwaway copy is in the sandbox (the shipped set would land
 * beside a copy of its own classes, and the U14 rollback's net-zero check of
 * `Scripts/` would then fail).
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
  // Plan 5.1: the harness installs only into the 2.0 sandbox (DEC-032, S-C read M3).
  if (basename(resolve(sandboxDir)) !== SANDBOX_NAME) {
    throw new Error(
      `Refusing to install handlers into ${basename(resolve(sandboxDir))}: only the 2.0 sandbox (${SANDBOX_NAME}) takes them`,
    );
  }
  if (existsSync(join(sandboxDir, "Scripts", "WorkbenchGame", U14_THROWAWAY_FOLDER))) {
    throw new Error(
      `Refusing to install handlers: Scripts/WorkbenchGame/${U14_THROWAWAY_FOLDER} (S-A's U14 throwaway ` +
        "copy) is in the sandbox; run S-A's rollback command first, then stop and ask the owner",
    );
  }
  if (existsSync(join(sandboxDir, "Scripts", "WorkbenchGame", U3_PLANT_FOLDER))) {
    throw new Error(
      `Refusing to install handlers: Scripts/WorkbenchGame/${U3_PLANT_FOLDER} (S-C's U3 plant) is in the ` +
        "sandbox; run S-C's rollback command first, then stop and ask the owner",
    );
  }
  const files = handlerFiles(source);
  if (files.length === 0) throw new Error(`Bundled handler set is empty: ${source}`);
  const target = join(sandboxDir, "Scripts", "WorkbenchGame", HANDLER_FOLDER);
  if (opts.really) copyFiles(source, target, files);
  const removed = pruneStaleHandlers(target, files, { really: opts.really });
  return { source, target, files, copied: opts.really, removed };
}

/** The checked `.c` files of one pack directory under `mod-dev/`. Throws on any refusal. */
function packFiles(packDir: string, root: string): { source: string; files: string[] } {
  const source = resolve(packDir);
  const rel = relative(root, source);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`Refusing probe pack outside ${root}: ${packDir}`);
  }
  if (!existsSync(source) || !statSync(source).isDirectory()) {
    throw new Error(`Probe pack source ${packDir} does not exist`);
  }
  const files = handlerFiles(source);
  const foreign = files.filter((f) => !f.startsWith(PROBE_PACK_PREFIX));
  if (foreign.length > 0) {
    throw new Error(
      `Probe pack holds files without the ${PROBE_PACK_PREFIX} prefix: ${foreign.join(", ")}`,
    );
  }
  if (files.length === 0) throw new Error(`Probe pack ${basename(source)} holds no .c files`);
  return { source, files };
}

/**
 * Install development probe packs (`ECEN_*.c`) from under `mod-dev/` into
 * `<sandbox>/Scripts/WorkbenchGame/EnfusionCensus/`, so that the folder holds
 * exactly the `ECEN_*.c` files of the packs named. Refuses when a source is
 * absent, outside `mod-dev/`, holds a file without the ECEN_ prefix, when two
 * packs hold a file of the same name, when the sandbox is not the 2.0 sandbox
 * (`EMCP2_sandbox`), when the target is a link, or when the shipped handler set
 * is not installed in the sandbox (a pack is never installed alone).
 *
 * With `really`, every `ECEN_*.c` file in the target that is not part of the
 * packs named is deleted before the copy, and the folder is checked afterwards.
 * This is the installer's one deletion (plan 5.1 says the install never deletes
 * anything; DEC-029 records the deviation): only files named `ECEN_*.c`,
 * directly in that folder, of the 2.0 sandbox.
 */
export function installProbePacks(
  sandboxDir: string,
  packDirs: readonly string[],
  opts: { really: boolean; modDevRoot?: string; bundledDir?: string },
): CopyPlan[] {
  if (packDirs.length === 0) throw new Error("No probe pack named");
  const root = resolve(opts.modDevRoot ?? MOD_DEV_ROOT);
  const packs = packDirs.map((d) => packFiles(d, root));
  const owner = new Map<string, string>();
  for (const p of packs) {
    for (const f of p.files) {
      const k = f.toLowerCase();
      const prior = owner.get(k);
      if (prior !== undefined && prior !== p.source) {
        throw new Error(`Probe packs ${basename(prior)} and ${basename(p.source)} both hold ${f}`);
      }
      owner.set(k, p.source);
    }
  }
  if (basename(resolve(sandboxDir)) !== SANDBOX_NAME) {
    throw new Error(
      `Refusing to install a probe pack into ${sandboxDir}: only the 2.0 sandbox (${SANDBOX_NAME}) takes one`,
    );
  }
  const target = probePackTarget(sandboxDir);
  if (existsSync(target) && lstatSync(target).isSymbolicLink()) {
    throw new Error(`Refusing to install into ${target}: it is a link`);
  }
  const shipped = join(sandboxDir, "Scripts", "WorkbenchGame", HANDLER_FOLDER);
  const bundled = opts.bundledDir ?? BUNDLED_HANDLER_DIR;
  const shippedFiles = existsSync(bundled) ? handlerFiles(bundled) : [];
  if (opts.really && !shippedFiles.every((f) => existsSync(join(shipped, f)))) {
    throw new Error(
      "Refusing to install the probe pack alone: install the shipped handler set first",
    );
  }
  const keep = new Set(owner.keys());
  const present = existsSync(target) ? readdirSync(target).filter(isProbePackFile) : [];
  const removed = present.filter((f) => !keep.has(f.toLowerCase())).sort();
  if (opts.really) {
    for (const f of removed) unlinkSync(join(target, f));
    for (const p of packs) copyFiles(p.source, target, p.files);
    const after = readdirSync(target)
      .filter(isProbePackFile)
      .map((f) => f.toLowerCase())
      .sort();
    const want = [...keep].sort();
    if (after.length !== want.length || after.some((f, i) => f !== want[i])) {
      throw new Error(
        `After the install ${target} holds ${after.join(", ")}, not exactly the packs' ${want.join(", ")}`,
      );
    }
  }
  return packs.map((p, i) => ({
    source: p.source,
    target,
    files: p.files,
    copied: opts.really,
    ...(i === 0 ? { removed } : {}),
  }));
}

/** One probe pack: `installProbePacks` with a single pack. */
export function installProbePack(
  sandboxDir: string,
  packDir: string,
  opts: { really: boolean; modDevRoot?: string; bundledDir?: string },
): CopyPlan {
  return installProbePacks(sandboxDir, [packDir], opts)[0];
}

// ── Spawn ────────────────────────────────────────────────────────────────────

/**
 * Start Workbench with `plan`, detached, and record its pid and project in the
 * lane's lease. Callers must have passed the live gate first. The `error`
 * listener is attached before anything can throw: a spawn that fails (the pid
 * is undefined and Node emits `error` on the next tick) ends as the thrown
 * refusal below, never as an unhandled error event that kills the caller
 * before it prints its outcome (DEC-032, S-B read m5; S-A's `spawnWithExit`
 * had the same fix in DEC-031).
 */
export function spawnWorkbench(plan: LaunchPlan, lane: Lane, gproj: string | null): number {
  const child = spawn(plan.exe, plan.args, {
    cwd: plan.cwd,
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });
  let spawnError: string | null = null;
  child.on("error", (e) => {
    spawnError = e.message;
  });
  const pid = child.pid;
  child.unref();
  if (pid === undefined) {
    throw new Error(
      `Workbench did not start: ${plan.commandLine}${spawnError ? ` (${spawnError})` : ""}`,
    );
  }
  lane.record(pid, gproj);
  return pid;
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function printCopy(label: string, plan: CopyPlan, ph: PlaceholderContext): void {
  if (plan.removed !== undefined) {
    const verb = plan.copied ? "deleted" : "would delete";
    const what =
      label === "handler set"
        ? "EMCP_WB_*.c file(s) not in the bundle"
        : "ECEN_*.c file(s) not in the packs named";
    console.log(
      `${label}: ${verb} ${plan.removed.length} ${what}` +
        (plan.removed.length ? `: ${plan.removed.join(", ")}` : ""),
    );
  }
  console.log(`${label}: ${plan.copied ? "copied" : "would copy"} ${plan.files.length} files`);
  // Every printed path in placeholder form (plan 5.2; DEC-032, S-C read m6).
  console.log(`  from ${toPlaceholders(plan.source, ph)}`);
  console.log(`  to   ${toPlaceholders(plan.target, ph)}`);
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
    console.error(
      toPlaceholders(e instanceof Error ? e.message : String(e), defaultPlaceholderContext()),
    );
    return 2;
  }
  const really = args.flags.has("really");
  // Every printed path in placeholder form (plan 5.2; DEC-032, S-C read m6), the catch included.
  let ph: PlaceholderContext = defaultPlaceholderContext({ v2: REPO_ROOT });
  try {
    const packDirs = optionValues(argv, "probe-pack");
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
      ph = defaultPlaceholderContext({ v2: REPO_ROOT, sandbox: resolve(sandbox) });
      // Copying is not platform-bound, so only --really and the lease gate it.
      const reason = liveGateReason({ really, platform: "win32", leaseHeld });
      // Every refusal of the packs comes before anything is copied.
      if (packDirs.length > 0) installProbePacks(sandbox, packDirs, { really: false });
      const handlers = installHandlers(sandbox, { really: reason === null });
      printCopy("handler set", handlers, ph);
      if (packDirs.length > 0) {
        const packs = installProbePacks(sandbox, packDirs, { really: reason === null });
        for (const p of packs) printCopy(`probe pack ${basename(p.source)}`, p, ph);
      }
      if (reason) console.log(reason);
      return 0;
    }
    if (packDirs.length > 0) {
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
    const workbenchPath = args.options["workbench-path"] ?? config!.workbenchPath;
    const gamePath = args.options["game-path"] ?? config!.gamePath;
    ph = defaultPlaceholderContext({
      v2: REPO_ROOT,
      tools: workbenchPath,
      game: gamePath,
      ...(gproj && basename(dirname(gproj)) === SANDBOX_NAME ? { sandbox: dirname(gproj) } : {}),
    });
    if (gproj && !args.flags.has("any-project") && basename(dirname(gproj)) !== SANDBOX_NAME) {
      console.error(
        `Refusing to launch ${toPlaceholders(gproj, ph)}: the 2.0 harness drives only the ${SANDBOX_NAME} addon ` +
          "(plan 5.1). Pass --any-project to override for a throwaway copy.",
      );
      return 1;
    }
    const plan = buildLaunch({
      workbenchPath,
      gamePath,
      gproj,
      forceSettings: args.options["force-settings"],
    });
    console.log(`exe:  ${toPlaceholders(plan.exe, ph)}`);
    console.log(`args: ${toPlaceholders(JSON.stringify(plan.args), ph)}`);
    console.log(`cwd:  ${toPlaceholders(plan.cwd, ph)}`);
    console.log(`command line: ${toPlaceholders(plan.commandLine, ph)}`);
    const reason = liveGateReason({ really, platform: process.platform, leaseHeld });
    if (reason) {
      console.log(reason);
      return really ? 1 : 0;
    }
    const pid = spawnWorkbench(plan, lane!, gproj);
    console.log(`started Workbench pid ${pid}; recorded in the lane lease`);
    return 0;
  } catch (e) {
    console.error(toPlaceholders(e instanceof Error ? e.message : String(e), ph));
    return 1;
  }
}

if (isMainModule(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
