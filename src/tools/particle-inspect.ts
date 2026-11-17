/**
 * `particle_inspect` — summarize a .ptc particle effect file.
 *
 * Since W5 (DEC-068 OD-1) the registered tool is an alias of `particle inspect`
 * (src/tools/particle.ts); the extraction below is the 1.x reader, kept for its tests and
 * for the corpus scoreboard (tests/corpus/readers.corpus.test.ts).
 *
 * Schema (derived from the vanilla corpus: 436 .ptc files, 2393 emitters, all
 * of which parse with `formats/enfusion-text`). EffectDef was seen as the
 * container class in a live dump (census evidence EV-S-E-003); EmitterDef is
 * file-schema only (census E10), not verified against the engine. Neither is
 * in data/api:
 *
 *   EffectDef {
 *     Version 2
 *     <effect-level keys: LightRadius, LightClipEV, LightOffset, MinFPS,
 *      CastShadow, CollisionPreset, WorldRelativeY>
 *     Emitters {
 *       EmitterDef <name> {
 *         <scalar keys: ShapeType, ShapeSize, MaxNum, BirthRate, Lifetime,
 *          EmittingTime, Repeat, LodMin, LodMax, SizeMultiplier, Velocity,
 *          ParticleType, BillboardingType, ...>
 *         Material "{GUID}Particles/_Materials/....emat"   (optional: 2312 of 2393 emitters)
 *         Prefab "{GUID}Prefabs/....et"                    (optional: 362 refs; usually with ParticleType Prefab, 22 have it without)
 *         <curve blocks: Color, Alpha, Size, RotationSpeed, Emissivity and the
 *          *Mast curves, each a bare run of numbers>
 *       }
 *     }
 *   }
 *
 * The parser reads a curve's numbers as one property (first number = key, the
 * rest = value), so a curve is re-counted here. Colour curves (`Color`,
 * `ColorMast`, `LightColorMast`) are `time r g b` tuples (stride 4), every
 * other curve is `time value` pairs (stride 2); both held for all 2393
 * emitters of the corpus.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { EnfusionNode } from "../formats/enfusion-text.js";
import { loadConfig, type Config } from "../config.js";
import { routeAlias } from "../manifest/aliases.js";
import { LIMIT_MAX, VocabularyError, errorResponse } from "../manifest/vocabulary.js";
import type { ProjectIndex } from "../project-index/project-index.js";
import { runParticle } from "./particle.js";

// ── Extracted shape (exported for tests) ─────────────────────────────────────

export interface TextureRef {
  /** Property key the ref was found under (e.g., "Material"). */
  key: string;
  /** Raw `{GUID}path` value, exactly as it appears in the file. */
  raw: string;
  /** 16-hex GUID extracted from the ref, uppercase. */
  guid: string;
  /** Path suffix after the GUID, when present. */
  path: string;
}

export interface CurveSummary {
  /** Block name as it appears in the file (e.g., "Alpha", "ColorMast"). */
  type: string;
  /** Point count: `time value` pairs, or `time r g b` tuples for colour curves. */
  keyCount: number;
}

export interface GradientSummary extends CurveSummary {
  /** Same as keyCount, kept under the old name. */
  stopCount: number;
}

export interface EmitterSummary {
  /** Node type: "EmitterDef". */
  type: string;
  /** Emitter name (the token after `EmitterDef`). */
  id?: string;
  /** Key scalar parameters present on the emitter, raw strings. */
  params: Record<string, string>;
  /** The emitter's Material ref (`{GUID}path`). */
  textures: TextureRef[];
  /** `Prefab` ref, whatever the emitter's ParticleType says. */
  prefab?: TextureRef;
  /** Curve blocks of this emitter. */
  curves: CurveSummary[];
}

export interface ParticleSummary {
  rootType: string;
  version?: string;
  /** Effect-level keys (light and collision settings). */
  effectParams: Record<string, string>;
  emitters: EmitterSummary[];
  /** All emitter curves other than colour curves. */
  curves: CurveSummary[];
  /** All colour curves (`Color`, `ColorMast`, `LightColorMast`). */
  gradients: GradientSummary[];
}

// ── Extraction (pure, exported for tests) ────────────────────────────────────

const GUID_REF_RE = /^\{([0-9A-Fa-f]{16})\}(.*)$/;
const COLOR_CURVES = new Set(["Color", "ColorMast", "LightColorMast"]);
const EMITTER_PARAMS = new Set([
  "ParticleType",
  "ShapeType",
  "ShapeSize",
  "MaxNum",
  "BirthRate",
  "Lifetime",
  "EmittingTime",
  "Repeat",
  "LodMin",
  "LodMax",
  "SizeMultiplier",
  "Velocity",
  "BillboardingType",
  "EnableCollisions",
  "EnableLight",
]);

function parseRef(key: string, value: string): TextureRef | null {
  const m = GUID_REF_RE.exec(value);
  if (!m) return null;
  return { key, raw: value, guid: m[1].toUpperCase(), path: m[2] };
}

/** Points in a curve block (the parser splits the first number off as a key). */
function curveKeyCount(node: EnfusionNode): number {
  let n = 0;
  for (const p of node.properties) {
    n += 1 + (typeof p.value === "string" ? p.value.split(/\s+/).filter(Boolean).length : 0);
  }
  return Math.floor(n / (COLOR_CURVES.has(node.type) ? 4 : 2));
}

function emitterOf(node: EnfusionNode): EmitterSummary {
  const params: Record<string, string> = {};
  const textures: TextureRef[] = [];
  let prefab: TextureRef | undefined;
  for (const prop of node.properties) {
    if (typeof prop.value !== "string") continue;
    if (prop.key === "Prefab") {
      prefab = parseRef(prop.key, prop.value) ?? undefined;
    } else if (prop.key === "Material") {
      const ref = parseRef(prop.key, prop.value);
      if (ref) textures.push(ref);
    } else if (EMITTER_PARAMS.has(prop.key)) {
      params[prop.key] = prop.value;
    }
  }
  const curves = node.children.map((c) => ({ type: c.type, keyCount: curveKeyCount(c) }));
  return { type: node.type, id: node.id, params, textures, prefab, curves };
}

export function extractParticleSummary(root: EnfusionNode): ParticleSummary {
  const emitters: EmitterSummary[] = [];
  const curves: CurveSummary[] = [];
  const gradients: GradientSummary[] = [];
  const effectParams: Record<string, string> = {};
  let version: string | undefined;

  for (const prop of root.properties) {
    if (typeof prop.value !== "string") continue;
    if (prop.key === "Version") version = prop.value;
    else effectParams[prop.key] = prop.value;
  }
  for (const block of root.children) {
    if (block.type !== "Emitters") continue;
    for (const child of block.children) {
      if (child.type !== "EmitterDef") continue;
      const e = emitterOf(child);
      emitters.push(e);
      for (const c of e.curves) {
        if (COLOR_CURVES.has(c.type)) gradients.push({ ...c, stopCount: c.keyCount });
        else curves.push(c);
      }
    }
  }
  return { rootType: root.type, version, effectParams, emitters, curves, gradients };
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
  if (summary.version) lines.push(`- **Version:** ${summary.version}`);
  lines.push(`- **Emitters:** ${summary.emitters.length}`);
  lines.push(`- **Curves:** ${summary.curves.length}`);
  lines.push(`- **Gradients:** ${summary.gradients.length}`);
  for (const [k, v] of Object.entries(summary.effectParams)) lines.push(`- **${k}:** ${v}`);

  const refLine = (t: TextureRef): string => {
    const resolvedPath = resolveGuid(t.guid);
    const resolution = resolvedPath ? ` → ${resolvedPath}` : " (unresolved)";
    return `- **${t.key}:** {${t.guid}}${t.path}${resolution}`;
  };

  if (summary.emitters.length > 0) {
    lines.push("");
    lines.push("## Emitters");
    for (let i = 0; i < summary.emitters.length; i++) {
      const e = summary.emitters[i];
      lines.push(`### ${i + 1}. ${e.type}${e.id ? ` ${e.id}` : ""}`);
      for (const [k, v] of Object.entries(e.params)) lines.push(`- ${k}: ${v}`);
      if (e.textures.length === 0 && !e.prefab) lines.push("- (no material refs)");
      for (const t of e.textures) lines.push(refLine(t));
      if (e.prefab) lines.push(refLine(e.prefab));
      if (e.curves.length > 0) {
        lines.push(`- curves: ${e.curves.map((c) => `${c.type}(${c.keyCount})`).join(", ")}`);
      }
    }
  }

  return lines.join("\n");
}

// ── Registration ─────────────────────────────────────────────────────────────

/**
 * `particle_inspect` is an alias of `particle inspect` (W5 OD-1, DEC-068): it reads through the
 * lossless parser, takes game (pak) paths as well, and answers the same JSON. It keeps the 1.x
 * parameter `particle_path`, which may still be any absolute .ptc on disk (reads only). The
 * extraction helpers above stay for the 1.x reader tests and the corpus scoreboard.
 */
export function registerParticleInspect(
  server: McpServer,
  _index?: ProjectIndex,
  config?: Config,
): void {
  server.registerTool(
    "particle_inspect",
    {
      description:
        "Alias of particle inspect. Summarize a .ptc particle effect (EffectDef > Emitters > EmitterDef): per emitter its name, shape, rates, lifetime, LOD range, material and prefab, and its curve blocks, plus the effect-level keys. " +
        "Takes an absolute path, a project path or a game path; the other particle actions are on the particle tool.",
      inputSchema: {
        particle_path: z
          .string()
          .describe(
            "The .ptc: absolute path, project-relative path or game path. Must not start with '-'.",
          ),
        cursor: z.string().optional().describe("Cursor from the last page of emitters."),
        limit: z.number().int().min(1).max(LIMIT_MAX).optional().describe("Emitters per page."),
      },
    },
    async ({ particle_path, cursor, limit }) => {
      let cfg: Config;
      try {
        cfg = config ?? loadConfig();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [{ type: "text" as const, text: `Error inspecting particle: ${msg}` }],
          isError: true,
        };
      }
      let routed;
      try {
        // aliases.ts maps particle_path to path; allowDisk keeps the 1.x absolute-path read.
        routed = routeAlias("particle_inspect", { particle_path, cursor, limit });
        if (!routed) throw new Error("particle_inspect alias is not routed");
      } catch (e) {
        if (!(e instanceof VocabularyError)) throw e;
        const err = errorResponse("inspect", particle_path, e.code, e.message);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(err, null, 2) }],
          isError: true,
        };
      }
      const r = runParticle(routed.args as unknown as Parameters<typeof runParticle>[0], cfg, {
        allowDisk: true,
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(r, null, 2) }],
        isError: !r.ok,
      };
    },
  );
}
