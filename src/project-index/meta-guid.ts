/**
 * Resource GUIDs from `.meta` sidecars.
 *
 * Workbench registers every addon resource with a `<file>.meta` sidecar whose
 * top-level `Name "{GUID}path"` line carries the resource GUID that
 * `{GUID}path` references use:
 *
 *   MetaFileClass {
 *    Name "{5A2220DD0C16958B}Prefabs/MP/Spawning/SpawnPoint_US.et"
 *    Configurations { ... }
 *   }
 *
 * The resource file itself does not hold that GUID: an `.et` root `ID` is the
 * entity id (prefabs inheriting one base share it), and a `.conf` / `.layout`
 * root node id is an object id. Checked against the game data (packed
 * Character_US_Rifleman.et has `ID "52092032B0E62200"` while its references
 * use `{26A9756790131354}`) and against addon files on disk (no `.et` `ID`
 * and no root node id equals its `.meta` Name GUID). Packed game data ships
 * no `.meta` files at all. `.gproj` files have no sidecar; their GUID is the
 * `GUID` property.
 */

import { readFileSync, statSync } from "node:fs";

/** Top-level `Name "{GUID}..."` line of a `.meta` sidecar. */
export const META_NAME_RE = /^[ \t]*Name[ \t]+"\{([0-9A-Fa-f]{16})\}/m;

/** Sidecars larger than this are not read (a real .meta is a few KB). */
const MAX_META_BYTES = 4 * 1024 * 1024;

/** The uppercase GUID on a `.meta` sidecar's Name line, or null. */
export function extractMetaGuid(content: string): string | null {
  const m = META_NAME_RE.exec(content);
  return m ? m[1].toUpperCase() : null;
}

/** Read `metaAbs` and return its Name GUID; null when missing, oversized or nameless. */
export function readMetaGuid(metaAbs: string): string | null {
  try {
    if (statSync(metaAbs).size > MAX_META_BYTES) return null;
    return extractMetaGuid(readFileSync(metaAbs, "utf-8"));
  } catch {
    return null;
  }
}
