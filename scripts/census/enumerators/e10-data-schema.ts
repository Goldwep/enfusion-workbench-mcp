/**
 * E10 — data-schema census (plan 4.5).
 *
 * Reads every text document of the vanilla corpus in the game paks (through
 * `src/pak/vfs.ts`, never unpacked, nothing executed) with the tolerant
 * reader in `src/census/data-schema.ts`, and emits what the documents that
 * Workbench's editors author actually contain:
 *
 *  - one `schema-class` row per distinct block class name, across every text
 *    format (a class used by several formats is one row; `what` names the
 *    formats), parented to the `file-type` row (E09) of the format that holds
 *    it in the most files;
 *  - one `schema-key` row per key seen inside each block class, with the value
 *    shapes seen as `signature` and, when the key's bare-word values form a
 *    small closed set, that literal set in `what`. A key name with plain spaces
 *    is a row (its id escapes the spaces); one holding other whitespace, a dot
 *    or a hash is not (reported in the artifacts file), and its class then
 *    states no `children_count`.
 *
 * Entity prefab and world formats (.et, .ent, .layer) give class rows only:
 * their keys are the `[Attribute]` members that E15 emits. Enforce Script
 * (.c) is E02's; .json and .txt are not the Enfusion text serialisation.
 * No `resource-class` rows: the paks hold no `.meta` file (counted here), and
 * no enum or enum-value rows (those ids are E02's).
 *
 *   npx tsx scripts/census/enumerators/e10-data-schema.ts [--build <tag>] [--game <dir>]
 *       [--out <file under observations/E10/>] [--artifacts <dir>] [--data <dir>] [--json]
 *
 * Exit: 0 written; 1 the reader read less than 99% of the in-scope text
 * files (outputs are still written), or --out refused; 2 usage or no game
 * install (NO DATA); 3 malformed census configuration.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { compareCodeUnits, formatJson, jsonlLine } from "../../../src/census/canon.js";
import { loadCurrentBuild } from "../../../src/census/census-config.js";
import {
  LITERAL_CAP,
  SchemaCollector,
  SchemaReadError,
  literalSet,
  parseDocument,
  type ClassStat,
  type KeyStat,
  type Occurrence,
} from "../../../src/census/data-schema.js";
import { containsMachinePath } from "../../../src/census/hygiene.js";
import { deriveId } from "../../../src/census/ids.js";
import { writeFileAtomic, type CensusPaths } from "../../../src/census/ledger-io.js";
import { observationSchema, type Observation } from "../../../src/census/schemas.js";
import { classChain, loadSourceIndex, type SourceIndex } from "../../../src/census/source-index.js";
import type { Module } from "../../../src/census/vocab.js";
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

/** Enumerator id. */
export const ENUMERATOR_ID = "E10";
/** Registered generator path (must equal universes.json `enumerators.E10.generator`). */
export const GENERATOR = "scripts/census/enumerators/e10-data-schema.ts";
const QUOTE_MAX = 200;
/** Share of the in-scope text files the reader must read (the gate). */
export const READ_GATE = 0.99;

// ── Formats ───────────────────────────────────────────────────────────────────

/**
 * Owning editor's module per format, mapped from the "Saved/Used by" column of
 * the wiki File Types table as E09 quotes it (data/census/observations/E09):
 * the most specific editor link wins ("Resource Manager: Config Editor" ->
 * ResourceManager.Config). A format with no wiki row (.aex) says `none`.
 */
export const FORMAT_MODULE: Readonly<Record<string, Module>> = {
  acp: "AudioEditor",
  ae: "AnimEditor",
  aex: "none",
  afm: "AudioEditor",
  agf: "AnimEditor",
  agr: "AnimEditor",
  asi: "AnimEditor",
  ast: "AnimEditor",
  asy: "AnimEditor",
  aw: "AnimEditor",
  bt: "BehaviorEditor",
  conf: "ResourceManager.Config",
  ct: "WorldEditor",
  emat: "ResourceManager",
  ent: "WorldEditor",
  et: "WorldEditor",
  gamemat: "ResourceManager.Config",
  imageset: "ResourceManager.Imageset",
  layer: "WorldEditor",
  layout: "ResourceManager.Layout",
  pap: "ProcAnimEditor",
  physmat: "ResourceManager.Config",
  ptc: "ParticleEditor",
  ragdoll: "ResourceManager",
  sig: "AudioEditor",
  siga: "ProcAnimEditor",
  st: "LocalizationEditor",
  styles: "ResourceManager.Styles",
  vhcsurf: "ResourceManager.Config",
};

/**
 * Module of E09's `file-type` rows (parents of the class rows). E09 states the
 * owning editor's module per format from the same wiki column, so it equals
 * `FORMAT_MODULE` (checked against E09's observation file for all formats).
 */
export function fileTypeModule(ext: string): Module {
  return FORMAT_MODULE[ext] ?? "none";
}

/** Formats that give class rows only (their keys are E15's `[Attribute]` rows). */
export const CLASSES_ONLY: ReadonlySet<string> = new Set(["et", "ent", "layer"]);

/** Text extensions that are not Enfusion data documents, with the reason. */
export const EXCLUDED: Readonly<Record<string, string>> = {
  c: "Enforce Script source: its declarations are E02's source index, not data documents",
  json: "JSON, not the Enfusion text serialisation",
  txt: "plain text, not the Enfusion text serialisation",
};

/** Files sniffed per extension to decide whether it is a text format. */
export const SNIFF_PROBE = 16;
const HEAD_BYTES = 8192;

/** The extension after the last dot of the base name, lower-case. */
export function extensionOf(path: string): string | undefined {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const i = base.lastIndexOf(".");
  if (i <= 0 || i === base.length - 1) return undefined;
  return base.slice(i + 1).toLowerCase();
}

/**
 * Whether one file of a text format is given to the reader: empty files are
 * not, and a NUL byte in the head makes it binary. Other control bytes do not:
 * a vanilla prefab carries 0x1a and 0x7f inside a quoted value and is a valid
 * text document (E09's extension-level rule, `sniffText`, would call it binary).
 */
export function sniffTextFile(buf: Uint8Array): "text" | "binary" | "empty" {
  if (buf.length === 0) return "empty";
  const head = buf.subarray(0, HEAD_BYTES);
  if (
    head.length >= 2 &&
    ((head[0] === 0xff && head[1] === 0xfe) || (head[0] === 0xfe && head[1] === 0xff))
  )
    return "text";
  return head.includes(0) ? "binary" : "text";
}

/** E09's sniff rule: NUL, DEL or a control byte (other than tab, LF, CR, FF, ESC) is binary. */
export function sniffText(buf: Uint8Array): "text" | "binary" | "empty" {
  if (buf.length === 0) return "empty";
  const head = buf.subarray(0, HEAD_BYTES);
  if (
    head.length >= 2 &&
    ((head[0] === 0xff && head[1] === 0xfe) || (head[0] === 0xfe && head[1] === 0xff))
  )
    return "text";
  let high = 0;
  for (const b of head) {
    if (b === 0 || b === 0x7f) return "binary";
    if (b < 0x20 && b !== 9 && b !== 10 && b !== 13 && b !== 12 && b !== 27) return "binary";
    if (b >= 0x80) high++;
  }
  return high * 10 > head.length * 3 ? "binary" : "text";
}

// ── Corpus ────────────────────────────────────────────────────────────────────

/** What the generator needs from the pak file system (an in-memory one in tests). */
export interface PakSource {
  allFilePaths(): string[];
  readFile(path: string): Buffer;
}

export interface ExtReport {
  ext: string;
  files: number;
  /** Files that sniff as text and were given to the reader. */
  text_files: number;
  read: number;
  unreadable: number;
  /** Files of the extension that are empty, binary or could not be read from the pak. */
  not_text: number;
  classes: number;
}

export interface Unreadable {
  path: string;
  line: number;
  message: string;
}

export interface Corpus {
  build: string;
  extensions: ExtReport[];
  unreadable: Unreadable[];
  /** Files of the text extensions that are not text (path and sniff). */
  not_text: { path: string; why: string }[];
  excluded: { ext: string; files: number; why: string }[];
  /** Extensions whose probe found no text file. */
  binary_extensions: string[];
  meta_files: number;
  inputs_sha256: string;
  collector: SchemaCollector;
}

/** Reads every text document of the corpus, in (extension, path) code-unit order. */
export function readCorpus(pak: PakSource, build: string): Corpus {
  const groups = new Map<string, string[]>();
  for (const p of pak.allFilePaths()) {
    const e = extensionOf(p);
    if (e === undefined) continue;
    const l = groups.get(e);
    if (l) l.push(p);
    else groups.set(e, [p]);
  }
  const collector = new SchemaCollector({ classesOnly: CLASSES_ONLY });
  const hash = createHash("sha256");
  const extensions: ExtReport[] = [];
  const unreadable: Unreadable[] = [];
  const notText: Corpus["not_text"] = [];
  const excluded: Corpus["excluded"] = [];
  const binary: string[] = [];
  for (const ext of [...groups.keys()].sort(compareCodeUnits)) {
    const files = (groups.get(ext) ?? []).sort(compareCodeUnits);
    if (EXCLUDED[ext] !== undefined) {
      excluded.push({ ext, files: files.length, why: EXCLUDED[ext] });
      continue;
    }
    const read = (p: string): Buffer | undefined => {
      try {
        return pak.readFile(p);
      } catch {
        return undefined;
      }
    };
    // Probe: an extension is a text format when one of its first files sniffs as text.
    const probe = files.slice(0, SNIFF_PROBE);
    if (
      !probe.some((p) => {
        const b = read(p);
        return b !== undefined && sniffText(b) === "text";
      })
    ) {
      binary.push(ext);
      continue;
    }
    const r: ExtReport = {
      ext,
      files: files.length,
      text_files: 0,
      read: 0,
      unreadable: 0,
      not_text: 0,
      classes: 0,
    };
    for (const p of files) {
      const buf = read(p);
      if (buf === undefined) {
        r.not_text++;
        notText.push({ path: p, why: "pak entry could not be read" });
        continue;
      }
      hash.update(p, "utf8");
      hash.update("\0");
      hash.update(buf);
      const s = sniffTextFile(buf);
      if (s !== "text") {
        r.not_text++;
        notText.push({ path: p, why: s });
        continue;
      }
      r.text_files++;
      const text = buf.toString("utf-8");
      try {
        const roots = parseDocument(text);
        collector.add(ext, p, roots, text);
        r.read++;
      } catch (e) {
        r.unreadable++;
        unreadable.push({
          path: p,
          line: e instanceof SchemaReadError ? e.line : 0,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }
    extensions.push(r);
  }
  for (const c of collector.classes.values())
    for (const ext of c.filesByExt.keys()) {
      const r = extensions.find((x) => x.ext === ext);
      if (r) r.classes++;
    }
  return {
    build,
    extensions,
    unreadable,
    not_text: notText,
    excluded,
    binary_extensions: binary,
    meta_files: groups.get("meta")?.length ?? 0,
    inputs_sha256: hash.digest("hex"),
    collector,
  };
}

// ── Rows ──────────────────────────────────────────────────────────────────────

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const STEAM_ID_RE = /7656119\d{10}/;

/** True when a string may not be written into a census file. */
export function unsafeText(s: string): boolean {
  return containsMachinePath(s) || EMAIL_RE.test(s) || STEAM_ID_RE.test(s);
}

function refOf(o: Occurrence): string {
  return `pak:${o.path}#L${o.line}`;
}

function quoteOf(o: Occurrence): string | undefined {
  const q = o.text.slice(0, QUOTE_MAX).trim();
  return q && !unsafeText(q) ? q : undefined;
}

function sortedExts(m: Map<string, number>): string[] {
  return [...m.keys()].sort(compareCodeUnits);
}

/** Module of a class: the one stated module of its formats, `Shared` for several, `none` when no format says. */
export function classModule(exts: readonly string[]): Module {
  const stated = [...new Set(exts.map((e) => FORMAT_MODULE[e] ?? "none"))].filter(
    (m) => m !== "none",
  );
  if (stated.length === 0) return "none";
  if (stated.length === 1) return stated[0];
  return "Shared";
}

/** The format that holds the class in the most files (ties: code-unit order). */
export function dominantExt(c: ClassStat): string {
  let best = "";
  let n = -1;
  for (const e of sortedExts(c.filesByExt)) {
    const f = c.filesByExt.get(e) ?? 0;
    if (f > n) {
      best = e;
      n = f;
    }
  }
  return best;
}

function sum(m: Map<string, number>): number {
  let s = 0;
  for (const v of m.values()) s += v;
  return s;
}

/**
 * Keys whose name cannot be an id segment: whitespace other than a plain space
 * (tab, line break, no-break space and the like), a dot or a hash. A plain
 * space is fine: the `schema-key` id escapes it as %20 (`ids.ts`), so a quoted
 * key such as "Loop count" is a row. The name goes into `key` as written.
 */
export function keyNameBlocked(key: string): string | undefined {
  if (/[^\S ]/.test(key)) return "whitespace other than a plain space";
  if (/[.#]/.test(key)) return "a dot or hash";
  return undefined;
}

export interface LeftOutKey {
  class: string;
  key: string;
  why: string;
  ref: string;
}

export interface RowsResult {
  observations: { id: string; obs: Observation }[];
  leftOutKeys: LeftOutKey[];
  leftOutClasses: { class: string; why: string; ref: string }[];
  scrubbedQuotes: number;
}

/** Observation rows from a read corpus. */
export function buildRows(corpus: Corpus): RowsResult {
  const build = corpus.build;
  const out: { id: string; obs: Observation }[] = [];
  const leftOutKeys: LeftOutKey[] = [];
  const leftOutClasses: RowsResult["leftOutClasses"] = [];
  let scrubbed = 0;
  const classes = [...corpus.collector.classes.values()].sort((a, b) =>
    compareCodeUnits(a.cls, b.cls),
  );
  for (const c of classes) {
    const exts = sortedExts(c.filesByExt);
    const dom = dominantExt(c);
    const first = c.firstByExt.get(dom) as Occurrence;
    if (/[\s.#]/.test(c.cls)) {
      leftOutClasses.push({
        class: c.cls,
        why: "class name holds whitespace, a dot or a hash",
        ref: refOf(first),
      });
      continue;
    }
    const module = classModule(exts);
    const files = sum(c.filesByExt);
    const placement =
      c.root > 0 && c.nested > 0 ? "root and nested" : c.root > 0 ? "root" : "nested";
    let what =
      exts.length === 1
        ? `${c.instances} instances in ${files} .${dom} files of the ${build} paks; ${placement}`
        : `${c.instances} instances in ${files} files of the ${build} paks (${exts
            .map((e) => `.${e} ${c.filesByExt.get(e)}`)
            .join(", ")}); ${placement}`;
    const entityExts = exts.filter((e) => CLASSES_ONLY.has(e));
    const keyedExts = exts.filter((e) => !CLASSES_ONLY.has(e));
    if (c.cls === "$grp") what += "; legacy group node whose body lists unkeyed instances";
    else if (c.cls.startsWith("$"))
      what += "; legacy node whose body holds positional values, no keys";
    if (entityExts.length > 0)
      what += `; keys of its ${entityExts.map((e) => `.${e}`).join(", ")} instances are not emitted (entity formats: E15's [Attribute] rows)`;

    const keyRows: { id: string; obs: Observation }[] = [];
    const keys = [...c.keys.values()].sort((a, b) => compareCodeUnits(a.key, b.key));
    for (const k of keys) {
      const blocked = keyNameBlocked(k.key);
      if (blocked) {
        leftOutKeys.push({
          class: c.cls,
          key: k.key,
          why: `key name holds ${blocked}`,
          ref: refOf(k.first),
        });
        continue;
      }
      const row = keyRow(c, k, module, build);
      if (row.obs.quote === undefined && k.first.text) scrubbed++;
      keyRows.push(row);
    }
    const obs: Observation = {
      dim: "schema",
      kind: "schema-class",
      module,
      key: { class: c.cls },
      parent_key: {
        dim: "file",
        kind: "file-type",
        module: fileTypeModule(dom),
        key: { ext: dom },
      },
      label: c.cls,
      what,
      origin: "vanilla",
      ref: refOf(first),
      confidence: "high",
    };
    const q = quoteOf(first);
    if (q) obs.quote = q;
    else if (first.text) scrubbed++;
    // children_count is the number of keys the source shows; the ledger
    // requires it to equal the emitted key rows, so a class with keys left out
    // (names an id cannot hold) states no count and stays on the frontier.
    const leftOutHere = keys.length - keyRows.length;
    if (keyedExts.length > 0 && leftOutHere === 0) obs.children_count = keyRows.length;
    if (leftOutHere > 0)
      obs.what = `${what}; ${leftOutHere} of its ${keys.length} keys are not emitted (key names an id cannot hold)`;
    const parsed = observationSchema.parse(obs);
    out.push({ id: deriveId(parsed), obs: parsed });
    out.push(...keyRows);
  }
  out.sort((a, b) => compareCodeUnits(a.id, b.id));
  for (let i = 1; i < out.length; i++)
    if (out[i].id === out[i - 1].id) throw new Error(`duplicate row id ${out[i].id}`);
  return { observations: out, leftOutKeys, leftOutClasses, scrubbedQuotes: scrubbed };
}

function keyRow(
  c: ClassStat,
  k: KeyStat,
  module: Module,
  build: string,
): { id: string; obs: Observation } {
  const exts = [...k.exts].sort(compareCodeUnits);
  let what =
    exts.length === 1
      ? `${k.instances} instances in ${k.files} .${exts[0]} files of the ${build} paks`
      : `${k.instances} instances in ${k.files} files (${exts.map((e) => `.${e}`).join(", ")}) of the ${build} paks`;
  if (k.quoted) what += "; written as a quoted key";
  const lit = literalSet(k);
  if (lit) {
    const text = `; literal set (${lit.length}): ${lit.join(", ")}`;
    if (!unsafeText(text)) what += text;
  }
  const signature = [...k.shapes.keys()].sort(compareCodeUnits).join(" | ");
  const obs: Observation = {
    dim: "schema",
    kind: "schema-key",
    module,
    key: { class: c.cls, key: k.key },
    parent_key: { dim: "schema", kind: "schema-class", module, key: { class: c.cls } },
    label: k.key,
    signature,
    what,
    origin: "vanilla",
    ref: refOf(k.first),
    confidence: "high",
  };
  const q = quoteOf(k.first);
  if (q) obs.quote = q;
  const parsed = observationSchema.parse(obs);
  return { id: deriveId(parsed), obs: parsed };
}

/** Exact text of the E10 observation file. */
export function observationFileText(rows: RowsResult, corpus: Corpus): string {
  const header = {
    $header: 1,
    build: corpus.build,
    enumerator: ENUMERATOR_ID,
    generator: GENERATOR,
    inputs: [
      {
        path: `<game>/addons/**/*.pak (files of the ${corpus.extensions.length} text extensions read, path and bytes, sorted)`,
        sha256: corpus.inputs_sha256,
      },
    ],
    provisional: false,
    row_count: rows.observations.length,
  };
  for (const o of rows.observations)
    for (const v of [o.obs.what, o.obs.quote, o.obs.signature, o.obs.ref])
      if (v !== undefined && unsafeText(v))
        throw new Error(`refusing to write ${o.id}: unsafe text`);
  return (
    [jsonlLine(header, ["$header"]), ...rows.observations.map((o) => jsonlLine(o.obs))].join("\n") +
    "\n"
  );
}

// ── Headline counts ───────────────────────────────────────────────────────────

/** Recon count of behaviour-tree node classes (plan 2.1). */
export const RECON_BT_NODES = 387;

export interface Headline {
  files: {
    in_scope_text: number;
    read: number;
    unreadable: number;
    read_share: number;
    per_extension: Record<
      string,
      {
        files: number;
        text: number;
        read: number;
        unreadable: number;
        not_text: number;
        classes: number;
      }
    >;
    excluded: Record<string, number>;
    in_scope_plus_excluded_files: number;
  };
  classes: {
    total: number;
    per_extension: Record<string, number>;
    shared_by_formats: number;
    classes_only_formats: number;
  };
  keys: { total_seen: number; rows: number; left_out: number; with_literal_set: number };
  behaviour_tree: {
    node_classes: number;
    recon: number;
    all_bt_classes: number;
    decorator_test_classes: number;
    variable_classes: number;
    /**
     * Script classes deriving from the behaviour-tree base class `Node` in the
     * E02 source index, and how many of them no vanilla .bt uses; null when
     * the index is absent.
     */
    script_node_subclasses: number | null;
    script_node_subclasses_unused: number | null;
  };
  animation_graph: {
    agf_node_classes: number;
    agf_classes: number;
    agr_classes: number;
    legacy_dollar_classes: number;
  };
  audio: {
    acp_afm_classes: number;
    dsp_classes: number;
    signal_classes: number;
    sig_classes: number;
    siga_classes: number;
  };
  particles: { emitter_keys: number; effect_keys: number };
  meta_files: number;
}

function classesIn(corpus: Corpus, pred: (c: ClassStat) => boolean): ClassStat[] {
  return [...corpus.collector.classes.values()].filter(pred);
}

export function headline(corpus: Corpus, rows: RowsResult, index?: SourceIndex): Headline {
  const per: Headline["files"]["per_extension"] = {};
  let text = 0;
  let read = 0;
  let bad = 0;
  for (const e of corpus.extensions) {
    per[e.ext] = {
      files: e.files,
      text: e.text_files,
      read: e.read,
      unreadable: e.unreadable,
      not_text: e.not_text,
      classes: e.classes,
    };
    text += e.text_files;
    read += e.read;
    bad += e.unreadable;
  }
  const excluded: Record<string, number> = {};
  for (const x of corpus.excluded) excluded[x.ext] = x.files;
  const all = [...corpus.collector.classes.values()];
  const has = (c: ClassStat, ext: string): boolean => c.filesByExt.has(ext);
  const ctx = (c: ClassStat, s: string): boolean => c.contexts.has(s);
  let keysSeen = 0;
  let literal = 0;
  for (const c of all)
    for (const k of c.keys.values()) {
      keysSeen++;
      if (literalSet(k) && !keyNameBlocked(k.key)) literal++;
    }
  const emitter = corpus.collector.classes.get("EmitterDef");
  const effect = corpus.collector.classes.get("EffectDef");
  const sig = classesIn(corpus, (c) => has(c, "sig"));
  const siga = classesIn(corpus, (c) => has(c, "siga"));
  return {
    files: {
      in_scope_text: text,
      read,
      unreadable: bad,
      read_share: text === 0 ? 0 : Math.round((read / text) * 1e6) / 1e6,
      per_extension: per,
      excluded,
      in_scope_plus_excluded_files: text + Object.values(excluded).reduce((a, b) => a + b, 0),
    },
    classes: {
      total: all.length,
      per_extension: Object.fromEntries(corpus.extensions.map((e) => [e.ext, e.classes])),
      shared_by_formats: all.filter((c) => c.filesByExt.size > 1).length,
      classes_only_formats: all.filter((c) =>
        [...c.filesByExt.keys()].every((e) => CLASSES_ONLY.has(e)),
      ).length,
    },
    keys: {
      total_seen: keysSeen,
      rows: rows.observations.filter((o) => o.obs.kind === "schema-key").length,
      left_out: rows.leftOutKeys.length,
      with_literal_set: literal,
    },
    behaviour_tree: {
      node_classes: classesIn(corpus, (c) => ctx(c, "bt:Nodes")).length,
      recon: RECON_BT_NODES,
      all_bt_classes: classesIn(corpus, (c) => has(c, "bt")).length,
      decorator_test_classes: classesIn(corpus, (c) => ctx(c, "bt:TEST")).length,
      variable_classes: classesIn(corpus, (c) => ctx(c, "bt:Variables")).length,
      ...scriptNodeCheck(corpus, index),
    },
    animation_graph: {
      agf_node_classes: classesIn(corpus, (c) => ctx(c, "agf:Nodes")).length,
      agf_classes: classesIn(corpus, (c) => has(c, "agf")).length,
      agr_classes: classesIn(corpus, (c) => has(c, "agr")).length,
      legacy_dollar_classes: classesIn(corpus, (c) => c.cls.startsWith("$")).length,
    },
    audio: {
      acp_afm_classes: classesIn(corpus, (c) => has(c, "acp") || has(c, "afm")).length,
      dsp_classes: classesIn(corpus, (c) => /DSPTypeClass$/.test(c.cls)).length,
      signal_classes: classesIn(corpus, (c) => has(c, "sig") || has(c, "siga")).length,
      sig_classes: sig.length,
      siga_classes: siga.length,
    },
    particles: { emitter_keys: emitter?.keys.size ?? 0, effect_keys: effect?.keys.size ?? 0 },
    meta_files: corpus.meta_files,
  };
}

/**
 * Cross-check against the E02 source index: script classes whose parent chain
 * reaches the behaviour-tree base class `Node`, and those no vanilla .bt
 * holds in a `Nodes` array.
 */
export function scriptNodeCheck(
  corpus: Corpus,
  index: SourceIndex | undefined,
): { script_node_subclasses: number | null; script_node_subclasses_unused: number | null } {
  if (!index) return { script_node_subclasses: null, script_node_subclasses_unused: null };
  let all = 0;
  let unused = 0;
  for (const c of index.classes.values()) {
    if (c.name === "Node") continue;
    if (
      !classChain(index, c.name)
        .slice(1)
        .some((x) => x.name === "Node")
    )
      continue;
    all++;
    if (!corpus.collector.classes.get(c.name)?.contexts.has("bt:Nodes")) unused++;
  }
  return { script_node_subclasses: all, script_node_subclasses_unused: unused };
}

/** Raw tables for the artifacts folder (never committed). */
export function artifactText(corpus: Corpus, rows: RowsResult, h: Headline): string {
  return formatJson({
    build: corpus.build,
    headline: h,
    extensions: corpus.extensions,
    unreadable: corpus.unreadable,
    not_text: corpus.not_text,
    excluded: corpus.excluded,
    binary_extensions: corpus.binary_extensions,
    left_out_keys: rows.leftOutKeys,
    left_out_classes: rows.leftOutClasses,
    literal_cap: LITERAL_CAP,
  });
}

// ── CLI ───────────────────────────────────────────────────────────────────────

const USAGE =
  "usage: e10-data-schema.ts [--build <tag>] [--game <dir>] [--out <file under observations/E10/>] [--artifacts <dir>] [--data <dir>] [--json]";

/** Resolves `--out`, refusing anything outside `<census>/observations/E10/`. */
export function resolveOut(paths: CensusPaths, out: string | undefined, build: string): string {
  const dir = join(paths.observations, ENUMERATOR_ID);
  const file = out ? resolve(out) : join(dir, `${build}.jsonl`);
  if (dirname(file) !== dir || !file.endsWith(".jsonl"))
    throw new Error(
      "refusing --out outside observations/E10/ (E10 writes only its own observation directory)",
    );
  return file;
}

export interface Deps {
  /** Opens the game paks; null when there are none. */
  openPak: (gamePath: string) => PakSource | null;
  /** The configured game path. */
  gamePath: () => string | undefined;
  /** The E02 source index of the build (artifacts folder), when present. */
  sourceIndex: (build: string) => SourceIndex | undefined;
}

export const REAL_DEPS: Deps = {
  openPak: (g) => (existsSync(join(g, "addons")) ? PakVirtualFS.get(g) : null),
  gamePath: () => loadConfig().gamePath,
  sourceIndex: (build) => loadSourceIndex(build),
};

export function run(argv: string[], io: Io = PROCESS_IO, deps: Deps = REAL_DEPS): number {
  return guard(io, "e10-data-schema", () => {
    const { values } = parseArgs({
      args: argv,
      options: {
        build: { type: "string" },
        game: { type: "string" },
        out: { type: "string" },
        artifacts: { type: "string" },
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
      io.err(`e10-data-schema: ${e instanceof Error ? e.message : String(e)}`);
      return EXIT_FAIL;
    }
    const gamePath = values.game ? resolve(values.game) : deps.gamePath();
    const pak = gamePath ? deps.openPak(gamePath) : null;
    if (!pak) {
      io.out(
        "NO DATA: no game install with pak files at the configured game path (ENFUSION_GAME_PATH or --game); nothing written",
      );
      return EXIT_USAGE;
    }
    const t0 = Date.now();
    const corpus = readCorpus(pak, build);
    const rows = buildRows(corpus);
    const h = headline(corpus, rows, deps.sourceIndex(build));
    const text = observationFileText(rows, corpus);
    const artDir = join(
      values.artifacts ? resolve(values.artifacts) : artifactsDir(),
      "census",
      build,
      ENUMERATOR_ID,
    );
    mkdirSync(artDir, { recursive: true });
    writeFileAtomic(join(artDir, "data-schema.json"), artifactText(corpus, rows, h));
    mkdirSync(dirname(out), { recursive: true });
    writeFileAtomic(out, text);
    const seconds = Math.round((Date.now() - t0) / 100) / 10;
    const ok = h.files.read_share >= READ_GATE;
    const byKind: Record<string, number> = {};
    for (const o of rows.observations) byKind[o.obs.kind] = (byKind[o.obs.kind] ?? 0) + 1;
    if (values.json) {
      io.out(
        JSON.stringify({
          ok,
          command: "e10-data-schema",
          build,
          rows: rows.observations.length,
          rows_by_kind: byKind,
          seconds,
          headline: h,
          unreadable: corpus.unreadable,
          left_out_classes: rows.leftOutClasses,
          left_out_keys: rows.leftOutKeys.length,
          scrubbed_quotes: rows.scrubbedQuotes,
        }),
      );
      return ok ? EXIT_OK : EXIT_FAIL;
    }
    for (const u of corpus.unreadable) io.out(`unreadable ${u.path}: ${u.message}`);
    for (const x of corpus.excluded) io.out(`excluded .${x.ext} (${x.files} files): ${x.why}`);
    io.out(
      `binary extensions (not read): ${corpus.binary_extensions.map((e) => `.${e}`).join(" ")}`,
    );
    io.out(`.meta files in the paks: ${corpus.meta_files} (no resource-class rows)`);
    io.out(
      `left out: ${rows.leftOutKeys.length} schema-key rows whose key name cannot be an id; ${rows.leftOutClasses.length} classes`,
    );
    io.out(JSON.stringify(h, null, 2));
    io.out(
      `E10 at build ${build}: ${rows.observations.length} observations (${Object.entries(byKind)
        .sort()
        .map(([k, n]) => `${k} ${n}`)
        .join(
          ", ",
        )}); read ${h.files.read} of ${h.files.in_scope_text} text files (${(h.files.read_share * 100).toFixed(3)}%) in ${seconds} s`,
    );
    return ok ? EXIT_OK : EXIT_FAIL;
  });
}

if (isMainModule(import.meta.url)) process.exitCode = run(process.argv.slice(2));
