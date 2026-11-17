import type { ParamInfo } from "../index/types.js";

/**
 * Signature helpers shared by the Doxygen parser and the source backfill.
 *
 * The parameter list of a Doxygen member row is split at the commas that sit
 * at nesting depth 0: a generic's comma (`map< string, int >`), a comma inside
 * a call in a default value (`Color.FromInt(Color.WHITE)`, `Vector(0, 0, 0)`)
 * and a comma inside a string literal do not split. `splitSignatureParams` is
 * the splitter of the E12 enumerator (scripts/census/enumerators/e12-api-index.ts),
 * so the params array the scraper writes has exactly as many entries as E12
 * counts for the signature.
 */

const OPENERS = new Set(["(", "[", "{", "<"]);
const CLOSERS = new Set(["]", "}", ">"]);

/**
 * The parameter texts of a signature: everything between the first `(` and
 * its matching `)`, split at depth-0 commas. Empty segments are dropped.
 */
export function splitSignatureParams(signature: string): string[] {
  const i = signature.indexOf("(");
  if (i < 0) return [];
  const out: string[] = [];
  let depth = 0;
  let quote = false;
  let from = i + 1;
  let end = signature.length;
  for (let j = i + 1; j < signature.length; j++) {
    const ch = signature[j];
    if (quote) {
      if (ch === "\\") j++;
      else if (ch === '"') quote = false;
      continue;
    }
    if (ch === '"') quote = true;
    else if (OPENERS.has(ch)) depth++;
    else if (CLOSERS.has(ch)) depth = Math.max(0, depth - 1);
    else if (ch === ")") {
      if (depth === 0) {
        end = j;
        break;
      }
      depth--;
    } else if (ch === "," && depth === 0) {
      out.push(signature.slice(from, j));
      from = j + 1;
    }
  }
  out.push(signature.slice(from, end));
  return out.map((t) => t.trim()).filter((t) => t !== "");
}

/** Number of parameters a signature states (a generic's comma counts once). */
export function signatureArity(signature: string): number {
  return splitSignatureParams(signature).length;
}

/** Index of the first `=` at depth 0 outside a string literal, or -1. */
function defaultSeparator(text: string): number {
  let depth = 0;
  let quote = false;
  for (let j = 0; j < text.length; j++) {
    const ch = text[j];
    if (quote) {
      if (ch === "\\") j++;
      else if (ch === '"') quote = false;
      continue;
    }
    if (ch === '"') quote = true;
    else if (OPENERS.has(ch)) depth++;
    else if (CLOSERS.has(ch) || ch === ")") depth = Math.max(0, depth - 1);
    else if (ch === "=" && depth === 0) return j;
  }
  return -1;
}

/**
 * One parameter text as the index stores it: the last whitespace-separated
 * token before the default is the name, the tokens before it the type
 * (modifiers such as `out` included), the text after `=` the default value.
 * A text of one token is a type with no name.
 */
export function parseParamText(text: string): ParamInfo | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  let defaultValue = "";
  let mainPart = trimmed;
  const eq = defaultSeparator(trimmed);
  if (eq !== -1) {
    defaultValue = trimmed.slice(eq + 1).trim();
    mainPart = trimmed.slice(0, eq).trim();
  }
  const tokens = mainPart.split(/\s+/).filter(Boolean);
  if (tokens.length >= 2) {
    return {
      name: tokens[tokens.length - 1],
      type: tokens.slice(0, -1).join(" "),
      defaultValue,
    };
  }
  if (tokens.length === 1) return { name: "", type: tokens[0], defaultValue };
  return undefined;
}

/** The params array of a member row's text (`Name (int a, map< K, V > m=null)`). */
export function parseParamsFromSignature(sigText: string): ParamInfo[] {
  const params: ParamInfo[] = [];
  for (const part of splitSignatureParams(sigText)) {
    const p = parseParamText(part);
    if (p) params.push(p);
  }
  return params;
}

/** Method name of a signature: the identifier before the first `(`. */
export function signatureName(signature: string): string | undefined {
  const i = signature.indexOf("(");
  if (i < 0) return undefined;
  return /(~?[A-Za-z_]\w*)\s*$/.exec(signature.slice(0, i))?.[1];
}

/** Class name behind a Doxygen page title: drops the title suffix and the template parameter list. */
export function normalizeClassName(raw: string): string {
  const t = raw
    .replace(/\s*(?:Interface|Class)?\s*Template Reference\s*$/, "")
    .replace(/\s*(?:Interface|Class) Reference\s*$/, "")
    .trim();
  const lt = t.indexOf("<");
  return (lt > 0 ? t.slice(0, lt) : t).trim();
}

/** Leading words of a Doxygen `returnType` that are method modifiers, not part of the type. */
export const METHOD_MODIFIERS: ReadonlySet<string> = new Set([
  "static",
  "proto",
  "native",
  "external",
  "override",
  "event",
  "private",
  "protected",
  "sealed",
  "volatile",
]);

const TYPE_LEAD_MODIFIERS = new Set(["out", "inout", "notnull", "const"]);
const TYPE_DROPPED = new Set(["ref", "autoptr", "owned"]);

/**
 * A type for comparison: whitespace-insensitive, leading `out`/`inout`/`notnull`/`const`
 * sorted, `ref`/`autoptr`/`owned` dropped, and Doxygen's `TypeName` read as
 * `typename`. The same rules as E12's `normalizeType`.
 */
export function normalizeType(t: string): string {
  const tokens = t.trim().split(/\s+/).filter(Boolean);
  const lead: string[] = [];
  while (tokens.length > 0 && (TYPE_LEAD_MODIFIERS.has(tokens[0]) || TYPE_DROPPED.has(tokens[0]))) {
    const tok = tokens.shift() as string;
    if (TYPE_LEAD_MODIFIERS.has(tok)) lead.push(tok);
  }
  lead.sort();
  const core = tokens
    .join("")
    .replace(/\s+/g, "")
    .replace(/typename/gi, "typename");
  return [...lead, core].join(" ");
}

/** A return type for comparison: as `normalizeType`, without `notnull`. */
export function normalizeReturn(t: string): string {
  return normalizeType(
    t
      .trim()
      .split(/\s+/)
      .filter((w) => w !== "notnull")
      .join(" "),
  );
}

/** The type of one parameter text (`notnull map< K, V > m=null` gives `notnull map< K, V >`). */
export function typeOfParamText(text: string): string {
  const eq = defaultSeparator(text);
  return (eq === -1 ? text : text.slice(0, eq)).trim().replace(/\s+[A-Za-z_]\w*$/, "");
}
