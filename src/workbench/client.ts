/**
 * TCP client for the Workbench NET API.
 *
 * Each rawCall() opens a fresh TCP connection, sends one request, reads the
 * response, and closes the socket (protocol requirement).
 *
 * call() wraps rawCall() with auto-launch: if Workbench isn't running,
 * it installs handler scripts, launches the exe, waits for the NET API,
 * and retries the original call.
 */

import { Socket } from "node:net";
import {
  existsSync,
  mkdirSync,
  copyFileSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { findGameAcrossSteamLibraries, steamRootOf } from "../utils/steam.js";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { encodeRequest, decodeResponse } from "./protocol.js";
import { logger } from "../utils/logger.js";
import type { Config } from "../config.js";
import { generateGproj } from "../templates/gproj.js";
import { tailLines } from "./cli-runner.js";
import { LaunchWatchdog } from "./launch-watchdog.js";
import { inspectProcessWindows, nudgeEnfusionLauncher } from "./launcher-nudge.js";
import { WorkbenchLaunchTracker, snapshotSessionDirs } from "./launch-tracker.js";
import {
  buildPreflightNote,
  buildStuckReport,
  buildTimeoutDiagnostics,
} from "./launch-reports.js";
import { checkWorkbenchVisibleDeps, type WbDepsCheck } from "./wb-deps.js";

const DEFAULT_CLIENT_ID = "EnfusionMCP";
const DEFAULT_TIMEOUT_MS = 10_000;
/** Maximum response size (10 MB) to prevent memory exhaustion from malformed/unexpected data. */
const MAX_RESPONSE_SIZE = 10 * 1024 * 1024;
const WORKBENCH_EXE = "ArmaReforgerWorkbenchSteamDiag.exe";
const WORKBENCH_SUBDIR = "Workbench";
const HANDLER_FOLDER = "EnfusionMCP";
const LAUNCH_POLL_INTERVAL_MS = 3_000;
const LAUNCH_TIMEOUT_MS = 90_000;
/** How long to wait for Workbench to recompile handler scripts after installation. */
const HANDLER_RECOMPILE_TIMEOUT_MS = 30_000;
/** Interval between polls while waiting for handler script recompilation. */
const HANDLER_RECOMPILE_POLL_MS = 2_000;
/**
 * Substring of the NET API error returned when a handler isn't registered
 * (Workbench is up but our EMCP_* handlers haven't compiled). Used by both the
 * recovery path and diagnose() so they classify the same condition identically.
 */
const NO_HANDLERS_ERROR = "Undefined API func";

export type WorkbenchMode = "edit" | "play" | "unknown";

export interface DiagnosticReport {
  host: string;
  port: number;
  workbenchExe: { path: string; exists: boolean } | null;
  projectPath: { path: string; exists: boolean } | null;
  defaultMod: string | null;
  bundledScripts: { path: string; exists: boolean };
  standaloneAddon: { path: string; exists: boolean; fileCount: number };
  installedMods: Array<{ modDir: string; handlerDir: string; fileCount: number }>;
  /** Result of the NET API probe. */
  netApi: "up_with_handlers" | "up_no_handlers" | "refused" | "timeout" | "error";
  netApiError?: string;
}

export interface WorkbenchState {
  connected: boolean;
  mode: WorkbenchMode;
  lastUpdated: number;
}

export interface WorkbenchCallOptions {
  /** Timeout in milliseconds (default 10 000). */
  timeout?: number;
  /** Skip auto-launch on connection failure (used internally by ping). */
  skipAutoLaunch?: boolean;
}

export class WorkbenchError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "CONNECTION_REFUSED"
      | "TIMEOUT"
      | "PROTOCOL_ERROR"
      | "API_ERROR"
      | "LAUNCH_FAILED"
      /**
       * A launch is already in flight for a DIFFERENT .gproj than the one
       * requested. The caller must wait for that launch (or stop Workbench)
       * rather than joining it — joining would report the wrong project as
       * launched. `message` names both projects.
       */
      | "LAUNCH_MISMATCH" = "API_ERROR",
  ) {
    super(message);
    this.name = "WorkbenchError";
  }
}

/**
 * Normalise a .gproj path for identity comparison (absolute, forward
 * slashes, case-folded on win32 where the file system is case-insensitive).
 */
function normalizeGprojKey(p: string): string {
  const abs = resolve(p).replace(/\\/g, "/");
  return process.platform === "win32" ? abs.toLowerCase() : abs;
}

/** Title written into the generated standalone addon .gproj (marker for cleanup). */
const STANDALONE_GPROJ_TITLE = "EnfusionMCP Handlers";

/**
 * True when `dir` is the standalone addon THIS package generated — it holds
 * our EMCP_WB_Ping.c handler and/or the .gproj we wrote with our title.
 * Anything else named "EnfusionMCP" is a user directory and must survive.
 * Exported for tests.
 */
export function isOurStandaloneAddon(dir: string): boolean {
  if (existsSync(join(dir, "Scripts", "WorkbenchGame", HANDLER_FOLDER, "EMCP_WB_Ping.c"))) {
    return true;
  }
  const gproj = join(dir, `${HANDLER_FOLDER}.gproj`);
  if (existsSync(gproj)) {
    try {
      return readFileSync(gproj, "utf-8").includes(STANDALONE_GPROJ_TITLE);
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Content digest of the `.c` handler set in `dir` (name + bytes of every
 * file, sorted). Returns null when the directory is missing/unreadable, so a
 * missing install never compares equal to the bundled set. Exported for tests.
 */
export function handlerSetDigest(dir: string): string | null {
  let names: string[];
  try {
    names = readdirSync(dir)
      .filter((f) => f.endsWith(".c"))
      .sort();
  } catch {
    return null;
  }
  if (names.length === 0) return null;
  const h = createHash("sha1");
  for (const name of names) {
    let bytes: Buffer;
    try {
      bytes = readFileSync(join(dir, name));
    } catch {
      return null;
    }
    h.update(name);
    h.update("\0");
    h.update(bytes);
    h.update("\0");
  }
  return h.digest("hex");
}

export class WorkbenchClient {
  private launchPromise: Promise<void> | null = null;
  /**
   * The .gproj the in-flight launch is opening (null while resolving, or
   * when no launch is in flight). Set from the caller's explicit request in
   * ensureRunning() and refined to the resolved fallback inside
   * launchWorkbench(), so a later ensureRunning(otherGproj) can refuse.
   */
  private launchTarget: string | null = null;
  private recoverPromise: Promise<void> | null = null;
  private _state: WorkbenchState = { connected: false, mode: "unknown", lastUpdated: 0 };

  /**
   * Human-readable notes from the most recent launchWorkbench run (e.g.
   * "launcher picker was auto-confirmed", dependency warnings). Reset at
   * each launch; tools may surface them alongside their own output.
   */
  lastLaunchNotes: string[] = [];

  /** Current cached connection state. Updated after every successful call. */
  get state(): Readonly<WorkbenchState> {
    return this._state;
  }

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly config?: Config,
    private readonly clientId: string = DEFAULT_CLIENT_ID,
  ) {}

  /**
   * Call a Workbench NET API function.
   * Auto-launches Workbench if not running.
   */
  async call<T = Record<string, unknown>>(
    apiFunc: string,
    params: Record<string, unknown> = {},
    options: WorkbenchCallOptions = {},
  ): Promise<T> {
    try {
      const result = await this.rawCall<T>(apiFunc, params, options);
      this._state.connected = true;
      this._state.lastUpdated = Date.now();
      this.extractMode(result);
      return result;
    } catch (err) {
      if (err instanceof WorkbenchError) {
        if (
          err.code === "CONNECTION_REFUSED" ||
          err.code === "TIMEOUT" ||
          err.code === "PROTOCOL_ERROR"
        ) {
          this._state = { connected: false, mode: "unknown", lastUpdated: Date.now() };
        }
        if (!options.skipAutoLaunch && this.config) {
          if (err.code === "CONNECTION_REFUSED") {
            // Workbench not running — install handlers, launch, retry
            logger.info("Workbench not running, auto-launching...");
            await this.ensureRunning();
            const result = await this.rawCall<T>(apiFunc, params, options);
            this._state.connected = true;
            this._state.lastUpdated = Date.now();
            this.extractMode(result);
            return result;
          }
          if (err.code === "API_ERROR" && err.message.includes(NO_HANDLERS_ERROR)) {
            // Workbench is running but our custom handler scripts aren't compiled.
            // This happens when the user opened Workbench manually, or when handlers
            // were cleaned up but Workbench kept running.
            logger.info("Handler scripts not loaded in Workbench, recovering...");
            await this.recoverMissingHandlers();
            const result = await this.rawCall<T>(apiFunc, params, options);
            this._state.connected = true;
            this._state.lastUpdated = Date.now();
            this.extractMode(result);
            return result;
          }
        }
      }
      throw err;
    }
  }

  /**
   * Explicitly refresh cached state by calling EMCP_WB_GetState.
   */
  async refreshState(): Promise<WorkbenchState> {
    try {
      await this.call<Record<string, unknown>>("EMCP_WB_GetState");
      return { ...this._state };
    } catch {
      this._state = { connected: false, mode: "unknown", lastUpdated: Date.now() };
      return { ...this._state };
    }
  }

  /**
   * Ensure Workbench is running. Installs handler scripts, launches exe,
   * and waits for NET API. Safe to call concurrently — deduplicates launches.
   * @param gprojPath Optional .gproj file path to open directly (skips launcher).
   */
  async ensureRunning(gprojPath?: string): Promise<void> {
    if (!this.config) {
      throw new WorkbenchError(
        "No config provided — cannot auto-launch Workbench.",
        "LAUNCH_FAILED",
      );
    }

    // Deduplicate concurrent calls — callers that want ANY Workbench (no
    // gprojPath) or the SAME project join the in-flight launch. A caller
    // asking for a DIFFERENT project must not join: it would return once the
    // other project is up and let the tool report handlers installed into
    // the wrong mod. Refuse with LAUNCH_MISMATCH so the tool can render it.
    if (this.launchPromise) {
      if (gprojPath && this.launchTarget && normalizeGprojKey(gprojPath) !== this.launchTarget) {
        throw new WorkbenchError(
          `A Workbench launch is already in progress for a different project ` +
            `(${this.launchTargetDisplay ?? this.launchTarget}); refusing to launch ${gprojPath}. ` +
            "Wait for the in-flight launch to finish (wb_state / wb_diagnose), then stop Workbench " +
            "with wb_stop before launching another project.",
          "LAUNCH_MISMATCH",
        );
      }
      return this.launchPromise;
    }

    this.launchTarget = gprojPath ? normalizeGprojKey(gprojPath) : null;
    this.launchTargetDisplay = gprojPath ?? null;
    const promise = this.launchWorkbench(gprojPath).finally(() => {
      // Only clear if this is still the active promise (guards against re-entrant calls)
      if (this.launchPromise === promise) {
        this.launchPromise = null;
        this.launchTarget = null;
        this.launchTargetDisplay = null;
      }
    });

    this.launchPromise = promise;
    return promise;
  }

  /** Human-readable form of `launchTarget` (original path as given/resolved). */
  private launchTargetDisplay: string | null = null;

  /**
   * The .gproj an in-flight launch is opening, or null when no launch is in
   * progress. Tools can use this to explain a LAUNCH_MISMATCH refusal.
   */
  get inFlightLaunchTarget(): string | null {
    return this.launchPromise ? this.launchTargetDisplay : null;
  }

  /**
   * Quick health check. Returns true if Workbench responds, false otherwise.
   * Does NOT auto-launch.
   *
   * Uses our custom EMCP_WB_Ping handler (not the built-in GetLoadedProjects)
   * so the launch poller only succeeds once the mod's handler scripts have
   * finished compiling — avoiding a race where the NET API socket is up but
   * custom handlers aren't loaded yet.
   */
  async ping(): Promise<boolean> {
    try {
      await this.rawCall("EMCP_WB_Ping", {}, { timeout: 3000, skipAutoLaunch: true });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Remove injected handler scripts from a mod's directory.
   * Call this after Workbench work is done, before publishing the mod.
   * Deletes Scripts/WorkbenchGame/EnfusionMCP/ from the mod.
   * Safe to call even if scripts were never injected.
   */
  cleanupHandlerScripts(modDir: string): boolean {
    const handlerDir = resolve(modDir, "Scripts", "WorkbenchGame", HANDLER_FOLDER);
    logger.info(`Checking for handler scripts at: ${handlerDir}`);
    if (!existsSync(handlerDir)) {
      logger.info(`Handler scripts not found at ${handlerDir}`);
      return false;
    }
    try {
      rmSync(handlerDir, { recursive: true, force: true });
      logger.info(`Removed handler scripts from ${handlerDir}`);
    } catch (e) {
      logger.warn(`Failed to clean up handler scripts: ${e}`);
      return false;
    }
    // Prune the now-empty parent, best-effort: a failure here must not turn a
    // successful removal into a false "nothing was removed" report (plain
    // rmSync(dir) throws EISDIR, which previously did exactly that).
    try {
      const wbGameDir = join(modDir, "Scripts", "WorkbenchGame");
      if (existsSync(wbGameDir) && readdirSync(wbGameDir).length === 0) {
        rmdirSync(wbGameDir);
      }
    } catch (e) {
      logger.warn(`Could not prune empty WorkbenchGame dir: ${e}`);
    }
    return true;
  }

  /**
   * Collect a diagnostic snapshot: config, file system, and NET API state.
   * Does NOT auto-launch Workbench or throw — always returns a report.
   */
  async diagnose(): Promise<DiagnosticReport> {
    // --- Config info ---
    const host = this.host;
    const port = this.port;
    const defaultMod = this.config?.defaultMod ?? null;

    // Workbench exe
    let workbenchExe: DiagnosticReport["workbenchExe"] = null;
    if (this.config) {
      const exePath = this.findWorkbenchExe();
      const candidate = exePath ?? join(this.config.workbenchPath, WORKBENCH_SUBDIR, WORKBENCH_EXE);
      workbenchExe = { path: candidate, exists: existsSync(candidate) };
    }

    // Project path
    let projectPathInfo: DiagnosticReport["projectPath"] = null;
    if (this.config?.projectPath) {
      projectPathInfo = {
        path: this.config.projectPath,
        exists: existsSync(this.config.projectPath),
      };
    }

    // Bundled handler scripts (inside this package)
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
    const bundledDir = join(packageRoot, "mod", "Scripts", "WorkbenchGame", HANDLER_FOLDER);
    const bundledScripts = { path: bundledDir, exists: existsSync(bundledDir) };

    // Standalone addon
    const standaloneBase = this.config?.projectPath
      ? join(this.config.projectPath, HANDLER_FOLDER)
      : join("<unknown>", HANDLER_FOLDER);
    const standaloneScriptsDir = join(standaloneBase, "Scripts", "WorkbenchGame", HANDLER_FOLDER);
    const standaloneFileCount = existsSync(standaloneScriptsDir)
      ? readdirSync(standaloneScriptsDir).filter((f) => f.endsWith(".c")).length
      : 0;
    const standaloneAddon = {
      path: standaloneBase,
      exists: existsSync(standaloneBase),
      fileCount: standaloneFileCount,
    };

    // Scan project path for mods that have handler scripts installed
    const installedMods: DiagnosticReport["installedMods"] = [];
    if (this.config?.projectPath && existsSync(this.config.projectPath)) {
      try {
        for (const entry of readdirSync(this.config.projectPath, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          if (entry.name === HANDLER_FOLDER) continue; // standalone, covered above
          const handlerDir = join(
            this.config.projectPath,
            entry.name,
            "Scripts",
            "WorkbenchGame",
            HANDLER_FOLDER,
          );
          if (existsSync(handlerDir)) {
            const fileCount = readdirSync(handlerDir).filter((f) => f.endsWith(".c")).length;
            installedMods.push({
              modDir: join(this.config.projectPath, entry.name),
              handlerDir,
              fileCount,
            });
          }
        }
      } catch {
        /* ignore */
      }
    }

    // --- NET API probe ---
    let netApi: DiagnosticReport["netApi"] = "refused";
    let netApiError: string | undefined;
    try {
      await this.rawCall("EMCP_WB_Ping", {}, { timeout: 3000, skipAutoLaunch: true });
      netApi = "up_with_handlers";
    } catch (err) {
      if (err instanceof WorkbenchError) {
        netApiError = err.message;
        if (err.code === "CONNECTION_REFUSED") {
          netApi = "refused";
        } else if (err.code === "TIMEOUT") {
          netApi = "timeout";
        } else if (err.code === "API_ERROR" && err.message.includes(NO_HANDLERS_ERROR)) {
          netApi = "up_no_handlers";
        } else {
          netApi = "error";
        }
      } else {
        netApi = "error";
        netApiError = String(err);
      }
    }

    return {
      host,
      port,
      workbenchExe,
      projectPath: projectPathInfo,
      defaultMod,
      bundledScripts,
      standaloneAddon,
      installedMods,
      netApi,
      netApiError,
    };
  }

  /**
   * Remove the standalone EnfusionMCP addon directory if it exists.
   * This prevents duplicate class name errors when handler scripts are injected
   * into a user's mod and the standalone folder is also present in the addons dir.
   */
  private cleanupStandaloneAddon(): void {
    const fallbackBase = this.config?.projectPath;
    if (!fallbackBase) return;
    const standaloneDir = join(fallbackBase, HANDLER_FOLDER);
    if (!existsSync(standaloneDir)) return;
    // Only delete a directory WE generated. A user addon that happens to be
    // named "EnfusionMCP" carries neither our handler Ping script nor our
    // generated .gproj title, and must be left alone.
    if (!isOurStandaloneAddon(standaloneDir)) {
      logger.warn(
        `Skipping ${standaloneDir}: not recognised as the generated EnfusionMCP addon ` +
          "(no EMCP_WB_Ping.c handler / generated .gproj) — leaving it in place.",
      );
      return;
    }
    try {
      rmSync(standaloneDir, { recursive: true, force: true });
      logger.info(`Removed leftover standalone addon: ${standaloneDir}`);
    } catch (e) {
      logger.warn(`Failed to remove standalone addon: ${e}`);
    }
  }

  toString(): string {
    return `WorkbenchClient(${this.host}:${this.port})`;
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /** Extract mode from a response object if it contains a `mode` field. */
  private extractMode(result: unknown): void {
    if (result && typeof result === "object" && "mode" in result) {
      const mode = (result as Record<string, unknown>).mode;
      if (mode === "edit") {
        this._state.mode = "edit";
      } else if (mode === "play" || mode === "game") {
        // Scripts return "game" when in play mode (WorldEditorAPI unavailable)
        this._state.mode = "play";
      }
      // "no_world_editor" and unrecognised values leave mode as-is (stays "unknown")
    }
  }

  /**
   * Recover from "not existing Net API function" errors.
   * Workbench is running but our custom handler scripts aren't compiled.
   * Installs handlers into the mod directory and waits for Workbench to
   * auto-recompile them — without killing the running Workbench process.
   *
   * Previous behaviour killed Workbench with taskkill, which broke other
   * tools (e.g. the Enfusion Blender plugin) that share the same NET API.
   */
  private recoverMissingHandlers(): Promise<void> {
    if (!this.config) {
      return Promise.reject(
        new WorkbenchError("No config provided — cannot recover handlers.", "LAUNCH_FAILED"),
      );
    }
    // Single-flight, same shape as ensureRunning(): concurrent callers that
    // all hit "Undefined API func" share one install + one recompile wait
    // instead of racing rmSync/copyFileSync and running N×30 s ping loops.
    if (this.recoverPromise) {
      return this.recoverPromise;
    }
    const promise = this.doRecoverMissingHandlers().finally(() => {
      if (this.recoverPromise === promise) {
        this.recoverPromise = null;
      }
    });
    this.recoverPromise = promise;
    return promise;
  }

  private async doRecoverMissingHandlers(): Promise<void> {
    // Inject into the currently-open mod (same logic as launchWorkbench).
    const recoveryGproj = this.findFallbackGproj();
    if (recoveryGproj) {
      this.installHandlerScripts(dirname(recoveryGproj), true);
      this.cleanupStandaloneAddon();
    } else {
      this.installHandlerScripts(undefined, true);
    }

    // Wait for Workbench to detect the new files and recompile scripts.
    // Workbench watches its script directories and recompiles automatically.
    // Poll with our custom EMCP_WB_Ping handler — it only succeeds once
    // the handler scripts are compiled and registered.
    logger.info("Handler scripts installed. Waiting for Workbench to recompile...");
    const deadline = Date.now() + HANDLER_RECOMPILE_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, HANDLER_RECOMPILE_POLL_MS));
      if (await this.ping()) {
        logger.info("Handler scripts compiled and loaded.");
        return;
      }
    }

    throw new WorkbenchError(
      "Handler scripts were installed but Workbench did not recompile them within " +
        `${HANDLER_RECOMPILE_TIMEOUT_MS / 1000}s. Try recompiling scripts manually in ` +
        "Workbench (Plugins > Reload Scripts) or restart Workbench.",
      "LAUNCH_FAILED",
    );
  }

  private async launchWorkbench(gprojPath?: string): Promise<void> {
    // 1. Check if already running (maybe it came up between the failed call and now)
    if (await this.ping()) {
      logger.info("Workbench is already running.");
      return;
    }

    // 2. Resolve the target .gproj and inject handler scripts into that mod.
    //    Handler scripts must compile as part of the opened project — Workbench
    //    only compiles the active project and its declared dependencies, NOT every
    //    addon folder in the project directory.  A standalone sibling addon will
    //    never be compiled unless the user's project explicitly depends on it.
    let resolvedGproj = gprojPath || this.findFallbackGproj();
    if (resolvedGproj) {
      this.installHandlerScripts(dirname(resolvedGproj));
      // Remove any leftover standalone addon to prevent duplicate class errors.
      // If a previous session created {projectPath}/EnfusionMCP/ it would be
      // picked up as a sibling addon and cause compile-time class name conflicts.
      this.cleanupStandaloneAddon();
    } else {
      // No project found — fall back to standalone addon as last resort and open it
      // directly so its handlers at least compile (user's project won't be open).
      this.installHandlerScripts();
      const fallbackBase = this.config?.projectPath;
      if (fallbackBase) {
        const standaloneGproj = join(fallbackBase, HANDLER_FOLDER, `${HANDLER_FOLDER}.gproj`);
        if (existsSync(standaloneGproj)) {
          resolvedGproj = standaloneGproj;
        }
      }
    }
    // Record what this launch is actually opening so a concurrent
    // ensureRunning(<other gproj>) can refuse instead of joining.
    if (resolvedGproj) {
      this.launchTarget = normalizeGprojKey(resolvedGproj);
      this.launchTargetDisplay = resolvedGproj;
    }

    // 3. Find executable
    const exePath = this.findWorkbenchExe();
    if (!exePath) {
      const wbPath = this.config?.workbenchPath ?? "(not configured)";
      throw new WorkbenchError(
        `Cannot find ${WORKBENCH_EXE}. Install Arma Reforger Tools from Steam, ` +
          "or set ENFUSION_WORKBENCH_PATH. Searched:\n" +
          `  - ${join(wbPath, WORKBENCH_SUBDIR, WORKBENCH_EXE)}\n` +
          `  - ${join(wbPath, WORKBENCH_EXE)}`,
        "LAUNCH_FAILED",
      );
    }

    // 4. Spawn with -gproj to skip the launcher
    const args: string[] = [];
    if (resolvedGproj) {
      args.push("-gproj", resolvedGproj);
    }

    // Use the game install directory as CWD so Workbench finds base game addons
    // (data/ArmaReforger.gproj with GUID 58D0FB3206B6F859) via ./addons resolution.
    const cwd = this.findGameDir() || dirname(exePath);

    // Warn-only dependency pre-flight (see tools/wb-validate-scripts.ts
    // for the rationale) + launcher watchdog: the launcher can hold at
    // its Projects picker instead of auto-opening the -gproj project
    // (field-diagnosed 2026-08-31) — without the watchdog that reads as
    // "NET API never responded" after the full launch timeout.
    this.lastLaunchNotes = [];
    let depCheck: WbDepsCheck | null = null;
    let depCheckError: string | undefined;
    if (resolvedGproj && this.config) {
      try {
        depCheck = checkWorkbenchVisibleDeps(resolvedGproj, this.config);
      } catch (e) {
        depCheckError = e instanceof Error ? e.message : String(e);
      }
    }
    const logsRoot = this.config?.logsPath;
    const tracker = logsRoot
      ? new WorkbenchLaunchTracker(logsRoot, snapshotSessionDirs(logsRoot))
      : null;
    if (tracker) {
      tracker.watchdog = new LaunchWatchdog({
        readConsoleLog: tracker.readConsoleLog,
        nudge: nudgeEnfusionLauncher,
        inspectWindows: inspectProcessWindows,
      });
    }

    logger.info(
      `Launching Workbench: ${exePath}${args.length ? ` ${args.join(" ")}` : ""} (cwd: ${cwd})`,
    );
    const launchStartedAt = Date.now();
    const proc = spawn(exePath, args, {
      detached: true,
      stdio: "ignore",
      cwd,
    });
    proc.unref();

    // 5. Wait for NET API — track the last error type so the timeout message is actionable
    // The deadline is enforced after EVERY sub-step (ping, watchdog tick,
    // sleep) and each step is capped to the time remaining, so a 90 s
    // timeout means ≈90 s rather than 90 s + one full ping + one full sleep.
    const deadline = Date.now() + LAUNCH_TIMEOUT_MS;
    const remaining = () => deadline - Date.now();
    let lastErrorCode: WorkbenchError["code"] | undefined;
    while (remaining() > 0) {
      try {
        await this.rawCall(
          "EMCP_WB_Ping",
          {},
          { timeout: Math.max(1, Math.min(3000, remaining())), skipAutoLaunch: true },
        );
        this._state.connected = true;
        this._state.lastUpdated = Date.now();
        logger.info("Workbench NET API is responding.");
        if (tracker?.watchdog?.nudgeOutcome?.enterPosted) {
          this.lastLaunchNotes.push(
            "Launcher project picker was auto-confirmed (launcher window restored, Enter posted on the preselected Open).",
          );
        }
        const preflightNote = buildPreflightNote(depCheck);
        if (preflightNote) this.lastLaunchNotes.push(preflightNote);
        return;
      } catch (err) {
        if (err instanceof WorkbenchError) {
          lastErrorCode = err.code;
          logger.debug(`Workbench poll (${err.code}): ${err.message}`);
        }
      }
      if (remaining() <= 0) break;
      if (tracker) {
        const stuck = await tracker.check({ pid: proc.pid });
        if (stuck === "stuck:launcher-picker" || stuck === "stuck:missing-deps") {
          try {
            if (proc.pid) process.kill(proc.pid, "SIGKILL");
          } catch (e) {
            logger.debug(`Failed to kill stuck Workbench: ${e}`);
          }
          throw new WorkbenchError(
            buildStuckReport(stuck, {
              toolLabel: "wb_launch",
              gprojPath: resolvedGproj ?? "(no project)",
              durationMs: Date.now() - launchStartedAt,
              sessionDir: tracker.sessionDir,
              logsRoot: logsRoot!,
              watchdog: tracker.watchdog!,
              consoleTail: tailLines(tracker.readConsoleLog(), 15),
              depCheck,
              depCheckError,
            }),
            "LAUNCH_FAILED",
          );
        }
      }
      const sleepMs = Math.min(LAUNCH_POLL_INTERVAL_MS, remaining());
      if (sleepMs <= 0) break;
      await new Promise((r) => setTimeout(r, sleepMs));
    }

    // Build a specific diagnostic based on what was failing at timeout.
    // The observed NET API error decides the primary hint:
    //   CONNECTION_REFUSED = NET API port never opened → NET API likely disabled.
    //   API_ERROR = NET API is up but EMCP_WB_Ping isn't registered → handler
    //               scripts didn't compile (script errors / wrong mod directory).
    // The launch-log heuristic (`CLI Params` never echoed → launcher never
    // accepted the project) is only appended when the tracker actually found
    // a log session for this run; with no session discovered the watchdog's
    // cliParamsSeen=false is merely "no evidence", not "engine rejected it".
    let hint: string;
    if (lastErrorCode === "API_ERROR") {
      hint =
        "Workbench NET API responded but handler scripts did not load. " +
        "Check for script compilation errors in Workbench (Script Editor). " +
        "Fix any errors in the project's scripts so the EnfusionMCP handlers can compile, " +
        "then try again.";
    } else {
      hint =
        "NET API port never responded. Ensure NET API is enabled in Workbench: " +
        "File > Options > General > Net API (checkbox must be on).";
    }
    if (tracker && tracker.sessionDir && tracker.watchdog && !tracker.watchdog.cliParamsSeen) {
      hint +=
        "\n\n" +
        buildTimeoutDiagnostics({
          watchdog: tracker.watchdog,
          consoleTail: tailLines(tracker.readConsoleLog(), 15),
          depCheck,
          depCheckError,
        }).join("\n");
    }

    throw new WorkbenchError(
      `Workbench launched but did not connect within ${LAUNCH_TIMEOUT_MS / 1000}s.\n\n${hint}`,
      "LAUNCH_FAILED",
    );
  }

  private findWorkbenchExe(): string | null {
    if (!this.config) return null;
    const subPath = join(this.config.workbenchPath, WORKBENCH_SUBDIR, WORKBENCH_EXE);
    if (existsSync(subPath)) return subPath;

    const rootPath = join(this.config.workbenchPath, WORKBENCH_EXE);
    if (existsSync(rootPath)) return rootPath;

    return null;
  }

  /**
   * Find a .gproj to pass via -gproj so Workbench skips the launcher.
   * Prefers config.defaultMod if set; otherwise picks first addon found.
   * Scans for any .gproj in each addon folder (name need not match folder).
   */
  private findFallbackGproj(): string | null {
    const findGprojInDir = (dir: string): string | null => {
      try {
        for (const f of readdirSync(dir, { withFileTypes: true })) {
          if (!f.isDirectory() && f.name.endsWith(".gproj")) {
            return join(dir, f.name);
          }
        }
      } catch {
        /* ignore */
      }
      return null;
    };

    try {
      const addonsDir = this.config?.projectPath;
      if (!addonsDir || !existsSync(addonsDir)) return null;

      // Prefer the configured default mod over alphabetical first-pick
      const preferred = this.config?.defaultMod;
      if (preferred) {
        const gprojPath = findGprojInDir(join(addonsDir, preferred));
        if (gprojPath) {
          logger.info(`Using defaultMod gproj to skip launcher: ${gprojPath}`);
          return gprojPath;
        }
      }

      for (const entry of readdirSync(addonsDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const gprojPath = findGprojInDir(join(addonsDir, entry.name));
        if (gprojPath) {
          logger.info(`Using fallback gproj to skip launcher: ${gprojPath}`);
          return gprojPath;
        }
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  /**
   * Derive the Arma Reforger game install directory.
   * Checks ENFUSION_GAME_PATH env var first, then walks up from workbenchPath.
   * workbenchPath may point to the Tools root OR the Workbench subdirectory,
   * so we try both one and two levels up.
   */
  private findGameDir(): string | null {
    // Explicit env var takes priority
    const envGamePath = process.env.ENFUSION_GAME_PATH;
    if (envGamePath && existsSync(join(envGamePath, "addons"))) {
      logger.info(`Using game directory from ENFUSION_GAME_PATH: ${envGamePath}`);
      return envGamePath;
    }

    if (!this.config) return null;

    // Resolved config value next — covers ~/.enfusion-mcp/config.json users
    // and any case where loadConfig derived a valid path the raw env lacks.
    if (this.config.gamePath && existsSync(join(this.config.gamePath, "addons"))) {
      logger.info(`Using game directory from config.gamePath: ${this.config.gamePath}`);
      return this.config.gamePath;
    }

    const toolsDir = this.config.workbenchPath;
    // workbenchPath may be "Arma Reforger Tools" or "Arma Reforger Tools\Workbench"
    const candidates = [
      resolve(toolsDir, "..", "Arma Reforger"),
      resolve(toolsDir, "..", "ArmaReforger"),
      resolve(toolsDir, "..", "..", "Arma Reforger"),
      resolve(toolsDir, "..", "..", "ArmaReforger"),
    ];
    for (const candidate of candidates) {
      if (existsSync(join(candidate, "addons"))) {
        logger.info(`Using game directory as CWD: ${candidate}`);
        return candidate;
      }
    }

    // Cross-drive discovery: the game is often in a DIFFERENT Steam library
    // than the Tools (e.g. Tools on C:\, game on D:\SteamLibrary). Parse
    // Steam's libraryfolders.vdf for every library root and probe each for
    // the game. Without this, Workbench launches with a CWD whose ./addons
    // lacks the base-game data addon (GUID 58D0FB3206B6F859) and blocks on
    // a "Missing Addon" modal — the NET API never comes up.
    const fromSteam = findGameAcrossSteamLibraries("Arma Reforger", [
      steamRootOf(toolsDir),
    ]);
    if (fromSteam) {
      logger.info(`Using game directory from Steam library scan: ${fromSteam}`);
      return fromSteam;
    }

    logger.warn(
      "Could not find Arma Reforger game directory. Workbench may fail to resolve base game addon.",
    );
    return null;
  }

  /**
   * Copy handler scripts into a mod directory so they compile as part of that mod.
   * If no modDir given, installs to default project path (standalone, less useful).
   */
  private installHandlerScripts(modDir?: string, force = false): void {
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
    const bundledDir = join(packageRoot, "mod", "Scripts", "WorkbenchGame", HANDLER_FOLDER);
    if (!existsSync(bundledDir)) {
      logger.warn("Bundled handler scripts not found in package.");
      return;
    }

    const fallbackBase = this.config?.projectPath;
    if (!modDir && !fallbackBase) {
      logger.warn("No modDir or projectPath configured — cannot install handler scripts.");
      return;
    }
    const isFallback = !modDir;
    const targetBase = modDir || join(fallbackBase!, HANDLER_FOLDER);
    const targetScriptsDir = join(targetBase, "Scripts", "WorkbenchGame", HANDLER_FOLDER);

    // Already installed AND identical to the bundled set? Skip unless
    // force-reinstalling. Compared by content digest (not just Ping.c
    // presence) so a package upgrade that changes any handler re-copies.
    if (!force && handlerSetDigest(targetScriptsDir) === handlerSetDigest(bundledDir)) {
      return;
    }

    logger.info(`Installing handler scripts to ${targetScriptsDir}`);
    mkdirSync(targetScriptsDir, { recursive: true });

    const files = readdirSync(bundledDir).filter((f) => f.endsWith(".c"));
    try {
      for (const file of files) {
        copyFileSync(join(bundledDir, file), join(targetScriptsDir, file));
      }
    } catch (e) {
      // Partial installation — clean up to avoid broken state on next attempt
      logger.error(`Failed to install handler scripts, rolling back: ${e}`);
      try {
        rmSync(targetScriptsDir, { recursive: true, force: true });
      } catch {
        /* best-effort cleanup */
      }
      throw e;
    }

    logger.info(`Installed ${files.length} handler scripts.`);

    // When using the standalone fallback path, also write a .gproj so Workbench
    // treats the directory as a loadable addon and compiles the handler scripts.
    if (isFallback) {
      const gprojPath = join(targetBase, `${HANDLER_FOLDER}.gproj`);
      if (!existsSync(gprojPath)) {
        const gprojContent = generateGproj({ name: HANDLER_FOLDER, title: "EnfusionMCP Handlers" });
        writeFileSync(gprojPath, gprojContent, "utf-8");
        logger.info(`Created standalone addon .gproj at ${gprojPath}`);
      }
    }
  }

  /**
   * Raw TCP call — no auto-launch, no retry.
   */
  private rawCall<T = Record<string, unknown>>(
    apiFunc: string,
    params: Record<string, unknown> = {},
    options: WorkbenchCallOptions = {},
  ): Promise<T> {
    const timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
    const requestBuf = encodeRequest(this.clientId, apiFunc, params);

    return new Promise<T>((resolve, reject) => {
      const chunks: Buffer[] = [];
      let totalBytes = 0;
      let settled = false;

      const socket = new Socket();

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          cleanup();
          socket.destroy();
          reject(
            new WorkbenchError(
              `Workbench call "${apiFunc}" timed out after ${timeout}ms`,
              "TIMEOUT",
            ),
          );
        }
      }, timeout);

      // Once settled we stop caring about the socket, but the socket may
      // still emit (a late ECONNRESET after 'end', for instance). An 'error'
      // event with no listener is thrown by EventEmitter and would take the
      // whole MCP process down — so a no-op 'error' listener stays attached
      // for the socket's lifetime, and the socket is torn down explicitly.
      const cleanup = () => {
        clearTimeout(timer);
        socket.removeAllListeners();
        socket.on("error", () => {
          /* settled — swallow late socket errors */
        });
      };

      socket.on("error", (err) => {
        if (settled) return;
        settled = true;
        cleanup();
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ECONNREFUSED") {
          reject(
            new WorkbenchError(
              `Cannot connect to Workbench at ${this.host}:${this.port}.`,
              "CONNECTION_REFUSED",
            ),
          );
        } else {
          reject(new WorkbenchError(`Connection error: ${err.message}`, "PROTOCOL_ERROR"));
        }
      });

      socket.on("data", (chunk) => {
        totalBytes += chunk.length;
        if (totalBytes > MAX_RESPONSE_SIZE) {
          if (!settled) {
            settled = true;
            cleanup();
            socket.destroy();
            reject(
              new WorkbenchError(
                `Response for "${apiFunc}" exceeded ${MAX_RESPONSE_SIZE} bytes — possible malformed data`,
                "PROTOCOL_ERROR",
              ),
            );
          }
          return;
        }
        chunks.push(chunk);
      });

      socket.on("end", () => {
        if (settled) return;
        settled = true;
        cleanup();
        // We already half-closed our side in connect(); the peer's FIN means
        // the exchange is over. Destroy now rather than leaving the socket to
        // linger until 'close' with nobody watching it.
        socket.destroy();

        const responseBuf = Buffer.concat(chunks);
        if (responseBuf.length === 0) {
          reject(
            new WorkbenchError(
              `Empty response from Workbench for "${apiFunc}" — connection closed without data`,
              "PROTOCOL_ERROR",
            ),
          );
          return;
        }

        try {
          const result = decodeResponse<T>(responseBuf);
          logger.debug(`Workbench response for "${apiFunc}":`, result);
          resolve(result);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          const isApiError = errMsg.startsWith("Workbench error:");
          reject(
            new WorkbenchError(
              isApiError ? errMsg : `Failed to decode response for "${apiFunc}": ${errMsg}`,
              isApiError ? "API_ERROR" : "PROTOCOL_ERROR",
            ),
          );
        }
      });

      socket.on("close", (hadError) => {
        if (settled) return;
        // close fired without end — connection dropped unexpectedly
        settled = true;
        cleanup();

        if (hadError) {
          reject(
            new WorkbenchError(
              `Connection to Workbench closed with error for "${apiFunc}"`,
              "PROTOCOL_ERROR",
            ),
          );
          return;
        }

        // No end event + no error = unusual. Try to decode what we have.
        const responseBuf = Buffer.concat(chunks);
        if (responseBuf.length === 0) {
          reject(
            new WorkbenchError(
              `Connection closed without response for "${apiFunc}"`,
              "PROTOCOL_ERROR",
            ),
          );
          return;
        }

        try {
          const result = decodeResponse<T>(responseBuf);
          resolve(result);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          const isApiError = errMsg.startsWith("Workbench error:");
          reject(
            new WorkbenchError(
              isApiError ? errMsg : `Failed to decode response for "${apiFunc}": ${errMsg}`,
              isApiError ? "API_ERROR" : "PROTOCOL_ERROR",
            ),
          );
        }
      });

      socket.connect(this.port, this.host, () => {
        logger.debug(`Connected to Workbench at ${this.host}:${this.port}, calling "${apiFunc}"`);
        socket.end(requestBuf);
      });
    });
  }
}
