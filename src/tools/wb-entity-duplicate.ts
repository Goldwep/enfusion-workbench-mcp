import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import type { Config } from "../config.js";
import type { WorkbenchClient } from "../workbench/client.js";
import { resolveGameDataPath, findLooseFile, resolveAddonDir } from "../utils/game-paths.js";
import { validateProjectPath } from "../utils/safe-path.js";
import { requireEditMode, formatConnectionStatus } from "../workbench/status.js";
import { isHandlerError, handlerErrorMessage, modeGateResponse } from "../workbench/response.js";

/**
 * wb_entity_duplicate — duplicate a scene entity into the mod folder.
 *
 * Workflow:
 *   1. Ask Workbench for the entity's ancestor prefab path (e.g. "{GUID}Prefabs/Vehicles/...")
 *   2. Find that file in the game's loose files and copy it to destPath in the mod
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
        "Duplicate a scene entity (including locked base-game prefab instances) into your mod folder, " +
        "assigning it a new resource GUID. Mirrors the TC_BatchCreatePrefabsPlugin workflow: " +
        "saves the entity as a standalone .et prefab, registers it with Workbench, then replaces " +
        "the original scene entity with the new duplicate. " +
        "Use this after placing a base-game prefab in the scene to make it editable.",
      inputSchema: {
        entityName: z
          .string()
          .describe("Name of the entity already placed in the scene (e.g. 'MyM998_01')"),
        destPath: z
          .string()
          .describe(
            "Destination path within your mod folder, relative to the addon root " +
              "(e.g. 'Prefabs/Vehicles/MyCustomM998.et'). Must end in .et",
          ),
        modName: z
          .string()
          .optional()
          .describe(
            "Addon folder name under ENFUSION_PROJECT_PATH (e.g. 'MyMod'). " +
              "If omitted, the first addon found in the project path is used.",
          ),
        replaceInScene: z
          .boolean()
          .default(true)
          .describe(
            "If true (default), delete the original entity and place the new duplicate. " +
              "If false, only save the prefab file without touching the scene.",
          ),
      },
    },
    async ({ entityName, destPath, modName, replaceInScene }) => {
      const modeErr = requireEditMode(client, "duplicate entity");
      if (modeErr) {
        return modeGateResponse(modeErr, client);
      }

      // Resolve addon directory
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

      // Check destination doesn't already exist
      const absDestPath = validateProjectPath(addonDir, destPath.replace(/\\/g, "/"));
      if (existsSync(absDestPath)) {
        return {
          content: [{ type: "text", text: `Destination already exists: ${absDestPath}` }],
          isError: true,
        };
      }

      // Step 1: Get the ancestor prefab path from Workbench
      const ancestorResp = await client.call<{
        status: string;
        message?: string;
        ancestorPath?: string;
      }>("EMCP_WB_Prefabs", { action: "getAncestor", entityName });

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

      // Step 2: Find and copy the source file from game's loose files
      const gameDataPath = resolveGameDataPath(config.gamePath);
      if (!gameDataPath) {
        return {
          content: [{ type: "text", text: `Base game not found at ${config.gamePath}.` }],
          isError: true,
        };
      }

      const sourceFile = findLooseFile(gameDataPath, bareAncestorPath);
      if (!sourceFile) {
        return {
          content: [
            {
              type: "text",
              text: `Source file not found in game data: ${bareAncestorPath}\nSearched under: ${gameDataPath}`,
            },
          ],
          isError: true,
        };
      }

      try {
        const content = readFileSync(sourceFile, "utf-8");
        mkdirSync(dirname(absDestPath), { recursive: true });
        writeFileSync(absDestPath, content, "utf-8");
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [{ type: "text", text: `Failed to copy file: ${msg}` }],
          isError: true,
        };
      }

      // Step 3: Register the file with Workbench → assigns new GUID via .meta
      if (!existsSync(absDestPath + ".meta")) {
        const regResp = await client.call<{ status: string; message?: string }>(
          "EMCP_WB_Resources",
          { action: "register", path: absDestPath, buildRuntime: false },
          { timeout: 30000 },
        );

        if (regResp.status !== "ok") {
          return {
            content: [
              {
                type: "text",
                text:
                  `Prefab saved but registration failed: ${regResp.message ?? JSON.stringify(regResp)}\n` +
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

      // Step 5: Read the entity's current transform BEFORE touching the scene.
      // If the position cannot be read, ABORT here — never create a copy at the
      // origin and never delete the original on a guess.
      const transform = await readEntityTransform(client, entityName);
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
                  `- Could not read the world position of "${entityName}" (getWorldTransform/getProperty both failed).`,
                  `- Original entity "${entityName}" was NOT deleted and no copy was placed.`,
                  `- Place manually with wb_entity_create using the reference above, then delete the original.`,
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

      // Verify the copy landed where the original is. Only then is it safe to
      // delete the original. The handler echoes the parsed position back.
      const placedAt = typeof createResp.position === "string" ? createResp.position : null;
      if (!placedAt || !positionsMatch(placedAt, position)) {
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
                  `- Handler reported: ${placedAt ?? "(no position in response)"}`,
                  `- New entity placed as: ${newName}`,
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
 * Read an entity's world position (+ rotation when available).
 *
 * Primary: ModifyEntity getWorldTransform → properties[{name:"position"|"rotation", value}].
 * Fallback: ModifyEntity getProperty coords → the value comes back in `message`
 * (the handler has no `value` key — that misread was H1).
 * Returns null when no valid position could be read; callers must abort.
 */
export async function readEntityTransform(
  client: WorkbenchClient,
  entityName: string,
): Promise<{ position: string; rotation?: string } | null> {
  try {
    const tr = await client.call<Record<string, unknown>>("EMCP_WB_ModifyEntity", {
      action: "getWorldTransform",
      name: entityName,
    });
    if (!isHandlerError(tr) && Array.isArray(tr.properties)) {
      const props = tr.properties as Record<string, unknown>[];
      const pos = props.find((p) => p.name === "position");
      const rot = props.find((p) => p.name === "rotation");
      const posVal = typeof pos?.value === "string" ? pos.value.trim() : "";
      if (parseVec3(posVal)) {
        const rotVal = typeof rot?.value === "string" ? rot.value.trim() : "";
        return parseVec3(rotVal) ? { position: posVal, rotation: rotVal } : { position: posVal };
      }
    }
  } catch {
    // fall through to getProperty
  }

  try {
    const gp = await client.call<Record<string, unknown>>("EMCP_WB_ModifyEntity", {
      action: "getProperty",
      name: entityName,
      propertyKey: "coords",
    });
    if (!isHandlerError(gp) && typeof gp.message === "string") {
      const val = gp.message.trim();
      if (parseVec3(val)) return { position: val };
    }
  } catch {
    // no position available
  }
  return null;
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
