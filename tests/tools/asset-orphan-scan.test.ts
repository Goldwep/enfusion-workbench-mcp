import { describe, it, expect } from "vitest";
import { join } from "node:path";
import {
  encodeCursor,
  decodeCursor,
  normalizeExtensions,
  extractAssetRefs,
  computeOrphans,
  buildOrphanList,
  formatOrphanPage,
  DEFAULT_ASSET_EXTENSIONS,
} from "../../src/tools/asset-orphan-scan.js";

describe("asset-orphan-scan: normalizeExtensions", () => {
  it("strips leading dots, lowercases, dedupes, sorts", () => {
    const r = normalizeExtensions([".EDDS", "FBX", "edds", "ogg", ".OGG", "  acp  "]);
    expect(Array.from(r.set).sort()).toEqual(["acp", "edds", "fbx", "ogg"]);
    expect(r.joined).toBe("acp,edds,fbx,ogg");
  });
  it("drops empty strings and yields an empty set when given nothing valid", () => {
    const r = normalizeExtensions(["", " ", "."]);
    expect(r.set.size).toBe(0);
    expect(r.joined).toBe("");
  });
  it("DEFAULT_ASSET_EXTENSIONS covers textures/audio/meshes", () => {
    expect(DEFAULT_ASSET_EXTENSIONS).toEqual(
      expect.arrayContaining(["edds", "acp", "fbx", "ogg", "wav"]),
    );
  });
});

describe("asset-orphan-scan: extractAssetRefs", () => {
  it("matches {GUID}path refs whose tail extension is in the filter", () => {
    const content = `
      MatPBRBasic {
        AlbedoTexture "{AAAA111122223333}textures/wood.edds"
        NormalTexture "{BBBB444455556666}textures/wood_n.edds"
        AmbientSound "{CCCC777788889999}sounds/wind.ogg"
      }`;
    const refs = extractAssetRefs(content, new Set(["edds"]));
    expect(refs).toEqual([
      "textures/wood.edds",
      "textures/wood_n.edds",
    ]);
  });
  it("skips refs without an extension and refs whose ext is filtered out", () => {
    const content = `Foo {Bar "{AAAA111122223333}NoExt" Baz "{BBBB444455556666}ignored.fbx"}`;
    expect(extractAssetRefs(content, new Set(["edds"]))).toEqual([]);
  });
});

describe("asset-orphan-scan: computeOrphans", () => {
  it("returns sorted disk paths absent from the referenced set", () => {
    const onDisk = [
      "textures/c.edds",
      "textures/a.edds",
      "textures/b.edds",
    ];
    const referenced = new Set(["textures/b.edds"]);
    expect(computeOrphans(onDisk, referenced)).toEqual([
      "textures/a.edds",
      "textures/c.edds",
    ]);
  });
});

describe("asset-orphan-scan: buildOrphanList", () => {
  it("cross-references on-disk assets against per-project referenced sets", () => {
    const groups = [
      {
        project_id: "p1",
        root_path: "/projects/p1",
        source: "user" as const,
        indexed_files: ["materials/wood.emat"],
      },
      {
        project_id: "p2",
        root_path: "/projects/p2",
        source: "user" as const,
        indexed_files: ["materials/steel.emat"],
      },
    ];
    // Keys use platform-native join so they match what buildOrphanList
    // produces when joining root_path + relative file path.
    const fileContent = new Map<string, string>([
      [
        join("/projects/p1", "materials/wood.emat"),
        `MatPBRBasic { Albedo "{AAAA111122223333}textures/wood.edds" }`,
      ],
      [
        join("/projects/p2", "materials/steel.emat"),
        `MatPBRBasic { Albedo "{BBBB444455556666}textures/steel.edds" }`,
      ],
    ]);
    const diskAssets = new Map<string, string[]>([
      ["/projects/p1", ["textures/wood.edds", "textures/dead.edds"]],
      ["/projects/p2", ["textures/steel.edds", "textures/zombie.edds"]],
    ]);
    const rows = buildOrphanList(
      groups,
      new Set(["edds"]),
      (abs) => fileContent.get(abs) ?? null,
      (root) => diskAssets.get(root) ?? [],
    );
    expect(rows).toEqual([
      { project_id: "p1", file_path: "textures/dead.edds" },
      { project_id: "p2", file_path: "textures/zombie.edds" },
    ]);
  });
});

describe("asset-orphan-scan: cursor encoding", () => {
  it("round-trips a payload bound to source + extensions", () => {
    const enc = encodeCursor({ o: 50, s: "user", e: "edds,fbx", v: 1 });
    const dec = decodeCursor(enc, "user", "edds,fbx");
    expect(dec.o).toBe(50);
    expect(dec.s).toBe("user");
    expect(dec.e).toBe("edds,fbx");
  });
  it("rejects a cursor when source or extensions changed", () => {
    const enc = encodeCursor({ o: 10, s: "user", e: "edds", v: 1 });
    expect(() => decodeCursor(enc, "core", "edds")).toThrow("Invalid cursor");
    expect(() => decodeCursor(enc, "user", "fbx")).toThrow("Invalid cursor");
  });
  it("rejects malformed cursors", () => {
    expect(() => decodeCursor("!!!notbase64!!!", "*", "edds")).toThrow(
      "Invalid cursor",
    );
  });
});

describe("asset-orphan-scan: formatOrphanPage", () => {
  const baseRows = [
    { project_id: "p1", file_path: "textures/dead.edds" },
    { project_id: "p2", file_path: "textures/zombie.edds" },
  ];
  it("shows the next_cursor hint when more pages exist", () => {
    const out = formatOrphanPage({
      rows: baseRows,
      total: 5,
      offset: 0,
      sourceFilter: "user",
      extensionsLabel: "edds",
      nextCursor: "OPAQUE",
    });
    expect(out).toContain("Found 5 orphan assets");
    expect(out).toContain("source=user");
    expect(out).toContain("p1: textures/dead.edds");
    expect(out).toContain("next_cursor: OPAQUE");
  });
  it("emits the 'no orphans' message when total is zero", () => {
    const out = formatOrphanPage({
      rows: [],
      total: 0,
      offset: 0,
      sourceFilter: "*",
      extensionsLabel: "edds",
      nextCursor: null,
    });
    expect(out).toMatch(/no orphan assets found/i);
  });
});
