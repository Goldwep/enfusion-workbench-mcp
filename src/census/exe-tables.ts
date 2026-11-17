/**
 * Byte-level extraction of static tables from the Workbench executable (E05,
 * plan 4.5). Everything here is pure: it reads a `Buffer` that the caller
 * loaded with `readFileSync`. Nothing executes the binary.
 *
 * Methods (each one is stated with the table it produces):
 *
 * - PE sections: the section table of the PE header; string scans are limited
 *   to `.rdata`, where MSVC places string literals.
 * - CLI switches: (1) "literal" — a NUL-bounded ASCII literal in `.rdata`,
 *   starting at a 4-byte aligned offset, of the form `-name` (one dash, a
 *   letter, at least two more letters or digits); (2) "prose" — a `-name`
 *   token inside a NUL-bounded `.rdata` sentence that marks it as an argument:
 *   the token opens the string and is followed by whitespace, or it follows
 *   the word argument / parameter / CLI / with, or the string is a command
 *   template opening with `"%1"`. Tokens of other families that share the
 *   literal form (COLLADA id suffixes, number words, OpenSSL options) are
 *   listed in `NON_SWITCH_TOKENS` and excluded by name; every exclusion is
 *   reported, never silently dropped.
 * - Native NET function names: the string block of the NET dispatcher, opened
 *   by the dispatcher's own error format `Parameter %s required`. The block
 *   holds the function names first and then the payload field names; the
 *   function names are the leading identifiers whose first camel-case word is
 *   a verb from `NET_VERBS`.
 * - Qt resources (rcc): name tables found by their own checksum (every entry is
 *   `u16 length, u32 qt_hash(name), UTF-16BE name`, and the hash is verified),
 *   the tree that follows each table, and the payload table before it.
 * - Default dock layouts: rcc files `.gs` whose payload is a
 *   `QMainWindow::saveState` stream (opens with the version marker 0xff); a
 *   QString preceded by the dock-area widget marker 0xfb names a dock (any
 *   printable name, spaces included), any other identifier-shaped QString in
 *   the stream names a toolbar.
 * - RTTI: MSVC x64 complete object locators in `.rdata` (signature 1, self RVA
 *   matches), their class hierarchy descriptors and base class arrays. This
 *   gives every class that has a vtable with its full list of base classes.
 * - Object names passed to `QObject::setObjectName`: the PE32+ import table
 *   gives the import slot of `QObject::setObjectName`; every `call [rip+d32]`
 *   in `.text` through that slot is a call site, and the nearest RIP-relative
 *   `lea` within the 64 bytes before it that addresses a NUL-bounded ASCII
 *   string gives the literal (uic's `X->setObjectName("X")`).
 * - String runs: the NUL-bounded strings that follow a string in `.rdata`,
 *   tolerating a few pointer-sized words between them (used to list what sits
 *   beside an options class name; nothing is emitted from it).
 */

// ── PE sections ──────────────────────────────────────────────────────────────

export interface Section {
  name: string;
  /** File offset of the raw data. */
  raw: number;
  /** File offset one past the raw data. */
  rawEnd: number;
  va: number;
  vsize: number;
}

export interface ByteRange {
  lo: number;
  hi: number;
}

/** The PE section table. Throws when the buffer is not a PE image. */
export function peSections(buf: Buffer): Section[] {
  if (buf.length < 0x40 || buf.readUInt16LE(0) !== 0x5a4d)
    throw new Error("not a PE image (no MZ)");
  const pe = buf.readUInt32LE(0x3c);
  if (pe + 24 > buf.length || buf.readUInt32LE(pe) !== 0x00004550) {
    throw new Error("not a PE image (no PE signature)");
  }
  const count = buf.readUInt16LE(pe + 6);
  const optSize = buf.readUInt16LE(pe + 20);
  const out: Section[] = [];
  for (let i = 0, o = pe + 24 + optSize; i < count; i++, o += 40) {
    const raw = buf.readUInt32LE(o + 20);
    const rsize = buf.readUInt32LE(o + 16);
    out.push({
      name: buf.toString("latin1", o, o + 8).replace(/\0+$/, ""),
      vsize: buf.readUInt32LE(o + 8),
      va: buf.readUInt32LE(o + 12),
      raw,
      rawEnd: raw + rsize,
    });
  }
  return out;
}

/** File offset of an RVA, or -1 when no section holds it. */
export function rvaToOffset(sections: readonly Section[], rva: number): number {
  for (const s of sections) {
    const len = Math.min(s.vsize || s.rawEnd - s.raw, s.rawEnd - s.raw);
    if (rva >= s.va && rva < s.va + len) return rva - s.va + s.raw;
  }
  return -1;
}

/** The byte range of a named section. Throws when absent. */
export function sectionRange(sections: readonly Section[], name: string): ByteRange {
  const s = sections.find((x) => x.name === name);
  if (!s) throw new Error(`no ${name} section`);
  return { lo: s.raw, hi: s.rawEnd };
}

// ── Strings ──────────────────────────────────────────────────────────────────

function printable(b: number): boolean {
  return b >= 0x20 && b < 0x7f;
}

export interface FoundString {
  offset: number;
  text: string;
}

/**
 * Every NUL-bounded ASCII string in `range`: preceded by a NUL (or the range
 * start), printable, terminated by a NUL, at least `minLen` long.
 */
export function asciiStrings(buf: Buffer, range: ByteRange, minLen = 2): FoundString[] {
  const out: FoundString[] = [];
  const hi = Math.min(range.hi, buf.length);
  let i = range.lo;
  while (i < hi) {
    if (!printable(buf[i]) || (i > range.lo && buf[i - 1] !== 0)) {
      i++;
      continue;
    }
    let j = i;
    while (j < hi && printable(buf[j])) j++;
    if (j < hi && buf[j] === 0 && j - i >= minLen) {
      out.push({ offset: i, text: buf.toString("latin1", i, j) });
    }
    i = j + 1;
  }
  return out;
}

/** The NUL-bounded ASCII string that starts exactly at `offset`, or null. */
export function asciiAt(buf: Buffer, offset: number): string | null {
  if (offset <= 0 || offset >= buf.length || buf[offset - 1] !== 0) return null;
  let j = offset;
  while (j < buf.length && printable(buf[j])) j++;
  if (j === offset || j >= buf.length || buf[j] !== 0) return null;
  return buf.toString("latin1", offset, j);
}

/** UTF-16BE ASCII-range text of `chars` characters at `offset`, or null. */
export function utf16beAt(buf: Buffer, offset: number, chars: number): string | null {
  if (offset < 0 || offset + chars * 2 > buf.length) return null;
  let s = "";
  for (let i = 0; i < chars; i++) {
    const c = buf.readUInt16BE(offset + i * 2);
    if (c < 0x20 || c > 0x7e) return null;
    s += String.fromCharCode(c);
  }
  return s;
}

// ── Byte search ──────────────────────────────────────────────────────────────

export interface SearchHits {
  ascii: number[];
  utf16le: number[];
}

/** A copy of `buf` with ASCII capitals lowered (for case-insensitive search). */
export function lowerAscii(buf: Buffer): Buffer {
  const out = Buffer.from(buf);
  for (let i = 0; i < out.length; i++) {
    const c = out[i];
    if (c >= 0x41 && c <= 0x5a) out[i] = c + 0x20;
  }
  return out;
}

function allOffsets(hay: Buffer, needle: Buffer): number[] {
  const out: number[] = [];
  if (needle.length === 0) return out;
  let i = hay.indexOf(needle);
  while (i !== -1) {
    out.push(i);
    i = hay.indexOf(needle, i + 1);
  }
  return out;
}

/**
 * Every offset of `needle` in the whole file, as ASCII and as UTF-16LE. With
 * `lowered` (from `lowerAscii`) the search is case-insensitive.
 */
export function searchBytes(buf: Buffer, needle: string, lowered?: Buffer): SearchHits {
  const hay = lowered ?? buf;
  const n = lowered ? needle.toLowerCase() : needle;
  return {
    ascii: allOffsets(hay, Buffer.from(n, "latin1")),
    utf16le: allOffsets(hay, Buffer.from(n, "utf16le")),
  };
}

// ── CLI switches ─────────────────────────────────────────────────────────────

/** The literal form of a switch (one dash, a letter, two or more letters or digits). */
export const SWITCH_LITERAL = /^-[A-Za-z][A-Za-z0-9]{2,}$/;

/**
 * Tokens that share the switch form but belong to other formats, with the
 * family that explains them. Matched by exact name; an exclusion is reported.
 */
export const NON_SWITCH_TOKENS: Readonly<Record<string, string>> = Object.fromEntries([
  ...[
    "camera",
    "lib",
    "light",
    "Joints",
    "Matrices",
    "Weights",
    "VERTEX",
    "POSITION",
    "Normal",
    "targets",
    "weights",
    "anim",
    "animation",
    "Pivot",
    "Material",
    "Interpolations",
    "BindPos",
    "array",
    "accessor",
    "input",
    "output",
    "interpolation",
    "intan",
    "outtan",
  ].map((t) => [t, "COLLADA element id suffix"]),
  ...["inf", "Infinity"].map((t) => [t, "number literal"]),
  ...["fips", "info", "kem"].map((t) => [t, "OpenSSL option word"]),
]);

export type SwitchMethod = "literal" | "prose";

export interface SwitchCandidate {
  /** Switch name without its leading dash, as spelled in the binary. */
  name: string;
  /** Offset of the NUL-bounded string that holds it. */
  offset: number;
  /** The whole string at `offset`. */
  quote: string;
  method: SwitchMethod;
  /** Set when the token was excluded: the family from `NON_SWITCH_TOKENS`. */
  excluded?: string;
}

const PROSE_TOKEN = /(^|[\s"'(=])(-[A-Za-z][A-Za-z0-9]{2,}(?:-[A-Za-z0-9]+)*)(?=$|[\s"'=:.,!)])/g;
const PROSE_BEFORE = /(?:argument|parameter|CLI|with)\s+['"]?$/i;
const PROSE_AFTER = /^['"]?\s+argument\b/i;

/** Every switch candidate (literal and prose), excluded ones included. */
export function switchCandidates(strings: readonly FoundString[]): SwitchCandidate[] {
  const out: SwitchCandidate[] = [];
  for (const s of strings) {
    if (s.offset % 4 !== 0) continue;
    if (SWITCH_LITERAL.test(s.text)) {
      const name = s.text.slice(1);
      out.push({
        name,
        offset: s.offset,
        quote: s.text,
        method: "literal",
        excluded: NON_SWITCH_TOKENS[name],
      });
      continue;
    }
    if (!/\s/.test(s.text)) continue;
    const template = s.text.startsWith('"%1"');
    PROSE_TOKEN.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = PROSE_TOKEN.exec(s.text))) {
      const start = m.index + m[1].length;
      const token = m[2];
      const after = s.text.slice(start + token.length);
      const opens = start === 0 && /^\s/.test(after);
      const named = PROSE_BEFORE.test(s.text.slice(0, start)) || PROSE_AFTER.test(after);
      if (!opens && !named && !template) continue;
      const name = token.slice(1);
      out.push({
        name,
        offset: s.offset,
        quote: s.text,
        method: "prose",
        excluded: NON_SWITCH_TOKENS[name],
      });
    }
  }
  return out;
}

/** One candidate per switch name: literal before prose, then the lowest offset. */
export function selectSwitches(candidates: readonly SwitchCandidate[]): SwitchCandidate[] {
  const best = new Map<string, SwitchCandidate>();
  for (const c of candidates) {
    if (c.excluded) continue;
    const prior = best.get(c.name);
    const better =
      !prior ||
      (c.method === "literal" && prior.method === "prose") ||
      (c.method === prior.method && c.offset < prior.offset);
    if (better) best.set(c.name, c);
  }
  return [...best.values()].sort((a, b) => a.offset - b.offset);
}

// ── Native NET functions ─────────────────────────────────────────────────────

/** The NET dispatcher's own error format; its string block follows it. */
export const NET_ANCHOR = "Parameter %s required";

/** First camel-case words that mark a function name rather than a payload field. */
export const NET_VERBS: readonly string[] = [
  "Open",
  "Bring",
  "Is",
  "Validate",
  "Reload",
  "Evaluate",
  "Get",
  "Set",
  "Run",
  "Close",
  "Save",
  "Call",
  "Execute",
];

export interface NetBlock {
  /** Offset of the anchor string, or -1 when absent. */
  anchor: number;
  /** Every NUL-bounded string of the block, anchor excluded. */
  block: FoundString[];
  /** The leading verb-led identifiers. */
  functions: FoundString[];
}

/** Reads the dispatcher block after `NET_ANCHOR` within `range`. */
export function extractNetBlock(buf: Buffer, range: ByteRange): NetBlock {
  const needle = Buffer.from(`\0${NET_ANCHOR}\0`, "latin1");
  const at = buf.indexOf(needle, range.lo);
  if (at === -1 || at >= range.hi) return { anchor: -1, block: [], functions: [] };
  const anchor = at + 1;
  const block: FoundString[] = [];
  let p = anchor + NET_ANCHOR.length + 1;
  for (;;) {
    while (p < range.hi && buf[p] === 0) p++;
    const text = asciiAt(buf, p);
    if (text === null || text.length < 2) break;
    block.push({ offset: p, text });
    p += text.length + 1;
  }
  const functions: FoundString[] = [];
  for (const s of block) {
    if (!/^[A-Z][A-Za-z0-9]*$/.test(s.text)) break;
    const first = /^[A-Z][a-z0-9]*/.exec(s.text)?.[0] ?? "";
    if (!NET_VERBS.includes(first)) break;
    functions.push(s);
  }
  return { anchor, block, functions };
}

// ── Qt resources (rcc) ───────────────────────────────────────────────────────

/** Qt's `qt_hash` as rcc writes it into the name table. */
export function qtHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 4) + s.charCodeAt(i)) >>> 0;
    h = (h ^ ((h & 0xf0000000) >>> 23)) >>> 0;
    h = (h & 0x0fffffff) >>> 0;
  }
  return h;
}

interface RccName {
  /** Offset of the entry (length field). */
  entry: number;
  /** Offset of the first UTF-16BE character. */
  chars: number;
  name: string;
  end: number;
}

function rccNameAt(buf: Buffer, p: number): RccName | null {
  if (p + 6 > buf.length) return null;
  const len = buf.readUInt16BE(p);
  if (len < 1 || len > 255) return null;
  const name = utf16beAt(buf, p + 6, len);
  if (name === null || qtHash(name) !== buf.readUInt32BE(p + 2)) return null;
  return { entry: p, chars: p + 6, name, end: p + 6 + 2 * len };
}

export interface RccEntry {
  /** Resource path, `:/Workbench/ScriptEditor/edit.gs`. */
  path: string;
  /** Offset of the first UTF-16BE character of the entry's own name. */
  nameOffset: number;
  dir: boolean;
  flags: number;
  /** Files: offset of the payload bytes (after the u32 size); -1 for directories. */
  payload: number;
  size: number;
}

export interface RccBundle {
  names: number;
  tree: number;
  data: number;
  entries: RccEntry[];
}

const TREE_ENTRY = 22;

/**
 * Finds rcc bundles in `range`: a chain of at least three hash-verified name
 * entries, a tree right after it whose root is a directory with first child 1,
 * and a payload table before it that every file entry fits.
 */
export function findRccBundles(buf: Buffer, range: ByteRange): RccBundle[] {
  const bundles: RccBundle[] = [];
  const hi = Math.min(range.hi, buf.length) - 6;
  let p = range.lo;
  while (p < hi) {
    const first = rccNameAt(buf, p);
    if (!first) {
      p++;
      continue;
    }
    const chain: RccName[] = [];
    let q = p;
    for (let n = rccNameAt(buf, q); n; n = rccNameAt(buf, q)) {
      chain.push(n);
      q = n.end;
    }
    if (chain.length < 3) {
      p++;
      continue;
    }
    const bundle = readRccTree(buf, p, q, range);
    if (bundle) bundles.push(bundle);
    p = q;
  }
  return bundles;
}

function readRccTree(
  buf: Buffer,
  namesStart: number,
  namesEnd: number,
  range: ByteRange,
): RccBundle | null {
  let tree = -1;
  for (let t = namesEnd; t < namesEnd + 32 && t + TREE_ENTRY <= buf.length; t++) {
    if (
      buf.readUInt32BE(t) === 0 &&
      buf.readUInt16BE(t + 4) === 2 &&
      buf.readUInt32BE(t + 10) === 1
    ) {
      tree = t;
      break;
    }
  }
  if (tree === -1) return null;
  const entries: (RccEntry & { off: number })[] = [];
  const visit = (idx: number, parentPath: string, depth: number): boolean => {
    if (depth > 32) return false;
    const e = tree + idx * TREE_ENTRY;
    if (e + TREE_ENTRY > buf.length) return false;
    const flags = buf.readUInt16BE(e + 4);
    let path = "";
    let nameOffset = -1;
    if (idx !== 0) {
      const n = rccNameAt(buf, namesStart + buf.readUInt32BE(e));
      if (!n) return false;
      path = `${parentPath}/${n.name}`;
      nameOffset = n.chars;
    }
    if (flags & 2) {
      const count = buf.readUInt32BE(e + 6);
      const firstChild = buf.readUInt32BE(e + 10);
      if (count > 100000) return false;
      if (idx !== 0)
        entries.push({
          path: `:${path}`,
          nameOffset,
          dir: true,
          flags,
          payload: -1,
          size: 0,
          off: -1,
        });
      for (let i = 0; i < count; i++) if (!visit(firstChild + i, path, depth + 1)) return false;
    } else {
      entries.push({
        path: `:${path}`,
        nameOffset,
        dir: false,
        flags,
        payload: -1,
        size: 0,
        off: buf.readUInt32BE(e + 10),
      });
    }
    return true;
  };
  if (!visit(0, "", 0)) return null;
  const files = entries.filter((e) => !e.dir);
  if (files.length === 0) return null;
  const last = files.reduce((a, f) => (f.off > a.off ? f : a));
  // The payload table ends just before the name table (up to 16 bytes of padding).
  let data = -1;
  for (let s = namesStart - 8; s >= Math.max(range.lo, namesStart - 64 * 1024 * 1024); s--) {
    const size = buf.readUInt32BE(s);
    const end = s + 4 + size;
    if (end > namesStart || end < namesStart - 16) continue;
    const d = s - last.off;
    if (d < range.lo) continue;
    const fits = files.every((f) => {
      const at = d + f.off;
      if (at + 4 > namesStart) return false;
      const sz = buf.readUInt32BE(at);
      if (sz === 0 || at + 4 + sz > namesStart) return false;
      if (f.flags === 0 && f.path.toLowerCase().endsWith(".png"))
        return buf.readUInt32BE(at + 4) === 0x89504e47;
      return true;
    });
    if (fits) {
      data = d;
      break;
    }
  }
  if (data === -1) return null;
  for (const f of files) {
    f.size = buf.readUInt32BE(data + f.off);
    f.payload = data + f.off + 4;
  }
  return {
    names: namesStart,
    tree,
    data,
    entries: entries.map(({ off: _off, ...e }) => e),
  };
}

// ── Default layouts (QMainWindow::saveState) ─────────────────────────────────

export interface LayoutEntry {
  name: string;
  /** Offset of the first UTF-16BE character. */
  offset: number;
  kind: "dock" | "toolbar";
}

/** QMainWindow state marker (`QMainWindowLayout::VersionMarker`). */
export const MAINWINDOW_VERSION_MARKER = 0xff;
/** Dock-area widget marker (`QDockAreaLayout::WidgetMarker`). */
export const DOCK_WIDGET_MARKER = 0xfb;

/**
 * The object names stored in a `QMainWindow::saveState` payload. Returns []
 * when the payload does not open with the version marker.
 *
 * A QString right after the dock widget marker 0xfb is a dock's object name
 * whatever its characters (Workbench names some docks with spaces, such as
 * `Animation Sets`); any other QString counts only when it is identifier-shaped,
 * so stray bytes of the geometry fields never pass for a toolbar name.
 */
export function parseMainWindowState(buf: Buffer, start: number, size: number): LayoutEntry[] {
  const end = Math.min(start + size, buf.length);
  if (size < 8 || buf.readUInt32BE(start) !== MAINWINDOW_VERSION_MARKER) return [];
  const out: LayoutEntry[] = [];
  let q = start + 4;
  while (q + 4 <= end) {
    const len = buf.readUInt32BE(q);
    if (len >= 2 && len <= 512 && len % 2 === 0 && q + 4 + len <= end) {
      const name = utf16beAt(buf, q + 4, len / 2);
      const dock = q > start && buf[q - 1] === DOCK_WIDGET_MARKER;
      const shaped =
        name !== null &&
        (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || (dock && /^[A-Za-z_][ -~]*[^ ]$/.test(name)));
      if (name !== null && shaped) {
        out.push({
          name,
          offset: q + 4,
          kind: dock ? "dock" : "toolbar",
        });
        q += 4 + len;
        continue;
      }
    }
    q++;
  }
  return out;
}

// ── RTTI ─────────────────────────────────────────────────────────────────────

export interface RttiClass {
  /** Mangled type name, `.?AVFoo@ns@@`. */
  mangled: string;
  /** Offset of the mangled name (inside its TypeDescriptor). */
  offset: number;
  /** Mangled names of every base class, nearest first as the descriptor lists them. */
  bases: string[];
}

function cstr(buf: Buffer, o: number, max = 4096): string | null {
  if (o < 0 || o >= buf.length) return null;
  let e = o;
  while (e < buf.length && e - o < max && buf[e] !== 0) e++;
  return e < buf.length && buf[e] === 0 ? buf.toString("latin1", o, e) : null;
}

/**
 * Every class with an MSVC x64 complete object locator in `locatorRange`
 * (normally `.rdata`). `sections` maps RVAs to file offsets.
 */
export function parseRtti(
  buf: Buffer,
  sections: readonly Section[],
  locatorRange: ByteRange,
  locatorSectionVa: number,
): RttiClass[] {
  const out = new Map<string, RttiClass>();
  const typeName = (rva: number): { name: string; offset: number } | null => {
    const o = rvaToOffset(sections, rva);
    if (o < 0) return null;
    const name = cstr(buf, o + 16, 2048);
    return name && name.startsWith(".?A") ? { name, offset: o + 16 } : null;
  };
  const hi = Math.min(locatorRange.hi, buf.length) - 24;
  for (let o = locatorRange.lo; o < hi; o += 4) {
    if (buf.readUInt32LE(o) !== 1) continue;
    if (buf.readUInt32LE(o + 20) !== o - locatorRange.lo + locatorSectionVa) continue;
    const td = typeName(buf.readUInt32LE(o + 12));
    const chd = rvaToOffset(sections, buf.readUInt32LE(o + 16));
    if (!td || chd < 0 || out.has(td.name)) continue;
    const count = buf.readUInt32LE(chd + 8);
    const bca = rvaToOffset(sections, buf.readUInt32LE(chd + 12));
    if (bca < 0 || count > 256) continue;
    const bases: string[] = [];
    for (let i = 1; i < count; i++) {
      const bcd = rvaToOffset(sections, buf.readUInt32LE(bca + 4 * i));
      if (bcd < 0) continue;
      const b = typeName(buf.readUInt32LE(bcd));
      if (b) bases.push(b.name);
    }
    out.set(td.name, { mangled: td.name, offset: td.offset, bases });
  }
  return [...out.values()].sort((a, b) => a.offset - b.offset);
}

export interface TypeName {
  /** Unqualified class name. */
  name: string;
  /** Named namespaces, outermost first (anonymous namespaces dropped). */
  namespaces: string[];
  /** `ns::Name`. */
  qualified: string;
}

/**
 * Splits a simple mangled class or struct name (`.?AVFoo@ns@@`). Returns null
 * for templates, lambdas and nested special names.
 */
export function demangleTypeName(mangled: string): TypeName | null {
  const m = /^\.\?A[VU](.+)@@$/.exec(mangled);
  if (!m) return null;
  const anonymous = /^\?A0x[0-9a-f]+$/;
  const parts = m[1].split("@");
  if (!parts.every((p) => anonymous.test(p) || /^[A-Za-z_][A-Za-z0-9_]*$/.test(p))) return null;
  const named = parts.filter((p) => !anonymous.test(p));
  if (named.length === 0 || anonymous.test(parts[0])) return null;
  const namespaces = named.slice(1).reverse();
  return { name: named[0], namespaces, qualified: [...namespaces, named[0]].join("::") };
}

// ── Imports and setObjectName literals ───────────────────────────────────────

export interface ImportSlot {
  dll: string;
  /** Imported symbol name (decorated, as the import name table spells it). */
  name: string;
  /** RVA of the import address table slot. */
  rva: number;
}

/**
 * Every by-name import of a PE32+ image with its IAT slot RVA. Returns [] when
 * the image has no PE32+ optional header or no import directory.
 */
export function importSlots(buf: Buffer, sections: readonly Section[]): ImportSlot[] {
  const pe = buf.readUInt32LE(0x3c);
  const optSize = buf.readUInt16LE(pe + 20);
  const opt = pe + 24;
  if (optSize < 128 || buf.readUInt16LE(opt) !== 0x20b) return [];
  if (buf.readUInt32LE(opt + 108) < 2) return [];
  const dirRva = buf.readUInt32LE(opt + 120);
  let d = dirRva ? rvaToOffset(sections, dirRva) : -1;
  if (d < 0) return [];
  const out: ImportSlot[] = [];
  for (; d + 20 <= buf.length; d += 20) {
    const oft = buf.readUInt32LE(d);
    const nameRva = buf.readUInt32LE(d + 12);
    const ft = buf.readUInt32LE(d + 16);
    if (nameRva === 0 && ft === 0) break;
    const dll = cstr(buf, rvaToOffset(sections, nameRva), 260);
    let t = rvaToOffset(sections, oft || ft);
    if (dll === null || t < 0) continue;
    for (let i = 0; t + 8 <= buf.length; i++, t += 8) {
      const lo = buf.readUInt32LE(t);
      const hi = buf.readUInt32LE(t + 4);
      if (lo === 0 && hi === 0) break;
      if (hi & 0x80000000) continue; // by ordinal
      const n = cstr(buf, rvaToOffset(sections, lo) + 2, 2048);
      if (n !== null) out.push({ dll, name: n, rva: ft + 8 * i });
    }
  }
  return out;
}

/** The decorated name of `QObject::setObjectName` (any overload). */
export const SET_OBJECT_NAME_IMPORT = /^\?setObjectName@QObject@@/;

export interface ObjectNameLiteral {
  /** Offset of the NUL-bounded ASCII literal. */
  offset: number;
  text: string;
  /** File offsets of the `call` instructions that pass it. */
  sites: number[];
}

export interface ObjectNameScan {
  /** Call sites through the setObjectName import slot(s). */
  calls: number;
  /** Call sites with no string-addressing `lea` in the window before them. */
  unresolved: number;
  literals: ObjectNameLiteral[];
}

/**
 * The literals passed to `QObject::setObjectName`: for each `call [rip+d32]`
 * through its import slot, the nearest preceding `lea r64, [rip+d32]` (REX.W
 * 48 or 4C, opcode 8D, ModRM mod 00 rm 101) within `window` bytes whose target
 * is a NUL-bounded ASCII string.
 */
export function setObjectNameLiterals(
  buf: Buffer,
  sections: readonly Section[],
  window = 64,
): ObjectNameScan {
  const slots = new Set(
    importSlots(buf, sections)
      .filter((s) => SET_OBJECT_NAME_IMPORT.test(s.name))
      .map((s) => s.rva),
  );
  const text = sections.find((s) => s.name === ".text");
  const empty: ObjectNameScan = { calls: 0, unresolved: 0, literals: [] };
  if (!text || slots.size === 0) return empty;
  const rvaOf = (off: number): number => off - text.raw + text.va;
  const byOffset = new Map<number, ObjectNameLiteral>();
  let calls = 0;
  let unresolved = 0;
  const hi = Math.min(text.rawEnd, buf.length) - 6;
  for (let o = text.raw; o < hi; o++) {
    if (buf[o] !== 0xff || buf[o + 1] !== 0x15) continue;
    if (!slots.has(rvaOf(o + 6) + buf.readInt32LE(o + 2))) continue;
    calls++;
    let found = false;
    for (let b = o - 7; b >= Math.max(text.raw, o - window); b--) {
      if ((buf[b] !== 0x48 && buf[b] !== 0x4c) || buf[b + 1] !== 0x8d) continue;
      if ((buf[b + 2] & 0xc7) !== 0x05) continue;
      const at = rvaToOffset(sections, rvaOf(b + 7) + buf.readInt32LE(b + 3));
      const s = at > 0 ? asciiAt(buf, at) : null;
      if (s === null) continue;
      const prior = byOffset.get(at);
      if (prior) prior.sites.push(o);
      else byOffset.set(at, { offset: at, text: s, sites: [o] });
      found = true;
      break;
    }
    if (!found) unresolved++;
  }
  return {
    calls,
    unresolved,
    literals: [...byOffset.values()].sort((a, b) => a.offset - b.offset),
  };
}

// ── String runs ──────────────────────────────────────────────────────────────

/** NUL-bounded text at `offset` that may also hold tab, LF and CR (multi-line descriptions). */
function textAt(buf: Buffer, offset: number): string | null {
  if (offset <= 0 || offset >= buf.length || buf[offset - 1] !== 0) return null;
  let j = offset;
  while (j < buf.length && (printable(buf[j]) || buf[j] === 9 || buf[j] === 10 || buf[j] === 13))
    j++;
  if (j === offset || j >= buf.length || buf[j] !== 0) return null;
  return buf.toString("latin1", offset, j);
}

/**
 * The NUL-bounded strings (two characters or more; printable ASCII plus tab,
 * LF and CR) that follow the string starting at `offset`, in order. NUL
 * padding is skipped; any other bytes are taken as 8-byte words (pointers),
 * and the run ends after more than `maxGapWords` such words in a row or at
 * `range.hi`.
 */
export function stringRunAfter(
  buf: Buffer,
  offset: number,
  range: ByteRange,
  maxGapWords = 4,
): FoundString[] {
  const first = asciiAt(buf, offset);
  if (first === null) return [];
  const hi = Math.min(range.hi, buf.length);
  const out: FoundString[] = [];
  let p = offset + first.length + 1;
  let gap = 0;
  while (p < hi) {
    if (buf[p] === 0) {
      p++;
      continue;
    }
    const s = textAt(buf, p);
    if (s !== null && s.length >= 2) {
      out.push({ offset: p, text: s });
      p += s.length + 1;
      gap = 0;
      continue;
    }
    if (++gap > maxGapWords) break;
    p = (Math.floor(p / 8) + 1) * 8;
  }
  return out;
}

// ── Candidate label vocabularies (counted, not emitted without a container) ──

/** A menu or action label with a mnemonic marker (`&File`, `Find &File`). */
export const MNEMONIC_LABEL = /^(?=.*&[A-Za-z0-9])[^%\t]{2,64}$/;

/** A default-shortcut literal (`Ctrl+Shift+S`, `F7`, `Alt+Left`). */
export const SHORTCUT_LITERAL =
  /^(?:(?:Ctrl|Shift|Alt|Meta)\+)+(?:[A-Z0-9`\-=[\]\\;',./]|F\d{1,2}|Left|Right|Up|Down|Home|End|PgUp|PgDown|PageUp|PageDown|Ins|Insert|Del|Delete|Space|Tab|Esc|Escape|Backspace|Return|Enter)$|^F\d{1,2}$/;

/** Qt object names of actions, menus, docks and toolbars (naming conventions of Qt Designer). */
export const OBJECT_NAME_CANDIDATE =
  /^(?:(?:action|menu)[A-Z][A-Za-z0-9_]*|[a-z][A-Za-z0-9_]*(?:Dock|DockWidget|ToolBar|Toolbar)(?:_?\d+)?|dockWidget(?:_\d+)?|toolBar(?:_\d+)?)$/;
