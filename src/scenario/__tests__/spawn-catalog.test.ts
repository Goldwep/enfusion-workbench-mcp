import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildSpawnCatalog,
  catalogToJson,
  deriveFactionKey,
  formatCatalogMarkdown,
  parseRegistryFile,
  stripGuidPrefix,
} from "../spawn-catalog-walker.js";

// ── deriveFactionKey ─────────────────────────────────────────────────────────

describe("deriveFactionKey", () => {
  it("pulls a suffix faction from a Characters_BLUFOR.conf-style stem", () => {
    const { key, category } = deriveFactionKey(
      "Configs/Editor/PlaceableEntities/Characters/Characters_BLUFOR.conf",
    );
    expect(key).toBe("BLUFOR");
    expect(category).toBe("Characters");
  });

  it("uses the stem when there's no suffix", () => {
    const { key, category } = deriveFactionKey(
      "Configs/Editor/PlaceableEntities/Systems/Tasks.conf",
    );
    expect(key).toBe("Tasks");
    expect(category).toBe("Systems");
  });

  it("falls back gracefully when the path is a single file", () => {
    const { key, category } = deriveFactionKey("Misc.conf");
    expect(key).toBe("Misc");
    // basename(dirname("Misc.conf")) is "." on POSIX-style normalization
    expect(category).toBe(".");
  });
});

// ── stripGuidPrefix ──────────────────────────────────────────────────────────

describe("stripGuidPrefix", () => {
  it("removes the brace-GUID prefix", () => {
    expect(stripGuidPrefix("{ABCDEF0123456789}Prefabs/Foo.et")).toBe("Prefabs/Foo.et");
  });

  it("leaves bare paths alone", () => {
    expect(stripGuidPrefix("Prefabs/Bar.et")).toBe("Prefabs/Bar.et");
  });

  it("handles an empty string", () => {
    expect(stripGuidPrefix("")).toBe("");
  });
});

// ── parseRegistryFile ────────────────────────────────────────────────────────

const REGISTRY_CONF = `${"SCR_PlaceableEntitiesRegistry"} "{59BC6E3EB600DFEB}" {
 m_sSourceDirectory "{360BA89939C859D2}Prefabs/Characters/Factions/BLUFOR"
 m_bExposed 1
 m_sAddon "ArmaReforger"
 m_Prefabs {
  "{26A9756790131354}Prefabs/Characters/Factions/BLUFOR/US_Army/Character_US_Rifleman.et"
  "{C2D040BB21F15A20}Prefabs/Characters/Factions/BLUFOR/US_Army/Character_US_Medic.et"
 }
}
`;

const EMPTY_REGISTRY_CONF = `${"SCR_PlaceableEntitiesRegistry"} "{59BC6E3EB600DFEC}" {
 m_sSourceDirectory ""
 m_bExposed 0
 m_sAddon "ArmaReforger"
}
`;

const NON_REGISTRY_CONF = `SomeOtherType "{77AA11BB22CC33DD}" {
 m_sName "Not a placeables catalog"
}
`;

describe("parseRegistryFile", () => {
  it("extracts prefab entries from a real-shape registry", () => {
    const result = parseRegistryFile(
      REGISTRY_CONF,
      "Configs/Editor/PlaceableEntities/Characters/Characters_BLUFOR.conf",
    );
    expect(result).not.toBeNull();
    expect(result!.key).toBe("BLUFOR");
    expect(result!.category).toBe("Characters");
    expect(result!.entries).toHaveLength(2);
    expect(result!.entries[0].display).toBe("Character_US_Rifleman");
    expect(result!.entries[0].prefab).toBe(
      "Prefabs/Characters/Factions/BLUFOR/US_Army/Character_US_Rifleman.et",
    );
    expect(result!.entries[0].rawRef).toMatch(/^\{[0-9A-F]+\}/i);
  });

  it("returns an empty entries list for a registry with no m_Prefabs", () => {
    const result = parseRegistryFile(EMPTY_REGISTRY_CONF, "x/Empty.conf");
    expect(result).not.toBeNull();
    expect(result!.entries).toHaveLength(0);
  });

  it("returns null for a non-registry file", () => {
    expect(parseRegistryFile(NON_REGISTRY_CONF, "x/Other.conf")).toBeNull();
  });

  it("returns null for garbage input rather than throwing", () => {
    expect(parseRegistryFile("not valid config text {{{", "x/Bad.conf")).toBeNull();
  });
});

// ── buildSpawnCatalog (integration) ──────────────────────────────────────────

function makeFixtureProject(): string {
  const root = mkdtempSync(join(tmpdir(), "spawn-catalog-test-"));
  const dir = join(root, "Configs", "Editor", "PlaceableEntities");
  mkdirSync(join(dir, "Characters"), { recursive: true });
  mkdirSync(join(dir, "Objects"), { recursive: true });
  mkdirSync(join(dir, "Systems"), { recursive: true });

  writeFileSync(
    join(dir, "Characters", "Characters_BLUFOR.conf"),
    REGISTRY_CONF,
    "utf-8",
  );
  writeFileSync(
    join(dir, "Characters", "Characters_USSR.conf"),
    REGISTRY_CONF.replace(/BLUFOR/g, "USSR").replace(
      /Character_US_(Rifleman|Medic)/g,
      (_m, role) => `Character_USSR_${role}`,
    ),
    "utf-8",
  );
  writeFileSync(
    join(dir, "Systems", "Tasks.conf"),
    `${"SCR_PlaceableEntitiesRegistry"} "{59BC6E3EB6000001}" {
 m_sSourceDirectory ""
 m_Prefabs {
  "{28035CE77901DF88}PrefabsEditable/Tasks/E_MoveTask.et"
 }
}
`,
    "utf-8",
  );
  // Decoy file — same dir, different type, must be skipped.
  writeFileSync(
    join(dir, "Objects", "Decoy.conf"),
    NON_REGISTRY_CONF,
    "utf-8",
  );
  return root;
}

describe("buildSpawnCatalog", () => {
  it("groups entries from multiple registries by inferred faction key", () => {
    const root = makeFixtureProject();
    const catalog = buildSpawnCatalog(root);
    expect(catalog.registriesFound).toBe(3); // BLUFOR, USSR, Tasks
    expect(catalog.factions.map((f) => f.key)).toEqual(["BLUFOR", "Tasks", "USSR"]);

    const blufor = catalog.factions.find((f) => f.key === "BLUFOR");
    expect(blufor).toBeDefined();
    expect(blufor!.entries.map((e) => e.display)).toEqual([
      "Character_US_Medic",
      "Character_US_Rifleman",
    ]);
    expect(blufor!.entries[0].category).toBe("Characters");
  });

  it("skips non-registry files without erroring", () => {
    const root = makeFixtureProject();
    const catalog = buildSpawnCatalog(root);
    // 4 confs scanned, 3 registries; decoy filtered out.
    expect(catalog.filesScanned).toBeGreaterThanOrEqual(4);
    expect(catalog.registriesFound).toBe(3);
  });

  it("throws when the project root doesn't exist", () => {
    expect(() => buildSpawnCatalog(join(tmpdir(), "nonexistent-path-xyz-12345"))).toThrow(
      "does not exist",
    );
  });
});

// ── formatCatalogMarkdown ────────────────────────────────────────────────────

describe("formatCatalogMarkdown", () => {
  it("renders one table per faction with the documented header", () => {
    const root = makeFixtureProject();
    const catalog = buildSpawnCatalog(root);
    const md = formatCatalogMarkdown(catalog, "test-project");
    expect(md).toContain("## GM Spawn List: test-project");
    expect(md).toContain("### Faction BLUFOR — 2 entries");
    expect(md).toContain("| Category | Display | Prefab Path |");
    expect(md).toContain("| Characters | Character_US_Rifleman |");
  });

  it("narrows to a single faction when filter is supplied", () => {
    const root = makeFixtureProject();
    const catalog = buildSpawnCatalog(root);
    const md = formatCatalogMarkdown(catalog, "test-project", "USSR");
    expect(md).toContain("### Faction USSR");
    expect(md).not.toContain("### Faction BLUFOR");
    expect(md).not.toContain("### Faction Tasks");
  });

  it("explains an unknown faction filter rather than rendering nothing", () => {
    const root = makeFixtureProject();
    const catalog = buildSpawnCatalog(root);
    const md = formatCatalogMarkdown(catalog, "test-project", "INDFOR");
    expect(md).toContain('No faction matches "INDFOR"');
    expect(md).toContain("BLUFOR");
  });
});

// ── catalogToJson ────────────────────────────────────────────────────────────

describe("catalogToJson", () => {
  it("emits the structured shape documented by the tool", () => {
    const root = makeFixtureProject();
    const catalog = buildSpawnCatalog(root);
    const j = catalogToJson(catalog);
    expect(j.factions).toHaveLength(3);
    const blufor = j.factions.find((f) => f.key === "BLUFOR");
    expect(blufor).toBeDefined();
    expect(blufor!.entries[0]).toMatchObject({
      category: "Characters",
      display: "Character_US_Medic",
      prefab: expect.stringContaining("Character_US_Medic.et"),
    });
  });

  it("honors faction_filter", () => {
    const root = makeFixtureProject();
    const catalog = buildSpawnCatalog(root);
    const j = catalogToJson(catalog, "Tasks");
    expect(j.factions).toHaveLength(1);
    expect(j.factions[0].key).toBe("Tasks");
  });
});
