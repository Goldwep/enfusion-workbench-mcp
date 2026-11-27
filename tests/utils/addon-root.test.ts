/**
 * live-tools-a-01: every addon-writing tool reads ENFUSION_PROJECT_PATH the way src/config.ts
 * documents it (the addons directory; each addon a child folder holding a .gproj), through one
 * helper (src/utils/addon-root.ts). The wiring tests go through each tool's registration, the
 * code path the live batteries bypass by injecting projectRoot.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "../../src/config.js";
import type { WorkbenchClient } from "../../src/workbench/client.js";
import { resolveAddonRoot, worldPrefixRefusal } from "../../src/utils/addon-root.js";
import { registerWbWorld } from "../../src/tools/wb-world.js";
import { registerWbTerrainEdit } from "../../src/tools/wb-terrain-edit.js";
import { registerWbWorldTools } from "../../src/tools/wb-world-tools.js";
import { registerWbEntityDuplicate } from "../../src/tools/wb-entity-duplicate.js";
import { captureTool, makeConfig, textOf } from "../tools/_tool-harness.js";

let base: string;
let addons: string;

function addon(folder: string, id = folder): string {
  const dir = join(addons, folder);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "addon.gproj"), `GameProject {\n ID "${id}"\n GUID "0123456789ABCDEF"\n}\n`);
  return dir;
}

function put(rel: string, text: string): void {
  const p = join(addons, rel);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, text);
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "addon-root-"));
  addons = join(base, "addons");
  mkdirSync(addons);
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

describe("resolveAddonRoot", () => {
  it("takes the only addon under the addons folder", () => {
    const dir = addon("MyMod");
    expect(resolveAddonRoot({ projectPath: addons })).toEqual({ ok: true, root: resolve(dir) });
  });

  it("takes a projectPath that itself holds a .gproj as that addon", () => {
    const dir = addon("MyMod");
    expect(resolveAddonRoot({ projectPath: dir })).toEqual({ ok: true, root: resolve(dir) });
  });

  it("picks by modName, then by default mod, by folder name or by .gproj ID", () => {
    const a = addon("A");
    const b = addon("BFolder", "B_Id");
    expect(resolveAddonRoot({ projectPath: addons }, { modName: "A" })).toMatchObject({
      root: resolve(a),
    });
    expect(resolveAddonRoot({ projectPath: addons, defaultMod: "BFolder" })).toMatchObject({
      root: resolve(b),
    });
    expect(resolveAddonRoot({ projectPath: addons, defaultMod: "B_Id" })).toMatchObject({
      root: resolve(b),
    });
    expect(resolveAddonRoot({ projectPath: addons }, { modName: "Nope" })).toMatchObject({
      ok: false,
      code: "NOT_IN_PROJECT",
    });
    expect(resolveAddonRoot({ projectPath: addons }, { modName: "../x" })).toMatchObject({
      ok: false,
    });
  });

  it("refuses several addons with no name unless firstIfSeveral, and none at all", () => {
    expect(resolveAddonRoot({ projectPath: addons })).toMatchObject({ ok: false });
    addon("B");
    const a = addon("A");
    const r = resolveAddonRoot({ projectPath: addons });
    expect(r).toMatchObject({ ok: false, code: "NOT_IN_PROJECT" });
    expect(!r.ok && r.message).toMatch(/ENFUSION_DEFAULT_MOD/);
    expect(resolveAddonRoot({ projectPath: addons }, { firstIfSeveral: true })).toMatchObject({
      root: resolve(a),
    });
    expect(resolveAddonRoot({ projectPath: join(base, "missing") })).toMatchObject({ ok: false });
    expect(resolveAddonRoot({})).toMatchObject({ ok: false });
  });

  it("worldPrefixRefusal: a world of another addon is refused, folder or ID matches pass", () => {
    const dir = addon("MyFolder", "MyId");
    expect(worldPrefixRefusal(dir, "$MyFolder:Worlds/A.ent")).toBeNull();
    expect(worldPrefixRefusal(dir, "$myfolder:Worlds/A.ent")).toBeNull();
    expect(worldPrefixRefusal(dir, "$MyId:Worlds/A.ent")).toBeNull();
    expect(worldPrefixRefusal(dir, "Worlds/A.ent")).toBeNull();
    expect(worldPrefixRefusal(dir, "$ArmaReforger:worlds/Eden/Eden.ent")).toMatch(/ArmaReforger/);
  });
});

// ── Wiring through each tool's registration ─────────────────────────────────

type Answer = (api: string, p: Record<string, unknown>) => Record<string, unknown>;

function fakeClient(answer: Answer) {
  const sent: { api: string; params: Record<string, unknown> }[] = [];
  const client = {
    state: { connected: true, mode: "edit", lastUpdated: 0 },
    async call(api: string, params: Record<string, unknown> = {}) {
      sent.push({ api, params });
      return answer(api, params);
    },
    async probe() {
      throw new Error("probe not expected");
    },
    // wb_entity_duplicate asks whether the addon is a loaded project before createTemplate.
    async openProjectMatch() {
      return { match: "loaded" as const, reported: "addon" };
    },
  } as unknown as WorkbenchClient;
  return { client, sent };
}

const ok = (extra: Record<string, unknown> = {}) => ({ status: "ok", code: "", ...extra });
const cfg = (extra: Partial<Config> = {}) => makeConfig({ projectPath: addons, ...extra });
const json = (r: { content: { text: string }[] }) => JSON.parse(r.content[0]!.text);

describe("registered tools read ENFUSION_PROJECT_PATH as the addons folder", () => {
  it("wb_world new writes into the addon, not beside it", async () => {
    addon("MyMod");
    const { client } = fakeClient((_api, p) =>
      ok({ resourceName: `{FFFFFFFFFFFFFFFF}${String(p.path)}`, alreadyRegistered: 0, dryRun: 0 }),
    );
    const h = captureTool((s: McpServer) => registerWbWorld(s, client, cfg()));
    const r = await h({ action: "new", path: "Worlds/X.ent", confirm: true });
    expect(r.isError).not.toBe(true);
    expect(existsSync(join(addons, "MyMod", "Worlds", "X.ent"))).toBe(true);
    expect(existsSync(join(addons, "MyMod", "Worlds", "X_Layers", "default.layer"))).toBe(true);
    expect(existsSync(join(addons, "Worlds"))).toBe(false);
  });

  it("wb_world new refuses NOT_IN_PROJECT when several addons and no default mod", async () => {
    addon("A");
    addon("B");
    const { client, sent } = fakeClient(() => ok());
    const h = captureTool((s: McpServer) => registerWbWorld(s, client, cfg()));
    const r = await h({ action: "new", path: "Worlds/X.ent", confirm: true });
    expect(json(r)).toMatchObject({ ok: false, code: "NOT_IN_PROJECT" });
    expect(sent).toEqual([]);
    const h2 = captureTool((s: McpServer) => registerWbWorld(s, client, cfg({ defaultMod: "B" })));
    const r2 = await h2({ action: "new", path: "Worlds/X.ent", confirm: true });
    expect(r2.isError).not.toBe(true);
    expect(existsSync(join(addons, "B", "Worlds", "X.ent"))).toBe(true);
  });

  it("wb_world saveAs finds the open world in the addon; a dependency's world is refused", async () => {
    addon("MyMod");
    addon("Dep");
    put("MyMod/Worlds/Src.ent", "Layer default {\n Index 0\n}\n");
    put("MyMod/Worlds/Src_Layers/default.layer", "");
    put("Dep/Worlds/Src.ent", "Layer default {\n Index 0\n}\n");
    let worldPath = "$MyMod:Worlds/Src.ent";
    const { client } = fakeClient(() => ok({ worldPath, mode: "edit" }));
    const h = captureTool((s: McpServer) =>
      registerWbWorld(s, client, cfg({ defaultMod: "MyMod" })),
    );
    const dry = json(await h({ action: "saveAs", to: "Worlds/Copy.ent" }));
    expect(dry).toMatchObject({ ok: true, readback: { from: "Worlds/Src.ent" } });
    worldPath = "$Dep:Worlds/Src.ent";
    const dep = json(await h({ action: "saveAs", to: "Worlds/Copy.ent" }));
    expect(dep).toMatchObject({ ok: false, code: "NOT_IN_PROJECT" });
    expect(dep.message).toMatch(/'Dep'/);
  });

  it("wb_terrain_edit finds the open world in the addon (backup gets past the project check)", async () => {
    addon("MyMod");
    put("MyMod/worlds/W.ent", "Layer default {\n Index 0\n}\n");
    const { client } = fakeClient((api) =>
      api === "EMCP_WB_World" ? ok({ action: "state", worldPath: "$MyMod:worlds/W.ent", mode: "edit" }) : ok(),
    );
    const h = captureTool((s: McpServer) =>
      registerWbTerrainEdit(s, client, cfg(), { artifactsDir: join(base, "art") }),
    );
    const r = json(await h({ action: "backup" }));
    // Before the fix: NOT_IN_PROJECT (the world was looked for beside the addon).
    expect(r.code).not.toBe("NOT_IN_PROJECT");
    expect(r).toMatchObject({ ok: true, action: "backup" });
    expect(JSON.stringify(r.readback)).toContain("worlds/W.ent");
  });

  it("wb_terrain_edit refuses a world of another addon and says why no addon resolved", async () => {
    addon("MyMod");
    addon("Dep");
    put("Dep/worlds/W.ent", "x");
    const { client } = fakeClient(() => ok({ action: "state", worldPath: "$Dep:worlds/W.ent", mode: "edit" }));
    const withDefault = captureTool((s: McpServer) =>
      registerWbTerrainEdit(s, client, cfg({ defaultMod: "MyMod" }), {
        artifactsDir: join(base, "art"),
      }),
    );
    const r = json(await withDefault({ action: "backup" }));
    expect(r).toMatchObject({ ok: false, code: "NOT_IN_PROJECT" });
    expect(r.message).toMatch(/'Dep'/);
    const ambiguous = captureTool((s: McpServer) =>
      registerWbTerrainEdit(s, client, cfg(), { artifactsDir: join(base, "art") }),
    );
    const r2 = json(await ambiguous({ action: "backup" }));
    expect(r2).toMatchObject({ ok: false, code: "NOT_IN_PROJECT" });
    expect(r2.message).toMatch(/2 addons/);
  });

  it("wb_world_tools importObjects reads the CSV from the addon", async () => {
    addon("MyMod");
    put("MyMod/data/s.csv", "{0123456789ABCDEF}Prefabs/Rocks/Rock_01.et,1,2,3,0,0,0,1,1\r\n");
    const { client, sent } = fakeClient(() => ok({ created: 1, ids: ["id:0x1"], undoName: "u" }));
    const h = captureTool((s: McpServer) => registerWbWorldTools(s, cfg(), client));
    const r = await h({ action: "importObjects", path: "data/s.csv" });
    expect(textOf(r)).not.toMatch(/PATH_NOT_FOUND/);
    expect(r.isError).not.toBe(true);
    expect(sent).toHaveLength(1);
  });

  it("wb_entity_duplicate accepts ENFUSION_PROJECT_PATH pointing at the addon itself", async () => {
    const dir = addon("MyMod");
    const { client } = fakeClient(() => ok({ ancestorPath: "{0123456789ABCDEF}Prefabs/Missing.et" }));
    const h = captureTool((s: McpServer) =>
      registerWbEntityDuplicate(s, cfg({ projectPath: dir }), client),
    );
    const r = await h({ entityName: "E", destPath: "Prefabs/Copy.et", replaceInScene: false });
    // Past the addon lookup: it fails later (the fake createTemplate writes no file).
    expect(textOf(r)).not.toMatch(/No addons found|Could not find addon directory/);
  });
});
