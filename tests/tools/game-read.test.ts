import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerGameRead } from "../../src/tools/game-read.js";
import { registerGameDuplicate } from "../../src/tools/game-duplicate.js";
import type { WorkbenchClient } from "../../src/workbench/client.js";
import { captureTool, makeConfig, textOf } from "./_tool-harness.js";

describe("game_read error shapes (M19)", () => {
  let base: string;
  let gamePath: string;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "gameread-"));
    gamePath = join(base, "game");
    mkdirSync(join(gamePath, "addons", "data", "Scripts", "Game"), { recursive: true });
    writeFileSync(join(gamePath, "addons", "data", "Scripts", "Game", "A.c"), "class A {}", "utf-8");
    writeFileSync(join(gamePath, "addons", "data", "model.xob"), Buffer.from([0, 1, 2]));
    writeFileSync(join(gamePath, "addons", "data", "big.c"), "x".repeat(600_000), "utf-8");
  });
  afterEach(() => rmSync(base, { recursive: true, force: true }));

  function tool() {
    return captureTool((s) => registerGameRead(s, makeConfig({ gamePath })));
  }

  it("reads a loose text file", async () => {
    const r = await tool()({ path: "Scripts/Game/A.c" });
    expect(r.isError).toBeUndefined();
    expect(textOf(r)).toContain("class A {}");
  });

  it("directory → isError", async () => {
    const r = await tool()({ path: "Scripts" });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/is a directory/);
  });

  it("binary → isError", async () => {
    const r = await tool()({ path: "model.xob" });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/Binary file/);
  });

  it("too large → isError", async () => {
    const r = await tool()({ path: "big.c" });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/File too large/);
  });

  it("missing (no pak either) → isError", async () => {
    const r = await tool()({ path: "Scripts/Game/Nope.c" });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/File not found/);
  });
});

describe("game_duplicate source lookup (M18)", () => {
  let base: string;
  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "gamedup-"));
    mkdirSync(join(base, "game", "addons", "data"), { recursive: true });
    mkdirSync(join(base, "proj", "MyMod"), { recursive: true });
    writeFileSync(join(base, "proj", "MyMod", "MyMod.gproj"), `GameProject {\n ID "MyMod"\n}\n`, "utf-8");
  });
  afterEach(() => rmSync(base, { recursive: true, force: true }));

  it("reports a clear error mentioning .pak archives when neither loose nor pak has the file", async () => {
    const client = { call: async () => ({ status: "ok" }) } as unknown as WorkbenchClient;
    const tool = captureTool((s) =>
      registerGameDuplicate(
        s,
        makeConfig({ gamePath: join(base, "game"), projectPath: join(base, "proj") }),
        client,
      ),
    );
    const r = await tool({
      sourcePath: "Prefabs/Nope.et",
      destPath: "Prefabs/Copy.et",
      modName: "MyMod",
      flatten: false,
      register: false,
    });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/Source file not found/);
    expect(textOf(r)).toMatch(/\.pak archives/);
  });
});
