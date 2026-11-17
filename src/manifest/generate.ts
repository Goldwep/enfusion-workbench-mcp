import { z } from "zod";
import type { Contract, ContractAction, EnforceType } from "./contract.js";

/**
 * Generators driven by a contract (phase3-tool-surface.md section 5): the zod discriminated
 * union per tool, TypeScript request/response types, per-action linter rows, and the tool
 * description (one purpose sentence plus `name: summary` lines, at most 400 chars).
 */

export const DESCRIPTION_MAX = 400;

function zodFor(type: EnforceType): z.ZodTypeAny {
  switch (type) {
    case "string":
      return z.string();
    case "bool":
      return z.boolean();
    case "int":
      return z.number().int();
    case "float":
      return z.number();
    case "array<string>":
      return z.array(z.string());
    case "array<int>":
      return z.array(z.number().int());
  }
}

function tsFor(type: EnforceType): string {
  switch (type) {
    case "string":
      return "string";
    case "bool":
      return "boolean";
    case "int":
    case "float":
      return "number";
    case "array<string>":
      return "string[]";
    case "array<int>":
      return "number[]";
  }
}

function actionObject(a: ContractAction): z.AnyZodObject {
  const shape: Record<string, z.ZodTypeAny> = { action: z.literal(a.name) };
  for (const p of a.params) {
    let s = zodFor(p.type);
    if (p.note) s = s.describe(p.note);
    shape[p.key] = p.required ? s : s.optional();
  }
  return z.object(shape).strict();
}

/** One strict object per action, discriminated on `action`. Unknown keys are rejected per action. */
export function buildRequestSchema(
  c: Contract,
): z.ZodDiscriminatedUnion<"action", z.AnyZodObject[]> {
  const options = c.actions.map(actionObject);
  return z.discriminatedUnion("action", options as [z.AnyZodObject, ...z.AnyZodObject[]]);
}

function pascal(handler: string): string {
  return handler.replace(/(^|_)([A-Za-z0-9])/g, (_m, _u, ch: string) => ch.toUpperCase());
}

/** TypeScript source declaring `<Name>Request` (a union per action) and `<Name>Response`. */
export function emitTypes(c: Contract): string {
  const name = pascal(c.handler);
  const variants = c.actions.map((a) => {
    const fields = [`action: "${a.name}"`];
    for (const p of a.params) fields.push(`${p.key}${p.required ? "" : "?"}: ${tsFor(p.type)}`);
    return `  | { ${fields.join("; ")} }`;
  });
  const respTypes = new Map<string, string>();
  for (const a of c.actions) for (const r of a.response) respTypes.set(r.key, tsFor(r.type));
  const respFields = c.response.map((k) => `  ${k}?: ${respTypes.get(k) ?? "unknown"};`);
  return [
    `// Generated from contracts/${c.handler}.json by src/manifest/generate.ts. Do not edit.`,
    `export type ${name}Request =`,
    `${variants.join("\n")};`,
    "",
    `export interface ${name}Response {`,
    ...respFields,
    "}",
    "",
  ].join("\n");
}

export interface LinterRow {
  handler: string;
  action: string;
  required: string[];
  allowed: string[];
  response: string[];
  mutating: boolean;
  projectOnly: boolean;
}

/** Per-action key rows for scripts/enforce-lint.ts (the union alone cannot be checked per action). */
export function linterRows(c: Contract): LinterRow[] {
  return c.actions.map((a) => ({
    handler: c.handler,
    action: a.name,
    required: ["action", ...a.params.filter((p) => p.required).map((p) => p.key)],
    allowed: ["action", ...a.params.map((p) => p.key)],
    response: a.response.map((r) => r.key),
    mutating: a.mutating,
    projectOnly: a.projectOnly,
  }));
}

/** Purpose sentence, then read actions, then mutating actions, one `name: summary` line each. */
export function buildDescription(c: Contract): string {
  const line = (a: ContractAction) => `${a.name}: ${a.summary}`;
  const reads = c.actions.filter((a) => !a.mutating);
  const muts = c.actions.filter((a) => a.mutating);
  const parts = [c.purpose];
  if (reads.length) parts.push("Read:", ...reads.map(line));
  if (muts.length) parts.push("Mutating:", ...muts.map(line));
  return parts.join("\n");
}

/** buildDescription, throwing when the result is over DESCRIPTION_MAX chars. */
export function checkedDescription(c: Contract): string {
  const d = buildDescription(c);
  if (d.length > DESCRIPTION_MAX) {
    throw new Error(`${c.tool}: description is ${d.length} chars, budget ${DESCRIPTION_MAX}`);
  }
  return d;
}
