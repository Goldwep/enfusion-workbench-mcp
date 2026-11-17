/**
 * `wb_scripts` — the script compile train through Workbench's native NET
 * functions (design section 2, plan 3.1; DEC-048 package B).
 *
 *   status    IsWorkbenchRunning (ScriptsCompiled) plus Ping's buildStamp match
 *   validate  ValidateScripts { Configuration: WORKBENCH | PC } (DEC-040 U3)
 *   reload    ReloadScripts, then a re-ping (DEC-040 U4; DEC-044: a failed
 *             reload keeps the loaded handlers)
 *
 * Everything goes through `src/workbench/native.ts` and the client's queue.
 * `status` and `validate` are read-only calls; `reload` is mutating (a reset
 * is LOST and never retried) and is refused while another call is pending.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { WorkbenchError, type BuildStampCheck, type WorkbenchClient } from "../workbench/client.js";
import {
  isWorkbenchRunning,
  isWorldEditorRunning,
  reloadScripts,
  validateScripts,
} from "../workbench/native.js";
import {
  ERROR_CODES,
  type ActionError,
  type ActionOk,
  type Change,
  type ErrorCode,
} from "../manifest/vocabulary.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export const SCRIPTS_ACTIONS = ["status", "validate", "reload"] as const;
export type ScriptsAction = (typeof SCRIPTS_ACTIONS)[number];

/** `ValidateScripts` configurations that answered (DEC-040 U3). */
export const CONFIGURATIONS = ["WORKBENCH", "PC"] as const;
export type ScriptsConfiguration = (typeof CONFIGURATIONS)[number];

/**
 * Codes this tool adds to the shared table (proposed for vocabulary.ts):
 * WEDGED and UNREACHABLE for client failures, BUSY for a refused reload,
 * VALIDATION_FAILED and RELOAD_FAILED for a native that answered no.
 */
export type ScriptsErrorCode =
  | ErrorCode
  | "WEDGED"
  | "UNREACHABLE"
  | "BUSY"
  | "VALIDATION_FAILED"
  | "RELOAD_FAILED";

export type ScriptsError = Omit<ActionError, "code"> & {
  code: ScriptsErrorCode;
  readback?: unknown;
};
export type ScriptsResponse = ActionOk | ScriptsError;

/** The client surface this tool needs (a fake in tests). */
export type ScriptsClient = Pick<WorkbenchClient, "call" | "probe" | "ping" | "queue"> & {
  readonly lastBuildCheck: BuildStampCheck | null;
};

const TARGET = "workbench:scripts";

function fail(
  action: string,
  code: ScriptsErrorCode,
  message: string,
  next?: string,
): ScriptsError {
  const dflt = ERROR_CODES[code as ErrorCode];
  return { ok: false, action, target: TARGET, code, message, next: next ?? dflt, warnings: [] };
}

/** Maps a client failure to a response code (MODAL_OPEN, LOST and WEDGED keep their names). */
export function codeOfClientError(e: unknown): { code: ScriptsErrorCode; message: string } {
  const message = e instanceof Error ? e.message : String(e);
  if (e instanceof WorkbenchError) {
    if (e.code === "MODAL_OPEN") return { code: "MODAL_OPEN", message };
    if (e.code === "LOST") return { code: "LOST", message };
    if (e.code === "WEDGED") return { code: "WEDGED", message };
  }
  return { code: "UNREACHABLE", message };
}

// ── Readiness (shared with wb_connect and wb_diagnose) ───────────────────────

export interface NativeReadiness {
  /** IsWorkbenchRunning answered; false on a refused connection; null when the probe failed otherwise. */
  running: boolean | null;
  /** `IsWorkbenchRunning.ScriptsCompiled`; null when absent or not asked. */
  scriptsCompiled: boolean | null;
  /** EMCP_WB_Ping answered (the shipped handlers are loaded). */
  handlersAnswer: boolean;
  /** Ping's buildStamp against this server's bundle digest; null when Ping did not answer. */
  buildStamp: BuildStampCheck | null;
  /** The failure that kept the probe from answering, when it was not a plain refusal. */
  error?: { code: ScriptsErrorCode; message: string };
}

/**
 * Probe, then ping: lease-free, never launches Workbench. A refused
 * connection is `running: false`; any other client failure is reported in
 * `error` with `running: null`.
 */
export async function readNativeReadiness(client: ScriptsClient): Promise<NativeReadiness> {
  let scriptsCompiled: boolean | null = null;
  try {
    const r = await isWorkbenchRunning(client);
    scriptsCompiled = r.scriptsCompiled;
  } catch (e) {
    if (e instanceof WorkbenchError && e.code === "CONNECTION_REFUSED") {
      return { running: false, scriptsCompiled: null, handlersAnswer: false, buildStamp: null };
    }
    return {
      running: null,
      scriptsCompiled: null,
      handlersAnswer: false,
      buildStamp: null,
      error: codeOfClientError(e),
    };
  }
  const handlersAnswer = await client.ping();
  return {
    running: true,
    scriptsCompiled,
    handlersAnswer,
    buildStamp: handlersAnswer ? client.lastBuildCheck : null,
  };
}

/** Calls that never mutate; any other call in flight counts as mutating (unclassified is mutating). */
const READ_ONLY_LABELS: ReadonlySet<string> = new Set([
  "IsWorkbenchRunning",
  "IsWorldEditorRunning",
  "ValidateScripts",
  "EMCP_WB_Ping",
  "EMCP_WB_GetState",
]);

/**
 * The label of the call in flight when it can mutate, else null. The queue
 * keeps only labels (the API function), so a call is read-only when its name
 * is on the list above. Waiting jobs are not inspectable, so any queue depth above zero counts as pending.
 */
export function pendingMutatingCall(client: Pick<WorkbenchClient, "queue">): string | null {
  const f = client.queue.inFlight();
  if (f && !READ_ONLY_LABELS.has(f.label)) return f.label;
  // Waiting jobs carry no inspectable label: anything waiting may be mutating (B-4).
  if (client.queue.depth > 0) return `${client.queue.depth} waiting call(s)`;
  return null;
}

export function stampSummary(b: BuildStampCheck | null) {
  return b ? { status: b.status, stamp: b.stamp, bundle: b.bundle } : null;
}

// ── Actions ───────────────────────────────────────────────────────────────────

export interface ScriptsArgs {
  action: ScriptsAction;
  configuration?: ScriptsConfiguration;
  /** Reload scope: only "scripts" has a native (ReloadScripts). */
  scope?: string;
}

/**
 * `IsWorldEditorRunning`, asked only while Workbench runs. Status never fails
 * on it: a kernel without the function (API error) or any other failure leaves
 * `running` null and says why in `note`.
 */
async function readWorldEditor(
  client: ScriptsClient,
): Promise<{ running: boolean | null; note?: string }> {
  try {
    const w = await isWorldEditorRunning(client);
    if (w.running === null) {
      return { running: null, note: "IsWorldEditorRunning answered without an IsRunning field" };
    }
    return { running: w.running };
  } catch (e) {
    const unavailable = e instanceof WorkbenchError && e.code === "API_ERROR";
    const message = e instanceof Error ? e.message : String(e);
    return {
      running: null,
      note: unavailable
        ? `IsWorldEditorRunning is unavailable on this kernel (${message}): worldEditorRunning is unknown`
        : `IsWorldEditorRunning failed (${message}): worldEditorRunning is unknown`,
    };
  }
}

async function doStatus(client: ScriptsClient): Promise<ScriptsResponse> {
  const r = await readNativeReadiness(client);
  if (r.error) return fail("status", r.error.code, r.error.message);
  const warnings: string[] = [];
  if (r.running && !r.handlersAnswer) {
    warnings.push(
      "Workbench runs but EMCP_WB_Ping did not answer: the shipped handlers are not loaded",
    );
  }
  if (r.running && r.scriptsCompiled === false) {
    warnings.push("ScriptsCompiled is false: a compile is running or failed");
  }
  if (r.buildStamp?.warning) warnings.push(r.buildStamp.warning);
  const we = r.running ? await readWorldEditor(client) : null;
  if (we?.note) warnings.push(we.note);
  const ok: ActionOk = {
    ok: true,
    action: "status",
    target: TARGET,
    changed: null,
    readback: {
      running: r.running,
      scriptsCompiled: r.scriptsCompiled,
      worldEditorRunning: we?.running ?? null,
      handlersAnswer: r.handlersAnswer,
      buildStamp: stampSummary(r.buildStamp),
    },
    warnings,
  };
  if (!r.running) ok.next = "Workbench is not running: wb_launch.";
  return ok;
}

async function doValidate(
  client: ScriptsClient,
  configuration: ScriptsConfiguration,
): Promise<ScriptsResponse> {
  const ready = await readNativeReadiness(client);
  if (ready.error) return fail("validate", ready.error.code, ready.error.message);
  if (!ready.running) {
    return fail("validate", "UNREACHABLE", "Workbench is not running; nothing was sent");
  }
  try {
    const v = await validateScripts(client, configuration);
    const warnings = [
      "A passing validation is not a handler compile gate: a broken file in the WorkbenchGame module can still validate (DEC-035, U14)",
    ];
    const readback = {
      configuration,
      success: v.success,
      errors: v.errors,
      warnings: v.warnings,
    };
    if (v.success === false || (v.errors ?? 0) > 0) {
      const e = fail(
        "validate",
        "VALIDATION_FAILED",
        `ValidateScripts ${configuration} answered Success=${String(v.success)}, Errors=${String(v.errors)}`,
      );
      e.warnings = warnings;
      e.readback = readback;
      return e;
    }
    if (v.success === null) warnings.push("ValidateScripts carried no Success field");
    return { ok: true, action: "validate", target: TARGET, changed: null, readback, warnings };
  } catch (e) {
    const c = codeOfClientError(e);
    return fail("validate", c.code, c.message);
  }
}

async function doReload(client: ScriptsClient, scope: string): Promise<ScriptsResponse> {
  if (scope !== "scripts") {
    return fail(
      "reload",
      "INVALID_ARGUMENT",
      `scope '${scope}': only 'scripts' has a native (ReloadScripts); plugin reload has none`,
    );
  }
  const pending = pendingMutatingCall(client);
  if (pending) {
    return fail(
      "reload",
      "BUSY",
      `reload refused: a mutating call is pending (${pending}); nothing was sent`,
    );
  }
  const before = await readNativeReadiness(client);
  if (before.error) return fail("reload", before.error.code, before.error.message);
  if (!before.running) {
    return fail("reload", "UNREACHABLE", "Workbench is not running; nothing was sent");
  }
  const stampBefore = before.buildStamp?.stamp ?? null;

  let reloadError: { code: ScriptsErrorCode; message: string } | null = null;
  try {
    await reloadScripts(client);
  } catch (e) {
    reloadError =
      e instanceof WorkbenchError && e.code === "API_ERROR"
        ? { code: "RELOAD_FAILED", message: e.message }
        : codeOfClientError(e);
  }

  // Re-ping either way: a failed reload keeps the old handlers (DEC-044), a lost one proves nothing.
  const after = await readNativeReadiness(client);
  const readback = {
    scriptsCompiled: after.scriptsCompiled,
    handlersAnswer: after.handlersAnswer,
    buildStamp: stampSummary(after.buildStamp),
  };
  if (reloadError) {
    const e = fail("reload", reloadError.code, reloadError.message);
    e.readback = readback;
    if (reloadError.code === "RELOAD_FAILED") {
      e.warnings.push(
        after.handlersAnswer
          ? "the old handlers still answer Ping (a failed reload keeps them, DEC-044)"
          : "the old handlers do not answer Ping either",
      );
    } else if (reloadError.code === "LOST") {
      e.next = "The reload call was lost and is never retried; read the readback before any retry.";
    }
    return e;
  }
  if (!after.handlersAnswer) {
    const e = fail("reload", "UNREACHABLE", "ReloadScripts answered but EMCP_WB_Ping does not");
    e.readback = readback;
    return e;
  }
  const stampAfter = after.buildStamp?.stamp ?? null;
  const changed: Change[] | null =
    stampBefore !== stampAfter
      ? [{ path: "buildStamp", before: stampBefore, after: stampAfter }]
      : null;
  const warnings: string[] = [];
  if (after.scriptsCompiled === false) {
    warnings.push("ScriptsCompiled is false after the reload: the compile may still be running");
  }
  if (after.buildStamp?.warning) warnings.push(after.buildStamp.warning);
  return { ok: true, action: "reload", target: TARGET, changed, readback, warnings };
}

/** Runs one action; never throws. */
export async function runScripts(
  client: ScriptsClient,
  args: ScriptsArgs,
): Promise<ScriptsResponse> {
  try {
    switch (args.action) {
      case "status":
        return await doStatus(client);
      case "validate":
        return await doValidate(client, args.configuration ?? "WORKBENCH");
      case "reload":
        return await doReload(client, args.scope ?? "scripts");
    }
  } catch (e) {
    const c = codeOfClientError(e);
    return fail(args.action, c.code, c.message);
  }
}

export function toToolResult(r: ScriptsResponse) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(r, null, 2) }],
    ...(r.ok ? {} : { isError: true as const }),
  };
}

// ── Registration ──────────────────────────────────────────────────────────────

export const WB_SCRIPTS_DESCRIPTION =
  "Script compile train through Workbench's natives.\n" +
  "Read: status (running, ScriptsCompiled, worldEditorRunning, build stamp match); validate (ValidateScripts, configuration WORKBENCH|PC: errors, warnings, success).\n" +
  "Mutating: reload (ReloadScripts, then a re-ping; refused while a mutating call is pending; a failed reload keeps the old handlers).";

export function registerWbScripts(server: McpServer, client: WorkbenchClient): void {
  server.registerTool(
    "wb_scripts",
    {
      description: WB_SCRIPTS_DESCRIPTION,
      inputSchema: {
        action: z.enum(SCRIPTS_ACTIONS),
        configuration: z
          .enum(CONFIGURATIONS)
          .optional()
          .describe("validate: WORKBENCH (default) or PC"),
        scope: z.string().optional().describe("reload: only 'scripts'"),
      },
      annotations: {
        title: "Script compile train",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) => toToolResult(await runScripts(client, args as ScriptsArgs)),
  );
}
