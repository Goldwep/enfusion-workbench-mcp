import { describe, it, expect, afterAll } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { openProjectIndex } from "../../src/project-index/migrate.js";
import { ProjectIndex } from "../../src/project-index/project-index.js";
import {
  buildModListReport,
  formatModList,
  resolveMods,
} from "../../src/server-mgmt/mod-list.js";
import type { ResourceRow } from "../../src/project-index/types.js";

const TEST_DIR = resolve(import.meta.dirname, "../../tmp-test-mod-list");

function setup(name: string, content: string): string {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DIR, { recursive: true });
  const full = join(TEST_DIR, name);
  writeFileSync(full, content, "utf-8");
  return full;
}

afterAll(() => rmSync(TEST_DIR, { recursive: true, force: true }));

describe("server-mgmt/mod-list — resolveMods", () => {
  it("marks resolved=true when the resolver returns a row", () => {
    const row: ResourceRow = {
      guid: "ABCD000000000001",
      file_path: "Mods/CoolMod/cool.gproj",
      root_type: "GameProject",
      class_name: null,
      parent_inherit: null,
      source: "workshop",
      last_indexed: Date.now(),
    };
    const out = resolveMods(
      [{ modId: "ABCD000000000001", name: "Cool Mod", version: "1.2.3" }],
      (g) => (g === "ABCD000000000001" ? row : null),
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      modId: "ABCD000000000001",
      name: "Cool Mod",
      version: "1.2.3",
      resolved: true,
      filePath: "Mods/CoolMod/cool.gproj",
      source: "workshop",
    });
  });

  it("normalizes braces and case in modId for lookup", () => {
    const row: ResourceRow = {
      guid: "ABCD000000000001",
      file_path: "x",
      root_type: "GameProject",
      class_name: null,
      parent_inherit: null,
      source: "user",
      last_indexed: 0,
    };
    const calls: string[] = [];
    const out = resolveMods(
      [{ modId: "{abcd000000000001}", name: "M" }],
      (g) => {
        calls.push(g);
        return g === "ABCD000000000001" ? row : null;
      },
    );
    expect(calls).toEqual(["ABCD000000000001"]);
    expect(out[0].resolved).toBe(true);
  });

  it("marks unresolved mods with null fields", () => {
    const out = resolveMods(
      [{ modId: "DEAD000000000099", name: "Unknown" }],
      () => null,
    );
    expect(out[0].resolved).toBe(false);
    expect(out[0].filePath).toBe(null);
    expect(out[0].source).toBe(null);
  });

  it("preserves input order", () => {
    const out = resolveMods(
      [
        { modId: "AAA0000000000001", name: "First" },
        { modId: "BBB0000000000002", name: "Second" },
        { modId: "CCC0000000000003", name: "Third" },
      ],
      () => null,
    );
    expect(out.map((m) => m.name)).toEqual(["First", "Second", "Third"]);
  });
});

describe("server-mgmt/mod-list — formatModList", () => {
  it("renders a markdown table with both resolved and unresolved entries", () => {
    const text = formatModList({
      configPath: "C:\\srv\\server.json",
      mods: [
        {
          modId: "AAA0000000000001",
          name: "Vehicle Pack",
          version: "0.9",
          resolved: true,
          filePath: "Mods/VPack/VPack.gproj",
          source: "user",
        },
        {
          modId: "BBB0000000000002",
          name: "Map Pack",
          resolved: false,
          filePath: null,
          source: null,
        },
      ],
    });
    expect(text).toContain("## Mods in server.json");
    expect(text).toContain("Vehicle Pack (0.9)");
    expect(text).toContain("yes");
    expect(text).toContain("no");
    expect(text).toContain("user");
    expect(text).toContain("(not indexed)");
    expect(text).toContain("AAA0000000000001");
  });

  it("handles an empty mod list", () => {
    const text = formatModList({ configPath: "x", mods: [] });
    expect(text).toContain("no `game.mods[]` entries");
  });
});

describe("server-mgmt/mod-list — buildModListReport (integration)", () => {
  it("reads server.json, resolves mods, never echoes secrets", () => {
    const db = openProjectIndex(":memory:");
    try {
      const now = Date.now();
      db.prepare(
        "INSERT INTO projects (id, guid, title, root_path, source, last_scan) " +
          "VALUES (?, ?, ?, ?, ?, ?)",
      ).run("TestMod", "1111111111111111", "Test Mod", "/x", "workshop", now);
      db.prepare(
        "INSERT INTO resources (guid, file_path, root_type, class_name, parent_inherit, source, project_id, last_indexed) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        "FFEE000000000001",
        "Mods/Resolved/resolved.gproj",
        "GameProject",
        null,
        null,
        "workshop",
        "TestMod",
        now,
      );

      const cfg = JSON.stringify({
        bindAddress: "0.0.0.0",
        bindPort: 2001,
        a2s: { address: "0.0.0.0", port: 17777 },
        passwordAdmin: "secret-do-not-show",
        rcon: {
          address: "0.0.0.0",
          port: 19999,
          password: "rcon-secret",
        },
        game: {
          name: "Test",
          password: "join-secret",
          scenarioId: "{ABCD}M.conf",
          maxPlayers: 8,
          visible: false,
          gameProperties: {},
          mods: [
            { modId: "FFEE000000000001", name: "Resolved Mod" },
            { modId: "DEAD000000000099", name: "Missing Mod", version: "1.0" },
          ],
        },
      });
      const path = setup("server.json", cfg);

      const index = new ProjectIndex(db);
      const text = buildModListReport(path, index);

      expect(text).toContain("Resolved Mod");
      expect(text).toContain("Missing Mod");
      expect(text).toContain("Mods/Resolved/resolved.gproj");
      expect(text).toContain("yes");
      expect(text).toContain("no");
      // None of the secret values may leak.
      expect(text).not.toContain("secret-do-not-show");
      expect(text).not.toContain("rcon-secret");
      expect(text).not.toContain("join-secret");
    } finally {
      db.close();
    }
  });

  it("surfaces a missing config path as an error", () => {
    const db = openProjectIndex(":memory:");
    try {
      const index = new ProjectIndex(db);
      expect(() =>
        buildModListReport(
          join(TEST_DIR, "definitely-missing.json"),
          index,
        ),
      ).toThrow(/not found/);
    } finally {
      db.close();
    }
  });

  it("refuses a flag-smuggling path", () => {
    const db = openProjectIndex(":memory:");
    try {
      const index = new ProjectIndex(db);
      expect(() => buildModListReport("-config=evil.json", index)).toThrow(/CLI flag/);
    } finally {
      db.close();
    }
  });
});
