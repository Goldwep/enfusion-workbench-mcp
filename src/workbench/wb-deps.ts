/**
 * Workbench-visible dependency resolution for .gproj Dependencies.
 *
 * Workbench resolves a project's dependency GUIDs against the addon
 * locations IT scans: the Workbench addons dir (`My Games\
 * ArmaReforgerWorkbench\addons`), the folders next to the project being
 * opened, and the base game + Tools installs. It does NOT search the
 * game's workshop download folder (`My Games\ArmaReforger\addons`) — a
 * dep that exists only there pops the launcher's "Missing Addon
 * Dependencies" modal even though the game itself runs the mod fine
 * (live-diagnosed 2026-08-31: CSI 5B0D1E4380971EBD). The fix is to copy
 * the downloaded addon folder into the Workbench addons dir as-is —
 * addon.gproj + data.pak + resourceDatabase.rdb work packed.
 *
 * This module reproduces that resolution so tools can classify each dep
 * as `wb-visible`, `workshop-only` (game has it, Workbench can't see
 * it), or `missing` — and name the copy remedy instead of leaving a
 * bare timeout or conflating "indexed somewhere" with "loadable".
 * Base-game/core GUIDs (e.g. ArmaReforger 58D0FB3206B6F859) resolve via
 * the install scan instead of surfacing as unresolved noise.
 *
 * Launcher-registered projects (arbitrary paths added via the launcher
 * UI, or by editing the list directly) live in the Workbench profile's
 * `.projectList_app*_user*.conf` files — scanned here too, closing the
 * blind spot that made a purely folder-based scan miss deps Workbench
 * could in fact resolve (live-proven 2026-08-31: 29thVoiceSystems
 * 481849A4E0D88BEA resolved via a registered GitHub clone). The scan is
 * still advisory: treat "not visible" as a warning, not proof.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { parse } from "../formats/enfusion-text.js";

const GUID_RE = /^[0-9A-Fa-f]{16}$/;
/** Root-level `GUID "16hex"` property — first match is the project GUID
 *  (nested container refs use the braced `"{16hex}path"` form instead). */
const ROOT_GUID_RE = /^\s*GUID\s+"([0-9A-Fa-f]{16})"/m;

/** Extract bare dep GUIDs from a .gproj Dependencies block. */
export function extractGprojDeps(gprojContent: string): string[] {
  const root = parse(gprojContent);
  const deps = root.children.find((c) => c.type === "Dependencies");
  if (!deps) return [];
  return deps.values.filter((v) => GUID_RE.test(v)).map((v) => v.toUpperCase());
}

/** Read a .gproj's own project GUID (cheap regex — no full parse). */
export function readRootGuid(gprojContent: string): string | null {
  const m = ROOT_GUID_RE.exec(gprojContent);
  return m ? m[1].toUpperCase() : null;
}

export interface ScannedAddon {
  guid: string;
  dirPath: string;
  gprojPath: string;
}

/**
 * Scan the immediate subdirectories of an addon root for .gproj files
 * and return each addon's GUID. Unreadable/GUID-less entries are
 * skipped; a missing root yields an empty list.
 */
export function scanAddonRoot(root: string): ScannedAddon[] {
  const out: ScannedAddon[] = [];
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const dirPath = join(root, entry);
    let files: string[];
    try {
      files = readdirSync(dirPath);
    } catch {
      continue; // not a directory, or unreadable
    }
    const gprojs = files.filter((f) => f.toLowerCase().endsWith(".gproj"));
    if (gprojs.length === 0) continue;
    // Convention is one addon.gproj per addon dir; prefer it when several exist.
    const pick = gprojs.find((f) => f.toLowerCase() === "addon.gproj") ?? gprojs.sort()[0];
    const gprojPath = join(dirPath, pick);
    try {
      const guid = readRootGuid(readFileSync(gprojPath, "utf-8"));
      if (guid) out.push({ guid, dirPath, gprojPath });
    } catch {
      continue;
    }
  }
  return out;
}

export type WbDepLocationKind =
  | "base-game"
  | "core-tools"
  | "wb-addons"
  | "project-sibling"
  | "launcher-registered";

/** Filename pattern of the launcher's registered-projects lists. */
const PROJECT_LIST_RE = /^\.projectList_app\d+_user\d+\.conf$/;

/**
 * Read the launcher's registered-project .gproj paths from every
 * `.projectList_app*_user*.conf` in the Workbench profile dir. Missing
 * dir/files or unparseable content yield an empty list.
 */
export function readRegisteredProjectPaths(profileDir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(profileDir);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of entries.filter((n) => PROJECT_LIST_RE.test(n))) {
    try {
      const content = readFileSync(join(profileDir, name), "utf-8");
      for (const m of content.matchAll(/FilePath\s+"([^"]+)"/g)) {
        out.push(m[1]);
      }
    } catch {
      continue;
    }
  }
  return out;
}

/** Resolve registered-project paths to their addon GUIDs. */
export function scanRegisteredProjects(profileDir: string): ScannedAddon[] {
  const out: ScannedAddon[] = [];
  for (const rawPath of readRegisteredProjectPaths(profileDir)) {
    const gprojPath = resolve(rawPath);
    try {
      const guid = readRootGuid(readFileSync(gprojPath, "utf-8"));
      if (guid) out.push({ guid, dirPath: dirname(gprojPath), gprojPath });
    } catch {
      continue; // registered path no longer exists — the launcher tolerates this too
    }
  }
  return out;
}

export interface WbDepFinding {
  guid: string;
  status: "wb-visible" | "workshop-only" | "missing";
  /** For wb-visible: which scanned root resolved it, and the .gproj found. */
  locationKind?: WbDepLocationKind;
  gprojPath?: string;
  /** For workshop-only: the game-download folder to copy into the WB addons dir. */
  workshopDirPath?: string;
}

export interface WbDepsCheck {
  gprojPath: string;
  wbAddonsDir: string;
  workshopDir: string | null;
  findings: WbDepFinding[];
  allWbVisible: boolean;
  scannedRoots: { kind: WbDepLocationKind; root: string; addons: number }[];
}

export interface WbDepsPaths {
  /** Workbench addons dir (config.projectPath). */
  projectPath: string;
  /** BI core addons under the Tools install (config.corePath). */
  corePath: string;
  /** Base game install root — its `addons/` subdir is scanned (config.gamePath). */
  gamePath: string;
  /** Game workshop download dir (config.workshopPath) — NOT Workbench-visible. */
  workshopPath?: string;
  /** Workbench profile dir holding `.projectList_*.conf` (launcher-registered
   *  projects). Defaults to the `profile` sibling of the addons dir. */
  profileDir?: string;
}

function samePath(a: string, b: string): boolean {
  return resolve(a).toLowerCase() === resolve(b).toLowerCase();
}

/**
 * Classify every dependency GUID of `gprojPath` the way Workbench would
 * resolve it. Throws only if the target .gproj itself can't be read.
 */
export function checkWorkbenchVisibleDeps(gprojPath: string, paths: WbDepsPaths): WbDepsCheck {
  const fullPath = resolve(gprojPath);
  const content = readFileSync(fullPath, "utf-8");
  const depGuids = extractGprojDeps(content);
  const ownGuid = readRootGuid(content);

  const roots: { kind: WbDepLocationKind; root: string }[] = [
    { kind: "base-game", root: join(paths.gamePath, "addons") },
    { kind: "core-tools", root: paths.corePath },
    { kind: "wb-addons", root: paths.projectPath },
  ];
  // Workbench also sees the folders NEXT TO the project being opened
  // (covers projects living outside the standard addons dir).
  const siblingRoot = dirname(dirname(fullPath));
  if (roots.every((r) => !samePath(r.root, siblingRoot))) {
    roots.push({ kind: "project-sibling", root: siblingRoot });
  }

  const visible = new Map<string, { kind: WbDepLocationKind; gprojPath: string }>();
  const scannedRoots: WbDepsCheck["scannedRoots"] = [];
  for (const { kind, root } of roots) {
    const addons = scanAddonRoot(root);
    scannedRoots.push({ kind, root, addons: addons.length });
    for (const a of addons) {
      if (!visible.has(a.guid)) visible.set(a.guid, { kind, gprojPath: a.gprojPath });
    }
  }

  // Launcher-registered projects (arbitrary paths in the profile's
  // .projectList_*.conf). Scanned after the physical roots so a folder hit
  // keeps its more specific label.
  const profileDir = paths.profileDir ?? join(dirname(resolve(paths.projectPath)), "profile");
  const registered = scanRegisteredProjects(profileDir);
  scannedRoots.push({ kind: "launcher-registered", root: profileDir, addons: registered.length });
  for (const a of registered) {
    if (!visible.has(a.guid)) {
      visible.set(a.guid, { kind: "launcher-registered", gprojPath: a.gprojPath });
    }
  }

  const workshop = new Map<string, string>();
  if (paths.workshopPath) {
    for (const a of scanAddonRoot(paths.workshopPath)) {
      if (!workshop.has(a.guid)) workshop.set(a.guid, a.dirPath);
    }
  }

  const findings: WbDepFinding[] = depGuids
    .filter((g) => g !== ownGuid) // a self-dep would always "resolve"
    .map((guid) => {
      const hit = visible.get(guid);
      if (hit) {
        return { guid, status: "wb-visible" as const, locationKind: hit.kind, gprojPath: hit.gprojPath };
      }
      const workshopDirPath = workshop.get(guid);
      if (workshopDirPath) {
        return { guid, status: "workshop-only" as const, workshopDirPath };
      }
      return { guid, status: "missing" as const };
    });

  return {
    gprojPath: fullPath,
    wbAddonsDir: paths.projectPath,
    workshopDir: paths.workshopPath ?? null,
    findings,
    allWbVisible: findings.every((f) => f.status === "wb-visible"),
    scannedRoots,
  };
}

const LOCATION_LABEL: Record<WbDepLocationKind, string> = {
  "base-game": "base game install (always available)",
  "core-tools": "Tools install core addons (always available)",
  "wb-addons": "Workbench addons dir",
  "project-sibling": "folder next to the target project",
  "launcher-registered": "launcher-registered project (.projectList conf)",
};

/**
 * Render a dep-visibility check as markdown lines. Shared by
 * workshop_check_deps and wb_validate_scripts' pre-flight/stuck reports.
 */
export function formatDepFindings(check: WbDepsCheck): string[] {
  const lines: string[] = [];
  if (check.findings.length === 0) {
    lines.push("(no external dependencies declared)");
    return lines;
  }
  const visible = check.findings.filter((f) => f.status === "wb-visible");
  const workshopOnly = check.findings.filter((f) => f.status === "workshop-only");
  const missing = check.findings.filter((f) => f.status === "missing");

  lines.push(
    `${check.findings.length} dependencies — ${visible.length} Workbench-visible, ` +
      `${workshopOnly.length} workshop-only, ${missing.length} missing.`,
  );
  if (visible.length > 0) {
    lines.push("");
    lines.push("### Workbench-visible");
    for (const f of visible) {
      lines.push(`- ✅ {${f.guid}} — ${LOCATION_LABEL[f.locationKind!]}: ${f.gprojPath}`);
    }
  }
  if (workshopOnly.length > 0) {
    lines.push("");
    lines.push("### Downloaded by the game but NOT visible to Workbench");
    for (const f of workshopOnly) {
      lines.push(`- 🟡 {${f.guid}} — found at: ${f.workshopDirPath}`);
    }
    lines.push("");
    lines.push(
      `Workbench does not search the game's workshop download folder. Copy each folder above into ` +
        `"${check.wbAddonsDir}" as-is (addon.gproj + data.pak + resourceDatabase.rdb work packed — no unpacking needed), then re-run.`,
    );
  }
  if (missing.length > 0) {
    lines.push("");
    lines.push("### Missing everywhere");
    for (const f of missing) {
      lines.push(`- ❌ {${f.guid}}`);
    }
    lines.push("");
    lines.push(
      check.workshopDir
        ? `Not found in the Workbench addons dir, next to the project, the base install, or the game's workshop downloads (${check.workshopDir}). ` +
            `Subscribe/download the addon in the game's Workshop first, then copy its folder into "${check.wbAddonsDir}".`
        : `Not found in the Workbench addons dir, next to the project, or the base install (no game workshop dir configured to cross-check). ` +
            `Obtain the addon and place its folder in "${check.wbAddonsDir}".`,
    );
  }
  lines.push("");
  lines.push(
    `Scanned: ${check.scannedRoots.map((r) => `${r.root} (${r.addons} addons)`).join("; ")} — ` +
      `including launcher-registered projects from the profile's .projectList conf. ` +
      `The scan is advisory: treat "not visible" as a warning, not proof Workbench will fail.`,
  );
  return lines;
}

/** Convenience: basename helper re-exported for report headers. */
export function depReportHeader(check: WbDepsCheck): string {
  return `## Dependencies of ${basename(check.gprojPath)}`;
}
