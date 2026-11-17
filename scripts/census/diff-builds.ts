/**
 * Compares two builds' census evidence (Phase 6, docs/UPDATE-PLAYBOOK.md census steps).
 *
 * Four comparisons:
 *   rows          ledger rows present on one build only (a row is on build B when B is in its
 *                 `sources[].build` or inside its `build.first_seen`..`build.last_seen` range).
 *                 A row only on the old build is split (review-1 finding 4):
 *                   removed       an enumerator that observed it on the old build ran again on the
 *                                 new build, in full (it is not in the to-side ledger.meta
 *                                 carry_over for this pair), and did not see it: removed surface;
 *                   not re-walked none of its enumerators re-enumerated the new build: a one-time
 *                                 import (E01), an enumerator not run on the new build, or a live
 *                                 walker whose rows ledger.meta carry_over carries. Unknown, not gone.
 *                 `enumeratorsOnlyFrom` names the enumerators with an observation file on the old
 *                 build and none on the new one (one-time or not re-run): their rows are not re-walked;
 *   locators      `locators/<build>.jsonl` records added, removed, or changed per row id;
 *   observations  `observations/<enumerator>/<build>.jsonl` entries (identity: dim, kind, module,
 *                 key, parent_key) added, removed, or whose value changed (`ref` is ignored: it
 *                 carries line numbers and artifact hashes);
 *   staleT5       rows at tier T5 on the old side that are not T5 on the new one, and rows at T5 on
 *                 the new side whose T5 evidence was earned on another build (no T5 evidence
 *                 ref ends in `@<to>`), grouped by wave and battery where the ref names one
 *                 (`w3-23-loc-insert-undo state-readback@1.9.0.37` is wave w3, battery
 *                 w3-23-loc-insert-undo). These are the batteries to re-run on the new build.
 *
 * Usage:
 *   npx tsx scripts/census/diff-builds.ts --from <build> --to <build> [--data <census dir>]
 *       [--from-ledger <path>] [--to-ledger <path>] [--json]
 *
 * `--from-ledger` / `--to-ledger` take a ledger snapshot instead of the checked-out ledger, so the
 * diff works when only one build is checked out. A path to a census-shaped directory (ledger shards
 * plus locators/ and observations/) is read whole; a path to a single .jsonl file supplies the rows
 * only, and that side's locators and observations come from --data. A snapshot side counts every
 * row in it as present on its build.
 *
 * Output is deterministic (code-unit order, no machine paths). Exit: 0 ok (differences are not an
 * error); 2 usage (missing or equal builds, no ledger); 3 malformed input.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { compareCodeUnits, sha256 } from "../../src/census/canon.js";
import {
  CensusDataError,
  censusPaths,
  ledgerMissing,
  listObservationFiles,
  loadLedger,
  readJsonl,
  type CensusPaths,
} from "../../src/census/ledger-io.js";
import {
  EXIT_OK,
  EXIT_USAGE,
  PROCESS_IO,
  guard,
  isMainModule,
  pathsFrom,
  type Io,
} from "./cli-common.js";

// ── Types ─────────────────────────────────────────────────────────────────────

type Obj = Record<string, unknown>;

interface Side {
  build: string;
  /** Rows present on this side's build. */
  rows: Obj[];
  paths: CensusPaths;
}

/** Accepted ledger.meta carry_over entries from `from` to `to`: enumerators and evidence. */
export function carryOverFor(
  paths: CensusPaths,
  from: string,
  to: string,
): { enumerators: string[]; evidence: string[] } {
  const enumerators = new Set<string>();
  const evidence = new Set<string>();
  if (!existsSync(paths.meta)) return { enumerators: [], evidence: [] };
  let meta: unknown;
  try {
    meta = JSON.parse(readFileSync(paths.meta, "utf-8"));
  } catch {
    throw new CensusDataError("ledger.meta.json: not valid JSON");
  }
  const list = isObj(meta) && Array.isArray(meta.carry_over) ? meta.carry_over : [];
  for (const c of list) {
    if (!isObj(c) || c.from !== from || c.to !== to) continue;
    if (c.status !== undefined && c.status !== "accepted") continue;
    for (const e of Array.isArray(c.enumerators) ? c.enumerators : [])
      if (typeof e === "string") enumerators.add(e);
    if (typeof c.evidence === "string") evidence.add(c.evidence);
  }
  return { enumerators: sortStrings(enumerators), evidence: sortStrings(evidence) };
}

export interface FieldChange {
  id: string;
  fields: string[];
}

export interface DiffReport {
  from: string;
  to: string;
  summary: Record<string, number>;
  rows: {
    onlyFrom: string[];
    onlyTo: string[];
    /** Rows only on `from` that a full re-enumeration on `to` did not see. */
    removed: string[];
    /** Rows only on `from` that no enumerator re-enumerated on `to`. */
    notRewalked: string[];
    /** notRewalked counts by the row's enumerators ("E01", "L01+L03"). */
    notRewalkedBy: Record<string, number>;
  };
  /** to-side ledger.meta carry_over enumerators for this pair, with their evidence. */
  carryOver: { enumerators: string[]; evidence: string[] };
  locators: { added: string[]; removed: string[]; changed: FieldChange[] };
  observations: {
    enumeratorsOnlyFrom: string[];
    enumeratorsOnlyTo: string[];
    byEnumerator: Record<string, { added: number; removed: number; changed: number }>;
    added: string[];
    removed: string[];
    changed: FieldChange[];
  };
  staleT5: {
    count: number;
    byWave: Record<string, Record<string, string[]>>;
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sortStrings(list: Iterable<string>): string[] {
  return [...list].sort(compareCodeUnits);
}

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Dotted-number build tags compared numerically ("1.9.0.37" > "1.8.0.13"); non-numeric parts by code unit. */
export function compareBuilds(a: string, b: string): number {
  const pa = a.split(".");
  const pb = b.split(".");
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? "0";
    const y = pb[i] ?? "0";
    const nx = /^\d+$/.test(x) ? Number(x) : NaN;
    const ny = /^\d+$/.test(y) ? Number(y) : NaN;
    if (!Number.isNaN(nx) && !Number.isNaN(ny)) {
      if (nx !== ny) return nx < ny ? -1 : 1;
    } else if (x !== y) return compareCodeUnits(x, y);
  }
  return 0;
}

/** Stable JSON: object keys sorted, so equal values give equal text. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (isObj(v)) {
    return `{${Object.keys(v)
      .sort(compareCodeUnits)
      .map((k) => `${JSON.stringify(k)}:${stable(v[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

/** Names of the top-level fields that differ between two objects. */
function differingFields(a: Obj, b: Obj, ignore: ReadonlySet<string>): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out: string[] = [];
  for (const k of keys) {
    if (ignore.has(k)) continue;
    if (stable(a[k]) !== stable(b[k])) out.push(k);
  }
  return sortStrings(out);
}

function rowOnBuild(row: Obj, build: string): boolean {
  const sources = row.sources;
  if (Array.isArray(sources) && sources.some((s) => isObj(s) && s.build === build)) return true;
  const b = row.build;
  if (isObj(b) && typeof b.first_seen === "string" && typeof b.last_seen === "string") {
    return compareBuilds(b.first_seen, build) <= 0 && compareBuilds(build, b.last_seen) <= 0;
  }
  return false;
}

// ── Loading ───────────────────────────────────────────────────────────────────

function loadSnapshotFile(file: string, label: string): Obj[] {
  const rows: Obj[] = [];
  const seen = new Set<string>();
  for (const l of readJsonl(file, label)) {
    if (!isObj(l.value) || typeof l.value.id !== "string") {
      throw new CensusDataError(`${label} line ${l.line}: row without an id`);
    }
    if (seen.has(l.value.id)) {
      throw new CensusDataError(`${label} line ${l.line}: duplicate id ${l.value.id}`);
    }
    seen.add(l.value.id);
    rows.push(l.value);
  }
  return rows;
}

function loadSide(
  build: string,
  snapshot: string | undefined,
  label: string,
  dataPaths: CensusPaths,
): Side | string {
  if (snapshot === undefined) {
    if (ledgerMissing(dataPaths)) return "no ledger in the census directory (run build.ts)";
    const all = loadLedger(dataPaths).rows as unknown as Obj[];
    return { build, rows: all.filter((r) => rowOnBuild(r, build)), paths: dataPaths };
  }
  const p = resolve(snapshot);
  if (!existsSync(p)) return `${label} does not exist`;
  if (statSync(p).isDirectory()) {
    const paths = censusPaths(p);
    if (ledgerMissing(paths)) return `${label} holds no ledger`;
    return { build, rows: loadLedger(paths).rows as unknown as Obj[], paths };
  }
  return { build, rows: loadSnapshotFile(p, label), paths: dataPaths };
}

function loadLocators(side: Side): Map<string, Obj> {
  const file = join(side.paths.root, "locators", `${side.build}.jsonl`);
  const out = new Map<string, Obj>();
  for (const l of readJsonl(file, `locators/${side.build}.jsonl`)) {
    if (!isObj(l.value) || typeof l.value.rowId !== "string") {
      throw new CensusDataError(
        `locators/${side.build}.jsonl line ${l.line}: record without a rowId`,
      );
    }
    out.set(l.value.rowId, l.value);
  }
  return out;
}

const OBSERVATION_IDENTITY = ["dim", "kind", "module", "key", "parent_key"] as const;

/** identity text -> sorted value digests (a key seen twice keeps both). */
function loadObservations(
  side: Side,
  enumerator: string,
): Map<string, { digests: string[]; first: Obj }> {
  const ref = listObservationFiles(side.paths).find(
    (f) => f.enumerator === enumerator && f.build === side.build,
  );
  const out = new Map<string, { digests: string[]; first: Obj }>();
  if (!ref) return out;
  for (const l of readJsonl(ref.file, ref.rel)) {
    const value = l.value;
    if (!isObj(value)) throw new CensusDataError(`${ref.rel} line ${l.line}: not an object`);
    if (value.$header !== undefined) continue;
    const identity = `${enumerator} ${stable(
      Object.fromEntries(OBSERVATION_IDENTITY.map((k) => [k, value[k] ?? null])),
    )}`;
    const { ref: _ignored, ...rest } = value;
    void _ignored;
    const digest = sha256(stable(rest));
    const have = out.get(identity);
    if (have) have.digests.push(digest);
    else out.set(identity, { digests: [digest], first: rest });
  }
  for (const v of out.values()) v.digests.sort(compareCodeUnits);
  return out;
}

function observationBuildsByEnumerator(paths: CensusPaths): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const f of listObservationFiles(paths)) {
    const s = m.get(f.enumerator);
    if (s) s.add(f.build);
    else m.set(f.enumerator, new Set([f.build]));
  }
  return m;
}

// ── The diff ──────────────────────────────────────────────────────────────────

const LOCATOR_IGNORE: ReadonlySet<string> = new Set(["build", "evidence", "probe"]);

/** Wave and battery named by a T5 evidence ref, or null when it names none. */
export function batteryOfRef(ref: string): { wave: string; battery: string } | null {
  const first = ref.split(/\s+/)[0] ?? "";
  const m = /^(w\d+)-[\w-]+$/i.exec(first.replace(/@[\w.]+$/, ""));
  if (!m) return null;
  return { wave: m[1].toLowerCase(), battery: first.replace(/@[\w.]+$/, "") };
}

export function diffSides(from: Side, to: Side): DiffReport {
  // Rows.
  const fromIds = new Set(from.rows.map((r) => r.id as string));
  const toIds = new Set(to.rows.map((r) => r.id as string));
  const onlyFrom = sortStrings([...fromIds].filter((i) => !toIds.has(i)));
  const onlyTo = sortStrings([...toIds].filter((i) => !fromIds.has(i)));

  // Locators.
  const lf = loadLocators(from);
  const lt = loadLocators(to);
  const locAdded = sortStrings([...lt.keys()].filter((k) => !lf.has(k)));
  const locRemoved = sortStrings([...lf.keys()].filter((k) => !lt.has(k)));
  const locChanged: FieldChange[] = [];
  for (const id of sortStrings([...lf.keys()].filter((k) => lt.has(k)))) {
    const fields = differingFields(lf.get(id)!, lt.get(id)!, LOCATOR_IGNORE);
    if (fields.length > 0) locChanged.push({ id, fields });
  }

  // Observations.
  const bf = observationBuildsByEnumerator(from.paths);
  const bt = observationBuildsByEnumerator(to.paths);
  const hasFrom = (e: string) => bf.get(e)?.has(from.build) === true;
  const hasTo = (e: string) => bt.get(e)?.has(to.build) === true;
  const enumerators = sortStrings(new Set([...bf.keys(), ...bt.keys()]));
  const onlyFromE = enumerators.filter((e) => hasFrom(e) && !hasTo(e));
  const onlyToE = enumerators.filter((e) => !hasFrom(e) && hasTo(e));
  const byEnumerator: DiffReport["observations"]["byEnumerator"] = {};
  const obsAdded: string[] = [];
  const obsRemoved: string[] = [];
  const obsChanged: FieldChange[] = [];
  for (const e of enumerators.filter((x) => hasFrom(x) && hasTo(x))) {
    const of = loadObservations(from, e);
    const ot = loadObservations(to, e);
    const c = { added: 0, removed: 0, changed: 0 };
    for (const id of sortStrings(ot.keys())) {
      if (!of.has(id)) {
        c.added++;
        obsAdded.push(id);
      }
    }
    for (const id of sortStrings(of.keys())) {
      const a = of.get(id)!;
      const b = ot.get(id);
      if (!b) {
        c.removed++;
        obsRemoved.push(id);
      } else if (a.digests.join() !== b.digests.join()) {
        c.changed++;
        const fields =
          a.digests.length === 1 && b.digests.length === 1
            ? differingFields(a.first, b.first, new Set())
            : ["(repeated key)"];
        obsChanged.push({ id, fields });
      }
    }
    byEnumerator[e] = c;
  }

  // Rows only on `from`: removed, or not re-walked (no full re-enumeration on `to`).
  const carry = carryOverFor(to.paths, from.build, to.build);
  const carried = new Set(carry.enumerators);
  const byId = new Map(from.rows.map((r) => [r.id as string, r]));
  const removed: string[] = [];
  const notRewalked: string[] = [];
  const notRewalkedBy: Record<string, number> = {};
  for (const id of onlyFrom) {
    const r = byId.get(id) ?? {};
    const srcs = (Array.isArray(r.sources) ? r.sources : []).filter(isObj);
    const onFrom = srcs.filter((x) => x.build === from.build);
    const enums = sortStrings(
      new Set((onFrom.length > 0 ? onFrom : srcs).map((x) => String(x.enumerator ?? "?"))),
    );
    if (enums.some((e) => hasTo(e) && !carried.has(e))) removed.push(id);
    else {
      notRewalked.push(id);
      const k = enums.join("+") || "(no source)";
      notRewalkedBy[k] = (notRewalkedBy[k] ?? 0) + 1;
    }
  }
  const notRewalkedBySorted = Object.fromEntries(
    Object.entries(notRewalkedBy).sort((a, b) => b[1] - a[1] || compareCodeUnits(a[0], b[0])),
  );

  // Stale T5, from both sides (Phase 7 update drill): (a) rows at T5 on the `from` side that are
  // not T5 on the `to` side, grouped by their `from`-side T5 evidence. build.ts grants T5 only
  // from a live result on the current build, so after a rebuild every carried-over proof shows up
  // here and nowhere on the `to` side; (b) rows at T5 on the `to` side with no T5 evidence ref on
  // the `to` build (a hand-written or carried ledger).
  const t5Refs = (r: Obj): string[] =>
    (Array.isArray(r.tier_evidence) ? r.tier_evidence : [])
      .filter((e): e is Obj => isObj(e) && e.tier === "T5" && typeof e.ref === "string")
      .map((e) => e.ref as string);
  const toTier = new Map(to.rows.map((r) => [r.id as string, r.tier]));
  const stale = new Map<string, string[]>();
  for (const r of from.rows) {
    if (r.tier !== "T5" || toTier.get(r.id as string) === "T5") continue;
    stale.set(r.id as string, t5Refs(r));
  }
  for (const r of to.rows) {
    if (r.tier !== "T5") continue;
    const t5 = t5Refs(r);
    if (t5.some((ref) => ref.endsWith(`@${to.build}`))) continue;
    stale.set(r.id as string, t5);
  }
  const byWave = new Map<string, Map<string, string[]>>();
  const staleCount = stale.size;
  for (const [id, t5] of stale) {
    const named = t5.map(batteryOfRef).filter((x): x is NonNullable<typeof x> => x !== null);
    const targets = named.length > 0 ? named : [{ wave: "(unnamed)", battery: "(unnamed)" }];
    for (const { wave, battery } of targets) {
      const w = byWave.get(wave) ?? new Map<string, string[]>();
      const list = w.get(battery) ?? [];
      if (!list.includes(id)) list.push(id);
      w.set(battery, list);
      byWave.set(wave, w);
    }
  }
  const staleByWave: Record<string, Record<string, string[]>> = {};
  for (const wave of sortStrings(byWave.keys())) {
    const w = byWave.get(wave)!;
    staleByWave[wave] = {};
    for (const b of sortStrings(w.keys())) staleByWave[wave][b] = sortStrings(w.get(b)!);
  }

  const report: DiffReport = {
    from: from.build,
    to: to.build,
    summary: {
      rowsOnlyFrom: onlyFrom.length,
      rowsRemoved: removed.length,
      rowsNotRewalked: notRewalked.length,
      rowsOnlyTo: onlyTo.length,
      locatorsAdded: locAdded.length,
      locatorsRemoved: locRemoved.length,
      locatorsChanged: locChanged.length,
      enumeratorsOnlyFrom: onlyFromE.length,
      enumeratorsOnlyTo: onlyToE.length,
      observationsAdded: obsAdded.length,
      observationsRemoved: obsRemoved.length,
      observationsChanged: obsChanged.length,
      staleT5Rows: staleCount,
      staleT5Batteries: Object.values(staleByWave).reduce((n, w) => n + Object.keys(w).length, 0),
    },
    rows: { onlyFrom, onlyTo, removed, notRewalked, notRewalkedBy: notRewalkedBySorted },
    carryOver: carry,
    locators: { added: locAdded, removed: locRemoved, changed: locChanged },
    observations: {
      enumeratorsOnlyFrom: onlyFromE,
      enumeratorsOnlyTo: onlyToE,
      byEnumerator,
      added: obsAdded,
      removed: obsRemoved,
      changed: obsChanged,
    },
    staleT5: { count: staleCount, byWave: staleByWave },
  };
  return report;
}

// ── Text output ───────────────────────────────────────────────────────────────

const LIST_LIMIT = 20;

function listBlock(title: string, items: string[], out: string[]): void {
  out.push(`${title}: ${items.length}`);
  for (const i of items.slice(0, LIST_LIMIT)) out.push(`  ${i}`);
  if (items.length > LIST_LIMIT) out.push(`  ... ${items.length - LIST_LIMIT} more (use --json)`);
}

export function renderText(r: DiffReport): string {
  const out: string[] = [`census diff ${r.from} -> ${r.to}`];
  for (const [k, v] of Object.entries(r.summary)) out.push(`  ${k}: ${v}`);
  listBlock(`rows removed (re-enumerated on ${r.to} in full and not seen)`, r.rows.removed, out);
  out.push(`rows not re-walked on ${r.to} (unknown, not removed): ${r.rows.notRewalked.length}`);
  for (const [k, n] of Object.entries(r.rows.notRewalkedBy)) out.push(`  ${k}: ${n}`);
  if (r.carryOver.enumerators.length > 0) {
    out.push(
      `  carry_over ${r.from} -> ${r.to} (${r.carryOver.evidence.join(", ")}): ${r.carryOver.enumerators.join(", ")}`,
    );
  }
  out.push(
    `enumerators with observations on ${r.from} only (one-time or not re-run): ${r.observations.enumeratorsOnlyFrom.join(", ") || "none"}`,
  );
  listBlock("rows only on " + r.to, r.rows.onlyTo, out);
  listBlock("locators added", r.locators.added, out);
  listBlock("locators removed", r.locators.removed, out);
  listBlock(
    "locators changed",
    r.locators.changed.map((c) => `${c.id} [${c.fields.join(", ")}]`),
    out,
  );
  listBlock(
    "observations changed",
    r.observations.changed.map((c) => `${c.id} [${c.fields.join(", ")}]`),
    out,
  );
  out.push(`stale T5 rows: ${r.staleT5.count}`);
  for (const [wave, batteries] of Object.entries(r.staleT5.byWave)) {
    out.push(`  ${wave}`);
    for (const [b, ids] of Object.entries(batteries)) out.push(`    ${b}: ${ids.length} rows`);
  }
  return out.join("\n");
}

// ── CLI ───────────────────────────────────────────────────────────────────────

const USAGE =
  "usage: diff-builds.ts --from <build> --to <build> [--data <dir>] [--from-ledger <path>] [--to-ledger <path>] [--json]";

export function run(argv: string[], io: Io = PROCESS_IO): number {
  return guard(io, "diff-builds", () => {
    const { values } = parseArgs({
      args: argv,
      options: {
        from: { type: "string" },
        to: { type: "string" },
        data: { type: "string" },
        "from-ledger": { type: "string" },
        "to-ledger": { type: "string" },
        json: { type: "boolean", default: false },
      },
      strict: true,
    });
    if (!values.from || !values.to) {
      io.err(`--from and --to are required\n${USAGE}`);
      return EXIT_USAGE;
    }
    if (values.from === values.to) {
      io.err(`--from and --to name the same build\n${USAGE}`);
      return EXIT_USAGE;
    }
    const dataPaths = pathsFrom(values.data);
    const from = loadSide(values.from, values["from-ledger"], "--from-ledger", dataPaths);
    if (typeof from === "string") {
      io.err(from);
      return EXIT_USAGE;
    }
    const to = loadSide(values.to, values["to-ledger"], "--to-ledger", dataPaths);
    if (typeof to === "string") {
      io.err(to);
      return EXIT_USAGE;
    }
    const report = diffSides(from, to);
    io.out(values.json ? JSON.stringify(report, null, 2) : renderText(report));
    return EXIT_OK;
  });
}

if (isMainModule(import.meta.url)) process.exitCode = run(process.argv.slice(2));
