/**
 * `material_inspect` — read-only summary of an Enfusion `.emat` material file.
 *
 * Parses the material's text-container body and surfaces:
 *   - Shader class (root node type, e.g. `MaterialPBR`).
 *   - Texture references — each `Key "{GUID}path/to/foo.edds"`-shaped property
 *     value, resolved via the project-index when the GUID is indexed so the
 *     caller sees both the slot name and the resolved file path.
 *   - Tunable parameters — every remaining scalar property at the material
 *     root (colour tints, roughness, UV scales, etc).
 *
 * Pure filesystem read + project-index lookups. No DB writes.
 *
 * Constructor takes an optional `Config` so repo-relative material paths can
 * be resolved against `config.projectPath` (same pattern as `scenario-inspect`).
 * Absolute paths are accepted verbatim.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFileSync, existsSync } from "node:fs";
import { isAbsolute, resolve, basename } from "node:path";
import { z } from "zod";
import type { Config } from "../config.js";
import { parse, type EnfusionNode } from "../formats/enfusion-text.js";
import { ProjectIndex } from "../project-index/project-index.js";

// ── Types ────────────────────────────────────────────────────────────────────

/** One texture-slot reference extracted from a material. */
export interface TextureRef {
  /** Property key — typically `Texture0`, `BaseTex`, `NormalMap`, etc. */
  key: string;
  /** GUID portion of the ref (16 uppercase hex chars), null when absent. */
  guid: string | null;
  /** Path suffix from the ref string — typically a `.edds` asset path. */
  path: string;
  /** Resolved indexed file path when the GUID is known to the project-index. */
  resolvedFilePath: string | null;
}

/** A scalar tunable parameter at the material root. */
export interface MaterialParam {
  key: string;
  value: string;
}

/** Structured summary of a parsed `.emat`. Pure data — no I/O concerns. */
export interface MaterialSummary {
  shaderClass: string;
  className?: string;
  textures: TextureRef[];
  parameters: MaterialParam[];
}

/** `{16-hex}<path?>`-shaped property values. */
const GUID_REF_RE = /^\{([0-9A-Fa-f]{16})\}(.*)$/;

/**
 * Heuristic: a property is a texture slot when its string value either
 *   a) embeds a GUID followed by a `.edds` suffix, OR
 *   b) ends in `.edds` (rare — older materials with bare paths).
 * Anything else (numbers, enums, colour vectors) flows into `parameters`.
 */
function looksLikeTextureValue(value: string): boolean {
  const m = GUID_REF_RE.exec(value);
  if (m) {
    const suffix = m[2];
    if (suffix.toLowerCase().endsWith(".edds")) return true;
    // Some materials reference .emat / sub-materials — those aren't textures.
    if (suffix.toLowerCase().endsWith(".emat")) return false;
    // Bare GUID with no suffix is ambiguous — treat as non-texture so it
    // surfaces in parameters where the caller can see it raw.
    return false;
  }
  return value.toLowerCase().endsWith(".edds");
}

// ── Extraction ───────────────────────────────────────────────────────────────

/**
 * Pure summary extraction from a parsed `.emat` root.
 *
 * Texture refs and parameters are collected ONLY from string-valued root
 * properties — nested sub-nodes (Samplers, RenderState blocks) are
 * intentionally skipped to keep the summary scannable. Inheritance, when
 * present, is reported as a synthetic parameter `:inheritance` so a parent
 * material is visible without expanding the report shape.
 */
export function extractMaterialSummary(
  root: EnfusionNode,
  resolver?: (guid: string) => string | null,
): MaterialSummary {
  const textures: TextureRef[] = [];
  const parameters: MaterialParam[] = [];

  for (const prop of root.properties) {
    if (typeof prop.value !== "string") continue;

    if (looksLikeTextureValue(prop.value)) {
      const m = GUID_REF_RE.exec(prop.value);
      const guid = m ? m[1].toUpperCase() : null;
      const path = m ? m[2] : prop.value;
      const resolvedFilePath = guid && resolver ? resolver(guid) : null;
      textures.push({ key: prop.key, guid, path, resolvedFilePath });
    } else {
      parameters.push({ key: prop.key, value: prop.value });
    }
  }

  if (root.inheritance) {
    parameters.unshift({ key: ":inheritance", value: root.inheritance });
  }

  return {
    shaderClass: root.type,
    className: root.className,
    textures,
    parameters,
  };
}

// ── Formatter ────────────────────────────────────────────────────────────────

/** Render a `MaterialSummary` as the markdown contract the tool documents. */
export function formatMaterialSummary(
  summary: MaterialSummary,
  filename: string,
): string {
  const lines: string[] = [];
  const cls = summary.className ? `${summary.shaderClass} [${summary.className}]` : summary.shaderClass;
  lines.push(`## Material: ${filename}`);
  lines.push("");
  lines.push(`- **Shader class**: ${cls}`);
  lines.push(`- **Texture refs**: ${summary.textures.length}`);
  lines.push(`- **Parameters**: ${summary.parameters.length}`);

  lines.push("");
  lines.push("### Textures");
  if (summary.textures.length === 0) {
    lines.push("  (none)");
  } else {
    for (const t of summary.textures) {
      const guidPart = t.guid ? `{${t.guid}}` : "(no GUID)";
      const resolved = t.resolvedFilePath ? ` — resolved: ${t.resolvedFilePath}` : "";
      lines.push(`  - ${t.key}: ${guidPart}${t.path}${resolved}`);
    }
  }

  lines.push("");
  lines.push("### Parameters");
  if (summary.parameters.length === 0) {
    lines.push("  (none)");
  } else {
    for (const p of summary.parameters) {
      lines.push(`  - ${p.key}: "${p.value}"`);
    }
  }

  return lines.join("\n");
}

// ── Path resolution ──────────────────────────────────────────────────────────

function resolveMaterialPath(materialPath: string, projectPath: string | undefined): string {
  if (isAbsolute(materialPath)) return materialPath;
  if (!projectPath) {
    throw new Error(
      "material_path is relative but no project path is configured. " +
        "Provide an absolute path or set ENFUSION_PROJECT_PATH.",
    );
  }
  return resolve(projectPath, materialPath);
}

// ── Registration ─────────────────────────────────────────────────────────────

export function registerMaterialInspect(
  server: McpServer,
  index: ProjectIndex,
  config?: Config,
): void {
  server.registerTool(
    "material_inspect",
    {
      description:
        "Read-only inspector for an Enfusion `.emat` material file. " +
        "Parses the material root and reports the shader class, every texture slot (with GUID + path + resolved index entry when known), " +
        "and the remaining tunable parameters at the root. " +
        "Use this to audit a single material before swapping textures, or to see what a base material exposes for tuning. " +
        "Pure filesystem read + project-index lookups — no DB writes.",
      inputSchema: {
        material_path: z
          .string()
          .min(1)
          .describe(
            "Path to the `.emat` file. Absolute path, or repo-relative path resolved against the configured project path " +
              "(e.g., 'Materials/MyMat.emat').",
          ),
      },
    },
    async ({ material_path }) => {
      try {
        // Audit-fix L4 SEC-002: flag-smuggle guard on raw user input.
        if (material_path.startsWith("-")) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Invalid material_path: must not start with '-' (got: ${material_path})`,
              },
            ],
            isError: true,
          };
        }
        const fullPath = resolveMaterialPath(material_path, config?.projectPath);
        if (!existsSync(fullPath)) {
          return {
            content: [{ type: "text" as const, text: `Material file not found: ${fullPath}` }],
            isError: true,
          };
        }

        const content = readFileSync(fullPath, "utf-8");
        const root = parse(content);
        const resolver = (guid: string): string | null => {
          const row = index.resolveGuid(guid);
          return row?.file_path ?? null;
        };
        const summary = extractMaterialSummary(root, resolver);
        const text = formatMaterialSummary(summary, basename(fullPath));
        return { content: [{ type: "text" as const, text }] };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [{ type: "text" as const, text: `Error inspecting material: ${msg}` }],
          isError: true,
        };
      }
    },
  );
}
