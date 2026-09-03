import { describe, it, expect } from "vitest";
import {
  generateConfig,
  getConfigSubdirectory,
  getConfigFilename,
} from "../../src/templates/config.js";
import { parse } from "../../src/formats/enfusion-text.js";

describe("generateConfig", () => {
  describe("mission-header", () => {
    describe("Conflict mode (default)", () => {
      it("generates valid Enfusion text with SCR_MissionHeaderCampaign", () => {
        const result = generateConfig({
          configType: "mission-header",
          name: "TestScenario",
          scenarioName: "My Test Scenario",
          worldPath: "{9DF143A76F5C6460}worlds/MP/CTI_Campaign_Eden.ent",
        });
        const node = parse(result);
        expect(node.type).toBe("SCR_MissionHeaderCampaign");
      });

      it("sets Conflict mission header properties", () => {
        const result = generateConfig({
          configType: "mission-header",
          name: "TestScenario",
          scenarioName: "My Scenario",
          scenarioDescription: "Desc here",
          worldPath: "{9DF143A76F5C6460}worlds/MP/CTI_Campaign_Eden.ent",
          playerCount: 64,
          gameModeLabel: "Conflict",
          xpMultiplier: 0.5,
        });
        expect(result).toContain("SCR_MissionHeaderCampaign");
        expect(result).toContain("World");
        expect(result).toContain("m_sName");
        expect(result).toContain("My Scenario");
        expect(result).toContain("m_sGameMode");
        expect(result).toContain("Conflict");
        expect(result).toContain("m_iPlayerCount");
        expect(result).toContain("64");
        expect(result).toContain("m_eEditableGameFlags");
        expect(result).toContain("m_eDefaultGameFlags");
        expect(result).toContain("m_fXpMultiplier");
        expect(result).toContain("0.5");
      });

      it("omits xpMultiplier when 1.0", () => {
        const result = generateConfig({
          configType: "mission-header",
          name: "TestScenario",
          xpMultiplier: 1.0,
        });
        expect(result).not.toContain("m_fXpMultiplier");
      });

      it("uses name as fallback for scenarioName", () => {
        const result = generateConfig({
          configType: "mission-header",
          name: "FallbackName",
        });
        expect(result).toContain("FallbackName");
      });

      it("includes SystemsConfig for Conflict", () => {
        const result = generateConfig({
          configType: "mission-header",
          name: "TestScenario",
        });
        expect(result).toContain("SystemsConfig");
        expect(result).toContain("ConflictSystems.conf");
      });
    });

    describe("SF mode", () => {
      it("generates SCR_MissionHeader for SF mode", () => {
        const result = generateConfig({
          configType: "mission-header",
          name: "TestScenario",
          missionMode: "SF",
          scenarioName: "My SF Scenario",
          worldPath: "{AABB}Worlds/TestWorld.ent",
        });
        const node = parse(result);
        expect(node.type).toBe("SCR_MissionHeader");
      });

      it("sets SF mission header properties", () => {
        const result = generateConfig({
          configType: "mission-header",
          name: "TestScenario",
          missionMode: "SF",
          scenarioName: "My Scenario",
          scenarioDescription: "Desc here",
          worldPath: "{AABB}Worlds/Test.ent",
        });
        expect(result).toContain("m_sName");
        expect(result).toContain("My Scenario");
        expect(result).toContain("m_sDescription");
        expect(result).toContain("m_sWorldFile");
        expect(result).toContain("m_bIsModded");
        expect(result).not.toContain("SCR_MissionHeaderCampaign");
      });
    });
  });

  describe("faction", () => {
    it("generates valid Enfusion text", () => {
      const result = generateConfig({
        configType: "faction",
        name: "My Faction",
        factionKey: "my_faction",
        factionColor: "255,0,0,255",
      });
      const node = parse(result);
      expect(node.type).toBe("SCR_Faction");
    });

    it("sets faction properties", () => {
      const result = generateConfig({
        configType: "faction",
        name: "Alpha Force",
        factionKey: "alpha",
        factionColor: "0,200,100,255",
        flagPath: "{AABB}UI/Textures/Flags/alpha.edds",
      });
      expect(result).toContain("m_sKey");
      expect(result).toContain("alpha");
      expect(result).toContain("m_sName");
      expect(result).toContain("Alpha Force");
      expect(result).toContain("m_Color");
      expect(result).toContain("m_sFlagPath");
    });

    it("auto-derives faction key from name", () => {
      const result = generateConfig({
        configType: "faction",
        name: "My Custom Faction",
      });
      expect(result).toContain("my_custom_faction");
    });
  });

  describe("entity-catalog", () => {
    it("generates valid Enfusion text", () => {
      const result = generateConfig({
        configType: "entity-catalog",
        name: "Vehicles",
        categoryName: "Vehicles",
        prefabRefs: ["{AABB}Prefabs/Vehicles/Tank.et"],
      });
      const node = parse(result);
      expect(node.type).toBe("SCR_EntityCatalog");
    });

    it("creates entries for each prefab ref", () => {
      const result = generateConfig({
        configType: "entity-catalog",
        name: "Test",
        categoryName: "Vehicles",
        prefabRefs: ["{AABB}Prefabs/Vehicles/Tank.et", "{CCDD}Prefabs/Vehicles/Truck.et"],
      });
      expect(result).toContain("SCR_EntityCatalogEntry");
      expect(result).toContain("Tank.et");
      expect(result).toContain("Truck.et");
    });

    it("handles empty prefab refs", () => {
      const result = generateConfig({
        configType: "entity-catalog",
        name: "Empty",
        categoryName: "Empty",
      });
      const node = parse(result);
      expect(node.type).toBe("SCR_EntityCatalog");
      expect(node.children.length).toBe(0);
    });
  });

  describe("editor-placeables", () => {
    it("generates valid Enfusion text", () => {
      const result = generateConfig({
        configType: "editor-placeables",
        name: "Custom",
        categoryName: "Custom Items",
        prefabRefs: ["{AABB}Prefabs/Props/Crate.et"],
      });
      const node = parse(result);
      expect(node.type).toBe("SCR_PlaceableEntitiesRegistry");
    });

    it("creates placeable entries", () => {
      const result = generateConfig({
        configType: "editor-placeables",
        name: "Test",
        prefabRefs: ["{AABB}Prefabs/Props/Crate.et"],
      });
      expect(result).toContain("SCR_PlaceableEntity");
      expect(result).toContain("Crate.et");
    });
  });
});

describe("getConfigSubdirectory", () => {
  it("returns correct paths", () => {
    expect(getConfigSubdirectory("mission-header")).toBe("Missions");
    expect(getConfigSubdirectory("faction")).toBe("Configs/Factions");
    expect(getConfigSubdirectory("entity-catalog")).toBe("Configs/EntityCatalogs");
    expect(getConfigSubdirectory("editor-placeables")).toBe("Configs/Editor");
  });
});

describe("getConfigFilename", () => {
  it("appends .conf extension", () => {
    expect(getConfigFilename("MyFaction")).toBe("MyFaction.conf");
  });
});
