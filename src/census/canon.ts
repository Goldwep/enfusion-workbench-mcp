/**
 * Canonical serialisation for every census file (determinism rules of the
 * ledger brief): code-unit ordering, sorted object keys, LF only, a trailing
 * newline, no BOM, no timestamps.
 *
 * Two writers:
 *  - `jsonlLine` / `toJsonl` for JSONL files: one compact object per line,
 *    keys sorted recursively, except that a caller may give an explicit
 *    top-level key order (the ledger row order from `ROW_FIELD_ORDER`).
 *  - `formatJson` for JSON files: 2-space indentation in the shape that
 *    `prettier --write` (parser json, printWidth 100) leaves unchanged, so
 *    `npm run format` never rewrites a generated file.
 */
import { createHash } from "node:crypto";

// ── Ordering ──────────────────────────────────────────────────────────────────

/** Plain code-unit comparison; never `localeCompare` (ICU-dependent). */
export function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * JSON text of a value whose objects were turned into ordered entry lists by
 * `toOrdered`. Building the text by hand keeps integer-like keys in the
 * chosen order (V8 would hoist them in a plain object).
 */
function stringifyOrdered(v: unknown): string {
  if (Array.isArray(v) && v.length > 0 && isEntryList(v)) {
    return `{${v.map(([k, x]) => `${JSON.stringify(k)}:${stringifyOrdered(x)}`).join(",")}}`;
  }
  if (Array.isArray(v)) return `[${v.map((x) => stringifyOrdered(x)).join(",")}]`;
  return JSON.stringify(v);
}

// Entry lists produced by toOrdered are marked so a real array of pairs is
// never mistaken for an object.
const ENTRY_LIST = Symbol("entry-list");

function isEntryList(v: unknown[]): boolean {
  return (v as unknown as { [ENTRY_LIST]?: true })[ENTRY_LIST] === true;
}

function toOrdered(value: unknown, firstKeys: readonly string[] = []): unknown {
  if (Array.isArray(value)) return value.map((v) => toOrdered(v));
  if (!isPlainObject(value)) return value;
  const keys = Object.keys(value).filter((k) => value[k] !== undefined);
  const head = firstKeys.filter((k) => keys.includes(k));
  const tail = keys.filter((k) => !head.includes(k)).sort(compareCodeUnits);
  const entries = [...head, ...tail].map((k) => [k, toOrdered(value[k])] as [string, unknown]);
  if (entries.length === 0) return EMPTY_OBJECT;
  (entries as unknown as { [ENTRY_LIST]: true })[ENTRY_LIST] = true;
  return entries;
}

const EMPTY_OBJECT = Object.freeze({});

/** One canonical JSONL line (no trailing newline). */
export function jsonlLine(value: unknown, firstKeys: readonly string[] = []): string {
  return stringifyOrdered(toOrdered(value, firstKeys));
}

/** Canonical JSONL text: one line per value, LF, trailing newline; empty string for none. */
export function toJsonl(values: readonly unknown[], firstKeys: readonly string[] = []): string {
  if (values.length === 0) return "";
  return values.map((v) => jsonlLine(v, firstKeys)).join("\n") + "\n";
}

// ── Prettier-compatible JSON ──────────────────────────────────────────────────

/** prettier `printWidth` from `.prettierrc`. */
export const PRINT_WIDTH = 100;

/** One-line form of a value, or null when it holds a non-empty object (which always breaks). */
function oneLine(v: unknown): string | null {
  if (v === EMPTY_OBJECT) return "{}";
  if (Array.isArray(v)) {
    if (isEntryList(v)) return null;
    const parts: string[] = [];
    for (const x of v) {
      const p = oneLine(x);
      if (p === null) return null;
      parts.push(p);
    }
    return `[${parts.join(", ")}]`;
  }
  return JSON.stringify(v);
}

/**
 * Formats an ordered value (from `toOrdered`) the way prettier's JSON printer
 * does for a document whose objects are all written expanded: non-empty
 * objects always break; an array breaks when it holds a non-empty object or
 * an array, or when its one-line form would pass `PRINT_WIDTH`.
 */
function printJson(v: unknown, indent: number, prefixWidth: number, suffixWidth: number): string {
  const pad = " ".repeat(indent);
  const inner = " ".repeat(indent + 2);
  if (Array.isArray(v) && isEntryList(v)) {
    const parts = (v as [string, unknown][]).map(([k, x], i) => {
      const key = `${JSON.stringify(k)}: `;
      const comma = i < v.length - 1 ? 1 : 0;
      return `${inner}${key}${printJson(x, indent + 2, indent + 2 + key.length, comma)}`;
    });
    return `{\n${parts.join(",\n")}\n${pad}}`;
  }
  if (Array.isArray(v)) {
    if (v.length === 0) return "[]";
    const allArrays = v.every((x) => Array.isArray(x) && !isEntryList(x));
    const forceBreak = v.length > 1 && allArrays && v.every((x) => (x as unknown[]).length > 1);
    const one = forceBreak ? null : oneLine(v);
    if (one !== null && prefixWidth + one.length + suffixWidth <= PRINT_WIDTH) return one;
    const parts = v.map((x, i) => {
      const comma = i < v.length - 1 ? 1 : 0;
      return `${inner}${printJson(x, indent + 2, indent + 2, comma)}`;
    });
    return `[\n${parts.join(",\n")}\n${pad}]`;
  }
  if (v === EMPTY_OBJECT) return "{}";
  return JSON.stringify(v);
}

/**
 * Canonical JSON file text: keys sorted (with `firstKeys` first at the top
 * level, `$comment` always first), 2-space indent, trailing newline.
 */
export function formatJson(value: unknown, firstKeys: readonly string[] = []): string {
  const ordered = toOrdered(value, ["$comment", ...firstKeys]);
  return printJson(ordered, 0, 0, 0) + "\n";
}

// ── Hashing and text hygiene ──────────────────────────────────────────────────

/** sha256 hex of a string or buffer. */
export function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Splits file text into lines, tolerating a BOM, CRLF and one trailing blank line. */
export function splitLines(text: string): string[] {
  const t = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const lines = t.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}
