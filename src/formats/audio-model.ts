/**
 * Node and link model of the Audio Editor files over the lossless CST
 * (W5 spec 2.4 and 4.1, DEC-068; package W5-TA-3A).
 *
 * Four formats, all Enfusion text, all read through `enfusion-cst`:
 *   .acp  `AudioClass`            sections of nodes (`sounds`, `banks_local`, `mixers` ...)
 *   .sig  `AudioSignalResClass`   `Inputs`, `Ops`, `Outputs`, a `compiled` block
 *   .afm  `AudioOutputStateResClass`  `Mixers` (buses) and `bus_out`
 *   .conf `AudioVariablesClass`   `Variables { AudioVariableClass Name { source ... } }`
 *
 * This module only reads. The tool (src/tools/audio.ts) edits through
 * `CstDocument`, so every edit splices text and the bytes outside the edit
 * never change. `AudioModel.root` is a getter because an edit reparses the
 * document and the old tree objects go stale.
 *
 * Graph facts (corpus, 1.9.0.37): a node is an object in a section; its id is
 * the `id` scalar (the header name repeats it in the named style). A link is a
 * `ConnectionClass` with `id` (the source node) and `port` (the source port)
 * under `ins > ConnectionsClass` whose own `id` is the destination port. The
 * low 10 bits of a node id are a fixed code per class (`ACP_CLASS_CODES`).
 */

import {
  parseCstBytes,
  tokenValue,
  type CstDocument,
  type CstEntry,
  type CstObject,
  type CstScalar,
} from "./enfusion-cst.js";

// ── Kinds ────────────────────────────────────────────────────────────────────

export type AudioKind = "acp" | "sig" | "afm" | "vars";

export const ROOT_CLASS: Record<AudioKind, string> = {
  acp: "AudioClass",
  sig: "AudioSignalResClass",
  afm: "AudioOutputStateResClass",
  vars: "AudioVariablesClass",
};

/** The kind a file name implies; `.conf` is only a candidate (its root class decides). */
export function kindOfPath(path: string): AudioKind | undefined {
  const p = path.toLowerCase();
  if (p.endsWith(".acp")) return "acp";
  if (p.endsWith(".sig")) return "sig";
  if (p.endsWith(".afm")) return "afm";
  if (p.endsWith(".conf")) return "vars";
  return undefined;
}

/**
 * `id & 1023` per node class, constant across the 720 vanilla .acp files
 * (spec 4.1). A new id is `((max id >> 10) + 1) << 10 | code`.
 */
export const ACP_CLASS_CODES: Readonly<Record<string, number>> = {
  GroupClass: 3,
  BankLocalClass: 4,
  GeneratorClass: 5,
  SelectorClass: 6,
  BusClass: 7,
  SoundClass: 9,
  MixerClass: 11,
  ConstantClass: 12,
  SignalClass: 13,
  StreamClass: 17,
  ShaderClass: 18,
  AmplitudeClass: 19,
  FrequencyClass: 21,
  FilterClass: 22,
  FilterChainClass: 23,
  PlaylistClass: 24,
  ReplacerClass: 25,
  SpatialityClass: 28,
  AuxOutClass: 29,
  VariableClass: 30,
  SwitchClass: 33,
  AuxSelectorClass: 34,
};

// ── Small readers ────────────────────────────────────────────────────────────

export function scalarOf(o: CstObject, key: string): CstScalar | undefined {
  return o.children.find((c): c is CstScalar => c.kind === "scalar" && c.key === key);
}

export function blockOf(o: CstObject, key: string): CstObject | undefined {
  return o.children.find((c): c is CstObject => c.kind === "object" && c.key === key);
}

/** The scalar's values joined by one blank, quotes removed. */
export function strOf(o: CstObject, key: string): string | undefined {
  const s = scalarOf(o, key);
  return s ? s.values.map(tokenValue).join(" ") : undefined;
}

export function numOf(o: CstObject, key: string): number | undefined {
  const s = scalarOf(o, key);
  if (!s || s.values.length < 1) return undefined;
  const n = Number(tokenValue(s.values[0]));
  return Number.isFinite(n) ? n : undefined;
}

/** Numbers of every keyless value line in a block (`inputvalues { 0 1000 }`). */
export function numberLine(o: CstObject | undefined): number[] {
  if (!o) return [];
  const out: number[] = [];
  for (const c of o.children) {
    if (c.kind === "value") for (const t of c.values) out.push(Number(tokenValue(t)));
    else if (c.kind === "scalar") {
      out.push(Number(c.key));
      for (const t of c.values) out.push(Number(tokenValue(t)));
    }
  }
  return out;
}

/** Direct scalar children as `key -> joined values`. */
export function scalarMap(o: CstObject): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of o.children) {
    if (c.kind === "scalar") out[c.key] = c.values.map(tokenValue).join(" ");
  }
  return out;
}

const pairOf = (o: CstObject, key: string): [number, number] | undefined => {
  const s = scalarOf(o, key);
  if (!s || s.values.length !== 2) return undefined;
  const p: [number, number] = [Number(tokenValue(s.values[0])), Number(tokenValue(s.values[1]))];
  return Number.isFinite(p[0]) && Number.isFinite(p[1]) ? p : undefined;
};

// ── Model ────────────────────────────────────────────────────────────────────

export class AudioModelError extends Error {
  constructor(
    readonly code: "INVALID_ARGUMENT",
    message: string,
  ) {
    super(message);
    this.name = "AudioModelError";
  }
}

/** A parsed Audio Editor file. Graph edits (src/formats/audio-graph.ts) work on `doc`. */
export class AudioModel {
  constructor(
    readonly kind: AudioKind,
    public doc: CstDocument,
  ) {}

  /** The one root-class object of the document; fresh after every edit. */
  get root(): CstObject {
    const r = rootObject(this.doc, this.kind);
    if (!r) throw new AudioModelError("INVALID_ARGUMENT", `not ${ROOT_CLASS[this.kind]}`);
    return r;
  }
}

function rootObject(doc: CstDocument, kind: AudioKind): CstObject | undefined {
  const kids = doc.root.children;
  if (kids.length !== 1) return undefined;
  const k = kids[0];
  return k.kind === "object" && k.key === ROOT_CLASS[kind] ? k : undefined;
}

/** The kind of a parsed document by its root class, or undefined. */
export function detectKind(doc: CstDocument): AudioKind | undefined {
  for (const k of Object.keys(ROOT_CLASS) as AudioKind[]) if (rootObject(doc, k)) return k;
  return undefined;
}

/**
 * Parses file bytes (never throws on content) and checks the root class.
 * `expect` is the kind the file name implied; a mismatch is refused.
 */
export function loadAudioModel(buf: Uint8Array, expect?: AudioKind): AudioModel {
  const doc = parseCstBytes(buf);
  const kind = detectKind(doc);
  if (!kind) {
    const first = doc.root.children.find((c) => c.kind === "object") as CstObject | undefined;
    throw new AudioModelError(
      "INVALID_ARGUMENT",
      `not an Audio Editor file: the root is ${first ? first.key : "empty"}${
        expect ? `, expected ${ROOT_CLASS[expect]}` : ""
      }`,
    );
  }
  if (expect && kind !== expect) {
    throw new AudioModelError(
      "INVALID_ARGUMENT",
      `the root class is ${ROOT_CLASS[kind]}, expected ${ROOT_CLASS[expect]}`,
    );
  }
  return new AudioModel(kind, doc);
}

// ── Nodes ────────────────────────────────────────────────────────────────────

export interface AudioNode {
  /** Section block key (`sounds`, `Inputs`, `Mixers`, `Variables`). */
  section: string;
  /** Child index inside the section block: the path index. */
  position: number;
  cls: string;
  /** The `id` scalar (absent in a variables conf). */
  id?: number;
  /** The `name` scalar; in a variables conf the header name. */
  name?: string;
  pos?: [number, number];
  version?: number;
  obj: CstObject;
  /** Path from the root object: `sounds[3]`. */
  path: string;
}

const SECTION_KEYS: Record<Exclude<AudioKind, "acp">, string[]> = {
  sig: ["Inputs", "Ops", "Outputs", "groups"],
  afm: ["Mixers", "bus_out"],
  vars: ["Variables"],
};

/** Section blocks of the document: objects whose children are all objects. */
export function sectionsOf(model: AudioModel): CstObject[] {
  const root = model.root;
  const objs = root.children.filter((c): c is CstObject => c.kind === "object");
  if (model.kind === "acp") {
    return objs.filter((o) => o.children.every((c) => c.kind === "object"));
  }
  const keys = SECTION_KEYS[model.kind];
  return objs.filter((o) => keys.includes(o.key));
}

export function audioNodes(model: AudioModel): AudioNode[] {
  const out: AudioNode[] = [];
  for (const sec of sectionsOf(model)) {
    sec.children.forEach((c, position) => {
      if (c.kind !== "object") return;
      let id = numOf(c, "id");
      if (id === undefined && model.kind === "acp" && c.head[1]) {
        const n = Number(tokenValue(c.head[1]));
        if (Number.isFinite(n)) id = n;
      }
      const name =
        model.kind === "vars" ? (c.head[1] ? tokenValue(c.head[1]) : undefined) : strOf(c, "name");
      out.push({
        section: sec.key,
        position,
        cls: c.key,
        id,
        name,
        pos: pairOf(c, "tl"),
        version: numOf(c, "version"),
        obj: c,
        path: `${sec.key}[${position}]`,
      });
    });
  }
  return out;
}

// ── Links ────────────────────────────────────────────────────────────────────

export interface AudioLink {
  /** Source node id and its output port. */
  from: number;
  fromPort: number;
  /** Destination node id and its input port. */
  to: number;
  toPort: number;
  via: "ins" | "conns" | "inputs" | "input";
}

function connectionLinks(
  cons: CstObject,
  to: number,
  via: AudioLink["via"],
  toPortOverride: number | undefined,
  out: AudioLink[],
): void {
  for (const c of cons.children) {
    if (c.kind !== "object" || c.key !== "ConnectionsClass") continue;
    const toPort = toPortOverride ?? numOf(c, "id") ?? 0;
    const links = blockOf(c, "links");
    for (const l of links?.children ?? []) {
      if (l.kind !== "object" || l.key !== "ConnectionClass") continue;
      const from = numOf(l, "id");
      if (from === undefined) continue;
      out.push({ from, fromPort: numOf(l, "port") ?? 0, to, toPort, via });
    }
  }
}

export function audioLinks(model: AudioModel, nodes: AudioNode[] = audioNodes(model)): AudioLink[] {
  const out: AudioLink[] = [];
  for (const n of nodes) {
    if (n.id === undefined) continue;
    const ins = blockOf(n.obj, "ins");
    if (ins) connectionLinks(ins, n.id, "ins", undefined, out);
    const conns = blockOf(n.obj, "conns");
    for (const iop of conns?.children ?? []) {
      if (iop.kind !== "object") continue;
      const conn = blockOf(iop, "conn");
      if (conn) connectionLinks(conn, n.id, "conns", numOf(iop, "port") ?? 0, out);
    }
    // .sig: `inputs { ConnectionClass connection { id N  port P } }` and `input N` of an output.
    const inputs = blockOf(n.obj, "inputs");
    let k = 0;
    for (const c of inputs?.children ?? []) {
      if (c.kind === "object" && c.key === "ConnectionClass") {
        const from = numOf(c, "id");
        if (from !== undefined)
          out.push({ from, fromPort: numOf(c, "port") ?? 0, to: n.id, toPort: k, via: "inputs" });
        k++;
      }
    }
    if (model.kind === "sig" && n.section === "Outputs") {
      const inp = numOf(n.obj, "input");
      if (inp !== undefined)
        out.push({ from: inp, fromPort: 0, to: n.id, toPort: 0, via: "input" });
    }
  }
  return out;
}

/** Ids reachable by following links backwards (towards the sources) from `id`. */
export function upstreamIds(links: AudioLink[], id: number, depth = 64): number[] {
  const seen = new Set<number>([id]);
  let frontier = [id];
  for (let d = 0; d < depth && frontier.length; d++) {
    const next: number[] = [];
    for (const f of frontier) {
      for (const l of links) {
        if (l.to === f && !seen.has(l.from)) {
          seen.add(l.from);
          next.push(l.from);
        }
      }
    }
    frontier = next;
  }
  seen.delete(id);
  return [...seen];
}

/** Ids reachable by following links forwards from `id`. */
export function downstreamIds(links: AudioLink[], id: number, depth = 64): number[] {
  const seen = new Set<number>([id]);
  let frontier = [id];
  for (let d = 0; d < depth && frontier.length; d++) {
    const next: number[] = [];
    for (const f of frontier) {
      for (const l of links) {
        if (l.from === f && !seen.has(l.to)) {
          seen.add(l.to);
          next.push(l.to);
        }
      }
    }
    frontier = next;
  }
  seen.delete(id);
  return [...seen];
}

// ── Events ───────────────────────────────────────────────────────────────────

export interface AudioEvent {
  node: AudioNode;
  id: number;
  name: string;
  eventType?: string;
  priority?: number;
  volumeDb?: number;
  comment?: string;
  parent?: number;
  outState?: number;
}

/** Events of an .acp: a `SoundClass` with a name (the name is what scripts call). */
export function eventsOf(model: AudioModel, nodes: AudioNode[] = audioNodes(model)): AudioEvent[] {
  if (model.kind !== "acp") return [];
  const out: AudioEvent[] = [];
  for (const n of nodes) {
    if (n.section !== "sounds" || n.cls !== "SoundClass" || n.id === undefined || !n.name) continue;
    out.push({
      node: n,
      id: n.id,
      name: n.name,
      eventType: strOf(n.obj, "eventType"),
      priority: numOf(n.obj, "priority"),
      volumeDb: numOf(n.obj, "volume_dB"),
      comment: strOf(n.obj, "comment"),
      parent: numOf(n.obj, "parent"),
      outState: numOf(n.obj, "outState"),
    });
  }
  return out;
}

// ── Samples ──────────────────────────────────────────────────────────────────

export interface AudioSample {
  bank: AudioNode;
  /** Child index inside the bank's `Samples` block. */
  position: number;
  name: string;
  filename?: string;
  guid?: string;
  path?: string;
  index?: number;
  probability?: number;
  obj: CstObject;
}

const RES = /^\{([0-9A-Fa-f]{16})\}(.*)$/;

export function splitResource(raw: string): { guid?: string; path: string } {
  const m = RES.exec(raw);
  return m ? { guid: m[1].toUpperCase(), path: m[2] } : { path: raw };
}

export function samplesOf(
  model: AudioModel,
  nodes: AudioNode[] = audioNodes(model),
): AudioSample[] {
  const out: AudioSample[] = [];
  if (model.kind !== "acp") return out;
  for (const n of nodes) {
    if (n.cls !== "BankLocalClass") continue;
    const sb = blockOf(n.obj, "Samples");
    sb?.children.forEach((c, position) => {
      if (c.kind !== "object" || c.key !== "AudioBankSampleClass") return;
      const filename = strOf(c, "Filename");
      const r = filename === undefined ? undefined : splitResource(filename);
      out.push({
        bank: n,
        position,
        name: c.head[1] ? tokenValue(c.head[1]) : "",
        filename,
        guid: r?.guid,
        path: r?.path,
        index: numOf(c, "Index"),
        probability: numOf(c, "Probability"),
        obj: c,
      });
    });
  }
  return out;
}

// ── References ───────────────────────────────────────────────────────────────

export type RefKind = "mixer" | "signal" | "variables" | "sample" | "other";

export interface AudioRef {
  kind: RefKind;
  guid: string;
  path: string;
  /** The scalar key that holds it (`res`, `Filename`, `varResource`). */
  key: string;
  node?: number;
  nodeName?: string;
  section?: string;
}

export function refKindOfPath(path: string): RefKind {
  const p = path.toLowerCase();
  if (p.endsWith(".afm")) return "mixer";
  if (p.endsWith(".sig")) return "signal";
  if (p.endsWith(".conf")) return "variables";
  if (p.endsWith(".snd") || p.endsWith(".wav")) return "sample";
  return "other";
}

/** Every `{GUID}path` string of the document, with the node and key that hold it. */
export function refsOf(model: AudioModel, nodes: AudioNode[] = audioNodes(model)): AudioRef[] {
  const out: AudioRef[] = [];
  const visit = (entries: CstEntry[], n: AudioNode | undefined, key: string): void => {
    for (const e of entries) {
      if (e.kind === "object") visit(e.children, n, e.key);
      else if (e.kind === "scalar" || e.kind === "value") {
        const k = e.kind === "scalar" ? e.key : key;
        for (const t of e.values) {
          if (t.kind !== "string") continue;
          const m = RES.exec(tokenValue(t));
          if (!m || m[2] === "") continue;
          out.push({
            kind: refKindOfPath(m[2]),
            guid: m[1].toUpperCase(),
            path: m[2],
            key: k,
            node: n?.id,
            nodeName: n?.name,
            section: n?.section,
          });
        }
      }
    }
  };
  for (const n of nodes) visit(n.obj.children, n, "");
  return out;
}

// ── Variables ────────────────────────────────────────────────────────────────

export interface AudioVariable {
  name: string;
  /** Variable resource (`{GUID}path.conf`), when the row names one. */
  resource?: string;
  local?: boolean;
  source?: string;
  op?: string;
  value?: string;
  min?: string;
  max?: string;
  node?: number;
  nodeName?: string;
  section?: string;
  cls?: string;
}

export function variablesOf(
  model: AudioModel,
  nodes: AudioNode[] = audioNodes(model),
): AudioVariable[] {
  const out: AudioVariable[] = [];
  for (const n of nodes) {
    if (model.kind === "vars") {
      if (n.cls !== "AudioVariableClass" || !n.name) continue;
      out.push({
        name: n.name,
        source: strOf(n.obj, "source"),
        op: strOf(n.obj, "op"),
        value: strOf(n.obj, "value"),
        min: strOf(n.obj, "value_min"),
        max: strOf(n.obj, "value_max"),
        cls: n.cls,
        section: n.section,
      });
      continue;
    }
    for (const [nk, rk, local] of [
      ["varName", "varResource", false],
      ["varLocName", "varLocalResource", true],
    ] as const) {
      const name = strOf(n.obj, nk);
      if (name === undefined) continue;
      out.push({
        name,
        resource: strOf(n.obj, rk),
        local,
        node: n.id,
        nodeName: n.name,
        section: n.section,
        cls: n.cls,
      });
    }
  }
  return out;
}

// ── Validation ───────────────────────────────────────────────────────────────

export interface AudioIssue {
  severity: "error" | "warning" | "info";
  rule: string;
  message: string;
  node?: number;
}

/** True/false when the reference can be checked, undefined when it cannot. */
export type RefResolver = (path: string) => boolean | undefined;

function hasOpaque(entries: CstEntry[]): boolean {
  return entries.some((e) => e.kind === "opaque" || (e.kind === "object" && hasOpaque(e.children)));
}

export function validateAudio(model: AudioModel, resolve?: RefResolver): AudioIssue[] {
  const issues: AudioIssue[] = [];
  const add = (severity: AudioIssue["severity"], rule: string, message: string, node?: number) =>
    issues.push({ severity, rule, message, node });
  for (const d of model.doc.diagnostics.slice(0, 20)) {
    add("error", "PARSE", `line ${d.line}: ${d.message}`);
  }
  if (hasOpaque(model.doc.root.children))
    add("warning", "OPAQUE", "text the parser could not place");
  const nodes = audioNodes(model);
  const links = audioLinks(model, nodes);
  const byId = new Map<number, AudioNode>();
  const dup = new Set<number>();
  for (const n of nodes) {
    if (n.id === undefined) {
      if (model.kind !== "vars") add("error", "NO_ID", `${n.path} (${n.cls}) has no id`);
      continue;
    }
    // A .sig group shares its id numbers with the nodes (vanilla), so only nodes are compared.
    if (model.kind === "sig" && n.cls === "GroupClass") continue;
    if (byId.has(n.id)) dup.add(n.id);
    else byId.set(n.id, n);
  }
  for (const id of dup) add("error", "DUPLICATE_ID", `id ${id} is used by more than one node`, id);

  if (model.kind === "acp") {
    for (const n of nodes) {
      const code = ACP_CLASS_CODES[n.cls];
      if (n.id !== undefined && code !== undefined && (n.id & 1023) !== code) {
        add(
          "warning",
          "CLASS_CODE",
          `${n.cls} ${n.id}: id & 1023 is ${n.id & 1023}, vanilla uses ${code}`,
          n.id,
        );
      }
      // `outState` of a sound names the mixer it plays into.
      const os = numOf(n.obj, "outState");
      if (os !== undefined) {
        const target = byId.get(os);
        if (!target) add("error", "OUT_STATE", `${n.path} outState ${os} is not a node`, n.id);
        else if (target.cls !== "MixerClass")
          add(
            "warning",
            "OUT_STATE",
            `${n.path} outState ${os} is a ${target.cls}, not a MixerClass`,
            n.id,
          );
      }
    }
    const names = new Map<string, number>();
    for (const e of eventsOf(model, nodes)) {
      const prev = names.get(e.name);
      if (prev !== undefined)
        add("warning", "DUPLICATE_EVENT", `event "${e.name}" is on ids ${prev} and ${e.id}`, e.id);
      else names.set(e.name, e.id);
    }
    // Sample names repeat in vanilla banks (many are all "Sample"), so they are not checked.
    for (const s of samplesOf(model, nodes)) {
      if (!s.filename)
        add(
          "error",
          "SAMPLE_NO_FILE",
          `bank ${s.bank.id} sample "${s.name}" has no Filename`,
          s.bank.id,
        );
    }
    for (const n of nodes) {
      if (n.cls !== "SignalClass") continue;
      const ip = numberLine(blockOf(n.obj, "inputsport")).length;
      for (const key of ["inputvalues", "inputvaluesmin", "inputvaluesmax"]) {
        const c = numberLine(blockOf(n.obj, key)).length;
        if (blockOf(n.obj, key) && c !== ip)
          add(
            "warning",
            "SIGNAL_VALUES",
            `${n.path} ${key} has ${c} values for ${ip} input ports`,
            n.id,
          );
      }
    }
  }
  if (model.kind === "acp" || model.kind === "afm" || model.kind === "sig") {
    for (const l of links) {
      if (!byId.has(l.from))
        add(
          model.kind === "acp" ? "error" : "warning", // vanilla .afm and .sig keep dangling links
          "LINK_SOURCE",
          `node ${l.to} port ${l.toPort} is linked from ${l.from}, which is not a node`,
          l.to,
        );
    }
  }
  if (model.kind === "sig") {
    for (const n of nodes) {
      if (n.cls === "GroupClass") continue; // vanilla groups keep stale member ids
      for (const c of blockOf(n.obj, "children")?.children ?? []) {
        const ids =
          c.kind === "value"
            ? c.values.map((t) => Number(tokenValue(t)))
            : c.kind === "scalar"
              ? [Number(c.key)]
              : [];
        for (const id of ids) {
          if (Number.isFinite(id) && !byId.has(id))
            add("warning", "CHILD", `node ${n.id} lists child ${id}, which is not a node`, n.id);
        }
      }
    }
    const compiled = blockOf(model.root, "compiled");
    if (compiled)
      add(
        "info",
        "COMPILED",
        "the file carries a compiled block; an edit of the graph does not regenerate it (U11)",
      );
  }
  if (model.kind === "vars") {
    const seen = new Set<string>();
    for (const n of nodes) {
      if (!n.name) add("error", "NO_NAME", `${n.path} has no name`);
      else if (seen.has(n.name))
        add("error", "DUPLICATE_ID", `variable "${n.name}" is declared twice`);
      else seen.add(n.name);
    }
  }
  if (resolve) {
    const reported = new Set<string>();
    for (const r of refsOf(model, nodes)) {
      const ok = resolve(r.path);
      if (ok === false && !reported.has(r.path)) {
        reported.add(r.path);
        add(
          "warning",
          "MISSING_RESOURCE",
          `${r.key} ${r.path} is in neither the project nor the game data`,
          r.node,
        );
      }
    }
  }
  return issues;
}
