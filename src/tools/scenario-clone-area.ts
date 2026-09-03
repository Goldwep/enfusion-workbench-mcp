/**
 * `scenario_clone_area` — clone a rectangular world-coord area of a scenario
 * layer into a fresh layer file with regenerated GUIDs.
 *
 * Pure-FS tool. Reads the source layer, walks top-level entities, filters by
 * the XZ rectangle, deep-clones the matches with fresh GUIDs, optionally
 * translates the clones, and writes the result to a new layer file via
 * `writeWithBackup`. Destination must not exist unless `force: true`.
 *
 * Defaults to dry_run = false because the operation is intentional — the
 * caller is asking to extract a region into a new file.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import type { Config } from "../config.js";
import {
  cloneArea,
  parseLayer,
  serializeLayer,
  type Area,
  type GuidSwap,
  type Translate,
} from "../scenario/clone-area.js";
import { checkGitState, writeWithBackup } from "../refactor/byte-edit.js";
import { assertInsideRoot } from "../utils/path-guard.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Reject path-shaped inputs that start with `-` (would be parsed as a CLI
 * flag if anything downstream shells out) BEFORE `resolve()` masks the
 * leading dash with the cwd. Pattern lifted from `wb-cli-run.ts`.
 */
function rejectFlagShape(label: string, raw: string): void {
  if (raw.startsWith("-")) {
    throw new Error(`Invalid ${label}: must not start with '-' (looks like a CLI flag)`);
  }
}

function formatGuidSample(swaps: GuidSwap[], n = 3): string[] {
  return swaps.slice(0, n).map((s) => `  - ${s.old} → ${s.new}`);
}

function formatPlan(opts: {
  sourcePath: string;
  destPath: string;
  count: number;
  swaps: GuidSwap[];
  translate: Translate;
  mode: "dry-run" | "written";
}): string {
  const lines: string[] = [];
  lines.push(`## scenario_clone_area: ${opts.mode === "dry-run" ? "DRY-RUN" : "WRITTEN"}`);
  lines.push("");
  lines.push(`- Source: ${opts.sourcePath}`);
  lines.push(`- Dest:   ${opts.destPath}`);
  lines.push(`- Entities cloned: ${opts.count}`);
  lines.push(`- GUID swaps: ${opts.swaps.length}`);
  lines.push(
    `- Translate: (${opts.translate.x}, ${opts.translate.z})${
      opts.translate.x === 0 && opts.translate.z === 0 ? " — no offset" : ""
    }`,
  );
  if (opts.swaps.length > 0) {
    lines.push("");
    lines.push(`### Sample GUID swaps (${Math.min(3, opts.swaps.length)}/${opts.swaps.length})`);
    for (const line of formatGuidSample(opts.swaps)) lines.push(line);
  }
  lines.push("");
  if (opts.mode === "dry-run") {
    lines.push("DRY-RUN. Pass `dry_run: false` (default) to write the destination layer.");
  } else {
    lines.push(`Wrote ${opts.destPath} (.bak sidecar preserved next to the file).`);
  }
  return lines.join("\n");
}

// ── Registration ─────────────────────────────────────────────────────────────

export function registerScenarioCloneArea(server: McpServer, config: Config): void {
  server.registerTool(
    "scenario_clone_area",
    {
      description:
        "Clone a rectangular world-coord area of a scenario layer file (.conf / .et / .layer) into a new layer file, " +
        "regenerating every embedded GUID so the clone won't collide with the source. " +
        "Optionally translates the clones by an X/Z offset. " +
        "Defaults to writing the destination (use `dry_run: true` to preview the count, sample GUID swaps, and translate vector first). " +
        "Refuses if the destination exists unless `force: true`, and refuses on uncommitted git changes for the destination unless `force: true`.",
      inputSchema: {
        source_layer_path: z
          .string()
          .min(1)
          .describe(
            "Absolute path to the source .conf / .et / .layer file. Must not start with '-' (flag-smuggle guard).",
          ),
        dest_layer_path: z
          .string()
          .min(1)
          .describe(
            "Absolute path where the cloned layer will be written. Must not start with '-' (flag-smuggle guard). " +
              "Refuses if the file already exists unless `force: true`.",
          ),
        area: z
          .object({
            minX: z.number().describe("Minimum world X (inclusive)"),
            minZ: z.number().describe("Minimum world Z (inclusive)"),
            maxX: z.number().describe("Maximum world X (inclusive)"),
            maxZ: z.number().describe("Maximum world Z (inclusive)"),
          })
          .describe(
            "Axis-aligned rectangle on the world XZ plane. Top-level entities whose " +
              "coords' first and third components fall inside this rectangle are cloned.",
          ),
        translate: z
          .object({
            x: z.number().describe("X offset (world units)"),
            z: z.number().describe("Z offset (world units)"),
          })
          .optional()
          .describe(
            "Optional offset to apply to every cloned entity's coords. Default no translation.",
          ),
        dry_run: z
          .boolean()
          .default(false)
          .describe(
            "When true, parse + filter + plan but DO NOT write. Default false — this tool's job is to extract a region.",
          ),
        force: z
          .boolean()
          .default(false)
          .describe(
            "Allow overwrite of an existing destination, and bypass the git-clean refusal. Default false.",
          ),
      },
    },
    async ({ source_layer_path, dest_layer_path, area, translate, dry_run, force }) => {
      try {
        rejectFlagShape("source_layer_path", source_layer_path);
        rejectFlagShape("dest_layer_path", dest_layer_path);

        const sourceAbs = resolve(source_layer_path);
        const destAbs = resolve(dest_layer_path);

        // Audit fix H-3: path containment. Both inputs must resolve inside
        // the project root — otherwise an LLM-injected `../../../...` could
        // write outside the workspace.
        assertInsideRoot(sourceAbs, config.projectPath, "source_layer_path");
        assertInsideRoot(destAbs, config.projectPath, "dest_layer_path");

        if (!existsSync(sourceAbs)) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Source layer not found: ${sourceAbs}`,
              },
            ],
            isError: true,
          };
        }

        if (existsSync(destAbs) && !force) {
          return {
            content: [
              {
                type: "text" as const,
                text:
                  `Destination already exists: ${destAbs}\n` +
                  "Pass `force: true` to overwrite (a .bak sidecar will be created).",
              },
            ],
            isError: true,
          };
        }

        const sourceText = readFileSync(sourceAbs, "utf-8");
        // Audit fix H-4: dispatch on file extension. `.conf` / `.ent` are
        // single-root files (mission headers, prefab roots) whose root-level
        // properties must be preserved verbatim — without `singleRoot:true`,
        // the sentinel wrap silently drops them when we rebuild destRoot.
        // `.layer` and unknown extensions stay multi-root.
        const isSingleRoot = /\.(conf|ent)$/i.test(sourceAbs);
        const sourceRoot = parseLayer(sourceText, { singleRoot: isSingleRoot });

        const areaTyped: Area = area;
        const translateTyped: Translate | undefined = translate
          ? { x: translate.x, z: translate.z }
          : undefined;

        const result = cloneArea(sourceRoot, areaTyped, translateTyped);

        if (result.clonedCount === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text:
                  `No top-level entities in ${sourceAbs} fell inside area ` +
                  `[${area.minX},${area.minZ}]-[${area.maxX},${area.maxZ}]. ` +
                  "Check the rectangle bounds, or that the source layer's entities carry a `coords \"X Y Z\"` property.",
              },
            ],
          };
        }

        // Build a destination root from the cloned entities and serialize.
        // Audit fix H-4: preserve the source root's properties/values when the
        // input was a real single-root file (e.g. SCR_MissionHeaderCampaign
        // with `m_sName`). For a multi-root .layer the source root IS the
        // sentinel container — its properties/values are empty by definition
        // — so cloning them is a no-op. Either way, the children are
        // replaced with the filtered clones.
        const destRoot: typeof sourceRoot = {
          type: sourceRoot.type,
          id: sourceRoot.id,
          className: sourceRoot.className,
          inheritance: sourceRoot.inheritance,
          properties: sourceRoot.properties.map((p) =>
            typeof p.value === "string"
              ? { key: p.key, value: p.value }
              : { key: p.key, value: JSON.parse(JSON.stringify(p.value)) as typeof p.value },
          ),
          values: [...sourceRoot.values],
          children: result.clonedEntities,
        };
        const destText = serializeLayer(destRoot);

        if (dry_run) {
          return {
            content: [
              {
                type: "text" as const,
                text: formatPlan({
                  sourcePath: sourceAbs,
                  destPath: destAbs,
                  count: result.clonedCount,
                  swaps: result.guidSwaps,
                  translate: result.translate,
                  mode: "dry-run",
                }),
              },
            ],
          };
        }

        if (existsSync(destAbs)) {
          // Overwrite path — uses writeWithBackup so we get a .bak and git
          // check (unless force).
          writeWithBackup(destAbs, destText, { force, keepBackup: true });
        } else {
          // Brand-new file — writeWithBackup refuses on non-existent.
          // Audit fix H-1: previously this dropped through to a raw
          // writeFileSync, bypassing the L3 git-clean protection. Now we
          // check the dest's parent directory's git state first and refuse
          // when dirty unless `force: true`. Outside-repo / no-git-binary
          // proceed silently (same policy `shouldRefuseWrite` enforces).
          if (!force) {
            const state = checkGitState(dirname(destAbs));
            if (state.kind === "dirty") {
              return {
                content: [
                  {
                    type: "text" as const,
                    text:
                      `Refusing to create ${destAbs}: parent directory has uncommitted git changes (` +
                      `${state.modified_files.slice(0, 5).join(", ")}` +
                      `${state.modified_files.length > 5 ? ", ..." : ""}` +
                      `). Pass \`force: true\` to override.`,
                  },
                ],
                isError: true,
              };
            }
          }
          writeFileSync(destAbs, destText, "utf-8");
        }

        return {
          content: [
            {
              type: "text" as const,
              text: formatPlan({
                sourcePath: sourceAbs,
                destPath: destAbs,
                count: result.clonedCount,
                swaps: result.guidSwaps,
                translate: result.translate,
                mode: "written",
              }),
            },
          ],
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [
            { type: "text" as const, text: `Error cloning scenario area: ${msg}` },
          ],
          isError: true,
        };
      }
    },
  );
}
