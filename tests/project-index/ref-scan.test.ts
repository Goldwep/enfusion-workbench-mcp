import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openProjectIndex } from "../../src/project-index/migrate.js";
import { scanRefs } from "../../src/project-index/ref-scan.js";
import { parse } from "../../src/formats/enfusion-text.js";
import type { EnfusionNode } from "../../src/formats/enfusion-text.js";
import type { ResourceRefRow } from "../../src/project-index/types.js";

const fixturesDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures/sample-project",
);

/** Schema v3: refs are keyed by project — every test needs a projects row. */
function openWithProject(): ReturnType<typeof openProjectIndex> {
  const db = openProjectIndex(":memory:");
  db.prepare(
    "INSERT INTO projects (id, guid, title, root_path, source, last_scan) VALUES (?, ?, ?, ?, ?, ?)",
  ).run("P", "1111111111111111", "P", "/p", "user", Date.now());
  return db;
}

function readFixture(relPath: string): EnfusionNode {
  const full = resolve(fixturesDir, relPath);
  return parse(readFileSync(full, "utf-8"));
}

describe("scanRefs", () => {
  it("emits an inheritance ref from a .et prefab", () => {
    const db = openWithProject();
    try {
      const node = readFixture("prefabs/test.et");
      const result = scanRefs(db, "P", "prefabs/test.et", node);
      expect(result.refsExtracted).toBeGreaterThan(0);

      const rows = db
        .prepare(
          "SELECT source_file, target_guid, ref_kind, context FROM resource_refs WHERE source_file = ? AND ref_kind = 'inheritance'",
        )
        .all("prefabs/test.et") as ResourceRefRow[];

      expect(rows).toHaveLength(1);
      expect(rows[0].target_guid).toBe("A9806AF617972E97");
      expect(rows[0].context).toBe("GenericEntity");
    } finally {
      db.close();
    }
  });

  it("emits value refs for GUID-shaped strings in a config's values block", () => {
    const db = openWithProject();
    try {
      const node = readFixture("configs/test.conf");
      scanRefs(db, "P", "configs/test.conf", node);

      const rows = db
        .prepare(
          "SELECT source_file, target_guid, ref_kind, context FROM resource_refs WHERE source_file = ? AND ref_kind = 'value' ORDER BY target_guid",
        )
        .all("configs/test.conf") as ResourceRefRow[];

      expect(rows).toHaveLength(2);
      expect(rows[0].target_guid).toBe("88AA11BB22CC33DD");
      expect(rows[0].context).toBe("m_aValues");
      expect(rows[1].target_guid).toBe("99AA11BB22CC33DD");
      expect(rows[1].context).toBe("m_aValues");
    } finally {
      db.close();
    }
  });

  it("emits a dep ref from a .gproj Dependencies block", () => {
    const db = openWithProject();
    try {
      const node = readFixture("addon.gproj");
      scanRefs(db, "P", "addon.gproj", node);

      const rows = db
        .prepare(
          "SELECT source_file, target_guid, ref_kind, context FROM resource_refs WHERE source_file = ? AND ref_kind = 'dep'",
        )
        .all("addon.gproj") as ResourceRefRow[];

      expect(rows).toHaveLength(1);
      expect(rows[0].target_guid).toBe("58D0FB3206B6F859");
      expect(rows[0].context).toBe("");
    } finally {
      db.close();
    }
  });

  it("is idempotent — re-scanning the same file does not duplicate rows", () => {
    const db = openWithProject();
    try {
      const node = readFixture("configs/test.conf");
      const first = scanRefs(db, "P", "configs/test.conf", node);
      const second = scanRefs(db, "P", "configs/test.conf", node);

      expect(second.uniqueRefs).toBe(first.uniqueRefs);

      const totalRow = db
        .prepare(
          "SELECT COUNT(*) AS c FROM resource_refs WHERE source_file = ?",
        )
        .get("configs/test.conf") as { c: number };
      expect(totalRow.c).toBe(first.uniqueRefs);
    } finally {
      db.close();
    }
  });

  it("tolerates malformed GUID-shaped strings without throwing or inserting", () => {
    const db = openWithProject();
    try {
      // Hand-built tree containing a string that starts with "{" but has
      // non-hex content. Should be logged-and-skipped, not inserted.
      const root: EnfusionNode = {
        type: "SomeConfig",
        id: "{AAAA0000BBBB1111}",
        properties: [
          { key: "m_sBadAsset", value: "{NOTHEX12345678}path/x" },
          { key: "m_sNotARef", value: "just-a-plain-string" },
        ],
        values: [],
        children: [
          {
            type: "m_aMixed",
            properties: [],
            values: ["{ZZZZZZZZZZZZZZZZ}path/y", "{CCCCCCCCCCCCCCCC}path/ok.emat"],
            children: [],
          },
        ],
      };

      expect(() => scanRefs(db, "P", "configs/bad.conf", root)).not.toThrow();

      // No row should reference the bad GUIDs.
      const badRows = db
        .prepare(
          "SELECT * FROM resource_refs WHERE source_file = ? AND (target_guid LIKE '%NOTHEX%' OR target_guid LIKE '%ZZZZ%')",
        )
        .all("configs/bad.conf");
      expect(badRows).toHaveLength(0);

      // The valid GUID in the same tree still landed.
      const okRows = db
        .prepare(
          "SELECT target_guid FROM resource_refs WHERE source_file = ? AND target_guid = ?",
        )
        .all("configs/bad.conf", "CCCCCCCCCCCCCCCC") as { target_guid: string }[];
      expect(okRows).toHaveLength(1);
    } finally {
      db.close();
    }
  });
});
