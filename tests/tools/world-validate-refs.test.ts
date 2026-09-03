import { describe, it, expect } from "vitest";
import type Database from "better-sqlite3";
import { openProjectIndex } from "../../src/project-index/migrate.js";
import { ProjectIndex } from "../../src/project-index/project-index.js";
import { parse } from "../../src/formats/enfusion-text.js";
import {
  collectRefs,
  formatReport,
  type WorldRefEntry,
} from "../../src/tools/world-validate-refs.js";

/** Seed an in-memory DB with one resource the test file references. */
function seed(db: Database.Database): void {
  const now = Date.now();
  db.prepare(
    "INSERT INTO resources (guid, file_path, root_type, class_name, parent_inherit, source, last_indexed) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(
    "A9806AF617972E97",
    "Prefabs/Base.et",
    "GenericEntity",
    null,
    null,
    "user",
    now,
  );
}

/** Sample `.et` content with one inheritance ref + one asset_path ref. */
const SAMPLE_ET = `GenericEntity : "{A9806AF617972E97}Prefabs/Base.et" {
 ID "55AA11BB22CC33DD"
 components {
  ItemComponent ItemComponent "{66AA11BB22CC33DD}" {
   m_sDisplayName "Sample Item"
   m_Icon "{DEADDEADDEADDEAD}UI/Icons/missing.edds"
  }
 }
}`;

describe("world_validate_refs collectRefs", () => {
  it("extracts inheritance and asset_path refs from a parsed tree", () => {
    const root = parse(SAMPLE_ET);
    const refs: WorldRefEntry[] = [];
    collectRefs(root, refs);

    const guids = refs.map((r) => r.guid).sort();
    expect(guids).toContain("A9806AF617972E97");
    expect(guids).toContain("DEADDEADDEADDEAD");

    const inh = refs.find((r) => r.refKind === "inheritance");
    expect(inh).toBeDefined();
    expect(inh!.guid).toBe("A9806AF617972E97");

    const asset = refs.find((r) => r.refKind === "asset_path");
    expect(asset).toBeDefined();
    expect(asset!.context).toBe("m_Icon");
  });

  it("returns an empty list for a tree with no GUID refs", () => {
    const root = parse('GenericEntity { ID "55AA11BB22CC33DD" }');
    const refs: WorldRefEntry[] = [];
    collectRefs(root, refs);
    expect(refs).toEqual([]);
  });
});

describe("world_validate_refs formatReport", () => {
  it("renders the resolved/unresolved breakdown with counts", () => {
    const refs: WorldRefEntry[] = [
      {
        guid: "A9806AF617972E97",
        refKind: "inheritance",
        context: "{A9806AF617972E97}Prefabs/Base.et",
        enclosingType: "GenericEntity",
        resolved: {
          guid: "A9806AF617972E97",
          file_path: "Prefabs/Base.et",
          root_type: "GenericEntity",
          class_name: null,
          parent_inherit: null,
          source: "user",
          last_indexed: 0,
        },
      },
      {
        guid: "DEADDEADDEADDEAD",
        refKind: "asset_path",
        context: "m_Icon",
        enclosingType: "ItemComponent",
        resolved: null,
      },
    ];
    const text = formatReport({ filePath: "/x/test.et", refs });
    expect(text).toContain("Total refs found: 2 (1 resolved, 1 unresolved)");
    expect(text).toContain("### Unresolved (1)");
    expect(text).toContain('{DEADDEADDEADDEAD} — at asset_path "m_Icon" (inside ItemComponent)');
    expect(text).toContain("### Resolved (1)");
    expect(text).toContain("{A9806AF617972E97} → Prefabs/Base.et (GenericEntity)");
  });

  it("emits a 'no refs' message when the tree has none", () => {
    const text = formatReport({ filePath: "/x/empty.et", refs: [] });
    expect(text).toContain("No GUID references found");
  });
});

describe("world_validate_refs integration with :memory: index", () => {
  it("marks indexed GUIDs as resolved and unknown ones as unresolved", () => {
    const db = openProjectIndex(":memory:");
    try {
      seed(db);
      const index = new ProjectIndex(db);
      const root = parse(SAMPLE_ET);
      const refs: WorldRefEntry[] = [];
      collectRefs(root, refs);
      for (const r of refs) {
        r.resolved = index.resolveGuid(r.guid);
      }
      const resolved = refs.filter((r) => r.resolved !== null);
      const unresolved = refs.filter((r) => r.resolved === null);
      expect(resolved.map((r) => r.guid)).toEqual(["A9806AF617972E97"]);
      expect(unresolved.map((r) => r.guid)).toContain("DEADDEADDEADDEAD");
    } finally {
      db.close();
    }
  });
});
