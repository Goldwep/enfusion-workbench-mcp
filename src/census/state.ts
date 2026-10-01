/**
 * The state overlay (plan 4.1, main ruling 5): `state.jsonl` is an
 * append-only patch log `{seq, id, op, fields, evidence, session, at, by}`
 * folded in `seq` order into one overlay per row id. Every patch names an
 * evidence record that must exist under `data/census/evidence/`.
 *
 * Also folds the append-only `probes.jsonl` log, and checks the
 * append-only rule (the committed file is a byte prefix of the working one).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { readJsonl, type CensusPaths } from "./ledger-io.js";
import {
  evidenceSchema,
  mcpLinkSchema,
  probeLineSchema,
  statePatchSchema,
  testRefSchema,
  type McpLink,
  type ProbeLine,
  type StatePatch,
  type TestRef,
} from "./schemas.js";
import {
  DISPOSITION_KINDS,
  EVIDENCE_ID_PATTERN,
  PATH_KINDS,
  RISKS,
  STATUSES,
  TIERS,
  WORK_ITEM_PATTERN,
  type DispositionKind,
  type PathKind,
  type Risk,
  type Tier,
} from "./vocab.js";

// ── Field schemas ─────────────────────────────────────────────────────────────

const text = z.string().min(1);

/** Every field a state patch may carry, with its value schema (closed set). */
export const STATE_FIELD_SCHEMAS = {
  status: z.enum(STATUSES),
  deferred_reason: text,
  work_item: z.string().regex(WORK_ITEM_PATTERN, "work_item must match WI-n, Un, Dn or P-..."),
  disposition: z
    .object({ kind: z.enum(DISPOSITION_KINDS), ref: text.optional(), why: text })
    .strict(),
  owner_signoff: z.string().regex(EVIDENCE_ID_PATTERN),
  risk_confirmed: z.enum(RISKS),
  risk_downgrade: z.object({ to: z.enum(RISKS), reason: text }).strict(),
  target_tier_override: z.object({ tier: z.enum(TIERS), reason: text }).strict(),
  chosen_path: z.enum(PATH_KINDS),
  paths: z.array(
    z
      .object({
        path: z.enum(PATH_KINDS),
        status: z.enum(["verified", "refuted"]),
        reason: text.optional(),
      })
      .strict(),
  ),
  mcp: z.array(mcpLinkSchema),
  tests: z.array(testRefSchema),
  unverified_cleared: z.array(text),
  notes: text,
  recon_resolution: z
    .object({
      kind: z.enum(["merged-via-alias", "duplicate-of", "recon-error", "absent-in-build"]),
      ref: text,
    })
    .strict(),
  reconcile_explained: z.array(
    z
      .object({
        universe: text,
        enumerator: text,
        kind: z.enum([
          "alias",
          "absent-in-build",
          "out-of-scope",
          "duplicate-of",
          "enumerator-defect",
        ]),
        ref: text,
      })
      .strict(),
  ),
} as const;

export type StateField = keyof typeof STATE_FIELD_SCHEMAS;

/** Fields that `append` may extend. */
export const APPENDABLE_FIELDS: readonly StateField[] = [
  "paths",
  "mcp",
  "tests",
  "unverified_cleared",
  "reconcile_explained",
];

// ── Overlay ───────────────────────────────────────────────────────────────────

export interface StateOverlay {
  id: string;
  status?: "active" | "deferred";
  deferred_reason?: string;
  work_item?: string;
  disposition?: { kind: DispositionKind; ref?: string; why: string; evidence: string };
  owner_signoff?: string;
  risk_confirmed?: Risk;
  risk_downgrade?: { to: Risk; reason: string; evidence: string };
  target_tier_override?: { tier: Tier; reason: string };
  chosen_path?: PathKind;
  paths: { path: PathKind; status: "verified" | "refuted"; reason?: string; evidence: string }[];
  mcp: McpLink[];
  tests: TestRef[];
  unverified_cleared: { claim: string; evidence: string }[];
  notes?: string;
  recon_resolution?: { kind: string; ref: string };
  reconcile_explained: { universe: string; enumerator: string; kind: string; ref: string }[];
  /** Sequence numbers of the patches folded into this overlay. */
  seqs: number[];
}

export interface StateProblem {
  line: number;
  id?: string;
  message: string;
}

export interface FoldedState {
  overlays: Map<string, StateOverlay>;
  patches: StatePatch[];
  problems: StateProblem[];
}

function emptyOverlay(id: string): StateOverlay {
  return {
    id,
    paths: [],
    mcp: [],
    tests: [],
    unverified_cleared: [],
    reconcile_explained: [],
    seqs: [],
  };
}

/** Session part of an evidence id (`EV-<session>-<seq>`). */
export function evidenceSession(evidenceId: string): string | null {
  if (!EVIDENCE_ID_PATTERN.test(evidenceId)) return null;
  return evidenceId.slice(3).replace(/-\d+$/, "");
}

export interface EvidenceCheck {
  ok: boolean;
  message?: string;
  record?: z.infer<typeof evidenceSchema>;
}

/** Checks that `evidence/<id>.json` exists, parses, and (when it says) carries the same id. */
export function checkEvidence(paths: CensusPaths, evidenceId: string): EvidenceCheck {
  if (!EVIDENCE_ID_PATTERN.test(evidenceId)) {
    return {
      ok: false,
      message: `evidence id ${evidenceId} is not of the form EV-<session>-<seq>`,
    };
  }
  const file = join(paths.evidence, `${evidenceId}.json`);
  if (!existsSync(file))
    return { ok: false, message: `evidence ${evidenceId} has no file evidence/${evidenceId}.json` };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    return { ok: false, message: `evidence/${evidenceId}.json is not valid JSON` };
  }
  const r = evidenceSchema.safeParse(raw);
  if (!r.success) return { ok: false, message: `evidence/${evidenceId}.json is not an object` };
  if (r.data.id !== undefined && r.data.id !== evidenceId) {
    return { ok: false, message: `evidence/${evidenceId}.json names id ${r.data.id}` };
  }
  return { ok: true, record: r.data };
}

/**
 * Validates one patch's `fields` for its op. Returns an error message or null.
 */
export function checkPatchFields(
  op: StatePatch["op"],
  fields: Record<string, unknown>,
): string | null {
  const names = Object.keys(fields);
  if (names.length === 0) return "patch has no fields";
  for (const name of names) {
    if (!(name in STATE_FIELD_SCHEMAS)) return `unknown state field ${name}`;
    const f = name as StateField;
    if (op === "clear") continue;
    if (op === "append" && !APPENDABLE_FIELDS.includes(f))
      return `field ${name} cannot be appended`;
    const r = STATE_FIELD_SCHEMAS[f].safeParse(fields[name]);
    if (!r.success) return `field ${name}: ${r.error.issues[0].message}`;
  }
  return null;
}

function applyPatch(o: StateOverlay, p: StatePatch): void {
  const rec = o as unknown as Record<string, unknown>;
  for (const [name, value] of Object.entries(p.fields)) {
    const f = name as StateField;
    if (p.op === "clear") {
      if (APPENDABLE_FIELDS.includes(f)) rec[f] = [];
      else delete rec[f];
      continue;
    }
    let v: unknown = value;
    if (f === "disposition") v = { ...(value as object), evidence: p.evidence };
    if (f === "risk_downgrade") v = { ...(value as object), evidence: p.evidence };
    if (f === "paths") v = (value as object[]).map((x) => ({ ...x, evidence: p.evidence }));
    if (f === "unverified_cleared") {
      v = (value as string[]).map((claim) => ({ claim, evidence: p.evidence }));
    }
    if (p.op === "append") rec[f] = [...((rec[f] as unknown[]) ?? []), ...(v as unknown[])];
    else rec[f] = v;
  }
  o.seqs.push(p.seq);
}

/**
 * Reads and folds `state.jsonl`. Problems (bad line, seq gap or repeat,
 * unresolvable evidence, session mismatch, bad fields, deferred without
 * reason and work item) are collected, not thrown; G1 reports them.
 */
export function foldState(paths: CensusPaths): FoldedState {
  const overlays = new Map<string, StateOverlay>();
  const patches: StatePatch[] = [];
  const problems: StateProblem[] = [];
  let expectSeq = 1;
  for (const l of readJsonl(paths.state, "state.jsonl")) {
    const r = statePatchSchema.safeParse(l.value);
    if (!r.success) {
      const i = r.error.issues[0];
      problems.push({
        line: l.line,
        message: `state.jsonl: ${i.path.join(".") || "line"}: ${i.message}`,
      });
      continue;
    }
    const p = r.data;
    if (p.seq !== expectSeq) {
      problems.push({
        line: l.line,
        id: p.id,
        message: `state.jsonl: seq ${p.seq} where ${expectSeq} was expected`,
      });
    }
    expectSeq = p.seq + 1;
    const fieldError = checkPatchFields(p.op, p.fields);
    if (fieldError) {
      problems.push({ line: l.line, id: p.id, message: `state.jsonl: ${fieldError}` });
      continue;
    }
    const ev = checkEvidence(paths, p.evidence);
    if (!ev.ok) problems.push({ line: l.line, id: p.id, message: `state.jsonl: ${ev.message}` });
    if (evidenceSession(p.evidence) !== p.session) {
      problems.push({
        line: l.line,
        id: p.id,
        message: `state.jsonl: session ${p.session} does not match evidence ${p.evidence}`,
      });
    }
    patches.push(p);
    let o = overlays.get(p.id);
    if (!o) {
      o = emptyOverlay(p.id);
      overlays.set(p.id, o);
    }
    applyPatch(o, p);
  }
  for (const o of overlays.values()) {
    if (o.status === "deferred" && (!o.deferred_reason || !o.work_item)) {
      problems.push({
        line: 0,
        id: o.id,
        message: `${o.id}: status deferred needs deferred_reason and work_item`,
      });
    }
  }
  return { overlays, patches, problems };
}

// ── Probes ────────────────────────────────────────────────────────────────────

export interface ProbeState {
  id: string;
  source?: string;
  question?: string;
  status?: string;
  scheduled_session?: string;
  architecture_deciding: boolean;
  outcome?: string;
  evidence?: string;
  deferral_accepted_by_owner: boolean;
}

export interface FoldedProbes {
  probes: Map<string, ProbeState>;
  lines: ProbeLine[];
  problems: StateProblem[];
}

/** Reads and folds `probes.jsonl`. */
export function foldProbes(paths: CensusPaths): FoldedProbes {
  const probes = new Map<string, ProbeState>();
  const lines: ProbeLine[] = [];
  const problems: StateProblem[] = [];
  let expectSeq = 1;
  for (const l of readJsonl(paths.probes, "probes.jsonl")) {
    const r = probeLineSchema.safeParse(l.value);
    if (!r.success) {
      const i = r.error.issues[0];
      problems.push({
        line: l.line,
        message: `probes.jsonl: ${i.path.join(".") || "line"}: ${i.message}`,
      });
      continue;
    }
    const p = r.data;
    if (p.seq !== expectSeq) {
      problems.push({
        line: l.line,
        id: p.id,
        message: `probes.jsonl: seq ${p.seq} where ${expectSeq} was expected`,
      });
    }
    expectSeq = p.seq + 1;
    lines.push(p);
    const existing = probes.get(p.id);
    if (p.op === "open") {
      if (existing) {
        problems.push({
          line: l.line,
          id: p.id,
          message: `probes.jsonl: probe ${p.id} opened twice`,
        });
        continue;
      }
      if (!p.question || !p.source) {
        problems.push({
          line: l.line,
          id: p.id,
          message: "probes.jsonl: open line needs question and source",
        });
      }
      probes.set(p.id, {
        id: p.id,
        source: p.source,
        question: p.question,
        status: p.status ?? "open",
        scheduled_session: p.scheduled_session,
        architecture_deciding: p.architecture_deciding ?? false,
        deferral_accepted_by_owner: false,
      });
      continue;
    }
    if (!existing) {
      problems.push({
        line: l.line,
        id: p.id,
        message: `probes.jsonl: ${p.op} for unknown probe ${p.id}`,
      });
      continue;
    }
    if (p.op === "outcome") {
      if (!p.outcome || !p.evidence) {
        problems.push({
          line: l.line,
          id: p.id,
          message: "probes.jsonl: outcome line needs outcome and evidence",
        });
        continue;
      }
      existing.outcome = p.outcome;
      existing.evidence = p.evidence;
      existing.status = p.status ?? "resolved";
      if (p.deferral_accepted_by_owner) existing.deferral_accepted_by_owner = true;
    } else {
      if (p.scheduled_session) existing.scheduled_session = p.scheduled_session;
      if (p.status) existing.status = p.status;
      if (p.architecture_deciding !== undefined)
        existing.architecture_deciding = p.architecture_deciding;
    }
  }
  return { probes, lines, problems };
}

// ── Append-only rule ──────────────────────────────────────────────────────────

/** True when `baseline` is a byte prefix of `current` (main ruling 5). */
export function isBytePrefix(baseline: Buffer, current: Buffer): boolean {
  if (baseline.length > current.length) return false;
  return baseline.equals(current.subarray(0, baseline.length));
}
