/**
 * `weapon_pose_lint` — MCP tool wrapper.
 *
 * String-level lint of a character `.agr` (Animation Graph Runtime) file
 * against the expected `GlobalTags { "WEAPON" "ADS" "STANCE" ... }` block.
 * Read-only. The check is intentionally regex-only — see
 * `src/animation/weapon-pose-lint.ts` for the rationale.
 *
 * Flag-smuggle guard rejects any `agr_path` starting with '-' BEFORE
 * resolve() — matches every other L8 tool that takes an absolute path input.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import {
  DEFAULT_EXPECTED_TAGS,
  formatPoseLintMarkdown,
  lintWeaponPose,
} from "../animation/weapon-pose-lint.js";
import { readTextFileBounded } from "../utils/safe-read.js";

/** At most 400 characters (DEC-067 OD-7); the longer prose is in the anim-lint-tools KB page. */
export const WEAPON_POSE_LINT_DESCRIPTION =
  "Regex-only check of a character `.agr` GlobalTags block (WEAPON, ADS, STANCE ...). " +
  "Missing tags are error findings (not a tool error), unknown tags warnings. No parser and no .anm cross-reference, so " +
  "it is a fast pre-publish gate; `animation_graph inspect` goes deeper. Why regex-only and " +
  "the default tag set: KB anim-lint-tools.";

function rejectFlagShape(label: string, raw: string): void {
  if (raw.startsWith("-")) {
    throw new Error(`Invalid ${label}: must not start with '-' (flag-smuggle guard)`);
  }
}

export function registerWeaponPoseLint(server: McpServer): void {
  server.registerTool(
    "weapon_pose_lint",
    {
      description: WEAPON_POSE_LINT_DESCRIPTION,
      inputSchema: {
        agr_path: z
          .string()
          .min(1)
          .describe(
            "Absolute path to a character .agr file. Must not start with '-' (flag-smuggle guard).",
          ),
        expected_tags: z
          .array(z.string())
          .optional()
          .describe(
            `Override the expected tag set. Defaults to ${DEFAULT_EXPECTED_TAGS.map((t) => `"${t}"`).join(", ")}. ` +
              "Comparison is case-sensitive — match the engine's behavior.",
          ),
      },
    },
    async ({ agr_path, expected_tags }) => {
      try {
        rejectFlagShape("agr_path", agr_path);

        const abs = resolve(agr_path);
        if (!existsSync(abs)) {
          return {
            content: [{ type: "text" as const, text: `AGR file not found: ${abs}` }],
            isError: true,
          };
        }
        let isFile = false;
        try {
          isFile = statSync(abs).isFile();
        } catch {
          isFile = false;
        }
        if (!isFile) {
          return {
            content: [{ type: "text" as const, text: `Not a regular file: ${abs}` }],
            isError: true,
          };
        }

        let content: string;
        try {
          content = readTextFileBounded(abs);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return {
            content: [
              {
                type: "text" as const,
                text: `Error reading AGR file ${abs}: ${msg}`,
              },
            ],
            isError: true,
          };
        }

        const result = lintWeaponPose(content, expected_tags);
        const text = formatPoseLintMarkdown({ filePath: abs, result });

        // Findings (missing tags, no GlobalTags block) are the lint's answer, not a tool error:
        // W4 run 1 (w4-49-lint-tools) read the old `isError: !result.ok` on a vanilla
        // non-character .agr as TOOL_ERROR. isError stays for argument and I/O failures only;
        // callers branch on the "Status:" line of the report.
        return {
          content: [{ type: "text" as const, text }],
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [{ type: "text" as const, text: `Error in weapon_pose_lint: ${msg}` }],
          isError: true,
        };
      }
    },
  );
}
