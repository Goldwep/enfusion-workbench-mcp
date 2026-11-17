/**
 * E15 — `[Attribute]` scan (plan 4.5; Phase 1). Static enumerator, no model.
 *
 * Reads the E02 source index (`src/census/source-index.ts`: every member
 * variable of every class of all nine script modules, with its attribute
 * annotations, file and line) and turns every member variable that carries an
 * `[Attribute(...)]` annotation into one observation row: the schema behind
 * Object Properties and behind any generic container tool.
 *
 *  - A member of a Workbench plugin or tool class (the class carries
 *    WorkbenchPluginAttribute or WorkbenchToolAttribute, directly or through a
 *    parent class in the index) becomes a `plugin-setting` row, dim plugin,
 *    key {class, attr}, id `plugin:<Class>#attr:<member>`. Its parent is the
 *    plugin or tool row `{plugin, kind plugin | tool, key {class}}`; those
 *    rows belong to E03 (E03 owns every plugin and tool row), so a temporary
 *    build without E03's file reports "parent has no row" for them. (E03 also
 *    emits plugin-setting rows for the members a plugin class inherits from a
 *    script base class; those ids `plugin:<Child>#attr:<member>` are E03's
 *    alone, E15 keys a member by the class that declares it.) Module:
 *    the shared plugin rule (exactly one `wbModules` entry that names a module
 *    of the vocabulary gives that module; no entry, several or an unknown name
 *    give Shared), read from the attribute of the class that carries it.
 *  - Every other member becomes an `attribute` row, dim api, key {class, attr},
 *    id `api:<Class>#attr:<member>`. Its parent is the class row of E02 when
 *    E02 emitted one (a class in the seven Workbench folders or a helper
 *    class), with the module E02 gave that class; for every other class (the
 *    ~9,000 game classes plan 1.4 keeps out of the ledger) no row exists, so
 *    the parent is `null` (a declared root) and the module is `none`.
 *
 * What a row says (all from the annotation, nothing invented):
 *  - label: the member name. signature: `<type> <member> = <defvalue>` plus a
 *    bracket ` [UIWidgets.<Kind>, params: ..., enums: ..., enumType: ...,
 *    category: ..., precision: ..., prefabbed: ...]` holding the widget kind
 *    when the widget argument names a UIWidgets member (a `UIWidgets.X`
 *    symbol, or a string literal equal to the value of exactly one UIWidgets
 *    member) and each other argument that is given, as written (`enums: null`
 *    is left out). The default is the `defvalue` argument as written (a string
 *    literal keeps its quotes); a member without `defvalue` has no `= ...`
 *    part. An argument that looks like a machine path (a drive path, a URL
 *    with `:/`) is replaced by `"<withheld>"`; the report lists those.
 *  - what: the `desc` argument, the text between the quotes as written (a
 *    string literal only; an empty or non-literal desc leaves `what` out).
 *  - ref: `pak:<virtual path>#L<line of the annotation>`; quote: that source
 *    line, trimmed, at most 200 characters. The line holds the enum source,
 *    the category and the params when the annotation is on one line (it is for
 *    nearly every member: the member declaration follows on the next line).
 *  - Arguments are mapped to parameters with the parameter list of the
 *    `Attribute` class read from the index (defvalue, uiwidget, desc, params,
 *    enums, category, precision, enumType, prefabbed): a positional argument
 *    takes the parameter at its position in the argument list, a named one
 *    its name. A parameter given twice (by position and by name), an unknown
 *    named argument, more arguments than parameters or text that cannot be
 *    split are "unreadable": the row is still emitted from what is
 *    unambiguous, with confidence `medium` and an `unverified` claim naming
 *    the problem, and the annotation is counted and listed in the report.
 *
 * Rows that share an id (a member repeated under `#ifdef` branches or in a
 * modded class) are merged into one row (the first non-modded declaration)
 * and reported with the reason.
 *
 * Also writes, to the artifacts folder (never committed):
 *   census/<build>/E15/uiwidgets-usage.json  uses per UIWidgets member (E16 reads it)
 *   census/<build>/E15/scan-report.json      counts, merges, unreadable annotations
 *
 *   npx tsx scripts/census/enumerators/e15-attribute-scan.ts [--build <tag>] [--game <dir>]
 *       [--out <file under observations/E15/>] [--data <dir>] [--counts] [--verify-raw] [--json]
 *
 * --counts      also print the headline counts
 * --verify-raw  tokenise every script file again and compare the number of
 *               `[Attribute` annotations with the index (about a minute)
 *
 * Exit: 0 written; 1 refused (--out outside observations/E15/) or a row failed
 * validation; 2 usage or NO DATA (no game install with pak files); 3 malformed
 * census configuration.
 *
 * Nothing under the game or Tools install is executed: pak files are read as
 * bytes through `src/pak/vfs.ts` only.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  compareCodeUnits,
  formatJson,
  jsonlLine,
  sha256,
  splitLines,
} from "../../../src/census/canon.js";
import { loadCurrentBuild } from "../../../src/census/census-config.js";
import { lex } from "../../../src/census/enforce-source.js";
import { containsMachinePath } from "../../../src/census/hygiene.js";
import { deriveId } from "../../../src/census/ids.js";
import { writeFileAtomic, type CensusPaths } from "../../../src/census/ledger-io.js";
import { observationSchema, type Observation } from "../../../src/census/schemas.js";
import {
  buildSourceIndex,
  classChain,
  loadSourceIndex,
  sourceIndexPath,
  sourceIndexText,
  type ClassRecord,
  type FieldRecord,
  type SourceIndex,
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
import { attributeModules, observationRows as e02ObservationRows } from "./e02-script-source.js";

/** Enumerator id. */
export const ENUMERATOR_ID = "E15";
/** Registered generator path (must equal universes.json `enumerators.E15.generator`). */
export const GENERATOR = "scripts/census/enumerators/e15-attribute-scan.ts";
const QUOTE_MAX = 200;

/** Name of the attribute class whose uses this enumerator reads. */
export const ATTRIBUTE_CLASS = "Attribute";
/** Parameters of the `Attribute` constructor, in order, when the index does not hold the class. */
export const FALLBACK_PARAMS: readonly string[] = [
  "defvalue",
  "uiwidget",
  "desc",
  "params",
  "enums",
  "category",
  "precision",
  "enumType",
  "prefabbed",
];
const MODULE_SET: ReadonlySet<string> = new Set(MODULES);

// ── The Attribute class and the UIWidgets members, from the index ─────────────

/** Parameter names of the `Attribute` constructor, from the index (fallback: `FALLBACK_PARAMS`). */
export function attributeParams(index: SourceIndex): string[] {
  const c = index.classes.get(ATTRIBUTE_CLASS);
  const ctor =
    c?.methods.find((m) => m.is_constructor) ?? c?.methods.find((m) => m.name === ATTRIBUTE_CLASS);
  const names = ctor?.params.map((p) => p.name) ?? [];
  if (names.length > 0 && names.every((n): n is string => typeof n === "string" && n !== ""))
    return names;
  return [...FALLBACK_PARAMS];
}

/** The string a single string literal holds (raw text between the quotes), else undefined. */
export function stringLiteral(text: string): string | undefined {
  const m = /^"((?:[^"\\]|\\[\s\S])*)"$/.exec(text.trim());
  return m ? m[1] : undefined;
}

export interface WidgetMember {
  name: string;
  /** The string the member holds (`""` for Hidden and None); undefined when its initialiser is not a literal. */
  value: string | undefined;
}

/** Every member of the `UIWidgets` class in declaration order (31 at build 1.8.0.13). */
export function uiWidgetMembers(index: SourceIndex): WidgetMember[] {
  const c = index.classes.get("UIWidgets");
  return (c?.fields ?? []).map((f) => ({
    name: f.name,
    value: f.init !== undefined ? stringLiteral(f.init) : undefined,
  }));
}

// ── Argument parsing ──────────────────────────────────────────────────────────

/** Splits text at top-level commas; strings (with escapes) and brackets nest. */
export function splitTopLevel(text: string): { parts: string[]; balanced: boolean } {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  let inStr = false;
  let balanced = true;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      cur += c;
      if (c === "\\") cur += text[++i] ?? "";
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (depth < 0) balanced = false;
    } else if (c === "," && depth === 0) {
      parts.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  if (inStr || depth !== 0) balanced = false;
  if (cur.trim() !== "") parts.push(cur.trim());
  return { parts, balanced };
}

export type ProblemKind =
  | "unbalanced"
  | "unknown-named"
  | "too-many"
  | "given-twice"
  | "empty-argument";

export interface ArgProblem {
  kind: ProblemKind;
  /** One sentence, stable across runs (used as the row's `unverified` claim). */
  message: string;
}

export interface ParsedArgs {
  /** Parameter name to the argument text as written, for every parameter given exactly once. */
  values: Record<string, string>;
  problems: ArgProblem[];
  /** Number of arguments (after splitting). */
  count: number;
}

const NAMED_ARG = /^([A-Za-z_]\w*)\s*:(?!:)\s*([\s\S]*)$/;

/**
 * Maps the argument text of an `[Attribute(...)]` use to the parameters of the
 * `Attribute` constructor. A positional argument takes the parameter at its
 * position in the argument list; a named one takes its name. A parameter
 * given twice is dropped from `values` and reported (which of the two the
 * engine honours is not known [unverified]).
 */
export function parseAttributeArgs(
  args: string | undefined,
  params: readonly string[] = FALLBACK_PARAMS,
): ParsedArgs {
  const out: ParsedArgs = { values: {}, problems: [], count: 0 };
  if (args === undefined || args.trim() === "") return out;
  const { parts, balanced } = splitTopLevel(args);
  out.count = parts.length;
  if (!balanced) {
    out.problems.push({
      kind: "unbalanced",
      message: "[Attribute] argument text has an unclosed string or bracket; not read",
    });
    return out;
  }
  const given = new Map<string, string[]>();
  parts.forEach((part, i) => {
    if (part === "") {
      out.problems.push({
        kind: "empty-argument",
        message: `[Attribute] argument ${i + 1} is empty; not read`,
      });
      return;
    }
    const m = NAMED_ARG.exec(part);
    let name: string | undefined;
    let text = part;
    if (m) {
      if (!params.includes(m[1])) {
        out.problems.push({
          kind: "unknown-named",
          message: `[Attribute] named argument "${m[1]}" is not a parameter of Attribute; not read`,
        });
        return;
      }
      name = m[1];
      text = m[2].trim();
    } else {
      name = params[i];
      if (name === undefined) {
        out.problems.push({
          kind: "too-many",
          message: `[Attribute] argument ${i + 1} is beyond the ${params.length} parameters of Attribute; not read`,
        });
        return;
      }
    }
    const l = given.get(name) ?? [];
    l.push(text);
    given.set(name, l);
  });
  for (const [name, texts] of given) {
    if (texts.length === 1) out.values[name] = texts[0];
    else
      out.problems.push({
        kind: "given-twice",
        message: `[Attribute] argument "${name}" is given twice (by position and by name); not read`,
      });
  }
  out.problems.sort((a, b) => compareCodeUnits(a.message, b.message));
  return out;
}

/** What the widget argument says. */
export type WidgetUse =
  | { state: "none" }
  | { state: "member"; kind: string; form: "symbol" | "literal" }
  | { state: "empty-literal" }
  | { state: "other"; text: string }
  | { state: "unreadable" };

/**
 * Classifies a widget argument: a `UIWidgets.X` symbol of a member, or a
 * string literal equal to the value of exactly one member. An empty literal
 * is ambiguous (Hidden and None both hold ""), anything else is "other".
 * With no members known (`members` empty) any `UIWidgets.X` symbol is taken.
 */
export function classifyWidget(
  text: string | undefined,
  members: readonly WidgetMember[],
  conflicted = false,
): WidgetUse {
  if (conflicted) return { state: "unreadable" };
  if (text === undefined) return { state: "none" };
  const sym = /^UIWidgets\s*\.\s*(\w+)$/.exec(text);
  if (sym) {
    if (members.length === 0 || members.some((m) => m.name === sym[1]))
      return { state: "member", kind: sym[1], form: "symbol" };
    return { state: "other", text };
  }
  const lit = stringLiteral(text);
  if (lit !== undefined) {
    if (lit === "" && members.filter((m) => m.value === "").length !== 1)
      return { state: "empty-literal" };
    const hits = members.filter((m) => m.value === lit);
    if (hits.length === 1) return { state: "member", kind: hits[0].name, form: "literal" };
  }
  return { state: "other", text };
}

// ── Plugin and tool classes ───────────────────────────────────────────────────

export interface PluginInfo {
  /** `tool` when the class (or the ancestor carrying the attribute) has only WorkbenchToolAttribute. */
  kind: "plugin" | "tool";
  /** The shared plugin rule: exactly one `wbModules` entry naming a vocabulary module, else Shared. */
  module: Module;
  /** True when the class itself carries the attribute. */
  direct: boolean;
  /** The class whose declarations carry the attribute. */
  carrier: string;
}

/** The module a plugin or tool attribute names (E03, E15, E17 and E18 share this rule). */
export function pluginModule(attrArgs: string | undefined): Module {
  const mods = attributeModules(attrArgs) ?? [];
  return mods.length === 1 && MODULE_SET.has(mods[0]) ? (mods[0] as Module) : "Shared";
}

/**
 * Plugin or tool classification of a class: the nearest class in its parent
 * chain (itself first) that carries WorkbenchPluginAttribute or
 * WorkbenchToolAttribute in any of its declarations.
 */
export function pluginInfo(index: SourceIndex, className: string): PluginInfo | undefined {
  const chain = classChain(index, className);
  for (let depth = 0; depth < chain.length; depth++) {
    const c = chain[depth];
    const plugin = c.attributes.find((a) => a.name === "WorkbenchPluginAttribute");
    const tool = c.attributes.find((a) => a.name === "WorkbenchToolAttribute");
    const a = plugin ?? tool;
    if (!a) continue;
    return {
      kind: plugin ? "plugin" : "tool",
      module: pluginModule(a.args),
      direct: depth === 0,
      carrier: c.name,
    };
  }
  return undefined;
}

// ── Module of the parent class row (E02) ──────────────────────────────────────

/** Class name to the module E02 gave its class row. */
export type ClassModules = ReadonlyMap<string, Module>;

/** Reads the class rows of an E02 observation file. */
export function classModulesFromObservations(text: string): Map<string, Module> {
  const out = new Map<string, Module>();
  for (const line of splitLines(text)) {
    if (line.trim() === "") continue;
    const v = JSON.parse(line) as Partial<Observation> & { $header?: number };
    if (v.$header !== undefined) continue;
    if (v.dim === "api" && v.kind === "class" && v.key?.class && v.module)
      out.set(v.key.class, v.module);
  }
  return out;
}

/** The class rows E02 would emit for this index (the same code path E02 runs). */
export function classModulesFromIndex(index: SourceIndex): Map<string, Module> {
  const out = new Map<string, Module>();
  for (const o of e02ObservationRows(index).observations)
    if (o.obs.kind === "class") out.set(o.obs.key.class as string, o.obs.module);
  return out;
}

// ── Scan ──────────────────────────────────────────────────────────────────────

/** Facts about one annotation, for the headline counts and the usage file. */
export interface Facts {
  id: string;
  ref: string;
  owner: string;
  member: string;
  scriptModule: string;
  plugin: boolean;
  /** `literal`: a non-empty string literal; `empty`: `""`; `expression`: anything else. */
  desc: "none" | "literal" | "empty" | "expression" | "unreadable";
  widget: WidgetUse;
  /** `enums` given and not null. */
  enumsSource: boolean;
  /** `enumType` given. */
  enumType: boolean;
  category: boolean;
  params: boolean;
  defvalue: boolean;
  problems: ProblemKind[];
}

export interface Merge {
  id: string;
  count: number;
  reason: string;
  refs: string[];
}

export interface Unreadable {
  id: string;
  ref: string;
  kinds: ProblemKind[];
  messages: string[];
  args: string;
}

export interface ScanResult {
  rows: { id: string; obs: Observation }[];
  facts: Facts[];
  /** Member variables in the index (kind `field`, an owner class). */
  memberVariables: number;
  /** Annotations named Attribute on member variables. */
  annotations: number;
  merges: Merge[];
  mergedAway: number;
  unreadable: Unreadable[];
  scrubbed: { id: string; field: string }[];
  /** Member variables with annotations but none named Attribute, by annotation name. */
  otherAnnotations: Record<string, number>;
  /** `Attribute` annotations on anything but a member variable (class, enum, method, global variable). */
  notOnMembers: number;
  /** Annotations whose first source line does not hold the whole annotation. */
  multiLine: number;
  /** Rows with no quote (the source line was not available). */
  noQuote: number;
  /** Classes with a plugin-setting row that inherit the attribute instead of carrying it. */
  inheritedPluginClasses: string[];
  /** Attributed members whose class has no E02 class row (parent null). */
  parentless: number;
}

export interface ScanOptions {
  /** Class rows of E02 (names and modules); defaults to what E02 would emit for the index. */
  classModules?: ClassModules;
  /** Lines of a file for `quote` (absent: no quote). */
  readLines?: (path: string) => string[] | undefined;
}

/**
 * True when the argument is given and says something: not an empty string
 * (params, category), not null (enums) and not null or void (enumType, whose
 * default is void).
 */
export function argumentSet(name: string, text: string | undefined): boolean {
  if (text === undefined) return false;
  const t = text.trim();
  if (name === "enums") return !/^(null|NULL)$/.test(t);
  if (name === "enumType") return !/^(null|NULL|void)$/.test(t);
  if (name === "params" || name === "category") return t !== '""';
  return true;
}

function descState(text: string | undefined, conflicted: boolean): Facts["desc"] {
  if (conflicted) return "unreadable";
  if (text === undefined) return "none";
  const lit = stringLiteral(text);
  if (lit === undefined) return "expression";
  return lit === "" ? "empty" : "literal";
}

/** The class declaration of `owner` whose body holds the field (for the modded-last ranking). */
function declarationOf(index: SourceIndex, f: FieldRecord): ClassRecord | undefined {
  const c = index.classes.get(f.owner ?? "");
  return c?.declarations.find((d) => d.file === f.file && f.line >= d.line && f.line <= d.end_line);
}

/** True when the annotation text on its first line has balanced parentheses (it ends on that line). */
function annotationOnOneLine(line: string, from: string): boolean {
  const i = line.indexOf(from);
  if (i < 0) return true;
  let depth = 0;
  let inStr = false;
  for (let k = i; k < line.length; k++) {
    const c = line[k];
    if (inStr) {
      if (c === "\\") k++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "(") depth++;
    else if (c === ")") depth--;
  }
  return depth === 0 && !inStr;
}

/** Stands in for an argument text that looks like a machine path (the pre-commit gate refuses those). */
export const PATH_PLACEHOLDER = '"<withheld>"';

/**
 * `<type> <member> = <defvalue> [UIWidgets.<Kind>, params: ..., enums: ..., enumType: ..., category: ...]`.
 * The default is the `defvalue` argument as written; the bracket holds the
 * widget kind (when the widget argument names a UIWidgets member) and the
 * other arguments the row's consumers need (enum source, category, params,
 * precision, prefabbed), each as written; `enums: null` and an empty string are left out. An
 * argument that holds a machine path is replaced by `"<withheld>"` and its
 * parameter name is pushed on `withheld`.
 */
export function attributeSignature(
  decl: string,
  values: Readonly<Record<string, string>>,
  kindName: string | undefined,
  withheld: string[] = [],
): string {
  const val = (name: string): string | undefined => {
    const t = values[name];
    if (t === undefined) return undefined;
    if (containsMachinePath(t)) {
      withheld.push(name);
      return PATH_PLACEHOLDER;
    }
    return t;
  };
  const def = val("defvalue");
  let sig = def !== undefined ? `${decl} = ${def}` : decl;
  const extra: string[] = [];
  if (kindName) extra.push(`UIWidgets.${kindName}`);
  for (const name of ["params", "enums", "enumType", "category", "precision", "prefabbed"]) {
    const t = val(name);
    if (t === undefined || !argumentSet(name, t)) continue;
    extra.push(`${name}: ${t}`);
  }
  if (extra.length > 0) sig += ` [${extra.join(", ")}]`;
  return sig;
}

/** One row per attributed member variable, merged by id, sorted. */
export function scanAttributes(index: SourceIndex, opts: ScanOptions = {}): ScanResult {
  const params = attributeParams(index);
  const widgets = uiWidgetMembers(index);
  const classModules = opts.classModules ?? classModulesFromIndex(index);
  const lineCache = new Map<string, string[] | undefined>();
  const linesOf = (f: string): string[] | undefined => {
    if (!lineCache.has(f)) lineCache.set(f, opts.readLines?.(f));
    return lineCache.get(f);
  };
  const pluginCache = new Map<string, PluginInfo | undefined>();
  const pluginOf = (c: string): PluginInfo | undefined => {
    if (!pluginCache.has(c)) pluginCache.set(c, pluginInfo(index, c));
    return pluginCache.get(c);
  };

  interface Cand {
    id: string;
    obs: Observation;
    rec: FieldRecord;
    rank: number;
    guards: string;
    modded: boolean;
  }
  const cands: Cand[] = [];
  const facts: Facts[] = [];
  const unreadable: Unreadable[] = [];
  const scrubbed: ScanResult["scrubbed"] = [];
  const otherAnnotations: Record<string, number> = {};
  const inherited = new Set<string>();
  let memberVariables = 0;
  let annotations = 0;
  let notOnMembers = 0;
  let multiLine = 0;
  let noQuote = 0;
  let parentless = 0;

  for (const r of index.records) {
    if (r.kind !== "field" && "attributes" in r)
      notOnMembers += r.attributes.filter((a) => a.name === ATTRIBUTE_CLASS).length;
    if (r.kind !== "field" || r.owner === undefined) continue;
    memberVariables++;
    const uses = r.attributes.filter((a) => a.name === ATTRIBUTE_CLASS);
    if (uses.length === 0) {
      for (const a of r.attributes) otherAnnotations[a.name] = (otherAnnotations[a.name] ?? 0) + 1;
      continue;
    }
    // A member carries one `Attribute` annotation; a second one would be read as its own row and merged.
    for (const ann of uses) {
      annotations++;
      const owner = r.owner;
      const parsed = parseAttributeArgs(ann.args, params);
      const conflicted = new Set(
        parsed.problems
          .filter((p) => p.kind === "given-twice")
          .map((p) => /argument "(\w+)"/.exec(p.message)?.[1] ?? ""),
      );
      const v = parsed.values;
      const widget = classifyWidget(v.uiwidget, widgets, conflicted.has("uiwidget"));
      const desc = descState(v.desc, conflicted.has("desc"));
      const plugin = pluginOf(owner);
      const claims = parsed.problems.map((p) => p.message);
      if (widget.state === "other")
        claims.push(
          '[Attribute] argument "uiwidget" is not a UIWidgets member; not recorded as a widget kind',
        );
      if (desc === "expression")
        claims.push('[Attribute] argument "desc" is not a string literal; not recorded');

      const withheld: string[] = [];
      const signature = attributeSignature(
        `${r.type} ${r.name}${r.array ?? ""}`,
        v,
        widget.state === "member" ? widget.kind : undefined,
        withheld,
      );

      let module: Module;
      let kind: Observation["kind"];
      let dim: Observation["dim"];
      let parentKey: Observation["parent_key"];
      if (plugin) {
        dim = "plugin";
        kind = "plugin-setting";
        module = plugin.module;
        parentKey = {
          dim: "plugin",
          kind: plugin.kind,
          module: plugin.module,
          key: { class: owner },
        };
        if (!plugin.direct) inherited.add(owner);
      } else {
        dim = "api";
        kind = "attribute";
        const cm = classModules.get(owner);
        module = cm ?? "none";
        parentKey = cm ? { dim: "api", kind: "class", module: cm, key: { class: owner } } : null;
        if (!cm) parentless++;
      }

      const lines = linesOf(r.file);
      const text = lines?.[ann.line - 1]?.trim();
      const quote: string | undefined = text ? text.slice(0, QUOTE_MAX) : undefined;
      if (text !== undefined && !annotationOnOneLine(text, ATTRIBUTE_CLASS)) multiLine++;
      let what: string | undefined;
      if (desc === "literal") what = stringLiteral(v.desc as string);

      const obs: Observation = {
        dim,
        kind,
        module,
        key: { class: owner, attr: r.name },
        parent_key: parentKey,
        label: r.name,
        signature,
        what,
        origin: "vanilla",
        ref: `pak:${r.file}#L${ann.line}`,
        quote,
        confidence: claims.length > 0 ? "medium" : "high",
        unverified: claims.length > 0 ? [...claims].sort(compareCodeUnits) : undefined,
      };
      const id = deriveId(obs);
      for (const w of withheld) scrubbed.push({ id, field: `signature: ${w}` });
      for (const f of ["signature", "what", "quote"] as const) {
        const val = obs[f];
        if (val !== undefined && containsMachinePath(val)) {
          delete obs[f];
          scrubbed.push({ id, field: f });
        }
      }
      for (const f of ["what", "quote", "unverified"] as const)
        if (obs[f] === undefined) delete obs[f];
      // The census files are scanned as text: JSON-escaped source text such as `e.g:\"` reads as a
      // drive path to the gate even though the decoded string does not. Drop the field that does it
      // (the quote, else the what, else both).
      for (const fields of [["quote"], ["what"], ["quote", "what"]] as const) {
        if (!containsMachinePath(jsonlLine(obs))) break;
        const trial: Observation = { ...obs };
        for (const f of fields) delete trial[f];
        if (containsMachinePath(jsonlLine(trial)) && fields.length < 2) continue;
        for (const f of fields) {
          if (obs[f] === undefined) continue;
          delete obs[f];
          scrubbed.push({ id, field: `${f} (reads as a path once JSON-escaped)` });
        }
      }
      if (containsMachinePath(jsonlLine(obs))) {
        obs.signature = `${r.type} ${r.name}${r.array ?? ""}`;
        scrubbed.push({ id, field: "signature (reads as a path once JSON-escaped)" });
      }
      if (obs.quote === undefined) noQuote++;
      const parsedObs = observationSchema.parse(obs);

      const problemKinds = [...new Set(parsed.problems.map((p) => p.kind))].sort(compareCodeUnits);
      facts.push({
        id,
        ref: parsedObs.ref,
        owner,
        member: r.name,
        scriptModule: r.script_module,
        plugin: plugin !== undefined,
        desc,
        widget,
        enumsSource: argumentSet("enums", v.enums),
        enumType: argumentSet("enumType", v.enumType),
        category: argumentSet("category", v.category),
        params: argumentSet("params", v.params),
        defvalue: v.defvalue !== undefined,
        problems: problemKinds,
      });
      if (parsed.problems.length > 0)
        unreadable.push({
          id,
          ref: parsedObs.ref,
          kinds: problemKinds,
          messages: parsed.problems.map((p) => p.message),
          args: (ann.args ?? "").slice(0, QUOTE_MAX),
        });
      const d = declarationOf(index, r);
      cands.push({
        id,
        obs: parsedObs,
        rec: r,
        rank: d?.modded ? 1 : 0,
        guards: r.guards.join(" & ") || "unguarded",
        modded: d?.modded === true,
      });
    }
  }

  // Merge rows that share an id: the first non-modded declaration, in (file, line) order.
  const groups = new Map<string, Cand[]>();
  for (const c of cands) {
    const g = groups.get(c.id);
    if (g) g.push(c);
    else groups.set(c.id, [c]);
  }
  const merges: Merge[] = [];
  const rows: ScanResult["rows"] = [];
  for (const [id, g] of groups) {
    const primary = g.reduce((best, c) => (c.rank < best.rank ? c : best), g[0]);
    if (g.length > 1) {
      const reasons: string[] = [];
      if (g.some((c) => c.modded)) reasons.push("modded class");
      if (new Set(g.map((c) => c.guards)).size > 1)
        reasons.push(`#ifdef branches (${[...new Set(g.map((c) => c.guards))].join(" / ")})`);
      if (reasons.length === 0) reasons.push("repeated declaration");
      merges.push({
        id,
        count: g.length,
        reason: reasons.join("; "),
        refs: g.map((c) => c.obs.ref),
      });
    }
    rows.push({ id, obs: primary.obs });
  }
  rows.sort((a, b) => compareCodeUnits(a.id, b.id));
  merges.sort((a, b) => compareCodeUnits(a.id, b.id));
  facts.sort((a, b) => compareCodeUnits(a.id, b.id) || compareCodeUnits(a.ref, b.ref));
  unreadable.sort((a, b) => compareCodeUnits(a.id, b.id) || compareCodeUnits(a.ref, b.ref));
  scrubbed.sort((a, b) => compareCodeUnits(a.id, b.id) || compareCodeUnits(a.field, b.field));
  return {
    rows,
    facts,
    memberVariables,
    annotations,
    merges,
    mergedAway: annotations - rows.length,
    unreadable,
    scrubbed,
    otherAnnotations,
    notOnMembers,
    multiLine,
    noQuote,
    inheritedPluginClasses: [...inherited].sort(compareCodeUnits),
    parentless,
  };
}

// ── Observation file ──────────────────────────────────────────────────────────

export interface InputHash {
  path: string;
  sha256: string;
}

/** Exact text of the E15 observation file. */
export function observationFileText(
  scan: ScanResult,
  build: string,
  inputs: readonly InputHash[],
): string {
  const header = {
    $header: 1,
    build,
    enumerator: ENUMERATOR_ID,
    generator: GENERATOR,
    inputs: [...inputs],
    provisional: false,
    row_count: scan.rows.length,
  };
  return (
    [jsonlLine(header, ["$header"]), ...scan.rows.map((r) => jsonlLine(r.obs))].join("\n") + "\n"
  );
}

// ── Usage per UIWidgets member (E16 reads this) ───────────────────────────────

export interface UsageExample {
  id: string;
  ref: string;
}

export interface WidgetUsage {
  value: string | null;
  uses: number;
  as_symbol: number;
  as_string_literal: number;
  examples: UsageExample[];
}

export interface UiwidgetsUsage {
  build: string;
  /** What is counted. */
  basis: string;
  attributes: number;
  members: number;
  members_unused: string[];
  kinds: Record<string, WidgetUsage>;
  /** The widget argument is the empty string (Hidden and None both hold ""). */
  empty_literal: { uses: number; examples: UsageExample[] };
  /** The widget argument is something else (a description string in the widget slot, a name that is no member). */
  other: { uses: number; examples: (UsageExample & { text: string })[] };
  /** No widget argument: the engine default is the Auto member. */
  not_given: { uses: number; examples: UsageExample[] };
  /** The widget argument could not be read (a parameter given twice). */
  unreadable: { uses: number; examples: UsageExample[] };
}

const EXAMPLES = 3;

/** Uses per UIWidgets member, with three example members each (the first three by row id). */
export function uiwidgetsUsage(
  index: SourceIndex,
  scan: ScanResult,
  build: string,
): UiwidgetsUsage {
  const members = uiWidgetMembers(index);
  const kinds: Record<string, WidgetUsage> = {};
  for (const m of members)
    kinds[m.name] = {
      value: m.value ?? null,
      uses: 0,
      as_symbol: 0,
      as_string_literal: 0,
      examples: [],
    };
  const otherEx: (UsageExample & { text: string })[] = [];
  const bucket = {
    empty: { uses: 0, examples: [] as UsageExample[] },
    none: { uses: 0, examples: [] as UsageExample[] },
    bad: { uses: 0, examples: [] as UsageExample[] },
    other: 0,
  };
  const push = (list: UsageExample[], f: Facts): void => {
    if (list.length < EXAMPLES) list.push({ id: f.id, ref: f.ref });
  };
  for (const f of scan.facts) {
    const w = f.widget;
    if (w.state === "member") {
      const k = (kinds[w.kind] ??= {
        value: null,
        uses: 0,
        as_symbol: 0,
        as_string_literal: 0,
        examples: [],
      });
      k.uses++;
      if (w.form === "symbol") k.as_symbol++;
      else k.as_string_literal++;
      push(k.examples, f);
    } else if (w.state === "empty-literal") {
      bucket.empty.uses++;
      push(bucket.empty.examples, f);
    } else if (w.state === "none") {
      bucket.none.uses++;
      push(bucket.none.examples, f);
    } else if (w.state === "unreadable") {
      bucket.bad.uses++;
      push(bucket.bad.examples, f);
    } else {
      bucket.other++;
      if (otherEx.length < EXAMPLES)
        otherEx.push({ id: f.id, ref: f.ref, text: w.text.slice(0, 80) });
    }
  }
  return {
    build,
    basis: `one use per [Attribute] annotation on a member variable in the E02 source index (${scan.annotations}); ${scan.rows.length} become rows, ${scan.mergedAway} repeat another row's id`,
    attributes: scan.annotations,
    members: members.length,
    members_unused: Object.entries(kinds)
      .filter(([, k]) => k.uses === 0)
      .map(([n]) => n),
    kinds,
    empty_literal: bucket.empty,
    other: { uses: bucket.other, examples: otherEx },
    not_given: bucket.none,
    unreadable: bucket.bad,
  };
}

export function artifactsE15Dir(build: string, dir: string = artifactsDir()): string {
  if (!/^[A-Za-z0-9._-]+$/.test(build)) throw new Error(`invalid build tag "${build}"`);
  return join(dir, "census", build, ENUMERATOR_ID);
}

export function uiwidgetsUsagePath(build: string, dir: string = artifactsDir()): string {
  return join(artifactsE15Dir(build, dir), "uiwidgets-usage.json");
}

export function scanReportPath(build: string, dir: string = artifactsDir()): string {
  return join(artifactsE15Dir(build, dir), "scan-report.json");
}

// ── Headline counts ───────────────────────────────────────────────────────────

export interface HeadlineCounts {
  member_variables: number;
  global_variables: number;
  attributed_members: number;
  attributed_members_per_script_module: Record<string, number>;
  files_per_script_module: Record<string, number>;
  rows: number;
  rows_by_kind: Record<string, number>;
  rows_by_module: Record<string, number>;
  merged_away: number;
  classes_with_attribute: number;
  plugin_classes_with_setting: number;
  with_desc: number;
  desc_empty: number;
  desc_not_literal: number;
  with_uiwidget: number;
  uiwidget_not_a_member: number;
  with_enum_source: { enums: number; enumType: number; either: number };
  with_category: number;
  with_params: number;
  with_defvalue: number;
  unreadable: number;
  unreadable_by_kind: Record<string, number>;
  multi_line_annotations: number;
  other_annotations_only: { members: number; by_name: Record<string, number> };
  attribute_not_on_members: number;
  parentless_attribute_rows: number;
  inherited_plugin_classes: string[];
  scrubbed: number;
  uiwidgets_members: number;
  uiwidget_uses: Record<string, number>;
}

export function headlineCounts(index: SourceIndex, scan: ScanResult): HeadlineCounts {
  const perModule: Record<string, number> = {};
  const rowsByKind: Record<string, number> = {};
  const rowsByModule: Record<string, number> = {};
  const classes = new Set<string>();
  const pluginClasses = new Set<string>();
  const by = (o: Record<string, number>, k: string): void => {
    o[k] = (o[k] ?? 0) + 1;
  };
  let withDesc = 0;
  let descEmpty = 0;
  let descExpr = 0;
  let withWidget = 0;
  let widgetOther = 0;
  let enums = 0;
  let enumType = 0;
  let either = 0;
  let category = 0;
  let params = 0;
  let defvalue = 0;
  const unreadableByKind: Record<string, number> = {};
  for (const f of scan.facts) {
    by(perModule, f.scriptModule);
    classes.add(f.owner);
    if (f.plugin) pluginClasses.add(f.owner);
    if (f.desc === "literal") withDesc++;
    else if (f.desc === "empty") descEmpty++;
    else if (f.desc === "expression") descExpr++;
    if (f.widget.state === "member") withWidget++;
    else if (f.widget.state === "other") widgetOther++;
    if (f.enumsSource) enums++;
    if (f.enumType) enumType++;
    if (f.enumsSource || f.enumType) either++;
    if (f.category) category++;
    if (f.params) params++;
    if (f.defvalue) defvalue++;
    for (const k of f.problems) by(unreadableByKind, k);
  }
  for (const r of scan.rows) {
    by(rowsByKind, r.obs.kind);
    by(rowsByModule, r.obs.module);
  }
  const usage = uiwidgetsUsage(index, scan, "");
  const filesPer: Record<string, number> = {};
  for (const f of index.files) by(filesPer, f.script_module);
  const otherNames = scan.otherAnnotations;
  let otherMembers = 0;
  for (const r of index.records)
    if (
      r.kind === "field" &&
      r.owner !== undefined &&
      r.attributes.length > 0 &&
      !r.attributes.some((a) => a.name === ATTRIBUTE_CLASS)
    )
      otherMembers++;
  return {
    member_variables: scan.memberVariables,
    global_variables: index.records.filter((r) => r.kind === "variable").length,
    attributed_members: scan.annotations,
    attributed_members_per_script_module: sortKeys(perModule),
    files_per_script_module: sortKeys(filesPer),
    rows: scan.rows.length,
    rows_by_kind: sortKeys(rowsByKind),
    rows_by_module: sortKeys(rowsByModule),
    merged_away: scan.mergedAway,
    classes_with_attribute: classes.size,
    plugin_classes_with_setting: pluginClasses.size,
    with_desc: withDesc,
    desc_empty: descEmpty,
    desc_not_literal: descExpr,
    with_uiwidget: withWidget,
    uiwidget_not_a_member: widgetOther,
    with_enum_source: { enums, enumType, either },
    with_category: category,
    with_params: params,
    with_defvalue: defvalue,
    unreadable: scan.unreadable.length,
    unreadable_by_kind: sortKeys(unreadableByKind),
    multi_line_annotations: scan.multiLine,
    other_annotations_only: { members: otherMembers, by_name: sortKeys(otherNames) },
    attribute_not_on_members: scan.notOnMembers,
    parentless_attribute_rows: scan.parentless,
    inherited_plugin_classes: scan.inheritedPluginClasses,
    scrubbed: scan.scrubbed.length,
    uiwidgets_members: usage.members,
    uiwidget_uses: Object.fromEntries(Object.entries(usage.kinds).map(([k, v]) => [k, v.uses])),
  };
}

function sortKeys<T>(o: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(o).sort(([a], [b]) => compareCodeUnits(a, b)));
}

// ── Cross-enumerator check (E03, E17) ─────────────────────────────────────────

export interface SharedIds {
  /** The other enumerator's observation file was read. */
  present: boolean;
  /** Plugin-setting ids in both files. */
  shared: number;
  /** Shared ids where dim, kind or module differ: `<id>: <ours> vs <theirs>`. */
  disagree: string[];
}

/** Compares our plugin-setting rows with the plugin-setting rows of another observation file. */
export function sharedPluginIds(scan: ScanResult, otherText: string | undefined): SharedIds {
  if (otherText === undefined) return { present: false, shared: 0, disagree: [] };
  const ours = new Map(
    scan.rows.filter((r) => r.obs.kind === "plugin-setting").map((r) => [r.id, r.obs]),
  );
  let shared = 0;
  const disagree: string[] = [];
  for (const line of splitLines(otherText)) {
    if (line.trim() === "") continue;
    const v = JSON.parse(line) as Observation & { $header?: number };
    if (v.$header !== undefined || v.kind !== "plugin-setting") continue;
    let id: string;
    try {
      id = deriveId(v);
    } catch {
      continue;
    }
    const mine = ours.get(id);
    if (!mine) continue;
    shared++;
    if (mine.dim !== v.dim || mine.kind !== v.kind || mine.module !== v.module)
      disagree.push(
        `${id}: ${mine.dim}/${mine.kind}/${mine.module} vs ${v.dim}/${v.kind}/${v.module}`,
      );
  }
  return { present: true, shared, disagree: disagree.sort(compareCodeUnits) };
}

// ── Raw cross-check ───────────────────────────────────────────────────────────

/**
 * Number of `Attribute` annotations in the tokens of a file: an `Attribute`
 * name that starts an annotation list (right after `[`) or follows another
 * entry of the list (after `,`, and itself followed by `(`, `]` or `,`).
 */
export function rawAttributeCount(text: string): number {
  const toks = lex(text).toks;
  let n = 0;
  for (let i = 1; i < toks.length; i++) {
    if (toks[i].k !== "id" || toks[i].t !== ATTRIBUTE_CLASS) continue;
    const prev = toks[i - 1].t;
    const next = toks[i + 1]?.t;
    if (prev === "[" || (prev === "," && (next === "(" || next === "]" || next === ","))) n++;
  }
  return n;
}

// ── CLI ───────────────────────────────────────────────────────────────────────

const USAGE =
  "usage: e15-attribute-scan.ts [--build <tag>] [--game <dir>] [--out <file under observations/E15/>] [--data <dir>] [--counts] [--verify-raw] [--json]";

/** Resolves `--out`, refusing anything outside `<census>/observations/E15/`. */
export function resolveOut(paths: CensusPaths, out: string | undefined, build: string): string {
  const dir = join(paths.observations, ENUMERATOR_ID);
  const file = out ? resolve(out) : join(dir, `${build}.jsonl`);
  if (dirname(file) !== dir || !file.endsWith(".jsonl")) {
    throw new Error(
      "refusing --out outside observations/E15/ (E15 writes only its own observation directory)",
    );
  }
  return file;
}

export function run(argv: string[], io: Io = PROCESS_IO): number {
  return guard(io, "e15-attribute-scan", () => {
    const { values } = parseArgs({
      args: argv,
      options: {
        build: { type: "string" },
        game: { type: "string" },
        out: { type: "string" },
        data: { type: "string" },
        counts: { type: "boolean" },
        "verify-raw": { type: "boolean" },
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
      io.err(`e15-attribute-scan: ${e instanceof Error ? e.message : String(e)}`);
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

    // Inputs: the E02 source index (artifacts folder, else parsed from the paks in memory).
    const indexFile = sourceIndexPath(build, artifactsDir());
    const loaded = loadSourceIndex(build, { file: indexFile });
    const index = loaded ?? buildSourceIndex(vfs, { build });
    const inputs: InputHash[] = [
      {
        path: `<artifacts>/census/${build}/E02/source-index.jsonl`,
        sha256: sha256(loaded ? readFileSync(indexFile) : Buffer.from(sourceIndexText(index))),
      },
    ];

    // Class rows of E02: its observation file when present (the task's reference), checked against a recompute.
    const e02File = join(paths.observations, "E02", `${build}.jsonl`);
    const recomputed = classModulesFromIndex(index);
    let classModules: Map<string, Module> = recomputed;
    let moduleSource = "recomputed from the index (no E02 observation file)";
    let moduleDiffs: string[] = [];
    if (existsSync(e02File)) {
      const bytes = readFileSync(e02File);
      classModules = classModulesFromObservations(bytes.toString("utf-8"));
      moduleSource = `E02 observation file (${classModules.size} class rows)`;
      for (const [c, m] of classModules)
        if (recomputed.get(c) !== m)
          moduleDiffs.push(`${c}: file ${m} vs recomputed ${recomputed.get(c) ?? "-"}`);
      for (const c of recomputed.keys())
        if (!classModules.has(c))
          moduleDiffs.push(`${c}: recomputed ${recomputed.get(c)} vs file -`);
      moduleDiffs = moduleDiffs.sort(compareCodeUnits);
      inputs.push({
        path: `<repo>/data/census/observations/E02/${build}.jsonl`,
        sha256: sha256(bytes),
      });
    }

    // Source lines of the files that hold an attributed member (for quotes), hashed over their bytes.
    const files = new Set<string>();
    for (const r of index.records)
      if (r.kind === "field" && r.attributes.some((a) => a.name === ATTRIBUTE_CLASS))
        files.add(r.file);
    const lineMap = new Map<string, string[]>();
    const hashLines: string[] = [];
    for (const f of [...files].sort(compareCodeUnits)) {
      const bytes = vfs.readFile(f);
      hashLines.push(`${f}\u0000${sha256(bytes)}\n`);
      lineMap.set(f, vfs.readTextFile(f).split(/\r?\n/));
    }
    inputs.push({
      path: "<game>/addons/**/scripts/**/*.c (files holding an [Attribute] member variable)",
      sha256: sha256(hashLines.join("")),
    });

    const scan = scanAttributes(index, { classModules, readLines: (p) => lineMap.get(p) });
    mkdirSync(dirname(out), { recursive: true });
    writeFileAtomic(out, observationFileText(scan, build, inputs));

    const usage = uiwidgetsUsage(index, scan, build);
    const e3 = join(paths.observations, "E03", `${build}.jsonl`);
    const e17 = join(paths.observations, "E17", `${build}.jsonl`);
    const shared = {
      E03: sharedPluginIds(scan, existsSync(e3) ? readFileSync(e3, "utf-8") : undefined),
      E17: sharedPluginIds(scan, existsSync(e17) ? readFileSync(e17, "utf-8") : undefined),
    };
    const counts = headlineCounts(index, scan);
    let raw:
      | { annotations_in_index: number; raw_tokens: number; files_differing: string[] }
      | undefined;
    if (values["verify-raw"]) {
      // One annotation can head several declarators (`int a, b;`): count each source line once.
      const perFile = new Map<string, number>();
      const seen = new Set<string>();
      for (const r of index.records)
        for (const a of "attributes" in r ? r.attributes : [])
          if (a.name === ATTRIBUTE_CLASS && !seen.has(`${r.file}#${a.line}`)) {
            seen.add(`${r.file}#${a.line}`);
            perFile.set(r.file, (perFile.get(r.file) ?? 0) + 1);
          }
      let tokens = 0;
      let indexed = 0;
      const differing: string[] = [];
      for (const f of index.files) {
        const text = vfs.readTextFile(f.file);
        if (!text.includes(ATTRIBUTE_CLASS)) {
          indexed += perFile.get(f.file) ?? 0;
          continue;
        }
        const n = rawAttributeCount(text);
        const m = perFile.get(f.file) ?? 0;
        tokens += n;
        indexed += m;
        if (n !== m) differing.push(`${f.file}: ${n} tokens vs ${m} indexed`);
      }
      raw = { annotations_in_index: indexed, raw_tokens: tokens, files_differing: differing };
    }
    const reportDir = artifactsE15Dir(build, artifactsDir());
    mkdirSync(reportDir, { recursive: true });
    writeFileAtomic(uiwidgetsUsagePath(build, artifactsDir()), formatJson(usage));
    writeFileAtomic(
      scanReportPath(build, artifactsDir()),
      formatJson({
        build,
        counts,
        merges: scan.merges,
        unreadable: scan.unreadable,
        scrubbed: scan.scrubbed,
        module_source: moduleSource,
        module_diffs: moduleDiffs,
        shared_ids: shared,
        raw_check: raw ?? null,
      }),
    );

    if (values.json) {
      io.out(
        JSON.stringify({
          ok: true,
          command: "e15-attribute-scan",
          build,
          rows: scan.rows.length,
          counts,
          merges: scan.merges,
          unreadable: scan.unreadable,
          module_source: moduleSource,
          module_diffs: moduleDiffs,
          shared_ids: shared,
          raw_check: raw ?? null,
        }),
      );
      return EXIT_OK;
    }
    io.out(
      `module of parent classes: ${moduleSource}; ${moduleDiffs.length} disagreement(s) with a recompute`,
    );
    for (const m of scan.merges) io.out(`merged ${m.id}: ${m.count} declarations (${m.reason})`);
    for (const u of scan.unreadable)
      io.out(`unreadable ${u.id} ${u.ref}: ${u.messages.join("; ")}`);
    if (values.counts) io.out(JSON.stringify(counts, null, 2));
    if (raw) io.out(`raw check: ${JSON.stringify(raw)}`);
    io.out(
      `E15 at build ${build}: ${scan.rows.length} observations (${Object.entries(
        counts.rows_by_kind,
      )
        .map(([k, n]) => `${k} ${n}`)
        .join(
          ", ",
        )}) from ${scan.annotations} annotations, ${scan.mergedAway} merged away, ${scan.unreadable.length} unreadable`,
    );
    return EXIT_OK;
  });
}

if (isMainModule(import.meta.url)) process.exitCode = run(process.argv.slice(2));
