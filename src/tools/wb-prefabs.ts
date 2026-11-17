import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WorkbenchError } from "../workbench/client.js";
import type { WorkbenchClient } from "../workbench/client.js";
import { formatConnectionStatus } from "../workbench/status.js";
import { handlerErrorResponse } from "../workbench/response.js";
import { isBiHandlerError } from "./wb-projects.js";
import { AUTH_GATED, AUTH_GATED_NEXT } from "../workbench/bi-handlers.js";
import { loadContract } from "../manifest/contract.js";
import type { Contract } from "../manifest/contract.js";
import { buildRequestSchema, checkedDescription } from "../manifest/generate.js";
import {
  ERROR_CODES,
  VocabularyError,
  checkRelativePath,
  parseEntityRef,
  printEntityRef,
  type ActionOk,
  type Change,
} from "../manifest/vocabulary.js";

/**
 * wb_prefabs: prefabs through EMCP_WB_Prefabs (wave W1, phase5-w1-spec.md section 2.7). The
 * schema and the description come from contracts/EMCP_WB_Prefabs.json; entity references,
 * resource names and new file paths go through the shared vocabulary before anything is sent.
 *
 * 1.x compatibility: createTemplate, save and getAncestor keep their names. The 1.x parameters
 * entityName (to entity `name:<n>`) and templatePath (to path) are accepted for those three
 * actions and mapped. getGuid and locate are not handler actions: they stay on Bohemia's own
 * handlers (GetPrefabGUID, LocateProject, LocatePrefabsFromPath) and answer as they did in 1.x.
 */

export const HANDLER = "EMCP_WB_Prefabs";

/** contracts/ sits two levels above both src/tools and dist/tools. */
export const CONTRACT_FILE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "contracts",
  `${HANDLER}.json`,
);

export const PREFABS_CONTRACT: Contract = loadContract(CONTRACT_FILE);
export const PREFABS_REQUEST_SCHEMA = buildRequestSchema(PREFABS_CONTRACT);

/** From the contract; checkedDescription throws when it is over the 400-char budget. */
export const WB_PREFABS_DESCRIPTION = checkedDescription(PREFABS_CONTRACT);

/** 1.x actions that are not handler actions (Bohemia handlers; answered as text, as in 1.x). */
export const LEGACY_BI_ACTIONS: readonly string[] = ["getGuid", "locate"];
/** The 1.x parameter names of the three actions that share a name with a handler action. */
export const ALIASED_ACTIONS: readonly string[] = ["createTemplate", "save", "getAncestor"];
/** The handler's cap on one entities list (EMCP_WB_PrefabsUtil.MAX_ENTITIES). */
export const MAX_ENTITIES = 200;
/** A file write and a clone can take a while on the NET thread. */
export const CALL_TIMEOUT_MS = 30_000;

type Raw = Record<string, unknown>;

export interface PrefabsError {
  ok: false;
  action: string;
  target: string;
  /** A vocabulary code, or a kernel code (LOST, MODAL_OPEN, WEDGED, ...). */
  code: string;
  message: string;
  next: string;
  warnings: string[];
}

export type PrefabsResponse = ActionOk | PrefabsError;

function fail(
  action: string,
  target: string,
  code: string,
  message: string,
  next?: string,
): PrefabsError {
  const fallback = (ERROR_CODES as Record<string, string>)[code] ?? "See the message.";
  return { ok: false, action, target, code, message, next: next || fallback, warnings: [] };
}

/** True for 1, "1", true and "true": Enforce JSON writes booleans as 1/0 (P3-3 gate 2, 2026-10-10). */
function isTrue(v: unknown): boolean {
  return v === true || v === 1 || v === "1" || v === "true";
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function strs(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x)) : [];
}

/** A checked request: what is sent to the handler, or the refusal raised before sending. */
export type Prepared =
  | {
      ok: true;
      action: string;
      target: string;
      mutating: boolean;
      params: Raw;
      warnings: string[];
    }
  | { ok: false; error: PrefabsError };

class Refusal extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function checkRef(label: string, text: string): string {
  try {
    return printEntityRef(parseEntityRef(text));
  } catch (e) {
    if (e instanceof VocabularyError) throw new Refusal(e.code, `${label}: ${e.message}`);
    throw e;
  }
}

function checkEntities(label: string, list: string[]): string[] {
  if (list.length === 0) throw new Refusal("INVALID_ARGUMENT", `${label} must hold a reference`);
  if (list.length > MAX_ENTITIES) {
    throw new Refusal(
      "INVALID_ARGUMENT",
      `${label} holds ${list.length} references; at most ${MAX_ENTITIES}, split the call`,
    );
  }
  return list.map((t, i) => checkRef(`${label}[${i}]`, t));
}

/** A new project-relative .et path: clean (no drive, root, prefix or '..') and ending in .et. */
function checkNewPrefabPath(label: string, text: string): string {
  let clean: string;
  try {
    clean = checkRelativePath(text);
  } catch (e) {
    if (e instanceof VocabularyError) throw new Refusal(e.code, `${label}: ${e.message}`);
    throw e;
  }
  if (!clean.toLowerCase().endsWith(".et") || clean.endsWith("/")) {
    throw new Refusal("INVALID_ARGUMENT", `${label} must be a project-relative path ending in .et`);
  }
  return clean;
}

const PREFAB_RESOURCE = /^\{[0-9A-Fa-f]{16}\}(.+)$/;

/** A source prefab resource name: {GUID}path.et with a clean path part. */
function checkPrefabResource(text: string): string {
  const m = PREFAB_RESOURCE.exec(text);
  if (!m) {
    throw new Refusal(
      "INVALID_ARGUMENT",
      `prefab must be a resource name {16 hex GUID}path.et, got ${text}`,
    );
  }
  try {
    const clean = checkRelativePath(m[1]);
    if (!clean.toLowerCase().endsWith(".et")) {
      throw new Refusal("INVALID_ARGUMENT", `prefab must end in .et, got ${text}`);
    }
    return text.slice(0, text.length - m[1].length) + clean;
  } catch (e) {
    if (e instanceof VocabularyError) throw new Refusal(e.code, `prefab: ${e.message}`);
    throw e;
  }
}

/** The target string the response carries: the thing the action is about. */
function targetOf(action: string, p: Raw): string {
  switch (action) {
    case "getAncestor":
    case "createTemplate":
      return str(p.entity);
    case "save":
      return str(p.entity) || "prefab edit root";
    case "editState":
      return "open:WorldEditor";
    case "addMembers":
      return str(p.member);
    case "removeMembers":
      return strs(p.entities).join(",");
    case "moveToPrefab":
      return str(p.parent);
    default:
      return str(p.prefab);
  }
}

/**
 * Validates one tool input against the contract's per-action schema and the shared vocabulary.
 * Nothing is sent when this refuses: INVALID_ARGUMENT for a malformed reference, resource name,
 * path or list; ABSOLUTE_PATH for a path that leaves the project.
 */
export function prepareRequest(input: unknown): Prepared {
  const raw: Raw = { ...((input ?? {}) as Raw) };
  const action = str(raw.action);
  const warnings: string[] = [];
  const shownTarget = str(raw.entity) || str(raw.entityName) || str(raw.prefab) || "";
  try {
    // 1.x parameter names (createTemplate, save, getAncestor only).
    if (ALIASED_ACTIONS.includes(action)) {
      if (raw.addonName !== undefined) {
        throw new Refusal(
          "INVALID_ARGUMENT",
          "addonName has no equivalent: a prefab is written into the open project and path is project-relative",
        );
      }
      if (raw.entityName !== undefined) {
        if (raw.entity !== undefined) {
          throw new Refusal("INVALID_ARGUMENT", "give entity or the 1.x entityName, not both");
        }
        raw.entity = `name:${str(raw.entityName)}`;
        delete raw.entityName;
        warnings.push("1.x entityName mapped to entity name:<name>");
      }
      if (raw.templatePath !== undefined) {
        if (raw.path !== undefined) {
          throw new Refusal("INVALID_ARGUMENT", "give path or the 1.x templatePath, not both");
        }
        raw.path = raw.templatePath;
        delete raw.templatePath;
        warnings.push("1.x templatePath mapped to path");
      }
    }

    const parsed = PREFABS_REQUEST_SCHEMA.safeParse(raw);
    if (!parsed.success) {
      const issues = parsed.error.issues.map(
        (i) => `${i.path.join(".") || "(root)"}: ${i.message}`,
      );
      throw new Refusal("INVALID_ARGUMENT", issues.join("; "));
    }
    const req = parsed.data as Raw;
    const contractAction = PREFABS_CONTRACT.actions.find((a) => a.name === action);
    const mutating = contractAction?.mutating ?? true;
    const hasConfirm = contractAction?.params.some((p) => p.key === "confirm") ?? false;

    const params: Raw = { ...req };
    if (typeof req.entity === "string") params.entity = checkRef("entity", req.entity);
    if (typeof req.member === "string") params.member = checkRef("member", req.member);
    if (typeof req.parent === "string") params.parent = checkRef("parent", req.parent);
    if (Array.isArray(req.entities))
      params.entities = checkEntities("entities", strs(req.entities));
    if (typeof req.path === "string") params.path = checkNewPrefabPath("path", req.path);
    if (typeof req.prefab === "string") params.prefab = checkPrefabResource(req.prefab);
    // A file write is a dry run unless confirm is true; the handler reads a missing key as false.
    if (hasConfirm) params.confirm = req.confirm === true;
    if (action === "moveToPrefab") params.convertTransform = req.convertTransform !== false;

    return {
      ok: true,
      action,
      target: targetOf(action, params),
      mutating,
      params,
      warnings,
    };
  } catch (e) {
    if (e instanceof Refusal) {
      return { ok: false, error: fail(action, shownTarget, e.code, e.message) };
    }
    throw e;
  }
}

/** Maps a handler answer that is not ok to the error shape (the handler's code and next win). */
function handlerFailure(action: string, target: string, r: Raw): PrefabsError {
  const code = str(r.code) || "HANDLER_ERROR";
  const message = str(r.message) || `${HANDLER} answered ${str(r.status) || "no status"}`;
  return fail(action, target, code, message, str(r.next));
}

function isOk(r: Raw): boolean {
  return str(r.status) === "ok";
}

const RESEND_CONFIRM = "Resend with confirm: true to write the file.";

/** Runs one wb_prefabs handler request end to end; never throws for a Workbench-side failure. */
export async function runPrefabs(
  client: WorkbenchClient,
  input: unknown,
): Promise<PrefabsResponse> {
  const prepared = prepareRequest(input);
  if (!prepared.ok) return prepared.error;
  const { action, target, mutating, params } = prepared;

  let r: Raw;
  try {
    r = await client.call<Raw>(HANDLER, params, {
      access: mutating ? "mutate" : "read",
      timeout: CALL_TIMEOUT_MS,
    });
  } catch (e) {
    if (e instanceof WorkbenchError) {
      const next =
        e.code === "LOST"
          ? ERROR_CODES.LOST
          : e.code === "MODAL_OPEN"
            ? ERROR_CODES.MODAL_OPEN
            : "Check the Workbench connection (wb_diagnose).";
      return fail(action, target, e.code, e.message, next);
    }
    throw e;
  }
  if (!isOk(r)) return handlerFailure(action, target, r);

  const warnings = [...prepared.warnings];
  const base = { ok: true as const, action, target, warnings };

  if (action === "getAncestor") {
    const ancestor = str(r.ancestorPath);
    return {
      ...base,
      changed: null,
      readback: { ancestor, isInstance: ancestor !== "", message: str(r.message) },
    };
  }

  if (action === "editState") {
    return {
      ...base,
      changed: null,
      readback: {
        prefabEdit: isTrue(r.prefabEdit),
        rootId: str(r.rootId),
        prefab: str(r.resourceName),
        memberCount: Number(r.memberCount ?? 0),
        message: str(r.message),
      },
    };
  }

  if (action === "addMembers" || action === "removeMembers" || action === "moveToPrefab") {
    const ids = strs(
      action === "addMembers" ? r.added : action === "removeMembers" ? r.removed : r.moved,
    );
    const member = str(params.member) || str(params.parent);
    const changed: Change[] = ids.map((id) => ({
      path: id,
      before: action === "addMembers" ? null : action === "removeMembers" ? "member" : "world",
      after:
        action === "addMembers"
          ? `child of ${member}`
          : action === "removeMembers"
            ? null
            : `in prefab of ${member}`,
    }));
    return {
      ...base,
      changed,
      readback: { count: ids.length, undoName: str(r.undoName), message: str(r.message) },
      next: "In memory and undoable (wb_undo_redo); wb_prefabs save writes the prefab file.",
    };
  }

  // createTemplate, save, clone, createChild: a file write, a dry run unless confirm.
  const file = str(r.savedPath);
  if (isTrue(r.dryRun)) {
    return {
      ...base,
      changed: null,
      readback: { dryRun: true, file, message: str(r.message) },
      next: RESEND_CONFIRM,
    };
  }
  const resourceName = str(r.resourceName);
  if (action !== "save" && resourceName === "") {
    warnings.push("the file was written but GetMetaFile gave no resource name yet");
  }
  const readback: Raw = { file, message: str(r.message) };
  if (action !== "save") readback.resourceName = resourceName;
  // createTemplate, clone and createChild each make one undo step (fix-up 2: the battery counts it).
  if (str(r.undoName)) readback.undoName = str(r.undoName);
  return {
    ...base,
    changed: [{ path: file, before: null, after: action === "save" ? "saved" : "written" }],
    readback,
    next:
      action === "createTemplate"
        ? "The entity is now an instance of the new prefab; wb_undo_redo undoes that step, the file stays."
        : action === "save"
          ? undefined
          : "The file is new; delete it by hand to undo.",
  };
}

// ── 1.x getGuid and locate (Bohemia handlers; text answers, as in 1.x) ─────────────────────────

type TextResult = { content: { type: "text"; text: string }[]; isError?: boolean };

async function runBiAction(
  client: WorkbenchClient,
  action: string,
  templatePath: string | undefined,
  searchPath: string | undefined,
): Promise<TextResult> {
  try {
    if (action === "getGuid") {
      if (!templatePath && !searchPath) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Error: Provide `templatePath` (prefab resource path) for getGuid.",
            },
          ],
          isError: true,
        };
      }

      // Bohemia's GetPrefabGUID declares one request field, `prefabPath`
      // (handed to ResourceManager.GetMetaFile), and answers { status,
      // message, guid } (AssetLibraryUtils.c:196-250). Not verified live.
      const result = await client.call<Record<string, unknown>>("GetPrefabGUID", {
        prefabPath: templatePath || searchPath,
      });
      if (isBiHandlerError(result)) {
        return handlerErrorResponse(result, client, "Error looking up prefab GUID");
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `**Prefab GUID**\n\n- **Path:** ${templatePath || searchPath}\n- **GUID:** ${result.guid || "(not found)"}\n\n_Not verified live._${formatConnectionStatus(client)}`,
          },
        ],
      };
    }

    // locate
    if (!searchPath) {
      return {
        content: [
          { type: "text" as const, text: "Error: Provide `searchPath` for the locate action." },
        ],
        isError: true,
      };
    }

    // LocatePrefabsFromPath raised the Script Authorization Required
    // prompt (FileIO.FindFiles, DEC-040 U27). wb_bi keeps it AUTH_GATED;
    // so does this path (DEC-056 ruling 14): nothing is sent until the
    // Bohemia battery opens it after an authorization.
    if ((AUTH_GATED as string) === "LocatePrefabsFromPath") {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: locate is gated: ${AUTH_GATED} raised the Script Authorization Required prompt (FileIO.FindFiles, DEC-040 U27); nothing was sent. Next: ${AUTH_GATED_NEXT}.`,
          },
        ],
        isError: true,
      };
    }
    // Bohemia's LocatePrefabsFromPath declares { selectedProject,
    // projectPath, selectedFolder } and answers { status, message,
    // prefabsPaths } (AssetLibraryUtils.c:112-192). selectedFolder is an
    // absolute folder path that must contain projectPath, so the owning
    // addon comes from LocateProject (same path, hence the same
    // spelling) first. Both calls not verified live.
    const project = await client.call<Record<string, unknown>>("LocateProject", {
      path: searchPath,
    });
    if (isBiHandlerError(project)) {
      return handlerErrorResponse(
        project,
        client,
        `Error locating prefabs in "${searchPath}" (searchPath must be an absolute folder path inside a loaded addon)`,
      );
    }

    const result = await client.call<Record<string, unknown>>("LocatePrefabsFromPath", {
      selectedProject: project.projectName,
      projectPath: project.projectPath,
      selectedFolder: searchPath,
    });
    if (isBiHandlerError(result)) {
      return handlerErrorResponse(result, client, `Error locating prefabs in "${searchPath}"`);
    }

    const prefabs = Array.isArray(result.prefabsPaths) ? result.prefabsPaths : [];
    if (prefabs.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: `**No prefabs found** in: ${searchPath}${formatConnectionStatus(client)}`,
          },
        ],
      };
    }

    const lines = [`**Prefabs in ${searchPath}** (${prefabs.length})\n`];
    for (const p of prefabs) {
      lines.push(`- ${typeof p === "string" ? p : JSON.stringify(p)}`);
    }
    lines.push("\n_Not verified live._");
    return {
      content: [{ type: "text" as const, text: lines.join("\n") + formatConnectionStatus(client) }],
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      content: [
        {
          type: "text" as const,
          text: `Error with prefab operation (${action}): ${msg}${formatConnectionStatus(client)}`,
        },
      ],
      isError: true,
    };
  }
}

/** A flat input shape for registerTool (the per-action union is checked in prepareRequest). */
export function flatInputShape(c: Contract = PREFABS_CONTRACT): z.ZodRawShape {
  const names = [...c.actions.map((a) => a.name), ...LEGACY_BI_ACTIONS] as [string, ...string[]];
  const shape: z.ZodRawShape = { action: z.enum(names) };
  for (const a of c.actions) {
    for (const p of a.params) {
      if (shape[p.key]) continue;
      let s: z.ZodTypeAny;
      if (p.type === "bool") s = z.boolean();
      else if (p.type === "int") s = z.number().int();
      else if (p.type === "float") s = z.number();
      else if (p.type === "array<string>") s = z.array(z.string());
      else s = z.string();
      shape[p.key] = (p.note ? s.describe(p.note) : s).optional();
    }
  }
  shape.entityName = z.string().optional().describe("1.x: entity name (use entity)");
  shape.templatePath = z
    .string()
    .optional()
    .describe("1.x: new .et path (use path); getGuid: prefab file path");
  shape.addonName = z.string().optional().describe("1.x: refused; the open project is the target");
  shape.searchPath = z.string().optional().describe("locate: absolute folder path in an addon");
  return shape;
}

export function registerWbPrefabs(server: McpServer, client: WorkbenchClient): void {
  server.registerTool(
    "wb_prefabs",
    { description: WB_PREFABS_DESCRIPTION, inputSchema: flatInputShape() },
    async (args: Raw) => {
      // Drop keys the caller left undefined so the strict per-action schema sees only real ones.
      const input = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined));
      const action = str(input.action);
      if (LEGACY_BI_ACTIONS.includes(action)) {
        return runBiAction(
          client,
          action,
          typeof input.templatePath === "string" ? input.templatePath : undefined,
          typeof input.searchPath === "string" ? input.searchPath : undefined,
        );
      }
      const res = await runPrefabs(client, input);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(res, null, 2) }],
        isError: !res.ok,
      };
    },
  );
}
