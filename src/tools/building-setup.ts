import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { writeFileAtomic } from "../utils/atomic-write.js";
import { backUp } from "../utils/backup.js";
import { resolve, join, relative, sep } from "node:path";
import type { Config } from "../config.js";
import { validateFilename } from "../utils/safe-path.js";
import { assertInsideRoot } from "../utils/path-guard.js";
import { readTextFileBounded } from "../utils/safe-read.js";

// ── Manifest schema ──────────────────────────────────────────────────────────

const PhaseSchema = z.object({
  index: z.number().int().min(1),
  fbx: z.string(),
});

const PartSchema = z.object({
  name: z.string(),
  type: z.string(),
  socket_prefix: z.string(),
  socket_name: z.string(),
  unique: z.boolean(),
  fbx: z.string(),
  phases: z.array(PhaseSchema),
});

export const ManifestSchema = z.object({
  building_name: z.string().min(1),
  export_root: z.string(),
  structure: z.object({
    fbx: z.string(),
    sockets: z.array(z.string()),
  }),
  parts: z.array(PartSchema),
});

export type BuildingManifest = z.infer<typeof ManifestSchema>;
export type BuildingPart = z.infer<typeof PartSchema>;

// ── Prefab generation helpers ────────────────────────────────────────────────

/** Generate a random Enfusion-style GUID (16 hex uppercase). */
export function generateGuid(): string {
  return randomBytes(8).toString("hex").toUpperCase();
}

/** Convert FBX relative path to .xob resource path with mod prefix. */
export function fbxToXob(fbxPath: string, modPrefix: string): string {
  const xob = fbxPath.replace(/\.fbx$/i, ".xob");
  return `${modPrefix}${xob}`;
}

/** Format a prefab resource path with a GUID prefix: {GUID}path */
export function guidPrefabPath(relativePath: string): string {
  return `{${generateGuid()}}${relativePath}`;
}

// Property names below follow vanilla prefabs in the game paks:
//   SCR_DamagePhaseData { m_PhaseModel } — Prefabs/Props/Agriculture/Beehive_01/Beehive_01_stack.et
//   BaseSlotComponent { AttachType EntitySlotInfo { PivotID } EntityPrefab }
//     — Prefabs/Structures/Airport/ControlTower_01/ControlTower_01.et
//   SlotBoneMappings { SlotBoneMappingObject { BonePrefix Prefab } } on the entity,
//     not in components — Prefabs/Structures/Agriculture/Barn/Barn_E_01/Barn_E_01_Base.et
// m_fPhaseHealth is not written: vanilla values are absolute hit points (300-10000),
// and the manifest carries no health figure to put there.
export function generateDestructionComponent(part: BuildingPart, modPrefix: string): string {
  if (part.phases.length === 0) return "";

  const phaseEntries = part.phases.map((phase) => {
    const xob = fbxToXob(phase.fbx, modPrefix);
    const guid = generateGuid();
    return `  SCR_DamagePhaseData "{${guid}}" {
   m_PhaseModel "${xob}"
  }`;
  });

  return `SCR_DestructionMultiPhaseComponent {
 m_aDamagePhases {
${phaseEntries.join("\n")}
 }
}`;
}

export function generateSlotBoneMappingObject(part: BuildingPart, partPrefabPath: string): string {
  return `SlotBoneMappingObject "{${generateGuid()}}" {
 BonePrefix "${part.socket_prefix}"
 Prefab "${partPrefabPath}"
}`;
}

export function generateBaseSlotComponent(part: BuildingPart, partPrefabPath: string): string {
  return `BaseSlotComponent "{${generateGuid()}}" {
 AttachType EntitySlotInfo "{${generateGuid()}}" {
  PivotID "${part.socket_name}"
 }
 EntityPrefab "${partPrefabPath}"
}`;
}

export function generatePartPrefab(part: BuildingPart, modPrefix: string): string {
  const xob = fbxToXob(part.fbx, modPrefix);
  const destructionComp = generateDestructionComponent(part, modPrefix);

  let components = `MeshObject {
  Object "${xob}"
 }`;

  if (destructionComp) {
    components += `\n ${destructionComp}`;
  }

  return `GenericEntity {
 components {
  ${components}
 }
}`;
}

export function generateBuildingPrefab(
  manifest: BuildingManifest,
  parts: BuildingPart[],
  modPrefix: string,
  partPrefabPaths: Map<string, string>,
): string {
  const slotComponents: string[] = [];
  const boneMappings: string[] = [];

  for (const part of parts) {
    const prefabPath = partPrefabPaths.get(part.name) || "";
    if (part.unique) {
      slotComponents.push(indent(generateBaseSlotComponent(part, prefabPath), "  "));
    } else {
      boneMappings.push(indent(generateSlotBoneMappingObject(part, prefabPath), "  "));
    }
  }

  const xob = fbxToXob(manifest.structure.fbx, modPrefix);
  const mappingBlock =
    boneMappings.length > 0 ? `\n SlotBoneMappings {\n${boneMappings.join("\n")}\n }` : "";

  return `SCR_DestructibleBuildingEntity : "{B6D7B585448658F5}Prefabs/Structures/BuildingParts/Building_Base.et" {
 components {
  MeshObject {
   Object "${xob}"
  }
  SCR_DestructibleBuildingComponent {
  }${slotComponents.length > 0 ? "\n" + slotComponents.join("\n") : ""}
 }${mappingBlock}
}`;
}

/** Prefix every line of a block with `pad`. */
function indent(block: string, pad: string): string {
  return block
    .split("\n")
    .map((l) => pad + l)
    .join("\n");
}

/**
 * Writes `content` to `file` (write-then-rename) unless `dryRun`. An existing file is copied to its
 * first free backup name first (src/utils/backup.ts, the rule of the other offline writers that
 * replace a file, DEC-099), so a rerun or an outputDir holding a prefab of the same name never
 * loses it (offline-writers-06). Returns the note for the report, or null for a new file.
 */
export function writeReplacing(file: string, content: string, dryRun: boolean): string | null {
  const existed = existsSync(file);
  if (dryRun) return existed ? `  exists: would be replaced, a backup kept (${file})` : null;
  const backup = existed
    ? backUp(file, (m) => {
        throw new Error(m);
      })
    : null;
  writeFileAtomic(file, content);
  return backup ? `  replaced an existing file; backup: ${backup}` : null;
}

// ── Tool registration ────────────────────────────────────────────────────────

export function registerBuildingSetup(server: McpServer, config: Config): void {
  server.registerTool(
    "building_setup",
    {
      description:
        "Set up an Arma Reforger destructible building from a Blender export manifest.\n\n" +
        "Reads a building_manifest.json (exported by bk_building_tools Blender plugin), " +
        "then creates the building structure prefab with slot wiring (SlotBoneMappingObject / BaseSlotComponent) " +
        "and individual part prefabs with SCR_DestructionMultiPhaseComponent for each destruction phase.\n\n" +
        "The manifest contains: building name, socket list, part definitions with FBX paths and destruction phases.",
      inputSchema: {
        manifestPath: z
          .string()
          .describe("Absolute path to the building_manifest.json file exported from Blender"),
        modPrefix: z
          .string()
          .default("")
          .describe(
            "Mod resource prefix path (e.g., 'MyMod/Assets/Buildings/'). Prepended to FBX-derived .xob paths.",
          ),
        outputDir: z
          .string()
          .optional()
          .describe(
            "Output directory for generated .et prefab files. Defaults to mod prefabs directory from config.",
          ),
        dryRun: z
          .boolean()
          .default(false)
          .describe("If true, return what would be created without writing files"),
      },
    },
    async ({ manifestPath, modPrefix, outputDir, dryRun }) => {
      // Read and parse manifest
      let rawManifest: string;
      try {
        rawManifest = readTextFileBounded(manifestPath);
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error reading manifest: ${err}` }],
          isError: true,
        };
      }

      let manifest: BuildingManifest;
      try {
        manifest = ManifestSchema.parse(JSON.parse(rawManifest));
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Invalid manifest: ${err}` }],
          isError: true,
        };
      }

      // H7: manifest-derived names become path segments — reject `..`,
      // separators and reserved names before they touch the filesystem.
      try {
        validateFilename(manifest.building_name);
        for (const part of manifest.parts) validateFilename(part.name);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text" as const,
              text: `Invalid manifest: building_name / part.name must be plain filenames — ${msg}`,
            },
          ],
          isError: true,
        };
      }

      const outDir = outputDir
        ? resolve(outputDir)
        : resolve(config.projectPath, "Prefabs", "Structures", manifest.building_name);

      // H7 containment: the output directory (LLM-supplied or derived) must
      // stay inside the configured project root.
      try {
        assertInsideRoot(outDir, config.projectPath, "outputDir");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true };
      }

      const lines: string[] = [];
      lines.push(`=== Building Setup: ${manifest.building_name} ===`);
      lines.push(`Parts: ${manifest.parts.length}`);
      lines.push(`Sockets: ${manifest.structure.sockets.length}`);
      lines.push(`Output: ${outDir}`);
      lines.push("");

      const partPrefabPaths = new Map<string, string>();
      const createdFiles: string[] = [];

      // Create part prefabs
      for (const part of manifest.parts) {
        const partDir = join(outDir, "Parts");
        const partFile = `${part.name}.et`;
        const partPath = join(partDir, partFile);
        const partContent = generatePartPrefab(part, modPrefix);

        // Store GUID-prefixed prefab path for slot wiring: where the part is written, relative
        // to the project root (outDir is contained in it), so an outputDir is honoured (offline-writers-07).
        const relativePath = relative(resolve(config.projectPath), partPath).split(sep).join("/");
        partPrefabPaths.set(part.name, guidPrefabPath(relativePath));

        const slotType = part.unique ? "BaseSlotComponent" : "SlotBoneMappingObject";
        const phaseInfo =
          part.phases.length > 0 ? ` (${part.phases.length} destruction phases)` : "";

        lines.push(`[Part] ${part.name} -> ${slotType}${phaseInfo}`);

        if (!dryRun) mkdirSync(partDir, { recursive: true });
        // A rerun replaces the parts, so write-then-rename (write-safety gap 20).
        const partNote = writeReplacing(partPath, partContent, dryRun);
        if (partNote) lines.push(partNote);
        if (!dryRun) createdFiles.push(partPath);
      }

      // Create building structure prefab
      const buildingContent = generateBuildingPrefab(
        manifest,
        manifest.parts,
        modPrefix,
        partPrefabPaths,
      );
      const buildingPath = join(outDir, `${manifest.building_name}.et`);

      lines.push("");
      lines.push(`[Building] ${manifest.building_name}.et`);

      if (!dryRun) mkdirSync(outDir, { recursive: true });
      const buildingNote = writeReplacing(buildingPath, buildingContent, dryRun);
      if (buildingNote) lines.push(buildingNote);
      if (!dryRun) createdFiles.push(buildingPath);

      lines.push("");
      if (dryRun) {
        lines.push("(dry run -- no files written)");
      } else {
        lines.push(`Created ${createdFiles.length} prefab files.`);
      }

      lines.push("");
      lines.push("=== Post-Creation Checklist ===");
      lines.push("- [ ] Import FBX files into Workbench (Resource Browser)");
      lines.push("- [ ] Verify .xob paths in MeshObject components match imported assets");
      lines.push("- [ ] Check slot bone prefixes match socket names in the FBX skeleton");
      lines.push("- [ ] Test destruction phases in World Editor (damage entity to cycle phases)");
      lines.push("- [ ] Add FireGeo/collision components if not inherited from Building_Base");

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    },
  );
}
