/**
 * What a `.bt` model means, and the operations on it: outline, checks, building
 * a tree from a spec, and edits.
 *
 * Measured on the vanilla corpus (121 files, 2,422 nodes, build 1.9.0.37):
 *   - the root block holds `Name` (the resource path, in all 121), then `Nodes`,
 *     `Variables`, `VariablesRefs`, `Groups`, in that order, the last three optional;
 *   - `Nodes` of the root holds one `RootNode` (always exactly one child) and,
 *     in 6 files, detached nodes beside it;
 *   - a variable is `BtVariable<Type> <name> { Flags 0|"Input"|"Output"; Desc "" }`;
 *   - a `VariableReference <name>` is one box on the canvas: `VariableType` is the
 *     index of its variable in `Variables` (name equal in all 1,276);
 *   - a port names a `VariablesRefs` index, not a variable: `Port <i>` inside
 *     `InPorts`/`OutPorts`, and inline properties whose key starts with `In` or
 *     `Out` (`InVariable 3`, `OutEntity 0`; 45 distinct keys, always an integer).
 *     -1 is "not connected"; one reference feeds 1 to 5 ports;
 *   - decorators (`Decorator`, `DecoTestVariable`, `DecoratorEntity`, `Repeater`,
 *     `ForEachChild`) always have one child; tasks and `RunBT` none.
 * Nothing here was checked against the engine's loader: a tree that passes
 * `validateBt` is shaped like the vanilla ones, which is what can be said offline.
 */

import {
  bare,
  blocks,
  child,
  ensureChild,
  nameWord,
  prop,
  propText,
  quoted,
  setProp,
  type BtBlock,
  type BtDocument,
  type BtItem,
  type BtWord,
} from "./model.js";

// ── Catalog (data/behavior-tree/catalog.json, scripts/gen-bt-catalog.ts) ─────

export interface CatalogProp {
  /** Nodes of the type that carry the key. */
  n: number;
  /** True when vanilla writes the value quoted. */
  quoted: boolean;
  /** Up to four distinct values seen. */
  samples: string[];
}

/** What the build's source index says of a class (scripts/gen-bt-catalog.ts). */
export interface CatalogClassFacts {
  /** Direct parent class. */
  parent?: string;
  /** First of AITaskScripted, AITask, DecoratorScripted, Decorator on the chain, else Node. */
  family?: string;
  /** Declaring script file and line. */
  source?: string;
  /** True when declared in a script file, false for an engine (generated) class. */
  scripted?: boolean;
  /** `[Attribute]` fields of the script chain: the properties the editor shows. */
  attributes?: string[];
}

/** A `BaseDecoratorTest` descendant (the classes a `TEST` block holds). */
export interface CatalogTest extends CatalogClassFacts {
  /** Uses inside TEST blocks of the vanilla trees. */
  count: number;
  props: Record<string, CatalogProp>;
}

export interface CatalogNode extends CatalogClassFacts {
  /** Nodes of this class in the vanilla trees; 0 for a class only the index lists. */
  count: number;
  props: Record<string, CatalogProp>;
  /** Inline variable properties (`InVariable`, `OutEntity`, ...). */
  vars: string[];
  in: string[];
  out: string[];
  /** Fewest and most children seen. */
  children: [number, number];
  /** Other blocks seen on the node (`TEST`, `RandomRange`, ...). */
  blocks: string[];
  /** Classes seen inside `TEST`. */
  tests: string[];
}

export interface BtCatalog {
  build: string;
  /** Vanilla trees read for the usage data. */
  files: number;
  /** Every `Node` descendant of the build's index, with vanilla usage where there is some. */
  nodes: Record<string, CatalogNode>;
  /** Every `BaseDecoratorTest` descendant of the index (absent from a 1.x catalog). */
  tests?: Record<string, CatalogTest>;
  variableTypes: string[];
}

/** The catalog entry of a node class, own keys only (a name such as `constructor` finds nothing). */
export function lookupNode(catalog: BtCatalog, type: string): CatalogNode | undefined {
  return Object.hasOwn(catalog.nodes, type) ? catalog.nodes[type] : undefined;
}

function ownProp(node: CatalogNode, key: string): CatalogProp | undefined {
  return Object.hasOwn(node.props, key) ? node.props[key] : undefined;
}

function propOf(
  catalog: BtCatalog | undefined,
  type: string,
  key: string,
): CatalogProp | undefined {
  const node = catalog ? lookupNode(catalog, type) : undefined;
  return node ? ownProp(node, key) : undefined;
}

/** The catalog entry of a TEST class, own keys only. */
export function lookupTest(catalog: BtCatalog, type: string): CatalogTest | undefined {
  return catalog.tests && Object.hasOwn(catalog.tests, type) ? catalog.tests[type] : undefined;
}

// ── Reading ──────────────────────────────────────────────────────────────────

export interface BtVariable {
  name: string;
  /** `Integer`, `Scalar`, `Entity`, ... (the class without `BtVariable`). */
  type: string;
  flags: string;
  desc: string;
}

export interface BtRef {
  index: number;
  name: string;
  /** Index into the variables, or -1 when the file gives none. */
  variable: number;
}

export interface BtPort {
  side: "in" | "out";
  /** Port name, or the property key for an inline variable property. */
  name: string;
  inline: boolean;
  /** `VariablesRefs` index, -1 when not connected. */
  ref: number;
}

export interface BtNodeView {
  /** Child indexes from the root node: "" is the RootNode, "0/2" its first child's third child. */
  path: string;
  type: string;
  name: string;
  block: BtBlock;
  props: Record<string, string>;
  ports: BtPort[];
  tests: string[];
  children: BtNodeView[];
}

export interface BtView {
  guid?: string;
  resourcePath?: string;
  name?: string;
  root?: BtNodeView;
  /** Top-level nodes beside the RootNode. */
  detached: BtNodeView[];
  variables: BtVariable[];
  refs: BtRef[];
  groups: number;
  nodeCount: number;
}

const INLINE_VAR = /^(In|Out)[A-Z]/;
const STRUCTURAL = new Set(["Name", "EditorPos", "Group"]);
const NODE_BLOCKS = new Set(["Nodes", "InPorts", "OutPorts"]);

function intOf(text: string | undefined): number {
  return text !== undefined && /^-?\d+$/.test(text) ? Number(text) : NaN;
}

function nodeView(block: BtBlock, path: string): BtNodeView {
  const props: Record<string, string> = {};
  const ports: BtPort[] = [];
  for (const e of block.entries) {
    if (e.kind !== "prop") continue;
    const text = e.values.map((v) => v.text).join(" ");
    if (INLINE_VAR.test(e.key) && !Number.isNaN(intOf(text))) {
      ports.push({
        side: e.key.startsWith("In") ? "in" : "out",
        name: e.key,
        inline: true,
        ref: intOf(text),
      });
    } else if (!STRUCTURAL.has(e.key)) {
      props[e.key] = text;
    }
  }
  for (const [key, side] of [
    ["InPorts", "in"],
    ["OutPorts", "out"],
  ] as const) {
    for (const p of blocks(child(block, key))) {
      const i = intOf(propText(p, "Port"));
      ports.push({
        side,
        name: propText(p, "PortName") ?? "",
        inline: false,
        ref: Number.isNaN(i) ? -1 : i,
      });
    }
  }
  const kids = blocks(child(block, "Nodes"));
  return {
    path,
    type: block.head[0]?.text ?? "",
    name: propText(block, "Name") ?? block.head[1]?.text ?? "",
    block,
    props,
    ports,
    tests: blocks(child(block, "TEST")).map((t) => t.head[0]?.text ?? ""),
    children: kids.map((k, i) => nodeView(k, path === "" ? String(i) : `${path}/${i}`)),
  };
}

export function viewBt(doc: BtDocument): BtView {
  const root = doc.root;
  const ref = /^\{([0-9A-Fa-f]{16})\}(.*)$/.exec(root.head[1]?.text ?? "");
  const tops = blocks(child(root, "Nodes"));
  const rootIndex = tops.findIndex((n) => n.head[0]?.text === "RootNode");
  const variables = blocks(child(root, "Variables")).map((v) => ({
    name: v.head[1]?.text ?? "",
    type: (v.head[0]?.text ?? "").replace(/^BtVariable/, ""),
    flags: propText(v, "Flags") ?? "0",
    desc: propText(v, "Desc") ?? "",
  }));
  const refs = blocks(child(root, "VariablesRefs")).map((r, index) => {
    const t = intOf(propText(r, "VariableType"));
    return { index, name: r.head[1]?.text ?? "", variable: Number.isNaN(t) ? -1 : t };
  });
  const view: BtView = {
    guid: ref?.[1].toUpperCase(),
    resourcePath: ref?.[2],
    name: propText(root, "Name"),
    root: rootIndex === -1 ? undefined : nodeView(tops[rootIndex], ""),
    detached: tops
      .map((n, i) => ({ n, i }))
      .filter(({ i }) => i !== rootIndex)
      .map(({ n, i }) => nodeView(n, `detached:${i}`)),
    variables,
    refs,
    groups: blocks(child(root, "Groups")).length,
    nodeCount: 0,
  };
  view.nodeCount = allNodes(view).length;
  return view;
}

export function allNodes(view: BtView): BtNodeView[] {
  const out: BtNodeView[] = [];
  const walk = (n: BtNodeView): void => {
    out.push(n);
    n.children.forEach(walk);
  };
  if (view.root) walk(view.root);
  view.detached.forEach(walk);
  return out;
}

/** The node a path or a unique name addresses; throws with the candidates when it does not resolve. */
export function findNode(view: BtView, address: string): BtNodeView {
  const nodes = allNodes(view);
  const byPath = nodes.find((n) => n.path === address);
  if (byPath) return byPath;
  if (address === "root" && view.root) return view.root;
  const byName = nodes.filter((n) => n.name === address);
  if (byName.length === 1) return byName[0];
  if (byName.length > 1) {
    throw new Error(
      `${byName.length} nodes are named "${address}": use a path (${byName.map((n) => `"${n.path}"`).join(", ")})`,
    );
  }
  throw new Error(
    `no node at "${address}"; paths are child indexes from the root node ("" or "root", "0", "0/1", ...)`,
  );
}

/** The variable name a port is wired to, or null. */
export function portVariable(view: BtView, port: BtPort): string | null {
  const r = view.refs[port.ref];
  return port.ref >= 0 && r ? r.name : null;
}

export function formatBt(view: BtView, title: string): string {
  const lines = [`# Behavior tree: ${title}`, ""];
  if (view.guid) lines.push(`- **Resource:** {${view.guid}}${view.resourcePath ?? ""}`);
  if (view.name) lines.push(`- **Name:** ${view.name}`);
  lines.push(
    `- **Nodes:** ${view.nodeCount}${view.detached.length ? ` (${view.detached.length} detached top-level)` : ""}`,
    `- **Variables:** ${view.variables.length}, references ${view.refs.length}, groups ${view.groups}`,
  );
  if (view.variables.length) {
    lines.push("", "## Variables");
    for (const v of view.variables) {
      const flag = v.flags === "0" ? "" : ` [${v.flags}]`;
      lines.push(`- ${v.name}: ${v.type}${flag}${v.desc ? ` (${v.desc})` : ""}`);
    }
  }
  const walk = (n: BtNodeView, depth: number): void => {
    const pad = "  ".repeat(depth);
    const label = n.name && n.name !== n.type ? `${n.type} "${n.name}"` : n.type;
    const props = Object.entries(n.props)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");
    lines.push(
      `${pad}- [${n.path === "" ? "root" : n.path}] ${label}${props ? ` {${props}}` : ""}`,
    );
    for (const p of n.ports) {
      const v = portVariable(view, p);
      lines.push(
        `${pad}    ${p.side === "in" ? "in " : "out"} ${p.name} ${p.side === "in" ? "<-" : "->"} ${v ?? "(not connected)"}`,
      );
    }
    if (n.tests.length) lines.push(`${pad}    tests: ${n.tests.join(", ")}`);
    n.children.forEach((c) => walk(c, depth + 1));
  };
  lines.push("", "## Tree (children run left to right)");
  if (view.root) walk(view.root, 0);
  else lines.push("(no RootNode)");
  for (const d of view.detached) {
    lines.push("", "## Detached");
    walk(d, 0);
  }
  return lines.join("\n");
}

// ── Checks ───────────────────────────────────────────────────────────────────

export interface BtFinding {
  level: "error" | "warning";
  /** Node path, or "" for the file. */
  at: string;
  message: string;
}

export interface ValidateOptions {
  catalog?: BtCatalog;
  /** The resource path the file sits at, to compare `Name` and the header with. */
  expectedPath?: string;
  /** Says whether a `{GUID}path` or bare path names an existing tree (RunBT targets). */
  treeExists?: (ref: string) => boolean | undefined;
}

export function validateBt(doc: BtDocument, opts: ValidateOptions = {}): BtFinding[] {
  const view = viewBt(doc);
  const out: BtFinding[] = [];
  const add = (level: BtFinding["level"], at: string, message: string): void => {
    out.push({ level, at, message });
  };
  if (!view.name) add("error", "", "the root has no Name (vanilla: the resource path)");
  if (opts.expectedPath) {
    if (view.name && view.name !== opts.expectedPath)
      add("warning", "", `Name is "${view.name}", the file is at "${opts.expectedPath}"`);
    if (view.resourcePath !== undefined && view.resourcePath !== opts.expectedPath)
      add(
        "warning",
        "",
        `the header names "${view.resourcePath}", the file is at "${opts.expectedPath}"`,
      );
  }
  const tops = blocks(child(doc.root, "Nodes"));
  const roots = tops.filter((n) => n.head[0]?.text === "RootNode");
  if (roots.length === 0) add("error", "", "no RootNode under the top Nodes block");
  if (roots.length > 1) add("error", "", `${roots.length} RootNode blocks; a tree has one`);
  if (view.root && view.root.children.length !== 1)
    add(
      "error",
      "",
      `the RootNode has ${view.root.children.length} children; it takes exactly one`,
    );
  if (view.detached.length)
    add(
      "warning",
      "",
      `${view.detached.length} node(s) beside the RootNode are not part of the tree (6 vanilla files have such nodes)`,
    );

  const seen = new Set<string>();
  for (const v of view.variables) {
    if (!v.name) add("error", "", "a variable has no name");
    if (seen.has(v.name)) add("error", "", `variable "${v.name}" is declared twice`);
    seen.add(v.name);
    if (opts.catalog && !opts.catalog.variableTypes.includes(v.type))
      add(
        "warning",
        "",
        `variable "${v.name}" has type ${v.type}, not one of ${opts.catalog.variableTypes.join(", ")}`,
      );
  }
  const used = new Set<number>();
  for (const r of view.refs) {
    const v = view.variables[r.variable];
    if (!v)
      add(
        "error",
        "",
        `variable reference #${r.index} "${r.name}" has VariableType ${r.variable}; there are ${view.variables.length} variables`,
      );
    else if (v.name !== r.name)
      add(
        "error",
        "",
        `variable reference #${r.index} is named "${r.name}" but VariableType ${r.variable} is "${v.name}"`,
      );
  }

  for (const n of allNodes(view)) {
    const at = n.path === "" ? "root" : n.path;
    if (!prop(n.block, "EditorPos")) add("warning", at, `${n.type} has no EditorPos`);
    for (const p of n.ports) {
      if (p.ref === -1) continue;
      if (p.ref < 0 || p.ref >= view.refs.length) {
        add(
          "error",
          at,
          `${n.type} ${p.name} points at variable reference ${p.ref}; there are ${view.refs.length}`,
        );
      } else used.add(p.ref);
    }
    if (n.type === "RunBT") {
      const target = n.props.BehaviorTree;
      const wired = n.ports.some((p) => p.name === "InBehaviorTree" && p.ref !== -1);
      if (!target && !wired)
        add("warning", at, "RunBT has neither a BehaviorTree property nor a wired InBehaviorTree");
      else if (target && opts.treeExists && opts.treeExists(target) === false)
        add("warning", at, `RunBT names "${target}", which was not found`);
    }
    const known = opts.catalog ? lookupNode(opts.catalog, n.type) : undefined;
    if (n.type === "RootNode") continue;
    if (opts.catalog && !known) {
      add(
        "warning",
        at,
        opts.catalog.tests
          ? `${n.type} is not a Node class of build ${opts.catalog.build}: check the name (behavior_tree nodes, api_search)`
          : `${n.type} is in no vanilla tree: check that the class exists and is a node (api_search), and its ports`,
      );
      continue;
    }
    if (opts.catalog?.tests) {
      for (const t of n.tests) {
        if (!lookupTest(opts.catalog, t))
          add(
            "warning",
            at,
            `TEST class ${t} is not a BaseDecoratorTest class of build ${opts.catalog!.build}`,
          );
      }
    }
    // A class only the index lists has no vanilla shape to compare with.
    if (!known || known.count === 0) continue;
    const [min, max] = known.children;
    if (max === 0 && n.children.length > 0)
      add(
        "warning",
        at,
        `${n.type} has ${n.children.length} child node(s); in vanilla it never has any`,
      );
    if (min === 1 && max === 1 && n.children.length !== 1)
      add(
        "error",
        at,
        `${n.type} has ${n.children.length} children; in vanilla it always has exactly one`,
      );
    if (min >= 1 && max > 1 && n.children.length === 0)
      add("warning", at, `${n.type} has no children`);
    for (const key of Object.keys(n.props)) {
      if (!Object.hasOwn(known.props, key))
        add("warning", at, `${n.type} has property ${key}, which no vanilla ${n.type} carries`);
    }
    for (const p of n.ports) {
      // RunBT's named ports are the called tree's variables, not the node's own.
      if (n.type === "RunBT" && !p.inline) continue;
      const list = p.inline ? known.vars : p.side === "in" ? known.in : known.out;
      if (!list.includes(p.name))
        add(
          "warning",
          at,
          `${n.type} has ${p.inline ? "variable property" : `${p.side} port`} ${p.name}, which no vanilla ${n.type} carries`,
        );
    }
  }
  const referenced = new Set(view.refs.map((r) => r.variable));
  view.variables.forEach((v, i) => {
    if (!referenced.has(i))
      add(
        "warning",
        "",
        `variable "${v.name}" has no reference on the canvas: nothing reads or writes it`,
      );
  });
  return out;
}

// ── Building ─────────────────────────────────────────────────────────────────

export type SpecScalar = string | number | boolean;
export type SpecValue =
  | SpecScalar
  | SpecScalar[]
  | { value: SpecScalar | SpecScalar[]; quoted: boolean };

export interface NodeSpec {
  /** Node class (`Sequence`, `AITaskIdle`, `SCR_AISetStance`, ...). */
  type: string;
  /** Display name; the class when omitted. */
  name?: string;
  /** Own properties (`Period: 2`, `Result: "SUCCESS"`). */
  props?: Record<string, SpecValue>;
  /** Inline variable properties: key (`InVariable`, `OutEntity`) to variable name; null leaves it unconnected. */
  vars?: Record<string, string | null>;
  /** Named input ports: port name to variable name; null lists the port unconnected. */
  in?: Record<string, string | null>;
  out?: Record<string, string | null>;
  /** Classes for the node's TEST block (scripted decorators). */
  tests?: string[];
  children?: NodeSpec[];
}

export interface VariableSpec {
  name: string;
  /** `Integer`, `Scalar`, `Bool`, `Entity`, `Vector`, `Object`, `String`, ... */
  type: string;
  /** "input", "output", or omitted for a local variable. */
  flag?: "input" | "output";
  desc?: string;
}

export interface TreeSpec {
  /** Resource path from the addon root (`AI/BehaviorTrees/My/Guard.bt`). */
  path: string;
  /** 16 hex digits; the header carries `{GUID}path` when given (44 of 121 vanilla files do). */
  guid?: string;
  variables?: VariableSpec[];
  /** The single child of the RootNode. */
  root: NodeSpec;
}

function words(key: string, value: SpecValue, known: CatalogProp | undefined): BtWord[] {
  const explicit = typeof value === "object" && !Array.isArray(value) ? value : undefined;
  const raw = explicit ? explicit.value : (value as SpecScalar | SpecScalar[]);
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map((v) => {
    if (typeof v === "boolean") return bare(v ? 1 : 0);
    if (typeof v === "number") {
      if (!Number.isFinite(v))
        throw new Error(`property ${key}: ${v} is not a number a file can hold`);
      return bare(v);
    }
    const q = explicit ? explicit.quoted : known ? known.quoted : !/^-?\d+(\.\d+)?$/.test(v);
    return q ? quoted(v) : bare(v);
  });
}

class RefTable {
  constructor(
    private readonly doc: BtDocument,
    private readonly at: () => [number, number],
  ) {}

  /** A fresh canvas reference for `name`; throws when the variable is not declared. */
  add(name: string): number {
    const vars = blocks(child(this.doc.root, "Variables"));
    const type = vars.findIndex((v) => v.head[1]?.text === name);
    if (type === -1) {
      throw new Error(
        `variable "${name}" is not declared (declared: ${vars.map((v) => v.head[1]?.text).join(", ") || "none"})`,
      );
    }
    const refs = ensureRootBlock(this.doc, "VariablesRefs");
    const [x, y] = this.at();
    refs.entries.push({
      kind: "block",
      head: [bare("VariableReference"), nameWord(name)],
      entries: [
        { kind: "prop", key: "VariableType", values: [bare(type)] },
        { kind: "prop", key: "EditorPos", values: [bare(x), bare(y)] },
      ],
    });
    return refs.entries.length - 1;
  }
}

const ROOT_ORDER = ["Nodes", "Variables", "VariablesRefs", "Groups"];

/** The root's `key` block, created in the vanilla order when missing. */
function ensureRootBlock(doc: BtDocument, key: string): BtBlock {
  const have = child(doc.root, key);
  if (have) return have;
  const made: BtBlock = { kind: "block", head: [bare(key)], entries: [] };
  const rank = ROOT_ORDER.indexOf(key);
  let at = doc.root.entries.length;
  for (let i = 0; i < doc.root.entries.length; i++) {
    const e = doc.root.entries[i];
    if (e.kind === "block" && ROOT_ORDER.indexOf(e.head[0]?.text ?? "") > rank) {
      at = i;
      break;
    }
  }
  doc.root.entries.splice(at, 0, made);
  return made;
}

const VAR_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function variableBlock(v: VariableSpec): BtBlock {
  if (!VAR_NAME.test(v.name)) throw new Error(`variable name "${v.name}" must be an identifier`);
  if (!/^[A-Za-z]+$/.test(v.type))
    throw new Error(`variable type "${v.type}" must be a word such as Integer or Entity`);
  const flag =
    v.flag === "input" ? quoted("Input") : v.flag === "output" ? quoted("Output") : bare(0);
  return {
    kind: "block",
    head: [bare(`BtVariable${v.type.replace(/^BtVariable/, "")}`), bare(v.name)],
    entries: [
      { kind: "prop", key: "Flags", values: [flag] },
      { kind: "prop", key: "Desc", values: [quoted(v.desc ?? "")] },
    ],
  };
}

const CLASS_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const fmt = (n: number): string => String(Math.round(n * 1000) / 1000);

interface Placed {
  block: BtBlock;
  x: number;
  y: number;
}

const X_STEP = 260;
const Y_STEP = 180;

/**
 * Builds the node blocks of a spec with a tidy layout: leaves take consecutive columns from
 * `cursor.x`, a parent sits over the middle of its children, depth sets the row.
 */
function buildNode(
  spec: NodeSpec,
  depth: number,
  cursor: { x: number },
  y0: number,
  doc: BtDocument,
  catalog: BtCatalog | undefined,
): Placed {
  if (!CLASS_NAME.test(spec.type)) throw new Error(`node type "${spec.type}" must be a class name`);
  if (spec.type === "RootNode")
    throw new Error("the RootNode is made for you: give its child as the root");
  const known = catalog ? lookupNode(catalog, spec.type) : undefined;
  const name = spec.name ?? spec.type;
  const kids = (spec.children ?? []).map((c) => buildNode(c, depth + 1, cursor, y0, doc, catalog));
  let x: number;
  if (kids.length === 0) {
    x = cursor.x;
    cursor.x += X_STEP;
  } else {
    x = (kids[0].x + kids[kids.length - 1].x) / 2;
  }
  const y = y0 + depth * Y_STEP;
  const entries: BtItem[] = [
    { kind: "prop", key: "Name", values: [quoted(name)] },
    { kind: "prop", key: "EditorPos", values: [bare(fmt(x)), bare(fmt(y))] },
  ];
  let slot = 0;
  const wire = (variable: string | null): number => {
    if (variable === null) return -1;
    return new RefTable(doc, () => [Math.round(x - 200), Math.round(y + 60 + 44 * slot++)]).add(
      variable,
    );
  };
  for (const [key, value] of Object.entries(spec.props ?? {})) {
    if (STRUCTURAL.has(key) || NODE_BLOCKS.has(key))
      throw new Error(`property ${key} is set by the builder`);
    entries.push({
      kind: "prop",
      key,
      values: words(key, value, known ? ownProp(known, key) : undefined),
    });
  }
  for (const [key, variable] of Object.entries(spec.vars ?? {})) {
    if (!INLINE_VAR.test(key))
      throw new Error(
        `"${key}" is not a variable property: those start with In or Out (InVariable, OutEntity)`,
      );
    entries.push({ kind: "prop", key, values: [bare(wire(variable))] });
  }
  if (kids.length) {
    entries.push({ kind: "block", head: [bare("Nodes")], entries: kids.map((k) => k.block) });
  }
  for (const [key, side, cls] of [
    ["InPorts", spec.in, "SingleInputPortContainer"],
    ["OutPorts", spec.out, "SingleOutputPortContainer"],
  ] as const) {
    const names = Object.entries(side ?? {});
    if (!names.length) continue;
    entries.push({
      kind: "block",
      head: [bare(key)],
      entries: names.map(([port, variable]) => ({
        kind: "block" as const,
        head: [bare(cls), bare(cls)],
        entries: [
          { kind: "prop" as const, key: "Port", values: [bare(wire(variable))] },
          { kind: "prop" as const, key: "PortName", values: [quoted(port)] },
        ],
      })),
    });
  }
  if (spec.tests?.length) {
    entries.push({
      kind: "block",
      head: [bare("TEST")],
      entries: spec.tests.map((t) => {
        if (!CLASS_NAME.test(t)) throw new Error(`test "${t}" must be a class name`);
        return { kind: "block" as const, head: [bare(t), bare(t)], entries: [] };
      }),
    });
  }
  return { block: { kind: "block", head: [bare(spec.type), nameWord(name)], entries }, x, y };
}

const RES_PATH = /^[A-Za-z0-9_][A-Za-z0-9_ ./-]*\.bt$/;

/** A new tree from a spec, laid out for the editor canvas. */
export function buildBt(spec: TreeSpec, catalog?: BtCatalog): BtDocument {
  const path = spec.path.replace(/\\/g, "/");
  if (!RES_PATH.test(path) || path.includes("..")) {
    throw new Error(
      `path "${spec.path}" must be a resource path ending in .bt (AI/BehaviorTrees/My/Tree.bt)`,
    );
  }
  if (spec.guid !== undefined && !/^[0-9A-Fa-f]{16}$/.test(spec.guid))
    throw new Error("guid must be 16 hex digits");
  const head = [bare("BehaviorTree")];
  if (spec.guid) head.push(quoted(`{${spec.guid.toUpperCase()}}${path}`));
  const doc: BtDocument = {
    root: { kind: "block", head, entries: [{ kind: "prop", key: "Name", values: [quoted(path)] }] },
    eol: "\n",
    finalEol: false,
  };
  const nodes = ensureRootBlock(doc, "Nodes");
  const names = new Set<string>();
  if (spec.variables?.length) {
    const vars = ensureRootBlock(doc, "Variables");
    for (const v of spec.variables) {
      if (names.has(v.name)) throw new Error(`variable "${v.name}" is declared twice`);
      names.add(v.name);
      vars.entries.push(variableBlock(v));
    }
  }
  const placed = buildNode(spec.root, 1, { x: 0 }, 80, doc, catalog);
  nodes.entries.push({
    kind: "block",
    head: [bare("RootNode"), bare("Root")],
    entries: [
      { kind: "prop", key: "Name", values: [quoted("Root")] },
      { kind: "prop", key: "EditorPos", values: [bare(fmt(placed.x)), bare("80")] },
      { kind: "block", head: [bare("Nodes")], entries: [placed.block] },
    ],
  });
  return doc;
}

// ── Edits ────────────────────────────────────────────────────────────────────

export type BtOp =
  | { op: "set_property"; node: string; key: string; value: SpecValue }
  | { op: "remove_property"; node: string; key: string }
  | { op: "rename_node"; node: string; name: string }
  | { op: "add_node"; parent: string; index?: number; node: NodeSpec }
  | { op: "remove_node"; node: string }
  | { op: "move_node"; node: string; parent: string; index?: number }
  | { op: "add_variable"; variable: VariableSpec }
  | { op: "connect"; node: string; port: string; variable: string | null };

function parentOf(view: BtView, target: BtNodeView): BtNodeView | undefined {
  return allNodes(view).find((n) => n.children.includes(target));
}

function editorPos(block: BtBlock): [number, number] {
  const p = prop(block, "EditorPos");
  const x = Number(p?.values[0]?.text);
  const y = Number(p?.values[1]?.text);
  return [Number.isFinite(x) ? x : 0, Number.isFinite(y) ? y : 0];
}

/** Applies one edit in place and says what it did. */
export function applyOp(doc: BtDocument, op: BtOp, catalog?: BtCatalog): string {
  const view = viewBt(doc);
  switch (op.op) {
    case "set_property": {
      const n = findNode(view, op.node);
      if (STRUCTURAL.has(op.key) && op.key !== "Group")
        throw new Error(`${op.key} is not set this way (rename_node sets the name)`);
      if (INLINE_VAR.test(op.key) && n.ports.some((p) => p.inline && p.name === op.key))
        throw new Error(`${op.key} is a variable property: use connect`);
      setProp(n.block, op.key, words(op.key, op.value, propOf(catalog, n.type, op.key)));
      return `${n.type} [${n.path || "root"}]: ${op.key} set`;
    }
    case "remove_property": {
      const n = findNode(view, op.node);
      if (STRUCTURAL.has(op.key) && op.key !== "Group")
        throw new Error(`${op.key} cannot be removed`);
      const i = n.block.entries.findIndex((e) => e.kind === "prop" && e.key === op.key);
      if (i === -1) throw new Error(`${n.type} [${n.path || "root"}] has no property ${op.key}`);
      n.block.entries.splice(i, 1);
      return `${n.type} [${n.path || "root"}]: ${op.key} removed`;
    }
    case "rename_node": {
      const n = findNode(view, op.node);
      if (n.type === "RootNode") throw new Error("the RootNode keeps its name");
      setProp(n.block, "Name", [quoted(op.name)]);
      n.block.head = [n.block.head[0], nameWord(op.name)];
      return `${n.type} [${n.path}]: renamed "${op.name}"`;
    }
    case "add_node": {
      const parent = findNode(view, op.parent);
      if (parent.type === "RootNode" && parent.children.length >= 1)
        throw new Error("the RootNode already has its one child: add under that child");
      const [px, py] = editorPos(parent.block);
      const last = parent.children[parent.children.length - 1];
      const startX = last ? editorPos(last.block)[0] + X_STEP : px;
      const depthY = py + Y_STEP;
      const placed = buildNode(op.node, 0, { x: startX }, depthY, doc, catalog);
      const nodes = child(parent.block, "Nodes") ?? insertNodesBlock(parent.block);
      const at = op.index === undefined ? nodes.entries.length : op.index;
      if (!Number.isInteger(at) || at < 0 || at > nodes.entries.length)
        throw new Error(`index ${op.index} is outside 0..${nodes.entries.length}`);
      nodes.entries.splice(at, 0, placed.block);
      return `${op.node.type} added under ${parent.type} [${parent.path || "root"}] at ${at}`;
    }
    case "remove_node": {
      const n = findNode(view, op.node);
      if (n.type === "RootNode") throw new Error("the RootNode cannot be removed");
      const parent = parentOf(view, n);
      const list = parent ? child(parent.block, "Nodes") : child(doc.root, "Nodes");
      if (!list) throw new Error("the node's container was not found");
      list.entries.splice(list.entries.indexOf(n.block), 1);
      if (parent && list.entries.length === 0)
        parent.block.entries.splice(parent.block.entries.indexOf(list), 1);
      const count = allNodes({ ...view, root: n, detached: [] }).length;
      return `${n.type} [${n.path}] removed with ${count - 1} descendant(s); its variable references stay on the canvas, unconnected`;
    }
    case "move_node": {
      const n = findNode(view, op.node);
      const dest = findNode(view, op.parent);
      if (n.type === "RootNode") throw new Error("the RootNode cannot be moved");
      if (allNodes({ ...view, root: n, detached: [] }).includes(dest))
        throw new Error("a node cannot move under itself");
      if (dest.type === "RootNode" && dest.children.length >= 1 && !dest.children.includes(n))
        throw new Error("the RootNode already has its one child");
      const from = parentOf(view, n);
      const src = from ? child(from.block, "Nodes") : child(doc.root, "Nodes");
      if (!src) throw new Error("the node's container was not found");
      src.entries.splice(src.entries.indexOf(n.block), 1);
      if (from && src.entries.length === 0 && from !== dest)
        from.block.entries.splice(from.block.entries.indexOf(src), 1);
      const target = child(dest.block, "Nodes") ?? insertNodesBlock(dest.block);
      const at = op.index === undefined ? target.entries.length : op.index;
      if (!Number.isInteger(at) || at < 0 || at > target.entries.length)
        throw new Error(`index ${op.index} is outside 0..${target.entries.length}`);
      target.entries.splice(at, 0, n.block);
      return `${n.type} moved under ${dest.type} [${dest.path || "root"}] at ${at}; EditorPos unchanged (rearrange on the canvas)`;
    }
    case "add_variable": {
      if (view.variables.some((v) => v.name === op.variable.name))
        throw new Error(`variable "${op.variable.name}" is already declared`);
      ensureRootBlock(doc, "Variables").entries.push(variableBlock(op.variable));
      return `variable ${op.variable.name}: ${op.variable.type} declared`;
    }
    case "connect": {
      const n = findNode(view, op.node);
      const [x, y] = editorPos(n.block);
      const index =
        op.variable === null
          ? -1
          : new RefTable(doc, () => [Math.round(x - 200), Math.round(y + 60)]).add(op.variable);
      const inline = prop(n.block, op.port);
      if (inline && INLINE_VAR.test(op.port)) {
        inline.values = [bare(index)];
        return `${n.type} [${n.path || "root"}]: ${op.port} ${op.variable === null ? "disconnected" : `wired to ${op.variable}`}`;
      }
      for (const key of ["InPorts", "OutPorts"]) {
        const port = blocks(child(n.block, key)).find((p) => propText(p, "PortName") === op.port);
        if (!port) continue;
        setPortIndex(port, index);
        return `${n.type} [${n.path || "root"}]: port ${op.port} ${op.variable === null ? "disconnected" : `wired to ${op.variable}`}`;
      }
      const known = catalog ? lookupNode(catalog, n.type) : undefined;
      if (INLINE_VAR.test(op.port) && (!known || known.vars.includes(op.port))) {
        setProp(n.block, op.port, [bare(index)]);
        return `${n.type} [${n.path || "root"}]: ${op.port} added, ${op.variable === null ? "unconnected" : `wired to ${op.variable}`}`;
      }
      const side = known?.in.includes(op.port)
        ? "InPorts"
        : known?.out.includes(op.port)
          ? "OutPorts"
          : undefined;
      if (!side) {
        throw new Error(
          `${n.type} [${n.path || "root"}] has no port or variable property "${op.port}"` +
            (known
              ? ` (vanilla: in ${known.in.join(", ") || "-"}; out ${known.out.join(", ") || "-"}; properties ${known.vars.join(", ") || "-"})`
              : ""),
        );
      }
      const cls = side === "InPorts" ? "SingleInputPortContainer" : "SingleOutputPortContainer";
      ensureChild(n.block, side).entries.push({
        kind: "block",
        head: [bare(cls), bare(cls)],
        entries: [
          { kind: "prop", key: "Port", values: [bare(index)] },
          { kind: "prop", key: "PortName", values: [quoted(op.port)] },
        ],
      });
      return `${n.type} [${n.path || "root"}]: port ${op.port} added, ${op.variable === null ? "unconnected" : `wired to ${op.variable}`}`;
    }
  }
}

/** `Port` goes before `PortName`, as the vanilla files have it. */
function setPortIndex(port: BtBlock, index: number): void {
  const p = prop(port, "Port");
  if (p) p.values = [bare(index)];
  else port.entries.unshift({ kind: "prop", key: "Port", values: [bare(index)] });
}

/** A `Nodes` block goes after `Name` and `EditorPos` and before the port blocks. */
function insertNodesBlock(node: BtBlock): BtBlock {
  const made: BtBlock = { kind: "block", head: [bare("Nodes")], entries: [] };
  const firstBlock = node.entries.findIndex((e) => e.kind === "block");
  node.entries.splice(firstBlock === -1 ? node.entries.length : firstBlock, 0, made);
  return made;
}

// ── Untyped input (tool arguments) ───────────────────────────────────────────

const isObj = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);
const isScalar = (x: unknown): x is SpecScalar =>
  typeof x === "string" || typeof x === "number" || typeof x === "boolean";

function specValue(x: unknown, at: string): SpecValue {
  if (isScalar(x)) return x;
  if (Array.isArray(x) && x.every(isScalar)) return x;
  if (
    isObj(x) &&
    typeof x.quoted === "boolean" &&
    (isScalar(x.value) || (Array.isArray(x.value) && x.value.every(isScalar)))
  )
    return { value: x.value as SpecScalar | SpecScalar[], quoted: x.quoted };
  throw new Error(
    `${at}: a value is a string, number, boolean, a list of those, or {value, quoted}`,
  );
}

function wiring(x: unknown, at: string): Record<string, string | null> | undefined {
  if (x === undefined) return undefined;
  if (!isObj(x)) throw new Error(`${at} must be an object of port name to variable name (or null)`);
  for (const [k, v] of Object.entries(x)) {
    if (v !== null && typeof v !== "string")
      throw new Error(`${at}.${k} must be a variable name or null`);
  }
  return x as Record<string, string | null>;
}

const NODE_KEYS = new Set(["type", "name", "props", "vars", "in", "out", "tests", "children"]);

/** Checks an untyped node spec and returns it typed; errors name the place. */
export function nodeSpecOf(x: unknown, at = "node"): NodeSpec {
  if (!isObj(x)) throw new Error(`${at} must be an object with a type`);
  if (typeof x.type !== "string" || !x.type)
    throw new Error(`${at}.type must be a node class name`);
  for (const k of Object.keys(x)) {
    if (!NODE_KEYS.has(k))
      throw new Error(`${at}: unknown key "${k}" (keys: ${[...NODE_KEYS].join(", ")})`);
  }
  if (x.name !== undefined && typeof x.name !== "string")
    throw new Error(`${at}.name must be a string`);
  let props: Record<string, SpecValue> | undefined;
  if (x.props !== undefined) {
    if (!isObj(x.props)) throw new Error(`${at}.props must be an object`);
    props = {};
    for (const [k, v] of Object.entries(x.props)) props[k] = specValue(v, `${at}.props.${k}`);
  }
  if (
    x.tests !== undefined &&
    !(Array.isArray(x.tests) && x.tests.every((t) => typeof t === "string"))
  )
    throw new Error(`${at}.tests must be a list of class names`);
  if (x.children !== undefined && !Array.isArray(x.children))
    throw new Error(`${at}.children must be a list`);
  return {
    type: x.type,
    name: x.name as string | undefined,
    props,
    vars: wiring(x.vars, `${at}.vars`),
    in: wiring(x.in, `${at}.in`),
    out: wiring(x.out, `${at}.out`),
    tests: x.tests as string[] | undefined,
    children: (x.children as unknown[] | undefined)?.map((c, i) =>
      nodeSpecOf(c, `${at}.children[${i}]`),
    ),
  };
}

export function variableSpecOf(x: unknown, at = "variable"): VariableSpec {
  if (!isObj(x) || typeof x.name !== "string" || typeof x.type !== "string")
    throw new Error(`${at} must be {name, type, flag?, desc?}`);
  if (x.flag !== undefined && x.flag !== "input" && x.flag !== "output")
    throw new Error(`${at}.flag must be "input" or "output"`);
  if (x.desc !== undefined && typeof x.desc !== "string")
    throw new Error(`${at}.desc must be a string`);
  return {
    name: x.name,
    type: x.type,
    flag: x.flag as VariableSpec["flag"],
    desc: x.desc as string | undefined,
  };
}

export function treeSpecOf(x: unknown): TreeSpec {
  if (!isObj(x)) throw new Error("spec must be an object {path, variables?, root}");
  if (typeof x.path !== "string")
    throw new Error("spec.path must be the resource path of the new tree");
  if (x.guid !== undefined && typeof x.guid !== "string")
    throw new Error("spec.guid must be 16 hex digits");
  if (x.variables !== undefined && !Array.isArray(x.variables))
    throw new Error("spec.variables must be a list");
  return {
    path: x.path,
    guid: x.guid as string | undefined,
    variables: (x.variables as unknown[] | undefined)?.map((v, i) =>
      variableSpecOf(v, `spec.variables[${i}]`),
    ),
    root: nodeSpecOf(x.root, "spec.root"),
  };
}

export function opOf(x: unknown, i: number): BtOp {
  const at = `ops[${i}]`;
  if (!isObj(x) || typeof x.op !== "string") throw new Error(`${at} must be an object with an op`);
  const str = (k: string): string => {
    if (typeof x[k] !== "string") throw new Error(`${at} (${x.op}) needs "${k}" as a string`);
    return x[k] as string;
  };
  const index = (): number | undefined => {
    if (x.index === undefined) return undefined;
    if (typeof x.index !== "number") throw new Error(`${at}.index must be a number`);
    return x.index;
  };
  switch (x.op) {
    case "set_property":
      return {
        op: "set_property",
        node: str("node"),
        key: str("key"),
        value: specValue(x.value, `${at}.value`),
      };
    case "remove_property":
      return { op: "remove_property", node: str("node"), key: str("key") };
    case "rename_node":
      return { op: "rename_node", node: str("node"), name: str("name") };
    case "add_node":
      return {
        op: "add_node",
        parent: str("parent"),
        index: index(),
        node: nodeSpecOf(x.node, `${at}.node`),
      };
    case "remove_node":
      return { op: "remove_node", node: str("node") };
    case "move_node":
      return { op: "move_node", node: str("node"), parent: str("parent"), index: index() };
    case "add_variable":
      return { op: "add_variable", variable: variableSpecOf(x.variable, `${at}.variable`) };
    case "connect":
      if (x.variable !== null && typeof x.variable !== "string")
        throw new Error(`${at} (connect) needs "variable" as a name, or null to disconnect`);
      return { op: "connect", node: str("node"), port: str("port"), variable: x.variable };
    default:
      throw new Error(
        `${at}: unknown op "${x.op}" (set_property, remove_property, rename_node, add_node, remove_node, move_node, add_variable, connect)`,
      );
  }
}
