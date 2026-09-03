import { describe, it, expect } from "vitest";
import { parse } from "../../src/formats/enfusion-text.js";
import {
  extractScenarioShape,
  diffScenarios,
  formatScenarioDiff,
} from "../../src/tools/scenario-diff.js";

const SCENARIO_A = `SCR_MissionHeaderCampaign {
 World "{853E92315D1D9EFE}worlds/Eden/Eden.ent"
 SystemsConfig "{7C9E720397CC6ACD}Configs/Systems/ConflictSystems.conf"
 m_sName "Beta Mission"
 m_sGameMode "Conflict"
 m_iPlayerCount 40
 m_bIsSavingEnabled 1
 m_bCustomBaseWhitelist 1
 m_aCampaignCustomBaseList {
  SCR_CampaignCustomBase "{AAAA000000000001}" {
   m_sBaseName "BaseAlpha"
  }
  SCR_CampaignCustomBase "{AAAA000000000002}" {
   m_sBaseName "BaseBravo"
  }
 }
 m_aFactions {
  "US"
  "USSR"
 }
}`;

const SCENARIO_B = `SCR_MissionHeaderCampaign {
 World "{DC924A8DDECC73AD}worlds/MP/CTI_Campaign_Arland.ent"
 SystemsConfig "{7C9E720397CC6ACD}Configs/Systems/ConflictSystems.conf"
 m_sName "Beta Mission v2"
 m_sGameMode "Conflict"
 m_iPlayerCount 60
 m_bIsSavingEnabled 1
 m_bCustomBaseWhitelist 1
 m_aCampaignCustomBaseList {
  SCR_CampaignCustomBase "{AAAA000000000001}" {
   m_sBaseName "BaseAlpha"
  }
  SCR_CampaignCustomBase "{AAAA000000000002}" {
   m_sBaseName "BaseBravo"
  }
  SCR_CampaignCustomBase "{AAAA000000000003}" {
   m_sBaseName "BaseCharlie"
  }
 }
 m_aFactions {
  "US"
  "FIA"
 }
}`;

describe("extractScenarioShape", () => {
  it("pulls game mode class, linked world, base count, and factions", () => {
    const shape = extractScenarioShape(parse(SCENARIO_A));
    expect(shape.gameModeClass).toBe("SCR_MissionHeaderCampaign");
    expect(shape.linkedWorld).toBe("{853E92315D1D9EFE}worlds/Eden/Eden.ent");
    expect(shape.baseCount).toBe(2);
    expect(shape.factions).toEqual(["US", "USSR"]);
    expect(shape.scalars.m_iPlayerCount).toBe("40");
    expect(shape.scalars.m_sName).toBe("Beta Mission");
  });

  it("returns zero counts and empty sets for a minimal scenario", () => {
    const minimal = parse('SCR_MissionHeader {\n m_sName "x"\n}');
    const shape = extractScenarioShape(minimal);
    expect(shape.gameModeClass).toBe("SCR_MissionHeader");
    expect(shape.linkedWorld).toBeNull();
    expect(shape.baseCount).toBe(0);
    expect(shape.factions).toEqual([]);
    expect(shape.layerFiles).toEqual([]);
  });
});

describe("diffScenarios", () => {
  const before = { path: "main/MyScenario.conf", shape: extractScenarioShape(parse(SCENARIO_A)) };
  const after = { path: "beta/MyScenario.conf", shape: extractScenarioShape(parse(SCENARIO_B)) };
  const summary = diffScenarios(before, after);

  it("flags world change and unchanged game mode", () => {
    expect(summary.gameModeChanged).toBe(false);
    expect(summary.linkedWorldChanged).toBe(true);
  });

  it("reports faction additions and removals", () => {
    expect(summary.factionsAdded).toEqual(["FIA"]);
    expect(summary.factionsRemoved).toEqual(["USSR"]);
  });

  it("computes base delta as the difference", () => {
    expect(summary.baseDelta).toBe(1);
    expect(summary.objectiveDelta).toBe(0);
  });

  it("captures changed scalar properties (m_iPlayerCount, m_sName) but skips World", () => {
    const keys = summary.changedScalars.map((c) => c.key);
    expect(keys).toContain("m_iPlayerCount");
    expect(keys).toContain("m_sName");
    expect(keys).not.toContain("World"); // World handled on its own line
  });
});

describe("formatScenarioDiff", () => {
  const before = { path: "main/MyScenario.conf", shape: extractScenarioShape(parse(SCENARIO_A)) };
  const after = { path: "beta/MyScenario.conf", shape: extractScenarioShape(parse(SCENARIO_B)) };
  const out = formatScenarioDiff(diffScenarios(before, after));

  it("renders the required section headers and CHANGED markers", () => {
    expect(out).toContain("## Scenario diff: MyScenario.conf -> MyScenario.conf");
    expect(out).toContain("Game mode: SCR_MissionHeaderCampaign -> SCR_MissionHeaderCampaign  [unchanged]");
    expect(out).toContain("Linked world:");
    expect(out).toContain("[CHANGED]");
    expect(out).toMatch(/Bases\/spawns: 2 -> 3 +\[\+1\]/);
    expect(out).toContain("added: FIA");
    expect(out).toContain("removed: USSR");
  });

  it("emits the Changed properties section listing differing scalars", () => {
    expect(out).toContain("### Changed properties");
    expect(out).toMatch(/m_iPlayerCount: "40" -> "60"/);
  });

  it("renders unchanged scenarios without a Changed properties section", () => {
    const same = { path: "a.conf", shape: extractScenarioShape(parse(SCENARIO_A)) };
    const echoed = formatScenarioDiff(diffScenarios(same, same));
    expect(echoed).not.toContain("### Changed properties");
    expect(echoed).toContain("[unchanged]");
  });
});
