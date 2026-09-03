/**
 * `script_format` — apply formatting fixes to an Enforce Script `.c`
 * file (L6-6).
 *
 * v1 ships the SAFE subset of the BI Basic Code Formatter rules — fixes
 * that cannot change semantics:
 *   - Strip trailing whitespace from every line
 *   - Ensure exactly one trailing newline at EOF
 *   - Collapse runs of >2 consecutive blank lines into 2
 *
 * Riskier fixes (indent normalization, `if (` → `if(` style) are NOT
 * applied — they're flagged by `script_lint` but only the human should
 * decide to apply them. v2 may grow opt-in flags per rule.
 *
 * Safety per L4-2 byte-edit doctrine: dry-run by default, .bak sidecar,
 * git-clean refuse, atomicCommit.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFileSync, existsSync } from "node:fs";
import { resolve, basename } from "node:path";
import { z } from "zod";
import {
  atomicCommit,
  type PendingEdit,
} from "../refactor/byte-edit.js";

// ── Pure formatter ───────────────────────────────────────────────────────────

export interface FormatChanges {
  trailingWhitespaceLines: number;
  blankLineRunsCollapsed: number;
  trailingNewlineAdjusted: boolean;
}

export function formatSource(source: string): {
  output: string;
  changes: FormatChanges;
} {
  let trailing = 0;
  // Normalize line endings to \n internally; preserve a trailing \r\n if the
  // file uses CRLF.
  const usesCrlf = /\r\n/.test(source);
  const lines = source.replace(/\r\n/g, "\n").split("\n");

  for (let i = 0; i < lines.length; i++) {
    const stripped = lines[i].replace(/[ \t]+$/, "");
    if (stripped !== lines[i]) trailing += 1;
    lines[i] = stripped;
  }

  // Collapse runs of >2 blank lines.
  let collapsed = 0;
  const out: string[] = [];
  let blankRun = 0;
  for (const line of lines) {
    if (line === "") {
      blankRun += 1;
      if (blankRun <= 2) out.push(line);
      else collapsed += 1;
    } else {
      blankRun = 0;
      out.push(line);
    }
  }

  // Ensure exactly one trailing newline.
  let trailingNewlineAdjusted = false;
  while (out.length > 0 && out[out.length - 1] === "") {
    out.pop();
    trailingNewlineAdjusted = true;
  }
  out.push(""); // exactly one trailing newline

  const joined = out.join("\n");
  const finalOutput = usesCrlf ? joined.replace(/\n/g, "\r\n") : joined;
  return {
    output: finalOutput,
    changes: {
      trailingWhitespaceLines: trailing,
      blankLineRunsCollapsed: collapsed,
      trailingNewlineAdjusted,
    },
  };
}

// ── Formatter (markdown report) ──────────────────────────────────────────────

export function formatReport(input: {
  filePath: string;
  changes: FormatChanges;
  totalDelta: number;
  mode: "dry-run" | "committed";
}): string {
  const { filePath, changes, totalDelta, mode } = input;
  const lines: string[] = [];
  lines.push(`## script_format: ${basename(filePath)}`);
  lines.push("");
  if (totalDelta === 0) {
    lines.push("✅ Already clean — no formatting changes needed.");
    return lines.join("\n");
  }
  lines.push(`- Trailing whitespace stripped from ${changes.trailingWhitespaceLines} line${changes.trailingWhitespaceLines !== 1 ? "s" : ""}`);
  lines.push(`- Blank-line runs collapsed: ${changes.blankLineRunsCollapsed}`);
  lines.push(`- Trailing-newline adjusted: ${changes.trailingNewlineAdjusted ? "yes" : "no"}`);
  lines.push("");
  if (mode === "dry-run") {
    lines.push("DRY-RUN. Pass `commit: true` to write the cleaned file.");
    lines.push("Riskier reformats (indent style, `if(`/`if (`) are NOT applied — use `script_lint` to surface those.");
  } else {
    lines.push("✅ Committed. `.bak` sidecar created.");
  }
  return lines.join("\n");
}

// ── Registration ─────────────────────────────────────────────────────────────

export function registerScriptFormat(server: McpServer): void {
  server.registerTool(
    "script_format",
    {
      description:
        "Apply safe formatting fixes to an Enforce Script `.c` file: strip trailing whitespace, ensure single trailing newline, collapse blank-line runs. " +
        "DRY-RUN by default — pass `commit: true` to write. Atomic-commit with .bak sidecar; git-clean refuse. " +
        "Riskier reformats (indent normalization, `if(` style) are intentionally NOT applied — use `script_lint` to surface those for human decision.",
      inputSchema: {
        script_path: z
          .string()
          .describe("Path to the .c file (absolute or repo-relative)"),
        commit: z.boolean().default(false).describe("True to actually write."),
        force: z.boolean().default(false).describe("Skip git-clean check."),
      },
    },
    async ({ script_path, commit, force }) => {
      try {
        if (script_path.startsWith("-")) {
          return {
            content: [{ type: "text" as const, text: "Invalid script_path: must not start with '-'" }],
            isError: true,
          };
        }
        // Audit-fix L6 S5: refuse non-.c writes. script_format applies
        // text-level changes (atomic via byte-edit) and must never rewrite
        // a non-script file even when the user passes commit:true force:true.
        if (!script_path.toLowerCase().endsWith(".c")) {
          return {
            content: [
              {
                type: "text" as const,
                text: `script_format only handles .c files; got '${script_path}'.`,
              },
            ],
            isError: true,
          };
        }
        const fullPath = resolve(script_path);
        if (!existsSync(fullPath)) {
          return {
            content: [{ type: "text" as const, text: `Script file not found: ${fullPath}` }],
            isError: true,
          };
        }
        const source = readFileSync(fullPath, "utf-8");
        const { output, changes } = formatSource(source);
        const totalDelta =
          changes.trailingWhitespaceLines +
          changes.blankLineRunsCollapsed +
          (changes.trailingNewlineAdjusted ? 1 : 0);

        if (totalDelta === 0 || !commit) {
          return {
            content: [
              {
                type: "text" as const,
                text: formatReport({
                  filePath: fullPath,
                  changes,
                  totalDelta,
                  mode: "dry-run",
                }),
              },
            ],
          };
        }
        const edit: PendingEdit = { filePath: fullPath, newContent: output };
        atomicCommit([edit], { force, keepBackup: true });
        return {
          content: [
            {
              type: "text" as const,
              text: formatReport({
                filePath: fullPath,
                changes,
                totalDelta,
                mode: "committed",
              }),
            },
          ],
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [{ type: "text" as const, text: `Error formatting script: ${msg}` }],
          isError: true,
        };
      }
    },
  );
}
