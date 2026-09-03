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

function goodFactionConf(key = "US", name = "United States Army"): string {
  return [
    `SCR_Faction "SCR_Faction" {`,
    ` m_sFactionKey "${key}"`,
    ` m_sFactionName "${name}"`,
    ` m_FactionColor {`,
    `  R 10`,
    `  G 20`,
    `  B 30`,
    `  A 1`,
    ` }`,
    `}`,
  ].join("\n");
}

describe("validateFactionFile — F1 required fields", () => {
  it("flags missing m_sFactionKey", () => {
    const findings = validateFactionFile(
      "test.conf",
      [
        `SCR_Faction {`,
        ` m_sFactionName "Foo"`,
        ` m_FactionColor { R 0 G 0 B 0 A 1 }`,
        `}`,
      ].join("\n"),
    );
    const keyErr = findings.find((f) => f.path === "m_sFactionKey");
    expect(keyErr).toBeDefined();
    expect(keyErr!.severity).toBe("error");
  });

  it("flags missing m_sFactionName", () => {
    const findings = validateFactionFile(
      "test.conf",
      [
        `SCR_Faction {`,
        ` m_sFactionKey "US"`,
        ` m_FactionColor { R 0 G 0 B 0 A 1 }`,
        `}`,
      ].join("\n"),
    );
    const nameErr = findings.find((f) => f.path === "m_sFactionName");
    expect(nameErr).toBeDefined();
    expect(nameErr!.severity).toBe("error");
  });

  it("flags missing m_FactionColor", () => {
    const findings = validateFactionFile(
      "test.conf",
      [
        `SCR_Faction {`,
        ` m_sFactionKey "US"`,
        ` m_sFactionName "United States"`,
        `}`,
      ].join("\n"),
    );
    const colorErr = findings.find((f) => f.path === "m_FactionColor");
    expect(colorErr).toBeDefined();
    expect(colorErr!.severity).toBe("error");
  });

  it("is clean on a well-formed faction", () => {
    const findings = validateFactionFile("test.conf", goodFactionConf());
    const errors = findings.filter((f) => f.severity === "error");
    expect(errors).toEqual([]);
  });
});

describe("validateFactionFile — F2 key shape", () => {
  it("flags lowercase key", () => {
    const findings = validateFactionFile("test.conf", goodFactionConf("us"));
    const keyErr = findings.find(
      (f) => f.path === "m_sFactionKey" && f.message.includes("/^"),
    );
    expect(keyErr).toBeDefined();
    expect(keyErr!.severity).toBe("error");
  });

  it("flags too-long key", () => {
    const findings = validateFactionFile(
      "test.conf",
      goodFactionConf("A".repeat(17)),
    );
    const keyErr = findings.find(
      (f) => f.path === "m_sFactionKey" && f.message.includes("/^"),
    );
    expect(keyErr).toBeDefined();
  });

  it("accepts FIA, US, USSR", () => {
    for (const k of ["FIA", "US", "USSR"]) {
      const findings = validateFactionFile("test.conf", goodFactionConf(k));
      const shapeErr = findings.find(
        (f) => f.path === "m_sFactionKey" && f.message.includes("/^"),
      );
      expect(shapeErr).toBeUndefined();
    }
  });
});

describe("validateFactionFile — F3 color range", () => {
  it("flags out-of-range channel", () => {
    const content = [
      `SCR_Faction {`,
      ` m_sFactionKey "US"`,
      ` m_sFactionName "United States"`,
      ` m_FactionColor { R 300 G 20 B 30 A 1 }`,
      `}`,
    ].join("\n");
    const findings = validateFactionFile("test.conf", content);
    const rErr = findings.find((f) => f.path === "m_FactionColor.R");
    expect(rErr).toBeDefined();
    expect(rErr!.severity).toBe("error");
    expect(rErr!.message).toMatch(/out of range/);
  });

  it("flags non-integer channel", () => {
    const content = [
      `SCR_Faction {`,
      ` m_sFactionKey "US"`,
      ` m_sFactionName "United States"`,
      ` m_FactionColor { R "1.5" G 20 B 30 A 1 }`,
      `}`,
    ].join("\n");
    const findings = validateFactionFile("test.conf", content);
    const rErr = findings.find((f) => f.path === "m_FactionColor.R");
    expect(rErr).toBeDefined();
    expect(rErr!.severity).toBe("error");
  });

  it("warns on missing channel", () => {
    const content = [
      `SCR_Faction {`,
      ` m_sFactionKey "US"`,
      ` m_sFactionName "United States"`,
      ` m_FactionColor { R 10 G 20 A 1 }`,
      `}`,
    ].join("\n");
    const findings = validateFactionFile("test.conf", content);
    const bWarn = findings.find((f) => f.path === "m_FactionColor.B");
    expect(bWarn).toBeDefined();
    expect(bWarn!.severity).toBe("warning");
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
    expect(dup).toBeDefined();
    expect(dup!.severity).toBe("error");
    expect(dup!.message).toContain("US");
  });

  it("does not flag distinct keys", () => {
    const root = setup({
      "Configs/Factions/US.conf": goodFactionConf("US", "United States"),
      "Configs/Factions/USSR.conf": goodFactionConf("USSR", "Soviet Union"),
    });
    const findings = validateFaction(root);
    const dup = findings.find((f) => f.message.includes("Duplicate faction key"));
    expect(dup).toBeUndefined();
  });
});

describe("validateFaction (project-wide F5 orphan)", () => {
  it("warns when no entity references a defined faction", () => {
    const root = setup({
      "Configs/Factions/US.conf": goodFactionConf("US", "United States"),
    });
    const findings = validateFaction(root);
    const orphan = findings.find((f) => f.message.includes("Orphan faction"));
    expect(orphan).toBeDefined();
    expect(orphan!.severity).toBe("warning");
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
    const findings = validateFaction(root);
    const orphan = findings.find((f) => f.message.includes("Orphan faction"));
    expect(orphan).toBeUndefined();
  });
});

describe("validateFaction — file targeting", () => {
  it("validates a single .conf when pointed at the file directly", () => {
    const root = setup({
      "Configs/Factions/Bad.conf": [
        `SCR_Faction {`,
        ` m_sFactionKey "lowercase"`,
        ` m_sFactionName "Bad"`,
        `}`,
      ].join("\n"),
    });
    const findings = validateFaction(
      join(root, "Configs", "Factions", "Bad.conf"),
    );
    // Should surface: missing color (F1) + key shape (F2)
    expect(
      findings.find((f) => f.message.includes("/^") && f.path.includes("m_sFactionKey")),
    ).toBeDefined();
    expect(
      findings.find((f) => f.path.includes("m_FactionColor")),
    ).toBeDefined();
  });

  it("returns error for non-.conf file", () => {
    const root = setup({
      "test.txt": "not a faction",
    });
    const findings = validateFaction(join(root, "test.txt"));
    expect(findings[0].severity).toBe("error");
    expect(findings[0].message).toContain(".conf");
  });

  it("returns error for missing path", () => {
    const findings = validateFaction(
      resolve(TMP, "does-not-exist", "X.conf"),
    );
    expect(findings[0].severity).toBe("error");
    expect(findings[0].message).toContain("not found");
  });
});
