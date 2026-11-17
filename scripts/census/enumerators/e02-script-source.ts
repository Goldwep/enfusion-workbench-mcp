/**
 * E02 — script-source index (plan 4.5; DEC-018).
 *
 * One parse of every `.c` file under `scripts/` in the game paks (read
 * through `src/pak/vfs.ts`, never unpacked, nothing executed) feeds two
 * outputs:
 *
 *  1. The source index: every class, enum, enum value, method, member
 *     variable, attribute use, typedef and global function with file, line,
 *     `#ifdef` guards and doc comment, written to the artifacts folder as
 *     `census/<build>/E02/source-index.jsonl` (`src/census/source-index.ts`
 *     builds, saves and loads it). Never committed.
 *  2. Observation rows for the Workbench API scope of plan 1.4 only:
 *     declarations in files under the seven folders of `WORKBENCH_SCOPE`,
 *     plus the helper classes named in `HELPER_CLASSES` (DEC-018; empty at
 *     Phase 1). Kinds: class, enum, enum-value, method, static-method, event
 *     (a method declared `event`). Attribute rows are E15's; member
 *     variables, typedefs and global functions have no row kind and are
 *     reported as left out. Rows that share a key (a modded class repeating
 *     a method, an `#ifdef` pair) are merged into one row and reported with
 *     the reason.
 *
 * It also writes `census/<build>/E02/undocumented.json` to the artifacts
 * folder: the emitted rows with no `what`, counted per kind, and the
 * classes and methods among them listed (a report; no row changes).
 *
 *   npx tsx scripts/census/enumerators/e02-script-source.ts [--build <tag>] [--game <dir>]
 *       [--out <file under observations/E02/>] [--data <dir>] [--counts] [--json]
 *
 * --counts  also print the headline counts (plan 2.1, 2.3) measured on this parse
 *
 * Exit: 0 written; 1 a file failed to parse that is not in
 * `EXPECTED_PARSE_FAILURES`, or a `HELPER_CLASSES` name is declared nowhere
 * (outputs are still written), or --out refused; 2 usage or no game install
 * (NO DATA); 3 malformed census configuration.
 */
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { compareCodeUnits, jsonlLine } from "../../../src/census/canon.js";
import { loadCurrentBuild } from "../../../src/census/census-config.js";
import { firstSentence, lex } from "../../../src/census/enforce-source.js";
import { containsMachinePath } from "../../../src/census/hygiene.js";
import { deriveId } from "../../../src/census/ids.js";
import { writeFileAtomic, type CensusPaths } from "../../../src/census/ledger-io.js";
import { observationSchema, type Observation } from "../../../src/census/schemas.js";
import {
  buildSourceIndex,
  classChain,
  pakRef,
  recordKind,
  saveSourceIndex,
  subclassesOf,
  type ClassRecord,
  type EnumRecord,
  type EnumValueRecord,
  type MethodRecord,
  type SourceIndex,
  type SourceRecord,
} from "../../../src/census/source-index.js";
import { MODULES, type Module } from "../../../src/census/vocab.js";
import { loadConfig } from "../../../src/config.js";
import { PakVirtualFS } from "../../../src/pak/vfs.js";
import { artifactsDir } from "../../live/paths.js";
import {
  EXIT_FAIL,
  EXIT_OK,
  EXIT_USAGE,
  PROCESS_IO,
  guard,
  isMainModule,
  pathsFrom,
  type Io,
} from "../cli-common.js";

/** Enumerator id. */
export const ENUMERATOR_ID = "E02";
/** Registered generator path (must equal universes.json `enumerators.E02.generator`). */
export const GENERATOR = "scripts/census/enumerators/e02-script-source.ts";
const QUOTE_MAX = 200;
const WHAT_MAX = 400;

/** Plan 1.4 Workbench API scope: files under these folders become observation rows. */
export const WORKBENCH_SCOPE = [
  "scripts/Core/generated/WorkbenchAPI/",
  "scripts/GameLib/generated/WorkbenchAPI/",
  "scripts/GameLib/workbench/",
  "scripts/Workbench/",
  "scripts/WorkbenchCommon/",
  "scripts/WorkbenchGame/",
  "scripts/WorkbenchGameCommon/",
] as const;

/**
 * Helper classes outside the seven `WORKBENCH_SCOPE` folders that a layer
 * calls (plan 1.4; DEC-018). Each listed class becomes rows exactly as if
 * its declarations were in scope: the class row and one row per method of
 * every declaration of it (modded ones included), wherever those files are.
 * Add a class here when a layer first calls it; do not widen the folders.
 * Empty at Phase 1.
 */
export const HELPER_CLASSES: readonly string[] = [];

/**
 * Files that are known not to parse, with the reason. Anything else that
 * fails makes the run exit 1.
 */
export const EXPECTED_PARSE_FAILURES: Readonly<Record<string, string>> = {
  "scripts/Game/game.c":
    "deliberate non-code text under #ifdef BREAK_COMPILATION (its own comment: needed for tests that break the game script module); recovery stops at the guard's #endif, so the declarations after it (enum EGameFlags first) are indexed",
};

export function inWorkbenchScope(path: string): boolean {
  const p = path.replace(/\\/g, "/").toLowerCase();
  return WORKBENCH_SCOPE.some((s) => p.startsWith(s.toLowerCase()));
}

// ── Module assignment ─────────────────────────────────────────────────────────

/** The eleven Workbench modules (the first 11 names of the module vocabulary). */
export const WB_MODULES: readonly Module[] = MODULES.slice(0, 11);
const isWbModule = (s: string): s is Module => (WB_MODULES as readonly string[]).includes(s);

/** Explicit class-to-module facts that the name rule does not catch. */
const CLASS_MODULES: Readonly<Record<string, Module>> = { WorldEditorAPI: "WorldEditor" };

/** Base classes that tie a subclass to one module. */
const BASE_MODULES: Readonly<Record<string, Module>> = {
  WorldEditorTool: "WorldEditor",
  WorldEditorPlugin: "WorldEditor",
  ResourceManagerPlugin: "ResourceManager",
  LocalizationEditorPlugin: "LocalizationEditor",
};

/** `wbModules` of a plugin / tool attribute: the named argument, else the fifth positional one. */
export function attributeModules(args: string | undefined): string[] | undefined {
  if (!args) return undefined;
  const named = /\bwbModules\s*:\s*\{([^}]*)\}/.exec(args);
  let list: string | undefined = named?.[1];
  if (list === undefined) {
    const parts = splitArgs(args);
    const fifth = parts[4];
    if (fifth && !/^\w+\s*:/.test(fifth) && /^\{[^}]*\}$/.test(fifth)) list = fifth.slice(1, -1);
  }
  if (list === undefined) return undefined;
  return [...list.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
}

function splitArgs(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  let str = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (str) {
      cur += c;
      if (c === "\\") cur += text[++i] ?? "";
      else if (c === '"') str = false;
      continue;
    }
    if (c === '"') str = true;
    else if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    else if (c === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Module named by the path: a folder or file name equal to a module (last one wins). */
export function pathModule(path: string): Module | undefined {
  const parts = path.replace(/\\/g, "/").split("/");
  const file = (parts.pop() ?? "").replace(/\.c$/i, "");
  const fromFile = file.replace(/(Plugin|Tool|API)$/, "");
  if (isWbModule(file)) return file;
  if (isWbModule(fromFile) && fromFile !== file) return fromFile;
  for (let i = parts.length - 1; i >= 0; i--) if (isWbModule(parts[i])) return parts[i] as Module;
  return undefined;
}

/**
 * Module of a class row: the class name itself (`WorldEditor`,
 * `WorldEditorAPI`, `ResourceManagerPlugin`), else the single module of its
 * plugin / tool attribute, else a module-specific base class in its parent
 * chain, else its folder or file, else `Shared`. Returns the rule used.
 */
export function classModule(
  index: SourceIndex,
  name: string,
  decl: ClassRecord,
): { module: Module; rule: string } {
  if (isWbModule(name)) return { module: name, rule: "class name" };
  if (CLASS_MODULES[name]) return { module: CLASS_MODULES[name], rule: "class name" };
  const stripped = name.replace(/(Plugin|Tool|API)$/, "");
  if (stripped !== name && isWbModule(stripped)) return { module: stripped, rule: "class name" };
  for (const a of index.classes.get(name)?.attributes ?? decl.attributes) {
    if (a.name !== "WorkbenchPluginAttribute" && a.name !== "WorkbenchToolAttribute") continue;
    const mods = attributeModules(a.args);
    if (mods && mods.length === 1 && isWbModule(mods[0]))
      return { module: mods[0], rule: "wbModules" };
  }
  for (const c of classChain(index, name).slice(1)) {
    if (BASE_MODULES[c.name]) return { module: BASE_MODULES[c.name], rule: `base class ${c.name}` };
  }
  const p = pathModule(decl.file);
  if (p) return { module: p, rule: "folder" };
  return { module: "Shared", rule: "default" };
}

// ── Observation rows ──────────────────────────────────────────────────────────

export interface Merge {
  id: string;
  /** Declarations merged into the row (2 or more). */
  count: number;
  reason: string;
  refs: string[];
}

export interface RowsResult {
  observations: { id: string; obs: Observation }[];
  merges: Merge[];
  /** Declarations in scope that have no row kind, by kind. */
  leftOut: Record<string, number>;
  /** Fields dropped from a row because they held a machine path. */
  scrubbed: { id: string; field: string }[];
  /** Modded classes in scope whose class is not declared (non-modded) in scope. */
  moddedOnly: string[];
  /** Module rule used per class row. */
  moduleRules: Record<string, number>;
  /** Classes of the helper list, each with how many of its declarations were taken from outside the folders. */
  helpers: { name: string; declarations_outside_scope: number }[];
  /** Helper-list names that no non-forward class declaration in the index carries. */
  helpersMissing: string[];
}

/** Text of a one-line `quote`: the source line at `line`, trimmed. */
function quoteAt(lines: string[] | undefined, line: number): string | undefined {
  const t = lines?.[line - 1]?.trim();
  if (!t) return undefined;
  return t.slice(0, QUOTE_MAX);
}

function what(doc: string | undefined): string | undefined {
  const s = firstSentence(doc);
  if (!s) return undefined;
  return s.length > WHAT_MAX ? s.slice(0, WHAT_MAX) : s;
}

/** Enclosing class declaration of every member record, per file. */
function enclosingClasses(index: SourceIndex): Map<SourceRecord, ClassRecord> {
  const out = new Map<SourceRecord, ClassRecord>();
  for (const recs of index.byFile.values()) {
    let cur: ClassRecord | undefined;
    for (const r of recs) {
      if (r.kind === "class") cur = r;
      else if ((r.kind === "method" || r.kind === "field") && cur && r.owner === cur.name)
        out.set(r, cur);
    }
  }
  return out;
}

/**
 * Observation rows for the Workbench API scope plus the classes of
 * `helperClasses` (default `HELPER_CLASSES`). `readLines(path)` gives a
 * file's lines for `quote` (absent: no quote).
 */
export function observationRows(
  index: SourceIndex,
  readLines: (path: string) => string[] | undefined = () => undefined,
  helperClasses: readonly string[] = HELPER_CLASSES,
): RowsResult {
  const enclosing = enclosingClasses(index);
  const lineCache = new Map<string, string[] | undefined>();
  const lines = (f: string): string[] | undefined => {
    if (!lineCache.has(f)) lineCache.set(f, readLines(f));
    return lineCache.get(f);
  };
  const leftOut: Record<string, number> = {};
  const scrubbed: RowsResult["scrubbed"] = [];
  const moduleRules: Record<string, number> = {};

  interface Cand {
    id: string;
    rec: SourceRecord;
    obs: Observation;
  }
  const cands: Cand[] = [];
  const classModules = new Map<string, Module>();
  const enumModules = new Map<string, Module>();

  // A helper class brings its class declarations and their members (methods,
  // and member variables, which are left out as in scope).
  const helperSet = new Set(helperClasses);
  const helperName = (r: SourceRecord): string | undefined =>
    r.kind === "class" ? r.name : r.kind === "method" || r.kind === "field" ? r.owner : undefined;
  const isHelper = (r: SourceRecord): boolean => {
    const n = helperName(r);
    return n !== undefined && helperSet.has(n);
  };
  const scoped = index.records.filter((r) => inWorkbenchScope(r.file) || isHelper(r));
  const helpers = [...helperSet].sort(compareCodeUnits).map((name) => ({
    name,
    declarations_outside_scope: index.records.filter(
      (r) => r.kind === "class" && !r.forward && r.name === name && !inWorkbenchScope(r.file),
    ).length,
  }));
  const helpersMissing = helpers
    .filter(
      (h) => !index.records.some((r) => r.kind === "class" && !r.forward && r.name === h.name),
    )
    .map((h) => h.name);
  // Class and enum modules first: members inherit them.
  const classDecls = new Map<string, ClassRecord[]>();
  for (const r of scoped) {
    if (r.kind === "class" && !r.forward) {
      const l = classDecls.get(r.name) ?? [];
      l.push(r);
      classDecls.set(r.name, l);
    }
  }
  const moddedOnly: string[] = [];
  for (const [name, decls] of classDecls) {
    const first = decls.find((d) => !d.modded) ?? decls[0];
    if (!decls.some((d) => !d.modded)) moddedOnly.push(name);
    const m = classModule(index, name, first);
    classModules.set(name, m.module);
    moduleRules[m.rule] = (moduleRules[m.rule] ?? 0) + 1;
  }
  for (const r of scoped) {
    if (r.kind === "enum" && !enumModules.has(r.name))
      enumModules.set(r.name, pathModule(r.file) ?? "Shared");
  }

  const base = (r: SourceRecord): Pick<Observation, "origin" | "ref" | "confidence" | "quote"> => {
    const o: Pick<Observation, "origin" | "ref" | "confidence" | "quote"> = {
      origin: "vanilla",
      ref: pakRef(r),
      confidence: "high",
    };
    const q = quoteAt(lines(r.file), r.line);
    if (q) o.quote = q;
    return o;
  };

  for (const r of scoped) {
    let obs: Observation | undefined;
    switch (r.kind) {
      case "class": {
        if (r.forward) {
          leftOut["class (forward declaration)"] =
            (leftOut["class (forward declaration)"] ?? 0) + 1;
          continue;
        }
        obs = {
          dim: "api",
          kind: "class",
          module: classModules.get(r.name) ?? "Shared",
          key: { class: r.name },
          parent_key: null,
          label: r.name,
          signature: r.signature,
          what: what(r.doc),
          ...base(r),
        };
        break;
      }
      case "enum": {
        obs = {
          dim: "api",
          kind: "enum",
          module: enumModules.get(r.name) ?? "Shared",
          key: { class: r.name },
          parent_key: null,
          label: r.name,
          signature: r.signature,
          what: what(r.doc),
          ...base(r),
        };
        break;
      }
      case "enum-value": {
        const module = enumModules.get(r.owner) ?? "Shared";
        obs = {
          dim: "api",
          kind: "enum-value",
          module,
          key: { class: r.owner, member: r.name },
          parent_key: { dim: "api", kind: "enum", module, key: { class: r.owner } },
          label: r.name,
          signature: r.signature,
          what: what(r.doc),
          ...base(r),
        };
        break;
      }
      case "method": {
        const owner = r.owner as string;
        const module = classModules.get(owner) ?? "Shared";
        const kind = recordKind(r) as "method" | "static-method" | "event";
        obs = {
          dim: "api",
          kind,
          module,
          key: { class: owner, method: r.name, arity: r.arity },
          parent_key: { dim: "api", kind: "class", module, key: { class: owner } },
          label: r.name,
          signature: r.signature,
          what: what(r.doc),
          ...base(r),
        };
        break;
      }
      default: {
        const k =
          r.kind === "field"
            ? "member variable"
            : r.kind === "function"
              ? "global function"
              : r.kind;
        leftOut[k] = (leftOut[k] ?? 0) + 1;
        continue;
      }
    }
    for (const f of ["signature", "what", "quote"] as const) {
      const v = obs[f];
      if (v === undefined) delete obs[f];
      else if (containsMachinePath(v)) {
        delete obs[f];
        scrubbed.push({ id: "", field: f });
      }
    }
    const parsed = observationSchema.parse(obs);
    const id = deriveId(parsed);
    for (const s of scrubbed) if (s.id === "") s.id = id;
    cands.push({ id, rec: r, obs: parsed });
  }

  // Merge rows that share an id (scope records are in (file, line) order).
  const groups = new Map<string, Cand[]>();
  for (const c of cands) {
    const g = groups.get(c.id);
    if (g) g.push(c);
    else groups.set(c.id, [c]);
  }
  const merges: Merge[] = [];
  const observations: { id: string; obs: Observation }[] = [];
  for (const [id, g] of groups) {
    // The row cites the first non-modded declaration, a public one before a
    // private or protected one (a public static overload is not hidden
    // behind a protected instance method of the same name and arity).
    const owner = (c: Cand): ClassRecord | undefined =>
      c.rec.kind === "class" ? c.rec : enclosing.get(c.rec);
    const hidden = (c: Cand): boolean =>
      c.rec.kind === "method" &&
      (c.rec.modifiers.includes("private") || c.rec.modifiers.includes("protected"));
    const rank = (c: Cand): number => (owner(c)?.modded ? 2 : 0) + (hidden(c) ? 1 : 0);
    const primary = g.reduce((best, c) => (rank(c) < rank(best) ? c : best), g[0]);
    if (g.length > 1) {
      const reasons = new Set<string>();
      const kinds = [...new Set(g.map((c) => c.obs.kind))];
      if (kinds.length > 1)
        reasons.add(
          `kinds differ (${kinds.join(" / ")}); the row cites the ${hidden(primary) ? "" : "public "}${primary.obs.kind} at ${primary.obs.ref}`,
        );
      if (g.some((c) => owner(c)?.modded)) reasons.add("modded class");
      if (new Set(g.map((c) => c.rec.guards.join("&"))).size > 1)
        reasons.add(
          `#ifdef branches (${[...new Set(g.map((c) => c.rec.guards.join(" & ") || "unguarded"))].join(" / ")})`,
        );
      const paramTypes = (c: Cand): string =>
        c.rec.kind === "method"
          ? c.rec.params
              .map((p) => `${p.modifiers.join(" ")} ${p.type}${p.array ?? ""}`.trim())
              .join(", ")
          : "";
      if (g.every((c) => c.rec.kind === "method") && new Set(g.map(paramTypes)).size > 1)
        reasons.add(
          `overloads with the same name and arity (parameter types: ${[...new Set(g.map(paramTypes))].map((t) => `(${t})`).join(" / ")}); the {class, method, arity} key cannot tell them apart`,
        );
      if (reasons.size === 0) reasons.add("repeated declaration");
      merges.push({
        id,
        count: g.length,
        reason: [...reasons].join("; "),
        refs: g.map((c) => c.obs.ref),
      });
    }
    observations.push({ id, obs: primary.obs });
  }

  // children_count: emitted child rows per container.
  const children = new Map<string, number>();
  for (const o of observations) {
    const pk = o.obs.parent_key;
    if (!pk) continue;
    const pid = deriveId(pk);
    children.set(pid, (children.get(pid) ?? 0) + 1);
  }
  for (const o of observations) {
    if (o.obs.kind === "class" || o.obs.kind === "enum")
      o.obs.children_count = children.get(o.id) ?? 0;
  }
  observations.sort((a, b) => compareCodeUnits(a.id, b.id));
  merges.sort((a, b) => compareCodeUnits(a.id, b.id));
  return {
    observations,
    merges,
    leftOut,
    scrubbed,
    moddedOnly: moddedOnly.sort(compareCodeUnits),
    moduleRules,
    helpers,
    helpersMissing,
  };
}

// ── Undocumented rows (report only) ───────────────────────────────────────────

/** Row kinds listed in `undocumented.json`: classes and the three method kinds. */
const UNDOCUMENTED_LISTED = new Set(["class", "method", "static-method", "event"]);

export interface UndocumentedReport {
  build: string;
  /** Per row kind: rows emitted, and how many of them carry no `what`. */
  by_kind: Record<string, { rows: number; undocumented: number }>;
  /** Classes with no `what`, with the declaration the row cites. */
  classes: { id: string; ref: string }[];
  /** Methods, static methods and events with no `what`. */
  methods: { id: string; kind: string; ref: string }[];
}

/**
 * The emitted rows that carry no `what` (no doc comment, or one with no
 * sentence before its first block command). A report for the later work item
 * that describes them; it changes no row.
 */
export function undocumentedReport(rows: RowsResult, build: string): UndocumentedReport {
  const by_kind: UndocumentedReport["by_kind"] = {};
  const classes: UndocumentedReport["classes"] = [];
  const methods: UndocumentedReport["methods"] = [];
  for (const { id, obs } of rows.observations) {
    const k = (by_kind[obs.kind] ??= { rows: 0, undocumented: 0 });
    k.rows++;
    if (obs.what !== undefined) continue;
    k.undocumented++;
    if (!UNDOCUMENTED_LISTED.has(obs.kind)) continue;
    if (obs.kind === "class") classes.push({ id, ref: obs.ref });
    else methods.push({ id, kind: obs.kind, ref: obs.ref });
  }
  const sorted: UndocumentedReport["by_kind"] = {};
  for (const k of Object.keys(by_kind).sort(compareCodeUnits)) sorted[k] = by_kind[k];
  return { build, by_kind: sorted, classes, methods };
}

/** Where `undocumented.json` goes: `<artifacts>/census/<build>/E02/undocumented.json`. */
export function undocumentedPath(build: string, dir: string = artifactsDir()): string {
  return join(dir, "census", build, ENUMERATOR_ID, "undocumented.json");
}

/** Exact text of the E02 observation file. */
export function observationFileText(rows: RowsResult, index: SourceIndex, build: string): string {
  const header = {
    $header: 1,
    build,
    enumerator: ENUMERATOR_ID,
    generator: GENERATOR,
    inputs: [{ path: "<game>/addons/**/scripts/**/*.c", sha256: index.header.inputs_sha256 }],
    provisional: false,
    row_count: rows.observations.length,
  };
  return (
    [jsonlLine(header, ["$header"]), ...rows.observations.map((o) => jsonlLine(o.obs))].join("\n") +
    "\n"
  );
}

// ── Headline counts ───────────────────────────────────────────────────────────

const PLUGIN_ATTRS = ["WorkbenchPluginAttribute", "WorkbenchToolAttribute"];
const PLUGIN_ATTR_RE = /\[\s*Workbench(Plugin|Tool)Attribute\b/g;

export interface HeadlineCounts {
  files_parsed: number;
  files_failed: { file: string; expected: string | null; errors: string[] }[];
  records: number;
  per_module: Record<
    string,
    {
      files: number;
      classes: number;
      modded_classes: number;
      enums: number;
      methods: number;
      functions: number;
    }
  >;
  totals: {
    classes: number;
    modded_classes: number;
    distinct_class_names: number;
    enums: number;
    enum_values: number;
    methods: number;
    functions: number;
    fields: number;
    typedefs: number;
  };
  world_editor_api: {
    methods: number;
    constructors_destructors: number;
    proto_external: number;
    endcode_typo?: {
      slash_endcode_lines: number[];
      next_endcode_line: number | null;
      between: string[];
    };
  };
  static_methods: Record<string, number>;
  ui_widgets_members: number;
  plugin_classes: {
    declarations: number;
    plugin_attribute: number;
    tool_attribute: number;
    guarded: { name: string; ref: string; guards: string[] }[];
    commented_out_in_source: number | null;
  };
  net_api_handlers: {
    direct: { name: string; ref: string; guards: string[] }[];
    transitive: number;
  };
  observation_rows: Record<string, number>;
}

/**
 * Headline counts (plan 2.1 and 2.3) measured on the index. `readText`
 * gives raw file text for the checks that need it (the `/endcode` lines and
 * commented-out plugin attributes); without it those fields are null.
 */
export function headlineCounts(
  index: SourceIndex,
  rows: RowsResult,
  readText?: (path: string) => string,
): HeadlineCounts {
  const perModule: HeadlineCounts["per_module"] = {};
  for (const f of index.files) {
    const m = (perModule[f.script_module] ??= {
      files: 0,
      classes: 0,
      modded_classes: 0,
      enums: 0,
      methods: 0,
      functions: 0,
    });
    m.files++;
  }
  const totals = {
    classes: 0,
    modded_classes: 0,
    distinct_class_names: 0,
    enums: 0,
    enum_values: 0,
    methods: 0,
    functions: 0,
    fields: 0,
    typedefs: 0,
  };
  for (const r of index.records) {
    const m = perModule[r.script_module];
    if (r.kind === "class" && !r.forward) {
      if (r.modded) {
        totals.modded_classes++;
        m.modded_classes++;
      } else {
        totals.classes++;
        m.classes++;
      }
    } else if (r.kind === "enum") {
      totals.enums++;
      m.enums++;
    } else if (r.kind === "enum-value") totals.enum_values++;
    else if (r.kind === "method") {
      totals.methods++;
      m.methods++;
    } else if (r.kind === "function") {
      totals.functions++;
      m.functions++;
    } else if (r.kind === "field") totals.fields++;
    else if (r.kind === "typedef") totals.typedefs++;
  }
  totals.distinct_class_names = [...index.classes.values()].filter((c) =>
    c.declarations.some((d) => !d.forward),
  ).length;

  const wea = index.classes.get("WorldEditorAPI");
  const weaMethods = wea?.methods ?? [];
  const world_editor_api: HeadlineCounts["world_editor_api"] = {
    methods: weaMethods.length,
    constructors_destructors: weaMethods.filter((m) => m.is_constructor || m.is_destructor).length,
    proto_external: weaMethods.filter(
      (m) => m.modifiers.includes("proto") && m.modifiers.includes("external"),
    ).length,
  };
  const weaFile = wea?.declarations[0]?.file;
  if (readText && weaFile) {
    const lines = readText(weaFile).split(/\r?\n/);
    const slash = lines.flatMap((l, i) => (/(^|\s)\/endcode\b/.test(l) ? [i + 1] : []));
    const proper = lines.flatMap((l, i) => (/[\\@]endcode\b/.test(l) ? [i + 1] : []));
    const from = slash[0];
    const next = from !== undefined ? (proper.find((l) => l > from) ?? null) : null;
    world_editor_api.endcode_typo = {
      slash_endcode_lines: slash,
      next_endcode_line: next,
      between:
        from === undefined
          ? []
          : weaMethods
              .filter(
                (m) => m.file === weaFile && m.line > from && (next === null || m.line < next),
              )
              .map((m) => `${m.name}/${m.arity}@L${m.line}`),
    };
  }

  const static_methods: Record<string, number> = {};
  for (const cls of ["Workbench", "DiagMenu", "DbgUI"]) {
    static_methods[cls] = (index.classes.get(cls)?.methods ?? []).filter((m) =>
      m.modifiers.includes("static"),
    ).length;
  }
  const ui = index.classes.get("UIWidgets");

  const pluginDecls = index.records.filter(
    (r): r is ClassRecord =>
      r.kind === "class" && r.attributes.some((a) => PLUGIN_ATTRS.includes(a.name)),
  );
  let commented: number | null = null;
  if (readText) {
    commented = 0;
    for (const f of index.files) {
      const text = readText(f.file);
      if (!/Workbench(Plugin|Tool)Attribute/.test(text)) continue;
      // Occurrences inside comments (line or block): declarations commented out.
      for (const cm of lex(text).comments)
        commented += [...cm.text.matchAll(PLUGIN_ATTR_RE)].length;
    }
  }
  const direct = subclassesOf(index, "NetApiHandler").flatMap((c) =>
    c.declarations
      .filter((d) => d.parent_name === "NetApiHandler")
      .map((d) => ({ name: d.name, ref: pakRef(d), guards: d.guards })),
  );
  let transitive = 0;
  for (const c of index.classes.values()) {
    if (
      c.name !== "NetApiHandler" &&
      classChain(index, c.name).some((x) => x.name === "NetApiHandler")
    )
      transitive++;
  }
  const observation_rows: Record<string, number> = {};
  for (const o of rows.observations)
    observation_rows[o.obs.kind] = (observation_rows[o.obs.kind] ?? 0) + 1;

  return {
    files_parsed: index.files.length,
    files_failed: index.header.failed.map((f) => ({
      file: f.file,
      expected: EXPECTED_PARSE_FAILURES[f.file] ?? null,
      errors: f.errors.map((e) => `L${e.line}: ${e.message}`),
    })),
    records: index.records.length,
    per_module: perModule,
    totals,
    world_editor_api,
    static_methods,
    ui_widgets_members: (ui?.fields.length ?? 0) + (ui?.methods.length ?? 0),
    plugin_classes: {
      declarations: pluginDecls.length,
      plugin_attribute: pluginDecls.filter((d) =>
        d.attributes.some((a) => a.name === "WorkbenchPluginAttribute"),
      ).length,
      tool_attribute: pluginDecls.filter((d) =>
        d.attributes.some((a) => a.name === "WorkbenchToolAttribute"),
      ).length,
      guarded: pluginDecls
        .filter((d) => d.guards.some((g) => g !== "WORKBENCH"))
        .map((d) => ({ name: d.name, ref: pakRef(d), guards: d.guards })),
      commented_out_in_source: commented,
    },
    net_api_handlers: { direct, transitive },
    observation_rows,
  };
}

// ── CLI ───────────────────────────────────────────────────────────────────────

const USAGE =
  "usage: e02-script-source.ts [--build <tag>] [--game <dir>] [--out <file under observations/E02/>] [--data <dir>] [--counts] [--json]";

/** Resolves `--out`, refusing anything outside `<census>/observations/E02/`. */
export function resolveOut(paths: CensusPaths, out: string | undefined, build: string): string {
  const dir = join(paths.observations, ENUMERATOR_ID);
  const file = out ? resolve(out) : join(dir, `${build}.jsonl`);
  if (dirname(file) !== dir || !file.endsWith(".jsonl")) {
    throw new Error(
      "refusing --out outside observations/E02/ (E02 writes only its own observation directory)",
    );
  }
  return file;
}

export function run(argv: string[], io: Io = PROCESS_IO): number {
  return guard(io, "e02-script-source", () => {
    const { values } = parseArgs({
      args: argv,
      options: {
        build: { type: "string" },
        game: { type: "string" },
        out: { type: "string" },
        data: { type: "string" },
        counts: { type: "boolean" },
        json: { type: "boolean" },
        help: { type: "boolean" },
      },
      strict: true,
    });
    if (values.help) {
      io.out(USAGE);
      return EXIT_OK;
    }
    const paths = pathsFrom(values.data);
    const build = values.build ?? loadCurrentBuild(paths).tag;
    let out: string;
    try {
      out = resolveOut(paths, values.out, build);
    } catch (e) {
      io.err(`e02-script-source: ${e instanceof Error ? e.message : String(e)}`);
      return EXIT_FAIL;
    }
    const gamePath = values.game ? resolve(values.game) : loadConfig().gamePath;
    const vfs =
      gamePath && existsSync(join(gamePath, "addons")) ? PakVirtualFS.get(gamePath) : null;
    if (!vfs) {
      io.out(
        "NO DATA: no game install with pak files at the configured game path (ENFUSION_GAME_PATH or --game); nothing written",
      );
      return EXIT_USAGE;
    }
    const index = buildSourceIndex(vfs, { build });
    const indexFile = saveSourceIndex(index, { dir: artifactsDir() });
    const rows = observationRows(index, (p) => vfs.readTextFile(p).split(/\r?\n/));
    mkdirSync(dirname(out), { recursive: true });
    writeFileAtomic(out, observationFileText(rows, index, build));
    const undoc = undocumentedReport(rows, build);
    const undocFile = undocumentedPath(build);
    mkdirSync(dirname(undocFile), { recursive: true });
    writeFileAtomic(undocFile, JSON.stringify(undoc, null, 2) + "\n");
    const undocCounts = Object.fromEntries(
      Object.entries(undoc.by_kind).map(([k, v]) => [k, v.undocumented]),
    );

    const unexpected = index.header.failed.filter((f) => !(f.file in EXPECTED_PARSE_FAILURES));
    const ok = unexpected.length === 0 && rows.helpersMissing.length === 0;
    const counts = values.counts
      ? headlineCounts(index, rows, (p) => vfs.readTextFile(p))
      : undefined;
    const byKind: Record<string, number> = {};
    for (const o of rows.observations) byKind[o.obs.kind] = (byKind[o.obs.kind] ?? 0) + 1;
    const mergedDecls = rows.merges.reduce((s, m) => s + m.count, 0);
    if (values.json) {
      io.out(
        JSON.stringify({
          ok,
          command: "e02-script-source",
          build,
          files: index.files.length,
          records: index.records.length,
          failed: index.header.failed,
          unexpected_failures: unexpected.map((f) => f.file),
          rows: rows.observations.length,
          rows_by_kind: byKind,
          merges: rows.merges,
          merged_declarations: mergedDecls,
          merged_away: mergedDecls - rows.merges.length,
          helpers: rows.helpers,
          helpers_missing: rows.helpersMissing,
          undocumented_by_kind: undocCounts,
          left_out: rows.leftOut,
          modded_only: rows.moddedOnly,
          module_rules: rows.moduleRules,
          scrubbed: rows.scrubbed,
          counts,
        }),
      );
      return ok ? EXIT_OK : EXIT_FAIL;
    }
    io.out(
      `source index: ${index.files.length} files, ${index.records.length} records -> <artifacts>/census/${build}/E02/${indexFile.split(/[\\/]/).pop()}`,
    );
    for (const f of index.header.failed) {
      const why = EXPECTED_PARSE_FAILURES[f.file];
      io.out(
        `failed ${f.file}${why ? ` (expected: ${why})` : " (UNEXPECTED)"}: ${f.errors.map((e) => `L${e.line} ${e.message}`).join("; ")}`,
      );
    }
    io.out(
      `warnings: ${index.header.warnings.length} accepted irregularities, ${index.header.doc_warnings.length} doc-comment warnings`,
    );
    for (const m of rows.merges) io.out(`merged ${m.id}: ${m.count} declarations (${m.reason})`);
    for (const h of rows.helpers)
      io.out(
        `helper class ${h.name}: ${h.declarations_outside_scope} declarations outside the folders`,
      );
    for (const n of rows.helpersMissing) io.out(`helper class ${n}: NOT DECLARED in the index`);
    io.out(
      `undocumented (no what): ${Object.entries(undoc.by_kind)
        .map(([k, v]) => `${k} ${v.undocumented}/${v.rows}`)
        .join(
          ", ",
        )} -> <artifacts>/census/${build}/E02/undocumented.json (${undoc.classes.length} classes, ${undoc.methods.length} methods listed)`,
    );
    for (const [k, n] of Object.entries(rows.leftOut).sort()) io.out(`left out: ${n} ${k}`);
    if (rows.moddedOnly.length)
      io.out(`modded-only classes in scope: ${rows.moddedOnly.join(", ")}`);
    if (counts) io.out(JSON.stringify(counts, null, 2));
    io.out(
      `E02 at build ${build}: ${rows.observations.length} observations (${Object.entries(byKind)
        .sort()
        .map(([k, n]) => `${k} ${n}`)
        .join(
          ", ",
        )}), ${rows.merges.length} merged keys (${mergedDecls} declarations, ${mergedDecls - rows.merges.length} merged away), ${unexpected.length} unexpected parse failure${unexpected.length !== 1 ? "s" : ""}`,
    );
    return ok ? EXIT_OK : EXIT_FAIL;
  });
}

if (isMainModule(import.meta.url)) process.exitCode = run(process.argv.slice(2));
