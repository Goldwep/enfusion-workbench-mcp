import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import {
  validateFaction,
  validateFactionFile,
} from "../../tools/project-validate-faction.js";

const TMP = resolve(import.meta.dirname, "../../../tmp-test-faction-validate");

function setup(files: Record<string, string>): string {
  rmSync(TMP, { recursive: true, force: true });
  for (const [path, content] of Object.entries(files)) {
    const fullPath = join(TMP, path);
    mkdirSync(resolve(fullPath, ".."), { recursive: true });
    writeFileSync(fullPath, content, "utf-8");
  }
  return TMP;
}

afterEach(() => rmSync(TMP, { recursive: true, force: true }));

/** Vanilla shape (Configs/Factions/CIV.conf, Dummy.conf): FactionKey, FactionColor floats, UIInfo.Name. */
function goodFactionConf(key = "US", name = "United States Army", color = "0.04 0.08 0.12 1"): string {
  return [
    `SCR_Faction {`,
    ` FactionKey "${key}"`,
    ` FactionColor ${color}`,
    ` UIInfo SCR_FactionUIInfo "{56B49118D8D0A9C5}" {`,
    `  Name "${name}"`,
    ` }`,
    `}`,
  ].join("\n");
}

describe("validateFactionFile — F1 required fields", () => {
  it("flags missing FactionKey", () => {
    const findings = validateFactionFile(
      "test.conf",
      [`SCR_Faction {`, ` FactionColor 0 0 0 1`, `}`].join("\n"),
    );
    const keyErr = findings.find((f) => f.path === "FactionKey");
    expect(keyErr?.severity).toBe("error");
  });

  it("warns on missing UIInfo and FactionColor on a non-inheriting file", () => {
    const findings = validateFactionFile(
      "test.conf",
      [`SCR_Faction {`, ` FactionKey "US"`, `}`].join("\n"),
    );
    expect(findings.find((f) => f.path === "UIInfo")?.severity).toBe("warning");
    expect(findings.find((f) => f.path === "FactionColor")?.severity).toBe("warning");
  });

  it("accepts an inheriting file without color or UIInfo (vanilla US.conf pattern)", () => {
    const findings = validateFactionFile(
      "test.conf",
      [
        `SCR_Faction : "{E7B7EA4823DD81F0}Configs/Factions/BLUFOR.conf" {`,
        ` FactionKey "US"`,
        `}`,
      ].join("\n"),
    );
    expect(findings).toEqual([]);
  });

  it("flags the member-style names the engine ignores", () => {
    const findings = validateFactionFile(
      "test.conf",
      [
        `SCR_Faction "SCR_Faction" {`,
        ` m_sFactionKey "US"`,
        ` m_sFactionName "United States"`,
        ` m_FactionColor {`,
        `  R 10`,
        ` }`,
        `}`,
      ].join("\n"),
    );
    for (const bad of ["m_sFactionKey", "m_sFactionName", "m_FactionColor"]) {
      const f = findings.find((x) => x.path === bad);
      expect(f?.severity).toBe("error");
      expect(f?.message).toMatch(/ignores/);
    }
    expect(findings.find((f) => f.path === "FactionKey")?.severity).toBe("error");
  });

  it("is clean on a well-formed faction", () => {
    expect(validateFactionFile("test.conf", goodFactionConf())).toEqual([]);
  });
});

describe("validateFactionFile — F2 key shape", () => {
  it("flags lowercase key", () => {
    const findings = validateFactionFile("test.conf", goodFactionConf("us"));
    const keyErr = findings.find((f) => f.path === "FactionKey" && f.message.includes("/^"));
    expect(keyErr?.severity).toBe("error");
  });

  it("flags too-long key", () => {
    const findings = validateFactionFile("test.conf", goodFactionConf("A".repeat(17)));
    expect(findings.find((f) => f.path === "FactionKey" && f.message.includes("/^"))).toBeDefined();
  });

  it("accepts FIA, US, USSR", () => {
    for (const k of ["FIA", "US", "USSR"]) {
      const findings = validateFactionFile("test.conf", goodFactionConf(k));
      expect(findings.find((f) => f.path === "FactionKey")).toBeUndefined();
    }
  });
});

describe("validateFactionFile — F3 color", () => {
  it("flags a 0-255 channel", () => {
    const findings = validateFactionFile("test.conf", goodFactionConf("US", "X", "255 0 0 1"));
    const err = findings.find((f) => f.path === "FactionColor");
    expect(err?.severity).toBe("error");
    expect(err?.message).toMatch(/outside \[0, 1\]/);
  });

  it("flags a color that is not four numbers", () => {
    const findings = validateFactionFile("test.conf", goodFactionConf("US", "X", "0.1 0.2 0.3"));
    expect(findings.find((f) => f.path === "FactionColor")?.severity).toBe("error");
  });
});

describe("validateFaction (project-wide F4 duplicate)", () => {
  it("flags two faction files sharing the same key", () => {
    const root = setup({
      "Configs/Factions/US_Army.conf": goodFactionConf("US", "Army"),
      "Configs/Factions/US_Marines.conf": goodFactionConf("US", "Marines"),
    });
    const findings = validateFaction(root);
    const dup = findings.find((f) => f.message.includes("Duplicate faction key"));
    expect(dup?.severity).toBe("error");
    expect(dup!.message).toContain("US");
    expect(dup!.path).toMatch(/:FactionKey$/);
  });

  it("does not flag distinct keys", () => {
    const root = setup({
      "Configs/Factions/US.conf": goodFactionConf("US", "United States"),
      "Configs/Factions/USSR.conf": goodFactionConf("USSR", "Soviet Union"),
    });
    const findings = validateFaction(root);
    expect(findings.find((f) => f.message.includes("Duplicate faction key"))).toBeUndefined();
  });
});

describe("validateFaction (project-wide F5 orphan)", () => {
  it("warns when no entity references a defined faction", () => {
    const root = setup({
      "Configs/Factions/US.conf": goodFactionConf("US", "United States"),
    });
    const orphan = validateFaction(root).find((f) => f.message.includes("Orphan faction"));
    expect(orphan?.severity).toBe("warning");
  });

  it("does NOT warn when at least one entity declares the key", () => {
    const root = setup({
      "Configs/Factions/US.conf": goodFactionConf("US", "United States"),
      "Prefabs/Soldier.et": [
        `GenericEntity {`,
        ` components {`,
        `  SCR_FactionAffiliationComponent {`,
        `   "faction affiliation" "US"`,
        `  }`,
        ` }`,
        `}`,
      ].join("\n"),
    });
    const orphan = validateFaction(root).find((f) => f.message.includes("Orphan faction"));
    expect(orphan).toBeUndefined();
  });
});

describe("validateFaction — file targeting", () => {
  it("validates a single .conf when pointed at the file directly", () => {
    const root = setup({
      "Configs/Factions/Bad.conf": [`SCR_Faction {`, ` FactionKey "lowercase"`, `}`].join("\n"),
    });
    const findings = validateFaction(join(root, "Configs", "Factions", "Bad.conf"));
    expect(
      findings.find((f) => f.message.includes("/^") && f.path.includes("FactionKey")),
    ).toBeDefined();
    expect(findings.find((f) => f.path.includes("FactionColor"))).toBeDefined();
  });

  it("returns error for non-.conf file", () => {
    const root = setup({ "test.txt": "not a faction" });
    const findings = validateFaction(join(root, "test.txt"));
    expect(findings[0].severity).toBe("error");
    expect(findings[0].message).toContain(".conf");
  });

  it("returns error for missing path", () => {
    const findings = validateFaction(resolve(TMP, "does-not-exist", "X.conf"));
    expect(findings[0].severity).toBe("error");
    expect(findings[0].message).toContain("not found");
  });
});
