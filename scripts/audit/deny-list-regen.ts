/**
 * Deny-list regeneration from the census ledger (read-only). Proposes, never writes.
 *
 * For every label on the policy's deny lists it reports the ui ledger rows that back it:
 *   - exact: ui rows whose label equals the deny label (what scripts/audit/live-safety.ts counts
 *     for a plain label; for X:confirm it counts the confirm controls, as here);
 *   - loose: ui rows whose label equals it ignoring case, a trailing "..." and an ampersand;
 *   - for an `X:confirm` entry: the dialogs whose label loosely equals X, and the confirm controls
 *     (OK, Yes, Publish, Login, Create, Save, Pack and the like) whose parent is one of them.
 * A row counts as live when a live census enumerator (L01 to L16) observed it.
 *
 * It then proposes additions: live ui rows of a clickable kind whose risk is one the policy's
 * risk_overrides names (destructive, credential, external), or whose label reads as a save-as,
 * publish, login, workshop, pack, delete, clear or reset item, and which no deny label covers.
 * Nothing is dropped: a label with no live row is marked static-only and kept.
 *
 * It writes no file. data/census/policy.json is the owner's to change (sign-off).
 *
 * --walks <file or folder> (repeatable) adds a live walker's raw `<Lnn>-*.obs.jsonl` lines (a
 * folder: its obs files, recursively) as if they were ledger rows, before they are ingested: each
 * ui line with a label becomes a row with the id normalise.ts would give it and one source
 * `<Lnn>@<--build>` (default `walk`). A line whose id is already a ledger row adds that source to
 * the row; nothing else of the row changes. A walk row has no ledger risk, so it is proposed by
 * label pattern only. This is a preview: live-safety.ts counts a walk only once normalise.ts and
 * build.ts have put it in the ledger.
 *
 * Usage: npx --no tsx scripts/audit/deny-list-regen.ts [--md | --json] [--walks <path>]... [--build <tag>]
 * Exit: 0, or 2 on a usage error.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { deriveId } from "../census/live/common.js";
import { REPO, denyLabels } from "./live-safety.js";

export const LIVE_ENUM = /^L\d{2}$/;
/** Labels a dialog's confirming control carries. */
export const CONFIRM_LABEL = /^(ok|yes|publish|login|log in|create|save|pack|apply|confirm|delete|remove|upload)$/i;
/** Kinds a person (or a GUI driver) can click. */
export const CLICKABLE = new Set(["menu-item", "toolbar-button", "control", "context-item", "button", "menu"]);
/** Labels that read as an item the deny lists exist for, whatever the ledger's risk says. */
export const NAME_PATTERN =
  /save (world )?as|publish|log ?in|logout|log ?out|workshop|pack project|delete|remove from|clear all|reset default|force save|user profile|pending invitation|import|export|bake|batch|re-?save|vcs commit|regenerate|save all|save rdb|update all|creator|apply changes to prefab|build shore/i;

export interface LedgerRow {
  id: string;
  dim?: string;
  kind?: string;
  module?: string | null;
  parent?: string | null;
  label?: string;
  risk?: string;
  risk_floor?: string;
  sources?: Array<{ build?: string; enumerator?: string }>;
}

export interface RowRef {
  id: string;
  risk: string;
  live: boolean;
  /** enumerator@build of each source. */
  sources: string[];
}

export interface LabelEvidence {
  list: string;
  label: string;
  confirm: boolean;
  exact: RowRef[];
  loose: RowRef[];
  dialogs: RowRef[];
  confirmControls: RowRef[];
  /** "live": a live row backs the label (for :confirm, a live confirm control or a live dialog). */
  verdict: "live" | "static-only" | "no-row";
  note: string;
}

export interface Candidate {
  label: string;
  rows: RowRef[];
  modules: string[];
  why: string;
}

export interface RegenReport {
  ledgerUiRows: number;
  /** With --walks: the obs files read, and how many walk rows were new ids or merged into a row. */
  walks?: { files: string[]; rows: number; added: number; merged: number; build: string };
  riskClasses: string[];
  labels: LabelEvidence[];
  candidates: Candidate[];
}

export function looseKey(label: string): string {
  return label
    .replace(/&/g, "")
    .replace(/\.\.\.$|…$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isLive(r: LedgerRow): boolean {
  return (r.sources ?? []).some((s) => LIVE_ENUM.test(String(s.enumerator ?? "")));
}

function ref(r: LedgerRow): RowRef {
  return {
    id: r.id,
    risk: String(r.risk ?? ""),
    live: isLive(r),
    sources: [...new Set((r.sources ?? []).map((s) => `${s.enumerator ?? "?"}@${s.build ?? "?"}`))],
  };
}

export function parseUiRows(lines: Iterable<string>): LedgerRow[] {
  const out: LedgerRow[] = [];
  for (const line of lines) {
    if (!line.includes('"dim":"ui"')) continue;
    try {
      const r = JSON.parse(line) as LedgerRow;
      if (r.dim === "ui" && typeof r.label === "string") out.push(r);
    } catch {
      // a torn line is not a row
    }
  }
  return out;
}

/** A raw walker line (only the fields this script reads). */
interface WalkLine {
  dim?: string;
  kind?: string;
  module?: string;
  key?: unknown;
  label?: string;
  label_raw?: string;
  parent_key?: { dim?: string; kind?: string; module?: string; key?: unknown } | null;
}

/** The enumerator of a walker obs file from its name (`L02-WorldEditor-edit-none.obs.jsonl`). */
export function walkEnumerator(file: string): string | null {
  const m = /^(L\d{2})-/.exec(basename(file));
  return m ? m[1]! : null;
}

/**
 * The ui lines with a label of one walker obs file, as ledger rows: the id and parent id
 * normalise.ts derives, the walker's label (as the ledger's label; label_raw only when there is none), and one
 * source `<enumerator>@<build>`.
 */
export function walkRows(lines: Iterable<string>, enumerator: string, build: string): LedgerRow[] {
  const out: LedgerRow[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    let o: WalkLine;
    try {
      o = JSON.parse(line) as WalkLine;
    } catch {
      continue;
    }
    const label = typeof o.label === "string" ? o.label : o.label_raw;
    if (o.dim !== "ui" || typeof label !== "string" || !o.kind || !o.module) continue;
    const id = deriveId(o as Parameters<typeof deriveId>[0]);
    const pk = o.parent_key;
    const parent =
      pk && pk.kind && pk.module ? deriveId({ dim: "ui", ...pk } as Parameters<typeof deriveId>[0]) : null;
    out.push({ id, dim: "ui", kind: o.kind, module: o.module, parent, label, sources: [{ build, enumerator }] });
  }
  return out;
}

/** The ledger rows plus the walk rows: a walk row on an existing id adds its source only. */
export function mergeRows(
  ledger: readonly LedgerRow[],
  walk: readonly LedgerRow[],
): { rows: LedgerRow[]; added: number; merged: number } {
  const byId = new Map<string, LedgerRow>();
  for (const r of ledger) byId.set(r.id, { ...r, sources: [...(r.sources ?? [])] });
  let added = 0;
  let merged = 0;
  for (const w of walk) {
    const have = byId.get(w.id);
    if (!have) {
      byId.set(w.id, { ...w, sources: [...(w.sources ?? [])] });
      added++;
      continue;
    }
    const seen = new Set((have.sources ?? []).map((x) => `${x.enumerator}@${x.build}`));
    for (const x of w.sources ?? []) if (!seen.has(`${x.enumerator}@${x.build}`)) have.sources!.push(x);
    merged++;
  }
  return { rows: [...byId.values()], added, merged };
}

/** Every walker obs file under the given paths (a folder: recursively, sorted). */
export function walkFiles(paths: readonly string[]): string[] {
  const out: string[] = [];
  const visit = (p: string): void => {
    if (statSync(p).isDirectory()) {
      for (const n of readdirSync(p).sort()) visit(join(p, n));
    } else if (p.endsWith(".obs.jsonl") && walkEnumerator(p)) out.push(p);
  };
  for (const p of paths) visit(p);
  return out;
}

/** The risk classes the policy escalates (risk_overrides keys), else the hard-coded three. */
export function escalatedRisks(policy: unknown): string[] {
  const o = (policy as Record<string, unknown>)?.risk_overrides;
  const keys = o && typeof o === "object" ? Object.keys(o as object).filter((k) => !k.startsWith("$")) : [];
  return keys.length ? keys : ["destructive", "credential", "external"];
}

export function regen(policy: unknown, rows: readonly LedgerRow[]): RegenReport {
  const byLoose = new Map<string, LedgerRow[]>();
  const byParent = new Map<string, LedgerRow[]>();
  for (const r of rows) {
    const k = looseKey(r.label!);
    (byLoose.get(k) ?? byLoose.set(k, []).get(k)!).push(r);
    if (r.parent) (byParent.get(r.parent) ?? byParent.set(r.parent, []).get(r.parent)!).push(r);
  }
  const labels: LabelEvidence[] = denyLabels(policy).map(({ list, label }) => {
    const confirm = label.endsWith(":confirm");
    const base = label.replace(/:confirm$/, "");
    const loose = byLoose.get(looseKey(base)) ?? [];
    const exact = loose.filter((r) => r.label === base);
    // A dialog named X; failing that, one whose name starts with X ("Publish" -> "Publish Project").
    const named = loose.filter((r) => r.kind === "dialog");
    const dialogs = !confirm
      ? []
      : named.length
        ? named
        : rows.filter((r) => r.kind === "dialog" && looseKey(r.label!).startsWith(`${looseKey(base)} `));
    const confirmControls = dialogs.flatMap((d) =>
      (byParent.get(d.id) ?? []).filter((c) => CONFIRM_LABEL.test(String(c.label).trim())),
    );
    let verdict: LabelEvidence["verdict"];
    let note: string;
    if (confirm) {
      if (confirmControls.some(isLive)) {
        verdict = "live";
        note = `live confirm control ${confirmControls.filter(isLive).map((c) => `'${c.label}'`).join(", ")} in ${[...new Set(confirmControls.filter(isLive).map((c) => c.parent))].join(", ")}`;
      } else if (dialogs.some(isLive)) {
        verdict = "live";
        note = "live dialog; its confirm control is not in the ledger";
      } else if (dialogs.length || loose.length) {
        verdict = "static-only";
        note = dialogs.length ? "dialog seen by a static enumerator only" : `no dialog named '${base}'; only the opener`;
      } else {
        verdict = "no-row";
        note = `no ui row named '${base}'`;
      }
      if (exact.length && !dialogs.length) note += "; the opener's own rows do not count";
    } else if (exact.some(isLive)) {
      verdict = "live";
      note = `${exact.filter(isLive).length} live row(s)`;
    } else if (loose.some(isLive)) {
      verdict = "live";
      note = `live only under a different spelling: ${[...new Set(loose.filter(isLive).map((r) => `'${r.label}'`))].join(", ")}`;
    } else if (loose.length) {
      verdict = "static-only";
      note = "static enumerators only";
    } else {
      verdict = "no-row";
      note = `no ui row named '${base}'`;
    }
    return {
      list,
      label,
      confirm,
      exact: exact.map(ref),
      loose: loose.filter((r) => r.label !== base).map(ref),
      dialogs: dialogs.map(ref),
      confirmControls: confirmControls.map(ref),
      verdict,
      note,
    };
  });

  const covered = new Set(denyLabels(policy).map((d) => looseKey(d.label.replace(/:confirm$/, ""))));
  const risks = new Set(escalatedRisks(policy));
  const groups = new Map<string, LedgerRow[]>();
  for (const r of rows) {
    if (!isLive(r) || !CLICKABLE.has(String(r.kind)) || CONFIRM_LABEL.test(String(r.label).trim())) continue;
    const k = looseKey(r.label!);
    if (!k || covered.has(k) || k.startsWith("@")) continue;
    if (!risks.has(String(r.risk)) && !NAME_PATTERN.test(r.label!)) continue;
    (groups.get(r.label!) ?? groups.set(r.label!, []).get(r.label!)!).push(r);
  }
  const candidates: Candidate[] = [...groups.entries()]
    .map(([label, rs]) => {
      const rk = [...new Set(rs.map((r) => String(r.risk)))];
      const byRisk = rk.filter((x) => risks.has(x));
      return {
        label,
        rows: rs.map(ref),
        modules: [...new Set(rs.map((r) => String(r.module ?? "none")))].sort(),
        why: byRisk.length ? `ledger risk ${byRisk.join(", ")}` : `label pattern (ledger risk ${rk.join(", ")})`,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
  return { ledgerUiRows: rows.length, riskClasses: [...risks], labels, candidates };
}

// ── Rendering ────────────────────────────────────────────────────────────────

const liveRefs = (rs: RowRef[]): string =>
  rs.filter((r) => r.live).map((r) => `${r.id} (${r.sources.filter((s) => LIVE_ENUM.test(s.split("@")[0]!)).join(", ")})`).join("; ");

export function renderText(r: RegenReport): string {
  const out = [`Deny-list regeneration (read-only): ${r.ledgerUiRows} labelled ui rows, escalated risks ${r.riskClasses.join(", ")}`, ""];
  for (const l of r.labels)
    out.push(
      `${l.verdict.padEnd(11)} ${l.list} :: ${l.label}  [exact ${l.exact.length}, other spellings ${l.loose.length}${l.confirm ? `, dialogs ${l.dialogs.length}, confirm controls ${l.confirmControls.length}` : ""}] ${l.note}`,
    );
  out.push("", `Candidates (${r.candidates.length}):`);
  for (const c of r.candidates) out.push(`  ${c.label}  [${c.modules.join(", ")}] ${c.why}; ${c.rows.length} live row(s)`);
  return out.join("\n");
}

export function renderMarkdown(r: RegenReport): string {
  const out = [
    "| Deny list | Label | Verdict | Exact rows (live) | Backing live evidence | Note |",
    "|---|---|---|---|---|---|",
  ];
  for (const l of r.labels) {
    const ev = l.confirm ? liveRefs(l.confirmControls) || liveRefs(l.dialogs) : liveRefs(l.exact) || liveRefs(l.loose);
    out.push(
      `| ${l.list} | ${l.label} | ${l.verdict} | ${l.exact.length} (${l.exact.filter((x) => x.live).length}) | ${ev || "none"} | ${l.note} |`,
    );
  }
  out.push("", "| Candidate label | Modules | Why | Live rows |", "|---|---|---|---|");
  for (const c of r.candidates)
    out.push(`| ${c.label} | ${c.modules.join(", ")} | ${c.why} | ${c.rows.map((x) => x.id).join("<br>")} |`);
  return out.join("\n");
}

export interface Io {
  out: (s: string) => void;
  err: (s: string) => void;
}

export const USAGE =
  "usage: deny-list-regen.ts [--md | --json] [--walks <obs file or folder>]... [--build <tag>]";

export function run(argv: string[], io: Io = { out: console.log, err: console.error }, root = REPO): number {
  let values: { md?: boolean; json?: boolean; walks?: string[]; build?: string };
  try {
    values = parseArgs({
      args: argv,
      options: {
        md: { type: "boolean" },
        json: { type: "boolean" },
        walks: { type: "string", multiple: true },
        build: { type: "string" },
      },
      allowPositionals: false,
      strict: true,
    }).values;
  } catch {
    io.err(`${USAGE} (got: ${argv.join(" ")})`);
    return 2;
  }
  if ((values.md && values.json) || (values.build !== undefined && !values.walks?.length)) {
    io.err(`${USAGE} (got: ${argv.join(" ")})`);
    return 2;
  }
  const policy = JSON.parse(readFileSync(join(root, "data", "census", "policy.json"), "utf-8")) as unknown;
  const ledgerPath = join(root, "data", "census", "ledger.jsonl");
  let rows = existsSync(ledgerPath) ? parseUiRows(readFileSync(ledgerPath, "utf-8").split("\n")) : [];
  let walks: RegenReport["walks"];
  if (values.walks?.length) {
    const missing = values.walks.filter((p) => !existsSync(p));
    if (missing.length) {
      io.err(`deny-list-regen: no such walk file or folder: ${missing.join(", ")}`);
      return 2;
    }
    const build = values.build ?? "walk";
    const files = walkFiles(values.walks);
    const wr = files.flatMap((f) => walkRows(readFileSync(f, "utf-8").split("\n"), walkEnumerator(f)!, build));
    const m = mergeRows(rows, wr);
    rows = m.rows;
    walks = { files, rows: wr.length, added: m.added, merged: m.merged, build };
  }
  const report: RegenReport = { ...regen(policy, rows), ...(walks ? { walks } : {}) };
  const head = walks
    ? `walks: ${walks.files.length} obs file(s), ${walks.rows} labelled ui line(s) at ${walks.build}: ${walks.merged} on existing rows, ${walks.added} new id(s) (not ingested)\n`
    : "";
  io.out(values.json ? JSON.stringify(report, null, 2) : head + (values.md ? renderMarkdown(report) : renderText(report)));
  return 0;
}

const isMain = (() => {
  try {
    return resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();
if (isMain) process.exitCode = run(process.argv.slice(2));
