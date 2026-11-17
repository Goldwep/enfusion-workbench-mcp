/**
 * Lossless edits of animation graph files (wave W4, phase5-w4-spec.md 2.4):
 * `animation_graph edit` plans every op here, on a CST document in memory.
 *
 * Each op splices the text: bytes outside the edited span never change. Each
 * answers its inverse, an op that gives the original bytes back (corpus gate
 * 4): a removal's inverse carries the removed lines as `raw` with their
 * `index`, so an add puts them back exactly where they were.
 *
 * .agf ops: addNode, removeNode, setProp, connect, disconnect, addSheet,
 * removeSheet. .agr ops: addFile, removeFile, setDefaultRunNode, addVariable,
 * removeVariable. Nothing here touches the disk.
 */
import {
  CstDocument,
  CstEditError,
  tokenValue,
  type CstEntry,
  type CstObject,
  type EntrySpec,
  type ObjectSpec,
  type ScalarItem,
} from "../formats/enfusion-cst.js";
import { VocabularyError, type Change } from "../manifest/vocabulary.js";
import { NODE_CATALOG_BUILD, catalogClass, isNodeClass } from "./node-catalog.js";
import {
  connectionsOf,
  nameOf,
  nodesOf,
  objectOf,
  objectsOf,
  sheetsOf,
  type Block,
} from "./parser.js";

export const AGF_OPS = [
  "addNode",
  "removeNode",
  "setProp",
  "connect",
  "disconnect",
  "addSheet",
  "removeSheet",
] as const;
export const AGR_OPS = [
  "addFile",
  "removeFile",
  "setDefaultRunNode",
  "addVariable",
  "removeVariable",
] as const;
export const GRAPH_OPS = [...AGF_OPS, ...AGR_OPS] as const;
export type GraphOp = (typeof GRAPH_OPS)[number];

export type PropValue = ScalarItem | ScalarItem[];

export const VAR_TYPES = ["Float", "Int", "Bool", "String"] as const;
export type VarType = (typeof VAR_TYPES)[number];

/** One edit op; which fields it reads depends on `op` (see the tool's schema). */
export interface GraphEditOp {
  op: GraphOp;
  /** The sheet (agf ops); may be left out when the file has one sheet or the node name is unique. */
  sheet?: string;
  /** addNode, removeNode, addSheet, removeSheet, setDefaultRunNode, addVariable, removeVariable. */
  name?: string | null;
  /** addNode: the node class (AnimSrcNode...). */
  nodeClass?: string;
  /** addNode: properties of the new node, {key: value}. */
  props?: Record<string, PropValue>;
  /** addNode: EditorPos x y. */
  editorPos?: [number, number];
  /** setProp, connect, disconnect: the node. */
  node?: string;
  /** setProp: a path inside the node (`Child`, `BlendWeight`, `QueueItems[0].Child`). */
  prop?: string;
  /** setProp: the value; null removes the property. */
  value?: PropValue | null;
  /** setProp, connect: force quotes on or off. */
  quoted?: boolean;
  /** connect: the node to connect to. */
  to?: string;
  /** connect, disconnect: the slot (default `Child`; `Child1`, `QueueItems[0].Child`, ...). */
  slot?: string;
  /** addFile, removeFile: `{GUID}path.agf`. */
  file?: string;
  /** addVariable. */
  varType?: VarType;
  min?: number | string;
  max?: number | string;
  defaultValue?: number | string;
  /** An add's exact text (whole lines), as a removal's inverse gives it. */
  raw?: string;
  /** An add's position in its block (default: the end). */
  index?: number;
}

export interface GraphEditResult {
  doc: CstDocument;
  changed: Change[];
  /** The op that gives the original bytes back. */
  inverse: GraphEditOp;
  warnings: string[];
}

function refuse(code: VocabularyError["code"], message: string): never {
  throw new VocabularyError(code, message);
}

// ── Text helpers ─────────────────────────────────────────────────────────────

function lineStart(text: string, offset: number): number {
  let i = offset;
  while (i > 0 && text[i - 1] !== "\n" && text[i - 1] !== "\r") i--;
  return i;
}

function eolOf(doc: CstDocument): string {
  return doc.tokens.find((t) => t.kind === "eol")?.text ?? "\n";
}

/** The whole lines an entry stands on, with their line ending; undefined when it shares a line. */
function lineSpan(text: string, e: { start: number; end: number }): [number, number] | undefined {
  const ls = lineStart(text, e.start);
  if (!/^[ \t]*$/.test(text.slice(ls, e.start))) return undefined;
  let j = e.end;
  while (j < text.length && (text[j] === " " || text[j] === "\t")) j++;
  if (text.startsWith("//", j)) while (j < text.length && text[j] !== "\n" && text[j] !== "\r") j++;
  if (j >= text.length) return undefined;
  if (text[j] === "\r") return [ls, j + (text[j + 1] === "\n" ? 2 : 1)];
  if (text[j] === "\n") return [ls, j + 1];
  return undefined;
}

function withText(doc: CstDocument, text: string): CstDocument {
  if (doc.encoding === "latin1" && /[^\x00-\xff]/.test(text)) {
    refuse("INVALID_ARGUMENT", "text outside latin-1 in a latin-1 file");
  }
  return new CstDocument(text, doc.encoding);
}

/** The block that holds `entry` directly, with its position there. */
function parentOf(doc: CstDocument, entry: CstEntry): { block: Block; index: number } {
  const walk = (b: Block): { block: Block; index: number } | undefined => {
    const i = b.children.indexOf(entry);
    if (i >= 0) return { block: b, index: i };
    for (const c of b.children) {
      if (c.kind === "object") {
        const f = walk(c);
        if (f) return f;
      }
    }
    return undefined;
  };
  const f = walk(doc.root);
  if (!f) refuse("PATH_NOT_FOUND", "entry not found in the document");
  return f;
}

/** The CST path from the document's base to an object (`[0][2][5]`), "" for the base itself. */
function pathTo(doc: CstDocument, target: CstObject): string {
  const base = doc.base;
  if (base === target) return "";
  const walk = (b: Block, acc: string): string | undefined => {
    for (let i = 0; i < b.children.length; i++) {
      const c = b.children[i];
      if (c.kind !== "object") continue;
      const p = `${acc}[${i}]`;
      if (c === target) return p;
      const f = walk(c, p);
      if (f) return f;
    }
    return undefined;
  };
  const p = walk(base, "");
  if (p === undefined) refuse("PATH_NOT_FOUND", "object not found under the document's root block");
  return p;
}

function joinPath(base: string, rel: string): string {
  if (rel === "") return base;
  if (base === "") return rel;
  return rel.startsWith("[") ? base + rel : `${base}.${rel}`;
}

/** Removes an entry's whole lines; answers the removed text and where it stood. */
function removeLines(
  doc: CstDocument,
  entry: CstEntry,
  what: string,
): { doc: CstDocument; raw: string; index: number } {
  const span = lineSpan(doc.text, entry);
  if (!span) {
    refuse("INVALID_ARGUMENT", `${what} shares its line with other text: edit it by hand`);
  }
  const { index } = parentOf(doc, entry);
  const raw = doc.text.slice(span[0], span[1]);
  return { doc: withText(doc, doc.text.slice(0, span[0]) + doc.text.slice(span[1])), raw, index };
}

/** Inserts whole lines at `index` of a block (default: its end). */
function insertLines(doc: CstDocument, block: Block, raw: string, index?: number): CstDocument {
  if (raw.trim() === "") refuse("INVALID_ARGUMENT", "raw is empty");
  let text = raw;
  if (!/[\r\n]$/.test(text)) text += eolOf(doc);
  const n = block.children.length;
  const at = index ?? n;
  if (!Number.isInteger(at) || at < 0 || at > n) {
    refuse("PATH_NOT_FOUND", `index ${at} out of range (the block has ${n} entries)`);
  }
  let offset: number;
  if (at < n) {
    const c = block.children[at];
    offset = lineStart(doc.text, c.start);
    if (!/^[ \t]*$/.test(doc.text.slice(offset, c.start))) {
      refuse("INVALID_ARGUMENT", "the entry at that index shares its line: insert elsewhere");
    }
  } else if (block.kind === "object") {
    if (!block.close) refuse("INVALID_ARGUMENT", `block '${block.key}' is not closed`);
    offset = lineStart(doc.text, block.close.start);
    if (!/^[ \t]*$/.test(doc.text.slice(offset, block.close.start))) {
      refuse("INVALID_ARGUMENT", `block '${block.key}' closes on a shared line: give an index`);
    }
  } else {
    offset = doc.text.length;
    if (offset > 0 && !/[\r\n]$/.test(doc.text))
      text = eolOf(doc) + text.replace(/(\r\n|\n|\r)$/, "");
  }
  return withText(doc, doc.text.slice(0, offset) + text + doc.text.slice(offset));
}

/** The objects a raw text holds at its top level (diagnostics refuse). */
function rawObjects(raw: string): CstObject[] {
  const d = new CstDocument(raw);
  if (d.diagnostics.length > 0) {
    refuse("INVALID_ARGUMENT", `raw does not parse: ${d.diagnostics[0].message}`);
  }
  const entries = d.root.children;
  if (entries.some((e) => e.kind !== "object")) {
    refuse("INVALID_ARGUMENT", "raw must hold blocks only");
  }
  return entries as CstObject[];
}

function insertSpec(doc: CstDocument, path: string, spec: EntrySpec, index?: number): CstDocument {
  const work = new CstDocument(doc.text, doc.encoding);
  work.arrayAdd(path, spec, index);
  return work;
}

function entryText(doc: CstDocument, e: CstEntry): string {
  return doc.text.slice(e.start, e.end);
}

// ── Locating ─────────────────────────────────────────────────────────────────

function sheetNamed(doc: CstDocument, name: string): CstObject {
  const sheets = sheetsOf(doc);
  const s = sheets.find((x) => nameOf(x) === name);
  if (!s) {
    refuse(
      "ITEM_NOT_FOUND",
      `no sheet '${name}' (sheets: ${sheets.map(nameOf).join(", ") || "none"})`,
    );
  }
  return s;
}

/** The sheet an op names, or the only sheet. */
function sheetFor(doc: CstDocument, sheet: string | undefined): CstObject {
  if (sheet !== undefined) return sheetNamed(doc, sheet);
  const sheets = sheetsOf(doc);
  if (sheets.length === 1) return sheets[0];
  refuse(
    "INVALID_ARGUMENT",
    `the file has ${sheets.length} sheets: name one with sheet (${sheets.map(nameOf).join(", ")})`,
  );
}

/** A node by name: in the named sheet, else in the one sheet that holds it. */
function nodeFor(
  doc: CstDocument,
  sheet: string | undefined,
  name: string,
  warnings: string[],
): { sheet: CstObject; node: CstObject } {
  const sheets = sheet !== undefined ? [sheetNamed(doc, sheet)] : sheetsOf(doc);
  const hits: { sheet: CstObject; node: CstObject }[] = [];
  for (const s of sheets)
    for (const n of nodesOf(s)) if (nameOf(n) === name) hits.push({ sheet: s, node: n });
  if (hits.length === 0) {
    refuse(
      "ITEM_NOT_FOUND",
      `no node '${name}'${sheet !== undefined ? ` in sheet '${sheet}'` : ""}; read the names with inspect`,
    );
  }
  const inSheets = new Set(hits.map((h) => h.sheet));
  if (inSheets.size > 1) {
    refuse("INVALID_ARGUMENT", `node '${name}' is in ${inSheets.size} sheets: name the sheet`);
  }
  if (hits.length > 1)
    warnings.push(`${hits.length} nodes are named '${name}': the first is edited`);
  return hits[0];
}

/** The `Nodes` block of a sheet (the sheet itself when it holds its nodes directly). */
function nodesBlock(sheet: CstObject): CstObject {
  return objectOf(sheet, "Nodes") ?? sheet;
}

function needString(v: unknown, what: string): string {
  if (typeof v !== "string" || v === "") refuse("INVALID_ARGUMENT", `${what} is required`);
  return v;
}

const NODE_CLASS = /^AnimSrcNode[A-Za-z0-9_]*$/;
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const NAME_OK = /^[^"\r\n\\]+$/;

function checkName(name: string, what: string): void {
  if (!NAME_OK.test(name) || name.trim() !== name) {
    refuse(
      "INVALID_ARGUMENT",
      `${what} must be non-empty text without quotes, backslashes, line breaks or edge blanks`,
    );
  }
}

// ── Values ───────────────────────────────────────────────────────────────────

function asValue(v: unknown, what: string): PropValue {
  const one = (x: unknown) =>
    typeof x === "string" || typeof x === "number" || typeof x === "boolean";
  if (one(v)) return v as ScalarItem;
  if (Array.isArray(v) && v.length > 0 && v.every(one)) return v as ScalarItem[];
  refuse(
    "INVALID_ARGUMENT",
    `${what} must be a string, number, boolean or a non-empty list of them`,
  );
}

/** The current value of a scalar or value entry, as an inverse sends it back. */
function valueOf(e: CstEntry): { value: PropValue; quoted?: boolean } {
  if (e.kind !== "scalar" && e.kind !== "value") refuse("INVALID_ARGUMENT", "not a scalar");
  const vs = e.values;
  const values = vs.map(tokenValue);
  const kinds = new Set(vs.map((t) => t.kind === "string"));
  const quoted = kinds.size === 1 ? [...kinds][0] : undefined;
  return { value: values.length === 1 ? values[0] : values, quoted };
}

// ── agf ops ──────────────────────────────────────────────────────────────────

function addNode(doc: CstDocument, a: GraphEditOp): GraphEditResult {
  const warnings: string[] = [];
  const sheet = sheetFor(doc, a.sheet);
  const sheetName = nameOf(sheet);
  const block = nodesBlock(sheet);
  if (block === sheet)
    warnings.push(`sheet '${sheetName}' has no Nodes block: the node goes into the sheet itself`);
  const taken = new Set(nodesOf(sheet).map(nameOf));
  let newDoc: CstDocument;
  let name: string;
  if (a.raw !== undefined) {
    const objs = rawObjects(a.raw);
    if (objs.length !== 1 || !NODE_CLASS.test(objs[0].key)) {
      refuse("INVALID_ARGUMENT", "raw must hold exactly one AnimSrcNode block");
    }
    name = nameOf(objs[0]);
    if (taken.has(name))
      refuse("DUPLICATE_ID", `sheet '${sheetName}' already has a node '${name}'`);
    newDoc = insertLines(doc, block, a.raw, a.index);
  } else {
    const cls = needString(a.nodeClass, "addNode: nodeClass");
    if (!NODE_CLASS.test(cls))
      refuse("INVALID_ARGUMENT", `nodeClass must be an AnimSrcNode class, got ${cls}`);
    if (!isNodeClass(cls)) {
      warnings.push(
        `${cls} is not a node class of the ${NODE_CATALOG_BUILD} catalog (animation_graph nodes): the engine may not load it`,
      );
    }
    name = needString(a.name, "addNode: name");
    checkName(name, "name");
    if (taken.has(name))
      refuse("DUPLICATE_ID", `sheet '${sheetName}' already has a node '${name}'`);
    const entries: EntrySpec[] = [];
    if (a.editorPos) {
      const [x, y] = a.editorPos;
      if (!Number.isFinite(x) || !Number.isFinite(y))
        refuse("INVALID_ARGUMENT", "editorPos takes two numbers");
      entries.push({ key: "EditorPos", value: [x, y] });
    }
    const known = new Set((catalogClass(cls)?.keys ?? []).map((k) => k.name));
    for (const [k, v] of Object.entries(a.props ?? {})) {
      if (!IDENT.test(k)) refuse("INVALID_ARGUMENT", `props: not a key: ${k}`);
      if (k === "EditorPos" && a.editorPos) refuse("INVALID_ARGUMENT", "EditorPos given twice");
      if (known.size > 0 && !known.has(k)) warnings.push(`${cls} has no key '${k}' in the catalog`);
      entries.push({ key: k, value: asValue(v, `props.${k}`) });
    }
    const spec: ObjectSpec = { key: cls, name, entries };
    const work = new CstDocument(doc.text, doc.encoding);
    work.createObject(pathTo(doc, block), spec, a.index);
    newDoc = work;
  }
  const added = nodesOf(sheetNamedIn(newDoc, sheetName)).find((n) => nameOf(n) === name);
  return {
    doc: newDoc,
    changed: [
      {
        path: `${sheetName}/${name}`,
        before: null,
        after: added ? entryText(newDoc, added) : name,
      },
    ],
    inverse: { op: "removeNode", sheet: sheetName, name },
    warnings,
  };
}

function sheetNamedIn(doc: CstDocument, name: string): CstObject {
  return sheetNamed(doc, name);
}

function removeNode(doc: CstDocument, a: GraphEditOp): GraphEditResult {
  const warnings: string[] = [];
  const name = needString(a.name, "removeNode: name");
  const { sheet, node } = nodeFor(doc, a.sheet, name, warnings);
  const sheetName = nameOf(sheet);
  const users = sheetsOf(doc)
    .flatMap((s) => nodesOf(s))
    .filter((n) => n !== node && connectionsOf(n).includes(name))
    .map(nameOf);
  if (users.length > 0) {
    warnings.push(
      `still connected to '${name}' (now dangling): ${[...new Set(users)].slice(0, 20).join(", ")}`,
    );
  }
  const before = entryText(doc, node);
  const r = removeLines(doc, node, `node '${name}'`);
  return {
    doc: r.doc,
    changed: [{ path: `${sheetName}/${name}`, before, after: null }],
    inverse: { op: "addNode", sheet: sheetName, raw: r.raw, index: r.index },
    warnings,
  };
}

/**
 * Splits a property path into its parent block's path and the last key. A
 * path that ends in an index (`Children[0]`) names an item: no key, and the
 * parent is the path without that index.
 */
function splitProp(prop: string): { parent: string; key?: string } {
  const idx = /^(.*)\[\d+\]$/.exec(prop);
  if (idx) return { parent: idx[1] };
  const i = prop.lastIndexOf(".");
  const key = i < 0 ? prop : prop.slice(i + 1);
  return { parent: i < 0 ? "" : prop.slice(0, i), key };
}

function tryResolve(doc: CstDocument, path: string): CstEntry | undefined {
  try {
    return doc.resolve(path);
  } catch (e) {
    if (e instanceof CstEditError && e.code === "PATH_NOT_FOUND") return undefined;
    throw e;
  }
}

function setPropOn(
  doc: CstDocument,
  sheetName: string,
  node: CstObject,
  nodeName: string,
  prop: string,
  a: Pick<GraphEditOp, "value" | "quoted" | "raw" | "index">,
): GraphEditResult {
  const warnings: string[] = [];
  const nodePath = pathTo(doc, node);
  const full = joinPath(nodePath, prop);
  const where = `${sheetName}/${nodeName}.${prop}`;
  const current = tryResolve(doc, full);
  if (current && current.kind === "object") {
    refuse(
      "INVALID_ARGUMENT",
      `${prop} is a block: set one of its entries (${prop}.Key or ${prop}[0])`,
    );
  }
  const before = current ? entryText(doc, current) : null;
  if (a.value === null) {
    if (!current) refuse("PATH_NOT_FOUND", `${where}: no such property to remove`);
    const r = removeLines(doc, current, where);
    return {
      doc: r.doc,
      changed: [{ path: where, before, after: null }],
      inverse: {
        op: "setProp",
        sheet: sheetName,
        node: nodeName,
        prop,
        raw: r.raw,
        index: r.index,
      },
      warnings,
    };
  }
  let newDoc: CstDocument;
  let inverse: GraphEditOp;
  if (current) {
    if (a.raw !== undefined)
      refuse("INVALID_ARGUMENT", `${where} exists: raw only restores a removed property`);
    const value = asValue(a.value, "value");
    const old = valueOf(current);
    const work = new CstDocument(doc.text, doc.encoding);
    work.set(full, value, { quoted: a.quoted });
    newDoc = work;
    inverse = {
      op: "setProp",
      sheet: sheetName,
      node: nodeName,
      prop,
      value: old.value,
      quoted: old.quoted,
    };
  } else {
    const { parent, key } = splitProp(prop);
    if (key === undefined && a.raw === undefined)
      refuse("PATH_NOT_FOUND", `${where}: no such item`);
    const parentPath = joinPath(nodePath, parent);
    const pe = parentPath === "" ? doc.base : tryResolve(doc, parentPath);
    if (!pe || (pe.kind !== "object" && pe.kind !== "root")) {
      refuse("PATH_NOT_FOUND", `${sheetName}/${nodeName}: no block '${parent}'`);
    }
    if (a.raw !== undefined) {
      newDoc = insertLines(doc, pe, a.raw, a.index);
    } else {
      const value = asValue(a.value, "value");
      newDoc = insertSpec(doc, parentPath, { key: key!, value, quoted: a.quoted }, a.index);
      const known = catalogClass(node.key)?.keys.map((k) => k.name) ?? [];
      if (parent === "" && known.length > 0 && !known.includes(key!)) {
        warnings.push(`${node.key} has no key '${key}' in the catalog`);
      }
    }
    inverse = { op: "setProp", sheet: sheetName, node: nodeName, prop, value: null };
  }
  const now = tryResolve(newDoc, full);
  return {
    doc: newDoc,
    changed: [{ path: where, before, after: now ? entryText(newDoc, now) : null }],
    inverse,
    warnings,
  };
}

function setProp(doc: CstDocument, a: GraphEditOp): GraphEditResult {
  const warnings: string[] = [];
  const nodeName = needString(a.node, "setProp: node");
  const prop = needString(a.prop, "setProp: prop");
  if (a.value === undefined && a.raw === undefined)
    refuse("INVALID_ARGUMENT", "setProp needs value (null removes)");
  const { sheet, node } = nodeFor(doc, a.sheet, nodeName, warnings);
  const r = setPropOn(doc, nameOf(sheet), node, nodeName, prop, a);
  r.warnings.unshift(...warnings);
  return r;
}

function connect(doc: CstDocument, a: GraphEditOp): GraphEditResult {
  const warnings: string[] = [];
  const nodeName = needString(a.node, "connect: node");
  const slot = a.slot ?? "Child";
  const { sheet, node } = nodeFor(doc, a.sheet, nodeName, warnings);
  let r: GraphEditResult;
  if (a.raw !== undefined) {
    r = setPropOn(doc, nameOf(sheet), node, nodeName, slot, {
      raw: a.raw,
      index: a.index,
      value: "",
    });
  } else {
    const to = needString(a.to, "connect: to");
    if (to === nodeName) refuse("INVALID_ARGUMENT", "a node cannot connect to itself");
    const inSheet = nodesOf(sheet).some((n) => nameOf(n) === to);
    if (!inSheet) {
      const elsewhere = sheetsOf(doc).some((s) => nodesOf(s).some((n) => nameOf(n) === to));
      if (!elsewhere) refuse("ITEM_NOT_FOUND", `no node '${to}' in the file to connect to`);
      warnings.push(`'${to}' is in another sheet of the file`);
    }
    if (!/(^|\.)Child\d*$/.test(slot)) warnings.push(`slot '${slot}' is not a Child slot`);
    r = setPropOn(doc, nameOf(sheet), node, nodeName, slot, {
      value: to,
      quoted: a.quoted ?? true,
      index: a.index,
    });
  }
  r.warnings.unshift(...warnings);
  // The inverse of a fresh connection is a disconnect; of a changed one, the old connection.
  const inv = r.inverse;
  r.inverse =
    inv.value === null
      ? { op: "disconnect", sheet: inv.sheet, node: nodeName, slot }
      : inv.raw !== undefined
        ? inv
        : {
            op: "connect",
            sheet: inv.sheet,
            node: nodeName,
            slot,
            to: String(inv.value),
            quoted: inv.quoted,
          };
  return r;
}

function disconnect(doc: CstDocument, a: GraphEditOp): GraphEditResult {
  const warnings: string[] = [];
  const nodeName = needString(a.node, "disconnect: node");
  const slot = a.slot ?? "Child";
  const { sheet, node } = nodeFor(doc, a.sheet, nodeName, warnings);
  const r = setPropOn(doc, nameOf(sheet), node, nodeName, slot, { value: null });
  r.warnings.unshift(...warnings);
  r.inverse = {
    op: "connect",
    sheet: nameOf(sheet),
    node: nodeName,
    slot,
    raw: r.inverse.raw,
    index: r.inverse.index,
  };
  return r;
}

function sheetsBlock(doc: CstDocument): Block {
  const base = doc.base;
  const s = objectOf(base, "Sheets");
  if (!s) refuse("INVALID_ARGUMENT", "the file has no Sheets block: is it an .agf?");
  return s;
}

function addSheet(doc: CstDocument, a: GraphEditOp): GraphEditResult {
  const block = sheetsBlock(doc);
  let name: string;
  let newDoc: CstDocument;
  if (a.raw !== undefined) {
    const objs = rawObjects(a.raw);
    if (objs.length !== 1 || objs[0].key !== "AnimSrcGraphSheet") {
      refuse("INVALID_ARGUMENT", "raw must hold exactly one AnimSrcGraphSheet block");
    }
    name = nameOf(objs[0]);
    newDoc = insertLines(doc, block, a.raw, a.index);
  } else {
    name = needString(a.name, "addSheet: name");
    checkName(name, "name");
    newDoc = insertSpec(
      doc,
      pathTo(doc, block as CstObject),
      {
        object: { key: "AnimSrcGraphSheet", name, entries: [{ object: { key: "Nodes" } }] },
      },
      a.index,
    );
  }
  if (objectsOf(block, "AnimSrcGraphSheet").some((s) => nameOf(s) === name)) {
    refuse("DUPLICATE_ID", `a sheet '${name}' already exists`);
  }
  const added = sheetsOf(newDoc).find((s) => nameOf(s) === name);
  return {
    doc: newDoc,
    changed: [
      { path: `sheet:${name}`, before: null, after: added ? entryText(newDoc, added) : name },
    ],
    inverse: { op: "removeSheet", name },
    warnings: [],
  };
}

function removeSheet(doc: CstDocument, a: GraphEditOp): GraphEditResult {
  const name = needString(a.name, "removeSheet: name");
  const sheet = sheetNamed(doc, name);
  const warnings: string[] = [];
  const n = nodesOf(sheet).length;
  if (n > 0) warnings.push(`the sheet held ${n} node(s); they are removed with it`);
  const before = entryText(doc, sheet);
  const r = removeLines(doc, sheet, `sheet '${name}'`);
  return {
    doc: r.doc,
    changed: [{ path: `sheet:${name}`, before, after: null }],
    inverse: { op: "addSheet", raw: r.raw, index: r.index },
    warnings,
  };
}

// ── agr ops ──────────────────────────────────────────────────────────────────

const FILE_REF = /^(\{[0-9A-Fa-f]{16}\})?[^"\r\n\\]+\.agf$/i;

function stripGuid(ref: string): string {
  return ref.replace(/^\{[0-9A-Fa-f]{16}\}/, "");
}

function agrRoot(doc: CstDocument): CstObject {
  const base = doc.base;
  if (base.kind !== "object" || base.key !== "AnimSrcGraph") {
    refuse("INVALID_ARGUMENT", "the file's root is not an AnimSrcGraph block: is it an .agr?");
  }
  return base;
}

function addFile(doc: CstDocument, a: GraphEditOp): GraphEditResult {
  const root = agrRoot(doc);
  const block = objectOf(root, "GraphFilesResourceNames");
  let newDoc: CstDocument;
  let file: string;
  const warnings: string[] = [];
  if (a.raw !== undefined) {
    if (!block) refuse("INVALID_ARGUMENT", "the file has no GraphFilesResourceNames block");
    const d = new CstDocument(a.raw);
    const v = d.root.children[0];
    if (d.root.children.length !== 1 || v.kind !== "value" || v.values.length !== 1) {
      refuse("INVALID_ARGUMENT", "raw must hold one quoted file reference");
    }
    file = tokenValue(v.values[0]);
    newDoc = insertLines(doc, block, a.raw, a.index);
  } else {
    file = needString(a.file, "addFile: file").trim();
    if (!FILE_REF.test(file))
      refuse("INVALID_ARGUMENT", `file must be {GUID}path.agf or path.agf, got ${file}`);
    const m = /^\{([0-9A-Fa-f]{16})\}(.*)$/.exec(file);
    if (m) file = `{${m[1].toUpperCase()}}${m[2]}`;
    else
      warnings.push(
        "the reference has no GUID: register the .agf and give {GUID}path so the engine binds it",
      );
    if (!block) {
      const work = new CstDocument(doc.text, doc.encoding);
      work.createObject("", {
        key: "GraphFilesResourceNames",
        entries: [{ value: file, quoted: true }],
      });
      newDoc = work;
      warnings.push("GraphFilesResourceNames was created; removeFile leaves it empty");
    } else {
      newDoc = insertSpec(doc, pathTo(doc, block), { value: file, quoted: true }, a.index);
    }
  }
  if (block) {
    const want = stripGuid(file).toLowerCase();
    for (const c of block.children) {
      if (
        c.kind === "value" &&
        c.values.some((t) => stripGuid(tokenValue(t)).toLowerCase() === want)
      ) {
        refuse("DUPLICATE_ID", `GraphFilesResourceNames already lists ${stripGuid(file)}`);
      }
    }
  }
  return {
    doc: newDoc,
    changed: [{ path: "GraphFilesResourceNames", before: null, after: file }],
    inverse: { op: "removeFile", file },
    warnings,
  };
}

function removeFile(doc: CstDocument, a: GraphEditOp): GraphEditResult {
  const root = agrRoot(doc);
  const file = needString(a.file, "removeFile: file").trim();
  const block = objectOf(root, "GraphFilesResourceNames");
  const want = stripGuid(file).toLowerCase();
  const hit = block?.children.find(
    (c) =>
      c.kind === "value" && c.values.some((t) => stripGuid(tokenValue(t)).toLowerCase() === want),
  );
  if (!block || !hit)
    refuse("ITEM_NOT_FOUND", `GraphFilesResourceNames does not list ${stripGuid(file)}`);
  if (hit.kind === "value" && hit.values.length !== 1) {
    refuse("INVALID_ARGUMENT", "the reference shares its line with others: edit it by hand");
  }
  const before = entryText(doc, hit);
  const r = removeLines(doc, hit, "the reference");
  return {
    doc: r.doc,
    changed: [{ path: "GraphFilesResourceNames", before, after: null }],
    inverse: { op: "addFile", raw: r.raw, index: r.index },
    warnings: [],
  };
}

function setDefaultRunNode(doc: CstDocument, a: GraphEditOp): GraphEditResult {
  const root = agrRoot(doc);
  if (a.name === undefined)
    refuse("INVALID_ARGUMENT", "setDefaultRunNode needs name (null removes it)");
  const current = root.children.find((c) => c.kind === "scalar" && c.key === "DefaultRunNode");
  const before = current ? entryText(doc, current) : null;
  const path = joinPath(pathTo(doc, root), "DefaultRunNode");
  if (a.name === null) {
    if (!current) refuse("PATH_NOT_FOUND", "the file has no DefaultRunNode to remove");
    const r = removeLines(doc, current, "DefaultRunNode");
    return {
      doc: r.doc,
      changed: [{ path: "DefaultRunNode", before, after: null }],
      inverse: { op: "setDefaultRunNode", name: "", raw: r.raw, index: r.index },
      warnings: [],
    };
  }
  let newDoc: CstDocument;
  if (a.raw !== undefined) {
    if (current)
      refuse("INVALID_ARGUMENT", "DefaultRunNode exists: raw only restores a removed one");
    newDoc = insertLines(doc, root, a.raw, a.index);
  } else {
    const name = a.name;
    checkName(name, "name");
    const work = new CstDocument(doc.text, doc.encoding);
    if (current) work.set(path, name, { quoted: a.quoted ?? true });
    else
      work.arrayAdd(
        pathTo(doc, root),
        { key: "DefaultRunNode", value: name, quoted: true },
        a.index,
      );
    newDoc = work;
  }
  const after = agrRoot(newDoc).children.find(
    (c) => c.kind === "scalar" && c.key === "DefaultRunNode",
  );
  const inverse: GraphEditOp = current
    ? {
        op: "setDefaultRunNode",
        name: String(valueOf(current).value),
        quoted: valueOf(current).quoted,
      }
    : { op: "setDefaultRunNode", name: null };
  return {
    doc: newDoc,
    changed: [{ path: "DefaultRunNode", before, after: after ? entryText(newDoc, after) : null }],
    inverse,
    warnings: [],
  };
}

const VAR_CLASS = /^AnimSrcGCTVar(Float|Int|Bool|String)$/;

function variablesBlock(
  doc: CstDocument,
  create: boolean,
): { doc: CstDocument; block?: CstObject; created: boolean } {
  const root = agrRoot(doc);
  const ct = objectOf(root, "ControlTemplate");
  if (!ct) refuse("INVALID_ARGUMENT", "the file has no ControlTemplate block to hold variables");
  const vars = objectOf(ct, "Variables");
  if (vars || !create) return { doc, block: vars, created: false };
  const work = new CstDocument(doc.text, doc.encoding);
  work.createObject(pathTo(doc, ct), { key: "Variables" }, 0);
  const ct2 = objectOf(agrRoot(work), "ControlTemplate")!;
  return { doc: work, block: objectOf(ct2, "Variables"), created: true };
}

function allVariables(doc: CstDocument): CstObject[] {
  const root = agrRoot(doc);
  const ct = objectOf(root, "ControlTemplate");
  const vars = ct ? objectOf(ct, "Variables") : undefined;
  return vars ? objectsOf(vars).filter((o) => VAR_CLASS.test(o.key)) : [];
}

function addVariable(doc: CstDocument, a: GraphEditOp): GraphEditResult {
  const warnings: string[] = [];
  let name: string;
  let newDoc: CstDocument;
  if (a.raw !== undefined) {
    const objs = rawObjects(a.raw);
    if (objs.length !== 1 || !VAR_CLASS.test(objs[0].key)) {
      refuse("INVALID_ARGUMENT", "raw must hold exactly one AnimSrcGCTVar block");
    }
    name = nameOf(objs[0]);
    const { block } = variablesBlock(doc, false);
    if (!block) refuse("INVALID_ARGUMENT", "the file has no Variables block");
    newDoc = insertLines(doc, block, a.raw, a.index);
  } else {
    name = needString(a.name, "addVariable: name");
    if (!IDENT.test(name))
      refuse("INVALID_ARGUMENT", `a variable name is an identifier, got ${name}`);
    const t = a.varType ?? "Float";
    if (!(["Float", "Int", "Bool", "String"] as string[]).includes(t)) {
      refuse("INVALID_ARGUMENT", `varType must be Float, Int, Bool or String, got ${String(t)}`);
    }
    const entries: EntrySpec[] = [];
    const num = (v: number | string | undefined, key: string) => {
      if (v === undefined) return;
      const n = typeof v === "number" ? v : Number(v);
      if (typeof v === "string" && (v.trim() === "" || !Number.isFinite(n))) {
        refuse("INVALID_ARGUMENT", `${key} must be a number, got ${v}`);
      }
      if (!Number.isFinite(n)) refuse("INVALID_ARGUMENT", `${key} must be a finite number`);
      entries.push({ key, value: typeof v === "string" ? v.trim() : v, quoted: false });
    };
    if (t === "Float" || t === "Int") {
      num(a.min, "MinValue");
      num(a.max, "MaxValue");
    } else if (a.min !== undefined || a.max !== undefined) {
      refuse("INVALID_ARGUMENT", `a ${t} variable takes no min or max`);
    }
    if (t !== "String") num(a.defaultValue, "DefaultValue");
    else if (a.defaultValue !== undefined)
      refuse("INVALID_ARGUMENT", "a String variable takes no defaultValue");
    if (t === "Int") {
      for (const e of entries) {
        if ("key" in e && "value" in e && !Number.isInteger(Number(e.value)))
          refuse("INVALID_ARGUMENT", `${e.key} of an Int variable must be an integer`);
      }
    }
    const vb = variablesBlock(doc, true);
    if (vb.created)
      warnings.push("the Variables block was created; removeVariable leaves it empty");
    newDoc = insertSpec(
      vb.doc,
      pathTo(vb.doc, vb.block!),
      { object: { key: `AnimSrcGCTVar${t}`, name, entries } },
      a.index,
    );
  }
  if (allVariables(doc).some((v) => nameOf(v) === name))
    refuse("DUPLICATE_ID", `a variable '${name}' already exists`);
  const added = allVariables(newDoc).find((v) => nameOf(v) === name);
  return {
    doc: newDoc,
    changed: [
      { path: `Variables/${name}`, before: null, after: added ? entryText(newDoc, added) : name },
    ],
    inverse: { op: "removeVariable", name },
    warnings,
  };
}

function removeVariable(doc: CstDocument, a: GraphEditOp): GraphEditResult {
  const name = needString(a.name, "removeVariable: name");
  const v = allVariables(doc).find((x) => nameOf(x) === name);
  if (!v) refuse("ITEM_NOT_FOUND", `no variable '${name}' in ControlTemplate.Variables`);
  const before = entryText(doc, v);
  const r = removeLines(doc, v, `variable '${name}'`);
  return {
    doc: r.doc,
    changed: [{ path: `Variables/${name}`, before, after: null }],
    inverse: { op: "addVariable", raw: r.raw, index: r.index },
    warnings: [],
  };
}

// ── Entry point ──────────────────────────────────────────────────────────────

/** The extension an op edits. */
export function opExtension(op: GraphOp): ".agf" | ".agr" {
  return (AGF_OPS as readonly string[]).includes(op) ? ".agf" : ".agr";
}

function countOpaque(b: Block): number {
  let n = 0;
  for (const c of b.children) {
    if (c.kind === "opaque") n++;
    else if (c.kind === "object") n += countOpaque(c);
  }
  return n;
}

/**
 * Plans one op on a document; throws VocabularyError (or CstEditError) on a
 * refusal. The result's document is checked: no new parse diagnostic, no new
 * text the writer cannot address.
 */
export function applyGraphEdit(doc: CstDocument, a: GraphEditOp): GraphEditResult {
  try {
    return planGraphEdit(doc, a);
  } catch (e) {
    if (e instanceof CstEditError) {
      throw new VocabularyError(
        e.code === "PATH_NOT_FOUND" ? "PATH_NOT_FOUND" : "INVALID_ARGUMENT",
        e.message,
      );
    }
    throw e;
  }
}

function planGraphEdit(doc: CstDocument, a: GraphEditOp): GraphEditResult {
  let r: GraphEditResult;
  switch (a.op) {
    case "addNode":
      r = addNode(doc, a);
      break;
    case "removeNode":
      r = removeNode(doc, a);
      break;
    case "setProp":
      r = setProp(doc, a);
      break;
    case "connect":
      r = connect(doc, a);
      break;
    case "disconnect":
      r = disconnect(doc, a);
      break;
    case "addSheet":
      r = addSheet(doc, a);
      break;
    case "removeSheet":
      r = removeSheet(doc, a);
      break;
    case "addFile":
      r = addFile(doc, a);
      break;
    case "removeFile":
      r = removeFile(doc, a);
      break;
    case "setDefaultRunNode":
      r = setDefaultRunNode(doc, a);
      break;
    case "addVariable":
      r = addVariable(doc, a);
      break;
    case "removeVariable":
      r = removeVariable(doc, a);
      break;
    default:
      refuse("INVALID_ARGUMENT", `unknown op ${String((a as { op: unknown }).op)}`);
  }
  if (r.doc.diagnostics.length > doc.diagnostics.length) {
    refuse(
      "INVALID_ARGUMENT",
      `the edit would leave a parse diagnostic (${r.doc.diagnostics[r.doc.diagnostics.length - 1].message}): nothing planned`,
    );
  }
  if (countOpaque(r.doc.root) > countOpaque(doc.root)) {
    refuse(
      "INVALID_ARGUMENT",
      "the edit would leave text the writer cannot address: nothing planned",
    );
  }
  return r;
}
