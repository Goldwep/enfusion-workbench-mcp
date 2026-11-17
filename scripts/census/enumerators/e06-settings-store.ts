/**
 * E06 — settings store (plan 4.5). Reads ONE registry export that the main
 * session took of `HKCU\Software\Bohemia Interactive\Arma Reforger Workbench`
 * (a `.reg` text file, UTF-16LE with BOM, kept in the artifacts folder at
 * `<artifacts>/census/<build>/E06/workbench-registry.reg`). It never touches
 * the live registry, never starts anything and never reads a file outside the
 * export, the E02 source index and (for a comparison only) the E05 file.
 *
 * Personal data is dropped at the source. Every VALUE in the export is
 * dropped except the shortcut table's own flag (the string `true` stored for
 * each `<Category>><Action>` name, see below). Key names, value names and
 * value types are kept, apart from these exclusions, each counted by reason:
 *
 *   recent-file-list          `...\RecentFiles` (recent file paths)
 *   world-path-keyed          `World Editor\Worlds\...` (one key per world path, layer names below)
 *   file-id-keyed             a key segment that is a 16-digit hex id (one per opened file)
 *   layout-name-user-defined  a `Perspectives\<layout>` whose name is not `default` or `edit`
 *   plugin classes the E02 source index does not know as plugin or tool classes
 *                             (addon classes): their names and attributes are dropped, counted
 *   plugin shortcut names that match no vanilla plugin or tool attribute name
 *   any key or value name that holds a machine path, a resource path, an
 *   account or machine name, an e-mail address, a Steam id or a file name
 *
 * Methods (each one is stated with the rows it produces):
 *
 *   shortcut       `Workbench\PropertyGrid\unnamed` holds one value per Options >
 *                  Shortcuts row, named `<Category>><Action>` (split at the first
 *                  `>`). A name that held a `/` was split into sub-keys by the
 *                  settings backend: the sub-key path and the value name are
 *                  joined with `/` (`World Editor>Hide` + `Show (toggle)` is
 *                  `Hide/Show (toggle)`, confidence medium). The stored value is
 *                  the string `true` on every row, NOT a key sequence: this
 *                  export holds no default key sequence, so no row carries
 *                  `shortcut_default`. The module is the category's module
 *                  (`<X> Plugins` takes X's module); a category that names no
 *                  module (Camera, Common, Compass Gizmo, Resource Browser) is
 *                  Shared. A plugin-category action is kept only when its name
 *                  equals the `name` of a Workbench plugin or tool attribute in
 *                  the source index.
 *   dock, toolbar  every `<Module>\Perspectives\<layout>\State` value is a
 *                  `QMainWindow::saveState` stream stored by QSettings as a
 *                  REG_BINARY holding the UTF-16LE string `@ByteArray(` + one
 *                  UTF-16 unit per byte + `)`. The stream is read with
 *                  `parseMainWindowState` of `src/census/exe-tables.ts` (the
 *                  parser E05 uses for the executable's default layouts).
 *                  A dock or toolbar named in several layouts of a module is one
 *                  row. Parent: the module row of E05.
 *   setting-key    every other kept value: key {section, key} where section is
 *                  the registry key path below the root joined with `/` and key
 *                  the value name. `signature` is the stored type (REG_SZ,
 *                  REG_DWORD, REG_QWORD, REG_BINARY with its Qt wrapper,
 *                  REG_MULTI_SZ); a REG_SZ adds the shape of its text (bool, int,
 *                  number, text) without the text.
 *   option         the subset of setting-key rows that is a scalar CamelCase
 *                  value directly in a module section or in `Workbench`
 *                  (the sections that also hold `legacyOptionsLoaded`), minus
 *                  `current*`, `last*`, `legacy*` and ALL_CAPS session state.
 *                  The export does not say which keys an Options page shows:
 *                  this is a heuristic, confidence low, with that statement
 *                  under `unverified`.
 *   plugin-setting a REG_MULTI_SZ value whose text is an Enforce object block
 *                  (`Class {` / ` m_member value` / `}`), stored under
 *                  `<Module>\ScriptTools` or `<Module>\Tools`. key {class,
 *                  attr}: the class is the value name, the attr each member
 *                  name at depth one; values are dropped, the shape stays
 *                  (int, number, string, token, block). Only a class that the
 *                  source index shows with a WorkbenchPluginAttribute or a
 *                  WorkbenchToolAttribute is kept, and only an attribute that
 *                  a field of the class or an ancestor declares at this build
 *                  (an older build's stale setting is counted and dropped).
 *                  Module: the single named
 *                  module of its wbModules argument, else Shared. Parent: the
 *                  plugin or tool row of E03.
 *
 * Tables (scrubbed derived data) go to `<artifacts>/census/<build>/E06/`:
 * shortcuts.json, settings.json, layouts.json, plugin-settings.json and
 * summary.json. Each observation cites `artifact:<sha256 of its table>#<row
 * key>`. The repository gets only the observation file.
 *
 *   npx tsx scripts/census/enumerators/e06-settings-store.ts [--reg <file>] [--index <file>]
 *       [--e05 <file>] [--build <tag>] [--out <file under observations/E06/>]
 *       [--artifacts <dir> | --no-artifacts] [--data <dir>] [--json]
 *
 * Exit: 0 written; 1 refused (output outside observations/E06/, an artifacts
 * directory inside a git working tree, or the personal-data gate); 2 usage or
 * no data (NO DATA: no registry export, or no source index); 3 malformed
 * census configuration.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { compareCodeUnits, formatJson, jsonlLine, sha256 } from "../../../src/census/canon.js";
import { loadCurrentBuild } from "../../../src/census/census-config.js";
import { parseMainWindowState } from "../../../src/census/exe-tables.js";
import { allStrings, containsMachinePath } from "../../../src/census/hygiene.js";
import { deriveId, normalizeLabel } from "../../../src/census/ids.js";
import { writeFileAtomic, type CensusPaths } from "../../../src/census/ledger-io.js";
import { observationSchema, type Observation } from "../../../src/census/schemas.js";
import {
  classChain,
  parseSourceIndexText,
  sourceIndexPath,
  type MergedClass,
  type SourceIndex,
} from "../../../src/census/source-index.js";
import { MODULES, type Module } from "../../../src/census/vocab.js";
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
import { attributeModules } from "./e02-script-source.js";

/** Enumerator id. */
export const ENUMERATOR_ID = "E06";
/** Registered generator path (universes.json `enumerators.E06.generator`). */
export const GENERATOR = "scripts/census/enumerators/e06-settings-store.ts";
/** File name of the registry export inside the artifacts directory. */
export const REG_NAME = "workbench-registry.reg";
/** The registry root's own key name: the section of the values stored directly under it. */
export const ROOT_SECTION = "Arma Reforger Workbench";
/** Layout names Workbench creates itself; any other name is user-defined and dropped. */
export const STOCK_LAYOUTS: readonly string[] = ["default", "edit"];
const TABLES = ["shortcuts", "settings", "layouts", "plugin-settings"] as const;

// ── .reg parsing ──────────────────────────────────────────────────────────────

export interface RegValue {
  /** Value name; `""` for the key's default value. */
  name: string;
  /** `REG_SZ`, `REG_EXPAND_SZ`, `REG_DWORD`, `REG_QWORD`, `REG_BINARY`, `REG_MULTI_SZ`, `REG_NONE` or `REG_TYPE_<n>`. */
  type: string;
  /** REG_SZ and REG_EXPAND_SZ text; REG_DWORD hex digits. */
  text?: string;
  /** Raw bytes of every `hex` form (REG_SZ and REG_EXPAND_SZ are decoded into `text`). */
  bytes?: Buffer;
}

export interface RegKey {
  /** Key path below the Workbench root, one entry per level; `[]` for the root itself. */
  segments: string[];
  values: RegValue[];
}

export interface RegExport {
  keys: RegKey[];
  /** Keys whose path is not under the Workbench root. */
  outsideKeys: number;
  /** `[-key]` deletions and `"name"=-` deletions, which carry no data. */
  deletions: number;
}

const ROOT_PATTERN =
  /^HKEY_[A-Z_]+\\Software\\Bohemia Interactive\\Arma Reforger Workbench(?:\\(.*))?$/i;

/** The text of a `.reg` file: UTF-16LE (BOM or not) or, for REGEDIT4 files, 8-bit text. */
export function decodeRegText(buf: Buffer): string {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe)
    return buf.subarray(2).toString("utf16le");
  if (buf.length >= 2 && buf[0] !== 0 && buf[1] === 0) return buf.toString("utf16le");
  const text = buf.toString("utf-8");
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

const unquote = (s: string): string => s.replace(/\\(.)/g, "$1");

const TYPE_NAMES: Readonly<Record<string, string>> = {
  "0": "REG_NONE",
  "1": "REG_SZ",
  "2": "REG_EXPAND_SZ",
  "3": "REG_BINARY",
  "4": "REG_DWORD",
  "7": "REG_MULTI_SZ",
  b: "REG_QWORD",
};

function hexBytes(list: string): Buffer {
  return Buffer.from(
    list
      .split(",")
      .map((h) => h.trim())
      .filter((h) => h.length > 0)
      .map((h) => parseInt(h, 16)),
  );
}

function parseValueLine(l: string): { name: string; data: string } | null {
  if (l.startsWith("@=")) return { name: "", data: l.slice(2) };
  if (!l.startsWith('"')) return null;
  let i = 1;
  while (i < l.length && l[i] !== '"') i += l[i] === "\\" ? 2 : 1;
  if (i >= l.length || l[i + 1] !== "=") return null;
  return { name: unquote(l.slice(1, i)), data: l.slice(i + 2) };
}

function parseData(name: string, data: string): RegValue | "delete" | null {
  if (data === "-") return "delete";
  if (data.startsWith('"')) {
    const end = data.lastIndexOf('"');
    return { name, type: "REG_SZ", text: unquote(data.slice(1, end > 0 ? end : undefined)) };
  }
  const dw = /^dword:([0-9a-fA-F]{1,8})$/.exec(data);
  if (dw) return { name, type: "REG_DWORD", text: dw[1].toLowerCase() };
  const hx = /^hex(?:\(([0-9a-fA-F]+)\))?:(.*)$/s.exec(data);
  if (!hx) return null;
  const code = (hx[1] ?? "3").toLowerCase().replace(/^0+(?=.)/, "");
  const type = TYPE_NAMES[code] ?? `REG_TYPE_${code}`;
  const bytes = hexBytes(hx[2]);
  if (type === "REG_SZ" || type === "REG_EXPAND_SZ")
    return { name, type, text: bytes.toString("utf16le").replace(/\0+$/, "") };
  return { name, type, bytes };
}

/** Parses `.reg` text. Throws when the text is not a registry export. */
export function parseRegText(text: string): RegExport {
  const lines = text.split(/\r?\n/);
  const first = lines.find((l) => l.trim() !== "");
  if (first === undefined || !/^(Windows Registry Editor|REGEDIT4)/.test(first.trim()))
    throw new Error("not a registry export (no Windows Registry Editor header)");
  const byPath = new Map<string, RegKey>();
  const keys: RegKey[] = [];
  let cur: RegKey | null = null;
  let outsideKeys = 0;
  let deletions = 0;
  for (let i = 0; i < lines.length; i++) {
    let l = lines[i].trim();
    // Long hex data wraps with a trailing backslash after a comma.
    while (l.endsWith("\\") && !l.startsWith("[") && i + 1 < lines.length)
      l = l.slice(0, -1) + lines[++i].trim();
    if (l === "" || l.startsWith(";")) continue;
    if (l.startsWith("[")) {
      const body = l.endsWith("]") ? l.slice(1, -1) : l.slice(1);
      if (body.startsWith("-")) {
        deletions++;
        cur = null;
        continue;
      }
      const m = ROOT_PATTERN.exec(body);
      if (!m) {
        outsideKeys++;
        cur = null;
        continue;
      }
      const rel = m[1] ?? "";
      let key = byPath.get(rel);
      if (!key) {
        key = { segments: rel === "" ? [] : rel.split("\\"), values: [] };
        byPath.set(rel, key);
        keys.push(key);
      }
      cur = key;
      continue;
    }
    if (cur === null) continue;
    const v = parseValueLine(l);
    if (!v) continue;
    const parsed = parseData(v.name, v.data);
    if (parsed === "delete") deletions++;
    else if (parsed) cur.values.push(parsed);
  }
  return { keys, outsideKeys, deletions };
}

// ── Qt storage formats ────────────────────────────────────────────────────────

/**
 * The bytes of a QByteArray that QSettings stored in the registry: a REG_BINARY
 * holding the UTF-16LE text `@ByteArray(` + one UTF-16 unit per byte + `)`.
 * Null when the value is not in that form.
 */
export function decodeQtByteArray(bytes: Buffer): Buffer | null {
  if (bytes.length < 24 || bytes.length % 2 !== 0) return null;
  const s = bytes.toString("utf16le").replace(/\0+$/, "");
  if (!s.startsWith("@ByteArray(") || !s.endsWith(")")) return null;
  const inner = s.slice("@ByteArray(".length, -1);
  const out = Buffer.alloc(inner.length);
  for (let i = 0; i < inner.length; i++) {
    const c = inner.charCodeAt(i);
    if (c > 0xff) return null;
    out[i] = c;
  }
  return out;
}

/** `QByteArray`, `QVariant` or null for a REG_BINARY by its Qt wrapper. */
export function qtWrapper(bytes: Buffer): "QByteArray" | "QVariant" | null {
  const head = bytes.subarray(0, 24).toString("utf16le");
  if (head.startsWith("@ByteArray(")) return "QByteArray";
  if (head.startsWith("@Variant(")) return "QVariant";
  return null;
}

export interface SavedState {
  /** The `version` argument the module passed to `QMainWindow::saveState`. */
  version: number;
  entries: { name: string; kind: "dock" | "toolbar" }[];
}

/** A `QMainWindow::saveState` stream, or null when it does not open with the version marker. */
export function decodeSavedState(raw: Buffer): SavedState | null {
  if (raw.length < 8 || raw.readUInt32BE(0) !== 0xff) return null;
  const seen = new Set<string>();
  const entries: SavedState["entries"] = [];
  for (const e of parseMainWindowState(raw, 0, raw.length)) {
    const k = `${e.kind}\u0000${e.name}`;
    if (seen.has(k)) continue;
    seen.add(k);
    entries.push({ name: e.name, kind: e.kind });
  }
  return { version: raw.readUInt32BE(4), entries };
}

// ── Personal-data scan ────────────────────────────────────────────────────────

export interface PersonalContext {
  accountNames: readonly string[];
  hostNames: readonly string[];
}

/** Account and machine names of this process, from the environment (never printed). */
export function personalContextFromEnv(env: NodeJS.ProcessEnv = process.env): PersonalContext {
  const pick = (...keys: string[]): string[] => [
    ...new Set(
      keys.map((k) => env[k]).filter((v): v is string => typeof v === "string" && v.length >= 3),
    ),
  ];
  return {
    accountNames: pick("USERNAME", "USER", "LOGNAME"),
    hostNames: pick("COMPUTERNAME", "HOSTNAME"),
  };
}

/** Why a string is personal (the reason word only, never the match), or null. */
export function personalReason(text: string, ctx: PersonalContext): string | null {
  if (containsMachinePath(text)) return "machine-path";
  if (/(^|[\s"'=(])\$[A-Za-z0-9_.-]+:[^\s]/.test(text)) return "resource-path";
  if (
    /[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]*[A-Za-z0-9_-]\.[A-Za-z][A-Za-z0-9]{0,4}(?![A-Za-z0-9])/.test(
      text,
    )
  )
    return "file-path";
  const lower = text.toLowerCase();
  if (ctx.accountNames.some((n) => lower.includes(n.toLowerCase()))) return "account-name";
  if (ctx.hostNames.some((n) => lower.includes(n.toLowerCase()))) return "machine-name";
  if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/.test(text)) return "e-mail";
  if (/7656119\d{10}/.test(text)) return "steam-id";
  if (/^[^\s"'\\/]+\.[A-Za-z][A-Za-z0-9]{1,4}$/.test(text)) return "file-name";
  if (/[\\/][^\\/\s"']+\.[A-Za-z][A-Za-z0-9]{1,4}$/.test(text)) return "file-name";
  return null;
}

/** Hits of the output gate on a text: reason words only. */
export function gateScan(text: string, ctx: PersonalContext): string[] {
  const hits: string[] = [];
  const lower = text.toLowerCase();
  if (ctx.accountNames.some((n) => lower.includes(n.toLowerCase()))) hits.push("account name");
  if (ctx.hostNames.some((n) => lower.includes(n.toLowerCase()))) hits.push("machine name");
  if (/\bUsers[\\/]/.test(text)) hits.push("Users followed by a slash");
  if (/(^|[^A-Za-z0-9])[A-Za-z]:[\\/]/.test(text)) hits.push("drive-letter path");
  return hits;
}

/** The text of a value for the personal-data scan (binary values: NUL bytes removed). */
export function valueText(v: RegValue): string {
  if (v.type === "REG_SZ" || v.type === "REG_EXPAND_SZ") return v.text ?? "";
  if (v.type === "REG_DWORD" || v.type === "REG_QWORD") return "";
  const b = v.bytes ?? Buffer.alloc(0);
  if (v.type === "REG_MULTI_SZ") return b.toString("utf16le").split("\0").join("\n");
  const inner = decodeQtByteArray(b) ?? b;
  const plain = Buffer.from(inner.filter((x) => x !== 0));
  return plain.toString("latin1") + "\n" + b.toString("utf16le").replace(/\0/g, "");
}

// ── Vocabulary maps ───────────────────────────────────────────────────────────

/** Registry section (top-level key) to module. */
export const SECTION_MODULES: Readonly<Record<string, Module>> = {
  "Animation Editor": "AnimEditor",
  "Audio Editor": "AudioEditor",
  "Behavior Editor": "BehaviorEditor",
  "Dialogue Editor": "DialogueEditor",
  "Game Project Manager": "Launcher",
  "Navmesh Generator": "NavmeshGeneratorMain",
  "Particle Editor": "ParticleEditor",
  "Procedural Animation Editor": "ProcAnimEditor",
  "Resource Manager": "ResourceManager",
  "Script Editor": "ScriptEditor",
  "String Editor": "LocalizationEditor",
  Workbench: "Shared",
  "World Editor": "WorldEditor",
};

/**
 * Shortcut category to module. A category that names no module is Shared; an
 * `<X> Plugins` category takes X's module.
 */
export function categoryModule(category: string): Module {
  const base = category.replace(/ Plugins$/, "");
  const m = SECTION_MODULES[base];
  return m !== undefined && base !== "Workbench" && base !== "Game Project Manager" ? m : "Shared";
}

/** Module of a settings section: the top-level key's module; the root key itself has none. */
export function sectionModule(segments: readonly string[]): Module {
  if (segments.length === 0) return "none";
  return SECTION_MODULES[segments[0]] ?? "Shared";
}

const WB_MODULES = new Set<string>(MODULES.slice(0, 11));

// ── Source index: plugin and tool classes ─────────────────────────────────────

const PLUGIN_ATTRIBUTES = ["WorkbenchPluginAttribute", "WorkbenchToolAttribute"] as const;

export interface PluginClassInfo {
  kind: "plugin" | "tool";
  module: Module;
  /** The attribute's display name when the index resolves it. */
  displayName?: string;
}

function splitTopLevel(text: string): string[] {
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

function stringLiteral(text: string): string | undefined {
  const m = /^"((?:[^"\\]|\\.)*)"$/.exec(text.trim());
  return m
    ? m[1]
        .replace(/\\(["\\])/g, "$1")
        .replace(/\\n/g, "\n")
        .replace(/\\t/g, "\t")
    : undefined;
}

/** The display name of a plugin attribute: `name:` or the first positional argument, constants resolved. */
function attributeName(
  index: SourceIndex,
  cls: MergedClass,
  args: string | undefined,
): string | undefined {
  if (!args) return undefined;
  const parts = splitTopLevel(args);
  const named = parts.find((p) => /^name\s*:/.test(p));
  const raw = named ? named.replace(/^name\s*:\s*/, "") : parts.find((p) => !/^\w+\s*:/.test(p));
  if (raw === undefined) return undefined;
  const lit = stringLiteral(raw);
  if (lit !== undefined) return lit;
  if (!/^[A-Za-z_]\w*$/.test(raw)) return undefined;
  for (const c of classChain(index, cls.name)) {
    const f = c.fields.find((x) => x.name === raw && x.init !== undefined);
    if (f?.init !== undefined) return stringLiteral(f.init);
  }
  return undefined;
}

/**
 * Plugin and tool classes of the source index: every class that carries a
 * WorkbenchPluginAttribute or a WorkbenchToolAttribute on any declaration.
 * Module: the `wbModules` argument names exactly one module of the vocabulary,
 * else Shared (the rule E03, E15, E17 and E18 share).
 */
export function pluginClassesOf(index: SourceIndex): Map<string, PluginClassInfo> {
  const out = new Map<string, PluginClassInfo>();
  for (const [name, cls] of index.classes) {
    const attr = cls.attributes.find((a) =>
      (PLUGIN_ATTRIBUTES as readonly string[]).includes(a.name),
    );
    if (!attr) continue;
    const mods = attributeModules(attr.args);
    const only =
      mods &&
      mods.length === 1 &&
      (MODULES as readonly string[]).includes(mods[0]) &&
      mods[0] !== "none"
        ? (mods[0] as Module)
        : "Shared";
    const info: PluginClassInfo = {
      kind: attr.name === "WorkbenchPluginAttribute" ? "plugin" : "tool",
      module: only,
    };
    const dn = attributeName(index, cls, attr.args);
    if (dn !== undefined) info.displayName = dn;
    out.set(name, info);
  }
  return out;
}

/** Plugin names compare without case and with whitespace collapsed (a persisted name may predate a rename). */
const normName = (s: string): string => s.replace(/\s+/g, " ").trim().toLowerCase();

// ── Plugin blocks ─────────────────────────────────────────────────────────────

export interface PluginBlock {
  header: string;
  /** Members stored at depth one, in stored order, with the shape of their value. */
  attrs: { attr: string; shape: string }[];
}

/** Shape of a stored value: int, number, string, token or block; the value itself is never kept. */
export function valueShape(v: string): string {
  if (v === "{") return "block";
  if (v.startsWith('"')) return "string";
  if (/^-?\d+$/.test(v)) return "int";
  if (/^-?(\d+\.\d*|\.\d+)(e[+-]?\d+)?$/i.test(v)) return "number";
  return "token";
}

/** An Enforce object block from the lines of a REG_MULTI_SZ, or null when the text is not one. */
export function parsePluginBlock(lines: readonly string[]): PluginBlock | null {
  const body = lines.filter((l) => l.trim() !== "");
  if (body.length < 2) return null;
  const head = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*\{\s*$/.exec(body[0]);
  if (!head) return null;
  const attrs: PluginBlock["attrs"] = [];
  let depth = 1;
  for (const line of body.slice(1)) {
    const t = line.trim();
    if (t === "}") {
      depth--;
      if (depth === 0) return { header: head[1], attrs };
      continue;
    }
    const m = /^([A-Za-z_][A-Za-z0-9_]*)(?:\s+(.*))?$/.exec(t);
    if (!m) continue;
    const rest = (m[2] ?? "").trim();
    if (depth === 1) attrs.push({ attr: m[1], shape: rest === "" ? "token" : valueShape(rest) });
    if (rest === "{") depth++;
  }
  return null;
}

const multiSzLines = (v: RegValue): string[] =>
  (v.bytes ?? Buffer.alloc(0)).toString("utf16le").split("\0");

// ── Extraction ────────────────────────────────────────────────────────────────

export interface ShortcutRow {
  key: string;
  category: string;
  action: string;
  module: Module;
  plugin: boolean;
  /** The stored value when it is a plain flag word (`true`, `false`), else `other`. */
  stored: string;
  /** True when the name was rebuilt from a sub-key path (a `/` in the action). */
  reconstructed: boolean;
}

export interface SettingRow {
  key: string;
  section: string;
  name: string;
  module: Module;
  kind: "setting-key" | "option";
  type: string;
}

export interface LayoutRow {
  key: string;
  module: Module;
  section: string;
  layout: string;
  kind: "dock" | "toolbar";
  object_name: string;
  order: number;
  state_version: number;
}

export interface PluginSettingRow {
  key: string;
  class: string;
  attr: string;
  shape: string;
  plugin_kind: "plugin" | "tool";
  module: Module;
  sections: string[];
}

export type Counter = Record<string, number>;

export interface Extraction {
  registry: {
    keys: number;
    values: number;
    byType: Counter;
    outsideKeys: number;
    deletions: number;
  };
  shortcuts: ShortcutRow[];
  settings: SettingRow[];
  layouts: LayoutRow[];
  pluginSettings: PluginSettingRow[];
  /** Plugin classes seen in the export that carry no stored attribute (kept: empty variant). */
  pluginClassesKept: string[];
  stats: {
    shortcutActions: number;
    shortcutCategories: Counter;
    shortcutsDroppedUnknownPlugin: number;
    categoriesWithoutModule: string[];
    pluginClassesInExport: number;
    pluginClassesKept: number;
    pluginClassesDropped: number;
    pluginAttrsKept: number;
    pluginAttrsDropped: number;
    /** Stored attributes of kept classes that no field of the class or its ancestors declares (stale state of an older build). */
    pluginAttrsUndeclared: number;
    /** Kept attributes whose declaring field carries no [Attribute] annotation. */
    pluginAttrsNotAnnotated: number;
    pluginBlocksMismatch: number;
    statesDecoded: number;
    statesUndecodable: number;
    rowsExcluded: Counter;
    valuesKept: Counter;
    valuesDropped: Counter;
  };
}

const bump = (c: Counter, k: string, n = 1): void => {
  c[k] = (c[k] ?? 0) + n;
};

const lc = (s: string | undefined): string => (s ?? "").toLowerCase();

function isShortcutKey(segs: readonly string[]): boolean {
  return lc(segs[0]) === "workbench" && lc(segs[1]) === "propertygrid" && lc(segs[2]) === "unnamed";
}

/** Why a whole subtree is excluded from rows (and its values dropped), or null. */
export function subtreeReason(segs: readonly string[]): string | null {
  if (segs.some((s) => lc(s) === "recentfiles")) return "recent-file-list";
  if (lc(segs[0]) === "world editor" && lc(segs[1]) === "worlds") return "world-path-keyed";
  if (segs.some((s) => /^[0-9a-f]{16,}$/i.test(s))) return "file-id-keyed";
  if (lc(segs[1]) === "perspectives" && segs[2] !== undefined && !STOCK_LAYOUTS.includes(segs[2]))
    return "layout-name-user-defined";
  return null;
}

/** Stored type as the signature of a setting-key row. */
export function valueSignature(v: RegValue): string {
  switch (v.type) {
    case "REG_SZ": {
      const t = v.text ?? "";
      const shape = /^(true|false)$/i.test(t)
        ? "bool"
        : /^-?\d+$/.test(t)
          ? "int"
          : /^-?(\d+\.\d*|\.\d+)(e[+-]?\d+)?$/i.test(t)
            ? "number"
            : "text";
      return `REG_SZ (${shape})`;
    }
    case "REG_BINARY": {
      const w = qtWrapper(v.bytes ?? Buffer.alloc(0));
      return w ? `REG_BINARY (${w})` : "REG_BINARY";
    }
    case "REG_MULTI_SZ":
      return "REG_MULTI_SZ (QStringList)";
    default:
      return v.type;
  }
}

const OPTION_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

/** The option heuristic: a scalar CamelCase value directly in a module section or in Workbench. */
export function looksLikeOption(segs: readonly string[], v: RegValue): boolean {
  if (segs.length !== 1 || SECTION_MODULES[segs[0]] === undefined) return false;
  if (v.type !== "REG_SZ" && v.type !== "REG_DWORD") return false;
  if (!OPTION_NAME.test(v.name) || /^[A-Z0-9_]+$/.test(v.name)) return false;
  return !/^(current|last|legacy)/i.test(v.name);
}

/** Reads the export and builds every table. Pure: the source index and the personal context are inputs. */
export function extract(reg: RegExport, ctx: PersonalContext, index: SourceIndex): Extraction {
  const plugins = pluginClassesOf(index);
  const pluginNames = new Set<string>();
  for (const info of plugins.values())
    if (info.displayName !== undefined) pluginNames.add(normName(info.displayName));

  const shortcuts: ShortcutRow[] = [];
  const settings: SettingRow[] = [];
  const layouts: LayoutRow[] = [];
  const byType: Counter = {};
  const rowsExcluded: Counter = {};
  const valuesKept: Counter = {};
  const valuesDropped: Counter = {};
  const categories: Counter = {};
  const categoriesWithoutModule = new Set<string>();
  let valueTotal = 0;
  let shortcutActions = 0;
  let droppedPluginShortcuts = 0;
  let statesDecoded = 0;
  let statesUndecodable = 0;
  let blocksMismatch = 0;

  // Plugin classes: class -> sections and attrs.
  const seenPlugin = new Map<string, { sections: Set<string>; attrs: Map<string, string> }>();

  for (const key of reg.keys) {
    const segs = key.segments;
    const section = segs.length === 0 ? ROOT_SECTION : segs.join("/");
    const subtree = subtreeReason(segs);
    const scriptTools = lc(segs[segs.length - 1]) === "scripttools";
    for (const v of key.values) {
      valueTotal++;
      bump(byType, v.type);

      // The shortcut table.
      if (isShortcutKey(segs)) {
        const full = [...segs.slice(3), v.name].join("/");
        const gt = full.indexOf(">");
        const stored = /^(true|false)$/i.test(v.text ?? "")
          ? (v.text ?? "").toLowerCase()
          : "other";
        bump(valuesKept, `shortcut-table-flag-${stored}`);
        if (gt <= 0 || gt === full.length - 1) {
          bump(rowsExcluded, "shortcut-name-without-category");
          continue;
        }
        const category = full.slice(0, gt);
        const action = full.slice(gt + 1);
        shortcutActions++;
        bump(categories, category);
        const plugin = / Plugins$/.test(category);
        const module = categoryModule(category);
        if (
          module === "Shared" &&
          !/^(Camera|Common|Compass Gizmo|Resource Browser)$/.test(category)
        )
          categoriesWithoutModule.add(category);
        const bad = personalReason(category, ctx) ?? personalReason(action, ctx);
        if (bad !== null) {
          bump(rowsExcluded, `name-has-${bad}`);
          continue;
        }
        if (plugin && !pluginNames.has(normName(action))) {
          droppedPluginShortcuts++;
          continue;
        }
        shortcuts.push({
          key: `${category}>${action}`,
          category,
          action,
          module,
          plugin,
          stored,
          reconstructed: segs.length > 3,
        });
        continue;
      }

      // Plugin settings: ScriptTools values and any Enforce object block.
      const lines = v.type === "REG_MULTI_SZ" ? multiSzLines(v) : null;
      const block = lines ? parsePluginBlock(lines) : null;
      if (scriptTools || (block !== null && block.header === v.name)) {
        const personal = personalReason(valueText(v), ctx);
        bump(valuesDropped, personal !== null ? `value-has-${personal}` : "plugin-block-value");
        if (block !== null && block.header !== v.name) {
          blocksMismatch++;
          continue;
        }
        const bad = personalReason(v.name, ctx);
        if (bad !== null || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(v.name)) {
          bump(rowsExcluded, bad !== null ? `name-has-${bad}` : "plugin-name-not-an-identifier");
          continue;
        }
        let rec = seenPlugin.get(v.name);
        if (!rec) seenPlugin.set(v.name, (rec = { sections: new Set(), attrs: new Map() }));
        rec.sections.add(section);
        for (const a of block?.attrs ?? [])
          if (!rec.attrs.has(a.attr)) rec.attrs.set(a.attr, a.shape);
        continue;
      }

      // Everything else: a setting key, unless its subtree or a name is personal.
      if (subtree !== null) {
        bump(rowsExcluded, subtree);
        bump(valuesDropped, subtree);
        continue;
      }
      const badName = [...segs, v.name].map((s) => personalReason(s, ctx)).find((r) => r !== null);
      if (badName) {
        bump(rowsExcluded, `name-has-${badName}`);
        bump(valuesDropped, `name-has-${badName}`);
        continue;
      }
      if (v.name === "") {
        bump(rowsExcluded, "default-value");
        bump(valuesDropped, "not-vocabulary");
        continue;
      }
      const personalValue = personalReason(valueText(v), ctx);
      if (personalValue !== null) bump(valuesDropped, `value-has-${personalValue}`);
      else if (segs.some((s) => lc(s) === "addonpresets")) bump(valuesDropped, "addon-name-list");
      else bump(valuesDropped, "not-vocabulary");

      // Saved window states: decode the docks and toolbars.
      if (v.name === "State" && lc(segs[1]) === "perspectives" && segs.length === 3) {
        const module = SECTION_MODULES[segs[0]];
        const raw = v.type === "REG_BINARY" ? decodeQtByteArray(v.bytes ?? Buffer.alloc(0)) : null;
        const state = raw ? decodeSavedState(raw) : null;
        if (module === undefined || state === null) statesUndecodable++;
        else {
          statesDecoded++;
          state.entries.forEach((e, order) => {
            const bad = personalReason(e.name, ctx);
            if (bad !== null) {
              bump(rowsExcluded, `name-has-${bad}`);
              return;
            }
            layouts.push({
              key: `${section}/${e.kind}/${e.name}`,
              module,
              section,
              layout: segs[2],
              kind: e.kind,
              object_name: e.name,
              order,
              state_version: state.version,
            });
          });
        }
      }
      settings.push({
        key: `${section}/${v.name}`,
        section,
        name: v.name,
        module: sectionModule(segs),
        kind: looksLikeOption(segs, v) ? "option" : "setting-key",
        type: valueSignature(v),
      });
    }
  }

  // Layout rows: one per (module, kind, name); the first layout in code-unit order cites it.
  const layoutRows = new Map<string, LayoutRow>();
  for (const r of [...layouts].sort(
    (a, b) => compareCodeUnits(a.section, b.section) || a.order - b.order,
  )) {
    const k = `${r.module}\u0000${r.kind}\u0000${r.object_name}`;
    if (!layoutRows.has(k)) layoutRows.set(k, r);
  }

  // Plugin rows against the source index.
  const pluginSettings: PluginSettingRow[] = [];
  const pluginClassesKept: string[] = [];
  let attrsKept = 0;
  let attrsDropped = 0;
  let attrsUndeclared = 0;
  let attrsNotAnnotated = 0;
  let classesDropped = 0;
  for (const [cls, rec] of [...seenPlugin].sort((a, b) => compareCodeUnits(a[0], b[0]))) {
    const info = plugins.get(cls);
    if (!info) {
      classesDropped++;
      attrsDropped += rec.attrs.size;
      continue;
    }
    pluginClassesKept.push(cls);
    const chain = classChain(index, cls);
    for (const [attr, shape] of [...rec.attrs].sort((a, b) => compareCodeUnits(a[0], b[0]))) {
      // Emit a row only from a source that defines the thing: the member must be a field of the
      // class or an ancestor at this build. An older build's stale setting is counted and dropped.
      const fields = chain.flatMap((c) => c.fields.filter((f) => f.name === attr));
      if (fields.length === 0) {
        attrsUndeclared++;
        continue;
      }
      if (!fields.some((f) => f.attributes.some((a) => a.name === "Attribute")))
        attrsNotAnnotated++;
      pluginSettings.push({
        key: `${cls}/${attr}`,
        class: cls,
        attr,
        shape,
        plugin_kind: info.kind,
        module: info.module,
        sections: [...rec.sections].sort(compareCodeUnits),
      });
      attrsKept++;
    }
  }

  return {
    registry: {
      keys: reg.keys.length,
      values: valueTotal,
      byType,
      outsideKeys: reg.outsideKeys,
      deletions: reg.deletions,
    },
    shortcuts: shortcuts.sort((a, b) => compareCodeUnits(a.key, b.key)),
    settings: settings.sort((a, b) => compareCodeUnits(a.key, b.key)),
    layouts: [...layoutRows.values()].sort((a, b) => compareCodeUnits(a.key, b.key)),
    pluginSettings,
    pluginClassesKept,
    stats: {
      shortcutActions,
      shortcutCategories: categories,
      shortcutsDroppedUnknownPlugin: droppedPluginShortcuts,
      categoriesWithoutModule: [...categoriesWithoutModule].sort(compareCodeUnits),
      pluginClassesInExport: seenPlugin.size,
      pluginClassesKept: pluginClassesKept.length,
      pluginClassesDropped: classesDropped,
      pluginAttrsKept: attrsKept,
      pluginAttrsDropped: attrsDropped,
      pluginAttrsUndeclared: attrsUndeclared,
      pluginAttrsNotAnnotated: attrsNotAnnotated,
      pluginBlocksMismatch: blocksMismatch,
      statesDecoded,
      statesUndecodable,
      rowsExcluded,
      valuesKept,
      valuesDropped,
    },
  };
}

// ── Tables and rows ───────────────────────────────────────────────────────────

export type TableName = (typeof TABLES)[number];

/** Text of each scrubbed table (deterministic); the observation rows cite their hashes. */
export function tableTexts(x: Extraction, build: string): Record<TableName, string> {
  const table = (
    name: TableName,
    rows: readonly unknown[],
    extra: Record<string, unknown> = {},
  ): string => formatJson({ table: name, build, count: rows.length, rows, ...extra });
  return {
    shortcuts: table("shortcuts", x.shortcuts, { categories: x.stats.shortcutCategories }),
    settings: table("settings", x.settings),
    layouts: table("layouts", x.layouts),
    "plugin-settings": table("plugin-settings", x.pluginSettings, {
      classes_without_stored_attributes: x.pluginClassesKept.filter(
        (c) => !x.pluginSettings.some((r) => r.class === c),
      ),
    }),
  };
}

export const tableSha = (text: string): string => sha256(Buffer.from(text, "utf-8"));

const moduleParent = (module: Module): Observation["parent_key"] =>
  WB_MODULES.has(module) ? { dim: "ui", kind: "module", module, key: { path: [module] } } : null;

const LOWER_BOUND =
  "registry export of one machine: a lower bound that may hold user rebinds and names carried over from older Workbench builds (the export holds stale plugin classes and settings of earlier builds); only plugin-category names are checked against this build's source index, the other categories are not; the stored value is the string true on every row, not a key sequence, so no default key sequence is known";
const OPTION_HEURISTIC =
  "the export does not say which keys an Options page shows; classed as an option by form (a scalar CamelCase value directly in a module section or in Workbench)";

export interface Built {
  observations: { id: string; obs: Observation }[];
  kinds: Counter;
}

export function buildRows(x: Extraction, hashes: Record<TableName, string>): Built {
  const rows: Record<string, unknown>[] = [];
  const cite = (table: TableName, key: string): string => `artifact:${hashes[table]}#${key}`;

  for (const s of x.shortcuts) {
    rows.push({
      dim: "ui",
      kind: "shortcut",
      module: s.module,
      key: { path: [s.category, s.action] },
      label: normalizeLabel(s.action),
      parent_key: moduleParent(s.module),
      origin: "vanilla",
      ref: cite("shortcuts", s.key),
      quote: s.key,
      confidence: s.reconstructed ? "medium" : "high",
      unverified: [LOWER_BOUND],
    });
  }
  for (const l of x.layouts) {
    rows.push({
      dim: "ui",
      kind: l.kind,
      module: l.module,
      key: { object_name: l.object_name },
      object_name: l.object_name,
      parent_key: moduleParent(l.module),
      origin: "vanilla",
      ref: cite("layouts", l.key),
      quote: l.object_name,
      confidence: "high",
    });
  }
  for (const s of x.settings) {
    const row: Record<string, unknown> = {
      dim: "setting",
      kind: s.kind,
      module: s.module,
      key: { section: s.section, key: s.name },
      parent_key: null,
      signature: s.type,
      origin: "vanilla",
      ref: cite("settings", s.key),
      quote: s.name,
      confidence: s.kind === "option" ? "low" : "high",
    };
    if (s.kind === "option") row.unverified = [OPTION_HEURISTIC];
    rows.push(row);
  }
  for (const p of x.pluginSettings) {
    rows.push({
      dim: "plugin",
      kind: "plugin-setting",
      module: p.module,
      key: { class: p.class, attr: p.attr },
      class_name: p.class,
      parent_key: {
        dim: "plugin",
        kind: p.plugin_kind,
        module: p.module,
        key: { class: p.class },
      },
      signature: p.shape,
      origin: "vanilla",
      ref: cite("plugin-settings", p.key),
      quote: p.attr,
      confidence: "high",
    });
  }

  const observations: Built["observations"] = [];
  const seen = new Set<string>();
  const kinds: Counter = {};
  for (const r of rows) {
    if (allStrings(r).some(containsMachinePath)) {
      throw new Error(`E06 row carries a machine path: ${JSON.stringify(r.key)}`);
    }
    const parsed = observationSchema.parse(r);
    const id = deriveId(parsed);
    if (seen.has(id)) throw new Error(`E06 emitted ${id} twice`);
    seen.add(id);
    observations.push({ id, obs: parsed });
    bump(kinds, `${parsed.dim}/${parsed.kind}`);
  }
  observations.sort((a, b) => compareCodeUnits(a.id, b.id));
  return { observations, kinds };
}

/** Exact text of the E06 observation file. */
export function observationFileText(
  built: Built,
  build: string,
  inputs: { path: string; sha256: string }[],
): string {
  const header = {
    $header: 1,
    build,
    enumerator: ENUMERATOR_ID,
    generator: GENERATOR,
    inputs,
    provisional: false,
    row_count: built.observations.length,
  };
  return (
    [jsonlLine(header, ["$header"]), ...built.observations.map((o) => jsonlLine(o.obs))].join(
      "\n",
    ) + "\n"
  );
}

// ── Comparison with E05's default layouts ─────────────────────────────────────

export interface LayoutComparison {
  module: string;
  kind: "dock" | "toolbar";
  same: string[];
  extra: string[];
  missing: string[];
}

/** Saved-state docks and toolbars against the rows of E05's observation file (a count only, never a row input). */
export function compareLayouts(
  layouts: readonly LayoutRow[],
  e05: readonly { module: string; kind: string; object_name?: string }[],
): LayoutComparison[] {
  const mine = new Map<string, Set<string>>();
  const theirs = new Map<string, Set<string>>();
  const add = (m: Map<string, Set<string>>, k: string, n: string): void => {
    let s = m.get(k);
    if (!s) m.set(k, (s = new Set()));
    s.add(n);
  };
  for (const l of layouts) add(mine, `${l.module}\u0000${l.kind}`, l.object_name);
  for (const r of e05)
    if ((r.kind === "dock" || r.kind === "toolbar") && r.object_name !== undefined)
      add(theirs, `${r.module}\u0000${r.kind}`, r.object_name);
  const out: LayoutComparison[] = [];
  for (const k of [...new Set([...mine.keys(), ...theirs.keys()])].sort(compareCodeUnits)) {
    const [module, kind] = k.split("\u0000");
    const a = mine.get(k) ?? new Set<string>();
    const b = theirs.get(k) ?? new Set<string>();
    out.push({
      module,
      kind: kind as "dock" | "toolbar",
      same: [...a].filter((n) => b.has(n)).sort(compareCodeUnits),
      extra: [...a].filter((n) => !b.has(n)).sort(compareCodeUnits),
      missing: [...b].filter((n) => !a.has(n)).sort(compareCodeUnits),
    });
  }
  return out;
}

/** The dock and toolbar rows of an E05 observation file's text. */
export function e05LayoutRows(
  text: string,
): { module: string; kind: string; object_name?: string }[] {
  return text
    .split("\n")
    .slice(1)
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as { module: string; kind: string; object_name?: string });
}

// ── Summary ───────────────────────────────────────────────────────────────────

const perModule = (rows: readonly { module: string }[]): Counter => {
  const c: Counter = {};
  for (const r of rows) bump(c, r.module);
  return Object.fromEntries(Object.entries(c).sort((a, b) => compareCodeUnits(a[0], b[0])));
};

export function summarize(
  x: Extraction,
  built: Built,
  hashes: Record<TableName, string>,
  comparison: LayoutComparison[] | null,
): Record<string, unknown> {
  const topSection = (s: SettingRow): string => s.section.split("/")[0];
  const bySection: Record<string, Counter> = {};
  for (const s of x.settings) {
    const sec = bySection[topSection(s)] ?? (bySection[topSection(s)] = {});
    bump(sec, s.kind);
  }
  const docks = x.layouts.filter((l) => l.kind === "dock");
  const toolbars = x.layouts.filter((l) => l.kind === "toolbar");
  return {
    enumerator: ENUMERATOR_ID,
    registry: x.registry,
    shortcuts: {
      actions_in_export: x.stats.shortcutActions,
      emitted: x.shortcuts.length,
      categories: Object.keys(x.stats.shortcutCategories).length,
      per_category: x.stats.shortcutCategories,
      plugin_actions_dropped_not_vanilla: x.stats.shortcutsDroppedUnknownPlugin,
      categories_without_module: x.stats.categoriesWithoutModule,
      reconstructed_from_subkeys: x.shortcuts.filter((s) => s.reconstructed).length,
      stored_values: Object.fromEntries(
        Object.entries(x.stats.valuesKept).sort((a, b) => compareCodeUnits(a[0], b[0])),
      ),
    },
    layouts: {
      states_decoded: x.stats.statesDecoded,
      states_undecodable: x.stats.statesUndecodable,
      docks: docks.length,
      toolbars: toolbars.length,
      docks_per_module: perModule(docks),
      toolbars_per_module: perModule(toolbars),
      against_e05: comparison,
    },
    settings: {
      rows: x.settings.length,
      setting_key: x.settings.filter((s) => s.kind === "setting-key").length,
      option: x.settings.filter((s) => s.kind === "option").length,
      per_section: Object.fromEntries(
        Object.entries(bySection).sort((a, b) => compareCodeUnits(a[0], b[0])),
      ),
    },
    plugin_settings: {
      classes_in_export: x.stats.pluginClassesInExport,
      classes_kept: x.stats.pluginClassesKept,
      classes_dropped_not_in_source_index: x.stats.pluginClassesDropped,
      attrs_kept: x.stats.pluginAttrsKept,
      attrs_dropped: x.stats.pluginAttrsDropped,
      attrs_dropped_not_declared_by_class: x.stats.pluginAttrsUndeclared,
      attrs_kept_without_attribute_annotation: x.stats.pluginAttrsNotAnnotated,
      blocks_with_mismatched_header: x.stats.pluginBlocksMismatch,
    },
    rows_excluded: Object.fromEntries(
      Object.entries(x.stats.rowsExcluded).sort((a, b) => compareCodeUnits(a[0], b[0])),
    ),
    values_dropped_by_reason: Object.fromEntries(
      Object.entries(x.stats.valuesDropped).sort((a, b) => compareCodeUnits(a[0], b[0])),
    ),
    rows_by_kind: Object.fromEntries(
      Object.entries(built.kinds).sort((a, b) => compareCodeUnits(a[0], b[0])),
    ),
    tables: hashes,
  };
}

// ── CLI ───────────────────────────────────────────────────────────────────────

const USAGE =
  "usage: e06-settings-store.ts [--reg <file>] [--index <file>] [--e05 <file>] [--build <tag>] [--out <file under observations/E06/>] [--artifacts <dir> | --no-artifacts] [--data <dir>] [--json]";

/** Resolves `--out`, refusing anything outside `<census>/observations/E06/`. */
export function resolveOut(paths: CensusPaths, out: string | undefined, build: string): string {
  const dir = join(paths.observations, ENUMERATOR_ID);
  const file = out ? resolve(out) : join(dir, `${build}.jsonl`);
  if (dirname(file) !== dir || !file.endsWith(".jsonl")) {
    throw new Error(
      "refusing --out outside observations/E06/ (E06 writes only its own observation directory)",
    );
  }
  return file;
}

export function run(
  argv: string[],
  io: Io = PROCESS_IO,
  ctx: PersonalContext = personalContextFromEnv(),
): number {
  return guard(io, "e06-settings-store", () => {
    const { values } = parseArgs({
      args: argv,
      options: {
        reg: { type: "string" },
        index: { type: "string" },
        e05: { type: "string" },
        build: { type: "string" },
        out: { type: "string" },
        artifacts: { type: "string" },
        "no-artifacts": { type: "boolean" },
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
      io.err(`e06-settings-store: ${e instanceof Error ? e.message : String(e)}`);
      return EXIT_FAIL;
    }
    if (values.artifacts && !values["no-artifacts"] && insideGitWorkTree(values.artifacts)) {
      io.err(
        "e06-settings-store: refusing --artifacts inside a git working tree; scrubbed tables stay outside it (plan 4.2)",
      );
      return EXIT_FAIL;
    }
    const dir = values.artifacts
      ? resolve(values.artifacts)
      : join(artifactsDir(), "census", build, ENUMERATOR_ID);
    const regFile = values.reg ? resolve(values.reg) : join(dir, REG_NAME);
    if (!existsSync(regFile)) {
      io.out("NO DATA: no registry export of the Workbench key; nothing extracted");
      return EXIT_USAGE;
    }
    const indexFile = values.index ? resolve(values.index) : sourceIndexPath(build);
    if (!existsSync(indexFile)) {
      io.out(
        "NO DATA: no source index (E02) for this build; plugin names cannot be checked, so nothing is extracted",
      );
      return EXIT_USAGE;
    }
    const regBytes = readFileSync(regFile);
    const indexBytes = readFileSync(indexFile);
    const index = parseSourceIndexText(indexBytes.toString("utf-8"));
    const reg = parseRegText(decodeRegText(regBytes));
    const x = extract(reg, ctx, index);
    const texts = tableTexts(x, build);
    const hashes = Object.fromEntries(TABLES.map((t) => [t, tableSha(texts[t])])) as Record<
      TableName,
      string
    >;
    const built = buildRows(x, hashes);

    let comparison: LayoutComparison[] | null = null;
    const e05File = values.e05
      ? resolve(values.e05)
      : join(paths.observations, "E05", `${build}.jsonl`);
    if (existsSync(e05File))
      comparison = compareLayouts(x.layouts, e05LayoutRows(readFileSync(e05File, "utf-8")));
    const summary = summarize(x, built, hashes, comparison);
    const summaryText = formatJson(summary);

    const obsText = observationFileText(built, build, [
      {
        path: `<artifacts>/census/${build}/${ENUMERATOR_ID}/${basename(regFile)}`,
        sha256: sha256(regBytes),
      },
      { path: `<artifacts>/census/${build}/E02/source-index.jsonl`, sha256: sha256(indexBytes) },
    ]);
    // Gate: nothing personal in the observation file or in any table.
    const gated: [string, string][] = [
      ["observation file", obsText],
      ["summary", summaryText],
      ...TABLES.map((t): [string, string] => [`${t} table`, texts[t]]),
    ];
    for (const [name, text] of gated) {
      const hits = gateScan(text, ctx);
      if (hits.length > 0) {
        io.err(`e06-settings-store: gate failed on the ${name}: ${hits.join(", ")}`);
        return EXIT_FAIL;
      }
    }

    mkdirSync(dirname(out), { recursive: true });
    writeFileAtomic(out, obsText);
    let written: string[] = [];
    if (!values["no-artifacts"]) {
      mkdirSync(dir, { recursive: true });
      for (const t of TABLES) writeFileSync(join(dir, `${t}.json`), texts[t], "utf-8");
      writeFileSync(join(dir, "summary.json"), summaryText, "utf-8");
      written = [...TABLES.map((t) => `${t}.json`), "summary.json"];
    }

    if (values.json) {
      io.out(
        JSON.stringify({
          ok: true,
          command: "e06-settings-store",
          build,
          rows: built.observations.length,
          summary,
        }),
      );
      return EXIT_OK;
    }
    io.out(`registry export: ${x.registry.keys} keys, ${x.registry.values} values`);
    io.out(
      `shortcuts: ${x.stats.shortcutActions} actions in ${Object.keys(x.stats.shortcutCategories).length} categories, ${x.shortcuts.length} emitted (${x.stats.shortcutsDroppedUnknownPlugin} plugin actions dropped)`,
    );
    io.out(
      `layouts: ${x.stats.statesDecoded} states, ${x.layouts.filter((l) => l.kind === "dock").length} docks, ${x.layouts.filter((l) => l.kind === "toolbar").length} toolbars`,
    );
    for (const c of comparison ?? [])
      io.out(
        `saved ${c.kind}s vs E05 default layout, ${c.module}: ${c.same.length} same, ${c.extra.length} extra, ${c.missing.length} missing`,
      );
    io.out(
      `settings: ${x.settings.filter((s) => s.kind === "setting-key").length} setting-key, ${x.settings.filter((s) => s.kind === "option").length} option`,
    );
    io.out(
      `values dropped: ${Object.entries(x.stats.valuesDropped)
        .sort((a, b) => compareCodeUnits(a[0], b[0]))
        .map(([k, n]) => `${k} ${n}`)
        .join(", ")}`,
    );
    io.out(
      `plugin settings: ${x.stats.pluginAttrsKept} attributes of ${x.stats.pluginClassesKept} classes kept; ${x.stats.pluginClassesDropped} classes (${x.stats.pluginAttrsDropped} attributes) dropped; ${x.stats.pluginAttrsUndeclared} stored attributes not declared by their class at this build dropped; ${x.stats.pluginAttrsNotAnnotated} kept attributes are fields without [Attribute]`,
    );
    for (const [k, v] of Object.entries(built.kinds).sort((a, b) => compareCodeUnits(a[0], b[0])))
      io.out(`rows ${k}: ${v}`);
    if (written.length > 0)
      io.out(`tables: ${written.join(", ")} in <artifacts>/census/${build}/${ENUMERATOR_ID}`);
    io.out(`E06 at build ${build}: ${built.observations.length} observations`);
    return EXIT_OK;
  });
}

if (isMainModule(import.meta.url)) {
  process.exitCode = run(process.argv.slice(2));
}
