/**
 * Model, checks and edits of `.pap` (procedural animation project) and `.siga`
 * (signal graph) files, on the lossless CST (formats/enfusion-cst.ts).
 *
 * Shape, from the 47 `.pap` and 46 `.siga` of the vanilla paks (build 1.9.0.37; the CST
 * gives every one back byte for byte):
 *
 *   ProcAnimProjectClass {            ProcAnimSignalResClass {
 *    signals { SignalClass {...} }      Inputs  { IOPItemInputClass | IOPInputValueClass | IOPInputRandomClass }
 *    funcs   { BoneClass, *SetClass,    Ops     { IOPItemOp*Class { inputs { ConnectionClass connection {id port} } } }
 *              *MakeClass }             Outputs { IOPItemOutputClass { input <id> } }
 *    groups  { GroupClass }             compiled IOPCompiledClass { ins ops outs visited ... }
 *    model "{GUID}x.xob"               }
 *    compiled ProcAnimCompiledClass {...}
 *   }
 *
 * Nodes are addressed by their `id` (or a unique `name`). Edits splice the text and parse it
 * again, so bytes outside the edit never change. The compiled blocks are NOT rebuilt here:
 * only the editor's save writes them (U11), so every edit that changes what a node computes
 * leaves them stale, and `PROCANIM_RECOMPILE_SCRIPTED` says how that is fixed today.
 */

import {
  CstEditError,
  parseCst,
  parseCstBytes,
  tokenValue,
  type CstDocument,
  type CstObject,
  type CstScalar,
  type EntrySpec,
  type ObjectSpec,
  type ScalarInput,
} from "../formats/enfusion-cst.js";
import type { Change, ErrorCode } from "../manifest/vocabulary.js";
import { PROCANIM_CLASSES, type ProcAnimClassInfo } from "./catalog.js";

/**
 * U11 switch, owned by the integrator. False until probe P-W4-12 shows that a scripted editor
 * save (`wb_module.save` on the ProcAnimEditor) rewrites the compiled blocks; while false,
 * every write answers with the hand step (open the file in the ProcAnim Editor and save).
 * If P-W4-12 is killed it stays false (DEC-067 OD-11, OI-W4-2).
 */
export const PROCANIM_RECOMPILE_SCRIPTED = false;

/** The `next` text of a write that leaves the compiled blocks stale. */
export function recompileNext(): string {
  return PROCANIM_RECOMPILE_SCRIPTED
    ? "The compiled blocks are stale: open the file in the ProcAnim Editor (wb_module setResource) and run wb_module save to recompile them."
    : "The compiled blocks are stale: open and save in the ProcAnim Editor to recompile (the editor save is not scripted until P-W4-12 passes).";
}

export type ProcAnimKind = "pap" | "siga";

/** A refusal with a vocabulary code. */
export class ProcAnimError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ProcAnimError";
  }
}

const bad = (message: string): never => {
  throw new ProcAnimError("INVALID_ARGUMENT", message);
};
const missing = (message: string): never => {
  throw new ProcAnimError("PATH_NOT_FOUND", message);
};

export const ROOT_KEY: Record<ProcAnimKind, string> = {
  pap: "ProcAnimProjectClass",
  siga: "ProcAnimSignalResClass",
};

export interface Parsed {
  kind: ProcAnimKind;
  doc: CstDocument;
}

/** The one root object of the document; undefined when it has none. */
function rootOf(doc: CstDocument): CstObject | undefined {
  const kids = doc.root.children.filter((c) => c.kind !== "opaque");
  return kids.length === 1 && kids[0].kind === "object" ? kids[0] : undefined;
}

/** Reads text or bytes; throws INVALID_ARGUMENT when the file is not a `.pap` or `.siga`. */
export function parseProcAnim(input: string | Uint8Array, expect?: ProcAnimKind): Parsed {
  const doc = typeof input === "string" ? parseCst(input) : parseCstBytes(input);
  if (doc.diagnostics.length > 0) {
    const d = doc.diagnostics[0];
    return bad(`line ${d.line}: ${d.message}`);
  }
  const root = rootOf(doc);
  const kind = (Object.keys(ROOT_KEY) as ProcAnimKind[]).find((k) => root?.key === ROOT_KEY[k]);
  if (!root || !kind)
    return bad("not a ProcAnim file: expected one ProcAnimProjectClass or ProcAnimSignalResClass");
  if (expect && kind !== expect)
    return bad(`the file is a .${kind} (${ROOT_KEY[kind]}), not a .${expect}`);
  return { kind, doc };
}

// ── Reading helpers ──────────────────────────────────────────────────────────

const objects = (o: CstObject): CstObject[] =>
  o.children.filter((c): c is CstObject => c.kind === "object");

const blockOf = (o: CstObject, key: string): CstObject | undefined =>
  o.children.find((c): c is CstObject => c.kind === "object" && c.key === key);

const scalarOf = (o: CstObject, key: string): CstScalar | undefined =>
  o.children.find((c): c is CstScalar => c.kind === "scalar" && c.key === key);

const textOf = (s: CstScalar | undefined): string | undefined =>
  s ? s.values.map(tokenValue).join(" ") : undefined;

const intOf = (s: CstScalar | undefined): number | undefined => {
  const t = s?.values[0] ? tokenValue(s.values[0]) : undefined;
  if (t === undefined || !/^-?\d+$/.test(t)) return undefined;
  return Number(t);
};

/** The numbers of a block of id lists: `1 18` and `2` lines alike. */
export function numbersOf(o: CstObject | undefined): number[] {
  const out: number[] = [];
  for (const c of o?.children ?? []) {
    if (c.kind === "value") for (const t of c.values) out.push(Number(tokenValue(t)));
    else if (c.kind === "scalar")
      out.push(Number(c.key), ...c.values.map((t) => Number(tokenValue(t))));
  }
  return out;
}

const countOf = (o: CstObject | undefined): number => (o ? objects(o).length : 0);

function propsOf(n: CstObject): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of n.children) if (c.kind === "scalar") out[c.key] = textOf(c) ?? "";
  return out;
}

export interface LinkView {
  /** The input port of the node the link feeds (`IOPConnectionClass port`); undefined in a .siga. */
  port?: number;
  /** The `ConnectionsClass id`; undefined in a .siga. */
  conn?: number;
  /** Id of the node the link comes from. */
  from: number;
  fromPort?: number;
}

function collectLinks(o: CstObject, out: LinkView[], port?: number, conn?: number): void {
  for (const ch of objects(o)) {
    const cls = ch.head[0]?.text;
    if (cls === "IOPConnectionClass") collectLinks(ch, out, intOf(scalarOf(ch, "port")), conn);
    else if (cls === "ConnectionsClass") collectLinks(ch, out, port, intOf(scalarOf(ch, "id")));
    else if (cls === "ConnectionClass") {
      const from = intOf(scalarOf(ch, "id"));
      out.push({
        ...(port !== undefined ? { port } : {}),
        ...(conn !== undefined ? { conn } : {}),
        from: from ?? Number.NaN,
        fromPort: intOf(scalarOf(ch, "port")),
      });
    } else collectLinks(ch, out, port, conn);
  }
}

// ── Views ────────────────────────────────────────────────────────────────────

export type PapSection = "signals" | "funcs";
export type SigaSection = "Inputs" | "Ops" | "Outputs";
export type Section = PapSection | SigaSection | "groups";

export interface NodeView {
  section: Section;
  /** Position inside its section: the path index (`funcs[3]`). */
  index: number;
  cls: string;
  id?: number;
  name: string;
  /** `outs` ids (.pap). */
  outs: number[];
  /** Links that feed this node (.pap: its ports; .siga: its `inputs`). */
  links: LinkView[];
  /** `children` ids (.siga) or group members. */
  children: number[];
  /** `input` of a .siga output. */
  input?: number;
  /** `inputsport` / `outputsport` of a .pap signal: ids of the .siga's inputs and outputs. */
  inputsPort: number[];
  outputsPort: number[];
  /** Scalar properties as written, values joined by blanks. */
  props: Record<string, string>;
}

function nodeOf(n: CstObject, section: Section, index: number): NodeView {
  const links: LinkView[] = [];
  collectLinks(n, links);
  return {
    section,
    index,
    cls: n.head[0]?.text ?? n.key,
    id: intOf(scalarOf(n, "id")),
    name: textOf(scalarOf(n, "name")) ?? "",
    outs: numbersOf(blockOf(n, "outs")),
    links,
    children: numbersOf(blockOf(n, "children")),
    input: intOf(scalarOf(n, "input")),
    inputsPort: numbersOf(blockOf(n, "inputsport")),
    outputsPort: numbersOf(blockOf(n, "outputsport")),
    props: propsOf(n),
  };
}

export interface PapCompiled {
  version?: string;
  visited: number;
  ops: number;
  order: number;
  argsize?: string;
}

export interface SigaCompiled {
  version?: string;
  visited: number;
  ins: number;
  ops: number;
  outs: number;
}

export interface ProcAnimView {
  kind: ProcAnimKind;
  /** Every node of the file in file order (signals, funcs, groups | Inputs, Ops, Outputs). */
  nodes: NodeView[];
  model?: string;
  version?: string;
  papCompiled?: PapCompiled;
  sigaCompiled?: SigaCompiled;
}

const SECTIONS: Record<ProcAnimKind, Section[]> = {
  pap: ["signals", "funcs", "groups"],
  siga: ["Inputs", "Ops", "Outputs"],
};

export function viewProcAnim(p: Parsed): ProcAnimView {
  const root = rootOf(p.doc)!;
  const nodes: NodeView[] = [];
  for (const section of SECTIONS[p.kind]) {
    const b = blockOf(root, section);
    if (b) objects(b).forEach((n, i) => nodes.push(nodeOf(n, section, i)));
  }
  const view: ProcAnimView = {
    kind: p.kind,
    nodes,
    model: textOf(scalarOf(root, "model")),
    version: textOf(scalarOf(root, "version")),
  };
  const c = blockOf(root, "compiled");
  if (c && p.kind === "pap") {
    view.papCompiled = {
      version: textOf(scalarOf(c, "version")),
      visited: numbersOf(blockOf(c, "visited")).length,
      ops: countOf(blockOf(c, "ops")),
      order: numbersOf(blockOf(c, "order")).length,
      argsize: textOf(scalarOf(c, "argsize")),
    };
  } else if (c) {
    view.sigaCompiled = {
      version: textOf(scalarOf(c, "version")),
      visited: numbersOf(blockOf(c, "visited")).length,
      ins: countOf(blockOf(c, "ins")),
      ops: countOf(blockOf(c, "ops")),
      outs: countOf(blockOf(c, "outs")),
    };
  }
  return view;
}

/** `res` of a .pap signal node as written (`{GUID}path`), undefined when absent. */
export function signalResources(p: Parsed): { node: NodeView; res?: string }[] {
  const v = viewProcAnim(p);
  return v.nodes.filter((n) => n.section === "signals").map((n) => ({ node: n, res: n.props.res }));
}

export const labelOf = (n: NodeView): string =>
  `${n.section}[${n.index}] ${n.cls} id ${n.id ?? "?"}${n.name ? ` "${n.name}"` : ""}`;

// ── Validation ───────────────────────────────────────────────────────────────

export interface Finding {
  level: "error" | "warning";
  code: string;
  at?: string;
  message: string;
}

export interface ValidateOptions {
  /** Text or bytes of the `.siga` a signal `res` names (`{GUID}path`); undefined when not found. */
  resolveSiga?: (res: string) => string | Uint8Array | undefined;
}

const dupIds = (nodes: NodeView[], out: Finding[]): Set<number> => {
  const seen = new Set<number>();
  for (const n of nodes) {
    if (n.id === undefined) {
      out.push({ level: "error", code: "no-id", at: labelOf(n), message: "the node has no id" });
      continue;
    }
    if (seen.has(n.id))
      out.push({
        level: "error",
        code: "duplicate-id",
        at: labelOf(n),
        message: `id ${n.id} is used by another node`,
      });
    seen.add(n.id);
  }
  return seen;
};

function validatePap(p: Parsed, opts: ValidateOptions): Finding[] {
  const v = viewProcAnim(p);
  const out: Finding[] = [];
  const nodes = v.nodes.filter((n) => n.section !== "groups");
  const ids = dupIds(nodes, out);
  const byId = new Map(nodes.filter((n) => n.id !== undefined).map((n) => [n.id!, n]));
  for (const n of nodes) {
    for (const l of n.links) {
      if (!ids.has(l.from))
        out.push({
          level: "error",
          code: "dangling-link",
          at: labelOf(n),
          message: `port ${l.port ?? "?"} links to node ${Number.isNaN(l.from) ? "(no id)" : l.from}, which is not in the file`,
        });
      else {
        const src = byId.get(l.from)!;
        if (
          src.section === "signals" &&
          l.fromPort !== undefined &&
          !src.outputsPort.includes(l.fromPort)
        )
          out.push({
            level: "warning",
            code: "link-port-not-exported",
            at: labelOf(n),
            message: `links to output ${l.fromPort} of signal ${src.id}, which lists outputs ${src.outputsPort.join(" ") || "(none)"}`,
          });
      }
    }
    for (const o of n.outs)
      if (!ids.has(o))
        out.push({
          level: "error",
          code: "dangling-out",
          at: labelOf(n),
          message: `outs names node ${o}, which is not in the file`,
        });
  }
  for (const g of v.nodes.filter((n) => n.section === "groups"))
    for (const c of g.children)
      if (!ids.has(c))
        out.push({
          level: "warning",
          code: "group-member-missing",
          at: labelOf(g),
          message: `group member ${c} is not a node of the file`,
        });
  if (v.model === undefined)
    out.push({ level: "warning", code: "no-model", message: "the file names no model" });

  for (const s of nodes.filter((n) => n.section === "signals")) {
    const res = s.props.res;
    if (!res) {
      out.push({
        level: "warning",
        code: "no-res",
        at: labelOf(s),
        message: "the signal names no .siga (res)",
      });
      continue;
    }
    const nValues = s.inputsPort.length;
    for (const k of ["inputvalues", "inputvaluesmin", "inputvaluesmax"] as const) {
      const root = rootOf(p.doc)!;
      const sig = objects(blockOf(root, "signals")!)[s.index];
      const got = numbersOf(blockOf(sig, k)).length;
      if (blockOf(sig, k) && got !== nValues)
        out.push({
          level: "warning",
          code: "signal-value-count",
          at: labelOf(s),
          message: `${k} holds ${got} value(s) for ${nValues} input port(s)`,
        });
    }
    if (!opts.resolveSiga) continue;
    const raw = opts.resolveSiga(res);
    if (raw === undefined) {
      out.push({
        level: "warning",
        code: "siga-not-found",
        at: labelOf(s),
        message: `${res} was not found`,
      });
      continue;
    }
    let sv: ProcAnimView;
    try {
      sv = viewProcAnim(parseProcAnim(raw, "siga"));
    } catch (e) {
      out.push({
        level: "warning",
        code: "siga-unreadable",
        at: labelOf(s),
        message: `${res} could not be read: ${e instanceof Error ? e.message : String(e)}`,
      });
      continue;
    }
    const ins = new Set(sv.nodes.filter((n) => n.section === "Inputs").map((n) => n.id));
    const outs = new Set(sv.nodes.filter((n) => n.section === "Outputs").map((n) => n.id));
    for (const i of s.inputsPort)
      if (!ins.has(i))
        out.push({
          level: "error",
          code: "signal-input-missing",
          at: labelOf(s),
          message: `input port ${i} is not an input of ${res}`,
        });
    for (const o of s.outputsPort)
      if (!outs.has(o))
        out.push({
          level: "error",
          code: "signal-output-missing",
          at: labelOf(s),
          message: `output port ${o} is not an output of ${res}`,
        });
  }

  const funcs = nodes.filter((n) => n.section === "funcs").length;
  const c = v.papCompiled;
  if (funcs > 0 && !c)
    out.push({
      level: "warning",
      code: "compiled-missing",
      message:
        "the file has nodes but no compiled block: open and save in the ProcAnim Editor to compile it",
    });
  else if (c && c.ops !== funcs)
    out.push({
      level: "warning",
      code: "compiled-stale",
      message: `the compiled block holds ${c.ops} op(s) for ${funcs} node(s): open and save in the ProcAnim Editor to recompile`,
    });
  return out;
}

function validateSiga(p: Parsed): Finding[] {
  const v = viewProcAnim(p);
  const out: Finding[] = [];
  const ids = dupIds(v.nodes, out);
  for (const n of v.nodes) {
    for (const c of n.children)
      if (!ids.has(c))
        out.push({
          level: "error",
          code: "dangling-child",
          at: labelOf(n),
          message: `children names node ${c}, which is not in the file`,
        });
    for (const l of n.links)
      if (!ids.has(l.from))
        out.push({
          level: "error",
          code: "dangling-input",
          at: labelOf(n),
          message: `an input names node ${Number.isNaN(l.from) ? "(no id)" : l.from}, which is not in the file`,
        });
    if (n.section === "Outputs") {
      if (n.input === undefined)
        out.push({
          level: "warning",
          code: "output-unwired",
          at: labelOf(n),
          message: "the output has no input",
        });
      else if (!ids.has(n.input))
        out.push({
          level: "error",
          code: "dangling-input",
          at: labelOf(n),
          message: `input names node ${n.input}, which is not in the file`,
        });
    }
  }
  const count = (s: SigaSection) => v.nodes.filter((n) => n.section === s).length;
  const c = v.sigaCompiled;
  if (!c) {
    if (v.nodes.length > 0)
      out.push({
        level: "warning",
        code: "compiled-missing",
        message:
          "the file has nodes but no compiled block: open and save in the ProcAnim Editor to compile it",
      });
  } else {
    const pairs: [string, number, number][] = [
      ["ins", c.ins, count("Inputs")],
      ["ops", c.ops, count("Ops")],
      ["outs", c.outs, count("Outputs")],
    ];
    for (const [what, got, want] of pairs)
      if (got !== want)
        out.push({
          level: "warning",
          code: "compiled-stale",
          message: `the compiled block holds ${got} ${what} for ${want} node(s): open and save in the ProcAnim Editor to recompile`,
        });
  }
  return out;
}

/** Checks one file; never throws on a readable file. Errors are structure the editor would trip on. */
export function validateProcAnim(p: Parsed, opts: ValidateOptions = {}): Finding[] {
  return p.kind === "pap" ? validatePap(p, opts) : validateSiga(p);
}

// ── Edits ────────────────────────────────────────────────────────────────────

export type NodeRef = number | string;

export type ProcAnimOp =
  | { op: "set_property"; node: NodeRef; key: string; value: ScalarInput; quoted?: boolean }
  | { op: "remove_property"; node: NodeRef; key: string }
  | { op: "rename_node"; node: NodeRef; name: string }
  | { op: "move_node"; node: NodeRef; x: number | string; y: number | string }
  | { op: "set_model"; model: string }
  | {
      op: "add_node";
      class: string;
      name?: string;
      props?: Record<string, ScalarInput>;
      x?: number | string;
      y?: number | string;
    }
  | { op: "remove_node"; node: NodeRef }
  | { op: "connect"; from: NodeRef; to: NodeRef; port?: number }
  | { op: "disconnect"; from: NodeRef; to: NodeRef; port?: number };

export const OP_NAMES = [
  "set_property",
  "remove_property",
  "rename_node",
  "move_node",
  "set_model",
  "add_node",
  "remove_node",
  "connect",
  "disconnect",
] as const;

const KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Keys an op never sets or removes as a plain property: ids and the wiring blocks have their own ops. */
const STRUCTURAL = new Set([
  "id",
  "children",
  "inputs",
  "input",
  "outs",
  "iops",
  "funcs",
  "compiled",
  "inputsport",
  "outputsport",
  "inputvalues",
  "inputvaluesmin",
  "inputvaluesmax",
  "links",
  "conn",
]);

/** Keys whose change leaves the compiled blocks as they are. */
const NOT_COMPILED = new Set(["name", "comment", "tl", "ctl", "Color"]);

function str(raw: Record<string, unknown>, key: string, i: number): string {
  const v = raw[key];
  if (typeof v !== "string" || v === "")
    return bad(`op ${i + 1}: "${key}" must be a non-empty string`);
  return v;
}

function ref(raw: Record<string, unknown>, key: string, i: number): NodeRef {
  const v = raw[key];
  if (typeof v === "number" && Number.isInteger(v)) return v;
  if (typeof v === "string" && v !== "") return v;
  return bad(`op ${i + 1}: "${key}" must be a node id or name`);
}

function coord(raw: Record<string, unknown>, key: string, i: number): number | string {
  const v = raw[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v)) return v;
  return bad(`op ${i + 1}: "${key}" must be a number`);
}

function scalarInput(v: unknown, what: string): ScalarInput {
  const one = (x: unknown) =>
    typeof x === "string" ||
    typeof x === "boolean" ||
    (typeof x === "number" && Number.isFinite(x));
  if (one(v)) return v as ScalarInput;
  if (Array.isArray(v) && v.length > 0 && v.every(one)) return v as ScalarInput;
  return bad(`${what} must be a string, a finite number, a boolean or a list of those`);
}

/** Reads one op of an `ops` list; throws INVALID_ARGUMENT naming the op. */
export function opOf(raw: Record<string, unknown>, i: number): ProcAnimOp {
  const name = raw.op;
  switch (name) {
    case "set_property":
      return {
        op: name,
        node: ref(raw, "node", i),
        key: str(raw, "key", i),
        value: scalarInput(raw.value, `op ${i + 1}: value`),
        quoted: typeof raw.quoted === "boolean" ? raw.quoted : undefined,
      };
    case "remove_property":
      return { op: name, node: ref(raw, "node", i), key: str(raw, "key", i) };
    case "rename_node":
      return { op: name, node: ref(raw, "node", i), name: str(raw, "name", i) };
    case "move_node":
      return { op: name, node: ref(raw, "node", i), x: coord(raw, "x", i), y: coord(raw, "y", i) };
    case "set_model":
      return { op: name, model: str(raw, "model", i) };
    case "add_node": {
      const props = raw.props;
      if (
        props !== undefined &&
        (typeof props !== "object" || props === null || Array.isArray(props))
      )
        return bad(`op ${i + 1}: props must be an object`);
      return {
        op: name,
        class: str(raw, "class", i),
        name: raw.name === undefined ? undefined : str(raw, "name", i),
        props: props
          ? Object.fromEntries(
              Object.entries(props as Record<string, unknown>).map(([k, v]) => [
                k,
                scalarInput(v, `op ${i + 1}: props.${k}`),
              ]),
            )
          : undefined,
        x: raw.x === undefined ? undefined : coord(raw, "x", i),
        y: raw.y === undefined ? undefined : coord(raw, "y", i),
      };
    }
    case "remove_node":
      return { op: name, node: ref(raw, "node", i) };
    case "connect":
    case "disconnect": {
      const port = raw.port;
      if (port !== undefined && !(typeof port === "number" && Number.isInteger(port) && port >= 0))
        return bad(`op ${i + 1}: port must be a non-negative integer`);
      return {
        op: name,
        from: ref(raw, "from", i),
        to: ref(raw, "to", i),
        port: port as number | undefined,
      };
    }
    default:
      return bad(`op ${i + 1}: unknown op ${JSON.stringify(name)}; one of ${OP_NAMES.join(", ")}`);
  }
}

export interface OpResult {
  summary: string;
  changes: Change[];
  /** True when the compiled blocks no longer match what the nodes compute. */
  affectsCompiled: boolean;
  /** Id of a node `add_node` made. */
  id?: number;
}

const pathOfNode = (n: NodeView): string => `${n.section}[${n.index}]`;

function findNode(p: Parsed, r: NodeRef, role?: string): NodeView {
  const nodes = viewProcAnim(p).nodes;
  const hits =
    typeof r === "number"
      ? nodes.filter((n) => n.id === r)
      : /^\d+$/.test(r) && nodes.some((n) => n.id === Number(r))
        ? nodes.filter((n) => n.id === Number(r))
        : nodes.filter((n) => n.name === r);
  if (hits.length === 0)
    return missing(
      `no node ${typeof r === "number" ? `with id ${r}` : `named "${r}"`}${role ? ` (${role})` : ""}; ids: ${nodes
        .slice(0, 12)
        .map((n) => n.id)
        .join(", ")}${nodes.length > 12 ? ", ..." : ""}`,
    );
  if (hits.length > 1)
    return bad(
      `${hits.length} nodes match ${JSON.stringify(r)} (ids ${hits.map((n) => n.id).join(", ")}); use an id`,
    );
  if (hits[0].id === undefined) return bad(`the node ${labelOf(hits[0])} has no id`);
  return hits[0];
}

function classInfo(name: string): ProcAnimClassInfo | undefined {
  return PROCANIM_CLASSES.find((c) => c.name === name);
}

/** Whether a new key of `cls` is written quoted: as the vanilla files write it. */
function quotedFor(cls: string, key: string, value: ScalarInput): boolean | undefined {
  const sample = classInfo(cls)?.keys.find((k) => k[0] === key)?.[2];
  if (sample !== undefined && sample !== "block") return sample.startsWith('"');
  if (typeof value === "string") return !/^-?\d+(\.\d+)?$/.test(value);
  return undefined;
}

const rawOf = (doc: CstDocument, path: string): string | undefined => {
  try {
    const g = doc.get(path);
    return g.kind === "scalar" || g.kind === "value" ? g.values.join(" ") : undefined;
  } catch {
    return undefined;
  }
};

function setProp(
  p: Parsed,
  n: NodeView,
  key: string,
  value: ScalarInput,
  quoted?: boolean,
): Change {
  const path = `${pathOfNode(n)}.${key}`;
  const before = rawOf(p.doc, path);
  let q = quoted;
  if (before === undefined) q = quoted ?? quotedFor(n.cls, key, value);
  p.doc.set(path, value, q === undefined ? {} : { quoted: q });
  return { path, before: before ?? null, after: rawOf(p.doc, path) ?? null };
}

function guardKey(key: string, what: string): void {
  if (!KEY.test(key)) bad(`"${key}" is not a key`);
  if (STRUCTURAL.has(key))
    bad(
      `${what} does not change "${key}": ids and wiring have their own ops (add_node, remove_node, connect, disconnect)`,
    );
}

function nextId(p: Parsed): number {
  let max = 0;
  for (const n of viewProcAnim(p).nodes) if (n.id !== undefined && n.id > max) max = n.id;
  return max + 1;
}

function referrers(p: Parsed, id: number): string[] {
  const out: string[] = [];
  for (const n of viewProcAnim(p).nodes) {
    if (n.id === id) continue;
    if (n.links.some((l) => l.from === id)) out.push(`${labelOf(n)} (link)`);
    if (n.outs.includes(id)) out.push(`${labelOf(n)} (outs)`);
    if (n.children.includes(id)) out.push(`${labelOf(n)} (children)`);
    if (n.input === id) out.push(`${labelOf(n)} (input)`);
  }
  return out;
}

function ensureBlock(p: Parsed, nodePath: string, key: string): string {
  const path = `${nodePath}.${key}`;
  try {
    p.doc.resolve(path);
  } catch (e) {
    if (!(e instanceof CstEditError) || e.code !== "PATH_NOT_FOUND") throw e;
    p.doc.createObject(nodePath, { key });
  }
  return path;
}

/** Rewrites the id lists of a `children` block with `ids` removed or added; drops the block when it empties. */
function removeFromChildren(p: Parsed, n: NodeView, id: number): void {
  const path = `${pathOfNode(n)}.children`;
  const blk = blockOf(objects(blockOf(rootOf(p.doc)!, n.section)!)[n.index], "children");
  if (!blk) return;
  for (let k = 0; k < blk.children.length; k++) {
    const e = blk.children[k];
    if (e.kind !== "value" && e.kind !== "scalar") continue;
    const nums =
      e.kind === "value"
        ? e.values.map((t) => Number(tokenValue(t)))
        : [Number(e.key), ...e.values.map((t) => Number(tokenValue(t)))];
    if (!nums.includes(id)) continue;
    const rest = nums.filter((x) => x !== id);
    if (rest.length === 0) p.doc.arrayRemove(path, k);
    else p.doc.set(`${path}[${k}]`, rest, { quoted: false });
    break;
  }
  const again = blockOf(objects(blockOf(rootOf(p.doc)!, n.section)!)[n.index], "children");
  if (again && again.children.length === 0) p.doc.delete(path);
}

function addToChildren(p: Parsed, n: NodeView, id: number): void {
  const path = ensureBlock(p, pathOfNode(n), "children");
  const blk = blockOf(objects(blockOf(rootOf(p.doc)!, n.section)!)[n.index], "children")!;
  const last = blk.children[blk.children.length - 1];
  if (last && (last.kind === "value" || last.kind === "scalar")) {
    const nums =
      last.kind === "value"
        ? last.values.map((t) => Number(tokenValue(t)))
        : [Number(last.key), ...last.values.map((t) => Number(tokenValue(t)))];
    p.doc.set(`${path}[${blk.children.length - 1}]`, [...nums, id], { quoted: false });
  } else p.doc.arrayAdd(path, { value: id });
}

/** Applies one op to the document in place. Throws ProcAnimError (or CstEditError) and leaves the text as it was when the op fails before its first splice. */
export function applyOp(p: Parsed, op: ProcAnimOp): OpResult {
  switch (op.op) {
    case "set_property": {
      guardKey(op.key, "set_property");
      const n = findNode(p, op.node);
      const c = setProp(p, n, op.key, op.value, op.quoted);
      return {
        summary: `set ${labelOf(n)} ${op.key}: ${c.before ?? "(none)"} -> ${c.after}`,
        changes: [c],
        affectsCompiled: !NOT_COMPILED.has(op.key),
      };
    }
    case "remove_property": {
      guardKey(op.key, "remove_property");
      if (op.key === "name") bad("a node keeps its name; rename_node changes it");
      const n = findNode(p, op.node);
      const path = `${pathOfNode(n)}.${op.key}`;
      const before = rawOf(p.doc, path);
      if (before === undefined)
        return missing(
          `${labelOf(n)} has no "${op.key}" property; keys: ${Object.keys(n.props).join(", ")}`,
        );
      p.doc.delete(path);
      return {
        summary: `removed ${labelOf(n)} ${op.key} (was ${before})`,
        changes: [{ path, before, after: null }],
        affectsCompiled: !NOT_COMPILED.has(op.key),
      };
    }
    case "rename_node": {
      const n = findNode(p, op.node);
      const c = setProp(p, n, "name", op.name, true);
      return {
        summary: `renamed ${labelOf(n)} to "${op.name}"`,
        changes: [c],
        affectsCompiled: false,
      };
    }
    case "move_node": {
      const n = findNode(p, op.node);
      const path = `${pathOfNode(n)}.tl`;
      const before = rawOf(p.doc, path);
      p.doc.set(path, [String(op.x), String(op.y)], { quoted: false });
      return {
        summary: `moved ${labelOf(n)} to ${op.x} ${op.y}`,
        changes: [{ path, before: before ?? null, after: rawOf(p.doc, path) ?? null }],
        affectsCompiled: false,
      };
    }
    case "set_model": {
      if (p.kind !== "pap") bad("set_model applies to a .pap");
      const before = rawOf(p.doc, "model");
      p.doc.set("model", op.model, before === undefined ? { quoted: true } : {});
      return {
        summary: `set model ${before ?? "(none)"} -> ${op.model}`,
        changes: [{ path: "model", before: before ?? null, after: rawOf(p.doc, "model") ?? null }],
        affectsCompiled: false,
      };
    }
    case "add_node": {
      const info = classInfo(op.class);
      if (!info)
        return bad(
          `${op.class} is not a ProcAnim node class of the vanilla files; the nodes action lists them`,
        );
      if (info.file !== p.kind)
        bad(`${op.class} is a .${info.file} node, and the file is a .${p.kind}`);
      const id = nextId(p);
      const entries: EntrySpec[] = [
        { key: "id", value: id },
        {
          key: "name",
          value: op.name ?? `${op.class.replace(/Class$/, "").replace(/^IOPItem(Op)?/, "")} ${id}`,
          quoted: true,
        },
        { key: "tl", value: [String(op.x ?? 0), String(op.y ?? 0)], quoted: false },
      ];
      for (const [k, v] of Object.entries(op.props ?? {})) {
        if (k === "name" || k === "tl" || k === "id") bad(`props.${k}: use the op's own field`);
        guardKey(k, "add_node props");
        entries.push({ key: k, value: v, quoted: quotedFor(op.class, k, v) });
      }
      const spec: ObjectSpec = { key: op.class, entries };
      try {
        p.doc.resolve(info.section);
      } catch (e) {
        if (!(e instanceof CstEditError) || e.code !== "PATH_NOT_FOUND") throw e;
        p.doc.createObject("", { key: info.section });
      }
      p.doc.createObject(info.section, spec);
      return {
        summary: `added ${op.class} id ${id} to ${info.section}`,
        changes: [{ path: info.section, before: null, after: { class: op.class, id } }],
        affectsCompiled: true,
        id,
      };
    }
    case "remove_node": {
      const n = findNode(p, op.node);
      const refs = referrers(p, n.id!);
      if (refs.length > 0)
        bad(
          `${labelOf(n)} is still referenced by ${refs.slice(0, 6).join("; ")}${refs.length > 6 ? "; ..." : ""}: remove those links first`,
        );
      p.doc.arrayRemove(n.section, n.index);
      return {
        summary: `removed ${labelOf(n)}`,
        changes: [{ path: pathOfNode(n), before: { class: n.cls, id: n.id }, after: null }],
        affectsCompiled: true,
      };
    }
    case "connect":
    case "disconnect": {
      if (p.kind !== "siga")
        bad(`${op.op} wires a .siga; a .pap's connections are made in the ProcAnim Editor`);
      const from = findNode(p, op.from, "source");
      const to = findNode(p, op.to, "target");
      if (from.section === "Outputs")
        bad("an output feeds nothing: pick an input or an op as the source");
      if (to.section === "Inputs")
        bad("an input takes no feed: pick an op or an output as the target");
      const port = op.port ?? 0;
      if (op.op === "connect") {
        if (from.children.includes(to.id!)) bad(`${labelOf(from)} already feeds ${labelOf(to)}`);
        if (to.section === "Outputs") {
          if (to.input !== undefined)
            bad(`${labelOf(to)} is already fed by node ${to.input}: disconnect it first`);
          p.doc.set(`${pathOfNode(to)}.input`, from.id!);
        } else {
          const path = ensureBlock(p, pathOfNode(to), "inputs");
          p.doc.arrayAdd(path, {
            object: {
              key: "ConnectionClass",
              name: "connection",
              entries: [
                { key: "id", value: from.id! },
                { key: "port", value: port },
              ],
            },
          });
        }
        addToChildren(p, from, to.id!);
        return {
          summary: `connected ${labelOf(from)} -> ${labelOf(to)} port ${port}`,
          changes: [
            { path: `${pathOfNode(to)}.inputs`, before: null, after: { from: from.id, port } },
          ],
          affectsCompiled: true,
        };
      }
      if (!from.children.includes(to.id!)) bad(`${labelOf(from)} does not feed ${labelOf(to)}`);
      if (to.section === "Outputs") {
        if (to.input !== from.id)
          bad(`${labelOf(to)} is fed by node ${to.input ?? "(none)"}, not ${from.id}`);
        p.doc.delete(`${pathOfNode(to)}.input`);
      } else {
        const inputs = blockOf(objects(blockOf(rootOf(p.doc)!, to.section)!)[to.index], "inputs");
        const k = inputs
          ? objects(inputs).findIndex(
              (c) =>
                intOf(scalarOf(c, "id")) === from.id &&
                (op.port === undefined || (intOf(scalarOf(c, "port")) ?? 0) === port),
            )
          : -1;
        if (k < 0)
          bad(
            `${labelOf(to)} has no input from node ${from.id}${op.port === undefined ? "" : ` on port ${port}`}`,
          );
        const ipath = `${pathOfNode(to)}.inputs`;
        // arrayRemove indexes entries, and the block holds only connections.
        p.doc.arrayRemove(ipath, inputs!.children.indexOf(objects(inputs!)[k]));
        const left = blockOf(objects(blockOf(rootOf(p.doc)!, to.section)!)[to.index], "inputs");
        if (left && left.children.length === 0) p.doc.delete(ipath);
      }
      removeFromChildren(p, from, to.id!);
      return {
        summary: `disconnected ${labelOf(from)} -> ${labelOf(to)}`,
        changes: [
          { path: `${pathOfNode(to)}.inputs`, before: { from: from.id, port }, after: null },
        ],
        affectsCompiled: true,
      };
    }
  }
}

// ── New files ────────────────────────────────────────────────────────────────

/** An empty file of a kind, in the engine's style (LF, one space of indent, no final line ending). */
export function skeleton(kind: ProcAnimKind, model?: string): string {
  if (kind === "pap") {
    if (model !== undefined && /["\r\n]/.test(model))
      bad("model cannot hold a quote or line break");
    return [
      "ProcAnimProjectClass {",
      " signals {",
      " }",
      " funcs {",
      " }",
      ...(model ? [` model "${model}"`] : []),
      " version 1",
      "}",
    ].join("\n");
  }
  return [
    "ProcAnimSignalResClass {",
    " Inputs {",
    " }",
    " Ops {",
    " }",
    " Outputs {",
    " }",
    "}",
  ].join("\n");
}
