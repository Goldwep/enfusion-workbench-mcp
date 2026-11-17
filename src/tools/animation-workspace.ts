/**
 * `animation_workspace`: read, check, copy and edit animation workspaces (`.aw`) as files.
 *
 * A workspace is Enfusion text (`BaseSource`) that links an animation graph (`.agr`, with its `.agf`
 * sheets), a set template (`.ast`), set instances (`.asi`), optional expression and sync tables
 * (`.aex`, `.asy`), preview models (`.xob`) and audio projects (`.acp`). Every link is a quoted
 * `{GUID}path` string. The lossless parser in src/formats/enfusion-cst.ts is the model: edits splice
 * the text and the bytes outside the edit never change.
 *
 * Reads take a project file or a game resource (read from the paks). A link resolves by its path in
 * the project first (its `.meta` GUID must agree) and in the paks second; the paks hold no `.meta`.
 *
 *   read                  the workspace's own links, each resolved
 *   files (paged)         the whole file set: aw -> agr -> agf, aw -> ast, asi (-> asi), aex, asy, ae,
 *                         and the outside links (xob, anm, acp) with GUIDs and paths
 *   validate (paged)      dangling GUIDs, missing files, asi templates that are not the workspace's ast
 *   duplicate             copies the set into the project, registers every copy through
 *                         wb_resources register (new GUIDs), rewrites every internal link; DEC-067 OD-5
 *   set                   one link of an existing project workspace
 *   create                a new workspace (and an empty event table `.ae`)
 *
 * Writes stay inside the project root, are a dry run unless `confirm: true`, and refuse a file the
 * parser cannot give back byte for byte. `set` leaves a `.bak` of the file it changed. No action is
 * gated. Engine calls go only through `registerProjectFile` (duplicate and create).
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { writeFileAtomic } from "../utils/atomic-write.js";
import { backUp, backupRel } from "../utils/backup.js";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { z } from "zod";
import type { Config } from "../config.js";
import {
  CstDocument,
  CstEditError,
  parseCst,
  parseCstBytes,
  tokenValue,
  type Token,
} from "../formats/enfusion-cst.js";
import { generateGuid } from "../formats/guid.js";
import {
  ERROR_CODES,
  LIMIT_DEFAULT,
  LIMIT_MAX,
  VocabularyError,
  checkCursor,
  checkRelativePath,
  errorResponse,
  nextCursor,
  parseCursor,
  type ActionError,
  type ActionOk,
  type Change,
  type ErrorCode,
} from "../manifest/vocabulary.js";
import { PakVirtualFS } from "../pak/vfs.js";
import { assertInsideRoot, isPathInsideRoot, pinnedProjectRoot } from "../utils/path-guard.js";
import { unifiedDiff } from "./imageset.js";
import { codeOfClientError } from "./wb-module.js";
import {
  registerProjectFile,
  type RegisterFileResult,
  type ResourcesClient,
} from "./wb-resources.js";

// ── Errors ───────────────────────────────────────────────────────────────────

/**
 * The duplicate could not rewrite every internal GUID, so nothing is left half-linked (a
 * vocabulary code since W4).
 */
export const REWRITE_INCOMPLETE = "REWRITE_INCOMPLETE" as const;
export const REWRITE_INCOMPLETE_NEXT = ERROR_CODES.REWRITE_INCOMPLETE;

type WorkspaceCode = ErrorCode;
export type WorkspaceError = ActionError;
export type WorkspaceOk = ActionOk & { dryRun?: boolean };
export type WorkspaceResponse = WorkspaceOk | WorkspaceError;

/** A refusal with a code. */
export class WorkspaceRefusal extends Error {
  constructor(
    readonly code: WorkspaceCode,
    message: string,
    readonly next?: string,
  ) {
    super(message);
    this.name = "WorkspaceRefusal";
  }
}

const bad = (message: string): never => {
  throw new WorkspaceRefusal("INVALID_ARGUMENT", message);
};

function refusal(action: string, target: string, e: WorkspaceRefusal): WorkspaceError {
  return errorResponse(action, target, e.code, e.message, e.next);
}

// ── References ───────────────────────────────────────────────────────────────

/** Extensions of the files a duplicate copies (the workspace itself is the root). */
export const SET_EXTS = ["agr", "agf", "ast", "asi", "ae", "aex", "asy"] as const;
const SET_EXT_SET: ReadonlySet<string> = new Set(SET_EXTS);
/** Extensions whose text this tool reads for further links. */
const TEXT_EXTS: ReadonlySet<string> = new Set([...SET_EXTS, "aw"]);

const REF = /^\{([0-9A-Fa-f]{16})\}(.*)$/;
/** Largest set a duplicate will copy (the largest vanilla set is far smaller). */
export const MAX_DUPLICATE_FILES = 300;

export interface RefTok {
  /** Index into `doc.tokens`. */
  at: number;
  token: Token;
  /** 16 hex, upper case. */
  guid: string;
  /** Resource path after the `{GUID}`; "" for a bare object id. */
  path: string;
  /** Lower-case extension of `path`, "" when none. */
  ext: string;
  /** The key the link sits under (`AnimGraph`), or the array's key for a list item. */
  role: string;
}

/** The last segment of a path, cut at "/" or "\\" (review round 1, W4-AW-1). */
const baseOf = (path: string): string =>
  path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
const extOf = (path: string): string => {
  const base = baseOf(path);
  const i = base.lastIndexOf(".");
  return i < 0 ? "" : base.slice(i + 1).toLowerCase();
};
const stemOf = (path: string): string => {
  const base = baseOf(path);
  const i = base.lastIndexOf(".");
  return i < 0 ? base : base.slice(0, i);
};
const dirOf = (path: string): string => {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
};
const joinRel = (dir: string, name: string): string => (dir ? `${dir}/${name}` : name);

/** Every `"{GUID}path"` string of a document, with the key it sits under. Object ids (no path) are skipped. */
export function scanRefs(doc: CstDocument): RefTok[] {
  const out: RefTok[] = [];
  const toks = doc.tokens;
  const stack: string[] = [];
  let lineFirstWord = "";
  let prevSig: Token | undefined;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.kind === "eol") {
      lineFirstWord = "";
      prevSig = undefined;
      continue;
    }
    if (t.kind === "ws" || t.kind === "comment") continue;
    if (t.kind === "word" && lineFirstWord === "") lineFirstWord = t.text;
    if (t.kind === "lbrace") stack.push(lineFirstWord);
    else if (t.kind === "rbrace") stack.pop();
    else if (t.kind === "string" && t.text.endsWith('"') && t.text.length >= 2) {
      const m = REF.exec(tokenValue(t));
      if (m && m[2] !== "") {
        const role =
          prevSig && prevSig.kind === "word" ? prevSig.text : (stack[stack.length - 1] ?? "");
        out.push({
          at: i,
          token: t,
          guid: m[1].toUpperCase(),
          path: m[2],
          ext: extOf(m[2]),
          role,
        });
      }
    }
    prevSig = t;
  }
  return out;
}

/** The document's text with chosen links replaced; every other byte is untouched. */
export function renderWith(
  doc: CstDocument,
  refs: readonly RefTok[],
  pick: (r: RefTok) => string | undefined,
): string {
  const rep = new Map<number, string>();
  for (const r of refs) {
    const v = pick(r);
    if (v !== undefined) rep.set(r.at, `"${v}"`);
  }
  let s = "";
  doc.tokens.forEach((t, i) => {
    s += rep.get(i) ?? t.text;
  });
  return s;
}

// ── Where files live ─────────────────────────────────────────────────────────

/** The two pak calls this tool needs (a fake in tests). */
export interface PakLike {
  exists(path: string): boolean;
  readFile(path: string): Buffer;
}

export interface Env {
  /** Absolute project root, when known. */
  root?: string;
  vfs: PakLike | null;
}

export type LinkStatus = "project" | "game" | "unresolved" | "guid-mismatch";

export interface Resolved {
  status: LinkStatus;
  /** The `.meta` GUID that disagreed (guid-mismatch). */
  metaGuid?: string;
}

function metaGuidOf(file: string): string | undefined {
  const meta = `${file}.meta`;
  if (!existsSync(meta)) return undefined;
  try {
    const doc = parseCst(readFileSync(meta, "utf-8"));
    const base = doc.base;
    for (const c of base.children) {
      if (c.kind === "scalar" && c.key === "Name" && c.values.length) {
        const m = REF.exec(tokenValue(c.values[0]));
        if (m) return m[1].toUpperCase();
      }
    }
  } catch {
    // an unreadable meta is no GUID
  }
  return undefined;
}

function projectFile(env: Env, path: string): string | undefined {
  if (!env.root) return undefined;
  const file = resolve(env.root, path);
  try {
    assertInsideRoot(file, env.root, "path");
    return existsSync(file) && statSync(file).isFile() ? file : undefined;
  } catch {
    return undefined;
  }
}

export function resolveRef(env: Env, guid: string, path: string): Resolved {
  if (path === "") return { status: "unresolved" };
  const file = projectFile(env, path);
  if (file) {
    const meta = metaGuidOf(file);
    if (meta !== undefined && meta !== guid.toUpperCase())
      return { status: "guid-mismatch", metaGuid: meta };
    return { status: "project" };
  }
  try {
    if (env.vfs?.exists(path)) return { status: "game" };
  } catch {
    // an unreadable pak is no resolution
  }
  return { status: "unresolved" };
}

function loadBytes(env: Env, path: string, status: LinkStatus): Buffer | undefined {
  try {
    if (status === "project") return readFileSync(projectFile(env, path)!);
    if (status === "game") return env.vfs!.readFile(path);
  } catch {
    // fall through
  }
  return undefined;
}

// ── The file set ─────────────────────────────────────────────────────────────

export interface SetNode {
  /** 16 hex, upper case; "" for the root when the workspace has no known GUID. */
  guid: string;
  path: string;
  ext: string;
  status: LinkStatus;
  role: string;
  depth: number;
  /** Paths of the files that link to it. */
  via: string[];
  /** True for a file a duplicate copies. */
  copy: boolean;
}

export interface Closure {
  nodes: SetNode[];
  /** Text of every traversed file, by node key. */
  text: Map<string, { doc: CstDocument; buf: Buffer; refs: RefTok[] }>;
  rootKey: string;
}

const keyOf = (n: { guid: string; path: string }): string => n.guid || `path:${n.path}`;

/** Walks the links of a workspace through every text file of the set. */
export function closureOf(
  env: Env,
  root: { guid?: string; path: string; buf: Buffer; status: LinkStatus },
): Closure {
  const text: Closure["text"] = new Map();
  const nodes = new Map<string, SetNode>();
  const rootNode: SetNode = {
    guid: root.guid?.toUpperCase() ?? "",
    path: root.path,
    ext: extOf(root.path),
    status: root.status,
    role: "",
    depth: 0,
    via: [],
    copy: false,
  };
  const rootKey = keyOf(rootNode);
  nodes.set(rootKey, rootNode);
  const queue: SetNode[] = [rootNode];
  const parse = (n: SetNode, buf: Buffer) => {
    const doc = parseCstBytes(buf);
    text.set(keyOf(n), { doc, buf, refs: scanRefs(doc) });
  };
  parse(rootNode, root.buf);
  while (queue.length) {
    const n = queue.shift()!;
    const entry = text.get(keyOf(n));
    if (!entry) continue;
    for (const r of entry.refs) {
      const k = r.guid;
      const seen = nodes.get(k);
      if (seen) {
        if (!seen.via.includes(n.path)) seen.via.push(n.path);
        continue;
      }
      const res = resolveRef(env, r.guid, r.path);
      const child: SetNode = {
        guid: r.guid,
        path: r.path,
        ext: r.ext,
        status: res.status,
        role: r.role,
        depth: n.depth + 1,
        via: [n.path],
        copy: SET_EXT_SET.has(r.ext),
      };
      nodes.set(k, child);
      if (TEXT_EXTS.has(r.ext) && (res.status === "project" || res.status === "game")) {
        const buf = loadBytes(env, r.path, res.status);
        if (buf) {
          parse(child, buf);
          queue.push(child);
        }
      }
    }
  }
  return { nodes: [...nodes.values()], text, rootKey };
}

// ── Locating the request's files ─────────────────────────────────────────────

interface Located {
  /** Resource path, forward slashes. */
  rel: string;
  /** Absolute project file, when a project root is known. */
  file?: string;
  root?: string;
  /** GUID given in front of the path. */
  guid?: string;
}

function locate(rawPath: string, root: string | undefined, ext: string, what: string): Located {
  let p = String(rawPath ?? "").trim();
  let guid: string | undefined;
  const m = /^\{([0-9A-Fa-f]{16})\}/.exec(p);
  if (m) {
    guid = m[1].toUpperCase();
    p = p.slice(m[0].length);
  }
  if (p.startsWith("-")) bad("paths starting with '-' are rejected");
  const rootAbs = root ? resolve(root) : undefined;
  if (isAbsolute(p) || /^[A-Za-z]:/.test(p)) {
    if (!rootAbs)
      throw new WorkspaceRefusal(
        "NOT_IN_PROJECT",
        "no project root is configured for an absolute path",
      );
    const rel = relative(rootAbs, resolve(p));
    if (rel === "" || isAbsolute(rel) || rel.split(/[\\/]/)[0] === "..")
      throw new WorkspaceRefusal("NOT_IN_PROJECT", `${rawPath} is outside the project ${rootAbs}`);
    p = rel.replace(/\\/g, "/");
  }
  const rel = checkRelativePath(p);
  if (!rel.toLowerCase().endsWith(`.${ext}`)) bad(`"${rel}" is not ${what} (.${ext})`);
  if (!rootAbs) return { rel, guid };
  const file = resolve(rootAbs, rel);
  try {
    assertInsideRoot(file, rootAbs, "path");
  } catch (e) {
    throw new WorkspaceRefusal("NOT_IN_PROJECT", e instanceof Error ? e.message : String(e));
  }
  return { rel, file, root: rootAbs, guid };
}

function vfsOf(config: Config): PakLike | null {
  try {
    return config.gamePath ? PakVirtualFS.get(config.gamePath) : null;
  } catch {
    return null;
  }
}

interface Source {
  loc: Located;
  buf: Buffer;
  game: boolean;
  doc: CstDocument;
  guid?: string;
}

function isWorkspace(doc: CstDocument): boolean {
  const b = doc.base;
  return b.kind === "object" && b.key === "BaseSource";
}

/** Loads the workspace the request names: a project file, else a game resource. */
function loadWorkspace(req: WorkspaceRequest, env: Env): Source {
  const loc = locate(req.path ?? "", env.root, "aw", "a workspace");
  let buf: Buffer | undefined;
  let game = false;
  if (loc.file && existsSync(loc.file)) {
    if (!statSync(loc.file).isFile()) bad(`${loc.rel} is not a file`);
    buf = readFileSync(loc.file);
  } else if (env.vfs?.exists(loc.rel)) {
    buf = env.vfs.readFile(loc.rel);
    game = true;
  }
  if (!buf)
    throw new WorkspaceRefusal(
      "PATH_NOT_FOUND",
      `no workspace at "${loc.rel}": not a file${loc.root ? ` under ${loc.root}` : ""} and not in the game data` +
        (env.vfs ? "" : " (game paks not available: ENFUSION_GAME_PATH)"),
    );
  const doc = parseCstBytes(buf);
  if (!isWorkspace(doc)) bad(`${loc.rel} is not a workspace: the root is not one BaseSource block`);
  const guid = loc.guid ?? (loc.file && !game ? metaGuidOf(loc.file) : undefined);
  return { loc, buf, game, doc, guid };
}

// ── Requests ─────────────────────────────────────────────────────────────────

export const ACTIONS = ["read", "files", "validate", "duplicate", "set", "create"] as const;
export type WorkspaceAction = (typeof ACTIONS)[number];

export const SET_FIELDS = [
  "AnimGraph",
  "AnimSetTemplate",
  "AnimSetInstances",
  "Model",
  "ExpressionTable",
  "SyncTable",
  "ProjectFile",
] as const;
export type SetField = (typeof SET_FIELDS)[number];

const FIELD_EXT: Record<SetField, string> = {
  AnimGraph: "agr",
  AnimSetTemplate: "ast",
  AnimSetInstances: "asi",
  Model: "xob",
  ExpressionTable: "aex",
  SyncTable: "asy",
  ProjectFile: "acp",
};

export interface WorkspaceRequest {
  action: WorkspaceAction;
  /** The workspace: project-relative, absolute inside the project, `{GUID}path`, or a game path (reads and duplicate). */
  path?: string;
  projectPath?: string;
  /** duplicate/create: the new `.aw`. */
  target?: string;
  confirm?: boolean;
  cursor?: string;
  limit?: number;
  /** set */
  field?: SetField;
  value?: string;
  values?: string[];
  index?: number;
  /** create */
  animSetTemplate?: string;
  animGraph?: string;
  animSetInstances?: string[];
  model?: string;
  eventTable?: string;
  skipEventTable?: boolean;
}

// ── Ok response ──────────────────────────────────────────────────────────────

function okResponse(
  action: string,
  rel: string,
  changed: Change[] | null,
  readback: unknown,
  warnings: string[],
  next?: string,
  dryRun?: boolean,
): WorkspaceOk {
  const r: WorkspaceOk = {
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

const asRef = (n: { guid: string; path: string }): string => `{${n.guid}}${n.path}`;

// ── read ─────────────────────────────────────────────────────────────────────

const KNOWN_EXTS: ReadonlySet<string> = new Set([
  "ast",
  "agr",
  "asi",
  "aex",
  "asy",
  "ae",
  "xob",
  "acp",
]);

interface LinkView {
  role: string;
  ref: string;
  guid: string;
  path: string;
  ext: string;
  status: LinkStatus;
}

function linksOf(env: Env, refs: readonly RefTok[]): LinkView[] {
  return refs.map((r) => ({
    role: r.role,
    ref: `{${r.guid}}${r.path}`,
    guid: r.guid,
    path: r.path,
    ext: r.ext,
    status: resolveRef(env, r.guid, r.path).status,
  }));
}

function readAction(req: WorkspaceRequest, env: Env): WorkspaceResponse {
  const src = loadWorkspace(req, env);
  const refs = scanRefs(src.doc);
  const links = linksOf(env, refs);
  const pick = (role: string) => links.filter((l) => l.role === role);
  const warnings: string[] = [];
  if (src.game)
    warnings.push("game resource (read only): duplicate copies the set into the project");
  for (const l of links) {
    if (l.status === "unresolved")
      warnings.push(`${l.role}: ${l.ref} is in neither the project nor the game data`);
    if (l.status === "guid-mismatch")
      warnings.push(`${l.role}: ${l.ref} names a GUID the project's .meta does not carry`);
  }
  // The graph's own links (tables and sheets), one hop down.
  const agr = links.find((l) => l.role === "AnimGraph" && l.status !== "unresolved");
  let graph: unknown;
  if (agr) {
    const buf = loadBytes(env, agr.path, agr.status);
    if (buf) {
      const gl = linksOf(env, scanRefs(parseCstBytes(buf)));
      graph = {
        ref: agr.ref,
        template: gl.find((l) => l.ext === "ast")?.ref,
        expressionTable: gl.find((l) => l.ext === "aex")?.ref,
        syncTable: gl.find((l) => l.ext === "asy")?.ref,
        sheets: gl.filter((l) => l.ext === "agf").map((l) => l.ref),
      };
    }
  }
  return okResponse(
    "read",
    src.loc.rel,
    null,
    {
      source: src.game ? "game" : "project",
      bytes: src.buf.length,
      guid: src.guid,
      animSetTemplate: pick("AnimSetTemplate")[0],
      animGraph: pick("AnimGraph")[0],
      animSetInstances: links.filter((l) => l.ext === "asi"),
      expressionTable: pick("ExpressionTable")[0],
      syncTable: pick("SyncTable")[0],
      eventTables: links.filter((l) => l.ext === "ae"),
      models: links.filter((l) => l.ext === "xob"),
      audioProjects: links.filter((l) => l.ext === "acp"),
      otherLinks: links.filter((l) => !KNOWN_EXTS.has(l.ext)),
      graph,
    },
    warnings.slice(0, 50),
  );
}

// ── files ────────────────────────────────────────────────────────────────────

function countsOf(
  nodes: readonly SetNode[],
): Record<string, { total: number; unresolved: number }> {
  const out: Record<string, { total: number; unresolved: number }> = {};
  for (const n of nodes) {
    const e = (out[n.ext || "(none)"] ??= { total: 0, unresolved: 0 });
    e.total++;
    if (n.status === "unresolved" || n.status === "guid-mismatch") e.unresolved++;
  }
  return out;
}

export interface FilesResult {
  nodes: SetNode[];
  counts: Record<string, { total: number; unresolved: number }>;
  closure: Closure;
  src: Source;
}

/** The file set of a workspace (the corpus gates call this). */
export function filesOf(req: WorkspaceRequest, env: Env): FilesResult {
  const src = loadWorkspace(req, env);
  const closure = closureOf(env, {
    guid: src.guid,
    path: src.loc.rel,
    buf: src.buf,
    status: src.game ? "game" : "project",
  });
  return { nodes: closure.nodes, counts: countsOf(closure.nodes), closure, src };
}

function page<T>(rows: T[], req: WorkspaceRequest) {
  const limit = Math.min(req.limit ?? LIMIT_DEFAULT, LIMIT_MAX);
  const cur = req.cursor === undefined ? { start: 0, count: rows.length } : parseCursor(req.cursor);
  if (req.cursor !== undefined) checkCursor(cur, rows.length);
  return {
    rows: rows.slice(cur.start, cur.start + limit),
    nextCursor: nextCursor(cur.start, limit, rows.length),
    total: rows.length,
  };
}

function filesAction(req: WorkspaceRequest, env: Env): WorkspaceResponse {
  const { nodes, counts, src } = filesOf(req, env);
  const p = page(nodes, req);
  const warnings: string[] = [];
  const bad2 = nodes.filter((n) => n.status === "unresolved" || n.status === "guid-mismatch");
  for (const n of bad2.slice(0, 20))
    warnings.push(
      `${n.status === "unresolved" ? "unresolved" : "GUID mismatch"}: ${asRef(n)} (from ${n.via[0] ?? "-"})`,
    );
  if (bad2.length > 20) warnings.push(`${bad2.length - 20} more unresolved link(s)`);
  return okResponse(
    "files",
    src.loc.rel,
    null,
    {
      source: src.game ? "game" : "project",
      total: p.total,
      counts,
      unresolved: bad2.length,
      files: p.rows.map((n) => ({
        ext: n.ext,
        guid: n.guid,
        path: n.path,
        status: n.status,
        role: n.role,
        depth: n.depth,
        via: n.via.slice(0, 3),
      })),
      cursor: req.cursor,
      nextCursor: p.nextCursor,
    },
    warnings,
  );
}

// ── validate ─────────────────────────────────────────────────────────────────

export interface Issue {
  severity: "error" | "warning";
  kind: "missing-file" | "dangling-guid" | "template-mismatch" | "not-parsed" | "unreadable";
  file: string;
  message: string;
}

export function issuesOf(req: WorkspaceRequest, env: Env): { issues: Issue[]; files: FilesResult } {
  const files = filesOf(req, env);
  const issues: Issue[] = [];
  const { nodes, closure, src } = files;
  for (const n of nodes) {
    const from = n.via[0] ?? src.loc.rel;
    if (n.status === "unresolved") {
      issues.push({
        // An outside file the paks may not hold (a model, a sound project, a clip) is a warning, and so
        // is a gap in shipped content (the game's own Vehicles_Aircrafts workspace links an .agf the
        // paks lack): a defect in a project's own set is an error.
        severity: n.copy && !src.game ? "error" : "warning",
        kind: "missing-file",
        file: from,
        message: `${asRef(n)} is in neither the project nor the game data`,
      });
    } else if (n.status === "guid-mismatch") {
      issues.push({
        severity: "error",
        kind: "dangling-guid",
        file: from,
        message: `${asRef(n)}: the project's .meta for that path carries another GUID`,
      });
    } else if (TEXT_EXTS.has(n.ext) && !closure.text.has(keyOf(n))) {
      issues.push({
        severity: "warning",
        kind: "unreadable",
        file: n.path,
        message: `${n.path} could not be read`,
      });
    }
  }
  for (const [k, t] of closure.text) {
    const node = nodes.find((n) => keyOf(n) === k);
    if (t.doc.diagnostics.length)
      issues.push({
        severity: "warning",
        kind: "not-parsed",
        file: node?.path ?? k,
        message: `${t.doc.diagnostics.length} parse diagnostic(s): ${t.doc.diagnostics[0].message}`,
      });
  }
  // The workspace's template is the one its graph and its instances name.
  const rootRefs = closure.text.get(closure.rootKey)?.refs ?? [];
  const ast = rootRefs.find((r) => r.role === "AnimSetTemplate" && r.ext === "ast");
  if (ast) {
    for (const r of rootRefs.filter((x) => x.ext === "asi")) {
      const n = nodes.find((x) => x.guid === r.guid);
      const t = n ? closure.text.get(keyOf(n)) : undefined;
      const tpl = t?.refs.find((x) => x.role === "Template");
      if (tpl && tpl.guid !== ast.guid)
        issues.push({
          severity: "warning",
          kind: "template-mismatch",
          file: r.path,
          message: `the instance's Template ${asRef(tpl)} is not the workspace's ast ${asRef(ast)}`,
        });
    }
    const agr = rootRefs.find((x) => x.role === "AnimGraph");
    const an = agr ? nodes.find((x) => x.guid === agr.guid) : undefined;
    const gt = an
      ? closure.text.get(keyOf(an))?.refs.find((x) => x.role === "AnimSetTemplate")
      : undefined;
    if (gt && gt.guid !== ast.guid)
      issues.push({
        severity: "warning",
        kind: "template-mismatch",
        file: agr!.path,
        message: `the graph's AnimSetTemplate ${asRef(gt)} is not the workspace's ast ${asRef(ast)}`,
      });
  }
  return { issues, files };
}

function validateAction(req: WorkspaceRequest, env: Env): WorkspaceResponse {
  const { issues, files } = issuesOf(req, env);
  const p = page(issues, req);
  const errors = issues.filter((i) => i.severity === "error").length;
  return okResponse(
    "validate",
    files.src.loc.rel,
    null,
    {
      source: files.src.game ? "game" : "project",
      files: files.nodes.length,
      errors,
      warnings: issues.length - errors,
      total: p.total,
      issues: p.rows,
      cursor: req.cursor,
      nextCursor: p.nextCursor,
    },
    [],
  );
}

// ── duplicate ────────────────────────────────────────────────────────────────

export interface PlannedCopy {
  guid: string;
  ext: string;
  from: string;
  to: string;
  key: string;
}

export interface DuplicatePlan {
  copies: PlannedCopy[];
  outside: SetNode[];
  unresolved: SetNode[];
  closure: Closure;
  src: Source;
  target: Located;
}

const lc = (s: string) => s.toLowerCase();

/** Pure planning: which files are copied where, which links stay, which cannot be copied. */
export function planDuplicate(req: WorkspaceRequest, env: Env): DuplicatePlan {
  if (!env.root)
    throw new WorkspaceRefusal(
      "NOT_IN_PROJECT",
      "duplicate needs a project path (ENFUSION_PROJECT_PATH or projectPath)",
    );
  if (!req.target) bad("duplicate needs target: the new .aw path inside the project");
  const target = locate(req.target!, env.root, "aw", "a workspace");
  const { nodes, closure, src } = filesOf(req, env);
  const dir = dirOf(target.rel);
  const srcStem = stemOf(src.loc.rel);
  const newStem = stemOf(target.rel);
  const taken = new Set<string>([lc(target.rel)]);
  const copies: PlannedCopy[] = [
    { guid: src.guid ?? "", ext: "aw", from: src.loc.rel, to: target.rel, key: closure.rootKey },
  ];
  const unresolved: SetNode[] = [];
  const outside: SetNode[] = [];
  for (const n of nodes) {
    if (keyOf(n) === closure.rootKey) continue;
    if (!n.copy) {
      outside.push(n);
      continue;
    }
    if (n.status === "unresolved" || n.status === "guid-mismatch") {
      unresolved.push(n);
      continue;
    }
    const stem = stemOf(n.path) === srcStem ? newStem : stemOf(n.path);
    let to = joinRel(dir, `${stem}.${n.ext}`);
    for (let i = 2; taken.has(lc(to)); i++) to = joinRel(dir, `${stem}_${i}.${n.ext}`);
    // Every destination is a clean project-relative path inside the project (review round 1,
    // W4-AW-1): checkRelativePath refuses '..' and folds backslashes.
    to = checkRelativePath(to);
    if (env.root && !isPathInsideRoot(resolve(env.root, to), env.root))
      throw new VocabularyError(
        "ABSOLUTE_PATH",
        `the copy of ${n.path} would land outside the project: ${to}`,
      );
    taken.add(lc(to));
    copies.push({ guid: n.guid, ext: n.ext, from: n.path, to, key: keyOf(n) });
  }
  return { copies, outside, unresolved, closure, src, target };
}

/** The text a copy gets once every internal link is rewritten: `newRef(guidOfSource)` gives `{GUID}path`. */
function copyText(
  plan: DuplicatePlan,
  c: PlannedCopy,
  newRef: (r: RefTok, to: PlannedCopy) => string,
): string {
  const entry = plan.closure.text.get(c.key)!;
  const byGuid = new Map(plan.copies.filter((x) => x.guid).map((x) => [x.guid, x]));
  return renderWith(entry.doc, entry.refs, (r) => {
    const to = byGuid.get(r.guid);
    return to ? newRef(r, to) : undefined;
  });
}

function bytesOf(plan: DuplicatePlan, c: PlannedCopy, text: string): Buffer {
  return Buffer.from(text, plan.closure.text.get(c.key)!.doc.encoding);
}

function rmQuiet(file: string): void {
  try {
    rmSync(file, { force: true });
  } catch {
    // best effort
  }
}

async function duplicateAction(
  req: WorkspaceRequest,
  env: Env,
  client: ResourcesClient | undefined,
): Promise<WorkspaceResponse> {
  const plan = planDuplicate(req, env);
  const { copies, outside, unresolved, src, target } = plan;
  const root = env.root!;
  if (copies.length > MAX_DUPLICATE_FILES)
    bad(
      `the set holds ${copies.length} files (more than ${MAX_DUPLICATE_FILES}); duplicate a smaller workspace`,
    );
  const exist = copies.filter((c) => existsSync(resolve(root, c.to)));
  if (exist.length)
    bad(
      `these destinations already exist (nothing was written): ${exist
        .slice(0, 5)
        .map((c) => c.to)
        .join(", ")}`,
    );
  const complete = unresolved.length === 0;
  const warnings: string[] = [];
  if (src.game) warnings.push("the source is game data; the copies are new project files");
  const unresolvedText = unresolved
    .slice(0, 10)
    .map((n) => `${asRef(n)} (from ${n.via[0] ?? "-"})`)
    .join("; ");
  if (!complete)
    warnings.push(
      `${unresolved.length} internal link(s) cannot be copied (not in the project or the game data): ${unresolvedText}`,
    );
  const map = copies.map((c) => ({
    ext: c.ext,
    from: c.guid ? `{${c.guid}}${c.from}` : c.from,
    to: c.to,
  }));
  const view = {
    source: src.loc.rel,
    target: target.rel,
    complete,
    files: copies.length,
    map,
    kept: outside.slice(0, 50).map((n) => ({ ext: n.ext, ref: asRef(n) })),
    keptCount: outside.length,
    unresolved: unresolved.map((n) => asRef(n)),
  };
  if (req.confirm !== true) {
    return okResponse(
      "duplicate",
      target.rel,
      copies.map((c) => ({ path: c.to, before: null, after: { copiedFrom: c.from } })),
      { ...view, dryRun: true },
      warnings,
      complete
        ? "Run again with confirm: true to copy and register these files."
        : "The map is incomplete: confirm would refuse. Fix the unresolved links first.",
      true,
    );
  }
  if (!complete)
    throw new WorkspaceRefusal(
      REWRITE_INCOMPLETE,
      `the rewrite map is incomplete: ${unresolved.length} internal link(s) have no file to copy: ${unresolvedText}. Nothing was written.`,
    );
  if (!client)
    throw new WorkspaceRefusal(
      "UNREACHABLE",
      "duplicate registers each copy through Workbench, and no client is available",
    );

  // Phase 1: write each copy with its links pointed at the copies' paths (old GUIDs for now).
  const created: string[] = [];
  // A .meta that was there before this run is never removed by its rollback (W4-AW-1).
  const metaBefore = new Set(
    copies.map((c) => `${resolve(root, c.to)}.meta`).filter((m) => existsSync(m)),
  );
  const rollback = () => {
    for (const f of created) {
      rmQuiet(f);
      if (!metaBefore.has(`${f}.meta`)) rmQuiet(`${f}.meta`);
    }
  };
  try {
    for (const c of copies) {
      const text = copyText(plan, c, (r, to) => `{${r.guid}}${to.to}`);
      const file = resolve(root, c.to);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, bytesOf(plan, c, text), { flag: "wx" });
      created.push(file);
    }
  } catch (e) {
    rollback();
    throw e;
  }

  // Phase 2: register every copy; the engine answers each new `{GUID}path`.
  const fresh = new Map<string, string>();
  const failed: string[] = [];
  for (const c of copies) {
    let r: RegisterFileResult;
    try {
      r = await registerProjectFile(client, root, resolve(root, c.to));
    } catch (e) {
      const m = codeOfClientError(e);
      const err = new WorkspaceRefusal(
        m.code as ErrorCode,
        `${m.message}. The copies written so far are left in place: ${copies.map((x) => x.to).join(", ")}. Read their state before retrying.`,
      );
      throw err;
    }
    const m = r.ok ? REF.exec(r.resourceName) : null;
    if (!m) {
      failed.push(`${c.to}: ${r.ok ? "the handler answered no resourceName" : r.message}`);
      break;
    }
    if (lc(m[2].replace(/\\/g, "/")) !== lc(c.to)) {
      failed.push(`${c.to}: registered as ${r.resourceName}, a different path`);
      break;
    }
    fresh.set(c.key, m[1].toUpperCase());
  }
  if (failed.length || fresh.size !== copies.length) {
    rollback();
    throw new WorkspaceRefusal(
      REWRITE_INCOMPLETE,
      `registration did not give every copy a GUID (${failed[0] ?? "incomplete"}). The copies were removed again; nothing is left half-linked.`,
    );
  }

  // Phase 3: rewrite every internal link to the new GUID and path, then check.
  const newGuid = (to: PlannedCopy) => fresh.get(to.key)!;
  const oldGuids = new Set(copies.map((c) => c.guid).filter(Boolean));
  const written: { to: string; guid: string }[] = [];
  for (const c of copies) {
    const text = copyText(plan, c, (_r, to) => `{${newGuid(to)}}${to.to}`);
    const buf = bytesOf(plan, c, text);
    writeFileAtomic(resolve(root, c.to), buf);
    const back = readFileSync(resolve(root, c.to));
    const doc = parseCstBytes(back);
    const refs = scanRefs(doc);
    const left = refs.filter((r) => oldGuids.has(r.guid));
    // The links that point outside the set (xob, anm, acp) must be exactly the source's.
    const kept = (rs: readonly RefTok[], isNew: (g: string) => boolean) =>
      rs
        .filter((r) => !isNew(r.guid))
        .map((r) => `${r.guid}${r.path}`)
        .sort()
        .join("|");
    const newSet = new Set(fresh.values());
    const srcByGuid = new Set(copies.map((x) => x.guid).filter(Boolean));
    const keptSrc = kept(plan.closure.text.get(c.key)!.refs, (g) => srcByGuid.has(g));
    const keptCopy = kept(refs, (g) => newSet.has(g));
    if (keptSrc !== keptCopy)
      throw new WorkspaceRefusal(
        REWRITE_INCOMPLETE,
        `${c.to}: the links outside the set changed in the rewrite; the copies are left in place, do not use them`,
      );
    if (Buffer.compare(back, buf) !== 0 || left.length)
      throw new WorkspaceRefusal(
        REWRITE_INCOMPLETE,
        `${c.to} still holds ${left.length} source GUID(s) after the rewrite (${left
          .slice(0, 3)
          .map((r) => `{${r.guid}}`)
          .join(", ")}); the copies are left in place, do not use them`,
      );
    written.push({ to: c.to, guid: newGuid(c) });
  }
  return okResponse(
    "duplicate",
    target.rel,
    copies.map((c) => ({
      path: c.to,
      before: null,
      after: { copiedFrom: c.from, guid: fresh.get(c.key) },
    })),
    {
      ...view,
      dryRun: false,
      written,
      registered: written.length,
    },
    warnings,
    "Open the copy's workspace in the Animation Editor; its links point at the copies, and the xob, anm and acp links still point at the originals.",
    false,
  );
}

// ── set ──────────────────────────────────────────────────────────────────────

/** `{GUID}path` for a value: given whole, or a project path with a registered `.meta`. */
function linkValue(env: Env, raw: string, ext: string, what: string): string {
  const v = String(raw ?? "").trim();
  if (v === "") bad(`${what} needs a value`);
  const m = /^\{([0-9A-Fa-f]{16})\}(.*)$/.exec(v);
  let guid: string | undefined;
  let path: string;
  if (m) {
    guid = m[1].toUpperCase();
    path = checkRelativePath(m[2]);
  } else {
    path = checkRelativePath(v);
  }
  if (extOf(path) !== ext) bad(`${what} takes a .${ext} resource, got "${path}"`);
  const file = projectFile(env, path);
  if (file) {
    const meta = metaGuidOf(file);
    if (guid && meta && meta !== guid) bad(`${path} is registered as {${meta}}, not {${guid}}`);
    guid ??= meta;
    if (!guid)
      throw new WorkspaceRefusal(
        "RESOURCE_NOT_FOUND",
        `${path} has no .meta GUID: register it first (wb_resources register), or give {GUID}path`,
      );
    return `{${guid}}${path}`;
  }
  if (env.vfs?.exists(path)) {
    if (!guid) bad(`${path} is game data: give it as {GUID}path (the paks hold no .meta)`);
    return `{${guid}}${path}`;
  }
  throw new WorkspaceRefusal(
    "RESOURCE_NOT_FOUND",
    `${path} is in neither the project nor the game data`,
  );
}

function fieldPath(field: SetField, index: number | undefined): string {
  const i = index ?? 0;
  if (field === "Model") return `PreviewModels[${i}].Model`;
  if (field === "ProjectFile") return `AudioTesting.AudioProjects[${i}].ProjectFile`;
  return field;
}

/** Entries of the PreviewModels block; -1 when the file has no such block. */
function previewModelCount(doc: ReturnType<typeof parseCstBytes>): number {
  try {
    const block = doc.resolve("PreviewModels");
    return block.kind === "object" ? (block as { children: unknown[] }).children.length : -1;
  } catch {
    return -1;
  }
}

function setAction(req: WorkspaceRequest, env: Env): WorkspaceResponse {
  if (!env.root)
    throw new WorkspaceRefusal(
      "NOT_IN_PROJECT",
      "writes need a project path (ENFUSION_PROJECT_PATH or projectPath)",
    );
  if (!req.field) bad("set needs field");
  const field = req.field as SetField;
  const loc = locate(req.path ?? "", env.root, "aw", "a workspace");
  if (!existsSync(loc.file!)) {
    if (env.vfs?.exists(loc.rel))
      throw new WorkspaceRefusal(
        "NOT_IN_PROJECT",
        `${loc.rel} is game data (read only): copy the set into the project with animation_workspace duplicate, then edit the copy`,
      );
    throw new WorkspaceRefusal("PATH_NOT_FOUND", `no workspace at ${loc.rel} under ${env.root}`);
  }
  const buf = readFileSync(loc.file!);
  const doc = parseCstBytes(buf);
  if (!isWorkspace(doc)) bad(`${loc.rel} is not a workspace: the root is not one BaseSource block`);
  if (Buffer.compare(doc.toBytes(), buf) !== 0)
    bad(`${loc.rel} is left alone: this writer cannot keep it byte for byte`);
  const before = doc.serialize();
  const ext = FIELD_EXT[field];
  const changes: Change[] = [];
  if (field === "AnimSetInstances") {
    if (req.index !== undefined)
      bad("AnimSetInstances replaces the whole list; index does not apply");
    const list = (req.values ?? (req.value !== undefined ? [req.value] : undefined))?.map((v) =>
      linkValue(env, v, ext, "AnimSetInstances"),
    );
    if (!list) bad("AnimSetInstances needs values (the whole list; [] empties it)");
    const old = doc.resolve("AnimSetInstances");
    if (old.kind !== "object") bad("AnimSetInstances is not a block in this file");
    const oldList = (old as { children: { kind: string; values?: Token[] }[] }).children.map((c) =>
      c.values ? c.values.map(tokenValue).join(" ") : "",
    );
    for (let n = oldList.length; n > 0; n--) doc.arrayRemove("AnimSetInstances", 0);
    for (const v of list!) doc.arrayAdd("AnimSetInstances", { value: v, quoted: true });
    changes.push({ path: "AnimSetInstances", before: oldList, after: list });
  } else {
    if (req.value === undefined)
      bad(`${field} needs value: {GUID}path or a registered project path`);
    const v = linkValue(env, req.value!, ext, field);
    const path = fieldPath(field, req.index);
    let prev: unknown = null;
    let added = false;
    try {
      const g = doc.get(path);
      prev = g.kind === "scalar" ? g.values[0] : null;
    } catch (e) {
      if (!(e instanceof CstEditError) || e.code !== "PATH_NOT_FOUND") throw e;
      // W4 fix-up 1 (w4-54, run 1): a created .aw has an empty PreviewModels list, so set Model at
      // the next free index adds the entry, in the shape workspaceSkeleton writes. Any other
      // missing index stays PATH_NOT_FOUND.
      if (field === "Model" && (req.index ?? 0) === previewModelCount(doc)) {
        doc.createObject("PreviewModels", {
          key: "AnimSrcWorkspacePreviewModel",
          guid: generateGuid(),
          entries: [{ key: "Model", value: v, quoted: true }],
        });
        added = true;
      } else if (field === "Model" || field === "ProjectFile") throw e;
    }
    if (!added) doc.set(path, v, { quoted: true });
    changes.push({ path, before: prev, after: v });
  }
  const after = doc.serialize();
  const bytes = doc.toBytes();
  if (!isWorkspace(parseCstBytes(bytes)))
    bad("the edit would break the workspace; nothing written");
  const diff = unifiedDiff(before, after, loc.rel);
  if (req.confirm !== true || before === after) {
    return okResponse(
      "set",
      loc.rel,
      changes,
      { diff, bytesBefore: Buffer.byteLength(before), bytesAfter: bytes.length },
      [],
      req.confirm === true
        ? undefined
        : "Run again with confirm: true to write exactly this change.",
      req.confirm !== true,
    );
  }
  if (Buffer.compare(readFileSync(loc.file!), buf) !== 0)
    bad(`${loc.rel} changed on disk since it was read; nothing written, read it again`);
  // A numbered backup: an earlier .bak (the first original bytes) is kept (review round 1, W4-AS-1).
  const backup = backUp(loc.file!, (m) => bad(m));
  writeFileAtomic(loc.file!, bytes);
  const back = readFileSync(loc.file!);
  if (Buffer.compare(back, bytes) !== 0)
    return errorResponse(
      "set",
      `path:${loc.rel}`,
      "SAVE_FAILED",
      "the file read back differs from what was written",
    );
  return okResponse(
    "set",
    loc.rel,
    changes,
    { diff, bytes: back.length, backup: backupRel(loc.rel, loc.file!, backup) },
    [],
    "An open Animation Editor keeps its own copy: reopen the workspace there, and do not save the old tab over this file.",
    false,
  );
}

// ── create ───────────────────────────────────────────────────────────────────

const EVENT_TABLE = "$eventtable {\n \n}\n";

export function workspaceSkeleton(parts: {
  template?: string;
  graph?: string;
  instances?: string[];
  model?: string;
}): string {
  const lines = ["BaseSource {"];
  if (parts.template) lines.push(` AnimSetTemplate "${parts.template}"`);
  lines.push(" AnimSetInstances {");
  for (const i of parts.instances ?? []) lines.push(`  "${i}"`);
  lines.push(" }");
  if (parts.graph) lines.push(` AnimGraph "${parts.graph}"`);
  lines.push(" PreviewModels {");
  if (parts.model) {
    lines.push(`  AnimSrcWorkspacePreviewModel "{${generateGuid()}}" {`);
    lines.push(`   Model "${parts.model}"`);
    lines.push("  }");
  }
  lines.push(" }");
  lines.push(` AudioTesting AnimSrcWorkspaceAudioTesting "{${generateGuid()}}" {`);
  lines.push(" }");
  lines.push(` IkTesting AnimSrcWorkspaceIkTesting "{${generateGuid()}}" {`);
  lines.push(" }");
  lines.push("}");
  return lines.join("\n");
}

async function createAction(
  req: WorkspaceRequest,
  env: Env,
  client: ResourcesClient | undefined,
): Promise<WorkspaceResponse> {
  if (!env.root)
    throw new WorkspaceRefusal(
      "NOT_IN_PROJECT",
      "writes need a project path (ENFUSION_PROJECT_PATH or projectPath)",
    );
  if (!req.target) bad("create needs target: the new .aw path inside the project");
  const loc = locate(req.target!, env.root, "aw", "a workspace");
  const template = req.animSetTemplate
    ? linkValue(env, req.animSetTemplate, "ast", "animSetTemplate")
    : undefined;
  const graph = req.animGraph ? linkValue(env, req.animGraph, "agr", "animGraph") : undefined;
  const instances = (req.animSetInstances ?? []).map((v) =>
    linkValue(env, v, "asi", "animSetInstances"),
  );
  const model = req.model ? linkValue(env, req.model, "xob", "model") : undefined;
  const text = workspaceSkeleton({ template, graph, instances, model });
  const files: { rel: string; file: string; text: string }[] = [
    { rel: loc.rel, file: loc.file!, text },
  ];
  if (!req.skipEventTable) {
    const evRel = req.eventTable
      ? locate(req.eventTable, env.root, "ae", "an event table").rel
      : joinRel(dirOf(loc.rel), `${stemOf(loc.rel)}_EventTable.ae`);
    files.push({ rel: evRel, file: resolve(env.root, evRel), text: EVENT_TABLE });
  }
  const exist = files.filter((f) => existsSync(f.file));
  if (exist.length) bad(`${exist.map((f) => f.rel).join(", ")} already exists; nothing written`);
  const warnings: string[] = [];
  if (!template)
    warnings.push("no animSetTemplate given: the workspace has no AnimSetTemplate link");
  if (!graph) warnings.push("no animGraph given: the workspace has no AnimGraph link");
  const changes: Change[] = files.map((f) => ({
    path: f.rel,
    before: null,
    after: { bytes: Buffer.byteLength(f.text) },
  }));
  if (req.confirm !== true) {
    return okResponse(
      "create",
      loc.rel,
      changes,
      { dryRun: true, files: files.map((f) => f.rel), text },
      warnings,
      "Run again with confirm: true to write and register these files.",
      true,
    );
  }
  for (const f of files) {
    mkdirSync(dirname(f.file), { recursive: true });
    writeFileSync(f.file, f.text, { flag: "wx" });
  }
  const registered: string[] = [];
  if (!client) {
    warnings.push("no client: the new files are not registered (wb_resources register)");
  } else {
    for (const f of files) {
      try {
        const r = await registerProjectFile(client, env.root, f.file);
        if (r.ok) registered.push(r.resourceName || f.rel);
        else warnings.push(`${f.rel} was written but not registered: ${r.message}`);
      } catch (e) {
        const m = codeOfClientError(e);
        warnings.push(`${f.rel} was written but not registered (${m.code}): ${m.message}`);
      }
    }
  }
  return okResponse(
    "create",
    loc.rel,
    changes,
    { dryRun: false, files: files.map((f) => f.rel), registered },
    warnings,
    registered.length === files.length
      ? "Link the instances and graph with animation_workspace set, then open the workspace in the Animation Editor."
      : "Register the files that were not (wb_resources register) before linking them.",
    false,
  );
}

// ── Entry ────────────────────────────────────────────────────────────────────

export interface Deps {
  /** The paks; defaults to the configured game install. */
  vfs?: PakLike | null;
  client?: ResourcesClient;
}

/** Runs one request; every refusal is an error response, never a throw. */
export async function runAnimationWorkspace(
  req: WorkspaceRequest,
  config: Config,
  deps: Deps = {},
): Promise<WorkspaceResponse> {
  const target = `path:${String(req.action === "create" ? (req.target ?? "") : (req.path ?? ""))}`;
  try {
    const rootRaw = pinnedProjectRoot(req.projectPath, config.projectPath);
    const env: Env = {
      root: rootRaw ? resolve(rootRaw) : undefined,
      vfs: deps.vfs !== undefined ? deps.vfs : vfsOf(config),
    };
    switch (req.action) {
      case "read":
        return readAction(req, env);
      case "files":
        return filesAction(req, env);
      case "validate":
        return validateAction(req, env);
      case "duplicate":
        return await duplicateAction(req, env, deps.client);
      case "set":
        return setAction(req, env);
      case "create":
        return await createAction(req, env, deps.client);
      default:
        return errorResponse(
          String(req.action),
          target,
          "INVALID_ARGUMENT",
          `unknown action "${String(req.action)}"; use ${ACTIONS.join(", ")}`,
        );
    }
  } catch (e) {
    if (e instanceof WorkspaceRefusal) return refusal(req.action, target, e);
    if (e instanceof VocabularyError) return errorResponse(req.action, target, e.code, e.message);
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

export const ANIMATION_WORKSPACE_DESCRIPTION =
  "Read and edit animation workspaces (.aw) offline, byte-exact. read, files (paged: graph, sheets, set, instances, tables, models), validate (paged). " +
  "duplicate copies the whole set into the project, registers each copy and rewrites every internal GUID (dry run lists the map); set changes one link; create makes a workspace and an empty .ae. " +
  "Writes stay in the project and need confirm.";

export function registerAnimationWorkspace(
  server: McpServer,
  config: Config,
  client?: ResourcesClient,
): void {
  server.registerTool(
    "animation_workspace",
    {
      description: ANIMATION_WORKSPACE_DESCRIPTION,
      inputSchema: {
        action: z.enum(ACTIONS),
        path: z
          .string()
          .optional()
          .describe(
            "The .aw: project-relative, {GUID}path, absolute inside the project, or a game path (not for set or create).",
          ),
        projectPath: z
          .string()
          .optional()
          .describe("Addon root. Uses the configured project when omitted."),
        target: z.string().optional().describe("duplicate/create: the new .aw, project-relative."),
        confirm: z
          .boolean()
          .optional()
          .describe("duplicate/set/create: write. Without it the call is a dry run."),
        field: z.enum(SET_FIELDS).optional().describe("set: the link to change."),
        value: z
          .string()
          .optional()
          .describe("set: {GUID}path, or a project path that has a .meta."),
        values: z.array(z.string()).optional().describe("set AnimSetInstances: the whole list."),
        index: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe(
            "set Model: preview model (the next free index adds one); ProjectFile: audio project (default 0).",
          ),
        animSetTemplate: z.string().optional().describe("create: the .ast link."),
        animGraph: z.string().optional().describe("create: the .agr link."),
        animSetInstances: z.array(z.string()).optional().describe("create: .asi links."),
        model: z.string().optional().describe("create: the preview .xob."),
        eventTable: z
          .string()
          .optional()
          .describe("create: the new .ae path (default beside the .aw)."),
        skipEventTable: z.boolean().optional().describe("create: write no .ae."),
        cursor: z.string().optional().describe("files/validate: cursor from the last page."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(LIMIT_MAX)
          .optional()
          .describe("files/validate: rows per page."),
      },
    },
    async (args) => {
      const r = await runAnimationWorkspace(args as WorkspaceRequest, config, { client });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(r, null, 2) }],
        isError: !r.ok,
      };
    },
  );
}
