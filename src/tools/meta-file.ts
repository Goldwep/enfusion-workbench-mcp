/**
 * `meta_file`: read, scan and edit the `.meta` sidecar of an existing resource as text.
 *
 * A `.meta` is a `MetaFileClass` block with one `Configurations` array: one
 * resource-class block per platform (`PNGResourceClass PC : "{GUID}base.conf" {`),
 * the other platforms usually inheriting `: PC`. The tool reads and edits the
 * file through the lossless parser (src/formats/enfusion-cst.ts): every byte it
 * does not touch stays as it was, line endings and a missing final newline
 * included.
 *
 * Ruling W2 OD-8: it edits metas that already exist and never creates one. A
 * new resource is registered through Workbench (wb_resources register); a
 * hand-written .et or .png meta does not resolve (U25).
 *
 * Reads: a meta under the project root, or a game resource's meta from the
 * paks (read only). Writes: only inside the project root, a dry run unless
 * confirm is true, and a file the writer could not reproduce byte for byte is
 * refused, not rewritten.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { writeFileAtomic } from "../utils/atomic-write.js";
import { isAbsolute, relative, resolve } from "node:path";
import { z } from "zod";
import type { Config } from "../config.js";
import {
  CstDocument,
  CstEditError,
  parseCstBytes,
  tokenValue,
  type CstObject,
  type ScalarInput,
  type Token,
} from "../formats/enfusion-cst.js";
import {
  ERROR_CODES,
  LIMIT_DEFAULT,
  LIMIT_MAX,
  checkCursor,
  checkRelativePath,
  nextCursor,
  parseCursor,
  type Change,
  type ErrorCode,
} from "../manifest/vocabulary.js";
import { PakVirtualFS } from "../pak/vfs.js";
import { assertInsideRoot, pinnedProjectRoot } from "../utils/path-guard.js";

// ── Response ────────────────────────────────────────────────────────────────

/** META_NOT_FOUND, UNSUPPORTED_TYPE and READ_ONLY_SOURCE live in vocabulary.ts (phase5-w2-spec.md section 1, DEC-065). */
type MetaCode = ErrorCode;

interface MetaError {
  ok: false;
  action: string;
  target: string;
  code: MetaCode;
  message: string;
  next: string;
  warnings: string[];
}

interface MetaOk {
  ok: true;
  action: string;
  target: string;
  changed: Change[] | null;
  readback: unknown;
  next?: string;
  warnings: string[];
}

class MetaFileError extends Error {
  constructor(
    readonly code: MetaCode,
    message: string,
    readonly next?: string,
  ) {
    super(message);
    this.name = "MetaFileError";
  }
}

function nextFor(code: MetaCode): string {
  return ERROR_CODES[code];
}

function failure(action: string, target: string, e: unknown): MetaError {
  if (e instanceof MetaFileError) {
    return {
      ok: false,
      action,
      target,
      code: e.code,
      message: e.message,
      next: e.next ?? nextFor(e.code),
      warnings: [],
    };
  }
  if (e instanceof CstEditError) {
    const code: MetaCode =
      e.code === "UNSUPPORTED"
        ? "UNSUPPORTED_TYPE"
        : e.code === "PATH_NOT_FOUND"
          ? "PATH_NOT_FOUND"
          : "INVALID_ARGUMENT";
    return {
      ok: false,
      action,
      target,
      code,
      message: e.message,
      next: nextFor(code),
      warnings: [],
    };
  }
  // VocabularyError from checkRelativePath / checkCursor carries a code.
  const coded = (e as { code?: unknown } | null)?.code;
  if (typeof coded === "string" && coded in ERROR_CODES) {
    const code = coded as ErrorCode;
    return {
      ok: false,
      action,
      target,
      code,
      message: (e as Error).message,
      next: nextFor(code),
      warnings: [],
    };
  }
  const message = e instanceof Error ? e.message : String(e);
  // assertInsideRoot throws a plain Error naming the root.
  const code: MetaCode = /resolves outside project root/.test(message)
    ? "NOT_IN_PROJECT"
    : "HANDLER_ERROR";
  return { ok: false, action, target, code, message, next: nextFor(code), warnings: [] };
}

// ── The meta model ──────────────────────────────────────────────────────────

const PLATFORMS = ["PC", "XBOX_ONE", "XBOX_SERIES", "PS4", "PS5", "HEADLESS"] as const;

export interface MetaProp {
  key: string;
  values: string[];
  quoted: boolean[];
}

export interface MetaConfiguration {
  /** Position in the Configurations array. */
  index: number;
  className: string;
  platform: string;
  /** What follows the colon: a resource reference or a platform name. */
  ancestor: { value: string; kind: "resource" | "platform" } | null;
  props: MetaProp[];
  /** Nested blocks (for instance MaterialAssigns), with their entry count. */
  blocks: { key: string; count: number }[];
}

export interface MetaView {
  guid: string | null;
  resourcePath: string | null;
  encoding: string;
  lineEnding: "crlf" | "lf" | "cr" | "none";
  finalNewline: boolean;
  configurations: MetaConfiguration[];
  /** Scalars of MetaFileClass other than Name. */
  extra: MetaProp[];
}

function metaRoot(doc: CstDocument): CstObject | undefined {
  const b = doc.base;
  return b.kind === "object" && b.key === "MetaFileClass" ? b : undefined;
}

function propOf(e: { key: string; values: Token[] }): MetaProp {
  return {
    key: e.key,
    values: e.values.map(tokenValue),
    quoted: e.values.map((t) => t.kind === "string"),
  };
}

function configurationsOf(root: CstObject): CstObject | undefined {
  return root.children.find(
    (c): c is CstObject => c.kind === "object" && c.key === "Configurations",
  );
}

function viewMeta(doc: CstDocument): MetaView {
  const root = metaRoot(doc);
  if (!root) throw new MetaFileError("UNSUPPORTED_TYPE", "the file is not one MetaFileClass block");
  let name: string | null = null;
  const extra: MetaProp[] = [];
  for (const c of root.children) {
    if (c.kind !== "scalar") continue;
    if (c.key === "Name") name = c.values.length ? tokenValue(c.values[0]) : null;
    else extra.push(propOf(c));
  }
  const m = name ? /^\{([0-9A-Fa-f]{16})\}(.*)$/.exec(name) : null;
  const configs: MetaConfiguration[] = [];
  const list = configurationsOf(root);
  list?.children.forEach((c, index) => {
    if (c.kind !== "object") return;
    const base = c.base[0];
    let ancestor: MetaConfiguration["ancestor"] = null;
    if (base) {
      ancestor = {
        value: tokenValue(base),
        kind: base.kind === "string" ? "resource" : "platform",
      };
    }
    const props: MetaProp[] = [];
    const blocks: MetaConfiguration["blocks"] = [];
    for (const p of c.children) {
      if (p.kind === "scalar") props.push(propOf(p));
      else if (p.kind === "object") blocks.push({ key: p.key, count: p.children.length });
    }
    configs.push({
      index,
      className: c.head[0]?.text ?? "",
      platform: c.head[1] ? tokenValue(c.head[1]) : "",
      ancestor,
      props,
      blocks,
    });
  });
  const text = doc.text;
  const eol = /\r\n/.test(text) ? "crlf" : /\n/.test(text) ? "lf" : /\r/.test(text) ? "cr" : "none";
  return {
    guid: m ? m[1].toUpperCase() : null,
    resourcePath: m ? m[2] : name,
    encoding: doc.encoding,
    lineEnding: eol,
    finalNewline: /[\r\n]$/.test(text),
    configurations: configs,
    extra,
  };
}

/**
 * Why a meta may not be written, or undefined when it may: the writer must
 * reproduce the file byte for byte and understand its shape.
 */
function writeBlocker(doc: CstDocument, bytes: Buffer): string | undefined {
  if (!doc.toBytes().equals(bytes))
    return "the parser does not give the file's bytes back (encoding or stray bytes)";
  if (doc.diagnostics.length)
    return `the text does not parse cleanly (${doc.diagnostics[0].message}, line ${doc.diagnostics[0].line})`;
  const root = metaRoot(doc);
  if (!root) return "the file is not one MetaFileClass block";
  if (doc.root.children.some((c) => c.kind === "opaque")) return "the file has stray text";
  const list = configurationsOf(root);
  if (!list) return "the file has no Configurations block";
  if (list.children.some((c) => c.kind !== "object"))
    return "Configurations holds something other than configuration blocks";
  return undefined;
}

// ── Paths and files ─────────────────────────────────────────────────────────

const stripGuid = (ref: string): string => ref.replace(/^\{[0-9A-Fa-f]{16}\}/, "");

function vfsOf(config: Config): PakVirtualFS | null {
  try {
    return config.gamePath ? PakVirtualFS.get(config.gamePath) : null;
  } catch {
    return null;
  }
}

/** A resource path relative to the addon root, from a relative path or an absolute one inside the root. */
function resourcePathOf(raw: string, root: string | undefined, label: string): string {
  const clean = stripGuid(raw.trim());
  if (clean.startsWith("-"))
    throw new MetaFileError("INVALID_ARGUMENT", `${label}: paths starting with '-' are refused`);
  if (isAbsolute(clean) && root) {
    const rel = relative(resolve(root), resolve(clean));
    if (rel === "" || isAbsolute(rel) || rel.split(/[\\/]/)[0] === "..") {
      throw new MetaFileError("NOT_IN_PROJECT", `${label} is outside the project root: ${clean}`);
    }
    return checkRelativePath(rel);
  }
  const res = checkRelativePath(clean);
  if (res.toLowerCase().endsWith(".meta")) {
    throw new MetaFileError(
      "INVALID_ARGUMENT",
      `${label} is the source file, never the .meta: pass ${res.slice(0, -5)}`,
    );
  }
  return res;
}

/** Source extensions the engine registers as another resource (only .png is proven live). */
export const REGISTERS_AS: Readonly<Record<string, string>> = { ".png": ".edds" };

/** The resource a source registers as (`a/b_co.png` -> `a/b_co.edds`), or undefined. */
export function registeredAs(res: string): string | undefined {
  const dot = res.lastIndexOf(".");
  if (dot <= 0) return undefined;
  const as = REGISTERS_AS[res.slice(dot).toLowerCase()];
  return as ? `${res.slice(0, dot)}${as}` : undefined;
}

interface Located {
  res: string;
  /** Absolute path of the meta on disk; undefined for game data. */
  file?: string;
  source: "project" | "game";
  bytes: Buffer;
}

function locateMeta(
  pathArg: string,
  root: string | undefined,
  config: Config,
  forWrite: boolean,
): Located {
  const res = resourcePathOf(pathArg, root, "path");
  if (root) {
    const file = resolve(root, `${res}.meta`);
    assertInsideRoot(file, root, "path");
    if (existsSync(file) && statSync(file).isFile()) {
      return { res, file, source: "project", bytes: readFileSync(file) };
    }
    // A source that registers as another resource keeps its .meta beside that resource (W2 run 1:
    // W2_tex_co.png registered as W2_tex_co.edds, with W2_tex_co.edds.meta; no .png.meta).
    const registered = registeredAs(res);
    if (registered) {
      const alt = resolve(root, `${registered}.meta`);
      assertInsideRoot(alt, root, "path");
      if (existsSync(alt) && statSync(alt).isFile()) {
        return { res: registered, file: alt, source: "project", bytes: readFileSync(alt) };
      }
    }
  } else if (forWrite) {
    throw new MetaFileError(
      "NOT_IN_PROJECT",
      "meta_file writes need a project path (ENFUSION_PROJECT_PATH or projectPath)",
    );
  }
  const vfs = vfsOf(config);
  const vpath = `${res}.meta`;
  if (vfs?.exists(vpath)) {
    if (forWrite) {
      throw new MetaFileError(
        "READ_ONLY_SOURCE",
        `${vpath} is game data (read only); it has no copy under the project`,
      );
    }
    return { res, source: "game", bytes: vfs.readFile(vpath) };
  }
  const sourceHere = root ? existsSync(resolve(root, res)) : false;
  throw new MetaFileError(
    "META_NOT_FOUND",
    `no ${res}.meta ${root ? `under ${resolve(root)}` : "in the project"}${vfs ? " or in the game data" : ""}` +
      (sourceHere
        ? "; the resource exists but is not registered yet"
        : "; the resource itself was not found either"),
  );
}

// ── Diff ────────────────────────────────────────────────────────────────────

/** A unified diff of two texts that differ in one stretch of lines (all this tool's edits). */
function unifiedDiff(label: string, a: string, b: string, context = 2): string {
  if (a === b) return "";
  const x = a.split("\n");
  const y = b.split("\n");
  let p = 0;
  while (p < x.length && p < y.length && x[p] === y[p]) p++;
  let s = 0;
  while (s < x.length - p && s < y.length - p && x[x.length - 1 - s] === y[y.length - 1 - s]) s++;
  const from = Math.max(0, p - context);
  const xEnd = Math.min(x.length, x.length - s + context);
  const yEnd = Math.min(y.length, y.length - s + context);
  const shown = (l: string) => l.replace(/\r$/, "");
  const out = [
    `--- a/${label}`,
    `+++ b/${label}`,
    `@@ -${from + 1},${xEnd - from} +${from + 1},${yEnd - from} @@`,
  ];
  for (let i = from; i < p; i++) out.push(` ${shown(x[i])}`);
  for (let i = p; i < x.length - s; i++) out.push(`-${shown(x[i])}`);
  for (let i = p; i < y.length - s; i++) out.push(`+${shown(y[i])}`);
  for (let i = x.length - s; i < xEnd; i++) out.push(` ${shown(x[i])}`);
  return out.join("\n");
}

// ── Actions ─────────────────────────────────────────────────────────────────

const KEY_SEGMENT = /^[A-Za-z_][A-Za-z0-9_]*(?:\[\d+\])*$/;

function checkKey(key: string | undefined): string {
  if (!key) throw new MetaFileError("INVALID_ARGUMENT", "this action needs key (a property name)");
  if (!key.split(".").every((s) => KEY_SEGMENT.test(s))) {
    throw new MetaFileError("INVALID_ARGUMENT", `not a property path: ${key}`);
  }
  if (key === "Name" || key === "Configurations") {
    throw new MetaFileError("INVALID_ARGUMENT", `${key} is not a configuration property`);
  }
  return key;
}

/** The configurations an action touches: the named one (default PC), or all with allPlatforms. */
function pickConfigs(view: MetaView, configuration: string | undefined, all: boolean | undefined) {
  if (view.configurations.length === 0)
    throw new MetaFileError("UNSUPPORTED_TYPE", "the meta has no configurations");
  if (all) return view.configurations;
  const want = (configuration ?? "PC").toUpperCase();
  const hit = view.configurations.find((c) => c.platform.toUpperCase() === want);
  if (!hit) {
    throw new MetaFileError(
      "INVALID_ARGUMENT",
      `no configuration '${configuration ?? "PC"}' (has: ${view.configurations.map((c) => c.platform || `#${c.index}`).join(", ")})`,
    );
  }
  return [hit];
}

function readValue(doc: CstDocument, path: string): string | string[] | null {
  try {
    const g = doc.get(path);
    if (g.kind === "scalar" || g.kind === "value")
      return g.values.length === 1 ? g.values[0] : g.values;
    if (g.kind === "object") return `{block, ${g.count} entries}`;
    return g.raw;
  } catch (e) {
    if (e instanceof CstEditError && e.code === "PATH_NOT_FOUND") return null;
    throw e;
  }
}

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function setAncestorIn(doc: CstDocument, index: number, ref: string | null): CstDocument {
  const root = metaRoot(doc) as CstObject;
  const cfg = (configurationsOf(root) as CstObject).children[index] as CstObject;
  const headEnd = cfg.head[cfg.head.length - 1].end;
  const text = doc.text;
  let out: string;
  if (cfg.base.length) {
    const s = cfg.base[0].start;
    const e = cfg.base[cfg.base.length - 1].end;
    if (ref === null) {
      out = text.slice(0, headEnd) + text.slice(e);
    } else {
      out = text.slice(0, s) + ref + text.slice(e);
    }
  } else {
    if (ref === null) return doc;
    out = `${text.slice(0, headEnd)} : ${ref}${text.slice(headEnd)}`;
  }
  return new CstDocument(out, doc.encoding);
}

/**
 * The platform chain from a touched configuration back to itself, or null (review round 1, F10):
 * `PC : XBOX_ONE` beside `XBOX_ONE : PC` is a cycle. Only platform ancestors are followed; a
 * resource ancestor ends the chain.
 */
export function platformCycle(view: MetaView, touched: Set<number>): string[] | null {
  const byPlatform = new Map(view.configurations.map((c) => [c.platform.toUpperCase(), c]));
  for (const start of view.configurations) {
    if (!touched.has(start.index)) continue;
    const chain = [start.platform.toUpperCase()];
    let at = start;
    while (at.ancestor && at.ancestor.kind === "platform") {
      const up = at.ancestor.value.toUpperCase();
      chain.push(up);
      if (up === chain[0]) return chain;
      const next = byPlatform.get(up);
      if (!next || chain.indexOf(up) < chain.length - 1) break;
      at = next;
    }
  }
  return null;
}

/** The ancestor as it is written: a platform name bare, a GUID-prefixed resource quoted. */
function ancestorText(raw: string, ownPlatform: string): { text: string; value: string } {
  const up = raw.toUpperCase();
  if ((PLATFORMS as readonly string[]).includes(up)) {
    if (up === ownPlatform.toUpperCase())
      throw new MetaFileError("INVALID_ARGUMENT", `${ownPlatform} cannot inherit from itself`);
    return { text: up, value: up };
  }
  const m = /^\{([0-9A-Fa-f]{16})\}([^"\r\n{}]+)$/.exec(raw);
  if (!m) {
    throw new MetaFileError(
      "INVALID_ARGUMENT",
      `ancestor must be a platform name (${PLATFORMS.join(", ")}) or "{16-hex GUID}path", got ${raw}`,
    );
  }
  const value = `{${m[1].toUpperCase()}}${m[2]}`;
  return { text: `"${value}"`, value };
}

export interface MetaArgs {
  action: "read" | "scan" | "set" | "clear" | "setAncestor";
  path?: string;
  folder?: string;
  ext?: string;
  cursor?: string;
  limit?: number;
  configuration?: string;
  allPlatforms?: boolean;
  key?: string;
  value?: ScalarInput;
  quoted?: boolean;
  ancestor?: string | null;
  confirm?: boolean;
  projectPath?: string;
}

function doRead(a: MetaArgs, root: string | undefined, config: Config): MetaOk {
  if (!a.path) throw new MetaFileError("INVALID_ARGUMENT", "read needs path");
  const loc = locateMeta(a.path, root, config, false);
  const doc = parseCstBytes(loc.bytes);
  const view = viewMeta(doc);
  const warnings: string[] = [];
  if (doc.diagnostics.length)
    warnings.push(
      `the meta has parse diagnostics (${doc.diagnostics[0].message}); writes would be refused`,
    );
  if (loc.source === "game") warnings.push("game data: read only");
  return {
    ok: true,
    action: "read",
    target: `path:${loc.res}`,
    changed: null,
    readback: { source: loc.source, file: loc.file ?? `${loc.res}.meta`, ...view },
    warnings,
  };
}

function walkMetas(dir: string, out: string[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.isSymbolicLink()) continue;
    const p = resolve(dir, e.name);
    if (e.isDirectory()) {
      if (!e.name.startsWith(".") && e.name !== "node_modules") walkMetas(p, out);
    } else if (e.isFile() && e.name.toLowerCase().endsWith(".meta")) out.push(p);
  }
}

function doScan(a: MetaArgs, root: string | undefined): MetaOk {
  if (!root)
    throw new MetaFileError(
      "NOT_IN_PROJECT",
      "scan needs a project path (ENFUSION_PROJECT_PATH or projectPath)",
    );
  const folderRel =
    a.folder && a.folder.trim() !== "" ? resourcePathOf(a.folder, root, "folder") : "";
  const dir = folderRel ? resolve(root, folderRel) : resolve(root);
  assertInsideRoot(dir, root, "folder");
  if (!existsSync(dir) || !statSync(dir).isDirectory())
    throw new MetaFileError("PATH_NOT_FOUND", `no folder ${folderRel || "(project root)"}`);
  const ext = a.ext?.replace(/^\./, "").toLowerCase();
  const all: string[] = [];
  walkMetas(dir, all);
  const rootAbs = resolve(root);
  const rels = all
    .map((f) => relative(rootAbs, f).replace(/\\/g, "/"))
    .filter((r) => !ext || r.slice(0, -5).toLowerCase().endsWith(`.${ext}`))
    .sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
  const total = rels.length;
  const limit = Math.min(Math.max(a.limit ?? LIMIT_DEFAULT, 1), LIMIT_MAX);
  let start = 0;
  if (a.cursor) {
    const c = parseCursor(a.cursor);
    checkCursor(c, total);
    start = c.start;
  }
  const rows = rels.slice(start, start + limit).map((r) => {
    const res = r.slice(0, -5);
    const row: Record<string, unknown> = {
      path: res,
      sourceExists: existsSync(resolve(rootAbs, res)),
    };
    try {
      const v = viewMeta(parseCstBytes(readFileSync(resolve(rootAbs, r))));
      row.guid = v.guid;
      row.resourceClass = v.configurations[0]?.className ?? null;
      row.platforms = v.configurations.map((c) => c.platform);
      row.propertyLines = v.configurations.reduce((n, c) => n + c.props.length, 0);
    } catch (e) {
      row.unreadable = e instanceof Error ? e.message : String(e);
    }
    return row;
  });
  const nxt = nextCursor(start, limit, total);
  return {
    ok: true,
    action: "scan",
    target: `path:${folderRel}`,
    changed: null,
    readback: { total, start, count: rows.length, cursor: nxt ?? null, metas: rows },
    ...(nxt ? { next: `scan again with cursor ${nxt}` } : {}),
    warnings: [],
  };
}

function doWrite(a: MetaArgs, root: string | undefined, config: Config): MetaOk {
  if (!a.path) throw new MetaFileError("INVALID_ARGUMENT", `${a.action} needs path`);
  const loc = locateMeta(a.path, root, config, true);
  const file = loc.file as string;
  const orig = parseCstBytes(loc.bytes);
  const blocker = writeBlocker(orig, loc.bytes);
  if (blocker) {
    throw new MetaFileError("UNSUPPORTED_TYPE", `${loc.res}.meta is left alone: ${blocker}`);
  }
  const before = viewMeta(orig);
  const targets = pickConfigs(before, a.configuration, a.allPlatforms);
  const warnings: string[] = [];
  const changed: Change[] = [];
  let work = parseCstBytes(loc.bytes);

  if (a.action === "set" || a.action === "clear") {
    const key = checkKey(a.key);
    if (a.action === "set") {
      if (a.value === undefined || a.value === null)
        throw new MetaFileError(
          "INVALID_ARGUMENT",
          "set needs value (use clear to remove a property)",
        );
    }
    for (const t of targets) {
      const path = `Configurations[${t.index}].${key}`;
      const was = readValue(work, path);
      if (a.action === "set") {
        work.set(path, a.value as ScalarInput, a.quoted === undefined ? {} : { quoted: a.quoted });
      } else if (was === null) {
        warnings.push(`${t.platform || `#${t.index}`}: ${key} is not set, nothing to clear`);
        continue;
      } else {
        const e = work.resolve(path);
        if (e.kind !== "scalar")
          throw new MetaFileError(
            "UNSUPPORTED_TYPE",
            `${key} on ${t.platform} is a ${e.kind === "object" ? "block" : e.kind}; clear handles single-line properties`,
          );
        work.delete(path);
      }
      const now = readValue(work, path);
      changed.push({ path: `${t.platform || `#${t.index}`}.${key}`, before: was, after: now });
    }
    if (a.action === "clear" && changed.length === 0)
      throw new MetaFileError(
        "PATH_NOT_FOUND",
        `${key} is not set on ${targets.map((t) => t.platform).join(", ")}`,
      );
  } else {
    // setAncestor
    if (a.ancestor === undefined)
      throw new MetaFileError(
        "INVALID_ARGUMENT",
        "setAncestor needs ancestor (a reference, a platform name, or null to remove it)",
      );
    for (const t of targets) {
      const was = t.ancestor ? t.ancestor.value : null;
      if (a.ancestor === null || a.ancestor === "") {
        work = setAncestorIn(work, t.index, null);
      } else {
        const { text, value } = ancestorText(a.ancestor, t.platform);
        work = setAncestorIn(work, t.index, text);
        if (value.startsWith("{")) {
          const p = stripGuid(value);
          const here = root ? existsSync(resolve(root, p)) : false;
          const vfs = vfsOf(config);
          if (!here && !(vfs?.exists(p) ?? false))
            warnings.push(
              `${p} was not found in the project or the game data: check the reference`,
            );
        }
      }
      const v = viewMeta(work).configurations[t.index];
      changed.push({
        path: `${t.platform || `#${t.index}`}.ancestor`,
        before: was,
        after: v.ancestor ? v.ancestor.value : null,
      });
    }
  }

  // The edit must leave the file clean and every other configuration as it was.
  const out = work.toBytes();
  const after = parseCstBytes(out);
  const stillBlocked = writeBlocker(after, out);
  if (stillBlocked)
    throw new MetaFileError(
      "UNSUPPORTED_TYPE",
      `the edit would leave an unreadable meta (${stillBlocked}); nothing written`,
    );
  const afterView = viewMeta(after);
  const touched = new Set(targets.map((t) => t.index));
  const cycle = platformCycle(afterView, touched);
  if (cycle)
    throw new MetaFileError(
      "INVALID_ARGUMENT",
      `the edit would make a platform inherit from itself through ${cycle.join(" : ")}; nothing written`,
    );
  const keep = (v: MetaView) => ({
    guid: v.guid,
    resourcePath: v.resourcePath,
    extra: v.extra,
    n: v.configurations.length,
    others: v.configurations.filter((c) => !touched.has(c.index)),
  });
  if (!sameValue(keep(before), keep(afterView)))
    throw new MetaFileError(
      "UNSUPPORTED_TYPE",
      "the edit would change more than the named configurations; nothing written",
    );

  const real = changed.filter((c) => !sameValue(c.before, c.after));
  const text = after.text;
  const identical = out.equals(loc.bytes);
  const diff = unifiedDiff(`${loc.res}.meta`, orig.text, text);
  const willWrite = a.confirm === true && !identical;
  if (willWrite) {
    writeBusyTolerant(file, out);
    const back = readFileSync(file);
    if (!back.equals(out)) {
      throw new MetaFileError("SAVE_FAILED", `${file} does not read back as written`);
    }
  }
  if (identical) warnings.push("the value is already as asked: the file is unchanged");
  return {
    ok: true,
    action: a.action,
    target: `path:${loc.res}`,
    changed: real.length ? real : changed,
    readback: {
      dryRun: a.confirm !== true,
      wrote: willWrite,
      file,
      diff,
      configurations: afterView.configurations,
    },
    next: willWrite
      ? "Workbench reads metas when it scans the project: reopen the resource or run wb_resources rebuild. The inverse is this action with the before value."
      : identical
        ? undefined
        : "Dry run, nothing written. Repeat with confirm: true to write exactly this change.",
    warnings,
  };
}

export function runMetaFile(a: MetaArgs, config: Config): MetaOk | MetaError {
  const target = a.path ? `path:${a.path}` : a.folder ? `path:${a.folder}` : "";
  try {
    const root = pinnedProjectRoot(a.projectPath, config.projectPath);
    if (a.action === "read") return doRead(a, root, config);
    if (a.action === "scan") return doScan(a, root);
    return doWrite(a, root, config);
  } catch (e) {
    return failure(a.action, target, e);
  }
}

// ── Registration ────────────────────────────────────────────────────────────

export function registerMetaFile(server: McpServer, config: Config): void {
  server.registerTool(
    "meta_file",
    {
      description:
        "Offline .meta sidecar tool; edits existing metas only (new resources: wb_resources register). " +
        "Actions: read (configurations, ancestors, properties), scan (paged list under folder), " +
        "set/clear (key, per configuration, default PC; allPlatforms for all), setAncestor. " +
        "path = the source file, not the .meta. Writes stay in the project; dry run unless confirm:true.",
      inputSchema: {
        action: z.enum(["read", "scan", "set", "clear", "setAncestor"]),
        path: z
          .string()
          .optional()
          .describe("The resource (source file), relative to the project."),
        folder: z.string().optional().describe("scan: folder under the project (default: all)."),
        ext: z.string().optional().describe("scan: only resources with this extension."),
        cursor: z.string().optional().describe("scan: cursor from the previous page."),
        limit: z.number().int().min(1).max(LIMIT_MAX).optional().describe("scan: page size."),
        configuration: z.string().optional().describe("Platform, such as PC (default) or PS5."),
        allPlatforms: z.boolean().optional().describe("Write every configuration."),
        key: z.string().optional().describe("set/clear: property name."),
        value: z
          .union([
            z.string(),
            z.number(),
            z.boolean(),
            z.array(z.union([z.string(), z.number(), z.boolean()])),
          ])
          .optional()
          .describe("set: the value."),
        quoted: z.boolean().optional().describe("set: force quotes on or off."),
        ancestor: z
          .string()
          .nullable()
          .optional()
          .describe('setAncestor: "{GUID}path", a platform name, or null to remove.'),
        confirm: z.boolean().optional().describe("true writes; otherwise a dry run."),
        projectPath: z
          .string()
          .optional()
          .describe("Addon root; the configured project when omitted."),
      },
    },
    async (args) => {
      const r = runMetaFile(args as MetaArgs, config);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(r, null, 2) }],
        isError: !r.ok,
      };
    },
  );
}

/**
 * Workbench holds a .meta open for a moment while it imports or rebuilds the resource (W2 run 5:
 * EBUSY on a texture .meta right after a register). The bytes go through write-then-rename (a
 * failed write leaves the .meta as it was: review round 1, F9) and a busy rename is tried again
 * for up to about two seconds (the same waits as before); a file still locked after that is the
 * caller's error to see.
 */
function writeBusyTolerant(file: string, bytes: Buffer): void {
  writeFileAtomic(file, bytes, { busyRetry: true });
}
