/**
 * E17 — Workbench-owned pak data (plan 4.5; Phase 1).
 *
 * Reads the data that Workbench itself loads out of the game paks
 * (`PakVirtualFS.get(gamePath)`) and the Tools core pak
 * (`PakVirtualFS.get(<tools>/Workbench)`): `Configs/Workbench/**`, `WBData/**`,
 * `system/wbdata/**` and any other top-level folder whose name starts with
 * `wb` or contains `workbench`. It writes
 * `data/census/observations/E17/<build>.jsonl` and, as derived tables, a few
 * TSV files and a summary into the artifacts folder
 * (`<artifacts>/census/<build>/E17/`, never a git working tree).
 *
 * WHAT IS EMITTED (kinds: link-format, plugin-setting, panel, tab):
 *  - link-format, key {name: <url>}: every `WBDocumentationLink` of
 *    `Configs/Workbench/documentationLinks.conf` and every `WelcomeScreenLink`
 *    of `Configs/Workbench/welcomeScreen.conf` (the logo link included).
 *    Welcome links carry the Welcome panel as parent.
 *  - panel, key {path: ["WelcomeScreen"]}: the root class of
 *    `welcomeScreen.conf`. Its module is `none` (the file names no module);
 *    the Resource Manager placement the recon gives is flagged `unverified`.
 *  - plugin-setting, key {class, attr}: one row per `[Attribute]` member of a
 *    Workbench plugin or tool class (a class carrying WorkbenchPluginAttribute
 *    or WorkbenchToolAttribute) that takes one of the shipped
 *    `Configs/Workbench/**` config files. The link from a config file to its
 *    plugin member is read from the scripts, in this order: (1) the member's
 *    attribute names the file (a literal `Configs/Workbench/...` path or a
 *    constant of the class that holds one); (2) the attribute says
 *    `conf class=<root class of the file>` or the member's type is that root
 *    class; (3) a sibling file in the same folder with the same root class as
 *    a file linked by (1); (4) the class body names the root class and has
 *    exactly one ResourceName member whose attribute params say "conf".
 *    Files that are only reached by (3) or (4) give rows of `medium`
 *    confidence. Everything that cannot be linked is left out and listed in
 *    the artifacts tables.
 *
 * PARENT ROWS: every plugin-setting row names `plugin:<Class>` (kind plugin or tool) as its
 * parent. E17 may not emit those; E03 owns them, so `build.ts` reports "parent ... has no row"
 * for these rows until E03's observation file exists. That is a cross-enumerator dependency,
 * not a defect: drop the parent and T1 is blocked for the rows instead.
 *
 * WHAT IS NOT EMITTED, AND WHERE IT GOES: the entity-icon prefabs and meshes,
 * the gizmo meshes, preview materials and environment textures have no row
 * kind in E17's entry; they go to `inventory.tsv` and `entity-icons.tsv`.
 * Menu, toolbar, dock, shortcut and layout definitions: none are data-driven
 * from these files (the scan result is part of the output, see `uiScan`).
 *
 *   npx tsx scripts/census/enumerators/e17-workbench-data.ts [--build <tag>]
 *       [--data <dir>] [--out <file under observations/E17/>]
 *       [--artifacts <dir outside every git working tree>] [--no-artifacts]
 *       [--compare-all] [--json]
 *
 * --compare-all  byte-compares every file of the Tools pak with the game
 *                paks (about 35 seconds); the default compares in-scope files.
 *
 * Exit: 0 written; 1 refused or the gate failed (a rejected row, a row path
 * missing from the paks); 2 usage, or NO DATA (no game pak); 3 malformed
 * census configuration.
 *
 * Nothing under the game or Tools install is executed: pak files are read as
 * bytes through `src/pak/vfs.ts` only.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { compareCodeUnits, jsonlLine, sha256 } from "../../../src/census/canon.js";
import { loadCurrentBuild } from "../../../src/census/census-config.js";
import { containsMachinePath } from "../../../src/census/hygiene.js";
import { deriveId } from "../../../src/census/ids.js";
import { writeFileAtomic, type CensusPaths } from "../../../src/census/ledger-io.js";
import { observationSchema, type Observation } from "../../../src/census/schemas.js";
import { MODULES } from "../../../src/census/vocab.js";
import { loadConfig } from "../../../src/config.js";
import { PakVirtualFS } from "../../../src/pak/vfs.js";
import { artifactsDir, insideGitWorkTree } from "../../live/paths.js";
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
export const ENUMERATOR_ID = "E17";
/** Registered generator path (must equal universes.json `enumerators.E17.generator`). */
export const GENERATOR = "scripts/census/enumerators/e17-workbench-data.ts";
const QUOTE_MAX = 200;
const DOC_LINKS_PATH = "Configs/Workbench/documentationLinks.conf";
const WELCOME_PATH = "Configs/Workbench/welcomeScreen.conf";

// ── Pak access ────────────────────────────────────────────────────────────────

/** The part of `PakVirtualFS` the enumerator uses (tests pass an in-memory one). */
export interface PakLike {
  allFilePaths(): string[];
  readTextFile(virtualPath: string): string;
  readFile(virtualPath: string): Buffer;
  fileSize(virtualPath: string): number;
}

export interface Sources {
  game: PakLike;
  /** The Tools core pak, or null when it is not installed. */
  tools: PakLike | null;
}

/** An in-memory pak for tests: virtual path to text or bytes. */
export function memoryPak(files: Record<string, string | Buffer>): PakLike {
  const entries = new Map(Object.entries(files));
  const bytes = (p: string): Buffer => {
    const v = entries.get(p);
    if (v === undefined) throw new Error(`no such file: ${p}`);
    return typeof v === "string" ? Buffer.from(v, "utf-8") : v;
  };
  return {
    allFilePaths: () => [...entries.keys()],
    readTextFile: (p) => bytes(p).toString("utf-8"),
    readFile: bytes,
    fileSize: (p) => bytes(p).length,
  };
}

/** Real sources from the configured install; `game` is null when there is no game pak. */
export function loadRealSources(): { game: PakLike | null; tools: PakLike | null } {
  const config = loadConfig();
  PakVirtualFS.invalidate();
  const tools = PakVirtualFS.get(join(config.workbenchPath, "Workbench"));
  // The instance stays valid after invalidate(); only the singleton cache is dropped.
  PakVirtualFS.invalidate();
  const game = PakVirtualFS.get(config.gamePath);
  PakVirtualFS.invalidate();
  return { game, tools };
}

// ── Scope ─────────────────────────────────────────────────────────────────────

/**
 * The family of an in-scope virtual path, or null. Folder names are matched
 * case-insensitively (the game paks hold both `Configs` and `configs`).
 */
export function scopeFamily(path: string): string | null {
  const seg = path.split("/");
  const a = seg[0].toLowerCase();
  const b = (seg[1] ?? "").toLowerCase();
  if (a === "configs" && b === "workbench") return "Configs/Workbench";
  if (a === "wbdata") return "WBData";
  if (a === "system" && b === "wbdata") return "system/wbdata";
  if (seg.length > 1 && (/^wb/.test(a) || a.includes("workbench"))) return seg[0];
  return null;
}

export function extOf(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const i = base.lastIndexOf(".");
  return i < 0 ? "(none)" : base.slice(i).toLowerCase();
}

/** Files per family and extension. */
export type FamilyCounts = Record<string, { files: number; byExt: Record<string, number> }>;

export function measureScope(pak: PakLike): FamilyCounts {
  const out: FamilyCounts = {};
  for (const p of pak.allFilePaths()) {
    const fam = scopeFamily(p);
    if (!fam) continue;
    const e = (out[fam] ??= { files: 0, byExt: {} });
    e.files++;
    const x = extOf(p);
    e.byExt[x] = (e.byExt[x] ?? 0) + 1;
  }
  const sorted: FamilyCounts = {};
  for (const fam of Object.keys(out).sort(compareCodeUnits)) {
    const byExt: Record<string, number> = {};
    for (const x of Object.keys(out[fam].byExt).sort(compareCodeUnits))
      byExt[x] = out[fam].byExt[x];
    sorted[fam] = { files: out[fam].files, byExt };
  }
  return sorted;
}

// ── Pak comparison ────────────────────────────────────────────────────────────

export type CompareStatus = "identical" | "differs" | "game-only" | "tools-only";

export interface CompareEntry {
  path: string;
  status: CompareStatus;
  /** `sha256` when both files could be read, `size` when a read cap forced a size compare. */
  method: "sha256" | "size" | "none";
  gameSize?: number;
  toolsSize?: number;
}

function digest(pak: PakLike, path: string): string {
  try {
    return "sha256:" + createHash("sha256").update(pak.readFile(path)).digest("hex");
  } catch {
    return `size:${pak.fileSize(path)}`;
  }
}

/** Compares the paths of `scope` ("in-scope" or "all" Tools-pak paths) between the two paks. */
export function comparePaks(
  game: PakLike,
  tools: PakLike,
  scope: "in-scope" | "all",
): CompareEntry[] {
  const gamePaths = new Set(game.allFilePaths());
  const toolsPaths = new Set(tools.allFilePaths());
  const wanted = new Set<string>();
  for (const p of [...gamePaths, ...toolsPaths]) {
    if (scope === "all" ? toolsPaths.has(p) : scopeFamily(p) !== null) wanted.add(p);
  }
  const out: CompareEntry[] = [];
  for (const path of [...wanted].sort(compareCodeUnits)) {
    const g = gamePaths.has(path);
    const t = toolsPaths.has(path);
    if (g && !t) {
      out.push({ path, status: "game-only", method: "none", gameSize: game.fileSize(path) });
    } else if (!g && t) {
      out.push({ path, status: "tools-only", method: "none", toolsSize: tools.fileSize(path) });
    } else {
      const gd = digest(game, path);
      const td = digest(tools, path);
      const hashed = gd.startsWith("sha256:") && td.startsWith("sha256:");
      const method = hashed ? "sha256" : "size";
      const same = hashed ? gd === td : game.fileSize(path) === tools.fileSize(path);
      out.push({
        path,
        status: same ? "identical" : "differs",
        method,
        gameSize: game.fileSize(path),
        toolsSize: tools.fileSize(path),
      });
    }
  }
  return out;
}

// ── Config (.conf) parsing ────────────────────────────────────────────────────

export interface ConfProp {
  key: string;
  value: string;
  line: number;
  raw: string;
}

export interface ConfBlock {
  /** Tokens before the `{`: class name, optional instance name, optional "{GUID}". */
  head: string[];
  line: number;
  props: ConfProp[];
  children: ConfBlock[];
}

/** Splits a line into tokens; double-quoted strings are one token, quotes removed. */
export function tokenize(s: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  let has = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) {
      if (c === "\\" && i + 1 < s.length) {
        cur += s[++i];
      } else if (c === '"') inQ = false;
      else cur += c;
    } else if (c === '"') {
      inQ = true;
      has = true;
    } else if (/\s/.test(c)) {
      if (cur.length > 0 || has) out.push(cur);
      cur = "";
      has = false;
    } else cur += c;
  }
  if (cur.length > 0 || has) out.push(cur);
  return out;
}

/** Parses the line-oriented Enfusion text format into a block tree (root children = top-level classes). */
export function parseConf(text: string): ConfBlock {
  const root: ConfBlock = { head: [], line: 0, props: [], children: [] };
  const stack: ConfBlock[] = [root];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trim();
    if (!t || t.startsWith("//")) continue;
    const top = stack[stack.length - 1];
    if (t === "}") {
      if (stack.length > 1) stack.pop();
      continue;
    }
    if (t.endsWith("{")) {
      const block: ConfBlock = {
        head: tokenize(t.slice(0, -1)),
        line: i + 1,
        props: [],
        children: [],
      };
      top.children.push(block);
      stack.push(block);
      continue;
    }
    const m = /^(\S+)\s*(.*)$/.exec(t);
    if (m) top.props.push({ key: m[1], value: m[2], line: i + 1, raw: t });
  }
  return root;
}

/** Value of a property as a string (one quoted token unquoted, else the raw text). */
export function propString(p: ConfProp | undefined): string | undefined {
  if (!p) return undefined;
  const tok = tokenize(p.value);
  return tok.length === 1 ? tok[0] : p.value;
}

function prop(b: ConfBlock, key: string): ConfProp | undefined {
  return b.props.find((p) => p.key === key);
}

function walk(b: ConfBlock, f: (x: ConfBlock) => void): void {
  f(b);
  for (const c of b.children) walk(c, f);
}

// ── Links and the Welcome panel ───────────────────────────────────────────────

/** Documentation-link key (as written in the file) to module; the rest is `Shared`. */
const DOC_KEY_MODULE: Record<string, (typeof MODULES)[number]> = {
  "Resource Manager": "ResourceManager",
  "Script Editor": "ScriptEditor",
  "Audio Editor": "AudioEditor",
  "Animation Editor": "AnimEditor",
  "String Editor": "LocalizationEditor",
  "World Editor": "WorldEditor",
  "Procedural Animation Editor": "ProcAnimEditor",
  "Behavior Editor": "BehaviorEditor",
  "Particle Editor": "ParticleEditor",
};

export const WELCOME_PANEL_KEY = { path: ["WelcomeScreen"] };

export interface PlannedRow {
  obs: Observation;
}

function quoteOf(s: string): string {
  return s.trim().slice(0, QUOTE_MAX);
}

function viaFile(path: string): { path: "file-format"; reason: string } {
  return { path: "file-format", reason: path };
}

/** link-format rows of `documentationLinks.conf`. */
export function documentationLinkRows(text: string, path = DOC_LINKS_PATH): Observation[] {
  const root = parseConf(text);
  const rows: Observation[] = [];
  for (const top of root.children) {
    if (top.head[0] !== "WBDocumentation") continue;
    walk(top, (b) => {
      if (b.head[0] !== "WBDocumentationLink") return;
      const keyP = prop(b, "Key");
      const urlP = prop(b, "LinkURL");
      const url = propString(urlP);
      const key = propString(keyP);
      if (!urlP || !url) return;
      rows.push({
        dim: "link",
        kind: "link-format",
        module: (key && DOC_KEY_MODULE[key]) || "Shared",
        key: { name: url },
        parent_key: null,
        label: key || undefined,
        what: key ? `Documentation link for ${key}` : undefined,
        origin: "vanilla",
        ref: `pak:${path}#L${urlP.line}`,
        quote: quoteOf(urlP.raw),
        confidence: "high",
        paths_proposed: [viaFile(path)],
      });
    });
  }
  return rows;
}

export interface WelcomeResult {
  panel: Observation | null;
  links: Observation[];
  /** Properties of the root that have no row kind (logo image path). */
  unrowed: { key: string; value: string; line: number }[];
}

/** The Welcome panel and its link-format rows from `welcomeScreen.conf`. */
export function welcomeRows(text: string, path = WELCOME_PATH): WelcomeResult {
  const root = parseConf(text);
  const top = root.children.find((c) => c.head[0] === "WelcomeScreen");
  if (!top) return { panel: null, links: [], unrowed: [] };
  const links: Observation[] = [];
  walk(top, (b) => {
    if (!b.head.includes("WelcomeScreenLink")) return;
    const urlP = prop(b, "LinkURL");
    const url = propString(urlP);
    const textP = prop(b, "LinkText");
    if (!urlP || !url) return;
    links.push({
      dim: "link",
      kind: "link-format",
      module: "none",
      key: { name: url },
      parent_key: {
        dim: "ui",
        kind: "panel",
        module: "none",
        key: { path: [...WELCOME_PANEL_KEY.path] },
      },
      label: propString(textP) || undefined,
      origin: "vanilla",
      ref: `pak:${path}#L${urlP.line}`,
      quote: quoteOf(urlP.raw),
      confidence: "high",
      paths_proposed: [viaFile(path)],
    });
  });
  const unrowed = top.props
    .filter((p) => p.key === "LogoImagePath")
    .map((p) => ({ key: p.key, value: propString(p) ?? "", line: p.line }));
  const panel: Observation = {
    dim: "ui",
    kind: "panel",
    module: "none",
    key: { path: [...WELCOME_PANEL_KEY.path] },
    label: "WelcomeScreen",
    origin: "vanilla",
    ref: `pak:${path}#L${top.line}`,
    quote: quoteOf(text.split(/\r?\n/)[top.line - 1] ?? ""),
    confidence: "medium",
    children_count: links.length,
    unverified: [
      "kind and Resource Manager placement come from the recon (resource-manager.md, gui-census-feasibility.md), not from the file",
      "the title shown on the tab is not in the file; the key is the file's root class",
    ],
    paths_proposed: [viaFile(path)],
  };
  return { panel, links, unrowed };
}

// ── Script scan: plugin and tool classes with their [Attribute] members ───────

export interface ScriptMember {
  name: string;
  /** Line of the first attribute of the member. */
  line: number;
  /** Last line of the member's attribute block. */
  lineEnd: number;
  /** Declaration without modifiers and initializer, e.g. `ResourceName m_sConfig`. */
  signature: string;
  type: string;
  /** Full text of the member's `[Attribute(...)]` block. */
  attrText: string;
}

export interface ScriptClass {
  name: string;
  file: string;
  line: number;
  kind: "plugin" | "tool";
  base?: string;
  modules: string[];
  members: ScriptMember[];
  /** String constants of the class: name to value. */
  consts: Record<string, string>;
  /** Text of the class body (from its declaration to the next class declaration). */
  body: string;
}

const CLASS_RE = /^\s*(?:(?:modded|sealed)\s+)*class\s+(\w+)(?:\s*<[^>]*>)?\s*(?::\s*(\w+))?/;
const MODIFIERS = new Set([
  "protected",
  "private",
  "static",
  "const",
  "ref",
  "autoptr",
  "owned",
  "notnull",
  "override",
  "proto",
  "native",
  "volatile",
  "external",
  "event",
  "sealed",
]);

function bracketDepthDelta(s: string): number {
  let d = 0;
  let inQ = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) {
      if (c === "\\") i++;
      else if (c === '"') inQ = false;
    } else if (c === '"') inQ = true;
    else if (c === "[") d++;
    else if (c === "]") d--;
  }
  return d;
}

/** Splits an attribute's argument list at top-level commas. */
export function splitArgs(inner: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inQ = false;
  let cur = "";
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (inQ) {
      cur += c;
      if (c === "\\" && i + 1 < inner.length) cur += inner[++i];
      else if (c === '"') inQ = false;
      continue;
    }
    if (c === '"') {
      inQ = true;
      cur += c;
    } else if (c === "(" || c === "{" || c === "[" || c === "<") {
      depth++;
      cur += c;
    } else if (c === ")" || c === "}" || c === "]" || c === ">") {
      depth--;
      cur += c;
    } else if (c === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** The argument list of `[Name(...)]`. */
export function attributeArgs(attrText: string): string[] {
  const open = attrText.indexOf("(");
  const close = attrText.lastIndexOf(")");
  if (open < 0 || close < open) return [];
  return splitArgs(attrText.slice(open + 1, close));
}

function unquote(s: string): string | undefined {
  const t = s.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    return t.slice(1, -1).replace(/\\n/g, " ").replace(/\\"/g, '"').replace(/\s+/g, " ").trim();
  }
  return undefined;
}

/** `desc:` of an `[Attribute]` (named, else the third positional argument). */
export function attributeDesc(attrText: string): string | undefined {
  const args = attributeArgs(attrText);
  let positional = 0;
  for (const a of args) {
    const named = /^(\w+)\s*:\s*(.*)$/s.exec(a);
    if (named) {
      if (named[1] === "desc") return unquote(named[2]) || undefined;
      continue;
    }
    if (positional === 2) return unquote(a) || undefined;
    positional++;
  }
  return undefined;
}

/** `params:` of an `[Attribute]` (named, else the fourth positional argument). */
function attributeParams(attrText: string): string | undefined {
  const args = attributeArgs(attrText);
  let positional = 0;
  for (const a of args) {
    const named = /^(\w+)\s*:\s*(.*)$/s.exec(a);
    if (named) {
      if (named[1] === "params") return unquote(named[2]);
      continue;
    }
    if (positional === 3) return unquote(a);
    positional++;
  }
  return undefined;
}

/** The default value argument of an `[Attribute]` (named `defvalue:` or the first positional). */
function attributeDefault(attrText: string): string | undefined {
  const args = attributeArgs(attrText);
  let positional = 0;
  for (const a of args) {
    const named = /^(\w+)\s*:\s*(.*)$/s.exec(a);
    if (named) {
      if (named[1] === "defvalue") return named[2].trim();
      continue;
    }
    if (positional === 0) return a.trim();
    positional++;
  }
  return undefined;
}

function modulesOf(attrText: string): string[] {
  const m = /wbModules\s*:\s*\{([^}]*)\}/.exec(attrText);
  if (!m) return [];
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

/** A member declaration line to {type, name}; null for methods and anything else. */
export function parseMemberDecl(line: string): { type: string; name: string } | null {
  const cut = line.split("//")[0];
  const head = cut.split(/[;=]/)[0].trim();
  if (!head || head.includes("(") || head.startsWith("#")) return null;
  const words = head.split(/\s+/).filter((w) => !MODIFIERS.has(w));
  if (words.length < 2) return null;
  const name = words[words.length - 1];
  if (!/^\w+$/.test(name)) return null;
  const type = words
    .slice(0, -1)
    .join(" ")
    .replace(/\s*([<>,])\s*/g, "$1");
  return { type, name };
}

/**
 * Replaces the text of every block comment (delimiters included) with spaces,
 * keeping line breaks so line numbers do not move. String literals are skipped
 * (a `"/*"` inside a string is not a comment); `//` comments run to the line end.
 */
export function stripBlockComments(text: string): string {
  let out = "";
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    const d = text[i + 1];
    if (c === '"') {
      let j = i + 1;
      while (j < n && text[j] !== '"' && text[j] !== "\n") {
        if (text[j] === "\\") j++;
        j++;
      }
      out += text.slice(i, Math.min(j + 1, n));
      i = j + 1;
    } else if (c === "/" && d === "/") {
      let j = i;
      while (j < n && text[j] !== "\n") j++;
      out += text.slice(i, j);
      i = j;
    } else if (c === "/" && d === "*") {
      let j = i + 2;
      while (j < n && !(text[j] === "*" && text[j + 1] === "/")) j++;
      j = Math.min(j + 2, n);
      out += text.slice(i, j).replace(/[^\r\n]/g, " ");
      i = j;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** Plugin and tool classes of one script file. */
export function scanScript(file: string, text: string): ScriptClass[] {
  const lines = text.split(/\r?\n/);
  interface Seg {
    name: string;
    line: number;
    base?: string;
    attrs: { name: string; text: string }[];
    members: ScriptMember[];
    consts: Record<string, string>;
    start: number;
    end: number;
  }
  const segs: Seg[] = [];
  let cur: Seg | null = null;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();
    if (/^\[\s*[A-Za-z_]\w*/.test(t)) {
      // Collect consecutive attribute blocks, then the target line.
      const blocks: { name: string; text: string; start: number; end: number }[] = [];
      let j = i;
      while (j < lines.length && /^\[\s*[A-Za-z_]\w*/.test(lines[j].trim())) {
        const start = j;
        let depth = 0;
        const parts: string[] = [];
        do {
          parts.push(lines[j].trim());
          depth += bracketDepthDelta(lines[j]);
          j++;
        } while (depth > 0 && j < lines.length);
        const textAll = parts.join(" ");
        blocks.push({
          name: /^\[\s*(\w+)/.exec(textAll)?.[1] ?? "",
          text: textAll,
          start: start + 1,
          end: j,
        });
      }
      let k = j;
      while (
        k < lines.length &&
        (lines[k].trim() === "" ||
          lines[k].trim().startsWith("//") ||
          lines[k].trim().startsWith("#"))
      )
        k++;
      const target = lines[k] ?? "";
      const cm = CLASS_RE.exec(target);
      if (cm) {
        cur = {
          name: cm[1],
          line: k + 1,
          base: cm[2],
          attrs: blocks.map((b) => ({ name: b.name, text: b.text })),
          members: [],
          consts: {},
          start: k,
          end: lines.length,
        };
        if (segs.length) segs[segs.length - 1].end = k;
        segs.push(cur);
        i = k + 1;
        continue;
      }
      const decl = parseMemberDecl(target);
      const attr = blocks.find((b) => b.name === "Attribute");
      if (cur && decl && attr) {
        cur.members.push({
          name: decl.name,
          line: attr.start,
          lineEnd: attr.end,
          signature: `${decl.type} ${decl.name}`,
          type: decl.type,
          attrText: attr.text,
        });
      }
      i = k + 1;
      continue;
    }
    const cm = CLASS_RE.exec(line);
    if (cm && !t.startsWith("//") && !t.startsWith("*")) {
      cur = {
        name: cm[1],
        line: i + 1,
        base: cm[2],
        attrs: [],
        members: [],
        consts: {},
        start: i,
        end: lines.length,
      };
      if (segs.length) segs[segs.length - 1].end = i;
      segs.push(cur);
    } else if (cur) {
      const cn = /\bconst\s+(?:string|ResourceName)\s+(\w+)\s*=\s*"([^"]*)"/.exec(line);
      if (cn && !t.startsWith("//")) cur.consts[cn[1]] = cn[2];
    }
    i++;
  }
  const out: ScriptClass[] = [];
  for (const s of segs) {
    const pa = s.attrs.find((a) => a.name === "WorkbenchPluginAttribute");
    const ta = s.attrs.find((a) => a.name === "WorkbenchToolAttribute");
    const a = pa ?? ta;
    if (!a) continue;
    out.push({
      name: s.name,
      file,
      line: s.line,
      kind: pa ? "plugin" : "tool",
      base: s.base,
      modules: modulesOf(a.text),
      members: s.members,
      consts: s.consts,
      body: lines.slice(s.start + 1, s.end).join("\n"),
    });
  }
  return out;
}

const MODULE_SET = new Set<string>(MODULES);

/**
 * The module of a plugin or tool class, by the rule E03, E15 and E18 share:
 * exactly one wbModules entry naming a vocabulary module gives that module;
 * no entry, several entries or an unknown name gives Shared. The base class
 * and the folder are not consulted, so the four enumerators agree on every id.
 */
export function moduleOfClass(c: ScriptClass): (typeof MODULES)[number] {
  if (c.modules.length === 1 && MODULE_SET.has(c.modules[0])) {
    return c.modules[0] as (typeof MODULES)[number];
  }
  return "Shared";
}

// ── Config files and their owners ─────────────────────────────────────────────

export interface ConfFile {
  path: string;
  size: number;
  /** First class name of the file, or "" when the file has no block. */
  rootClass: string;
  text: string;
}

export type LinkMethod = "attribute-path" | "attribute-class" | "sibling" | "class-body";

export interface Owner {
  cls: ScriptClass;
  member: ScriptMember;
  /** Config files taken by this member, with how each was linked. */
  confs: Map<string, LinkMethod>;
}

export interface DanglingRef {
  script: string;
  line: number;
  literal: string;
}

export interface OwnerResolution {
  owners: Owner[];
  /** conf path -> owners ("Class#member") and method; empty for unlinked files. */
  byConf: Map<string, { owner: string; method: LinkMethod }[]>;
  /** conf path -> parent conf path, for files another config names. */
  subConfigs: Map<string, string>;
  unlinked: string[];
  ambiguous: { path: string; candidates: string[] }[];
  dangling: DanglingRef[];
  /** `Configs/Workbench/...` literals outside any [Attribute]: hard-wired uses. */
  hardWired: { script: string; line: number; literal: string; exists: boolean }[];
}

const CONF_LITERAL = /(?:\{[0-9A-Fa-f]{16}\})?(Configs\/Workbench\/[^"'\s,)]+)/g;

function confLiterals(text: string): string[] {
  return [...text.matchAll(CONF_LITERAL)].map((m) => m[1]);
}

/** Links every config file to the plugin and tool members that take it (see the file header). */
export function resolveOwners(
  confs: readonly ConfFile[],
  classes: readonly ScriptClass[],
  scriptLines: ReadonlyMap<string, string[]>,
): OwnerResolution {
  const byLower = new Map(confs.map((c) => [c.path.toLowerCase(), c] as const));
  const owners = new Map<string, Owner>();
  const dangling: DanglingRef[] = [];
  const ownerOf = (cls: ScriptClass, member: ScriptMember): Owner => {
    const k = `${cls.name}#${member.name}`;
    let o = owners.get(k);
    if (!o) {
      o = { cls, member, confs: new Map() };
      owners.set(k, o);
    }
    return o;
  };
  const link = (o: Owner, path: string, method: LinkMethod): void => {
    if (!o.confs.has(path)) o.confs.set(path, method);
  };

  // Sub-configs: files that another config file names by path.
  const subConfigs = new Map<string, string>();
  for (const c of confs) {
    for (const lit of confLiterals(c.text)) {
      const target = byLower.get(lit.toLowerCase());
      if (target && target.path !== c.path && !subConfigs.has(target.path)) {
        subConfigs.set(target.path, c.path);
      }
    }
  }
  const direct = confs.filter((c) => !subConfigs.has(c.path));

  const attributeLines = new Map<string, Set<number>>();
  /** "file|literal" of every config literal an [Attribute] uses, directly or through a constant. */
  const attributeBacked = new Set<string>();
  // (1) attribute names the file.
  for (const cls of classes) {
    for (const m of cls.members) {
      const lines = attributeLines.get(cls.file) ?? new Set<number>();
      attributeLines.set(cls.file, lines);
      for (let l = m.line; l <= m.lineEnd; l++) lines.add(l);
      const lits = new Set(confLiterals(m.attrText));
      const def = attributeDefault(m.attrText);
      if (def && /^[A-Za-z_]\w*$/.test(def) && cls.consts[def]) {
        for (const lit of confLiterals(cls.consts[def])) lits.add(lit);
      }
      for (const lit of [...lits].sort(compareCodeUnits)) {
        attributeBacked.add(`${cls.file}|${lit.toLowerCase()}`);
        const f = byLower.get(lit.toLowerCase());
        if (f) link(ownerOf(cls, m), f.path, "attribute-path");
        else dangling.push({ script: cls.file, line: m.line, literal: lit });
      }
    }
  }
  // (2) attribute says conf class=R, or the member's type is R.
  const roots = new Set(direct.map((c) => c.rootClass).filter(Boolean));
  for (const cls of classes) {
    for (const m of cls.members) {
      const params = attributeParams(m.attrText) ?? "";
      const named = /\bconf\s+class=(\w+)/.exec(params)?.[1];
      const typeR = m.type
        .replace(/^array<(.*)>$/, "$1")
        .split(" ")
        .pop();
      const R = named && roots.has(named) ? named : typeR && roots.has(typeR) ? typeR : undefined;
      if (!R) continue;
      for (const f of direct)
        if (f.rootClass === R) link(ownerOf(cls, m), f.path, "attribute-class");
    }
  }
  // (3) siblings of a file linked by (1): same folder, same root class.
  const dirOf = (p: string): string => p.slice(0, p.lastIndexOf("/"));
  const claimed = (): Set<string> => {
    const s = new Set<string>();
    for (const o of owners.values()) for (const p of o.confs.keys()) s.add(p);
    return s;
  };
  {
    const have = claimed();
    for (const o of [...owners.values()]) {
      const seeds = [...o.confs.entries()].filter(([, m]) => m === "attribute-path");
      for (const [seedPath] of seeds) {
        const seed = byLower.get(seedPath.toLowerCase());
        if (!seed) continue;
        for (const f of direct) {
          if (
            !have.has(f.path) &&
            dirOf(f.path) === dirOf(seed.path) &&
            f.rootClass === seed.rootClass
          ) {
            link(o, f.path, "sibling");
          }
        }
      }
    }
  }
  // (4) class body names the root class and has exactly one ResourceName member with "conf" params.
  const ambiguous: OwnerResolution["ambiguous"] = [];
  {
    const have = claimed();
    for (const f of direct) {
      if (have.has(f.path) || !f.rootClass) continue;
      const word = new RegExp(`\\b${f.rootClass}\\b`);
      const cands: { cls: ScriptClass; m: ScriptMember }[] = [];
      for (const cls of classes) {
        if (!word.test(cls.body)) continue;
        for (const m of cls.members) {
          if (m.type !== "ResourceName") continue;
          const params = attributeParams(m.attrText);
          if (params !== undefined && /(^|\s)conf(\s|$)/.test(params)) cands.push({ cls, m });
        }
      }
      if (cands.length === 1) link(ownerOf(cands[0].cls, cands[0].m), f.path, "class-body");
      else if (cands.length > 1) {
        ambiguous.push({
          path: f.path,
          candidates: cands.map((c) => `${c.cls.name}#${c.m.name}`).sort(compareCodeUnits),
        });
      }
    }
  }

  const byConf = new Map<string, { owner: string; method: LinkMethod }[]>();
  for (const [k, o] of owners) {
    for (const [p, method] of o.confs) {
      const list = byConf.get(p) ?? [];
      list.push({ owner: k, method });
      byConf.set(p, list);
    }
  }
  const ownerList = [...owners.values()]
    .filter((o) => o.confs.size > 0)
    .sort((a, b) =>
      compareCodeUnits(`${a.cls.name}#${a.member.name}`, `${b.cls.name}#${b.member.name}`),
    );
  const unlinked = direct
    .map((c) => c.path)
    .filter((p) => !byConf.has(p))
    .sort(compareCodeUnits);

  // Hard-wired literals: in plugin/tool files, outside every [Attribute] line, not in comments.
  const hardWired: OwnerResolution["hardWired"] = [];
  const pluginFiles = new Set(classes.map((c) => c.file));
  for (const file of [...pluginFiles].sort(compareCodeUnits)) {
    const lines = scriptLines.get(file) ?? [];
    const attrLines = attributeLines.get(file) ?? new Set<number>();
    lines.forEach((l, idx) => {
      if (l.trim().startsWith("//") || attrLines.has(idx + 1)) return;
      for (const lit of confLiterals(l)) {
        if (attributeBacked.has(`${file}|${lit.toLowerCase()}`)) continue;
        hardWired.push({
          script: file,
          line: idx + 1,
          literal: lit,
          exists: byLower.has(lit.toLowerCase()),
        });
      }
    });
  }

  return {
    owners: ownerList,
    byConf,
    subConfigs,
    unlinked,
    ambiguous: ambiguous.sort((a, b) => compareCodeUnits(a.path, b.path)),
    dangling: dangling.sort(
      (a, b) =>
        compareCodeUnits(a.script, b.script) ||
        a.line - b.line ||
        compareCodeUnits(a.literal, b.literal),
    ),
    hardWired,
  };
}

/** plugin-setting rows, one per owning member. */
export function pluginSettingRows(
  res: OwnerResolution,
  scriptLines: ReadonlyMap<string, string[]>,
): Observation[] {
  const rows: Observation[] = [];
  for (const o of res.owners) {
    const module = moduleOfClass(o.cls);
    const methods = new Set(o.confs.values());
    const weak = !(methods.has("attribute-path") || methods.has("attribute-class"));
    const line = scriptLines.get(o.cls.file)?.[o.member.line - 1] ?? "";
    rows.push({
      dim: "plugin",
      kind: "plugin-setting",
      module,
      key: { class: o.cls.name, attr: o.member.name },
      parent_key: {
        dim: "plugin",
        kind: o.cls.kind,
        module,
        key: { class: o.cls.name },
      },
      label: o.member.name,
      signature: o.member.signature,
      what: attributeDesc(o.member.attrText),
      origin: "vanilla",
      ref: `pak:${o.cls.file}#L${o.member.line}`,
      quote: quoteOf(line),
      confidence: weak ? "medium" : "high",
    });
  }
  return rows;
}

// ── Derived tables ────────────────────────────────────────────────────────────

export interface IconRow {
  path: string;
  /** `.et` (prefab) or `.emat` (material). */
  ext: string;
  parent: string;
  object: string;
  material: string;
}

/**
 * Entity-icon prefabs and materials: every `.et` and `.emat` under an `EntityIcons` folder, in the
 * Workbench-owned folders (system/wbdata, WBData) and in the World Editor icon prefabs that inherit
 * from them (Prefabs/WorldEditor/EntityIcons), with their parent, mesh and material.
 */
export function entityIconRows(pak: PakLike): IconRow[] {
  const rows: IconRow[] = [];
  for (const p of pak.allFilePaths().sort(compareCodeUnits)) {
    const ext = extOf(p);
    if (!/\/EntityIcons\//i.test(p) || (ext !== ".et" && ext !== ".emat")) continue;
    const text = pak.readTextFile(p);
    const first = /^\s*\w+\s*:\s*"(?:\{[0-9A-Fa-f]{16}\})?([^"]+)"/m.exec(text);
    const obj = /^\s*Object\s+"(?:\{[0-9A-Fa-f]{16}\})?([^"]+)"/m.exec(text);
    const mat = /^\s*AssignedMaterial\s+"(?:\{[0-9A-Fa-f]{16}\})?([^"]+)"/m.exec(text);
    rows.push({
      path: p,
      ext,
      parent: first?.[1] ?? "",
      object: obj?.[1] ?? "",
      material: mat?.[1] ?? "",
    });
  }
  return rows;
}

export interface UiScan {
  /** In-scope text files read for the scan. */
  scannedFiles: number;
  /** In-scope files by extension that could hold a UI definition (layout, ui, qss, ini, json...). */
  uiExtFiles: string[];
  /** In-scope lines naming a menu, toolbar, dock, shortcut, layout or action. */
  matches: { path: string; line: number; text: string }[];
  /** Pak-wide names (game and Tools paks) of Workbench UI definition file candidates. */
  nameCandidates: { pak: "game" | "tools"; path: string }[];
}

const UI_WORD = /\b(menu|menubar|toolbar|dock|shortcut|hotkey|keybind\w*|layout|actions?)\b/i;
const UI_EXT = new Set([".layout", ".ui", ".qss", ".ini", ".json", ".xml", ".st", ".styles"]);
const NAME_CAND =
  /(toolbar|menubar|workbench[^/]*(menu|layout|shortcut)|(^|\/)(shortcuts?|hotkeys?)[^/]*$|\.qss$)/i;
const TEXT_EXT = new Set([".conf", ".et", ".emat", ".ptc", ".layout", ".c", ".txt"]);

export function scanUiDefinitions(sources: Sources): UiScan {
  let scanned = 0;
  const matches: UiScan["matches"] = [];
  const uiExtFiles: string[] = [];
  for (const p of sources.game.allFilePaths().sort(compareCodeUnits)) {
    if (scopeFamily(p) === null) continue;
    const ext = extOf(p);
    if (UI_EXT.has(ext)) uiExtFiles.push(p);
    if (!TEXT_EXT.has(ext)) continue;
    scanned++;
    sources.game
      .readTextFile(p)
      .split(/\r?\n/)
      .forEach((l, i) => {
        if (UI_WORD.test(l)) matches.push({ path: p, line: i + 1, text: l.trim().slice(0, 120) });
      });
  }
  const nameCandidates: UiScan["nameCandidates"] = [];
  for (const [which, pak] of [
    ["game", sources.game],
    ["tools", sources.tools],
  ] as const) {
    if (!pak) continue;
    for (const p of pak.allFilePaths().sort(compareCodeUnits)) {
      if (
        !/^(scripts|worlds|Assets|Sounds|Prefabs|PrefabsEditable|PrefabLibrary|anims)\//i.test(p) &&
        NAME_CAND.test(p)
      ) {
        nameCandidates.push({ pak: which, path: p });
      }
    }
  }
  return { scannedFiles: scanned, uiExtFiles, matches, nameCandidates };
}

/** Distinct `enfusion://` templates in plugin-side scripts (counted, not emitted). */
export function enfusionTemplates(scriptLines: ReadonlyMap<string, string[]>): {
  files: number;
  literals: number;
} {
  const lits = new Set<string>();
  const files = new Set<string>();
  for (const [file, lines] of scriptLines) {
    for (const l of lines) {
      for (const m of l.matchAll(/enfusion:\/\/[^"\s)]*/g)) {
        lits.add(m[0]);
        files.add(file);
      }
    }
  }
  return { files: files.size, literals: lits.size };
}

// ── Enumeration ───────────────────────────────────────────────────────────────

export interface LeftOut {
  what: string;
  count: number;
  why: string;
}

export interface EnumerateOptions {
  /** Compare every Tools-pak file with the game paks (slow) instead of the in-scope files. */
  compareAll?: boolean;
}

export interface Enumeration {
  observations: { id: string; obs: Observation }[];
  /** Rejected rows and row paths missing from the paks (the gate wants none). */
  problems: string[];
  inputs: { path: string; sha256: string }[];
  measure: { game: FamilyCounts; tools: FamilyCounts | null };
  compare: { scope: "in-scope" | "all"; entries: CompareEntry[] } | null;
  confFiles: ConfFile[];
  resolution: OwnerResolution;
  icons: IconRow[];
  uiScan: UiScan;
  welcomeUnrowed: { key: string; value: string; line: number }[];
  pluginClassCount: number;
  templates: { files: number; literals: number };
  leftOut: LeftOut[];
}

function inputPath(virtualPath: string): string {
  return `<game>/addons#${virtualPath}`;
}

/** Runs the enumerator over the given paks. Pure apart from reading them. */
export function enumerate(sources: Sources, options: EnumerateOptions = {}): Enumeration {
  const { game, tools } = sources;
  const problems: string[] = [];
  const inputs = new Map<string, string>();
  const gamePaths = game.allFilePaths().sort(compareCodeUnits);
  const gameSet = new Set(gamePaths);
  const lowerToPath = new Map(gamePaths.map((p) => [p.toLowerCase(), p] as const));
  const readCache = new Map<string, string[]>();
  const readLines = (p: string, markInput: boolean): string[] => {
    let lines = readCache.get(p);
    if (!lines) {
      const text = game.readTextFile(p);
      lines = text.split(/\r?\n/);
      readCache.set(p, lines);
      if (markInput) inputs.set(inputPath(p), sha256(game.readFile(p)));
    }
    return lines;
  };

  const measure = { game: measureScope(game), tools: tools ? measureScope(tools) : null };

  // Config files.
  const confPaths = gamePaths.filter(
    (p) => scopeFamily(p) === "Configs/Workbench" && extOf(p) === ".conf",
  );
  const confFiles: ConfFile[] = confPaths.map((path) => {
    const text = game.readTextFile(path);
    const root = parseConf(text).children[0];
    return { path, size: game.fileSize(path), rootClass: root?.head[0] ?? "", text };
  });
  const special = new Set([DOC_LINKS_PATH, WELCOME_PATH]);
  const pluginConfs = confFiles.filter((c) => !special.has(c.path));

  const planned: Observation[] = [];
  let welcomeUnrowed: Enumeration["welcomeUnrowed"] = [];
  const docs = confFiles.find((c) => c.path === DOC_LINKS_PATH);
  if (docs) {
    inputs.set(inputPath(docs.path), sha256(game.readFile(docs.path)));
    planned.push(...documentationLinkRows(docs.text));
  }
  const welcome = confFiles.find((c) => c.path === WELCOME_PATH);
  if (welcome) {
    inputs.set(inputPath(welcome.path), sha256(game.readFile(welcome.path)));
    const w = welcomeRows(welcome.text);
    if (w.panel) planned.push(w.panel);
    planned.push(...w.links);
    welcomeUnrowed = w.unrowed;
  }

  // Scripts: plugin and tool classes.
  const classes: ScriptClass[] = [];
  /** Original lines (for quotes) and comment-stripped lines (for every scan). */
  const scriptLines = new Map<string, string[]>();
  const activeLines = new Map<string, string[]>();
  for (const p of gamePaths) {
    if (!/^scripts\/.+\.c$/i.test(p)) continue;
    const text = game.readTextFile(p);
    const active = stripBlockComments(text);
    if (!/Workbench(Plugin|Tool)Attribute|Configs\/Workbench|enfusion:\/\//.test(active)) continue;
    scriptLines.set(p, text.split(/\r?\n/));
    activeLines.set(p, active.split(/\r?\n/));
    const found = scanScript(p, active);
    if (found.length) classes.push(...found);
  }
  const resolution = resolveOwners(pluginConfs, classes, activeLines);
  const settingRows = pluginSettingRows(resolution, scriptLines);
  for (const o of resolution.owners) {
    // Hash the pak bytes (the scripts are CRLF), like the config inputs, so the header can be
    // checked against the pak.
    inputs.set(inputPath(o.cls.file), sha256(game.readFile(o.cls.file)));
    for (const p of o.confs.keys()) {
      const c = confFiles.find((x) => x.path === p);
      if (c) inputs.set(inputPath(p), sha256(game.readFile(p)));
    }
  }
  planned.push(...settingRows);

  // Validate, derive ids, check paths and quotes.
  const seen = new Map<string, string>();
  const observations: { id: string; obs: Observation }[] = [];
  for (const obs of planned) {
    const where = `${obs.kind} ${obs.ref}`;
    const parsed = observationSchema.safeParse(obs);
    if (!parsed.success) {
      problems.push(
        `${where}: ${parsed.error.issues[0].path.join(".")}: ${parsed.error.issues[0].message}`,
      );
      continue;
    }
    let id: string;
    try {
      id = deriveId(parsed.data);
    } catch (e) {
      problems.push(`${where}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    if (containsMachinePath(JSON.stringify(parsed.data))) {
      problems.push(`${where}: contains a machine path`);
      continue;
    }
    const m = /^pak:([^#]+)(?:#L(\d+))?$/.exec(parsed.data.ref);
    if (!m || !gameSet.has(m[1])) {
      problems.push(`${where}: path is not in the game paks`);
      continue;
    }
    if (m[2] !== undefined && parsed.data.quote !== undefined) {
      const line = readLines(m[1], false)[Number(m[2]) - 1] ?? "";
      if (!line.includes(parsed.data.quote.trim().slice(0, QUOTE_MAX)))
        problems.push(`${where}: quote is not on line ${m[2]}`);
    }
    if (parsed.data.parent_key) {
      const pk = parsed.data.parent_key;
      if (pk.kind === "panel" && !planned.some((o) => o.kind === "panel")) {
        problems.push(`${where}: parent panel was not emitted`);
      }
    }
    const prior = seen.get(id);
    if (prior) {
      problems.push(`${where}: duplicate of ${prior} (same id ${id})`);
      continue;
    }
    seen.set(id, parsed.data.ref);
    observations.push({ id, obs: parsed.data });
  }
  observations.sort((a, b) => compareCodeUnits(a.id, b.id));

  // Comparison and derived inventories.
  const compare = tools
    ? {
        scope: options.compareAll ? ("all" as const) : ("in-scope" as const),
        entries: comparePaks(game, tools, options.compareAll ? "all" : "in-scope"),
      }
    : null;
  const icons = entityIconRows(game);
  const uiScan = scanUiDefinitions(sources);
  const templates = enfusionTemplates(activeLines);

  // Left out.
  const inScopeAll = gamePaths.filter((p) => scopeFamily(p) !== null);
  const assetFamilies = new Map<string, number>();
  for (const p of inScopeAll) {
    if (scopeFamily(p) === "Configs/Workbench" && extOf(p) === ".conf") continue;
    const fam = scopeFamily(p) as string;
    assetFamilies.set(fam, (assetFamilies.get(fam) ?? 0) + 1);
  }
  const leftOut: LeftOut[] = [];
  for (const [fam, n] of [...assetFamilies].sort((a, b) => compareCodeUnits(a[0], b[0]))) {
    leftOut.push({
      what: `${fam} asset files (meshes, materials, textures, prefabs)`,
      count: n,
      why: "no row kind in E17's entry fits a resource asset; listed in inventory.tsv, icon prefabs in entity-icons.tsv",
    });
  }
  const linked = new Set<string>();
  for (const o of resolution.owners) for (const p of o.confs.keys()) linked.add(p);
  const sub = resolution.subConfigs.size;
  if (sub)
    leftOut.push({
      what: "config files that another config names by path (sub-configs)",
      count: sub,
      why: "they are parts of their parent config, not separate plugin settings; listed in config-owners.tsv",
    });
  if (resolution.unlinked.length)
    leftOut.push({
      what: "Configs/Workbench files with no plugin member found for them",
      count: resolution.unlinked.length,
      why: "the script that loads them holds the path in a non-[Attribute] member or a constant; listed in config-owners.tsv",
    });
  if (resolution.ambiguous.length)
    leftOut.push({
      what: "Configs/Workbench files with more than one candidate member",
      count: resolution.ambiguous.length,
      why: "no single owner member could be named",
    });
  if (resolution.dangling.length)
    leftOut.push({
      what: "Configs/Workbench paths named by a plugin attribute but absent from the paks",
      count: resolution.dangling.length,
      why: "no data file to read; the member itself belongs to E15",
    });
  const hw = resolution.hardWired.filter((h) => h.exists).length;
  if (hw)
    leftOut.push({
      what: "Configs/Workbench paths held outside any [Attribute] (constants, plain members)",
      count: hw,
      why: "a hard-wired load is not a user setting; no plugin-setting row",
    });
  if (welcomeUnrowed.length)
    leftOut.push({
      what: "welcomeScreen.conf LogoImagePath (a Qt resource path)",
      count: welcomeUnrowed.length,
      why: "not a link and no other kind fits",
    });
  if (templates.literals)
    leftOut.push({
      what: "enfusion:// link templates in Workbench-side scripts",
      count: templates.literals,
      why: "they live in scripts, outside E17's folders; E02, E05 and E07 own them",
    });

  return {
    observations,
    problems,
    inputs: [...inputs.entries()]
      .map(([path, hash]) => ({ path, sha256: hash }))
      .sort((a, b) => compareCodeUnits(a.path, b.path)),
    measure,
    compare,
    confFiles,
    resolution,
    icons,
    uiScan,
    welcomeUnrowed,
    pluginClassCount: classes.length,
    templates,
    leftOut,
  };
}

/** Exact text of the E17 observation file. */
export function observationFileText(result: Enumeration, build: string): string {
  const header = {
    $header: 1,
    build,
    enumerator: ENUMERATOR_ID,
    generator: GENERATOR,
    inputs: result.inputs,
    provisional: false,
    row_count: result.observations.length,
  };
  const lines = [
    jsonlLine(header, ["$header"]),
    ...result.observations.map((o) => jsonlLine(o.obs)),
  ];
  return lines.join("\n") + "\n";
}

// ── Derived-table text ────────────────────────────────────────────────────────

function tsv(rows: readonly (readonly (string | number | undefined)[])[]): string {
  return (
    rows
      .map((r) => r.map((c) => String(c ?? "").replace(/[\t\r\n]+/g, " ")).join("\t"))
      .join("\n") + "\n"
  );
}

/** The derived tables written to the artifacts folder, by file name. */
export function derivedTables(result: Enumeration, sources: Sources): Record<string, string> {
  const cmp = new Map((result.compare?.entries ?? []).map((e) => [e.path, e] as const));
  const gamePaths = sources.game
    .allFilePaths()
    .filter((p) => scopeFamily(p) !== null)
    .sort(compareCodeUnits);
  const confByPath = new Map(result.confFiles.map((c) => [c.path, c] as const));
  const toolsSet = new Set(sources.tools?.allFilePaths() ?? []);
  const inventory = tsv([
    ["path", "family", "ext", "game_size", "tools_status", "compare_method", "root_class"],
    ...gamePaths.map((p) => [
      p,
      scopeFamily(p) ?? "",
      extOf(p),
      sources.game.fileSize(p),
      cmp.get(p)?.status ??
        (sources.tools ? (toolsSet.has(p) ? "not-compared" : "game-only") : "no-tools-pak"),
      cmp.get(p)?.method ?? "",
      confByPath.get(p)?.rootClass ?? "",
    ]),
  ]);
  const owners = tsv([
    ["conf_path", "root_class", "size", "linked_to", "method", "sub_config_of"],
    ...result.confFiles.map((c) => {
      const list = result.resolution.byConf.get(c.path) ?? [];
      return [
        c.path,
        c.rootClass,
        c.size,
        list.map((x) => x.owner).join(" | "),
        list.map((x) => x.method).join(" | "),
        result.resolution.subConfigs.get(c.path) ?? "",
      ];
    }),
  ]);
  const icons = tsv([
    ["icon_file", "ext", "parent", "mesh", "material"],
    ...result.icons.map((i) => [i.path, i.ext, i.parent, i.object, i.material]),
  ]);
  const compareRows = (result.compare?.entries ?? []).map((e) => [
    e.path,
    e.status,
    e.method,
    e.gameSize,
    e.toolsSize,
  ]);
  const comparison = tsv([["path", "status", "method", "game_size", "tools_size"], ...compareRows]);
  const summary =
    JSON.stringify(
      {
        measure: result.measure,
        compare_scope: result.compare?.scope ?? null,
        compare_totals: totalsOf(result.compare?.entries ?? []),
        plugin_and_tool_classes_seen: result.pluginClassCount,
        owners: result.resolution.owners.map((o) => ({
          member: `${o.cls.name}#${o.member.name}`,
          confs: o.confs.size,
        })),
        dangling: result.resolution.dangling,
        hard_wired: result.resolution.hardWired,
        ambiguous: result.resolution.ambiguous,
        ui_scan: {
          scanned_files: result.uiScan.scannedFiles,
          ui_ext_files: result.uiScan.uiExtFiles,
          line_matches: result.uiScan.matches,
          name_candidates: result.uiScan.nameCandidates,
        },
        left_out: result.leftOut,
      },
      null,
      2,
    ) + "\n";
  return {
    "inventory.tsv": inventory,
    "config-owners.tsv": owners,
    "entity-icons.tsv": icons,
    "tools-vs-game.tsv": comparison,
    "summary.json": summary,
  };
}

export function totalsOf(
  entries: readonly CompareEntry[],
): Record<CompareStatus | "size_only", number> {
  const t = { identical: 0, differs: 0, "game-only": 0, "tools-only": 0, size_only: 0 };
  for (const e of entries) {
    t[e.status]++;
    if (e.method === "size") t.size_only++;
  }
  return t;
}

// ── CLI ───────────────────────────────────────────────────────────────────────

const USAGE =
  "usage: e17-workbench-data.ts [--build <tag>] [--data <dir>] [--out <file under observations/E17/>] [--artifacts <dir>] [--no-artifacts] [--compare-all] [--json]";

/** Resolves `--out`, refusing anything outside `<census>/observations/E17/`. */
export function resolveOut(paths: CensusPaths, out: string | undefined, build: string): string {
  const dir = join(paths.observations, ENUMERATOR_ID);
  const file = out ? resolve(out) : join(dir, `${build}.jsonl`);
  if (dirname(file) !== dir || !file.endsWith(".jsonl")) {
    throw new Error(
      "refusing --out outside observations/E17/ (E17 writes only its own observation directory)",
    );
  }
  return file;
}

export type SourceLoader = () => { game: PakLike | null; tools: PakLike | null };

export function run(
  argv: string[],
  io: Io = PROCESS_IO,
  load: SourceLoader = loadRealSources,
): number {
  return guard(io, "e17-workbench-data", () => {
    const { values } = parseArgs({
      args: argv,
      options: {
        build: { type: "string" },
        data: { type: "string" },
        out: { type: "string" },
        artifacts: { type: "string" },
        "no-artifacts": { type: "boolean" },
        "compare-all": { type: "boolean" },
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
      io.err(`e17-workbench-data: ${e instanceof Error ? e.message : String(e)}`);
      return EXIT_FAIL;
    }
    let artifactRoot: string | null = null;
    if (!values["no-artifacts"]) {
      const base = values.artifacts ? resolve(values.artifacts) : artifactsDir();
      if (insideGitWorkTree(base)) {
        io.err("e17-workbench-data: refusing an artifacts folder inside a git working tree");
        return EXIT_FAIL;
      }
      artifactRoot = join(base, "census", build, ENUMERATOR_ID);
    }
    const loaded = load();
    if (!loaded.game) {
      io.out("NO DATA: no game pak found; nothing enumerated");
      return EXIT_USAGE;
    }
    const sources: Sources = { game: loaded.game, tools: loaded.tools };
    const result = enumerate(sources, { compareAll: values["compare-all"] === true });
    for (const p of result.problems) io.err(`rejected: ${p}`);
    if (result.problems.length > 0) {
      io.err(`e17-workbench-data: ${result.problems.length} problem(s); nothing written`);
      return EXIT_FAIL;
    }
    mkdirSync(dirname(out), { recursive: true });
    writeFileAtomic(out, observationFileText(result, build));
    if (artifactRoot) {
      mkdirSync(artifactRoot, { recursive: true });
      for (const [name, text] of Object.entries(derivedTables(result, sources))) {
        writeFileAtomic(join(artifactRoot, name), text);
      }
    }
    const byKind: Record<string, number> = {};
    for (const o of result.observations) byKind[o.obs.kind] = (byKind[o.obs.kind] ?? 0) + 1;
    const totals = result.compare ? totalsOf(result.compare.entries) : null;
    if (values.json) {
      io.out(
        JSON.stringify({
          ok: true,
          command: "e17-workbench-data",
          build,
          rows: result.observations.length,
          by_kind: byKind,
          measure: result.measure,
          compare: result.compare ? { scope: result.compare.scope, totals } : null,
          plugin_and_tool_classes_seen: result.pluginClassCount,
          left_out: result.leftOut,
          ui_definitions_found: result.uiScan.matches.length,
        }),
      );
      return EXIT_OK;
    }
    for (const [fam, e] of Object.entries(result.measure.game)) {
      io.out(`game ${fam}: ${e.files} files ${JSON.stringify(e.byExt)}`);
    }
    if (result.measure.tools) {
      for (const [fam, e] of Object.entries(result.measure.tools)) {
        io.out(`tools ${fam}: ${e.files} files ${JSON.stringify(e.byExt)}`);
      }
    } else io.out("tools pak not found: comparison skipped");
    if (totals) io.out(`compare (${result.compare?.scope}): ${JSON.stringify(totals)}`);
    for (const l of result.leftOut) io.out(`left out: ${l.count} x ${l.what} (${l.why})`);
    const matchFiles = [...new Set(result.uiScan.matches.map((m) => m.path))].sort(
      compareCodeUnits,
    );
    const cand = (pak: "game" | "tools"): number =>
      result.uiScan.nameCandidates.filter((c) => c.pak === pak).length;
    io.out(
      `UI definitions in scope: ${result.uiScan.uiExtFiles.length} files with a layout, ui, qss, ini, json, xml or styles extension; ` +
        `${result.uiScan.matches.length} menu/toolbar/dock/shortcut/layout/action word match(es) in ${matchFiles.length} of ${result.uiScan.scannedFiles} text files (${matchFiles.join(", ") || "none"}); ` +
        `file-name candidates outside scripts and content folders: tools ${cand("tools")}, game ${cand("game")}`,
    );
    io.out(
      `E17 at build ${build}: ${result.observations.length} observation${result.observations.length !== 1 ? "s" : ""} ` +
        `${JSON.stringify(byKind)}; ${result.uiScan.matches.length} UI-definition word match(es) in scope`,
    );
    return EXIT_OK;
  });
}

if (isMainModule(import.meta.url)) process.exitCode = run(process.argv.slice(2));
