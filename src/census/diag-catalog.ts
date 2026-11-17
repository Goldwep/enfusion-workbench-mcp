/**
 * The Diag Menu catalog of `wb_diag catalog` (wave W8, phase5-w8-spec.md sections 2.4 and 4,
 * DEC-076): every script diag id (the `SCR_DebugMenuID` enum of `DebugMenuID.c`, plus any modded
 * value, flagged with its `#ifdef` guard) and every engine diag id (the `EDiagMenu` enum), taken
 * from the E02 source index, with the kind, menu path, label and value list of the
 * `DiagMenu.Register*` call that registers it in the pak scripts.
 *
 *   RegisterMenu(id, name, parent)                       kind menu
 *   RegisterBool(id, shortcut, name, parent[, reverse])  kind bool
 *   RegisterItem(id, shortcut, name, parent, values)     kind value
 *   RegisterRange(id, shortcut, name, parent, values)    kind range
 *   an EDiagMenu value (registered by the engine)        kind engine
 *   a script id with no Register* call found, or calls of different kinds: kind unknown
 *
 * `wb_diag set` refuses an id of kind unknown or menu. A menu path joins the parent menus named by
 * RegisterMenu calls with "/" (a parent no script registers, such as an engine menu, is the root).
 * Only string literals are read; an argument that is an expression leaves its field empty.
 *
 * Written by `scripts/census/gen-diag-catalog.ts` into `data/census/diag-catalog.json`
 * (deterministic, no dates, no machine paths); read by `src/tools/wb-diag.ts`.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { compareCodeUnits, formatJson } from "./canon.js";
import { CensusDataError, DEFAULT_CENSUS_ROOT } from "./ledger-io.js";
import {
  findEnum,
  type EnumValueRecord,
  type SourceIndex,
  type SourceInput,
} from "./source-index.js";

export const DIAG_CATALOG_VERSION = 1;
export const DIAG_CATALOG_GENERATOR = "scripts/census/gen-diag-catalog.ts";
export const DIAG_CATALOG_FILE = join(DEFAULT_CENSUS_ROOT, "diag-catalog.json");

export const SCRIPT_ENUM = "SCR_DebugMenuID";
export const ENGINE_ENUM = "EDiagMenu";

export const DIAG_KINDS = ["menu", "bool", "value", "range", "engine", "unknown"] as const;
export type DiagKind = (typeof DIAG_KINDS)[number];

const REGISTER_KIND: Record<string, DiagKind> = {
  Menu: "menu",
  Bool: "bool",
  Item: "value",
  Range: "range",
};

// ── Types ─────────────────────────────────────────────────────────────────────

/** One Register* call on a SCR_DebugMenuID value. */
export interface DiagRegistration {
  enumName: string;
  kind: DiagKind;
  /** The menu's name (RegisterMenu) or the option's label; "" when not a literal. */
  label: string;
  /** The parent menu name; "" for a root menu or when not a literal. */
  parent: string;
  /** RegisterItem values or RegisterRange "min, max, default, step"; "" otherwise. */
  values: string;
  shortcut: string;
  /** False when the parent argument is not a string literal. */
  parentKnown: boolean;
  file: string;
  line: number;
}

export interface DiagEntry {
  enumName: string;
  enum: typeof SCRIPT_ENUM | typeof ENGINE_ENUM;
  /** The enum value as the engine numbers it; null when it cannot be told offline (a modded value). */
  id: number | null;
  kind: DiagKind;
  /** Menu path with "/" ("" when unregistered, or an engine id). */
  path: string;
  label: string;
  values: string;
  shortcut: string;
  /** The `#ifdef` guard(s) of the enum value, joined with "&" ("" when unguarded). */
  guard: string;
  /** `file:line` of the enum value. */
  declared: string;
  /** `file:line` of the first Register* call ("" when none). */
  registered: string;
  /** Register* calls found for this id. */
  registrations: number;
}

export interface DiagCatalog {
  $diag_catalog: number;
  build: string;
  generator: string;
  sources: {
    /** inputs_sha256 of the E02 index the enums came from. */
    index_inputs_sha256: string;
    scripts_scanned: number;
    /** Register* calls whose id is a SCR_DebugMenuID value. */
    register_calls: number;
    /** Register* calls with any other id expression (not catalogued). */
    register_calls_other: number;
  };
  counts: {
    script: number;
    script_guarded: number;
    engine: number;
    registered: number;
    unknown: number;
  };
  entries: DiagEntry[];
}

// ── Source scanning ───────────────────────────────────────────────────────────

/**
 * The text with every comment replaced by spaces (newlines kept, so offsets and line numbers hold).
 * With `blankStrings`, string literal contents are blanked too (the quotes stay).
 */
export function maskSource(text: string, blankStrings = false): string {
  const out = text.split("");
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    const d = text[i + 1];
    if (c === "/" && d === "/") {
      while (i < n && text[i] !== "\n") out[i++] = " ";
      continue;
    }
    if (c === "/" && d === "*") {
      out[i++] = " ";
      out[i++] = " ";
      while (i < n && !(text[i] === "*" && text[i + 1] === "/")) {
        if (text[i] !== "\n") out[i] = " ";
        i++;
      }
      if (i < n) {
        out[i++] = " ";
        out[i++] = " ";
      }
      continue;
    }
    if (c === '"') {
      i++;
      while (i < n && text[i] !== '"' && text[i] !== "\n") {
        if (text[i] === "\\" && i + 1 < n && text[i + 1] !== "\n") {
          if (blankStrings) out[i] = out[i + 1] = " ";
          i += 2;
          continue;
        }
        if (blankStrings) out[i] = " ";
        i++;
      }
      i++;
      continue;
    }
    i++;
  }
  return out.join("");
}

/** The top-level arguments of a call whose "(" sits at `open`; null when it never closes. */
function callArgs(text: string, open: number): string[] | null {
  const args: string[] = [];
  let depth = 0;
  let start = open + 1;
  for (let i = open + 1; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      i++;
      while (i < text.length && text[i] !== '"' && text[i] !== "\n") {
        if (text[i] === "\\") i++;
        i++;
      }
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      if (depth === 0) {
        if (c !== ")") return null;
        const last = text.slice(start, i).trim();
        if (last !== "" || args.length > 0) args.push(last);
        return args;
      }
      depth--;
    } else if (c === "," && depth === 0) {
      args.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  return null;
}

const STRING_LITERAL = /^"((?:[^"\\\n]|\\.)*)"$/;

/** The value of a string literal argument, or undefined for any other expression. */
function literal(arg: string | undefined): string | undefined {
  if (arg === undefined) return undefined;
  const m = STRING_LITERAL.exec(arg);
  if (!m) return undefined;
  return m[1].replace(/\\(.)/g, (_all, ch: string) => (ch === "n" ? "\n" : ch === "t" ? "\t" : ch));
}

const SCRIPT_ID_ARG = new RegExp(`^${SCRIPT_ENUM}\\s*\\.\\s*([A-Za-z_][A-Za-z0-9_]*)$`);
const REGISTER_CALL = /\bDiagMenu\s*\.\s*Register(Menu|Item|Bool|Range)\s*\(/g;

/** Every DiagMenu.Register{Menu,Item,Bool,Range} call of one source file, outside comments. */
export function findRegistrations(
  file: string,
  text: string,
): { registrations: DiagRegistration[]; other: number } {
  const masked = maskSource(text);
  const search = maskSource(text, true);
  const registrations: DiagRegistration[] = [];
  let other = 0;
  REGISTER_CALL.lastIndex = 0;
  for (let m = REGISTER_CALL.exec(search); m; m = REGISTER_CALL.exec(search)) {
    const open = m.index + m[0].length - 1;
    const args = callArgs(masked, open);
    if (!args || args.length === 0) {
      other++;
      continue;
    }
    const idm = SCRIPT_ID_ARG.exec(args[0]);
    if (!idm) {
      other++;
      continue;
    }
    const call = m[1];
    const line = search.slice(0, m.index).split("\n").length;
    const isMenu = call === "Menu";
    const labelArg = isMenu ? args[1] : args[2];
    const parentArg = isMenu ? args[2] : args[3];
    const parent = literal(parentArg);
    registrations.push({
      enumName: idm[1],
      kind: REGISTER_KIND[call],
      label: literal(labelArg) ?? "",
      parent: parent ?? "",
      values: call === "Item" || call === "Range" ? (literal(args[4]) ?? "") : "",
      shortcut: isMenu ? "" : (literal(args[1]) ?? ""),
      parentKnown: parent !== undefined,
      file,
      line,
    });
  }
  return { registrations, other };
}

// ── Building ──────────────────────────────────────────────────────────────────

/** True for a script source that may hold a Register call (cheap pre-filter). */
export function mayRegister(text: string): boolean {
  return text.includes("DiagMenu");
}

/** The values of an enum, those of its non-modded declarations first, each group in file order. */
function orderedValues(
  index: SourceIndex,
  name: string,
): { value: EnumValueRecord; modded: boolean }[] {
  const e = findEnum(index, name);
  if (!e) return [];
  const moddedFiles = new Set(e.declarations.filter((d) => d.modded).map((d) => d.file));
  const tagged = e.values.map((value) => ({ value, modded: moddedFiles.has(value.file) }));
  return [...tagged.filter((t) => !t.modded), ...tagged.filter((t) => t.modded)];
}

/** Engine ids of the non-modded values: an integer literal resets the count, else previous + 1. */
function numberValues(values: { value: EnumValueRecord; modded: boolean }[]): (number | null)[] {
  let next: number | null = 0;
  return values.map(({ value, modded }) => {
    if (modded) return null;
    if (value.value !== undefined) {
      const t = value.value.trim();
      next = /^-?\d+$/.test(t) ? Number(t) : /^0x[0-9a-f]+$/i.test(t) ? parseInt(t, 16) : null;
    }
    const id = next;
    next = next === null ? null : next + 1;
    return id;
  });
}

function menuPaths(regs: DiagRegistration[]): Map<string, string> {
  const parentOf = new Map<string, { parent: string; known: boolean }>();
  for (const r of regs) {
    if (r.kind !== "menu" || r.label === "" || parentOf.has(r.label)) continue;
    parentOf.set(r.label, { parent: r.parent, known: r.parentKnown });
  }
  const memo = new Map<string, string>();
  const pathOf = (label: string, seen: Set<string>): string => {
    const hit = memo.get(label);
    if (hit !== undefined) return hit;
    const p = parentOf.get(label);
    let path: string;
    if (!p) path = label;
    else if (!p.known) path = "";
    else if (p.parent === "") path = label;
    else if (seen.has(p.parent)) path = label;
    else {
      seen.add(label);
      const up = parentOf.has(p.parent) ? pathOf(p.parent, seen) : p.parent;
      path = up === "" ? "" : `${up}/${label}`;
    }
    memo.set(label, path);
    return path;
  };
  for (const label of parentOf.keys()) pathOf(label, new Set());
  return memo;
}

function pathOfRegistration(r: DiagRegistration, menus: Map<string, string>): string {
  if (r.kind === "menu") return r.label === "" ? "" : (menus.get(r.label) ?? r.label);
  if (!r.parentKnown) return "";
  const base = r.parent === "" ? "" : (menus.get(r.parent) ?? r.parent);
  if (r.parent !== "" && base === "") return "";
  if (r.label === "") return base;
  return base === "" ? r.label : `${base}/${r.label}`;
}

export interface BuildInput {
  index: SourceIndex;
  /** Script sources to scan for Register calls (the pak scripts, or test excerpts). */
  sources: Iterable<SourceInput>;
}

/** The catalog of every SCR_DebugMenuID and EDiagMenu value of the index. Deterministic. */
export function buildDiagCatalog(input: BuildInput): DiagCatalog {
  const regs: DiagRegistration[] = [];
  let scanned = 0;
  let other = 0;
  const sources = [...input.sources].sort((a, b) => compareCodeUnits(a.path, b.path));
  for (const s of sources) {
    scanned++;
    if (!mayRegister(s.text)) continue;
    const found = findRegistrations(s.path, s.text);
    regs.push(...found.registrations);
    other += found.other;
  }
  const menus = menuPaths(regs);
  const byName = new Map<string, DiagRegistration[]>();
  for (const r of regs) {
    const l = byName.get(r.enumName);
    if (l) l.push(r);
    else byName.set(r.enumName, [r]);
  }

  const entries: DiagEntry[] = [];
  const script = orderedValues(input.index, SCRIPT_ENUM);
  const scriptIds = numberValues(script);
  script.forEach(({ value }, i) => {
    const found = byName.get(value.name) ?? [];
    const first = found[0];
    const kinds = new Set(found.map((r) => r.kind));
    entries.push({
      enumName: value.name,
      enum: SCRIPT_ENUM,
      id: scriptIds[i],
      kind: !first || kinds.size > 1 ? "unknown" : first.kind,
      path: first ? pathOfRegistration(first, menus) : "",
      label: first?.label ?? "",
      values: first?.values ?? "",
      shortcut: first?.shortcut ?? "",
      guard: value.guards.join("&"),
      declared: `${value.file}:${value.line}`,
      registered: first ? `${first.file}:${first.line}` : "",
      registrations: found.length,
    });
  });
  const engine = orderedValues(input.index, ENGINE_ENUM);
  const engineIds = numberValues(engine);
  engine.forEach(({ value }, i) => {
    entries.push({
      enumName: value.name,
      enum: ENGINE_ENUM,
      id: engineIds[i],
      kind: "engine",
      path: "",
      label: "",
      values: "",
      shortcut: "",
      guard: value.guards.join("&"),
      declared: `${value.file}:${value.line}`,
      registered: "",
      registrations: 0,
    });
  });

  const scriptEntries = entries.filter((e) => e.enum === SCRIPT_ENUM);
  return {
    $diag_catalog: DIAG_CATALOG_VERSION,
    build: input.index.header.build,
    generator: DIAG_CATALOG_GENERATOR,
    sources: {
      index_inputs_sha256: input.index.header.inputs_sha256,
      scripts_scanned: scanned,
      register_calls: regs.length,
      register_calls_other: other,
    },
    counts: {
      script: scriptEntries.length,
      script_guarded: scriptEntries.filter((e) => e.guard !== "").length,
      engine: entries.length - scriptEntries.length,
      registered: scriptEntries.filter((e) => e.registrations > 0).length,
      unknown: scriptEntries.filter((e) => e.kind === "unknown").length,
    },
    entries,
  };
}

/** The catalog file text (canonical JSON, trailing newline). */
export function diagCatalogText(c: DiagCatalog): string {
  return formatJson(c, ["$diag_catalog", "build", "generator", "sources", "counts", "entries"]);
}

// ── Loading ───────────────────────────────────────────────────────────────────

const ENTRY_SCHEMA = z.object({
  enumName: z.string().min(1),
  enum: z.enum([SCRIPT_ENUM, ENGINE_ENUM]),
  id: z.number().int().nullable(),
  kind: z.enum(DIAG_KINDS),
  path: z.string(),
  label: z.string(),
  values: z.string(),
  shortcut: z.string(),
  guard: z.string(),
  declared: z.string(),
  registered: z.string(),
  registrations: z.number().int().min(0),
});

const CATALOG_SCHEMA = z.object({
  $diag_catalog: z.literal(DIAG_CATALOG_VERSION),
  build: z.string(),
  generator: z.string(),
  sources: z.object({
    index_inputs_sha256: z.string(),
    scripts_scanned: z.number().int(),
    register_calls: z.number().int(),
    register_calls_other: z.number().int(),
  }),
  counts: z.object({
    script: z.number().int(),
    script_guarded: z.number().int(),
    engine: z.number().int(),
    registered: z.number().int(),
    unknown: z.number().int(),
  }),
  entries: z.array(ENTRY_SCHEMA),
});

/** Checks a parsed catalog; throws CensusDataError naming the first problem. */
export function parseDiagCatalog(value: unknown, displayName = "diag-catalog.json"): DiagCatalog {
  const r = CATALOG_SCHEMA.safeParse(value);
  if (!r.success) {
    const i = r.error.issues[0];
    throw new CensusDataError(`${displayName}: ${i.path.join(".") || "(root)"}: ${i.message}`);
  }
  const seen = new Set<string>();
  for (const e of r.data.entries) {
    if (seen.has(e.enumName)) {
      throw new CensusDataError(`${displayName}: ${e.enumName} is listed twice`);
    }
    seen.add(e.enumName);
  }
  return r.data;
}

/** The catalog file, or undefined when it has not been generated. Throws on a malformed file. */
export function loadDiagCatalog(file: string = DIAG_CATALOG_FILE): DiagCatalog | undefined {
  if (!existsSync(file)) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(file, "utf-8"));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new CensusDataError(`diag-catalog.json: not valid JSON (${msg})`);
  }
  return parseDiagCatalog(value);
}

// ── Reading ───────────────────────────────────────────────────────────────────

/** The contract row "path;enumName;kind;values" (a ";" inside a field becomes ","). */
export function catalogRow(e: DiagEntry): string {
  const f = (s: string) => s.replace(/;/g, ",").replace(/[\r\n]+/g, " ");
  return `${f(e.path)};${e.enumName};${e.kind};${f(e.values)}`;
}

/** Entries whose path is `menu` or lies under it (segment-wise, case-insensitive); all when "". */
export function filterByMenu(entries: readonly DiagEntry[], menu: string): DiagEntry[] {
  const want = menu
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .toLowerCase();
  if (want === "") return [...entries];
  return entries.filter((e) => {
    const p = e.path.toLowerCase();
    return p === want || p.startsWith(`${want}/`);
  });
}

/** The entry of an enum name (exact case), or undefined. */
export function findDiagEntry(c: DiagCatalog, enumName: string): DiagEntry | undefined {
  return c.entries.find((e) => e.enumName === enumName);
}
