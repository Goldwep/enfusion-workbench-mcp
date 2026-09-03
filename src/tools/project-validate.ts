/**
 * `project_validate` — consolidated validation entry point (L3-8).
 *
 * Per the architecture critic's recommendation, a single tool dispatching
 * on `scope` is strictly better than six separate `*_validate` tools that
 * each duplicate the registration boilerplate. This is the framework;
 * scopes land in their respective milestones:
 *
 *   - scope=mod         ✓ (L3)   — workshop_validate_manifest's checks
 *   - scope=scenario    ✓ (L3)   — scenario shape sanity checks
 *   - scope=faction     (L8)
 *   - scope=ui          (L4)
 *   - scope=material    (L4 offline / L8 live)
 *   - scope=anim        (L8)
 *
 * Output shape is unified across scopes: { findings: [...], summary: {...} }.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { existsSync } from "node:fs";
import { readTextFileBounded } from "../utils/safe-read.js";
import { resolve, extname } from "node:path";
import {
  validateManifest,
  type ManifestFinding,
} from "./workshop-validate-manifest.js";
import { parse } from "../formats/enfusion-text.js";
import {
  validateFaction,
  type FactionValidationFinding,
} from "./project-validate-faction.js";

// ── Shared finding shape ─────────────────────────────────────────────────────

export interface ValidationFinding {
  severity: "error" | "warning" | "info";
  path: string;
  message: string;
  hint?: string;
}

// ── Scope: mod ───────────────────────────────────────────────────────────────

function validateMod(targetPath: string): ValidationFinding[] {
  if (extname(targetPath).toLowerCase() !== ".gproj") {
    return [
      {
        severity: "error",
        path: targetPath,
        message: "scope=mod expects a .gproj file path",
      },
    ];
  }
  if (!existsSync(targetPath)) {
    return [
      {
        severity: "error",
        path: targetPath,
        message: "File not found",
      },
    ];
  }
  const content = readTextFileBounded(targetPath);
  const { findings } = validateManifest(targetPath, content);
  return findings.map((f: ManifestFinding) => ({
    severity: f.severity,
    path: f.path,
    message: f.message,
    hint: f.hint,
  }));
}

// ── Scope: scenario ──────────────────────────────────────────────────────────

function validateScenario(targetPath: string): ValidationFinding[] {
  if (extname(targetPath).toLowerCase() !== ".conf") {
    return [
      {
        severity: "error",
        path: targetPath,
        message: "scope=scenario expects a .conf file path",
      },
    ];
  }
  if (!existsSync(targetPath)) {
    return [{ severity: "error", path: targetPath, message: "File not found" }];
  }
  const content = readTextFileBounded(targetPath);
  let root;
  try {
    root = parse(content);
  } catch (e) {
    return [
      {
        severity: "error",
        path: targetPath,
        message: `Cannot parse: ${e instanceof Error ? e.message : String(e)}`,
      },
    ];
  }
  const findings: ValidationFinding[] = [];
  // Top-level checks — game mode class set, scenario points at a world.
  if (!root.className && !root.type.match(/^SCR_/)) {
    findings.push({
      severity: "warning",
      path: "(root)",
      message: `Root type '${root.type}' isn't recognized as a Reforger game mode (expected SCR_*)`,
    });
  }
  const worldProp = root.properties.find(
    (p) =>
      p.key === "m_sWorld" ||
      p.key === "m_WorldFile" ||
      p.key === "m_sWorldResourceName",
  );
  if (!worldProp || typeof worldProp.value !== "string" || worldProp.value.length === 0) {
    findings.push({
      severity: "error",
      path: "m_sWorld",
      message: "Scenario does not declare a world (m_sWorld / m_WorldFile / m_sWorldResourceName)",
    });
  }
  return findings;
}

// ── Formatter ────────────────────────────────────────────────────────────────

export function formatProjectValidate(input: {
  scope: string;
  target: string;
  findings: ValidationFinding[];
}): string {
  const { scope, target, findings } = input;
  const errors = findings.filter((f) => f.severity === "error");
  const warnings = findings.filter((f) => f.severity === "warning");

  const lines: string[] = [];
  lines.push(`## project_validate scope=${scope}: ${target}`);
  lines.push("");
  lines.push(
    `${errors.length} error${errors.length !== 1 ? "s" : ""}, ${warnings.length} warning${warnings.length !== 1 ? "s" : ""}.`,
  );
  lines.push("");
  if (errors.length > 0) {
    lines.push("### Errors");
    for (const f of errors) {
      lines.push(`- **${f.path}** — ${f.message}`);
      if (f.hint) lines.push(`  *${f.hint}*`);
    }
    lines.push("");
  }
  if (warnings.length > 0) {
    lines.push("### Warnings");
    for (const f of warnings) {
      lines.push(`- **${f.path}** — ${f.message}`);
      if (f.hint) lines.push(`  *${f.hint}*`);
    }
    lines.push("");
  }
  if (findings.length === 0) {
    lines.push("(no findings — looks clean for the requested scope)");
  }
  return lines.join("\n");
}

// ── Registration ─────────────────────────────────────────────────────────────

export function registerProjectValidate(server: McpServer): void {
  server.registerTool(
    "project_validate",
    {
      description:
        "Run lint/validation against a target file under the requested scope. " +
        "Currently shipped scopes: `mod` (.gproj workshop pre-flight), `scenario` (.conf basic shape), `faction` (SCR_Faction .conf — F1 required fields, F2 key shape, F3 color range, F4 duplicate keys, F5 orphan factions). " +
        "Future scopes: ui (L4), material (L4/L8), anim (L8). " +
        "Single-tool design avoids per-domain `*_validate` proliferation.",
      inputSchema: {
        scope: z
          .enum(["mod", "scenario", "faction"])
          .describe("What kind of validation to run"),
        target: z
          .string()
          .describe(
            "Path to the file to validate (absolute or repo-relative). " +
              "For scope=faction this may be either a .conf file or the project root directory.",
          ),
      },
    },
    async ({ scope, target }) => {
      try {
        const fullPath = resolve(target);
        let findings: ValidationFinding[];
        switch (scope) {
          case "mod":
            findings = validateMod(fullPath);
            break;
          case "scenario":
            findings = validateScenario(fullPath);
            break;
          case "faction": {
            const fac = validateFaction(fullPath);
            findings = fac.map((f: FactionValidationFinding) => ({
              severity: f.severity,
              path: f.path,
              message: f.message,
              hint: f.hint,
            }));
            break;
          }
          default: {
            const exhaustive: never = scope;
            void exhaustive;
            findings = [
              {
                severity: "error",
                path: "scope",
                message: `Unknown scope: ${scope as string}`,
              },
            ];
          }
        }
        const text = formatProjectValidate({ scope, target: fullPath, findings });
        return { content: [{ type: "text" as const, text }] };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [{ type: "text" as const, text: `Error in project_validate: ${msg}` }],
          isError: true,
        };
      }
    },
  );
}
