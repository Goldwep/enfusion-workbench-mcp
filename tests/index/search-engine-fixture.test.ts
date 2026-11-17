import { describe, it, expect, afterAll } from "vitest";
import { SearchEngine } from "../../src/index/search-engine.js";
import { cls, method, writeFixtureDataDir } from "./api-fixture.js";

const fixture = writeFixtureDataDir();
afterAll(() => fixture.cleanup());

/**
 * Classes stored under a raw Doxygen page title, as 29 index classes are
 * (`Tuple2< Class T1, Class T2 > Interface Template Reference`): the parent's
 * stored children (from hierarchy.html) name them with their template
 * parameter list, and they name the parent themselves. A pak class (`Arr`)
 * names a parent whose stored children hold its template form (`Arr< Class T >`).
 */
const rawTitles = writeFixtureDataDir({
  arma: [
    cls("ParamBase", { children: ["Param< Class T >"] }),
    cls("Param< Class T > Interface Template Reference", {
      parents: ["ParamBase"],
      children: ["IntParam"],
      methods: [method("void Set (T value)")],
    }),
    cls("IntParam", { parents: ["Param< Class T >"] }),
    cls("Holder", { children: ["Arr< Class T >"] }),
    cls("Arr", {
      parents: ["Holder"],
      origin: "pak",
      pakFile: "scripts/Core/proto/Arr.c",
      pakLine: 1,
    }),
  ],
});
afterAll(() => rawTitles.cleanup());

describe("SearchEngine on a small fixture", () => {
  const engine = new SearchEngine(fixture.dataDir);

  describe("children derived from parents", () => {
    it("a parent lists the classes that name it, after its stored children, without duplicates", () => {
      // Base stores Child2; Child2 also names it (as BASE), PakChild only names it.
      expect(engine.getChildren("Base")).toEqual(["Child2", "PakChild"]);
      expect(engine.getChildren("base")).toEqual(["Child2", "PakChild"]);
      expect(engine.getChildren("Managed")).toEqual(["Base"]);
      expect(engine.getChildren("Grand")).toEqual([]);
      expect(engine.getChildren("NoSuchClass")).toEqual([]);
    });

    it("the class tree walks the derived children", () => {
      expect(engine.getClassTree("Managed").descendants).toEqual([
        "Base",
        "Child2",
        "PakChild",
        "Grand",
      ]);
      expect(engine.getClassTree("Grand").ancestors).toEqual(["PakChild", "Base", "Managed"]);
    });
  });

  describe("children whose names are raw page titles or template forms", () => {
    const raw = new SearchEngine(rawTitles.dataDir);

    it("a class is listed once, under its normalised name", () => {
      expect(raw.getChildren("ParamBase")).toEqual(["Param"]);
      expect(raw.getChildren("Holder")).toEqual(["Arr"]);
    });

    it("the normalised name finds the class stored under its page title", () => {
      expect(raw.getClass("Param")?.name).toBe("Param< Class T > Interface Template Reference");
      expect(raw.getClass("Param< Class T >")?.name).toBe(
        "Param< Class T > Interface Template Reference",
      );
      expect(raw.getClass("Arr< Class T >")?.name).toBe("Arr");
      // An exact name still wins, and an unknown name stays unknown.
      expect(raw.getClass("ParamBase")?.name).toBe("ParamBase");
      expect(raw.getClass("NoSuch< Class T >")).toBeUndefined();
    });

    it("the page-title class's own children and the tree go through the same names", () => {
      expect(raw.getChildren("Param< Class T > Interface Template Reference")).toEqual([
        "IntParam",
      ]);
      expect(raw.getChildren("Param")).toEqual(["IntParam"]);
      expect(raw.getClassTree("ParamBase").descendants).toEqual(["Param", "IntParam"]);
      expect(raw.getClassTree("Holder").descendants).toEqual(["Arr"]);
    });
  });

  describe("searchMethods", () => {
    const keyOf = (r: { className: string; method: { signature: string } }): string =>
      `${r.className}::${r.method.signature}`;

    it("the fuzzy fallback does not add the strict matches a second time", () => {
      // One strict match (fewer than three) for a mixed-case name: before the
      // fix the fallback compared lowercased keys with original-case names and
      // appended it again.
      const results = engine.searchMethods("TraceWorldPos");
      const keys = results.map(keyOf);
      expect(
        keys.filter((k) => k.startsWith("WorldEditorAPI::proto external bool TraceWorldPos")),
      ).toHaveLength(1);
      expect(new Set(keys).size).toBe(keys.length);
      const run = engine.searchMethods("Run");
      expect(run.map(keyOf).filter((k) => k === "PakChild::void Run()")).toHaveLength(1);
    });

    it("keeps every overload under the shared name", () => {
      const results = engine.searchMethods("SetVariableValue", "enfusion");
      expect(results.filter((r) => r.method.name === "SetVariableValue")).toHaveLength(2);
    });

    it("ranks exact, case-insensitive name matches ahead of prefix and substring matches", () => {
      const results = engine.searchMethods("setvariablevalue");
      expect(results.map((r) => `${r.className}.${r.method.name}`)).toEqual([
        "WorldEditorAPI.SetVariableValue",
        "WorldEditorAPI.SetVariableValue",
        "SCR_ScenarioFrameworkSystem.SetVariableValue",
        "WorldEditorAPI.SetVariableValueEx",
        "SCR_ScenarioFrameworkSystem.RpcDo_SetVariableValue",
      ]);
      const any = engine.searchAny("SETVARIABLEVALUE", "all", 3);
      expect(any.every((r) => r.methodResult?.method.name === "SetVariableValue")).toBe(true);
    });
  });

  it("inherited members keep every overload; a nearer ancestor hides only the same signature", () => {
    const inherited = engine.getInheritedMembers("OverloadLeaf");
    expect(inherited.methods.map((m) => `${m.className}.${m.method.signature}`)).toEqual([
      "OverloadMid.override void Foo (int a)",
      "OverloadBase.void Foo (float a)",
    ]);
  });

  it("an event handler with overloads is listed once", () => {
    const [hit] = engine.searchComponents({ query: "TestThingComponent" });
    expect(hit.eventHandlers).toEqual(["EOnInit"]);
  });
});
