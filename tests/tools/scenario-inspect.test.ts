import { describe, it, expect } from "vitest";
import { parse } from "../../src/formats/enfusion-text.js";
import {
  extractScenarioSummary,
  formatScenarioSummary,
} from "../../src/tools/scenario-inspect.js";

// Synthetic mission-header .conf — mirrors the shape produced by scenario_create.
const CONFLICT_CONF = `SCR_MissionHeaderCampaign {
 World "{853E92315D1D9EFE}worlds/Eden/Eden.ent"
 m_sName "Inspect_Test"
 m_iPlayerCount 40
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
   m_bIsControlPoint 1
  }
 }
}`;

// Synthetic .conf using the alternate m_sWorld key + nested faction entries.
const FACTION_CONF = `SCR_MissionHeader {
 m_sWorld "{DC924A8DDECC73AD}worlds/MP/CTI.ent"
 m_aFactions {
  "US"
  "USSR"
  "FIA"
 }
 m_aObjectives {
  SCR_CaptureAndHoldArea {
   m_sAreaSymbol "A"
  }
  SCR_CaptureAndHoldArea {
   m_sAreaSymbol "B"
  }
 }
}`;

describe("scenario-inspect: extractScenarioSummary", () => {
  it("extracts game mode, world, and base list from a Conflict mission header", () => {
    const root = parse(CONFLICT_CONF);
    const s = extractScenarioSummary(root);

    expect(s.rootType).toBe("SCR_MissionHeaderCampaign");
    expect(s.world).toBe("{853E92315D1D9EFE}worlds/Eden/Eden.ent");
    expect(s.baseCount).toBe(3);
    expect(s.objectiveCount).toBe(0);
  });

  it("reads factions from m_aFactions and counts CAH objectives", () => {
    const root = parse(FACTION_CONF);
    const s = extractScenarioSummary(root);

    expect(s.world).toBe("{DC924A8DDECC73AD}worlds/MP/CTI.ent");
    expect(s.factions).toEqual(["FIA", "US", "USSR"]);
    expect(s.objectiveCount).toBe(2);
  });

  it("returns empty defaults when the .conf is bare", () => {
    const root = parse(`SCR_MissionHeader {\n}`);
    const s = extractScenarioSummary(root);

    expect(s.rootType).toBe("SCR_MissionHeader");
    expect(s.world).toBeUndefined();
    expect(s.factions).toEqual([]);
    expect(s.baseCount).toBe(0);
    expect(s.objectiveCount).toBe(0);
  });
});

describe("scenario-inspect: formatScenarioSummary", () => {
  it("renders the markdown contract with filename, world, factions, counts, layers", () => {
    const root = parse(FACTION_CONF);
    const s = extractScenarioSummary(root);
    const out = formatScenarioSummary(s, "Inspect_Test.conf", [
      "default.layer",
      "Bases.layer",
    ]);

    expect(out).toContain("## Scenario: Inspect_Test.conf");
    expect(out).toContain("**Game mode**:");
    expect(out).toContain("SCR_MissionHeader");
    expect(out).toContain("**Linked world**: {DC924A8DDECC73AD}worlds/MP/CTI.ent");
    expect(out).toContain("**Factions** (3): FIA, US, USSR");
    expect(out).toContain("**Bases/spawns**: 0");
    expect(out).toContain("**Objectives**: 2");
    expect(out).toContain("**Layer files**: 2 (default.layer, Bases.layer)");
    expect(out).toContain("### Detected scenario shape");
  });

  it("uses placeholders when world is unset and there are no layers", () => {
    const root = parse(`SCR_MissionHeader {\n}`);
    const s = extractScenarioSummary(root);
    const out = formatScenarioSummary(s, "Empty.conf");

    expect(out).toContain("**Linked world**: (not set)");
    expect(out).toContain("**Factions** (0): (none detected)");
    expect(out).toContain("**Layer files**: 0");
    expect(out).not.toContain("undefined");
  });
});
