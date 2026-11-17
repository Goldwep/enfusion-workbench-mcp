/**
 * `wb_bi` — Bohemia's own NET handlers (design section 2; plan 8 package 3.6, DEC-047 L6).
 *
 *   list          the 42 compiled handlers E04 lists: declared request fields, class, live flag;
 *                 no Workbench call
 *   describe      one handler: fields with types, response fields, source, class, risk
 *   call          one of the 14 verified read-only handlers, access "read"; the request is
 *                 validated against the declared fields before anything is sent
 *   callMutating  present but refusing: GATED for every handler until the Bohemia battery
 *
 * `LocatePrefabsFromPath` raised the authorization prompt (DEC-040 U27): GATED. Any other name
 * is NOT_ALLOWLISTED for `call`. Registered in src/server.ts (extended tier, src/manifest/tiers.ts).
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { WorkbenchError, type WorkbenchClient } from "../workbench/client.js";
import {
  AUTH_GATED,
  AUTH_GATED_NEXT,
  BI_HANDLERS,
  LIVE_NOTES,
  MODAL_HAZARD,
  MODAL_HAZARD_WARNING,
  MUTATING_GATED_NEXT,
  VERIFIED_READ,
  callVerifiedRead,
  findHandler,
  isVerifiedRead,
  requestSchema,
  type BiHandlerRow,
} from "../workbench/bi-handlers.js";
import {
  ERROR_CODES,
  type ActionError,
  type ActionOk,
  type ErrorCode,
} from "../manifest/vocabulary.js";

export const ACTIONS = ["list", "describe", "call", "callMutating"] as const;
export type BiAction = (typeof ACTIONS)[number];

export const DESCRIPTION =
  "Bohemia's own Workbench NET handlers. Read: list: the handlers with declared fields, " +
  "class and live flag; describe: one handler; call: one of the 14 verified read-only " +
  "handlers, request checked against its declared fields. Mutating: callMutating: gated " +
  "until the Bohemia battery.";

export type BiResponse = ActionOk | ActionError;

export interface BiDeps {
  client: Pick<WorkbenchClient, "call">;
}

function targetOf(handler: unknown): string {
  return typeof handler === "string" && handler !== "" ? `bi:${handler}` : "bi:catalog";
}

function fail(
  action: string,
  target: string,
  code: ErrorCode,
  message: string,
  next?: string,
): ActionError {
  return {
    ok: false,
    action,
    target,
    code,
    message,
    next: next ?? ERROR_CODES[code],
    warnings: [],
  };
}

function summary(r: BiHandlerRow) {
  return {
    name: r.name,
    request: r.request.map(([k]) => k),
    class: r.class,
    verifiedLive: r.verifiedLive,
    callable: isVerifiedRead(r.name),
  };
}

function detail(r: BiHandlerRow) {
  return {
    ...summary(r),
    fields: r.request.map(([key, type]) => ({ key, type })),
    response: r.response,
    ref: r.ref,
    risk: r.risk,
    ...(LIVE_NOTES[r.name] ? { liveNote: LIVE_NOTES[r.name] } : {}),
  };
}

const ArgsSchema = z
  .object({
    action: z.enum(ACTIONS),
    handler: z.string().optional(),
    request: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

function zodMessage(e: z.ZodError): string {
  return e.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
}

async function callAction(
  handler: string | undefined,
  request: Record<string, unknown> | undefined,
  deps: BiDeps,
): Promise<BiResponse> {
  const target = targetOf(handler);
  if (!handler) return fail("call", target, "INVALID_ARGUMENT", "handler is required");
  if (handler === AUTH_GATED) {
    return fail(
      "call",
      target,
      "GATED",
      `${AUTH_GATED} raised the Script Authorization Required prompt (FileIO.FindFiles, DEC-040 U27); nothing was sent`,
      AUTH_GATED_NEXT,
    );
  }
  if (!isVerifiedRead(handler)) {
    const row = findHandler(handler);
    return fail(
      "call",
      target,
      "NOT_ALLOWLISTED",
      row
        ? `${handler} is not one of the 14 verified read-only handlers (${row.class}: ${row.risk}); nothing was sent`
        : `${handler} is not a Bohemia handler E04 lists; nothing was sent`,
      row ? "Use list for the callable handlers; mutating ones wait for callMutating." : undefined,
    );
  }
  const row = findHandler(handler)!;
  const parsed = requestSchema(row).safeParse(request ?? {});
  if (!parsed.success) {
    return fail(
      "call",
      target,
      "INVALID_ARGUMENT",
      `${zodMessage(parsed.error)} (declared: ${JSON.stringify(row.request.map(([k]) => k))}); nothing was sent`,
    );
  }
  let resp: Record<string, unknown>;
  try {
    resp = await callVerifiedRead(deps.client, handler, parsed.data);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (e instanceof WorkbenchError) {
      if (e.code === "MODAL_OPEN" || e.code === "LOST" || e.code === "WEDGED") {
        return fail("call", target, e.code, message);
      }
      if (e.code === "API_ERROR") return fail("call", target, "HANDLER_ERROR", message);
    }
    if (e instanceof WorkbenchError && (e.code === "TIMEOUT" || e.code === "PROTOCOL_ERROR")) {
      return fail(
        "call",
        target,
        "UNREACHABLE",
        message,
        "No answer or an early reset: a modal (authorization prompt) or a cold load may hold the queue; check the Workbench window before retrying.",
      );
    }
    return fail("call", target, "UNREACHABLE", message);
  }
  const warnings = LIVE_NOTES[handler] ? [LIVE_NOTES[handler]] : [];
  if (MODAL_HAZARD.has(handler)) warnings.push(MODAL_HAZARD_WARNING);
  // Bohemia's NET handlers answer upper-case "ERROR" (isBiHandlerError, wb-projects.ts); fold case.
  if (typeof resp.status === "string" && resp.status.toLowerCase() === "error") {
    const r = fail(
      "call",
      target,
      "HANDLER_ERROR",
      typeof resp.message === "string" && resp.message ? resp.message : "status error",
    );
    r.warnings = warnings;
    return r;
  }
  return { ok: true, action: "call", target, changed: null, readback: resp, warnings };
}

/** Validates, then answers. Never throws. */
export async function runBi(raw: unknown, deps: BiDeps): Promise<BiResponse> {
  const rawObj = (raw ?? {}) as Record<string, unknown>;
  const action = typeof rawObj.action === "string" ? rawObj.action : "";
  const parsed = ArgsSchema.safeParse(raw);
  if (!parsed.success) {
    return fail(action, targetOf(rawObj.handler), "INVALID_ARGUMENT", zodMessage(parsed.error));
  }
  const { handler, request } = parsed.data;
  switch (parsed.data.action) {
    case "list": {
      const rows = BI_HANDLERS.map(summary);
      return {
        ok: true,
        action: "list",
        target: "bi:catalog",
        changed: null,
        readback: {
          total: rows.length,
          callable: VERIFIED_READ.length,
          gated: [AUTH_GATED],
          rows,
        },
        warnings: [],
      };
    }
    case "describe": {
      const row = handler ? findHandler(handler) : undefined;
      if (!row) {
        return fail(
          "describe",
          targetOf(handler),
          handler ? "NOT_ALLOWLISTED" : "INVALID_ARGUMENT",
          handler ? `${handler} is not a Bohemia handler E04 lists` : "handler is required",
          handler ? "Use list for the handler names." : undefined,
        );
      }
      return {
        ok: true,
        action: "describe",
        target: targetOf(handler),
        changed: null,
        readback: detail(row),
        warnings: [],
      };
    }
    case "call":
      return callAction(handler, request, deps);
    case "callMutating":
      return fail(
        "callMutating",
        targetOf(handler),
        "GATED",
        "callMutating is present but refusing for every handler; nothing was sent",
        MUTATING_GATED_NEXT,
      );
  }
}

/** Flat MCP input shape: the action enum, the handler name, the request object. */
export function inputShape(): Record<string, z.ZodTypeAny> {
  return {
    action: z.enum(ACTIONS),
    handler: z.string().describe("Bohemia handler name (list)").optional(),
    request: z
      .record(z.string(), z.unknown())
      .describe("declared request fields only (describe)")
      .optional(),
  };
}

export function registerWbBiTool(server: McpServer, client: WorkbenchClient): void {
  server.registerTool(
    "wb_bi",
    { description: DESCRIPTION, inputSchema: z.object(inputShape()).strict() },
    async (args) => {
      const r = await runBi(args, { client });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(r, null, 2) }],
        isError: !r.ok,
      };
    },
  );
}
