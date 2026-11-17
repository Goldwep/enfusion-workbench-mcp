import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  navDataFolderOf,
  readNmnHeader,
  readNtileHeader,
  sniffNavmeshBinary,
  tileIndexOf,
} from "../../src/formats/navmesh-binary.js";
import type { ActionError, ActionOk, ActionResponse } from "../../src/manifest/vocabulary.js";
import {
  NAVMESH_DESCRIPTION,
  NAVMESH_OVERRIDE_ARRAY_PROVEN,
  registerNavmesh,
  runNavmesh,
  type GameFiles,
  type NavmeshArgs,
} from "../../src/tools/navmesh.js";
import { captureTool, makeConfig, textOf } from "./_tool-harness.js";

// ── Synthetic binaries ───────────────────────────────────────────────────────

function nmn(opts: { version?: number; tile?: number; cells?: number } = {}): Buffer {
  const cells = opts.cells ?? 4;
  const head = Buffer.alloc(40);
  head.write("EV", 0, "latin1");
  head.writeUInt16LE(2, 2);
  head.writeUInt32LE(opts.version ?? 3, 4);
  head.writeFloatLE(opts.tile ?? 24, 0x14);
  head.writeFloatLE(opts.tile ?? 24, 0x18);
  head.writeUInt32LE(cells, 0x1c);
  head.writeUInt32LE(0x00100000, 0x20);
  const tfhe = Buffer.alloc(8 + cells * 16);
  tfhe.write("TFHE", 0, "latin1");
  tfhe.writeUInt32BE(cells * 16, 4);
  const form = Buffer.alloc(12);
  form.write("FORM", 0, "latin1");
  form.writeUInt32BE(4 + tfhe.length, 4);
  form.write("NAVM", 8, "latin1");
  return Buffer.concat([head, form, tfhe]);
}

function ntile(): Buffer {
  const tihe = Buffer.alloc(8 + 16, 0xab);
  tihe.write("TIHE", 0, "latin1");
  tihe.writeUInt32BE(16, 4);
  const form = Buffer.alloc(12);
  form.write("FORM", 0, "latin1");
  form.writeUInt32BE(4 + tihe.length, 4);
  form.write("NAVD", 8, "latin1");
  return Buffer.concat([form, tihe]);
}

// ── Fake game paks ───────────────────────────────────────────────────────────

class FakeGame implements GameFiles {
  constructor(private readonly files: Map<string, Buffer>) {}
  exists(rel: string): boolean {
    return this.files.has(rel) || [...this.files.keys()].some((k) => k.startsWith(`${rel}/`));
  }
  readFile(rel: string): Buffer {
    const b = this.files.get(rel);
    if (!b) throw new Error(`no ${rel}`);
    return b;
  }
  listDir(rel: string) {
    const prefix = rel === "" ? "" : `${rel}/`;
    const seen = new Map<string, { name: string; isDirectory: boolean; size: number }>();
    for (const [k, v] of this.files) {
      if (!k.startsWith(prefix)) continue;
      const rest = k.slice(prefix.length);
      const i = rest.indexOf("/");
      const name = i < 0 ? rest : rest.slice(0, i);
      if (!seen.has(name))
        seen.set(name, { name, isDirectory: i >= 0, size: i < 0 ? v.length : 0 });
    }
    return [...seen.values()];
  }
}

const GAME_CONF = [
  "BaseNavmeshFilesConfig {",
  ' NavmeshFile "{1111111111111111}worlds/Test/Test.nmn"',
  "}",
].join("\n");

const GAME_CONF_CHILD = [
  'BaseNavmeshFilesConfig : "{2222222222222222}Configs/Navmesh/Navmesh_Test.conf" {',
  "}",
].join("\n");

const NOT_NAV_CONF = ["SCR_Other {", " m_i 1", "}"].join("\n");

const AIW_PREFAB = [
  "SCR_AIWorld {",
  " components {",
  '  NavmeshWorldComponent "{AAAAAAAAAAAAAAAA}" {',
  '   WorldSettings NavmeshWorldParams "{A1}" {',
  "    MapMaxY 1000",
  "    TileSize 24",
  "   }",
  '   NavmeshSettings NavmeshWorld "{A2}" {',
  '    NavmeshProject "Soldiers"',
  "    UseNavmeshStreaming 1",
  '    LowResolutionNavmesh "LowRes"',
  "   }",
  "  }",
  '  NavmeshWorldComponent "{BBBBBBBBBBBBBBBB}" {',
  '   WorldSettings NavmeshWorldParams "{B1}" {',
  "    TileSize 204",
  "   }",
  '   NavmeshSettings NavmeshWorld "{B2}" {',
  '    NavmeshFilesConfig BaseNavmeshFilesConfig "{B3}" : "{2222222222222222}Configs/Navmesh/Navmesh_Test.conf" {',
  "    }",
  '    NavmeshProject "LowRes"',
  "   }",
  "  }",
  " }",
  "}",
].join("\n");

const BIN_WORLD = Buffer.concat([Buffer.from("EBIN", "latin1"), Buffer.from([0, 1, 2, 3])]);

function gameFiles(): Map<string, Buffer> {
  const m = new Map<string, Buffer>();
  m.set("Configs/Navmesh/Navmesh_Test.conf", Buffer.from(GAME_CONF));
  m.set("Configs/Navmesh/Navmesh_Child.conf", Buffer.from(GAME_CONF_CHILD));
  m.set("Configs/Navmesh/Navmesh_Empty.conf", Buffer.from("BaseNavmeshFilesConfig {\n}"));
  m.set("Configs/Other.conf", Buffer.from(NOT_NAV_CONF));
  m.set("Prefabs/AI/AIW.et", Buffer.from(AIW_PREFAB));
  m.set("worlds/Test/Test.nmn", nmn({ cells: 9 }));
  for (let i = 0; i < 5; i++) m.set(`worlds/Test/.NavData/Test/navData_${i}.ntile`, ntile());
  m.set("worlds/Test/.NavData/Test/readme.txt", Buffer.from("x"));
  m.set("worlds/Short/Short.nmn", Buffer.from("EV\x02\x00", "latin1"));
  m.set("worlds/Bin/Bin.ent", BIN_WORLD);
  return m;
}

// ── Project and game install on disk ─────────────────────────────────────────

let root: string;
let gameDir: string;
let emptyRoot: string;
const game = new FakeGame(gameFiles());

const PROJECT_ENT = ["SCR_MapEntity Map {", " coords 0 0 0", "}"].join("\n");
const PROJECT_LAYER = [
  'SCR_AIWorld AIWorld1 : "{0123456789ABCDEF}Prefabs/AI/AIW.et" {',
  " components {",
  '  NavmeshWorldComponent "{AAAAAAAAAAAAAAAA}" {',
  '   NavmeshSettings NavmeshWorld "{A2}" {',
  '    NavmeshFilesConfig BaseNavmeshFilesConfig "{A9}" {',
  '     NavmeshFile "{3333333333333333}worlds/My/My.nmn"',
  "    }",
  "   }",
  "  }",
  " }",
  " coords 1 2 3",
  "}",
  'GenericEntity Box : "{0000000000000001}Prefabs/Box.et" {',
  "}",
].join("\n");

const GAME_GPROJ = [
  "GameProject {",
  ' ID "Game"',
  " Configurations {",
  "  GameProjectConfig PC {",
  '   NavmeshManager NavmeshManager "{B462A58A882A1448}" {',
  "    ProjectSettings {",
  "     NavmeshProjectConfig Soldiers {",
  "      PhysicsInteractionLayer 0x200000 0",
  "      DefaultWalkableFlags 0x3e 0",
  '      AreaTypeForTerrain "OffRoad"',
  "      FlagTypes {",
  "       NavmeshAreaFlagConfig JumpOver {",
  "       }",
  "      }",
  "      AreaTypes {",
  "       NavmeshAreaTypeConfig Fence {",
  "        AreaFlags 0x4 0x2",
  "        AreaCost 25",
  "       }",
  "      }",
  "     }",
  "     NavmeshProjectConfig BTRlike {",
  "      ResponseIndexToAreaTypeConversion {",
  '       ResponseIndexToAreaTypeConversionConfig "{62CED692F1A6E7FA}" {',
  '        ResponseIndex "TinyDestructible"',
  "        AreaType 6",
  "       }",
  "      }",
  "      Extra 1",
  "     }",
  "    }",
  "   }",
  "  }",
  " }",
  "}",
].join("\n");

function put(base: string, rel: string, data: string | Buffer): string {
  const f = join(base, rel);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, data);
  return f;
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "navmesh-proj-"));
  gameDir = mkdtempSync(join(tmpdir(), "navmesh-game-"));
  emptyRoot = mkdtempSync(join(tmpdir(), "navmesh-empty-"));
  put(root, "Mod.gproj", 'GameProject {\n ID "Mod"\n}');
  put(root, "worlds/My/My.ent", PROJECT_ENT);
  put(root, "worlds/My/My_Layers/default.layer", PROJECT_LAYER);
  put(root, "worlds/My/My_Layers/notes.txt", "x");
  const nm = put(root, "worlds/My/My.nmn", nmn({ cells: 4 }));
  put(
    root,
    "worlds/My/My.nmn.meta",
    'MetaFileClass {\n Name "{3333333333333333}worlds/My/My.nmn"\n}',
  );
  const old = new Date("2026-01-01T00:00:00Z");
  utimesSync(nm, old, old);
  for (let i = 0; i < 3; i++) {
    const t = put(root, `worlds/My/.NavData/My/navData_${i}.ntile`, ntile());
    const when = i === 0 ? new Date("2025-12-01T00:00:00Z") : new Date("2026-02-01T00:00:00Z");
    utimesSync(t, when, when);
  }
  put(root, "worlds/Bad/Bad.nmn", nmn());
  put(gameDir, "addons/data/Game.gproj", GAME_GPROJ);
  put(gameDir, "addons/core/core.gproj", 'GameProject {\n ID "core"\n}');
});

afterAll(() => {
  for (const d of [root, gameDir, emptyRoot]) rmSync(d, { recursive: true, force: true });
});

function run(
  args: Partial<NavmeshArgs> & { action: NavmeshArgs["action"] },
  opts: { root?: string | null; g?: GameFiles | null } = {},
): ActionResponse {
  const config = makeConfig({
    projectPath: opts.root === null ? "" : (opts.root ?? root),
    gamePath: gameDir,
  });
  return runNavmesh(args as NavmeshArgs, config, opts.g === undefined ? game : opts.g);
}

// The readbacks are free-form JSON: the tests walk them without a schema.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Readback = Record<string, any>;

function okOf(r: ActionResponse): ActionOk & { readback: Readback } {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}: ${r.message}`);
  return r as ActionOk & { readback: Readback };
}

function errOf(r: ActionResponse): ActionError {
  if (r.ok)
    throw new Error(`expected an error, got ok: ${JSON.stringify(r.readback).slice(0, 300)}`);
  return r;
}

// ── navmesh-binary ───────────────────────────────────────────────────────────

describe("navmesh-binary", () => {
  it("reads a .nmn header: magic, version, tile size, FORM/NAVM/TFHE, raw fields", () => {
    const h = readNmnHeader(nmn({ version: 2, tile: 51, cells: 9 }));
    expect(h.ok).toBe(true);
    expect(h.magic).toBe("EV");
    expect(h.magicVersion).toBe(2);
    expect(h.version).toBe(2);
    expect(h.tileSize).toEqual([51, 51]);
    expect(h.form?.type).toBe("NAVM");
    expect(h.form?.offset).toBe(40);
    expect(h.form?.sizeMatches).toBe(true);
    expect(h.form?.chunksCover).toBe(true);
    expect(h.form?.chunks.map((c) => c.id)).toEqual(["TFHE"]);
    expect(h.observed).toEqual({ cellsAt0x1c: 9, tfheRecords16: 9, agrees: true });
    expect(h.raw.map((r) => r.offset)).toEqual(["0x08", "0x0c", "0x10", "0x1c", "0x20", "0x24"]);
    expect(h.raw.find((r) => r.offset === "0x20")?.hex).toBe("00001000");
  });

  it("never throws on a short, empty or foreign file", () => {
    for (const b of [
      Buffer.alloc(0),
      Buffer.from("EV"),
      Buffer.from("hello world, not a navmesh at all, padding padding"),
    ]) {
      const h = readNmnHeader(b);
      expect(h.ok).toBe(false);
      expect(h.problems.length).toBeGreaterThan(0);
      const t = readNtileHeader(b);
      expect(t.ok).toBe(false);
    }
  });

  it("flags a FORM whose size does not end at the file's end and a wrong type", () => {
    const b = Buffer.concat([nmn(), Buffer.from([0, 0])]);
    const h = readNmnHeader(b);
    expect(h.ok).toBe(false);
    expect(h.form?.sizeMatches).toBe(false);
    const wrong = nmn();
    wrong.write("XXXX", 48, "latin1");
    expect(readNmnHeader(wrong).problems.join()).toMatch(/not "NAVM"/);
  });

  it("reads a .ntile header: FORM/NAVD/TIHE", () => {
    const t = readNtileHeader(ntile());
    expect(t.ok).toBe(true);
    expect(t.form?.type).toBe("NAVD");
    expect(t.form?.chunks[0]).toMatchObject({ id: "TIHE", size: 16 });
    expect(t.firstChunkHead).toBe("ab".repeat(16));
  });

  it("names the tile folder and tile index and sniffs the kind", () => {
    expect(navDataFolderOf("worlds/MP/Navmeshes/X.nmn")).toBe("worlds/MP/Navmeshes/.NavData/X");
    expect(navDataFolderOf("X.NMN")).toBe(".NavData/X");
    expect(tileIndexOf("navData_12.ntile")).toBe(12);
    expect(tileIndexOf("other.ntile")).toBeUndefined();
    expect(sniffNavmeshBinary(nmn())).toBe("nmn");
    expect(sniffNavmeshBinary(ntile())).toBe("ntile");
    expect(sniffNavmeshBinary(Buffer.from("xx"))).toBeUndefined();
  });
});

// ── The tool ─────────────────────────────────────────────────────────────────

describe("navmesh tool: registration", () => {
  it("has the spec's description within 400 characters", () => {
    expect(NAVMESH_DESCRIPTION.length).toBe(333);
    expect(NAVMESH_DESCRIPTION).not.toMatch(/sandbox|EMCP2/i);
  });

  it("registers `navmesh` and answers JSON with isError on a refusal", async () => {
    const names: string[] = [];
    registerNavmesh(
      { registerTool: (n: string) => names.push(n) } as unknown as Parameters<
        typeof registerNavmesh
      >[0],
      makeConfig({}),
    );
    expect(names).toEqual(["navmesh"]);
    const h = captureTool((s) =>
      registerNavmesh(s, makeConfig({ projectPath: emptyRoot, gamePath: gameDir })),
    );
    const r = await h({ action: "header" });
    expect(r.isError).toBe(true);
    expect(JSON.parse(textOf(r)).code).toBe("INVALID_ARGUMENT");
  });

  it("refuses an unknown action", () => {
    expect(errOf(run({ action: "bake" as NavmeshArgs["action"] })).code).toBe("INVALID_ARGUMENT");
  });
});

describe("navmesh header", () => {
  it("reads a game .nmn and a game .ntile", () => {
    const r = okOf(run({ action: "header", path: "{1111111111111111}worlds/Test/Test.nmn" }));
    expect(r.target).toBe("path:worlds/Test/Test.nmn");
    expect(r.readback).toMatchObject({ source: "game", format: "nmn", ok: true, version: 3 });
    expect(r.next).toMatch(/P-W5-17/);
    const t = okOf(run({ action: "header", path: "worlds/Test/.NavData/Test/navData_3.ntile" }));
    expect(t.readback).toMatchObject({ format: "ntile", ok: true });
  });

  it("reads a project .nmn with its mtime, and warns on a short file", () => {
    const r = okOf(run({ action: "header", path: "worlds/My/My.nmn" }));
    expect(r.readback.source).toBe("project");
    expect(r.readback.mtime).toBe("2026-01-01T00:00:00.000Z");
    const s = okOf(run({ action: "header", path: "worlds/Short/Short.nmn" }));
    expect(s.readback.ok).toBe(false);
    expect(s.warnings[0]).toMatch(/does not read as expected/);
  });

  it("refuses another type, a missing file, a missing path and an escape", () => {
    expect(errOf(run({ action: "header", path: "Configs/Navmesh/Navmesh_Test.conf" })).code).toBe(
      "INVALID_ARGUMENT",
    );
    expect(errOf(run({ action: "header", path: "worlds/None.nmn" })).code).toBe("PATH_NOT_FOUND");
    expect(errOf(run({ action: "header" })).code).toBe("INVALID_ARGUMENT");
    expect(errOf(run({ action: "header", path: "../outside.nmn" })).code).toBe("ABSOLUTE_PATH");
    expect(errOf(run({ action: "header", path: join(tmpdir(), "elsewhere.nmn") })).code).toBe(
      "NOT_IN_PROJECT",
    );
  });

  it("reads game files with no project root, and refuses an absolute path then", () => {
    const r = okOf(run({ action: "header", path: "worlds/Test/Test.nmn" }, { root: null }));
    expect(r.readback.source).toBe("game");
    expect(errOf(run({ action: "header", path: join(root, "x.nmn") }, { root: null })).code).toBe(
      "NOT_IN_PROJECT",
    );
  });

  it("finds a game path in another casing", () => {
    const r = okOf(run({ action: "header", path: "WORLDS/test/test.nmn" }));
    expect(r.target).toBe("path:worlds/Test/Test.nmn");
  });
});

describe("navmesh tiles", () => {
  it("pages the game tiles with a cursor and counts the other files", () => {
    const p1 = okOf(run({ action: "tiles", path: "worlds/Test/Test.nmn", limit: 2 }));
    expect(p1.readback.total).toBe(5);
    expect(p1.readback.count).toBe(2);
    expect(p1.readback.rows.map((r: { index: number }) => r.index)).toEqual([0, 1]);
    expect(p1.readback.nextCursor).toBe("2:5");
    expect(p1.readback.summary).toMatchObject({ source: "game", count: 5, otherFiles: 1 });
    expect(p1.readback.summary.bytes).toBe(5 * ntile().length);
    expect(p1.next).toMatch(/cursor:"2:5"/);
    const p3 = okOf(
      run({ action: "tiles", path: "worlds/Test/Test.nmn", limit: 2, cursor: "4:5" }),
    );
    expect(p3.readback.rows.map((r: { index: number }) => r.index)).toEqual([4]);
    expect(p3.readback.nextCursor).toBeUndefined();
  });

  it("refuses a stale and a malformed cursor", () => {
    expect(errOf(run({ action: "tiles", path: "worlds/Test/Test.nmn", cursor: "2:9" })).code).toBe(
      "STALE_CURSOR",
    );
    expect(errOf(run({ action: "tiles", path: "worlds/Test/Test.nmn", cursor: "x" })).code).toBe(
      "INVALID_ARGUMENT",
    );
  });

  it("lists project tiles with mtimes and their age against the .nmn", () => {
    const r = okOf(run({ action: "tiles", path: "worlds/My/My.nmn" }));
    expect(r.readback.rows[0]).toMatchObject({ name: "navData_0.ntile", index: 0 });
    expect(r.readback.rows[0].mtime).toBe("2025-12-01T00:00:00.000Z");
    expect(r.readback.summary).toMatchObject({
      source: "project",
      count: 3,
      newest: "2026-02-01T00:00:00.000Z",
      oldest: "2025-12-01T00:00:00.000Z",
      tilesNewerThanNmn: 2,
    });
  });

  it("warns when the tile folder is missing and refuses a non-.nmn", () => {
    const r = okOf(run({ action: "tiles", path: "worlds/Bad/Bad.nmn" }));
    expect(r.readback.total).toBe(0);
    expect(r.warnings[0]).toMatch(/no tile folder/);
    expect(errOf(run({ action: "tiles", path: "Prefabs/AI/AIW.et" })).code).toBe(
      "INVALID_ARGUMENT",
    );
  });
});

describe("navmesh config", () => {
  it("reads a game navmesh files config and checks its .nmn", () => {
    const r = okOf(run({ action: "config", path: "Configs/Navmesh/Navmesh_Test.conf" }));
    expect(r.readback).toMatchObject({
      source: "game",
      rootClass: "BaseNavmeshFilesConfig",
      navmeshFile: "{1111111111111111}worlds/Test/Test.nmn",
      navmeshFileResolves: true,
      byteExact: true,
    });
    expect(r.next).toMatch(/overrideConfig/);
  });

  it("follows the ancestor for NavmeshFile", () => {
    const r = okOf(run({ action: "config", path: "Configs/Navmesh/Navmesh_Child.conf" }));
    expect(r.readback.ancestor).toBe("{2222222222222222}Configs/Navmesh/Navmesh_Test.conf");
    expect(r.readback.navmeshFileFrom).toBe("Configs/Navmesh/Navmesh_Test.conf");
  });

  it("warns on another root class and lists its keys; refuses a non-.conf", () => {
    const r = okOf(run({ action: "config", path: "Configs/Other.conf" }));
    expect(r.warnings.join()).toMatch(/not BaseNavmeshFilesConfig/);
    expect(r.readback.otherKeys).toEqual(["m_i"]);
    expect(errOf(run({ action: "config", path: "worlds/Test/Test.nmn" })).code).toBe(
      "INVALID_ARGUMENT",
    );
  });
});

describe("navmesh status", () => {
  it("a navmesh files config: every listed .nmn resolves, with its tile count", () => {
    const r = okOf(run({ action: "status", path: "Configs/Navmesh/Navmesh_Test.conf" }));
    expect(r.readback.kind).toBe("filesConfig");
    const n = r.readback.navmeshes[0];
    expect(n).toMatchObject({
      resolves: true,
      source: "game",
      file: "worlds/Test/Test.nmn",
      guid: "1111111111111111",
    });
    expect(n.header).toMatchObject({ ok: true, version: 3, tileSize: [24, 24], cells: 9 });
    expect(n.tiles).toMatchObject({ count: 5, source: "game" });
  });

  it("a config with no NavmeshFile warns", () => {
    const r = okOf(run({ action: "status", path: "Configs/Navmesh/Navmesh_Empty.conf" }));
    expect(r.readback.navmeshes).toEqual([]);
    expect(r.warnings.join()).toMatch(/lists no NavmeshFile/);
  });

  it("a .nmn directly", () => {
    const r = okOf(run({ action: "status", path: "worlds/My/My.nmn" }));
    expect(r.readback.kind).toBe("navmesh");
    expect(r.readback.navmeshes[0]).toMatchObject({ source: "project" });
    expect(r.readback.navmeshes[0].guidMatchesMeta).toBeUndefined();
    expect(r.readback.navmeshes[0].tiles.count).toBe(3);
  });

  it("an AIWorld prefab: its components, the .conf they inherit and the .nmn", () => {
    const r = okOf(run({ action: "status", path: "Prefabs/AI/AIW.et" }));
    const w = r.readback.aiWorlds[0];
    expect(w.class).toBe("SCR_AIWorld");
    expect(w.components.map((c: { project: string }) => c.project)).toEqual(["Soldiers", "LowRes"]);
    const low = w.components[1];
    expect(low.tileSize).toBe("204");
    expect(low.filesConfigRef).toBe("{2222222222222222}Configs/Navmesh/Navmesh_Test.conf");
    expect(low.filesConfig.navmeshFile).toBe("{1111111111111111}worlds/Test/Test.nmn");
    expect(low.navmesh.resolves).toBe(true);
    expect(w.components[0].navmesh).toBeNull();
  });

  it("a project world: the AIWorld in a layer, merged with its prefab", () => {
    const r = okOf(run({ action: "status", path: "worlds/My/My.ent" }));
    expect(r.readback.kind).toBe("world");
    const w = r.readback.aiWorlds[0];
    expect(w.entity).toBe("worlds/My/My_Layers/default.layer:AIWorld1");
    expect(w.prefab).toBe("{0123456789ABCDEF}Prefabs/AI/AIW.et");
    expect(w.chain).toEqual(["worlds/My/My_Layers/default.layer", "Prefabs/AI/AIW.et"]);
    const s = w.components[0];
    expect(s).toMatchObject({
      id: "{AAAAAAAAAAAAAAAA}",
      project: "Soldiers",
      tileSize: "24",
      streaming: "1",
      navmeshFile: "{3333333333333333}worlds/My/My.nmn",
    });
    expect(s.from).toEqual(["worlds/My/My_Layers/default.layer", "Prefabs/AI/AIW.et"]);
    expect(s.navmesh).toMatchObject({ resolves: true, source: "project", guidMatchesMeta: true });
    expect(s.navmesh.tiles.tilesNewerThanNmn).toBe(2);
  });

  it("a packed (binary) world warns, and a world with no AIWorld says so", () => {
    const r = okOf(run({ action: "status", path: "worlds/Bin/Bin.ent" }));
    expect(r.readback.aiWorlds).toEqual([]);
    expect(r.warnings.join()).toMatch(/binary \(packed\) world/);
    expect(r.warnings.join()).toMatch(/no AIWorld entity/);
  });

  it("refuses another type and a missing file", () => {
    expect(errOf(run({ action: "status", path: "Mod.gproj" })).code).toBe("INVALID_ARGUMENT");
    expect(errOf(run({ action: "status", path: "worlds/None.ent" })).code).toBe("PATH_NOT_FOUND");
  });
});

describe("navmesh projects", () => {
  it("falls back to the game's .gproj when the project's sets none", () => {
    const r = okOf(run({ action: "projects" }));
    expect(r.readback).toMatchObject({ source: "game", file: "addons/data/Game.gproj", total: 2 });
    expect(r.warnings.join()).toMatch(/sets no NavmeshManager/);
    const [s, b] = r.readback.projects;
    expect(s).toMatchObject({
      name: "Soldiers",
      configuration: "PC",
      physicsInteractionLayer: "0x200000 0",
      defaultWalkableFlags: "0x3e 0",
      areaTypeForTerrain: "OffRoad",
      flagTypes: ["JumpOver"],
      areaTypes: [{ name: "Fence", areaFlags: "0x4 0x2", areaCost: "25" }],
    });
    expect(b.responseIndexConversions).toEqual([
      { responseIndex: "TinyDestructible", areaType: "6" },
    ]);
    expect(b.otherKeys).toEqual(["Extra"]);
    expect(r.next).toMatch(/project_settings/);
  });

  it("reads the project's .gproj when it has navmesh projects, with a limit", () => {
    const own = mkdtempSync(join(tmpdir(), "navmesh-own-"));
    try {
      put(own, "Own.gproj", GAME_GPROJ);
      const r = okOf(run({ action: "projects", limit: 1 }, { root: own }));
      expect(r.readback).toMatchObject({
        source: "project",
        file: "Own.gproj",
        total: 2,
        truncated: true,
      });
      expect(r.readback.projects).toHaveLength(1);
      const p = okOf(run({ action: "projects", path: "Own.gproj" }, { root: own }));
      expect(p.readback.total).toBe(2);
      put(own, "Two.gproj", GAME_GPROJ);
      expect(errOf(run({ action: "projects" }, { root: own })).code).toBe("INVALID_ARGUMENT");
    } finally {
      rmSync(own, { recursive: true, force: true });
    }
  });

  it("refuses a path that is not a .gproj, a missing one, and no source at all", () => {
    expect(errOf(run({ action: "projects", path: "worlds/My/My.ent" })).code).toBe(
      "INVALID_ARGUMENT",
    );
    expect(errOf(run({ action: "projects", path: "None.gproj" })).code).toBe("PATH_NOT_FOUND");
    expect(errOf(run({ action: "projects", path: "Mod.gproj" }, { root: null })).code).toBe(
      "NOT_IN_PROJECT",
    );
    const r = runNavmesh(
      { action: "projects" },
      makeConfig({ projectPath: "", gamePath: join(emptyRoot, "nogame") }),
      null,
    );
    expect(errOf(r).code).toBe("PATH_NOT_FOUND");
  });
});

describe("navmesh overrideConfig", () => {
  const PATH = "Configs/Navmesh/Navmesh_Test.conf";

  it("is a dry run by default: the copy is the vanilla file byte for byte", () => {
    const r = okOf(run({ action: "overrideConfig", path: PATH }, { root: emptyRoot }));
    expect(r.readback).toMatchObject({
      dryRun: true,
      created: PATH,
      replaces: false,
      diff: "(no change)",
    });
    expect(r.readback.text).toBe(GAME_CONF);
    expect(r.changed).toEqual([{ path: "file", before: null, after: PATH }]);
    expect(existsSync(join(emptyRoot, PATH))).toBe(false);
    expect(r.next).toMatch(/confirm:true/);
  });

  it("points the copy at another .nmn, changing only that value", () => {
    const r = okOf(
      run(
        {
          action: "overrideConfig",
          path: PATH,
          navmeshFile: "{4444444444444444}worlds/Mine/Mine.nmn",
        },
        { root: emptyRoot },
      ),
    );
    expect(r.readback.text).toBe(
      GAME_CONF.replace(
        "{1111111111111111}worlds/Test/Test.nmn",
        "{4444444444444444}worlds/Mine/Mine.nmn",
      ),
    );
    expect(r.changed?.[1]).toEqual({
      path: "NavmeshFile",
      before: "{1111111111111111}worlds/Test/Test.nmn",
      after: "{4444444444444444}worlds/Mine/Mine.nmn",
    });
    expect(r.warnings.join()).toMatch(/neither the project nor the game data yet/);
  });

  it("writes with confirm, refuses a second copy, and keeps a .bak on overwrite", () => {
    const proj = mkdtempSync(join(tmpdir(), "navmesh-write-"));
    try {
      const w = okOf(run({ action: "overrideConfig", path: PATH, confirm: true }, { root: proj }));
      expect(w.readback).toMatchObject({ dryRun: false, written: true, verified: true });
      expect(readFileSync(join(proj, PATH), "utf-8")).toBe(GAME_CONF);
      expect(w.next).toMatch(/wb_resources register/);
      const again = errOf(
        run({ action: "overrideConfig", path: PATH, confirm: true }, { root: proj }),
      );
      expect(again.code).toBe("INVALID_ARGUMENT");
      expect(again.message).toMatch(/overwrite:true/);
      writeFileSync(join(proj, PATH), "edited");
      const o = okOf(
        run(
          {
            action: "overrideConfig",
            path: PATH,
            confirm: true,
            overwrite: true,
            navmeshFile: "worlds/Test/Test.nmn",
          },
          { root: proj },
        ),
      );
      expect(o.readback.backup).toBe(`${PATH}.bak`);
      expect(readFileSync(join(proj, `${PATH}.bak`), "utf-8")).toBe("edited");
      expect(readFileSync(join(proj, PATH), "utf-8")).toContain(
        'NavmeshFile "worlds/Test/Test.nmn"',
      );
      expect(o.warnings.join()).toMatch(/has no GUID/);
      // A second overwrite keeps the first backup (the original bytes): review W4-AS-1.
      const o2 = okOf(
        run(
          { action: "overrideConfig", path: PATH, confirm: true, overwrite: true },
          { root: proj },
        ),
      );
      expect(o2.readback.backup).toBe(`${PATH}.bak2`);
      expect(readFileSync(join(proj, `${PATH}.bak`), "utf-8")).toBe("edited");
      expect(o2.next).toContain(`${PATH}.bak2`);
    } finally {
      rmSync(proj, { recursive: true, force: true });
    }
  });

  it("answers GATED for the override array, naming the switch's reason", () => {
    expect(NAVMESH_OVERRIDE_ARRAY_PROVEN).toBe(false);
    const r = errOf(
      run(
        { action: "overrideConfig", path: PATH, overrides: ["worlds/x.nmn"] },
        { root: emptyRoot },
      ),
    );
    expect(r.code).toBe("GATED");
    expect(r.message).toMatch(/NavmeshFileOveride/);
  });

  it("refuses without a project, outside it, off the game, on another class and a bad navmeshFile", () => {
    expect(errOf(run({ action: "overrideConfig", path: PATH }, { root: null })).code).toBe(
      "NOT_IN_PROJECT",
    );
    expect(errOf(run({ action: "overrideConfig", path: "../x.conf" })).code).toBe("ABSOLUTE_PATH");
    expect(errOf(run({ action: "overrideConfig", path: "Configs/Navmesh/None.conf" })).code).toBe(
      "PATH_NOT_FOUND",
    );
    expect(errOf(run({ action: "overrideConfig", path: "Configs/Other.conf" })).code).toBe(
      "INVALID_ARGUMENT",
    );
    expect(errOf(run({ action: "overrideConfig", path: "worlds/Test/Test.nmn" })).code).toBe(
      "INVALID_ARGUMENT",
    );
    expect(
      errOf(
        run(
          { action: "overrideConfig", path: PATH, navmeshFile: "worlds/x.conf" },
          { root: emptyRoot },
        ),
      ).code,
    ).toBe("INVALID_ARGUMENT");
    expect(
      errOf(
        run({ action: "overrideConfig", path: PATH, navmeshFile: 'a"b.nmn' }, { root: emptyRoot }),
      ).code,
    ).toBe("INVALID_ARGUMENT");
    expect(
      errOf(run({ action: "overrideConfig", path: PATH }, { root: emptyRoot, g: null })).code,
    ).toBe("PATH_NOT_FOUND");
  });
});

// Census rows this file tests (W5 close-out, EV-W5-081).
// census:mcp:action/navmesh.config
// census:mcp:action/navmesh.header
// census:mcp:action/navmesh.projects
// census:mcp:action/navmesh.status
// census:mcp:action/navmesh.tiles
