/**
 * Type-enforced redaction for Arma Reforger server config (L3-2).
 *
 * Server JSON carries secrets that must never leak into MCP tool output
 * (which goes into LLM conversation transcripts, gist sharing, debug dumps):
 *
 *   - `passwordAdmin`     — admin console password
 *   - `rcon.password`     — RCON password
 *   - `game.password`     — join password (still sensitive)
 *   - `persistence.databases[*].options.headers.*` — backend API keys
 *
 * Strategy: model the raw shape (`ServerConfig`) and a redacted shape
 * (`RedactedServerConfig`) where every secret field is literally typed as
 * `"<redacted>"`. The `redactServerConfig(raw)` function is the only
 * convertor — anything that wants to leak the password would have to do
 * it through a different path entirely (and we add an ESLint convention
 * to forbid that).
 *
 * The type-level guarantee is the heart of this defense — at the function
 * boundary, a redacted value cannot accidentally be re-cast to a raw one
 * because the literal-type `"<redacted>"` is not assignable to `string`
 * in the strict direction.
 */

// ── Constants ────────────────────────────────────────────────────────────────

/** The single token used in place of every secret value. */
export const REDACTED = "<redacted>" as const;

// ── Raw types (full secret-bearing) ──────────────────────────────────────────

/**
 * A2S query-server settings.
 */
export interface A2SBlock {
  address: string;
  port: number;
}

/**
 * RCON block — `password` and `permission` are sensitive (admin/monitor RCON
 * connections to the running server).
 */
export interface RconBlock {
  address: string;
  port: number;
  /** Sensitive. */
  password: string;
  permission?: "admin" | "monitor";
  blacklist?: string[];
  whitelist?: string[];
  maxClients?: number;
}

/**
 * Per-mod entry under `game.mods[]`. Public — these are workshop IDs.
 */
export interface ModEntry {
  modId: string;
  name: string;
  version?: string;
  required?: boolean;
}

/**
 * Persistence backend — `options.headers` typically carries `X-API-KEY`
 * for the database service. Every header value is treated as secret.
 */
export interface PersistenceDatabase {
  type: string;
  name: string;
  uri?: string;
  options?: {
    /** All header values are sensitive — usually contains an API key. */
    headers?: Record<string, string>;
    [key: string]: unknown;
  };
}

export interface PersistenceBlock {
  driver: string;
  location?: string;
  databases?: PersistenceDatabase[];
}

export interface GameProperties {
  serverMaxViewDistance?: number;
  serverMinGrassDistance?: number;
  fastValidation?: boolean;
  battlEye?: boolean;
  disableThirdPerson?: boolean;
  VONDisableUI?: boolean;
  VONDisableDirectSpeechUI?: boolean;
  VONCanTransmitCrossFaction?: boolean;
  missionHeader?: Record<string, unknown>;
}

export interface GameBlock {
  name: string;
  /** Join password — sensitive. */
  password: string;
  scenarioId: string;
  maxPlayers: number;
  visible: boolean;
  gameProperties: GameProperties;
  mods: ModEntry[];
  supportedGameClientTypes?: string[];
}

export interface OperatingBlock {
  lobbyPlayerSynchronise?: boolean;
  joinQueue?: {
    maxSize?: number;
  };
  disableNavmeshStreaming?: string[];
  disableServerShutdown?: boolean;
  disableCrashReporter?: boolean;
  disableAI?: boolean;
}

/**
 * Full server.json shape. Raw — carries plaintext passwords. Importable
 * only from within `src/tools/server-*.ts`; anything outside that
 * boundary should consume `RedactedServerConfig` instead.
 */
export interface ServerConfig {
  dedicatedServerId?: string;
  region?: string;
  /** v0.9.8.73+ renamed from `gameHostBindAddress`. */
  bindAddress: string;
  /** v0.9.8.73+ renamed from `gameHostBindPort`. */
  bindPort: number;
  /** v0.9.8.73+ renamed from `gameHostRegisterBindAddress`. */
  publicAddress?: string;
  /** v0.9.8.73+ renamed from `gameHostRegisterPort`. */
  publicPort?: number;
  a2s: A2SBlock;
  rcon?: RconBlock;
  /** Admin console password — highly sensitive. */
  passwordAdmin?: string;
  /** Privileged SteamID list — not secret but PII. */
  admins?: string[];
  game: GameBlock;
  crossPlatform?: boolean;
  operating?: OperatingBlock;
  persistence?: PersistenceBlock;
}

// ── Redacted shape (literal-typed secrets) ───────────────────────────────────

type RedactedToken = typeof REDACTED;

export interface RedactedRconBlock extends Omit<RconBlock, "password"> {
  password: RedactedToken;
}

export interface RedactedGameBlock extends Omit<GameBlock, "password"> {
  /** "<redacted>" when present; "" stays "" — empty isn't a secret. */
  password: RedactedToken | "";
}

export interface RedactedPersistenceDatabase extends Omit<PersistenceDatabase, "options"> {
  options?: {
    headers?: Record<string, RedactedToken>;
    [key: string]: unknown;
  };
}

export interface RedactedPersistenceBlock extends Omit<PersistenceBlock, "databases"> {
  databases?: RedactedPersistenceDatabase[];
}

export interface RedactedServerConfig
  extends Omit<ServerConfig, "rcon" | "passwordAdmin" | "game" | "persistence"> {
  rcon?: RedactedRconBlock;
  passwordAdmin?: RedactedToken;
  game: RedactedGameBlock;
  persistence?: RedactedPersistenceBlock;
}

// ── The redactor ─────────────────────────────────────────────────────────────

/**
 * Convert a raw `ServerConfig` to its redacted form. Pure function — does
 * not mutate the input. Every known secret field is replaced with the
 * `REDACTED` token; everything else is preserved verbatim.
 *
 * Empty-string secrets (`password: ""`) are preserved as `""` rather than
 * marked redacted — an empty password isn't a leak risk and the visual
 * distinction lets callers see "no password set" vs "password set,
 * hidden."
 */
export function redactServerConfig(raw: ServerConfig): RedactedServerConfig {
  // Built explicitly (no spread) because the redacted types use literal-string
  // unions (`"<redacted>" | ""`) which a `...raw` spread would widen to `string`
  // — defeating the type-level guarantee. Verbose but checkable.
  const redacted: RedactedServerConfig = {
    dedicatedServerId: raw.dedicatedServerId,
    region: raw.region,
    bindAddress: raw.bindAddress,
    bindPort: raw.bindPort,
    publicAddress: raw.publicAddress,
    publicPort: raw.publicPort,
    a2s: raw.a2s,
    admins: raw.admins,
    game: redactGame(raw.game),
    crossPlatform: raw.crossPlatform,
    operating: raw.operating,
  };

  if (raw.rcon) {
    redacted.rcon = redactRcon(raw.rcon);
  }
  if (raw.passwordAdmin !== undefined) {
    redacted.passwordAdmin = REDACTED;
  }
  if (raw.persistence) {
    redacted.persistence = redactPersistence(raw.persistence);
  }

  return redacted;
}

function redactGame(raw: GameBlock): RedactedGameBlock {
  return {
    name: raw.name,
    password: raw.password === "" ? "" : REDACTED,
    scenarioId: raw.scenarioId,
    maxPlayers: raw.maxPlayers,
    visible: raw.visible,
    gameProperties: raw.gameProperties,
    mods: raw.mods,
    supportedGameClientTypes: raw.supportedGameClientTypes,
  };
}

function redactRcon(raw: RconBlock): RedactedRconBlock {
  return {
    address: raw.address,
    port: raw.port,
    password: REDACTED,
    permission: raw.permission,
    blacklist: raw.blacklist,
    whitelist: raw.whitelist,
    maxClients: raw.maxClients,
  };
}

function redactPersistence(raw: PersistenceBlock): RedactedPersistenceBlock {
  const out: RedactedPersistenceBlock = {
    driver: raw.driver,
    location: raw.location,
  };
  if (raw.databases) {
    out.databases = raw.databases.map((d) => redactPersistenceDb(d));
  }
  return out;
}

function redactPersistenceDb(d: PersistenceDatabase): RedactedPersistenceDatabase {
  const out: RedactedPersistenceDatabase = {
    type: d.type,
    name: d.name,
    uri: d.uri,
  };
  if (d.options) {
    const opts: RedactedPersistenceDatabase["options"] = {};
    for (const [k, v] of Object.entries(d.options)) {
      if (k === "headers" && v && typeof v === "object") {
        const headers: Record<string, RedactedToken> = {};
        for (const headerKey of Object.keys(v as Record<string, string>)) {
          headers[headerKey] = REDACTED;
        }
        opts.headers = headers;
      } else {
        // Non-secret option values pass through.
        (opts as Record<string, unknown>)[k] = v;
      }
    }
    out.options = opts;
  }
  return out;
}

/**
 * Stringify a redacted config for inline display in tool output. Pretty-
 * printed JSON with 2-space indent. Type-safe: only accepts
 * `RedactedServerConfig` — a raw config can't sneak through.
 */
export function stringifyRedacted(config: RedactedServerConfig): string {
  return JSON.stringify(config, null, 2);
}
