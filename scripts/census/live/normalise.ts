/**
 * The NORMALISER's deterministic merge (design D1, D3, D18): every raw `*.obs.jsonl` file of one
 * live enumerator (the walkers' run folders) into the one committed observation file
 * `data/census/observations/<Lnn>/<build>.jsonl` that `build.ts` reads, with a fresh header.
 *
 *   npx --no tsx scripts/census/live/normalise.ts --enumerator L01 [--build <tag>] [--data <dir>]
 *       [--fresh] [--check] [--shared-chrome <module>] <raw file or run folder>...
 *
 * Inputs are taken in the order given (a folder: its `<Lnn>-*.obs.jsonl` files, recursively, sorted
 * by path), after the committed file's own lines unless `--fresh`: a later input is a later
 * sitting. Every line must pass `validateLine`. Merge (D3): the key is (derived id, state key);
 * the later sitting's line wins; when the two labels differ the earlier `ref` is added to the
 * winner's `unverified` as `also seen: <ref>`. A later input holding a module's `window` line is a
 * whole-window walk: the earlier rows of that module in the states it carries, which it does not
 * emit, are dropped (fix-up 3). Likewise a later input that re-emits a parent with `children_count`
 * states that parent's children in full: its earlier children in that state, which the later input
 * does not emit, are dropped (DEC-088; a sub-editor walk files shared chrome under the base module,
 * so no window line covers it). Output sorted by (id, state key), canonical JSONL,
 * header `{$header, build, enumerator, generator, provisional, row_count}` with the generator and
 * provisional flag universes.json registers (build-ledger header check).
 *
 * --check  write nothing; exit 1 when the committed file differs from the merge.
 * --shared-chrome <module>  file the window chrome of `<module>.<X>` walks under `<module>`
 *          (`attributeSharedChrome`; the chrome ids are `<module>`'s rows in the committed
 *          live observation files).
 * Exit: 0 written or equal, 1 a rejected line or --check found a difference, 2 usage.
 */

import { existsSync, readFileSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { compareCodeUnits, jsonlLine, splitLines, toLf } from "../../../src/census/canon.js";
import { writeFileAtomic } from "../../../src/census/ledger-io.js";
import { REPO_ROOT } from "../../live/paths.js";
import {
  deriveId,
  isMainModule,
  rekeyDockTabs,
  stateKey,
  validateLine,
  type LiveObservation,
} from "./common.js";

export const USAGE =
  "usage: normalise.ts --enumerator L<nn> [--build <tag>] [--data <dir>] [--fresh] [--check] [--shared-chrome <module>] <raw file or folder>...";

export interface EnumeratorDef {
  generator: string;
  provisional?: boolean;
}

export interface MergeInput {
  /** Where the lines came from (for messages). */
  source: string;
  text: string;
}

export interface MergeResult {
  text: string;
  rows: number;
  rejected: Array<{ source: string; line: number; reason: string }>;
  replaced: number;
  /** Earlier rows dropped because a later whole-window walk of their scope did not emit them. */
  superseded: number;
}

/** The registered generator and provisional flag of an enumerator. */
export function enumeratorDef(dataDir: string, enumerator: string): EnumeratorDef | null {
  const u = JSON.parse(readFileSync(join(dataDir, "universes.json"), "utf-8")) as {
    enumerators: Record<string, EnumeratorDef>;
  };
  return u.enumerators[enumerator] ?? null;
}

/**
 * The shared-chrome attribution of a sub-editor walk (P4-9 runbook, main's ruling 3; DEC-059).
 * A sub-editor `<base>.<X>` is a tab of the `<base>` window, and its walk reads the whole window.
 * A line of module `<base>.<X>` is the window's chrome, and is filed under `<base>`, when
 * `ui:<base>/...` with the same kind and key is a row some live walk of `<base>` already
 * produced (`ids`: the window itself, its menubar titles, title bar, docks, status bar), or when
 * one of its ancestors in the same walk other than the window is such a row (a dock's or the
 * status bar's children). Everything else is the tab's own and stays under `<base>.<X>`; a
 * `parent_key` that names a chrome row is re-pointed to `<base>` as well. Mutates the lines.
 */
export interface SharedChrome {
  base: string;
  ids: ReadonlySet<string>;
}

export function attributeSharedChrome(lines: LiveObservation[], chrome: SharedChrome): void {
  const prefix = `${chrome.base}.`;
  const isSub = (m: string): boolean =>
    m.startsWith(prefix) && !m.slice(prefix.length).includes(".");
  type Keyed = {
    dim: string;
    kind: LiveObservation["kind"];
    module: string;
    key: LiveObservation["key"];
  };
  const idOf = (o: Keyed): string => deriveId(o as LiveObservation);
  const asBase = (o: Keyed): string => idOf({ ...o, module: chrome.base });
  const parentOf = new Map<string, LiveObservation["parent_key"]>();
  for (const l of lines) if (isSub(l.module)) parentOf.set(deriveId(l), l.parent_key);
  const memo = new Map<string, boolean>();
  const isChrome = (o: Keyed): boolean => {
    if (!isSub(o.module)) return false;
    const id = idOf(o);
    const known = memo.get(id);
    if (known !== undefined) return known;
    memo.set(id, false); // a cycle is not chrome
    let result = chrome.ids.has(asBase(o));
    const seen = new Set<string>([id]);
    for (let p = parentOf.get(id); !result && p && isSub(p.module); p = parentOf.get(idOf(p))) {
      const pid = idOf(p);
      if (seen.has(pid)) break;
      seen.add(pid);
      if (p.kind !== "window" && chrome.ids.has(asBase(p))) result = true;
    }
    memo.set(id, result);
    return result;
  };
  const flags = lines.map((l) => isChrome(l));
  lines.forEach((l, i) => {
    if (l.parent_key && isChrome(l.parent_key))
      l.parent_key = { ...l.parent_key, module: chrome.base };
    if (flags[i]) l.module = chrome.base;
  });
}

/** Merge inputs (earliest first) into the committed file text. Pure. */
export function mergeObservations(
  inputs: readonly MergeInput[],
  header: { enumerator: string; build: string; def: EnumeratorDef },
  options: { sharedChrome?: SharedChrome } = {},
): MergeResult {
  const rejected: MergeResult["rejected"] = [];
  const byKey = new Map<string, { id: string; sk: string; line: LiveObservation }>();
  let replaced = 0;
  let superseded = 0;
  for (const input of inputs) {
    const lines = splitLines(toLf(input.text)).filter((l) => l.trim() !== "");
    const valid: LiveObservation[] = [];
    lines.forEach((raw, i) => {
      let o: unknown;
      try {
        o = JSON.parse(raw);
      } catch {
        rejected.push({ source: input.source, line: i + 1, reason: "not JSON" });
        return;
      }
      if (o && typeof o === "object" && "$header" in o) return;
      const problems = validateLine(o, header.enumerator);
      if (problems.length) {
        rejected.push({ source: input.source, line: i + 1, reason: problems.join("; ") });
        return;
      }
      valid.push(o as LiveObservation);
    });
    // DEC-090: dock tabs keyed by name, in the committed lines as in the new ones (the carry of
    // the lines written before the re-key; the walker emits the new key itself).
    if (header.enumerator === "L01") rekeyDockTabs(valid);
    // Fix-up 3 (W8 run 4): a whole-window walk supersedes the earlier sittings' rows of its
    // scope. The scope is each (module, state key) the input carries for a module whose `window`
    // line it holds, taken before shared-chrome attribution (a sub-editor walk never claims its
    // base module). An earlier row in such a scope that this input does not emit is dropped: the
    // RM re-walk re-keyed two consoleDockContents children (qt_scrollarea_hcontainer became
    // @QWidget.2, @QSplitterHandle.1 became qt_splithandle_), the old keys survived the per-key
    // merge, and build-ledger counted 13 children against the walk's children_count 11.
    const walked = new Set(valid.filter((l) => l.kind === "window").map((l) => l.module));
    const scopes = new Set(
      valid
        .filter((l) => walked.has(l.module))
        .map((l) => `${l.module}\u0000${stateKey(l.observed_state)}`),
    );
    if (options.sharedChrome) attributeSharedChrome(valid, options.sharedChrome);
    // DEC-088 (W8 run 8): a re-emitted parent that states its children_count re-emits its whole
    // child set in that state. An earlier child of it this input does not emit is dropped too.
    // The sub-editor re-walks file the RM console dock under ResourceManager (shared chrome), so
    // no window scope covers it: the old key qt_splithandle_ survived beside the new
    // @QSplitterHandle.1, and build-ledger counted 13 children of consoleDockContents against 12.
    const counted = new Set(
      valid
        .filter((l) => l.children_count !== undefined)
        .map((l) => `${deriveId(l)}\u0000${stateKey(l.observed_state)}`),
    );
    if (scopes.size || counted.size) {
      const emits = new Set(valid.map((l) => `${deriveId(l)}\u0000${stateKey(l.observed_state)}`));
      for (const [k, prev] of byKey) {
        if (emits.has(k)) continue;
        const p = prev.line.parent_key;
        const inScope = scopes.has(`${prev.line.module}\u0000${prev.sk}`);
        const underCounted =
          p !== null && counted.has(`${deriveId(p as LiveObservation)}\u0000${prev.sk}`);
        if ((inScope || underCounted) && byKey.delete(k)) superseded++;
      }
    }
    for (const line of valid) {
      const id = deriveId(line);
      const sk = stateKey(line.observed_state);
      const k = `${id}\u0000${sk}`;
      const prev = byKey.get(k);
      if (prev) {
        replaced++;
        if (prev.line.label !== line.label && prev.line.ref !== line.ref) {
          const note = `also seen: ${prev.line.ref}`;
          const un = [...(line.unverified ?? [])];
          if (!un.includes(note)) un.push(note);
          line.unverified = un;
        }
      }
      byKey.set(k, { id, sk, line });
    }
  }
  const rows = [...byKey.values()].sort(
    (a, b) => compareCodeUnits(a.id, b.id) || compareCodeUnits(a.sk, b.sk),
  );
  const head = {
    $header: 1,
    build: header.build,
    enumerator: header.enumerator,
    generator: header.def.generator,
    provisional: header.def.provisional ?? false,
    row_count: rows.length,
  };
  const text =
    [jsonlLine(head, ["$header"]), ...rows.map((r) => jsonlLine(r.line))].join("\n") + "\n";
  return { text, rows: rows.length, rejected, replaced, superseded };
}

/** Raw files of `enumerator` under a folder, recursively, sorted by path. */
export function rawFilesIn(dir: string, enumerator: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d).sort(compareCodeUnits)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.startsWith(`${enumerator}-`) && name.endsWith(".obs.jsonl")) out.push(p);
    }
  };
  walk(dir);
  return out.sort(compareCodeUnits);
}

/** Row ids of `module` in every committed live observation file (`observations/L<nn>/*.jsonl`). */
export function liveIdsOfModule(dataDir: string, module: string): Set<string> {
  const ids = new Set<string>();
  const root = join(dataDir, "observations");
  if (!existsSync(root)) return ids;
  for (const e of readdirSync(root).sort(compareCodeUnits)) {
    if (!/^L\d{2}$/.test(e)) continue;
    for (const f of readdirSync(join(root, e)).sort(compareCodeUnits)) {
      if (!f.endsWith(".jsonl")) continue;
      for (const raw of splitLines(toLf(readFileSync(join(root, e, f), "utf-8")))) {
        if (raw.trim() === "") continue;
        const o = JSON.parse(raw) as LiveObservation & { $header?: number };
        if (o.$header === undefined && o.module === module) ids.add(deriveId(o));
      }
    }
  }
  return ids;
}

export interface Io {
  out: (line: string) => void;
  err: (line: string) => void;
}

export function run(argv: string[], io: Io = { out: console.log, err: console.error }): number {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        enumerator: { type: "string" },
        build: { type: "string" },
        data: { type: "string" },
        fresh: { type: "boolean" },
        check: { type: "boolean" },
        "shared-chrome": { type: "string" },
      },
    });
  } catch (e) {
    io.err(`${e instanceof Error ? e.message : String(e)}\n${USAGE}`);
    return 2;
  }
  const v = parsed.values;
  const enumerator = v.enumerator;
  if (!enumerator || !/^L\d{2}$/.test(enumerator)) {
    io.err(USAGE);
    return 2;
  }
  const dataDir = resolve(v.data ?? join(REPO_ROOT, "data", "census"));
  const build =
    v.build ??
    (JSON.parse(readFileSync(join(dataDir, "current-build.json"), "utf-8")) as { tag: string }).tag;
  const def = enumeratorDef(dataDir, enumerator);
  if (!def) {
    io.err(`${enumerator} is not registered in universes.json`);
    return 2;
  }
  const target = join(dataDir, "observations", enumerator, `${build}.jsonl`);
  const inputs: MergeInput[] = [];
  if (!v.fresh && existsSync(target))
    inputs.push({ source: "committed", text: readFileSync(target, "utf-8") });
  for (const p of parsed.positionals) {
    if (!existsSync(p)) {
      io.err(`${p} does not exist`);
      return 2;
    }
    const files = statSync(p).isDirectory() ? rawFilesIn(p, enumerator) : [p];
    for (const f of files) inputs.push({ source: f, text: readFileSync(f, "utf-8") });
  }
  const base = v["shared-chrome"];
  const r = mergeObservations(
    inputs,
    { enumerator, build, def },
    base ? { sharedChrome: { base, ids: liveIdsOfModule(dataDir, base) } } : {},
  );
  for (const x of r.rejected.slice(0, 50)) io.err(`rejected ${x.source}:${x.line}: ${x.reason}`);
  if (r.rejected.length) {
    io.err(`${r.rejected.length} line(s) rejected; nothing written`);
    return 1;
  }
  const committed = existsSync(target) ? toLf(readFileSync(target, "utf-8")) : null;
  if (v.check) {
    if (committed !== r.text) {
      io.out(`${enumerator}: ${build}.jsonl differs from the merge (${r.rows} rows)`);
      return 1;
    }
    io.out(`${enumerator}: ${build}.jsonl is current (${r.rows} rows)`);
    return 0;
  }
  if (committed !== r.text) {
    mkdirSync(dirname(target), { recursive: true });
    writeFileAtomic(target, r.text);
  }
  io.out(
    `${enumerator}: ${r.rows} rows (${r.replaced} replaced by a later sitting, ${r.superseded} dropped as not re-emitted by a later walk of their window and state) -> ${build}.jsonl`,
  );
  return 0;
}

if (isMainModule(import.meta.url)) process.exitCode = run(process.argv.slice(2));
