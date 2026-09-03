/**
 * `particle_inspect` — summarize a .ptc particle effect file.
 *
 * UNVERIFIED FORMAT NOTE: .ptc files were added to SCANNABLE_EXTENSIONS in
 * L4-1 on the assumption they use the same Enfusion text-container grammar as
 * .emat / .layout / .ent. At the time this tool was written, no .ptc file was
 * available on disk (vanilla .ptc files live inside `addons/core/data.pak`
 * and the user project tree had none). The shape rendered below — emitter
 * children, curve/gradient nested nodes, texture refs as `{GUID}path` property
 * values — is the best-guess structure based on Enfusion's text-container
 * conventions. If a real .ptc shows different keys/nesting, refine the
 * extractors without changing the public formatter shape.
 *
 * What we extract (best-effort):
 *   - Emitter count (children of root whose type contains "Emitter").
 *   - Curve summaries (children with type containing "Curve" — count keys).
 *   - Gradient summaries (children with type containing "Gradient" — count stops).
 *   - Texture refs on each emitter (string properties whose value is a
 *     `{GUID}path.ext` reference; resolved through ProjectIndex when possible).
 *
 * Failure mode: if `parse()` throws, we surface a clear error asking the
 * user to share file content so the format can be verified. The L1 index
 * already accepts .ptc as scannable, so unparseable files would have shown
 * up there first — but this tool gives a friendlier message for direct calls.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { parse, type EnfusionNode } from "../formats/enfusion-text.js";
import type { ProjectIndex } from "../project-index/project-index.js";

// ── Extracted shape (exported for tests) ─────────────────────────────────────

export interface TextureRef {
  /** Property key the ref was found under (e.g., "Texture", "m_Texture"). */
  key: string;
  /** Raw `{GUID}path` value, exactly as it appears in the file. */
  raw: string;
  /** 16-hex GUID extracted from the ref, uppercase. */
  guid: string;
  /** Path suffix after the GUID, when present. */
  path: string;
}

export interface EmitterSummary {
  /** Node type as it appears in the .ptc (e.g., "Emitter", "ParticleEmitter"). */
  type: string;
  /** Node id when present (a Workbench-assigned instance GUID, usually). */
  id?: string;
  /** Texture references found on this emitter and its descendants. */
  textures: TextureRef[];
}

export interface CurveSummary {
  type: string;
  /** Keys / control-point count when the node exposes a `Keys` or `Values` block. */
  keyCount: number;
}

export interface GradientSummary {
  type: string;
  /** Stop count when the node exposes a `Stops` or `Colors` block. */
  stopCount: number;
}

export interface ParticleSummary {
  rootType: string;
  emitters: EmitterSummary[];
  curves: CurveSummary[];
  gradients: GradientSummary[];
}

// ── Extraction (pure, exported for tests) ────────────────────────────────────

const GUID_REF_RE = /^\{([0-9A-Fa-f]{16})\}(.*)$/;

function asNode(val: string | EnfusionNode): EnfusionNode | null {
  return typeof val === "string" ? null : val;
}

/** Collect texture-like refs from a node tree (DFS). Heuristic: any string
 *  property value matching `{GUID}path` with a texture-ish extension counts. */
function collectTextures(node: EnfusionNode, out: TextureRef[]): void {
  for (const prop of node.properties) {
    if (typeof prop.value !== "string") {
      const child = asNode(prop.value);
      if (child) collectTextures(child, out);
      continue;
    }
    const m = GUID_REF_RE.exec(prop.value);
    if (!m) continue;
    const path = m[2];
    // Texture-ish: anything that looks like an image asset OR a key whose
    // name contains "texture" / "tex" (case-insensitive). Keep this loose;
    // the extractor is heuristic, not authoritative.
    const looksLikeTexture =
      /\.(edds|png|tga|dds|exr)(?:$|[?#])/i.test(path) ||
      /tex(ture)?|albedo|normal|emissive|mask/i.test(prop.key);
    if (looksLikeTexture) {
      out.push({
        key: prop.key,
        raw: prop.value,
        guid: m[1].toUpperCase(),
        path,
      });
    }
  }
  for (const child of node.children) {
    collectTextures(child, out);
  }
}

/** Count items inside a node's first matching nested block (Keys/Values/Stops/Colors). */
function countContainerItems(node: EnfusionNode, keys: string[]): number {
  for (const key of keys) {
    const child = node.children.find((c) => c.type === key);
    if (child) {
      return child.values.length + child.children.length;
    }
    const prop = node.properties.find((p) => p.key === key);
    if (prop && typeof prop.value !== "string") {
      const sub = prop.value;
      return sub.values.length + sub.children.length;
    }
  }
  return 0;
}

export function extractParticleSummary(root: EnfusionNode): ParticleSummary {
  const emitters: EmitterSummary[] = [];
  const curves: CurveSummary[] = [];
  const gradients: GradientSummary[] = [];

  for (const child of root.children) {
    if (/emitter/i.test(child.type)) {
      const textures: TextureRef[] = [];
      collectTextures(child, textures);
      emitters.push({ type: child.type, id: child.id, textures });
    } else if (/curve/i.test(child.type)) {
      curves.push({
        type: child.type,
        keyCount: countContainerItems(child, ["Keys", "Values", "Points"]),
      });
    } else if (/gradient/i.test(child.type)) {
      gradients.push({
        type: child.type,
        stopCount: countContainerItems(child, ["Stops", "Colors", "Keys"]),
      });
    }
  }

  return { rootType: root.type, emitters, curves, gradients };
}

// ── Formatter (exported for tests) ───────────────────────────────────────────

export function formatParticleSummary(
  summary: ParticleSummary,
  resolveGuid: (guid: string) => string | null,
  filePath: string,
): string {
  const lines: string[] = [];
  lines.push(`# Particle: ${filePath}`);
  lines.push("");
  lines.push(`- **Root type:** ${summary.rootType}`);
  lines.push(`- **Emitters:** ${summary.emitters.length}`);
  lines.push(`- **Curves:** ${summary.curves.length}`);
  lines.push(`- **Gradients:** ${summary.gradients.length}`);

  if (summary.curves.length > 0) {
    lines.push("");
    lines.push("## Curves");
    for (const c of summary.curves) {
      lines.push(`- ${c.type} — ${c.keyCount} keys`);
    }
  }
  if (summary.gradients.length > 0) {
    lines.push("");
    lines.push("## Gradients");
    for (const g of summary.gradients) {
      lines.push(`- ${g.type} — ${g.stopCount} stops`);
    }
  }

  if (summary.emitters.length > 0) {
    lines.push("");
    lines.push("## Emitters");
    for (let i = 0; i < summary.emitters.length; i++) {
      const e = summary.emitters[i];
      const idSuffix = e.id ? ` {${e.id}}` : "";
      lines.push(`### ${i + 1}. ${e.type}${idSuffix}`);
      if (e.textures.length === 0) {
        lines.push("- (no texture refs detected)");
      } else {
        for (const t of e.textures) {
          const resolvedPath = resolveGuid(t.guid);
          const resolution = resolvedPath
            ? ` → ${resolvedPath}`
            : " (unresolved)";
          lines.push(`- **${t.key}:** {${t.guid}}${t.path}${resolution}`);
        }
      }
    }
  }

  return lines.join("\n");
}

// ── Registration ─────────────────────────────────────────────────────────────

export function registerParticleInspect(
  server: McpServer,
  index: ProjectIndex,
): void {
  server.registerTool(
    "particle_inspect",
    {
      description:
        "Summarize a .ptc particle effect file: emitter count, curves, gradients, and per-emitter texture refs (GUID-resolved via the project-index when possible). " +
        "Useful for auditing FX assets before publish, or comparing particle setups between mods. " +
        "Note: the .ptc text-container shape is presumed (same grammar as .emat/.ent) — surfaces a clear error if a file fails to parse so you can share content for format verification.",
      inputSchema: {
        particle_path: z
          .string()
          .describe(
            "Absolute path to a .ptc file. Must not start with '-' (rejected for flag-smuggle safety).",
          ),
      },
    },
    async ({ particle_path }) => {
      try {
        if (particle_path.startsWith("-")) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error inspecting particle: paths starting with '-' are rejected for safety",
              },
            ],
            isError: true,
          };
        }

        let content: string;
        try {
          content = readFileSync(particle_path, "utf-8");
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return {
            content: [
              {
                type: "text" as const,
                text: `Error inspecting particle: cannot read file: ${msg}`,
              },
            ],
            isError: true,
          };
        }

        let root: EnfusionNode;
        try {
          root = parse(content);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return {
            content: [
              {
                type: "text" as const,
                text:
                  "Error inspecting particle: this .ptc format is unverified — please share the file content so the parser can be adjusted. " +
                  `Parse error: ${msg}`,
              },
            ],
            isError: true,
          };
        }

        const summary = extractParticleSummary(root);
        const text = formatParticleSummary(
          summary,
          (guid) => {
            const row = index.resolveGuid(guid);
            return row ? row.file_path : null;
          },
          particle_path,
        );
        return { content: [{ type: "text" as const, text }] };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [
            { type: "text" as const, text: `Error inspecting particle: ${msg}` },
          ],
          isError: true,
        };
      }
    },
  );
}
