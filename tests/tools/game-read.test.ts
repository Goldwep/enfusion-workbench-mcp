import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerGameRead } from "../../src/tools/game-read.js";
import { PakVirtualFS } from "../../src/pak/vfs.js";
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
    writeFileSync(
      join(gamePath, "addons", "data", "Scripts", "Game", "A.c"),
      "class A {}",
      "utf-8",
    );
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

describe("game_read text sniffing", () => {
  let base: string;
  let gamePath: string;
  let data: string;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "gamereadsniff-"));
    gamePath = join(base, "game");
    data = join(gamePath, "addons", "data");
    mkdirSync(data, { recursive: true });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(base, { recursive: true, force: true });
  });

  function tool() {
    return captureTool((s) => registerGameRead(s, makeConfig({ gamePath })));
  }

  it("returns a text file with an extension that was never listed", async () => {
    writeFileSync(join(data, "Sample.agr"), 'AnimSrcGraph Sample {\n Name "x"\n}\n', "utf-8");
    writeFileSync(join(data, "Sample.bt"), "BehaviorTree {}\n", "utf-8");
    writeFileSync(join(data, "NoExtension"), "plain text\n", "utf-8");
    for (const p of ["Sample.agr", "Sample.bt", "NoExtension"]) {
      const r = await tool()({ path: p });
      expect(r.isError).toBeUndefined();
    }
    const r = await tool()({ path: "Sample.agr" });
    expect(textOf(r)).toContain("AnimSrcGraph Sample");
  });

  it("refuses a binary file that has a text-looking extension, with the reason", async () => {
    writeFileSync(join(data, "fake.c"), Buffer.from([0x63, 0x6c, 0x61, 0x73, 0x00, 0x01, 0x02]));
    const r = await tool()({ path: "fake.c" });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/Binary file/);
    expect(textOf(r)).toMatch(/NUL byte at offset 4/);
  });

  it("refuses a file whose first NUL byte is after the first kilobyte", async () => {
    writeFileSync(
      join(data, "late.txt"),
      Buffer.concat([Buffer.from("a".repeat(5000)), Buffer.from([0]), Buffer.from("tail")]),
    );
    const r = await tool()({ path: "late.txt" });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/NUL byte at offset 5000/);
  });

  it("refuses bytes that are not valid UTF-8", async () => {
    writeFileSync(join(data, "latin.txt"), Buffer.from([0x63, 0xe9, 0x20, 0x61]));
    const r = await tool()({ path: "latin.txt" });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/not valid UTF-8/);
  });

  it("accepts UTF-8 text (multi-byte) and an empty file", async () => {
    writeFileSync(join(data, "u.txt"), "café ✓", "utf-8");
    writeFileSync(join(data, "empty.txt"), "");
    const u = await tool()({ path: "u.txt" });
    expect(u.isError).toBeUndefined();
    expect(textOf(u)).toContain("café ✓");
    const e = await tool()({ path: "empty.txt" });
    expect(e.isError).toBeUndefined();
  });

  it("strips a UTF-8 BOM from the returned text", async () => {
    writeFileSync(
      join(data, "bom.conf"),
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("Hello")]),
    );
    const r = await tool()({ path: "bom.conf" });
    expect(r.isError).toBeUndefined();
    expect(textOf(r)).toMatch(/\n\nHello$/);
    expect(textOf(r)).not.toContain("﻿");
  });

  it("refuses UTF-16 and UTF-32 text with the encoding named", async () => {
    writeFileSync(join(data, "le.txt"), Buffer.from("﻿hi", "utf16le"));
    writeFileSync(join(data, "be.txt"), Buffer.from([0xfe, 0xff, 0x00, 0x68, 0x00, 0x69]));
    writeFileSync(
      join(data, "u32.txt"),
      Buffer.from([0xff, 0xfe, 0x00, 0x00, 0x68, 0x00, 0x00, 0x00]),
    );
    const le = await tool()({ path: "le.txt" });
    expect(le.isError).toBe(true);
    expect(textOf(le)).toMatch(/UTF-16LE/);
    const be = await tool()({ path: "be.txt" });
    expect(textOf(be)).toMatch(/UTF-16BE/);
    const u32 = await tool()({ path: "u32.txt" });
    expect(textOf(u32)).toMatch(/UTF-32LE/);
  });

  it("still reads every previously allow-listed extension", async () => {
    const exts = [
      ".c",
      ".et",
      ".conf",
      ".gproj",
      ".ent",
      ".layer",
      ".st",
      ".layout",
      ".txt",
      ".json",
      ".xml",
      ".csv",
    ];
    for (const ext of exts) writeFileSync(join(data, `f${ext}`), `body${ext}`, "utf-8");
    for (const ext of exts) {
      const r = await tool()({ path: `f${ext}` });
      expect(r.isError).toBeUndefined();
      expect(textOf(r)).toContain(`body${ext}`);
    }
  });

  it("keeps the size cap for text of any extension", async () => {
    writeFileSync(join(data, "big.agr"), "x".repeat(600_000), "utf-8");
    const r = await tool()({ path: "big.agr" });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/File too large/);
  });

  describe("pak branch", () => {
    function fakePak(files: Record<string, Buffer>) {
      vi.spyOn(PakVirtualFS, "get").mockReturnValue({
        exists: (p: string) => p in files,
        allFilePaths: () => Object.keys(files),
        fileSize: (p: string) => files[p].length,
        readFile: (p: string) => files[p],
      } as unknown as PakVirtualFS);
    }

    it("returns an unlisted-extension text file from a pak", async () => {
      fakePak({ "Anim/x.agf": Buffer.from("AnimGraph {}\n") });
      const r = await tool()({ path: "Anim/x.agf" });
      expect(r.isError).toBeUndefined();
      expect(textOf(r)).toContain("(from .pak)");
      expect(textOf(r)).toContain("AnimGraph {}");
    });

    it("refuses a binary pak entry even with a text-looking extension", async () => {
      fakePak({ "Scripts/fake.c": Buffer.from([0x41, 0x00, 0x42]) });
      const r = await tool()({ path: "Scripts/fake.c" });
      expect(r.isError).toBe(true);
      expect(textOf(r)).toMatch(/Binary file: Scripts\/fake\.c .*NUL byte/);
    });

    it("refuses an oversized pak entry before reading it", async () => {
      const readFile = vi.fn();
      vi.spyOn(PakVirtualFS, "get").mockReturnValue({
        exists: () => true,
        allFilePaths: () => [],
        fileSize: () => 600_000,
        readFile,
      } as unknown as PakVirtualFS);
      const r = await tool()({ path: "Big/x.agr" });
      expect(r.isError).toBe(true);
      expect(textOf(r)).toMatch(/File too large/);
      expect(readFile).not.toHaveBeenCalled();
    });
  });
});

describe("game_duplicate source lookup (M18)", () => {
  let base: string;
  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "gamedup-"));
    mkdirSync(join(base, "game", "addons", "data"), { recursive: true });
    mkdirSync(join(base, "proj", "MyMod"), { recursive: true });
    writeFileSync(
      join(base, "proj", "MyMod", "MyMod.gproj"),
      'GameProject {\n ID "MyMod"\n}\n',
      "utf-8",
    );
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

  // Total audit offline-writers-03: a '..' source was read from outside the game data and copied in.
  it("refuses a source outside the game data, a non-resource source and a changed extension", async () => {
    writeFileSync(join(base, "secret.conf"), "SECRET {\n}\n", "utf-8");
    writeFileSync(join(base, "secret.txt"), "SECRET\n", "utf-8");
    const client = { call: async () => ({ status: "ok" }) } as unknown as WorkbenchClient;
    const tool = captureTool((s) =>
      registerGameDuplicate(
        s,
        makeConfig({ gamePath: join(base, "game"), projectPath: join(base, "proj") }),
        client,
      ),
    );
    const call = (sourcePath: string, destPath: string) =>
      tool({ sourcePath, destPath, modName: "MyMod", flatten: false, register: false });
    const escape = await call("../../../secret.conf", "Configs/x.conf");
    expect(escape.isError).toBe(true);
    expect(textOf(escape)).toContain("no '..'");
    const txt = await call("../../../secret.txt", "Configs/x.conf");
    expect(txt.isError).toBe(true);
    expect(textOf(txt)).toContain("must name a prefab (.et) or a config (.conf)");
    mkdirSync(join(base, "game", "addons", "data", "Configs"), { recursive: true });
    writeFileSync(join(base, "game", "addons", "data", "Configs", "A.conf"), "SCR_Config {\n}\n");
    const renamed = await call("Configs/A.conf", "Configs/A.txt");
    expect(renamed.isError).toBe(true);
    expect(textOf(renamed)).toContain("destPath must end in .conf");
    expect(existsSync(join(base, "proj", "MyMod", "Configs"))).toBe(false);
  });

  it("registers the copy through the W2 handler: project-relative path, confirm true", async () => {
    mkdirSync(join(base, "game", "addons", "data", "Prefabs"), { recursive: true });
    writeFileSync(
      join(base, "game", "addons", "data", "Prefabs", "Src.conf"),
      "SCR_Config {\n}\n",
      "utf-8",
    );
    const sent: { fn: string; params: Record<string, unknown> }[] = [];
    const answers: Record<string, unknown>[] = [
      {
        status: "ok",
        registered: 1,
        dryRun: 0,
        resourceName: "{1111111111111111}Prefabs/Copy.conf",
      },
      { status: "refused", code: "NOT_IN_PROJECT", message: "outside the project" },
    ];
    const client = {
      call: async (fn: string, params: Record<string, unknown>) => {
        sent.push({ fn, params });
        return answers.shift();
      },
    } as unknown as WorkbenchClient;
    const tool = captureTool((s) =>
      registerGameDuplicate(
        s,
        makeConfig({ gamePath: join(base, "game"), projectPath: join(base, "proj") }),
        client,
      ),
    );
    const args = {
      sourcePath: "Prefabs/Src.conf",
      destPath: "Prefabs/Copy.conf",
      modName: "MyMod",
      flatten: false,
      register: true,
    };
    const r = await tool(args);
    expect(r.isError).not.toBe(true);
    expect(sent).toEqual([
      {
        fn: "EMCP_WB_Resources",
        params: {
          action: "register",
          path: "Prefabs/Copy.conf",
          buildRuntime: false,
          confirm: true,
        },
      },
    ]);
    expect(textOf(r)).toContain("{1111111111111111}Prefabs/Copy.conf");
    // A refusal is reported as a warning, never as a registration.
    const r2 = await tool({ ...args, destPath: "Prefabs/Copy2.conf" });
    expect(textOf(r2)).toMatch(
      /Warning: registration returned: NOT_IN_PROJECT: outside the project/,
    );
  });
});
