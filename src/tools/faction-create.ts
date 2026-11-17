/**
 * `faction_create` — scaffold a new `Configs/Factions/<Key>.conf` file from
 * a template (L8).
 *
 * Emits a root `SCR_Faction` with the engine's attribute names as vanilla
 * Configs/Factions/*.conf write them: `FactionKey`, `FactionColor` (four 0-1
 * floats) and `UIInfo SCR_FactionUIInfo { Name }`. W11 run 6 found the old
 * `m_sFactionKey`/`m_sFactionName`/`m_FactionColor` names loaded but ignored.
 *
 * Write-mode behaviors:
 *   - Refuses if the target already exists, unless `force: true`.
 *   - Refuses if the target file (or its parent) has uncommitted git
 *     changes, unless `force: true`. The check uses `isGitClean` from
 *     `refactor/byte-edit.ts` — same idiom as the other write tools.
 *   - `dry_run: true` returns the rendered content without writing.
 *
 * Flag-smuggle guard: `out_path` and `faction_key` are checked for a
 * leading `-` BEFORE any `resolve()` so a malicious value can't end up
 * masquerading as a CLI flag to a downstream tool.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { writeFileAtomic } from "../utils/atomic-write.js";
import { resolve, dirname, join } from "node:path";
import type { Config } from "../config.js";
import type { EnfusionNode } from "../formats/enfusion-text.js";
import { buildFactionNode, renderFactionText } from "../templates/faction.js";
import { isGitClean } from "../refactor/byte-edit.js";
import { assertInsideRoot } from "../utils/path-guard.js";

// ── Types ─────────────────────────────────────────────────────────────────────

/** RGB color triple, 0-255 per channel; written as 0-1 floats with alpha 1. */
export interface ColorRgb {
  r: number;
  g: number;
  b: number;
}

/** Inputs to `buildFactionConf` — the pure rendering helper. */
export interface FactionConfOptions {
  factionKey: string;
  displayName: string;
  color: ColorRgb;
  /** UIInfo instance GUID without braces; generated when omitted. */
  uiInfoGuid?: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** `faction_key` must be uppercase, alphanum + underscore, 2–16 chars. */
export const FACTION_KEY_RE = /^[A-Z][A-Z0-9_]{1,15}$/;

/** Neutral gray default when no color is supplied. */
const DEFAULT_COLOR: ColorRgb = { r: 128, g: 128, b: 128 };

// ── Pure builder ──────────────────────────────────────────────────────────────

/**
 * Build the EnfusionNode tree for a faction.conf. Exported so unit tests
 * can exercise the rendering without touching the filesystem. The shape and
 * property names follow vanilla Configs/Factions/*.conf; see
 * `src/templates/faction.ts`.
 */
export function buildFactionConf(opts: FactionConfOptions): EnfusionNode {
  return buildFactionNode(opts);
}

/** Render the faction.conf text (vanilla shape, string values quoted). */
export function renderFactionConf(opts: FactionConfOptions): string {
  return renderFactionText(opts);
}

// ── Validation helpers ────────────────────────────────────────────────────────

/** Validate a single color channel. Throws on out-of-range. */
function validateChannel(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 255) {
    throw new Error(
      `Invalid color ${name}: must be an integer in [0, 255], got ${value}`,
    );
  }
}

/** Validate the full faction-key shape. Throws on mismatch. */
export function validateFactionKey(key: string): void {
  if (!FACTION_KEY_RE.test(key)) {
    throw new Error(
      `Invalid faction_key "${key}": must match /^[A-Z][A-Z0-9_]{1,15}$/ ` +
        `(uppercase letter first, then 1-15 uppercase letters/digits/underscores)`,
    );
  }
}

// ── Registration ──────────────────────────────────────────────────────────────

export function registerFactionCreate(server: McpServer, config: Config): void {
  server.registerTool(
    "faction_create",
    {
      description:
        "Scaffold a new Configs/Factions/<Key>.conf file for an Arma Reforger mod. " +
        "Emits SCR_Faction with FactionKey, FactionColor (0-1 floats) and UIInfo.Name, the names vanilla faction configs use. " +
        "Refuses to overwrite an existing file or to write when the target has uncommitted git changes — pass force=true to override. " +
        "Use dry_run=true to preview without writing. " +
        "config_create with configType='faction' writes the same shape from an RGBA string.",
      inputSchema: {
        faction_key: z
          .string()
          .describe(
            "Faction key — e.g. 'US', 'FIA', 'RUR'. Must match /^[A-Z][A-Z0-9_]{1,15}$/ " +
              "(starts uppercase, 2-16 chars, uppercase + digits + underscore only). " +
              "Must not start with '-' (flag-smuggle guard).",
          ),
        display_name: z
          .string()
          .min(1)
          .describe("Human-readable name shown in UI, e.g. 'United States Army'."),
        color_rgb: z
          .object({
            r: z.number().int().min(0).max(255).describe("Red channel 0-255"),
            g: z.number().int().min(0).max(255).describe("Green channel 0-255"),
            b: z.number().int().min(0).max(255).describe("Blue channel 0-255"),
          })
          .optional()
          .describe("RGB color 0-255 per channel. Defaults to neutral gray (128,128,128)."),
        out_path: z
          .string()
          .optional()
          .describe(
            "Override target path. Default: <projectPath>/Configs/Factions/<faction_key>.conf. " +
              "Must end in .conf and must not start with '-' (flag-smuggle guard).",
          ),
        dry_run: z
          .boolean()
          .default(false)
          .describe("When true, return the rendered content without writing the file."),
        force: z
          .boolean()
          .default(false)
          .describe(
            "Bypass overwrite refusal and uncommitted-changes refusal. Use sparingly.",
          ),
      },
    },
    async ({ faction_key, display_name, color_rgb, out_path, dry_run, force }) => {
      try {
        // ── Flag-smuggle guards (BEFORE any resolve()) ──────────────────────
        if (faction_key.startsWith("-")) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Invalid faction_key: must not start with '-' (got: ${faction_key})`,
              },
            ],
            isError: true,
          };
        }
        if (out_path !== undefined && out_path.startsWith("-")) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Invalid out_path: must not start with '-' (got: ${out_path})`,
              },
            ],
            isError: true,
          };
        }

        // ── Input validation ────────────────────────────────────────────────
        validateFactionKey(faction_key);
        if (color_rgb) {
          validateChannel("r", color_rgb.r);
          validateChannel("g", color_rgb.g);
          validateChannel("b", color_rgb.b);
        }
        const color: ColorRgb = color_rgb ?? DEFAULT_COLOR;

        // ── Resolve target path ─────────────────────────────────────────────
        // Both branches require projectPath because out_path is containment-
        // checked against it. Without a root, an LLM-supplied out_path could
        // escape to anywhere on disk (CWE-22 / H-3 audit finding).
        if (!config.projectPath) {
          return {
            content: [
              {
                type: "text" as const,
                text:
                  "No projectPath configured. " +
                  "Set ENFUSION_PROJECT_PATH; out_path is resolved relative to and contained within projectPath.",
              },
            ],
            isError: true,
          };
        }
        let targetPath: string;
        if (out_path !== undefined) {
          // A faction config is a .conf: out_path may not name any other project file, which
          // force:true would replace wholesale (offline-writers-05).
          if (!out_path.toLowerCase().endsWith(".conf")) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Invalid out_path: must end in .conf (got: ${out_path})`,
                },
              ],
              isError: true,
            };
          }
          targetPath = resolve(config.projectPath, out_path);
          // Containment check: out_path must resolve inside projectPath.
          // Catches `../../escape.conf`, absolute-path overrides, etc.
          assertInsideRoot(targetPath, config.projectPath, "out_path");
        } else {
          targetPath = join(
            resolve(config.projectPath),
            "Configs",
            "Factions",
            `${faction_key}.conf`,
          );
        }

        // ── Render content ──────────────────────────────────────────────────
        const content = renderFactionConf({
          factionKey: faction_key,
          displayName: display_name,
          color,
        });

        // ── Dry-run short-circuit ───────────────────────────────────────────
        if (dry_run) {
          return {
            content: [
              {
                type: "text" as const,
                text:
                  `**faction_create (dry_run)** — target: ${targetPath}\n\n` +
                  "```\n" +
                  content +
                  "\n```",
              },
            ],
          };
        }

        // ── Existence check ─────────────────────────────────────────────────
        if (existsSync(targetPath) && !force) {
          return {
            content: [
              {
                type: "text" as const,
                text:
                  `Refusing to overwrite existing file: ${targetPath}\n\n` +
                  "Pass force=true to overwrite, or dry_run=true to preview.\n\n" +
                  "Generated content (not written):\n\n```\n" +
                  content +
                  "\n```",
              },
            ],
            isError: true,
          };
        }

        // ── Git-clean check ─────────────────────────────────────────────────
        // Probe the target path; when the file doesn't exist yet, `isGitClean`
        // reports "file does not exist" — for create-mode that's fine, so we
        // probe the parent directory instead to surface a dirty worktree.
        if (!force) {
          const probePath = existsSync(targetPath) ? targetPath : dirname(targetPath);
          // Walk up until we find an existing directory — needed because the
          // target's parent may not exist yet (Configs/Factions/ is created
          // by this tool on first run). Stop at filesystem root.
          let probe = probePath;
          while (!existsSync(probe)) {
            const parent = dirname(probe);
            if (parent === probe) break;
            probe = parent;
          }
          if (existsSync(probe)) {
            const clean = isGitClean(probe);
            if (!clean.clean && !clean.reason.includes("not inside a git repo")) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text:
                      `Refusing to write ${targetPath}: ${clean.reason}. ` +
                      "Commit or stash your changes, or pass force=true to override.\n\n" +
                      "Generated content (not written):\n\n```\n" +
                      content +
                      "\n```",
                  },
                ],
                isError: true,
              };
            }
          }
        }

        // ── Write ───────────────────────────────────────────────────────────
        mkdirSync(dirname(targetPath), { recursive: true });
        // force replaces through write-then-rename; otherwise a new file only, flag wx
        // (write-safety gap 20).
        if (force) writeFileAtomic(targetPath, content);
        else writeFileSync(targetPath, content, { encoding: "utf-8", flag: "wx" });

        return {
          content: [
            {
              type: "text" as const,
              text:
                `**Faction config created**: ${targetPath}\n\n` +
                "```\n" +
                content +
                "\n```\n\n" +
                "Next steps:\n" +
                "1. Add this faction to your in-game editor faction list (see kb/Modding_And_Extensions/faction-creation.md).\n" +
                "2. Set `m_sFactionFlag`, `\"Identity of soldiers\"`, and `m_aEntityCatalogs` on the new file as needed.\n" +
                "3. Reference this faction key on entities via `SCR_FactionAffiliationComponent.\"faction affiliation\"`.",
            },
          ],
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [
            { type: "text" as const, text: `Error creating faction: ${msg}` },
          ],
          isError: true,
        };
      }
    },
  );
}
