import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Config } from "../../src/config.js";
import { parseCstBytes } from "../../src/formats/enfusion-cst.js";
import { PakVirtualFS } from "../../src/pak/vfs.js";
import { registerMetaFile, runMetaFile, type MetaArgs } from "../../src/tools/meta-file.js";

// A texture meta the way the engine writes it: LF, no final newline.
const TEX = [
  "MetaFileClass {",
  ' Name "{AAAAAAAAAAAAAAAA}Assets/T/tex.png"',
  " Configurations {",
  '  PNGResourceClass PC : "{DC555BD399D92412}Configs/System/ResourceTypes/PC/TextureUnspecified.conf" {',
  '   ColorSpace "Linear"',
  "   Compression 1",
  "  }",
  "  PNGResourceClass XBOX_ONE : PC {",
  "  }",
  "  PNGResourceClass PS5 : PC {",
  "  }",
  " }",
  "}",
].join("\n");

// A config meta: CRLF and a final newline, nothing set.
const CONF = [
  "MetaFileClass {",
  ' Name "{BBBBBBBBBBBBBBBB}Configs/c.conf"',
  " Configurations {",
  "  CONFResourceClass PC {",
  "  }",
  "  CONFResourceClass XBOX_ONE : PC {",
  "  }",
  " }",
  "}",
  "",
].join("\r\n");

const root = mkdtempSync(join(tmpdir(), "meta-file-"));
const outside = mkdtempSync(join(tmpdir(), "meta-file-out-"));
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

const cfg = (extra: Partial<Config> = {}) =>
  ({ projectPath: root, gamePath: "", dataDir: "", ...extra }) as Config;

function put(rel: string, text: string): string {
  const f = join(root, rel);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, text);
  return f;
}
const run = (a: MetaArgs, c: Config = cfg()) => runMetaFile(a, c);
const ok = (a: MetaArgs) => {
  const r = run(a);
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r;
};
const code = (a: MetaArgs) => {
  const r = run(a);
  if (r.ok) throw new Error("expected a refusal");
  return r.code;
};

let texFile = "";
let confFile = "";
beforeEach(() => {
  texFile = put("Assets/T/tex.png.meta", TEX);
  confFile = put("Configs/c.conf.meta", CONF);
});

describe("meta_file read and scan", () => {
  it("reads configurations, ancestors and properties", () => {
    const r = ok({ action: "read", path: "Assets/T/tex.png" });
    const rb = r.readback as {
      guid: string;
      resourcePath: string;
      lineEnding: string;
      finalNewline: boolean;
      configurations: {
        platform: string;
        className: string;
        ancestor: { value: string; kind: string } | null;
        props: { key: string; values: string[]; quoted: boolean[] }[];
      }[];
    };
    expect(rb.guid).toBe("AAAAAAAAAAAAAAAA");
    expect(rb.resourcePath).toBe("Assets/T/tex.png");
    expect(rb.lineEnding).toBe("lf");
    expect(rb.finalNewline).toBe(false);
    expect(rb.configurations.map((c) => c.platform)).toEqual(["PC", "XBOX_ONE", "PS5"]);
    expect(rb.configurations[0].className).toBe("PNGResourceClass");
    expect(rb.configurations[0].ancestor).toEqual({
      value: "{DC555BD399D92412}Configs/System/ResourceTypes/PC/TextureUnspecified.conf",
      kind: "resource",
    });
    expect(rb.configurations[0].props).toEqual([
      { key: "ColorSpace", values: ["Linear"], quoted: [true] },
      { key: "Compression", values: ["1"], quoted: [false] },
    ]);
    expect(rb.configurations[1].ancestor).toEqual({ value: "PC", kind: "platform" });
    expect(readFileSync(texFile, "utf-8")).toBe(TEX);
  });

  it("accepts a GUID prefix and an absolute path inside the project", () => {
    expect(ok({ action: "read", path: "{AAAAAAAAAAAAAAAA}Assets/T/tex.png" }).target).toBe(
      "path:Assets/T/tex.png",
    );
    expect(ok({ action: "read", path: join(root, "Assets", "T", "tex.png") }).target).toBe(
      "path:Assets/T/tex.png",
    );
  });

  it("scans in pages with a cursor, and refuses a stale one", () => {
    put("Assets/T/b.png.meta", TEX);
    put("Assets/T/c.layout.meta", CONF);
    const first = ok({ action: "scan", limit: 2 });
    const rb = first.readback as {
      total: number;
      count: number;
      cursor: string | null;
      metas: { path: string }[];
    };
    expect(rb.total).toBeGreaterThanOrEqual(4);
    expect(rb.count).toBe(2);
    expect(rb.cursor).toMatch(/^2:\d+$/);
    const second = ok({ action: "scan", limit: 2, cursor: rb.cursor as string });
    const rb2 = second.readback as { start: number; metas: { path: string }[] };
    expect(rb2.start).toBe(2);
    expect(rb2.metas[0].path).not.toBe(rb.metas[0].path);
    // The list changes between pages.
    put("Assets/T/zz.png.meta", TEX);
    expect(code({ action: "scan", limit: 2, cursor: rb.cursor as string })).toBe("STALE_CURSOR");
    const only = ok({ action: "scan", folder: "Configs", ext: "conf" }).readback as {
      metas: { path: string; sourceExists: boolean; platforms: string[] }[];
    };
    expect(only.metas.map((m) => m.path)).toEqual(["Configs/c.conf"]);
    expect(only.metas[0].sourceExists).toBe(false);
    expect(only.metas[0].platforms).toEqual(["PC", "XBOX_ONE"]);
  });

  it("finds a .png's .meta beside the .edds it registered as (W2 run 1), and writes that file", () => {
    const edds = put("Assets/T/reg_co.edds.meta", TEX.replace("tex.png", "reg_co.edds"));
    put("Assets/T/reg_co.png", "x");
    const r = ok({ action: "read", path: "Assets/T/reg_co.png" });
    expect((r.readback as { file: string }).file).toBe(edds);
    expect(r.target).toBe("path:Assets/T/reg_co.edds");
    ok({
      action: "set",
      path: "Assets/T/reg_co.png",
      key: "ColorSpace",
      value: "sRGB",
      confirm: true,
    });
    expect(readFileSync(edds, "utf-8")).toContain('ColorSpace "sRGB"');
    expect(existsSync(join(root, "Assets/T/reg_co.png.meta"))).toBe(false);
  });

  it("answers META_NOT_FOUND, and refuses the .meta itself as the path", () => {
    put("Assets/T/orphan.png", "x");
    expect(code({ action: "read", path: "Assets/T/orphan.png" })).toBe("META_NOT_FOUND");
    expect(code({ action: "read", path: "Assets/T/tex.png.meta" })).toBe("INVALID_ARGUMENT");
    expect(code({ action: "read" })).toBe("INVALID_ARGUMENT");
  });
});

describe("meta_file set, clear and setAncestor", () => {
  it("set is a dry run: it answers the change and writes nothing", () => {
    const r = ok({ action: "set", path: "Assets/T/tex.png", key: "ColorSpace", value: "sRGB" });
    expect(r.changed).toEqual([{ path: "PC.ColorSpace", before: "Linear", after: "sRGB" }]);
    const rb = r.readback as { dryRun: boolean; wrote: boolean; diff: string };
    expect(rb.dryRun).toBe(true);
    expect(rb.wrote).toBe(false);
    expect(rb.diff).toContain('-   ColorSpace "Linear"');
    expect(rb.diff).toContain('+   ColorSpace "sRGB"');
    expect(readFileSync(texFile, "utf-8")).toBe(TEX);
  });

  it("confirm writes exactly the announced change and nothing else", () => {
    const r = ok({
      action: "set",
      path: "Assets/T/tex.png",
      key: "ColorSpace",
      value: "sRGB",
      confirm: true,
    });
    expect((r.readback as { wrote: boolean }).wrote).toBe(true);
    expect(readFileSync(texFile, "utf-8")).toBe(TEX.replace('"Linear"', '"sRGB"'));
    // Inverse from the before value restores the original bytes.
    ok({
      action: "set",
      path: "Assets/T/tex.png",
      key: "ColorSpace",
      value: "Linear",
      confirm: true,
    });
    expect(readFileSync(texFile, "utf-8")).toBe(TEX);
  });

  it("set adds a missing property in the file's own style (CRLF kept)", () => {
    const r = ok({
      action: "set",
      path: "Configs/c.conf",
      key: "Gamma",
      value: 2.2,
      confirm: true,
    });
    expect(r.changed).toEqual([{ path: "PC.Gamma", before: null, after: "2.2" }]);
    expect(readFileSync(confFile, "utf-8")).toBe(
      CONF.replace("  CONFResourceClass PC {\r\n", "  CONFResourceClass PC {\r\n   Gamma 2.2\r\n"),
    );
    // clear removes the line again, byte for byte.
    ok({ action: "clear", path: "Configs/c.conf", key: "Gamma", confirm: true });
    expect(readFileSync(confFile, "utf-8")).toBe(CONF);
  });

  it("targets one configuration, or every one with allPlatforms", () => {
    ok({
      action: "set",
      path: "Assets/T/tex.png",
      key: "Flag",
      value: true,
      configuration: "ps5",
      confirm: true,
    });
    let v = readFileSync(texFile, "utf-8");
    expect(v).toContain("  PNGResourceClass PS5 : PC {\n   Flag 1\n  }");
    expect(v.match(/Flag/g)).toHaveLength(1);
    const all = ok({
      action: "set",
      path: "Assets/T/tex.png",
      key: "Level",
      value: 3,
      allPlatforms: true,
      confirm: true,
    });
    v = readFileSync(texFile, "utf-8");
    expect(v.match(/Level 3/g)).toHaveLength(3);
    expect(all.changed).toHaveLength(3);
    expect(
      code({ action: "set", path: "Assets/T/tex.png", key: "A", value: 1, configuration: "PS4" }),
    ).toBe("INVALID_ARGUMENT");
  });

  it("clear removes a set property and refuses one that is not set", () => {
    const r = ok({ action: "clear", path: "Assets/T/tex.png", key: "Compression", confirm: true });
    expect(r.changed).toEqual([{ path: "PC.Compression", before: "1", after: null }]);
    expect(readFileSync(texFile, "utf-8")).toBe(TEX.replace("   Compression 1\n", ""));
    expect(code({ action: "clear", path: "Assets/T/tex.png", key: "Compression" })).toBe(
      "PATH_NOT_FOUND",
    );
  });

  it("setAncestor replaces, removes and adds the base, with the before value", () => {
    const ref = "{0123456789ABCDEF}Configs/Base.conf";
    mkdirSync(join(root, "Configs"), { recursive: true });
    writeFileSync(join(root, "Configs", "Base.conf"), "x");
    const r = ok({ action: "setAncestor", path: "Assets/T/tex.png", ancestor: ref, confirm: true });
    expect(r.changed).toEqual([
      {
        path: "PC.ancestor",
        before: "{DC555BD399D92412}Configs/System/ResourceTypes/PC/TextureUnspecified.conf",
        after: ref,
      },
    ]);
    expect(r.warnings).toEqual([]);
    expect(readFileSync(texFile, "utf-8")).toBe(
      TEX.replace("{DC555BD399D92412}Configs/System/ResourceTypes/PC/TextureUnspecified.conf", ref),
    );
    // Remove, then add a platform name to the bare PC configuration.
    ok({ action: "setAncestor", path: "Assets/T/tex.png", ancestor: null, confirm: true });
    expect(readFileSync(texFile, "utf-8")).toContain("  PNGResourceClass PC {\n");
    ok({
      action: "setAncestor",
      path: "Assets/T/tex.png",
      configuration: "XBOX_ONE",
      ancestor: "ps5",
      confirm: true,
    });
    expect(readFileSync(texFile, "utf-8")).toContain("  PNGResourceClass XBOX_ONE : PS5 {\n");
    // Restore the original text.
    writeFileSync(texFile, TEX);
    expect(code({ action: "setAncestor", path: "Assets/T/tex.png", ancestor: "PC" })).toBe(
      "INVALID_ARGUMENT",
    );
    expect(code({ action: "setAncestor", path: "Assets/T/tex.png", ancestor: "not a ref" })).toBe(
      "INVALID_ARGUMENT",
    );
    expect(code({ action: "setAncestor", path: "Assets/T/tex.png" })).toBe("INVALID_ARGUMENT");
    const w = ok({
      action: "setAncestor",
      path: "Assets/T/tex.png",
      ancestor: "{FFFFFFFFFFFFFFFF}Nowhere/x.conf",
    });
    expect(w.warnings[0]).toContain("was not found");
  });

  it("setAncestor refuses a platform cycle and writes nothing (review F10)", () => {
    // XBOX_ONE : PC already; PC : XBOX_ONE would close the loop.
    expect(code({ action: "setAncestor", path: "Assets/T/tex.png", ancestor: "XBOX_ONE", confirm: true })).toBe(
      "INVALID_ARGUMENT",
    );
    expect(readFileSync(texFile, "utf-8")).toBe(TEX);
    // A chain is not a loop: PS5 : XBOX_ONE while XBOX_ONE : PC and PC has a resource base.
    const chain = ok({
      action: "setAncestor",
      path: "Assets/T/tex.png",
      configuration: "PS5",
      ancestor: "XBOX_ONE",
    });
    expect(chain.changed).toEqual([{ path: "PS5.ancestor", before: "PC", after: "XBOX_ONE" }]);
  });

  it("an edit that changes nothing says so and writes nothing", () => {
    const before = statSync(texFile).mtimeMs;
    const r = ok({
      action: "set",
      path: "Assets/T/tex.png",
      key: "ColorSpace",
      value: "Linear",
      confirm: true,
    });
    expect((r.readback as { wrote: boolean }).wrote).toBe(false);
    expect(r.warnings.join(" ")).toContain("already");
    expect(statSync(texFile).mtimeMs).toBe(before);
  });

  it("refuses a bad key, a missing value and the structural keys", () => {
    expect(code({ action: "set", path: "Assets/T/tex.png", key: "bad key", value: 1 })).toBe(
      "INVALID_ARGUMENT",
    );
    expect(code({ action: "set", path: "Assets/T/tex.png", key: "Name", value: "x" })).toBe(
      "INVALID_ARGUMENT",
    );
    expect(
      code({ action: "set", path: "Assets/T/tex.png", key: "Configurations", value: "x" }),
    ).toBe("INVALID_ARGUMENT");
    expect(code({ action: "set", path: "Assets/T/tex.png", key: "A" })).toBe("INVALID_ARGUMENT");
    expect(code({ action: "clear", path: "Assets/T/tex.png" })).toBe("INVALID_ARGUMENT");
  });

  it("never creates a meta: a resource without one is META_NOT_FOUND", () => {
    put("Assets/T/new.png", "png");
    expect(
      code({ action: "set", path: "Assets/T/new.png", key: "A", value: 1, confirm: true }),
    ).toBe("META_NOT_FOUND");
    expect(existsSync(join(root, "Assets", "T", "new.png.meta"))).toBe(false);
  });
});

describe("meta_file refusals", () => {
  it("refuses a meta it could not write back byte for byte", () => {
    const bad = TEX.replace("   Compression 1", "   Compression 1 {"); // unclosed block
    put("Assets/T/bad.png.meta", bad);
    expect(
      code({ action: "set", path: "Assets/T/bad.png", key: "A", value: 1, confirm: true }),
    ).toBe("UNSUPPORTED_TYPE");
    expect(readFileSync(join(root, "Assets", "T", "bad.png.meta"), "utf-8")).toBe(bad);
    // Not a meta at all.
    put("Assets/T/other.png.meta", 'GenericEntity X {\n ID "1"\n}');
    expect(code({ action: "set", path: "Assets/T/other.png", key: "A", value: 1 })).toBe(
      "UNSUPPORTED_TYPE",
    );
    expect(code({ action: "read", path: "Assets/T/other.png" })).toBe("UNSUPPORTED_TYPE");
    // A meta with no Configurations block.
    put(
      "Assets/T/empty.png.meta",
      'MetaFileClass {\n Name "{CCCCCCCCCCCCCCCC}Assets/T/empty.png"\n}',
    );
    expect(code({ action: "set", path: "Assets/T/empty.png", key: "A", value: 1 })).toBe(
      "UNSUPPORTED_TYPE",
    );
  });

  it("refuses paths that escape the project", () => {
    expect(code({ action: "read", path: "../outside.png" })).toBe("ABSOLUTE_PATH");
    expect(
      code({ action: "set", path: "Assets/../../x.png", key: "A", value: 1, confirm: true }),
    ).toBe("ABSOLUTE_PATH");
    expect(code({ action: "read", path: "C:/Windows/x.png" })).toBe("NOT_IN_PROJECT");
    writeFileSync(join(outside, "o.png.meta"), TEX);
    expect(
      code({ action: "set", path: join(outside, "o.png"), key: "A", value: 1, confirm: true }),
    ).toBe("NOT_IN_PROJECT");
    expect(readFileSync(join(outside, "o.png.meta"), "utf-8")).toBe(TEX);
    expect(code({ action: "scan", folder: "../" })).toBe("ABSOLUTE_PATH");
  });

  it("refuses a junction or symlink that leads out of the project", () => {
    writeFileSync(join(outside, "j.png.meta"), TEX);
    try {
      symlinkSync(outside, join(root, "Linked"), "junction");
    } catch {
      return; // no permission to link here
    }
    expect(code({ action: "set", path: "Linked/j.png", key: "A", value: 1, confirm: true })).toBe(
      "NOT_IN_PROJECT",
    );
    expect(readFileSync(join(outside, "j.png.meta"), "utf-8")).toBe(TEX);
  });

  it("writes need a project root", () => {
    const r = run({ action: "set", path: "a.png", key: "A", value: 1 }, cfg({ projectPath: "" }));
    expect(r.ok).toBe(false);
    expect(run({ action: "scan" }, cfg({ projectPath: "" })).ok).toBe(false);
  });
});

describe("the meta_file tool", () => {
  it("registers under its name with a short description", () => {
    let name = "";
    let description = "";
    let handler: (
      a: Record<string, unknown>,
    ) => Promise<{ content: { text: string }[]; isError: boolean }> = async () => {
      throw new Error("unset");
    };
    registerMetaFile(
      {
        registerTool: (n: string, def: { description: string }, h: typeof handler) => {
          name = n;
          description = def.description;
          handler = h;
        },
      } as never,
      cfg(),
    );
    expect(name).toBe("meta_file");
    expect(description.length).toBeLessThanOrEqual(400);
    return handler({ action: "read", path: "Assets/T/tex.png" }).then(async (res) => {
      expect(res.isError).toBe(false);
      expect(JSON.parse(res.content[0].text).ok).toBe(true);
      const bad = await handler({ action: "read", path: "nope.png" });
      expect(bad.isError).toBe(true);
      expect(JSON.parse(bad.content[0].text).code).toBe("META_NOT_FOUND");
    });
  });
});

// ── Corpus round trip ────────────────────────────────────────────────────────

/** Every meta under a folder, absolute paths. */
function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && e.name.toLowerCase().endsWith(".meta")) out.push(p);
  }
  return out;
}

function gamePak(): PakVirtualFS | null {
  const gp = process.env.ENFUSION_GAME_PATH;
  if (!gp || !existsSync(join(gp, "addons"))) return null;
  return PakVirtualFS.get(gp);
}

/** parse then emit is byte-exact, and a set then a clear of a probe key restores the bytes. */
function roundTrips(bytes: Buffer): boolean {
  const doc = parseCstBytes(bytes);
  if (!doc.toBytes().equals(bytes) || doc.diagnostics.length) return false;
  const cfgBlocks = doc.get("Configurations").kind === "object";
  if (!cfgBlocks) return false;
  doc.set("Configurations[0].ZZProbe", 1);
  doc.delete("Configurations[0].ZZProbe");
  return doc.toBytes().equals(bytes);
}

const pak = gamePak();
const vanilla = pak ? pak.allFilePaths().filter((p) => p.toLowerCase().endsWith(".meta")) : [];
const LOCAL =
  process.env.ENFUSION_PROJECT_PATH ??
  join(homedir(), "Documents", "My Games", "ArmaReforgerWorkbench", "addons");

describe(`meta corpus round trip${pak ? "" : " (SKIPPED: ENFUSION_GAME_PATH is not available)"}`, () => {
  it.skipIf(!pak)("round-trips every vanilla .meta in the paks byte for byte", () => {
    const failed = vanilla.filter((p) => !roundTrips((pak as PakVirtualFS).readFile(p)));
    console.log(
      `[corpus] meta_file vanilla: ${vanilla.length - failed.length}/${vanilla.length} .meta files in the paks round-trip byte for byte`,
    );
    expect(failed).toEqual([]);
  });

  it.skipIf(!existsSync(LOCAL))(
    "round-trips every .meta of the local Workbench addons folder",
    () => {
      const files = walk(LOCAL);
      const failed = files.filter((f) => !roundTrips(readFileSync(f)));
      console.log(
        `[corpus] meta_file local addons (${LOCAL}): ${files.length - failed.length}/${files.length} round-trip byte for byte`,
      );
      expect(failed).toEqual([]);
    },
  );
});

// Census rows this file tests (W2 promotion, EV-W2-085).
// census:mcp:action/meta_file.clear
// census:mcp:action/meta_file.read
// census:mcp:action/meta_file.scan
// census:mcp:action/meta_file.set
// census:mcp:action/meta_file.setAncestor
