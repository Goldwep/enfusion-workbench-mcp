/**
 * H7 regression: every scaffold/write tool must refuse an LLM-supplied
 * `projectPath` / `outputDir` that resolves outside the configured project
 * root — and must write nothing when it refuses.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, existsSync, readdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureTool, makeConfig, textOf, type ToolHandler } from "./_tool-harness.js";
import { registerProject } from "../../src/tools/project.js";
import { registerPrefab } from "../../src/tools/prefab.js";
import { registerConfigCreate } from "../../src/tools/config-create.js";
import { registerScriptCreate } from "../../src/tools/script-create.js";
import { registerServerConfig } from "../../src/tools/server-config.js";
import { registerScenarioCreate } from "../../src/tools/scenario-create.js";
import { registerBuildingSetup } from "../../src/tools/building-setup.js";
import { registerMod } from "../../src/tools/mod.js";
import type { SearchEngine } from "../../src/index/search-engine.js";
import type { PatternLibrary } from "../../src/patterns/loader.js";

let base: string;
let root: string;
let outside: string;

function treeIsEmpty(dir: string): boolean {
  if (!existsSync(dir)) return true;
  return readdirSync(dir).length === 0;
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "h7-"));
  root = join(base, "root");
  outside = join(base, "outside");
  mkdirSync(root, { recursive: true });
  mkdirSync(outside, { recursive: true });
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("project (write)", () => {
  let tool: ToolHandler;
  beforeEach(() => {
    tool = captureTool((s) => registerProject(s, makeConfig({ projectPath: root })));
  });

  it("refuses projectPath outside the configured root and writes nothing", async () => {
    const r = await tool({ action: "write", path: "x.txt", content: "hi", projectPath: outside });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/outside project root/);
    expect(treeIsEmpty(outside)).toBe(true);
  });

  it("writes inside the configured root", async () => {
    const r = await tool({ action: "write", path: "Scripts/Game/A.c", content: "class A {}" });
    expect(r.isError).toBeUndefined();
    expect(readFileSync(join(root, "Scripts", "Game", "A.c"), "utf-8")).toBe("class A {}");
  });

  it("refuses a read outside every configured root", async () => {
    writeFileSync(join(outside, "secret.txt"), "s", "utf-8");
    const r = await tool({ action: "read", path: "secret.txt", projectPath: outside });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/outside every configured root/);
  });
});

describe("prefab (create)", () => {
  it("refuses projectPath outside root, writes nothing; writes inside root", async () => {
    const tool = captureTool((s) => registerPrefab(s, makeConfig({ projectPath: root })));
    const bad = await tool({
      action: "create",
      name: "Thing",
      prefabType: "generic",
      projectPath: outside,
      includeAncestry: false,
    });
    expect(bad.isError).toBe(true);
    expect(textOf(bad)).toMatch(/outside project root/);
    expect(treeIsEmpty(outside)).toBe(true);

    const ok = await tool({ action: "create", name: "Thing", prefabType: "generic", includeAncestry: false });
    expect(ok.isError).toBeUndefined();
    expect(textOf(ok)).toMatch(/Prefab created/);
    expect(treeIsEmpty(root)).toBe(false);
  });
});

describe("config_create", () => {
  it("refuses projectPath outside root, writes nothing; writes inside root", async () => {
    const tool = captureTool((s) => registerConfigCreate(s, makeConfig({ projectPath: root })));
    const bad = await tool({ configType: "faction", name: "MyFaction", projectPath: outside });
    expect(bad.isError).toBe(true);
    expect(textOf(bad)).toMatch(/outside project root/);
    expect(treeIsEmpty(outside)).toBe(true);

    const ok = await tool({ configType: "faction", name: "MyFaction" });
    expect(ok.isError).toBeUndefined();
    expect(textOf(ok)).toMatch(/Config created/);
  });
});

describe("script_create", () => {
  it("refuses projectPath outside root, writes nothing; writes inside root", async () => {
    const tool = captureTool((s) => registerScriptCreate(s, makeConfig({ projectPath: root })));
    const bad = await tool({ className: "TAG_Thing", scriptType: "basic", projectPath: outside });
    expect(bad.isError).toBe(true);
    expect(textOf(bad)).toMatch(/outside project root/);
    expect(treeIsEmpty(outside)).toBe(true);

    const ok = await tool({ className: "TAG_Thing", scriptType: "basic" });
    expect(ok.isError).toBeUndefined();
    expect(textOf(ok)).toMatch(/Script created/);
  });
});

describe("server_config", () => {
  it("refuses projectPath outside root, writes nothing; writes inside root", async () => {
    const tool = captureTool((s) => registerServerConfig(s, makeConfig({ projectPath: root })));
    const args = { name: "Srv", scenarioId: "{X}Missions/a.conf", projectPath: outside, overwrite: false };
    const bad = await tool(args);
    expect(bad.isError).toBe(true);
    expect(textOf(bad)).toMatch(/outside project root/);
    expect(existsSync(join(outside, "server.json"))).toBe(false);

    const ok = await tool({ ...args, projectPath: undefined });
    expect(ok.isError).toBeUndefined();
    expect(existsSync(join(root, "server.json"))).toBe(true);
  });
});

describe("scenario_create", () => {
  it("refuses projectPath outside root and writes nothing", async () => {
    const tool = captureTool((s) => registerScenarioCreate(s, makeConfig({ projectPath: root })));
    const bad = await tool({
      scenarioName: "TestScenario",
      worldName: "Eden",
      bases: [{ name: "BaseAlpha", position: "1 0 1", faction: "US" }],
      projectPath: outside,
    });
    expect(bad.isError).toBe(true);
    expect(textOf(bad)).toMatch(/outside project root/);
    expect(treeIsEmpty(outside)).toBe(true);
  });
});

describe("mod (create / build)", () => {
  let tool: ToolHandler;
  beforeEach(() => {
    const searchEngine = { hasClass: () => true, getClass: () => undefined } as unknown as SearchEngine;
    const patterns = { get: () => undefined, list: () => [] } as unknown as PatternLibrary;
    tool = captureTool((s) => registerMod(s, makeConfig({ projectPath: root }), searchEngine, patterns));
  });

  it("create: refuses projectPath outside root and writes nothing", async () => {
    const bad = await tool({ action: "create", name: "EvilMod", projectPath: outside });
    expect(bad.isError).toBe(true);
    expect(textOf(bad)).toMatch(/outside project root/);
    expect(treeIsEmpty(outside)).toBe(true);
  });

  it("create: scaffolds inside root; existing dir is an isError result (M19)", async () => {
    const ok = await tool({ action: "create", name: "GoodMod" });
    expect(ok.isError).toBeUndefined();
    expect(existsSync(join(root, "GoodMod", "GoodMod.gproj"))).toBe(true);
    const dup = await tool({ action: "create", name: "GoodMod" });
    expect(dup.isError).toBe(true);
    expect(textOf(dup)).toMatch(/already exists/);
  });

  it("create: unknown pattern is an isError result (M19)", async () => {
    const r = await tool({ action: "create", name: "PatMod", pattern: "nope" });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/Unknown pattern/);
  });

  it("validate: projectPath outside root is an isError result (M19)", async () => {
    const r = await tool({ action: "validate", projectPath: outside });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/Invalid project path/);
  });

  it("build: leading-dash argv inputs are refused (M26)", async () => {
    for (const args of [
      { addonName: "-wbModule=Evil" },
      { addonName: "Mod", outputPath: "-x" },
      { addonName: "Mod", gprojPath: "-x" },
      { addonName: "Mod", filterPath: "-x" },
    ]) {
      const r = await tool({ action: "build", ...args });
      expect(r.isError).toBe(true);
      expect(textOf(r)).toMatch(/must not start with '-'/);
    }
  });
});

describe("building_setup", () => {
  const manifest = (name: string, partName = "wall_01") => ({
    building_name: name,
    export_root: "C:/exports",
    structure: { fbx: "house.fbx", sockets: ["S1"] },
    parts: [
      {
        name: partName,
        type: "wall",
        socket_prefix: "S",
        socket_name: "S1",
        unique: false,
        fbx: "Walls/wall_01.fbx",
        phases: [],
      },
    ],
  });

  it("refuses outputDir outside root and writes nothing", async () => {
    const tool = captureTool((s) => registerBuildingSetup(s, makeConfig({ projectPath: root })));
    const manifestPath = join(base, "m.json");
    writeFileSync(manifestPath, JSON.stringify(manifest("House")), "utf-8");
    const r = await tool({ manifestPath, modPrefix: "", outputDir: outside, dryRun: false });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/outputDir resolves outside project root/);
    expect(treeIsEmpty(outside)).toBe(true);
  });

  it("refuses manifest-derived traversal in building_name / part.name", async () => {
    const tool = captureTool((s) => registerBuildingSetup(s, makeConfig({ projectPath: root })));
    for (const m of [manifest("../../escape"), manifest("House", "../evil")]) {
      const manifestPath = join(base, "m.json");
      writeFileSync(manifestPath, JSON.stringify(m), "utf-8");
      const r = await tool({ manifestPath, modPrefix: "", dryRun: false });
      expect(r.isError).toBe(true);
      expect(textOf(r)).toMatch(/Invalid manifest/);
    }
    expect(treeIsEmpty(base.replace(/[\\/]+$/, "") + "/escape")).toBe(true);
    expect(treeIsEmpty(root)).toBe(true);
  });

  it("missing / invalid manifest returns isError (M19); happy path writes inside root", async () => {
    const tool = captureTool((s) => registerBuildingSetup(s, makeConfig({ projectPath: root })));
    const missing = await tool({ manifestPath: join(base, "nope.json"), modPrefix: "", dryRun: false });
    expect(missing.isError).toBe(true);
    const badPath = join(base, "bad.json");
    writeFileSync(badPath, "{not json", "utf-8");
    const invalid = await tool({ manifestPath: badPath, modPrefix: "", dryRun: false });
    expect(invalid.isError).toBe(true);

    const manifestPath = join(base, "m.json");
    writeFileSync(manifestPath, JSON.stringify(manifest("House")), "utf-8");
    const ok = await tool({ manifestPath, modPrefix: "", dryRun: false });
    expect(ok.isError).toBeUndefined();
    expect(existsSync(join(root, "Prefabs", "Structures", "House", "House.et"))).toBe(true);
    expect(existsSync(join(root, "Prefabs", "Structures", "House", "Parts", "wall_01.et"))).toBe(true);
  });
});
