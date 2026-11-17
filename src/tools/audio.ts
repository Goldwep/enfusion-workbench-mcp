/**
 * `audio`: read and edit the Audio Editor's files offline (W5 spec 2.4,
 * DEC-068; package W5-TA-3A): `.acp` sound projects, `.sig` signals, `.afm`
 * final mixes and audio-variable `.conf` files.
 *
 * The files are Enfusion text, so the lossless parser (src/formats/enfusion-cst.ts)
 * is the base and the node and link model is src/formats/audio-model.ts. Every
 * edit splices text: the bytes outside the edit never change, and a file the
 * parser cannot give back byte for byte is refused.
 *
 * Reads take a file under the project root or a game path (read from the
 * paks). Writes go inside the project root, on an existing file unless the
 * action is `create`, and are a dry run (a unified diff) unless `confirm` is
 * true. A new file is registered afterwards with `wb_resources register`: this
 * tool writes no `.meta`.
 *
 * Gates (AUDIO_GATES, both off):
 *   sigWrites      DEC-068 OD-9: every `.sig` write refuses READ_ONLY_SOURCE until
 *                  probe P-W5-04 shows the engine evaluates an edited graph and not
 *                  the stale `compiled` block (U11). Turned on, a `.sig` whose
 *                  compiled block is not empty refuses SIG_COMPILED_STALE unless
 *                  `acceptStale` is true.
 *   graphActions   DEC-068 OD-10: addNode, removeNode, connect, disconnect and
 *                  group refuse UNPROVEN until probe P-W5-05 passes. They run
 *                  through one dispatch, `applyGraphOp` of src/formats/audio-graph.ts.
 *
 * EVENT_NOT_FOUND, VARIABLE_NOT_FOUND and SIG_COMPILED_STALE are vocabulary
 * codes (W5 spec 1.3).
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { writeFileAtomic } from "../utils/atomic-write.js";
import { backUp, backupRel } from "../utils/backup.js";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { z } from "zod";
import type { Config } from "../config.js";
import {
  AudioModel,
  AudioModelError,
  ROOT_CLASS,
  audioLinks,
  audioNodes,
  blockOf,
  detectKind,
  downstreamIds,
  eventsOf,
  kindOfPath,
  loadAudioModel,
  numOf,
  numberLine,
  refsOf,
  samplesOf,
  scalarMap,
  splitResource,
  strOf,
  upstreamIds,
  validateAudio,
  variablesOf,
  type AudioKind,
  type AudioLink,
  type AudioNode,
  type RefResolver,
} from "../formats/audio-model.js";
import { applyGraphOp } from "../formats/audio-graph.js";
import {
  CstDocument,
  CstEditError,
  parseCstBytes,
  parsePath,
  tokenValue,
  type CstEntry,
  type CstObject,
  type EntrySpec,
  type ScalarInput,
} from "../formats/enfusion-cst.js";
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
  type ActionOk,
  type ActionResponse,
  type Change,
  type ErrorCode,
} from "../manifest/vocabulary.js";
import { PakVirtualFS } from "../pak/vfs.js";
import { assertInsideRoot, isPathInsideRoot, pinnedProjectRoot } from "../utils/path-guard.js";
import { unifiedDiff } from "./imageset.js";

// ── Actions, gates, codes ────────────────────────────────────────────────────

export const READ_ACTIONS = [
  "inspect",
  "events",
  "nodes",
  "node",
  "graph",
  "samples",
  "refs",
  "variables",
  "mixer",
  "signal",
  "validate",
  "catalog",
] as const;

export const WRITE_ACTIONS = [
  "set",
  "renameEvent",
  "addSample",
  "removeSample",
  "setSample",
  "setSimValue",
  "addVariable",
  "removeVariable",
  "create",
] as const;

/** Wired through one dispatch, refused UNPROVEN until P-W5-05, kept out of the description (OD-10). */
export const GRAPH_ACTIONS = ["addNode", "removeNode", "connect", "disconnect", "group"] as const;

export type ReadAction = (typeof READ_ACTIONS)[number];
export type WriteAction = (typeof WRITE_ACTIONS)[number];
export type GraphAction = (typeof GRAPH_ACTIONS)[number];
export type AudioAction = ReadAction | WriteAction | GraphAction;

export interface AudioGates {
  /** OD-9: `.sig` writes. Off until P-W5-04 passes. */
  sigWrites: boolean;
  /** OD-10: the five graph actions. Off until P-W5-05 passes. */
  graphActions: boolean;
}

/** The switches. Main turns each to true when its probe has passed. */
export const AUDIO_GATES: AudioGates = { sigWrites: false, graphActions: false };

type AudioCode = ErrorCode;

/** The graph dispatch of src/formats/audio-graph.ts (W5-TA-3B), loosely typed on purpose. */
export type GraphDispatch = (
  model: AudioModel,
  op: string,
  args: Record<string, unknown>,
  options: { confirm?: boolean },
) => unknown;

const defaultDispatch: GraphDispatch = applyGraphOp as unknown as GraphDispatch;

// ── Errors ───────────────────────────────────────────────────────────────────

/** A refusal with a vocabulary code (or a carried local one). */
export class AudioError extends Error {
  constructor(
    readonly code: AudioCode,
    message: string,
    readonly next?: string,
  ) {
    super(message);
    this.name = "AudioError";
  }
}

const bad = (message: string): never => {
  throw new AudioError("INVALID_ARGUMENT", message);
};
const missing = (message: string): never => {
  throw new AudioError("PATH_NOT_FOUND", message);
};

function nextFor(code: AudioCode): string {
  return ERROR_CODES[code];
}

function fail(action: string, target: string, e: AudioError): ActionResponse {
  return errorResponse(action, target, e.code as ErrorCode, e.message, e.next ?? nextFor(e.code));
}

// ── Files ────────────────────────────────────────────────────────────────────

interface Located {
  /** Resource path, forward slashes. */
  rel: string;
  kind: AudioKind;
  /** Absolute path of the project file, when a project root is known. */
  file?: string;
  root?: string;
}

function relUnderRoot(rawPath: string, root: string | undefined): string {
  let p = rawPath.trim().replace(/^\{[0-9A-Fa-f]{16}\}/, "");
  if (p.startsWith("-")) bad("paths starting with '-' are rejected");
  if (isAbsolute(p) || /^[A-Za-z]:/.test(p)) {
    if (!root)
      throw new AudioError("NOT_IN_PROJECT", "no project root is configured for an absolute path");
    const rel = relative(root, resolve(p));
    if (rel === "" || isAbsolute(rel) || rel.split(/[\\/]/)[0] === "..")
      throw new AudioError("NOT_IN_PROJECT", `${rawPath} is outside the project ${root}`);
    p = rel.replace(/\\/g, "/");
  }
  return checkRelativePath(p);
}

function locate(rawPath: string | undefined, projectPath: string | undefined): Located {
  if (typeof rawPath !== "string" || rawPath.trim() === "") return bad("path is required");
  const root = projectPath ? resolve(projectPath) : undefined;
  const rel = relUnderRoot(rawPath, root);
  const kind = kindOfPath(rel);
  if (!kind) bad(`"${rel}" is not an .acp, .sig, .afm or audio-variables .conf file`);
  if (!root) return { rel, kind: kind as AudioKind };
  const file = resolve(root, rel);
  try {
    assertInsideRoot(file, root, "path");
  } catch (e) {
    throw new AudioError("NOT_IN_PROJECT", e instanceof Error ? e.message : String(e));
  }
  return { rel, kind: kind as AudioKind, file, root };
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
    `no audio file at "${loc.rel}": not a file${loc.root ? ` under ${loc.root}` : ""} and not in the game data` +
      (vfs ? "" : " (game paks not available: ENFUSION_GAME_PATH)"),
  );
}

function makeResolver(config: Config, root: string | undefined): RefResolver {
  const vfs = vfsOf(config);
  return (p) => {
    if (root) {
      try {
        const abs = resolve(root, checkRelativePath(p));
        if (isPathInsideRoot(abs, root) && existsSync(abs)) return true;
      } catch {
        return false;
      }
    }
    if (vfs) return vfs.exists(p);
    return undefined;
  };
}

function hasOpaque(entries: CstEntry[]): boolean {
  return entries.some((e) => e.kind === "opaque" || (e.kind === "object" && hasOpaque(e.children)));
}

/**
 * Why the writer would not keep this file byte for byte, or undefined when it
 * would: not read back identically, a construct the parser could not place, or
 * not one closed block of the expected root class.
 */
/** The audio kind a file's text holds, undefined when it is not readable or not an audio block. */
function kindOfText(buf: Buffer): AudioKind | undefined {
  try {
    return detectKind(parseCstBytes(buf));
  } catch {
    return undefined;
  }
}

export function unwritableReason(buf: Buffer, kind: AudioKind): string | undefined {
  let doc: CstDocument;
  try {
    doc = parseCstBytes(buf);
  } catch (e) {
    return `not readable as text: ${e instanceof Error ? e.message : String(e)}`;
  }
  if (Buffer.compare(doc.toBytes(), buf) !== 0)
    return "its bytes do not come back identically (encoding or a stray byte)";
  if (doc.diagnostics.length) return `the parser flagged it: ${doc.diagnostics[0].message}`;
  if (detectKind(doc) !== kind) return `it is not one ${ROOT_CLASS[kind]} block`;
  const root = doc.root.children[0] as CstObject;
  if (!root.close) return `the ${ROOT_CLASS[kind]} block is not closed`;
  if (hasOpaque(doc.root.children)) return "it holds text the parser could not place";
  return undefined;
}

// ── Request and response ─────────────────────────────────────────────────────

type Ref = string | number;

export interface AudioRequest {
  action: AudioAction;
  path?: string;
  projectPath?: string;
  confirm?: boolean;
  overwrite?: boolean;
  cursor?: string;
  limit?: number;
  node?: Ref;
  event?: Ref;
  name?: string;
  bank?: Ref;
  sample?: Ref;
  key?: string;
  value?: ScalarInput;
  quoted?: boolean;
  file?: string;
  guid?: string;
  index?: number;
  probability?: number;
  port?: number;
  min?: number;
  max?: number;
  source?: string;
  varOp?: string;
  section?: string;
  nodeClass?: string;
  direction?: "up" | "down" | "both";
  depth?: number;
  kind?: string;
  acceptStale?: boolean;
  args?: Record<string, unknown>;
}

function okResponse(
  action: string,
  target: string,
  changed: Change[] | null,
  readback: unknown,
  warnings: string[],
  next?: string,
  dryRun?: boolean,
): ActionOk & { dryRun?: boolean } {
  const r: ActionOk & { dryRun?: boolean } = {
    ok: true,
    action,
    target,
    changed,
    readback,
    warnings,
  };
  if (next) r.next = next;
  if (dryRun !== undefined) r.dryRun = dryRun;
  return r;
}

interface Page<T> {
  rows: T[];
  total: number;
  cursor?: string;
  nextCursor?: string;
}

function pageOf<T>(items: T[], req: AudioRequest): Page<T> {
  const limit = Math.min(req.limit ?? LIMIT_DEFAULT, LIMIT_MAX);
  const cur =
    req.cursor === undefined ? { start: 0, count: items.length } : parseCursor(req.cursor);
  if (req.cursor !== undefined) checkCursor(cur, items.length);
  return {
    rows: items.slice(cur.start, cur.start + limit),
    total: items.length,
    cursor: req.cursor,
    nextCursor: nextCursor(cur.start, limit, items.length),
  };
}

const dropEmpty = <T extends object>(o: T): Partial<T> =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

// ── Node lookup ──────────────────────────────────────────────────────────────

const ID_TEXT = /^\d{1,12}$/;

function describeIds(nodes: AudioNode[]): string {
  return nodes
    .slice(0, 8)
    .map((n) => `${n.id ?? n.path} (${n.cls}${n.name ? ` "${n.name}"` : ""})`)
    .join(", ");
}

/** A node by id (a number or digits) or by exact name; ambiguity and absence are refusals. */
function findNode(nodes: AudioNode[], ref: Ref | undefined, what = "node"): AudioNode {
  if (ref === undefined || ref === "") return bad(`${what} is required: a node id or name`);
  const text = String(ref);
  if (typeof ref === "number" || ID_TEXT.test(text)) {
    const id = Number(text);
    const hit = nodes.find((n) => n.id === id);
    if (hit) return hit;
  }
  const hits = nodes.filter((n) => n.name === text);
  if (hits.length === 1) return hits[0];
  if (hits.length > 1)
    return bad(`${what} "${text}" matches ${hits.length} nodes; use an id: ${describeIds(hits)}`);
  throw new AudioError(
    "ITEM_NOT_FOUND",
    `no ${what} "${text}" (${nodes.length} nodes${nodes.length ? `, first: ${describeIds(nodes)}` : ""})`,
  );
}

function nodeSummary(n: AudioNode, ins: Map<number, number>, outs: Map<number, number>) {
  return dropEmpty({
    id: n.id,
    class: n.cls,
    section: n.section,
    name: n.name,
    pos: n.pos,
    version: n.version,
    path: n.path,
    linksIn: n.id === undefined ? undefined : (ins.get(n.id) ?? 0),
    linksOut: n.id === undefined ? undefined : (outs.get(n.id) ?? 0),
  });
}

function linkCounts(links: AudioLink[]): { ins: Map<number, number>; outs: Map<number, number> } {
  const ins = new Map<number, number>();
  const outs = new Map<number, number>();
  for (const l of links) {
    ins.set(l.to, (ins.get(l.to) ?? 0) + 1);
    outs.set(l.from, (outs.get(l.from) ?? 0) + 1);
  }
  return { ins, outs };
}

// ── Reads ────────────────────────────────────────────────────────────────────

interface ReadCtx {
  req: AudioRequest;
  loc: Located;
  model: AudioModel;
  buf: Buffer;
  game: boolean;
  config: Config;
  warnings: string[];
}

function countBy<T>(items: T[], key: (t: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of items) out[key(i)] = (out[key(i)] ?? 0) + 1;
  return out;
}

function inspectRead(c: ReadCtx): unknown {
  const { model } = c;
  const nodes = audioNodes(model);
  const links = audioLinks(model, nodes);
  const base = {
    source: c.game ? "game" : "project",
    kind: model.kind,
    rootClass: ROOT_CLASS[model.kind],
    bytes: c.buf.length,
    encoding: model.doc.encoding,
    version: numOf(model.root, "version"),
    diagnostics: model.doc.diagnostics.length,
    sections: countBy(nodes, (n) => n.section),
    classes: countBy(nodes, (n) => n.cls),
    nodes: nodes.length,
    links: links.length,
    refs: refsOf(model, nodes).length,
  };
  if (model.kind === "acp") {
    const ev = eventsOf(model, nodes);
    return {
      ...base,
      events: ev.length,
      unnamedSounds: nodes.filter((n) => n.cls === "SoundClass").length - ev.length,
      samples: samplesOf(model, nodes).length,
      variables: variablesOf(model, nodes).length,
    };
  }
  if (model.kind === "sig") {
    const compiled = blockOf(model.root, "compiled");
    return {
      ...base,
      inputs: nodes.filter((n) => n.section === "Inputs").length,
      ops: nodes.filter((n) => n.section === "Ops").length,
      outputs: nodes.filter((n) => n.section === "Outputs").length,
      compiled: compiled
        ? {
            present: true,
            ops: compiled.children.filter((e) => e.kind === "object" && e.key === "ops").length > 0,
            processed: numOf(compiled, "processed"),
          }
        : { present: false },
    };
  }
  if (model.kind === "vars") return { ...base, variables: nodes.length };
  return {
    ...base,
    buses: nodes.filter((n) => n.section === "Mixers").length,
    outputs: nodes.filter((n) => n.section === "bus_out").length,
  };
}

function eventsRead(c: ReadCtx): unknown {
  if (c.model.kind !== "acp") return bad("events reads an .acp");
  const nodes = audioNodes(c.model);
  const links = audioLinks(c.model, nodes);
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const perBank = new Map<number, number>();
  for (const s of samplesOf(c.model, nodes)) {
    if (s.bank.id !== undefined) perBank.set(s.bank.id, (perBank.get(s.bank.id) ?? 0) + 1);
  }
  const needle = c.req.name?.toLowerCase();
  let all = eventsOf(c.model, nodes);
  if (needle) all = all.filter((e) => e.name.toLowerCase().includes(needle));
  const p = pageOf(all, c.req);
  const rows = p.rows.map((e) => {
    const banks = upstreamIds(links, e.id).filter((i) => byId.get(i)?.cls === "BankLocalClass");
    return dropEmpty({
      id: e.id,
      name: e.name,
      eventType: e.eventType,
      priority: e.priority,
      volumeDb: e.volumeDb,
      comment: e.comment,
      parent: e.parent,
      mixer: e.outState,
      banks: banks.length,
      samples: banks.reduce((n, b) => n + (perBank.get(b) ?? 0), 0),
    });
  });
  return {
    total: p.total,
    count: rows.length,
    events: rows,
    cursor: p.cursor,
    nextCursor: p.nextCursor,
  };
}

function nodesRead(c: ReadCtx): unknown {
  const nodes = audioNodes(c.model);
  const { ins, outs } = linkCounts(audioLinks(c.model, nodes));
  const needle = c.req.name?.toLowerCase();
  const pool = nodes.filter(
    (n) =>
      (c.req.section === undefined || n.section === c.req.section) &&
      (c.req.nodeClass === undefined || n.cls === c.req.nodeClass) &&
      (needle === undefined || (n.name ?? "").toLowerCase().includes(needle)),
  );
  const p = pageOf(pool, c.req);
  return {
    total: p.total,
    count: p.rows.length,
    sections: countBy(nodes, (n) => n.section),
    nodes: p.rows.map((n) => nodeSummary(n, ins, outs)),
    cursor: p.cursor,
    nextCursor: p.nextCursor,
  };
}

function linkRow(l: AudioLink, byId: Map<number | undefined, AudioNode>) {
  const f = byId.get(l.from);
  const t = byId.get(l.to);
  return {
    from: l.from,
    fromPort: l.fromPort,
    fromName: f?.name,
    to: l.to,
    toPort: l.toPort,
    toName: t?.name,
  };
}

function nodeRead(c: ReadCtx): unknown {
  const nodes = audioNodes(c.model);
  const n = findNode(nodes, c.req.node ?? c.req.event);
  const links = audioLinks(c.model, nodes);
  const byId = new Map(nodes.map((x) => [x.id, x] as const));
  const { ins, outs } = linkCounts(links);
  const text = c.model.doc.text.slice(n.obj.start, n.obj.end);
  const out: Record<string, unknown> = {
    ...nodeSummary(n, ins, outs),
    scalars: scalarMap(n.obj),
    blocks: n.obj.children.filter((e): e is CstObject => e.kind === "object").map((e) => e.key),
    in: n.id === undefined ? [] : links.filter((l) => l.to === n.id).map((l) => linkRow(l, byId)),
    out:
      n.id === undefined ? [] : links.filter((l) => l.from === n.id).map((l) => linkRow(l, byId)),
    raw:
      text.length > 4000
        ? `${text.slice(0, 4000)}\n... ${text.length - 4000} more character(s)`
        : text,
  };
  if (n.cls === "BankLocalClass") {
    out.samples = samplesOf(c.model, nodes)
      .filter((s) => s.bank === n || s.bank.id === n.id)
      .map((s) =>
        dropEmpty({
          position: s.position,
          name: s.name,
          filename: s.filename,
          index: s.index,
          probability: s.probability,
        }),
      );
  }
  return out;
}

function graphRead(c: ReadCtx): unknown {
  const nodes = audioNodes(c.model);
  const links = audioLinks(c.model, nodes);
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  let pool = links;
  let root: AudioNode | undefined;
  const dir = c.req.direction ?? "up";
  if (c.req.node !== undefined || c.req.event !== undefined) {
    root = findNode(nodes, c.req.node ?? c.req.event);
    if (root.id === undefined) return bad("the node has no id");
    const depth = Math.max(1, Math.min(c.req.depth ?? 8, 64));
    const keep = new Set<number>([root.id]);
    if (dir !== "down") for (const i of upstreamIds(links, root.id, depth)) keep.add(i);
    if (dir !== "up") for (const i of downstreamIds(links, root.id, depth)) keep.add(i);
    pool = links.filter((l) => keep.has(l.from) && keep.has(l.to));
  }
  const p = pageOf(pool, c.req);
  const ids = new Set<number>();
  for (const l of p.rows) {
    ids.add(l.from);
    ids.add(l.to);
  }
  if (root?.id !== undefined) ids.add(root.id);
  return {
    root: root ? { id: root.id, class: root.cls, name: root.name, direction: dir } : undefined,
    nodeCount: nodes.length,
    total: p.total,
    count: p.rows.length,
    edges: p.rows.map((l) => linkRow(l, byId)),
    nodes: [...ids].map((i) => {
      const n = byId.get(i);
      return dropEmpty({ id: i, class: n?.cls, name: n?.name, missing: n ? undefined : true });
    }),
    cursor: p.cursor,
    nextCursor: p.nextCursor,
  };
}

function samplesRead(c: ReadCtx): unknown {
  if (c.model.kind !== "acp") return bad("samples reads an .acp");
  const nodes = audioNodes(c.model);
  const resolve = makeResolver(c.config, c.loc.root);
  let bank: AudioNode | undefined;
  if (c.req.bank !== undefined)
    bank = findNode(
      nodes.filter((n) => n.cls === "BankLocalClass"),
      c.req.bank,
      "bank",
    );
  const all = samplesOf(c.model, nodes).filter((s) => !bank || s.bank === bank);
  const p = pageOf(all, c.req);
  return {
    total: p.total,
    count: p.rows.length,
    samples: p.rows.map((s) =>
      dropEmpty({
        bank: s.bank.id,
        bankName: s.bank.name,
        position: s.position,
        name: s.name,
        filename: s.filename,
        guid: s.guid,
        path: s.path,
        index: s.index,
        probability: s.probability,
        resolved: s.path === undefined ? undefined : resolve(s.path),
      }),
    ),
    cursor: p.cursor,
    nextCursor: p.nextCursor,
  };
}

function refsRead(c: ReadCtx): unknown {
  const resolve = makeResolver(c.config, c.loc.root);
  const all = refsOf(c.model).map((r) => ({ ...r, resolved: resolve(r.path) }));
  const pool = c.req.kind === undefined ? all : all.filter((r) => r.kind === c.req.kind);
  const p = pageOf(pool, c.req);
  return {
    total: p.total,
    byKind: countBy(all, (r) => r.kind),
    missing: all.filter((r) => r.resolved === false).length,
    count: p.rows.length,
    refs: p.rows.map((r) => dropEmpty(r)),
    cursor: p.cursor,
    nextCursor: p.nextCursor,
  };
}

function variablesRead(c: ReadCtx): unknown {
  const all = variablesOf(c.model);
  const needle = c.req.name?.toLowerCase();
  const pool = needle ? all.filter((v) => v.name.toLowerCase().includes(needle)) : all;
  const p = pageOf(pool, c.req);
  return {
    total: p.total,
    count: p.rows.length,
    variables: p.rows.map((v) => dropEmpty(v)),
    cursor: p.cursor,
    nextCursor: p.nextCursor,
  };
}

function wordList(o: CstObject | undefined): string[] {
  const out: string[] = [];
  for (const e of o?.children ?? []) {
    if (e.kind === "value") out.push(...e.values.map(tokenValue));
    else if (e.kind === "scalar") out.push(e.key, ...e.values.map(tokenValue));
  }
  return out;
}

function mixerRead(c: ReadCtx): unknown {
  const { model } = c;
  const nodes = audioNodes(model);
  if (model.kind === "acp") {
    const links = audioLinks(model, nodes);
    const mixers = nodes
      .filter((n) => n.cls === "MixerClass")
      .map((n) => {
        const res = strOf(n.obj, "res");
        const r = res === undefined ? undefined : splitResource(res);
        const mine = links.filter((l) => l.to === n.id);
        return dropEmpty({
          id: n.id,
          name: n.name,
          res,
          path: r?.path,
          guid: r?.guid,
          inputs: wordList(blockOf(n.obj, "inputs")),
          connections: [...new Set(mine.map((l) => l.toPort))].map((port) => ({
            port,
            from: mine.filter((l) => l.toPort === port).map((l) => l.from),
          })),
          events: nodes.filter((s) => s.cls === "SoundClass" && numOf(s.obj, "outState") === n.id)
            .length,
        });
      });
    return { kind: "acp", count: mixers.length, mixers };
  }
  if (model.kind === "afm") {
    const links = audioLinks(model, nodes);
    const row = (n: AudioNode) =>
      dropEmpty({
        ...scalarMap(n.obj),
        id: n.id,
        class: n.cls,
        name: n.name,
        from:
          n.id === undefined ? undefined : links.filter((l) => l.to === n.id).map((l) => l.from),
      });
    const buses = nodes.filter((n) => n.section === "Mixers").map(row);
    const outputs = nodes.filter((n) => n.section === "bus_out").map(row);
    return { kind: "afm", buses, outputs, count: buses.length };
  }
  return bad("mixer reads an .acp (its mixer nodes) or an .afm (the final mix buses)");
}

function signalRead(c: ReadCtx): unknown {
  const { model } = c;
  const nodes = audioNodes(model);
  if (model.kind === "acp") {
    const links = audioLinks(model, nodes);
    const sigs = nodes
      .filter((n) => n.cls === "SignalClass")
      .map((n) => {
        const ports = numberLine(blockOf(n.obj, "inputsport"));
        const vals = numberLine(blockOf(n.obj, "inputvalues"));
        const mins = numberLine(blockOf(n.obj, "inputvaluesmin"));
        const maxs = numberLine(blockOf(n.obj, "inputvaluesmax"));
        const res = strOf(n.obj, "res");
        return dropEmpty({
          id: n.id,
          name: n.name,
          res,
          path: res === undefined ? undefined : splitResource(res).path,
          inputs: ports.map((port, i) =>
            dropEmpty({ index: i, port, value: vals[i], min: mins[i], max: maxs[i] }),
          ),
          outputs: numberLine(blockOf(n.obj, "outputsport")),
          linksIn: links.filter((l) => l.to === n.id).length,
        });
      });
    return { kind: "acp", count: sigs.length, signals: sigs };
  }
  if (model.kind === "sig") {
    const compiled = blockOf(model.root, "compiled");
    const row = (n: AudioNode) =>
      dropEmpty({
        id: n.id,
        class: n.cls,
        name: n.name,
        value: strOf(n.obj, "value"),
        valueMin: strOf(n.obj, "valueMin"),
        valueMax: strOf(n.obj, "valueMax"),
        varName: strOf(n.obj, "varName"),
        varResource: strOf(n.obj, "varResource"),
        children: numberLine(blockOf(n.obj, "children")),
        input: numOf(n.obj, "input"),
        inputs: audioLinks(model, [n]).map((l) => ({
          from: l.from,
          port: l.fromPort,
          to: l.toPort,
        })),
      });
    return {
      kind: "sig",
      inputs: nodes.filter((n) => n.section === "Inputs").map(row),
      ops: nodes.filter((n) => n.section === "Ops").map(row),
      outputs: nodes.filter((n) => n.section === "Outputs").map(row),
      compiled: compiled
        ? {
            present: true,
            processed: numOf(compiled, "processed"),
            version: numOf(compiled, "version"),
          }
        : { present: false },
    };
  }
  return bad("signal reads an .acp (its signal nodes) or a .sig");
}

function validateRead(c: ReadCtx): unknown {
  const issues = validateAudio(c.model, makeResolver(c.config, c.loc.root));
  const why = unwritableReason(c.buf, c.model.kind);
  if (why)
    issues.push({
      severity: "warning",
      rule: "UNWRITABLE",
      message: `this tool would refuse to edit the file: ${why}`,
    });
  const p = pageOf(issues, c.req);
  return {
    valid: !issues.some((i) => i.severity === "error"),
    total: p.total,
    errors: issues.filter((i) => i.severity === "error").length,
    warnings: issues.filter((i) => i.severity === "warning").length,
    count: p.rows.length,
    issues: p.rows.map((i) => dropEmpty(i)),
    cursor: p.cursor,
    nextCursor: p.nextCursor,
  };
}

const READERS: Record<Exclude<ReadAction, "catalog">, (c: ReadCtx) => unknown> = {
  inspect: inspectRead,
  events: eventsRead,
  nodes: nodesRead,
  node: nodeRead,
  graph: graphRead,
  samples: samplesRead,
  refs: refsRead,
  variables: variablesRead,
  mixer: mixerRead,
  signal: signalRead,
  validate: validateRead,
};

function readAction(req: AudioRequest, loc: Located, config: Config): ActionResponse {
  const { buf, game } = readFrom(loc, config);
  const model = loadAudioModel(buf, loc.kind);
  const warnings: string[] = [];
  if (req.action !== "validate") {
    const why = unwritableReason(buf, loc.kind);
    if (why) warnings.push(`this tool would refuse to edit the file: ${why}`);
  }
  if (game) warnings.push("game resource (read only): game_duplicate copies it into the project");
  const readback = READERS[req.action as Exclude<ReadAction, "catalog">]({
    req,
    loc,
    model,
    buf,
    game,
    config,
    warnings,
  });
  return okResponse(req.action, `path:${loc.rel}`, null, readback, warnings);
}

// ── Catalog ──────────────────────────────────────────────────────────────────

interface CatalogRow {
  path: string;
  kind: AudioKind;
  source: "project" | "game";
  bytes?: number;
}

const CATALOG_KINDS = ["acp", "sig", "afm", "vars"] as const;

function startsAudioVars(head: Buffer): boolean {
  return head
    .toString("latin1")
    .replace(/^﻿|^\xEF\xBB\xBF/, "")
    .trimStart()
    .startsWith("AudioVariablesClass");
}

function walkProject(
  root: string,
  prefix: string,
  want: Set<AudioKind>,
  sniffAll: boolean,
  out: Map<string, CatalogRow>,
): void {
  let visited = 0;
  const walk = (dir: string, rel: string, depth: number): void => {
    if (depth > 14 || visited > 60000) return;
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      const r = rel === "" ? e.name : `${rel}/${e.name}`;
      if (e.isDirectory()) {
        walk(join(dir, e.name), r, depth + 1);
        continue;
      }
      visited++;
      if (!e.isFile() || !r.toLowerCase().startsWith(prefix.toLowerCase())) continue;
      const kind = kindOfPath(r);
      if (!kind || !want.has(kind)) continue;
      const file = join(dir, e.name);
      if (kind === "vars") {
        if (!sniffAll && !/(^|\/)sounds\//i.test(r)) continue;
        try {
          if (!startsAudioVars(readFileSync(file).subarray(0, 96))) continue;
        } catch {
          continue;
        }
      }
      let bytes: number | undefined;
      try {
        bytes = statSync(file).size;
      } catch {
        bytes = undefined;
      }
      out.set(r.toLowerCase(), { path: r, kind, source: "project", bytes });
    }
  };
  // A prefix names a folder or the start of a file name; walk from the project root.
  walk(root, "", 0);
}

function catalogAction(req: AudioRequest, config: Config): ActionResponse {
  const root = pinnedProjectRoot(req.projectPath, config.projectPath);
  const prefix =
    (req.path ?? "").trim() === ""
      ? ""
      : relUnderRoot(req.path as string, root ? resolve(root) : undefined);
  const want = new Set<AudioKind>(CATALOG_KINDS);
  if (req.kind !== undefined) {
    if (!(CATALOG_KINDS as readonly string[]).includes(req.kind))
      return bad(`kind must be one of ${CATALOG_KINDS.join(", ")}`);
    want.clear();
    want.add(req.kind as AudioKind);
  }
  const sniffAll = prefix !== "";
  const rows = new Map<string, CatalogRow>();
  const vfs = vfsOf(config);
  if (vfs) {
    const lowPrefix = prefix.toLowerCase();
    for (const p of vfs.allFilePaths()) {
      if (!p.toLowerCase().startsWith(lowPrefix)) continue;
      const kind = kindOfPath(p);
      if (!kind || !want.has(kind)) continue;
      if (kind === "vars") {
        if (!sniffAll && !/(^|\/)sounds\//i.test(p)) continue;
        try {
          if (!startsAudioVars(vfs.readFile(p).subarray(0, 96))) continue;
        } catch {
          continue;
        }
      }
      let bytes: number | undefined;
      try {
        bytes = vfs.fileSize(p);
      } catch {
        bytes = undefined;
      }
      rows.set(p.toLowerCase(), { path: p, kind, source: "game", bytes });
    }
  }
  if (root) walkProject(resolve(root), prefix, want, sniffAll, rows);
  const all = [...rows.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const p = pageOf(all, req);
  const warnings: string[] = [];
  if (!vfs)
    warnings.push("game paks not available (ENFUSION_GAME_PATH): only project files are listed");
  if (!root) warnings.push("no project path: only game files are listed");
  return okResponse(
    "catalog",
    `path:${prefix || "."}`,
    null,
    {
      total: p.total,
      byKind: countBy(all, (r) => r.kind),
      bySource: countBy(all, (r) => r.source),
      count: p.rows.length,
      files: p.rows.map((r) => dropEmpty(r)),
      cursor: p.cursor,
      nextCursor: p.nextCursor,
    },
    warnings,
  );
}

// ── Writes ───────────────────────────────────────────────────────────────────

interface OpResult {
  changes: Change[];
  warnings: string[];
}

function cleanText(raw: unknown, what: string): string {
  if (typeof raw !== "string" || raw === "") return bad(`${what} is required`);
  if (/["\\\x00-\x1f\x7f]/.test(raw) || raw !== raw.trim() || raw.length > 256)
    return bad(
      `${what} must be 1 to 256 characters with no quote, backslash, control character or edge blank`,
    );
  return raw;
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

function finite(n: unknown, what: string): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return bad(`${what} must be a finite number`);
  return n;
}

function rawOf(doc: CstDocument, path: string): string | null {
  try {
    const g = doc.get(path);
    return g.kind === "scalar" || g.kind === "value"
      ? g.raw
      : g.kind === "object"
        ? `{${g.key}}`
        : g.raw;
  } catch {
    return null;
  }
}

function setCommon(
  doc: CstDocument,
  path: string,
  value: ScalarInput,
  quoted: boolean | undefined,
): Change {
  const before = rawOf(doc, path);
  doc.set(path, value, { quoted });
  return { path, before, after: rawOf(doc, path) };
}

function setOp(model: AudioModel, req: AudioRequest): OpResult {
  const nodes = audioNodes(model);
  const n = findNode(nodes, req.node ?? req.event);
  if (typeof req.key !== "string" || req.key === "")
    return bad("key is required: a property of the node, e.g. volume_dB");
  if (req.value === undefined) return bad("value is required");
  const segs = parsePath(req.key);
  if (segs[0].name === "id")
    return bad("the id of a node is structural; this tool does not change it");
  const path = `${n.path}.${req.key}`;
  const ch = setCommon(model.doc, path, req.value, req.quoted);
  return {
    changes: [
      {
        path: `${n.id !== undefined ? `node:${n.id}` : `node:${n.name}`}.${req.key}`,
        before: ch.before,
        after: ch.after,
      },
    ],
    warnings: [],
  };
}

function renameEventOp(model: AudioModel, req: AudioRequest): OpResult {
  if (model.kind !== "acp") return bad("renameEvent edits an .acp");
  const nodes = audioNodes(model);
  const events = eventsOf(model, nodes);
  const ref = req.event ?? req.node;
  if (ref === undefined || ref === "") return bad("event is required: the event's name or id");
  const text = String(ref);
  const hits = events.filter(
    (e) => e.name === text || (ID_TEXT.test(text) && e.id === Number(text)),
  );
  if (hits.length === 0) {
    throw new AudioError(
      "EVENT_NOT_FOUND",
      `no event "${text}" (${events.length} events${
        events.length
          ? `, first: ${events
              .slice(0, 8)
              .map((e) => e.name)
              .join(", ")}`
          : ""
      })`,
    );
  }
  if (hits.length > 1)
    return bad(
      `event "${text}" matches ${hits.length} sounds; use an id: ${hits.map((e) => e.id).join(", ")}`,
    );
  const ev = hits[0];
  const name = cleanText(req.name, "name");
  const clash = events.find((e) => e.name === name && e.id !== ev.id);
  if (clash)
    throw new AudioError(
      "DUPLICATE_ID",
      `an event named "${name}" already exists (id ${clash.id})`,
    );
  const warnings = [
    "scripts and other files that call the old event name are not changed: search them for it",
  ];
  if (name === ev.name) return { changes: [], warnings };
  const ch = setCommon(model.doc, `${ev.node.path}.name`, name, undefined);
  return {
    changes: [{ path: `event:${ev.id}.name`, before: ev.name, after: name }],
    warnings: [...warnings, ...(ch.after === null ? ["the name did not read back"] : [])],
  };
}

function bankOf(model: AudioModel, ref: Ref | undefined): AudioNode {
  if (model.kind !== "acp") return bad("samples are in an .acp");
  const banks = audioNodes(model).filter((n) => n.cls === "BankLocalClass");
  return findNode(banks, ref, "bank");
}

function guidFromMeta(root: string | undefined, path: string): string | undefined {
  if (!root) return undefined;
  try {
    const abs = resolve(root, `${checkRelativePath(path)}.meta`);
    if (!isPathInsideRoot(abs, root) || !existsSync(abs)) return undefined;
    const m = /Name\s+"\{([0-9A-Fa-f]{16})\}/.exec(readFileSync(abs, "utf8"));
    return m ? m[1].toUpperCase() : undefined;
  } catch {
    return undefined;
  }
}

/** `{GUID}path` of a sample file from the request: an explicit GUID, a prefix, or the project's meta. */
function sampleResource(
  req: AudioRequest,
  root: string | undefined,
  warnings: string[],
): { resource: string; path: string } {
  const raw = req.file;
  if (typeof raw !== "string" || raw.trim() === "")
    return bad("file is required: the sample, {GUID}path or a project path");
  const sp = splitResource(raw.trim());
  const path = checkRelativePath(sp.path);
  let guid = sp.guid ?? (req.guid ? req.guid.replace(/^\{|\}$/g, "").toUpperCase() : undefined);
  if (guid !== undefined && !/^[0-9A-F]{16}$/.test(guid))
    return bad(`guid must be 16 hex digits, got ${guid}`);
  if (!guid) guid = guidFromMeta(root, path);
  if (!guid) {
    return bad(
      `no GUID for "${path}": pass file as {GUID}path or guid, or register the file first (wb_resources register) so its .meta exists`,
    );
  }
  const ext = path.toLowerCase().slice(path.lastIndexOf(".") + 1);
  if (ext !== "wav" && ext !== "snd")
    warnings.push(`"${path}" is not a .wav or .snd file; vanilla banks hold those`);
  return { resource: `{${guid}}${path}`, path };
}

function ensureSamples(model: AudioModel, bank: AudioNode): void {
  if (!blockOf(bank.obj, "Samples")) model.doc.createObject(bank.path, { key: "Samples" });
}

function addSampleOp(model: AudioModel, req: AudioRequest, root: string | undefined): OpResult {
  const bank = bankOf(model, req.bank ?? req.node);
  const warnings: string[] = [];
  const { resource, path } = sampleResource(req, root, warnings);
  const name = cleanText(req.name ?? path.slice(path.lastIndexOf("/") + 1), "name");
  const existing = samplesOf(model).filter((s) => s.bank === bank || s.bank.id === bank.id);
  if (existing.some((s) => s.name === name))
    throw new AudioError(
      "DUPLICATE_ID",
      `bank ${bank.id} already holds a sample named "${name}"; pass name`,
    );
  const entries: EntrySpec[] = [{ key: "Filename", value: resource }];
  if (req.probability !== undefined)
    entries.push({ key: "Probability", value: finite(req.probability, "probability") });
  if (req.index !== undefined) {
    if (!Number.isInteger(req.index) || req.index < 0)
      return bad("index must be a whole number of at least 0");
    entries.push({ key: "Index", value: req.index });
  }
  ensureSamples(model, bank);
  const fresh = bankOf(model, bank.id);
  model.doc.createObject(`${fresh.path}.Samples`, { key: "AudioBankSampleClass", name, entries });
  return {
    changes: [
      {
        path: `bank:${bank.id}.Samples`,
        before: null,
        after: { name, filename: resource, index: req.index, probability: req.probability },
      },
    ],
    warnings,
  };
}

function pickSample(model: AudioModel, bank: AudioNode, ref: Ref | undefined) {
  if (ref === undefined || ref === "")
    return bad("sample is required: the sample's name, or its position in the bank");
  const rows = samplesOf(model).filter((s) => s.bank === bank || s.bank.id === bank.id);
  const text = String(ref);
  const byName = rows.filter((s) => s.name === text);
  if (byName.length === 1) return byName[0];
  if (byName.length > 1)
    return bad(`bank ${bank.id} holds "${text}" ${byName.length} times; use its position`);
  if (typeof ref === "number" || ID_TEXT.test(text)) {
    const hit = rows.find((s) => s.position === Number(text));
    if (hit) return hit;
  }
  throw new AudioError(
    "ITEM_NOT_FOUND",
    `no sample "${text}" in bank ${bank.id} (${rows.length} samples${
      rows.length
        ? `, first: ${rows
            .slice(0, 6)
            .map((s) => s.name)
            .join(", ")}`
        : ""
    })`,
  );
}

function removeSampleOp(model: AudioModel, req: AudioRequest): OpResult {
  const bank = bankOf(model, req.bank ?? req.node);
  const s = pickSample(model, bank, req.sample ?? req.name);
  const before = { name: s.name, filename: s.filename, index: s.index, probability: s.probability };
  model.doc.delete(`${bank.path}.Samples[${s.position}]`);
  const left = samplesOf(model).filter((x) => x.bank.id === bank.id).length;
  return {
    changes: [{ path: `bank:${bank.id}.Samples`, before, after: null }],
    warnings: left === 0 ? [`bank ${bank.id} has no samples left: it plays nothing`] : [],
  };
}

function setSampleOp(model: AudioModel, req: AudioRequest, root: string | undefined): OpResult {
  const bank = bankOf(model, req.bank ?? req.node);
  const s = pickSample(model, bank, req.sample);
  if (req.file === undefined && req.index === undefined && req.probability === undefined)
    return bad("setSample needs at least one of file, index, probability");
  const base = `${bank.path}.Samples[${s.position}]`;
  const warnings: string[] = [];
  const changes: Change[] = [];
  if (req.file !== undefined) {
    const { resource } = sampleResource(req, root, warnings);
    const c = setCommon(model.doc, `${base}.Filename`, resource, undefined);
    changes.push({ path: `bank:${bank.id}.${s.name}.Filename`, before: c.before, after: c.after });
  }
  if (req.index !== undefined) {
    if (!Number.isInteger(req.index) || req.index < 0)
      return bad("index must be a whole number of at least 0");
    const c = setCommon(model.doc, `${base}.Index`, req.index, undefined);
    changes.push({ path: `bank:${bank.id}.${s.name}.Index`, before: c.before, after: c.after });
  }
  if (req.probability !== undefined) {
    const c = setCommon(
      model.doc,
      `${base}.Probability`,
      finite(req.probability, "probability"),
      undefined,
    );
    changes.push({
      path: `bank:${bank.id}.${s.name}.Probability`,
      before: c.before,
      after: c.after,
    });
  }
  return { changes, warnings };
}

function setSimValueOp(model: AudioModel, req: AudioRequest): OpResult {
  if (model.kind !== "acp" && model.kind !== "sig")
    return bad(
      "setSimValue edits a signal's simulated values in an .acp (or an input value of a .sig)",
    );
  const nodes = audioNodes(model);
  const n = findNode(nodes, req.node ?? req.event, "signal");
  const fields: [string, number | undefined][] = [
    ["value", req.value === undefined ? undefined : finite(req.value, "value")],
    ["min", req.min === undefined ? undefined : finite(req.min, "min")],
    ["max", req.max === undefined ? undefined : finite(req.max, "max")],
  ];
  if (fields.every(([, v]) => v === undefined))
    return bad("setSimValue needs at least one of value, min, max");
  const changes: Change[] = [];
  if (model.kind === "sig") {
    const keys: Record<string, string> = { value: "value", min: "valueMin", max: "valueMax" };
    for (const [f, v] of fields) {
      if (v === undefined) continue;
      if (n.section !== "Inputs") return bad(`${n.path} is not an input node`);
      const c = setCommon(model.doc, `${n.path}.${keys[f]}`, v, false);
      changes.push({ path: `node:${n.id}.${keys[f]}`, before: c.before, after: c.after });
    }
    return { changes, warnings: [] };
  }
  if (n.cls !== "SignalClass")
    return bad(`node ${n.id} is a ${n.cls}; setSimValue edits a SignalClass node`);
  const ports = numberLine(blockOf(n.obj, "inputsport"));
  let idx: number;
  if (req.port !== undefined) {
    idx = ports.indexOf(req.port);
    if (idx < 0)
      return bad(
        `signal ${n.id} has no input port ${req.port} (ports: ${ports.join(", ") || "none"})`,
      );
  } else if (req.index !== undefined) {
    idx = req.index;
    if (!Number.isInteger(idx) || idx < 0 || idx >= ports.length)
      return bad(
        `index ${req.index} is out of range: signal ${n.id} has ${ports.length} input ports`,
      );
  } else {
    return bad(`port or index is required (input ports: ${ports.join(", ") || "none"})`);
  }
  const keys: Record<string, string> = {
    value: "inputvalues",
    min: "inputvaluesmin",
    max: "inputvaluesmax",
  };
  for (const [f, v] of fields) {
    if (v === undefined) continue;
    const key = keys[f];
    const block = blockOf(n.obj, key);
    if (!block || block.children.length !== 1)
      return bad(`${n.path}.${key} is missing or spans several lines; edit it in the Audio Editor`);
    const path = `${n.path}.${key}[0]`;
    const g = model.doc.get(path);
    if (g.kind !== "value" && g.kind !== "scalar") return bad(`${path} is not a value line`);
    const cur = g.kind === "scalar" ? [g.key, ...g.values] : g.values;
    if (g.kind === "scalar") return bad(`${path} does not read as a number list`);
    if (idx >= cur.length) return bad(`${key} holds ${cur.length} values, not ${idx + 1}`);
    const next = [...cur];
    const before = next[idx];
    next[idx] = String(v);
    model.doc.set(path, next, { quoted: false });
    changes.push({ path: `signal:${n.id}.${key}[${idx}]`, before, after: String(v) });
  }
  return { changes, warnings: [] };
}

function addVariableOp(model: AudioModel, req: AudioRequest): OpResult {
  if (model.kind !== "vars") return bad("addVariable edits an audio-variables .conf");
  const name = req.name;
  if (typeof name !== "string" || !IDENT.test(name))
    return bad("name must be an identifier: letters, digits and _, not starting with a digit");
  const nodes = audioNodes(model);
  if (nodes.some((n) => n.name === name))
    throw new AudioError("DUPLICATE_ID", `variable "${name}" already exists`);
  const entries: EntrySpec[] = [];
  const warnings: string[] = [];
  if (req.source !== undefined) {
    if (!IDENT.test(req.source))
      return bad("source must be one word, e.g. PlayTime, Amplitude, Constant, External");
    if (!["PlayTime", "Amplitude", "Constant", "External"].includes(req.source))
      warnings.push(
        `source ${req.source} is not one the vanilla files use (PlayTime, Amplitude, Constant, External)`,
      );
    entries.push({ key: "source", value: req.source, quoted: false });
  }
  if (req.varOp !== undefined) {
    if (!IDENT.test(req.varOp)) return bad("varOp must be one word, e.g. Max");
    entries.push({ key: "op", value: req.varOp, quoted: false });
  }
  if (req.value !== undefined) entries.push({ key: "value", value: finite(req.value, "value") });
  if (req.min !== undefined) entries.push({ key: "value_min", value: finite(req.min, "min") });
  if (req.max !== undefined) entries.push({ key: "value_max", value: finite(req.max, "max") });
  if (!blockOf(model.root, "Variables")) model.doc.createObject("", { key: "Variables" });
  model.doc.createObject("Variables", { key: "AudioVariableClass", name, entries });
  return {
    changes: [
      {
        path: `variable:${name}`,
        before: null,
        after: Object.fromEntries(
          entries.map((e) => ["key" in e ? e.key : "", "value" in e ? e.value : ""]),
        ),
      },
    ],
    warnings,
  };
}

function removeVariableOp(model: AudioModel, req: AudioRequest): OpResult {
  if (model.kind !== "vars") return bad("removeVariable edits an audio-variables .conf");
  const name = req.name;
  if (typeof name !== "string" || name === "") return bad("name is required: the variable's name");
  const nodes = audioNodes(model);
  const n = nodes.find((x) => x.name === name);
  if (!n)
    throw new AudioError(
      "VARIABLE_NOT_FOUND",
      `no variable "${name}" (${nodes.length} variables${
        nodes.length
          ? `, first: ${nodes
              .slice(0, 8)
              .map((x) => x.name)
              .join(", ")}`
          : ""
      })`,
    );
  const before = scalarMap(n.obj);
  model.doc.delete(n.path);
  return {
    changes: [{ path: `variable:${name}`, before, after: null }],
    warnings: [
      "acp and sig files that name this variable are not changed: they would read it as unknown",
    ],
  };
}

export function skeleton(kind: AudioKind): string {
  switch (kind) {
    case "acp":
      return "AudioClass {\n version 2\n}";
    case "afm":
      return "AudioOutputStateResClass {\n Mixers {\n }\n bus_out {\n }\n}";
    case "vars":
      return "AudioVariablesClass {\n Variables {\n }\n}";
    default:
      return "AudioSignalResClass {\n Inputs {\n }\n Outputs {\n }\n}";
  }
}

// ── Commit ───────────────────────────────────────────────────────────────────

function commit(
  req: AudioRequest,
  loc: Located,
  before: string,
  model: AudioModel,
  op: OpResult,
  creating: boolean,
): ActionResponse {
  const after = model.doc.serialize();
  const bytes = model.doc.toBytes();
  const why = unwritableReason(bytes, loc.kind);
  if (why)
    throw new AudioError(
      "INVALID_ARGUMENT",
      `the edit would produce a file the writer cannot keep: ${why}`,
    );
  const diff = unifiedDiff(before, after, loc.rel);
  const confirmed = req.confirm === true;
  const target = `path:${loc.rel}`;
  const unchanged = !creating && before === after;
  if (!confirmed || unchanged) {
    return okResponse(
      req.action,
      target,
      op.changes,
      {
        diff,
        bytesBefore: Buffer.byteLength(before, model.doc.encoding),
        bytesAfter: bytes.length,
      },
      unchanged
        ? [...op.warnings, "no change: the file already reads as asked, nothing written"]
        : op.warnings,
      confirmed ? undefined : "Run again with confirm: true to write exactly this change.",
      true,
    );
  }
  const file = loc.file as string;
  let backup: string | undefined;
  if (creating) {
    mkdirSync(dirname(file), { recursive: true });
    // The replaced file is kept beside it, as particle and navmesh keep theirs (W5-01).
    if (req.overwrite && existsSync(file))
      backup = backupRel(
        loc.rel,
        file,
        backUp(file, (m) => {
          throw new AudioError("INVALID_ARGUMENT", m);
        }),
      );
    try {
      if (req.overwrite) writeFileAtomic(file, bytes);
      else writeFileSync(file, bytes, { flag: "wx" });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EEXIST")
        throw new AudioError(
          "INVALID_ARGUMENT",
          `${loc.rel} already exists; pass overwrite: true to replace it`,
        );
      throw e;
    }
  } else {
    if (Buffer.compare(readFileSync(file), Buffer.from(before, model.doc.encoding)) !== 0)
      throw new AudioError(
        "INVALID_ARGUMENT",
        `${loc.rel} changed on disk since it was read; nothing written, read it again`,
      );
    writeFileAtomic(file, bytes);
  }
  const back = readFileSync(file);
  if (Buffer.compare(back, bytes) !== 0)
    return errorResponse(
      req.action,
      target,
      "SAVE_FAILED",
      "the file read back differs from what was written",
    );
  const nodes = audioNodes(loadAudioModel(back, loc.kind));
  return okResponse(
    req.action,
    target,
    op.changes,
    { diff, bytes: back.length, nodes: nodes.length, ...(backup ? { backup } : {}) },
    op.warnings,
    creating
      ? "A new file is not yet known to the engine: register it with wb_resources register."
      : "An open Audio Editor tab keeps its own copy: reopen the file there, and do not save the old tab over this file.",
    false,
  );
}

/**
 * The result of `applyGraphOp`: `{ ok: true, changed, readback, warnings }` or
 * `{ ok: false, code, message, next }`. A refusal becomes an AudioError with the
 * dispatch's own code and next step (it may carry a code of its own, NODE_NOT_FOUND).
 */
function graphResult(r: unknown): OpResult {
  const o = (r && typeof r === "object" ? r : {}) as {
    ok?: boolean;
    code?: string;
    message?: string;
    next?: string;
    changed?: unknown;
    warnings?: unknown;
  };
  if (o.ok === false) {
    throw new AudioError(
      (o.code ?? "INVALID_ARGUMENT") as AudioCode,
      o.message ?? "the graph op failed",
      o.next,
    );
  }
  const changes = Array.isArray(o.changed) ? (o.changed as Change[]) : [];
  const warnings = Array.isArray(o.warnings) ? o.warnings.map(String) : [];
  return { changes, warnings };
}

function writeAction(
  req: AudioRequest,
  loc: Located,
  config: Config,
  gates: AudioGates,
  dispatch: GraphDispatch,
): ActionResponse {
  if (loc.kind === "sig" && !gates.sigWrites)
    throw new AudioError(
      "READ_ONLY_SOURCE",
      "a .sig carries a compiled block that an edit does not regenerate (U11); .sig writes wait for probe P-W5-04 (DEC-068 OD-9). Read it with audio signal, or edit it in the Audio Editor.",
      "Read the signal with audio signal; the Audio Editor edits it until P-W5-04 passes.",
    );
  if (!loc.file || !loc.root)
    throw new AudioError(
      "NOT_IN_PROJECT",
      "writes need a project path (ENFUSION_PROJECT_PATH or projectPath)",
    );
  if (req.action === "create") {
    const exists = existsSync(loc.file);
    if (exists && !req.overwrite)
      throw new AudioError(
        "INVALID_ARGUMENT",
        `${loc.rel} already exists; pass overwrite: true to replace it`,
      );
    // An overwrite replaces only an audio file of the same kind: a .conf is only a candidate
    // (its root class decides), so a faction config is never replaced by a skeleton (review
    // round 1, W5-01). A damaged audio file of the kind may still be replaced whole.
    if (exists) {
      const kindNow = kindOfText(readFileSync(loc.file));
      if (kindNow !== loc.kind)
        throw new AudioError(
          "INVALID_ARGUMENT",
          `${loc.rel} is left alone: it is not one ${ROOT_CLASS[loc.kind]} block (${kindNow ? `it is a ${ROOT_CLASS[kindNow]}` : "its root class is not an audio one"}), so create does not overwrite it`,
        );
    }
    const before = exists ? readFileSync(loc.file, "utf-8") : "";
    const model = loadAudioModel(Buffer.from(skeleton(loc.kind)), loc.kind);
    const op: OpResult = {
      changes: [
        { path: "file", before: exists ? "existing file" : null, after: ROOT_CLASS[loc.kind] },
      ],
      warnings: [
        ...(exists
          ? ["overwrite: the existing file is replaced whole (a numbered .bak copy is kept)"]
          : []),
        "an empty skeleton: engine acceptance of an offline-written file is probe P-W5-02",
      ],
    };
    return commit(req, loc, before, model, op, true);
  }
  if (!existsSync(loc.file)) {
    if (vfsOf(config)?.exists(loc.rel))
      throw new AudioError(
        "NOT_IN_PROJECT",
        `${loc.rel} is game data (read only): copy it into the project with game_duplicate, then edit the copy`,
      );
    return missing(`no audio file at ${loc.rel} under ${loc.root}; create makes a new one`);
  }
  if (!statSync(loc.file).isFile()) return bad(`${loc.rel} is not a file`);
  const buf = readFileSync(loc.file);
  const why = unwritableReason(buf, loc.kind);
  if (why)
    throw new AudioError(
      "INVALID_ARGUMENT",
      `${loc.rel} is left alone: this writer cannot keep it byte for byte (${why}). Edit it in the Audio Editor.`,
    );
  const model = loadAudioModel(buf, loc.kind);
  const before = model.doc.serialize();
  if (loc.kind === "sig" && req.acceptStale !== true) {
    const compiled = blockOf(model.root, "compiled");
    if (compiled && compiled.children.length > 0)
      throw new AudioError(
        "SIG_COMPILED_STALE",
        `${loc.rel} carries a compiled block that this edit would leave stale`,
      );
  }
  let op: OpResult;
  switch (req.action as WriteAction | GraphAction) {
    case "set":
      op = setOp(model, req);
      break;
    case "renameEvent":
      op = renameEventOp(model, req);
      break;
    case "addSample":
      op = addSampleOp(model, req, loc.root);
      break;
    case "removeSample":
      op = removeSampleOp(model, req);
      break;
    case "setSample":
      op = setSampleOp(model, req, loc.root);
      break;
    case "setSimValue":
      op = setSimValueOp(model, req);
      break;
    case "addVariable":
      op = addVariableOp(model, req);
      break;
    case "removeVariable":
      op = removeVariableOp(model, req);
      break;
    default: {
      // addNode, removeNode, connect, disconnect, group: one dispatch (W5-TA-3B).
      try {
        op = graphResult(
          dispatch(model, req.action, req.args ?? {}, { confirm: req.confirm === true }),
        );
      } catch (e) {
        if (e instanceof AudioError || e instanceof CstEditError || e instanceof AudioModelError)
          throw e;
        const code = (e as { code?: unknown } | null)?.code;
        throw new AudioError(
          typeof code === "string" && code in ERROR_CODES
            ? (code as ErrorCode)
            : "INVALID_ARGUMENT",
          e instanceof Error ? e.message : String(e),
        );
      }
    }
  }
  if (loc.kind === "sig") op.warnings.push("the .sig compiled block was not regenerated (U11)");
  return commit(req, loc, before, model, op, false);
}

// ── Entry point ──────────────────────────────────────────────────────────────

const isGraph = (a: string): a is GraphAction => (GRAPH_ACTIONS as readonly string[]).includes(a);
const isWrite = (a: string): a is WriteAction => (WRITE_ACTIONS as readonly string[]).includes(a);
const isRead = (a: string): a is ReadAction => (READ_ACTIONS as readonly string[]).includes(a);

/** Runs one request; every refusal is an `ActionError`, never a throw. */
export function runAudio(
  req: AudioRequest,
  config: Config,
  gates: AudioGates = AUDIO_GATES,
  dispatch: GraphDispatch = defaultDispatch,
): ActionResponse {
  const target = `path:${String(req.path ?? "")}`;
  try {
    const action = String(req.action);
    if (isGraph(action)) {
      if (!gates.graphActions)
        throw new AudioError(
          "UNPROVEN",
          `${action} is built but unproven: offline graph authoring waits for probe P-W5-05 (DEC-068 OD-10); nothing was changed`,
          "Edit the graph in the Audio Editor until P-W5-05 passes.",
        );
    } else if (!isRead(action) && !isWrite(action)) {
      return bad(`unknown action "${action}"`);
    }
    if (isRead(action) && action === "catalog") return catalogAction(req, config);
    const root = pinnedProjectRoot(req.projectPath, config.projectPath);
    const loc = locate(req.path, root);
    return isRead(action)
      ? readAction(req, loc, config)
      : writeAction(req, loc, config, gates, dispatch);
  } catch (e) {
    if (e instanceof AudioError) return fail(req.action, target, e);
    if (e instanceof VocabularyError) return errorResponse(req.action, target, e.code, e.message);
    if (e instanceof AudioModelError) return errorResponse(req.action, target, e.code, e.message);
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

export const AUDIO_DESCRIPTION =
  "Offline Audio Editor files: .acp sound projects, .sig signals, .afm mixers, audio-variable .conf; vanilla pak paths readable. " +
  "Read: inspect, events, nodes, node, graph, samples, refs, variables, mixer, signal, validate, catalog. " +
  "Write, project files only, dry run unless confirm: set, renameEvent, addSample, removeSample, setSample, setSimValue, addVariable, removeVariable, create.";

const ref = z.union([z.string(), z.number().int()]);
const scalar = z.union([z.string(), z.number(), z.boolean()]);

export function registerAudio(server: McpServer, config: Config): void {
  server.registerTool(
    "audio",
    {
      description: AUDIO_DESCRIPTION,
      inputSchema: {
        action: z.enum([...READ_ACTIONS, ...WRITE_ACTIONS, ...GRAPH_ACTIONS]),
        path: z
          .string()
          .optional()
          .describe(
            "The file: project-relative, absolute in the project, or a game path. catalog: a folder prefix.",
          ),
        projectPath: z
          .string()
          .optional()
          .describe("Addon root. The configured project when omitted."),
        confirm: z.boolean().optional().describe("Write. Without it a write is a dry run (diff)."),
        overwrite: z.boolean().optional().describe("create: replace an existing file."),
        cursor: z.string().optional().describe("Cursor from the last page."),
        limit: z.number().int().min(1).max(LIMIT_MAX).optional().describe("Rows per page."),
        node: ref.optional().describe("Node id or exact name."),
        event: ref.optional().describe("Event name or id (a SoundClass)."),
        name: z.string().optional().describe("Filter, new event name, sample or variable name."),
        bank: ref.optional().describe("Bank id or name."),
        sample: ref.optional().describe("Sample name or position in its bank."),
        key: z.string().optional().describe("set: property path inside the node, e.g. volume_dB."),
        value: z
          .union([scalar, z.array(scalar)])
          .optional()
          .describe("set/setSimValue/addVariable: the value."),
        quoted: z.boolean().optional().describe("set: force quotes on or off."),
        file: z
          .string()
          .optional()
          .describe("Sample file: {GUID}path, or a registered project path."),
        guid: z.string().optional().describe("16-hex GUID of file when it has no {GUID} prefix."),
        index: z
          .number()
          .int()
          .optional()
          .describe("Sample Index, or the input index of setSimValue."),
        probability: z.number().optional().describe("Sample Probability."),
        port: z.number().int().optional().describe("setSimValue: input port of the signal."),
        min: z.number().optional().describe("setSimValue/addVariable: minimum."),
        max: z.number().optional().describe("setSimValue/addVariable: maximum."),
        source: z
          .string()
          .optional()
          .describe("addVariable: PlayTime, Amplitude, Constant, External."),
        varOp: z.string().optional().describe("addVariable: op, e.g. Max."),
        section: z.string().optional().describe("nodes: section filter."),
        nodeClass: z.string().optional().describe("nodes: class filter."),
        direction: z.enum(["up", "down", "both"]).optional().describe("graph: from a node."),
        depth: z.number().int().min(1).max(64).optional().describe("graph: hops from the node."),
        kind: z.string().optional().describe("refs: kind filter; catalog: acp, sig, afm, vars."),
        acceptStale: z.boolean().optional().describe("Write a .sig with a compiled block anyway."),
        args: z.record(z.string(), z.unknown()).optional().describe("Graph actions: arguments."),
      },
    },
    async (args) => {
      const r = runAudio(args as AudioRequest, config);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(r, null, 2) }],
        isError: !r.ok,
      };
    },
  );
}
