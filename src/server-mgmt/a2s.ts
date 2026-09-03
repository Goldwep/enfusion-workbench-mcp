/**
 * Valve A2S (Source Engine Query) — UDP protocol implementation for the
 * `server_health_probe` tool.
 *
 * Reforger's dedicated server speaks the Source Engine Query protocol on
 * its `a2s.port` (default 17777). We send an `A2S_INFO` request and parse
 * the response per Valve's published wire format. NOTE: modern source
 * servers require a challenge handshake — when the server returns the
 * S2C_CHALLENGE response (0x41), we re-send with the challenge token.
 *
 * Wire format (host byte order is little-endian for Source):
 *
 *   Request:   FF FF FF FF 54 ("T") "Source Engine Query\0"
 *   Challenge: FF FF FF FF 41 <int32 challenge>
 *   Info reply: FF FF FF FF 49 ("I")
 *     u8  protocol
 *     str name (\0-terminated)
 *     str map  (\0-terminated)
 *     str folder
 *     str game
 *     u16 appId
 *     u8  players
 *     u8  maxPlayers
 *     u8  bots
 *     u8  serverType
 *     u8  environment
 *     u8  visibility
 *     u8  vac
 *     str version
 *     u8  EDF (extra-data flag)
 *     [optional fields based on EDF bits — port, steamid, sourcetv,
 *      keywords, gameid]
 *
 *   See https://developer.valvesoftware.com/wiki/Server_queries
 *
 * We expose:
 *
 *   - `buildA2SInfoRequest(challenge?)` — pure, returns the UDP packet
 *   - `parseA2SInfoResponse(buffer)` — pure, returns the typed result OR
 *     a `{ kind: "challenge", token }` when the server wants a handshake
 *   - `queryA2S(host, port, timeoutMs)` — does the dgram dance end-to-end
 *
 * NO RCON in v1 — RCON adds auth complexity, secret handling, and is the
 * single highest-value injection target in this cluster. Defer to a future
 * task (TODO: see RCON_ALLOW_LIST comment block at the bottom).
 */

import { createSocket } from "node:dgram";

/** Source Engine A2S header magic: `FF FF FF FF` (split packets use FE). */
const A2S_HEADER = Buffer.from([0xff, 0xff, 0xff, 0xff]);

/** Request opcode for `A2S_INFO`. */
const A2S_INFO_REQUEST_OP = 0x54;

/** Response opcode for `A2S_INFO` (server -> client). */
const A2S_INFO_RESPONSE_OP = 0x49;

/** Challenge response opcode — server demands a challenge round-trip. */
const A2S_CHALLENGE_RESPONSE_OP = 0x41;

/** The mandatory payload string in an A2S_INFO request. */
const A2S_INFO_PAYLOAD = "Source Engine Query";

/** Cap on response size we'll accept. A2S replies are typically < 1.5KB. */
const MAX_RESPONSE_BYTES = 4096;

/** Cap on timeout — never let a caller request infinite wait. */
export const MAX_TIMEOUT_MS = 10_000;

/**
 * Build the bytes of an A2S_INFO request. When a challenge token is
 * provided, append the 4-byte LE challenge — required by post-2020
 * Source servers and by Reforger.
 */
export function buildA2SInfoRequest(challenge?: number): Buffer {
  const payload = Buffer.from(A2S_INFO_PAYLOAD + "\0", "utf-8");
  if (challenge === undefined) {
    return Buffer.concat([A2S_HEADER, Buffer.from([A2S_INFO_REQUEST_OP]), payload]);
  }
  const challengeBuf = Buffer.alloc(4);
  challengeBuf.writeInt32LE(challenge, 0);
  return Buffer.concat([
    A2S_HEADER,
    Buffer.from([A2S_INFO_REQUEST_OP]),
    payload,
    challengeBuf,
  ]);
}

/** Typed A2S_INFO result. All optional fields come from EDF-flagged extras. */
export interface A2SInfoResult {
  /** Server's reported display name. */
  name: string;
  /** Current map / world. */
  map: string;
  /** Folder (e.g. "armaR"). */
  folder: string;
  /** Game (e.g. "Arma Reforger"). */
  game: string;
  /** Steam app id reported in the protocol (truncated to u16 in v17+). */
  appId: number;
  /** Current players (excluding bots). */
  players: number;
  /** Max players. */
  maxPlayers: number;
  /** Bot count. */
  bots: number;
  /** 'd' dedicated, 'l' listen, 'p' proxy. */
  serverType: string;
  /** 'l' linux, 'w' windows, 'm' mac. */
  environment: string;
  /** True when password-protected. */
  passwordProtected: boolean;
  /** True when VAC-secured (off for Reforger, but field is still emitted). */
  vac: boolean;
  /** Server build/version string. */
  version: string;
  /** Game port (when EDF bit 0x80 set). */
  gamePort?: number;
  /** Server SteamID (when EDF bit 0x10 set, decimal string for safety with u64). */
  steamId?: string;
  /** Keywords / tags (when EDF bit 0x20 set). */
  keywords?: string;
  /** Game id (when EDF bit 0x01 set, decimal string for safety with u64). */
  gameId?: string;
}

/**
 * Parse-result envelope. Either we got real info, or the server sent a
 * challenge and we need to retry.
 */
export type A2SParseResult =
  | { kind: "info"; info: A2SInfoResult }
  | { kind: "challenge"; token: number };

/**
 * Parse an A2S response packet. Tolerant of trailing bytes (some servers
 * append non-spec extensions). Throws on header mismatch or truncated
 * fields.
 */
export function parseA2SInfoResponse(buf: Buffer): A2SParseResult {
  if (buf.length < 5) {
    throw new Error(`A2S response too short: ${buf.length} bytes`);
  }
  if (
    buf[0] !== 0xff ||
    buf[1] !== 0xff ||
    buf[2] !== 0xff ||
    buf[3] !== 0xff
  ) {
    throw new Error("A2S response missing FFFFFFFF header");
  }
  const op = buf[4];
  if (op === A2S_CHALLENGE_RESPONSE_OP) {
    if (buf.length < 9) {
      throw new Error("A2S challenge response truncated");
    }
    return { kind: "challenge", token: buf.readInt32LE(5) };
  }
  if (op !== A2S_INFO_RESPONSE_OP) {
    throw new Error(
      `A2S unexpected opcode: 0x${op.toString(16)} (expected 0x49 info or 0x41 challenge)`,
    );
  }

  // op consumed; now `protocol` byte, then strings, then numerics, then EDF.
  const cursor = { i: 5 };
  if (cursor.i >= buf.length) throw new Error("A2S info truncated at protocol");
  cursor.i += 1; // skip protocol byte (we don't surface it)

  const name = readCString(buf, cursor);
  const map = readCString(buf, cursor);
  const folder = readCString(buf, cursor);
  const game = readCString(buf, cursor);

  ensureRemaining(buf, cursor, 9, "info numerics");
  const appId = buf.readUInt16LE(cursor.i);
  cursor.i += 2;
  const players = buf.readUInt8(cursor.i++);
  const maxPlayers = buf.readUInt8(cursor.i++);
  const bots = buf.readUInt8(cursor.i++);
  const serverType = String.fromCharCode(buf.readUInt8(cursor.i++));
  const environment = String.fromCharCode(buf.readUInt8(cursor.i++));
  const passwordProtected = buf.readUInt8(cursor.i++) === 1;
  const vac = buf.readUInt8(cursor.i++) === 1;

  const version = readCString(buf, cursor);

  // EDF byte may be absent on some legacy implementations.
  let edf = 0;
  if (cursor.i < buf.length) {
    edf = buf.readUInt8(cursor.i++);
  }

  const info: A2SInfoResult = {
    name,
    map,
    folder,
    game,
    appId,
    players,
    maxPlayers,
    bots,
    serverType,
    environment,
    passwordProtected,
    vac,
    version,
  };

  if (edf & 0x80) {
    ensureRemaining(buf, cursor, 2, "EDF gamePort");
    info.gamePort = buf.readUInt16LE(cursor.i);
    cursor.i += 2;
  }
  if (edf & 0x10) {
    ensureRemaining(buf, cursor, 8, "EDF steamId");
    info.steamId = buf.readBigUInt64LE(cursor.i).toString();
    cursor.i += 8;
  }
  if (edf & 0x40) {
    // SourceTV: u16 port + cstring name. Skip silently.
    ensureRemaining(buf, cursor, 2, "EDF sourceTV port");
    cursor.i += 2;
    readCString(buf, cursor);
  }
  if (edf & 0x20) {
    info.keywords = readCString(buf, cursor);
  }
  if (edf & 0x01) {
    ensureRemaining(buf, cursor, 8, "EDF gameId");
    info.gameId = buf.readBigUInt64LE(cursor.i).toString();
  }

  return { kind: "info", info };
}

function readCString(buf: Buffer, cursor: { i: number }): string {
  const start = cursor.i;
  while (cursor.i < buf.length && buf[cursor.i] !== 0x00) cursor.i++;
  if (cursor.i >= buf.length) {
    throw new Error("A2S string not null-terminated");
  }
  const str = buf.subarray(start, cursor.i).toString("utf-8");
  cursor.i++; // consume null
  return str;
}

function ensureRemaining(
  buf: Buffer,
  cursor: { i: number },
  needed: number,
  what: string,
): void {
  if (cursor.i + needed > buf.length) {
    throw new Error(
      `A2S response truncated reading ${what}: need ${needed} byte(s) at offset ${cursor.i}, have ${buf.length - cursor.i}`,
    );
  }
}

/**
 * Validate the user-supplied host. We accept hostnames (DNS-resolved by
 * dgram) and IPv4 dotted-quad. We REJECT anything that looks like a CLI
 * flag (starts with `-`) — there's no `path.resolve()` here, but the
 * defence is consistent with the rest of the L8 cluster.
 *
 * We don't fully validate hostname syntax — the OS resolver will tell us
 * if it's invalid via the socket-error path.
 */
export function validateHost(host: string): void {
  if (typeof host !== "string" || host.length === 0) {
    throw new Error("host must be a non-empty string");
  }
  if (host.startsWith("-")) {
    throw new Error("host starts with '-' — looks like a CLI flag, refusing");
  }
  // Common Unicode whitespace + shell metas.
  if (/[\s"'`;&|$<>()*?\[\]]/.test(host)) {
    throw new Error(`host contains forbidden character: ${JSON.stringify(host)}`);
  }
}

/**
 * Run an A2S query end-to-end. Resolves on first valid `A2S_INFO`
 * response (after at most one challenge round-trip). Rejects on
 * timeout, socket error, or parse failure.
 *
 * The dgram socket is closed in every exit path — there's no resource
 * leak on timeout. Tests can stub this by exporting the lower-level
 * helpers above.
 */
export function queryA2S(
  host: string,
  port: number,
  timeoutMs: number,
): Promise<A2SInfoResult> {
  // Wrap synchronous validation so callers can use `.rejects.toThrow` /
  // `.catch()` uniformly — no surprise sync throws ahead of the promise.
  try {
    validateHost(host);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`port must be an integer in 1-65535 (got ${port})`);
    }
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
      throw new Error(`timeout_ms must be a positive integer (got ${timeoutMs})`);
    }
  } catch (e) {
    return Promise.reject(e);
  }
  const clampedTimeout = Math.min(timeoutMs, MAX_TIMEOUT_MS);

  return new Promise((resolvePromise, rejectPromise) => {
    const socket = createSocket("udp4");
    let challenged = false;
    let settled = false;

    const cleanup = (): void => {
      try {
        socket.close();
      } catch {
        /* best-effort */
      }
    };

    const settle = (
      action: () => void,
    ): void => {
      if (settled) return;
      settled = true;
      cleanup();
      action();
    };

    const timeoutHandle = setTimeout(() => {
      settle(() =>
        rejectPromise(
          new Error(`A2S query timed out after ${clampedTimeout}ms`),
        ),
      );
    }, clampedTimeout);

    socket.on("error", (err) => {
      clearTimeout(timeoutHandle);
      settle(() => rejectPromise(err));
    });

    socket.on("message", (msg) => {
      // Defensive: respect MAX_RESPONSE_BYTES.
      if (msg.length > MAX_RESPONSE_BYTES) {
        clearTimeout(timeoutHandle);
        settle(() =>
          rejectPromise(
            new Error(
              `A2S response too large: ${msg.length} bytes (max ${MAX_RESPONSE_BYTES})`,
            ),
          ),
        );
        return;
      }
      let parsed: A2SParseResult;
      try {
        parsed = parseA2SInfoResponse(msg);
      } catch (e) {
        clearTimeout(timeoutHandle);
        settle(() => rejectPromise(e instanceof Error ? e : new Error(String(e))));
        return;
      }
      if (parsed.kind === "challenge") {
        if (challenged) {
          // Server keeps demanding challenges — unusual; bail out.
          clearTimeout(timeoutHandle);
          settle(() =>
            rejectPromise(new Error("A2S server kept demanding challenges")),
          );
          return;
        }
        challenged = true;
        const retry = buildA2SInfoRequest(parsed.token);
        socket.send(retry, 0, retry.length, port, host, (err) => {
          if (err) {
            clearTimeout(timeoutHandle);
            settle(() => rejectPromise(err));
          }
        });
        return;
      }
      clearTimeout(timeoutHandle);
      settle(() => resolvePromise(parsed.info));
    });

    const initial = buildA2SInfoRequest();
    socket.send(initial, 0, initial.length, port, host, (err) => {
      if (err) {
        clearTimeout(timeoutHandle);
        settle(() => rejectPromise(err));
      }
    });
  });
}

/**
 * Format an A2S result as a markdown health-probe report.
 */
export function formatHealthReport(
  host: string,
  port: number,
  result: A2SInfoResult,
): string {
  const lines: string[] = [];
  lines.push(`## Server health: \`${host}:${port}\``);
  lines.push("");
  lines.push(`- **Name:** ${result.name}`);
  lines.push(`- **Map:** ${result.map}`);
  lines.push(`- **Game:** ${result.game} (folder: \`${result.folder}\`, appId: ${result.appId})`);
  lines.push(`- **Players:** ${result.players} / ${result.maxPlayers} (bots: ${result.bots})`);
  lines.push(`- **Server type:** ${result.serverType}`);
  lines.push(`- **Environment:** ${result.environment}`);
  lines.push(`- **Password protected:** ${result.passwordProtected ? "yes" : "no"}`);
  lines.push(`- **VAC:** ${result.vac ? "yes" : "no"}`);
  lines.push(`- **Version:** ${result.version}`);
  if (result.gamePort !== undefined) lines.push(`- **Game port:** ${result.gamePort}`);
  if (result.steamId) lines.push(`- **SteamID:** ${result.steamId}`);
  if (result.keywords) lines.push(`- **Keywords:** ${result.keywords}`);
  if (result.gameId) lines.push(`- **Game id:** ${result.gameId}`);
  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// RCON_ALLOW_LIST — DEFERRED for v2.
//
// Read-only RCON commands (e.g. `#listplayers`, `#status`) could be useful
// for ops tooling, but RCON in Reforger is plaintext-password-authed over
// TCP (legacy Source design). Threats:
//
//   - Plaintext password lands in our argv / config-reading path
//   - Need a strict allow-list to prevent an LLM-driven prompt injection
//     from running `#shutdown` or `#kick all`
//   - State management: connection pooling, reconnect, broken-pipe handling
//
// All of these are doable, but they expand the L8 attack surface. We ship
// v1 with A2S info-query only (anonymous, read-only, single UDP packet)
// and revisit RCON in its own task.
// ─────────────────────────────────────────────────────────────────────────────
