/**
 * Source backfill of the API index (plan Phase 1 item 1, Appendix D).
 *
 * Declarations the game's script source has are missing from the scraped
 * index: methods under preprocessor guards, protected static methods (before
 * the parser read Doxygen's "Static Protected Member Functions" section), every
 * declaration a `\code` block left open by a `/endcode` typo swallowed, and
 * whole classes. Bohemia's pages document many of them; the scraper missed
 * them. The E02 source index (`src/census/source-index.ts`, built
 * from the script files of the game paks) has them all. This module adds to
 * the index every method and class the source declares and the index lacks,
 * measured the way the E12 enumerator measures a loss:
 *
 *  - a source class is one with a declaration that is not a forward
 *    declaration; an index class is matched by its name with Doxygen's page
 *    title and template parameters removed, and a class held by more than one
 *    page (or both files) is read as one class. A source class with no page of
 *    its exact name pairs with the one page whose name differs only in case and
 *    is not itself a source class (Doxygen titles `typename` as `TypeName`);
 *  - the methods the index is expected to hold are the class's own methods
 *    that are neither `private` nor declared in a `modded class`;
 *  - index entries pair with source methods on (name, arity), an exact
 *    signature first, then in order. The name is read from `signature`, as
 *    E12 reads it (an entry not yet through `correctMethodNames` holds
 *    Doxygen's glued link text in `name`), and the arity is the parameter
 *    count the signature states.
 *
 * What it writes:
 *  - a missing method is appended to `methods`, `protectedMethods` (protected,
 *    static or not) or `staticMethods` (public static) of the class's first
 *    index page, in the index's entry shape, with `origin: "pak"`, `pakFile`
 *    and `pakLine` added, and `guards` when the declaration sits under
 *    preprocessor guards. `returnType` holds the source's modifiers (without
 *    `private` / `protected`, which the array states) and the return type, as
 *    Doxygen writes it; `signature` is the source declaration as written;
 *    `description` is the doc comment, cut at 500 characters as the parser
 *    cuts Doxygen's;
 *  - a missing class is inserted in the file its script module's classes are
 *    held in, with its methods and the same provenance fields.
 *
 * What it withholds: a lost guarded method whose class holds a method of the
 * same name declared in the opposite branch of a guard (`#ifndef X` against
 * its `#else`, `#ifdef WORKBENCH` against `#ifndef WORKBENCH`) is the branch
 * Doxygen did not read, an alternative of a method the index already has, not
 * more API. It is reported in `withheld`, never written.
 *
 * The entries it writes are a layer over Doxygen's: every run first removes
 * the entries marked `origin: "pak"` and derives them again from the source
 * index, so a new source build refreshes them and prunes what the source no
 * longer declares. It never removes or rewrites an entry Doxygen produced;
 * the two exceptions are `correctParamsArrays`, which rewrites only a `params`
 * array that differs from the array the depth-aware parser reads from the
 * entry's own signature, and `correctMethodNames`, which sets only a `name`
 * that differs from the identifier the entry's own signature declares.
 * Running it twice changes nothing the second time.
 */
import type { ClassInfo, MethodInfo, ParamInfo } from "../index/types.js";
import type {
  ClassRecord,
  MergedClass,
  MethodRecord,
  SourceIndex,
} from "../census/source-index.js";
import {
  METHOD_MODIFIERS,
  normalizeClassName,
  normalizeReturn,
  normalizeType,
  parseParamsFromSignature,
  signatureName,
  splitSignatureParams,
  typeOfParamText,
} from "./signature.js";

/** Marks an entry the source index produced, not Doxygen. */
export interface PakOrigin {
  origin: "pak";
  /** Virtual pak path of the declaration, e.g. `scripts/Core/generated/WorkbenchAPI/WorldEditorAPI.c`. */
  pakFile: string;
  /** 1-based line of the declared name. */
  pakLine: number;
  /**
   * Enclosing preprocessor guards, outermost first, as the source index states
   * them (`ENABLE_DIAG`, `!WORKBENCH`, `if <expr>`; an `#else` branch reads as
   * the flipped guard). Absent when the declaration is unguarded.
   */
  guards?: string[];
}

/** True for an entry the backfill wrote (not Doxygen). */
export function isPakEntry(e: unknown): boolean {
  return !!e && typeof e === "object" && (e as Partial<PakOrigin>).origin === "pak";
}

export type PakMethodInfo = MethodInfo & PakOrigin;
export type PakClassInfo = ClassInfo & PakOrigin;

/** One API index file as the backfill reads and extends it. */
export interface ApiIndexFile {
  /** `enfusion-classes.json` or `arma-classes.json`. */
  file: string;
  source: "enfusion" | "arma";
  /** Extended in place. */
  classes: ClassInfo[];
}

export type MethodArray = "methods" | "protectedMethods" | "staticMethods";
const ARRAYS: readonly MethodArray[] = ["methods", "protectedMethods", "staticMethods"];

/** Why the index lacked a declaration (E12's cause names; the block causes come from the source index's doc warnings). */
export type LossReason =
  | "class-missing-from-index"
  | "doxygen-block-typo"
  | "doxygen-block-unterminated"
  | "protected-static-method"
  | "preprocessor-guard"
  | "constructor-or-destructor"
  | "unexplained";

/** Why a lost source method was not added. */
export type WithholdReason = "inactive-branch-alternative";

/** Doxygen cuts method descriptions here; backfilled ones follow the same rule. */
const DESCRIPTION_MAX = 500;

// ── The two sides, read the way E12 reads them ───────────────────────────────

interface IdxMethod {
  name: string;
  arity: number;
  static: boolean;
  ret: string;
  params: string[];
}

function readIdxMethod(m: MethodInfo, array: MethodArray): IdxMethod {
  const signature = typeof m.signature === "string" ? m.signature : "";
  const params = Array.isArray(m.params) ? m.params : [];
  const sigParams = splitSignatureParams(signature);
  const words = (m.returnType ?? "").trim().split(/\s+/).filter(Boolean);
  const modifiers: string[] = [];
  while (words.length > 0 && METHOD_MODIFIERS.has(words[0]))
    modifiers.push(words.shift() as string);
  const types =
    params.length === sigParams.length || sigParams.length === 0
      ? params.map((p) => (p && typeof p.type === "string" ? p.type : ""))
      : sigParams.map(typeOfParamText);
  return {
    name: signatureName(signature) ?? m.name,
    arity: sigParams.length > 0 || params.length === 0 ? sigParams.length : params.length,
    static: array === "staticMethods" || modifiers.includes("static"),
    ret: normalizeReturn(words.join(" ")),
    params: types.map(normalizeType),
  };
}

interface SrcMethod {
  rec: MethodRecord;
  expected: boolean;
  private: boolean;
  protected: boolean;
  static: boolean;
  ret: string;
  params: string[];
}

function srcMethodsOf(cls: MergedClass): SrcMethod[] {
  return cls.methods.map((m) => {
    const decl = cls.declarations.find(
      (d) => d.file === m.file && m.line >= d.line && m.line <= d.end_line,
    );
    const priv = m.modifiers.includes("private");
    return {
      rec: m,
      expected: !priv && !(decl?.modded ?? false),
      private: priv,
      protected: m.modifiers.includes("protected"),
      static: m.modifiers.includes("static"),
      ret: normalizeReturn(m.return_type),
      params: m.params.map((p) => normalizeType([...p.modifiers, p.type].join(" "))),
    };
  });
}

const sigKeySrc = (s: SrcMethod): string => [s.static ? 1 : 0, s.ret, s.params.join(",")].join("|");
const sigKeyIdx = (m: IdxMethod): string => [m.static ? 1 : 0, m.ret, m.params.join(",")].join("|");

/** Source classes the comparison covers: those with a declaration that is not a forward one. */
function sourceClasses(index: SourceIndex): MergedClass[] {
  return [...index.classes.values()]
    .filter((c) => c.declarations.some((d) => !d.forward))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

function declOf(c: MergedClass): ClassRecord {
  return (c.declarations.find((d) => !d.forward && !d.modded) ??
    c.declarations.find((d) => !d.forward)) as ClassRecord;
}

interface IndexedClass {
  /** Every page that holds the class, first page first. */
  pages: { file: ApiIndexFile; cls: ClassInfo }[];
}

/**
 * The index page(s) of a source class: by exact name, else the one page whose
 * name differs only in case and is not a source class's name (Doxygen titles
 * the `typename` class `TypeName`).
 *
 * Twin of `indexClassLookup` in `scripts/census/enumerators/e12-api-index.ts`;
 * the two must agree, so a change to one is a change to the other.
 */
type ClassLookup = (name: string) => IndexedClass | undefined;

function indexByName(files: readonly ApiIndexFile[], index: SourceIndex): ClassLookup {
  const exact = new Map<string, IndexedClass>();
  for (const file of files)
    for (const cls of file.classes) {
      const name = normalizeClassName(cls.name);
      const prev = exact.get(name);
      if (prev) prev.pages.push({ file, cls });
      else exact.set(name, { pages: [{ file, cls }] });
    }
  const byLower = new Map<string, string[]>();
  for (const name of exact.keys()) {
    if (index.classes.has(name)) continue;
    const k = name.toLowerCase();
    byLower.set(k, [...(byLower.get(k) ?? []), name]);
  }
  return (name) => {
    const hit = exact.get(name);
    if (hit) return hit;
    const alias = byLower.get(name.toLowerCase());
    return alias && alias.length === 1 ? exact.get(alias[0]) : undefined;
  };
}

/**
 * The guard that holds in the other branch of `g`'s conditional (as the source index flips it at `#else`).
 * `flipGuard` and `opposes` are twins of the same helpers in `scripts/census/enumerators/e12-api-index.ts`.
 */
function flipGuard(g: string): string {
  return g.startsWith("!") ? g.slice(1) : `!${g}`;
}

/** True when `a` and `b` sit in opposite branches of one guard. */
function opposes(a: readonly string[], b: readonly string[]): boolean {
  return a.some((g) => b.includes(flipGuard(g)));
}

interface Losses {
  /** Expected source methods no index entry pairs with, to be added. */
  lost: SrcMethod[];
  /** Lost guarded methods whose class holds a same-named method from the opposite branch. */
  withheld: { s: SrcMethod; of: SrcMethod }[];
}

/**
 * The class's own expected source methods that no index entry pairs with,
 * paired as E12 pairs them: within one (name, arity), an exact signature
 * first, then in order. A lost guarded method whose same-named sibling in the
 * opposite branch is paired is withheld, not lost.
 */
function lostMethods(cls: MergedClass, indexed: IndexedClass): Losses {
  const src = srcMethodsOf(cls);
  const srcByKey = new Map<string, SrcMethod[]>();
  for (const s of src) {
    const k = `${s.rec.name}/${s.rec.arity}`;
    const l = srcByKey.get(k);
    if (l) l.push(s);
    else srcByKey.set(k, [s]);
  }
  const idxByKey = new Map<string, IdxMethod[]>();
  for (const { cls: page } of indexed.pages)
    for (const array of ARRAYS)
      for (const m of page[array] ?? []) {
        if (!m || typeof m !== "object") continue;
        const e = readIdxMethod(m, array);
        const k = `${e.name}/${e.arity}`;
        const l = idxByKey.get(k);
        if (l) l.push(e);
        else idxByKey.set(k, [e]);
      }
  const paired = new Set<SrcMethod>();
  for (const [k, entries] of idxByKey) {
    const cands = srcByKey.get(k);
    if (!cands) continue;
    const taken = new Set<IdxMethod>();
    for (const e of entries) {
      const s = cands.find((c) => !paired.has(c) && sigKeySrc(c) === sigKeyIdx(e));
      if (s) {
        paired.add(s);
        taken.add(e);
      }
    }
    for (const e of entries) {
      if (taken.has(e)) continue;
      const s = cands.find((c) => !paired.has(c));
      if (s) paired.add(s);
    }
  }
  const out: Losses = { lost: [], withheld: [] };
  for (const s of src) {
    if (!s.expected || paired.has(s)) continue;
    const of =
      s.rec.guards.length === 0
        ? undefined
        : src.find(
            (t) =>
              t !== s &&
              paired.has(t) &&
              t.rec.name === s.rec.name &&
              opposes(s.rec.guards, t.rec.guards),
          );
    if (of) out.withheld.push({ s, of });
    else out.lost.push(s);
  }
  return out;
}

// ── Entries built from the source ────────────────────────────────────────────

function description(doc: string | undefined): string {
  const t = (doc ?? "").trim();
  return t.length > DESCRIPTION_MAX ? t.slice(0, DESCRIPTION_MAX) + "..." : t;
}

function paramOf(p: MethodRecord["params"][number]): ParamInfo {
  return {
    name: (p.name ?? "") + (p.array ?? ""),
    type: [...p.modifiers, p.type].join(" "),
    defaultValue: p.default ?? "",
  };
}

/** The index entry of a source method. */
export function methodEntry(rec: MethodRecord): PakMethodInfo {
  const modifiers = rec.modifiers.filter((m) => m !== "private" && m !== "protected");
  return {
    name: rec.name,
    returnType: [...modifiers, rec.return_type].filter((w) => w !== "").join(" "),
    signature: rec.signature,
    params: rec.params.map(paramOf),
    description: description(rec.doc),
    origin: "pak",
    pakFile: rec.file,
    pakLine: rec.line,
    ...(rec.guards.length > 0 ? { guards: [...rec.guards] } : {}),
  };
}

/** The array a source method belongs in: protected first (Doxygen's protected sections), then public static. */
export function arrayFor(rec: MethodRecord): MethodArray {
  if (rec.modifiers.includes("protected")) return "protectedMethods";
  if (rec.modifiers.includes("static")) return "staticMethods";
  return "methods";
}

function lossReason(s: SrcMethod, index: SourceIndex): LossReason {
  const warn = index.header.doc_warnings.find(
    (w) => w.file === s.rec.file && w.line < s.rec.line && w.message.includes("\\code"),
  );
  if (warn)
    return warn.message.includes("/endcode") ? "doxygen-block-typo" : "doxygen-block-unterminated";
  if (s.protected && s.static) return "protected-static-method";
  if (s.rec.guards.length > 0) return "preprocessor-guard";
  if (s.rec.is_constructor || s.rec.is_destructor) return "constructor-or-destructor";
  return "unexplained";
}

// ── Where a missing class goes ───────────────────────────────────────────────

/**
 * The file a missing class goes to: the file that holds most of the indexed
 * classes of its script module (Core, GameLib and the Workbench*Common modules
 * are in the Enfusion file; Game and the rest in the Arma file); the last file
 * when the module has no indexed class.
 */
function fileForModule(
  files: readonly ApiIndexFile[],
  index: SourceIndex,
  indexed: ClassLookup,
): (module: string) => ApiIndexFile {
  const counts = new Map<string, number[]>();
  for (const c of sourceClasses(index)) {
    const hit = indexed(c.name);
    if (!hit) continue;
    const m = declOf(c).script_module;
    const row = counts.get(m) ?? files.map(() => 0);
    row[files.indexOf(hit.pages[0].file)]++;
    counts.set(m, row);
  }
  return (module) => {
    const row = counts.get(module);
    if (!row) return files[files.length - 1];
    let best = 0;
    for (let i = 1; i < row.length; i++) if (row[i] > row[best]) best = i;
    return files[best];
  };
}

/** Inserts a class before the first entry whose name sorts after it (case-insensitive), else appends. */
function insertClass(classes: ClassInfo[], cls: ClassInfo): void {
  const key = cls.name.toLowerCase();
  const at = classes.findIndex((c) => c.name.toLowerCase() > key);
  if (at < 0) classes.push(cls);
  else classes.splice(at, 0, cls);
}

function classEntry(
  cls: MergedClass,
  file: ApiIndexFile,
  index: SourceIndex,
  methods: MethodRecord[],
): PakClassInfo {
  const decl = declOf(cls);
  const arrays: Record<MethodArray, PakMethodInfo[]> = {
    methods: [],
    protectedMethods: [],
    staticMethods: [],
  };
  for (const m of methods) arrays[arrayFor(m)].push(methodEntry(m));
  const doc = description(decl.doc);
  const children = [...index.classes.values()]
    .filter((c) =>
      c.declarations.some((d) => !d.forward && !d.modded && d.parent_name === cls.name),
    )
    .map((c) => c.name)
    .sort();
  return {
    name: cls.name,
    source: file.source,
    brief: doc.split("\n")[0].trim(),
    description: doc,
    parents: cls.parent_name ? [cls.parent_name] : [],
    children,
    group: "",
    sourceFile: decl.file,
    methods: arrays.methods,
    protectedMethods: arrays.protectedMethods,
    staticMethods: arrays.staticMethods,
    enums: [],
    properties: [],
    protectedProperties: [],
    docsUrl: "",
    origin: "pak",
    pakFile: decl.file,
    pakLine: decl.line,
    ...(decl.guards.length > 0 ? { guards: [...decl.guards] } : {}),
  };
}

// ── Backfill ─────────────────────────────────────────────────────────────────

export interface BackfillAddition {
  file: string;
  class: string;
  /** Absent for the class entry itself. */
  method?: string;
  arity?: number;
  array?: MethodArray;
  pakFile: string;
  pakLine: number;
  /** The declaration's preprocessor guards; absent when unguarded. */
  guards?: string[];
  reason: LossReason;
}

/** A pak entry present before a run that the run did not write again. */
export interface BackfillRemoval {
  file: string;
  class: string;
  /** Absent for a class entry. */
  method?: string;
  pakFile: string;
  pakLine: number;
}

/** A lost source method the backfill did not add, and the method it is an alternative of. */
export interface BackfillWithheld {
  file: string;
  class: string;
  method: string;
  arity: number;
  pakFile: string;
  pakLine: number;
  guards: string[];
  reason: WithholdReason;
  /** The same-named method of the opposite branch that the index holds, `file#Lline`. */
  alternativeOf: string;
}

export interface BackfillResult {
  /** Every class and method of the pak layer the run wrote, in the order written. */
  entries: BackfillAddition[];
  /** Of `entries`, those not present byte for byte before the run: new or changed. */
  added: BackfillAddition[];
  /** Pak entries present before the run that it did not write again (pruned). */
  removed: BackfillRemoval[];
  /** Lost methods not written (alternatives from the branch Doxygen did not read). */
  withheld: BackfillWithheld[];
  /** Per file, over the whole pak layer: methods by reason, classes, and methods withheld. */
  perFile: Record<
    string,
    { methods: number; classes: number; byReason: Record<string, number>; withheld: number }
  >;
}

const methodKey = (file: string, cls: string, array: string, m: MethodInfo): string => {
  const p = m as Partial<PakOrigin>;
  return `${file}|${cls}|${array}|${p.pakFile}|${p.pakLine}|${m.name}`;
};
const classKey = (file: string, cls: ClassInfo): string => {
  const p = cls as Partial<PakOrigin>;
  return `${file}|${p.pakFile}|${p.pakLine}|${cls.name}`;
};

interface PakSnapshot {
  methods: Map<string, string>;
  classes: Map<string, string>;
  removed: Map<string, BackfillRemoval>;
}

/**
 * Removes every entry marked `origin: "pak"` from `files` (classes, and
 * methods of the remaining classes) and returns them by key with their JSON,
 * so a run can tell what it added, changed or pruned.
 */
export function stripPakEntries(files: readonly ApiIndexFile[]): PakSnapshot {
  const snap: PakSnapshot = { methods: new Map(), classes: new Map(), removed: new Map() };
  for (const f of files) {
    const keep: ClassInfo[] = [];
    for (const cls of f.classes) {
      if (isPakEntry(cls)) {
        const k = classKey(f.file, cls);
        const p = cls as PakClassInfo;
        snap.classes.set(k, JSON.stringify(cls));
        snap.removed.set(`c|${k}`, {
          file: f.file,
          class: cls.name,
          pakFile: p.pakFile,
          pakLine: p.pakLine,
        });
        continue;
      }
      keep.push(cls);
      for (const array of ARRAYS) {
        const list = cls[array];
        if (!Array.isArray(list) || !list.some(isPakEntry)) continue;
        for (const m of list) {
          if (!isPakEntry(m)) continue;
          const k = methodKey(f.file, cls.name, array, m);
          const p = m as PakMethodInfo;
          snap.methods.set(k, JSON.stringify(m));
          snap.removed.set(`m|${k}`, {
            file: f.file,
            class: cls.name,
            method: m.name,
            pakFile: p.pakFile,
            pakLine: p.pakLine,
          });
        }
        cls[array] = list.filter((m) => !isPakEntry(m));
      }
    }
    if (keep.length !== f.classes.length) f.classes.splice(0, f.classes.length, ...keep);
  }
  return snap;
}

/**
 * Derives the pak layer: every expected source method the index lacks, and
 * every source class the index lacks with its expected methods, after
 * removing the layer an earlier run wrote. Extends `files` in place;
 * idempotent (a second run reports nothing added or removed and changes no
 * byte).
 */
export function backfillApiIndex(
  files: readonly ApiIndexFile[],
  index: SourceIndex,
): BackfillResult {
  const before = stripPakEntries(files);
  const result: BackfillResult = { entries: [], added: [], removed: [], withheld: [], perFile: {} };
  for (const f of files)
    result.perFile[f.file] = { methods: 0, classes: 0, byReason: {}, withheld: 0 };
  const record = (a: BackfillAddition, key: string, json: string): void => {
    const p = result.perFile[a.file];
    if (a.method === undefined) p.classes++;
    else {
      p.methods++;
      p.byReason[a.reason] = (p.byReason[a.reason] ?? 0) + 1;
    }
    result.entries.push(a);
    const prev = a.method === undefined ? before.classes.get(key) : before.methods.get(key);
    if (prev !== json) result.added.push(a);
    before.removed.delete(a.method === undefined ? `c|${key}` : `m|${key}`);
  };
  const guardsOf = (rec: { guards: string[] }): { guards?: string[] } =>
    rec.guards.length > 0 ? { guards: [...rec.guards] } : {};

  const indexed = indexByName(files, index);
  const fileFor = fileForModule(files, index, indexed);
  const missing: MergedClass[] = [];

  for (const cls of sourceClasses(index)) {
    const hit = indexed(cls.name);
    if (!hit) {
      missing.push(cls);
      continue;
    }
    const { lost, withheld } = lostMethods(cls, hit);
    const { file, cls: page } = hit.pages[0];
    for (const { s, of } of withheld) {
      result.perFile[file.file].withheld++;
      result.withheld.push({
        file: file.file,
        class: cls.name,
        method: s.rec.name,
        arity: s.rec.arity,
        pakFile: s.rec.file,
        pakLine: s.rec.line,
        guards: [...s.rec.guards],
        reason: "inactive-branch-alternative",
        alternativeOf: `${of.rec.file}#L${of.rec.line}`,
      });
    }
    for (const s of lost) {
      const array = arrayFor(s.rec);
      const entry = methodEntry(s.rec);
      (page[array] ??= []).push(entry);
      record(
        {
          file: file.file,
          class: cls.name,
          method: s.rec.name,
          arity: s.rec.arity,
          array,
          pakFile: s.rec.file,
          pakLine: s.rec.line,
          ...guardsOf(s.rec),
          reason: lossReason(s, index),
        },
        methodKey(file.file, page.name, array, entry),
        JSON.stringify(entry),
      );
    }
  }

  for (const cls of missing) {
    const decl = declOf(cls);
    const file = fileFor(decl.script_module);
    const expected = srcMethodsOf(cls).filter((s) => s.expected);
    const entry = classEntry(
      cls,
      file,
      index,
      expected.map((s) => s.rec),
    );
    insertClass(file.classes, entry);
    const reason: LossReason = "class-missing-from-index";
    record(
      {
        file: file.file,
        class: cls.name,
        pakFile: decl.file,
        pakLine: decl.line,
        ...guardsOf(decl),
        reason,
      },
      classKey(file.file, entry),
      JSON.stringify(entry),
    );
    for (const s of expected) {
      const array = arrayFor(s.rec);
      // A new class's methods are judged with the class: the method is
      // "added" when the class is.
      const p = result.perFile[file.file];
      p.methods++;
      p.byReason[reason] = (p.byReason[reason] ?? 0) + 1;
      const a: BackfillAddition = {
        file: file.file,
        class: cls.name,
        method: s.rec.name,
        arity: s.rec.arity,
        array,
        pakFile: s.rec.file,
        pakLine: s.rec.line,
        ...guardsOf(s.rec),
        reason,
      };
      result.entries.push(a);
      if (before.classes.get(classKey(file.file, entry)) !== JSON.stringify(entry))
        result.added.push(a);
    }
  }
  result.removed = [...before.removed.values()];
  return result;
}

// ── Per-class method-count check ─────────────────────────────────────────────

export interface MethodCountShortfall {
  class: string;
  /** Script module of the class's declaration. */
  script_module: string;
  /** Virtual pak path of the class's declaration. */
  pakFile: string;
  /** Expected source methods (not private, not in a modded class, not a withheld alternative). */
  expected: number;
  /** Of those, paired with an index entry. */
  indexed: number;
  /** `name/arity` of each expected method with no index entry. */
  missing: string[];
  /** True when the index has no page for the class at all. */
  classMissing: boolean;
}

/**
 * Per-class method-count check: every source class whose expected methods
 * the index does not all hold. Empty when the index is complete against the
 * source. Alternatives from the branch Doxygen did not read (see `withheld`
 * of `backfillApiIndex`) are not counted as expected.
 */
export function methodCountCheck(
  files: readonly ApiIndexFile[],
  index: SourceIndex,
): MethodCountShortfall[] {
  const indexed = indexByName(files, index);
  const out: MethodCountShortfall[] = [];
  for (const cls of sourceClasses(index)) {
    const decl = declOf(cls);
    const hit = indexed(cls.name);
    const losses: Losses = hit
      ? lostMethods(cls, hit)
      : { lost: srcMethodsOf(cls).filter((s) => s.expected), withheld: [] };
    if (hit && losses.lost.length === 0) continue;
    const expected = srcMethodsOf(cls).filter((s) => s.expected).length - losses.withheld.length;
    out.push({
      class: cls.name,
      script_module: decl.script_module,
      pakFile: decl.file,
      expected,
      indexed: expected - losses.lost.length,
      missing: losses.lost.map((s) => `${s.rec.name}/${s.rec.arity}`),
      classMissing: !hit,
    });
  }
  return out;
}

// ── Name correction ──────────────────────────────────────────────────────────

export interface NameCorrection {
  file: string;
  class: string;
  array: MethodArray;
  signature: string;
  before: string;
  after: string;
}

/**
 * Sets the `name` of every Doxygen entry to the identifier its own signature
 * declares (the token before the first `(`, `~Foo` for a destructor) when the
 * two differ. The old parser took the text of every link in the member row as
 * the name, so a linked parameter type or a linked constant in a default value
 * was glued on (`SetVariableValueBaseContainerContainerIdPathEntrystringstring`,
 * `BeginEntityActionstringstring.Empty`). An entry whose signature declares no
 * identifier (none in the committed files) is left alone, as are the entries
 * the source produced (their names are the source's). Changes nothing but
 * `name`; returns what changed.
 */
export function correctMethodNames(files: readonly ApiIndexFile[]): NameCorrection[] {
  const out: NameCorrection[] = [];
  for (const f of files)
    for (const cls of f.classes)
      for (const array of ARRAYS)
        for (const m of cls[array] ?? []) {
          if (!m || isPakEntry(m) || typeof m.signature !== "string") continue;
          const name = signatureName(m.signature);
          if (name === undefined || name === m.name) continue;
          out.push({
            file: f.file,
            class: cls.name,
            array,
            signature: m.signature,
            before: m.name,
            after: name,
          });
          m.name = name;
        }
  return out;
}

// ── Params correction ────────────────────────────────────────────────────────

export interface ParamsCorrection {
  file: string;
  class: string;
  signature: string;
  before: number;
  after: number;
}

/**
 * Rewrites the `params` array of every Doxygen entry whose array differs from
 * the one the depth-aware parser reads from the entry's signature (a generic's
 * comma split, or a default holding a call cut short). Entries the source
 * produced are left alone. Returns what changed.
 */
export function correctParamsArrays(files: readonly ApiIndexFile[]): ParamsCorrection[] {
  const out: ParamsCorrection[] = [];
  for (const f of files)
    for (const cls of f.classes)
      for (const array of ARRAYS)
        for (const m of cls[array] ?? []) {
          if ((m as Partial<PakOrigin>).origin === "pak" || typeof m.signature !== "string")
            continue;
          const params = parseParamsFromSignature(m.signature);
          if (JSON.stringify(params) === JSON.stringify(m.params)) continue;
          out.push({
            file: f.file,
            class: cls.name,
            signature: m.signature,
            before: Array.isArray(m.params) ? m.params.length : 0,
            after: params.length,
          });
          m.params = params;
        }
  return out;
}
