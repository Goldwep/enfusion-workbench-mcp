/**
 * Object Import CSV: the file `SCR_ObjectImportPlugin` reads (wave W6, phase5-w6-spec.md section 4).
 *
 * One entity per line in the vanilla column order `Prefab,x,y,z,qx,qy,qz,qw,scale`. The vanilla
 * plugin takes comma or whitespace separators and ignores fields past the ninth (so a line may carry
 * a comment); a header line, if any, is the first non-blank line and has no number in the eight
 * numeric columns. Numbers are kept as the text the file holds, so nothing drifts through a float.
 *
 * The parse is lossless: every line keeps its text and its line ending, and `serialize(parse(t))`
 * returns `t` byte for byte for any text. `formatCsv` writes the canonical form (comma separated,
 * one row per line, `\n` or `\r\n` after every line); for canonical text
 * `formatCsv(rowsOf(parse(t)), { header, eol })` returns `t` as well.
 *
 * The handler row is `prefab;x y z;qx qy qz qw;scale` (EMCP_WB_WorldTools importObjects and
 * exportObjects). The z flip, the quaternion sign change and the yaw and pitch swap of the vanilla
 * plugin happen Workbench-side, so the conversion here is a pure change of separators.
 */

export const CSV_COLUMNS = ["Prefab", "x", "y", "z", "qx", "qy", "qz", "qw", "scale"] as const;
export const CSV_HEADER = CSV_COLUMNS.join(",");
export const CSV_FIELDS = CSV_COLUMNS.length;

const BOM = "﻿";
/** A number as the handler's ParseFloat and Enforce's ToFloat both read it. */
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
/** `{GUID}` or `{GUID}path`: the handler looks prefabs up by GUID. */
const PREFAB = /^\{[0-9A-Fa-f]{16}\}[^;,]*$/;

/** One entity: numbers as text, exactly as the file or the handler wrote them. */
export interface ObjectRow {
  prefab: string;
  position: [string, string, string];
  quaternion: [string, string, string, string];
  scale: string;
}

export type LineKind = "blank" | "header" | "row" | "invalid";

export interface CsvLine {
  /** The line's text without its line ending. */
  text: string;
  /** "\n", "\r\n" or "" (the last line without one). */
  eol: string;
  kind: LineKind;
  /** 1-based line number in the file. */
  line: number;
  row?: ObjectRow;
  /** Fields past the ninth (the vanilla plugin ignores them). */
  extra?: string[];
  /** Why an invalid line is invalid. */
  error?: string;
}

export interface CsvDoc {
  bom: boolean;
  lines: CsvLine[];
  /** True when the first non-blank line is a header. */
  header: boolean;
}

export function isNumberText(s: string): boolean {
  return NUMBER.test(s);
}

/** Fields of one line: split on commas when it has one, else on whitespace; outer quotes dropped. */
export function splitFields(text: string): string[] {
  const t = text.trim();
  if (t === "") return [];
  const parts = t.includes(",") ? t.split(",").map((f) => f.trim()) : t.split(/\s+/);
  return parts.map((f) =>
    f.length >= 2 && f.startsWith('"') && f.endsWith('"') ? f.slice(1, -1) : f,
  );
}

/** Checks the nine fields of a row; returns the row or the reason it is not one. */
export function rowFromFields(fields: string[]): { row: ObjectRow } | { error: string } {
  if (fields.length < CSV_FIELDS) {
    return { error: `expected ${CSV_FIELDS} fields (${CSV_HEADER}), got ${fields.length}` };
  }
  const [prefab, x, y, z, qx, qy, qz, qw, scale] = fields as [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  if (!PREFAB.test(prefab)) {
    return { error: `the prefab must be {GUID}path (16 hex digits in braces), got '${prefab}'` };
  }
  const named: Array<[string, string]> = [
    ["x", x],
    ["y", y],
    ["z", z],
    ["qx", qx],
    ["qy", qy],
    ["qz", qz],
    ["qw", qw],
    ["scale", scale],
  ];
  for (const [name, value] of named) {
    if (!NUMBER.test(value)) return { error: `${name} is not a number: '${value}'` };
  }
  const q = [qx, qy, qz, qw].map(Number);
  if (q.some((n) => !Number.isFinite(n)) || q.every((n) => n === 0)) {
    return { error: "the quaternion has zero length" };
  }
  const s = Number(scale);
  if (!Number.isFinite(s) || s <= 0) return { error: `scale must be above 0, got '${scale}'` };
  if ([x, y, z].map(Number).some((n) => !Number.isFinite(n))) {
    return { error: "a position component is not finite" };
  }
  return { row: { prefab, position: [x, y, z], quaternion: [qx, qy, qz, qw], scale } };
}

function looksLikeHeader(fields: string[]): boolean {
  if (fields.length < CSV_FIELDS) return false;
  return fields.slice(1, CSV_FIELDS).every((f) => !NUMBER.test(f));
}

/** Parses CSV text losslessly. Never throws: a line that is not a row is kept as `invalid`. */
export function parse(input: string): CsvDoc {
  const bom = input.startsWith(BOM);
  const text = bom ? input.slice(1) : input;
  const lines: CsvLine[] = [];
  let header = false;
  let seenContent = false;
  let pos = 0;
  let n = 0;
  while (pos < text.length) {
    const nl = text.indexOf("\n", pos);
    let body: string;
    let eol: string;
    if (nl < 0) {
      body = text.slice(pos);
      eol = "";
      pos = text.length;
    } else if (nl > pos && text[nl - 1] === "\r") {
      body = text.slice(pos, nl - 1);
      eol = "\r\n";
      pos = nl + 1;
    } else {
      body = text.slice(pos, nl);
      eol = "\n";
      pos = nl + 1;
    }
    n++;
    const fields = splitFields(body);
    const line: CsvLine = { text: body, eol, kind: "blank", line: n };
    if (fields.length > 0) {
      if (!seenContent && looksLikeHeader(fields)) {
        line.kind = "header";
        header = true;
      } else {
        const r = rowFromFields(fields);
        if ("row" in r) {
          line.kind = "row";
          line.row = r.row;
          if (fields.length > CSV_FIELDS) line.extra = fields.slice(CSV_FIELDS);
        } else {
          line.kind = "invalid";
          line.error = r.error;
        }
      }
      seenContent = true;
    }
    lines.push(line);
  }
  return { bom, lines, header };
}

/** The text back, byte for byte: every line's text and line ending, the BOM if there was one. */
export function serialize(doc: CsvDoc): string {
  return (doc.bom ? BOM : "") + doc.lines.map((l) => l.text + l.eol).join("");
}

/** The rows of a document, in file order. */
export function rowsOf(doc: CsvDoc): ObjectRow[] {
  return doc.lines.filter((l) => l.kind === "row").map((l) => l.row!);
}

/** The invalid lines of a document. */
export function invalidLines(doc: CsvDoc): CsvLine[] {
  return doc.lines.filter((l) => l.kind === "invalid");
}

/** One row as a canonical CSV line (no line ending). */
export function formatRow(row: ObjectRow): string {
  return [row.prefab, ...row.position, ...row.quaternion, row.scale].join(",");
}

/** Canonical CSV text: optional header, one row per line, `eol` after every line. */
export function formatCsv(
  rows: readonly ObjectRow[],
  opts: { header?: boolean; eol?: "\n" | "\r\n" } = {},
): string {
  const eol = opts.eol ?? "\n";
  const lines = rows.map(formatRow);
  if (opts.header ?? true) lines.unshift(CSV_HEADER);
  return lines.map((l) => l + eol).join("");
}

/** The handler row `prefab;x y z;qx qy qz qw;scale`. */
export function toHandlerRow(row: ObjectRow): string {
  return `${row.prefab};${row.position.join(" ")};${row.quaternion.join(" ")};${row.scale}`;
}

/**
 * A handler row (`prefab;x y z;qx qy qz qw;scale`, commas allowed inside the vectors as the
 * handler allows them) as an ObjectRow, or the reason it is not one.
 */
export function fromHandlerRow(text: string): { row: ObjectRow } | { error: string } {
  const parts = text.split(";");
  if (parts.length !== 4) {
    return { error: `expected prefab;x y z;qx qy qz qw;scale, got ${parts.length} fields` };
  }
  const vec = (s: string) =>
    s
      .replace(/,/g, " ")
      .trim()
      .split(/\s+/)
      .filter((t) => t !== "");
  const pos = vec(parts[1]!);
  const quat = vec(parts[2]!);
  if (pos.length !== 3) return { error: `position: expected 3 numbers, got ${pos.length}` };
  if (quat.length !== 4) return { error: `quaternion: expected 4 numbers, got ${quat.length}` };
  return rowFromFields([parts[0]!.trim(), ...pos, ...quat, parts[3]!.trim()]);
}
