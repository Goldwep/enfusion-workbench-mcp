/**
 * `wb_module` — Workbench modules (design section 2; DEC-048 package 3.3).
 *
 *   list           read: the present module names (no GetModule: it opens a closed module;
 *                  NavmeshGeneratorMain only when its type resolves, W5 OD-5); open = only the
 *                  modules this handler opened since the script reload
 *   info           one module's containers and docPath (container 0's resource where that read is
 *                  proven); OPENS the module if closed (GetModule), reversible
 *   open           Workbench.OpenModule through EMCP_WB_Module
 *   front          the NET native BringModuleWindowToFront (src/workbench/native.ts); the
 *                  handler refuses front, so this tool never sends it there
 *   close          refused here and in Enforce: no proven dirty-flag call (DEC-045)
 *   setResource    a clean relative `path:` target opened in the named module, which must own the
 *                  file type (owningModule: World Editor .ent/.et only; .conf/.emat/.layout etc. the
 *                  Resource Manager); another type is refused INVALID_ARGUMENT before anything is
 *                  sent (no project needed: opening is not a write, the engine resolves the path
 *                  across addons; DEC-058). AnimEditor and ProcAnimEditor go through
 *                  Workbench.OpenResource until P-W4-07 / P-W4-08 prove the project-relative form
 *   save           dry run unless confirm, project only: the World Editor's world, or the one open
 *                  document of AnimEditor, BehaviorEditor or ProcAnimEditor (W4 spec 2.3). On
 *                  1.9.0.37 the handler refuses those NO_DOCUMENT: they expose no container for the
 *                  open file (P-W4-10 killed, W4 run 1); OD-6 warning on a save
 *   action         an allow-listed menu path (EMCP_WB_ActionAllowList.c), through wb_menu run's
 *                  checks first (menuRunGate: dialog MODAL_HAZARD, refused risk, play or unknown
 *                  mode WRONG_MODE for a WorldEditor item only, and a dry run unless confirm for
 *                  an item the ledger does not call safe; live-tools-b-1)
 *
 * The wire request is checked against the zod union generated from
 * contracts/EMCP_WB_Module.json before anything is sent. The handler's own
 * refusals (status "refused", code, nextStep) come back as errors with the same
 * code. Not registered here: src/server.ts registers it.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { WorkbenchError, type WorkbenchClient } from "../workbench/client.js";
import { bringModuleWindowToFront } from "../workbench/native.js";
import { defaultDeps as defaultMenuDeps, menuRunGate, type MenuDeps } from "./wb-menu.js";
import { parseContract, type Contract } from "../manifest/contract.js";
import { buildRequestSchema, checkedDescription } from "../manifest/generate.js";
import {
  ERROR_CODES,
  MODULE_SCHEMA,
  TARGET_SCHEMA,
  VocabularyError,
  moduleAllowsRead,
  parseTarget,
  printTarget,
  type ActionError,
  type ActionOk,
  type Change,
  type ErrorCode,
  type ModuleId,
  owningModule,
} from "../manifest/vocabulary.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export const MODULE_ACTIONS = [
  "list",
  "info",
  "open",
  "front",
  "close",
  "setResource",
  "save",
  "action",
] as const;
export type ModuleAction = (typeof MODULE_ACTIONS)[number];

export const READ_ACTIONS: readonly ModuleAction[] = ["list", "info"];

/** Phase 3: save is World Editor only until sitting P3-1 (DEC-048), plus the W4 editors below. */
export const WORLD_EDITOR_ONLY: readonly ModuleAction[] = ["save"];

/**
 * W4 spec 2.3 (DEC-067): save also reaches the one open document of these editors. P-W4-10 was
 * killed in W4 run 1 (each answered 0 containers with a file open), so the handler refuses each
 * NO_DOCUMENT on 1.9.0.37; behind that, GATED until P-W4-11/13/12. The gates live in Enforce only
 * (EMCP_WB_ModuleUtil).
 */
export const DOCUMENT_SAVE_MODULES: readonly ModuleId[] = [
  "AnimEditor",
  "BehaviorEditor",
  "ProcAnimEditor",
];

/** OD-6 (DEC-067): an editor save may change content beyond canonical form. */
export const OD6_WARNING =
  "the editor's own save may change the file beyond canonical form (OD-6): no API diffs it here; compare the file with its version-control copy";

export { owningModule };

/** Every code this tool answers is in the shared table (vocabulary.ts ERROR_CODES). */
export type ModuleErrorCode = ErrorCode;

export type ModuleError = ActionError & { readback?: unknown };
export type ModuleResponse = ActionOk | ModuleError;

/** The client surface this tool needs (a fake in tests); `state` is read when the client has one. */
export type ModuleClient = Pick<WorkbenchClient, "call" | "probe"> & {
  state?: { mode?: string };
};

export interface ModuleArgs {
  action: ModuleAction;
  module?: ModuleId;
  target?: string;
  menuPath?: string[];
  keepFocus?: boolean;
  /** save: true writes; action: true presses an item that is not safe. Otherwise a dry run. */
  confirm?: boolean;
}

export const HANDLER = "EMCP_WB_Module";
const CALL_TIMEOUT_MS = 30_000;

/**
 * The next step for an engine call that answered false. The shared text says "nothing changed",
 * which a false Save or SetOpenedResource does not prove (a write may have failed part way,
 * EMCP_WB_EditorControl.c:86), so this tool passes its own.
 */
export const ENGINE_FALSE_NEXT =
  "The engine answered false; whether anything changed is unknown. Read back with info.";

const KNOWN_CODES: ReadonlySet<string> = new Set(Object.keys(ERROR_CODES));

function fail(
  action: string,
  target: string,
  code: ModuleErrorCode,
  message: string,
  next?: string,
): ModuleError {
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

/** Maps a client failure to a response code (MODAL_OPEN, LOST and WEDGED keep their names). */
export function codeOfClientError(e: unknown): { code: ModuleErrorCode; message: string } {
  const message = e instanceof Error ? e.message : String(e);
  if (e instanceof WorkbenchError) {
    if (e.code === "MODAL_OPEN") return { code: "MODAL_OPEN", message };
    if (e.code === "LOST") return { code: "LOST", message };
    if (e.code === "WEDGED") return { code: "WEDGED", message };
  }
  return { code: "UNREACHABLE", message };
}

// ── Contract ──────────────────────────────────────────────────────────────────

const CONTRACT_FILE = fileURLToPath(
  new URL("../../contracts/EMCP_WB_Module.json", import.meta.url),
);

let cached: { contract: Contract; schema: ReturnType<typeof buildRequestSchema> } | null = null;

/** The handler contract and the wire-request schema generated from it (read once). */
export function moduleContract(): {
  contract: Contract;
  schema: ReturnType<typeof buildRequestSchema>;
} {
  if (!cached) {
    const contract = parseContract(JSON.parse(readFileSync(CONTRACT_FILE, "utf-8")), CONTRACT_FILE);
    cached = { contract, schema: buildRequestSchema(contract) };
  }
  return cached;
}

// ── Wire ──────────────────────────────────────────────────────────────────────

/** The handler request for one action, checked against the contract's union. Throws VocabularyError. */
export function buildWireRequest(args: ModuleArgs, resourcePath?: string): Record<string, unknown> {
  const wire: Record<string, unknown> = { action: args.action };
  if (args.action !== "list") wire.moduleName = args.module;
  if (args.action === "setResource") wire.path = resourcePath;
  if (args.action === "action") {
    wire.menuPath = args.menuPath;
    if (args.keepFocus !== undefined) wire.keepFocus = args.keepFocus;
  }
  if (args.action === "save" && args.confirm !== undefined) wire.confirm = args.confirm;
  const parsed = moduleContract().schema.safeParse(wire);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    throw new VocabularyError(
      "INVALID_ARGUMENT",
      `request does not match the contract: ${issues.join("; ")}`,
    );
  }
  return parsed.data as Record<string, unknown>;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function strs(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** True for 1, "1", true and "true" (the NET layer may stringify booleans). */
function truthy(v: unknown): boolean {
  return v === true || v === 1 || v === "1" || v === "true";
}

/** A handler refusal ("refused" with code and nextStep) or error as a ModuleError, else null. */
export function handlerFailure(
  action: string,
  target: string,
  r: Record<string, unknown>,
): ModuleError | null {
  const status = str(r.status);
  if (status === "refused") {
    const raw = str(r.code);
    const code = (KNOWN_CODES.has(raw) ? raw : "INVALID_ARGUMENT") as ModuleErrorCode;
    const next = str(r.nextStep) || undefined;
    const e = fail(action, target, code, str(r.message) || `${raw} refusal`, next);
    if (!KNOWN_CODES.has(raw)) e.warnings.push(`the handler answered an unknown code '${raw}'`);
    return e;
  }
  if (status === "error") {
    // An editor document save (W4) answers SAVE_FAILED with its error; every other error is a false.
    const saveFailed = str(r.code) === "SAVE_FAILED";
    const e = fail(
      action,
      target,
      saveFailed ? "SAVE_FAILED" : "ENGINE_FALSE",
      str(r.message) || "the handler answered error",
      ENGINE_FALSE_NEXT,
    );
    e.readback = { called: truthy(r.called), result: truthy(r.result) };
    return e;
  }
  if (status !== "ok") {
    return fail(action, target, "UNREACHABLE", `the handler answered status '${status}'`);
  }
  return null;
}

// ── Actions ───────────────────────────────────────────────────────────────────

function targetOf(args: ModuleArgs): string {
  if (args.action === "list") return "workbench:modules";
  return `module:${args.module ?? "?"}`;
}

async function send(
  client: ModuleClient,
  wire: Record<string, unknown>,
  read: boolean,
): Promise<Record<string, unknown>> {
  return client.call<Record<string, unknown>>(HANDLER, wire, {
    access: read ? "read" : "mutate",
    timeout: CALL_TIMEOUT_MS,
  });
}

function shapeOk(args: ModuleArgs, target: string, r: Record<string, unknown>): ModuleResponse {
  const warnings: string[] = [];
  let changed: Change[] | null = null;
  let readback: unknown;
  switch (args.action) {
    case "list":
      readback = {
        modules: strs(r.modules),
        open: strs(r.openModules),
        unread: strs(r.unreadModules),
      };
      break;
    case "info":
      readback = {
        module: args.module,
        isOpen: truthy(r.isOpen),
        mayHaveOpened: truthy(r.mayHaveOpened),
        containerCount: typeof r.containerCount === "number" ? r.containerCount : null,
        containerClasses: strs(r.containerClasses),
        docPath: str(r.docPath) || null,
      };
      warnings.push("info calls GetModule, which opens the module window if it was closed.");
      if (args.module && (DOCUMENT_SAVE_MODULES as readonly string[]).includes(args.module))
        warnings.push(
          `${args.module} exposes no container for its open document on 1.9.0.37 (P-W4-10 killed, W4 run 1): containerCount 0 and docPath null do not mean no file is open; save refuses NO_DOCUMENT`,
        );
      break;
    case "open": {
      const called = truthy(r.called);
      const isOpen = truthy(r.isOpen);
      readback = {
        isOpen,
        called,
        openResult: truthy(r.result),
        mayHaveOpened: truthy(r.mayHaveOpened),
      };
      if (!called && isOpen) {
        warnings.push(
          "GetModule returned the module and opens a closed one: whether it was open before is not known",
        );
      }
      // The Particle Editor is never read: neither its prior state nor isOpen is observed.
      if (called && isOpen && args.module !== "ParticleEditor") {
        changed = [{ path: `${args.module}.open`, before: false, after: true }];
      }
      if (args.module === "ParticleEditor") {
        warnings.push("ParticleEditor is never read back: isOpen is OpenModule's own answer");
      } else if (called && !isOpen) {
        warnings.push("OpenModule was called but GetModule still answers null");
      }
      break;
    }
    case "setResource":
      readback = { path: str(r.path), result: truthy(r.result), openedIn: str(r.openedIn) };
      changed = [
        {
          path: `${str(r.openedIn) || "WorldEditor"}.openedResource`,
          before: null,
          after: str(r.path),
        },
      ];
      warnings.push(
        "no proven call reads the opened resource back; 'before' is unknown and 'after' is what was requested",
      );
      // AnimEditor and ProcAnimEditor before P-W4-07 / P-W4-08: the 1.x route (W4 spec 2.3).
      if (str(r.message).includes("Workbench.OpenResource")) {
        warnings.push(
          "opened through Workbench.OpenResource (the default editor of the type); the project-relative SetOpenedResource form waits for its W4 probe",
        );
      }
      break;
    case "save": {
      const dryRun = truthy(r.dryRun);
      if (DOCUMENT_SAVE_MODULES.includes(args.module as ModuleId)) {
        const docPath = str(r.docPath);
        readback = { dryRun, docPath: docPath || null, result: dryRun ? null : truthy(r.result) };
        warnings.push(OD6_WARNING);
        if (dryRun) {
          warnings.push("dry run: nothing was written");
          const ok: ActionOk = {
            ok: true,
            action: args.action,
            target,
            changed: null,
            readback,
            warnings,
          };
          ok.next = `wb_module save module ${args.module} with confirm: true writes the document named in readback`;
          return ok;
        }
        changed = [{ path: docPath || `${args.module}.document`, before: null, after: "saved" }];
        break;
      }
      readback = {
        dryRun,
        worldPath: str(r.worldPath) || null,
        worldPathForm: str(r.worldPathForm),
        result: dryRun ? null : truthy(r.result),
      };
      if (dryRun) {
        warnings.push("dry run: nothing was written; no API diffs a world, so no diff is shown");
        const ok: ActionOk = {
          ok: true,
          action: args.action,
          target,
          changed: null,
          readback,
          warnings,
        };
        ok.next = "wb_module save with confirm: true writes the world named in readback";
        return ok;
      }
      // No proven call reads the dirty state: 'before' is unknown.
      changed = [{ path: str(r.worldPath) || "WorldEditor.world", before: null, after: "saved" }];
      warnings.push(
        "no proven call reads whether the world was dirty or whether the engine canonicalised it",
      );
      break;
    }
    case "action":
      readback = {
        menuPath: str(r.executedPath),
        result: truthy(r.result),
        allowListCount: typeof r.allowListCount === "number" ? r.allowListCount : null,
      };
      warnings.push(
        "ExecuteAction answers only true or false; what the menu item changed is not read back",
      );
      if (!truthy(r.result)) {
        warnings.push("ExecuteAction returned false: the label may be wrong or unavailable");
      }
      break;
    default:
      readback = r;
  }
  const ok: ActionOk = { ok: true, action: args.action, target, changed, readback, warnings };
  if (args.action === "info" && !truthy(r.isOpen)) ok.next = `wb_module open ${args.module}`;
  return ok;
}

async function doFront(client: ModuleClient, args: ModuleArgs, target: string) {
  const module = args.module as ModuleId;
  await bringModuleWindowToFront(client, module);
  const warnings = [
    "BringModuleWindowToFront answers {} for every name (DEC-040 sc-08); the answer proves nothing",
  ];
  let readback: unknown = null;
  if (moduleAllowsRead(module)) {
    const r = await send(client, buildWireRequest({ action: "info", module }), true);
    const f = handlerFailure("front", target, r);
    readback = f ? { error: f.message } : { isOpen: truthy(r.isOpen) };
    if (!f && !truthy(r.isOpen)) warnings.push(`${module} is not open; front cannot show it`);
  } else {
    warnings.push("ParticleEditor is never read back");
  }
  const ok: ActionOk = { ok: true, action: "front", target, changed: null, readback, warnings };
  return ok;
}

/** Checks the arguments in TypeScript; the handler refuses the same cases again. */
export function precheck(args: ModuleArgs): ModuleError | { resourcePath?: string } {
  const target = targetOf(args);
  const a = args.action;
  if (a !== "list" && !args.module) {
    return fail(a, target, "INVALID_ARGUMENT", `${a} needs module`);
  }
  const module = args.module as ModuleId;
  if ((a === "info" || a === "action") && !moduleAllowsRead(module)) {
    return fail(
      a,
      target,
      "MODULE_NOT_SUPPORTED",
      "the Particle Editor is never read (its module read crashed the Workbench, DEC-042)",
      "use open or front for ParticleEditor",
    );
  }
  if (a === "close") {
    return fail(
      a,
      target,
      "MODULE_NOT_SUPPORTED",
      "close is refused: no proven call tells whether the document is dirty, and one WM_CLOSE does not exit a dirty world (DEC-045)",
      "the owner closes by hand",
    );
  }
  if (
    WORLD_EDITOR_ONLY.includes(a) &&
    module !== "WorldEditor" &&
    !DOCUMENT_SAVE_MODULES.includes(module)
  ) {
    return fail(
      a,
      target,
      "MODULE_NOT_SUPPORTED",
      `${a} takes WorldEditor, AnimEditor, BehaviorEditor or ProcAnimEditor`,
    );
  }
  if (a === "setResource") {
    if (!args.target)
      return fail(a, target, "INVALID_ARGUMENT", "setResource needs target path:<resource>");
    const t = parseTarget(args.target);
    if (t.kind !== "path") {
      return fail(
        a,
        printTarget(t),
        "INVALID_ARGUMENT",
        "setResource needs target path:<resource>",
      );
    }
    const owner = owningModule(t.path);
    if (owner === "ParticleEditor") {
      return fail(
        a,
        printTarget(t),
        "MODULE_NOT_SUPPORTED",
        "a particle effect (.ptc) is never opened: reading the Particle Editor module crashed the Workbench (DEC-042)",
        "the owner opens it by hand",
      );
    }
    if (owner !== module) {
      const why =
        module === "WorldEditor"
          ? "the World Editor opens only a world (.ent) or a prefab (.et)"
          : "the module that owns its file type";
      return fail(
        a,
        printTarget(t),
        "INVALID_ARGUMENT",
        `${module} cannot open ${t.path}: ${why}; nothing was opened`,
        `wb_module setResource module ${owner} (or wb_resources open)`,
      );
    }
    return { resourcePath: t.path };
  }
  if (a === "save" && args.target !== undefined && DOCUMENT_SAVE_MODULES.includes(module)) {
    if (args.target !== `open:${module}`) {
      return fail(
        a,
        args.target,
        "INVALID_ARGUMENT",
        `save in ${module} takes target open:${module} or none`,
      );
    }
  } else if (a === "save" && args.target !== undefined) {
    const t = parseTarget(args.target);
    if (t.kind !== "open") {
      return fail(
        a,
        printTarget(t),
        "INVALID_ARGUMENT",
        "save takes target open:WorldEditor or none",
      );
    }
  }
  if (a === "action" && (!args.menuPath || args.menuPath.length === 0)) {
    return fail(a, target, "INVALID_ARGUMENT", "action needs menuPath (one segment per entry)");
  }
  return {};
}

/**
 * action: wb_menu run's checks (menuRunGate) before anything is sent; a refusal, a dry run, or
 * null to send.
 */
function actionGate(
  client: ModuleClient,
  args: ModuleArgs,
  target: string,
  menuDeps: MenuDeps,
): ModuleResponse | null {
  const segments = args.menuPath ?? [];
  const gate = menuRunGate(client, args.module as string, segments, args.confirm, menuDeps);
  if (gate.kind === "refuse") return fail("action", target, gate.code, gate.message, gate.next);
  if (gate.kind === "send") return null;
  const ok: ActionOk = {
    ok: true,
    action: "action",
    target,
    changed: null,
    readback: { dryRun: true, ran: false, menuPath: segments.join(" > "), risk: gate.risk },
    warnings: [gate.warning],
  };
  ok.next = `wb_module action module ${args.module} with the same menuPath and confirm: true presses it`;
  return ok;
}

/** Runs one action; never throws. */
export async function runModule(
  client: ModuleClient,
  args: ModuleArgs,
  menuDeps: MenuDeps = defaultMenuDeps(),
): Promise<ModuleResponse> {
  let target = targetOf(args);
  try {
    if (args.action === "setResource" && args.target) target = args.target;
    if (args.action === "save") {
      target = DOCUMENT_SAVE_MODULES.includes(args.module as ModuleId)
        ? `open:${args.module}`
        : "open:WorldEditor";
    }
    const pre = precheck(args);
    if ("ok" in pre) return pre;
    if (args.action === "setResource" && pre.resourcePath) target = `path:${pre.resourcePath}`;
    if (args.action === "front") return await doFront(client, args, target);
    if (args.action === "action") {
      const gated = actionGate(client, args, target, menuDeps);
      if (gated) return gated;
    }
    const read = READ_ACTIONS.includes(args.action);
    const wire = buildWireRequest(args, pre.resourcePath);
    const r = await send(client, wire, read);
    const f = handlerFailure(args.action, target, r);
    if (f) return f;
    return shapeOk(args, target, r);
  } catch (e) {
    if (e instanceof VocabularyError) return fail(args.action, target, e.code, e.message);
    const c = codeOfClientError(e);
    const f = fail(args.action, target, c.code, c.message);
    if (c.code === "LOST" && !READ_ACTIONS.includes(args.action)) {
      f.next =
        "The call was lost and is never retried; read back with wb_module info or list first.";
    }
    return f;
  }
}

export function toToolResult(r: ModuleResponse) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(r, null, 2) }],
    ...(r.ok ? {} : { isError: true as const }),
  };
}

// ── Registration ──────────────────────────────────────────────────────────────

/** The description generated from the contract (≤ 400 chars, Read:/Mutating: lines). */
export function wbModuleDescription(): string {
  return checkedDescription(moduleContract().contract);
}

export const WB_MODULE_INPUT = {
  action: z.enum(MODULE_ACTIONS),
  module: MODULE_SCHEMA.optional().describe("every action but list"),
  target: TARGET_SCHEMA.optional().describe("setResource: path:<rel>; save: open:<module>"),
  menuPath: z.array(z.string()).optional().describe("action: menu path segments"),
  keepFocus: z.boolean().optional().describe("action: default true"),
  confirm: z.boolean().optional().describe("save/action: true; else dry run"),
};

export function registerWbModule(server: McpServer, client: WorkbenchClient): void {
  server.registerTool(
    "wb_module",
    {
      description: wbModuleDescription(),
      inputSchema: WB_MODULE_INPUT,
      annotations: {
        title: "Workbench modules",
        readOnlyHint: false,
        // save overwrites the open world in place.
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) => toToolResult(await runModule(client, args as ModuleArgs)),
  );
}
