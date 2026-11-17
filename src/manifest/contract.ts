import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

/**
 * Per-action handler contracts (docs/v2/design/phase3-tool-surface.md section 5).
 * The zod schema below mirrors contracts/_schema/contract.schema.json; a test keeps the two in step.
 */

export const ENFORCE_TYPES = [
  "string",
  "bool",
  "int",
  "float",
  "array<string>",
  "array<int>",
] as const;
export type EnforceType = (typeof ENFORCE_TYPES)[number];

export const SUMMARY_MAX = 80;
export const NOTE_MAX = 40;

const KEY = z.string().regex(/^[a-zA-Z][A-Za-z0-9_]*$/);

const PARAM_SCHEMA = z
  .object({
    key: KEY,
    type: z.enum(ENFORCE_TYPES),
    required: z.boolean(),
    note: z.string().max(NOTE_MAX).optional(),
  })
  .strict();

const RESPONSE_FIELD_SCHEMA = z
  .object({
    key: KEY,
    type: z.enum(ENFORCE_TYPES),
    note: z.string().max(NOTE_MAX).optional(),
  })
  .strict();

const ACTION_SCHEMA = z
  .object({
    // underscores: the 1.x terrain_* tools keep their snake_case actions (navmesh_status)
    name: z.string().regex(/^[a-z][A-Za-z0-9_]*$/),
    summary: z.string().min(1).max(SUMMARY_MAX),
    mutating: z.boolean(),
    projectOnly: z.boolean(),
    refuses: z.string().max(160).optional(),
    params: z.array(PARAM_SCHEMA),
    response: z.array(RESPONSE_FIELD_SCHEMA),
    paging: z.boolean(),
  })
  .strict();

export const CONTRACT_SCHEMA = z
  .object({
    $schema: z.string().optional(),
    handler: z.string().regex(/^[A-Z][A-Za-z0-9_]*$/),
    tool: z.string().regex(/^[a-z][a-z0-9_]*$/),
    purpose: z.string().min(1).max(160),
    source: z.string().min(1),
    request: z.array(KEY),
    response: z.array(KEY),
    actions: z.array(ACTION_SCHEMA).min(1),
  })
  .strict();

export type ContractParam = z.infer<typeof PARAM_SCHEMA>;
export type ContractResponseField = z.infer<typeof RESPONSE_FIELD_SCHEMA>;
export type ContractAction = z.infer<typeof ACTION_SCHEMA>;
export type Contract = z.infer<typeof CONTRACT_SCHEMA>;

/** Thrown for a contract that fails the schema or a cross-field rule; the message names the file. */
export class ContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContractError";
  }
}

function duplicates(values: string[]): string[] {
  return values.filter((v, i) => values.indexOf(v) !== i);
}

/**
 * Cross-field rules the JSON schema cannot state: unique names, `action` reserved as the
 * discriminator, every per-action key inside the handler's flat request/response struct.
 * Returns the violations (empty = valid).
 */
export function checkContract(c: Contract): string[] {
  const errors: string[] = [];
  const dupReq = duplicates(c.request);
  if (dupReq.length) errors.push(`request lists ${dupReq.join(", ")} twice`);
  const dupResp = duplicates(c.response);
  if (dupResp.length) errors.push(`response lists ${dupResp.join(", ")} twice`);
  if (!c.request.includes("action"))
    errors.push("request must list the discriminator key 'action'");
  const dupActions = duplicates(c.actions.map((a) => a.name));
  if (dupActions.length) errors.push(`action ${dupActions.join(", ")} declared twice`);

  for (const a of c.actions) {
    const keys = a.params.map((p) => p.key);
    if (keys.includes("action"))
      errors.push(`${a.name}: 'action' is the discriminator, not a param`);
    const dup = duplicates(keys);
    if (dup.length) errors.push(`${a.name}: param ${dup.join(", ")} twice`);
    for (const k of keys) {
      if (!c.request.includes(k))
        errors.push(`${a.name}: param ${k} is not in the handler request struct`);
    }
    for (const r of a.response) {
      if (!c.response.includes(r.key)) {
        errors.push(`${a.name}: response ${r.key} is not in the handler response struct`);
      }
    }
    if (a.projectOnly && !a.mutating) errors.push(`${a.name}: projectOnly without mutating`);
  }
  return errors;
}

/** Parses and checks one contract object; throws ContractError naming `origin`. */
export function parseContract(raw: unknown, origin: string): Contract {
  const parsed = CONTRACT_SCHEMA.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    throw new ContractError(`${origin}: ${issues.join("; ")}`);
  }
  const errors = checkContract(parsed.data);
  if (errors.length) throw new ContractError(`${origin}: ${errors.join("; ")}`);
  return parsed.data;
}

export function loadContract(file: string): Contract {
  return parseContract(JSON.parse(readFileSync(file, "utf-8")), file);
}

/**
 * Phase 3 rule: one handler = one tool, so the per-contract generators are per tool.
 * Throws ContractError when two contracts name the same tool or handler.
 */
export function checkUniqueTools(contracts: Contract[]): Contract[] {
  const tools = duplicates(contracts.map((c) => c.tool));
  const handlers = duplicates(contracts.map((c) => c.handler));
  if (tools.length || handlers.length) {
    throw new ContractError(
      `one handler = one tool in Phase 3; repeated tool ${tools.join(", ") || "-"}, handler ${handlers.join(", ") || "-"}`,
    );
  }
  return contracts;
}

/** Every `*.json` directly under `dir` (the `_schema` folder is skipped), sorted by file name. */
export function loadContracts(dir: string): Contract[] {
  return checkUniqueTools(loadContractFiles(dir));
}

function loadContractFiles(dir: string): Contract[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".json"))
    .map((e) => e.name)
    .sort()
    .map((name) => loadContract(join(dir, name)));
}

/** RegV("key") names in declaration order within one class body of an Enforce source. */
export function regVKeys(enforceSource: string, className: string): string[] {
  const start = enforceSource.search(new RegExp(`^class ${className}\\b`, "m"));
  if (start < 0) return [];
  const next = enforceSource.indexOf("\nclass ", start + 1);
  const body = enforceSource.slice(start, next < 0 ? undefined : next);
  return [...body.matchAll(/RegV\("([^"]+)"\)/g)].map((m) => m[1]);
}
