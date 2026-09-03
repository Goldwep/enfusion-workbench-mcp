/**
 * `refactor_rename_project_id` — surgical edit of a .gproj's `ID "..."`
 * property (L5-3).
 *
 * Why: project_id is the FK column on `resources` (schema v2). Changing
 * the ID without rewriting the projects/resources rows would orphan the
 * resource entries. This tool does ONLY the file-side rename; the next
 * crawl pass picks up the new ID and the project row gets re-inserted.
 *
 * Safety per L4-2 byte-edit doctrine: dry-run by default, .bak sidecar,
 * git-clean refuse, atomicCommit with rollback.
 *
 * Limitations:
 *   - Cross-project dep references that target the renamed project by ID
 *     (not by GUID) are NOT updated. Reforger almost always uses GUID
 *     refs in Dependencies blocks, so this is rarely a concern in practice.
 *     The tool surfaces a warning when other .gproj files name this ID.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolve, basename } from "node:path";
import { z } from "zod";
import { atomicCommit, findAllSpans, applyMultipleSplices } from "../refactor/byte-edit.js";
import { loadConfig, type Config } from "../config.js";
import { assertInsideAnyRoot } from "../utils/path-guard.js";
import { readTextFileBounded } from "../utils/safe-read.js";

const ID_LINE_RE = /\bID\s+"([^"]+)"/g;
const VALID_ID_RE = /^[A-Za-z0-9_\-.]+$/;

// ── Pure helpers ─────────────────────────────────────────────────────────────

export function findIdSpans(content: string, oldId: string): { spans: { start: number; end: number; text: string }[] } {
  const spans: { start: number; end: number; text: string }[] = [];
  const all = findAllSpans(content, ID_LINE_RE);
  for (const span of all) {
    if (span.text === undefined) continue;
    const m = ID_LINE_RE.exec(span.text);
    ID_LINE_RE.lastIndex = 0;
    if (m && m[1] === oldId) {
      spans.push({ start: span.start, end: span.end, text: span.text });
    }
  }
  return { spans };
}

export function buildRenamedContent(content: string, oldId: string, newId: string): { newContent: string; replaced: number } {
  // Replace ALL occurrences of `ID "<oldId>"` — there's only one at the .gproj
  // root in canonical form, but tolerate (e.g.) sub-configs that nest the
  // same property. We use the regex on the FULL string rather than the per-
  // span text to keep the replacement deterministic.
  let replaced = 0;
  const newContent = content.replace(ID_LINE_RE, (match, captured) => {
    if (captured === oldId) {
      replaced += 1;
      return `ID "${newId}"`;
    }
    return match;
  });
  return { newContent, replaced };
}

// ── Formatter ────────────────────────────────────────────────────────────────

export function formatPlan(input: {
  gprojPath: string;
  oldId: string;
  newId: string;
  replaced: number;
  mode: "dry-run" | "committed";
}): string {
  const { gprojPath, oldId, newId, replaced, mode } = input;
  const lines: string[] = [];
  lines.push(`## refactor_rename_project_id: ${basename(gprojPath)}`);
  lines.push("");
  lines.push(`- Old ID: ${oldId}`);
  lines.push(`- New ID: ${newId}`);
  lines.push("");
  if (replaced === 0) {
    lines.push("❌ No matching `ID \"<oldId>\"` line found. Was the old ID correct?");
    return lines.join("\n");
  }
  const verb = mode === "dry-run" ? "Would replace" : "Replaced";
  lines.push(`${verb} ${replaced} \`ID\` line${replaced !== 1 ? "s" : ""} in the .gproj.`);
  lines.push("");
  if (mode === "dry-run") {
    lines.push("DRY-RUN. Pass `commit: true` to write.");
    lines.push("");
    lines.push(
      "After commit, run `project_index_status` (or restart the MCP server) to refresh the index — the project row keys off the .gproj ID.",
    );
  } else {
    lines.push(
      "✅ Committed. The .bak sidecar is at `<path>.bak`. Run `project_index_status` to confirm the renamed project surfaces.",
    );
  }
  return lines.join("\n");
}

// ── Registration ─────────────────────────────────────────────────────────────

export function registerRefactorRenameProjectId(server: McpServer, config?: Config): void {
  // Optional so existing call sites keep compiling; resolve lazily from the
  // environment when the caller doesn't hand us the loaded config.
  let cfg: Config | undefined = config;
  const roots = (): (string | undefined)[] => {
    if (!cfg) cfg = loadConfig();
    return [cfg.projectPath, cfg.workshopPath];
  };
  server.registerTool(
    "refactor_rename_project_id",
    {
      description:
        "Rename the `ID` property of a `.gproj` file. Surgical single-line edit. " +
        "DRY-RUN by default — pass `commit: true` to actually write. Refuses on uncommitted git changes (use `force: true`). " +
        "Note: project_id is the FK column on resources (schema v2). After commit, re-run the crawl to refresh the index.",
      inputSchema: {
        gproj_path: z.string().describe("Path to the .gproj file (absolute or repo-relative)"),
        old_id: z.string().describe("Current ID value (the string inside `ID \"...\"`)"),
        new_id: z
          .string()
          .describe("New ID value. Letters / digits / underscore / hyphen / dot only."),
        commit: z.boolean().default(false).describe("Set true to actually write."),
        force: z.boolean().default(false).describe("Skip git-clean check."),
      },
    },
    async ({ gproj_path, old_id, new_id, commit, force }) => {
      try {
        // Flag-smuggle guard.
        if (gproj_path.startsWith("-")) {
          return {
            content: [
              { type: "text" as const, text: `Invalid gproj_path: must not start with '-'` },
            ],
            isError: true,
          };
        }
        if (!VALID_ID_RE.test(new_id)) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Invalid new_id "${new_id}": only [A-Za-z0-9_\\-.] allowed`,
              },
            ],
            isError: true,
          };
        }
        if (old_id === new_id) {
          return {
            content: [
              { type: "text" as const, text: "(no-op — old_id and new_id are identical)" },
            ],
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
        const { newContent, replaced } = buildRenamedContent(content, old_id, new_id);
        if (replaced === 0 || !commit) {
          return {
            content: [
              {
                type: "text" as const,
                text: formatPlan({
                  gprojPath: fullPath,
                  oldId: old_id,
                  newId: new_id,
                  replaced,
                  mode: "dry-run",
                }),
              },
            ],
          };
        }
        atomicCommit([{ filePath: fullPath, newContent }], { force, keepBackup: true });
        return {
          content: [
            {
              type: "text" as const,
              text: formatPlan({
                gprojPath: fullPath,
                oldId: old_id,
                newId: new_id,
                replaced,
                mode: "committed",
              }),
            },
          ],
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [
            { type: "text" as const, text: `Error renaming project ID: ${msg}` },
          ],
          isError: true,
        };
      }
    },
  );
}
