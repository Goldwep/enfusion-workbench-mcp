/**
 * Enforce linter (plan 5.4 step 1, Phase 1 item 3). Enforce Script cannot be
 * compiled offline and a wrong call in a Workbench-side handler costs a
 * Workbench restart, so every handler file is checked against the E02 source
 * index (DEC-018) before it is installed: no engine symbol is coded against
 * unless the index declares it (plan 3.3, the existence rule).
 *
 * Every call expression in every method body is classified at one of two
 * levels:
 *
 *   level 1, resolved   the receiver's type is known: a class name
 *                       (`Class.Method()`, `Class.Cast(x)`, `new Class()`), a
 *                       local, parameter or member declared with an explicit
 *                       type, `this` / `super` / an unqualified call (the
 *                       enclosing class), or the declared return type of the
 *                       previous call in a chain. The method must exist on
 *                       that class or an ancestor (parent chain followed,
 *                       modded declarations merged, typedefs followed) and the
 *                       argument count must fit (default values may be left
 *                       out, `out` parameters may not). A miss is a failure.
 *   level 2, unresolved anything else (an `auto` local, a generic argument
 *                       that cannot be bound, a class whose ancestor the index
 *                       does not hold): listed as an unresolved receiver with
 *                       the method name, never passed and never failed.
 *
 * A name-only match is never enough: a method declared on another class is a
 * failure at level 1 and a note at level 2.
 *
 * Also checked: every type named as a parent, in a declaration, in `new` or in
 * a generic argument exists; every `Enum.VALUE` exists; every `[Attr]`
 * annotation names a known class; every `RegV("key")` names a member variable
 * of the registering class. A resolved call or member also fails when it is
 * `private` / `protected` and used from outside the class (or its subclasses),
 * or when a static method uses an instance method, `this` or `super`; a plain
 * (not modded) declaration of a class name already declared fails. Request
 * and response keys are compared with `contracts/<Handler>.json` when such a
 * file is given. A file with a parse error (or an unbalanced bracket) fails
 * the run: what the error hides is not linted.
 *
 * The bodies are read with the E02 lexer (`lex`) and a small statement and
 * postfix-chain reader; declarations come from `parseEnforceSource`. This is
 * not a compiler: expressions are typed only as far as member access, calls,
 * indexing and `new`; operators yield no type (their calls stay unresolved).
 */
import { compareCodeUnits } from "./canon.js";
import {
  lex,
  parseEnforceSource,
  splitTopLevel,
  type ClassRecord,
  type EnumValueRecord,
  type FieldRecord,
  type MethodRecord,
  type ParsedFile,
  type TypedefRecord,
} from "./enforce-source.js";
import { nearSymbols, pakRef, type SourceIndex } from "./source-index.js";

type Lexed = ReturnType<typeof lex>;
type Tok = Lexed["toks"][number];

// ── Public report types ───────────────────────────────────────────────────────

/** What a level-1 failure is about. */
export type LintCheck =
  | "method"
  | "arity"
  | "static"
  | "access"
  | "function"
  | "class"
  | "enum-value"
  | "field"
  | "attribute"
  | "registration"
  | "deny"
  | "contract"
  | "out-param"
  | "reserved-name";

export interface LintFailure {
  file: string;
  line: number;
  check: LintCheck;
  /** The expression or declaration as written (whitespace collapsed). */
  expression: string;
  /** What does not resolve, in one sentence. */
  what: string;
  /** Nearest candidates from the index: `Owner.Name/arity | pak:<file>#L<line> | signature`. */
  candidates: string[];
  /** `#ifdef` guards around the line, outermost first, when there are any (the code may never be compiled). */
  guards?: string[];
}

export interface UnresolvedCall {
  file: string;
  line: number;
  /** The called method's name. */
  method: string;
  expression: string;
  /** Why the receiver's type is not known. */
  reason: string;
}

/** A level-1 call that resolved, with the declaration it resolved to (`--trace`). */
export interface ResolvedCall {
  line: number;
  method: string;
  expression: string;
  /** `Owner.Name/arity | pak:<file>#L<line> | signature` of the declaration that fits. */
  target: string;
}

export interface LintNote {
  file: string;
  line: number;
  message: string;
}

export interface FileCounts {
  /** Call expressions seen (static, member, unqualified, `new` with arguments). */
  calls: number;
  /** Calls that resolved at level 1. */
  resolved: number;
  /** Calls that failed at level 1. */
  failed_calls: number;
  /** Calls reported as unresolved receivers (level 2). */
  unresolved: number;
  /** Every level-1 failure (calls and declarations). */
  failures: number;
  /** Parse errors (E02 parser and unbalanced brackets): what they hide is not linted, so the file fails. */
  parse_errors: number;
}

export interface FileReport {
  file: string;
  failures: LintFailure[];
  unresolved: UnresolvedCall[];
  notes: LintNote[];
  counts: FileCounts;
  /**
   * Parse errors of the E02 parser for this file, and brackets in it that
   * have no partner. A file with one is reported and fails the run: the
   * engine would not compile it, and what the error hides is not linted.
   */
  parse_errors: { line: number; message: string }[];
  /** Every resolved call with its declaration; only with `trace`. */
  resolved?: ResolvedCall[];
}

export interface LintReport {
  /** Build of the source index used. */
  build: string;
  index_files: number;
  index_records: number;
  files: FileReport[];
  totals: FileCounts & { files: number; files_failed: number };
  /** Notes that concern the run, not one file (contracts skipped, for example). */
  notes: string[];
}

/** Request and response keys a contract file states, for the contract check. */
export interface HandlerContract {
  request?: string[];
  response?: string[];
}

export interface LintInput {
  /** Path as shown in the report (repo-relative, forward slashes). */
  path: string;
  text: string;
}

export interface LintOptions {
  /**
   * Contracts by handler class name. `undefined`: no contract directory was
   * given (the check is skipped with a run note). A handler missing from a
   * given map gets a per-file note.
   */
  contracts?: Map<string, HandlerContract>;
  /** Text of the contract directory for the notes (never a machine path in tests). */
  contractsLabel?: string;
  /** List every resolved call with the declaration it resolved to. */
  trace?: boolean;
}

// ── Types ─────────────────────────────────────────────────────────────────────

/** A type as written: base name, generic arguments, static-array flag. */
interface TypeRef {
  name: string;
  args: TypeRef[];
  array?: boolean;
}

/** Words that may precede a type and are not part of its name. */
const TYPE_WORDS = new Set([
  "ref",
  "autoptr",
  "owned",
  "const",
  "notnull",
  "static",
  "out",
  "inout",
]);
/** Types the engine knows without a script declaration. */
const BUILTIN_TYPES = new Set(["void", "auto", "null"]);
/** Preprocessor values the compiler substitutes (used in vanilla, declared nowhere). */
const BUILTIN_VALUES = new Map([
  ["__FILE__", "string"],
  ["__LINE__", "int"],
]);
/** Roots that do not descend from `Class` (value types and engine pointers). */
const NO_CLASS_ROOT = new Set([
  "Class",
  "string",
  "int",
  "float",
  "bool",
  "vector",
  "typename",
  "func",
  "pointer",
]);
/**
 * Engine classes a script-declared `out` / `inout` parameter may not take when
 * the source index gives them no declared ancestor (a parentless `sealed class
 * WorldEditorAPI` is read as Managed, which the engine class is not). A type
 * whose declared chain reaches `pointer` (IEntitySource > BaseContainer >
 * BaseResourceObject > global_pointer > pointer in 1.9.0.37) is refused by the
 * chain itself; one whose chain reaches Managed (IEntity, Resource) is a Class.
 */
const OUT_ENGINE_TYPES = new Set([
  "IEntitySource",
  "BaseContainer",
  "IEntityComponentSource",
  "BaseContainerList",
  "WorldEditorAPI",
  "WBModuleDef",
  "IEntity",
  "Resource",
]);
/** The Workbench 1.9.0.37 compile error an `out IEntitySource` parameter produced (W1 first live compile). */
export const OUT_ENGINE_PARAM_ERROR =
  "Types 'Class' and 'IEntitySource' are unrelated / Incompatible parameter 'src'";
/**
 * Identifiers the Workbench 1.9.0.37 Enforce compiler refused as a declared name: a method named
 * `Wait` and a local named `vanilla` failed the W2/W3 bundle compile (stamp d3f8717b, commit
 * 346841b). A method, field, local or parameter with one of these names fails the lint.
 */
export const RESERVED_NAMES: ReadonlyMap<string, string> = new Map([
  ["Wait", "a method named Wait failed the 1.9.0.37 compile (EMCP_WB_Resources, commit 346841b)"],
  [
    "vanilla",
    "a local named vanilla failed the 1.9.0.37 compile (EMCP_WB_Resources, commit 346841b)",
  ],
]);
/**
 * Enforce keywords and modifiers that are not proven reserved as a name: a declared name equal to
 * one (or to a RESERVED_NAMES entry in another case) is a note, never a failure.
 */
export const SUSPECT_NAMES: ReadonlySet<string> = new Set([
  "thread",
  "wait",
  "vanilla",
  "proto",
  "native",
  "volatile",
  "event",
  "sealed",
  "modded",
  "typename",
  "external",
  "owned",
  "autoptr",
  "inout",
  "notnull",
  "override",
  "func",
  "typedef",
  "private",
  "protected",
  "local",
  "reference",
]);
/** The failure or note text for a declared name, or undefined when the name is not listed. */
export function reservedNameIssue(name: string): { fail: boolean; why: string } | undefined {
  const hard = RESERVED_NAMES.get(name);
  if (hard !== undefined) return { fail: true, why: hard };
  // Enforce is case-sensitive and its keywords are lower case: `typeName` compiled on 1.9.0.37
  // (EMCP_WB_Validate, stamp d3f8717b), so only an exact keyword is suspect; a case variant is
  // suspect only for a name proven refused (`wait`, `Vanilla`).
  const lower = name.toLowerCase();
  if (SUSPECT_NAMES.has(name) || [...RESERVED_NAMES.keys()].some((k) => k.toLowerCase() === lower))
    return {
      fail: false,
      why: `'${name}' is an Enforce keyword or a case variant of a name the 1.9.0.37 compiler refused; not proven reserved: rename it to be safe`,
    };
  return undefined;
}
/** Words that never start a declaration or a value. */
const KEYWORDS = new Set([
  "return",
  "new",
  "delete",
  "if",
  "else",
  "while",
  "for",
  "foreach",
  "do",
  "switch",
  "case",
  "default",
  "break",
  "continue",
  "null",
  "NULL",
  "true",
  "false",
  "this",
  "super",
  "out",
  "inout",
  "thread",
  "goto",
  "class",
  "enum",
  "typedef",
  "ref",
  "autoptr",
  "owned",
  "const",
  "static",
  "notnull",
]);
/** Words that may open a local declaration (`const float x = 1;`, `ref array<int> a = {};`). */
const DECL_QUALIFIERS = new Set([
  "ref",
  "autoptr",
  "const",
  "static",
  "owned",
  "notnull",
  "private",
  "protected",
]);
/** Tokens after which a statement (and so a declaration) may start. */
const STATEMENT_START = new Set(["{", "}", ";", "(", ",", ")", ":"]);
/** Modifiers that may precede `class` / `enum` at item level. */
const ITEM_MODIFIERS = new Set(["modded", "sealed", "static", "external", "proto", "native"]);
/**
 * Functions the engine provides without a script declaration. A call to one is
 * reported as unresolved (level 2), never passed: `Sleep` is called
 * unqualified in ten vanilla files and declared in none (the `thread`
 * built-in).
 */
const INTRINSIC_FUNCTIONS = new Set(["Sleep"]);
/** Methods whose first string argument names a registered member (JsonApiStruct). */
const REGISTER_METHODS = new Set(["RegV"]);
/** JsonApiStruct methods whose first string argument is an output key. */
const STORE_METHODS = new Set([
  "StoreObject",
  "StoreFloat",
  "StoreInteger",
  "StoreBoolean",
  "StoreString",
  "StoreVector",
  "StartArray",
  "StartObject",
]);

/** Parses type text (`ref array<ref Foo>`, `float[4]`) into a TypeRef. */
function parseTypeText(text: string): TypeRef | undefined {
  let t = text.trim();
  let array = false;
  for (;;) {
    const m = /^(.*\S)\s*\[[^\]]*\]$/.exec(t);
    if (!m) break;
    array = true;
    t = m[1];
  }
  for (;;) {
    const m = /^(\w+)\s+(.+)$/.exec(t);
    if (!m || !TYPE_WORDS.has(m[1])) break;
    t = m[2];
  }
  const lt = t.indexOf("<");
  let ref: TypeRef;
  if (lt === -1) {
    if (!/^\w+$/.test(t)) return undefined;
    ref = { name: t, args: [] };
  } else {
    const gt = t.lastIndexOf(">");
    if (gt < lt) return undefined;
    const args = splitTopLevel(t.slice(lt + 1, gt))
      .map(parseTypeText)
      .filter((a): a is TypeRef => a !== undefined);
    ref = { name: t.slice(0, lt).trim(), args };
  }
  if (array) ref.array = true;
  return ref;
}

function typeText(t: TypeRef): string {
  const base = t.args.length ? `${t.name}<${t.args.map(typeText).join(",")}>` : t.name;
  return t.array ? `${base}[]` : base;
}

/** Generic parameter name of `Class T`. */
function genericName(g: string): string {
  const parts = g.trim().split(/\s+/);
  return parts[parts.length - 1];
}

function substitute(t: TypeRef, b: Map<string, TypeRef>): TypeRef {
  const bound = t.args.length === 0 ? b.get(t.name) : undefined;
  if (bound) return t.array ? { ...bound, array: true } : bound;
  const out: TypeRef = { name: t.name, args: t.args.map((a) => substitute(a, b)) };
  if (t.array) out.array = true;
  return out;
}

/**
 * True when a call with `argc` arguments fits the declaration. `labels` holds
 * the label of each argument in order (`""` for a positional one) when any is
 * named (`level: LogLevel.ERROR`): a named argument fills the parameter of
 * that name and the positional arguments after it continue from there, so a
 * default may be skipped.
 */
function fits(m: MethodRecord, argc: number, labels: readonly string[] = []): boolean {
  if (labels.length === 0) return argc >= m.required && (m.variadic === true || argc <= m.arity);
  const names = m.params.map((p) => p.name);
  const filled = new Set<number>();
  let pos = 0;
  for (const l of labels) {
    if (l !== "") {
      const at = names.indexOf(l);
      if (at === -1 || filled.has(at)) return false;
      filled.add(at);
      pos = at + 1;
    } else {
      if (pos >= m.arity && !m.variadic) return false;
      filled.add(pos++);
    }
  }
  return m.params.every((p, i) => p.default !== undefined || filled.has(i));
}

function arityText(m: MethodRecord): string {
  if (m.variadic) return `${m.required}+`;
  return m.required === m.arity ? `${m.arity}` : `${m.required}..${m.arity}`;
}

// ── The type world: the source index plus the files under check ──────────────

interface ClassView {
  name: string;
  parent?: TypeRef;
  parentText?: string;
  /** Generic parameter names (`T`). */
  generics: string[];
  methods: MethodRecord[];
  fields: FieldRecord[];
  declarations: ClassRecord[];
}

interface ChainEntry {
  view: ClassView;
  binding: Map<string, TypeRef>;
}

interface Chain {
  entries: ChainEntry[];
  /** True when the chain ends at a root class (no unknown ancestor). */
  complete: boolean;
  /** The first ancestor (or the type itself) the world does not hold. */
  missing?: string;
}

interface MethodHit {
  method: MethodRecord;
  entry: ChainEntry;
}

type MethodLookup =
  | { status: "ok"; hit: MethodHit; candidates: MethodHit[] }
  | { status: "arity"; candidates: MethodHit[] }
  | { status: "missing"; chain: Chain }
  | { status: "incomplete"; chain: Chain };

class World {
  private readonly localClasses = new Map<
    string,
    { decls: ClassRecord[]; methods: MethodRecord[]; fields: FieldRecord[] }
  >();
  private readonly localEnums = new Map<string, EnumValueRecord[]>();
  private readonly localEnumNames = new Set<string>();
  private readonly localEnumBases = new Map<string, string>();
  private readonly localTypedefs = new Map<string, TypedefRecord>();
  private readonly localFunctions = new Map<string, MethodRecord[]>();
  private readonly localVariables = new Map<string, FieldRecord>();
  private readonly viewCache = new Map<string, ClassView | null>();
  private methodOwners?: Map<string, string[]>;

  constructor(
    readonly index: SourceIndex,
    parsed: readonly ParsedFile[],
  ) {
    const lc = (name: string) => {
      let c = this.localClasses.get(name);
      if (!c) this.localClasses.set(name, (c = { decls: [], methods: [], fields: [] }));
      return c;
    };
    for (const p of parsed) {
      for (const r of p.records) {
        switch (r.kind) {
          case "class":
            lc(r.name).decls.push(r);
            break;
          case "method":
            if (r.owner !== undefined) lc(r.owner).methods.push(r);
            break;
          case "field":
            if (r.owner !== undefined) lc(r.owner).fields.push(r);
            break;
          case "function": {
            const l = this.localFunctions.get(r.name) ?? [];
            l.push(r);
            this.localFunctions.set(r.name, l);
            break;
          }
          case "variable":
            this.localVariables.set(r.name, r);
            break;
          case "enum":
            this.localEnumNames.add(r.name);
            if (r.base) this.localEnumBases.set(r.name, r.base);
            break;
          case "enum-value": {
            const l = this.localEnums.get(r.owner) ?? [];
            l.push(r);
            this.localEnums.set(r.owner, l);
            break;
          }
          case "typedef":
            this.localTypedefs.set(r.name, r);
            break;
        }
      }
    }
  }

  /** The class of that name (index and files under check merged); typedefs are not followed here. */
  classView(name: string): ClassView | undefined {
    const cached = this.viewCache.get(name);
    if (cached !== undefined) return cached ?? undefined;
    const ix = this.index.classes.get(name);
    const ixDecls = ix?.declarations ?? [];
    const loc = this.localClasses.get(name);
    const locDecls = loc?.decls ?? [];
    if (ixDecls.length === 0 && locDecls.length === 0) {
      this.viewCache.set(name, null);
      return undefined;
    }
    const decls = [...ixDecls, ...locDecls];
    const withParent =
      decls.find((d) => !d.modded && d.parent !== undefined) ??
      decls.find((d) => d.parent !== undefined);
    const generic = decls.find((d) => d.generics.length > 0);
    const view: ClassView = {
      name,
      generics: (generic?.generics ?? []).map(genericName),
      methods: [...(ix?.methods ?? []), ...(loc?.methods ?? [])],
      fields: [...(ix?.fields ?? []), ...(loc?.fields ?? [])],
      declarations: decls,
    };
    if (withParent?.parent) {
      view.parentText = withParent.parent;
      const pt = parseTypeText(withParent.parent);
      if (pt) view.parent = pt;
    }
    this.viewCache.set(name, view);
    return view;
  }

  typedef(name: string): TypedefRecord | undefined {
    return this.localTypedefs.get(name) ?? this.index.typedefs.get(name)?.[0];
  }

  isEnum(name: string): boolean {
    return this.localEnumNames.has(name) || this.index.enums.has(name);
  }

  /** Values of the enum and of the enums it extends (`enum ECharacterHitZoneGroup : EHitZoneGroup`). */
  enumValues(name: string): EnumValueRecord[] {
    const out: EnumValueRecord[] = [];
    const seen = new Set<string>();
    let cur: string | undefined = name;
    while (cur !== undefined && !seen.has(cur)) {
      seen.add(cur);
      out.push(...(this.index.enums.get(cur)?.values ?? []), ...(this.localEnums.get(cur) ?? []));
      const base: string | undefined =
        this.index.enums.get(cur)?.declarations.find((d) => d.base)?.base ??
        this.localEnumBases.get(cur);
      cur = base !== undefined && this.isEnum(base) ? base : undefined;
    }
    return out;
  }

  functions(name: string): MethodRecord[] {
    return [...(this.index.functions.get(name) ?? []), ...(this.localFunctions.get(name) ?? [])];
  }

  variable(name: string): FieldRecord | undefined {
    return this.localVariables.get(name) ?? this.index.variables.get(name)?.[0];
  }

  /** True when `name` is a class, enum, typedef or built-in type. */
  isType(name: string): boolean {
    return (
      BUILTIN_TYPES.has(name) ||
      this.classView(name) !== undefined ||
      this.isEnum(name) ||
      this.typedef(name) !== undefined
    );
  }

  /** Follows typedefs (`TStringArray` → `array<string>`); cycle-safe. */
  resolve(t: TypeRef): TypeRef {
    let cur = t;
    for (let k = 0; k < 16; k++) {
      if (this.classView(cur.name)) return cur;
      const td = this.typedef(cur.name);
      if (!td) return cur;
      const aliased = parseTypeText(td.type);
      if (!aliased || aliased.name === cur.name) return cur;
      cur = cur.array ? { ...aliased, array: true } : aliased;
    }
    return cur;
  }

  /** The class and its ancestors with generic bindings, nearest first; `Class` is the implicit root of script classes. */
  chain(t: TypeRef): Chain {
    const entries: ChainEntry[] = [];
    const seen = new Set<string>();
    let cur: TypeRef | undefined = this.resolve(t);
    let complete = true;
    let missing: string | undefined;
    while (cur) {
      const view = this.classView(cur.name);
      if (!view) {
        complete = false;
        missing = cur.name;
        break;
      }
      if (seen.has(view.name)) break;
      seen.add(view.name);
      const binding = new Map<string, TypeRef>();
      view.generics.forEach((g, i) => {
        const a = cur?.args[i];
        if (a) binding.set(g, a);
      });
      entries.push({ view, binding });
      cur = view.parent ? this.resolve(substitute(view.parent, binding)) : undefined;
    }
    const last = entries[entries.length - 1];
    // A script class without a parent is Managed (vanilla calls Managed.Clone() on such classes), and Managed is a Class.
    if (complete && last && !NO_CLASS_ROOT.has(last.view.name)) {
      for (const rootName of last.view.name === "Managed" ? ["Class"] : ["Managed", "Class"]) {
        const root = this.classView(rootName);
        if (root && !seen.has(rootName)) {
          seen.add(rootName);
          entries.push({ view: root, binding: new Map() });
        }
      }
    }
    const out: Chain = { entries, complete };
    if (missing !== undefined) out.missing = missing;
    return out;
  }

  /**
   * Why a script-declared `out` / `inout` parameter may not have type `t`, or
   * undefined when it may: the type's declared chain reaches `pointer` (not
   * Class), or the index declares no ancestor for it and it is a known engine
   * class (OUT_ENGINE_TYPES).
   */
  outParamBlocked(t: TypeRef): string | undefined {
    const r = this.resolve(t);
    const chain = this.chain(r);
    const names = chain.entries.map((e) => e.view.name);
    if (chain.complete && names.includes("pointer"))
      return `${r.name} is an engine pointer type, not a Class (chain ${names.join(" > ")})`;
    let top: string | undefined;
    for (const e of chain.entries) {
      if (!e.view.parent) {
        top = e.view.name;
        break;
      }
    }
    const derivesClass = chain.complete && (top === "Managed" || top === "Class");
    if (!derivesClass && OUT_ENGINE_TYPES.has(r.name))
      return `${r.name} is an engine class the source index gives no Class ancestor`;
    return undefined;
  }

  /** Methods named `name` on the chain of `t`, and whether one takes `argc` arguments. */
  findMethod(t: TypeRef, name: string, argc: number, named: readonly string[] = []): MethodLookup {
    const chain = this.chain(t);
    const candidates: MethodHit[] = [];
    for (const e of chain.entries)
      for (const m of e.view.methods) if (m.name === name) candidates.push({ method: m, entry: e });
    const hit = candidates.find((c) => fits(c.method, argc, named));
    if (hit) return { status: "ok", hit, candidates };
    if (candidates.length > 0 && chain.complete) return { status: "arity", candidates };
    if (!chain.complete) return { status: "incomplete", chain };
    return { status: "missing", chain };
  }

  findField(
    t: TypeRef,
    name: string,
  ): { field: FieldRecord; entry: ChainEntry } | "incomplete" | undefined {
    const chain = this.chain(t);
    for (const e of chain.entries)
      for (const f of e.view.fields) if (f.name === name) return { field: f, entry: e };
    return chain.complete && chain.entries.length > 0 ? undefined : "incomplete";
  }

  hasMethodNamed(t: TypeRef, name: string): boolean {
    return this.chain(t).entries.some((e) => e.view.methods.some((m) => m.name === name));
  }

  /** `Owner.Name/arity | pak ref | signature` of every class that declares a method of that name. */
  ownersOf(name: string): string[] {
    if (!this.methodOwners) {
      const map = new Map<string, string[]>();
      const add = (m: MethodRecord, local: boolean) => {
        if (m.owner === undefined) return;
        const l = map.get(m.name) ?? [];
        l.push(candidateText(m, local));
        map.set(m.name, l);
      };
      for (const r of this.index.records) if (r.kind === "method") add(r, false);
      for (const c of this.localClasses.values()) for (const m of c.methods) add(m, true);
      for (const l of map.values()) l.sort(compareCodeUnits);
      this.methodOwners = map;
    }
    return this.methodOwners.get(name) ?? [];
  }
}

function candidateText(m: MethodRecord, local = false): string {
  const where = local ? `${m.file}#L${m.line}` : pakRef(m);
  return `${m.owner ?? ""}${m.owner ? "." : ""}${m.name}/${arityText(m)} | ${where} | ${m.signature}`;
}

/** Edit distance, capped (enough to rank near names). */
function distance(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  if (Math.abs(x.length - y.length) > 3) return 99;
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++)
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[y.length];
}

/** Names on the list near `name`: same name ignoring case, a prefix of 3+ characters, or 2 edits. */
function nearNames(name: string, names: Iterable<string>, limit = 5): string[] {
  const lower = name.toLowerCase();
  const scored: [number, string][] = [];
  for (const n of new Set(names)) {
    if (n === name) continue;
    const nl = n.toLowerCase();
    let s: number;
    if (nl === lower) s = 0;
    else if (
      (nl.startsWith(lower) || lower.startsWith(nl)) &&
      Math.min(nl.length, lower.length) >= 3
    )
      s = 1;
    else {
      const d = distance(n, name);
      if (d > 2) continue;
      s = 1 + d;
    }
    scored.push([s, n]);
  }
  return scored
    .sort((a, b) => a[0] - b[0] || compareCodeUnits(a[1], b[1]))
    .slice(0, limit)
    .map((x) => x[1]);
}

// ── Body reader ───────────────────────────────────────────────────────────────

type Val =
  | { k: "type"; type: TypeRef }
  | { k: "enum"; name: string }
  /** `superCall` marks the value of `super` (its calls' arguments are not checked, see memberCall). */
  | { k: "value"; type: TypeRef; superCall?: boolean }
  /** `ident` is set when the value is an identifier nothing declares. */
  | { k: "unknown"; why: string; ident?: string };

const UNKNOWN_OPERATOR: Val = { k: "unknown", why: "the receiver is an operator expression" };

interface Body {
  owner?: string;
  method?: MethodRecord;
  nameTok: Tok;
  open: number;
  close: number;
}

/** Per-file collected facts for the registration and contract checks. */
interface Registration {
  owner: string;
  key: string;
  line: number;
}

class FileLinter {
  readonly toks: Tok[];
  readonly match: number[];
  readonly report: FileReport;
  readonly registrations: Registration[] = [];
  /** Guard stack of the first guarded token of each line. */
  private readonly lineGuards = new Map<number, readonly string[]>();
  /** Output keys written in OnPack: owner → keys. */
  readonly storeKeys = new Map<string, string[]>();
  /** Classes instantiated in a handler's GetRequest / GetResponse: handler → [request, response]. */
  readonly handlerTypes = new Map<string, { request?: string; response?: string }>();
  private scopes: Map<string, TypeRef | "auto">[] = [];
  private body!: Body;
  private ownerType?: TypeRef;
  private ownerGenerics = new Set<string>();

  constructor(
    readonly world: World,
    readonly file: string,
    readonly text: string,
    readonly parsed: ParsedFile,
    trace = false,
  ) {
    this.toks = lex(text).toks;
    const brackets = matchBrackets(this.toks);
    this.match = brackets.m;
    for (const t of this.toks)
      if (t.g.length > 0 && !this.lineGuards.has(t.line)) this.lineGuards.set(t.line, t.g);
    const parseErrors = parsed.errors.map((e) => ({ line: e.line, message: e.message }));
    // The E02 parser reads declarations; an unbalanced bracket inside a body is found here.
    for (const k of brackets.unmatched) {
      const t = this.toks[k];
      const opener = t.t === "(" || t.t === "[" || t.t === "{";
      parseErrors.push({
        line: t.line,
        message: opener ? `"${t.t}" is never closed` : `"${t.t}" closes nothing`,
      });
    }
    parseErrors.sort((x, y) => x.line - y.line || compareCodeUnits(x.message, y.message));
    this.report = {
      file,
      failures: [],
      unresolved: [],
      notes: [],
      counts: {
        calls: 0,
        resolved: 0,
        failed_calls: 0,
        unresolved: 0,
        failures: 0,
        parse_errors: parseErrors.length,
      },
      parse_errors: parseErrors,
    };
    if (trace) this.report.resolved = [];
  }

  private ok(line: number, method: string, expression: string, target: MethodRecord): void {
    this.report.counts.resolved++;
    this.report.resolved?.push({
      line,
      method,
      expression,
      target: candidateText(target, !target.file.startsWith("scripts/")),
    });
  }

  // ── reporting ──

  private exprText(a: number, b: number): string {
    if (b < a) return "";
    const raw = this.text.slice(this.toks[a].s, this.toks[b].e).replace(/\s+/g, " ").trim();
    return raw.length > 160 ? `${raw.slice(0, 157)}...` : raw;
  }

  fail(
    line: number,
    check: LintCheck,
    expression: string,
    what: string,
    candidates: string[] = [],
  ): void {
    const f: LintFailure = { file: this.file, line, check, expression, what, candidates };
    const g = this.lineGuards.get(line);
    if (g) f.guards = [...g];
    this.report.failures.push(f);
  }

  /**
   * Why the enclosing class may not use a `private` or `protected` member
   * declared on `declaring`, or undefined when it may: private is open to the
   * declaring class (and its modded declarations), protected also to the
   * classes derived from it.
   */
  private accessDenied(modifiers: readonly string[], declaring: string): string | undefined {
    const owner = this.body.owner;
    if (modifiers.includes("private")) {
      return owner === declaring
        ? undefined
        : `is private to ${declaring} and used from ${owner ?? "the global scope"}`;
    }
    if (modifiers.includes("protected")) {
      const inside =
        this.ownerType !== undefined &&
        this.world.chain(this.ownerType).entries.some((e) => e.view.name === declaring);
      return inside
        ? undefined
        : `is protected in ${declaring} and used from ${owner ?? "the global scope"}, which does not derive from it`;
    }
    return undefined;
  }

  /** True inside the body of a static method. */
  private inStatic(): boolean {
    return this.body.method?.modifiers.includes("static") === true;
  }

  private unresolved(line: number, method: string, expression: string, reason: string): void {
    this.report.unresolved.push({ file: this.file, line, method, expression, reason });
  }

  note(line: number, message: string): void {
    this.report.notes.push({ file: this.file, line, message });
  }

  /** The reserved-name rule on one declared name (RESERVED_NAMES fail, SUSPECT_NAMES note). */
  checkName(name: string | undefined, line: number, what: string, expression: string): void {
    if (!name) return;
    const issue = reservedNameIssue(name);
    if (!issue) return;
    if (issue.fail)
      this.fail(line, "reserved-name", expression, `${what} '${name}': ${issue.why}; rename it`);
    else this.note(line, `${what}: ${issue.why}`);
  }

  // ── declarations ──

  /** Checks that every type named in `t` exists; reports a failure per missing name. */
  checkType(
    t: TypeRef | undefined,
    line: number,
    expression: string,
    generics: ReadonlySet<string>,
  ): void {
    if (!t) return;
    // `static ref s_X = new X();` omits the type (the parser records `ref`); a keyword is no type name.
    if (DECL_QUALIFIERS.has(t.name) || KEYWORDS.has(t.name)) return;
    if (!generics.has(t.name) && !this.world.isType(t.name)) {
      const near = nearSymbols(this.world.index, t.name, 10)
        .filter((n) => !n.includes(".") && this.world.isType(n))
        .slice(0, 5);
      this.fail(
        line,
        "class",
        expression,
        `type ${t.name} is not declared in the source index or the files under check`,
        near,
      );
    }
    for (const a of t.args) this.checkType(a, line, expression, generics);
  }

  /** Declaration-level checks: parents, member, parameter and return types, attributes. */
  checkDeclarations(): void {
    const generics = new Map<string, Set<string>>();
    for (const r of this.parsed.records)
      if (r.kind === "class") generics.set(r.name, new Set(r.generics.map(genericName)));
    for (const r of this.parsed.records) {
      if ("attributes" in r) {
        for (const a of r.attributes) {
          if (!this.world.classView(a.name)) {
            const near = nearSymbols(this.world.index, a.name, 10)
              .filter((n) => !n.includes(".") && this.world.classView(n) !== undefined)
              .slice(0, 5);
            this.fail(
              a.line,
              "attribute",
              `[${a.name}${a.args !== undefined ? `(${a.args})` : ""}]`,
              `attribute class ${a.name} is not declared`,
              near,
            );
          }
        }
      }
      const g =
        "owner" in r && r.owner !== undefined
          ? (generics.get(r.owner) ?? new Set<string>())
          : new Set<string>();
      switch (r.kind) {
        case "class": {
          // A second plain declaration of a class name (the index's or another file's) is not a mod of it.
          const lowerPath = this.file.toLowerCase();
          const others = r.modded
            ? []
            : (this.world.classView(r.name)?.declarations ?? []).filter(
                (d) =>
                  d !== r &&
                  !d.modded &&
                  !(d.file !== r.file && lowerPath.endsWith(d.file.toLowerCase())),
              );
          if (others.length > 0)
            this.fail(
              r.line,
              "class",
              r.signature,
              `class ${r.name} is already declared (${others.length} other declaration(s)); a class that changes an existing one is declared modded`,
              others.map(
                (d) =>
                  `${d.name} | ${d.file.startsWith("scripts/") ? pakRef(d) : `${d.file}#L${d.line}`} | ${d.signature}`,
              ),
            );
          if (r.parent)
            this.checkType(
              parseTypeText(r.parent),
              r.line,
              r.signature,
              generics.get(r.name) ?? new Set(),
            );
          break;
        }
        case "field":
        case "variable":
          this.checkType(parseTypeText(r.type), r.line, r.signature, g);
          this.checkName(r.name, r.line, r.kind === "field" ? "member" : "variable", r.signature);
          break;
        case "method":
        case "function":
          if (r.return_type) this.checkType(parseTypeText(r.return_type), r.line, r.signature, g);
          this.checkName(r.name, r.line, r.kind, r.signature);
          for (const p of r.params) {
            this.checkName(p.name, r.line, "parameter", r.signature);
            const pt = parseTypeText(p.type);
            this.checkType(pt, r.line, r.signature, g);
            // A script-declared function cannot take an engine pointer type by out / inout.
            const byRef = p.modifiers.includes("out") || p.modifiers.includes("inout");
            if (!byRef || !r.has_body || !pt || g.has(pt.name)) continue;
            const why = this.world.outParamBlocked(pt);
            if (why === undefined) continue;
            const mod = p.modifiers.includes("inout") ? "inout" : "out";
            this.fail(
              r.line,
              "out-param",
              r.signature,
              `parameter ${p.name ?? "(unnamed)"} is ${mod} ${p.type}: ${why}; Workbench 1.9.0.37 refused this form ("${OUT_ENGINE_PARAM_ERROR}"); carry the value in a holder class (EMCP_WB_EntityRefResult, EMCP_WB_ContainerTarget)`,
            );
          }
          break;
        case "typedef":
          this.checkType(parseTypeText(r.type), r.line, r.signature, g);
          break;
      }
    }
  }

  // ── structure: find method bodies ──

  bodies(): Body[] {
    const out: Body[] = [];
    this.walkItems(0, this.toks.length - 2, undefined, out);
    return out;
  }

  private isOp(i: number, op: string): boolean {
    const t = this.toks[i];
    return t !== undefined && t.k === "op" && t.t === op;
  }

  private isId(i: number, w?: string): boolean {
    const t = this.toks[i];
    return t !== undefined && t.k === "id" && (w === undefined || t.t === w);
  }

  /** Skips to the `;` ending a statement (brackets balanced); returns the index after it. */
  private skipStatement(i: number, b: number): number {
    let j = i;
    while (j <= b) {
      const t = this.toks[j];
      if (t.k === "op" && (t.t === "(" || t.t === "[" || t.t === "{")) {
        j = this.match[j] + 1;
        continue;
      }
      if (t.k === "op" && t.t === ";") return j + 1;
      j++;
    }
    return j;
  }

  private walkItems(a: number, b: number, owner: string | undefined, out: Body[]): void {
    let i = a;
    while (i <= b) {
      const t = this.toks[i];
      if (t.k === "op" && t.t === "[") {
        i = this.match[i] + 1;
        continue;
      }
      if (t.k === "op" && t.t === ";") {
        i++;
        continue;
      }
      let k = i;
      while (this.isId(k) && ITEM_MODIFIERS.has(this.toks[k].t)) k++;
      if (this.isId(k, "class")) {
        const name = this.toks[k + 1]?.t;
        let j = k + 2;
        while (j <= b && !this.isOp(j, "{") && !this.isOp(j, ";")) j++;
        if (this.isOp(j, "{")) {
          this.walkItems(j + 1, this.match[j] - 1, name, out);
          i = this.match[j] + 1;
        } else i = j + 1;
        continue;
      }
      if (this.isId(k, "enum")) {
        let j = k + 1;
        while (j <= b && !this.isOp(j, "{")) j++;
        i = j <= b ? this.match[j] + 1 : j;
        continue;
      }
      if (this.isId(k, "typedef")) {
        i = this.skipStatement(k, b);
        continue;
      }
      // A member: up to its first top-level "(", "=", ";" or "{".
      let j = i;
      let done = false;
      while (j <= b && !done) {
        const u = this.toks[j];
        if (u.k === "op" && u.t === "(") {
          const nameIdx = j - 1;
          let k2 = this.match[j] + 1;
          while (this.isId(k2)) k2++;
          if (this.isOp(k2, "{") && this.isId(nameIdx)) {
            const nameTok = this.toks[nameIdx];
            const destructor = this.isOp(nameIdx - 1, "~");
            const want = destructor ? `~${nameTok.t}` : nameTok.t;
            const method = this.parsed.records.find(
              (r): r is MethodRecord =>
                (r.kind === "method" || r.kind === "function") &&
                r.name === want &&
                r.line === nameTok.line &&
                r.owner === owner,
            );
            const body: Body = { nameTok, open: k2, close: this.match[k2] };
            if (owner !== undefined) body.owner = owner;
            if (method) body.method = method;
            out.push(body);
            i = this.match[k2] + 1;
          } else i = this.skipStatement(k2, b);
          done = true;
        } else if (u.k === "op" && (u.t === "=" || u.t === ";")) {
          i = this.skipStatement(j, b);
          done = true;
        } else if (u.k === "op" && u.t === "{") {
          i = this.match[j] + 1;
          done = true;
        } else j++;
      }
      if (!done) i = j;
    }
  }

  // ── bodies ──

  lintBody(body: Body): void {
    this.body = body;
    this.ownerType = undefined;
    this.ownerGenerics = new Set();
    if (body.owner !== undefined) {
      const view = this.world.classView(body.owner);
      this.ownerGenerics = new Set(view?.generics ?? []);
      this.ownerType = {
        name: body.owner,
        args: (view?.generics ?? []).map((g) => ({ name: g, args: [] })),
      };
    }
    if (!body.method)
      this.note(
        body.nameTok.line,
        `body of ${body.nameTok.t} not matched to a parsed declaration; its parameters are unknown`,
      );
    const params = new Map<string, TypeRef | "auto">();
    for (const p of body.method?.params ?? []) {
      if (!p.name) continue;
      const t = parseTypeText(p.type);
      if (t) params.set(p.name, p.array ? { ...t, array: true } : t);
    }
    this.scopes = [params];
    this.analyze(body.open + 1, body.close - 1);
  }

  private lookupLocal(name: string): TypeRef | "auto" | undefined {
    for (let s = this.scopes.length - 1; s >= 0; s--) {
      const v = this.scopes[s].get(name);
      if (v !== undefined) return v;
    }
    return undefined;
  }

  private declare(name: string, t: TypeRef | "auto", line?: number): void {
    this.scopes[this.scopes.length - 1].set(name, t);
    if (line !== undefined) this.checkName(name, line, "local", name);
  }

  /**
   * Tries to read `Type name` at token i (qualifiers, generic arguments and
   * `[]` allowed). Returns the type and the index of the name token.
   */
  private tryDecl(i: number, a: number): { type: TypeRef | "auto"; nameIdx: number } | undefined {
    const prev = i > a ? this.toks[i - 1] : undefined;
    if (
      prev &&
      !(prev.k === "op" && STATEMENT_START.has(prev.t)) &&
      !(prev.k === "id" && (prev.t === "else" || prev.t === "do"))
    )
      return undefined;
    let j = i;
    while (this.isId(j) && DECL_QUALIFIERS.has(this.toks[j].t) && this.isId(j + 1)) j++;
    const baseIdx = j;
    const base = this.toks[j];
    if (!base || base.k !== "id" || (KEYWORDS.has(base.t) && base.t !== "auto")) return undefined;
    j++;
    if (this.isOp(j, "<")) {
      let depth = 0;
      for (;;) {
        const u = this.toks[j];
        if (!u) return undefined;
        if (u.k === "op" && u.t === "<") depth++;
        else if (u.k === "op" && u.t === ">") {
          depth--;
          if (depth === 0) {
            j++;
            break;
          }
        } else if (!(u.k === "id" || (u.k === "op" && u.t === ","))) return undefined;
        j++;
      }
    }
    let arrayType = false;
    while (this.isOp(j, "[") && this.isOp(j + 1, "]")) {
      arrayType = true;
      j += 2;
    }
    const nameTok = this.toks[j];
    if (!nameTok || nameTok.k !== "id" || KEYWORDS.has(nameTok.t)) return undefined;
    const after = this.toks[j + 1];
    if (!after) return undefined;
    // The engine accepts a declaration whose `;` is missing at the end of its line (`SCR_Task child` in vanilla).
    const lineEnd = after.line > nameTok.endLine && this.isId(j + 1);
    if (!lineEnd && (after.k !== "op" || !["=", ";", ",", "[", ":", "("].includes(after.t)))
      return undefined;
    // `Tuple1<T> ctx(value);` declares and constructs; only a known type opens that form.
    if (after.t === "(" && !this.world.isType(base.t) && !this.ownerGenerics.has(base.t))
      return undefined;
    if (base.t === "auto") return { type: "auto", nameIdx: j };
    const t = parseTypeText(this.text.slice(this.toks[baseIdx].s, this.toks[j - 1].e));
    if (!t) return undefined;
    if (arrayType) t.array = true;
    return { type: t, nameIdx: j };
  }

  /**
   * Walks tokens [a, b]: scopes, declarations, and every postfix chain (which
   * records the calls). Every step moves forward, malformed input included.
   */
  private analyze(a: number, b: number): void {
    const mergeBrace = new Set<number>();
    const popAt = new Map<number, number>();
    const forHeaderEnd = new Set<number>();
    // Closers of brace initializer lists (`array<string> x = {a, b};`).
    const initClose = new Set<number>();
    let parenDepth = 0;
    let declActive: { type: TypeRef | "auto"; depth: number } | undefined;
    let i = a;
    while (i <= b) {
      const t = this.toks[i];
      if (t.k === "op") {
        switch (t.t) {
          case "{": {
            // After `=`, `,`, `(` or another `{` a brace opens an initializer list, not a block:
            // it counts as a nesting level so its commas declare nothing (`{s1, s2, s2.Count()}`).
            const prev = i > a ? this.toks[i - 1] : undefined;
            if (prev?.k === "op" && ["=", ",", "(", "{"].includes(prev.t)) {
              initClose.add(this.match[i]);
              parenDepth++;
            }
            if (!mergeBrace.has(i)) this.scopes.push(new Map());
            i++;
            continue;
          }
          case "}":
            if (initClose.has(i)) parenDepth--;
            if (this.scopes.length > 1) this.scopes.pop();
            i++;
            continue;
          case ";": {
            declActive = undefined;
            const n = popAt.get(i) ?? 0;
            for (let k = 0; k < n; k++) if (this.scopes.length > 1) this.scopes.pop();
            i++;
            continue;
          }
          case "(": {
            const prev = this.toks[i - 1];
            if (i > a && prev.k === "id" && (prev.t === "for" || prev.t === "foreach")) {
              this.scopes.push(new Map());
              forHeaderEnd.add(this.match[i]);
              parenDepth++;
              i++;
              continue;
            }
            if (
              i > a &&
              prev.k === "id" &&
              (prev.t === "if" || prev.t === "while" || prev.t === "switch")
            ) {
              parenDepth++;
              i++;
              continue;
            }
            i = Math.max(i + 1, this.chain(i, b).next);
            continue;
          }
          case ")":
            parenDepth--;
            if (forHeaderEnd.has(i)) {
              if (this.isOp(i + 1, "{")) mergeBrace.add(i + 1);
              else {
                const end = this.skipStatement(i + 1, b) - 1;
                popAt.set(end, (popAt.get(end) ?? 0) + 1);
              }
            }
            i++;
            continue;
          case ",":
            if (
              declActive &&
              declActive.depth === parenDepth &&
              this.isId(i + 1) &&
              this.toks[i + 2]?.k === "op" &&
              ["=", ";", ",", "["].includes(this.toks[i + 2].t)
            ) {
              this.declare(this.toks[i + 1].t, declActive.type, this.toks[i + 1].line);
              i += 2;
              continue;
            }
            i++;
            continue;
          case ".":
            // Member access on something the reader did not type (an operator result).
            if (this.isId(i + 1)) {
              i = Math.max(i + 1, this.postfix(UNKNOWN_OPERATOR, i, b, i).next);
              continue;
            }
            i++;
            continue;
          default:
            i++;
            continue;
        }
      }
      // `level: LogLevel.ERROR`: a named argument's label is not an identifier to resolve.
      if (
        t.k === "id" &&
        this.isOp(i + 1, ":") &&
        !this.isOp(i + 2, ":") &&
        (this.isOp(i - 1, "(") || this.isOp(i - 1, ","))
      ) {
        i += 2;
        continue;
      }
      if (t.k === "id" && (!KEYWORDS.has(t.t) || DECL_QUALIFIERS.has(t.t))) {
        const d = this.tryDecl(i, a);
        if (d) {
          if (d.type !== "auto")
            this.checkType(d.type, t.line, this.exprText(i, d.nameIdx), this.ownerGenerics);
          let type = d.type;
          let next = d.nameIdx + 1;
          if (this.isOp(next, "[") && type !== "auto") {
            type = { ...type, array: true };
            next = this.match[next] + 1;
          }
          this.declare(this.toks[d.nameIdx].t, type, this.toks[d.nameIdx].line);
          declActive = { type: d.type, depth: parenDepth };
          if (this.isOp(next, "(") && type !== "auto") {
            const r = this.args(next);
            this.constructorCall(type, r, t.line, this.exprText(i, r.close), "");
            next = r.close + 1;
          }
          i = next;
          continue;
        }
      }
      if (
        (t.k === "id" &&
          (t.t === "this" || t.t === "super" || t.t === "new" || !KEYWORDS.has(t.t))) ||
        t.k === "str" ||
        t.k === "num"
      ) {
        i = Math.max(i + 1, this.chain(i, b).next);
        continue;
      }
      i++;
    }
  }

  /** Argument count of the call whose `(` is at `open`; analyzes the arguments. */
  private args(open: number): { argc: number; named: string[]; close: number; first?: string } {
    const close = this.match[open];
    if (close === open + 1) return { argc: 0, named: [], close };
    const starts = [open + 1];
    for (let k = open + 1; k < close; k++) {
      const t = this.toks[k];
      if (t.k === "op" && (t.t === "(" || t.t === "[" || t.t === "{")) {
        k = this.match[k];
        continue;
      }
      // `new Tuple2<int, string>(...)`: the commas of a generic argument list are not argument separators.
      if (t.k === "id" && t.t === "new" && this.isId(k + 1) && this.isOp(k + 2, "<")) {
        let depth = 0;
        for (k += 2; k < close; k++) {
          if (this.isOp(k, "<")) depth++;
          else if (this.isOp(k, ">") && --depth === 0) break;
        }
        continue;
      }
      if (t.k === "op" && t.t === ",") starts.push(k + 1);
    }
    // A trailing comma (`Vector(x, y, z, )`) opens no argument.
    if (starts.length > 1 && starts[starts.length - 1] === close) starts.pop();
    const argc = starts.length;
    // Argument labels in order (`""` for a positional argument); empty when none is named.
    const labels = starts.map((st) =>
      this.isId(st) && this.isOp(st + 1, ":") && !this.isOp(st + 2, ":") ? this.toks[st].t : "",
    );
    const named = labels.some((l) => l !== "") ? labels : [];
    const outer = this.scopes.length;
    this.analyze(open + 1, close - 1);
    while (this.scopes.length > outer) this.scopes.pop();
    const firstTok = this.toks[open + 1];
    const out: { argc: number; named: string[]; close: number; first?: string } = {
      argc,
      named,
      close,
    };
    if (firstTok.k === "str" && (this.isOp(open + 2, ",") || open + 2 === close))
      out.first = firstTok.t.slice(1, -1);
    return out;
  }

  /** Reads a postfix chain starting at a primary at `i`; returns the index after it and its value. */
  private chain(i: number, b: number): { next: number; val: Val } {
    const start = i;
    const t = this.toks[i];
    let val: Val;
    if (t.k === "str") {
      val = { k: "value", type: { name: "string", args: [] } };
      i++;
    } else if (t.k === "num") {
      val = {
        k: "value",
        type: { name: /[.eEfF]/.test(t.t) && !/^0[xX]/.test(t.t) ? "float" : "int", args: [] },
      };
      i++;
    } else if (t.k === "op" && t.t === "(") {
      const close = this.match[i];
      let inner: { next: number; val: Val } | undefined;
      const first = this.toks[i + 1];
      if (
        close > i + 1 &&
        (first.k === "id" || first.k === "str" || first.k === "num") &&
        !(first.k === "id" && KEYWORDS.has(first.t) && !["this", "super", "new"].includes(first.t))
      )
        inner = this.chain(i + 1, close - 1);
      if (inner && inner.next === close) val = inner.val;
      else {
        const outer = this.scopes.length;
        this.analyze(inner ? inner.next : i + 1, close - 1);
        while (this.scopes.length > outer) this.scopes.pop();
        val = UNKNOWN_OPERATOR;
      }
      i = close + 1;
    } else if (t.k === "id" && t.t === "new") {
      return this.newExpr(i, b);
    } else if (t.k === "id" && this.isOp(i + 1, "(")) {
      const r = this.unqualifiedCall(i);
      val = r.val;
      i = r.next;
    } else if (t.k === "id") {
      val = this.identifier(t);
      i++;
    } else {
      return { next: i + 1, val: UNKNOWN_OPERATOR };
    }
    return this.postfix(val, i, b, start);
  }

  private postfix(val: Val, i: number, b: number, start: number): { next: number; val: Val } {
    for (;;) {
      if (i > b) break;
      if (this.isOp(i, ".") && this.isId(i + 1)) {
        const nameTok = this.toks[i + 1];
        if (this.isOp(i + 2, "(")) {
          const r = this.memberCall(val, nameTok, i + 2, start);
          val = r.val;
          i = r.next;
        } else {
          val = this.memberAccess(val, nameTok, start, i + 1);
          i += 2;
        }
        continue;
      }
      if (this.isOp(i, "[")) {
        const close = this.match[i];
        const outer = this.scopes.length;
        this.analyze(i + 1, close - 1);
        while (this.scopes.length > outer) this.scopes.pop();
        val = this.indexType(val);
        i = close + 1;
        continue;
      }
      if (this.isOp(i, "(")) {
        // A call on a value (a func variable): nothing to check.
        const r = this.args(i);
        this.report.counts.calls++;
        this.report.counts.unresolved++;
        this.unresolved(
          this.toks[i].line,
          "(call)",
          this.exprText(start, r.close),
          "call through a value of type func or an expression",
        );
        val = { k: "unknown", why: "result of a call through a value" };
        i = r.close + 1;
        continue;
      }
      break;
    }
    return { next: i, val };
  }

  private valueOf(t: TypeRef | undefined, why: string): Val {
    if (!t) return { k: "unknown", why };
    if (t.name === "void") return { k: "unknown", why: "void result" };
    return { k: "value", type: t };
  }

  /** Return type of a resolved method, with the receiver's generic arguments substituted. */
  private returnOf(hit: MethodHit, receiver: Val, name: string): Val {
    if (name === "Cast" && hit.entry.view.name === "Class" && receiver.k === "type")
      return { k: "value", type: receiver.type };
    const rt = parseTypeText(hit.method.return_type);
    if (!rt) return { k: "unknown", why: `return type of ${hit.entry.view.name}.${name} not read` };
    const sub = substitute(rt, hit.entry.binding);
    if (hit.entry.view.generics.includes(sub.name) && sub.args.length === 0)
      return {
        k: "unknown",
        why: `return type ${sub.name} of ${hit.entry.view.name}.${name} is a generic parameter that is not bound`,
      };
    return this.valueOf(sub, `return type of ${name}`);
  }

  private identifier(t: Tok): Val {
    const name = t.t;
    if ((name === "this" || name === "super") && this.inStatic() && this.ownerType) {
      this.fail(
        t.line,
        "static",
        name,
        `${name} is used inside the static method ${this.body.owner}.${this.body.method?.name}, which has no instance`,
      );
      return { k: "unknown", why: `${name} in a static method` };
    }
    if (name === "this")
      return this.ownerType
        ? { k: "value", type: this.ownerType }
        : { k: "unknown", why: "this outside a class" };
    if (name === "super") {
      const owner = this.body.owner;
      // In a modded class, super is the class as declared before the mod.
      const modded = this.parsed.records.some(
        (r) => r.kind === "class" && r.name === owner && r.modded,
      );
      if (owner !== undefined && modded)
        return { k: "value", type: { name: owner, args: [] }, superCall: true };
      const view = owner !== undefined ? this.world.classView(owner) : undefined;
      return view?.parent
        ? { k: "value", type: view.parent, superCall: true }
        : { k: "unknown", why: "super without a parent class" };
    }
    if (name === "null" || name === "NULL") return { k: "unknown", why: "null" };
    if (name === "true" || name === "false")
      return { k: "value", type: { name: "bool", args: [] } };
    const builtin = BUILTIN_VALUES.get(name);
    if (builtin) return { k: "value", type: { name: builtin, args: [] } };
    const local = this.lookupLocal(name);
    if (local === "auto") return { k: "unknown", why: `auto-typed local ${name}` };
    if (local) return { k: "value", type: local };
    if (this.ownerType) {
      const f = this.world.findField(this.ownerType, name);
      if (f && f !== "incomplete") {
        const ft = parseTypeText(f.field.type);
        const sub = ft
          ? substitute(f.field.array && ft ? { ...ft, array: true } : ft, f.entry.binding)
          : undefined;
        return this.valueOf(sub, `type of member ${name} not read`);
      }
      if (this.world.hasMethodNamed(this.ownerType, name))
        return { k: "unknown", why: `method reference ${name}` };
    }
    if (this.ownerGenerics.has(name)) return { k: "unknown", why: `generic parameter ${name}` };
    if (this.world.classView(name) || this.world.typedef(name))
      return { k: "type", type: { name, args: [] } };
    if (this.world.isEnum(name)) return { k: "enum", name };
    const gv = this.world.variable(name);
    if (gv) return this.valueOf(parseTypeText(gv.type), `type of global ${name} not read`);
    if (this.world.functions(name).length > 0)
      return { k: "unknown", why: `function reference ${name}` };
    this.note(t.line, `unknown identifier ${name}`);
    return { k: "unknown", why: `unknown identifier ${name}`, ident: name };
  }

  private noteRegistration(
    name: string,
    first: string | undefined,
    line: number,
    receiverOwner: string | undefined,
  ): void {
    if (receiverOwner === undefined) return;
    if (REGISTER_METHODS.has(name)) {
      if (first === undefined) this.note(line, `${name} with a key that is not a string literal`);
      else this.registrations.push({ owner: receiverOwner, key: first, line });
    } else if (STORE_METHODS.has(name) && first !== undefined && first !== "") {
      const l = this.storeKeys.get(receiverOwner) ?? [];
      l.push(first);
      this.storeKeys.set(receiverOwner, l);
    }
  }

  private recordNewInHandler(type: string): void {
    const owner = this.body.owner;
    const m = this.body.method?.name;
    if (owner === undefined || (m !== "GetRequest" && m !== "GetResponse")) return;
    const h = this.handlerTypes.get(owner) ?? {};
    if (m === "GetRequest" && h.request === undefined) h.request = type;
    if (m === "GetResponse" && h.response === undefined) {
      const ch = this.world.chain({ name: type, args: [] });
      if (ch.entries.some((e) => e.view.name === "JsonApiStruct")) h.response = type;
    }
    this.handlerTypes.set(owner, h);
  }

  /**
   * Checks a construction (`new T(...)`, `T(...)`, `T name(...);`) against
   * the constructors T itself declares. A class without a declared
   * constructor takes no arguments as far as the index shows: with arguments
   * the call is unresolved.
   */
  private constructorCall(
    type: TypeRef,
    r: { argc: number; named: string[] },
    line: number,
    expr: string,
    form: string,
    counted = false,
  ): void {
    if (!counted) this.report.counts.calls++;
    const view = this.world.classView(this.world.resolve(type).name);
    if (!view) {
      // A missing class was reported by checkType; a generic parameter or a non-class type is not judged.
      if (!this.ownerGenerics.has(type.name) && !this.world.isType(type.name))
        this.report.counts.failed_calls++;
      else {
        this.report.counts.unresolved++;
        this.unresolved(
          line,
          type.name,
          expr,
          `${form}${type.name}, which is not a class the index declares (a generic parameter or a non-class type)`,
        );
      }
      return;
    }
    const ctors = view.methods.filter((m) => m.is_constructor && m.owner === view.name);
    const ctor = ctors.find((m) => fits(m, r.argc, r.named));
    if (ctor) this.ok(line, view.name, expr, ctor);
    else if (ctors.length === 0 && r.argc === 0) {
      this.report.counts.resolved++;
      this.report.resolved?.push({
        line,
        method: view.name,
        expression: expr,
        target: `${view.name} (no constructor declared)`,
      });
    } else if (ctors.length === 0) {
      this.report.counts.unresolved++;
      this.unresolved(
        line,
        view.name,
        expr,
        `${form}${view.name} with ${r.argc} arguments, and the index declares no constructor for it`,
      );
    } else {
      this.report.counts.failed_calls++;
      this.fail(
        line,
        "arity",
        expr,
        `no constructor of ${view.name} takes ${r.argc} arguments`,
        ctors.map((m) => candidateText(m, !m.file.startsWith("scripts/"))),
      );
    }
  }

  private newExpr(i: number, b: number): { next: number; val: Val } {
    const start = i;
    const nameTok = this.toks[i + 1];
    if (!nameTok || nameTok.k !== "id") return { next: i + 1, val: UNKNOWN_OPERATOR };
    let j = i + 2;
    if (this.isOp(j, "<")) {
      let depth = 0;
      while (j <= b) {
        if (this.isOp(j, "<")) depth++;
        else if (this.isOp(j, ">") && --depth === 0) {
          j++;
          break;
        }
        j++;
      }
    }
    const type = parseTypeText(this.text.slice(nameTok.s, this.toks[j - 1].e)) ?? {
      name: nameTok.t,
      args: [],
    };
    this.checkType(type, nameTok.line, this.exprText(start, j - 1), this.ownerGenerics);
    let next = j;
    if (this.isOp(j, "(")) {
      const r = this.args(j);
      next = r.close + 1;
      this.constructorCall(type, r, nameTok.line, this.exprText(start, r.close), "new ");
    }
    this.recordNewInHandler(type.name);
    return this.postfix({ k: "value", type }, next, b, start);
  }

  private unqualifiedCall(i: number): { next: number; val: Val } {
    const nameTok = this.toks[i];
    const name = nameTok.t;
    const r = this.args(i + 1);
    const expr = this.exprText(i, r.close);
    const line = nameTok.line;
    this.report.counts.calls++;
    const done = (val: Val) => ({ next: r.close + 1, val });
    const local = this.lookupLocal(name);
    if (local !== undefined) {
      this.report.counts.unresolved++;
      this.unresolved(line, name, expr, `call through the local ${name}`);
      return done({ k: "unknown", why: `call through ${name}` });
    }
    let methodLookup: MethodLookup | undefined;
    if (this.ownerType) {
      methodLookup = this.world.findMethod(this.ownerType, name, r.argc, r.named);
      if (methodLookup.status === "ok") {
        const hit = methodLookup.hit;
        const evidence = [candidateText(hit.method, !hit.method.file.startsWith("scripts/"))];
        if (this.inStatic() && !hit.method.modifiers.includes("static")) {
          this.report.counts.failed_calls++;
          this.fail(
            line,
            "static",
            expr,
            `${hit.entry.view.name}.${name} is not static and is called without an instance from the static method ${this.body.owner}.${this.body.method?.name}`,
            evidence,
          );
          return done(this.returnOf(hit, { k: "value", type: this.ownerType }, name));
        }
        const denied = this.accessDenied(hit.method.modifiers, hit.entry.view.name);
        if (denied) {
          this.report.counts.failed_calls++;
          this.fail(line, "access", expr, `${hit.entry.view.name}.${name} ${denied}`, evidence);
          return done(this.returnOf(hit, { k: "value", type: this.ownerType }, name));
        }
        this.ok(line, name, expr, methodLookup.hit.method);
        this.noteRegistration(name, r.first, line, this.body.owner);
        return done(this.returnOf(methodLookup.hit, { k: "value", type: this.ownerType }, name));
      }
    }
    // `ClassName(args)` without `new` constructs an instance (vanilla writes
    // `{ ContainerIdPathEntry("m_x") }` and `return ExportResult(...)`).
    const ctorClass = this.world.classView(this.world.resolve({ name, args: [] }).name);
    if (
      ctorClass &&
      (!methodLookup || methodLookup.status === "missing" || methodLookup.status === "incomplete")
    ) {
      this.constructorCall({ name, args: [] }, r, line, expr, "", true);
      return done({ k: "value", type: { name, args: [] } });
    }
    const fns = this.world.functions(name);
    if (fns.length === 0 && INTRINSIC_FUNCTIONS.has(name)) {
      this.report.counts.unresolved++;
      this.unresolved(
        line,
        name,
        expr,
        `${name} is an engine intrinsic with no script declaration`,
      );
      return done({ k: "unknown", why: `result of the intrinsic ${name}` });
    }
    const fn = fns.find((f) => fits(f, r.argc, r.named));
    if (fn) {
      this.ok(line, name, expr, fn);
      return done(this.valueOf(parseTypeText(fn.return_type), `return type of ${name}`));
    }
    if (
      methodLookup?.status === "arity" ||
      (fns.length > 0 && (!methodLookup || methodLookup.status === "missing"))
    ) {
      const cands = [
        ...(methodLookup?.status === "arity"
          ? methodLookup.candidates.map((c) =>
              candidateText(c.method, !c.method.file.startsWith("scripts/")),
            )
          : []),
        ...fns.map((f) => candidateText(f, !f.file.startsWith("scripts/"))),
      ];
      this.report.counts.failed_calls++;
      this.fail(
        line,
        "arity",
        expr,
        `${name} is called with ${r.argc} arguments; no declaration of it on ${this.body.owner ?? "the global scope"} takes that many`,
        cands,
      );
      return done({ k: "unknown", why: `arity mismatch on ${name}` });
    }
    if (methodLookup?.status === "incomplete") {
      this.report.counts.unresolved++;
      this.unresolved(
        line,
        name,
        expr,
        `enclosing class ${this.body.owner} has an ancestor the index does not hold (${methodLookup.chain.missing})`,
      );
      return done({ k: "unknown", why: "incomplete chain" });
    }
    this.report.counts.failed_calls++;
    const chainNames = this.ownerType
      ? this.world.chain(this.ownerType).entries.flatMap((e) => e.view.methods.map((m) => m.name))
      : [];
    const near = nearNames(name, [...chainNames, ...this.world.index.functions.keys()]);
    this.fail(
      line,
      "function",
      expr,
      `no method ${name} on ${this.body.owner ?? "(global scope)"} or its ancestors, and no global function ${name}`,
      [...near.map((n) => `near: ${n}`), ...this.world.ownersOf(name).slice(0, 6)],
    );
    return done({ k: "unknown", why: `unknown function ${name}` });
  }

  private memberCall(
    val: Val,
    nameTok: Tok,
    open: number,
    start: number,
  ): { next: number; val: Val } {
    const name = nameTok.t;
    const r = this.args(open);
    const expr = this.exprText(start, r.close);
    const line = nameTok.line;
    this.report.counts.calls++;
    const done = (v: Val) => ({ next: r.close + 1, val: v });
    if (val.k === "unknown" && val.ident !== undefined && name === "Cast") {
      // `X.Cast(y)` names a class: when nothing declares X, the class does not exist.
      this.report.counts.failed_calls++;
      const near = nearSymbols(this.world.index, val.ident, 10)
        .filter((n) => !n.includes(".") && this.world.isType(n))
        .slice(0, 5);
      this.fail(
        line,
        "class",
        expr,
        `${val.ident}.Cast: class ${val.ident} is not declared in the source index or the files under check`,
        near,
      );
      return done({ k: "unknown", why: `cast to the unknown class ${val.ident}` });
    }
    if (val.k === "unknown") {
      this.report.counts.unresolved++;
      this.unresolved(line, name, expr, val.why);
      return done({ k: "unknown", why: `result of ${name} on an unresolved receiver` });
    }
    if (val.k === "enum") {
      this.report.counts.unresolved++;
      this.unresolved(line, name, expr, `call on the enum name ${val.name}`);
      return done({ k: "unknown", why: "call on an enum" });
    }
    const receiver = val.type;
    const resolved = this.world.resolve(receiver);
    if (val.k === "value" && resolved.array) {
      // A static array (`T arr[4]`) is not its element: the index declares no class for it.
      this.report.counts.unresolved++;
      this.unresolved(line, name, expr, `call on the static array ${typeText(receiver)}`);
      return done({ k: "unknown", why: `result of ${name} on a static array` });
    }
    const lookup = this.world.findMethod(receiver, name, r.argc, r.named);
    if (val.k === "value" && val.superCall && lookup.status === "arity") {
      // Vanilla ships super calls whose arguments match no declaration (`super.OnOpen(owner)` inside
      // `OnOpen()`, `super.InitDynamicDescription(attribute)` for a two-parameter method) and compiles,
      // so for super only the method's existence on the parent chain is checked.
      const hit = lookup.candidates[0];
      this.report.counts.resolved++;
      this.report.resolved?.push({
        line,
        method: name,
        expression: expr,
        target: `${candidateText(hit.method, !hit.method.file.startsWith("scripts/"))} (super call: arguments not checked)`,
      });
      return done(this.returnOf(hit, val, name));
    }
    const recvText = val.k === "type" ? receiver.name : typeText(receiver);
    if (lookup.status === "ok" && val.k === "type") {
      // Through the class name a static declaration that fits wins over an instance one of the same arity.
      const st = lookup.candidates.find(
        (c) => c.method.modifiers.includes("static") && fits(c.method, r.argc, r.named),
      );
      if (st) lookup.hit = st;
    }
    if (lookup.status === "ok") {
      if (val.k === "type" && !lookup.hit.method.modifiers.includes("static")) {
        // An instance method through the class name: allowed only from inside that class's hierarchy.
        const inside =
          this.ownerType !== undefined &&
          this.world.chain(this.ownerType).entries.some((e) => e.view.name === resolved.name);
        if (!inside) {
          this.report.counts.failed_calls++;
          this.fail(
            line,
            "static",
            expr,
            `${lookup.hit.entry.view.name}.${name} is not static and is called through the class name ${receiver.name}`,
            [candidateText(lookup.hit.method, !lookup.hit.method.file.startsWith("scripts/"))],
          );
          return done(this.returnOf(lookup.hit, val, name));
        }
      }
      const denied = this.accessDenied(lookup.hit.method.modifiers, lookup.hit.entry.view.name);
      if (denied) {
        this.report.counts.failed_calls++;
        this.fail(line, "access", expr, `${lookup.hit.entry.view.name}.${name} ${denied}`, [
          candidateText(lookup.hit.method, !lookup.hit.method.file.startsWith("scripts/")),
        ]);
        return done(this.returnOf(lookup.hit, val, name));
      }
      this.ok(line, name, expr, lookup.hit.method);
      if (val.k === "value" && this.ownerType && resolved.name === this.ownerType.name)
        this.noteRegistration(name, r.first, line, this.body.owner);
      else if (val.k === "value") this.noteRegistration(name, r.first, line, resolved.name);
      return done(this.returnOf(lookup.hit, val, name));
    }
    if (lookup.status === "incomplete") {
      this.report.counts.unresolved++;
      this.unresolved(
        line,
        name,
        expr,
        lookup.chain.entries.length === 0
          ? `receiver type ${resolved.name} is not in the source index`
          : `${recvText} has an ancestor the index does not hold (${lookup.chain.missing})`,
      );
      return done({ k: "unknown", why: "incomplete chain" });
    }
    this.report.counts.failed_calls++;
    if (lookup.status === "arity") {
      this.fail(
        line,
        "arity",
        expr,
        `${recvText}.${name} is called with ${r.argc} arguments; its declarations take ${[...new Set(lookup.candidates.map((c) => arityText(c.method)))].join(" or ")}`,
        lookup.candidates.map((c) =>
          candidateText(c.method, !c.method.file.startsWith("scripts/")),
        ),
      );
      return done({ k: "unknown", why: `arity mismatch on ${name}` });
    }
    const chainNames = lookup.chain.entries.flatMap((e) => e.view.methods.map((m) => m.name));
    const elsewhere = this.world.ownersOf(name);
    this.fail(
      line,
      "method",
      expr,
      `${recvText} (chain ${lookup.chain.entries.map((e) => e.view.name).join(" > ")}) has no method ${name}` +
        (elsewhere.length
          ? `; it is declared on ${new Set(elsewhere.map((e) => e.split(".")[0])).size} other class(es)`
          : ""),
      [
        ...nearNames(name, chainNames).map((n) => `near on ${resolved.name}: ${n}`),
        ...elsewhere.slice(0, 6),
      ],
    );
    return done({ k: "unknown", why: `unknown method ${name}` });
  }

  private memberAccess(val: Val, nameTok: Tok, start: number, end: number): Val {
    const name = nameTok.t;
    const expr = this.exprText(start, end);
    if (val.k === "unknown")
      return { k: "unknown", why: `member ${name} of an unresolved receiver` };
    if (val.k === "enum") {
      const values = this.world.enumValues(val.name);
      if (values.some((v) => v.name === name))
        return { k: "value", type: { name: val.name, args: [] } };
      this.fail(
        nameTok.line,
        "enum-value",
        expr,
        `enum ${val.name} has no value ${name}`,
        nearNames(
          name,
          values.map((v) => v.name),
        ).map((n) => `${val.name}.${n}`),
      );
      return { k: "unknown", why: `unknown enum value ${name}` };
    }
    if (val.k === "value" && this.world.resolve(val.type).array)
      return { k: "unknown", why: `member ${name} of a static array` };
    const f = this.world.findField(val.type, name);
    if (f === "incomplete")
      return { k: "unknown", why: `member ${name} of a type with an unknown ancestor` };
    if (f) {
      const denied = this.accessDenied(f.field.modifiers, f.entry.view.name);
      if (denied) this.fail(nameTok.line, "access", expr, `${f.entry.view.name}.${name} ${denied}`);
      const ft = parseTypeText(f.field.type);
      const sub = ft
        ? substitute(f.field.array ? { ...ft, array: true } : ft, f.entry.binding)
        : undefined;
      return this.valueOf(sub, `type of member ${name} not read`);
    }
    if (this.world.hasMethodNamed(val.type, name))
      return { k: "unknown", why: `method reference ${name}` };
    const chain = this.world.chain(val.type);
    const fields = chain.entries.flatMap((e) => e.view.fields.map((x) => x.name));
    this.fail(
      nameTok.line,
      "field",
      expr,
      `${val.k === "type" ? val.type.name : typeText(val.type)} (chain ${chain.entries.map((e) => e.view.name).join(" > ")}) has no member ${name}`,
      nearNames(name, fields).map((n) => `near: ${n}`),
    );
    return { k: "unknown", why: `unknown member ${name}` };
  }

  private indexType(val: Val): Val {
    if (val.k !== "value") return { k: "unknown", why: "index into an unresolved value" };
    if (val.type.array) {
      const el: TypeRef = { name: val.type.name, args: val.type.args };
      return { k: "value", type: el };
    }
    const t = this.world.resolve(val.type);
    if ((t.name === "array" || t.name === "set") && t.args[0])
      return { k: "value", type: t.args[0] };
    if (t.name === "map" && t.args[1]) return { k: "value", type: t.args[1] };
    if (t.name === "string") return { k: "value", type: { name: "string", args: [] } };
    if (t.name === "vector") return { k: "value", type: { name: "float", args: [] } };
    return { k: "unknown", why: `element type of ${typeText(t)}` };
  }
}

/**
 * Index of the matching bracket for every `(`, `[`, `{` and its closer, and
 * the brackets that have no partner. Every opener gets an index at or after
 * itself, so a walk that resumes after `m[open]` always moves forward: an
 * opener left open inside an outer pair ends just before the outer closer, one
 * still open at the end of the file ends at the last token. An unmatched
 * closer keeps -1 (no walk reads the match of a closer).
 */
function matchBrackets(toks: readonly Tok[]): { m: number[]; unmatched: number[] } {
  const m = new Array<number>(toks.length).fill(-1);
  const unmatched: number[] = [];
  const stack: number[] = [];
  const pairs: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.k !== "op") continue;
    if (pairs[t.t]) stack.push(i);
    else if (t.t === ")" || t.t === "]" || t.t === "}") {
      // Pop to the nearest opener of the same kind (an unbalanced file still gets matches).
      let found = false;
      for (let s = stack.length - 1; s >= 0; s--) {
        if (pairs[toks[stack[s]].t] === t.t) {
          m[stack[s]] = i;
          m[i] = stack[s];
          for (const inner of stack.slice(s + 1)) {
            m[inner] = i - 1;
            unmatched.push(inner);
          }
          stack.length = s;
          found = true;
          break;
        }
      }
      if (!found) unmatched.push(i);
    }
  }
  for (const s of stack) {
    m[s] = toks.length - 1;
    unmatched.push(s);
  }
  unmatched.sort((a, b) => a - b);
  return { m, unmatched };
}

// ── Registration and contract checks ─────────────────────────────────────────

function checkRegistrations(fl: FileLinter, world: World): void {
  const byOwner = new Map<string, Registration[]>();
  for (const r of fl.registrations) {
    const l = byOwner.get(r.owner) ?? [];
    l.push(r);
    byOwner.set(r.owner, l);
  }
  for (const [owner, regs] of byOwner) {
    const seen = new Map<string, number>();
    for (const r of regs) {
      const f = world.findField({ name: owner, args: [] }, r.key);
      if (f === undefined) {
        const view = world.classView(owner);
        fl.fail(
          r.line,
          "registration",
          `RegV("${r.key}")`,
          `${owner} registers "${r.key}" but declares no member variable of that name`,
          nearNames(r.key, view?.fields.map((x) => x.name) ?? []).map((n) => `near: ${n}`),
        );
      }
      const before = seen.get(r.key);
      if (before !== undefined)
        fl.note(r.line, `${owner} registers "${r.key}" twice (first on line ${before})`);
      else seen.set(r.key, r.line);
    }
  }
  // Request / response classes declared in this file whose members are never registered.
  for (const r of fl.parsed.records) {
    if (r.kind !== "class" || r.modded) continue;
    const chain = world.chain({ name: r.name, args: [] });
    if (!chain.entries.some((e) => e.view.name === "JsonApiStruct")) continue;
    // A class with OnPack writes its own keys; only classes without one are noted.
    if (
      fl.parsed.records.some(
        (m) => m.kind === "method" && m.owner === r.name && m.name === "OnPack",
      )
    )
      continue;
    const registered = new Set((byOwner.get(r.name) ?? []).map((x) => x.key));
    for (const f of fl.parsed.records) {
      if (f.kind !== "field" || f.owner !== r.name || f.modifiers.includes("static")) continue;
      if (registered.has(f.name)) continue;
      fl.note(
        f.line,
        `${r.name}.${f.name} is declared but never registered with RegV (not serialised unless written in OnPack)`,
      );
    }
  }
}

/** Request and response keys a handler class reads and writes, as far as this file shows. */
export interface HandlerKeys {
  handler: string;
  request?: string;
  response?: string;
  request_keys: string[];
  response_keys: string[];
}

function handlerKeys(fl: FileLinter): HandlerKeys[] {
  const out: HandlerKeys[] = [];
  const reg = (owner: string | undefined) =>
    owner === undefined
      ? []
      : [...new Set(fl.registrations.filter((r) => r.owner === owner).map((r) => r.key))];
  for (const [handler, h] of [...fl.handlerTypes].sort((a, b) => compareCodeUnits(a[0], b[0]))) {
    const k: HandlerKeys = {
      handler,
      request_keys: reg(h.request).sort(compareCodeUnits),
      response_keys: [
        ...new Set([
          ...reg(h.response),
          ...(h.response ? (fl.storeKeys.get(h.response) ?? []) : []),
        ]),
      ].sort(compareCodeUnits),
    };
    if (h.request !== undefined) k.request = h.request;
    if (h.response !== undefined) k.response = h.response;
    out.push(k);
  }
  return out;
}

function checkContracts(fl: FileLinter, keys: HandlerKeys[], opts: LintOptions): void {
  if (!opts.contracts) return;
  for (const k of keys) {
    const c = opts.contracts.get(k.handler);
    const line =
      fl.parsed.records.find((r) => r.kind === "class" && r.name === k.handler)?.line ?? 1;
    if (!c) {
      fl.note(
        line,
        `no contract file for ${k.handler} in ${opts.contractsLabel ?? "the contracts directory"}; its keys were not checked`,
      );
      continue;
    }
    const cmp = (side: "request" | "response", have: string[], want: string[] | undefined) => {
      if (!want) return;
      const missing = want.filter((x) => !have.includes(x));
      const extra = have.filter((x) => !want.includes(x));
      for (const m of missing)
        fl.fail(
          line,
          "contract",
          `${k.handler} ${side}`,
          `the contract lists ${side} key "${m}", which ${k.handler} does not ${side === "request" ? "register" : "register or write"}`,
        );
      for (const e of extra)
        fl.fail(
          line,
          "contract",
          `${k.handler} ${side}`,
          `${k.handler} ${side === "request" ? "registers" : "writes"} ${side} key "${e}", which the contract does not list`,
        );
    };
    cmp("request", k.request_keys, c.request);
    cmp("response", k.response_keys, c.response);
  }
}

// ── Entry ─────────────────────────────────────────────────────────────────────

function sortReport(r: FileReport): void {
  const cmp =
    <T extends { line: number }>(key: (x: T) => string) =>
    (a: T, b: T) =>
      a.line - b.line || compareCodeUnits(key(a), key(b));
  r.failures.sort(cmp((x) => `${x.check}\u0000${x.expression}\u0000${x.what}`));
  r.unresolved.sort(cmp((x) => `${x.method}\u0000${x.expression}\u0000${x.reason}`));
  r.notes.sort(cmp((x) => x.message));
  // One note per distinct message and line.
  r.notes = r.notes.filter(
    (n, i, a) => i === 0 || a[i - 1].line !== n.line || a[i - 1].message !== n.message,
  );
}

/**
 * Lints Enforce source files against a source index. Deterministic: files in
 * the order given, findings by line. Never throws for malformed source.
 */
export function lintEnforceFiles(
  index: SourceIndex,
  inputs: readonly LintInput[],
  opts: LintOptions = {},
): LintReport {
  const parsed = inputs.map((f) => parseEnforceSource(f.path, f.text));
  const world = new World(index, parsed);
  const files: FileReport[] = [];
  const notes: string[] = [];
  if (!opts.contracts)
    notes.push(
      "contracts: no contracts directory given; request and response keys were not checked against contract files (plan 5.4)",
    );
  inputs.forEach((f, n) => {
    const fl = new FileLinter(world, f.path, f.text, parsed[n], opts.trace === true);
    fl.checkDeclarations();
    for (const body of fl.bodies()) fl.lintBody(body);
    checkRegistrations(fl, world);
    checkContracts(fl, handlerKeys(fl), opts);
    fl.report.counts.failures = fl.report.failures.length;
    sortReport(fl.report);
    files.push(fl.report);
  });
  const totals = {
    files: files.length,
    files_failed: files.filter((f) => f.failures.length > 0 || f.parse_errors.length > 0).length,
    calls: 0,
    resolved: 0,
    failed_calls: 0,
    unresolved: 0,
    failures: 0,
    parse_errors: 0,
  };
  for (const f of files) {
    totals.calls += f.counts.calls;
    totals.resolved += f.counts.resolved;
    totals.failed_calls += f.counts.failed_calls;
    totals.unresolved += f.counts.unresolved;
    totals.failures += f.counts.failures;
    totals.parse_errors += f.counts.parse_errors;
  }
  return {
    build: index.header.build,
    index_files: index.header.file_count,
    index_records: index.header.record_count,
    files,
    totals,
    notes,
  };
}

/** Request and response keys of every handler in the files (for contract authors). */
export function handlerKeysOf(index: SourceIndex, inputs: readonly LintInput[]): HandlerKeys[] {
  const parsed = inputs.map((f) => parseEnforceSource(f.path, f.text));
  const world = new World(index, parsed);
  const out: HandlerKeys[] = [];
  inputs.forEach((f, n) => {
    const fl = new FileLinter(world, f.path, f.text, parsed[n]);
    for (const body of fl.bodies()) fl.lintBody(body);
    out.push(...handlerKeys(fl));
  });
  return out;
}

/** True when the run passes: no level-1 failure and no file that failed to parse. */
export function lintPassed(r: LintReport): boolean {
  return r.totals.failures === 0 && r.totals.parse_errors === 0;
}

/** Text form of a report. */
export function formatLintReport(r: LintReport): string {
  const out: string[] = [
    `enforce-lint: ${r.totals.files} file(s) against the E02 source index of build ${r.build} (${r.index_files} files, ${r.index_records} records)`,
  ];
  for (const n of r.notes) out.push(`note: ${n}`);
  for (const f of r.files) {
    const c = f.counts;
    out.push("");
    out.push(
      `${f.file}: ${c.failures} failure(s), ${c.unresolved} unresolved receiver(s); calls ${c.calls}, resolved ${c.resolved}, failed ${c.failed_calls}` +
        (c.parse_errors > 0 ? `; ${c.parse_errors} parse error(s)` : ""),
    );
    for (const e of f.parse_errors) out.push(`  PARSE L${e.line}  ${e.message}`);
    for (const x of f.failures) {
      out.push(
        `  FAIL L${x.line} [${x.check}]  ${x.expression}${x.guards ? `  (under #ifdef ${x.guards.join(", ")})` : ""}`,
      );
      out.push(`      ${x.what}`);
      for (const cand of x.candidates) out.push(`      candidate: ${cand}`);
    }
    for (const u of f.unresolved)
      out.push(`  UNRESOLVED L${u.line} ${u.method}  ${u.expression}  (${u.reason})`);
    for (const n of f.notes) out.push(`  NOTE L${n.line}  ${n.message}`);
    for (const c of f.resolved ?? []) out.push(`  OK L${c.line} ${c.expression}  -> ${c.target}`);
  }
  const t = r.totals;
  out.push("");
  out.push(
    `TOTAL files ${t.files}, files with failures ${t.files_failed}, failures ${t.failures}, parse errors ${t.parse_errors}, calls ${t.calls}, resolved ${t.resolved}, failed calls ${t.failed_calls}, unresolved ${t.unresolved}`,
  );
  const why = [
    ...(t.failures > 0 ? ["level-1 failures"] : []),
    ...(t.parse_errors > 0 ? ["parse errors: the code they hide was not linted"] : []),
  ];
  out.push(
    lintPassed(r)
      ? "RESULT: PASS (no level-1 failure, no parse error)"
      : `RESULT: FAIL (${why.join("; ")})`,
  );
  return out.join("\n");
}
