import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { CstDocument, parseCstBytes } from "../../src/formats/enfusion-cst.js";
import type { Config } from "../../src/config.js";
import {
  registerImageset,
  skeleton,
  unifiedDiff,
  unwritableReason,
  viewImageset,
} from "../../src/tools/imageset.js";
import * as imageset from "../../src/tools/imageset.js";
import { PakVirtualFS } from "../../src/pak/vfs.js";
import { captureTool } from "./_tool-harness.js";

// The shape of a vanilla file: one space of indent, LF, no final line ending.
const SAMPLE = [
  "ImageSetClass {",
  " RefSize 64 64",
  " Textures {",
  "  ImageSetTextureClass {",
  "   mpix 1",
  '   path "{0123456789ABCDEF}UI/T/atlas.edds"',
  "  }",
  " }",
  " Images {",
  "  ImageSetDefClass a {",
  '   Name "a"',
  "   Pos 0 0",
  "   Size 8 8",
  "   Flags 0",
  "  }",
  "  ImageSetDefClass a2 {",
  '   Name "a2"',
  "   Pos 8 0",
  "   Size 8 8",
  "   Flags 0",
  "  }",
  " }",
  " Groups {",
  "  ImageSetGroupClass g1 {",
  '   Name "g1"',
  "   Images {",
  "    ImageSetDefClass a {",
  "     Pos 8 8",
  "     Size 8 8",
  "     Flags 0x1 0",
  "    }",
  "   }",
  "  }",
  " }",
  "}",
].join("\n");

// Pak access for the corpus: ENFUSION_GAME_PATH, as behavior-tree.test.ts.
const GAME = process.env.ENFUSION_GAME_PATH ?? "";
const vfs = (() => {
  try {
    return GAME ? PakVirtualFS.get(GAME) : null;
  } catch {
    return null;
  }
})();

describe.skipIf(!vfs)("vanilla .imageset corpus", () => {
  const files = vfs ? vfs.allFilePaths().filter((p) => p.toLowerCase().endsWith(".imageset")) : [];

  it("has files to read", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("gives every file back byte for byte, and the writer would keep every one", () => {
    const off: string[] = [];
    const refused: string[] = [];
    for (const f of files) {
      const buf = vfs!.readFile(f);
      if (Buffer.compare(parseCstBytes(buf).toBytes(), buf) !== 0) off.push(f);
      const why = unwritableReason(buf);
      if (why) refused.push(`${f}: ${why}`);
      viewImageset(parseCstBytes(buf));
    }
    expect(off).toEqual([]);
    expect(refused).toEqual([]);
    console.log(`imageset corpus: ${files.length - off.length}/${files.length} byte-exact`);
  });

  it("add then remove puts every file back byte for byte", () => {
    const off: string[] = [];
    for (const f of files) {
      const buf = vfs!.readFile(f);
      const w = { doc: parseCstBytes(buf) };
      const view = viewImageset(w.doc);
      const group = view.quads.length === 0 && view.groups.length ? view.groups[0].name : undefined;
      imageset.addQuad(w, { name: "emcp_probe", group, pos: [0, 0], size: [1, 1] });
      if (Buffer.compare(w.doc.toBytes(), buf) === 0) off.push(`${f}: add changed nothing`);
      expect(unwritableReason(w.doc.toBytes())).toBeUndefined();
      imageset.removeItem(w, { name: "emcp_probe", group });
      if (Buffer.compare(w.doc.toBytes(), buf) !== 0) off.push(f);
    }
    expect(off).toEqual([]);
  });
});

describe("the imageset tool", () => {
  const dir = mkdtempSync(join(tmpdir(), "imageset-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const handler = captureTool((s) =>
    registerImageset(s, { projectPath: dir, gamePath: GAME, dataDir: "" } as Config),
  );

  interface Reply {
    ok: boolean;
    code?: string;
    message?: string;
    next?: string;
    dryRun?: boolean;
    changed: { path: string; before: unknown; after: unknown }[] | null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    readback: any;
    warnings: string[];
  }
  const call = async (args: Record<string, unknown>): Promise<Reply> => {
    const r = await handler(args);
    return JSON.parse(r.content[0].text) as Reply;
  };
  const file = (rel: string) => join(dir, rel);
  const put = (rel: string, text: string) => {
    mkdirSync(join(file(rel), ".."), { recursive: true });
    writeFileSync(file(rel), text, "utf-8");
  };
  const text = (rel: string) => readFileSync(file(rel), "utf-8");
  let n = 0;
  const fresh = (body = SAMPLE) => {
    const rel = `UI/Imagesets/t${n++}.imageset`;
    put(rel, body);
    return rel;
  };

  it("keeps its description short", () => {
    let description = "";
    registerImageset(
      {
        registerTool: (_n: string, d: { description: string }) => {
          description = d.description;
        },
      } as never,
      {} as Config,
    );
    expect(description.length).toBeLessThanOrEqual(400);
  });

  describe("read", () => {
    it("answers the textures, groups and quads", async () => {
      const r = await call({ action: "read", path: fresh() });
      expect(r.ok).toBe(true);
      expect(r.readback.refSize).toEqual([64, 64]);
      expect(r.readback.textures).toEqual([
        {
          index: 0,
          resource: "{0123456789ABCDEF}UI/T/atlas.edds",
          guid: "0123456789ABCDEF",
          path: "UI/T/atlas.edds",
          mpix: 1,
        },
      ]);
      expect(r.readback.groups).toEqual([{ index: 0, name: "g1", quads: 1 }]);
      expect(r.readback.quadCount).toBe(3);
      expect(r.readback.quads[2]).toEqual({
        group: "g1",
        name: "a",
        pos: [8, 8],
        size: [8, 8],
        flags: "0x1 0",
      });
      expect(r.warnings).toEqual([]);
    });

    it("pages, filters by group, and refuses a stale cursor", async () => {
      const path = fresh();
      const p1 = await call({ action: "read", path, limit: 2 });
      expect(p1.readback.quads).toHaveLength(2);
      expect(p1.readback.nextCursor).toBe("2:3");
      const p2 = await call({ action: "read", path, limit: 2, cursor: "2:3" });
      expect(p2.readback.quads).toHaveLength(1);
      expect(p2.readback.nextCursor).toBeUndefined();
      const stale = await call({ action: "read", path, cursor: "1:9" });
      expect(stale.code).toBe("STALE_CURSOR");
      const g = await call({ action: "read", path, group: "g1" });
      expect(g.readback.quads).toHaveLength(1);
      expect((await call({ action: "read", path, group: "nope" })).code).toBe("PATH_NOT_FOUND");
    });

    it("warns about a duplicate name, a quad past RefSize, and a file it would not edit", async () => {
      const body = SAMPLE.replace("ImageSetDefClass a2 {", "ImageSetDefClass a {").replace(
        "Pos 8 0",
        "Pos 60 0",
      );
      const r = await call({ action: "read", path: fresh(body) });
      expect(r.warnings.some((w) => w.includes('duplicate quad "a"'))).toBe(true);
      expect(r.warnings.some((w) => w.includes("reaches past RefSize"))).toBe(true);
      const odd = await call({ action: "read", path: fresh(SAMPLE.slice(0, -2)) });
      expect(odd.ok).toBe(true);
      expect(odd.warnings.some((w) => w.includes("would refuse to edit"))).toBe(true);
    });

    it("reads a missing file and a non-imageset as refusals", async () => {
      expect((await call({ action: "read", path: "UI/none.imageset" })).code).toBe(
        "PATH_NOT_FOUND",
      );
      expect((await call({ action: "read", path: "UI/a.layout" })).code).toBe("INVALID_ARGUMENT");
      put("UI/notimageset.imageset", "Foo {\n}");
      expect((await call({ action: "read", path: "UI/notimageset.imageset" })).code).toBe(
        "INVALID_ARGUMENT",
      );
    });

    it.skipIf(!vfs)("reads a game resource, read only", async () => {
      const r = await call({ action: "read", path: "UI/Textures/Chat/chat_badge.imageset" });
      expect(r.ok).toBe(true);
      expect(r.readback.source).toBe("game");
      expect(r.warnings.some((w) => w.includes("read only"))).toBe(true);
      const w = await call({
        action: "addQuad",
        path: "UI/Textures/Chat/chat_badge.imageset",
        name: "x",
        pos: [0, 0],
        size: [1, 1],
        confirm: true,
      });
      expect(w.ok).toBe(false);
      expect(w.code).toBe("NOT_IN_PROJECT");
      expect(existsSync(file("UI/Textures/Chat/chat_badge.imageset"))).toBe(false);
    });
  });

  describe("create", () => {
    it("is a dry run until confirm, and then writes exactly the announced file", async () => {
      const path = "UI/Imagesets/made.imageset";
      const dry = await call({
        action: "create",
        path,
        refSize: [32, 32],
        texture: "UI/T/m.edds",
        resourceGuid: "AABBCCDDEEFF0011",
      });
      expect(dry.ok).toBe(true);
      expect(dry.dryRun).toBe(true);
      expect(existsSync(file(path))).toBe(false);
      expect(dry.readback.diff).toContain('+   path "{AABBCCDDEEFF0011}UI/T/m.edds"');
      const done = await call({
        action: "create",
        path,
        refSize: [32, 32],
        texture: "UI/T/m.edds",
        resourceGuid: "AABBCCDDEEFF0011",
        confirm: true,
      });
      expect(done.ok).toBe(true);
      expect(done.dryRun).toBe(false);
      expect(done.next).toContain("wb_resources register");
      expect(text(path)).toBe(
        [
          "ImageSetClass {",
          " RefSize 32 32",
          " Textures {",
          "  ImageSetTextureClass {",
          "   mpix 1",
          '   path "{AABBCCDDEEFF0011}UI/T/m.edds"',
          "  }",
          " }",
          " Images {",
          " }",
          "}",
        ].join("\n"),
      );
      expect(dry.readback.diff.replace(/^[+ ]/gm, "")).toContain("ImageSetClass {");
      expect(unwritableReason(readFileSync(file(path)))).toBeUndefined();
    });

    it("does not replace an existing file without overwrite", async () => {
      const path = fresh();
      const r = await call({ action: "create", path, refSize: [8, 8], confirm: true });
      expect(r.ok).toBe(false);
      expect(r.message).toContain("overwrite");
      expect(text(path)).toBe(SAMPLE);
      const dry = await call({ action: "create", path, refSize: [8, 8] });
      expect(dry.ok).toBe(false);
      const over = await call({
        action: "create",
        path,
        refSize: [8, 8],
        overwrite: true,
        confirm: true,
      });
      expect(over.ok).toBe(true);
      expect(text(path)).toBe(skeleton([8, 8]));
    });

    it("makes missing folders inside the project, and checks its arguments", async () => {
      const ok = await call({
        action: "create",
        path: "UI/Deep/Er/x.imageset",
        refSize: [4, 4],
        confirm: true,
      });
      expect(ok.ok).toBe(true);
      expect(existsSync(file("UI/Deep/Er/x.imageset"))).toBe(true);
      expect((await call({ action: "create", path: "UI/n.imageset", confirm: true })).code).toBe(
        "INVALID_ARGUMENT",
      );
      expect(
        (await call({ action: "create", path: "UI/n.imageset", refSize: [0, 4], confirm: true }))
          .code,
      ).toBe("INVALID_ARGUMENT");
      expect(existsSync(file("UI/n.imageset"))).toBe(false);
    });
  });

  describe("texture", () => {
    it("addTexture: dry run writes nothing, confirm writes the announced entry", async () => {
      const path = fresh();
      const args = {
        action: "addTexture",
        path,
        texture: "UI/T/b.edds",
        resourceGuid: "aabbccddeeff0011",
        screenSize: "FHD",
        textureSize: [128, 128],
        objectGuid: "1122334455667788",
      };
      const dry = await call(args);
      expect(dry.ok).toBe(true);
      expect(dry.dryRun).toBe(true);
      expect(text(path)).toBe(SAMPLE);
      expect(dry.changed?.[0].path).toBe("Textures[1]");
      const done = await call({ ...args, confirm: true });
      expect(done.ok).toBe(true);
      const expected = SAMPLE.replace(
        "  }\n }\n Images {",
        [
          "  }",
          '  ImageSetTextureClass "{1122334455667788}" {',
          "   screenSize FHD",
          "   size 128 128",
          '   path "{AABBCCDDEEFF0011}UI/T/b.edds"',
          "  }",
          " }",
          " Images {",
        ].join("\n"),
      );
      expect(text(path)).toBe(expected);
      expect(done.readback.diff).toBe(dry.readback.diff);
    });

    it("addTexture: a path with no GUID is written with a warning, a duplicate is refused", async () => {
      const path = fresh();
      const r = await call({ action: "addTexture", path, texture: "UI/T/c.edds", confirm: true });
      expect(r.ok).toBe(true);
      expect(r.warnings[0]).toContain("no resource GUID");
      expect(text(path)).toContain('   path "UI/T/c.edds"');
      const dup = await call({
        action: "addTexture",
        path,
        texture: "UI/T/atlas.edds",
        confirm: true,
      });
      expect(dup.ok).toBe(false);
      expect(dup.message).toContain("already lists");
      const dup2 = await call({
        action: "addTexture",
        path,
        texture: "{AAAAAAAAAAAAAAAA}UI/T/c.edds",
        confirm: true,
      });
      expect(dup2.ok).toBe(false);
    });

    it("addTexture: refuses a bad combination or value, and writes nothing", async () => {
      const path = fresh();
      const bads: Record<string, unknown>[] = [
        { texture: "UI/T/c.edds", screenSize: "FHD" },
        { texture: "UI/T/c.edds", screenSize: "FHD", textureSize: [4, 4], mpix: 2 },
        { texture: "UI/T/c.edds", textureSize: [4, 4] },
        { texture: "UI/T/c.edds", mpix: 0 },
        { texture: "UI/T/c.edds", resourceGuid: "xyz" },
        { texture: "{0123456789ABCDEF}UI/T/c.edds", resourceGuid: "0123456789ABCDEF" },
        { texture: 'a"b.edds' },
        {},
      ];
      for (const b of bads) {
        const r = await call({ action: "addTexture", path, confirm: true, ...b });
        expect(r.code, JSON.stringify(b)).toBe("INVALID_ARGUMENT");
      }
      expect(text(path)).toBe(SAMPLE);
    });

    it("removeTexture: by path and by index, and refuses a miss", async () => {
      const path = fresh();
      await call({ action: "addTexture", path, texture: "UI/T/c.edds", confirm: true });
      const dry = await call({ action: "removeTexture", path, texture: "UI/T/c.edds" });
      expect(dry.dryRun).toBe(true);
      expect(text(path)).toContain("UI/T/c.edds");
      const r = await call({
        action: "removeTexture",
        path,
        texture: "UI/T/c.edds",
        confirm: true,
      });
      expect(r.ok).toBe(true);
      expect(text(path)).toBe(SAMPLE);
      const last = await call({ action: "removeTexture", path, index: 0, confirm: true });
      expect(last.ok).toBe(true);
      expect(last.warnings[0]).toContain("no texture");
      expect(text(path)).not.toContain("ImageSetTextureClass");
      expect((await call({ action: "removeTexture", path, index: 3 })).code).toBe("PATH_NOT_FOUND");
      expect((await call({ action: "removeTexture", path, texture: "x" })).code).toBe(
        "PATH_NOT_FOUND",
      );
      expect((await call({ action: "removeTexture", path })).code).toBe("INVALID_ARGUMENT");
    });
  });

  describe("group", () => {
    it("addGroup writes a named group, refuses a duplicate, quotes a keyword", async () => {
      const path = fresh();
      const r = await call({ action: "addGroup", path, group: "g2", confirm: true });
      expect(r.ok).toBe(true);
      expect(text(path)).toBe(
        SAMPLE.replace(
          "   }\n  }\n }\n}",
          [
            "   }",
            "  }",
            "  ImageSetGroupClass g2 {",
            '   Name "g2"',
            "   Images {",
            "   }",
            "  }",
            " }",
            "}",
          ].join("\n"),
        ),
      );
      expect((await call({ action: "addGroup", path, group: "g2", confirm: true })).ok).toBe(false);
      await call({ action: "addGroup", path, group: "new", confirm: true });
      expect(text(path)).toContain('ImageSetGroupClass "new" {');
      await call({ action: "addGroup", path, group: "two words", confirm: true });
      expect(text(path)).toContain('ImageSetGroupClass "two words" {');
    });

    it("addGroup creates the Groups block when the file has none", async () => {
      const path = fresh(skeleton([16, 16]));
      const r = await call({ action: "addGroup", path, group: "g", confirm: true });
      expect(r.ok).toBe(true);
      expect(text(path)).toBe(
        [
          "ImageSetClass {",
          " RefSize 16 16",
          " Textures {",
          " }",
          " Images {",
          " }",
          " Groups {",
          "  ImageSetGroupClass g {",
          '   Name "g"',
          "   Images {",
          "   }",
          "  }",
          " }",
          "}",
        ].join("\n"),
      );
    });
  });

  describe("quads", () => {
    it("addQuad: root quad takes its siblings' style, and the write is exactly the diff", async () => {
      const path = fresh();
      const args = { action: "addQuad", path, name: "b", pos: [16, 0], size: [8, 8] };
      const dry = await call(args);
      expect(dry.dryRun).toBe(true);
      expect(text(path)).toBe(SAMPLE);
      expect(dry.changed).toEqual([
        { path: "quad:b", before: null, after: { pos: [16, 0], size: [8, 8], flags: "0" } },
      ]);
      const done = await call({ ...args, confirm: true });
      expect(done.ok).toBe(true);
      expect(text(path)).toBe(
        SAMPLE.replace(
          "  }\n }\n Groups {",
          [
            "  }",
            "  ImageSetDefClass b {",
            '   Name "b"',
            "   Pos 16 0",
            "   Size 8 8",
            "   Flags 0",
            "  }",
            " }",
            " Groups {",
          ].join("\n"),
        ),
      );
    });

    it("addQuad: a group quad copies the shape of its siblings, not their flag value", async () => {
      const path = fresh();
      const r = await call({
        action: "addQuad",
        path,
        group: "g1",
        name: "c",
        pos: [0, 8],
        size: [4, 4],
        confirm: true,
      });
      expect(r.ok).toBe(true);
      expect(r.changed?.[0].path).toBe("quad:g1/c");
      expect(text(path)).toContain(
        [
          "    ImageSetDefClass c {",
          "     Pos 0 8",
          "     Size 4 4",
          "     Flags 0 0",
          "    }",
        ].join("\n"),
      );
      const g = await call({ action: "read", path, group: "g1" });
      expect(g.readback.quads.map((q: { name: string }) => q.name)).toEqual(["a", "c"]);
    });

    it("addQuad: explicit flags, a keyword name, and a missing Images block", async () => {
      const path = fresh(skeleton([16, 16]).replace(" Images {\n }\n", ""));
      const r = await call({
        action: "addQuad",
        path,
        name: "continue",
        pos: [0, 0],
        size: [2, 2],
        flags: "0x1 0",
        confirm: true,
      });
      expect(r.ok).toBe(true);
      expect(text(path)).toBe(
        [
          "ImageSetClass {",
          " RefSize 16 16",
          " Textures {",
          " }",
          " Images {",
          '  ImageSetDefClass "continue" {',
          '   Name "continue"',
          "   Pos 0 0",
          "   Size 2 2",
          "   Flags 0x1 0",
          "  }",
          " }",
          "}",
        ].join("\n"),
      );
    });

    it("addQuad: warns past RefSize, refuses a duplicate, a missing group and bad numbers", async () => {
      const path = fresh();
      const far = await call({
        action: "addQuad",
        path,
        name: "far",
        pos: [60, 60],
        size: [8, 8],
        confirm: true,
      });
      expect(far.ok).toBe(true);
      expect(far.warnings[0]).toContain("reaches past RefSize");
      const before = text(path);
      const cases: [Record<string, unknown>, string][] = [
        [{ name: "a", pos: [0, 0], size: [1, 1] }, "INVALID_ARGUMENT"],
        [{ name: "a", group: "g1", pos: [0, 0], size: [1, 1] }, "INVALID_ARGUMENT"],
        [{ name: "n", group: "zz", pos: [0, 0], size: [1, 1] }, "PATH_NOT_FOUND"],
        [{ name: "n", pos: [-1, 0], size: [1, 1] }, "INVALID_ARGUMENT"],
        [{ name: "n", pos: [0, 0], size: [0, 1] }, "INVALID_ARGUMENT"],
        [{ name: "n", pos: [0.5, 0], size: [1, 1] }, "INVALID_ARGUMENT"],
        [{ name: "n", pos: [0], size: [1, 1] }, "INVALID_ARGUMENT"],
        [{ name: "n", pos: [0, 0], size: [1, 1], flags: "x" }, "INVALID_ARGUMENT"],
        [{ name: 'q"', pos: [0, 0], size: [1, 1] }, "INVALID_ARGUMENT"],
        [{ pos: [0, 0], size: [1, 1] }, "INVALID_ARGUMENT"],
      ];
      for (const [c, code] of cases) {
        const r = await call({ action: "addQuad", path, confirm: true, ...c });
        expect(r.code, JSON.stringify(c)).toBe(code);
      }
      expect(text(path)).toBe(before);
    });

    it("setQuad: changes only the values given, and reports before and after", async () => {
      const path = fresh();
      const args = { action: "setQuad", path, name: "a2", pos: [9, 1] };
      const dry = await call(args);
      expect(dry.changed).toEqual([{ path: "quad:a2.Pos", before: "8 0", after: "9 1" }]);
      expect(text(path)).toBe(SAMPLE);
      const done = await call({ ...args, confirm: true });
      expect(done.ok).toBe(true);
      expect(text(path)).toBe(SAMPLE.replace("   Pos 8 0", "   Pos 9 1"));
      const g = await call({
        action: "setQuad",
        path,
        name: "a",
        group: "g1",
        size: [4, 4],
        flags: "0 0",
        confirm: true,
      });
      expect(g.changed?.map((c) => c.path)).toEqual(["quad:g1/a.Size", "quad:g1/a.Flags"]);
      expect(text(path)).toContain("     Size 4 4\n     Flags 0 0");
    });

    it("setQuad: a value already in place is no change, and nothing is written", async () => {
      const path = fresh();
      const r = await call({ action: "setQuad", path, name: "a", pos: [0, 0], confirm: true });
      expect(r.ok).toBe(true);
      expect(r.changed).toEqual([]);
      expect(r.warnings[0]).toContain("nothing to change");
      expect(text(path)).toBe(SAMPLE);
    });

    it("setQuad: adds a missing Flags line, and refuses an unknown or ambiguous quad", async () => {
      const path = fresh(
        SAMPLE.replace("   Flags 0\n  }\n  ImageSetDefClass a2", "  }\n  ImageSetDefClass a2"),
      );
      const r = await call({ action: "setQuad", path, name: "a", flags: "1", confirm: true });
      expect(r.ok).toBe(true);
      expect(text(path)).toContain("   Size 8 8\n   Flags 1\n  }");
      expect((await call({ action: "setQuad", path, name: "zz", pos: [0, 0] })).code).toBe(
        "PATH_NOT_FOUND",
      );
      const inGroup = await call({ action: "setQuad", path, name: "zz", group: "g1", pos: [0, 0] });
      expect(inGroup.code).toBe("PATH_NOT_FOUND");
      expect((await call({ action: "setQuad", path, name: "a" })).code).toBe("INVALID_ARGUMENT");
      const dupPath = fresh(SAMPLE.replace("ImageSetDefClass a2 {", "ImageSetDefClass a {"));
      const amb = await call({ action: "setQuad", path: dupPath, name: "a", pos: [1, 1] });
      expect(amb.code).toBe("INVALID_ARGUMENT");
      expect(amb.message).toContain("2 times");
    });

    it("remove: a root quad, a group quad and a whole group", async () => {
      const path = fresh();
      const dry = await call({ action: "remove", path, name: "a2" });
      expect(dry.dryRun).toBe(true);
      expect(text(path)).toBe(SAMPLE);
      expect(dry.changed?.[0]).toEqual({
        path: "quad:a2",
        before: { pos: [8, 0], size: [8, 8], flags: "0" },
        after: null,
      });
      await call({ action: "remove", path, name: "a2", confirm: true });
      expect(text(path)).not.toContain("a2");
      const q = await call({ action: "remove", path, name: "a", group: "g1", confirm: true });
      expect(q.ok).toBe(true);
      expect(text(path)).toContain("   Images {\n   }");
      const g = await call({ action: "remove", path, group: "g1", confirm: true });
      expect(g.changed?.[0].path).toBe("group:g1");
      expect(text(path)).not.toContain("g1");
      expect((await call({ action: "remove", path })).code).toBe("INVALID_ARGUMENT");
      expect((await call({ action: "remove", path, group: "g1" })).code).toBe("PATH_NOT_FOUND");
      expect((await call({ action: "remove", path, name: "a" })).ok).toBe(true);
    });

    it("an add followed by its remove gives the file back byte for byte", async () => {
      const path = fresh();
      await call({ action: "addQuad", path, name: "t", pos: [1, 2], size: [3, 4], confirm: true });
      await call({ action: "remove", path, name: "t", confirm: true });
      await call({ action: "addTexture", path, texture: "UI/T/z.edds", confirm: true });
      await call({ action: "removeTexture", path, texture: "UI/T/z.edds", confirm: true });
      await call({ action: "addGroup", path, group: "gx", confirm: true });
      await call({ action: "remove", path, group: "gx", confirm: true });
      expect(text(path)).toBe(SAMPLE);
    });
  });

  describe("safety", () => {
    const edits: Record<string, unknown>[] = [
      { action: "addTexture", texture: "UI/T/q.edds" },
      { action: "removeTexture", index: 0 },
      { action: "addGroup", group: "gg" },
      { action: "addQuad", name: "n", pos: [0, 0], size: [1, 1] },
      { action: "setQuad", name: "a", pos: [3, 3] },
      { action: "remove", name: "a" },
    ];

    it("every write action is a dry run without confirm (or with confirm false)", async () => {
      const path = fresh();
      for (const e of edits) {
        for (const confirm of [undefined, false]) {
          const r = await call({ ...e, path, confirm });
          expect(r.ok, JSON.stringify(e)).toBe(true);
          expect(r.dryRun).toBe(true);
          expect(r.next).toContain("confirm: true");
          expect(text(path)).toBe(SAMPLE);
        }
      }
      const c = await call({ action: "create", path: "UI/dry.imageset", refSize: [4, 4] });
      expect(c.dryRun).toBe(true);
      expect(existsSync(file("UI/dry.imageset"))).toBe(false);
    });

    it("refuses an edit to a file that does not exist", async () => {
      for (const e of edits) {
        const r = await call({ ...e, path: "UI/ghost.imageset", confirm: true });
        expect(r.code, JSON.stringify(e)).toBe("PATH_NOT_FOUND");
      }
      expect(existsSync(file("UI/ghost.imageset"))).toBe(false);
    });

    it("leaves a file alone that it could not write back byte for byte", async () => {
      const unclosed = SAMPLE.slice(0, -2);
      const stray = SAMPLE + "\n}";
      const second = SAMPLE + "\nImageSetClass {\n}";
      const wrongRoot = "Foo {\n RefSize 1 1\n}";
      const empty = "";
      for (const body of [unclosed, stray, second, wrongRoot, empty]) {
        const path = fresh(body);
        for (const e of edits) {
          const r = await call({ ...e, path, confirm: true });
          expect(r.ok, `${JSON.stringify(e)} on ${body.slice(-12)}`).toBe(false);
          expect(r.code).toBe("INVALID_ARGUMENT");
          expect(r.message).toContain("left alone");
        }
        expect(text(path)).toBe(body);
      }
    });

    it("refuses a file in a text encoding it cannot reproduce", async () => {
      const path = "UI/Imagesets/bin.imageset";
      mkdirSync(join(dir, "UI/Imagesets"), { recursive: true });
      writeFileSync(
        file(path),
        Buffer.concat([Buffer.from(SAMPLE), Buffer.from([0xff, 0xff, 0xfe])]),
      );
      const r = await call({ action: "addGroup", path, group: "x", confirm: true });
      expect(r.ok).toBe(false);
      expect(unwritableReason(readFileSync(file(path)))).toBeDefined();
    });

    it("keeps CRLF line endings and the rest of the file untouched", async () => {
      const crlf = SAMPLE.replace(/\n/g, "\r\n");
      const path = fresh(crlf);
      const r = await call({ action: "setQuad", path, name: "a2", pos: [5, 5], confirm: true });
      expect(r.ok).toBe(true);
      expect(text(path)).toBe(crlf.replace("   Pos 8 0", "   Pos 5 5"));
      const add = await call({
        action: "addQuad",
        path,
        name: "n",
        pos: [0, 0],
        size: [1, 1],
        confirm: true,
      });
      expect(add.ok).toBe(true);
      expect(text(path)).not.toMatch(/[^\r]\n/);
    });

    it("refuses a path that leaves the project, and a file of another type", async () => {
      const escapes = [
        "../x.imageset",
        "UI/../../x.imageset",
        "..\\x.imageset",
        "$Core:x.imageset",
      ];
      for (const p of escapes) {
        const r = await call({ action: "create", path: p, refSize: [4, 4], confirm: true });
        expect(r.ok, p).toBe(false);
        expect(r.code, p).toBe("ABSOLUTE_PATH");
      }
      const outside = join(tmpdir(), "elsewhere-imageset-test.imageset");
      const abs = await call({ action: "create", path: outside, refSize: [4, 4], confirm: true });
      expect(abs.code).toBe("NOT_IN_PROJECT");
      expect(existsSync(outside)).toBe(false);
      const readAbs = await call({ action: "read", path: outside });
      expect(readAbs.code).toBe("NOT_IN_PROJECT");
      const ext = await call({
        action: "create",
        path: "UI/x.layout",
        refSize: [4, 4],
        confirm: true,
      });
      expect(ext.code).toBe("INVALID_ARGUMENT");
      expect(existsSync(file("UI/x.layout"))).toBe(false);
      const dash = await call({ action: "read", path: "-x.imageset" });
      expect(dash.code).toBe("INVALID_ARGUMENT");
    });

    it("accepts an absolute path inside the project and a {GUID} prefix", async () => {
      const path = fresh();
      const abs = await call({ action: "read", path: file(path) });
      expect(abs.ok).toBe(true);
      expect(abs.readback.source).toBe("project");
      const guid = await call({ action: "read", path: `{0123456789ABCDEF}${path}` });
      expect(guid.ok).toBe(true);
    });

    it("refuses writes when no project is configured", async () => {
      const bare = captureTool((s) =>
        registerImageset(s, { projectPath: "", gamePath: "" } as Config),
      );
      const r = await bare({
        action: "create",
        path: "UI/x.imageset",
        refSize: [4, 4],
        confirm: true,
      });
      expect(JSON.parse(r.content[0].text).code).toBe("NOT_IN_PROJECT");
      expect(r.isError).toBe(true);
    });

    it("starts every edit from what is on disk", async () => {
      // The write path re-reads the file: two edits in a row each start from the disk.
      const path = fresh();
      await call({ action: "setQuad", path, name: "a", pos: [1, 1], confirm: true });
      writeFileSync(file(path), text(path).replace("Pos 1 1", "Pos 2 2"));
      const r = await call({ action: "setQuad", path, name: "a", pos: [3, 3], confirm: true });
      expect(r.ok).toBe(true);
      expect(text(path)).toContain("Pos 3 3");
    });
  });

  describe("helpers", () => {
    it("unifiedDiff shows one hunk, and nothing for equal texts", () => {
      expect(unifiedDiff("a\nb\nc", "a\nb\nc", "f")).toBe("");
      expect(unifiedDiff("a\nb\nc", "a\nX\nc", "f")).toBe(
        "--- a/f\n+++ b/f\n@@ -1,3 +1,3 @@\n a\n-b\n+X\n c",
      );
    });

    it("skeleton parses as an empty imageset", () => {
      const view = viewImageset(new CstDocument(skeleton([4, 8])));
      expect(view.refSize).toEqual([4, 8]);
      expect(view.textures).toEqual([]);
      expect(view.quads).toEqual([]);
      expect(unwritableReason(Buffer.from(skeleton([4, 8])))).toBeUndefined();
    });
  });
});

// Census rows this file tests (W2 promotion, EV-W2-085).
// census:mcp:action/imageset.addGroup
// census:mcp:action/imageset.addQuad
// census:mcp:action/imageset.addTexture
// census:mcp:action/imageset.create
// census:mcp:action/imageset.read
// census:mcp:action/imageset.remove
// census:mcp:action/imageset.removeTexture
// census:mcp:action/imageset.setQuad
