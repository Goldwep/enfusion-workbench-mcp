/**
 * Arma Reforger dedicated-server config emitter (L3-1).
 *
 * Produces JSON for `server.json` using the CURRENT field-name schema
 * (v0.9.8.73+). Previously this module emitted the deprecated names
 * (`gameHostBindAddress`, `gameHostRegisterPort`, etc.) which produce
 * a wire-incompatible config — Reforger Server silently ignores them
 * and falls back to defaults, leading to "server starts but can't be
 * found" symptoms.
 *
 * Returns a raw `ServerConfig` shape (typed in `src/tools/server-redact.ts`).
 * The tool wrapper writes the raw config to disk and emits the REDACTED
 * variant in tool output — secrets never reach an LLM conversation
 * transcript.
 */

import type {
  ServerConfig,
  ModEntry,
  GameProperties,
  RconBlock,
} from "../tools/server-redact.js";

export interface ServerConfigOptions {
  /** Server display name (game.name) */
  name: string;
  /** Addon ID from .gproj — produces game.mods[0].name */
  modName?: string;
  /** Addon GUID from .gproj — produces game.mods[0].modId */
  modId?: string;
  /** Scenario resource path e.g. "{GUID}Missions/MissionHeader.conf" */
  scenarioId?: string;
  /** Maximum players (default 32) */
  maxPlayers?: number;
  /** Game host bind port (default 2001) */
  bindPort?: number;
  /** Public/register port (default = bindPort) */
  publicPort?: number;
  /** Bind address (default "0.0.0.0") */
  bindAddress?: string;
  /** Public/register address (default empty = auto-detect) */
  publicAddress?: string;
  /** A2S query port (default 17777) */
  a2sPort?: number;
  /** Whether server appears in browser (default false for local testing) */
  visible?: boolean;
  /** Join password (empty = no password) */
  password?: string;
  /** Admin console password — sensitive. Empty = no admin auth. */
  passwordAdmin?: string;
  /** Admin SteamID list */
  admins?: string[];
  /** RCON config (optional — omitted if not specified) */
  rcon?: {
    address?: string;
    port?: number;
    password: string;
    permission?: "admin" | "monitor";
    maxClients?: number;
  };
  /** crossPlatform default false; flip to true to allow PC + console mixing */
  crossPlatform?: boolean;
  /** Game-properties overrides (default sensible values for local testing) */
  gameProperties?: Partial<GameProperties>;
}

/**
 * Generate a JSON-serialized `server.json` for an Arma Reforger dedicated
 * server. Field names match the current schema (v0.9.8.73+).
 */
export function generateServerConfig(opts: ServerConfigOptions): string {
  return JSON.stringify(buildServerConfig(opts), null, 2);
}

/**
 * Build the typed `ServerConfig` object (raw, secret-bearing) without
 * stringifying. Callers that want to redact-then-emit can do so via
 * `redactServerConfig` from `server-redact.ts`.
 */
export function buildServerConfig(opts: ServerConfigOptions): ServerConfig {
  const bindPort = opts.bindPort ?? 2001;
  const publicPort = opts.publicPort ?? bindPort;
  const a2sPort = opts.a2sPort ?? 17777;
  const bindAddress = opts.bindAddress ?? "0.0.0.0";
  const publicAddress = opts.publicAddress ?? "";

  const gameProperties: GameProperties = {
    serverMaxViewDistance: 1600,
    serverMinGrassDistance: 50,
    fastValidation: true,
    battlEye: false,
    ...opts.gameProperties,
  };

  const config: ServerConfig = {
    dedicatedServerId: "",
    region: "US",
    bindAddress,
    bindPort,
    publicAddress: publicAddress || undefined,
    publicPort: publicAddress ? publicPort : undefined,
    a2s: {
      address: bindAddress,
      port: a2sPort,
    },
    game: {
      name: opts.name,
      password: opts.password ?? "",
      scenarioId: opts.scenarioId ?? "",
      maxPlayers: opts.maxPlayers ?? 32,
      visible: opts.visible ?? false,
      gameProperties,
      mods: buildModList(opts),
    },
    crossPlatform: opts.crossPlatform,
  };

  if (opts.passwordAdmin !== undefined && opts.passwordAdmin !== "") {
    config.passwordAdmin = opts.passwordAdmin;
  }
  if (opts.admins && opts.admins.length > 0) {
    config.admins = opts.admins;
  }
  if (opts.rcon) {
    const rcon: RconBlock = {
      address: opts.rcon.address ?? bindAddress,
      port: opts.rcon.port ?? 19999,
      password: opts.rcon.password,
    };
    if (opts.rcon.permission) rcon.permission = opts.rcon.permission;
    if (opts.rcon.maxClients !== undefined) rcon.maxClients = opts.rcon.maxClients;
    config.rcon = rcon;
  }

  return config;
}

function buildModList(opts: ServerConfigOptions): ModEntry[] {
  if (!opts.modName && !opts.modId) return [];
  return [
    {
      modId: opts.modId ?? "",
      name: opts.modName ?? "",
      version: "",
    },
  ];
}
