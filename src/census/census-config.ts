/**
 * Loaders for the hand-maintained census inputs: `universes.json`,
 * `policy.json` (main-owned, read only here), `state-matrix.json`,
 * `current-build.json`, `g4-rules.json`, `aliases.json`.
 */
import { existsSync } from "node:fs";
import { z } from "zod";
import { CensusDataError, readJson, type CensusPaths } from "./ledger-io.js";
import { aliasesFileSchema, currentBuildSchema, type Alias, type CurrentBuild } from "./schemas.js";
import {
  CONFIDENCES,
  DIMS,
  ENUMERATOR_ID_PATTERN,
  KINDS,
  MODULES,
  SHARDS,
  TIERS,
  type Kind,
  type Shard,
} from "./vocab.js";

// ── universes.json ────────────────────────────────────────────────────────────

export const enumeratorDefSchema = z
  .object({
    name: z.string().min(1),
    phase: z.string().min(1),
    inputs: z.array(z.string().min(1)),
    independence_group: z.string().min(1),
    observes_build: z.boolean(),
    generator: z.string().min(1),
    dims: z.array(z.enum(DIMS)).min(1),
    kinds: z.array(z.enum(KINDS)).min(1),
    id_prefixes: z.array(z.string().regex(/^[a-z]+:$/)).min(1),
    ref_pattern: z.string().min(1),
    provisional: z.boolean().optional(),
    confidence_max: z.enum(CONFIDENCES).optional(),
    confidence_rules: z
      .array(z.object({ ref_matches: z.string().min(1), max: z.enum(CONFIDENCES) }).strict())
      .optional(),
  })
  .strict();
export type EnumeratorDef = z.infer<typeof enumeratorDefSchema>;

export const expectedSchema = z
  .object({
    enumerator: z.string().regex(ENUMERATOR_ID_PATTERN),
    value: z.number().int().min(0).optional(),
    candidates: z.array(z.number().int().min(0)).min(2).optional(),
    at_least: z.number().int().min(0).optional(),
    source: z.string().min(1),
  })
  .strict()
  .refine(
    (e) => [e.value, e.candidates, e.at_least].filter((x) => x !== undefined).length === 1,
    "expected needs exactly one of value, candidates, at_least",
  );
export type Expected = z.infer<typeof expectedSchema>;

export const universeSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9:._-]+$/i),
    kind: z.enum(KINDS),
    what: z.string().min(1),
    dims: z.array(z.enum(DIMS)).min(1),
    leaf: z.boolean(),
    enumerators: z.array(z.string().regex(ENUMERATOR_ID_PATTERN)),
    id_prefix: z.string().min(1).optional(),
    expected: expectedSchema.optional(),
    closure: z.literal("two-independent-sources"),
  })
  .strict();
export type Universe = z.infer<typeof universeSchema>;

export const universesFileSchema = z
  .object({
    $comment: z.string().optional(),
    version: z.number().int(),
    shard_by_kind: z.record(z.enum(SHARDS)),
    enumerators: z.record(enumeratorDefSchema),
    universes: z.array(universeSchema),
    g7_empty_reasons: z.array(
      z
        .object({
          module: z.union([z.enum(MODULES), z.literal("*")]),
          kind: z.union([z.enum(KINDS), z.literal("*")]),
          why_ref: z.string().regex(/^(PLAN \d+(\.\d+)?|D\d+|U\d+|P-[A-Za-z0-9-]+|EV-.+)/),
        })
        .strict(),
    ),
  })
  .strict();
export type UniversesFile = z.infer<typeof universesFileSchema>;

function parseWith<T>(schema: z.ZodType<T>, value: unknown, name: string): T {
  const r = schema.safeParse(value);
  if (!r.success) {
    const first = r.error.issues[0];
    throw new CensusDataError(`${name}: ${first.path.join(".")}: ${first.message}`);
  }
  return r.data;
}

export function loadUniverses(paths: CensusPaths): UniversesFile {
  if (!existsSync(paths.universes)) throw new CensusDataError("universes.json is missing");
  return parseWith(universesFileSchema, readJson(paths.universes, null), "universes.json");
}

/** Shard of a kind (`core` unless `shard_by_kind` says otherwise). */
export function shardOf(universes: UniversesFile, kind: Kind): Shard {
  return universes.shard_by_kind[kind] ?? "core";
}

/** The kind universe (`kind:<kind>`) for a kind. */
export function kindUniverse(universes: UniversesFile, kind: Kind): Universe | undefined {
  return universes.universes.find((u) => u.id === `kind:${kind}`);
}

// ── policy.json (main-owned) ──────────────────────────────────────────────────

const labelsList = z.object({ labels: z.array(z.string()).optional() }).passthrough();

export const policySchema = z
  .object({
    tiers: z.array(z.enum(TIERS)),
    risk_classes: z.array(z.string()),
    weak_oracle: z.string(),
    dispositions: z.object({ terminal: z.array(z.string()) }).passthrough(),
    target_tier_by_kind: z.record(
      z.object({ target: z.enum(TIERS), why: z.string() }).passthrough(),
    ),
    risk_overrides: z.record(z.unknown()),
    execute_action: z
      .object({ allow_list: z.array(z.array(z.string())), deny_list_seed: z.array(z.string()) })
      .passthrough(),
    deny_lists: z.record(z.unknown()),
  })
  .passthrough();
export type Policy = z.infer<typeof policySchema>;

export function loadPolicy(paths: CensusPaths): Policy {
  if (!existsSync(paths.policy)) throw new CensusDataError("policy.json is missing");
  return parseWith(policySchema, readJson(paths.policy, null), "policy.json");
}

/** Target tier and override rule for a risk class, when policy names one. */
export function riskOverride(policy: Policy, risk: string): { target: string } | undefined {
  const o = policy.risk_overrides[risk];
  if (o && typeof o === "object" && "target" in o && typeof o.target === "string") {
    return { target: o.target };
  }
  return undefined;
}

export interface DenyEntry {
  /** JSON path inside policy.json, e.g. `deny_lists.never_invoked_by_any_tool.labels`. */
  where: string;
  value: string;
}

/** Every label, CLI switch and API name on a deny list (Appendix B seed in policy.json). */
export function denyEntries(policy: Policy): {
  labels: DenyEntry[];
  cli: DenyEntry[];
  api: DenyEntry[];
} {
  const labels: DenyEntry[] = [];
  const cli: DenyEntry[] = [];
  const api: DenyEntry[] = [];
  for (const v of policy.execute_action.deny_list_seed) {
    labels.push({ where: "execute_action.deny_list_seed", value: v });
  }
  for (const [name, list] of Object.entries(policy.deny_lists)) {
    const parsed = labelsList.safeParse(list);
    if (!parsed.success) continue;
    const l = parsed.data as Record<string, unknown>;
    const take = (field: string, into: DenyEntry[]): void => {
      const arr = l[field];
      if (Array.isArray(arr)) {
        for (const v of arr)
          if (typeof v === "string") into.push({ where: `deny_lists.${name}.${field}`, value: v });
      }
    };
    take("labels", labels);
    take("cli_switches", cli);
    take("api", api);
  }
  return { labels, cli, api };
}

/** Resolves a dotted JSON path inside policy.json (for `excluded-policy` references). */
export function policyPathExists(policy: Policy, path: string): boolean {
  let cur: unknown = policy;
  for (const seg of path.split(".")) {
    if (cur === null || typeof cur !== "object" || !(seg in (cur as object))) return false;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return true;
}

// ── state-matrix.json ─────────────────────────────────────────────────────────

export const stateMatrixSchema = z
  .object({
    $comment: z.string().optional(),
    version: z.number().int(),
    axes: z.record(
      z.union([z.array(z.string().min(1)).min(1), z.object({ from_kind: z.enum(KINDS) }).strict()]),
    ),
    applies: z.array(
      z
        .object({
          kind: z.enum(KINDS),
          module: z.enum(MODULES).optional(),
          axes: z.array(z.string().min(1)).min(1),
          why: z.string().min(1),
        })
        .strict(),
    ),
  })
  .strict();
export type StateMatrix = z.infer<typeof stateMatrixSchema>;

export function loadStateMatrix(paths: CensusPaths): StateMatrix {
  if (!existsSync(paths.stateMatrix)) throw new CensusDataError("state-matrix.json is missing");
  return parseWith(stateMatrixSchema, readJson(paths.stateMatrix, null), "state-matrix.json");
}

// ── current-build.json ────────────────────────────────────────────────────────

export function loadCurrentBuild(paths: CensusPaths): CurrentBuild {
  if (!existsSync(paths.currentBuild)) throw new CensusDataError("current-build.json is missing");
  return parseWith(currentBuildSchema, readJson(paths.currentBuild, null), "current-build.json");
}

// ── g4-rules.json ─────────────────────────────────────────────────────────────

export const g4RulesSchema = z
  .object({
    $comment: z.string().optional(),
    version: z.number().int(),
    rules: z.array(
      z
        .object({
          id: z.string().min(1),
          controlType: z.string().min(1),
          namePattern: z.string().min(1).optional(),
          why: z.string().min(1),
        })
        .strict(),
    ),
  })
  .strict();
export type G4Rules = z.infer<typeof g4RulesSchema>;

export function loadG4Rules(paths: CensusPaths): G4Rules {
  return parseWith(
    g4RulesSchema,
    readJson(paths.g4Rules, { version: 1, rules: [] }),
    "g4-rules.json",
  );
}

// ── aliases.json ──────────────────────────────────────────────────────────────

export function loadAliases(paths: CensusPaths): Alias[] {
  const file = parseWith(
    aliasesFileSchema,
    readJson(paths.aliases, { aliases: [] }),
    "aliases.json",
  );
  return file.aliases;
}
