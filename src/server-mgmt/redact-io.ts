/**
 * Read-and-redact helpers for the L8 server-mgmt cluster (server_launch,
 * server_mod_list, etc.).
 *
 * The L3-2 boundary in `src/tools/server-redact.ts` defines the type-level
 * contract: callers outside `server-redact.ts` should never hold a
 * `ServerConfig` value that survives past the function-call boundary. This
 * helper wraps the read+redact pair in a single function so the raw
 * (secret-bearing) shape lives only inside the call stack and never escapes
 * into a variable the caller can leak by accident.
 *
 * Callers receive `RedactedServerConfig` only. Any future code that wants
 * the raw passwords has to call the redactor at `server-redact.ts` directly
 * (and live with the L3-2 ESLint scrutiny that comes with it).
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  redactServerConfig,
  type RedactedServerConfig,
  type ServerConfig,
} from "../tools/server-redact.js";

/**
 * Reject inputs that look like CLI-flag smuggling (`--foo`, `-bar`, etc.).
 * Must run BEFORE `path.resolve()` because resolve() happily flattens a
 * `-config` arg into a real-looking absolute path on Windows, which would
 * defeat the guard if checked afterward.
 */
export function rejectFlagLikePath(p: string, fieldName: string): void {
  if (typeof p !== "string" || p.length === 0) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }
  if (p.startsWith("-")) {
    throw new Error(
      `${fieldName} starts with '-' — looks like a CLI flag, refusing to use as a path`,
    );
  }
}

/**
 * Read a server.json from disk and return its redacted form. The raw
 * (`ServerConfig`) value is bound to a local inside this function and never
 * escapes — the only return path is the `RedactedServerConfig`.
 *
 * @param configPath  absolute or project-relative path to server.json
 * @returns redacted config + the absolute path that was read
 */
export function readRedactedServerConfig(
  configPath: string,
): { config: RedactedServerConfig; absolutePath: string } {
  rejectFlagLikePath(configPath, "server_config_path");
  const absolutePath = resolve(configPath);
  if (!existsSync(absolutePath)) {
    throw new Error(`server.json not found at: ${absolutePath}`);
  }
  const text = readFileSync(absolutePath, "utf-8");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new Error(`Failed to parse server.json: ${detail}`);
  }
  // Redact immediately. The raw value is dropped at function return — there's
  // no path that exports it.
  const config = redactServerConfig(raw as ServerConfig);
  return { config, absolutePath };
}
