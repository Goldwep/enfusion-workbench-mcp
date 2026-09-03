/**
 * `scenario_apply_template` — stamp a curated template (FOB / checkpoint /
 * patrol-grid) into an existing scenario layer at a world position.
 *
 * Pure-FS tool. Reads the target layer, parses it, appends the template's
 * entities, re-serializes, and writes via `writeWithBackup`. Defaults
 * `dry_run` to TRUE — stamping mutates production layer files, so the safe
 * default is preview-and-confirm.
 *
 * Placeholder GUIDs (`{0000000000000001}...`) in the template are intentional
 * — agents downstream call `refactor_replace_guid` to substitute real prefab
 * GUIDs.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import type { Config } from "../config.js";
import { applyTemplate } from "../scenario/apply-template.js";
import {
  describeTemplate,
  TEMPLATE_NAMES,
  type TemplateName,
} from "../scenario/templates.js";
import { parseLayer, serializeLayer } from "../scenario/clone-area.js";
import { writeWithBackup } from "../refactor/byte-edit.js";
import { assertInsideRoot } from "../utils/path-guard.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function rejectFlagShape(label: string, raw: string): void {
  if (raw.startsWith("-")) {
    throw new Error(`Invalid ${label}: must not start with '-' (looks like a CLI flag)`);
  }
}

function formatPlan(opts: {
  template: TemplateName;
  targetPath: string;
  count: number;
  placeholders: string[];
  position: { x: number; y: number; z: number };
  yawDeg: number;
  mode: "dry-run" | "written";
}): string {
  const lines: string[] = [];
  lines.push(`## scenario_apply_template: ${opts.mode === "dry-run" ? "DRY-RUN" : "WRITTEN"}`);
  lines.push("");
  lines.push(`- Template: ${opts.template} — ${describeTemplate(opts.template)}`);
  lines.push(`- Target:   ${opts.targetPath}`);
  lines.push(`- Position: (${opts.position.x}, ${opts.position.y}, ${opts.position.z})`);
  lines.push(`- Yaw:      ${opts.yawDeg}°`);
  lines.push(`- Entities stamped: ${opts.count}`);
  lines.push("");
  lines.push("### Placeholder resources to replace");
  lines.push(
    "These resource refs are templated with sentinel GUIDs " +
      "(`{0000000000000001}...` etc). Use `refactor_replace_guid` to swap in real prefab GUIDs:",
  );
  for (const p of opts.placeholders) {
    lines.push(`  - ${p}`);
  }
  lines.push("");
  if (opts.mode === "dry-run") {
    lines.push("DRY-RUN. Pass `dry_run: false` to actually write the target layer.");
    lines.push("`.bak` sidecar will be created next to the target on write.");
  } else {
    lines.push(`Wrote ${opts.targetPath} (.bak sidecar preserved next to the file).`);
  }
  return lines.join("\n");
}

// ── Registration ─────────────────────────────────────────────────────────────

export function registerScenarioApplyTemplate(server: McpServer, config: Config): void {
  server.registerTool(
    "scenario_apply_template",
    {
      description:
        "Stamp a curated template (`fob_basic` / `checkpoint` / `patrol_grid`) into an existing scenario layer at a world position. " +
        "Appends the template's entities as new top-level entries; existing entities in the target are left untouched. " +
        "Placeholder resource refs use sentinel GUIDs that agents are expected to replace via `refactor_replace_guid`. " +
        "Defaults to `dry_run: true` — stamping mutates layer files, so the safe default is preview-first. " +
        "Refuses on uncommitted git changes to the target unless `force: true`. " +
        "Available templates: " +
        TEMPLATE_NAMES.map((n) => `\`${n}\` (${describeTemplate(n)})`).join("; ") +
        ".",
      inputSchema: {
        target_layer_path: z
          .string()
          .min(1)
          .describe(
            "Absolute path to the target .layer / .conf / .et file. Must not start with '-' (flag-smuggle guard).",
          ),
        template_name: z
          .enum(TEMPLATE_NAMES as unknown as [TemplateName, ...TemplateName[]])
          .describe("Which curated template to stamp"),
        position: z
          .object({
            x: z.number().describe("World X"),
            y: z.number().describe("World Y (typically 0 — Workbench snaps to terrain)"),
            z: z.number().describe("World Z"),
          })
          .describe("World position at which the template's origin is placed."),
        rotation_yaw_deg: z
          .number()
          .default(0)
          .describe(
            "Yaw rotation in degrees around the Y axis, applied around `position`. Default 0.",
          ),
        dry_run: z
          .boolean()
          .default(true)
          .describe(
            "When true (DEFAULT), don't write — return a plan with entity count and placeholder list. " +
              "Pass false to actually stamp the template into the target file.",
          ),
        force: z
          .boolean()
          .default(false)
          .describe("Bypass the git-clean refusal when writing. Default false."),
      },
    },
    async ({ target_layer_path, template_name, position, rotation_yaw_deg, dry_run, force }) => {
      try {
        rejectFlagShape("target_layer_path", target_layer_path);

        const targetAbs = resolve(target_layer_path);

        // Audit fix H-3: path containment. The resolved target must live
        // inside the project root — otherwise an LLM-injected `../../...`
        // could mutate an arbitrary file on disk.
        assertInsideRoot(targetAbs, config.projectPath, "target_layer_path");

        if (!existsSync(targetAbs)) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Target layer not found: ${targetAbs}`,
              },
            ],
            isError: true,
          };
        }

        const targetText = readFileSync(targetAbs, "utf-8");
        // Audit fix H-4: dispatch on file extension. `.conf` / `.ent` keep
        // the real root so the header's own properties survive when we
        // re-serialize. `.layer` files stay multi-root.
        const isSingleRoot = /\.(conf|ent)$/i.test(targetAbs);
        const targetRoot = parseLayer(targetText, { singleRoot: isSingleRoot });

        const result = applyTemplate(targetRoot, {
          template: template_name,
          position,
          yawDeg: rotation_yaw_deg,
        });

        const newText = serializeLayer(targetRoot);

        if (dry_run) {
          return {
            content: [
              {
                type: "text" as const,
                text: formatPlan({
                  template: template_name,
                  targetPath: targetAbs,
                  count: result.entityCount,
                  placeholders: result.placeholders,
                  position,
                  yawDeg: rotation_yaw_deg,
                  mode: "dry-run",
                }),
              },
            ],
          };
        }

        writeWithBackup(targetAbs, newText, { force, keepBackup: true });

        return {
          content: [
            {
              type: "text" as const,
              text: formatPlan({
                template: template_name,
                targetPath: targetAbs,
                count: result.entityCount,
                placeholders: result.placeholders,
                position,
                yawDeg: rotation_yaw_deg,
                mode: "written",
              }),
            },
          ],
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [
            { type: "text" as const, text: `Error applying scenario template: ${msg}` },
          ],
          isError: true,
        };
      }
    },
  );
}
