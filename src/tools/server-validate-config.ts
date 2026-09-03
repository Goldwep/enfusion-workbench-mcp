/**
 * `server_validate_config` — lint an existing `server.json` for schema
 * correctness, port range issues, and semantic warnings (L3-3).
 *
 * Output is REDACTED — never echoes the raw password values from the
 * file. Validates against the current schema (v0.9.8.73+).
 *
 * Categories:
 *   - errors:   things that will cause the server to fail or refuse the config
 *   - warnings: deprecations, weak settings, dangerous-in-public combinations
 *   - infos:    notable choices that aren't problems
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Config } from "../config.js";
import {
  redactServerConfig,
  stringifyRedacted,
  type ServerConfig,
} from "./server-redact.js";

// ── Validation engine ────────────────────────────────────────────────────────

export interface ValidationFinding {
  severity: "error" | "warning" | "info";
  path: string;
  message: string;
  hint?: string;
}

const DEPRECATED_FIELD_MAP: Record<string, string> = {
  gameHostBindAddress: "bindAddress",
  gameHostBindPort: "bindPort",
  gameHostRegisterAddress: "publicAddress",
  gameHostRegisterPort: "publicPort",
  gameHostRegisterBindAddress: "publicAddress",
};

/**
 * Pure validator over a parsed JSON object (not yet typed as ServerConfig
 * — we accept any-shape and report violations).
 *
 * Exported for unit testing without an MCP server.
 */
export function validateServerConfig(raw: unknown): ValidationFinding[] {
  const findings: ValidationFinding[] = [];

  if (typeof raw !== "object" || raw === null) {
    findings.push({
      severity: "error",
      path: "(root)",
      message: "Config is not a JSON object",
    });
    return findings;
  }

  const obj = raw as Record<string, unknown>;

  // Deprecated field detection (v0.9.8.72 and earlier).
  for (const oldField of Object.keys(DEPRECATED_FIELD_MAP)) {
    if (oldField in obj) {
      findings.push({
        severity: "warning",
        path: oldField,
        message: `Deprecated field name (renamed in v0.9.8.73).`,
        hint: `Rename to '${DEPRECATED_FIELD_MAP[oldField]}'. The server may silently ignore this field.`,
      });
    }
  }

  // bindAddress / bindPort
  const bindAddress = obj.bindAddress;
  if (typeof bindAddress !== "string") {
    findings.push({
      severity: "error",
      path: "bindAddress",
      message: "Missing or non-string 'bindAddress'. Use '0.0.0.0' to bind all interfaces.",
    });
  }
  const bindPort = obj.bindPort;
  if (!isValidPort(bindPort)) {
    findings.push({
      severity: "error",
      path: "bindPort",
      message: `bindPort must be a number in 1-65535 (got ${JSON.stringify(bindPort)})`,
    });
  }

  // a2s.port
  const a2s = obj.a2s as Record<string, unknown> | undefined;
  if (!a2s || typeof a2s !== "object") {
    findings.push({
      severity: "error",
      path: "a2s",
      message: "Missing a2s block — server browser will not see this server",
    });
  } else if (!isValidPort(a2s.port)) {
    findings.push({
      severity: "error",
      path: "a2s.port",
      message: `a2s.port must be a number in 1-65535 (got ${JSON.stringify(a2s.port)})`,
    });
  } else if (a2s.port === bindPort) {
    findings.push({
      severity: "error",
      path: "a2s.port",
      message: "a2s.port must differ from bindPort (they share UDP otherwise)",
    });
  }

  // game block
  const game = obj.game as Record<string, unknown> | undefined;
  if (!game || typeof game !== "object") {
    findings.push({
      severity: "error",
      path: "game",
      message: "Missing 'game' block — server has nothing to host",
    });
  } else {
    if (typeof game.name !== "string" || game.name.length === 0) {
      findings.push({
        severity: "error",
        path: "game.name",
        message: "game.name is required and must be non-empty",
      });
    }
    if (typeof game.scenarioId !== "string" || game.scenarioId.length === 0) {
      findings.push({
        severity: "warning",
        path: "game.scenarioId",
        message: "game.scenarioId is empty — server will load default scenario or fail to start",
      });
    }
    if (typeof game.maxPlayers === "number") {
      if (game.maxPlayers < 1 || game.maxPlayers > 128) {
        findings.push({
          severity: "warning",
          path: "game.maxPlayers",
          message: `game.maxPlayers=${game.maxPlayers} outside typical 1-128 range`,
        });
      }
    }

    // Visible+no-password combination warning
    if (game.visible === true && (game.password === "" || game.password === undefined)) {
      const adminSet = typeof obj.passwordAdmin === "string" && obj.passwordAdmin.length > 0;
      if (!adminSet) {
        findings.push({
          severity: "warning",
          path: "game.visible",
          message: "Server is visible (public) with no join password AND no admin password",
          hint: "Set passwordAdmin so you can kick/ban abusive users on a public server",
        });
      }
    }

    // gameProperties checks
    const gp = game.gameProperties as Record<string, unknown> | undefined;
    if (gp && typeof gp === "object") {
      if (gp.fastValidation === false && game.visible === true) {
        findings.push({
          severity: "warning",
          path: "game.gameProperties.fastValidation",
          message: "fastValidation=false on a public server slows down client joins significantly",
          hint: "Disable only for debug / mod-development sessions",
        });
      }
      if (gp.battlEye === false && game.visible === true) {
        findings.push({
          severity: "warning",
          path: "game.gameProperties.battlEye",
          message: "battlEye=false on a public server allows unrestricted cheating",
          hint: "Re-enable BattlEye unless you have a specific reason",
        });
      }
    }
  }

  // RCON checks
  const rcon = obj.rcon as Record<string, unknown> | undefined;
  if (rcon && typeof rcon === "object") {
    if (typeof rcon.password !== "string" || rcon.password.length < 8) {
      findings.push({
        severity: "warning",
        path: "rcon.password",
        message: "RCON password is missing or shorter than 8 characters",
        hint: "RCON exposes admin commands. Use a long random password.",
      });
    }
    if (!isValidPort(rcon.port)) {
      findings.push({
        severity: "error",
        path: "rcon.port",
        message: `rcon.port must be a valid port number (got ${JSON.stringify(rcon.port)})`,
      });
    }
  }

  // Admin password length
  if (typeof obj.passwordAdmin === "string" && obj.passwordAdmin.length > 0 && obj.passwordAdmin.length < 8) {
    findings.push({
      severity: "warning",
      path: "passwordAdmin",
      message: "passwordAdmin is shorter than 8 characters",
      hint: "Admin console grants full server control. Use a long random password.",
    });
  }

  // Admins SteamID format (loose check — must be 17-digit numeric)
  if (Array.isArray(obj.admins)) {
    for (let i = 0; i < obj.admins.length; i++) {
      const a = obj.admins[i];
      if (typeof a !== "string" || !/^\d{17}$/.test(a)) {
        findings.push({
          severity: "warning",
          path: `admins[${i}]`,
          message: `Admin entry doesn't look like a Steam64 ID (expected 17 digits): ${JSON.stringify(a)}`,
        });
      }
    }
  }

  return findings;
}

function isValidPort(p: unknown): boolean {
  return typeof p === "number" && Number.isInteger(p) && p >= 1 && p <= 65535;
}

// ── Formatter ────────────────────────────────────────────────────────────────

export function formatValidationReport(input: {
  path: string;
  findings: ValidationFinding[];
  redactedConfigJson: string;
}): string {
  const { path, findings, redactedConfigJson } = input;
  const errors = findings.filter((f) => f.severity === "error");
  const warnings = findings.filter((f) => f.severity === "warning");
  const infos = findings.filter((f) => f.severity === "info");

  const lines: string[] = [];
  lines.push(`## server.json validation: ${path}`);
  lines.push("");
  lines.push(`${errors.length} error${errors.length !== 1 ? "s" : ""}, ${warnings.length} warning${warnings.length !== 1 ? "s" : ""}, ${infos.length} info${infos.length !== 1 ? "s" : ""}.`);
  lines.push("");

  if (errors.length > 0) {
    lines.push("### Errors");
    lines.push("");
    for (const f of errors) {
      lines.push(`- **${f.path}** — ${f.message}`);
      if (f.hint) lines.push(`  *${f.hint}*`);
    }
    lines.push("");
  }
  if (warnings.length > 0) {
    lines.push("### Warnings");
    lines.push("");
    for (const f of warnings) {
      lines.push(`- **${f.path}** — ${f.message}`);
      if (f.hint) lines.push(`  *${f.hint}*`);
    }
    lines.push("");
  }
  if (infos.length > 0) {
    lines.push("### Info");
    lines.push("");
    for (const f of infos) {
      lines.push(`- **${f.path}** — ${f.message}`);
    }
    lines.push("");
  }

  if (errors.length === 0 && warnings.length === 0 && infos.length === 0) {
    lines.push("(no findings — config looks clean)");
    lines.push("");
  }

  lines.push("### Redacted config snapshot");
  lines.push("");
  lines.push("```json");
  lines.push(redactedConfigJson);
  lines.push("```");

  return lines.join("\n");
}

// ── Registration ─────────────────────────────────────────────────────────────

export function registerServerValidateConfig(server: McpServer, config: Config): void {
  server.registerTool(
    "server_validate_config",
    {
      description:
        "Validate an existing `server.json` for schema correctness, port-range issues, and semantic warnings. " +
        "Reports deprecated v0.9.8.72 field names (gameHostBindAddress et al — silently ignored now). " +
        "Output is REDACTED — never echoes plaintext passwords from the file under inspection.",
      inputSchema: {
        config_path: z
          .string()
          .optional()
          .describe(
            "Path to server.json. Defaults to <projectPath>/server.json. May be absolute.",
          ),
      },
    },
    async ({ config_path }) => {
      try {
        const fullPath = config_path
          ? resolve(config_path)
          : resolve(config.projectPath, "server.json");
        if (!existsSync(fullPath)) {
          return {
            content: [
              {
                type: "text" as const,
                text: `server.json not found at: ${fullPath}\n\nUse \`server_config\` to generate one first.`,
              },
            ],
          };
        }
        const text = readFileSync(fullPath, "utf-8");
        let raw: unknown;
        try {
          raw = JSON.parse(text);
        } catch (e) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error parsing server.json as JSON: ${e instanceof Error ? e.message : String(e)}`,
              },
            ],
            isError: true,
          };
        }
        const findings = validateServerConfig(raw);

        // Redact for display. If the file is malformed enough to fail the
        // typed redactor, fall back to a generic "<redacted file>" stub.
        let redactedJson = "<unable to redact — config shape is unrecognized>";
        try {
          redactedJson = stringifyRedacted(redactServerConfig(raw as ServerConfig));
        } catch {
          // intentional fallback
        }

        const report = formatValidationReport({
          path: fullPath,
          findings,
          redactedConfigJson: redactedJson,
        });
        return { content: [{ type: "text" as const, text: report }] };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [{ type: "text" as const, text: `Error validating server config: ${msg}` }],
          isError: true,
        };
      }
    },
  );
}
