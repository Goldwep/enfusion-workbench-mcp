import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { logger } from "./utils/logger.js";
import { findGameAcrossSteamLibraries, steamRootOf } from "./utils/steam.js";

export interface Config {
  /** Path to "Arma Reforger Tools" installation */
  workbenchPath: string;
  /** Default project directory for project_browse */
  projectPath: string;
  /** Path to base game installation (auto-derived from workbenchPath) */
  gamePath: string;
  /** Optional path to a pre-extracted game data library (fully flattened prefabs).
   *  When set, game_duplicate checks here first before falling back to pak loose files.
   *  Set via ENFUSION_EXTRACTED_PATH env var. */
  extractedPath?: string;
  /** Directory containing scraped data index */
  dataDir: string;
  /** Directory containing mod pattern definitions */
  patternsDir: string;
  /** Workbench NET API host (default 127.0.0.1) */
  workbenchHost: string;
  /** Workbench NET API port (default 5775) */
  workbenchPort: number;
  /** Default addon folder name used when modName is not specified in tool calls.
   *  Automatically set at runtime when wb_launch opens a .gproj file.
   *  Can also be set via ENFUSION_DEFAULT_MOD env var as a static fallback. */
  defaultMod?: string;
  /** Path to the project-index SQLite database (L1 — Goldwep fork addition).
   *  The DB file is created on first use; the parent directory is
   *  auto-created by registerTools. Set via ENFUSION_PROJECT_INDEX_PATH. */
  projectIndexPath: string;
  /** Workshop addons directory (L2 — multi-source crawl).
   *  Where downloaded Workshop mods land. Default derives from projectPath:
   *  if projectPath is `<X>/My Games/ArmaReforgerWorkbench/addons`, workshop is
   *  `<X>/My Games/ArmaReforger/addons`. Set via ENFUSION_WORKSHOP_PATH.
   *  When unset and the derived path doesn't exist, the workshop source is
   *  silently skipped during crawl. */
  workshopPath?: string;
  /** BI core addons directory (L2 — multi-source crawl). Contains
   *  `core/core.gproj` and any other vanilla content. Default derives from
   *  workbenchPath: `<workbenchPath>/Workbench/addons`. Set via
   *  ENFUSION_CORE_PATH. Indexed read-only — never written by tools. */
  corePath: string;
  /** Workbench logs directory (L3 — logs cluster). Sessions live as
   *  `<logsPath>/logs_YYYY-MM-DD_HH-MM-SS/{console,error,script}.log`.
   *  Default derives from projectPath: parent of `addons/` + `/logs`. Set
   *  via ENFUSION_LOGS_PATH. */
  logsPath: string;
  /** Optional game-side logs directory (L3). Same shape, lives under
   *  `My Games/ArmaReforger/logs/` rather than the Workbench profile.
   *  Set via ENFUSION_GAME_LOGS_PATH. Auto-derived when projectPath
   *  matches the standard My Games layout. */
  gameLogsPath?: string;
  /** Machine-wide Workbench lease file (2.0 plan 5.1). Defaults to
   *  `~/.enfusion-mcp/workbench.lease.json`. Set via ENFUSION_LEASE_PATH; a
   *  spawned test process points it at a temporary file. */
  leasePath?: string;
  /** No-autolaunch marker file (2.0 plan 5.1). While it exists the server
   *  never auto-launches Workbench. Defaults to `~/.enfusion-mcp/no-autolaunch`.
   *  Set via ENFUSION_NO_AUTOLAUNCH_PATH. */
  noAutolaunchPath?: string;
}

const DEFAULT_WORKBENCH_PATH =
  "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Arma Reforger Tools";

const DEFAULTS: Config = {
  workbenchPath: DEFAULT_WORKBENCH_PATH,
  projectPath: join(homedir(), "Documents", "My Games", "ArmaReforgerWorkbench", "addons"),
  gamePath: resolve(DEFAULT_WORKBENCH_PATH, "..", "Arma Reforger"),
  dataDir: resolve(dirname(fileURLToPath(import.meta.url)), "..", "data"),
  patternsDir: resolve(dirname(fileURLToPath(import.meta.url)), "..", "data", "patterns"),
  workbenchHost: "127.0.0.1",
  workbenchPort: 5775,
  projectIndexPath: join(homedir(), ".enfusion-mcp", "project-index.db"),
  corePath: join(DEFAULT_WORKBENCH_PATH, "Workbench", "addons"),
  logsPath: join(homedir(), "Documents", "My Games", "ArmaReforgerWorkbench", "logs"),
  // workshopPath + gameLogsPath intentionally undefined — derived after env loading.
};

function loadJsonFile(path: string): Partial<Config> {
  try {
    if (!existsSync(path)) return {};
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw) as Partial<Config>;
  } catch (e) {
    // Distinguish read errors from parse errors so users can fix malformed JSON
    const detail = e instanceof SyntaxError ? `invalid JSON: ${e.message}` : String(e);
    logger.warn(`Failed to load config from ${path}: ${detail}`);
  }
  return {};
}

/** Where loadConfig reads from. Every field defaults to the real source; tests inject. */
export interface ConfigSources {
  /** Environment to read ENFUSION_* variables from (default process.env). */
  env?: NodeJS.ProcessEnv;
  /** Package-local config file (default <package>/enfusion-mcp.config.json). */
  localConfigPath?: string;
  /** User config file (default ~/.enfusion-mcp/config.json). */
  homeConfigPath?: string;
}

export function loadConfig(sources: ConfigSources = {}): Config {
  const env = sources.env ?? process.env;
  // 1. Start with defaults
  const config = { ...DEFAULTS };
  // Keys set by a config file or an env var. Auto-derivation below only
  // fills keys that are NOT in this set (4-tier merge: top wins).
  const explicit = new Set<keyof Config>();
  const applyFile = (path: string): void => {
    const fromFile = loadJsonFile(path);
    for (const k of Object.keys(fromFile) as (keyof Config)[]) {
      if (fromFile[k] !== undefined) explicit.add(k);
    }
    Object.assign(config, fromFile);
  };

  // 2. Package-local config file
  applyFile(
    sources.localConfigPath ??
      resolve(dirname(fileURLToPath(import.meta.url)), "..", "enfusion-mcp.config.json"),
  );

  // 3. User home config
  applyFile(sources.homeConfigPath ?? resolve(homedir(), ".enfusion-mcp", "config.json"));

  // 4. Environment variables override everything
  if (env.ENFUSION_WORKBENCH_PATH) {
    config.workbenchPath = env.ENFUSION_WORKBENCH_PATH;
  }
  if (env.ENFUSION_PROJECT_PATH) {
    config.projectPath = env.ENFUSION_PROJECT_PATH;
  }
  if (env.ENFUSION_GAME_PATH) {
    config.gamePath = env.ENFUSION_GAME_PATH;
  }
  if (env.ENFUSION_EXTRACTED_PATH) {
    config.extractedPath = env.ENFUSION_EXTRACTED_PATH;
  }
  if (env.ENFUSION_MCP_DATA_DIR) {
    config.dataDir = env.ENFUSION_MCP_DATA_DIR;
    // patternsDir is always <dataDir>/patterns unless explicitly set in a config file
    if (!explicit.has("patternsDir")) {
      config.patternsDir = join(env.ENFUSION_MCP_DATA_DIR, "patterns");
    }
  }
  if (env.ENFUSION_WORKBENCH_HOST) {
    config.workbenchHost = env.ENFUSION_WORKBENCH_HOST;
  }
  if (env.ENFUSION_WORKBENCH_PORT) {
    const port = parseInt(env.ENFUSION_WORKBENCH_PORT, 10);
    if (!isNaN(port) && port > 0 && port < 65536) {
      config.workbenchPort = port;
    }
  }
  if (env.ENFUSION_DEFAULT_MOD) {
    config.defaultMod = env.ENFUSION_DEFAULT_MOD;
  }
  if (env.ENFUSION_PROJECT_INDEX_PATH) {
    config.projectIndexPath = env.ENFUSION_PROJECT_INDEX_PATH;
  }
  if (env.ENFUSION_WORKSHOP_PATH) {
    config.workshopPath = env.ENFUSION_WORKSHOP_PATH;
  }
  if (env.ENFUSION_CORE_PATH) {
    config.corePath = env.ENFUSION_CORE_PATH;
  }
  if (env.ENFUSION_LOGS_PATH) {
    config.logsPath = env.ENFUSION_LOGS_PATH;
  }
  if (env.ENFUSION_GAME_LOGS_PATH) {
    config.gameLogsPath = env.ENFUSION_GAME_LOGS_PATH;
  }
  if (env.ENFUSION_LEASE_PATH) {
    config.leasePath = env.ENFUSION_LEASE_PATH;
  }
  if (env.ENFUSION_NO_AUTOLAUNCH_PATH) {
    config.noAutolaunchPath = env.ENFUSION_NO_AUTOLAUNCH_PATH;
  }

  // Env-set keys count as explicit too.
  const ENV_KEYS: [string, keyof Config][] = [
    ["ENFUSION_GAME_PATH", "gamePath"],
    ["ENFUSION_CORE_PATH", "corePath"],
    ["ENFUSION_WORKSHOP_PATH", "workshopPath"],
    ["ENFUSION_LOGS_PATH", "logsPath"],
    ["ENFUSION_GAME_LOGS_PATH", "gameLogsPath"],
  ];
  for (const [name, key] of ENV_KEYS) {
    if (env[name]) explicit.add(key);
  }

  // Auto-derive gamePath from workbenchPath if not explicitly set
  if (!explicit.has("gamePath") && config.workbenchPath !== DEFAULT_WORKBENCH_PATH) {
    config.gamePath = resolve(config.workbenchPath, "..", "Arma Reforger");
  }

  // Self-heal: on split installs the game lives in a different Steam library
  // than the Tools (e.g. Tools on C:\, game on D:\SteamLibrary), so the
  // sibling derivation above points at a directory that doesn't exist. Scan
  // Steam's libraryfolders.vdf before giving up — an explicit gamePath (env
  // var or config file) still wins because this only runs for a derived one.
  if (!explicit.has("gamePath") && !existsSync(join(config.gamePath, "addons"))) {
    const scanned = findGameAcrossSteamLibraries("Arma Reforger", [
      steamRootOf(config.workbenchPath),
    ]);
    if (scanned) config.gamePath = scanned;
  }

  // Auto-derive corePath from workbenchPath if not explicitly set
  if (!explicit.has("corePath") && config.workbenchPath !== DEFAULT_WORKBENCH_PATH) {
    config.corePath = join(config.workbenchPath, "Workbench", "addons");
  }

  // Auto-derive workshopPath from projectPath if not explicitly set.
  // projectPath = `<X>/My Games/ArmaReforgerWorkbench/addons` →
  // workshopPath = `<X>/My Games/ArmaReforger/addons`. If projectPath doesn't
  // match this convention, leave workshopPath undefined.
  if (!explicit.has("workshopPath") && config.workshopPath === undefined) {
    const derived = resolve(config.projectPath, "..", "..", "ArmaReforger", "addons");
    if (existsSync(derived)) {
      config.workshopPath = derived;
    }
  }

  // Auto-derive logsPath from projectPath. Default points at the Workbench
  // logs (most useful for mod authoring). Game-side logs are a separate knob.
  if (!explicit.has("logsPath")) {
    const derived = resolve(config.projectPath, "..", "logs");
    if (existsSync(derived)) {
      config.logsPath = derived;
    }
  }

  // Auto-derive gameLogsPath from projectPath's My Games sibling.
  if (!explicit.has("gameLogsPath") && config.gameLogsPath === undefined) {
    const derived = resolve(config.projectPath, "..", "..", "ArmaReforger", "logs");
    if (existsSync(derived)) {
      config.gameLogsPath = derived;
    }
  }

  logger.debug("Config loaded", config);
  return config;
}
