import { createNode, serialize, setProperty } from "../formats/enfusion-text.js";

export type ConfigType = "mission-header" | "faction" | "entity-catalog" | "editor-placeables";

export interface ConfigOptions {
  /** Config template type */
  configType: ConfigType;
  /** Config name (used for filename) */
  name: string;
  /** Faction key identifier (faction) */
  factionKey?: string;
  /** Faction RGBA color string e.g. "0,100,200,255" (faction) */
  factionColor?: string;
  /** Resource path to faction flag texture (faction) */
  flagPath?: string;
  /** Path to .ent world file (mission-header) */
  worldPath?: string;
  /** Display name for the scenario (mission-header) */
  scenarioName?: string;
  /** Scenario description (mission-header) */
  scenarioDescription?: string;
  /**
   * Mission header mode (mission-header type only).
   * "Conflict" (default) → SCR_MissionHeaderCampaign with Conflict properties.
   * "SF" → SCR_MissionHeader for Scenario Framework SP/coop missions.
   */
  missionMode?: "Conflict" | "SF";
  /** Scenario author name (mission-header Conflict) */
  author?: string;
  /** Game mode display label, e.g. "Conflict", "Seize & Secure" (mission-header Conflict) */
  gameModeLabel?: string;
  /** Max player count (mission-header Conflict, default 40) */
  playerCount?: number;
  /** XP multiplier, e.g. 0.5 for PvE (mission-header Conflict, omitted if 1.0) */
  xpMultiplier?: number;
  /** List of prefab resource paths (entity-catalog, editor-placeables) */
  prefabRefs?: string[];
  /** Category name (entity-catalog, editor-placeables) */
  categoryName?: string;
}

interface ConfigTypeInfo {
  rootType: string;
  subdirectory: string;
}

const CONFIG_TYPE_INFO: Record<ConfigType, ConfigTypeInfo> = {
  "mission-header": {
    rootType: "SCR_MissionHeader",
    subdirectory: "Missions",
  },
  faction: {
    rootType: "SCR_Faction",
    subdirectory: "Configs/Factions",
  },
  "entity-catalog": {
    rootType: "SCR_EntityCatalog",
    subdirectory: "Configs/EntityCatalogs",
  },
  "editor-placeables": {
    rootType: "SCR_PlaceableEntitiesRegistry",
    subdirectory: "Configs/Editor",
  },
};

/**
 * Generate an Enfusion .conf config file.
 */
export function generateConfig(opts: ConfigOptions): string {
  const info = CONFIG_TYPE_INFO[opts.configType];
  // mission-header: root type depends on mode
  const rootType =
    opts.configType === "mission-header" && opts.missionMode !== "SF"
      ? "SCR_MissionHeaderCampaign"
      : info.rootType;
  const root = createNode(rootType);

  switch (opts.configType) {
    case "mission-header":
      buildMissionHeader(root, opts);
      break;
    case "faction":
      buildFaction(root, opts);
      break;
    case "entity-catalog":
      buildEntityCatalog(root, opts);
      break;
    case "editor-placeables":
      buildEditorPlaceables(root, opts);
      break;
  }

  return serialize(root);
}

function buildMissionHeader(root: ReturnType<typeof createNode>, opts: ConfigOptions): void {
  if (opts.missionMode === "SF") {
    // Scenario Framework — single-player / co-op narrative missions
    setProperty(root, "m_sName", opts.scenarioName || opts.name);
    setProperty(root, "m_sDescription", opts.scenarioDescription || "");
    setProperty(root, "m_sWorldFile", opts.worldPath || "");
    setProperty(root, "m_sIcon", "");
    setProperty(root, "m_bIsModded", "1");
  } else {
    // Conflict (default) — multiplayer Campaign/Conflict scenarios
    // Matches the exact property order used by vanilla Conflict_East.conf
    if (opts.worldPath) setProperty(root, "World", opts.worldPath);
    setProperty(root, "SystemsConfig", "{7C9E720397CC6ACD}Configs/Systems/ConflictSystems.conf");
    setProperty(root, "m_sName", opts.scenarioName || opts.name);
    if (opts.scenarioDescription) setProperty(root, "m_sDescription", opts.scenarioDescription);
    if (opts.author) setProperty(root, "m_sAuthor", opts.author);
    setProperty(root, "m_sGameMode", opts.gameModeLabel || "Conflict");
    setProperty(root, "m_iPlayerCount", String(opts.playerCount ?? 40));
    setProperty(root, "m_eEditableGameFlags", "6");
    setProperty(root, "m_eDefaultGameFlags", "6");
    if (opts.xpMultiplier !== undefined && opts.xpMultiplier !== 1.0) {
      setProperty(root, "m_fXpMultiplier", String(opts.xpMultiplier));
    }
  }
}

function buildFaction(root: ReturnType<typeof createNode>, opts: ConfigOptions): void {
  const key = opts.factionKey || opts.name.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  setProperty(root, "m_sKey", key);
  setProperty(root, "m_sName", opts.name);
  setProperty(root, "m_Color", opts.factionColor || "0,100,200,255");
  setProperty(root, "m_sFlagPath", opts.flagPath || "");
}

function buildEntityCatalog(root: ReturnType<typeof createNode>, opts: ConfigOptions): void {
  setProperty(root, "m_sCategoryName", opts.categoryName || "Custom");

  if (opts.prefabRefs && opts.prefabRefs.length > 0) {
    const entries = createNode("m_aEntries");
    for (const ref of opts.prefabRefs) {
      const entry = createNode("SCR_EntityCatalogEntry");
      setProperty(entry, "m_sPrefab", ref);
      entries.children.push(entry);
    }
    root.children.push(entries);
  }
}

function buildEditorPlaceables(root: ReturnType<typeof createNode>, opts: ConfigOptions): void {
  setProperty(root, "m_sCategoryName", opts.categoryName || "Custom");

  if (opts.prefabRefs && opts.prefabRefs.length > 0) {
    const entries = createNode("m_aEntries");
    for (const ref of opts.prefabRefs) {
      const entry = createNode("SCR_PlaceableEntity");
      setProperty(entry, "m_sPrefab", ref);
      entries.children.push(entry);
    }
    root.children.push(entries);
  }
}

/**
 * Get the subdirectory for a config type.
 */
export function getConfigSubdirectory(configType: ConfigType): string {
  return CONFIG_TYPE_INFO[configType].subdirectory;
}

/**
 * Get the filename for a config.
 */
export function getConfigFilename(name: string): string {
  return `${name}.conf`;
}
