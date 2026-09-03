/**
 * `workshop_validate_manifest` — pre-publish validation for a Reforger
 * addon (L3-6).
 *
 * Catches the most common Workshop publish-blockers before a user
 * burns a CLI publish cycle:
 *   - Required `.gproj` properties (TITLE / ID / GUID / AUTHOR / VERSION)
 *   - Description / Notes length limits per BIKI
 *   - Preview/screenshot file size (Workshop caps at 2 MB)
 *   - Dependencies block well-formed
 *   - No `EnfusionMCP/` development handler accidentally bundled
 *
 * Pure FS; no Workbench connection needed.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { resolve, dirname, basename, join } from "node:path";
import { parse, type EnfusionNode } from "../formats/enfusion-text.js";

// ── Constraints (per BIKI Workshop) ──────────────────────────────────────────

const MAX_TITLE_LEN = 70;
const MAX_SUMMARY_LEN = 256;
const MAX_DESCRIPTION_LEN = 8000;
const MAX_CHANGE_NOTES_LEN = 8000;
const MAX_PREVIEW_BYTES = 2 * 1024 * 1024; // 2 MB
const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024;
const VERSION_RE = /^\d+(\.\d+){0,3}$/;
const GUID_RE = /^[0-9A-Fa-f]{16}$/;

// ── Findings ─────────────────────────────────────────────────────────────────

export interface ManifestFinding {
  severity: "error" | "warning" | "info";
  path: string;
  message: string;
  hint?: string;
}

export interface ManifestSummary {
  id?: string;
  guid?: string;
  title?: string;
  author?: string;
  version?: string;
  scenarioCount: number;
  depCount: number;
  hasDevHandlerDir: boolean;
}

// ── Pure validator ───────────────────────────────────────────────────────────

export function validateManifest(
  gprojPath: string,
  gprojContent: string,
): { findings: ManifestFinding[]; summary: ManifestSummary } {
  const findings: ManifestFinding[] = [];
  let root: EnfusionNode;
  try {
    root = parse(gprojContent);
  } catch (e) {
    findings.push({
      severity: "error",
      path: gprojPath,
      message: `Cannot parse .gproj: ${e instanceof Error ? e.message : String(e)}`,
    });
    return {
      findings,
      summary: { scenarioCount: 0, depCount: 0, hasDevHandlerDir: false },
    };
  }

  const id = stringProp(root, "ID");
  const guid = stringProp(root, "GUID");
  const title = stringProp(root, "TITLE");
  const author = stringProp(root, "AUTHOR");
  const version = stringProp(root, "VERSION");
  const summary = stringProp(root, "SUMMARY");
  const description = stringProp(root, "DESCRIPTION");
  const changeNotes = stringProp(root, "CHANGE_NOTES");
  const preview = stringProp(root, "PREVIEW") ?? stringProp(root, "PREVIEW_IMAGE");

  if (!id) {
    findings.push({
      severity: "error",
      path: "ID",
      message: "Required ID property is missing or empty",
    });
  }
  if (!guid) {
    findings.push({ severity: "error", path: "GUID", message: "Required GUID is missing" });
  } else if (!GUID_RE.test(guid)) {
    findings.push({
      severity: "error",
      path: "GUID",
      message: `GUID must be 16 hex characters (got '${guid}')`,
    });
  }
  if (!title) {
    findings.push({
      severity: "warning",
      path: "TITLE",
      message: "TITLE missing — Workshop will display the addon as untitled",
    });
  } else if (title.length > MAX_TITLE_LEN) {
    findings.push({
      severity: "warning",
      path: "TITLE",
      message: `TITLE is ${title.length} chars (max ${MAX_TITLE_LEN}) — Workshop will truncate`,
    });
  }
  if (!author) {
    findings.push({
      severity: "warning",
      path: "AUTHOR",
      message: "AUTHOR missing — required for Workshop publish",
    });
  }
  if (!version) {
    findings.push({
      severity: "warning",
      path: "VERSION",
      message: "VERSION missing — initial publish defaults to 1.0.0",
    });
  } else if (!VERSION_RE.test(version)) {
    findings.push({
      severity: "warning",
      path: "VERSION",
      message: `VERSION '${version}' isn't a recognized semver-style format (N or N.N or N.N.N or N.N.N.N)`,
    });
  }
  if (summary && summary.length > MAX_SUMMARY_LEN) {
    findings.push({
      severity: "warning",
      path: "SUMMARY",
      message: `SUMMARY is ${summary.length} chars (max ${MAX_SUMMARY_LEN})`,
    });
  }
  if (description && description.length > MAX_DESCRIPTION_LEN) {
    findings.push({
      severity: "warning",
      path: "DESCRIPTION",
      message: `DESCRIPTION is ${description.length} chars (max ${MAX_DESCRIPTION_LEN})`,
    });
  }
  if (changeNotes && changeNotes.length > MAX_CHANGE_NOTES_LEN) {
    findings.push({
      severity: "warning",
      path: "CHANGE_NOTES",
      message: `CHANGE_NOTES is ${changeNotes.length} chars (max ${MAX_CHANGE_NOTES_LEN})`,
    });
  }

  // Preview / screenshots
  const projectRoot = dirname(gprojPath);
  if (preview) {
    const previewPath = resolve(projectRoot, preview);
    if (!existsSync(previewPath)) {
      findings.push({
        severity: "warning",
        path: "PREVIEW",
        message: `Preview path declared but file is missing: ${preview}`,
      });
    } else {
      const size = statSync(previewPath).size;
      if (size > MAX_PREVIEW_BYTES) {
        findings.push({
          severity: "warning",
          path: "PREVIEW",
          message: `Preview is ${formatBytes(size)} (Workshop limit ${formatBytes(MAX_PREVIEW_BYTES)})`,
        });
      }
    }
  }

  // Scenarios
  let scenarioCount = 0;
  const scenarios = findChild(root, "Scenarios");
  if (scenarios) {
    scenarioCount = scenarios.values.length + scenarios.children.length;
  }

  // Dependencies
  let depCount = 0;
  const deps = findChild(root, "Dependencies");
  if (deps) {
    for (const v of deps.values) {
      depCount += 1;
      if (!GUID_RE.test(v)) {
        findings.push({
          severity: "error",
          path: "Dependencies",
          message: `Invalid dependency GUID: ${v}`,
        });
      }
    }
  }

  // Dev-handler leak guard (don't ship EnfusionMCP/ if it accidentally
  // ended up in the project).
  const devHandlerDir = join(projectRoot, "Scripts", "WorkbenchGame", "EnfusionMCP");
  const hasDev = existsSync(devHandlerDir);
  if (hasDev) {
    findings.push({
      severity: "error",
      path: "Scripts/WorkbenchGame/EnfusionMCP/",
      message: "Development handler dir present — exclude from Workshop publish",
      hint: "Remove or .gitignore Scripts/WorkbenchGame/EnfusionMCP/ before -packAddon",
    });
  }

  // Recurse into addons for orphan-screenshot detection (any *.png > 2 MB).
  const screenshotsDir = join(projectRoot, "screenshots");
  if (existsSync(screenshotsDir)) {
    try {
      for (const f of readdirSync(screenshotsDir)) {
        if (!/\.(png|jpg|jpeg)$/i.test(f)) continue;
        const p = join(screenshotsDir, f);
        const size = statSync(p).size;
        if (size > MAX_SCREENSHOT_BYTES) {
          findings.push({
            severity: "warning",
            path: `screenshots/${f}`,
            message: `Screenshot is ${formatBytes(size)} (Workshop limit ${formatBytes(MAX_SCREENSHOT_BYTES)})`,
          });
        }
      }
    } catch {
      /* directory inaccessible — skip */
    }
  }

  return {
    findings,
    summary: {
      id,
      guid,
      title,
      author,
      version,
      scenarioCount,
      depCount,
      hasDevHandlerDir: hasDev,
    },
  };
}

function stringProp(node: EnfusionNode, key: string): string | undefined {
  const p = node.properties.find((pp) => pp.key === key);
  if (!p) return undefined;
  return typeof p.value === "string" && p.value.length > 0 ? p.value : undefined;
}

function findChild(node: EnfusionNode, type: string): EnfusionNode | undefined {
  for (const c of node.children) {
    if (c.type === type) return c;
  }
  return undefined;
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  const kb = b / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

// ── Formatter ────────────────────────────────────────────────────────────────

export function formatManifestReport(input: {
  gprojPath: string;
  findings: ManifestFinding[];
  summary: ManifestSummary;
}): string {
  const { gprojPath, findings, summary } = input;
  const errors = findings.filter((f) => f.severity === "error");
  const warnings = findings.filter((f) => f.severity === "warning");

  const lines: string[] = [];
  lines.push(`## Workshop manifest check: ${basename(gprojPath)}`);
  lines.push("");
  lines.push(
    `${errors.length} error${errors.length !== 1 ? "s" : ""}, ${warnings.length} warning${warnings.length !== 1 ? "s" : ""}.`,
  );
  lines.push("");
  lines.push("### Summary");
  lines.push(`- ID: ${summary.id ?? "(missing)"}`);
  lines.push(`- GUID: ${summary.guid ?? "(missing)"}`);
  lines.push(`- Title: ${summary.title ?? "(missing)"}`);
  lines.push(`- Author: ${summary.author ?? "(missing)"}`);
  lines.push(`- Version: ${summary.version ?? "(missing)"}`);
  lines.push(`- Scenarios: ${summary.scenarioCount}`);
  lines.push(`- Dependencies: ${summary.depCount}`);
  if (summary.hasDevHandlerDir) {
    lines.push(`- ⚠ Scripts/WorkbenchGame/EnfusionMCP/ present (DO NOT publish)`);
  }
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
  if (errors.length === 0 && warnings.length === 0) {
    lines.push("(no findings — manifest is clean and publish-ready)");
  }
  return lines.join("\n");
}

// ── Registration ─────────────────────────────────────────────────────────────

export function registerWorkshopValidateManifest(server: McpServer): void {
  server.registerTool(
    "workshop_validate_manifest",
    {
      description:
        "Pre-flight a `.gproj` against Workshop publish constraints — required fields, length limits, preview/screenshot size caps, dependency well-formedness, and dev-handler leak guard. " +
        "Use BEFORE running `-publishAddon*` to catch the most common reject reasons without burning a CLI cycle.",
      inputSchema: {
        gproj_path: z
          .string()
          .describe("Path to the .gproj file to validate (absolute or repo-relative)"),
      },
    },
    async ({ gproj_path }) => {
      try {
        const fullPath = resolve(gproj_path);
        if (!existsSync(fullPath)) {
          return {
            content: [
              { type: "text" as const, text: `.gproj not found at: ${fullPath}` },
            ],
            isError: true,
          };
        }
        const content = readFileSync(fullPath, "utf-8");
        const { findings, summary } = validateManifest(fullPath, content);
        const report = formatManifestReport({ gprojPath: fullPath, findings, summary });
        return { content: [{ type: "text" as const, text: report }] };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [{ type: "text" as const, text: `Error validating manifest: ${msg}` }],
          isError: true,
        };
      }
    },
  );
}
