/**
 * Helpers for inspecting the *in-payload* status of a Workbench NET API
 * response.
 *
 * The TCP wire envelope status (decoded in protocol.ts) is "Ok" even when the
 * Enforce-side handler failed — handlers signal their own failures by setting
 * `status: "error"` and `message: "..."` inside the JSON payload. Without this
 * check, a failed mutation decodes cleanly and renders as success, demoting the
 * real error to a "Note" and leaving `isError` unset.
 *
 * Wire every wb_* tool that calls `client.call` through `isHandlerError` after
 * the call and short-circuit with `handlerErrorResponse` when it returns true.
 *
 * Two handler conventions are folded in beyond `status: "error"`:
 *  - `status: "not_implemented"` (Terrain L7 placeholders) — nothing happened.
 *  - `result: false` on an otherwise-ok payload (Clipboard, ExecuteAction):
 *    the engine call returned false, so the action did NOT take effect. Pass
 *    `{ ignoreResultFlag: true }` for actions where a false `result` is a
 *    legitimate answer rather than a failure (Clipboard `hasCopied`).
 */

import { formatConnectionStatus } from "./status.js";
import type { WorkbenchClient } from "./client.js";

export interface HandlerErrorOptions {
  /** Do not treat `result: false` as a failure (e.g. Clipboard hasCopied). */
  ignoreResultFlag?: boolean;
}

/**
 * True when a decoded Workbench payload carries an in-payload handler error
 * (`status: "error"` / `"not_implemented"`, or `result: false` on an ok
 * payload), regardless of the "Ok" TCP wire status.
 */
export function isHandlerError(result: unknown, options: HandlerErrorOptions = {}): boolean {
  if (typeof result !== "object" || result === null) return false;
  const r = result as Record<string, unknown>;
  if (r.status === "error" || r.status === "not_implemented") return true;
  if (!options.ignoreResultFlag && r.result === false) return true;
  return false;
}

/**
 * Extract the handler's error message from a decoded payload, falling back
 * across the field names handlers use (`message`, `error`) and finally a
 * generic string.
 */
export function handlerErrorMessage(result: unknown): string {
  if (typeof result === "object" && result !== null) {
    const r = result as Record<string, unknown>;
    if (typeof r.message === "string" && r.message.length > 0) return r.message;
    if (typeof r.error === "string" && r.error.length > 0) return r.error;
  }
  return "(no message)";
}

/**
 * Build an `isError: true` tool response for an in-payload handler error.
 * Optionally pass the client to append the connection-status footer used by
 * the wb_* tools, and a prefix to describe the failing operation.
 */
export function handlerErrorResponse(
  result: unknown,
  client?: WorkbenchClient,
  prefix = "Workbench handler error",
) {
  const footer = client ? formatConnectionStatus(client) : "";
  return {
    content: [
      {
        type: "text" as const,
        text: `${prefix}: ${handlerErrorMessage(result)}${footer}`,
      },
    ],
    isError: true,
  };
}

/**
 * Build an `isError: true` tool response for a mode-gate refusal
 * (`requireEditMode` / `requirePlayMode` returned a message). A refusal is a
 * failure from the caller's point of view — nothing was done — so it must be
 * flagged, not rendered as a plain success-shaped text block.
 */
export function modeGateResponse(modeErr: string, client: WorkbenchClient) {
  return {
    content: [{ type: "text" as const, text: modeErr + formatConnectionStatus(client) }],
    isError: true,
  };
}
