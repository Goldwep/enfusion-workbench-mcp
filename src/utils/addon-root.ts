import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";
import { findGproj } from "./game-paths.js";

/**
 * The one reading of ENFUSION_PROJECT_PATH for the tools that write into an addon (live-tools-a-01).
 *
 * src/config.ts documents `projectPath` as the addons directory (default
 * `My Games/ArmaReforgerWorkbench/addons`): each addon is a child folder that holds a .gproj. The
 * workshop and log paths are derived from it on that reading, and wb_launch and
 * wb_entity_duplicate look for `<projectPath>/<addon>/`. A projectPath that itself holds a .gproj
 * is taken as that one addon, so a setup that points the variable at the addon keeps working.
 *
 * Which addon, in order:
 *   1. projectPath holds a .gproj: projectPath.
 *   2. a name (modName, else ENFUSION_DEFAULT_MOD, which wb_launch sets to the project it opens):
 *      the child folder of that name holding a .gproj, else the one child whose .gproj declares
 *      `ID "<name>"` (a file-system prefix is the addon id, EMCP_WB_Guard.Project).
 *   3. no name: the only child addon. Several are refused unless `firstIfSeveral` (the 1.x
 *      "default the first found" of wb_entity_duplicate's modName).
 *
 * A world the editor has open names its addon in its `$Name:` prefix; `worldPrefixRefusal` refuses
 * a world of another addon (a dependency's world is never written).
 */

export interface AddonRootConfig {
  projectPath?: string;
  defaultMod?: string;
}

export interface AddonRootHint {
  /** An addon folder name or .gproj ID; default the configured default mod. */
  modName?: string;
  /** No name and several addons: take the first (sorted by folder name) instead of refusing. */
  firstIfSeveral?: boolean;
}

export type AddonRoot =
  | { ok: true; root: string }
  | { ok: false; code: "NOT_IN_PROJECT"; message: string };

const ID_RE = /\bID\s+"([^"]*)"/;
const PREFIX_RE = /^\$([A-Za-z0-9_]*):/;

function isPlainName(s: string): boolean {
  return s.length > 0 && s !== "." && s !== ".." && !/[\\/:]/.test(s);
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** The child folders of `dir` that hold a .gproj, sorted by folder name. */
export function childAddons(dir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
  return names.map((n) => join(dir, n)).filter((d) => findGproj(d) !== null);
}

/** The `ID "<id>"` an addon's .gproj declares, or null. */
export function gprojId(addonDir: string): string | null {
  const g = findGproj(addonDir);
  if (!g) return null;
  try {
    const m = ID_RE.exec(readFileSync(g, "utf-8"));
    return m ? m[1]! : null;
  } catch {
    return null;
  }
}

function refuse(message: string): AddonRoot {
  return { ok: false, code: "NOT_IN_PROJECT", message };
}

/** The addon folder the tools write in (see the file comment); never throws. */
export function resolveAddonRoot(cfg: AddonRootConfig, hint: AddonRootHint = {}): AddonRoot {
  const base = cfg.projectPath;
  if (!base || !isDir(base)) {
    return refuse("no project folder is configured (ENFUSION_PROJECT_PATH) or it does not exist");
  }
  if (findGproj(base)) return { ok: true, root: resolve(base) };

  const name = hint.modName || cfg.defaultMod;
  if (name) {
    if (!isPlainName(name)) return refuse(`'${name}' is not an addon folder name`);
    const dir = resolve(base, name);
    if (dir.startsWith(resolve(base) + sep) && findGproj(dir)) return { ok: true, root: dir };
    const byId = childAddons(base).filter((d) => gprojId(d) === name);
    if (byId.length === 1) return { ok: true, root: resolve(byId[0]!) };
    return refuse(
      `no addon '${name}' (a folder holding a .gproj, or a .gproj with ID "${name}") under the project folder (ENFUSION_PROJECT_PATH)`,
    );
  }

  const addons = childAddons(base);
  if (addons.length === 1 || (addons.length > 1 && hint.firstIfSeveral)) {
    return { ok: true, root: resolve(addons[0]!) };
  }
  if (addons.length === 0) {
    return refuse(
      "no addon (a folder holding a .gproj) under the project folder (ENFUSION_PROJECT_PATH)",
    );
  }
  return refuse(
    `${addons.length} addons under the project folder (ENFUSION_PROJECT_PATH); set ENFUSION_DEFAULT_MOD to the one to write in`,
  );
}

/**
 * Why a resource path of the open editor is not in the addon at `root`, or null when it is: its
 * `$Name:` prefix must be the addon's folder name or its .gproj ID. An unprefixed path passes.
 */
export function worldPrefixRefusal(root: string, resourcePath: string): string | null {
  const m = PREFIX_RE.exec(resourcePath);
  if (!m || !m[1]) return null;
  const name = m[1];
  const folder = basename(root);
  if (name.toLowerCase() === folder.toLowerCase()) return null;
  if (gprojId(root) === name) return null;
  return `${resourcePath} is a file of addon '${name}', not of the project addon '${folder}'`;
}
