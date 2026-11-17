/**
 * Typed wrappers for Workbench's native NET functions (DEC-048 package A).
 *
 * Natives answer differently from our handlers: `BringModuleWindowToFront`
 * answers `{}` for every module name, the unknown one included (DEC-040
 * sc-08), and a native may answer a bare "Ok" status. Every wrapper therefore
 * calls with `allowEmptyPayload` and reads fields defensively.
 *
 * Names and payloads are the ones the live scripts sent
 * (`scripts/live/s-c-natives.ts`): `IsWorkbenchRunning {}`, `IsWorldEditorRunning {}`,
 * `ValidateScripts { Configuration }`, `ReloadScripts {}`,
 * `OpenResource { ResourceName }`, `BringModuleWindowToFront { ModuleName }`.
 * `GetState` is our handler `EMCP_WB_GetState` (no native of that name was
 * called live). Not wrapped: `EvaluateScript` answers `Undefined API func`
 * (U2 no, DEC-040 sc-04); `MakeScreenshot` is the Enforce call
 * `System.MakeScreenshot`, reached live only through the probe handler
 * (DEC-042 sd-20a), not a NET function.
 */

import type { WorkbenchCallOptions, WorkbenchClient } from "./client.js";

/** Timeouts (ms). DEC-040 measured ValidateScripts about 2 s and ReloadScripts 4.7 s;
 *  the two compile calls get more than the about-120 s modal reset (U6) so a compile
 *  error box surfaces as MODAL_OPEN or LOST rather than a plain timeout. */
export const NATIVE_TIMEOUTS = {
  cheap: 10_000,
  gui: 60_000,
  compile: 140_000,
} as const;

/** `ValidateScripts` configurations that answered (DEC-040 U3); `HEADLESS` answers "unknown configuration". */
export type ValidateConfiguration = "WORKBENCH" | "PC";

/** The narrow client surface the wrappers need (a fake in tests). */
export type NativeCaller = Pick<WorkbenchClient, "call" | "probe">;

const READ: WorkbenchCallOptions = { access: "read", allowEmptyPayload: true };
const MUTATE: WorkbenchCallOptions = { access: "mutate", allowEmptyPayload: true };

function obj(r: unknown): Record<string, unknown> {
  return typeof r === "object" && r !== null && !Array.isArray(r)
    ? (r as Record<string, unknown>)
    : {};
}

function bool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (v === 1 || v === "1" || v === "true") return true;
  if (v === 0 || v === "0" || v === "false") return false;
  return null;
}

function count(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (Array.isArray(v)) return v.length;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

export interface WorkbenchRunning {
  /** `ScriptsCompiled` as the live compile gate polled it; null when absent. */
  scriptsCompiled: boolean | null;
  raw: Record<string, unknown>;
}

/** `IsWorkbenchRunning {}`: liveness and `ScriptsCompiled` (s-c-natives.ts waitScriptsCompiled). */
export async function isWorkbenchRunning(c: NativeCaller): Promise<WorkbenchRunning> {
  // probe(): no lease, no auto-launch: a liveness check never starts Workbench (A-3).
  const raw = obj(
    await c.probe(
      "IsWorkbenchRunning",
      {},
      { ...READ, priority: "high", timeout: NATIVE_TIMEOUTS.cheap },
    ),
  );
  return { scriptsCompiled: bool(raw.ScriptsCompiled), raw };
}

export interface WorldEditorRunning {
  /** `IsRunning`: a World Editor module is up (EV-S-C-002: false before one opens); null when absent. */
  running: boolean | null;
  /** `ScriptsCompiled` as this native answered it; null when absent. */
  scriptsCompiled: boolean | null;
  raw: Record<string, unknown>;
}

/**
 * `IsWorldEditorRunning {}`: answers `{IsRunning, ScriptsCompiled}` (EV-S-C-002
 * sc-01, 14 ms). Same lease-free probe as `IsWorkbenchRunning`. A kernel that
 * lacks the function answers an API error; the caller maps that to unknown.
 */
export async function isWorldEditorRunning(c: NativeCaller): Promise<WorldEditorRunning> {
  const raw = obj(
    await c.probe(
      "IsWorldEditorRunning",
      {},
      { ...READ, priority: "high", timeout: NATIVE_TIMEOUTS.cheap },
    ),
  );
  return { running: bool(raw.IsRunning), scriptsCompiled: bool(raw.ScriptsCompiled), raw };
}

export interface ValidateResult {
  /** `Success`; null when absent. */
  success: boolean | null;
  /** `Errors` / `Warnings` as counts when they are numbers or arrays, else null. */
  errors: number | null;
  warnings: number | null;
  raw: Record<string, unknown>;
}

/** `ValidateScripts { Configuration }`: answers `Errors`, `Warnings`, `Success` (DEC-040 U3). */
export async function validateScripts(
  c: NativeCaller,
  configuration: ValidateConfiguration,
): Promise<ValidateResult> {
  const raw = obj(
    await c.call(
      "ValidateScripts",
      { Configuration: configuration },
      { ...READ, timeout: NATIVE_TIMEOUTS.compile },
    ),
  );
  return {
    success: bool(raw.Success),
    errors: count(raw.Errors),
    warnings: count(raw.Warnings),
    raw,
  };
}

/**
 * `ReloadScripts {}` (DEC-040 U4: edit, reload, ping). Mutating: a reset is
 * LOST and is never retried. A failed reload keeps the loaded handlers
 * (DEC-047 U14), so the caller pings afterwards.
 */
export async function reloadScripts(c: NativeCaller): Promise<Record<string, unknown>> {
  return obj(await c.call("ReloadScripts", {}, { ...MUTATE, timeout: NATIVE_TIMEOUTS.compile }));
}

/** `EMCP_WB_GetState` (our handler; the live scripts called it under that name). */
export async function getState(c: NativeCaller): Promise<Record<string, unknown>> {
  return obj(
    await c.probe("EMCP_WB_GetState", {}, { access: "read", timeout: NATIVE_TIMEOUTS.cheap }),
  );
}

export interface OpenResourceResult {
  /** `Opened`: false for an absent file (DEC-040 sc-08); null when absent. */
  opened: boolean | null;
  raw: Record<string, unknown>;
}

/** `OpenResource { ResourceName }` (project-relative name, as sc-08 sent it). */
export async function openResource(
  c: NativeCaller,
  resourceName: string,
): Promise<OpenResourceResult> {
  const raw = obj(
    await c.call(
      "OpenResource",
      { ResourceName: resourceName },
      { ...MUTATE, timeout: NATIVE_TIMEOUTS.gui },
    ),
  );
  return { opened: bool(raw.Opened), raw };
}

/**
 * `BringModuleWindowToFront { ModuleName }`. It answers `{}` for every name,
 * an unknown one included (DEC-040 sc-08), so the answer proves nothing about
 * the module: the caller confirms through another read.
 */
export async function bringModuleWindowToFront(
  c: NativeCaller,
  moduleName: string,
): Promise<Record<string, unknown>> {
  return obj(
    await c.call(
      "BringModuleWindowToFront",
      { ModuleName: moduleName },
      { ...MUTATE, timeout: NATIVE_TIMEOUTS.gui },
    ),
  );
}

/**
 * Where `System.MakeScreenshot` actually writes: it appends `.png` to the
 * requested name (DEC-042 U28: "writes a PNG and appends `.png` to the
 * requested `.bmp` name"). Not a NET function; a pure helper for the caller
 * that reaches it through a handler.
 */
export function makeScreenshotOutputPath(requested: string): string {
  // Observed for a `.bmp` name only; a name already ending in .png is [unverified].
  return `${requested}.png`;
}
