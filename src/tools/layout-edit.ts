/**
 * `layout_edit`: read and edit `.layout` widget trees as files (Phase 5, wave W2).
 *
 * No Workbench call and no NET call. The file is parsed with the lossless CST
 * (src/formats/enfusion-cst.ts): every edit is a text splice that is parsed
 * again, so bytes outside the edited lines never change. A `.layout` file is
 * one root widget; a widget is `Class ["{GUID}"] [: "base layout"] { ... }`
 * with scalar properties, a `Slot SlotClass "{GUID}" { ... }` block, a
 * `components { ... }` block and, last, a header-less `{ ... }` block that
 * holds its child widgets (vanilla shapes, read through the corpus).
 *
 * Reads: a file under the project root, or a game resource from the paks.
 * Writes: only inside the project root, only on a file that exists (unless the
 * action creates a file), a dry run unless `confirm` is true.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { writeFileAtomic } from "../utils/atomic-write.js";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { z } from "zod";
import type { Config } from "../config.js";
import {
  CstDocument,
  CstEditError,
  parseCstBytes,
  parsePath,
  tokenValue,
  type CstObject,
  type CstScalar,
  type ObjectSpec,
  type EntrySpec,
  type ScalarInput,
} from "../formats/enfusion-cst.js";
import {
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
import { isPathInsideRoot, pinnedProjectRoot } from "../utils/path-guard.js";

// ── Vocabulary of the format (vanilla layouts, build 1.9.0.37) ───────────────

/** Slot class a child carries, by the class of its parent widget. Every container class of the corpus. */
const SLOT_OF_PARENT: Readonly<Record<string, string>> = {
  FrameWidgetClass: "FrameWidgetSlot",
  PanelWidgetClass: "FrameWidgetSlot",
  RTTextureWidgetClass: "FrameWidgetSlot",
  WindowWidgetClass: "FrameWidgetSlot",
  OverlayWidgetClass: "OverlayWidgetSlot",
  HorizontalLayoutWidgetClass: "LayoutSlot",
  VerticalLayoutWidgetClass: "LayoutSlot",
  SizeLayoutWidgetClass: "AlignableSlot",
  ScaleWidgetClass: "AlignableSlot",
  ScrollLayoutWidgetClass: "AlignableSlot",
  ButtonWidgetClass: "ButtonWidgetSlot",
  UniformGridLayoutWidgetClass: "UniformGridWidgetSlot",
  GridLayoutWidgetClass: "GridWidgetSlot",
  WrapLayoutWidgetClass: "WrapLayoutWidgetSlot",
};

/** Properties a slot class carries in the vanilla layouts. */
const SLOT_KEYS: Readonly<Record<string, readonly string[]>> = {
  FrameWidgetSlot: [
    "PositionX",
    "PositionY",
    "SizeX",
    "SizeY",
    "OffsetLeft",
    "OffsetTop",
    "OffsetRight",
    "OffsetBottom",
    "Anchor",
    "Alignment",
    "SizeToContent",
  ],
  OverlayWidgetSlot: ["HorizontalAlign", "VerticalAlign", "Padding"],
  LayoutSlot: ["Padding", "HorizontalAlign", "VerticalAlign", "SizeMode", "FillWeight"],
  AlignableSlot: ["HorizontalAlign", "VerticalAlign", "Padding"],
  ButtonWidgetSlot: ["HorizontalAlign", "VerticalAlign", "Padding"],
  UniformGridWidgetSlot: ["Column", "Row", "HorizontalAlign", "VerticalAlign"],
  GridWidgetSlot: [
    "Column",
    "Row",
    "ColumnSpan",
    "RowSpan",
    "Padding",
    "HorizontalAlign",
    "VerticalAlign",
  ],
  WrapLayoutWidgetSlot: ["Padding"],
};

/** Leaf classes the corpus uses (they never carry children there). */
const LEAF_CLASSES: ReadonlySet<string> = new Set([
  "ImageWidgetClass",
  "TextWidgetClass",
  "RichTextWidgetClass",
  "SmartPanelWidgetClass",
  "BlurWidgetClass",
  "ProgressBarWidgetClass",
  "ItemPreviewWidgetClass",
  "SliderWidgetClass",
  "CanvasWidgetClass",
  "EditBoxWidgetClass",
  "MapWidgetClass",
  "RenderTargetWidgetClass",
  "XComboBoxWidgetClass",
  "CheckBoxWidgetClass",
  "ProfileImageWidgetClass",
  "MultilineEditBoxWidgetClass",
]);

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const GUID_TOKEN = /^"\{([0-9A-Fa-f]{16})\}"$/;
const GUID_ARG = /^\{?([0-9A-Fa-f]{16})\}?$/;
const SEPARATOR = "\t//" + "-".repeat(96);
const PLUGIN_VERSION = "0.5.1";

const ACTIONS = [
  "read",
  "addWidget",
  "removeWidget",
  "moveWidget",
  "duplicateWidget",
  "wrap",
  "convert",
  "setProperty",
  "saveAsPrefab",
  "genClass",
] as const;
type Action = (typeof ACTIONS)[number];

// ── Errors ───────────────────────────────────────────────────────────────────

class LayoutError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly next?: string,
  ) {
    super(message);
    this.name = "LayoutError";
  }
}

const bad = (message: string): LayoutError => new LayoutError("INVALID_ARGUMENT", message);

// ── Arguments ────────────────────────────────────────────────────────────────

type PropValue = ScalarInput;

interface SlotArg {
  class?: string;
  props?: Record<string, PropValue>;
}

export interface LayoutEditArgs {
  action: Action;
  path: string;
  widget?: string;
  parent?: string;
  index?: number;
  widgetClass?: string;
  name?: string;
  base?: string;
  props?: Record<string, PropValue>;
  slot?: SlotArg;
  text?: string;
  wrapper?: string;
  unwrap?: boolean;
  toClass?: string;
  property?: string;
  value?: PropValue | null;
  quoted?: boolean;
  to?: string;
  className?: string;
  overwrite?: boolean;
  confirm?: boolean;
  cursor?: string;
  limit?: number;
  projectPath?: string;
}

// ── Text helpers ─────────────────────────────────────────────────────────────

const BOM = String.fromCharCode(0xfeff);

const sha256 = (b: Buffer | string): string => createHash("sha256").update(b).digest("hex");

function lineStartOf(t: string, i: number): number {
  let k = i;
  while (k > 0 && t[k - 1] !== "\n" && t[k - 1] !== "\r") k--;
  return k;
}

/** Leading blanks of the line `off` starts, or undefined when something else stands before it. */
function indentAt(t: string, off: number): string | undefined {
  const pre = t.slice(lineStartOf(t, off), off).split(BOM).join("");
  return /^[ \t]*$/.test(pre) ? pre : undefined;
}

/**
 * The whole lines `[start, end)` occupies, line ending included, when the
 * span starts its line and nothing but blanks or a `//` comment follows it.
 */
function lineSpan(t: string, start: number, end: number): [number, number] | undefined {
  if (indentAt(t, start) === undefined) return undefined;
  let j = end;
  while (j < t.length && (t[j] === " " || t[j] === "\t")) j++;
  if (t.startsWith("//", j)) while (j < t.length && t[j] !== "\n" && t[j] !== "\r") j++;
  if (j < t.length && t[j] !== "\n" && t[j] !== "\r") return undefined;
  if (t[j] === "\r") j += t[j + 1] === "\n" ? 2 : 1;
  else if (t[j] === "\n") j++;
  return [lineStartOf(t, start), j];
}

const splitLines = (s: string): string[] => s.split(/\r\n|\n|\r/);

interface Splice {
  s: number;
  e: number;
  t: string;
}

/** Applies non-overlapping splices of one text, last offset first. */
function applySplices(text: string, edits: Splice[]): string {
  let out = text;
  for (const x of [...edits].sort((a, b) => b.s - a.s))
    out = out.slice(0, x.s) + x.t + out.slice(x.e);
  return out;
}

/** Lines indented by `prefix` (blank lines stay blank). */
const indentLines = (lines: string[], prefix: string): string[] =>
  lines.map((l) => (l === "" ? l : prefix + l));

/** Lines with the leading blanks `from` taken off. */
function dedentLines(lines: string[], from: string, strict = true): string[] {
  return lines.map((l) => {
    if (l.startsWith(from)) return l.slice(from.length);
    if (strict && l.trim() !== "") {
      throw bad(
        "the indentation of the text is irregular (a line is indented less than its block); it is left alone",
      );
    }
    return l.replace(/^[ \t]+/, "");
  });
}

/** One hunk of a unified diff (common head and tail trimmed), capped. */
function unifiedDiff(a: string, b: string, label: string, context = 3, cap = 160): string {
  if (a === b) return "";
  const lines = (s: string): string[] => {
    if (s === "") return [];
    const l = splitLines(s);
    if (l[l.length - 1] === "") l.pop();
    return l;
  };
  const al = lines(a);
  const bl = lines(b);
  let p = 0;
  while (p < al.length && p < bl.length && al[p] === bl[p]) p++;
  let s = 0;
  while (s < al.length - p && s < bl.length - p && al[al.length - 1 - s] === bl[bl.length - 1 - s])
    s++;
  // Edit script of the middle part: a longest common subsequence while it is small, else all out and all in.
  const am = al.slice(p, al.length - s);
  const bm = bl.slice(p, bl.length - s);
  type Op = { t: " " | "-" | "+"; l: string };
  const ops: Op[] = al.slice(0, p).map((l) => ({ t: " ", l }));
  if (am.length * bm.length <= 4_000_000) {
    const w = bm.length + 1;
    const dp = new Uint32Array((am.length + 1) * w);
    for (let i = am.length - 1; i >= 0; i--) {
      for (let j = bm.length - 1; j >= 0; j--) {
        dp[i * w + j] =
          am[i] === bm[j]
            ? dp[(i + 1) * w + j + 1] + 1
            : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < am.length || j < bm.length) {
      if (i < am.length && j < bm.length && am[i] === bm[j]) {
        ops.push({ t: " ", l: am[i] });
        i++;
        j++;
      } else if (j >= bm.length || (i < am.length && dp[(i + 1) * w + j] >= dp[i * w + j + 1])) {
        ops.push({ t: "-", l: am[i++] });
      } else ops.push({ t: "+", l: bm[j++] });
    }
  } else {
    for (const l of am) ops.push({ t: "-", l });
    for (const l of bm) ops.push({ t: "+", l });
  }
  for (const l of al.slice(al.length - s)) ops.push({ t: " ", l });
  // Hunks: every change with `context` lines around it, merged when they touch.
  const keep = new Array<boolean>(ops.length).fill(false);
  ops.forEach((o, k) => {
    if (o.t === " ") return;
    for (let x = Math.max(0, k - context); x <= Math.min(ops.length - 1, k + context); x++)
      keep[x] = true;
  });
  const out: string[] = [`--- a/${label}`, `+++ b/${label}`];
  let aLine = 1;
  let bLine = 1;
  let k = 0;
  let body = 0;
  while (k < ops.length) {
    if (!keep[k]) {
      if (ops[k].t !== "+") aLine++;
      if (ops[k].t !== "-") bLine++;
      k++;
      continue;
    }
    let e = k;
    while (e < ops.length && keep[e]) e++;
    const hunk = ops.slice(k, e);
    const ca = hunk.filter((o) => o.t !== "+").length;
    const cb = hunk.filter((o) => o.t !== "-").length;
    out.push(`@@ -${ca === 0 ? aLine - 1 : aLine},${ca} +${cb === 0 ? bLine - 1 : bLine},${cb} @@`);
    for (const o of hunk) {
      if (body++ < cap) out.push(`${o.t}${o.l}`);
    }
    aLine += ca;
    bLine += cb;
    k = e;
  }
  if (body > cap) out.push(`... ${body - cap} more lines`);
  return out.join("\n");
}

// ── The widget model ─────────────────────────────────────────────────────────

interface Widget {
  obj: CstObject;
  parent: Widget | null;
  /** The header-less `{ ... }` block that holds the children. */
  block: CstObject | null;
  kids: Widget[];
  /** Position among the parent's children. */
  index: number;
  /** `root`, `0`, `0/2`: the child indexes from the root. */
  path: string;
}

interface Model {
  root: Widget;
  all: Widget[];
  /** Entries in a children block, or blocks, that are not widgets. */
  strays: number;
}

function buildModel(doc: CstDocument): Model {
  const tops = doc.root.children;
  const top = tops[0];
  if (tops.length !== 1 || top.kind !== "object" || top.key === "") {
    throw bad("the file is not one root widget block");
  }
  const all: Widget[] = [];
  const st = { strays: 0 };
  const make = (obj: CstObject, parent: Widget | null, index: number, path: string): Widget => {
    const w: Widget = { obj, parent, block: null, kids: [], index, path };
    all.push(w);
    const blocks = obj.children.filter((c): c is CstObject => c.kind === "object" && c.key === "");
    if (blocks.length > 1) st.strays++;
    w.block = blocks[0] ?? null;
    for (const c of w.block?.children ?? []) {
      if (c.kind !== "object" || c.key === "") {
        st.strays++;
        continue;
      }
      const n = w.kids.length;
      w.kids.push(make(c, w, n, path === "root" ? String(n) : `${path}/${n}`));
    }
    return w;
  };
  const root = make(top, null, 0, "root");
  return { root, all, strays: st.strays };
}

const scalarOf = (w: Widget, key: string): CstScalar | undefined =>
  w.obj.children.find((c): c is CstScalar => c.kind === "scalar" && c.key === key);

const nameOf = (w: Widget): string | undefined => {
  const s = scalarOf(w, "Name");
  return s && s.values[0] ? tokenValue(s.values[0]) : undefined;
};

const guidOf = (obj: CstObject): string | undefined => {
  for (const t of obj.head) {
    const m = t.kind === "string" ? GUID_TOKEN.exec(t.text) : null;
    if (m) return m[1].toUpperCase();
  }
  return undefined;
};

const blockOf = (obj: CstObject, key: string): CstObject | undefined =>
  obj.children.find((c): c is CstObject => c.kind === "object" && c.key === key);

const slotOf = (w: Widget): CstObject | undefined => blockOf(w.obj, "Slot");

const slotClassOf = (w: Widget): string | undefined => slotOf(w)?.head[1]?.text;

const isWithin = (w: Widget, ancestor: Widget): boolean => {
  for (let c: Widget | null = w; c; c = c.parent) if (c === ancestor) return true;
  return false;
};

/** The CST path (`[5][0]`) of a widget from the document base. */
function cstPathOf(w: Widget): string {
  const steps: string[] = [];
  for (let c = w; c.parent; c = c.parent) {
    steps.unshift(`[${c.parent.obj.children.indexOf(c.parent.block as CstObject)}][${c.index}]`);
  }
  return steps.join("");
}

function findWidget(model: Model, ref: string | undefined, what = "widget"): Widget {
  const r = (ref ?? "root").trim();
  if (r === "" || r.toLowerCase() === "root") return model.root;
  // A GUID first: 16 decimal digits are also a legal (if absurd) index path.
  const g = GUID_ARG.exec(r);
  if (g) {
    const hit = model.all.find((w) => guidOf(w.obj) === g[1].toUpperCase());
    if (hit) return hit;
  }
  if (/^\d+(\/\d+)*$/.test(r)) {
    let cur = model.root;
    for (const part of r.split("/")) {
      const next = cur.kids[Number(part)];
      if (!next) {
        throw new LayoutError(
          "PATH_NOT_FOUND",
          `${what} ${r}: ${cur.path} has ${cur.kids.length} child widget(s), none at ${part}`,
        );
      }
      cur = next;
    }
    return cur;
  }
  const named = model.all.filter((w) => nameOf(w) === r);
  if (named.length === 1) return named[0];
  if (named.length > 1) {
    throw bad(
      `${what} name "${r}" matches ${named.length} widgets (${named.map((w) => w.path).join(", ")}): use a path`,
    );
  }
  const names = model.all.map(nameOf).filter((n): n is string => n !== undefined);
  throw new LayoutError(
    "PATH_NOT_FOUND",
    `${what} "${r}" is not root, a child path, a GUID or a Name (names: ${names.slice(0, 20).join(", ") || "none"}${names.length > 20 ? ", ..." : ""})`,
  );
}

const rawOf = (text: string, s: CstScalar): string =>
  s.values.length ? text.slice(s.values[0].start, s.values[s.values.length - 1].end) : "";

function outlineLine(w: Widget, depth: number): string {
  const name = nameOf(w);
  const base = w.obj.base[0] ? ` : ${tokenValue(w.obj.base[0])}` : "";
  const slot = slotClassOf(w);
  return `${"  ".repeat(depth)}[${w.path}] ${w.obj.key}${base}${name !== undefined ? ` "${name}"` : ""}${slot ? ` slot=${slot}` : ""}`;
}

// ── Source and context ───────────────────────────────────────────────────────

interface Ctx {
  rel: string;
  /** Absolute file path; undefined for a game resource. */
  file?: string;
  root?: string;
  buf: Buffer;
  doc: CstDocument;
  model: Model;
  eol: string;
  unit: string;
  seed: string;
}

function vfsOf(config: Config): PakVirtualFS | null {
  try {
    return config.gamePath ? PakVirtualFS.get(config.gamePath) : null;
  } catch {
    return null;
  }
}

/** A project-relative resource path from an absolute path inside the root, a resource name or a relative path. */
function relativePath(raw: string, root: string | undefined, label: string): string {
  let p = raw.trim();
  if (p.startsWith("-")) throw bad(`${label}: paths starting with '-' are refused`);
  if (p.startsWith("path:")) p = p.slice(5);
  p = p.replace(/^\{[0-9A-Fa-f]{16}\}/, "");
  try {
    if (isAbsolute(p)) {
      if (!root || !isPathInsideRoot(p, root)) {
        throw new LayoutError(
          "ABSOLUTE_PATH",
          `${label}: ${p} is outside the project; use a project-relative path`,
        );
      }
      return checkRelativePath(relative(root, p).replace(/\\/g, "/"));
    }
    return checkRelativePath(p);
  } catch (e) {
    if (e instanceof VocabularyError) throw new LayoutError(e.code, e.message);
    throw e;
  }
}

function insideFile(root: string, rel: string, label: string): string {
  const abs = resolve(root, rel);
  if (!isPathInsideRoot(abs, root)) {
    throw new LayoutError("ABSOLUTE_PATH", `${label} resolves outside the project: ${abs}`);
  }
  return abs;
}

function eolOf(doc: CstDocument): string {
  return doc.tokens.find((t) => t.kind === "eol")?.text ?? "\n";
}

function unitOf(doc: CstDocument): string {
  const first = doc.root.children[0];
  const inner = first && first.kind === "object" ? first.children[0] : undefined;
  const ind = inner ? indentAt(doc.text, inner.start) : undefined;
  return ind?.includes("\t") ? "\t" : " ";
}

function loadCtx(a: LayoutEditArgs, config: Config, forWrite: boolean): Ctx {
  const root = pinnedProjectRoot(a.projectPath, config.projectPath);
  const rel = relativePath(a.path, root, "path");
  if (!rel.toLowerCase().endsWith(".layout")) throw bad(`path ${rel} is not a .layout file`);
  let file: string | undefined;
  let buf: Buffer | undefined;
  if (root) {
    const abs = insideFile(root, rel, "path");
    if (existsSync(abs) && statSync(abs).isFile()) {
      file = abs;
      buf = readFileSync(abs);
    }
  }
  if (!buf) {
    if (forWrite) {
      throw new LayoutError(
        root ? "PATH_NOT_FOUND" : "NOT_IN_PROJECT",
        root
          ? `${rel} does not exist under ${root}`
          : "no project path configured (ENFUSION_PROJECT_PATH or projectPath)",
        "A write needs a file that exists in the project; a game resource is copied in first (game_duplicate).",
      );
    }
    const vfs = vfsOf(config);
    if (vfs?.exists(rel)) buf = vfs.readFile(rel);
    else {
      throw new LayoutError(
        "PATH_NOT_FOUND",
        `no layout at ${rel}: not a file${root ? ` under ${root}` : ""} and not in the game data` +
          (vfs ? "" : " (game paks not available: ENFUSION_GAME_PATH)"),
      );
    }
  }
  const doc = parseCstBytes(buf);
  if (forWrite) {
    if (!doc.toBytes().equals(buf)) {
      throw bad(
        `${rel} has content this writer would not reproduce byte for byte; it is left alone. Edit it in the Resource Manager.`,
      );
    }
    if (doc.diagnostics.length) {
      throw bad(
        `${rel} does not parse cleanly (${doc.diagnostics[0].message}, line ${doc.diagnostics[0].line}); it is left alone.`,
      );
    }
  }
  const model = buildModel(doc);
  if (forWrite && model.strays > 0) {
    throw bad(`${rel} has entries in a children block that are not widgets; it is left alone.`);
  }
  const { action: _action, path: _path, confirm: _confirm, ...rest } = a;
  return {
    rel,
    file,
    root,
    buf,
    doc,
    model,
    eol: eolOf(doc),
    unit: unitOf(doc),
    seed: sha256(`${sha256(buf)}|${a.action}|${JSON.stringify(rest)}`),
  };
}

// ── GUIDs and names ──────────────────────────────────────────────────────────

function takenGuids(doc: CstDocument): Set<string> {
  const out = new Set<string>();
  for (const t of doc.tokens) {
    const m = t.kind === "string" ? GUID_TOKEN.exec(t.text) : null;
    if (m) out.add(m[1].toUpperCase());
  }
  return out;
}

/** GUIDs that depend only on the file and the request, so a dry run and its confirm agree. */
function guidFactory(ctx: Ctx): () => string {
  const taken = takenGuids(ctx.doc);
  let n = 0;
  return () => {
    for (;;) {
      const g = sha256(`${ctx.seed}|${n++}`).slice(0, 16).toUpperCase();
      if (!taken.has(g)) {
        taken.add(g);
        return g;
      }
    }
  };
}

const namesIn = (model: Model): Set<string> =>
  new Set(model.all.map(nameOf).filter((n): n is string => n !== undefined));

// ── Fragments ────────────────────────────────────────────────────────────────

/** An object as lines at indent zero (one space per level in the formatter, turned into `unit`). */
function fmtLines(spec: ObjectSpec, unit: string): string[] {
  const d = new CstDocument("");
  d.createObject("", spec);
  return d.text.split("\n").map((l) => l.replace(/^ +/, (m) => unit.repeat(m.length)));
}

function entriesOf(props: Record<string, PropValue> | undefined): EntrySpec[] {
  return Object.entries(props ?? {}).map(([key, value]) => {
    const bareBool = typeof value === "string" && /^(True|False)$/.test(value);
    return bareBool ? { key, value, quoted: false } : { key, value };
  });
}

/** Lines of a span of the text, from its first line start, dedented to zero. */
function blockLines(ctx: Ctx, start: number, end: number, strict = true): string[] {
  const t = ctx.doc.text;
  const ls = lineStartOf(t, start);
  const ind = indentAt(t, start) ?? "";
  let stop = end;
  while (stop < t.length && t[stop] !== "\n" && t[stop] !== "\r") stop++;
  return dedentLines(splitLines(t.slice(ls, stop)), ind, strict);
}

/** A widget's lines at indent zero. */
const widgetLines = (ctx: Ctx, w: Widget, strict = true): string[] =>
  blockLines(ctx, w.obj.start, w.obj.end, strict);

function requireOwnLines(ctx: Ctx, w: Widget, what: string): [number, number] {
  const sp = lineSpan(ctx.doc.text, w.obj.start, w.obj.end);
  if (!sp) throw bad(`${what} ${w.path} shares a line with other text; it is left alone`);
  return sp;
}

/**
 * Inserts lines (indent zero) as a child of `parent`, before `anchor` or at
 * the end. Returns the new text and where the insertion started.
 */
function insertKid(
  ctx: Ctx,
  parent: Widget,
  anchor: Widget | null,
  lines: string[],
): { text: string; at: number; len: number } {
  const t = ctx.doc.text;
  const { eol, unit } = ctx;
  const parentIndent = indentAt(t, parent.obj.start);
  if (parentIndent === undefined)
    throw bad(`widget ${parent.path} shares a line; it is left alone`);
  const put = (at: number, s: string) => ({
    text: t.slice(0, at) + s + t.slice(at),
    at,
    len: s.length,
  });
  if (parent.kids.length > 0) {
    const ind = indentAt(t, parent.kids[0].obj.start);
    if (ind === undefined)
      throw bad(`child widgets of ${parent.path} share lines; it is left alone`);
    const body = indentLines(lines, ind).join(eol) + eol;
    if (anchor) return put(lineStartOf(t, anchor.obj.start), body);
    const sp = requireOwnLines(ctx, parent.kids[parent.kids.length - 1], "widget");
    return put(sp[1], body);
  }
  const blockIndent = parentIndent + unit;
  const body = indentLines(lines, blockIndent + unit).join(eol) + eol;
  if (parent.block) {
    const close = parent.block.close;
    if (
      !close ||
      indentAt(t, close.start) === undefined ||
      lineStartOf(t, close.start) <= parent.block.open.start
    ) {
      throw bad(`the children block of ${parent.path} is on one line; it is left alone`);
    }
    return put(lineStartOf(t, close.start), body);
  }
  const close = parent.obj.close;
  if (
    !close ||
    indentAt(t, close.start) === undefined ||
    lineStartOf(t, close.start) <= parent.obj.open.start
  ) {
    throw bad(`widget ${parent.path} is on one line; it is left alone`);
  }
  return put(lineStartOf(t, close.start), `${blockIndent}{${eol}${body}${blockIndent}}${eol}`);
}

/** Removes a widget (and its children block when it was the only child). Returns the new text. */
function removeKid(ctx: Ctx, w: Widget): string {
  const t = ctx.doc.text;
  const p = w.parent as Widget;
  if (p.block && p.kids.length === 1 && p.block.children.length === 1) {
    const sp = lineSpan(t, p.block.start, p.block.end);
    if (sp) return t.slice(0, sp[0]) + t.slice(sp[1]);
  }
  const sp = requireOwnLines(ctx, w, "widget");
  return t.slice(0, sp[0]) + t.slice(sp[1]);
}

/** Parses a widget block given as text (indent zero or any), for `addWidget text`. */
function parseFragment(text: string): { lines: string[]; guids: string[]; names: string[] } {
  const frag = new CstDocument(text);
  let model: Model;
  try {
    model = buildModel(frag);
  } catch {
    throw bad("text is not one widget block");
  }
  if (frag.diagnostics.length || model.strays)
    throw bad("text does not parse cleanly as a widget block");
  if (!/WidgetClass$/.test(model.root.obj.key))
    throw bad(`text does not start with a widget class: ${model.root.obj.key}`);
  const first = model.root.obj;
  const lines = dedentLines(
    splitLines(frag.text.slice(lineStartOf(frag.text, first.start), first.end)),
    indentAt(frag.text, first.start) ?? "",
    false,
  );
  const guids: string[] = [];
  const walk = (o: CstObject) => {
    const g = guidOf(o);
    if (g) guids.push(g);
    for (const c of o.children) if (c.kind === "object") walk(c);
  };
  walk(first);
  return {
    lines,
    guids,
    names: model.all.map(nameOf).filter((n): n is string => n !== undefined),
  };
}

// ── Plans ────────────────────────────────────────────────────────────────────

interface Plan {
  text: string;
  changed: Change[];
  next?: string;
  warnings: string[];
  /** Path of the widget to outline afterwards. */
  focus?: string;
}

function checkClass(cls: string, what: string): void {
  if (!IDENT.test(cls) || !cls.endsWith("WidgetClass")) {
    throw bad(`${what} must be a widget class such as FrameWidgetClass, got ${cls}`);
  }
}

function widgetSpec(
  cls: string,
  guid: () => string,
  a: { name?: string; base?: string; props?: Record<string, PropValue>; slot?: SlotArg },
  parent: Widget,
  warnings: string[],
): ObjectSpec {
  const entries: EntrySpec[] = [];
  if (a.name !== undefined) entries.push({ key: "Name", value: a.name });
  let slotClass = a.slot?.class;
  if (slotClass === undefined) {
    slotClass =
      SLOT_OF_PARENT[parent.obj.key] ?? parent.kids.map(slotClassOf).find((c) => c !== undefined);
  }
  if (slotClass !== undefined) {
    entries.push({
      object: {
        key: "Slot",
        className: slotClass,
        guid: guid(),
        entries: entriesOf(a.slot?.props),
      },
    });
    const known = SLOT_KEYS[slotClass];
    for (const k of Object.keys(a.slot?.props ?? {})) {
      if (known && !known.includes(k))
        warnings.push(`slot property ${k} is not seen on ${slotClass} in vanilla layouts`);
    }
  } else {
    warnings.push(
      `no slot written: ${parent.obj.key} is not a container class of the vanilla layouts; pass slot.class to add one`,
    );
  }
  entries.push(...entriesOf(a.props));
  return { key: cls, guid: guid(), base: a.base, entries };
}

function planAdd(ctx: Ctx, a: LayoutEditArgs): Plan {
  const parent = findWidget(ctx.model, a.parent, "parent");
  const warnings: string[] = [];
  const kids = parent.kids;
  const at = a.index ?? kids.length;
  if (!Number.isInteger(at) || at < 0 || at > kids.length) {
    throw bad(
      `index ${a.index} is out of range: ${parent.path} has ${kids.length} child widget(s)`,
    );
  }
  if (LEAF_CLASSES.has(parent.obj.key)) {
    warnings.push(`${parent.obj.key} carries no children in any vanilla layout`);
  }
  const taken = namesIn(ctx.model);
  let lines: string[];
  if (a.text !== undefined) {
    if (a.widgetClass !== undefined) throw bad("give text or widgetClass, not both");
    const frag = parseFragment(a.text);
    const guids = takenGuids(ctx.doc);
    const clash = frag.guids.filter((g) => guids.has(g));
    if (clash.length) {
      throw bad(
        `text reuses GUID(s) already in the file (${clash.join(", ")}); duplicateWidget makes a copy with fresh ones`,
      );
    }
    const dup = frag.names.filter((n) => taken.has(n));
    if (dup.length)
      throw bad(`text reuses widget name(s) already in the file: ${[...new Set(dup)].join(", ")}`);
    lines = frag.lines;
  } else {
    if (!a.widgetClass) throw bad("addWidget needs widgetClass (or text)");
    checkClass(a.widgetClass, "widgetClass");
    if (a.name !== undefined && taken.has(a.name))
      throw bad(`a widget named "${a.name}" exists already`);
    if (a.name === "") throw bad("name must not be empty");
    if (a.base !== undefined && !a.base.trim()) throw bad("base must not be empty");
    const spec = widgetSpec(a.widgetClass, guidFactory(ctx), a, parent, warnings);
    lines = fmtLines(spec, ctx.unit);
  }
  const ins = insertKid(ctx, parent, kids[at] ?? null, lines);
  const newPath = parent.path === "root" ? String(at) : `${parent.path}/${at}`;
  return {
    text: ins.text,
    changed: [{ path: `widget ${newPath}`, before: null, after: lines.join("\n") }],
    next: `inverse: removeWidget widget=${newPath}`,
    warnings,
    focus: newPath,
  };
}

function planRemove(ctx: Ctx, a: LayoutEditArgs): Plan {
  const w = findWidget(ctx.model, a.widget, "widget");
  if (!w.parent) throw bad("the root widget cannot be removed");
  const lines = widgetLines(ctx, w, false); // for the readback only
  const parent = w.parent;
  const warnings: string[] = [];
  if (w.kids.length)
    warnings.push(`${w.kids.length} child widget(s) go with it (and their descendants)`);
  return {
    text: removeKid(ctx, w),
    changed: [{ path: `widget ${w.path}`, before: lines.join("\n"), after: null }],
    next: `inverse: addWidget parent=${parent.path} index=${w.index} text=<the before text>`,
    warnings,
    focus: parent.path,
  };
}

function planMove(ctx: Ctx, a: LayoutEditArgs): Plan {
  const w = findWidget(ctx.model, a.widget, "widget");
  if (!w.parent) throw bad("the root widget cannot be moved");
  const target = findWidget(ctx.model, a.parent, "parent");
  if (isWithin(target, w)) throw bad(`cannot move ${w.path} under itself (${target.path})`);
  const sibs = target.kids.filter((k) => k !== w);
  const at = a.index ?? sibs.length;
  if (!Number.isInteger(at) || at < 0 || at > sibs.length) {
    throw bad(
      `index ${a.index} is out of range: ${target.path} would hold ${sibs.length} other child widget(s)`,
    );
  }
  const warnings: string[] = [];
  if (LEAF_CLASSES.has(target.obj.key))
    warnings.push(`${target.obj.key} carries no children in any vanilla layout`);
  const want = SLOT_OF_PARENT[target.obj.key];
  const have = slotClassOf(w);
  if (want && have && want !== have) {
    warnings.push(
      `the widget keeps its ${have} slot, but children of ${target.obj.key} carry ${want} in vanilla layouts; convert or setProperty to adjust`,
    );
  }
  const before = { parent: w.parent.path, index: w.index };
  const lines = widgetLines(ctx, w);
  const ins = insertKid(ctx, target, sibs[at] ?? null, lines);
  // Stage two removes the original, found again by its offset (shifted by the insertion before it).
  const doc1 = new CstDocument(ins.text, ctx.doc.encoding);
  const model1 = buildModel(doc1);
  const start1 = ins.at <= w.obj.start ? w.obj.start + ins.len : w.obj.start;
  const old1 = model1.all.find((x) => x.obj.start === start1);
  if (!old1) throw bad("internal: the widget moved out of sight during the edit");
  const text = removeKid({ ...ctx, doc: doc1, model: model1 }, old1);
  return {
    text,
    changed: [
      {
        path: `widget ${w.path}`,
        before: { parent: before.parent, index: before.index },
        after: { parent: target.path, index: at },
      },
    ],
    next: `inverse: moveWidget widget=<its new path> parent=${before.parent} index=${before.index} (paths shift after a move: read first)`,
    warnings,
    focus: target.path,
  };
}

/** Replaces every GUID header token of a fragment's objects and renames colliding Names. */
function copyFragment(
  ctx: Ctx,
  w: Widget,
  guid: () => string,
  newName: string | undefined,
): { lines: string[]; renamed: string[] } {
  const frag = new CstDocument(widgetLines(ctx, w).join("\n"));
  const first = frag.root.children[0] as CstObject;
  const edits: Splice[] = [];
  const names = namesIn(ctx.model);
  const renamed: string[] = [];
  const uniq = (n: string): string => {
    let c = `${n}_copy`;
    for (let i = 2; names.has(c); i++) c = `${n}_copy${i}`;
    names.add(c);
    return c;
  };
  // Every object header GUID: widgets, their Slot blocks and their components.
  const regen = (o: CstObject) => {
    for (const t of o.head) {
      if (t.kind === "string" && GUID_TOKEN.test(t.text))
        edits.push({ s: t.start, e: t.end, t: `"{${guid()}}"` });
    }
    for (const c of o.children) if (c.kind === "object") regen(c);
  };
  regen(first);
  const walk = (o: CstObject, top: boolean) => {
    const nm = o.children.find((c): c is CstScalar => c.kind === "scalar" && c.key === "Name");
    const tok = nm?.values[0];
    if (tok) {
      const cur = tokenValue(tok);
      let next: string | undefined;
      if (top && newName !== undefined) next = newName;
      else if (names.has(cur)) next = uniq(cur);
      if (next !== undefined) {
        if (top && newName !== undefined) names.add(newName);
        edits.push({ s: tok.start, e: tok.end, t: tok.kind === "string" ? `"${next}"` : next });
        renamed.push(`${cur} -> ${next}`);
      }
    }
    for (const c of o.children) {
      if (c.kind === "object" && c.key === "") {
        for (const k of c.children) if (k.kind === "object") walk(k, false);
      }
    }
  };
  walk(first, true);
  return { lines: splitLines(applySplices(frag.text, edits)), renamed };
}

function planDuplicate(ctx: Ctx, a: LayoutEditArgs): Plan {
  const w = findWidget(ctx.model, a.widget, "widget");
  if (!w.parent) throw bad("the root widget cannot be duplicated");
  const parent = w.parent;
  if (a.name !== undefined && namesIn(ctx.model).has(a.name))
    throw bad(`a widget named "${a.name}" exists already`);
  const at = a.index ?? w.index + 1;
  if (!Number.isInteger(at) || at < 0 || at > parent.kids.length) {
    throw bad(
      `index ${a.index} is out of range: ${parent.path} has ${parent.kids.length} child widget(s)`,
    );
  }
  const { lines, renamed } = copyFragment(ctx, w, guidFactory(ctx), a.name);
  const ins = insertKid(ctx, parent, parent.kids[at] ?? null, lines);
  const newPath = parent.path === "root" ? String(at) : `${parent.path}/${at}`;
  return {
    text: ins.text,
    changed: [{ path: `widget ${newPath}`, before: null, after: lines.join("\n") }],
    next: `inverse: removeWidget widget=${newPath}`,
    warnings: [
      "every GUID in the copy is new",
      ...(renamed.length ? [`names made unique: ${renamed.join(", ")}`] : []),
    ],
    focus: newPath,
  };
}

function planWrap(ctx: Ctx, a: LayoutEditArgs): Plan {
  const w = findWidget(ctx.model, a.widget, "widget");
  if (!w.parent) throw bad("the root widget cannot be wrapped or unwrapped");
  const t = ctx.doc.text;
  const { unit } = ctx;
  const own = requireOwnLines(ctx, w, "widget");
  const ind = indentAt(t, w.obj.start) ?? "";
  const lines = widgetLines(ctx, w);
  const startLine = splitLines(t.slice(0, w.obj.start)).length - 1;
  const slot = slotOf(w);
  const slotRange = slot
    ? ((): [number, number] | undefined => {
        const sp = lineSpan(t, slot.start, slot.end);
        if (!sp) return undefined;
        const first = splitLines(t.slice(0, slot.start)).length - 1 - startLine;
        return [
          first,
          first + splitLines(t.slice(sp[0], sp[1]).replace(/(\r\n|\n|\r)$/, "")).length,
        ];
      })()
    : undefined;
  if (slot && !slotRange) throw bad(`the Slot block of ${w.path} shares lines; it is left alone`);
  const place = (newLines: string[]): string =>
    t.slice(0, own[0]) + indentLines(newLines, ind).join(ctx.eol) + ctx.eol + t.slice(own[1]);
  const warnings: string[] = [];

  if (a.unwrap) {
    if (a.wrapper !== undefined) throw bad("unwrap takes no wrapper class");
    if (w.kids.length !== 1)
      throw bad(
        `unwrap needs a wrapper with exactly one child widget, ${w.path} has ${w.kids.length}`,
      );
    const extra = w.obj.children
      .filter((c) => c !== w.block && c !== slot)
      .map((c) => (c.kind === "scalar" || c.kind === "object" ? c.key : "entry"))
      .filter((k) => k !== "Name");
    if (extra.length)
      throw bad(`${w.path} carries ${extra.join(", ")}: remove those first, then unwrap`);
    const kid = w.kids[0];
    const kLines = widgetLines(ctx, kid);
    const kSlot = slotOf(kid);
    const kStart = splitLines(t.slice(0, kid.obj.start)).length - 1;
    let out = kLines;
    if (slot && kSlot) {
      const sp = lineSpan(t, kSlot.start, kSlot.end);
      if (!sp) throw bad(`the Slot block of ${kid.path} shares lines; it is left alone`);
      const first = splitLines(t.slice(0, kSlot.start)).length - 1 - kStart;
      const count = splitLines(t.slice(sp[0], sp[1]).replace(/(\r\n|\n|\r)$/, "")).length;
      const wSlot = indentLines(blockLines(ctx, slot.start, slot.end), unit);
      out = [...kLines.slice(0, first), ...wSlot, ...kLines.slice(first + count)];
    } else if (slot) {
      warnings.push(`${kid.path} had no Slot: the wrapper's one is dropped`);
    }
    return {
      text: place(out),
      changed: [{ path: `widget ${w.path}`, before: lines.join("\n"), after: out.join("\n") }],
      next: `inverse: wrap widget=${w.path} wrapper=${w.obj.key}`,
      warnings,
      focus: w.parent.path,
    };
  }

  if (!a.wrapper) throw bad("wrap needs wrapper (a container widget class), or unwrap: true");
  checkClass(a.wrapper, "wrapper");
  const childSlot = SLOT_OF_PARENT[a.wrapper];
  if (!childSlot) {
    throw bad(
      `${a.wrapper} is not a container class of the vanilla layouts (${Object.keys(SLOT_OF_PARENT).join(", ")})`,
    );
  }
  if (a.name !== undefined && namesIn(ctx.model).has(a.name))
    throw bad(`a widget named "${a.name}" exists already`);
  const guid = guidFactory(ctx);
  const wrapperLines = fmtLines(
    {
      key: a.wrapper,
      guid: guid(),
      entries: a.name !== undefined ? [{ key: "Name", value: a.name }] : [],
    },
    unit,
  );
  const newSlot = fmtLines({ key: "Slot", className: childSlot, guid: guid() }, unit);
  let kidLines = lines;
  if (slot && slotRange) {
    kidLines = [
      ...lines.slice(0, slotRange[0]),
      ...indentLines(newSlot, unit),
      ...lines.slice(slotRange[1]),
    ];
  } else {
    warnings.push(`${w.path} had no Slot: neither the wrapper nor the widget got one`);
  }
  const wrapperSlot = slot ? blockLines(ctx, slot.start, slot.end) : [];
  // wrapper: header, Name, its Slot (the widget's own, so the parent sees the same geometry), children block, close.
  const head = wrapperLines.slice(0, wrapperLines.length - 1);
  const out = [
    ...head,
    ...indentLines(wrapperSlot, unit),
    `${unit}{`,
    ...indentLines(kidLines, unit + unit),
    `${unit}}`,
    wrapperLines[wrapperLines.length - 1],
  ];
  warnings.push(
    `${w.path} now sits in the wrapper with an empty ${childSlot} slot (engine defaults): set its geometry with setProperty`,
  );
  return {
    text: place(out),
    changed: [{ path: `widget ${w.path}`, before: lines.join("\n"), after: out.join("\n") }],
    next: `inverse: wrap widget=${w.path} unwrap=true (the wrapper is at the same path; the widget moves to ${w.path}/0)`,
    warnings,
    focus: w.path,
  };
}

function planConvert(ctx: Ctx, a: LayoutEditArgs): Plan {
  const w = findWidget(ctx.model, a.widget, "widget");
  if (!a.toClass) throw bad("convert needs toClass");
  checkClass(a.toClass, "toClass");
  if (a.toClass === w.obj.key) throw bad(`${w.path} is a ${a.toClass} already`);
  if (w.obj.base.length) {
    throw bad(
      `${w.path} instances a base layout (${tokenValue(w.obj.base[0])}): its class comes from the base`,
    );
  }
  const childSlot = SLOT_OF_PARENT[a.toClass];
  if (w.kids.length && !childSlot) {
    throw bad(
      `${a.toClass} is not a container class of the vanilla layouts, and ${w.path} has ${w.kids.length} child widget(s)`,
    );
  }
  const t = ctx.doc.text;
  const edits: Splice[] = [{ s: w.obj.head[0].start, e: w.obj.head[0].end, t: a.toClass }];
  const changed: Change[] = [
    { path: `widget ${w.path}.class`, before: w.obj.key, after: a.toClass },
  ];
  const warnings: string[] = [
    "properties of the old class stay as written; check them in the Resource Manager",
  ];
  if (childSlot) {
    for (const kid of w.kids) {
      const s = slotOf(kid);
      const cur = slotClassOf(kid);
      if (!s || !cur || cur === childSlot) continue;
      edits.push({ s: s.head[1].start, e: s.head[1].end, t: childSlot });
      changed.push({ path: `widget ${kid.path}.Slot.class`, before: cur, after: childSlot });
      const keep = SLOT_KEYS[childSlot];
      for (const c of s.children) {
        if (c.kind !== "scalar" || !keep || keep.includes(c.key)) continue;
        const sp = lineSpan(t, c.start, c.end);
        if (!sp) throw bad(`slot property ${c.key} of ${kid.path} shares a line; it is left alone`);
        edits.push({ s: sp[0], e: sp[1], t: "" });
        changed.push({
          path: `widget ${kid.path}.Slot.${c.key}`,
          before: rawOf(t, c),
          after: null,
        });
      }
    }
  }
  return {
    text: applySplices(t, edits),
    changed,
    next: `inverse: convert widget=${w.path} toClass=${w.obj.key} (slot properties dropped above are not restored: setProperty them back from the before values)`,
    warnings,
    focus: w.path,
  };
}

function planSetProperty(ctx: Ctx, a: LayoutEditArgs): Plan {
  const w = findWidget(ctx.model, a.widget, "widget");
  if (!a.property)
    throw bad("setProperty needs property (Name, Slot.PositionX, components.SCR_X.m_sKey)");
  if (a.property.startsWith("[")) throw bad("property starts with a name, not an index");
  if (a.value === undefined) throw bad("setProperty needs value (null removes the property)");
  const segs = parsePath(a.property);
  if (segs[0].name === undefined || segs[0].name === "") throw bad("property starts with a name");
  const prefix = cstPathOf(w);
  const full = prefix ? `${prefix}.${a.property}` : a.property;
  const work = new CstDocument(ctx.doc.text, ctx.doc.encoding);
  let before: string | null = null;
  let existing: ReturnType<CstDocument["get"]> | undefined;
  try {
    existing = work.get(full);
    before =
      existing.kind === "object"
        ? `{ ${existing.count} entries }`
        : existing.kind === "opaque"
          ? existing.raw
          : existing.raw;
  } catch (e) {
    if (!(e instanceof CstEditError) || e.code !== "PATH_NOT_FOUND") throw e;
  }
  const warnings: string[] = [];
  let after: string | null;
  if (a.value === null) {
    if (existing === undefined)
      throw new LayoutError("PATH_NOT_FOUND", `${a.property} of ${w.path} is not set`);
    work.delete(full);
    after = null;
  } else {
    if (a.property === "Name" && a.value !== nameOf(w)) {
      if (typeof a.value !== "string" || a.value === "")
        throw bad("Name must be a non-empty string");
      const other = ctx.model.all.find((x) => nameOf(x) === a.value);
      if (other) throw bad(`a widget named "${a.value}" exists already (${other.path})`);
    }
    let value: PropValue = a.value;
    let quoted = a.quoted;
    if (
      existing &&
      (existing.kind === "scalar" || existing.kind === "value") &&
      existing.values.length === 1 &&
      !existing.quoted[0] &&
      /^(True|False)$/.test(existing.values[0]) &&
      typeof value === "boolean"
    ) {
      value = value ? "True" : "False";
      quoted = false;
    } else if (
      !existing &&
      typeof value === "string" &&
      /^(True|False)$/.test(value) &&
      quoted === undefined
    ) {
      quoted = false;
    }
    if (existing === undefined && segs.length === 1 && w.block) {
      work.arrayAdd(prefix, { key: segs[0].name, value, quoted }, w.obj.children.indexOf(w.block));
    } else {
      work.set(full, value, { quoted });
    }
    const got = work.get(full);
    after = got.kind === "object" ? null : got.raw;
    if (segs.length === 2 && segs[0].name === "Slot") {
      const cls = slotClassOf(w);
      const known = cls ? SLOT_KEYS[cls] : undefined;
      if (known && segs[1].name !== undefined && !known.includes(segs[1].name)) {
        warnings.push(`${segs[1].name} is not seen on ${cls} in vanilla layouts`);
      }
    }
  }
  return {
    text: work.text,
    changed: [{ path: `widget ${w.path}.${a.property}`, before, after }],
    next:
      before === null
        ? `inverse: setProperty widget=${w.path} property=${a.property} value=null`
        : `inverse: setProperty widget=${w.path} property=${a.property} value=<the before text, as written>`,
    warnings,
    focus: w.path,
  };
}

// ── genClass ─────────────────────────────────────────────────────────────────

function componentOf(w: Widget, cls: string): CstObject | undefined {
  const comps = blockOf(w.obj, "components");
  return comps?.children.find((c): c is CstObject => c.kind === "object" && c.key === cls);
}

function scalarText(obj: CstObject | undefined, key: string): string | undefined {
  const s = obj?.children.find((c): c is CstScalar => c.kind === "scalar" && c.key === key);
  return s && s.values[0] ? tokenValue(s.values[0]) : undefined;
}

const truthy = (v: string | undefined, dflt: boolean): boolean =>
  v === undefined ? dflt : !/^(0|false)$/i.test(v.trim());

/** The class text SCR_GenerateLayoutClassPlugin writes (plugin v0.5.1), from the widget tree. */
function generateClass(
  ctx: Ctx,
  className: string,
  layoutResource: string,
  fullPath: boolean,
  warnings: string[],
): string {
  let decl = "";
  let bind = "";
  const rule = (w: Widget) => componentOf(w, "SCR_WidgetExportRule");
  const walk = (w: Widget, path: Widget[]) => {
    const full = [...path, w];
    const wName = nameOf(w) ?? "";
    let required: boolean;
    const own = rule(w);
    if (
      full.some((p) => {
        const r = rule(p);
        return r !== undefined && !truthy(scalarText(r, "ExportChildWidgets"), true);
      })
    ) {
      required = false;
    } else if (own) required = truthy(scalarText(own, "ExportThisWidget"), true);
    else required = wName.startsWith("m_");
    if (required && wName.includes(" ")) {
      warnings.push(`widget name contains a space, skipped: ${wName}`);
      required = false;
    }
    if (required) {
      const comps = (blockOf(w.obj, "components")?.children ?? []).filter(
        (c): c is CstObject =>
          c.kind === "object" &&
          c.key !== "SCR_WidgetExportRule" &&
          c.key !== "SCR_WidgetExportRuleRoot",
      );
      if (comps.length > 0 && decl !== "") {
        decl += "\n";
        bind += "\n";
      }
      let v = scalarText(own, "WidgetVariableName") || wName;
      if (!v.startsWith("m_w"))
        v = v.startsWith("m_") ? `${v.slice(0, 2)}w${v.slice(2)}` : `m_w${v}`;
      let widgetPath: string;
      if (full.length < 2) widgetPath = "_error_";
      else
        widgetPath = full
          .slice(1)
          .map((x) => nameOf(x) ?? "")
          .join(".");
      const cls = w.obj.key.slice(0, -5);
      decl += `\t${cls} ${v};\n`;
      bind += fullPath
        ? `\t\t${v} = ${cls}.Cast(root.FindWidget("${widgetPath}"));\n`
        : `\t\t${v} = ${cls}.Cast(root.FindAnyWidget("${wName}"));\n`;
      if (comps.length > 0) {
        const noW = v.replace("m_w", "m_");
        comps.forEach((c, i) => {
          const cv = comps.length === 1 ? `${noW}Component` : `${noW}Component${i}`;
          decl += `\t${c.key} ${cv};\n`;
          bind += `\t\t${cv} = ${c.key}.Cast(${v}.FindHandler(${c.key}));\n`;
        });
        decl += "\n";
        bind += "\n";
      }
    }
    for (const k of w.kids) walk(k, full);
  };
  walk(ctx.model.root, []);
  return (
    `// Autogenerated by the Generate Class from Layout plugin v${PLUGIN_VERSION}\n` +
    `// Layout file: ${ctx.rel}\n` +
    `class ${className}\n{\n` +
    `\tprotected static const ResourceName LAYOUT = "${layoutResource}";\n\n` +
    decl +
    "\n" +
    `${SEPARATOR}\n` +
    "\tbool Init(notnull Widget root)\n\t{\n" +
    bind +
    "\n" +
    "\t\treturn true;\n\t}\n\n" +
    `${SEPARATOR}\n` +
    "\tResourceName GetLayout()\n\t{\n\t\treturn LAYOUT;\n\t}\n" +
    "}\n"
  );
}

// ── Reads ────────────────────────────────────────────────────────────────────

function readAction(ctx: Ctx, a: LayoutEditArgs, game: boolean): ActionOk {
  const w = findWidget(ctx.model, a.widget, "widget");
  const list: { w: Widget; depth: number }[] = [];
  const walk = (x: Widget, d: number) => {
    list.push({ w: x, depth: d });
    for (const k of x.kids) walk(k, d + 1);
  };
  walk(w, 0);
  const limit = a.limit ?? LIMIT_DEFAULT;
  const cursor = a.cursor ? parseCursor(a.cursor) : { start: 0, count: list.length };
  checkCursor(cursor, list.length);
  const page = list.slice(cursor.start, cursor.start + limit);
  const warnings: string[] = [];
  if (ctx.doc.diagnostics.length) {
    warnings.push(
      `the file does not parse cleanly (${ctx.doc.diagnostics.length} diagnostic(s), first: ${ctx.doc.diagnostics[0].message}); edits to it are refused`,
    );
  }
  if (ctx.model.strays)
    warnings.push("entries in a children block are not widgets; edits are refused");
  const t = ctx.doc.text;
  const props: Record<string, string> = {};
  for (const c of w.obj.children) if (c.kind === "scalar") props[c.key] = rawOf(t, c);
  const slot = slotOf(w);
  const comps = blockOf(w.obj, "components");
  const detail = {
    path: w.path,
    class: w.obj.key,
    guid: guidOf(w.obj) ?? null,
    base: w.obj.base[0] ? tokenValue(w.obj.base[0]) : null,
    name: nameOf(w) ?? null,
    properties: props,
    slot: slot
      ? {
          class: slot.head[1]?.text ?? null,
          guid: guidOf(slot) ?? null,
          properties: Object.fromEntries(
            slot.children
              .filter((c): c is CstScalar => c.kind === "scalar")
              .map((c) => [c.key, rawOf(t, c)]),
          ),
        }
      : null,
    components: (comps?.children ?? [])
      .filter((c): c is CstObject => c.kind === "object")
      .map((c) => ({ class: c.key, guid: guidOf(c) ?? null })),
    children: w.kids.length,
  };
  return {
    ok: true,
    action: "read",
    target: `path:${ctx.rel}`,
    changed: null,
    readback: {
      file: ctx.rel,
      source: game ? "game data (read only)" : "project",
      widgets: ctx.model.all.length,
      widget: detail,
      shown: page.length,
      outline: page.map((x) => outlineLine(x.w, x.depth)),
      nextCursor: nextCursor(cursor.start, limit, list.length) ?? null,
    },
    next: game
      ? "A game resource is read only: copy it into the project (game_duplicate) to edit the copy."
      : undefined,
    warnings,
  };
}

// ── Commit ───────────────────────────────────────────────────────────────────

const POST_NOTE =
  "Checked offline against the shape of the vanilla layouts, not by the engine: open the layout in the Resource Manager to confirm it loads.";

function outlineAround(model: Model, path: string | undefined): string[] {
  let w: Widget = model.root;
  try {
    w = findWidget(model, path, "widget");
  } catch {
    w = model.root;
  }
  const lines: string[] = [];
  const walk = (x: Widget, d: number) => {
    if (lines.length < 40) lines.push(outlineLine(x, d));
    for (const k of x.kids) walk(k, d + 1);
  };
  walk(w, 0);
  return lines;
}

function commitEdit(ctx: Ctx, plan: Plan, a: LayoutEditArgs): ActionOk {
  const newText = plan.text;
  const rel = ctx.rel;
  if (newText === ctx.doc.text) {
    return {
      ok: true,
      action: a.action,
      target: `path:${rel}`,
      changed: [],
      readback: { dryRun: !a.confirm, file: rel, written: false },
      next: "Nothing to change: the file already has this state.",
      warnings: plan.warnings,
    };
  }
  if (ctx.doc.encoding === "latin1" && /[^\x00-\xff]/.test(newText)) {
    throw bad("the edit adds text outside latin-1 to a latin-1 file");
  }
  const nd = new CstDocument(newText, ctx.doc.encoding);
  let nm: Model;
  try {
    nm = buildModel(nd);
  } catch (e) {
    throw bad(
      `the edit would leave the file without one root widget: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (nd.diagnostics.length || nm.strays) {
    throw bad(
      `the edit would leave the file unparseable (${nd.diagnostics[0]?.message ?? "entry that is not a widget"}); nothing written`,
    );
  }
  const bytes = nd.toBytes();
  const hash = sha256(bytes);
  const diff = unifiedDiff(ctx.doc.text, newText, rel);
  const base = {
    file: rel,
    bytesBefore: ctx.buf.length,
    bytesAfter: bytes.length,
    sha256After: hash,
    widgets: nm.all.length,
    outline: outlineAround(nm, plan.focus),
  };
  if (!a.confirm) {
    return {
      ok: true,
      action: a.action,
      target: `path:${rel}`,
      changed: plan.changed,
      readback: { dryRun: true, ...base, diff },
      next: `Dry run, nothing written: repeat with confirm: true to write exactly this. ${plan.next ?? ""}`.trim(),
      warnings: [...plan.warnings, POST_NOTE],
    };
  }
  const file = ctx.file as string;
  if (!readFileSync(file).equals(ctx.buf)) {
    throw bad(`${rel} changed on disk while the edit was prepared; nothing written, read it again`);
  }
  // Write-then-rename: a failed write leaves the file as it was (review round 1, F9).
  writeFileAtomic(file, bytes);
  const verified = sha256(readFileSync(file)) === hash;
  return {
    ok: true,
    action: a.action,
    target: `path:${rel}`,
    changed: plan.changed,
    readback: { dryRun: false, written: true, verified, ...base, diff },
    next: `${plan.next ?? ""} An open Resource Manager tab keeps its own copy: reopen the layout there, and do not save the old tab over this file.`.trim(),
    warnings: [...plan.warnings, POST_NOTE],
  };
}

/** A new file under the project (saveAsPrefab, genClass): never over an existing file unless `overwrite`. */
function commitNew(
  ctx: Ctx,
  a: LayoutEditArgs,
  toRel: string,
  content: string | Buffer,
  warnings: string[],
  next: string,
): ActionOk {
  const root = ctx.root;
  if (!root)
    throw new LayoutError(
      "NOT_IN_PROJECT",
      "no project path configured (ENFUSION_PROJECT_PATH or projectPath)",
    );
  const abs = insideFile(root, toRel, "to");
  if (ctx.file && resolve(ctx.file).toLowerCase() === resolve(abs).toLowerCase()) {
    throw bad("to is the layout being read: pick another path");
  }
  const exists = existsSync(abs);
  if (exists && !statSync(abs).isFile()) throw bad(`${toRel} is not a file`);
  if (exists && !a.overwrite) {
    throw bad(`${toRel} exists already; pass overwrite: true to replace it`);
  }
  const bytes = typeof content === "string" ? Buffer.from(content, "utf8") : content;
  const text = typeof content === "string" ? content : content.toString("utf8");
  const before = exists ? readFileSync(abs).toString("utf8") : "";
  const parentMissing = !existsSync(dirname(abs));
  const w = [...warnings];
  if (parentMissing) w.push(`creates the folder ${dirname(toRel).replace(/\\/g, "/")}`);
  if (exists) w.push(`replaces the existing file (${Buffer.byteLength(before)} bytes)`);
  const base = {
    file: toRel,
    created: !exists,
    bytes: bytes.length,
    sha256: sha256(bytes),
    diff: unifiedDiff(before, text, toRel),
  };
  const changed: Change[] = [
    {
      path: toRel,
      before: exists ? `${Buffer.byteLength(before)} bytes` : null,
      after: `${bytes.length} bytes`,
    },
  ];
  if (!a.confirm) {
    return {
      ok: true,
      action: a.action,
      target: `path:${ctx.rel}`,
      changed,
      readback: { dryRun: true, ...base },
      next: `Dry run, nothing written: repeat with confirm: true to write exactly this. ${next}`.trim(),
      warnings: w,
    };
  }
  mkdirSync(dirname(abs), { recursive: true });
  writeFileAtomic(abs, bytes);
  const verified = sha256(readFileSync(abs)) === base.sha256;
  return {
    ok: true,
    action: a.action,
    target: `path:${ctx.rel}`,
    changed,
    readback: { dryRun: false, written: true, verified, ...base },
    next,
    warnings: w,
  };
}

function actSaveAsPrefab(ctx: Ctx, a: LayoutEditArgs): ActionOk {
  const w = findWidget(ctx.model, a.widget, "widget");
  if (!a.to) throw bad("saveAsPrefab needs to (the new .layout path in the project)");
  const toRel = relativePath(a.to, ctx.root, "to");
  if (!toRel.toLowerCase().endsWith(".layout")) throw bad(`to ${toRel} is not a .layout path`);
  // The widget becomes the root of the new file: its header loses the instance GUID.
  const lines = widgetLines(ctx, w);
  const g = w.obj.head.find((t) => t.kind === "string" && GUID_TOKEN.test(t.text));
  if (g && w.parent) {
    const headOff = w.obj.start;
    const firstLineLen = lines[0].length;
    const rel0 = g.start - headOff;
    if (rel0 > 0 && rel0 < firstLineLen) {
      lines[0] =
        lines[0].slice(0, rel0).replace(/[ \t]+$/, "") + lines[0].slice(rel0 + (g.end - g.start));
    }
  }
  const content = lines.join(ctx.eol);
  const warnings = [
    "the source layout is left as it is: replacing the widget by an instance of the new file needs its resource GUID, which the Workbench writes when the file is registered",
  ];
  if (w.kids.length === 0 && !w.parent) warnings.push("the whole layout was saved");
  return commitNew(
    ctx,
    a,
    toRel,
    content,
    warnings,
    `Register the new file before use: wb_resources register path=${toRel} (the Workbench writes its .meta), then point an instance at it with addWidget base=<{GUID}${toRel}>.`,
  );
}

function actGenClass(ctx: Ctx, a: LayoutEditArgs): ActionOk {
  const warnings: string[] = [];
  const rootW = ctx.model.root;
  const rule = componentOf(rootW, "SCR_WidgetExportRuleRoot");
  if (!rule) {
    warnings.push(
      "no SCR_WidgetExportRuleRoot component on the root widget: plugin defaults used (prefix SCR_, suffix Widgets, FindWidget paths)",
    );
  }
  const file = ctx.rel.slice(ctx.rel.lastIndexOf("/") + 1).replace(/\.[^.]*$/, "");
  const prefix = scalarText(rule, "ScriptClassNamePrefix") ?? "SCR_";
  const suffix = scalarText(rule, "ScriptClassNameSuffix") ?? "Widgets";
  const className = a.className ?? `${prefix}${file}${suffix}`;
  if (!IDENT.test(className)) throw bad(`className ${className} is not a script class name`);
  let toRel = a.to;
  if (toRel === undefined) {
    const dest = (scalarText(rule, "DestinationPath") ?? "").replace(/^\{[0-9A-Fa-f]{16}\}/, "");
    if (!dest)
      throw bad(
        "genClass needs to (a .c path in the project): the layout names no DestinationPath",
      );
    toRel = `${dest.endsWith("/") ? dest : `${dest}/`}${className}.c`;
  }
  const to = relativePath(toRel, ctx.root, "to");
  if (!to.toLowerCase().endsWith(".c")) throw bad(`to ${to} is not a .c path`);
  let resource = ctx.rel;
  if (ctx.file && existsSync(`${ctx.file}.meta`)) {
    const m = /Name\s+"(\{[0-9A-Fa-f]{16}\})/.exec(readFileSync(`${ctx.file}.meta`, "utf8"));
    if (m) resource = `${m[1]}${ctx.rel}`;
  }
  if (resource === ctx.rel) {
    warnings.push(
      "no .meta beside the layout, so LAYOUT holds the path without a GUID: register the layout, then generate again",
    );
  }
  const fullPath = truthy(scalarText(rule, "GenerateFullWidgetPath"), true);
  const text = generateClass(ctx, className, resource, fullPath, warnings);
  const res = commitNew(
    ctx,
    a,
    to,
    text,
    warnings,
    `Compile it: wb_validate_scripts (or wb_reload). The class is ${className}.`,
  );
  (res.readback as Record<string, unknown>).content = text.split("\n").slice(0, 120);
  return res;
}

// ── Entry points ─────────────────────────────────────────────────────────────

const WRITE_ACTIONS: ReadonlySet<Action> = new Set<Action>([
  "addWidget",
  "removeWidget",
  "moveWidget",
  "duplicateWidget",
  "wrap",
  "convert",
  "setProperty",
]);

/** Runs one action; refusals come back as an ActionError. Exported for the tests. */
export function runLayoutEdit(a: LayoutEditArgs, config: Config): ActionOk | ActionError {
  const target = `path:${a.path}`;
  try {
    if (
      a.limit !== undefined &&
      (!Number.isInteger(a.limit) || a.limit < 1 || a.limit > LIMIT_MAX)
    ) {
      throw bad(`limit is 1 to ${LIMIT_MAX}`);
    }
    if (a.action === "read") {
      const ctx = loadCtx(a, config, false);
      return readAction(ctx, a, ctx.file === undefined);
    }
    const ctx = loadCtx(a, config, WRITE_ACTIONS.has(a.action));
    if (a.action === "saveAsPrefab") return actSaveAsPrefab(ctx, a);
    if (a.action === "genClass") return actGenClass(ctx, a);
    let plan: Plan;
    switch (a.action) {
      case "addWidget":
        plan = planAdd(ctx, a);
        break;
      case "removeWidget":
        plan = planRemove(ctx, a);
        break;
      case "moveWidget":
        plan = planMove(ctx, a);
        break;
      case "duplicateWidget":
        plan = planDuplicate(ctx, a);
        break;
      case "wrap":
        plan = planWrap(ctx, a);
        break;
      case "convert":
        plan = planConvert(ctx, a);
        break;
      default:
        plan = planSetProperty(ctx, a);
    }
    return commitEdit(ctx, plan, a);
  } catch (e) {
    if (e instanceof LayoutError) return errorResponse(a.action, target, e.code, e.message, e.next);
    if (e instanceof VocabularyError) return errorResponse(a.action, target, e.code, e.message);
    if (e instanceof CstEditError) {
      return errorResponse(
        a.action,
        target,
        e.code === "PATH_NOT_FOUND" ? "PATH_NOT_FOUND" : "INVALID_ARGUMENT",
        e.message,
      );
    }
    return errorResponse(
      a.action,
      target,
      "HANDLER_ERROR",
      e instanceof Error ? e.message : String(e),
    );
  }
}

const propValue = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.union([z.string(), z.number(), z.boolean()])),
]);

export function registerLayoutEdit(server: McpServer, config: Config): void {
  server.registerTool(
    "layout_edit",
    {
      description:
        "Read and edit .layout widget trees offline (lossless parser). Actions: read, addWidget, removeWidget, moveWidget, duplicateWidget, wrap (unwrap:true undoes), convert, setProperty (value null removes), saveAsPrefab, genClass. A widget is root, an index path 0/2, a Name or a {GUID}. Writes stay in the project and are a dry run until confirm:true.",
      inputSchema: {
        action: z.enum(ACTIONS),
        path: z
          .string()
          .min(1)
          .describe("Project-relative .layout (read also takes a game resource path)."),
        widget: z.string().optional().describe("Target widget; default root."),
        parent: z
          .string()
          .optional()
          .describe("addWidget/moveWidget: parent widget; default root."),
        index: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Position among the siblings; default last."),
        widgetClass: z.string().optional().describe("addWidget: e.g. TextWidgetClass."),
        name: z
          .string()
          .optional()
          .describe("addWidget/duplicateWidget/wrap: Name of the new widget."),
        base: z.string().optional().describe("addWidget: base layout resource ({GUID}path)."),
        props: z.record(z.string(), propValue).optional().describe("addWidget: scalar properties."),
        slot: z
          .object({
            class: z.string().optional(),
            props: z.record(z.string(), propValue).optional(),
          })
          .optional()
          .describe("addWidget: slot class (default from the parent) and properties."),
        text: z
          .string()
          .optional()
          .describe("addWidget: a widget block verbatim (undoes removeWidget)."),
        wrapper: z.string().optional().describe("wrap: container widget class."),
        unwrap: z.boolean().optional().describe("wrap: remove a one-child wrapper."),
        toClass: z.string().optional().describe("convert: the new widget class."),
        property: z
          .string()
          .optional()
          .describe("setProperty: Name, Slot.PositionX, components.Cls.key."),
        value: z
          .union([propValue, z.null()])
          .optional()
          .describe("setProperty: new value; null removes."),
        quoted: z.boolean().optional().describe("setProperty: force quotes on or off."),
        to: z
          .string()
          .optional()
          .describe("saveAsPrefab (.layout) / genClass (.c): new project path."),
        className: z.string().optional().describe("genClass: script class name."),
        overwrite: z
          .boolean()
          .optional()
          .describe("saveAsPrefab/genClass: replace an existing file."),
        confirm: z.boolean().optional().describe("Write. Without it every write is a dry run."),
        cursor: z.string().optional().describe("read: paging cursor."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(LIMIT_MAX)
          .optional()
          .describe("read: widgets per page."),
        projectPath: z
          .string()
          .optional()
          .describe("Addon root; the configured project when omitted."),
      },
    },
    async (args) => {
      const res = runLayoutEdit(args as LayoutEditArgs, config);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(res, null, 2) }],
        isError: !res.ok,
      };
    },
  );
}
