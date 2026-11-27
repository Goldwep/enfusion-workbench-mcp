import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Config } from "../config.js";
import type { WorkbenchClient } from "../workbench/client.js";
import { resolveAddonRoot } from "../utils/addon-root.js";
import { validateProjectPath } from "../utils/safe-path.js";
import { registerProjectFile } from "./wb-resources.js";
import { runPrefabs } from "./wb-prefabs.js";
import { requireEditMode, formatConnectionStatus } from "../workbench/status.js";
import { modeGateResponse } from "../workbench/response.js";

/**
 * wb_entity_duplicate — save a placed entity as a new prefab of the mod and, by default, put an
 * instance of it where the original is.
 *
 * Workflow (open-findings lta-05 and lta-08, Option 1 each):
 *   1. EMCP_WB_Prefabs createTemplate (confirm true): the engine writes the placed entity, its
 *      instance overrides included, to the new .et, whatever its ancestor (game, project or
 *      dependency). Read back: the answer is not a dry run and the file is on disk. Whether the
 *      engine's template inherits from the ancestor or flattens it is not verified.
 *   2. The new GUID: the answer's resourceName, else the .meta (registered through
 *      EMCP_WB_Resources when the engine left none).
 *   3. replaceInScene: EMCP_WB_Entity get of the original (world coords, angles, parent, layer,
 *      sub-scene); a child is refused. EMCP_WB_Entity create of the new prefab on the original's
 *      layer as `<name>_copy`, read back by its id (position, top level, same layer and
 *      sub-scene), EMCP_WB_Entity delete of the original, then rename of the copy to the
 *      original's name. Every failure after the first world edit says what stands.
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
        "Save a placed entity, its instance overrides included, as a new .et in the open project " +
        "(Workbench createTemplate: any prefab source; whether the result inherits from the ancestor " +
        "or is flattened is unverified), then by default replace the original with an instance of it " +
        "on the same layer under the same name. A child entity is refused.",
      inputSchema: {
        entityName: z.string().describe("entity placed in the scene"),
        destPath: z.string().describe("new addon-relative .et; the open project's"),
        modName: z.string().optional().describe("addon folder; default the first found"),
        replaceInScene: z.boolean().default(true).describe("false: write the prefab file and skip the replace; the placed entity may still become an instance of it"),
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
      const relDest = destPath.replace(/\\/g, "/");
      const absDestPath = validateProjectPath(addonDir, relDest);
      if (existsSync(absDestPath)) {
        return {
          content: [{ type: "text", text: `Destination already exists: ${absDestPath}` }],
          isError: true,
        };
      }

      // createTemplate writes under the OPEN project (EMCP_WB_Guard.NewTargetInProject), not under
      // the addon modName resolved: refuse when Workbench says that addon is not loaded, or the
      // file would land in another project while this tool looks for it here.
      const gproj = addonGproj(addonDir);
      if (gproj) {
        const open = await client.openProjectMatch(gproj);
        if (open.match === "other") {
          return fail([
            "**Prefab not saved — scene not modified**",
            `- The addon at ${addonDir} is not a project Workbench has loaded (loaded: ${open.reported}).`,
            "- createTemplate writes into the open project: omit modName or name the open project's addon.",
          ]);
        }
      }

      // Step 1: the engine writes the placed entity to the new .et (createTemplate). The handler
      // refuses a folder that does not exist (NewTargetInProject), so it is made first.
      mkdirSync(dirname(absDestPath), { recursive: true });
      const tpl = await runPrefabs(client, {
        action: "createTemplate",
        entity: `name:${entityName}`,
        path: relDest,
        confirm: true,
      });
      const onDisk = existsSync(absDestPath);
      if (!tpl.ok) {
        return fail([
          "**Prefab not saved — scene not modified by this tool**",
          `- createTemplate of "${entityName}": ${tpl.code}: ${tpl.message}`,
          `- Next: ${tpl.next}`,
          `- File on disk: ${onDisk ? absDestPath : "none"}`,
        ]);
      }
      const tplRead = (tpl.readback ?? {}) as Record<string, unknown>;
      if (tplRead.dryRun === true || !onDisk) {
        return fail([
          "**Prefab not saved — createTemplate answered ok but the file is not on disk**",
          `- Expected: ${absDestPath}`,
          `- createTemplate writes into the open project; if that is not ${addonDir}, look for ${relDest} there.`,
          `- Handler: ${str(tplRead.message) || "(no message)"}`,
          `- Original entity "${entityName}" was left in place; the handler may have made it an instance of the new prefab (wb_undo_redo undoes that step).`,
        ]);
      }

      // Step 2: the new GUID: the answer's resourceName, else the .meta (registered when absent).
      let resourceName = GUID_NAME.test(str(tplRead.resourceName)) ? str(tplRead.resourceName) : "";
      if (!resourceName && !existsSync(absDestPath + ".meta")) {
        // EMCP_WB_Resources register (W2): project-relative path, written only with confirm.
        const reg = await registerProjectFile(client, addonDir, absDestPath);
        if (!reg.ok) {
          return fail([
            `Prefab saved but registration failed: ${reg.message}`,
            `File at: ${absDestPath}`,
            "Register manually in Workbench Resource Browser.",
          ]);
        }
        if (GUID_NAME.test(reg.resourceName)) resourceName = reg.resourceName;
      }
      const metaGuid = resourceName ? null : readMetaGuid(absDestPath + ".meta");
      const newGuid = resourceName ? resourceName.slice(1, 17) : metaGuid;
      const prefabRef = resourceName || (newGuid ? `{${newGuid}}${relDest}` : "");
      const saved = [
        `- Saved to: ${absDestPath}`,
        `- GUID: ${newGuid ?? "(read .meta manually)"}`,
        `- Reference: ${prefabRef || relDest}`,
      ];

      if (!replaceInScene) {
        return {
          content: [
            {
              type: "text",
              text: [
                "**Prefab saved successfully**",
                `- Entity: ${entityName}`,
                ...saved,
                "- The handler makes the placed entity an instance of the new prefab (one undo step, wb_undo_redo).",
                "- Unverified: whether the .et inherits from the entity's ancestor or holds a flattened copy.",
              ].join("\n"),
            },
          ],
        };
      }
      if (!prefabRef) {
        return fail([
          "**Prefab saved, but scene was NOT modified**",
          ...saved,
          "- No resource name or GUID was found for the new file, so no instance of it can be placed.",
        ]);
      }

      // Step 3: read the original's world transform, parent and layer BEFORE touching the scene.
      // If it cannot be read, ABORT: never place at the origin, never delete on a guess.
      const orig = await readEntityPlacement(client, `name:${entityName}`);
      if (!orig) {
        return fail([
          "**Prefab saved, but scene was NOT modified**",
          ...saved,
          `- Could not read the world position of "${entityName}" (EMCP_WB_Entity get failed).`,
          `- Original entity "${entityName}" was NOT deleted and no copy was placed.`,
          "- Place manually with wb_entity create using the reference above, then delete the original.",
        ]);
      }
      if (orig.parentId || orig.parentName) {
        // The parent-local coordinate rule of create with parent is not checked live yet.
        return fail([
          "**Prefab saved, but scene was NOT modified**",
          ...saved,
          `- "${entityName}" is a child of ${orig.parentName || orig.parentId}; a child is not replaced, so no copy was placed and the original was NOT deleted.`,
          "- Place the reference under the same parent with wb_entity create (parent), then delete the original.",
        ]);
      }
      const { position, rotation } = orig;

      // Step 4: place the copy FIRST (create before delete), on the original's layer.
      const tempName = entityName + "_copy";
      // An entity of that name from an earlier run would be read back as this run's copy.
      if (await readEntityPlacement(client, `name:${tempName}`)) {
        return fail([
          "**Prefab saved, but scene was NOT modified**",
          ...saved,
          `- An entity named "${tempName}" already stands in the world; the copy would take that name.`,
          `- Original entity "${entityName}" was NOT deleted and no copy was placed. Rename or delete "${tempName}", then place the reference (wb_entity create).`,
        ]);
      }
      const created = await mutate(() =>
        client.call<Record<string, unknown>>(
          "EMCP_WB_Entity",
          {
            action: "create",
            prefab: prefabRef,
            name: tempName,
            coords: position,
            ...(rotation ? { angles: rotation } : {}),
            ...(orig.layer ? { layer: orig.layer } : {}),
          },
          MUTATE,
        ),
      );
      if (!created.ok) {
        if (created.thrown) {
          // The call failed in transit: ask the world whether the copy stands.
          const maybe = await readEntityPlacement(client, `name:${tempName}`);
          return fail([
            maybe
              ? "**Copy placed (the create call failed in transit) — original NOT deleted**"
              : "**Prefab saved; no copy found after the create call failed — original NOT deleted**",
            ...saved,
            `- Create call failed: ${created.message}`,
            maybe
              ? `- New entity placed as: ${tempName} at ${maybe.position} on layer "${maybe.layer}"; do not place the reference again.`
              : `- No entity named "${tempName}" could be read back; check the world (wb_entity list) before placing the reference again.`,
            `- Original entity "${entityName}" was left in place.`,
          ]);
        }
        const standing = copyStands(created.resp);
        if (standing) {
          // The copy stands but not as requested (live-tools-a-04): say where, never advise
          // placing a second one.
          return fail([
            "**Copy placed, but not under the requested name — original NOT deleted**",
            ...saved,
            `- Requested name: ${tempName}`,
            `- New entity placed as: ${str(created.resp.name) || "(name not reported)"} (${standing})`,
            `- Handler: ${created.message}`,
            `- Original entity "${entityName}" was left in place. Check the copy in Workbench, then delete or rename one; do not place the reference again.`,
          ]);
        }
        return fail([
          "**Prefab saved but placement failed**",
          ...saved,
          `- Place error: ${created.message}`,
          `- Original entity "${entityName}" was NOT deleted.`,
          `- Place manually using: ${prefabRef}`,
        ]);
      }
      const copyId = str(created.resp.id);
      const copyName = str(created.resp.name) || tempName;
      const copyRef = copyId || `name:${copyName}`;

      // Read the copy back (its world origin, parent, layer, sub-scene), never the create answer.
      const placed = await readEntityPlacement(client, copyRef);
      const mismatch = !placed
        ? "the copy could not be read back"
        : placed.parentId || placed.parentName
          ? `the copy is under ${placed.parentName || placed.parentId}`
          : !positionsMatch(placed.position, position)
            ? `the copy is at ${placed.position}`
            : placed.layer !== orig.layer || placed.subScene !== orig.subScene
              ? `the copy is on layer "${placed.layer}" (sub-scene ${placed.subScene}), the original on "${orig.layer}" (sub-scene ${orig.subScene})`
              : "";
      if (mismatch) {
        return fail([
          "**Copy placed but not verified — original NOT deleted**",
          ...saved,
          `- Requested: ${position} on layer "${orig.layer}"`,
          `- Read back: ${mismatch}`,
          `- New entity placed as: ${copyName} (${copyRef})`,
          `- Original entity "${entityName}" was left in place. Verify in Workbench, then delete one manually.`,
        ]);
      }

      // Step 5: delete the original (only after the copy is verified).
      const del = await mutate(() =>
        client.call<Record<string, unknown>>(
          "EMCP_WB_Entity",
          { action: "delete", entities: [`name:${entityName}`] },
          MUTATE,
        ),
      );
      if (!del.ok) {
        // Ask the world whether the original is still there: the answer says what stands.
        const still = await readEntityPlacement(client, `name:${entityName}`);
        return fail([
          still
            ? "**Copy placed but the original could not be deleted — both stand**"
            : "**Copy placed; the delete answered an error and the original no longer reads back**",
          ...saved,
          `- New entity placed as: ${copyName} (${copyRef}) on layer "${orig.layer}"`,
          `- Delete error: ${del.message}`,
          still
            ? `- Delete "${entityName}" in Workbench, then rename "${copyName}" to "${entityName}".`
            : `- Check the world, then rename "${copyName}" to "${entityName}" (wb_entity rename).`,
        ]);
      }

      // Step 6: the copy takes the original's name.
      const ren = await mutate(() =>
        client.call<Record<string, unknown>>(
          "EMCP_WB_Entity",
          { action: "rename", entity: copyRef, name: entityName },
          MUTATE,
        ),
      );
      if (!ren.ok) {
        return fail([
          "**Original deleted and copy placed, but the copy keeps its temporary name**",
          ...saved,
          `- Original "${entityName}": deleted`,
          `- Copy: ${copyName} (${copyRef}) at ${position} on layer "${orig.layer}"`,
          `- Rename error: ${ren.message}`,
          `- Rename "${copyName}" to "${entityName}" (wb_entity rename); do not place the reference again.`,
        ]);
      }

      return {
        content: [
          {
            type: "text" as const,
            text:
              [
                "**Entity duplicated successfully**",
                `- Original: ${entityName} -> deleted`,
                ...saved,
                `- Placed as: ${entityName} (${copyRef}) at ${position}${rotation ? ` (rotation ${rotation})` : ""} on layer "${orig.layer}"`,
                "",
                "The entity now references your mod's prefab. Unverified: whether that .et inherits from the original ancestor or holds a flattened copy.",
              ].join("\n") + formatConnectionStatus(client),
          },
        ],
      };

      function fail(lines: string[]) {
        return {
          content: [{ type: "text" as const, text: lines.join("\n") + formatConnectionStatus(client) }],
          isError: true,
        };
      }
    },
  );
}

/** The addon's .gproj file, or null when its folder cannot be read or holds none. */
function addonGproj(addonDir: string): string | null {
  try {
    const name = readdirSync(addonDir).find((n) => n.toLowerCase().endsWith(".gproj"));
    return name ? join(addonDir, name) : null;
  } catch {
    return null;
  }
}

const GUID_NAME = /^\{[0-9A-Fa-f]{16}\}/;
/** A mutating W1 call can take a while on the NET thread. */
const MUTATE = { access: "mutate", timeout: 30_000 } as const;

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * One mutating EMCP_WB_Entity call (the call is written at each site, so its action stays a
 * literal the census reads). ok only on status ok; `thrown` when the call itself failed (lost,
 * timed out), so the caller cannot know what the handler did.
 */
async function mutate(
  send: () => Promise<Record<string, unknown>>,
): Promise<
  | { ok: true; resp: Record<string, unknown> }
  | { ok: false; thrown: boolean; message: string; resp: Record<string, unknown> }
> {
  try {
    const resp = await send();
    if (resp.status === "ok") return { ok: true, resp };
    const code = str(resp.code);
    const text = str(resp.message) || `EMCP_WB_Entity answered ${str(resp.status) || "no status"}`;
    return { ok: false, thrown: false, message: code ? `${code}: ${text}` : text, resp };
  } catch (e) {
    return { ok: false, thrown: true, message: e instanceof Error ? e.message : String(e), resp: {} };
  }
}

/**
 * The entity reference of a copy that stands although EMCP_WB_Entity create answered an error
 * (live-tools-a-04 on the W1 handler): the handler sets `id` only once CreateEntity returned a
 * source, e.g. when the rename to the requested name failed. "" when nothing was created.
 */
export function copyStands(resp: Record<string, unknown>): string {
  return str(resp.id);
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
 * Read an entity's world position, rotation, parent, layer and sub-scene through EMCP_WB_Entity
 * get (W1): `coords` and `angles` are the runtime entity's GetOrigin and GetAngles (world space),
 * `parentId` is empty for a top-level entity, `layer` is the layer path create takes. `ref` is an
 * entity reference (id:, name: or index:). Returns null when no valid position could be read;
 * callers must abort.
 */
export async function readEntityPlacement(
  client: WorkbenchClient,
  ref: string,
): Promise<{
  position: string;
  rotation?: string;
  parentId: string;
  parentName: string;
  layer: string;
  subScene: number;
} | null> {
  try {
    const r = await client.call<Record<string, unknown>>(
      "EMCP_WB_Entity",
      { action: "get", entity: ref },
      { access: "read" },
    );
    if (r.status !== "ok") return null;
    const pos = typeof r.coords === "string" ? r.coords.trim() : "";
    if (!parseVec3(pos)) return null;
    const rot = typeof r.angles === "string" ? r.angles.trim() : "";
    return {
      position: pos,
      ...(parseVec3(rot) ? { rotation: rot } : {}),
      parentId: str(r.parentId),
      parentName: str(r.parentName),
      layer: str(r.layer),
      subScene: Number(r.subScene ?? 0),
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
