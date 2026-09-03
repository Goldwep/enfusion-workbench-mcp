/**
 * `ui_extract_strings` — find hardcoded text in `.layout` widget Text
 * properties and `.c` SetText / Set*-style calls that should probably be
 * `#AR-key` localization tokens.
 *
 * For .layout: walks the parsed widget tree and flags every `Text "..."`
 * property whose value does NOT start with `#`.
 *
 * For .c: regex-based detection — we don't have an Enforce parser yet, so
 * we look for `SetText("...")` and `widget.Set*("...")` literal forms.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFileSync, existsSync } from "node:fs";
import { isAbsolute, resolve, extname } from "node:path";
import { parse, type EnfusionNode } from "../formats/enfusion-text.js";

// ── Types ────────────────────────────────────────────────────────────────────

/** One hardcoded-string suggestion. */
export interface StringSuggestion {
  /** Absolute path to the file the literal lives in. */
  file: string;
  /** Source-file line (1-indexed) when known; 0 when the source was parsed
   *  without line tracking (currently the .layout case). */
  line: number;
  /** The literal we'd recommend extracting to a localization token. */
  text: string;
  /** Property key for .layout findings (e.g. "Text"), or call name for .c. */
  context: string;
}

// ── Helpers (exported for tests) ─────────────────────────────────────────────

/**
 * Property keys whose value is user-facing UI text and ought to live in the
 * string table rather than be hardcoded. `Tooltip` and `Hint` are common
 * accessibility text — same rule applies.
 */
const LAYOUT_TEXT_KEYS = new Set<string>(["Text", "Tooltip", "Hint"]);

/**
 * Walk the parsed .layout tree and find every text-bearing property whose
 * value isn't already a `#AR-key` token. Pure — operates on a parsed root.
 */
export function findLayoutHardcodedStrings(
  root: EnfusionNode,
  filePath: string,
): StringSuggestion[] {
  const suggestions: StringSuggestion[] = [];
  function visit(node: EnfusionNode): void {
    for (const prop of node.properties) {
      if (typeof prop.value === "string" && LAYOUT_TEXT_KEYS.has(prop.key)) {
        const literal = prop.value;
        // Already localized (#AR-MyKey) — fine.
        if (literal.startsWith("#")) continue;
        // Empty string isn't worth flagging — every "blank" widget would hit.
        if (literal.trim() === "") continue;
        suggestions.push({
          file: filePath,
          line: 0,
          text: literal,
          context: prop.key,
        });
      } else if (typeof prop.value !== "string") {
        visit(prop.value);
      }
    }
    for (const c of node.children) visit(c);
  }
  visit(root);
  return suggestions;
}

/**
 * Regex-based scan of a `.c` script for SetText-style calls passing string
 * literals. Returns one suggestion per matched literal. Comment-stripping
 * keeps the regex from flagging documentation examples.
 */
export function findScriptHardcodedStrings(
  source: string,
  filePath: string,
): StringSuggestion[] {
  const suggestions: StringSuggestion[] = [];
  // Strip /* ... */ comments and // ... line comments so the regex doesn't
  // false-positive on docs. Done in a non-destructive way (preserve line
  // count) by replacing comment characters with spaces.
  const stripped = stripComments(source);

  // Patterns we care about:
  //   SetText("literal")  — common SCR_HUD pattern
  //   widget.Set*("literal")  — generic setter taking a single quoted arg
  // We only flag literals that do NOT start with `#`. The regex captures
  // the call name and the quoted string in separate groups so we can
  // tag the context cleanly.
  const callRe = /\b(Set(?:Text|Title|Description|Tooltip|Label|Header)(?:UTF8)?)\s*\(\s*"((?:[^"\\]|\\.)*)"/g;
  const lines = stripped.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m: RegExpExecArray | null;
    callRe.lastIndex = 0;
    while ((m = callRe.exec(line)) !== null) {
      const literal = m[2];
      if (literal.startsWith("#")) continue;
      if (literal.trim() === "") continue;
      suggestions.push({
        file: filePath,
        line: i + 1,
        text: literal,
        context: m[1],
      });
    }
  }
  return suggestions;
}

/**
 * Remove /* ... *\/ and // ... comment bodies, replacing them with spaces so
 * line numbers stay aligned with the original source. Pure.
 */
function stripComments(source: string): string {
  // Block comments first — handled greedily across newlines, preserving the
  // newline count by keeping `\n` characters intact in the replacement.
  let out = source.replace(/\/\*[\s\S]*?\*\//g, (m) =>
    m.replace(/[^\n]/g, " "),
  );
  out = out.replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));
  return out;
}

/** Render suggestions as a markdown list. Pure. */
export function formatSuggestions(
  filePath: string,
  suggestions: StringSuggestion[],
): string {
  const lines: string[] = [];
  lines.push(`# Hardcoded string scan: ${filePath}`);
  lines.push("");
  if (suggestions.length === 0) {
    lines.push("_No hardcoded UI strings found — everything looks localized._");
    return lines.join("\n");
  }
  lines.push(`Found **${suggestions.length}** literal(s) that should probably be #AR-keys:`);
  lines.push("");
  for (const s of suggestions) {
    const loc = s.line > 0 ? `${s.file}:${s.line}` : s.file;
    lines.push(`- consider localizing \`"${s.text}"\` at ${loc} (${s.context})`);
  }
  return lines.join("\n").trimEnd();
}

// ── Registration ─────────────────────────────────────────────────────────────

const ACCEPTED_EXT = new Set<string>([".layout", ".c"]);

export function registerUiExtractStrings(server: McpServer): void {
  server.registerTool(
    "ui_extract_strings",
    {
      description:
        "Scan a .layout or .c file for hardcoded UI text that should probably be a #AR-key localization token. " +
        "For .layout: walks the parsed widget tree and flags every `Text`, `Tooltip`, or `Hint` property whose value does not start with `#`. " +
        "For .c: regex-scans for SetText / Set*-style calls passing a string literal. " +
        "Pure file parsing — no Workbench connection required.",
      inputSchema: {
        target_path: z
          .string()
          .min(1)
          .describe("Path to a .layout or .c file. Absolute or relative to MCP cwd."),
      },
    },
    async ({ target_path }) => {
      try {
        if (target_path.startsWith("-")) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error extracting strings: path cannot start with '-': ${target_path}`,
              },
            ],
            isError: true,
          };
        }
        const resolved = isAbsolute(target_path)
          ? target_path
          : resolve(process.cwd(), target_path);
        const ext = extname(resolved).toLowerCase();
        if (!ACCEPTED_EXT.has(ext)) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error extracting strings: unsupported extension "${ext}" — expected .layout or .c`,
              },
            ],
            isError: true,
          };
        }
        if (!existsSync(resolved)) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error extracting strings: file not found at ${resolved}`,
              },
            ],
            isError: true,
          };
        }
        const content = readFileSync(resolved, "utf-8");
        let suggestions: StringSuggestion[];
        if (ext === ".layout") {
          suggestions = findLayoutHardcodedStrings(parse(content), resolved);
        } else {
          suggestions = findScriptHardcodedStrings(content, resolved);
        }
        const text = formatSuggestions(resolved, suggestions);
        return { content: [{ type: "text" as const, text }] };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [
            { type: "text" as const, text: `Error extracting strings: ${msg}` },
          ],
          isError: true,
        };
      }
    },
  );
}
