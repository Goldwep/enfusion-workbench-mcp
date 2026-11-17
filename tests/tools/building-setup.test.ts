import { describe, it, expect } from "vitest";
import {
  fbxToXob,
  generateDestructionComponent,
  generateSlotBoneMappingObject,
  generateBaseSlotComponent,
  generatePartPrefab,
  generateBuildingPrefab,
  guidPrefabPath,
  ManifestSchema,
  type BuildingManifest,
  type BuildingPart,
} from "../../src/tools/building-setup.js";
import { parse } from "../../src/formats/enfusion-text.js";

// ── Test helpers ─────────────────────────────────────────────────────────────

function makePart(overrides: Partial<BuildingPart> = {}): BuildingPart {
  return {
    name: "wall_01",
    type: "wall",
    socket_prefix: "SOCKET_building_wall",
    socket_name: "SOCKET_building_wall_01",
    unique: false,
    fbx: "Walls/wall_01.fbx",
    phases: [],
    ...overrides,
  };
}

function makeManifest(overrides: Partial<BuildingManifest> = {}): BuildingManifest {
  return {
    building_name: "TestHouse_01",
    export_root: "C:/exports/TestHouse_01",
    structure: {
      fbx: "TestHouse_01.fbx",
      sockets: ["SOCKET_building_wall_01", "SOCKET_building_wall_02"],
    },
    parts: [makePart()],
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("building-setup", () => {
  describe("ManifestSchema", () => {
    it("parses a valid manifest", () => {
      const manifest = ManifestSchema.parse({
        building_name: "TestHouse_01",
        export_root: "C:/exports/TestHouse_01",
        structure: { fbx: "TestHouse_01.fbx", sockets: ["SOCKET_building_wall_01"] },
        parts: [
          {
            name: "wall_01",
            type: "wall",
            socket_prefix: "SOCKET_building_wall",
            socket_name: "SOCKET_building_wall_01",
            unique: false,
            fbx: "Walls/wall_01.fbx",
            phases: [],
          },
        ],
      });
      expect(manifest.building_name).toBe("TestHouse_01");
      expect(manifest.parts).toHaveLength(1);
    });

    it("rejects manifest with empty building_name", () => {
      expect(() =>
        ManifestSchema.parse({
          building_name: "",
          export_root: "C:/exports",
          structure: { fbx: "test.fbx", sockets: [] },
          parts: [],
        }),
      ).toThrow();
    });

    it("rejects manifest with missing parts field", () => {
      expect(() =>
        ManifestSchema.parse({
          building_name: "Test",
          export_root: "C:/exports",
          structure: { fbx: "test.fbx", sockets: [] },
        }),
      ).toThrow();
    });
  });

  describe("fbxToXob", () => {
    it("converts .fbx to .xob with mod prefix", () => {
      expect(fbxToXob("Walls/wall_01.fbx", "MyMod/Assets/Buildings/")).toBe(
        "MyMod/Assets/Buildings/Walls/wall_01.xob",
      );
    });

    it("handles empty mod prefix", () => {
      expect(fbxToXob("wall.fbx", "")).toBe("wall.xob");
    });

    it("is case-insensitive on .FBX extension", () => {
      expect(fbxToXob("wall.FBX", "prefix/")).toBe("prefix/wall.xob");
    });
  });

  describe("guidPrefabPath", () => {
    it("wraps path with a {GUID} prefix", () => {
      const result = guidPrefabPath("Prefabs/Test.et");
      expect(result).toMatch(/^\{[0-9A-F]{16}\}Prefabs\/Test\.et$/);
    });

    it("generates unique GUIDs per call", () => {
      const a = guidPrefabPath("a.et");
      const b = guidPrefabPath("b.et");
      const guidA = a.slice(1, 17);
      const guidB = b.slice(1, 17);
      expect(guidA).not.toBe(guidB);
    });
  });

  describe("generateDestructionComponent", () => {
    it("returns empty string for parts with no phases", () => {
      expect(generateDestructionComponent(makePart(), "")).toBe("");
    });

    it("generates SCR_DestructionMultiPhaseComponent with phases", () => {
      const part = makePart({
        phases: [
          { index: 1, fbx: "Walls/wall_dst_01.fbx" },
          { index: 2, fbx: "Walls/wall_dst_02.fbx" },
          { index: 3, fbx: "Walls/wall_dst_03.fbx" },
        ],
      });
      const result = generateDestructionComponent(part, "Mod/");

      expect(result).toContain("SCR_DestructionMultiPhaseComponent");
      expect(result).toContain("SCR_DamagePhaseData");
      expect(result).toContain("Mod/Walls/wall_dst_01.xob");
      expect(result).toContain("Mod/Walls/wall_dst_03.xob");
    });

    it("writes the vanilla SCR_DamagePhaseData member names", () => {
      // Vanilla Prefabs/Props/Agriculture/Beehive_01/Beehive_01_stack.et:
      // SCR_DamagePhaseData "{GUID}" { m_fPhaseHealth 800  m_PhaseModel "...xob" }
      const part = makePart({ phases: [{ index: 1, fbx: "a.fbx" }] });
      const result = generateDestructionComponent(part, "");

      expect(result).toContain('m_PhaseModel "a.xob"');
      expect(result).not.toMatch(/^\s*PhaseModel /m);
      // Health is absolute hit points in vanilla (300-10000); none is invented here.
      expect(result).not.toMatch(/^\s*Health /m);
      expect(result).not.toContain("m_fPhaseHealth");
    });

    it("includes unique GUIDs per phase entry", () => {
      const part = makePart({
        phases: [
          { index: 1, fbx: "a.fbx" },
          { index: 2, fbx: "b.fbx" },
        ],
      });
      const result = generateDestructionComponent(part, "");

      const guidMatches = result.match(/\{[0-9A-F]{16}\}/g);
      expect(guidMatches).toHaveLength(2);
      expect(guidMatches![0]).not.toBe(guidMatches![1]);
    });
  });

  describe("generateSlotBoneMappingObject", () => {
    it("generates correct slot mapping", () => {
      const part = makePart({ socket_prefix: "SOCKET_wall" });
      const result = generateSlotBoneMappingObject(part, "{ABCD}Prefabs/wall.et");

      // Vanilla Barn_E_01_Base.et: SlotBoneMappingObject "{GUID}" { BonePrefix "..." Prefab "..." }
      const node = parse(result);
      expect(node.type).toBe("SlotBoneMappingObject");
      expect(node.id).toMatch(/^\{[0-9A-F]{16}\}$/);
      expect(node.properties).toEqual([
        { key: "BonePrefix", value: "SOCKET_wall" },
        { key: "Prefab", value: "{ABCD}Prefabs/wall.et" },
      ]);
      expect(result).not.toContain("Template");
    });
  });

  describe("generateBaseSlotComponent", () => {
    it("generates correct slot component", () => {
      const part = makePart({ socket_name: "SOCKET_door_01", unique: true });
      const result = generateBaseSlotComponent(part, "{ABCD}Prefabs/door.et");

      // Vanilla ControlTower_01.et:
      // BaseSlotComponent "{GUID}" { AttachType EntitySlotInfo "{GUID}" { PivotID "..." } EntityPrefab "..." }
      const node = parse(result);
      expect(node.type).toBe("BaseSlotComponent");
      expect(node.properties).toEqual([{ key: "EntityPrefab", value: "{ABCD}Prefabs/door.et" }]);
      const attach = node.children.find((c) => c.type === "AttachType");
      expect(attach?.className).toBe("EntitySlotInfo");
      expect(attach?.properties).toEqual([{ key: "PivotID", value: "SOCKET_door_01" }]);
      expect(result).not.toMatch(/^\s*Slot /m);
    });
  });

  describe("generatePartPrefab", () => {
    it("generates a GenericEntity with MeshObject", () => {
      const result = generatePartPrefab(makePart(), "Mod/");

      expect(result).toContain("GenericEntity");
      expect(result).toContain("MeshObject");
      expect(result).toContain("Mod/Walls/wall_01.xob");
    });

    it("includes destruction component when phases exist", () => {
      const part = makePart({
        phases: [{ index: 1, fbx: "Walls/wall_dst_01.fbx" }],
      });
      const result = generatePartPrefab(part, "");

      expect(result).toContain("SCR_DestructionMultiPhaseComponent");
    });

    it("omits destruction component when no phases", () => {
      const result = generatePartPrefab(makePart(), "");

      expect(result).not.toContain("SCR_DestructionMultiPhaseComponent");
    });
  });

  describe("generateBuildingPrefab", () => {
    it("generates SCR_DestructibleBuildingEntity inheriting Building_Base", () => {
      const manifest = makeManifest();
      const paths = new Map([["wall_01", "{GUID}Prefabs/wall_01.et"]]);
      const result = generateBuildingPrefab(manifest, manifest.parts, "", paths);

      expect(result).toContain("SCR_DestructibleBuildingEntity");
      expect(result).toContain("Building_Base.et");
      expect(result).toContain("SCR_DestructibleBuildingComponent");
    });

    it("uses SlotBoneMappingObject for repeated parts (unique=false)", () => {
      const manifest = makeManifest({ parts: [makePart({ unique: false })] });
      const paths = new Map([["wall_01", "{GUID}Prefabs/wall_01.et"]]);
      const result = generateBuildingPrefab(manifest, manifest.parts, "", paths);

      expect(result).toContain("SlotBoneMappingObject");
      expect(result).not.toContain("BaseSlotComponent");
      // SlotBoneMappings is an entity property in vanilla, not a component.
      const node = parse(result);
      const mappings = node.children.find((c) => c.type === "SlotBoneMappings");
      expect(mappings?.children.map((c) => c.type)).toEqual(["SlotBoneMappingObject"]);
      const comps = node.children.find((c) => c.type === "components");
      expect(comps!.children.some((c) => c.type === "SlotBoneMappingObject")).toBe(false);
    });

    it("uses BaseSlotComponent for unique parts (unique=true)", () => {
      const part = makePart({ name: "door_main", unique: true, socket_name: "SOCKET_door_01" });
      const manifest = makeManifest({ parts: [part] });
      const paths = new Map([["door_main", "{GUID}Prefabs/door_main.et"]]);
      const result = generateBuildingPrefab(manifest, manifest.parts, "", paths);

      expect(result).toContain("BaseSlotComponent");
      expect(result).not.toContain("SlotBoneMappingObject");
    });

    it("includes MeshObject with structure .xob path", () => {
      const manifest = makeManifest();
      const result = generateBuildingPrefab(manifest, [], "Mod/", new Map());

      expect(result).toContain('Object "Mod/TestHouse_01.xob"');
    });
  });
});
