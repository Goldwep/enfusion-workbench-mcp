/**
 * `ui_localization_audit` — coverage report for declared StringTables in a
 * `.gproj`. For every (StringTableSource .st, LanguageDefinition .conf) pair
 * we parse both files and diff keys → missing / orphan entries plus a count.
 *
 * Pure file parsing — no Workbench connection or DB required.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFileSync, existsSync } from "node:fs";
import { isAbsolute, resolve, dirname } from "node:path";
import { parse, type EnfusionNode } from "../formats/enfusion-text.js";

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

/** Top-level audit payload — `tables` is the per-declared-StringTable list. */
export interface AuditReport {
  gprojPath: string;
  tables: StringTableAudit[];
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
 * Pull every key declared by a parsed .st file. The format is the same
 * Enfusion text grammar; keys live in either a top-level `Keys { ... }`
 * container OR as flat `Key "name"` properties. We accept both shapes and
 * also walk any descendant nodes so .st files that wrap keys in nested
 * Packages / Tables stay covered.
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
 * Pull every translated key from a runtime .conf. Mirrors `extractStKeys`
 * but tolerates the alternate `Entries { Entry { Key "..." Value "..." } }`
 * shape some runtime variants use.
 */
export function extractRuntimeKeys(confRoot: EnfusionNode): Set<string> {
  const keys = new Set<string>();
  function visit(node: EnfusionNode): void {
    for (const prop of node.properties) {
      if (prop.key === "Key" && typeof prop.value === "string" && prop.value !== "") {
        keys.add(prop.value);
      } else if (typeof prop.value !== "string") {
        visit(prop.value);
      }
    }
    if (node.type === "Key" && node.id) keys.add(node.id);
    if (node.type === "Entry") {
      const k = stringValue(node, "Key");
      if (k) keys.add(k);
    }
    for (const child of node.children) visit(child);
  }
  visit(confRoot);
  return keys;
}

/**
 * Run the audit pipeline given an already-resolved gproj path. I/O lives in
 * this helper so the registration handler can stay thin, and so tests can
 * point it at synthetic fixture dirs.
 */
export function runLocalizationAudit(absGprojPath: string): AuditReport {
  const gprojContent = readFileSync(absGprojPath, "utf-8");
  const gprojRoot = parse(gprojContent);
  const projectDir = dirname(absGprojPath);
  const decls = extractStringTableDecls(gprojRoot);

  const tables: StringTableAudit[] = [];
  for (const decl of decls) {
    const absSourcePath = resolveProjectRelative(projectDir, decl.sourcePath);
    let declaredKeys: Set<string> = new Set();
    let sourceFound = false;
    if (existsSync(absSourcePath)) {
      sourceFound = true;
      try {
        declaredKeys = extractStKeys(parse(readFileSync(absSourcePath, "utf-8")));
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
          runtimeKeys = extractRuntimeKeys(parse(readFileSync(absRuntime, "utf-8")));
        } catch {
          // Same as source — keep empty and let the report surface zero coverage.
        }
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

    tables.push({
      sourcePath: decl.sourcePath,
      sourceFound,
      declaredCount: declaredKeys.size,
      languages,
    });
  }

  return { gprojPath: absGprojPath, tables };
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
        lines.push(`- **Missing (${lang.missingKeys.length}):** ${lang.missingKeys.slice(0, 25).join(", ")}${lang.missingKeys.length > 25 ? " ..." : ""}`);
      }
      if (lang.orphanKeys.length > 0) {
        lines.push(`- **Orphan (${lang.orphanKeys.length}):** ${lang.orphanKeys.slice(0, 25).join(", ")}${lang.orphanKeys.length > 25 ? " ..." : ""}`);
      }
      lines.push("");
    }
  }
  return lines.join("\n").trimEnd();
}

// ── Registration ─────────────────────────────────────────────────────────────

export function registerUiLocalizationAudit(server: McpServer): void {
  server.registerTool(
    "ui_localization_audit",
    {
      description:
        "Audit localization coverage for a .gproj. Walks every declared StringTableDefinition, parses the source .st and each language's runtime .conf, " +
        "and reports missing keys / orphan entries / per-language counts. Pure file parsing — no Workbench connection required.",
      inputSchema: {
        gproj_path: z
          .string()
          .min(1)
          .describe("Path to a .gproj file. Absolute or relative to MCP cwd."),
      },
    },
    async ({ gproj_path }) => {
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
        const resolved = isAbsolute(gproj_path)
          ? gproj_path
          : resolve(process.cwd(), gproj_path);
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
        const report = runLocalizationAudit(resolved);
        const text = formatAuditReport(report);
        return { content: [{ type: "text" as const, text }] };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [
            { type: "text" as const, text: `Error auditing localization: ${msg}` },
          ],
          isError: true,
        };
      }
    },
  );
}
