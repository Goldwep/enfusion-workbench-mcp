/**
 * E18 — tool gestures (plan 4.5; Phase 1).
 *
 * What a World Editor tool does with the mouse and keyboard in the viewport,
 * which no menu or button reveals. Input: the E02 source index (every class and
 * method of the 6,568 script files, with file and line) plus the pak text of the
 * files that hold the tools' event overrides. Nothing is executed; pak text is
 * read through `src/pak/vfs.ts` only.
 *
 * TOOLS: every class that extends `WorldEditorTool` (directly or through another
 * class) and carries a `WorkbenchToolAttribute` on one of its declarations. Those
 * are the classes E03 emits `tool` rows for (`plugin:<Class>`); they are the
 * `parent_key` of every row here. A class that extends `WorldEditorTool` without
 * the attribute (a base class) gets no rows of its own: its overrides count for
 * every tool that inherits them.
 *
 * EVENTS: read from `WorldEditorTool` itself (every method declared `event`).
 * The nine input events (`OnKeyPressEvent`, `OnKeyReleaseEvent`, `OnEnterEvent`,
 * `OnLeaveEvent`, `OnMouseMoveEvent`, `OnMouseDoubleClickEvent`,
 * `OnMousePressEvent`, `OnMouseReleaseEvent`, `OnWheelEvent`) give gesture rows.
 * The lifecycle events (`OnActivate`, `OnDeActivate`, `OnAfterLoadWorld`,
 * `OnBeforeUnloadWorld`) are not gestures: they are counted per tool and reported
 * as left out (`LIFECYCLE_EVENTS`).
 *
 * WHAT IS READ FROM AN OVERRIDE BODY (comments and string literals masked, `#`
 * lines blanked; a heuristic reading of declarations and conditions, not a full
 * parse of Enforce Script):
 *  - key tests: `key == KeyCode.X`, `key != KeyCode.X` (either order),
 *    `switch (key) { case KeyCode.X: }`, with `key` the override's own parameter
 *    name;
 *  - button tests: the same with `WETMouseButtonFlag.X` and the mouse button
 *    parameter, plus `buttons & WETMouseButtonFlag.X`;
 *  - modifier tests: `GetModifierKeyState(ModifierKey.X)`, in a condition or
 *    assigned to a variable.
 * A condition whose tests are joined by `&&` (no `||`) is one gesture; the parts
 * are the modifiers (CONTROL, SHIFT, ALT order) and then the key or button. A
 * guard `if (buttons != WETMouseButtonFlag.LEFT) return;` makes the rest of the
 * body belong to LEFT; a modifier test inside such a region (or inside the
 * region of a key or button test) is combined with that key or button. A modifier
 * test that wraps nested key or button tests is not a row of its own.
 *
 * GESTURE NAME: `<Event> <parts joined by +>`, for example `KeyPress KC_ESCAPE`,
 * `MousePress ALT+LEFT`, `Wheel CONTROL`; a bare `<Event>` (for example
 * `MouseMove`) when the override tests nothing, or when code outside every test
 * still runs. The names are the constants of the source, unchanged.
 *
 * DELEGATION: the key or button parameter passed on to a method is followed to
 * that method when it resolves (the tool's own methods, an ancestor's through
 * `super.`, a static call through a class name of the index), to depth 3; its
 * tests then count with `high` confidence and cite the helper's lines. A call
 * that does not resolve, or a use of the parameter this reading does not
 * understand (assigned, computed), gives a bare event row of `medium` confidence
 * and counts the override as not interpreted.
 *
 * MODIFIERS IN HELPERS: a call from an override to a method of the tool class
 * (itself or an ancestor; to depth 3, the key helpers above excluded) is followed
 * for `GetModifierKeyState(ModifierKey.X)` tests. Each modifier found gives a row
 * of `medium` confidence (the helper is reached, its conditions are not
 * evaluated), combined with the key or button whose region holds the call, citing
 * the test in the helper and naming the first helper in `signature`.
 *
 * NEGATED TESTS: `if (!GetModifierKeyState(ModifierKey.X)) ...` without `else`
 * still names a gesture (the modifier changes the behaviour); its then-branch is
 * the plain behaviour and still counts as code that runs for the event.
 *
 * `what` is a comment of the source: the comment on the line of the test, the
 * comment lines directly above it, or the comment before the first statement of
 * the block it guards (for a guard, or a bare event: the override's own doc
 * comment without its `\param` lines and the "see WorldEditorTool.…" line).
 * Without a comment `what` is left out; `signature` names the override and the
 * methods the guarded block calls.
 *
 *   npx tsx scripts/census/enumerators/e18-tool-gestures.ts [--build <tag>]
 *       [--game <dir> | --scripts <dir of .c files>] [--data <dir>]
 *       [--out <file under observations/E18/>] [--json]
 *
 * Parent rows (`plugin:<Class>`, kind tool) belong to E03: `build.ts` reports
 * "parent has no row" for these rows until E03's observation file exists.
 *
 * Exit: 0 written; 1 refused, a rejected row or a stale index; 2 usage, or NO DATA
 * (no source index or no game install); 3 malformed census configuration.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { compareCodeUnits, jsonlLine, sha256 } from "../../../src/census/canon.js";
import { loadCurrentBuild } from "../../../src/census/census-config.js";
import { cleanDoc } from "../../../src/census/enforce-source.js";
import { containsMachinePath } from "../../../src/census/hygiene.js";
import { deriveId } from "../../../src/census/ids.js";
import { writeFileAtomic, type CensusPaths } from "../../../src/census/ledger-io.js";
import { observationSchema, type Observation } from "../../../src/census/schemas.js";
import {
  buildSourceIndex,
  classChain,
  findClass,
  isScriptSource,
  loadSourceIndex,
  methodsOf,
  pakRef,
  subclassesOf,
  type MergedClass,
  type MethodRecord,
  type SourceIndex,
} from "../../../src/census/source-index.js";
import { MODULES, type Module } from "../../../src/census/vocab.js";
import { loadConfig } from "../../../src/config.js";
import { PakVirtualFS } from "../../../src/pak/vfs.js";
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
import { attributeModules } from "./e02-script-source.js";

/** Enumerator id. */
export const ENUMERATOR_ID = "E18";
/** Registered generator path (must equal universes.json `enumerators.E18.generator`). */
export const GENERATOR = "scripts/census/enumerators/e18-tool-gestures.ts";
export const TOOL_BASE = "WorldEditorTool";
export const TOOL_ATTRIBUTE = "WorkbenchToolAttribute";
const QUOTE_MAX = 200;
const WHAT_MAX = 400;
const MAX_DELEGATION_DEPTH = 3;

/** The gesture label and the parameters that carry the key or the mouse button, per input event. */
interface InputEvent {
  label: string;
  /** Index of the `KeyCode` parameter. */
  keyParam?: number;
  /** Index of the `WETMouseButtonFlag` parameter. */
  buttonParam?: number;
}

/** The input events of `WorldEditorTool` (mouse and keyboard in the viewport). */
export const INPUT_EVENTS: Readonly<Record<string, InputEvent>> = {
  OnKeyPressEvent: { label: "KeyPress", keyParam: 0 },
  OnKeyReleaseEvent: { label: "KeyRelease", keyParam: 0 },
  OnEnterEvent: { label: "Enter" },
  OnLeaveEvent: { label: "Leave" },
  OnMouseMoveEvent: { label: "MouseMove" },
  OnMouseDoubleClickEvent: { label: "MouseDoubleClick", buttonParam: 2 },
  OnMousePressEvent: { label: "MousePress", buttonParam: 2 },
  OnMouseReleaseEvent: { label: "MouseRelease", buttonParam: 2 },
  OnWheelEvent: { label: "Wheel" },
};

/** Events that are not gestures: counted per tool, no rows. */
export const LIFECYCLE_EVENTS: readonly string[] = [
  "OnActivate",
  "OnDeActivate",
  "OnAfterLoadWorld",
  "OnBeforeUnloadWorld",
];

/** Canonical order of modifiers inside one gesture name. */
const MODIFIER_ORDER = ["CONTROL", "SHIFT", "ALT"];
/** Callees that are not worth naming in a signature. */
const NOISE_CALLS = new Set([
  "Print",
  "PrintFormat",
  "ToString",
  "Count",
  "Insert",
  "Clear",
  "Remove",
  "IsEmpty",
  "Length",
  "GetModifierKeyState",
]);
/** A call that merely reads the key (logging); not a delegation. */
const IGNORED_CALLEES = new Set(["Print", "PrintFormat", "ToString", "typename"]);
const KEYWORDS = new Set([
  "if",
  "while",
  "for",
  "foreach",
  "switch",
  "return",
  "else",
  "new",
  "delete",
  "sizeof",
  "typename",
  "case",
]);

// ── Module of a tool class ────────────────────────────────────────────────────

const MODULE_SET = new Set<string>(MODULES);

/**
 * Module of a plugin or tool class, the rule E03, E15, E17 and E18 share: the
 * `wbModules` argument of its `WorkbenchPluginAttribute` / `WorkbenchToolAttribute`;
 * exactly one entry naming a module of the vocabulary gives that module; no
 * entry, several entries or an unknown name gives `Shared`.
 */
export function moduleOfAttribute(args: string | undefined): Module {
  const mods = attributeModules(args);
  if (mods && mods.length === 1 && MODULE_SET.has(mods[0]) && mods[0] !== "none")
    return mods[0] as Module;
  return "Shared";
}

// ── Source preparation: masked text, comments, brackets ───────────────────────

interface CommentSpan {
  start: number;
  end: number;
  line: number;
  endLine: number;
  /** Code precedes the comment on its first line. */
  trailing: boolean;
  raw: string;
}

/** One file prepared for reading: masked text (same offsets as the original) and its comments. */
export interface SrcFile {
  path: string;
  text: string;
  /** `text` with comments and string contents replaced by spaces and `#` lines blanked. */
  masked: string;
  lineStarts: number[];
  comments: CommentSpan[];
}

function lineStartsOf(text: string): number[] {
  const out = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") out.push(i + 1);
  return out;
}

function lineAt(starts: readonly number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/** Masks comments, string contents and preprocessor lines; keeps offsets and line breaks. */
export function prepareSource(path: string, text: string): SrcFile {
  const n = text.length;
  const m = text.split("");
  const starts = lineStartsOf(text);
  const comments: CommentSpan[] = [];
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to; k++) if (m[k] !== "\n" && m[k] !== "\r") m[k] = " ";
  };
  let lineStart = 0;
  let i = 0;
  while (i < n) {
    const c = text[i];
    const d = text[i + 1];
    if (c === "\n") {
      lineStart = i + 1;
      i++;
    } else if (c === "#" && /^[ \t]*$/.test(text.slice(lineStart, i))) {
      let j = i;
      while (j < n && text[j] !== "\n") j++;
      blank(i, j);
      i = j;
    } else if (c === '"') {
      let j = i + 1;
      while (j < n && text[j] !== '"' && text[j] !== "\n") {
        if (text[j] === "\\") j++;
        j++;
      }
      blank(i + 1, Math.min(j, n));
      i = j + 1;
    } else if (c === "/" && d === "/") {
      let j = i;
      while (j < n && text[j] !== "\n") j++;
      comments.push({
        start: i,
        end: j,
        line: lineAt(starts, i),
        endLine: lineAt(starts, i),
        trailing: /\S/.test(m.slice(lineStart, i).join("")),
        raw: text.slice(i, j),
      });
      blank(i, j);
      i = j;
    } else if (c === "/" && d === "*") {
      const close = text.indexOf("*/", i + 2);
      const j = close < 0 ? n : close + 2;
      comments.push({
        start: i,
        end: j,
        line: lineAt(starts, i),
        endLine: lineAt(starts, Math.max(i, j - 1)),
        trailing: /\S/.test(m.slice(lineStart, i).join("")),
        raw: text.slice(i, j),
      });
      // Line starts after a block comment that spans lines.
      for (let k = i; k < j; k++) if (text[k] === "\n") lineStart = k + 1;
      blank(i, j);
      i = j;
    } else i++;
  }
  return { path, text, masked: m.join(""), lineStarts: starts, comments };
}

/** Index of the bracket that closes the one at `open` (any of `({[`), or -1. */
function findMatching(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === "(" || c === "{" || c === "[") depth++;
    else if (c === ")" || c === "}" || c === "]") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function skipWs(s: string, i: number): number {
  while (i < s.length && /\s/.test(s[i])) i++;
  return i;
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Index just past the statement that starts at `i` (after whitespace). */
function stmtEnd(s: string, i: number): number {
  i = skipWs(s, i);
  if (s[i] === "{") {
    const c = findMatching(s, i);
    return c < 0 ? s.length : c + 1;
  }
  const kw = /^(if|while|for|foreach|switch)\b/.exec(s.slice(i, i + 8));
  if (kw) {
    let j = skipWs(s, i + kw[0].length);
    if (s[j] === "(") {
      const c = findMatching(s, j);
      if (c < 0) return s.length;
      j = c + 1;
    }
    let e = stmtEnd(s, j);
    if (kw[1] === "if") {
      const k = skipWs(s, e);
      if (/^else\b/.test(s.slice(k, k + 5))) e = stmtEnd(s, k + 4);
    }
    return e;
  }
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (c === "(" || c === "{" || c === "[") depth++;
    else if (c === ")" || c === "}" || c === "]") depth--;
    else if (c === ";" && depth <= 0) return j + 1;
  }
  return s.length;
}

/** Splits the text of an argument list at its top-level commas. */
function splitTop(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const c of text) {
    if (c === "(" || c === "{" || c === "[" || c === "<") depth++;
    else if (c === ")" || c === "}" || c === "]" || c === ">") depth--;
    if (c === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  if (cur.trim() !== "") out.push(cur);
  return out;
}

/** Offsets of the body braces of a method whose name sits on `line`; null for a prototype or a miss. */
export function locateBody(
  f: SrcFile,
  name: string,
  line: number,
): { open: number; close: number } | null {
  const from = f.lineStarts[line - 1];
  if (from === undefined) return null;
  const re = new RegExp(`(?<![\\w.])${escapeRe(name)}\\s*\\(`, "g");
  re.lastIndex = from;
  const hit = re.exec(f.masked);
  if (!hit) return null;
  const pOpen = hit.index + hit[0].length - 1;
  const pClose = findMatching(f.masked, pOpen);
  if (pClose < 0) return null;
  let j = pClose + 1;
  while (j < f.masked.length && f.masked[j] !== "{" && f.masked[j] !== ";") j++;
  if (f.masked[j] !== "{") return null;
  const close = findMatching(f.masked, j);
  return close < 0 ? null : { open: j, close };
}

// ── Conditions ────────────────────────────────────────────────────────────────

interface Cond {
  kw: "if" | "while" | "switch";
  kwIdx: number;
  /** Offsets of the text inside the parentheses. */
  textStart: number;
  textEnd: number;
  text: string;
  thenStart: number;
  thenEnd: number;
  elseKwIdx?: number;
  elseStart?: number;
  elseEnd?: number;
  /** End of the whole statement, else chain included. */
  stmtEnd: number;
}

function collectConds(s: string, bs: number, be: number): Cond[] {
  const out: Cond[] = [];
  const re = /(?<![\w.])(if|while|switch)\s*\(/g;
  re.lastIndex = bs;
  for (let m = re.exec(s); m !== null && m.index < be; m = re.exec(s)) {
    const open = m.index + m[0].length - 1;
    const close = findMatching(s, open);
    if (close < 0 || close > be) continue;
    const thenStart = skipWs(s, close + 1);
    const thenEnd = stmtEnd(s, thenStart);
    const c: Cond = {
      kw: m[1] as Cond["kw"],
      kwIdx: m.index,
      textStart: open + 1,
      textEnd: close,
      text: s.slice(open + 1, close),
      thenStart,
      thenEnd,
      stmtEnd: thenEnd,
    };
    if (c.kw === "if") {
      const k = skipWs(s, thenEnd);
      if (/^else\b/.test(s.slice(k, k + 5))) {
        c.elseKwIdx = k;
        c.elseStart = skipWs(s, k + 4);
        c.elseEnd = stmtEnd(s, c.elseStart);
        c.stmtEnd = c.elseEnd;
      }
    }
    out.push(c);
  }
  return out;
}

// ── Tests found in a body ─────────────────────────────────────────────────────

type TestType = "key" | "button" | "mod";

interface Test {
  type: TestType;
  name: string;
  negated: boolean;
  /** Absolute offset of the test in the masked text. */
  at: number;
}

interface Roles {
  key?: string;
  button?: string;
}

const occurrences = (s: string, param: string): number =>
  [...s.matchAll(new RegExp(`(?<![\\w.])${escapeRe(param)}(?!\\w)`, "g"))].length;

function roleTests(
  s: string,
  bs: number,
  be: number,
  type: "key" | "button",
  param: string,
): Test[] {
  const P = `(?<![\\w.])${escapeRe(param)}(?!\\w)`;
  const C = type === "key" ? "KeyCode" : "WETMouseButtonFlag";
  const body = s.slice(bs, be);
  const out: Test[] = [];
  const eq = new RegExp(`${P}\\s*(==|!=)\\s*${C}\\.(\\w+)|${C}\\.(\\w+)\\s*(==|!=)\\s*${P}`, "g");
  for (const m of body.matchAll(eq)) {
    const op = m[1] ?? m[4];
    out.push({ type, name: m[2] ?? m[3], negated: op === "!=", at: bs + (m.index ?? 0) });
  }
  if (type === "button") {
    const bit = new RegExp(`${P}\\s*&\\s*${C}\\.(\\w+)|${C}\\.(\\w+)\\s*&\\s*${P}`, "g");
    for (const m of body.matchAll(bit))
      out.push({ type, name: m[1] ?? m[2], negated: false, at: bs + (m.index ?? 0) });
  }
  return out;
}

interface ModTests {
  tests: Test[];
  /** Offsets of `GetModifierKeyState` calls whose argument is not a `ModifierKey` constant. */
  computed: number[];
}

function modifierTests(s: string, bs: number, be: number): ModTests {
  const body = s.slice(bs, be);
  const tests: Test[] = [];
  const computed: number[] = [];
  const re = /(?<![\w])GetModifierKeyState\s*\(\s*([^)]*?)\s*\)/g;
  for (const m of body.matchAll(re)) {
    const at = bs + (m.index ?? 0);
    const arg = /^(?:ModifierKey\s*\.\s*)(\w+)$/.exec(m[1]);
    if (!arg) {
      computed.push(at);
      continue;
    }
    const before = body
      .slice(0, m.index ?? 0)
      .replace(/(?:WorldEditorTool|this)\s*\.\s*$/, "")
      .trimEnd();
    const after = body.slice((m.index ?? 0) + m[0].length);
    const negated = before.endsWith("!") || /^\s*(==\s*false|!=\s*true)\b/.test(after);
    tests.push({ type: "mod", name: arg[1], negated, at });
  }
  return { tests, computed };
}

// ── Analysis of one override ──────────────────────────────────────────────────

interface Region {
  start: number;
  end: number;
  kind: "block" | "guard" | "whole";
}

/** One gesture found in a body. */
interface Unit {
  file: SrcFile;
  mods: string[];
  /** Key or button constants. */
  kbs: string[];
  /** Offset of the first test (its line is the row's `ref`). */
  testAt: number;
  region: Region;
  /** Offset whose line starts the comment search; null when none applies. */
  anchor: number | null;
  /** Span of the statement the unit gates, blanked when looking for ungated code. */
  span: [number, number];
  /** Name of the helper the tests were read in, when delegated. */
  via?: string;
  /** Confidence of the reading. */
  confidence: "high" | "medium";
  /** The override's own doc applies (a guard on the whole body). */
  useDoc?: boolean;
  /** The region is the behaviour without the test (a negated test without `else`); its code still runs. */
  plain?: boolean;
}

interface Unresolved {
  kind: "delegated" | "computed";
  callee?: string;
  line: number;
  file: string;
}

interface Analysis {
  units: Unit[];
  /** Code outside every test still runs for the event. */
  bare: boolean;
  unresolved: Unresolved[];
  /** The body could not be found or read. */
  failed?: string;
}

interface Ctx {
  index: SourceIndex;
  getFile: (path: string) => SrcFile;
  /** The tool class the override is read for. */
  tool: string;
}

const sortMods = (mods: string[]): string[] => {
  const u = [...new Set(mods)];
  const rank = (x: string): number => {
    const i = MODIFIER_ORDER.indexOf(x);
    return i < 0 ? MODIFIER_ORDER.length : i;
  };
  return u.sort((a, b) => rank(a) - rank(b) || compareCodeUnits(a, b));
};

function innerCond(conds: Cond[], at: number): number {
  let best = -1;
  for (let i = 0; i < conds.length; i++) {
    const c = conds[i];
    if (at >= c.textStart && at < c.textEnd) {
      if (best < 0 || conds[best].textEnd - conds[best].textStart > c.textEnd - c.textStart)
        best = i;
    }
  }
  return best;
}

const isReturnOnly = (s: string, c: Cond): boolean =>
  /^\{?\s*return\b[^;]*;\s*\}?$/.test(s.slice(c.thenStart, c.thenEnd).trim());

/** Statement around offset `at`: from the previous `;`, `{` or `}` to the next `;`. */
function statementAround(s: string, at: number, lo: number, hi: number): [number, number] {
  let a = at;
  while (a > lo && !";{}".includes(s[a - 1])) a--;
  let b = at;
  while (b < hi && s[b] !== ";") b++;
  return [a, Math.min(b + 1, hi)];
}

interface CallWithArg {
  qualifier?: string;
  callee: string;
  argIndex: number;
  argCount: number;
  at: number;
  close: number;
  /** How many arguments are exactly the parameter. */
  hits: number;
}

function callsWithArg(s: string, bs: number, be: number, param: string): CallWithArg[] {
  const out: CallWithArg[] = [];
  const re = /(?:(?<![\w.])(\w+)\s*\.\s*)?(?<![\w])([A-Za-z_]\w*)\s*\(/g;
  re.lastIndex = bs;
  for (let m = re.exec(s); m !== null && m.index < be; m = re.exec(s)) {
    if (KEYWORDS.has(m[2])) continue;
    const open = m.index + m[0].length - 1;
    const close = findMatching(s, open);
    if (close < 0 || close > be) continue;
    const args = splitTop(s.slice(open + 1, close)).map((a) => a.trim());
    const hits = args.filter((a) => a === param).length;
    if (hits === 0) continue;
    out.push({
      qualifier: m[1],
      callee: m[2],
      argIndex: args.indexOf(param),
      argCount: args.length,
      at: m.index,
      close,
      hits,
    });
  }
  return out;
}

/** The method a call resolves to: its declaration and the class that declares it. */
function resolveHelper(
  ctx: Ctx,
  call: CallWithArg,
  declaringClass: string,
): { method: MethodRecord; declaredIn: string } | null {
  let views: ReturnType<typeof methodsOf> = [];
  if (call.qualifier === undefined || call.qualifier === "this") {
    views = methodsOf(ctx.index, ctx.tool);
  } else if (call.qualifier === "super") {
    const chain = classChain(ctx.index, ctx.tool);
    const at = chain.findIndex((c) => c.name === declaringClass);
    const parent = at >= 0 ? chain[at + 1] : undefined;
    views = parent ? methodsOf(ctx.index, parent.name) : [];
  } else if (findClass(ctx.index, call.qualifier)) {
    views = methodsOf(ctx.index, call.qualifier);
  }
  const hit = views.find(
    (v) =>
      v.method.name === call.callee &&
      v.method.arity === call.argCount &&
      v.method.has_body &&
      v.method.params[call.argIndex]?.name !== undefined,
  );
  return hit ? { method: hit.method, declaredIn: hit.declared_in } : null;
}

interface OwnCall {
  at: number;
  declaredIn: string;
  method: MethodRecord;
  key: string;
}

/** Calls in `[bs, be)` of a file to methods of the tool class (itself or an ancestor) that have a body. */
function ownCalls(
  ctx: Ctx,
  f: SrcFile,
  bs: number,
  be: number,
  seen: ReadonlySet<string>,
): OwnCall[] {
  const out: OwnCall[] = [];
  const views = methodsOf(ctx.index, ctx.tool);
  const s = f.masked;
  const re = /(?:(?<![\w.])(\w+)\s*\.\s*)?(?<![\w])([A-Za-z_]\w*)\s*\(/g;
  re.lastIndex = bs;
  for (let m = re.exec(s); m !== null && m.index < be; m = re.exec(s)) {
    const name = m[2];
    if (KEYWORDS.has(name) || (m[1] !== undefined && m[1] !== "this")) continue;
    if (name in INPUT_EVENTS || LIFECYCLE_EVENTS.includes(name)) continue;
    const open = m.index + m[0].length - 1;
    const close = findMatching(s, open);
    if (close < 0 || close > be) continue;
    const argCount = splitTop(s.slice(open + 1, close)).length;
    const hit = views.find(
      (v) => v.method.name === name && v.method.arity === argCount && v.method.has_body,
    );
    if (!hit) continue;
    const key = `${hit.declared_in}.${name}/${argCount}`;
    if (seen.has(key)) continue;
    out.push({ at: m.index, declaredIn: hit.declared_in, method: hit.method, key });
  }
  return out;
}

/** A modifier test found in a method that an override calls (directly or through other helpers). */
interface HelperMod {
  name: string;
  at: number;
  file: SrcFile;
  /** The first helper called from the override. */
  via: string;
}

function helperModifiers(
  ctx: Ctx,
  method: MethodRecord,
  depth: number,
  seen: Set<string>,
  via: string,
): HelperMod[] {
  const f = ctx.getFile(method.file);
  const loc = locateBody(f, method.name, method.line);
  if (!loc) return [];
  const bs = loc.open + 1;
  const be = loc.close;
  const out: HelperMod[] = modifierTests(f.masked, bs, be).tests.map((t) => ({
    name: t.name,
    at: t.at,
    file: f,
    via,
  }));
  if (depth < MAX_DELEGATION_DEPTH) {
    for (const call of ownCalls(ctx, f, bs, be, seen)) {
      seen.add(call.key);
      out.push(...helperModifiers(ctx, call.method, depth + 1, seen, via));
    }
  }
  return out;
}

/**
 * Combinations made through variables. `bool v = GetModifierKeyState(ModifierKey.X);`
 * names one modifier; when `v` is later passed on to a method of the tool (a
 * call that resolves to a body) inside a branch of `if (w)` (`w` another such
 * variable), the call is the gesture of `w`'s modifier and `v`'s together:
 * `if (ctrl) ToReplace(name, shift); else ReplaceWith(name, shift);` handles
 * Ctrl+Shift in the then-branch. The else-branch of `if (w)` stands for `w`'s
 * partner `u` (confidence `medium`) when an earlier `if (w == u) { ...; return; }`
 * at the same level of the body ended the case where both or neither hold, so
 * `u` is true there. A call with no enclosing variable test adds nothing (the
 * test of `v` alone is already a row).
 */
function variableModifierUnits(
  ctx: Ctx,
  f: SrcFile,
  s: string,
  bs: number,
  be: number,
  conds: Cond[],
  declaredIn: string,
  confidence: "high" | "medium",
): Unit[] {
  const vars = new Map<string, string>();
  const declRe =
    /(?<![\w.])(?:bool|int)\s+(\w+)\s*=\s*(?:(?:WorldEditorTool|this)\s*\.\s*)?GetModifierKeyState\s*\(\s*ModifierKey\s*\.\s*(\w+)\s*\)\s*;/g;
  for (const m of s.slice(bs, be).matchAll(declRe)) vars.set(m[1], m[2]);
  if (vars.size < 2) return [];

  const exits = (c: Cond): boolean =>
    /\breturn\b[^;{}]*;\s*\}$/.test(s.slice(c.thenStart, c.thenEnd).trim());
  const sameLevel = (e: Cond, c: Cond): boolean =>
    conds.every((x) => !(x.kwIdx < e.kwIdx && e.kwIdx < x.stmtEnd) || c.kwIdx < x.stmtEnd);
  /** The variable that must be true where `w` is false: the other side of an earlier exclusive `w == u`. */
  const partner = (c: Cond, w: string): string | undefined => {
    for (const e of conds) {
      if (e.kw !== "if" || e.stmtEnd > c.kwIdx || !exits(e) || !sameLevel(e, c)) continue;
      const eq = /^(\w+)\s*==\s*(\w+)$/.exec(e.text.trim());
      if (!eq || !vars.has(eq[1]) || !vars.has(eq[2]) || eq[1] === eq[2]) continue;
      if (eq[1] === w) return eq[2];
      if (eq[2] === w) return eq[1];
    }
    return undefined;
  };

  const out: Unit[] = [];
  for (const [v, vMod] of [...vars.entries()].sort((a, b) => compareCodeUnits(a[0], b[0]))) {
    for (const call of callsWithArg(s, bs, be, v)) {
      if (IGNORED_CALLEES.has(call.callee)) continue;
      const helper = resolveHelper(ctx, call, declaredIn);
      if (!helper) continue;
      const mods = new Set<string>();
      let inferred = false;
      for (const c of conds) {
        if (c.kw !== "if") continue;
        const t = /^(!?)\s*(\w+)$/.exec(c.text.trim());
        if (!t || !vars.has(t[2])) continue;
        const inThen = call.at >= c.thenStart && call.at < c.thenEnd;
        const inElse =
          c.elseStart !== undefined && call.at >= c.elseStart && call.at < (c.elseEnd ?? 0);
        if (!inThen && !inElse) continue;
        if ((t[1] === "") === inThen) mods.add(vars.get(t[2]) as string);
        else {
          const u = partner(c, t[2]);
          if (u !== undefined) {
            mods.add(vars.get(u) as string);
            inferred = true;
          }
        }
      }
      if (mods.size === 0) continue;
      mods.add(vMod);
      const [a, b] = statementAround(s, call.at, bs, be);
      out.push({
        file: f,
        mods: sortMods([...mods]),
        kbs: [],
        testAt: call.at,
        region: { start: call.at, end: call.at, kind: "whole" },
        anchor: call.at,
        span: [a, b],
        via: `${helper.declaredIn}.${helper.method.name}`,
        confidence: inferred ? "medium" : confidence,
      });
    }
  }
  return out;
}

function analyzeMethod(
  ctx: Ctx,
  method: MethodRecord,
  declaredIn: string,
  roles: Roles,
  depth: number,
  seen: Set<string>,
  via?: string,
): Analysis {
  const f = ctx.getFile(method.file);
  const loc = locateBody(f, method.name, method.line);
  const empty: Analysis = { units: [], bare: false, unresolved: [] };
  if (!loc) return { ...empty, failed: "body not found or its brackets do not match" };
  const s = f.masked;
  const bs = loc.open + 1;
  const be = loc.close;
  const conds = collectConds(s, bs, be);
  const unresolved: Unresolved[] = [];
  const units: Unit[] = [];
  const blanks: [number, number][] = [];
  const confidence: "high" | "medium" = "high";

  // ── Key and button tests, and delegation of the parameter.
  const tests: Test[] = [];
  const caseUnits: Unit[] = [];
  const subAnalyses: Analysis[] = [];
  /** Helpers that were read with the key or button they were given. */
  const delegated = new Set<string>();
  for (const type of ["key", "button"] as const) {
    const param = roles[type];
    if (!param) continue;
    const found = roleTests(s, bs, be, type, param);
    tests.push(...found);
    let recognized = found.length;
    // switch (param) { case Const.X: ... }
    const C = type === "key" ? "KeyCode" : "WETMouseButtonFlag";
    for (const c of conds) {
      if (c.kw !== "switch" || c.text.trim() !== param) continue;
      recognized++;
      const labels = [
        ...s.slice(c.thenStart, c.thenEnd).matchAll(new RegExp(`case\\s+${C}\\.(\\w+)\\s*:`, "g")),
      ];
      labels.forEach((lab, k) => {
        const at = c.thenStart + (lab.index ?? 0);
        const next = labels[k + 1];
        const end = next ? c.thenStart + (next.index ?? 0) : c.thenEnd;
        caseUnits.push({
          file: f,
          mods: [],
          kbs: [lab[1]],
          testAt: at,
          region: { start: at + lab[0].length, end, kind: "block" },
          anchor: at,
          span: [at, end],
          via,
          confidence,
        });
      });
      blanks.push([c.kwIdx, c.stmtEnd]);
    }
    // Everything else the parameter is used for.
    const total = occurrences(s.slice(bs, be), param);
    const calls = callsWithArg(s, bs, be, param);
    let explained = 0;
    for (const call of calls) {
      explained += call.hits;
      if (IGNORED_CALLEES.has(call.callee)) continue;
      const helper = depth < MAX_DELEGATION_DEPTH ? resolveHelper(ctx, call, declaredIn) : null;
      const key = helper ? `${helper.declaredIn}.${helper.method.name}/${helper.method.arity}` : "";
      if (helper && !seen.has(key)) {
        const sub = analyzeMethod(
          ctx,
          helper.method,
          helper.declaredIn,
          type === "key"
            ? { key: helper.method.params[call.argIndex].name as string }
            : { button: helper.method.params[call.argIndex].name as string },
          depth + 1,
          new Set([...seen, key]),
          call.qualifier === "super"
            ? (via ?? method.name)
            : `${helper.declaredIn}.${helper.method.name}`,
        );
        subAnalyses.push(sub);
        delegated.add(key);
        blanks.push(statementAround(s, call.at, bs, be));
      } else {
        unresolved.push({
          kind: "delegated",
          callee: call.callee,
          line: lineAt(f.lineStarts, call.at),
          file: f.path,
        });
      }
    }
    if (total - recognized - explained > 0) {
      const first = [
        ...s.slice(bs, be).matchAll(new RegExp(`(?<![\\w.])${escapeRe(param)}(?!\\w)`, "g")),
      ];
      unresolved.push({
        kind: "computed",
        line: lineAt(f.lineStarts, bs + (first[first.length - 1]?.index ?? 0)),
        file: f.path,
      });
    }
  }
  const mod = modifierTests(s, bs, be);
  for (const at of mod.computed)
    unresolved.push({ kind: "computed", line: lineAt(f.lineStarts, at), file: f.path });
  tests.push(...mod.tests);
  tests.sort((a, b) => a.at - b.at);

  // ── Group the tests by the innermost condition that holds them.
  const byCond = new Map<number, Test[]>();
  const loose: Test[] = [];
  for (const t of tests) {
    const ci = innerCond(conds, t.at);
    if (ci < 0 || conds[ci].kw === "switch") loose.push(t);
    else byCond.set(ci, [...(byCond.get(ci) ?? []), t]);
  }

  const toParts = (ts: Test[]): { mods: string[]; kbs: string[] } => ({
    mods: sortMods(ts.filter((t) => t.type === "mod").map((t) => t.name)),
    kbs: [...new Set(ts.filter((t) => t.type !== "mod").map((t) => t.name))],
  });

  for (const [ci, group] of [...byCond.entries()].sort((a, b) => a[0] - b[0])) {
    const c = conds[ci];
    const sets: Test[][] = c.text.includes("||") ? group.map((t) => [t]) : [group];
    for (const set of sets) {
      const pos = set.filter((t) => !t.negated);
      const neg = set.filter((t) => t.negated);
      const span: [number, number] = [c.kwIdx, c.stmtEnd];
      if (pos.length > 0) {
        const kbAll = pos.filter((t) => t.type !== "mod");
        if (kbAll.length > 1 && !c.text.includes("||")) {
          for (const t of kbAll)
            units.push({
              ...toUnit(f, [t], c.thenStart, c.thenEnd, "block", c.kwIdx, span, via, confidence),
            });
        } else {
          units.push(
            toUnit(f, pos, c.thenStart, c.thenEnd, "block", c.kwIdx, span, via, confidence),
          );
        }
      } else if (neg.length > 0) {
        if (isReturnOnly(s, c)) {
          units.push(
            toUnit(f, neg, c.stmtEnd, be, "guard", c.kwIdx, [c.kwIdx, be], via, confidence, true),
          );
        } else if (c.elseStart !== undefined && c.elseEnd !== undefined) {
          units.push(
            toUnit(
              f,
              neg,
              c.elseStart,
              c.elseEnd,
              "block",
              c.elseKwIdx ?? c.kwIdx,
              span,
              via,
              confidence,
            ),
          );
        } else {
          // No `else`: the then-branch is the behaviour without the key, button or
          // modifier, and still runs; the test is still what a gesture changes.
          const u = toUnit(f, neg, c.thenStart, c.thenEnd, "block", c.kwIdx, span, via, confidence);
          u.plain = true;
          units.push(u);
        }
      }
    }
  }
  for (const t of loose) {
    if (t.type !== "mod" && t.negated) continue;
    const [a, b] = statementAround(s, t.at, bs, be);
    const p = toParts([t]);
    units.push({
      file: f,
      mods: p.mods,
      kbs: p.kbs,
      testAt: t.at,
      region: { start: bs, end: be, kind: "whole" },
      anchor: null,
      span: [a, b],
      via,
      confidence,
    });
  }
  units.push(...caseUnits);
  units.push(...variableModifierUnits(ctx, f, s, bs, be, conds, declaredIn, confidence));

  // ── Nest modifier tests under the key or button whose region holds them.
  const kbUnits = units.filter((u) => u.kbs.length > 0);
  const modUnits = units.filter((u) => u.kbs.length === 0);
  const drop = new Set<Unit>();
  for (const m of modUnits) {
    let inner: Unit | undefined;
    for (const k of kbUnits) {
      if (m.testAt >= k.region.start && m.testAt < k.region.end && k.region.kind !== "whole") {
        if (!inner || k.region.end - k.region.start < inner.region.end - inner.region.start)
          inner = k;
      }
    }
    if (inner) m.kbs = [...inner.kbs];
  }
  for (const k of kbUnits) {
    const wrappers = modUnits.filter(
      (m) =>
        m.region.kind === "block" &&
        k.testAt >= m.region.start &&
        k.testAt < m.region.end &&
        m.kbs.length === 0,
    );
    if (wrappers.length > 0) {
      k.mods = sortMods([...wrappers.flatMap((w) => w.mods), ...k.mods]);
      for (const w of wrappers) drop.add(w);
    }
  }
  const own = units.filter((u) => !drop.has(u));

  // ── Modifier tests in the methods the override calls (not read when the call is
  // a key helper: that one is followed above). The call site's key or button is
  // the one whose region holds the call.
  const viaUnits: Unit[] = [];
  if (depth === 0) {
    for (const call of ownCalls(ctx, f, bs, be, new Set([...seen, ...delegated]))) {
      const mods = helperModifiers(
        ctx,
        call.method,
        1,
        new Set([...seen, call.key]),
        `${call.declaredIn}.${call.method.name}`,
      );
      let inner: Unit | undefined;
      for (const k of own) {
        if (
          k.kbs.length > 0 &&
          k.region.kind !== "whole" &&
          call.at >= k.region.start &&
          call.at < k.region.end &&
          (!inner || k.region.end - k.region.start < inner.region.end - inner.region.start)
        )
          inner = k;
      }
      for (const hm of mods)
        viaUnits.push({
          file: hm.file,
          mods: [hm.name],
          kbs: inner ? [...inner.kbs] : [],
          testAt: hm.at,
          region: { start: hm.at, end: hm.at, kind: "whole" },
          anchor: hm.at,
          span: [0, 0],
          via: hm.via,
          confidence: "medium",
        });
    }
  }

  // ── Code outside every test (the event is handled whatever the key).
  const rest = s.slice(bs, be).split("");
  const blank = (a: number, b: number): void => {
    for (let k = Math.max(a, bs); k < Math.min(b, be); k++)
      if (rest[k - bs] !== "\n") rest[k - bs] = " ";
  };
  for (const u of own) if (!u.plain) blank(u.span[0], u.span[1]);
  for (const u of own) if (u.region.kind === "guard") blank(u.region.start, u.region.end);
  for (const [a, b] of blanks) blank(a, b);
  // A log line does not handle the event.
  const restText = rest
    .join("")
    .replace(/\b(if|while|for|foreach|switch|return|else)\b/g, " ")
    .replace(/\bPrint(Format)?\s*\(/g, " ");
  let bare = /[A-Za-z_]\w*\s*\(/.test(restText);

  const all = [...own, ...viaUnits];
  for (const sub of subAnalyses) {
    all.push(...sub.units.map((u) => ({ ...u, via: u.via ?? via })));
    unresolved.push(...sub.unresolved);
    if (sub.bare) bare = true;
    if (sub.failed)
      unresolved.push({
        kind: "delegated",
        callee: "(helper body)",
        line: method.line,
        file: f.path,
      });
  }
  return { units: all, bare, unresolved };
}

function toUnit(
  f: SrcFile,
  ts: Test[],
  rs: number,
  re: number,
  kind: Region["kind"],
  anchor: number,
  span: [number, number],
  via: string | undefined,
  confidence: "high" | "medium",
  useDoc = false,
): Unit {
  const mods = sortMods(ts.filter((t) => t.type === "mod").map((t) => t.name));
  const kbs = [...new Set(ts.filter((t) => t.type !== "mod").map((t) => t.name))];
  const u: Unit = {
    file: f,
    mods,
    kbs,
    testAt: Math.min(...ts.map((t) => t.at)),
    region: { start: rs, end: re, kind },
    anchor,
    span,
    confidence,
  };
  if (via !== undefined) u.via = via;
  if (useDoc) u.useDoc = true;
  return u;
}

// ── Comments and signatures ───────────────────────────────────────────────────

function commentText(c: CommentSpan): string {
  return cleanDoc(c.raw).replace(/\s+/g, " ").trim();
}
const hasWords = (t: string): boolean => /[A-Za-z]{2}/.test(t);

/** The comment that explains a test: its own line, the lines above it, the start of its block. */
function commentFor(u: Unit): string | undefined {
  const f = u.file;
  if (u.anchor !== null) {
    const line = lineAt(f.lineStarts, u.anchor);
    const trailing = f.comments.find((c) => c.trailing && c.line === line);
    if (trailing && hasWords(commentText(trailing))) return commentText(trailing);
    const above: string[] = [];
    let l = line - 1;
    for (;;) {
      const c = f.comments.find((x) => !x.trailing && x.endLine === l);
      if (!c) break;
      const t = commentText(c);
      if (hasWords(t)) above.unshift(t);
      l = c.line - 1;
    }
    if (above.length > 0) return above.join(" ");
  }
  if (u.region.kind === "block") {
    let first = skipWs(f.masked, u.region.start);
    if (f.masked[first] === "{") first++;
    const c1 = Math.min(skipWs(f.masked, first), u.region.end);
    const L1 = lineAt(f.lineStarts, c1);
    // A trailing comment on a first statement that is itself a condition or loop
    // describes that inner condition, not the gesture.
    const firstIsControl = /^(?:if|while|for|foreach|switch|else)\b/.test(
      f.masked.slice(c1, c1 + 8),
    );
    const inside = f.comments.filter(
      (c) =>
        c.start >= u.region.start &&
        c.start < u.region.end &&
        (c.start < c1 || (c.trailing && c.line === L1 && !firstIsControl)) &&
        hasWords(commentText(c)),
    );
    if (inside.length > 0) return commentText(inside[0]);
  }
  return undefined;
}

/** The override's doc comment without its parameter lines and its "see WorldEditorTool.…" line. */
export function overrideDoc(doc: string | undefined): string | undefined {
  if (!doc) return undefined;
  const lines = doc
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "" && !/^[\\@](param|return|returns|see)\b/.test(l))
    .filter((l) => !/see\s+WorldEditorTool\./i.test(l))
    .filter(hasWords);
  if (lines.length === 0) return undefined;
  return lines.join("; ");
}

/** Qualifiers whose calls are arithmetic or drawing helpers, not what the gesture does. */
const HELPER_QUALIFIERS = new Set(["vector", "Math", "Shape", "string", "float", "int", "bool"]);

/** The first three distinct methods called in `[a, b)` of a file, helpers and noise left out. */
function callsIn(f: SrcFile, a: number, b: number): string[] {
  const out: string[] = [];
  const re = /(?:(?<![\w])(\w+)\s*\.\s*)?(?<![\w])([A-Za-z_]\w*)\s*\(/g;
  const text = f.masked.slice(a, b);
  for (const m of text.matchAll(re)) {
    const name = m[2];
    if (KEYWORDS.has(name) || NOISE_CALLS.has(name)) continue;
    if (m[1] !== undefined && HELPER_QUALIFIERS.has(m[1])) continue;
    if (/^[A-Z0-9_]+$/.test(name)) continue;
    if (!out.includes(name)) out.push(name);
    if (out.length === 3) break;
  }
  return out;
}

// ── Rows ──────────────────────────────────────────────────────────────────────

export interface OverrideReport {
  event: string;
  declaredIn: string;
  ref: string;
  inherited: boolean;
  lifecycle: boolean;
  /** Reasons the override could not be interpreted; empty when it was. */
  uninterpreted: string[];
  rows: string[];
}

export interface ToolReport {
  class: string;
  module: Module;
  file: string;
  line: number;
  overrides: OverrideReport[];
}

export interface GestureResult {
  observations: { id: string; obs: Observation }[];
  tools: ToolReport[];
  /** Files whose text was read (declarations and bodies). */
  filesRead: string[];
  /** Descendants of WorldEditorTool, tools or not. */
  descendants: string[];
  /** Descendants without the attribute (no rows). */
  withoutAttribute: string[];
  /** Classes carrying the tool attribute that do not extend WorldEditorTool. */
  attributeOnly: string[];
  /** Methods WorldEditorTool declares as `event`. */
  events: string[];
  /** Gestures that were found twice for one tool (the first is kept). */
  duplicates: { id: string; refs: string[] }[];
  /** Fields dropped from a row because they held a machine path. */
  scrubbed: { id: string; field: string }[];
  /** Distinct constants tested, with the number of rows that name each. */
  tested: {
    keys: Record<string, number>;
    buttons: Record<string, number>;
    modifiers: Record<string, number>;
  };
  leftOut: Record<string, number>;
}

/** A gesture name: the event label and the parts, e.g. `MousePress ALT+LEFT`. */
export function gestureName(label: string, mods: string[], kbs: string[]): string {
  const parts = [...mods, ...kbs];
  return parts.length === 0 ? label : `${label} ${parts.join("+")}`;
}

function quoteOf(f: SrcFile, line: number): string | undefined {
  const raw = f.text.split("\n")[line - 1]?.replace(/\r$/, "").trim();
  return raw ? raw.slice(0, QUOTE_MAX) : undefined;
}

function toolClasses(index: SourceIndex): { all: MergedClass[]; tools: MergedClass[] } {
  const seen = new Set<string>();
  const visit = (name: string): void => {
    for (const c of subclassesOf(index, name)) {
      if (!seen.has(c.name)) {
        seen.add(c.name);
        visit(c.name);
      }
    }
  };
  visit(TOOL_BASE);
  const all = [...seen]
    .sort(compareCodeUnits)
    .map((n) => index.classes.get(n))
    .filter((c): c is MergedClass => c !== undefined && c.declarations.some((d) => !d.forward));
  const tools = all.filter((c) => c.attributes.some((a) => a.name === TOOL_ATTRIBUTE));
  return { all, tools };
}

/**
 * Gesture rows for every tool of the index. `readText(path)` gives the text of
 * a script file; `fileHashes` (path to sha256 of the text, from the index)
 * makes a changed file an error instead of a silent line mismatch.
 */
export function enumerateGestures(
  index: SourceIndex,
  readText: (path: string) => string,
): GestureResult {
  const cache = new Map<string, SrcFile>();
  const fileHashes = new Map(index.files.map((x) => [x.file, x.sha256]));
  const filesRead = new Set<string>();
  const getFile = (path: string): SrcFile => {
    let f = cache.get(path);
    if (!f) {
      const text = readText(path);
      const want = fileHashes.get(path);
      if (want !== undefined && sha256(text) !== want)
        throw new Error(
          `stale source index: ${path} differs from the text the index was built from`,
        );
      f = prepareSource(path, text);
      cache.set(path, f);
      filesRead.add(path);
    }
    return f;
  };

  const base = findClass(index, TOOL_BASE);
  const events = (base?.methods ?? [])
    .filter((m) => m.modifiers.includes("event"))
    .map((m) => m.name);
  const eventSet = new Set(events);
  const { all, tools } = toolClasses(index);
  const attributeOnly = [...index.classes.values()]
    .filter(
      (c) =>
        c.attributes.some((a) => a.name === TOOL_ATTRIBUTE) &&
        !classChain(index, c.name).some((x) => x.name === TOOL_BASE),
    )
    .map((c) => c.name)
    .sort(compareCodeUnits);

  const observations: GestureResult["observations"] = [];
  const reports: ToolReport[] = [];
  const duplicates: GestureResult["duplicates"] = [];
  const scrubbed: GestureResult["scrubbed"] = [];
  const leftOut: Record<string, number> = {};
  const tested = {
    keys: {} as Record<string, number>,
    buttons: {} as Record<string, number>,
    modifiers: {} as Record<string, number>,
  };
  const bump = (m: Record<string, number>, k: string): void => {
    m[k] = (m[k] ?? 0) + 1;
  };

  for (const tool of tools) {
    const decl = tool.declarations.find((d) => !d.modded && !d.forward) ?? tool.declarations[0];
    const attr = tool.attributes.find((a) => a.name === TOOL_ATTRIBUTE);
    const module = moduleOfAttribute(attr?.args);
    getFile(decl.file);
    const report: ToolReport = {
      class: tool.name,
      module,
      file: decl.file,
      line: decl.line,
      overrides: [],
    };
    const ctx: Ctx = { index, getFile, tool: tool.name };
    const parent = {
      dim: "plugin" as const,
      kind: "tool" as const,
      module,
      key: { class: tool.name },
    };
    const seenIds = new Map<string, string>();

    const views = methodsOf(index, tool.name).filter(
      (v) => v.declared_in !== TOOL_BASE && v.method.has_body && eventSet.has(v.method.name),
    );
    for (const v of views) {
      const m = v.method;
      const lifecycle = !(m.name in INPUT_EVENTS) && LIFECYCLE_EVENTS.includes(m.name);
      const o: OverrideReport = {
        event: m.name,
        declaredIn: v.declared_in,
        ref: pakRef(m),
        inherited: v.inherited,
        lifecycle,
        uninterpreted: [],
        rows: [],
      };
      report.overrides.push(o);
      if (lifecycle) {
        leftOut[`lifecycle override (${m.name})`] =
          (leftOut[`lifecycle override (${m.name})`] ?? 0) + 1;
        continue;
      }
      const ev: InputEvent = INPUT_EVENTS[m.name] ?? {
        label: m.name.replace(/^On/, "").replace(/Event$/, ""),
      };
      const roles: Roles = {};
      if (ev.keyParam !== undefined && m.params[ev.keyParam]?.name)
        roles.key = m.params[ev.keyParam].name as string;
      if (ev.buttonParam !== undefined && m.params[ev.buttonParam]?.name)
        roles.button = m.params[ev.buttonParam].name as string;
      const f = getFile(m.file);
      const a = analyzeMethod(
        ctx,
        m,
        v.declared_in,
        roles,
        0,
        new Set([`${v.declared_in}.${m.name}/${m.arity}`]),
      );
      if (a.failed) o.uninterpreted.push(a.failed);
      for (const u of a.unresolved)
        o.uninterpreted.push(
          u.kind === "delegated"
            ? `parameter passed to ${u.callee ?? "a call"} (not resolved) at ${u.file}#L${u.line}`
            : `parameter or modifier used in an expression this reading does not follow at ${u.file}#L${u.line}`,
        );
      const doc = overrideDoc(m.doc);

      interface Draft {
        gesture: string;
        file: SrcFile;
        line: number;
        what?: string;
        signature: string;
        confidence: "high" | "medium";
        mods: string[];
        kbs: string[];
      }
      const drafts: Draft[] = [];
      const unitsSorted = [...a.units].sort(
        (x, y) =>
          Number(x.via !== undefined) - Number(y.via !== undefined) ||
          compareCodeUnits(x.file.path, y.file.path) ||
          x.testAt - y.testAt,
      );
      for (const u of unitsSorted) {
        const calls =
          u.region.kind === "block" ? callsIn(u.file, u.region.start, u.region.end) : [];
        const sigBase = u.via ? `${m.name} via ${u.via}` : m.name;
        drafts.push({
          gesture: gestureName(ev.label, u.mods, u.kbs),
          file: u.file,
          line: lineAt(u.file.lineStarts, u.testAt),
          what: commentFor(u) ?? (u.useDoc ? doc : undefined),
          signature: calls.length > 0 ? `${sigBase} -> ${calls.join(", ")}` : sigBase,
          confidence: u.confidence,
          mods: u.mods,
          kbs: u.kbs,
        });
      }
      const noTests = a.units.length === 0;
      if (noTests || a.bare || o.uninterpreted.length > 0) {
        const delegated = a.unresolved.find((u) => u.kind === "delegated");
        const mediumReason = o.uninterpreted.length > 0;
        const sig = delegated
          ? `${m.name} -> ${delegated.callee ?? "a call"} (parameter passed on, not resolved)`
          : mediumReason
            ? `${m.name} (parameter used in an expression this reading does not follow)`
            : m.name;
        drafts.push({
          gesture: ev.label,
          file: f,
          line: m.line,
          what: doc,
          signature: sig,
          confidence: mediumReason ? "medium" : "high",
          mods: [],
          kbs: [],
        });
      }

      for (const d of drafts) {
        const obsRaw: Observation = {
          dim: "ui",
          kind: "canvas-gesture",
          module,
          key: { path: [tool.name, d.gesture] },
          parent_key: parent,
          label: d.gesture,
          signature: d.signature,
          what: d.what !== undefined ? d.what.slice(0, WHAT_MAX) : undefined,
          origin: "vanilla",
          ref: `pak:${d.file.path}#L${d.line}`,
          quote: quoteOf(d.file, d.line),
          confidence: d.confidence,
        };
        const id0 = deriveId({ dim: "ui", kind: "canvas-gesture", module, key: obsRaw.key });
        for (const field of ["signature", "what", "quote"] as const) {
          const val = obsRaw[field];
          if (val === undefined) delete obsRaw[field];
          else if (containsMachinePath(val)) {
            delete obsRaw[field];
            scrubbed.push({ id: id0, field });
          }
        }
        const obs = observationSchema.parse(obsRaw);
        const id = deriveId(obs);
        const prior = seenIds.get(id);
        if (prior !== undefined) {
          const dup = duplicates.find((x) => x.id === id);
          if (dup) dup.refs.push(obs.ref);
          else duplicates.push({ id, refs: [prior, obs.ref] });
          continue;
        }
        seenIds.set(id, obs.ref);
        observations.push({ id, obs });
        o.rows.push(d.gesture);
        for (const k of d.kbs) {
          if (ev.keyParam !== undefined) bump(tested.keys, k);
          else bump(tested.buttons, k);
        }
        for (const md of d.mods) bump(tested.modifiers, md);
      }
    }
    reports.push(report);
  }

  observations.sort((x, y) => compareCodeUnits(x.id, y.id));
  return {
    observations,
    tools: reports,
    filesRead: [...filesRead].sort(compareCodeUnits),
    descendants: all.map((c) => c.name),
    withoutAttribute: all
      .filter((c) => !tools.includes(c))
      .map((c) => c.name)
      .sort(compareCodeUnits),
    attributeOnly,
    events,
    duplicates,
    scrubbed,
    tested,
    leftOut,
  };
}

// ── Output ────────────────────────────────────────────────────────────────────

export interface Headline {
  classes_extending_tool: number;
  classes_extending_tool_with_attribute: number;
  classes_with_tool_attribute: number;
  tool_attribute_classes_not_extending_tool: string[];
  event_methods_declared: string[];
  overrides_per_tool: Record<string, { input: number; lifecycle: number; events: string[] }>;
  gesture_rows_per_tool: Record<string, number>;
  distinct_keys: string[];
  distinct_buttons: string[];
  distinct_modifiers: string[];
  overrides_not_interpreted: { tool: string; event: string; ref: string; reasons: string[] }[];
  rows: number;
}

export function headline(r: GestureResult, index: SourceIndex): Headline {
  const overrides: Headline["overrides_per_tool"] = {};
  const rows: Record<string, number> = {};
  const notInterpreted: Headline["overrides_not_interpreted"] = [];
  for (const t of r.tools) {
    overrides[t.class] = {
      input: t.overrides.filter((o) => !o.lifecycle).length,
      lifecycle: t.overrides.filter((o) => o.lifecycle).length,
      events: t.overrides.map((o) => o.event),
    };
    rows[t.class] = t.overrides.reduce((n, o) => n + o.rows.length, 0);
    for (const o of t.overrides)
      if (o.uninterpreted.length > 0)
        notInterpreted.push({
          tool: t.class,
          event: o.event,
          ref: o.ref,
          reasons: o.uninterpreted,
        });
  }
  const withAttr = [...index.classes.values()].filter((c) =>
    c.attributes.some((a) => a.name === TOOL_ATTRIBUTE),
  ).length;
  return {
    classes_extending_tool: r.descendants.length,
    classes_extending_tool_with_attribute: r.tools.length,
    classes_with_tool_attribute: withAttr,
    tool_attribute_classes_not_extending_tool: r.attributeOnly,
    event_methods_declared: r.events,
    overrides_per_tool: overrides,
    gesture_rows_per_tool: rows,
    distinct_keys: Object.keys(r.tested.keys).sort(compareCodeUnits),
    distinct_buttons: Object.keys(r.tested.buttons).sort(compareCodeUnits),
    distinct_modifiers: Object.keys(r.tested.modifiers).sort(compareCodeUnits),
    overrides_not_interpreted: notInterpreted,
    rows: r.observations.length,
  };
}

export interface FileInput {
  path: string;
  sha256: string;
}

/** Exact text of the E18 observation file. */
export function observationFileText(
  r: GestureResult,
  build: string,
  inputs: readonly FileInput[],
): string {
  const header = {
    $header: 1,
    build,
    enumerator: ENUMERATOR_ID,
    generator: GENERATOR,
    inputs: [...inputs],
    provisional: false,
    row_count: r.observations.length,
  };
  return (
    [jsonlLine(header, ["$header"]), ...r.observations.map((o) => jsonlLine(o.obs))].join("\n") +
    "\n"
  );
}

// ── Sources ───────────────────────────────────────────────────────────────────

export interface ScriptSource {
  list(): string[];
  readText(path: string): string;
  readBytes(path: string): Buffer;
}

/** A directory of loose script files as a source (tests, extracted trees). */
export function directoryScriptSource(root: string): ScriptSource {
  const out: string[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      compareCodeUnits(a.name, b.name),
    )) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(join(dir, e.name), r);
      else if (e.name.endsWith(".c")) out.push(r);
    }
  };
  walk(root, "");
  return {
    list: () => out,
    readText: (p) => readFileSync(join(root, p), "utf-8"),
    readBytes: (p) => readFileSync(join(root, p)),
  };
}

function pakSource(vfs: PakVirtualFS): ScriptSource {
  return {
    list: () => vfs.allFilePaths(),
    readText: (p) => vfs.readTextFile(p),
    readBytes: (p) => vfs.readFile(p),
  };
}

// ── CLI ───────────────────────────────────────────────────────────────────────

const USAGE =
  "usage: e18-tool-gestures.ts [--build <tag>] [--game <dir> | --scripts <dir of .c files>] [--out <file under observations/E18/>] [--data <dir>] [--json]";

/** Resolves `--out`, refusing anything outside `<census>/observations/E18/`. */
export function resolveOut(paths: CensusPaths, out: string | undefined, build: string): string {
  const dir = join(paths.observations, ENUMERATOR_ID);
  const file = out ? resolve(out) : join(dir, `${build}.jsonl`);
  if (dirname(file) !== dir || !file.endsWith(".jsonl")) {
    throw new Error(
      "refusing --out outside observations/E18/ (E18 writes only its own observation directory)",
    );
  }
  return file;
}

export function run(argv: string[], io: Io = PROCESS_IO): number {
  return guard(io, "e18-tool-gestures", () => {
    const { values } = parseArgs({
      args: argv,
      options: {
        build: { type: "string" },
        game: { type: "string" },
        scripts: { type: "string" },
        out: { type: "string" },
        data: { type: "string" },
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
      io.err(`e18-tool-gestures: ${e instanceof Error ? e.message : String(e)}`);
      return EXIT_FAIL;
    }

    let source: ScriptSource | null = null;
    let index: SourceIndex | undefined;
    if (values.scripts) {
      const dir = resolve(values.scripts);
      source = existsSync(dir) ? directoryScriptSource(dir) : null;
      if (source) {
        const src = source;
        index = buildSourceIndex(
          src
            .list()
            .filter(isScriptSource)
            .map((p) => ({ path: p, text: src.readText(p) })),
          { build },
        );
      }
    } else {
      const gamePath = values.game ? resolve(values.game) : loadConfig().gamePath;
      const vfs =
        gamePath && existsSync(join(gamePath, "addons")) ? PakVirtualFS.get(gamePath) : null;
      if (vfs) {
        source = pakSource(vfs);
        index = loadSourceIndex(build) ?? buildSourceIndex(vfs, { build });
      }
    }
    if (!source || !index) {
      io.out(
        "NO DATA: no game install with pak files (set ENFUSION_GAME_PATH or pass --game / --scripts); nothing written",
      );
      return EXIT_USAGE;
    }

    const src = source;
    let result: GestureResult;
    try {
      result = enumerateGestures(index, (p) => src.readText(p));
    } catch (e) {
      io.err(`e18-tool-gestures: ${e instanceof Error ? e.message : String(e)}`);
      return EXIT_FAIL;
    }
    const inputs: FileInput[] = [
      { path: "<game>/addons/**/scripts/**/*.c", sha256: index.header.inputs_sha256 },
      ...result.filesRead.map((p) => ({
        path: `<game>/pak:${p}`,
        sha256: sha256(src.readBytes(p)),
      })),
    ];
    mkdirSync(dirname(out), { recursive: true });
    writeFileAtomic(out, observationFileText(result, build, inputs));
    const h = headline(result, index);
    if (values.json) {
      io.out(
        JSON.stringify({
          ok: true,
          command: "e18-tool-gestures",
          build,
          headline: h,
          duplicates: result.duplicates,
          left_out: result.leftOut,
          scrubbed: result.scrubbed,
        }),
      );
      return EXIT_OK;
    }
    io.out(
      `tools: ${h.classes_extending_tool} classes extend ${TOOL_BASE} (${h.classes_extending_tool_with_attribute} with ${TOOL_ATTRIBUTE}); ${h.event_methods_declared.length} event methods declared`,
    );
    for (const t of result.tools) {
      const n = h.gesture_rows_per_tool[t.class];
      if (n > 0) io.out(`  ${t.class}: ${n} gesture rows`);
    }
    for (const u of h.overrides_not_interpreted)
      io.out(`not interpreted ${u.tool}.${u.event} ${u.ref}: ${u.reasons.join("; ")}`);
    for (const d of result.duplicates) io.out(`duplicate ${d.id}: ${d.refs.join(" ")}`);
    for (const [k, n] of Object.entries(result.leftOut).sort()) io.out(`left out: ${n} ${k}`);
    io.out(
      `E18 at build ${build}: ${h.rows} observations (canvas-gesture ${h.rows}), ${h.overrides_not_interpreted.length} overrides not interpreted`,
    );
    return EXIT_OK;
  });
}

if (isMainModule(import.meta.url)) process.exitCode = run(process.argv.slice(2));
