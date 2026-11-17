/**
 * The E02 script-source index (DEC-018): every class, enum, enum value,
 * method, member variable, attribute use, typedef and global function of
 * every `.c` file under `scripts/` in the game paks, with file, line,
 * `#ifdef` guards and doc comments. One parse of all files feeds both E02
 * outputs: this index (artifacts folder, never committed) and the E02
 * observation rows for the Workbench API scope.
 *
 * Location: `<artifacts>/census/<build>/E02/source-index.jsonl`, where
 * `<artifacts>` is the artifacts folder of `scripts/live/paths.ts`
 * (`ENFUSION_ARTIFACTS_DIR`, else `%LOCALAPPDATA%\enfusion-mcp\artifacts` on
 * Windows, else `~/.local/share/enfusion-mcp/artifacts`). `src/` cannot import
 * `scripts/`, so `defaultArtifactsDir()` repeats that rule; a test keeps the
 * two equal.
 *
 * File format (JSONL, canonical key order, deterministic):
 *   line 1        the header (`SourceIndexHeader`)
 *   then per file, files in code-unit order of their virtual path:
 *                 one `FileEntry` line, then one line per declaration in
 *                 source order (`SourceRecord` from `enforce-source.ts`)
 *
 * Readers: E03 (plugins), E12 (API-index reconcile), E15 (attribute scan),
 * E16, E18, the Enforce linter and `exists.ts`. The exported types are the
 * public interface; extend them, never repurpose a field.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, posix, resolve, win32 } from "node:path";
import { compareCodeUnits, jsonlLine, sha256 } from "./canon.js";
import {
  parseEnforceSource,
  type AttributeUse,
  type ClassRecord,
  type DocWarning,
  type EnumRecord,
  type EnumValueRecord,
  type FieldRecord,
  type MethodRecord,
  type ParseError,
  type ParseWarning,
  type SourceRecord,
  type TypedefRecord,
} from "./enforce-source.js";
import { writeFileAtomic } from "./ledger-io.js";

export type {
  AttributeUse,
  ClassRecord,
  EnumRecord,
  EnumValueRecord,
  FieldRecord,
  MethodRecord,
  ParamInfo,
  SourceRecord,
  TypedefRecord,
} from "./enforce-source.js";

/** Format version of the index file; a loader refuses any other. */
export const SOURCE_INDEX_VERSION = 1;
/** Module that writes the index (recorded in the header). */
export const SOURCE_INDEX_GENERATOR = "src/census/source-index.ts";
export const SOURCE_INDEX_FILE = "source-index.jsonl";

// ── Types ─────────────────────────────────────────────────────────────────────

/** First line of the index file. */
export interface SourceIndexHeader {
  $source_index: number;
  build: string;
  generator: string;
  file_count: number;
  record_count: number;
  /** sha256 over the sorted `<path>\0<sha256 of text>\n` lines of every parsed file. */
  inputs_sha256: string;
  /** Files with at least one parse error, with the errors. */
  failed: { file: string; errors: ParseError[] }[];
  /** Constructs the engine accepts but that depart from the usual grammar. */
  warnings: ({ file: string } & ParseWarning)[];
  /** Doc-comment oddities, e.g. a `\code` closed by `/endcode`. */
  doc_warnings: ({ file: string } & DocWarning)[];
}

/** One line per parsed file, before that file's records. */
export interface FileEntry {
  kind: "file";
  file: string;
  script_module: string;
  lines: number;
  sha256: string;
  /** Records parsed from the file. */
  records: number;
  /** Parse errors in the file (0 for a clean parse). */
  errors: number;
  defines?: string[];
}

/** A class with every declaration of it (the base one and every `modded class`). */
export interface MergedClass {
  name: string;
  /** Non-modded declarations first, then modded ones; each group in (file, line) order. Forward declarations are kept. */
  declarations: ClassRecord[];
  /** Parent of the first non-modded declaration that names one (else of any declaration). */
  parent?: string;
  parent_name?: string;
  generics: string[];
  /** Attribute uses of every declaration, in declaration order. */
  attributes: AttributeUse[];
  /** Methods of every declaration, in declaration order (a modded override appears after the original). */
  methods: MethodRecord[];
  fields: FieldRecord[];
}

export interface MergedEnum {
  name: string;
  declarations: EnumRecord[];
  values: EnumValueRecord[];
}

/** The loaded index with lookup tables. */
export interface SourceIndex {
  header: SourceIndexHeader;
  files: FileEntry[];
  /** Every record, files in path order, records in source order. */
  records: SourceRecord[];
  byFile: Map<string, SourceRecord[]>;
  classes: Map<string, MergedClass>;
  enums: Map<string, MergedEnum>;
  typedefs: Map<string, TypedefRecord[]>;
  /** Global functions by name. */
  functions: Map<string, MethodRecord[]>;
  /** Global variables by name. */
  variables: Map<string, FieldRecord[]>;
}

/** Anything that lists virtual paths and reads text, e.g. `PakVirtualFS`. */
export interface SourceProvider {
  allFilePaths(): string[];
  readTextFile(path: string): string;
}

export interface SourceInput {
  path: string;
  text: string;
}

// ── Artifacts location ────────────────────────────────────────────────────────

/** Mirrors `artifactsDir()` of `scripts/live/paths.ts` (src cannot import scripts). */
export function defaultArtifactsDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): string {
  const override = env.ENFUSION_ARTIFACTS_DIR;
  if (override) {
    let cur = resolve(override);
    for (;;) {
      if (existsSync(join(cur, ".git")))
        throw new Error(
          `ENFUSION_ARTIFACTS_DIR=${override} lies inside a git working tree; raw artifacts never enter one (plan 4.2)`,
        );
      const parent = dirname(cur);
      if (parent === cur) break;
      cur = parent;
    }
    return override;
  }
  if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA || win32.join(home, "AppData", "Local");
    return win32.join(localAppData, "enfusion-mcp", "artifacts");
  }
  return posix.join(home, ".local", "share", "enfusion-mcp", "artifacts");
}

/** `<artifacts>/census/<build>/E02/source-index.jsonl`. */
export function sourceIndexPath(
  build: string,
  artifactsRoot: string = defaultArtifactsDir(),
): string {
  if (!/^[A-Za-z0-9._-]+$/.test(build)) throw new Error(`invalid build tag "${build}"`);
  return join(artifactsRoot, "census", build, "E02", SOURCE_INDEX_FILE);
}

// ── Build ─────────────────────────────────────────────────────────────────────

/** True for a script source file: `scripts/**.c` (case-insensitive). */
export function isScriptSource(path: string): boolean {
  return /^scripts\/.+\.c$/i.test(path.replace(/\\/g, "/"));
}

function isProvider(x: SourceProvider | readonly SourceInput[]): x is SourceProvider {
  return typeof (x as SourceProvider).allFilePaths === "function";
}

/**
 * Parses every script source once and returns the index. From a provider
 * (the pak VFS) every `scripts/**.c` path is read; from a list, every entry
 * is parsed as given. Deterministic: files are taken in code-unit order.
 */
export function buildSourceIndex(
  input: SourceProvider | readonly SourceInput[],
  opts: { build: string },
): SourceIndex {
  const sources: { path: string; read: () => string }[] = isProvider(input)
    ? input
        .allFilePaths()
        .filter(isScriptSource)
        .map((p) => ({ path: p, read: () => input.readTextFile(p) }))
    : input.map((s) => ({ path: s.path, read: () => s.text }));
  sources.sort((a, b) => compareCodeUnits(a.path, b.path));

  const files: FileEntry[] = [];
  const records: SourceRecord[] = [];
  const failed: SourceIndexHeader["failed"] = [];
  const warnings: SourceIndexHeader["warnings"] = [];
  const docWarnings: SourceIndexHeader["doc_warnings"] = [];
  const inputLines: string[] = [];
  for (const s of sources) {
    const text = s.read();
    const parsed = parseEnforceSource(s.path, text);
    const digest = sha256(text);
    inputLines.push(`${s.path}\u0000${digest}\n`);
    const entry: FileEntry = {
      kind: "file",
      file: s.path,
      script_module: parsed.script_module,
      lines: parsed.lines,
      sha256: digest,
      records: parsed.records.length,
      errors: parsed.errors.length,
    };
    if (parsed.defines.length) entry.defines = parsed.defines;
    files.push(entry);
    records.push(...parsed.records);
    if (parsed.errors.length) failed.push({ file: s.path, errors: parsed.errors });
    for (const w of parsed.warnings) warnings.push({ file: s.path, ...w });
    for (const w of parsed.doc_warnings) docWarnings.push({ file: s.path, ...w });
  }
  const header: SourceIndexHeader = {
    $source_index: SOURCE_INDEX_VERSION,
    build: opts.build,
    generator: SOURCE_INDEX_GENERATOR,
    file_count: files.length,
    record_count: records.length,
    inputs_sha256: sha256(inputLines.join("")),
    failed,
    warnings,
    doc_warnings: docWarnings,
  };
  return assemble(header, files, records);
}

/** Builds the lookup tables. */
function assemble(
  header: SourceIndexHeader,
  files: FileEntry[],
  records: SourceRecord[],
): SourceIndex {
  const byFile = new Map<string, SourceRecord[]>();
  for (const f of files) byFile.set(f.file, []);
  const classes = new Map<string, MergedClass>();
  const enums = new Map<string, MergedEnum>();
  const typedefs = new Map<string, TypedefRecord[]>();
  const functions = new Map<string, MethodRecord[]>();
  const variables = new Map<string, FieldRecord[]>();
  const push = <T>(m: Map<string, T[]>, k: string, v: T): void => {
    const l = m.get(k);
    if (l) l.push(v);
    else m.set(k, [v]);
  };
  const cls = (name: string): MergedClass => {
    let c = classes.get(name);
    if (!c) {
      c = { name, declarations: [], generics: [], attributes: [], methods: [], fields: [] };
      classes.set(name, c);
    }
    return c;
  };
  const en = (name: string): MergedEnum => {
    let e = enums.get(name);
    if (!e) {
      e = { name, declarations: [], values: [] };
      enums.set(name, e);
    }
    return e;
  };
  // Records arrive in (file, source) order; modded declarations are moved
  // after the non-modded ones below.
  const decls = new Map<string, { base: ClassRecord[]; modded: ClassRecord[] }>();
  for (const r of records) {
    push(byFile, r.file, r);
    switch (r.kind) {
      case "class": {
        cls(r.name);
        let d = decls.get(r.name);
        if (!d) decls.set(r.name, (d = { base: [], modded: [] }));
        (r.modded ? d.modded : d.base).push(r);
        break;
      }
      case "enum":
        en(r.name).declarations.push(r);
        break;
      case "enum-value":
        en(r.owner).values.push(r);
        break;
      case "typedef":
        push(typedefs, r.name, r);
        break;
      case "method":
        if (r.owner !== undefined) cls(r.owner).methods.push(r);
        break;
      case "function":
        push(functions, r.name, r);
        break;
      case "field":
        if (r.owner !== undefined) cls(r.owner).fields.push(r);
        break;
      case "variable":
        push(variables, r.name, r);
        break;
    }
  }
  for (const [name, d] of decls) {
    const c = cls(name);
    c.declarations = [...d.base, ...d.modded];
    const withParent =
      c.declarations.find((x) => !x.modded && x.parent !== undefined) ??
      c.declarations.find((x) => x.parent !== undefined);
    if (withParent) {
      c.parent = withParent.parent;
      c.parent_name = withParent.parent_name;
    }
    c.generics = c.declarations.find((x) => x.generics.length > 0)?.generics ?? [];
    c.attributes = c.declarations.flatMap((x) => x.attributes);
    // Members in declaration order: the base declarations' members first.
    const order = new Map(c.declarations.map((x, i) => [`${x.file}\u0000${x.line}`, i]));
    const rank = (m: { file: string; line: number }): number => {
      // A member belongs to the declaration of its file that encloses its line.
      let best = Number.MAX_SAFE_INTEGER;
      for (const x of c.declarations) {
        if (x.file === m.file && m.line >= x.line && m.line <= x.end_line) {
          best = order.get(`${x.file}\u0000${x.line}`) ?? best;
          break;
        }
      }
      return best;
    };
    const sortMembers = <T extends { file: string; line: number }>(list: T[]): T[] =>
      list
        .map((m, i) => ({ m, i, r: rank(m) }))
        .sort((a, b) => a.r - b.r || a.i - b.i)
        .map((x) => x.m);
    c.methods = sortMembers(c.methods);
    c.fields = sortMembers(c.fields);
  }
  return { header, files, records, byFile, classes, enums, typedefs, functions, variables };
}

// ── Save / load ───────────────────────────────────────────────────────────────

const RECORD_KEY_ORDER = ["kind", "file", "line", "owner", "name"];

/** Exact text of the index file. */
export function sourceIndexText(index: SourceIndex): string {
  const out: string[] = [jsonlLine(index.header, ["$source_index", "build", "generator"])];
  for (const f of index.files) {
    out.push(jsonlLine(f, RECORD_KEY_ORDER));
    for (const r of index.byFile.get(f.file) ?? []) out.push(jsonlLine(r, RECORD_KEY_ORDER));
  }
  return out.join("\n") + "\n";
}

/** Writes the index to the artifacts folder (or `opts.file`); returns the path written. */
export function saveSourceIndex(
  index: SourceIndex,
  opts: { dir?: string; file?: string } = {},
): string {
  const file = opts.file ?? sourceIndexPath(index.header.build, opts.dir);
  mkdirSync(dirname(file), { recursive: true });
  writeFileAtomic(file, sourceIndexText(index));
  return file;
}

/** Parses index file text. Throws on a malformed file or another format version. */
export function parseSourceIndexText(text: string): SourceIndex {
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  const header = JSON.parse(lines[0] ?? "null") as SourceIndexHeader | null;
  if (!header || header.$source_index !== SOURCE_INDEX_VERSION)
    throw new Error(
      `source index: header missing or format version ${header?.$source_index} is not ${SOURCE_INDEX_VERSION}`,
    );
  const files: FileEntry[] = [];
  const records: SourceRecord[] = [];
  for (let i = 1; i < lines.length; i++) {
    const v = JSON.parse(lines[i]) as FileEntry | SourceRecord;
    if (v.kind === "file") files.push(v);
    else records.push(v);
  }
  if (files.length !== header.file_count || records.length !== header.record_count)
    throw new Error(
      `source index: header says ${header.file_count} files / ${header.record_count} records, file holds ${files.length} / ${records.length}`,
    );
  return assemble(header, files, records);
}

/**
 * Loads the index of `build` from the artifacts folder (or `opts.dir` /
 * `opts.file`). Undefined when the file is absent.
 */
export function loadSourceIndex(
  build: string,
  opts: { dir?: string; file?: string } = {},
): SourceIndex | undefined {
  const file = opts.file ?? sourceIndexPath(build, opts.dir);
  if (!existsSync(file)) return undefined;
  const index = parseSourceIndexText(readFileSync(file, "utf-8"));
  if (index.header.build !== build)
    throw new Error(`source index ${file} is for build ${index.header.build}, not ${build}`);
  return index;
}

export type EnsureResult =
  | { status: "loaded" | "built"; index: SourceIndex; path: string }
  | { status: "no-data"; reason: string };

/**
 * Loads the index of `build`; when it is absent, builds it from the game
 * paks (`opts.gamePath`, default `loadConfig().gamePath`) and saves it. The
 * caller asserts that the installed game is `build`. Returns `no-data` with a
 * reason when there is neither an index nor a readable game install.
 */
export async function ensureSourceIndex(
  build: string,
  opts: { dir?: string; gamePath?: string } = {},
): Promise<EnsureResult> {
  const path = sourceIndexPath(build, opts.dir);
  const loaded = loadSourceIndex(build, { file: path });
  if (loaded) return { status: "loaded", index: loaded, path };
  const gamePath = opts.gamePath ?? (await import("../config.js")).loadConfig().gamePath;
  if (!gamePath || !existsSync(join(gamePath, "addons")))
    return {
      status: "no-data",
      reason: `NO DATA: no source index for build ${build} and no game install at the configured game path (ENFUSION_GAME_PATH)`,
    };
  const { PakVirtualFS } = await import("../pak/vfs.js");
  const vfs = PakVirtualFS.get(gamePath);
  if (!vfs)
    return {
      status: "no-data",
      reason: `NO DATA: no .pak files under the game install's addons folder`,
    };
  const index = buildSourceIndex(vfs, { build });
  saveSourceIndex(index, { file: path });
  return { status: "built", index, path };
}

// ── Lookups ───────────────────────────────────────────────────────────────────

/** The class of that name with all its declarations; typedef aliases are followed. */
export function findClass(index: SourceIndex, name: string): MergedClass | undefined {
  const direct = index.classes.get(name);
  if (direct && direct.declarations.length > 0) return direct;
  const td = index.typedefs.get(name)?.[0];
  if (td && td.type_name !== name) return index.classes.get(td.type_name);
  return direct;
}

export function findEnum(index: SourceIndex, name: string): MergedEnum | undefined {
  return index.enums.get(name);
}

/** The class and its ancestors, nearest first (cycle-safe; unknown parents end the chain). */
export function classChain(index: SourceIndex, name: string): MergedClass[] {
  const out: MergedClass[] = [];
  const seen = new Set<string>();
  let cur = findClass(index, name);
  while (cur && !seen.has(cur.name)) {
    seen.add(cur.name);
    out.push(cur);
    cur = cur.parent_name ? findClass(index, cur.parent_name) : undefined;
  }
  return out;
}

export interface MethodView {
  method: MethodRecord;
  /** The class whose declaration holds the method. */
  declared_in: string;
  /** True when it comes from an ancestor. */
  inherited: boolean;
}

/**
 * Methods of a class. With `inherited` (default), the parent chain adds the
 * methods the class does not itself declare with the same name and arity
 * (the most derived declaration wins). Within one class, every declaration
 * is kept (a modded override and its original both appear).
 */
export function methodsOf(
  index: SourceIndex,
  className: string,
  opts: { inherited?: boolean } = {},
): MethodView[] {
  const chain = classChain(index, className);
  if (chain.length === 0) return [];
  const out: MethodView[] = [];
  const shadow = new Set<string>();
  chain.forEach((c, depth) => {
    if (depth > 0 && opts.inherited === false) return;
    const local = new Set<string>();
    for (const m of c.methods) {
      const k = `${m.name}/${m.arity}`;
      if (depth > 0 && shadow.has(k)) continue;
      local.add(k);
      out.push({ method: m, declared_in: c.name, inherited: depth > 0 });
    }
    for (const k of local) shadow.add(k);
  });
  return out;
}

/** Every record parsed from one file, in source order. */
export function declarationsInFile(index: SourceIndex, file: string): SourceRecord[] {
  return index.byFile.get(file) ?? [];
}

/** Classes whose declared parent (any declaration) is `parent`. */
export function subclassesOf(index: SourceIndex, parent: string): MergedClass[] {
  return [...index.classes.values()]
    .filter((c) => c.declarations.some((d) => d.parent_name === parent))
    .sort((a, b) => compareCodeUnits(a.name, b.name));
}

/** `pak:<virtual path>#L<line>`. */
export function pakRef(r: { file: string; line: number }): string {
  return `pak:${r.file}#L${r.line}`;
}

/** The census kind word of a record: `static-method` and `event` split out of `method`. */
export function recordKind(r: SourceRecord): string {
  if (r.kind === "method") {
    if (r.modifiers.includes("event")) return "event";
    if (r.modifiers.includes("static")) return "static-method";
  }
  return r.kind;
}

export interface SymbolMatch {
  /** The exact form that matched. */
  form: string;
  kind: string;
  /** `Owner.name` for members, the name otherwise. */
  qualified: string;
  arity?: number;
  ref: string;
  signature?: string;
  /** Set when the match came through the parent chain. */
  inherited_from?: string;
}

/**
 * Exact symbol lookup (code-unit equality, or case-insensitive with `ci`).
 * Forms: `Name` (any declaration), `Class.member` (method, field, enum value;
 * members inherited through the parent chain are found too), and the ledger
 * id forms `api:Class`, `api:Class.Member`, `api:Class.Method/<arity>`.
 */
export function lookupSymbol(
  index: SourceIndex,
  symbol: string,
  opts: { ci?: boolean; kind?: string } = {},
): SymbolMatch[] {
  const eq = (a: string, b: string): boolean =>
    opts.ci ? a.toLowerCase() === b.toLowerCase() : a === b;
  let s = symbol;
  let arity: number | undefined;
  const idForm = /^api:([^.#/]+)(?:\.([^/]+?))?(?:\/(\d+))?$/.exec(s);
  if (idForm) {
    s = idForm[2] !== undefined ? `${idForm[1]}.${idForm[2]}` : idForm[1];
    if (idForm[3] !== undefined) arity = Number(idForm[3]);
  }
  const out: SymbolMatch[] = [];
  const add = (r: SourceRecord, inheritedFrom?: string): void => {
    const owner = "owner" in r ? r.owner : undefined;
    const m: SymbolMatch = {
      form: symbol,
      kind: recordKind(r),
      qualified: owner !== undefined ? `${owner}.${r.name}` : r.name,
      ref: pakRef(r),
    };
    if (r.kind === "method" || r.kind === "function") m.arity = r.arity;
    if ("signature" in r) m.signature = r.signature;
    if (inheritedFrom) m.inherited_from = inheritedFrom;
    out.push(m);
  };
  const dot = s.indexOf(".");
  if (dot > 0) {
    const owner = s.slice(0, dot);
    const member = s.slice(dot + 1);
    const ownerNames = opts.ci
      ? [...index.classes.keys(), ...index.enums.keys()].filter((n) => eq(n, owner))
      : [owner];
    for (const on of ownerNames) {
      for (const v of methodsOf(index, on)) {
        if (eq(v.method.name, member) && (arity === undefined || v.method.arity === arity))
          add(v.method, v.inherited ? v.declared_in : undefined);
      }
      if (arity === undefined) {
        classChain(index, on).forEach((c, depth) => {
          for (const f of c.fields) if (eq(f.name, member)) add(f, depth > 0 ? c.name : undefined);
        });
        for (const v of index.enums.get(on)?.values ?? []) if (eq(v.name, member)) add(v);
      }
    }
  } else if (arity === undefined) {
    for (const r of index.records) {
      if (r.kind === "class" && r.modded) continue;
      if (eq(r.name, s)) add(r);
    }
  }
  const filtered = opts.kind ? out.filter((m) => m.kind === opts.kind) : out;
  const seen = new Set<string>();
  return filtered
    .filter((m) => {
      const k = `${m.kind}\u0000${m.qualified}\u0000${m.ref}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => compareCodeUnits(`${a.qualified} ${a.ref}`, `${b.qualified} ${b.ref}`));
}

/** Near candidates for a miss: names and `Owner.name` forms that start with, or prefix, the symbol. */
export function nearSymbols(index: SourceIndex, symbol: string, limit = 5): string[] {
  const lower = symbol.toLowerCase();
  const near = new Set<string>();
  for (const r of index.records) {
    const owner = "owner" in r ? r.owner : undefined;
    for (const f of owner !== undefined ? [r.name, `${owner}.${r.name}`] : [r.name]) {
      const fl = f.toLowerCase();
      if (fl === lower || fl.startsWith(lower) || (lower.startsWith(fl) && fl.length >= 3))
        near.add(f);
    }
  }
  // Closest first: forms that extend the symbol, then by length difference.
  const score = (f: string): [number, number] => [
    f.toLowerCase().startsWith(lower) ? 0 : 1,
    Math.abs(f.length - symbol.length),
  ];
  return [...near]
    .sort((a, b) => {
      const [a0, a1] = score(a);
      const [b0, b1] = score(b);
      return a0 - b0 || a1 - b1 || compareCodeUnits(a, b);
    })
    .slice(0, limit);
}
