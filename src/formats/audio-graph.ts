/**
 * Graph authoring on `.acp` sound projects (W5 spec 0.1 and 4.1, DEC-068 OD-10;
 * package W5-TA-3B): addNode, removeNode, connect, disconnect, group.
 *
 * One dispatch, `applyGraphOp(model, op, args, { confirm })`, over the model of
 * src/formats/audio-model.ts. Every edit is a splice of the lossless CST
 * (src/formats/enfusion-cst.ts), so the bytes outside the edited entries never
 * change. An op runs on a copy of the document first and replaces `model.doc`
 * only when every step succeeded: a refused or failed op leaves the model as
 * it was. The op edits in memory in both modes; writing the file (and the
 * backup, project guard and dry-run diff) is the caller's (src/tools/audio.ts).
 *
 * GATED (DEC-068 OD-10): engine accept of an offline-authored graph is probe
 * P-W5-05. Until it passes, `confirm: true` answers GATED and changes nothing;
 * the dry run (no confirm) computes the edit so the caller can show the diff.
 * The main session flips `AUDIO_GRAPH_PROVEN` when the probe passes.
 *
 * Graph facts, measured on the 1.9.0.37 paks (720 .acp, 36,314 nodes in 25
 * classes, 75,613 links of which 3,111 are signal inputs, 0 parse diagnostics):
 *   - A node is an object in a section of `AudioClass` (`sounds`, `banks_local`,
 *     ...). Its id is the `id` scalar. 22 classes keep a fixed `id & 1023`
 *     (`ACP_CLASS_CODES`); `ACPInOut` and `ACPGroup` carry free ids. No id repeats
 *     within a file.
 *   - A link is `ConnectionClass` { id <source node>, port <source port> } inside
 *     `ins { ConnectionsClass { id <destination port>, links { ... } } }` of the
 *     destination node. A `SignalClass` keeps its input links under
 *     `conns { IOPConnectionClass { port, conn { ConnectionsClass ... } } }`.
 *   - Two header styles, per file and sometimes mixed: named
 *     (`SoundClass "69641"`, `ConnectionsClass "con:64"`, `ConnectionClass
 *     "70660:65"`) and bare (`SoundClass`, `ConnectionsClass connections`,
 *     `ConnectionClass connection`). New entries copy their siblings' style.
 *   - 654 `ConnectionsClass` blocks hold no `links` (a port stub); none holds an
 *     empty `links`, no `ins` is empty and no section is empty.
 *   - `GroupClass` { id, name, children { <ids> }, parent -1, Color r g b a };
 *     a node is in at most one group. Some vanilla groups list ids that are not
 *     nodes (4,632 of 22,229; id 0 even in two groups of three files), so new
 *     ids are taken above those too and the one-group rule counts nodes only.
 *   - Scalars that name a node: `outState` (SoundClass -> MixerClass, 4,169),
 *     `piid` and `group` (ACPInOut). `parent` on other nodes is a .conf path.
 *   - Canvas position is `tl x y` (34,359 nodes, always two numbers).
 */

import {
  CstDocument,
  CstEditError,
  tokenValue,
  type CstEdit,
  type CstObject,
  type EntrySpec,
  type ObjectSpec,
} from "./enfusion-cst.js";
import { ACP_CLASS_CODES, numOf, type AudioKind } from "./audio-model.js";
import { ERROR_CODES, type Change, type ErrorCode } from "../manifest/vocabulary.js";

// ── Gate ─────────────────────────────────────────────────────────────────────

/**
 * False until probe P-W5-05 (engine accept of an offline-authored graph)
 * passes. While false, `confirm: true` answers GATED. The main session flips it.
 */
export const AUDIO_GRAPH_PROVEN = false;
export const AUDIO_GRAPH_PROBE = "P-W5-05";
export const AUDIO_GRAPH_GATE_REASON =
  `Graph writes wait for probe ${AUDIO_GRAPH_PROBE} (engine accept of an offline-authored .acp graph, ` +
  "DEC-068 OD-10); the switch is AUDIO_GRAPH_PROVEN in src/formats/audio-graph.ts.";

// ── Codes ────────────────────────────────────────────────────────────────────

/** NODE_NOT_FOUND, LINK_NOT_FOUND and NODE_IN_USE are vocabulary codes since W5. */
export type GraphErrorCode = ErrorCode;

function nextFor(code: GraphErrorCode): string {
  return ERROR_CODES[code];
}

class GraphError extends Error {
  constructor(
    readonly code: GraphErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GraphError";
  }
}

// ── Node classes ─────────────────────────────────────────────────────────────

/**
 * Section and `version` of each node class, the value every vanilla node of
 * the class carries or the most common one (BankLocalClass 7 in 10,680 of
 * 11,247; BusClass 7 in 1,504 of 1,513; GeneratorClass 6 in 138 of 158;
 * SoundClass 5 in 4,169 of 4,216). SignalClass and GroupClass carry none.
 */
export const ACP_NODE_SECTIONS: Readonly<Record<string, { section: string; version?: number }>> = {
  GroupClass: { section: "groups" },
  BankLocalClass: { section: "banks_local", version: 7 },
  GeneratorClass: { section: "generators", version: 6 },
  SelectorClass: { section: "selectors", version: 5 },
  BusClass: { section: "buses", version: 7 },
  SoundClass: { section: "sounds", version: 5 },
  MixerClass: { section: "mixers", version: 4 },
  ConstantClass: { section: "constants", version: 5 },
  SignalClass: { section: "signals" },
  StreamClass: { section: "streams", version: 5 },
  ShaderClass: { section: "shaders", version: 5 },
  AmplitudeClass: { section: "amplitudes", version: 5 },
  FrequencyClass: { section: "frequency", version: 5 },
  FilterClass: { section: "filters", version: 5 },
  FilterChainClass: { section: "filter_chain", version: 5 },
  PlaylistClass: { section: "playlist", version: 5 },
  ReplacerClass: { section: "replacer", version: 5 },
  SpatialityClass: { section: "spatialities", version: 5 },
  AuxOutClass: { section: "auxOuts", version: 5 },
  VariableClass: { section: "vars", version: 5 },
  SwitchClass: { section: "switches", version: 5 },
  AuxSelectorClass: { section: "auxSelectors", version: 5 },
};

/** Classes whose id is not a graph id (no class code); never counted for a new id. */
const FREE_ID_CLASSES = new Set(["ACPInOut", "ACPGroup"]);
/** Classes that take no `ins` link here. */
const NO_INS_CLASSES = new Set(["GroupClass", "SignalClass", "ACPInOut", "ACPGroup"]);
/** Scalars that name another node by id (corpus). */
const REF_KEYS = ["outState", "piid", "group"];
/** Leading node keys an `ins` block is placed after (corpus order: id, name, comment, version, tl, ctl). */
const HEAD_KEYS = new Set(["id", "name", "comment", "version", "tl", "ctl"]);
/** Default group colour: the first vanilla group read (RGBA). */
export const DEFAULT_GROUP_COLOR: readonly number[] = [0.502, 0, 0.376, 0.329];
const ID_MAX = 2 ** 31 - 1;

// ── Model ────────────────────────────────────────────────────────────────────

/** The model the ops work on: `AudioModel` of audio-model.ts, or any `{ doc }`. */
export interface AudioGraphModel {
  doc: CstDocument;
  kind?: AudioKind;
}

/** One node of the graph as read. */
export interface GraphNode {
  id: number;
  cls: string;
  section: string;
  name?: string;
  tl?: [number, number];
  /** Header carries the id (`SoundClass "69641"`). */
  named: boolean;
  /** CST path from the root object: `[sectionIndex][nodeIndex]`. */
  path: string;
}

/** One link as read: source node and port into destination node and port. */
export interface GraphLink {
  from: number;
  fromPort: number;
  to: number;
  toPort: number;
  via: "ins" | "conns";
  /** Position inside its `links` block. */
  index: number;
  /** Header carries `<from>:<port>`. */
  named: boolean;
  /** CST path of the `ConnectionClass`. */
  path: string;
}

export interface GraphGroup {
  id: number;
  name?: string;
  members: number[];
  path: string;
}

export interface AudioGraph {
  nodes: GraphNode[];
  links: GraphLink[];
  groups: GraphGroup[];
  /** Highest graph id in use (node ids, group members, link sources), free-id classes excluded. */
  maxId: number;
}

interface NodeLoc extends GraphNode {
  obj: CstObject;
  sectionIndex: number;
  index: number;
}

interface Scan {
  root: CstObject;
  nodes: NodeLoc[];
  byId: Map<number, NodeLoc>;
  links: (GraphLink & { obj: CstObject })[];
  groups: GraphGroup[];
  maxId: number;
  namedNodes: number;
  bareNodes: number;
  namedConns: number;
  bareConns: number;
}

const isNamed = (o: CstObject) => o.head.length > 1 && o.head[1].kind === "string";

function rootOf(doc: CstDocument): CstObject {
  const objs = doc.root.children.filter((c) => c.kind !== "opaque");
  const r = objs.length === 1 ? objs[0] : undefined;
  if (!r || r.kind !== "object" || r.key !== "AudioClass") {
    throw new GraphError(
      "INVALID_ARGUMENT",
      `not an .acp sound project: the root is ${r?.kind === "object" ? r.key : "not one AudioClass object"}`,
    );
  }
  if (doc.diagnostics.length) {
    const d = doc.diagnostics[0];
    throw new GraphError(
      "INVALID_ARGUMENT",
      `the file does not parse cleanly (line ${d.line}: ${d.message})`,
    );
  }
  return r;
}

function idsOfValueBlock(o: CstObject | undefined): number[] {
  const out: number[] = [];
  for (const c of o?.children ?? []) {
    const toks =
      c.kind === "value" ? c.values : c.kind === "scalar" ? [c.keyToken, ...c.values] : [];
    for (const t of toks) {
      const n = Number(tokenValue(t));
      if (Number.isInteger(n)) out.push(n);
    }
  }
  return out;
}

function scan(doc: CstDocument): Scan {
  const root = rootOf(doc);
  const s: Scan = {
    root,
    nodes: [],
    byId: new Map(),
    links: [],
    groups: [],
    maxId: 0,
    namedNodes: 0,
    bareNodes: 0,
    namedConns: 0,
    bareConns: 0,
  };
  root.children.forEach((sec, si) => {
    if (sec.kind !== "object" || !sec.children.every((c) => c.kind === "object")) return;
    sec.children.forEach((n, ni) => {
      if (n.kind !== "object") return;
      const id = numOf(n, "id");
      if (id === undefined || !Number.isInteger(id)) return;
      const tl = blockTl(n);
      const name = n.children.find((c) => c.kind === "scalar" && c.key === "name");
      const loc: NodeLoc = {
        id,
        cls: n.key,
        section: sec.key,
        name:
          name && name.kind === "scalar" && name.values[0] ? tokenValue(name.values[0]) : undefined,
        tl,
        named: isNamed(n),
        path: `[${si}][${ni}]`,
        obj: n,
        sectionIndex: si,
        index: ni,
      };
      s.nodes.push(loc);
      if (!s.byId.has(id)) s.byId.set(id, loc);
      if (loc.named) s.namedNodes++;
      else s.bareNodes++;
      if (!FREE_ID_CLASSES.has(n.key)) s.maxId = Math.max(s.maxId, id);
      if (n.key === "GroupClass") {
        const ci = n.children.findIndex((c) => c.kind === "object" && c.key === "children");
        const members = idsOfValueBlock(ci >= 0 ? (n.children[ci] as CstObject) : undefined);
        for (const m of members) s.maxId = Math.max(s.maxId, m);
        s.groups.push({ id, name: loc.name, members, path: loc.path });
      }
    });
  });
  for (const n of s.nodes) collectLinks(s, n);
  for (const l of s.links) s.maxId = Math.max(s.maxId, l.from);
  return s;
}

function blockTl(n: CstObject): [number, number] | undefined {
  const t = n.children.find((c) => c.kind === "scalar" && c.key === "tl");
  if (!t || t.kind !== "scalar" || t.values.length !== 2) return undefined;
  const p: [number, number] = [Number(tokenValue(t.values[0])), Number(tokenValue(t.values[1]))];
  return Number.isFinite(p[0]) && Number.isFinite(p[1]) ? p : undefined;
}

function connectionsLinks(
  s: Scan,
  to: number,
  via: "ins" | "conns",
  cc: CstObject,
  ccPath: string,
  toPortOverride?: number,
): void {
  if (cc.key !== "ConnectionsClass") return;
  if (isNamed(cc)) s.namedConns++;
  else s.bareConns++;
  const toPort = toPortOverride ?? numOf(cc, "id") ?? 0;
  const li = cc.children.findIndex((c) => c.kind === "object" && c.key === "links");
  if (li < 0) return;
  const links = cc.children[li] as CstObject;
  links.children.forEach((l, k) => {
    if (l.kind !== "object" || l.key !== "ConnectionClass") return;
    const from = numOf(l, "id");
    if (from === undefined) return;
    if (isNamed(l)) s.namedConns++;
    else s.bareConns++;
    s.links.push({
      from,
      fromPort: numOf(l, "port") ?? 0,
      to,
      toPort,
      via,
      index: k,
      named: isNamed(l),
      path: `${ccPath}[${li}][${k}]`,
      obj: l,
    });
  });
}

function collectLinks(s: Scan, n: NodeLoc): void {
  n.obj.children.forEach((c, k) => {
    if (c.kind !== "object") return;
    if (c.key === "ins") {
      c.children.forEach((cc, j) => {
        if (cc.kind === "object") connectionsLinks(s, n.id, "ins", cc, `${n.path}[${k}][${j}]`);
      });
    } else if (c.key === "conns") {
      c.children.forEach((iop, j) => {
        if (iop.kind !== "object") return;
        const ci = iop.children.findIndex((x) => x.kind === "object" && x.key === "conn");
        if (ci < 0) return;
        const port = numOf(iop, "port") ?? 0;
        (iop.children[ci] as CstObject).children.forEach((cc, m) => {
          if (cc.kind === "object")
            connectionsLinks(s, n.id, "conns", cc, `${n.path}[${k}][${j}][${ci}][${m}]`, port);
        });
      });
    }
  });
}

/** The graph of an .acp: nodes, links, groups and the highest id in use. */
export function readGraph(model: AudioGraphModel | CstDocument): AudioGraph {
  const s = scan(model instanceof CstDocument ? model : model.doc);
  return {
    nodes: s.nodes.map(({ obj: _o, sectionIndex: _s, index: _i, ...n }) => n),
    links: s.links.map(({ obj: _o, ...l }) => l),
    groups: s.groups,
    maxId: s.maxId,
  };
}

/** The id `addNode` gives a node of class code `code`: `((maxId >> 10) + 1) << 10 | code`. */
export function nextNodeId(maxId: number, code: number): number {
  return (Math.floor(maxId / 1024) + 1) * 1024 + code;
}

/**
 * Graph invariants, as problems (empty when they hold): ids unique, class
 * codes kept, every link source a node, a node in at most one group.
 */
export function graphProblems(model: AudioGraphModel | CstDocument): string[] {
  const s = scan(model instanceof CstDocument ? model : model.doc);
  const out: string[] = [];
  const seen = new Set<number>();
  for (const n of s.nodes) {
    if (seen.has(n.id)) out.push(`id ${n.id} is used twice`);
    seen.add(n.id);
    const code = ACP_CLASS_CODES[n.cls];
    if (code !== undefined && (n.id & 1023) !== code)
      out.push(`${n.cls} ${n.id} has class code ${n.id & 1023}, not ${code}`);
  }
  for (const l of s.links) {
    if (!s.byId.has(l.from))
      out.push(`link into ${l.to}:${l.toPort} names ${l.from}, which is not a node`);
  }
  const member = new Map<number, number>();
  for (const g of s.groups) {
    for (const m of g.members) {
      // Vanilla groups list stale ids (not nodes), some in two groups: only nodes count.
      if (!s.byId.has(m)) continue;
      if (member.has(m) && member.get(m) !== g.id)
        out.push(`node ${m} is in groups ${member.get(m)} and ${g.id}`);
      member.set(m, g.id);
    }
  }
  return out;
}

// ── Op arguments ─────────────────────────────────────────────────────────────

export const GRAPH_OPS = ["addNode", "removeNode", "connect", "disconnect", "group"] as const;
export type GraphOp = (typeof GRAPH_OPS)[number];

export type HeaderStyle = "named" | "bare";

export interface AddNodeArgs {
  /** Node class (`SoundClass`, `BankLocalClass`, ...); GroupClass goes through `group`. */
  class: string;
  name?: string;
  /** Canvas position, written `tl x y`. */
  x: number;
  y: number;
  /** Overrides the class's vanilla `version`. */
  version?: number;
}

export interface RemoveNodeArgs {
  id: number;
  /** Remove even when `outState`, `piid` or `group` of another node names it (those stay, with a warning). */
  force?: boolean;
}

export interface ConnectArgs {
  from: number;
  fromPort: number;
  to: number;
  toPort: number;
  /** Position in the port's `links` (default: last). */
  index?: number;
  /** Header style of the entries this creates (default: their siblings', else the file's). */
  style?: HeaderStyle;
}

export interface DisconnectArgs {
  from: number;
  to: number;
  fromPort?: number;
  toPort?: number;
  /**
   * When the port's last link goes: true (default) keeps the port as a
   * `ConnectionsClass { id }` stub, the vanilla shape; false removes the port,
   * and `ins` with it when it empties.
   */
  keepEmpty?: boolean;
}

export interface GroupArgs {
  /** An existing group to edit; absent creates a new group. */
  group?: number;
  /** New group: its name. */
  name?: string;
  /** New group: its members. Existing group: replaces the member list. */
  members?: number[];
  /** Existing group: members to append / to drop. */
  add?: number[];
  remove?: number[];
  /** New group: RGBA colour (default DEFAULT_GROUP_COLOR). */
  color?: number[];
}

export type GraphOpArgs = AddNodeArgs | RemoveNodeArgs | ConnectArgs | DisconnectArgs | GroupArgs;

export interface GraphOpOptions {
  /** Write intent. While AUDIO_GRAPH_PROVEN is false it answers GATED. */
  confirm?: boolean;
}

export interface GraphOpOk {
  ok: true;
  op: GraphOp;
  dryRun: boolean;
  /** Null when the op found the graph already as asked (nothing edited). */
  changed: Change[] | null;
  readback: Record<string, unknown>;
  /** The splices, in order, each in the coordinates of the text before it. */
  edits: CstEdit[];
  /** The op that undoes this one, when there is one. */
  inverse?: { op: GraphOp; args: Record<string, unknown> };
  warnings: string[];
}

export interface GraphOpError {
  ok: false;
  op: string;
  code: GraphErrorCode;
  message: string;
  next: string;
  warnings: string[];
}

export type GraphOpResult = GraphOpOk | GraphOpError;

// ── Validation ───────────────────────────────────────────────────────────────

type Rec = Record<string, unknown>;

function only(args: Rec, keys: string[]): void {
  for (const k of Object.keys(args)) {
    if (!keys.includes(k))
      throw new GraphError(
        "INVALID_ARGUMENT",
        `unknown argument '${k}' (takes ${keys.join(", ")})`,
      );
  }
}

function intArg(args: Rec, key: string, required: boolean, min = 0): number | undefined {
  const v = args[key];
  if (v === undefined) {
    if (required) throw new GraphError("INVALID_ARGUMENT", `'${key}' is required`);
    return undefined;
  }
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > ID_MAX) {
    throw new GraphError(
      "INVALID_ARGUMENT",
      `'${key}' must be an integer from ${min} to ${ID_MAX}`,
    );
  }
  return v;
}

function numArg(args: Rec, key: string): number {
  const v = args[key];
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new GraphError("INVALID_ARGUMENT", `'${key}' must be a finite number`);
  }
  return v;
}

function boolArg(args: Rec, key: string): boolean | undefined {
  const v = args[key];
  if (v === undefined) return undefined;
  if (typeof v !== "boolean")
    throw new GraphError("INVALID_ARGUMENT", `'${key}' must be true or false`);
  return v;
}

function nameArg(args: Rec, key: string, required: boolean): string | undefined {
  const v = args[key];
  if (v === undefined) {
    if (required) throw new GraphError("INVALID_ARGUMENT", `'${key}' is required`);
    return undefined;
  }
  if (
    typeof v !== "string" ||
    v === "" ||
    /["\r\n\0]/.test(v) ||
    v.endsWith("\\") ||
    v.length > 256
  ) {
    throw new GraphError(
      "INVALID_ARGUMENT",
      `'${key}' must be 1 to 256 characters with no quote, line break or trailing backslash`,
    );
  }
  return v;
}

function idListArg(args: Rec, key: string): number[] | undefined {
  const v = args[key];
  if (v === undefined) return undefined;
  if (
    !Array.isArray(v) ||
    v.some((x) => typeof x !== "number" || !Number.isInteger(x) || x < 0 || x > ID_MAX)
  ) {
    throw new GraphError("INVALID_ARGUMENT", `'${key}' must be a list of node ids`);
  }
  if (new Set(v).size !== v.length)
    throw new GraphError("INVALID_ARGUMENT", `'${key}' names an id twice`);
  return v as number[];
}

function styleArg(args: Rec): HeaderStyle | undefined {
  const v = args.style;
  if (v === undefined) return undefined;
  if (v !== "named" && v !== "bare")
    throw new GraphError("INVALID_ARGUMENT", "'style' must be named or bare");
  return v;
}

function nodeOf(s: Scan, id: number, role: string): NodeLoc {
  const n = s.byId.get(id);
  if (!n) throw new GraphError("NODE_NOT_FOUND", `${role} ${id}: no node has that id`);
  return n;
}

// ── Edit helpers ─────────────────────────────────────────────────────────────

class Work {
  readonly edits: CstEdit[] = [];
  constructor(readonly doc: CstDocument) {}
  scan(): Scan {
    return scan(this.doc);
  }
  create(path: string, spec: ObjectSpec, index?: number): void {
    this.edits.push(this.doc.createObject(path, spec, index));
  }
  delete(path: string): void {
    this.edits.push(this.doc.delete(path));
  }
  setValues(path: string, values: number[]): void {
    this.edits.push(this.doc.set(path, values));
  }
}

function fileStyle(named: number, bare: number): HeaderStyle {
  return named >= bare ? "named" : "bare";
}

function childIndex(o: CstObject, key: string): number {
  return o.children.findIndex((c) => c.kind === "object" && c.key === key);
}

function linkSpec(from: number, fromPort: number, style: HeaderStyle): ObjectSpec {
  return {
    key: "ConnectionClass",
    name: style === "named" ? `${from}:${fromPort}` : "connection",
    entries: [
      { key: "id", value: from },
      { key: "port", value: fromPort },
    ],
  };
}

function portSpec(toPort: number, link: ObjectSpec, style: HeaderStyle): ObjectSpec {
  return {
    key: "ConnectionsClass",
    name: style === "named" ? `con:${toPort}` : "connections",
    entries: [
      { key: "id", value: toPort },
      { object: { key: "links", entries: [{ object: link }] } },
    ],
  };
}

/** Index after the last leading head key (id, name, comment, version, tl, ctl). */
function insIndex(n: CstObject): number {
  let at = 0;
  n.children.forEach((c, i) => {
    if (c.kind === "scalar" && HEAD_KEYS.has(c.key)) at = i + 1;
  });
  return at;
}

/**
 * Removes one link (`l.path`) and prunes what it leaves empty: the `links`
 * block (an `ins` port keeps its `ConnectionsClass { id }` stub when
 * `keepEmpty`, else goes, and `ins` with it when it empties); for a signal
 * input, the whole `IOPConnectionClass`, and `conns` when it empties.
 */
function removeLink(w: Work, l: GraphLink, keepEmpty: boolean): "link" | "links" | "port" | "ins" {
  const segs = l.path.match(/\[\d+\]/g) as string[];
  const up = (k: number) => segs.slice(0, segs.length - k).join("");
  const resolveObj = (p: string) => w.doc.resolve(p) as CstObject;
  const links = resolveObj(up(1));
  if (links.children.length > 1) {
    w.delete(l.path);
    return "link";
  }
  if (l.via === "ins") {
    if (keepEmpty) {
      w.delete(up(1));
      return "links";
    }
    const ins = resolveObj(up(3));
    if (ins.children.length > 1) {
      w.delete(up(2));
      return "port";
    }
    w.delete(up(3));
    return "ins";
  }
  // conns: <node>[conns][iop][conn][cc][links][link]
  const conns = resolveObj(up(5));
  if (conns.children.length > 1) w.delete(up(4));
  else w.delete(up(5));
  return "port";
}

/** Deletes a node, and its section when it was the last one (no vanilla section is empty). */
function deleteNode(w: Work, n: NodeLoc, s: Scan): void {
  const section = s.root.children[n.sectionIndex] as CstObject;
  if (section.children.length === 1) w.delete(`[${n.sectionIndex}]`);
  else w.delete(n.path);
}

// ── Ops ──────────────────────────────────────────────────────────────────────

interface OpOut {
  changed: Change[] | null;
  readback: Record<string, unknown>;
  inverse?: { op: GraphOp; args: Record<string, unknown> };
  warnings: string[];
}

function addNode(w: Work, args: Rec): OpOut {
  only(args, ["class", "name", "x", "y", "version"]);
  const cls = args.class;
  if (typeof cls !== "string") throw new GraphError("INVALID_ARGUMENT", "'class' is required");
  if (cls === "GroupClass")
    throw new GraphError("INVALID_ARGUMENT", "a group is made with the group op");
  const meta = ACP_NODE_SECTIONS[cls];
  const code = ACP_CLASS_CODES[cls];
  if (!meta || code === undefined) {
    const known = Object.keys(ACP_NODE_SECTIONS).filter((k) => k !== "GroupClass");
    throw new GraphError("INVALID_ARGUMENT", `'class' must be one of ${known.join(", ")}`);
  }
  const name = nameArg(args, "name", false);
  const x = numArg(args, "x");
  const y = numArg(args, "y");
  const version = intArg(args, "version", false) ?? meta.version;
  const s = w.scan();
  const id = nextNodeId(s.maxId, code);
  if (id > ID_MAX)
    throw new GraphError("INVALID_ARGUMENT", "no id is left below 2^31 in this file");
  const si = s.root.children.findIndex((c) => c.kind === "object" && c.key === meta.section);
  const siblings = si >= 0 ? (s.root.children[si] as CstObject).children : [];
  const last = siblings[siblings.length - 1];
  const style: HeaderStyle =
    last && last.kind === "object"
      ? isNamed(last)
        ? "named"
        : "bare"
      : fileStyle(s.namedNodes, s.bareNodes);
  const entries: EntrySpec[] = [{ key: "id", value: id }];
  if (name !== undefined) entries.push({ key: "name", value: name, quoted: true });
  if (version !== undefined) entries.push({ key: "version", value: version });
  entries.push({ key: "tl", value: [x, y] });
  const spec: ObjectSpec = { key: cls, name: style === "named" ? String(id) : undefined, entries };
  let createdSection = false;
  if (si >= 0) {
    w.create(`[${si}]`, spec);
  } else {
    let at = 0;
    s.root.children.forEach((c, i) => {
      if (c.kind === "object") at = i + 1;
    });
    w.create("", { key: meta.section, entries: [{ object: spec }] }, at);
    createdSection = true;
  }
  const warnings: string[] = [];
  if (cls === "SignalClass")
    warnings.push("a SignalClass needs `res` and `path` naming its .sig; set them with audio set");
  if (cls === "MixerClass")
    warnings.push("a MixerClass needs `res` naming its .afm; set it with audio set");
  return {
    changed: [{ path: `node:${id}`, before: null, after: { class: cls, name, tl: [x, y] } }],
    readback: {
      id,
      class: cls,
      section: meta.section,
      name,
      tl: [x, y],
      version,
      style,
      createdSection,
    },
    inverse: { op: "removeNode", args: { id } },
    warnings,
  };
}

function connect(w: Work, args: Rec): OpOut {
  only(args, ["from", "fromPort", "to", "toPort", "index", "style"]);
  const from = intArg(args, "from", true) as number;
  const fromPort = intArg(args, "fromPort", true) as number;
  const to = intArg(args, "to", true) as number;
  const toPort = intArg(args, "toPort", true) as number;
  const index = intArg(args, "index", false);
  const forced = styleArg(args);
  const s = w.scan();
  const src = nodeOf(s, from, "from");
  const dst = nodeOf(s, to, "to");
  if (from === to) throw new GraphError("INVALID_ARGUMENT", "a node cannot link to itself");
  if (NO_INS_CLASSES.has(dst.cls)) {
    throw new GraphError(
      "INVALID_ARGUMENT",
      `a ${dst.cls} takes no ins link here${dst.cls === "SignalClass" ? " (signal inputs are made in the Audio Editor)" : ""}`,
    );
  }
  if (src.cls === "GroupClass" || FREE_ID_CLASSES.has(src.cls)) {
    throw new GraphError("INVALID_ARGUMENT", `a ${src.cls} is not a link source`);
  }
  const existing = s.links.find(
    (l) =>
      l.via === "ins" &&
      l.to === to &&
      l.toPort === toPort &&
      l.from === from &&
      l.fromPort === fromPort,
  );
  if (existing) {
    return {
      changed: null,
      readback: { from, fromPort, to, toPort, index: existing.index, created: "none" },
      warnings: ["the link is already there; nothing changed"],
    };
  }
  const fileS = fileStyle(s.namedConns, s.bareConns);
  const ii = childIndex(dst.obj, "ins");
  let created: "link" | "links" | "port" | "ins";
  let at: number;
  if (ii < 0) {
    const style = forced ?? fileS;
    w.create(
      dst.path,
      {
        key: "ins",
        entries: [{ object: portSpec(toPort, linkSpec(from, fromPort, style), style) }],
      },
      insIndex(dst.obj),
    );
    created = "ins";
    at = 0;
  } else {
    const ins = dst.obj.children[ii] as CstObject;
    const pj = ins.children.findIndex(
      (c) => c.kind === "object" && c.key === "ConnectionsClass" && numOf(c, "id") === toPort,
    );
    const insPath = `${dst.path}[${ii}]`;
    if (pj < 0) {
      const sib = ins.children.find(
        (c): c is CstObject => c.kind === "object" && c.key === "ConnectionsClass",
      );
      const style = forced ?? (sib ? (isNamed(sib) ? "named" : "bare") : fileS);
      w.create(insPath, portSpec(toPort, linkSpec(from, fromPort, style), style));
      created = "port";
      at = 0;
    } else {
      const port = ins.children[pj] as CstObject;
      const portPath = `${insPath}[${pj}]`;
      const li = childIndex(port, "links");
      if (li < 0) {
        const style = forced ?? (isNamed(port) ? "named" : "bare");
        w.create(portPath, {
          key: "links",
          entries: [{ object: linkSpec(from, fromPort, style) }],
        });
        created = "links";
        at = 0;
      } else {
        const links = port.children[li] as CstObject;
        const sib = links.children.find(
          (c): c is CstObject => c.kind === "object" && c.key === "ConnectionClass",
        );
        const style =
          forced ?? (sib ? (isNamed(sib) ? "named" : "bare") : isNamed(port) ? "named" : "bare");
        const n = links.children.length;
        if (index !== undefined && index > n) {
          throw new GraphError(
            "INVALID_ARGUMENT",
            `'index' ${index} is past the port's ${n} links`,
          );
        }
        w.create(`${portPath}[${li}]`, linkSpec(from, fromPort, style), index);
        created = "link";
        at = index ?? n;
      }
    }
  }
  return {
    changed: [{ path: `link:${to}:${toPort}`, before: null, after: `${from}:${fromPort}` }],
    readback: { from, fromPort, to, toPort, index: at, created },
    inverse: {
      op: "disconnect",
      args: { from, fromPort, to, toPort, keepEmpty: created === "link" || created === "links" },
    },
    warnings: [],
  };
}

function disconnect(w: Work, args: Rec): OpOut {
  only(args, ["from", "to", "fromPort", "toPort", "keepEmpty"]);
  const from = intArg(args, "from", true) as number;
  const to = intArg(args, "to", true) as number;
  const fromPort = intArg(args, "fromPort", false);
  const toPort = intArg(args, "toPort", false);
  const keepEmpty = boolArg(args, "keepEmpty") ?? true;
  const s = w.scan();
  nodeOf(s, to, "to");
  const hits = s.links.filter(
    (l) =>
      l.to === to &&
      l.from === from &&
      (fromPort === undefined || l.fromPort === fromPort) &&
      (toPort === undefined || l.toPort === toPort),
  );
  if (hits.length === 0) {
    throw new GraphError(
      "LINK_NOT_FOUND",
      `no link from ${from}${fromPort === undefined ? "" : `:${fromPort}`} into ${to}${toPort === undefined ? "" : `:${toPort}`}`,
    );
  }
  if (hits.length > 1) {
    const list = hits.map((h) => `${h.from}:${h.fromPort} -> ${h.to}:${h.toPort}`).join(", ");
    throw new GraphError(
      "INVALID_ARGUMENT",
      `${hits.length} links match (${list}); give fromPort and toPort`,
    );
  }
  const l = hits[0];
  const removed = removeLink(w, l, keepEmpty);
  const warnings: string[] = [];
  let inverse: OpOut["inverse"];
  if (l.via === "ins") {
    const inv: Record<string, unknown> = {
      from,
      fromPort: l.fromPort,
      to,
      toPort: l.toPort,
      style: l.named ? "named" : "bare",
    };
    if (removed === "link") inv.index = l.index;
    inverse = { op: "connect", args: inv };
  } else {
    warnings.push(
      "a signal input link was removed; connect cannot re-create it (signal inputs are made in the Audio Editor)",
    );
  }
  return {
    changed: [{ path: `link:${to}:${l.toPort}`, before: `${l.from}:${l.fromPort}`, after: null }],
    readback: { from, fromPort: l.fromPort, to, toPort: l.toPort, via: l.via, removed },
    inverse,
    warnings,
  };
}

function removeNode(w: Work, args: Rec): OpOut {
  only(args, ["id", "force"]);
  const id = intArg(args, "id", true) as number;
  const force = boolArg(args, "force") ?? false;
  let s = w.scan();
  const n = nodeOf(s, id, "id");
  const warnings: string[] = [];
  const users: string[] = [];
  for (const o of s.nodes) {
    if (o.id === id) continue;
    for (const k of REF_KEYS) {
      if (k === "group" && o.cls !== "ACPInOut") continue;
      if (numOf(o.obj, k) === id) users.push(`${o.cls} ${o.id} ${k}`);
    }
  }
  if (users.length && !force) {
    throw new GraphError("NODE_IN_USE", `${n.cls} ${id} is named by ${users.join(", ")}`);
  }
  if (users.length) warnings.push(`left naming a removed node: ${users.join(", ")}`);
  const droppedLinks: string[] = [];
  for (;;) {
    const l = s.links.find((x) => x.from === id && x.to !== id);
    if (!l) break;
    removeLink(w, l, true);
    droppedLinks.push(`${l.from}:${l.fromPort} -> ${l.to}:${l.toPort}`);
    s = w.scan();
  }
  let group: number | undefined;
  let droppedGroup = false;
  const g = s.groups.find((x) => x.id !== id && x.members.includes(id));
  if (g) {
    group = g.id;
    const rest = g.members.filter((m) => m !== id);
    if (rest.length === 0) {
      deleteNode(w, s.byId.get(g.id) as NodeLoc, s);
      droppedGroup = true;
      warnings.push(`group ${g.id} held only this node and was removed with it`);
    } else {
      const gn = s.byId.get(g.id) as NodeLoc;
      const ci = childIndex(gn.obj, "children");
      const vi = (gn.obj.children[ci] as CstObject).children.findIndex((c) => c.kind === "value");
      if (vi < 0 || (gn.obj.children[ci] as CstObject).children.length !== 1) {
        throw new GraphError(
          "INVALID_ARGUMENT",
          `group ${g.id} lists its members in a shape this edit does not handle`,
        );
      }
      w.setValues(`${g.path}[${ci}][${vi}]`, rest);
    }
    s = w.scan();
  }
  deleteNode(w, nodeOf(s, id, "id"), s);
  return {
    changed: [{ path: `node:${id}`, before: { class: n.cls, name: n.name }, after: null }],
    readback: { id, class: n.cls, section: n.section, droppedLinks, group, droppedGroup },
    warnings,
  };
}

function group(w: Work, args: Rec): OpOut {
  only(args, ["group", "name", "members", "add", "remove", "color"]);
  const gid = intArg(args, "group", false);
  const members = idListArg(args, "members");
  const add = idListArg(args, "add");
  const remove = idListArg(args, "remove");
  const s = w.scan();
  const memberOf = new Map<number, number>();
  for (const g of s.groups) for (const m of g.members) memberOf.set(m, g.id);
  const checkMembers = (ids: number[], self?: number) => {
    for (const m of ids) {
      const n = nodeOf(s, m, "member");
      if (n.cls === "GroupClass" || FREE_ID_CLASSES.has(n.cls)) {
        throw new GraphError("INVALID_ARGUMENT", `member ${m} is a ${n.cls}, not a graph node`);
      }
      const in_ = memberOf.get(m);
      if (in_ !== undefined && in_ !== self) {
        throw new GraphError(
          "INVALID_ARGUMENT",
          `node ${m} is already in group ${in_}; take it out of that group first`,
        );
      }
    }
  };
  if (gid === undefined) {
    if (add || remove)
      throw new GraphError(
        "INVALID_ARGUMENT",
        "'add' and 'remove' edit an existing group: give 'group'",
      );
    const name = nameArg(args, "name", true) as string;
    if (!members || members.length === 0)
      throw new GraphError("INVALID_ARGUMENT", "a new group needs 'members'");
    const color = args.color === undefined ? [...DEFAULT_GROUP_COLOR] : args.color;
    if (
      !Array.isArray(color) ||
      color.length !== 4 ||
      color.some((c) => typeof c !== "number" || !(c >= 0 && c <= 1))
    ) {
      throw new GraphError("INVALID_ARGUMENT", "'color' must be four numbers from 0 to 1 (RGBA)");
    }
    checkMembers(members);
    const id = nextNodeId(s.maxId, ACP_CLASS_CODES.GroupClass);
    if (id > ID_MAX)
      throw new GraphError("INVALID_ARGUMENT", "no id is left below 2^31 in this file");
    const si = s.root.children.findIndex((c) => c.kind === "object" && c.key === "groups");
    const siblings = si >= 0 ? (s.root.children[si] as CstObject).children : [];
    const last = siblings[siblings.length - 1];
    const style: HeaderStyle =
      last && last.kind === "object"
        ? isNamed(last)
          ? "named"
          : "bare"
        : fileStyle(s.namedNodes, s.bareNodes);
    const spec: ObjectSpec = {
      key: "GroupClass",
      name: style === "named" ? String(id) : undefined,
      entries: [
        { key: "id", value: id },
        { key: "name", value: name, quoted: true },
        { object: { key: "children", entries: [{ value: members }] } },
        { key: "parent", value: -1 },
        { key: "Color", value: color as number[] },
      ],
    };
    let createdSection = false;
    if (si >= 0) w.create(`[${si}]`, spec);
    else {
      let at = 0;
      s.root.children.forEach((c, i) => {
        if (c.kind === "object") at = i + 1;
      });
      w.create("", { key: "groups", entries: [{ object: spec }] }, at);
      createdSection = true;
    }
    return {
      changed: [{ path: `group:${id}`, before: null, after: members }],
      readback: { group: id, name, members, createdSection },
      inverse: { op: "removeNode", args: { id } },
      warnings: [],
    };
  }
  if (args.name !== undefined || args.color !== undefined) {
    throw new GraphError(
      "INVALID_ARGUMENT",
      "'name' and 'color' are for a new group; rename with audio set",
    );
  }
  const gn = nodeOf(s, gid, "group");
  if (gn.cls !== "GroupClass")
    throw new GraphError("INVALID_ARGUMENT", `${gid} is a ${gn.cls}, not a GroupClass`);
  const g = s.groups.find((x) => x.id === gid) as GraphGroup;
  if (members && (add || remove)) {
    throw new GraphError(
      "INVALID_ARGUMENT",
      "give either 'members' (the whole list) or 'add'/'remove'",
    );
  }
  if (!members && !add && !remove)
    throw new GraphError("INVALID_ARGUMENT", "give 'members', 'add' or 'remove'");
  let next: number[];
  if (members) next = members;
  else {
    for (const m of add ?? [])
      if (g.members.includes(m))
        throw new GraphError("INVALID_ARGUMENT", `node ${m} is already in group ${gid}`);
    for (const m of remove ?? [])
      if (!g.members.includes(m))
        throw new GraphError("INVALID_ARGUMENT", `node ${m} is not in group ${gid}`);
    next = [...g.members.filter((m) => !(remove ?? []).includes(m)), ...(add ?? [])];
  }
  if (next.length === 0) {
    throw new GraphError(
      "INVALID_ARGUMENT",
      "a group cannot be left empty; remove the group with removeNode",
    );
  }
  checkMembers(
    next.filter((m) => !g.members.includes(m)),
    gid,
  );
  if (next.length === g.members.length && next.every((m, i) => m === g.members[i])) {
    return {
      changed: null,
      readback: { group: gid, members: next },
      warnings: ["the group already lists these members"],
    };
  }
  const ci = childIndex(gn.obj, "children");
  const block = ci >= 0 ? (gn.obj.children[ci] as CstObject) : undefined;
  if (!block || block.children.length !== 1 || block.children[0].kind !== "value") {
    throw new GraphError(
      "INVALID_ARGUMENT",
      `group ${gid} lists its members in a shape this edit does not handle`,
    );
  }
  w.setValues(`${gn.path}[${ci}][0]`, next);
  return {
    changed: [{ path: `group:${gid}`, before: g.members, after: next }],
    readback: { group: gid, members: next },
    inverse: { op: "group", args: { group: gid, members: g.members } },
    warnings: [],
  };
}

const OPS: Record<GraphOp, (w: Work, args: Rec) => OpOut> = {
  addNode,
  removeNode,
  connect,
  disconnect,
  group,
};

// ── Dispatch ─────────────────────────────────────────────────────────────────

/**
 * Applies one graph op to `model.doc`. The op runs on a copy; on success
 * `model.doc` is replaced by the edited document, on a refusal the model is
 * untouched. Never throws for a refusal: it answers `{ ok: false, code }`.
 */
export function applyGraphOp(
  model: AudioGraphModel,
  op: string,
  args: unknown,
  options: GraphOpOptions = {},
): GraphOpResult {
  const fail = (code: GraphErrorCode, message: string, next = nextFor(code)): GraphOpError => ({
    ok: false,
    op,
    code,
    message,
    next,
    warnings: [],
  });
  if (!(GRAPH_OPS as readonly string[]).includes(op)) {
    return fail("INVALID_ARGUMENT", `unknown graph op '${op}' (one of ${GRAPH_OPS.join(", ")})`);
  }
  if (model.kind !== undefined && model.kind !== "acp") {
    return fail("INVALID_ARGUMENT", `graph ops edit .acp sound projects, not a ${model.kind} file`);
  }
  if (options.confirm && !AUDIO_GRAPH_PROVEN) {
    return fail(
      "GATED",
      `${op} is not written yet: ${AUDIO_GRAPH_GATE_REASON}`,
      `Run it without confirm for the dry run. ${ERROR_CODES.GATED}`,
    );
  }
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    return fail("INVALID_ARGUMENT", "the op arguments must be an object");
  }
  const work = new Work(new CstDocument(model.doc.text, model.doc.encoding));
  let out: OpOut;
  try {
    out = OPS[op as GraphOp](work, args as Rec);
  } catch (e) {
    if (e instanceof GraphError) return fail(e.code, e.message);
    if (e instanceof CstEditError) {
      return fail(e.code === "PATH_NOT_FOUND" ? "PATH_NOT_FOUND" : "INVALID_ARGUMENT", e.message);
    }
    throw e;
  }
  if (out.changed !== null) model.doc = work.doc;
  return {
    ok: true,
    op: op as GraphOp,
    dryRun: !options.confirm,
    changed: out.changed,
    readback: out.readback,
    edits: work.edits,
    inverse: out.inverse,
    warnings: out.warnings,
  };
}

/** Every entry of a node, flattened (tests and callers that diff nodes). */
export function nodeText(model: AudioGraphModel | CstDocument, id: number): string | undefined {
  const doc = model instanceof CstDocument ? model : model.doc;
  const n = scan(doc).byId.get(id);
  return n ? doc.text.slice(n.obj.start, n.obj.end) : undefined;
}
