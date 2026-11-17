import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  ERROR_CODES,
  ENTITY_SCHEMA,
  errorResponse,
  MODULE_IDS,
  MODULE_SCHEMA,
  moduleAllowsRead,
  PAGING_SCHEMA,
  CONFIRM_SCHEMA,
  ENTITY_REF_SCHEMA,
  checkCursor,
  isStaleCursor,
  nextCursor,
  normalizeEntityId,
  parseCursor,
  parseEntityRef,
  parseEntityTarget,
  printCursor,
  printEntityRef,
  printEntityTarget,
  parsePath,
  parseTarget,
  printPath,
  printTarget,
  VocabularyError,
} from "../../src/manifest/vocabulary.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (e) {
    return e instanceof VocabularyError ? e.code : "other";
  }
}

describe("module enum", () => {
  it("has the probe's names minus DialogueEditor and NavmeshGeneratorMain plus ParticleEditor, 9 in all", () => {
    const util = readFileSync(resolve(root, "mod-dev/probe/ECEN_ProbeUtil.c"), "utf-8");
    const probe = [...util.matchAll(/name == "([A-Za-z]+)"/g)].map((m) => m[1]);
    // NavmeshGeneratorMain is gone from build 1.9.0.37 on (W5 OD-5, DEC-068).
    const expected = [
      ...probe.filter((n) => n !== "DialogueEditor" && n !== "NavmeshGeneratorMain"),
      "ParticleEditor",
    ].sort();
    expect([...MODULE_IDS].sort()).toEqual(expected);
    expect(MODULE_IDS).toHaveLength(9);
    expect(MODULE_SCHEMA.safeParse("DialogueEditor").success).toBe(false);
  });

  it("refuses reads on ParticleEditor only", () => {
    expect(moduleAllowsRead("ParticleEditor")).toBe(false);
    expect(moduleAllowsRead("WorldEditor")).toBe(true);
  });
});

describe("parseTarget", () => {
  it("parses path and open forms and prints them back", () => {
    expect(parseTarget("path:Prefabs/A.et")).toEqual({ kind: "path", path: "Prefabs/A.et" });
    expect(parseTarget("path:Prefabs\\A.et")).toEqual({ kind: "path", path: "Prefabs/A.et" });
    expect(parseTarget("open:WorldEditor")).toEqual({ kind: "open", module: "WorldEditor" });
    expect(printTarget(parseTarget("path:Worlds/x.ent"))).toBe("path:Worlds/x.ent");
  });

  it.each([
    "path:C:/Mods/a.et",
    "path:c:\\x\\a.et",
    "path:/etc/a.et",
    "path:\\\\server\\share\\a.et",
    "path:$profile:a.et",
    "path:$EMCP2_sandbox:Prefabs/a.et",
    "path:file:///a.et",
    "path:file:/etc/a.et",
    "path:file:C:/x/a.et",
    "path:http:x",
    "path:Prefabs/../../a.et",
    "path:..\\a.et",
  ])("rejects %s with ABSOLUTE_PATH", (t) => {
    expect(codeOf(() => parseTarget(t))).toBe("ABSOLUTE_PATH");
  });

  it("allows a dotted name that is not a '..' segment", () => {
    expect(parseTarget("path:Prefabs/a..b.et")).toEqual({ kind: "path", path: "Prefabs/a..b.et" });
  });

  it("rejects other forms with INVALID_ARGUMENT", () => {
    expect(codeOf(() => parseTarget("open:AudioEditor"))).toBe("INVALID_ARGUMENT");
    expect(codeOf(() => parseTarget("Prefabs/A.et"))).toBe("INVALID_ARGUMENT");
    expect(codeOf(() => parseTarget("path:"))).toBe("INVALID_ARGUMENT");
  });
});

describe("path grammar", () => {
  it("parses and prints components[2].MeshObject.Object", () => {
    const segs = parsePath("components[2].MeshObject.Object");
    expect(segs).toEqual([
      { name: "components", indices: [2] },
      { name: "MeshObject", indices: [] },
      { name: "Object", indices: [] },
    ]);
    expect(printPath(segs)).toBe("components[2].MeshObject.Object");
  });

  it("round-trips nested indices", () => {
    expect(printPath(parsePath("a[0][3].b_c"))).toBe("a[0][3].b_c");
  });

  it.each(["", "a..b", "a.", "[1]", "a[-1]", "a[x]", "a b", "1a"])("rejects '%s'", (p) => {
    expect(codeOf(() => parsePath(p))).toBe("INVALID_ARGUMENT");
  });
});

describe("entity, paging, confirm", () => {
  it("takes {name} or {index}, not both or neither", () => {
    expect(ENTITY_SCHEMA.safeParse({ name: "Tree" }).success).toBe(true);
    expect(ENTITY_SCHEMA.safeParse({ index: 0 }).success).toBe(true);
    expect(ENTITY_SCHEMA.safeParse({ name: "a", index: 1 }).success).toBe(false);
    expect(ENTITY_SCHEMA.safeParse({}).success).toBe(false);
  });

  it("defaults paging to limit 100, mode summary, fields name,type,value and caps limit at 200", () => {
    expect(PAGING_SCHEMA.parse({})).toEqual({
      limit: 100,
      mode: "summary",
      fields: "name,type,value",
    });
    expect(PAGING_SCHEMA.safeParse({ limit: 201 }).success).toBe(false);
    expect(PAGING_SCHEMA.safeParse({ limit: 200, mode: "page", cursor: "abc" }).success).toBe(true);
  });

  it("accepts confirm only as literal true", () => {
    expect(CONFIRM_SCHEMA.safeParse(true).success).toBe(true);
    expect(CONFIRM_SCHEMA.safeParse("true").success).toBe(false);
  });
});

describe("W1 entity reference", () => {
  it("parses id:, name: and index: and prints them back", () => {
    expect(parseEntityRef("id:0x000000010000002A")).toEqual({
      kind: "id",
      id: "000000010000002a",
    });
    expect(parseEntityRef("id:2a")).toEqual({ kind: "id", id: "000000000000002a" });
    expect(parseEntityRef("name:Tree 01")).toEqual({ kind: "name", name: "Tree 01" });
    expect(parseEntityRef("name:a:b")).toEqual({ kind: "name", name: "a:b" });
    expect(parseEntityRef("index:0")).toEqual({ kind: "index", index: 0 });
    expect(parseEntityRef("index:123456789")).toEqual({ kind: "index", index: 123456789 });
    expect(printEntityRef(parseEntityRef("id:2A"))).toBe("id:0x000000000000002a");
    expect(printEntityRef(parseEntityRef("name:Tree"))).toBe("name:Tree");
    expect(printEntityRef(parseEntityRef("index:07"))).toBe("index:7");
  });

  it("round-trips its own printed form", () => {
    for (const r of ["id:0xffffffffffffffff", "name: spaced ", "index:42"]) {
      expect(printEntityRef(parseEntityRef(r))).toBe(r);
    }
  });

  it("normalises an id like EMCP_WB_EntityRef.NormalizeHex", () => {
    expect(normalizeEntityId("0X00FF")).toBe("00000000000000ff");
    expect(normalizeEntityId(" ff ")).toBe("00000000000000ff");
    expect(normalizeEntityId("00000000000000000001")).toBe("0000000000000001");
    expect(normalizeEntityId("10000000000000000")).toBeUndefined();
    expect(normalizeEntityId("0x")).toBeUndefined();
    expect(normalizeEntityId("xyz")).toBeUndefined();
  });

  it.each([
    "",
    "id:",
    "id:0x",
    "id:0xg1",
    "id:-1",
    "id:1 2",
    "id:10000000000000000",
    "name:",
    "name:a\0b",
    "index:",
    "index:-1",
    "index:+1",
    "index:1.5",
    "index:1234567890",
    "index: 1",
    "Tree",
    "ID:1",
    "entity:name:x",
  ])("rejects '%s' with INVALID_ARGUMENT", (r) => {
    expect(codeOf(() => parseEntityRef(r))).toBe("INVALID_ARGUMENT");
  });

  it("the schema accepts a well-formed ref and refuses a malformed one", () => {
    expect(ENTITY_REF_SCHEMA.safeParse("index:3").success).toBe(true);
    expect(ENTITY_REF_SCHEMA.safeParse("id:0xAB").success).toBe(true);
    expect(ENTITY_REF_SCHEMA.safeParse("index:x").success).toBe(false);
    expect(ENTITY_REF_SCHEMA.safeParse(3).success).toBe(false);
  });

  it("parses and prints the entity:<ref> target, apart from parseTarget", () => {
    expect(parseEntityTarget("entity:name:Tree")).toEqual({
      kind: "entity",
      ref: { kind: "name", name: "Tree" },
    });
    expect(printEntityTarget(parseEntityTarget("entity:id:1"))).toBe(
      "entity:id:0x0000000000000001",
    );
    expect(codeOf(() => parseEntityTarget("path:a.et"))).toBe("INVALID_ARGUMENT");
    expect(codeOf(() => parseEntityTarget("entity:index:-1"))).toBe("INVALID_ARGUMENT");
    expect(codeOf(() => parseTarget("entity:name:Tree"))).toBe("INVALID_ARGUMENT");
  });
});

describe("W1 cursor", () => {
  it("parses and prints <start>:<count>", () => {
    expect(parseCursor("0:10")).toEqual({ start: 0, count: 10 });
    expect(parseCursor("50:120")).toEqual({ start: 50, count: 120 });
    expect(parseCursor("0:0")).toEqual({ start: 0, count: 0 });
    expect(printCursor(parseCursor("50:120"))).toBe("50:120");
  });

  it.each(["", "5", ":5", "5:", "a:5", "5:a", "-1:5", "1:2:3", "11:10", " 1:5", "1234567890:1"])(
    "rejects '%s' with INVALID_ARGUMENT",
    (c) => {
      expect(codeOf(() => parseCursor(c))).toBe("INVALID_ARGUMENT");
    },
  );

  it("answers STALE_CURSOR when the total changed", () => {
    const c = parseCursor("50:120");
    expect(isStaleCursor(c, 120)).toBe(false);
    expect(isStaleCursor(c, 119)).toBe(true);
    expect(() => checkCursor(c, 120)).not.toThrow();
    expect(codeOf(() => checkCursor(c, 121))).toBe("STALE_CURSOR");
  });

  it("issues the next page's cursor, none at the end", () => {
    expect(nextCursor(0, 50, 120)).toBe("50:120");
    expect(nextCursor(100, 50, 120)).toBeUndefined();
    expect(nextCursor(70, 50, 120)).toBeUndefined();
    expect(nextCursor(0, 50, 0)).toBeUndefined();
  });
});

describe("error codes and response shape", () => {
  it("carries the seven design codes", () => {
    for (const c of [
      "MODULE_NOT_OPEN",
      "NOT_IN_PROJECT",
      "NOT_ALLOWLISTED",
      "ABSOLUTE_PATH",
      "PATH_NOT_FOUND",
      "MODAL_OPEN",
      "LOST",
    ]) {
      expect(ERROR_CODES).toHaveProperty(c);
    }
  });

  it("carries the five W1 codes, each with a one-line next text", () => {
    for (const c of ["ENTITY_NOT_FOUND", "WRONG_MODE", "NO_WORLD", "NO_TERRAIN", "STALE_CURSOR"]) {
      const next = (ERROR_CODES as Record<string, string>)[c];
      expect(next, c).toBeTruthy();
      expect(next, c).not.toContain("\n");
      expect(next, c).toMatch(/\.$/);
    }
  });

  it("builds an error response with the table's next text", () => {
    expect(errorResponse("save", "open:WorldEditor", "MODAL_OPEN", "Save As dialog")).toEqual({
      ok: false,
      action: "save",
      target: "open:WorldEditor",
      code: "MODAL_OPEN",
      message: "Save As dialog",
      next: "A modal dialog is open; nothing was sent; ask the owner.",
      warnings: [],
    });
  });
});
