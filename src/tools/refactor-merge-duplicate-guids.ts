/**
 * `refactor_merge_duplicate_guids` — find resource files that claim the
 * same GUID (L5-5).
 *
 * The project-index DB enforces UNIQUE on `resources.guid`, so the
 * crawler's `INSERT OR IGNORE` silently drops the second occurrence —
 * the DB is the wrong source of truth for duplicate detection. This
 * tool does a fresh disk-walk + GUID extraction across `.gproj`/`.et`/
 * `.conf`/`.ent`/`.layout` files, groups by GUID, and reports collisions.
 *
 * v1 is DIAGNOSE-ONLY. Live-merge is deferred — the right fix is
 * usually "reissue a fresh GUID on the duplicate via `refactor_replace_guid`",
 * which is a separate user-driven step.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readdirSync, statSync } from "node:fs";
import { readTextFileBounded } from "../utils/safe-read.js";
import { join, resolve, relative, extname } from "node:path";
import { z } from "zod";
import { parse } from "../formats/enfusion-text.js";

const SKIP_DIRS = new Set<string>(["node_modules", ".git", "dist", ".bak"]);
const SCAN_EXTS = new Set<string>([".gproj", ".et", ".conf", ".ent", ".layout"]);
const GUID_RE = /^[0-9A-Fa-f]{16}$/;

interface FileGuid {
  guid: string;
  relPath: string;
  rootType: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function stripBraces(s: string | undefined): string | undefined {
  if (s === undefined) return undefined;
  if (s.startsWith("{") && s.endsWith("}")) return s.slice(1, -1);
  return s;
}

function extractRootGuid(content: string): { guid: string; rootType: string } | null {
  let root;
  try {
    root = parse(content);
  } catch {
    return null;
  }
  const candidates: (string | undefined)[] = [
    stripBraces(root.id),
    root.properties.find((p) => p.key === "GUID" && typeof p.value === "string")?.value as
      | string
      | undefined,
    root.properties.find((p) => p.key === "ID" && typeof p.value === "string")?.value as
      | string
      | undefined,
  ];
  for (const cand of candidates) {
    if (cand && GUID_RE.test(cand)) {
      return { guid: cand.toUpperCase(), rootType: root.type };
    }
  }
  return null;
}

function* walk(root: string): Generator<string> {
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      yield* walk(join(root, e.name));
      continue;
    }
    if (!e.isFile()) continue;
    if (SCAN_EXTS.has(extname(e.name).toLowerCase())) {
      yield join(root, e.name);
    }
  }
}

// ── Core ─────────────────────────────────────────────────────────────────────

export function findDuplicateGuids(projectRoot: string): Map<string, FileGuid[]> {
  const byGuid = new Map<string, FileGuid[]>();
  for (const abs of walk(projectRoot)) {
    let content: string;
    try {
      content = readTextFileBounded(abs);
    } catch {
      continue;
    }
    const ex = extractRootGuid(content);
    if (!ex) continue;
    const rel = relative(projectRoot, abs).split("\\").join("/");
    const list = byGuid.get(ex.guid) ?? [];
    list.push({ guid: ex.guid, relPath: rel, rootType: ex.rootType });
    byGuid.set(ex.guid, list);
  }
  // Keep only collisions.
  const collisions = new Map<string, FileGuid[]>();
  for (const [g, list] of byGuid) {
    if (list.length > 1) collisions.set(g, list);
  }
  return collisions;
}

// ── Formatter ────────────────────────────────────────────────────────────────

export function formatReport(input: {
  projectRoot: string;
  collisions: Map<string, FileGuid[]>;
  filesScanned: number;
}): string {
  const { projectRoot, collisions, filesScanned } = input;
  const lines: string[] = [];
  lines.push(`## refactor_merge_duplicate_guids (diagnose) — ${projectRoot}`);
  lines.push("");
  lines.push(`Scanned ${filesScanned} resource file${filesScanned !== 1 ? "s" : ""}.`);
  if (collisions.size === 0) {
    lines.push("");
    lines.push("✅ No duplicate GUIDs found. Every indexed resource has a unique 16-hex GUID.");
    return lines.join("\n");
  }
  lines.push(`Found ${collisions.size} GUID collision${collisions.size !== 1 ? "s" : ""}.`);
  lines.push("");
  for (const [guid, files] of collisions) {
    lines.push(`### {${guid}}`);
    for (const f of files) {
      lines.push(`  - ${f.relPath} (${f.rootType})`);
    }
    lines.push("");
  }
  lines.push(
    "**Fix recommendation:** pick the canonical owner, then run `refactor_replace_guid` on each duplicate to issue a fresh GUID. The crawler will pick up the corrected state on next index.",
  );
  return lines.join("\n").trimEnd();
}

// ── Registration ─────────────────────────────────────────────────────────────

export function registerRefactorMergeDuplicateGuids(server: McpServer): void {
  server.registerTool(
    "refactor_merge_duplicate_guids",
    {
      description:
        "Find resource files that claim the same 16-hex GUID (collisions). " +
        "Walks the project root for .gproj/.et/.conf/.ent/.layout and groups by extracted root GUID. " +
        "v1 is DIAGNOSE-ONLY — the recommended fix is `refactor_replace_guid` per duplicate to issue fresh GUIDs. " +
        "Catches the most common Workshop fork bug: cloning a mod without changing its addon GUID.",
      inputSchema: {
        project_root: z.string().describe("Absolute path to the project to scan"),
      },
    },
    async ({ project_root }) => {
      try {
        if (project_root.startsWith("-")) {
          return {
            content: [{ type: "text" as const, text: "Invalid project_root: must not start with '-'" }],
            isError: true,
          };
        }
        const rootAbs = resolve(project_root);
        let stat;
        try {
          stat = statSync(rootAbs);
        } catch {
          return {
            content: [{ type: "text" as const, text: `project_root not found: ${rootAbs}` }],
            isError: true,
          };
        }
        if (!stat.isDirectory()) {
          return {
            content: [{ type: "text" as const, text: `project_root is not a directory: ${rootAbs}` }],
            isError: true,
          };
        }
        let filesScanned = 0;
        for (const _ of walk(rootAbs)) filesScanned += 1;
        const collisions = findDuplicateGuids(rootAbs);
        return {
          content: [
            {
              type: "text" as const,
              text: formatReport({ projectRoot: rootAbs, collisions, filesScanned }),
            },
          ],
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [{ type: "text" as const, text: `Error scanning duplicate GUIDs: ${msg}` }],
          isError: true,
        };
      }
    },
  );
}
