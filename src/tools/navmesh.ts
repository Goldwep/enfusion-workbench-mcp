/**
 * `navmesh`: the navmesh files of a world, offline (W5 spec 1.1, 4.1; DEC-068).
 *
 * Actions:
 *   status         a world (.ent/.layer), an AIWorld prefab (.et), a navmesh
 *                  files config (.conf) or a .nmn: the AIWorld's navmesh
 *                  components, their BaseNavmeshFilesConfig, each .nmn header
 *                  and its .NavData tile folder (count, bytes, age).
 *   header         the header of one .nmn or .ntile (src/formats/navmesh-binary.ts).
 *   tiles          the tiles of one .nmn, paged (`<start>:<count>` cursor).
 *   config         one BaseNavmeshFilesConfig .conf through the lossless parser.
 *   projects       the navmesh projects of the NavmeshManager in a .gproj.
 *   overrideConfig a project copy of a game navmesh files config at the same
 *                  path, optionally pointing at another .nmn; a dry run unless
 *                  confirm, a `.bak` beside a file it replaces.
 *
 * Reads take a project file or a game resource from the paks. The one write
 * goes inside the project root only. Baking is not here (wb_navmesh,
 * wb_cli_run). No Workbench call, no network, no child process.
 *
 * Response shape: {ok, action, target, changed, readback, next, warnings}
 * (src/manifest/vocabulary.ts), as JSON text.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { writeFileAtomic } from "../utils/atomic-write.js";
import { backUp, backupRel } from "../utils/backup.js";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { z } from "zod";
import type { Config } from "../config.js";
import {
  CstEditError,
  parseCstBytes,
  tokenValue,
  type CstDocument,
  type CstEntry,
  type CstObject,
} from "../formats/enfusion-cst.js";
import {
  navDataFolderOf,
  readNmnHeader,
  readNtileHeader,
  tileIndexOf,
  type NmnHeader,
} from "../formats/navmesh-binary.js";
import {
  LIMIT_DEFAULT,
  LIMIT_MAX,
  VocabularyError,
  checkCursor,
  checkRelativePath,
  errorResponse,
  nextCursor,
  parseCursor,
  type ActionResponse,
  type Change,
  type ErrorCode,
} from "../manifest/vocabulary.js";
import { PakVirtualFS } from "../pak/vfs.js";
import { assertInsideRoot, pinnedProjectRoot } from "../utils/path-guard.js";
import { lineDiff } from "./config-edit.js";

export const NAVMESH_ACTIONS = [
  "status",
  "header",
  "tiles",
  "config",
  "projects",
  "overrideConfig",
] as const;
export type NavmeshAction = (typeof NAVMESH_ACTIONS)[number];

export const NAVMESH_DESCRIPTION =
  "Offline navmesh files of a world: status (AIWorld config, navmesh files config, .nmn header, .NavData tile count, size and age), header, tiles (paged), config, projects (.gproj navmesh projects), overrideConfig (project override of a vanilla Navmesh_*.conf, dry run unless confirm). Baking is not here: see wb_navmesh and wb_cli_run.";

/**
 * Switch for the override array of BaseNavmeshFilesConfig (partial navmeshes
 * appended to a vanilla config). The key as the Workbench writes it is not
 * proven: the exe shows `NavmeshFileOveride` and no vanilla config uses it
 * (census probe P-E01-audio-particle-navmesh-L517, open). Until it is proven
 * live, `overrideConfig` with `overrides` answers GATED.
 */
export const NAVMESH_OVERRIDE_ARRAY_PROVEN = false;
/** The override array key as the exe spells it (unproven, see above). */
export const NAVMESH_OVERRIDE_KEY = "NavmeshFileOveride";

export interface NavmeshArgs {
  action: NavmeshAction;
  /** Project-relative or game resource path (`{GUID}` prefix allowed). */
  path?: string;
  cursor?: string;
  limit?: number;
  /** overrideConfig: the .nmn the copy points at (`{GUID}path`). */
  navmeshFile?: string;
  /** overrideConfig: partial .nmn files to append (GATED). */
  overrides?: string[];
  overwrite?: boolean;
  confirm?: boolean;
  projectPath?: string;
}

/** The game files the tool reads: PakVirtualFS, or a fake in tests. */
export interface GameFiles {
  exists(rel: string): boolean;
  readFile(rel: string): Buffer;
  listDir(rel: string): { name: string; isDirectory: boolean; size: number }[];
}

// ── Errors ───────────────────────────────────────────────────────────────────

class Refusal extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly next?: string,
  ) {
    super(message);
    this.name = "Refusal";
  }
}

const MESSAGE_CAP = 400;

function failure(action: string, target: string, e: unknown): ActionResponse {
  if (e instanceof Refusal) return errorResponse(action, target, e.code, e.message, e.next);
  if (e instanceof VocabularyError) return errorResponse(action, target, e.code, e.message);
  if (e instanceof CstEditError) {
    return errorResponse(
      action,
      target,
      e.code === "PATH_NOT_FOUND" ? "PATH_NOT_FOUND" : "INVALID_ARGUMENT",
      e.message,
    );
  }
  const msg = e instanceof Error ? e.message : String(e);
  return errorResponse(action, target, "INVALID_ARGUMENT", msg.slice(0, MESSAGE_CAP));
}

// ── Locating files ───────────────────────────────────────────────────────────

interface Ctx {
  root?: string;
  game: GameFiles | null;
  config: Config;
}

interface Located {
  /** Resource path, forward slashes (the game's own casing when found there). */
  rel: string;
  source: "project" | "game" | "absent";
  abs?: string;
  bytes?: Buffer;
  /** ISO time of a project file; game files carry none. */
  mtime?: string;
}

const GUID_PREFIX = /^\{([0-9A-Fa-f]{16})\}/;

function stripRef(raw: string): string {
  return raw
    .trim()
    .replace(/^path:/, "")
    .replace(GUID_PREFIX, "");
}

function guidOf(raw: string): string | undefined {
  return GUID_PREFIX.exec(raw.trim())?.[1].toUpperCase();
}

function extOf(rel: string): string {
  const base = rel.slice(rel.lastIndexOf("/") + 1);
  const i = base.lastIndexOf(".");
  return i < 0 ? "" : base.slice(i).toLowerCase();
}

function defaultGame(config: Config): GameFiles | null {
  try {
    return config.gamePath ? PakVirtualFS.get(config.gamePath) : null;
  } catch {
    return null;
  }
}

/** A game path in the paks' own casing; undefined when it is not there. */
function gameResolve(game: GameFiles | null, rel: string): string | undefined {
  if (!game || rel === "") return undefined;
  if (game.exists(rel)) return rel;
  let cur = "";
  for (const seg of rel.split("/")) {
    const hit = game.listDir(cur).find((e) => e.name.toLowerCase() === seg.toLowerCase());
    if (!hit) return undefined;
    cur = cur ? `${cur}/${hit.name}` : hit.name;
  }
  return cur;
}

/** A path inside the project root: its relative and absolute forms. Throws NOT_IN_PROJECT. */
function projectFile(raw: string, root: string, label: string): { rel: string; abs: string } {
  const p = stripRef(raw);
  if (p === "") throw new Refusal("INVALID_ARGUMENT", `${label} is empty`);
  let rel: string;
  let abs: string;
  if (isAbsolute(p)) {
    abs = resolve(p);
    const r = relative(resolve(root), abs);
    if (r === "" || isAbsolute(r) || r.split(/[\\/]/)[0] === "..") {
      throw new Refusal("NOT_IN_PROJECT", `${label} is outside the project root: ${p}`);
    }
    rel = r.replace(/\\/g, "/");
  } else {
    rel = checkRelativePath(p);
    abs = resolve(root, rel);
  }
  try {
    assertInsideRoot(abs, root, label);
  } catch (e) {
    throw new Refusal("NOT_IN_PROJECT", e instanceof Error ? e.message : String(e));
  }
  return { rel, abs };
}

/** Finds a file: the project first, then the game paks. Never reads a folder. */
function locate(raw: string, ctx: Ctx): Located {
  const p = stripRef(raw);
  if (p === "") throw new Refusal("INVALID_ARGUMENT", "path is empty");
  if (ctx.root) {
    const { rel, abs } = projectFile(raw, ctx.root, "path");
    if (existsSync(abs) && statSync(abs).isFile()) {
      const st = statSync(abs);
      return {
        rel,
        source: "project",
        abs,
        bytes: readFileSync(abs),
        mtime: st.mtime.toISOString(),
      };
    }
    if (isAbsolute(p)) return { rel, source: "absent", abs };
    const g = gameResolve(ctx.game, rel);
    if (g) return { rel: g, source: "game", abs, bytes: ctx.game!.readFile(g) };
    return { rel, source: "absent", abs };
  }
  if (isAbsolute(p)) {
    throw new Refusal("NOT_IN_PROJECT", "no project root for an absolute path");
  }
  const rel = checkRelativePath(p);
  const g = gameResolve(ctx.game, rel);
  if (g) return { rel: g, source: "game", bytes: ctx.game!.readFile(g) };
  return { rel, source: "absent" };
}

function mustExist(l: Located): asserts l is Located & { bytes: Buffer } {
  if (l.source === "absent" || !l.bytes) {
    throw new Refusal(
      "PATH_NOT_FOUND",
      `no file "${l.rel}" in the project or the game data`,
      "Check the path; list a folder with list_resources or game_browse.",
    );
  }
}

function needPath(args: NavmeshArgs): string {
  if (!args.path || stripRef(args.path) === "") {
    throw new Refusal("INVALID_ARGUMENT", `${args.action} needs path`);
  }
  return args.path;
}

function requireExt(rel: string, exts: readonly string[], action: string): void {
  if (!exts.includes(extOf(rel))) {
    throw new Refusal("INVALID_ARGUMENT", `${action} takes ${exts.join(" or ")}, got "${rel}"`);
  }
}

// ── Text helpers ─────────────────────────────────────────────────────────────

function isBinaryText(buf: Buffer): boolean {
  if (buf.length >= 4 && buf.toString("latin1", 0, 4) === "EBIN") return true;
  const head = buf.subarray(0, 8192);
  return head.includes(0);
}

function childOf(o: CstObject, key: string): CstEntry | undefined {
  return o.children.find((c) => (c.kind === "object" || c.kind === "scalar") && c.key === key);
}

function objectOf(o: CstObject, key: string): CstObject | undefined {
  const c = childOf(o, key);
  return c?.kind === "object" ? c : undefined;
}

function scalarOf(o: CstObject, key: string): string | undefined {
  const c = childOf(o, key);
  return c?.kind === "scalar" ? c.values.map(tokenValue).join(" ") : undefined;
}

function rawOf(doc: CstDocument, e: CstEntry | undefined, cap = 2000): string | undefined {
  if (!e) return undefined;
  const t = doc.text.slice(e.start, e.end);
  return t.length > cap ? t.slice(0, cap) + "..." : t;
}

function baseOf(o: CstObject): string | undefined {
  return o.base.length ? tokenValue(o.base[0]) : undefined;
}

function objects(entries: readonly CstEntry[]): CstObject[] {
  return entries.filter((e): e is CstObject => e.kind === "object");
}

function isoOrUndef(ms: number | undefined): string | undefined {
  return ms === undefined ? undefined : new Date(ms).toISOString();
}

// ── .nmn and its tiles ───────────────────────────────────────────────────────

interface TileEntry {
  name: string;
  index: number;
  bytes: number;
  mtime?: string;
}

interface TileFolder {
  folder: string;
  source: "project" | "game" | "absent";
  tiles: TileEntry[];
  /** Files in the folder that are not `navData_<n>.ntile`. */
  other: number;
}

function tileFolder(nmn: Located, ctx: Ctx): TileFolder {
  const folder = navDataFolderOf(nmn.rel);
  const tiles: TileEntry[] = [];
  let other = 0;
  if (nmn.source === "project" && ctx.root) {
    const abs = resolve(ctx.root, folder);
    if (!existsSync(abs) || !statSync(abs).isDirectory()) {
      return { folder, source: "absent", tiles, other };
    }
    for (const d of readdirSync(abs, { withFileTypes: true })) {
      const index = d.isFile() ? tileIndexOf(d.name) : undefined;
      if (index === undefined) {
        other++;
        continue;
      }
      const st = statSync(join(abs, d.name));
      tiles.push({ name: d.name, index, bytes: st.size, mtime: st.mtime.toISOString() });
    }
    tiles.sort((a, b) => a.index - b.index);
    return { folder, source: "project", tiles, other };
  }
  const g = gameResolve(ctx.game, folder);
  if (!g) return { folder, source: "absent", tiles, other };
  for (const e of ctx.game!.listDir(g)) {
    const index = e.isDirectory ? undefined : tileIndexOf(e.name);
    if (index === undefined) {
      other++;
      continue;
    }
    tiles.push({ name: e.name, index, bytes: e.size });
  }
  tiles.sort((a, b) => a.index - b.index);
  return { folder: g, source: "game", tiles, other };
}

function tileSummary(t: TileFolder, nmnMtime?: string) {
  let bytes = 0;
  let newest: number | undefined;
  let oldest: number | undefined;
  let newer = 0;
  const nmnMs = nmnMtime ? Date.parse(nmnMtime) : undefined;
  for (const x of t.tiles) {
    bytes += x.bytes;
    if (x.mtime) {
      const ms = Date.parse(x.mtime);
      newest = newest === undefined ? ms : Math.max(newest, ms);
      oldest = oldest === undefined ? ms : Math.min(oldest, ms);
      if (nmnMs !== undefined && ms > nmnMs) newer++;
    }
  }
  return {
    folder: t.folder,
    source: t.source,
    count: t.tiles.length,
    bytes,
    ...(t.other ? { otherFiles: t.other } : {}),
    ...(newest !== undefined ? { newest: isoOrUndef(newest), oldest: isoOrUndef(oldest) } : {}),
    ...(nmnMs !== undefined && newest !== undefined ? { tilesNewerThanNmn: newer } : {}),
  };
}

function headerSummary(h: NmnHeader) {
  return {
    ok: h.ok,
    version: h.version,
    tileSize: h.tileSize,
    cells: h.observed?.cellsAt0x1c,
    ...(h.problems.length ? { problems: h.problems } : {}),
  };
}

/** A project file's GUID from its `.meta` (`Name "{GUID}..."`); undefined when there is none. */
function metaGuid(abs: string | undefined): string | undefined {
  if (!abs || !existsSync(`${abs}.meta`)) return undefined;
  try {
    const doc = parseCstBytes(readFileSync(`${abs}.meta`));
    const g = doc.get("Name");
    return g.kind === "scalar" && g.values[0] ? guidOf(g.values[0]) : undefined;
  } catch {
    return undefined;
  }
}

/** One referenced .nmn: where it is, its header and its tiles. */
function navmeshEntry(ref: string, ctx: Ctx, warnings: string[]) {
  let l: Located;
  try {
    l = locate(ref, ctx);
  } catch (e) {
    warnings.push(`${ref}: ${e instanceof Error ? e.message : String(e)}`);
    return { ref, resolves: false };
  }
  const guid = guidOf(ref);
  if (l.source === "absent" || !l.bytes) {
    warnings.push(`${ref} is in neither the project nor the game data`);
    return { ref, file: l.rel, resolves: false };
  }
  if (extOf(l.rel) !== ".nmn") warnings.push(`${ref} is not a .nmn`);
  const h = readNmnHeader(l.bytes);
  const t = tileFolder(l, ctx);
  if (t.source === "absent") warnings.push(`${l.rel}: no tile folder ${t.folder}`);
  const mg = l.source === "project" ? metaGuid(l.abs) : undefined;
  if (guid && mg && guid !== mg) {
    warnings.push(`${ref}: the GUID differs from the file's .meta (${mg})`);
  }
  return {
    ref,
    file: l.rel,
    resolves: true,
    source: l.source,
    ...(guid ? { guid } : {}),
    ...(mg !== undefined && guid ? { guidMatchesMeta: guid === mg } : {}),
    bytes: l.bytes.length,
    ...(l.mtime ? { mtime: l.mtime } : {}),
    header: headerSummary(h),
    tiles: tileSummary(t, l.mtime),
  };
}

// ── Navmesh files config (.conf) ─────────────────────────────────────────────

interface FilesConfig {
  file: string;
  source: Located["source"];
  rootClass?: string;
  ancestor?: string;
  navmeshFile?: string;
  /** Where NavmeshFile was found: this file or an ancestor. */
  navmeshFileFrom?: string;
  overrides?: string;
}

const MAX_CHAIN = 8;

/** A BaseNavmeshFilesConfig .conf and its ancestors (by `: "{GUID}path"`). */
function readFilesConfig(ref: string, ctx: Ctx, warnings: string[]): FilesConfig {
  const l = locate(ref, ctx);
  mustExist(l);
  const out: FilesConfig = { file: l.rel, source: l.source };
  let cur: Located & { bytes: Buffer } = l;
  const seen = new Set<string>();
  for (let depth = 0; depth < MAX_CHAIN; depth++) {
    seen.add(cur.rel.toLowerCase());
    const doc = parseCstBytes(cur.bytes);
    const root = doc.base;
    if (root.kind !== "object") {
      warnings.push(`${cur.rel} has no single root block`);
      break;
    }
    if (depth === 0) {
      out.rootClass = root.key;
      out.ancestor = baseOf(root);
      if (root.key !== "BaseNavmeshFilesConfig") {
        warnings.push(`${cur.rel}: the root class is ${root.key}, not BaseNavmeshFilesConfig`);
      }
    }
    if (out.navmeshFile === undefined) {
      const nf = scalarOf(root, "NavmeshFile");
      if (nf !== undefined) {
        out.navmeshFile = nf;
        out.navmeshFileFrom = cur.rel;
      }
    }
    if (out.overrides === undefined)
      out.overrides = rawOf(doc, childOf(root, NAVMESH_OVERRIDE_KEY));
    const anc = baseOf(root);
    if (!anc || out.navmeshFile !== undefined) break;
    const next = locate(anc, ctx);
    if (next.source === "absent" || !next.bytes || seen.has(next.rel.toLowerCase())) {
      if (next.source === "absent") warnings.push(`${cur.rel}: the ancestor ${anc} is not found`);
      break;
    }
    cur = next as Located & { bytes: Buffer };
  }
  return out;
}

// ── AIWorld (.ent, .layer, .et) ──────────────────────────────────────────────

interface NavComponent {
  id: string;
  project?: string;
  settingsClass?: string;
  tileSize?: string;
  mapMaxY?: string;
  streaming?: string;
  lowResolution?: string;
  filesConfigClass?: string;
  /** The `.conf` the inline config inherits from. */
  filesConfigRef?: string;
  /** NavmeshFile written inline in the entity or a prefab. */
  navmeshFile?: string;
  overrides?: string;
  /** Files that set something of this component, most derived first. */
  from: string[];
}

interface ChainLevel {
  file: string;
  doc: CstDocument;
  obj: CstObject;
}

/** The entity and the prefabs it inherits from, most derived first. */
function prefabChain(first: ChainLevel, ctx: Ctx, warnings: string[]): ChainLevel[] {
  const chain = [first];
  const seen = new Set([first.file.toLowerCase()]);
  let cur = first;
  while (chain.length < MAX_CHAIN) {
    const anc = baseOf(cur.obj);
    if (!anc) break;
    let l: Located;
    try {
      l = locate(anc, ctx);
    } catch {
      warnings.push(`${cur.file}: the prefab ${anc} cannot be read`);
      break;
    }
    if (l.source === "absent" || !l.bytes) {
      warnings.push(`${cur.file}: the prefab ${anc} is not found`);
      break;
    }
    if (seen.has(l.rel.toLowerCase())) break;
    seen.add(l.rel.toLowerCase());
    const doc = parseCstBytes(l.bytes);
    if (doc.base.kind !== "object") {
      warnings.push(`${l.rel} has no single root block`);
      break;
    }
    cur = { file: l.rel, doc, obj: doc.base };
    chain.push(cur);
  }
  return chain;
}

function navComponentsOf(obj: CstObject): { id: string; obj: CstObject }[] {
  const comps = objectOf(obj, "components");
  if (!comps) return [];
  return objects(comps.children)
    .filter((c) => c.key === "NavmeshWorldComponent")
    .map((c, i) => ({ id: c.head[1] ? tokenValue(c.head[1]) : `#${i}`, obj: c }));
}

function mergeComponents(chain: ChainLevel[]): NavComponent[] {
  const order: string[] = [];
  for (const lvl of [...chain].reverse()) {
    for (const c of navComponentsOf(lvl.obj)) if (!order.includes(c.id)) order.push(c.id);
  }
  return order.map((id) => {
    const out: NavComponent = { id, from: [] };
    const fill = <K extends keyof NavComponent>(k: K, v: NavComponent[K] | undefined): boolean => {
      if (v === undefined || out[k] !== undefined) return false;
      out[k] = v;
      return true;
    };
    for (const lvl of chain) {
      const c = navComponentsOf(lvl.obj).find((x) => x.id === id);
      if (!c) continue;
      let set = false;
      const ws = objectOf(c.obj, "WorldSettings");
      if (ws) {
        set = fill("tileSize", scalarOf(ws, "TileSize")) || set;
        set = fill("mapMaxY", scalarOf(ws, "MapMaxY")) || set;
      }
      const ns = objectOf(c.obj, "NavmeshSettings");
      if (ns) {
        set = fill("settingsClass", ns.head[1] ? tokenValue(ns.head[1]) : undefined) || set;
        set = fill("project", scalarOf(ns, "NavmeshProject")) || set;
        set = fill("streaming", scalarOf(ns, "UseNavmeshStreaming")) || set;
        set = fill("lowResolution", scalarOf(ns, "LowResolutionNavmesh")) || set;
        const fc = objectOf(ns, "NavmeshFilesConfig");
        if (fc) {
          set = fill("filesConfigClass", fc.head[1] ? tokenValue(fc.head[1]) : undefined) || set;
          set = fill("filesConfigRef", baseOf(fc)) || set;
          set = fill("navmeshFile", scalarOf(fc, "NavmeshFile")) || set;
          set = fill("overrides", rawOf(lvl.doc, childOf(fc, NAVMESH_OVERRIDE_KEY))) || set;
        }
      }
      if (set) out.from.push(lvl.file);
    }
    return out;
  });
}

/** The text files of a world: the file, and for a .ent its `<stem>_Layers/*.layer`. */
function worldFiles(l: Located & { bytes: Buffer }, ctx: Ctx): { file: string; bytes: Buffer }[] {
  const files = [{ file: l.rel, bytes: l.bytes }];
  if (extOf(l.rel) !== ".ent") return files;
  const layersRel = l.rel.replace(/\.ent$/i, "_Layers");
  if (l.source === "project" && ctx.root) {
    const abs = resolve(ctx.root, layersRel);
    if (existsSync(abs) && statSync(abs).isDirectory()) {
      for (const n of readdirSync(abs).sort()) {
        if (!n.toLowerCase().endsWith(".layer")) continue;
        const f = join(abs, n);
        if (statSync(f).isFile()) files.push({ file: `${layersRel}/${n}`, bytes: readFileSync(f) });
      }
    }
  } else if (l.source === "game") {
    const g = gameResolve(ctx.game, layersRel);
    if (g) {
      for (const e of ctx.game!.listDir(g)) {
        if (!e.isDirectory && e.name.toLowerCase().endsWith(".layer")) {
          files.push({ file: `${g}/${e.name}`, bytes: ctx.game!.readFile(`${g}/${e.name}`) });
        }
      }
    }
  }
  return files;
}

function aiWorldsOf(l: Located & { bytes: Buffer }, ctx: Ctx, warnings: string[]) {
  const found: { entity: string; class: string; prefab?: string; chain: ChainLevel[] }[] = [];
  for (const f of worldFiles(l, ctx)) {
    if (isBinaryText(f.bytes)) {
      warnings.push(
        `${f.file} is a binary (packed) world file: its entities are not readable offline; pass the world's AIWorld prefab (.et) or its navmesh files config (.conf)`,
      );
      continue;
    }
    const doc = parseCstBytes(f.bytes);
    const tops = doc.base.kind === "object" ? [doc.base] : objects(doc.root.children);
    for (const o of tops) {
      if (!/AIWorld/i.test(o.key)) continue;
      const name = o.head[1] ? tokenValue(o.head[1]) : undefined;
      const chain = prefabChain({ file: f.file, doc, obj: o }, ctx, warnings);
      found.push({
        entity: name ? `${f.file}:${name}` : f.file,
        class: o.key,
        prefab: baseOf(o),
        chain,
      });
    }
  }
  return found;
}

// ── Actions ──────────────────────────────────────────────────────────────────

function ok(
  action: string,
  target: string,
  readback: unknown,
  warnings: string[],
  next?: string,
  changed: Change[] | null = null,
): ActionResponse {
  return { ok: true, action, target, changed, readback, next, warnings };
}

function doStatus(args: NavmeshArgs, ctx: Ctx): ActionResponse {
  const l = locate(needPath(args), ctx);
  mustExist(l);
  const target = `path:${l.rel}`;
  const warnings: string[] = [];
  const ext = extOf(l.rel);
  if (ext === ".nmn") {
    return ok(
      "status",
      target,
      { kind: "navmesh", navmeshes: [navmeshEntry(l.rel, ctx, warnings)] },
      warnings,
    );
  }
  if (ext === ".conf") {
    const fc = readFilesConfig(l.rel, ctx, warnings);
    const navmeshes = fc.navmeshFile ? [navmeshEntry(fc.navmeshFile, ctx, warnings)] : [];
    if (!fc.navmeshFile) warnings.push(`${l.rel} lists no NavmeshFile`);
    return ok("status", target, { kind: "filesConfig", config: fc, navmeshes }, warnings);
  }
  if (ext === ".ent" || ext === ".layer" || ext === ".et") {
    const worlds = aiWorldsOf(l, ctx, warnings);
    if (worlds.length === 0) {
      warnings.push("no AIWorld entity found: a world needs one (SCR_AIWorld) for a navmesh");
    }
    const aiWorlds = worlds.map((w) => {
      const components = mergeComponents(w.chain).map((c) => {
        let config: FilesConfig | undefined;
        if (c.filesConfigRef) {
          try {
            config = readFilesConfig(c.filesConfigRef, ctx, warnings);
          } catch (e) {
            warnings.push(
              `${c.project ?? c.id}: the files config ${c.filesConfigRef}: ${e instanceof Error ? e.message : String(e)}`,
            );
          }
        }
        const nmn = c.navmeshFile ?? config?.navmeshFile;
        return {
          ...c,
          ...(config ? { filesConfig: config } : {}),
          navmesh: nmn ? navmeshEntry(nmn, ctx, warnings) : null,
        };
      });
      return {
        entity: w.entity,
        class: w.class,
        ...(w.prefab ? { prefab: w.prefab } : {}),
        chain: w.chain.map((x) => x.file),
        components,
      };
    });
    return ok("status", target, { kind: "world", aiWorlds }, warnings);
  }
  throw new Refusal(
    "INVALID_ARGUMENT",
    `status takes a world (.ent, .layer), an AIWorld prefab (.et), a navmesh files config (.conf) or a .nmn; got "${l.rel}"`,
  );
}

function doHeader(args: NavmeshArgs, ctx: Ctx): ActionResponse {
  const l = locate(needPath(args), ctx);
  requireExt(l.rel, [".nmn", ".ntile"], "header");
  mustExist(l);
  const h = extOf(l.rel) === ".nmn" ? readNmnHeader(l.bytes) : readNtileHeader(l.bytes);
  const warnings = h.ok ? [] : [`the header does not read as expected: ${h.problems.join("; ")}`];
  return ok(
    "header",
    `path:${l.rel}`,
    { source: l.source, ...(l.mtime ? { mtime: l.mtime } : {}), ...h },
    warnings,
    "Fields other than the magic, version, tile size and the IFF chunks are raw until probe P-W5-17 names them.",
  );
}

function doTiles(args: NavmeshArgs, ctx: Ctx): ActionResponse {
  const l = locate(needPath(args), ctx);
  requireExt(l.rel, [".nmn"], "tiles");
  mustExist(l);
  const t = tileFolder(l, ctx);
  const total = t.tiles.length;
  const limit = Math.min(Math.max(args.limit ?? LIMIT_DEFAULT, 1), LIMIT_MAX);
  let start = 0;
  if (args.cursor) {
    const c = parseCursor(args.cursor);
    checkCursor(c, total);
    start = c.start;
  }
  const warnings: string[] = [];
  if (t.source === "absent") warnings.push(`no tile folder ${t.folder}`);
  const next = nextCursor(start, limit, total);
  return ok(
    "tiles",
    `path:${l.rel}`,
    {
      summary: tileSummary(t, l.mtime),
      rows: t.tiles.slice(start, start + limit),
      total,
      count: Math.max(0, Math.min(limit, total - start)),
      ...(next ? { nextCursor: next } : {}),
    },
    warnings,
    next ? `More tiles: repeat with cursor:"${next}".` : undefined,
  );
}

function doConfig(args: NavmeshArgs, ctx: Ctx): ActionResponse {
  const l = locate(needPath(args), ctx);
  requireExt(l.rel, [".conf"], "config");
  mustExist(l);
  const warnings: string[] = [];
  const doc = parseCstBytes(l.bytes);
  const exact = doc.toBytes().equals(l.bytes);
  const fc = readFilesConfig(l.rel, ctx, warnings);
  const root = doc.base.kind === "object" ? doc.base : undefined;
  const known = new Set(["NavmeshFile", NAVMESH_OVERRIDE_KEY]);
  const otherKeys = root
    ? root.children
        .filter((c) => (c.kind === "object" || c.kind === "scalar") && !known.has(c.key))
        .map((c) => (c as CstObject).key)
    : [];
  let resolves: boolean | undefined;
  if (fc.navmeshFile) {
    try {
      const n = locate(fc.navmeshFile, ctx);
      resolves = n.source !== "absent";
      if (!resolves) warnings.push(`${fc.navmeshFile} is in neither the project nor the game data`);
    } catch (e) {
      resolves = false;
      warnings.push(`${fc.navmeshFile}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (doc.diagnostics.length) {
    warnings.push(
      `${doc.diagnostics.length} parse diagnostic(s), the first: ${doc.diagnostics[0].message}`,
    );
  }
  return ok(
    "config",
    `path:${l.rel}`,
    {
      ...fc,
      bytes: l.bytes.length,
      byteExact: exact,
      ...(resolves !== undefined ? { navmeshFileResolves: resolves } : {}),
      ...(otherKeys.length ? { otherKeys } : {}),
    },
    warnings,
    l.source === "game"
      ? "overrideConfig makes a project copy of this config at the same path."
      : "Edit it with config_edit set NavmeshFile.",
  );
}

// projects (.gproj NavmeshManager)

interface GprojFile {
  file: string;
  source: "project" | "game";
  bytes: Buffer;
}

function projectGproj(args: NavmeshArgs, ctx: Ctx): GprojFile | undefined {
  if (args.path) {
    if (!ctx.root) {
      throw new Refusal(
        "NOT_IN_PROJECT",
        "no project root: set ENFUSION_PROJECT_PATH or pass projectPath",
      );
    }
    const { rel, abs } = projectFile(args.path, ctx.root, "path");
    requireExt(rel, [".gproj"], "projects");
    if (!existsSync(abs)) throw new Refusal("PATH_NOT_FOUND", `no file "${rel}" in the project`);
    return { file: rel, source: "project", bytes: readFileSync(abs) };
  }
  if (!ctx.root || !existsSync(ctx.root)) return undefined;
  const names = readdirSync(ctx.root).filter((n) => n.toLowerCase().endsWith(".gproj"));
  if (names.length > 1) {
    throw new Refusal(
      "INVALID_ARGUMENT",
      `${names.length} .gproj files in the project root (${names.join(", ")}); pass path`,
    );
  }
  return names.length
    ? { file: names[0], source: "project", bytes: readFileSync(join(ctx.root, names[0])) }
    : undefined;
}

function gameGprojs(config: Config): GprojFile[] {
  const out: GprojFile[] = [];
  if (!config.gamePath) return out;
  const addons = join(config.gamePath, "addons");
  try {
    for (const d of readdirSync(addons, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      for (const f of readdirSync(join(addons, d.name)).sort()) {
        if (!f.toLowerCase().endsWith(".gproj")) continue;
        out.push({
          file: `addons/${d.name}/${f}`,
          source: "game",
          bytes: readFileSync(join(addons, d.name, f)),
        });
      }
    }
  } catch {
    // no game install: nothing from the game
  }
  return out;
}

function managersOf(doc: CstDocument): { configuration?: string; obj: CstObject }[] {
  const out: { configuration?: string; obj: CstObject }[] = [];
  const walk = (entries: readonly CstEntry[], conf: string | undefined): void => {
    for (const o of objects(entries)) {
      const c = o.key === "GameProjectConfig" && o.head[1] ? tokenValue(o.head[1]) : conf;
      if (o.key === "NavmeshManager") out.push({ configuration: c, obj: o });
      else walk(o.children, c);
    }
  };
  walk(doc.root.children, undefined);
  return out;
}

function navProjectsOf(m: CstObject, configuration: string | undefined) {
  const ps = objectOf(m, "ProjectSettings");
  if (!ps) return [];
  const named = (o: CstObject) => (o.head[1] ? tokenValue(o.head[1]) : "");
  return objects(ps.children).map((p) => {
    const flags = objectOf(p, "FlagTypes");
    const areas = objectOf(p, "AreaTypes");
    const conv = objectOf(p, "ResponseIndexToAreaTypeConversion");
    const known = new Set([
      "PhysicsInteractionLayer",
      "DefaultWalkableFlags",
      "AreaTypeForTerrain",
      "FlagTypes",
      "AreaTypes",
      "ResponseIndexToAreaTypeConversion",
    ]);
    const otherKeys = p.children
      .filter((c) => (c.kind === "object" || c.kind === "scalar") && !known.has(c.key))
      .map((c) => (c as CstObject).key);
    return {
      name: named(p),
      class: p.key,
      ...(configuration ? { configuration } : {}),
      physicsInteractionLayer: scalarOf(p, "PhysicsInteractionLayer"),
      defaultWalkableFlags: scalarOf(p, "DefaultWalkableFlags"),
      areaTypeForTerrain: scalarOf(p, "AreaTypeForTerrain"),
      flagTypes: flags ? objects(flags.children).map(named) : [],
      areaTypes: areas
        ? objects(areas.children).map((a) => ({
            name: named(a),
            areaFlags: scalarOf(a, "AreaFlags"),
            areaCost: scalarOf(a, "AreaCost"),
          }))
        : [],
      responseIndexConversions: conv
        ? objects(conv.children).map((x) => ({
            responseIndex: scalarOf(x, "ResponseIndex"),
            areaType: scalarOf(x, "AreaType"),
          }))
        : [],
      ...(otherKeys.length ? { otherKeys } : {}),
    };
  });
}

function doProjects(args: NavmeshArgs, ctx: Ctx): ActionResponse {
  const warnings: string[] = [];
  const own = projectGproj(args, ctx);
  const read = (g: GprojFile) => {
    const doc = parseCstBytes(g.bytes);
    return managersOf(doc).flatMap((m) => navProjectsOf(m.obj, m.configuration));
  };
  let from: GprojFile | undefined;
  let projects: ReturnType<typeof navProjectsOf> = [];
  if (own) {
    projects = read(own);
    from = own;
    if (projects.length === 0) {
      warnings.push(
        `${own.file} sets no NavmeshManager navmesh projects: the game's settings apply`,
      );
    }
  }
  if (projects.length === 0 && !args.path) {
    for (const g of gameGprojs(ctx.config)) {
      const p = read(g);
      if (p.length) {
        projects = p;
        from = g;
        break;
      }
    }
  }
  if (!from) {
    throw new Refusal(
      "PATH_NOT_FOUND",
      "no .gproj with navmesh projects in the project or the game install",
      "Set ENFUSION_PROJECT_PATH (or projectPath) or ENFUSION_GAME_PATH.",
    );
  }
  const limit = Math.min(Math.max(args.limit ?? LIMIT_DEFAULT, 1), LIMIT_MAX);
  return ok(
    "projects",
    `path:${from.file}`,
    {
      source: from.source,
      file: from.file,
      total: projects.length,
      projects: projects.slice(0, limit),
      ...(projects.length > limit ? { truncated: true } : {}),
    },
    warnings,
    from.source === "game"
      ? "These are the game's navmesh projects; a project .gproj overrides them (project_settings)."
      : undefined,
  );
}

// overrideConfig

function normalizeNmnRef(raw: string, warnings: string[]): string {
  const t = raw.trim();
  const m = /^(\{[0-9A-Fa-f]{16}\})?([^"\r\n{}]+)$/.exec(t);
  if (!m || /[\\]$/.test(t)) {
    throw new Refusal(
      "INVALID_ARGUMENT",
      `navmeshFile must be {GUID}path.nmn or a path, got: ${raw}`,
    );
  }
  const path = checkRelativePath(m[2]);
  if (extOf(path) !== ".nmn")
    throw new Refusal("INVALID_ARGUMENT", `navmeshFile must name a .nmn, got: ${raw}`);
  if (!m[1]) {
    warnings.push(
      "navmeshFile has no GUID: the engine resolves it by path; register the .nmn and pass {GUID}path to bind it",
    );
    return path;
  }
  return `${m[1].toUpperCase()}${path}`;
}

function doOverrideConfig(args: NavmeshArgs, ctx: Ctx): ActionResponse {
  const raw = needPath(args);
  if (args.overrides && args.overrides.length > 0 && !NAVMESH_OVERRIDE_ARRAY_PROVEN) {
    throw new Refusal(
      "GATED",
      `appending partial navmeshes waits for its proof: the override array key of BaseNavmeshFilesConfig as the Workbench writes it is unverified (the exe shows ${NAVMESH_OVERRIDE_KEY}; no vanilla config uses it). Nothing was written`,
      "Copy the config without overrides, then add them in the Workbench (or config_edit) and read it back with navmesh config.",
    );
  }
  if (!ctx.root) {
    throw new Refusal(
      "NOT_IN_PROJECT",
      "no project root: set ENFUSION_PROJECT_PATH or pass projectPath",
    );
  }
  const { rel, abs } = projectFile(raw, ctx.root, "path");
  requireExt(rel, [".conf"], "overrideConfig");
  const g = gameResolve(ctx.game, rel);
  if (!g) {
    throw new Refusal(
      "PATH_NOT_FOUND",
      `no game resource "${rel}": overrideConfig copies a navmesh files config of the game`,
      "List them with game_browse Configs/Navmesh.",
    );
  }
  const vanilla = ctx.game!.readFile(g);
  const vdoc = parseCstBytes(vanilla);
  if (vdoc.base.kind !== "object" || vdoc.base.key !== "BaseNavmeshFilesConfig") {
    throw new Refusal("INVALID_ARGUMENT", `${g} is not a BaseNavmeshFilesConfig`);
  }
  if (!vdoc.toBytes().equals(vanilla) || vdoc.diagnostics.length) {
    throw new Refusal(
      "INVALID_ARGUMENT",
      `${g} does not parse back byte for byte: nothing written`,
    );
  }
  const warnings: string[] = [];
  const before = scalarOf(vdoc.base, "NavmeshFile") ?? null;
  let bytes = vanilla;
  const changed: Change[] = [{ path: "file", before: null, after: rel }];
  if (args.navmeshFile !== undefined) {
    const ref = normalizeNmnRef(args.navmeshFile, warnings);
    try {
      if (locate(ref, ctx).source === "absent")
        warnings.push(`${ref} is in neither the project nor the game data yet`);
    } catch {
      warnings.push(`${ref} cannot be checked`);
    }
    vdoc.set("NavmeshFile", ref, { quoted: true });
    bytes = vdoc.toBytes();
    changed.push({ path: "NavmeshFile", before, after: ref });
    if (before === ref) warnings.push("NavmeshFile already is this: the copy is the vanilla file");
  }
  const exists = existsSync(abs);
  if (exists && args.overwrite !== true) {
    throw new Refusal(
      "INVALID_ARGUMENT",
      `${rel} already exists in the project; pass overwrite:true to replace it (a .bak is kept)`,
      "Nothing was written. Read it with navmesh config, or edit it with config_edit.",
    );
  }
  warnings.push(
    "the copy sits at the game file's own path; whether the engine takes it over the game's file is checked live, not here",
  );
  const text = bytes.toString(vdoc.encoding);
  const readback: Record<string, unknown> = {
    dryRun: args.confirm !== true,
    created: rel,
    from: g,
    bytes: bytes.length,
    replaces: exists,
    diff: lineDiff(vanilla.toString(vdoc.encoding), text),
    text,
  };
  const register = `wb_resources register path:${rel}`;
  if (args.confirm !== true) {
    return ok(
      "overrideConfig",
      `path:${rel}`,
      readback,
      warnings,
      `Nothing was written. Repeat with confirm:true to write the copy, then ${register}.`,
      changed,
    );
  }
  let backupName = "";
  if (exists) {
    // A numbered backup: an earlier .bak (the first original bytes) is kept (review round 1, W4-AS-1).
    const b = backUp(abs, (m) => {
      throw new Refusal("INVALID_ARGUMENT", m);
    });
    backupName = backupRel(rel, abs, b);
    readback.backup = backupName;
  }
  mkdirSync(dirname(abs), { recursive: true });
  writeFileAtomic(abs, bytes);
  const verified = readFileSync(abs).equals(bytes);
  // A read-back that differs is a failed write, as audio and particle answer it (review round 1,
  // W5-02): never ok, and never a next that says Written.
  if (!verified) {
    throw new Refusal(
      "SAVE_FAILED",
      `the file read back differs from what was written: ${rel} may be corrupt`,
      backupName
        ? `Restore ${backupName} over ${rel}, or delete ${rel}; do not register it.`
        : `Delete ${rel} (it was new); do not register it.`,
    );
  }
  readback.written = true;
  readback.verified = verified;
  return ok(
    "overrideConfig",
    `path:${rel}`,
    readback,
    warnings,
    `Written. The Workbench does not know it yet: ${register}. To undo, delete the file${backupName ? ` or restore ${backupName}` : ""}.`,
    changed,
  );
}

// ── Entry point ──────────────────────────────────────────────────────────────

/** One call of the tool; never throws. `game` replaces the paks (tests). */
export function runNavmesh(
  args: NavmeshArgs,
  config: Config,
  game?: GameFiles | null,
): ActionResponse {
  const target = args.path ? `path:${stripRef(args.path)}` : "path:";
  try {
    const ctx: Ctx = {
      root: pinnedProjectRoot(args.projectPath, config.projectPath),
      game: game === undefined ? defaultGame(config) : game,
      config,
    };
    switch (args.action) {
      case "status":
        return doStatus(args, ctx);
      case "header":
        return doHeader(args, ctx);
      case "tiles":
        return doTiles(args, ctx);
      case "config":
        return doConfig(args, ctx);
      case "projects":
        return doProjects(args, ctx);
      case "overrideConfig":
        return doOverrideConfig(args, ctx);
      default:
        throw new Refusal("INVALID_ARGUMENT", `unknown action ${String(args.action)}`);
    }
  } catch (e) {
    return failure(String(args.action), target, e);
  }
}

export const NAVMESH_INPUT_SCHEMA = {
  action: z.enum(NAVMESH_ACTIONS),
  path: z
    .string()
    .optional()
    .describe(
      "status: .ent/.layer/.et/.conf/.nmn; header: .nmn/.ntile; tiles: .nmn; config, overrideConfig: .conf; projects: .gproj (default the project's). Project-relative or a game path.",
    ),
  cursor: z.string().optional().describe("tiles: the nextCursor of the page before."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(LIMIT_MAX)
    .optional()
    .describe("tiles, projects: rows (default 100)."),
  navmeshFile: z
    .string()
    .optional()
    .describe("overrideConfig: the {GUID}path.nmn the copy points at."),
  overrides: z
    .array(z.string())
    .optional()
    .describe("overrideConfig: partial .nmn files to append (gated)."),
  overwrite: z
    .boolean()
    .optional()
    .describe("overrideConfig: replace a project file (a .bak is kept)."),
  confirm: z.boolean().optional().describe("overrideConfig: true writes; otherwise a dry run."),
  projectPath: z
    .string()
    .optional()
    .describe("Addon root. Uses the configured project when omitted."),
};

export function registerNavmesh(server: McpServer, config: Config): void {
  server.registerTool(
    "navmesh",
    { description: NAVMESH_DESCRIPTION, inputSchema: NAVMESH_INPUT_SCHEMA },
    async (args) => {
      const res = runNavmesh(args as NavmeshArgs, config);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(res, null, 2) }],
        isError: !res.ok,
      };
    },
  );
}
