/**
 * Layer text on the lossless CST (src/formats/enfusion-cst.ts), for the two
 * scenario writers: scenario_apply_template (inserts entity blocks) and
 * scenario_clone_area (drops entity blocks, swaps GUIDs, moves coords).
 *
 * Both writers splice the original text: every byte outside an inserted,
 * removed or changed span stays as it was (line ends, indents, comments,
 * block order, an entity's class and name, a missing final line end).
 *
 * Pure: no FS, no MCP. The tool wrappers own I/O.
 */

import {
  parseCstBytes,
  type CstDocument,
  type CstEntry,
  type CstObject,
  type CstRoot,
} from "../formats/enfusion-cst.js";
import { serialize, type EnfusionNode } from "../formats/enfusion-text.js";

/** A parsed layer and the block whose object children are its entities. */
export interface LayerDoc {
  doc: CstDocument;
  /**
   * The document root for a multi-root `.layer`; the single top-level object
   * when `singleRoot` was asked for and the file holds exactly one (a `.conf`
   * mission header or an `.ent` root).
   */
  block: CstRoot | CstObject;
}

export interface OpenLayerOptions {
  /**
   * Treat a file with one top-level object as that object (its children are
   * the entities). The tools pass true for `.conf` / `.ent`. A file that does
   * not hold exactly one top-level object falls back to the document root.
   * Never used for `.layer`: a layer with one entity keeps the root, so the
   * entity is not mistaken for a container.
   */
  singleRoot?: boolean;
}

/**
 * Parse layer text or bytes. Refuses (throws) when the text is not UTF-8 or
 * when the CST reports a diagnostic (an unclosed block, a stray `}`, an
 * unterminated string): a writer should not splice a file it cannot place
 * entities in with certainty.
 */
export function openLayer(input: string | Uint8Array, opts: OpenLayerOptions = {}): LayerDoc {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  const doc = parseCstBytes(buf);
  if (doc.encoding !== "utf8") {
    throw new Error(`layer is not UTF-8 text (read as ${doc.encoding}); refusing to rewrite it`);
  }
  if (doc.diagnostics.length > 0) {
    const d = doc.diagnostics[0];
    throw new Error(
      `layer does not parse cleanly (line ${d.line}: ${d.message}` +
        `${doc.diagnostics.length > 1 ? `, and ${doc.diagnostics.length - 1} more` : ""}); refusing to rewrite it`,
    );
  }
  const base = doc.base;
  const block = opts.singleRoot && base.kind === "object" ? base : doc.root;
  return { doc, block };
}

/** The object children of a block (the layer's entities). */
export function entitiesOf(block: CstRoot | CstObject): CstObject[] {
  return block.children.filter((c): c is CstObject => c.kind === "object");
}

// ── Text helpers ─────────────────────────────────────────────────────────────

export interface TextEdit {
  start: number;
  end: number;
  text: string;
}

/** Applies non-overlapping edits given in original-text offsets. */
export function applyEdits(text: string, edits: readonly TextEdit[]): string {
  const sorted = [...edits].sort((a, b) => b.start - a.start || b.end - a.end);
  let out = text;
  let floor = Infinity;
  for (const e of sorted) {
    if (e.end > floor) throw new Error("internal: overlapping layer edits");
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
    floor = e.start;
  }
  return out;
}

export function lineStart(text: string, offset: number): number {
  let i = offset;
  while (i > 0 && text[i - 1] !== "\n" && text[i - 1] !== "\r") i--;
  return i;
}

/** The blanks before `offset` on its line, or undefined when other text precedes it. */
export function indentAt(text: string, offset: number): string | undefined {
  const pre = text.slice(lineStart(text, offset), offset);
  return /^[ \t]*$/.test(pre) ? pre : undefined;
}

/**
 * The span removing an entry takes: its whole line(s) through the line end
 * when nothing else shares them (a trailing `//` comment goes with it); else
 * the entry and the blanks after it. Same rule as the CST's own removal.
 */
export function removalSpan(text: string, e: CstEntry): [number, number] {
  let s = e.start;
  let en = e.end;
  const ls = lineStart(text, s);
  const alone = /^[ \t﻿]*$/.test(text.slice(ls, s));
  let j = en;
  while (j < text.length && (text[j] === " " || text[j] === "\t")) j++;
  if (text.startsWith("//", j)) while (j < text.length && text[j] !== "\n" && text[j] !== "\r") j++;
  const atEol = j === text.length || text[j] === "\n" || text[j] === "\r";
  if (alone && atEol) {
    s = ls;
    en = j;
    if (text[en] === "\r") en += text[en + 1] === "\n" ? 2 : 1;
    else if (text[en] === "\n") en++;
    else if (s > 0) {
      // Last line without a line end: take the line end before it instead.
      let k = s;
      if (text[k - 1] === "\n") k--;
      if (k > 0 && text[k - 1] === "\r") k--;
      s = k;
    }
    return [s, en];
  }
  while (en < text.length && (text[en] === " " || text[en] === "\t")) en++;
  return [s, en];
}

/** The file's line end (the first one written, LF when none) and indent unit. */
export function detectStyle(text: string): { eol: string; unit: string } {
  const eol = /\r\n|\n|\r/.exec(text)?.[0] ?? "\n";
  const unit = /^([ \t]+)\S/m.exec(text)?.[1] ?? " ";
  return { eol, unit };
}

/**
 * Text for a fresh entity block: the enfusion-text serializer's output (one
 * space per depth, LF) re-indented to `indent` + `unit` per depth and joined
 * with `eol`. Template nodes hold no multi-line values, so the leading spaces
 * of each serialized line are its depth.
 */
export function renderNode(node: EnfusionNode, indent: string, unit: string, eol: string): string {
  const plain = serialize({ ...node, eol: undefined });
  return plain
    .split("\n")
    .map((line) => {
      const depth = /^ */.exec(line)![0].length;
      return indent + unit.repeat(depth) + line.slice(depth);
    })
    .join(eol);
}

/**
 * Inserts fresh entity blocks at the end of the layer's entity block. The
 * original text is kept whole; the result is the original with one inserted
 * span.
 *
 *   - Root block: appended at the end of the file. A file that ends with a
 *     line end gets each block followed by one; a file that does not (the way
 *     Workbench saves layers) gets each block preceded by one, so it still
 *     ends without a line end.
 *   - Object block (single root): placed before its closing brace, at the
 *     indent of its last child (or the header indent plus one unit).
 */
export function insertEntities(layer: LayerDoc, nodes: readonly EnfusionNode[]): string {
  const text = layer.doc.text;
  if (nodes.length === 0) return text;
  const { eol, unit } = detectStyle(text);
  const block = layer.block;
  if (block.kind === "root") {
    const rendered = nodes.map((n) => renderNode(n, "", unit, eol));
    const endsEol = text === "" || /[\r\n]$/.test(text);
    const add = endsEol ? rendered.map((r) => r + eol).join("") : rendered.map((r) => eol + r).join("");
    return text + add;
  }
  if (!block.close) throw new Error(`block '${block.key}' is not closed`);
  const headerIndent = indentAt(text, block.start) ?? "";
  const last = block.children[block.children.length - 1];
  const childIndent = (last && indentAt(text, last.start)) ?? headerIndent + unit;
  const rendered = nodes.map((n) => renderNode(n, childIndent, unit, eol));
  const c = block.close.start;
  if (indentAt(text, c) !== undefined) {
    const ls = lineStart(text, c);
    return applyEdits(text, [{ start: ls, end: ls, text: rendered.map((r) => r + eol).join("") }]);
  }
  return applyEdits(text, [{ start: c, end: c, text: eol + rendered.join(eol) + eol + headerIndent }]);
}
