/**
 * `imageset`: read and edit `.imageset` files (UI icon atlases) as files.
 *
 * An imageset is Enfusion text (`ImageSetClass` with `Textures`, `Images` and
 * `Groups`), so the lossless parser in src/formats/enfusion-cst.ts is the
 * model: every edit splices the text, and the bytes outside the edit never
 * change. A file the parser cannot give back byte for byte is refused.
 *
 * Reads take a file under the project root or a game resource (read from the
 * paks). Writes go inside the project root only, on an existing file unless
 * the action is `create`, and are a dry run (a unified diff) unless
 * `confirm` is true. A new file is registered afterwards with
 * `wb_resources register`: this tool writes no `.meta` (OD-8).
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { writeFileAtomic } from "../utils/atomic-write.js";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { z } from "zod";
import type { Config } from "../config.js";
import {
  CstDocument,
  CstEditError,
  parseCstBytes,
  tokenValue,
  type CstEdit,
  type CstEntry,
  type CstObject,
  type CstScalar,
  type ObjectSpec,
} from "../formats/enfusion-cst.js";
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

// ── Errors ───────────────────────────────────────────────────────────────────

/** A refusal with a vocabulary code. */
export class ImagesetError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ImagesetError";
  }
}

const bad = (message: string): never => {
  throw new ImagesetError("INVALID_ARGUMENT", message);
};
const missing = (message: string): never => {
  throw new ImagesetError("PATH_NOT_FOUND", message);
};

// ── Model ────────────────────────────────────────────────────────────────────

type Pair = [number, number];

export interface TextureView {
  index: number;
  /** GUID in the object header, when the texture entry has one. */
  objectGuid?: string;
  /** The `path` value as written (`{GUID}UI/x.edds`). */
  resource?: string;
  guid?: string;
  path?: string;
  mpix?: number;
  screenSize?: string;
  size?: Pair;
}

export interface QuadView {
  /** Position in its block (the path index). */
  index: number;
  group?: string;
  name: string;
  hasName: boolean;
  pos?: Pair;
  size?: Pair;
  flags?: string;
}

export interface GroupView {
  index: number;
  name: string;
  hasName: boolean;
  hasImages: boolean;
  quads: QuadView[];
}

export interface ImagesetView {
  refSize?: Pair;
  textures: TextureView[];
  quads: QuadView[];
  groups: GroupView[];
  hasTextures: boolean;
  hasImages: boolean;
  hasGroups: boolean;
}

function scalarOf(o: CstObject, key: string): CstScalar | undefined {
  return o.children.find((c): c is CstScalar => c.kind === "scalar" && c.key === key);
}

function blockOf(o: CstObject, key: string): CstObject | undefined {
  return o.children.find((c): c is CstObject => c.kind === "object" && c.key === key);
}

const valuesOf = (s: CstScalar | undefined): string[] | undefined => s?.values.map(tokenValue);

function pairOf(s: CstScalar | undefined): Pair | undefined {
  const v = valuesOf(s);
  if (!v || v.length !== 2) return undefined;
  const p: Pair = [Number(v[0]), Number(v[1])];
  return Number.isFinite(p[0]) && Number.isFinite(p[1]) ? p : undefined;
}

const nameOfHead = (o: CstObject): string => (o.head[1] ? tokenValue(o.head[1]) : "");

/** The one `ImageSetClass` object of the document, or undefined. */
function rootOf(doc: CstDocument): CstObject | undefined {
  const kids = doc.root.children;
  if (kids.length !== 1) return undefined;
  const k = kids[0];
  return k.kind === "object" && k.key === "ImageSetClass" ? k : undefined;
}

function quadsOf(block: CstObject | undefined, group?: string): QuadView[] {
  if (!block) return [];
  const out: QuadView[] = [];
  block.children.forEach((c, index) => {
    if (c.kind !== "object" || c.key !== "ImageSetDefClass") return;
    out.push({
      index,
      group,
      name: nameOfHead(c),
      hasName: scalarOf(c, "Name") !== undefined,
      pos: pairOf(scalarOf(c, "Pos")),
      size: pairOf(scalarOf(c, "Size")),
      flags: valuesOf(scalarOf(c, "Flags"))?.join(" "),
    });
  });
  return out;
}

export function viewImageset(doc: CstDocument): ImagesetView {
  const root = rootOf(doc);
  if (!root) return bad("not an imageset: the file is not one ImageSetClass block");
  const o = root as CstObject;
  const textures: TextureView[] = [];
  const tb = blockOf(o, "Textures");
  tb?.children.forEach((c, index) => {
    if (c.kind !== "object" || c.key !== "ImageSetTextureClass") return;
    const resource = valuesOf(scalarOf(c, "path"))?.join(" ");
    const m = resource ? /^\{([0-9A-Fa-f]{16})\}(.*)$/.exec(resource) : null;
    const mpix = valuesOf(scalarOf(c, "mpix"))?.[0];
    textures.push({
      index,
      objectGuid: c.head[1] ? tokenValue(c.head[1]).replace(/^\{|\}$/g, "") : undefined,
      resource,
      guid: m ? m[1].toUpperCase() : undefined,
      path: m ? m[2] : resource,
      mpix: mpix === undefined ? undefined : Number(mpix),
      screenSize: valuesOf(scalarOf(c, "screenSize"))?.[0],
      size: pairOf(scalarOf(c, "size")),
    });
  });
  const groups: GroupView[] = [];
  const gb = blockOf(o, "Groups");
  gb?.children.forEach((c, index) => {
    if (c.kind !== "object" || c.key !== "ImageSetGroupClass") return;
    const name = nameOfHead(c);
    const images = blockOf(c, "Images");
    groups.push({
      index,
      name,
      hasName: scalarOf(c, "Name") !== undefined,
      hasImages: images !== undefined,
      quads: quadsOf(images, name),
    });
  });
  const ib = blockOf(o, "Images");
  return {
    refSize: pairOf(scalarOf(o, "RefSize")),
    textures,
    quads: quadsOf(ib),
    groups,
    hasTextures: tb !== undefined,
    hasImages: ib !== undefined,
    hasGroups: gb !== undefined,
  };
}

function hasOpaque(entries: CstEntry[]): boolean {
  return entries.some((e) => e.kind === "opaque" || (e.kind === "object" && hasOpaque(e.children)));
}

/**
 * Why the writer would not keep this file byte for byte, or undefined when it
 * would: not read back identically, a construct the parser could not place, or
 * not one closed ImageSetClass block.
 */
export function unwritableReason(buf: Buffer): string | undefined {
  let doc: CstDocument;
  try {
    doc = parseCstBytes(buf);
  } catch (e) {
    return `not readable as text: ${e instanceof Error ? e.message : String(e)}`;
  }
  if (Buffer.compare(doc.toBytes(), buf) !== 0)
    return "its bytes do not come back identically (encoding or a stray byte)";
  if (doc.diagnostics.length) return `the parser flagged it: ${doc.diagnostics[0].message}`;
  const root = rootOf(doc);
  if (!root) return "it is not one ImageSetClass block";
  if (!root.close) return "the ImageSetClass block is not closed";
  if (hasOpaque(doc.root.children)) return "it holds text the parser could not place";
  return undefined;
}

// ── Arguments and checks ─────────────────────────────────────────────────────

export interface ImagesetArgs {
  refSize?: number[];
  texture?: string;
  resourceGuid?: string;
  objectGuid?: string;
  mpix?: number;
  screenSize?: string;
  textureSize?: number[];
  index?: number;
  group?: string;
  name?: string;
  pos?: number[];
  size?: number[];
  flags?: string;
}

function intPair(v: number[] | undefined, what: string, min: number): Pair {
  if (!Array.isArray(v) || v.length !== 2) return bad(`${what} must be [x, y]: two numbers`);
  const [a, b] = v;
  for (const n of [a, b]) {
    if (!Number.isSafeInteger(n) || n < min)
      return bad(`${what} must hold whole numbers of at least ${min}, got ${a}, ${b}`);
  }
  return [a, b];
}

function cleanName(raw: string | undefined, what: string): string {
  if (typeof raw !== "string" || raw === "") return bad(`${what} is required`);
  if (/["\\\x00-\x1f\x7f]/.test(raw) || raw !== raw.trim() || raw.length > 256)
    return bad(
      `${what} must be 1 to 256 characters with no quote, backslash, control character or edge blank`,
    );
  return raw;
}

function flagTokens(raw: string): string[] {
  const t = raw.trim().split(/\s+/);
  if (t.length < 1 || t.length > 2 || !t.every((x) => /^(0[xX][0-9A-Fa-f]+|\d+)$/.test(x)))
    return bad(`flags must be one or two whole numbers (decimal or 0x hex), got "${raw}"`);
  return t;
}

const SCREEN = /^[A-Za-z0-9_]{1,16}$/;

/** Enforce keywords the engine's own files quote when they name an image. */
const RESERVED = new Set([
  "continue", "new", "private", "class", "if", "else", "for", "foreach", "while", "return",
  "break", "switch", "case", "default", "static", "void", "int", "float", "bool", "string",
  "vector", "null", "true", "false", "this", "super", "delete", "auto", "ref", "autoptr",
  "protected", "override", "proto", "native", "out", "inout", "const", "enum", "typedef",
  "modded", "sealed", "event", "volatile", "external", "owned", "reference", "notnull",
  "local", "thread", "do", "in", "is", "not", "and", "or", "event",
]); // prettier-ignore

// ── Editing ──────────────────────────────────────────────────────────────────

export interface OpResult {
  changes: Change[];
  warnings: string[];
}

const ROOT_ORDER = ["RefSize", "Textures", "Images", "Groups"];

/** A document handle the ops replace the text of. */
export interface Work {
  doc: CstDocument;
}

function reload(w: Work, text: string): void {
  w.doc = new CstDocument(text, w.doc.encoding);
}

/**
 * Names the engine quotes (a keyword) cannot be written bare: the parser's
 * fresh style writes any identifier bare, so the header word is quoted here.
 */
function requote(w: Work, edit: CstEdit, bare: string, cls: string): void {
  if (!RESERVED.has(bare)) return;
  const needle = `${cls} ${bare} {`;
  const at = edit.inserted.indexOf(needle);
  if (at < 0) return;
  const text = w.doc.text;
  const s = edit.start + at + cls.length + 1;
  reload(w, text.slice(0, s) + `"${bare}"` + text.slice(s + bare.length));
}

function root(w: Work): CstObject {
  const r = rootOf(w.doc);
  if (!r) return bad("not an imageset: the file is not one ImageSetClass block");
  return r as CstObject;
}

/** Makes sure the root holds `key` (RefSize, Textures, Images, Groups order). */
function ensureRootBlock(w: Work, key: "Textures" | "Images" | "Groups"): void {
  const r = root(w);
  if (blockOf(r, key)) return;
  const rank = ROOT_ORDER.indexOf(key);
  let at = 0;
  r.children.forEach((c, i) => {
    if (c.kind !== "opaque" && ROOT_ORDER.indexOf((c as CstObject | CstScalar).key) < rank)
      at = i + 1;
  });
  w.doc.createObject("", { key }, at >= r.children.length ? undefined : at);
}

function siblingStyle(quads: QuadView[]): { hasName: boolean; flags: string } {
  const s = quads.find((q) => q.flags !== undefined) ?? quads[0];
  // The sibling's shape (one or two flag words), never its value: 0x1 is a meaning, not a style.
  const words = s?.flags ? s.flags.split(/\s+/).length : 1;
  return {
    hasName: quads.length ? quads[0].hasName : true,
    flags: Array(words).fill("0").join(" "),
  };
}

function findGroup(view: ImagesetView, name: string): GroupView {
  const g = view.groups.find((x) => x.name === name);
  if (!g) {
    return missing(
      `no group "${name}" (groups: ${view.groups.map((x) => x.name).join(", ") || "none"}); addGroup makes one`,
    );
  }
  return g;
}

function findQuad(view: ImagesetView, name: string, group?: string): QuadView {
  if (group !== undefined) {
    const g = findGroup(view, group);
    const hits = g.quads.filter((q) => q.name === name);
    if (hits.length === 0) return missing(`no quad "${name}" in group "${group}"`);
    if (hits.length > 1) return bad(`"${name}" appears ${hits.length} times in group "${group}"`);
    return hits[0];
  }
  const hits = view.quads.filter((q) => q.name === name);
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) return bad(`"${name}" appears ${hits.length} times in the root Images`);
  const inGroups = view.groups
    .filter((g) => g.quads.some((q) => q.name === name))
    .map((g) => g.name);
  return missing(
    `no quad "${name}" in the root Images` +
      (inGroups.length ? `; it is in group(s) ${inGroups.join(", ")}: pass group` : ""),
  );
}

const quadPath = (q: QuadView, view: ImagesetView): string =>
  q.group === undefined
    ? `Images[${q.index}]`
    : `Groups[${view.groups.find((g) => g.name === q.group)!.index}].Images[${q.index}]`;

const quadLabel = (q: { group?: string; name: string }): string =>
  q.group === undefined ? `quad:${q.name}` : `quad:${q.group}/${q.name}`;

const quadValue = (q: QuadView) => ({ pos: q.pos, size: q.size, flags: q.flags });

function boundsWarning(view: ImagesetView, q: { name: string; pos?: Pair; size?: Pair }): string[] {
  if (!view.refSize || !q.pos || !q.size) return [];
  const [rw, rh] = view.refSize;
  return q.pos[0] + q.size[0] > rw || q.pos[1] + q.size[1] > rh
    ? [`"${q.name}" reaches past RefSize ${rw} ${rh}`]
    : [];
}

/** The fresh skeleton `create` writes: vanilla shape, no final line ending. */
export function skeleton(refSize: Pair): string {
  return [
    "ImageSetClass {",
    ` RefSize ${refSize[0]} ${refSize[1]}`,
    " Textures {",
    " }",
    " Images {",
    " }",
    "}",
  ].join("\n");
}

export function addTexture(w: Work, a: ImagesetArgs): OpResult {
  const raw = cleanName(a.texture, "texture");
  const view = viewImageset(w.doc);
  const given = /^\{([0-9A-Fa-f]{16})\}(.+)$/.exec(raw);
  if (given && a.resourceGuid !== undefined)
    bad("texture already carries a {GUID}: drop resourceGuid");
  const warnings: string[] = [];
  let path = raw;
  let guid: string | undefined = given?.[1];
  if (!given && a.resourceGuid !== undefined) {
    const m = /^\{?([0-9A-Fa-f]{16})\}?$/.exec(a.resourceGuid);
    if (!m) bad(`resourceGuid must be 16 hex digits, got ${a.resourceGuid}`);
    guid = (m as RegExpExecArray)[1];
  }
  const bare = given ? given[2] : path;
  if (!guid)
    warnings.push(
      `"${bare}" has no resource GUID; resolve it first (wb_resources resolve) and pass resourceGuid, or the engine resolves it by path alone`,
    );
  path = guid ? `{${guid.toUpperCase()}}${bare}` : bare;
  if (view.textures.some((t) => t.path === bare))
    return bad(
      `the imageset already lists "${bare}" (texture ${view.textures.find((t) => t.path === bare)!.index})`,
    );

  const entries: ObjectSpec["entries"] = [];
  if (a.screenSize !== undefined) {
    if (!SCREEN.test(a.screenSize))
      bad(`screenSize must be a short word such as FHD, got "${a.screenSize}"`);
    if (a.mpix !== undefined) bad("give screenSize with textureSize, or mpix: not both");
    const size = intPair(a.textureSize, "textureSize", 1);
    entries.push(
      {
        key: "screenSize",
        value: a.screenSize,
        quoted: /^[A-Za-z_]/.test(a.screenSize) ? false : true,
      },
      { key: "size", value: size },
    );
  } else {
    if (a.textureSize !== undefined) bad("textureSize goes with screenSize");
    const mpix = a.mpix ?? 1;
    if (!Number.isSafeInteger(mpix) || mpix < 1)
      bad(`mpix must be a whole number of at least 1, got ${mpix}`);
    entries.push({ key: "mpix", value: mpix });
  }
  entries.push({ key: "path", value: path, quoted: true });

  ensureRootBlock(w, "Textures");
  const n = blockOf(root(w), "Textures")!.children.length;
  w.doc.createObject("Textures", { key: "ImageSetTextureClass", guid: a.objectGuid, entries });
  const after = viewImageset(w.doc).textures.find((t) => t.path === bare)!;
  return {
    changes: [{ path: `Textures[${n}]`, before: null, after: { ...after, index: undefined } }],
    warnings,
  };
}

export function removeTexture(w: Work, a: ImagesetArgs): OpResult {
  const view = viewImageset(w.doc);
  let t: TextureView | undefined;
  if (a.index !== undefined) {
    t = view.textures.find((x) => x.index === a.index);
    if (!t)
      return missing(
        `no texture at index ${a.index} (textures: ${view.textures.map((x) => x.index).join(", ") || "none"})`,
      );
  } else if (a.texture !== undefined) {
    const key = a.texture.replace(/^\{[0-9A-Fa-f]{16}\}/, "");
    const hits = view.textures.filter((x) => x.path === key || x.resource === a.texture);
    if (hits.length === 0) return missing(`no texture "${a.texture}"`);
    if (hits.length > 1) return bad(`"${a.texture}" matches ${hits.length} textures: pass index`);
    t = hits[0];
  } else return bad("removeTexture needs texture (a path) or index");
  const sole = view.textures.length === 1;
  w.doc.arrayRemove("Textures", t.index);
  return {
    changes: [{ path: `Textures[${t.index}]`, before: { ...t, index: undefined }, after: null }],
    warnings: sole ? ["the imageset now lists no texture"] : [],
  };
}

export function addGroup(w: Work, a: ImagesetArgs): OpResult {
  const name = cleanName(a.group, "group");
  const view = viewImageset(w.doc);
  if (view.groups.some((g) => g.name === name)) return bad(`group "${name}" already exists`);
  const named = view.groups.length ? view.groups[0].hasName : true;
  ensureRootBlock(w, "Groups");
  const n = blockOf(root(w), "Groups")!.children.length;
  const entries: ObjectSpec["entries"] = [];
  if (named) entries.push({ key: "Name", value: name, quoted: true });
  entries.push({ object: { key: "Images" } });
  const edit = w.doc.createObject("Groups", { key: "ImageSetGroupClass", name, entries });
  requote(w, edit, name, "ImageSetGroupClass");
  return {
    changes: [{ path: `Groups[${n}]`, before: null, after: { group: name } }],
    warnings: [],
  };
}

export function addQuad(w: Work, a: ImagesetArgs): OpResult {
  const name = cleanName(a.name, "name");
  const pos = intPair(a.pos, "pos", 0);
  const size = intPair(a.size, "size", 1);
  const flags = a.flags === undefined ? undefined : flagTokens(a.flags);
  const view = viewImageset(w.doc);
  let container = view.quads;
  let g: GroupView | undefined;
  if (a.group !== undefined) {
    g = findGroup(view, a.group);
    container = g.quads;
  }
  if (container.some((q) => q.name === name))
    return bad(`"${name}" already exists in ${g ? `group "${g.name}"` : "the root Images"}`);
  const style = siblingStyle(container);
  const entries: ObjectSpec["entries"] = [];
  if (style.hasName) entries.push({ key: "Name", value: name, quoted: true });
  entries.push({ key: "Pos", value: pos }, { key: "Size", value: size });
  entries.push({ key: "Flags", value: flags ?? flagTokens(style.flags), quoted: false });
  const spec: ObjectSpec = { key: "ImageSetDefClass", name, entries };
  let at: string;
  if (g) {
    if (!g.hasImages) w.doc.createObject(`Groups[${g.index}]`, { key: "Images" });
    const gi = viewImageset(w.doc).groups.find((x) => x.name === g!.name)!;
    at = `Groups[${gi.index}].Images`;
  } else {
    ensureRootBlock(w, "Images");
    at = "Images";
  }
  const edit = w.doc.createObject(at, spec);
  requote(w, edit, name, "ImageSetDefClass");
  const q = quadsOf(w.doc.resolve(at) as CstObject, g?.name).find((x) => x.name === name)!;
  return {
    changes: [{ path: quadLabel(q), before: null, after: quadValue(q) }],
    warnings: boundsWarning(viewImageset(w.doc), q),
  };
}

export function setQuad(w: Work, a: ImagesetArgs): OpResult {
  const name = cleanName(a.name, "name");
  if (a.pos === undefined && a.size === undefined && a.flags === undefined)
    return bad("setQuad needs pos, size or flags");
  const pos = a.pos === undefined ? undefined : intPair(a.pos, "pos", 0);
  const size = a.size === undefined ? undefined : intPair(a.size, "size", 1);
  const flags = a.flags === undefined ? undefined : flagTokens(a.flags);
  const view = viewImageset(w.doc);
  const q = findQuad(view, name, a.group);
  const path = quadPath(q, view);
  const changes: Change[] = [];
  const set = (field: "Pos" | "Size" | "Flags", before: string | undefined, next: string[]) => {
    if (before === next.join(" ")) return;
    w.doc.set(`${path}.${field}`, next, { quoted: false });
    changes.push({
      path: `${quadLabel(q)}.${field}`,
      before: before ?? null,
      after: next.join(" "),
    });
  };
  if (pos) set("Pos", q.pos?.join(" "), pos.map(String));
  if (size) set("Size", q.size?.join(" "), size.map(String));
  if (flags) set("Flags", q.flags, flags);
  const now = quadsOf(w.doc.resolve(path.replace(/\[\d+\]$/, "")) as CstObject, q.group).find(
    (x) => x.index === q.index,
  )!;
  const warnings = boundsWarning(viewImageset(w.doc), now);
  if (changes.length === 0) warnings.push("every value already is as asked: nothing to change");
  return { changes, warnings };
}

/** Removes a quad (`name`, with `group` when it lives in one) or, with `group` alone, a whole group. */
export function removeItem(w: Work, a: ImagesetArgs): OpResult {
  const view = viewImageset(w.doc);
  if (a.name === undefined) {
    if (a.group === undefined) return bad("remove needs name (a quad) or group (a whole group)");
    const g = findGroup(view, cleanName(a.group, "group"));
    w.doc.arrayRemove("Groups", g.index);
    return {
      changes: [
        { path: `group:${g.name}`, before: { group: g.name, quads: g.quads.length }, after: null },
      ],
      warnings: [],
    };
  }
  const q = findQuad(view, cleanName(a.name, "name"), a.group);
  const parent = q.group === undefined ? "Images" : quadPath(q, view).replace(/\[\d+\]$/, "");
  w.doc.arrayRemove(parent, q.index);
  return { changes: [{ path: quadLabel(q), before: quadValue(q), after: null }], warnings: [] };
}

export const WRITE_ACTIONS = [
  "create",
  "addTexture",
  "removeTexture",
  "addGroup",
  "addQuad",
  "setQuad",
  "remove",
] as const;
export type WriteAction = (typeof WRITE_ACTIONS)[number];

/** Applies one edit action to `w`; throws ImagesetError, CstEditError or VocabularyError. */
export function applyEdit(
  w: Work,
  action: Exclude<WriteAction, "create">,
  a: ImagesetArgs,
): OpResult {
  switch (action) {
    case "addTexture":
      return addTexture(w, a);
    case "removeTexture":
      return removeTexture(w, a);
    case "addGroup":
      return addGroup(w, a);
    case "addQuad":
      return addQuad(w, a);
    case "setQuad":
      return setQuad(w, a);
    default:
      return removeItem(w, a);
  }
}

// ── Diff ─────────────────────────────────────────────────────────────────────

/** One-hunk unified diff of two texts (empty when they are equal). */
export function unifiedDiff(a: string, b: string, label: string, ctx = 2, cap = 120): string {
  if (a === b) return "";
  const x = a.split("\n");
  const y = b.split("\n");
  let p = 0;
  while (p < x.length && p < y.length && x[p] === y[p]) p++;
  let s = 0;
  while (s < x.length - p && s < y.length - p && x[x.length - 1 - s] === y[y.length - 1 - s]) s++;
  const from = Math.max(0, p - ctx);
  const xe = Math.min(x.length, x.length - s + ctx);
  const ye = Math.min(y.length, y.length - s + ctx);
  const lines: string[] = [];
  for (let i = from; i < p; i++) lines.push(` ${x[i]}`);
  for (let i = p; i < x.length - s; i++) lines.push(`-${x[i]}`);
  for (let i = p; i < y.length - s; i++) lines.push(`+${y[i]}`);
  for (let i = x.length - s; i < xe; i++) lines.push(` ${x[i]}`);
  const head = `--- a/${label}\n+++ b/${label}\n@@ -${from + 1},${xe - from} +${from + 1},${ye - from} @@`;
  const body =
    lines.length > cap ? [...lines.slice(0, cap), `... ${lines.length - cap} more line(s)`] : lines;
  return [head, ...body].join("\n");
}

// ── Files ────────────────────────────────────────────────────────────────────

interface Located {
  /** Resource path, forward slashes. */
  rel: string;
  /** Absolute path of the project file, when a project root is known. */
  file?: string;
  root?: string;
}

function locate(rawPath: string, projectPath: string | undefined): Located {
  const root = projectPath ? resolve(projectPath) : undefined;
  let p = rawPath.trim().replace(/^\{[0-9A-Fa-f]{16}\}/, "");
  if (p.startsWith("-")) bad("paths starting with '-' are rejected");
  if (isAbsolute(p) || /^[A-Za-z]:/.test(p)) {
    if (!root)
      throw new ImagesetError(
        "NOT_IN_PROJECT",
        "no project root is configured for an absolute path",
      );
    const rel = relative(root, resolve(p));
    if (rel === "" || isAbsolute(rel) || rel.split(/[\\/]/)[0] === "..")
      throw new ImagesetError("NOT_IN_PROJECT", `${rawPath} is outside the project ${root}`);
    p = rel.replace(/\\/g, "/");
  }
  const rel = checkRelativePath(p);
  if (!rel.toLowerCase().endsWith(".imageset")) bad(`"${rel}" is not an .imageset file`);
  if (!root) return { rel };
  const file = resolve(root, rel);
  try {
    assertInsideRoot(file, root, "path");
  } catch (e) {
    throw new ImagesetError("NOT_IN_PROJECT", e instanceof Error ? e.message : String(e));
  }
  return { rel, file, root };
}

function vfsOf(config: Config): PakVirtualFS | null {
  try {
    return config.gamePath ? PakVirtualFS.get(config.gamePath) : null;
  } catch {
    return null;
  }
}

interface Loaded {
  buf: Buffer;
  /** True when read from the game paks (never written). */
  game: boolean;
}

function readFrom(loc: Located, config: Config): Loaded {
  if (loc.file && existsSync(loc.file)) {
    if (!statSync(loc.file).isFile()) return bad(`${loc.rel} is not a file`);
    return { buf: readFileSync(loc.file), game: false };
  }
  const vfs = vfsOf(config);
  if (vfs?.exists(loc.rel)) return { buf: vfs.readFile(loc.rel), game: true };
  return missing(
    `no imageset at "${loc.rel}": not a file${loc.root ? ` under ${loc.root}` : ""} and not in the game data` +
      (vfs ? "" : " (game paks not available: ENFUSION_GAME_PATH)"),
  );
}

// ── Actions ──────────────────────────────────────────────────────────────────

export interface ImagesetRequest extends ImagesetArgs {
  action: "read" | WriteAction;
  path: string;
  projectPath?: string;
  confirm?: boolean;
  overwrite?: boolean;
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

function readAction(req: ImagesetRequest, loc: Located, config: Config): ActionResponse {
  const { buf, game } = readFrom(loc, config);
  const doc = parseCstBytes(buf);
  const view = viewImageset(doc);
  const all = [...view.quads, ...view.groups.flatMap((g) => g.quads)];
  const pool = req.group === undefined ? all : findGroup(view, req.group).quads;
  const limit = Math.min(req.limit ?? LIMIT_DEFAULT, LIMIT_MAX);
  const cur = req.cursor === undefined ? { start: 0, count: pool.length } : parseCursor(req.cursor);
  if (req.cursor !== undefined) checkCursor(cur, pool.length);
  const page = pool.slice(cur.start, cur.start + limit);
  const warnings: string[] = [];
  const why = unwritableReason(buf);
  if (why) warnings.push(`this tool would refuse to edit the file: ${why}`);
  if (game) warnings.push("game resource (read only): game_duplicate copies it into the project");
  for (const q of [view.quads, ...view.groups.map((g) => g.quads)]) {
    const names = new Set<string>();
    for (const x of q) {
      if (names.has(x.name))
        warnings.push(`duplicate quad "${x.name}"${x.group ? ` in group "${x.group}"` : ""}`);
      names.add(x.name);
    }
  }
  for (const q of all) warnings.push(...boundsWarning(view, q));
  const dropEmpty = <T extends object>(o: T) =>
    Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
  return okResponse(
    "read",
    loc.rel,
    null,
    {
      source: game ? "game" : "project",
      bytes: buf.length,
      refSize: view.refSize,
      textures: view.textures.map(dropEmpty),
      groups: view.groups.map((g) => ({ index: g.index, name: g.name, quads: g.quads.length })),
      quadCount: all.length,
      quads: page.map((q) => dropEmpty({ ...q, index: undefined, hasName: undefined })),
      cursor: req.cursor,
      nextCursor: nextCursor(cur.start, limit, pool.length),
    },
    warnings.slice(0, 50),
  );
}

function commit(
  req: ImagesetRequest,
  loc: Located,
  before: string,
  w: Work,
  op: OpResult,
  creating: boolean,
): ActionResponse {
  const after = w.doc.serialize();
  // The edit must still be a file this writer can reproduce.
  const bytes = w.doc.toBytes();
  const why = unwritableReason(bytes);
  if (why)
    throw new ImagesetError(
      "INVALID_ARGUMENT",
      `the edit would produce a file the writer cannot keep: ${why}`,
    );
  const diff = unifiedDiff(before, after, loc.rel);
  const confirmed = req.confirm === true;
  const dry = !confirmed;
  if (!confirmed || (!creating && before === after)) {
    return okResponse(
      req.action,
      loc.rel,
      op.changes,
      { diff, bytesBefore: Buffer.byteLength(before), bytesAfter: bytes.length },
      op.warnings,
      confirmed ? undefined : "Run again with confirm: true to write exactly this change.",
      dry,
    );
  }
  const file = loc.file!;
  if (creating) {
    mkdirSync(dirname(file), { recursive: true });
    try {
      // A new file is created exclusively; an overwrite goes through write-then-rename (F9).
      if (req.overwrite) writeFileAtomic(file, bytes);
      else writeFileSync(file, bytes, { flag: "wx" });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EEXIST")
        throw new ImagesetError(
          "INVALID_ARGUMENT",
          `${loc.rel} already exists; pass overwrite: true to replace it`,
        );
      throw e;
    }
  } else {
    if (Buffer.compare(readFileSync(file), Buffer.from(before, w.doc.encoding)) !== 0)
      throw new ImagesetError(
        "INVALID_ARGUMENT",
        `${loc.rel} changed on disk since it was read; nothing written, read it again`,
      );
    // Write-then-rename: a failed write leaves the file as it was (review round 1, F9).
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
  const view = viewImageset(parseCstBytes(back));
  return okResponse(
    req.action,
    loc.rel,
    op.changes,
    {
      diff,
      bytes: back.length,
      refSize: view.refSize,
      textures: view.textures.length,
      groups: view.groups.length,
      quads: view.quads.length + view.groups.reduce((n, g) => n + g.quads.length, 0),
    },
    op.warnings,
    creating
      ? "A new file is not yet known to the engine: register it with wb_resources register."
      : "An open Resource Manager tab keeps its own copy: reopen the imageset there, and do not save the old tab over this file.",
    false,
  );
}

function writeAction(req: ImagesetRequest, loc: Located, config: Config): ActionResponse {
  if (!loc.file || !loc.root)
    throw new ImagesetError(
      "NOT_IN_PROJECT",
      "writes need a project path (ENFUSION_PROJECT_PATH or projectPath)",
    );
  if (req.action === "create") {
    const exists = existsSync(loc.file);
    if (exists && !req.overwrite)
      throw new ImagesetError(
        "INVALID_ARGUMENT",
        `${loc.rel} already exists; pass overwrite: true to replace it`,
      );
    const before = exists ? readFileSync(loc.file, "utf-8") : "";
    const refSize = intPair(req.refSize, "refSize", 1);
    const w: Work = { doc: new CstDocument(skeleton(refSize)) };
    const op: OpResult = {
      changes: [{ path: "file", before: exists ? "existing file" : null, after: { refSize } }],
      warnings: exists ? ["overwrite: the existing file is replaced whole"] : [],
    };
    if (req.texture !== undefined) {
      const t = addTexture(w, req);
      op.changes.push(...t.changes);
      op.warnings.push(...t.warnings);
    }
    return commit(req, loc, before, w, op, true);
  }
  if (!existsSync(loc.file)) {
    const inGame = vfsOf(config)?.exists(loc.rel);
    if (inGame)
      throw new ImagesetError(
        "NOT_IN_PROJECT",
        `${loc.rel} is game data (read only): copy it into the project with game_duplicate, then edit the copy`,
      );
    return missing(`no imageset at ${loc.rel} under ${loc.root}; create makes a new one`);
  }
  if (!statSync(loc.file).isFile()) return bad(`${loc.rel} is not a file`);
  const buf = readFileSync(loc.file);
  const why = unwritableReason(buf);
  if (why)
    throw new ImagesetError(
      "INVALID_ARGUMENT",
      `${loc.rel} is left alone: this writer cannot keep it byte for byte (${why}). Edit it in the Resource Manager.`,
    );
  const w: Work = { doc: parseCstBytes(buf) };
  const before = w.doc.serialize();
  const op = applyEdit(w, req.action as Exclude<WriteAction, "create">, req);
  return commit(req, loc, before, w, op, false);
}

/** Runs one request; every refusal is an `ActionError`, never a throw. */
export function runImageset(req: ImagesetRequest, config: Config): ActionResponse {
  try {
    const root = pinnedProjectRoot(req.projectPath, config.projectPath);
    const loc = locate(req.path, root);
    return req.action === "read" ? readAction(req, loc, config) : writeAction(req, loc, config);
  } catch (e) {
    const target = `path:${String(req.path ?? "")}`;
    if (e instanceof ImagesetError || e instanceof VocabularyError)
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

const pair = (what: string) => z.array(z.number()).length(2).optional().describe(what);

export function registerImageset(server: McpServer, config: Config): void {
  server.registerTool(
    "imageset",
    {
      description:
        "Read and edit .imageset files (UI icon atlases) offline, byte-exact. Actions: read (paged), create, addTexture, removeTexture, addGroup, addQuad, setQuad, remove (a quad, or a whole group). " +
        "Writes stay inside the project, are a dry run (diff) unless confirm: true, and refuse files the writer cannot reproduce. New files then need wb_resources register.",
      inputSchema: {
        action: z.enum(["read", ...WRITE_ACTIONS]),
        path: z
          .string()
          .describe(
            "The .imageset: project-relative, absolute inside the project, or (read) a game path.",
          ),
        projectPath: z
          .string()
          .optional()
          .describe("Addon root. Uses the configured project when omitted."),
        confirm: z
          .boolean()
          .optional()
          .describe("Write the change. Without it the call is a dry run."),
        overwrite: z.boolean().optional().describe("create: replace an existing file."),
        refSize: pair("create: RefSize [w, h]."),
        texture: z
          .string()
          .optional()
          .describe(
            "create/addTexture/removeTexture: texture resource path, {GUID} prefix optional.",
          ),
        resourceGuid: z
          .string()
          .optional()
          .describe("addTexture: 16-hex GUID of the texture resource."),
        objectGuid: z
          .string()
          .optional()
          .describe("addTexture: GUID for the texture entry's header."),
        mpix: z.number().optional().describe("addTexture: mpix (default 1) for a plain texture."),
        screenSize: z.string().optional().describe("addTexture: FHD, 2K ...; needs textureSize."),
        textureSize: pair("addTexture: [w, h] with screenSize."),
        index: z.number().int().optional().describe("removeTexture: texture index."),
        group: z.string().optional().describe("addGroup/addQuad/setQuad/remove/read: group name."),
        name: z.string().optional().describe("addQuad/setQuad/remove: quad name."),
        pos: pair("addQuad/setQuad: [x, y]."),
        size: pair("addQuad/setQuad: [w, h]."),
        flags: z.string().optional().describe('addQuad/setQuad: Flags, e.g. "0" or "0 0".'),
        cursor: z.string().optional().describe("read: cursor from the last page."),
        limit: z.number().int().min(1).max(LIMIT_MAX).optional().describe("read: quads per page."),
      },
    },
    async (args) => {
      const r = runImageset(args as ImagesetRequest, config);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(r, null, 2) }],
        isError: !r.ok,
      };
    },
  );
}
