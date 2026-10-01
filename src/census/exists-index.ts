/**
 * The existence oracle behind `exists.ts` (plan 3.3 existence rule, main
 * ruling 13). Reads only `observations/E02`, `E05` and `E04`: the script
 * source index, the executable tables and the NET surface. Exact match by
 * default; `ci` opts into case-insensitive matching. Never fuzzy: a miss
 * prints near candidates and still answers "not found".
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { compareCodeUnits, splitLines } from "./canon.js";
import { deriveId, normalizeLabel } from "./ids.js";
import type { CensusPaths } from "./ledger-io.js";
import { observationSchema } from "./schemas.js";

/** The enumerators `exists.ts` trusts (ruling 13). */
export const EXISTS_ENUMERATORS = ["E02", "E05", "E04"] as const;

export interface ExistsEntry {
  id: string;
  kind: string;
  enumerator: string;
  build: string;
  ref: string;
  confidence: string;
  /** Every exact form the entry answers to. */
  forms: string[];
}

export interface ExistsIndex {
  entries: ExistsEntry[];
  /** Enumerators whose observation directory has at least one file. */
  present: string[];
}

function formsOf(id: string, o: ReturnType<typeof observationSchema.parse>): string[] {
  const k = o.key;
  const forms = new Set<string>([id]);
  for (const v of [
    k.class,
    k.method,
    k.member,
    k.attr,
    k.native,
    k.handler,
    k.req,
    k.resp,
    k.object_name,
    k.name,
    k.key,
    k.section,
  ]) {
    if (v) forms.add(v);
  }
  if (k.switch) {
    forms.add(k.switch);
    forms.add(`-${k.switch.replace(/^-+/, "")}`);
  }
  if (k.class && k.method) forms.add(`${k.class}.${k.method}`);
  if (k.class && k.member) forms.add(`${k.class}.${k.member}`);
  for (const v of [o.label, o.label_raw, o.object_name, o.class_name])
    if (v) forms.add(normalizeLabel(v));
  return [...forms];
}

/** Loads E02/E05/E04 observations of every build. Lines that fail the schema are skipped. */
export function loadExistsIndex(paths: CensusPaths): ExistsIndex {
  const entries: ExistsEntry[] = [];
  const present: string[] = [];
  for (const e of EXISTS_ENUMERATORS) {
    const dir = join(paths.observations, e);
    if (!existsSync(dir)) continue;
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".jsonl"))
      .sort(compareCodeUnits);
    if (files.length === 0) continue;
    present.push(e);
    for (const f of files) {
      const build = f.slice(0, -".jsonl".length);
      const lines = splitLines(readFileSync(join(dir, f), "utf-8"));
      for (let i = 1; i < lines.length; i++) {
        let value: unknown;
        try {
          value = JSON.parse(lines[i]);
        } catch {
          continue;
        }
        const r = observationSchema.safeParse(value);
        if (!r.success) continue;
        let id: string;
        try {
          id = deriveId(r.data);
        } catch {
          continue;
        }
        entries.push({
          id,
          kind: r.data.kind,
          enumerator: e,
          build,
          ref: r.data.ref,
          confidence: r.data.confidence,
          forms: formsOf(id, r.data),
        });
      }
    }
  }
  return { entries, present: present.sort(compareCodeUnits) };
}

export interface ExistsAnswer {
  found: ExistsEntry[];
  near: string[];
}

/** Exact lookup (code-unit equality, or case-insensitive with `ci`), with near candidates on a miss. */
export function lookup(
  index: ExistsIndex,
  symbol: string,
  opts: { ci?: boolean; kind?: string } = {},
): ExistsAnswer {
  const s = opts.ci ? symbol.toLowerCase() : symbol;
  const pool = opts.kind ? index.entries.filter((e) => e.kind === opts.kind) : index.entries;
  const found = pool
    .filter((e) => e.forms.some((f) => (opts.ci ? f.toLowerCase() : f) === s))
    .sort((a, b) =>
      compareCodeUnits(`${a.id} ${a.enumerator} ${a.build}`, `${b.id} ${b.enumerator} ${b.build}`),
    );
  if (found.length > 0) return { found, near: [] };
  const lower = symbol.toLowerCase();
  const near = new Set<string>();
  for (const e of pool) {
    for (const f of e.forms) {
      const fl = f.toLowerCase();
      if (fl === lower || fl.startsWith(lower) || (lower.startsWith(fl) && fl.length >= 3))
        near.add(f);
    }
  }
  return { found: [], near: [...near].sort(compareCodeUnits).slice(0, 5) };
}
