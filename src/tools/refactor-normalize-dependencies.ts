/**
 * `refactor_normalize_dependencies` — sort + dedupe + validate the
 * `Dependencies { ... }` block in a .gproj (L5-4).
 *
 * Why: a hand-edited .gproj's Dependencies list often accumulates
 * unsorted/duplicated entries across merges. This tool produces a
 * canonical form that round-trips cleanly.
 *
 * Behavior:
 *   - Sorts dep GUIDs ascending (canonical uppercase).
 *   - Deduplicates exact-match entries.
 *   - Validates each entry is a 16-hex GUID; flags malformed entries.
 *   - Optional: validates each GUID resolves via ProjectIndex
 *     (`--check_resolution`). Unresolvable deps are reported but NOT
 *     removed (could be intentional workshop deps).
 *
 * Safety per L4-2 byte-edit doctrine: dry-run by default, .bak sidecar,
 * git-clean refuse, atomicCommit.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolve, basename } from "node:path";
import { z } from "zod";
import { atomicCommit, type PendingEdit } from "../refactor/byte-edit.js";
import { ProjectIndex } from "../project-index/project-index.js";
import { loadConfig, type Config } from "../config.js";
import { assertInsideAnyRoot } from "../utils/path-guard.js";
import { readTextFileBounded } from "../utils/safe-read.js";

const GUID_RE = /^[0-9A-Fa-f]{16}$/;
const GUID_LINE_RE = /^"?([0-9A-Fa-f]{16})"?$/;
// `Dependencies` keyword at a token boundary, followed by optional
// whitespace and the opening brace. The block END is found by brace-depth
// scanning (RBE-7 / M13) — a `[^}]*` regex stopped at the first `}` and
// orphaned the tail of any block containing nested braces.
const DEPS_OPEN_RE = /(?<![A-Za-z0-9_])Dependencies(\s*)\{/;

/** Located Dependencies block: absolute offsets into the file content. */
export interface DepsBlock {
  /** Offset of the `D` in `Dependencies`. */
  start: number;
  /** Offset just past the closing `}`. */
  end: number;
  /** Whitespace between the keyword and `{` (preserved on rewrite). */
  ws: string;
  /** Raw text between `{` and the matching `}`. */
  body: string;
}

/**
 * Find the first `Dependencies { ... }` block, honouring nested braces and
 * quoted strings so the closing brace is the one at the SAME depth.
 * Returns null when there's no block or the braces are unbalanced.
 */
export function findDepsBlock(content: string): DepsBlock | null {
  const m = DEPS_OPEN_RE.exec(content);
  if (!m) return null;
  const openIdx = m.index + m[0].length - 1; // index of `{`
  let depth = 0;
  let inString = false;
  for (let i = openIdx; i < content.length; i++) {
    const ch = content[i];
    if (inString) {
      if (ch === "\\") i += 1;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return {
          start: m.index,
          end: i + 1,
          ws: m[1],
          body: content.slice(openIdx + 1, i),
        };
      }
    }
  }
  return null;
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

export interface DepEntry {
  guid: string;
  valid: boolean;
  /** Set when `check_resolution` flagged the GUID as unresolved. */
  unresolved: boolean;
}

export interface ParsedDepBody {
  /** Trimmed entries in file order: canonical-upper GUIDs plus any non-GUID lines (for reporting). */
  entries: string[];
  /** Trimmed, non-empty lines of the body. */
  raw: string[];
  /** Non-GUID lines, UNTRIMMED — re-emitted byte-for-byte on rewrite. */
  passthrough: string[];
  /** Leading whitespace of the first GUID line (default one space, Enfusion style). */
  indent: string;
  /** Line-ending style detected in the body (falls back to the caller's file-level EOL). */
  eol: "\r\n" | "\n" | null;
  /** Whitespace between the final EOL and the closing `}` (the brace's indent), preserved on rewrite. */
  closingIndent: string;
}

/**
 * Extract the list of dep entries from a Dependencies block body. The body
 * is the content between `Dependencies {` and `}`. Each line typically
 * contains a single quoted "GUID" value. Non-GUID lines are kept verbatim
 * (`passthrough`) so a rewrite never re-quotes or re-indents them.
 */
export function parseDepBody(body: string): ParsedDepBody {
  const eol: "\r\n" | "\n" | null = body.includes("\r\n") ? "\r\n" : body.includes("\n") ? "\n" : null;
  const rawLines = body.split(/\r?\n/);
  const lastLine = rawLines[rawLines.length - 1] ?? "";
  const closingIndent = rawLines.length > 1 && lastLine.trim().length === 0 ? lastLine : "";
  const entries: string[] = [];
  const raw: string[] = [];
  const passthrough: string[] = [];
  let indent: string | null = null;
  for (const line of rawLines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    raw.push(trimmed);
    const m = trimmed.match(GUID_LINE_RE);
    if (m) {
      entries.push(m[1].toUpperCase());
      if (indent === null) indent = line.slice(0, line.length - line.trimStart().length);
    } else {
      entries.push(trimmed); // reported as invalid by normalizeEntries
      passthrough.push(line);
    }
  }
  return { entries, raw, passthrough, indent: indent ?? " ", eol, closingIndent };
}

export function normalizeEntries(
  raw: string[],
  index?: ProjectIndex,
): { sorted: DepEntry[]; changed: boolean } {
  const seen = new Set<string>();
  const result: DepEntry[] = [];
  for (const guid of raw) {
    if (seen.has(guid)) continue;
    seen.add(guid);
    const valid = GUID_RE.test(guid);
    let unresolved = false;
    if (valid && index !== undefined) {
      unresolved = index.resolveGuid(guid.toUpperCase()) === null;
    }
    result.push({ guid: valid ? guid.toUpperCase() : guid, valid, unresolved });
  }
  result.sort((a, b) => a.guid.localeCompare(b.guid));
  const changed = !arraysEqual(
    raw.map((g) => g.toUpperCase()),
    result.map((d) => d.guid),
  );
  return { sorted: result, changed };
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Emit a canonical Dependencies block body — one quoted GUID per line using
 * the block's existing indent + line-ending style. Non-GUID lines
 * (`passthrough`) are appended byte-for-byte, never re-quoted.
 */
export function renderDepBody(
  entries: DepEntry[],
  opts: { indent?: string; eol?: string; passthrough?: string[]; closingIndent?: string } = {},
): string {
  const indent = opts.indent ?? " ";
  const eol = opts.eol ?? "\n";
  const passthrough = opts.passthrough ?? [];
  const closingIndent = opts.closingIndent ?? "";
  const lines = entries.filter((e) => e.valid).map((e) => `${indent}"${e.guid}"`);
  lines.push(...passthrough);
  if (lines.length === 0) return `${eol}${closingIndent}`;
  return `${eol}${lines.join(eol)}${eol}${closingIndent}`;
}

// ── Formatter ────────────────────────────────────────────────────────────────

export function formatPlan(input: {
  gprojPath: string;
  before: string[];
  after: DepEntry[];
  changed: boolean;
  mode: "dry-run" | "committed";
}): string {
  const { gprojPath, before, after, changed, mode } = input;
  const lines: string[] = [];
  lines.push(`## refactor_normalize_dependencies: ${basename(gprojPath)}`);
  lines.push("");
  lines.push(`Before: ${before.length} entries`);
  lines.push(`After:  ${after.length} entries (${before.length - after.length} duplicates removed)`);
  lines.push("");
  const invalid = after.filter((d) => !d.valid);
  if (invalid.length > 0) {
    lines.push(`⚠ Invalid GUID entries: ${invalid.length}`);
    for (const e of invalid) lines.push(`  - ${e.guid}`);
    lines.push("");
  }
  const unresolved = after.filter((d) => d.valid && d.unresolved);
  if (unresolved.length > 0) {
    lines.push(`⚠ Unresolved dep GUIDs (not in project-index): ${unresolved.length}`);
    for (const e of unresolved) lines.push(`  - {${e.guid}}`);
    lines.push("");
    lines.push(
      "Unresolved deps may be intentional (workshop mods not yet downloaded). Cross-check before relying on them.",
    );
    lines.push("");
  }
  if (!changed && invalid.length === 0) {
    lines.push("✅ Already canonical — sorted + deduped, no changes needed.");
    return lines.join("\n");
  }
  if (mode === "dry-run") {
    lines.push("DRY-RUN. Pass `commit: true` to write the normalized block.");
  } else {
    lines.push("✅ Committed. `.bak` sidecar created.");
  }
  return lines.join("\n");
}

// ── Registration ─────────────────────────────────────────────────────────────

export function registerRefactorNormalizeDependencies(
  server: McpServer,
  index: ProjectIndex,
  config?: Config,
): void {
  // Optional so existing call sites keep compiling; resolve lazily from the
  // environment when the caller doesn't hand us the loaded config.
  let cfg: Config | undefined = config;
  const roots = (): (string | undefined)[] => {
    if (!cfg) cfg = loadConfig();
    return [cfg.projectPath, cfg.workshopPath];
  };
  server.registerTool(
    "refactor_normalize_dependencies",
    {
      description:
        "Sort + dedupe + validate a .gproj's Dependencies block. Produces a canonical form. " +
        "Optional --check_resolution flags deps that don't resolve in the project-index (likely missing Workshop subscriptions). " +
        "DRY-RUN by default — pass `commit: true` to write. .bak sidecar; git-clean refuse.",
      inputSchema: {
        gproj_path: z.string().describe("Path to the .gproj (absolute or repo-relative)"),
        check_resolution: z
          .boolean()
          .default(false)
          .describe("If true, also validate each dep GUID resolves in the project-index"),
        commit: z.boolean().default(false).describe("True to actually write changes."),
        force: z.boolean().default(false).describe("Skip git-clean check."),
      },
    },
    async ({ gproj_path, check_resolution, commit, force }) => {
      try {
        if (gproj_path.startsWith("-")) {
          return {
            content: [{ type: "text" as const, text: "Invalid gproj_path: must not start with '-'" }],
            isError: true,
          };
        }
        const fullPath = resolve(gproj_path);
        // H7 containment: only a .gproj inside a configured root may be edited.
        if (!fullPath.toLowerCase().endsWith(".gproj")) {
          return {
            content: [
              { type: "text" as const, text: `Invalid gproj_path: must end in .gproj (${fullPath})` },
            ],
            isError: true,
          };
        }
        assertInsideAnyRoot(fullPath, roots(), "gproj_path");
        const content = readTextFileBounded(fullPath);

        // Find the first Dependencies block (brace-depth aware, RBE-7).
        const m = findDepsBlock(content);
        if (!m) {
          return {
            content: [
              {
                type: "text" as const,
                text: `No Dependencies block found in ${basename(fullPath)}. Already empty or non-standard shape.`,
              },
            ],
          };
        }
        const parsed = parseDepBody(m.body);
        const rawEntries = parsed.entries;
        const { sorted } = normalizeEntries(rawEntries, check_resolution ? index : undefined);

        // Preserve the file's line-ending style: prefer what the body uses,
        // else whatever the rest of the file uses.
        const fileEol: "\r\n" | "\n" = parsed.eol ?? (content.includes("\r\n") ? "\r\n" : "\n");
        const newBody = renderDepBody(sorted, {
          indent: parsed.indent,
          eol: fileEol,
          passthrough: parsed.passthrough,
          closingIndent: parsed.closingIndent,
        });
        // "changed" is byte-accurate: would the rewrite alter the block?
        const changed = newBody !== m.body;

        if (!changed || !commit) {
          return {
            content: [
              {
                type: "text" as const,
                text: formatPlan({
                  gprojPath: fullPath,
                  before: rawEntries,
                  after: sorted,
                  changed,
                  mode: "dry-run",
                }),
              },
            ],
          };
        }

        // Rebuild the .gproj content with the normalized block; everything
        // outside the block is untouched.
        const newBlock = `Dependencies${m.ws}{${newBody}}`;
        const newContent = content.slice(0, m.start) + newBlock + content.slice(m.end);

        const edit: PendingEdit = { filePath: fullPath, newContent };
        atomicCommit([edit], { force, keepBackup: true });

        return {
          content: [
            {
              type: "text" as const,
              text: formatPlan({
                gprojPath: fullPath,
                before: rawEntries,
                after: sorted,
                changed,
                mode: "committed",
              }),
            },
          ],
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [
            { type: "text" as const, text: `Error normalizing dependencies: ${msg}` },
          ],
          isError: true,
        };
      }
    },
  );
}
