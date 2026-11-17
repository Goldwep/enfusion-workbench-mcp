/**
 * E11 — MCP self-inventory (plan 4.5). Static, offline, no model.
 *
 * Reads the server's own source and writes `data/census/observations/E11/<build>.jsonl`:
 *
 *   mcp-tool        one row per tool the server registers (key {tool})
 *   mcp-action      one row per action of a multiplexed tool (key {tool, action}); a tool with
 *                   no action parameter gets one row whose action is "run", so every tool has
 *                   at least one action row (plan gate G8 links coverage at action level)
 *   handler-action  one row per action a Workbench-side Enforce handler dispatches
 *                   (key {handler, action}; handler = the NetApiHandler class name); a handler
 *                   whose request carries no action string gets one row whose action is "run"
 *
 * INPUTS (all under the repository root, never the game or Tools install):
 *   src/server.ts            which register functions the server calls (reachability, so the
 *                            tool count is "what the server registers", not "what grep finds")
 *   src/tools/*.ts           registerTool calls: name, description, zod input schema, the values
 *                            of the dispatch parameter (action / operation / op / command / mode /
 *                            subcommand / scope; first one present in that priority wins), and
 *                            every `client.call("<handler>", {...})` site with the action it sends
 *   mod/**\/*.c              classes deriving from NetApiHandler: their `req.action == "x"` /
 *                            `case "x"` dispatch, and the API calls each branch makes
 *
 * HOW THE TOOL SIDE IS READ: with the TypeScript compiler API (comments and strings are not
 * mistaken for code, which a regex count cannot promise). Descriptions and enum arrays that are
 * built from concatenation, same-file constants or `as const` arrays are folded.
 *
 * COVERS (`covers_proposed`, E11 only): a pure function of (repository source, set of known row
 * ids). A handler-action proposes `api:<Class>.<Method>/<arity>` for every call its branch (and the
 * helpers the branch calls) makes on a variable of a script class or on a static class; an
 * mcp-action proposes `mcp:handler-action/<Class>.<action>` and `net:handler/<Class>` for the
 * handler action(s) its call sites send to. Only ids that exist as rows survive: the rows of
 * E02..E05 under data/census/observations/ at run time (read, ids derived with deriveId) and the
 * rows E11 itself emits. The full table, survivors and dropped ids alike, goes to the artifacts
 * folder (census/<build>/E11/covers-proposed.json) so a later run can be compared.
 *
 *   npx tsx scripts/census/enumerators/e11-mcp-inventory.ts [--build <tag>] [--data <dir>]
 *       [--repo <dir>] [--out <file under observations/E11/>] [--artifacts <dir>]
 *       [--no-modules] [--json]
 *
 * --repo       repository whose sources are read (default: the census root's repository)
 * --artifacts  artifacts folder (default: artifactsDir() from scripts/live/paths.ts)
 * --no-modules    emit module "none" on every row (by default handler-action rows carry the module
 *                 their source names and tool / action rows the module their handlers reach, see
 *                 Modules below)
 *
 * Exit: 0 written; 1 refused (output outside observations/E11/); 2 usage or no sources
 * (NO DATA); 3 malformed census configuration.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import ts from "typescript";
import {
  compareCodeUnits,
  formatJson,
  jsonlLine,
  sha256,
  splitLines,
} from "../../../src/census/canon.js";
import { loadCurrentBuild } from "../../../src/census/census-config.js";
import { allStrings, containsMachinePath } from "../../../src/census/hygiene.js";
import { deriveId } from "../../../src/census/ids.js";
import { writeFileAtomic, type CensusPaths } from "../../../src/census/ledger-io.js";
import { observationSchema, type Observation } from "../../../src/census/schemas.js";
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

/** Enumerator id (main ruling 11). */
export const ENUMERATOR_ID = "E11";
/** Registered generator path (must equal universes.json `enumerators.E11.generator`). */
export const GENERATOR = "scripts/census/enumerators/e11-mcp-inventory.ts";
/** Enumerators whose rows `covers_proposed` may name (plus E11's own). */
export const COVER_SOURCES: readonly string[] = ["E02", "E03", "E04", "E05"];
/** Names of the tool parameter that selects the action, in priority order. */
export const ACTION_PARAMS: readonly string[] = [
  "action",
  "operation",
  "op",
  "command",
  "mode",
  "subcommand",
  "scope",
  // wb_cli_run dispatches on `verb` (DEC-056 ruling 12, G8 E1).
  "verb",
];
const QUOTE_MAX = 200;
const RUN = "run";

// ── Modules ───────────────────────────────────────────────────────────────────
//
// PLAN 4.3 only lists the allowed values of `module`; it gives no derivation rule. E11's rules
// (module `none` means "this source does not say", DEC-020 and the ledger rules after it):
//   handler-action  the module the handler's own source obtains with `Workbench.GetModule(X)`
//                   (comments ignored): exactly one distinct X names it, none or several give
//                   `none`. A fact read from the handler, applied the same way to every handler.
//   mcp-tool,       derived by one rule from the call sites, not from a list of tool names: a tool
//   mcp-action      whose every handler call goes to Enforce handlers of this mod that each reach
//                   the same single module (the handler-action rule above) gets that module;
//                   any other tool gets `none`: it calls no handler, it calls a Bohemia built-in
//                   handler (its source is not in this repository, so the module it reaches is not
//                   stated), it names a handler the mod does not define, or its handlers reach
//                   different modules or none. An action row carries its tool's module.
//                   --no-modules turns every module back into `none`.

/** Module of a handler from the distinct `GetModule(X)` classes its source names. */
export function handlerModule(getModuleClasses: readonly string[]): string {
  const distinct = [...new Set(getModuleClasses)];
  return distinct.length === 1 ? distinct[0] : "none";
}

export type ToolModuleReason =
  | "single-module"
  | "no-handler-call"
  | "builtin-handler"
  | "handler-not-in-mod"
  | "handler-names-no-single-module"
  | "handlers-span-modules";

export interface ToolModuleInfo {
  tool: string;
  module: string;
  reason: ToolModuleReason;
  /** Distinct handlers the tool's call sites name, in code-unit order. */
  handlers: string[];
}

/**
 * The module a tool reaches from the handlers its call sites name. `handlerModules` maps each
 * Enforce handler class of the mod to `handlerModule(...)` of its source; a call to a built-in
 * handler or to a name the mod does not define has no entry and so reaches no stated module.
 */
export function deriveToolModule(
  tool: string,
  calls: readonly { handler: string; builtin: boolean }[],
  handlerModules: ReadonlyMap<string, string>,
): ToolModuleInfo {
  const handlers = [...new Set(calls.map((c) => c.handler))].sort(compareCodeUnits);
  const info = (module: string, reason: ToolModuleReason): ToolModuleInfo => ({
    tool,
    module,
    reason,
    handlers,
  });
  if (calls.length === 0) return info("none", "no-handler-call");
  if (calls.some((c) => c.builtin)) return info("none", "builtin-handler");
  const mods = handlers.map((h) => handlerModules.get(h));
  if (mods.some((m) => m === undefined)) return info("none", "handler-not-in-mod");
  const distinct = [...new Set(mods as string[])];
  if (distinct.length > 1) return info("none", "handlers-span-modules");
  return distinct[0] === "none"
    ? info("none", "handler-names-no-single-module")
    : info(distinct[0], "single-module");
}

// ── Sources ───────────────────────────────────────────────────────────────────

export interface SourceFile {
  /** Repository-relative path with forward slashes. */
  rel: string;
  text: string;
  sha256: string;
}

export interface RepoSources {
  server: SourceFile | null;
  /** `src/tools/*.ts`. */
  tools: SourceFile[];
  /** `mod/**\/*.c`. */
  handlers: SourceFile[];
  /** `src/manifest/aliases.ts`: the 1.x alias route table (ALIAS_ROUTES), when present. */
  aliases?: SourceFile | null;
  /** `contracts/*.json` (not `_schema/`): the Phase 3 handler contracts, when the repository has them. */
  contracts?: SourceFile[];
  /** `.registerTool(` text matches in the rest of `src/` (what count-inventory.ts also counts). */
  otherSrcMatches: { rel: string; count: number }[];
}

function walk(dir: string, accept: (rel: string) => boolean, base: string, out: string[]): void {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "dist" || e.name === ".git") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, accept, base, out);
    else {
      const rel = relative(base, p).split(sep).join("/");
      if (accept(rel)) out.push(rel);
    }
  }
}

function readSource(repo: string, rel: string): SourceFile {
  const buf = readFileSync(join(repo, rel));
  return { rel, text: buf.toString("utf-8"), sha256: sha256(buf) };
}

/** Reads the three kinds of input from a repository root. */
export function readRepoSources(repo: string): RepoSources {
  const srcRels: string[] = [];
  walk(
    join(repo, "src"),
    (r) => r.endsWith(".ts") && !r.endsWith(".d.ts") && !/\.(test|spec)\.ts$/.test(r),
    repo,
    srcRels,
  );
  srcRels.sort(compareCodeUnits);
  const modRels: string[] = [];
  walk(join(repo, "mod"), (r) => r.endsWith(".c"), repo, modRels);
  modRels.sort(compareCodeUnits);
  const tools: SourceFile[] = [];
  const otherSrcMatches: { rel: string; count: number }[] = [];
  let server: SourceFile | null = null;
  for (const rel of srcRels) {
    if (rel === "src/server.ts") {
      server = readSource(repo, rel);
    } else if (posix.dirname(rel) === "src/tools") {
      tools.push(readSource(repo, rel));
    } else {
      const count = (readFileSync(join(repo, rel), "utf-8").match(/\.registerTool\(/g) ?? [])
        .length;
      if (count > 0) otherSrcMatches.push({ rel, count });
    }
  }
  const contractRels: string[] = [];
  walk(join(repo, "contracts"), (r) => /^contracts\/[^/]+\.json$/.test(r), repo, contractRels);
  contractRels.sort(compareCodeUnits);
  const aliases = existsSync(join(repo, "src", "manifest", "aliases.ts"))
    ? readSource(repo, "src/manifest/aliases.ts")
    : null;
  return {
    server,
    tools,
    aliases,
    contracts: contractRels.map((r) => readSource(repo, r)),
    handlers: modRels.map((r) => readSource(repo, r)),
    otherSrcMatches,
  };
}

// ── Text helpers ──────────────────────────────────────────────────────────────

/** First sentence of a description (a period inside brackets, backticks or `e.g.` does not end it). */
export function firstSentence(text: string, requireTerminator = false): string | undefined {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return undefined;
  let depth = 0;
  let tick = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === "`") {
      tick = !tick;
      continue;
    }
    if (tick) continue;
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth = Math.max(0, depth - 1);
    else if (
      depth === 0 &&
      (c === "." || c === "!" || c === "?") &&
      (i === t.length - 1 || /\s/.test(t[i + 1]))
    ) {
      if (/(?:\be\.g|\bi\.e|\bvs|\betc)$/i.test(t.slice(0, i))) continue;
      return t.slice(0, i + 1);
    }
  }
  return requireTerminator ? undefined : t;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The part of a parameter description that belongs to one action, when the text gives it a
 * clause of its own: `lit (text)`, `lit: text`, `'lit' text`. Returns undefined otherwise
 * (a description of the whole parameter is not the action's own description).
 */
export function actionWhat(describe: string | undefined, lit: string): string | undefined {
  if (!describe) return undefined;
  const d = describe.replace(/\s+/g, " ");
  const q = "['\"`]?";
  const L = escapeRe(lit);
  const b = "(?<![\\w/])";
  const e = "(?![\\w/])";
  const tries: RegExp[] = [
    new RegExp(`${b}${q}${L}${q}${e}(?:\\s*\\([^)]*\\))?\\s*:\\s*([^.;]+?)(?=\\.\\s|\\.$|;|$)`),
    new RegExp(`${b}${q}${L}${q}${e}\\s*\\(([^()]{3,}?)\\)`),
    new RegExp(`${b}['"\`]${L}['"\`]\\s+([^,.;]+)`),
  ];
  for (const re of tries) {
    const m = re.exec(d);
    const text = m?.[1]?.trim();
    if (text && text.length >= 3) return text;
  }
  return undefined;
}

function lineQuote(lines: readonly string[], line: number): string | undefined {
  const t = (lines[line - 1] ?? "").trim().slice(0, QUOTE_MAX);
  return t === "" ? undefined : t;
}

// ── TypeScript side ───────────────────────────────────────────────────────────

interface Ctx {
  rel: string;
  sf: ts.SourceFile;
  lines: string[];
}

function mkCtx(f: SourceFile): Ctx {
  return {
    rel: f.rel,
    sf: ts.createSourceFile(f.rel, f.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS),
    lines: splitLines(f.text),
  };
}

function lineOf(ctx: Ctx, node: ts.Node): number {
  return ctx.sf.getLineAndCharacterOfPosition(node.getStart(ctx.sf)).line + 1;
}

function unwrap(e: ts.Expression): ts.Expression {
  let x = e;
  for (;;) {
    if (
      ts.isParenthesizedExpression(x) ||
      ts.isAsExpression(x) ||
      ts.isSatisfiesExpression(x) ||
      ts.isNonNullExpression(x) ||
      ts.isTypeAssertionExpression(x)
    )
      x = x.expression;
    else return x;
  }
}

/** The initializer of the nearest `const|let name = ...` visible from `id` (block and file scope only). */
function findVarInit(id: ts.Identifier): ts.Expression | undefined {
  let n: ts.Node | undefined = id.parent;
  while (n) {
    if (ts.isBlock(n) || ts.isSourceFile(n) || ts.isModuleBlock(n)) {
      for (const st of n.statements) {
        if (!ts.isVariableStatement(st)) continue;
        for (const d of st.declarationList.declarations) {
          if (ts.isIdentifier(d.name) && d.name.text === id.text && d.initializer)
            return d.initializer;
        }
      }
    }
    n = n.parent;
  }
  return undefined;
}

/** Folds an expression to its possible string values, or null when it is not a constant. */
export function evalStrings(expr: ts.Expression, depth = 0): string[] | null {
  if (depth > 6) return null;
  const e = unwrap(expr);
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return [e.text];
  if (ts.isTemplateExpression(e)) {
    let acc: string[] = [e.head.text];
    for (const span of e.templateSpans) {
      const v = evalStrings(span.expression, depth + 1);
      if (!v) return null;
      acc = acc.flatMap((a) => v.map((x) => a + x + span.literal.text));
    }
    return acc;
  }
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const l = evalStrings(e.left, depth + 1);
    const r = evalStrings(e.right, depth + 1);
    if (!l || !r) return null;
    return l.flatMap((a) => r.map((b) => a + b));
  }
  if (ts.isConditionalExpression(e)) {
    const a = evalStrings(e.whenTrue, depth + 1);
    const b = evalStrings(e.whenFalse, depth + 1);
    if (!a || !b) return null;
    return [...new Set([...a, ...b])];
  }
  if (ts.isIdentifier(e)) {
    const init = findVarInit(e);
    return init ? evalStrings(init, depth + 1) : null;
  }
  return null;
}

/**
 * The constant text of an expression up to its first non-constant part (`a + b + \`${x}\``).
 * `complete` is false when a non-constant part follows the returned text.
 */
export function evalPrefix(expr: ts.Expression, depth = 0): { text: string; complete: boolean } {
  const whole = evalStrings(expr);
  if (whole) return { text: whole[0], complete: true };
  if (depth > 12) return { text: "", complete: false };
  const e = unwrap(expr);
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const l = evalPrefix(e.left, depth + 1);
    if (!l.complete) return l;
    const r = evalPrefix(e.right, depth + 1);
    return { text: l.text + r.text, complete: r.complete };
  }
  if (ts.isTemplateExpression(e)) {
    let text = e.head.text;
    for (const span of e.templateSpans) {
      const v = evalStrings(span.expression);
      if (!v) return { text, complete: false };
      text += v[0] + span.literal.text;
    }
    return { text, complete: true };
  }
  return { text: "", complete: false };
}

/** First sentence of a tool description, or undefined when the sentence is cut by a non-constant part. */
export function descriptionWhat(expr: ts.Expression): string | undefined {
  const p = evalPrefix(expr);
  return firstSentence(p.text, !p.complete);
}

interface ActionValue {
  value: string;
  line: number;
  /**
   * A 1.x action that a contract tool keeps beside its contract actions (a top-level
   * `LEGACY_*ACTIONS` string array in the tool file): its line is in the tool file and its call
   * sites are read the way a plain tool's are, not through the contract.
   */
  own?: boolean;
}

/** String elements (with their lines) of an array literal, a same-file const array, or `new Set([...])`. */
function arrayStrings(expr: ts.Expression, ctx: Ctx, depth = 0): ActionValue[] | null {
  if (depth > 4) return null;
  const e = unwrap(expr);
  if (ts.isArrayLiteralExpression(e)) {
    const out: ActionValue[] = [];
    for (const el of e.elements) {
      if (ts.isSpreadElement(el)) {
        const inner = arrayStrings(el.expression, ctx, depth + 1);
        if (inner === null) return null;
        out.push(...inner);
        continue;
      }
      // A string literal, or an identifier whose initialiser is one (`PLUGIN_VERB`).
      let u = unwrap(el);
      if (ts.isIdentifier(u)) {
        const init = findVarInit(u);
        if (init) u = unwrap(init);
      }
      const v = ts.isStringLiteralLike(u) ? u.text : null;
      if (v === null) return null;
      // The ref points at the literal itself, so the quote holds it.
      out.push({ value: v, line: lineOf(ctx, u) });
    }
    return out;
  }
  if (ts.isIdentifier(e)) {
    const init = findVarInit(e);
    return init ? arrayStrings(init, ctx, depth + 1) : null;
  }
  if (ts.isNewExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === "Set") {
    const a = e.arguments?.[0];
    return a ? arrayStrings(a, ctx, depth + 1) : null;
  }
  return null;
}

interface ToolParam {
  name: string;
  values: ActionValue[];
  describe?: string;
  /**
   * Set when the values come from a handler contract (the tool's request schema is generated by
   * buildRequestSchema, so the file holds no literal enum): `line` of each value is in that file.
   */
  contract?: { rel: string; handler: string; lines: string[] };
}

/** Handler class of the contract whose `tool` is `tool`. */
function contractHandlerOf(
  tool: string,
  contracts: readonly SourceFile[] | undefined,
): string | undefined {
  for (const c of contracts ?? []) {
    try {
      const j = JSON.parse(c.text) as { tool?: unknown; handler?: unknown };
      if (j.tool === tool && typeof j.handler === "string") return j.handler;
    } catch {
      /* not a contract */
    }
  }
  return undefined;
}

/**
 * Fallback for a tool whose inputSchema is not an object literal (a shape built elsewhere): the
 * file's top-level `const ACTIONS = [...]` array (spreads of other const arrays folded), when the
 * file also passes it to `z.enum(ACTIONS)`.
 */
function actionsConstParam(ctx: Ctx): ToolParam | undefined {
  if (!/z\.enum\(\s*ACTIONS\s*\)/.test(ctx.lines.join("\n"))) return undefined;
  for (const st of ctx.sf.statements) {
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) {
      if (!ts.isIdentifier(d.name) || d.name.text !== "ACTIONS" || !d.initializer) continue;
      const vals = arrayStrings(d.initializer, ctx);
      if (!vals || vals.length === 0) continue;
      const seen = new Set<string>();
      return {
        name: "action",
        values: vals.filter((v) => !seen.has(v.value) && seen.add(v.value)),
      };
    }
  }
  return undefined;
}

/**
 * Resolves a generated request schema to its contract. A tool file qualifies when it builds its
 * schema from a contract (text names `buildRequestSchema`, `loadContract` or `parseContract`);
 * the contract is the one whose `tool` is the registered name and whose `handler` the file names.
 * Action names are the contract's `actions[].name`, each with the line of its `"name"` in the JSON.
 */
function contractParam(
  toolName: string,
  fileText: string,
  contracts: readonly SourceFile[] | undefined,
  ctx?: Ctx,
): ToolParam | undefined {
  if (!contracts || !/\b(buildRequestSchema|loadContract|parseContract)\b/.test(fileText))
    return undefined;
  for (const c of contracts) {
    let j: { handler?: unknown; tool?: unknown; actions?: unknown };
    try {
      j = JSON.parse(c.text);
    } catch {
      continue;
    }
    if (j.tool !== toolName || typeof j.handler !== "string" || !Array.isArray(j.actions)) continue;
    if (!fileText.includes(j.handler)) continue;
    const lines = splitLines(c.text);
    const start = Math.max(
      0,
      lines.findIndex((l) => /^\s*"actions"\s*:/.test(l)),
    );
    const values: ActionValue[] = [];
    // Contract actions another tool sends (a top-level `OTHER_TOOL_ACTIONS` array in the tool
    // file): the tool does not offer them, so they are not its values.
    const others = new Set((ctx ? otherToolActions(ctx) : []).map((v) => v.value));
    let at = start;
    for (const a of j.actions as { name?: unknown }[]) {
      if (typeof a.name !== "string" || others.has(a.name)) continue;
      const want = `"name": ${JSON.stringify(a.name)}`;
      const i = lines.findIndex((l, k) => k >= at && l.includes(want));
      if (i < 0) continue;
      at = i + 1;
      if (!values.some((v) => v.value === a.name)) values.push({ value: a.name, line: i + 1 });
    }
    if (values.length === 0) continue;
    for (const v of ctx ? legacyActions(ctx) : []) {
      if (!values.some((x) => x.value === v.value)) values.push({ ...v, own: true });
    }
    return { name: "action", values, contract: { rel: c.rel, handler: j.handler, lines } };
  }
  return undefined;
}

/** String values of the top-level `LEGACY_*ACTIONS` arrays of a contract tool file (1.x actions kept). */
function legacyActions(ctx: Ctx): ActionValue[] {
  const out: ActionValue[] = [];
  for (const st of ctx.sf.statements) {
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) {
      if (!ts.isIdentifier(d.name) || !/^LEGACY_[A-Z_]*ACTIONS$/.test(d.name.text)) continue;
      if (d.initializer) out.push(...(arrayStrings(d.initializer, ctx) ?? []));
    }
  }
  return out;
}

/** String values of the top-level `OTHER_TOOL_ACTIONS` array of a contract tool file. */
function otherToolActions(ctx: Ctx): ActionValue[] {
  const out: ActionValue[] = [];
  for (const st of ctx.sf.statements) {
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) {
      if (!ts.isIdentifier(d.name) || d.name.text !== "OTHER_TOOL_ACTIONS") continue;
      if (d.initializer) out.push(...(arrayStrings(d.initializer, ctx) ?? []));
    }
  }
  return out;
}

/** The unwrapped initializer of a top-level `const <name> = ...` in this file, if any. */
function topLevelConstInit(sf: ts.SourceFile, name: string): ts.Expression | undefined {
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) {
      if (ts.isIdentifier(d.name) && d.name.text === name && d.initializer)
        return unwrap(d.initializer);
    }
  }
  return undefined;
}

/** The dispatch parameter of an inputSchema object literal (first of ACTION_PARAMS that is a z.enum). */
function findActionParam(schema: ts.ObjectLiteralExpression, ctx: Ctx): ToolParam | undefined {
  for (const wanted of ACTION_PARAMS) {
    for (const p of schema.properties) {
      if (!ts.isPropertyAssignment(p)) continue;
      const nm = ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : null;
      if (nm !== wanted) continue;
      let values: ActionValue[] | null = null;
      let describe: string | undefined;
      const visit = (n: ts.Node): void => {
        if (
          ts.isCallExpression(n) &&
          ts.isPropertyAccessExpression(n.expression) &&
          n.expression.name.text === "enum" &&
          n.arguments[0]
        ) {
          values = arrayStrings(n.arguments[0], ctx);
        }
        if (
          ts.isCallExpression(n) &&
          ts.isPropertyAccessExpression(n.expression) &&
          n.expression.name.text === "describe" &&
          n.arguments[0]
        ) {
          describe = evalStrings(n.arguments[0])?.[0];
        }
        ts.forEachChild(n, visit);
      };
      visit(p.initializer);
      if (values && (values as ActionValue[]).length > 0) {
        const seen = new Set<string>();
        const dedup = (values as ActionValue[]).filter(
          (v) => !seen.has(v.value) && seen.add(v.value),
        );
        return { name: wanted, values: dedup, describe };
      }
    }
  }
  return undefined;
}

// ── Call sites ────────────────────────────────────────────────────────────────

interface Sent {
  lits: string[];
  pass: boolean;
  unknown: boolean;
  /** An `action` key was found at all. */
  present: boolean;
  /** Every key of the request object that could be read. */
  keys: string[];
}

interface CallSite {
  handler: string;
  builtin: boolean;
  line: number;
  sent: Sent;
  /** Tool actions this site is inside an `if (action === ...)` branch of, or null. */
  narrowing: string[] | null;
  /** Tool actions an earlier early-returning branch already took. */
  excluded: string[];
  /** Keys of the request object, when it is an object literal. */
  requestKeys: string[];
}

function evalSent(expr: ts.Expression, vars: Set<string>, sent: Sent): void {
  const e = unwrap(expr);
  if (ts.isIdentifier(e) && vars.has(e.text)) {
    sent.pass = true;
    return;
  }
  if (ts.isConditionalExpression(e)) {
    evalSent(e.whenTrue, vars, sent);
    evalSent(e.whenFalse, vars, sent);
    return;
  }
  const v = evalStrings(e);
  if (v) sent.lits.push(...v);
  else sent.unknown = true;
}

function sentFromObject(obj: ts.ObjectLiteralExpression, vars: Set<string>, sent: Sent): void {
  for (const p of obj.properties) {
    if (p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)))
      sent.keys.push(p.name.text);
    if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === "action") {
      sent.present = true;
      evalSent(p.initializer, vars, sent);
    } else if (ts.isShorthandPropertyAssignment(p) && p.name.text === "action") {
      sent.present = true;
      sent.pass = true;
    } else if (ts.isSpreadAssignment(p)) {
      sentFromExpr(p.expression, vars, sent, 1);
    }
  }
}

function enclosingFunction(n: ts.Node): ts.Node {
  let x: ts.Node | undefined = n.parent;
  while (x && !ts.isSourceFile(x)) {
    if (
      ts.isFunctionDeclaration(x) ||
      ts.isArrowFunction(x) ||
      ts.isFunctionExpression(x) ||
      ts.isMethodDeclaration(x)
    )
      return x;
    x = x.parent;
  }
  return n.getSourceFile();
}

function sentFromExpr(expr: ts.Expression, vars: Set<string>, sent: Sent, depth: number): void {
  if (depth > 3) {
    sent.unknown = true;
    return;
  }
  const e = unwrap(expr);
  if (ts.isObjectLiteralExpression(e)) {
    sentFromObject(e, vars, sent);
    return;
  }
  if (ts.isIdentifier(e)) {
    const init = findVarInit(e);
    if (init) sentFromExpr(init, vars, sent, depth + 1);
    // `params.action = ...` assignments in the same function
    const scope = enclosingFunction(e);
    const visit = (n: ts.Node): void => {
      if (
        ts.isBinaryExpression(n) &&
        n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isPropertyAccessExpression(n.left) &&
        ts.isIdentifier(n.left.expression) &&
        n.left.expression.text === e.text
      ) {
        sent.keys.push(n.left.name.text);
        if (n.left.name.text === "action") {
          sent.present = true;
          evalSent(n.right, vars, sent);
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(scope);
    if (!init && !sent.present) sent.unknown = true;
    return;
  }
  sent.unknown = true;
}

/** Literal values a condition restricts the action to, or null when it is not such a test. */
function condLits(
  expr: ts.Expression,
  vars: Set<string>,
  ctx: Ctx,
  exact = false,
): string[] | null {
  const e = unwrap(expr);
  const isVar = (x: ts.Expression): boolean => {
    const u = unwrap(x);
    return (
      (ts.isIdentifier(u) && vars.has(u.text)) ||
      (ts.isPropertyAccessExpression(u) && vars.has(u.name.text))
    );
  };
  if (ts.isBinaryExpression(e)) {
    const op = e.operatorToken.kind;
    if (op === ts.SyntaxKind.EqualsEqualsEqualsToken || op === ts.SyntaxKind.EqualsEqualsToken) {
      const other = isVar(e.left) ? e.right : isVar(e.right) ? e.left : null;
      return other ? evalStrings(other) : null;
    }
    if (op === ts.SyntaxKind.BarBarToken) {
      const a = condLits(e.left, vars, ctx, exact);
      const b = condLits(e.right, vars, ctx, exact);
      return a && b ? [...new Set([...a, ...b])] : null;
    }
    if (op === ts.SyntaxKind.AmpersandAmpersandToken) {
      const a = condLits(e.left, vars, ctx, exact);
      const b = condLits(e.right, vars, ctx, exact);
      if (a && b) return a.filter((x) => b.includes(x));
      // `action === "x" && other` narrows the branch, but a guard that returns on it
      // excludes nothing for sure: only an exact test excludes.
      return exact ? null : (a ?? b);
    }
    return null;
  }
  if (
    ts.isCallExpression(e) &&
    ts.isPropertyAccessExpression(e.expression) &&
    (e.expression.name.text === "includes" || e.expression.name.text === "has") &&
    e.arguments[0] &&
    isVar(e.arguments[0])
  ) {
    return arrayStrings(e.expression.expression, ctx)?.map((v) => v.value) ?? null;
  }
  return null;
}

function alwaysExits(st: ts.Statement): boolean {
  if (ts.isReturnStatement(st) || ts.isThrowStatement(st)) return true;
  if (ts.isBlock(st)) {
    const last = st.statements[st.statements.length - 1];
    return last !== undefined && alwaysExits(last);
  }
  return false;
}

function narrowAndExclude(
  call: ts.Node,
  boundary: ts.Node,
  vars: Set<string>,
  ctx: Ctx,
): { narrowing: string[] | null; excluded: string[] } {
  let narrowing: string[] | null = null;
  const excluded: string[] = [];
  let child: ts.Node = call;
  let p: ts.Node | undefined = call.parent;
  while (p && child !== boundary) {
    if (ts.isIfStatement(p) && child === p.thenStatement) {
      const l = condLits(p.expression, vars, ctx);
      if (l) narrowing = narrowing ? narrowing.filter((x) => l.includes(x)) : l;
    } else if (ts.isConditionalExpression(p) && child === p.whenTrue) {
      const l = condLits(p.condition, vars, ctx);
      if (l) narrowing = narrowing ? narrowing.filter((x) => l.includes(x)) : l;
    } else if (ts.isCaseClause(p)) {
      const sw = p.parent.parent;
      if (ts.isSwitchStatement(sw)) {
        const subj = unwrap(sw.expression);
        if (
          (ts.isIdentifier(subj) && vars.has(subj.text)) ||
          (ts.isPropertyAccessExpression(subj) && vars.has(subj.name.text))
        ) {
          const l = evalStrings(p.expression);
          if (l) narrowing = narrowing ? narrowing.filter((x) => l.includes(x)) : l;
        }
      }
    } else if (ts.isBlock(p) || ts.isSourceFile(p)) {
      for (const st of p.statements) {
        if (st === child) break;
        if (ts.isIfStatement(st) && !st.elseStatement && alwaysExits(st.thenStatement)) {
          const l = condLits(st.expression, vars, ctx, true);
          if (l) excluded.push(...l);
        }
      }
    }
    child = p;
    p = p.parent;
  }
  return { narrowing, excluded: [...new Set(excluded)].sort(compareCodeUnits) };
}

// ── Tools ─────────────────────────────────────────────────────────────────────

export interface ToolScan {
  name: string;
  file: string;
  line: number;
  quote?: string;
  /** First sentence of the description. */
  what?: string;
  param?: ToolParam;
  calls: CallSite[];
  /**
   * Handler actions reached through the 1.x alias table: the tool calls runAliasViaModule or
   * routeAlias with a literal alias name, ALIAS_ROUTES maps it to a Phase 3 tool and action, and
   * that tool has a contract (so a handler). Aliases routed to a tool with no contract add nothing.
   */
  aliasLinks: { handler: string; action: string }[];
  /** Source lines of the file (for quotes). */
  lines: string[];
  /** Function (file::name) the registerTool call lies in. */
  fn: string;
  conditionalLexical: boolean;
  /** The registration's `annotations` hints, when given as boolean literals (inline or a same-file const). */
  annotations?: ToolAnnotations;
  /** Contract-backed tools: each contract action's `mutating` flag. */
  actionMutating?: Record<string, boolean>;
}

/** The two MCP annotation hints the census reads (plan 4.5 risk; review-1 finding 3). */
export interface ToolAnnotations {
  readOnly?: boolean;
  destructive?: boolean;
}

/** `readOnlyHint` and `destructiveHint` of an `annotations` value: an object literal or a same-file const. */
export function readAnnotations(e: ts.Expression, sf: ts.SourceFile): ToolAnnotations | undefined {
  let x = unwrap(e);
  if (ts.isIdentifier(x)) {
    const init = topLevelConstInit(sf, x.text);
    if (!init) return undefined;
    x = init;
  }
  if (!ts.isObjectLiteralExpression(x)) return undefined;
  const out: ToolAnnotations = {};
  for (const p of x.properties) {
    if (!ts.isPropertyAssignment(p) || !ts.isIdentifier(p.name)) continue;
    const v = unwrap(p.initializer);
    const b =
      v.kind === ts.SyntaxKind.TrueKeyword
        ? true
        : v.kind === ts.SyntaxKind.FalseKeyword
          ? false
          : undefined;
    if (b === undefined) continue;
    if (p.name.text === "readOnlyHint") out.readOnly = b;
    if (p.name.text === "destructiveHint") out.destructive = b;
  }
  return out.readOnly === undefined && out.destructive === undefined ? undefined : out;
}

/** The `mutating` flag of each action of the contract whose `tool` is `tool`. */
function contractMutating(
  tool: string,
  contracts: readonly SourceFile[] | undefined,
): Record<string, boolean> | undefined {
  for (const c of contracts ?? []) {
    try {
      const j = JSON.parse(c.text) as { tool?: unknown; actions?: unknown };
      if (j.tool !== tool || !Array.isArray(j.actions)) continue;
      const out: Record<string, boolean> = {};
      for (const a of j.actions as { name?: unknown; mutating?: unknown }[]) {
        if (typeof a.name === "string" && typeof a.mutating === "boolean") out[a.name] = a.mutating;
      }
      return out;
    } catch {
      /* not a contract */
    }
  }
  return undefined;
}

/**
 * The risk an mcp-tool row states from its registration: `safe` when the tool declares
 * readOnlyHint true, `mutating` when it declares readOnlyHint false; nothing otherwise (the policy
 * default applies). destructiveHint is read but never raises a row to `destructive`: that class
 * asks a disposition of the row (policy risk_overrides), and an MCP tool is the automation, not a
 * Workbench surface; an action-level destructive risk comes from its contract or a state patch.
 */
export function toolRiskHint(t: Pick<ToolScan, "annotations">): "safe" | "mutating" | undefined {
  if (t.annotations?.readOnly === true) return "safe";
  if (t.annotations?.readOnly === false) return "mutating";
  return undefined;
}

/**
 * The risk an mcp-action row states: `safe` for an action of a readOnlyHint tool or a contract
 * action with `mutating: false`; `mutating` for a contract action with `mutating: true`; the
 * tool's own hint for a tool whose only action is the synthetic `run`; nothing otherwise.
 */
export function actionRiskHint(
  t: Pick<ToolScan, "annotations" | "actionMutating">,
  action: string,
  onlyAction: boolean,
): "safe" | "mutating" | undefined {
  if (t.annotations?.readOnly === true) return "safe";
  const m = t.actionMutating?.[action];
  if (m !== undefined) return m ? "mutating" : "safe";
  if (onlyAction) return toolRiskHint(t);
  return undefined;
}

/**
 * ALIAS_ROUTES of aliases.ts: alias name -> every routed tool and action its mapper names. Each
 * object literal in the mapper with a literal `tool` is one route; its action is the first literal
 * `action` inside that object (the routed `args.action`), else the mapper's first literal `action`
 * (args built in a variable). A mapper that routes by action (the 1.x wb_entity_modify) names
 * several; every action of that tool is then linked to all of them (the census is coarse there).
 */
export function readAliasRoutes(
  file: SourceFile | null | undefined,
): Map<string, { tool: string; action: string }[]> {
  const out = new Map<string, { tool: string; action: string }[]>();
  if (!file) return out;
  const sf = ts.createSourceFile(
    file.rel,
    file.text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const strProp = (n: ts.Node, key: string): string | undefined => {
    let found: string | undefined;
    const visit = (x: ts.Node): void => {
      if (found !== undefined) return;
      if (
        ts.isPropertyAssignment(x) &&
        ts.isIdentifier(x.name) &&
        x.name.text === key &&
        ts.isStringLiteralLike(unwrap(x.initializer))
      )
        found = (unwrap(x.initializer) as ts.StringLiteralLike).text;
      ts.forEachChild(x, visit);
    };
    visit(n);
    return found;
  };
  const visit = (n: ts.Node): void => {
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.name.text === "ALIAS_ROUTES" &&
      n.initializer
    ) {
      const lit = (function find(x: ts.Node): ts.ObjectLiteralExpression | undefined {
        if (ts.isObjectLiteralExpression(x)) return x;
        return ts.forEachChild(x, find);
      })(n.initializer);
      for (const p of lit?.properties ?? []) {
        if (!ts.isPropertyAssignment(p)) continue;
        const name = ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : null;
        if (!name) continue;
        const routes: { tool: string; action: string }[] = [];
        const collect = (x: ts.Node): void => {
          if (ts.isObjectLiteralExpression(x)) {
            const toolProp = x.properties.find(
              (q): q is ts.PropertyAssignment =>
                ts.isPropertyAssignment(q) &&
                ts.isIdentifier(q.name) &&
                q.name.text === "tool" &&
                ts.isStringLiteralLike(unwrap(q.initializer)),
            );
            if (toolProp) {
              const tool = (unwrap(toolProp.initializer) as ts.StringLiteralLike).text;
              // `args` built in a variable first: the mapper's first literal action names it.
              const action = strProp(x, "action") ?? strProp(p.initializer, "action");
              if (action && !routes.some((r) => r.tool === tool && r.action === action))
                routes.push({ tool, action });
              return;
            }
          }
          ts.forEachChild(x, collect);
        };
        collect(p.initializer);
        if (routes.length > 0) out.set(name, routes);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

interface FnInfo {
  key: string;
  node: ts.Node;
  ctx: Ctx;
}

function topLevelFunctions(ctx: Ctx): Map<string, FnInfo> {
  const out = new Map<string, FnInfo>();
  for (const st of ctx.sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name)
      out.set(st.name.text, { key: `${ctx.rel}::${st.name.text}`, node: st, ctx });
    else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (
          ts.isIdentifier(d.name) &&
          d.initializer &&
          (ts.isArrowFunction(unwrap(d.initializer)) ||
            ts.isFunctionExpression(unwrap(d.initializer)))
        )
          out.set(d.name.text, { key: `${ctx.rel}::${d.name.text}`, node: d, ctx });
      }
    }
  }
  return out;
}

function topFunctionKey(ctx: Ctx, node: ts.Node): string {
  let n: ts.Node = node;
  while (n.parent && !ts.isSourceFile(n.parent)) n = n.parent;
  if (ts.isFunctionDeclaration(n) && n.name) return `${ctx.rel}::${n.name.text}`;
  if (ts.isVariableStatement(n)) {
    const d = n.declarationList.declarations[0];
    if (d && ts.isIdentifier(d.name)) return `${ctx.rel}::${d.name.text}`;
  }
  return `${ctx.rel}::<top>`;
}

function isLexicallyConditional(node: ts.Node): boolean {
  let child: ts.Node = node;
  let p: ts.Node | undefined = node.parent;
  while (p && !ts.isSourceFile(p)) {
    if (
      ts.isFunctionDeclaration(p) ||
      (ts.isArrowFunction(p) && ts.isVariableDeclaration(p.parent)) ||
      ts.isMethodDeclaration(p)
    )
      return false;
    if (ts.isIfStatement(p) && child !== p.expression) return true;
    if (ts.isConditionalExpression(p) && child !== p.condition) return true;
    if (
      ts.isForStatement(p) ||
      ts.isForOfStatement(p) ||
      ts.isForInStatement(p) ||
      ts.isWhileStatement(p) ||
      ts.isDoStatement(p) ||
      ts.isCaseClause(p) ||
      ts.isDefaultClause(p)
    )
      return true;
    if (
      ts.isBinaryExpression(p) &&
      child === p.right &&
      (p.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
        p.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
        p.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
    )
      return true;
    child = p;
    p = p.parent;
  }
  return false;
}

interface ImportBinding {
  rel: string;
  name: string;
}

function importsOf(ctx: Ctx, known: ReadonlySet<string>): Map<string, ImportBinding> {
  const out = new Map<string, ImportBinding>();
  for (const st of ctx.sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    const spec = st.moduleSpecifier.text;
    if (!spec.startsWith(".")) continue;
    let rel = posix.normalize(posix.join(posix.dirname(ctx.rel), spec));
    rel = rel.replace(/\.js$/, ".ts");
    if (!/\.ts$/.test(rel)) rel += ".ts";
    if (!known.has(rel)) continue;
    const nb = st.importClause?.namedBindings;
    if (nb && ts.isNamedImports(nb)) {
      for (const el of nb.elements)
        out.set(el.name.text, { rel, name: (el.propertyName ?? el.name).text });
    }
  }
  return out;
}

function collectCallSites(
  region: ts.Node,
  ctx: Ctx,
  vars: Set<string>,
  boundary: ts.Node,
  out: CallSite[],
): void {
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && n.arguments.length > 0) {
      // `client.call("H", {...})`, or a local wrapper `wbCall(client, "EMCP_WB_H", {...})`.
      let nameAt = 0;
      let names = evalStrings(n.arguments[0]);
      if (!names?.some((x) => /^EMCP_WB_\w+$/.test(x)) && n.arguments[1]) {
        const second = evalStrings(n.arguments[1]);
        if (second?.some((x) => /^EMCP_WB_\w+$/.test(x))) {
          names = second;
          nameAt = 1;
        }
      }
      const calleeText = n.expression.getText(ctx.sf);
      const isEmcp = !!names?.some((x) => /^EMCP_WB_\w+$/.test(x));
      const isClient = nameAt === 0 && /\b(?:client|wbClient)\.call\b/.test(calleeText);
      if (names && (isEmcp || isClient)) {
        for (const handler of names) {
          const sent: Sent = { lits: [], pass: false, unknown: false, present: false, keys: [] };
          const arg = n.arguments[nameAt + 1];
          if (arg) sentFromExpr(arg, vars, sent, 0);
          sent.lits = [...new Set(sent.lits)];
          const na = narrowAndExclude(n, boundary, vars, ctx);
          out.push({
            handler,
            builtin: !/^EMCP_WB_\w+$/.test(handler),
            line: lineOf(ctx, n),
            sent,
            narrowing: na.narrowing,
            excluded: na.excluded,
            requestKeys: [...new Set(sent.keys)].sort(compareCodeUnits),
          });
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(region);
}

export interface RegistrationAudit {
  /** registerTool calls found by the AST in src/tools (comments excluded). */
  astCalls: number;
  /** registerTool calls the server reaches through register functions. */
  reachable: number;
  /** Registered names (reachable), count of distinct names. */
  distinctNames: number;
  /** Matches of `.registerTool(` text in src/tools (what count-inventory.ts counts there). */
  textMatchesInTools: number;
  /** Matches of `.registerTool(` text in src outside server.ts and src/tools. */
  textMatchesElsewhere: number;
  /** Functions server.ts calls that live in src/tools. */
  registerFunctionsCalled: number;
  conditional: string[];
  unreachable: string[];
  unresolvedNames: string[];
  duplicateNames: string[];
  legacyToolCalls: number;
}

export interface ToolModel {
  tools: ToolScan[];
  audit: RegistrationAudit;
}

/** Scans the tool side: which tools the server registers and how each is called. */
export function scanTools(src: RepoSources): ToolModel {
  const ctxs = new Map<string, Ctx>();
  for (const f of src.tools) ctxs.set(f.rel, mkCtx(f));
  const serverCtx = src.server ? mkCtx(src.server) : null;
  const known = new Set(ctxs.keys());

  const fns = new Map<string, FnInfo>();
  const fnByFile = new Map<string, Map<string, FnInfo>>();
  for (const c of ctxs.values()) {
    const m = topLevelFunctions(c);
    fnByFile.set(c.rel, m);
    for (const f of m.values()) fns.set(f.key, f);
  }
  const imports = new Map<string, Map<string, ImportBinding>>();
  for (const c of ctxs.values()) imports.set(c.rel, importsOf(c, known));

  // Call graph between top-level functions of src/tools, and the roots from server.ts.
  interface Edge {
    to: string;
    cond: boolean;
  }
  const resolveCallee = (ctx: Ctx, id: string): string | undefined => {
    const local = fnByFile.get(ctx.rel)?.get(id);
    if (local) return local.key;
    const imp = imports.get(ctx.rel)?.get(id);
    if (imp) return fnByFile.get(imp.rel)?.get(imp.name)?.key;
    return undefined;
  };
  const edgesFrom = new Map<string, Edge[]>();
  for (const f of fns.values()) {
    const list: Edge[] = [];
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
        const to = resolveCallee(f.ctx, n.expression.text);
        if (to && to !== f.key) list.push({ to, cond: isLexicallyConditional(n) });
      }
      ts.forEachChild(n, visit);
    };
    visit(f.node);
    edgesFrom.set(f.key, list);
  }
  const reach = new Map<string, boolean>(); // key -> reached only conditionally
  const importedFiles = new Set<string>();
  let registerFunctionsCalled = 0;
  if (serverCtx) {
    const sImports = importsOf(serverCtx, known);
    for (const b of sImports.values()) importedFiles.add(b.rel);
    const called = new Set<string>();
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
        const imp = sImports.get(n.expression.text);
        const key = imp ? fnByFile.get(imp.rel)?.get(imp.name)?.key : undefined;
        if (key) {
          called.add(key);
          const cond = isLexicallyConditional(n);
          const prev = reach.get(key);
          if (prev === undefined || (prev && !cond)) reach.set(key, cond);
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(serverCtx.sf);
    registerFunctionsCalled = called.size;
    let changed = true;
    while (changed) {
      changed = false;
      for (const [k, cond] of [...reach]) {
        for (const e of edgesFrom.get(k) ?? []) {
          const nc = cond || e.cond;
          const prev = reach.get(e.to);
          if (prev === undefined || (prev && !nc)) {
            reach.set(e.to, nc);
            changed = true;
          }
        }
      }
    }
  }

  const aliasRoutes = readAliasRoutes(src.aliases);
  const tools: ToolScan[] = [];
  const audit: RegistrationAudit = {
    astCalls: 0,
    reachable: 0,
    distinctNames: 0,
    textMatchesInTools: 0,
    textMatchesElsewhere: src.otherSrcMatches.reduce((a, m) => a + m.count, 0),
    registerFunctionsCalled,
    conditional: [],
    unreachable: [],
    unresolvedNames: [],
    duplicateNames: [],
    legacyToolCalls: 0,
  };
  for (const f of src.tools)
    audit.textMatchesInTools += (f.text.match(/\.registerTool\(/g) ?? []).length;

  for (const ctx of ctxs.values()) {
    const found: ts.CallExpression[] = [];
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
        if (n.expression.name.text === "registerTool") found.push(n);
        else if (
          n.expression.name.text === "tool" &&
          n.arguments[0] &&
          ts.isStringLiteral(n.arguments[0])
        )
          audit.legacyToolCalls++;
      }
      ts.forEachChild(n, visit);
    };
    visit(ctx.sf);
    for (const call of found) {
      audit.astCalls++;
      const a0 = call.arguments[0];
      const names = a0 ? evalStrings(a0) : null;
      const fnKey = topFunctionKey(ctx, call);
      const where = `${ctx.rel}:${lineOf(ctx, call)}`;
      if (!names || names.length !== 1) {
        audit.unresolvedNames.push(where);
        continue;
      }
      const name = names[0];
      const isReached =
        reach.has(fnKey) || (fnKey.endsWith("::<top>") && importedFiles.has(ctx.rel));
      if (!isReached) {
        audit.unreachable.push(`${name} (${where})`);
        continue;
      }
      const lexical = isLexicallyConditional(call);
      if (lexical || reach.get(fnKey) === true) audit.conditional.push(`${name} (${where})`);

      const a1 = call.arguments[1];
      let what: string | undefined;
      let param: ToolParam | undefined;
      let constSchema: ts.Expression | undefined;
      let annotations: ToolAnnotations | undefined;
      if (a1 && ts.isObjectLiteralExpression(unwrap(a1))) {
        const cfg = unwrap(a1) as ts.ObjectLiteralExpression;
        for (const p of cfg.properties) {
          if (!ts.isPropertyAssignment(p) || !ts.isIdentifier(p.name)) continue;
          if (p.name.text === "description") what = descriptionWhat(p.initializer);
          if (p.name.text === "annotations") annotations = readAnnotations(p.initializer, ctx.sf);
          if (p.name.text !== "inputSchema") continue;
          const schema = unwrap(p.initializer);
          if (ts.isObjectLiteralExpression(schema)) param = findActionParam(schema, ctx);
          // A schema held in a top-level const of the same file (`inputSchema: NAVMESH_INPUT_SCHEMA`),
          // read last: a contract-driven tool's const shape is read from its contract first.
          else if (ts.isIdentifier(schema)) constSchema = topLevelConstInit(ctx.sf, schema.text);
        }
      }
      param ??= actionsConstParam(ctx);
      param ??= contractParam(name, ctx.lines.join("\n"), src.contracts, ctx);
      if (!param && constSchema && ts.isObjectLiteralExpression(constSchema))
        param = findActionParam(constSchema, ctx);
      const aliasLinks: { handler: string; action: string }[] = [];
      {
        const seen = new Set<string>();
        const visitAlias = (n: ts.Node): void => {
          if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
            const idx =
              n.expression.text === "runAliasViaModule"
                ? 1
                : n.expression.text === "routeAlias"
                  ? 0
                  : -1;
            const arg = idx >= 0 ? n.arguments[idx] : undefined;
            const alias =
              arg && ts.isStringLiteralLike(unwrap(arg))
                ? (unwrap(arg) as ts.StringLiteralLike).text
                : undefined;
            for (const route of alias ? (aliasRoutes.get(alias) ?? []) : []) {
              const handler = contractHandlerOf(route.tool, src.contracts);
              if (handler && !seen.has(`${handler} ${route.action}`)) {
                seen.add(`${handler} ${route.action}`);
                aliasLinks.push({ handler, action: route.action });
              }
            }
          }
          ts.forEachChild(n, visitAlias);
        };
        visitAlias(call);
      }
      const vars = new Set<string>(["action", ...(param ? [param.name] : [])]);
      const calls: CallSite[] = [];
      // The handler callback, plus top-level helper functions it calls (transitively).
      const visited = new Set<string>();
      const scan = (region: ts.Node, boundary: ts.Node): void => {
        collectCallSites(region, ctx, vars, boundary, calls);
        const visitHelpers = (n: ts.Node): void => {
          if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
            const helper = fnByFile.get(ctx.rel)?.get(n.expression.text);
            if (helper && helper.key !== fnKey && !visited.has(helper.key)) {
              visited.add(helper.key);
              scan(helper.node, helper.node);
            }
          }
          ts.forEachChild(n, visitHelpers);
        };
        visitHelpers(region);
      };
      scan(call, call);
      calls.sort((x, y) => x.line - y.line || compareCodeUnits(x.handler, y.handler));
      const line = a0 ? lineOf(ctx, a0) : lineOf(ctx, call);
      tools.push({
        name,
        file: ctx.rel,
        line,
        quote: lineQuote(ctx.lines, line),
        what,
        param,
        calls,
        aliasLinks,
        lines: ctx.lines,
        fn: fnKey,
        conditionalLexical: lexical,
        ...(annotations ? { annotations } : {}),
        ...(() => {
          const m = contractMutating(name, src.contracts);
          return m && Object.keys(m).length > 0 ? { actionMutating: m } : {};
        })(),
      });
      audit.reachable++;
    }
  }
  const names = tools.map((t) => t.name);
  audit.distinctNames = new Set(names).size;
  audit.duplicateNames = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))].sort(
    compareCodeUnits,
  );
  tools.sort((a, b) => compareCodeUnits(a.name, b.name));
  audit.conditional.sort(compareCodeUnits);
  audit.unreachable.sort(compareCodeUnits);
  audit.unresolvedNames.sort(compareCodeUnits);
  return { tools, audit };
}

// ── Enforce handlers ──────────────────────────────────────────────────────────

/** Replaces every comment with spaces (newlines kept), so offsets are unchanged. */
export function maskComments(src: string): string {
  const out = src.split("");
  const n = src.length;
  let i = 0;
  let inStr = false;
  while (i < n) {
    const c = src[i];
    if (inStr) {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === '"' || c === "\n") inStr = false;
      i++;
      continue;
    }
    if (c === '"') {
      inStr = true;
      i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      while (i < n && src[i] !== "\n") {
        if (src[i] !== "\r") out[i] = " ";
        i++;
      }
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      out[i] = " ";
      out[i + 1] = " ";
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] !== "\n" && src[i] !== "\r") out[i] = " ";
        i++;
      }
      if (i < n) {
        out[i] = " ";
        out[i + 1] = " ";
        i += 2;
      }
      continue;
    }
    i++;
  }
  return out.join("");
}

/** Blanks the inside of every string literal (of comment-masked text); quotes stay. */
export function maskStrings(masked: string): string {
  const out = masked.split("");
  const n = masked.length;
  let i = 0;
  while (i < n) {
    if (masked[i] === '"') {
      i++;
      while (i < n && masked[i] !== '"' && masked[i] !== "\n") {
        if (masked[i] === "\\" && i + 1 < n) {
          out[i] = " ";
          i++;
        }
        out[i] = " ";
        i++;
      }
      i++;
    } else i++;
  }
  return out.join("");
}

/** Index of the bracket that closes the one at `open` (text must have strings blanked), or -1. */
function matchClose(s: string, open: number): number {
  const o = s[open];
  const c = o === "{" ? "}" : o === "(" ? ")" : o === "[" ? "]" : "";
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === o) depth++;
    else if (s[i] === c) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function countArgs(args: string): number {
  if (args.trim() === "") return 0;
  let depth = 0;
  let n = 1;
  for (const ch of args) {
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (ch === "," && depth === 0) n++;
  }
  return n;
}

interface Method {
  name: string;
  params: string;
  bodyStart: number;
  bodyEnd: number;
}

interface ClassInfo {
  name: string;
  parent?: string;
  file: SourceFile;
  /** Offsets of the class body braces. */
  open: number;
  close: number;
  methods: Method[];
}

interface FileText {
  file: SourceFile;
  /** Comments blanked, strings intact. */
  masked: string;
  /** Comments and string contents blanked. */
  code: string;
  lines: string[];
  classes: ClassInfo[];
}

const CONTROL = new Set(["if", "for", "while", "switch", "foreach", "else", "return", "catch"]);

function parseFile(file: SourceFile): FileText {
  const masked = maskComments(file.text);
  const code = maskStrings(masked);
  const classes: ClassInfo[] = [];
  const re = /\bclass\s+([A-Za-z_]\w*)\s*(?::\s*([A-Za-z_]\w*)(?:\s*<[^>{]*>)?)?\s*\{/g;
  for (let m = re.exec(code); m; m = re.exec(code)) {
    const open = m.index + m[0].length - 1;
    const close = matchClose(code, open);
    if (close < 0) continue;
    const methods: Method[] = [];
    let stmt = open + 1;
    for (let i = open + 1; i < close; i++) {
      const ch = code[i];
      if (ch === ";") stmt = i + 1;
      else if (ch === "{") {
        const end = matchClose(code, i);
        if (end < 0) break;
        const header = code.slice(stmt, i).trim();
        const sig = /([A-Za-z_]\w*)\s*\(([\s\S]*)\)\s*$/.exec(header);
        if (
          sig &&
          !CONTROL.has(sig[1]) &&
          !/=\s*[^=]*$/.test(header.slice(0, header.indexOf(sig[1])))
        ) {
          methods.push({ name: sig[1], params: sig[2], bodyStart: i, bodyEnd: end });
          stmt = end + 1;
        }
        i = end;
        if (sig) stmt = end + 1;
      }
    }
    classes.push({ name: m[1], parent: m[2], file, open, close, methods });
  }
  return { file, masked, code, lines: splitLines(file.text), classes };
}

function lineAt(text: string, offset: number): number {
  let n = 1;
  for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

interface Branch {
  literals: string[];
  /** Offset of the `if` / `case` that opens the branch. */
  start: number;
  blockOpen: number;
  blockEnd: number;
}

export interface HandlerActionScan {
  action: string;
  line: number;
  quote?: string;
  what?: string;
  placeholder: boolean;
  /** `api:Class.Method/arity` ids the branch's code calls. */
  apiCalls: { cls: string; method: string; arity: number }[];
  synthetic: boolean;
}

export interface HandlerScan {
  cls: string;
  file: string;
  line: number;
  actions: HandlerActionScan[];
  /** `RegV("x")` fields of the request class `GetRequest` returns, when it could be read. */
  requestFields?: string[];
  /** Distinct classes named in `Workbench.GetModule(X)` in the handler class body, sorted. */
  getModules: string[];
}

const DECL_RE = /\b([A-Z][A-Za-z0-9_]*)\s*(?:<[^;(){}=]*>)?\s+([A-Za-z_]\w*)\s*(?=[=;,)])/g;
const SKIP_TYPES = new Set(["JsonApiStruct", "NetApiHandler"]);

function declsIn(s: string): Map<string, string> {
  const out = new Map<string, string>();
  for (let m = DECL_RE.exec(s); m; m = DECL_RE.exec(s)) out.set(m[2], m[1]);
  DECL_RE.lastIndex = 0;
  return out;
}

interface Env {
  files: FileText[];
  /** Class name -> (class, file). */
  classes: Map<string, { cls: ClassInfo; ft: FileText }>;
}

/** API calls in `text` (strings blanked): `var.Method(...)` of a typed variable, `Class.Method(...)`. */
function apiCallsIn(
  text: string,
  vars: Map<string, string>,
): { cls: string; method: string; arity: number; recv: string; at: number }[] {
  const out: { cls: string; method: string; arity: number; recv: string; at: number }[] = [];
  const re = /(?<![\w.\]\)])([A-Za-z_]\w*)\s*\.\s*([A-Za-z_]\w*)\s*\(/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const recv = m[1];
    const open = m.index + m[0].length - 1;
    const close = matchClose(text, open);
    if (close < 0) continue;
    let cls = vars.get(recv);
    if (!cls && /^[A-Z]/.test(recv) && !vars.has(recv)) cls = recv;
    if (!cls) continue;
    const args = text.slice(open + 1, close);
    if (recv === "Workbench" && m[2] === "GetModule") {
      // Workbench.GetModule(Type).Method(...) calls Method on Type
      const tail = /^\s*\.\s*([A-Za-z_]\w*)\s*\(/.exec(text.slice(close + 1));
      const t = /^\s*([A-Z]\w*)\s*$/.exec(args)?.[1];
      if (tail && t) {
        const o2 = close + 1 + tail[0].length - 1;
        const c2 = matchClose(text, o2);
        if (c2 >= 0)
          out.push({
            cls: t,
            method: tail[1],
            arity: countArgs(text.slice(o2 + 1, c2)),
            recv: t,
            at: m.index,
          });
      }
    }
    out.push({ cls, method: m[2], arity: countArgs(args), recv, at: m.index });
  }
  return out;
}

function apiCallsOfRange(
  ft: FileText,
  from: number,
  to: number,
  cls: ClassInfo,
  method: Method | undefined,
  env: Env,
  blank: [number, number][],
  visited: Set<string>,
): { cls: string; method: string; arity: number }[] {
  let text = ft.code.slice(from, to);
  for (const [a, b] of blank) {
    const lo = Math.max(a, from);
    const hi = Math.min(b, to);
    if (lo < hi) text = text.slice(0, lo - from) + " ".repeat(hi - lo) + text.slice(hi - from);
  }
  const vars = declsIn(method ? method.params + ")" : "");
  for (const [k, v] of declsIn(
    ft.code.slice(method ? method.bodyStart : cls.open, method ? method.bodyEnd : cls.close),
  ))
    vars.set(k, v);
  const out: { cls: string; method: string; arity: number }[] = [];
  const own = new Set<string>();
  for (const c of apiCallsIn(text, vars)) {
    if (c.cls.startsWith("EMCP_") || SKIP_TYPES.has(c.cls)) {
      // Helper on a handler/helper class of this mod: follow into its body.
      const target = env.classes.get(c.cls);
      const m = target?.cls.methods.find((x) => x.name === c.method);
      if (target && m && !visited.has(`${c.cls}.${m.name}`)) {
        visited.add(`${c.cls}.${m.name}`);
        out.push(
          ...apiCallsOfRange(target.ft, m.bodyStart, m.bodyEnd, target.cls, m, env, [], visited),
        );
      }
      continue;
    }
    own.add(`${c.cls}.${c.method}/${c.arity}`);
    out.push({ cls: c.cls, method: c.method, arity: c.arity });
  }
  // Unqualified calls to methods of the same class.
  const re = /(?<![\w.])([A-Za-z_]\w*)\s*\(/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (CONTROL.has(m[1])) continue;
    const callee = cls.methods.find((x) => x.name === m[1]);
    if (callee && callee !== method && !visited.has(`${cls.name}.${callee.name}`)) {
      visited.add(`${cls.name}.${callee.name}`);
      out.push(
        ...apiCallsOfRange(ft, callee.bodyStart, callee.bodyEnd, cls, callee, env, [], visited),
      );
    }
  }
  return out;
}

function branchCommentWhat(ft: FileText, blockOpen: number): string | undefined {
  const rest = ft.file.text.slice(blockOpen + 1).split(/\r?\n/);
  let i = 0;
  while (i < rest.length && rest[i].trim() === "") i++;
  const parts: string[] = [];
  for (; i < rest.length; i++) {
    const t = rest[i].trim();
    if (!t.startsWith("//")) break;
    parts.push(t.replace(/^\/\/+\s?/, ""));
  }
  if (parts.length === 0) return undefined;
  if (/^[A-Za-z_][\w.]*\s*(=|->|:)\s/.test(parts[0])) return undefined;
  const s = firstSentence(parts.join(" "));
  if (!s || !/\s/.test(s) || s.length < 12) return undefined;
  // An implementation caveat ("X is void", "requires a callback", a placeholder notice) says what
  // the code cannot do, not what the action does: leave `what` out rather than mislead.
  return CAVEAT_RE.test(s) ? undefined : s;
}

const CAVEAT_RE =
  /\b(is void|returns void|requires an? |exposes only|same caveat|placeholders?|not publicly|not documented|not implemented|reports no result|not a mutation|cannot be used)\b/i;

function scanHandlerClass(ft: FileText, cls: ClassInfo, env: Env): HandlerScan {
  const { code, masked } = ft;
  const branches: Branch[] = [];
  const firstAt = new Map<string, number>();
  // if (... action == "x" ...) { ... }
  // Matched on the string-blanked text (so a comparison inside a string is not one); the literal
  // is read from the comment-blanked text at the same offsets.
  const cmp = /([A-Za-z_][\w.]*)\s*==\s*("[^"\n]*")|("[^"\n]*")\s*==\s*([A-Za-z_][\w.]*)/g;
  const body = code.slice(cls.open, cls.close);
  const hits: { lit: string; at: number }[] = [];
  for (let m = cmp.exec(body); m; m = cmp.exec(body)) {
    const v = m[1] ?? m[4];
    if (v.split(".").pop() !== "action") continue;
    const quoted = m[2] ?? m[3];
    const at = cls.open + m.index;
    const litStart = m[2] !== undefined ? at + m[0].length - quoted.length : at;
    hits.push({ lit: masked.slice(litStart + 1, litStart + quoted.length - 1), at });
  }
  const byIf = new Map<number, Branch>();
  for (const h of hits) {
    // enclosing "if (" of the comparison
    let depth = 0;
    let open = -1;
    for (let i = h.at; i > cls.open; i--) {
      if (code[i] === ")") depth++;
      else if (code[i] === "(") {
        if (depth === 0) {
          open = i;
          break;
        }
        depth--;
      }
    }
    if (open < 0) continue;
    const sliceFrom = Math.max(0, open - 12);
    const before = /\bif\s*$/.exec(code.slice(sliceFrom, open));
    if (!before) continue;
    const start = sliceFrom + before.index;
    const condClose = matchClose(code, open);
    if (condClose < 0) continue;
    let b = byIf.get(start);
    if (!b) {
      let p = condClose + 1;
      while (p < code.length && /\s/.test(code[p])) p++;
      let blockEnd: number;
      if (code[p] === "{") blockEnd = matchClose(code, p);
      else {
        blockEnd = code.indexOf(";", p);
        p = condClose + 1;
      }
      if (blockEnd < 0) continue;
      b = { literals: [], start, blockOpen: p, blockEnd };
      byIf.set(start, b);
      branches.push(b);
    }
    if (!b.literals.includes(h.lit)) b.literals.push(h.lit);
    if (!firstAt.has(h.lit) || h.at < (firstAt.get(h.lit) as number)) firstAt.set(h.lit, h.at);
  }
  // switch (req.action) { case "x": ... }
  const sw = /switch\s*\(\s*([\w.]*action)\s*\)\s*\{/g;
  const codeBody = code.slice(cls.open, cls.close);
  for (let m = sw.exec(codeBody); m; m = sw.exec(codeBody)) {
    const open = cls.open + m.index + m[0].length - 1;
    const close = matchClose(code, open);
    if (close < 0) continue;
    const cases = [...code.slice(open, close).matchAll(/\bcase\s+("[^"\n]*")\s*:/g)].map((c) => ({
      index: c.index as number,
      len: c[0].length,
      lit: masked.slice(
        open + (c.index as number) + c[0].indexOf('"') + 1,
        open + (c.index as number) + c[0].indexOf('"') + c[1].length - 1,
      ),
    }));
    cases.forEach((c, idx) => {
      const at = open + c.index;
      const next = cases[idx + 1] ? open + cases[idx + 1].index : close;
      branches.push({ literals: [c.lit], start: at, blockOpen: at + c.len - 1, blockEnd: next });
      if (!firstAt.has(c.lit) || at < (firstAt.get(c.lit) as number)) firstAt.set(c.lit, at);
    });
  }

  const getResponse = cls.methods.find((m) => m.name === "GetResponse");
  const actions: HandlerActionScan[] = [];
  const ordered = [...firstAt.entries()].sort((a, b) => a[1] - b[1]);
  for (const [lit, at] of ordered) {
    const mine = branches.filter((b) => b.literals.includes(lit));
    const other = branches.filter((b) => !b.literals.includes(lit));
    const blank: [number, number][] = other.map((b) => [b.blockOpen, b.blockEnd]);
    const calls: { cls: string; method: string; arity: number }[] = [];
    for (const b of mine) {
      const within = cls.methods.find((m) => m.bodyStart <= b.blockOpen && b.blockEnd <= m.bodyEnd);
      calls.push(
        ...apiCallsOfRange(
          ft,
          b.blockOpen,
          b.blockEnd,
          cls,
          within ?? getResponse,
          env,
          blank.filter(([a, e]) => a > b.blockOpen && e < b.blockEnd),
          new Set(),
        ),
      );
    }
    const first = mine.find((b) => b.start <= at && at <= b.blockOpen) ?? mine[0];
    const line = lineAt(ft.file.text, at);
    const blockText = first ? ft.file.text.slice(first.blockOpen, first.blockEnd + 1) : "";
    actions.push({
      action: lit,
      line,
      quote: lineQuote(ft.lines, line),
      what: first ? branchCommentWhat(ft, first.blockOpen) : undefined,
      placeholder: /not implemented/i.test(blockText),
      apiCalls: dedupeCalls(calls),
      synthetic: false,
    });
  }
  if (actions.length === 0) {
    const calls = getResponse
      ? apiCallsOfRange(
          ft,
          getResponse.bodyStart,
          getResponse.bodyEnd,
          cls,
          getResponse,
          env,
          [],
          new Set(),
        )
      : [];
    const classLine = lineAt(ft.file.text, ft.code.lastIndexOf("class", cls.open));
    const header = /^\s*\*?\s*\w+\.c\s+-\s+(.+?)\s*$/m.exec(ft.file.text.slice(0, 1500));
    actions.push({
      action: RUN,
      line: classLine,
      quote: lineQuote(ft.lines, classLine),
      what: header ? firstSentence(header[1]) : undefined,
      placeholder: false,
      apiCalls: dedupeCalls(calls),
      synthetic: true,
    });
  }
  let requestFields: string[] | undefined;
  const getRequest = cls.methods.find((m) => m.name === "GetRequest");
  const reqClass = getRequest
    ? /\bnew\s+([A-Za-z_]\w*)\s*\(/.exec(code.slice(getRequest.bodyStart, getRequest.bodyEnd))?.[1]
    : undefined;
  const reqInfo = reqClass ? env.classes.get(reqClass) : undefined;
  if (reqInfo) {
    requestFields = [
      ...new Set(
        [
          ...reqInfo.ft.masked
            .slice(reqInfo.cls.open, reqInfo.cls.close)
            .matchAll(/\bRegV\s*\(\s*"([^"\n]*)"/g),
        ].map((m) => m[1]),
      ),
    ].sort(compareCodeUnits);
  }
  return {
    cls: cls.name,
    file: ft.file.rel,
    line: lineAt(ft.file.text, ft.code.lastIndexOf("class", cls.open)),
    actions,
    requestFields,
    getModules: [
      ...new Set(
        [...masked.slice(cls.open, cls.close).matchAll(/\bGetModule\s*\(\s*([A-Z]\w*)\s*\)/g)].map(
          (m) => m[1],
        ),
      ),
    ].sort(compareCodeUnits),
  };
}

function dedupeCalls(
  calls: { cls: string; method: string; arity: number }[],
): { cls: string; method: string; arity: number }[] {
  const seen = new Set<string>();
  const out: { cls: string; method: string; arity: number }[] = [];
  for (const c of calls) {
    const k = `${c.cls}.${c.method}/${c.arity}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out.sort((a, b) =>
    compareCodeUnits(`${a.cls}.${a.method}/${a.arity}`, `${b.cls}.${b.method}/${b.arity}`),
  );
}

/** Scans every `NetApiHandler` class in `mod/**\/*.c`. */
export function scanHandlers(src: RepoSources): HandlerScan[] {
  const files = src.handlers.map(parseFile);
  const env: Env = { files, classes: new Map() };
  for (const ft of files) for (const c of ft.classes) env.classes.set(c.name, { cls: c, ft });
  const out: HandlerScan[] = [];
  for (const ft of files)
    for (const c of ft.classes)
      if (c.parent === "NetApiHandler") out.push(scanHandlerClass(ft, c, env));
  out.sort((a, b) => compareCodeUnits(a.cls, b.cls));
  return out;
}

// ── The model, rows and covers ────────────────────────────────────────────────

export interface MismatchRow {
  tool: string;
  action: string;
  /** The handler the call site names. */
  handler: string;
  /** What the call site sends as `action`, or "" when none. */
  sent: string;
  kind: "undispatched-action" | "handler-not-in-mod" | "no-action-sent" | "unresolved-action";
  ref: string;
}

export interface RequestKeyRow {
  tool: string;
  handler: string;
  /** A request key the tool sends that the handler's request class does not register. */
  key: string;
  ref: string;
}

export interface BuiltinRow {
  tool: string;
  action: string;
  handler: string;
  requestKeys: string[];
  ref: string;
}

export interface ToolActionModel {
  tool: string;
  value: string;
  line: number;
  synthetic: boolean;
  quote?: string;
  /** Contract file the action name was read from, when the tool's schema is generated. */
  file?: string;
  /** Resolved links to handler actions. */
  links: { handler: string; action: string }[];
  mismatches: MismatchRow[];
  builtin: BuiltinRow[];
  what?: string;
}

export interface InventoryModel {
  tools: ToolScan[];
  handlers: HandlerScan[];
  toolActions: ToolActionModel[];
  /** One entry per tool: the module its handler calls reach, and why. */
  toolModules: ToolModuleInfo[];
  audit: RegistrationAudit;
  /** Input files with their hashes (for the observation header). */
  inputs: { path: string; sha256: string }[];
  mismatches: MismatchRow[];
  builtin: BuiltinRow[];
  requestKeyMismatches: RequestKeyRow[];
  leftOut: { what: string; why: string; count: number }[];
}

function sentLabel(s: Sent): string {
  return [...s.lits, ...(s.pass ? ["<tool action>"] : [])].join("|");
}

/** Links each tool action to the handler actions its call sites send to. */
export function linkActions(tools: ToolScan[], handlers: HandlerScan[]): ToolActionModel[] {
  const hmap = new Map(handlers.map((h) => [h.cls, h]));
  const out: ToolActionModel[] = [];
  for (const t of tools) {
    const toolContract = t.param?.contract;
    const actions: { value: string; line: number; synthetic: boolean; own?: boolean }[] = t.param
      ? t.param.values.map((v) => ({ value: v.value, line: v.line, synthetic: false, own: v.own }))
      : [{ value: RUN, line: t.line, synthetic: true }];
    for (const a of actions) {
      // A kept 1.x action of a contract tool is read like a plain tool's (ActionValue.own).
      const cp = a.own ? undefined : toolContract;
      const ta: ToolActionModel = {
        tool: t.name,
        value: a.value,
        line: a.line,
        synthetic: a.synthetic,
        quote: lineQuote(cp ? cp.lines : t.lines, a.line),
        file: cp?.rel,
        links: [],
        mismatches: [],
        builtin: [],
      };
      if (t.param) {
        const w = actionWhat(t.param.describe, a.value);
        if (w) ta.what = w;
      } else {
        if (t.what) ta.what = t.what;
      }
      const linkSet = new Set<string>();
      // A contract tool's handler is the contract's own; its call sites go through generic code.
      if (cp) {
        const h = hmap.get(cp.handler);
        if (h && h.actions.some((x) => !x.synthetic && x.action === a.value))
          linkSet.add(`${cp.handler}\u0000${a.value}`);
      }
      for (const l of cp ? [] : t.aliasLinks) {
        const h = hmap.get(l.handler);
        if (h && h.actions.some((x) => !x.synthetic && x.action === l.action))
          linkSet.add(`${l.handler} ${l.action}`);
      }
      for (const c of cp ? [] : t.calls) {
        // A kept 1.x action does not take the contract handler's generic call path.
        if (a.own && c.handler === toolContract?.handler) continue;
        if (t.param) {
          const applies = c.narrowing
            ? c.narrowing.includes(a.value)
            : !c.excluded.includes(a.value);
          if (!applies) continue;
        }
        const ref = `${t.file}#L${c.line}`;
        if (c.builtin) {
          ta.builtin.push({
            tool: t.name,
            action: a.value,
            handler: c.handler,
            requestKeys: c.requestKeys,
            ref,
          });
          continue;
        }
        const h = hmap.get(c.handler);
        if (!h) {
          ta.mismatches.push({
            tool: t.name,
            action: a.value,
            handler: c.handler,
            sent: sentLabel(c.sent),
            kind: "handler-not-in-mod",
            ref,
          });
          continue;
        }
        const dispatch = h.actions.filter((x) => !x.synthetic).map((x) => x.action);
        const sends: string[] = [];
        if (c.sent.unknown && c.sent.lits.length === 0 && !c.sent.pass) {
          ta.mismatches.push({
            tool: t.name,
            action: a.value,
            handler: c.handler,
            sent: "",
            kind: "unresolved-action",
            ref,
          });
          continue;
        }
        sends.push(...c.sent.lits);
        if (c.sent.pass) sends.push(a.value);
        if (sends.length === 0) {
          if (dispatch.length === 0) sends.push(RUN);
          else {
            ta.mismatches.push({
              tool: t.name,
              action: a.value,
              handler: c.handler,
              sent: "",
              kind: "no-action-sent",
              ref,
            });
            continue;
          }
        }
        for (const s of sends) {
          const ok = dispatch.length === 0 ? s === RUN : dispatch.includes(s);
          if (ok) linkSet.add(`${c.handler}\u0000${s}`);
          else
            ta.mismatches.push({
              tool: t.name,
              action: a.value,
              handler: c.handler,
              sent: s,
              kind: "undispatched-action",
              ref,
            });
        }
      }
      ta.links = [...linkSet]
        .map((k) => {
          const [handler, action] = k.split("\u0000");
          return { handler, action };
        })
        .sort((x, y) => compareCodeUnits(`${x.handler}.${x.action}`, `${y.handler}.${y.action}`));
      out.push(ta);
    }
  }
  return out;
}

/** Request keys a tool sends to an EMCP handler that the handler's request class does not register. */
export function requestKeyMismatches(tools: ToolScan[], handlers: HandlerScan[]): RequestKeyRow[] {
  const hmap = new Map(handlers.map((h) => [h.cls, h]));
  const seen = new Set<string>();
  const out: RequestKeyRow[] = [];
  for (const t of tools) {
    for (const c of t.calls) {
      const fields = hmap.get(c.handler)?.requestFields;
      if (c.builtin || !fields) continue;
      for (const k of c.requestKeys) {
        if (fields.includes(k)) continue;
        const id = `${t.name}\u0000${c.handler}\u0000${k}\u0000${t.file}#L${c.line}`;
        if (seen.has(id)) continue;
        seen.add(id);
        out.push({ tool: t.name, handler: c.handler, key: k, ref: `${t.file}#L${c.line}` });
      }
    }
  }
  return out.sort((a, b) =>
    compareCodeUnits(
      `${a.tool}.${a.handler}.${a.key}.${a.ref}`,
      `${b.tool}.${b.handler}.${b.key}.${b.ref}`,
    ),
  );
}

export function buildModel(src: RepoSources): InventoryModel {
  const { tools, audit } = scanTools(src);
  const handlers = scanHandlers(src);
  const toolActions = linkActions(tools, handlers);
  const handlerModules = new Map(handlers.map((h) => [h.cls, handlerModule(h.getModules)]));
  const toolModules = tools.map((t) =>
    deriveToolModule(
      t.name,
      [...t.calls, ...t.aliasLinks.map((l) => ({ handler: l.handler, builtin: false }))],
      handlerModules,
    ),
  );
  const inputs = [...(src.server ? [src.server] : []), ...src.tools, ...src.handlers].map((f) => ({
    path: `<repo>/${f.rel}`,
    sha256: f.sha256,
  }));
  return {
    tools,
    handlers,
    toolActions,
    toolModules,
    audit,
    inputs,
    mismatches: toolActions.flatMap((a) => a.mismatches),
    builtin: toolActions.flatMap((a) => a.builtin),
    requestKeyMismatches: requestKeyMismatches(tools, handlers),
    leftOut: [],
  };
}

// ── Rows ──────────────────────────────────────────────────────────────────────

export interface EmitOptions {
  /** false: module "none" on every row; true: the modules derived from the source (see Modules). */
  modules: boolean;
}

export type CoverBasis = "api-call" | "handler-action" | "net-handler";

export interface CoverProposal {
  target: string;
  basis: CoverBasis;
}

export interface EmittedRow {
  obs: Observation;
  id: string;
  proposals: CoverProposal[];
}

function ref(rel: string, line: number): string {
  return `<repo>/${rel}#L${line}`;
}

/** Observation rows (covers not yet attached) and the covers each would propose. Sorted by id. */
export function emitRows(
  model: InventoryModel,
  opts: EmitOptions,
): { rows: EmittedRow[]; leftOut: InventoryModel["leftOut"] } {
  const rows: EmittedRow[] = [];
  const leftOut = new Map<string, { what: string; why: string; count: number }>();
  const drop = (what: string, why: string): void => {
    const k = `${what}\u0000${why}`;
    const e = leftOut.get(k);
    if (e) e.count++;
    else leftOut.set(k, { what, why, count: 1 });
  };
  const mod = (m: string): Observation["module"] =>
    (opts.modules ? m : "none") as Observation["module"];
  const push = (obs: Observation, proposals: CoverProposal[]): void => {
    let o = obs;
    if (allStrings(o).some(containsMachinePath)) {
      const { what: _what, ...rest } = o;
      void _what;
      drop(`${o.kind} what text`, "contains a machine path");
      o = rest as Observation;
      if (allStrings(o).some(containsMachinePath)) {
        drop(`${o.kind} row`, "contains a machine path");
        return;
      }
    }
    const parsed = observationSchema.safeParse(o);
    if (!parsed.success) {
      const i = parsed.error.issues[0];
      drop(`${o.kind} row`, `schema: ${i.path.join(".")}: ${i.message}`);
      return;
    }
    let id: string;
    try {
      id = deriveId(parsed.data);
    } catch (e) {
      drop(`${o.kind} row`, e instanceof Error ? e.message : String(e));
      return;
    }
    rows.push({ obs: parsed.data, id, proposals });
  };

  for (const t of model.tools) {
    const tm = mod(model.toolModules.find((x) => x.tool === t.name)?.module ?? "none");
    const mine = model.toolActions.filter((a) => a.tool === t.name);
    push(
      {
        dim: "mcp",
        kind: "mcp-tool",
        module: tm,
        key: { tool: t.name },
        parent_key: null,
        label: t.name,
        what: t.what,
        origin: "vanilla",
        ref: ref(t.file, t.line),
        quote: t.quote,
        confidence: "high",
        children_count: mine.length,
        ...(toolRiskHint(t) ? { risk_hint: toolRiskHint(t) } : {}),
      },
      [],
    );
    const viaOther = !!t.param && t.param.name !== "action";
    for (const a of mine) {
      const proposals: CoverProposal[] = [];
      for (const l of a.links) {
        proposals.push({
          target: `mcp:handler-action/${l.handler}.${l.action}`,
          basis: "handler-action",
        });
        proposals.push({ target: `net:handler/${l.handler}`, basis: "net-handler" });
      }
      push(
        {
          dim: "mcp",
          kind: "mcp-action",
          module: tm,
          key: { tool: t.name, action: a.value },
          parent_key: { dim: "mcp", kind: "mcp-tool", module: tm, key: { tool: t.name } },
          label: `${t.name}.${a.value}`,
          what: a.what,
          origin: "vanilla",
          ref: ref(a.file ?? t.file, a.line),
          quote: a.quote,
          confidence: a.synthetic || viaOther ? "medium" : "high",
          ...(() => {
            const r = actionRiskHint(t, a.value, mine.length === 1 && a.value === "run");
            return r ? { risk_hint: r } : {};
          })(),
        },
        proposals,
      );
    }
  }

  for (const h of model.handlers) {
    const hm = mod(handlerModule(h.getModules));
    for (const a of h.actions) {
      push(
        {
          dim: "mcp",
          kind: "handler-action",
          module: hm,
          key: { handler: h.cls, action: a.action },
          parent_key: null,
          label: `${h.cls}.${a.action}`,
          class_name: h.cls,
          what: a.what,
          origin: "vanilla",
          ref: ref(h.file, a.line),
          quote: a.quote,
          confidence: a.synthetic || a.placeholder ? "medium" : "high",
        },
        a.apiCalls.map((c) => ({
          target: `api:${c.cls}.${c.method}/${c.arity}`,
          basis: "api-call" as const,
        })),
      );
    }
  }
  rows.sort((x, y) => compareCodeUnits(x.id, y.id));
  return {
    rows,
    leftOut: [...leftOut.values()].sort((a, b) => compareCodeUnits(a.what + a.why, b.what + b.why)),
  };
}

// ── Covers ────────────────────────────────────────────────────────────────────

export interface KnownIds {
  ids: Set<string>;
  /** Observation files read (placeholder path and hash), in code-unit order. */
  files: { path: string; sha256: string }[];
}

/** Ids of the rows in other enumerators' observation files for `build` (E02..E05). */
export function loadKnownIds(
  paths: CensusPaths,
  build: string,
  sources: readonly string[] = COVER_SOURCES,
): KnownIds {
  const ids = new Set<string>();
  const files: { path: string; sha256: string }[] = [];
  for (const e of sources) {
    const file = join(paths.observations, e, `${build}.jsonl`);
    if (!existsSync(file)) continue;
    const raw = readFileSync(file);
    files.push({
      path: `<repo>/${relative(paths.repo, file).split(sep).join("/")}`,
      sha256: sha256(raw),
    });
    const lines = splitLines(raw.toString("utf-8"));
    for (let i = 1; i < lines.length; i++) {
      try {
        const o = JSON.parse(lines[i]) as {
          dim?: string;
          kind?: string;
          module?: string;
          key?: Record<string, unknown>;
        };
        if (!o.dim || !o.kind || !o.module || !o.key) continue;
        ids.add(
          deriveId({ dim: o.dim, kind: o.kind, module: o.module, key: o.key } as Parameters<
            typeof deriveId
          >[0]),
        );
      } catch {
        /* a line the ledger would reject proposes nothing */
      }
    }
  }
  files.sort((a, b) => compareCodeUnits(a.path, b.path));
  return { ids, files };
}

export interface CoversTableRow {
  id: string;
  kind: string;
  ref: string;
  proposals: { target: string; basis: CoverBasis; survives: boolean; resolved?: string }[];
}

export interface CoversResult {
  table: CoversTableRow[];
  proposed: number;
  surviving: number;
  /** Proposals per basis: [proposed, surviving]. */
  byBasis: Record<CoverBasis, [number, number]>;
  /** Rows (by kind) that carry at least one surviving cover. */
  rowsWithCovers: Record<string, number>;
}

/**
 * Attaches `covers_proposed` to the rows and returns the full proposal table. A pure function
 * of the rows, their proposals and the set of known ids: an id survives when it is one of the
 * rows E11 emits or is in `known`. An `api:` proposal whose exact arity is unknown also survives
 * as the lowest known arity above it for the same Class.Method (the call may omit default
 * arguments), recorded in `resolved`.
 */
export function applyCovers(rows: EmittedRow[], known: ReadonlySet<string>): CoversResult {
  const own = new Set(rows.map((r) => r.id));
  const arities = new Map<string, number[]>();
  for (const id of known) {
    const m = /^api:([^.#/]+)\.([^./#]+)\/(\d+)$/.exec(id);
    if (!m) continue;
    const k = `${m[1]}.${m[2]}`;
    const list = arities.get(k) ?? [];
    list.push(Number(m[3]));
    arities.set(k, list);
  }
  const byBasis: CoversResult["byBasis"] = {
    "api-call": [0, 0],
    "handler-action": [0, 0],
    "net-handler": [0, 0],
  };
  const table: CoversTableRow[] = [];
  const rowsWithCovers: Record<string, number> = {};
  let proposed = 0;
  let surviving = 0;
  for (const r of rows) {
    const seen = new Set<string>();
    const props: CoversTableRow["proposals"] = [];
    for (const p of r.proposals) {
      if (seen.has(p.target)) continue;
      seen.add(p.target);
      let resolved: string | undefined;
      let survives = own.has(p.target) || known.has(p.target);
      if (!survives && p.basis === "api-call") {
        const m = /^api:([^.#/]+)\.([^./#]+)\/(\d+)$/.exec(p.target);
        if (m) {
          const above = (arities.get(`${m[1]}.${m[2]}`) ?? [])
            .filter((n) => n > Number(m[3]))
            .sort((a, b) => a - b)[0];
          if (above !== undefined) {
            resolved = `api:${m[1]}.${m[2]}/${above}`;
            survives = true;
          }
        }
      }
      props.push({ target: p.target, basis: p.basis, survives, ...(resolved ? { resolved } : {}) });
      proposed++;
      byBasis[p.basis][0]++;
      if (survives) {
        surviving++;
        byBasis[p.basis][1]++;
      }
    }
    props.sort((a, b) => compareCodeUnits(a.target, b.target));
    const kept = [
      ...new Set(props.filter((p) => p.survives).map((p) => p.resolved ?? p.target)),
    ].sort(compareCodeUnits);
    if (kept.length > 0) {
      r.obs.covers_proposed = kept;
      rowsWithCovers[r.obs.kind] = (rowsWithCovers[r.obs.kind] ?? 0) + 1;
    } else delete r.obs.covers_proposed;
    if (props.length > 0)
      table.push({ id: r.id, kind: r.obs.kind, ref: r.obs.ref, proposals: props });
  }
  return { table, proposed, surviving, byBasis, rowsWithCovers };
}

// ── Output ────────────────────────────────────────────────────────────────────

/** Exact text of the E11 observation file. */
export function observationFileText(
  rows: EmittedRow[],
  inputs: { path: string; sha256: string }[],
  build: string,
): string {
  const sortedInputs = [...inputs].sort((a, b) => compareCodeUnits(a.path, b.path));
  const header = {
    $header: 1,
    build,
    enumerator: ENUMERATOR_ID,
    generator: GENERATOR,
    inputs: sortedInputs,
    provisional: false,
    row_count: rows.length,
  };
  return [jsonlLine(header, ["$header"]), ...rows.map((r) => jsonlLine(r.obs))].join("\n") + "\n";
}

export interface Headline {
  toolsRegistered: number;
  toolsWithActionParam: number;
  /** Rows of enum actions of tools that have an action parameter. */
  enumActions: number;
  /** One "run" row per tool without an action parameter. */
  runActions: number;
  actionParamNames: Record<string, number>;
  handlerClasses: number;
  /** Actions found in `req.action == "x"` / `case "x"` dispatch. */
  handlerDispatchActions: number;
  /** Handlers with no action dispatch (one "run" row each). */
  handlerRunActions: number;
  handlerPlaceholderActions: number;
  mismatches: MismatchRow[];
  builtinActions: number;
}

export function headline(model: InventoryModel): Headline {
  const withParam = model.tools.filter((t) => t.param);
  const names: Record<string, number> = {};
  for (const t of withParam) {
    const n = (t.param as ToolParam).name;
    names[n] = (names[n] ?? 0) + 1;
  }
  const actions = model.handlers.flatMap((h) => h.actions);
  const builtinKeys = new Set(model.builtin.map((b) => `${b.tool}.${b.action}`));
  return {
    toolsRegistered: model.tools.length,
    toolsWithActionParam: withParam.length,
    enumActions: withParam.reduce((n, t) => n + (t.param as ToolParam).values.length, 0),
    runActions: model.tools.length - withParam.length,
    actionParamNames: names,
    handlerClasses: model.handlers.length,
    handlerDispatchActions: actions.filter((a) => !a.synthetic).length,
    handlerRunActions: actions.filter((a) => a.synthetic).length,
    handlerPlaceholderActions: actions.filter((a) => a.placeholder).length,
    mismatches: model.mismatches,
    builtinActions: builtinKeys.size,
  };
}

/** The raw audit written next to the covers table (artifacts folder, never the repository). */
export function auditText(
  model: InventoryModel,
  h: Headline,
  build: string,
  modules: boolean,
  known?: KnownIds,
): string {
  const e04Present = !!known?.files.some((f) => /\/observations\/E04\//.test(f.path));
  const byModule: Record<string, string[]> = {};
  for (const t of model.toolModules)
    if (t.module !== "none") (byModule[t.module] ??= []).push(t.tool);
  const noneByReason: Record<string, number> = {};
  for (const t of model.toolModules) noneByReason[t.reason] = (noneByReason[t.reason] ?? 0) + 1;
  const builtinByAction = new Map<string, BuiltinRow[]>();
  for (const b of model.builtin) {
    const k = `${b.tool}.${b.action}`;
    builtinByAction.set(k, [...(builtinByAction.get(k) ?? []), b]);
  }
  const { mismatches: _m, ...headlineNoMismatches } = h;
  void _m;
  return formatJson({
    $comment:
      "E11 audit: registration count, request mismatches and built-in handler calls. Raw material, not a census file.",
    build,
    enumerator: ENUMERATOR_ID,
    modules_emitted: modules,
    tool_modules: {
      rule: "a tool whose every handler call goes to Enforce handlers of the mod that each reach the same single module gets it; any other tool gets none",
      by_module: byModule,
      tools_by_reason: noneByReason,
      // Tools that call at least one handler yet got none: the reason says which part failed.
      called_handlers_but_none: model.toolModules
        .filter((t) => t.module === "none" && t.reason !== "no-handler-call")
        .map((t) => ({ tool: t.tool, reason: t.reason, handlers: t.handlers })),
    },
    registration: model.audit,
    headline: headlineNoMismatches,
    mismatches: model.mismatches,
    request_keys_not_registered_by_handler: model.requestKeyMismatches,
    builtin_request_key_check: {
      status: e04Present
        ? "E04 observation file present: compare these keys with the declared fields it publishes (not compared here)"
        : "pending: no E04 observation file at run time; keys below are what each tool sends, for the main session to compare",
      e04_observation_present: e04Present,
    },
    builtin_handler_calls: [...builtinByAction.entries()]
      .sort((a, b) => compareCodeUnits(a[0], b[0]))
      .map(([action, calls]) => ({
        action,
        calls: calls.map((c) => ({ handler: c.handler, request_keys: c.requestKeys, ref: c.ref })),
      })),
    tools_without_dispatch_param: model.tools.filter((t) => !t.param).map((t) => t.name),
    handlers: model.handlers.map((hd) => ({
      handler: hd.cls,
      file: hd.file,
      actions: hd.actions.map((a) => ({
        action: a.action,
        line: a.line,
        placeholder: a.placeholder,
        api_calls: a.apiCalls.map((c) => `${c.cls}.${c.method}/${c.arity}`),
      })),
    })),
  });
}

export function coversText(covers: CoversResult, build: string, known: KnownIds): string {
  return formatJson({
    $comment:
      "E11 covers_proposed table: every id a row proposes, with whether it survived the filter (rows of E11 itself and of E02..E05 present at run time). Re-run E11 after E02 and E04 land.",
    build,
    enumerator: ENUMERATOR_ID,
    known_id_sources: known.files,
    known_ids: known.ids.size,
    proposed: covers.proposed,
    surviving: covers.surviving,
    by_basis: Object.fromEntries(
      (Object.entries(covers.byBasis) as [string, [number, number]][]).map(([k, [p, s]]) => [
        k,
        { proposed: p, surviving: s },
      ]),
    ),
    rows_with_covers: covers.rowsWithCovers,
    rows: covers.table,
  });
}

// ── CLI ───────────────────────────────────────────────────────────────────────

const USAGE =
  "usage: e11-mcp-inventory.ts [--build <tag>] [--data <dir>] [--repo <dir>] [--out <file under observations/E11/>] [--artifacts <dir>] [--no-modules] [--json]";

/** Resolves `--out`, refusing anything outside `<census>/observations/E11/`. */
export function resolveOut(paths: CensusPaths, out: string | undefined, build: string): string {
  const dir = join(paths.observations, ENUMERATOR_ID);
  const file = out ? resolve(out) : join(dir, `${build}.jsonl`);
  if (dirname(file) !== dir || !file.endsWith(".jsonl")) {
    throw new Error(
      "refusing --out outside observations/E11/ (E11 writes only its own observation directory)",
    );
  }
  return file;
}

export interface InventoryResult {
  model: InventoryModel;
  rows: EmittedRow[];
  covers: CoversResult;
  known: KnownIds;
  head: Headline;
  leftOut: InventoryModel["leftOut"];
}

/** Everything the CLI writes, computed from a repository and the census root (no writes). */
export function inventory(
  src: RepoSources,
  paths: CensusPaths,
  build: string,
  opts: EmitOptions,
): InventoryResult {
  const model = buildModel(src);
  const { rows, leftOut } = emitRows(model, opts);
  const known = loadKnownIds(paths, build);
  const covers = applyCovers(rows, known.ids);
  model.inputs.push(...known.files);
  return { model, rows, covers, known, head: headline(model), leftOut };
}

export function run(argv: string[], io: Io = PROCESS_IO): number {
  return guard(io, "e11-mcp-inventory", () => {
    const { values } = parseArgs({
      args: argv,
      options: {
        build: { type: "string" },
        data: { type: "string" },
        repo: { type: "string" },
        out: { type: "string" },
        artifacts: { type: "string" },
        "no-modules": { type: "boolean" },
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
      io.err(`e11-mcp-inventory: ${e instanceof Error ? e.message : String(e)}`);
      return EXIT_FAIL;
    }
    const repo = values.repo ? resolve(values.repo) : paths.repo;
    const src = readRepoSources(repo);
    if (!src.server) {
      io.out("NO DATA: no src/server.ts under the repository; nothing inventoried");
      return EXIT_USAGE;
    }
    const modules = !values["no-modules"];
    const r = inventory(src, paths, build, { modules });
    mkdirSync(dirname(out), { recursive: true });
    writeFileAtomic(out, observationFileText(r.rows, r.model.inputs, build));

    const artDir = join(
      values.artifacts ? resolve(values.artifacts) : artifactsDir(),
      "census",
      build,
      ENUMERATOR_ID,
    );
    mkdirSync(artDir, { recursive: true });
    writeFileAtomic(join(artDir, "covers-proposed.json"), coversText(r.covers, build, r.known));
    writeFileAtomic(
      join(artDir, "audit.json"),
      auditText(r.model, r.head, build, modules, r.known),
    );

    const kinds: Record<string, number> = {};
    for (const row of r.rows) kinds[row.obs.kind] = (kinds[row.obs.kind] ?? 0) + 1;
    const h = r.head;
    const a = r.model.audit;
    if (values.json) {
      io.out(
        JSON.stringify({
          ok: true,
          command: "e11-mcp-inventory",
          build,
          rows: r.rows.length,
          rows_by_kind: kinds,
          headline: h,
          registration: a,
          covers: {
            proposed: r.covers.proposed,
            surviving: r.covers.surviving,
            by_basis: r.covers.byBasis,
          },
          left_out: r.leftOut,
        }),
      );
      return EXIT_OK;
    }
    io.out(
      `registration: ${a.astCalls} registerTool call(s) in src/tools (AST), ${a.reachable} reachable from server.ts, ` +
        `${a.textMatchesInTools} text match(es) in src/tools + ${a.textMatchesElsewhere} elsewhere, ` +
        `${a.conditional.length} conditional, ${a.unreachable.length} unreachable, ${a.duplicateNames.length} duplicate name(s)`,
    );
    io.out(
      `tools ${h.toolsRegistered}: ${h.toolsWithActionParam} with an action parameter (${h.enumActions} actions), ` +
        `${h.runActions} run; handlers ${h.handlerClasses}: ${h.handlerDispatchActions} dispatched actions, ${h.handlerRunActions} run`,
    );
    io.out(
      `${h.mismatches.length} action(s) send to a handler action that does not exist; ${h.builtinActions} action(s) call a built-in handler`,
    );
    io.out(
      `covers: ${r.covers.proposed} proposed, ${r.covers.surviving} surviving (known ids: ${r.known.ids.size} from ${r.known.files.length} file(s))`,
    );
    for (const l of r.leftOut) io.out(`left out ${l.count} x ${l.what}: ${l.why}`);
    const kindText = Object.entries(kinds)
      .sort((x, y) => compareCodeUnits(x[0], y[0]))
      .map(([k, n]) => `${n} ${k}`)
      .join(", ");
    io.out(
      `E11 at build ${build}: ${r.rows.length} observation${r.rows.length !== 1 ? "s" : ""} (${kindText})`,
    );
    return EXIT_OK;
  });
}

if (isMainModule(import.meta.url)) process.exitCode = run(process.argv.slice(2));
