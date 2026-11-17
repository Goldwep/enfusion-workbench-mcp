import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Config } from "../../src/config.js";
import { CstDocument, parseCstBytes } from "../../src/formats/enfusion-cst.js";
import type { ActionError, ActionOk, ActionResponse } from "../../src/manifest/vocabulary.js";
import { PakVirtualFS } from "../../src/pak/vfs.js";
import {
  CONFIG_EDIT_DESCRIPTION,
  CONFIG_EDIT_EXTENSIONS,
  lineDiff,
  overrideBlocks,
  registerConfigEdit,
  runConfigEdit,
  type ConfigEditArgs,
} from "../../src/tools/config-edit.js";
import { loadBaseline, openVanillaCorpus } from "../corpus/_corpus.js";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const CONF = [
  "SCR_TestConfig {",
  ' m_sName "Alpha"',
  " m_iCount 3",
  " m_fScale 0.5 0.5",
  " m_aItems {",
  '  "one"',
  '  "two"',
  " }",
  " m_aEntries {",
  "  SCR_Entry First {",
  "   m_iValue 1",
  "  }",
  "  SCR_Entry Second {",
  "   m_iValue 2",
  "  }",
  " }",
  "}",
].join("\n"); // no final line ending, as the vanilla files

const EMAT = [
  'MatPBRBasic : "{0123456789ABCDEF}Materials/Base.emat" {',
  " Metalness 0.1",
  "}",
].join("\n");

const PHYS = ["PhysicsMaterial {", " Friction 0.7", "}"].join("\n");

const GAME_MAT = [
  'GameMaterial : "{0392E90C3BC537EE}Common/Materials/Game/armor.gamemat" {',
  ' BallisticInfo BallisticInfo "{527AC4219D9574AD}" {',
  "  Thickness 100",
  " }",
  "}",
].join("\n");

const GAME_FILES: Record<string, string> = {
  "Common/Materials/Game/armor.gamemat": GAME_MAT,
  "Common/Materials/Game/armor_100mm.gamemat": GAME_MAT,
};

const API_CLASSES = [
  {
    name: "SCR_BaseTestConfig",
    parents: [],
    properties: [{ name: "m_sName", type: "string" }],
    protectedProperties: [],
  },
  {
    name: "SCR_TestConfig",
    parents: ["SCR_BaseTestConfig"],
    properties: [
      { name: "m_iCount", type: "int" },
      { name: "m_fScale", type: "vector" },
      { name: "m_iNeverSet", type: "int" },
    ],
    protectedProperties: [{ name: "m_aItems", type: "array<string>" }],
  },
];

let tmp: string;
let root: string;
let dataDir: string;
let config: Config;

const abs = (rel: string): string => join(root, rel);
function put(rel: string, text: string | Buffer): void {
  mkdirSync(dirname(abs(rel)), { recursive: true });
  writeFileSync(abs(rel), text);
}
const get = (rel: string): string => readFileSync(abs(rel), "utf-8");

function call(args: Omit<ConfigEditArgs, "path"> & { path?: string }): ActionResponse {
  return runConfigEdit({ path: "Configs/Test/A.conf", ...args } as ConfigEditArgs, config);
}
function ok(res: ActionResponse): ActionOk {
  if (!res.ok) throw new Error(`expected ok, got ${res.code}: ${res.message}`);
  return res;
}
function refused(res: ActionResponse, code: string, message?: RegExp): ActionError {
  expect(res.ok).toBe(false);
  const e = res as ActionError;
  expect(e.code).toBe(code);
  if (message) expect(e.message).toMatch(message);
  return e;
}
const readback = (res: ActionResponse): Record<string, unknown> =>
  ok(res).readback as Record<string, unknown>;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "config-edit-"));
  root = join(tmp, "Addon");
  dataDir = join(tmp, "data");
  mkdirSync(root, { recursive: true });
  mkdirSync(join(dataDir, "api"), { recursive: true });
  writeFileSync(join(dataDir, "api", "arma-classes.json"), JSON.stringify(API_CLASSES));
  config = { projectPath: root, dataDir, gamePath: "G:/no-game" } as unknown as Config;
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

// Every test starts from the same files.
function reset(): void {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  put("Configs/Test/A.conf", CONF);
  put("Materials/M.emat", EMAT);
  put("Materials/P.physmat", PHYS);
}

function fakeGame(): void {
  vi.spyOn(PakVirtualFS, "get").mockReturnValue({
    exists: (p: string) => p in GAME_FILES,
    readFile: (p: string) => Buffer.from(GAME_FILES[p]),
  } as unknown as PakVirtualFS);
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ── read ─────────────────────────────────────────────────────────────────────

describe("read", () => {
  it("outlines the file with paths that the edit actions accept", () => {
    reset();
    const rb = readback(call({ action: "read", depth: 3 }));
    expect(rb).toMatchObject({
      source: "project",
      encoding: "utf8",
      eol: "lf",
      rootClass: "SCR_TestConfig",
      writable: true,
    });
    const entries = rb.entries as { path: string; kind: string; value?: string; line: number }[];
    const byPath = new Map(entries.map((e) => [e.path, e]));
    expect(byPath.get("m_sName")).toMatchObject({ kind: "scalar", value: '"Alpha"', line: 2 });
    expect(byPath.get("m_fScale")?.value).toBe("0.5 0.5");
    // Two blocks with the same key are addressed by index, and the path works.
    expect(byPath.has("m_aEntries[0]")).toBe(true);
    expect(byPath.get("m_aEntries[1].m_iValue")?.value).toBe("2");
    expect(byPath.get("m_aItems[0]")).toMatchObject({ kind: "value", value: '"one"' });
    for (const e of entries) {
      expect(ok(call({ action: "read", property: e.path })).ok).toBe(true);
    }
  });

  it("adds the schema from the API index, with the parent's properties and what is set", () => {
    reset();
    const schema = readback(call({ action: "read" })).schema as {
      class: string;
      found: boolean;
      chain: string[];
      properties: { name: string; declaredIn: string; set: boolean }[];
      unknownKeys: string[];
    };
    expect(schema.found).toBe(true);
    expect(schema.chain).toEqual(["SCR_TestConfig", "SCR_BaseTestConfig"]);
    const p = new Map(schema.properties.map((x) => [x.name, x]));
    expect(p.get("m_sName")).toMatchObject({ declaredIn: "SCR_BaseTestConfig", set: true });
    expect(p.get("m_iNeverSet")?.set).toBe(false);
    expect(p.get("m_aItems")?.set).toBe(true);
    expect(schema.unknownKeys).toEqual(["m_aEntries"]);
    expect(readback(call({ action: "read", schema: false })).schema).toBeUndefined();
  });

  it("says when the root class is not in the API index", () => {
    reset();
    const schema = readback(call({ action: "read", path: "Materials/M.emat" })).schema as {
      found: boolean;
      class: string;
    };
    expect(schema).toMatchObject({ found: false, class: "MatPBRBasic" });
    const rb = readback(call({ action: "read", path: "Materials/M.emat" }));
    expect(rb.ancestor).toBe("{0123456789ABCDEF}Materials/Base.emat");
  });

  it("reads one value, a block's children, and caps the outline", () => {
    reset();
    expect(readback(call({ action: "read", property: "m_sName" })).value).toMatchObject({
      raw: '"Alpha"',
      values: ["Alpha"],
      quoted: [true],
    });
    const block = readback(call({ action: "read", property: "m_aEntries", depth: 1 }));
    expect((block.entries as unknown[]).length).toBe(2);
    const capped = readback(call({ action: "read", limit: 3 }));
    expect((capped.entries as unknown[]).length).toBe(3);
    expect(capped.truncated).toBe(true);
  });

  it("reads a game resource from the paks and reports it read only", () => {
    reset();
    fakeGame();
    const res = call({ action: "read", path: "Common/Materials/Game/armor.gamemat" });
    expect(readback(res)).toMatchObject({
      source: "game",
      writable: false,
      rootClass: "GameMaterial",
    });
    expect(ok(res).next).toMatch(/createInherited or override/);
  });

  it("answers PATH_NOT_FOUND for a property and for a file that is not there", () => {
    reset();
    const e = refused(call({ action: "read", property: "m_nope" }), "PATH_NOT_FOUND");
    expect(e.message).toMatch(/entries: .*m_sName/);
    refused(call({ action: "read", path: "Configs/Test/Nope.conf" }), "PATH_NOT_FOUND");
  });
});

// ── set ──────────────────────────────────────────────────────────────────────

describe("set", () => {
  it("is a dry run by default: the file is untouched and the change is announced", () => {
    reset();
    const before = readFileSync(abs("Configs/Test/A.conf"));
    const res = ok(call({ action: "set", property: "m_sName", value: "Beta" }));
    expect(res.changed).toEqual([
      { path: "m_sName", before: 'm_sName "Alpha"', after: 'm_sName "Beta"' },
    ]);
    expect(res.readback).toMatchObject({ dryRun: true });
    expect((res.readback as { diff: string }).diff).toBe(
      [
        "@@ -1,4 +1,4 @@",
        " SCR_TestConfig {",
        '- m_sName "Alpha"',
        '+ m_sName "Beta"',
        "  m_iCount 3",
        "  m_fScale 0.5 0.5",
      ].join("\n"),
    );
    expect(res.next).toMatch(/confirm:true/);
    expect(readFileSync(abs("Configs/Test/A.conf")).equals(before)).toBe(true);
    // confirm:false is the same as leaving it out.
    call({ action: "set", property: "m_sName", value: "Beta", confirm: false });
    expect(readFileSync(abs("Configs/Test/A.conf")).equals(before)).toBe(true);
  });

  it("writes exactly the announced change with confirm", () => {
    reset();
    const res = ok(call({ action: "set", property: "m_sName", value: "Beta", confirm: true }));
    expect(res.readback).toMatchObject({ dryRun: false, written: true, verified: true });
    expect(get("Configs/Test/A.conf")).toBe(CONF.replace('"Alpha"', '"Beta"'));
  });

  it("keeps each value's quoting and a vector on one line", () => {
    reset();
    call({ action: "set", property: "m_iCount", value: 7, confirm: true });
    call({ action: "set", property: "m_fScale", value: [1, 2.5], confirm: true });
    expect(get("Configs/Test/A.conf")).toBe(
      CONF.replace("m_iCount 3", "m_iCount 7").replace("m_fScale 0.5 0.5", "m_fScale 1 2.5"),
    );
  });

  it("sets inside a nested block by index path and an array item by index", () => {
    reset();
    call({ action: "set", property: "m_aEntries[1].m_iValue", value: 9, confirm: true });
    call({ action: "set", property: "m_aItems[0]", value: "uno", confirm: true });
    expect(get("Configs/Test/A.conf")).toBe(
      CONF.replace("m_iValue 2", "m_iValue 9").replace('"one"', '"uno"'),
    );
  });

  it("adds a missing property as a new line and says so", () => {
    reset();
    const res = ok(call({ action: "set", property: "m_bNew", value: true, confirm: true }));
    expect(res.changed).toEqual([{ path: "m_bNew", before: null, after: "m_bNew 1" }]);
    expect(res.warnings.join(" ")).toMatch(/not in the file/);
    expect(get("Configs/Test/A.conf")).toBe(CONF.replace("\n}", "\n m_bNew 1\n}"));
  });

  it("keeps CRLF and a final line ending as the file has them", () => {
    reset();
    const crlf = CONF.replace(/\n/g, "\r\n") + "\r\n";
    put("Configs/Test/Crlf.conf", crlf);
    call({
      action: "set",
      path: "Configs/Test/Crlf.conf",
      property: "m_iCount",
      value: 4,
      confirm: true,
    });
    call({
      action: "set",
      path: "Configs/Test/Crlf.conf",
      property: "m_bNew",
      value: 1,
      confirm: true,
    });
    expect(get("Configs/Test/Crlf.conf")).toBe(
      crlf.replace("m_iCount 3", "m_iCount 4").replace("\r\n}\r\n", "\r\n m_bNew 1\r\n}\r\n"),
    );
  });

  it("does not write when the value is already there", () => {
    reset();
    const res = ok(call({ action: "set", property: "m_iCount", value: 3, confirm: true }));
    expect(res.readback).toMatchObject({ written: false });
    expect(res.warnings.join(" ")).toMatch(/no change/);
  });

  it("refuses a block, a bad value and a missing argument", () => {
    reset();
    refused(
      call({ action: "set", property: "m_aItems", value: 1 }),
      "INVALID_ARGUMENT",
      /not a scalar/,
    );
    refused(call({ action: "set", property: "m_sName", value: 'say "hi"' }), "INVALID_ARGUMENT");
    refused(
      call({ action: "set", property: "m_sName", value: [] as unknown as string }),
      "INVALID_ARGUMENT",
    );
    refused(call({ action: "set", value: 1 }), "INVALID_ARGUMENT", /needs property/);
    refused(call({ action: "set", property: "m_iCount" }), "INVALID_ARGUMENT", /needs value/);
    refused(call({ action: "set", property: "bad..path", value: 1 }), "INVALID_ARGUMENT");
    expect(get("Configs/Test/A.conf")).toBe(CONF);
  });

  it("edits every supported type", () => {
    reset();
    put("Materials/A.gamemat", GAME_MAT);
    put("Materials/V.vhcsurf", "ContactSurface {\n FrictionNonTread 1\n}");
    put("ui/S.styles", "WSWidgetStyle {\n Widgets {\n  WSWidget TextWidget {\n  }\n }\n}");
    call({
      action: "set",
      path: "Materials/M.emat",
      property: "Metalness",
      value: 0.9,
      confirm: true,
    });
    call({
      action: "set",
      path: "Materials/P.physmat",
      property: "Friction",
      value: 0.2,
      confirm: true,
    });
    call({
      action: "set",
      path: "Materials/A.gamemat",
      property: "BallisticInfo.Thickness",
      value: 5,
      confirm: true,
    });
    call({
      action: "set",
      path: "Materials/V.vhcsurf",
      property: "FrictionNonTread",
      value: 2,
      confirm: true,
    });
    call({
      action: "set",
      path: "ui/S.styles",
      property: "Widgets.WSWidget.Name",
      value: "x",
      confirm: true,
    });
    expect(get("Materials/M.emat")).toBe(EMAT.replace("0.1", "0.9"));
    expect(get("Materials/P.physmat")).toBe(PHYS.replace("0.7", "0.2"));
    expect(get("Materials/A.gamemat")).toBe(GAME_MAT.replace("Thickness 100", "Thickness 5"));
    expect(get("Materials/V.vhcsurf")).toBe("ContactSurface {\n FrictionNonTread 2\n}");
    expect(get("ui/S.styles")).toContain('   Name "x"');
    for (const ext of CONFIG_EDIT_EXTENSIONS) expect(ext.startsWith(".")).toBe(true);
  });
});

// ── clear ────────────────────────────────────────────────────────────────────

describe("clear", () => {
  it("removes the entry's line: dry run first, then confirm", () => {
    reset();
    const res = ok(call({ action: "clear", property: "m_iCount" }));
    expect(res.changed).toEqual([{ path: "m_iCount", before: "m_iCount 3", after: null }]);
    expect(get("Configs/Test/A.conf")).toBe(CONF);
    call({ action: "clear", property: "m_iCount", confirm: true });
    expect(get("Configs/Test/A.conf")).toBe(CONF.replace(" m_iCount 3\n", ""));
  });

  it("removes a whole block, and puts it back with the before text", () => {
    reset();
    const res = ok(call({ action: "clear", property: "m_aEntries[0]", confirm: true }));
    const before = (res.changed as { before: string }[])[0].before;
    expect(before).toBe("SCR_Entry First {\n   m_iValue 1\n  }");
    expect(get("Configs/Test/A.conf")).not.toContain("First");
    call({
      action: "arrayAdd",
      property: "m_aEntries",
      index: 0,
      item: { key: "SCR_Entry", name: "First", entries: [{ key: "m_iValue", value: 1 }] },
      confirm: true,
    });
    expect(get("Configs/Test/A.conf")).toBe(CONF);
  });

  it("refuses the root block, a missing path and a missing property", () => {
    reset();
    refused(call({ action: "clear" }), "INVALID_ARGUMENT", /needs property/);
    refused(call({ action: "clear", property: "m_nope" }), "PATH_NOT_FOUND");
    expect(get("Configs/Test/A.conf")).toBe(CONF);
    put("Configs/Test/Multi.conf", "A {\n}\nB {\n}");
    refused(
      call({ action: "clear", path: "Configs/Test/Multi.conf", property: "[5]" }),
      "PATH_NOT_FOUND",
    );
  });
});

// ── arrayAdd, arrayRemove ────────────────────────────────────────────────────

describe("arrayAdd and arrayRemove", () => {
  it("adds a value line at the end and at an index", () => {
    reset();
    const res = ok(call({ action: "arrayAdd", property: "m_aItems", item: "three" }));
    expect(res.changed).toEqual([{ path: "m_aItems[2]", before: null, after: '"three"' }]);
    expect(get("Configs/Test/A.conf")).toBe(CONF);
    call({ action: "arrayAdd", property: "m_aItems", item: "three", confirm: true });
    call({ action: "arrayAdd", property: "m_aItems", item: "zero", index: 0, confirm: true });
    expect(get("Configs/Test/A.conf")).toBe(
      CONF.replace('  "one"\n  "two"\n', '  "zero"\n  "one"\n  "two"\n  "three"\n'),
    );
  });

  it("adds an object entry written in the file's own style", () => {
    reset();
    call({
      action: "arrayAdd",
      property: "m_aEntries",
      item: { key: "SCR_Entry", name: "Third", entries: [{ key: "m_iValue", value: 3 }] },
      confirm: true,
    });
    expect(get("Configs/Test/A.conf")).toBe(
      CONF.replace(
        "   m_iValue 2\n  }\n",
        "   m_iValue 2\n  }\n  SCR_Entry Third {\n   m_iValue 3\n  }\n",
      ),
    );
  });

  it("adds to the root block when no property is given, and takes {key, value}", () => {
    reset();
    call({ action: "arrayAdd", item: { key: "m_iExtra", value: 5 }, confirm: true });
    expect(get("Configs/Test/A.conf")).toBe(CONF.replace("\n}", "\n m_iExtra 5\n}"));
  });

  it("removes an entry by index and answers its text", () => {
    reset();
    const res = ok(call({ action: "arrayRemove", property: "m_aItems", index: 0, confirm: true }));
    expect(res.changed).toEqual([{ path: "m_aItems[0]", before: '"one"', after: null }]);
    expect(get("Configs/Test/A.conf")).toBe(CONF.replace('  "one"\n', ""));
  });

  it("refuses what is not a block, an index past the end and missing arguments", () => {
    reset();
    refused(
      call({ action: "arrayAdd", property: "m_iCount", item: 1 }),
      "INVALID_ARGUMENT",
      /not a block/,
    );
    refused(
      call({ action: "arrayAdd", property: "m_aItems", item: 1, index: 9 }),
      "PATH_NOT_FOUND",
    );
    refused(call({ action: "arrayAdd", property: "m_aItems" }), "INVALID_ARGUMENT", /needs item/);
    refused(
      call({ action: "arrayAdd", property: "m_aItems", item: { nothing: 1 } }),
      "INVALID_ARGUMENT",
    );
    refused(
      call({ action: "arrayRemove", property: "m_aItems" }),
      "INVALID_ARGUMENT",
      /needs index/,
    );
    refused(
      call({ action: "arrayRemove", property: "m_aItems", index: 5 }),
      "PATH_NOT_FOUND",
      /2 entries/,
    );
    expect(get("Configs/Test/A.conf")).toBe(CONF);
  });
});

// ── setAncestor ──────────────────────────────────────────────────────────────

describe("setAncestor", () => {
  it("replaces the base reference, with the GUID in upper case", () => {
    reset();
    const ref = "{fedcba9876543210}Materials/Other.emat";
    const res = ok(call({ action: "setAncestor", path: "Materials/M.emat", ancestor: ref }));
    expect(res.changed).toEqual([
      {
        path: "ancestor",
        before: "{0123456789ABCDEF}Materials/Base.emat",
        after: "{FEDCBA9876543210}Materials/Other.emat",
      },
    ]);
    expect(get("Materials/M.emat")).toBe(EMAT);
    call({ action: "setAncestor", path: "Materials/M.emat", ancestor: ref, confirm: true });
    expect(get("Materials/M.emat")).toBe(
      EMAT.replace("{0123456789ABCDEF}Materials/Base", "{FEDCBA9876543210}Materials/Other"),
    );
  });

  it("adds a base to a block that has none and removes it with an empty ancestor", () => {
    reset();
    call({
      action: "setAncestor",
      path: "Materials/P.physmat",
      ancestor: "{0123456789ABCDEF}Materials/Base.physmat",
      confirm: true,
    });
    expect(get("Materials/P.physmat")).toBe(
      PHYS.replace(
        "PhysicsMaterial {",
        'PhysicsMaterial : "{0123456789ABCDEF}Materials/Base.physmat" {',
      ),
    );
    call({ action: "setAncestor", path: "Materials/P.physmat", ancestor: "", confirm: true });
    expect(get("Materials/P.physmat")).toBe(PHYS);
    call({ action: "setAncestor", path: "Materials/M.emat", ancestor: "", confirm: true });
    expect(get("Materials/M.emat")).toBe(EMAT.replace(/ : "[^"]*"/, ""));
  });

  it("warns about a path without a GUID, refuses a bad ancestor, itself and nothing to remove", () => {
    reset();
    const res = ok(
      call({ action: "setAncestor", path: "Materials/M.emat", ancestor: "Materials/Other.emat" }),
    );
    expect(res.warnings.join(" ")).toMatch(/no GUID/);
    refused(
      call({ action: "setAncestor", path: "Materials/M.emat", ancestor: 'a"b' }),
      "INVALID_ARGUMENT",
    );
    refused(
      call({ action: "setAncestor", path: "Materials/M.emat", ancestor: "{0123456789ABCDEF}" }),
      "INVALID_ARGUMENT",
    );
    refused(
      call({
        action: "setAncestor",
        path: "Materials/M.emat",
        ancestor: "{0123456789ABCDEF}materials/m.emat",
      }),
      "INVALID_ARGUMENT",
      /own ancestor/,
    );
    refused(
      call({ action: "setAncestor", path: "Materials/P.physmat", ancestor: "" }),
      "INVALID_ARGUMENT",
      /no ancestor/,
    );
    refused(
      call({ action: "setAncestor", path: "Materials/M.emat" }),
      "INVALID_ARGUMENT",
      /needs ancestor/,
    );
    expect(get("Materials/M.emat")).toBe(EMAT);
  });

  it("refuses a file without one root block", () => {
    reset();
    put("ui/Multi.styles", "A {\n}\nB {\n}");
    refused(
      call({ action: "setAncestor", path: "ui/Multi.styles", ancestor: "x" }),
      "INVALID_ARGUMENT",
      /no single root/,
    );
  });
});

// ── createInherited, override ────────────────────────────────────────────────

describe("createInherited", () => {
  it("is a dry run first: it answers the text and writes nothing", () => {
    reset();
    put(
      "Configs/Test/A.conf.meta",
      'MetaFileClass {\n Name "{AAAAAAAAAAAAAAAA}Configs/Test/A.conf"\n}\n',
    );
    const res = ok(
      call({ action: "createInherited", newPath: "Configs/Test/B.conf", values: { m_iCount: 5 } }),
    );
    expect(res.readback).toMatchObject({
      dryRun: true,
      created: "Configs/Test/B.conf",
      text: 'SCR_TestConfig : "{AAAAAAAAAAAAAAAA}Configs/Test/A.conf" {\n m_iCount 5\n}',
    });
    expect(res.changed?.map((c) => c.path)).toEqual(["ancestor", "m_iCount"]);
    expect(res.next).toMatch(/wb_resources register path:Configs\/Test\/B\.conf/);
    expect(existsSync(abs("Configs/Test/B.conf"))).toBe(false);
  });

  it("creates the file with confirm, parent folders included", () => {
    reset();
    put(
      "Configs/Test/A.conf.meta",
      'MetaFileClass {\n Name "{AAAAAAAAAAAAAAAA}Configs/Test/A.conf"\n}\n',
    );
    const res = ok(
      call({ action: "createInherited", newPath: "Configs/New/Deep/B.conf", confirm: true }),
    );
    expect(res.readback).toMatchObject({ written: true, verified: true });
    expect(get("Configs/New/Deep/B.conf")).toBe(
      'SCR_TestConfig : "{AAAAAAAAAAAAAAAA}Configs/Test/A.conf" {\n}',
    );
    expect(get("Configs/Test/A.conf")).toBe(CONF);
    // The new file parses and reads back its ancestor.
    expect(readback(call({ action: "read", path: "Configs/New/Deep/B.conf" })).ancestor).toBe(
      "{AAAAAAAAAAAAAAAA}Configs/Test/A.conf",
    );
  });

  it("sets a member the new child does not override yet: the blocks above it become header-only overrides (W2 run 3)", () => {
    reset();
    put(
      "Configs/Test/A.conf.meta",
      'MetaFileClass {\n Name "{AAAAAAAAAAAAAAAA}Configs/Test/A.conf"\n}\n',
    );
    const res = ok(
      call({
        action: "createInherited",
        newPath: "Configs/Test/B.conf",
        values: { "m_aEntries.SCR_Entry.m_iValue": 9, "m_aEntries[1].m_iValue": 7 },
        confirm: true,
      }),
    );
    // Each block copies the ancestor's header only (no entries, no base); the second element is
    // the child's own [1].
    expect(get("Configs/Test/B.conf")).toBe(
      [
        'SCR_TestConfig : "{AAAAAAAAAAAAAAAA}Configs/Test/A.conf" {',
        " m_aEntries {",
        "  SCR_Entry First {",
        "   m_iValue 9",
        "  }",
        "  SCR_Entry Second {",
        "   m_iValue 7",
        "  }",
        " }",
        "}",
      ].join("\n"),
    );
    expect(res.changed?.map((c) => c.path)).toEqual([
      "ancestor",
      "m_aEntries.SCR_Entry.m_iValue",
      "m_aEntries[1].m_iValue",
    ]);
    // The ancestor is not touched; a path the ancestor lacks is refused, nothing written.
    expect(get("Configs/Test/A.conf")).toBe(CONF);
    refused(
      call({
        action: "createInherited",
        newPath: "Configs/Test/C.conf",
        values: { "m_aNope.m_iValue": 1 },
        confirm: true,
      }),
      "PATH_NOT_FOUND",
      /the ancestor has no m_aNope/,
    );
    expect(existsSync(abs("Configs/Test/C.conf"))).toBe(false);
  });

  it("copies a block header with a class and a GUID, and finds it again case aside", () => {
    const src = new CstDocument(
      'Root {\n m_a {\n  SCR_E "{5f1cb414f87032ef}" {\n   m_Info SCR_I "{5F1CB414F87032EA}" {\n    m_f 10\n   }\n  }\n }\n}',
    );
    const work = new CstDocument('Root : "{AAAAAAAAAAAAAAAA}x.conf" {\n}');
    const p = overrideBlocks(work, src, "m_a.SCR_E.m_Info.m_f");
    work.set(p, 15);
    expect(overrideBlocks(work, src, "m_a.SCR_E.m_Info.m_f")).toBe(p);
    expect(work.text).toBe(
      'Root : "{AAAAAAAAAAAAAAAA}x.conf" {\n m_a {\n  SCR_E "{5F1CB414F87032EF}" {\n   m_Info SCR_I "{5F1CB414F87032EA}" {\n    m_f 15\n   }\n  }\n }\n}',
    );
  });

  it("uses a path-only ancestor, with a warning, when no GUID is known; an explicit one wins", () => {
    reset();
    const res = ok(call({ action: "createInherited", newPath: "Configs/Test/B.conf" }));
    expect(res.warnings.join(" ")).toMatch(/no GUID/);
    expect((res.readback as { ancestor: string }).ancestor).toBe("Configs/Test/A.conf");
    const g = ok(
      call({
        action: "createInherited",
        newPath: "Configs/Test/B.conf",
        ancestor: "{aaaaaaaaaaaaaaaa}Configs/Test/A.conf",
      }),
    );
    expect((g.readback as { ancestor: string }).ancestor).toBe(
      "{AAAAAAAAAAAAAAAA}Configs/Test/A.conf",
    );
    expect(g.warnings).toEqual([]);
  });

  it("is protected against overwriting, and needs overwrite:true to replace", () => {
    reset();
    put("Configs/Test/B.conf", "SCR_TestConfig {\n}");
    refused(
      call({ action: "createInherited", newPath: "Configs/Test/B.conf", confirm: true }),
      "INVALID_ARGUMENT",
      /already exists/,
    );
    expect(get("Configs/Test/B.conf")).toBe("SCR_TestConfig {\n}");
    const res = ok(
      call({
        action: "createInherited",
        newPath: "Configs/Test/B.conf",
        overwrite: true,
        confirm: true,
      }),
    );
    expect(res.warnings.join(" ")).toMatch(/replaced/);
    expect(get("Configs/Test/B.conf")).toBe('SCR_TestConfig : "Configs/Test/A.conf" {\n}');
  });

  it("refuses a new path outside the project, of another type, or itself", () => {
    reset();
    refused(
      call({ action: "createInherited", newPath: "../Evil.conf", confirm: true }),
      "ABSOLUTE_PATH",
    );
    refused(
      call({ action: "createInherited", newPath: join(tmp, "Evil.conf"), confirm: true }),
      "NOT_IN_PROJECT",
    );
    refused(
      call({ action: "createInherited", newPath: "Configs/Test/B.emat" }),
      "INVALID_ARGUMENT",
      /extension/,
    );
    refused(call({ action: "createInherited", newPath: "Configs/Test/B.txt" }), "INVALID_ARGUMENT");
    refused(call({ action: "createInherited" }), "INVALID_ARGUMENT", /needs newPath/);
    refused(
      call({ action: "createInherited", newPath: "Configs/Test/A.conf", overwrite: true }),
      "INVALID_ARGUMENT",
      /itself/,
    );
    expect(existsSync(join(tmp, "Evil.conf"))).toBe(false);
    expect(get("Configs/Test/A.conf")).toBe(CONF);
  });

  it("inherits from a game resource", () => {
    reset();
    fakeGame();
    const res = ok(
      call({
        action: "createInherited",
        path: "Common/Materials/Game/armor.gamemat",
        newPath: "Materials/Mine.gamemat",
        ancestor: "{0392E90C3BC537EE}Common/Materials/Game/armor.gamemat",
        values: { Name: "Mine" },
        confirm: true,
      }),
    );
    expect(res.warnings).toEqual([]);
    expect(get("Materials/Mine.gamemat")).toBe(
      'GameMaterial : "{0392E90C3BC537EE}Common/Materials/Game/armor.gamemat" {\n Name "Mine"\n}',
    );
  });
});

describe("override", () => {
  it("writes a game resource's own relative path into the project, inheriting from it", () => {
    reset();
    fakeGame();
    const args = {
      action: "override" as const,
      path: "Common/Materials/Game/armor_100mm.gamemat",
      ancestor: "{0392E90C3BC537EE}Common/Materials/Game/armor_100mm.gamemat",
    };
    const dry = ok(call(args));
    expect(dry.readback).toMatchObject({
      dryRun: true,
      created: "Common/Materials/Game/armor_100mm.gamemat",
    });
    expect(existsSync(abs("Common/Materials/Game/armor_100mm.gamemat"))).toBe(false);
    const res = ok(call({ ...args, confirm: true }));
    expect(res.warnings.join(" ")).toMatch(/checked live/);
    expect(get("Common/Materials/Game/armor_100mm.gamemat")).toBe(
      'GameMaterial : "{0392E90C3BC537EE}Common/Materials/Game/armor_100mm.gamemat" {\n}',
    );
    // A second override of the same path is protected.
    refused(call({ ...args, confirm: true }), "INVALID_ARGUMENT", /is already in the project/);
  });

  it("refuses a file that is not a game resource and a game file that needs overwrite", () => {
    reset();
    fakeGame();
    refused(call({ action: "override" }), "INVALID_ARGUMENT", /already in the project/);
    put("Common/Materials/Game/armor.gamemat", "GameMaterial {\n}");
    refused(
      call({ action: "override", path: "Common/Materials/Game/armor.gamemat" }),
      "INVALID_ARGUMENT",
      /already in the project/,
    );
    refused(call({ action: "override", path: "Common/Nope.gamemat" }), "PATH_NOT_FOUND");
  });
});

// ── Refusals that apply to every write ───────────────────────────────────────

describe("write safety", () => {
  it("never writes a game resource", () => {
    reset();
    fakeGame();
    for (const action of ["set", "clear", "arrayAdd", "arrayRemove", "setAncestor"] as const) {
      const e = refused(
        call({
          action,
          path: "Common/Materials/Game/armor.gamemat",
          property: "BallisticInfo",
          value: 1,
          item: 1,
          index: 0,
          ancestor: "x",
          confirm: true,
        }),
        "NOT_IN_PROJECT",
        /game resource/,
      );
      expect(e.next).toMatch(/createInherited or override/);
    }
    expect(existsSync(abs("Common"))).toBe(false);
  });

  it("refuses a file with a parse diagnostic or text it cannot address, and leaves it alone", () => {
    reset();
    const unterminated = 'SCR_TestConfig {\n m_sName "open\n m_iCount 3\n}';
    put("Configs/Test/Bad1.conf", unterminated);
    put("Configs/Test/Bad2.conf", "SCR_TestConfig {\n m_iCount 3\n}\n}\n");
    put("Configs/Test/Bad3.conf", "SCR_TestConfig {\n m_iCount 3");
    for (const f of ["Bad1", "Bad2", "Bad3"]) {
      for (const args of [
        { action: "set" as const, property: "m_iCount", value: 4 },
        { action: "clear" as const, property: "m_iCount" },
        { action: "arrayAdd" as const, item: 1 },
        { action: "setAncestor" as const, ancestor: "x" },
      ]) {
        refused(
          call({ ...args, path: `Configs/Test/${f}.conf`, confirm: true }),
          "INVALID_ARGUMENT",
          /refused, not rewritten/,
        );
      }
    }
    expect(get("Configs/Test/Bad1.conf")).toBe(unterminated);
    expect(get("Configs/Test/Bad2.conf")).toBe("SCR_TestConfig {\n m_iCount 3\n}\n}\n");
    expect(get("Configs/Test/Bad3.conf")).toBe("SCR_TestConfig {\n m_iCount 3");
    // They still read, with the diagnostic in the warnings.
    const rd = ok(call({ action: "read", path: "Configs/Test/Bad1.conf" }));
    expect(rd.warnings.join(" ")).toMatch(/unterminated string/);
    expect(rd.readback).toMatchObject({ writable: false });
  });

  it("refuses a path outside the project, however it is spelled", () => {
    reset();
    const outside = join(tmp, "Outside.conf");
    writeFileSync(outside, CONF);
    for (const path of [
      "../Outside.conf",
      "Configs/../../Outside.conf",
      outside,
      "C:/Windows/x.conf",
    ]) {
      const res = call({ action: "set", path, property: "m_iCount", value: 1, confirm: true });
      expect(res.ok).toBe(false);
      expect(["ABSOLUTE_PATH", "NOT_IN_PROJECT"]).toContain((res as ActionError).code);
    }
    expect(readFileSync(outside, "utf-8")).toBe(CONF);
  });

  it("refuses another file type, a folder and a missing file, and needs a project root", () => {
    reset();
    put("Configs/Test/Note.txt", "x");
    put("Prefabs/P.et", "GenericEntity {\n}");
    refused(
      call({ action: "set", path: "Prefabs/P.et", property: "a", value: 1 }),
      "INVALID_ARGUMENT",
      /not one of/,
    );
    refused(
      call({ action: "read", path: "Configs/Test/Note.txt" }),
      "INVALID_ARGUMENT",
      /not one of/,
    );
    refused(
      call({ action: "set", path: "Configs/Test/Nope.conf", property: "a", value: 1 }),
      "PATH_NOT_FOUND",
    );
    mkdirSync(abs("Folder.conf"));
    refused(call({ action: "read", path: "Folder.conf" }), "INVALID_ARGUMENT", /not a file/);
    const noRoot = { ...config, projectPath: "" } as Config;
    const res = runConfigEdit(
      { action: "set", path: "Configs/Test/A.conf", property: "m_iCount", value: 1, confirm: true },
      noRoot,
    );
    expect((res as ActionError).code).toBe("NOT_IN_PROJECT");
  });

  it("refuses a projectPath outside the configured root and leaves the file alone", () => {
    reset();
    const outside = join(tmp, "Outside");
    mkdirSync(outside, { recursive: true });
    const before = "SCR_TestConfig {\n m_iCount 1\n}";
    writeFileSync(join(outside, "O.conf"), before);
    const res = runConfigEdit(
      {
        action: "set",
        path: "O.conf",
        property: "m_iCount",
        value: 2,
        confirm: true,
        projectPath: outside,
      },
      config,
    );
    expect((res as ActionError).code).toBe("NOT_IN_PROJECT");
    expect(readFileSync(join(outside, "O.conf"), "utf-8")).toBe(before);
  });

  it("takes projectPath as the root, and a {GUID} or path: prefix on the path", () => {
    reset();
    // A project under the configured root (DEC-058: any project there, not any folder).
    const other = join(root, "Other");
    mkdirSync(other, { recursive: true });
    writeFileSync(join(other, "O.conf"), "SCR_TestConfig {\n m_iCount 1\n}");
    const res = runConfigEdit(
      {
        action: "set",
        path: "{0123456789ABCDEF}O.conf",
        property: "m_iCount",
        value: 2,
        confirm: true,
        projectPath: other,
      },
      config,
    );
    expect(ok(res).target).toBe("path:O.conf");
    expect(readFileSync(join(other, "O.conf"), "utf-8")).toBe("SCR_TestConfig {\n m_iCount 2\n}");
    ok(call({ action: "read", path: "path:Configs/Test/A.conf" }));
  });

  it("keeps the file's bytes when the file is not UTF-8 or has a byte-order mark", () => {
    reset();
    const bom = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from("PhysicsMaterial {\n Friction 0.7\n}"),
    ]);
    put("Materials/Bom.physmat", bom);
    call({
      action: "set",
      path: "Materials/Bom.physmat",
      property: "Friction",
      value: 0.3,
      confirm: true,
    });
    const out = readFileSync(abs("Materials/Bom.physmat"));
    expect(out.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(true);
    expect(out.subarray(3).toString("utf-8")).toBe("PhysicsMaterial {\n Friction 0.3\n}");
    const latin = Buffer.from('PhysicsMaterial {\n Name "caf\xe9"\n Friction 0.7\n}', "latin1");
    put("Materials/Latin.physmat", latin);
    call({
      action: "set",
      path: "Materials/Latin.physmat",
      property: "Friction",
      value: 0.3,
      confirm: true,
    });
    expect(
      readFileSync(abs("Materials/Latin.physmat")).equals(
        Buffer.from(latin.toString("latin1").replace("0.7", "0.3"), "latin1"),
      ),
    ).toBe(true);
    refused(
      call({
        action: "set",
        path: "Materials/Latin.physmat",
        property: "Name",
        value: "\u4e2d",
        confirm: true,
      }),
      "INVALID_ARGUMENT",
      /latin-1/,
    );
  });

  it("dry runs leave every file's bytes and times alone", () => {
    reset();
    const files = ["Configs/Test/A.conf", "Materials/M.emat", "Materials/P.physmat"];
    const stamp = (f: string) =>
      `${statSync(abs(f)).mtimeMs}:${readFileSync(abs(f)).toString("hex")}`;
    const before = files.map(stamp);
    call({ action: "set", property: "m_iCount", value: 1 });
    call({ action: "clear", property: "m_iCount" });
    call({ action: "arrayAdd", property: "m_aItems", item: "x" });
    call({ action: "arrayRemove", property: "m_aItems", index: 0 });
    call({
      action: "setAncestor",
      path: "Materials/M.emat",
      ancestor: "{0123456789ABCDEF}Materials/Z.emat",
    });
    call({ action: "createInherited", newPath: "Configs/Test/Z.conf" });
    expect(files.map(stamp)).toEqual(before);
    expect(existsSync(abs("Configs/Test/Z.conf"))).toBe(false);
  });
});

// ── lineDiff and the tool registration ───────────────────────────────────────

describe("lineDiff", () => {
  it("shows the changed lines with context, and says when nothing changed", () => {
    expect(lineDiff("a\nb\nc\nd\ne", "a\nb\nX\nd\ne", 1)).toBe(
      ["@@ -2,3 +2,3 @@", " b", "-c", "+X", " d"].join("\n"),
    );
    expect(lineDiff("a\nb", "a\nb")).toBe("(no change)");
    expect(lineDiff("a\nb", "a\nb\nc", 0)).toBe(["@@ -3,0 +3,1 @@", "+c"].join("\n"));
  });
});

describe("registerConfigEdit", () => {
  it("registers config_edit with a description within the budget, and answers JSON", async () => {
    reset();
    expect(CONFIG_EDIT_DESCRIPTION.length).toBeLessThanOrEqual(400);
    let name = "";
    let def: { description: string; inputSchema: Record<string, unknown> } | undefined;
    let handler:
      | ((a: unknown) => Promise<{ content: { text: string }[]; isError: boolean }>)
      | undefined;
    registerConfigEdit(
      {
        registerTool: (n: string, d: typeof def, h: typeof handler) => {
          name = n;
          def = d;
          handler = h;
        },
      } as never,
      config,
    );
    expect(name).toBe("config_edit");
    expect(def?.description).toBe(CONFIG_EDIT_DESCRIPTION);
    expect(Object.keys(def!.inputSchema)).toEqual(
      expect.arrayContaining([
        "action",
        "path",
        "property",
        "value",
        "confirm",
        "overwrite",
        "projectPath",
      ]),
    );
    const good = await handler!({ action: "read", path: "Configs/Test/A.conf" });
    expect(good.isError).toBe(false);
    expect(JSON.parse(good.content[0].text)).toMatchObject({
      ok: true,
      action: "read",
      target: "path:Configs/Test/A.conf",
    });
    const bad = await handler!({
      action: "set",
      path: "Configs/Test/A.conf",
      property: "m_nope.x",
      value: 1,
    });
    expect(bad.isError).toBe(true);
    expect(JSON.parse(bad.content[0].text)).toMatchObject({ ok: false, code: "PATH_NOT_FOUND" });
  });
});

// ── The vanilla corpus ───────────────────────────────────────────────────────

const OPEN = openVanillaCorpus(loadBaseline(), { ignoreBaseline: true });
if (OPEN.skip !== undefined) console.warn(`[config_edit] corpus round trip SKIPPED: ${OPEN.skip}`);

describe.skipIf(OPEN.skip !== undefined)(
  `vanilla config files${OPEN.skip ? ` (SKIPPED: ${OPEN.skip})` : ""}`,
  () => {
    const corpus = OPEN.corpus!;
    const exts = CONFIG_EDIT_EXTENSIONS.map((e) => e.slice(1));

    it("gives every file back byte for byte, and a no-op set leaves the bytes alone", () => {
      let files = 0;
      let exact = 0;
      let noopTried = 0;
      const off: string[] = [];
      const noopOff: string[] = [];
      const perExt: Record<string, string> = {};
      for (const ext of exts) {
        const list = corpus.list(ext);
        let n = 0;
        for (const f of list) {
          const buf = corpus.read(f);
          files++;
          n++;
          const doc = parseCstBytes(buf);
          if (doc.toBytes().equals(buf)) exact++;
          else off.push(f);
          // A no-op edit through the writer's own set: the first scalar of the
          // root block, set to the value it already has, changes nothing.
          if (doc.diagnostics.length > 0) continue;
          const base = doc.base;
          const first = base.children.find(
            (c) =>
              c.kind === "scalar" &&
              c.values.length > 0 &&
              c.values.every(
                (t) => !t.text.includes("\\") && (t.kind === "string" || !/["]/.test(t.text)),
              ),
          );
          if (!first || first.kind !== "scalar") continue;
          noopTried++;
          const work = new CstDocument(doc.text, doc.encoding);
          const values = first.values.map((t) =>
            t.kind === "string" ? t.text.slice(1, -1) : t.text,
          );
          try {
            work.set(first.key, values.length === 1 ? values[0] : values);
            if (work.text !== doc.text) noopOff.push(f);
          } catch {
            noopOff.push(f);
          }
        }
        perExt[ext] = `${n}`;
      }
      console.log(
        `[config_edit] corpus round trip: ${exact}/${files} byte-exact (${JSON.stringify(perExt)}); no-op set unchanged on ${noopTried - noopOff.length}/${noopTried}`,
      );
      expect(files).toBeGreaterThan(10000);
      expect(off).toEqual([]);
      expect(exact).toBe(files);
      expect(noopOff.slice(0, 5)).toEqual([]);
    }, 180_000);
  },
);

// Census rows this file tests (W2 promotion, EV-W2-085).
// census:mcp:action/config_edit.arrayAdd
// census:mcp:action/config_edit.arrayRemove
// census:mcp:action/config_edit.clear
// census:mcp:action/config_edit.createInherited
// census:mcp:action/config_edit.read
// census:mcp:action/config_edit.set
// census:mcp:action/config_edit.setAncestor
