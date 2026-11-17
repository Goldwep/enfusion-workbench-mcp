import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import type { Config } from "../config.js";
import { PakVirtualFS } from "../pak/vfs.js";
import { readTextFileBounded } from "../utils/safe-read.js";
import type { WorkbenchClient } from "../workbench/client.js";
import { validateProjectPath } from "../utils/safe-path.js";
import { resolveGameDataPath, findLooseFile, resolveAddonDir } from "../utils/game-paths.js";
import { generateGuid } from "../formats/guid.js";
import { registerProjectFile } from "./wb-resources.js";
import {
  walkChain,
  mergeAncestryComponents,
  parseTopLevelComponents,
  type AncestorLevel,
} from "../utils/prefab-ancestry.js";

// ── The text transform (pure) ────────────────────────────────────────────────

/**
 * Why a duplicate's paths are refused, or null when they are fine. The source must be a relative
 * game resource path (no `..`, no drive, no leading separator) to a `.et` or `.conf`, and the
 * destination must keep that extension.
 */
export function duplicatePathError(bareSource: string, destPath: string): string | null {
  const ext = /\.(et|conf)$/i.exec(bareSource)?.[0].toLowerCase();
  if (!ext) return `sourcePath must name a prefab (.et) or a config (.conf): ${bareSource}`;
  if (
    isAbsolute(bareSource) ||
    /^[A-Za-z]:/.test(bareSource) ||
    /^[\\/]/.test(bareSource) ||
    bareSource.split(/[\\/]/).includes("..")
  ) {
    return `sourcePath must be a relative game resource path with no '..': ${bareSource}`;
  }
  if (!destPath.toLowerCase().endsWith(ext)) {
    return `destPath must end in ${ext}, the source's extension: ${destPath}`;
  }
  return null;
}

export interface DuplicateTransformOptions {
  /** The ancestry chain, oldest ancestor first and the source itself last (walkChain). */
  levels?: readonly AncestorLevel[];
  /** Strip the parent reference (applied only when the chain has more than one level). */
  flatten: boolean;
  /** The 16 hex digits written into the `ID "..."` line, when the text has one. */
  newEntityId: string;
}

export interface DuplicateTransformResult {
  content: string;
  /** One entry per injected component: `TypeName (from [depth] path)`. */
  injected: string[];
  /** True when the chain had more than one level, so injection and flatten were considered. */
  ancestryApplied: boolean;
}

/**
 * game_duplicate's edits on the source text, with no file access (write-safety audit gap 3).
 * Three edits, each a splice that keeps every other byte:
 *   1. top-level components that ancestors declare and the source does not are inserted after the
 *      source's `components {` line (or a components block is added before the final `}`);
 *   2. with `flatten`, the parent reference of the first class line is removed;
 *   3. the first `ID "<16 hex>"` line gets `newEntityId`.
 * Edits 1 and 2 apply only when `levels` holds more than one level. With no levels, no flatten and
 * the ID the text already holds, the result is the input byte for byte.
 */
export function transformDuplicate(
  rawContent: string,
  options: DuplicateTransformOptions,
): DuplicateTransformResult {
  const levels = options.levels ?? [];
  let content = rawContent;
  const injected: string[] = [];
  const ancestryApplied = levels.length > 1;

  if (ancestryApplied) {
    // Merged components from the full ancestry.
    const merged = mergeAncestryComponents([...levels]);

    // Top-level component GUIDs per ancestor level (excludes nested sub-components).
    const topLevelByDepth = new Map<number, Set<string>>();
    for (const level of levels) {
      topLevelByDepth.set(level.depth, new Set(parseTopLevelComponents(level.rawContent).keys()));
    }

    // Existing top-level GUIDs in the leaf file.
    const existingGuids = new Set(parseTopLevelComponents(rawContent).keys());

    // Components to inject, as raw text fragments.
    const fragments: string[] = [];
    for (const [guid, { comp, source }] of merged) {
      if (existingGuids.has(guid)) continue; // already declared in leaf
      if (source.depth === levels.length - 1) continue; // it's in the leaf itself
      // Only inject top-level components; skip nested sub-components.
      if (!topLevelByDepth.get(source.depth)?.has(guid)) continue;
      // Raw text fragment keeping the original body exactly.
      fragments.push(`  ${comp.typeName} "{${comp.guid}}" {${comp.rawBody}  }`);
      injected.push(`${comp.typeName} (from [${source.depth}] ${source.path})`);
    }

    if (fragments.length > 0) {
      // Insert into the components block by string splice (no lossy parse and serialise).
      const componentsMatch = /^([ \t]*components\s*\{)/m.exec(content);
      if (componentsMatch) {
        const insertPos = componentsMatch.index + componentsMatch[0].length;
        content =
          content.slice(0, insertPos) + "\n" + fragments.join("\n") + content.slice(insertPos);
      } else {
        // No components block: insert one before the final closing brace.
        const lastBrace = content.lastIndexOf("}");
        content =
          content.slice(0, lastBrace) +
          " components {\n" +
          fragments.join("\n") +
          "\n }\n" +
          content.slice(lastBrace);
      }
    }

    // With flatten, strip the parent reference from the raw text.
    if (options.flatten) {
      content = content.replace(/^(\w+)\s*:\s*"[^"]*"\s*\{/m, "$1 {");
    }
  }

  // The ID field (entity GUID) gets the new value so the duplicate is independent.
  content = content.replace(/^(\s*ID\s+")[0-9A-Fa-f]{16}(")/m, `$1${options.newEntityId}$2`);

  return { content, injected, ancestryApplied };
}

export function registerGameDuplicate(
  server: McpServer,
  config: Config,
  client: WorkbenchClient,
): void {
  server.registerTool(
    "game_duplicate",
    {
      description:
        "Duplicate a base game prefab (.et) or config (.conf) into your mod folder for editing. " +
        "Reads the file from game data or .pak archives, resolves the full ancestor chain, and injects " +
        "inherited components so the duplicate is a complete representation of what the entity provides. " +
        "Writes the file to your mod's directory, then registers it with Workbench so it gets a new resource GUID. " +
        "Mirrors the Workbench right-click → Duplicate workflow. " +
        "Set flatten=true to bake all ancestor components into a standalone prefab with no parent reference. " +
        "Use asset_search to find the source path (with GUID) first.",
      inputSchema: {
        sourcePath: z
          .string()
          .describe(
            "Source prefab path — either a GUID reference like '{657590C1EC9E27D3}Prefabs/Groups/OPFOR/Group_USSR_LightFireTeam.et' " +
              "or a bare relative path like 'Prefabs/Groups/OPFOR/Group_USSR_LightFireTeam.et'",
          ),
        destPath: z
          .string()
          .describe(
            "Destination path within your mod folder, relative to the addon root " +
              "(e.g., 'Prefabs/Groups/MyCustomGroup.et'). Must keep the source's extension (.et or .conf)",
          ),
        modName: z
          .string()
          .optional()
          .describe(
            "Addon folder name under ENFUSION_PROJECT_PATH (e.g., 'MyMod'). " +
              "If omitted, the first addon found in the project path is used.",
          ),
        flatten: z
          .boolean()
          .default(false)
          .describe(
            "When false (default), keeps the parent reference and includes ancestor components as overridable " +
              "entries with original GUIDs preserved. " +
              "When true, strips the parent reference and bakes all ancestor components into the copy, producing " +
              "a fully standalone prefab.",
          ),
        register: z
          .boolean()
          .default(true)
          .describe(
            "Register the duplicated file with Workbench after writing (assigns a new GUID). " +
              "Requires Workbench to be running. Set false to write the file without registering.",
          ),
      },
    },
    async ({ sourcePath, destPath, modName, flatten, register }) => {
      // Strip GUID prefix from sourcePath if present: {GUID}path → path
      const bareSourcePath = sourcePath.replace(/^\{[0-9A-Fa-f]{16}\}/, "");

      // The source is a game resource path: relative, no '..', a prefab or a config. Anything
      // else would be joined onto the game data root and read from outside it (total audit
      // offline-writers-03). The copy keeps the source's kind.
      const pathError = duplicatePathError(bareSourcePath, destPath);
      if (pathError) {
        return { content: [{ type: "text", text: pathError }], isError: true };
      }

      // Locate the source file — extracted library first, then pak loose files
      let sourceFile: string | null = null;
      let sourceLabel = "";

      if (config.extractedPath && existsSync(config.extractedPath)) {
        sourceFile = findLooseFile(config.extractedPath, bareSourcePath);
        if (sourceFile) sourceLabel = "(extracted library)";
      }

      // M18: when the loose file isn't found, fall back to the .pak VFS —
      // a stock install ships nearly everything packed. Mirrors
      // utils/prefab-ancestry.ts readPrefabContent().
      let pakSource = false;
      if (!sourceFile) {
        const gameDataPath = resolveGameDataPath(config.gamePath);
        if (!gameDataPath) {
          return {
            content: [{ type: "text", text: `Base game not found at ${config.gamePath}.` }],
            isError: true,
          };
        }
        sourceFile = findLooseFile(gameDataPath, bareSourcePath);
        if (sourceFile) sourceLabel = "(pak loose files)";
      }

      if (!sourceFile) {
        const pakVfs = PakVirtualFS.get(config.gamePath);
        if (pakVfs && pakVfs.exists(bareSourcePath)) {
          pakSource = true;
          sourceFile = bareSourcePath;
          sourceLabel = "(.pak archive)";
        }
      }

      if (!sourceFile) {
        return {
          content: [
            {
              type: "text",
              text:
                `Source file not found: ${bareSourcePath}\n` +
                (config.extractedPath
                  ? `Searched extracted library: ${config.extractedPath}\n`
                  : "") +
                `Searched pak loose files and .pak archives under: ${config.gamePath}\n` +
                "Use asset_search to verify the path exists.",
            },
          ],
          isError: true,
        };
      }

      // Resolve destination addon directory
      const addonDir = resolveAddonDir(config.projectPath, modName ?? config.defaultMod);
      if (!addonDir) {
        return {
          content: [
            {
              type: "text",
              text:
                "Could not find addon directory. " +
                (modName
                  ? `'${modName}' not found under ${config.projectPath}`
                  : `No addons found under ${config.projectPath}`) +
                ". Provide modName matching the addon folder name.",
            },
          ],
          isError: true,
        };
      }

      // Validate and resolve the destination path
      let absDestPath: string;
      try {
        absDestPath = validateProjectPath(addonDir, destPath.replace(/\\/g, "/"));
      } catch {
        return {
          content: [{ type: "text", text: `Invalid destination path: ${destPath}` }],
          isError: true,
        };
      }

      if (existsSync(absDestPath)) {
        return {
          content: [{ type: "text", text: `Destination already exists: ${absDestPath}` }],
          isError: true,
        };
      }

      // Read source content
      let rawContent: string;
      try {
        if (pakSource) {
          const pakVfs = PakVirtualFS.get(config.gamePath);
          if (!pakVfs) throw new Error("pak VFS unavailable");
          rawContent = pakVfs.readTextFile(bareSourcePath);
        } else {
          rawContent = readTextFileBounded(sourceFile);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [{ type: "text", text: `Failed to read source file: ${msg}` }],
          isError: true,
        };
      }

      // Resolve ancestry (only for .et prefab files, not .conf), then apply the text edits.
      let ancestryNote = "";
      let finalContent: string;
      try {
        const chain = bareSourcePath.endsWith(".et")
          ? walkChain(bareSourcePath, config)
          : { levels: [] as AncestorLevel[], warnings: [] as string[] };
        // Replace the ID field (entity GUID) with a fresh one so the duplicate is independent.
        const edit = transformDuplicate(rawContent, {
          levels: chain.levels,
          flatten,
          newEntityId: generateGuid(),
        });
        finalContent = edit.content;
        if (edit.ancestryApplied) {
          ancestryNote = `\n\nAncestry: resolved ${chain.levels.length} level(s), injected ${edit.injected.length} inherited component(s).`;
          if (edit.injected.length > 0) {
            ancestryNote += `\nInjected: ${edit.injected.join(", ")}`;
          }
          if (flatten) {
            ancestryNote += "\nParent reference stripped (flatten=true).";
          }
          if (chain.warnings.length > 0) {
            ancestryNote += `\nWarnings: ${chain.warnings.join("; ")}`;
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [{ type: "text", text: `Failed to process ancestry: ${msg}` }],
          isError: true,
        };
      }

      try {
        mkdirSync(dirname(absDestPath), { recursive: true });
        // A new file only (the existsSync refusal above): flag wx refuses one that appeared since.
        writeFileSync(absDestPath, finalContent, { encoding: "utf-8", flag: "wx" });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [{ type: "text", text: `Failed to write file: ${msg}` }],
          isError: true,
        };
      }

      // Register with Workbench to assign a new GUID (if requested)
      if (register) {
        try {
          // EMCP_WB_Resources register (W2): project-relative path, written only with confirm.
          const reg = await registerProjectFile(client, addonDir, absDestPath);

          const guidNote = reg.ok
            ? `Registered with Workbench — a new GUID has been assigned${reg.resourceName ? `: ${reg.resourceName}` : ""}.`
            : `Warning: registration returned: ${reg.message}`;

          return {
            content: [
              {
                type: "text",
                text:
                  [
                    "**Prefab duplicated successfully**",
                    `- Source: ${sourcePath}`,
                    `- Copied from: ${sourceFile} ${sourceLabel}`,
                    `- Saved to: ${absDestPath}`,
                    "",
                    guidNote,
                    "Use wb_resources getInfo or wb_prefabs getGuid to look up the new GUID.",
                    "",
                    "**Next steps:**",
                    "1. Edit the .et file to customize it.",
                    `2. Reference it as {GUID}${destPath} in your prefabs.`,
                  ].join("\n") + ancestryNote,
              },
            ],
          };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return {
            content: [
              {
                type: "text",
                text:
                  [
                    "**File copied but Workbench registration failed**",
                    `- Saved to: ${absDestPath}`,
                    `- Registration error: ${msg}`,
                    "",
                    "To assign a GUID manually: in Workbench Resource Browser, right-click the file and register it.",
                  ].join("\n") + ancestryNote,
              },
            ],
            isError: true,
          };
        }
      }

      return {
        content: [
          {
            type: "text",
            text:
              [
                "**Prefab copied (not registered)**",
                `- Source: ${sourcePath}`,
                `- Saved to: ${absDestPath}`,
                "",
                "To assign a GUID: call again with register=true, or register manually in Workbench.",
              ].join("\n") + ancestryNote,
          },
        ],
      };
    },
  );
}
