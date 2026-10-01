/**
 * The only code paths that write census state: state patches (`promote.ts`,
 * `dispose.ts`), probe-log lines (`dispose.ts --probe`, the E01 seed) and
 * accepted aliases (`alias.ts`). Every write is checked before it happens:
 * a write that validation would reject is refused, never recorded.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { formatJson, jsonlLine } from "./canon.js";
import { loadAliases, loadCurrentBuild } from "./census-config.js";
import { allStrings, containsMachinePath } from "./hygiene.js";
import { readJsonl, writeFileAtomic, type CensusPaths } from "./ledger-io.js";
import {
  aliasSchema,
  probeLineSchema,
  statePatchSchema,
  type Alias,
  type ProbeLine,
  type Row,
  type StatePatch,
} from "./schemas.js";
import { checkEvidence, checkPatchFields, evidenceSession, foldProbes } from "./state.js";

const ALIASES_COMMENT =
  "Accepted entity-resolution decisions that are not exact-key matches (plan 4.4). Written only by " +
  "scripts/census/alias.ts accept, run by the main session. `from` merges into the canonical `to`.";

function lastSeq(file: string, name: string): number {
  let seq = 0;
  for (const l of readJsonl(file, name)) {
    const v = l.value as { seq?: unknown };
    if (typeof v.seq === "number" && v.seq > seq) seq = v.seq;
  }
  return seq;
}

function appendLine(file: string, line: string): void {
  const prev = existsSync(file) ? readFileSync(file, "utf-8") : "";
  if (prev !== "" && !prev.endsWith("\n"))
    throw new Error(`${file} does not end with a newline; refusing to append`);
  appendFileSync(file, line + "\n", "utf-8");
}

/**
 * Checks an evidence id for a write: the record exists, its session matches
 * the id, and (when the record names a build) it is the current build.
 */
export function requireEvidence(paths: CensusPaths, evidence: string, session?: string): string {
  const ev = checkEvidence(paths, evidence);
  if (!ev.ok) throw new Error(ev.message);
  const s = evidenceSession(evidence) as string;
  if (session !== undefined && session !== s) {
    throw new Error(`session ${session} does not match evidence ${evidence}`);
  }
  const build = loadCurrentBuild(paths).tag;
  if (ev.record?.build !== undefined && ev.record.build !== build) {
    throw new Error(
      `evidence ${evidence} was recorded on build ${ev.record.build}, current build is ${build}`,
    );
  }
  return s;
}

export interface PatchRequest {
  id: string;
  op: StatePatch["op"];
  fields: Record<string, unknown>;
  evidence: string;
  by: StatePatch["by"];
  /** ISO timestamp of the write (history only; the ledger never reads it). */
  at: string;
}

/**
 * Validates and appends one state patch. `rows` is the current ledger: the
 * id must name an observed row (state cannot create rows).
 */
export function appendStatePatch(
  paths: CensusPaths,
  rows: ReadonlyMap<string, Row>,
  req: PatchRequest,
  options: { dryRun?: boolean } = {},
): StatePatch {
  if (!rows.has(req.id))
    throw new Error(`${req.id} is not a ledger row (state cannot create rows; run build.ts first)`);
  const fieldError = checkPatchFields(req.op, req.fields);
  if (fieldError) throw new Error(fieldError);
  if (allStrings(req.fields).some(containsMachinePath))
    throw new Error("a field contains a machine path; write placeholders");
  const session = requireEvidence(paths, req.evidence);
  const patch: StatePatch = {
    seq: lastSeq(paths.state, "state.jsonl") + 1,
    id: req.id,
    op: req.op,
    fields: req.fields,
    evidence: req.evidence,
    session,
    at: req.at,
    by: req.by,
  };
  statePatchSchema.parse(patch);
  if (!options.dryRun) appendLine(paths.state, jsonlLine(patch, ["seq", "id", "op"]));
  return patch;
}

/** Appends one probe-log line after validating it (seq is assigned here). */
export function appendProbeLine(
  paths: CensusPaths,
  line: Omit<ProbeLine, "seq">,
  options: { dryRun?: boolean } = {},
): ProbeLine {
  const full: ProbeLine = { ...line, seq: lastSeq(paths.probes, "probes.jsonl") + 1 } as ProbeLine;
  probeLineSchema.parse(full);
  if (allStrings(full).some(containsMachinePath))
    throw new Error("probe line contains a machine path");
  const probes = foldProbes(paths).probes;
  if (full.op === "open" && probes.has(full.id))
    throw new Error(`probe ${full.id} is already open`);
  if (full.op !== "open" && !probes.has(full.id))
    throw new Error(`probe ${full.id} does not exist`);
  if (full.op === "outcome") {
    if (!full.outcome || !full.evidence)
      throw new Error("an outcome needs --outcome and --evidence");
    requireEvidence(paths, full.evidence);
  }
  if (!options.dryRun) appendLine(paths.probes, jsonlLine(full, ["seq", "id", "op"]));
  return full;
}

/** Text of `aliases.json` for a list of aliases (sorted by `from`). */
export function aliasesText(aliases: readonly Alias[]): string {
  const sorted = [...aliases].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  return formatJson({ $comment: ALIASES_COMMENT, aliases: sorted });
}

/**
 * Accepts one alias after the checks of the agent-proofing design: both ids
 * are rows, same dim, not the same id, the pair is not observed only by one
 * enumerator, no cycle and no chain, neither row carries a disposition.
 */
export function acceptAlias(
  paths: CensusPaths,
  rows: ReadonlyMap<string, Row>,
  alias: Alias,
  options: { dryRun?: boolean } = {},
): Alias[] {
  aliasSchema.parse(alias);
  const from = rows.get(alias.from);
  const to = rows.get(alias.to);
  if (!from) throw new Error(`${alias.from} is not a ledger row`);
  if (!to) throw new Error(`${alias.to} is not a ledger row`);
  if (alias.from === alias.to) throw new Error("an alias needs two different ids");
  if (from.dim !== to.dim)
    throw new Error(`alias across dims (${from.dim} -> ${to.dim}) is refused`);
  if (from.disposition || to.disposition)
    throw new Error("a row with a disposition cannot be aliased");
  const enums = new Set([...from.sources, ...to.sources].map((s) => s.enumerator));
  if (enums.size === 1) {
    throw new Error(
      `both ids come only from ${[...enums][0]}: a same-enumerator alias would hide a duplicate`,
    );
  }
  const existing = loadAliases(paths);
  if (existing.some((a) => a.from === alias.from))
    throw new Error(`${alias.from} is already aliased`);
  if (existing.some((a) => a.from === alias.to))
    throw new Error(`${alias.to} is itself an alias (no chains)`);
  if (existing.some((a) => a.to === alias.from))
    throw new Error(`${alias.from} is an alias target (no chains)`);
  if (allStrings(alias).some(containsMachinePath)) throw new Error("alias contains a machine path");
  requireEvidence(paths, alias.evidence);
  const next = [...existing, alias];
  if (!options.dryRun) writeFileAtomic(paths.aliases, aliasesText(next));
  return next;
}
