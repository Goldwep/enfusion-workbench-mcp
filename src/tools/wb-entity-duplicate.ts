import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import type { Config } from "../config.js";
import type { WorkbenchClient } from "../workbench/client.js";
import { resolveGameDataPath, findLooseFile } from "../utils/game-paths.js";
import { resolveAddonRoot } from "../utils/addon-root.js";
import { PakVirtualFS } from "../pak/vfs.js";
import { validateProjectPath } from "../utils/safe-path.js";
import { registerProjectFile } from "./wb-resources.js";
import { requireEditMode, formatConnectionStatus } from "../workbench/status.js";
import { isHandlerError, handlerErrorMessage, modeGateResponse } from "../workbench/response.js";

/**
 * wb_entity_duplicate — duplicate a scene entity into the mod folder.
 *
 * Workflow:
 *   1. Ask Workbench for the entity's ancestor prefab path (e.g. "{GUID}Prefabs/Vehicles/...")
 *   2. Find that file (extracted library, loose game files, then the .pak archives, as
 *      game_duplicate does) and copy its bytes to destPath in the mod
 *   3. RegisterResourceFile → Workbench assigns a new GUID via .meta
 *   4. Optionally delete the original and place the new copy
 */
export function registerWbEntityDuplicate(
  server: McpServer,
  config: Config,
  client: WorkbenchClient,
): void {
  server.registerTool(
    "wb_entity_duplicate",
    {
      description:
        "Save a placed entity (base-game instances too) as a new .et in your addon with a new GUID, " +
        "register it, and by default replace the original in the scene, making it editable.",
      inputSchema: {
        entityName: z.string().describe("entity placed in the scene"),
        destPath: z.string().describe("addon-relative .et path"),
        modName: z.string().optional().describe("addon folder; default the first found"),
        replaceInScene: z.boolean().default(true).describe("false: only write the prefab file"),
      },
    },
    async ({ entityName, destPath, modName, replaceInScene }) => {
      const modeErr = requireEditMode(client, "duplicate entity");
      if (modeErr) {
        return modeGateResponse(modeErr, client);
      }

      // Resolve the addon directory (ENFUSION_PROJECT_PATH is the addons folder; src/utils/addon-root.ts)
      const addon = resolveAddonRoot(config, { modName, firstIfSeveral: true });
      if (!addon.ok) {
        return {
          content: [
            {
              type: "text",
              text: `Could not find addon directory: ${addon.message}. Provide modName matching the addon folder name.`,
            },
          ],
          isError: true,
        };
      }
      const addonDir = addon.root;

      // Check destination doesn't already exist
      const absDestPath = validateProjectPath(addonDir, destPath.replace(/\\/g, "/"));
      if (existsSync(absDestPath)) {
        return {
          content: [{ type: "text", text: `Destination already exists: ${absDestPath}` }],
          isError: true,
        };
      }

      // Step 1: Get the ancestor prefab path from Workbench. The W1 handler takes an entity
      // reference (DEC-061), not the 1.x entityName key.
      const ancestorResp = await client.call<{
        status: string;
        message?: string;
        ancestorPath?: string;
      }>("EMCP_WB_Prefabs", { action: "getAncestor", entity: `name:${entityName}` });

      if (ancestorResp.status !== "ok" || !ancestorResp.ancestorPath) {
        return {
          content: [
            {
              type: "text",
              text: `Could not get ancestor prefab for '${entityName}': ${ancestorResp.message ?? JSON.stringify(ancestorResp)}`,
            },
          ],
          isError: true,
        };
      }

      // ancestorPath is like "{GUID}Prefabs/Vehicles/Wheeled/BTR70/BTR70.et"
      const bareAncestorPath = ancestorResp.ancestorPath.replace(/^\{[0-9A-Fa-f]{16}\}/, "");

      // Step 2: Find the source file (a stock install ships the prefabs packed) and copy its bytes
      const source = locateAncestorSource(config, bareAncestorPath);
      if ("error" in source) {
        return { content: [{ type: "text", text: source.error }], isError: true };
      }
      const sourceFile = source.label;

      try {
        // A byte copy (no UTF-8 round trip), created exclusively: an existing file is never replaced.
        const content = source.read();
        mkdirSync(dirname(absDestPath), { recursive: true });
        writeFileSync(absDestPath, content, { flag: "wx" });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [{ type: "text", text: `Failed to copy file: ${msg}` }],
          isError: true,
        };
      }

      // Step 3: Register the file with Workbench → assigns new GUID via .meta
      if (!existsSync(absDestPath + ".meta")) {
        // EMCP_WB_Resources register (W2): project-relative path, written only with confirm.
        const reg = await registerProjectFile(client, addonDir, absDestPath);

        if (!reg.ok) {
          return {
            content: [
              {
                type: "text",
                text:
                  `Prefab saved but registration failed: ${reg.message}\n` +
                  `File at: ${absDestPath}\nRegister manually in Workbench Resource Browser.`,
              },
            ],
            isError: true,
          };
        }
      }

      // Step 4: Read the new GUID from the .meta file
      const newGuid = readMetaGuid(absDestPath + ".meta");
      const prefabRef = newGuid ? `{${newGuid}}${destPath}` : destPath;

      if (!replaceInScene) {
        return {
          content: [
            {
              type: "text",
              text: [
                "**Prefab saved successfully**",
                `- Entity: ${entityName}`,
                `- Source: ${ancestorResp.ancestorPath}`,
                `- Saved to: ${absDestPath}`,
                `- GUID: ${newGuid ?? "(read .meta manually)"}`,
                `- Reference: ${prefabRef}`,
              ].join("\n"),
            },
          ],
        };
      }

      // Step 5: Read the entity's world transform and parent BEFORE touching the scene
      // (wb_entity get: IEntity.GetOrigin, not the source's parent-local coords). If it cannot be
      // read, ABORT here — never create a copy at the origin and never delete the original on a guess.
      const transform = await readEntityPlacement(client, entityName);
      if (!transform) {
        return {
          content: [
            {
              type: "text" as const,
              text:
                [
                  "**Prefab saved, but scene was NOT modified**",
                  `- Saved to: ${absDestPath}`,
                  `- GUID: ${newGuid ?? "(read .meta manually)"}`,
                  `- Reference: ${prefabRef}`,
                  `- Could not read the world position of "${entityName}" (EMCP_WB_Entity get failed).`,
                  `- Original entity "${entityName}" was NOT deleted and no copy was placed.`,
                  "- Place manually with wb_entity_create using the reference above, then delete the original.",
                ].join("\n") + formatConnectionStatus(client),
            },
          ],
          isError: true,
        };
      }
      if (transform.parentId || transform.parentName) {
        // The copy is created at top level (CreateEntity takes no parent): replacing a child
        // would move it out of its parent's hierarchy.
        return {
          content: [
            {
              type: "text" as const,
              text:
                [
                  "**Prefab saved, but scene was NOT modified**",
                  `- Saved to: ${absDestPath}`,
                  `- GUID: ${newGuid ?? "(read .meta manually)"}`,
                  `- Reference: ${prefabRef}`,
                  `- "${entityName}" is a child of ${transform.parentName || transform.parentId}; the copy would be placed at top level, so no copy was placed and the original was NOT deleted.`,
                  "- Place the reference under the same parent with wb_entity create (parent), then delete the original.",
                ].join("\n") + formatConnectionStatus(client),
            },
          ],
          isError: true,
        };
      }
      const { position, rotation } = transform;

      // Step 6: Place the new duplicate FIRST (safe order: create before delete)
      const newName = entityName + "_copy";
      let createResp: Record<string, unknown>;
      try {
        const createParams: Record<string, unknown> = {
          prefab: prefabRef,
          name: newName,
          position,
        };
        if (rotation) createParams.rotation = rotation;
        createResp = await client.call<Record<string, unknown>>(
          "EMCP_WB_CreateEntity",
          createParams,
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [
            {
              type: "text" as const,
              text:
                [
                  "**Prefab saved but placement failed**",
                  `- Saved to: ${absDestPath}`,
                  `- GUID: ${newGuid ?? "(read .meta manually)"}`,
                  `- Place error: ${msg}`,
                  `- Original entity "${entityName}" was NOT deleted.`,
                  `- Place manually using: ${prefabRef}`,
                ].join("\n") + formatConnectionStatus(client),
            },
          ],
          isError: true,
        };
      }
      if (isHandlerError(createResp)) {
        return {
          content: [
            {
              type: "text" as const,
              text:
                [
                  "**Prefab saved but placement failed**",
                  `- Saved to: ${absDestPath}`,
                  `- GUID: ${newGuid ?? "(read .meta manually)"}`,
                  `- Place error: ${handlerErrorMessage(createResp)}`,
                  `- Original entity "${entityName}" was NOT deleted.`,
                  `- Place manually using: ${prefabRef}`,
                ].join("\n") + formatConnectionStatus(client),
            },
          ],
          isError: true,
        };
      }

      // Verify the copy landed where the original is: read the created entity back (its world
      // origin), never the create answer's position. Only then is it safe to delete the original.
      const copyName =
        typeof createResp.entityName === "string" && createResp.entityName
          ? createResp.entityName
          : newName;
      const placed = await readEntityPlacement(client, copyName);
      const placedAt = placed ? placed.position : null;
      if (!placed || placed.parentId || placed.parentName || !positionsMatch(placed.position, position)) {
        return {
          content: [
            {
              type: "text" as const,
              text:
                [
                  "**Copy placed at an unverified position — original NOT deleted**",
                  `- Saved to: ${absDestPath}`,
                  `- GUID: ${newGuid ?? "(read .meta manually)"}`,
                  `- Requested position: ${position}`,
                  `- Read back: ${placedAt ?? "(the copy could not be read back)"}`,
                  `- New entity placed as: ${copyName}`,
                  `- Original entity "${entityName}" was left in place. Verify in Workbench, then delete one manually.`,
                ].join("\n") + formatConnectionStatus(client),
            },
          ],
          isError: true,
        };
      }

      // Step 7: Delete the original entity (only after the copy is verified)
      try {
        const delResp = await client.call<Record<string, unknown>>("EMCP_WB_DeleteEntity", {
          name: entityName,
        });
        if (isHandlerError(delResp)) {
          throw new Error(handlerErrorMessage(delResp));
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [
            {
              type: "text" as const,
              text:
                [
                  "**Prefab duplicated but original entity could not be deleted**",
                  `- Saved to: ${absDestPath}`,
                  `- GUID: ${newGuid ?? "(read .meta manually)"}`,
                  `- New entity placed as: ${newName}`,
                  `- Delete error: ${msg}`,
                  `- Delete "${entityName}" manually in Workbench.`,
                ].join("\n") + formatConnectionStatus(client),
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text:
              [
                "**Entity duplicated successfully**",
                `- Original: ${entityName} (${ancestorResp.ancestorPath}) -> deleted`,
                `- Copied from: ${sourceFile}`,
                `- New prefab: ${absDestPath}`,
                `- GUID: ${newGuid ?? "(read .meta manually)"}`,
                `- Placed as: ${newName} at ${position}${rotation ? ` (rotation ${rotation})` : ""}`,
                ...(typeof createResp.warning === "string" && createResp.warning.length > 0
                  ? [`- Warning: ${createResp.warning}`]
                  : []),
                `- Reference: ${prefabRef}`,
                "",
                "The entity is now editable — it references your mod's prefab, not the base game original.",
              ].join("\n") + formatConnectionStatus(client),
          },
        ],
      };
    },
  );
}

/**
 * Where the ancestor prefab's bytes come from, in game_duplicate's order: the extracted library,
 * the game's loose files, then the .pak archives (1.9.0.37 ships paks only). `label` names the
 * source for the reply; `read` returns the raw bytes.
 */
export function locateAncestorSource(
  config: Pick<Config, "gamePath" | "extractedPath">,
  barePath: string,
): { label: string; read: () => Buffer } | { error: string } {
  if (config.extractedPath && existsSync(config.extractedPath)) {
    const f = findLooseFile(config.extractedPath, barePath);
    if (f) return { label: f, read: () => readFileSync(f) };
  }
  const gameDataPath = resolveGameDataPath(config.gamePath);
  if (!gameDataPath) return { error: `Base game not found at ${config.gamePath}.` };
  const loose = findLooseFile(gameDataPath, barePath);
  if (loose) return { label: loose, read: () => readFileSync(loose) };
  const vfs = PakVirtualFS.get(config.gamePath);
  if (vfs && vfs.exists(barePath)) {
    return { label: `${barePath} (.pak archive)`, read: () => vfs.readFile(barePath) };
  }
  return {
    error:
      `Source file not found in game data: ${barePath}\n` +
      (config.extractedPath ? `Searched extracted library: ${config.extractedPath}\n` : "") +
      `Searched loose files under ${gameDataPath} and the .pak archives under ${config.gamePath}`,
  };
}

/** Parse an "x y z" vector string; null when it is not three finite numbers. */
export function parseVec3(s: string): [number, number, number] | null {
  const parts = s.trim().split(/\s+/);
  if (parts.length !== 3) return null;
  const nums = parts.map(Number);
  if (nums.some((n) => !Number.isFinite(n))) return null;
  return [nums[0]!, nums[1]!, nums[2]!];
}

/** True when two "x y z" strings describe the same point (within 1 cm). */
export function positionsMatch(a: string, b: string, tolerance = 0.01): boolean {
  const va = parseVec3(a);
  const vb = parseVec3(b);
  if (!va || !vb) return false;
  return va.every((n, i) => Math.abs(n - vb[i]!) <= tolerance);
}

/**
 * Read an entity's world position, rotation and parent through EMCP_WB_Entity get (W1): `coords`
 * and `angles` are the runtime entity's GetOrigin and GetAngles (world space), `parentId` is empty
 * for a top-level entity. Returns null when no valid position could be read; callers must abort.
 */
export async function readEntityPlacement(
  client: WorkbenchClient,
  entityName: string,
): Promise<{ position: string; rotation?: string; parentId: string; parentName: string } | null> {
  try {
    const r = await client.call<Record<string, unknown>>("EMCP_WB_Entity", {
      action: "get",
      entity: `name:${entityName}`,
    });
    if (r.status !== "ok") return null;
    const pos = typeof r.coords === "string" ? r.coords.trim() : "";
    if (!parseVec3(pos)) return null;
    const rot = typeof r.angles === "string" ? r.angles.trim() : "";
    const parentId = typeof r.parentId === "string" ? r.parentId : "";
    const parentName = typeof r.parentName === "string" ? r.parentName : "";
    return {
      position: pos,
      ...(parseVec3(rot) ? { rotation: rot } : {}),
      parentId,
      parentName,
    };
  } catch {
    return null;
  }
}

/** Read the GUID from a Workbench .meta file. Returns null if not found. */
function readMetaGuid(metaPath: string): string | null {
  try {
    const content = readFileSync(metaPath, "utf-8");
    const match = content.match(/Name\s+"(?:\{([0-9A-Fa-f]{16})\})[^"]+"/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}
