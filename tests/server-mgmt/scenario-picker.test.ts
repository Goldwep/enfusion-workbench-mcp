import { describe, it, expect, afterAll } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { openProjectIndex } from "../../src/project-index/migrate.js";
import { ProjectIndex } from "../../src/project-index/project-index.js";
import {
  buildScenarioPickerReport,
  findMissionConfFiles,
  formatScenarioPicker,
  isMissionHeaderClass,
  OFFICIAL_SCENARIOS,
  parseUserScenario,
} from "../../src/server-mgmt/scenario-picker.js";
import type { Config } from "../../src/config.js";

const TEST_DIR = resolve(import.meta.dirname, "../../tmp-test-scenario-picker");

function setupFiles(files: Record<string, string>): void {
  rmSync(TEST_DIR, { recursive: true, force: true });
  for (const [rel, content] of Object.entries(files)) {
    const full = join(TEST_DIR, rel);
    mkdirSync(resolve(full, ".."), { recursive: true });
    writeFileSync(full, content, "utf-8");
  }
}

afterAll(() => rmSync(TEST_DIR, { recursive: true, force: true }));

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    workbenchPath: "X",
    projectPath: TEST_DIR,
    gamePath: "X",
    dataDir: "X",
    patternsDir: "X",
    workbenchHost: "127.0.0.1",
    workbenchPort: 5775,
    projectIndexPath: ":memory:",
    corePath: "X",
    logsPath: "X",
    ...overrides,
  };
}

describe("server-mgmt/scenario-picker — isMissionHeaderClass", () => {
  it("accepts the canonical class hierarchy", () => {
    expect(isMissionHeaderClass("SCR_MissionHeader")).toBe(true);
    expect(isMissionHeaderClass("SCR_MissionHeaderCampaign")).toBe(true);
    expect(isMissionHeaderClass("SCR_MissionHeaderConflict")).toBe(true);
    expect(isMissionHeaderClass("SCR_MissionHeaderCombatOps")).toBe(true);
    expect(isMissionHeaderClass("SCR_MissionHeaderGM")).toBe(true);
    expect(isMissionHeaderClass("MissionHeader")).toBe(true);
  });

  it("rejects unrelated classes", () => {
    expect(isMissionHeaderClass("SCR_Faction")).toBe(false);
    expect(isMissionHeaderClass("GenericEntity")).toBe(false);
    expect(isMissionHeaderClass("MissionHeaderHelper")).toBe(false);
  });
});

describe("server-mgmt/scenario-picker — findMissionConfFiles", () => {
  it("finds .conf files only under Missions/ subdirs", () => {
    setupFiles({
      "Missions/M1.conf": "SCR_MissionHeader {}",
      "Missions/Sub/M2.conf": "SCR_MissionHeaderCampaign {}",
      "Configs/Faction.conf": "SCR_Faction {}",
      "Scripts/Foo.c": "class Foo {}",
    });
    const files = findMissionConfFiles(TEST_DIR);
    const normalized = files.map((f) => f.replace(/\\/g, "/")).sort();
    expect(normalized).toContain(
      `${TEST_DIR.replace(/\\/g, "/")}/Missions/M1.conf`,
    );
    expect(normalized.some((f) => f.endsWith("/Missions/Sub/M2.conf"))).toBe(true);
    // Configs/Faction.conf must be excluded — wrong directory.
    expect(normalized.some((f) => f.endsWith("/Configs/Faction.conf"))).toBe(false);
  });

  it("returns [] when root doesn't exist", () => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    expect(findMissionConfFiles(TEST_DIR)).toEqual([]);
  });
});

describe("server-mgmt/scenario-picker — parseUserScenario", () => {
  it("extracts name + worldFile from SCR_MissionHeader", () => {
    setupFiles({
      "Missions/Mine.conf": `SCR_MissionHeader {
 m_sName "My Scenario"
 m_sDescription "desc"
 m_sWorldFile "worlds/MyWorld.ent"
 m_bIsModded 1
}`,
    });
    const parsed = parseUserScenario(
      join(TEST_DIR, "Missions/Mine.conf"),
      TEST_DIR,
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.rootType).toBe("SCR_MissionHeader");
    expect(parsed!.name).toBe("My Scenario");
    expect(parsed!.worldFile).toBe("worlds/MyWorld.ent");
    expect(parsed!.relativePath).toBe("Missions/Mine.conf");
  });

  it("handles SCR_MissionHeaderCampaign subclass", () => {
    setupFiles({
      "Missions/Camp.conf": `SCR_MissionHeaderCampaign {
 m_sName "Camp"
 m_sWorldFile "worlds/Camp.ent"
}`,
    });
    const parsed = parseUserScenario(
      join(TEST_DIR, "Missions/Camp.conf"),
      TEST_DIR,
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.rootType).toBe("SCR_MissionHeaderCampaign");
  });

  it("returns null for non-mission-header .conf files", () => {
    setupFiles({
      "Missions/NotMission.conf": "SCR_Faction { m_sName \"X\" }",
    });
    const parsed = parseUserScenario(
      join(TEST_DIR, "Missions/NotMission.conf"),
      TEST_DIR,
    );
    expect(parsed).toBeNull();
  });

  it("returns null for malformed files (no throw)", () => {
    setupFiles({ "Missions/Bad.conf": "{{{ not enfusion text" });
    const parsed = parseUserScenario(
      join(TEST_DIR, "Missions/Bad.conf"),
      TEST_DIR,
    );
    expect(parsed).toBeNull();
  });
});

describe("server-mgmt/scenario-picker — formatScenarioPicker", () => {
  it("renders official + user sections", () => {
    const text = formatScenarioPicker({
      official: [
        { name: "Conflict Arland", map: "Arland", scenarioId: "{ABCD}M.conf" },
      ],
      user: [
        {
          absolutePath: "/x/Missions/M.conf",
          relativePath: "Missions/M.conf",
          rootType: "SCR_MissionHeader",
          name: "My Mission",
          worldFile: "worlds/Mine.ent",
        },
      ],
      workshop: [],
      includeWorkshop: false,
    });
    expect(text).toContain("### Official BI (1)");
    expect(text).toContain("Conflict Arland");
    expect(text).toContain("{ABCD}M.conf");
    expect(text).toContain("### User project (1)");
    expect(text).toContain("My Mission");
    expect(text).toContain("Missions/M.conf");
    expect(text).not.toContain("### Workshop");
  });

  it("shows workshop section only when requested", () => {
    const text = formatScenarioPicker({
      official: [],
      user: [],
      workshop: [],
      includeWorkshop: true,
    });
    expect(text).toContain("### Workshop (0)");
  });
});

describe("server-mgmt/scenario-picker — OFFICIAL_SCENARIOS", () => {
  it("has at least one well-known entry", () => {
    expect(OFFICIAL_SCENARIOS.length).toBeGreaterThan(0);
    expect(
      OFFICIAL_SCENARIOS.some((s) => /Conflict/i.test(s.name)),
    ).toBe(true);
    expect(
      OFFICIAL_SCENARIOS.some((s) => /Game Master/i.test(s.name)),
    ).toBe(true);
  });

  it("every entry has a 16-hex-digit braced GUID scenarioId", () => {
    // Reforger content GUIDs are exactly 16 hex digits (8 bytes). The
    // original v1.0.0 catalog leaked through a regression where braces
    // were present but the inner GUID was just "wrong" — tighten the
    // regex so the test would have caught it.
    for (const s of OFFICIAL_SCENARIOS) {
      expect(s.scenarioId).toMatch(/^\{[0-9A-F]{16}\}Missions\/[^/]*\.conf$/);
    }
  });

  it("every scenarioId GUID is unique across the catalog", () => {
    // The pre-fix table had Conflict-Everon and Game-Master-Everon
    // sharing the same scenarioId. Two distinct game modes cannot
    // share a content GUID — they're two different .conf files in
    // data.pak, so each MUST have its own id.
    const guids = OFFICIAL_SCENARIOS.map((s) => {
      const m = s.scenarioId.match(/^\{([0-9A-F]+)\}/);
      return m ? m[1] : "";
    });
    expect(new Set(guids).size).toBe(guids.length);
  });

  it("display names are unique", () => {
    const names = OFFICIAL_SCENARIOS.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("server-mgmt/scenario-picker — buildScenarioPickerReport (integration)", () => {
  it("scans the configured projectPath and merges with official catalog", () => {
    setupFiles({
      "Missions/Local.conf": `SCR_MissionHeader {
 m_sName "Local Test"
 m_sWorldFile "worlds/Local.ent"
}`,
      "Missions/sub/Local2.conf": `SCR_MissionHeaderCampaign {
 m_sName "Local Campaign"
 m_sWorldFile "worlds/Local2.ent"
}`,
      "Configs/NotScanned.conf": "SCR_Faction { m_sName \"x\" }",
    });

    const db = openProjectIndex(":memory:");
    try {
      const index = new ProjectIndex(db);
      const config = makeConfig({ projectPath: TEST_DIR });
      const text = buildScenarioPickerReport(config, index, {
        includeWorkshop: false,
      });
      expect(text).toContain("Local Test");
      expect(text).toContain("Local Campaign");
      // Confirms only mission-header .confs were picked up.
      expect(text).not.toContain("NotScanned");
      // Official catalog still rendered.
      expect(text).toContain("### Official BI");
    } finally {
      db.close();
    }
  });
});
