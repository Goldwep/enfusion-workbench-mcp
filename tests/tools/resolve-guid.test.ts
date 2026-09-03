import { describe, it, expect } from "vitest";
import { openProjectIndex } from "../../src/project-index/migrate.js";
import {
  formatResolvedGuid,
  formatNotFound,
} from "../../src/tools/resolve-guid.js";
import type { ResourceRow } from "../../src/project-index/types.js";

function makeRow(overrides: Partial<ResourceRow> = {}): ResourceRow {
  return {
    guid: "A9806AF617972E97",
    file_path: "Prefabs/Vehicles/UAZ/UAZ_469.et",
    root_type: "GenericEntity",
    class_name: "SCR_Vehicle",
    parent_inherit: "{B11122223333DEAD}Common/Vehicle_Base.et",
    source: "user",
    last_indexed: 1_700_000_000_000,
    ...overrides,
  };
}

describe("resolve-guid formatters", () => {
  describe("formatResolvedGuid", () => {
    it("renders a full row with every field", () => {
      const out = formatResolvedGuid(makeRow());
      expect(out).toContain("A9806AF617972E97");
      expect(out).toContain("Prefabs/Vehicles/UAZ/UAZ_469.et");
      expect(out).toContain("GenericEntity");
      expect(out).toContain("SCR_Vehicle");
      expect(out).toContain("{B11122223333DEAD}Common/Vehicle_Base.et");
      expect(out).toContain("user");
    });

    it("gracefully omits null class_name and parent_inherit", () => {
      const out = formatResolvedGuid(
        makeRow({ class_name: null, parent_inherit: null }),
      );
      expect(out).not.toContain("null");
      expect(out).not.toMatch(/\*\*Class:\*\*/);
      expect(out).not.toMatch(/\*\*Inherits from:\*\*/);
      // The fields that ARE present should still render.
      expect(out).toContain("A9806AF617972E97");
      expect(out).toContain("Prefabs/Vehicles/UAZ/UAZ_469.et");
      expect(out).toContain("GenericEntity");
    });
  });

  describe("formatNotFound", () => {
    it("returns a helpful message including the GUID", () => {
      const out = formatNotFound("AAAA0000BBBB1111");
      expect(out).toContain("AAAA0000BBBB1111");
      expect(out).toContain("project_index_status");
      expect(out).toMatch(/no resource found/i);
    });
  });

  describe("integration with :memory: db", () => {
    it("formats a row fetched from a real SQLite query", () => {
      const db = openProjectIndex(":memory:");
      try {
        db.prepare(
          "INSERT INTO resources (guid, file_path, root_type, class_name, parent_inherit, source, last_indexed) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
        ).run(
          "C0FFEE0011223344",
          "Configs/Weapons/M4A1.conf",
          "WeaponConfig",
          "SCR_Weapon",
          null,
          "user",
          Date.now(),
        );

        const row = db
          .prepare(
            "SELECT guid, file_path, root_type, class_name, parent_inherit, source, last_indexed " +
              "FROM resources WHERE guid = ?",
          )
          .get("C0FFEE0011223344") as ResourceRow;

        expect(row).toBeDefined();
        const out = formatResolvedGuid(row);
        expect(out).toContain("C0FFEE0011223344");
        expect(out).toContain("Configs/Weapons/M4A1.conf");
        expect(out).toContain("WeaponConfig");
        expect(out).toContain("SCR_Weapon");
        // parent_inherit is null in the row — should not appear as "null".
        expect(out).not.toContain("null");
      } finally {
        db.close();
      }
    });
  });
});
