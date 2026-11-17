/**
 * `animation_set`: read, check and edit animation sets (`.ast` templates and
 * `.asi` instances) as files, offline.
 *
 * Both are Enfusion text, so the lossless parser in src/formats/enfusion-cst.ts
 * is the model: every edit splices the text and the bytes outside the edit
 * never change. A file the parser cannot give back byte for byte is refused.
 *
 * - `.ast` (`AnimSetTemplateSource`): groups, each with a `Name`, `Animations`
 *   and `Columns`. A slot is `Group.Column.Animation`.
 * - `.asi` (`AnimSetInstanceSource`): a `Template` (an `.ast`), optional
 *   `ParentTemplates` (`.asi`) and `IkPose` (`.anm`), `Lines` that map a slot
 *   to an `.anm`, and an empty `RBF` array.
 *
 * Reads take a file under the project root or a game resource (read from the
 * paks). Writes go inside the project root only, on an existing file unless
 * the action is `create`, and are a dry run (a unified diff) unless `confirm`
 * is true; a write keeps the old bytes beside the file as `<name>.bak`. A new
 * file is registered afterwards with `wb_resources register`: this tool writes
 * no `.meta`. Engine acceptance of the written files is probe P-W4-25.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { writeFileAtomic } from "../utils/atomic-write.js";
import { backUp, backupRel } from "../utils/backup.js";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { z } from "zod";
import type { Config } from "../config.js";
import {
  CstDocument,
  CstEditError,
  parseCstBytes,
  tokenValue,
  type CstEntry,
  type CstObject,
  type CstScalar,
} from "../formats/enfusion-cst.js";
import { generateGuid } from "../formats/guid.js";
import {
  LIMIT_DEFAULT,
  LIMIT_MAX,
  VocabularyError,
  checkCursor,
  checkRelativePath,
  errorResponse,
  nextCursor,
  parseCursor,
  type ActionOk,
  type ActionResponse,
  type Change,
  type ErrorCode,
} from "../manifest/vocabulary.js";
import { PakVirtualFS } from "../pak/vfs.js";
import { assertInsideRoot, pinnedProjectRoot } from "../utils/path-guard.js";
import { unifiedDiff } from "./imageset.js";

// ── Errors ───────────────────────────────────────────────────────────────────

/** A refusal with a vocabulary code. */
export class AnimationSetError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AnimationSetError";
  }
}

const bad = (message: string): never => {
  throw new AnimationSetError("INVALID_ARGUMENT", message);
};
const missing = (message: string): never => {
  throw new AnimationSetError("PATH_NOT_FOUND", message);
};

// ── Model ────────────────────────────────────────────────────────────────────

export type SetKind = "ast" | "asi";

const AST_ROOT = "AnimSetTemplateSource";
const ASI_ROOT = "AnimSetInstanceSource";
const GROUP_CLASS = "AnimSetTemplateSource_AnimationGroup";
const LINE_CLASS = "AnimSetInstanceSource_Line";
const RBF_CLASS = "AnimSetInstanceSourceRBFArray";

/** A resource reference as written: `{16-hex GUID}path` or a bare path. */
export interface RefView {
  raw: string;
  guid?: string;
  path: string;
}

export interface GroupView {
  /** Position among the entries of the `Groups` block (the path index). */
  index: number;
  guid?: string;
  name: string;
  columns: string[];
  animations: string[];
}

export interface AstView {
  groups: GroupView[];
  hasGroups: boolean;
}

export interface MappingView {
  /** Position among the entries of the `Lines` block (the path index). */
  index: number;
  slot: string;
  resource?: RefView;
}

export interface AsiView {
  objectGuid?: string;
  template?: RefView;
  parentTemplates: RefView[];
  ikPose?: RefView;
  lines: MappingView[];
  hasLines: boolean;
  rbf?: { className: string; guid?: string; entries: number };
}

const GUID_REF = /^\{([0-9A-Fa-f]{16})\}([^"\r\n{}]*)$/;

export function parseRef(raw: string): RefView {
  const t = raw.trim();
  const m = GUID_REF.exec(t);
  return m ? { raw: t, guid: m[1].toUpperCase(), path: m[2] } : { raw: t, path: t };
}

function scalarOf(o: CstObject, key: string): CstScalar | undefined {
  return o.children.find((c): c is CstScalar => c.kind === "scalar" && c.key === key);
}

function blockOf(o: CstObject, key: string): CstObject | undefined {
  return o.children.find((c): c is CstObject => c.kind === "object" && c.key === key);
}

const firstValue = (s: CstScalar | undefined): string | undefined =>
  s && s.values.length ? tokenValue(s.values[0]) : undefined;

const headGuid = (o: CstObject): string | undefined => {
  const t = o.head[1];
  if (!t) return undefined;
  const m = /^\{?([0-9A-Fa-f]{16})\}?$/.exec(tokenValue(t));
  return m ? m[1].toUpperCase() : undefined;
};

/** The one top-level block of the document, or undefined. */
function rootOf(doc: CstDocument): CstObject | undefined {
  const kids = doc.root.children;
  if (kids.length !== 1) return undefined;
  const k = kids[0];
  return k.kind === "object" ? k : undefined;
}

/** What kind of set the document is, by its root class. */
export function kindOfRoot(doc: CstDocument): SetKind | undefined {
  const r = rootOf(doc);
  if (r?.key === AST_ROOT) return "ast";
  if (r?.key === ASI_ROOT) return "asi";
  return undefined;
}

function valuesOfBlock(b: CstObject | undefined): string[] {
  const out: string[] = [];
  for (const c of b?.children ?? []) {
    if (c.kind === "value" && c.values.length) out.push(tokenValue(c.values[0]));
  }
  return out;
}

export function viewAst(doc: CstDocument): AstView {
  const root = rootOf(doc);
  if (!root || root.key !== AST_ROOT)
    return bad(`not an animation set template: the file is not one ${AST_ROOT} block`);
  const gb = blockOf(root, "Groups");
  const groups: GroupView[] = [];
  gb?.children.forEach((c, index) => {
    if (c.kind !== "object" || c.key !== GROUP_CLASS) return;
    groups.push({
      index,
      guid: headGuid(c),
      name: firstValue(scalarOf(c, "Name")) ?? "",
      columns: valuesOfBlock(blockOf(c, "Columns")),
      animations: valuesOfBlock(blockOf(c, "Animations")),
    });
  });
  return { groups, hasGroups: gb !== undefined };
}

export function viewAsi(doc: CstDocument): AsiView {
  const root = rootOf(doc);
  if (!root || root.key !== ASI_ROOT)
    return bad(`not an animation set instance: the file is not one ${ASI_ROOT} block`);
  const tpl = firstValue(scalarOf(root, "Template"));
  const ik = firstValue(scalarOf(root, "IkPose"));
  const lb = blockOf(root, "Lines");
  const lines: MappingView[] = [];
  lb?.children.forEach((c, index) => {
    if (c.kind !== "object" || c.key !== LINE_CLASS) return;
    const res = firstValue(scalarOf(c, "Resource"));
    lines.push({
      index,
      slot: c.head[1] ? tokenValue(c.head[1]) : "",
      resource: res === undefined ? undefined : parseRef(res),
    });
  });
  const rb = blockOf(root, "RBF");
  // `RBF Class "{GUID}" {`: the class is the second header word, the GUID the third.
  const rg = rb?.head[2] ? /^\{?([0-9A-Fa-f]{16})\}?$/.exec(tokenValue(rb.head[2])) : null;
  return {
    objectGuid: headGuid(root),
    template: tpl === undefined ? undefined : parseRef(tpl),
    parentTemplates: valuesOfBlock(blockOf(root, "ParentTemplates")).map(parseRef),
    ikPose: ik === undefined ? undefined : parseRef(ik),
    lines,
    hasLines: lb !== undefined,
    rbf: rb
      ? {
          className: rb.head[1] ? tokenValue(rb.head[1]) : "",
          guid: rg ? rg[1].toUpperCase() : undefined,
          entries: rb.children.length,
        }
      : undefined,
  };
}

function hasOpaque(entries: CstEntry[]): boolean {
  return entries.some((e) => e.kind === "opaque" || (e.kind === "object" && hasOpaque(e.children)));
}

/** Why the writer would refuse these bytes as a set of `kind`, or undefined when it would keep them. */
export function unwritableReason(buf: Buffer, kind?: SetKind): string | undefined {
  let doc: CstDocument;
  try {
    doc = parseCstBytes(buf);
  } catch (e) {
    return `not readable as text: ${e instanceof Error ? e.message : String(e)}`;
  }
  if (Buffer.compare(doc.toBytes(), buf) !== 0)
    return "its bytes do not come back identically (encoding or a stray byte)";
  if (doc.diagnostics.length) return `the parser flagged it: ${doc.diagnostics[0].message}`;
  const found = kindOfRoot(doc);
  if (!found) return `it is not one ${AST_ROOT} or ${ASI_ROOT} block`;
  if (kind && found !== kind)
    return `it is ${found === "ast" ? AST_ROOT : ASI_ROOT}, not ${kind === "ast" ? AST_ROOT : ASI_ROOT}`;
  if (!rootOf(doc)!.close) return "the root block is not closed";
  if (hasOpaque(doc.root.children)) return "it holds text the parser could not place";
  return undefined;
}

// ── Names and arguments ──────────────────────────────────────────────────────

/** A group, column or animation name: no dot (the slot separator), quote, backslash or control character. */
export function cleanPart(raw: string | undefined, what: string): string {
  if (typeof raw !== "string" || raw === "") return bad(`${what} is required`);
  if (/["\\\x00-\x1f\x7f.]/.test(raw) || raw !== raw.trim() || raw.length > 64)
    return bad(
      `${what} must be 1 to 64 characters with no dot, quote, backslash, control character or edge blank, got "${raw}"`,
    );
  return raw;
}

function cleanNames(raw: string[] | undefined, what: string): string[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return bad(`${what} must be a list of names`);
  const out = raw.map((x) => cleanPart(x, what));
  if (new Set(out).size !== out.length) bad(`${what} names a name twice`);
  return out;
}

export interface SetArgs {
  group?: string;
  column?: string;
  animation?: string;
  columns?: string[];
  animations?: string[];
  slot?: string;
  /** map: the `.anm` as `{GUID}path` or a path. */
  resource?: string;
  resourceGuid?: string;
  /** create asi: the `.ast`. */
  template?: string;
  parentTemplates?: string[];
  ikPose?: string;
  filter?: string;
}

/** `Group.Column.Animation` from `slot` or from the three parts. */
export function slotOf(a: SetArgs): {
  slot: string;
  group: string;
  column: string;
  animation: string;
} {
  if (a.slot !== undefined) {
    const parts = a.slot.split(".");
    if (parts.length !== 3)
      return bad(`slot must be Group.Column.Animation (three names, two dots), got "${a.slot}"`);
    const [group, column, animation] = parts.map((p, i) =>
      cleanPart(p, ["slot group", "slot column", "slot animation"][i]),
    );
    return { slot: `${group}.${column}.${animation}`, group, column, animation };
  }
  const group = cleanPart(a.group, "group");
  const column = cleanPart(a.column, "column");
  const animation = cleanPart(a.animation, "animation");
  return { slot: `${group}.${column}.${animation}`, group, column, animation };
}

/** Every slot of a template: the product of each group's columns and animations. */
export function slotsOf(ast: AstView): Set<string> {
  const s = new Set<string>();
  for (const g of ast.groups)
    for (const c of g.columns) for (const a of g.animations) s.add(`${g.name}.${c}.${a}`);
  return s;
}

// ── Editing ──────────────────────────────────────────────────────────────────

export interface OpResult {
  changes: Change[];
  warnings: string[];
}

/** A document handle the ops replace the text of. */
export interface Work {
  doc: CstDocument;
}

const ASI_ORDER = ["Template", "ParentTemplates", "IkPose", "Lines", "RBF"];

function findGroup(w: Work, name: string): GroupView {
  const view = viewAst(w.doc);
  const g = view.groups.find((x) => x.name === name);
  if (!g)
    return missing(
      `no group "${name}" (groups: ${view.groups.map((x) => x.name).join(", ") || "none"}); addGroup makes one`,
    );
  return g;
}

function dupWarnings(values: string[], what: string): string[] {
  const seen = new Set<string>();
  const w: string[] = [];
  for (const v of values) {
    if (seen.has(v)) w.push(`duplicate ${what} "${v}"`);
    seen.add(v);
  }
  return w;
}

/** Adds a group with its (possibly empty) columns and animations. */
export function addGroup(w: Work, a: SetArgs): OpResult {
  const name = cleanPart(a.group, "group");
  const columns = cleanNames(a.columns, "columns");
  const animations = cleanNames(a.animations, "animations");
  const view = viewAst(w.doc);
  if (view.groups.some((g) => g.name === name))
    throw new AnimationSetError("DUPLICATE_ID", `a group named "${name}" already exists`);
  if (!view.hasGroups) w.doc.createObject("", { key: "Groups" });
  const guid = generateGuid();
  w.doc.createObject("Groups", {
    key: GROUP_CLASS,
    guid,
    entries: [
      { key: "Name", value: name, quoted: true },
      {
        object: { key: "Animations", entries: animations.map((v) => ({ value: v, quoted: true })) },
      },
      { object: { key: "Columns", entries: columns.map((v) => ({ value: v, quoted: true })) } },
    ],
  });
  return {
    changes: [
      {
        path: `group:${name}`,
        before: null,
        after: { guid, columns, animations, slots: columns.length * animations.length },
      },
    ],
    warnings: [],
  };
}

function addToGroup(
  w: Work,
  groupName: string,
  key: "Columns" | "Animations",
  name: string,
): OpResult {
  const g = findGroup(w, groupName);
  const list = key === "Columns" ? g.columns : g.animations;
  if (list.includes(name))
    throw new AnimationSetError(
      "DUPLICATE_ID",
      `group "${groupName}" already has ${key === "Columns" ? "column" : "animation"} "${name}"`,
    );
  w.doc.arrayAdd(`Groups[${g.index}].${key}`, { value: name, quoted: true });
  const other = key === "Columns" ? g.animations.length : g.columns.length;
  return {
    changes: [
      {
        path: `group:${groupName}.${key === "Columns" ? "column" : "animation"}:${name}`,
        before: null,
        after: { newSlots: other },
      },
    ],
    warnings:
      other === 0
        ? [
            `group "${groupName}" has no ${key === "Columns" ? "animations" : "columns"} yet, so this adds no slot`,
          ]
        : [],
  };
}

export function addColumn(w: Work, a: SetArgs): OpResult {
  return addToGroup(w, cleanPart(a.group, "group"), "Columns", cleanPart(a.column, "column"));
}

export function addAnimation(w: Work, a: SetArgs): OpResult {
  return addToGroup(
    w,
    cleanPart(a.group, "group"),
    "Animations",
    cleanPart(a.animation, "animation"),
  );
}

/** Inverse of `addGroup` (not an action: used by the identity tests). Drops an emptied `Groups` block. */
export function removeGroup(w: Work, name: string): OpResult {
  const g = findGroup(w, name);
  w.doc.arrayRemove("Groups", g.index);
  if (
    viewAst(w.doc).groups.length === 0 &&
    blockOf(rootOf(w.doc)!, "Groups")?.children.length === 0
  )
    w.doc.delete("Groups");
  return {
    changes: [{ path: `group:${name}`, before: { guid: g.guid }, after: null }],
    warnings: [],
  };
}

/** Inverse of `addColumn` and `addAnimation` (not actions: used by the identity tests). */
export function removeFromGroup(
  w: Work,
  groupName: string,
  key: "Columns" | "Animations",
  name: string,
): OpResult {
  const g = findGroup(w, groupName);
  const block = blockOf(rootOf(w.doc)!, "Groups")!.children[g.index] as CstObject;
  const b = blockOf(block, key)!;
  const at = b.children.findIndex((c) => c.kind === "value" && tokenValue(c.values[0]) === name);
  if (at < 0) throw new AnimationSetError("ITEM_NOT_FOUND", `group "${groupName}" has no ${name}`);
  w.doc.arrayRemove(`Groups[${g.index}].${key}`, at);
  return {
    changes: [{ path: `group:${groupName}.${key}:${name}`, before: name, after: null }],
    warnings: [],
  };
}

function ensureBlock(w: Work, key: string): void {
  const r = rootOf(w.doc)!;
  if (blockOf(r, key)) return;
  const rank = ASI_ORDER.indexOf(key);
  let at = 0;
  r.children.forEach((c, i) => {
    if (c.kind !== "opaque" && ASI_ORDER.indexOf((c as CstObject | CstScalar).key) < rank)
      at = i + 1;
  });
  w.doc.createObject("", { key }, at >= r.children.length ? undefined : at);
}

/** Maps `slot` to the `.anm` written as `value` (`{GUID}path`): adds the line, or changes its `Resource`. */
export function mapSlot(w: Work, slot: string, value: string): OpResult {
  const view = viewAsi(w.doc);
  const hit = view.lines.find((l) => l.slot === slot);
  const warnings: string[] = [];
  if (hit) {
    if (hit.resource?.raw === value) {
      return {
        changes: [],
        warnings: [`slot "${slot}" already maps to that resource: nothing to change`],
      };
    }
    w.doc.set(`Lines[${hit.index}].Resource`, value, { quoted: true });
    return {
      changes: [{ path: `slot:${slot}`, before: hit.resource?.raw ?? null, after: value }],
      warnings,
    };
  }
  ensureBlock(w, "Lines");
  w.doc.createObject("Lines", {
    key: LINE_CLASS,
    name: slot,
    entries: [{ key: "Resource", value, quoted: true }],
  });
  return { changes: [{ path: `slot:${slot}`, before: null, after: value }], warnings };
}

/** Removes the mapping of `slot`; an emptied `Lines` block goes with it (no vanilla file keeps one). */
export function unmapSlot(w: Work, slot: string): OpResult {
  const view = viewAsi(w.doc);
  const hits = view.lines.filter((l) => l.slot === slot);
  if (hits.length === 0)
    throw new AnimationSetError(
      "ITEM_NOT_FOUND",
      `no mapping for slot "${slot}" (${view.lines.length} mapping(s); read lists them)`,
    );
  w.doc.arrayRemove("Lines", hits[0].index);
  if (blockOf(rootOf(w.doc)!, "Lines")?.children.length === 0) w.doc.delete("Lines");
  return {
    changes: [{ path: `slot:${slot}`, before: hits[0].resource?.raw ?? null, after: null }],
    warnings:
      hits.length > 1
        ? [`slot "${slot}" was mapped ${hits.length} times: the first was removed`]
        : [],
  };
}

// ── Skeletons ────────────────────────────────────────────────────────────────

/** A new template, in the shape of the vanilla files (one-space indent, LF, no final line ending). */
export function astSkeleton(): string {
  return `${AST_ROOT} {\n}`;
}

/** A new instance with its object GUID and an empty RBF array, as most vanilla files have. */
export function asiSkeleton(
  objectGuid: string = generateGuid(),
  rbfGuid: string = generateGuid(),
): string {
  return `${ASI_ROOT} "{${objectGuid}}" {\n ${"RBF"} ${RBF_CLASS} "{${rbfGuid}}" {\n }\n}`;
}

// ── Where files are ──────────────────────────────────────────────────────────

/** The two game-data calls the tool needs; a test passes a fake. */
export interface GameFiles {
  exists(path: string): boolean;
  readFile(path: string): Buffer;
}

export interface Deps {
  /** Game data; omitted = the paks of `config.gamePath`, null = none. */
  game?: GameFiles | null;
}

interface Ctx {
  root?: string;
  game: GameFiles | null;
  astCache: Map<string, AstView | null>;
}

function gameOf(config: Config): GameFiles | null {
  try {
    return config.gamePath ? PakVirtualFS.get(config.gamePath) : null;
  } catch {
    return null;
  }
}

interface Located {
  /** Resource path, forward slashes. */
  rel: string;
  file?: string;
  root?: string;
}

/** A project-relative path from a relative path, a `{GUID}` path or an absolute path inside the project. */
function relOf(rawPath: string, root: string | undefined): string {
  let p = String(rawPath ?? "")
    .trim()
    .replace(/^\{[0-9A-Fa-f]{16}\}/, "");
  if (p.startsWith("-")) bad("paths starting with '-' are rejected");
  if (isAbsolute(p) || /^[A-Za-z]:/.test(p)) {
    if (!root)
      throw new AnimationSetError(
        "NOT_IN_PROJECT",
        "no project root is configured for an absolute path",
      );
    const rel = relative(root, resolve(p));
    if (rel === "" || isAbsolute(rel) || rel.split(/[\\/]/)[0] === "..")
      throw new AnimationSetError("NOT_IN_PROJECT", `${rawPath} is outside the project ${root}`);
    p = rel.replace(/\\/g, "/");
  }
  return checkRelativePath(p);
}

function extOf(rel: string): string {
  const i = rel.lastIndexOf(".");
  return i < 0 ? "" : rel.slice(i).toLowerCase();
}

function locate(rawPath: string, projectPath: string | undefined): Located & { kind: SetKind } {
  const root = projectPath ? resolve(projectPath) : undefined;
  const rel = relOf(rawPath, root);
  const ext = extOf(rel);
  if (ext !== ".ast" && ext !== ".asi") bad(`"${rel}" is not an .ast or .asi file`);
  const kind: SetKind = ext === ".ast" ? "ast" : "asi";
  if (!root) return { rel, kind };
  const file = resolve(root, rel);
  try {
    assertInsideRoot(file, root, "path");
  } catch (e) {
    throw new AnimationSetError("NOT_IN_PROJECT", e instanceof Error ? e.message : String(e));
  }
  return { rel, file, root, kind };
}

interface Loaded {
  buf: Buffer;
  /** True when read from the game paks (never written). */
  game: boolean;
}

function readFrom(loc: Located, ctx: Ctx): Loaded {
  if (loc.file && existsSync(loc.file)) {
    if (!statSync(loc.file).isFile()) return bad(`${loc.rel} is not a file`);
    return { buf: readFileSync(loc.file), game: false };
  }
  if (ctx.game?.exists(loc.rel)) return { buf: ctx.game.readFile(loc.rel), game: true };
  return missing(
    `no animation set at "${loc.rel}": not a file${loc.root ? ` under ${loc.root}` : ""} and not in the game data` +
      (ctx.game ? "" : " (game paks not available: ENFUSION_GAME_PATH)"),
  );
}

/** Where a resource path lives: the project, the game data, or nowhere. */
function findResource(
  ctx: Ctx,
  path: string,
): { source: "project" | "game"; file?: string } | undefined {
  if (ctx.root) {
    let file: string | undefined;
    try {
      file = resolve(ctx.root, checkRelativePath(path));
    } catch {
      file = undefined;
    }
    if (file && existsSync(file) && statSync(file).isFile()) return { source: "project", file };
  }
  if (ctx.game) {
    try {
      if (ctx.game.exists(checkRelativePath(path))) return { source: "game" };
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** The GUID a project `.meta` beside the file names, when there is one. */
function metaGuid(file: string): string | undefined {
  try {
    const text = readFileSync(`${file}.meta`, "utf-8");
    const m = /^\s*Name\s+"\{([0-9A-Fa-f]{16})\}/m.exec(text);
    return m ? m[1].toUpperCase() : undefined;
  } catch {
    return undefined;
  }
}

function loadAst(ref: RefView, ctx: Ctx): AstView | null {
  const key = ref.path.toLowerCase();
  const cached = ctx.astCache.get(key);
  if (cached !== undefined) return cached;
  let view: AstView | null = null;
  const found = findResource(ctx, ref.path);
  try {
    if (found?.source === "project" && found.file)
      view = viewAst(parseCstBytes(readFileSync(found.file)));
    else if (found?.source === "game") view = viewAst(parseCstBytes(ctx.game!.readFile(ref.path)));
  } catch {
    view = null;
  }
  ctx.astCache.set(key, view);
  return view;
}

// ── Resolving a reference to write ───────────────────────────────────────────

interface Resolved {
  value: string;
  guid: string;
  path: string;
  warnings: string[];
}

/**
 * The `{GUID}path` to write for a reference the caller gave: its own GUID, else
 * `explicitGuid`, else the GUID of the project `.meta` beside the file. A
 * game file has no `.meta` in the paks, so its GUID must be given.
 */
function resolveForWrite(
  raw: string | undefined,
  what: string,
  ext: string,
  ctx: Ctx,
  explicitGuid?: string,
): Resolved {
  if (typeof raw !== "string" || raw.trim() === "") return bad(`${what} is required`);
  const ref = parseRef(raw);
  const rel = relOf(ref.path, ctx.root);
  if (extOf(rel) !== ext) bad(`${what} must be a ${ext} file, got "${rel}"`);
  let guid = ref.guid;
  if (guid === undefined && explicitGuid !== undefined) {
    const m = /^\{?([0-9A-Fa-f]{16})\}?$/.exec(explicitGuid.trim());
    if (!m) return bad(`resourceGuid must be 16 hex digits, got "${explicitGuid}"`);
    guid = m[1].toUpperCase();
  }
  const found = findResource(ctx, rel);
  const warnings: string[] = [];
  const fromMeta = found?.source === "project" && found.file ? metaGuid(found.file) : undefined;
  if (guid !== undefined && fromMeta !== undefined && guid !== fromMeta)
    return bad(`${what} GUID {${guid}} differs from the GUID {${fromMeta}} in its .meta`);
  guid ??= fromMeta;
  if (guid === undefined)
    return bad(
      `${what} "${rel}" has no GUID: write it as {16-hex GUID}path (resolve_guid or wb_resources find it), or pass resourceGuid; the project .meta beside it is read when there is one`,
    );
  if (!found) {
    if (ctx.game)
      throw new AnimationSetError(
        "RESOURCE_NOT_FOUND",
        `${what} "${rel}" is neither a file of the project nor game data`,
      );
    warnings.push(`${what} "${rel}" was not checked: no game data is available`);
  }
  return { value: `{${guid}}${rel}`, guid, path: rel, warnings };
}

// ── Validation ───────────────────────────────────────────────────────────────

export interface Issue {
  level: "error" | "warning";
  at: string;
  message: string;
}

export function validateAst(ast: AstView): Issue[] {
  const out: Issue[] = [];
  const names = new Set<string>();
  ast.groups.forEach((g, i) => {
    const at = `group:${g.name || `[${i}]`}`;
    if (g.name === "") out.push({ level: "error", at, message: "the group has no Name" });
    else if (g.name.includes("."))
      out.push({
        level: "error",
        at,
        message: "the group name holds a dot, so no slot can name it",
      });
    if (names.has(g.name)) out.push({ level: "warning", at, message: "duplicate group name" });
    names.add(g.name);
    for (const m of dupWarnings(g.columns, "column"))
      out.push({ level: "warning", at, message: m });
    for (const m of dupWarnings(g.animations, "animation"))
      out.push({ level: "warning", at, message: m });
    for (const v of [...g.columns, ...g.animations])
      if (v.includes("."))
        out.push({ level: "error", at, message: `"${v}" holds a dot, so no slot can name it` });
    if (g.columns.length === 0)
      out.push({ level: "warning", at, message: "the group has no columns" });
    if (g.animations.length === 0)
      out.push({ level: "warning", at, message: "the group has no animations" });
  });
  return out;
}

function checkRef(
  ref: RefView,
  ext: string,
  at: string,
  ctx: Ctx,
  out: Issue[],
  counts: { unverified: number },
): void {
  if (extOf(ref.path) !== ext)
    out.push({ level: "error", at, message: `"${ref.path}" should be a ${ext} file` });
  if (ref.guid === undefined)
    out.push({
      level: "warning",
      at,
      message: `"${ref.path}" has no GUID: the engine resolves a resource by its GUID`,
    });
  const found = findResource(ctx, ref.path);
  if (!found) {
    if (ctx.game)
      out.push({
        level: "error",
        at,
        message: `"${ref.path}" does not resolve: no such file in the project or the game data`,
      });
    else
      out.push({
        level: "warning",
        at,
        message: `"${ref.path}" not checked: no game data is available`,
      });
    return;
  }
  if (found.source === "project" && found.file && ref.guid !== undefined) {
    const g = metaGuid(found.file);
    if (g !== undefined && g !== ref.guid)
      out.push({
        level: "error",
        at,
        message: `GUID {${ref.guid}} differs from the GUID {${g}} in the .meta of "${ref.path}"`,
      });
  } else if (found.source === "game") counts.unverified++;
}

export function validateAsi(
  asi: AsiView,
  ctx: Ctx,
): { issues: Issue[]; slotsChecked: boolean; unverifiedGuids: number } {
  const out: Issue[] = [];
  const counts = { unverified: 0 };
  let ast: AstView | null = null;
  if (!asi.template) {
    out.push({ level: "error", at: "Template", message: "the file has no Template" });
  } else {
    checkRef(asi.template, ".ast", "Template", ctx, out, counts);
    ast = extOf(asi.template.path) === ".ast" ? loadAst(asi.template, ctx) : null;
    if (!ast && !out.some((x) => x.at === "Template" && x.level === "error"))
      out.push({
        level: "warning",
        at: "Template",
        message: "the template could not be read, so the mapped slots are not checked",
      });
  }
  asi.parentTemplates.forEach((p, i) =>
    checkRef(p, ".asi", `ParentTemplates[${i}]`, ctx, out, counts),
  );
  if (asi.ikPose) checkRef(asi.ikPose, ".anm", "IkPose", ctx, out, counts);
  const slots = ast ? slotsOf(ast) : undefined;
  const seen = new Set<string>();
  for (const l of asi.lines) {
    const at = `slot:${l.slot}`;
    if (l.slot.split(".").length !== 3)
      out.push({ level: "error", at, message: "a slot is Group.Column.Animation" });
    else if (slots && !slots.has(l.slot))
      out.push({
        level: "error",
        at,
        message: `the template has no slot "${l.slot}" (group, column or animation missing)`,
      });
    if (seen.has(l.slot))
      out.push({ level: "warning", at, message: "the slot is mapped more than once" });
    seen.add(l.slot);
    if (!l.resource) out.push({ level: "error", at, message: "the mapping has no Resource" });
    else checkRef(l.resource, ".anm", at, ctx, out, counts);
  }
  return { issues: out, slotsChecked: slots !== undefined, unverifiedGuids: counts.unverified };
}

// ── Actions ──────────────────────────────────────────────────────────────────

export const WRITE_ACTIONS = [
  "addGroup",
  "addColumn",
  "addAnimation",
  "map",
  "unmap",
  "create",
] as const;
export type WriteAction = (typeof WRITE_ACTIONS)[number];

export interface AnimationSetRequest extends SetArgs {
  action: "read" | "validate" | WriteAction;
  path: string;
  projectPath?: string;
  confirm?: boolean;
  cursor?: string;
  limit?: number;
}

function okResponse(
  action: string,
  rel: string,
  changed: Change[] | null,
  readback: unknown,
  warnings: string[],
  next?: string,
  dryRun?: boolean,
): ActionOk & { dryRun?: boolean } {
  const r: ActionOk & { dryRun?: boolean } = {
    ok: true,
    action,
    target: `path:${rel}`,
    changed,
    readback,
    warnings,
  };
  if (next) r.next = next;
  if (dryRun !== undefined) r.dryRun = dryRun;
  return r;
}

const dropEmpty = <T extends object>(o: T) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

function pageOf<T>(req: AnimationSetRequest, pool: T[]) {
  const limit = Math.min(req.limit ?? LIMIT_DEFAULT, LIMIT_MAX);
  const cur = req.cursor === undefined ? { start: 0, count: pool.length } : parseCursor(req.cursor);
  if (req.cursor !== undefined) checkCursor(cur, pool.length);
  return {
    page: pool.slice(cur.start, cur.start + limit),
    next: nextCursor(cur.start, limit, pool.length),
  };
}

function refOut(r: RefView | undefined) {
  return r ? dropEmpty({ resource: r.raw, guid: r.guid, path: r.path }) : undefined;
}

function readAction(
  req: AnimationSetRequest,
  loc: Located & { kind: SetKind },
  ctx: Ctx,
): ActionResponse {
  const { buf, game } = readFrom(loc, ctx);
  const doc = parseCstBytes(buf);
  const kind = kindOfRoot(doc);
  if (kind !== loc.kind)
    return bad(
      `${loc.rel} is not an ${loc.kind} set (its root block is ${rootOf(doc)?.key ?? "missing"})`,
    );
  const warnings: string[] = [];
  const why = unwritableReason(buf, loc.kind);
  if (why) warnings.push(`this tool would refuse to edit the file: ${why}`);
  if (game) warnings.push("game resource (read only): game_duplicate copies it into the project");
  if (kind === "ast") {
    const view = viewAst(doc);
    const { page, next } = pageOf(req, view.groups);
    const slotCount = view.groups.reduce((n, g) => n + g.columns.length * g.animations.length, 0);
    for (const i of validateAst(view))
      if (i.level === "warning") warnings.push(`${i.at}: ${i.message}`);
    return okResponse(
      "read",
      loc.rel,
      null,
      {
        kind: "ast",
        source: game ? "game" : "project",
        bytes: buf.length,
        groupCount: view.groups.length,
        columnCount: view.groups.reduce((n, g) => n + g.columns.length, 0),
        animationCount: view.groups.reduce((n, g) => n + g.animations.length, 0),
        slotCount,
        groups: page.map((g) =>
          dropEmpty({
            name: g.name,
            guid: g.guid,
            columns: g.columns,
            animations: g.animations,
            slots: g.columns.length * g.animations.length,
          }),
        ),
        cursor: req.cursor,
        nextCursor: next,
      },
      warnings.slice(0, 50),
    );
  }
  const view = viewAsi(doc);
  const filter = req.filter?.toLowerCase();
  const pool = filter
    ? view.lines.filter((l) => l.slot.toLowerCase().includes(filter))
    : view.lines;
  const { page, next } = pageOf(req, pool);
  return okResponse(
    "read",
    loc.rel,
    null,
    {
      kind: "asi",
      source: game ? "game" : "project",
      bytes: buf.length,
      objectGuid: view.objectGuid,
      template: refOut(view.template),
      parentTemplates: view.parentTemplates.map(refOut),
      ikPose: refOut(view.ikPose),
      rbf: view.rbf,
      mappingCount: view.lines.length,
      matching: pool.length,
      mappings: page.map((l) => dropEmpty({ slot: l.slot, ...(refOut(l.resource) ?? {}) })),
      cursor: req.cursor,
      nextCursor: next,
    },
    warnings.slice(0, 50),
  );
}

function validateAction(
  req: AnimationSetRequest,
  loc: Located & { kind: SetKind },
  ctx: Ctx,
): ActionResponse {
  const { buf, game } = readFrom(loc, ctx);
  const doc = parseCstBytes(buf);
  if (kindOfRoot(doc) !== loc.kind)
    return bad(
      `${loc.rel} is not an ${loc.kind} set (its root block is ${rootOf(doc)?.key ?? "missing"})`,
    );
  let issues: Issue[];
  const extra: Record<string, unknown> = {};
  if (loc.kind === "ast") {
    issues = validateAst(viewAst(doc));
  } else {
    const r = validateAsi(viewAsi(doc), ctx);
    issues = r.issues;
    extra.slotsChecked = r.slotsChecked;
    extra.unverifiedGuids = r.unverifiedGuids;
  }
  const errors = issues.filter((i) => i.level === "error").length;
  const { page, next } = pageOf(req, issues);
  return okResponse(
    "validate",
    loc.rel,
    null,
    {
      kind: loc.kind,
      source: game ? "game" : "project",
      valid: errors === 0,
      errors,
      warnings: issues.length - errors,
      ...extra,
      issues: page,
      cursor: req.cursor,
      nextCursor: next,
    },
    [],
    extra.unverifiedGuids
      ? "A game resource is found by path; its GUID cannot be checked (the paks hold no .meta)."
      : undefined,
  );
}

function commit(
  req: AnimationSetRequest,
  loc: Located,
  before: string,
  w: Work,
  op: OpResult,
  creating: boolean,
  kind: SetKind,
): ActionResponse {
  const after = w.doc.serialize();
  const bytes = w.doc.toBytes();
  const why = unwritableReason(bytes, kind);
  if (why)
    throw new AnimationSetError(
      "INVALID_ARGUMENT",
      `the edit would produce a file the writer cannot keep: ${why}`,
    );
  const diff = unifiedDiff(before, after, loc.rel);
  const confirmed = req.confirm === true;
  if (!confirmed || (!creating && before === after)) {
    return okResponse(
      req.action,
      loc.rel,
      op.changes,
      { diff, bytesBefore: Buffer.byteLength(before), bytesAfter: bytes.length },
      op.warnings,
      confirmed ? undefined : "Run again with confirm: true to write exactly this change.",
      !confirmed,
    );
  }
  const file = loc.file!;
  let backup: string | undefined;
  if (creating) {
    mkdirSync(dirname(file), { recursive: true });
    try {
      writeFileSync(file, bytes, { flag: "wx" });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EEXIST")
        throw new AnimationSetError(
          "INVALID_ARGUMENT",
          `${loc.rel} already exists; create makes only new files`,
        );
      throw e;
    }
  } else {
    if (Buffer.compare(readFileSync(file), Buffer.from(before, w.doc.encoding)) !== 0)
      throw new AnimationSetError(
        "INVALID_ARGUMENT",
        `${loc.rel} changed on disk since it was read; nothing written, read it again`,
      );
    // A numbered backup: an earlier .bak (the first original bytes) is kept (review round 1, W4-AS-1).
    const b = backUp(file, (m) => {
      throw new AnimationSetError("INVALID_ARGUMENT", m);
    });
    backup = backupRel(loc.rel, file, b);
    writeFileAtomic(file, bytes);
  }
  const back = readFileSync(file);
  if (Buffer.compare(back, bytes) !== 0)
    return errorResponse(
      req.action,
      `path:${loc.rel}`,
      "SAVE_FAILED",
      "the file read back differs from what was written",
    );
  const doc = parseCstBytes(back);
  const summary =
    kind === "ast"
      ? (() => {
          const v = viewAst(doc);
          return { groups: v.groups.length, slots: slotsOf(v).size };
        })()
      : (() => {
          const v = viewAsi(doc);
          return { mappings: v.lines.length, template: v.template?.raw };
        })();
  return okResponse(
    req.action,
    loc.rel,
    op.changes,
    dropEmpty({ diff, bytes: back.length, backup, ...summary }),
    op.warnings,
    creating
      ? "A new file is not yet known to the engine: register it with wb_resources register."
      : "An open editor keeps its own copy of the set: reopen it there, and do not save the old tab over this file.",
    false,
  );
}

function createWork(req: AnimationSetRequest, kind: SetKind, ctx: Ctx): { w: Work; op: OpResult } {
  if (kind === "ast") {
    const w: Work = { doc: new CstDocument(astSkeleton()) };
    const op: OpResult = {
      changes: [{ path: "file", before: null, after: { kind } }],
      warnings: [],
    };
    if (req.group !== undefined) {
      const g = addGroup(w, req);
      op.changes.push(...g.changes);
    } else if (req.columns !== undefined || req.animations !== undefined)
      bad("columns and animations need a group to hold them");
    return { w, op };
  }
  const tpl = resolveForWrite(req.template, "template", ".ast", ctx, req.resourceGuid);
  const parents = (req.parentTemplates ?? []).map((p, i) =>
    resolveForWrite(p, `parentTemplates[${i}]`, ".asi", ctx),
  );
  const ik =
    req.ikPose === undefined ? undefined : resolveForWrite(req.ikPose, "ikPose", ".anm", ctx);
  const w: Work = { doc: new CstDocument(asiSkeleton()) };
  const warnings = [tpl, ...parents, ...(ik ? [ik] : [])].flatMap((r) => r.warnings);
  const changes: Change[] = [{ path: "file", before: null, after: { kind } }];
  // Template, ParentTemplates, IkPose, then Lines and RBF (the vanilla order); the skeleton holds RBF.
  let at = 0;
  w.doc.arrayAdd("", { key: "Template", value: tpl.value, quoted: true }, at++);
  changes.push({ path: "Template", before: null, after: tpl.value });
  if (parents.length) {
    w.doc.createObject(
      "",
      { key: "ParentTemplates", entries: parents.map((p) => ({ value: p.value, quoted: true })) },
      at++,
    );
    changes.push({ path: "ParentTemplates", before: null, after: parents.map((p) => p.value) });
  }
  if (ik) {
    w.doc.arrayAdd("", { key: "IkPose", value: ik.value, quoted: true }, at++);
    changes.push({ path: "IkPose", before: null, after: ik.value });
  }
  return { w, op: { changes, warnings } };
}

function writeAction(
  req: AnimationSetRequest,
  loc: Located & { kind: SetKind },
  ctx: Ctx,
): ActionResponse {
  if (!loc.file || !loc.root)
    throw new AnimationSetError(
      "NOT_IN_PROJECT",
      "writes need a project path (ENFUSION_PROJECT_PATH or projectPath)",
    );
  const kind = loc.kind;
  if (req.action === "create") {
    if (existsSync(loc.file))
      throw new AnimationSetError(
        "INVALID_ARGUMENT",
        `${loc.rel} already exists; create makes only new files`,
      );
    const { w, op } = createWork(req, kind, ctx);
    return commit(req, loc, "", w, op, true, kind);
  }
  const wantsKind: SetKind = req.action === "map" || req.action === "unmap" ? "asi" : "ast";
  if (kind !== wantsKind)
    return bad(`${req.action} edits an .${wantsKind} file, "${loc.rel}" is an .${kind}`);
  if (!existsSync(loc.file)) {
    if (ctx.game?.exists(loc.rel))
      throw new AnimationSetError(
        "NOT_IN_PROJECT",
        `${loc.rel} is game data (read only): copy it into the project with game_duplicate, then edit the copy`,
      );
    return missing(`no animation set at ${loc.rel} under ${loc.root}; create makes a new one`);
  }
  if (!statSync(loc.file).isFile()) return bad(`${loc.rel} is not a file`);
  const buf = readFileSync(loc.file);
  const why = unwritableReason(buf, kind);
  if (why)
    throw new AnimationSetError(
      "INVALID_ARGUMENT",
      `${loc.rel} is left alone: this writer cannot keep it byte for byte (${why}). Edit it in the Animation Editor.`,
    );
  const w: Work = { doc: parseCstBytes(buf) };
  const before = w.doc.serialize();
  let op: OpResult;
  switch (req.action) {
    case "addGroup":
      op = addGroup(w, req);
      break;
    case "addColumn":
      op = addColumn(w, req);
      break;
    case "addAnimation":
      op = addAnimation(w, req);
      break;
    case "map": {
      const s = slotOf(req);
      const res = resolveForWrite(req.resource, "resource", ".anm", ctx, req.resourceGuid);
      const warnings = [...res.warnings];
      const tpl = viewAsi(w.doc).template;
      const ast = tpl ? loadAst(tpl, ctx) : null;
      if (ast) checkSlot(ast, s, tpl!.path);
      else warnings.push("the template could not be read, so the slot was not checked against it");
      op = mapSlot(w, s.slot, res.value);
      op.warnings.push(...warnings);
      break;
    }
    default:
      op = unmapSlot(w, slotOf(req).slot);
  }
  return commit(req, loc, before, w, op, false, kind);
}

/** Refuses a slot the template lacks, naming what the template does hold. */
function checkSlot(
  ast: AstView,
  s: { slot: string; group: string; column: string; animation: string },
  path: string,
): void {
  if (slotsOf(ast).has(s.slot)) return;
  const g = ast.groups.find((x) => x.name === s.group);
  let why: string;
  if (!g)
    why = `no group "${s.group}" (groups: ${ast.groups.map((x) => x.name).join(", ") || "none"})`;
  else if (!g.columns.includes(s.column))
    why = `group "${s.group}" has no column "${s.column}" (columns: ${g.columns.join(", ") || "none"})`;
  else
    why = `group "${s.group}" has no animation "${s.animation}" (animations: ${g.animations.join(", ") || "none"})`;
  throw new AnimationSetError(
    "INVALID_ARGUMENT",
    `the template ${path} has no slot "${s.slot}": ${why}. Add it to the template first (addGroup, addColumn, addAnimation).`,
  );
}

/** Runs one request; every refusal is an `ActionError`, never a throw. */
export function runAnimationSet(
  req: AnimationSetRequest,
  config: Config,
  deps: Deps = {},
): ActionResponse {
  try {
    const root = pinnedProjectRoot(req.projectPath, config.projectPath);
    const loc = locate(req.path, root);
    const ctx: Ctx = {
      root: loc.root ?? (root ? resolve(root) : undefined),
      game: deps.game === undefined ? gameOf(config) : deps.game,
      astCache: new Map(),
    };
    if (req.action === "read") return readAction(req, loc, ctx);
    if (req.action === "validate") return validateAction(req, loc, ctx);
    return writeAction(req, loc, ctx);
  } catch (e) {
    const target = `path:${String(req.path ?? "")}`;
    if (e instanceof AnimationSetError || e instanceof VocabularyError)
      return errorResponse(req.action, target, e.code, e.message);
    if (e instanceof CstEditError)
      return errorResponse(
        req.action,
        target,
        e.code === "PATH_NOT_FOUND" ? "PATH_NOT_FOUND" : "INVALID_ARGUMENT",
        e.message,
      );
    return errorResponse(
      req.action,
      target,
      "HANDLER_ERROR",
      e instanceof Error ? e.message : String(e),
    );
  }
}

// ── Registration ─────────────────────────────────────────────────────────────

export const TOOL_NAME = "animation_set";

export const DESCRIPTION =
  "Read, check and edit animation sets offline, byte-exact: .ast (groups, columns, animations) and .asi (template, slot-to-.anm mappings, parents, IK pose). " +
  "Actions: read (paged), validate (slots the .ast lacks, unresolved .anm), addGroup, addColumn, addAnimation, map, unmap, create. " +
  "Writes stay in the project, are a dry run unless confirm: true, keep a .bak; new files need wb_resources register.";

export function registerAnimationSet(server: McpServer, config: Config, deps: Deps = {}): void {
  server.registerTool(
    "animation_set", // TOOL_NAME, written out for the E11 census ref
    {
      description: DESCRIPTION,
      inputSchema: {
        action: z.enum(["read", "validate", ...WRITE_ACTIONS]),
        path: z
          .string()
          .describe(
            "The .ast or .asi: project-relative, absolute inside the project, or (read, validate) a game path.",
          ),
        projectPath: z
          .string()
          .optional()
          .describe("Addon root. Uses the configured project when omitted."),
        confirm: z
          .boolean()
          .optional()
          .describe("Write the change. Without it the call is a dry run."),
        group: z
          .string()
          .optional()
          .describe(
            "addGroup/addColumn/addAnimation/map/unmap: group name; create .ast: first group.",
          ),
        column: z.string().optional().describe("addColumn/map/unmap: column name."),
        animation: z.string().optional().describe("addAnimation/map/unmap: animation name."),
        columns: z
          .array(z.string())
          .optional()
          .describe("addGroup, create .ast: the group's columns."),
        animations: z
          .array(z.string())
          .optional()
          .describe("addGroup, create .ast: the group's animations."),
        slot: z
          .string()
          .optional()
          .describe("map/unmap: Group.Column.Animation, instead of group, column and animation."),
        resource: z
          .string()
          .optional()
          .describe("map: the .anm, {GUID}path or a path with a known GUID."),
        resourceGuid: z
          .string()
          .optional()
          .describe("map/create: 16-hex GUID of resource or template when the path has none."),
        template: z.string().optional().describe("create .asi: the .ast it instances."),
        parentTemplates: z.array(z.string()).optional().describe("create .asi: parent .asi files."),
        ikPose: z.string().optional().describe("create .asi: the IK pose .anm."),
        filter: z.string().optional().describe("read .asi: keep slots that contain this text."),
        cursor: z.string().optional().describe("read, validate: cursor from the last page."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(LIMIT_MAX)
          .optional()
          .describe("read, validate: items per page."),
      },
    },
    async (args) => {
      const r = runAnimationSet(args as AnimationSetRequest, config, deps);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(r, null, 2) }],
        isError: !r.ok,
      };
    },
  );
}
