import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAssetSearch, invalidateAssetCache } from "../../src/tools/asset-search.js";
import { PakVirtualFS } from "../../src/pak/vfs.js";
import type { Config } from "../../src/config.js";

type Handler = (args: Record<string, unknown>) => Promise<{
  content: Array<{ text: string }>;
  isError?: boolean;
}>;

function captureHandler(gamePath: string): Handler {
  let handler: Handler | undefined;
  const fake = {
    registerTool: (_name: string, _def: unknown, h: Handler) => {
      handler = h;
    },
  } as unknown as McpServer;
  registerAssetSearch(fake, { gamePath } as unknown as Config);
  if (!handler) throw new Error("asset_search was not registered");
  return handler;
}

describe("asset_search: audio, particle and navmesh extensions", () => {
  let root: string;

  beforeEach(() => {
    invalidateAssetCache();
    root = mkdtempSync(join(tmpdir(), "asset-search-"));
    const data = join(root, "addons", "data");
    mkdirSync(join(data, "Sounds", "Footsteps"), { recursive: true });
    mkdirSync(join(data, "Particles"), { recursive: true });
    mkdirSync(join(data, "Navmeshes"), { recursive: true });
    writeFileSync(join(data, "Sounds", "Footsteps", "Zeta_Footsteps.acp"), "AudioClass {}");
    writeFileSync(join(data, "Sounds", "Zeta_Signal.sig"), "SignalClass {}");
    writeFileSync(join(data, "Sounds", "Zeta_Mixer.afm"), "AudioOutputStateResClass {}");
    writeFileSync(join(data, "Particles", "Zeta_Fire.ptc"), "ParticleEffect {}");
    writeFileSync(join(data, "Navmeshes", "Zeta_Mesh.nmn"), "EV");
    // An extension outside the list stays out of the index.
    writeFileSync(join(data, "Sounds", "Zeta_Raw.wav"), "RIFF");
  });

  afterEach(() => {
    invalidateAssetCache();
    rmSync(root, { recursive: true, force: true });
  });

  it.each([
    ["Zeta_Footsteps", "Footsteps/Zeta_Footsteps.acp"],
    ["Zeta_Signal", "Zeta_Signal.sig"],
    ["Zeta_Mixer", "Zeta_Mixer.afm"],
    ["Zeta_Fire", "Zeta_Fire.ptc"],
    ["Zeta_Mesh", "Zeta_Mesh.nmn"],
  ])("finds %s", async (query, tail) => {
    const res = await captureHandler(root)({ query, type: "any", limit: 20, refresh: true });
    expect(res.isError).toBeUndefined();
    expect(res.content[0].text).toContain(tail);
  });

  it("still does not index unlisted extensions", async () => {
    const res = await captureHandler(root)({
      query: "Zeta_Raw",
      type: "any",
      limit: 20,
      refresh: true,
    });
    expect(res.content[0].text).toMatch(/No assets found/);
  });

  it("keeps the existing extensions and type filters", async () => {
    writeFileSync(join(root, "addons", "data", "Zeta_Old.emat"), "MatPBRBasic {}");
    const res = await captureHandler(root)({
      query: "Zeta_Old",
      type: "material",
      limit: 20,
      refresh: true,
    });
    expect(res.content[0].text).toContain("Zeta_Old.emat");
  });
});

// ── GUIDs (audit read-knowledge-05) ─────────────────────────────────────────

/** Minimal uncompressed .pak (same layout as tests/pak/vfs.test.ts). */
function buildStoredPak(files: Array<{ path: string; content: string }>): Buffer {
  type F = { name: string; offset: number; len: number };
  type D = { name: string; children: Map<string, D | F> };
  const root: D = { name: "", children: new Map() };
  const chunks: Buffer[] = [];
  let off = 0;
  for (const f of files) {
    const raw = Buffer.from(f.content, "utf-8");
    const parts = f.path.split("/");
    const name = parts.pop()!;
    let dir = root;
    for (const part of parts) {
      let c = dir.children.get(part);
      if (!c || !("children" in c)) {
        c = { name: part, children: new Map() };
        dir.children.set(part, c);
      }
      dir = c as D;
    }
    dir.children.set(name, { name, offset: off, len: raw.length });
    chunks.push(raw);
    off += raw.length;
  }
  const ser = (e: D | F): Buffer => {
    const nb = Buffer.from(e.name, "utf-8");
    const h = Buffer.alloc(2);
    if ("children" in e) {
      h.writeUInt8(0, 0);
      h.writeUInt8(nb.length, 1);
      const cnt = Buffer.alloc(4);
      cnt.writeUInt32LE(e.children.size, 0);
      return Buffer.concat([h, nb, cnt, ...[...e.children.values()].map(ser)]);
    }
    h.writeUInt8(1, 0);
    h.writeUInt8(nb.length, 1);
    const m = Buffer.alloc(24);
    m.writeUInt32LE(e.offset, 0);
    m.writeUInt32LE(e.len, 4);
    m.writeUInt32LE(e.len, 8);
    return Buffer.concat([h, nb, m]);
  };
  const tree = ser(root);
  const data = Buffer.concat(chunks);
  const headLen = 0x1c;
  const head = Buffer.alloc(headLen);
  head.writeUInt16LE(1, 0);
  const total = 4 + 8 + headLen + 8 + data.length + 8 + tree.length;
  const buf = Buffer.alloc(8 + total);
  let p = 0;
  const tag = (t: string, len: number): void => {
    buf.write(t, p, 4, "ascii");
    p += 4;
    buf.writeUInt32BE(len, p);
    p += 4;
  };
  buf.write("FORM", p, 4, "ascii");
  p += 4;
  buf.writeUInt32BE(total, p);
  p += 4;
  buf.write("PAC1", p, 4, "ascii");
  p += 4;
  tag("HEAD", headLen);
  head.copy(buf, p);
  p += headLen;
  tag("DATA", data.length);
  data.copy(buf, p);
  p += data.length;
  tag("FILE", tree.length);
  tree.copy(buf, p);
  return buf;
}

describe("asset_search: GUIDs from entity catalogs", () => {
  let root: string;
  const PREFAB = "Prefabs/Groups/OPFOR/Group_Zeta_FireTeam.et";
  const GUID = "657590C1EC9E27D3";

  beforeEach(() => {
    PakVirtualFS.invalidate();
    invalidateAssetCache();
    root = mkdtempSync(join(tmpdir(), "asset-search-guid-"));
    mkdirSync(join(root, "addons", "data"), { recursive: true });
  });

  afterEach(() => {
    PakVirtualFS.invalidate();
    invalidateAssetCache();
    rmSync(root, { recursive: true, force: true });
  });

  it("reads EntityCatalog .conf files inside the paks (stock, pak-only install)", async () => {
    writeFileSync(
      join(root, "addons", "data", "data.pak"),
      buildStoredPak([
        { path: PREFAB, content: "SCR_AIGroup {}" },
        {
          path: "Configs/EntityCatalog/USSR/EntityCatalog_Zeta.conf",
          content: `SCR_EntityCatalog {\n m_sEntityPrefab "{${GUID}}${PREFAB}"\n}`,
        },
      ]),
    );
    const res = await captureHandler(root)({
      query: "Group_Zeta",
      type: "prefab",
      limit: 20,
      refresh: true,
    });
    expect(res.content[0].text).toContain(`{${GUID}}${PREFAB}`);
  });

  it("keeps the full resource path when a loose catalog names a pak prefab", async () => {
    writeFileSync(
      join(root, "addons", "data", "data.pak"),
      buildStoredPak([{ path: PREFAB, content: "SCR_AIGroup {}" }]),
    );
    const catDir = join(root, "addons", "data", "Data001", "Configs", "EntityCatalog");
    mkdirSync(catDir, { recursive: true });
    writeFileSync(
      join(catDir, "Cat.conf"),
      `SCR_EntityCatalog {\n m_sEntityPrefab "{${GUID}}${PREFAB}"\n}`,
    );
    const res = await captureHandler(root)({
      query: "Group_Zeta",
      type: "prefab",
      limit: 20,
      refresh: true,
    });
    expect(res.content[0].text).toContain(`{${GUID}}${PREFAB}`);
  });
});

// read-knowledge-11: refresh:true must also drop the cached pak tree.
describe("asset_search refresh", () => {
  it("invalidates the PakVirtualFS cache", async () => {
    const root = mkdtempSync(join(tmpdir(), "asset-search-refresh-"));
    mkdirSync(join(root, "addons", "data"), { recursive: true });
    const spy = vi.spyOn(PakVirtualFS, "invalidate");
    try {
      await captureHandler(root)({ query: "x", type: "any", limit: 5, refresh: true });
      expect(spy).toHaveBeenCalled();
      spy.mockClear();
      await captureHandler(root)({ query: "x", type: "any", limit: 5, refresh: false });
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
      invalidateAssetCache();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
