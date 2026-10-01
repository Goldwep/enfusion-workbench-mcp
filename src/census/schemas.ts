/**
 * zod schemas for every census record (main ruling 1: zod is the validator;
 * `data/census/schema/*.schema.json` is the published contract, kept equal by
 * `tests/census/schema-parity.test.ts`).
 *
 * Observation lines are strict: a field that is not listed here (`tier`,
 * `disposition`, `mcp`, `enumerator`, ...) makes the line invalid, so an
 * enumerator cannot claim anything that only state may say (plan 4.1).
 */
import { z } from "zod";
import {
  BRANCHES,
  CONFIDENCES,
  DIMS,
  DISPOSITION_KINDS,
  ENUMERATOR_ID_PATTERN,
  EVIDENCE_ID_PATTERN,
  KINDS,
  MCP_ROLES,
  MODALS,
  MODULES,
  ORACLES,
  ORIGIN_PATTERN,
  PATCH_OPS,
  PATCH_WRITERS,
  PATH_KINDS,
  PATH_STATUSES,
  PROBE_ID_PATTERN,
  PROBE_OPS,
  RECON_COVERAGES,
  RISKS,
  SHARDS,
  STATUSES,
  TARGET_SOURCES,
  TEST_KINDS,
  TIERS,
  VERDICTS,
} from "./vocab.js";

const nonEmpty = z.string().min(1);

// ── Shared pieces ─────────────────────────────────────────────────────────────

/**
 * Identity components of an observation (plan 4.4). Which fields a kind needs
 * is checked by `deriveId` in `ids.ts`; this schema only closes the set.
 */
export const keySchema = z
  .object({
    class: nonEmpty.optional(),
    method: nonEmpty.optional(),
    arity: z.number().int().min(0).optional(),
    member: nonEmpty.optional(),
    attr: nonEmpty.optional(),
    button: nonEmpty.optional(),
    cli: nonEmpty.optional(),
    native: nonEmpty.optional(),
    handler: nonEmpty.optional(),
    req: nonEmpty.optional(),
    resp: nonEmpty.optional(),
    switch: nonEmpty.optional(),
    path: z.array(nonEmpty).min(1).optional(),
    object_name: nonEmpty.optional(),
    ext: nonEmpty.optional(),
    section: nonEmpty.optional(),
    key: nonEmpty.optional(),
    tool: nonEmpty.optional(),
    action: nonEmpty.optional(),
    name: nonEmpty.optional(),
  })
  .strict();
export type ObservationKey = z.infer<typeof keySchema>;

/** Reference to another row by identity, resolved to an id by `build.ts`. */
export const parentKeySchema = z
  .object({
    dim: z.enum(DIMS),
    kind: z.enum(KINDS),
    module: z.enum(MODULES),
    key: keySchema,
  })
  .strict();
export type ParentKey = z.infer<typeof parentKeySchema>;

/** One combination of the declared state matrix (plan 4.3 `observed_states[]`). */
export const observedStateSchema = z
  .object({
    mode: z.enum(["edit", "play", "prefab-edit"]).optional(),
    selection: z
      .enum(["none", "entity", "prefab-instance", "shape", "terrain", "layer", "folder", "multi"])
      .optional(),
    resource_type: nonEmpty.optional(),
    world_type: z.enum(["with-terrain", "without-terrain"]).optional(),
    script_debug: z.enum(["on", "off"]).optional(),
  })
  .strict();
export type ObservedState = z.infer<typeof observedStateSchema>;

export const locatorSchema = z
  .object({
    automationId: nonEmpty.optional(),
    controlType: nonEmpty.optional(),
    windowClass: nonEmpty.optional(),
    menuPath: z.array(nonEmpty).min(1).optional(),
  })
  .strict();

// ── Observations ──────────────────────────────────────────────────────────────

/** First line of every observation file. */
export const observationHeaderSchema = z
  .object({
    $header: z.literal(1),
    enumerator: z.string().regex(ENUMERATOR_ID_PATTERN),
    build: nonEmpty,
    generator: nonEmpty,
    provisional: z.boolean(),
    row_count: z.number().int().min(0),
    branch: z.enum(BRANCHES).optional(),
    ui_language: nonEmpty.optional(),
    inputs: z
      .array(z.object({ path: nonEmpty, sha256: z.string().regex(/^[0-9a-f]{64}$/) }).strict())
      .optional(),
  })
  .strict();
export type ObservationHeader = z.infer<typeof observationHeaderSchema>;

/** One observation line (every line after the header). */
export const observationSchema = z
  .object({
    id: nonEmpty.optional(),
    dim: z.enum(DIMS),
    kind: z.enum(KINDS),
    module: z.enum(MODULES),
    key: keySchema,
    parent_key: parentKeySchema.nullable().optional(),
    label: nonEmpty.optional(),
    label_raw: nonEmpty.optional(),
    object_name: nonEmpty.optional(),
    class_name: nonEmpty.optional(),
    signature: nonEmpty.optional(),
    shortcut_default: nonEmpty.optional(),
    what: nonEmpty.optional(),
    risk_hint: z.enum(RISKS).optional(),
    risk_open_hint: z.enum(RISKS).optional(),
    risk_commit_hint: z.enum(RISKS).optional(),
    origin: z.string().regex(ORIGIN_PATTERN),
    aggregate: z.boolean().optional(),
    ref: nonEmpty,
    quote: nonEmpty.optional(),
    confidence: z.enum(CONFIDENCES),
    children_count: z.number().int().min(0).optional(),
    observed_state: observedStateSchema.optional(),
    locator: locatorSchema.optional(),
    modal: z.enum(MODALS).optional(),
    paths_proposed: z
      .array(z.object({ path: z.enum(PATH_KINDS), reason: nonEmpty.optional() }).strict())
      .optional(),
    covers_proposed: z.array(nonEmpty).optional(),
    control_type: nonEmpty.optional(),
    dismissed_by: nonEmpty.optional(),
    unverified: z.array(nonEmpty).optional(),
    recon_coverage: z.enum(RECON_COVERAGES).optional(),
  })
  .strict();
export type Observation = z.infer<typeof observationSchema>;

// ── Ledger rows ───────────────────────────────────────────────────────────────

export const sourceSchema = z
  .object({
    enumerator: z.string().regex(ENUMERATOR_ID_PATTERN),
    build: nonEmpty,
    ref: nonEmpty,
    quote: nonEmpty.optional(),
    confidence: z.enum(CONFIDENCES),
    observed_state: observedStateSchema.optional(),
  })
  .strict();
export type Source = z.infer<typeof sourceSchema>;

export const rowPathSchema = z
  .object({
    path: z.enum(PATH_KINDS),
    status: z.enum(PATH_STATUSES),
    evidence: z.string().regex(EVIDENCE_ID_PATTERN).optional(),
    reason: nonEmpty.optional(),
  })
  .strict();
export type RowPath = z.infer<typeof rowPathSchema>;

export const dispositionSchema = z
  .object({
    kind: z.enum(DISPOSITION_KINDS),
    ref: nonEmpty.optional(),
    why: nonEmpty,
    evidence: z.string().regex(EVIDENCE_ID_PATTERN),
  })
  .strict();
export type Disposition = z.infer<typeof dispositionSchema>;

export const mcpLinkSchema = z
  .object({
    action: z.string().regex(/^mcp:action\/[a-z0-9_]+\.[A-Za-z0-9_-]+$/),
    role: z.enum(MCP_ROLES),
  })
  .strict();
export type McpLink = z.infer<typeof mcpLinkSchema>;

export const testRefSchema = z
  .object({
    id: nonEmpty,
    file: nonEmpty,
    kind: z.enum(TEST_KINDS),
  })
  .strict();
export type TestRef = z.infer<typeof testRefSchema>;

export const unverifiedSchema = z
  .object({
    claim: nonEmpty,
    cleared_by: z.string().regex(EVIDENCE_ID_PATTERN).optional(),
  })
  .strict();

export const tierEvidenceSchema = z
  .object({
    tier: z.enum(TIERS),
    ref: nonEmpty,
  })
  .strict();

/** One derived ledger row (plan 4.3). Written only by `build.ts`. */
export const rowSchema = z
  .object({
    id: nonEmpty,
    shard: z.enum(SHARDS),
    dim: z.enum(DIMS),
    kind: z.enum(KINDS),
    module: z.enum(MODULES),
    parent: nonEmpty.nullable().optional(),
    label: nonEmpty.optional(),
    label_raw: nonEmpty.optional(),
    object_name: nonEmpty.optional(),
    class_name: nonEmpty.optional(),
    signature: nonEmpty.optional(),
    shortcut_default: nonEmpty.optional(),
    what: nonEmpty.optional(),
    risk: z.enum(RISKS).optional(),
    risk_open: z.enum(RISKS).optional(),
    risk_commit: z.enum(RISKS).optional(),
    risk_floor: nonEmpty.optional(),
    risk_confirmed: z.boolean(),
    origin: z.string().regex(ORIGIN_PATTERN),
    aggregate: z.boolean(),
    provisional: z.boolean(),
    recon_coverage: z.enum(RECON_COVERAGES).optional(),
    sources: z.array(sourceSchema).min(1),
    build: z.object({ first_seen: nonEmpty, last_seen: nonEmpty }).strict(),
    children_enumerated: z.union([z.literal(true), z.literal(false), z.literal("n/a")]),
    children_count: z.number().int().min(0).optional(),
    observed_states: z.array(observedStateSchema),
    status: z.enum(STATUSES),
    deferred_reason: nonEmpty.optional(),
    paths: z.array(rowPathSchema),
    locator: locatorSchema.extend({ build: nonEmpty }).strict().optional(),
    modal: z.enum(MODALS).optional(),
    tier: z.enum(TIERS),
    target_tier: z.enum(TIERS),
    target_tier_source: z.enum(TARGET_SOURCES),
    tier_evidence: z.array(tierEvidenceSchema),
    weak_only: z.boolean(),
    disposition: dispositionSchema.optional(),
    owner_signoff: z.string().regex(EVIDENCE_ID_PATTERN).optional(),
    chosen_path: z.enum(PATH_KINDS).optional(),
    mcp: z.array(mcpLinkSchema),
    mcp_proposed: z.array(nonEmpty),
    tests: z.array(testRefSchema),
    work_item: nonEmpty.optional(),
    unverified: z.array(unverifiedSchema),
    notes: nonEmpty.optional(),
  })
  .strict();
export type Row = z.infer<typeof rowSchema>;

/** Field order of a serialised ledger row: the `properties` order of `row.schema.json`. */
export const ROW_FIELD_ORDER: readonly string[] = Object.keys(rowSchema.shape);

// ── State patches ─────────────────────────────────────────────────────────────

/**
 * One line of the append-only `state.jsonl` patch log (main ruling 5). The
 * `fields` payload is checked per field by `state.ts`.
 */
export const statePatchSchema = z
  .object({
    seq: z.number().int().min(1),
    id: nonEmpty,
    op: z.enum(PATCH_OPS),
    fields: z.record(z.unknown()),
    evidence: z.string().regex(EVIDENCE_ID_PATTERN),
    session: nonEmpty,
    at: nonEmpty,
    by: z.enum(PATCH_WRITERS),
  })
  .strict();
export type StatePatch = z.infer<typeof statePatchSchema>;

// ── Probes ────────────────────────────────────────────────────────────────────

/** One line of the append-only `probes.jsonl` log. */
export const probeLineSchema = z
  .object({
    seq: z.number().int().min(1),
    id: z.string().regex(PROBE_ID_PATTERN),
    op: z.enum(PROBE_OPS),
    source: nonEmpty.optional(),
    question: nonEmpty.optional(),
    status: z.enum(["open", "scheduled", "resolved", "blocked", "deferred"]).optional(),
    scheduled_session: nonEmpty.optional(),
    architecture_deciding: z.boolean().optional(),
    outcome: nonEmpty.optional(),
    deferral_accepted_by_owner: z.boolean().optional(),
    evidence: z.string().regex(EVIDENCE_ID_PATTERN).optional(),
    by: nonEmpty,
  })
  .strict();
export type ProbeLine = z.infer<typeof probeLineSchema>;

// ── Live results, aliases, evidence ───────────────────────────────────────────

/** One line of `live-results/<build>.jsonl` (written by the harness). */
export const liveResultSchema = z
  .object({
    test: nonEmpty,
    rows: z.array(nonEmpty).min(1),
    verdict: z.enum(VERDICTS),
    oracle: z.enum(ORACLES),
    evidence: z.string().regex(EVIDENCE_ID_PATTERN).optional(),
    date: nonEmpty.optional(),
  })
  .strict();
export type LiveResult = z.infer<typeof liveResultSchema>;

/** One accepted alias in `aliases.json`: `from` merges into canonical `to`. */
export const aliasSchema = z
  .object({
    from: nonEmpty,
    to: nonEmpty,
    why: nonEmpty,
    proposed_by: nonEmpty,
    evidence: z.string().regex(EVIDENCE_ID_PATTERN),
  })
  .strict();
export type Alias = z.infer<typeof aliasSchema>;

export const aliasesFileSchema = z
  .object({
    $comment: z.string().optional(),
    aliases: z.array(aliasSchema),
  })
  .strict();

/**
 * The fields of an evidence record that census scripts read. The harness
 * writer (`scripts/live/evidence.ts`) owns the full shape.
 */
export const evidenceSchema = z
  .object({
    id: nonEmpty.optional(),
    build: nonEmpty.optional(),
    kind: nonEmpty.optional(),
  })
  .passthrough();

/** `current-build.json` (main ruling 8). */
export const currentBuildSchema = z
  .object({
    $comment: z.string().optional(),
    tag: nonEmpty,
    branch: z.enum(BRANCHES),
    ui_language: nonEmpty,
    recorded_by: nonEmpty,
  })
  .strict();
export type CurrentBuild = z.infer<typeof currentBuildSchema>;
