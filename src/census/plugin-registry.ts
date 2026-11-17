/**
 * The Workbench plugin and tool registry read from the E02 source index
 * (E03, plan 4.5), and the modal classification of every plugin's entry
 * points. Library code: the E03 generator writes rows from it, and later
 * tools (the plugin catalog of layer L3, the plugin-run path) import it.
 *
 * Population: every class declaration carrying `WorkbenchPluginAttribute`
 * (kind `plugin`) or `WorkbenchToolAttribute` (kind `tool`). The kind follows
 * the attribute, not the base class: two classes declared with the tool
 * attribute extend `WorkbenchPlugin`, and they are tools here.
 *
 * Module (the rule E03, E15, E17 and E18 share): the `wbModules` argument of
 * the attribute. Exactly one entry naming a module of the vocabulary gives
 * that module; no entry, several entries or an unknown name gives `Shared`.
 *
 * Call analysis. Method bodies are not in the index: they are read from the
 * file text (`readText`) and tokenised with the E02 lexer. Every call in a
 * body is resolved against the index: unqualified calls through the concrete
 * class's own and inherited methods, then global functions; `X.m()` through a
 * static class, `this`, `super`, a parameter, a local (declared, or `auto`
 * with a typed initialiser), a member variable or a global; chains through
 * declared return types, with generic arguments substituted (`array<T>.Get`
 * gives `T`); `new X()` through `X`'s constructor. A call resolves when its
 * target is declared in the index. Script targets with a body are followed;
 * engine targets (`proto`, or declared without a body under `generated/`)
 * are leaves. A target declared without a body and without `proto` (an
 * abstract-like prototype dispatched to an override) counts as unresolved.
 *
 * Depth: the calls written in the entry method's body are depth 1, the calls
 * in the bodies of the script methods those reach are depth 2, and so on.
 * The classification follows every script call to closure (each method is
 * searched once per concrete class, which stops cycles); `SEARCH_LIMIT` is
 * only a guard, and a search that reaches it leaves script calls unfollowed
 * (the frontier), which makes the verdict `unknown`, never `safe`. Every
 * effect keeps the depth it was found at, so the counts "to depth 1, 2 and 3"
 * of plan 4.5 (`MAX_DEPTH`) are read from the same search. Command-line
 * reads are collected to `MAX_DEPTH` only (a read deeper down sits in a
 * shared helper, not in the class). Overrides in subclasses of a receiver's
 * static type and callbacks the engine invokes later (dialog buttons,
 * `CallLater`, search callbacks) are not followed.
 *
 * What the analysis looks for (real names, read from the index):
 *  - dialog: `Workbench.Dialog`, `Workbench.ScriptDialog`,
 *    `WorldEditorAPI.ShowItemListDialog` (they wait for the user), and
 *    `new WBProgressDialog(...)` (its doc: "Modal progress dialog"). Script
 *    helpers such as `SCR_WorkbenchHelper.PrintDialog` are reached through
 *    their bodies.
 *  - exit: `Workbench.Exit`.
 *  - process: `Workbench.RunCmd`, `Workbench.RunProcess`.
 *  - delete: `FileIO.DeleteFile`.
 *  - write: `FileIO.OpenFile` with a WRITE or APPEND mode, `FileIO.CopyFile`,
 *    `FileIO.MakeDirectory`, and engine methods whose name starts with `Save`.
 *  - publish: engine methods whose name starts with `Upload` or `Publish`.
 *  - command line: `WBModuleDef.GetCmdLine`, `System.GetCLIParam`,
 *    `System.IsCLIParam`, with the argument name evaluated from literals and
 *    string constants.
 *
 * Verdict of an entry method, in this order: `exits` (reaches Workbench.Exit),
 * `modal` (reaches a dialog), `effects` (reaches an external process or a
 * file deletion), `unknown` (none of those found, but a call did not
 * resolve or the search stopped at its limit), `safe` (none of those found,
 * every call resolved and every script call was followed). A class that
 * overrides no `Run` is `no-run`. Only `safe` is safe to call from a handler.
 *
 * Row fields: `modal` is `opens` when Run reaches a dialog at any depth,
 * `none` when the search of Run was complete (no unresolved call, no
 * frontier) and found none, and absent otherwise. `risk_hint` is
 * `destructive` when Run, or any other entry point of the class (the other
 * framework event overrides, RunCommandline among them, and its button
 * methods), reaches Workbench.Exit or FileIO.DeleteFile; `external` when Run
 * reaches an upload or publish call; `mutating` when Run opens a dialog in
 * its own body (depth 1, the task's rule for E03). A `destructive` hint that
 * comes from an entry point other than Run is stated in `unverified`.
 */
import { compareCodeUnits } from "./canon.js";
import { firstSentence, lex } from "./enforce-source.js";
import {
  classChain,
  findClass,
  methodsOf,
  pakRef,
  type AttributeUse,
  type ClassRecord,
  type FieldRecord,
  type MergedClass,
  type MethodRecord,
  type MethodView,
  type SourceIndex,
} from "./source-index.js";
import { MODULES, type Module } from "./vocab.js";

type Tok = ReturnType<typeof lex>["toks"][number];

export const PLUGIN_ATTRIBUTE = "WorkbenchPluginAttribute";
export const TOOL_ATTRIBUTE = "WorkbenchToolAttribute";
export const SETTING_ATTRIBUTE = "Attribute";
export const BUTTON_ATTRIBUTE = "ButtonAttribute";
/** Reported depth (plan 4.5: dialog call sites to depth 3) and the depth of command-line reads. */
export const MAX_DEPTH = 3;
/**
 * Guard on the classification search, which otherwise follows every script
 * call to closure. On build 1.8.0.13 the deepest effect is at depth 6 and the
 * largest search covers 108 method bodies; a search that reaches this limit
 * gives `unknown`.
 */
export const SEARCH_LIMIT = 64;

/** Parameter names used when the attribute class is not in the index (synthetic inputs). */
const FALLBACK_PARAMS: Readonly<Record<string, readonly string[]>> = {
  [PLUGIN_ATTRIBUTE]: [
    "name",
    "description",
    "shortcut",
    "icon",
    "wbModules",
    "category",
    "awesomeFontCode",
    "resourceTypes",
  ],
  [SETTING_ATTRIBUTE]: [
    "defvalue",
    "uiwidget",
    "desc",
    "params",
    "enums",
    "category",
    "precision",
    "enumType",
    "prefabbed",
  ],
  [BUTTON_ATTRIBUTE]: ["label", "focused"],
};

// ── Attribute arguments ───────────────────────────────────────────────────────

/** One argument of an attribute: `name: value` or a positional value. */
export interface AttrArg {
  name?: string;
  value: string;
}

/** Splits attribute argument text into positional and named arguments, in order. */
export function splitAttributeArgs(args: string | undefined): AttrArg[] {
  if (args === undefined || args.trim() === "") return [];
  const out: AttrArg[] = [];
  let depth = 0;
  let cur = "";
  let inStr = false;
  const push = (): void => {
    const t = cur.trim();
    if (t === "") return;
    const m = /^([A-Za-z_]\w*)\s*:(?!:)\s*([\s\S]*)$/.exec(t);
    out.push(m ? { name: m[1], value: m[2].trim() } : { value: t });
  };
  for (let i = 0; i < args.length; i++) {
    const c = args[i];
    if (inStr) {
      cur += c;
      if (c === "\\") cur += args[++i] ?? "";
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    else if (c === "," && depth === 0) {
      push();
      cur = "";
      continue;
    }
    cur += c;
  }
  push();
  return out;
}

/** Constructor parameter names of an attribute class (its own, else an ancestor's). */
export function attributeParamNames(index: SourceIndex, attrClass: string): readonly string[] {
  for (const c of classChain(index, attrClass)) {
    const ctor = c.methods.find((m) => m.name === c.name);
    if (ctor) return ctor.params.map((p, i) => p.name ?? `#${i}`);
  }
  const fallback =
    attrClass === TOOL_ATTRIBUTE ? FALLBACK_PARAMS[PLUGIN_ATTRIBUTE] : FALLBACK_PARAMS[attrClass];
  return fallback ?? [];
}

/** Binds attribute arguments to parameter names: positional by index, named by name. */
export function bindAttributeArgs(
  args: string | undefined,
  params: readonly string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  let pos = 0;
  for (const a of splitAttributeArgs(args)) {
    if (a.name !== undefined) out[a.name] = a.value;
    else {
      const p = params[pos++] ?? `#${pos - 1}`;
      out[p] = a.value;
    }
  }
  return out;
}

/** String literals inside a `{ "a", "b" }` initialiser; undefined for anything else (`null` gives []). */
export function stringList(expr: string | undefined): string[] | undefined {
  if (expr === undefined) return undefined;
  const t = expr.trim();
  if (t === "null" || t === "NULL") return [];
  if (!/^\{[\s\S]*\}$/.test(t)) return undefined;
  const inner = t.slice(1, -1);
  const items = splitAttributeArgs(inner).map((a) => a.value);
  const out: string[] = [];
  for (const it of items) {
    const m = /^"((?:[^"\\]|\\.)*)"$/.exec(it);
    if (!m) return undefined;
    out.push(unescapeString(m[1]));
  }
  return out;
}

/** Unescapes the body of an Enforce string literal. */
export function unescapeString(body: string): string {
  return body.replace(/\\(.)/g, (_m, c: string) =>
    c === "n" ? "\n" : c === "t" ? "\t" : c === "r" ? "\r" : c,
  );
}

/**
 * Evaluates a string expression: literals and string constants joined by
 * `+`. `resolve(qualifier, name)` gives a constant's initialiser text.
 * Undefined when any part cannot be evaluated.
 */
export function evalStringExpr(
  expr: string | undefined,
  resolve: (qualifier: string | undefined, name: string) => string | undefined,
  depth = 0,
): string | undefined {
  if (expr === undefined || depth > 8) return undefined;
  const toks = lex(expr).toks.filter((t) => t.t !== "");
  if (toks.length === 0) return undefined;
  let out = "";
  let i = 0;
  for (;;) {
    const t = toks[i];
    if (!t) return undefined;
    if (t.k === "str") {
      out += unescapeString(t.t.slice(1, -1));
      i++;
    } else if (t.k === "id") {
      let qualifier: string | undefined;
      let name = t.t;
      if (toks[i + 1]?.t === "." && toks[i + 2]?.k === "id") {
        qualifier = name;
        name = toks[i + 2].t;
        i += 3;
      } else i++;
      const init = resolve(qualifier, name);
      const v = evalStringExpr(init, resolve, depth + 1);
      if (v === undefined) return undefined;
      out += v;
    } else return undefined;
    if (i >= toks.length) return out;
    if (toks[i].t !== "+") return undefined;
    i++;
  }
}

/** The member's raw initialiser text of a string constant in a class chain or global scope. */
export function constantResolver(
  index: SourceIndex,
  contextClasses: readonly string[],
): (qualifier: string | undefined, name: string) => string | undefined {
  const fieldInit = (cls: string, name: string): string | undefined => {
    for (const c of classChain(index, cls)) {
      const f = c.fields.find((x) => x.name === name);
      if (f) return f.init;
    }
    return undefined;
  };
  return (qualifier, name) => {
    if (qualifier !== undefined) return fieldInit(qualifier, name);
    for (const c of contextClasses) {
      const v = fieldInit(c, name);
      if (v !== undefined) return v;
    }
    return index.variables.get(name)?.[0]?.init;
  };
}

// ── Modules ───────────────────────────────────────────────────────────────────

const MODULE_SET: ReadonlySet<string> = new Set(MODULES);

/** The shared plugin/tool module rule (E03, E15, E17, E18). */
export function moduleFromWbModules(list: readonly string[] | undefined): {
  module: Module;
  rule: string;
} {
  if (list === undefined) return { module: "Shared", rule: "no wbModules argument" };
  if (list.length === 0) return { module: "Shared", rule: "empty wbModules" };
  if (list.length > 1) return { module: "Shared", rule: "several wbModules entries" };
  const m = list[0];
  if (MODULE_SET.has(m) && m !== "none" && m !== "Shared")
    return { module: m as Module, rule: "single wbModules entry" };
  return { module: "Shared", rule: "wbModules entry outside the vocabulary" };
}

// ── Population ────────────────────────────────────────────────────────────────

export interface PluginClass {
  name: string;
  kind: "plugin" | "tool";
  decl: ClassRecord;
  attr: AttributeUse;
  /** Raw argument text per parameter name. */
  args: Record<string, string>;
  label?: string;
  description?: string;
  shortcut?: string;
  category?: string;
  icon?: string;
  /** Parsed `wbModules` (undefined when absent; [] for null). */
  wbModules?: string[];
  resourceTypes?: string[];
  module: Module;
  moduleRule: string;
  /** `WorkbenchPluginAttribute(<args>)` as written, whitespace collapsed. */
  signature: string;
  /** Arguments that are written but could not be evaluated. */
  unreadable: string[];
}

export function isRegistryAttribute(a: AttributeUse): boolean {
  return a.name === PLUGIN_ATTRIBUTE || a.name === TOOL_ATTRIBUTE;
}

/** Every class declaration that carries a plugin or tool attribute, in (file, line) order. */
export function pluginClasses(index: SourceIndex): PluginClass[] {
  const out: PluginClass[] = [];
  for (const r of index.records) {
    if (r.kind !== "class" || r.forward) continue;
    const attr = r.attributes.find(isRegistryAttribute);
    if (!attr) continue;
    const params = attributeParamNames(index, attr.name);
    const args = bindAttributeArgs(attr.args, params);
    const resolve = constantResolver(index, [r.name]);
    const unreadable: string[] = [];
    const str = (p: string): string | undefined => {
      if (args[p] === undefined) return undefined;
      const v = evalStringExpr(args[p], resolve);
      if (v === undefined) unreadable.push(p);
      return v;
    };
    const list = (p: string): string[] | undefined => {
      if (args[p] === undefined) return undefined;
      const v = stringList(args[p]);
      if (v === undefined) unreadable.push(p);
      return v;
    };
    const wbModules = list("wbModules");
    const mod = moduleFromWbModules(
      args.wbModules !== undefined && wbModules === undefined ? ["?"] : wbModules,
    );
    out.push({
      name: r.name,
      kind: attr.name === PLUGIN_ATTRIBUTE ? "plugin" : "tool",
      decl: r,
      attr,
      args,
      label: str("name"),
      description: str("description"),
      shortcut: str("shortcut"),
      category: str("category"),
      icon: str("icon"),
      wbModules,
      resourceTypes: list("resourceTypes"),
      module: mod.module,
      moduleRule:
        args.wbModules !== undefined && wbModules === undefined
          ? "wbModules not readable"
          : mod.rule,
      signature: `${attr.name}(${attr.args ?? ""})`.replace(/\s+/g, " "),
      unreadable,
    });
  }
  return out;
}

/** Occurrences of a plugin or tool attribute inside comments (declarations commented out). */
export function commentedAttributes(
  files: readonly string[],
  readText: (file: string) => string | undefined,
): { file: string; line: number; attribute: string; class?: string }[] {
  const out: { file: string; line: number; attribute: string; class?: string }[] = [];
  const re = /\[\s*(Workbench(?:Plugin|Tool)Attribute)\b/g;
  for (const f of files) {
    const text = readText(f);
    if (!text || !/Workbench(Plugin|Tool)Attribute/.test(text)) continue;
    const lx = lex(text);
    for (const c of lx.comments) {
      for (const m of c.text.matchAll(re)) {
        const before = c.text.slice(0, m.index ?? 0);
        const line = c.line + (before.match(/\n/g)?.length ?? 0);
        const after = c.text.slice(m.index ?? 0);
        let cls = /\]\s*(?:\/\/\s*)?class\s+(\w+)/.exec(after)?.[1];
        if (!cls) {
          // Attribute commented out on its own: the class follows the comment.
          const next = lx.toks.find((t) => t.line > c.endLine && t.k === "id");
          const i = next ? lx.toks.indexOf(next) : -1;
          if (next?.t === "class" && lx.toks[i + 1]?.k === "id") cls = lx.toks[i + 1].t;
        }
        out.push({ file: f, line, attribute: m[1], ...(cls ? { class: cls } : {}) });
      }
    }
  }
  return out;
}

// ── Scope of a class: its script classes up to the framework base ─────────────

/** True for a class declared by the engine's Workbench API (the framework bases). */
export function isFrameworkClass(c: MergedClass): boolean {
  const f = c.declarations[0]?.file ?? "";
  return /\/generated\//.test(f) || /^scripts\/Core\/proto\//.test(f);
}

/** The class and its script ancestors, nearest first, stopping at the first framework class. */
export function scriptChain(index: SourceIndex, name: string): MergedClass[] {
  const out: MergedClass[] = [];
  for (const c of classChain(index, name)) {
    if (isFrameworkClass(c)) break;
    out.push(c);
  }
  return out;
}

/** Framework event methods (name/arity) above a class: WorkbenchPlugin, WorldEditorTool and the module plugin bases. */
export function frameworkEvents(index: SourceIndex, name: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const c of classChain(index, name)) {
    if (!isFrameworkClass(c)) continue;
    for (const m of c.methods)
      if (m.modifiers.includes("event")) {
        const k = `${m.name}/${m.arity}`;
        if (!out.has(k)) out.set(k, c.name);
      }
  }
  return out;
}

export interface Override {
  method: string;
  arity: number;
  /** Framework class declaring the event. */
  event_of: string;
  /** Script class whose declaration overrides it (the class itself or an ancestor). */
  declared_in: string;
  inherited: boolean;
  record: MethodRecord;
}

/** Framework events the class overrides with a body, own or inherited. */
export function overridesOf(index: SourceIndex, name: string): Override[] {
  const events = frameworkEvents(index, name);
  const scope = new Set(scriptChain(index, name).map((c) => c.name));
  const out: Override[] = [];
  const seen = new Set<string>();
  for (const v of methodsOf(index, name)) {
    const k = `${v.method.name}/${v.method.arity}`;
    const of = events.get(k);
    if (!of || !scope.has(v.declared_in) || !v.method.has_body || seen.has(k)) continue;
    seen.add(k);
    out.push({
      method: v.method.name,
      arity: v.method.arity,
      event_of: of,
      declared_in: v.declared_in,
      inherited: v.declared_in !== name,
      record: pickDeclaration(index, name, v.method.name, v.method.arity) ?? v.method,
    });
  }
  return out;
}

/** The most derived declaration of a method; within one class the last one (a modded override). */
function pickDeclaration(
  index: SourceIndex,
  cls: string,
  method: string,
  arity: number,
): MethodRecord | undefined {
  const views = methodsOf(index, cls).filter(
    (v) => v.method.name === method && v.method.arity === arity,
  );
  if (views.length === 0) return undefined;
  const owner = views[0].declared_in;
  const same = views.filter((v) => v.declared_in === owner && v.method.has_body);
  return (same[same.length - 1] ?? views[0]).method;
}

// ── Members: settings and buttons ─────────────────────────────────────────────

export interface SettingMember {
  field: FieldRecord;
  declared_in: string;
  inherited: boolean;
  attr: AttributeUse;
  args: Record<string, string>;
  desc?: string;
  defvalue?: string;
}

/** `[Attribute]` members of a class and its script ancestors (most derived first, one per name). */
export function settingMembers(index: SourceIndex, name: string): SettingMember[] {
  const params = attributeParamNames(index, SETTING_ATTRIBUTE);
  const out: SettingMember[] = [];
  const seen = new Set<string>();
  for (const c of scriptChain(index, name)) {
    const resolve = constantResolver(index, [c.name, name]);
    for (const f of c.fields) {
      const attr = f.attributes.find((a) => a.name === SETTING_ATTRIBUTE);
      if (!attr || seen.has(f.name)) continue;
      seen.add(f.name);
      const args = bindAttributeArgs(attr.args, params);
      out.push({
        field: f,
        declared_in: c.name,
        inherited: c.name !== name,
        attr,
        args,
        desc: evalStringExpr(args.desc, resolve),
        defvalue: args.defvalue,
      });
    }
  }
  return out;
}

export interface ButtonMethod {
  method: MethodRecord;
  declared_in: string;
  inherited: boolean;
  attr: AttributeUse;
  label?: string;
}

/** `[ButtonAttribute]` methods of a class and its script ancestors (one per method name). */
export function buttonMethods(index: SourceIndex, name: string): ButtonMethod[] {
  const params = attributeParamNames(index, BUTTON_ATTRIBUTE);
  const out: ButtonMethod[] = [];
  const seen = new Set<string>();
  for (const c of scriptChain(index, name)) {
    const resolve = constantResolver(index, [c.name, name]);
    for (const m of c.methods) {
      const attr = m.attributes.find((a) => a.name === BUTTON_ATTRIBUTE);
      if (!attr || seen.has(m.name)) continue;
      seen.add(m.name);
      const args = bindAttributeArgs(attr.args, params);
      out.push({
        method: m,
        declared_in: c.name,
        inherited: c.name !== name,
        attr,
        label: evalStringExpr(args.label, resolve),
      });
    }
  }
  return out;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TypeRef {
  name: string;
  args: TypeRef[];
}

const TYPE_MODIFIERS = new Set([
  "ref",
  "autoptr",
  "owned",
  "const",
  "notnull",
  "out",
  "inout",
  "static",
  "private",
  "protected",
  "volatile",
  "reference",
]);

/** Parses type text (`ref array<ref Foo>`, `int[4]`) into a TypeRef. */
export function parseTypeText(text: string | undefined): TypeRef | undefined {
  if (!text) return undefined;
  const toks = lex(text).toks.filter((t) => t.t !== "");
  let i = 0;
  const parse = (): TypeRef | undefined => {
    while (toks[i]?.k === "id" && TYPE_MODIFIERS.has(toks[i].t)) i++;
    const t = toks[i];
    if (!t || t.k !== "id") return undefined;
    i++;
    const ref: TypeRef = { name: t.t, args: [] };
    if (toks[i]?.t === "<") {
      i++;
      for (;;) {
        const a = parse();
        if (a) ref.args.push(a);
        if (toks[i]?.t === ",") {
          i++;
          continue;
        }
        if (toks[i]?.t === ">") i++;
        break;
      }
    }
    return ref;
  };
  const r = parse();
  if (r && toks[i]?.t === "[") return { name: "$array", args: [r] };
  return r;
}

// ── Body extraction ───────────────────────────────────────────────────────────

export type TextReader = (file: string) => string | undefined;

/** Lexed files and method bodies, cached. */
export class BodyReader {
  private readonly lexed = new Map<string, Tok[] | null>();
  constructor(private readonly readText: TextReader) {}

  tokens(file: string): Tok[] | undefined {
    let t = this.lexed.get(file);
    if (t === undefined) {
      const text = this.readText(file);
      t = text === undefined ? null : lex(text).toks;
      this.lexed.set(file, t);
    }
    return t ?? undefined;
  }

  /** Token range [open+1, close) of the method's body, or undefined. */
  body(m: MethodRecord): { toks: Tok[]; from: number; to: number } | undefined {
    if (!m.has_body) return undefined;
    const toks = this.tokens(m.file);
    if (!toks) return undefined;
    const bare = m.name.replace(/^~/, "");
    let i = toks.findIndex((t, k) => t.line === m.line && t.t === bare && toks[k + 1]?.t === "(");
    if (i < 0) return undefined;
    i++;
    const close = matchClose(toks, i);
    if (close < 0) return undefined;
    let j = close + 1;
    while (j < toks.length && toks[j].t !== "{" && toks[j].t !== ";") j++;
    if (toks[j]?.t !== "{") return undefined;
    const end = matchClose(toks, j);
    if (end < 0) return undefined;
    return { toks, from: j + 1, to: end };
  }
}

const OPEN: Record<string, string> = { "(": ")", "{": "}", "[": "]" };

/** Index of the token closing the bracket at `i` (same kind, nesting counted), or -1. */
function matchClose(toks: Tok[], i: number): number {
  const open = toks[i].t;
  const close = OPEN[open];
  let depth = 0;
  for (let j = i; j < toks.length; j++) {
    if (toks[j].k !== "op") continue;
    if (toks[j].t === open) depth++;
    else if (toks[j].t === close) {
      depth--;
      if (depth === 0) return j;
    }
  }
  return -1;
}

// ── Call resolution ───────────────────────────────────────────────────────────

const KEYWORDS = new Set([
  "if",
  "else",
  "while",
  "for",
  "foreach",
  "switch",
  "case",
  "default",
  "return",
  "break",
  "continue",
  "new",
  "delete",
  "sizeof",
  "typeof",
  "thread",
  "null",
  "NULL",
  "true",
  "false",
  "this",
  "super",
  "class",
  "out",
  "inout",
  "ref",
  "autoptr",
  "const",
  "static",
  "local",
  "auto",
  "notnull",
  "volatile",
]);

export interface CallTarget {
  /** Class declaring the target (`<global>` for a global function). */
  owner: string;
  name: string;
  arity: number;
  record?: MethodRecord;
  /** Class whose methods an unqualified call inside the target resolves against. */
  self: string;
  /** True for a target with a script body (followed); false for an engine leaf. */
  script: boolean;
}

export interface CallSite {
  file: string;
  line: number;
  /** `receiver.name` as written (receiver shortened to its first token). */
  text: string;
  args: string[];
  target?: CallTarget;
  unresolved?: string;
  /** Token index of the called name in its file (internal: coverage check). */
  pos?: number;
}

/** Variables in scope of a body: each name with its declarations in token order (`at`). */
class Vars {
  private readonly m = new Map<string, { at: number; type: TypeRef | null }[]>();
  add(name: string, at: number, type: TypeRef | null): void {
    const l = this.m.get(name) ?? [];
    l.push({ at, type });
    l.sort((a, b) => a.at - b.at);
    this.m.set(name, l);
  }
  has(name: string): boolean {
    return this.m.has(name);
  }
  /** The nearest declaration before `pos` (else the first one). */
  get(name: string, pos: number): TypeRef | null | undefined {
    const l = this.m.get(name);
    if (!l) return undefined;
    let best = l[0];
    for (const d of l) if (d.at < pos) best = d;
    return best.type;
  }
}

interface Env {
  self: string;
  declaring: string;
  vars: Vars;
}

const PRIMITIVES = new Set([
  "int",
  "float",
  "bool",
  "string",
  "vector",
  "typename",
  "void",
  "func",
]);
const NUMERIC_OPS = new Set(["+", "-", "*", "/", "%"]);

const isClassName = (index: SourceIndex, n: string): boolean =>
  (findClass(index, n)?.declarations.length ?? 0) > 0 ||
  index.enums.has(n) ||
  index.typedefs.has(n);

/** Resolves calls in method bodies against the index (memoised per class and method). */
export class CallResolver {
  private readonly methodMemo = new Map<string, Map<string, MethodView[]>>();
  private readonly fieldMemo = new Map<string, Map<string, FieldRecord>>();
  private readonly siteMemo = new Map<string, CallSite[]>();
  readonly bodies: BodyReader;

  constructor(
    private readonly index: SourceIndex,
    readText: TextReader,
  ) {
    this.bodies = new BodyReader(readText);
  }

  private methodsNamed(cls: string, name: string): MethodView[] {
    let m = this.methodMemo.get(cls);
    if (!m) {
      m = new Map();
      for (const v of methodsOf(this.index, cls)) {
        const l = m.get(v.method.name) ?? [];
        l.push(v);
        m.set(v.method.name, l);
      }
      this.methodMemo.set(cls, m);
    }
    const own = m.get(name);
    if (own && own.length) return own;
    // Every class derives from Class.
    if (cls !== "Class") return this.methodsNamed("Class", name);
    return [];
  }

  private field(cls: string, name: string): FieldRecord | undefined {
    let m = this.fieldMemo.get(cls);
    if (!m) {
      m = new Map();
      for (const c of classChain(this.index, cls))
        for (const f of c.fields) if (!m.has(f.name)) m.set(f.name, f);
      this.fieldMemo.set(cls, m);
    }
    return m.get(name);
  }

  private readonly belowMemo = new Map<string, { cls: string; method: MethodRecord }[]>();

  /** Script overrides (with a body) of `owner.name/arity` in every class below `owner`. */
  overridesBelow(
    owner: string,
    name: string,
    arity: number,
  ): { cls: string; method: MethodRecord }[] {
    const key = `${owner}\u0000${name}\u0000${arity}`;
    const memo = this.belowMemo.get(key);
    if (memo) return memo;
    const out: { cls: string; method: MethodRecord }[] = [];
    for (const c of [...this.index.classes.values()].sort((a, b) =>
      compareCodeUnits(a.name, b.name),
    )) {
      if (c.name === owner || c.declarations.length === 0) continue;
      if (!classChain(this.index, c.name).some((x) => x.name === owner)) continue;
      for (const m of c.methods)
        if (m.name === name && m.arity === arity && m.has_body)
          out.push({ cls: c.name, method: m });
    }
    this.belowMemo.set(key, out);
    return out;
  }

  /** Follows typedefs (keeping generic arguments) and resolves to a class or enum name. */
  normalize(t: TypeRef | undefined): TypeRef | undefined {
    let cur = t;
    for (let k = 0; cur && k < 6; k++) {
      if ((this.index.classes.get(cur.name)?.declarations.length ?? 0) > 0) return cur;
      if (this.index.enums.has(cur.name)) return cur;
      const td = this.index.typedefs.get(cur.name)?.[0];
      if (!td) return cur;
      cur = parseTypeText(td.type);
    }
    return cur;
  }

  private generics(cls: string): string[] {
    return (findClass(this.index, cls)?.generics ?? []).map((g) => g.split(/\s+/).pop() ?? g);
  }

  private substitute(t: TypeRef | undefined, recv: TypeRef | undefined): TypeRef | undefined {
    if (!t || !recv || recv.args.length === 0) return t;
    const names = this.generics(recv.name);
    const map = new Map<string, TypeRef>();
    names.forEach((n, i) => {
      if (recv.args[i]) map.set(n, recv.args[i]);
    });
    const sub = (x: TypeRef): TypeRef =>
      map.get(x.name) && x.args.length === 0
        ? (map.get(x.name) as TypeRef)
        : { name: x.name, args: x.args.map(sub) };
    return sub(t);
  }

  private pick(views: MethodView[], n: number): MethodView | undefined {
    if (views.length === 0) return undefined;
    const fits = (m: MethodRecord): boolean =>
      m.arity === n || (m.required <= n && (n <= m.arity || m.variadic === true));
    const cands = views.filter((v) => fits(v.method));
    const list = cands.length ? cands : views;
    const owner = list[0].declared_in;
    const same = list.filter((v) => v.declared_in === owner);
    const withBody = same.filter((v) => v.method.has_body);
    return withBody[withBody.length - 1] ?? same[same.length - 1];
  }

  private target(v: MethodView, self: string): CallTarget {
    const m = v.method;
    const engine =
      m.modifiers.includes("proto") ||
      m.modifiers.includes("native") ||
      m.modifiers.includes("external") ||
      /\/generated\/|^scripts\/Core\/proto\//.test(m.file);
    return {
      owner: v.declared_in,
      name: m.name,
      arity: m.arity,
      record: m,
      self,
      script: m.has_body && !engine,
    };
  }

  /** Call sites of a method body, resolved with `self` as the concrete class. */
  callSites(m: MethodRecord, self: string): CallSite[] {
    const key = `${m.file}\u0000${m.line}\u0000${m.name}\u0000${self}`;
    const memo = this.siteMemo.get(key);
    if (memo) return memo;
    const body = this.bodies.body(m);
    const sites: CallSite[] = [];
    this.siteMemo.set(key, sites);
    if (!body) return sites;
    const declaring = m.owner ?? self;
    const env: Env = { self, declaring, vars: new Vars() };
    for (const p of m.params) if (p.name) env.vars.add(p.name, -1, parseTypeText(p.type) ?? null);
    this.collectLocals(body.toks, body.from, body.to, env);
    const { toks, from, to } = body;
    for (let i = from; i < to; i++) {
      const t = toks[i];
      const prev = toks[i - 1];
      if (prev && (prev.t === "." || prev.t === "new")) continue;
      const startsChain =
        t.k === "id" ||
        t.k === "str" ||
        (t.t === "(" &&
          !(
            prev &&
            ((prev.k === "id" && !KEYWORDS.has(prev.t)) ||
              prev.t === ")" ||
              prev.t === "]" ||
              prev.t === ">")
          ));
      if (!startsChain) continue;
      this.chain(toks, i, to, env, m.file, sites);
    }
    // Coverage: every `name(` the chains did not account for is an unresolved call.
    const covered = new Set(sites.map((s) => s.pos));
    for (let k = from; k < to; k++) {
      const t = toks[k];
      if (t.k !== "id" || toks[k + 1]?.t !== "(" || covered.has(k) || KEYWORDS.has(t.t)) continue;
      const prev = toks[k - 1];
      if (prev?.t === "new") continue;
      // Declarations of locals with a constructor-style initialiser do not occur in Enforce;
      // a `Type name(` pattern is a call, which the chains cover.
      sites.push({
        file: m.file,
        line: t.line,
        text: prev?.t === "." ? `….${t.t}` : t.t,
        args: [],
        unresolved: "call not reached by the expression reader",
        pos: k,
      });
    }
    sites.sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0));
    return sites;
  }

  /** Declared locals (`Type name`, `foreach (Type name : ...)`) and typed `auto` locals. */
  private collectLocals(toks: Tok[], from: number, to: number, env: Env): void {
    const autos: { name: string; at: number }[] = [];
    for (let i = from; i < to; i++) {
      const t = toks[i];
      if (t.k !== "id" || toks[i - 1]?.t === ".") continue;
      let j = i;
      while (toks[j]?.k === "id" && TYPE_MODIFIERS.has(toks[j].t)) j++;
      const typeTok = toks[j];
      if (!typeTok || typeTok.k !== "id") continue;
      let k = j + 1;
      if (toks[k]?.t === "<") {
        let depth = 0;
        for (; k < to; k++) {
          if (toks[k].t === "<") depth++;
          else if (toks[k].t === ">") {
            depth--;
            if (depth === 0) break;
          } else if (toks[k].t === ";" || toks[k].t === "{") break;
        }
        k++;
      }
      const nameTok = toks[k];
      const after = toks[k + 1]?.t;
      if (!nameTok || nameTok.k !== "id" || KEYWORDS.has(nameTok.t)) continue;
      if (!["=", ";", ",", ")", ":", "["].includes(after ?? "")) continue;
      if (typeTok.t === "auto") {
        if (after === "=") autos.push({ name: nameTok.t, at: k + 2 });
        else env.vars.add(nameTok.t, k, null);
        continue;
      }
      if (!PRIMITIVES.has(typeTok.t) && !isClassName(this.index, typeTok.t)) continue;
      const type =
        parseTypeText(
          toks
            .slice(j, k)
            .map((x) => x.t)
            .join(" "),
        ) ?? null;
      env.vars.add(nameTok.t, k, type);
      // Further declarators of the same statement: `Type a = x, b, c = y;`.
      let p = k + 1;
      for (;;) {
        let depth = 0;
        while (p < to) {
          const x = toks[p].t;
          if (toks[p].k === "op" && "([{".includes(x)) depth++;
          else if (toks[p].k === "op" && ")]}".includes(x)) {
            if (depth === 0) break;
            depth--;
          } else if (depth === 0 && (x === "," || x === ";")) break;
          p++;
        }
        if (toks[p]?.t !== "," || toks[p + 1]?.k !== "id") break;
        const next = toks[p + 2]?.t ?? "";
        if (!["=", ";", ",", "["].includes(next)) break;
        env.vars.add(toks[p + 1].t, p + 1, type);
        p += 2;
      }
    }
    for (const a of autos) {
      const scratch: CallSite[] = [];
      const r = this.chain(toks, a.at, to, env, "", scratch);
      env.vars.add(toks[a.at - 2].t, a.at - 2, r ?? null);
    }
  }

  /**
   * Type of a parenthesised expression: a cast `(T){...}`, a single operand,
   * or arithmetic (`+ - * / %`) over numbers, vectors and strings (string if
   * any operand is one, else vector, else float, else int). Undefined
   * otherwise.
   */
  private parenType(toks: Tok[], open: number, close: number, env: Env): TypeRef | undefined {
    const types: (TypeRef | undefined)[] = [];
    let i = open + 1;
    while (i < close) {
      const t = toks[i];
      if (t.t === "-" || t.t === "+") {
        i++;
        continue;
      }
      let type: TypeRef | undefined;
      let end: number;
      if (t.k === "num") {
        type = { name: /[.eEfF]/.test(t.t) && !/^0[xX]/.test(t.t) ? "float" : "int", args: [] };
        end = i + 1;
      } else if (t.k === "str" || t.k === "id" || t.t === "(") {
        const scratch: CallSite[] = [];
        const r = this.chainEnd(toks, i, close, env, scratch);
        type = r.type;
        end = r.end;
      } else return undefined;
      types.push(type);
      i = end;
      if (i >= close) break;
      if (!NUMERIC_OPS.has(toks[i].t)) return undefined;
      i++;
    }
    if (types.length === 1) return types[0];
    if (types.some((x) => !x || !PRIMITIVES.has(x.name))) return undefined;
    const names = new Set(types.map((x) => (x as TypeRef).name));
    for (const n of ["string", "vector", "float", "int"])
      if (names.has(n)) return { name: n, args: [] };
    return undefined;
  }

  /** `chain` with its end position, sites discarded. */
  private chainEnd(
    toks: Tok[],
    i: number,
    to: number,
    env: Env,
    scratch: CallSite[],
  ): { type: TypeRef | undefined; end: number } {
    const box = { end: i + 1 };
    const type = this.chain(toks, i, to, env, "", scratch, box);
    return { type, end: box.end };
  }

  /** Parses one postfix chain starting at `i`; pushes its call sites; returns the chain's type. */
  private chain(
    toks: Tok[],
    i: number,
    to: number,
    env: Env,
    file: string,
    sites: CallSite[],
    box?: { end: number },
  ): TypeRef | undefined {
    const result = this.chainInner(toks, i, to, env, file, sites);
    if (box) box.end = result.end;
    return result.type;
  }

  private chainInner(
    toks: Tok[],
    i: number,
    to: number,
    env: Env,
    file: string,
    sites: CallSite[],
  ): { type: TypeRef | undefined; end: number } {
    const idx = this.index;
    let type: TypeRef | undefined;
    let staticClass: string | undefined;
    let superFrom: string | undefined;
    let isThis = false;
    let genericParam = false;
    let known = true;
    let label = toks[i].t;
    let j = i;
    const record = (site: CallSite, pos: number): void => {
      if (file) sites.push({ ...site, pos });
    };
    const argsAt = (open: number): { args: string[]; close: number } => {
      const close = matchClose(toks, open);
      const end = close < 0 ? to : close;
      const args: string[] = [];
      let depth = 0;
      let cur: string[] = [];
      for (let k = open + 1; k < end; k++) {
        const t = toks[k];
        if (t.k === "op" && "([{".includes(t.t)) depth++;
        else if (t.k === "op" && ")]}".includes(t.t)) depth--;
        if (depth === 0 && t.t === ",") {
          args.push(cur.join(" "));
          cur = [];
          continue;
        }
        cur.push(t.t);
      }
      if (cur.length) args.push(cur.join(" "));
      return { args, close: end };
    };

    const t0 = toks[i];
    if (t0.t === "new") {
      let k = i + 1;
      while (toks[k]?.k === "id" && TYPE_MODIFIERS.has(toks[k].t)) k++;
      const nameTok = toks[k];
      if (!nameTok || nameTok.k !== "id") return { type: undefined, end: i + 1 };
      let tEnd = k + 1;
      if (toks[tEnd]?.t === "<") {
        let depth = 0;
        for (; tEnd < to; tEnd++) {
          if (toks[tEnd].t === "<") depth++;
          else if (toks[tEnd].t === ">") {
            depth--;
            if (depth === 0) break;
          }
        }
        tEnd++;
      }
      const ctorType = parseTypeText(
        toks
          .slice(k, tEnd)
          .map((x) => x.t)
          .join(" "),
      );
      type = this.normalize(ctorType);
      let args: string[] = [];
      j = tEnd;
      if (toks[j]?.t === "(") {
        const a = argsAt(j);
        args = a.args;
        j = a.close + 1;
      }
      const cls = type ? findClass(idx, type.name) : undefined;
      if (!cls || cls.declarations.length === 0) {
        record(
          {
            file,
            line: t0.line,
            text: `new ${nameTok.t}`,
            args,
            unresolved: `unknown class ${nameTok.t}`,
          },
          k,
        );
        known = false;
      } else {
        const ctors = cls.methods
          .filter((m) => m.name === cls.name)
          .map((m) => ({ method: m, declared_in: cls.name, inherited: false }));
        const v = this.pick(ctors, args.length);
        record(
          {
            file,
            line: t0.line,
            text: `new ${cls.name}`,
            args,
            target: v
              ? this.target(v, cls.name)
              : {
                  owner: cls.name,
                  name: cls.name,
                  arity: args.length,
                  self: cls.name,
                  script: false,
                },
          },
          k,
        );
      }
    } else if (t0.t === "this") {
      type = { name: env.self, args: [] };
      isThis = true;
      j = i + 1;
    } else if (t0.t === "super") {
      const parent = findClass(idx, env.declaring)?.parent_name;
      superFrom = parent;
      type = parent ? { name: parent, args: [] } : undefined;
      known = parent !== undefined;
      j = i + 1;
    } else if (t0.k === "str") {
      type = { name: "string", args: [] };
      j = i + 1;
    } else if (t0.t === "(") {
      const close = matchClose(toks, i);
      if (close < 0) return { type: undefined, end: i + 1 };
      label = "(…)";
      const castName = toks[i + 1]?.k === "id" && close === i + 2 ? toks[i + 1].t : undefined;
      if (
        castName &&
        toks[close + 1]?.t === "{" &&
        (PRIMITIVES.has(castName) || isClassName(idx, castName))
      ) {
        // A cast of an initialiser: `(vector){ 1, 2, 3 }`.
        type = this.normalize({ name: castName, args: [] });
        const c = matchClose(toks, close + 1);
        j = c > 0 ? c + 1 : close + 1;
      } else {
        type = this.parenType(toks, i, close, env);
        j = close + 1;
      }
      known = type !== undefined;
    } else if (t0.k === "id") {
      if (KEYWORDS.has(t0.t)) return { type: undefined, end: i + 1 };
      const ctorClass =
        toks[i + 1]?.t === "(" &&
        !this.methodsNamed(env.self, t0.t).length &&
        !idx.functions.has(t0.t)
          ? findClass(idx, t0.t)
          : undefined;
      if (ctorClass && ctorClass.declarations.length > 0) {
        // `Class(args)`: the constructor call of an initialiser list.
        const { args, close } = argsAt(i + 1);
        const ctors = ctorClass.methods
          .filter((m) => m.name === ctorClass.name)
          .map((m) => ({ method: m, declared_in: ctorClass.name, inherited: false }));
        const v = this.pick(ctors, args.length);
        record(
          {
            file,
            line: t0.line,
            text: `${ctorClass.name}(…)`,
            args,
            target: v
              ? this.target(v, ctorClass.name)
              : {
                  owner: ctorClass.name,
                  name: ctorClass.name,
                  arity: args.length,
                  self: ctorClass.name,
                  script: false,
                },
          },
          i,
        );
        type = { name: ctorClass.name, args: [] };
        j = close + 1;
      } else if (toks[i + 1]?.t === "(") {
        // Unqualified call.
        const { args, close } = argsAt(i + 1);
        let v = this.pick(this.methodsNamed(env.self, t0.t), args.length);
        let self = env.self;
        if (!v && env.declaring !== env.self) {
          v = this.pick(this.methodsNamed(env.declaring, t0.t), args.length);
          self = env.declaring;
        }
        let target: CallTarget | undefined;
        if (v) {
          // A static method runs with its own class as context.
          target = this.target(v, v.method.modifiers.includes("static") ? v.declared_in : self);
        } else {
          const fns = idx.functions.get(t0.t);
          if (fns?.length) {
            const fv = this.pick(
              fns.map((m) => ({ method: m, declared_in: "<global>", inherited: false })),
              args.length,
            ) as MethodView;
            target = this.target(fv, "<global>");
            target.owner = "<global>";
          }
        }
        if (target) {
          record({ file, line: t0.line, text: t0.t, args, target }, i);
          type = this.normalize(
            this.substitute(parseTypeText(target.record?.return_type), undefined),
          );
        } else {
          record(
            {
              file,
              line: t0.line,
              text: t0.t,
              args,
              unresolved: `no method or function named ${t0.t}`,
            },
            i,
          );
          known = false;
        }
        j = close + 1;
      } else {
        const name = t0.t;
        if (env.vars.has(name)) {
          const vt = env.vars.get(name, i) ?? null;
          type = vt ? this.normalize(vt) : undefined;
          known = vt !== null;
        } else {
          const f = this.field(env.self, name) ?? this.field(env.declaring, name);
          if (f) type = this.normalize(parseTypeText(f.type));
          else if (idx.variables.has(name))
            type = this.normalize(parseTypeText(idx.variables.get(name)?.[0]?.type));
          else if (this.generics(env.declaring).includes(name)) {
            // A generic parameter used as a class (`T.Cast(x)`): its members are Class's.
            staticClass = "Class";
            genericParam = true;
          } else if (isClassName(idx, name)) {
            const n = this.normalize({ name, args: [] });
            staticClass = n?.name ?? name;
          } else known = false;
        }
        j = i + 1;
        // A static call on a generic class: `SCR_ArrayHelperT<int>.Shuffle(...)`.
        if (staticClass !== undefined && toks[j]?.t === "<") {
          let depth = 0;
          let k = j;
          for (; k < to; k++) {
            if (toks[k].t === "<") depth++;
            else if (toks[k].t === ">") {
              depth--;
              if (depth === 0) break;
            } else if (toks[k].t === ";" || toks[k].t === "(" || toks[k].t === "{") break;
          }
          if (toks[k]?.t === ">" && toks[k + 1]?.t === ".") j = k + 1;
        }
      }
    } else return { type: undefined, end: i + 1 };

    // Postfix operators.
    for (;;) {
      const t = toks[j];
      if (!t || j >= to) break;
      if (t.t === "." && toks[j + 1]?.k === "id") {
        const name = toks[j + 1].t;
        const call = toks[j + 2]?.t === "(";
        const text = `${label}.${name}`;
        if (call) {
          const { args, close } = argsAt(j + 2);
          let views: MethodView[] = [];
          let self = env.self;
          let recv: TypeRef | undefined;
          if (staticClass !== undefined) {
            if (name === "Cast" || name === "CastTo") {
              const v = this.pick(this.methodsNamed(staticClass, name), args.length);
              record(
                {
                  file,
                  line: toks[j + 1].line,
                  text,
                  args,
                  target: v
                    ? this.target(v, staticClass)
                    : {
                        owner: "Class",
                        name,
                        arity: args.length,
                        self: staticClass,
                        script: false,
                      },
                },
                j + 1,
              );
              type =
                name === "Cast"
                  ? genericParam
                    ? undefined
                    : { name: staticClass, args: [] }
                  : { name: "bool", args: [] };
              staticClass = undefined;
              known = type !== undefined;
              genericParam = false;
              j = close + 1;
              continue;
            }
            views = this.methodsNamed(staticClass, name);
            self = staticClass;
          } else if (known && type) {
            recv = type;
            const cls = type.name === "$array" ? undefined : type.name;
            if (cls) views = this.methodsNamed(superFrom ?? cls, name);
            self = isThis || superFrom !== undefined ? env.self : (cls ?? env.self);
          }
          const v = this.pick(views, args.length);
          if (v) {
            const target = this.target(
              v,
              v.method.modifiers.includes("static") ? v.declared_in : self,
            );
            record({ file, line: toks[j + 1].line, text, args, target }, j + 1);
            type = this.normalize(this.substitute(parseTypeText(v.method.return_type), recv));
            known = type !== undefined;
          } else {
            record(
              {
                file,
                line: toks[j + 1].line,
                text,
                args,
                unresolved:
                  staticClass !== undefined
                    ? `no method ${name} on class ${staticClass}`
                    : known && type
                      ? `no method ${name} on ${type.name}`
                      : `receiver type unknown`,
              },
              j + 1,
            );
            known = false;
            type = undefined;
          }
          staticClass = undefined;
          superFrom = undefined;
          isThis = false;
          j = close + 1;
        } else {
          // Member variable, constant or enum value.
          if (staticClass !== undefined) {
            const f = this.field(staticClass, name);
            if (f) type = this.normalize(parseTypeText(f.type));
            else if (idx.enums.has(staticClass)) type = { name: staticClass, args: [] };
            else {
              type = undefined;
              known = false;
            }
          } else if (known && type) {
            const f = this.field(type.name, name);
            type = f ? this.normalize(this.substitute(parseTypeText(f.type), type)) : undefined;
            known = type !== undefined;
          } else {
            type = undefined;
            known = false;
          }
          staticClass = undefined;
          superFrom = undefined;
          isThis = false;
          label = `${label}.${name}`;
          j += 2;
        }
      } else if (t.t === "[") {
        const close = matchClose(toks, j);
        if (close < 0) break;
        if (known && type) {
          if (type.name === "$array" || type.name === "array" || type.name === "set")
            type = this.normalize(type.args[0]);
          else if (type.name === "map") type = this.normalize(type.args[1]);
          else if (type.name === "string") type = { name: "string", args: [] };
          else {
            // A container indexed with `[]` (BaseContainerList): what its Get(int) returns.
            const get = this.methodsNamed(type.name, "Get").find((v) => v.method.arity === 1);
            type = get
              ? this.normalize(this.substitute(parseTypeText(get.method.return_type), type))
              : undefined;
          }
          known = type !== undefined;
        }
        j = close + 1;
      } else break;
    }
    return { type: known ? type : undefined, end: j };
  }
}

// ── Entry-point analysis ──────────────────────────────────────────────────────

export type EffectKind = "dialog" | "exit" | "process" | "delete" | "write" | "publish" | "cli";

export interface Effect {
  kind: EffectKind;
  /** `Owner.name` of the call. */
  callee: string;
  /** For a dialog: `user` (waits for the user) or `progress` (WBProgressDialog). */
  dialog?: "user" | "progress";
  depth: number;
  file: string;
  line: number;
  /** Methods from the entry point to the call, `Owner.name` each. */
  path: string[];
  args: string[];
  /** Class whose constants an argument may name (for `cli`). */
  context: string;
}

export interface Unresolved {
  depth: number;
  file: string;
  line: number;
  text: string;
  reason: string;
  path: string[];
}

export interface Reach {
  entry: string;
  effects: Effect[];
  unresolved: Unresolved[];
  /** Resolved calls made. */
  calls: number;
  /** Script calls at the last depth that were not followed. */
  frontier: number;
  /** Script methods whose bodies were searched. */
  bodies: number;
}

const USER_DIALOGS = new Set([
  "Workbench.Dialog",
  "Workbench.ScriptDialog",
  "WorldEditorAPI.ShowItemListDialog",
]);

/** Classifies one resolved call. */
export function effectOf(
  t: CallTarget,
  args: readonly string[],
): Omit<Effect, "depth" | "file" | "line" | "path" | "args" | "context"> | undefined {
  const q = `${t.owner}.${t.name}`;
  if (USER_DIALOGS.has(q)) return { kind: "dialog", callee: q, dialog: "user" };
  if (q === "WBProgressDialog.WBProgressDialog")
    return { kind: "dialog", callee: q, dialog: "progress" };
  if (q === "Workbench.Exit") return { kind: "exit", callee: q };
  if (q === "Workbench.RunCmd" || q === "Workbench.RunProcess")
    return { kind: "process", callee: q };
  if (q === "FileIO.DeleteFile") return { kind: "delete", callee: q };
  if (q === "WBModuleDef.GetCmdLine" || q === "System.GetCLIParam" || q === "System.IsCLIParam")
    return { kind: "cli", callee: q };
  if (t.script) return undefined;
  if (q === "FileIO.OpenFile")
    return /\b(WRITE|APPEND)\b/.test(args[1] ?? "") ? { kind: "write", callee: q } : undefined;
  if (q === "FileIO.CopyFile" || q === "FileIO.MakeDirectory") return { kind: "write", callee: q };
  if (/^Save/.test(t.name)) return { kind: "write", callee: q };
  if (/^(Upload|Publish)/.test(t.name)) return { kind: "publish", callee: q };
  return undefined;
}

/**
 * Searches the calls reachable from `entry` (run on concrete class `self`)
 * to `maxDepth` (default: to closure, guarded by `SEARCH_LIMIT`), breadth first.
 */
export function reachFrom(
  resolver: CallResolver,
  entry: MethodRecord,
  self: string,
  maxDepth = SEARCH_LIMIT,
): Reach {
  const effects: Effect[] = [];
  const unresolved: Unresolved[] = [];
  let calls = 0;
  let frontier = 0;
  const seen = new Set<string>();
  const label = (m: MethodRecord): string => `${m.owner ?? "<global>"}.${m.name}`;
  let layer: { m: MethodRecord; self: string; path: string[] }[] = [
    { m: entry, self, path: [label(entry)] },
  ];
  seen.add(`${entry.file}\u0000${entry.line}\u0000${self}`);
  let bodies = 0;
  for (let depth = 1; depth <= maxDepth && layer.length; depth++) {
    const next: typeof layer = [];
    for (const node of layer) {
      bodies++;
      for (const s of resolver.callSites(node.m, node.self)) {
        if (s.unresolved || !s.target) {
          unresolved.push({
            depth,
            file: s.file,
            line: s.line,
            text: s.text,
            reason: s.unresolved ?? "unresolved",
            path: node.path,
          });
          continue;
        }
        calls++;
        const e = effectOf(s.target, s.args);
        if (e)
          effects.push({
            ...e,
            depth,
            file: s.file,
            line: s.line,
            path: node.path,
            args: s.args,
            context: node.m.owner ?? node.self,
          });
        const r = s.target.record;
        const follow = (m: MethodRecord, self: string): void => {
          const key = `${m.file}\u0000${m.line}\u0000${self}`;
          if (seen.has(key)) return;
          if (depth === maxDepth) {
            frontier++;
            return;
          }
          seen.add(key);
          next.push({ m, self, path: [...node.path, label(m)] });
        };
        if (s.target.script && r) follow(r, s.target.self);
        else if (r && !r.has_body && !isEngine(r) && !r.is_constructor && !r.is_destructor) {
          // A prototype without a body: every override below its class may run.
          const impls = resolver.overridesBelow(s.target.owner, r.name, r.arity);
          if (impls.length === 0)
            unresolved.push({
              depth,
              file: s.file,
              line: s.line,
              text: s.text,
              reason: `${label(r)} is declared without a body and no subclass overrides it`,
              path: node.path,
            });
          for (const o of impls) follow(o.method, o.cls);
        }
      }
    }
    layer = next;
  }
  return { entry: label(entry), effects, unresolved, calls, frontier, bodies };
}

function isEngine(m: MethodRecord): boolean {
  return (
    m.modifiers.includes("proto") ||
    m.modifiers.includes("native") ||
    m.modifiers.includes("external") ||
    /\/generated\/|^scripts\/Core\/proto\//.test(m.file)
  );
}

export type Verdict = "safe" | "modal" | "exits" | "effects" | "unknown" | "no-run";

/** Verdict of a reach (see the file header). */
export function verdictOf(r: Reach | undefined): Verdict {
  if (!r) return "no-run";
  const has = (k: EffectKind): boolean => r.effects.some((e) => e.kind === k);
  if (has("exit")) return "exits";
  if (has("dialog")) return "modal";
  if (has("process") || has("delete")) return "effects";
  if (r.unresolved.length || r.frontier > 0) return "unknown";
  return "safe";
}

/** Shallowest depth of an effect kind, or null. */
export function minDepth(r: Reach | undefined, kind: EffectKind): number | null {
  const d = (r?.effects ?? []).filter((e) => e.kind === kind).map((e) => e.depth);
  return d.length ? Math.min(...d) : null;
}

// ── Command-line arguments ────────────────────────────────────────────────────

export interface CliArg {
  /** Normalised name: one leading `-`. */
  name: string;
  /** The argument expression as written. */
  written: string;
  effect: Effect;
}

/**
 * Command-line arguments a class reads: calls to the command-line readers
 * found from every method of the class and its script ancestors, to
 * `maxDepth`. Names that cannot be evaluated are returned in `unreadable`.
 */
export function cliArgsOf(
  index: SourceIndex,
  resolver: CallResolver,
  cls: string,
  maxDepth = MAX_DEPTH,
): { args: CliArg[]; unreadable: Effect[] } {
  const scope = new Set(scriptChain(index, cls).map((c) => c.name));
  const out = new Map<string, CliArg>();
  const unreadable: Effect[] = [];
  const seenSite = new Set<string>();
  const views = methodsOf(index, cls).filter((v) => scope.has(v.declared_in) && v.method.has_body);
  for (const v of views) {
    const r = reachFrom(resolver, v.method, cls, maxDepth);
    for (const e of r.effects) {
      if (e.kind !== "cli") continue;
      const k = `${e.file}\u0000${e.line}\u0000${e.args[0] ?? ""}`;
      if (seenSite.has(k)) continue;
      seenSite.add(k);
      const written = e.args[0] ?? "";
      const value = evalStringExpr(written, constantResolver(index, [e.context, cls]));
      if (value === undefined || value.trim() === "" || /\s/.test(value)) {
        unreadable.push(e);
        continue;
      }
      const name = `-${value.replace(/^-+/, "")}`;
      const prev = out.get(name);
      const better =
        !prev ||
        e.depth < prev.effect.depth ||
        (e.depth === prev.effect.depth &&
          compareCodeUnits(
            `${e.file}#${String(e.line).padStart(8, "0")}`,
            `${prev.effect.file}#${String(prev.effect.line).padStart(8, "0")}`,
          ) < 0);
      if (better) out.set(name, { name, written, effect: e });
    }
  }
  return {
    args: [...out.values()].sort((a, b) => compareCodeUnits(a.name, b.name)),
    unreadable,
  };
}

// ── Whole-class analysis ──────────────────────────────────────────────────────

export interface ClassAnalysis {
  cls: PluginClass;
  overrides: Override[];
  run?: Reach;
  configure?: Reach;
  runCommandline?: Reach;
  /**
   * The other entry points searched for Workbench.Exit and file deletion: the
   * remaining framework event overrides and the button methods.
   */
  others: Reach[];
  verdict: Verdict;
  /** `opens` when Run reaches a dialog; `none` when its search was complete and found none; else undefined. */
  modal?: "none" | "opens";
  risk_hint?: "destructive" | "external" | "mutating";
  settings: SettingMember[];
  buttons: ButtonMethod[];
  cli: CliArg[];
  cliUnreadable: Effect[];
  /** Plain statements for the row's `unverified` list. */
  unverified: string[];
}

const where = (x: { file: string; line: number }): string => pakRef(x);

/**
 * Analyses one plugin or tool class. `searchDepth` bounds the classification
 * search (default: closure, guarded by `SEARCH_LIMIT`); `cliDepth` bounds the
 * command-line reads (default `MAX_DEPTH`).
 */
export function analyzeClass(
  index: SourceIndex,
  resolver: CallResolver,
  cls: PluginClass,
  searchDepth = SEARCH_LIMIT,
  cliDepth = MAX_DEPTH,
): ClassAnalysis {
  const overrides = overridesOf(index, cls.name);
  const ov = (name: string): Override | undefined =>
    overrides.find((o) => o.method === name && o.arity === 0);
  const runO = ov("Run");
  const run = runO ? reachFrom(resolver, runO.record, cls.name, searchDepth) : undefined;
  const cfgO = ov("Configure");
  const configure = cfgO ? reachFrom(resolver, cfgO.record, cls.name, searchDepth) : undefined;
  const cliO = ov("RunCommandline");
  const runCommandline = cliO ? reachFrom(resolver, cliO.record, cls.name, searchDepth) : undefined;
  const others: Reach[] = [];
  for (const o of overrides)
    if (o !== runO && o !== cfgO && o !== cliO)
      others.push(reachFrom(resolver, o.record, cls.name, searchDepth));
  const buttons = buttonMethods(index, cls.name);
  for (const b of buttons)
    if (b.method.has_body) others.push(reachFrom(resolver, b.method, cls.name, searchDepth));
  const verdict = verdictOf(run);
  const unverified: string[] = [];
  let modal: ClassAnalysis["modal"];
  let risk: ClassAnalysis["risk_hint"];
  const limit = searchDepth >= SEARCH_LIMIT ? "to closure" : `to call depth ${searchDepth}`;
  if (run) {
    const dialog = run.effects.filter((e) => e.kind === "dialog");
    if (dialog.length) modal = "opens";
    else if (run.unresolved.length === 0 && run.frontier === 0) modal = "none";
    const has = (k: EffectKind): boolean => run.effects.some((e) => e.kind === k);
    if (has("exit") || has("delete")) risk = "destructive";
    else if (has("publish")) risk = "external";
    else if (dialog.some((e) => e.depth === 1)) risk = "mutating";
    if (run.unresolved.length) {
      const u = run.unresolved[0];
      const found =
        verdict === "unknown"
          ? "Run() reaches no modal dialog, Workbench.Exit, external process or file deletion that the analysis could resolve"
          : `Run() is classified ${verdict}`;
      unverified.push(
        `${found} (calls followed ${limit}), but ${run.unresolved.length} call(s) did not resolve in the source index (first: ${u.text} at ${where(u)}: ${u.reason}); ${verdict === "unknown" ? "not classified safe" : "the unresolved calls may add more"}`,
      );
    }
    if (run.frontier > 0)
      unverified.push(
        `Run() was searched to call depth ${searchDepth} only: ${run.frontier} script call(s) below that depth were not followed; ${dialog.length ? "further dialogs or effects may sit below" : "modal not stated, not classified safe"}`,
      );
  }
  // Exit or deletion reached from another entry point: destructive, and said so.
  if (risk !== "destructive") {
    const entries = [
      ...(configure ? [configure] : []),
      ...(runCommandline ? [runCommandline] : []),
      ...others,
    ];
    for (const r of entries) {
      const e = r.effects.find((x) => x.kind === "exit" || x.kind === "delete");
      if (!e) continue;
      risk = "destructive";
      unverified.push(
        `risk_hint destructive from ${r.entry}(), not from Run(): it reaches ${e.callee} at ${where(e)} (call depth ${e.depth}, via ${e.path.join(" > ")})`,
      );
      break;
    }
  }
  if (
    configure &&
    configure.unresolved.length &&
    !configure.effects.some((e) => e.kind === "dialog")
  )
    unverified.push(
      `Configure() opens no dialog that the analysis could resolve, but ${configure.unresolved.length} call(s) did not resolve`,
    );
  if (cls.unreadable.length)
    unverified.push(
      `attribute argument(s) not evaluated from the source: ${cls.unreadable.join(", ")}`,
    );
  const cli = cliArgsOf(index, resolver, cls.name, cliDepth);
  if (cli.unreadable.length)
    unverified.push(
      `${cli.unreadable.length} command-line read(s) with a name the analysis could not evaluate (first: ${cli.unreadable[0].callee}(${cli.unreadable[0].args[0] ?? ""}) at ${where(cli.unreadable[0])})`,
    );
  return {
    cls,
    overrides,
    run,
    configure,
    runCommandline,
    others,
    verdict,
    modal,
    risk_hint: risk,
    settings: settingMembers(index, cls.name),
    buttons,
    cli: cli.args,
    cliUnreadable: cli.unreadable,
    unverified,
  };
}

/** One-sentence `what` from a button method's doc comment. */
export function buttonWhat(b: ButtonMethod): string | undefined {
  return firstSentence(b.method.doc);
}
