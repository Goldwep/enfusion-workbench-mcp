/**
 * Cold-test question sampler (plan 4.6, last paragraphs; plan 8 Phase 1 item 8).
 *
 * Emits N questions about ledger rows, each with the expected row id, for an
 * agent that is given only `scripts/census/query.ts`. In Phase 1 the questions
 * are "what is X and where does it live" (answerable by `find` and `describe`).
 * An answer passes when it cites the expected row id and the path recorded on it.
 *
 *   npx tsx scripts/census/sample-questions.ts --seed <int> [--count 30] [--data <dir>]
 *       [--json] [--answers <file>] [--stats]
 *
 * Reads only the ledger shards and `ledger.meta.json` (through `loadLedger`);
 * writes nothing except the `--answers` file, which must not sit under the
 * census root. Questions and answer key are a pure function of the ledger and
 * the seed: same seed, same ledger, same bytes.
 *
 * Stdout carries the questions only (no ids, no dimensions). With `--json` it
 * is one document: `{seed, count, build, questions: [{n, text}], summary}`.
 * The answer key (`--answers`) holds, per question number, the expected row id
 * and the candidate paths recorded on that row, plus the question text, the
 * row's dimension, kind and module, and the dimension spread.
 *
 * Which rows can be drawn: measured (a source other than the recon import, and
 * not provisional), not aggregate, with a name a reader can search for: the
 * label, else the object name, else the class name, else the last segment of
 * the id for the kinds whose id is the name (settings, gestures).
 *
 * Stratification: the question count is split across the dimensions that have
 * eligible rows in proportion to their share of eligible rows, with at least
 * two per dimension (`allocate`). Inside a dimension each pick goes to the kind
 * drawn least so far, then to the module drawn least so far within that kind,
 * then to a random row of that cell.
 *
 * Fairness of each question: it names the row's kind in plain words, its name
 * and its module. When another row of the whole ledger (recon-only and
 * aggregate rows included) would also satisfy those words, the question adds
 * facts a person would know (the row's section, its parent, its class, its
 * grandparents) one at a time until only the expected row satisfies the whole
 * question. The owner (the first of those facts) is stated from the start when
 * another row of the same dimension, of any kind or module, answers to the name,
 * or when the name is under three characters (`needsOwner`): a reader cannot be
 * expected to tell 'Output' of one handler from 'Output' of another by the module
 * words alone (cold test 2026-11-14). When no such fact exists, or when a `find` on the name filtered by
 * the question's kind does not list the expected row on its first 200-row page
 * (a name like "Name" shared by a thousand rows), another row is drawn.
 *
 * `--kind howto` asks "How do I use the menu item 'Save' ...?" instead, over the same rows
 * (a row no tool reaches is drawn too). The answer key then also holds `expected`, built here
 * from the ledger and the census files, never from howto's own `toolActionFor` (review-1
 * finding 1: the gate must not score howto against itself; see `expectedFor`):
 *   answer "tool"          an mcp-tool row: that tool; an mcp-action row: its tool and action;
 *                          else the row's mcp link (drive first); else wb_diag for a diag row (get for
 *                          a catalogued option, select for a menu); wb_settings get for a setting
 *                          key; wb_menu run for a menu item the run allow-list sends; wb_gui
 *                          invoke for a row with a locator on the current build that policy gui
 *                          enables; wb_plugin run or wb_cli_run when the policy allow-list holds
 *                          the row. The answer must name that tool and action.
 *   answer "not-drivable"  a tool reaches the row but refuses it today (no locator, a gate, an
 *                          allow-list, a probe): the answer must say "not drivable yet".
 *   answer "no-tool"       nothing reaches the row: the answer must say "no tool reaches this row".
 * `answerPasses` applies that rule. The default is `--kind locate`, the Phase 1 questions.
 *
 * Exit: 0 ok; 1 fewer questions than asked for; 2 usage or no ledger; 3 malformed ledger.
 */
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { containsMachinePath } from "../../src/census/hygiene.js";
import { normalizeLabel } from "../../src/census/ids.js";
import { ledgerMissing, loadLedger, writeFileAtomic } from "../../src/census/ledger-io.js";
import type { LoadedLedger } from "../../src/census/ledger-io.js";
import { MAX_LIMIT, find, rankRow } from "../../src/census/query-engine.js";
import { loadAllowListFile, runRefusal, type AllowListPack } from "../../src/tools/wb-menu.js";
import type { Row } from "../../src/census/schemas.js";
import { DIMS, type Dim } from "../../src/census/vocab.js";
import {
  EXIT_FAIL,
  EXIT_OK,
  EXIT_USAGE,
  PROCESS_IO,
  guard,
  isMainModule,
  pathsFrom,
  type Io,
} from "./cli-common.js";

const USAGE =
  "usage: sample-questions.ts --seed <int> [--count 30] [--kind locate|howto] [--data <dir>] [--json] [--answers <file>] [--stats]";

export const DEFAULT_COUNT = 30;
/** Fewest questions per dimension that has eligible rows (when the count allows it). */
export const MIN_PER_DIM = 2;
/** Longest name a question will quote. */
const MAX_NAME_LENGTH = 140;
/** Most extra facts a question may add to name, kind and module. */
const MAX_FACTS = 4;

// ── Words ─────────────────────────────────────────────────────────────────────

/** The kind in plain words, for the question and for naming a parent. */
const KIND_WORDS: Readonly<Record<string, string>> = {
  module: "editor module",
  window: "window",
  menu: "menu",
  "menu-item": "menu item",
  toolbar: "toolbar",
  "toolbar-button": "toolbar button",
  dock: "dock panel",
  panel: "panel",
  tab: "tab",
  dialog: "dialog",
  control: "control",
  "property-group": "property group",
  property: "property",
  "property-editor": "property editor",
  "context-menu": "context menu",
  "context-item": "context menu item",
  shortcut: "keyboard shortcut",
  tool: "tool",
  "tool-button": "tool button",
  "canvas-gesture": "canvas gesture",
  region: "region",
  "status-item": "status bar item",
  "hazard-dialog": "hazard dialog",
  class: "script class",
  method: "script method",
  "static-method": "static script method",
  event: "script event",
  attribute: "script attribute",
  enum: "script enum",
  "enum-value": "script enum value",
  plugin: "plugin",
  "plugin-setting": "plugin setting",
  "plugin-button": "plugin button",
  "plugin-cli-arg": "plugin command-line argument",
  "net-function": "native network function",
  "net-handler": "network handler",
  "net-field": "network field",
  "cli-switch": "command-line switch",
  "link-format": "link format",
  "file-type": "file type",
  "resource-class": "resource class",
  "schema-class": "schema class",
  "schema-key": "schema key",
  "setting-key": "setting",
  option: "option",
  "diag-menu": "diagnostics menu",
  "diag-option": "diagnostics option",
  "blender-operator": "Blender operator",
  "debug-panel": "debug panel",
  "mcp-tool": "MCP tool",
  "mcp-action": "MCP action",
  "handler-action": "Workbench-side handler action",
};

/** Kinds that hold a value or a format: "read or changed". The rest of the kinds act or contain. */
const STATE_KINDS: ReadonlySet<string> = new Set([
  "property",
  "property-group",
  "property-editor",
  "attribute",
  "enum",
  "enum-value",
  "plugin-setting",
  "net-field",
  "link-format",
  "file-type",
  "resource-class",
  "schema-class",
  "schema-key",
  "setting-key",
  "option",
  "diag-option",
  "class",
]);

/** Kinds that are containers: "reached". */
const CONTAINER_KINDS: ReadonlySet<string> = new Set([
  "module",
  "window",
  "menu",
  "toolbar",
  "dock",
  "panel",
  "tab",
  "dialog",
  "context-menu",
  "region",
  "debug-panel",
  "hazard-dialog",
  "diag-menu",
  "mcp-tool",
]);

/** Where a module lives, in words (`none` has none and adds no fact). */
const MODULE_WORDS: Readonly<Record<string, string>> = {
  WorldEditor: "the World Editor",
  ResourceManager: "the Resource Manager",
  ScriptEditor: "the Script Editor",
  LocalizationEditor: "the Localization Editor",
  DialogueEditor: "the Dialogue Editor",
  AnimEditor: "the Animation Editor",
  ProcAnimEditor: "the Procedural Animation Editor",
  BehaviorEditor: "the Behavior Editor",
  AudioEditor: "the Audio Editor",
  ParticleEditor: "the Particle Editor",
  NavmeshGeneratorMain: "the Navmesh Generator",
  "ResourceManager.Config": "the Resource Manager's Config editor",
  "ResourceManager.Layout": "the Resource Manager's Layout editor",
  "ResourceManager.Imageset": "the Resource Manager's Imageset editor",
  "ResourceManager.Model": "the Resource Manager's Model editor",
  "ResourceManager.Texture": "the Resource Manager's Texture editor",
  "ResourceManager.Material": "the Resource Manager's Material editor",
  "ResourceManager.Font": "the Resource Manager's Font editor",
  "ResourceManager.Styles": "the Resource Manager's Styles editor",
  Launcher: "the Launcher",
  Shared: "the shared editor code",
  BlenderTools: "the Blender tools add-on",
};

/** Dimensions whose parent clause reads "under the …" rather than "of the …". */
const UNDER_DIMS: ReadonlySet<string> = new Set(["ui", "diag"]);

/** Where one kind is used in two dimensions, the dimension's own words. */
const DIM_KIND_WORDS: Readonly<Record<string, string>> = {
  "setting/option": "setting option",
};

function kindWords(kind: string, dim?: string): string {
  return (dim && DIM_KIND_WORDS[`${dim}/${kind}`]) || KIND_WORDS[kind] || kind.replace(/-/g, " ");
}

// ── Seeded randomness ─────────────────────────────────────────────────────────

/** mulberry32: a 32-bit seeded generator, returns floats in [0, 1). */
export function makeRng(seed: number): () => number {
  let a = (Math.abs(Math.trunc(seed)) % 4294967296) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomIndex(rng: () => number, n: number): number {
  return Math.min(n - 1, Math.floor(rng() * n));
}

function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomIndex(rng, i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ── Names and facts ───────────────────────────────────────────────────────────

function decodeSegment(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Last path segment of an id, decoded; the name of a row whose key is its name. */
function keyTail(id: string): string | undefined {
  const body = id.replace(/^[a-z]+:/, "");
  const segs = body.split("/");
  const last = segs[segs.length - 1];
  if (!last || last.startsWith("#")) return undefined;
  const t = decodeSegment(last).replace(/\s+/g, " ").trim();
  return t.length > 0 ? t : undefined;
}

function isUnnamed(r: Row): boolean {
  return !r.label && !r.object_name && !r.class_name;
}

/** The name a question quotes: label, object name, class name or the id's own key. */
export function displayName(r: Row): string | undefined {
  const raw = r.label ?? r.object_name ?? r.class_name ?? keyTail(r.id);
  if (!raw) return undefined;
  const n = normalizeLabel(raw);
  return n.length > 0 ? n : undefined;
}

/** The section of a setting key (`setting:<Section>/<key>`). */
function sectionOf(r: Row): string | undefined {
  if (r.dim !== "setting" || !r.id.startsWith("setting:")) return undefined;
  const i = r.id.indexOf("/");
  if (i < 0) return undefined;
  const s = decodeSegment(r.id.slice("setting:".length, i)).trim();
  return s.length > 0 ? s : undefined;
}

/** Ancestors of a row that have a name, nearest first, stopping at the first gap. */
function ancestorsOf(ledger: LoadedLedger, r: Row): { kind: string; name: string }[] {
  const out: { kind: string; name: string }[] = [];
  const seen = new Set<string>([r.id]);
  let cur = typeof r.parent === "string" ? ledger.byId.get(r.parent) : undefined;
  while (cur && !seen.has(cur.id) && out.length < MAX_FACTS) {
    seen.add(cur.id);
    const name = displayName(cur);
    if (!name) break;
    out.push({ kind: cur.kind, name });
    cur = typeof cur.parent === "string" ? ledger.byId.get(cur.parent) : undefined;
  }
  return out;
}

/** One fact a question can state about a row beyond kind, name and module. */
export type Fact =
  | { t: "section"; name: string }
  | { t: "parent"; depth: number; kind: string; name: string }
  | { t: "class"; name: string };

/** The facts available for a row, in the order a question adds them. */
export function factsFor(ledger: LoadedLedger, r: Row): Fact[] {
  const name = displayName(r) ?? "";
  const anc = ancestorsOf(ledger, r);
  const facts: Fact[] = [];
  const section = sectionOf(r);
  if (section) facts.push({ t: "section", name: section });
  if (anc[0]) facts.push({ t: "parent", depth: 1, kind: anc[0].kind, name: anc[0].name });
  if (
    r.class_name &&
    normalizeLabel(r.class_name).toLowerCase() !== name.toLowerCase() &&
    normalizeLabel(r.class_name).toLowerCase() !== anc[0]?.name.toLowerCase()
  ) {
    facts.push({ t: "class", name: r.class_name });
  }
  for (let d = 2; d <= anc.length; d++) {
    facts.push({ t: "parent", depth: d, kind: anc[d - 1].kind, name: anc[d - 1].name });
  }
  return facts;
}

/** What a question says about its row: the kind, the name, the module and some facts. */
export interface QuestionSpec {
  kind: string;
  name: string;
  /** Absent for module `none`. */
  module?: string;
  facts: Fact[];
}

/** The names under which a row is found by an exact name query (lower case). */
function nameKeys(r: Row): string[] {
  const out = new Set<string>();
  for (const v of [r.label, r.label_raw, r.object_name, r.class_name]) {
    if (!v) continue;
    out.add(normalizeLabel(v).toLowerCase());
    out.add(v.toLowerCase());
  }
  if (r.signature) {
    const m = /([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(r.signature);
    if (m) out.add(m[1].toLowerCase());
  }
  if (isUnnamed(r)) {
    const t = keyTail(r.id);
    if (t) out.add(t.toLowerCase());
  }
  return [...out];
}

/** True when the row answers to the name: an exact (any case) match of a name, label or object name. */
function nameMatches(r: Row, name: string): boolean {
  const rank = rankRow(r, name);
  if (rank >= 1 && rank <= 3) return true;
  if (isUnnamed(r)) return keyTail(r.id)?.toLowerCase() === name.toLowerCase();
  return false;
}

function factHolds(ledger: LoadedLedger, r: Row, f: Fact): boolean {
  if (f.t === "section") return sectionOf(r)?.toLowerCase() === f.name.toLowerCase();
  if (f.t === "class") {
    return (
      r.class_name !== undefined &&
      normalizeLabel(r.class_name).toLowerCase() === normalizeLabel(f.name).toLowerCase()
    );
  }
  const a = ancestorsOf(ledger, r)[f.depth - 1];
  return a !== undefined && a.kind === f.kind && a.name.toLowerCase() === f.name.toLowerCase();
}

// ── Questions ─────────────────────────────────────────────────────────────────

/** A lookup that finds, for a spec, every row of the ledger that satisfies it. */
export interface Resolver {
  satisfiers(spec: QuestionSpec): Row[];
  /** Does another row of the row's dimension (any kind, any module) answer to the name? */
  sharedInDim(r: Row, name: string): boolean;
  /** Does a `find` on the name, filtered by the question's kind, list the row on its largest page (200 rows)? */
  listed(spec: QuestionSpec, id: string): boolean;
}

export function makeResolver(ledger: LoadedLedger): Resolver {
  const index = new Map<string, Row[]>();
  for (const r of ledger.rows) {
    for (const k of nameKeys(r)) {
      const list = index.get(k);
      if (list) list.push(r);
      else index.set(k, [r]);
    }
  }
  return {
    satisfiers(spec) {
      const cands = index.get(spec.name.toLowerCase()) ?? [];
      return cands.filter(
        (r) =>
          r.kind === spec.kind &&
          nameMatches(r, spec.name) &&
          (spec.module === undefined || r.module === spec.module) &&
          spec.facts.every((f) => factHolds(ledger, r, f)),
      );
    },
    sharedInDim(r, name) {
      const cands = index.get(name.toLowerCase()) ?? [];
      return cands.some((x) => x !== r && x.dim === r.dim && nameMatches(x, name));
    },
    listed(spec, id) {
      const res = find(ledger, spec.name, { kind: spec.kind }, 1, MAX_LIMIT);
      return res.rows.some((r) => r.id === id);
    },
  };
}

function quote(s: string): string {
  return `'${s}'`;
}

/** The row as a noun phrase: kind, name, and the facts that single it out. */
function renderThing(spec: QuestionSpec, dim: string): string {
  let thing = `the ${kindWords(spec.kind, dim)} ${quote(spec.name)}`;
  const section = spec.facts.find((f) => f.t === "section");
  if (section) thing += ` in the settings section ${quote(section.name)}`;
  const parent = spec.facts.find((f) => f.t === "parent" && f.depth === 1);
  if (parent && parent.t === "parent") {
    thing += ` ${UNDER_DIMS.has(dim) ? "under" : "of"} the ${kindWords(parent.kind)} ${quote(parent.name)}`;
  }
  const cls = spec.facts.find((f) => f.t === "class");
  if (cls) thing += ` whose class is ${quote(cls.name)}`;
  for (const f of spec.facts) {
    if (f.t === "parent" && f.depth >= 2) {
      thing += ` within the ${kindWords(f.kind)} ${quote(f.name)}`;
    }
  }
  if (spec.module !== undefined) thing += ` in ${MODULE_WORDS[spec.module] ?? spec.module}`;
  return thing;
}

/** Renders a spec as a question in plain words (no row id). */
export function renderQuestion(spec: QuestionSpec, dim: string): string {
  const thing = renderThing(spec, dim);
  const verb = STATE_KINDS.has(spec.kind)
    ? "read or changed"
    : CONTAINER_KINDS.has(spec.kind)
      ? "reached"
      : "driven";
  return `Which row describes ${thing}, and by which path could it be ${verb}?`;
}

/** Renders a spec as a "how do I ..." question (no row id, no tool name). */
export function renderHowto(spec: QuestionSpec, dim: string): string {
  const verb = STATE_KINDS.has(spec.kind)
    ? "read or change"
    : CONTAINER_KINDS.has(spec.kind)
      ? "reach"
      : "use";
  return `How do I ${verb} ${renderThing(spec, dim)}?`;
}

/** True when only the recon import (E01) observed the row. */
function isReconOnly(r: Row): boolean {
  return r.provisional || r.sources.every((s) => s.enumerator === "E01");
}

/** Whether a row can be drawn, and the first reason when it cannot (recon-only, aggregate, then name). */
export function eligibility(r: Row): "ok" | "recon-only" | "aggregate" | "no-name" {
  if (isReconOnly(r)) return "recon-only";
  if (r.aggregate) return "aggregate";
  const name = displayName(r);
  if (!name || name.length > MAX_NAME_LENGTH || containsMachinePath(name)) return "no-name";
  return "ok";
}

/** `locate`: "which row and which path"; `howto`: "how do I ...", answer key adds the tool and action. */
export type QuestionMode = "locate" | "howto";
export const QUESTION_MODES: readonly QuestionMode[] = ["locate", "howto"];

// ── Howto answer key (independent of howto) ───────────────────────────────────

/** What a howto answer must say about a row. */
export type Expected =
  | { answer: "tool"; tool: string; action: string; tool_action: string; basis: string }
  | { answer: "not-drivable"; basis: string }
  | { answer: "no-tool"; basis: string };

/** The census files the key reads besides the ledger. */
export interface KeyData {
  /** Row ids with a locator record on the current build. */
  locators: ReadonlySet<string>;
  /** policy gui: invoke enabled, and the enabled rows. */
  guiInvoke: boolean;
  guiRows: ReadonlySet<string>;
  /** diag-catalog.json kind by lower-case menu path. */
  diagKinds: ReadonlyMap<string, string>;
  /** wb_menu's run allow-list pack (null: not read, so no menu item counts). */
  menuPack: AllowListPack | null;
  pluginRun: ReadonlySet<string>;
  cliAllow: ReadonlySet<string>;
}

export const EMPTY_KEY_DATA: KeyData = {
  locators: new Set(),
  guiInvoke: false,
  guiRows: new Set(),
  diagKinds: new Map(),
  menuPack: null,
  pluginRun: new Set(),
  cliAllow: new Set(),
};

function readJsonOr(file: string): Record<string, unknown> {
  try {
    return existsSync(file)
      ? (JSON.parse(readFileSync(file, "utf-8")) as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function listOf(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** Reads the key's files under a census root; a missing file gives an empty part. */
export function loadKeyData(root: string): KeyData {
  const tag = readJsonOr(join(root, "current-build.json")).tag;
  const locators = new Set<string>();
  const locFile = typeof tag === "string" ? join(root, "locators", `${tag}.jsonl`) : "";
  if (locFile && existsSync(locFile)) {
    for (const line of readFileSync(locFile, "utf-8").split(/\r?\n/)) {
      if (!line.trim()) continue;
      const id = (JSON.parse(line) as { rowId?: unknown }).rowId;
      if (typeof id === "string") locators.add(id);
    }
  }
  const policy = readJsonOr(join(root, "policy.json"));
  const gui = (policy.gui ?? {}) as { actions_enabled?: unknown; rows_enabled?: unknown };
  const guiRows = new Set<string>();
  for (const e of listOf(gui.rows_enabled)) {
    if (typeof e === "string") guiRows.add(e);
    else if (typeof (e as { id?: unknown })?.id === "string") guiRows.add((e as { id: string }).id);
  }
  const diagKinds = new Map<string, string>();
  for (const e of listOf(readJsonOr(join(root, "diag-catalog.json")).entries)) {
    const x = e as { path?: unknown; kind?: unknown };
    if (typeof x.path === "string" && x.path && typeof x.kind === "string")
      diagKinds.set(x.path.toLowerCase(), x.kind);
  }
  const pluginRun = new Set<string>();
  for (const e of listOf(policy.plugin_run_allow_list)) {
    const cls = (e as { class?: unknown })?.class;
    if (typeof cls === "string") pluginRun.add(cls);
  }
  const cli = (policy.cli_run ?? {}) as { allow_list?: unknown };
  return {
    locators,
    guiInvoke: listOf(gui.actions_enabled).includes("invoke"),
    guiRows,
    diagKinds,
    menuPack: loadAllowListFile(),
    pluginRun,
    cliAllow: new Set(listOf(cli.allow_list).filter((x): x is string => typeof x === "string")),
  };
}

function toolAnswer(tool: string, action: string, basis: string): Expected {
  return { answer: "tool", tool, action, tool_action: `${tool}.${action}`, basis };
}

const LINK = /^mcp:action\/([a-z0-9_]+)\.([A-Za-z0-9_-]+)$/;

/** The expected howto answer for a row, from its links, kind, locator and the policy lists. */
export function expectedFor(r: Row, k: KeyData): Expected {
  // An MCP tool row is answered by that tool, an MCP action row by its tool and action.
  const own =
    r.kind === "mcp-tool"
      ? /^mcp:tool\/([a-z][a-z0-9_]*)$/.exec(r.id)
      : r.kind === "mcp-action"
        ? LINK.exec(r.id)
        : null;
  if (own && own[2] !== undefined) return toolAnswer(own[1], own[2], "the row is that MCP action");
  if (own) {
    return {
      answer: "tool",
      tool: own[1],
      action: "",
      tool_action: own[1],
      basis: "the row is that MCP tool",
    };
  }
  const links = r.mcp.flatMap((m) => {
    const x = LINK.exec(m.action);
    return x ? [{ tool: x[1], action: x[2], role: m.role }] : [];
  });
  const link = links.find((x) => x.role === "drive") ?? links[0];
  if (link) return toolAnswer(link.tool, link.action, "mcp link");
  if (r.dim === "diag") {
    const kind = k.diagKinds.get(r.id.replace(/^diag:/, "").toLowerCase());
    if (kind === "menu" || (kind === undefined && r.kind === "diag-menu"))
      return toolAnswer("wb_diag", "select", "diag menu");
    if (kind === "range" || kind === "engine")
      return { answer: "not-drivable", basis: `diag ${kind} id waits for its probe` };
    if (kind !== undefined) return toolAnswer("wb_diag", "get", "diag catalog");
  }
  if (r.dim === "setting" && r.kind === "setting-key")
    return toolAnswer("wb_settings", "get", "settings key");
  if (r.dim === "setting" && r.kind === "option")
    return { answer: "not-drivable", basis: "settings options wait for P-W8-05" };
  const live = new Set(r.paths.filter((p) => p.status !== "refuted").map((p) => p.path));
  const menu = r.kind === "menu-item" || live.has("execute-action");
  if (menu && k.menuPack && runRefusal(r, k.menuPack) === null)
    return toolAnswer("wb_menu", "run", "menu run allow-list");
  const gui = live.has("gui-automation");
  if (gui && k.locators.has(r.id) && k.guiInvoke && k.guiRows.has(r.id))
    return toolAnswer("wb_gui", "invoke", "locator, gui enabled");
  const plugin = live.has("plugin-run") && r.kind === "plugin";
  if (plugin && k.pluginRun.has(r.class_name ?? r.id.replace(/^plugin:/, "")))
    return toolAnswer("wb_plugin", "run", "plugin run allow-list");
  const name = (r.label ?? r.id).replace(/^[a-z]+:/, "");
  const cli = live.has("cli");
  if (cli && (k.cliAllow.has(`verb:${name}`) || k.cliAllow.has(`plugin:${name}`)))
    return {
      answer: "tool",
      tool: "wb_cli_run",
      action: "",
      tool_action: "wb_cli_run",
      basis: "cli allow-list",
    };
  if (menu || gui || plugin || cli) {
    const basis = gui && !k.locators.has(r.id) ? "no locator on this build" : "refused today";
    return { answer: "not-drivable", basis };
  }
  return { answer: "no-tool", basis: "no link, no tool-bearing path" };
}

/** Whether a howto answer meets the key: the row id on its first line, and the expected words. */
export function answerPasses(text: string, id: string, e: Expected): boolean {
  if (!(text.split("\n")[0] ?? "").includes(id)) return false;
  if (e.answer === "tool")
    return e.action
      ? text.includes(`Use: ${e.tool} action ${e.action}`)
      : text.includes(`Use: ${e.tool}`);
  if (e.answer === "not-drivable") return text.includes("Use: not drivable yet");
  return text.includes("Use: no tool reaches this row");
}

export interface Built {
  text: string;
  spec: QuestionSpec;
}

/** Names shorter than this are always asked with their owner (a one-letter schema key). */
export const SHORT_NAME = 3;

/**
 * True when the question must name the row's owner (its settings section, parent or class: the
 * first fact): another row of the same dimension answers to the name, in any kind or module,
 * or the name is shorter than `SHORT_NAME`. A row with no owner fact is told apart by its
 * module as before.
 */
export function needsOwner(resolver: Resolver, r: Row, name: string, facts: readonly Fact[]): boolean {
  if (facts.length === 0) return false;
  return name.length < SHORT_NAME || resolver.sharedInDim(r, name);
}

/**
 * The question for a row, or `null` when no fair question exists: no extra
 * fact makes the expected row the only one that satisfies it, or the tester's
 * `find` would not list it. Pure given the ledger.
 */
export function buildQuestion(
  ledger: LoadedLedger,
  resolver: Resolver,
  r: Row,
  options: { skipFind?: boolean; howto?: boolean } = {},
): Built | null {
  const name = displayName(r);
  if (!name || eligibility(r) !== "ok") return null;
  const facts = factsFor(ledger, r);
  const module = r.module === "none" ? undefined : r.module;
  // The owner comes first when a reader could not tell the row by its name alone (cold test
  // 2026-11-14: 'Output' of six handlers, 'OnRegisterResource' of four classes, the key 'd').
  const first = needsOwner(resolver, r, name, facts) ? 1 : 0;
  for (let k = first; k <= Math.min(MAX_FACTS, facts.length); k++) {
    const spec: QuestionSpec = { kind: r.kind, name, module, facts: facts.slice(0, k) };
    const sat = resolver.satisfiers(spec);
    if (!sat.includes(r)) return null;
    if (sat.length > 1) continue;
    if (facts.slice(0, k).some((f) => containsMachinePath(f.name))) return null;
    if (!options.skipFind && !resolver.listed(spec, r.id)) return null;
    const text = options.howto ? renderHowto(spec, r.dim) : renderQuestion(spec, r.dim);
    if (text.includes(r.id)) return null;
    return { text, spec };
  }
  return null;
}

// ── Allocation ────────────────────────────────────────────────────────────────

/**
 * Splits `count` across the dimensions in proportion to their eligible rows,
 * with at least `min` for every dimension that has any (never more than it
 * has). Dimensions whose proportional share is below the minimum are fixed at
 * the minimum first and the rest share what remains; the integer split is by
 * largest remainder, ties in vocabulary order. Returns quotas summing to
 * `min(count, total eligible)`.
 */
export function allocate(
  eligible: Readonly<Record<string, number>>,
  count: number,
  min = MIN_PER_DIM,
): Record<string, number> {
  const dims = DIMS.filter((d) => (eligible[d] ?? 0) > 0);
  const total = dims.reduce((s, d) => s + eligible[d], 0);
  const goal = Math.min(count, total);
  const quota: Record<string, number> = {};
  if (dims.length === 0 || goal === 0) return quota;
  const floor = Math.min(min, Math.floor(goal / dims.length));
  const fixed = new Set<Dim>();
  for (;;) {
    const pool = dims.filter((d) => !fixed.has(d));
    if (pool.length === 0) break;
    const remaining = goal - [...fixed].reduce((s, d) => s + quota[d], 0);
    const poolTotal = pool.reduce((s, d) => s + eligible[d], 0);
    let changed = false;
    for (const d of pool) {
      const ideal = (remaining * eligible[d]) / poolTotal;
      if (ideal < floor) {
        quota[d] = Math.min(floor, eligible[d]);
        fixed.add(d);
        changed = true;
      } else if (ideal > eligible[d]) {
        quota[d] = eligible[d];
        fixed.add(d);
        changed = true;
      }
    }
    if (!changed) break;
  }
  const pool = dims.filter((d) => !fixed.has(d));
  const remaining = goal - [...fixed].reduce((s, d) => s + quota[d], 0);
  const poolTotal = pool.reduce((s, d) => s + eligible[d], 0);
  const parts = pool.map((d) => {
    const ideal = poolTotal > 0 ? (remaining * eligible[d]) / poolTotal : 0;
    return { d, base: Math.floor(ideal), rem: ideal - Math.floor(ideal) };
  });
  let left = remaining - parts.reduce((s, p) => s + p.base, 0);
  const byRemainder = [...parts].sort(
    (a, b) => b.rem - a.rem || DIMS.indexOf(a.d) - DIMS.indexOf(b.d),
  );
  for (const p of byRemainder) {
    if (left > 0 && p.base < eligible[p.d]) {
      p.base++;
      left--;
    }
  }
  for (const p of parts) quota[p.d] = p.base;
  return quota;
}

// ── Sampling ──────────────────────────────────────────────────────────────────

export interface Question {
  n: number;
  text: string;
  /** The expected row. Never printed with the questions. */
  id: string;
  dim: string;
  kind: string;
  module: string;
  paths: { path: string; status: string; reason?: string }[];
  /** Howto mode: what the answer must say (`expectedFor`). */
  expected?: Expected;
}

export interface SampleSummary {
  /** Eligible rows per dimension (every dimension of the vocabulary is listed). */
  eligible: Record<string, number>;
  /** Rows left out per reason, ledger-wide; a row can count under more than one reason (aggregate rows are also recon-only). */
  excluded: {
    "recon-only": number;
    aggregate: number;
    "no-name": number;
  };
  /** Questions per dimension. */
  spread: Record<string, number>;
  /** Questions per kind and per module, ledger-wide. */
  kinds: Record<string, number>;
  modules: Record<string, number>;
  /** Quota per dimension before the draw. */
  quota: Record<string, number>;
  /** Eligible rows per dimension that also pass the fairness checks (only with `askable: true`). */
  askable?: Record<string, number>;
  /** Dimensions that gave fewer questions than their quota. */
  shortfall: Record<string, number>;
}

export interface Sample {
  seed: number;
  count: number;
  questions: Question[];
  summary: SampleSummary;
}

interface Cell {
  /** Rows of one (kind, module) cell still undrawn. */
  rows: Row[];
  picks: number;
}
interface Group {
  kinds: Map<string, { picks: number; modules: Map<string, Cell> }>;
}

function pickLeast<K>(entries: Iterable<[K, number]>, rng: () => number): K | undefined {
  let best = Infinity;
  let ties: K[] = [];
  for (const [k, p] of entries) {
    if (p < best) {
      best = p;
      ties = [k];
    } else if (p === best) ties.push(k);
  }
  return ties.length === 0 ? undefined : ties[randomIndex(rng, ties.length)];
}

/** Draws `count` questions for the ledger and seed. */
export function sampleQuestions(
  ledger: LoadedLedger,
  options: {
    seed: number;
    count?: number;
    askable?: boolean;
    mode?: QuestionMode;
    /** Howto key data (locators, policy lists, diag catalog); default EMPTY_KEY_DATA. */
    keyData?: KeyData;
  },
): Sample {
  const seed = options.seed;
  const count = options.count ?? DEFAULT_COUNT;
  const rng = makeRng(seed);
  const howtoMode = options.mode === "howto";
  const resolver = makeResolver(ledger);

  const rows = [...ledger.rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const eligible: Record<string, number> = Object.fromEntries(DIMS.map((d) => [d, 0]));
  const excluded: SampleSummary["excluded"] = { "recon-only": 0, aggregate: 0, "no-name": 0 };
  const groups = new Map<string, Group>();
  for (const r of rows) {
    const e = eligibility(r);
    if (isReconOnly(r)) excluded["recon-only"]++;
    if (r.aggregate) excluded.aggregate++;
    if (e === "no-name") excluded["no-name"]++;
    if (e !== "ok") continue;
    eligible[r.dim]++;
    let g = groups.get(r.dim);
    if (!g) groups.set(r.dim, (g = { kinds: new Map() }));
    let k = g.kinds.get(r.kind);
    if (!k) g.kinds.set(r.kind, (k = { picks: 0, modules: new Map() }));
    let cell = k.modules.get(r.module);
    if (!cell) k.modules.set(r.module, (cell = { rows: [], picks: 0 }));
    cell.rows.push(r);
  }

  let askable: Record<string, number> | undefined;
  if (options.askable) {
    askable = Object.fromEntries(DIMS.map((d) => [d, 0]));
    for (const r of rows) {
      if (
        eligibility(r) === "ok" &&
        buildQuestion(ledger, resolver, r, { skipFind: true, howto: howtoMode })
      ) {
        askable[r.dim]++;
      }
    }
  }

  const quota = allocate(eligible, count);
  const spread: Record<string, number> = Object.fromEntries(DIMS.map((d) => [d, 0]));
  const drawn: { row: Row; built: Built }[] = [];

  /** One more question for the dimension, or false when its cells are exhausted. */
  const drawOne = (dim: string): boolean => {
    const g = groups.get(dim);
    if (!g) return false;
    for (;;) {
      const kind = pickLeast(
        [...g.kinds].map(([k, v]) => [k, v.picks] as [string, number]),
        rng,
      );
      if (kind === undefined) return false;
      const kg = g.kinds.get(kind);
      if (!kg) return false;
      const mod = pickLeast(
        [...kg.modules].map(([m, c]) => [m, c.picks] as [string, number]),
        rng,
      );
      if (mod === undefined) {
        g.kinds.delete(kind);
        continue;
      }
      const cell = kg.modules.get(mod);
      if (!cell || cell.rows.length === 0) {
        kg.modules.delete(mod);
        continue;
      }
      const i = randomIndex(rng, cell.rows.length);
      const row = cell.rows[i];
      cell.rows[i] = cell.rows[cell.rows.length - 1];
      cell.rows.pop();
      const built = buildQuestion(ledger, resolver, row, { howto: howtoMode });
      if (!built) continue;
      cell.picks++;
      kg.picks++;
      spread[dim]++;
      drawn.push({ row, built });
      return true;
    }
  };

  const shortfall: Record<string, number> = {};
  for (const dim of DIMS) {
    const q = quota[dim] ?? 0;
    for (let i = 0; i < q; i++) {
      if (!drawOne(dim)) {
        shortfall[dim] = q - i;
        break;
      }
    }
  }
  // A dimension that ran dry hands its share to the dimensions with most eligible rows left.
  let missing =
    Math.min(
      count,
      Object.values(eligible).reduce((s, n) => s + n, 0),
    ) - drawn.length;
  const byWeight = [...DIMS].sort((a, b) => eligible[b] - eligible[a]);
  while (missing > 0) {
    let progressed = false;
    for (const dim of byWeight) {
      if (missing <= 0) break;
      if (drawOne(dim)) {
        missing--;
        progressed = true;
      }
    }
    if (!progressed) break;
  }

  const order = shuffle(drawn, rng);
  const questions: Question[] = order.map((d, i) => {
    const e = howtoMode ? expectedFor(d.row, options.keyData ?? EMPTY_KEY_DATA) : null;
    return {
      n: i + 1,
      text: d.built.text,
      id: d.row.id,
      dim: d.row.dim,
      kind: d.row.kind,
      module: d.row.module,
      paths: d.row.paths.map((p) => ({
        path: p.path,
        status: p.status,
        ...(p.reason ? { reason: p.reason } : {}),
      })),
      ...(e ? { expected: e } : {}),
    };
  });
  const kinds: Record<string, number> = {};
  const modules: Record<string, number> = {};
  for (const q of questions) {
    kinds[q.kind] = (kinds[q.kind] ?? 0) + 1;
    modules[q.module] = (modules[q.module] ?? 0) + 1;
  }
  const summary: SampleSummary = {
    eligible,
    excluded,
    spread,
    kinds,
    modules,
    quota: Object.fromEntries(DIMS.map((d) => [d, quota[d] ?? 0])),
    shortfall,
    ...(askable ? { askable } : {}),
  };
  return { seed, count, questions, summary };
}

// ── CLI ───────────────────────────────────────────────────────────────────────

function buildTag(ledger: LoadedLedger): string {
  return ledger.meta?.build?.tag ?? "unknown";
}

export function run(argv: string[], io: Io = PROCESS_IO): number {
  return guard(io, "sample-questions", () => {
    const { values } = parseArgs({
      args: argv,
      allowPositionals: false,
      options: {
        seed: { type: "string" },
        count: { type: "string" },
        data: { type: "string" },
        json: { type: "boolean" },
        answers: { type: "string" },
        kind: { type: "string" },
        stats: { type: "boolean" },
        help: { type: "boolean" },
      },
      strict: true,
    });
    if (values.help) {
      io.out(USAGE);
      return EXIT_OK;
    }
    if (values.seed === undefined) {
      io.err(`sample-questions: --seed is required (a run must be reproducible)\n${USAGE}`);
      return EXIT_USAGE;
    }
    const seed = Number(values.seed);
    if (!/^-?\d+$/.test(values.seed) || !Number.isSafeInteger(seed)) {
      io.err(`sample-questions: --seed takes an integer\n${USAGE}`);
      return EXIT_USAGE;
    }
    const count = values.count === undefined ? DEFAULT_COUNT : Number(values.count);
    if (values.count !== undefined && (!/^\d+$/.test(values.count) || count < 1)) {
      io.err(`sample-questions: --count takes a positive integer\n${USAGE}`);
      return EXIT_USAGE;
    }
    const mode = (values.kind ?? "locate") as QuestionMode;
    if (!QUESTION_MODES.includes(mode)) {
      io.err(`sample-questions: --kind takes ${QUESTION_MODES.join(" or ")}
${USAGE}`);
      return EXIT_USAGE;
    }
    const paths = pathsFrom(values.data);
    if (values.answers !== undefined) {
      const rel = relative(paths.root, resolve(values.answers));
      if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
        io.err("sample-questions: --answers must not point inside the census root");
        return EXIT_USAGE;
      }
    }
    if (ledgerMissing(paths)) {
      io.err("sample-questions: no ledger under the census root; run build.ts first");
      return EXIT_USAGE;
    }
    const ledger = loadLedger(paths);
    const sample = sampleQuestions(ledger, {
      seed,
      count,
      askable: values.stats === true,
      mode,
      ...(mode === "howto" ? { keyData: loadKeyData(paths.root) } : {}),
    });
    const build = buildTag(ledger);

    if (values.answers !== undefined) {
      const file = resolve(values.answers);
      mkdirSync(dirname(file), { recursive: true });
      const key = {
        seed,
        count: sample.questions.length,
        build,
        ...(mode === "howto" ? { kind: "howto" } : {}),
        ledger_rows: ledger.rows.length,
        answers: sample.questions.map((q) => ({
          n: q.n,
          id: q.id,
          paths: q.paths,
          ...(q.expected ? { expected: q.expected } : {}),
          question: q.text,
          dim: q.dim,
          kind: q.kind,
          module: q.module,
        })),
        summary: sample.summary,
      };
      writeFileAtomic(file, JSON.stringify(key, null, 2) + "\n");
    }

    if (values.json) {
      io.out(
        JSON.stringify({
          seed,
          count: sample.questions.length,
          build,
          questions: sample.questions.map((q) => ({ n: q.n, text: q.text })),
          summary: sample.summary,
        }),
      );
    } else {
      const lines = [
        `Cold-test questions: seed ${seed}, build ${build}, ${sample.questions.length} questions`,
      ];
      for (const q of sample.questions) lines.push(`${q.n}. ${q.text}`);
      io.out(lines.join("\n"));
    }
    if (sample.questions.length < count) {
      io.err(
        `sample-questions: only ${sample.questions.length} of ${count} questions could be drawn (shortfall ${JSON.stringify(sample.summary.shortfall)})`,
      );
      return EXIT_FAIL;
    }
    return EXIT_OK;
  });
}

if (isMainModule(import.meta.url)) process.exitCode = run(process.argv.slice(2));
