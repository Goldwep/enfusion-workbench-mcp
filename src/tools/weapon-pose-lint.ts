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

function rejectFlagShape(label: string, raw: string): void {
  if (raw.startsWith("-")) {
    throw new Error(`Invalid ${label}: must not start with '-' (flag-smuggle guard)`);
  }
}

export function registerWeaponPoseLint(server: McpServer): void {
  server.registerTool(
    "weapon_pose_lint",
    {
      description:
        "String-level check of a character `.agr` (Animation Graph Runtime) file against the expected " +
        "`GlobalTags { \"WEAPON\" \"ADS\" \"STANCE\" ... }` block. " +
        "Reports missing tags as errors and unknown tags as warnings. " +
        "Intentionally regex-only — no Enforce parser, no .anm cross-reference. " +
        "Use this as a fast pre-publish gate to confirm a character's weapon-related tag set matches " +
        "the engine's expectations. Pair with `animation_graph action=inspect` for deeper analysis.",
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
            content: [
              { type: "text" as const, text: `AGR file not found: ${abs}` },
            ],
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
            content: [
              { type: "text" as const, text: `Not a regular file: ${abs}` },
            ],
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

        // MCP convention: surface as isError when the lint actually fails so
        // callers/CIs can branch on it without parsing the body.
        return {
          content: [{ type: "text" as const, text }],
          isError: !result.ok,
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [
            { type: "text" as const, text: `Error in weapon_pose_lint: ${msg}` },
          ],
          isError: true,
        };
      }
    },
  );
}
