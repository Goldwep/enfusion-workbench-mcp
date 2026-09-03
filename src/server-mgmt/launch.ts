/**
 * `server_launch` core — locate ArmaReforgerServer.exe and build a safe
 * spawn argv. The MCP wrapper (`src/tools/server-launch.ts`) is the only
 * place that actually calls `spawn`; this module is the validation +
 * argv-construction layer.
 *
 * Security posture (L8 — process-spawning tool):
 *   - `shell: false` always — no shell-string interpolation
 *   - All extra args validated against a tight regex BEFORE they touch argv
 *   - Path inputs rejected if they start with `-` (flag-smuggle guard)
 *   - Default `dry_run = true` — caller has to flip it explicitly to spawn
 *   - Redacted-config display only; raw server.json never reaches the LLM
 *   - PID file written on spawn + pre-launch guard prevents orphaned
 *     duplicate servers fighting for the same a2s/RCON ports
 *
 * The canonical exe lives at Steam app 1874900's install dir:
 *   C:\Program Files (x86)\Steam\steamapps\common\Arma Reforger Server\ArmaReforgerServer.exe
 *
 * If a user has a non-standard install, they can plumb it through a future
 * config knob — for v1 we hard-code the canonical path and surface a
 * structured error when missing.
 */

import {
  existsSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { rejectFlagLikePath } from "./redact-io.js";

/** Canonical install path for the Arma Reforger dedicated server. */
export const DEFAULT_SERVER_EXE_PATH =
  "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Arma Reforger Server\\ArmaReforgerServer.exe";

/**
 * Strict allow-pattern for extra CLI flags. Matches `-foo`, `-foo=bar`,
 * `-foo:bar`, `-foo,bar`, `-foo.bar`, `-foo/bar`, `-foo\\bar`, with letters,
 * digits, and underscores in the body. Deliberately tight — there is no
 * legitimate Reforger CLI flag with spaces, quotes, shell metacharacters,
 * `;`, `&&`, `|`, `$`, backticks, `>`, or `<`.
 */
const EXTRA_ARG_RE = /^-[a-zA-Z0-9_=:.,/\\-]+$/;

/** Hard cap on extra args — prevents argv explosion. */
const MAX_EXTRA_ARGS = 10;

/**
 * Per-arg validator. Throws on the first bad arg; returns silently on a
 * clean set.
 */
export function validateExtraArgs(extraArgs: readonly string[]): void {
  if (extraArgs.length > MAX_EXTRA_ARGS) {
    throw new Error(
      `Too many extra_args: ${extraArgs.length} (max ${MAX_EXTRA_ARGS})`,
    );
  }
  for (const arg of extraArgs) {
    if (typeof arg !== "string" || arg.length === 0) {
      throw new Error("extra_args entries must be non-empty strings");
    }
    if (!EXTRA_ARG_RE.test(arg)) {
      throw new Error(
        `Invalid extra_args entry: ${JSON.stringify(arg)} — must match ${EXTRA_ARG_RE} ` +
          "(starts with '-', no shell metacharacters)",
      );
    }
  }
}

/**
 * Loose scenario-id sanity check. We don't validate the GUID-hex format
 * here — the server will reject a malformed scenarioId at startup with a
 * better error than we can produce. We DO reject anything that starts with
 * '-' (flag-smuggle guard) and anything containing shell metacharacters
 * (because the scenario id is passed verbatim into argv).
 */
export function validateScenarioId(scenarioId: string): void {
  if (typeof scenarioId !== "string" || scenarioId.length === 0) {
    throw new Error("scenario_id must be a non-empty string");
  }
  if (scenarioId.startsWith("-")) {
    throw new Error(
      "scenario_id starts with '-' — looks like a CLI flag, refusing",
    );
  }
  // Forbid characters that shells / argv parsers treat specially. We don't
  // need to be exhaustive — just block the obvious injection paths. We
  // allow `{`, `}`, `/`, `\\`, `.`, `_`, `-` (in interior), letters, digits.
  if (/[\s"'`;&|$<>()*?\[\]]/.test(scenarioId)) {
    throw new Error(
      "scenario_id contains a forbidden character (whitespace or shell metacharacter): " +
        JSON.stringify(scenarioId),
    );
  }
}

/**
 * Result of probing for the server exe.
 */
export interface ServerExeProbe {
  /** Absolute path checked. */
  path: string;
  /** True when the file exists. */
  exists: boolean;
}

/**
 * Probe the canonical server install path. Pure (no side effects beyond
 * `existsSync`). Override the default path for testing.
 */
export function probeServerExe(
  exePath: string = DEFAULT_SERVER_EXE_PATH,
): ServerExeProbe {
  return { path: exePath, exists: existsSync(exePath) };
}

/**
 * Build the argv that would be passed to spawn(). Deliberately a pure
 * function so tests can assert the exact argv without invoking spawn.
 *
 * argv layout follows BI's documented CLI:
 *   ArmaReforgerServer.exe -config <path> -scenarioId <id> [extra...]
 *
 * The caller is responsible for having validated each input via
 * `validateExtraArgs`, `validateScenarioId`, and `rejectFlagLikePath`.
 */
export function buildLaunchArgv(input: {
  serverConfigPath: string;
  scenarioId: string;
  extraArgs: readonly string[];
}): string[] {
  return [
    "-config",
    input.serverConfigPath,
    "-scenarioId",
    input.scenarioId,
    ...input.extraArgs,
  ];
}

/**
 * Resolve & validate the inputs needed to launch. Throws on any violation.
 * Returns the absolute server-config path so callers don't have to re-
 * resolve.
 */
export function prepareLaunchInputs(input: {
  serverConfigPath: string;
  scenarioId: string;
  extraArgs?: readonly string[];
}): {
  absoluteConfigPath: string;
  scenarioId: string;
  extraArgs: readonly string[];
} {
  rejectFlagLikePath(input.serverConfigPath, "server_config_path");
  validateScenarioId(input.scenarioId);
  const extraArgs = input.extraArgs ?? [];
  validateExtraArgs(extraArgs);
  const absoluteConfigPath = resolve(input.serverConfigPath);
  return { absoluteConfigPath, scenarioId: input.scenarioId, extraArgs };
}

// ---------------------------------------------------------------------------
// PID-file management
// ---------------------------------------------------------------------------

/** Stable filename for the PID file, alongside the server.json. */
export const PID_FILE_NAME = ".arma-reforger-server.pid";

/**
 * Shape persisted to disk. Stable JSON — write+read round-trip is a normal
 * `JSON.stringify` / `JSON.parse` (no Date objects, no Buffer).
 */
export interface PidFileContents {
  /** OS pid of the spawned ArmaReforgerServer.exe. */
  pid: number;
  /** ISO-8601 timestamp the PID file was written. */
  started_at: string;
  /** Absolute path to the server.json the process was started with. */
  server_config_path: string;
  /** ScenarioId that was passed on the command line. */
  scenario_id: string;
  /** Argv (without the exe path) used for the spawn. */
  argv: string[];
}

/**
 * Derive the PID-file path from a server-config path. The PID file lives
 * next to the server.json (same directory) so multiple side-by-side server
 * profiles in different directories don't clobber each other.
 */
export function pidFilePathFor(serverConfigPath: string): string {
  return join(dirname(serverConfigPath), PID_FILE_NAME);
}

/**
 * Atomic write: write to `<path>.tmp` then rename over the target. Prevents
 * a half-written PID file if the process is killed mid-write.
 */
export function writePidFile(
  pidFilePath: string,
  contents: PidFileContents,
): void {
  const tmp = `${pidFilePath}.tmp`;
  writeFileSync(tmp, JSON.stringify(contents, null, 2), {
    encoding: "utf-8",
  });
  renameSync(tmp, pidFilePath);
}

/**
 * Read + parse the PID file. Returns `null` when the file is missing.
 * Throws on a parse failure (so the caller can decide whether to surface or
 * clean up).
 */
export function readPidFile(pidFilePath: string): PidFileContents | null {
  if (!existsSync(pidFilePath)) return null;
  const text = readFileSync(pidFilePath, "utf-8");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new Error(`Failed to parse PID file ${pidFilePath}: ${detail}`);
  }
  if (
    !raw ||
    typeof raw !== "object" ||
    typeof (raw as PidFileContents).pid !== "number"
  ) {
    throw new Error(
      `PID file ${pidFilePath} has unexpected shape (expected { pid, started_at, ... })`,
    );
  }
  return raw as PidFileContents;
}

/**
 * Best-effort delete of the PID file. Swallows "already missing" errors;
 * surfaces anything else.
 */
export function deletePidFile(pidFilePath: string): void {
  try {
    unlinkSync(pidFilePath);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return;
    throw e;
  }
}

/**
 * Liveness probe using the standard `process.kill(pid, 0)` trick:
 *   - Returns true when the process exists and the caller has permission.
 *   - Returns false when ESRCH (no such process).
 *   - On EPERM (process exists but caller can't signal it), returns true —
 *     we don't own the PID but it IS alive.
 *
 * Works on both POSIX and Windows.
 */
export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return false;
    if (code === "EPERM") return true;
    // Any other error: be conservative and treat as not alive so the
    // caller can recover. (E.g. on Windows, calling process.kill on a PID
    // belonging to another session can yield other errors — we'd rather
    // let the caller try to launch than wedge them.)
    return false;
  }
}

// ---------------------------------------------------------------------------
// Process identity (M20) — a PID alone is not an identity. PIDs are recycled,
// so a stale PID file can point at an unrelated process (an editor, a
// browser tab…) that `process.kill(pid, 0)` happily reports as alive. Before
// treating a PID as "our server" — and certainly before `taskkill /F /T` —
// verify the image name is ArmaReforgerServer.exe.
// ---------------------------------------------------------------------------

/** Image name the dedicated server runs under. */
export const SERVER_IMAGE_NAME = "ArmaReforgerServer.exe";

/**
 * Parse `tasklist /FO CSV /NH` output and return the image name of the first
 * row, or null when tasklist reported no match ("INFO: No tasks are running
 * which match…") or produced nothing parseable.
 *
 * Row shape: `"ArmaReforgerServer.exe","1234","Console","1","123,456 K"`.
 */
export function parseTasklistImage(output: string): string | null {
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith('"')) continue;
    const firstField = line.split('","')[0];
    const image = firstField.replace(/^"/, "").replace(/"$/, "").trim();
    if (image.length > 0) return image;
  }
  return null;
}

/**
 * Image name of the process with `pid`, or null when it cannot be
 * determined. win32 only (tasklist); other platforms return null so callers
 * fall back to PID-only liveness. argv array, no shell — the PID is
 * validated as a positive integer before it is stringified.
 */
export function processImageName(pid: number): string | null {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  if (process.platform !== "win32") return null;
  try {
    const out = execFileSync(
      "tasklist",
      ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"],
      { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], shell: false, windowsHide: true },
    );
    return parseTasklistImage(out);
  } catch {
    return null;
  }
}

/**
 * True when `pid` is alive AND (on win32) its image is the dedicated server.
 * On win32 an unknown image (tasklist unavailable/failed) counts as NOT ours —
 * the safe direction, since a wrong answer here leads to killing a foreign
 * process. Off win32 we have no cheap image lookup and fall back to liveness.
 */
export function isServerProcessAlive(
  pid: number,
  deps: {
    isAlive?: (pid: number) => boolean;
    imageName?: (pid: number) => string | null;
  } = {},
): boolean {
  if (!(deps.isAlive ?? isProcessAlive)(pid)) return false;
  if (process.platform !== "win32" && !deps.imageName) return true;
  const image = (deps.imageName ?? processImageName)(pid);
  return image !== null && image.toLowerCase() === SERVER_IMAGE_NAME.toLowerCase();
}

/**
 * Pre-launch guard result. `state` drives the caller's branch:
 *   - "none"   → no PID file; safe to launch.
 *   - "stale"  → PID file present but the process is dead OR the PID now
 *                belongs to a different image (recycled PID); caller should
 *                clean up and proceed.
 *   - "alive"  → PID file present AND our server still running; caller must
 *                refuse (unless `force=true`).
 */
export type RunningServerCheck =
  | { state: "none" }
  | { state: "stale"; contents: PidFileContents; reason?: "dead" | "foreign" }
  | { state: "alive"; contents: PidFileContents };

/**
 * Inspect the PID file at `pidFilePath` and report whether a server is
 * already running.
 *
 * The liveness probe and image lookup are injectable so tests can drive the
 * "alive", "stale (dead)" and "stale (foreign PID)" branches without a real
 * OS process. When `isAlive` is supplied without `imageName`, identity is
 * NOT checked (preserves the historical PID-only seam for existing tests).
 */
export function checkRunningServer(opts: {
  pidFilePath: string;
  isAlive?: (pid: number) => boolean;
  imageName?: (pid: number) => string | null;
}): RunningServerCheck {
  const contents = readPidFile(opts.pidFilePath);
  if (contents === null) return { state: "none" };
  const alive = (opts.isAlive ?? isProcessAlive)(contents.pid);
  if (!alive) return { state: "stale", contents, reason: "dead" };
  const checkIdentity = opts.imageName !== undefined || opts.isAlive === undefined;
  if (checkIdentity && !isServerProcessAlive(contents.pid, { isAlive: () => true, imageName: opts.imageName })) {
    return { state: "stale", contents, reason: "foreign" };
  }
  return { state: "alive", contents };
}
