/**
 * `server_scenario_picker` core — enumerate available mission scenarios so
 * the user knows what scenarioId values they can plug into a server.json
 * (or `server_launch`).
 *
 * Two sources of scenarios:
 *
 *   1. **Official BI** — the 31-ish scenarios shipped in the game's core
 *      data.pak (e.g. Conflict Arland, Game Master Everon, Combat Ops, the
 *      tutorials). These live inside core .pak archives that this MCP
 *      doesn't unpack, so v1 ships a curated catalog of the known stable
 *      ones with their canonical scenarioId form. Future enhancement: read
 *      from the project-index when the .pak indexer lands.
 *
 *   2. **User project** — scan the project's addon roots for `*.conf` files
 *      under `Missions/` that declare any `SCR_MissionHeader*` root class.
 *      We parse with the enfusion-text parser (the same parser used by
 *      `scenario_inspect`) so the detection is robust to formatting.
 *
 * The probing comment in the brief noted that `SCR_MissionHeader` is the
 * canonical base class and `SCR_MissionHeaderCampaign` /
 * `SCR_MissionHeaderConflict` / `SCR_MissionHeaderCombatOps` are
 * subclasses. We accept any class name starting with `SCR_MissionHeader`
 * plus the bare `MissionHeader` engine class (rare but legal).
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { ProjectIndex } from "../project-index/project-index.js";
import { parse } from "../formats/enfusion-text.js";
import type { Config } from "../config.js";
import { readTextFileBounded } from "../utils/safe-read.js";

/**
 * Class-name predicate. Matches `SCR_MissionHeader`,
 * `SCR_MissionHeaderCampaign`, `SCR_MissionHeaderConflict`,
 * `SCR_MissionHeaderCombatOps`, `SCR_MissionHeaderGM`, etc., plus the bare
 * engine-side `MissionHeader`.
 */
export function isMissionHeaderClass(rootType: string): boolean {
  if (rootType === "MissionHeader") return true;
  return /^SCR_MissionHeader/.test(rootType);
}

/** Curated catalog of well-known BI scenarios. */
export interface OfficialScenario {
  /** Display name. */
  name: string;
  /** Map / world (best-effort). */
  map: string;
  /** Canonical `scenarioId` (braced GUID + path form). Source: probed from the installed game's `resourceDatabase.rdb`. */
  scenarioId: string;
}

/**
 * Curated official-scenario catalog.
 *
 * Verification source: the game's own `resourceDatabase.rdb` at
 * `addons/data/resourceDatabase.rdb` in the Arma Reforger install. The
 * RDB is the canonical content-id lookup the engine itself uses, so
 * GUID/path pairs read from it are guaranteed correct against the
 * installed build.
 *
 * Verified: 2026-05-21 against Arma Reforger (Steam install).
 *
 * The RDB probe surfaced 38 mission `.conf` entries. Entries below are
 * the ones whose game mode + map are unambiguous from the BI naming
 * convention. Intentionally skipped:
 *   - Singleplayer cutscenes (`SP01_`, `SP02_`)
 *   - Story scenarios (`Scenario0*_*`)
 *   - Capture & Hold minigames (`CAH_*`) — rarely run as dedicated-server picks
 *   - Internal test missions (`MpTest/*`, `ConflictWithoutAIs`)
 *   - `23_Campaign_HQC_*` (High Command Co-Op subset) — variant tier kept out of the v1 picker
 *
 * IMPORTANT: only entries verified against a probed RDB belong here.
 * We'd rather under-list than ship a wrong GUID that a user pastes into
 * a config and then can't start their server. Future enhancement: when
 * the .pak indexer lands, populate this list from the installed RDB at
 * runtime so it stays in sync with patches automatically.
 */
export const OFFICIAL_SCENARIOS: OfficialScenario[] = [
  // Conflict — the multiplayer flagship. Filename prefix `23_Campaign_`
  // is the Conflict mode; the suffix names the sub-map.
  {
    name: "Conflict — Northern Everon",
    map: "Everon",
    scenarioId: "{C700DB41F0C546E1}Missions/23_Campaign_NorthCentral.conf",
  },
  {
    name: "Conflict — Montignac",
    map: "Everon",
    scenarioId: "{FDE33AFE2ED7875B}Missions/23_Campaign_Montignac.conf",
  },
  {
    name: "Conflict — Southwest Coast (Everon)",
    map: "Everon",
    scenarioId: "{28802845ADA64D52}Missions/23_Campaign_SWCoast.conf",
  },
  {
    name: "Conflict — Western Everon",
    map: "Western Everon",
    scenarioId: "{94992A3D7CE4FF8A}Missions/23_Campaign_Western.conf",
  },
  {
    name: "Conflict — Arland",
    map: "Arland",
    scenarioId: "{C41618FD18E9D714}Missions/23_Campaign_Arland.conf",
  },
  {
    name: "Conflict — Cain (Western Everon)",
    map: "Western Everon",
    scenarioId: "{9C6054B42A044DEC}Missions/23_Campaign_Cain.conf",
  },
  // Game Master — sandbox / Zeus-like. One mission per map.
  {
    name: "Game Master — Everon",
    map: "Everon",
    scenarioId: "{59AD59368755F41A}Missions/21_GM_Eden.conf",
  },
  {
    name: "Game Master — Arland",
    map: "Arland",
    scenarioId: "{2BBBE828037C6F4B}Missions/22_GM_Arland.conf",
  },
  {
    name: "Game Master — Western Everon",
    map: "Western Everon",
    scenarioId: "{F45C6C15D31252E6}Missions/27_GM_Cain.conf",
  },
  // Combat Ops — squad PvE objectives. One mission per map.
  {
    name: "Combat Ops — Arland",
    map: "Arland",
    scenarioId: "{DAA03C6E6099D50F}Missions/24_CombatOps.conf",
  },
  {
    name: "Combat Ops — Everon",
    map: "Everon",
    scenarioId: "{DFAC5FABD11F2390}Missions/26_CombatOpsEveron.conf",
  },
  {
    name: "Combat Ops — Cain (Western Everon)",
    map: "Western Everon",
    scenarioId: "{CB347F2F10065C9C}Missions/CombatOpsCain.conf",
  },
  // Tutorial — singleplayer onboarding (rarely run on a dedicated server
  // but listed for completeness; the GUID is the one a server config
  // would reference if someone really wanted to).
  {
    name: "Tutorial",
    map: "Everon",
    scenarioId: "{002AF7323E0129AF}Missions/Tutorial.conf",
  },
];

/** One scanned user-project scenario. */
export interface UserScenario {
  /** Absolute path on disk. */
  absolutePath: string;
  /** Project-root-relative path, when known. */
  relativePath: string;
  /** Root class name from the parsed .conf file. */
  rootType: string;
  /** Mission name from `m_sName`, when present. */
  name: string | null;
  /** World file from `m_sWorldFile`, when present. */
  worldFile: string | null;
}

/**
 * Walk a directory looking for `*.conf` files in any `Missions` subtree.
 * Returns paths only — parsing happens in `parseUserScenario`.
 *
 * The walk is depth-bounded so a malformed symlink loop can't hang the
 * tool. 8 levels deep covers anything realistic in an addon layout.
 */
export function findMissionConfFiles(root: string, maxDepth: number = 8): string[] {
  const results: string[] = [];
  if (!existsSync(root)) return results;
  walk(root, 0);
  return results;

  function walk(dir: string, depth: number): void {
    if (depth > maxDepth) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(full, depth + 1);
      } else if (
        st.isFile() &&
        entry.toLowerCase().endsWith(".conf") &&
        // Heuristic: only mission .conf files that live inside a `Missions/` dir
        // (case-insensitive). Avoids false positives like Configs/Vehicles/Foo.conf.
        /[\\/](Missions)[\\/]/i.test(full)
      ) {
        results.push(full);
      }
    }
  }
}

/**
 * Parse a mission .conf file. Returns null if the file is not a mission
 * header (wrong root class) or if parsing fails.
 */
export function parseUserScenario(
  absolutePath: string,
  projectRoot: string | null,
): UserScenario | null {
  let text: string;
  try {
    text = readTextFileBounded(absolutePath);
  } catch {
    return null;
  }

  let root;
  try {
    root = parse(text);
  } catch {
    return null;
  }

  if (!isMissionHeaderClass(root.type)) {
    return null;
  }

  let name: string | null = null;
  let worldFile: string | null = null;
  for (const prop of root.properties) {
    if (prop.key === "m_sName" && typeof prop.value === "string") {
      name = prop.value;
    } else if (prop.key === "m_sWorldFile" && typeof prop.value === "string") {
      worldFile = prop.value;
    }
  }

  const relativePath = projectRoot
    ? relative(projectRoot, absolutePath).replace(/\\/g, "/")
    : absolutePath;

  return {
    absolutePath,
    relativePath,
    rootType: root.type,
    name,
    worldFile,
  };
}

/**
 * Format the scenario picker output as a markdown report.
 */
export function formatScenarioPicker(input: {
  official: OfficialScenario[];
  user: UserScenario[];
  workshop: UserScenario[];
  includeWorkshop: boolean;
}): string {
  const lines: string[] = [];
  lines.push("## Scenarios");
  lines.push("");

  lines.push(`### Official BI (${input.official.length})`);
  lines.push("");
  lines.push("| Name | Map | scenarioId |");
  lines.push("|---|---|---|");
  for (const s of input.official) {
    lines.push(`| ${escape(s.name)} | ${escape(s.map)} | \`${s.scenarioId}\` |`);
  }
  lines.push("");
  lines.push(
    "_Catalog is curated; if a recent BI scenario is missing, file an issue with its GUID._",
  );
  lines.push("");

  lines.push(`### User project (${input.user.length})`);
  lines.push("");
  if (input.user.length === 0) {
    lines.push("_(no `SCR_MissionHeader*` .conf files found under Missions/)_");
  } else {
    lines.push("| Name | World | Root class | Path |");
    lines.push("|---|---|---|---|");
    for (const s of input.user) {
      lines.push(
        `| ${escape(s.name ?? "(unnamed)")} | ${escape(s.worldFile ?? "")} | \`${escape(s.rootType)}\` | \`${escape(s.relativePath)}\` |`,
      );
    }
  }
  lines.push("");

  if (input.includeWorkshop) {
    lines.push(`### Workshop (${input.workshop.length})`);
    lines.push("");
    if (input.workshop.length === 0) {
      lines.push("_(no workshop scenarios found — workshop path may be unset)_");
    } else {
      lines.push("| Name | World | Root class | Path |");
      lines.push("|---|---|---|---|");
      for (const s of input.workshop) {
        lines.push(
          `| ${escape(s.name ?? "(unnamed)")} | ${escape(s.worldFile ?? "")} | \`${escape(s.rootType)}\` | \`${escape(s.relativePath)}\` |`,
        );
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

function escape(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/`/g, "\\`");
}

/**
 * End-to-end builder used by the MCP wrapper. ProjectIndex is currently
 * accepted for forward-compat (when .pak indexing lands we'll pivot
 * Official to come from the index too), but isn't yet consulted —
 * official scenarios come from the curated catalog and user scenarios
 * come from a filesystem walk.
 */
export function buildScenarioPickerReport(
  config: Config,
  _index: ProjectIndex,
  options: { includeWorkshop: boolean },
): string {
  const user: UserScenario[] = [];
  if (existsSync(config.projectPath)) {
    for (const file of findMissionConfFiles(config.projectPath)) {
      const parsed = parseUserScenario(file, config.projectPath);
      if (parsed) user.push(parsed);
    }
  }

  const workshop: UserScenario[] = [];
  if (options.includeWorkshop && config.workshopPath && existsSync(config.workshopPath)) {
    for (const file of findMissionConfFiles(config.workshopPath)) {
      const parsed = parseUserScenario(file, config.workshopPath);
      if (parsed) workshop.push(parsed);
    }
  }

  // Stable order: name ascending, fallback to relativePath.
  const sortFn = (a: UserScenario, b: UserScenario): number => {
    const an = (a.name ?? a.relativePath).toLowerCase();
    const bn = (b.name ?? b.relativePath).toLowerCase();
    return an < bn ? -1 : an > bn ? 1 : 0;
  };
  user.sort(sortFn);
  workshop.sort(sortFn);

  return formatScenarioPicker({
    official: OFFICIAL_SCENARIOS,
    user,
    workshop,
    includeWorkshop: options.includeWorkshop,
  });
}
