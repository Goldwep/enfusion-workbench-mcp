/**
 * `ui_localization_audit` — coverage report for declared StringTables in a
 * `.gproj`. For every (StringTableSource .st, LanguageDefinition .conf) pair
 * we parse both files and diff keys → missing / orphan entries plus a count.
 *
 * Pure file parsing — no Workbench connection or DB required.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, resolve, dirname, relative, join } from "node:path";
import { parse, type EnfusionNode } from "../formats/enfusion-text.js";
import { parseCstBytes } from "../formats/enfusion-cst.js";
import { readSt } from "./string-table.js";

// ── Types ────────────────────────────────────────────────────────────────────

/** Per-language coverage row in the audit report. */
export interface LanguageCoverage {
  /** Language code (e.g. "en_us", "fr_fr"). */
  code: string;
  /** Path string from the .gproj (typically relative to project root). */
  runtimePath: string;
  /** True when the runtime .conf was found on disk. */
  runtimeFound: boolean;
  /** Translated key count present in the runtime file. */
  translatedCount: number;
  /** Keys declared in the .st but missing from the runtime. */
  missingKeys: string[];
  /** Keys translated in the runtime but not declared in the .st. */
  orphanKeys: string[];
}

/** One StringTable block from the .gproj — source .st + N languages. */
export interface StringTableAudit {
  /** Path string from the .gproj (typically relative to project root). */
  sourcePath: string;
  /** True when the .st file was found on disk. */
  sourceFound: boolean;
  /** Total keys declared in the source .st. */
  declaredCount: number;
  /** Per-language coverage rows. */
  languages: LanguageCoverage[];
}

/** One text key referenced from layouts but defined in no scanned string table. */
export interface MissingRef {
  key: string;
  /** Number of references across all scanned layouts. */
  count: number;
  /** Up to three layouts (project-relative, forward slashes) that reference it. */
  files: string[];
}

/** A reference whose key exists only under a different letter case. */
export interface CaseMismatch extends MissingRef {
  /** The defined spelling it matches case-insensitively. */
  definedAs: string;
}

/** Layout-side half of the audit: `#KEY` references against the defined keys. */
export interface LayoutAudit {
  layoutFiles: number;
  /** Layouts the parser rejected; scanned by string-literal regex instead. */
  parseFallbacks: number;
  totalRefs: number;
  distinctRefs: number;
  /** Keys defined by the declared tables (runtime Ids and .st keys) plus `extra_tables`. */
  definedKeys: number;
  missing: MissingRef[];
  caseMismatches: CaseMismatch[];
  /** Defined in a declared (project) table but referenced by no layout. */
  unused: string[];
}

/** Top-level audit payload — `tables` is the per-declared-StringTable list. */
export interface AuditReport {
  gprojPath: string;
  tables: StringTableAudit[];
  /** Present when the project directory holds at least one `.layout`. */
  layouts?: LayoutAudit;
}

// ── Helpers (exported for tests) ─────────────────────────────────────────────

/**
 * Walk the parsed .gproj tree and collect every StringTableDefinition node
 * along with its declared language entries. Returns the raw paths as strings
 * — callers are responsible for resolving them against the .gproj directory.
 */
export function extractStringTableDecls(
  gproj: EnfusionNode,
): { sourcePath: string; languages: { code: string; runtimePath: string }[] }[] {
  // .gproj layout per the spec:
  //   StringTables {
  //     StringTableDefinition {
  //       StringTableSource "ui/language/default.st"
  //       Languages {
  //         LanguageDefinition { Code "en_us"  StringTableRuntime "ui/language/default.en_us.conf" }
  //       }
  //     }
  //   }
  const out: { sourcePath: string; languages: { code: string; runtimePath: string }[] }[] = [];

  const stringTablesContainer = findFirstChild(gproj, "StringTables");
  if (!stringTablesContainer) return out;

  for (const def of stringTablesContainer.children) {
    if (def.type !== "StringTableDefinition") continue;
    const sourcePath = stringValue(def, "StringTableSource");
    if (!sourcePath) continue;

    const langsContainer = findFirstChild(def, "Languages");
    const languages: { code: string; runtimePath: string }[] = [];
    if (langsContainer) {
      for (const lang of langsContainer.children) {
        if (lang.type !== "LanguageDefinition") continue;
        const code = stringValue(lang, "Code") ?? "";
        const runtimePath = stringValue(lang, "StringTableRuntime") ?? "";
        if (code && runtimePath) {
          languages.push({ code, runtimePath });
        }
      }
    }
    out.push({ sourcePath, languages });
  }
  return out;
}

/** Find first direct child of `node` whose type matches `name`. */
function findFirstChild(node: EnfusionNode, name: string): EnfusionNode | undefined {
  for (const c of node.children) {
    if (c.type === name) return c;
  }
  return undefined;
}

/** First string property value with the given key. */
function stringValue(node: EnfusionNode, key: string): string | undefined {
  for (const p of node.properties) {
    if (p.key === key && typeof p.value === "string") return p.value;
  }
  return undefined;
}

/**
 * The Ids a `.st` declares: `Items[].Id` of its `StringTable` block, read through the
 * `string_table` parser (`readSt` on the lossless CST; W3 spec section 2.5). The engine reads a
 * BaseContainer `StringTable { Items { CustomStringTableItem { Id "..." ... } } }`; the 1.x
 * extractor looked for XML-style `Key` entries and found none in a real table.
 *
 * A file with no `StringTable`/`Items` block (an older hand-made shape) falls back to
 * `extractStKeys`; a file neither reads yields no Ids.
 */
export function readStIds(bytes: Uint8Array): string[] {
  try {
    const table = readSt(parseCstBytes(bytes));
    if (table.items) {
      const ids: string[] = [];
      const seen = new Set<string>();
      for (const it of table.list) {
        if (it.id === "" || seen.has(it.id)) continue;
        seen.add(it.id);
        ids.push(it.id);
      }
      return ids;
    }
  } catch {
    /* not a StringTable: try the older shape */
  }
  try {
    return [...extractStKeys(parse(Buffer.from(bytes).toString("utf-8")))];
  } catch {
    return [];
  }
}

/**
 * Legacy shape only (before the W3 fix): `Key "name"` properties or `Key` nodes anywhere in a
 * parsed file. A real `.st` holds none of these; `readStIds` reads `Items[].Id` first.
 */
export function extractStKeys(stRoot: EnfusionNode): Set<string> {
  const keys = new Set<string>();
  function visit(node: EnfusionNode): void {
    for (const prop of node.properties) {
      if (prop.key === "Key" && typeof prop.value === "string" && prop.value !== "") {
        keys.add(prop.value);
      } else if (typeof prop.value !== "string") {
        visit(prop.value);
      }
    }
    // A common shape is a Key node with an `id` carrying the key name.
    if (node.type === "Key" && node.id) keys.add(node.id);
    for (const child of node.children) visit(child);
  }
  visit(stRoot);
  return keys;
}

/**
 * Keys of a parsed `StringTableRuntime`: the quoted entries of its `Ids`
 * block (vanilla `Language/localization.en_us.conf`, `ui/language/default.en_us.conf`:
 * `StringTableRuntime { Ids { "AR-Key" ... } Texts { "text" ... } }`, `Texts`
 * parallel to `Ids`). Entries of the older `Key "..."` / `Entry { Key }`
 * shape are still collected. Note: the shared parser rejects most vanilla
 * runtime tables because of their `Texts` block (12 of 14 in the corpus);
 * file readers should call `readRuntimeIds` instead.
 */
export function extractRuntimeKeys(confRoot: EnfusionNode): Set<string> {
  const keys = new Set<string>();
  function visit(node: EnfusionNode): void {
    if (node.type === "Ids") for (const v of node.values) if (v !== "") keys.add(v);
    for (const prop of node.properties) {
      if (prop.key === "Key" && typeof prop.value === "string" && prop.value !== "") {
        keys.add(prop.value);
      } else if (typeof prop.value !== "string") {
        visit(prop.value);
      }
    }
    if (node.type === "Key" && node.id) keys.add(node.id);
    for (const child of node.children) visit(child);
  }
  visit(confRoot);
  return keys;
}

/**
 * Key names of a runtime string table, from its text. Isolates the `Ids`
 * block (from the line `Ids {` to the next line that is only `}`) and parses
 * just that, so a `Texts` block the parser cannot read does not cost the
 * keys. Falls back to a whole-document parse for other layouts of the file.
 */
export function readRuntimeIds(text: string): string[] {
  const start = /^[ \t]*Ids[ \t]*\{[ \t]*\r?$/m.exec(text);
  if (start) {
    const rest = text.slice(start.index + start[0].length);
    const end = /^[ \t]*\}[ \t]*\r?$/m.exec(rest);
    const body = end ? rest.slice(0, end.index) : rest;
    try {
      const ids = parse(`Ids {${body}\n}`);
      if (ids.type === "Ids") return ids.values.filter((v) => v !== "");
    } catch {
      /* fall through */
    }
  }
  try {
    return [...extractRuntimeKeys(parse(text))];
  } catch {
    return [];
  }
}

/** A `#KEY` text-key reference (`Text "#AR-Foo"`, or inside markup text). */
const REF_RE = /#([A-Za-z][A-Za-z0-9_\-.]*)/g;
/** `#FF8800`-style colour codes inside rich text are not keys. */
const HEX_COLOR_RE = /^(?:[0-9A-Fa-f]{3,4}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/;

function refsInString(value: string, into: Map<string, number>): void {
  for (const m of value.matchAll(REF_RE)) {
    const key = m[1].replace(/[.\-]+$/, "");
    if (key === "" || HEX_COLOR_RE.test(key)) continue;
    into.set(key, (into.get(key) ?? 0) + 1);
  }
}

/**
 * Every `#KEY` reference in one `.layout`, as key to count. Walks the parsed
 * tree (string properties and bare values); when the parser rejects the file
 * it scans quoted literals instead, and `fallback` is true.
 */
export function extractLayoutRefs(text: string): { refs: Map<string, number>; fallback: boolean } {
  const refs = new Map<string, number>();
  try {
    const root = parse(text);
    const visit = (node: EnfusionNode): void => {
      for (const v of node.values) refsInString(v, refs);
      for (const p of node.properties) {
        if (typeof p.value === "string") refsInString(p.value, refs);
        else visit(p.value);
      }
      for (const c of node.children) visit(c);
    };
    visit(root);
    return { refs, fallback: false };
  } catch {
    for (const m of text.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)) refsInString(m[1], refs);
    return { refs, fallback: true };
  }
}

/**
 * Run the audit pipeline given an already-resolved gproj path. I/O lives in
 * this helper so the registration handler can stay thin, and so tests can
 * point it at synthetic fixture dirs.
 */
export function runLocalizationAudit(
  absGprojPath: string,
  options: { extraTables?: string[] } = {},
): AuditReport {
  const gprojContent = readFileSync(absGprojPath, "utf-8");
  const gprojRoot = parse(gprojContent);
  const projectDir = dirname(absGprojPath);
  const decls = extractStringTableDecls(gprojRoot);

  const tables: StringTableAudit[] = [];
  /** Every key a layout may reference, and the ones owned by this project's tables. */
  const defined = new Set<string>();
  const owned = new Set<string>();
  for (const decl of decls) {
    const absSourcePath = resolveProjectRelative(projectDir, decl.sourcePath);
    let declaredKeys: Set<string> = new Set();
    let sourceFound = false;
    if (existsSync(absSourcePath)) {
      sourceFound = true;
      try {
        declaredKeys = new Set(readStIds(readFileSync(absSourcePath)));
      } catch {
        // Parser failures leave declaredKeys empty so the report still renders.
      }
    }

    const languages: LanguageCoverage[] = [];
    for (const lang of decl.languages) {
      const absRuntime = resolveProjectRelative(projectDir, lang.runtimePath);
      let runtimeKeys: Set<string> = new Set();
      let runtimeFound = false;
      if (existsSync(absRuntime)) {
        runtimeFound = true;
        try {
          runtimeKeys = new Set(readRuntimeIds(readFileSync(absRuntime, "utf-8")));
        } catch {
          // Same as source — keep empty and let the report surface zero coverage.
        }
      }
      for (const k of runtimeKeys) {
        defined.add(k);
        owned.add(k);
      }
      const missing: string[] = [];
      const orphan: string[] = [];
      for (const k of declaredKeys) if (!runtimeKeys.has(k)) missing.push(k);
      for (const k of runtimeKeys) if (!declaredKeys.has(k)) orphan.push(k);
      missing.sort();
      orphan.sort();
      languages.push({
        code: lang.code,
        runtimePath: lang.runtimePath,
        runtimeFound,
        translatedCount: runtimeKeys.size,
        missingKeys: missing,
        orphanKeys: orphan,
      });
    }

    for (const k of declaredKeys) {
      defined.add(k);
      owned.add(k);
    }
    tables.push({
      sourcePath: decl.sourcePath,
      sourceFound,
      declaredCount: declaredKeys.size,
      languages,
    });
  }

  for (const extra of options.extraTables ?? []) {
    const abs = resolveProjectRelative(projectDir, extra);
    if (!existsSync(abs)) continue;
    for (const k of readRuntimeIds(readFileSync(abs, "utf-8"))) defined.add(k);
  }

  const layouts = auditLayouts(projectDir, defined, owned);
  return { gprojPath: absGprojPath, tables, ...(layouts ? { layouts } : {}) };
}

const SKIP_DIRS = new Set(["node_modules", ".git", ".vs", "logs", "cache"]);

/** Every `.layout` under `dir`, as absolute paths, in sorted order. */
function findLayouts(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    let names: string[];
    try {
      names = readdirSync(d).sort();
    } catch {
      return;
    }
    for (const name of names) {
      const full = join(d, name);
      let isDir = false;
      try {
        isDir = statSync(full).isDirectory();
      } catch {
        continue;
      }
      if (isDir) {
        if (!SKIP_DIRS.has(name.toLowerCase())) walk(full);
      } else if (name.toLowerCase().endsWith(".layout")) {
        out.push(full);
      }
    }
  };
  walk(dir);
  return out;
}

/** Diff the `#KEY` references of every layout under the project against the defined keys. */
function auditLayouts(
  projectDir: string,
  defined: Set<string>,
  owned: Set<string>,
): LayoutAudit | undefined {
  const files = findLayouts(projectDir);
  if (files.length === 0) return undefined;

  const byKey = new Map<string, { count: number; files: string[] }>();
  let parseFallbacks = 0;
  let totalRefs = 0;
  for (const f of files) {
    let text: string;
    try {
      text = readFileSync(f, "utf-8");
    } catch {
      continue;
    }
    const { refs, fallback } = extractLayoutRefs(text);
    if (fallback) parseFallbacks++;
    const rel = relative(projectDir, f).split("\\").join("/");
    for (const [key, n] of refs) {
      totalRefs += n;
      const e = byKey.get(key) ?? { count: 0, files: [] };
      e.count += n;
      if (e.files.length < 3 && !e.files.includes(rel)) e.files.push(rel);
      byKey.set(key, e);
    }
  }

  const lowerDefined = new Map<string, string>();
  for (const k of [...defined].sort()) {
    const lk = k.toLowerCase();
    if (!lowerDefined.has(lk)) lowerDefined.set(lk, k);
  }
  const missing: MissingRef[] = [];
  const caseMismatches: CaseMismatch[] = [];
  const referencedLower = new Set<string>();
  for (const [key, e] of [...byKey].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    referencedLower.add(key.toLowerCase());
    if (defined.has(key)) continue;
    const other = lowerDefined.get(key.toLowerCase());
    if (other) caseMismatches.push({ key, ...e, definedAs: other });
    else missing.push({ key, ...e });
  }
  const unused = [...owned].filter((k) => !referencedLower.has(k.toLowerCase())).sort();
  return {
    layoutFiles: files.length,
    parseFallbacks,
    totalRefs,
    distinctRefs: byKey.size,
    definedKeys: defined.size,
    missing,
    caseMismatches,
    unused,
  };
}

/** Resolve a path that may be project-relative or absolute. */
function resolveProjectRelative(projectDir: string, p: string): string {
  return isAbsolute(p) ? p : resolve(projectDir, p);
}

/** Format the audit as a markdown coverage report. Pure — no I/O. */
export function formatAuditReport(report: AuditReport): string {
  const lines: string[] = [];
  lines.push(`# Localization audit: ${report.gprojPath}`);
  lines.push("");
  if (report.tables.length === 0) {
    lines.push("_No StringTables declared in this .gproj._");
    if (report.layouts) appendLayouts(lines, report.layouts);
    return lines.join("\n");
  }
  for (const t of report.tables) {
    lines.push(`## StringTable: ${t.sourcePath}`);
    lines.push("");
    lines.push(`- **Source on disk:** ${t.sourceFound ? "yes" : "MISSING"}`);
    lines.push(`- **Declared keys:** ${t.declaredCount}`);
    lines.push(`- **Languages:** ${t.languages.length}`);
    lines.push("");
    if (t.languages.length === 0) {
      lines.push("_No language definitions declared._");
      lines.push("");
      continue;
    }
    lines.push("| Code | Translated | Missing | Orphan | Runtime found |");
    lines.push("|---|---|---|---|---|");
    for (const lang of t.languages) {
      lines.push(
        `| ${lang.code} | ${lang.translatedCount} | ${lang.missingKeys.length} | ${lang.orphanKeys.length} | ${lang.runtimeFound ? "yes" : "no"} |`,
      );
    }
    lines.push("");
    for (const lang of t.languages) {
      if (lang.missingKeys.length === 0 && lang.orphanKeys.length === 0) continue;
      lines.push(`### ${lang.code}`);
      if (lang.missingKeys.length > 0) {
        lines.push(
          `- **Missing (${lang.missingKeys.length}):** ${lang.missingKeys.slice(0, 25).join(", ")}${lang.missingKeys.length > 25 ? " ..." : ""}`,
        );
      }
      if (lang.orphanKeys.length > 0) {
        lines.push(
          `- **Orphan (${lang.orphanKeys.length}):** ${lang.orphanKeys.slice(0, 25).join(", ")}${lang.orphanKeys.length > 25 ? " ..." : ""}`,
        );
      }
      lines.push("");
    }
  }
  if (report.layouts) appendLayouts(lines, report.layouts);
  return lines.join("\n").trimEnd();
}

function appendLayouts(lines: string[], l: LayoutAudit): void {
  lines.push("", "## Layout references", "");
  const fb = l.parseFallbacks
    ? ` (${l.parseFallbacks} read by literal scan: parser rejected them)`
    : "";
  lines.push(`- **Layouts scanned:** ${l.layoutFiles}${fb}`);
  lines.push(
    `- **References:** ${l.totalRefs} (${l.distinctRefs} distinct keys); **defined keys:** ${l.definedKeys}`,
  );
  lines.push(`- **Missing (${l.missing.length}):** referenced, defined in no scanned table`);
  for (const m of l.missing.slice(0, 50)) {
    lines.push(`  - \`${m.key}\` x${m.count}: ${m.files.join(", ")}`);
  }
  if (l.missing.length > 50) lines.push(`  - ... ${l.missing.length - 50} more`);
  if (l.caseMismatches.length > 0) {
    lines.push(
      `- **Case-only mismatches (${l.caseMismatches.length}):** engine case-insensitivity is not verified`,
    );
    for (const m of l.caseMismatches.slice(0, 25)) {
      lines.push(`  - \`${m.key}\` x${m.count} vs \`${m.definedAs}\`: ${m.files.join(", ")}`);
    }
    if (l.caseMismatches.length > 25) lines.push(`  - ... ${l.caseMismatches.length - 25} more`);
  }
  const names = l.unused.slice(0, 25).join(", ") + (l.unused.length > 25 ? " ..." : "");
  lines.push(
    `- **Unused (${l.unused.length}):** defined in a declared table, referenced by no layout${l.unused.length ? ": " + names : ""}`,
  );
}

// ── Registration ─────────────────────────────────────────────────────────────

export function registerUiLocalizationAudit(server: McpServer): void {
  server.registerTool(
    "ui_localization_audit",
    {
      description:
        "Audit localization coverage for a .gproj. Walks every declared StringTableDefinition, parses the source .st and each language's runtime .conf, " +
        "and reports missing keys / orphan entries / per-language counts, then scans every .layout under the project for #KEY references and reports missing, case-only-mismatched and unused keys with counts and file references. Pure file parsing — no Workbench connection required.",
      inputSchema: {
        gproj_path: z
          .string()
          .min(1)
          .describe("Path to a .gproj file. Absolute or relative to MCP cwd."),
        extra_tables: z
          .array(z.string().min(1))
          .optional()
          .describe(
            "Extra runtime string tables (.conf with an Ids block; project-relative or absolute) whose keys count as defined, e.g. an extracted vanilla Language/localization.en_us.conf. Their keys are never reported unused.",
          ),
      },
    },
    async ({ gproj_path, extra_tables }) => {
      try {
        if (gproj_path.startsWith("-")) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error auditing localization: path cannot start with '-': ${gproj_path}`,
              },
            ],
            isError: true,
          };
        }
        const resolved = isAbsolute(gproj_path) ? gproj_path : resolve(process.cwd(), gproj_path);
        if (!existsSync(resolved)) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error auditing localization: file not found at ${resolved}`,
              },
            ],
            isError: true,
          };
        }
        const report = runLocalizationAudit(resolved, { extraTables: extra_tables });
        const text = formatAuditReport(report);
        return { content: [{ type: "text" as const, text }] };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [{ type: "text" as const, text: `Error auditing localization: ${msg}` }],
          isError: true,
        };
      }
    },
  );
}
