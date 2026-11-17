/**
 * E09 — file-type census (plan 4.5). Reads three sources and writes
 * `data/census/observations/E09/<build>.jsonl`:
 *
 *   1. the pak file listing (`PakVirtualFS.allFilePaths()`): one `file-type`
 *      row per extension, with a count and a text / binary / mixed verdict
 *      decided by sniffing the bytes of a seeded sample of at least 20 files
 *      per extension (all of them when fewer), never by the extension;
 *      Extensions whose sample says text are then sniffed over EVERY file; a
 *      file that is not text (binary, empty, unreadable) is an exception: it is
 *      listed in the artifacts table (`pak-extensions.json`) and named in the
 *      `unverified` of that extension's row. The verdict stays the sample's;
 *   2. the File Types table of the wiki (`data/wiki/export.xml`, page
 *      "Arma Reforger:File Types", raw wikitext): its description and its row
 *      as the quote, verbatim (a documented profile path is not a machine
 *      path). Its "Saved/Used by" column gives the row's module: the one editor
 *      it names (`moduleForUsedBy`); several, none or an unknown name is `none`;
 *   3. the Workbench profile directory and its `logs` sibling: NAMES AND
 *      EXTENSIONS ONLY, never counted (log and database files change with every
 *      Workbench session). File contents are never opened. Names that could
 *      carry an account name or Steam id are dropped at the source (see
 *      `sanitizeSegment`). The sanitised listing is saved in the artifacts
 *      folder; the listing reduced to distinct extensions and file-role names
 *      (`profileRoles`) is saved beside it, and the sha256 of THAT is what an
 *      `artifact:` ref names, so the rows do not change between sessions;
 *   4. the `.meta` files in the paks: one `resource-class` row per distinct
 *      class named under `Configurations`. Every `.meta` file is read (no
 *      sampling), so the class list is exhaustive by construction.
 *
 * ALSO (flag `--baseline`): the scoreboard for the lossless parser of Phase 3.
 * For every text extension, how many files `src/formats/enfusion-text.ts`
 * parses without throwing and how many round-trip byte-exact (parse then
 * serialize). Written to `<artifacts>/census/<build>/E09/corpus-baseline.json`.
 *
 * Raw material (the sanitised profile listing, the per-extension sniff table,
 * the meta-class table, the baseline) goes to the artifacts folder, never into
 * the repository. Nothing under the game or Tools install is executed; the
 * paks are read as bytes through the VFS.
 *
 *   npx tsx scripts/census/enumerators/e09-file-types.ts [--build <tag>] [--data <dir>]
 *       [--out <file under observations/E09/>] [--game <dir>] [--wiki <file>] [--profile <dir>]
 *       [--artifacts <dir>] [--baseline] [--sample <n per extension>] [--json]
 *
 * Exit: 0 written; 1 refused (output outside observations/E09/, artifacts folder inside a git
 * tree, a machine path or Steam id in the output); 2 usage or no data; 3 malformed census
 * configuration.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { compareCodeUnits, formatJson, jsonlLine, sha256 } from "../../../src/census/canon.js";
import { loadCurrentBuild } from "../../../src/census/census-config.js";
import { allStrings, containsMachinePath } from "../../../src/census/hygiene.js";
import { deriveId } from "../../../src/census/ids.js";
import { writeFileAtomic, type CensusPaths } from "../../../src/census/ledger-io.js";
import { observationSchema, type Observation } from "../../../src/census/schemas.js";
import type { Module } from "../../../src/census/vocab.js";
import { loadConfig } from "../../../src/config.js";
import {
  parse as parseEnfusionText,
  serialize as serializeEnfusionText,
} from "../../../src/formats/enfusion-text.js";
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
export const ENUMERATOR_ID = "E09";
/** Registered generator path (must equal universes.json `enumerators.E09.generator`). */
export const GENERATOR = "scripts/census/enumerators/e09-file-types.ts";

/** Files sniffed per extension (the brief asks for at least 20, or all when fewer). */
export const SNIFF_SAMPLE = 64;
/** Seed of the deterministic sample (changing it changes which files are sniffed). */
export const SNIFF_SEED = "E09-sniff-v1";
/** Bytes of a file the sniffer looks at. */
export const HEAD_BYTES = 8192;
/** Title of the wiki page that holds the File Types table. */
export const WIKI_PAGE_TITLE = "Arma Reforger:File Types";
/** The same page as a ref component (no whitespace allowed in a `wiki:` ref). */
export const WIKI_PAGE_REF = "Arma_Reforger:File_Types";
const QUOTE_MAX = 200;
const DESCRIPTION_MAX = 160;
const PROFILE_ROOT_PLACEHOLDER = "%USERPROFILE%/Documents/My Games/ArmaReforgerWorkbench";
/** Where `--baseline` text extensions are grouped to compare with plan 2.1 finding 5. */
export const PLAN_GROUPS: readonly { name: string; exts: readonly string[]; plan: string }[] = [
  {
    name: "animation / behaviour-tree / procedural-animation",
    exts: ["ae", "aex", "agf", "agr", "asi", "ast", "asy", "aw", "bt", "pap", "siga"],
    plan: "371 of 964 round-trip byte-exact",
  },
  {
    name: "audio / particle",
    exts: ["acp", "afm", "ptc", "sig"],
    plan: "4 of 1,406 round-trip byte-exact",
  },
];

// ── Extensions ────────────────────────────────────────────────────────────────

const BACKUP_EXT = /^bak-(?:\d{4}-\d{2}-\d{2}|<date>)$/;

/** The text after the last dot of the base name, lower-case; undefined when there is none. */
export function rawExtension(path: string): string | undefined {
  const base = path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
  const i = base.lastIndexOf(".");
  if (i < 0 || i === base.length - 1) return undefined;
  const ext = base.slice(i + 1).toLowerCase();
  // Workbench writes date-stamped backups (`x.conf.bak-2026-01-02`): one extension, `bak`.
  return BACKUP_EXT.test(ext) ? "bak" : ext;
}

export interface Grouped {
  groups: Map<string, string[]>;
  /** Paths whose base name has no extension. */
  noExtension: string[];
  /** Paths whose extension holds whitespace (an id cannot carry it). */
  oddExtension: string[];
}

/** Groups paths by lower-case extension (ids lower-case the extension, so case variants merge). */
export function groupByExt(paths: readonly string[]): Grouped {
  const groups = new Map<string, string[]>();
  const noExtension: string[] = [];
  const oddExtension: string[] = [];
  for (const p of paths) {
    const ext = rawExtension(p);
    if (ext === undefined) noExtension.push(p);
    else if (/\s/.test(ext)) oddExtension.push(p);
    else {
      const list = groups.get(ext);
      if (list) list.push(p);
      else groups.set(ext, [p]);
    }
  }
  return { groups, noExtension, oddExtension };
}

// ── Sniffing ──────────────────────────────────────────────────────────────────

export type Sniff = "text" | "binary" | "empty";
export type Verdict = "text" | "binary" | "mixed" | "unsampled";

/**
 * Decides text or binary from the first bytes: a UTF-16 byte-order mark is
 * text; otherwise a NUL, DEL or a control byte other than tab, newline,
 * carriage return, form feed and escape is binary, and so is a head where more
 * than 30 percent of the bytes are 0x80 or above (compressed or packed data
 * that happens to hold no NUL). A few high bytes are text: the corpus has
 * Latin-1 comments that are not valid UTF-8.
 */
export function sniffBytes(buf: Uint8Array): Sniff {
  if (buf.length === 0) return "empty";
  const head = buf.subarray(0, HEAD_BYTES);
  if (
    head.length >= 2 &&
    ((head[0] === 0xff && head[1] === 0xfe) || (head[0] === 0xfe && head[1] === 0xff))
  ) {
    return "text";
  }
  let high = 0;
  for (const b of head) {
    if (b === 0 || b === 0x7f) return "binary";
    if (b < 0x20 && b !== 9 && b !== 10 && b !== 13 && b !== 12 && b !== 27) return "binary";
    if (b >= 0x80) high++;
  }
  return high * 10 > head.length * 3 ? "binary" : "text";
}

/** The `n` paths with the smallest seeded hash (all of them, sorted, when there are no more than `n`). */
export function seededSample(
  paths: readonly string[],
  n: number,
  ext: string,
  seed: string = SNIFF_SEED,
): string[] {
  if (paths.length <= n) return [...paths].sort(compareCodeUnits);
  return paths
    .map((p) => ({ p, h: sha256(`${seed}|${ext}|${p}`) }))
    .sort((a, b) => compareCodeUnits(a.h, b.h) || compareCodeUnits(a.p, b.p))
    .slice(0, n)
    .map((x) => x.p);
}

export interface PakSource {
  allFilePaths(): string[];
  readFile(virtualPath: string): Buffer;
}

/** A file of a text extension that does not sniff as text over its whole corpus. */
export interface SniffException {
  path: string;
  /** `unreadable` is a file the VFS could not read (over its size cap, or a damaged entry). */
  sniff: "binary" | "empty" | "unreadable";
}

export interface ExtCensus {
  ext: string;
  files: number;
  sampled: number;
  text: number;
  binary: number;
  empty: number;
  /** Sampled files the VFS could not read (over its size cap, or a damaged entry). */
  unreadable: number;
  verdict: Verdict;
  /** Files sniffed over the whole extension (0 when the extension was not scanned in full). */
  scanned: number;
  /** Files of a text-verdict extension that are not text, by path; empty when none or not scanned. */
  exceptions: SniffException[];
  /** Smallest virtual path (code-unit order) that is safe to write into a ref and is not an exception. */
  representative: string;
}

export function verdictOf(text: number, binary: number): Verdict {
  if (text > 0 && binary > 0) return "mixed";
  if (text > 0) return "text";
  if (binary > 0) return "binary";
  return "unsampled";
}

/** Sniffs every file of one extension; returns the ones that are not text, in code-unit order. */
export function scanForExceptions(
  files: readonly string[],
  pak: Pick<PakSource, "readFile">,
): SniffException[] {
  const out: SniffException[] = [];
  for (const path of [...files].sort(compareCodeUnits)) {
    let buf: Buffer;
    try {
      buf = pak.readFile(path);
    } catch {
      out.push({ path, sniff: "unreadable" });
      continue;
    }
    const s = sniffBytes(buf);
    if (s !== "text") out.push({ path, sniff: s });
  }
  return out;
}

/**
 * Sniffs a seeded sample of one extension. With `scanAll`, an extension whose
 * sample says text is then sniffed over every file and the files that are not
 * text are recorded as exceptions (the verdict stays the sample's).
 */
export function classifyExtension(
  ext: string,
  files: readonly string[],
  pak: Pick<PakSource, "readFile">,
  sampleSize: number = SNIFF_SAMPLE,
  scanAll = false,
): ExtCensus {
  const sample = seededSample(files, sampleSize, ext);
  let text = 0;
  let binary = 0;
  let empty = 0;
  let unreadable = 0;
  for (const p of sample) {
    let buf: Buffer;
    try {
      buf = pak.readFile(p);
    } catch {
      unreadable++;
      continue;
    }
    const s = sniffBytes(buf);
    if (s === "text") text++;
    else if (s === "binary") binary++;
    else empty++;
  }
  const verdict = verdictOf(text, binary);
  const full = scanAll && verdict === "text";
  const exceptions = full ? scanForExceptions(files, pak) : [];
  const excluded = new Set(exceptions.map((e) => e.path));
  const sorted = [...files].sort(compareCodeUnits);
  const representative =
    sorted.find((p) => !containsMachinePath(p) && !excluded.has(p)) ??
    sorted.find((p) => !excluded.has(p)) ??
    sorted[0];
  return {
    ext,
    files: files.length,
    sampled: sample.length,
    text,
    binary,
    empty,
    unreadable,
    verdict,
    scanned: full ? files.length : 0,
    exceptions,
    representative,
  };
}

// ── Wiki File Types table ─────────────────────────────────────────────────────

export interface WikiRow {
  ext: string;
  fileType: string;
  usedBy: string;
  /** Module of the one editor the Saved/Used by cell names (`moduleForUsedBy`); `none` otherwise. */
  module: Module;
  /** Description cell as wikitext (entities decoded). */
  description: string;
  /** First line of the description, wiki markup removed, at most 160 characters. */
  descriptionLine: string;
  /** The row as one line (cells joined by " | "), at most 200 characters. */
  quote: string;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** The wikitext of the newest revision of a page in a MediaWiki export, entities decoded. */
export function extractWikiPage(xml: string, title: string): string | undefined {
  const at = xml.indexOf(`<title>${title}</title>`);
  if (at < 0) return undefined;
  const end = xml.indexOf("</page>", at);
  const block = xml.slice(at, end < 0 ? undefined : end);
  const matches = [...block.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)];
  const last = matches[matches.length - 1];
  return last ? decodeEntities(last[1]) : undefined;
}

/**
 * The editors the wiki's "Saved/Used by" column names, by the module each belongs to (vocab.ts).
 * Most specific first: a match is blanked before the next pattern runs, so "Procedural Animation
 * Editor" is not also an "Animation Editor" and "Resource Manager's Config Editor" is not also
 * "Resource Manager". A name that is not an editor of the vocabulary (Resource Browser, Workbench,
 * Art Tools, a debugger, a plugin) names no module.
 */
const RM = String.raw`(?:Resource Manager['’]s\s+)?`;
const sub = (name: string): RegExp => new RegExp(String.raw`\b${RM}${name}\b`, "ig");
const EDITOR_MODULES: readonly (readonly [RegExp, Module])[] = [
  [/\bProcedural Animation Editor\b/gi, "ProcAnimEditor"],
  [sub("Config Editor"), "ResourceManager.Config"],
  [sub("Layout Editor"), "ResourceManager.Layout"],
  [sub("Imageset Editor"), "ResourceManager.Imageset"],
  [sub("Model Editor"), "ResourceManager.Model"],
  [sub("Texture Editor"), "ResourceManager.Texture"],
  [sub("Material Editor"), "ResourceManager.Material"],
  [sub("Font (?:Editor|Viewer)"), "ResourceManager.Font"],
  [sub("Styles Editor"), "ResourceManager.Styles"],
  [/\bAnimation Editor\b/gi, "AnimEditor"],
  [/\bAudio Editor\b/gi, "AudioEditor"],
  [/\bParticle Editor\b/gi, "ParticleEditor"],
  [/\b(?:String|Localization|Localisation) Editor\b/gi, "LocalizationEditor"],
  [/\bBehaviou?r Editor\b/gi, "BehaviorEditor"],
  [/\bDialogue Editor\b/gi, "DialogueEditor"],
  [/\bWorld Editor\b/gi, "WorldEditor"],
  [/\bScript Editor\b/gi, "ScriptEditor"],
  [/\bNavmesh Generator\b/gi, "NavmeshGeneratorMain"],
  [/\bResource Manager\b/gi, "ResourceManager"],
];

/**
 * The module of the editor a "Saved/Used by" cell names (markup already removed): the one module
 * the cell's editors map to. Several editors, none, or only names outside the vocabulary: `none`.
 * E07 applies the same rule to the same cells.
 */
export function moduleForUsedBy(usedBy: string): Module {
  let rest = usedBy;
  const found = new Set<Module>();
  for (const [re, module] of EDITOR_MODULES) {
    const next = rest.replace(re, " ");
    if (next !== rest) {
      found.add(module);
      rest = next;
    }
  }
  return found.size === 1 ? [...found][0] : "none";
}

function renderTemplate(inner: string): string {
  const parts = inner.split("|");
  const name = parts[0].trim().toLowerCase();
  const args = parts.slice(1);
  switch (name) {
    case "link": {
      const label = (args[1] ?? args[0] ?? "").trim();
      return label.replace(/^#/, "").replace(/^Arma Reforger:/, "");
    }
    case "gamecategory": {
      const text = args.find((a) => /^\s*text\s*=/.test(a));
      return text ? text.replace(/^\s*text\s*=\s*/, "").trim() : "";
    }
    case "hl":
      return args.join("|").replace(/^\s*1\s*=\s*/, "");
    case "feature":
      return args.slice(1).join("|");
    case "gvi":
      return args[1] ? `(${args[1].trim()})` : "";
    default:
      return args.join(" ");
  }
}

/** Removes wiki markup from a cell: templates, links, comments, emphasis, line breaks. */
export function cleanWikiText(s: string): string {
  let out = s.replace(/<!--[\s\S]*?-->/g, "");
  for (let prev = ""; prev !== out; ) {
    prev = out;
    out = out.replace(/\{\{([^{}]*)\}\}/g, (_m, inner: string) => renderTemplate(inner));
  }
  return out
    .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2")
    .replace(/\[\[([^\]]*)\]\]/g, "$1")
    .replace(/\[(?:https?:\/\/)\S+\s+([^\]]*)\]/g, "$1")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/'{2,3}/g, "");
}

function firstLine(cleaned: string): string {
  const line =
    cleaned
      .split(/\r?\n/)
      .map((l) =>
        l
          .replace(/^\s*[*#:]+\s*/, "")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .find((l) => l !== "") ?? "";
  return line.length > DESCRIPTION_MAX
    ? `${line.slice(0, DESCRIPTION_MAX - 3).trimEnd()}...`
    : line;
}

/**
 * Parses the rows of the `wikitable` in the File Types page. A row is
 * `|` + a `==== .ext ====` heading cell, then the File Type, Saved/Used by and
 * Description cells, each cell starting on a line that begins with `|`.
 */
export function parseFileTypesTable(wikitext: string): WikiRow[] {
  const start = wikitext.indexOf("{|");
  const end = wikitext.lastIndexOf("\n|}");
  if (start < 0 || end < start) return [];
  const body = wikitext.slice(start + 2, end);
  const chunks = body.split(/\r?\n\|-[^\n]*\r?\n/).slice(1);
  const rows: WikiRow[] = [];
  for (const chunk of chunks) {
    const cells: string[] = [];
    for (const line of chunk.split(/\r?\n/)) {
      if (line.startsWith("|")) cells.push(line.slice(1).trim());
      else if (cells.length > 0) cells[cells.length - 1] += `\n${line}`;
    }
    const heading = /^=+\s*(\S+?)\s*=+$/m.exec(cells[0] ?? "");
    if (!heading) continue;
    const ext = heading[1].replace(/^\./, "").toLowerCase();
    if (ext === "" || /\s/.test(ext)) continue;
    const [, fileType = "", usedBy = "", description = ""] = cells;
    // Verbatim: a documented profile path (`%userprofile%\...`) is not a machine path, and
    // `assertNoPii` still refuses a real one at the end.
    const quote = [`==== ${heading[1]} ====`, fileType, usedBy, description]
      .join(" | ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, QUOTE_MAX);
    const usedByText = cleanWikiText(usedBy).replace(/\s+/g, " ").trim();
    rows.push({
      ext,
      fileType: cleanWikiText(fileType).replace(/\s+/g, " ").trim(),
      usedBy: usedByText,
      module: moduleForUsedBy(usedByText),
      description,
      descriptionLine: firstLine(cleanWikiText(description)),
      quote,
    });
  }
  return rows;
}

// ── .meta resource classes ────────────────────────────────────────────────────

export interface MetaClassHit {
  name: string;
  /** The line that names it, trimmed (for the quote). */
  line: string;
}

/**
 * The resource classes a `.meta` text names: the blocks opened directly under
 * `Configurations` (`XOBResourceClass PC {`, `PNGResourceClass XBOX_ONE : PC {`).
 * A brace scanner over the lines with quoted strings blanked; it does not use
 * the repository parser (which mis-structures some Enfusion text).
 */
export function extractMetaClasses(text: string): MetaClassHit[] {
  const hits: MetaClassHit[] = [];
  const stack: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/"[^"]*"/g, '""');
    const head = /^\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(line)?.[1] ?? "";
    for (const ch of line) {
      if (ch === "{") {
        if (stack.length === 2 && stack[1] === "Configurations" && head !== "") {
          hits.push({ name: head, line: raw.trim() });
        }
        stack.push(head);
      } else if (ch === "}") stack.pop();
    }
  }
  return hits;
}

export interface MetaClassInfo {
  name: string;
  files: number;
  /** Extensions of the resource a `.meta` belongs to (`x.xob.meta` -> `xob`). */
  exts: string[];
  firstPath: string;
  line: string;
}

export interface MetaCensus {
  /** `.meta` files in the listing. */
  total: number;
  /** `.meta` files opened (all of them: no sampling). */
  read: number;
  unreadable: number;
  /** `.meta` files that read fine but name no class. */
  withoutClass: number;
  classes: MetaClassInfo[];
}

/** Reads every `.meta` file in the listing and collects the classes. */
export function censusMeta(
  metaPaths: readonly string[],
  pak: Pick<PakSource, "readFile">,
): MetaCensus {
  const byName = new Map<string, MetaClassInfo & { extSet: Set<string> }>();
  let read = 0;
  let unreadable = 0;
  let withoutClass = 0;
  for (const p of [...metaPaths].sort(compareCodeUnits)) {
    let text: string;
    try {
      text = pak.readFile(p).toString("utf-8");
    } catch {
      unreadable++;
      continue;
    }
    read++;
    const underlying = rawExtension(p.replace(/\.meta$/i, "")) ?? "(none)";
    const names = new Set<string>();
    for (const hit of extractMetaClasses(text)) {
      names.add(hit.name);
      if (!byName.has(hit.name)) {
        byName.set(hit.name, {
          name: hit.name,
          files: 0,
          exts: [],
          extSet: new Set(),
          firstPath: p,
          line: hit.line,
        });
      }
    }
    if (names.size === 0) withoutClass++;
    for (const n of names) {
      const info = byName.get(n);
      if (!info) continue;
      info.files++;
      info.extSet.add(underlying);
    }
  }
  const classes = [...byName.values()]
    .map(({ extSet, ...c }) => ({ ...c, exts: [...extSet].sort(compareCodeUnits) }))
    .sort((a, b) => compareCodeUnits(a.name, b.name));
  return { total: metaPaths.length, read, unreadable, withoutClass, classes };
}

// ── Profile directory (names and extensions only) ─────────────────────────────

/**
 * The raw sanitised listing (artifacts folder only). Nothing in it is counted:
 * the logs folder and the databases change with every Workbench session, so a
 * count taken from them would change the rows without the build changing.
 */
export interface ProfileListing {
  root: string;
  /** Sanitised paths relative to the profile directory, sorted. */
  profile: string[];
  /** Distinct sanitised base names under the `logs` sibling, sorted. */
  logs: string[];
}

const STEAM_USER = /user\d{5,}/g;
const SAFE_SEGMENT: readonly RegExp[] = [
  /^\.save$/,
  /^settings$/,
  /^customInputConfigs$/,
  /^ResourceViewerPresets$/,
  /^app\d+_user<steamid>$/,
  /^\.projectList_app\d+_user<steamid>\.conf(\.bak-\d{4}-\d{2}-\d{2})?$/,
  /^(DbgUIState\.bin|resourceDatabase\.rdb|wbSettingsDump\.ini)$/,
  /^Reforger(Engine|Game)Settings\.conf$/,
  /^(console|error|script)\.log$/,
  /^CrashReports\.log$/,
];
/** The profile's project-list file (after sanitising). */
export const PROJECT_LIST_FILE = /^\.projectList_app\d+_user<steamid>\.conf$/;

/**
 * Drops what could name a person at the source: a Steam id becomes
 * `user<steamid>`; a name that is not one of the files Workbench itself writes
 * becomes `<name>.<ext>` (a file) or `<dir>` (a directory), so presets,
 * keybind sets and anything else the user named never reach a listing.
 */
export function sanitizeSegment(segment: string, isDirectory: boolean): string {
  const s = segment.replace(STEAM_USER, "user<steamid>");
  if (SAFE_SEGMENT.some((re) => re.test(s))) return s;
  if (isDirectory) return "<dir>";
  const ext = rawExtension(s);
  return ext === undefined ? "<name>" : `<name>.${ext}`;
}

function walkNames(dir: string, relParts: string[], out: string[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      walkNames(join(dir, e.name), [...relParts, sanitizeSegment(e.name, true)], out);
    } else if (e.isFile()) {
      out.push([...relParts, sanitizeSegment(e.name, false)].join("/"));
    }
  }
}

const baseName = (p: string): string => p.slice(p.lastIndexOf("/") + 1);

/** Lists the profile directory and its `logs` sibling by name; never opens a file. */
export function listProfile(profileDir: string): ProfileListing {
  const profile: string[] = [];
  walkNames(profileDir, [], profile);
  profile.sort(compareCodeUnits);
  const logFiles: string[] = [];
  walkNames(join(dirname(profileDir), "logs"), [], logFiles);
  const logs = [...new Set(logFiles.map(baseName))].sort(compareCodeUnits);
  return { root: PROFILE_ROOT_PLACEHOLDER, profile, logs };
}

/** Canonical text of the raw listing (saved to the artifacts folder; NOT what a ref hashes). */
export function listingText(listing: ProfileListing): string {
  return formatJson(listing);
}

/**
 * The listing reduced to what does not change between Workbench sessions on one
 * build: the distinct extensions and the distinct file-role names (sanitised
 * base names, a date-stamped backup written as `.bak-<date>`). No directory,
 * no count, no date. This is what an `artifact:` ref hashes.
 */
export interface ProfileRoles {
  root: string;
  extensions: string[];
  roles: string[];
}

/** A file's role name: its sanitised base name with a backup date replaced by `<date>`. */
export function roleName(base: string): string {
  return base.replace(/\.bak-\d{4}-\d{2}-\d{2}$/, ".bak-<date>");
}

export function profileRoles(listing: ProfileListing): ProfileRoles {
  const roles = [
    ...new Set([...listing.profile.map(baseName), ...listing.logs].map(roleName)),
  ].sort(compareCodeUnits);
  const extensions = [
    ...new Set(roles.map((r) => rawExtension(r)).filter((e): e is string => e !== undefined)),
  ].sort(compareCodeUnits);
  return { root: listing.root, extensions, roles };
}

/** Canonical text of the reduced listing (saved to the artifacts folder; its sha256 is the ref). */
export function rolesText(roles: ProfileRoles): string {
  return formatJson(roles);
}

export interface ProfileExt {
  ext: string;
  /** Smallest role name (code-unit order) with this extension. */
  anchor: string;
  /** Distinct role names with this extension, sorted. */
  roles: string[];
}

export function profileExtensions(roles: ProfileRoles): Map<string, ProfileExt> {
  const out = new Map<string, ProfileExt>();
  for (const role of roles.roles) {
    const ext = rawExtension(role);
    if (ext === undefined) continue;
    const cur = out.get(ext);
    if (cur) cur.roles.push(role);
    else out.set(ext, { ext, anchor: role, roles: [role] });
  }
  return out;
}

export function hasProjectList(roles: ProfileRoles): boolean {
  return roles.roles.some((r) => PROJECT_LIST_FILE.test(r));
}

// ── Census model and rows ─────────────────────────────────────────────────────

export interface Model {
  build: string;
  totalFiles: number;
  pakListingSha: string;
  noExtension: string[];
  oddExtension: string[];
  pak: Map<string, ExtCensus>;
  wiki: Map<string, WikiRow>;
  wikiRowCount: number;
  wikiDuplicates: string[];
  wikiPagePresent: boolean;
  profile?: {
    listing: ProfileListing;
    roles: ProfileRoles;
    /** sha256 of the reduced listing (`rolesText`): what an `artifact:` ref names. */
    sha: string;
    exts: Map<string, ProfileExt>;
    projectList: boolean;
  };
  meta: MetaCensus;
}

export interface ModelInput {
  build: string;
  pak: PakSource;
  /** The whole wiki export (raw XML), or undefined when absent. */
  wikiXml?: string;
  profile?: ProfileListing;
  sampleSize?: number;
  /** Sniff every file of a text-verdict extension (default true); false keeps the sample only. */
  fullSniff?: boolean;
}

export function buildModel(input: ModelInput): Model {
  const paths = input.pak.allFilePaths();
  const { groups, noExtension, oddExtension } = groupByExt(paths);
  const pak = new Map<string, ExtCensus>();
  for (const ext of [...groups.keys()].sort(compareCodeUnits)) {
    pak.set(
      ext,
      classifyExtension(
        ext,
        groups.get(ext) ?? [],
        input.pak,
        input.sampleSize,
        input.fullSniff !== false,
      ),
    );
  }
  const wikiText =
    input.wikiXml === undefined ? undefined : extractWikiPage(input.wikiXml, WIKI_PAGE_TITLE);
  const wiki = new Map<string, WikiRow>();
  const wikiDuplicates: string[] = [];
  let wikiRowCount = 0;
  for (const row of wikiText === undefined ? [] : parseFileTypesTable(wikiText)) {
    wikiRowCount++;
    if (wiki.has(row.ext)) wikiDuplicates.push(row.ext);
    else wiki.set(row.ext, row);
  }
  const meta = censusMeta(groups.get("meta") ?? [], input.pak);
  let profile: Model["profile"];
  if (input.profile) {
    const roles = profileRoles(input.profile);
    profile = {
      listing: input.profile,
      roles,
      sha: sha256(rolesText(roles)),
      exts: profileExtensions(roles),
      projectList: hasProjectList(roles),
    };
  }
  return {
    build: input.build,
    totalFiles: paths.length,
    pakListingSha: sha256([...paths].sort(compareCodeUnits).join("\n")),
    noExtension,
    oddExtension,
    pak,
    wiki,
    wikiRowCount,
    wikiDuplicates,
    wikiPagePresent: wikiText !== undefined,
    profile,
    meta,
  };
}

/** Every extension found in any source, in code-unit order. */
export function allExtensions(m: Model): string[] {
  return [
    ...new Set([...m.pak.keys(), ...m.wiki.keys(), ...(m.profile ? m.profile.exts.keys() : [])]),
  ].sort(compareCodeUnits);
}

/**
 * Module of a file-type row: the module of the one editor the wiki's Saved/Used by cell names for
 * the extension (`moduleForUsedBy`); `none` when the cell names several, none, or the wiki does not
 * list the extension. The extension's own type (the Resource Manager does not own it) is not a source.
 */
function moduleOf(m: Model, ext: string): Module {
  return m.wiki.get(ext)?.module ?? "none";
}

/** The rows' `unverified` for an extension whose whole-corpus sniff found files that are not text. */
function exceptionNote(c: ExtCensus): string[] | undefined {
  if (c.exceptions.length === 0) return undefined;
  const by = (k: SniffException["sniff"]): number =>
    c.exceptions.filter((e) => e.sniff === k).length;
  return [
    `whole-corpus sniff: ${c.exceptions.length} of ${c.files} files are not text (${by("binary")} binary, ${by("empty")} empty, ${by("unreadable")} unreadable); the ${c.verdict} verdict is the seeded sample's of ${c.sampled}; paths are in the E09 artifacts table pak-extensions.json`,
  ];
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function buildRows(m: Model): { id: string; obs: Observation }[] {
  const rows: { id: string; obs: Observation }[] = [];
  const push = (obs: Observation): void => {
    const parsed = observationSchema.parse(obs);
    rows.push({ id: deriveId(parsed), obs: parsed });
  };
  for (const ext of allExtensions(m)) {
    const pak = m.pak.get(ext);
    const wiki = m.wiki.get(ext);
    const prof = m.profile?.exts.get(ext);
    const n = pak?.files ?? 0;
    const parts = [
      `${plural(n, "file", "files")} in the ${m.build} paks`,
      pak?.verdict ?? "unsampled",
    ];
    if (wiki?.descriptionLine) parts.push(wiki.descriptionLine);
    // Profile files are named, never counted: their numbers change with every Workbench session.
    if (prof) parts.push(`in the Workbench profile listing as ${prof.roles.join(", ")}`);
    let ref: string;
    if (pak) ref = `pak:${pak.representative}`;
    else if (wiki) ref = `wiki:${WIKI_PAGE_REF}#.${ext}`;
    else ref = `artifact:${m.profile?.sha ?? ""}#${prof?.anchor ?? ""}`;
    const projectList = ext === "conf" && m.profile?.projectList === true;
    push({
      dim: "file",
      kind: "file-type",
      module: moduleOf(m, ext),
      key: { ext },
      parent_key: null,
      label: `.${ext}`,
      what: parts.join("; "),
      origin: "vanilla",
      ref,
      quote: wiki?.quote,
      confidence: pak || wiki ? "high" : "medium",
      children_count:
        ext === "meta" && m.meta.classes.length > 0 ? m.meta.classes.length : undefined,
      paths_proposed: projectList
        ? [{ path: "file-format", reason: "register a project with the launcher" }]
        : undefined,
      unverified: pak ? exceptionNote(pak) : undefined,
    });
  }
  const metaModule = moduleOf(m, "meta");
  for (const c of m.meta.classes) {
    push({
      dim: "file",
      kind: "resource-class",
      module: metaModule,
      key: { name: c.name },
      parent_key: { dim: "file", kind: "file-type", module: metaModule, key: { ext: "meta" } },
      label: c.name,
      what: `${plural(c.files, ".meta file", ".meta files")} in the ${m.build} paks name this class; resource extensions: ${c.exts.join(", ")}`,
      origin: "vanilla",
      ref: `pak:${c.firstPath}`,
      quote: c.line.slice(0, QUOTE_MAX),
      confidence: "high",
    });
  }
  rows.sort((a, b) => compareCodeUnits(a.id, b.id));
  return rows;
}

// ── Output ────────────────────────────────────────────────────────────────────

export interface InputRef {
  path: string;
  sha256: string;
}

export function modelInputs(m: Model, wikiSha: string | undefined): InputRef[] {
  const inputs: InputRef[] = [
    { path: "<game>/addons/**/*.pak (virtual file listing, sorted)", sha256: m.pakListingSha },
  ];
  if (wikiSha) inputs.push({ path: "<repo>/data/wiki/export.xml", sha256: wikiSha });
  if (m.profile) {
    inputs.push({
      path: `${PROFILE_ROOT_PLACEHOLDER} (distinct extensions and file roles, sanitised)`,
      sha256: m.profile.sha,
    });
  }
  return inputs;
}

/** Exact text of the E09 observation file. */
export function observationFileText(
  rows: readonly { obs: Observation }[],
  build: string,
  inputs: readonly InputRef[],
): string {
  const header = {
    $header: 1,
    build,
    enumerator: ENUMERATOR_ID,
    generator: GENERATOR,
    inputs,
    provisional: false,
    row_count: rows.length,
  };
  return [jsonlLine(header, ["$header"]), ...rows.map((r) => jsonlLine(r.obs))].join("\n") + "\n";
}

/** Throws when an output string holds a machine path, a Steam id or a user-id fragment. */
export function assertNoPii(values: readonly unknown[]): void {
  for (const s of allStrings(values)) {
    if (containsMachinePath(s)) throw new Error("output holds a machine path");
    if (/(?:^|\D)7656\d{13}(?:\D|$)/.test(s) || /user\d{5,}/.test(s)) {
      throw new Error("output holds a Steam id");
    }
  }
}

export interface Headline {
  files: number;
  noExtension: number;
  oddExtension: number;
  pakExtensions: number;
  allExtensions: number;
  text: number;
  binary: number;
  mixed: number;
  unsampled: number;
  wikiRows: number;
  wikiNotInPaks: string[];
  paksNotInWiki: string[];
  profileOnly: string[];
  metaFiles: number;
  metaClasses: number;
  /** Files of a text-verdict extension that the whole-corpus sniff found not to be text. */
  sniffExceptions: { ext: string; path: string; sniff: SniffException["sniff"] }[];
}

export function headline(m: Model): Headline {
  const verdicts = [...m.pak.values()].map((e) => e.verdict);
  const count = (v: Verdict): number => verdicts.filter((x) => x === v).length;
  const wikiExts = [...m.wiki.keys()].sort(compareCodeUnits);
  const pakExts = [...m.pak.keys()].sort(compareCodeUnits);
  return {
    files: m.totalFiles,
    noExtension: m.noExtension.length,
    oddExtension: m.oddExtension.length,
    pakExtensions: m.pak.size,
    allExtensions: allExtensions(m).length,
    text: count("text"),
    binary: count("binary"),
    mixed: count("mixed"),
    unsampled: count("unsampled"),
    wikiRows: m.wikiRowCount,
    wikiNotInPaks: wikiExts.filter((e) => !m.pak.has(e)),
    paksNotInWiki: pakExts.filter((e) => !m.wiki.has(e)),
    profileOnly: [...(m.profile?.exts.keys() ?? [])]
      .filter((e) => !m.pak.has(e) && !m.wiki.has(e))
      .sort(compareCodeUnits),
    metaFiles: m.meta.total,
    metaClasses: m.meta.classes.length,
    sniffExceptions: [...m.pak.values()].flatMap((c) =>
      c.exceptions.map((e) => ({ ext: c.ext, path: e.path, sniff: e.sniff })),
    ),
  };
}

// ── Corpus baseline (parser scoreboard) ───────────────────────────────────────

export interface TextParser {
  parse(text: string): unknown;
  serialize(node: unknown): string;
}

export const REPO_PARSER: TextParser = {
  parse: (t) => parseEnfusionText(t),
  serialize: (n) => serializeEnfusionText(n as Parameters<typeof serializeEnfusionText>[0]),
};

export interface BaselineExt {
  ext: string;
  files_total: number;
  files_measured: number;
  /** Files the VFS could not read. */
  unreadable: number;
  /** Measured files that are empty (not parsed). */
  empty: number;
  /** Measured files whose own bytes sniff as binary (not parsed). */
  not_text: number;
  /** Text files handed to the parser. */
  text_files: number;
  parsed: number;
  parse_failed: number;
  round_trip_exact: number;
  top_errors: { message: string; count: number }[];
}

export interface Baseline {
  build: string;
  scope: "whole-corpus" | "seeded-sample";
  sample_per_ext: number | null;
  seed: string;
  parser: string;
  extensions: BaselineExt[];
  groups: {
    name: string;
    exts: string[];
    plan: string;
    text_files: number;
    parsed: number;
    round_trip_exact: number;
  }[];
  totals: { text_files: number; parsed: number; parse_failed: number; round_trip_exact: number };
}

function errorKey(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.replace(/\d+/g, "#").replace(/\s+/g, " ").slice(0, 100);
}

/**
 * Parse then serialize every text file of every text (or mixed) extension and
 * count what the parser reads and what round-trips byte-exact. `samplePerExt`
 * of 0 means the whole corpus; otherwise a seeded sample of that many files
 * per extension (all when fewer).
 */
export function measureCorpus(
  build: string,
  pak: PakSource,
  census: ReadonlyMap<string, ExtCensus>,
  options: { samplePerExt?: number; parser?: TextParser } = {},
): Baseline {
  const parser = options.parser ?? REPO_PARSER;
  const samplePerExt = options.samplePerExt ?? 0;
  const { groups } = groupByExt(pak.allFilePaths());
  const extensions: BaselineExt[] = [];
  for (const ext of [...census.keys()].sort(compareCodeUnits)) {
    const c = census.get(ext);
    if (!c || (c.verdict !== "text" && c.verdict !== "mixed")) continue;
    const all = groups.get(ext) ?? [];
    const files =
      samplePerExt > 0
        ? seededSample(all, samplePerExt, ext, `${SNIFF_SEED}|baseline`)
        : [...all].sort(compareCodeUnits);
    const r: BaselineExt = {
      ext,
      files_total: all.length,
      files_measured: files.length,
      unreadable: 0,
      empty: 0,
      not_text: 0,
      text_files: 0,
      parsed: 0,
      parse_failed: 0,
      round_trip_exact: 0,
      top_errors: [],
    };
    const errors = new Map<string, number>();
    for (const p of files) {
      let buf: Buffer;
      try {
        buf = pak.readFile(p);
      } catch {
        r.unreadable++;
        continue;
      }
      const s = sniffBytes(buf);
      if (s === "empty") {
        r.empty++;
        continue;
      }
      if (s !== "text") {
        r.not_text++;
        continue;
      }
      r.text_files++;
      let node: unknown;
      try {
        node = parser.parse(buf.toString("utf-8"));
      } catch (e) {
        r.parse_failed++;
        const k = errorKey(e);
        errors.set(k, (errors.get(k) ?? 0) + 1);
        continue;
      }
      r.parsed++;
      try {
        if (Buffer.from(parser.serialize(node), "utf-8").equals(buf)) r.round_trip_exact++;
      } catch {
        // parsed but could not be serialised: not a round trip
      }
    }
    r.top_errors = [...errors.entries()]
      .map(([message, count]) => ({ message, count }))
      .sort((a, b) => b.count - a.count || compareCodeUnits(a.message, b.message))
      .slice(0, 3);
    extensions.push(r);
  }
  const sum = (exts: readonly BaselineExt[], f: (e: BaselineExt) => number): number =>
    exts.reduce((n, e) => n + f(e), 0);
  return {
    build,
    scope: samplePerExt > 0 ? "seeded-sample" : "whole-corpus",
    sample_per_ext: samplePerExt > 0 ? samplePerExt : null,
    seed: samplePerExt > 0 ? `${SNIFF_SEED}|baseline` : "none",
    parser: "src/formats/enfusion-text.ts parse then serialize; byte-exact against the file bytes",
    extensions,
    groups: PLAN_GROUPS.map((g) => {
      const es = extensions.filter((e) => g.exts.includes(e.ext));
      return {
        name: g.name,
        exts: [...g.exts],
        plan: g.plan,
        text_files: sum(es, (e) => e.text_files),
        parsed: sum(es, (e) => e.parsed),
        round_trip_exact: sum(es, (e) => e.round_trip_exact),
      };
    }),
    totals: {
      text_files: sum(extensions, (e) => e.text_files),
      parsed: sum(extensions, (e) => e.parsed),
      parse_failed: sum(extensions, (e) => e.parse_failed),
      round_trip_exact: sum(extensions, (e) => e.round_trip_exact),
    },
  };
}

// ── CLI ───────────────────────────────────────────────────────────────────────

const USAGE =
  "usage: e09-file-types.ts [--build <tag>] [--data <dir>] [--out <file under observations/E09/>] " +
  "[--game <dir>] [--wiki <file>] [--profile <dir>] [--artifacts <dir>] [--baseline] [--sample <n>] [--json]";

/** Resolves `--out`, refusing anything outside `<census>/observations/E09/`. */
export function resolveOut(paths: CensusPaths, out: string | undefined, build: string): string {
  const dir = join(paths.observations, ENUMERATOR_ID);
  const file = out ? resolve(out) : join(dir, `${build}.jsonl`);
  if (dirname(file) !== dir || !file.endsWith(".jsonl")) {
    throw new Error(
      "refusing --out outside observations/E09/ (E09 writes only its own observation directory)",
    );
  }
  return file;
}

/** Things `run` reaches outside the repository for; tests replace them. */
export interface Deps {
  openPaks(gamePath: string): PakSource | null;
  defaultGamePath(): string;
  defaultProfileDir(): string;
  artifactsRoot(): string;
}

export const REAL_DEPS: Deps = {
  openPaks: (gamePath) => {
    const vfs = PakVirtualFS.get(gamePath);
    return vfs
      ? { allFilePaths: () => vfs.allFilePaths(), readFile: (p) => vfs.readFile(p) }
      : null;
  },
  defaultGamePath: () => loadConfig().gamePath,
  defaultProfileDir: () =>
    join(homedir(), "Documents", "My Games", "ArmaReforgerWorkbench", "profile"),
  artifactsRoot: () => artifactsDir(),
};

export function run(argv: string[], io: Io = PROCESS_IO, deps: Deps = REAL_DEPS): number {
  return guard(io, "e09-file-types", () => {
    const { values } = parseArgs({
      args: argv,
      options: {
        build: { type: "string" },
        data: { type: "string" },
        out: { type: "string" },
        game: { type: "string" },
        wiki: { type: "string" },
        profile: { type: "string" },
        artifacts: { type: "string" },
        baseline: { type: "boolean" },
        sample: { type: "string" },
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
      io.err(`e09-file-types: ${e instanceof Error ? e.message : String(e)}`);
      return EXIT_FAIL;
    }
    const sample = values.sample === undefined ? 0 : Number(values.sample);
    if (!Number.isInteger(sample) || sample < 0 || (sample > 0 && sample < 20)) {
      io.err(
        "e09-file-types: --sample must be a whole number of at least 20 (0 or absent: whole corpus)",
      );
      return EXIT_USAGE;
    }

    const pak = deps.openPaks(values.game ? resolve(values.game) : deps.defaultGamePath());
    if (!pak || pak.allFilePaths().length === 0) {
      io.out(
        "NO DATA: no pak files under the game path (set ENFUSION_GAME_PATH or --game); nothing written",
      );
      return EXIT_USAGE;
    }
    const wikiFile = values.wiki
      ? resolve(values.wiki)
      : join(paths.repo, "data", "wiki", "export.xml");
    if (!existsSync(wikiFile)) {
      io.out("NO DATA: no wiki export (data/wiki/export.xml); nothing written");
      return EXIT_USAGE;
    }
    const wikiRaw = readFileSync(wikiFile);
    const profileDir = values.profile ? resolve(values.profile) : deps.defaultProfileDir();
    const listing = existsSync(profileDir) ? listProfile(profileDir) : undefined;

    const artifactsRoot = values.artifacts ? resolve(values.artifacts) : deps.artifactsRoot();
    if (insideGitWorkTree(artifactsRoot)) {
      io.err(
        "e09-file-types: refusing an artifacts folder inside a git working tree (raw material never enters one)",
      );
      return EXIT_FAIL;
    }
    const artifacts = join(artifactsRoot, "census", build, ENUMERATOR_ID);
    mkdirSync(artifacts, { recursive: true });

    const model = buildModel({ build, pak, wikiXml: wikiRaw.toString("utf-8"), profile: listing });
    const rows = buildRows(model);
    const inputs = modelInputs(model, sha256(wikiRaw));
    const text = observationFileText(rows, build, inputs);
    try {
      assertNoPii([...rows.map((r) => r.obs), inputs]);
    } catch (e) {
      io.err(`e09-file-types: ${e instanceof Error ? e.message : String(e)}; nothing written`);
      return EXIT_FAIL;
    }

    if (listing) {
      writeFileAtomic(join(artifacts, "profile-listing.json"), listingText(listing));
      if (model.profile) {
        writeFileAtomic(join(artifacts, "profile-roles.json"), rolesText(model.profile.roles));
      }
    }
    writeFileAtomic(
      join(artifacts, "pak-extensions.json"),
      formatJson({
        build,
        files: model.totalFiles,
        sample_size: SNIFF_SAMPLE,
        seed: SNIFF_SEED,
        sniff_exceptions: headline(model).sniffExceptions,
        extensions: [...model.pak.values()],
      }),
    );
    writeFileAtomic(join(artifacts, "meta-classes.json"), formatJson({ build, ...model.meta }));
    mkdirSync(dirname(out), { recursive: true });
    writeFileAtomic(out, text);

    let baseline: Baseline | undefined;
    let baselineSeconds = 0;
    if (values.baseline) {
      const t0 = process.hrtime.bigint();
      baseline = measureCorpus(build, pak, model.pak, { samplePerExt: sample });
      baselineSeconds = Number(process.hrtime.bigint() - t0) / 1e9;
      writeFileAtomic(join(artifacts, "corpus-baseline.json"), formatJson(baseline));
    }

    const h = headline(model);
    if (values.json) {
      io.out(
        JSON.stringify({
          ok: true,
          command: "e09-file-types",
          build,
          rows: rows.length,
          headline: h,
          baseline: baseline?.totals,
        }),
      );
      return EXIT_OK;
    }
    io.out(
      `E09 at build ${build}: ${rows.length} rows (${rows.length - model.meta.classes.length} file-type, ${model.meta.classes.length} resource-class)`,
    );
    io.out(
      `files in the paks: ${h.files}; extensions in the paks: ${h.pakExtensions}; in any source: ${h.allExtensions}`,
    );
    io.out(
      `verdicts over the pak extensions: text ${h.text}, binary ${h.binary}, mixed ${h.mixed}, unsampled ${h.unsampled}`,
    );
    io.out(
      `wiki File Types rows: ${h.wikiRows}; in the wiki but not the paks: ${h.wikiNotInPaks.length} (${h.wikiNotInPaks.join(" ")})`,
    );
    io.out(
      `in the paks but not the wiki: ${h.paksNotInWiki.length} (${h.paksNotInWiki.join(" ")})`,
    );
    io.out(`.meta files in the paks: ${h.metaFiles}; distinct resource classes: ${h.metaClasses}`);
    io.out(
      `whole-corpus sniff exceptions in text extensions: ${h.sniffExceptions.length}${h.sniffExceptions
        .map(
          (e) => `
  .${e.ext} ${e.sniff}: ${e.path}`,
        )
        .join("")}`,
    );
    if (baseline) {
      io.out(
        `baseline (${baseline.scope}, ${baselineSeconds.toFixed(0)} s): ${baseline.totals.parsed} of ${baseline.totals.text_files} text files parse, ${baseline.totals.round_trip_exact} round-trip byte-exact`,
      );
      for (const g of baseline.groups) {
        io.out(
          `  ${g.name}: ${g.round_trip_exact} of ${g.text_files} byte-exact, ${g.parsed} parse (plan 2.1: ${g.plan})`,
        );
      }
    }
    return EXIT_OK;
  });
}

if (isMainModule(import.meta.url)) process.exitCode = run(process.argv.slice(2));
