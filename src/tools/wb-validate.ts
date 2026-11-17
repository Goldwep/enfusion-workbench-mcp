/**
 * `wb_validate`: Bohemia's material and texture validators, run as data, through EMCP_WB_Validate
 * (wave W2, phase5-w2-spec.md section 2.3, ruling OD-7; closes KD-011).
 *
 *   material     read: MaterialValidatorUtils' five checks on an .emat (project or game file)
 *   texture      read: the TextureTypes checks per configuration with the Ignore op
 *   fixTexture   write: the same checks with ReportAndFix, then the meta is saved; a dry run
 *                until `confirm: true`; `rebuild` rebuilds the resource after the save
 *
 * The 1.x route (the BI MaterialValidator and TextureValidator NET handlers) is gone: material had
 * no verdict (KD-011) and texture only printed. The 1.x inputs still work: `action` material or
 * texture with `path` as a project-relative path, a `{GUID}path` resource name, or an absolute path
 * under the configured project, workshop or core root (turned into a root-relative path here
 * before anything is sent; any other absolute path is refused).
 *
 * The request is checked against the contract's per-action schema before anything is sent.
 * Nothing here names a sandbox or a project. Registered by src/server.ts.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { Config } from "../config.js";
import type { WorkbenchClient } from "../workbench/client.js";
import { loadContract, type Contract } from "../manifest/contract.js";
import { buildRequestSchema, checkedDescription } from "../manifest/generate.js";
import {
  ERROR_CODES,
  VocabularyError,
  checkRelativePath,
  type ActionError,
  type ActionOk,
  type Change,
  type ErrorCode,
} from "../manifest/vocabulary.js";
import { isPathInsideRoot } from "../utils/path-guard.js";
import { codeOfClientError } from "./wb-module.js";

export const HANDLER = "EMCP_WB_Validate";

/** contracts/ sits two levels above both src/tools and dist/tools. */
export const CONTRACT_FILE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "contracts",
  `${HANDLER}.json`,
);

export const VALIDATE_CONTRACT: Contract = loadContract(CONTRACT_FILE);
export const VALIDATE_REQUEST_SCHEMA = buildRequestSchema(VALIDATE_CONTRACT);

/** The description generated from the contract (at most 400 chars; throws when over). */
export function wbValidateDescription(): string {
  return checkedDescription(VALIDATE_CONTRACT);
}

/** The handler's actions, as the contract names them. */
export const HANDLER_ACTIONS: readonly string[] = VALIDATE_CONTRACT.actions.map((a) => a.name);

const MUTATING = new Set(VALIDATE_CONTRACT.actions.filter((a) => a.mutating).map((a) => a.name));

const READ_TIMEOUT_MS = 30_000;
/** fixTexture can rebuild the resource and wait for it. */
const WRITE_TIMEOUT_MS = 60_000;

/**
 * Under the Ignore op CheckUnnecessarySettingInPc and CheckWrongPropertyValues always answer
 * NothingChanged (phase5-w2-spec.md section 0): only Configurations, Ancestors and SuspiciousNonPc
 * give a verdict in a texture read.
 */
export const IGNORE_NOTE =
  "texture runs the checks with the Ignore op: CheckUnnecessarySettingInPc and CheckWrongPropertyValues always answer NothingChanged, so only CheckConfigurations, CheckAncestors and CheckSuspiciousNonPcSetting give a verdict";

type Raw = Record<string, unknown>;

export type ValidateError = ActionError & { readback?: unknown };
export type ValidateResponse = ActionOk | ValidateError;

/** The client surface this tool needs (a fake in tests). */
export type ValidateClient = Pick<WorkbenchClient, "call">;

/** The roots an absolute 1.x path may sit under, from the server config. */
export type RootConfig = Pick<Config, "projectPath" | "workshopPath" | "corePath" | "defaultMod">;

const KNOWN_CODES: ReadonlySet<string> = new Set(Object.keys(ERROR_CODES));

function fail(
  action: string,
  target: string,
  code: ErrorCode,
  message: string,
  next?: string,
): ValidateError {
  return {
    ok: false,
    action,
    target,
    code,
    message,
    next: next || ERROR_CODES[code],
    warnings: [],
  };
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** True for 1, "1", true and "true": Enforce JSON writes booleans as 1/0 (P3-3 gate 2). */
function truthy(v: unknown): boolean {
  return v === true || v === 1 || v === "1" || v === "true";
}

function strs(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x)) : [];
}

// ── Path ──────────────────────────────────────────────────────────────────────

const GUID_PREFIX = /^(\{[0-9A-Fa-f]{16}\})(.*)$/;
const ABSOLUTE = /^([A-Za-z]:[\\/]|[\\/])/;

/**
 * The path to send. A relative path or a `{GUID}path` name passes the project-relative check
 * (no drive, no `..`). An absolute path (a 1.x input) must sit under a configured root and is
 * sent relative to it; `projectOnly` allows the project root alone (a write). Throws
 * VocabularyError.
 */
export function toResourcePath(raw: string, config?: RootConfig, projectOnly = false): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("-")) {
    throw new VocabularyError(
      "INVALID_ARGUMENT",
      "Invalid path: must not start with '-' (flag-smuggle guard)",
    );
  }
  const m = GUID_PREFIX.exec(trimmed);
  if (m) return `${m[1]}${checkRelativePath(m[2])}`;
  if (!ABSOLUTE.test(trimmed) && !isAbsolute(trimmed)) return checkRelativePath(trimmed);

  const roots: string[] = [];
  const project = config?.projectPath;
  if (project) {
    if (config?.defaultMod) roots.push(join(project, config.defaultMod));
    roots.push(project);
  }
  if (!projectOnly) {
    if (config?.workshopPath) roots.push(config.workshopPath);
    if (config?.corePath) roots.push(config.corePath);
  }
  const abs = resolve(trimmed);
  for (const root of roots) {
    if (!isPathInsideRoot(abs, root)) continue;
    const rel = relative(resolve(root), abs).replace(/\\/g, "/");
    if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) continue;
    return checkRelativePath(rel);
  }
  throw new VocabularyError(
    "ABSOLUTE_PATH",
    projectOnly
      ? `absolute path refused: ${raw} is not under the configured project root`
      : `absolute path refused: ${raw} is not under the configured project, workshop or core root`,
  );
}

// ── Request checks ────────────────────────────────────────────────────────────

function targetOf(p: Raw): string {
  const path = str(p.path);
  return path ? `path:${path}` : "path:";
}

/** The one-sentence refusal text for an input that fails a check, or undefined. */
function checkValues(action: string, p: Raw): string | undefined {
  if (typeof p.typeName === "string" && p.typeName.trim() === "") {
    return "typeName is empty (omit it to detect the type from the file name; or co, nohq, fnt, unspecified)";
  }
  if (action === "material" && !str(p.path).toLowerCase().endsWith(".emat")) {
    return `material validates an .emat, got ${str(p.path)}`;
  }
  return undefined;
}

/** A checked request: what is sent to the handler, or the refusal raised before sending. */
export type Prepared =
  | { ok: true; action: string; target: string; mutating: boolean; params: Raw }
  | { ok: false; error: ValidateError };

/** Validates a request. Nothing is sent when this refuses. */
export function prepareRequest(input: unknown, config?: RootConfig): Prepared {
  const raw = (input ?? {}) as Raw;
  const action = str(raw.action);
  const target = targetOf(raw);
  if (!HANDLER_ACTIONS.includes(action)) {
    return {
      ok: false,
      error: fail(
        action,
        target,
        "INVALID_ARGUMENT",
        `unknown action '${action}'; one of ${HANDLER_ACTIONS.join(", ")}`,
      ),
    };
  }
  const parsed = VALIDATE_REQUEST_SCHEMA.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    return { ok: false, error: fail(action, target, "INVALID_ARGUMENT", issues.join("; ")) };
  }
  const req = parsed.data as Raw;
  const mutating = MUTATING.has(action);
  let path: string;
  try {
    path = toResourcePath(str(req.path), config, mutating);
  } catch (e) {
    if (e instanceof VocabularyError) {
      return { ok: false, error: fail(action, target, e.code, e.message) };
    }
    throw e;
  }
  const why = checkValues(action, { ...req, path });
  if (why) return { ok: false, error: fail(action, target, "INVALID_ARGUMENT", why) };
  const params: Raw = { ...req, path };
  // A write is a dry run unless confirm is true: send the flag explicitly.
  if (mutating) params.confirm = req.confirm === true;
  return { ok: true, action, target: `path:${path}`, mutating, params };
}

// ── Handler answer ────────────────────────────────────────────────────────────

/** A handler refusal or error as a ValidateError, else null. */
function handlerFailure(action: string, target: string, r: Raw): ValidateError | null {
  const status = str(r.status);
  if (status === "ok") return null;
  if (status === "refused" || status === "error") {
    const raw = str(r.code);
    const fallback: ErrorCode = status === "error" ? "HANDLER_ERROR" : "INVALID_ARGUMENT";
    const code = (KNOWN_CODES.has(raw) ? raw : fallback) as ErrorCode;
    const e = fail(
      action,
      target,
      code,
      str(r.message) || `the handler answered ${status}`,
      str(r.next) || undefined,
    );
    if (raw !== "" && !KNOWN_CODES.has(raw)) {
      e.warnings.push(`the handler answered an unknown code '${raw}'`);
    }
    return e;
  }
  return fail(action, target, "UNREACHABLE", `the handler answered status '${status}'`);
}

async function send(
  client: ValidateClient,
  params: Raw,
  mutating: boolean,
  action: string,
  target: string,
): Promise<{ r: Raw } | { error: ValidateError }> {
  try {
    const r = await client.call<Raw>(HANDLER, params, {
      access: mutating ? "mutate" : "read",
      timeout: mutating ? WRITE_TIMEOUT_MS : READ_TIMEOUT_MS,
    });
    const f = handlerFailure(action, target, r);
    return f ? { error: f } : { r };
  } catch (e) {
    const c = codeOfClientError(e);
    const f = fail(action, target, c.code, c.message);
    if (c.code === "LOST" && mutating) {
      f.next =
        "The call was lost and is never retried; read back with wb_validate texture and wb_meta get first.";
    }
    return { error: f };
  }
}

// ── Parsing ───────────────────────────────────────────────────────────────────

export interface MaterialReport {
  /** The BI severity as the handler wrote it; null for a skipped note. */
  severity: number | null;
  text: string;
  skipped: boolean;
}

/** material reports "<severity>: <text>", or "skipped: <why>" when CheckTextures could not run. */
export function parseReports(lines: string[]): MaterialReport[] {
  return lines.map((line) => {
    const colon = line.indexOf(":");
    const head = colon < 0 ? "" : line.slice(0, colon);
    const text = colon < 0 ? line : line.slice(colon + 1).trim();
    if (head === "skipped") return { severity: null, text, skipped: true };
    const n = Number(head);
    return {
      severity: head !== "" && Number.isInteger(n) ? n : null,
      text,
      skipped: false,
    };
  });
}

export interface CheckRow {
  check: string;
  result: string;
}

/** texture checks "Check=Result" (Result is a TextureCheckResult name, or skipped). */
export function parseChecks(lines: string[]): CheckRow[] {
  return lines.map((line) => {
    const eq = line.indexOf("=");
    return eq < 0
      ? { check: line, result: "" }
      : { check: line.slice(0, eq), result: line.slice(eq + 1) };
  });
}

/** One Change per "config.var=value" key whose value differs; a key on one side only is null on the other. */
export function diffLines(before: string[], after: string[]): Change[] {
  const split = (lines: string[]): Map<string, string> =>
    new Map(
      lines.map((l) => {
        const eq = l.indexOf("=");
        return (eq < 0 ? [l, ""] : [l.slice(0, eq), l.slice(eq + 1)]) as [string, string];
      }),
    );
  const b = split(before);
  const a = split(after);
  const out: Change[] = [];
  for (const k of new Set([...b.keys(), ...a.keys()])) {
    const bv = b.has(k) ? b.get(k)! : null;
    const av = a.has(k) ? a.get(k)! : null;
    if (bv !== av) out.push({ path: k, before: bv, after: av });
  }
  return out;
}

// ── Shaping ───────────────────────────────────────────────────────────────────

function shapeOk(action: string, target: string, params: Raw, r: Raw): ActionOk {
  const warnings: string[] = [];
  let changed: Change[] | null = null;
  let readback: Raw;
  let next: string | undefined;
  switch (action) {
    case "material": {
      const reports = parseReports(strs(r.reports));
      readback = {
        severity: typeof r.severity === "number" ? r.severity : 0,
        reports,
        textures: strs(r.textures),
      };
      for (const rep of reports) {
        if (rep.skipped) warnings.push(rep.text);
      }
      if (reports.length === 0) next = "No findings: every one of the five checks passed.";
      break;
    }
    case "texture": {
      readback = {
        textureType: str(r.textureType),
        checks: parseChecks(strs(r.checks)),
        fatal: truthy(r.fatal),
      };
      warnings.push(IGNORE_NOTE);
      next = "wb_validate fixTexture applies Bohemia's fixes (a dry run until confirm: true)";
      break;
    }
    default: {
      // fixTexture
      const dry = truthy(r.dryRun);
      const checks = parseChecks(strs(r.checks));
      const before = strs(r.before);
      const after = strs(r.after);
      const saved = truthy(r.saved);
      const base = { textureType: str(r.textureType), checks, fatal: truthy(r.fatal) };
      if (dry) {
        readback = { ...base, dryRun: true, saved: false, current: before };
        warnings.push(IGNORE_NOTE);
        next = "Resend with confirm: true to run the checks with ReportAndFix and save the meta.";
      } else {
        const rebuilt = truthy(r.rebuilt);
        readback = {
          ...base,
          dryRun: false,
          saved,
          rebuilt,
          before,
          after,
          message: str(r.message),
        };
        if (saved) {
          changed = diffLines(before, after);
          next = "The inverse is wb_meta set (or setAncestor) with each 'before' value.";
          if (params.rebuild === true && !rebuilt) {
            warnings.push("the rebuild was asked for but WaitForFile did not report it finished");
          }
        } else {
          next = "Nothing needed fixing; the meta was not written.";
          if (params.rebuild === true) {
            warnings.push("rebuild was asked for but nothing was saved, so nothing was rebuilt");
          }
        }
      }
    }
  }
  const ok: ActionOk = { ok: true, action, target, changed, readback, warnings };
  if (next) ok.next = next;
  return ok;
}

// ── Entry point ───────────────────────────────────────────────────────────────

/** Runs one wb_validate request end to end; never throws for a Workbench-side failure. */
export async function runValidate(
  client: ValidateClient,
  input: unknown,
  config?: RootConfig,
): Promise<ValidateResponse> {
  const prepared = prepareRequest(input, config);
  if (!prepared.ok) return prepared.error;
  const { action, target, mutating, params } = prepared;
  const s = await send(client, params, mutating, action, target);
  if ("error" in s) return s.error;
  return shapeOk(action, target, params, s.r);
}

export function toToolResult(r: ValidateResponse) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(r, null, 2) }],
    ...(r.ok ? {} : { isError: true as const }),
  };
}

// ── Registration ──────────────────────────────────────────────────────────────

/** A flat input shape for registerTool (the per-action union is checked in prepareRequest). */
export function flatInputShape(c: Contract = VALIDATE_CONTRACT): z.ZodRawShape {
  const names = c.actions.map((a) => a.name) as [string, ...string[]];
  const shape: z.ZodRawShape = { action: z.enum(names) };
  for (const a of c.actions) {
    for (const p of a.params) {
      if (shape[p.key]) continue;
      let s: z.ZodTypeAny;
      if (p.type === "bool") s = z.boolean();
      else if (p.type === "int") s = z.number().int();
      else if (p.type === "float") s = z.number();
      else s = z.string();
      shape[p.key] = (p.note ? s.describe(p.note) : s).optional();
    }
  }
  return shape;
}

/** `config` is optional: with it, 1.x absolute paths under its roots are turned into relative ones. */
export function registerWbValidate(
  server: McpServer,
  client: WorkbenchClient,
  config?: Config,
): void {
  server.registerTool(
    "wb_validate",
    {
      description: wbValidateDescription(),
      inputSchema: flatInputShape(),
      annotations: {
        title: "Validate material or texture",
        readOnlyHint: false,
        // fixTexture rewrites a texture's .meta (a dry run until confirm); material and texture read.
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args: Raw) => {
      // Drop keys the caller left undefined so the strict per-action schema sees only real ones.
      const input = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined));
      return toToolResult(await runValidate(client, input, config));
    },
  );
}
