import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import {
  walkFactionCatalog,
  groupByFaction,
  extractFactionKey,
  extractDisplayName,
} from "../catalog-walker.js";
import { parse } from "../../formats/enfusion-text.js";

const TMP = resolve(import.meta.dirname, "../../../tmp-test-catalog-walker");

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

function entityWithFaction(rootType: string, key: string, name?: string): string {
  const nameLine = name ? ` m_sDisplayName "${name}"` : "";
  return [
    `${rootType} {`,
    ` components {`,
    `  SCR_EditableEntityComponent {`,
    nameLine,
    `  }`,
    `  SCR_FactionAffiliationComponent {`,
    `   "faction affiliation" "${key}"`,
    `  }`,
    ` }`,
    `}`,
  ]
    .filter((l) => l.length > 0)
    .join("\n");
}

describe("extractFactionKey", () => {
  it("returns the key when present", () => {
    const node = parse(
      `SCR_FactionAffiliationComponent { "faction affiliation" "US" }`,
    );
    expect(extractFactionKey(node)).toBe("US");
  });

  it("returns null when the key is absent or empty", () => {
    const node = parse(`SCR_FactionAffiliationComponent { }`);
    expect(extractFactionKey(node)).toBeNull();
    const empty = parse(
      `SCR_FactionAffiliationComponent { "faction affiliation" "" }`,
    );
    expect(extractFactionKey(empty)).toBeNull();
  });
});

describe("extractDisplayName", () => {
  it("finds m_sDisplayName nested in a component", () => {
    const node = parse(
      [
        `GenericEntity {`,
        ` components {`,
        `  SCR_EditableEntityComponent { m_sDisplayName "M1A2 Abrams" }`,
        ` }`,
        `}`,
      ].join("\n"),
    );
    expect(extractDisplayName(node, "Tank.et")).toBe("M1A2 Abrams");
  });

  it("falls back to the file basename when no name is found", () => {
    const node = parse(`GenericEntity { }`);
    expect(extractDisplayName(node, "Prefabs/Vehicles/UAZ-469.et")).toBe(
      "UAZ-469",
    );
  });
});

describe("walkFactionCatalog", () => {
  it("finds entities by faction key", () => {
    const root = setup({
      "Prefabs/US/Soldier.et": entityWithFaction("GenericEntity", "US", "GI"),
      "Prefabs/USSR/Soldier.et": entityWithFaction("GenericEntity", "USSR", "Soldat"),
      "Prefabs/Misc/Crate.et": "GenericEntity { }",
    });
    const result = walkFactionCatalog(root);
    expect(result.units).toHaveLength(2);
    const us = result.units.find((u) => u.factionKey === "US");
    expect(us).toBeDefined();
    expect(us!.displayName).toBe("GI");
    expect(us!.file).toMatch(/Prefabs\/US\/Soldier\.et$/);
    expect(us!.rootType).toBe("GenericEntity");
  });

  it("supports faction-key filtering", () => {
    const root = setup({
      "Prefabs/A.et": entityWithFaction("GenericEntity", "US"),
      "Prefabs/B.et": entityWithFaction("GenericEntity", "USSR"),
      "Prefabs/C.et": entityWithFaction("GenericEntity", "FIA"),
    });
    const result = walkFactionCatalog(root, { factionKey: "USSR" });
    expect(result.units).toHaveLength(1);
    expect(result.units[0].factionKey).toBe("USSR");
    expect(result.filesScanned).toBe(3); // walked all even when filtering
  });

  it("returns empty result for missing roots", () => {
    const result = walkFactionCatalog(
      resolve(TMP, "does-not-exist"),
    );
    expect(result.units).toEqual([]);
    expect(result.parseErrors).toEqual([]);
    expect(result.filesScanned).toBe(0);
  });

  it("collects parse errors without aborting", () => {
    const root = setup({
      "Prefabs/Bad.et": "this { is { not { closed",
      "Prefabs/Good.et": entityWithFaction("GenericEntity", "US"),
    });
    const result = walkFactionCatalog(root);
    expect(result.parseErrors.length).toBeGreaterThan(0);
    expect(result.units).toHaveLength(1);
    expect(result.units[0].factionKey).toBe("US");
  });

  it("skips node_modules and .git directories", () => {
    const root = setup({
      "node_modules/junk.et": entityWithFaction("GenericEntity", "JUNK"),
      ".git/HEAD": "ref: refs/heads/main",
      "Prefabs/A.et": entityWithFaction("GenericEntity", "US"),
    });
    const result = walkFactionCatalog(root);
    const junk = result.units.find((u) => u.factionKey === "JUNK");
    expect(junk).toBeUndefined();
    expect(result.units).toHaveLength(1);
  });

  it("handles .conf files (not just .et)", () => {
    const root = setup({
      "Prefabs/X.conf": entityWithFaction("SomeEntity", "US"),
    });
    const result = walkFactionCatalog(root);
    expect(result.units).toHaveLength(1);
  });
});

describe("groupByFaction", () => {
  it("groups and sorts entries deterministically", () => {
    const grouped = groupByFaction([
      { file: "b.et", rootType: "X", factionKey: "US", displayName: null },
      { file: "a.et", rootType: "X", factionKey: "US", displayName: null },
      { file: "c.et", rootType: "X", factionKey: "USSR", displayName: null },
    ]);
    expect([...grouped.keys()]).toEqual(["US", "USSR"]);
    expect(grouped.get("US")!.map((u) => u.file)).toEqual(["a.et", "b.et"]);
  });
});
