/**
 * Ordered model of a `.bt` behavior tree file, and its writer.
 *
 * Shape of the file (vanilla corpus, 121 files at build 1.9.0.37, every one of
 * which `emitBt(parseBt(text))` gives back byte for byte):
 *
 *   BehaviorTree "{GUID}AI/BehaviorTrees/.../X.bt" {
 *    Name "AI/BehaviorTrees/.../X.bt"
 *    Nodes {
 *     RootNode Root {
 *      Name "Root"
 *      EditorPos -432 80
 *      Nodes { <child nodes, left to right = execution order> }
 *     }
 *     <detached nodes, if any>
 *    }
 *    Variables { BtVariable<Type> <name> { Flags 0 | "Input" ... ; Desc "" } ... }
 *    VariablesRefs { VariableReference <name> { VariableType <index into Variables>; EditorPos x y } ... }
 *    Groups { BTGroup "{GUID}" { Name "..."; Color r g b a } ... }
 *   }
 *
 * A node is `<Class> <name> {`: `Name`, `EditorPos`, its own properties, and
 * optionally `Nodes`, `InPorts`, `OutPorts` and class-specific blocks (`TEST`,
 * `RandomRange`, `ValuesArray`, `Tags`). Properties and blocks keep the order
 * of the file: a node may carry properties after its `Nodes` block.
 *
 * The model is read from the lossless CST (formats/enfusion-cst.ts), so the
 * order of entries is the file's. Comments and a non-canonical layout are not
 * kept by the model: `isCanonical` says whether the writer reproduces a text.
 */

import {
  parseCst,
  tokenValue,
  type CstEntry,
  type CstObject,
  type Token,
} from "../formats/enfusion-cst.js";

/** One header word or value: its text without quotes, and whether it was quoted. */
export interface BtWord {
  text: string;
  quoted: boolean;
}

/** `Key value...` */
export interface BtProp {
  kind: "prop";
  key: string;
  values: BtWord[];
}

/** A keyless line inside a block: `"LoiterPost"`, `0 1 2 3`. */
export interface BtLine {
  kind: "line";
  values: BtWord[];
}

/** `Head words {` ... `}` */
export interface BtBlock {
  kind: "block";
  /** Header words: the class or block key first, then the name when there is one. */
  head: BtWord[];
  entries: BtItem[];
}

export type BtItem = BtProp | BtLine | BtBlock;

export interface BtDocument {
  root: BtBlock;
  /** Line ending the file uses. */
  eol: "\n" | "\r\n";
  /** True when the file ends with a line ending after the last brace. */
  finalEol: boolean;
}

export class BtParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BtParseError";
  }
}

const word = (t: Token): BtWord => ({ text: tokenValue(t), quoted: t.kind === "string" });

function itemOf(e: CstEntry): BtItem {
  if (e.kind === "scalar") {
    return { kind: "prop", key: e.key, values: e.values.map(word) };
  }
  if (e.kind === "value") return { kind: "line", values: e.values.map(word) };
  if (e.kind === "object") return blockOf(e);
  throw new BtParseError(`unreadable text at offset ${e.start}: ${e.reason}`);
}

function blockOf(o: CstObject): BtBlock {
  if (o.base.length > 0 || o.legacy) {
    throw new BtParseError(
      `block ${o.key} at offset ${o.start} has a base reference or legacy form; not a .bt shape`,
    );
  }
  if (!o.close) throw new BtParseError(`block ${o.key} at offset ${o.start} is not closed`);
  return { kind: "block", head: o.head.map(word), entries: o.children.map(itemOf) };
}

/** Reads a `.bt` text; throws BtParseError when it is not one block named `BehaviorTree`. */
export function parseBt(text: string): BtDocument {
  const doc = parseCst(text);
  if (doc.diagnostics.length > 0) {
    const d = doc.diagnostics[0];
    throw new BtParseError(`line ${d.line}: ${d.message}`);
  }
  const tops = doc.root.children;
  if (tops.length !== 1 || tops[0].kind !== "object" || tops[0].key !== "BehaviorTree") {
    throw new BtParseError('a .bt file is one `BehaviorTree "{GUID}path" { ... }` block');
  }
  const crlf = text.includes("\r\n");
  return {
    root: blockOf(tops[0]),
    eol: crlf ? "\r\n" : "\n",
    finalEol: /\r?\n$/.test(text),
  };
}

const BARE = /^[^\s"{}]+$/;

function writeWord(w: BtWord): string {
  if (/["\r\n]/.test(w.text))
    throw new BtParseError(`a value holds a quote or a line break: ${w.text}`);
  if (w.quoted) return `"${w.text}"`;
  if (!BARE.test(w.text)) throw new BtParseError(`a bare value needs quotes: ${w.text}`);
  return w.text;
}

function writeItem(item: BtItem, depth: number, out: string[]): void {
  const pad = " ".repeat(depth);
  if (item.kind === "prop") {
    out.push(`${pad}${[item.key, ...item.values.map(writeWord)].join(" ")}`);
  } else if (item.kind === "line") {
    out.push(`${pad}${item.values.map(writeWord).join(" ")}`);
  } else {
    out.push(`${pad}${item.head.map(writeWord).join(" ")} {`);
    for (const e of item.entries) writeItem(e, depth + 1, out);
    out.push(`${pad}}`);
  }
}

/** Writes the model in the engine's style: one space of indent per depth, braces as the vanilla files have them. */
export function emitBt(doc: BtDocument): string {
  const out: string[] = [];
  writeItem(doc.root, 0, out);
  return out.join(doc.eol) + (doc.finalEol ? doc.eol : "");
}

/** True when the writer gives `text` back byte for byte (no comment, no hand layout). */
export function isCanonical(text: string): boolean {
  try {
    return emitBt(parseBt(text)) === text;
  } catch {
    return false;
  }
}

// ── Small helpers over the model ─────────────────────────────────────────────

export const bare = (text: string | number): BtWord => ({ text: String(text), quoted: false });
export const quoted = (text: string): BtWord => ({ text, quoted: true });
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** A name as a header writes it: bare when it is an identifier, else quoted. */
export const nameWord = (text: string): BtWord => ({ text, quoted: !IDENT.test(text) });

export function prop(block: BtBlock, key: string): BtProp | undefined {
  return block.entries.find((e): e is BtProp => e.kind === "prop" && e.key === key);
}

export function propText(block: BtBlock, key: string): string | undefined {
  const p = prop(block, key);
  return p ? p.values.map((v) => v.text).join(" ") : undefined;
}

export function child(block: BtBlock, key: string): BtBlock | undefined {
  return block.entries.find((e): e is BtBlock => e.kind === "block" && e.head[0]?.text === key);
}

export function blocks(block: BtBlock | undefined): BtBlock[] {
  return block ? block.entries.filter((e): e is BtBlock => e.kind === "block") : [];
}

/** Sets or adds `Key values`; a new property goes before the first block, after the other properties. */
export function setProp(block: BtBlock, key: string, values: BtWord[]): void {
  const p = prop(block, key);
  if (p) {
    p.values = values;
    return;
  }
  const firstBlock = block.entries.findIndex((e) => e.kind === "block");
  const at = firstBlock === -1 ? block.entries.length : firstBlock;
  block.entries.splice(at, 0, { kind: "prop", key, values });
}

/** The block `key` of `block`, created empty at the end when missing. */
export function ensureChild(block: BtBlock, key: string): BtBlock {
  const c = child(block, key);
  if (c) return c;
  const made: BtBlock = { kind: "block", head: [bare(key)], entries: [] };
  block.entries.push(made);
  return made;
}
