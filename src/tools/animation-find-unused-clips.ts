/**
 * `animation_find_unused_clips` — MCP tool wrapper.
 *
 * Walks project `.anm` files and flags any that aren't referenced by an AGF /
 * ASI / AGR / character `.conf`. Read-only. The heavy lifting lives in
 * `src/animation/find-unused-clips.ts`; this file only handles MCP plumbing
 * (input validation, project-root resolution, output formatting).
 *
 * Project-root discovery:
 *   - Without `include_workshop`: just scan `config.projectPath` (user mod
 *     work directory). This is the common case and keeps the tool fast.
 *   - With `include_workshop=true`: also enumerate workshop projects via
 *     `ProjectIndex.listIndexedProjectFiles` so workshop content is folded
 *     into the same set-diff. Required when the unused check needs to
 *     account for workshop addons cross-referenced from the user mod.
 *
 * Flag-smuggle guard rejects any `project_path` that starts with '-' BEFORE
 * resolve() — same shape as the other L8 tools.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import type { Config } from "../config.js";
import { ProjectIndex } from "../project-index/project-index.js";
import {
  findUnusedClips,
  formatUnusedClipsJson,
  formatUnusedClipsMarkdown,
  type ProjectScanRoot,
} from "../animation/find-unused-clips.js";

function rejectFlagShape(label: string, raw: string): void {
  if (raw.startsWith("-")) {
    throw new Error(`Invalid ${label}: must not start with '-' (flag-smuggle guard)`);
  }
}

/**
 * Build the scan-root list. The user-mod root from `project_path` (or config
 * default) is always included. When `includeWorkshop` is true and a
 * `ProjectIndex` is provided, every distinct workshop project root in the
 * index is appended.
 *
 * Duplicate root paths are filtered out — the disk walk would otherwise
 * double-count `.anm` files. Best-effort: roots that don't exist on disk are
 * dropped silently.
 */
export function collectScanRoots(opts: {
  projectPath: string;
  includeWorkshop: boolean;
  projectIndex?: ProjectIndex;
}): ProjectScanRoot[] {
  const seen = new Set<string>();
  const roots: ProjectScanRoot[] = [];

  const primary = resolve(opts.projectPath);
  let primaryIsDir = false;
  try {
    primaryIsDir = statSync(primary).isDirectory();
  } catch {
    primaryIsDir = false;
  }
  if (primaryIsDir) {
    seen.add(primary.toLowerCase());
    roots.push({ rootPath: primary, projectId: "user" });
  }

  if (opts.includeWorkshop && opts.projectIndex) {
    let workshopRows: ReturnType<ProjectIndex["listIndexedProjectFiles"]>;
    try {
      workshopRows = opts.projectIndex.listIndexedProjectFiles("workshop");
    } catch {
      workshopRows = [];
    }
    const workshopSeen = new Set<string>();
    for (const row of workshopRows) {
      // Skip untyped / unprojected rows — listIndexedProjectFiles surfaces
      // `null` project_id / root_path for files whose owning project can't be
      // determined (see project-index.ts comment block).
      if (row.project_id === null || row.root_path === null) continue;
      if (workshopSeen.has(row.project_id)) continue;
      workshopSeen.add(row.project_id);
      // Reject root paths starting with '-' (flag-smuggle safety, matches
      // asset-orphan-scan).
      if (row.root_path.startsWith("-")) continue;
      const abs = resolve(row.root_path);
      const lc = abs.toLowerCase();
      if (seen.has(lc)) continue;
      try {
        if (!statSync(abs).isDirectory()) continue;
      } catch {
        continue;
      }
      seen.add(lc);
      roots.push({ rootPath: abs, projectId: row.project_id });
    }
  }

  return roots;
}

export function registerAnimationFindUnusedClips(
  server: McpServer,
  config: Config,
  projectIndex?: ProjectIndex,
): void {
  server.registerTool(
    "animation_find_unused_clips",
    {
      description:
        "Walk the project's `.anm` animation clip files and report any that aren't referenced by any " +
        "AGF / ASI / AGR / character `.conf`. Read-only — never deletes. Use this before publishing " +
        "a mod to prune dead clip assets. " +
        "Scope: defaults to the user-mod project root (config.projectPath). Pass `include_workshop: true` " +
        "to also fold workshop project roots from the ProjectIndex into the disk walk and reference scan. " +
        "Output: markdown (default) or JSON via `format`.",
      inputSchema: {
        project_path: z
          .string()
          .optional()
          .describe(
            "Project root to scan. Defaults to the configured projectPath. " +
              "Must not start with '-' (flag-smuggle guard).",
          ),
        include_workshop: z
          .boolean()
          .default(false)
          .describe(
            "When true, also scan workshop projects discovered in the ProjectIndex. " +
              "When false (default), only scan the user-mod project root.",
          ),
        format: z
          .enum(["markdown", "json"])
          .default("markdown")
          .describe("Output format. `markdown` (default) renders a table; `json` returns the raw struct."),
      },
    },
    async ({ project_path, include_workshop, format }) => {
      try {
        if (project_path !== undefined) rejectFlagShape("project_path", project_path);

        const rawPath = project_path ?? config.projectPath;
        if (!rawPath) {
          return {
            content: [
              {
                type: "text" as const,
                text:
                  "No project_path configured. Set ENFUSION_PROJECT_PATH or pass project_path explicitly.",
              },
            ],
            isError: true,
          };
        }

        const projectAbs = resolve(rawPath);
        if (!existsSync(projectAbs)) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Project path does not exist: ${projectAbs}`,
              },
            ],
            isError: true,
          };
        }

        const roots = collectScanRoots({
          projectPath: projectAbs,
          includeWorkshop: include_workshop,
          projectIndex,
        });

        if (roots.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `No scannable project roots found under ${projectAbs}.`,
              },
            ],
            isError: true,
          };
        }

        const result = findUnusedClips(roots);
        const projectLabel = include_workshop
          ? `${projectAbs} (+ ${roots.length - 1} workshop project(s))`
          : projectAbs;

        const text =
          format === "json"
            ? formatUnusedClipsJson({ projectLabel, result })
            : formatUnusedClipsMarkdown({ projectLabel, result });

        return { content: [{ type: "text" as const, text }] };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [
            { type: "text" as const, text: `Error finding unused clips: ${msg}` },
          ],
          isError: true,
        };
      }
    },
  );
}
