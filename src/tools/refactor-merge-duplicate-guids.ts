/**
 * `refactor_merge_duplicate_guids` — find resource files that claim the
 * same GUID (L5-5).
 *
 * This tool does a fresh disk walk (the index may be stale) and groups the
 * resource GUIDs it finds. A resource GUID lives in exactly two places:
 *   - a `.gproj`'s `GUID` property (the addon GUID; forks often keep it);
 *   - a `.meta` sidecar's `Name "{GUID}path"` line, for every other
 *     registered resource (.et, .conf, .edds, .physmat, ...).
 *
 * An `.et` root `ID` is an ENTITY id and a `.conf` / `.layout` root node id
 * is an object id (audit refactor-index-08): prefabs that inherit from one
 * base share the entity id, so treating it as a GUID reported false
 * collisions and told the user to rewrite entity ids. Neither is read here.
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
import { extractMetaGuid } from "../project-index/meta-guid.js";

const SKIP_DIRS = new Set<string>(["node_modules", ".git", "dist", ".bak"]);
const GUID_RE = /^[0-9A-Fa-f]{16}$/;

interface FileGuid {
  guid: string;
  relPath: string;
  rootType: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** The addon GUID of a `.gproj` (its root `GUID` property), or null. */
function extractProjectGuid(content: string): string | null {
  let root;
  try {
    root = parse(content);
  } catch {
    return null;
  }
  const g = root.properties.find((p) => p.key === "GUID" && typeof p.value === "string")
    ?.value as string | undefined;
  return g && GUID_RE.test(g) ? g.toUpperCase() : null;
}

/** The GUID on a `.meta` sidecar's top-level Name line, or null. */
export { extractMetaGuid };

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
    const ext = extname(e.name).toLowerCase();
    if (ext === ".gproj" || ext === ".meta") {
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
    const isMeta = extname(abs).toLowerCase() === ".meta";
    const guid = isMeta ? extractMetaGuid(content) : extractProjectGuid(content);
    if (!guid) continue;
    const rel = relative(projectRoot, abs).split("\\").join("/");
    const list = byGuid.get(guid) ?? [];
    list.push({ guid, relPath: rel, rootType: isMeta ? "MetaFileClass" : "GameProject" });
    byGuid.set(guid, list);
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
        "Walks the project root for each .gproj GUID and every .meta sidecar's Name GUID (entity IDs in .et files are not GUIDs), and groups by GUID. " +
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
