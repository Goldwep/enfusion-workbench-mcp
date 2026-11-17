/**
 * The shipped entity reference resolver (EMCP_WB_EntityRef.c, phase5-w1-spec.md section 1),
 * checked over the Enforce text offline. Nothing here talks to Workbench.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ERROR_CODES, normalizeEntityId } from "../../src/manifest/vocabulary.js";

const DIR = join("mod", "Scripts", "WorkbenchGame", "EnfusionMCP");
const src = readFileSync(join(DIR, "EMCP_WB_EntityRef.c"), "utf-8");

/** Source with comments removed, so a word in a comment never counts as a call. */
function code(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/** Body of `static <type> <name>(` up to the next method separator. */
function method(s: string, name: string): string {
  const at = s.search(new RegExp(`static \\w+ ${name}\\(`));
  expect(at, `method ${name}`).toBeGreaterThanOrEqual(0);
  const end = s.indexOf("//-----", at);
  return s.slice(at, end < 0 ? undefined : end);
}

const RESOLVERS = [
  "Resolve",
  "ResolveId",
  "ResolveIdByFind",
  "ResolveIdByScan",
  "ResolveName",
  "ResolveIndex",
];

describe("EMCP_WB_EntityRef", () => {
  it("is one static helper class, not a NET handler", () => {
    expect(src).toMatch(/^class EMCP_WB_EntityRef\s*$/m);
    expect(src).not.toMatch(/NetApiHandler|JsonApiStruct|RegV\(/);
    const c = code(src);
    const statics = [...c.matchAll(/^\t(static )?\w[\w<>]* \w+\(/gm)];
    expect(statics.length).toBeGreaterThan(0);
    for (const m of statics) expect(m[1], m[0]).toBe("static ");
  });

  it("has the public API the W1 handlers code against", () => {
    for (const sig of [
      "static bool Resolve(WorldEditorAPI api, string entityRef, notnull EMCP_WB_EntityRefResult res)",
      "static bool ResolveId(WorldEditorAPI api, string hex, notnull EMCP_WB_EntityRefResult res)",
      "static bool ResolveIdByFind(WorldEditorAPI api, string norm, notnull EMCP_WB_EntityRefResult res)",
      "static bool ResolveIdByScan(WorldEditorAPI api, string norm, notnull EMCP_WB_EntityRefResult res)",
      "static bool ResolveName(WorldEditorAPI api, string entityName, notnull EMCP_WB_EntityRefResult res)",
      "static bool ResolveIndex(WorldEditorAPI api, string digits, notnull EMCP_WB_EntityRefResult res)",
      "static int IndexOf(WorldEditorAPI api, IEntitySource target)",
      "static string Format(IEntitySource entSrc)",
      "static string IdHex(IEntitySource entSrc)",
      "static string NormalizeHex(string raw)",
      "static bool HexToInts(string norm, out int hi, out int lo)",
    ]) {
      expect(src).toContain(sig);
    }
  });

  it("answers the vocabulary's codes and the three prefixes", () => {
    expect(src).toContain('static const string ENTITY_NOT_FOUND = "ENTITY_NOT_FOUND";');
    expect(src).toContain('static const string INVALID_ARGUMENT = "INVALID_ARGUMENT";');
    expect(ERROR_CODES).toHaveProperty("ENTITY_NOT_FOUND");
    expect(ERROR_CODES).toHaveProperty("INVALID_ARGUMENT");
    for (const p of ["id:", "name:", "index:"]) expect(src).toContain(`= "${p}";`);
    const body = method(src, "Resolve");
    expect(body).toContain("ResolveId(api, entityRef.Substring(PREFIX_ID.Length()");
    expect(body).toContain("ResolveName(api, entityRef.Substring(PREFIX_NAME.Length()");
    expect(body).toContain("ResolveIndex(api, entityRef.Substring(PREFIX_INDEX.Length()");
    expect(body).toContain("res.m_Code = INVALID_ARGUMENT;");
    expect(body).toContain("if (!api)");
  });

  it("OD-9 is one constant, defaulting to the scan until P-W1-01 runs", () => {
    expect(src).toContain("static const bool ID_BY_FIND = false;");
    expect([...code(src).matchAll(/ID_BY_FIND/g)]).toHaveLength(2);
    const body = method(src, "ResolveId");
    expect(body).toMatch(
      /if \(ID_BY_FIND\)\s*return ResolveIdByFind\(api, norm, res\);\s*return ResolveIdByScan\(api, norm, res\);/,
    );
  });

  it("path a: FindEntityByID(EntityID.FromInt(hi, lo)) from the hex split", () => {
    const body = method(src, "ResolveIdByFind");
    expect(body).toContain("HexToInts(norm, hi, lo)");
    expect(body).toContain("api.FindEntityByID(EntityID.FromInt(hi, lo))");
    expect(body).toContain("IndexOf(api, found)");
    const split = method(src, "HexToInts");
    expect(split).toContain("hi = (hi << 4) | digit;");
    expect(split).toContain("lo = (lo << 4) | digit;");
    expect(split).toContain("if (i < 8)");
  });

  it("path b: GetEditorEntity scan comparing the normalised GetID().ToString()", () => {
    const body = method(src, "ResolveIdByScan");
    expect(body).toContain("api.GetEditorEntityCount()");
    expect(body).toContain("api.GetEditorEntity(i)");
    expect(body).toContain("if (IdHex(candidate) == norm)");
    const idHex = method(src, "IdHex");
    // Fix-up 1: the hex the id text holds, else a digest of the text (never empty for a text).
    expect(idHex).toContain("string raw = RawIdText(entSrc);");
    expect(idHex).toContain("string hex = HexOfText(raw);");
    expect(idHex).toContain("return Digest(raw);");
    expect(method(src, "RawIdText")).toContain("EntityID eid = entSrc.GetID();");
    expect(body).toContain("if (matches > 1)");
  });

  it("name: and index: scan or index the editor list; index takes digits only", () => {
    const name = method(src, "ResolveName");
    expect(name).toContain("candidate.GetName() == entityName");
    expect(name).toContain('if (entityName == "")');
    const idx = method(src, "ResolveIndex");
    expect(idx).toContain("bool allDigits = len > 0 && len <= 9;");
    expect(idx).toContain("digits.IsDigitAt(c)");
    expect(idx).toContain("if (wanted >= count)");
    expect(idx).toContain("api.GetEditorEntity(wanted)");
  });

  it("the formatter prints id:0x + 16 hex digits, as the TS grammar does", () => {
    const body = method(src, "Format");
    expect(body).toContain('return PREFIX_ID + "0x" + norm;');
    expect(src).toContain("static const int ID_DIGITS = 16;");
    expect(normalizeEntityId("0x2A")).toHaveLength(16);
    const norm = method(src, "NormalizeHex");
    expect(norm).toContain("s.ToLower();");
    expect(norm).toContain('if (s.StartsWith("0x"))');
    expect(norm).toContain('s = "0" + s;');
  });

  it("resets the result holder on entry of each resolver; no out parameter of an engine type", () => {
    for (const name of RESOLVERS) {
      const body = method(src, name);
      expect(body, name).toMatch(
        /\(WorldEditorAPI api, string \w+, notnull EMCP_WB_EntityRefResult res\)\s*\{\s*res\.Reset\(\);/,
      );
    }
    // Workbench 1.9.0.37: "Types 'Class' and 'IEntitySource' are unrelated" on `out IEntitySource`.
    expect(code(src)).not.toMatch(/\b(out|inout)\s+IEntitySource\b/);
    expect(code(resolverSrc)).not.toMatch(/\b(out|inout)\s+IEntitySource\b/);
    const split = method(src, "HexToInts");
    expect(split).toContain("hi = 0;");
    expect(split).toContain("lo = 0;");
  });

  it("writes nothing and calls no banned method; no ternary, no 'ref' identifier", () => {
    const c = code(src);
    for (const banned of [
      "FindFiles",
      "FileIO.",
      "Workbench.Dialog",
      "RunCommandline",
      "Configure",
      "BeginEntityAction",
      "SetVariableValue",
      "DeleteEntity",
      "CreateEntity",
      "RenameEntity",
    ]) {
      expect(c, banned).not.toContain(banned);
    }
    expect(c).not.toMatch(/\?[^"\n]*:/);
    expect(c).not.toMatch(/\bref\b/);
    expect(src).not.toMatch(/EMCP2_sandbox|[A-Za-z]:[\\/]Users[\\/]/i);
  });
});

// Review R1: a request that resolves a list of references builds the id map once.
const resolverSrc = readFileSync(join(DIR, "EMCP_WB_EntityRefResolver.c"), "utf-8");

describe("EMCP_WB_EntityRefResolver", () => {
  it("is one class, not a NET handler, that owns its id map", () => {
    expect(resolverSrc).toMatch(/^class EMCP_WB_EntityRefResolver\s*$/m);
    expect(resolverSrc).not.toMatch(/NetApiHandler|JsonApiStruct|RegV\(/);
    expect(resolverSrc).toContain("protected ref map<string, int> m_IdIndex;");
  });

  it("scans for the first id: reference and builds the map once from the second on", () => {
    const c = code(resolverSrc);
    expect(c).toContain("if (m_IdLookups < 2)");
    expect(c).toMatch(/if \(!m_IdIndex\)\s*BuildIdIndex\(\);/);
    expect(c.match(/BuildIdIndex\(\)/g) ?? []).toHaveLength(2);
    // name:, index: and the FindEntityByID path go to EMCP_WB_EntityRef.Resolve as before.
    expect(c).toContain(
      "if (!m_Api || EMCP_WB_EntityRef.ID_BY_FIND || !entityRef.StartsWith(EMCP_WB_EntityRef.PREFIX_ID))",
    );
    // The first index with an id is kept; a repeat only counts (review round 1, F4: an id that
    // names more than one entity is refused, as the scan refuses it).
    expect(c).toMatch(/m_IdMatches\.Set\(norm, seen \+ 1\);\s*continue;\s*\}\s*m_IdMatches\.Insert\(norm, 1\);\s*m_IdIndex\.Insert\(norm, i\);/);
  });

  it("answers through the EMCP_WB_EntityRefResult holder (no ref on the engine pointer)", () => {
    expect(resolverSrc).toMatch(/^class EMCP_WB_EntityRefResult\s*$/m);
    for (const m of [
      "\tIEntitySource m_Src;",
      "\tint m_Index;",
      "\tstring m_Code;",
      "\tstring m_Why;",
    ])
      expect(resolverSrc, m).toContain(m);
    expect(resolverSrc).toContain(
      "bool Resolve(string entityRef, notnull EMCP_WB_EntityRefResult res)",
    );
    expect(code(resolverSrc)).toContain("return EMCP_WB_EntityRef.Resolve(m_Api, entityRef, res);");
  });

  it("writes nothing and uses no ternary", () => {
    const c = code(resolverSrc);
    for (const w of ["SetVariableValue", "BeginEntityAction", "FileIO", "RunCmd"])
      expect(c, w).not.toContain(w);
    expect(c).not.toMatch(/\?[^"\n]*:/);
  });
});
