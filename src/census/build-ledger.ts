/**
 * The ledger join (plan 4.1): observations + state + aliases + policy +
 * universes -> ledger rows. A pure function of the files under the census
 * root and the repository files that references and tests cite; the result
 * carries the exact text of every ledger file, so `build.ts` writes it and
 * `build.ts --check` / `validate.ts` byte-compare it with what is committed.
 *
 * Containment of a wrong or malicious observation file (agent-proofing
 * design): the enumerator and build come from the file's path and header,
 * never from a line; each enumerator may emit only the dims, kinds and id
 * prefixes `universes.json` allows it; lines are strict (no tier, state or
 * id claims); a line whose `id` disagrees with its key is rejected.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { compareCodeUnits, formatJson, sha256, splitLines, toJsonl } from "./canon.js";
import {
  denyEntries,
  kindUniverse,
  loadAliases,
  loadCurrentBuild,
  loadPolicy,
  loadStateMatrix,
  loadUniverses,
  riskOverride,
  shardOf,
  type EnumeratorDef,
  type Policy,
  type StateMatrix,
  type UniversesFile,
} from "./census-config.js";
import {
  allStrings,
  checkRef,
  compareBuilds,
  containsMachinePath,
  fileNamesRow,
  type RefCheck,
} from "./hygiene.js";
import { deriveId, idPrefix, normalizeLabel } from "./ids.js";
import { listObservationFiles, shardFileName, type CensusPaths } from "./ledger-io.js";
import {
  ROW_FIELD_ORDER,
  liveResultSchema,
  observationHeaderSchema,
  observationSchema,
  type LiveResult,
  type Observation,
  type ObservedState,
  type Row,
  type RowPath,
  type Source,
} from "./schemas.js";
import { foldState, type StateOverlay } from "./state.js";
import { computeTier } from "./tier.js";
import {
  CONFIDENCES,
  MODALS,
  PATH_KINDS,
  RISKS,
  SHARDS,
  TIERS,
  type Confidence,
  type Risk,
  type Shard,
  type Tier,
} from "./vocab.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Rejection {
  /** Census-relative file. */
  file: string;
  /** 1-based line; 0 for the whole file. */
  line: number;
  reason: string;
}

export interface BuildProblem {
  id?: string;
  message: string;
}

export interface AcceptedObservation {
  obs: Observation;
  id: string;
  enumerator: string;
  build: string;
  file: string;
  line: number;
  provisional: boolean;
  parentId?: string | null;
  refCheck: RefCheck;
}

export interface BuildResult {
  build: { tag: string; branch: string; ui_language: string };
  rows: Row[];
  /** Exact text of each shard file. */
  shardTexts: Record<Shard, string>;
  /** Exact text of `ledger.meta.json`. */
  metaText: string;
  meta: Record<string, unknown>;
  rejected: Rejection[];
  problems: BuildProblem[];
  observations: AcceptedObservation[];
  observationFiles: {
    rel: string;
    enumerator: string;
    build: string;
    rows: number;
    sha256: string;
  }[];
}

export interface BuildOptions {
  /** Build tag; defaults to `current-build.json` `tag`. */
  build?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fileSha(file: string): string | null {
  return existsSync(file) ? sha256(readFileSync(file)) : null;
}

function maxRisk(values: (Risk | undefined)[]): Risk | undefined {
  let best: Risk | undefined;
  for (const v of values) {
    if (v === undefined) continue;
    if (best === undefined || RISKS.indexOf(v) > RISKS.indexOf(best)) best = v;
  }
  return best;
}

function capConfidence(c: Confidence, max: Confidence | undefined): Confidence {
  if (max === undefined) return c;
  return CONFIDENCES.indexOf(c) > CONFIDENCES.indexOf(max) ? max : c;
}

function stateKey(s: ObservedState | undefined): string {
  if (!s) return "";
  return Object.keys(s)
    .sort(compareCodeUnits)
    .map((k) => `${k}=${(s as Record<string, string>)[k]}`)
    .join(";");
}

function countBy<T>(items: readonly T[], key: (t: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of items) out[key(t)] = (out[key(t)] ?? 0) + 1;
  return out;
}

/** Deny-list floor for a row: the policy entry it matches, if any. */
export function denyFloor(
  policy: Policy,
  row: { id: string; label?: string; label_raw?: string; object_name?: string },
): string | undefined {
  const deny = denyEntries(policy);
  const labels = new Set<string>();
  for (const l of [row.label, row.label_raw, row.object_name]) {
    if (l !== undefined) labels.add(normalizeLabel(l));
  }
  for (const e of deny.labels) if (labels.has(e.value)) return e.where;
  if (row.id.startsWith("cli:")) {
    const sw = row.id.slice("cli:".length);
    for (const e of deny.cli) if (e.value === sw) return e.where;
  }
  if (row.id.startsWith("api:")) {
    const sig = row.id.slice("api:".length);
    for (const e of deny.api) {
      if (e.value.includes(".")) {
        if (sig.startsWith(`${e.value}/`) || sig === e.value) return e.where;
      } else if (
        new RegExp(`^[^.#]+\\.${e.value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/`).test(sig)
      ) {
        return e.where;
      }
    }
  }
  return undefined;
}

// ── Observation intake ────────────────────────────────────────────────────────

interface Intake {
  accepted: AcceptedObservation[];
  rejected: Rejection[];
  files: BuildResult["observationFiles"];
  unverifiedRefs: Record<string, number>;
}

function readObservations(
  paths: CensusPaths,
  universes: UniversesFile,
  matrix: StateMatrix,
): Intake {
  const accepted: AcceptedObservation[] = [];
  const rejected: Rejection[] = [];
  const files: BuildResult["observationFiles"] = [];
  const unverifiedRefs: Record<string, number> = {};
  const refCache = new Map<string, string[] | null>();

  for (const f of listObservationFiles(paths)) {
    const def: EnumeratorDef | undefined = universes.enumerators[f.enumerator];
    if (!def) {
      rejected.push({
        file: f.rel,
        line: 0,
        reason: `enumerator ${f.enumerator} is not declared in universes.json`,
      });
      continue;
    }
    const raw = readFileSync(f.file);
    const lines = splitLines(raw.toString("utf-8"));
    let header: ReturnType<typeof observationHeaderSchema.safeParse>;
    try {
      header = observationHeaderSchema.safeParse(JSON.parse(lines[0] ?? ""));
    } catch {
      rejected.push({ file: f.rel, line: 1, reason: "first line is not a JSON header" });
      continue;
    }
    if (!header.success) {
      const i = header.error.issues[0];
      rejected.push({
        file: f.rel,
        line: 1,
        reason: `header: ${i.path.join(".") || "line"}: ${i.message}`,
      });
      continue;
    }
    const h = header.data;
    const headerProblem =
      h.enumerator !== f.enumerator
        ? `header enumerator ${h.enumerator} differs from its directory ${f.enumerator}`
        : h.build !== f.build
          ? `header build ${h.build} differs from the file name ${f.build}`
          : h.generator !== def.generator
            ? `header generator ${h.generator} is not the registered ${def.generator}`
            : h.row_count !== lines.length - 1
              ? `header row_count ${h.row_count} differs from the ${lines.length - 1} lines that follow`
              : h.provisional !== (def.provisional ?? false)
                ? `header provisional must be ${def.provisional ?? false} for ${f.enumerator}`
                : null;
    if (headerProblem) {
      rejected.push({ file: f.rel, line: 1, reason: headerProblem });
      continue;
    }
    files.push({
      rel: f.rel,
      enumerator: f.enumerator,
      build: f.build,
      rows: lines.length - 1,
      sha256: sha256(raw),
    });

    const refPattern = new RegExp(def.ref_pattern);
    const seen = new Set<string>();
    for (let i = 1; i < lines.length; i++) {
      const lineNo = i + 1;
      const reject = (reason: string): void => {
        rejected.push({ file: f.rel, line: lineNo, reason });
      };
      let value: unknown;
      try {
        value = JSON.parse(lines[i]);
      } catch {
        reject("not valid JSON");
        continue;
      }
      const parsed = observationSchema.safeParse(value);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const extra =
          issue.code === "unrecognized_keys"
            ? ` (${issue.keys.join(", ")} may not appear in an observation)`
            : "";
        reject(`${issue.path.join(".") || "line"}: ${issue.message}${extra}`);
        continue;
      }
      const obs = parsed.data;
      if (allStrings(obs).some(containsMachinePath)) {
        reject("contains a machine path; write placeholders (<repo>, <tools>, %LOCALAPPDATA%)");
        continue;
      }
      if (!def.dims.includes(obs.dim)) {
        reject(`${f.enumerator} may not emit dim ${obs.dim}`);
        continue;
      }
      if (!def.kinds.includes(obs.kind)) {
        reject(`${f.enumerator} may not emit kind ${obs.kind}`);
        continue;
      }
      const ku = kindUniverse(universes, obs.kind);
      if (ku && !ku.dims.includes(obs.dim)) {
        reject(`kind ${obs.kind} does not belong to dim ${obs.dim}`);
        continue;
      }
      let id: string;
      try {
        id = deriveId(obs, { allowGeneric: def.provisional === true });
      } catch (e) {
        reject(e instanceof Error ? e.message : String(e));
        continue;
      }
      if (obs.id !== undefined && obs.id !== id) {
        reject(`id ${obs.id} does not derive from its key (derived ${id})`);
        continue;
      }
      if (!def.id_prefixes.includes(idPrefix(id))) {
        reject(`${f.enumerator} may not emit ids with prefix ${idPrefix(id)}`);
        continue;
      }
      if (!refPattern.test(obs.ref)) {
        reject(`ref ${obs.ref} does not match ${f.enumerator}'s ref pattern`);
        continue;
      }
      if (obs.covers_proposed && !def.dims.includes("mcp")) {
        reject("covers_proposed is only for the MCP self-inventory");
        continue;
      }
      if ((obs.control_type || obs.dismissed_by) && f.enumerator !== "L01") {
        reject("control_type and dismissed_by are only for L01");
        continue;
      }
      if (obs.recon_coverage && !def.provisional) {
        reject("recon_coverage is only for the recon import");
        continue;
      }
      if (obs.observed_state) {
        const bad = Object.keys(obs.observed_state).find((axis) => !(axis in matrix.axes));
        if (bad) {
          reject(`observed_state axis ${bad} is not declared in state-matrix.json`);
          continue;
        }
      }
      const dup = `${id}\u0000${stateKey(obs.observed_state)}`;
      if (seen.has(dup)) {
        reject(`key of ${id} appears twice in this file`);
        continue;
      }
      seen.add(dup);
      const refCheck = checkRef(paths.repo, obs.ref, obs.quote, refCache);
      if (refCheck === "escapes") {
        reject(`ref ${obs.ref} leaves the repository`);
        continue;
      }
      if (refCheck === "unverified")
        unverifiedRefs[f.enumerator] = (unverifiedRefs[f.enumerator] ?? 0) + 1;
      accepted.push({
        obs,
        id,
        enumerator: f.enumerator,
        build: f.build,
        file: f.rel,
        line: lineNo,
        provisional: def.provisional === true,
        refCheck,
      });
    }
  }
  return { accepted, rejected, files, unverifiedRefs };
}

// ── Join ──────────────────────────────────────────────────────────────────────

function readLiveResults(
  paths: CensusPaths,
  build: string,
  problems: BuildProblem[],
): LiveResult[] {
  const file = join(paths.liveResults, `${build}.jsonl`);
  if (!existsSync(file)) return [];
  const out: LiveResult[] = [];
  const lines = splitLines(readFileSync(file, "utf-8"));
  lines.forEach((text, i) => {
    if (text.trim() === "") return;
    try {
      const r = liveResultSchema.safeParse(JSON.parse(text));
      if (r.success) out.push(r.data);
      else
        problems.push({
          message: `live-results/${build}.jsonl line ${i + 1}: ${r.error.issues[0].message}`,
        });
    } catch {
      problems.push({ message: `live-results/${build}.jsonl line ${i + 1}: not valid JSON` });
    }
  });
  return out;
}

function firstDefined<T>(
  obs: AcceptedObservation[],
  pick: (o: Observation) => T | undefined,
): T | undefined {
  // Non-provisional sources win over recon-import ones.
  for (const pass of [false, true]) {
    for (const a of obs) {
      if (a.provisional !== pass) continue;
      const v = pick(a.obs);
      if (v !== undefined) return v;
    }
  }
  return undefined;
}

/**
 * Builds the ledger in memory. Never throws for data problems in
 * observations or state: they are returned as rejections and problems, and
 * recorded in `ledger.meta.json` so G1 fails on them. Throws
 * `CensusDataError` when a configuration file is missing or malformed.
 */
export function buildLedger(paths: CensusPaths, options: BuildOptions = {}): BuildResult {
  const universes = loadUniverses(paths);
  const policy = loadPolicy(paths);
  const matrix = loadStateMatrix(paths);
  const current = loadCurrentBuild(paths);
  const aliases = loadAliases(paths);
  const buildTag = options.build ?? current.tag;
  const problems: BuildProblem[] = [];

  const intake = readObservations(paths, universes, matrix);
  const state = foldState(paths);
  for (const p of state.problems) problems.push({ id: p.id, message: p.message });
  const liveResults = readLiveResults(paths, buildTag, problems);

  // Aliases: `from` merges into canonical `to` (one hop).
  const aliasTo = new Map<string, string>();
  for (const a of aliases) aliasTo.set(a.from, a.to);
  for (const a of aliases) {
    if (aliasTo.has(a.to))
      problems.push({
        id: a.from,
        message: `alias ${a.from} -> ${a.to} chains through another alias`,
      });
  }
  const canon = (id: string): string => aliasTo.get(id) ?? id;

  // Group observations by canonical id.
  const groups = new Map<string, AcceptedObservation[]>();
  for (const a of intake.accepted) {
    a.id = canon(a.id);
    const list = groups.get(a.id);
    if (list) list.push(a);
    else groups.set(a.id, [a]);
  }
  for (const a of intake.accepted) {
    const pk = a.obs.parent_key;
    if (pk === null) a.parentId = null;
    else if (pk !== undefined) {
      try {
        a.parentId = canon(deriveId(pk, { allowGeneric: a.provisional }));
      } catch (e) {
        problems.push({
          id: a.id,
          message: `${a.file}:${a.line}: parent_key: ${e instanceof Error ? e.message : String(e)}`,
        });
      }
    }
  }

  // children_count cross-check: per (file, observed_state, parent) the emitted child count.
  const childCounts = new Map<string, number>();
  for (const a of intake.accepted) {
    if (typeof a.parentId !== "string") continue;
    const k = `${a.file}\u0000${stateKey(a.obs.observed_state)}\u0000${a.parentId}`;
    childCounts.set(k, (childCounts.get(k) ?? 0) + 1);
  }

  const buildObservers = new Set(
    Object.entries(universes.enumerators)
      .filter(([, d]) => d.observes_build)
      .map(([k]) => k),
  );
  const mcpProposed = new Map<string, Set<string>>();
  for (const a of intake.accepted) {
    for (const target of a.obs.covers_proposed ?? []) {
      const t = canon(target);
      if (!groups.has(t)) {
        problems.push({
          id: a.id,
          message: `${a.file}:${a.line}: covers_proposed names unknown row ${target}`,
        });
        continue;
      }
      const set = mcpProposed.get(t) ?? new Set<string>();
      set.add(a.id);
      mcpProposed.set(t, set);
    }
  }

  // Pass 1: everything except tier.
  const draft: Row[] = [];
  const sourceChecks = new Map<string, RefCheck[]>();
  const ids = [...groups.keys()].sort(compareCodeUnits);
  for (const id of ids) {
    const obsList = (groups.get(id) ?? [])
      .slice()
      .sort(
        (x, y) =>
          compareCodeUnits(
            `${x.enumerator}\u0000${x.build}\u0000${x.file}`,
            `${y.enumerator}\u0000${y.build}\u0000${y.file}`,
          ) || x.line - y.line,
      );
    const first = obsList[0];
    for (const a of obsList) {
      if (
        a.obs.kind !== first.obs.kind ||
        a.obs.dim !== first.obs.dim ||
        a.obs.module !== first.obs.module
      ) {
        problems.push({
          id,
          message: `${id}: ${a.file}:${a.line} says ${a.obs.dim}/${a.obs.kind}/${a.obs.module}, ${first.file}:${first.line} says ${first.obs.dim}/${first.obs.kind}/${first.obs.module}`,
        });
      }
    }
    const kind = first.obs.kind;
    const ku = kindUniverse(universes, kind);
    const o: StateOverlay | undefined = state.overlays.get(id);

    // Parent.
    const parents = [...new Set(obsList.map((a) => a.parentId).filter((p) => p !== undefined))];
    if (parents.length > 1)
      problems.push({
        id,
        message: `${id}: observations disagree on the parent (${parents.join(", ")})`,
      });
    const parent = parents[0];
    if (typeof parent === "string" && !groups.has(parent)) {
      problems.push({ id, message: `${id}: parent ${parent} has no row` });
    }

    // Sources.
    const seenSource = new Set<string>();
    const sourcesWithCheck: { s: Source; check: RefCheck }[] = [];
    for (const a of obsList) {
      const def = universes.enumerators[a.enumerator];
      let conf = capConfidence(a.obs.confidence, def.confidence_max);
      for (const rule of def.confidence_rules ?? []) {
        if (new RegExp(rule.ref_matches).test(a.obs.ref)) conf = capConfidence(conf, rule.max);
      }
      const s: Source = {
        enumerator: a.enumerator,
        build: a.build,
        ref: a.obs.ref,
        quote: a.obs.quote,
        confidence: conf,
        observed_state: a.obs.observed_state,
      };
      const k = JSON.stringify([
        s.enumerator,
        s.build,
        s.ref,
        s.quote ?? "",
        stateKey(s.observed_state),
      ]);
      if (seenSource.has(k)) continue;
      seenSource.add(k);
      sourcesWithCheck.push({ s, check: a.refCheck });
    }
    sourcesWithCheck.sort((x, y) =>
      compareCodeUnits(
        `${x.s.enumerator}\u0000${x.s.build}\u0000${x.s.ref}\u0000${stateKey(x.s.observed_state)}`,
        `${y.s.enumerator}\u0000${y.s.build}\u0000${y.s.ref}\u0000${stateKey(y.s.observed_state)}`,
      ),
    );
    sourceChecks.set(
      id,
      sourcesWithCheck.map((x) => x.check),
    );
    const builds = [...new Set(obsList.map((a) => a.build))].sort(compareBuilds);

    // Children.
    let childrenEnumerated: Row["children_enumerated"] = ku?.leaf ? "n/a" : false;
    let childrenCount: number | undefined;
    if (!ku?.leaf) {
      for (const a of obsList) {
        if (a.obs.children_count === undefined) continue;
        const k = `${a.file}\u0000${stateKey(a.obs.observed_state)}\u0000${id}`;
        const emitted = childCounts.get(k) ?? 0;
        if (emitted !== a.obs.children_count) {
          problems.push({
            id,
            message: `${id}: ${a.file}:${a.line} claims children_count ${a.obs.children_count} but the file emits ${emitted} child rows in that state`,
          });
          continue;
        }
        childrenEnumerated = true;
        childrenCount = Math.max(childrenCount ?? 0, emitted);
      }
    }

    // Observed states.
    const statesByKey = new Map<string, ObservedState>();
    for (const a of obsList)
      if (a.obs.observed_state)
        statesByKey.set(stateKey(a.obs.observed_state), a.obs.observed_state);
    const observedStates = [...statesByKey.keys()]
      .sort(compareCodeUnits)
      .map((k) => statesByKey.get(k) as ObservedState);

    // Labels.
    const label = firstDefined(obsList, (x) => x.label);
    const labelRaw = firstDefined(obsList, (x) => x.label_raw);
    const objectName = firstDefined(obsList, (x) => x.object_name);

    // Risk: monotone upward (ruling 12).
    let risk = maxRisk([...obsList.map((a) => a.obs.risk_hint), o?.risk_confirmed]);
    if (o?.risk_downgrade) risk = o.risk_downgrade.to;
    const floorWhere = denyFloor(policy, {
      id,
      label,
      label_raw: labelRaw,
      object_name: objectName,
    });
    if (floorWhere && (risk === undefined || RISKS.indexOf(risk) < RISKS.indexOf("destructive")))
      risk = "destructive";

    // Paths: observation candidates, then state verdicts.
    const pathMap = new Map<string, RowPath>();
    for (const a of obsList) {
      for (const p of a.obs.paths_proposed ?? []) {
        if (!pathMap.has(p.path))
          pathMap.set(p.path, { path: p.path, status: "candidate", reason: p.reason });
      }
    }
    for (const p of o?.paths ?? []) {
      pathMap.set(p.path, {
        path: p.path,
        status: p.status,
        evidence: p.evidence,
        reason: p.reason ?? pathMap.get(p.path)?.reason,
      });
    }
    const rowPaths = [...pathMap.values()].sort(
      (x, y) => PATH_KINDS.indexOf(x.path) - PATH_KINDS.indexOf(y.path),
    );

    // Locator: the newest build's.
    let locator: Row["locator"];
    for (const a of obsList) {
      if (a.obs.locator && (locator === undefined || compareBuilds(a.build, locator.build) > 0)) {
        locator = { ...a.obs.locator, build: a.build };
      }
    }
    const modals = obsList.map((a) => a.obs.modal).filter((m) => m !== undefined);
    const modal = modals.length
      ? modals.sort((x, y) => MODALS.indexOf(y) - MODALS.indexOf(x))[0]
      : undefined;

    // Unverified claims.
    const claims = [...new Set(obsList.flatMap((a) => a.obs.unverified ?? []))].sort(
      compareCodeUnits,
    );
    const unverified = claims.map((claim) => {
      const cleared = o?.unverified_cleared.find((c) => c.claim === claim);
      return cleared ? { claim, cleared_by: cleared.evidence } : { claim };
    });

    // Target tier.
    let target: Tier = (policy.target_tier_by_kind[kind]?.target ?? "T2") as Tier;
    let targetSource: Row["target_tier_source"] = "policy";
    const override = risk ? riskOverride(policy, risk) : undefined;
    if (override && (TIERS as readonly string[]).includes(override.target)) {
      target = override.target as Tier;
      targetSource = "risk-override";
    }
    if (o?.target_tier_override) {
      target = o.target_tier_override.tier;
      targetSource = "override";
    }

    const row: Row = {
      id,
      shard: shardOf(universes, kind),
      dim: first.obs.dim,
      kind,
      module: first.obs.module,
      parent,
      label,
      label_raw: labelRaw,
      object_name: objectName,
      class_name: firstDefined(obsList, (x) => x.class_name),
      signature: firstDefined(obsList, (x) => x.signature),
      shortcut_default: firstDefined(obsList, (x) => x.shortcut_default),
      what: firstDefined(obsList, (x) => x.what),
      risk,
      risk_open: maxRisk(obsList.map((a) => a.obs.risk_open_hint)),
      risk_commit: maxRisk(obsList.map((a) => a.obs.risk_commit_hint)),
      risk_floor: floorWhere,
      risk_confirmed: o?.risk_confirmed !== undefined && o.risk_confirmed === risk,
      origin: first.obs.origin,
      aggregate: obsList.some((a) => a.obs.aggregate === true),
      provisional: obsList.every((a) => a.provisional),
      recon_coverage: firstDefined(obsList, (x) => x.recon_coverage),
      sources: sourcesWithCheck.map((x) => x.s),
      build: { first_seen: builds[0], last_seen: builds[builds.length - 1] },
      children_enumerated: childrenEnumerated,
      children_count: childrenCount,
      observed_states: observedStates,
      status: o?.status ?? "active",
      deferred_reason: o?.deferred_reason,
      paths: rowPaths,
      locator,
      modal,
      tier: "T0",
      target_tier: target,
      target_tier_source: targetSource,
      tier_evidence: [],
      weak_only: false,
      disposition: o?.disposition,
      owner_signoff: o?.owner_signoff,
      chosen_path: o?.chosen_path,
      mcp: [...(o?.mcp ?? [])].sort((x, y) =>
        compareCodeUnits(`${x.action} ${x.role}`, `${y.action} ${y.role}`),
      ),
      mcp_proposed: [...(mcpProposed.get(id) ?? [])].sort(compareCodeUnits),
      tests: [...(o?.tests ?? [])].sort((x, y) =>
        compareCodeUnits(`${x.id} ${x.file}`, `${y.id} ${y.file}`),
      ),
      work_item: o?.work_item,
      unverified,
      notes: o?.notes,
    };
    draft.push(row);
  }

  // Pass 2: tiers.
  const mcpActions = new Set(draft.filter((r) => r.kind === "mcp-action").map((r) => r.id));
  const textCache = new Map<string, string | null>();
  for (const row of draft) {
    const checks = sourceChecks.get(row.id) ?? [];
    const t = computeTier(row, {
      build: buildTag,
      buildObservers,
      sourceResolves: (i) => checks[i] === "resolves" || checks[i] === "unverified",
      testNamesRow: (file, id) => fileNamesRow(paths.repo, file, id, textCache),
      mcpActionExists: (a) => mcpActions.has(a),
      liveResults,
      weakOracle: policy.weak_oracle,
    });
    row.tier = t.tier;
    row.tier_evidence = t.tier_evidence;
    row.weak_only = t.weak_only;
  }

  // Orphaned state: ids that state names but no observation produces.
  const absentCandidates: string[] = [];
  const retired: string[] = [];
  for (const id of [...state.overlays.keys()].sort(compareCodeUnits)) {
    if (groups.has(id)) continue;
    const o = state.overlays.get(id) as StateOverlay;
    if (o.disposition?.kind === "absent-in-build") retired.push(id);
    else {
      absentCandidates.push(id);
      problems.push({
        id,
        message: `${id}: state names a row that no observation produces (absent-in-build candidate)`,
      });
    }
  }
  for (const a of aliases) {
    if (!groups.has(a.to)) problems.push({ id: a.to, message: `alias target ${a.to} has no row` });
  }

  // Serialise.
  const shardRows: Record<Shard, Row[]> = { core: [], attribute: [], schema: [], diag: [] };
  for (const r of draft) shardRows[r.shard].push(r);
  const shardTexts = {} as Record<Shard, string>;
  for (const s of SHARDS) shardTexts[s] = toJsonl(shardRows[s], ROW_FIELD_ORDER);

  const enumeratorsDone = [
    ...new Set(intake.files.filter((f) => f.build === buildTag).map((f) => f.enumerator)),
  ].sort(compareCodeUnits);
  const pending = Object.keys(universes.enumerators)
    .filter((e) => !enumeratorsDone.includes(e))
    .sort(compareCodeUnits);
  const liveFiles = existsSync(paths.liveResults)
    ? readdirSync(paths.liveResults)
        .filter((f) => f.endsWith(".jsonl"))
        .sort(compareCodeUnits)
        .map((f) => ({ file: `live-results/${f}`, sha256: fileSha(join(paths.liveResults, f)) }))
    : [];

  const sortedProblems = problems
    .map((p) => ({ id: p.id, message: p.message }))
    .sort((x, y) => compareCodeUnits(x.message, y.message));
  const dedupedProblems = sortedProblems.filter(
    (p, i) => i === 0 || p.message !== sortedProblems[i - 1].message,
  );
  const rejected = [...intake.rejected].sort(
    (x, y) =>
      compareCodeUnits(x.file, y.file) || x.line - y.line || compareCodeUnits(x.reason, y.reason),
  );

  const meta: Record<string, unknown> = {
    schema_version: 1,
    build: { tag: buildTag, branch: current.branch, ui_language: current.ui_language },
    shards: SHARDS.map((s) => ({
      name: s,
      file: shardFileName(s),
      rows: shardRows[s].length,
      sha256: sha256(shardTexts[s]),
    })),
    inputs: {
      observations: intake.files.map((f) => ({
        file: f.rel,
        enumerator: f.enumerator,
        build: f.build,
        rows: f.rows,
        sha256: f.sha256,
      })),
      state_sha256: fileSha(paths.state),
      probes_sha256: fileSha(paths.probes),
      aliases_sha256: fileSha(paths.aliases),
      policy_sha256: fileSha(paths.policy),
      universes_sha256: fileSha(paths.universes),
      state_matrix_sha256: fileSha(paths.stateMatrix),
      live_results: liveFiles,
    },
    counts: {
      rows: draft.length,
      by_dim: countBy(draft, (r) => r.dim),
      by_kind: countBy(draft, (r) => r.kind),
      by_module: countBy(draft, (r) => r.module),
      by_tier: countBy(draft, (r) => r.tier),
      by_shard: countBy(draft, (r) => r.shard),
      provisional: draft.filter((r) => r.provisional).length,
      aggregate: draft.filter((r) => r.aggregate).length,
    },
    enumerators: { done: enumeratorsDone, pending },
    unverified_refs: intake.unverifiedRefs,
    rejected,
    problems: dedupedProblems,
    absent_candidates: absentCandidates,
    retired,
  };

  return {
    build: { tag: buildTag, branch: current.branch, ui_language: current.ui_language },
    rows: draft,
    shardTexts,
    metaText: formatJson(meta),
    meta,
    rejected,
    problems: dedupedProblems,
    observations: intake.accepted,
    observationFiles: intake.files,
  };
}
