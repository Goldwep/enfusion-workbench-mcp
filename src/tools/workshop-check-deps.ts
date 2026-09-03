/**
 * `workshop_check_deps` — resolve a project's declared dependencies the
 * way WORKBENCH does (L3-6; reworked 2026-08-31).
 *
 * The original version resolved dep GUIDs against the project-index,
 * which conflates "indexed somewhere on disk" with "loadable by
 * Workbench": a game-workshop download indexes fine, yet Workbench
 * cannot see it (it never searches `My Games\ArmaReforger\addons`) and
 * pops "Missing Addon Dependencies" at open — while base-game GUIDs
 * showed up as unresolved noise (live-diagnosed 2026-08-31: CSI
 * 5B0D1E4380971EBD reported resolved but unloadable; ArmaReforger
 * 58D0FB3206B6F859 reported unresolved but always available).
 *
 * Now each dep is classified via workbench/wb-deps.ts as
 * Workbench-visible / workshop-only (copy remedy named) / missing, with
 * the project-index kept as a supplementary cross-reference.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Config } from "../config.js";
import { ProjectIndex } from "../project-index/project-index.js";
import {
  checkWorkbenchVisibleDeps,
  depReportHeader,
  formatDepFindings,
  type WbDepsCheck,
} from "../workbench/wb-deps.js";

// The dep-extraction helper moved to workbench/wb-deps.ts; re-exported
// here so existing importers keep working.
export { extractGprojDeps } from "../workbench/wb-deps.js";

// ── Formatter ────────────────────────────────────────────────────────────────

export function formatWorkshopDepReport(
  check: WbDepsCheck,
  indexRows: Map<string, { file_path: string | null; source: string | null }>,
): string {
  const lines: string[] = [];
  lines.push(depReportHeader(check));
  lines.push("");
  if (check.findings.length === 0) {
    lines.push("(no Dependencies block, or it's empty — project depends on nothing external)");
    return lines.join("\n");
  }
  lines.push(...formatDepFindings(check));

  const indexed = check.findings.filter((f) => indexRows.has(f.guid));
  if (indexed.length > 0) {
    lines.push("");
    lines.push("### Project-index cross-reference");
    lines.push(
      "(informational — being indexed does NOT mean Workbench can load it)",
    );
    for (const f of indexed) {
      const row = indexRows.get(f.guid)!;
      lines.push(`- {${f.guid}} indexed at ${row.file_path} (source=${row.source})`);
    }
  }
  return lines.join("\n");
}

// ── Registration ─────────────────────────────────────────────────────────────

export function registerWorkshopCheckDeps(
  server: McpServer,
  index: ProjectIndex,
  config: Config,
): void {
  server.registerTool(
    "workshop_check_deps",
    {
      description:
        "Read a `.gproj` from disk, extract its Dependencies block, and resolve each dep GUID the way WORKBENCH does: " +
        "against the Workbench addons dir, the folders next to the project, and the base game + Tools installs. " +
        "Deps that only exist in the game's workshop downloads (`My Games\\ArmaReforger\\addons`) are flagged separately with the copy remedy — " +
        "Workbench never searches that folder, so such deps pop 'Missing Addon Dependencies' at open even though the game runs them fine. " +
        "Use before publish, before wb_validate_scripts / wb_launch on a freshly-cloned project, or when diagnosing 'mod won't load'.",
      inputSchema: {
        gproj_path: z
          .string()
          .describe("Path to the .gproj file (absolute or repo-relative)"),
      },
    },
    async ({ gproj_path }) => {
      try {
        const fullPath = resolve(gproj_path);
        if (!existsSync(fullPath)) {
          return {
            content: [
              { type: "text" as const, text: `.gproj not found at: ${fullPath}` },
            ],
            isError: true,
          };
        }
        const check = checkWorkbenchVisibleDeps(fullPath, config);
        const indexRows = new Map<string, { file_path: string | null; source: string | null }>();
        for (const f of check.findings) {
          const row = index.resolveGuid(f.guid);
          if (row) indexRows.set(f.guid, { file_path: row.file_path, source: row.source });
        }
        const text = formatWorkshopDepReport(check, indexRows);
        return { content: [{ type: "text" as const, text }] };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [{ type: "text" as const, text: `Error checking deps: ${msg}` }],
          isError: true,
        };
      }
    },
  );
}
